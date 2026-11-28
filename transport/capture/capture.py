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
  /usr/local/bin/python3 transport/capture/capture.py --combine       # per bus with 3+ processed runs: GPS-sync them, write Capture/<REG>/combined/
                                                                      #   route.mp4 + route-web.mp4 + route-manifest.json (--tracker-db, --max-accuracy; with --root/--manifest it is offline)
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
import argparse, json, math, os, re, shutil, sqlite3, statistics, subprocess, sys, tempfile, time
from datetime import datetime, timedelta, timezone
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


def web_copy(src, dst):
    """The blurred route.mp4 -> a small copy for a phone (the portal's route view sends it as base64 through Apps Script, which
    cannot carry the full one): 360 px high, no chapters. Built beside dst, renamed when complete."""
    tmp = Path(dst).with_name(Path(dst).stem + ".partial.mp4")
    r = subprocess.run([FFMPEG, "-v", "error", "-y", "-i", str(src), "-map", "0:v", "-vf", "scale=-2:360", "-c:v", "libx264", "-preset", "veryfast",
                        "-crf", "32", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(tmp)], capture_output=True, text=True)
    if r.returncode:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"ffmpeg failed: {r.stderr.strip()[-300:]}")
    os.rename(tmp, dst)


def web_copies(root, dry_run=False):
    """Every processed run without a phone copy gets one (also runs processed before web_copy existed). Returns the runs done."""
    done = []
    for mp4 in sorted(Path(root).glob("*/*/processed/route.mp4")):
        web = mp4.with_name("route-web.mp4")
        if web.exists():
            continue
        if not dry_run:
            web_copy(mp4, web)
        done.append(mp4.parent.parent.name)
    return done


def process_run(run_dir, run, detectors):
    """Blurs every frame and stop photo of one run into processed/ and stitches route.mp4 there. All or nothing: built in
    processed.partial/, renamed only when complete. Raises NotReady while Drive is still bringing the frames or a stop photo
    down. A stop's photo is awaited only if it has one: since 30 Oct STOP HERE is one tap, GPS only, and the manifest says photo: false
    (a stop with no flag is from before then, when every timelapse stop had a photo)."""
    if not detectors:
        raise BlurUnavailable("no detectors")
    run_dir = Path(run_dir)
    frames = with_times(select_frames(run_dir.iterdir()), run)
    if not frames or len(frames) < int(run.get("frames") or 0):
        raise NotReady(f"{len(frames)} of {run.get('frames') or '?'} frames in this Mac's Drive copy")
    stops = run.get("stops") or []
    shot = [s for s in stops if s.get("photo", True)]
    missing = [s for s in shot if not (run_dir / f"stop-{int(s['seq']):05d}.jpg").exists()]
    if missing:
        raise NotReady(f"{len(missing)} of {len(shot)} stop photos not in this Mac's Drive copy")
    part = run_dir / "processed.partial"
    shutil.rmtree(part, ignore_errors=True)
    part.mkdir()
    try:
        def put(src, name):
            Image.fromarray(blur(np.asarray(Image.open(src).convert("RGB")), detectors)).save(part / name, quality=85)
            return part / name
        out = [put(f["path"], f"frame-{f['seq']:05d}.jpg") for f in frames]
        for s in shot:
            src = run_dir / f"stop-{int(s['seq']):05d}.jpg"
            put(src, src.name)
        stitch(out, chapters(stops, frames), part / "route.mp4")
        os.rename(part, run_dir / "processed")
    except BaseException:
        shutil.rmtree(part, ignore_errors=True)
        raise


# ---------------------------------------------------------------------------------------------------------------------------
# GPS sync and the combined route (Uday, 28 Nov: "at least 3 timelapse runs ... a virtual tour of the route overlaid on the map,
# GPS synced so the overlay is accurate"). Plan: notes folder route-3-runs-and-bus-counts-plan.md, part B.
# Every number below is config: change it here or with a flag, never in the logic.
SYNC = {
    "max_accuracy_m": 30.0,     # a frame whose GPS accuracy is worse than this is dropped (the phone itself pauses frames past 50 m)
    "max_speed_kmh": 110.0,     # a fix that needs a faster hop than this from the last kept one is an impossible jump: dropped
    "jump_m_without_time": 150.0,  # the same test when the frame has no time: frames are ~10 m apart, so this is a leap
    "tracker_offset_m": 25.0,   # the run's median distance to the bus's GPS tracker line, over which the run is flagged
    "segment_m": 10.0,          # the base track is cut into segments this long; one best frame per segment
    "match_m": 25.0,            # a frame within this of the base track is "on" it
    "stop_cluster_m": 40.0,     # one-tap stops from different runs closer than this are one stop
    "different_route_below": 0.70,  # a run with less of its frames on the base track than this is "a different route", never merged
    "runs_wanted": 3,           # the k in "seen k/3"; also how many processed runs a bus needs before combine() runs
    "stop_accuracy_default_m": 15.0,  # a stop with no accuracy weighs as this
}
IST = timezone(timedelta(hours=5, minutes=30))
TRACKER_DB = Path.home() / "Projects" / "transport-gps" / "trips.sqlite"  # insights.py's points(veh, at, lat, lng, ...): at is IST text
PROCESSED_FRAME_RE = re.compile(r"^frame-(\d{5})\.jpg$")


