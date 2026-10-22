// Run: TZ=Asia/Kolkata node tests/hiring/test-appointments.js -- the Appointments store (hiring-appointments.gs):
// propose, cancel, direct booking, and every old date writer rerouted through it.
const vm = require('vm'), fs = require('fs'), assert = require('assert'), path = require('path');
// The script lock is not re-entrant in Apps Script: this fake throws if anything takes it while it is held.
let held = false, props = {}, logs = [];
const ctx = vm.createContext({
  console, Logger: { log(m) { logs.push(String(m)); } }, Session: { getScriptTimeZone: () => 'Asia/Kolkata' },
  Utilities: { formatDate: () => '2026-10-22' }, APR_STATUS: { APPROVED: 'Approved', REJECTED: 'Rejected' },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (props[k] === undefined ? null : props[k]) }) },
  LockService: { getScriptLock: () => ({
    waitLock() { if (held) throw new Error('lock taken while held (nested lock)'); held = true; },
    tryLock() { if (held) throw new Error('lock taken while held (nested lock)'); held = true; return true; },
    releaseLock() { held = false; } }) },
});
['hiring.gs', 'hiring-appointments.gs'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '../../apps-script', f), 'utf8'), ctx));
const C = vm.runInContext('HIR_COL', ctx);
const REAL_CAL = ctx.APPT_CAL_;
const H = Array.from(vm.runInContext('APPT_HEADERS', ctx));
const isDate = (v) => Object.prototype.toString.call(v) === '[object Date]';
const T = (name, fn) => { held = false; fn(); assert.strictEqual(held, false, 'lock left held'); console.log('ok  -', name); };
const throws = (fn, re) => assert.throws(fn, (e) => re.test(e.message), String(re));

// Like Apps Script: reading a column past getMaxColumns() throws (a live sheet starts at 25 columns).
function sheet(rows) {
  let maxCols = Math.max(25, ...rows.map((r) => r.length));
  const s = {
    rows, getLastRow: () => rows.length, getMaxColumns: () => maxCols, insertColumnsAfter(n, k) { maxCols += k; },
    appendRow(r) { rows.push(r.slice()); },
    getDataRange: () => ({ getValues: () => rows.map((r) => r.slice()) }),
    getRange(r, c) {
      if (c > maxCols) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
      const rng = {
        getValue: () => ((rows[r - 1] || [])[c - 1] === undefined ? '' : rows[r - 1][c - 1]),
        setValue(v) { while (rows.length < r) rows.push([]); rows[r - 1][c - 1] = v; return rng; },
        setValues(vals) { vals.forEach((vr, i) => vr.forEach((v, j) => { while (rows.length < r + i) rows.push([]); rows[r - 1 + i][c - 1 + j] = v; })); return rng; },
        setNumberFormat() { return rng; }, setFontWeight() { return rng; },
      };
      return rng;
    },
  };
  return s;
}
const day = (n) => new Date(Date.UTC(2026, 9, 22 + n, 5, 0));
const FUTURE = '2030-01-10T10:30', PAST = new Date(Date.UTC(2020, 0, 10, 5, 0));
function appRow(o) {
  const r = new Array(25).fill('');
  r[C.TIMESTAMP - 1] = day(-10); r[C.NAME - 1] = o.name || 'Asha'; r[C.PHONE - 1] = o.phone || '9876543210';
  r[C.SUBJECTS - 1] = 'English'; r[C.BRANCHES - 1] = o.branches || 'LMS-4';
  Object.keys(o).forEach((k) => { if (C[k] !== undefined) r[C[k] - 1] = o[k]; });
  return r;
}
let apps, tabs, lockedDuringList;
function reset(rows) {
  apps = sheet([['Timestamp']].concat(rows));
  tabs = {};
  ctx.hirSheet_ = () => apps;
  ctx.hirIrSheet_ = () => sheet([['h']]);
  ctx.hirWorkbook_ = () => ({ getSheetByName: (n) => tabs[n] || null, insertSheet: (n) => (tabs[n] = sheet([])) });
  ctx.hiringApplicants_ = () => { lockedDuringList = held; return { success: true, applicants: [] }; };
  ctx.hirSalaryOfferDecisions_ = () => ({});
  ctx.hirIsHiringApproved_ = () => false;
  props = {}; logs = [];
  stubCal({});
}
// The calendar seam, recorded. failOwn: insert into the acceptor's calendar throws; failGuest: into 'primary'.
let cal;
function stubCal(o) {
  cal = Object.assign({ inserts: [], removes: [] }, o);
  ctx.APPT_CAL_ = {
    insert(id, ev) { cal.inserts.push({ id, ev: JSON.parse(JSON.stringify(ev)) }); if (id === 'primary' ? cal.failGuest : cal.failOwn) throw new Error('403 read-only'); return { id: 'ev' + cal.inserts.length }; },
    remove(id, eid) { cal.removes.push([id, eid]); },
  };
}
const appts = () => ctx.apptAll_();
// An appointment row written straight into the tab (for states the stub can't reach yet).
function addAppt(o) {
  const sh = tabs.Appointments || (tabs.Appointments = sheet([H.slice()]));
  const keys = vm.runInContext('APPT_KEYS', ctx);
  sh.appendRow(Array.from(keys, (k) => (o[k] === undefined ? '' : o[k])));
}
const principal = { email: 'p@lms.org.in', campusId: 'LMS4', roles: ['Principal'] };
const coord = { email: 'co@lms.org.in', campusId: 'LMS4', roles: ['Coordinator'] };
const clerk = { email: 'c@lms.org.in', campusId: 'LMS4', roles: ['FeeClerk'] };
const clerk2 = { email: 'c2@lms.org.in', campusId: 'LMS4', roles: ['FeeClerk'] };
const SL = { SHORTLISTED_AT: day(-1), SHORTLISTED_BY: 'p@lms.org.in' };
const nine = { pedagogy: 4, content: 4, interaction: 3, response: 4, management: 3, clarity: 5, relatable: 4, aids: 3 };
const MARKED = JSON.stringify({ interview: { at: day(-1).toISOString(), by: 'p@lms.org.in' } });

