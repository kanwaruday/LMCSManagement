// Browser-side ES module test (office/js). Standalone: node tests/office/test-shell.js (no-op under run.js).
'use strict';
const assert = require('assert');
if (require.main !== module) { module.exports = () => {}; return; }
(async () => {
  const { syncLabel, canSignOut, esc } = await import('../../office/js/shell.js');
  assert.strictEqual(syncLabel({ waiting: 0, attention: 0, online: true }), 'All synced');
  assert.strictEqual(syncLabel({ waiting: 3, attention: 0, online: true }), '3 waiting');
  assert.strictEqual(syncLabel({ waiting: 3, attention: 0, online: false }), 'Offline');
  assert.strictEqual(syncLabel({ waiting: 0, attention: 2, online: false }), '2 need attention');
  assert.strictEqual(canSignOut({ waiting: 0, attention: 0 }), true);
  assert.strictEqual(canSignOut({ waiting: 1, attention: 0 }), false);
  assert.strictEqual(canSignOut({ waiting: 0, attention: 1 }), false);
  console.log('  ok  - shell pure parts, sign-out blocked by waiting and attention');

  const evil = '<img src=x onerror=alert(1)>';
  assert.ok(!esc(evil).includes('<'));
  const { renderTasks } = await import('../../office/js/today.js');
  const el = {};
  renderTasks(el, { date: '2026-10-21', tasks: [{ id: '1', title: evil, due: '2026-10-21', status: 'due', action: 'report' }] }, evil);
  assert.ok(!el.innerHTML.includes('<img'), el.innerHTML);
  assert.ok(el.innerHTML.includes('&lt;img'));
  console.log('  ok  - task titles and notes are escaped');

  // Service worker: load sw.js with a fake self and probe the fetch filter.
  const vm = require('vm'), fs = require('fs');
  const sandbox = { URL, self: { location: new URL('https://x.github.io/LMCSManagement/office/sw.js'), addEventListener() {} }, caches: {} };
  vm.runInNewContext(fs.readFileSync(__dirname + '/../../office/sw.js', 'utf8') + ';this.shellHref=shellHref;', sandbox);
  const h = (url, method = 'GET') => sandbox.shellHref({ url, method });
  assert.ok(h('https://x.github.io/LMCSManagement/office/index.html?v=1'));
  assert.ok(h('https://x.github.io/LMCSManagement/assets/style.css'));
  assert.strictEqual(h('https://script.google.com/macros/s/abc/exec?action=today.get'), null);
  assert.strictEqual(h('https://lh3.googleusercontent.com/file'), null);
  assert.strictEqual(h('https://x.github.io/LMCSManagement/office/other.json'), null);
  assert.strictEqual(h('https://x.github.io/LMCSManagement/office/index.html', 'POST'), null);
  console.log('  ok  - service worker caches only same-origin shell files');
})().catch((e) => { console.log('  FAIL -', e.message); process.exit(1); });
