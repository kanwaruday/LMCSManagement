// Run: node tests/hiring/test-access.js -- which PDR actions a caller with no Principal/Coordinator/Owner role may call.
const vm = require('vm'), fs = require('fs'), assert = require('assert'), path = require('path');
const ctx = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../apps-script/main.gs'), 'utf8'), ctx);
const who = (role) => ({ roles: role.split(','), campusId: 'LMS4' });
const T = (name, fn) => { fn(); console.log('ok  -', name); };

T('Fee Clerk: hiring legwork only', () => {
  const c = who('FeeClerk');
  assert.strictEqual(ctx.pdrIsElevated_(c), false);
  assert.strictEqual(ctx.pdrLimitedAllows_(c, 'hiringapplicants', false), true);
  assert.strictEqual(ctx.pdrLimitedAllows_(c, 'hiringapprovalstatus', false), true);
  assert.strictEqual(ctx.pdrLimitedAllows_(c, 'approvalslist', false), false);
  assert.strictEqual(ctx.pdrLimitedAllows_(c, 'hiringaddapplicant', true), true);
  assert.strictEqual(ctx.pdrLimitedAllows_(c, 'apptlist', false), true);
  ['apptpropose', 'apptcancel', 'hiringuploadreport'].forEach((a) => assert.strictEqual(ctx.pdrLimitedAllows_(c, a, true), true, a));
  ['hiringschedule', 'apptdecide', 'hiringshortlist', 'updatehiringstatus', 'hiringrevive', 'hiringmarkstage', 'hiringsubmitinterview', 'hiringsubmitdemo', 'hiringconfirmreject', 'submitapproval']
    .forEach((a) => assert.strictEqual(ctx.pdrLimitedAllows_(c, a, true), false, a));
});
T('Teacher keeps its own lists', () => {
  assert.strictEqual(ctx.pdrLimitedAllows_(who('Teacher'), 'submitapproval', true), true);
  assert.strictEqual(ctx.pdrLimitedAllows_(who('Teacher'), 'hiringaddapplicant', true), false);
});
T('Fee Clerk + Teacher gets both', () => {
  const c = who('FeeClerk,Teacher');
  assert.strictEqual(ctx.pdrLimitedAllows_(c, 'submitapproval', true), true);
  assert.strictEqual(ctx.pdrLimitedAllows_(c, 'apptpropose', true), true);
});
T('Principal/Coordinator/Owner are elevated', () => {
  ['Principal', 'Coordinator', 'Owner', 'Coordinator,Teacher'].forEach((r) => assert.strictEqual(ctx.pdrIsElevated_(who(r)), true, r));
});
