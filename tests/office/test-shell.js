// Browser-side ES module test (office/js). Standalone: node tests/office/test-shell.js (no-op under run.js).
'use strict';
const assert = require('assert');
if (require.main !== module) { module.exports = () => {}; return; }
(async () => {
  const { syncLabel, canSignOut } = await import('../../office/js/shell.js');
  assert.strictEqual(syncLabel({ waiting: 0, attention: 0, online: true }), 'All synced');
  assert.strictEqual(syncLabel({ waiting: 3, attention: 0, online: true }), '3 waiting');
  assert.strictEqual(syncLabel({ waiting: 3, attention: 0, online: false }), 'Offline');
  assert.strictEqual(syncLabel({ waiting: 0, attention: 2, online: false }), '2 need attention');
  assert.strictEqual(canSignOut({ waiting: 0 }), true);
  assert.strictEqual(canSignOut({ waiting: 1 }), false);
  console.log('  ok  - shell pure parts');
})().catch((e) => { console.log('  FAIL -', e.message); process.exit(1); });
