// apps-script/proof-mirror.gs: the Roster's 10-minute copy of lms-game document proofs to Drive. Runs the real .gs in a vm with a
// fake Edge Function (UrlFetchApp) and a fake Drive. Synthetic items only; one synthetic PDF mirrored end to end.
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../../apps-script/proof-mirror.gs'), 'utf8');

let nextId = 0;
function folder(name) {
  const kids = [], files = [];
  return { name, kids, files, getId: () => 'F_' + name,
    getFoldersByName(n) { const m = kids.filter((k) => k.name === n); let i = 0; return { hasNext: () => i < m.length, next: () => m[i++] }; },
    createFolder(n) { const f = folder(n); kids.push(f); return f; },
    getFilesByName(n) { const m = files.filter((k) => k.name === n); let i = 0; return { hasNext: () => i < m.length, next: () => m[i++] }; },
    createFile(blob) { const f = { name: blob.name, bytes: blob.bytes, getId: () => f.id, id: 'DRIVEid' + String(++nextId).padStart(8, '0') }; files.push(f); return f; } };
}
const PDF = Buffer.from('%PDF-1.4\n% synthetic test file\n%%EOF\n');
function setup({ props, items, failFetch = false, failWrite = 0, listCode = 200 } = {}) {
  const roots = { normal: folder('ROOT'), owner: folder('OWNER') }, calls = [], logs = [], backs = [];
  const P = Object.assign({ PROOF_MIRROR_URL: 'https://stub.invalid/functions/v1/proof-mirror', PROOF_MIRROR_KEY: 'k'.repeat(48), PROOF_MIRROR_ROOT: 'root-n', PROOF_MIRROR_OWNER_ROOT: 'root-o' }, props);
  let writes = 0, locked = false;
  const resp = (code, body, bytes) => ({ getResponseCode: () => code, getContentText: () => body, getBlob: () => ({ bytes, name: '', setName(n) { this.name = n; return this; } }) });
  const ctx = { console: { log: (m) => logs.push(m), error: (m) => logs.push(m) }, Date, JSON, String, Array,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => P[k] ?? null }) },
    LockService: { getScriptLock: () => ({ tryLock: () => !locked && (locked = true), releaseLock: () => { locked = false; } }) },
    DriveApp: { getFolderById: (id) => (id === 'root-o' ? roots.owner : roots.normal) },
    UrlFetchApp: { fetch(u, o = {}) {
      calls.push({ u, method: o.method || 'get', key: o.headers && o.headers['x-mirror-key'] });
      if (u === P.PROOF_MIRROR_URL && (o.method || 'get') === 'get') return resp(listCode, JSON.stringify({ items }));
      if (u === P.PROOF_MIRROR_URL && o.method === 'post') { writes++; if (writes <= failWrite) return resp(500, '{}'); backs.push(JSON.parse(o.payload)); return resp(200, '{"ok":true}'); }
      return failFetch ? resp(403, '') : resp(200, '', PDF);
    } },
    ScriptApp: { triggers: [], getProjectTriggers() { return this.triggers; }, deleteTrigger(t) { this.triggers = this.triggers.filter((x) => x !== t); },
      newTrigger(fn) { const self = this, t = { fn, every: 0, getHandlerFunction: () => fn }; return { timeBased: () => ({ everyMinutes: (m) => ({ create: () => { t.every = m; self.triggers.push(t); return t; } }) }) }; } } };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { ctx, roots, calls, logs, backs, run: () => JSON.parse(JSON.stringify(vm.runInContext('mirrorProofs()', ctx))) };
}
const item = (o) => Object.assign({ path: 'T/C/Q/photo/1.pdf', url: 'https://stub.invalid/sign/1?ttl=600', school: 'LMS4', year: '2026-27', quest: 'Performance list', step: 'Photo of the list (F14)', file: '1.pdf', ownerOnly: false }, o);
const find = (root, ...names) => names.reduce((f, n) => f && f.kids.find((k) => k.name === n), root);

