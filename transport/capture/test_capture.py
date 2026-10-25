#!/usr/bin/env python3
"""capture.py: frame order, stop chapters, blur with injected detectors, ffmpeg stitch, fail-closed processing, the 30-day purge.
Plain asserts: `/usr/local/bin/python3 transport/capture/test_capture.py` (pytest also collects them). Temp dirs and fake images only."""
import contextlib, io, json, os, subprocess, sys, tempfile, time
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
import capture as C


def jpeg(path, colour=(90, 120, 150), size=(64, 48)):
    Image.new("RGB", size, colour).save(path, quality=95)
    return path


def box_at(x, y, w, h):
    return lambda img: [(x, y, w, h)]


def test_chapters_place_stop_2_at_the_frame_nearest_its_timestamp():
    frames = [{"seq": 0, "takenAt": 1000}, {"seq": 1, "takenAt": 2000}, {"seq": 3, "takenAt": 3000}, {"seq": 4, "takenAt": 4000}]
    stops = [{"seq": 2, "name": "Nalwari", "takenAt": 2100}, {"seq": 5, "name": "Gate = 2", "takenAt": 3100}]  # by capture order stop 2 would sit at frame 3
    meta = C.chapters(stops, frames, fps=30)
    assert meta.startswith(";FFMETADATA1\n")
    parts = meta.split("[CHAPTER]")[1:]
    assert len(parts) == 2, "one chapter per stop"
    assert "START=1\n" in parts[0] and "END=2\n" in parts[0] and "title=Nalwari" in parts[0]
    assert "START=2\n" in parts[1] and "END=4\n" in parts[1], "stop 2 sits at the frame nearest its timestamp (index 2), to the end"
    assert "title=Gate \\= 2" in parts[1], "ffmetadata special characters are escaped"
    assert "TIMEBASE=1/30" in parts[0]


def test_chapters_fall_back_to_capture_order_without_frame_times():
    frames = [{"seq": 0}, {"seq": 1}, {"seq": 3}, {"seq": 6}]
    meta = C.chapters([{"seq": 2, "takenAt": 5}, {"seq": 5, "takenAt": 9}], frames)
    assert "START=1\n" in meta.split("[CHAPTER]")[1], "a tie goes to the frame before the stop"
    assert "START=3\n" in meta.split("[CHAPTER]")[2] and "title=Stop 2" in meta, "an unnamed stop is numbered"


def test_chapters_for_a_run_with_no_stops_is_empty():
    assert C.chapters([], [{"seq": 0}, {"seq": 1}]) == ""


def test_select_frames_drops_a_duplicate_seq():
    got = C.select_frames([Path("r/frame-00002.jpg"), Path("r/frame-00001.jpg"), Path("r/frame-00002 (1).jpg"),
                           Path("r/stop-00003.jpg"), Path("r/inspection-00004.jpg"), Path("r/notes.txt")])
    assert [f["seq"] for f in got] == [1, 2], "sorted by seq, stop photos and other files left out"
    assert got[1]["path"].name == "frame-00002.jpg", "the original wins over a Drive conflict copy"


def test_blur_leaves_an_image_with_no_detections_unchanged():
    img = (np.arange(48 * 64 * 3) % 251).astype(np.uint8).reshape(48, 64, 3)  # fixture: a busy pattern, so any change shows
    out = C.blur(img, [lambda i: [], lambda i: []])
    assert out.shape == img.shape and np.array_equal(out, img)


def test_blur_hides_a_detected_box_and_nothing_far_from_it():
    img = (np.arange(96 * 128 * 3) % 251).astype(np.uint8).reshape(96, 128, 3)
    out = C.blur(img, [box_at(40, 30, 32, 24), lambda i: []])
    assert not np.array_equal(out[30:54, 40:72], img[30:54, 40:72]), "the detected box is changed"
    assert np.array_equal(out[:20], img[:20]) and np.array_equal(out[:, 100:], img[:, 100:]), "far from the box nothing changes"
    assert np.array_equal(img, (np.arange(96 * 128 * 3) % 251).astype(np.uint8).reshape(96, 128, 3)), "the input is not modified"


