// node tests/coordinator/test-history.js -- checks coordHistoryRows_
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const ctx = { console, Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../../apps-script/coordinator.gs', 'utf8'), ctx);

// Tasks row: 1 Domain, 2 Campus, 5 Status, 6 Severity, 14 Due
const t = (domain, campus, status, severity, due) => { const r = new Array(15).fill(''); r[1] = domain; r[2] = campus; r[5] = status; r[6] = severity; r[14] = due || ''; return r; };
const tasks = [['h'],
  t('approval', 'LMS4', 'open', 'medium', '2026-11-01'),   // overdue by date
  t('hiring', 'LMS4', 'open', 'low', '2026-11-09'),        // not overdue
  t('approval', 'LMS1', 'open', 'high', ''),               // overdue by severity
  t('documents', 'LMS1', 'open', 'low', ''),
  t('approval', 'LMS4', 'resolved', 'high', '2026-10-01'), // not open: ignored
];
const rows = ctx.coordHistoryRows_(tasks, '2026-11-03', []);
const has = (r) => assert.ok(rows.some((x) => JSON.stringify(x) === JSON.stringify(r)), 'missing ' + JSON.stringify(r));
has(['2026-11-03', 'LMS4', 'open', 2]);
has(['2026-11-03', 'LMS4', 'overdue', 1]);
has(['2026-11-03', 'LMS4', 'open.approval', 1]);
has(['2026-11-03', 'LMS4', 'open.hiring', 1]);
has(['2026-11-03', 'LMS1', 'open', 2]);
has(['2026-11-03', 'LMS1', 'overdue', 1]);
has(['2026-11-03', 'LMS1', 'open.approval', 1]);
has(['2026-11-03', 'LMS1', 'open.documents', 1]);
assert.strictEqual(rows.length, 8);
// a rerun on the same day adds nothing; a new day still adds
assert.strictEqual(ctx.coordHistoryRows_(tasks, '2026-11-03', rows).length, 0);
assert.strictEqual(ctx.coordHistoryRows_(tasks, '2026-11-04', rows).length, 8);
// only one campus already recorded: the other is still added
assert.strictEqual(ctx.coordHistoryRows_(tasks, '2026-11-03', rows.filter((r) => r[1] === 'LMS4')).length, 4);
assert.strictEqual(typeof ctx.coordScheduledRefresh, 'function'); // a trigger handler must be public (no trailing underscore)
console.log('coordinator history: ok');