// 1. end to end: one synthetic PDF saved under <School>/<Year>/<Quest>/<step> – <file>, the Drive id written back, the key in a header
{
  const t = setup({ items: [item()] });
  assert.deepStrictEqual(t.run(), { listed: 1, saved: 1, failed: 0 });
  const q = find(t.roots.normal, 'LMS4', '2026-27', 'Performance list');
  assert.ok(q, 'folder path made');
  assert.strictEqual(q.files[0].name, 'Photo of the list (F14) – 1.pdf');
  assert.ok(Buffer.from(q.files[0].bytes).subarray(0, 5).equals(Buffer.from('%PDF-')));
  assert.deepStrictEqual(t.backs, [{ object_path: 'T/C/Q/photo/1.pdf', drive_file_id: q.files[0].id }]);
  assert.ok(t.calls.filter((c) => c.u.includes('proof-mirror')).every((c) => c.key === 'k'.repeat(48)), 'key sent as a header');
  assert.ok(t.calls.every((c) => !c.u.includes('k'.repeat(48))), 'key never in a URL');
  console.log('  mirrored 1 synthetic PDF → Drive id ' + q.files[0].id);
}
// 2. owner_only goes under the Owner root only
{
  const t = setup({ items: [item({ ownerOnly: true })] });
  t.run();
  assert.ok(find(t.roots.owner, 'LMS4', '2026-27', 'Performance list'));
  assert.strictEqual(t.roots.normal.kids.length, 0);
}
// 3. a failed write-back leaves the copy; the next run finds it by name and sends the same id (no second copy)
{
  const t = setup({ items: [item()], failWrite: 1 });
  assert.deepStrictEqual(t.run(), { listed: 1, saved: 0, failed: 1 });
  assert.deepStrictEqual(t.run(), { listed: 1, saved: 1, failed: 0 });
  const q = find(t.roots.normal, 'LMS4', '2026-27', 'Performance list');
  assert.strictEqual(q.files.length, 1);
  assert.strictEqual(t.backs[0].drive_file_id, q.files[0].id);
}
// 4. logs carry codes only: no school, quest, step, file or path, even on failure; a failing item doesn't stop the rest
{
  const t = setup({ items: [item({ url: 'http://not-https/x' }), item({ path: 'T/C/Q/photo/2.pdf', file: '2.pdf' })], failFetch: true });
  assert.deepStrictEqual(t.run(), { listed: 2, saved: 0, failed: 2 });
  const all = t.logs.join('\n');
  for (const s of ['LMS4', 'Performance', 'F14', '1.pdf', '2.pdf', 'T/C/Q']) assert.ok(!all.includes(s), 'log leaks ' + s);
  assert.ok(/proof-mirror: item_shape/.test(all) && /proof-mirror: fetch 403/.test(all));
}
// 5. unconfigured, refused list, bad shape: nothing saved, one code logged; at most 50 items a run
{
  for (const [opts, code] of [[{ props: { PROOF_MIRROR_OWNER_ROOT: '' } }, 'not_configured'], [{ props: { PROOF_MIRROR_URL: 'http://x' } }, 'not_configured'],
    [{ listCode: 401 }, 'list 401'], [{ items: 'nope' }, 'list_shape']]) {
    const t = setup(Object.assign({ items: [item()] }, opts));
    assert.deepStrictEqual(t.run(), { listed: 0, saved: 0, failed: 0 });
    assert.ok(t.logs.includes('proof-mirror: ' + code), code);
  }
  const t = setup({ items: Array.from({ length: 60 }, (_, i) => item({ path: 'p' + i, file: i + '.pdf' })) });
  assert.strictEqual(t.run().listed, 50);
}
// 6. names: slashes and control characters become spaces; an empty name is 'Untitled'; long names cut at 120
{
  const t = setup({ items: [item({ quest: 'A/B\\C\u0001', step: '', file: '' })] });
  t.run();
  assert.ok(find(t.roots.normal, 'LMS4', '2026-27', 'A B C'));
  assert.strictEqual(vm.runInContext('pmName_("")', t.ctx), 'Untitled');
  assert.strictEqual(vm.runInContext('pmName_("x".repeat(300))', t.ctx).length, 120);
}
// 7. installMirrorTrigger: one 10-minute trigger, replacing an earlier one
{
  const t = setup({ items: [] });
  vm.runInContext('installMirrorTrigger(); installMirrorTrigger();', t.ctx);
  assert.strictEqual(t.ctx.ScriptApp.triggers.length, 1);
  assert.strictEqual(t.ctx.ScriptApp.triggers[0].every, 10);
}
console.log('proof-mirror.gs: all 7 groups passed');