def test_stitch_builds_a_3_frame_mp4_at_30_fps():
    with tempfile.TemporaryDirectory() as d:
        frames = [jpeg(Path(d) / f"f{i}.jpg", (40 * i, 80, 120)) for i in range(3)]
        out = Path(d) / "route.mp4"
        C.stitch(frames, C.chapters([{"seq": 1, "name": "Stop A"}], [{"seq": 0}, {"seq": 1}, {"seq": 2}]), out)
        probe = json.loads(subprocess.run([C.FFPROBE, "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries",
                                           "stream=codec_name,r_frame_rate,nb_read_frames", "-show_chapters", "-of", "json", str(out)],
                                          capture_output=True, text=True, check=True).stdout)
        s = probe["streams"][0]
        assert (s["codec_name"], s["r_frame_rate"], s["nb_read_frames"]) == ("h264", "30/1", "3")
        assert [c["tags"]["title"] for c in probe["chapters"]] == ["Stop A"]


def make_run(root, reg="HP66A1234", run_id="HP66A1234-20261025-071500-ab12", frames=3, stop_seq=1):
    d = Path(root) / reg / run_id
    d.mkdir(parents=True)
    for s in range(frames + 1):
        if s != stop_seq:
            jpeg(d / f"frame-{s:05d}.jpg", (30 * s, 90, 140))
    jpeg(d / f"stop-{stop_seq:05d}.jpg")
    run = {"runId": run_id, "reg": reg, "kind": "timelapse", "status": "ended", "frames": frames,
           "stops": [{"seq": stop_seq, "name": "Nalwari", "lat": 31.6, "lng": 76.9, "takenAt": 1761356100000, "boardOn": 3, "boardOff": 0}]}
    return d, run


def test_process_run_publishes_blurred_frames_stop_photo_and_route():
    with tempfile.TemporaryDirectory() as root:
        d, run = make_run(root)
        seen = []
        C.process_run(d, run, [lambda img: seen.append(img.shape) or [(0, 0, 64, 48)]])  # a "face" over the whole photo
        assert seen == [(48, 64, 3)] * 4, "every frame and the stop photo went through the detectors"
        p = d / "processed"
        assert sorted(x.name for x in p.iterdir()) == ["frame-00000.jpg", "frame-00002.jpg", "frame-00003.jpg", "route.mp4", "stop-00001.jpg"]
        before, after = np.asarray(Image.open(d / "frame-00002.jpg")), np.asarray(Image.open(p / "frame-00002.jpg"))
        assert np.abs(before.astype(int) - after.astype(int)).max() <= 12, "a flat photo pixelated stays flat (sanity)"
        assert not (d / "processed.partial").exists()


def test_process_run_waits_for_frames_still_syncing():
    with tempfile.TemporaryDirectory() as root:
        d, run = make_run(root)
        run["frames"] = 9
        try:
            C.process_run(d, run, [lambda i: []])
            assert False, "should wait"
        except C.NotReady:
            pass
        assert not (d / "processed").exists()


def test_a_detector_that_fails_leaves_nothing_published():
    with tempfile.TemporaryDirectory() as root:
        d, run = make_run(root)
        def boom(img): raise RuntimeError("model crashed")
        try:
            C.process_run(d, run, [boom])
            assert False, "should raise"
        except RuntimeError:
            pass
        assert not (d / "processed").exists() and not (d / "processed.partial").exists()


def test_load_detectors_fails_closed_without_models():
    with tempfile.TemporaryDirectory() as empty:
        try:
            C.load_detectors(Path(empty))
            assert False, "no detectors without cv2 and both models"
        except C.BlurUnavailable as e:
            assert str(e)


def test_blur_unavailable_publishes_no_frames_and_exits_non_zero():
    with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as empty:
        d, run = make_run(root)
        man = Path(root) / "manifest.json"
        man.write_text(json.dumps({"runs": [run]}))
        code = C.main(["--root", root, "--models", empty, "--manifest", str(man)])
        assert code == 1, "the run failed: blur unavailable"
        assert not (d / "processed").exists(), "never any unblurred (or any) imagery in processed/"


def test_dry_run_writes_and_deletes_nothing():
    with tempfile.TemporaryDirectory() as root:
        d, run = make_run(root)
        old = time.time() - 40 * 86400
        (d / "processed").mkdir()
        (d / "processed" / "route.mp4").write_bytes(b"x")
        os.utime(d / "processed" / "route.mp4", (old, old))
        man = Path(root) / "m.json"
        man.write_text(json.dumps({"runs": [run]}))
        before = sorted((p.relative_to(root), p.stat().st_mtime) for p in Path(root).rglob("*"))
        assert C.main(["--root", root, "--manifest", str(man), "--dry-run"]) == 0
        assert sorted((p.relative_to(root), p.stat().st_mtime) for p in Path(root).rglob("*")) == before, "same files, untouched"


