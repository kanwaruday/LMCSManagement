// ═══════════════════════════════════════════════════════════════════
// LMCS Staff Management API — write-capable actions for the Employee
// Master workbook (1OjVMUvpLM8JkdAwjmljCtZUI1VUqGLbic36cW9dm0C0).
//
// LIVES IN THE SAME APPS SCRIPT PROJECT as employee-roster.gs ("LMCS
// Employee Roster Proxy") as of 2026-09-23, per Uday -- one project/one
// deployment to redeploy instead of two. That project's doGet() (in
// employee-roster.gs) is the single entry point and routes every
// STAFF_ACTIONS_ action to staffDoGet_() below. The original reason
// these were two separate projects still holds and hasn't gone away:
// employee-roster.gs's own actions ('roster'/'employees'/'designations')
// are public reads with NO token check, deliberately narrow in what they
// return; every action in THIS file writes real HR data or returns PII
// (Aadhar/PAN/bank details), so it's verified against the "LMCS
// Principal Allowlist" sheet principal-allowlist.gs backs, re-derived
// server-side from a real Google ID token -- never trusted from the
// client, regardless of which project's doGet answered the request. Only
// 'Coordinator' (their own locked campus only) or 'Owner' (any campus)
// can call the write actions; everyone else gets "Not authorized," full
// stop. Merging the deployment did not merge that trust boundary.
//
// Reads for dropdowns (existing employee names/schools) are NOT
// duplicated here -- the frontend calls the roster proxy's own
// ?action=employees for that (already excludes departed staff) --
// same URL, now, as this file's own actions.
//
// PERF (2026-09-23): the Directory tab was extremely slow to load.
// Root cause: every single action call here -- including read-only ones
// like 'list'/'detail'/'nextcode' (the last of which re-fires on every
// School/Date-of-Joining keystroke in New Hire) -- did a live external
// fetch to oauth2.googleapis.com AND a full read of the allowlist sheet
// to verify the token, PLUS listEmployees_() read two more full sheets
// (EmpMaster + EmpSalary), with NO caching anywhere -- the exact same
// problem employee-roster.gs already hit and fixed (see its own PERF
// note), just never carried over to this sibling file. Fixed the same
// way: cachedStaff_()/tokenCacheKey_() cache token verification for
// read-only actions only (STAFF_READ_ACTIONS_) -- write actions always
// verify live, so a just-revoked access can't slip a mutation through
// during the cache window -- and listEmployees_() is cached per campusId,
// busted on every write via bustStaffListCache_() so a hire/transfer/
// inactive the caller just made shows up immediately.
//
// SETUP:
//   1. Open the "LMCS Employee Roster Proxy" Apps Script project
//      (the one that already has employee-roster.gs in it)
//   2. Add this file to that SAME project (+ next to Files -> paste in)
//      -- do NOT create a separate project for it
//   3. Deploy -> Manage deployments -> pencil icon on the existing
//      deployment -> New version (deploys BOTH files together, keeps
//      the same Web App URL everything already points at)
//   4. staff/add-employee.html's STAFF_API_URL should already equal
//      EMPLOYEE_ROSTER_URL -- if you ever see them differ, that's a bug
// ═══════════════════════════════════════════════════════════════════

const STAFF_EMP_SHEET_ID = '1OjVMUvpLM8JkdAwjmljCtZUI1VUqGLbic36cW9dm0C0';
const STAFF_ALLOWLIST_SHEET_ID = '1NZu0ElismFytG395Nxjz29vAz7OfkmJtZhs70bOwT58'; // "LMCS Principal Allowlist"
const STAFF_GOOGLE_CLIENT_ID = '697999989724-mvi85iobr20g4mm8a8nrjd1rms2o8tf6.apps.googleusercontent.com';
const STAFF_CACHE_TTL_SECONDS = 300; // 5 min -- same TTL/reasoning as employee-roster.gs's EMP_CACHE_TTL_SECONDS

