// Pure helpers of the cash handover UI (office/js/handover.js). Standalone: node tests/office/test-handover-view.js (no-op under run.js).
'use strict';
const assert = require('assert');
if (require.main !== module) { module.exports = () => {}; return; }
(async () => {
  const H = await import('../../office/js/handover.js');
  const ok = (n) => console.log('  ok  - ' + n);
  const accts = [{ id: 'cash:LMS1', kind: 'cash', campus: 'LMS1', active: true }, { id: 'cash:HES', kind: 'cash', campus: 'HES', active: true },
    { id: 'bank:HES', kind: 'bank', campus: 'HES', active: true }, { id: 'old', kind: 'cash', campus: 'LMS2', active: false }];
  assert.deepStrictEqual(H.handoverTargets(accts, 'LMS1').map((a) => a.id), ['cash:HES']);
  ok('handoverTargets');
  assert.deepStrictEqual(H.handoverPayload('LMS1', 'cash:HES', 'fee', '200.50', ' carried by peon ', '2026-10-21'),
    { ok: true, data: { campus: 'LMS1', date: '2026-10-21', from_account: 'cash:LMS1', to_account: 'cash:HES', bucket: 'fee', amount_paise: 20050, note: 'carried by peon' } });
  assert.strictEqual(H.handoverPayload('LMS1', '', 'fee', '1', '', 'd').ok, false);
  assert.strictEqual(H.handoverPayload('LMS1', 'cash:HES', 'fee', 'abc', '', 'd').ok, false);
  assert.strictEqual(H.handoverPayload('LMS1', 'cash:HES', 'fee', '0', '', 'd').ok, false);
  ok('handoverPayload');
  assert.strictEqual(H.canHandOver({ campus: 'LMS1', role: 'FeeClerk' }), true);
  assert.strictEqual(H.canHandOver({ campus: 'HES', role: 'Coordinator, Owner' }), true);
  assert.strictEqual(H.canHandOver({ campus: 'ALL', role: 'Owner' }), false);
  assert.strictEqual(H.canHandOver({ campus: 'LMS2', role: 'Principal' }), false);
  ok('canHandOver');
  const x = { amount_paise: 20000, from_campus: 'LMS1', to_campus: 'HES', by_name: 'Clerk One', note: '', state: 'pending', dispute_note: '' };
  assert.match(H.handoverLabel({ ...x, receiver: true }), /^Accept .*200.* from LMS1 \(Clerk One\)$/);
  assert.match(H.handoverLabel({ ...x, receiver: false }), /to HES: waiting/);
  assert.match(H.handoverLabel({ ...x, receiver: false, state: 'disputed', dispute_note: 'got 150' }), /not received \(got 150\)\. If so, reverse/);
  ok('handoverLabel');
})().catch((e) => { console.error(e); process.exit(1); });
