// apps-script/driver-fill-confirm.gs: the Fee Clerk's list of driver fuel fills (scoped to the caller's campuses) and the one-tap
// confirm / reject (idempotent, a reject needs a reason, no typed text reaches a cell as a formula). Runs the real .gs files in a vm
// with stubbed Sheets and Lock. Fictional data only.
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const gs = (f) => fs.readFileSync(path.join(__dirname, '../../apps-script', f), 'utf8').replace(/^const /gm, 'var ');

const HEAD = ['Fill ID', 'Reg', 'Campus', 'Driver Link ID', 'Driver Name', 'Filled At', 'Litres', 'Amount', 'Odometer',
  'Bill File ID', 'Video File ID', 'Received', 'Status', 'Confirmed At', 'Confirmed By', 'Day Book Entry ID'];
const row = (id, reg, campus, status, decided) => [id, reg, campus, 'DL-x', 'Test Driver', new Date('2026-10-27T03:00:00Z'), 40, 3800, 52000,
  'B-' + id, 'V-' + id, new Date('2026-10-27T03:05:00Z'), status, decided || '', decided ? 'c@x.test' : '', ''];
const tabs = { 'Driver Fills': [HEAD.slice(),
  row('Fpending1', 'HP659511', 'LMS4', 'pending'),
  row('Fpending2', 'HP665805', 'LMS1', 'pending'),
  row('Fold00001', 'HP659511', 'LMS4', 'confirmed', new Date(Date.now() - 30 * 86400000)), // decided a month ago: off the list
  row('Frecent01', 'HP659511', 'LMS4', 'rejected', new Date(Date.now() - 2 * 86400000))] };
const mkSheet = (n) => ({ appendRow: (r) => tabs[n].push(r.slice()), setFrozenRows() {},
  getDataRange: () => ({ getValues: () => tabs[n].map((r) => r.slice()) }),
  getRange: (r, c, nr) => ({ setFontWeight() {},
    setValues: (v) => { v.forEach((rw, i) => rw.forEach((x, j) => { tabs[n][r - 1 + i][c - 1 + j] = x; })); },
    setValue: (x) => { tabs[n][r - 1][c - 1] = x; } }) });
const ss = { getSheetByName: (n) => (tabs[n] ? mkSheet(n) : null), insertSheet(n) { tabs[n] = []; return mkSheet(n); } };
const CALLERS = { clerk4: { email: 'c4@x.test', campusId: 'LMS4', roles: ['FeeClerk'], role: 'FeeClerk' },
  clerk1: { email: 'c1@x.test', campusId: 'LMS1', roles: ['FeeClerk'], role: 'FeeClerk' },
  owner: { email: 'o@x.test', campusId: 'ALL', roles: ['Owner'], role: 'Owner' } };
const ctx = { console, Date, Object, String, Math, JSON, Array, Number, RegExp, isFinite, isNaN,
  SpreadsheetApp: { openById: () => ss },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) },
  verifyStaffManagerToken_: (t) => CALLERS[t] || null };
vm.createContext(ctx);
['transport-uploads.gs', 'driver-link.gs', 'driver-fuel.gs', 'driver-fill-confirm.gs'].forEach((f) => vm.runInContext(gs(f), ctx));
const call = (fn, body) => JSON.parse(JSON.stringify(vm.runInContext(fn + '(' + JSON.stringify(body) + ')', ctx)));
const fillRow = (id) => tabs['Driver Fills'].find((r) => r[0] === id);
const t = (name, fn) => { fn(); console.log('ok  ' + name); };

