// ═══════════════════════════════════════════════════════════════════
// Principal Dashboard — Allowlist API
//
// LIVES IN THE SAME APPS SCRIPT PROJECT as employee-roster.gs and
// staff-management-api.gs ("LMCS Employee Roster Proxy") as of
// 2026-09-23, per Uday -- one project/one deployment for all three
// instead of three. employee-roster.gs's doGet() is the project's
// single entry point and routes every ALLOWLIST_ACTIONS_ action here,
// to allowlistDoGet_() (renamed from doGet() -- only one function of
// that name is allowed per project).
//
// This merge is a real trade-off, decided by Uday (2026-09-23): the
// OLD standalone deployment was domain-restricted (lms.org.in only) --
// Google itself blocked anyone outside the Workspace domain from
// reaching this at all, on top of the code's own checks. The
// roster/staff deployment it's now merged into is "Anyone" --
// reachable by anyone with the URL, which is visible in this PUBLIC
// GitHub repo. The read action (now `allowlist_list`, was `list`) has
// NO token check in the code -- it relies entirely on the deployment's
// access setting to be non-public. So post-merge, the list of every
// Principal/Coordinator/Owner's email/name/campusId/role is fetchable
// by anyone with the URL, not just lms.org.in accounts. WRITES
// (allowlist_add/edit/delete) are unaffected either way -- verifyAdminToken
// below re-checks a real Google ID token against ADMIN_EMAILS
// server-side regardless of deployment access settings, same "the real
// gate is server-side, not Apps Script's access setting" pattern used
// throughout this codebase.
//
// Action names prefixed `allowlist_` (2026-09-23) -- staff-management-
// api.gs's Directory action is ALSO literally named `list`; merging
// into one shared action-namespace made that a real collision, not
// just a code-organization one. assets/auth.js's ALLOWLIST_API_URL is
// now the SAME URL as EMPLOYEE_ROSTER_URL/STAFF_API_URL; its one call
// site was updated from `?action=list` to `?action=allowlist_list`.
// No other file in this repo called the write actions (add/edit/delete)
// -- this allowlist appears to be managed by hand in the sheet today,
// principal-admin.html referenced below doesn't exist in this repo --
// so renaming those was zero-risk.
//
// PERF (2026-09-15): readEntries() was measured taking 2-40+s and
// occasionally 404ing outright under LMCSManagement's perf audit —
// see that repo's assistant conversation. Root cause was suspected to
// be the OLD standalone deployment's domain-restricted access setting
// (fixed by that separate concern, unrelated to the 2026-09-23 merge
// above). CacheService here is a safety net either way: it caps how
// often the expensive path runs to once per CACHE_TTL_SECONDS, and
// every writer (addEntry/editEntry/deleteEntry) busts the cache
// immediately so a change is never masked by a stale cached list.
// ═══════════════════════════════════════════════════════════════════

const SHEET_ID = '1NZu0ElismFytG395Nxjz29vAz7OfkmJtZhs70bOwT58'; // "LMCS Principal Allowlist"
const ADMIN_EMAILS = ['uday.kanwar@lms.org.in'];
const GOOGLE_CLIENT_ID = '697999989724-mvi85iobr20g4mm8a8nrjd1rms2o8tf6.apps.googleusercontent.com';
const CACHE_KEY = 'allowlist_entries';
const CACHE_TTL_SECONDS = 600; // 10 min (was 5) -- rosterKeepWarm() in employee-roster.gs pings every 5, so it never expires between pings; writes still bust it immediately

// Renamed from doGet() 2026-09-23 when this file merged into the same
// Apps Script project as employee-roster.gs/staff-management-api.gs --
// only one function may be named doGet per project, so employee-roster.gs's
// doGet() is now the single dispatcher and routes here for every
// ALLOWLIST_ACTIONS_ action. Action names below are also renamed
// (list/add/edit/delete -> allowlist_list/allowlist_add/allowlist_edit/
// allowlist_delete) -- see the file header for why. Everything else is
// otherwise unchanged from when this was its own project's doGet().
function allowlistDoGet_(e) {
  const action = (e.parameter.action || 'allowlist_list').toLowerCase();
  try {
    if (action === 'allowlist_list') {
      return jsonOut({ success: true, entries: readEntries() });
    }

    // The Owner/Coordinator's "sheet ↗" link rows: ids stay out of the (public) static pages. Answers only a verified Owner/Coordinator.
    if (action === 'datasrc_links') return jsonOut(datasrcLinksFor_(e.parameter.idToken));

    // Every mutating action requires a Google ID token that verifies,
    // server-side, to one of ADMIN_EMAILS — not just "logged in."
    const email = verifyAdminToken(e.parameter.idToken);
    if (!email) {
      return jsonOut({ success: false, error: 'Not authorized' });
    }

    if (action === 'allowlist_add') {
      addEntry(e.parameter.email, e.parameter.name, e.parameter.campusId, e.parameter.role);
    } else if (action === 'allowlist_edit') {
      editEntry(e.parameter.email, e.parameter.name, e.parameter.campusId, e.parameter.role);
    } else if (action === 'allowlist_delete') {
      deleteEntry(e.parameter.email);
    } else {
      return jsonOut({ success: false, error: 'Unknown action: ' + action });
    }

    return jsonOut({ success: true, entries: readEntries() });
  } catch (err) {
    return jsonOut({ success: false, error: err.message });
  }
}

