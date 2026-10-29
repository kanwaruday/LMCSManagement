// apps-script/driver-link.gs: linking a driver's phone to a driver and bus (create, revoke, list, driverme) and the deviceToken path of
// capture (transport-capture.gs's capAuth_). Only the token's hash is stored, list never leaks it, and an unknown and a revoked token
// get the same error. Runs the real .gs files in a vm with stubbed Sheets, Cache, Lock and Utilities. Fictional names only.
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path'), crypto = require('crypto');
const gs = (f) => fs.readFileSync(path.join(__dirname, '../../apps-script', f), 'utf8').replace(/^const /gm, 'var ');

const tabs = {
  'LM Studio Fleet': [['Reg', 'Bus', 'Campus'], ['HP659511', 'Bus 4', 'LMS 4'], ['HP665805', 'Bus 1', 'LMS 1']],
  'Capture Stops': [['runId', 'reg', 'campus', 'videoFileId', 'stops', 'pushedAt', 'capturedBy'],
    ['HP659511-20261020-071500-aa11', 'HP659511', 'LMS4', 'VID1xxxxxxxxxx', '[]', 'x', 'c4@lms.org.in'],
    ['HP659511-20261021-071500-bb22', 'HP659511', 'LMS4', '', '[]', 'x', ''],
    ['HP665805-20261021-071500-cc33', 'HP665805', 'LMS1', 'VID2xxxxxxxxxx', '[]', 'x', '']],
  'Fuel Fills': [['id', 'campus', 'date', 'reg', 'litres', 'odometer', 'amount_rs', 'odometer_note', 'hasVideo', 'hasBill'],
    ['f1', 'LMS4', '2026-10-10', 'HP659511', '40', '51000', '3800', '', 'yes', 'yes'],
    ['f2', 'LMS4', '2026-10-20', 'HP659511', '42', '51600', '3990', '', 'yes', 'yes'],
    ['f3', 'LMS1', '2026-10-25', 'HP665805', '30', '90000', '2850', '', 'no', 'no']],
};
const mkSheet = (n) => ({ appendRow: (r) => tabs[n].push(r.slice()), setFrozenRows() {}, getLastColumn: () => Math.max(0, ...tabs[n].map((r) => r.length)),
  getDataRange: () => ({ getValues: () => tabs[n].map((r) => r.slice()) }),
  getRange: (r, c, nr, nc) => ({ setFontWeight() {},
    setValues: (v) => { v.forEach((row, i) => row.forEach((x, j) => { tabs[n][r - 1 + i][c - 1 + j] = x; })); },
    setValue: (x) => { tabs[n][r - 1][c - 1] = x; }, getValue: () => tabs[n][r - 1][c - 1] }) });
