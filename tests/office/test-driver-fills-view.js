// Pure helpers of the Driver Fills screen (office/js/driver-fills.js). Standalone: node tests/office/test-driver-fills-view.js (no-op under run.js).
'use strict';
const assert = require('assert');
if (require.main !== module) { module.exports = () => {}; return; }
(async () => {
  const D = await import('../../office/js/driver-fills.js');
  const ok = (n) => console.log('  ok  - ' + n);
  assert.strictEqual(D.canConfirm({ mine: true }), false);
  assert.strictEqual(D.canConfirm({ mine: false }), true);
  assert.strictEqual(D.canConfirm({}), true, 'an older Roster answer (no field) keeps Confirm');
  ok('canConfirm: only the one who entered a fill loses Confirm');
  assert.strictEqual(D.enteredByLine({ enteredBy: 'coord@test.invalid (Coordinator)' }), 'Entered by coord@test.invalid (Coordinator)');
  assert.strictEqual(D.enteredByLine({ enteredBy: '' }), '', "a driver's own fill");
  assert.strictEqual(D.enteredByLine({}), '');
  ok('enteredByLine');
  console.log('driver fills view: ok');
})().catch((e) => { console.error(e); process.exit(1); });
