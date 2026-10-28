// Tests for the unified "SS Submissions"/"SS Rubrics" schema (2026-10-28
// migration off the per-role Google Forms) -- ssFormMeta_/ssSubmit_ in
// ss-forms-sync.gs, and ss-tracker.gs's old+new merge. Fake data only.
'use strict';
const assert = require('assert');
const vm = require('vm');
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
const OLD_ITSS_ROW = [new Date('2026-08-01T10:00:00Z'), 'principal1@example.org', 'KUL/1 Rina Gupta',
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
  assert.match(res.error, /must be a number 0-10/);
})();

(function aPrincipalCannotSubmitForAnotherCampus() {
  const { post } = env();
  const res = post('submitss', { role: 'itComputer', school: 'LMS1', employeeId: 'KUL/1', scores: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5], idToken: 'p2-token' });
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.error, 'Not authorized for that campus');
})();

// Regression for a real bypass found by code review 2026-10-28: itComputer
// (and pti/feeClerkPRO) share ONE form across every campus, so school
// isn't implied by the role the way it is for a perCampus role -- an
// EARLIER version of ssSubmit_ only checked campus authorization inside
// ssFormMeta_, which skips that check entirely (`&& school`) when school
// is simply missing from the request. A probe confirmed an LMS2 Principal
// could post {role:'itComputer', employeeId} with NO school and get
// success:true, with CampusId written as ''. Even an Owner (ALL access,
// no "wrong campus" to check against) must still supply a real one --
// "no school" must never mean "any school".
(function missingSchoolIsRejectedEvenWithoutACrossCampusCheckToTrigger() {
  const { post, books } = env();
  const res = post('submitss', { role: 'itComputer', employeeId: 'KUL/1', scores: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5], idToken: 'owner-token' });
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.error, 'Missing/unknown school');
  const sub = books[SUBMISSIONS_SHEET].tabs['SS Submissions'];
  assert.ok(!sub || sub.values.length <= 1, 'nothing was written');
})();
(function missingSchoolIsRejectedForAScopedPrincipalToo() {
  const { post } = env();
  const res = post('submitss', { role: 'itComputer', employeeId: 'KUL/1', scores: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5], idToken: 'p2-token' });
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.error, 'Missing/unknown school');
})();

// Regression for a second bypass found by the same review: Number('')===0,
// Number(' ')===0, Number(null)===0, Number(true)===1 -- a raw Number(raw)
// on the request body silently turned a blank/missing/boolean score into
// a real, in-range value instead of rejecting it. '1e1' (scientific
// notation) also silently parsed to 10 -- not how a real 0-10 number input
// ever produces a value, so rejected too rather than trusted.
(function blankAndNonNumericAndBooleanScoresAreAllRejected() {
  const { post } = env();
  const bad = ['', ' ', null, true, '1e1', 'abc', undefined, [], {}];
  bad.forEach((badValue) => {
    const scores = [5, 5, 5, 5, 5, 5, 5, 5, 5, 5];
    scores[0] = badValue;
    const res = post('submitss', { role: 'itComputer', school: 'LMS1', employeeId: 'KUL/1', scores, idToken: 'owner-token' });
    assert.strictEqual(res.success, false, 'score ' + JSON.stringify(badValue) + ' must be rejected, not silently coerced');
  });
})();

(function aPerCampusRoleTeacherStillWorksEndToEnd() {
  // KUL/1 is itComputer (AdminIT) in the shared fixture, not Teaching --
  // a separate fixture row is needed for the perCampus 'teacher' role
  // (school comes from the employee's own code prefix either way, but
  // teacher's form/response-tab lookup is keyed by school, unlike
  // itComputer's single shared 'all' form -- a real structural
  // difference in SS_ROLE_CONFIGS worth exercising, not just itComputer).
  const { post, get, books } = boot({
    books: {
      [EMP_SHEET]: {
        EmpMaster: EMP_MASTER.concat([['KUL/3', 'New Teacher', 'Active']]),
        EmpSalary: EMP_SALARY.concat([['KUL/3', 'Teaching']]),
      },
    },
    allowlistRows: ALLOWLIST,
    tokens: TOKENS,
  });
  const meta = get('ssformmeta', { role: 'teacher', school: 'LMS1', idToken: 'owner-token' });
  assert.strictEqual(meta.success, true);
  assert.deepStrictEqual(meta.employees.map((e) => e.employeeId), ['KUL/3']);
  const res = post('submitss', { role: 'teacher', school: 'LMS1', employeeId: 'KUL/3', scores: [7, 7, 7, 7, 7, 7, 7, 7, 7, 7], idToken: 'owner-token' });
  assert.strictEqual(res.success, true, JSON.stringify(res));
  const tabName = 'LMS 1 Teacher SS';
  const sub = books[SUBMISSIONS_SHEET].tabs['SS Submissions'].values;
  assert.strictEqual(sub[1][4], 'teacher'); // Role column
})();

