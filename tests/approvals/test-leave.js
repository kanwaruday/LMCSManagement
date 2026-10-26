// Run: node tests/approvals/test-leave.js -- teacher leave in Approvals (approvals-leave.gs + the hooks in approvals.gs):
// the rules (deadline, working days, weights, warnings), the overlap guard, the day-by-day contract other modules read,
// the action's scoping, and aprSubmit_'s wiring against a fake sheet.
const vm = require('vm'), fs = require('fs'), assert = require('assert'), path = require('path');
const T = (name, fn) => { fn(); console.log('ok  -', name); };
const read = (f) => fs.readFileSync(path.join(__dirname, '../../apps-script', f), 'utf8');

// ── a context with the leave file only (pure functions) ──
const ctx = vm.createContext({ console });
vm.runInContext(read('approvals-leave.gs'), ctx);
const run = (code) => vm.runInContext(code, ctx);
const validate = (input, nowIst, holidays) => JSON.parse(JSON.stringify(run('aprLvValidate_')(input, nowIst, holidays || {})));
const at = (iso, hour) => ({ iso, hour });
// 2026-10-26 is a Monday. 2026-11-14 is the 2nd Saturday (Nov 7 is the 1st). 2026-11-01 is a Sunday.
const MON = at('2026-10-26', 6);

T('IST clock: fixed +05:30, no DST', () => {
  const nowIst = run('aprLvNowIst_');
  assert.deepEqual(JSON.parse(JSON.stringify(nowIst(new Date('2026-10-26T01:00:00Z')))), { iso: '2026-10-26', hour: 6 });
  assert.deepEqual(JSON.parse(JSON.stringify(nowIst(new Date('2026-10-26T01:40:00Z')))), { iso: '2026-10-26', hour: 7 });
  assert.equal(nowIst(new Date('2026-10-25T19:00:00Z')).iso, '2026-10-26', '00:30 IST is already tomorrow');
});

T('deadline: future dates and today before 7:00 AM; never later or past', () => {
  assert.equal(validate({ type: 'Casual Leave', from: '2026-10-27' }, MON).ok, true, 'tomorrow');
  assert.equal(validate({ type: 'Casual Leave', from: '2026-10-26' }, MON).ok, true, 'today at 06:xx');
  const late = validate({ type: 'Casual Leave', from: '2026-10-26' }, at('2026-10-26', 7));
  assert.equal(late.ok, false); assert.match(late.error, /can no longer be applied for/);
  assert.equal(validate({ type: 'Casual Leave', from: '2026-10-23' }, MON).ok, false, 'past date');
  assert.equal(validate({ type: 'Casual Leave', from: '2026-10-27' }, at('2026-10-26', 23)).ok, true, 'tomorrow, filed late in the evening');
});

T('type and date checks', () => {
  assert.match(validate({ type: 'Compensatory Leave', from: '2026-10-27' }, MON).error, /Choose a leave type/, 'Compensatory is not on the teacher list');
  assert.match(validate({ type: 'Absent', from: '2026-10-27' }, MON).error, /Choose a leave type/);
  assert.match(validate({ type: 'Casual Leave', from: 'tomorrow' }, MON).error, /valid "from"/);
  assert.match(validate({ type: 'Casual Leave', from: '2026-02-30' }, MON).error, /valid "from"/, 'not a real date');
  assert.match(validate({ type: 'Casual Leave', from: '2026-10-28', to: '2026-10-27' }, MON).error, /before the "from"/);
  assert.match(validate({ type: 'Casual Leave', from: '2026-10-27', to: '2027-03-01' }, MON).error, /at most 92 days/);
});

T('working days skip Sundays, 2nd Saturdays and school holidays', () => {
  // Mon 26 Oct .. Sun 1 Nov: 6 working days (Sunday out)
  let v = validate({ type: 'Casual Leave', from: '2026-10-27', to: '2026-11-02' }, MON); // Tue..Mon
  assert.equal(v.leave.workingDays, 6, 'Tue-Sat + Mon, Sunday out');
  // 2nd Saturday 14 Nov out
  v = validate({ type: 'Casual Leave', from: '2026-11-13', to: '2026-11-16' }, MON); // Fri Sat Sun Mon
  assert.equal(v.leave.workingDays, 2, 'Fri + Mon only');
  // a GH holiday mid-range
  v = validate({ type: 'Casual Leave', from: '2026-10-27', to: '2026-10-29' }, MON, { '2026-10-28': true });
  assert.equal(v.leave.workingDays, 2);
  assert.match(validate({ type: 'Casual Leave', from: '2026-11-01' }, MON).error, /no working days/, 'a lone Sunday');
  assert.match(validate({ type: 'Half Leave', from: '2026-11-14' }, MON).error, /not a working day/, 'half leave on a 2nd Saturday');
});

