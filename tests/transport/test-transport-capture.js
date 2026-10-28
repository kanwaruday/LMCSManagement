// apps-script/transport-capture.gs: who may upload a capture frame/stop/inspection photo, idempotency on (runId,kind,seq),
// the 2 MB image cap, count runs taking no frames, and the Capture Runs manifest upsert.
// Runs the real .gs (plus transport-uploads.gs and staff-documents.gs, which it reuses) in a vm with stubbed Drive and Sheets.
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const gs = (f) => fs.readFileSync(path.join(__dirname, '../../apps-script', f), 'utf8').replace(/^const /gm, 'var ');

function folder(name) {
  const kids = [], files = [];
  return { name, kids, files, getName: () => name,
    getFoldersByName(n) { const m = kids.filter((k) => k.name === n); let i = 0; return { hasNext: () => i < m.length, next: () => m[i++] }; },
    getFilesByName(n) { const m = files.filter((f) => f.name === n); let i = 0; return { hasNext: () => i < m.length, next: () => m[i++] }; },
    createFolder(n) { const f = folder(n); kids.push(f); return f; },
    createFile(blob) { const id = 'FILE' + (nextId++) + 'x'.repeat(20); const f = { name: blob.name, blob, desc: '', getId: () => id, setDescription(d) { f.desc = d; } }; files.push(f); return f; } };
}
let nextId = 1;
const root = folder('LMS Central Repository');
const transport = root.createFolder('LMCS Repository').createFolder('Important Documents @ LMCS').createFolder('Important Documents Transport');
transport.createFolder('Bus Wise Documents');
const tabs = {
  'LM Studio Fleet': [['Reg', 'Bus', 'Campus'], ['HP659511', 'Bus 4', 'LMS 4'], ['HP665805', 'Bus 1', 'LMS 1'], ['HP665686', 'Bus 5', 'LMS 4']],
};
const mkSheet = (n) => ({ appendRow: (r) => tabs[n].push(r), setFrozenRows() {}, getLastColumn: () => Math.max(0, ...tabs[n].map((r) => r.length)),
  getDataRange: () => ({ getValues: () => tabs[n].map((r) => r.slice()) }),
  getRange: (r, c, nr, nc) => ({ setFontWeight() {}, setValues: (v) => { tabs[n][r - 1] = v[0].slice(); } }) });
const ss = { getSheetByName: (n) => tabs[n] ? mkSheet(n) : null, insertSheet(n) { tabs[n] = []; return mkSheet(n); } };
let caller = null;
const cache = {};
const ctx = { console, Date, Object, String, Math, JSON, Array, Number, RegExp,
  SpreadsheetApp: { openById: () => ss },
  DriveApp: { getFolderById: () => root },
  CacheService: { getScriptCache: () => ({ get: (k) => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Utilities: { base64Decode: (s) => Array.from(Buffer.from(s, 'base64')).map((b) => (b > 127 ? b - 256 : b)),
    newBlob: (bytes, mime, name) => ({ bytes, mime, name }), formatDate: () => 'x' },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === 'TRANSPORT_PUSH_SECRET' ? 'S' : null) }) },
  verifyStaffManagerToken_: () => caller, CENTRAL_REPO_FOLDER_ID_: 'root',
  getSubfolder_: (p, n) => { const it = p.getFoldersByName(n); return it.hasNext() ? it.next() : null; } };
