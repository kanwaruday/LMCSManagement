// Capture core (coordinator/capture): distance spacing, offline run store, resumable uploader.
// ES modules, so standalone: node tests/transport/test-capture-core.js (verify.mjs runs it that way; under require() it is a no-op).
'use strict';
const assert = require('assert');
if (require.main !== module) { module.exports = () => {}; return; }
let failed = 0;
const test = async (name, fn) => { try { await fn(); console.log('  ok  -', name); } catch (e) { failed++; console.log('  FAIL -', name, '\n       ', e.message); } };

(async () => {
  const dir = '../../coordinator/capture/';
  const { distanceM, shouldCapture, FRAME_SPACING_M } = await import(dir + 'geo.js');
  const { createRunStore } = await import(dir + 'run-store.js');
  const { createUploader } = await import(dir + 'uploader.js');

  const clone = (e) => JSON.parse(JSON.stringify(e));
  const memStore = () => { const m = new Map(); return { m, reads: 0, put: async (e) => { m.set(e.id, clone(e)); }, get: async function (id) { this.reads++; return m.has(id) ? clone(m.get(id)) : undefined; }, getAll: async () => [...m.values()].map(clone), delete: async (id) => { m.delete(id); } }; };
  const memIdb = () => ({ runs: memStore(), files: memStore(), data: memStore() });
  const mkStore = (idb = memIdb(), opts) => createRunStore(idb, opts);
  const NOW = new Date(2026, 9, 25, 7, 5, 9).getTime();
  const mkTimelapse = async (store, n = 0) => {
    const run = await store.newRun({ reg: 'HP-34 B6083', kind: 'timelapse', campus: 'LMS4', by: 'a@b.c', role: 'Coordinator' });
    for (let i = 0; i < n; i++) await store.addFrame(run.id, { lat: 31 + i / 1e4, lng: 76, takenAt: NOW + i, base64: 'AAAA' + i });
    return run;
  };
  const instant = async () => {};
  const never = () => new Promise(() => {});
  const NET = { success: false, network: true, error: 'offline' };

  // ---- geo
  const at = (m) => ({ lat: 31 + m / 111194.9266, lng: 76 }); // m metres north (R = 6371 km)
  await test('FRAME_SPACING_M is 15 and distanceM is haversine', () => {
    assert.strictEqual(FRAME_SPACING_M, 15);
    assert.ok(Math.abs(distanceM({ lat: 31, lng: 76 }, { lat: 32, lng: 76 }) - 111195) < 200);
    assert.strictEqual(distanceM({ lat: 31, lng: 76 }, { lat: 31, lng: 76 }), 0);
  });
  await test('shouldCapture false under 15 m, true at 15 m, false when accuracy 80 m, true for the first fix', () => {
    const last = at(0);
    assert.strictEqual(shouldCapture(last, { ...at(10), accuracy: 5 }), false);
    assert.strictEqual(shouldCapture(last, { ...at(15.5), accuracy: 5 }), true);
    assert.strictEqual(shouldCapture(last, { ...at(40), accuracy: 80 }), false);
    assert.strictEqual(shouldCapture(null, { ...at(0), accuracy: 10 }), true);
    assert.strictEqual(shouldCapture(null, { ...at(0), accuracy: 80 }), false);
  });
  await test('a fix with no or non-finite accuracy is not a good fix', () => {
    for (const accuracy of [undefined, NaN, null, Infinity]) assert.strictEqual(shouldCapture(null, { ...at(0), accuracy }), false, String(accuracy));
    assert.strictEqual(shouldCapture(at(0), { ...at(100) }), false);
  });
  await test('stationary jitter inside the fix accuracy captures nothing; a moving bus at accuracy 10 still captures every 15 m', () => {
    const last = at(0);
    for (const m of [20, 25, 30, 35, 39.5]) assert.strictEqual(shouldCapture(last, { ...at(m), accuracy: 40 }), false, 'wander ' + m);
    assert.strictEqual(shouldCapture(last, { ...at(41), accuracy: 40 }), true);
    let pos = at(0), frames = 0;
    for (let m = 1; m <= 150; m++) { const fix = { ...at(m), accuracy: 10 }; if (shouldCapture(pos, fix)) { frames++; pos = fix; } }
    assert.strictEqual(frames, 10);
  });

  // ---- run store
  await test('runId is <REG>-<yyyyMMdd-HHmmss>-<4 alnum>', async () => {
    const store = mkStore(memIdb(), { now: () => NOW });
    const run = await store.newRun({ reg: 'HP-34 B6083', kind: 'timelapse' });
    assert.ok(/^HP34B6083-20261025-070509-[A-Za-z0-9]{4}$/.test(run.id), run.id);
    assert.strictEqual(run.status, 'running');
    assert.strictEqual((await store.runs()).length, 1);
  });
  await test('markGap is recorded and pending() excludes sent files', async () => {
    const store = mkStore(); const run = await mkTimelapse(store, 3);
    await store.markGap(run.id, 100, 200);
    const stop = await store.addStop(run.id, { lat: 31, lng: 76, takenAt: NOW, base64: 'SSSS' });
    let p = await store.pending(run.id);
    assert.deepStrictEqual(p.map((f) => f.seq), [0, 1, 2, stop.seq]);
    assert.strictEqual(p[3].kind, 'stop');
    await store.markSent(run.id, 'frame', 1, 'F1');
    p = await store.pending(run.id);
    assert.deepStrictEqual(p.map((f) => f.seq), [0, 2, stop.seq]);
    const r = (await store.runs())[0];
    assert.deepStrictEqual(r.gaps, [{ from: 100, to: 200 }]);
    assert.strictEqual(r.frames, 3);
  });
  await test('count runs reject addFrame and photos; setCount fills the stop manifest', async () => {
    const store = mkStore();
    const run = await store.newRun({ reg: 'HP1', kind: 'count' });
    await assert.rejects(() => store.addFrame(run.id, { lat: 0, lng: 0, base64: 'x' }), /count/);
    await assert.rejects(() => store.addStop(run.id, { lat: 0, lng: 0, base64: 'x' }), /count/);
    const stop = await store.addStop(run.id, { lat: 31, lng: 76, takenAt: NOW, name: 'Bhuntar chowk' });
    await store.setCount(run.id, stop.seq, 7, 2);
    const r = (await store.runs())[0];
    assert.deepStrictEqual([r.stops[0].name, r.stops[0].boardOn, r.stops[0].boardOff], ['Bhuntar chowk', 7, 2]);
    assert.strictEqual((await store.pending(run.id)).length, 0);
  });
  await test('concurrent addFrame calls get distinct seq', async () => {
    const store = mkStore(); const run = await store.newRun({ reg: 'HP1', kind: 'timelapse' });
    await Promise.all([0, 1, 2, 3].map((i) => store.addFrame(run.id, { lat: 0, lng: 0, base64: 'x' + i })));
    assert.deepStrictEqual((await store.pending(run.id)).map((f) => f.seq), [0, 1, 2, 3]);
  });


  const fakeServer = (script = () => null) => {
    const calls = [];
    return { calls, post: async (body) => { calls.push(JSON.parse(JSON.stringify(body))); const o = script(body, calls.length); if (o instanceof Error) throw o; return o || (body.action === 'capturefile' ? { success: true, fileId: 'D' + body.seq } : { success: true }); } };
  };
  // ---- store: gaps, purge, storage, photo reads
  await test('markGap validates from <= to', async () => {
    const store = mkStore(); const run = await mkTimelapse(store);
    await assert.rejects(() => store.markGap(run.id, 200, 100), /gap/i);
  });
  await test('open gap survives a reload: re-created store closes it, no frames lost, gap recorded', async () => {
    const idb = memIdb(); let store = mkStore(idb);
    const run = await mkTimelapse(store, 2);
    await store.openGap(run.id, 1000);
    await store.openGap(run.id, 1500); // already open: keeps the earliest start
    store = mkStore(idb); // page reloaded mid-gap
    assert.strictEqual((await store.getRun(run.id)).openGap, 1000);
    await store.closeGap(run.id, 4000);
    await store.addFrame(run.id, { lat: 31, lng: 76, takenAt: 4001, base64: 'Z' });
    await store.endRun(run.id);
    const r = await store.getRun(run.id);
    assert.deepStrictEqual(r.gaps, [{ from: 1000, to: 4000 }]);
    assert.strictEqual(r.frames, 3); assert.strictEqual((await store.pending(run.id)).length, 3); assert.strictEqual(r.openGap, null);
  });
  await test('endRun closes a dangling open gap; recover() does the same for runs left open', async () => {
    const store = mkStore(undefined, { now: () => 9000 }); const run = await mkTimelapse(store, 2); // frames at NOW, NOW+1
    await store.openGap(run.id, 5);
    await store.endRun(run.id);
    assert.deepStrictEqual((await store.getRun(run.id)).gaps, [{ from: 5, to: NOW + 1 }]); // closed at the last frame
    const r2 = await store.newRun({ reg: 'HP2', kind: 'count' });
    await store.openGap(r2.id, 8000);
    await store.endRun(r2.id); // no frames after the gap start: closed at endedAt
    assert.deepStrictEqual((await store.getRun(r2.id)).gaps, [{ from: 8000, to: 9000 }]);
    const r3 = await store.newRun({ reg: 'HP3', kind: 'count' });
    await store.openGap(r3.id, 8500);
    await store.recover();
    const g = (await store.getRun(r3.id)); assert.strictEqual(g.openGap, null); assert.deepStrictEqual(g.gaps, [{ from: 8500, to: 9000 }]);
  });
  await test('frames after endRun are rejected', async () => {
    const store = mkStore(); const run = await mkTimelapse(store, 1); await store.endRun(run.id);
    await assert.rejects(() => store.addFrame(run.id, { lat: 0, lng: 0, base64: 'x' }), /ended/);
  });
  await test('markSent drops the photo data and keeps the metadata row', async () => {
    const idb = memIdb(); const store = mkStore(idb, { now: () => 777 }); const run = await mkTimelapse(store, 2);
    assert.strictEqual(idb.data.m.size, 2);
    await store.markSent(run.id, 'frame', 0, 'F0');
    assert.strictEqual(idb.data.m.size, 1); assert.ok(!idb.data.m.has(`${run.id}:frame:0`));
    const meta = idb.files.m.get(`${run.id}:frame:0`);
    assert.deepStrictEqual([meta.seq, meta.kind, meta.fileId, meta.sentAt, meta.sent, 'base64' in meta], [0, 'frame', 'F0', 777, true, false]);
    assert.strictEqual(await store.total(run.id), 2);
  });
  await test('pending/total/markSent never read photo data; uploading N frames reads each photo once', async () => {
    const idb = memIdb(); const store = mkStore(idb); const run = await mkTimelapse(store, 5); await store.endRun(run.id);
    await store.pending(run.id); await store.total(run.id);
    assert.strictEqual(idb.data.reads, 0);
    await createUploader({ store, post: fakeServer().post, sleep: instant }).start(run.id);
    assert.strictEqual(idb.data.reads, 5);
    assert.strictEqual(idb.data.m.size, 0);
  });
  await test('a quota failure maps to STORAGE_FULL', async () => {
    const idb = memIdb(); const store = mkStore(idb); const run = await mkTimelapse(store, 1);
    idb.data.put = async () => { throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' }); };
    await assert.rejects(() => store.addFrame(run.id, { lat: 0, lng: 0, base64: 'x' }), (e) => e.code === 'STORAGE_FULL' && /full/i.test(e.message));
    idb.data.put = async (e) => { idb.data.m.set(e.id, clone(e)); }; // storage freed: the next frame works and no seq was burnt
    await store.addFrame(run.id, { lat: 0, lng: 0, base64: 'x' });
    assert.deepStrictEqual((await store.pending(run.id)).map((f) => f.seq), [0, 1]);
  });
  await test('storageInfo reports usage/quota and asks for persistence best-effort', async () => {
    let persisted = 0;
    const storage = { estimate: async () => ({ usage: 10, quota: 100 }), persist: async () => { persisted++; return true; } };
    const store = mkStore(memIdb(), { storage });
    assert.deepStrictEqual(await store.storageInfo(), { usage: 10, quota: 100, persisted: true });
    assert.strictEqual(persisted, 1);
    assert.deepStrictEqual(await mkStore(memIdb(), { storage: null }).storageInfo(), { usage: null, quota: null, persisted: false });
  });

  // ---- uploader
  await test('uploads start manifest, files in seq order, end manifest', async () => {
    const store = mkStore(); const run = await mkTimelapse(store, 3);
    await store.markGap(run.id, 1, 2); await store.endRun(run.id);
    const srv = fakeServer();
    await createUploader({ store, post: srv.post, sleep: instant }).start(run.id);
    assert.deepStrictEqual(srv.calls.map((c) => c.action + (c.seq !== undefined ? c.seq : '')), ['capturerun', 'capturefile0', 'capturefile1', 'capturefile2', 'capturerun']);
    const [first, , , , last] = srv.calls;
    assert.strictEqual(first.run.status, 'running'); assert.strictEqual(first.run.kind, 'timelapse'); assert.strictEqual(first.run.reg, 'HP34B6083');
    assert.strictEqual(last.run.status, 'ended'); assert.strictEqual(last.run.frames, 3); assert.deepStrictEqual(last.run.gaps, [{ from: 1, to: 2 }]);
    const f = srv.calls[1];
    assert.strictEqual(f.runKind, 'timelapse'); assert.strictEqual(f.kind, 'frame'); assert.strictEqual(f.runId, run.id); assert.strictEqual(f.reg, 'HP34B6083'); assert.ok(f.base64 && 'lat' in f && 'takenAt' in f);
    assert.strictEqual((await store.pending(run.id)).length, 0);
  });
  await test('uploader resumes after a thrown post: sent files are not re-posted, order kept', async () => {
    const store = mkStore(); const run = await mkTimelapse(store, 4); await store.endRun(run.id);
    const srv = fakeServer((b, n) => (n === 4 ? new Error('Failed to fetch') : null)); // 4th call = frame 2
    const sleeps = [];
    await createUploader({ store, post: srv.post, sleep: async (ms) => { sleeps.push(ms); } }).start(run.id);
    const files = srv.calls.filter((c) => c.action === 'capturefile').map((c) => c.seq);
    assert.deepStrictEqual(files, [0, 1, 2, 2, 3]); // only the failed one repeats
    assert.deepStrictEqual(sleeps, [5000]);
    assert.strictEqual(srv.calls[srv.calls.length - 1].run.status, 'ended');
  });
  await test('a stopped uploader leaves sent files marked; a new one carries on without re-posting them', async () => {
    const store = mkStore(); const run = await mkTimelapse(store, 4); await store.endRun(run.id);
    const srv = fakeServer((b, n) => (n >= 4 ? NET : null));
    let up; up = createUploader({ store, post: srv.post, sleep: () => { up.stop(); return never(); } });
    await up.start(run.id);
    assert.deepStrictEqual((await store.pending(run.id)).map((f) => f.seq), [2, 3]);
    const srv2 = fakeServer();
    await createUploader({ store, post: srv2.post, sleep: instant }).start(run.id);
    assert.deepStrictEqual(srv2.calls.map((c) => c.action + (c.seq !== undefined ? c.seq : '')), ['capturefile2', 'capturefile3', 'capturerun']); // start manifest already sent
  });
  await test('backoff is 5 s, 15 s, 60 s, then waits for online, then starts over', async () => {
    const store = mkStore(); const run = await mkTimelapse(store, 1); await store.endRun(run.id);
    const srv = fakeServer((b, n) => (n >= 2 && n <= 5 ? NET : null)); // file fails 4 times
    const log = [];
    await createUploader({ store, post: srv.post, sleep: async (ms) => { log.push(ms); }, waitOnline: async () => { log.push('online'); } }).start(run.id);
    assert.deepStrictEqual(log, [5000, 15000, 60000, 'online']);
    assert.strictEqual(srv.calls.filter((c) => c.action === 'capturefile').length, 5);
  });
  await test('progress reports sent/total', async () => {
    const store = mkStore(); const run = await mkTimelapse(store, 3);
    const seen = [];
    await createUploader({ store, post: fakeServer().post, sleep: instant, onProgress: (p) => seen.push(p) }).start(run.id);
    assert.deepStrictEqual(seen.map((p) => [p.sent, p.total]).filter((x, i, a) => i === 0 || x[0] !== a[i - 1][0]), [[0, 3], [1, 3], [2, 3], [3, 3]]);
    assert.strictEqual(seen[0].runId, run.id);
  });
  await test('a permanent refusal marks the file failed, stops the run with status error, no endless retry', async () => {
    const store = mkStore(); const run = await mkTimelapse(store, 3); await store.endRun(run.id);
    const srv = fakeServer((b) => (b.action === 'capturefile' && b.seq === 1 ? { success: false, error: 'This run belongs to another bus (HP9)' } : null));
    const seen = [];
    await createUploader({ store, post: srv.post, sleep: instant, onProgress: (p) => seen.push(p) }).start(run.id);
    assert.deepStrictEqual(srv.calls.map((c) => c.action + (c.seq !== undefined ? c.seq : '')), ['capturerun', 'capturefile0', 'capturefile1']);
    const r = (await store.runs())[0];
    assert.strictEqual(r.status, 'error'); assert.ok(/another bus/.test(r.error));
    const bad = (await store.pending(run.id)).find((f) => f.seq === 1);
    assert.ok(/another bus/.test(bad.error));
    assert.strictEqual(seen[seen.length - 1].state, 'error');
  });
  await test('the end manifest of a timelapse carries frameTimes: seconds since the start per seq, null where the seq is a stop', async () => {
    const store = mkStore(memIdb(), { now: () => NOW }); const run = await store.newRun({ reg: 'HP1', kind: 'timelapse' });
    await store.addFrame(run.id, { lat: 31, lng: 76, takenAt: NOW + 400, base64: 'AA' });          // seq 0, 0.4 s
    await store.addStop(run.id, { lat: 31, lng: 76, takenAt: NOW + 20000, base64: 'BB' });        // seq 1, a stop photo
    await store.addFrame(run.id, { lat: 31, lng: 76, takenAt: NOW + 31600, base64: 'CC' });       // seq 2, 31.6 s
    assert.deepStrictEqual(await store.frameTimes(run.id), [0, null, 32]);
    await store.endRun(run.id);
    const srv = fakeServer();
    await createUploader({ store, post: srv.post, sleep: instant }).start(run.id);
    const runs = srv.calls.filter((c) => c.action === 'capturerun');
    assert.ok(!('frameTimes' in runs[0].run), 'the start manifest has none');
    assert.deepStrictEqual(runs[1].run.frameTimes, [0, null, 32]);
    const c = mkStore(); const cr = await c.newRun({ reg: 'HP1', kind: 'count' }); await c.endRun(cr.id);
    const srv2 = fakeServer(); await createUploader({ store: c, post: srv2.post, sleep: instant }).start(cr.id);
    assert.ok(!srv2.calls.some((x) => x.run && 'frameTimes' in x.run), 'a count run has no frames, so no frameTimes');
  });
  await test('count run uploads start and end manifests only, with stops and counts', async () => {
    const store = mkStore(); const run = await store.newRun({ reg: 'HP1', kind: 'count' });
    const s = await store.addStop(run.id, { lat: 31, lng: 76, takenAt: NOW }); await store.setCount(run.id, s.seq, 4, 1); await store.endRun(run.id);
    const srv = fakeServer();
    await createUploader({ store, post: srv.post, sleep: instant }).start(run.id);
    assert.deepStrictEqual(srv.calls.map((c) => [c.action, c.run.status]), [['capturerun', 'running'], ['capturerun', 'ended']]);
    assert.strictEqual(srv.calls[1].run.stops[0].boardOn, 4);
    assert.ok(!JSON.stringify(srv.calls).includes('base64'));
  });
  await test('a run still being recorded uploads files but is not marked ended', async () => {
    const store = mkStore(); const run = await mkTimelapse(store, 2);
    const srv = fakeServer();
    await createUploader({ store, post: srv.post, sleep: instant }).start(run.id);
    assert.deepStrictEqual(srv.calls.map((c) => c.action), ['capturerun', 'capturefile', 'capturefile']);
  });

  await test('endRun during an upload still sends the end manifest; a frame added mid-upload is sent', async () => {
    const store = mkStore(); const run = await mkTimelapse(store, 2);
    const srv = fakeServer();
    let did = false;
    const post = async (b) => {
      if (b.action === 'capturefile' && b.seq === 0 && !did) { did = true; await store.addFrame(run.id, { lat: 31, lng: 76, takenAt: NOW + 9, base64: 'LATE' }); await store.endRun(run.id); }
      return srv.post(b);
    };
    await createUploader({ store, post, sleep: instant }).start(run.id);
    assert.deepStrictEqual(srv.calls.map((c) => c.action + (c.seq !== undefined ? c.seq : '')), ['capturerun', 'capturefile0', 'capturefile1', 'capturefile2', 'capturerun']);
    assert.strictEqual(srv.calls[4].run.status, 'ended'); assert.strictEqual(srv.calls[4].run.frames, 3);
  });
  await test('start() during an in-flight upload re-runs once the pass settles, so a late End sends the end manifest', async () => {
    const store = mkStore(); const run = await mkTimelapse(store, 1);
    const srv = fakeServer(); let up;
    up = createUploader({ store, post: srv.post, sleep: instant, onProgress: (p) => {
      if (p.state === 'uploaded-so-far' && !srv.ended) { srv.ended = true; store.endRun(run.id); up.start(run.id); } // user taps End as the pass finishes
    } });
    await up.start(run.id);
    assert.deepStrictEqual(srv.calls.map((c) => c.action), ['capturerun', 'capturefile', 'capturerun']);
    assert.strictEqual(srv.calls[2].run.status, 'ended');
  });
  await test('an inspection run sends its photos as kind inspection and its answers with each photo\'s Drive file id', async () => {
    const store = mkStore(); const run = await store.newRun({ reg: 'HP1', kind: 'inspection' });
    const a = await store.addFrame(run.id, { takenAt: NOW, base64: 'FIRE' }), b = await store.addFrame(run.id, { takenAt: NOW + 1, base64: 'KIT' });
    await store.endRun(run.id, { inspection: { fire_extinguisher: { ok: true, date: '2026-09-01', seq: a }, first_aid: { ok: true, seq: b }, door_lock: { ok: false } } });
    const srv = fakeServer();
    await createUploader({ store, post: srv.post, sleep: instant }).start(run.id);
    assert.deepStrictEqual(srv.calls.map((c) => c.action + ':' + (c.kind || c.run.status)), ['capturerun:running', 'capturefile:inspection', 'capturefile:inspection', 'capturerun:ended']);
    const ids = srv.calls.filter((c) => c.action === 'capturefile').map((c) => 'D' + c.seq); // fakeServer answers fileId D<seq>
    assert.deepStrictEqual(srv.calls[3].run.inspection, { fire_extinguisher: { ok: true, date: '2026-09-01', fileId: ids[0] }, first_aid: { ok: true, fileId: ids[1] }, door_lock: { ok: false } });
  });
  await test('an inspection photo that was retaken or answered No is dropped before upload; only current photos are sent', async () => {
    const idb = memIdb(), store = mkStore(idb); const run = await store.newRun({ reg: 'HP1', kind: 'inspection' });
    const old = await store.addFrame(run.id, { takenAt: NOW, base64: 'OLD' }), cur = await store.addFrame(run.id, { takenAt: NOW + 1, base64: 'NEW' });
    const no = await store.addFrame(run.id, { takenAt: NOW + 2, base64: 'GONE' });
    await store.dropFile(run.id, 'inspection', old); await store.dropFile(run.id, 'inspection', no);
    assert.deepStrictEqual([idb.data.m.size, idb.files.m.size, (await store.getRun(run.id)).frames], [1, 1, 1], 'photo and its row are gone');
    await store.endRun(run.id, { inspection: { first_aid: { ok: true, seq: cur }, cctv: { ok: false } } });
    const srv = fakeServer();
    await createUploader({ store, post: srv.post, sleep: instant }).start(run.id);
    assert.deepStrictEqual(srv.calls.filter((c) => c.action === 'capturefile').map((c) => c.base64), ['NEW']);
  });
  await test('an unfinished inspection uploads nothing; discard removes the run and its photos', async () => {
    const idb = memIdb(), store = mkStore(idb); const run = await store.newRun({ reg: 'HP1', kind: 'inspection' });
    await store.addFrame(run.id, { takenAt: NOW, base64: 'MAYBE' });
    const srv = fakeServer(), states = [];
    await createUploader({ store, post: srv.post, sleep: instant, onProgress: (p) => states.push(p.state) }).start(run.id);
    assert.deepStrictEqual([srv.calls.length, states.slice(-1)[0]], [0, 'not-ended'], 'nothing leaves the phone before the check is saved');
    await store.discard(run.id);
    assert.deepStrictEqual([idb.runs.m.size, idb.files.m.size, idb.data.m.size], [0, 0, 0]);
  });

  process.exit(failed ? 1 : 0);
})();
