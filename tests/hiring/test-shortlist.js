// Run: node tests/hiring/test-shortlist.js -- the Shortlisted rung and hiringShortlist_.
const vm = require('vm'), fs = require('fs'), assert = require('assert'), path = require('path');
const ctx = vm.createContext({
  console, Logger: { log() {} }, Session: { getScriptTimeZone: () => 'Asia/Kolkata' },
  Utilities: { formatDate: () => '2026-10-22' }, APR_STATUS: { APPROVED: 'Approved', REJECTED: 'Rejected' },
  LockService: { getScriptLock: () => ({ waitLock() { ctx.__locked = true; }, tryLock: () => true, releaseLock() { ctx.__locked = false; } }) },
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../apps-script/hiring.gs'), 'utf8'), ctx);
const C = vm.runInContext('HIR_COL', ctx);
const T = (name, fn) => { fn(); console.log('ok  -', name); };
const throws = (fn, re) => assert.throws(fn, (e) => re.test(e.message), String(re));

function sheet(rows) {
  let maxCols = 25;
  return {
    rows, getLastRow: () => rows.length, getMaxColumns: () => maxCols, insertColumnsAfter(n, k) { maxCols += k; },
    getDataRange: () => ({ getValues: () => rows.map((r) => r.slice()) }),
    getRange(r, c) {
      const rng = {
        getValue: () => ((rows[r - 1] || [])[c - 1] === undefined ? '' : rows[r - 1][c - 1]),
        setValue(v) { while (rows.length < r) rows.push([]); rows[r - 1][c - 1] = v; return rng; },
      };
      return rng;
    },
  };
}
const day = (n) => new Date(Date.UTC(2026, 9, 22 + n, 5, 0));
function appRow(o) {
  const r = new Array(25).fill('');
  r[C.TIMESTAMP - 1] = day(-10); r[C.NAME - 1] = o.name || 'Asha'; r[C.PHONE - 1] = o.phone || '9876543210';
  r[C.SUBJECTS - 1] = 'Sanskrit'; r[C.BRANCHES - 1] = 'LMS-4';
  Object.keys(o).forEach((k) => { if (C[k] !== undefined) r[C[k] - 1] = o[k]; });
  return r;
}
let apps, lockedDuringList;
function reset(rows) {
  apps = sheet([['Timestamp']].concat(rows));
  ctx.hirSheet_ = () => apps;
  ctx.hirSalaryOfferDecisions_ = () => ({});
  ctx.hiringApplicants_ = () => { lockedDuringList = ctx.__locked; return { success: true, applicants: [] }; };
}
const principal = { email: 'p@lms.org.in', campusId: 'LMS4', roles: ['Principal'] };
const clerk = { email: 'c@lms.org.in', campusId: 'LMS4', roles: ['FeeClerk'] };
function build(rows) {
  return ctx.hirBuildApplicants_([['h']].concat(rows), { requisitions: {}, visibleCampuses: ['LMS4'], irRows: [['h']],
    portalInterviews: [], portalDemos: [], decisions: {}, nowMs: day(0).getTime() });
}

T('columns 26-27', () => { assert.strictEqual(C.SHORTLISTED_AT, 26); assert.strictEqual(C.SHORTLISTED_BY, 27); });
T('shortlisted, no date -> Shortlisted; visible with no requisition match', () => {
  const list = build([appRow({ SHORTLISTED_AT: day(-1), SHORTLISTED_BY: 'p@lms.org.in' })]);
  assert.strictEqual(list.length, 1); assert.strictEqual(list[0].status, 'Shortlisted');
  assert.strictEqual(list[0].noOpenRole, true); assert.ok(list[0].shortlistedAt); assert.strictEqual(list[0].shortlistedBy, 'p@lms.org.in');
});
T('shortlisted plus a date -> Interview Scheduled', () => {
  const list = build([appRow({ SHORTLISTED_AT: day(-1), INTERVIEW_AT: day(1) })]);
  assert.strictEqual(list[0].status, 'Interview Scheduled');
});
T('shortlist on writes stamp, headers; off clears; list built after the lock', () => {
  reset([appRow({})]);
  const res = ctx.hiringShortlist_(principal, { row: 2, on: true });
  assert.strictEqual(res.success, true); assert.strictEqual(lockedDuringList, false);
  assert.ok(apps.rows[1][C.SHORTLISTED_AT - 1]); assert.strictEqual(apps.rows[1][C.SHORTLISTED_BY - 1], 'p@lms.org.in');
  assert.strictEqual(apps.rows[0][C.SHORTLISTED_AT - 1], 'Shortlisted At'); assert.strictEqual(apps.rows[0][C.SHORTLISTED_BY - 1], 'Shortlisted By');
  ctx.hiringShortlist_(principal, { row: 2, on: false });
  assert.strictEqual(apps.rows[1][C.SHORTLISTED_AT - 1], ''); assert.strictEqual(apps.rows[1][C.SHORTLISTED_BY - 1], '');
});
T('a Fee Clerk cannot shortlist', () => {
  reset([appRow({})]);
  throws(() => ctx.hiringShortlist_(clerk, { row: 2, on: true }), /Principal/);
});
T('revive clears 26-27 on both rows of a same-phone pair', () => {
  reset([appRow({ STATUS: 'Rejected', SHORTLISTED_AT: day(-2), SHORTLISTED_BY: 'p@lms.org.in' }),
    appRow({ STATUS: 'Rejected', SHORTLISTED_AT: day(-2), SHORTLISTED_BY: 'p@lms.org.in' })]);
  ctx.hiringRevive_(principal, { row: 2, note: 'back' });
  [1, 2].forEach((i) => { assert.strictEqual(apps.rows[i][C.SHORTLISTED_AT - 1], ''); assert.strictEqual(apps.rows[i][C.SHORTLISTED_BY - 1], ''); });
});
