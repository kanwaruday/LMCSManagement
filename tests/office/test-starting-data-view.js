// Pure helpers of the Starting data page. Standalone: node tests/office/test-starting-data-view.js (no-op under run.js). Synthetic data.
'use strict';
const assert = require('assert');
const fs = require('fs');
if (require.main !== module) { module.exports = () => {}; return; }
(async () => {
  const S = await import('../../office/js/starting-data.js');
  const ok = (n) => console.log('  ok  - ' + n);

  // gate
  assert.strictEqual(S.startScope({ role: 'Owner' }), 'full');
  assert.strictEqual(S.startScope({ role: 'Teacher, Accounts' }), 'full');
  assert.strictEqual(S.startScope({ role: 'FinanceHead' }), 'full');
  assert.strictEqual(S.startScope({ role: 'FeeClerk' }), 'desk');
  assert.strictEqual(S.startScope({ role: 'AdminManager' }), 'desk');
  assert.strictEqual(S.startScope({ role: 'Principal' }), null);
  assert.strictEqual(S.startScope(null), null);
  assert.ok(S.isOwner({ role: 'Owner' }) && !S.isOwner({ role: 'Accounts' })); ok('role gate');

  // rings
  assert.deepStrictEqual(S.ringModel({ confirmed: 1, known: 2, total: 4 }), { confirmed: 1, known: 2, total: 4, pct: 25, toConfirm: 3, done: false });
  assert.deepStrictEqual(S.ringModel({ confirmed: 2, known: 0, total: 3 }).pct, 66, 'rounds down: never 100% before done');
  assert.strictEqual(S.ringModel({ confirmed: 3, known: 0, total: 3 }).done, true);
  assert.deepStrictEqual(S.ringModel({ confirmed: 0, known: 0, total: 0 }), { confirmed: 0, known: 0, total: 0, pct: 0, toConfirm: 0, done: false });
  const svg = S.ringSvg({ confirmed: 1, known: 2, total: 4 });
  assert.ok(/class="known"/.test(svg) && /class="on"/.test(svg) && /25% confirmed, 2 known to confirm/.test(svg));
  assert.ok(!/class="known"/.test(S.ringSvg({ confirmed: 2, known: 0, total: 2 })) && /All confirmed/.test(S.ringSvg({ confirmed: 2, known: 0, total: 2 })));
  assert.ok(/Nothing entered yet/.test(S.ringSvg({ confirmed: 0, known: 0, total: 0 })) && !/class="on"/.test(S.ringSvg({ confirmed: 0, known: 0, total: 0 })));
  const C = 2 * Math.PI * 16, on = /class="on" stroke-dasharray="([\d.]+) /.exec(svg)[1];
  assert.ok(Math.abs(Number(on) - C / 4) < 0.01, 'confirmed arc = a quarter');
  assert.ok(/class="known" stroke-dasharray="[^"]+" stroke-dashoffset="-25\.133"/.test(svg), 'known stripes start where confirmed ends');
  assert.strictEqual(S.confirmLine({ confirmed: 1, known: 2, total: 4 }), '3 to confirm');
  assert.strictEqual(S.confirmLine({ confirmed: 4, known: 0, total: 4 }), 'All confirmed'); ok('ring maths');

  // item -> form model
  const bank = { id: 'bank', fields: [
    { id: 'campus', label: 'School', type: 'choice', required: true, choices: ['LMS1', 'LMS2'] }, { id: 'bank', label: 'Bank', type: 'text', required: true },
    { id: 'branch', label: 'Branch', type: 'text', required: false }, { id: 'last4', label: 'Last 4', type: 'last4', required: true },
    { id: 'balance', label: 'Balance', type: 'rupees', required: true }] };
  const item = { quest: 'bank', item: 'b1', campus: 'LMS1', fields: {
    campus: { value: 'LMS1', status: 'confirmed' }, bank: { value: 'Test Bank', status: 'known' }, last4: { value: '0042', status: 'known' }, balance: { value: 12345650, status: 'known' } } };
  const m = S.formModel(bank, item);
  assert.deepStrictEqual(m.map((f) => [f.id, f.value, f.known]), [['campus', 'LMS1', false], ['bank', 'Test Bank', true], ['branch', '', false], ['last4', '0042', true], ['balance', '1,23,456.50', true]]);
  assert.strictEqual(m[3].hint, 'Last 4 digits only');
  assert.deepStrictEqual(S.formModel(bank, null).map((f) => f.value), ['', '', '', '', '']);
  assert.strictEqual(S.formModel({ fields: [{ id: 'reg', type: 'text' }] }, { fields: { reg: { value: 'x', status: 'skipped' } } })[0].value, '', 'skipped shows empty');
  assert.strictEqual(S.rupeesText(5000), '50.00'); assert.strictEqual(S.rupeesText(1000000000), '1,00,00,000.00'); ok('form model, Indian grouping');

  // payload: rupees sent as plain rupees, last4 / km / 8+ digits checked, required, cleared fields, campus
  const vals = (o) => Object.assign({ campus: 'LMS1', bank: 'Test Bank', branch: '', last4: '0042', balance: '1,23,456.50' }, o);
  let p = S.savePayload(bank, 'b1', vals(), m, null);
  assert.deepStrictEqual(p, { ok: true, data: { quest: 'bank', item: 'b1', fields: { campus: 'LMS1', bank: 'Test Bank', last4: '0042', balance: '123456.50' } } });
  assert.deepStrictEqual(S.savePayload(bank, 'b1', vals({ balance: '₹ 1,500' }), m, null).data.fields.balance, '1500');
  assert.deepStrictEqual(S.savePayload(bank, 'b1', vals({ balance: '0' }), m, null).data.fields.balance, '0');
  assert.deepStrictEqual(S.savePayload(bank, 'b1', vals({ balance: '1.234' }), m, null), { ok: false, code: 'BAD_AMOUNT', field: 'balance' });
  assert.deepStrictEqual(S.savePayload(bank, 'b1', vals({ balance: '-5' }), m, null), { ok: false, code: 'BAD_AMOUNT', field: 'balance' });
  assert.deepStrictEqual(S.savePayload(bank, 'b1', vals({ last4: '123' }), m, null), { ok: false, code: 'BAD_LAST4', field: 'last4' });
  assert.deepStrictEqual(S.savePayload(bank, 'b1', vals({ branch: 'A/c 123456789012' }), m, null), { ok: false, code: 'ACCOUNT_NUMBER_REFUSED', field: 'branch' });
  assert.deepStrictEqual(S.savePayload(bank, 'b1', vals({ bank: ' ' }), m, null), { ok: false, code: 'START_FIELD_REQUIRED', field: 'bank' });
  const m2 = S.formModel(bank, { fields: Object.assign({}, item.fields, { branch: { value: 'Old', status: 'confirmed' } }) });
  assert.strictEqual(S.savePayload(bank, 'b1', vals({ branch: '' }), m2, null).data.fields.branch, '', 'a cleared value is sent as empty');
  const odo = { id: 'odometer', fields: [{ id: 'km', label: 'Km', type: 'km', required: true }] };
  assert.deepStrictEqual(S.savePayload(odo, 'v', { km: '12.5' }, S.formModel(odo, null), 'LMS4'), { ok: false, code: 'BAD_KM', field: 'km' });
  assert.deepStrictEqual(S.savePayload(odo, 'v', { km: '45000' }, S.formModel(odo, null), 'LMS4').data, { quest: 'odometer', item: 'v', fields: { km: '45000' } }, 'campus comes from the campus field');
  assert.strictEqual(S.savePayload(odo, 'v', { km: '123456789' }, S.formModel(odo, null), 'LMS4').ok, true, 'no account-number guard on km');
  const loan = { id: 'loan', fields: [{ id: 'reg', label: 'Reg', type: 'text', required: true }] };
  assert.strictEqual(S.savePayload(loan, 'l', { reg: 'X' }, S.formModel(loan, null), 'LMS4').data.campus, 'LMS4', 'a loan names its school');
  assert.strictEqual(S.savePayload(loan, 'l', { reg: 'X' }, S.formModel(loan, null), 'ALL').data.campus, undefined, 'ALL is no campus');
  assert.strictEqual(S.savePayload(bank, 'b1', vals({ balance: '1,00,00,000' }), m, null).data.fields.balance, '10000000', 'a crore is an amount, not an account number');
  assert.deepStrictEqual(S.savePayload(bank, 'b1', vals({ balance: '12345678901' }), m, null), { ok: false, code: 'BAD_AMOUNT', field: 'balance' });
  const od = { id: 'bank', fields: [{ id: 'balance', label: 'Balance', type: 'rupees', required: true, allowNegative: true }] };
  assert.strictEqual(S.formModel(od, { fields: { balance: { value: -250050, status: 'known' } } })[0].value, '-2,500.50');
  assert.strictEqual(S.savePayload(od, 'b', { balance: '-2,500.50' }, S.formModel(od, null), null).data.fields.balance, '-2500.50', 'overdraft'); ok('payload builder');

  // refusal codes
  assert.deepStrictEqual(S.parseError({ success: false, error: 'BAD_LAST4: last4', code: 'BAD_LAST4' }), { code: 'BAD_LAST4', field: 'last4' });
  assert.deepStrictEqual(S.parseError({ success: false, error: 'BAD_LAST4: last4' }), { code: 'BAD_LAST4', field: 'last4' });
  assert.deepStrictEqual(S.parseError({ success: false, error: 'FORBIDDEN_CAMPUS' }), { code: 'FORBIDDEN_CAMPUS', field: null }); ok('error code and field');

  // deep link
  assert.deepStrictEqual(S.parseDeepLink('?campus=LMS4&quest=cash'), { campus: 'LMS4', quest: 'cash' });
  assert.deepStrictEqual(S.parseDeepLink('?campus=lms4'), { campus: 'LMS4', quest: null });
  assert.deepStrictEqual(S.parseDeepLink('?campus=ALL&quest=supplier'), { campus: 'ALL', quest: 'supplier' });
  assert.deepStrictEqual(S.parseDeepLink('?campus=LMS9&quest=<x>'), { campus: null, quest: null });
  assert.deepStrictEqual(S.parseDeepLink(''), { campus: null, quest: null }); ok('deep link');

  // a school's quests and items
  const quests = ['cash', 'bank', 'supplier', 'odometer', 'loan', 'users'].map((id) => ({ id }));
  const data = { quests, progress: { LMS4: { cash: {}, bank: {}, odometer: {}, users: {} }, HES: { cash: {}, bank: {}, odometer: {}, loan: {}, users: {} }, ALL: { supplier: {}, users: {} } },
    items: [{ quest: 'odometer', item: 'v1', campus: 'LMS4' }, { quest: 'odometer', item: 'v2', campus: 'LMS5' }, { quest: 'supplier', item: 's1', campus: '' }] };
  assert.deepStrictEqual(S.schoolQuests(data, 'LMS4'), ['cash', 'bank', 'odometer', 'loan', 'users'], 'loans can be added at a school');
  assert.deepStrictEqual(S.schoolQuests(data, 'ALL'), ['supplier', 'users']);
  assert.deepStrictEqual(S.schoolQuests({ quests: [{ id: 'cash' }, { id: 'odometer' }], progress: { LMS1: { cash: {}, odometer: {} } } }, 'LMS1'), ['cash', 'odometer'], 'a desk role has no loans');
  assert.deepStrictEqual(S.itemsFor(data, 'LMS4', 'odometer').map((i) => i.item), ['v1']);
  assert.deepStrictEqual(S.itemsFor(data, 'ALL', 'supplier').map((i) => i.item), ['s1']);
  assert.ok(/^bank-[a-z0-9]+$/.test(S.newKey('bank', 1761465600000)) && S.newKey('bank', 1761465600000).length <= 64); ok('school quests, items, keys');

  // Buddy: the tour beats and the backend URL the homes use
  assert.deepStrictEqual(S.DAYBOOK_TOUR_BEATS.map((b) => b.target), ['#sd-board', '.sd-ring', undefined]);
  assert.strictEqual(S.DAYBOOK_TOUR_BEATS[2].text, 'Inside a school, amber fields come from our records. Check each one against your books, then tap Confirm, or correct it and save.');
  const { GAME_BACKEND_URL } = await import('../../office/js/config.js');
  const home = /const GAME_BACKEND_URL = '([^']*)'/.exec(fs.readFileSync(__dirname + '/../../owner/index.html', 'utf8'))[1];
  assert.strictEqual(GAME_BACKEND_URL, home, 'same game backend as the homes');
  const page = fs.readFileSync(__dirname + '/../../office/starting-data.html', 'utf8');
  assert.ok(/assets\/game\/game\.css/.test(page) && /assets\/game\/game\.js/.test(page) && /id="game-root"/.test(page)); ok('Buddy wiring');
  // the page's payload reaches the real backend: a FinanceHead of LMS1,LMS2 saves LMS5's cash (no campus sent, no refusal)
  const { boot } = require('./harness');
  const hb = boot({ tokens: { 'fh-token': 'fh@example.org' }, allowlist: [['Email', 'Name', 'Campuses', 'Roles'], ['fh@example.org', 'FH', 'LMS1,LMS2', 'FinanceHead']] });
  hb.addConfig(); hb.addBook('LMS1', '2026-27'); hb.setNow(new Date('2026-10-26T10:00:00Z'));
  const cq = hb.call('start.get', {}, 'fh-token').quests.find((q) => q.id === 'cash');
  const cp = S.savePayload(cq, 'LMS5', { amount: '1,234.50', held_by: 'Desk box', counted_by: '' }, S.formModel(cq, null), 'LMS5');
  assert.strictEqual(cp.data.campus, undefined);
  const sr = hb.call('start.save', cp.data, 'fh-token');
  assert.strictEqual(sr.success, true, JSON.stringify(sr)); assert.strictEqual(sr.saved.fields.amount.value, 123450); ok('payload accepted by the backend across schools');
  console.log('starting data view: ok');
})().catch((e) => { console.error(e); process.exit(1); });
