// Run: node tests/hiring/test-actions.js -- hiring.gs's write actions (add applicant, schedule, mark,
// reports, reject, revive) against an in-memory workbook.
const vm = require('vm'), fs = require('fs'), assert = require('assert'), path = require('path');
const ctx = vm.createContext({
  console, Logger: { log() {} }, Session: { getScriptTimeZone: () => 'Asia/Kolkata' },
  Utilities: { formatDate: () => '2026-10-22' }, APR_STATUS: { APPROVED: 'Approved', REJECTED: 'Rejected' },
  LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../apps-script/hiring.gs'), 'utf8'), ctx);
const C = vm.runInContext('HIR_COL', ctx);
const isDate = (v) => Object.prototype.toString.call(v) === '[object Date]'; // vm realm: instanceof fails
const T = (name, fn) => { fn(); console.log('ok  -', name); };

// In-memory sheet: 1-based getRange(r, c[, nr, nc]); grows as written, like Apps Script does.
function sheet(rows, name) {
  let maxCols = 25;
  const s = {
    name, rows,
    getName: () => name, getLastRow: () => rows.length, getMaxColumns: () => maxCols,
    insertColumnsAfter(n, k) { maxCols += k; },
    appendRow(r) { rows.push(r.slice()); },
    getDataRange: () => ({ getValues: () => rows.map((r) => r.slice()) }),
    getRange(r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1;
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
function appRow(o) {
  const r = new Array(25).fill('');
  r[C.TIMESTAMP - 1] = day(-10); r[C.NAME - 1] = o.name || 'Asha'; r[C.PHONE - 1] = o.phone || '9876543210';
  r[C.SUBJECTS - 1] = 'English'; r[C.BRANCHES - 1] = o.branches || 'LMS-4';
  Object.keys(o).forEach((k) => { if (C[k] !== undefined) r[C[k] - 1] = o[k]; });
  return r;
}
let apps, tabs;
function reset(rows) {
  apps = sheet([['Timestamp']].concat(rows), 'apps');
  tabs = {};
  ctx.hirSheet_ = () => apps;
  ctx.hirIrSheet_ = () => sheet([['h']], 'ir');
  ctx.hirWorkbook_ = () => ({
    getSheetByName: (n) => tabs[n] || null,
    insertSheet: (n) => (tabs[n] = sheet([], n)),
  });
  ctx.hiringApplicants_ = () => ({ success: true, applicants: [] });
}
const principal = { email: 'p@lms.org.in', campusId: 'LMS4', roles: ['Principal'] };
const clerk = { email: 'c@lms.org.in', campusId: 'LMS4', roles: ['FeeClerk'] };
const throws = (fn, re) => assert.throws(fn, (e) => re.test(e.message), String(re));
const goodInterview = { row: 2, interviewDate: '2026-10-22', position: 'LMS 4 - TGT: English', confidence: 4, english: 3,
  capability: { English: { C6: 4, C7: 4 } }, recommendation: 'proceed' };
const nine = { pedagogy: 4, content: 4, interaction: 3, response: 4, management: 3, clarity: 5, relatable: 4, aids: 3 };

T('add applicant: writes the row with campus tag, source, added-by', () => {
  reset([]);
  const res = ctx.hiringAddApplicant_(clerk, { name: ' Ritu Thakur ', phone: '98160 12345', campusId: 'LMS4', subjects: 'Hindi', source: 'Walk-in' });
  assert.strictEqual(res.success, true); assert.strictEqual(res.applicantId, 'T-0002');
  const r = apps.rows[1];
  assert.strictEqual(r[C.NAME - 1], 'Ritu Thakur'); assert.strictEqual(r[C.BRANCHES - 1], 'LMS-4');
  assert.strictEqual(r[C.SOURCE - 1], 'Walk-in'); assert.strictEqual(r[C.ADDED_BY - 1], 'c@lms.org.in');
  assert.strictEqual(r[C.PHONE - 1], '9816012345');
});
T('add applicant: an existing phone in another format is a duplicate, nothing appended', () => {
  reset([appRow({ phone: '9876543210' })]);
  const res = ctx.hiringAddApplicant_(principal, { name: 'Asha K', phone: '+91 98765-43210', campusId: 'LMS4', source: 'Walk-in' });
  assert.strictEqual(res.duplicate, true); assert.strictEqual(res.applicantId, 'T-0002'); assert.strictEqual(apps.rows.length, 2);
});
T('add applicant: needs name, a 10-digit phone, a campus in scope and a source', () => {
  reset([]);
  throws(() => ctx.hiringAddApplicant_(principal, { name: '', phone: '9816012345', campusId: 'LMS4', source: 'Walk-in' }), /name/i);
  throws(() => ctx.hiringAddApplicant_(principal, { name: 'X', phone: '98160', campusId: 'LMS4', source: 'Walk-in' }), /10-digit/);
  throws(() => ctx.hiringAddApplicant_(principal, { name: 'X', phone: '9816012345', campusId: 'LMS1', source: 'Walk-in' }), /school/i);
  throws(() => ctx.hiringAddApplicant_(principal, { name: 'X', phone: '9816012345', campusId: 'LMS4', source: 'Magic' }), /source/i);
});

T('schedule: Fee Clerk sets and clears interview / demo dates', () => {
  reset([appRow({})]);
  ctx.hiringSchedule_(clerk, { row: 2, interviewAt: '2026-10-23T10:30', demoAt: '2026-10-24T09:00' });
  assert.ok(isDate(apps.rows[1][C.INTERVIEW_AT - 1])); assert.ok(isDate(apps.rows[1][C.DEMO_AT - 1]));
  ctx.hiringSchedule_(clerk, { row: 2, clear: 'demo' });
  assert.strictEqual(apps.rows[1][C.DEMO_AT - 1], '');
});
T('schedule: outside the caller\'s schools is refused', () => {
  reset([appRow({ branches: 'LMS-1' })]);
  throws(() => ctx.hiringSchedule_(clerk, { row: 2, interviewAt: '2026-10-23T10:30' }), /school/i);
});

T('mark: interview done with no date stamps the date and the mark', () => {
  reset([appRow({})]);
  ctx.hiringMarkStage_(principal, { row: 2, stage: 'interview' });
  assert.ok(isDate(apps.rows[1][C.INTERVIEW_AT - 1]));
  assert.strictEqual(JSON.parse(apps.rows[1][C.STAGE_MARKS - 1]).interview.by, 'p@lms.org.in');
});
T('mark: demo before the interview is refused', () => {
  reset([appRow({ INTERVIEW_AT: day(0) })]);
  throws(() => ctx.hiringMarkStage_(principal, { row: 2, stage: 'demo' }), /interview/i);
});
T('mark: Fee Clerk cannot', () => { reset([appRow({})]); throws(() => ctx.hiringMarkStage_(clerk, { row: 2, stage: 'interview' }), /Principal/); });

T('interview report: scores must be 1 to 5', () => {
  reset([appRow({ INTERVIEW_AT: day(0) })]);
  throws(() => ctx.hiringSubmitInterview_(principal, Object.assign({}, goodInterview, { confidence: 0 })), /1 to 5/);
  throws(() => ctx.hiringSubmitInterview_(principal, Object.assign({}, goodInterview, { capability: {} })), /capability/i);
});
T('interview report: saved to its tab with phone and submitter', () => {
  reset([appRow({ INTERVIEW_AT: day(0) })]);
  ctx.hiringSubmitInterview_(principal, goodInterview);
  const tab = tabs['Portal Interview Reports'];
  assert.strictEqual(tab.rows.length, 2);
  const h = tab.rows[0], r = tab.rows[1];
  assert.strictEqual(r[h.indexOf('Phone')], '9876543210'); assert.strictEqual(r[h.indexOf('Recommendation')], 'proceed');
  assert.strictEqual(r[h.indexOf('Submitted By')], 'p@lms.org.in'); assert.strictEqual(r[h.indexOf('Confidence')], 4);
});
T('interview report: "reject" also rejects with the reason', () => {
  reset([appRow({ INTERVIEW_AT: day(0) })]);
  ctx.hiringSubmitInterview_(principal, Object.assign({}, goodInterview, { recommendation: 'reject', rejectReason: 'Poor communication skills' }));
  assert.strictEqual(apps.rows[1][C.STATUS - 1], 'Rejected'); assert.strictEqual(apps.rows[1][C.REJECT_REASON - 1], 'Poor communication skills');
});

T('demo report: all nine scores required, total out of 45', () => {
  reset([appRow({ INTERVIEW_AT: day(0) })]);
  throws(() => ctx.hiringSubmitDemo_(principal, { row: 2, demoDate: '2026-10-22', scores: nine, recommendation: 'proceed' }), /Student Feedback/);
  ctx.hiringSubmitDemo_(principal, { row: 2, demoDate: '2026-10-22', scores: nine, studentFeedback: 4, recommendation: 'proceed' });
  const tab = tabs['Portal Demo Reports'], h = tab.rows[0];
  assert.strictEqual(tab.rows[1][h.indexOf('Total /45')], 34);
});
T('demo report: "another" sets the next demo date', () => {
  reset([appRow({ INTERVIEW_AT: day(0) })]);
  ctx.hiringSubmitDemo_(principal, { row: 2, demoDate: '2026-10-22', scores: nine, studentFeedback: 4, recommendation: 'another', nextDemoAt: '2026-10-25T09:00' });
  assert.ok(isDate(apps.rows[1][C.DEMO_AT - 1]));
  assert.strictEqual(tabs['Portal Demo Reports'].rows[1][tabs['Portal Demo Reports'].rows[0].indexOf('Recommendation')], 'another');
});

T('reject: a reason from the list is required; Other needs a note', () => {
  reset([appRow({})]);
  throws(() => ctx.hirRejectRow_(principal, apps, 2, '', ''), /reason/i);
  throws(() => ctx.hirRejectRow_(principal, apps, 2, 'Bad vibes', ''), /reason/i);
  throws(() => ctx.hirRejectRow_(principal, apps, 2, 'Other', ''), /note/i);
  ctx.hirRejectRow_(principal, apps, 2, 'Salary expectation too high', 'asked 40k');
  assert.strictEqual(apps.rows[1][C.STATUS - 1], 'Rejected'); assert.ok(/asked 40k/.test(apps.rows[1][C.NOTES - 1]));
});

T('revive: only a Rejected row, with a note', () => {
  reset([appRow({ INTERVIEW_AT: day(-3) })]);
  throws(() => ctx.hiringRevive_(principal, { row: 2, note: 'call back' }), /Rejected/);
  apps.rows[1][C.STATUS - 1] = 'Rejected';
  throws(() => ctx.hiringRevive_(principal, { row: 2, note: '' }), /note/i);
  throws(() => ctx.hiringRevive_(clerk, { row: 2, note: 'x' }), /Principal/);
});
T('revive: snapshots history and clears the round', () => {
  reset([appRow({ INTERVIEW_AT: day(-3), MD_INTERVIEW_AT: day(-2), SALARY_OFFER_AT: day(-2), STATUS: 'Rejected', REJECT_REASON: "Doesn't want to join right now",
    STAGE_MARKS: '{"interview":{}}', DEMO_AT: day(-2), DOJ: '2026-11-01', OFFER_BREAKDOWN: '{}', EMP_CODE: 'NCM/26/10/120' })]);
  ctx.hiringRevive_(principal, { row: 2, note: 'Now free to join' });
  const r = apps.rows[1];
  ['STATUS', 'REJECT_REASON', 'INTERVIEW_AT', 'MD_INTERVIEW_AT', 'SALARY_OFFER_AT', 'DOJ', 'OFFER_BREAKDOWN', 'STAGE_MARKS', 'DEMO_AT']
    .forEach((k) => assert.strictEqual(r[C[k] - 1], '', k));
  assert.strictEqual(r[C.EMP_CODE - 1], 'NCM/26/10/120'); // a number is never reused
  assert.ok(isDate(r[C.REVIVED_AT - 1]));
  const h = JSON.parse(r[C.HISTORY - 1]);
  assert.strictEqual(h.length, 1); assert.strictEqual(h[0].round, 1);
  assert.strictEqual(h[0].rejectReason, "Doesn't want to join right now"); assert.strictEqual(h[0].revivedBy, 'p@lms.org.in');
});

T('updatehiringstatus Rejected: reason required, written with the note, Notes kept when not sent', () => {
  reset([appRow({ NOTES: 'called twice' })]);
  ctx.hirIsHiringApproved_ = () => false;
  throws(() => ctx.hiringUpdateStatus_(principal, { row: 2, status: 'Rejected' }), /reason/i);
  assert.strictEqual(apps.rows[1][C.STATUS - 1], '');
  ctx.hiringUpdateStatus_(principal, { row: 2, status: 'Rejected', rejectReason: 'Took another offer / withdrew', rejectNote: 'joined DAV' });
  assert.strictEqual(apps.rows[1][C.STATUS - 1], 'Rejected'); assert.strictEqual(apps.rows[1][C.REJECT_REASON - 1], 'Took another offer / withdrew');
  assert.strictEqual(apps.rows[1][C.NOTES - 1], 'called twice | Rejected: joined DAV');
});
