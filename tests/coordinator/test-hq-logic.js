// node tests/coordinator/test-hq-logic.js -- coordinator/hq-logic.js: the HQ's ranking, flags, campus heat, day-book spend and outcome lines
const assert = require('assert');
const H = require('../../coordinator/hq-logic.js');

const ME = 'c@lms.test', TODAY = '2026-10-26';
const task = (id, extra) => Object.assign({ taskId: id, domain: id.split('|')[0], campus: 'LMS4', title: 'T ' + id, detail: '', severity: 'low', assignee: '', due: '', createdAt: '2026-10-01T05:00:00.000Z', recommendation: null }, extra);
const ids = (list) => list.map((t) => t.taskId);
const rank = (list) => ids(H.rankContracts(list, ME, TODAY));
const REC = { by: ME, byName: 'C', recommendation: 'Approve', reason: 'ok' };

// ── districtOf is gone: the shared campus picker replaced the district tabs ──
assert.strictEqual(H.districtOf, undefined);

// ── flagOf ──
assert.strictEqual(H.flagOf(task('approval|A1|Pending')), 'stuck');
assert.strictEqual(H.flagOf(task('approval|A2|Info Requested')), 'waiting');
assert.strictEqual(H.flagOf(task('hiring_stall|T-0001')), 'stuck');
assert.strictEqual(H.flagOf(task('complete_hire|T-0002')), 'missing');
assert.strictEqual(H.flagOf(task('doc_missing|E1')), null);
assert.strictEqual(H.flagOf(task('pdr_issue|x')), null);

// ── rankContracts: one fixture per rule ──
// 1. assigned to me beats everything below it
assert.deepStrictEqual(rank([task('doc_missing|a', { severity: 'high', due: '2026-10-01' }), task('doc_missing|mine', { assignee: ME })]), ['doc_missing|mine', 'doc_missing|a']);
// 2. past due (due < today) beats not past due; due today is not past
assert.deepStrictEqual(rank([task('doc_missing|today', { due: TODAY, severity: 'high' }), task('doc_missing|late', { due: '2026-10-25' })]), ['doc_missing|late', 'doc_missing|today']);
// 3. core (a Pending approval with no recommendation, or a hiring stall) beats other kinds; a recommended or Info Requested approval is not core
assert.deepStrictEqual(rank([
  task('doc_missing|d', { severity: 'high', createdAt: '2026-10-02T00:00:00.000Z' }),
  task('approval|R|Pending', { severity: 'high', createdAt: '2026-10-03T00:00:00.000Z', recommendation: REC }),
  task('approval|I|Info Requested', { severity: 'high', createdAt: '2026-10-04T00:00:00.000Z' }),
  task('hiring_stall|h', { createdAt: '2026-10-05T00:00:00.000Z' }),
  task('approval|P|Pending', { createdAt: '2026-10-06T00:00:00.000Z' }),
]), ['hiring_stall|h', 'approval|P|Pending', 'doc_missing|d', 'approval|R|Pending', 'approval|I|Info Requested']);
// 4. severity high > medium > low
assert.deepStrictEqual(rank([task('doc_missing|l'), task('doc_missing|h', { severity: 'high' }), task('doc_missing|m', { severity: 'medium' })]), ['doc_missing|h', 'doc_missing|m', 'doc_missing|l']);
// 5. createdAt, oldest first
assert.deepStrictEqual(rank([task('doc_missing|new', { createdAt: '2026-10-20T00:00:00.000Z' }), task('doc_missing|old', { createdAt: '2026-09-20T00:00:00.000Z' })]), ['doc_missing|old', 'doc_missing|new']);
// the input is not reordered in place
const input = [task('doc_missing|l'), task('doc_missing|h', { severity: 'high' })];
H.rankContracts(input, ME, TODAY);
assert.deepStrictEqual(ids(input), ['doc_missing|l', 'doc_missing|h']);

