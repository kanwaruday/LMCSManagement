// Staff Portal access: which allowlist roles reach which staff actions (staffDoGet_ gate + verifyStaffManagerToken_).
// Usage: node tests/staff/test-staff-access.js
const vm = require('vm');
const fs = require('fs');
const assert = require('assert');
const gs = (f) => fs.readFileSync(__dirname + '/../../apps-script/' + f, 'utf8');

// Allowlist rows: email, name, campusId, role, (unused col E), Functions -- found by header, not position.
const allow = [['Email', 'Name', 'CampusId', 'Role', 'Notes', 'Functions'],
  ['owner@x', 'O', 'ALL', 'Owner', '', ''], ['coord@x', 'C', 'LMS4', 'Coordinator', '', ''], ['prin@x', 'P', 'LMS1', 'Principal', '', ''],
  ['clerk@x', 'F', 'LMS1', 'FeeClerk', '', ''], ['teach@x', 'T', 'LMS1', 'Teacher', '', ''], ['both@x', 'B', 'LMS1', 'FeeClerk,Principal', '', ''],
  ['hr@x', 'H', 'LMS2', 'Teacher', '', 'HR & Hiring'], ['hrprin@x', 'HP', 'LMS2', 'Principal', '', 'Fees & Accounts, hr & hiring'],
  ['fees@x', 'A', 'LMS1', 'Teacher', '', 'Fees & Accounts']];
let tokenEmail = '';
const ctx = vm.createContext({
  console,
  UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ aud: ctx.STAFF_GOOGLE_CLIENT_ID_VALUE, email_verified: true, email: tokenEmail }) }) },
  SpreadsheetApp: { openById: () => ({ getSheets: () => [{ getDataRange: () => ({ getValues: () => allow }) }] }) },
});
vm.runInContext(gs('staff-management-api.gs') + '\n' + gs('staff-documents.gs') +
  '\nthis.STAFF_GOOGLE_CLIENT_ID_VALUE = STAFF_GOOGLE_CLIENT_ID; this.LIMITED = STAFF_LIMITED_ROLES_;', ctx);

// Staff Portal routes and the document upload pass allowHrFunction = true; the transport uploads don't.
const who = (email) => { tokenEmail = email; return ctx.verifyStaffManagerToken_('tok', ctx.LIMITED, true); };
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
assert.ok(ctx.callerCovers_(ctx.staffDocCaller_(p), 'LMS1') && !ctx.callerCovers_(ctx.staffDocCaller_(p), 'LMS2'), 'no widening without HR & Hiring');

// "HR & Hiring" in Functions (2026-10-28): Documents view + upload for EVERY school, nothing else.
assert.ok(can('hr@x', 'documentstatus'), 'HR & Hiring: documents');
for (const a of ['list', 'detail', 'verificationqueue', 'reassigncertificate', 'autoresolvequeue', 'addnewhire', 'starthire', 'transfer', 'markinactive', 'savedocrules', 'uploadstatus', 'salaryfullrecord'])
  assert.ok(!can('hr@x', a), 'HR & Hiring must not ' + a);
const h = ctx.staffDocCaller_(who('hr@x'));
for (const c of ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6']) assert.ok(ctx.callerCovers_(h, c), 'HR & Hiring documents cover ' + c);
assert.strictEqual(who('hr@x').campusId, 'LMS2', 'their own campus is untouched outside Documents');
assert.ok(can('hrprin@x', 'list') && can('hrprin@x', 'documentstatus') && !can('hrprin@x', 'detail'), 'Principal + HR & Hiring: principal slice + documents');
assert.ok(ctx.callerCovers_(ctx.staffDocCaller_(who('hrprin@x')), 'LMS5'), 'function match is case-insensitive inside a list');
assert.ok(!ctx.callerCovers_(who('hrprin@x'), 'LMS5'), 'directory stays their own school');
assert.ok(!who('fees@x'), 'another function alone gets nothing here');
tokenEmail = 'hr@x';
assert.ok(!ctx.verifyStaffManagerToken_('tok', ['FeeClerk']), 'callers that do not opt in (transport uploads) still refuse HR & Hiring');
console.log('staff access ok');