vm.createContext(ctx);
vm.runInContext(gs('staff-documents.gs').split('\n').filter((l) => /^var SDOC_(MAX_BYTES|MIME_EXT)_/.test(l)).join('\n'), ctx);
vm.runInContext(gs('transport-uploads.gs'), ctx);
vm.runInContext(gs('transport-capture.gs'), ctx);
const run = (code) => JSON.parse(JSON.stringify(vm.runInContext(code, ctx)));
const b64 = (hex, pad) => Buffer.concat([Buffer.from(hex.replace(/ /g, ''), 'hex'), Buffer.alloc(pad || 8)]).toString('base64');
const JPG = b64('FF D8 FF E0'), PDF = b64('25 50 44 46 2D');
const frame = (o) => run('captureFile_(' + JSON.stringify(Object.assign({ idToken: 't', reg: 'HP659511', runId: 'R1', runKind: 'timelapse', kind: 'frame', seq: 1, lat: 31.5, lng: 76.9, takenAt: '2026-10-25T08:00:00Z', base64: JPG }, o)) + ')');
const runDirOf = (id) => transport.kids.find((k) => k.name === 'Capture').kids.find((k) => k.name === 'HP659511').kids.find((k) => k.name === id);
const runDir = () => { const c = transport.kids.find((k) => k.name === 'Capture'); const r = c && c.kids.find((k) => k.name === 'HP659511'); return r && r.kids.find((k) => k.name === 'R1'); };

caller = null;
assert.match(frame({}).error, /Not authorized/);

// Coordinator LMS4-6 can upload a frame for HP659511 (LMS 4)
caller = { email: 'c4@lms.org.in', campusId: 'LMS5', roles: ['Coordinator'], role: 'Coordinator' };
const a = frame({});
assert.strictEqual(a.success, true, JSON.stringify(a));
assert.ok(runDir(), 'Capture/HP659511/R1 created beside Bus Wise Documents');
assert.strictEqual(runDir().files[0].name, 'frame-00001.jpg');
assert.strictEqual(a.fileId, runDir().files[0].getId());
assert.match(runDir().files[0].desc, /31\.5/, 'lat/lng/takenAt kept on the file');

// Coordinator LMS1-3 refused for HP659511
caller = { email: 'c1@lms.org.in', campusId: 'LMS1', roles: ['Coordinator'], role: 'Coordinator' };
assert.match(frame({ runId: 'R9' }).error, /only upload for buses of your own campuses/);

// FeeClerk refused outside own campus (and allowed inside it)
caller = { email: 'f@lms.org.in', campusId: 'LMS5', roles: ['FeeClerk'], role: 'FeeClerk' };
assert.match(frame({ runId: 'R9' }).error, /only upload for buses of your own campuses/);
caller = { email: 'f4@lms.org.in', campusId: 'LMS4', roles: ['FeeClerk'], role: 'FeeClerk' };
assert.strictEqual(frame({ seq: 7 }).success, true, 'FeeClerk of the bus campus is allowed');

// Owner allowed
caller = { email: 'o@lms.org.in', campusId: 'ALL', roles: ['Owner'], role: 'Owner' };
assert.strictEqual(frame({ seq: 2, kind: 'stop' }).success, true);
assert.ok(runDir().files.some((f) => f.name === 'stop-00002.jpg'));

// repeat (runId,kind,seq) returns same fileId and creates no second file
const n = runDir().files.length, again = frame({ seq: 1 });
assert.strictEqual(again.fileId, a.fileId); assert.strictEqual(runDir().files.length, n);
Object.keys(cache).forEach((k) => delete cache[k]); // cache evicted: the file-name check still dedups
assert.strictEqual(frame({ seq: 1 }).fileId, a.fileId); assert.strictEqual(runDir().files.length, n);
assert.strictEqual(frame({ seq: 1, kind: 'stop' }).success, true, 'kind is part of the key');

// PDF refused, 3 MB frame refused, bad input refused
assert.match(frame({ seq: 3, base64: PDF }).error, /photo/);
assert.match(frame({ seq: 3, base64: b64('FF D8 FF E0', 3 * 1024 * 1024) }).error, /2 MB/);
assert.strictEqual(frame({ seq: 4, base64: b64('FF D8 FF E0', 1.9 * 1024 * 1024) }).success, true, 'just under 2 MB is fine');
assert.match(frame({ seq: 3, kind: 'video' }).error, /kind/);
assert.match(frame({ runId: '../x' }).error, /run/i);
assert.match(frame({ seq: -1 }).error, /seq/);
assert.match(frame({ reg: 'HP000' }).error, /not in the fleet/);

