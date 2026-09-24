// ═══════════════════════════════════════════════════════════════════
// Employee Roster Proxy — narrow, public-read Web App in front of the
// Employee Master workbook (1OjVMUvpLM8JkdAwjmljCtZUI1VUqGLbic36cW9dm0C0).
//
// This project ALSO now contains staff-management-api.gs AND
// principal-allowlist.gs (merged in 2026-09-23, per Uday, to redeploy
// as one project instead of three) -- see each file's own header for
// what it adds. doGet() below is the ONE entry point for the whole
// project and routes to staffDoGet_()/allowlistDoGet_() for those
// files' actions. Note principal-allowlist.gs's merge is NOT a
// no-op for security the way staff-management-api.gs's was -- its
// OLD deployment was domain-restricted (lms.org.in only) and this
// one is "Anyone"; see that file's header for the trade-off Uday
// accepted.
//
// WHY THIS EXISTS (2026-08-27): that workbook is currently shared
// "anyone with the link" so the portal's client-side JS can read it
// directly — but Google Sheets sharing is per-FILE, not per-tab, and
// the same workbook also has EmpPersonal/EmpProfessional/EmpKeyNumbers
// tabs with home addresses, DOB, phone numbers, Aadhar, PAN, and bank
// account details for all 158 employees. Public sharing on the file
// exposes all of that, not just the two tabs the portal actually needs.
//
// The fix: this script runs AS THE OWNER (Execute as: Me), so it can
// read the workbook even after its sharing is locked down to fully
// private. It reads ONLY EmpMaster and EmpAcademic, and returns ONLY
// {employeeCode, name, school, class, subject} rows -- never anything
// from the PII tabs. Once this is deployed and the workbook's sharing
// is restricted, the raw workbook becomes unreachable to the public;
// only this filtered subset is.
//
// Reads are public (no ID token) -- same model as every other read in
// this app (Daily sheet, Course Mapping, the old Allocation sheet were
// all directly public before this). Nothing this endpoint returns is
// more sensitive than "so-and-so teaches Class 3 Science at LMS 6",
// which was already visible in the (also public) old Allocation Sheet.
//
// STATUS FILTERING (2026-08-29): EmpMaster has a Status column (blank or
// "Active" = still employed, anything else e.g. "Left" = departed).
// readEmployees() checks it inline (see PERF note below); readRosterRows()
// still uses readDepartedCodes_() since it's excluding EmpAcademic rows
// against EmpMaster's status, a different sheet -- so flipping one
// employee's Status in EmpMaster cascades everywhere this proxy feeds
// (Missing Uploads, Course Mapping teacher assignment, the Chapter
// Tracker's teacher lookup) without hunting down every place their name
// might still appear.
//
// PERF (2026-09-15): measured 3.5-29.5s per call under LMCSManagement's
// perf audit, for a ~12KB response covering 158 employees -- way more
// than the data size justifies. Two causes found and fixed here:
//   1. readEmployees() used to call readDepartedCodes_() (a full
//      EmpMaster read) and THEN separately re-read all of EmpMaster
//      itself -- two full reads of the same sheet in one request. Now a
//      single pass checks Status inline while building the employee
//      list. readRosterRows() still calls readDepartedCodes_() as its
//      own read, since it's cross-referencing a DIFFERENT sheet
//      (EmpAcademic) -- that one was never a duplicate read.
//   2. No caching anywhere in this file (despite a comment elsewhere in
//      the codebase claiming a "1-hour cache" here -- it didn't exist;
//      that comment was stale/aspirational). Added CacheService below,
//      keyed per action, TTL CACHE_TTL_SECONDS -- roster data changes on
//      hire/transfer/departure, not minute-to-minute, so a few minutes
//      of staleness is a non-issue. No admin-write endpoint in this file
//      to bust it on write (unlike principal-allowlist.gs) -- it's
//      read-only, so a plain TTL is enough.
//
// SETUP:
//   1. script.google.com -> New project -> paste this file
//   2. Deploy -> New deployment -> Web App
//      Execute as: Me | Who has access: Anyone
//   3. Copy the Web App URL into course-mapping-admin.html's
//      "Daily Sheet & Proxy" config (Employee Roster Proxy URL field)
//   4. ONLY THEN: go to the Employee Master sheet -> Share -> Restricted
//      (remove "Anyone with the link"). Do this AFTER step 2/3 are
//      confirmed working, not before -- verify with curl that the
//      deployed URL still returns real data once sharing is locked
//      down, since Apps Script owner-execution should be unaffected,
//      but confirm before assuming.
// ═══════════════════════════════════════════════════════════════════