def test_purge_deletes_only_originals_of_runs_processed_30_days_ago():
    with tempfile.TemporaryDirectory() as root:
        old_d, _ = make_run(root, run_id="HP1-20260901-070000-aaaa")
        new_d, _ = make_run(root, run_id="HP1-20261020-070000-bbbb")
        raw_d, _ = make_run(root, run_id="HP1-20260801-070000-cccc")  # never processed
        old = time.time() - 31 * 86400
        for d, age in ((old_d, old), (new_d, time.time() - 5 * 86400)):
            (d / "processed").mkdir()
            jpeg(d / "processed" / "frame-00000.jpg")
            (d / "processed" / "route.mp4").write_bytes(b"x")
            os.utime(d / "processed" / "route.mp4", (age, age))
        jpeg(old_d / "inspection-00009.jpg")
        (old_d / "notes.txt").write_text("keep")
        os.utime(raw_d / "frame-00000.jpg", (old, old))
        gone = C.purge(root, time.time(), dry_run=True)
        assert sorted(p.name for p in gone) == ["frame-00000.jpg", "frame-00002.jpg", "frame-00003.jpg", "stop-00001.jpg"]
        assert all(p.exists() for p in gone), "a dry run deletes nothing"
        C.purge(root, time.time())
        assert sorted(p.name for p in old_d.iterdir()) == ["inspection-00009.jpg", "notes.txt", "processed"]
        assert (old_d / "processed" / "frame-00000.jpg").exists() and (old_d / "processed" / "route.mp4").exists(), "blurred output stays"
        assert len(list(new_d.glob("frame-*.jpg"))) == 3, "processed 5 days ago: originals kept"
        assert len(list(raw_d.glob("*.jpg"))) == 4, "never processed: nothing deleted"


def test_push_runs_sends_counts_only_for_processed_runs_not_yet_stored():
    with tempfile.TemporaryDirectory() as root:
        d, run = make_run(root)
        _, waiting = make_run(root, run_id="HP66A1234-20261026-071500-cd34")
        stored, _ = make_run(root, run_id="HP66A1234-20261024-071500-ef56")
        for x in (d, stored):
            (x / "processed").mkdir()
            (x / "processed" / "route.mp4").write_bytes(b"x")
        jpeg(d / "processed" / "stop-00001.jpg")
        done = dict(run, runId=stored.name, done=True)
        two = dict(run, stops=run["stops"] + [{"seq": 4, "name": "Gate", "takenAt": None}])  # a stop tagged without a photo
        out = C.push_runs([two, waiting, done], root)
        assert [r["runId"] for r in out] == [run["runId"]], "only processed runs the portal has not stored yet"
        assert out[0] == {"runId": run["runId"], "reg": "HP66A1234", "stops": [
            {"seq": 1, "name": "Nalwari", "lat": 31.6, "lng": 76.9, "at": "2025-10-25T01:35:00Z", "boardOn": 3, "boardOff": 0, "photo": True},
            {"seq": 4, "name": "Gate", "lat": None, "lng": None, "at": "", "boardOn": 0, "boardOff": 0, "photo": False}]}, \
            "no file ids (the portal looks up the processed copies itself), but which stops have a blurred photo to wait for"


def test_frame_times_from_the_manifest_place_the_chapters():
    frames = [{"seq": 0}, {"seq": 2}, {"seq": 3}, {"seq": 7}]
    got = C.with_times(frames, {"startedAt": 1_000_000, "frameTimes": [0, None, 10, 10]})  # deltas: seq 0 at +0, seq 2 +10 s, seq 3 +10 s more
    assert [f.get("takenAt") for f in got] == [1_000_000, 1_010_000, 1_020_000, None], "seq 7 is past the list: no time"
    assert C.with_times(frames, {"startedAt": 1_000_000, "frameTimes": None}) == frames
    assert C.with_times(frames, {"startedAt": "", "frameTimes": [0]}) == frames
    timed = C.with_times(frames[:3], {"startedAt": 0, "frameTimes": [0, None, 2, 28]})
    meta = C.chapters([{"seq": 1, "takenAt": 1000}, {"seq": 4, "takenAt": 29000}], timed)
    assert "START=0\n" in meta.split("[CHAPTER]")[1] and "START=2\n" in meta.split("[CHAPTER]")[2]