// capturerun upserts by runId
const cr = (r) => run('captureRun_(' + JSON.stringify({ idToken: 't', run: r }) + ')');
assert.deepStrictEqual(run('CAP_RUN_HEADER_'), ['Run ID', 'Reg', 'Campus', 'Kind (timelapse/count/inspection)', 'Started', 'Ended', 'By', 'Role', 'Frames', 'Gaps JSON', 'Stops JSON', 'Inspection JSON', 'Status', 'Frame Times JSON', 'Captured By']);
assert.strictEqual(cr({ runId: 'R1', reg: 'HP659511', kind: 'timelapse', startedAt: 1761600000000, frames: 10, stops: [{ seq: 2 }] }).success, true);
const rows1 = tabs['Capture Runs'];
assert.deepStrictEqual(JSON.parse(JSON.stringify(rows1[0])), run('CAP_RUN_HEADER_'));
assert.strictEqual(rows1.length, 2);
assert.deepStrictEqual(JSON.parse(JSON.stringify(rows1[1])).slice(0, 3), ['R1', 'HP659511', 'LMS4']);
assert.strictEqual(rows1[1][8], 10); assert.strictEqual(rows1[1][10], '[{"seq":2}]');
assert.strictEqual(cr({ runId: 'R1', reg: 'HP659511', kind: 'timelapse', startedAt: 1761600000000, endedAt: '2026-10-28T07:15:00.000Z', frames: 42, status: 'closed' }).success, true);
assert.strictEqual(tabs['Capture Runs'].length, 2, 'no new row');
assert.strictEqual(tabs['Capture Runs'][1][8], 42); assert.strictEqual(tabs['Capture Runs'][1][5], '2026-10-28T07:15:00.000Z'); assert.strictEqual(tabs['Capture Runs'][1][12], 'closed');
assert.strictEqual(cr({ runId: 'R2', reg: 'HP659511', kind: 'timelapse' }).success, true);
// a sheet formula never reaches the sheet: times must be epoch ms or ISO, the status one of the phone's words
assert.strictEqual(cr({ runId: 'R3', reg: 'HP659511', kind: 'timelapse', startedAt: '=IMAGE("https://x/")', endedAt: '+1', status: '=HYPERLINK("x")', capturedBy: '=a1&b1@x.com' }).success, true);
assert.deepStrictEqual([tabs['Capture Runs'][3][4], tabs['Capture Runs'][3][5], tabs['Capture Runs'][3][12]], ['', '', 'open']);
assert.ok(!/^[=+\-@]/.test(String(tabs['Capture Runs'][3][14])), 'Captured By never starts with a formula character');
tabs['Capture Runs'].pop(); assert.strictEqual(tabs['Capture Runs'].length, 3, 'another runId is a new row');
caller = { email: 'c1@lms.org.in', campusId: 'LMS1', roles: ['Coordinator'], role: 'Coordinator' };
assert.match(cr({ runId: 'R5', reg: 'HP659511', kind: 'timelapse' }).error, /own campuses/, 'manifest is scoped like uploads');
caller = { email: 'o@lms.org.in', campusId: 'ALL', roles: ['Owner'], role: 'Owner' };
assert.match(cr({ runId: 'R5', reg: 'HP659511', kind: 'drone' }).error, /kind/);

