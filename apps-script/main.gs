// ═══════════════════════════════════════════════════════════════════
// LMCS Principal's Daily Reporting — main dispatcher for the single
// "LMCS Principal's Daily Reporting Backend" Apps Script project.
// Powers principals-daily-reporting/index.html (renamed 2026-09-02
// from teacher-ss/, which undersold what this page actually covers).
//
// FINAL architecture as of 2026-09-02 (after two earlier same-day
// attempts: first "shared project, separate files", then "fully
// separate projects per concern" -- both superseded by this, per
// Uday): ONE project, ONE doGet (Apps Script's hard limit), MANY
// per-concern files. Add a new concern (PTI SS, IT SS, Clerk SS,
// Helpers SS, the SS completion/pending tracker, etc.) as ITS OWN NEW
// FILE in this same project, following the naming convention below --
// never a new project, never folded into an unrelated file.
//
// Files in this project (updated 2026-09-09):
//   main.gs            -- this file: doGet dispatch + shared
//                         auth/JSON helpers every concern reuses.
//   teacher-ss.gs       -- Teacher SS (Support Session teacher-
//                         evaluation rubric) dashboard stats -- the
//                         ORIGINAL single-role reader; ss-tracker.gs
//                         below has since generalized this pattern to
//                         all 6 roles, kept separate rather than
//                         merged/deleted since nothing's confirmed
//                         unused yet.
//   principal-dr.gs     -- Principal DR (the principal's own daily
//                         operational report): Month Activities,
//                         Support Session count, Daily Reports
//                         persistence + the Tasks Completed suggestion
//                         lookup, Planned Activities CRUD. Stays ONE
//                         file even as more gets added -- no further
//                         splitting, per Uday.
//   ss-forms-sync.gs    -- Started Run-menu only (keeps every SS Google
//                         Form's Name dropdown + rubric validation
//                         live); now ALSO action=ssformmeta/submitss
//                         (added 2026-09-11) -- the custom-HTML-form
//                         prototype that replaces a role's Google Form
//                         in the portal itself, IT SS first (see its own
//                         header note). Turned out to be THE generic
//                         engine for all 6 roles (Teacher/IT/PTI/Clerk/
//                         Non-Teaching/Driver) via SS_ROLE_CONFIGS,
//                         rather than one file per role as originally
//                         planned -- ss-tracker.gs below AND the new
//                         ssformmeta/submitss actions all reuse that same
//                         config, one source of truth for "what does
//                         this role's data look like" (rubric titles,
//                         name field, where responses live).
//   ss-tracker.gs       -- action=ssdashboard. The SS completion/
//                         compliance tracker across all 6 roles: quota
//                         compliance, Principal Compliance escalation,
//                         per-employee score analysis + drill-down,
//                         rubber-stamp detection. See its own header
//                         for full scope/what's deferred.
//   approvals.gs        -- action=approvalslist/approvaldetail (GET),
//                         submitapproval/addapprovalcomment/
//                         decideapproval (POST). Principal-to-Owner
//                         approval requests (HR/events/financial/
//                         academic/etc) with evidence + a comment
//                         thread. Decide-rights: Owner always, a
//                         Coordinator only if the Allowlist sheet's
//                         CanApprove column (E) is TRUE for them --
//                         see verifyCallerToken_ below and approvals.gs's
//                         own header for the delegation model.
//   hiring.gs           -- action=hiringapplicants/hiringapprovalstatus/
//                         hiringcheckinterviewreport
//                         (GET), updatehiringstatus/hiringrefreshtracker
//                         (POST, latter Owner-only). Hiring
//                         Dashboard: browse the Teaching
//                         Applicants sheet district-scoped, track a
//                         candidate's status, warn-not-block cross-checks
//                         against the Interview Report and per-campus
//                         Document Submission sheets. 'Hired'/'Rejected'
//                         are derived (2026-09-28), not written here --
//                         an Owner deciding the candidate's 'Salary
//                         Offer Approval' request (approvals.gs) is what
//                         determines them -- see hiring.gs's own header.
//   teacher-portal.gs   -- action=myssstats (teacher-ss.gs, not here),
//                         myupcomingevents (principal-dr.gs, not here),
//                         myrankscore. This file specifically: the
//                         composite SS+Regularity performance score --
//                         see its own header for the incentive-engine
//                         connection and the EmployeeCode join-key
//                         reasoning.
//   salary.gs           -- action=salaryepfexemptionstatus/salaryconfig
//                         (GET). Salary Dashboard's offer-letter
//                         calculator (salary/index.html) computes the
//                         FORMULA client-side, but every rate/table it
//                         feeds on (pay scale, DA/ADA, EPF/ESI/RRF,
//                         tuition fees) is read live from Uday's own
//                         "LMCS-Salary-PayScale" Google Sheet via
//                         salaryconfig; salaryepfexemptionstatus is the
//                         one write-adjacent check, reusing approvals.gs's
//                         generic pipeline (category 'EPF Exemption').
//
// Naming convention: shared helpers/constants (this file) have no
// prefix. Concern-specific files use a short prefix matching their
// name (TSS_/tss for teacher-ss.gs, PDR_/pdr for principal-dr.gs, and
// so on for future files) so nothing collides across files sharing
// this one project's global scope.
//
// GATING: every action requires a verified Google ID token, checked
// against the "LMCS Principal Allowlist" sheet -- Principal/
// Coordinator/Owner only, same as every other backend in this portal.
//
// SETUP:
//   1. script.google.com -> New project -> name it "LMCS Principal's
//      Daily Reporting Backend"
//   2. Paste this file in as main.gs, plus every other file listed
//      above as its own file with that exact name
//   3. Deploy -> New deployment -> Web App
//      Execute as: Me | Who has access: Anyone
//      (Apps Script's own access setting isn't the real gate -- the
//      verified-token check inside is)
//   4. Copy the ONE resulting Web App URL into
//      principals-daily-reporting/index.html's PDR_BACKEND_URL
//      constant
// ═══════════════════════════════════════════════════════════════════

