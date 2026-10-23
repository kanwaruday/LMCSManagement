// Run: TZ=Asia/Kolkata node tests/hiring/test-ui-helpers.js -- the hiring page's pure helpers (hiring/hiring-view.js):
// Today reads accepted appointments only; My actions lists everything waiting on the Principal; the clerk's buckets.
const assert = require('assert');
const V = require('../../hiring/hiring-view.js');

const NOW = new Date(2026, 9, 22, 12, 0).getTime(); // 22 Oct 2026, noon local
const at = (days, h) => new Date(2026, 9, 22 + days, h, 0).toISOString();
const appt = (kind, start, status, extra) => Object.assign({ id: 'appt-' + kind + start, kind, start, status, proposedBy: 'clerk@x', declineNote: '', calendarMode: 'own', reportFiled: false }, extra);
const p = (row, status, appointments, extra) => Object.assign({ row, name: 'P' + row, status, appointments: appointments || [], stageMarks: {}, reportPending: '', docsMissing: [] }, extra);

// ── todayItems_ ──
{
  const list = [
    p(1, 'Interview Scheduled', [appt('interview', at(0, 15), 'accepted')]),
    p(2, 'Shortlisted', [appt('interview', at(0, 11), 'proposed')]),               // proposed: never on Today
    p(3, 'Interview Scheduled', [], { interviewAt: at(0, 10) }),                       // column 13 set, no appointment
    p(4, 'Interview Done', [appt('demo', at(0, 9), 'accepted')]),
    p(5, 'Interview Scheduled', [appt('interview', at(2, 10), 'accepted')]),
    p(6, 'Interview Scheduled', [appt('interview', at(9, 10), 'accepted')]),          // beyond 7 days
    p(7, 'Salary Offer', [appt('md', at(0, 16), 'accepted')]),                        // md: not on Today
    p(8, 'Interview Scheduled', [appt('interview', at(-1, 10), 'accepted')]),         // yesterday
    p(9, 'Rejected', [appt('interview', at(0, 13), 'accepted')]),                     // rejected: history
  ];
  const t = V.todayItems_(list, NOW);
  assert.deepStrictEqual(t.today.map((x) => x.a.row), [4, 1], 'today: accepted interview/demo, time order');
  assert.deepStrictEqual(t.next.map((x) => x.a.row), [5], 'next 7 days');
  assert.strictEqual(t.today[0].appt.kind, 'demo');
  console.log('ok  - todayItems_: accepted interview/demo only; excludes proposed and a bare column-13 time');
}

// ── myActions_: one fixture per item ──
const kinds = (list) => V.myActions_(list, NOW).map((x) => x.row + ':' + x.kind);
{
  assert.deepStrictEqual(kinds([p(1, 'Interview Done', [], { reportPending: 'interview' })]).slice(0, 1), ['1:interview'], 'report pending (interview)');
  assert.deepStrictEqual(kinds([p(1, 'Demo Done', [], { reportPending: 'demo' })]).slice(0, 1), ['1:demo'], 'report pending (demo)');
  assert.deepStrictEqual(kinds([p(2, 'Interview Done', [appt('interview', at(-1, 10), 'accepted', { reportFiled: true })])]), ['2:bookdemo'], 'Interview Done, no demo proposed');
  assert.deepStrictEqual(kinds([p(2, 'Interview Done', [appt('demo', at(1, 10), 'proposed')])]), [], 'a demo is already proposed');
  assert.deepStrictEqual(kinds([p(3, 'Demo Done')]), ['3:salary'], 'Demo Done: make an offer');
  assert.deepStrictEqual(kinds([p(4, 'Salary Offer')]), ['4:md'], 'Salary Offer, no MD proposal');
  assert.deepStrictEqual(kinds([p(4, 'Salary Offer', [appt('md', at(2, 10), 'proposed')])]), [], 'MD already proposed');
  assert.deepStrictEqual(kinds([p(4, 'Salary Offer', [appt('md', at(2, 10), 'declined', { declineNote: 'busy' })])]), ['4:md'], 'a declined MD proposal: propose again');
  assert.deepStrictEqual(kinds([p(5, 'Hiring Approved')]), ['5:joining'], 'Hiring Approved: DOJ, documents, Hired');
  assert.deepStrictEqual(kinds([p(6, 'Shortlisted', [], { stageMarks: { rejectPending: { reason: 'Other', note: 'x' } } })]), ['6:confirmreject'], 'rejectPending');
  assert.deepStrictEqual(kinds([p(6, 'Interview Done', [], { stageMarks: { rejectPending: { reason: 'Other' } } })]), ['6:confirmreject'], 'a pending rejection is settled first: no Book demo beside it');
  assert.deepStrictEqual(kinds([p(7, 'Interview Scheduled', [appt('interview', at(-1, 10), 'accepted')])]), ['7:interview'], 'accepted interview in the past, no report');
  assert.deepStrictEqual(kinds([p(7, 'Interview Scheduled', [appt('interview', at(0, 15), 'accepted')])]), [], 'future interview: nothing yet');
  assert.deepStrictEqual(kinds([p(7, 'Interview Done', [appt('interview', at(-1, 10), 'accepted', { reportFiled: true }), appt('demo', at(-1, 15), 'accepted')])]), ['7:demo'], 'past demo, no report');
  assert.deepStrictEqual(kinds([p(8, 'Interview Done', [appt('interview', at(-1, 10), 'accepted')], { reportPending: 'interview' })]), ['8:interview', '8:bookdemo'], 'one report entry per kind (deduped)');
  assert.deepStrictEqual(kinds([p(9, 'Rejected', [appt('interview', at(-1, 10), 'accepted')], { stageMarks: { rejectPending: {} } }), p(10, 'Hired')]), [], 'Rejected/Hired: nothing');
  assert.deepStrictEqual(kinds([p(11, 'Interview Done', [appt('demo', at(-2, 10), 'accepted', { reportFiled: true })])]), ['11:bookdemo'], 'a past accepted demo is history, not open: book the second demo');
  assert.ok(V.myActions_([p(3, 'Demo Done')], NOW)[0].label, 'every item has a label');
  console.log('ok  - myActions_: one fixture per item');
}

