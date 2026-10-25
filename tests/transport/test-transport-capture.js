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
  'LM Studio Fleet': [['Reg', 'Bus', 'Campus'], ['HP659511', 'Bus 4', 'LMS 4'], ['HP665805', 'Bus 1', 'LMS 1']],
};
const mkSheet = (n) => ({ appendRow: (r) => tabs[n].push(r), setFrozenRows() {},
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
assert.deepStrictEqual(run('CAP_RUN_HEADER_'), ['Run ID', 'Reg', 'Campus', 'Kind (timelapse/count/inspection)', 'Started', 'Ended', 'By', 'Role', 'Frames', 'Gaps JSON', 'Stops JSON', 'Inspection JSON', 'Status']);
assert.strictEqual(cr({ runId: 'R1', reg: 'HP659511', kind: 'timelapse', startedAt: 's', frames: 10, stops: [{ seq: 2 }] }).success, true);
const rows1 = tabs['Capture Runs'];
assert.deepStrictEqual(JSON.parse(JSON.stringify(rows1[0])), run('CAP_RUN_HEADER_'));
assert.strictEqual(rows1.length, 2);
assert.deepStrictEqual(JSON.parse(JSON.stringify(rows1[1])).slice(0, 3), ['R1', 'HP659511', 'LMS4']);
assert.strictEqual(rows1[1][8], 10); assert.strictEqual(rows1[1][10], '[{"seq":2}]');
assert.strictEqual(cr({ runId: 'R1', reg: 'HP659511', kind: 'timelapse', startedAt: 's', endedAt: 'e', frames: 42, status: 'closed' }).success, true);
assert.strictEqual(tabs['Capture Runs'].length, 2, 'no new row');
assert.strictEqual(tabs['Capture Runs'][1][8], 42); assert.strictEqual(tabs['Capture Runs'][1][5], 'e'); assert.strictEqual(tabs['Capture Runs'][1][12], 'closed');
assert.strictEqual(cr({ runId: 'R2', reg: 'HP659511', kind: 'timelapse' }).success, true); assert.strictEqual(tabs['Capture Runs'].length, 3, 'another runId is a new row');
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
console.log('transport capture: all checks passed');