// runKind decides what a run accepts, whatever order things arrive in
assert.match(frame({ runId: 'RX', runKind: 'count' }).error, /count run/, 'a frame with runKind count is refused with no manifest row');
assert.match(frame({ runId: 'RX', runKind: 'count', kind: 'stop' }).error, /count run/, 'a stop with runKind count is refused');
assert.match(frame({ runId: 'RX', kind: 'inspection' }).error, /does not take inspection/, 'inspection upload with runKind timelapse is refused');
assert.match(frame({ runId: 'RX', runKind: 'inspection' }).error, /does not take frame/, 'inspection run takes no frames');
assert.strictEqual(frame({ runId: 'RI', runKind: 'inspection', kind: 'inspection' }).success, true, 'inspection run takes inspection photos');
assert.match(frame({ runKind: undefined }).error, /runKind is required/, 'runKind missing is refused');
assert.match(frame({ runKind: 'drone' }).error, /runKind is required/);
assert.strictEqual(cr({ runId: 'RC', reg: 'HP659511', kind: 'count' }).success, true);
assert.match(frame({ runId: 'RC', seq: 1 }).error, /does not match this run/, 'runKind that does not match the manifest is refused');
assert.match(frame({ runId: 'RC', runKind: 'count', seq: 1 }).error, /count run/, 'a count run with a count manifest still takes nothing');
assert.strictEqual(frame({ runId: 'R1', seq: 50 }).success, true, 'matching manifest (R1 timelapse) is accepted');
// Ruling 33: Fleet setup quest photos (odometer, driver) are kind 'profile' on a run of runKind 'profile', and nothing else
assert.strictEqual(cr({ runId: 'RP', reg: 'HP659511', kind: 'profile', status: 'running' }).success, true, 'a profile run has a manifest like any run');
assert.strictEqual(frame({ runId: 'RP', runKind: 'profile', kind: 'profile', seq: 0 }).success, true, 'a profile run takes profile photos');
assert.strictEqual(transport.kids.find((k) => k.name === 'Capture').kids.find((k) => k.name === 'HP659511').kids.find((k) => k.name === 'RP').files[0].name, 'profile-00000.jpg');
assert.match(frame({ runId: 'RP', runKind: 'profile', kind: 'frame', seq: 1 }).error, /does not take frame/, 'a profile run takes no frames');
assert.match(frame({ runId: 'RX', kind: 'profile' }).error, /does not take profile/, 'a timelapse takes no profile photos');
assert.match(frame({ runId: 'RX', runKind: 'inspection', kind: 'profile' }).error, /does not take profile/, 'nor does a safety check');
assert.match(frame({ runId: 'RP', runKind: 'timelapse', kind: 'frame', seq: 2 }).error, /does not match this run/, 'the manifest pins the run to profile');
assert.match(cr({ runId: 'R5', reg: 'HP659511', kind: 'profile', inspection: { cctv: { ok: true } } }).error, /Only an inspection run/, 'a profile run carries no safety answers');

// a run is pinned to its bus and kind (Ruling 11)
assert.match(cr({ runId: 'R1', reg: 'HP659511', kind: 'inspection' }).error, /cannot change/, 'changed Kind on an existing runId is refused');
assert.match(cr({ runId: 'R1', reg: 'HP665686', kind: 'timelapse' }).error, /cannot change/, 'changed Reg on an existing runId is refused');
assert.strictEqual(tabs['Capture Runs'].find((r) => r[0] === 'R1')[1], 'HP659511');
assert.strictEqual(cr({ runId: 'R1', reg: 'HP659511', kind: 'timelapse', frames: 60, status: 'closed' }).success, true, 'other fields still update');
assert.match(frame({ reg: 'HP665686', runId: 'R1', seq: 60 }).error, /another bus/, 'capturefile for another bus against R1 row is refused');
const other = frame({ reg: 'HP665686', runId: 'R77', seq: 1 }), mine = frame({ reg: 'HP659511', runId: 'R77', seq: 1 });
assert.ok(other.success && mine.success && other.fileId !== mine.fileId, 'same runId+seq on two buses never share a fileId');
assert.strictEqual(frame({ reg: 'HP665686', runId: 'R77', seq: 1 }).fileId, other.fileId, 'repeat on the same bus still dedups');

