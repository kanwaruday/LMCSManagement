// V2, 27 Nov: a school's Day Book takes its first entry only after its opening is set (the game writes it at Seal: opening.set).
'use strict';
const assert = require('assert');
const { boot } = require('./harness');

const fixture = {
  tokens: { 'clerk-token': 'clerk@example.org', 'fh-token': 'fh@example.org', 'owner-token': 'owner@example.org', 'hes-token': 'hes@example.org' },
  allowlist: [
    ['Email', 'Name', 'Campuses', 'Roles'],
    ['clerk@example.org', 'Clerk', 'LMS1', 'FeeClerk'],
    ['fh@example.org', 'Finance Head', 'ALL', 'FinanceHead'],
    ['owner@example.org', 'Owner', 'ALL', 'Owner'],
    ['hes@example.org', 'HES Office', 'HES', 'AdminManager'],
  ],
};

module.exports = function run(t) {
  const fresh = () => {
    const h = boot(fixture); h.addConfig(); h.addBook('LMS1', '2026-27', { opening: false });
    h.setNow(new Date('2026-10-21T10:00:00Z'));
    return h;
  };
  const fee = (id, o) => Object.assign({ id, campus: 'LMS1', entry_date: '2026-10-21', account: 'cash:LMS1', direction: 'IN', mode: 'cash', bucket: 'fee', category: 'fee_collection', amount_paise: 1000 }, o || {});
  const book = (h, tab) => h.ctx.officeRows_(h.ctx.officeOpen_('LMS1', '2026-27'), tab);

  t.test('seal gate: no opening -> the first entry is OPENING_NOT_SEALED (coded), nothing written; after opening.set it saves', () => {
    const h = fresh();
    const r = h.call('daybook.add', fee('s1'), 'clerk-token');
    assert.deepEqual([r.success, r.error, r.code], [false, 'OPENING_NOT_SEALED', 'OPENING_NOT_SEALED']);
    assert.equal(h.call('daybook.add', fee('s2', { account: 'bank:LMS1', mode: 'bank', bucket: '', category: 'fee_online' }), 'owner-token').error, 'OPENING_NOT_SEALED', 'bank and the Owner too');
    assert.equal(book(h, 'DayBook').length, 0);
    assert.equal(h.seal({ id: 'op', campus: 'LMS1', balances: [{ mode: 'cash', bucket: 'fee', amount_paise: 0 }] }, 'fh-token').success, true);
    assert.equal(h.call('daybook.add', fee('s1'), 'clerk-token').success, true, 'the same id, now saved');
    assert.equal(book(h, 'DayBook').length, 1);
  });

  t.test('seal gate: a bank or credit account opening alone does not count as the school opening', () => {
    const h = fresh();
    h.ctx.officeWriteRow_(h.ctx.officeOpen_('LMS1', '2026-27'), 'Opening', { id: 'ao', campus: 'LMS1', account: 'bank:LMS1', mode: 'bank', bucket: '', amount_paise: 500 });
    assert.equal(h.call('daybook.add', fee('s1'), 'clerk-token').error, 'OPENING_NOT_SEALED');
  });

  t.test('seal gate: a book from before the gate (entries or a closed day, no opening) keeps working: opening.set is locked for it', () => {
    const h = fresh();
    h.ctx.officeAppend_(h.ctx.officeOpen_('LMS1', '2026-27'), 'DayBook', { id: 'old', campus: 'LMS1', entry_date: '2026-10-20', direction: 'IN', mode: 'bank', account: 'bank:LMS1', category: 'fee_online', amount_paise: 100 }, { email: 'clerk@example.org' }, {});
    assert.equal(h.call('daybook.add', fee('s3'), 'clerk-token').success, true);
    assert.equal(h.seal({ id: 'op', campus: 'LMS1', balances: [{ mode: 'bank', amount_paise: 1 }] }, 'fh-token').error, 'OPENING_LOCKED');
  });

  t.test('seal gate: a retry of an entry already saved is still a duplicate (P9)', () => {
    const h = fresh();
    h.ctx.officeWriteRow_(h.ctx.officeOpen_('LMS1', '2026-27'), 'Opening', { id: 'op:0', campus: 'LMS1', mode: 'cash', bucket: 'fee', amount_paise: 0 });
    assert.equal(h.call('daybook.add', fee('s4'), 'clerk-token').success, true);
    const again = h.call('daybook.add', fee('s4'), 'clerk-token');
    assert.deepEqual([again.success, again.duplicate], [true, true]);
  });

  // G2 (27 Nov): deposits, handover legs and fund transfers write the Day Book without daybook.add: the gate is in officeDaybookWrite_
  const PDF = Buffer.from('%PDF-1.4 synthetic').toString('base64');
  t.test('seal gate: a deposit into an unsealed new book is OPENING_NOT_SEALED, and no Deposits row or leg is written', () => {
    const h = fresh();
    h.call('file.upload', { id: 'slip', campus: 'LMS1', category: 'deposit_proof', mime: 'application/pdf', base64: PDF, name: 's.pdf' }, 'clerk-token');
    const r = h.call('deposit.add', { id: 'd1', campus: 'LMS1', covers_date: '2026-10-21', amount_paise: 500, bank_ref: 'UTR1', file_id: 'slip' }, 'clerk-token');
    assert.equal(r.error, 'OPENING_NOT_SEALED');
    assert.equal(book(h, 'Deposits').length, 0); assert.equal(book(h, 'DayBook').length, 0);
  });

  t.test('seal gate: a handover into an unsealed receiving book: accept is OPENING_NOT_SEALED, no IN leg, the handover stays pending', () => {
    const h = boot(fixture); h.addConfig(); h.addBook('LMS1', '2026-27'); h.addBook('HES', '2026-27', { opening: false });
    h.setNow(new Date('2026-10-21T10:00:00Z'));
    ['petty', 'fee', 'other'].forEach((b) => h.ctx.officeWriteRow_(h.ctx.officeOpen_('LMS1', '2026-27'), 'Opening', { id: 'seed-' + b, campus: 'LMS1', mode: 'cash', bucket: b, amount_paise: 1000000 }));
    assert.equal(h.call('cash.handover', { id: 'h1', date: '2026-10-21', from_account: 'cash:LMS1', to_account: 'cash:HES', amount_paise: 20000, bucket: 'fee', note: 'x' }, 'clerk-token').success, true);
    const r = h.call('cash.accept', { id: 'req-h1', handover: 'h1' }, 'hes-token');
    assert.equal(r.error, 'OPENING_NOT_SEALED');
    assert.equal(h.ctx.officeRows_(h.ctx.officeOpen_('HES', '2026-27'), 'DayBook').length, 0);
    assert.equal(JSON.parse(JSON.stringify(h.call('cash.handovers', {}, 'hes-token').handovers))[0].state, 'pending');
    h.seal({ id: 'op', campus: 'HES', balances: [{ mode: 'cash', bucket: 'fee', amount_paise: 0 }] }, 'fh-token');
    assert.equal(h.call('cash.accept', { id: 'req-h1', handover: 'h1' }, 'hes-token').success, true, 'accepted once the opening is set');
  });

  t.test('seal gate: a reversal is never refused by the gate', () => {
    const h = fresh();
    assert.doesNotThrow(() => h.ctx.officeAssertOpening_(h.ctx.officeOpen_('LMS1', '2026-27'), { reverses: 'x' }));
    assert.throws(() => h.ctx.officeAssertOpening_(h.ctx.officeOpen_('LMS1', '2026-27'), {}), /OPENING_NOT_SEALED/);
  });

  // audit #7 (V2, 28 Nov): the opening is set only by the game's Seal
  t.test('seal only: opening.set from a portal page or without a seal id is SEAL_REQUIRED and writes nothing; the game path records the seal', () => {
    const h = fresh();
    const bal = [{ mode: 'cash', bucket: 'fee', amount_paise: 0 }];
    const portal = h.call('opening.set', { id: 'p1', campus: 'LMS1', balances: bal, seal: 'ob:00000000-0000-4000-8000-000000000001:2026-10-21T10:00:00Z' }, 'owner-token');
    assert.deepEqual([portal.success, portal.code], [false, 'SEAL_REQUIRED'], 'the portal Opening page, even with a seal-shaped id');
    assert.equal(h.seal({ id: 'p2', campus: 'LMS1', balances: bal, seal: '' }, 'fh-token').code, 'SEAL_REQUIRED', 'the game path with no seal');
    assert.equal(h.seal({ id: 'p3', campus: 'LMS1', balances: bal, seal: 'ob:not-a-uuid:x' }, 'fh-token').code, 'SEAL_REQUIRED', 'a malformed seal');
    assert.equal(book(h, 'Opening').length, 0);
    assert.equal(h.seal({ id: 'p4', campus: 'LMS1', balances: bal }, 'fh-token').success, true);
    assert.deepEqual(book(h, 'Opening').map((r) => r.seal), ['ob:00000000-0000-4000-8000-000000000001:2026-10-21T10:00:00Z']);
    assert.equal(h.call('daybook.add', fee('s9'), 'clerk-token').success, true, 'the book opens');
  });
};