const EMP_ROSTER_SHEET_ID = '1OjVMUvpLM8JkdAwjmljCtZUI1VUqGLbic36cW9dm0C0';
const EMP_CACHE_TTL_SECONDS = 300; // 5 min -- see PERF note above

// EmployeeCode prefix -> School Code, matching the LMS Campuses convention
// used throughout the portal. Confirmed against the live sheet 2026-08-27.
// HES ("HES — Head Office", added 2026-09-23 per Uday) is a real prefix
// already used in the sheet (Head Office / admin staff, e.g.
// HES/19/07/001) -- without this entry those rows silently mapped to
// school: null everywhere this proxy is read.
const EMP_PREFIX_TO_SCHOOL = {
  KUL: 'LMS 1', KEL: 'LMS 2', DUN: 'LMS 3', NCM: 'LMS 4', SAY: 'LMS 5', JOG: 'LMS 6', HES: 'HES',
};

// Employees whose EmpSalary.Department is one of these are excluded from
// every read below (readEmployees/readRosterRows), regardless of which
// campus prefix their EmployeeCode carries -- per Uday (2026-09-23):
// senior/leadership staff (MD Academics, MD Operations, Finance Head,
// Marketing & PR Head, Admin/School/Systems Coordinator -- all tagged
// "AdminTM" in the real sheet) should never show up by name to Principals
// or in any of this proxy's consumers (Staff Portal search boxes, Course
// Mapping, Chapter Tracker, Curriculum Progress, Teacher Portal). Some of
// these people ALSO have older, stale rows still coded to an LMS1-6
// prefix (pre-HES data) -- filtering on Department, not prefix, catches
// those too.
const EMP_HIDDEN_DEPARTMENTS = ['admintm'];

/** EmployeeCode -> Department (lowercased, trimmed), from EmpSalary.
 *  Separate read from EmpMaster -- see EMP_HIDDEN_DEPARTMENTS above for
 *  why this exists. Own copy, not shared with staff-management-api.gs's
 *  equivalent (a separate file, same project as of 2026-09-23 -- but
 *  each file's helpers still aren't literally shared code). */
function readDepartmentByCode_() {
  const sheet = openWorkbook_().getSheetByName('EmpSalary');
  if (!sheet) return {};
  const rows = sheet.getDataRange().getValues();
  const header = rows[0];
  const codeCol = header.indexOf('EmployeeCode');
  const deptCol = header.indexOf('Department');
  const map = {};
  if (codeCol < 0 || deptCol < 0) return map;
  for (let i = 1; i < rows.length; i++) {
    const code = String(rows[i][codeCol] || '').trim();
    if (code) map[code] = String(rows[i][deptCol] || '').trim().toLowerCase();
  }
  return map;
}

// C1..C12 -> "Class 1".."Class 12", M1..M3 -> "M-I".."M-III" -- matches
// mapDailyClass() in daily-progress.html exactly, so the client needs no
// translation step for what this endpoint returns.
function empClassLabel(code) {
  const m = String(code).match(/^C(\d+)$/);
  if (m) return 'Class ' + m[1];
  if (code === 'M1') return 'M-I';
  if (code === 'M2') return 'M-II';
  if (code === 'M3') return 'M-III';
  return code;
}

