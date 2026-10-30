// apps-script/driver-google.gs driverStaff_: the Driver phones picker's staff read. Only the caller's schools (Owner all, Coordinator
// their district, Fee Clerk their campus), active people only, a hidden department never; phone as 10 digits from the roster's phone
// column; google only as true/false, never the address; Principals and teachers refused; nothing logged. Made-up people only.
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const gs = (f) => fs.readFileSync(path.join(__dirname, '../../apps-script', f), 'utf8').replace(/^const /gm, 'var ');
const ROSTER = 'roster-book';
const books = { [ROSTER]: {
  EmpMaster: [['EmployeeCode', 'Name', 'SchoolCode', 'Status'], ['E1', 'Lms Four Driver', 'LMS4', 'Active'], ['E2', 'Lms Four Teacher', 'lms4', ''],
    ['E3', 'Left Driver', 'LMS4', 'Inactive'], ['E4', 'Lms Five Driver', 'LMS5', 'Active'], ['E5', 'Lms One Driver', 'LMS1', 'Active'], ['E6', 'Hidden One', 'LMS4', 'Active'],
    ['E7', 'No Personal Row', 'LMS4', 'Active']],
  EmpSalary: [['EmployeeCode', 'Designation', 'Department'], ['E1', 'Driver Cum Peon', 'Transport'], ['E2', 'TGT', 'Teaching'], ['E4', 'Driver', 'Transport'],
    ['E5', 'Driver', 'Transport'], ['E6', 'Manager', 'admintm']],
  EmpPersonal: [['EmployeeCode', 'AuthEmail', 'Mobile No'], ['E1', 'four.driver@gmail.com', '+91 98765-43210'], ['E2', '', '12345'], ['E4', 'x', '9876500000'],
    ['E5', '', '919876511111']],
} };
const sheet = (rows) => ({ getDataRange: () => ({ getValues: () => rows.map((r) => r.slice()) }) });
const logs = [];
const callers = { owner: { email: 'o@x', campusId: 'ALL', roles: ['Owner'] }, coord: { email: 'c@x', campusId: 'LMS4', roles: ['Coordinator'] },
  clerk: { email: 'f@x', campusId: 'LMS4', roles: ['FeeClerk'] } };
const ctx = { Object, String, Math, JSON, Array, Number, RegExp, console: { log: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')) },
  SpreadsheetApp: { openById: (id) => ({ getSheetByName: (n) => (books[id] && books[id][n] ? sheet(books[id][n]) : null) }) },
  EMP_ROSTER_SHEET_ID: ROSTER, STAFF_HIDDEN_DEPARTMENTS: ['admintm'], verifyStaffManagerToken_: (t) => callers[t] || null };
vm.createContext(ctx);
['transport-uploads.gs', 'driver-google.gs'].forEach((f) => vm.runInContext(gs(f), ctx));
const call = (b) => JSON.parse(JSON.stringify(vm.runInContext('driverStaff_(' + JSON.stringify(b) + ')', ctx)));
const codes = (r) => r.staff.map((e) => e.employeeCode).sort();

assert.deepStrictEqual(codes(call({ idToken: 'owner' })), ['E1', 'E2', 'E4', 'E5', 'E7'], 'Owner: every school, active only, the hidden department never');
assert.deepStrictEqual(codes(call({ idToken: 'coord' })), ['E1', 'E2', 'E4', 'E7'], 'Coordinator LMS4: the LMS4-6 district');
assert.deepStrictEqual(codes(call({ idToken: 'clerk' })), ['E1', 'E2', 'E7'], 'Fee Clerk LMS4: own campus only');
const by = Object.fromEntries(call({ idToken: 'owner' }).staff.map((e) => [e.employeeCode, e]));
assert.deepStrictEqual(by.E1, { employeeCode: 'E1', name: 'Lms Four Driver', school: 'LMS4', role: 'Driver Cum Peon', phone: '9876543210', google: true });
assert.deepStrictEqual([by.E2.phone, by.E2.google, by.E2.school], ['', false, 'LMS4'], 'a short number is no phone; no email is no Google; school upper case');
assert.deepStrictEqual([by.E5.phone, by.E4.google], ['9876511111', false], 'country code dropped; an address without @ is not Google');
assert.deepStrictEqual([by.E7.phone, by.E7.google, by.E7.role], ['', false, ''], 'no personal or salary row: blanks, not a crash');
const all = JSON.stringify(call({ idToken: 'owner' }));
assert.ok(!/@|gmail/i.test(all), 'never an address');
assert.deepStrictEqual(call({ idToken: 'principal' }), { success: false, error: 'Not authorized' }, 'anyone else refused');
assert.deepStrictEqual(call({}), { success: false, error: 'Not authorized' });
books[ROSTER].EmpPersonal[0][2] = 'Emergency Contact Number';
assert.strictEqual(Object.fromEntries(call({ idToken: 'owner' }).staff.map((e) => [e.employeeCode, e])).E1.phone, '', 'an emergency contact is not the phone');
books[ROSTER].EmpPersonal[0][2] = 'Phone_Number';
assert.strictEqual(call({ idToken: 'clerk' }).staff.find((e) => e.employeeCode === 'E1').phone, '9876543210', 'Phone_Number is the phone');
assert.deepStrictEqual(logs, [], 'nothing logged');
console.log('driver staff: all checks passed');
