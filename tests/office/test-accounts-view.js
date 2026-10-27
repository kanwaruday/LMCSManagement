// Pure helpers of the Accounts screen. Standalone: node tests/office/test-accounts-view.js (no-op under run.js).
'use strict';
const assert = require('assert');
if (require.main !== module) { module.exports = () => {}; return; }
(async () => {
  const A = await import('../../office/js/accounts.js');
  const ok = (n) => console.log('  ok  - ' + n);

  assert.deepStrictEqual(A.mapFleet([
    { reg: 'hp 38-a 1234', bus: 'Bus 7', campus: 'LMS 3', campusId: 'LMS3', route: 'Dunkhra' },
    { reg: 'HP38B.5678', bus: 'Bus 9', campus: 'LMS 1', route: '' },
    { reg: 'HP38B.5678', bus: 'dup', campus: 'LMS 1' },
    { reg: '', bus: 'Bus 1', campus: 'LMS 2' },
    { reg: 'HP99', bus: 'Bus 2', campus: 'Somewhere' },
  ]), [
    { reg: 'HP38A1234', label: 'Bus 7 · Dunkhra', kind: 'bus', campus: 'LMS3' },
    { reg: 'HP38B5678', label: 'Bus 9', kind: 'bus', campus: 'LMS1' },
  ]);
  assert.deepStrictEqual(A.mapFleet(null), []);
  ok('mapFleet');

  let seen;
  const fake = (body) => async (url) => { seen = url; return { text: async () => body }; };
  const r = await A.fetchFleet(fake('{"success":true,"fleet":[{"reg":"A1"}]}'), 'http://x/exec', 'tok en');
  assert.strictEqual(seen, 'http://x/exec?action=coordinatortransport&idToken=tok%20en');
  assert.deepStrictEqual(r, [{ reg: 'A1' }]);
  await assert.rejects(A.fetchFleet(fake('{"success":false,"error":"Boom"}'), 'u', 't'), /Boom/);
  await assert.rejects(A.fetchFleet(fake('<html>'), 'u', 't'), /could not be read/);
  ok('fetchFleet');

  await assert.rejects(A.fetchFleet(fake('{"success":false,"error":"Not authorized"}'), 'u', 't'), (e) => e.message === A.NOT_ALLOWED_TRANSPORT);
  const L = (s) => ({ getSession: () => s });
  assert.strictEqual(A.liveToken(L({ email: 'A@x.org', idToken: 'T' }), { email: 'a@x.org' }), 'T');
  assert.throws(() => A.liveToken(L(null), { email: 'a@x.org' }), (e) => e.message === A.SIGNED_OUT);
  assert.throws(() => A.liveToken(L({ email: 'b@x.org', idToken: 'T' }), { email: 'a@x.org' }), (e) => e.message === A.SIGNED_OUT);
  ok('token and not-authorized');
  {
    const L1 = { id: 'bank:LMS1', campus: 'LMS1' }, L1b = { id: 'hdfc', campus: 'LMS1' }, HES = { id: 'sbi-hes', campus: 'HES' };
    const ft = (o) => A.fundTransferPayload(o.from === undefined ? L1 : o.from, o.to === undefined ? HES : o.to, o.amt || '5000.50', o.date || '2026-10-20', o.ref === undefined ? ' UTR9 ' : o.ref, o.note, '2026-10-21');
    assert.deepStrictEqual(ft({}), { ok: true, data: { date: '2026-10-20', from_account: 'bank:LMS1', to_account: 'sbi-hes', amount_paise: 500050, reference: 'UTR9', narration: '' } });
    assert.strictEqual(ft({ to: null }).ok, false);
    assert.match(ft({ to: L1b }).error, /same school/);
    assert.strictEqual(ft({ amt: '0' }).ok, false);
    assert.strictEqual(ft({ amt: 'abc' }).ok, false);
    assert.strictEqual(ft({ date: '2026-10-22' }).ok, false);
    assert.strictEqual(ft({ ref: '  ' }).ok, false);
    ok('fundTransferPayload');
  }
  assert.strictEqual(A.canSeeAccounts({ role: 'Owner' }), true);
  assert.strictEqual(A.canSeeAccounts({ role: 'FeeClerk, Accounts' }), true);
  assert.strictEqual(A.canSeeAccounts({ role: 'FinanceHead' }), true);
  assert.strictEqual(A.canSeeAccounts({ role: 'FeeClerk' }), false);
  assert.strictEqual(A.canSeeAccounts({}), false);
  ok('canSeeAccounts');

  assert.deepStrictEqual(A.accountPayload('LMS1', 'credit', ' Sharma Pump '), { ok: true, data: { campus: 'LMS1', kind: 'credit', label: 'Sharma Pump' } });
  assert.strictEqual(A.accountPayload('LMS1', 'cash', 'x').ok, false);
  assert.strictEqual(A.accountPayload('LMS1', 'bank', '  ').ok, false);
  assert.deepStrictEqual(A.vehiclePayload('LMS2', 'jeep', 'hp 38 c 1', 'Innova').data, { reg: 'HP38C1', label: 'Innova', kind: 'jeep', campus: 'LMS2' });
  assert.strictEqual(A.vehiclePayload('LMS2', 'jeep', ' ', 'x').ok, false);
  assert.strictEqual(A.vehiclePayload('LMS2', 'tank', 'A1', 'x').ok, false);
  assert.deepStrictEqual(A.accountOpeningPayload({ id: 'b1', campus: 'LMS1' }, '1,234.50').data, { account: 'b1', campus: 'LMS1', amount_paise: 123450 });
  assert.strictEqual(A.accountOpeningPayload({ id: 'b1', campus: 'LMS1' }, '0').data.amount_paise, 0);
  assert.strictEqual(A.accountOpeningPayload({ id: 'b1', campus: 'LMS1' }, 'abc').ok, false);
  assert.strictEqual(A.accountOpeningPayload(null, '5').ok, false);
  ok('payloads');

  assert.strictEqual(A.avgKmPerLitre([{ km_per_litre: 10 }, { km_per_litre: null }, { km_per_litre: 7 }]), 8.5);
  assert.strictEqual(A.avgKmPerLitre([{ km_per_litre: null }]), null);
  assert.strictEqual(A.avgKmPerLitre(undefined), null);
  ok('avgKmPerLitre');

  const cats = [{ id: 'fee_collection', label: 'Fee cash', group: 'fee' }, { id: 'fuel', label: 'Fuel', group: 'transport' }, { id: 'stationery', label: 'Stationery', group: 'school' }];
  const g = A.groupTotals({ LMS1: { fuel: -500, fee_collection: 900, stationery: -200, mystery: 5 } }, cats);
  assert.deepStrictEqual(g.LMS1.map((x) => [x.group, x.total, x.items.map((i) => i.label)]),
    [['fee', 900, ['Fee cash']], ['school', -200, ['Stationery']], ['transport', -500, ['Fuel']]]);
  ok('groupTotals');

  assert.deepStrictEqual(A.defaultPeriod('2026-10-22'), { from: '2026-04-01', to: '2026-10-22' });
  assert.deepStrictEqual(A.defaultPeriod('2027-02-01'), { from: '2026-04-01', to: '2027-02-01' });
  assert.strictEqual(A.samePeriodYear('2026-04-01', '2027-03-31'), true);
  assert.strictEqual(A.samePeriodYear('2026-03-31', '2026-04-01'), false);
  ok('period');

  const heads = [{ id: 'mun', label: 'MUN', active: true }, { id: 'sports', label: 'Sports fund', active: false }];
  assert.deepStrictEqual(A.collectionPayload(' Yoga & Camp 2027! ', heads), { ok: true, data: { head: 'yoga_camp_2027', label: 'Yoga & Camp 2027!' } });
  assert.strictEqual(A.collectionPayload('  ', heads).ok, false);
  assert.strictEqual(A.collectionPayload('!!!', heads).ok, false);
  assert.match(A.collectionPayload('mun', heads).error, /already/i);
  assert.match(A.collectionPayload('Sports', heads).error, /already/i, 'a switched-off head is switched on, not added again');
  ok('collectionPayload');

  const rows = A.collectionRows({ mun: { collected_paise: 1500, paid_paise: 400, balance_paise: 1100, bySchool: {} }, '': { collected_paise: 25, paid_paise: 0, balance_paise: 25 }, gone: { collected_paise: 1, paid_paise: 0, balance_paise: 1 } }, heads);
  assert.deepStrictEqual(rows.map((r) => [r.label, r.collected, r.paid, r.balance]), [['MUN', 1500, 400, 1100], ['gone', 1, 0, 1], ['No collection named (older entries)', 25, 0, 25]]);
  assert.deepStrictEqual(A.collectionRows(undefined, heads), []);
  ok('collectionRows');
})().catch((e) => { console.error(e); process.exit(1); });
