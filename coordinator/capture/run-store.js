// Offline run store: everything a capture run records stays on the phone until the uploader sends it.
// idb = { runs, files, data }, each a {put, get, getAll, delete} adapter keyed by `id` (office/js/idb-store.js shape plus get).
// Photos live in their own store (`data`, {id, base64}) apart from the small `files` metadata rows, so listing, counting and
// marking files never loads a photo; a photo is read only when it is uploaded and deleted as soon as it is sent.
// createCaptureIdb() builds the real triple on one IndexedDB database; tests pass in-memory fakes.
//
// run:  { id, reg, kind: timelapse|count|inspection, campus, by, role, startedAt, endedAt, status: running|ended|error,
//         error, frames, nextSeq, gaps: [{from,to}], openGap: null|ms, stops: [{seq,lat,lng,takenAt,name,boardOn,boardOff}],
//         inspection, draft (capture page: the safety check being filled in), startSent, endSent }
// file: { id: '<runId>:<kind>:<seq>', runId, kind: frame|stop|inspection, seq, lat, lng, takenAt, sent, fileId, sentAt, error }
// seq is one counter per run across kinds, so it is also the capture order.

export function createCaptureIdb(dbName = 'lmcs-capture') {
  const db = new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => { for (const s of ['capture-runs', 'capture-files', 'capture-data']) req.result.createObjectStore(s, { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const adapter = (storeName) => {
    const run = async (mode, op) => {
      const tx = (await db).transaction(storeName, mode);
      const req = op(tx.objectStore(storeName));
      return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(req.result); tx.onerror = tx.onabort = () => reject(tx.error); });
    };
    return { put: (e) => run('readwrite', (s) => s.put(e)), get: (id) => run('readonly', (s) => s.get(id)),
      getAll: () => run('readonly', (s) => s.getAll()), delete: (id) => run('readwrite', (s) => s.delete(id)) };
  };
  return { runs: adapter('capture-runs'), files: adapter('capture-files'), data: adapter('capture-data') };
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
const ALNUM = 'abcdefghijklmnopqrstuvwxyz0123456789';
const fileId = (runId, kind, seq) => `${runId}:${kind}:${seq}`;

// Out of phone storage surfaces as an error with code STORAGE_FULL, which the page can show ("free some space, then carry on").
const isQuota = (e) => e && (e.name === 'QuotaExceededError' || e.code === 22);
const storageFull = (cause) => Object.assign(new Error('Phone storage is full: free some space (upload on Wi-Fi, delete photos or apps)'), { code: 'STORAGE_FULL', cause });

export function createRunStore(idb, { now = () => Date.now(), rand = Math.random, storage = typeof navigator !== 'undefined' ? navigator.storage : null } = {}) {
  // Every update is read-modify-write, so run them one at a time.
  let chain = Promise.resolve();
  const serial = (fn) => {
    const p = chain.then(fn).catch((e) => { throw isQuota(e) ? storageFull(e) : e; });
    chain = p.catch(() => {});
    return p;
  };

  const load = async (runId) => {
    const run = await idb.runs.get(runId);
    if (!run) throw new Error('Unknown run ' + runId);
    return run;
  };
  const filesOf = async (runId) => (await idb.files.getAll()).filter((f) => f.runId === runId);
  const addFile = async (run, kind, f) => {
    if (!f.base64) throw new Error('Photo missing');
    const seq = run.nextSeq++, id = fileId(run.id, kind, seq);
    await idb.data.put({ id, base64: f.base64 });
    try { await idb.files.put({ id, runId: run.id, kind, seq, lat: f.lat, lng: f.lng, takenAt: f.takenAt, sent: false }); }
    catch (e) { await idb.data.delete(id).catch(() => {}); throw e; }
    return seq;
  };
  const noPhotos = (run) => { if (run.kind === 'count') throw new Error('A count run takes no photos'); };
  const open = (run) => { if (run.endedAt) throw new Error('This run has ended'); };
  const pushGap = (run, from, to) => {
    if (!(from <= to)) throw new Error(`Bad gap: from ${from} is after to ${to}`);
    run.gaps.push({ from, to });
  };
  // A gap still open when the run ends (page hidden and never returned) closes at the last frame's time, or at endedAt
  // when nothing was captured after it began. ponytail: the gap's true end is unknowable; this keeps the manifest well-formed.
  const closeDangling = async (run) => {
    if (run.openGap == null) return;
    const last = Math.max(...(await filesOf(run.id)).map((f) => f.takenAt || 0), 0);
    pushGap(run, run.openGap, last > run.openGap ? last : (run.endedAt ?? now()));
    run.openGap = null;
  };

  return {
    newRun: (meta) => serial(async () => {
      const d = new Date(now()), reg = String(meta.reg || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
      const tail = Array.from({ length: 4 }, () => ALNUM[Math.floor(rand() * ALNUM.length)]).join('');
      const run = { id: `${reg}-${stamp}-${tail}`, reg, kind: meta.kind, campus: meta.campus, by: meta.by, role: meta.role,
        startedAt: d.getTime(), endedAt: null, status: 'running', error: null, frames: 0, nextSeq: 0, gaps: [], openGap: null, stops: [],
        inspection: meta.inspection, startSent: false, endSent: false };
      await idb.runs.put(run);
      return run;
    }),

    // Frames: timelapse 'frame' photos, or inspection photos on an inspection run. Count runs have no camera.
    addFrame: (runId, frame) => serial(async () => {
      const run = await load(runId); noPhotos(run); open(run);
      const seq = await addFile(run, run.kind === 'inspection' ? 'inspection' : 'frame', frame);
      run.frames++;
      await idb.runs.put(run);
      return seq;
    }),

    // A tagged stop. A photo (base64) makes it a 'stop' file; count runs only record the stop in the manifest.
    addStop: (runId, stop) => serial(async () => {
      const run = await load(runId); open(run);
      let seq;
      if (stop.base64) { noPhotos(run); seq = await addFile(run, 'stop', stop); } else seq = run.nextSeq++;
      const entry = { seq, lat: stop.lat, lng: stop.lng, takenAt: stop.takenAt };
      if (stop.name) entry.name = String(stop.name); // the stop's name as picked or typed on the capture page
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

    // Gaps: the page was hidden or the GPS was lost, so frames may be missing. openGap persists the start at once (call it on
    // visibilitychange/hide), so a reload or a killed tab still leaves the gap on record; closeGap(at) records it on return.
    markGap: (runId, from, to) => serial(async () => { const run = await load(runId); pushGap(run, from, to); await idb.runs.put(run); }),
    openGap: (runId, at) => serial(async () => {
      const run = await load(runId);
      if (run.openGap == null) { run.openGap = at; await idb.runs.put(run); } // already open: keep the earliest start
    }),
    closeGap: (runId, at) => serial(async () => {
      const run = await load(runId);
      if (run.openGap == null) return;
      pushGap(run, run.openGap, Math.max(at, run.openGap)); run.openGap = null;
      await idb.runs.put(run);
    }),
    // Call on page load: closes dangling open gaps of every run (see closeDangling).
    recover: () => serial(async () => {
      for (const run of await idb.runs.getAll()) if (run.openGap != null) { await closeDangling(run); await idb.runs.put(run); }
    }),

    endRun: (runId, { inspection } = {}) => serial(async () => {
      const run = await load(runId);
      if (run.endedAt) return;
      run.endedAt = now(); run.status = 'ended';
      await closeDangling(run);
      if (inspection !== undefined) run.inspection = inspection;
      await idb.runs.put(run);
    }),

    // Unsent file metadata of a run, in seq order (a failed file stays here, with its `error`). Photos are not loaded.
    pending: (runId) => serial(async () => (await filesOf(runId)).filter((f) => !f.sent).sort((a, b) => a.seq - b.seq)),
    total: (runId) => serial(async () => (await filesOf(runId)).length),
    // {seq: Drive file id} of the run's sent files (the inspection answers point at their photos by seq on the phone).
    fileIds: (runId) => serial(async () => Object.fromEntries((await filesOf(runId)).filter((f) => f.sent).map((f) => [f.seq, f.fileId]))),
    // The one place a photo is read: its base64, or undefined once it was sent.
    fileData: (runId, kind, seq) => serial(async () => (await idb.data.get(fileId(runId, kind, seq)))?.base64),

    // Sent: keep the metadata row (seq, kind, fileId, sentAt), drop the photo.
    markSent: (runId, kind, seq, serverFileId) => serial(async () => {
      const id = fileId(runId, kind, seq), f = await idb.files.get(id);
      if (!f) throw new Error('Unknown file');
      Object.assign(f, { sent: true, fileId: serverFileId, sentAt: now(), error: null });
      await idb.files.put(f);
      await idb.data.delete(id);
    }),
    markFailed: (runId, kind, seq, error) => serial(async () => {
      const f = await idb.files.get(fileId(runId, kind, seq));
      if (f) { f.error = error; await idb.files.put(f); }
    }),

    // Merge fields into a run (uploader: startSent/endSent/status/error).
    patchRun: (runId, fields) => serial(async () => { const run = Object.assign(await load(runId), fields); await idb.runs.put(run); return run; }),
    getRun: (runId) => serial(() => load(runId)),
    runs: () => serial(() => idb.runs.getAll()),

    // For the page to show: how full the phone is. Also asks the browser (best effort, once) not to evict our data.
    storageInfo: async () => {
      if (!storage || !storage.estimate) return { usage: null, quota: null, persisted: false };
      let persisted = false;
      try { persisted = !!(storage.persist && await storage.persist()); } catch (e) { /* best effort */ }
      try { const { usage, quota } = await storage.estimate(); return { usage, quota, persisted }; } catch (e) { return { usage: null, quota: null, persisted }; }
    },
  };
}