const ALLOWLIST_SHEET_ID = '1NZu0ElismFytG395Nxjz29vAz7OfkmJtZhs70bOwT58'; // "LMCS Principal Allowlist"
const GOOGLE_CLIENT_ID = '697999989724-mvi85iobr20g4mm8a8nrjd1rms2o8tf6.apps.googleusercontent.com'; // same client ID assets/auth.js signs in with

// Teacher Portal (added 2026-09-19): the only role that previously
// never passed verifyCallerToken_ at all. Every other action in this
// project (SS dashboards, Principal DR, Hiring, etc.) was implicitly
// Principal/Coordinator/Owner-only simply because verifyCallerToken_
// rejected everyone else -- opening that check to Teacher (below) means
// this allowlist is now the ONLY thing keeping a Teacher scoped to
// their own Approvals requests instead of gaining access to every
// other action by accident. Extend this list, not verifyCallerToken_'s
// role check, when Teacher Portal grows a new self-scoped action.
const PDR_TEACHER_GET_ACTIONS = ['approvalslist', 'approvaldetail', 'approvedleave', 'myssstats', 'myupcomingevents', 'myrankscore', 'myemployeecode'];
const PDR_TEACHER_POST_ACTIONS = ['submitapproval', 'addapprovalcomment', 'deleteapprovalcomment'];
// Fee Clerk (2026-10-22, per Uday): hiring legwork only -- browse, add an applicant, propose interview/demo
// slots (hiring v2: apptpropose, never hiringschedule), upload scanned reports. Never a decision (shortlist,
// accept, reject, revive, Hired): those stay with the Principal.
// Staff (2026-10-25, per Uday): every Active employee signs in from the Employee Master, see pdrStaffFromEmployeeMaster_.
// Non-teaching Staff get Requests, Evaluations and Events only -- no Teacher score (myrankscore). Teacher callers keep the lists above.
const PDR_STAFF_GET_ACTIONS = ['approvalslist', 'approvaldetail', 'myssstats', 'myupcomingevents', 'myemployeecode'];
const PDR_STAFF_POST_ACTIONS = ['submitapproval', 'addapprovalcomment', 'deleteapprovalcomment'];
// EmpSalary.Department -> role (Uday's Q9, 2026-10-25). Not listed (AdminTM, AdminHead, blank...) = no auto sign-in, allowlist only.
// The fallback can only ever produce Teacher or Staff.
const PDR_AUTO_ROLE_BY_DEPARTMENT = { teaching: 'Teacher', adminpti: 'Teacher', adminit: 'Teacher', adminclerk: 'Staff', 'non-teaching': 'Staff', transport: 'Staff' };
// Employee-code prefix -> campus. HES (head office) is deliberately absent: those staff use the allowlist.
const PDR_CAMPUS_BY_PREFIX = { KUL: 'LMS1', KEL: 'LMS2', DUN: 'LMS3', NCM: 'LMS4', SAY: 'LMS5', JOG: 'LMS6' };
const PDR_FEECLERK_GET_ACTIONS = ['hiringapplicants', 'hiringapprovalstatus', 'apptlist'];
const PDR_FEECLERK_POST_ACTIONS = ['hiringaddapplicant', 'apptpropose', 'apptcancel', 'hiringuploadreport'];

