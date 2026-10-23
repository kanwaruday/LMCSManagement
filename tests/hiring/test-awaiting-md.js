// aprAnnotateAwaitingMd_: an open Appointment Confirmation is flagged until its MD interview is on the Hiring Dashboard.
const vm = require('vm'), fs = require('fs'), assert = require('assert');
const md = [['2026-10-20'], [''], ['']]; // sheet rows 2,3,4 = T-0002, T-0003, T-0004
const ctx = vm.createContext({ console, HIR_COL: { MD_INTERVIEW_AT: 14 }, APR_STATUS: { PENDING: 'Pending', INFO_REQUESTED: 'Info Requested' },
  hirSheet_: () => ({ getLastRow: () => 4, getRange: () => ({ getValues: () => md }) }) });
const src = fs.readFileSync('apps-script/approvals.gs', 'utf8');
vm.runInContext(src.slice(src.indexOf('function aprAnnotateAwaitingMd_'), src.indexOf('function aprComments_')), ctx);
const mk = (id, cat, status) => ({ category: cat, status, itemName: id + ' — X' });
const list = [mk('T-0002', 'Salary Offer Approval', 'Pending'), mk('T-0003', 'Salary Offer Approval', 'Pending'), mk('T-0003', 'Salary Offer Approval', 'Approved'), mk('T-0003', 'Other', 'Pending')];
ctx.aprAnnotateAwaitingMd_(list);
assert.strictEqual(list[0].awaitingMd, false);   // MD interview recorded
assert.strictEqual(list[1].awaitingMd, true);    // not yet
assert.strictEqual(list[2].awaitingMd, undefined); // already decided
assert.strictEqual(list[3].awaitingMd, undefined); // other category
console.log('ok  - awaiting-MD flag');
