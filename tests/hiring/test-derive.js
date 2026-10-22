// Run: node tests/hiring/test-derive.js -- hiring.gs's candidate list: ladder from evidence, revival
// cutoff, phone de-dupe and who is visible. Pure function, plain arrays in, applicants out.
const vm = require('vm'), fs = require('fs'), assert = require('assert'), path = require('path');
const ctx = vm.createContext({
  console, Logger: { log() {} }, Session: { getScriptTimeZone: () => 'Asia/Kolkata' },
  Utilities: { formatDate: () => '26/10' }, APR_STATUS: { APPROVED: 'Approved', REJECTED: 'Rejected' },
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../apps-script/hiring.gs'), 'utf8'), ctx);
const C = vm.runInContext('HIR_COL', ctx); // top-level const: not a context property
const T = (name, fn) => { fn(); console.log('ok  -', name); };

const day = (n) => new Date(Date.UTC(2026, 9, 22 + n, 5, 0));        // 22 Oct 2026 10:30 IST + n days
// One applicants-sheet row; o keys are HIR_COL names in lower camel (interviewAt, revivedAt...).
function row(o) {
  const r = new Array(25).fill('');
  const set = (col, v) => { if (v !== undefined) r[col - 1] = v; };
  set(C.TIMESTAMP, o.ts || day(-30)); set(C.NAME, o.name || 'Asha'); set(C.PHONE, o.phone || '9876543210');
  set(C.SUBJECTS, o.subjects || 'English'); set(C.BRANCHES, o.branches || 'LMS-4'); set(C.STATUS, o.status);
  set(C.INTERVIEW_AT, o.interviewAt); set(C.MD_INTERVIEW_AT, o.md); set(C.SALARY_OFFER_AT, o.offerAt);
  set(C.REJECT_REASON, o.reason); set(C.REVIVED_AT, o.revivedAt); set(C.HISTORY, o.history);
  set(C.SOURCE, o.source); set(C.STAGE_MARKS, o.marks); set(C.DEMO_AT, o.demoAt); set(C.CV, o.cv);
  return r;
}
const sheet = (...rows) => [['header']].concat(rows);
const openEnglish = { LMS4: [{ subjects: 'English', matchSubjects: 'English', roleLevel: 'TGT' }] };
function build(rows, extra) {
  return ctx.hirBuildApplicants_(sheet(...rows), Object.assign({
    requisitions: openEnglish, visibleCampuses: ['LMS4', 'LMS5', 'LMS6'], irRows: [['h']],
    portalInterviews: [], portalDemos: [], decisions: {}, nowMs: day(0).getTime(),
  }, extra || {}));
}
const irRow = (phone, ts) => [ts, 'Asha', phone, 'LMS 4', 'English', 'ok', 'https://pdf'];

T('ladder: date -> Interview Scheduled', () => assert.strictEqual(build([row({ interviewAt: day(0) })])[0].status, 'Interview Scheduled'));
T('ladder: portal interview report -> Interview Done', () => {
  const a = build([row({ interviewAt: day(-1) })], { portalInterviews: [{ phone: '9876543210', submittedAtMs: day(0).getTime(), recommendation: 'proceed' }] })[0];
  assert.strictEqual(a.status, 'Interview Done'); assert.strictEqual(a.reportPending, '');
});
T('ladder: + portal demo report (proceed) -> Demo Done', () => {
  const at = day(0).getTime();
  const a = build([row({ interviewAt: day(-1) })], { portalInterviews: [{ phone: '9876543210', submittedAtMs: at, recommendation: 'proceed' }],
    portalDemos: [{ phone: '9876543210', submittedAtMs: at, recommendation: 'proceed' }] })[0];
  assert.strictEqual(a.status, 'Demo Done');
});
T('ladder: demo report "another" is not Demo Done', () => {
  const at = day(0).getTime();
  const a = build([row({ interviewAt: day(-1) })], { portalInterviews: [{ phone: '9876543210', submittedAtMs: at, recommendation: 'proceed' }],
    portalDemos: [{ phone: '9876543210', submittedAtMs: at, recommendation: 'another' }] })[0];
  assert.strictEqual(a.status, 'Interview Done');
});
T('ladder: old Google-Form report -> Demo Done', () => {
  assert.strictEqual(build([row({ interviewAt: day(-3) })], { irRows: [['h'], irRow('98765 43210', day(-2))] })[0].status, 'Demo Done');
});
T('ladder: Principal mark without report -> report pending', () => {
  const a = build([row({ interviewAt: day(-1), marks: JSON.stringify({ interview: { at: day(0).toISOString(), by: 'p@lms.org.in' } }) })])[0];
  assert.strictEqual(a.status, 'Interview Done'); assert.strictEqual(a.reportPending, 'interview');
});
T('ladder: stored legacy "Interview & Demo Done" reads as Demo Done', () => {
  assert.strictEqual(build([row({ status: 'Interview & Demo Done' })])[0].status, 'Demo Done');
});
T('ladder: later rungs unchanged', () => {
  const at = day(-2).getTime();
  const ev = { portalInterviews: [{ phone: '9876543210', submittedAtMs: at, recommendation: 'proceed' }], portalDemos: [{ phone: '9876543210', submittedAtMs: at, recommendation: 'proceed' }] };
  assert.strictEqual(build([row({ interviewAt: day(-3), offerAt: day(-1) })], ev)[0].status, 'Salary Offer');
  const t = ctx.hirApplicantId_(2);
  assert.strictEqual(build([row({ interviewAt: day(-3), offerAt: day(-1), md: day(-1) })], Object.assign({ decisions: { [t]: { status: 'Approved', decidedAtMs: day(0).getTime() } } }, ev))[0].status, 'Hiring Approved');
  assert.strictEqual(build([row({ interviewAt: day(-3), offerAt: day(-1), md: day(-1) })], Object.assign({ decisions: { [t]: { status: 'Rejected', decidedAtMs: day(0).getTime() } } }, ev))[0].status, 'Rejected');
});

T('revival: evidence before Revived At is ignored', () => {
  const t = ctx.hirApplicantId_(2);
  const a = build([row({ revivedAt: day(-1), history: JSON.stringify([{ round: 1 }]) })], {
    irRows: [['h'], irRow('9876543210', day(-5))],
    portalInterviews: [{ phone: '9876543210', submittedAtMs: day(-4).getTime(), recommendation: 'proceed' }],
    decisions: { [t]: { status: 'Rejected', decidedAtMs: day(-3).getTime() } },
  })[0];
  assert.strictEqual(a.status, ''); assert.strictEqual(a.round, 2);
  assert.strictEqual(build([row({ revivedAt: day(-1), interviewAt: day(1) })], { irRows: [['h'], irRow('9876543210', day(-5))] })[0].status, 'Interview Scheduled');
});
T('revival: evidence after Revived At counts', () => {
  assert.strictEqual(build([row({ revivedAt: day(-3), interviewAt: day(-2) })], { irRows: [['h'], irRow('9876543210', day(-1))] })[0].status, 'Demo Done');
});

T('de-dupe keeps the row furthest along, fills a missing CV from the other', () => {
  const list = build([row({ interviewAt: day(-1), marks: JSON.stringify({ interview: { at: day(0).toISOString() } }) }), row({ ts: day(-1), cv: 'https://cv' })]);
  assert.strictEqual(list.length, 1); assert.strictEqual(list[0].row, 2); assert.strictEqual(list[0].cv, 'https://cv');
});
T('de-dupe: tie goes to the latest row', () => {
  const list = build([row({}), row({ ts: day(-1), name: 'Asha Newer' })]);
  assert.strictEqual(list.length, 1); assert.strictEqual(list[0].row, 3);
});
T('phone formats match: +91 98765-43210 == 9876543210', () => {
  assert.strictEqual(build([row({ phone: '+91 98765-43210', interviewAt: day(-1) })], { portalInterviews: [{ phone: '9876543210', submittedAtMs: day(0).getTime(), recommendation: 'proceed' }] })[0].status, 'Interview Done');
});

T('visibility: in progress with no open role stays visible', () => {
  const a = build([row({ interviewAt: day(-1) })], { requisitions: {} });
  assert.strictEqual(a.length, 1); assert.strictEqual(a[0].noOpenRole, true);
});
T('visibility: fresh online applicant with no match is hidden', () => assert.strictEqual(build([row({ subjects: 'Physics' })]).length, 0));
T('visibility: Rejected alone does not count as progress', () => assert.strictEqual(build([row({ subjects: 'Physics', status: 'Rejected' })]).length, 0));
T('visibility: portal-added with no match is visible', () => assert.strictEqual(build([row({ subjects: 'Physics', source: 'Walk-in' })]).length, 1));
T('visibility: outside the district is hidden', () => assert.strictEqual(build([row({ branches: 'LMS-1', interviewAt: day(-1) })]).length, 0));
T('visibility: ALL sees everything in progress', () => assert.strictEqual(build([row({ branches: 'LMS-1', interviewAt: day(-1) })], { visibleCampuses: null }).length, 1));

T('caller campuses: comma list unions districts', () => {
  assert.deepStrictEqual(Array.from(ctx.hirCallerCampuses_({ campusId: 'LMS1,LMS4' })).sort(), ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6']);
  assert.deepStrictEqual(Array.from(ctx.hirCallerCampuses_({ campusId: 'LMS2' })), ['LMS1', 'LMS2', 'LMS3']);
  assert.strictEqual(ctx.hirCallerCampuses_({ campusId: 'ALL' }), null);
});
T('fields carried: reason, source, demoAt, history', () => {
  const a = build([row({ status: 'Rejected', reason: 'Salary expectation too high', source: 'Walk-in', demoAt: day(1), history: JSON.stringify([{ round: 1 }]) })])[0];
  assert.strictEqual(a.status, 'Rejected'); assert.strictEqual(a.rejectReason, 'Salary expectation too high');
  assert.strictEqual(a.source, 'Walk-in'); assert.ok(a.demoAt); assert.strictEqual(a.history.length, 1);
});
