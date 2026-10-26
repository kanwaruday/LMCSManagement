// Day Book starting data (apps-script/office-start.gs): figures as at close of 22 Oct 2026. Synthetic data only.
'use strict';
const assert = require('assert');
const { boot } = require('./harness');

const fixture = {
  tokens: { 'clerk-token': 'clerk@example.org', 'am-token': 'am@example.org', 'fh-token': 'fh@example.org', 'owner-token': 'owner@example.org', 'pr-token': 'pr@example.org', 'acc-token': 'acc@example.org', 'co1-token': 'co1@example.org', 'co2-token': 'co2@example.org' },
  allowlist: [
    ['Email', 'Name', 'Campuses', 'Roles'],
    ['clerk@example.org', 'Clerk', 'LMS1', 'FeeClerk'],
    ['am@example.org', 'Admin Manager', 'LMS2', 'AdminManager'],
    ['fh@example.org', 'Finance Head', 'LMS1,LMS2', 'FinanceHead'],
    ['owner@example.org', 'Owner', 'ALL', 'Owner'],
    ['pr@example.org', 'Principal', 'LMS1', 'Principal'],
    ['acc@example.org', 'Accounts', 'LMS3', 'Accounts'],
    ['co1@example.org', 'Coordinator One', 'LMS1,LMS3', 'Coordinator'],
    ['co2@example.org', 'Coordinator Two', 'LMS2', 'Coordinator'],
  ],
};
const J = (x) => JSON.parse(JSON.stringify(x));