// EmpAcademic's no-space subject codes -> the spelling already used
// elsewhere in the portal (Allocation Sheet, Course Mapping). Every code
// actually observed in the sheet as of 2026-08-27 is listed; anything
// else passes through unchanged (visible as-is rather than silently
// dropped, so a newly added subject code doesn't just disappear).
const EMP_SUBJECT_LABEL = {
  SocialScience: 'Social Science',
  CognitiveActivities: 'Cognitive Activities',
  EVS: 'E.V.S.',
  GK: 'GK',
  PolSc: 'Political Science',
  BussStud: 'Business Studies',
  PEd: 'P.Ed',
};
function empSubjectLabel(code) {
  return EMP_SUBJECT_LABEL[code] || code;
}

// Merged into this ONE project 2026-09-23, per Uday -- this file,
// staff-management-api.gs, and principal-allowlist.gs now live
// together as three files in the same Apps Script project ("LMCS
// Employee Roster Proxy"), sharing one Web App deployment/exec URL,
// instead of three separate projects each needing their own redeploy.
// This is the single doGet() Apps Script requires (only one function
// of that name is allowed per project) -- it just routes to whichever
// file's actions the request asked for. Nothing about EACH action's
// own access rule changed by the routing itself: 'roster'/'employees'/
// 'designations' below are still fully public with no token check;
// staff-management-api.gs's STAFF_ACTIONS_ (nextcode/list/detail/
// addnewhire/transfer/markinactive) still go through staffDoGet_(),
// which still verifies a real Google ID token against the Principal
// Allowlist for every one of them, completely unchanged from when it
// was its own project. principal-allowlist.gs's ALLOWLIST_ACTIONS_
// (allowlist_list/allowlist_add/allowlist_edit/allowlist_delete) go
// through allowlistDoGet_() -- writes are still gated the same way
// they always were, but allowlist_list itself has NO token check and
// this project's deployment is "Anyone", unlike that file's old
// domain-restricted deployment -- see that file's header for the
// trade-off Uday explicitly accepted merging it in.
const STAFF_ACTIONS_ = ['nextcode', 'list', 'detail', 'addnewhire', 'transfer', 'markinactive'];
const ALLOWLIST_ACTIONS_ = ['allowlist_list', 'allowlist_add', 'allowlist_edit', 'allowlist_delete'];