T('leave days charged per type', () => {
  const d = (type, from, to, now) => validate({ type, from, to }, now || MON).leave;
  assert.equal(d('Casual Leave', '2026-10-27', '2026-10-29').deduction, 3);
  assert.equal(d('Single Leave', '2026-10-27').deduction, 1);
  assert.equal(d('Emergency Leave', '2026-10-27', '2026-10-29').deduction, 0, 'no deduction');
  assert.equal(d('Emergency Leave', '2026-10-27', '2026-10-29').workingDays, 3, 'but the days are still on leave');
  assert.equal(d('Half Leave', '2026-10-27').deduction, 0.5);
  assert.equal(d('Short Leave', '2026-10-27').deduction, 0.33);
  assert.equal(d('Late', '2026-10-27').deduction, 0.25);
});

T('single-day types ignore a "to" date', () => {
  for (const type of ['Half Leave', 'Short Leave', 'Late', 'Special Day Leave']) {
    const l = validate({ type, from: '2026-10-27', to: '2026-10-30' }, MON).leave;
    assert.equal(l.to, '2026-10-27', type); assert.equal(l.workingDays, 1, type);
  }
});

T('Special Day: 2 days with 7+ days notice, else 3; never 5 from the form', () => {
  assert.equal(validate({ type: 'Special Day Leave', from: '2026-11-02' }, MON).leave.deduction, 2, '7 days ahead');
  assert.equal(validate({ type: 'Special Day Leave', from: '2026-11-02' }, MON).leave.noticeDays, 7);
  assert.equal(validate({ type: 'Special Day Leave', from: '2026-11-01' }, MON).ok, false, 'a Sunday');
  assert.equal(validate({ type: 'Special Day Leave', from: '2026-10-30' }, MON).leave.deduction, 3, '4 days ahead');
  assert.equal(validate({ type: 'Special Day Leave', from: '2026-10-26' }, MON).leave.deduction, 3, 'same day before 7:00 AM');
});

T('warnings: Long Leave over 6 working days, sandwich for Single Leave', () => {
  const long = validate({ type: 'Casual Leave', from: '2026-10-27', to: '2026-11-05' }, MON); // Tue 27 Oct .. Thu 5 Nov = 9 working days (Sunday 1 Nov out)
  assert.equal(long.leave.workingDays, 9);
  assert.ok(long.warnings.some((w) => /Long Leave/.test(w)));
  assert.equal(validate({ type: 'Casual Leave', from: '2026-10-27', to: '2026-11-02' }, MON).warnings.length, 0, '6 days is not Long Leave');
  const sand = validate({ type: 'Single Leave', from: '2026-10-30' }, MON); // Friday: Saturday 31 is a working Saturday (1st-ish), Sunday 1 follows the Saturday
  assert.equal(sand.warnings.length, 0, 'Saturday 31 Oct is a working day, so no sandwich');
  const sand2 = validate({ type: 'Single Leave', from: '2026-10-31' }, MON); // Saturday: next day Sunday
  assert.ok(sand2.warnings.some((w) => /Sandwich/.test(w)));
  assert.equal(validate({ type: 'Casual Leave', from: '2026-10-31' }, MON).warnings.length, 0, 'sandwich note is for Single Leave');
});

// ── overlap guard and the contract, over fake Approvals rows ──
const COL = run('APR_LV_COL');
function row(o) {
  const r = new Array(32).fill('');
  r[0] = o.id; r[1] = o.campus || 'LMS4'; r[2] = o.category || 'Leave'; r[4] = o.title || 't'; r[11] = o.email || 'asha@lms.org.in';
  r[13] = o.status || 'Approved';
  if (o.type) { r[COL.TYPE] = o.type; r[COL.FROM] = o.from; r[COL.TO] = o.to || o.from; }
  return r;
}
const HEADER = new Array(32).fill('h');
const rows = (...rs) => [HEADER, ...rs];

