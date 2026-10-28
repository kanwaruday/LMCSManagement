// Tests for the unified "SS Submissions"/"SS Rubrics" schema (2026-10-28
// migration off the per-role Google Forms) -- ssFormMeta_/ssSubmit_ in
// ss-forms-sync.gs, and ss-tracker.gs's old+new merge. Fake data only.
'use strict';
const assert = require('assert');
const { boot } = require('./harness');

const EMP_SHEET = '1OjVMUvpLM8JkdAwjmljCtZUI1VUqGLbic36cW9dm0C0'; // LMCSStaffMasters
const SUBMISSIONS_SHEET = '1cP-f8ShSJJPMBXkQCfkSvmajPA1db6fMBOPCbLH3oIc'; // same workbook as itComputer's OLD tab

const EMP_MASTER = [
  ['EmployeeCode', 'Name', 'Status'],
  ['KUL/1', 'Rina Gupta', 'Active'],   // LMS1, matches itComputer
  ['KEL/1', 'Sanjay Rao', 'Active'],   // LMS2, matches itComputer
  ['KUL/2', 'Old Clerk', 'Active'],    // LMS1, does NOT match itComputer (wrong department)
];
const EMP_SALARY = [
  ['EmployeeCode', 'Department'],
  ['KUL/1', 'AdminIT'],
  ['KEL/1', 'AdminIT'],
  ['KUL/2', 'AdminClerk'],
];
const ALLOWLIST = [
  ['Email', 'Name', 'CampusId', 'Role', 'CanApprove'],
  ['owner@example.org', 'Owner', 'ALL', 'Owner', 'TRUE'],
  ['principal2@example.org', 'LMS2 Principal', 'LMS2', 'Principal', ''],
];
const TOKENS = {
  'owner-token': { email: 'owner@example.org' },
  'p2-token': { email: 'principal2@example.org' },
};

const OLD_ITSS_HEADER = ['Timestamp', 'Email Address', 'Computer Teacher Name', 'Pedagogy',
  'Teacher Content & Student Response', 'Aerobics, Morning Assembly & Dispersal Duty',
  'Period Adjustment & Quality of Time Table', 'Administrative Duties & Data Collection',
  'IT Support to Principal & Staff', 'Computer Lab Operational', 'CCTV Functionality',
  'Social Media', 'Attitude Towards LMS'];
// One OLD-style submission, pre-dating the migration -- Rina Gupta, flat 6/10 x 10 = 60.
const OLD_ITSS_ROW = [new Date('2026-08-01T10:00:00Z'), 'avantikasinghkanwar@lms.org.in', 'KUL/1 Rina Gupta',
  6, 6, 6, 6, 6, 6, 6, 6, 6, 6];

function env() {
  return boot({
    books: {
      [EMP_SHEET]: { EmpMaster: EMP_MASTER, EmpSalary: EMP_SALARY },
      [SUBMISSIONS_SHEET]: { 'LMCS Computer Teacher SS': [OLD_ITSS_HEADER, OLD_ITSS_ROW] },
    },
    allowlistRows: ALLOWLIST,
    tokens: TOKENS,
  });
}

// ── ssformmeta ───────────────────────────────────────────────────────

(function employeesAreKeyedByEmployeeIdAndNarrowedToSchool() {
  const { get } = env();
  const res = get('ssformmeta', { role: 'itComputer', school: 'LMS1', idToken: 'owner-token' });
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.rubricVersion, 1);
  assert.strictEqual(res.rubricTitles.length, 10);
  // Only KUL/1 (LMS1, AdminIT) -- not KEL/1 (wrong school) or KUL/2 (wrong department).
  assert.deepStrictEqual(res.employees.map((e) => e.employeeId), ['KUL/1']);
  assert.strictEqual(res.employees[0].name, 'Rina Gupta');
})();

(function aPrincipalCannotReadAnotherCampus() {
  const { get } = env();
  const res = get('ssformmeta', { role: 'itComputer', school: 'LMS1', idToken: 'p2-token' }); // principal2 is LMS2
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.error, 'Not authorized for that campus');
})();

// ── submitss ─────────────────────────────────────────────────────────