module.exports = function run(t) {
  const fresh = () => {
    const h = boot(fixture);
    h.addConfig(); h.addBook('LMS1', '2026-27'); h.addBook('LMS2', '2026-27');
    h.setNow(new Date('2026-10-26T10:00:00Z'));
    return h;
  };
  const rows = (h) => h.ctx.officeRows_(h.ctx.officeConfigBook_(), 'StartData');
  const item = (r, quest, key) => r.items.find((i) => i.quest === quest && i.item === key);
  const save = (h, d, tok) => h.call('start.save', d, tok || 'owner-token');
  const cash = (campus, amount, extra) => ({ quest: 'cash', item: campus, fields: Object.assign({ amount: amount, held_by: 'Desk box' }, extra) });

  t.test('StartData tab is created with its header and checked like the other Config tabs', () => {
    const h = fresh();
    assert.deepEqual(Array.from(h.ctx.officeConfigBook_().getSheetByName('StartData').values[0]), ['id', 'quest', 'item', 'campus', 'field', 'value', 'status', 'note', 'at', 'by']);
  });

  t.test('start.get returns the six quests in order with their fields', () => {
    const h = fresh();
    const r = h.call('start.get', {});
    assert.equal(r.success, true);
    assert.deepEqual(r.quests.map((q) => q.id), ['cash', 'bank', 'supplier', 'odometer', 'loan', 'users']);
    const loan = r.quests[4];
    assert.equal(loan.optional, true); assert.equal(r.quests[0].perCampus, true);
    assert.deepEqual(J(r.quests[1].fields.find((f) => f.id === 'last4')), { id: 'last4', label: r.quests[1].fields.find((f) => f.id === 'last4').label, type: 'last4', required: true });
    assert.deepEqual(r.quests[5].fields.find((f) => f.id === 'campus').choices, ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6', 'HES', 'ALL']);
    assert.deepEqual(r.items.filter((i) => i.quest === 'cash').map((i) => i.item), ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6', 'HES']);
    assert.equal(h.call('start.get', {}, 'pr-token').error, 'FORBIDDEN_ROLE');
  });

  t.test('save validation per type: rupees to paise, km, last4, email, choice, date, 8+ digits refused', () => {
    const h = fresh();
    const bank = (f) => ({ quest: 'bank', item: 'b1', fields: Object.assign({ campus: 'LMS1', bank: 'Some Bank', last4: '0042', balance: '1500.5' }, f) });
    const code = (d) => save(h, d).code;
    assert.equal(code(bank({ balance: '-1.x' })), 'BAD_AMOUNT');
    assert.equal(code(bank({ balance: '1.234' })), 'BAD_AMOUNT');
    assert.equal(code(bank({ balance: 'abc' })), 'BAD_AMOUNT');
    assert.equal(code(bank({ last4: '123' })), 'BAD_LAST4');
    assert.equal(code(bank({ last4: '12a4' })), 'BAD_LAST4');
    assert.equal(code(bank({ campus: 'LMS9' })), 'BAD_CHOICE');
    assert.equal(code(bank({ used_for: 'party' })), 'BAD_CHOICE');
    assert.equal(code(bank({ branch: 'A/c 123456789012' })), 'ACCOUNT_NUMBER_REFUSED');
    assert.equal(code(bank({ bank: '' })), 'START_FIELD_REQUIRED');
    assert.equal(code(bank({ colour: 'red' })), 'START_UNKNOWN_FIELD');
    assert.equal(save(h, bank({ last4: '123' })).error, 'BAD_LAST4: last4', 'the error names the field');
    assert.equal(code(Object.assign(bank(), { note: 'acct 12345678' })), 'ACCOUNT_NUMBER_REFUSED');
    assert.equal(code(Object.assign(bank(), { item: '12345678' })), 'ACCOUNT_NUMBER_REFUSED');
    assert.equal(code({ quest: 'nope', item: 'x', fields: {} }), 'START_BAD_QUEST');
    assert.equal(code({ quest: 'cash', item: 'LMS9', fields: { amount: 1, held_by: 'x' } }), 'START_BAD_ITEM');
    assert.equal(code({ quest: 'bank', item: '', fields: {} }), 'START_BAD_ITEM');
    const r = save(h, bank({ balance: 1500.5, used_for: 'fees' }));
    assert.equal(r.success, true);
    assert.equal(rows(h).find((x) => x.field === 'balance').value, '150050', 'rupees stored as integer paise');
    assert.equal(r.saved.fields.balance.value, 150050);
    assert.equal(r.saved.campus, 'LMS1');
    const odo = (f) => ({ quest: 'odometer', item: 'HP01A1', fields: Object.assign({ reg: 'HP 01 A 1', campus: 'LMS1', km: '45000', active: 'yes' }, f) });
    assert.equal(code(odo({ km: '12.5' })), 'BAD_KM'); assert.equal(code(odo({ km: '-3' })), 'BAD_KM');
    assert.equal(code(odo({ active: 'maybe' })), 'BAD_CHOICE');
    assert.equal(save(h, odo()).saved.fields.km.value, 45000);
    const user = (f) => ({ quest: 'users', item: 'u1', fields: Object.assign({ name: 'Test Clerk', email: 'Test.Clerk@LMS.org.in', campus: 'ALL', role: 'Fee Clerk' }, f) });
    assert.equal(code(user({ email: 'not an email' })), 'BAD_EMAIL');
    assert.equal(code(user({ email: 'someone@gmail.com' })), 'NOT_LMS_EMAIL');
    assert.equal(code(user({ role: 'Boss' })), 'BAD_CHOICE');
    assert.equal(code(user({ starts: '2026-02-30' })), 'BAD_DATE');
    assert.equal(save(h, user({ starts: '2026-10-23' })).saved.fields.email.value, 'test.clerk@lms.org.in');
  });

  t.test('8+ digit runs are refused in text only; big rupees, km and a negative bank balance are fine', () => {
    const h = fresh();
    const bank = (f) => ({ quest: 'bank', item: 'b1', fields: Object.assign({ campus: 'LMS1', bank: 'Some Bank', last4: '0042', balance: '1' }, f) });
    let r = save(h, bank({ balance: '10000000' }));
    assert.equal(r.success, true, JSON.stringify(r)); assert.equal(r.saved.fields.balance.value, 1000000000);
    r = save(h, bank({ balance: '-2500.50' }));
    assert.equal(r.success, true, 'overdraft'); assert.equal(r.saved.fields.balance.value, -250050);
    assert.equal(save(h, bank({ balance: '12345678901' })).code, 'BAD_AMOUNT', 'more than 10 rupee digits');
    assert.equal(save(h, { quest: 'supplier', item: 's1', fields: { name: 'X', buys: 'Y', owed: '-1' } }).code, 'BAD_AMOUNT', 'only the bank balance may be negative');
    assert.equal(save(h, { quest: 'odometer', item: 'V1', fields: { reg: 'HP 01 V 1', campus: 'LMS1', km: '123456789', active: 'yes' } }).success, true);
    assert.equal(save(h, bank({ bank: 'Bank 12345678' })).code, 'ACCOUNT_NUMBER_REFUSED');
    assert.equal(save(h, Object.assign(bank(), { note: 'acct 12345678' })).code, 'ACCOUNT_NUMBER_REFUSED');
  });

  t.test('NO_BOOK is found before anything is written (save and seed)', () => {
    const h = boot(fixture); h.addConfig(); h.setNow(new Date('2026-10-26T10:00:00Z')); // no campus book at all
    const n = () => rows(h).length;
    assert.equal(save(h, cash('LMS1', '5'), 'clerk-token').error, 'NO_BOOK');
    assert.equal(h.call('start.seed', { rows: [{ quest: 'cash', item: 'LMS2', field: 'amount', value: '40' }] }).error, 'NO_BOOK');
    assert.equal(n(), 0);
  });

  t.test('an explicit campus must be a school (or ALL); start.get narrows campus choices to the caller', () => {
    const h = fresh();
    assert.equal(save(h, { quest: 'loan', item: 'L1', campus: 'LMS9', skip: true }).code, 'BAD_CHOICE');
    assert.equal(save(h, { quest: 'loan', item: 'L1', campus: 'ALL', skip: true }).success, true);
    const g = h.call('start.get', {}, 'clerk-token');
    assert.deepEqual(Array.from(g.quests.find((q) => q.id === 'odometer').fields.find((f) => f.id === 'campus').choices), ['LMS1']);
    const o = h.call('start.get', {});
    assert.equal(o.quests.find((q) => q.id === 'users').fields.find((f) => f.id === 'campus').choices.length, 8);
    assert.equal(o.quests.find((q) => q.id === 'bank').fields.find((f) => f.id === 'balance').allowNegative, true);
    assert.equal(h.ctx.officeStartQuests_().find((q) => q.id === 'odometer').fields.find((f) => f.id === 'campus').choices.length, 7, 'the definition is not changed');
  });

  t.test('saves are confirmed, append-only, and the latest row per field wins; each save is audited', () => {
    const h = fresh();
    save(h, cash('LMS1', '100'));
    save(h, cash('LMS1', '250.25'));
    assert.equal(rows(h).filter((x) => x.field === 'amount').length, 2, 'append-only');
    assert.equal(new Set(rows(h).map((x) => x.id)).size, rows(h).length, 'unique ids');
    const it = item(h.call('start.get', {}), 'cash', 'LMS1');
    assert.equal(it.campus, 'LMS1');
    assert.deepEqual(J(it.fields.amount), { value: 25025, status: 'confirmed', note: '', at: '2026-10-26T10:00:00.000Z', by: 'owner@example.org' });
    const au = h.ctx.officeRows_(h.ctx.officeOpen_('LMS1', '2026-27'), 'Audit').filter((a) => a.action === 'start.save');
    assert.equal(au.length, 2); assert.equal(au[0].tab, 'StartData'); assert.equal(au[0].row_id, 'cash:LMS1');
  });

  t.test('a new item needs every required field; later saves may send only some', () => {
    const h = fresh();
    assert.equal(save(h, { quest: 'cash', item: 'LMS1', fields: { amount: '10' } }).code, 'START_FIELD_REQUIRED');
    save(h, cash('LMS1', '10'));
    assert.equal(save(h, { quest: 'cash', item: 'LMS1', fields: { amount: '11' } }).success, true);
  });

  t.test('start.seed: Owner only, writes known, never overwrites a confirmed field', () => {
    const h = fresh();
    save(h, cash('LMS1', '500'));
    const seed = { rows: [
      { quest: 'cash', item: 'LMS1', field: 'amount', value: '999' },
      { quest: 'cash', item: 'LMS2', field: 'amount', value: '40' },
      { quest: 'cash', item: 'LMS2', field: 'held_by', value: 'Office' },
      { quest: 'odometer', item: 'HP02B2', field: 'reg', value: 'HP 02 B 2' },
      { quest: 'odometer', item: 'HP02B2', field: 'campus', value: 'LMS2' },
    ] };
    assert.equal(h.call('start.seed', seed, 'fh-token').error, 'FORBIDDEN_ROLE');
    assert.equal(h.call('start.seed', { rows: [{ quest: 'cash', item: 'LMS2', field: 'amount', value: 'x' }] }).code, 'BAD_AMOUNT');
    const before = rows(h).length;
    assert.equal(h.call('start.seed', { rows: [seed.rows[1], { quest: 'bank', item: 'b', field: 'last4', value: '1' }] }).code, 'BAD_LAST4');
    assert.equal(rows(h).length, before, 'all rows validated before any write');
    const r = h.call('start.seed', seed);
    assert.equal(r.success, true); assert.deepEqual([r.written, r.kept], [4, 1]);
    const g = h.call('start.get', {});
    assert.equal(item(g, 'cash', 'LMS1').fields.amount.value, 50000);
    assert.equal(item(g, 'cash', 'LMS1').fields.amount.status, 'confirmed');
    assert.equal(item(g, 'cash', 'LMS2').fields.amount.status, 'known');
    assert.equal(item(g, 'odometer', 'HP02B2').campus, 'LMS2');
    assert.equal(h.ctx.officeRows_(h.ctx.officeOpen_('LMS1', '2026-27'), 'Audit').filter((a) => a.action === 'start.seed').length, 1);
  });

  t.test('progress counts required fields only; loan is shown only with items and never in a ring', () => {
    const h = fresh();
    save(h, cash('LMS1', '100', { counted_by: 'Someone' }));
    h.call('start.seed', { rows: [{ quest: 'cash', item: 'LMS2', field: 'amount', value: '40' }] });
    let p = h.call('start.progress', {});
    assert.equal(p.success, true);
    assert.deepEqual(J(p.progress.LMS1.cash), { confirmed: 2, known: 0, total: 2 }, 'counted_by is optional');
    assert.deepEqual(J(p.progress.LMS2.cash), { confirmed: 0, known: 1, total: 2 });
    assert.equal(p.progress.LMS1.loan, undefined, 'no loan item, no loan quest');
    assert.deepEqual(J(p.overall.cash), { confirmed: 2, known: 1, total: 14 });
    save(h, { quest: 'odometer', item: 'V1', fields: { reg: 'HP 01 V 1', campus: 'LMS1', km: 10, active: 'yes' } });
    save(h, { quest: 'loan', item: 'L1', fields: { reg: 'HP 01 V 1', lender: 'Some Finance', emi: '12000' } });
    save(h, { quest: 'loan', item: 'L2', campus: 'LMS1', skip: true });
    p = h.call('start.progress', {});
    assert.deepEqual(J(p.progress.LMS1.loan), { confirmed: 6, known: 0, total: 6 }, 'skipped counts as done; loan campus comes from the vehicle');
    assert.deepEqual(J(p.progress.LMS1.odometer), { confirmed: 4, known: 0, total: 4 });
    const ring = p.rings.LMS1;
    assert.equal(ring.total, Object.keys(p.progress.LMS1).filter((q) => q !== 'loan').reduce((s, q) => s + p.progress.LMS1[q].total, 0), 'loan left out of the ring');
    assert.equal(item(h.call('start.get', {}), 'loan', 'L2').fields.reg.status, 'skipped');
    assert.equal(save(h, { quest: 'cash', item: 'LMS3', skip: true }).code, 'START_NOT_OPTIONAL');
    assert.ok(p.progress.ALL.supplier, 'suppliers have no single campus');
  });

  t.test('Fee Clerk and Admin Manager: own campus cash + odometer only, in get, progress and save', () => {
    const h = fresh();
    save(h, { quest: 'odometer', item: 'V1', fields: { reg: 'HP 01 V 1', campus: 'LMS1', km: 10, active: 'yes' } });
    save(h, { quest: 'odometer', item: 'V2', fields: { reg: 'HP 02 V 2', campus: 'LMS2', km: 20, active: 'yes' } });
    save(h, { quest: 'bank', item: 'b1', fields: { campus: 'LMS1', bank: 'Some Bank', last4: '0042', balance: '1' } });
    const g = h.call('start.get', {}, 'clerk-token');
    assert.deepEqual(g.quests.map((q) => q.id), ['cash', 'odometer']);
    assert.deepEqual(g.items.map((i) => i.quest + ':' + i.item), ['cash:LMS1', 'odometer:V1']);
    assert.deepEqual(Object.keys(g.progress), ['LMS1']); assert.deepEqual(Object.keys(g.progress.LMS1), ['cash', 'odometer']);
    assert.deepEqual(Object.keys(h.call('start.progress', {}, 'am-token').progress), ['LMS2']);
    assert.equal(save(h, cash('LMS1', '5'), 'clerk-token').success, true);
    assert.equal(save(h, cash('LMS2', '5'), 'clerk-token').error, 'FORBIDDEN_CAMPUS');
    assert.equal(save(h, { quest: 'odometer', item: 'V1', fields: { km: 11 } }, 'clerk-token').success, true);
    assert.equal(save(h, { quest: 'odometer', item: 'V2', fields: { km: 21 } }, 'clerk-token').error, 'FORBIDDEN_CAMPUS');
    assert.equal(save(h, { quest: 'odometer', item: 'V1', fields: { campus: 'LMS2' } }, 'clerk-token').error, 'FORBIDDEN_CAMPUS');
    assert.equal(save(h, { quest: 'odometer', item: 'V3', fields: { reg: 'X', campus: 'LMS1', km: 1, active: 'no' } }, 'clerk-token').success, true, 'may add a vehicle of their own campus');
    assert.equal(save(h, { quest: 'bank', item: 'b1', fields: { balance: '2' } }, 'clerk-token').error, 'FORBIDDEN_ROLE');
    assert.equal(h.call('start.progress', {}, 'pr-token').error, 'FORBIDDEN_ROLE');
    assert.equal(h.call('start.export', {}, 'clerk-token').error, 'FORBIDDEN_ROLE');
    const fh = h.call('start.get', {}, 'fh-token');
    assert.equal(fh.quests.length, 6); assert.ok(fh.progress.LMS5, 'FinanceHead sees every campus');
    assert.equal(h.call('start.get', {}, 'acc-token').quests.length, 6, 'Accounts maps to FinanceHead');
  });

  t.test('start.progress works over the POST transport with the caller token', () => {
    const h = fresh();
    const r = JSON.parse(h.ctx.doPost({ postData: { contents: JSON.stringify({ action: 'start.progress', idToken: 'clerk-token', data: {} }) } }));
    assert.equal(r.success, true); assert.deepEqual(Object.keys(r.progress), ['LMS1']);
    assert.equal(JSON.parse(h.ctx.doGet({ parameter: { action: 'start.progress', idToken: 'clerk-token' } })).success, true);
    assert.equal(JSON.parse(h.ctx.doGet({ parameter: { action: 'start.progress', idToken: 'bad' } })).error, 'Not authorized');
  });

  t.test('start.export: cutoff, actual from confirmed cash only, lists, unconfirmed counts', () => {
    const h = fresh();
    save(h, cash('LMS1', '12345.5'));
    h.call('start.seed', { rows: [{ quest: 'cash', item: 'LMS2', field: 'amount', value: '40' }] });
    save(h, { quest: 'bank', item: 'b1', fields: { campus: 'LMS1', bank: 'Some Bank', last4: '0042', balance: '1500.5', used_for: 'fees' } });
    save(h, { quest: 'supplier', item: 's1', fields: { name: 'Pump X', buys: 'Diesel', owed: '700' } });
    save(h, { quest: 'loan', item: 'L2', campus: 'LMS1', skip: true });
    let r = h.call('start.export', {}, 'fh-token');
    assert.deepEqual(J(r.actual), {}, 'confirmed but not approved');
    assert.deepEqual(J(r.unapproved.cash), ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6', 'HES']);
    h.call('start.submit', { quest: 'cash', campus: 'LMS1' }, 'clerk-token');
    h.call('start.approve', { quest: 'cash', campus: 'LMS1', decision: 'approve' }, 'co1-token');
    r = h.call('start.export', {}, 'fh-token');
    assert.equal(r.success, true); assert.equal(r.cutoff, '2026-10-22');
    assert.deepEqual(J(r.actual), { LMS1: 12345.5 });
    assert.deepEqual(J(r.unapproved.cash), ['LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6', 'HES']);
    assert.equal(r.unapproved.odometer.length, 7);
    assert.deepEqual(J(r.banks[0]), { item: 'b1', campus: 'LMS1', confirmed: true, skipped: false, bank: 'Some Bank', branch: '', last4: '0042', used_for: 'fees', balance: 1500.5 });
    assert.equal(r.suppliers[0].owed, 700);
    assert.equal(r.loans[0].skipped, true);
    assert.deepEqual(r.odometers, []); assert.deepEqual(r.users, []);
    assert.deepEqual(J(r.unconfirmed), { cash: 6, bank: 0, supplier: 0, odometer: 0, loan: 0, users: 0 });
  });
  const st = (r, campus, quest) => r.states[campus][quest];
  const sub = (h, quest, campus, tok) => h.call('start.submit', { quest, campus }, tok || 'clerk-token');
  const appr = (h, quest, campus, decision, note, tok) => h.call('start.approve', { quest, campus, decision, note }, tok || 'co1-token');

  t.test('SetupQuests tab is seeded; a later row overrides label and approveRoles; school list stays the campus list', () => {
    const h = fresh();
    const sh = h.ctx.officeConfigBook_().getSheetByName('SetupQuests');
    assert.deepEqual(Array.from(sh.values[0]), ['id', 'label', 'fillRoles', 'approveRoles', 'approval', 'cutoff', 'optional', 'active']);
    const cashCfg = h.ctx.officeRows_(h.ctx.officeConfigBook_(), 'SetupQuests').find((r) => r.id === 'cash');
    assert.deepEqual([cashCfg.fillRoles, cashCfg.approveRoles, cashCfg.approval, cashCfg.cutoff], ['FeeClerk,AdminManager', 'Coordinator,Owner', 'yes', '2026-10-22']);
    let q = h.call('start.get', {}).quests.find((x) => x.id === 'cash');
    assert.deepEqual([Array.from(q.fillRoles), Array.from(q.approveRoles), q.approval, q.cutoff], [['FeeClerk', 'AdminManager'], ['Coordinator', 'Owner'], true, '2026-10-22']);
    h.ctx.officeWriteRow_(h.ctx.officeConfigBook_(), 'SetupQuests', { id: 'cash', label: 'Cash box', fillRoles: 'FeeClerk,AdminManager', approveRoles: 'Owner', approval: 'yes', cutoff: '2026-10-22', optional: 'no', active: 'yes' });
    q = h.call('start.get', {}).quests.find((x) => x.id === 'cash');
    assert.equal(q.label, 'Cash box'); assert.deepEqual(Array.from(q.approveRoles), ['Owner']);
    save(h, cash('LMS1', '10'), 'clerk-token'); sub(h, 'cash', 'LMS1');
    assert.equal(appr(h, 'cash', 'LMS1', 'approve').error, 'FORBIDDEN_ROLE', 'Coordinator no longer approves cash');
    assert.equal(appr(h, 'cash', 'LMS1', 'approve', '', 'owner-token').success, true);
    h.ctx.officeWriteRow_(h.ctx.officeConfigBook_(), 'SetupQuests', { id: 'loan', label: '', fillRoles: '', approveRoles: '', approval: 'no', cutoff: '', optional: 'yes', active: 'no' });
    assert.deepEqual(h.call('start.get', {}).quests.map((x) => x.id), ['cash', 'bank', 'supplier', 'odometer', 'users'], 'inactive quest dropped');
  });

  t.test('start.submit: only when every required field is confirmed; then the clerk is locked out, the Owner is not', () => {
    const h = fresh();
    assert.equal(sub(h, 'cash', 'LMS1').code, 'START_INCOMPLETE');
    h.call('start.seed', { rows: [{ quest: 'cash', item: 'LMS1', field: 'amount', value: '40' }, { quest: 'cash', item: 'LMS1', field: 'held_by', value: 'Desk' }] });
    assert.equal(sub(h, 'cash', 'LMS1').code, 'START_INCOMPLETE', 'known is not confirmed');
    assert.deepEqual(J(st(h.call('start.get', {}, 'clerk-token'), 'LMS1', 'cash')), { state: 'draft', by: '', at: '', note: '' });
    save(h, cash('LMS1', '40'), 'clerk-token');
    assert.equal(sub(h, 'cash', 'LMS2').error, 'FORBIDDEN_CAMPUS');
    assert.equal(sub(h, 'bank', 'LMS1', 'owner-token').code, 'START_NO_APPROVAL');
    const r = sub(h, 'cash', 'LMS1');
    assert.equal(r.success, true, JSON.stringify(r));
    assert.deepEqual(J(r.state), { state: 'submitted', by: 'clerk@example.org', at: '2026-10-26T10:00:00.000Z', note: '' });
    assert.equal(sub(h, 'cash', 'LMS1').code, 'START_LOCKED', 'already submitted');
    assert.equal(save(h, cash('LMS1', '41'), 'clerk-token').code, 'START_LOCKED');
    assert.equal(st(h.call('start.progress', {}, 'clerk-token'), 'LMS1', 'cash').state, 'submitted');
    assert.equal(save(h, cash('LMS1', '42')).success, true, 'Owner may still edit');
    // odometer: by the vehicle's campus, new vehicles too
    save(h, { quest: 'odometer', item: 'V1', fields: { reg: 'HP 01 V 1', campus: 'LMS1', km: 10, active: 'yes' } }, 'clerk-token');
    save(h, { quest: 'odometer', item: 'V2', fields: { reg: 'HP 01 V 2', campus: 'LMS1', km: 10, active: 'yes' } });
    h.call('start.seed', { rows: [{ quest: 'odometer', item: 'V2', field: 'km', value: '11' }] }); // kept: V2 is confirmed
    h.call('start.seed', { rows: [{ quest: 'odometer', item: 'V3', field: 'reg', value: 'HP 01 V 3' }, { quest: 'odometer', item: 'V3', field: 'campus', value: 'LMS1' }] });
    assert.equal(sub(h, 'odometer', 'LMS1').code, 'START_INCOMPLETE', 'V3 is only known');
    save(h, { quest: 'odometer', item: 'V3', fields: { km: 5, active: 'no', reg: 'HP 01 V 3', campus: 'LMS1' } }, 'clerk-token');
    const so = sub(h, 'odometer', 'LMS1'); assert.equal(so.success, true, JSON.stringify(so));
    assert.equal(save(h, { quest: 'odometer', item: 'V1', fields: { km: 12 } }, 'clerk-token').code, 'START_LOCKED');
    assert.equal(save(h, { quest: 'odometer', item: 'V9', fields: { reg: 'X', campus: 'LMS1', km: 1, active: 'no' } }, 'clerk-token').code, 'START_LOCKED');
    const au = h.ctx.officeRows_(h.ctx.officeOpen_('LMS1', '2026-27'), 'Audit').filter((a) => a.action === 'start.submit');
    assert.equal(au.length, 2); assert.equal(au[0].row_id, 'cash:LMS1'); assert.equal(au[0].campus, 'LMS1');
  });

  t.test('Coordinator: reviews cash + odometer of own campuses only, never banks; approves only their schools', () => {
    const h = fresh();
    save(h, { quest: 'bank', item: 'b1', fields: { campus: 'LMS1', bank: 'Some Bank', last4: '0042', balance: '1' } });
    save(h, { quest: 'odometer', item: 'V2', fields: { reg: 'HP 02 V 2', campus: 'LMS2', km: 20, active: 'yes' } });
    save(h, cash('LMS1', '5'), 'clerk-token'); sub(h, 'cash', 'LMS1');
    save(h, cash('LMS2', '6'), 'am-token'); sub(h, 'cash', 'LMS2', 'am-token');
    const g = h.call('start.get', {}, 'co1-token');
    assert.deepEqual(g.quests.map((q) => q.id), ['cash', 'odometer']);
    assert.deepEqual(g.items.map((i) => i.quest + ':' + i.item), ['cash:LMS1', 'cash:LMS3']);
    assert.deepEqual(Object.keys(g.states), ['LMS1', 'LMS3']); assert.equal(st(g, 'LMS1', 'cash').state, 'submitted');
    assert.deepEqual(Object.keys(h.call('start.progress', {}, 'co1-token').progress), ['LMS1', 'LMS3']);
    assert.equal(save(h, cash('LMS1', '7'), 'co1-token').error, 'FORBIDDEN_ROLE', 'review only');
    assert.equal(save(h, { quest: 'bank', item: 'b1', fields: { balance: '2' } }, 'co1-token').error, 'FORBIDDEN_ROLE');
    assert.equal(h.call('start.export', {}, 'co1-token').error, 'FORBIDDEN_ROLE');
    assert.equal(sub(h, 'cash', 'LMS3', 'co1-token').error, 'FORBIDDEN_ROLE', 'a reviewer does not submit');
    assert.equal(appr(h, 'cash', 'LMS2', 'approve').error, 'FORBIDDEN_CAMPUS', 'not their school');
    assert.equal(appr(h, 'cash', 'LMS1', 'approve', '', 'co2-token').error, 'FORBIDDEN_CAMPUS', 'another coordinator');
    assert.equal(appr(h, 'cash', 'LMS1', 'approve', '', 'clerk-token').error, 'FORBIDDEN_ROLE');
    assert.equal(appr(h, 'cash', 'LMS1', 'approve', '', 'fh-token').error, 'FORBIDDEN_ROLE', 'FinanceHead is not an approver');
    assert.equal(appr(h, 'cash', 'LMS3', 'approve').code, 'START_NOT_SUBMITTED');
    const r = appr(h, 'cash', 'LMS1', 'approve');
    assert.equal(r.success, true, JSON.stringify(r));
    assert.deepEqual(J(r.state), { state: 'approved', by: 'co1@example.org', at: '2026-10-26T10:00:00.000Z', note: '' });
    assert.equal(appr(h, 'cash', 'LMS2', 'approve', '', 'co2-token').success, true);
    assert.equal(appr(h, 'cash', 'LMS1', 'approve').code, 'START_NOT_SUBMITTED', 'only from submitted');
    assert.equal(save(h, cash('LMS1', '9'), 'clerk-token').code, 'START_LOCKED', 'approved stays locked');
    assert.equal(h.call('start.get', {}, 'pr-token').error, 'FORBIDDEN_ROLE');
  });

  t.test('return needs a note and reopens the quest; Owner approves any school; audited', () => {
    const h = fresh();
    save(h, cash('LMS2', '6'), 'am-token'); sub(h, 'cash', 'LMS2', 'am-token');
    assert.equal(appr(h, 'cash', 'LMS2', 'return', '', 'co2-token').code, 'NOTE_REQUIRED');
    assert.equal(appr(h, 'cash', 'LMS2', 'maybe', 'x', 'co2-token').code, 'START_BAD_DECISION');
    assert.equal(appr(h, 'cash', 'LMS2', 'return', 'acct 12345678', 'co2-token').code, 'ACCOUNT_NUMBER_REFUSED');
    const r = appr(h, 'cash', 'LMS2', 'return', 'Recount the drawer', 'co2-token');
    assert.deepEqual(J(r.state), { state: 'returned', by: 'co2@example.org', at: '2026-10-26T10:00:00.000Z', note: 'Recount the drawer' });
    assert.equal(st(h.call('start.get', {}, 'am-token'), 'LMS2', 'cash').note, 'Recount the drawer');
    assert.equal(save(h, cash('LMS2', '7'), 'am-token').success, true, 'reopened');
    assert.equal(sub(h, 'cash', 'LMS2', 'am-token').success, true);
    assert.equal(appr(h, 'cash', 'LMS2', 'approve', '', 'owner-token').state.state, 'approved');
    const au = h.ctx.officeRows_(h.ctx.officeOpen_('LMS2', '2026-27'), 'Audit').filter((a) => a.action === 'start.approve');
    assert.equal(au.length, 2); assert.equal(au[0].row_id, 'cash:LMS2'); assert.equal(au[0].campus, 'LMS2');
  });
};
