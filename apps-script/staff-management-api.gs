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
const STAFF_READ_ACTIONS_ = ['nextcode', 'list', 'detail', 'documentstatus', 'uploadstatus', 'verificationqueue'];

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
    else if (action === 'documentstatus') result = { rows: listDocumentStatus_(caller) };
    else if (action === 'uploadstatus') result = { schools: checkNewUploads_() };
    else if (action === 'verificationqueue') result = { rows: listVerificationQueue_(caller) };
    else if (action === 'reassigncertificate') result = reassignCertificate_(data, caller);
    else if (action === 'autoresolvequeue') result = autoResolveFromResponseSheets_(caller);
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
  // TEMPORARY diagnostic logging (2026-09-24) -- every return path below
  // logs WHY, so the Execution log shows the real cause instead of just
  // "Not authorized" everywhere. Safe to leave (Stackdriver logs cost
  // nothing extra), but remove once the live issue is confirmed fixed.
  if (!idToken) { console.log('verifyStaffManagerToken_: no idToken provided'); return null; }
  try {
    const res = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
      { muteHttpExceptions: true }
    );
    if (res.getResponseCode() !== 200) {
      console.log('verifyStaffManagerToken_: tokeninfo HTTP ' + res.getResponseCode() + ' -- ' + res.getContentText());
      return null;
    }
    const payload = JSON.parse(res.getContentText());
    if (payload.aud !== STAFF_GOOGLE_CLIENT_ID) {
      console.log('verifyStaffManagerToken_: aud mismatch -- got ' + payload.aud + ', expected ' + STAFF_GOOGLE_CLIENT_ID);
      return null;
    }
    if (payload.email_verified !== 'true' && payload.email_verified !== true) {
      console.log('verifyStaffManagerToken_: email_verified is ' + payload.email_verified + ' for ' + payload.email);
      return null;
    }
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
      if (roles.indexOf('Coordinator') === -1 && roles.indexOf('Owner') === -1 && campusId !== 'ALL') {
        console.log('verifyStaffManagerToken_: ' + email + ' is on the allowlist but role="' + role + '" campusId="' + campusId + '" -- not Coordinator/Owner/ALL');
        return null;
      }
      console.log('verifyStaffManagerToken_: OK -- ' + email + ' campusId=' + campusId + ' role=' + role);
      return { email: email, campusId: campusId, role: role, roles: roles };
    }
    console.log('verifyStaffManagerToken_: ' + email + ' verified by Google but NOT found on the allowlist sheet');
    return null; // not on the allowlist at all
  } catch (err) {
    console.log('verifyStaffManagerToken_: threw -- ' + err.message);
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

// The real, fixed set of Document Type values in the "Certificate Links"
// tab, confirmed against a live export 2026-09-24 -- the sheet has NO
// placeholder row for a document that was never uploaded (every single
// row already has a Drive Link), so "missing" can only be worked out by
// checking, per employee, which of these 8 types have zero rows at all.
// If a 9th type is ever added in the sheet, it just won't show up as a
// column here until this list is updated -- there's no way to discover
// new types automatically without also inventing a false "missing" state
// for something that's really just a not-yet-seen category.
const STAFF_DOCUMENT_TYPES = [
  'BACHELORS CERTIFICATE',
  'CLASS 10 BOARD RESULT SHEET',
  'CLASS 12 BOARD RESULT SHEET',
  'MASTER CERTIFICATE',
  'MEDICAL CERTIFICATE',
  'POLICE VERIFICATION CHARACTER CERTIFICATE',
  'Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)',
  'HIGHEST QUALIFICATION',
];

// EmployeeCode -> { documentType: [{filename, driveLink}, ...] } -- only
// types with at least one non-blank Drive Link are present as keys (an
// employee can have more than one file under the same type -- multiple
// scans/re-uploads -- all are kept, not just the first).
function readCertificatesByCode_() {
  const sheet = openEmpWorkbook_().getSheetByName('Certificate Links');
  if (!sheet) return {};
  const rows = sheet.getDataRange().getValues();
  const header = rows[0];
  const codeCol = header.indexOf('Employee Code');
  const typeCol = header.indexOf('Document Type');
  const fileCol = header.indexOf('Filename');
  const linkCol = header.indexOf('Drive Link');
  if (codeCol < 0) return {};
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    const code = String(rows[i][codeCol] || '').trim();
    if (!code) continue;
    const driveLink = linkCol >= 0 ? String(rows[i][linkCol] || '').trim() : '';
    if (!driveLink) continue;
    const type = typeCol >= 0 ? String(rows[i][typeCol] || '').trim() : '';
    if (!map[code]) map[code] = {};
    if (!map[code][type]) map[code][type] = [];
    map[code][type].push({ filename: fileCol >= 0 ? String(rows[i][fileCol] || '').trim() : '', driveLink: driveLink });
  }
  return map;
}

