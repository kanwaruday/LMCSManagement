// apps-script/driver-google.gs: a driver's own Google sign-in links their phone like a QR. Only a verified account of our client
// whose AuthEmail belongs to an active Transport driver with exactly one running bus gets a link; every other case gets one answer;
// the earlier phone is unlinked; only the hash is stored; nothing is logged; the Fee Clerk's list carries a count only.
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path'), crypto = require('crypto');
const gs = (f) => fs.readFileSync(path.join(__dirname, '../../apps-script', f), 'utf8').replace(/^const /gm, 'var ');
const ROSTER = 'roster-book', TRANSPORT = '1VXTMZjqCS82ftB1rwoN4BzoiOTP7-Vg0m5vTH01Tfzc';
const books = {
  [ROSTER]: {
    EmpSalary: [['EmployeeCode', 'Department', 'Designation'], ['KUL/19/07/001', 'Transport', 'Driver Cum Peon'], ['KUL/19/07/002', 'Transport', 'Driver Cum Peon'],
      ['KUL/19/07/003', 'Teaching', 'TGT'], ['KUL/19/07/004', 'Transport', 'Driver Cum Peon'], ['KUL/19/07/005', 'Transport', 'Driver Cum Peon'], ['KEL/20/01/006', 'Transport', 'Driver Cum Peon']],
    EmpMaster: [['EmployeeCode', 'Name', 'Status'], ['KUL/19/07/001', 'Test Driver', 'Active'], ['KUL/19/07/002', 'Left Driver', 'Inactive'],
      ['KUL/19/07/003', 'A Teacher', 'Active'], ['KUL/19/07/004', 'Two Bus', 'Active'], ['KUL/19/07/005', '', 'Active'], ['KEL/20/01/006', 'Kel Driver', 'Active']],
    EmpPersonal: [['EmployeeCode', 'AuthEmail'], ['KUL/19/07/001', 'Driver.One@Gmail.com '], ['KUL/19/07/002', 'left@gmail.com'], ['KUL/19/07/003', 'teacher@gmail.com'],
      ['KUL/19/07/004', 'two@gmail.com'], ['KUL/19/07/005', 'noname@gmail.com'], ['KEL/20/01/006', 'kel@gmail.com']]
  },
  [TRANSPORT]: {
    'LM Studio Fleet': [['Reg', 'Bus', 'Campus', 'Operational', 'Route', 'Start', 'Driver', 'Seats', 'Year', 'DriverCode'],
      ['HP 65 9511', 'Bus 4', 'LMS 1', 'yes', '18', '', 'Test Driver', 32, 2017, 'KUL/19/07/001'],
      ['HP111', 'Bus 5', 'LMS 1', 'yes', '', '', 'Two Bus', 32, 2017, 'KUL/19/07/004'], ['HP222', 'Bus 6', 'LMS 1', 'yes', '', '', 'Two Bus', 32, 2017, 'KUL/19/07/004'],
      ['HP333', 'Bus 7', 'LMS 1', 'yes', '', '', '', 32, 2017, 'KUL/19/07/005'], ['HP444', 'Bus 8', 'LMS 2', 'no', '', '', '', 32, 2017, 'KEL/20/01/006'],
      ['HP555', 'Bus 9', 'LMS 1', 'yes', '', '', '', 32, 2017, 'KUL/19/07/002']],
    'Driver Devices': [['Link ID', 'Token Hash', 'Reg', 'Campus', 'Driver Code', 'Driver Name', 'Created', 'Created By', 'Revoked', 'Revoked By', 'Last Seen'],
      ['DL-old', 'sha256:old', 'HP659511', 'LMS1', 'KUL/19/07/001', 'Test Driver', '', 'clerk@x', '', '', '']]
  }
};
const sheet = (rows) => ({ getDataRange: () => ({ getValues: () => rows.map((r) => r.slice()) }), appendRow: (r) => rows.push(r.slice()),
  getRange: (r, c, nr, nc) => ({ setValues: (v) => v.forEach((row, i) => row.forEach((x, j) => { rows[r - 1 + i][c - 1 + j] = x; })), setFontWeight() {} }), setFrozenRows() {} });