// Thin CacheService wrapper -- `key` is the cache key, `compute` is the
// (no-arg) function that builds the real result on a miss. Same pattern as
// employee-roster.gs's cached_() (own copy -- a separate file, same
// project as of 2026-09-23, but not literally shared code).
function cachedStaff_(key, compute) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const result = compute();
  cache.put(key, JSON.stringify(result), STAFF_CACHE_TTL_SECONDS);
  return result;
}

// CacheService keys cap at 250 chars; a Google ID token (JWT) easily runs
// past that, so this hashes it down to a fixed-length key. Only used to
// avoid RE-verifying the identical token repeatedly within the TTL -- the
// verification itself (below) is unchanged, still re-derived from the
// allowlist every cache miss, never trusted from the client.
function tokenCacheKey_(idToken) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, idToken || '');
  return 'tok_' + digest.map(function (b) { return ((b < 0 ? b + 256 : b)).toString(16).padStart(2, '0'); }).join('');
}

// EmployeeCode prefix per campus -- matches EMP_PREFIX_TO_SCHOOL in
// employee-roster.gs (that one maps prefix -> school; this is the reverse,
// keyed by campusId the portal already uses, e.g. 'LMS1' not 'LMS 1').
// HES added 2026-09-23 per Uday -- Head Office, a real prefix already used
// in the sheet (e.g. HES/19/07/001). Staff Portal is the only place this
// is exposed (Coordinator/Owner-only page already, see canManageStaff in
// auth.js), so no extra role check is needed to keep it Coordinator/
// Owner-only.
const STAFF_SCHOOL_PREFIX = {
  LMS1: 'KUL', LMS2: 'KEL', LMS3: 'DUN', LMS4: 'NCM', LMS5: 'SAY', LMS6: 'JOG', HES: 'HES',
};

// Employees whose EmpSalary.Department is one of these are excluded from
// the Directory and blocked from the detail view, regardless of which
// campus their EmployeeCode is coded to -- per Uday (2026-09-23): senior
// leadership (MD Academics/Operations, Finance Head, Marketing & PR Head,
// Admin/School/Systems Coordinator, all tagged "AdminTM" in the real
// sheet) shouldn't be visible here. Own copy of employee-roster.gs's
// EMP_HIDDEN_DEPARTMENTS (a separate file, same project) -- keep both in
// sync if this list ever changes.
const STAFF_HIDDEN_DEPARTMENTS = ['admintm'];

// Read-only actions get their token verification CACHED (below) -- these
// fire far more often than writes (nextcode alone re-fires on every
// School/Date-of-Joining keystroke in New Hire) and a few minutes of
// staleness on a read carries no real risk. Write actions always verify
// live, uncached, so a just-revoked access can never slip a mutation
// through during the cache window.
const STAFF_READ_ACTIONS_ = ['nextcode', 'list', 'detail'];

// Renamed from doGet() 2026-09-23 when this file merged into the same
// Apps Script project as employee-roster.gs (see that file's doGet() --
// only one function may be named doGet per project, so it's now the
// single dispatcher and routes here for every STAFF_ACTIONS_ action).
// Everything below is otherwise unchanged from when this was its own
// project's doGet().
function staffDoGet_(e) {
  try {
    const action = (e.parameter.action || '').toLowerCase();
    const caller = STAFF_READ_ACTIONS_.indexOf(action) !== -1
      ? cachedStaff_(tokenCacheKey_(e.parameter.idToken), function () { return verifyStaffManagerToken_(e.parameter.idToken); })
      : verifyStaffManagerToken_(e.parameter.idToken);
    if (!caller) return staffJsonOut_({ success: false, error: 'Not authorized' });

    const data = e.parameter.data ? JSON.parse(e.parameter.data) : {};
    let result;
    if (action === 'nextcode') result = { employeeCode: previewNextCode_(data) };
    else if (action === 'list') result = { employees: listEmployees_(caller) };
    else if (action === 'detail') result = { detail: employeeDetail_(data, caller) };
    else if (action === 'addnewhire') result = addNewHire_(data, caller);
    else if (action === 'transfer') result = transferEmployee_(data, caller);
    else if (action === 'markinactive') result = markInactive_(data, caller);
    else return staffJsonOut_({ success: false, error: 'Unknown action: ' + action });

    return staffJsonOut_(Object.assign({ success: true }, result));
  } catch (err) {
    return staffJsonOut_({ success: false, error: err.message });
  }
}

