// Staff Portal access: which allowlist roles reach which staff actions (staffDoGet_ gate + verifyStaffManagerToken_).
// Usage: node tests/staff/test-staff-access.js
const vm = require('vm');
const fs = require('fs');
const assert = require('assert');
const gs = (f) => fs.readFileSync(__dirname + '/../../apps-script/' + f, 'utf8');

// Allowlist rows: email, name, campusId, role.
const allow = [['Email', 'Name', 'CampusId', 'Role'],
  ['owner@x', 'O', 'ALL', 'Owner'], ['coord@x', 'C', 'LMS4', 'Coordinator'], ['prin@x', 'P', 'LMS1', 'Principal'],
  ['clerk@x', 'F', 'LMS1', 'FeeClerk'], ['teach@x', 'T', 'LMS1', 'Teacher'], ['both@x', 'B', 'LMS1', 'FeeClerk,Principal']];
let tokenEmail = '';
const ctx = vm.createContext({
  console,
  UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ aud: ctx.STAFF_GOOGLE_CLIENT_ID_VALUE, email_verified: true, email: tokenEmail }) }) },
  SpreadsheetApp: { openById: () => ({ getSheets: () => [{ getDataRange: () => ({ getValues: () => allow }) }] }) },
});
vm.runInContext(gs('staff-management-api.gs') + '\n' + gs('staff-documents.gs') +
  '\nthis.STAFF_GOOGLE_CLIENT_ID_VALUE = STAFF_GOOGLE_CLIENT_ID; this.LIMITED = STAFF_LIMITED_ROLES_;', ctx);

const who = (email) => { tokenEmail = email; return ctx.verifyStaffManagerToken_('tok', ctx.LIMITED); };
const can = (email, action) => { const c = who(email); return !!c && (c.manager !== false || ctx.staffLimitedAllows_(c, action)); };

for (const a of ['list', 'detail', 'documentstatus', 'verificationqueue', 'savedocrules']) {
  assert.ok(can('owner@x', a), 'owner ' + a);
  assert.ok(can('coord@x', a), 'coordinator ' + a);
}
assert.ok(can('prin@x', 'list') && can('prin@x', 'documentstatus'), 'principal: directory + documents');
for (const a of ['detail', 'verificationqueue', 'reassigncertificate', 'addnewhire', 'savedocrules', 'uploadstatus']) assert.ok(!can('prin@x', a), 'principal must not ' + a);
assert.ok(can('clerk@x', 'documentstatus') && !can('clerk@x', 'list') && !can('clerk@x', 'detail'), 'fee clerk: documents only');
assert.ok(!who('teach@x'), 'a teacher gets nothing');
assert.ok(!who('nobody@x'), 'not on the allowlist gets nothing');
assert.ok(can('both@x', 'list') && !can('both@x', 'detail'), 'FeeClerk,Principal gets the principal slice');

// A principal's campus scope: their own school only.
const p = who('prin@x');
assert.ok(ctx.callerCovers_(p, 'LMS1') && !ctx.callerCovers_(p, 'LMS2'));
console.log('staff access ok');
