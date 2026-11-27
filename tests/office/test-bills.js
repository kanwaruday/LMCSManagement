// Bills to pay (Uday, 27 Nov: fuel on credit, settled fortnightly by Pawan Sir): the register and the pump settlement request.
'use strict';
const assert = require('assert');
const { boot } = require('./harness');

const fixture = {
  tokens: { 'clerk-token': 'clerk@example.org', 'fh-token': 'fh@example.org', 'owner-token': 'owner@example.org' },
  allowlist: [
    ['Email', 'Name', 'Campuses', 'Roles'],
    ['clerk@example.org', 'Clerk', 'LMS1', 'FeeClerk'],
    ['fh@example.org', 'Finance Head', 'ALL', 'FinanceHead'],
    ['owner@example.org', 'Owner', 'ALL', 'Owner'],
  ],
};
const J = (x) => JSON.parse(JSON.stringify(x));

module.exports = function run(t) {
  const fresh = () => {
    const h = boot(fixture); h.addConfig(); h.addBook('LMS1', '2026-27');
    h.setNow(new Date('2026-11-28T06:00:00Z'));
    const cfg = h.ctx.officeConfigBook_(), ss = h.ctx.officeOpen_('LMS1', '2026-27');
    h.ctx.officeWriteRow_(cfg, 'Accounts', { id: 'pump1', label: 'Kullu Fuels', kind: 'credit', campus: 'LMS1', active: 'true' });
    h.ctx.officeWriteRow_(cfg, 'Accounts', { id: 'pump2', label: 'Bhuntar Fuels', kind: 'credit', campus: 'LMS1', active: 'true' });
    ['b1', 'b2', 'b3'].forEach((id, i) => h.ctx.officeWriteRow_(ss, 'Files', { id: id + '-bill', campus: 'LMS1', drive_id: 'D' + i, name: id + '.jpg' }));
    h.ctx.officeWriteRow_(ss, 'Files', { id: 'icici', campus: 'LMS1', drive_id: 'D9', name: 'icici.pdf' });
    // three fuel bills on pump1 and one on pump2 (credit rows as the fills write them)
    const bill = (id, account, date, paise) => h.ctx.officeAppend_(ss, 'DayBook', { id, campus: 'LMS1', entry_date: date, direction: 'OUT', mode: 'credit', bucket: '', category: 'fuel', amount_paise: paise,
      payee: account === 'pump1' ? 'Kullu Fuels' : 'Bhuntar Fuels', narration: 'Driver fill', file_id: id + '-bill', reverses: '', account, charged_to: 'LMS1', vehicle: 'HP665805', litres_ml: 42000, odometer_km: 52000 }, { email: 'clerk@example.org' }, {});
    bill('b1', 'pump1', '2026-11-14', 980000); bill('b2', 'pump1', '2026-11-20', 410000); bill('b3', 'pump1', '2026-11-26', 120000); bill('c1', 'pump2', '2026-11-25', 300000);
    return h;
  };
  const settle = (h, o, tok) => h.call('payreq.add', Object.assign({ id: 's1', campus: 'LMS1', settles_account: 'pump1', bills: ['b1', 'b2'], amount_paise: 1390000 }, o), tok || 'clerk-token');
  const register = (h, tok) => J(h.call('bills.open', { campus: 'LMS1' }, tok || 'fh-token'));
  const pump = (r, id) => r.accounts.find((a) => a.account === id);
  const book = (h) => h.ctx.officeRows_(h.ctx.officeOpen_('LMS1', '2026-27'), 'DayBook');

  t.test('register: open bills per pump with total, owed (ledger) and age; nothing in a request yet', () => {
    const h = fresh(), r = register(h);
    assert.deepEqual([pump(r, 'pump1').open_paise, pump(r, 'pump1').in_request_paise, pump(r, 'pump1').oldest_open_days, pump(r, 'pump1').owed_paise], [1510000, 0, 14, 1510000]);
    assert.deepEqual(pump(r, 'pump1').bills.map((b) => [b.id, b.age_days, b.request_id]), [['b1', 14, ''], ['b2', 8, ''], ['b3', 2, '']]);
    assert.deepEqual([r.total_open_paise, r.total_in_request_paise, r.as_of], [1810000, 0, '2026-11-28']);
    assert.equal(register(h, 'clerk-token').accounts.length, 2, 'the Fee Clerk reads the register of their school');
  });

  t.test('settlement: amount must equal the selected bills (SETTLEMENT_MISMATCH); a bill of another pump, unknown or twice is refused; nothing written', () => {
    const h = fresh();
    assert.equal(settle(h, { amount_paise: 1400000 }).code, 'SETTLEMENT_MISMATCH');
    assert.equal(settle(h, { bills: ['b1', 'c1'], amount_paise: 1280000 }).code, 'BILL_NOT_OPEN', 'pump2\'s bill on pump1');
    assert.equal(settle(h, { bills: ['b1', 'zz'], amount_paise: 980000 }).code, 'BILL_NOT_OPEN');
    assert.equal(settle(h, { bills: ['b1', 'b1'], amount_paise: 1960000 }).code, 'BILLS_REQUIRED');
    assert.equal(settle(h, { bills: [] }).code, 'BILLS_REQUIRED');
    assert.equal(settle(h, { settles_account: 'cash:LMS1' }).error, 'SETTLEMENT_ACCOUNT_REQUIRED');
    assert.equal(h.call('payreq.list', { campus: 'LMS1' }, 'fh-token').requests.length, 0);
  });

  t.test('settlement happy path: the clerk raises it (payee = the pump); the bills show in the request; a bill can\'t go in twice', () => {
    const h = fresh();
    assert.deepEqual(J(settle(h, {})), { success: true, id: 's1', duplicate: false });
    const q = h.call('payreq.list', { campus: 'LMS1' }, 'fh-token').requests[0];
    assert.deepEqual([q.payee, q.amount_paise, q.category, q.settles_account, q.bills], ['Kullu Fuels', 1390000, 'credit_settlement', 'pump1', ['b1', 'b2']]);
    const r = register(h);
    assert.deepEqual([pump(r, 'pump1').open_paise, pump(r, 'pump1').in_request_paise, pump(r, 'pump1').oldest_open_days], [120000, 1390000, 2]);
    assert.equal(settle(h, { id: 's2', bills: ['b2', 'b3'], amount_paise: 530000 }).code, 'BILL_NOT_OPEN', 'b2 is already in s1');
    assert.equal(settle(h, { comma: 1, bills: 'b1,b2' }).duplicate, true, 'a resend is a retry');
  });

  t.test('settlement paid: needs the bank proof, never a bill photo; then one bank row settles the pump, owed drops, the bills leave the register', () => {
    const h = fresh(); settle(h, {});
    assert.equal(h.call('payreq.decide', { id: 'd1', campus: 'LMS1', request_id: 's1', approve: true }, 'fh-token').state, 'approved');
    const paid = (o) => h.call('payreq.paid', Object.assign({ id: 'p1', campus: 'LMS1', request_id: 's1', bank_ref: 'UTR998877', account: 'bank:LMS1' }, o), 'fh-token');
    assert.equal(paid({}).code, 'FILE_REQUIRED');
    assert.equal(paid({ proof_file_id: 'b2-bill' }).code, 'PROOF_IS_BILL', 'a fuel bill is not the bank proof');
    assert.equal(book(h).length, 4, 'nothing written yet');
    assert.equal(paid({ proof_file_id: 'icici' }).proof_pending, false);
    const row = book(h).find((r) => r.id === 'pay-s1');
    assert.deepEqual([row.mode, row.category, row.amount_paise, row.settles_account, row.settles], ['bank', 'credit_settlement', 1390000, 'pump1', 's1']);
    const r = register(h);
    assert.deepEqual([pump(r, 'pump1').owed_paise, pump(r, 'pump1').open_paise, pump(r, 'pump1').in_request_paise], [120000, 120000, 0]);
    assert.deepEqual(pump(r, 'pump1').bills.map((b) => b.id), ['b3'], 'settled bills leave the register; their rows stay in the Day Book');
    assert.equal(book(h).filter((x) => ['b1', 'b2'].includes(x.id)).length, 2);
  });

  t.test('a rejected settlement frees its bills; a reversed bill is not a bill', () => {
    const h = fresh(); settle(h, {});
    h.call('payreq.decide', { id: 'd1', campus: 'LMS1', request_id: 's1', approve: false, reason: 'wrong bills' }, 'fh-token');
    assert.equal(pump(register(h), 'pump1').open_paise, 1510000);
    h.ctx.officeAppend_(h.ctx.officeOpen_('LMS1', '2026-27'), 'DayBook', { id: 'rv-b3', campus: 'LMS1', entry_date: '2026-11-27', direction: 'IN', mode: 'credit', bucket: '', category: 'fuel', amount_paise: 120000, reverses: 'b3', account: 'pump1', charged_to: 'LMS1' }, { email: 'fh@example.org' }, {});
    assert.deepEqual(pump(register(h), 'pump1').bills.map((b) => b.id), ['b1', 'b2']);
    assert.equal(settle(h, { id: 's3', bills: ['b3'], amount_paise: 120000 }).code, 'BILL_NOT_OPEN');
  });

  t.test('game bridge: the clerk reads the register and raises a settlement with comma bills; the verifier reads it too', () => {
    const h = fresh(), KEY = 'k'.repeat(40); h.props.OFFICE_GAME_KEY = KEY;
    const game = (action, params, o) => J(h.ctx.officeGame_(Object.assign({ action, key: KEY, role: 'fee_clerk', campus: 'LMS1', email: 'clerk@example.org', params }, o)));
    assert.equal(game('gameBillsOpen', {}).data.total_open_paise, 1810000);
    assert.equal(game('gameBillsOpen', {}, { role: 'accounts_verifier', email: 'fh@example.org' }).data.accounts.length, 2);
    assert.equal(game('gamePayReqAdd', { id: 'g1', settles_account: 'pump1', bills: 'b1,b2', amount_paise: '1390001' }).data.code, 'SETTLEMENT_MISMATCH');
    assert.equal(game('gamePayReqAdd', { id: 'g1', settles_account: 'pump1', bills: 'b1,b2', amount_paise: '1390000' }).data.duplicate, false);
  });

  t.test('G2 low (28 Nov): a settlement reads the open bills and appends under the script lock, so two at once can\'t take the same bill', () => {
    const h = fresh(); let held = false; const seen = [];
    h.ctx.LockService = { getScriptLock: () => ({ waitLock() { assert.equal(held, false, 'one writer at a time'); held = true; }, releaseLock() { held = false; } }) };
    const read = h.ctx.officeCreditBills_, append = h.ctx.officeAppend_;
    h.ctx.officeCreditBills_ = function () { seen.push(['read', held]); return read.apply(this, arguments); };
    h.ctx.officeAppend_ = function (ss, tab) { if (tab === 'PayRequests') seen.push(['append', held]); return append.apply(this, arguments); };
    assert.equal(settle(h, {}).duplicate, false);
    assert.equal(settle(h, { id: 's2', bills: ['b2'], amount_paise: 410000 }).code, 'BILL_NOT_OPEN', 'the second one, right after, finds b2 taken');
    assert.ok(seen.length >= 3 && seen.every(([, l]) => l === true), JSON.stringify(seen));
    assert.equal(held, false, 'released after each call');
  });
};