// ── Auth: verified Google ID token -> {email, campusId, role}, re-derived
//    from the allowlist sheet every call (never trusts client-passed
//    role/campusId). Returns null if the token doesn't verify, or the
//    email isn't on the list, or their role isn't Coordinator/Owner. ──
function verifyStaffManagerToken_(idToken) {
  if (!idToken) return null;
  try {
    const res = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
      { muteHttpExceptions: true }
    );
    if (res.getResponseCode() !== 200) return null;
    const payload = JSON.parse(res.getContentText());
    if (payload.aud !== STAFF_GOOGLE_CLIENT_ID) return null;
    if (payload.email_verified !== 'true' && payload.email_verified !== true) return null;
    const email = (payload.email || '').toLowerCase();

    const rows = SpreadsheetApp.openById(STAFF_ALLOWLIST_SHEET_ID).getSheets()[0].getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0] || '').trim().toLowerCase() !== email) continue;
      const campusId = String(rows[i][2] || '').trim().toUpperCase();
      // Multi-role aware (2026-09-19) -- same comma-split as main.gs's
      // verifyCallerToken_ (separate deployment/project, so this is its
      // own copy, not a shared function). "Coordinator,Teacher" still
      // gets Staff Portal access via the Coordinator half.
      const role = String(rows[i][3] || '').trim();
      const roles = role.split(',').map(function (r) { return r.trim(); }).filter(Boolean);
      if (roles.indexOf('Coordinator') === -1 && roles.indexOf('Owner') === -1 && campusId !== 'ALL') return null;
      return { email: email, campusId: campusId, role: role, roles: roles };
    }
    return null; // not on the allowlist at all
  } catch (err) {
    return null;
  }
}

// A Coordinator may only act on their own locked campus; Owner (campusId
// ALL) may act on any. For a single-campus action (new hire, mark
// inactive) `schools` has one entry, which must equal the caller's campus.
function assertScope_(caller, schools) {
  if (caller.campusId === 'ALL') return;
  schools.forEach(function (s) {
    if (s !== caller.campusId) throw new Error('Coordinators can only manage their own campus');
  });
}

// Transfers touch TWO campuses (old + new) -- a Coordinator locked to one
// campus can never match BOTH, so assertScope_'s all-must-match rule would
// make every cross-campus transfer impossible for them, which defeats the
// point (Uday, 2026-08-29: transfers must work for Coordinators from day
// one). Instead: a Coordinator may act if EITHER side of the transfer is
// their own campus -- releasing one of their own staff, or receiving one
// -- but not for a transfer between two campuses neither of which is
// theirs. Owner (campusId ALL) is unrestricted either way.
function assertTransferScope_(caller, oldSchool, newSchool) {
  if (caller.campusId === 'ALL') return;
  if (caller.campusId !== oldSchool && caller.campusId !== newSchool) {
    throw new Error('Coordinators can only manage transfers involving their own campus');
  }
}

function openEmpWorkbook_() {
  return SpreadsheetApp.openById(STAFF_EMP_SHEET_ID);
}

// ── EmployeeCode generation ──────────────────────────────────────────
// Next-unused sequence number for a school prefix, computed as
// MAX(existing seq for that prefix, including departed/transferred
// employees) + 1 -- a number is never reused, so an old payroll/salary
// record referencing a departed employee's code can never collide with a
// new hire's. Per Uday (2026-08-29): the YY/MM segment is normally the
// employee's real join date, EXCEPT on a transfer between LMS campuses,
// where it carries over from their original code unchanged (that's how
// movement between campuses is tracked) -- see transferEmployee_ below.
function nextSeqForPrefix_(prefix) {
  const rows = openEmpWorkbook_().getSheetByName('EmpMaster').getDataRange().getValues();
  const header = rows[0];
  const codeCol = header.indexOf('EmployeeCode');
  let maxSeq = 0;
  for (let i = 1; i < rows.length; i++) {
    const code = String(rows[i][codeCol] || '').trim();
    if (!code) continue;
    const parts = code.split('/');
    if (parts[0] !== prefix || parts.length < 4) continue;
    const seq = parseInt(parts[3], 10);
    if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
  }
  return maxSeq + 1;
}