// ── New-upload detection (Uday, 2026-09-24) ──────────────────────────
// Lightweight, read-only signal for whether employees have uploaded
// documents since the "Certificate Links" sheet was last refreshed (that
// refresh itself stays a local, manual step -- drive-index/build_employee
// _cert_links.py + generate_appscript_import.py + re-running
// importCertificateLinks() -- this only tells you WHEN a refresh is
// worth doing, it doesn't automate the refresh itself).
//
// Computed LIVE on every 'uploadstatus' call, deliberately uncached, same
// reasoning as listDocumentStatus_ below: a stale cached number here
// would be actively misleading (the whole point is freshness), and this
// is cheap -- six DriveApp folder walks, not a hot per-keystroke path.
const CENTRAL_REPO_FOLDER_ID_ = '1ogMId6iUIA2WTnnSsEKqj5eDOxqaZeWJ';
const SCHOOL_TO_CAMPUS_DIR_ = {
  'LMS 1': 'LMS 1 - Dhalpur', 'LMS 2': 'LMS 2 - Kelheli', 'LMS 3': 'LMS 3 - Dunkhra',
  'LMS 4': 'LMS 4 - Ner Chowk', 'LMS 5': 'LMS 5 - Sayoli', 'LMS 6': 'LMS 6 - Jogindernagar',
};

function getSubfolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : null;
}

function countFilesRecursive_(folder, depth) {
  if (depth > 6) return 0; // guard against an unexpectedly deep/looping tree
  let count = 0;
  const files = folder.getFiles();
  while (files.hasNext()) { files.next(); count++; }
  const subs = folder.getFolders();
  while (subs.hasNext()) { count += countFilesRecursive_(subs.next(), depth + 1); }
  return count;
}

// Only counts files under subfolders whose name matches one of
// STAFF_DOCUMENT_TYPES -- the Staff Document Submission form also
// collects Aadhar/PAN/driving licence/bank cheque/biodata/hiring slip,
// which the Certificate Links importer deliberately excludes (those
// aren't certificates), so counting them here would show a permanent
// false "drift" even with zero real gap.
function countCertFilesInFormRoot_(formRoot) {
  let count = 0;
  const subs = formRoot.getFolders();
  while (subs.hasNext()) {
    const sub = subs.next();
    const base = sub.getName().replace(/\s*\(\d+\)$/, '').replace(' (File responses)', '').trim().toUpperCase();
    const isCertType = STAFF_DOCUMENT_TYPES.some(function (t) {
      const tu = t.toUpperCase();
      return base === tu || base.indexOf(tu) !== -1 || tu.indexOf(base) !== -1;
    });
    if (isCertType) count += countFilesRecursive_(sub, 0);
  }
  return count;
}

// Returns { 'LMS 1': {driveFileCount, sheetRowCount, delta} | null, ... }
// -- null for a school whose folder chain isn't found (renamed/moved)
// rather than throwing and breaking the whole response for every school.
function checkNewUploads_() {
  const root = DriveApp.getFolderById(CENTRAL_REPO_FOLDER_ID_);

  const sheet = openEmpWorkbook_().getSheetByName('Certificate Links');
  const sheetCounts = {};
  if (sheet) {
    const rows = sheet.getDataRange().getValues();
    const header = rows[0];
    const schoolCol = header.indexOf('School');
    const linkCol = header.indexOf('Drive Link');
    for (let i = 1; i < rows.length; i++) {
      const link = linkCol >= 0 ? String(rows[i][linkCol] || '').trim() : '';
      if (!link) continue;
      const school = schoolCol >= 0 ? String(rows[i][schoolCol] || '').trim() : '';
      if (!school) continue;
      sheetCounts[school] = (sheetCounts[school] || 0) + 1;
    }
  }

  const result = {};
  Object.keys(SCHOOL_TO_CAMPUS_DIR_).forEach(function (school) {
    try {
      const campusFolder = getSubfolder_(root, SCHOOL_TO_CAMPUS_DIR_[school]);
      const empFile = campusFolder && getSubfolder_(campusFolder, 'Employee File - ' + school);
      const formRoot = empFile && getSubfolder_(empFile, school + ' Staff Document Submission form (File responses)');
      if (!formRoot) { result[school] = null; return; }
      const driveFileCount = countCertFilesInFormRoot_(formRoot);
      const sheetRowCount = sheetCounts[school] || 0;
      result[school] = { driveFileCount: driveFileCount, sheetRowCount: sheetRowCount, delta: driveFileCount - sheetRowCount };
    } catch (err) {
      result[school] = null;
    }
  });
  return result;
}

