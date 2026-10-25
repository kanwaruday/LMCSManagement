// Offline run store: everything a capture run records stays on the phone until the uploader sends it.
// idb = { runs, files }, each a {put, getAll, delete} adapter keyed by `id` (the office/js/idb-store.js shape).
// createCaptureIdb() builds the real pair on one IndexedDB database; tests pass in-memory fakes.
//
// run:  { id, reg, kind: timelapse|count|inspection, campus, by, role, startedAt, endedAt, status: running|ended|error,
//         error, frames, nextSeq, gaps: [{from,to}], stops: [{seq,lat,lng,takenAt,boardOn,boardOff}], inspection, startSent, endSent }
// file: { id: '<runId>:<kind>:<seq>', runId, kind: frame|stop|inspection, seq, lat, lng, takenAt, base64, sent, fileId, error }
// seq is one counter per run across kinds, so it is also the capture order.

export function createCaptureIdb(dbName = 'lmcs-capture') {
  const db = new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => { for (const s of ['capture-runs', 'capture-files']) req.result.createObjectStore(s, { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const adapter = (storeName) => {
    const run = async (mode, op) => {
      const tx = (await db).transaction(storeName, mode);
      const req = op(tx.objectStore(storeName));
      return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(req.result); tx.onerror = tx.onabort = () => reject(tx.error); });
    };
    return { put: (e) => run('readwrite', (s) => s.put(e)), getAll: () => run('readonly', (s) => s.getAll()), delete: (id) => run('readwrite', (s) => s.delete(id)) };
  };
  return { runs: adapter('capture-runs'), files: adapter('capture-files') };
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
const ALNUM = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function createRunStore(idb, { now = () => Date.now(), rand = Math.random } = {}) {
  // IndexedDB has no get-by-id here and every update is read-modify-write, so run them one at a time.
  let chain = Promise.resolve();
  const serial = (fn) => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };

  const load = async (runId) => {
    const run = (await idb.runs.getAll()).find((r) => r.id === runId);
    if (!run) throw new Error('Unknown run ' + runId);
    return run;
  };
  const addFile = async (run, kind, f) => {
    const seq = run.nextSeq++;
    await idb.files.put({ id: `${run.id}:${kind}:${seq}`, runId: run.id, kind, seq, lat: f.lat, lng: f.lng, takenAt: f.takenAt, base64: f.base64, sent: false });
    return seq;
  };
  const noPhotos = (run) => { if (run.kind === 'count') throw new Error('A count run takes no photos'); };

  return {
    newRun: (meta) => serial(async () => {
      const d = new Date(now()), reg = String(meta.reg || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
      const tail = Array.from({ length: 4 }, () => ALNUM[Math.floor(rand() * ALNUM.length)]).join('');
      const run = { id: `${reg}-${stamp}-${tail}`, reg, kind: meta.kind, campus: meta.campus, by: meta.by, role: meta.role,
        startedAt: d.getTime(), endedAt: null, status: 'running', error: null, frames: 0, nextSeq: 0, gaps: [], stops: [],
        inspection: meta.inspection, startSent: false, endSent: false };
      await idb.runs.put(run);
      return run;
    }),

    // Frames: timelapse 'frame' photos, or inspection photos on an inspection run. Count runs have no camera.
    addFrame: (runId, frame) => serial(async () => {
      const run = await load(runId); noPhotos(run);
      const seq = await addFile(run, run.kind === 'inspection' ? 'inspection' : 'frame', frame);
      run.frames++;
      await idb.runs.put(run);
      return seq;
    }),

    // A tagged stop. A photo (base64) makes it a 'stop' file; count runs only record the stop in the manifest.
    addStop: (runId, stop) => serial(async () => {
      const run = await load(runId);
      if (stop.base64) { noPhotos(run); stop.seq = await addFile(run, 'stop', stop); } else stop.seq = run.nextSeq++;
      const entry = { seq: stop.seq, lat: stop.lat, lng: stop.lng, takenAt: stop.takenAt };
      run.stops.push(entry);
      await idb.runs.put(run);
      return entry;
    }),

    setCount: (runId, stopSeq, boardOn, boardOff) => serial(async () => {
      const run = await load(runId);
      const stop = run.stops.find((s) => s.seq === stopSeq);
      if (!stop) throw new Error('Unknown stop ' + stopSeq);
      stop.boardOn = boardOn; stop.boardOff = boardOff;
      await idb.runs.put(run);
    }),

    markGap: (runId, from, to) => serial(async () => {
      const run = await load(runId);
      run.gaps.push({ from, to });
      await idb.runs.put(run);
    }),

    endRun: (runId, { inspection } = {}) => serial(async () => {
      const run = await load(runId);
      run.endedAt = now(); run.status = 'ended';
      if (inspection !== undefined) run.inspection = inspection;
      await idb.runs.put(run);
    }),

    // Unsent files of a run, in seq order (a failed file stays here, with its `error`).
    pending: (runId) => serial(async () => (await idb.files.getAll()).filter((f) => f.runId === runId && !f.sent).sort((a, b) => a.seq - b.seq)),
    total: (runId) => serial(async () => (await idb.files.getAll()).filter((f) => f.runId === runId).length),

    markSent: (runId, kind, seq, fileId) => serial(async () => {
      const f = (await idb.files.getAll()).find((x) => x.id === `${runId}:${kind}:${seq}`);
      if (!f) throw new Error('Unknown file');
      f.sent = true; f.fileId = fileId; f.error = null;
      await idb.files.put(f);
    }),
    markFailed: (runId, kind, seq, error) => serial(async () => {
      const f = (await idb.files.getAll()).find((x) => x.id === `${runId}:${kind}:${seq}`);
      if (f) { f.error = error; await idb.files.put(f); }
    }),

    // Merge fields into a run (uploader: startSent/endSent/status/error).
    patchRun: (runId, fields) => serial(async () => { const run = Object.assign(await load(runId), fields); await idb.runs.put(run); return run; }),
    getRun: (runId) => serial(() => load(runId)),
    runs: () => serial(() => idb.runs.getAll()),
  };
}