function buildEmployeeCode_(prefix, yy, mm) {
  return prefix + '/' + yy + '/' + mm + '/' + String(nextSeqForPrefix_(prefix)).padStart(3, '0');
}

// Preview-only (no write) so the frontend can show the code that WOULD be
// assigned before the user confirms.
function previewNextCode_(data) {
  const prefix = STAFF_SCHOOL_PREFIX[data.school];
  if (!prefix) throw new Error('Unknown school: ' + data.school);
  const doj = new Date(data.dateOfJoining);
  if (isNaN(doj.getTime())) throw new Error('Invalid dateOfJoining');
  const yy = String(doj.getFullYear()).slice(-2);
  const mm = String(doj.getMonth() + 1).padStart(2, '0');
  return buildEmployeeCode_(prefix, yy, mm);
}

// ── Class/Subject label <-> EmpAcademic code (reverse of empClassLabel /
//    empSubjectLabel in employee-roster.gs) ──────────────────────────
const STAFF_SUBJECT_TO_CODE = {
  'Social Science': 'SocialScience',
  'Cognitive Activities': 'CognitiveActivities',
  'E.V.S.': 'EVS',
  'GK': 'GK',
  'Political Science': 'PolSc',
  'Business Studies': 'BussStud',
  'P.Ed': 'PEd',
};
function classToCode_(label) {
  const l = String(label || '').trim();
  if (l === 'M-I') return 'M1';
  if (l === 'M-II') return 'M2';
  if (l === 'M-III') return 'M3';
  const m = l.match(/^Class\s*(\d+)$/i);
  return m ? 'C' + m[1] : l;
}
function subjectToCode_(label) {
  return STAFF_SUBJECT_TO_CODE[label] || String(label || '').replace(/[^A-Za-z0-9]/g, '');
}
function classSubjectCode_(cls, subj) {
  return classToCode_(cls) + '_' + subjectToCode_(subj);
}

// ── Row builders -- always by HEADER NAME, never a hardcoded column
//    index, so a future column reorder in EmpMaster/EmpAcademic can't
//    silently misalign a write (see fixMisalignedRows in Code.gs for
//    exactly the kind of past incident this guards against). Fields not
//    passed in `values` are left blank, e.g. AuthEmail/OldSystemID/
//    NewEmployeeCode -- the latter two are reserved for a future
//    database migration and deliberately untouched here. ──
function buildRow_(header, values) {
  const row = new Array(header.length).fill('');
  header.forEach(function (h, i) {
    if (Object.prototype.hasOwnProperty.call(values, h)) row[i] = values[h];
  });
  return row;
}

function appendAcademicRow_(ss, employeeCode, name, classSubjects) {
  if (!classSubjects || !classSubjects.length) return;
  const sheet = ss.getSheetByName('EmpAcademic');
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const codeCol = header.indexOf('EmployeeCode');
  const nameCol = header.indexOf('Name');
  const subjectCols = [];
  for (let i = 1; i <= 10; i++) {
    const idx = header.indexOf('Class_Subject' + i);
    if (idx >= 0) subjectCols.push(idx);
  }
  const row = new Array(header.length).fill('');
  if (codeCol >= 0) row[codeCol] = employeeCode;
  if (nameCol >= 0) row[nameCol] = name;
  classSubjects.slice(0, subjectCols.length).forEach(function (cs, i) {
    row[subjectCols[i]] = classSubjectCode_(cs.class, cs.subject);
  });
  sheet.appendRow(row);
}