def test_no_detectors_is_blur_unavailable():
    with tempfile.TemporaryDirectory() as root:
        d, run = make_run(root)
        try:
            C.process_run(d, run, [])
            assert False, "an empty detector list must not publish unblurred frames"
        except C.BlurUnavailable:
            pass
        assert not (d / "processed").exists()


def test_purge_skips_symlinks_and_unexpected_names():
    with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as elsewhere:
        old = time.time() - 40 * 86400
        real, _ = make_run(elsewhere, reg="HP1", run_id="HP1-20260901-070000-aaaa")
        odd, _ = make_run(root, reg="hp-1", run_id="HP1-20260901-070000-bbbb")  # not a reg folder name
        for d in (real, odd):
            (d / "processed").mkdir()
            (d / "processed" / "route.mp4").write_bytes(b"x")
            os.utime(d / "processed" / "route.mp4", (old, old))
        (Path(root) / "HP2").mkdir()
        os.symlink(real, Path(root) / "HP2" / "HP2-20260901-070000-cccc")
        assert C.purge(root, time.time()) == []
        assert len(list(real.glob("frame-*.jpg"))) == 3 and len(list(odd.glob("frame-*.jpg"))) == 3


def stub_detectors(fn):
    keep = C.load_detectors
    C.load_detectors = lambda models: [lambda img: []]
    try:
        return fn()
    finally:
        C.load_detectors = keep


def test_main_carries_on_past_a_failed_run_and_exits_non_zero():
    with tempfile.TemporaryDirectory() as root:
        bad, a = make_run(root, run_id="HP66A1234-20261025-071500-aaaa")
        good, b = make_run(root, run_id="HP66A1234-20261025-081500-bbbb")
        (bad / "frame-00000.jpg").write_bytes(b"not a jpeg")
        man = Path(root) / "m.json"
        man.write_text(json.dumps({"runs": [a, b, dict(b, runId="../evil"), dict(b, runId="HP66A1234-1-empty", frames=0)]}))
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = stub_detectors(lambda: C.main(["--root", root, "--manifest", str(man)]))
        assert code == 1
        assert (good / "processed" / "route.mp4").exists() and not (bad / "processed").exists()
        assert "../evil: ignored" in out.getvalue(), "a run with an unexpected id is logged, not dropped silently"
        assert "HP66A1234-1-empty: empty run" in out.getvalue()


def test_a_run_waiting_more_than_3_days_for_its_frames_fails():
    with tempfile.TemporaryDirectory() as root:
        d, run = make_run(root)
        man = Path(root) / "m.json"
        man.write_text(json.dumps({"runs": [dict(run, frames=9, endedAt=(time.time() - 1 * 86400) * 1000)]}))
        assert stub_detectors(lambda: C.main(["--root", root, "--manifest", str(man)])) == 0, "a day late: still waiting for Drive"
        man.write_text(json.dumps({"runs": [dict(run, frames=9, endedAt=(time.time() - 4 * 86400) * 1000)]}))
        assert stub_detectors(lambda: C.main(["--root", root, "--manifest", str(man)])) == 1, "4 days late: somebody must look"
        assert not (d / "processed").exists()


def test_runs_with_unsafe_ids_or_not_ended_are_ignored():
    ok = {"runId": "HP1-20261025-071500-ab12", "reg": "HP1", "kind": "timelapse", "status": "ended"}
    assert C.ready(ok)
    assert not C.ready(dict(ok, status="running")) and not C.ready(dict(ok, kind="count"))
    assert not C.ready(dict(ok, runId="../x")) and not C.ready(dict(ok, reg="../HP1"))


def test_real_detectors_load_when_installed():
    models = C.MODELS_DIR
    try:
        import cv2  # noqa: F401
    except ImportError:
        print("SKIP test_real_detectors_load_when_installed: cv2 is not installed (see capture.py for the install commands)")
        return
    if not ((models / C.FACE_MODEL).is_file() and (models / C.PLATE_MODEL).is_file()):
        print(f"SKIP test_real_detectors_load_when_installed: models not in {models}")
        return
    flat = np.full((720, 1280, 3), 128, np.uint8)
    assert np.array_equal(C.blur(flat, C.load_detectors(models)), flat), "a flat grey frame has no face and no plate"


if __name__ == "__main__":
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    failed = 0
    for name, fn in tests:
        try:
            fn()
            print("ok  ", name)
        except Exception as e:  # report every test, then fail the run
            failed += 1
            print("FAIL", name, "-", type(e).__name__, e)
    print(f"{len(tests) - failed} passed, {failed} failed")
    sys.exit(1 if failed else 0)
