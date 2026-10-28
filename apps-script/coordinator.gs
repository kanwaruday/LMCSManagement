// ═══════════════════════════════════════════════════════════════════
// LMCS Coordinator Backend -- its OWN Apps Script project (not the PDR
// project), so the Principals' Portal backend is never touched or put at
// risk by Coordinator work. Powers coordinator/index.html.
// Plan: vault work/active/lmcs-management.md, "Coordinator Portal &
// Role-Based Restructure".
//
// ONE generic task store, many "adapters": an adapter reads some source
// data, upserts one task per problem (deterministic TaskId, so a re-run
// never duplicates), and auto-resolves tasks whose problem has cleared.
// Source data is only ever READ, never written: from other backends over HTTP with the
// caller's own ID token where one has an endpoint, or (the Approvals tab, which sits in the
// same workbook as Tasks) straight from the sheet. Adapters: SS compliance (PDR's
// action=ssdashboard), approvals bottleneck (Approvals tab), hiring stalls and
// complete-hire (Teaching Applicants + Approvals + Employee Master, read-only),
// and document compliance (Employee Master workbook, read-only). Transport has a page but no adapter (coordinator-transport.gs).
//
// Actions: GET action=coordinatortasks, GET action=coordinatoracademics (CW/HW tag analysis),
// GET action=coordinatordocuments (document compliance page),
// GET action=coordinatortransport (fleet document compliance; logic in coordinator-transport.gs),
// GET action=coordinatortransportfleet + POST action=coordinatortransportfleetsave (Fleet setup quests, coordinator-transport.gs),
// GET + POST action=coordinatortransportrollcall (daily duty roll call, coordinator-transport.gs),
// POST action=coordinatorresolvetask.
// Coordinator or Owner only; a locked Coordinator sees their district. The one exception is the daily-report issues of
// coordinator-principal.gs (GET principalissues, POST principalissueresolve), which also admit a Principal of one campus.
//
// SETUP:
//   1. script.google.com -> New project -> "LMCS Coordinator Backend",
//      paste this file as coordinator.gs
//   2. Deploy -> New deployment -> Web App, Execute as: Me, access: Anyone
//      (the verified-token check below is the real gate)
//   3. Put the resulting URL in coordinator/index.html's COORD_BACKEND_URL
// The "Tasks" tab creates itself inside the LMCS Approvals workbook.
//
// ponytail: thresholds below are defaults, not decisions -- tune them.
// ═══════════════════════════════════════════════════════════════════

const COORD_SHEET_ID = '1Tr4Rfc6DN698eeGVjuCoXfSRR-NhBTWJibR00Ibj6P4'; // "LMCS Approvals" workbook; only the Tasks tab is used
const COORD_TAB = 'Tasks';
const COORD_HEADERS = ['TaskId', 'Domain', 'Campus', 'Title', 'Detail', 'Status', 'Severity',
  'CreatedAt', 'LastSeenAt', 'ResolvedAt', 'ResolvedBy', 'Notes', 'Department', 'Assignee', 'Due'];

// Departments follow the vault's Departments hubs, plus Systems. Every follow-up carries one so the
// landing page can group by department; adapters set it, approvals by request category.
const COORD_DEPT_HR = 'HR & Staff', COORD_DEPT_ACADEMICS = 'Academics & Examination', COORD_DEPT_FINANCE = 'School Financials',
  COORD_DEPT_EVENTS = 'Events & House System', COORD_DEPT_OPS = 'School Operations';
const COORD_APPROVAL_DEPT = {
  'New/ Backup Position': COORD_DEPT_HR, 'Salary Offer Approval': COORD_DEPT_HR, 'Compensation Change': COORD_DEPT_HR,
  'Disciplinary / Termination': COORD_DEPT_HR, 'Compensatory Leave': COORD_DEPT_HR, 'Leave': COORD_DEPT_HR, 'EPF Exemption': COORD_DEPT_HR,
  'Financial / Purchase': COORD_DEPT_FINANCE, 'Academic Change': COORD_DEPT_ACADEMICS,
  'Event / Invitation': COORD_DEPT_EVENTS, 'Off-Campus Trip / Excursion': COORD_DEPT_EVENTS, 'Holiday / Calendar': COORD_DEPT_EVENTS,
}; // anything else ('Other', new categories) lands in School Operations
// Fallback for tasks created before the Department column existed.
const COORD_DOMAIN_DEPT = { ss_compliance: COORD_DEPT_HR, hiring_stall: COORD_DEPT_HR, complete_hire: COORD_DEPT_HR,
  doc_missing: COORD_DEPT_HR, doc_none: COORD_DEPT_HR, doc_verify: COORD_DEPT_HR };

const COORD_ALLOWLIST_SHEET_ID = '1NZu0ElismFytG395Nxjz29vAz7OfkmJtZhs70bOwT58'; // "LMCS Principal Allowlist" (same as PDR's ALLOWLIST_SHEET_ID)
const COORD_GOOGLE_CLIENT_ID = '697999989724-mvi85iobr20g4mm8a8nrjd1rms2o8tf6.apps.googleusercontent.com'; // same as assets/auth.js
const COORD_PDR_URL = 'https://script.google.com/macros/s/AKfycbzpkFLy4KvTdSJfioz6wlgRGLjvO_GvbffhOYBb-hHybFtjGTk0ps-GzXz0FrQ9GmYdfg/exec'; // PDR backend, read-only use

// Same district grouping as hiring.gs's HIR_DISTRICT_CAMPUSES.
const COORD_DISTRICTS = {
  LMS1: ['LMS1', 'LMS2', 'LMS3'], LMS2: ['LMS1', 'LMS2', 'LMS3'], LMS3: ['LMS1', 'LMS2', 'LMS3'],
  LMS4: ['LMS4', 'LMS5', 'LMS6'], LMS5: ['LMS4', 'LMS5', 'LMS6'], LMS6: ['LMS4', 'LMS5', 'LMS6'],
};

const COORD_SS_MEDIUM_BELOW_PCT = 70; // campus+role quota compliance under this -> medium task
const COORD_SS_HIGH_BELOW_PCT = 40;   // ... under this -> high
const COORD_SS_GRACE_DAYS = 10;       // first N days of a month: nobody can have met a 2/month quota yet, so don't flag or resolve
const COORD_SS_REFRESH_CACHE_SECONDS = 600;

// Approvals bottleneck, in whole days. Pending = waiting on the decider; Info Requested = waiting on the requester.
const COORD_APR_PENDING_MEDIUM_DAYS = 3;
const COORD_APR_PENDING_HIGH_DAYS = 7;
const COORD_APR_URGENT_MEDIUM_DAYS = 1; // requests marked Urgent get tighter limits
const COORD_APR_URGENT_HIGH_DAYS = 3;
const COORD_APR_INFO_MEDIUM_DAYS = 5;
const COORD_APR_INFO_HIGH_DAYS = 10;
const COORD_APR_REFRESH_CACHE_SECONDS = 300;

// Hiring. Sheet IDs/columns mirror hiring.gs (HIR_SHEET_ID, HIR_SHEET_GID, HIR_COL, HIR_ROSTER_SHEET_ID).
const COORD_HIRING_SHEET_ID = '1aSCQ3IGO-ZP_5yRjtnMpZdlauTdWj3814ATD9qwskPQ'; // "Teaching Applicants"
const COORD_HIRING_SHEET_GID = 1181288827;
const COORD_ROSTER_SHEET_ID = '1OjVMUvpLM8JkdAwjmljCtZUI1VUqGLbic36cW9dm0C0'; // Employee Master workbook; EmpMaster tab
const COORD_HIRE_SOON_DAYS = 3;       // complete-hire task turns medium once joining is this close (or past)
const COORD_HIRE_OVERDUE_HIGH_DAYS = 3; // ... and high once joining was this many days ago
const COORD_STALL_MEDIUM_DAYS = 3;    // approved to hire but not yet marked Hired
const COORD_STALL_HIGH_DAYS = 7;
const COORD_HIRING_REFRESH_CACHE_SECONDS = 300;

// Document compliance (Employee Master workbook: EmpMaster, EmpSalary, Certificate Links tabs).
// Required = what the Hiring Dashboard already insists on for every new hire, restricted to the
// types Certificate Links tracks: medical, police verification, and at least one qualification.
const COORD_DOC_REQUIRED = ['MEDICAL CERTIFICATE', 'POLICE VERIFICATION CHARACTER CERTIFICATE'];
const COORD_DOC_QUALIFICATION_ANY = ['BACHELORS CERTIFICATE', 'MASTER CERTIFICATE',
  'Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)', 'HIGHEST QUALIFICATION'];
