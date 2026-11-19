// lane-d (Uday, 19 Nov: "yes" to the 13 heads from the day-book gap check): offered at every school, hidden per school by the Owner,
// and generator diesel needs no vehicle (apps-script/office-config.gs OFFICE_CATEGORIES). Synthetic data only.
'use strict';
const assert = require('assert');
const { boot } = require('./harness');

const fixture = {
  tokens: { 'c1-token': 'c1@example.org', 'c2-token': 'c2@example.org', 'owner-token': 'owner@example.org' },
  allowlist: [['Email', 'Name', 'Campuses', 'Roles'], ['c1@example.org', 'Clerk One', 'LMS1', 'FeeClerk'], ['c2@example.org', 'Clerk Two', 'LMS2', 'FeeClerk'], ['owner@example.org', 'Owner', 'ALL', 'Owner']],
};
const NEW = ['bank_charges', 'statutory_dues', 'rent', 'insurance', 'security_guards', 'professional_fees', 'generator_diesel', 'fee_refund',
  'library_books', 'lab_consumables', 'furniture', 'advertising', 'staff_welfare'];

module.exports = function run(t) {
  const fresh = () => {
    const h = boot(fixture);
    h.addConfig(); h.addBook('LMS1', '2026-27'); h.addBook('LMS2', '2026-27');
    h.setNow(new Date('2026-10-21T10:00:00Z'));
    h.ctx.officeWriteRow_(h.ctx.officeOpen_('LMS1', '2026-27'), 'Files', { id: 'slip', campus: 'LMS1', drive_id: 'D1', name: 's.jpg' });
    h.ctx.officeWriteRow_(h.ctx.officeOpen_('LMS1', '2026-27'), 'Opening', { id: 'seed', campus: 'LMS1', mode: 'cash', bucket: 'petty', amount_paise: 1000000 });
    return h;
  };

  t.test('new heads: all 13 are offered as money-out heads at every school, none needs a vehicle', () => {
    const h = fresh();
    ['c1-token', 'c2-token'].forEach((tok) => {
      const cats = h.call('config.get', {}, tok).categories;
      NEW.forEach((id) => {
        const c = cats.find((x) => x.id === id);
        assert.ok(c, id + ' offered'); assert.equal(c.direction, 'OUT', id); assert.equal(c.active, true, id); assert.equal(c.needs_vehicle, false, id);
      });
    });
  });

  t.test('new heads: the Owner hides one at one school only; the other school still has it', () => {
    const h = fresh();
    assert.equal(h.call('heads.hide', { campus: 'LMS1', category: 'rent', hidden: true }, 'owner-token').success, true);
    const hidden = h.call('config.get', {}, 'owner-token').hidden_heads;
    assert.deepEqual(hidden.LMS1, ['rent']); assert.equal((hidden.LMS2 || []).includes('rent'), false);
  });

  t.test('new heads: generator diesel saves with no vehicle (the vehicle fuel head still needs one)', () => {
    const h = fresh();
    const e = (o) => Object.assign({ id: 'g' + Math.random(), campus: 'LMS1', entry_date: '2026-10-21', account: 'cash:LMS1', direction: 'OUT', mode: 'cash', bucket: 'petty',
      amount_paise: 150000, payee: 'Pump', narration: 'DG set', file_id: 'slip' }, o);
    assert.equal(h.call('daybook.add', e({ category: 'generator_diesel' }), 'c1-token').success, true);
    assert.notEqual(h.call('daybook.add', e({ category: 'fuel' }), 'c1-token').success, true);
    assert.equal(h.call('daybook.add', e({ category: 'fee_refund', bucket: 'petty', amount_paise: 50000 }), 'c1-token').success, true);
  });
};
