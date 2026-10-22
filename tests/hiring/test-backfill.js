// Run: TZ=Asia/Kolkata node tests/hiring/test-backfill.js -- the one-off migration of old date-column bookings.
const vm = require('vm'), fs = require('fs'), assert = require('assert'), path = require('path');
let held = false, logs = [];
const ctx = vm.createContext({
  console, Logger: { log(m) { logs.push(String(m)); } }, Session: { getScriptTimeZone: () => 'Asia/Kolkata' },
  Utilities: { formatDate: () => '2026-10-22' }, APR_STATUS: { APPROVED: 'Approved', REJECTED: 'Rejected' },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
  LockService: { getScriptLock: () => ({
    waitLock() { if (held) throw new Error('lock taken while held (nested lock)'); held = true; },
    tryLock() { if (held) throw new Error('nested lock'); held = true; return true; },
    releaseLock() { held = false; } }) },
});
['hiring.gs', 'hiring-appointments.gs'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '../../apps-script', f), 'utf8'), ctx));
const C = vm.runInContext('HIR_COL', ctx);
const T = (name, fn) => { held = false; fn(); assert.strictEqual(held, false, 'lock left held'); console.log('ok  -', name); };
function sheet(rows) {
  let maxCols = Math.max(25, ...rows.map((r) => r.length));
  return {
    rows, getLastRow: () => rows.length, getMaxColumns: () => maxCols, insertColumnsAfter(n, k) { maxCols += k; },
    appendRow(r) { rows.push(r.slice()); },
    getDataRange: () => ({ getValues: () => rows.map((r) => r.slice()) }),
    getRange(r, c) {
      if (c > maxCols) throw new Error('outside the dimensions of the sheet');
      const rng = {
        getValue: () => ((rows[r - 1] || [])[c - 1] === undefined ? '' : rows[r - 1][c - 1]),
        setValue(v) { while (rows.length < r) rows.push([]); rows[r - 1][c - 1] = v; return rng; },
        setValues(vals) { vals.forEach((vr, i) => vr.forEach((v, j) => { while (rows.length < r + i) rows.push([]); rows[r - 1 + i][c - 1 + j] = v; })); return rng; },
      };
      return rng;
    },
  };
}
const NOW = Date.UTC(2026, 9, 23, 5, 0), FUT = new Date(Date.UTC(2030, 0, 10, 5, 0)), PAST = new Date(Date.UTC(2020, 0, 10, 5, 0));
function appRow(o) {
  const r = new Array(25).fill('');
  r[C.TIMESTAMP - 1] = new Date(NOW - 864e6); r[C.NAME - 1] = o.name || 'Asha'; r[C.PHONE - 1] = o.phone || '9876543210';
  r[C.SUBJECTS - 1] = 'English'; r[C.BRANCHES - 1] = o.branches || 'LMS-5, LMS-4';
  Object.keys(o).forEach((k) => { if (C[k] !== undefined) r[C[k] - 1] = o[k]; });
  return r;
}
let apps, tabs;
function reset(rows) {
  apps = sheet([['Timestamp']].concat(rows)); tabs = {};
  ctx.hirSheet_ = () => apps; ctx.hirIrSheet_ = () => sheet([['h']]);
  ctx.hirWorkbook_ = () => ({ getSheetByName: (n) => tabs[n] || null, insertSheet: (n) => (tabs[n] = sheet([])) });
  ctx.hirPortalReports_ = () => []; ctx.hirSalaryOfferDecisions_ = () => ({});
}
const appts = () => ctx.apptAll_();

T('future interview, demo and md -> three accepted migration appointments with defaults', () => {
  reset([appRow({ INTERVIEW_AT: FUT, DEMO_AT: FUT, MD_INTERVIEW_AT: FUT })]);
  const res = ctx.apptBackfill_(NOW);
  assert.deepStrictEqual([res.created, res.shortlisted], [3, 1]);
  const a = appts(), by = (k) => a.filter((x) => x.kind === k)[0];
  assert.strictEqual(a.length, 3);
  a.forEach((x) => { assert.strictEqual(x.status, 'accepted'); assert.strictEqual(x.decidedBy, 'migration'); assert.strictEqual(x.proposedBy, 'migration');
    assert.strictEqual(x.calendarMode, 'none'); assert.strictEqual(x.campus, 'LMS5'); assert.strictEqual(x.row, 2); assert.strictEqual(x.start.getTime(), FUT.getTime()); });
  assert.deepStrictEqual([by('interview').durationMin, by('demo').durationMin, by('md').durationMin], [30, 45, 30]);
  assert.deepStrictEqual([by('interview').acceptorRole, by('md').acceptorRole], ['Principal', 'Owner']);
});
T('a past date -> no appointment', () => {
  reset([appRow({ INTERVIEW_AT: PAST })]);
  assert.strictEqual(ctx.apptBackfill_(NOW).created, 0); assert.strictEqual(appts().length, 0);
});
T('a rerun creates nothing; the shortlist is stamped once', () => {
  reset([appRow({ INTERVIEW_AT: FUT })]);
  assert.strictEqual(ctx.apptBackfill_(NOW).created, 1);
  const stamp = apps.rows[1][C.SHORTLISTED_AT - 1];
  assert.ok(stamp); assert.strictEqual(apps.rows[1][C.SHORTLISTED_BY - 1], 'migration');
  const again = ctx.apptBackfill_(NOW + 1000);
  assert.deepStrictEqual([again.created, again.shortlisted], [0, 0]);
  assert.strictEqual(apps.rows[1][C.SHORTLISTED_AT - 1], stamp); assert.strictEqual(appts().length, 1);
});
T('a past interview still at Interview Scheduled gets the stamp, not an appointment; Rejected and Shortlisted rows are left', () => {
  reset([appRow({ INTERVIEW_AT: PAST, phone: '9000000001' }), appRow({ INTERVIEW_AT: FUT, STATUS: 'Rejected', phone: '9000000002' }), appRow({ phone: '9000000003' })]);
  const res = ctx.apptBackfill_(NOW);
  assert.strictEqual(res.shortlisted, 1); assert.ok(apps.rows[1][C.SHORTLISTED_AT - 1]);
  assert.strictEqual(apps.rows[2][C.SHORTLISTED_AT - 1] || '', ''); assert.strictEqual(apps.rows[3][C.SHORTLISTED_AT - 1] || '', '');
});
T('an existing accepted appointment of that kind (by phone) blocks a duplicate', () => {
  reset([appRow({ INTERVIEW_AT: FUT, SHORTLISTED_AT: PAST })]);
  ctx.apptBackfill_(NOW); const n = appts().length;
  apps.rows[1][C.INTERVIEW_AT - 1] = new Date(FUT.getTime() + 864e5);
  assert.strictEqual(ctx.apptBackfill_(NOW).created, 0); assert.strictEqual(appts().length, n);
});
T('apptBackfillRun takes the lock once (no nested lock) and logs', () => {
  reset([appRow({ INTERVIEW_AT: new Date(Date.now() + 864e5) })]);
  const res = ctx.apptBackfillRun();
  assert.strictEqual(res.created, 1); assert.ok(logs.some((l) => /apptBackfill/.test(l)));
});