T('overlap guard', () => {
  const find = (values, leave) => { const r = run('aprLvFindOverlap_')(values, 'asha@lms.org.in', leave); return r && JSON.parse(JSON.stringify(r)); };
  const existing = rows(row({ id: 'a1', type: 'Casual Leave', from: '2026-10-28', to: '2026-10-30', status: 'Pending' }));
  assert.equal(find(existing, { type: 'Casual Leave', from: '2026-11-02', to: '2026-11-03' }), null, 'different dates');
  assert.deepEqual(find(existing, { type: 'Single Leave', from: '2026-10-30', to: '2026-10-31' }), { id: 'a1', status: 'Pending', same: false }, 'one shared day');
  assert.equal(find(existing, { type: 'Casual Leave', from: '2026-10-28', to: '2026-10-30' }).same, true, 'identical repeat');
  assert.equal(find(rows(row({ id: 'a2', type: 'Casual Leave', from: '2026-10-28', status: 'Rejected' })), { type: 'Casual Leave', from: '2026-10-28', to: '2026-10-28' }), null, 'rejected does not block');
  assert.equal(find(rows(row({ id: 'a3', type: 'Casual Leave', from: '2026-10-28', status: 'Revoked' })), { type: 'Casual Leave', from: '2026-10-28', to: '2026-10-28' }), null, 'revoked does not block');
  assert.equal(run('aprLvFindOverlap_')(existing, 'someone.else@lms.org.in', { type: 'Casual Leave', from: '2026-10-28', to: '2026-10-28' }), null, "another teacher's leave is no clash");
  assert.equal(find(rows(row({ id: 'a4', category: 'Other', type: '', status: 'Pending' })), { type: 'Casual Leave', from: '2026-10-28', to: '2026-10-28' }), null, 'non-leave rows ignored');
});

T('contract: one entry per working day, Approved only, excused and fraction set, Late never returned', () => {
  const values = rows(
    row({ id: 'c1', type: 'Casual Leave', from: '2026-10-29', to: '2026-11-03' }),          // Thu..Tue: Sunday 1 Nov out -> 5 days
    row({ id: 'h1', type: 'Half Leave', from: '2026-10-27' }),
    row({ id: 's1', type: 'Short Leave', from: '2026-10-28' }),
    row({ id: 'l1', type: 'Late', from: '2026-10-27' }),
    row({ id: 'p1', type: 'Casual Leave', from: '2026-10-27', status: 'Pending' }),
    row({ id: 'r1', type: 'Casual Leave', from: '2026-10-27', status: 'Revoked' }),
    row({ id: 'x1', type: 'Casual Leave', from: '2026-10-27', status: 'Rejected' }),
    row({ id: 'o1', type: 'Single Leave', from: '2026-10-27', email: 'other@lms.org.in', campus: 'LMS2' }),
  );
  const days = run('aprLvApprovedDays_')(values, { from: '2026-10-01', to: '2026-12-31' }, () => ({}));
  const mine = days.filter((d) => d.email === 'asha@lms.org.in');
  assert.deepEqual(mine.map((d) => d.date), ['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-02', '2026-11-03']);
  assert.equal(mine[0].type, 'Half Leave'); assert.equal(mine[0].fraction, 0.5); assert.equal(mine[0].excused, true, 'half day excuses the whole day');
  assert.equal(mine[1].type, 'Short Leave'); assert.equal(mine[1].fraction, 0.33); assert.equal(mine[1].excused, false, 'short leave does not');
  assert.equal(mine[2].excused, true); assert.equal(mine[2].fraction, 1); assert.equal(mine[2].approvalId, 'c1');
  assert.ok(!days.some((d) => d.type === 'Late'), 'Late is never a leave day');
  assert.ok(!days.some((d) => ['p1', 'r1', 'x1'].includes(d.approvalId)), 'only Approved');
  assert.equal(days.filter((d) => d.email === 'other@lms.org.in').length, 1);
});