// School-wise document-compliance table (Uday, 2026-09-24): every ACTIVE
// employee the caller can see, with each of STAFF_DOCUMENT_TYPES marked
// uploaded (count + first file's link) or missing -- so gaps are visible
// at a glance instead of having to open each person's detail view one by
// one. Same campus-scoping and AdminTM exclusion as the Directory.
//
// NOT cached (unlike listEmployees_) -- CacheService.put() hard-caps a
// single value at 100KB, and the full ALL-campus payload (up to ~174
// employees x 8 types) came in over that, throwing "Argument too large:
// value" instead of caching (found live, 2026-09-24). This only loads
// once per page visit anyway (not a hot path re-fired per keystroke like
// nextcode), so a plain uncached read is simpler and safe here -- slimmed
// to {count, driveLink of the first file} per type instead of every
// file's full filename+link, both to shrink the response and because
// that's all the frontend actually renders.
function listDocumentStatus_(caller) {
  const rows = openEmpWorkbook_().getSheetByName('EmpMaster').getDataRange().getValues();
  const header = rows[0];
  const idx = {};
  header.forEach(function (h, i) { idx[h] = i; });
  const salaryByCode = readEmpSalaryByCode_();
  const certsByCode = readCertificatesByCode_();
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const code = String(rows[i][idx.EmployeeCode] || '').trim();
    if (!code) continue;
    const school = String(rows[i][idx.SchoolCode] || '').trim().toUpperCase();
    if (caller.campusId !== 'ALL' && school !== caller.campusId) continue;
    const status = (idx.Status >= 0 ? String(rows[i][idx.Status] || '').trim() : '') || 'Active';
    if (status !== 'Active') continue; // departed/transferred staff aren't tracked for document compliance
    const salary = salaryByCode[code] || { designation: '', department: '' };
    if (STAFF_HIDDEN_DEPARTMENTS.indexOf(salary.department) !== -1) continue;
    const docs = certsByCode[code] || {};
    const documents = {};
    STAFF_DOCUMENT_TYPES.forEach(function (t) {
      const files = docs[t];
      documents[t] = files && files.length ? { count: files.length, driveLink: files[0].driveLink } : null;
    });
    out.push({
      employeeCode: code,
      name: String(rows[i][idx.Name] || '').trim(),
      school: school,
      documents: documents,
    });
  }
  return out;
}

// School column in "Certificate Links" is "LMS 1" (with a space), not the
// campusId convention ("LMS1") used everywhere else -- reverse of the
// normalize-on-read done in listVerificationQueue_ below, needed when
// WRITING the School cell back in reassignCertificate_.
const STAFF_CAMPUS_SHEET_LABEL_ = {
  LMS1: 'LMS 1', LMS2: 'LMS 2', LMS3: 'LMS 3', LMS4: 'LMS 4', LMS5: 'LMS 5', LMS6: 'LMS 6', HES: 'HES',
};

