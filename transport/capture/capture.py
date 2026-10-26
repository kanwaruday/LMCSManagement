#!/usr/bin/env python3
"""Capture runs -> blurred frames + a route timelapse with one chapter per stop, then the stop list back to the portal.

Daily, after ~/Projects/transport-gps/insights.py. A Coordinator rides a bus with the school phone (capture portal, Timelapse
mode); its frames and stop photos land in Drive as Capture/<REG>/<runId>/frame-<seq>.jpg and stop-<seq>.jpg (Roster backend,
apps-script/transport-capture.gs). For every ended timelapse run (POST transportcapturepull to the Coordinator backend) that
has no processed/route.mp4 yet, this blurs faces and number plates in every frame and stop photo into
Capture/<REG>/<runId>/processed/, stitches route.mp4 (30 fps, H.264, a chapter at each stop, placed by the phone's frame times)
and pushes each processed run's stops (POST transportcapturepush). The push carries no file ids: the portal looks up the blurred
files' ids in Drive itself, and answers "not yet" until Drive for desktop has uploaded them (pushed again the next day, never
reprocessed). Originals of runs processed 30+ days ago are deleted.

Run it with /usr/local/bin/python3 (framework 3.13, which has numpy, Pillow and onnxruntime). launchd's python3 is
/usr/bin/python3 (3.9), which has none of them.
  /usr/local/bin/python3 transport/capture/capture.py                 # the daily job
  /usr/local/bin/python3 transport/capture/capture.py --dry-run       # read and plan only: nothing written, deleted or pushed
  /usr/local/bin/python3 transport/capture/capture.py --root DIR --manifest runs.json   # a test folder and a local manifest; nothing pushed
  /usr/local/bin/python3 transport/capture/test_capture.py            # tests; the real-detector one runs once the models are installed

Privacy: blur FAILS CLOSED. Without OpenCV, onnxruntime or either model file, no run is processed (no frames, no route.mp4),
each waiting run is logged "blur unavailable" and the exit code is 1. A run is built in processed.partial/ and renamed to
processed/ only when every image is blurred and the video is stitched. Output stays in Drive (private), never in the repo.
Stops carry children as counts only (boardOn/boardOff). Nothing here computes speed.

Models (Uday installs them; nothing downloads them automatically), in MODELS_DIR (~/.lmcs/capture-models):
  - face_detection_yunet_2023mar.onnx  YuNet face detector, opencv/opencv_zoo (models/face_detection_yunet; its LICENSE file
    is MIT, the zoo is Apache-2.0), 232,589 bytes:
    https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx
  - yolo-v9-t-640-license-plates-end2end.onnx  YOLOv9-tiny licence-plate detector, ankandrew/open-image-models (MIT),
    7,835,770 bytes, input 640x640 RGB 0-1, output rows [batch, x1, y1, x2, y2, class, score] (NMS inside the model):
    https://github.com/ankandrew/open-image-models/releases/download/assets/yolo-v9-t-640-license-plates-end2end.onnx
Install:
  /usr/local/bin/python3 -m pip install opencv-python-headless==5.0.0.93    # onnxruntime, numpy and Pillow are already installed
  mkdir -p ~/.lmcs/capture-models && cd ~/.lmcs/capture-models
  curl -fLO https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx
  curl -fLO https://github.com/ankandrew/open-image-models/releases/download/assets/yolo-v9-t-640-license-plates-end2end.onnx
"""
import argparse, json, os, re, shutil, subprocess, sys, tempfile, time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
SECRET = Path.home() / ".lmcs" / "transport_push_secret"
SHARED_JS = HERE.parent.parent / "coordinator" / "shared.js"  # holds BACKEND_URL, the one place the backend URL lives
# DRIVE_ROOT (transport/reread_unread.py:33, drive-index/records.py:31) + the transport folder of apps-script/transport-uploads.gs
# (TUP_PATH_) + Capture. Not imported: reread_unread pulls in build_master and its workbook reader.
DEFAULT_ROOT = Path("/Users/udaykanwar/Library/CloudStorage/GoogleDrive-uday.kanwar@lms.org.in/My Drive/SCHOOL RELATED/"
                    "LMS Central Repository/LMCS Repository/Important Documents @ LMCS/Important Documents Transport/Capture")
