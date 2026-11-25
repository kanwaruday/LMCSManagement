// (game T3 copy of its harness) apps-script/transport-capture.gs: who may upload a capture frame/stop/inspection photo, idempotency on (runId,kind,seq),
// the 2 MB image cap, count runs taking no frames, and the Capture Runs manifest upsert.
// Runs the real .gs (plus transport-uploads.gs and staff-documents.gs, which it reuses) in a vm with stubbed Drive and Sheets.
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const KEY = 'g'.repeat(48);
const gs = (f) => fs.readFileSync(path.join(__dirname, '../../apps-script', f), 'utf8').replace(/^const /gm, 'var ');

function folder(name) {
  const kids = [], files = [], id = 'DIR' + (nextDir++);
  const me = { name, kids, files, trashed: false, getName: () => name, getId: () => id, isTrashed: () => me.trashed, setTrashed(v) { me.trashed = v; },
    getFoldersByName(n) { const m = kids.filter((k) => k.name === n); let i = 0; return { hasNext: () => i < m.length, next: () => m[i++] }; },
    getFilesByName(n) { const m = files.filter((f) => f.name === n); let i = 0; return { hasNext: () => i < m.length, next: () => m[i++] }; },
    createFolder(n) { const f = folder(n); kids.push(f); dirs[f.getId()] = f; return f; },
    getFiles() { let i = 0; return { hasNext: () => i < files.length, next: () => files[i++] }; },
    setTrashed(v) { me.trashed = v; return me; },
    createFile(blob, text, mime) { // (blob) as uploads do, or (name, text, mime) as capturerun's path.json
      if (typeof blob === 'string') blob = { name: blob, bytes: Array.from(Buffer.from(text || '')), mime };
      const id = 'FILE' + (nextId++) + 'x'.repeat(20);
      const f = { name: blob.name, blob, desc: '', getId: () => id, getName: () => f.name, getDescription: () => f.desc, setDescription(d) { f.desc = d; },
        getBlob: () => ({ getBytes: () => blob.bytes || [], getDataAsString: () => Buffer.from(blob.bytes || []).toString() }) };
      files.push(f); return f;
    } };
  return me;
}
let nextId = 1, nextDir = 1;
const dirs = {};
const root = folder('LMS Central Repository');
const transport = root.createFolder('LMCS Repository').createFolder('Important Documents @ LMCS').createFolder('Important Documents Transport');
transport.createFolder('Bus Wise Documents');
const tabs = {
  'LM Studio Fleet': [['Reg', 'Bus', 'Campus'], ['HP659511', 'Bus 4', 'LMS 4'], ['HP665805', 'Bus 1', 'LMS 1'], ['HP665686', 'Bus 5', 'LMS 4']],
};
const mkSheet = (n) => ({ appendRow: (r) => tabs[n].push(r), setFrozenRows() {}, getLastColumn: () => Math.max(0, ...tabs[n].map((r) => r.length)),
  getDataRange: () => ({ getValues: () => tabs[n].map((r) => r.slice()) }),
  getRange: (r, c, nr, nc) => ({ setFontWeight() {}, setValues: (v) => { tabs[n][r - 1] = (tabs[n][r - 1] || []).slice(0, c - 1).concat(v[0]); },
    setValue: (v) => { tabs[n][r - 1][c - 1] = v; } }) });