// ── Directory (Staff Portal's "school-wise existing employees" view) ──
// Full EmpMaster rows, scoped like every write action here -- Coordinator
// sees only their own locked campus, Owner sees all. Deliberately separate
// from employee-roster.gs's readEmployees(): that one is an UNAUTHENTICATED
// public read, narrowed to {code, name, school} for Active staff only. This
// one is behind the same verified-token gate as every write in this file,
// so it can safely include Role/ReportsTo/DateOfJoining/Status (Inactive
// and Transferred included, not just Active) for the people actually
// allowed to manage staff.
//
// Role comes from EmpSalary.Designation, NOT EmpMaster.Role -- confirmed
// against a real export 2026-09-23: EmpMaster.Role is 100% empty across
// all 173 employees, the actual job title ("PRT", "Head Master/Principal",
// "Helper"...) only exists in EmpSalary. EmpMaster.AuthEmail is also NOT a
// real email (it's a bare row-number in the real sheet) -- the real one is
// EmpPersonal.AuthEmail, read separately in employeeDetail_ below.
// Cached per campusId (below) -- this reads two full sheets (EmpMaster +
// EmpSalary for the Designation lookup) which was the dominant cost of a
// Directory load with no caching at all. Busted on every write (see
// bustStaffListCache_) so a hire/transfer/inactive the caller JUST made
// shows up immediately rather than waiting out the TTL.
function listEmployees_(caller) {
  return cachedStaff_('staff_list_' + caller.campusId, function () { return buildEmployeeList_(caller); });
}

function buildEmployeeList_(caller) {
  const rows = openEmpWorkbook_().getSheetByName('EmpMaster').getDataRange().getValues();
  const header = rows[0];
  const idx = {};
  header.forEach(function (h, i) { idx[h] = i; });
  const salaryByCode = readEmpSalaryByCode_();
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const code = String(rows[i][idx.EmployeeCode] || '').trim();
    if (!code) continue;
    const school = String(rows[i][idx.SchoolCode] || '').trim().toUpperCase();
    if (caller.campusId !== 'ALL' && school !== caller.campusId) continue;
    const salary = salaryByCode[code] || { designation: '', department: '' };
    if (STAFF_HIDDEN_DEPARTMENTS.indexOf(salary.department) !== -1) continue; // see STAFF_HIDDEN_DEPARTMENTS above
    out.push({
      employeeCode: code,
      name: String(rows[i][idx.Name] || '').trim(),
      school: school,
      role: salary.designation,
      reportsTo: idx.ReportsTo >= 0 ? String(rows[i][idx.ReportsTo] || '').trim() : '',
      dateOfJoining: idx.DateOfJoining >= 0 ? formatStaffDate_(rows[i][idx.DateOfJoining]) : '',
      status: (idx.Status >= 0 ? String(rows[i][idx.Status] || '').trim() : '') || 'Active',
    });
  }
  return out;
}

function bustStaffListCache_() {
  const keys = ['ALL', 'LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6', 'HES'].map(function (c) { return 'staff_list_' + c; });
  CacheService.getScriptCache().removeAll(keys);
}

// EmployeeCode -> {designation, department (lowercased, for the
// STAFF_HIDDEN_DEPARTMENTS check)}, one pass over EmpSalary instead of a
// separate read per field.
function readEmpSalaryByCode_() {
  const sheet = openEmpWorkbook_().getSheetByName('EmpSalary');
  if (!sheet) return {};
  const rows = sheet.getDataRange().getValues();
  const header = rows[0];
  const codeCol = header.indexOf('EmployeeCode');
  const desigCol = header.indexOf('Designation');
  const deptCol = header.indexOf('Department');
  const map = {};
  if (codeCol < 0) return map;
  for (let i = 1; i < rows.length; i++) {
    const code = String(rows[i][codeCol] || '').trim();
    if (!code) continue;
    map[code] = {
      designation: desigCol >= 0 ? String(rows[i][desigCol] || '').trim() : '',
      department: deptCol >= 0 ? String(rows[i][deptCol] || '').trim().toLowerCase() : '',
    };
  }
  return map;
}

function formatStaffDate_(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, 'Etc/GMT', 'yyyy-MM-dd');
}

