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

  const memStore = () => { const m = new Map(); return { put: async (e) => { m.set(e.id, JSON.parse(JSON.stringify(e))); }, getAll: async () => [...m.values()].map((e) => JSON.parse(JSON.stringify(e))), delete: async (id) => { m.delete(id); } }; };
  const mkStore = () => createRunStore({ runs: memStore(), files: memStore() });
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
  const at = (m) => ({ lat: 31 + m / 111195, lng: 76 }); // ~m metres north
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

  // ---- run store
  await test('runId is <REG>-<yyyyMMdd-HHmmss>-<4 alnum>', async () => {
    const store = createRunStore({ runs: memStore(), files: memStore() }, { now: () => NOW });
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
    const stop = await store.addStop(run.id, { lat: 31, lng: 76, takenAt: NOW });
    await store.setCount(run.id, stop.seq, 7, 2);
    const r = (await store.runs())[0];
    assert.deepStrictEqual([r.stops[0].boardOn, r.stops[0].boardOff], [7, 2]);
    assert.strictEqual((await store.pending(run.id)).length, 0);
  });
  await test('concurrent addFrame calls get distinct seq', async () => {
    const store = mkStore(); const run = await store.newRun({ reg: 'HP1', kind: 'timelapse' });
    await Promise.all([0, 1, 2, 3].map((i) => store.addFrame(run.id, { lat: 0, lng: 0, base64: 'x' + i })));
    assert.deepStrictEqual((await store.pending(run.id)).map((f) => f.seq), [0, 1, 2, 3]);
  });

  // ---- uploader
  const fakeServer = (script = () => null) => {
    const calls = [];
    return { calls, post: async (body) => { calls.push(JSON.parse(JSON.stringify(body))); const o = script(body, calls.length); if (o instanceof Error) throw o; return o || (body.action === 'capturefile' ? { success: true, fileId: 'D' + body.seq } : { success: true }); } };
  };
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

  process.exit(failed ? 1 : 0);
})();