const COORD_DOC_HIDDEN_DEPARTMENTS = ['admintm']; // hidden from the Staff Portal too (staff-management-api.gs)
const COORD_DOC_MEDIUM_SHARE = 0.10; // share of a campus's active staff missing something -> medium
const COORD_DOC_HIGH_SHARE = 0.30;   // ... -> high
const COORD_VERIFY_MEDIUM_FILES = 5; // files awaiting verification at one campus -> medium
const COORD_VERIFY_HIGH_FILES = 15;  // ... -> high
const COORD_DOCS_REFRESH_CACHE_SECONDS = 600;

// Document compliance PAGE (coordinatordocuments): every uploaded scan and every missing required document,
// per employee. Reads the consolidated "Staff Document Submission" responses workbook's one-row-per-file "Documents"
// tab (coordDocsFromTable_; falls back to the per-campus tabs if it doesn't exist yet), not Certificate Links.
const COORD_DOCS_WORKBOOK_ID = '1PJ2acPOHopbHzzwGes8X4YPWSDBdXnd0zl46zvFCvIg';
const COORD_DOCS_TABS = ['LMS 1', 'LMS 2', 'LMS 3', 'LMS 4', 'LMS 5', 'LMS 6'];
// Response-sheet header -> document type. The sheet repeats its document columns (teacher form and non-teacher form), so
// several headers map to one type and a type counts as uploaded if ANY of them holds a link. First match wins.
const COORD_DOCS_TYPE_RULES = [
  [/SIGNED JOB ROLE/, 'Signed job roles'], [/SERVICE CONTRACT/, 'Service contract'],
  [/BIODATA/, 'Bio-Data'], [/HIRING SLIP/, 'Hiring Slip'],
  [/CLASS 10/, 'Class 10 result'], [/CLASS 12/, 'Class 12 result'],
  [/BACHELOR/, 'Bachelors certificate'], [/MASTER CERT/, 'Master certificate'],
  [/PROFESSIONAL DEGREE/, 'Professional degree'], [/HIGHEST QUALIFICATION/, 'Highest qualification'],
  [/PAN CARD/, 'PAN card'], [/AADHAR/, 'Aadhar card'], [/CANCELLED CHEQUE|BANK COPY/, 'Bank / cancelled cheque'],
  [/POLICE VERIFICATION|CHARACTER CERT/, 'Police verification'], [/MEDICAL CERT/, 'Medical certificate'],
  [/TET DOCUMENT/, 'TET document'], [/EXPERIENCE CERT/, 'Experience certificate'],
  [/LAST SALARY/, 'Last salary certificate'], [/DRIVING LICEN/, 'Driving licence'],
];
// Required = the old Hiring Dashboard list (8 documents). NOTE 2026-10-25: the Hired gate now needs only the Bio-Data (hiring.gs
// hirBioDataOnFile_); the rest is the Documents matrix's per-designation checklist. This list is the Coordinator page's own view -- align it with
// the matrix rules (review #13) when that page is next touched;
// the qualification slot is met by any one of the four qualification types.
const COORD_DOCS_QUALIFICATION = ['Bachelors certificate', 'Master certificate', 'Professional degree', 'Highest qualification'];
const COORD_DOCS_REQUIRED = ['Bio-Data', 'Hiring Slip', 'PAN card', 'Aadhar card', 'Bank / cancelled cheque',
  'Qualification certificate', 'Police verification', 'Medical certificate'];
const COORD_DOCS_PAGE_CACHE_SECONDS = 600;

// Academics (CW/HW tag analysis). The public CW/HW feed is ~14 MB, so it is fetched, reduced to
// a per-teacher table and cached (gzipped) -- the page never downloads the raw feed.
const COORD_CWHW_URL = 'https://script.google.com/macros/s/AKfycbyYk0uDnp-PHdUDdOh5-KfD2xK1ahYCQ_vt7SJigQMhSA3DSs5t5v_q4tnseoZKw3_L/exec'; // same feed the Teacher portal reads
const COORD_ROSTER_URL = 'https://script.google.com/macros/s/AKfycbyHiaZY_iWK2VTKKFJcCsBNnIbUndJYUSjnPkxvJ-dYavaihiul2xBJuJohPRsP9Spf/exec'; // Employee Roster Proxy, public action=employees
const COORD_LMS_IDX = ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6']; // cwRecords' lmsIdx -> campus (same map as teacher-portal.gs)
const COORD_ACADEMICS_CACHE_SECONDS = 10800; // 3 h

function coordJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    const action = String(e.parameter.action || '').toLowerCase();
    if (action === 'principalissues') return coordJson_(coordPrincipalIssuesGet_(e.parameter.idToken)); // its own gates (coordinator-principal.gs)
    if (action === 'transportworld') return coordJson_(coordWorld_(coordWorldCaller_(e.parameter.idToken))); // its own gate: transport staff or a Principal (coordinator-world.gs)
    const caller = coordVerifyCaller_(e.parameter.idToken);
    if (!caller) return coordJson_({ success: false, error: 'Not authorized' });
    if (caller.feeClerkOnly && ['coordinatortransport', 'coordinatorbuslive', 'coordinatorbuschecks', 'coordinatortransportloadout', 'coordinatortransportfleet', 'coordinatortransportrollcall'].indexOf(action) === -1) return coordJson_({ success: false, error: 'Not authorized' }); // Fee Clerks: transport data only
    if (action === 'coordinatortasks') return coordJson_(coordTasksList_(caller, e.parameter.idToken));
    if (action === 'coordinatoracademics') return coordJson_(coordAcademics_(caller, e.parameter.window));
    if (action === 'coordinatordocuments') return coordJson_(coordDocuments_(caller));
    if (action === 'coordinatortransport') return coordJson_(coordTransport_(caller));
    if (action === 'coordinatorbuslive') return coordJson_(coordBusLive_(caller));
    if (action === 'coordinatorbuschecks') return coordJson_(coordGpsClerkChecks_(caller));
    if (action === 'coordinatortransportinsight') return coordJson_(coordGpsInsight_(caller));
    if (action === 'coordinatortransportloadout') return coordJson_(coordLoadout_(caller)); // the safety loadout list: every transport role reads it
    if (action === 'coordinatortransportfleet') return coordJson_(coordFleet_(caller)); // Fleet setup quests: the caller's campuses
    if (action === 'coordinatortransportrollcall') return coordJson_(coordRollCall_(caller, e.parameter.date)); // daily duty roll call: the caller's campuses
    if (action === 'coordinatorpdr') return coordJson_(coordPdr_(caller));
    if (action === 'coordinatorpdrday') return coordJson_(coordPdrDay_(caller, e.parameter.date));
    if (action === 'coordinatortrackrecord') return coordJson_(coordTrackRecordGet_(caller));
    if (action === 'coordinatordecision') return coordJson_(coordDecision_(caller, e.parameter.id));
    return coordJson_({ success: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return coordJson_({ success: false, error: err.message });
  }
}