function getSheet() {
  return SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
}

// Role (column D, added 2026-08-29) is a separate dimension from campusId
// -- 'Owner' / 'Coordinator' / 'Principal' / 'Teacher', or blank for
// entries added before this existed (they just don't get any
// staff-management permission until someone sets it -- fails safe).
//
// Cached for CACHE_TTL_SECONDS (see PERF note above) -- addEntry/
// editEntry/deleteEntry all call invalidateCache_() after writing, so a
// change is visible on the very next read, not just after the TTL.
function readEntries() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(CACHE_KEY);
  if (hit) {
    const c = JSON.parse(hit);
    if (Array.isArray(c)) return c; // an entry cached by the code before 2026-11-10 (no stamp): served until its TTL ends
    if (!allowlistSheetChanged_(cache, c.at)) return c.entries;
  }
  const at = Date.now();
  const rows = getSheet().getDataRange().getValues();
  const entries = [];
  for (let i = 1; i < rows.length; i++) {
    const [email, name, campusId, role] = rows[i];
    if (email) {
      const entry = {
        email: String(email).trim().toLowerCase(),
        name: String(name || '').trim(),
        campusId: String(campusId || '').trim().toUpperCase(),
        role: String(role || '').trim(),
      };
      const supporting = supportSchools_(rows[0], rows[i]); // 2026-11-07: a Principal's supporting charge (supporting-charge.gs), only when set
      if (supporting.length) entry.supporting = supporting;
      entry.functions = staffFunctionsOf_(rows[0], rows[i]); // 2026-11-10: the Functions column (staff-management-api.gs, same project), [] when blank: lms-game routes coordinators by it (Uday: "A, sheet column") and reads a missing key on every entry as the old endpoint
      entries.push(entry);
    }
  }
  cache.put(CACHE_KEY, JSON.stringify({ at: at, entries: entries }), CACHE_TTL_SECONDS);
  return entries;
}

function invalidateCache_() {
  CacheService.getScriptCache().remove(CACHE_KEY);
}

// 2026-11-10: any edit to the sheet reaches the feed within ALLOWLIST_CHECK_SECONDS. Before, only this file's own writes called
// invalidateCache_(); a direct sheet edit (how Uday changes roles) or a write from the Game Backend's People room (another Apps Script
// project, so another script cache) waited out the 10-min cache. The cached entries carry the time they were read; at most once per
// ALLOWLIST_CHECK_SECONDS a read asks Drive when the sheet last changed (one cheap metadata call, not the 2-40 s sheet read) and re-reads
// only if it changed since. If Drive can't answer, the cache is served as before.
const ALLOWLIST_CHECK_SECONDS = 30;
function allowlistSheetChanged_(cache, at) {
  if (cache.get('allowlist_checked')) return false;
  cache.put('allowlist_checked', '1', ALLOWLIST_CHECK_SECONDS);
  try { return DriveApp.getFileById(SHEET_ID).getLastUpdated().getTime() > at; }
  catch (err) { return false; }
}

function findRowIndex(sheet, email) {
  const values = sheet.getDataRange().getValues();
  const target = String(email).trim().toLowerCase();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim().toLowerCase() === target) return i + 1; // 1-based row number
  }
  return -1;
}

function addEntry(email, name, campusId, role) {
  if (!email || !campusId) throw new Error('email and campusId are required');
  const sheet = getSheet();
  if (findRowIndex(sheet, email) !== -1) throw new Error('That email is already on the list — use edit instead');
  sheet.appendRow([email.trim().toLowerCase(), name || '', campusId.trim().toUpperCase(), role || '']);
  invalidateCache_();
}

function editEntry(email, name, campusId, role) {
  const sheet = getSheet();
  const row = findRowIndex(sheet, email);
  if (row === -1) throw new Error('Email not found: ' + email);
  sheet.getRange(row, 2).setValue(name || '');
  sheet.getRange(row, 3).setValue((campusId || '').trim().toUpperCase());
  sheet.getRange(row, 4).setValue(role || '');
  invalidateCache_();
}