// ── clerkBuckets_: the Fee Clerk's lists, same rules as the server's legwork ──
{
  const list = [
    p(1, 'Shortlisted'),
    p(2, 'Shortlisted', [appt('interview', at(1, 10), 'proposed')]),
    p(3, 'Shortlisted', [appt('interview', at(1, 10), 'declined', { declineNote: 'Not that day' })]),
    p(4, 'Interview Scheduled', [appt('interview', at(2, 10), 'accepted', { proposedBy: 'p@x' })]),
    p(5, 'Interview Scheduled', [appt('interview', at(-1, 10), 'accepted')]),
    p(6, 'Interview Done', [appt('interview', at(-2, 10), 'accepted', { reportFiled: true })]),
    p(7, 'Hiring Approved', [], { docsMissing: ['PAN'] }),
    p(8, ''),
    p(9, 'Salary Offer', [appt('md', at(3, 10), 'accepted')]),
  ];
  const b = V.clerkBuckets_(list, NOW);
  const rows = (xs) => xs.map((x) => (x.a || x).row);
  assert.deepStrictEqual(rows(b.toSchedule), [1, 3], 'shortlisted with no open interview; a declined proposal counts');
  assert.deepStrictEqual(rows(b.waiting), [2]);
  assert.deepStrictEqual(rows(b.booked), [4, 9], 'accepted, next 7 days, any kind');
  assert.deepStrictEqual(rows(b.reportsToUpload), [5]);
  assert.deepStrictEqual(rows(b.demosToBook), [6]);
  assert.deepStrictEqual(rows(b.documents), [7]);
  assert.deepStrictEqual(rows(V.clerkBuckets_([p(10, 'Interview Done', [appt('demo', at(-2, 10), 'accepted', { reportFiled: true })])], NOW).demosToBook), [10], 'a past accepted demo is not open');
  assert.strictEqual(V.openAppt_(p(10, 'Interview Done', [appt('demo', at(-2, 10), 'accepted', { reportFiled: true })]), 'demo', NOW), null, 'openAppt_: past reported accepted is not open');
  assert.ok(V.openAppt_(p(10, 'Interview Done', [appt('demo', at(-2, 10), 'accepted')]), 'demo', NOW), 'openAppt_: past accepted awaiting its report is still open');
  assert.ok(V.openAppt_(p(10, 'Interview Done', [appt('demo', at(2, 10), 'accepted')]), 'demo', NOW), 'openAppt_: future accepted is open');
  console.log('ok  - clerkBuckets_: to schedule, waiting, booked, reports, demos, documents');
}

// ── canOverride_: the Owner's Accept / Decline on a proposed interview or demo (vacant post, Principal on leave) ──
{
  const prop = (kind, status) => appt(kind, at(1, 10), status || 'proposed');
  assert.strictEqual(V.canOverride_('Owner', prop('interview')), true, 'Owner, proposed interview');
  assert.strictEqual(V.canOverride_('Principal, Owner', prop('demo')), true, 'multi-role Owner, proposed demo');
  assert.strictEqual(V.canOverride_('Owner', prop('md')), false, 'md: MD acceptor only, from the Appointments view');
  assert.strictEqual(V.canOverride_('Owner', prop('interview', 'accepted')), false, 'already decided');
  ['Principal', 'Coordinator', 'FeeClerk', '', undefined].forEach((r) => assert.strictEqual(V.canOverride_(r, prop('interview')), false, 'not Owner: ' + r));
  console.log('ok  - canOverride_: Owner only, proposed interview/demo only');
}

// waitingOnOthers_: MD-stage candidates stay visible while the Owner has the ball.
{
  const HVm = (typeof HV !== 'undefined' ? HV : require('../../hiring/hiring-view.js'));
  const t = Date.parse('2026-10-23T09:00:00Z');
  const w = HVm.waitingOnOthers_([
    { row: 2, status: 'MD Academics Interview Scheduled', appointments: [{ kind: 'md', status: 'accepted', start: '2026-10-23T08:30:00Z' }] },
    { row: 3, status: 'Salary Offer', appointments: [{ kind: 'md', status: 'proposed', start: '2026-10-25T08:30:00Z' }] },
    { row: 4, status: 'Salary Offer', appointments: [] },
    { row: 5, status: 'Hired', appointments: [] },
  ], t);
  require('assert').deepStrictEqual(w.map((x) => x.row), [2, 3]);
  console.log('ok  - waitingOnOthers_');
}

// furthest_: top n by stage from My actions + waiting-on-Owner.
{
  const HVm = (typeof HV !== 'undefined' ? HV : require('../../hiring/hiring-view.js'));
  const t = Date.parse('2026-10-23T09:00:00Z');
  const f = HVm.furthest_([
    { row: 2, status: 'Demo Done', appointments: [] },                                   // action: salary offer
    { row: 3, status: 'Hiring Approved', appointments: [] },                             // action: joining
    { row: 4, status: 'MD Academics Interview Scheduled', appointments: [] },            // waiting on Owner
    { row: 5, status: 'Interview Scheduled', appointments: [] },                         // nothing to do -> not listed
    { row: 6, status: 'Hired', appointments: [] },
  ], t, 2);
  require('assert').deepStrictEqual(f.map((a) => a.row), [3, 4]);
  console.log('ok  - furthest_');
}