function doGet(e) {
  const action = (e.parameter.action || 'roster').toLowerCase();
  if (STAFF_ACTIONS_.indexOf(action) !== -1) return staffDoGet_(e);
  if (ALLOWLIST_ACTIONS_.indexOf(action) !== -1) return allowlistDoGet_(e);
  try {
    if (action === 'roster') return jsonOut({ success: true, rows: cached_('emp_roster', readRosterRows) });
    if (action === 'employees') return jsonOut({ success: true, employees: cached_('emp_employees', readEmployees) });
    if (action === 'designations') return jsonOut({ success: true, designations: cached_('emp_designations', readDesignationSummary) });
    if (action === 'certcounts') return jsonOut({ success: true, counts: readCertCounts_() });
    return jsonOut({ success: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonOut({ success: false, error: err.message });
  }
}

// Thin CacheService wrapper -- `key` is the cache key, `compute` is the
// (no-arg) function that builds the real result on a miss. See PERF note.
function cached_(key, compute) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const result = compute();
  cache.put(key, JSON.stringify(result), EMP_CACHE_TTL_SECONDS);
  return result;
}

/** Distinct Designation values from EmpSalary, with counts -- NEVER any
 *  name, email, or other per-employee field. Built 2026-09-01 so Claude
 *  could see the real job-title taxonomy (for designing the
 *  PortalAccessTier mapping) without needing raw access to the workbook,
 *  which is intentionally Restricted -- this is a read of the same narrow
 *  shape as everything else in this file, just aggregated instead of
 *  per-row. */
function readDesignationSummary() {
  const rows = openWorkbook_().getSheetByName('EmpSalary').getDataRange().getValues();
  const header = rows[0];
  const desigCol = header.indexOf('Designation');
  const deptCol = header.indexOf('Department');
  const statusCol = header.indexOf('Status');
  const counts = {}; // "Designation|Department" -> {designation, department, count, active, inactive}
  for (let i = 1; i < rows.length; i++) {
    const designation = String(rows[i][desigCol] || '').trim();
    if (!designation) continue;
    const department = deptCol >= 0 ? String(rows[i][deptCol] || '').trim() : '';
    const status = statusCol >= 0 ? String(rows[i][statusCol] || '').trim() : '';
    const key = designation + '|' + department;
    if (!counts[key]) counts[key] = { designation, department, count: 0, active: 0, inactive: 0 };
    counts[key].count++;
    if (status.toLowerCase() === 'active' || !status) counts[key].active++;
    else counts[key].inactive++;
  }
  return Object.values(counts).sort((a, b) => b.count - a.count);
}

/** TEMPORARY debug action (2026-09-24) -- aggregate counts only, NEVER any
 *  name/code/link, to diagnose why the Staff Portal's Certificates section
 *  isn't showing up for Uday: total rows in "Certificate Links", how many
 *  have a non-blank Drive Link, and how many distinct Employee Codes that
 *  covers. Remove once diagnosed. */
function readCertCounts_() {
  const sheet = openWorkbook_().getSheetByName('Certificate Links');
  if (!sheet) return { error: 'no Certificate Links tab found' };
  const rows = sheet.getDataRange().getValues();
  const header = rows[0];
  const codeCol = header.indexOf('Employee Code');
  const linkCol = header.indexOf('Drive Link');
  let totalRows = 0, rowsWithLink = 0;
  const codesWithLink = {};
  for (let i = 1; i < rows.length; i++) {
    const code = codeCol >= 0 ? String(rows[i][codeCol] || '').trim() : '';
    if (!code) continue;
    totalRows++;
    const link = linkCol >= 0 ? String(rows[i][linkCol] || '').trim() : '';
    if (link) { rowsWithLink++; codesWithLink[code] = true; }
  }
  // Cross-check: do those codes actually exist in EmpMaster (exact-match,
  // same lookup employeeDetail_ does)? A formatting mismatch (e.g. code
  // padding) here would explain the Portal never finding a match even
  // though rowsWithLink/distinctEmployeesWithLink both look healthy above.
  const masterRows = openWorkbook_().getSheetByName('EmpMaster').getDataRange().getValues();
  const masterHeader = masterRows[0];
  const masterCodeCol = masterHeader.indexOf('EmployeeCode');
  const masterCodes = {};
  for (let i = 1; i < masterRows.length; i++) {
    const c = String(masterRows[i][masterCodeCol] || '').trim();
    if (c) masterCodes[c] = true;
  }
  let matchedInEmpMaster = 0;
  Object.keys(codesWithLink).forEach(function (c) { if (masterCodes[c]) matchedInEmpMaster++; });
  return {
    totalRows: totalRows, rowsWithLink: rowsWithLink,
    distinctEmployeesWithLink: Object.keys(codesWithLink).length,
    matchedInEmpMaster: matchedInEmpMaster,
  };
}

function openWorkbook_() {
  return SpreadsheetApp.openById(EMP_ROSTER_SHEET_ID);
}

/** EmpMaster's Status column -> {EmployeeCode: true} for everyone marked
 *  departed (anything other than blank/"Active", case-insensitively).
 *  Used by readRosterRows() below to cross-reference EmpAcademic against
 *  EmpMaster's status -- readEmployees() no longer calls this (see PERF
 *  note at the top of this file); it checks Status inline in its own
 *  single pass over EmpMaster instead. */
function readDepartedCodes_() {
  const rows = openWorkbook_().getSheetByName('EmpMaster').getDataRange().getValues();
  const header = rows[0];
  const codeCol = header.indexOf('EmployeeCode');
  const statusCol = header.indexOf('Status');
  const departed = {};
  if (statusCol < 0) return departed; // no Status column -- nothing to exclude
  for (let i = 1; i < rows.length; i++) {
    const code = String(rows[i][codeCol] || '').trim();
    if (!code) continue;
    const status = String(rows[i][statusCol] || '').trim().toLowerCase();
    if (status && status !== 'active') departed[code] = true;
  }
  return departed;
}

/** EmpMaster: EmployeeCode -> {name, school}. Never reads AuthEmail/ReportsTo
 *  or any other tab -- deliberately narrow. Excludes departed staff.
 *  Single pass over EmpMaster (Status checked inline) -- this used to call
 *  readDepartedCodes_() AND read EmpMaster again itself, two full reads of
 *  the same sheet per request; see PERF note at the top of this file. */
function readEmployees() {
  const departments = readDepartmentByCode_();
  const rows = openWorkbook_().getSheetByName('EmpMaster').getDataRange().getValues();
  const header = rows[0];
  const codeCol = header.indexOf('EmployeeCode');
  const nameCol = header.indexOf('Name');
  const statusCol = header.indexOf('Status');
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const code = String(rows[i][codeCol] || '').trim();
    if (!code) continue;
    const status = statusCol >= 0 ? String(rows[i][statusCol] || '').trim().toLowerCase() : '';
    if (status && status !== 'active') continue; // departed -- see STATUS FILTERING note above
    if (EMP_HIDDEN_DEPARTMENTS.indexOf(departments[code]) !== -1) continue; // see EMP_HIDDEN_DEPARTMENTS above
    const prefix = code.split('/')[0];
    out.push({
      employeeCode: code,
      name: String(rows[i][nameCol] || '').trim(),
      school: EMP_PREFIX_TO_SCHOOL[prefix] || null,
    });
  }
  return out;
}