function doGet(e) {
  aprResetRequestMemo_(); // 2026-10-01: per-request Approvals-values memo, see approvals.gs's aprValues_
  try {
    const caller = verifyCallerToken_(e.parameter.idToken);
    if (!caller) return jsonOut_({ success: false, error: 'Not authorized' });

    const action = (e.parameter.action || 'teacherstats').toLowerCase();
    // assets/auth.js asks this after an allowlist miss, to open a Teacher/Staff session. Only a caller that came from the
    // Employee Master fallback gets an answer; an allowlisted caller never needs it.
    if (action === 'staffsignin') {
      return jsonOut_(caller.autoSignIn ? { success: true, role: caller.roles[0], campusId: caller.campusId, employeeCode: caller.employeeCode } : { success: false, error: 'Not authorized' });
    }
    if (!pdrIsElevated_(caller) && !pdrLimitedAllows_(caller, action, false)) {
      return jsonOut_({ success: false, error: 'Not authorized' });
    }

    if (action === 'teacherstats') return jsonOut_(teacherSsStats_(caller));
    if (action === 'ssdashboard') return jsonOut_(ssDashboardAll_(caller));
    if (action === 'principaldrload') return jsonOut_(principalDrLoadBundle_(caller, e.parameter.campusId, e.parameter.date));
    if (action === 'principaldrhome') return jsonOut_(principalDrHome_(caller, e.parameter.campusId));
    if (action === 'monthactivities') return jsonOut_(principalDrMonthActivities_(caller, e.parameter.campusId));
    if (action === 'supportsessionstoday') return jsonOut_(principalDrSupportSessionsToday_(caller, e.parameter.campusId, e.parameter.date));
    if (action === 'plannedactivities') return jsonOut_(principalDrPlannedActivities_(caller, e.parameter.campusId));
    if (action === 'yesterdaystasks') return jsonOut_(principalDrYesterdaysTasks_(caller, e.parameter.campusId, e.parameter.date));
    if (action === 'dailyreport') return jsonOut_(principalDrGetDailyReport_(caller, e.parameter.campusId, e.parameter.date));
    if (action === 'approvalslist') return jsonOut_(aprList_(caller));
    if (action === 'approvaldetail') return jsonOut_(aprDetail_(caller, e.parameter.id));
    if (action === 'approvalreferees') return jsonOut_(aprReferees_(caller));
    if (action === 'approvedleave') return jsonOut_(aprLvApprovedLeaveAction_(caller, e.parameter));
    if (action === 'ssformmeta') return jsonOut_(ssFormMeta_(caller, e.parameter.role, e.parameter.school));
    if (action === 'hiringapplicants') return jsonOut_(hiringApplicants_(caller));
    if (action === 'hiringapprovalstatus') return jsonOut_(hiringApprovalStatus_(caller));
    if (action === 'apptlist') return jsonOut_(apptList_(caller));
    if (action === 'hiringcheckinterviewreport') return jsonOut_(hiringCheckInterviewReport_(e.parameter.phone));
    if (action === 'hiringrownotes') return jsonOut_(hiringRowNotes_(e.parameter.row));
    if (action === 'salaryepfexemptionstatus') return jsonOut_({ success: true, approved: salEpfExemptionApproved_(e.parameter.name) });
    if (action === 'salaryconfig') return jsonOut_(salaryConfig_());
    // TEMPORARY diagnostic (2026-09-28) -- remove once the PayScale Table
    // Pre-Basic Pay/Grade Pay parsing issue is confirmed fixed. Trigger
    // from the Salary Dashboard's own browser console (already signed in,
    // so SESSION.idToken is real) with:
    //   fetch(PDR_BACKEND_URL + '?action=diagpayscale&idToken=' + encodeURIComponent(SESSION.idToken)).then(r=>r.json()).then(console.log)
    if (action === 'diagpayscale') return jsonOut_(salDiagnosePayScale_());
    // viewAsCode: Owner Test Mode -- see pdrResolveViewAsCaller_'s own
    // comment. Only ever changes anything if `caller` already verified
    // as Owner; every other caller gets their own real identity back.
    const effectiveCaller = pdrResolveViewAsCaller_(caller, e.parameter.viewAsCode);
    if (action === 'myssstats') return jsonOut_(myTeacherSsStats_(effectiveCaller));
    if (action === 'myupcomingevents') return jsonOut_(myUpcomingEvents_(effectiveCaller));
    if (action === 'myrankscore') return jsonOut_(myRankScore_(effectiveCaller));
    if (action === 'myemployeecode') return jsonOut_(myEmployeeCode_(effectiveCaller));

    return jsonOut_({ success: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonOut_({ success: false, error: err.message });
  }
}

// Writes (Submit, Planned Activities CRUD) go through doPost as a JSON
// body instead of doGet query params -- two reasons: (1) Daily Reports
// payloads carry variable-length arrays (Tasks Completed, Tasks for
// Tomorrow, etc.) that are awkward/unsafe to URL-encode; (2) the
// idToken travels in the body instead of the URL, which is marginally
// better practice for a bearer credential either way. The frontend
// deliberately sends a plain-text body (no Content-Type header) so
// browsers treat it as CORS-safelisted and skip a preflight OPTIONS
// request -- this project has no doOptions, so a preflight would fail.
function doPost(e) {
  aprResetRequestMemo_(); // 2026-10-01: per-request Approvals-values memo, see approvals.gs's aprValues_
  try {
    const body = JSON.parse(e.postData.contents);
    const caller = verifyCallerToken_(body.idToken);
    if (!caller) return jsonOut_({ success: false, error: 'Not authorized' });

    const action = String(body.action || '').toLowerCase();
    if (!pdrIsElevated_(caller) && !pdrLimitedAllows_(caller, action, true)) {
      return jsonOut_({ success: false, error: 'Not authorized' });
    }

    if (action === 'savedailyreport') return jsonOut_(principalDrSaveDailyReport_(caller, body));
    if (action === 'addplannedactivity') return jsonOut_(principalDrAddPlannedActivity_(caller, body));
    if (action === 'setplannedactivitycompleted') return jsonOut_(principalDrSetPlannedActivityCompleted_(caller, body));
    if (action === 'deleteplannedactivity') return jsonOut_(principalDrDeletePlannedActivity_(caller, body));
    if (action === 'submitapproval') return jsonOut_(aprSubmit_(caller, body));
    if (action === 'addapprovalcomment') return jsonOut_(aprAddComment_(caller, body));
    if (action === 'deleteapprovalcomment') return jsonOut_(aprDeleteComment_(caller, body));
    if (action === 'decideapproval') return jsonOut_(aprDecide_(caller, body));
    if (action === 'changehiringreason') return jsonOut_(aprChangeHiringReason_(caller, body));
    if (action === 'closehiring') return jsonOut_(aprCloseHiring_(caller, body));
    if (action === 'archiveapproval') return jsonOut_(aprArchive_(caller, body));
    if (action === 'submitss') return jsonOut_(ssSubmit_(caller, body));
    if (action === 'updatehiringstatus') return jsonOut_(hiringUpdateStatus_(caller, body));
    if (action === 'hiringstarthire') return jsonOut_(hiringStartHire_(caller, body));
    if (action === 'hiringrefreshtracker') return jsonOut_(hiringRefreshTracker_(caller));
    if (action === 'hiringaddapplicant') return jsonOut_(hiringAddApplicant_(caller, body));
    if (action === 'hiringschedule') return jsonOut_(hiringSchedule_(caller, body));
    if (action === 'hiringmarkstage') return jsonOut_(hiringMarkStage_(caller, body));
    if (action === 'hiringsubmitinterview') return jsonOut_(hiringSubmitInterview_(caller, body));
    if (action === 'hiringsubmitdemo') return jsonOut_(hiringSubmitDemo_(caller, body));
    if (action === 'hiringshortlist') return jsonOut_(hiringShortlist_(caller, body));
    if (action === 'hiringrevive') return jsonOut_(hiringRevive_(caller, body));
    if (action === 'hiringuploadreport') return jsonOut_(hiringUploadReport_(caller, body));
    if (action === 'hiringconfirmreject') return jsonOut_(hiringConfirmReject_(caller, body));
    if (action === 'apptpropose') return jsonOut_(apptPropose_(caller, body));
    if (action === 'apptcancel') return jsonOut_(apptCancel_(caller, body));
    if (action === 'apptdecide') return jsonOut_(apptDecide_(caller, body));
    if (action === 'apptcalendarretry') return jsonOut_(apptCalendarRetry_(caller, body));

    return jsonOut_({ success: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonOut_({ success: false, error: err.message });
  }
}

// Verified Google ID token -> {email, campusId, role}, re-derived from
// the allowlist every call. Only Principal/Coordinator/Owner may call
// any action in this project; everyone else (e.g. Teacher role, or not
// on the list) gets null.
//
// CACHED (2026-09-10, speed): this ran on EVERY action across the whole
// portal -- a live UrlFetchApp call to Google's tokeninfo endpoint PLUS
// a full Allowlist sheet scan, every time, even for the SAME token
// across many requests in one sitting (every date change, every
// Planned Activity add/complete/delete, etc.). Both are now cached via
// CacheService: the verified {email,campusId,role} result for THIS
// token (so a repeat call with the same token skips both the network
// call and the sheet read entirely), and the raw Allowlist rows
// separately (so even a first-time/different token on a warm cache
// skips the sheet read). `ponytail:` a 5-minute TTL means a role/campus
// change in the Allowlist sheet, or a revoked principal, takes up to 5
// minutes to take effect instead of immediately -- acceptable for an
// internal ~6-school admin tool; shorten PDR_AUTH_CACHE_SECONDS if that
// ever needs tightening.
const PDR_AUTH_CACHE_SECONDS = 300;

function verifyCallerToken_(idToken) {
  if (!idToken) return null;
  const cache = CacheService.getScriptCache();
  // Cache key is a hash of the token, not the token itself -- a Google ID
  // token JWT is well over CacheService's 250-char key limit.
  const cacheKey = 'pdrauth_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, idToken)
  );
  const cachedCaller = cache.get(cacheKey);
  if (cachedCaller) return JSON.parse(cachedCaller);

  try {
    const res = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
      { muteHttpExceptions: true }
    );
    if (res.getResponseCode() !== 200) return null;
    const payload = JSON.parse(res.getContentText());
    if (payload.aud !== GOOGLE_CLIENT_ID) return null;
    if (payload.email_verified !== 'true' && payload.email_verified !== true) return null;
    const email = (payload.email || '').toLowerCase();

    const rows = pdrAllowlistRows_();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0] || '').trim().toLowerCase() !== email) continue;
      const campusId = String(rows[i][2] || '').trim().toUpperCase();
      // Multi-role (2026-09-19, per Uday): the Allowlist's role cell can
      // hold a comma-separated list, e.g. "Coordinator,Teacher" -- for
      // someone who genuinely needs both a management role's access AND
      // their own personal Teacher-Portal self-service. `role` stays the
      // raw cell (used verbatim as a display string, e.g. Comments'
      // authorRole in approvals.gs); `roles` is the parsed array every
      // permission check below should use. A single-role cell like
      // "Teacher" parses to a 1-element array, so every existing row
      // keeps working unchanged -- this was never a data migration.
      const role = String(rows[i][3] || '').trim();
      const roles = role.split(',').map(function (r) { return r.trim(); }).filter(Boolean);
      // Name (column B) added to the caller object 2026-09-19 for
      // myTeacherSsStats_ -- matching a Teacher's own SS submissions
      // needs their display name, not just email/campusId/role.
      const name = String(rows[i][1] || '').trim();
      // Teacher added 2026-09-19 for the Teacher Portal -- see
      // PDR_TEACHER_GET_ACTIONS/PDR_TEACHER_POST_ACTIONS and
      // pdrIsTeacherOnly_() below, which are what actually keep a
      // Teacher-only caller scoped to their own requests.
      if (!roles.some(function (r) { return r === 'Principal' || r === 'Coordinator' || r === 'Owner' || r === 'Teacher' || r === 'FeeClerk'; })) return null;
      // Column E (added 2026-09-10, Approvals delegation) -- a
      // Coordinator with this TRUE can decide approvals same as Owner;
      // Uday flips this cell by hand to delegate/revoke. Blank/FALSE
      // (including every pre-existing row before this column existed)
      // is "not delegated" -- fails safe.
      const canApprove = String(rows[i][4] || '').trim().toUpperCase() === 'TRUE';
      const caller = { email: email, campusId: campusId, role: role, roles: roles, name: name, canApprove: canApprove };
      cache.put(cacheKey, JSON.stringify(caller), PDR_AUTH_CACHE_SECONDS);
      return caller;
    }
    // Not on the allowlist: the Employee Master fallback (off unless STAFF_AUTO_SIGNIN is exactly 'on'). An allowlist row, even one
    // with an unrecognised role (returned null above), always wins -- this runs only when there is no row at all.
    const staff = pdrStaffFromEmployeeMaster_(email);
    if (!staff) return null;
    const caller = { email: staff.email, campusId: staff.campusId, role: staff.roles[0], roles: staff.roles, name: '', canApprove: false, employeeCode: staff.employeeCode, autoSignIn: true };
    cache.put(cacheKey, JSON.stringify(caller), PDR_AUTH_CACHE_SECONDS);
    return caller;
  } catch (err) {
    return null;
  }
}