t('list: pending and recently decided fills of the caller\'s campuses only, with Drive ids', () => {
  const four = call('driverFillList_', { idToken: 'clerk4' });
  assert.deepStrictEqual(four.fills.map((f) => f.fillId), ['Fpending1', 'Frecent01']);
  const f = four.fills[0];
  assert.deepStrictEqual([f.reg, f.campus, f.driverName, f.litres, f.amount, f.odometer, f.billFileId, f.videoFileId, f.status],
    ['HP659511', 'LMS4', 'Test Driver', 40, 3800, 52000, 'B-Fpending1', 'V-Fpending1', 'pending']);
  assert.strictEqual(f.filledAt, '2026-10-27T03:00:00.000Z');
  assert.deepStrictEqual(call('driverFillList_', { idToken: 'clerk1' }).fills.map((x) => x.fillId), ['Fpending2']);
  assert.strictEqual(call('driverFillList_', { idToken: 'owner' }).fills.length, 3);
  assert.strictEqual(call('driverFillList_', { idToken: 'nobody' }).error, 'Not authorized');
});

t('decide: another campus\'s fill is refused and left as it is', () => {
  assert.ok(/own campuses/.test(call('driverFillDecide_', { idToken: 'clerk1', fillId: 'Fpending1', decision: 'confirm' }).error));
  assert.strictEqual(fillRow('Fpending1')[12], 'pending');
  assert.strictEqual(call('driverFillDecide_', { idToken: 'clerk4', fillId: 'Fnope0000', decision: 'confirm' }).error, 'Fill not found');
  assert.strictEqual(call('driverFillDecide_', { idToken: 'clerk4', fillId: 'Fpending1', decision: 'maybe' }).error, 'Bad decision');
});

t('confirm: status, Confirmed At/By; a repeat tap changes nothing; reject after confirm is refused', () => {
  assert.deepStrictEqual(call('driverFillDecide_', { idToken: 'clerk4', fillId: 'Fpending1', decision: 'confirm' }),
    { success: true, fillId: 'Fpending1', status: 'confirmed' });
  const r = fillRow('Fpending1'), at = r[13];
  assert.deepStrictEqual([r[12], r[14], r[15]], ['confirmed', 'c4@x.test', '']);
  assert.ok(at instanceof Date);
  assert.ok(call('driverFillDecide_', { idToken: 'clerk4', fillId: 'Fpending1', decision: 'confirm' }).success);
  assert.strictEqual(fillRow('Fpending1')[13], at, 'the repeat did not touch the row');
  assert.strictEqual(call('driverFillDecide_', { idToken: 'clerk4', fillId: 'Fpending1', decision: 'reject', reason: 'wrong bill' }).error, 'This fill is already confirmed');
});

t('a confirmed fill still counts for the bus\'s last odometer (it is not in the Fuel Fills mirror yet)', () => {
  assert.strictEqual(vm.runInContext('dflLast_("HP659511")', ctx).lastOdometer, 52000);
});

t('reject needs a reason; the reason is formula-safe and goes in its own column', () => {
  ['', '  ', 'no', '=='].forEach((reason) => assert.ok(/why/.test(call('driverFillDecide_', { idToken: 'clerk1', fillId: 'Fpending2', decision: 'reject', reason }).error), JSON.stringify(reason)));
  assert.strictEqual(fillRow('Fpending2')[12], 'pending');
  assert.ok(call('driverFillDecide_', { idToken: 'clerk1', fillId: 'Fpending2', decision: 'reject', reason: '=HYPERLINK("x")\n bill   is blurred' }).success);
  const head = tabs['Driver Fills'][0];
  assert.strictEqual(head[16], 'Reject Reason');
  assert.strictEqual(fillRow('Fpending2')[16], 'HYPERLINK("x") bill is blurred');
  assert.strictEqual(fillRow('Fpending2')[12], 'rejected');
  assert.ok(call('driverFillDecide_', { idToken: 'clerk1', fillId: 'Fpending2', decision: 'reject', reason: 'again' }).success, 'a repeat reject is a no-op');
  assert.strictEqual(fillRow('Fpending2')[16], 'HYPERLINK("x") bill is blurred');
  assert.strictEqual(call('driverFillList_', { idToken: 'clerk1' }).fills[0].reason, 'HYPERLINK("x") bill is blurred');
  tabs['Driver Fills'].forEach((r) => r.forEach((c) => assert.ok(typeof c !== 'string' || !/^[=+\-@]/.test(c), 'formula-like cell ' + c)));
});