def _xy(lat, lng, origin):
    """Metres east / north of origin (flat-earth: exact enough over one route)."""
    return ((lng - origin[1]) * 111320.0 * math.cos(math.radians(origin[0])), (lat - origin[0]) * 110540.0)


def _latlng(x, y, origin):
    return (origin[0] + y / 110540.0, origin[1] + x / (111320.0 * math.cos(math.radians(origin[0]))))


def _onto_line(pts, line):
    """Each row of pts (n,2 metres) -> (distance to the polyline, distance along it, the nearest point (n,2)). line is (m,2), m >= 2."""
    a, b = line[:-1], line[1:]
    ab = b - a
    seg = np.hypot(ab[:, 0], ab[:, 1])
    cum = np.concatenate([[0.0], np.cumsum(seg)])
    l2 = np.where(seg > 0, seg * seg, 1.0)
    dist, arc, near = np.empty(len(pts)), np.empty(len(pts)), np.empty((len(pts), 2))
    for i, p in enumerate(pts):
        t = np.clip(((p - a) * ab).sum(1) / l2, 0.0, 1.0)
        t = np.where(seg > 0, t, 0.0)
        proj = a + t[:, None] * ab
        d = np.hypot(*(p - proj).T)
        k = int(np.argmin(d))
        dist[i], arc[i], near[i] = d[k], cum[k] + t[k] * seg[k], proj[k]
    return dist, arc, near


def frame_points(run_dir, run):
    """A processed run's frames with where they were taken: [{seq, path, lat, lng, t, acc}] in video order (lat None: no position on record).
    Frames come only from processed/ (blurred). Positions: run['points'] (the pull's per-seq list [lat, lng, takenAt, accuracy] | null,
    indexed by seq) else <run folder>/points.json (the same list, kept by the Roster) else processed/path.json (the route view's kept copy, one entry per processed frame in order; accuracy is its 4th
    value when the phone sent it: frames from before 28 Nov have none, and an unknown accuracy ranks last).
    """
    proc = Path(run_dir) / "processed"
    frames = sorted((int(m[1]), p) for p in proc.iterdir() if (m := PROCESSED_FRAME_RE.match(p.name)))
    given = run.get("points")
    if isinstance(given, list):
        pos = [given[s] if s < len(given) else None for s, _ in frames]
    elif (Path(run_dir) / "points.json").is_file():  # the Roster's kept copy of the pull (capturepoints), in the run's Drive folder
        kept = json.loads((Path(run_dir) / "points.json").read_text())
        pos = [kept[s] if isinstance(kept, list) and s < len(kept) else None for s, _ in frames]
    elif (proc / "path.json").is_file():
        kept = json.loads((proc / "path.json").read_text())
        pos = kept if isinstance(kept, list) and len(kept) == len(frames) else [None] * len(frames)
    else:
        pos = [None] * len(frames)
    out = []
    for (seq, path), p in zip(frames, pos):
        ok = isinstance(p, (list, tuple)) and len(p) >= 2 and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in p[:2])
        num = lambda i: p[i] if ok and len(p) > i and isinstance(p[i], (int, float)) and not isinstance(p[i], bool) else None
        out.append({"seq": seq, "path": path, "lat": p[0] if ok else None, "lng": p[1] if ok else None, "t": num(2), "acc": num(3)})
    return out