(function aValidSubmissionWritesOneCleanRowAndOneRubricHistoryRow() {
  const { post, books } = env();
  const res = post('submitss', {
    role: 'itComputer', school: 'LMS1', employeeId: 'KUL/1',
    scores: [8, 7, 6, 7, 8, 7, 7, 5, 7, 6],
    idToken: 'owner-token',
  });
  assert.strictEqual(res.success, true, JSON.stringify(res));

  const sub = books[SUBMISSIONS_SHEET].tabs['SS Submissions'].values;
  assert.strictEqual(sub.length, 2); // header + 1
  const [, employeeId, campusId, evaluatorEmail, role, rubricVersion, ...scores] = sub[1];
  assert.strictEqual(employeeId, 'KUL/1');
  assert.strictEqual(campusId, 'LMS1');
  assert.strictEqual(evaluatorEmail, 'owner@example.org'); // the VERIFIED caller, not client-supplied
  assert.strictEqual(role, 'itComputer');
  assert.strictEqual(rubricVersion, 1);
  assert.deepStrictEqual(scores, [8, 7, 6, 7, 8, 7, 7, 5, 7, 6]);

  const rubrics = books[SUBMISSIONS_SHEET].tabs['SS Rubrics'].values;
  assert.strictEqual(rubrics.length, 2); // header + exactly one (role, version) row
  assert.strictEqual(rubrics[1][0], 'itComputer');
  assert.strictEqual(rubrics[1][1], 1);
  assert.strictEqual(rubrics[1][3], 'Pedagogy'); // Title1
})();

(function aSecondSubmissionDoesNotDuplicateTheRubricHistoryRow() {
  const { post, books } = env();
  post('submitss', { role: 'itComputer', school: 'LMS1', employeeId: 'KUL/1', scores: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5], idToken: 'owner-token' });
  post('submitss', { role: 'itComputer', school: 'LMS1', employeeId: 'KUL/1', scores: [6, 6, 6, 6, 6, 6, 6, 6, 6, 6], idToken: 'owner-token' });
  const sub = books[SUBMISSIONS_SHEET].tabs['SS Submissions'].values;
  const rubrics = books[SUBMISSIONS_SHEET].tabs['SS Rubrics'].values;
  assert.strictEqual(sub.length, 3); // header + 2 submissions
  assert.strictEqual(rubrics.length, 2); // header + still just 1 version row
})();

(function anEmployeeIdNotInTheCurrentRosterIsRejected() {
  const { post } = env();
  const res = post('submitss', { role: 'itComputer', school: 'LMS1', employeeId: 'KUL/999', scores: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5], idToken: 'owner-token' });
  assert.strictEqual(res.success, false);
  assert.match(res.error, /not a current choice/i);
})();

(function anEmployeeFromTheWrongDepartmentIsRejected() {
  const { post } = env(); // KUL/2 exists on EmpMaster, but is AdminClerk, not AdminIT
  const res = post('submitss', { role: 'itComputer', school: 'LMS1', employeeId: 'KUL/2', scores: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5], idToken: 'owner-token' });
  assert.strictEqual(res.success, false);
})();

(function aScoreOutOfRangeIsRejected() {
  const { post } = env();
  const res = post('submitss', { role: 'itComputer', school: 'LMS1', employeeId: 'KUL/1', scores: [11, 5, 5, 5, 5, 5, 5, 5, 5, 5], idToken: 'owner-token' });
  assert.strictEqual(res.success, false);
  assert.match(res.error, /must be 0-10/);
})();

(function aPrincipalCannotSubmitForAnotherCampus() {
  const { post } = env();
  const res = post('submitss', { role: 'itComputer', school: 'LMS1', employeeId: 'KUL/1', scores: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5], idToken: 'p2-token' });
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.error, 'Not authorized for that campus');
})();

// ── ss-tracker.gs: old + new history stay continuous ─────────────────

(function dashboardMergesOldTabAndNewUnifiedTabForTheSameEmployee() {
  const { post, get } = env();
  post('submitss', { role: 'itComputer', school: 'LMS1', employeeId: 'KUL/1', scores: [9, 9, 9, 9, 9, 9, 9, 9, 9, 9], idToken: 'owner-token' }); // total 90
  const dash = get('ssdashboard', { idToken: 'owner-token' });
  assert.strictEqual(dash.success, true);
  const rina = dash.roles.itComputer.roster.find((r) => r.employee === 'KUL/1 Rina Gupta');
  assert.ok(rina, 'Rina Gupta should appear in the itComputer roster');
  // 1 old-tab row (total 60) + 1 new-tab row (total 90) -- both counted, newest first.
  assert.strictEqual(rina.history.length, 2);
  assert.strictEqual(rina.history[0].total, 90); // newest first
  assert.strictEqual(rina.history[1].total, 60);
})();

console.log('all ss-submissions tests passed');