MODELS_DIR = Path.home() / ".lmcs" / "capture-models"
FACE_MODEL, PLATE_MODEL = "face_detection_yunet_2023mar.onnx", "yolo-v9-t-640-license-plates-end2end.onnx"
# ponytail: privacy-leaning starting thresholds (a missed face is worse than a blurred bush); tune on real frames
FACE_SCORE, PLATE_SCORE = 0.5, 0.2
KEEP_DAYS = 30  # originals are deleted this long after their run was processed
FPS = 30
FFMPEG = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"  # launchd's PATH has no /opt/homebrew/bin
FFPROBE = shutil.which("ffprobe") or "/opt/homebrew/bin/ffprobe"
FRAME_RE = re.compile(r"^frame-(\d{5})(?: \(\d+\))?\.jpg$")  # " (1)": a Drive conflict copy
ORIGINAL_RE = re.compile(r"^(frame|stop)-\d{5}(?: \(\d+\))?\.jpg$")
RUN_ID_RE, REG_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$"), re.compile(r"^[A-Z0-9]{1,16}$")


class BlurUnavailable(Exception):
    """No face or plate detector: nothing may be published."""


class NotReady(Exception):
    """The run's files have not all reached this Mac's Drive copy yet; try again tomorrow."""


STALE_DAYS = 3  # a run still waiting for its frames or stop photos this long after it ended is a failure somebody must look at


def log(msg):
    print(datetime.now().strftime("%Y-%m-%d %H:%M"), "capture:", msg, flush=True)


def select_frames(paths):
    """Paths in a run folder -> [{seq, path}] of its timelapse frames, sorted by seq, one per seq (the original over a conflict copy)."""
    by = {}
    for p in sorted(map(Path, paths), key=lambda p: (len(p.name), p.name)):
        m = FRAME_RE.match(p.name)
        if m:
            by.setdefault(int(m[1]), p)
    return [{"seq": s, "path": by[s]} for s in sorted(by)]


def chapters(stops, frames, fps=FPS):
    """ffmetadata text with one chapter per stop, starting at its nearest frame and running to the next stop's (or the end).
    Nearest in time when the stop and every frame carry takenAt (ms); otherwise in capture order (seq is one counter per run
    across frames and stops, and the Drive copy has no frame times). '' when there is no stop."""
    if not stops or not frames:
        return ""
    timed = all(f.get("takenAt") is not None for f in frames) and all(s.get("takenAt") is not None for s in stops)
    key = "takenAt" if timed else "seq"
    starts = [min(range(len(frames)), key=lambda i: abs(frames[i][key] - s[key])) for s in stops]
    esc = lambda t: re.sub(r"([=;#\\\n])", r"\\\1", str(t))
    out = [";FFMETADATA1"]
    for i, (s, a) in enumerate(zip(stops, starts)):
        nxt = starts[i + 1] if i + 1 < len(starts) else len(frames)
        out += ["[CHAPTER]", f"TIMEBASE=1/{fps}", f"START={a}", f"END={max(a + 1, nxt)}", "title=" + esc(s.get("name") or f"Stop {i + 1}")]
    return "\n".join(out) + "\n"


def with_times(frames, run):
    """The frames with takenAt (ms) from the run's manifest: frameTimes is indexed by seq, whole seconds since the previous frame
    (the first since startedAt, ms), null for a stop. Unchanged without them."""
    ft, t0 = run.get("frameTimes"), run.get("startedAt")
    if not isinstance(ft, list) or not isinstance(t0, (int, float)) or isinstance(t0, bool):
        return frames
    at, sec = {}, 0
    for seq, d in enumerate(ft):
        if isinstance(d, (int, float)) and not isinstance(d, bool):
            sec += d
            at[seq] = t0 + sec * 1000
    return [dict(f, takenAt=at[f["seq"]]) if f["seq"] in at else f for f in frames]