// Every column of one sheet's row matching EmployeeCode, as {header: value} --
// generic (not a hardcoded field list) because most of these tabs' exact
// column names weren't known when this was first written (they're the PII
// tabs employee-roster.gs's file header deliberately never reads -- see
// that file's WHY note). `exclude` drops specific headers confirmed to be
// junk or redundant against a real export (2026-09-23): EmpMaster's
// AuthEmail (a bare row-number, not a real email) and OldSystemID/
// NewEmployeeCode (broken #NAME?/#VALUE! formulas, not real data);
// EmpPersonal's "Staff Master" (just Code+Name concatenated).
function readRowByCode_(ss, sheetName, code, exclude) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return null;
  const rows = sheet.getDataRange().getValues();
  const header = rows[0];
  const codeCol = header.indexOf('EmployeeCode');
  if (codeCol < 0) return null;
  const skip = exclude || [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][codeCol] || '').trim() !== code) continue;
    const obj = {};
    header.forEach(function (h, idx) {
      if (!h || skip.indexOf(h) !== -1) return;
      const v = rows[i][idx];
      obj[h] = v instanceof Date ? formatStaffDate_(v) : v;
    });
    return obj;
  }
  return null;
}

// Same idea as readRowByCode_ but an INCLUDE list instead of exclude --
// used for EmpSalary, where Basic/GradePay/Increment (actual pay figures)
// stay out of this portal by design (per Uday, 2026-09-23: those are
// reserved for the future dedicated Salary Dashboard module); only the
// non-monetary job info is surfaced here.
function readRowFieldsByCode_(ss, sheetName, code, fields) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return null;
  const rows = sheet.getDataRange().getValues();
  const header = rows[0];
  const codeCol = header.indexOf('EmployeeCode');
  if (codeCol < 0) return null;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][codeCol] || '').trim() !== code) continue;
    const obj = {};
    fields.forEach(function (f) {
      const idx = header.indexOf(f);
      if (idx < 0) return;
      const v = rows[i][idx];
      obj[f] = v instanceof Date ? formatStaffDate_(v) : v;
    });
    return obj;
  }
  return null;
}

// Reverse of classToCode_/subjectToCode_ above -- decodes EmpAcademic's
// Class_SubjectN codes (e.g. "C4_Science") into a friendly label ("Class 4
// — Science") for the detail view, same decode employee-roster.gs's
// empClassLabel/empSubjectLabel already do for the read-only proxy (own
// copy here, not shared -- a separate file, same project).
function codeToClassLabel_(code) {
  const m = String(code).match(/^C(\d+)$/);
  if (m) return 'Class ' + m[1];
  if (code === 'M1') return 'M-I';
  if (code === 'M2') return 'M-II';
  if (code === 'M3') return 'M-III';
  return code;
}
const STAFF_CODE_TO_SUBJECT = {};
Object.keys(STAFF_SUBJECT_TO_CODE).forEach(function (label) { STAFF_CODE_TO_SUBJECT[STAFF_SUBJECT_TO_CODE[label]] = label; });
function codeToSubjectLabel_(code) { return STAFF_CODE_TO_SUBJECT[code] || code; }

function readClassSubjects_(ss, code) {
  const sheet = ss.getSheetByName('EmpAcademic');
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues();
  const header = rows[0];
  const codeCol = header.indexOf('EmployeeCode');
  const subjectCols = [];
  for (let i = 1; i <= 10; i++) {
    const idx = header.indexOf('Class_Subject' + i);
    if (idx >= 0) subjectCols.push(idx);
  }
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][codeCol] || '').trim() !== code) continue;
    const out = [];
    subjectCols.forEach(function (col) {
      const val = String(rows[i][col] || '').trim();
      const m = val.match(/^([A-Za-z]+\d+)_(.+)$/);
      if (!m) return;
      out.push(codeToClassLabel_(m[1]) + ' — ' + codeToSubjectLabel_(m[2]));
    });
    return out;
  }
  return [];
}