def load_tracker(db, reg, t0_ms, t1_ms, margin_min=10):
    """The bus's GPS-tracker fixes around a run, in order: [(lat, lng)], or None (no database, no such bus, under 3 fixes). Read only."""
    if not db or not Path(db).is_file() or t0_ms is None or t1_ms is None:
        return None
    f = lambda ms, m: datetime.fromtimestamp(ms / 1000, IST).__add__(timedelta(minutes=m)).strftime("%Y-%m-%d %H:%M:%S")
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            rows = con.execute("select lat, lng from points where veh = ? and at between ? and ? order by at",
                               (reg, f(t0_ms, -margin_min), f(t1_ms, margin_min))).fetchall()
        finally:
            con.close()
    except sqlite3.Error:
        return None
    return rows if len(rows) >= 3 else None


def sync_run(points, tracker=None, cfg=SYNC):
    """GPS sync of one run. Drops frames with no position, a poor accuracy or an impossible jump at road speed; where the bus's tracker has
    a line for that day, measures the run against it (median offset over cfg tracker_offset_m is flagged); snaps what is left to the road
    line: the tracker line if there is one, else the run's own track smoothed with a 5-point mean. Returns (kept, report): kept are the
    points with lat/lng replaced by the snapped position (and 'raw' = the phone's), report is numbers and one flag text, for printing."""
    rep = {"frames": len(points), "no_gps": 0, "poor_accuracy": 0, "jumps": 0, "kept": 0, "median_offset_m": None,
           "line": "own track", "tracker_median_m": None, "flag": None}
    cand = []
    for p in points:
        if p["lat"] is None:
            rep["no_gps"] += 1
        elif p["acc"] is not None and p["acc"] > cfg["max_accuracy_m"]:
            rep["poor_accuracy"] += 1
        else:
            cand.append(p)
    if not cand:
        rep["flag"] = "no usable GPS"
        return [], rep
    origin = (cand[0]["lat"], cand[0]["lng"])
    kept, last, run_of_drops = [], None, 0
    for p in cand:
        xy = _xy(p["lat"], p["lng"], origin)
        if last is not None and run_of_drops < 5:
            d = math.hypot(xy[0] - last[0][0], xy[1] - last[0][1])
            dt = (p["t"] - last[1]) / 1000.0 if p["t"] is not None and last[1] is not None else None
            if (dt is not None and d / max(dt, 1.0) * 3.6 > cfg["max_speed_kmh"]) or (dt is None and d > cfg["jump_m_without_time"]):
                rep["jumps"] += 1
                run_of_drops += 1
                continue
        run_of_drops = 0  # five drops in a row: the earlier fix was the bad one; carry on from here
        last = (xy, p["t"])
        kept.append((p, xy))
    rep["kept"] = len(kept)
    if len(kept) < 2:
        rep["flag"] = "too few frames after the GPS checks"
        return [], rep
    xy = np.array([k[1] for k in kept])
    half = 2
    smooth = np.array([xy[max(0, i - half): i + half + 1].mean(axis=0) for i in range(len(xy))])  # jumps are already out, so a mean is safe
    line, snapped = smooth, smooth
    if tracker:
        tl = np.array([_xy(la, ln, origin) for la, ln in tracker])
        dist, _, near = _onto_line(xy, tl)
        rep["tracker_median_m"] = float(np.median(dist))
        if rep["tracker_median_m"] > cfg["tracker_offset_m"]:
            rep["flag"] = f"offset from the GPS tracker {rep['tracker_median_m']:.0f} m (over {cfg['tracker_offset_m']:.0f} m)"
        else:
            rep["line"] = "tracker line"
            snapped = np.where((dist <= cfg["tracker_offset_m"])[:, None], near, smooth)
    out = []
    for (p, raw), s in zip(kept, snapped):
        la, ln = _latlng(s[0], s[1], origin)
        out.append(dict(p, lat=la, lng=ln, raw=(p["lat"], p["lng"])))
    rep["median_offset_m"] = float(np.median(np.hypot(*(xy - snapped).T)))
    return out, rep


def sync_line(run_id, rep):
    """One printable line of sync quality for a run."""
    off = "n/a" if rep["median_offset_m"] is None else f"{rep['median_offset_m']:.1f} m"
    tr = "" if rep["tracker_median_m"] is None else f"; tracker {rep['tracker_median_m']:.1f} m"
    drop = rep["frames"] - rep["kept"]
    return (f"{run_id}: {rep['kept']}/{rep['frames']} frames kept, {drop} dropped (no GPS {rep['no_gps']}, poor accuracy {rep['poor_accuracy']}, "
            f"jump {rep['jumps']}); median offset {off} from the {rep['line']}{tr}" + (f"  [FLAG: {rep['flag']}]" if rep["flag"] else ""))