/** EmpAcademic, flattened to one row per (school, class, subject, teacher) --
 *  same shape as the old Allocation Sheet's rows, so it's a drop-in
 *  replacement in the client's matching logic. Excludes departed staff'
 *  class/subject rows too, not just their name in the roster list -- a
 *  Status flip in EmpMaster is enough, no need to also clear EmpAcademic. */
function readRosterRows() {
  const departed = readDepartedCodes_();
  const departments = readDepartmentByCode_();
  const rows = openWorkbook_().getSheetByName('EmpAcademic').getDataRange().getValues();
  const header = rows[0];
  const codeCol = header.indexOf('EmployeeCode');
  const nameCol = header.indexOf('Name');
  const subjectCols = [];
  for (let i = 1; i <= 10; i++) {
    const idx = header.indexOf('Class_Subject' + i);
    if (idx >= 0) subjectCols.push(idx);
  }

  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const code = String(rows[i][codeCol] || '').trim();
    if (!code || departed[code]) continue;
    if (EMP_HIDDEN_DEPARTMENTS.indexOf(departments[code]) !== -1) continue; // see EMP_HIDDEN_DEPARTMENTS above
    const prefix = code.split('/')[0];
    const school = EMP_PREFIX_TO_SCHOOL[prefix];
    if (!school) continue; // unknown prefix -- skip rather than mis-attribute
    const name = String(rows[i][nameCol] || '').trim();

    subjectCols.forEach(function (col) {
      const val = String(rows[i][col] || '').trim();
      if (!val) return;
      const m = val.match(/^([A-Za-z]+\d+)_(.+)$/);
      if (!m) return; // shouldn't happen -- confirmed 0 malformed cells 2026-08-27
      out.push({
        employeeCode: code,
        school: school,
        class: empClassLabel(m[1]),
        subject: empSubjectLabel(m[2]),
        teacher: name,
      });
    });
  }
  return out;
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