// ── campusHeat ──
const heat = H.campusHeat([task('doc_missing|1', { severity: 'high' }), task('doc_missing|2', { severity: 'high' }), task('doc_missing|3')], TODAY);
assert.deepStrictEqual(Object.keys(heat), ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6']);
assert.deepStrictEqual(heat.LMS4, { score: 7, level: 'warm' });
assert.deepStrictEqual(heat.LMS6, { score: 0, level: 'cool' });
// past due counts as 3 whatever the severity; medium is 2; 10 or more is hot; a task with no campus is ignored
const hot = H.campusHeat([task('doc_missing|a', { campus: 'LMS2', due: '2026-10-20' }), task('doc_missing|b', { campus: 'LMS2', severity: 'medium' }),
  task('doc_missing|c', { campus: 'LMS2', severity: 'high' }), task('doc_missing|d', { campus: 'LMS2', severity: 'medium' }), task('doc_missing|e', { campus: '' })], TODAY);
assert.deepStrictEqual(hot.LMS2, { score: 10, level: 'hot' });
assert.deepStrictEqual(H.campusHeat([task('doc_missing|a', { severity: 'medium' }), task('doc_missing|b', { severity: 'medium' })], TODAY).LMS4, { score: 4, level: 'warm' });
assert.deepStrictEqual(H.campusHeat([task('doc_missing|a'), task('doc_missing|b'), task('doc_missing|c')], TODAY).LMS4, { score: 3, level: 'cool' });

// ── spendSummary: amount in rupees, day-book amounts in paise, Indian grouping ──
const entries = [
  { entry_date: '2026-10-22', direction: 'OUT', amount_paise: 4000000, id: 'e1' },
  { entry_date: '2026-10-23', direction: 'OUT', amount_paise: 820000, id: 'e2' },
  { entry_date: '2026-10-23', direction: 'IN', amount_paise: 99900000, id: 'e3' },
  // a reversed payment and its reversal cancel out
  { entry_date: '2026-10-24', direction: 'OUT', amount_paise: 500000, id: 'e4' },
  { entry_date: '2026-10-24', direction: 'IN', amount_paise: 500000, id: 'e5', reverses: 'e4' },
];
assert.strictEqual(H.spendSummary(entries, null, 12500, { campus: 'LMS4', from: '2026-10-22' }), 'This request: ₹12,500. LMS 4 spent ₹48,200 from the day book since 22 Oct.');
assert.strictEqual(H.spendSummary(null, 'NO_BOOK', 12500, { campus: 'LMS4', from: '2026-10-22' }), 'This request: ₹12,500. Day-book spend: not known (no day book for this campus yet)');
assert.strictEqual(H.spendSummary(null, null, 12500, { campus: 'LMS4', from: '2026-10-22' }), 'This request: ₹12,500. Day-book spend: not known (no day book for this campus yet)');
assert.strictEqual(H.spendSummary(null, 'timeout', '', { campus: 'LMS4', from: '2026-10-22' }), 'Day-book spend: not known (no day book for this campus yet)');
assert.strictEqual(H.spendSummary([], null, 1234567, { campus: 'LMS1', from: '2026-10-22' }), 'This request: ₹12,34,567. LMS 1 spent ₹0 from the day book since 22 Oct.');
assert.strictEqual(H.inr(1234567.4), '12,34,567');

// ── daybookRange: from the later of 1 April (this financial year) and 22 Oct 2026, to today ──
assert.deepStrictEqual(H.daybookRange('2026-10-26'), { from: '2026-10-22', to: '2026-10-26' });
assert.deepStrictEqual(H.daybookRange('2027-02-10'), { from: '2026-10-22', to: '2027-02-10' });
assert.deepStrictEqual(H.daybookRange('2027-04-03'), { from: '2027-04-01', to: '2027-04-03' });

// ── outcomeLine: "the Owner", never a name ──
assert.strictEqual(H.outcomeLine('Approve', { decision: 'Approved', decisionNote: '' }), 'The Owner approved, as you recommended.');
assert.strictEqual(H.outcomeLine('Approve', { decision: 'Rejected', decisionNote: 'the trip clashes with Term I' }), 'The Owner rejected: the trip clashes with Term I');
assert.strictEqual(H.outcomeLine('Approve', { decision: '', decisionNote: '' }), '');
assert.strictEqual(H.outcomeLine('Approve', null), '');
assert.strictEqual(H.outcomeLine({ recommendation: 'Info' }, { decision: 'Info Requested', decisionNote: '' }), 'The Owner asked for more information, as you recommended.');
assert.strictEqual(H.outcomeLine('Reject', { decision: 'Revoked', decisionNote: 'Budget moved' }), 'The Owner revoked it, as you recommended. Note: Budget moved');
assert.strictEqual(H.outcomeLine('Reject', { decision: 'Approved', decisionNote: '' }), 'The Owner approved.');

// ── small helpers the page leans on ──
assert.strictEqual(H.recReady('Approve', '  quotation checked '), true);
assert.strictEqual(H.recReady('Approve', '   '), false);
assert.strictEqual(H.recReady('', 'reason'), false);
assert.strictEqual(H.dayLabel('2026-10-21T05:00:00.000Z'), '21 Oct');
assert.strictEqual(H.dayLabel('2026-10-03'), '3 Oct');
assert.strictEqual(H.goHref({ hiring_stall: '../../hiring/index.html', pdr_issue: '../systems/index.html' }, 'hiring_stall'), '../hiring/index.html', 'WORK_LINKS are written for coordinator/<page>/; the HQ sits one level up');
assert.strictEqual(H.goHref({ pdr_issue: '../systems/index.html' }, 'pdr_issue'), 'systems/index.html');
assert.strictEqual(H.goHref({}, 'nothing'), null);
assert.strictEqual(H.approvalId(task('approval|APR-7|Pending')), 'APR-7');
assert.strictEqual(H.approvalId(task('doc_missing|E1')), null);

// ── rankFresh: new requests (no follow-up card yet) rank among themselves: a Pending one with no recommendation first, then oldest first ──
const fr = (id, extra) => Object.assign({ approvalId: id, campus: 'LMS4', title: 'T ' + id, category: 'Other', status: 'Pending', requestedAt: '2026-10-25T05:00:00.000Z', recommendation: null }, extra);
const freshIn = [fr('rec', { requestedAt: '2026-10-20T05:00:00.000Z', recommendation: REC }), fr('info', { status: 'Info Requested', requestedAt: '2026-10-19T05:00:00.000Z' }),
  fr('new'), fr('old', { requestedAt: '2026-10-24T05:00:00.000Z' })];
assert.deepStrictEqual(H.rankFresh(freshIn).map((f) => f.approvalId), ['old', 'new', 'info', 'rec']);
assert.deepStrictEqual(freshIn.map((f) => f.approvalId), ['rec', 'info', 'new', 'old'], 'the input is not reordered in place');
assert.deepStrictEqual(H.rankFresh(undefined), []);

// ── report issues: open or reopened or raised again, and nobody holds them; oldest last mention first ──
const is = (id, extra) => Object.assign({ id, subject: 'S ' + id, campus: 'LMS4', first: '2026-10-01', last: '2026-10-10', status: 'open', assignee: '', raisedAgain: false, resolvedAt: '' }, extra);
const isIn = [is('a', { last: '2026-10-12' }), is('b', { status: 'reopened', last: '2026-10-05' }), is('c', { assignee: 'x@lms.test', status: 'assigned' }), is('d', { status: 'resolved', resolvedAt: '2026-10-20' }),
  is('e', { status: 'acknowledged' }), is('f', { raisedAgain: true, last: '2026-10-08' }), is('g', { status: 'open', assignee: 'x@lms.test' })];
assert.deepStrictEqual(H.reportIssues(isIn).map((i) => i.id), ['b', 'f', 'a'], 'open/reopened/raised again, no assignee, oldest last first');
assert.deepStrictEqual(H.reportIssues(undefined), []);

// ── closedCount: resolved in the last 7 days (today included) ──
const cl = [is('1', { status: 'resolved', resolvedAt: '2026-10-19' }), is('2', { status: 'resolved', resolvedAt: '2026-10-18' }), is('3', { status: 'resolved', resolvedAt: '2026-10-26' }), is('4', { status: 'open' })];
assert.strictEqual(H.closedCount(cl, TODAY), 2, '19 Oct is 7 days back (in), 18 Oct is out');
assert.strictEqual(H.closedCount([], TODAY), 0);

// ── syncLine: fresh, stale (over 24 hours), missing ──
const NOW = new Date('2026-10-26T04:00:00.000Z'); // what coordPdrPush_ writes: new Date().toISOString(), shown in IST
assert.strictEqual(H.syncLine('2026-10-25T04:00:00.000Z', new Date('2026-10-26T03:59:00.000Z')), 'Daily-report issues last synced 25 Oct, 09:30', 'IST: 04:00Z is 09:30');
assert.strictEqual(H.syncLine('2026-10-25T05:00:00.000Z', NOW), 'Daily-report issues last synced 25 Oct, 10:30');
assert.strictEqual(H.syncLine('2026-10-25T04:00:00.000Z', NOW), 'Daily-report issues last synced 25 Oct, 09:30', 'exactly 24 hours is not stale yet');
assert.strictEqual(H.syncLine('2026-10-25T03:00:00.000Z', NOW), "Daily-report issues last synced 25 Oct, 08:30 (the Mac hasn't pushed since then)");
assert.strictEqual(H.syncLine('2026-10-25T20:00:00.000Z', NOW), 'Daily-report issues last synced 26 Oct, 01:30', 'IST date rolls over');
assert.strictEqual(H.syncLine('', NOW), '');
assert.strictEqual(H.syncLine(undefined, NOW), '');
assert.strictEqual(H.syncLine('not a date', NOW), '');

console.log('hq logic: ok');
