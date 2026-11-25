// node tests/pdr/test-only-panel.js -- game doors open one panel (Uday, 11 Nov): ?only=<tab> on the PDR page, ?role=&only=1 on Support Sessions
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const pdr = fs.readFileSync(path.join(__dirname, '../../principals-daily-reporting/index.html'), 'utf8');
const line = pdr.match(/var ONLY_TAB = .*;/)[0];
const only = (search) => vm.runInNewContext(line + ' ONLY_TAB', { location: { search }, URLSearchParams });
for (const t of ['home', 'principal', 'dashboard', 'approvals']) assert.strictEqual(only('?only=' + t), t);
for (const s of ['', '?only=support', '?only=APPROVALS', '?only=x', '?role=teacher']) assert.strictEqual(only(s), null, s + ' falls back to the normal page');
for (const t of ['home', 'principal', 'dashboard', 'approvals']) assert.ok(pdr.includes('id="panel-' + t + '"'), 'panel-' + t + ' exists');
assert.ok(/if \(ONLY_TAB\) \{ switchTab\(ONLY_TAB\); document\.body\.classList\.add\('pdr-only'\);/.test(pdr), 'applied after restore');
assert.ok(/body\.pdr-only \.tabs, body\.pdr-only \.hdr-right \{ display: none; \}/.test(pdr), 'hides the tab bar and the link home');

// principal/support-sessions.html is retired (batch (a), 25 Nov; tests/retired checks its stub): its only=1 lock checks went with it
console.log('ok only-panel');