function deleteEntry(email) {
  const sheet = getSheet();
  const row = findRowIndex(sheet, email);
  if (row === -1) throw new Error('Email not found: ' + email);
  sheet.deleteRow(row);
  invalidateCache_();
}

// Verifies a Google Identity Services ID token via Google's own tokeninfo
// endpoint (signature + audience + expiry all checked by Google, not us).
// Returns the verified email if it's an admin, otherwise null.
function verifyAdminToken(idToken) {
  const email = verifiedTokenEmail_(idToken);
  return email && ADMIN_EMAILS.indexOf(email) !== -1 ? email : null;
}

// The verified email behind a Google ID token (audience + expiry + email_verified checked), or null.
function verifiedTokenEmail_(idToken) {
  if (!idToken) return null;
  try {
    const res = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
      { muteHttpExceptions: true }
    );
    if (res.getResponseCode() !== 200) return null;
    const payload = JSON.parse(res.getContentText());
    if (payload.aud !== GOOGLE_CLIENT_ID) return null; // token wasn't issued for our client
    if (payload.email_verified !== 'true' && payload.email_verified !== true) return null;
    return (payload.email || '').toLowerCase() || null;
  } catch (err) {
    return null;
  }
}

// Data-source links (Google Sheets and calendars) for the Owner/Coordinator "📄 sheet ↗" rows on the pages. They live HERE, not in the static pages
// (the pages are public; the repo is private): assets/datasrc.js and three pages fetch them through the datasrc_links action, which answers only a verified
// Owner/Coordinator. '{CLASSIC}' = the classic host (classicBase_()), filled in when served. One literal on purpose: tests/datasrc reads it. Add a key here, then use it from PAGES in assets/datasrc.js.
const DATASRC_LINKS_ = {
  approvals: ['Approvals sheet','https://docs.google.com/spreadsheets/d/1Tr4Rfc6DN698eeGVjuCoXfSRR-NhBTWJibR00Ibj6P4/edit'],
  allowlist: ['Access list sheet','https://docs.google.com/spreadsheets/d/1NZu0ElismFytG395Nxjz29vAz7OfkmJtZhs70bOwT58/edit'],
  staff: ['LMCSStaffMasters sheet','https://docs.google.com/spreadsheets/d/1OjVMUvpLM8JkdAwjmljCtZUI1VUqGLbic36cW9dm0C0/edit'],
  hiring: ['Teaching Applicants sheet','https://docs.google.com/spreadsheets/d/1aSCQ3IGO-ZP_5yRjtnMpZdlauTdWj3814ATD9qwskPQ/edit#gid=1181288827'],
  docs: ['Doc Submission sheet','https://docs.google.com/spreadsheets/d/1PJ2acPOHopbHzzwGes8X4YPWSDBdXnd0zl46zvFCvIg/edit'],
  teacherss: ['Teacher SS responses sheet','https://docs.google.com/spreadsheets/d/1cP-f8ShSJJPMBXkQCfkSvmajPA1db6fMBOPCbLH3oIc/edit'],
  nonteaching: ['Non-Teaching SS responses sheet','https://docs.google.com/spreadsheets/d/1PHNLl_rdBVzjzpBs0oWFsvYxBDVq7_1i6TRQhwY45ac/edit'],
  driver: ['Driver SS responses sheet','https://docs.google.com/spreadsheets/d/1rFQH0Xcrhq1i2oNvLgpvrixXZNsr-rlntDXOGQ3J6ME/edit'],
  dailyreports: ['Daily Reports sheet','https://docs.google.com/spreadsheets/d/1GzGdakmjjkou0GGgljY6ugXvOM21MLkyeyc85Ke3i1Y/edit'],
  fees: ['Fee Defaulter Emails sheet','https://docs.google.com/spreadsheets/d/1za2G5vEOcR0fOpNr8oPF-RNJtYnYVSCkCSTYnpV_ok4/edit'],
  payscale: ['Salary PayScale sheet','https://docs.google.com/spreadsheets/d/1d8MdOgXNM5KVJjLwejAKpbbDaINnvPZO6zX_E5xABYU/edit'],
  payroll: ['Payroll sheet','https://docs.google.com/spreadsheets/d/1sal-zeXPZazN2ASqF7CchfJo-tF9_-Q80zcZtXbNwY8/edit'],
  transport: ['Transport responses sheet','https://docs.google.com/spreadsheets/d/1VXTMZjqCS82ftB1rwoN4BzoiOTP7-Vg0m5vTH01Tfzc/edit#gid=1365845375'],
  daily: ['Daily/CW sheet','https://docs.google.com/spreadsheets/d/1z5hzpMRHMru6ulpYs2lsGZr7quAywwpQ_zySa3rvGUA/edit'],
  cal1: ['LMS 1 calendar','https://calendar.google.com/calendar/u/0/r?cid=c_88402c40e6c9a435cbed4810bfae632d781ac9e7ca167b5435e4a9586bda7595%40group.calendar.google.com'],
  cal2: ['LMS 2/3 calendar','https://calendar.google.com/calendar/u/0/r?cid=c_25n5qbggh7u9s5o6vq31iho4vc%40group.calendar.google.com'],
  cal4: ['LMS 4 calendar','https://calendar.google.com/calendar/u/0/r?cid=lms.org.in_snflpd3f357jv8l380s8sc4ju0%40group.calendar.google.com'],
  cal5: ['LMS 5 calendar','https://calendar.google.com/calendar/u/0/r?cid=c_d367ca2cb9bbab4f6a5b6864d6e03c28fbfccf02b5212621e89daf2f9f3f8523%40group.calendar.google.com'],
  cal6: ['LMS 6 calendar','https://calendar.google.com/calendar/u/0/r?cid=c_3db6cb2edb78d889cf166771c426f0fe3ba78b04cf9ca8e566329c888d023635%40group.calendar.google.com'],
  timetable: ['Timetable data','{CLASSIC}teacher/data/timetable.json'],
  calSchoolLMS1: ["School's calendar",'https://calendar.google.com/calendar/u/0/r?cid=c_88402c40e6c9a435cbed4810bfae632d781ac9e7ca167b5435e4a9586bda7595%40group.calendar.google.com'],
  calSchoolLMS2: ["School's calendar",'https://calendar.google.com/calendar/u/0/r?cid=c_25n5qbggh7u9s5o6vq31iho4vc%40group.calendar.google.com'],
  calSchoolLMS3: ["School's calendar",'https://calendar.google.com/calendar/u/0/r?cid=c_25n5qbggh7u9s5o6vq31iho4vc%40group.calendar.google.com'],
  calSchoolLMS4: ["School's calendar",'https://calendar.google.com/calendar/u/0/r?cid=lms.org.in_snflpd3f357jv8l380s8sc4ju0%40group.calendar.google.com'],
  calSchoolLMS5: ["School's calendar",'https://calendar.google.com/calendar/u/0/r?cid=c_d367ca2cb9bbab4f6a5b6864d6e03c28fbfccf02b5212621e89daf2f9f3f8523%40group.calendar.google.com'],
  calSchoolLMS6: ["School's calendar",'https://calendar.google.com/calendar/u/0/r?cid=c_3db6cb2edb78d889cf166771c426f0fe3ba78b04cf9ca8e566329c888d023635%40group.calendar.google.com'],
  calPrincipalLMS1: ["Principal's calendar",'https://calendar.google.com/calendar/u/0/r?cid=nidhi.kant%40lms.org.in'],
  calPrincipalLMS2: ["Principal's calendar",'https://calendar.google.com/calendar/u/0/r?cid=arti.sharma%40lms.org.in'],
  calPrincipalLMS3: ["Principal's calendar",'https://calendar.google.com/calendar/u/0/r?cid=suresh.prasher%40lms.org.in'],
  calPrincipalLMS4: ["Principal's calendar",'https://calendar.google.com/calendar/u/0/r?cid=nisha.lms%40lms.org.in'],
  calPrincipalLMS5: ["Principal's calendar",'https://calendar.google.com/calendar/u/0/r?cid=priyanka.sharma%40lms.org.in'],
  calPrincipalLMS6: ["Principal's calendar",'https://calendar.google.com/calendar/u/0/r?cid=nikita.sen%40lms.org.in'],
};

// The same rule as assets/auth.js canViewDataSources: Owner or Coordinator (an admin email counts as Owner). Checked here, on the verified token.
function datasrcLinksFor_(idToken) {
  const email = verifiedTokenEmail_(idToken);
  if (!email) return { success: false, error: 'Not authorized' };
  let ok = ADMIN_EMAILS.indexOf(email) !== -1;
  if (!ok) {
    readEntries().forEach(function (en) {
      if (en.email === email && /(^|,)\s*(owner|coordinator)\s*(,|$)/i.test(en.role)) ok = true;
    });
  }
  if (!ok) return { success: false, error: 'Not authorized' };
  const base = classicBase_(), links = {};
  Object.keys(DATASRC_LINKS_).forEach(function (k) { links[k] = [DATASRC_LINKS_[k][0], DATASRC_LINKS_[k][1].replace('{CLASSIC}', base)]; });
  return { success: true, links: links };
}

// jsonOut() is NOT redefined here -- employee-roster.gs's identical
// implementation is already in this project's shared global scope
// (same signature, byte-for-byte the same body); a second definition
// of the same function name would collide, and Apps Script would just
// silently use whichever one loads last.