T('contract: window clipping, filters and holidays', () => {
  const values = rows(row({ id: 'c1', type: 'Casual Leave', from: '2026-10-29', to: '2026-11-03' }), row({ id: 'o1', type: 'Single Leave', from: '2026-10-27', email: 'other@lms.org.in', campus: 'LMS2' }));
  const A = run('aprLvApprovedDays_');
  assert.deepEqual(A(values, { from: '2026-10-30', to: '2026-10-31', email: 'asha@lms.org.in' }, () => ({})).map((d) => d.date), ['2026-10-30', '2026-10-31'], 'clipped to the window');
  assert.equal(A(values, { from: '2026-12-01', to: '2026-12-31' }, () => ({})).length, 0, 'outside the window');
  assert.equal(A(values, { from: '2026-10-01', to: '2026-12-31', campusId: 'LMS2' }, () => ({})).length, 1, 'campus filter');
  assert.equal(A(values, { from: '2026-10-01', to: '2026-12-31', email: 'OTHER@lms.org.in' }, () => ({})).length, 1, 'email filter is case-insensitive');
  assert.equal(A(values, { from: '2026-10-29', to: '2026-11-03', email: 'asha@lms.org.in' }, () => ({ '2026-10-30': true })).length, 4, 'a school holiday inside the leave is not a leave day');
});

T('a date cell Sheets turned into a Date still reads back', () => {
  const r = row({ id: 'c1', type: 'Casual Leave', from: '2026-10-29', to: '2026-10-30' });
  r[COL.FROM] = new Date('2026-10-28T18:30:00Z'); // midnight IST of 29 Oct
  r[COL.TO] = new Date('2026-10-29T18:30:00Z');
  const lv = JSON.parse(JSON.stringify(run('aprLvRowLeave_')(r)));
  assert.equal(lv.from, '2026-10-29'); assert.equal(lv.to, '2026-10-30');
});