T('a clerk proposes on a Shortlisted row -> proposed, campus LMS4, list built outside the lock', () => {
  reset([appRow(SL)]);
  const res = ctx.apptPropose_(clerk, { row: 2, kind: 'interview', start: FUTURE });
  assert.ok(res.id); assert.strictEqual(lockedDuringList, false);
  const a = appts();
  assert.strictEqual(a.length, 1);
  assert.strictEqual(a[0].status, 'proposed'); assert.strictEqual(a[0].campus, 'LMS4'); assert.strictEqual(a[0].kind, 'interview');
  assert.strictEqual(a[0].proposedBy, 'c@lms.org.in'); assert.strictEqual(a[0].acceptorRole, 'Principal');
  assert.strictEqual(a[0].durationMin, 30); assert.strictEqual(a[0].applicantId, 'T-0002');
  assert.strictEqual(tabs.Appointments.rows[0].join('|'), H.join('|'));
  assert.strictEqual(apps.rows[1][C.INTERVIEW_AT - 1], ''); // a proposal never writes the time column
});
T('a multi-campus clerk gets hirScopedRow_\'s pick as the campus', () => {
  reset([appRow(Object.assign({ branches: 'LMS-5, LMS-4' }, SL))]);
  ctx.apptPropose_({ email: 'm@lms.org.in', campusId: 'LMS4,LMS5', roles: ['FeeClerk'] }, { row: 2, kind: 'interview', start: FUTURE });
  assert.strictEqual(appts()[0].campus, 'LMS5');
});
T('a second proposal cancels the first', () => {
  reset([appRow(SL)]);
  ctx.apptPropose_(clerk, { row: 2, kind: 'interview', start: FUTURE });
  ctx.apptPropose_(clerk, { row: 2, kind: 'interview', start: '2030-01-11T10:30' });
  assert.deepStrictEqual(appts().map((a) => a.status), ['cancelled', 'proposed']);
});
T('not shortlisted -> Shortlist first', () => {
  reset([appRow({})]);
  throws(() => ctx.apptPropose_(clerk, { row: 2, kind: 'interview', start: FUTURE }), /Shortlist/);
});
T('Rejected -> Revive first', () => {
  reset([appRow(Object.assign({ STATUS: 'Rejected' }, SL))]);
  throws(() => ctx.apptPropose_(clerk, { row: 2, kind: 'interview', start: FUTURE }), /Revive/);
});
T('demo before interview evidence -> refused', () => {
  reset([appRow(SL)]);
  throws(() => ctx.apptPropose_(clerk, { row: 2, kind: 'demo', start: FUTURE }), /interview/i);
  apps.rows[1][C.STAGE_MARKS - 1] = MARKED;
  ctx.apptPropose_(clerk, { row: 2, kind: 'demo', start: FUTURE });
  assert.strictEqual(appts()[0].durationMin, 45);
});
T('a clerk may not propose md; md needs a Salary Offer', () => {
  reset([appRow(Object.assign({ SALARY_OFFER_AT: day(-1) }, SL))]);
  throws(() => ctx.apptPropose_(clerk, { row: 2, kind: 'md', start: FUTURE }), /Principal|Owner/);
  reset([appRow(SL)]);
  throws(() => ctx.apptPropose_(principal, { row: 2, kind: 'md', start: FUTURE }), /Salary Offer/);
});
T('a Principal on a Salary Offer row proposes md to an Owner', () => {
  reset([appRow(Object.assign({ SALARY_OFFER_AT: day(-1) }, SL))]);
  ctx.apptPropose_(principal, { row: 2, kind: 'md', start: FUTURE });
  const a = appts()[0];
  assert.strictEqual(a.status, 'proposed'); assert.strictEqual(a.acceptorRole, 'Owner');
});
T('cancel: a stranger may not; the proposer may', () => {
  reset([appRow(SL)]);
  const id = ctx.apptPropose_(clerk, { row: 2, kind: 'interview', start: FUTURE }).id;
  throws(() => ctx.apptCancel_(clerk2, { id }), /proposer|Principal/);
  ctx.apptCancel_(clerk, { id, note: 'candidate busy' });
  assert.strictEqual(appts()[0].status, 'cancelled');
});
T('a Principal booking an unshortlisted walk-in directly -> shortlist stamped, accepted, time written', () => {
  reset([appRow({})]);
  ctx.apptPropose_(principal, { row: 2, kind: 'interview', start: FUTURE });
  const a = appts()[0];
  assert.strictEqual(a.status, 'accepted'); assert.strictEqual(a.decidedBy, 'p@lms.org.in');
  assert.ok(isDate(apps.rows[1][C.SHORTLISTED_AT - 1])); assert.strictEqual(apps.rows[1][C.SHORTLISTED_BY - 1], 'p@lms.org.in');
  assert.strictEqual(apps.rows[1][C.INTERVIEW_AT - 1].getTime(), new Date(FUTURE).getTime());
});
T('a direct reschedule cancels the old accepted one', () => {
  reset([appRow(SL)]);
  ctx.apptPropose_(principal, { row: 2, kind: 'interview', start: FUTURE });
  ctx.apptPropose_(principal, { row: 2, kind: 'interview', start: '2030-01-12T10:00' });
  assert.deepStrictEqual(appts().map((a) => a.status), ['cancelled', 'accepted']);
});
T('cancel of an accepted one clears the time column only while it still holds that time', () => {
  reset([appRow(SL)]);
  ctx.apptPropose_(principal, { row: 2, kind: 'interview', start: FUTURE });
  ctx.apptCancel_(principal, { id: appts()[0].id });
  assert.strictEqual(apps.rows[1][C.INTERVIEW_AT - 1], '');
  ctx.apptPropose_(principal, { row: 2, kind: 'interview', start: FUTURE });
  const other = new Date('2030-02-01T09:00');
  apps.rows[1][C.INTERVIEW_AT - 1] = other;
  ctx.apptCancel_(principal, { id: appts()[1].id });
  assert.strictEqual(apps.rows[1][C.INTERVIEW_AT - 1], other);
});
T('revive cancels every open or accepted appointment, on a duplicate same-phone row too', () => {
  reset([appRow(Object.assign({ STATUS: 'Rejected' }, SL)), appRow(Object.assign({ phone: '+91 98765 43210', STATUS: 'Rejected' }, SL))]);
  addAppt({ id: 'a1', kind: 'interview', row: 3, phone: '9876543210', status: 'proposed', start: new Date(FUTURE), proposedBy: 'c@lms.org.in' });
  addAppt({ id: 'a2', kind: 'demo', row: 2, phone: '9876543210', status: 'accepted', start: new Date(FUTURE), proposedBy: 'c@lms.org.in' });
  addAppt({ id: 'a3', kind: 'interview', row: 2, phone: '1111111111', status: 'proposed', start: new Date(FUTURE), proposedBy: 'c@lms.org.in' });
  ctx.hiringRevive_(principal, { row: 2, note: 'back' });
  assert.deepStrictEqual(appts().map((a) => a.status), ['cancelled', 'cancelled', 'proposed']);
});
T('reject cancels proposals and a future accepted, keeps a past accepted', () => {
  reset([appRow(SL)]);
  addAppt({ id: 'p1', kind: 'demo', row: 2, phone: '9876543210', status: 'proposed', start: new Date(FUTURE) });
  addAppt({ id: 'f1', kind: 'interview', row: 2, phone: '9876543210', status: 'accepted', start: new Date(FUTURE) });
  addAppt({ id: 'h1', kind: 'interview', row: 2, phone: '9876543210', status: 'accepted', start: PAST });
  ctx.hiringUpdateStatus_(principal, { row: 2, status: 'Rejected', rejectReason: 'Salary expectation too high' });
  assert.deepStrictEqual(appts().map((a) => a.status), ['cancelled', 'cancelled', 'accepted']);
  assert.strictEqual(apps.rows[1][C.STATUS - 1], 'Rejected');
});
T('un-shortlist cancels proposals; refused while one is accepted', () => {
  reset([appRow(SL)]);
  ctx.apptPropose_(clerk, { row: 2, kind: 'interview', start: FUTURE });
  ctx.hiringShortlist_(principal, { row: 2, on: false });
  assert.strictEqual(appts()[0].status, 'cancelled'); assert.strictEqual(apps.rows[1][C.SHORTLISTED_AT - 1], '');
  ctx.hiringShortlist_(principal, { row: 2, on: true });
  ctx.apptPropose_(principal, { row: 2, kind: 'interview', start: FUTURE });
  throws(() => ctx.hiringShortlist_(principal, { row: 2, on: false }), /already scheduled/);
  assert.ok(apps.rows[1][C.SHORTLISTED_AT - 1]);
});
T('updatehiringstatus no longer writes interview / demo times; mdInterviewAt only from an Owner', () => {
  reset([appRow(SL)]);
  throws(() => ctx.hiringUpdateStatus_(principal, { row: 2, interviewAt: FUTURE }), /Appointments/);
  throws(() => ctx.hiringUpdateStatus_(principal, { row: 2, demoAt: FUTURE }), /Appointments/);
  throws(() => ctx.hiringUpdateStatus_(principal, { row: 2, mdInterviewAt: FUTURE }), /Appointments/);
  assert.strictEqual(apps.rows[1][C.INTERVIEW_AT - 1], '');
  ctx.hiringUpdateStatus_(principal, { row: 2, notes: 'ok' }); // other saves still work
  assert.strictEqual(apps.rows[1][C.NOTES - 1], 'ok');
});
T('an Owner\'s mdInterviewAt is their own md booking (MD_ACCEPTOR_EMAILS unset)', () => {
  reset([appRow(Object.assign({ SALARY_OFFER_AT: day(-1) }, SL))]);
  ctx.hiringUpdateStatus_({ email: 'o@lms.org.in', campusId: 'ALL', roles: ['Owner'] }, { row: 2, mdInterviewAt: FUTURE });
  assert.strictEqual(appts()[0].kind, 'md'); assert.strictEqual(appts()[0].status, 'accepted');
  assert.ok(isDate(apps.rows[1][C.MD_INTERVIEW_AT - 1]));
});
T('hiringschedule by a Coordinator -> proposed; clear cancels it', () => {
  reset([appRow(SL)]);
  ctx.hiringSchedule_(coord, { row: 2, interviewAt: FUTURE });
  assert.strictEqual(appts()[0].status, 'proposed'); assert.strictEqual(apps.rows[1][C.INTERVIEW_AT - 1], '');
  ctx.hiringSchedule_(coord, { row: 2, clear: 'interview' });
  assert.strictEqual(appts()[0].status, 'cancelled');
});
T('hiringschedule by a Principal -> a direct booking', () => {
  reset([appRow(SL)]);
  ctx.hiringSchedule_(principal, { row: 2, interviewAt: FUTURE });
  assert.strictEqual(appts()[0].status, 'accepted'); assert.ok(isDate(apps.rows[1][C.INTERVIEW_AT - 1]));
});
T('demo report "another" + nextDemoAt: a Principal books it, a Coordinator proposes it', () => {
  const body = { row: 2, demoDate: '2026-10-22', scores: nine, studentFeedback: 4, recommendation: 'another', nextDemoAt: FUTURE };
  reset([appRow(Object.assign({ STAGE_MARKS: MARKED }, SL))]);
  ctx.hiringSubmitDemo_(principal, body);
  assert.strictEqual(appts()[0].status, 'accepted'); assert.strictEqual(appts()[0].kind, 'demo');
  assert.strictEqual(apps.rows[1][C.DEMO_AT - 1].getTime(), new Date(FUTURE).getTime());
  assert.strictEqual(tabs['Portal Demo Reports'].rows.length, 2);
  reset([appRow(Object.assign({ STAGE_MARKS: MARKED }, SL))]);
  ctx.hiringSubmitDemo_(coord, body);
  assert.strictEqual(appts()[0].status, 'proposed'); assert.strictEqual(apps.rows[1][C.DEMO_AT - 1], '');
});
const owner = { email: 'o@lms.org.in', campusId: 'ALL', roles: ['Owner'] };
const md = { email: 'md@lms.org.in', campusId: 'ALL', roles: ['Owner'] };
const p1 = { email: 'p1@lms.org.in', campusId: 'LMS1', roles: ['Principal'] };
const proposeId = (who, o) => ctx.apptPropose_(who, Object.assign({ row: 2, kind: 'interview', start: FUTURE }, o)).id;

