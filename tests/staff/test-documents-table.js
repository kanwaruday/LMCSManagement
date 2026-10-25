// The LMS n form tabs -> one-row-per-file "Documents" table conversion (apps-script/staff-documents.gs).
// Usage: node tests/staff/test-documents-table.js
const vm = require('vm');
const fs = require('fs');
const assert = require('assert');
const gs = (f) => fs.readFileSync(__dirname + '/../../apps-script/' + f, 'utf8');

const ctx = vm.createContext({ console });
vm.runInContext(gs('certificate-link-import.gs') + '\n' + gs('staff-documents.gs'), ctx);
// Stand-ins for what lives in staff-management-api.gs / Apps Script.
ctx.RESPONSE_CAMPUSES_ = ['LMS1', 'LMS6'];
ctx.STAFF_CAMPUS_SHEET_LABEL_ = { LMS1: 'LMS 1', LMS6: 'LMS 6' };
const tabs = {
  LMS1: [
    ['Timestamp', 'Email Address', 'Employee Name', 'Employee ID', 'JOB ROLE', 'PAN CARD', 'AADHAR CARD', 'PAN CARD', 'Remarks, if any '],
    ['t1', 'clerk@x', 'typed name', 'kul/99/04/28', 'PRT', 'https://d/p1, https://d/p2', 'https://d/a1', '', 'n/a'],
    ['t2', 'clerk@x', 'Ghost', 'KUL/99/99/999', 'PRT', '', '', 'https://d/p3', ''],
    ['t3', 'clerk@x', 'No Id', '', 'NTT', 'https://d/p4', '', '', ''],
  ],
  LMS6: [
    ['Timestamp', 'Email Address', 'Employee Name', 'Employee ID', 'SIGNED  JOB ROLE'],
    ['t4', 'c6@x', 'J', 'JOG/99/04/017', 'https://d/s1'],
  ],
};
ctx.openResponseSheet_ = (c) => ({ getDataRange: () => ({ getValues: () => tabs[c] }) });
ctx.openEmpWorkbook_ = () => ({ getSheetByName: () => ({ getDataRange: () => ({ getValues: () => [
  ['EmployeeCode', 'Name'], ['KUL/99/04/028', 'REAL NAME'], ['JOG/99/04/017', 'JOGI'],
] }) }) });

const rows = ctx.sdocFormRows_();
const C = vm.runInContext('SDOC_COL_', ctx);
const pick = (link) => rows.find((r) => r[C.link] === link);

assert.strictEqual(rows.length, 6, 'one row per link, comma lists split, text answers ignored');
assert.strictEqual(pick('https://d/p1')[C.code], 'KUL/99/04/028', 'typed short code matched to the roster code');
assert.strictEqual(pick('https://d/p1')[C.name], 'REAL NAME', 'roster name wins over the typed one');
assert.strictEqual(pick('https://d/p2')[C.type], 'PAN CARD');
assert.strictEqual(pick('https://d/a1')[C.type], 'AADHAAR CARD', 'AADHAR header -> canonical type');
assert.strictEqual(pick('https://d/p1')[C.check], '');
assert.strictEqual(pick('https://d/p3')[C.check], 'Not on roster');
assert.strictEqual(pick('https://d/p3')[C.code], 'KUL/99/99/999', 'unknown code kept as typed');
assert.strictEqual(pick('https://d/p4')[C.check], 'Blank ID');
assert.strictEqual(pick('https://d/s1')[C.type], 'SIGNED JOB ROLE', 'double-spaced header still matches');
assert.strictEqual(pick('https://d/s1')[C.school], 'LMS 6');
assert.strictEqual(pick('https://d/p1')[C.by], 'clerk@x');
assert.strictEqual(pick('https://d/p1')[C.source], 'Form');
assert.strictEqual(ctx.sdocNormCode_(' kul/5/1/7 '), 'KUL/5/1/007');
console.log('documents table: ok');
