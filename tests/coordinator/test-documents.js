// node tests/coordinator/test-documents.js -- checks coordDocumentWanted_
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const ctx = { console, Utilities: { formatDate: (d, tz, f) => d.toISOString().slice(0, 7) } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../../apps-script/coordinator.gs', 'utf8'), ctx);

const now = new Date('2026-10-20T10:00:00Z');
const emp = [['EmployeeCode', 'Name', 'SchoolCode', 'Status'],
  ['K1', 'Complete One', 'LMS1', 'Active'], ['K2', 'No Medical', 'LMS1', 'Active'], ['K3', 'Left Person', 'LMS1', 'Inactive'],
  ['K4', 'Hidden Dept', 'LMS1', 'Active'], ['E1', 'All Good', 'LMS2', 'Active']];
const sal = [['EmployeeCode', 'Department'], ['K4', 'AdminTM']];
const cert = [['Employee Code', 'Employee Name', 'School', 'Document Type', 'Filename', 'Drive Link', 'Status'],
  ['K1', 'a', 'LMS 1', 'MEDICAL CERTIFICATE', 'f', 'http://x', 'Matched (confident)'],
  ['K1', 'a', 'LMS 1', 'POLICE VERIFICATION CHARACTER CERTIFICATE', 'f', 'http://x', 'Matched (confident)'],
  ['K1', 'a', 'LMS 1', 'BACHELORS CERTIFICATE', 'f', 'http://x', 'Matched (confident)'],
  ['K2', 'b', 'LMS 1', 'POLICE VERIFICATION CHARACTER CERTIFICATE', 'f', 'http://x', 'Matched (submitter-based -- verify)'],
  ['E1', 'c', 'LMS 2', 'MEDICAL CERTIFICATE', 'f', 'http://x', 'Matched (confident)'],
  ['E1', 'c', 'LMS 2', 'POLICE VERIFICATION CHARACTER CERTIFICATE', 'f', 'http://x', 'Matched (confident)'],
  ['E1', 'c', 'LMS 2', 'HIGHEST QUALIFICATION', 'f', 'http://x', 'Matched (confident)'],
  ['', '', 'LMS 1', 'MEDICAL CERTIFICATE', 'f', '', 'Unmatched']];            // no link: not reviewable, ignored
const w = ctx.coordDocumentWanted_(emp, sal, cert, now), by = {};
w.forEach((t) => { by[t.taskId] = t; });
assert.deepStrictEqual(Object.keys(by).sort(), ['doc_missing|LMS1|2026-10', 'doc_verify|LMS1|2026-10']);
const m = by['doc_missing|LMS1|2026-10'];
assert.ok(m.title.startsWith('LMS1: 1 of 2 staff'), m.title);   // K1 ok, K2 lacks, K3 left, K4 hidden dept
assert.ok(m.detail.includes('No Medical (medical, qualification)'), m.detail);
assert.strictEqual(m.severity, 'high');                           // 1 of 2 = 50%
assert.strictEqual(by['doc_verify|LMS1|2026-10'].severity, 'low'); // 1 file
console.log('coordinator documents: ok');