def frame_quality(path):
    """(sharpness, light) of a blurred frame: variance of the Laplacian and the mean brightness, both of the grey image."""
    g = np.asarray(Image.open(path).convert("L"), dtype=np.float64)
    lap = -4 * g[1:-1, 1:-1] + g[:-2, 1:-1] + g[2:, 1:-1] + g[1:-1, :-2] + g[1:-1, 2:]
    return float(lap.var()) if lap.size else 0.0, float(g.mean())


def cluster_stops(stops, base_xy, origin, cfg=SYNC):
    """One-tap stops of every run -> clusters within cfg stop_cluster_m, position weighted by 1/accuracy^2. stops: [(run index, lat, lng,
    accuracy|None)]. Returns [{lat, lng, seen (distinct runs)}], never dropping a stop seen once."""
    cl = []
    for r, la, ln, acc in stops:
        x, y = _xy(la, ln, origin)
        w = 1.0 / (acc if acc and acc > 0 else cfg["stop_accuracy_default_m"]) ** 2
        for c in cl:
            if math.hypot(x - c["sx"] / c["sw"], y - c["sy"] / c["sw"]) <= cfg["stop_cluster_m"]:
                c["sx"] += x * w; c["sy"] += y * w; c["sw"] += w; c["runs"].add(r)
                break
        else:
            cl.append({"sx": x * w, "sy": y * w, "sw": w, "runs": {r}})
    out = []
    for c in cl:
        la, ln = _latlng(c["sx"] / c["sw"], c["sy"] / c["sw"], origin)
        out.append({"lat": la, "lng": ln, "seen": len(c["runs"])})
    return out