T('a same-campus Principal accepts -> accepted, column 13 set, event on their own calendar', () => {
  reset([appRow(SL)]);
  const id = proposeId(clerk);
  const res = ctx.apptDecide_(principal, { id, decision: 'accept' });
  assert.strictEqual(lockedDuringList, false); assert.ok(Array.isArray(Array.from(res.toAccept)));
  const a = appts()[0];
  assert.strictEqual(a.status, 'accepted'); assert.strictEqual(a.decidedBy, 'p@lms.org.in'); assert.strictEqual(a.calendarMode, 'own');
  assert.strictEqual(a.eventId, 'p@lms.org.in|ev1'); assert.strictEqual(a.calendarError, '');
  assert.strictEqual(apps.rows[1][C.INTERVIEW_AT - 1].getTime(), new Date(FUTURE).getTime());
  const ev = cal.inserts[0].ev;
  assert.strictEqual(cal.inserts[0].id, 'p@lms.org.in');
  assert.strictEqual(ev.summary, 'Interview: Asha (English)');
  assert.ok(ev.description.includes('9876543210') && ev.description.includes('LMS4') && ev.description.includes('c@lms.org.in'));
  assert.ok(ev.description.includes('https://kanwaruday.github.io/LMCSManagement/hiring/index.html#row=2'));
  assert.strictEqual(new Date(ev.end.dateTime) - new Date(ev.start.dateTime), 30 * 60000);
  assert.strictEqual(ev.attendees, undefined);
});
T('the event title names the first approved role that matches', () => {
  reset([appRow(SL)]);
  ctx.hirApprovedRequisitions_ = () => ({ LMS4: [{ roleLevel: 'TGT', subjects: 'English', matchSubjects: 'English' }] });
  try { ctx.apptDecide_(principal, { id: proposeId(clerk), decision: 'accept' }); } finally { delete ctx.hirApprovedRequisitions_; }
  assert.strictEqual(cal.inserts[0].ev.summary, 'Interview: Asha (TGT: English)');
});
T('the acceptor\'s calendar is read-only -> guest on primary with the acceptor as attendee', () => {
  reset([appRow(SL)]);
  stubCal({ failOwn: true });
  ctx.apptDecide_(principal, { id: proposeId(clerk), decision: 'accept' });
  const a = appts()[0];
  assert.strictEqual(a.calendarMode, 'guest'); assert.strictEqual(a.eventId, 'primary|ev2');
  assert.strictEqual(cal.inserts[1].id, 'primary');
  assert.deepStrictEqual(cal.inserts[1].ev.attendees, [{ email: 'p@lms.org.in' }]);
});
T('both calendar inserts fail -> still accepted, mode none, error stored; a retry later lands on own', () => {
  reset([appRow(SL)]);
  stubCal({ failOwn: true, failGuest: true });
  const id = proposeId(clerk);
  ctx.apptDecide_(principal, { id, decision: 'accept' });
  let a = appts()[0];
  assert.strictEqual(a.status, 'accepted'); assert.strictEqual(a.calendarMode, 'none'); assert.ok(/403/.test(a.calendarError));
  assert.strictEqual(a.eventId, ''); assert.ok(apps.rows[1][C.INTERVIEW_AT - 1]);
  throws(() => ctx.apptCalendarRetry_(clerk, { id }), /Principal|acceptor/);
  cal.failOwn = false;
  ctx.apptCalendarRetry_(principal, { id });
  a = appts()[0];
  assert.strictEqual(a.calendarMode, 'own'); assert.strictEqual(a.calendarError, ''); assert.strictEqual(a.eventId, 'p@lms.org.in|ev3');
  throws(() => ctx.apptCalendarRetry_(principal, { id }), /already/);
});
T('a double accept -> the second throws "already accepted"; one event', () => {
  reset([appRow(SL)]);
  const id = proposeId(clerk);
  ctx.apptDecide_(principal, { id, decision: 'accept' });
  throws(() => ctx.apptDecide_({ email: 'p2@lms.org.in', campusId: 'LMS4', roles: ['Principal'] }, { id, decision: 'accept' }), /already accepted/);
  assert.strictEqual(cal.inserts.length, 1);
});
T('who may not accept: another campus\'s Principal, a Coordinator, a Fee Clerk', () => {
  reset([appRow(SL)]);
  const id = proposeId(clerk);
  throws(() => ctx.apptDecide_(p1, { id, decision: 'accept' }), /Principal/);
  throws(() => ctx.apptDecide_(coord, { id, decision: 'accept' }), /Principal/);
  throws(() => ctx.apptDecide_(clerk, { id, decision: 'accept' }), /Principal/);
  throws(() => ctx.apptDecide_(clerk, { id, decision: 'decline', note: 'no' }), /Principal/);
  assert.strictEqual(appts()[0].status, 'proposed'); assert.strictEqual(cal.inserts.length, 0);
});
T('an Owner override accepts an interview -> decidedBy marked (override)', () => {
  reset([appRow(SL)]);
  ctx.apptDecide_(owner, { id: proposeId(clerk), decision: 'accept' });
  const a = appts()[0];
  assert.strictEqual(a.status, 'accepted'); assert.ok(/o@lms\.org\.in.*\(override\)/.test(a.decidedBy));
  assert.strictEqual(cal.inserts[0].id, 'o@lms.org.in');
});
T('md: with MD_ACCEPTOR_EMAILS set, a different Owner may not accept; the listed one may', () => {
  reset([appRow(Object.assign({ SALARY_OFFER_AT: day(-1) }, SL))]);
  props.MD_ACCEPTOR_EMAILS = 'md@lms.org.in';
  const id = proposeId(principal, { kind: 'md' });
  throws(() => ctx.apptDecide_(owner, { id, decision: 'accept' }), /MD Academics/);
  throws(() => ctx.apptDecide_(principal, { id, decision: 'accept' }), /MD Academics/);
  ctx.apptDecide_(md, { id, decision: 'accept' });
  assert.strictEqual(appts()[0].status, 'accepted'); assert.ok(apps.rows[1][C.MD_INTERVIEW_AT - 1]);
  assert.ok(/^MD Academics interview: Asha/.test(cal.inserts[0].ev.summary));
});
T('a reschedule\'s accept cancels the old accepted one and removes its event', () => {
  reset([appRow(SL)]);
  ctx.apptPropose_(principal, { row: 2, kind: 'interview', start: FUTURE }); // direct: event p@|ev1
  const id = proposeId(clerk, { start: '2030-01-12T10:00' });
  assert.deepStrictEqual(appts().map((a) => a.status), ['accepted', 'proposed']);
  ctx.apptDecide_(principal, { id, decision: 'accept' });
  assert.deepStrictEqual(appts().map((a) => a.status), ['cancelled', 'accepted']);
  assert.deepStrictEqual(cal.removes, [['p@lms.org.in', 'ev1']]);
  assert.strictEqual(apps.rows[1][C.INTERVIEW_AT - 1].getTime(), new Date('2030-01-12T10:00').getTime());
});
T('decline needs a note; it leaves the applicant row alone', () => {
  reset([appRow(SL)]);
  const id = proposeId(clerk);
  throws(() => ctx.apptDecide_(principal, { id, decision: 'decline' }), /note/);
  throws(() => ctx.apptDecide_(principal, { id, decision: 'maybe' }), /accept or decline/);
  ctx.apptDecide_(principal, { id, decision: 'decline', note: 'I am away that day' });
  const a = appts()[0];
  assert.strictEqual(a.status, 'declined'); assert.strictEqual(a.declineNote, 'I am away that day'); assert.strictEqual(a.decidedBy, 'p@lms.org.in');
  assert.strictEqual(apps.rows[1][C.INTERVIEW_AT - 1], ''); assert.strictEqual(cal.inserts.length, 0);
});
T('a Principal direct booking -> accepted at once, event on their calendar', () => {
  reset([appRow(SL)]);
  ctx.apptPropose_(principal, { row: 2, kind: 'interview', start: FUTURE });
  const a = appts()[0];
  assert.strictEqual(a.status, 'accepted'); assert.strictEqual(a.calendarMode, 'own'); assert.strictEqual(cal.inserts[0].id, 'p@lms.org.in');
  assert.ok(cal.inserts[0].ev.summary.startsWith('Interview: Asha'));
});
T('apptList_: scoped to the caller; clerks lose md notes; an Owner\'s toAccept is md only', () => {
  reset([appRow(SL)]);
  const base = { phone: '9876543210', row: 2, name: 'Asha', start: new Date(FUTURE), proposedBy: 'c@lms.org.in' };
  addAppt(Object.assign({}, base, { id: 'i4', kind: 'interview', campus: 'LMS4', status: 'proposed' }));
  addAppt(Object.assign({}, base, { id: 'i1', kind: 'interview', campus: 'LMS1', status: 'proposed' }));
  addAppt(Object.assign({}, base, { id: 'd4', kind: 'demo', campus: 'LMS4', status: 'accepted' }));
  addAppt(Object.assign({}, base, { id: 'm4', kind: 'md', campus: 'LMS4', status: 'proposed', note: 'salary 30k', proposedBy: 'p@lms.org.in' }));
  addAppt(Object.assign({}, base, { id: 'x4', kind: 'interview', campus: 'LMS4', status: 'cancelled' }));
  addAppt(Object.assign({}, base, { id: 'old', kind: 'demo', campus: 'LMS4', status: 'accepted', start: PAST }));
  const ids = (l) => Array.from(l, (a) => a.id).sort().join(',');
  let L = ctx.apptList_(principal);
  assert.strictEqual(L.success, true);
  assert.strictEqual(ids(L.toAccept), 'i4'); assert.strictEqual(ids(L.myProposals), 'm4'); assert.strictEqual(ids(L.upcoming), 'd4');
  assert.strictEqual(typeof L.upcoming[0].start, 'string');
  L = ctx.apptList_(clerk);
  assert.strictEqual(ids(L.toAccept), ''); assert.strictEqual(ids(L.myProposals), 'd4,i4'); assert.strictEqual(ids(L.upcoming), 'd4');
  L = ctx.apptList_(p1);
  assert.strictEqual(ids(L.toAccept), 'i1'); assert.strictEqual(ids(L.upcoming), '');
  L = ctx.apptList_(owner);
  assert.strictEqual(ids(L.toAccept), 'm4'); assert.strictEqual(ids(L.upcoming), 'd4');
  props.MD_ACCEPTOR_EMAILS = 'md@lms.org.in';
  assert.strictEqual(ids(ctx.apptList_(owner).toAccept), '');
  assert.strictEqual(ids(ctx.apptList_(md).toAccept), 'm4');
  // a clerk never sees an md note
  addAppt(Object.assign({}, base, { id: 'm5', kind: 'md', campus: 'LMS4', status: 'accepted', note: 'salary 30k', declineNote: 'x' }));
  const m5 = Array.from(ctx.apptList_(clerk).upcoming).filter((a) => a.id === 'm5')[0];
  assert.strictEqual(m5.note, ''); assert.strictEqual(m5.declineNote, '');
  assert.strictEqual(Array.from(ctx.apptList_(principal).upcoming).filter((a) => a.id === 'm5')[0].note, 'salary 30k');
});
T('a live 25-column sheet: proposing never reads past the last column', () => {
  reset([appRow({})]);
  assert.strictEqual(apps.getMaxColumns(), 25);
  throws(() => ctx.apptPropose_(clerk, { row: 2, kind: 'interview', start: FUTURE }), /Shortlist/);
  ctx.apptPropose_(principal, { row: 2, kind: 'interview', start: FUTURE });
  assert.strictEqual(appts()[0].status, 'accepted');
});
T('hiringschedule clear: only the caller\'s in-scope rows; nothing booked -> error', () => {
  reset([appRow(SL), appRow(Object.assign({ branches: 'LMS-1' }, SL))]);
  addAppt({ id: 'a1', kind: 'interview', row: 3, phone: '9876543210', campus: 'LMS1', status: 'proposed', start: new Date(FUTURE), proposedBy: 'x@lms.org.in' });
  addAppt({ id: 'a2', kind: 'interview', row: 2, phone: '9876543210', campus: 'LMS4', status: 'proposed', start: new Date(FUTURE), proposedBy: 'c@lms.org.in' });
  ctx.hiringSchedule_(coord, { row: 2, clear: 'interview' });
  assert.deepStrictEqual(appts().map((a) => a.status), ['proposed', 'cancelled']);
  throws(() => ctx.hiringSchedule_(coord, { row: 2, clear: 'interview' }), /Nothing booked to clear/);
  throws(() => ctx.hiringSchedule_(coord, { row: 2, clear: 'demo' }), /Nothing booked to clear/);
});
T('the real calendar seam: Calendar REST over UrlFetchApp, sendUpdates=none, bearer token; non-2xx throws', () => {
  const calls = [];
  let code = 200;
  ctx.ScriptApp = { getOAuthToken: () => 'tok' };
  ctx.UrlFetchApp = { fetch(url, opt) { calls.push({ url, opt }); return { getResponseCode: () => code, getContentText: () => (code === 204 ? '' : code < 300 ? '{"id":"e9"}' : 'nope') }; } };
  ctx.MailApp = { sendEmail() { throw new Error('no mail ever'); } };
  const ev = { summary: 's' };
  assert.strictEqual(REAL_CAL.insert('p@lms.org.in', ev).id, 'e9');
  assert.strictEqual(calls[0].url, 'https://www.googleapis.com/calendar/v3/calendars/p%40lms.org.in/events?sendUpdates=none');
  assert.strictEqual(calls[0].opt.method, 'post'); assert.strictEqual(calls[0].opt.headers.Authorization, 'Bearer tok');
  assert.strictEqual(calls[0].opt.muteHttpExceptions, true); assert.deepStrictEqual(JSON.parse(calls[0].opt.payload), ev);
  code = 204;
  REAL_CAL.remove('primary', 'e9');
  assert.strictEqual(calls[1].url, 'https://www.googleapis.com/calendar/v3/calendars/primary/events/e9?sendUpdates=none');
  assert.strictEqual(calls[1].opt.method, 'delete');
  code = 403;
  throws(() => REAL_CAL.insert('p@lms.org.in', ev), /403/);
  // testCalendarWrite: insert then remove a test event through the seam, logging the mode
  reset([appRow(SL)]);
  const res = ctx.testCalendarWrite('p@lms.org.in');
  assert.strictEqual(res.mode, 'own'); assert.deepStrictEqual(cal.removes, [['p@lms.org.in', 'ev1']]);
  assert.ok(logs.some((l) => /own/.test(l)));
  assert.ok(!/MailApp/.test(fs.readFileSync(path.join(__dirname, '../../apps-script/hiring-appointments.gs'), 'utf8')));
});
T('myProposals keeps the latest declined proposal per (applicant, kind) even once its time has passed', () => {
  reset([appRow(SL)]);
  const base = { phone: '9876543210', row: 2, name: 'Asha', campus: 'LMS4', proposedBy: 'c@lms.org.in', status: 'declined', declineNote: 'no' };
  addAppt(Object.assign({}, base, { id: 'dOld', kind: 'interview', start: PAST, proposedAt: day(-9) }));
  addAppt(Object.assign({}, base, { id: 'dNew', kind: 'interview', start: new Date(PAST.getTime() + 864e5), proposedAt: day(-8) }));
  addAppt(Object.assign({}, base, { id: 'dDemo', kind: 'demo', start: PAST, proposedAt: day(-8) }));
  const ids = (l) => Array.from(l, (a) => a.id).sort().join(',');
  assert.strictEqual(ids(ctx.apptList_(clerk).myProposals), 'dDemo,dNew');
  assert.strictEqual(ids(ctx.apptList_(clerk2).myProposals), ''); // someone else's
  addAppt(Object.assign({}, base, { id: 'again', kind: 'interview', start: FUTURE, status: 'proposed', proposedAt: day(-1) }));
  assert.strictEqual(ids(ctx.apptList_(clerk).myProposals), 'again,dDemo'); // re-proposed: the declined one retires
});
T('calendar retry: the acceptor check ignores email case', () => {
  reset([appRow(SL)]);
  addAppt({ id: 'a1', kind: 'interview', applicantId: 'T-0002', row: 2, phone: '9876543210', name: 'Asha', campus: 'LMS4', start: new Date(FUTURE),
    durationMin: 30, status: 'accepted', decidedBy: 'C@LMS.org.in', calendarMode: 'none', proposedBy: 'c@lms.org.in' });
  ctx.apptCalendarRetry_(clerk, { id: 'a1' });
  assert.strictEqual(appts()[0].calendarMode, 'own');
});