// the Inspection JSON: only known safety items, each {ok: boolean, date?: 'yyyy-MM-dd', fileId?} (counts only, no free text)
const insp = (inspection, kind) => cr({ runId: 'RQ' + (kind || 'i'), reg: 'HP659511', kind: kind || 'inspection', status: 'ended', inspection });
assert.match(insp({ fire_extinguisher: { ok: true } }).error, /safety list/, 'no Safety Loadout tab yet: refused, never stored unchecked');
tabs['Safety Loadout'] = [['Item ID', 'Label', 'Needs photo', 'Needs date', 'Order', 'Active'], ['fire_extinguisher', 'Fire extinguisher', 'yes', 'yes', '1', 'yes'], ['cctv', 'CCTV camera', 'no', 'no', '2', 'no']];
const good = { fire_extinguisher: { ok: true, date: '2026-09-01', fileId: '1AbC_dEf-GhIjK' }, cctv: { ok: false } };
assert.strictEqual(insp(good).success, true, 'a good shape is stored (an item switched off since is still known)');
assert.deepStrictEqual(JSON.parse(tabs['Capture Runs'].find((r) => r[0] === 'RQi')[11]), good);
assert.strictEqual(cr({ runId: 'RQs', reg: 'HP659511', kind: 'inspection', status: 'running' }).success, true, 'the start manifest carries no answers');
const bad = [
  [{ seat_belts: { ok: true } }, /Unknown safety item: seat_belts/],
  [{ fire_extinguisher: { ok: 'false' } }, /ok must be true or false/],
  [{ fire_extinguisher: { ok: 0 } }, /ok must be true or false/],
  [{ fire_extinguisher: { ok: true, note: 'driver Ramesh' } }, /only ok, date and fileId/],
  [{ fire_extinguisher: { ok: true, date: '1/9/2026' } }, /date must be yyyy-MM-dd/],
  [{ fire_extinguisher: { ok: false, date: '2026-09-01' } }, /only on a Yes/],
  [{ fire_extinguisher: { ok: true, fileId: 'x' } }, /fileId/],
  [{ fire_extinguisher: 'yes' }, /must be an object/],
  [['fire_extinguisher'], /must be an object/],
  [{}, /no answers/],
];
bad.forEach(([v, re]) => assert.match(insp(v).error || '', re, JSON.stringify(v)));
assert.ok(!tabs['Capture Runs'].some((r) => r[0] === 'RQi' && /Ramesh/.test(r[11])), 'a refused shape is not stored');
assert.match(insp({ fire_extinguisher: { ok: true } }, 'timelapse').error, /Only an inspection run/, 'a timelapse run cannot carry answers');

// Ruling 28: a timelapse's end manifest carries its frame times (seconds since the start, by seq; null where the seq is a stop)
caller = { email: 'o@lms.org.in', campusId: 'ALL', roles: ['Owner'], role: 'Owner' };
tabs['Capture Runs'] = tabs['Capture Runs'].map((r) => r.slice(0, 13)); // a tab made before the column existed gets the new header
assert.strictEqual(cr({ runId: 'RT', reg: 'HP659511', kind: 'timelapse', startedAt: 1000, status: 'ended', frameTimes: [0, null, 32] }).success, true);
// Ruling 31: frame times too big or invalid are DROPPED; the run is stored without them (capture order on the Mac), never refused
assert.deepStrictEqual(JSON.parse(JSON.stringify(tabs['Capture Runs'][0])), run('CAP_RUN_HEADER_'));
assert.strictEqual(tabs['Capture Runs'].find((r) => r[0] === 'RT')[13], '[0,null,32]');
[['invalid: an object', { 0: 1 }], ['invalid: negative', [0, -1]], ['invalid: fractional', [0, 1.5]], ['invalid: text', [0, '3']],
  ['invalid: longer than a day', [0, 86400, 1]], ['oversize: too many entries', new Array(20001).fill(1)]].forEach(([why, ft], i) => {
  const id = 'RT2' + i, res = cr({ runId: id, reg: 'HP659511', kind: 'timelapse', status: 'ended', frameTimes: ft });
  assert.strictEqual(res.success, true, why + ': the run is still stored');
  assert.strictEqual(tabs['Capture Runs'].find((r) => r[0] === id)[13], '', why + ': without frame times');
});
assert.strictEqual(cr({ runId: 'RT3', reg: 'HP659511', kind: 'count', frameTimes: [0] }).success, true, 'a count run with frame times: dropped, stored');
assert.strictEqual(tabs['Capture Runs'].find((r) => r[0] === 'RT3')[13], '');
const long = [0].concat(new Array(5000).fill(4)); // a 75 km run, a frame every 4 s: still far under the 50,000-character cell
assert.strictEqual(cr({ runId: 'RT4', reg: 'HP659511', kind: 'timelapse', frameTimes: long }).success, true);
assert.ok(tabs['Capture Runs'].find((r) => r[0] === 'RT4')[13].length < 12000, 'deltas keep a long run compact');