// Employee Master fallback for the allowlist: AuthEmail (EmpPersonal) -> code, Active in EmpMaster, role from EmpSalary.Department.
// Returns {email, campusId, roles:[role], employeeCode} or null. Never logs emails or codes.
// ponytail: three sheet reads per uncached sign-in; the caller result is cached per token for PDR_AUTH_CACHE_SECONDS like an allowlist caller.
function pdrStaffFromEmployeeMaster_(email) {
  if (PropertiesService.getScriptProperties().getProperty('STAFF_AUTO_SIGNIN') !== 'on') return null;
  email = String(email || '').trim().toLowerCase();
  const code = email && tpAuthEmailToCode_()[email];
  if (!code) return null;
  const campusId = PDR_CAMPUS_BY_PREFIX[code.split('/')[0]];
  if (!campusId) return null;
  const book = SpreadsheetApp.openById(TP_EMP_SHEET_ID);
  const cell = function (v) { return String(v || '').replace(/[\u200B-\u200F\uFEFF\u2060]/g, '').trim(); }; // same cleaning as ss-forms-sync.gs normalizeCell_
  const find = function (tab, valueCol) { // -> the valueCol cell of this code's row, or null
    const rows = book.getSheetByName(tab).getDataRange().getValues();
    const codeAt = rows[0].indexOf('EmployeeCode'), valAt = rows[0].indexOf(valueCol);
    if (codeAt < 0 || valAt < 0) return null;
    for (let i = 1; i < rows.length; i++) if (cell(rows[i][codeAt]) === code) return cell(rows[i][valAt]);
    return null;
  };
  if ((find('EmpMaster', 'Status') || '').toLowerCase() !== 'active') return null;
  const role = PDR_AUTO_ROLE_BY_DEPARTMENT[(find('EmpSalary', 'Department') || '').toLowerCase()];
  if (!role) return null;
  return { email: email, campusId: campusId, roles: [role], employeeCode: code };
}