def blur(image, detectors, cells=8):
    """image: HxWx3 uint8 RGB. detectors: callables image -> [(x, y, w, h)]. A copy with every detected box (padded 15%)
    pixelated to about `cells` blocks across its longer side. A detector that raises fails the whole run."""
    out = image.copy()
    H, W = out.shape[:2]
    for detect in detectors:
        for x, y, w, h in detect(image):
            x0, y0 = max(0, int(x - 0.15 * w)), max(0, int(y - 0.15 * h))
            x1, y1 = min(W, int(x + 1.15 * w) + 1), min(H, int(y + 1.15 * h) + 1)
            c = max(1, -(-max(x1 - x0, y1 - y0) // cells))
            for cy in range(y0, y1, c):
                for cx in range(x0, x1, c):
                    cell = out[cy:min(cy + c, y1), cx:min(cx + c, x1)]
                    cell[...] = cell.reshape(-1, cell.shape[-1]).mean(0)
    return out


def load_detectors(models_dir=MODELS_DIR):
    """[faces, plates], each image (RGB uint8) -> [(x, y, w, h)]. Raises BlurUnavailable when OpenCV, onnxruntime or a model is missing."""
    try:
        import cv2
        import onnxruntime as ort
    except ImportError as e:
        raise BlurUnavailable(f"{e.name} is not installed (/usr/local/bin/python3 -m pip install opencv-python-headless==5.0.0.93)") from None
    face_path, plate_path = Path(models_dir) / FACE_MODEL, Path(models_dir) / PLATE_MODEL
    for p in (face_path, plate_path):
        if not p.is_file():
            raise BlurUnavailable(f"model missing: {p}")
    try:  # an old cv2 without FaceDetectorYN, a corrupt model: the same "blur unavailable", not a crash of the whole job
        yunet = cv2.FaceDetectorYN.create(str(face_path), "", (320, 320), FACE_SCORE, 0.3, 5000)
        sess = ort.InferenceSession(str(plate_path), providers=["CPUExecutionProvider"])
    except Exception as e:
        raise BlurUnavailable(f"detector load failed: {e}") from None

    def faces(img):
        yunet.setInputSize((img.shape[1], img.shape[0]))
        _, found = yunet.detect(np.ascontiguousarray(img[:, :, ::-1]))  # YuNet wants BGR
        return [] if found is None else [tuple(f[:4]) for f in found]

    inp = sess.get_inputs()[0]
    size = inp.shape[2] if isinstance(inp.shape[2], int) else 640

    def plates(img):  # letterbox as open-image-models does: scale to fit, pad grey 114, RGB 0-1, NCHW
        h, w = img.shape[:2]
        r = min(size / h, size / w)
        nw, nh = round(w * r), round(h * r)
        dx, dy = (size - nw) // 2, (size - nh) // 2
        board = np.full((size, size, 3), 114, np.uint8)
        board[dy:dy + nh, dx:dx + nw] = np.asarray(Image.fromarray(img).resize((nw, nh), Image.BILINEAR))
        rows = sess.run(None, {inp.name: board.transpose(2, 0, 1)[None].astype(np.float32) / 255})[0].reshape(-1, 7)
        return [((a - dx) / r, (b - dy) / r, (c - a) / r, (d - b) / r) for _, a, b, c, d, _, s in rows if s >= PLATE_SCORE]

    return [faces, plates]


def stitch(frames, chapters_text, out_mp4):
    """Image paths in order -> out_mp4: ffmpeg at 30 fps, H.264, every frame fitted into 1280x720, with the ffmetadata chapters."""
    if not frames:
        raise ValueError("no frames to stitch")
    with tempfile.TemporaryDirectory() as tmp:
        for i, f in enumerate(frames):
            os.symlink(Path(f).resolve(), Path(tmp) / f"{i:06d}.jpg")
        cmd = [FFMPEG, "-v", "error", "-y", "-framerate", str(FPS), "-i", str(Path(tmp) / "%06d.jpg")]
        if chapters_text:
            (Path(tmp) / "chapters.txt").write_text(chapters_text)
            cmd += ["-i", str(Path(tmp) / "chapters.txt"), "-map_metadata", "1", "-map_chapters", "1"]
        cmd += ["-map", "0:v", "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out_mp4)]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode:
            raise RuntimeError(f"ffmpeg failed: {r.stderr.strip()[-300:]}")


def process_run(run_dir, run, detectors):
    """Blurs every frame and stop photo of one run into processed/ and stitches route.mp4 there. All or nothing: built in
    processed.partial/, renamed only when complete. Raises NotReady while Drive is still bringing the frames or a stop photo
    down: every timelapse stop has a photo (the capture page saves no stop without one), so a run is never published without it."""
    if not detectors:
        raise BlurUnavailable("no detectors")
    run_dir = Path(run_dir)
    frames = with_times(select_frames(run_dir.iterdir()), run)
    if not frames or len(frames) < int(run.get("frames") or 0):
        raise NotReady(f"{len(frames)} of {run.get('frames') or '?'} frames in this Mac's Drive copy")
    stops = run.get("stops") or []
    missing = [s for s in stops if not (run_dir / f"stop-{int(s['seq']):05d}.jpg").exists()]
    if missing:
        raise NotReady(f"{len(missing)} of {len(stops)} stop photos not in this Mac's Drive copy")
    part = run_dir / "processed.partial"
    shutil.rmtree(part, ignore_errors=True)
    part.mkdir()
    try:
        def put(src, name):
            Image.fromarray(blur(np.asarray(Image.open(src).convert("RGB")), detectors)).save(part / name, quality=85)
            return part / name
        out = [put(f["path"], f"frame-{f['seq']:05d}.jpg") for f in frames]
        for s in stops:
            src = run_dir / f"stop-{int(s['seq']):05d}.jpg"
            put(src, src.name)
        stitch(out, chapters(stops, frames), part / "route.mp4")
        os.rename(part, run_dir / "processed")
    except BaseException:
        shutil.rmtree(part, ignore_errors=True)
        raise


def purge(root, now, dry_run=False, days=KEEP_DAYS):
    """Deletes the originals (frame-/stop- JPEGs, not inspection photos, not processed/) of every run whose processed/route.mp4
    is `days` old. Returns the paths deleted (or that would be)."""
    gone = []
    for done in sorted(Path(root).glob("*/*/processed/route.mp4")):
        run_dir = done.parent.parent
        if (not REG_RE.match(run_dir.parent.name) or not RUN_ID_RE.match(run_dir.name)
                or any(p.is_symlink() for p in (run_dir.parent, run_dir, done.parent, done))):
            continue  # only real run folders under Capture/, never a link to somewhere else
        if now - done.stat().st_mtime < days * 86400:
            continue
        for p in sorted(run_dir.iterdir()):
            if p.is_file() and not p.is_symlink() and ORIGINAL_RE.match(p.name):
                gone.append(p)
                if not dry_run:
                    p.unlink()
    return gone


def iso(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if isinstance(ms, (int, float)) else ""


def push_runs(runs, root):
    """The transportcapturepush runs: each run with a processed/route.mp4 that the portal has not stored yet (`done`), with its
    stops, children as counts. No file ids: the portal looks up the processed copies itself; `photo` says which stops have a
    blurred photo, so the portal waits for each of them to reach Drive before it stores the run."""
    out = []
    for r in runs:
        d = Path(root) / r["reg"] / r["runId"] / "processed"
        if r.get("done") or not (d / "route.mp4").exists():
            continue
        out.append({"runId": r["runId"], "reg": r["reg"], "stops": [
            {"seq": int(s["seq"]), "name": s.get("name") or "", "lat": s.get("lat"), "lng": s.get("lng"), "at": iso(s.get("takenAt")),
             "boardOn": int(s.get("boardOn") or 0), "boardOff": int(s.get("boardOff") or 0),
             "photo": (d / f"stop-{int(s['seq']):05d}.jpg").exists()}
            for s in r.get("stops") or []]})
    return out


def ready(r):
    """An ended timelapse run whose ids are safe to use as folder names."""
    return (r.get("kind") == "timelapse" and r.get("status") == "ended"
            and bool(RUN_ID_RE.match(str(r.get("runId", "")))) and bool(REG_RE.match(str(r.get("reg", "")))))


def post(action, payload=None):
    """POST to the Coordinator backend with the shared secret (curl: this Python has no CA bundle); exits non-zero if refused."""
    if not SECRET.exists():
        sys.exit(f"{SECRET} not found; create it with the TRANSPORT_PUSH_SECRET value, or use --manifest")
    body = {"action": action, "secret": SECRET.read_text().strip()}
    if payload is not None:
        body["payload"] = payload
    url = re.search(r"BACKEND_URL = '([^']+)'", SHARED_JS.read_text())[1]
    out = subprocess.run(["curl", "-sSL", "--max-time", "300", "--data-binary", "@-", url], input=json.dumps(body), capture_output=True, text=True)
    try:
        res = json.loads(out.stdout or "{}")
    except ValueError:
        res = {}
    if not res.get("success"):
        sys.exit(f"{action} refused: {res.get('error') or out.stdout[:300] or out.stderr[:300]}")
    return res


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--root", default=str(DEFAULT_ROOT), help="the Drive Capture/ folder (default: the transport folder in Drive for desktop)")
    ap.add_argument("--models", default=str(MODELS_DIR), help="folder with the two ONNX models")
    ap.add_argument("--manifest", help="read the runs from this JSON file ({runs:[...]}) instead of the portal; nothing is pushed")
    ap.add_argument("--dry-run", action="store_true", help="read and plan only: nothing is written, deleted or pushed")
    a = ap.parse_args(argv)
    root = Path(a.root)
    runs = []
    for r in (json.loads(Path(a.manifest).read_text()) if a.manifest else post("transportcapturepull"))["runs"]:
        if ready(r):
            runs.append(r)
        elif r.get("kind") == "timelapse" and r.get("status") == "ended":
            log(f"{r.get('runId')}: ignored (unexpected run id or reg {r.get('reg')!r})")
    if runs and not root.is_dir():
        sys.exit(f"Capture folder not found: {root} (is Drive for desktop running? pass --root)")
    todo = [r for r in runs if not (root / r["reg"] / r["runId"] / "processed" / "route.mp4").exists()]
    failed, detectors = 0, None
    if todo:
        try:
            detectors = load_detectors(Path(a.models))
        except BlurUnavailable as e:
            for r in todo:
                log(f"{r['runId']}: blur unavailable ({e}); nothing published")
            failed, todo = len(todo), []
    for r in todo:
        if not int(r.get("frames") or 0):
            log(f"{r['runId']}: empty run, nothing to stitch")
            continue
        if a.dry_run:
            log(f"{r['runId']}: would blur and stitch")
            continue
        try:
            process_run(root / r["reg"] / r["runId"], r, detectors)
            log(f"{r['runId']}: processed")
        except NotReady as e:
            ended = r.get("endedAt")
            if isinstance(ended, (int, float)) and time.time() - ended / 1000 > STALE_DAYS * 86400:
                failed += 1
                log(f"{r['runId']}: failed, still missing files {STALE_DAYS}+ days after it ended ({e})")
            else:
                log(f"{r['runId']}: waiting ({e})")
        except Exception as e:
            failed += 1
            log(f"{r['runId']}: failed, nothing published ({type(e).__name__}: {e})")
    gone = purge(root, time.time(), a.dry_run) if root.is_dir() else []
    if gone:
        log(f"{'would delete' if a.dry_run else 'deleted'} {len(gone)} originals of runs processed {KEEP_DAYS}+ days ago")
    done = push_runs(runs, root)
    if a.dry_run or a.manifest:
        log(f"would push {len(done)} processed runs")
    elif done:
        res = post("transportcapturepush", {"runs": done})
        wait = (res.get("notYet") or []) + (res.get("later") or [])
        log(f"pushed {res.get('runs', 0)} processed runs" + (f"; again tomorrow (not yet in Drive, or over the batch): {', '.join(wait)}" if wait else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
