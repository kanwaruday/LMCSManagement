// node tests/roster/test-game-staff-master.js -- gameStaffMaster: lms-game's keyed, read-only staff export (staff-master / staff-links --roster).
// Loads the WHOLE Roster project (projects.json) in a vm as one load check, with fake services; synthetic rows only (public repo).
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const here = path.join(__dirname, '../../apps-script');
const projects = JSON.parse(fs.readFileSync(path.join(here, 'projects.json'), 'utf8'));
const KEY = 'k'.repeat(40);

const sheet = (rows) => ({ getDataRange: () => ({ getDisplayValues: () => rows, getValues: () => rows }) });
const EMP = {
  EmpMaster: sheet([['EmployeeCode', 'Name', 'SchoolCode', 'DateOfJoining', 'ReportsTo', 'DateOfBirth', 'Phone'], ['T/1', 'Staff Alpha', 'S1', '01/04/2019', 'T/2', '1990-01-01', '9999999999'], ['T/2', 'Staff Beta', 'S1', '', '', '1980-02-02', '8888888888']]),
  EmpPersonal: sheet([['EmployeeCode', 'AuthEmail', 'Aadhaar', 'Address'], ['T/1', 'alpha@x.test', '123412341234', 'Somewhere']]),
  EmpSalary: sheet([['EmployeeCode', 'Designation', 'Department', 'BankAccount'], ['T/1', 'HOD Maths', 'Academic', '0000111122223333']]),
  'Certificate Links': sheet([['Employee Code', 'Document Type', 'Filename', 'Drive Link', 'Status', 'Form Employee ID', 'Remarks'], ['T/1', 'Degree', 'd.pdf', 'https://drive.google.com/file/d/ABCDEFGHIJ1234/view', 'Matched', 'F1', 'private note']]),
};
const PAYID = fs.readFileSync(path.join(here, 'payroll.gs'), 'utf8').match(/PAY_SHEET_ID = '([^']+)'/)[1]; // the id the code falls back to is payroll.gs's own
const PAY = { 'Salary Master': sheet([['Employee Code', 'Name', 'Full Basic', 'Effective From', 'Bank Account No', 'IFSC', 'UAN', 'PAN', 'HOD Incentive'], ['T/1', 'Staff Alpha', '31000', '2026-04-01', '1234567890', 'ABCD0123456', '111122223333', 'ABCDE1234F', '1500']]) };

function boot({ props = { ROSTER_GAME_KEY: KEY, PAY_SHEET_ID: 'pay-sheet' } } = {}) {
  const P = Object.assign({}, props);
  const stub = () => new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : stub()), apply: () => stub(), construct: () => stub() });
  const ctx = { console: { log() {}, info() {}, warn() {}, error() {} }, JSON, Date, Math, Object, Array, String, Number, RegExp, Error, encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN };
  ['DriveApp', 'LockService', 'Logger', 'HtmlService', 'Session', 'MailApp', 'GmailApp', 'CalendarApp', 'Drive', 'UrlFetchApp', 'CacheService', 'Utilities'].forEach((s) => { ctx[s] = stub(); });
  ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => P[k] ?? null, setProperty: (k, v) => { P[k] = v; } }) };
  ctx.ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType: () => ({ body: s }), body: s }) };
  ctx.SpreadsheetApp = { openById: (id) => (id === 'pay-sheet' || id === PAYID ? { getSheetByName: (n) => PAY[n] || null } : { getSheetByName: () => null }) };
  vm.createContext(ctx);
  vm.runInContext(projects.roster.files.map((f) => fs.readFileSync(path.join(here, f.includes('/') ? f : f + '.gs'), 'utf8')).join('\n;\n'), ctx, { filename: 'roster.gs' }); // the whole-project load check
  ctx.openWorkbook_ = () => ({ getSheetByName: (n) => EMP[n] || null });
  ctx.hrfSelfSetup_ = () => {};
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).body);
  return { post, P, ctx };
}
const NO = { success: false, error: 'not_authorized' };

const r = boot();
for (const b of [{ action: 'gameStaffMaster' }, { action: 'gameStaffMaster', key: '' }, { action: 'gameStaffMaster', key: 'wrong' }, { action: 'gameStaffMaster', key: KEY.slice(1) }, { action: 'gameStaffMaster', key: KEY + 'x' }]) {
  assert.deepStrictEqual(r.post(b), NO, JSON.stringify(b));
}
assert.deepStrictEqual(boot({ props: {} }).post({ action: 'gameStaffMaster', key: '' }), NO, 'no key configured: refused, even an empty key');