// Ruling 29: the Coordinator backend (no Drive access) asks this project for the PROCESSED copies' ids, by path
const cap = transport.kids.find((k) => k.name === 'Capture'), bus = cap.kids.find((k) => k.name === 'HP659511');
const done = bus.createFolder('HP659511-20261025-071500-ab12');
const original = done.createFile({ name: 'stop-00003.jpg' }); // the phone's unblurred upload
const proc = done.createFolder('processed'), video = proc.createFile({ name: 'route.mp4' }), blurred = proc.createFile({ name: 'stop-00003.jpg' });
bus.createFolder('HP659511-20261026-071500-cd34').createFile({ name: 'frame-00000.jpg' }); // processed on the Mac, not yet synced up
const cp = (b) => run('captureProcessed_(' + JSON.stringify(b) + ')');
const ask = { runs: [{ reg: 'HP659511', runId: 'HP659511-20261025-071500-ab12', stops: [3, 4] }, { reg: 'HP659511', runId: 'HP659511-20261026-071500-cd34', stops: [] },
  { reg: 'HP000', runId: 'HP000-20261026-071500-zz11', stops: [] }] };
assert.strictEqual(cp(Object.assign({ secret: 'X' }, ask)).error, 'Not authorized', 'captureprocessed with a wrong secret refused');
[null, '', '  '].forEach((v) => {
  const keep = ctx.PropertiesService; ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: () => v }) };
  try { assert.strictEqual(cp({ secret: v || '', runs: ask.runs }).error, 'Not authorized', 'Roster secret ' + JSON.stringify(v) + ': refused, even for the same empty secret'); }
  finally { ctx.PropertiesService = keep; }
});
const got = cp(Object.assign({ secret: 'S' }, ask));
assert.deepStrictEqual(got.found, { 'HP659511-20261025-071500-ab12': { videoFileId: video.getId(), photos: { 3: blurred.getId() } } }, 'the served ids are the processed copies');
assert.notStrictEqual(got.found['HP659511-20261025-071500-ab12'].photos[3], original.getId(), 'never the unblurred original');
assert.deepStrictEqual(got.notYet, ['HP659511-20261026-071500-cd34', 'HP000-20261026-071500-zz11'], 'an unsynced run (or no folder at all) is "not yet", not an error');
assert.strictEqual(cap.kids.filter((k) => k.name === 'HP000').length, 0, 'looking creates no folders');