// Full per-employee record for the Directory's "view all information" panel
// -- merges EmpMaster with every other per-employee tab in the workbook
// (EmpPersonal: address/DOB/phone; EmpSalary: job info, pay figures
// excluded by design; EmpProfessional: qualifications; EmpKeyNumbers:
// Aadhar/PAN/bank details, shown in full -- per Uday, 2026-09-23, anyone
// who can already open this portal (Owner, or a Coordinator for their own
// campus) is trusted with the full numbers, same as every write action
// here) plus their decoded EmpAcademic class/subject list. Gated behind
// the same verified-token + campus-scope check as every write action in
// this file, which is WHY this can safely return the PII tabs the public
// employee-roster.gs proxy deliberately never touches.
function employeeDetail_(data, caller) {
  if (!data.employeeCode) throw new Error('employeeCode is required');
  const ss = openEmpWorkbook_();
  const master = readRowByCode_(ss, 'EmpMaster', data.employeeCode, ['AuthEmail', 'OldSystemID', 'NewEmployeeCode']);
  if (!master) throw new Error('Employee not found: ' + data.employeeCode);
  // Same "Employee not found" error as a truly-missing code -- a hidden
  // employee (see STAFF_HIDDEN_DEPARTMENTS above) should look identical to
  // one that doesn't exist, not distinguishable as "exists but blocked."
  const salaryLookup = readEmpSalaryByCode_()[data.employeeCode];
  if (salaryLookup && STAFF_HIDDEN_DEPARTMENTS.indexOf(salaryLookup.department) !== -1) {
    throw new Error('Employee not found: ' + data.employeeCode);
  }
  const school = String(master.SchoolCode || '').trim().toUpperCase();
  assertScope_(caller, [school]);

  const detail = { EmpMaster: master };

  const personal = readRowByCode_(ss, 'EmpPersonal', data.employeeCode, ['Staff Master']);
  if (personal) detail.EmpPersonal = personal;

  const salary = readRowFieldsByCode_(ss, 'EmpSalary', data.employeeCode, ['EmployeeType', 'Designation', 'Department', 'WorkingHour']);
  if (salary) detail.EmpSalary = salary;

  const professional = readRowByCode_(ss, 'EmpProfessional', data.employeeCode);
  if (professional) detail.EmpProfessional = professional;

  const keyNumbers = readRowByCode_(ss, 'EmpKeyNumbers', data.employeeCode);
  if (keyNumbers) detail.EmpKeyNumbers = keyNumbers;

  const classSubjects = readClassSubjects_(ss, data.employeeCode);
  if (classSubjects.length) detail.classSubjects = classSubjects;

  return detail;
}

// ── Actions ───────────────────────────────────────────────────────────

/** data: {name, dateOfJoining ('YYYY-MM-DD'), school (campusId), role,
 *  reportsTo (EmployeeCode), classSubjects: [{class,subject}, ...]} */
function addNewHire_(data, caller) {
  if (!data.name || !data.dateOfJoining || !data.school) {
    throw new Error('name, dateOfJoining, and school are required');
  }
  assertScope_(caller, [data.school]);
  const prefix = STAFF_SCHOOL_PREFIX[data.school];
  if (!prefix) throw new Error('Unknown school: ' + data.school);

  const doj = new Date(data.dateOfJoining);
  if (isNaN(doj.getTime())) throw new Error('Invalid dateOfJoining');
  const yy = String(doj.getFullYear()).slice(-2);
  const mm = String(doj.getMonth() + 1).padStart(2, '0');
  const code = buildEmployeeCode_(prefix, yy, mm);

  const ss = openEmpWorkbook_();
  const master = ss.getSheetByName('EmpMaster');
  const header = master.getRange(1, 1, 1, master.getLastColumn()).getValues()[0];
  master.appendRow(buildRow_(header, {
    DateOfJoining: doj, SchoolCode: data.school, EmployeeCode: code,
    Name: data.name, Role: data.role || '', ReportsTo: data.reportsTo || '', Status: 'Active',
  }));
  appendAcademicRow_(ss, code, data.name, data.classSubjects);

  bustStaffListCache_();
  return { employeeCode: code };
}

/** data: {oldEmployeeCode, newSchool (campusId), role, reportsTo,
 *  classSubjects: [{class,subject}, ...]}
 *  Original DateOfJoining and the YY/MM segment of the code carry over
 *  unchanged -- that's how movement between campuses is tracked, per
 *  Uday (2026-08-29). The old row is marked Transferred (excluded from
 *  the roster the same way Inactive is, via employee-roster.gs's Status
 *  filter -- no separate change needed there) and stamped with today's
 *  date in DoRel; a new row is created at the new campus with a fresh
 *  sequence number. */
