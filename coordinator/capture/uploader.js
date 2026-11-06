// Resumable uploader. For one run: capturerun (status 'running') -> files in seq order -> capturerun (status 'ended').
// Every step is recorded in the store, so a closed tab, a dead battery or a dropped connection just means start(runId) again later.
// post(body) -> Promise<response> is injected (the page adds idToken and talks to the roster web app).
// Transient trouble (post throws, response.network, a timeout/lock/service/server-error message) retries on delays 5 s, 15 s, 60 s, then waits for the
// browser's `online` event and starts the sequence over. A permanent refusal (e.g. "belongs to another bus", "Not authorized")
// marks the file failed, sets the run's status to 'error' with the reason, and stops: no endless retry.

const DELAYS = [5000, 15000, 60000];
const TRANSIENT = /timed? ?out|try again|too many|temporar|could not obtain lock|failed to fetch|network|service|server error/i;

export function createUploader({
  store, post, onProgress = () => {}, delays = DELAYS, parallel = 4, batch = 8,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  // Waiting for `online` hangs if the phone thinks it is online but the server is unreachable, so then just wait once more.
  waitOnline = () => (typeof navigator !== 'undefined' && navigator.onLine === false
    ? new Promise((r) => addEventListener('online', r, { once: true }))
    : sleep(delays[delays.length - 1])),
}) {
  let stopped = false, wake, useBatch = batch > 1;
  const stopSignal = new Promise((r) => { wake = r; });
  const inflight = new Map(), again = new Set();
  const wait = (p) => Promise.race([p, stopSignal]);

  // a batch answer with a passing trouble on one of its files is retried whole: the files already saved answer their ids again
  const transient = (res) => !res || res.network || (res.success === false && TRANSIENT.test(res.error || '')) ||
    (res.success && Array.isArray(res.results) && res.results.some((x) => x.error && TRANSIENT.test(x.error)));

  // Posts until it succeeds or is refused for good. Returns { res } or { error } (permanent), or null when stopped.
  async function send(body, progress) {
    for (let i = 0; ;) {
      let res = null;
      try { res = await post(body); } catch (e) { res = null; }
      if (res && res.success && !transient(res)) return { res };
      if (!transient(res)) return { error: (res && res.error) || 'Refused' };
      if (stopped) return null;
      progress('retrying');
      if (i < delays.length) await wait(sleep(delays[i++]));
      else { progress('waiting-online'); await wait(waitOnline()); i = 0; }
      if (stopped) return null;
    }
  }

  async function upload(runId) {
    let run = await store.patchRun(runId, { error: null, status: run0status(await store.getRun(runId)) });
    let total = 0, sent = 0;
    const progress = (state, error) => onProgress({ runId, sent, total, state, error });
    const fail = async (error, f) => {
      if (f) await store.markFailed(runId, f.kind, f.seq, error);
      await store.patchRun(runId, { status: 'error', error });
      progress('error', error);
    };
    // capturedBy: the run's author. Anyone signed in on the shared phone may send it, but the capture is credited to them (Ruling 41).
    // Safety-check answers go only in the END manifest: until then they point at their photos by seq, which the server refuses.
    const manifest = (status, inspection, frameTimes) => ({ action: 'capturerun', run: {
      runId, reg: run.reg, kind: run.kind, startedAt: run.startedAt, endedAt: run.endedAt, frames: run.frames,
      gaps: run.gaps, stops: run.stops, inspection, status, capturedBy: run.by, ...(frameTimes ? { frameTimes } : {}),
      ...(run.trial === true ? { trial: true } : {}) } }); // a trial waits on the Coordinator's shelf; only staff may send one (the Roster checks)
    // Inspection answers point at their photo by seq on the phone; the server gets the photo's Drive file id instead.
    const withFileIds = async (insp) => {
      if (!insp) return insp;
      const ids = await store.fileIds(runId), out = {};
      Object.keys(insp).forEach((k) => {
        const { seq, ...a } = insp[k];
        out[k] = seq != null && ids[seq] ? { ...a, fileId: ids[seq] } : a;
      });
      return out;
    };
    const refresh = async () => { // frames may be added and the run ended while we upload, so look again after every pass
      run = await store.getRun(runId);
      const pending = await store.pending(runId);
      total = await store.total(runId); sent = total - pending.length;
      return pending;
    };

    let pending = await refresh();
    // A safety check sends nothing until it is saved: until then a photo may still be retaken or dropped (private photos).
    if (run.kind === 'inspection' && !run.endedAt) return progress('not-ended');
    progress('uploading');
    if (!run.startSent) {
      const r = await send(manifest('running'), progress);
      if (!r) return progress('stopped');
      if (r.error) return fail(r.error);
      await store.patchRun(runId, { startSent: true });
    }
    // Files until none are left, then the end manifest if the run has ended by now (checked on a fresh read).
    // Speed (6 Nov: one at a time ran ~1 frame per 20 s, all round trips): `parallel` requests at once, each a batch of up to
    // `batch` files and under 2 MB (capturefiles). A Roster from before batches answers "Unknown action": then one file per request.
    // A refusal stops the others after their current request.
    const body = async (f) => ({ kind: f.kind, seq: f.seq, lat: f.lat, lng: f.lng, takenAt: f.takenAt, base64: await store.fileData(runId, f.kind, f.seq) });
    const saved = async (f, fileId) => { await store.markSent(runId, f.kind, f.seq, fileId); sent++; progress('uploading'); };
    const one = async (f) => { // undefined when saved, else {} (stopped) or {error, f}
      const r = await send({ action: 'capturefile', reg: run.reg, runId, runKind: run.kind, ...(await body(f)) }, progress);
      if (!r) return {};
      if (r.error) return { error: r.error, f };
      await saved(f, r.res.fileId);
    };
    while (pending.length) {
      let next = 0, halt = null;
      const take = () => { // the next batch: up to `batch` files and ~1.9 MB of base64 (older files: ~105 KB a frame)
        const g = [];
        for (let size = 0; next < pending.length && g.length < (useBatch ? batch : 1); next++) {
          size += (pending[next].bytes || 105000) * 4 / 3;
          if (g.length && size > 1.9e6) break; // under the 2 MB a request should carry
          g.push(pending[next]);
        }
        return g;
      };
      const worker = async () => {
        while (!halt && next < pending.length) {
          const g = take();
          let out;
          if (g.length > 1) {
            const files = [];
            for (const f of g) files.push(await body(f));
            const r = await send({ action: 'capturefiles', reg: run.reg, runId, runKind: run.kind, files }, progress);
            if (r && r.error && /unknown action/i.test(r.error)) { useBatch = false; for (const f of g) if ((out = await one(f))) break; }
            else if (!r) out = {};
            else if (r.error) out = { error: r.error, f: g[0] };
            else for (const x of r.res.results) {
              const f = g.find((y) => y.kind === x.kind && y.seq === x.seq);
              if (!f) continue;
              if (x.error) out = out || { error: x.error, f }; else await saved(f, x.fileId);
            }
          } else out = await one(g[0]);
          if (out) { halt = halt || out; return; }
        }
      };
      await Promise.all(Array.from({ length: Math.min(parallel, pending.length) }, worker));
      if (halt) return halt.error ? fail(halt.error, halt.f) : progress('stopped');
      pending = await refresh();
    }
    if (run.endedAt && !run.endSent) {
      // a timelapse's end manifest carries its frame times, so the Mac can place each stop's chapter in time
      const r = await send(manifest('ended', await withFileIds(run.inspection), run.kind === 'timelapse' ? await store.frameTimes(runId) : null), progress);
      if (!r) return progress('stopped');
      if (r.error) return fail(r.error);
      await store.patchRun(runId, { endSent: true });
    }
    progress(run.endedAt ? 'done' : 'uploaded-so-far');
  }
  const run0status = (run) => (run.endedAt ? 'ended' : 'running'); // an earlier 'error' is cleared on a fresh start

  return {
    // start() while a pass is running flags another pass for when it settles (the page calls start after the user taps End).
    start: (runId) => {
      if (inflight.has(runId)) { again.add(runId); return inflight.get(runId); }
      const p = (async () => { do { again.delete(runId); await upload(runId); } while (again.has(runId) && !stopped); })()
        .finally(() => { inflight.delete(runId); again.delete(runId); });
      inflight.set(runId, p);
      return p;
    },
    stop: () => { stopped = true; wake(); },
  };
}