const ok = r.post({ action: 'gameStaffMaster', key: KEY });
assert.strictEqual(ok.success, true);
assert.deepStrictEqual(Object.keys(ok.tabs).sort(), ['Certificate Links', 'EmpMaster', 'EmpPersonal', 'EmpSalary', 'SalaryMaster']);
assert.deepStrictEqual(Object.keys(ok.tabs.EmpMaster[0]), ['EmployeeCode', 'Name', 'SchoolCode', 'DateOfJoining', 'ReportsTo']);
assert.deepStrictEqual(Object.keys(ok.tabs.EmpPersonal[0]), ['EmployeeCode', 'AuthEmail']);
assert.deepStrictEqual(Object.keys(ok.tabs.EmpSalary[0]), ['EmployeeCode', 'Designation', 'Department']);
assert.deepStrictEqual(Object.keys(ok.tabs['Certificate Links'][0]), ['Employee Code', 'Document Type', 'Filename', 'Drive Link', 'Status']);
assert.deepStrictEqual(Object.keys(ok.tabs.SalaryMaster[0]), ['Employee Code', 'Full Basic', 'Effective From', 'HOD']);
// the HOD incentive leaves as a boolean only: no amount, no header text
assert.strictEqual(ok.tabs.SalaryMaster[0].HOD, true); assert.strictEqual(typeof ok.tabs.SalaryMaster[0].HOD, 'boolean');
assert.ok(!JSON.stringify(ok).includes('1500') && !JSON.stringify(ok).includes('HOD Incentive'), 'the incentive amount must not leave');
// the presence rule: blank, 0, no, false, - and nil are not an incentive
const rules = ['', '0', '0.00', 'No', 'false', '-', 'nil', ' ₹ 0 '].map((v) => { PAY['Salary Master'] = sheet([['Employee Code', 'Full Basic', 'HOD Allowance'], ['T/9', '1', v]]); return boot().post({ action: 'gameStaffMaster', key: KEY }).tabs.SalaryMaster[0].HOD; });
assert.deepStrictEqual(rules, [false, false, false, false, false, false, false, false]);
PAY['Salary Master'] = sheet([['Employee Code', 'Full Basic', 'HOD Allowance'], ['T/9', '1', '₹ 2,000'], ['T/8', '2', '']]);
assert.deepStrictEqual(boot().post({ action: 'gameStaffMaster', key: KEY }).tabs.SalaryMaster.map((x) => x.HOD), [true, false]);
PAY['Salary Master'] = sheet([['Employee Code', 'Name', 'Full Basic', 'Effective From', 'Bank Account No', 'IFSC', 'UAN', 'PAN', 'HOD Incentive'], ['T/1', 'Staff Alpha', '31000', '2026-04-01', '1234567890', 'ABCD0123456', '111122223333', 'ABCDE1234F', '1500']]);
// nothing sensitive in the reply at all, whatever the sheets hold
const text = JSON.stringify(ok);
for (const secret of ['1990-01-01', '9999999999', '123412341234', 'Somewhere', '0000111122223333', '1234567890', 'ABCD0123456', '111122223333', 'ABCDE1234F', 'private note', 'F1']) assert.ok(!text.includes(secret), 'leaked: ' + secret);
assert.strictEqual(ok.tabs.EmpMaster.length, 2);
// both ways to the payroll workbook: the property when set, else payroll.gs's own id (no Uday step needed)
const viaProp = r.post({ action: 'gameStaffMaster', key: KEY }); assert.strictEqual(viaProp.tabs.SalaryMaster.length, 1);
const viaConst = boot({ props: { ROSTER_GAME_KEY: KEY } }).post({ action: 'gameStaffMaster', key: KEY });
assert.strictEqual(viaConst.success, true); assert.deepStrictEqual(viaConst.tabs.SalaryMaster, viaProp.tabs.SalaryMaster);
// no silent nulls: the reply says how the pay workbook went; the staff tabs still come
assert.strictEqual(ok.pay, 'ok'); assert.strictEqual(viaConst.pay, 'ok');
const na = boot(); na.ctx.SpreadsheetApp = { openById: () => { throw new Error('No access to Staff Alpha 123412341234'); } };
const nr = na.post({ action: 'gameStaffMaster', key: KEY });
assert.strictEqual(nr.success, true); assert.strictEqual(nr.pay, 'pay_sheet_not_accessible'); assert.strictEqual(nr.tabs.SalaryMaster, null); assert.strictEqual(nr.tabs.EmpMaster.length, 2);
assert.ok(!JSON.stringify(nr).includes('No access'), 'the error text never leaves');
const nt = boot({ props: { ROSTER_GAME_KEY: KEY, PAY_SHEET_ID: 'elsewhere' } }).post({ action: 'gameStaffMaster', key: KEY });
assert.strictEqual(nt.success, true); assert.strictEqual(nt.pay, 'no_salary_tab'); assert.strictEqual(nt.tabs.SalaryMaster, null);
// a failure is a code only: no row text, no message
const rb = boot(); rb.ctx.openWorkbook_ = () => { throw new Error('Staff Alpha 123412341234'); };
assert.deepStrictEqual(rb.post({ action: 'gameStaffMaster', key: KEY }), { success: false, error: 'read_failed' });
console.log('ok: test-game-staff-master (the Roster project loads; the key is checked; only the allow-listed columns leave)');