(function bumpingTheRubricVersionAddsOneNewRubricsRowNotMore() {
  const { post, books, g } = env();
  post('submitss', { role: 'itComputer', school: 'LMS1', employeeId: 'KUL/1', scores: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5], idToken: 'owner-token' });
  // SS_ROLE_CONFIGS is a `const` inside the vm, so it's not reachable as
  // g.SS_ROLE_CONFIGS from Node's side (vm's top-level const/let bindings
  // live in the context's lexical scope, not as properties of the
  // contextified global object) -- a second script run IN THE SAME
  // context can still reach it, since that scope persists across runs.
  vm.runInContext('SS_ROLE_CONFIGS.itComputer.rubricVersion = 2;', g); // simulates Uday editing rubricTitles + bumping the version by hand
  post('submitss', { role: 'itComputer', school: 'LMS1', employeeId: 'KUL/1', scores: [6, 6, 6, 6, 6, 6, 6, 6, 6, 6], idToken: 'owner-token' });
  post('submitss', { role: 'itComputer', school: 'LMS1', employeeId: 'KUL/1', scores: [7, 7, 7, 7, 7, 7, 7, 7, 7, 7], idToken: 'owner-token' }); // still version 2 -- no 3rd rubrics row
  const rubrics = books[SUBMISSIONS_SHEET].tabs['SS Rubrics'].values;
  assert.strictEqual(rubrics.length, 3); // header + version 1 + version 2, not 4
  assert.strictEqual(rubrics[1][1], 1);
  assert.strictEqual(rubrics[2][1], 2);
  const sub = books[SUBMISSIONS_SHEET].tabs['SS Submissions'].values;
  assert.strictEqual(sub.length, 4); // header + 3 submissions
  assert.strictEqual(sub[1][5], 1); // first submission stamped with the version live AT THE TIME
  assert.strictEqual(sub[2][5], 2);
  assert.strictEqual(sub[3][5], 2);
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

// Regression for the second Critical finding, 2026-10-28: a Teacher SS
// entered through the new native form must still reach teacher-ss.gs's
// readCampusStatsUncached_ -- the Teacher Portal's own Evaluations view
// (myssstats) and Rank score (myrankscore) both read through this, a
// DIFFERENT reader than ss-tracker.gs's ssdashboard merge, which alone
// does not cover it.
(function teacherStatsIncludesANewFormSubmissionAlongsideTheOldTab() {
  const { post, get, books } = boot({
    books: {
      [EMP_SHEET]: {
        EmpMaster: EMP_MASTER.concat([['KUL/3', 'New Teacher', 'Active']]),
        EmpSalary: EMP_SALARY.concat([['KUL/3', 'Teaching']]),
      },
      [SUBMISSIONS_SHEET]: {
        'LMS 1 Teacher SS': [
          ['Timestamp', 'Email Address', 'LMS 1 Teacher Name', 'Pedagogy', 'Teacher Content', 'Student Response',
            'Activity Based Approach', 'Notebook Checking of Students', 'BUTCHER Scheme',
            'Discipline- English, Aerobics, Morning Assembly & Dispersal', 'Extra Curricular (Non Academic Competitions)',
            'Attitude Towards School', 'Dedication Towards Class'],
          [new Date('2026-08-01T10:00:00Z'), 'avantika.kanwar@example.org', 'KUL/3 New Teacher', 6, 6, 6, 6, 6, 6, 6, 6, 6, 6], // old-tab row, total 60
        ],
      },
    },
    allowlistRows: ALLOWLIST,
    tokens: TOKENS,
  });
  const res = post('submitss', { role: 'teacher', school: 'LMS1', employeeId: 'KUL/3', scores: [9, 9, 9, 9, 9, 9, 9, 9, 9, 9], idToken: 'owner-token' }); // new row, total 90
  assert.strictEqual(res.success, true, JSON.stringify(res));

  const stats = get('teacherstats', { idToken: 'owner-token' });
  assert.strictEqual(stats.success, true);
  const t = stats.campuses.LMS1.teachers.find((x) => x.teacher === 'KUL/3 New Teacher');
  assert.ok(t, 'KUL/3 New Teacher should appear in teacherstats');
  assert.strictEqual(t.submissionCount, 2, 'both the old-tab row and the new-form row should be counted');
  assert.strictEqual(t.avgTotal, 75); // (60 + 90) / 2
})();

// Regression for a third finding, 2026-10-28: renaming a rubric title and
// bumping rubricVersion must NOT change how an OLD (Google-Form-written,
// now-frozen) row's total is read. Before legacyRubricTitles existed, a
// probe showed this exact scenario silently dropping an old row's total
// from 60 to 54 (the renamed column's score read as 0, since the OLD
// sheet's real header still says the ORIGINAL title). ssReadSubmissions_
// must use legacyRubricTitles (frozen) for the old tab, never the live
// rubricTitles -- this proves it, not just documents it.
(function renamingARubricTitleDoesNotCorruptOldTabHistory() {
  // A fresh env() throughout -- ss-tracker.gs's/ss-forms-sync.gs's module-
  // level caches (_ssSpreadsheetCache_ etc.) are meant to live for ONE
  // real Apps Script execution; calling get('ssdashboard') a SECOND time
  // within the same vm context (as an earlier version of this test did,
  // to read a "before" baseline) would read its own stale cache instead
  // of a fresh request the way separate live HTTP calls actually would.
  const { post, get, g } = env();
  vm.runInContext("SS_ROLE_CONFIGS.itComputer.rubricTitles[0] = 'Teaching Method'; SS_ROLE_CONFIGS.itComputer.rubricVersion = 2;", g);
  post('submitss', { role: 'itComputer', school: 'LMS1', employeeId: 'KUL/1', scores: [9, 9, 9, 9, 9, 9, 9, 9, 9, 9], idToken: 'owner-token' });

  const dash = get('ssdashboard', { idToken: 'owner-token' });
  const rina = dash.roles.itComputer.roster.find((r) => r.employee === 'KUL/1 Rina Gupta');
  assert.strictEqual(rina.history.length, 2);
  const totals = rina.history.map((h) => h.total).sort((a, b) => a - b);
  assert.deepStrictEqual(totals, [60, 90], 'the old row must still read 60 after the rename, not drop to 54');
})();

console.log('all ss-submissions tests passed');