// Plain-text JSON body (no Content-Type) so the browser skips a preflight; this project has no doOptions.
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    // the drive-index sync on Uday's Mac pushes transport data here with a shared secret, not a Google ID token
    if (String(body.action || '').toLowerCase() === 'transportpush') return coordJson_(coordTransportPush_(body));
    if (String(body.action || '').toLowerCase() === 'pdrpush') return coordJson_(coordPdrPush_(body));
    if (String(body.action || '').toLowerCase() === 'pdrtagpush') return coordJson_(coordPdrTagPush_(body));
    if (String(body.action || '').toLowerCase() === 'transportgpsconfig') return coordJson_(coordBusConfig_(body));
    if (String(body.action || '').toLowerCase() === 'transportpushcheck') return coordJson_(coordTransportPushCheck_(body));
    if (String(body.action || '').toLowerCase() === 'transportgpspush') return coordJson_(coordGpsPush_(body));
    if (String(body.action || '').toLowerCase() === 'transportcapturepull') return coordJson_(coordCapturePull_(body)); // capture.py on the Mac
    if (String(body.action || '').toLowerCase() === 'transportcapturepush') return coordJson_(coordCapturePush_(body));
    if (String(body.action || '').toLowerCase() === 'transportcatalogpush') return coordJson_(coordCatalogPush_(body)); // agency_import.py on the Mac
    if (String(body.action || '').toLowerCase() === 'principalissueresolve') return coordJson_(coordPrincipalResolve_(coordVerifyPrincipal_(body.idToken), body)); // Principal gate only
    const caller = coordVerifyCaller_(body.idToken);
    if (caller && String(body.action || '').toLowerCase() === 'transportclerkcheck') return coordJson_(coordGpsClerkAnswer_(caller, body)); // Fee Clerks too
    if (caller && String(body.action || '').toLowerCase() === 'coordinatortransportfleetsave') return coordJson_(coordFleetSave_(caller, body)); // Fee Clerks too (own campus, checked inside)
    if (caller && String(body.action || '').toLowerCase() === 'coordinatortransportrollcall') return coordJson_(coordRollCallSave_(caller, body)); // Fee Clerks too (own campus, checked inside)
    if (!caller || caller.feeClerkOnly) return coordJson_({ success: false, error: 'Not authorized' });
    const action = String(body.action || '').toLowerCase();
    if (action === 'coordinatorpdrissue') return coordJson_(coordPdrIssueAction_(caller, body));
    if (action === 'coordinatorpdrmerge') return coordJson_(coordPdrMerge_(caller, body));
    if (action === 'coordinatorallocate') return coordJson_(coordAprAllocate_(caller, body));
    if (action === 'coordinatorresolvetask') return coordJson_(coordTaskResolve_(caller, body));
    if (action === 'coordinatortransportloadout') return coordJson_(coordLoadoutSet_(caller, body)); // Owner only (checked inside)
    if (action === 'coordinatorrecommend') return coordJson_(coordRecommend_(caller, body));
    return coordJson_({ success: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return coordJson_({ success: false, error: err.message });
  }
}

// ── Auth ─────────────────────────────────────────────────────────────
// Verified Google ID token -> {email, campusId, roles}, re-derived from the
// allowlist; null unless the caller is a Coordinator or Owner. Cached 5 min
// (a role change in the allowlist takes up to 5 min to apply).
function coordVerifyCaller_(idToken) {
  if (!idToken) return null;
  const cache = CacheService.getScriptCache();
  const key = 'coordauth_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, idToken));
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  try {
    const email = coordTokenEmail_(idToken);
    if (!email) return null;
    const rows = SpreadsheetApp.openById(COORD_ALLOWLIST_SHEET_ID).getSheets()[0].getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0] || '').trim().toLowerCase() !== email) continue;
      const roles = String(rows[i][3] || '').split(',').map(function (r) { return r.trim(); }).filter(Boolean);
      // A FeeClerk (Fee Clerk Portal) may read the transport data of their own campus or comma list, nothing else (2026-10-21).
      const feeClerkOnly = roles.indexOf('Coordinator') === -1 && roles.indexOf('Owner') === -1;
      if (feeClerkOnly && roles.indexOf('FeeClerk') === -1) return null;
      const canDecide = roles.indexOf('Owner') !== -1 || (roles.indexOf('Coordinator') !== -1 && String(rows[i][4] || '').trim().toUpperCase() === 'TRUE'); // same rule as aprCanDecide_ in approvals.gs
      const caller = { email: email, campusId: String(rows[i][2] || '').trim().toUpperCase(), roles: roles, canDecide: canDecide, feeClerkOnly: feeClerkOnly };
      cache.put(key, JSON.stringify(caller), 300);
      return caller;
    }
    return null;
  } catch (err) {
    return null;
  }
}

/** Google ID token -> the lower-cased email it was issued to, or null unless Google verifies it, it was issued to this
 *  portal (aud) and the email is present and verified. Shared by coordVerifyCaller_ and coordVerifyPrincipal_ (coordinator-principal.gs). */
function coordTokenEmail_(idToken) {
  try {
    const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    const payload = JSON.parse(res.getContentText());
    if (payload.aud !== COORD_GOOGLE_CLIENT_ID) return null;
    if (payload.email_verified !== 'true' && payload.email_verified !== true) return null;
    const email = String(payload.email || '').trim().toLowerCase();
    return email || null; // a missing email must never match a blank allowlist row
  } catch (err) {
    return null;
  }
}

// null = every campus (Owner / ALL); otherwise the campuses the caller may see
function coordVisibleCampuses_(caller) {
  if (caller.campusId === 'ALL') return null;
  if (caller.feeClerkOnly) return caller.campusId.split(',').map(function (c) { return c.trim(); }); // own campus or comma list, never a district
  return COORD_DISTRICTS[caller.campusId] || [caller.campusId];
}

// ── Task store ───────────────────────────────────────────────────────
function coordSheet_() {
  const ss = SpreadsheetApp.openById(COORD_SHEET_ID);
  let sh = ss.getSheetByName(COORD_TAB);
  if (!sh) {
    sh = ss.insertSheet(COORD_TAB);
    sh.getRange(1, 1, 1, COORD_HEADERS.length).setValues([COORD_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else if (!sh.getRange(1, COORD_HEADERS.length).getValue()) {
    sh.getRange(1, COORD_HEADERS.length).setValue(COORD_HEADERS[COORD_HEADERS.length - 1]).setFontWeight('bold'); // tab made before the Department column
  }
  return sh;
}

// 'LMS 2' -> 'LMS2' (SS data uses the spaced form, sessions/allowlist the compact one)
function coordCampusId_(school) {
  return 'LMS' + String(school).replace('LMS', '').trim();
}

/** Creates the task if its TaskId is new; refreshes Title/Detail/Severity/LastSeenAt if it is
 *  open; leaves a resolved one alone (a manual resolve sticks for that TaskId). Caller holds the lock. */
function coordTaskUpsert_(sh, rows, t) {
  const now = new Date();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] !== t.taskId) continue;
    if (rows[i][5] !== 'open') return;
    sh.getRange(i + 1, 4, 1, 2).setValues([[t.title, t.detail]]);
    sh.getRange(i + 1, 7).setValue(t.severity);
    sh.getRange(i + 1, 9).setValue(now);
    sh.getRange(i + 1, 13).setValue(t.department);
    return;
  }
  const row = [t.taskId, t.domain, t.campus, t.title, t.detail, 'open', t.severity, now, now, '', '', '', t.department, t.assignee || '', ''];
  sh.appendRow(row);
  if (t.due) { sh.getRange(rows.length + 1, 15).setNumberFormat('@').setValue(t.due); row[14] = t.due; } // text: appendRow would make it a Date
  rows.push(row);
}

/** The Due cell as yyyy-MM-dd: older rows may hold a Date (Sheets converts ISO text written without a text format). */
function coordDueIso_(v) {
  return v instanceof Date ? Utilities.formatDate(v, 'Asia/Kolkata', 'yyyy-MM-dd') : String(v || '').slice(0, 10);
}

/** Open tasks of `domain` on a campus in `covered` (null = every campus) whose TaskId is not in
 *  `liveIds` get resolved by the system. Only campuses the source data actually covered are
 *  touched, so a refresh that saw a narrower scope never closes tasks it couldn't see. */
function coordTasksAutoResolve_(sh, rows, domain, covered, liveIds) {
  const now = new Date();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] !== domain || rows[i][5] !== 'open' || (covered && !covered[rows[i][2]]) || liveIds[rows[i][0]]) continue;
    sh.getRange(i + 1, 6).setValue('resolved');
    sh.getRange(i + 1, 10, 1, 2).setValues([[now, 'system (condition cleared)']]);
    rows[i][5] = 'resolved';
  }
}

