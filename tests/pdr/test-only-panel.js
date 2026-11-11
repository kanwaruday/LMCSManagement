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

const ss = fs.readFileSync(path.join(__dirname, '../../principal/support-sessions.html'), 'utf8');
assert.ok(/SS_ROLES\.some\(\(r\) => r\.key === fromUrl\) && new URLSearchParams\(location\.search\)\.get\('only'\) === '1'/.test(ss), 'locks only a known role with only=1');
for (const k of ['teacher', 'itComputer', 'pti', 'feeClerkPRO', 'nonTeaching', 'driverCumPeon']) assert.ok(ss.includes("key: '" + k + "'"), k);
console.log('ok only-panel');
