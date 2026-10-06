// node tests/coordinator/test-approvals.js -- checks coordApprovalWanted_ + the upsert/auto-resolve pair
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const ctx = { console, Utilities: { formatDate: (d) => d.toISOString().slice(5, 10) } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../../apps-script/coordinator.gs', 'utf8'), ctx);

const now = new Date('2026-10-20T10:00:00Z'), day = (n) => new Date(now.getTime() - n * 86400000);
const row = (id, campus, status, urgency, since, archived) =>
  [id, campus, 'Compensatory Leave', urgency, 'Title ' + id, '', '', '', '', '', '', 'x@lms.org.in', since, status, '', status === 'Info Requested' ? since : '', '', '', archived || ''];
const rows = [['id'],
  row('a1', 'LMS1', 'Pending', 'Normal', day(2)),            // too young
  row('a2', 'LMS1', 'Pending', 'Normal', day(4)),            // medium
  row('a3', 'LMS2', 'Pending', 'Normal', day(9)),            // high
  row('a4', 'LMS2', 'Pending', 'Urgent', day(2)),            // urgent: medium at 1d, still <3 -> medium
  row('a5', 'LMS3', 'Info Requested', 'Normal', day(6)),     // waiting on requester, medium
  row('a6', 'LMS3', 'Approved', 'Normal', day(30)),          // decided: ignored
  row('a7', 'LMS4', 'Pending', 'Normal', day(20), 'TRUE')];  // archived: ignored
const w = ctx.coordApprovalWanted_(rows, now);
const by = {}; w.forEach((t) => { by[t.taskId] = t; });
assert.deepStrictEqual(Object.keys(by).sort(), ['approval|a2|Pending', 'approval|a3|Pending', 'approval|a4|Pending', 'approval|a5|Info Requested']);
assert.strictEqual(by['approval|a2|Pending'].severity, 'medium');
assert.strictEqual(by['approval|a3|Pending'].severity, 'high');
assert.strictEqual(by['approval|a4|Pending'].severity, 'medium');
assert.ok(by['approval|a5|Info Requested'].title.includes('the requester'));

// upsert / auto-resolve against a fake sheet
const store = [['TaskId', 'Domain', 'Campus', 'Title', 'Detail', 'Status', 'Severity']];
const sh = { appendRow: () => {}, /* the real coordTaskUpsert_ also pushes into the in-memory rows (here: store) */ getRange: (r, c, nr, nc) => ({
  setValues: (v) => v[0].forEach((x, j) => { store[r - 1][c - 1 + j] = x; }),
  setValue: (x) => { store[r - 1][c - 1] = x; } }) };
const live = {};
w.forEach((t) => { live[t.taskId] = true; ctx.coordTaskUpsert_(sh, store, t); });
assert.strictEqual(store.length, 5);
w.forEach((t) => ctx.coordTaskUpsert_(sh, store, t));          // re-run: no duplicates
assert.strictEqual(store.length, 5);
delete live['approval|a2|Pending'];                            // a2 got decided
ctx.coordTasksAutoResolve_(sh, store, 'approval', null, live);
assert.strictEqual(store.find((r) => r[0] === 'approval|a2|Pending')[5], 'resolved');
assert.strictEqual(store.find((r) => r[0] === 'approval|a3|Pending')[5], 'open');
console.log('coordinator approvals: ok');