// ── Adapter: SS compliance (reads PDR's action=ssdashboard) ──────────
// One task per (campus, month) with any role under the quota threshold; the detail lists the roles.
function coordRefreshSsCompliance_(idToken) {
  const cache = CacheService.getScriptCache();
  if (cache.get('coord_ss_refreshed')) return;
  if (new Date().getDate() <= COORD_SS_GRACE_DAYS) return;

  let dash;
  try {
    const res = UrlFetchApp.fetch(COORD_PDR_URL + '?action=ssdashboard&idToken=' + encodeURIComponent(idToken), { muteHttpExceptions: true });
    dash = JSON.parse(res.getContentText());
  } catch (err) { return; } // PDR cold start / HTML error page: skip this refresh, list what we already have
  if (!dash || !dash.success) return;

  const wanted = [];
  const covered = {};
  const byCampus = {}; // one task per (campus, month) listing every role behind quota, not one per role
  Object.keys(dash.roles).forEach(function (roleKey) {
    const d = dash.roles[roleKey];
    d.campusCompliance.forEach(function (c) {
      const campus = coordCampusId_(c.formKey);
      covered[campus] = true;
      if (!c.totalEmployees || c.compliancePct >= COORD_SS_MEDIUM_BELOW_PCT) return;
      const key = campus + '|' + d.monthLabel;
      const g = byCampus[key] = byCampus[key] || { campus: campus, formKey: c.formKey, month: d.monthLabel, high: false, parts: [] };
      if (c.compliancePct < COORD_SS_HIGH_BELOW_PCT) g.high = true;
      g.parts.push(d.label + ' ' + c.metQuota + '/' + c.totalEmployees + ' (' + c.compliancePct + '%)');
    });
  });
  Object.keys(byCampus).forEach(function (key) {
    const g = byCampus[key];
    wanted.push({
      taskId: 'ss_compliance|' + key,
      domain: 'ss_compliance', department: COORD_DEPT_HR,
      campus: g.campus,
      title: 'Support Sessions behind quota at ' + g.formKey,
      detail: g.parts.join('; ') + ' met quota - ' + g.month,
      severity: g.high ? 'high' : 'medium',
    });
  });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = coordSheet_();
    const rows = sh.getDataRange().getValues();
    const live = {};
    wanted.forEach(function (t) { live[t.taskId] = true; coordTaskUpsert_(sh, rows, t); });
    coordTasksAutoResolve_(sh, rows, 'ss_compliance', covered, live);
  } finally { lock.releaseLock(); }
  cache.put('coord_ss_refreshed', '1', COORD_SS_REFRESH_CACHE_SECONDS);
}

// ── Adapter: approvals bottleneck (reads the Approvals tab directly) ──
// The Approvals tab sits in the same workbook as the Tasks tab, so it is read here directly
// (read-only, every campus) instead of through PDR's caller-scoped approvalslist -- no PDR
// load, no PDR change. Column positions follow approvals.gs's own layout.
// One task per request still waiting: TaskId includes the status, so a request that moves
// Pending -> Info Requested gets a fresh task, and the old one auto-resolves.
function coordApprovalWanted_(rows, now) {
  const wanted = [], byKey = {};
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const status = String(r[13] || '');
    const waitingOn = status === 'Pending' ? 'a decision' : status === 'Info Requested' ? 'the requester' : '';
    if (!waitingOn || String(r[18] || '').toUpperCase() === 'TRUE') continue;
    const since = new Date(status === 'Pending' ? r[12] : (r[15] || r[12]));
    if (isNaN(since.getTime())) continue;
    const days = Math.floor((now.getTime() - since.getTime()) / 86400000);
    const urgent = String(r[3] || '') === 'Urgent';
    const med = status === 'Pending' ? (urgent ? COORD_APR_URGENT_MEDIUM_DAYS : COORD_APR_PENDING_MEDIUM_DAYS) : COORD_APR_INFO_MEDIUM_DAYS;
    const high = status === 'Pending' ? (urgent ? COORD_APR_URGENT_HIGH_DAYS : COORD_APR_PENDING_HIGH_DAYS) : COORD_APR_INFO_HIGH_DAYS;
    if (days < med) continue;
    const campus = String(r[1] || '').trim();
    const key = coordAprCopyKey_(r);
    const sev = days >= high ? 'high' : 'medium';
    if (byKey[key]) { byKey[key].ids.push(r[0]); if (sev === 'high') byKey[key].task.severity = 'high'; continue; }
    const task = {
      taskId: 'approval|' + r[0] + '|' + status,
      domain: 'approval', department: COORD_APPROVAL_DEPT[String(r[2])] || COORD_DEPT_OPS,
      campus: campus, category: String(r[2]), days: days, waitingOn: waitingOn,
      detail: '"' + String(r[4]) + '" - ' + status + (urgent ? ', marked Urgent' : '') + ' since ' + Utilities.formatDate(since, 'Asia/Kolkata', 'd MMM'),
      severity: sev,
    };
    byKey[key] = { task: task, ids: [r[0]] };
    wanted.push(task);
  }
  wanted.forEach(function (t) {
    const g = byKey[Object.keys(byKey).filter(function (k) { return byKey[k].task === t; })[0]], copies = g.ids.length;
    t.title = t.category + ' request' + (copies > 1 ? ' (' + copies + ' identical copies)' : '') + ' waiting ' + t.days + (t.days === 1 ? ' day' : ' days') + ' for ' + t.waitingOn + ' (' + t.campus + ')';
    if (copies > 1) t.detail += '. Submitted ' + copies + ' times (' + g.ids.join(', ') + '): decide one and withdraw the rest.';
    delete t.category; delete t.days; delete t.waitingOn;
  });
  return wanted;
}

/** The same request submitted several times (same campus, category, text, status and day) is one follow-up, not one per copy.
 *  Approvals row -> that grouping key; the day is when it started waiting (submitted, or info asked for). */
function coordAprCopyKey_(r) {
  const status = String(r[13] || ''), since = new Date(status === 'Pending' ? r[12] : (r[15] || r[12]));
  return [String(r[1] || '').trim(), r[2], r[4], status, isNaN(since.getTime()) ? '' : since.toISOString().slice(0, 10)].join('|');
}

function coordRefreshApprovals_() {
  const cache = CacheService.getScriptCache();
  if (cache.get('coord_apr_refreshed')) return;
  const src = SpreadsheetApp.openById(COORD_SHEET_ID).getSheetByName('Approvals');
  if (!src) return;
  const wanted = coordApprovalWanted_(src.getDataRange().getValues(), new Date());

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = coordSheet_();
    const rows = sh.getDataRange().getValues();
    const live = {};
    wanted.forEach(function (t) { live[t.taskId] = true; coordTaskUpsert_(sh, rows, t); });
    coordTasksAutoResolve_(sh, rows, 'approval', null, live);
  } finally { lock.releaseLock(); }
  cache.put('coord_apr_refreshed', '1', COORD_APR_REFRESH_CACHE_SECONDS);
}

// ── Adapter: hiring (Teaching Applicants + Approvals + Employee Master, read-only) ──
// Two kinds of task, both keyed by the applicant's T-0000 id (the sheet row, as hiring.gs does):
//  - hiring_stall: the Owner approved the salary offer (after the MD interview) days ago, yet the
//    candidate is still not marked Hired -- documents or the Principal's final click are pending.
//  - complete_hire: marked Hired, but the permanent employee code is not in the Employee Master
//    yet -- the Coordinator still has to add the person in the Staff Portal. Due by the joining date.
// applicantRows/approvalRows include their header row; rosterCodes is every EmployeeCode, uppercased.
function coordHiringWanted_(applicantRows, approvalRows, rosterCodes, now) {
  const offerCampus = {}, approvedAt = {};
  for (let i = 1; i < approvalRows.length; i++) {
    const r = approvalRows[i];
    if (String(r[2]) !== 'Salary Offer Approval') continue;
    const m = String(r[7] || '').match(/T-\d{4}/);
    if (!m) continue;
    const campus = String(r[1] || '').trim().toUpperCase();
    if (campus && campus !== 'ALL') offerCampus[m[0]] = campus;
    if (String(r[13]) === 'Approved' && r[15]) approvedAt[m[0]] = new Date(r[15]);
  }
  const have = {};
  rosterCodes.forEach(function (c) { have[c] = true; });
  const fmt = function (d) { return Utilities.formatDate(d, 'Asia/Kolkata', 'd MMM'); };

  const wanted = [];
  for (let i = 1; i < applicantRows.length; i++) {
    const r = applicantRows[i];
    const status = String(r[10] || '').trim();
    if (status === 'Rejected') continue;
    const id = 'T-' + String(i + 1).padStart(4, '0');
    const name = String(r[1] || '').trim() || id;
    const branches = String(r[5] || '').match(/LMS-(\d)/);
    const campus = offerCampus[id] || (branches ? 'LMS' + branches[1] : 'ALL');

    if (status === 'Hired') {
      const code = String(r[15] || '').trim().toUpperCase();
      if (code && have[code]) continue;
      let dojText = '', severity = 'medium';
      const dojRaw = r[16];
      const doj = dojRaw instanceof Date ? dojRaw : (/^\d{4}-\d{2}-\d{2}$/.test(String(dojRaw || '').trim()) ? new Date(String(dojRaw).trim() + 'T00:00:00+05:30') : null);
      if (doj && !isNaN(doj.getTime())) {
        const daysTo = Math.ceil((doj.getTime() - now.getTime()) / 86400000);
        dojText = daysTo >= 0 ? 'joining ' + fmt(doj) + ' (in ' + daysTo + ' days)' : 'joined ' + fmt(doj) + ' (' + (-daysTo) + ' days ago)';
        severity = -daysTo >= COORD_HIRE_OVERDUE_HIGH_DAYS ? 'high' : (daysTo <= COORD_HIRE_SOON_DAYS ? 'medium' : 'low');
      } else { dojText = 'no joining date recorded'; }
      wanted.push({
        taskId: 'complete_hire|' + id, domain: 'complete_hire', department: COORD_DEPT_HR, campus: campus,
        title: 'Complete hire in Staff Portal: ' + name + ' (' + campus + ')',
        detail: 'Marked Hired, ' + (code || 'no employee code') + ' not in Employee Master yet; ' + dojText,
        severity: severity,
      });
      continue;
    }

    // An approval from BEFORE the candidate's last revival (column T, Revived At) belongs to an earlier round -- it must
    // not make this round look stalled (hirIsHiringApproved_ ignores it the same way).
    const revivedAt = r[19] ? new Date(r[19]) : null;
    if (approvedAt[id] && revivedAt && !isNaN(revivedAt.getTime()) && approvedAt[id] < revivedAt) continue;
    if (approvedAt[id] && r[13]) { // approved to hire after the MD interview, but not Hired yet
      const days = Math.floor((now.getTime() - approvedAt[id].getTime()) / 86400000);
      if (days < COORD_STALL_MEDIUM_DAYS) continue;
      wanted.push({
        taskId: 'hiring_stall|' + id, domain: 'hiring_stall', department: COORD_DEPT_HR, campus: campus,
        title: name + ' approved to hire ' + days + ' days ago, still not marked Hired (' + campus + ')',
        detail: 'Salary offer approved ' + fmt(approvedAt[id]) + '; waiting on documents or the Principal marking Hired',
        severity: days >= COORD_STALL_HIGH_DAYS ? 'high' : 'medium',
      });
    }
  }
  return wanted;
}

