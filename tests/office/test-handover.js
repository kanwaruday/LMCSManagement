// Cash handover between Fee Clerks of two campuses (apps-script/office-handover.gs). Synthetic data only.
'use strict';
const assert = require('assert');
const { boot } = require('./harness');

const fixture = {
  tokens: { 'c1-token': 'c1@example.org', 'c2-token': 'c2@example.org', 'hes-token': 'hes@example.org', 'fh-token': 'fh@example.org', 'owner-token': 'owner@example.org' },
  allowlist: [
    ['Email', 'Name', 'Campuses', 'Roles'],
    ['c1@example.org', 'Clerk One', 'LMS1', 'FeeClerk'],
    ['c2@example.org', 'Clerk Two', 'LMS2', 'FeeClerk'],
    ['hes@example.org', 'HES Office', 'HES', 'AdminManager'],
    ['fh@example.org', 'Finance Head', 'ALL', 'FinanceHead'],
    ['owner@example.org', 'Owner', 'ALL', 'Owner'],
  ],
};
const J = (x) => JSON.parse(JSON.stringify(x));

module.exports = function run(t) {
  const fresh = () => {
    const h = boot(fixture);
    h.addConfig();
    ['LMS1', 'LMS2', 'HES'].forEach((c) => h.addBook(c, '2026-27'));
    h.setNow(new Date('2026-10-21T10:00:00Z')); // 15:30 IST 2026-10-21
    return h;
  };
  const give = (h, o, tok) => h.call('cash.handover', Object.assign({ id: 'h1', date: '2026-10-21', from_account: 'cash:LMS1', to_account: 'cash:HES', amount_paise: 20000, bucket: 'fee', note: 'Fee cash for HES' }, o), tok || 'c1-token');
  const accept = (h, id, tok) => h.call('cash.accept', { id: 'req-' + (id || 'h1'), handover: id || 'h1' }, tok || 'hes-token');
  const list = (h, tok) => J(h.call('cash.handovers', {}, tok).handovers);
  const rows = (h, c) => h.ctx.officeRows_(h.ctx.officeOpen_(c, '2026-27'), 'DayBook');
  const pick = (x) => [x.id, x.entry_date, x.direction, x.mode, x.bucket, x.category, x.amount_paise, x.account, x.charged_to, x.settles, x.payee, x.reverses];

  t.test('handover writes the OUT leg now and a pending record; the receiver sees it; retry writes nothing', () => {
    const h = fresh();
    const r = give(h);
    assert.equal(r.success, true); assert.equal(r.duplicate, false);
    assert.deepEqual(rows(h, 'LMS1').map(pick), [['h1-out', '2026-10-21', 'OUT', 'cash', 'fee', 'cash_transfer', 20000, 'cash:LMS1', 'LMS1', 'h1-in', 'cash:HES', '']]);
    assert.equal(rows(h, 'HES').length, 0);
    const want = [{ id: 'h1', state: 'pending', from_campus: 'LMS1', to_campus: 'HES', from_account: 'cash:LMS1', to_account: 'cash:HES', amount_paise: 20000, bucket: 'fee', date: '2026-10-21', note: 'Fee cash for HES', by: 'c1@example.org', by_name: 'Clerk One', dispute_note: '', receiver: true }];
    assert.deepEqual(list(h, 'hes-token'), want);
    assert.deepEqual(list(h, 'c1-token').map((x) => [x.id, x.receiver]), [['h1', false]]);
    assert.deepEqual(list(h, 'c2-token'), []);
    assert.equal(give(h).duplicate, true);
    assert.equal(rows(h, 'LMS1').length, 1);
  });

  t.test('accept writes the IN leg in the receiving book dated the acceptance day; idempotent', () => {
    const h = fresh();
    give(h);
    h.setNow(new Date('2026-10-22T05:00:00Z'));
    const r = accept(h);
    assert.equal(r.success, true); assert.equal(r.duplicate, false);
    assert.deepEqual(rows(h, 'HES').map(pick), [['h1-in', '2026-10-22', 'IN', 'cash', 'fee', 'cash_received', 20000, 'cash:HES', 'HES', 'h1-out', 'cash:LMS1', '']]);
    assert.equal(accept(h).duplicate, true);
    assert.equal(rows(h, 'HES').length, 1);
    assert.deepEqual(list(h, 'hes-token'), []); assert.deepEqual(list(h, 'c1-token'), []);
    const b = (c) => h.call('daybook.balances', { campus: c, date: '2026-10-22' }, 'owner-token').closing.cash.fee;
    assert.equal(b('LMS1'), -20000); assert.equal(b('HES'), 20000);
  });

  t.test('wrong campus or account refused', () => {
    const h = fresh();
    assert.equal(give(h, { from_account: 'cash:LMS2' }).error, 'FORBIDDEN_CAMPUS');
    assert.equal(give(h, { to_account: 'bank:HES' }).error, 'BAD_ACCOUNT');
    assert.equal(give(h, { to_account: 'cash:LMS1' }).code, 'SAME_CAMPUS');
    assert.equal(give(h, { bucket: 'x' }).error, 'BUCKET_REQUIRED');
    assert.equal(give(h, { amount_paise: 0 }).error, 'BAD_AMOUNT');
    assert.equal(rows(h, 'LMS1').length, 0);
    give(h);
    assert.equal(accept(h, 'h1', 'c2-token').error, 'FORBIDDEN_CAMPUS');
    assert.equal(accept(h, 'h1', 'c1-token').error, 'FORBIDDEN_CAMPUS', 'the sender cannot accept');
    assert.equal(accept(h, 'nope').error, 'NOT_FOUND');
    assert.equal(accept(h, 'h1', 'owner-token').success, true);
  });

  t.test('dispute needs a note, writes no leg, and stops acceptance', () => {
    const h = fresh();
    give(h);
    assert.equal(h.call('cash.dispute', { id: 'd1', handover: 'h1', note: ' ' }, 'hes-token').code, 'NOTE_REQUIRED');
    assert.equal(h.call('cash.dispute', { id: 'd1', handover: 'h1', note: 'Got 150 only' }, 'c1-token').error, 'FORBIDDEN_CAMPUS');
    assert.equal(h.call('cash.dispute', { id: 'd1', handover: 'h1', note: 'Got 150 only' }, 'hes-token').success, true);
    assert.equal(h.call('cash.dispute', { id: 'd1', handover: 'h1', note: 'Got 150 only' }, 'hes-token').duplicate, true);
    assert.equal(rows(h, 'HES').length, 0);
    assert.equal(accept(h).code, 'HANDOVER_NOT_PENDING');
    assert.deepEqual(list(h, 'c1-token').map((x) => [x.state, x.dispute_note]), [['disputed', 'Got 150 only']]);
  });

  t.test('the sender reversing the OUT leg closes the handover; an accepted handover is not reversed', () => {
    const h = fresh();
    give(h); give(h, { id: 'h2' });
    h.call('cash.dispute', { id: 'd1', handover: 'h1', note: 'Not received' }, 'hes-token');
    assert.equal(h.call('daybook.reverse', { id: 'rv1', campus: 'LMS1', reverses: 'h1-out' }, 'c1-token').success, true);
    assert.deepEqual(list(h, 'c1-token').map((x) => x.id), ['h2']);
    assert.equal(h.call('daybook.reverse', { id: 'rv2', campus: 'LMS1', reverses: 'h2-out' }, 'c1-token').success, true, 'a pending one too');
    assert.deepEqual(list(h, 'hes-token'), []);
    assert.equal(accept(h, 'h2').code, 'HANDOVER_NOT_PENDING');
    give(h, { id: 'h3' }); accept(h, 'h3');
    assert.equal(h.call('daybook.reverse', { id: 'rv3', campus: 'LMS1', reverses: 'h3-out' }, 'c1-token').code, 'HANDOVER_ACCEPTED');
    assert.equal(h.call('daybook.reverse', { id: 'rv4', campus: 'HES', reverses: 'h3-in' }, 'hes-token').code, 'HANDOVER_ACCEPTED');
  });

  t.test('day close: a pending handover never blocks closing; the IN leg lands on the acceptance day; a closed day takes no handover', () => {
    const h = fresh();
    give(h, { date: '2026-10-20' });
    assert.equal(h.call('day.close', { id: 'cl1', campus: 'LMS1', close_date: '2026-10-20' }, 'fh-token').success, true);
    assert.equal(give(h, { id: 'h2', date: '2026-10-20' }).code, 'DAY_CLOSED');
    h.setNow(new Date('2026-10-22T05:00:00Z'));
    assert.equal(h.call('day.close', { id: 'cl2', campus: 'HES', close_date: '2026-10-21' }, 'fh-token').success, true);
    assert.equal(accept(h).success, true);
    assert.deepEqual(rows(h, 'HES').map((x) => x.entry_date), ['2026-10-22']);
  });

  t.test('partial failures: accepted with no IN row is repaired; closed with no reversal row is repaired', () => {
    const h = fresh();
    give(h); give(h, { id: 'h2' });
    const ho = (id) => h.ctx.officeHandovers_()[id], as = (email) => ({ caller: { email } });
    h.ctx.officeHandoverEvent_(as('hes@example.org'), ho('h1'), 'accepted'); // crash after the event, before the IN leg
    assert.deepEqual(list(h, 'hes-token').map((x) => x.id), ['h2']);
    const r = accept(h);
    assert.equal(r.success, true); assert.equal(r.duplicate, true);
    assert.deepEqual(rows(h, 'HES').map((x) => x.id), ['h1-in']);
    assert.equal(accept(h).duplicate, true); assert.equal(rows(h, 'HES').length, 1);
    h.ctx.officeHandoverEvent_(as('c1@example.org'), ho('h2'), 'closed'); // crash after the closed event, before the reversal row
    assert.equal(h.call('daybook.reverse', { id: 'rv2', campus: 'LMS1', reverses: 'h2-out' }, 'c1-token').success, true);
    assert.deepEqual(rows(h, 'LMS1').filter((x) => x.reverses).map((x) => x.reverses), ['h2-out']);
    assert.equal(accept(h, 'h2').code, 'HANDOVER_NOT_PENDING');
  });

  t.test('rows outrank a lost state: an IN row blocks reversal; a reversed OUT blocks acceptance', () => {
    const h = fresh();
    give(h); give(h, { id: 'h2' });
    const legOnly = (c, row) => h.ctx.officeDaybookWrite_(h.ctx.officeOpen_(c, '2026-27'), { caller: { email: 'x' } }, row, 'test');
    legOnly('HES', { id: 'h1-in', campus: 'HES', entry_date: '2026-10-21', direction: 'IN', mode: 'cash', bucket: 'fee', category: 'cash_received', amount_paise: 20000, account: 'cash:HES', settles: 'h1-out' });
    assert.equal(h.call('daybook.reverse', { id: 'rv1', campus: 'LMS1', reverses: 'h1-out' }, 'c1-token').code, 'HANDOVER_ACCEPTED');
    legOnly('LMS1', { id: 'x2', campus: 'LMS1', entry_date: '2026-10-21', direction: 'IN', mode: 'cash', bucket: 'fee', category: 'cash_transfer', amount_paise: 20000, account: 'cash:LMS1', settles: 'h2-in', reverses: 'h2-out' });
    assert.equal(accept(h, 'h2').code, 'HANDOVER_NOT_PENDING');
    assert.equal(rows(h, 'HES').length, 1);
  });

  t.test('the sender never accepts or disputes their own handover', () => {
    const h = fresh();
    give(h, { from_account: 'cash:HES', to_account: 'cash:LMS1' }, 'owner-token');
    assert.equal(accept(h, 'h1', 'owner-token').code, 'HANDOVER_SELF');
    assert.equal(h.call('cash.dispute', { id: 'd', handover: 'h1', note: 'x' }, 'owner-token').code, 'HANDOVER_SELF');
    assert.deepEqual(list(h, 'owner-token').map((x) => x.receiver), [false]);
    assert.deepEqual(list(h, 'c1-token').map((x) => x.receiver), [true]);
    assert.equal(accept(h, 'h1', 'c1-token').success, true);
  });

  t.test('a retry of a saved handover after its day closed repairs the record only', () => {
    const h = fresh();
    give(h, { date: '2026-10-20' });
    h.ctx.officeRows_(h.ctx.officeConfigBook_(), 'Handovers'); // the record is lost:
    const sh = h.ctx.officeConfigBook_().getSheetByName('Handovers');
    sh.deleteRow(sh.getDataRange().getValues().findIndex((r) => r[0] === 'h1') + 1);
    assert.equal(h.call('day.close', { id: 'cl', campus: 'LMS1', close_date: '2026-10-20' }, 'fh-token').success, true);
    const r = give(h, { date: '2026-10-20' });
    assert.equal(r.success, true); assert.equal(r.duplicate, true);
    assert.deepEqual(list(h, 'hes-token').map((x) => x.id), ['h1']);
  });

  t.test('ledger.summary: both legs are movement; interSchool counts the handover once', () => {
    const h = fresh();
    give(h); accept(h);
    const s = h.call('ledger.summary', { campus: 'ALL', from: '2026-04-01', to: '2026-10-21' }, 'owner-token');
    assert.deepEqual(J(s.byChargedTo), {});
    assert.deepEqual(J(s.interSchool), [{ from: 'LMS1', to: 'HES', paise: 20000 }]);
  });
};
