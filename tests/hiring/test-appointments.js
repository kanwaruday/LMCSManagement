// Run: TZ=Asia/Kolkata node tests/hiring/test-appointments.js -- the Appointments store (hiring-appointments.gs):
// propose, cancel, direct booking, and every old date writer rerouted through it.
const vm = require('vm'), fs = require('fs'), assert = require('assert'), path = require('path');
// The script lock is not re-entrant in Apps Script: this fake throws if anything takes it while it is held.
let held = false;
const ctx = vm.createContext({
  console, Logger: { log() {} }, Session: { getScriptTimeZone: () => 'Asia/Kolkata' },
  Utilities: { formatDate: () => '2026-10-22' }, APR_STATUS: { APPROVED: 'Approved', REJECTED: 'Rejected' },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
  LockService: { getScriptLock: () => ({
    waitLock() { if (held) throw new Error('lock taken while held (nested lock)'); held = true; },
    tryLock() { if (held) throw new Error('lock taken while held (nested lock)'); held = true; return true; },
    releaseLock() { held = false; } }) },
});
['hiring.gs', 'hiring-appointments.gs'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '../../apps-script', f), 'utf8'), ctx));
const C = vm.runInContext('HIR_COL', ctx);
const H = Array.from(vm.runInContext('APPT_HEADERS', ctx));
const isDate = (v) => Object.prototype.toString.call(v) === '[object Date]';
const T = (name, fn) => { held = false; fn(); assert.strictEqual(held, false, 'lock left held'); console.log('ok  -', name); };
const throws = (fn, re) => assert.throws(fn, (e) => re.test(e.message), String(re));

function sheet(rows) {
  let maxCols = 25;
  const s = {
    rows, getLastRow: () => rows.length, getMaxColumns: () => maxCols, insertColumnsAfter(n, k) { maxCols += k; },
    appendRow(r) { rows.push(r.slice()); },
    getDataRange: () => ({ getValues: () => rows.map((r) => r.slice()) }),
    getRange(r, c) {
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
T('decide core: anything but a direct booking is not implemented yet', () => {
  reset([appRow(SL)]);
  ctx.apptPropose_(clerk, { row: 2, kind: 'interview', start: FUTURE });
  throws(() => ctx.apptDecideCore_(principal, appts()[0], 'accept', ''), /not implemented/);
});