function coordRefreshHiring_() {
  const cache = CacheService.getScriptCache();
  if (cache.get('coord_hiring_refreshed')) return;
  const tab = SpreadsheetApp.openById(COORD_HIRING_SHEET_ID).getSheets().find(function (t) { return t.getSheetId() === COORD_HIRING_SHEET_GID; });
  const approvals = SpreadsheetApp.openById(COORD_SHEET_ID).getSheetByName('Approvals');
  const empMaster = SpreadsheetApp.openById(COORD_ROSTER_SHEET_ID).getSheetByName('EmpMaster');
  if (!tab || !approvals || !empMaster) return;
  const emp = empMaster.getDataRange().getValues();
  const codeCol = emp[0].indexOf('EmployeeCode');
  const codes = [];
  for (let i = 1; i < emp.length && codeCol !== -1; i++) {
    const c = String(emp[i][codeCol] || '').trim().toUpperCase();
    if (c) codes.push(c);
  }
  if (!codes.length) return; // an unreadable roster must never look like "nobody has been added"
  const wanted = coordHiringWanted_(tab.getDataRange().getValues(), approvals.getDataRange().getValues(), codes, new Date());

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = coordSheet_();
    const rows = sh.getDataRange().getValues();
    const live = {};
    wanted.forEach(function (t) { live[t.taskId] = true; coordTaskUpsert_(sh, rows, t); });
    coordTasksAutoResolve_(sh, rows, 'complete_hire', null, live);
    coordTasksAutoResolve_(sh, rows, 'hiring_stall', null, live);
  } finally { lock.releaseLock(); }
  cache.put('coord_hiring_refreshed', '1', COORD_HIRING_REFRESH_CACHE_SECONDS);
}

// ── Adapter: document compliance (Employee Master workbook, read-only) ──
// Three roll-up tasks per campus per month (a task per person would be hundreds):
//  - doc_missing: staff who have SOME certificates on file but lack a required one (see
//    COORD_DOC_REQUIRED) -- the fixable, recent kind of gap.
//  - doc_none: staff with no certificates on file at all. Certificate Links only covers people
//    who used the upload form, so this is a long-standing backlog; always low severity so it
//    never drowns out the real gaps.
//  - doc_verify: certificate files the importer could not attribute with confidence, still
//    waiting in the Staff Portal's Needs Verification tab.
// The month is in the TaskId, so "resolved" only silences a campus for that month.
// empRows/salaryRows/certRows include their header row.
function coordDocumentWanted_(empRows, salaryRows, certRows, now) {
  const month = Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM');
  const col = function (rows, name) { return rows[0].indexOf(name); };

  const dept = {};
  const sCode = col(salaryRows, 'EmployeeCode'), sDept = col(salaryRows, 'Department');
  for (let i = 1; i < salaryRows.length && sCode !== -1 && sDept !== -1; i++) {
    dept[String(salaryRows[i][sCode] || '').trim()] = String(salaryRows[i][sDept] || '').trim().toLowerCase();
  }

  const docs = {}; // code -> { type: true }
  const cCode = col(certRows, 'Employee Code'), cType = col(certRows, 'Document Type'), cLink = col(certRows, 'Drive Link');
  const cStatus = col(certRows, 'Status'), cSchool = col(certRows, 'School');
  const verify = {}; // campus -> files awaiting verification
  for (let i = 1; i < certRows.length; i++) {
    const r = certRows[i];
    const link = cLink >= 0 ? String(r[cLink] || '').trim() : '';
    if (!link) continue;
    const code = cCode >= 0 ? String(r[cCode] || '').trim() : '';
    if (code) { docs[code] = docs[code] || {}; docs[code][String(r[cType] || '').trim()] = true; }
    const status = cStatus >= 0 ? String(r[cStatus] || '') : '';
    if (status.indexOf('submitter-based') !== -1 || status.indexOf('Ambiguous') !== -1 || status.indexOf('Unmatched') !== -1) {
      const campus = String(r[cSchool] || '').replace(/\s+/g, '').toUpperCase();
      if (campus) verify[campus] = (verify[campus] || 0) + 1;
    }
  }

  const eCode = col(empRows, 'EmployeeCode'), eName = col(empRows, 'Name'), eSchool = col(empRows, 'SchoolCode'), eStatus = col(empRows, 'Status');
  const staff = {}, missing = {}, none = {}; // campus -> active count / [{name, lacks[]}] / [name]
  for (let i = 1; i < empRows.length; i++) {
    const r = empRows[i];
    const code = String(r[eCode] || '').trim();
    if (!code) continue;
    if ((eStatus >= 0 ? String(r[eStatus] || '').trim() : '') && String(r[eStatus]).trim() !== 'Active') continue;
    if (COORD_DOC_HIDDEN_DEPARTMENTS.indexOf(dept[code] || '') !== -1) continue;
    const campus = String(r[eSchool] || '').trim().toUpperCase();
    if (!campus) continue;
    staff[campus] = (staff[campus] || 0) + 1;
    const have = docs[code] || {};
    if (!Object.keys(have).length) { (none[campus] = none[campus] || []).push(String(r[eName] || code).trim()); continue; }
    const lacks = COORD_DOC_REQUIRED.filter(function (t) { return !have[t]; }).map(function (t) { return t.split(' ')[0].toLowerCase(); });
    if (!COORD_DOC_QUALIFICATION_ANY.some(function (t) { return have[t]; })) lacks.push('qualification');
    if (lacks.length) { (missing[campus] = missing[campus] || []).push({ name: String(r[eName] || code).trim(), lacks: lacks }); }
  }

  const wanted = [];
  Object.keys(missing).forEach(function (campus) {
    const list = missing[campus], share = list.length / staff[campus];
    const shown = list.slice(0, 6).map(function (m) { return m.name + ' (' + m.lacks.join(', ') + ')'; }).join('; ');
    wanted.push({
      taskId: 'doc_missing|' + campus + '|' + month, domain: 'doc_missing', department: COORD_DEPT_HR, campus: campus,
      title: campus + ': ' + list.length + ' of ' + staff[campus] + ' staff missing required documents',
      detail: shown + (list.length > 6 ? '; and ' + (list.length - 6) + ' more' : ''),
      severity: share >= COORD_DOC_HIGH_SHARE ? 'high' : (share >= COORD_DOC_MEDIUM_SHARE ? 'medium' : 'low'),
    });
  });
  Object.keys(none).forEach(function (campus) {
    const list = none[campus];
    wanted.push({
      taskId: 'doc_none|' + campus + '|' + month, domain: 'doc_none', department: COORD_DEPT_HR, campus: campus,
      title: campus + ': ' + list.length + ' of ' + staff[campus] + ' staff have no certificates on file',
      detail: list.slice(0, 6).join(', ') + (list.length > 6 ? ', and ' + (list.length - 6) + ' more' : '') + '. Not on the upload form yet, so nothing is linked for them',
      severity: 'low',
    });
  });
  Object.keys(verify).forEach(function (campus) {
    const n = verify[campus];
    wanted.push({
      taskId: 'doc_verify|' + campus + '|' + month, domain: 'doc_verify', department: COORD_DEPT_HR, campus: campus,
      title: campus + ': ' + n + ' certificate files need verification',
      detail: 'Files the importer could not attribute with confidence; review them in the Staff Portal, Needs Verification tab',
      severity: n >= COORD_VERIFY_HIGH_FILES ? 'high' : (n >= COORD_VERIFY_MEDIUM_FILES ? 'medium' : 'low'),
    });
  });
  return wanted;
}

