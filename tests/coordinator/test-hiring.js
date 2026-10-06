// node tests/coordinator/test-hiring.js -- checks coordHiringWanted_
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const ctx = { console, Utilities: { formatDate: (d) => d.toISOString().slice(5, 10) } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../../apps-script/coordinator.gs', 'utf8'), ctx);

const now = new Date('2026-10-20T10:00:00+05:30'), day = (n) => new Date(now.getTime() + n * 86400000);
const ymd = (d) => d.toISOString().slice(0, 10);
// applicant row: index 1 name, 5 branches, 10 status, 13 MD interview at, 15 emp code, 16 DOJ
const app = (name, status, o) => { const r = new Array(18).fill(''); r[1] = name; r[5] = o.branches || 'LMS-2'; r[10] = status; r[13] = o.md || ''; r[15] = o.code || ''; r[16] = o.doj || ''; return r; };
const apRow = (id, campus, status, decidedAt) => { const r = new Array(19).fill(''); r[1] = campus; r[2] = 'Salary Offer Approval'; r[7] = id + ' Name'; r[13] = status; r[15] = decidedAt || ''; return r; };

const applicants = [['h'],
  app('Hired joins in 10d', 'Hired', { code: 'KEL/26/10/200', doj: ymd(day(10)) }),   // row2 T-0002 low
  app('Hired joins in 2d', 'Hired', { code: 'KEL/26/10/201', doj: ymd(day(2)) }),     // T-0003 medium
  app('Hired 5d ago', 'Hired', { code: 'KEL/26/10/202', doj: ymd(day(-5)) }),         // T-0004 high
  app('Already added', 'Hired', { code: 'KEL/26/09/150', doj: ymd(day(-5)) }),        // T-0005 in roster -> none
  app('Approved 5d ago', '', { md: day(-9) }),                                        // T-0006 stall medium
  app('Approved 9d ago', '', { md: day(-12) }),                                       // T-0007 stall high
  app('Approved 1d ago', '', { md: day(-3) }),                                        // T-0008 too fresh
  app('Rejected', 'Rejected', { md: day(-9) }),                                       // T-0009 ignored
  app('No MD interview', '', {}),                                                     // T-0010 ignored
];
const approvals = [['h'],
  apRow('T-0006', 'LMS3', 'Approved', day(-5)), apRow('T-0007', 'LMS3', 'Approved', day(-9)),
  apRow('T-0008', 'LMS3', 'Approved', day(-1)), apRow('T-0009', 'LMS3', 'Approved', day(-9)),
  apRow('T-0010', 'LMS3', 'Pending', '')];
const w = ctx.coordHiringWanted_(applicants, approvals, ['KEL/26/09/150'], now);
const by = {}; w.forEach((t) => { by[t.taskId] = t; });
assert.deepStrictEqual(Object.keys(by).sort(), ['complete_hire|T-0002', 'complete_hire|T-0003', 'complete_hire|T-0004', 'hiring_stall|T-0006', 'hiring_stall|T-0007']);
assert.strictEqual(by['complete_hire|T-0002'].severity, 'low');
assert.strictEqual(by['complete_hire|T-0003'].severity, 'medium');
assert.strictEqual(by['complete_hire|T-0004'].severity, 'high');
assert.strictEqual(by['hiring_stall|T-0006'].severity, 'medium');
assert.strictEqual(by['hiring_stall|T-0007'].severity, 'high');
assert.strictEqual(by['hiring_stall|T-0006'].campus, 'LMS3');   // offer campus wins
assert.strictEqual(by['complete_hire|T-0002'].campus, 'LMS2');  // falls back to the applicant's branch tick
console.log('coordinator hiring: ok');