// "Needs Verification" queue (Uday, 2026-09-24): every Certificate Links
// row the automated matcher (drive-index/build_employee_cert_links.py)
// couldn't confidently attribute to one person on its own -- either it
// fell back to whoever SUBMITTED the batch ("Matched (submitter-based --
// verify)" -- the "Kamlesh has +16 files" problem: one Fee Clerk uploads
// a whole campus's documents in one go, and every file whose filename
// didn't clearly name the real owner gets attributed to the submitter
// instead) or found no/multiple roster candidates ("Unmatched"/
// "Ambiguous"). Scoped to the caller's campus like everything else here.
// Rows with no Drive Link (the "Unmatched" case has none) are skipped --
// nothing to actually review without a file to open. NOT cached, same
// reasoning as listDocumentStatus_ -- this is a review workflow; a stale
// cached queue would show someone an item that's already been resolved.
function listVerificationQueue_(caller) {
  const sheet = openEmpWorkbook_().getSheetByName('Certificate Links');
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues();
  const header = rows[0];
  const codeCol = header.indexOf('Employee Code');
  const nameCol = header.indexOf('Employee Name');
  const schoolCol = header.indexOf('School');
  const typeCol = header.indexOf('Document Type');
  const fileCol = header.indexOf('Filename');
  const linkCol = header.indexOf('Drive Link');
  const statusCol = header.indexOf('Status');
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const status = statusCol >= 0 ? String(rows[i][statusCol] || '').trim() : '';
    const needsReview = status.indexOf('submitter-based') !== -1 || status.indexOf('Ambiguous') !== -1 || status.indexOf('Unmatched') !== -1;
    if (!needsReview) continue;
    const link = linkCol >= 0 ? String(rows[i][linkCol] || '').trim() : '';
    if (!link) continue; // e.g. "Unmatched" rows have no file to review at all
    // "LMS 1" -> "LMS1", matching the campusId convention used everywhere else.
    const school = (schoolCol >= 0 ? String(rows[i][schoolCol] || '').trim() : '').replace(/\s+/g, '').toUpperCase();
    if (caller.campusId !== 'ALL' && school !== caller.campusId) continue;
    out.push({
      currentEmployeeCode: codeCol >= 0 ? String(rows[i][codeCol] || '').trim() : '',
      currentEmployeeName: nameCol >= 0 ? String(rows[i][nameCol] || '').trim() : '',
      school: school,
      documentType: typeCol >= 0 ? String(rows[i][typeCol] || '').trim() : '',
      filename: fileCol >= 0 ? String(rows[i][fileCol] || '').trim() : '',
      driveLink: link,
      status: status,
    });
  }
  return out;
}

/** data: {filename, documentType, driveLink, newEmployeeCode} -- matches
 *  the row to update by filename+documentType+driveLink together (not
 *  just filename+type) so a queue item built from one specific row can
 *  never accidentally overwrite a different one that happens to share a
 *  filename. Writes the new employee's code/name/school onto that row and
 *  stamps Status with who verified it and when -- distinguishes a human-
 *  confirmed reassignment from the importer's own automated guesses. */
function reassignCertificate_(data, caller) {
  if (!data.filename || !data.documentType || !data.newEmployeeCode) {
    throw new Error('filename, documentType, and newEmployeeCode are required');
  }
  const ss = openEmpWorkbook_();
  const target = readRowByCode_(ss, 'EmpMaster', data.newEmployeeCode);
  if (!target) throw new Error('Employee not found: ' + data.newEmployeeCode);
  const targetSchool = String(target.SchoolCode || '').trim().toUpperCase();
  assertScope_(caller, [targetSchool]);

  const sheet = ss.getSheetByName('Certificate Links');
  if (!sheet) throw new Error('Certificate Links tab not found');
  const rows = sheet.getDataRange().getValues();
  const header = rows[0];
  const codeCol = header.indexOf('Employee Code');
  const nameCol = header.indexOf('Employee Name');
  const schoolCol = header.indexOf('School');
  const typeCol = header.indexOf('Document Type');
  const fileCol = header.indexOf('Filename');
  const linkCol = header.indexOf('Drive Link');
  const statusCol = header.indexOf('Status');

  for (let i = 1; i < rows.length; i++) {
    const filename = fileCol >= 0 ? String(rows[i][fileCol] || '').trim() : '';
    const type = typeCol >= 0 ? String(rows[i][typeCol] || '').trim() : '';
    const link = linkCol >= 0 ? String(rows[i][linkCol] || '').trim() : '';
    if (filename !== data.filename || type !== data.documentType) continue;
    if (data.driveLink && link !== data.driveLink) continue;
    const rowNum = i + 1;
    if (codeCol >= 0) sheet.getRange(rowNum, codeCol + 1).setValue(data.newEmployeeCode);
    if (nameCol >= 0) sheet.getRange(rowNum, nameCol + 1).setValue(target.Name || '');
    if (schoolCol >= 0) sheet.getRange(rowNum, schoolCol + 1).setValue(STAFF_CAMPUS_SHEET_LABEL_[targetSchool] || targetSchool);
    if (statusCol >= 0) sheet.getRange(rowNum, statusCol + 1).setValue('Reassigned (verified by ' + caller.email + ', ' + formatStaffDate_(new Date()) + ')');
    return { success: true };
  }
  throw new Error('Could not find that document row -- it may have already been reassigned by someone else');
}