function coordRefreshDocuments_() {
  const cache = CacheService.getScriptCache();
  if (cache.get('coord_docs_refreshed')) return;
  const ss = SpreadsheetApp.openById(COORD_ROSTER_SHEET_ID);
  const emp = ss.getSheetByName('EmpMaster'), sal = ss.getSheetByName('EmpSalary'), cert = ss.getSheetByName('Certificate Links');
  if (!emp || !sal || !cert) return;
  const certRows = cert.getDataRange().getValues();
  const empRows = emp.getDataRange().getValues();
  if (certRows.length < 2 || empRows.length < 2) return; // an unreadable/empty source must never look like "all clear" or "everyone is missing"
  const wanted = coordDocumentWanted_(empRows, sal.getDataRange().getValues(), certRows, new Date());

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = coordSheet_();
    const rows = sh.getDataRange().getValues();
    const live = {};
    wanted.forEach(function (t) { live[t.taskId] = true; coordTaskUpsert_(sh, rows, t); });
    coordTasksAutoResolve_(sh, rows, 'doc_missing', null, live);
    coordTasksAutoResolve_(sh, rows, 'doc_none', null, live);
    coordTasksAutoResolve_(sh, rows, 'doc_verify', null, live);
  } finally { lock.releaseLock(); }
  cache.put('coord_docs_refreshed', '1', COORD_DOCS_REFRESH_CACHE_SECONDS);
}

// ── Academics: CW/HW tag analysis (descriptive; the "ideal pattern" comparison comes later) ──
// Same name rule as the Teacher portal / teacher-portal.gs's tpNormalizeName_.
function coordNormName_(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+(maam|ma'am|mam|madam|sir)\s*$/i, '').replace(/\s+/g, ' ').trim();
}

function coordSplitTags_(v) {
  return String(v || '').split(',').map(function (t) { return t.trim(); }).filter(Boolean);
}

/** feed = the CW/HW feed ({cwRecords, ayStart}); employees = roster [{employeeCode, name, school:'LMS 1'}].
 *  Returns, per window ('ay' = since the academic year start, 'd30' = last 30 days):
 *  {teachers:[{key, code, name, campus, matched, entries, days, lastDate, cwN, hwN, cw:{tag:n}, hw:{tag:n},
 *  groups:{'Class 5 | Math': {n, cwN, hwN, cw, hw}}}], tags:{cw:[...], hw:[...]}}.
 *  A tag count is the number of entries carrying that tag (an entry may carry several); cwN/hwN are the
 *  entries that carry any tag on that side, so cw[tag]/cwN is the share of that teacher's CW work.
 *  Names that don't match the roster are kept as their own unmatched rows, never dropped. */
function coordAcademicsAggregate_(feed, employees, now) {
  const roster = {};
  employees.forEach(function (e) {
    const k = String(e.school).replace(/\s+/g, '') + '|' + coordNormName_(e.name);
    if (!roster[k]) roster[k] = { code: e.employeeCode, name: e.name };
  });
  const ayStart = new Date(String(feed.ayStart) + 'T00:00:00+05:30').getTime();
  const cutoffs = { ay: ayStart, d30: now.getTime() - 30 * 86400000 };
  const out = {}, seenTags = { ay: { cw: {}, hw: {} }, d30: { cw: {}, hw: {} } };
  Object.keys(cutoffs).forEach(function (w) { out[w] = {}; });

  feed.cwRecords.forEach(function (r) {
    const campus = COORD_LMS_IDX[r.lmsIdx];
    if (!campus) return;
    const hit = roster[campus + '|' + coordNormName_(r.teacher)];
    const key = hit ? hit.code : 'unmatched|' + campus + '|' + coordNormName_(r.teacher);
    const cw = coordSplitTags_(r.cwTag), hw = coordSplitTags_(r.hwTag);
    const group = (r.classMapped || '-') + ' | ' + (r.subject || '-');
    Object.keys(cutoffs).forEach(function (w) {
      if (r.timeMs < cutoffs[w]) return;
      const t = out[w][key] || (out[w][key] = {
        key: key, code: hit ? hit.code : '', name: hit ? hit.name : String(r.teacher || '').trim(), campus: campus, matched: !!hit,
        entries: 0, days: 0, lastDate: '', cwN: 0, hwN: 0, cw: {}, hw: {}, groups: {}, _days: {},
      });
      const g = t.groups[group] || (t.groups[group] = { n: 0, cwN: 0, hwN: 0, cw: {}, hw: {} });
      t.entries++; g.n++;
      if (!t._days[r.dateStr]) { t._days[r.dateStr] = true; t.days++; }
      if (r.dateStr > t.lastDate) t.lastDate = r.dateStr;
      if (cw.length) { t.cwN++; g.cwN++; }
      if (hw.length) { t.hwN++; g.hwN++; }
      cw.forEach(function (x) { t.cw[x] = (t.cw[x] || 0) + 1; g.cw[x] = (g.cw[x] || 0) + 1; seenTags[w].cw[x] = true; });
      hw.forEach(function (x) { t.hw[x] = (t.hw[x] || 0) + 1; g.hw[x] = (g.hw[x] || 0) + 1; seenTags[w].hw[x] = true; });
    });
  });

  const result = {};
  Object.keys(cutoffs).forEach(function (w) {
    const teachers = Object.keys(out[w]).map(function (k) { const t = out[w][k]; delete t._days; return t; });
    teachers.sort(function (a, b) { return b.entries - a.entries; });
    result[w] = { teachers: teachers, tags: { cw: Object.keys(seenTags[w].cw).sort(), hw: Object.keys(seenTags[w].hw).sort() } };
  });
  return result;
}

// CacheService values are capped at 100 KB, so the gzipped JSON is stored in chunks.
function coordCachePutBig_(key, obj, seconds) {
  const b64 = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(obj), 'application/json')).getBytes());
  const parts = Math.ceil(b64.length / 90000), m = {};
  m[key + '_n'] = String(parts);
  for (let i = 0; i < parts; i++) m[key + '_' + i] = b64.slice(i * 90000, (i + 1) * 90000);
  CacheService.getScriptCache().putAll(m, seconds);
}

function coordCacheGetBig_(key) {
  const cache = CacheService.getScriptCache();
  const n = parseInt(cache.get(key + '_n'), 10);
  if (!n) return null;
  const keys = [];
  for (let i = 0; i < n; i++) keys.push(key + '_' + i);
  const got = cache.getAll(keys);
  let b64 = '';
  for (let i = 0; i < n; i++) { if (!got[keys[i]]) return null; b64 += got[keys[i]]; }
  return JSON.parse(Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(b64), 'application/x-gzip')).getDataAsString());
}

function coordFetchJson_(url) {
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('HTTP ' + res.getResponseCode() + ' from ' + url.slice(0, 60));
  return JSON.parse(res.getContentText());
}

// action=coordinatoracademics&window=ay|d30
function coordAcademics_(caller, win) {
  win = win === 'd30' ? 'd30' : 'ay';
  let all = coordCacheGetBig_('coord_academics');
  if (!all) {
    const feed = coordFetchJson_(COORD_CWHW_URL);
    const roster = coordFetchJson_(COORD_ROSTER_URL + '?action=employees');
    if (!feed || !Array.isArray(feed.cwRecords) || !roster.success || !Array.isArray(roster.employees)) throw new Error('CW/HW or roster source returned something unexpected');
    all = coordAcademicsAggregate_(feed, roster.employees, new Date());
    all.generated = feed.generated;
    all.ayStart = feed.ayStart;
    coordCachePutBig_('coord_academics', all, COORD_ACADEMICS_CACHE_SECONDS);
  }
  const visible = coordVisibleCampuses_(caller);
  const w = all[win];
  return {
    success: true, window: win, generated: all.generated, ayStart: all.ayStart, tags: w.tags,
    teachers: w.teachers.filter(function (t) { return !visible || visible.indexOf(t.campus) !== -1; }),
  };
}