// ── the action's scoping and aprSubmit_'s wiring, with Apps Script globals faked ──
function world(opts) {
  const sheetRows = [HEADER.slice(), ...(opts.rows || [])];
  const written = { appended: [], leave: null, headers: false };
  const sheet = {
    appendRow: (r) => { sheetRows.push(r); written.appended.push(r); },
    getLastRow: () => sheetRows.length,
  };
  const w = vm.createContext({
    console, LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    APR_STATUS: { PENDING: 'Pending', INFO_REQUESTED: 'Info Requested' },
    pdrIsTeacherOnly_: (c) => !!c.teacherOnly, callerHasRole_: (c, r) => (c.roles || []).includes(r),
    aprValues_: () => sheetRows, aprSheet_: () => sheet, aprNotifyDeciders_() {},
    pdrSchoolCalendarEvents_: () => [], pdrFormatISO_: () => '', tpAuthEmailToCode_: () => ({ 'asha@lms.org.in': 'KUL/1' }),
    APR_AMOUNT_CATEGORIES: [], APR_ITEM_CATEGORIES: [], APR_ITEM_QTY_CATEGORIES: [],
  });
  vm.runInContext(read('approvals-leave.gs'), w);
  // aprSubmit_ and aprAppendRequest_ come from approvals.gs; take just those two functions
  const src = read('approvals.gs');
  const grab = (name) => { const i = src.indexOf('function ' + name + '('); let d = 0, j = src.indexOf('{', i), e; for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}') { d--; if (!d) { e = k; break; } } } return src.slice(i, e + 1); };
  vm.runInContext(['aprSubmit_', 'aprAppendRequest_'].map(grab).join('\n') + '\nvar APR_CATEGORIES = ["Leave","Other"]; var APR_TEACHER_CATEGORIES = ["Leave","Other"];', w);
  // the sheet needs getRange for aprLvWrite_
  sheet.getRange = (r, c, nr, nc) => ({
    getValue: () => (r === 1 ? (written.headers ? 'leaveType' : '') : ''), setValues: (v) => { if (r === 1) written.headers = true; else { written.leave = v[0]; v[0].forEach((x, j) => { sheetRows[r - 1][c - 1 + j] = x; }); } }, // persist, so the overlap guard can read it back
    setNumberFormat: () => {},
  });
  return { w, sheetRows, written, call: (code) => vm.runInContext(code, w) };
}
const teacher = { email: 'asha@lms.org.in', campusId: 'LMS4', roles: ['Teacher'], teacherOnly: true };
const submit = (W, caller, body) => JSON.parse(JSON.stringify(W.call('aprSubmit_')(caller, body)));
const tomorrow = () => { const d = new Date(Date.now() + 330 * 60000 + 86400000); return d.toISOString().slice(0, 10); };
// a working day well ahead, whatever today is: the next Tuesday that is not a 2nd Saturday/Sunday (Tuesdays never are)
const nextTuesday = () => { let d = new Date(Date.now() + 330 * 60000 + 86400000 * 3); while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

T('submit: files a leave with generated title, writes the leave columns, stays Pending', () => {
  const W = world({}); const day = nextTuesday();
  const r = submit(W, teacher, { category: 'Leave', leaveType: 'Casual Leave', fromDate: day, toDate: day, description: 'Family function' });
  assert.equal(r.success, true, JSON.stringify(r)); assert.ok(r.id);
  assert.equal(W.written.appended.length, 1);
  const row = W.written.appended[0];
  assert.equal(row[2], 'Leave'); assert.equal(row[1], 'LMS4'); assert.equal(row[11], 'asha@lms.org.in'); assert.equal(row[13], 'Pending');
  assert.equal(row[4], 'Casual Leave — ' + day, 'title is generated');
  assert.deepEqual(W.written.leave.slice(0, 3), ['Casual Leave', day, day]);
  assert.equal(W.written.leave[4], 1, 'one working day'); assert.equal(W.written.leave[5], 1, 'one leave day charged');
});

T('submit: refused for a past date, a non-teacher, a bad type; leave needs a reason', () => {
  const W = world({});
  assert.match(submit(W, teacher, { category: 'Leave', leaveType: 'Casual Leave', fromDate: '2020-01-07', description: 'x' }).error, /can no longer be applied for/);
  assert.match(submit(W, { email: 'p@lms.org.in', campusId: 'LMS4', roles: ['Principal'] }, { category: 'Leave', leaveType: 'Casual Leave', fromDate: nextTuesday(), description: 'x' }).error, /filed by teachers/);
  assert.match(submit(W, teacher, { category: 'Leave', leaveType: 'Holiday', fromDate: nextTuesday(), description: 'x' }).error, /Choose a leave type/);
  assert.match(submit(W, teacher, { category: 'Leave', leaveType: 'Casual Leave', fromDate: nextTuesday(), description: '' }).error, /Description required/);
  assert.equal(W.written.appended.length, 0, 'nothing was written');
});

T('submit: a double click is a no-op; an overlapping different request is refused', () => {
  const W = world({}); const day = nextTuesday();
  const body = { category: 'Leave', leaveType: 'Casual Leave', fromDate: day, toDate: day, description: 'Family function' };
  const first = submit(W, teacher, body);
  const again = submit(W, teacher, body);
  assert.equal(again.success, true); assert.equal(again.duplicate, true); assert.equal(again.id, first.id);
  assert.equal(W.written.appended.length, 1, 'still one row');
  const other = submit(W, teacher, { category: 'Leave', leaveType: 'Single Leave', fromDate: day, toDate: day, description: 'Different reason' });
  assert.equal(other.success, false); assert.match(other.error, /already have a leave request/);
});

T('action approvedleave: teacher sees only their own, principal their campus', () => {
  const day = nextTuesday();
  const rowsFor = [row({ id: 'm1', type: 'Casual Leave', from: day }), row({ id: 'o1', type: 'Casual Leave', from: day, email: 'other@lms.org.in', campus: 'LMS2' })];
  const W = world({ rows: rowsFor });
  const act = (caller, params) => JSON.parse(JSON.stringify(W.call('aprLvApprovedLeaveAction_')(caller, params)));
  const q = { from: day, to: day };
  let r = act(teacher, q);
  assert.deepEqual(r.days.map((d) => d.approvalId), ['m1']); assert.equal(r.days[0].employeeCode, 'KUL/1');
  assert.equal(act(teacher, { ...q, email: 'other@lms.org.in' }).success, false, "a teacher cannot ask for someone else's");
  assert.deepEqual(act({ email: 'p@lms.org.in', campusId: 'LMS2', roles: ['Principal'] }, q).days.map((d) => d.approvalId), ['o1'], 'principal: own campus only');
  assert.equal(act({ email: 'p@lms.org.in', campusId: 'LMS2', roles: ['Principal'] }, { ...q, campusId: 'LMS4' }).success, false);
  assert.equal(act({ email: 'o@lms.org.in', campusId: 'ALL', roles: ['Owner'] }, q).days.length, 2, 'owner: everyone');
  assert.equal(act(teacher, { from: day, to: '2020-01-01' }).success, false, 'bad window');
});

console.log('all approvals leave tests passed');