// Shared role-membership check -- every permission check in this
// project (and approvals.gs, same Apps Script project/global scope)
// should call this instead of comparing caller.role directly, now that
// a caller can hold more than one role.
function callerHasRole_(caller, role) {
  return !!caller && caller.roles.indexOf(role) !== -1;
}

// "Is this caller's ONLY actionable role Teacher" -- i.e. do they lack
// every elevated role, so Teacher-only scoping (PDR_TEACHER_*_ACTIONS,
// and approvals.gs's self-scoped list/detail/comment branches) should
// apply. Someone with "Coordinator,Teacher" is NOT teacher-only -- they
// keep their full Coordinator-level access, Teacher is additive for
// their own personal requests, not a downgrade.
function pdrIsTeacherOnly_(caller) {
  return (callerHasRole_(caller, 'Teacher') || callerHasRole_(caller, 'Staff')) // Staff (auto sign-in) is scoped exactly like a Teacher
    && !callerHasRole_(caller, 'Principal')
    && !callerHasRole_(caller, 'Coordinator')
    && !callerHasRole_(caller, 'Owner');
}

// Principal, Coordinator or Owner -- the roles with the full action set. Everyone else (Teacher, FeeClerk)
// is limited to the explicit lists above, see pdrLimitedAllows_.
function pdrIsElevated_(caller) {
  return callerHasRole_(caller, 'Principal') || callerHasRole_(caller, 'Coordinator') || callerHasRole_(caller, 'Owner');
}