// ── Document compliance page: per-employee scans and gaps ──
function coordDocType_(header) {
  const h = String(header || '').toUpperCase().replace(/\s+/g, ' ').trim();
  for (let i = 0; i < COORD_DOCS_TYPE_RULES.length; i++) if (COORD_DOCS_TYPE_RULES[i][0].test(h)) return COORD_DOCS_TYPE_RULES[i][1];
  return '';
}

function coordLinks_(cell) { return String(cell == null ? '' : cell).match(/https?:\/\/[^\s,;]+/g) || []; }

/** empRows/salaryRows include their header row; responses = {'LMS1': rows incl. header, ...} (campus ids, no space).
 *  Returns {employees:[{code, name, campus, required:{label:[urls]}, other:{type:[urls]}, missing:[labels]}],
 *  unlinked:[{campus, name, id, timestamp, types:[...], files}], required:[labels], noTab:[campuses with active staff but no tab]}.
 *  An employee is matched to uploads by the typed Employee ID; newest submission's links come first. */
function coordDocumentMatrix_(empRows, salaryRows, responses) {
  const dept = {};
  const sCode = salaryRows[0].indexOf('EmployeeCode'), sDept = salaryRows[0].indexOf('Department');
  for (let i = 1; i < salaryRows.length && sCode !== -1 && sDept !== -1; i++) dept[String(salaryRows[i][sCode] || '').trim()] = String(salaryRows[i][sDept] || '').trim().toLowerCase();

  const eCode = empRows[0].indexOf('EmployeeCode'), eName = empRows[0].indexOf('Name'), eSchool = empRows[0].indexOf('SchoolCode'), eStatus = empRows[0].indexOf('Status');
  const allCodes = {}, active = [];
  for (let i = 1; i < empRows.length; i++) {
    const r = empRows[i], code = String(r[eCode] || '').trim();
    if (!code) continue;
    allCodes[code.toUpperCase()] = true;
    const status = eStatus >= 0 ? String(r[eStatus] || '').trim() : '';
    if (status && status !== 'Active') continue;
    if (COORD_DOC_HIDDEN_DEPARTMENTS.indexOf(dept[code] || '') !== -1) continue;
    active.push({ code: code, name: String(r[eName] || code).trim(), campus: String(r[eSchool] || '').trim().toUpperCase() });
  }

  const byCode = {}, unlinked = [];
  Object.keys(responses).forEach(function (campus) {
    const rows = responses[campus];
    if (!rows || rows.length < 2) return;
    const head = rows[0], iId = head.indexOf('Employee ID'), iName = head.indexOf('Employee Name'), iTs = head.indexOf('Timestamp');
    if (iId === -1) return;
    const typeOf = head.map(coordDocType_);
    const sorted = rows.slice(1).sort(function (a, b) { return (new Date(b[iTs]).getTime() || 0) - (new Date(a[iTs]).getTime() || 0); }); // newest first
    sorted.forEach(function (r) {
      const id = String(r[iId] || '').trim().toUpperCase();
      const docs = {};
      typeOf.forEach(function (t, c) {
        if (!t) return;
        coordLinks_(r[c]).forEach(function (u) { (docs[t] = docs[t] || []).indexOf(u) === -1 && docs[t].push(u); });
      });
      const types = Object.keys(docs);
      if (!types.length) return;
      if (id && allCodes[id]) {
        const e = byCode[id] = byCode[id] || {};
        types.forEach(function (t) { e[t] = e[t] || []; docs[t].forEach(function (u) { if (e[t].indexOf(u) === -1) e[t].push(u); }); });
      } else {
        const ts = new Date(r[iTs]);
        unlinked.push({ campus: campus, name: String(r[iName] || '').trim(), id: String(r[iId] || '').trim(),
          timestamp: isNaN(ts.getTime()) ? '' : ts.toISOString(), types: types, files: types.reduce(function (n, t) { return n + docs[t].length; }, 0) });
      }
    });
  });

  const employees = active.map(function (a) {
    const have = byCode[a.code.toUpperCase()] || {};
    const required = {}, other = {}, missing = [];
    COORD_DOCS_REQUIRED.forEach(function (label) {
      let links = [];
      if (label === 'Qualification certificate') COORD_DOCS_QUALIFICATION.forEach(function (t) { links = links.concat(have[t] || []); });
      else links = have[label] || [];
      required[label] = links;
      if (!links.length) missing.push(label);
    });
    Object.keys(have).forEach(function (t) {
      if (COORD_DOCS_REQUIRED.indexOf(t) === -1 && COORD_DOCS_QUALIFICATION.indexOf(t) === -1) other[t] = have[t];
    });
    return { code: a.code, name: a.name, campus: a.campus, required: required, other: other, missing: missing };
  });
  const tabbed = {};
  Object.keys(responses).forEach(function (c) { tabbed[c] = true; });
  const noTab = [];
  active.forEach(function (a) { if (!tabbed[a.campus] && noTab.indexOf(a.campus) === -1) noTab.push(a.campus); });
  return { employees: employees, unlinked: unlinked, required: COORD_DOCS_REQUIRED, noTab: noTab };
}

// Since 2026-10-21 every staff document is one row of the workbook's "Documents" tab (kept in sync by the
// Roster Proxy's staff-documents.gs from the LMS n form tabs plus Staff Portal uploads, with Employee Codes
// already matched to the roster). Regrouped here into one row per person per campus -- the shape
// coordDocumentMatrix_ reads -- each document type a column of comma-joined links.
function coordDocsFromTable_(rows) {
  const h = rows[0];
  const iAt = h.indexOf('Uploaded On'), iCode = h.indexOf('Employee Code'), iName = h.indexOf('Employee Name'),
    iSchool = h.indexOf('School'), iType = h.indexOf('Document Type'), iLink = h.indexOf('Drive Link');
  const typeName = function (r) { return String(r[iType] || '').replace('AADHAAR', 'AADHAR'); }; // COORD_DOCS_TYPE_RULES spelling
  const types = [];
  rows.slice(1).forEach(function (r) { if (types.indexOf(typeName(r)) === -1) types.push(typeName(r)); });
  const head = ['Timestamp', 'Employee ID', 'Employee Name'].concat(types);
  const out = {}, byPerson = {};
  rows.slice(1).forEach(function (r) {
    const campus = String(r[iSchool] || '').replace(/\s+/g, '');
    const key = campus + '|' + String(r[iCode] || '').trim().toUpperCase() + '|' + String(r[iName] || '').trim().toUpperCase();
    let row = byPerson[key];
    if (!row) {
      row = byPerson[key] = new Array(head.length).fill('');
      row[1] = r[iCode]; row[2] = r[iName];
      (out[campus] = out[campus] || [head]).push(row);
    }
    if (!row[0] || new Date(r[iAt]) > new Date(row[0])) row[0] = r[iAt];
    const c = 3 + types.indexOf(typeName(r));
    row[c] = row[c] ? row[c] + ', ' + r[iLink] : r[iLink];
  });
  return out;
}

// action=coordinatordocuments
function coordDocuments_(caller) {
  let all = coordCacheGetBig_('coord_docpage');
  if (!all) {
    const wb = SpreadsheetApp.openById(COORD_DOCS_WORKBOOK_ID);
    const table = wb.getSheetByName('Documents');
    let responses = {};
    if (table && table.getLastRow() > 1) responses = coordDocsFromTable_(table.getDataRange().getValues());
    else COORD_DOCS_TABS.forEach(function (tab) {
      const sh = wb.getSheetByName(tab);
      if (sh) responses[tab.replace(/\s+/g, '')] = sh.getDataRange().getValues();
    });
    const ss = SpreadsheetApp.openById(COORD_ROSTER_SHEET_ID);
    const emp = ss.getSheetByName('EmpMaster').getDataRange().getValues();
    if (emp.length < 2) throw new Error('Employee Master looks empty');
    all = coordDocumentMatrix_(emp, ss.getSheetByName('EmpSalary').getDataRange().getValues(), responses);
    all.generated = new Date().toISOString();
    all.missingTabs = table ? [] : COORD_DOCS_TABS.filter(function (t) { return !responses[t.replace(/\s+/g, '')]; });
    coordCachePutBig_('coord_docpage', all, COORD_DOCS_PAGE_CACHE_SECONDS);
  }
  const visible = coordVisibleCampuses_(caller);
  const ok = function (c) { return !visible || visible.indexOf(c) !== -1; };
  return {
    success: true, generated: all.generated, required: all.required, noTab: all.noTab, missingTabs: all.missingTabs,
    employees: all.employees.filter(function (e) { return ok(e.campus); }),
    unlinked: all.unlinked.filter(function (u) { return ok(u.campus); }),
  };
}

