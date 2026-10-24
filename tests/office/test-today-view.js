// Pure helpers of the Today screen. Standalone: node tests/office/test-today-view.js (no-op under run.js).
'use strict';
const assert = require('assert');
if (require.main !== module) { module.exports = () => {}; return; }
(async () => {
  const T = await import('../../office/js/today.js');
  const ok = (n) => console.log('  ok  - ' + n);
  const list = [
    { status: '', interviewAt: '' }, { status: '', interviewAt: '2026-10-24 10:00' }, { status: '' },
    { status: 'Hiring Approved', docsMissing: ['PAN'] }, { status: 'Hiring Approved', docsMissing: [] }, { status: 'Rejected' },
  ];
  assert.deepStrictEqual(T.hiringCounts(list), { needSlot: 2, docs: 1 }); ok('hiringCounts');
  assert.deepStrictEqual(T.hiringCounts(undefined), { needSlot: 0, docs: 0 }); ok('hiringCounts empty');
  assert.strictEqual(T.hiringLabel({ needSlot: 2, docs: 1 }), 'Hiring · 2 to schedule · 1 documents to chase');
  assert.strictEqual(T.hiringLabel({ needSlot: 0, docs: 0 }), 'Hiring'); ok('hiringLabel');
  const lw = { toSchedule: 3, waiting: 1, booked: 4, reportsToUpload: 2, demosToBook: 1, documents: 0 };
  assert.deepStrictEqual(T.hiringCounts(list, lw), { needSlot: 3, waiting: 1, reports: 2, demos: 1, docs: 0 }); ok('hiringCounts prefers legwork');
  assert.strictEqual(T.hiringLabel(T.hiringCounts(list, lw)), 'Hiring · 3 to schedule · 1 awaiting a Principal · 2 reports to upload · 1 demos to book'); ok('hiringLabel shows legwork');
  const link = { textContent: 'Hiring' };
  await T.showHiringCounts(link, async () => ({ json: async () => ({ success: true, applicants: list }) }), 'u', 't');
  assert.strictEqual(link.textContent, 'Hiring · 2 to schedule · 1 documents to chase'); ok('showHiringCounts sets the link');
  const l3 = { textContent: 'Hiring' };
  await T.showHiringCounts(l3, async () => ({ json: async () => ({ success: true, applicants: list, legwork: lw }) }), 'u', 't');
  assert.ok(l3.textContent.startsWith('Hiring · 3 to schedule')); ok('showHiringCounts uses legwork');
  const l2 = { textContent: 'Hiring' };
  await T.showHiringCounts(l2, async () => { throw new Error('offline'); }, 'u', 't');
  await T.showHiringCounts(l2, async () => ({ json: async () => ({ success: false, error: 'Not authorized' }) }), 'u', 't');
  assert.strictEqual(l2.textContent, 'Hiring'); ok('offline or refused leaves the plain link');
  assert.strictEqual(T.busLabel(0), 'Live Buses'); assert.strictEqual(T.busLabel(1), 'Live Buses · 1 fuel bill to check'); assert.strictEqual(T.busLabel(3), 'Live Buses · 3 fuel bills to check'); ok('busLabel');
  const bl = { textContent: 'Live Buses' }, bb = { hidden: true, innerHTML: '' };
  await T.showBusChecks(bl, bb, async () => ({ json: async () => ({ success: true, checks: [{}, {}] }) }), 'u', 't');
  assert.strictEqual(bl.textContent, 'Live Buses · 2 fuel bills to check'); assert.strictEqual(bb.hidden, false); assert.ok(/under your name/.test(bb.innerHTML)); ok('showBusChecks: link and banner');
  const bl2 = { textContent: 'Live Buses' }, bb2 = { hidden: true };
  await T.showBusChecks(bl2, bb2, async () => ({ json: async () => ({ success: true, checks: [] }) }), 'u', 't');
  await T.showBusChecks(bl2, bb2, async () => { throw new Error('offline'); }, 'u', 't');
  assert.strictEqual(bl2.textContent, 'Live Buses'); assert.strictEqual(bb2.hidden, true); ok('showBusChecks: nothing to check or offline leaves the plain link');
})().catch((e) => { console.error(e); process.exit(1); });