const ss = { getSheetByName: (n) => tabs[n] ? mkSheet(n) : null, insertSheet(n) { tabs[n] = []; return mkSheet(n); } };
let caller = null, fetchStub = () => { throw new Error('no fetch'); };
const cache = {};
const ctx = { console, Date, Object, String, Math, JSON, Array, Number, RegExp,
  SpreadsheetApp: { openById: () => ss },
  DriveApp: { getFolderById: (id) => { if (id === 'root') return root; if (!dirs[id]) throw new Error('No item with the given ID'); return dirs[id]; } },
  CacheService: { getScriptCache: () => ({ get: (k) => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Utilities: { base64Decode: (s) => Array.from(Buffer.from(s, 'base64')).map((b) => (b > 127 ? b - 256 : b)),
    newBlob: (bytes, mime, name) => ({ bytes, mime, name, getDataAsString: () => Buffer.from(bytes.map((b) => b & 255)).toString() }), formatDate: () => 'x',
    computeHmacSha256Signature: (v, k) => require('crypto').createHmac('sha256', k).update(v).digest(),
    base64EncodeWebSafe: (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'), base64Encode: (b) => Buffer.from(b).toString('base64'),
    base64DecodeWebSafe: (x) => Array.from(Buffer.from(x.replace(/-/g, '+').replace(/_/g, '/'), 'base64')), newBlob2: null, getUuid: () => require('crypto').randomUUID() },
  UrlFetchApp: { fetch: (url, o) => fetchStub(url, o) }, ScriptApp: { getService: () => ({ getUrl: () => 'https://x' }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => ({ TRANSPORT_PUSH_SECRET: 'S', ROSTER_GAME_KEY: KEY, CAPTURE_DRIVE_URL: 'https://stub.invalid/capture-drive', ROSTER_WEBAPP_URL: 'https://script.google.com/macros/s/ROSTER/exec' })[k] || null }) },
  verifyStaffManagerToken_: () => caller, CENTRAL_REPO_FOLDER_ID_: 'root',
  getSubfolder_: (p, n) => { const it = p.getFoldersByName(n); return it.hasNext() ? it.next() : null; } };
vm.createContext(ctx);
vm.runInContext(gs('staff-documents.gs').split('\n').filter((l) => /^var SDOC_(MAX_BYTES|MIME_EXT)_/.test(l)).join('\n'), ctx);
vm.runInContext(gs('transport-uploads.gs'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../assets/game/bus-chain.js'), 'utf8'), ctx);
vm.runInContext(gs('af-video.gs'), ctx);
vm.runInContext(gs('transport-capture.gs'), ctx);
vm.runInContext(gs('driver-token.gs'), ctx); // dlkStaff_ is the real role test; dlkLink_ is stubbed below where a driver phone sends

const run = (code) => JSON.parse(JSON.stringify(vm.runInContext(code, ctx)));
const b64 = (hex, pad) => Buffer.concat([Buffer.from(hex.replace(/ /g, ''), 'hex'), Buffer.alloc(pad || 8)]).toString('base64');
const JPG = b64('FF D8 FF E0'), PDF = b64('25 50 44 46 2D');
const frame = (o) => run('captureFile_(' + JSON.stringify(Object.assign({ idToken: 't', reg: 'HP659511', runId: 'R1', runKind: 'timelapse', kind: 'frame', seq: 1, lat: 31.5, lng: 76.9, takenAt: '2026-10-25T08:00:00Z', base64: JPG }, o)) + ')');
const runDirOf = (id) => transport.kids.find((k) => k.name === 'Capture').kids.find((k) => k.name === 'HP659511').kids.find((k) => k.name === id);

// ── the game's capture actions (T3): one ticket per run; the server decides the bus; the same Drive layout ──
const BUS = '0b6f3c1e-2a4d-4e8f-9a1b-3c5d7e9f1a2b', BUS2 = '1b6f3c1e-2a4d-4e8f-9a1b-3c5d7e9f1a2b', ME = 'driver@test.invalid', STAFF = 'coord@test.invalid';
const drive = {};   // email|bus -> capture-drive's answer
let asked = [];
fetchStub = (url, o) => {
  assert.strictEqual(o.headers['x-roster-key'], KEY);
  const b = JSON.parse(o.payload); asked.push(b);
  const r = drive[b.email + '|' + b.bus] || { ok: false };
  return { getResponseCode: () => 200, getContentText: () => JSON.stringify(r) };
};
drive[ME + '|' + BUS] = { ok: true, reg: 'HP 65 9511', campus: 'LMS4', staff: false };
drive[STAFF + '|' + BUS] = { ok: true, reg: 'HP659511', campus: 'LMS4', staff: true };
drive[STAFF + '|' + BUS2] = { ok: true, reg: 'HP000', campus: 'LMS4', staff: true };        // not in the fleet
drive[ME + '|' + BUS2] = { ok: true, reg: 'HP665805', campus: 'LMS4', staff: false };       // a reg at another school than capture-drive says
const call = (fn, body) => run(fn + '(' + JSON.stringify(Object.assign({ key: KEY }, body)) + ')');
const tk = (email, params) => call('gameCaptureTicket_', { email, params: Object.assign({ bus: BUS, runId: 'G1', runKind: 'timelapse' }, params) });
const partOf = (t, o) => call('gameCapturePart_', Object.assign({ ticket: new URL(t.data.url).searchParams.get('ticket'), kind: 'frame', seq: 1, lat: 31.5, lng: 76.9, takenAt: '2026-11-26T08:00:00Z', base64: JPG }, o));
caller = null;   // the old idToken path must stay shut: no game caller leaks into it
assert.match(frame({}).error, /Not authorized/);

// the key, who, and the bus come from the server
assert.deepStrictEqual(run('gameCaptureTicket_({key:"x",email:"a@b.co",params:{}})'), { success: false, error: 'not_authorized' });
assert.strictEqual(tk('', {}).data.code, 'who');
assert.strictEqual(tk('stranger@test.invalid', {}).data.code, 'not_authorized');
assert.strictEqual(tk(ME, { runId: '../x' }).data.code, 'bad_input');
assert.strictEqual(tk(ME, { runKind: 'count' }).data.code, 'bad_input', 'a count run takes no camera');
assert.strictEqual(tk(STAFF, { bus: BUS2 }).data.code, 'not_in_fleet');
assert.strictEqual(tk(ME, { bus: BUS2 }).data.code, 'bus_mismatch');
assert.strictEqual(tk(ME, { trial: 'yes' }).data.code, 'trial_denied', 'a crew member never starts a trial');
assert.ok(asked.every((b) => /^[0-9a-f-]{36}$/.test(b.bus)), 'only a game bus id goes to capture-drive');

// one ticket per run, the whole run's frames
const t1 = tk(ME, {});
assert.strictEqual(t1.success, true);
assert.match(t1.data.url, /^https:\/\/script\.google\.com\/macros\/s\/ROSTER\/exec\?ticket=[\w-]+\.[\w-]+&action=gameCapturePart$/);
assert.ok(!decodeURIComponent(t1.data.url).includes('@') && !Buffer.from(new URL(t1.data.url).searchParams.get('ticket').split('.')[0], 'base64url').toString().includes('@'), 'no email, no school in the URL');
const crun = (email, o) => call('gameCaptureRun_', { email, params: Object.assign({ bus: BUS, runId: 'G1', runKind: 'timelapse', startedAt: '1764144000000', endedAt: '', frames: '2', gaps: '0', stops: '1', status: 'running', trial: '' }, o) }).data;
assert.strictEqual(crun(ME, { reg: 'HP000000', capturedBy: 'someone@else.com' }).ok, true);   // flat string params; extras are ignored
const rowG = tabs['Capture Runs'].find((r) => r[0] === 'HP659511-G1');
assert.deepStrictEqual([rowG[0], rowG[1], rowG[2], rowG[3], rowG[6], rowG[7]], ['HP659511-G1', 'HP659511', 'LMS4', 'timelapse', ME, 'Driver'], "the run id is <REG>-<game id> (the Mac's push needs that); the bus decided the reg; the app's reg and capturedBy are ignored");
const f1 = partOf(t1, {}), f2 = partOf(t1, { seq: 2 }), s1 = partOf(t1, { kind: 'stop', seq: 3 });
assert.deepStrictEqual([f1.success, f2.success, s1.success], [true, true, true]);
const dirG = runDirOf('HP659511-G1');
assert.deepStrictEqual(dirG.files.map((f) => f.name).sort(), ['frame-00001.jpg', 'frame-00002.jpg', 'stop-00003.jpg'], 'the old Capture/<REG>/<run>/ layout, so the Mac and PhotoRun see it');
assert.strictEqual(partOf(t1, {}).fileId, f1.fileId, 'idempotent on (runId, kind, seq)');
assert.strictEqual(dirG.files.length, 3);
assert.strictEqual(crun(ME, { endedAt: '2026-11-26T09:00:00Z', status: 'ended', frames: '2' }).ok, true);
assert.strictEqual(tabs['Capture Runs'].find((r) => r[0] === 'HP659511-G1')[10], '[{"seq":3}]', "the stop list is read from the run's stop photos, one {seq} each, for the Mac");
assert.strictEqual(tabs['Capture Runs'].find((r) => r[0] === 'HP659511-G1')[12], 'ended');
assert.match(dirG.files[0].desc, /driver@test\.invalid/, 'the frame is credited to the sender');
// the same checks as the old path: image only, 2 MB
assert.match(partOf(t1, { seq: 9, base64: PDF }).error, /photo/);
assert.match(partOf(t1, { seq: 9, base64: b64('FF D8 FF E0', 3 * 1024 * 1024) }).error, /2 MB/);
assert.match(partOf(t1, { kind: 'inspection', seq: 9 }).error, /does not take/);
// a bad ticket / an expired one / another bus's run
assert.strictEqual(call('gameCapturePart_', { ticket: 'x.y', kind: 'frame', seq: 1, base64: JPG }).error, 'not_authorized');
const forged = t1.data.url.replace(/ticket=([\w-]+)\./, (m, b) => 'ticket=' + b.slice(0, -2) + 'AA.');
assert.strictEqual(call('gameCapturePart_', { ticket: new URL(forged).searchParams.get('ticket'), kind: 'frame', seq: 1, base64: JPG }).error, 'not_authorized');
const realNow = Date.now; Date.now = () => realNow() + 7 * 3600e3;
assert.strictEqual(partOf(t1, { seq: 5 }).error, 'not_authorized', 'a ticket lasts 6 h');
Date.now = realNow;
assert.strictEqual(tk(STAFF, { runId: 'G1', bus: BUS2 }).data.code, 'not_in_fleet');
// staff: a trial timelapse is allowed, and only a timelapse
const tt = tk(STAFF, { runId: 'G2', trial: 'yes' });
assert.strictEqual(tt.success, true);
assert.strictEqual(crun(STAFF, { runId: 'G2', trial: 'yes' }).ok, true);
assert.strictEqual(tabs['Capture Runs'].find((r) => r[0] === 'HP659511-G2')[7], 'Coordinator');
assert.strictEqual(tk(STAFF, { runId: 'G3', runKind: 'inspection', trial: 'yes' }).data.code, 'trial_denied');
// the run's bus and kind can't change; a discarded run takes nothing more
assert.strictEqual(tk(ME, { runId: 'G1', runKind: 'inspection' }).data.code, 'kind_mismatch');
tabs['Capture Runs'].find((r) => r[0] === 'HP659511-G1')[12] = 'closed'; Object.keys(cache).forEach((k) => { if (/^caprow_/.test(k)) delete cache[k]; });
assert.strictEqual(tk(ME, {}).data.code, 'discarded');
assert.match(partOf(t1, { seq: 11 }).error, /discarded/);
// the same manifest as one JSON string param (kind = runKind; stops as numbers), with the same rules
const crunJson = (email, o) => call('gameCaptureRun_', { email, params: { bus: BUS, run: JSON.stringify(Object.assign({ runId: 'G5', kind: 'timelapse', startedAt: 1764144000000, endedAt: null, frames: 1, status: 'running', stops: [3], trial: false }, o)) } }).data;
assert.strictEqual(crunJson(ME, {}).ok, true);
assert.strictEqual(tabs['Capture Runs'].find((r) => r[0] === 'HP659511-G5')[3], 'timelapse');
assert.strictEqual(crunJson(ME, { kind: 'count' }).code, 'bad_input');
assert.strictEqual(call('gameCaptureRun_', { email: ME, params: { bus: BUS, run: 'not json' } }).data.code, 'bad_input');
assert.match(crunJson(ME, { runId: 'G6', trial: true }).code, /Only the Owner or a Coordinator/, 'a crew member can not send a trial run, in either form');
// the manifest: flat params, known words only
assert.strictEqual(crun(ME, { runId: 'G4', runKind: 'count' }).code, 'bad_input');
assert.strictEqual(crun(ME, { runId: 'G4', status: 'closed' }).code, 'bad_input', "'closed' is the server's alone");
assert.strictEqual(crun(ME, { runId: 'x'.repeat(51) }).code, 'bad_input', 'the reg prefix keeps the id within 64');
assert.match(crun(ME, { runId: 'G1' }).code, /discarded/, 'a discarded run takes no manifest');
assert.strictEqual(run('CAP_GAME_AUTH_') === null, true, 'no game caller is left set after a request');
console.log('capture game actions: all passed');