// Ruling 41: anyone signed in on the shared phone may send a run, but the run keeps its capturer. By = the sender (the token),
// Captured By (the last column, so the positional reads of the columns before it stay valid) = the manifest's capturedBy.
const CB = 14, rowOf = (id) => tabs['Capture Runs'].find((r) => r[0] === id);
caller = { email: 'f4@lms.org.in', campusId: 'LMS4', roles: ['FeeClerk'], role: 'FeeClerk' };
assert.strictEqual(cr({ runId: 'RB1', reg: 'HP659511', kind: 'count', status: 'running', capturedBy: 'C4@lms.org.in' }).success, true);
assert.deepStrictEqual([rowOf('RB1')[6], rowOf('RB1')[CB]], ['f4@lms.org.in', 'c4@lms.org.in'], 'By is the sender, Captured By the author');
assert.strictEqual(cr({ runId: 'RB2', reg: 'HP659511', kind: 'count', status: 'running' }).success, true);
assert.strictEqual(rowOf('RB2')[CB], 'f4@lms.org.in', 'no capturedBy (an old phone): Captured By falls back to By');
assert.strictEqual(cr({ runId: 'RB3', reg: 'HP659511', kind: 'count', capturedBy: 'not an email <b>' }).success, true);
assert.strictEqual(rowOf('RB3')[CB], 'f4@lms.org.in', 'a capturedBy that is not an email falls back to By');
caller = { email: 'o@lms.org.in', campusId: 'ALL', roles: ['Owner'], role: 'Owner' };
assert.strictEqual(cr({ runId: 'RB1', reg: 'HP659511', kind: 'count', status: 'ended' }).success, true); // the end, sent by an old phone
assert.deepStrictEqual([rowOf('RB1')[6], rowOf('RB1')[CB], rowOf('RB1')[12]], ['o@lms.org.in', 'c4@lms.org.in', 'ended'], 'a run keeps its first capturer');

// C1 end to end: the phone's real run store and uploader, this real server behind post(). A safety check with a photo item,
// captured by a Coordinator and sent by the campus Fee Clerk (Ruling 41).
(async () => {
  const { createRunStore } = await import('../../coordinator/capture/run-store.js');
  const { createUploader } = await import('../../coordinator/capture/uploader.js');
  const cp = (x) => JSON.parse(JSON.stringify(x));
  const mem = () => { const m = new Map(); return { put: async (e) => { m.set(e.id, cp(e)); }, get: async (id) => (m.has(id) ? cp(m.get(id)) : undefined), getAll: async () => [...m.values()].map(cp), delete: async (id) => { m.delete(id); } }; };
  const store = createRunStore({ runs: mem(), files: mem(), data: mem() });
  const sent = [];
  const post = async (body) => { sent.push(cp(body)); return run((body.action === 'capturefile' ? 'captureFile_(' : 'captureRun_(') + JSON.stringify(Object.assign({ idToken: 't' }, body)) + ')'); };
  const r0 = await store.newRun({ reg: 'HP659511', kind: 'inspection', campus: 'LMS 4', by: 'c4@lms.org.in', role: 'Coordinator' });
  const seq = await store.addFrame(r0.id, { takenAt: 1, base64: JPG });
  await store.endRun(r0.id, { inspection: { fire_extinguisher: { ok: true, date: '2026-09-01', seq }, cctv: { ok: false } } });
  caller = { email: 'f4@lms.org.in', campusId: 'LMS4', roles: ['FeeClerk'], role: 'FeeClerk' };
  const states = [];
  await createUploader({ store, post, sleep: async () => {}, onProgress: (p) => states.push(p.state + (p.error ? ': ' + p.error : '')) }).start(r0.id);
  assert.strictEqual(states[states.length - 1], 'done', 'the whole check is accepted: ' + states.join(' | '));
  assert.ok(!('inspection' in sent[0].run), 'the start manifest carries no answers');
  const row = rowOf(r0.id), fileId = runDirOf(r0.id).files[0].getId();
  assert.deepStrictEqual(JSON.parse(row[11]), { fire_extinguisher: { ok: true, date: '2026-09-01', fileId }, cctv: { ok: false } }, 'stored with the photo\'s Drive id');
  assert.deepStrictEqual([row[3], row[12], row[6], row[CB]], ['inspection', 'ended', 'f4@lms.org.in', 'c4@lms.org.in'], 'sent by the clerk, captured by the Coordinator');
  console.log('transport capture: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