const tokens = { good: { aud: 'CID', email_verified: 'true', email: 'driver.one@gmail.com' }, unverified: { aud: 'CID', email_verified: 'false', email: 'driver.one@gmail.com' },
  otheraud: { aud: 'OTHER', email_verified: 'true', email: 'driver.one@gmail.com' }, teacher: { aud: 'CID', email_verified: 'true', email: 'teacher@gmail.com' },
  left: { aud: 'CID', email_verified: 'true', email: 'left@gmail.com' }, two: { aud: 'CID', email_verified: 'true', email: 'two@gmail.com' },
  noname: { aud: 'CID', email_verified: 'true', email: 'noname@gmail.com' }, kel: { aud: 'CID', email_verified: 'true', email: 'kel@gmail.com' },
  stranger: { aud: 'CID', email_verified: 'true', email: 'someone@gmail.com' } };
const logs = [];
const ctx = { Date, Object, String, Math, JSON, Array, Number, RegExp, isFinite,
  console: { log: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')) },
  SpreadsheetApp: { openById: (id) => ({ getSheetByName: (n) => (books[id] && books[id][n] ? sheet(books[id][n]) : null), insertSheet: () => { throw new Error('no'); } }) },
  UrlFetchApp: { fetch: (u) => { const t = decodeURIComponent(u.split('id_token=')[1]); const p = tokens[t]; return { getResponseCode: () => (p ? 200 : 400), getContentText: () => JSON.stringify(p || {}) }; } },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) }, CacheService: { getScriptCache: () => ({ get: () => '1', put() {} }) },
  Utilities: { getUuid: () => crypto.randomUUID(), DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(s, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)) },
  STAFF_GOOGLE_CLIENT_ID: 'CID', EMP_ROSTER_SHEET_ID: ROSTER, verifyStaffManagerToken_: () => ({ email: 'clerk@x', campusId: 'LMS1', roles: ['FeeClerk'] }) };
vm.createContext(ctx);
['transport-uploads.gs', 'driver-token.gs', 'driver-link.gs', 'driver-fuel.gs', 'driver-google.gs'].forEach((f) => vm.runInContext(gs(f), ctx));
const call = (fn, b) => JSON.parse(JSON.stringify(vm.runInContext(fn + '(' + JSON.stringify(b) + ')', ctx)));
const devices = books[TRANSPORT]['Driver Devices'];

const ok = call('driverLinkSelf_', { idToken: 'good' });
assert.strictEqual(ok.success, true);
assert.match(ok.token, /^[a-f0-9]{64}$/);
const row = devices[devices.length - 1];
assert.deepStrictEqual([row[2], row[3], row[4], row[5], row[7]], ['HP659511', 'LMS1', 'KUL/19/07/001', 'Test Driver', 'google:self'], 'a link for the driver\'s own bus, marked as self');
assert.strictEqual(row[1], 'sha256:' + crypto.createHash('sha256').update(ok.token, 'utf8').digest('hex'), 'only the hash is stored');
assert.ok(!JSON.stringify(devices).includes(ok.token), 'never the token');
assert.deepStrictEqual([devices[1][9], !!devices[1][8]], ['google:self', true], 'the earlier phone is unlinked, as a new QR does');
assert.strictEqual(call('driverMe_', { deviceToken: ok.token }).reg, 'HP659511', 'the new link works like a QR link');

const refuse = call('driverLinkSelf_', { idToken: 'stranger' });
assert.deepStrictEqual(Object.keys(refuse).sort(), ['error', 'success']);
['unverified', 'otheraud', 'teacher', 'left', 'two', 'kel', 'nonsense', ''].forEach((t) =>
  assert.deepStrictEqual(call('driverLinkSelf_', { idToken: t }), refuse, 'one answer for ' + (t || 'no token')));
assert.strictEqual(call('driverLinkSelf_', { idToken: 'noname' }).success, true, 'an active driver with no name on file still gets in');
assert.strictEqual(devices[devices.length - 1][5], 'Driver', 'and is listed as Driver');
assert.deepStrictEqual(logs, [], 'nothing logged');

const list = call('driverLinkList_', { idToken: 'clerk' });
assert.strictEqual(list.googleReady, 2, 'a count: the drivers of one running bus each with an email (not the two-bus driver, the parked bus or the inactive driver)');
assert.ok(!/gmail/i.test(JSON.stringify(list)), 'no address on the list');
console.log('driver google: all checks passed');