// ── Auto-resolve from the Form Response sheets (Uday, 2026-09-24) ─────
// The 6 campus "Staff Document Submission form (Responses)" sheets each
// have an Employee Name + Employee ID column filled in SEPARATELY from
// who submitted the form (confirmed live: a row submitted by
// jai.chand@lms.org.in correctly lists NIDHI SINGH / KUL/25/06/108, not
// his own identity) -- that's a 100% reliable owner per file, which the
// importer (drive-index/build_employee_cert_links.py) doesn't use at
// all; it only parses the FILENAME, which is what caused the submitter-
// based misattribution in the first place.
//
// This cross-references by the Drive FILE ID itself (the long token in
// the URL), not by document-type label or filename -- deliberately,
// since the response sheet's own column headers ("Teachers Biodata+
// Proficiency" etc.) don't match STAFF_DOCUMENT_TYPES' category names,
// and a file's ID is unique regardless of which label either sheet uses
// for it. A row is only resolved if the response sheet's Employee ID
// also matches a REAL, current EmpMaster row -- a typo'd/stale ID in the
// response sheet is skipped rather than trusted blindly.
const RESPONSE_SHEET_IDS_ = {
  LMS1: '1PJ2acPOHopbHzzwGes8X4YPWSDBdXnd0zl46zvFCvIg',
  LMS2: '10xxFM1li1-6xzWEBEEPkZIF4MJcilddoVJkEfVbkScM',
  // Uday pasted this same as LMS2's on 2026-09-24 -- using the value
  // already in hiring/index.html's DATASRC_DOC_SHEET_IDS instead, which
  // is a DIFFERENT id and was already working there. Worth confirming
  // with him which is actually correct if this campus resolves nothing.
  LMS3: '1qdQnXrWWTrgnCt82MSk_fN6Fqaox-EoenuF_XToypAc',
  LMS4: '1x8eFlnFcEKaCwF9HMRan_EQwTgSPq9xHubZ7n5vyR8k',
  LMS5: '1-bhS4eu4OHFhRzllsALtWLRWiGFt-KutbNke3nNlCk8',
  LMS6: '1-3_3BT7zHVJXy7UqxwZuZmpzUJp4uaibHNaA7onI0jU',
};

// Drive file IDs are long (25+ char) alphanumeric/-/_ tokens -- matches
// them the same way regardless of URL shape (.../open?id=X or
// .../file/d/X/view), since the two sheets use different link formats.
function extractDriveFileId_(url) {
  if (!url) return null;
  const m = String(url).match(/[-\w]{25,}/);
  return m ? m[0] : null;
}

// fileId -> {employeeCode, employeeName}, built fresh from all 6
// response sheets every run (cheap -- a few thousand cells total, not a
// hot path, this is a manual one-off/occasional cleanup action).
function buildFileIdOwnerMap_() {
  const map = {};
  Object.keys(RESPONSE_SHEET_IDS_).forEach(function (campus) {
    let sheet;
    try { sheet = SpreadsheetApp.openById(RESPONSE_SHEET_IDS_[campus]).getSheets()[0]; } catch (err) { return; }
    const rows = sheet.getDataRange().getValues();
    const header = rows[0];
    const nameCol = header.indexOf('Employee Name');
    const idCol = header.indexOf('Employee ID');
    if (nameCol < 0 || idCol < 0) return;
    for (let i = 1; i < rows.length; i++) {
      const employeeCode = String(rows[i][idCol] || '').trim();
      if (!employeeCode) continue; // can't resolve anything from a row with no ID typed in
      const employeeName = String(rows[i][nameCol] || '').trim();
      for (let c = 0; c < rows[i].length; c++) {
        if (c === nameCol || c === idCol) continue;
        const fileId = extractDriveFileId_(rows[i][c]);
        if (fileId) map[fileId] = { employeeCode: employeeCode, employeeName: employeeName };
      }
    }
  });
  return map;
}

