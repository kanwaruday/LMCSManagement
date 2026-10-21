// Auth, role and campus enforcement for the Office backend (apps-script/office.gs).
'use strict';
const assert = require('assert');
const { boot } = require('./harness');

// Test-only actions, supplied by redefining a (not yet written) module function in the harness context;
// officeAllActions_() picks it up like a real module.
const TEST_MODULE = `
function officeConfigActions_() {
  return {
    'test.clerk': { roles: ['FeeClerk'], write: false, run: function (ctx, data) { return { who: ctx.caller.email, campus: data.campus || null }; } },
    'test.write': { roles: ['FeeClerk', 'Owner'], write: true, run: function () { return { locked: true }; } },
  };
}`;

module.exports = function run(t) {
  const h = boot(null, { extraSource: TEST_MODULE });
  const call = h.call;

  t.test('unknown action returns success:false', () => {
    const r = call('nope', {}, 'clerk1-token');
    assert.equal(r.success, false);
    assert.match(r.error, /Unknown action/);
  });

  t.test('no token returns Not authorized', () => {
    const r = call('test.clerk', {}, '');
    assert.equal(r.success, false);
    assert.match(r.error, /Not authorized/);
    assert.match(call('test.clerk', {}, 'bad-token').error, /Not authorized/);
  });

  t.test('FeeClerk of LMS1 can call a FeeClerk action for LMS1', () => {
    const r = call('test.clerk', { campus: 'LMS1' }, 'clerk1-token');
    assert.equal(r.success, true);
    assert.equal(r.who, 'clerk1@example.org');
    assert.equal(r.campus, 'LMS1');
  });

  t.test('FeeClerk of LMS1 requesting LMS2 gets FORBIDDEN_CAMPUS', () => {
    const r = call('test.clerk', { campus: 'LMS2' }, 'clerk1-token');
    assert.equal(r.success, false);
    assert.equal(r.error, 'FORBIDDEN_CAMPUS');
    assert.throws(() => h.ctx.officeAssertCampus_({ campuses: ['LMS1'] }, 'LMS2'), /FORBIDDEN_CAMPUS/);
  });

  t.test('Owner with campus ALL may use any campus', () => {
    const r = call('test.write', { campus: 'LMS6' }, 'owner-token');
    assert.equal(r.success, true);
  });

  t.test('role not in the action\'s roles is refused', () => {
    const r = call('test.clerk', { campus: 'LMS1' }, 'owner-token');
    assert.equal(r.success, false);
    assert.match(r.error, /FORBIDDEN_ROLE/);
  });

  t.test('write actions run under the script lock', () => {
    const before = h.locks.acquired;
    call('test.clerk', {}, 'clerk1-token');
    assert.equal(h.locks.acquired, before, 'reads take no lock');
    call('test.write', {}, 'owner-token');
    assert.equal(h.locks.acquired, before + 1);
    assert.equal(h.locks.released, h.locks.acquired);
  });

  t.test('verified caller is cached for 5 minutes', () => {
    const n = h.counter.fetch;
    call('test.clerk', {}, 'clerk1-token');
    call('test.clerk', {}, 'clerk1-token');
    assert.equal(h.counter.fetch, n, 'no further tokeninfo calls');
  });

  t.test('clock helpers: Asia/Kolkata date and Apr-Mar financial year', () => {
    h.setNow(new Date('2026-10-21T20:00:00Z')); // 01:30 on 22 Oct in India
    assert.equal(h.ctx.officeToday_(), '2026-10-22');
    assert.equal(h.ctx.officeFy_('2026-04-01'), '2026-27');
    assert.equal(h.ctx.officeFy_('2027-03-31'), '2026-27');
    assert.equal(h.ctx.officeFy_('2026-03-31'), '2025-26');
  });
};
