// apps-script/driver-fuel.gs: a linked driver phone's fuel fill lands as a pending row of 'Driver Fills' with its bill and video in
// Drive. Idempotent on fillId; numbers, odometer and file bytes are checked on the server; no client text reaches a cell; driverme's
// lastOdometer counts the pending fill. Runs the real .gs files in a vm with stubbed Sheets, Drive, Cache, Lock and Utilities.
// Also the client's queue rule (driver/driver-logic.js sendOutcome) and file checks. Fictional data only.
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path'), crypto = require('crypto');
const gs = (f) => fs.readFileSync(path.join(__dirname, '../../apps-script', f), 'utf8').replace(/^const /gm, 'var ');
const DL = require(path.join(__dirname, '../../driver/driver-logic.js'));

const tabs = {
  'LM Studio Fleet': [['Reg', 'Bus', 'Campus'], ['HP659511', 'Bus 4', 'LMS 4'], ['HP665805', 'Bus 1', 'LMS 1']],
  'Fuel Fills': [['id', 'campus', 'date', 'reg', 'litres', 'odometer', 'amount_rs', 'odometer_note', 'hasVideo', 'hasBill'],
    ['f2', 'LMS4', '2026-10-20', 'HP659511', '42', '51600', '3990', '', 'yes', 'yes']],
};
const mkSheet = (n) => ({ appendRow: (r) => tabs[n].push(r.slice()), setFrozenRows() {},
  getDataRange: () => ({ getValues: () => tabs[n].map((r) => r.slice()) }),
  getRange: (r, c) => ({ setFontWeight() {}, setValues: (v) => { v.forEach((row, i) => row.forEach((x, j) => { tabs[n][r - 1 + i][c - 1 + j] = x; })); },
    setValue: (x) => { tabs[n][r - 1][c - 1] = x; }, getValue: () => tabs[n][r - 1][c - 1] }) });
const ss = { getSheetByName: (n) => (tabs[n] ? mkSheet(n) : null), insertSheet(n) { tabs[n] = []; return mkSheet(n); } };

// Drive: a tree of {name, folders, files}
const mkFolder = (name) => ({ name, folders: [], files: [], getName: () => name,
  createFolder(n) { const f = mkFolder(n); this.folders.push(f); return f; },
  getFoldersByName(n) { const hit = this.folders.filter((f) => f.name === n); return { hasNext: () => hit.length > 0, next: () => hit.shift() }; },
  getFilesByName(n) { const hit = this.files.filter((f) => f.name === n); return { hasNext: () => hit.length > 0, next: () => hit.shift() }; },
  createFile(b) { const f = { name: b.name, mime: b.mime, size: b.bytes.length, getId: () => 'FILE-' + b.name + '-' + driveFiles.length }; this.files.push(f); driveFiles.push(f); return f; } });