// Walks every "needs verification" row in Certificate Links (same
// definition as listVerificationQueue_) and resolves whichever ones the
// response-sheet cross-reference can confidently answer. Write-gated
// like everything else -- Coordinator/Owner only -- but NOT scoped to
// the caller's own campus, since this is a one-shot bulk cleanup over
// the whole sheet, same as re-running the importer would be.
function autoResolveFromResponseSheets_(caller) {
  const ownerMap = buildFileIdOwnerMap_();
  const ss = openEmpWorkbook_();
  const sheet = ss.getSheetByName('Certificate Links');
  if (!sheet) throw new Error('Certificate Links tab not found');
  const rows = sheet.getDataRange().getValues();
  const header = rows[0];
  const codeCol = header.indexOf('Employee Code');
  const nameCol = header.indexOf('Employee Name');
  const schoolCol = header.indexOf('School');
  const linkCol = header.indexOf('Drive Link');
  const statusCol = header.indexOf('Status');
  let checked = 0, resolved = 0;
  for (let i = 1; i < rows.length; i++) {
    const status = statusCol >= 0 ? String(rows[i][statusCol] || '').trim() : '';
    const needsReview = status.indexOf('submitter-based') !== -1 || status.indexOf('Ambiguous') !== -1 || status.indexOf('Unmatched') !== -1;
    if (!needsReview) continue;
    checked++;
    const fileId = extractDriveFileId_(linkCol >= 0 ? rows[i][linkCol] : '');
    const owner = fileId && ownerMap[fileId];
    if (!owner) continue;
    const target = readRowByCode_(ss, 'EmpMaster', owner.employeeCode);
    if (!target) continue; // response sheet's ID doesn't match a real, current employee -- don't guess
    const targetSchool = String(target.SchoolCode || '').trim().toUpperCase();
    const rowNum = i + 1;
    if (codeCol >= 0) sheet.getRange(rowNum, codeCol + 1).setValue(owner.employeeCode);
    if (nameCol >= 0) sheet.getRange(rowNum, nameCol + 1).setValue(target.Name || owner.employeeName);
    if (schoolCol >= 0) sheet.getRange(rowNum, schoolCol + 1).setValue(STAFF_CAMPUS_SHEET_LABEL_[targetSchool] || targetSchool);
    if (statusCol >= 0) sheet.getRange(rowNum, statusCol + 1).setValue('Resolved via response-sheet cross-reference (' + caller.email + ', ' + formatStaffDate_(new Date()) + ')');
    resolved++;
  }
  return { checked: checked, resolved: resolved };
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

// "Certificate Links" tab (2026-09-24, per Uday) -- one row per SCANNED
// DOCUMENT, not per employee (a person can have several: Aadhar, PAN,
// certificates, etc.), keyed by "Employee Code" (note the space in that
// header, unlike every other tab's "EmployeeCode"). Rows with a blank
// Drive Link are skipped -- no point listing a document that was never
// actually uploaded/linked.
function readCertificateLinks_(ss, code) {
  const sheet = ss.getSheetByName('Certificate Links');
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues();
  const header = rows[0];
  const codeCol = header.indexOf('Employee Code');
  const typeCol = header.indexOf('Document Type');
  const fileCol = header.indexOf('Filename');
  const linkCol = header.indexOf('Drive Link');
  const statusCol = header.indexOf('Status');
  if (codeCol < 0) return [];
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][codeCol] || '').trim() !== code) continue;
    const driveLink = linkCol >= 0 ? String(rows[i][linkCol] || '').trim() : '';
    if (!driveLink) continue;
    out.push({
      documentType: typeCol >= 0 ? String(rows[i][typeCol] || '').trim() : '',
      filename: fileCol >= 0 ? String(rows[i][fileCol] || '').trim() : '',
      driveLink: driveLink,
      status: statusCol >= 0 ? String(rows[i][statusCol] || '').trim() : '',
    });
  }
  return out;
}

// Full per-employee record for the Directory's "view all information" panel
// -- merges EmpMaster with every other per-employee tab in the workbook
// (EmpPersonal: address/DOB/phone; EmpSalary: job info, pay figures
// excluded by design; EmpProfessional: qualifications; EmpKeyNumbers:
// Aadhar/PAN/bank details, shown in full -- per Uday, 2026-09-23, anyone
// who can already open this portal (Owner, or a Coordinator for their own
// campus) is trusted with the full numbers, same as every write action
// here) plus their decoded EmpAcademic class/subject list and Certificate
// Links (scanned document links, added 2026-09-24). Gated behind the same
// verified-token + campus-scope check as every write action in this file,
// which is WHY this can safely return the PII tabs the public
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

  const certificates = readCertificateLinks_(ss, data.employeeCode);
  if (certificates.length) detail.certificates = certificates;

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