function transferEmployee_(data, caller) {
  if (!data.oldEmployeeCode || !data.newSchool) {
    throw new Error('oldEmployeeCode and newSchool are required');
  }
  const ss = openEmpWorkbook_();
  const master = ss.getSheetByName('EmpMaster');
  const rows = master.getDataRange().getValues();
  const header = rows[0];
  const codeCol = header.indexOf('EmployeeCode');
  const nameCol = header.indexOf('Name');
  const dojCol = header.indexOf('DateOfJoining');
  const schoolCol = header.indexOf('SchoolCode');
  const statusCol = header.indexOf('Status');
  const dorelCol = header.indexOf('DoRel');

  let oldRowNum = -1, oldName = '', oldDoj = null, oldSchool = '';
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][codeCol] || '').trim() === data.oldEmployeeCode) {
      oldRowNum = i + 1;
      oldName = rows[i][nameCol];
      oldDoj = rows[i][dojCol];
      oldSchool = String(rows[i][schoolCol] || '').trim().toUpperCase();
      break;
    }
  }
  if (oldRowNum === -1) throw new Error('Employee not found: ' + data.oldEmployeeCode);
  assertTransferScope_(caller, oldSchool, data.newSchool);

  const newPrefix = STAFF_SCHOOL_PREFIX[data.newSchool];
  if (!newPrefix) throw new Error('Unknown school: ' + data.newSchool);
  const oldParts = data.oldEmployeeCode.split('/');
  const newCode = buildEmployeeCode_(newPrefix, oldParts[1], oldParts[2]);

  if (statusCol >= 0) master.getRange(oldRowNum, statusCol + 1).setValue('Transferred');
  if (dorelCol >= 0) master.getRange(oldRowNum, dorelCol + 1).setValue(new Date());

  master.appendRow(buildRow_(header, {
    DateOfJoining: oldDoj, SchoolCode: data.newSchool, EmployeeCode: newCode,
    Name: oldName, Role: data.role || '', ReportsTo: data.reportsTo || '', Status: 'Active',
  }));
  appendAcademicRow_(ss, newCode, oldName, data.classSubjects);

  bustStaffListCache_();
  return { employeeCode: newCode };
}

/** data: {employeeCode, dateOfResignation ('YYYY-MM-DD', optional),
 *  dateOfRelieving ('YYYY-MM-DD', optional)}. Never deletes the row --
 *  preserves salary/incentive history that may still reference this
 *  EmployeeCode. */
function markInactive_(data, caller) {
  if (!data.employeeCode) throw new Error('employeeCode is required');
  const master = openEmpWorkbook_().getSheetByName('EmpMaster');
  const rows = master.getDataRange().getValues();
  const header = rows[0];
  const codeCol = header.indexOf('EmployeeCode');
  const schoolCol = header.indexOf('SchoolCode');
  const statusCol = header.indexOf('Status');
  const doresCol = header.indexOf('DoRes');
  const dorelCol = header.indexOf('DoRel');

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][codeCol] || '').trim() !== data.employeeCode) continue;
    const school = String(rows[i][schoolCol] || '').trim().toUpperCase();
    assertScope_(caller, [school]);
    const rowNum = i + 1;
    if (statusCol >= 0) master.getRange(rowNum, statusCol + 1).setValue('Inactive');
    if (doresCol >= 0 && data.dateOfResignation) {
      const d = new Date(data.dateOfResignation);
      if (!isNaN(d.getTime())) master.getRange(rowNum, doresCol + 1).setValue(d);
    }
    if (dorelCol >= 0 && data.dateOfRelieving) {
      const d = new Date(data.dateOfRelieving);
      if (!isNaN(d.getTime())) master.getRange(rowNum, dorelCol + 1).setValue(d);
    }
    bustStaffListCache_();
    return { success: true };
  }
  throw new Error('Employee not found: ' + data.employeeCode);
}

function staffJsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
