// lane-d (Uday, 26 Nov): a payment above the cash limit is a PAYMENT REQUEST; the Finance Head (Pawan) or the Owner approves it, pays it by
// bank outside the portal, marks it paid with the bank ref (writes one bank OUT row), and attaches the bank proof; no proof = the day can't close.
// apps-script/office-payreq.gs. Synthetic data only.
'use strict';
const assert = require('assert');
const { boot } = require('./harness');

const fixture = {
  tokens: { 'clerk-token': 'clerk@example.org', 'fh-token': 'fh@example.org', 'owner-token': 'owner@example.org', 'both-token': 'both@example.org', 'p1-token': 'p1@example.org' },
  allowlist: [
    ['Email', 'Name', 'Campuses', 'Roles'],
    ['clerk@example.org', 'Clerk', 'LMS1', 'FeeClerk'],
    ['fh@example.org', 'Finance Head', 'ALL', 'FinanceHead'],
    ['owner@example.org', 'Owner', 'ALL', 'Owner'],
    ['both@example.org', 'Both', 'LMS1', 'FeeClerk,FinanceHead'],
    ['p1@example.org', 'Principal', 'LMS1', 'Principal'],
  ],
};

module.exports = function run(t) {
  const fresh = () => {
    const h = boot(fixture);
    h.addConfig(); h.addBook('LMS1', '2026-27'); h.addBook('LMS1', '2025-26');
    h.setNow(new Date('2026-10-21T10:00:00Z'));
    const ss = h.ctx.officeOpen_('LMS1', '2026-27');
    ['slip', 'proof', 'proof2'].forEach((id) => h.ctx.officeWriteRow_(ss, 'Files', { id, campus: 'LMS1', drive_id: 'D-' + id, name: id + '.jpg' }));
    return h;
  };
  let n = 0;
  const ask = (h, o, tok) => h.call('payreq.add', Object.assign({ id: 'q' + (++n), campus: 'LMS1', payee: 'Demo Builders', amount_paise: 900000, category: 'stationery', narration: 'Notice boards', file_id: 'slip' }, o), tok || 'clerk-token');
  const decide = (h, rid, approve, o, tok) => h.call('payreq.decide', Object.assign({ id: 'd' + (++n), campus: 'LMS1', request_id: rid, approve }, o), tok || 'fh-token');
  const paid = (h, rid, o, tok) => h.call('payreq.paid', Object.assign({ id: 'p' + (++n), campus: 'LMS1', request_id: rid, bank_ref: 'UTR123456', account: 'bank:LMS1', proof_file_id: 'proof' }, o), tok || 'fh-token');
  const one = (h, rid) => h.call('payreq.list', { campus: 'LMS1' }, 'fh-token').requests.find((r) => r.id === rid);

  t.test('payreq: the clerk raises one (bill photo, payee, an OUT head); a resend is a retry; the Finance Head sees it', () => {
    const h = fresh();
    assert.equal(ask(h, { id: 'a', file_id: '' }).error, 'FILE_REQUIRED');
    assert.equal(ask(h, { id: 'a', file_id: 'nope' }).error, 'FILE_MISSING');
    assert.equal(ask(h, { id: 'a', payee: ' ' }).error, 'PAYEE_REQUIRED');
    assert.equal(ask(h, { id: 'a', category: 'fee_collection' }).error, 'BAD_CATEGORY');
    assert.equal(ask(h, { id: 'a', amount_paise: 50 }).error, 'BAD_AMOUNT');
    assert.equal(ask(h, { id: 'a' }).error, undefined);
    assert.equal(ask(h, { id: 'a' }).duplicate, true);
    const r = one(h, 'a'); assert.equal(r.state, 'requested'); assert.equal(r.created_by, 'clerk@example.org'); assert.equal(r.amount_paise, 900000);
    assert.equal(h.call('payreq.list', { campus: 'LMS1', state: 'approved' }, 'fh-token').requests.length, 0);
  });

  t.test('payreq: only the Finance Head or the Owner decide; reject needs a reason; decided once; nobody decides their own (the Owner may)', () => {
    const h = fresh(); ask(h, { id: 'a' });
    assert.equal(decide(h, 'a', true, {}, 'clerk-token').error, 'FORBIDDEN_ROLE');
    assert.equal(decide(h, 'a', true, {}, 'p1-token').error, 'FORBIDDEN_ROLE');
    assert.equal(decide(h, 'a', false, { reason: ' ' }).error, 'REASON_REQUIRED');
    assert.equal(decide(h, 'a', true, { id: 'dd' }).state, 'approved');
    assert.equal(decide(h, 'a', true, { id: 'dd' }).duplicate, true);
    assert.equal(decide(h, 'a', false, { reason: 'changed' }).error, 'ALREADY_DECIDED');
    assert.equal(one(h, 'a').decided_by, 'fh@example.org');
    ask(h, { id: 'b' }, 'both-token');
    assert.equal(decide(h, 'b', true, {}, 'both-token').error, 'OWN_ENTRY');
    assert.equal(decide(h, 'b', true, {}, 'owner-token').state, 'approved');
    ask(h, { id: 'c' }); assert.equal(decide(h, 'c', false, { reason: 'Get a second quote' }).state, 'rejected');
    assert.equal(paid(h, 'c').error, 'NOT_APPROVED');
  });

  t.test('payreq: paid needs approval, a bank ref and one of the school\'s bank accounts; it writes ONE bank OUT row and a resend doesn\'t double it', () => {
    const h = fresh(); ask(h, { id: 'a' });
    assert.equal(paid(h, 'a').error, 'NOT_APPROVED');
    decide(h, 'a', true);
    assert.equal(paid(h, 'a', { bank_ref: ' ' }).error, 'BANK_REF_REQUIRED');
    assert.equal(paid(h, 'a', { account: 'cash:LMS1' }).error, 'BAD_ACCOUNT');
    assert.equal(paid(h, 'a', { proof_file_id: 'nope' }).error, 'FILE_MISSING');
    assert.equal(paid(h, 'a', { id: 'pp' }, 'clerk-token').error, 'FORBIDDEN_ROLE');
    const r = paid(h, 'a', { id: 'pp' }); assert.equal(r.entry_id, 'pay-a'); assert.equal(r.proof_pending, false);
    assert.equal(paid(h, 'a', { id: 'pp2' }).duplicate, true);
    const rows = h.call('daybook.list', { campus: 'LMS1', from: '2026-10-21' }, 'clerk-token').entries.filter((e) => e.id === 'pay-a');
    assert.equal(rows.length, 1); assert.equal(rows[0].direction, 'OUT'); assert.equal(rows[0].mode, 'bank'); assert.equal(rows[0].amount_paise, 900000); assert.equal(rows[0].payee, 'Demo Builders');
    assert.ok(/UTR123456/.test(rows[0].narration));
    const q = one(h, 'a'); assert.equal(q.state, 'paid'); assert.equal(q.bank_ref, 'UTR123456'); assert.equal(q.proof_file_id, 'proof'); assert.equal(q.proof_pending, false);
  });

  t.test('payreq (proof, audit #9): paid needs the bank proof (FILE_REQUIRED), never the bill itself (PROOF_IS_BILL); nothing written until it has one', () => {
    const h = fresh(); ask(h, { id: 'a' }); decide(h, 'a', true);
    const book = () => h.ctx.officeRows_(h.ctx.officeOpen_('LMS1', '2026-27'), 'DayBook');
    assert.equal(paid(h, 'a', { proof_file_id: '', paid_date: '2026-10-20' }).error, 'FILE_REQUIRED');
    assert.equal(paid(h, 'a', { proof_file_id: 'slip', paid_date: '2026-10-20' }).error, 'PROOF_IS_BILL', 'the bill photo is not a bank proof');
    assert.equal(paid(h, 'a', { proof_file_id: 'nope', paid_date: '2026-10-20' }).error, 'FILE_MISSING');
    assert.equal(book().length, 0); assert.equal(one(h, 'a').state, 'approved');
    const r = paid(h, 'a', { paid_date: '2026-10-20' }); assert.equal(r.proof_pending, false);
    assert.equal(one(h, 'a').state, 'paid'); assert.equal(book().length, 1);
    // payreq.proof now only completes a request paid before this rule (proof pending); one with its proof answers duplicate
    assert.equal(h.call('payreq.proof', { id: 'pr1', campus: 'LMS1', request_id: 'a', proof_file_id: 'proof2' }, 'fh-token').duplicate, true);
    assert.equal(h.call('day.close', { id: 'c2', campus: 'LMS1', close_date: '2026-10-20' }, 'fh-token').success, true);
    ask(h, { id: 'b' }); assert.equal(h.call('payreq.proof', { id: 'pr3', campus: 'LMS1', request_id: 'b', proof_file_id: 'proof' }, 'fh-token').error, 'NOT_PAID');
  });
};