const driveFiles = [], root = mkFolder('root');
const cache = {};
const ctx = { console, Date, Object, String, Math, JSON, Array, Number, RegExp, isFinite, isNaN,
  SpreadsheetApp: { openById: () => ss },
  DriveApp: { getFolderById: () => root },
  CacheService: { getScriptCache: () => ({ get: (k) => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Utilities: { getUuid: () => crypto.randomUUID(), formatDate: (d) => d.toISOString().slice(0, 10),
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(s, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
    base64Decode: (s) => Array.from(Buffer.from(s, 'base64')).map((b) => (b > 127 ? b - 256 : b)),
    newBlob: (bytes, mime, name) => ({ bytes, mime, name }) },
  verifyStaffManagerToken_: () => ({ email: 'o@lms.org.in', campusId: 'ALL', roles: ['Owner'], role: 'Owner' }),
  HIR_EMPCODE_RE_: /^([A-Z]{3})\/(\d{2})\/(\d{2})\/(\d{3,})$/,
  CENTRAL_REPO_FOLDER_ID_: 'x', SDOC_MIME_EXT_: { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/webp': 'webp' },
  getSubfolder_: (parent, name) => { const it = parent.getFoldersByName(name); return it.hasNext() ? it.next() : null; } };
vm.createContext(ctx);
['transport-uploads.gs', 'transport-capture.gs', 'driver-token.gs', 'driver-link.gs', 'driver-fuel.gs'].forEach((f) => vm.runInContext(gs(f), ctx));
// the transport folder path the capture code walks: create every level but the last (capFolder_ creates 'Capture' itself)
vm.runInContext('capPath_()', ctx).slice(0, -1).reduce((f, n) => f.createFolder(n), root);
const call = (fn, body) => JSON.parse(JSON.stringify(vm.runInContext(fn + '(' + JSON.stringify(body) + ')', ctx)));
const UNLINKED = 'This phone is not linked. Ask the office for a new link.';

const link = call('driverLinkCreate_', { idToken: 't', reg: 'HP659511', driverName: 'Test Driver' });
const other = call('driverLinkCreate_', { idToken: 't', reg: 'HP665805', driverName: 'Other Driver' });
assert.ok(link.success && other.success);

const b64 = (hex, pad) => Buffer.concat([Buffer.from(hex, 'hex'), Buffer.alloc(pad || 16)]).toString('base64');
const JPG = b64('FFD8FFE0'), MP4 = b64('00000018' + Buffer.from('ftypisom').toString('hex')), MOV = b64('00000014' + Buffer.from('ftypqt  ').toString('hex'));
const HEIC = b64('00000018' + Buffer.from('ftypheic').toString('hex'));
const AT = new Date(Date.now() - 3600e3).toISOString(); // an hour ago: inside the server's window for a fill's own time
const fill = (o) => Object.assign({ deviceToken: link.token, fillId: 'Fa1b2c3d4e5f6', litres: '42.5', amount: '4,000', odometer: '52100',
  filledAt: AT, bill: { mime: 'image/jpeg', base64: JPG }, video: { mime: 'video/mp4', base64: MP4 } }, o);
const rows = () => (tabs['Driver Fills'] || []).slice(1);
const t = (name, fn) => { fn(); console.log('ok  ' + name); };

t('happy path: one pending row, two files under Capture/Fuel/<REG>/<fillId>', () => {
  assert.deepStrictEqual(call('driverFuel_', fill({})), { success: true, fillId: 'Fa1b2c3d4e5f6', status: 'pending' });
  assert.strictEqual(tabs['Driver Fills'][0].length, 16);
  assert.strictEqual(rows().length, 1);
  const r = rows()[0];
  assert.deepStrictEqual([r[0], r[1], r[2], r[3], r[4], r[6], r[7], r[8], r[12], r[13], r[14], r[15]],
    ['Fa1b2c3d4e5f6', 'HP659511', 'LMS4', link.linkId, 'Test Driver', 42.5, 4000, 52100, 'pending', '', '', '']);
  assert.ok(r[5] instanceof Date && r[5].toISOString() === AT, 'Filled At is a Date');
  assert.ok(r[11] instanceof Date, 'Received');
  assert.deepStrictEqual(driveFiles.map((f) => f.name), ['bill.jpg', 'video.mp4']);
  assert.ok(r[9].includes('bill.jpg') && r[10].includes('video.mp4'));
  const cap = vm.runInContext('capPath_()', ctx).reduce((f, n) => f.folders.find((x) => x.name === n), root);
  const dir = cap.folders.find((f) => f.name === 'Fuel').folders.find((f) => f.name === 'HP659511').folders.find((f) => f.name === 'Fa1b2c3d4e5f6');
  assert.strictEqual(dir.files.length, 2);
});

t('the same fillId again: the stored row, no new row or file', () => {
  assert.deepStrictEqual(call('driverFuel_', fill({})), { success: true, fillId: 'Fa1b2c3d4e5f6', status: 'pending' });
  assert.strictEqual(rows().length, 1); assert.strictEqual(driveFiles.length, 2);
  assert.strictEqual(call('driverFuel_', fill({ deviceToken: other.token, odometer: '90000' })).error, 'Bad fillId', 'another bus cannot claim it');
});

t('driverme: lastOdometer and lastFill include the pending fill', () => {
  const me = call('driverMe_', { deviceToken: link.token });
  assert.strictEqual(me.lastOdometer, 52100); assert.strictEqual(me.lastFill, AT.slice(0, 10), 'the pending fill day');
  assert.strictEqual(call('driverMe_', { deviceToken: other.token }).lastOdometer, null, 'other bus untouched');
});

t('the odometer is judged against the pending fill', () => {
  assert.match(call('driverFuel_', fill({ fillId: 'Fodo-low-01', odometer: '51700' })).error, /less than last time \(52100\)/);
  assert.match(call('driverFuel_', fill({ fillId: 'Fodo-far-01', odometer: '57101' })).error, /too far since last time \(52100\)/);
  assert.strictEqual(call('driverFuel_', fill({ fillId: 'Fodo-ok-001', odometer: '57100', filledAt: undefined })).success, true, '5000 km on is fine');
  assert.strictEqual(rows()[1][5], '', 'no filledAt: blank');
});

t('revoked and unknown tokens are refused alike', () => {
  call('driverLinkRevoke_', { idToken: 't', linkId: other.linkId });
  assert.strictEqual(call('driverFuel_', fill({ fillId: 'Frev-00001', deviceToken: other.token })).error, UNLINKED);
  assert.strictEqual(call('driverFuel_', fill({ fillId: 'Frev-00002', deviceToken: 'a'.repeat(64) })).error, UNLINKED);
  assert.strictEqual(call('driverFuel_', fill({ fillId: 'Frev-00003', deviceToken: undefined })).error, UNLINKED);
});

t('bad numbers and ids are refused on the server', () => {
  const before = rows().length;
  [['litres', '0'], ['litres', '401'], ['litres', '4e1'], ['litres', '-5'], ['amount', '4000.5'], ['amount', '=1+1'], ['amount', ''],
    ['odometer', '58 210'], ['odometer', '0x10'], ['litres', null], ['odometer', 58100.5]].forEach(([k, v], i) =>
    assert.match(call('driverFuel_', fill({ fillId: 'Fbadnum-' + i, [k]: v, odometer: k === 'odometer' ? v : '57200' })).error, /Check the/, k + '=' + v));
  ['short', '=HYPERLINK(1)', '-abcdefgh', '12345678', 'a'.repeat(65), 'Fbad id!x'].forEach((id) =>
    assert.strictEqual(call('driverFuel_', fill({ fillId: id })).error, 'Bad fillId', id));
  assert.strictEqual(rows().length, before);
});

t('files: sniffed bytes and size caps, the declared mime is not trusted', () => {
  const before = driveFiles.length;
  const err = (o) => call('driverFuel_', fill(Object.assign({ fillId: 'Ffile-' + crypto.randomUUID().slice(0, 8), odometer: '57200' }, o))).error;
  assert.match(err({ bill: { mime: 'image/jpeg', base64: b64(Buffer.from('<html>').toString('hex')) } }), /bill must be a photo/);
  assert.match(err({ bill: { mime: 'image/jpeg', base64: MP4 } }), /bill must be a photo/);
  assert.match(err({ bill: { mime: 'image/jpeg', base64: b64('FFD8FFE0', 3 * 1048576) } }), /larger than 3 MB/);
  assert.match(err({ bill: null }), /bill photo is missing/);
  assert.match(err({ video: { mime: 'video/mp4', base64: JPG } }), /must be a video/);
  assert.match(err({ video: { mime: 'video/mp4', base64: HEIC } }), /must be a video/, 'a HEIC photo is not a video');
  assert.match(err({ video: { mime: 'video/mp4', base64: b64('%PDF-1.4'.split('').map((c) => c.charCodeAt(0).toString(16)).join('')) } }), /must be a video/);
  assert.match(err({ video: { mime: 'video/mp4', base64: b64('00000018' + Buffer.from('ftypisom').toString('hex'), 25 * 1048576) } }), /larger than 25 MB/);
  assert.strictEqual(driveFiles.length, before, 'nothing saved');
  assert.strictEqual(call('driverFuel_', fill({ fillId: 'Fmov-000001', odometer: '57300', video: { mime: 'image/png', base64: MOV } })).success, true);
  assert.strictEqual(driveFiles[driveFiles.length - 1].name, 'video.mov'); assert.strictEqual(driveFiles[driveFiles.length - 1].mime, 'video/quicktime');
});

const decideAll = () => (tabs['Driver Fills'] || []).forEach((r, i) => { if (i && r[12] === 'pending') r[12] = 'confirmed'; }); // the clerk checked them
t('formula strings never reach a cell', () => {
  decideAll();
  call('driverFuel_', fill({ fillId: 'Fformula01', odometer: '57400', litres: '=IMPORTXML("x")' }));
  call('driverFuel_', fill({ fillId: 'Fformula02', odometer: '57400', filledAt: '=NOW()' }));
  call('driverFuel_', fill({ fillId: 'Fformula03', odometer: '57400', filledAt: '+2026-10-28T08:00:00Z' }));
  rows().forEach((r) => r.forEach((c) => assert.ok(typeof c !== 'string' || !/^[=+\-@]/.test(c), 'cell ' + c)));
  assert.strictEqual(rows().find((r) => r[0] === 'Fformula02')[5], '');
});

t('review fixes: refused is marked, pending is capped per link, a fill time must be sane, replays bind to the link', () => {
  decideAll();
  const bad = call('driverFuel_', fill({ fillId: 'Frefused01', litres: '0' }));
  assert.strictEqual(bad.refused, true, 'a final no says so');
  assert.strictEqual(DL.sendOutcome(bad), 'refused');
  ['Fcap000001', 'Fcap000002', 'Fcap000003'].forEach((id, i) => assert.strictEqual(call('driverFuel_', fill({ fillId: id, odometer: String(57500 + i) })).success, true));
  const filesBefore = driveFiles.length;
  const fourth = call('driverFuel_', fill({ fillId: 'Fcap000004', odometer: '57600' }));
  assert.ok(fourth.refused && /already waiting/.test(fourth.error), 'a fourth waiting fill is refused');
  assert.strictEqual(driveFiles.length, filesBefore, 'and stores no file');
  decideAll();
  const ahead = new Date(Date.now() + 3 * 3600e3).toISOString(), old = new Date(Date.now() - 9 * 864e5).toISOString();
  assert.strictEqual(call('driverFuel_', fill({ fillId: 'Fclock0001', odometer: '57700', filledAt: ahead })).success, true);
  assert.strictEqual(call('driverFuel_', fill({ fillId: 'Fclock0002', odometer: '57700', filledAt: old })).success, true);
  assert.strictEqual(rows().find((r) => r[0] === 'Fclock0001')[5], '', 'a phone clock ahead of now is not kept');
  assert.strictEqual(rows().find((r) => r[0] === 'Fclock0002')[5], '', 'nor one more than 7 days back');
  const theirs = call('driverFuel_', fill({ deviceToken: other.token, fillId: 'Fclock0001' }));
  assert.strictEqual(theirs.success, false, "another link can't read this fill by its id");
});

// client side (driver/driver-logic.js)
t('queue rule: a fill leaves the phone only on a server success', () => {
  assert.strictEqual(DL.sendOutcome({ success: true }), 'sent');
  assert.strictEqual(DL.sendOutcome({ success: false, refused: true, error: 'Check the litres' }), 'refused');
  assert.strictEqual(DL.sendOutcome({ success: false, error: 'Lock timeout' }), 'retry', 'a passing server error keeps the fill');
  assert.strictEqual(DL.sendOutcome(null), 'retry', 'no answer (offline, timeout, an HTML error page)');
  assert.strictEqual(DL.sendOutcome(undefined), 'retry');
  assert.strictEqual(DL.sendOutcome('<html>'), 'retry');
});
t('file checks on the phone', () => {
  assert.strictEqual(DL.fileError('video', { type: 'video/mp4', size: 1000 }), '');
  assert.strictEqual(DL.fileError('video', { type: 'video/quicktime', size: 25 * 1048576 }), '');
  assert.match(DL.fileError('video', { type: 'video/mp4', size: 25 * 1048576 + 1 }), /larger than 25 MB/);
  assert.match(DL.fileError('video', { type: 'image/jpeg', size: 10 }), /MP4, MOV or 3GP/);
  assert.match(DL.fileError('video', { type: 'video/webm', size: 10 }), /MP4, MOV or 3GP/);
  assert.strictEqual(DL.fileError('bill', { type: 'image/jpeg', size: 3 * 1048576 }), '');
  assert.match(DL.fileError('bill', { type: 'image/jpeg', size: 3 * 1048576 + 1 }), /larger than 3 MB/);
  assert.match(DL.fileError('bill', { type: 'application/pdf', size: 10 }), /photo/);
});

console.log('driver fuel: all checks passed');