def combine(root, reg, runs=None, tracker_db=None, cfg=SYNC, say=None):
    """One better route from several processed runs of a bus (Capture/<REG>/combined/). Needs cfg runs_wanted processed runs with usable GPS.
    Each run is GPS-synced first (sync_run, printed per run). The base track is the run with the most good frames, cut into cfg segment_m
    segments; per segment the best frame of every run on the base track wins by GPS accuracy (whole metres), then sharpness, then light. A
    run with under cfg different_route_below of its frames on the base track is reported "a different route: check" and left out (it still
    counts as a run for the quest). Stops are clustered across runs ("seen k/3"; a stop seen once is kept, to be checked). Frames come only
    from each run's processed/ folder (already blurred): nothing unblurred is ever read. Built in combined.partial/, renamed when complete.
    Writes route.mp4, route-web.mp4 and route-manifest.json (numbers only: per video frame lat, lng, time, accuracy, segment, run number;
    per stop lat, lng, seen, of, frame). Returns a report dict ({'skipped': why} when it did nothing)."""
    say = say or log
    root, runs = Path(root), runs or {}
    synced = []
    for d in sorted(p for p in (root / reg).iterdir() if p.is_dir() and p.name != "combined" and (p / "processed" / "route.mp4").is_file()) if (root / reg).is_dir() else []:
        run = runs.get(d.name, {})
        if run.get("trial") is True:
            continue
        pts = frame_points(d, run)
        times = [p["t"] for p in pts if p["t"] is not None]
        tracker = load_tracker(tracker_db, reg, min(times) if times else None, max(times) if times else None)
        kept, rep = sync_run(pts, tracker, cfg)
        say(sync_line(d.name, rep))
        if kept:
            synced.append({"id": d.name, "kept": kept, "rep": rep, "stops": [s for s in run.get("stops") or [] if isinstance(s.get("lat"), (int, float)) and isinstance(s.get("lng"), (int, float))]})
    if len(synced) < cfg["runs_wanted"]:
        say(f"{reg}: {len(synced)} of {cfg['runs_wanted']} runs with usable GPS: not combined yet")
        return {"skipped": f"{len(synced)} of {cfg['runs_wanted']} runs"}
    base = max(synced, key=lambda r: len(r["kept"]))
    origin = (base["kept"][0]["lat"], base["kept"][0]["lng"])
    line = np.array([_xy(p["lat"], p["lng"], origin) for p in base["kept"]])
    used, different, cand = [], [], {}
    for n, r in enumerate(synced):
        dist, arc, _ = _onto_line(np.array([_xy(p["lat"], p["lng"], origin) for p in r["kept"]]), line)
        on = dist <= cfg["match_m"]
        r["on_base"] = float(on.mean())
        if r is not base and r["on_base"] < cfg["different_route_below"]:
            different.append(r["id"])
            say(f"{r['id']}: a different route: check ({r['on_base'] * 100:.0f}% of its frames on the base track {base['id']}); left out of the combined route")
            continue
        used.append(r)
        for p, a, ok in zip(r["kept"], arc, on):
            if ok:
                cand.setdefault(int(a // cfg["segment_m"]), []).append((len(used) - 1, p, float(a)))
    pick = []
    for seg in sorted(cand):
        rows = cand[seg]
        def rank(row):
            sharp, light = frame_quality(row[1]["path"]) if len(rows) > 1 else (0.0, 0.0)
            acc = row[1]["acc"]
            return (round(acc) if acc is not None else float("inf"), -sharp, -light)
        pick.append((seg, min(rows, key=rank)))
    if not pick:
        say(f"{reg}: no frames on the base track")
        return {"skipped": "no frames on the base track"}
    stops = [(i, s["lat"], s["lng"], s.get("accuracy")) for i, r in enumerate(used) for s in r["stops"]]
    clusters = cluster_stops(stops, line, origin, cfg)
    seg_to_frame = {seg: i for i, (seg, _) in enumerate(pick)}
    segs = sorted(seg_to_frame)
    man_stops = []
    for c in clusters:
        _, a, _ = _onto_line(np.array([_xy(c["lat"], c["lng"], origin)]), line)
        near = min(segs, key=lambda s: abs(s - a[0] // cfg["segment_m"]))
        man_stops.append({"lat": round(c["lat"], 6), "lng": round(c["lng"], 6), "seen": c["seen"], "of": cfg["runs_wanted"], "frame": seg_to_frame[near]})
    man_stops.sort(key=lambda s: s["frame"])
    frames_out = []
    for i, (seg, (run_i, p, a)) in enumerate(pick):
        frames_out.append({"i": i, "seg": seg, "lat": round(p["lat"], 6), "lng": round(p["lng"], 6), "t": p["t"], "acc": p["acc"], "run": run_i})
        assert p["path"].parent.name == "processed", "combined frames come only from processed/ (blurred)"
    manifest = {"fps": FPS, "segment_m": cfg["segment_m"], "runs": len(used), "frames": frames_out, "stops": man_stops}
    chap = chapters([{"seq": s["frame"], "name": f"Stop {n + 1} (seen {s['seen']}/{s['of']})"} for n, s in enumerate(man_stops)],
                    [{"seq": i} for i in range(len(pick))])
    part = root / reg / "combined.partial"
    shutil.rmtree(part, ignore_errors=True)
    part.mkdir()
    try:
        stitch([p["path"] for _, (_, p, _) in pick], chap, part / "route.mp4")
        web_copy(part / "route.mp4", part / "route-web.mp4")
        (part / "route-manifest.json").write_text(json.dumps(manifest, separators=(",", ":")))
        final = root / reg / "combined"
        shutil.rmtree(final, ignore_errors=True)
        os.rename(part, final)
    except BaseException:
        shutil.rmtree(part, ignore_errors=True)
        raise
    say(f"{reg}: combined {len(used)} runs into {len(pick)} frames over {len(pick) * cfg['segment_m']:.0f} m, {len(man_stops)} stops "
        f"({sum(s['seen'] == 1 for s in man_stops)} seen once: check)" + (f"; left out as a different route: {', '.join(different)}" if different else ""))
    return {"frames": len(pick), "runs": [r["id"] for r in used], "different": different, "stops": man_stops}


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
    ap.add_argument("--combine", action="store_true", help="only GPS-sync and combine each bus's processed runs into Capture/<REG>/combined/ (no blur, purge or push)")
    ap.add_argument("--tracker-db", default=str(TRACKER_DB), help="insights.py's trips.sqlite: its GPS-tracker fixes cross-check the frames")
    ap.add_argument("--max-accuracy", type=float, help="drop frames whose GPS accuracy is worse than this many metres (default: SYNC max_accuracy_m)")
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
    if a.max_accuracy:
        SYNC["max_accuracy_m"] = a.max_accuracy
    if a.combine:
        by_id = {r["runId"]: r for r in runs}
        fail = 0
        for reg in sorted({r["reg"] for r in runs}):
            try:
                combine(root, reg, by_id, a.tracker_db)
            except Exception as e:
                fail += 1
                log(f"{reg}: combine failed, nothing published ({type(e).__name__}: {e})")
        return 1 if fail else 0
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
    try:
        webs = web_copies(root, a.dry_run) if root.is_dir() else []
        if webs:
            log(f"{'would make' if a.dry_run else 'made'} the phone copy of {len(webs)} route videos")
    except Exception as e:
        failed += 1
        log(f"phone copies failed ({type(e).__name__}: {e})")
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