// A non-elevated caller may call an action only if one of their limited roles lists it.
function pdrLimitedAllows_(caller, action, isPost) {
  const lists = [];
  if (callerHasRole_(caller, 'Teacher')) lists.push(isPost ? PDR_TEACHER_POST_ACTIONS : PDR_TEACHER_GET_ACTIONS);
  if (callerHasRole_(caller, 'Staff')) lists.push(isPost ? PDR_STAFF_POST_ACTIONS : PDR_STAFF_GET_ACTIONS);
  if (callerHasRole_(caller, 'FeeClerk')) lists.push(isPost ? PDR_FEECLERK_POST_ACTIONS : PDR_FEECLERK_GET_ACTIONS);
  return lists.some(function (l) { return l.indexOf(action) !== -1; });
}

// Who may "view as" an employee in the Teacher Portal, and how far (2026-10-08, per Uday -- the
// Teacher Portal is the lowest tier, so every tier above it can open it):
//   'network' -- Owner, Coordinator, or a Principal whose campusId is 'ALL': any employee.
//   'school'  -- a Principal locked to one school: employees of THAT school only.
//   null      -- everyone else (a plain Teacher): nobody.
// Mirrors LMCS.viewAsScope in assets/auth.js (UI only) -- keep the two in sync; this one is the boundary.
function pdrViewAsScope_(caller) {
  if (callerHasRole_(caller, 'Owner') || callerHasRole_(caller, 'Coordinator')) return 'network';
  if (callerHasRole_(caller, 'Principal')) return caller.campusId === 'ALL' ? 'network' : 'school';
  return null;
}