// ── Actions ──────────────────────────────────────────────────────────
function coordTasksList_(caller, idToken) {
  // one adapter failing must not hide the others' tasks
  try { coordRefreshSsCompliance_(idToken); } catch (err) { console.error('SS adapter: ' + err.message); }
  try { coordRefreshApprovals_(); } catch (err) { console.error('Approvals adapter: ' + err.message); }
  try { coordRefreshHiring_(); } catch (err) { console.error('Hiring adapter: ' + err.message); }
  try { coordRefreshDocuments_(); } catch (err) { console.error('Documents adapter: ' + err.message); }
  try { coordTransportRetireTasks_(); } catch (err) { console.error('Transport retire: ' + err.message); } // one-shot, see coordinator-transport.gs
  const visible = coordVisibleCampuses_(caller);
  const rows = coordSheet_().getDataRange().getValues();
  const today = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd'); // a follow-up past its due date counts as high
  const rank = { high: 0, medium: 1, low: 2 };
  const tasks = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r[5] !== 'open') continue;
    if (visible && visible.indexOf(r[2]) === -1 && r[13] !== caller.email) continue; // an assignee always sees what was assigned to them
    tasks.push({
      taskId: r[0], domain: r[1], campus: r[2], title: r[3], detail: r[4], severity: coordDueSeverity_(r[6], coordDueIso_(r[14]), today), assignee: r[13] || '', due: coordDueIso_(r[14]),
      department: r[12] || COORD_DOMAIN_DEPT[r[1]] || COORD_DEPT_OPS,
      createdAt: r[7] instanceof Date ? r[7].toISOString() : r[7], notes: r[11] || '',
    });
  }
  tasks.sort(function (a, b) { return (rank[a.severity] - rank[b.severity]) || (a.createdAt < b.createdAt ? -1 : 1); });
  try { coordRecAttach_(tasks); } catch (err) { console.error('Recommendations: ' + err.message); } // the tasks show without them rather than not at all
  let fresh = []; // requests too new for a follow-up, so the HQ can still recommend on them (coordinator-recommend.gs)
  try { fresh = coordFreshApprovals_(coordAprRows_(), rows, visible, coordRecLatest_(coordRecRows_()), coordRecNames_()); } catch (err) { console.error('Fresh requests: ' + err.message); fresh = []; }
  return { success: true, tasks: tasks, fresh: fresh };
}

// ── Scheduled refresh and HQ History ─────────────────────────────────
// Time-triggered at 05:30 IST, after the game layer's 04:00 daily missions, so the Tasks tab is fresh
// without anyone opening the page. Run coordInstallTriggers() once from the editor.
const COORD_HISTORY_TAB = 'HQ History'; // long format: Date, Campus, Measure, Value (counts only)

function coordScheduledRefresh() {
  // ponytail: SS needs a script-to-script secret to join the 05:30 run (coordRefreshSsCompliance_ takes a caller's token); it stays page-load-refreshed
  try { coordRefreshApprovals_(); } catch (err) { console.error('Approvals adapter: ' + err.message); }
  try { coordRefreshHiring_(); } catch (err) { console.error('Hiring adapter: ' + err.message); }
  try { coordRefreshDocuments_(); } catch (err) { console.error('Documents adapter: ' + err.message); }
  try { coordTransportRetireTasks_(); } catch (err) { console.error('Transport retire: ' + err.message); }
  try { coordHistoryAppend_(); } catch (err) { console.error('HQ History: ' + err.message); }
}

function coordInstallTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'coordScheduledRefresh') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('coordScheduledRefresh').timeBased().atHour(5).nearMinute(30).everyDays(1).create(); // appsscript.json timeZone is Asia/Kolkata
}

/** One row per campus per measure: open, overdue (Due before dayKey, or severity high) and open.<domain>.
 *  `existing` is the tab's rows; a (dayKey, campus) pair already in it is skipped, so a rerun adds nothing. */
function coordHistoryRows_(taskRows, dayKey, existing) {
  const done = {}, byCampus = {}, out = [];
  (existing || []).forEach(function (r) { done[r[0] + '|' + r[1]] = true; });
  for (let i = 1; i < taskRows.length; i++) {
    const r = taskRows[i], campus = r[2];
    if (r[5] !== 'open' || !campus || done[dayKey + '|' + campus]) continue;
    const c = byCampus[campus] || (byCampus[campus] = { open: 0, overdue: 0, domains: {} });
    const due = coordDueIso_(r[14]);
    c.open++;
    if (r[6] === 'high' || (due && due < dayKey)) c.overdue++;
    c.domains[r[1]] = (c.domains[r[1]] || 0) + 1;
  }
  Object.keys(byCampus).forEach(function (campus) {
    const c = byCampus[campus];
    out.push([dayKey, campus, 'open', c.open], [dayKey, campus, 'overdue', c.overdue]);
    Object.keys(c.domains).forEach(function (d) { out.push([dayKey, campus, 'open.' + d, c.domains[d]]); });
  });
  return out;
}

function coordHistoryAppend_() {
  const ss = SpreadsheetApp.openById(COORD_SHEET_ID);
  let sh = ss.getSheetByName(COORD_HISTORY_TAB);
  if (!sh) {
    sh = ss.insertSheet(COORD_HISTORY_TAB);
    sh.getRange(1, 1, 1, 4).setValues([['Date', 'Campus', 'Measure', 'Value']]).setFontWeight('bold');
    sh.getRange('A:A').setNumberFormat('@'); // keep 2026-11-03 as text, not a date
    sh.setFrozenRows(1);
  }
  const dayKey = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  const existing = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().map(function (r) {
    return [r[0] instanceof Date ? Utilities.formatDate(r[0], 'Asia/Kolkata', 'yyyy-MM-dd') : r[0], r[1], r[2], r[3]];
  }) : [];
  const rows = coordHistoryRows_(coordSheet_().getDataRange().getValues(), dayKey, existing);
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
}

// POST action=coordinatorresolvetask {taskId, note}. A follow-up raised from a Systems issue (pdr_issue|<id>) also marks that issue resolved.
function coordTaskResolve_(caller, body) {
  const res = coordTaskResolveCore_(caller, body);
  if (res.success && String(body.taskId || '').indexOf('pdr_issue|') === 0) {
    try { coordPdrResolveFromTask_(String(body.taskId).slice(10), caller, body.note); } catch (err) { console.error('PDR issue sync: ' + err.message); }
  }
  if (res.success && String(body.taskId || '').indexOf('apr_follow|') === 0) { // an allocated approval follow-up: mark the approval's follow-up done
    try { coordAprFollowDone_(String(body.taskId).slice(11), caller, body.note); } catch (err) { console.error('Approval follow-up sync: ' + err.message); }
  }
  return res;
}

function coordTaskResolveCore_(caller, body) {
  const taskId = String(body.taskId || '');
  const visible = coordVisibleCampuses_(caller);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = coordSheet_();
    const rows = sh.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] !== taskId) continue;
      if (visible && visible.indexOf(rows[i][2]) === -1 && rows[i][13] !== caller.email) return { success: false, error: 'Not authorized' };
      if (rows[i][5] !== 'open') return { success: true, alreadyResolved: true };
      if (GPS_DOMAINS.indexOf(rows[i][1]) !== -1 && !String(body.note || '').trim()) return { success: false, error: 'Write what was done before closing this (for example: driver warned on 24 Oct, or Blackbox complaint number).' };
      sh.getRange(i + 1, 6).setValue('resolved');
      sh.getRange(i + 1, 10, 1, 2).setValues([[new Date(), caller.email]]);
      if (body.note) sh.getRange(i + 1, 12).setValue(String(body.note).slice(0, 500));
      return { success: true };
    }
    return { success: false, error: 'Task not found' };
  } finally { lock.releaseLock(); }
}
