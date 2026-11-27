// V2, 27 Nov: a school's Day Book takes its first entry only after its opening is set (the game writes it at Seal: opening.set).
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
    assert.equal(h.call('opening.set', { id: 'op', campus: 'LMS1', balances: [{ mode: 'cash', bucket: 'fee', amount_paise: 0 }] }, 'fh-token').success, true);
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
    assert.equal(h.call('opening.set', { id: 'op', campus: 'LMS1', balances: [{ mode: 'bank', amount_paise: 1 }] }, 'fh-token').error, 'OPENING_LOCKED');
  });

  t.test('seal gate: a retry of an entry already saved is still a duplicate (P9)', () => {
    const h = fresh();
    h.ctx.officeWriteRow_(h.ctx.officeOpen_('LMS1', '2026-27'), 'Opening', { id: 'op:0', campus: 'LMS1', mode: 'cash', bucket: 'fee', amount_paise: 0 });
    assert.equal(h.call('daybook.add', fee('s4'), 'clerk-token').success, true);
    const again = h.call('daybook.add', fee('s4'), 'clerk-token');
    assert.deepEqual([again.success, again.duplicate], [true, true]);
  });
};