// "Owner Test Mode" (2026-09-20, per Uday; widened 2026-10-08 to Coordinator + Principal, see
// pdrViewAsScope_ above) -- lets an Owner view the
// Teacher Portal's READ-ONLY display data (Rank/Evaluations/CW-HW
// Patterns/Timetable, via myrankscore/myssstats/myupcomingevents/
// myemployeecode) AS a specific EMPLOYEE, for QA without ever touching
// that person's credentials. Resolves by EmployeeCode against the
// Employee Roster Proxy -- NOT the Allowlist -- so it works for any of
// the ~173 people in the Employee Master workbook, not just the
// handful who happen to already be entered on this portal's own
// Allowlist with a Teacher role (that first version only ever had ONE
// usable entry: Uday's own test row).
//
// viewAsCode is client-supplied but is ONLY ever honored once `caller`
// has already been verified via a real Google ID token AND found to
// hold a role pdrViewAsScope_ allows, and (for a school-scoped
// Principal) the viewed employee is at the caller's own school -- anyone
// else passing this param is simply ignored, never trusted on its own
// (the caller just gets their own data back); this is the one place in
// the whole project where the returned "effective caller" can differ
// from the actual verified caller, and it's deliberately narrow:
// read-only actions only. Never wired into submitapproval/
// addapprovalcomment/decideapproval -- an Owner can already see every
// teacher's real Requests through the existing campus-wide Approvals
// view (aprList_'s campusId==='ALL' branch), so there's no legitimate
// reason to let this touch write actions, and doing so would blur
// who-actually-submitted-what in the audit trail.
//
// The returned object carries `employeeCode` explicitly --
// tpResolveCallerEmployeeCode_ (teacher-portal.gs) checks that FIRST,
// before its normal AuthEmail/name resolution, so myssstats/
// myrankscore/myemployeecode all use the viewed person's real code
// directly instead of trying to re-resolve Owner's own identity under
// a borrowed name (which would silently resolve back to OWNER's own
// AuthEmail match -- caller.email is deliberately left as Owner's own
// below, not the viewed person's, specifically so nothing downstream
// can mistake this for a real sign-in as them).
function pdrResolveViewAsCaller_(caller, viewAsCode) {
  const scope = viewAsCode ? pdrViewAsScope_(caller) : null;
  if (!scope) return caller;
  const code = String(viewAsCode).trim();
  try {
    const res = UrlFetchApp.fetch(TP_EMPLOYEE_ROSTER_URL + '?action=employees', { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return caller;
    const data = JSON.parse(res.getContentText());
    if (!data.success || !Array.isArray(data.employees)) return caller;
    const emp = data.employees.filter(function (e) { return e.employeeCode === code; })[0];
    if (!emp || !emp.school) return caller;
    const campusId = 'LMS' + String(emp.school).replace('LMS', '').trim(); // 'LMS 2' -> 'LMS2'
    if (scope === 'school' && campusId !== caller.campusId) return caller; // a school-scoped Principal can't view another school
    return {
      email: caller.email, campusId: campusId, role: 'Teacher', roles: ['Teacher'],
      name: emp.name, employeeCode: emp.employeeCode, canApprove: false, viewedAsBy: caller.email,
    };
  } catch (err) { return caller; } // resolution failure -- keep the real caller rather than erroring the whole request
}

// Allowlist sheet rows, cached separately from the per-token result
// above -- covers the still-uncached case (a token seen for the first
// time, or after its own cache entry expired) so it doesn't pay for a
// full sheet read when another user's request already warmed this.
function pdrAllowlistRows_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('pdr_allowlist_rows');
  if (cached) return JSON.parse(cached);
  const rows = SpreadsheetApp.openById(ALLOWLIST_SHEET_ID).getSheets()[0].getDataRange().getValues();
  cache.put('pdr_allowlist_rows', JSON.stringify(rows), PDR_AUTH_CACHE_SECONDS);
  return rows;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// 2026-10-06, per Uday: keep-warm. Google drops this (large, 10+ file) project's web-app
// instance when idle, and the next request then stalls for 20-60s or comes back as an HTML
// error page. A timer that calls the web app's own URL every 5 minutes keeps it warm.
// Run pdrInstallKeepWarmTrigger ONCE from the editor (it asks for the trigger permission);
// re-running it is safe, it replaces the old trigger instead of adding a second.
function pdrKeepWarm() {
  try {
    UrlFetchApp.fetch(ScriptApp.getService().getUrl() + '?action=ping', { muteHttpExceptions: true });
  } catch (err) { /* best-effort: a missed ping just means one cold start later */ }
}

function pdrInstallKeepWarmTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'pdrKeepWarm') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('pdrKeepWarm').timeBased().everyMinutes(5).create();
}
