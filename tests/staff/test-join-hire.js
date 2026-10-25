// joinHire_: Payroll's "Joined" makes sure the joiner is on the Employee Master and has an EmpSalary designation row.
// Usage: node tests/staff/test-join-hire.js
const vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '../../apps-script/staff-management-api.gs'), 'utf8');
const body = src.slice(src.indexOf('function joinHire_'), src.indexOf('function addNewHire_'));

const master = { 'KUL/99/11/140': { Name: 'Already Started' } };      // EmpMaster rows by code
const salary = [['EmployeeCode', 'Name', 'Designation', 'Department', 'Basic'],
  ['KUL/99/01/001', 'A', 'PRT', 'Teaching', 9], ['KUL/99/01/002', 'B', 'PRT', 'Teaching', 9], ['KUL/99/01/003', 'C', 'PRT', 'Primary Wing', 9]];
const locked = { 7: 'KUL/99/11/141', 8: 'KUL/99/11/142' };          // Teaching Applicants row -> locked code
const started = [];
let busted = 0;
const salSheet = {
  getDataRange: () => ({ getValues: () => salary.map((r) => r.slice()) }),
  appendRow: (r) => salary.push(r),
  getRange: (r, c) => ({ setValue: (v) => { salary[r - 1][c - 1] = v; } }),
};
const ctx = vm.createContext({
  HIR_EMPCODE_RE_: /^([A-Z]{3})\/(\d{2})\/(\d{2})\/(\d{3,})$/, HIR_EMP_CODE_COL_: 16,
  STAFF_SCHOOL_PREFIX: { LMS1: 'KUL', LMS2: 'KEL' },
  empMasterHasCode_: (c) => !!master[c],
  hirTeachingApplicantsSheet_: () => ({ getRange: (r) => ({ getValue: () => locked[r] || '' }) }),
  startHire_: (d) => { started.push(d); master[locked[parseInt(d.applicantId.match(/\d+/)[0], 10)]] = { Name: 'New Joiner' }; return {}; },
  openEmpWorkbook_: () => ({ getSheetByName: () => salSheet }),
  readRowByCode_: (ss, tab, code) => master[code] || null,
  buildRow_: (h, v) => h.map((k) => (k in v ? v[k] : '')),
  bustStaffListCache_: () => { busted++; },
});
vm.runInContext(body, ctx);
const owner = { roles: ['Owner'], campusId: 'ALL' };
const row = (code) => salary.find((r) => r[0] === code);

// 1. "Start Hiring Process" already added them to EmpMaster: only the EmpSalary row is added, department from peers.
let r = ctx.joinHire_({ applicantId: 'T-0006', code: 'kul/99/11/140', designation: 'PRT' }, owner);
assert.strictEqual(r.addedToMaster, false);
assert.strictEqual(r.salaryRow, 'added');
assert.deepStrictEqual(row('KUL/99/11/140'), ['KUL/99/11/140', 'Already Started', 'PRT', 'Teaching', '']); // no pay figure
assert.strictEqual(started.length, 0);

// 2. Never started: added to EmpMaster through startHire_ (school from the code prefix), then EmpSalary.
r = ctx.joinHire_({ applicantId: 'T-0007', code: 'KUL/99/11/141', designation: 'TGT' }, owner);
assert.strictEqual(r.addedToMaster, true);
assert.strictEqual(JSON.stringify(started[0]), JSON.stringify({ applicantId: 'T-0007', school: 'LMS1', role: 'TGT' }));
assert.deepStrictEqual(row('KUL/99/11/141').slice(0, 4), ['KUL/99/11/141', 'New Joiner', 'TGT', '']); // no TGT peers -> no department

// 3. Idempotent: running Joined again changes nothing.
const before = salary.length;
r = ctx.joinHire_({ applicantId: 'T-0007', code: 'KUL/99/11/141', designation: 'TGT' }, owner);
assert.strictEqual(r.addedToMaster, false);
assert.strictEqual(r.salaryRow, 'kept');
assert.strictEqual(salary.length, before);

// 4. An existing EmpSalary row with no designation gets one; one that has a designation is left alone.
salary.push(['KUL/99/11/150', 'Blank', '', '', '']);
master['KUL/99/11/150'] = { Name: 'Blank' };
assert.strictEqual(ctx.joinHire_({ applicantId: 'T-0009', code: 'KUL/99/11/150', designation: 'PRT' }, owner).salaryRow, 'designation set');
assert.deepStrictEqual(row('KUL/99/11/150').slice(2, 4), ['PRT', 'Teaching']);
assert.strictEqual(ctx.joinHire_({ applicantId: 'T-0009', code: 'KUL/99/11/150', designation: 'NTT' }, owner).salaryRow, 'kept');
assert.strictEqual(row('KUL/99/11/150')[2], 'PRT');

// 5. Refusals, with nothing written.
const n = salary.length;
assert.throws(() => ctx.joinHire_({ applicantId: 'T-0008', code: 'KUL/99/11/999', designation: 'PRT' }, owner), /has KUL\/99\/11\/142 locked/);
assert.throws(() => ctx.joinHire_({ applicantId: 'T-0007', code: 'bad', designation: 'PRT' }, owner), /Not a valid employee code/);
assert.throws(() => ctx.joinHire_({ applicantId: 'T-0007', code: 'ZZZ/26/11/141' }, owner), /Unknown school prefix/);
assert.throws(() => ctx.joinHire_({ applicantId: 'T-0007', code: 'KUL/99/11/141' }, { roles: ['Coordinator'], campusId: 'ALL' }), /Only the Owner/);
assert.strictEqual(salary.length, n);
assert.strictEqual(started.length, 1);
assert.ok(busted >= 4, 'roster caches cleared on every join');
console.log('join hire: ok');