const ss = { getSheetByName: (n) => (tabs[n] ? mkSheet(n) : null), insertSheet(n) { tabs[n] = []; return mkSheet(n); } };
let caller = null, uuid = 0;
const cache = {};
const ctx = { console, Date, Object, String, Math, JSON, Array, Number, RegExp, isFinite,
  SpreadsheetApp: { openById: () => ss },
  DriveApp: { getFolderById: () => { throw new Error('no Drive in this test'); } },
  CacheService: { getScriptCache: () => ({ get: (k) => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Utilities: { getUuid: () => crypto.randomUUID(), formatDate: () => 'x',
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(s, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)) },
  verifyStaffManagerToken_: () => caller, HIR_EMPCODE_RE_: /^([A-Z]{3})\/(\d{2})\/(\d{2})\/(\d{3,})$/ };
vm.createContext(ctx);
vm.runInContext(gs('transport-uploads.gs'), ctx);
vm.runInContext(gs('transport-capture.gs'), ctx);
vm.runInContext(gs('driver-token.gs'), ctx);
vm.runInContext(gs('driver-link.gs'), ctx);
vm.runInContext(gs('driver-fuel.gs'), ctx);
vm.runInContext(gs('driver-google.gs'), ctx);
const call = (fn, body) => JSON.parse(JSON.stringify(vm.runInContext(fn + '(' + JSON.stringify(body) + ')', ctx)));
const rows = () => tabs['Driver Devices'].slice(1);
const UNLINKED = 'This phone is not linked. Ask the office for a new link.';
const clerk4 = { email: 'f4@lms.org.in', campusId: 'LMS4', roles: ['FeeClerk'], role: 'FeeClerk' };
const clerk1 = { email: 'f1@lms.org.in', campusId: 'LMS1', roles: ['FeeClerk'], role: 'FeeClerk' };

// who may create
caller = null;
assert.strictEqual(call('driverLinkCreate_', { idToken: 't', reg: 'HP659511', driverName: 'Test Driver' }).error, 'Not authorized');
caller = clerk1;
assert.match(call('driverLinkCreate_', { idToken: 't', reg: 'HP659511', driverName: 'Test Driver' }).error, /own campuses/, 'another campus\'s Fee Clerk is refused');
caller = clerk4;
assert.match(call('driverLinkCreate_', { idToken: 't', reg: 'HP000', driverName: 'Test Driver' }).error, /not in the fleet/);
[['', /name/], ['Test<b>', /letters/], ['=HYPERLINK("x")', /letters/], ['A'.repeat(61), /60/]].forEach(([n, re]) =>
  assert.match(call('driverLinkCreate_', { idToken: 't', reg: 'HP659511', driverName: n }).error, re, JSON.stringify(n)));
assert.match(call('driverLinkCreate_', { idToken: 't', reg: 'HP659511', driverName: 'Test Driver', driverCode: 'nope' }).error, /employee code/);

// create: the token comes back once, only its hash is stored
const c1 = call('driverLinkCreate_', { idToken: 't', reg: 'hp 65 9511', driverName: '  Test   Driver ', driverCode: 'tst/01/02/003' });
assert.strictEqual(c1.success, true, JSON.stringify(c1));
assert.match(c1.token, /^[a-f0-9]{64}$/, '256 hex bits of token');
assert.strictEqual(rows().length, 1);
const r1 = rows()[0];
assert.deepStrictEqual([r1[0], r1[2], r1[3], r1[4], r1[5], r1[7]], [c1.linkId, 'HP659511', 'LMS4', 'TST/01/02/003', 'Test Driver', 'f4@lms.org.in']);
assert.strictEqual(r1[1], 'sha256:' + crypto.createHash('sha256').update(c1.token).digest('hex'), 'the hash is stored');
assert.ok(!JSON.stringify(tabs['Driver Devices']).includes(c1.token), 'the token itself is stored nowhere');

// list: never the token or the hash; scoped to the caller's campuses
const l1 = call('driverLinkList_', { idToken: 't' });
assert.strictEqual(l1.links.length, 1);
assert.deepStrictEqual(Object.keys(l1.links[0]).sort(), ['campus', 'created', 'createdBy', 'driverName', 'lastSeen', 'linkId', 'reg', 'revoked']);
assert.ok(!JSON.stringify(l1).includes(c1.token) && !JSON.stringify(l1).includes(r1[1].slice(7)), 'list leaks no token or hash');
caller = clerk1;
assert.strictEqual(call('driverLinkList_', { idToken: 't' }).links.length, 0, 'another campus sees none');
assert.match(call('driverLinkRevoke_', { idToken: 't', linkId: c1.linkId }).error, /own campuses/);
caller = null;
assert.strictEqual(call('driverLinkList_', { idToken: 't' }).error, 'Not authorized');

// driverme happy path
const me = call('driverMe_', { deviceToken: c1.token });
assert.deepStrictEqual(me, { success: true, name: 'Test Driver', reg: 'HP659511', campus: 'LMS4', runsNeeded: 1, runsDone: 1, lastFill: '2026-10-20', lastOdometer: 51600, view: false });
assert.ok(rows()[0][10] instanceof Date, 'Last Seen written');
const seen = rows()[0][10];
call('driverMe_', { deviceToken: c1.token });
assert.strictEqual(rows()[0][10], seen, 'Last Seen at most once an hour');

// driverroute: the linked bus's own stops and tracks, nothing of another bus (not even its name in shared_with), no money
tabs['GPS Stops'] = [['bus', 'trip', 'seq', 'kind', 'place', 'arrive_usual', 'days_seen', 'run_days', 'shared_with', 'lat', 'lng'],
  ['HP659511', 'AM-1', 1, 'stop', 'Village A', '07:10', 9, 10, 'HP665805', 31.6, 76.9], ['HP665805', 'AM-1', 1, 'stop', 'Village B', '07:00', 9, 10, '', 31.9, 77.1]];
tabs['GPS Tracks'] = [['reg', 'trip', 'date', 'path'], ['HP659511', 'AM-1', '2026-10-22', '[[31.6,76.9],[31.61,76.91]]'], ['HP665805', 'AM-1', '2026-10-22', '[[31.9,77.1]]'],
  ['HP659511', 'PM-1', '2026-10-22', 'not json']];
const rt = call('driverRoute_', { deviceToken: c1.token });
assert.strictEqual(rt.success, true);
assert.deepStrictEqual(rt.stops.map((x) => [x.bus, x.place, x.shared_with]), [['HP659511', 'Village A', '']], 'own stops only; the other bus is not named');
assert.deepStrictEqual(rt.tracks.map((t) => [t.trip, t.path.length]), [['AM-1', 2], ['PM-1', 0]], 'own tracks only; a bad cell is an empty path');
assert.deepStrictEqual(rt.vehicles.map((v) => v.reg), ['HP659511']);
assert.ok(!('pnl' in rt) && !('proposals' in rt), 'no money');
assert.deepStrictEqual(call('driverRoute_', { deviceToken: 'f'.repeat(64) }), { success: false, code: 'UNLINKED', error: call('driverMe_', { deviceToken: 'f'.repeat(64) }).error }, 'an unknown token: the same UNLINKED answer as driverme');
delete tabs['GPS Stops']; delete tabs['GPS Tracks'];
assert.deepStrictEqual([call('driverRoute_', { deviceToken: c1.token }).stops.length, call('driverRoute_', { deviceToken: c1.token }).tracks.length], [0, 0], 'no GPS tabs yet: an empty route');

// driverme survives a missing fuel mirror and capture tab
const keepFills = tabs['Fuel Fills'], keepStops = tabs['Capture Stops'];
delete tabs['Fuel Fills']; delete tabs['Capture Stops'];
const bare = call('driverMe_', { deviceToken: c1.token });
assert.deepStrictEqual([bare.success, bare.runsDone, bare.lastFill, bare.lastOdometer], [true, 0, null, null]);
tabs['Fuel Fills'] = keepFills; tabs['Capture Stops'] = keepStops;

// re-create for the same driver code revokes the earlier link; unknown and revoked tokens get the same error
caller = clerk4;
const c2 = call('driverLinkCreate_', { idToken: 't', reg: 'HP659511', driverName: 'Test Driver', driverCode: 'TST/01/02/003' });
assert.strictEqual(c2.success, true);
assert.ok(rows()[0][8] instanceof Date && rows()[0][9] === 'f4@lms.org.in', 'the earlier link is revoked');
assert.ok(!rows()[1][8], 'the new one is active');
const unknown = call('driverMe_', { deviceToken: 'f'.repeat(64) }), revoked = call('driverMe_', { deviceToken: c1.token });
assert.deepStrictEqual(revoked, { success: false, code: 'UNLINKED', error: UNLINKED });
assert.deepStrictEqual(unknown, revoked, 'unknown and revoked look the same');
assert.deepStrictEqual(call('driverMe_', { deviceToken: 'garbage' }), revoked);
assert.deepStrictEqual(call('driverMe_', {}), revoked);
assert.strictEqual(call('driverMe_', { deviceToken: c2.token }).success, true);
// with no code: the same name on the same bus is the same driver
const n1 = call('driverLinkCreate_', { idToken: 't', reg: 'HP659511', driverName: 'Other Driver' });
const n2 = call('driverLinkCreate_', { idToken: 't', reg: 'HP659511', driverName: 'other driver' });
assert.strictEqual(call('driverMe_', { deviceToken: n1.token }).success, false, 'same name, same bus, no code: replaced');
assert.strictEqual(call('driverMe_', { deviceToken: n2.token }).success, true);
assert.strictEqual(call('driverMe_', { deviceToken: c2.token }).success, true, 'a different driver keeps their link');

// revoke: idempotent; the list keeps revoked links for 30 days
assert.deepStrictEqual(call('driverLinkRevoke_', { idToken: 't', linkId: n2.linkId }), { success: true });
assert.deepStrictEqual(call('driverLinkRevoke_', { idToken: 't', linkId: n2.linkId }), { success: true }, 'again: still fine');
assert.strictEqual(call('driverMe_', { deviceToken: n2.token }).error, UNLINKED);
assert.match(call('driverLinkRevoke_', { idToken: 't', linkId: 'DL-nope' }).error, /not found/);
tabs['Driver Devices'][1][8] = new Date(Date.now() - 31 * 86400000);
const l2 = call('driverLinkList_', { idToken: 't' });
assert.deepStrictEqual(l2.links.map((l) => l.linkId).sort(), [c2.linkId, n1.linkId, n2.linkId].sort(), 'revoked over 30 days ago drops off');
assert.ok(l2.links.find((l) => l.linkId === n2.linkId).revoked, 'a revoked link says so');

// capture with a deviceToken: own bus timelapse only
const JPG = Buffer.concat([Buffer.from('FFD8FFE0', 'hex'), Buffer.alloc(8)]).toString('base64');
const files = [];
ctx.Utilities.base64Decode = (s) => Array.from(Buffer.from(s, 'base64')).map((b) => (b > 127 ? b - 256 : b));
ctx.Utilities.newBlob = (bytes, mime, name) => ({ name });
ctx.capFolder_ = () => ({ getFilesByName: () => ({ hasNext: () => false }),
  createFile: (b) => { const f = { name: b.name, desc: '', getId: () => 'FILE' + files.length, setDescription(d) { f.desc = d; } }; files.push(f); return f; } });
caller = null; // no staff token in play
const frame = (o) => call('captureFile_', Object.assign({ deviceToken: c2.token, reg: 'HP659511', runId: 'D1', runKind: 'timelapse', kind: 'frame', seq: 1, base64: JPG }, o));
const cr = (r, o) => call('captureRun_', Object.assign({ deviceToken: c2.token, run: Object.assign({ runId: 'D1', reg: 'HP659511', kind: 'timelapse', status: 'running' }, r) }, o));
assert.strictEqual(frame({}).success, true, 'own bus timelapse frame');
assert.match(files[0].desc, /driver:DL-/, 'the file says which link sent it');
assert.strictEqual(frame({ kind: 'stop', seq: 2 }).success, true, 'own bus stop photo');
assert.match(frame({ reg: 'HP665805', runId: 'D2' }).error, /only send for bus HP659511/, 'another bus refused');
assert.match(frame({ runKind: 'inspection', kind: 'inspection', runId: 'D3' }).error, /only route videos/, 'safety check refused');
assert.match(frame({ runKind: 'profile', kind: 'profile', runId: 'D4' }).error, /only route videos/, 'profile photo refused');
assert.match(frame({ runKind: 'count', runId: 'D5' }).error, /only route videos/, 'count run refused');
assert.strictEqual(frame({ deviceToken: c1.token }).error, UNLINKED, 'revoked phone: the same error as unknown');
assert.strictEqual(frame({ deviceToken: 'a'.repeat(64) }).error, UNLINKED);
assert.strictEqual(cr({}).success, true, 'own bus timelapse manifest');
const run = tabs['Capture Runs'].find((r) => r[0] === 'D1');
assert.deepStrictEqual([run[1], run[2], run[6].slice(0, 10), run[7], run[14]], ['HP659511', 'LMS4', 'driver:DL-', 'Driver', 'Test Driver'], 'Captured By is the driver\'s name');
assert.strictEqual(cr({ status: 'ended', capturedBy: 'someone@lms.org.in' }).success, true);
assert.strictEqual(tabs['Capture Runs'].find((r) => r[0] === 'D1')[14], 'Test Driver', 'a driver cannot credit someone else');
assert.match(cr({ runId: 'D6', kind: 'inspection' }).error, /only route videos/);
assert.match(cr({ runId: 'D7', reg: 'HP665805' }).error, /only send for bus/);

// staff idToken path unchanged (an idToken wins over a deviceToken)
caller = clerk1;
assert.match(frame({ idToken: 't', runId: 'S1' }).error, /own campuses/, 'a staff token is judged as staff');
assert.strictEqual(frame({ idToken: 't', deviceToken: undefined, reg: 'HP665805', runId: 'S2', runKind: 'profile', kind: 'profile', seq: 0 }).success, true, 'staff still send profile photos');
caller = null;
assert.strictEqual(frame({ idToken: 't', runId: 'S3' }).error, 'Not authorized');
assert.strictEqual(frame({ deviceToken: undefined, runId: 'S4' }).error, 'Not authorized', 'no token at all');

// one phone per driver stays inside the caller's campuses: an LMS 1 clerk reusing an LMS 4 driver's code unlinks nobody there
const lms4Active = () => rows().filter((r) => r[2] === 'HP659511' && r[4] === 'TST/01/02/003' && !r[8]).length;
const before = lms4Active();
caller = clerk1;
assert.strictEqual(call('driverLinkCreate_', { idToken: 't', reg: 'HP665805', driverName: 'Test Driver', driverCode: 'TST/01/02/003' }).success, true);
assert.ok(before > 0 && lms4Active() === before, 'the LMS 4 link is untouched');

// the staff view (29 Oct): the Owner or a Coordinator sees a running bus as its driver, read only; Driver Devices never changes
tabs['LM Studio Fleet'] = [['Reg', 'Bus', 'Campus', 'Operational', 'Route', 'Start', 'Driver'], ['HP 65 9511', 'Bus 4', 'LMS 4', 'yes', '', '', 'Test Driver'],
  ['HP665805', 'Bus 1', 'LMS 1', 'no', '', '', '']];
const devBefore = JSON.stringify(tabs['Driver Devices']);
const owner = { email: 'o@x', campusId: 'ALL', roles: ['Owner'] }, coord = { email: 'c@x', campusId: 'LMS5', roles: ['Coordinator', 'Teacher'] };
caller = owner;
const v = call('driverMe_', { viewReg: 'hp 659511', idToken: 't' });
assert.deepStrictEqual([v.success, v.reg, v.campus, v.name, v.view, v.lastFill], [true, 'HP659511', 'LMS4', 'Test Driver', true, '2026-10-20'], 'the Owner sees what the driver sees');
assert.strictEqual(call('driverRoute_', { viewReg: 'HP659511', idToken: 't' }).vehicles[0].reg, 'HP659511');
assert.deepStrictEqual(call('driverViewBuses_', { idToken: 't' }).buses.map((b) => b.reg), ['HP659511'], 'running buses only');
caller = coord;
assert.strictEqual(call('driverMe_', { viewReg: 'HP659511', idToken: 't' }).success, true, 'a Coordinator too');
assert.deepStrictEqual(call('driverMe_', { viewReg: 'HP665805', idToken: 't' }), revoked, 'a parked bus: no view');
tabs['LM Studio Fleet'][2][3] = 'yes'; // Bus 1 (LMS 1) running: another district
assert.deepStrictEqual(call('driverMe_', { viewReg: 'HP665805', idToken: 't' }), revoked, 'a Coordinator: their own district only');
assert.deepStrictEqual(call('driverRoute_', { viewReg: 'HP665805', idToken: 't' }), revoked);
assert.deepStrictEqual(call('driverViewBuses_', { idToken: 't' }).buses.map((b) => b.reg), ['HP659511'], 'their district\'s buses only');
caller = owner;
assert.strictEqual(call('driverViewBuses_', { idToken: 't' }).buses.length, 2, 'the Owner: every campus');
[{ email: 'p@x', campusId: 'ALL', roles: ['Principal'] }, clerk4, null].forEach((c) => {
  caller = c;
  assert.deepStrictEqual(call('driverMe_', { viewReg: 'HP659511', idToken: 't' }), revoked, 'not the Owner or a Coordinator: ' + JSON.stringify(c && c.roles));
  assert.deepStrictEqual(call('driverRoute_', { viewReg: 'HP659511', idToken: 't' }), revoked);
  assert.strictEqual(call('driverViewBuses_', { idToken: 't' }).success, false);
});
caller = owner;
assert.deepStrictEqual(call('driverMe_', { viewReg: 'HP659511' }), revoked, 'no Google token: no view');
assert.deepStrictEqual(call('driverMe_', { viewReg: 'HP659511', idToken: 't', deviceToken: 'f'.repeat(64) }), revoked, 'a device token is judged alone');
assert.strictEqual(call('driverFuel_', { viewReg: 'HP659511', idToken: 't', fillId: 'Fview0000001', litres: '40', amount: '3800', odometer: '52000' }).code, 'UNLINKED', 'a staff view cannot send a fill');
assert.strictEqual(JSON.stringify(tabs['Driver Devices']), devBefore, 'Driver Devices untouched: no link made, no Last Seen written');

console.log('driver link: all checks passed');
