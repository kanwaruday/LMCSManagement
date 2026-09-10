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
//   ss-forms-sync.gs    -- Run-menu only, no doGet -- keeps every SS
//                         Google Form's Name dropdown + rubric
//                         validation live. Turned out to be THE generic
//                         engine for all 6 roles (Teacher/IT/PTI/Clerk/
//                         Non-Teaching/Driver) via SS_ROLE_CONFIGS,
//                         rather than one file per role as originally
//                         planned -- ss-tracker.gs below reuses that
//                         same config for the Dashboard, one source of
//                         truth for "what does this role's data look
//                         like" (rubric titles, name field, where
//                         responses live).
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

function doGet(e) {
  try {
    const caller = verifyCallerToken_(e.parameter.idToken);
    if (!caller) return jsonOut_({ success: false, error: 'Not authorized' });

    const action = (e.parameter.action || 'teacherstats').toLowerCase();

    if (action === 'teacherstats') return jsonOut_(teacherSsStats_(caller));
    if (action === 'ssdashboard') return jsonOut_(ssDashboardAll_(caller));
    if (action === 'principaldrload') return jsonOut_(principalDrLoadBundle_(caller, e.parameter.campusId, e.parameter.date));
    if (action === 'monthactivities') return jsonOut_(principalDrMonthActivities_(caller, e.parameter.campusId));
    if (action === 'supportsessionstoday') return jsonOut_(principalDrSupportSessionsToday_(caller, e.parameter.campusId, e.parameter.date));
    if (action === 'plannedactivities') return jsonOut_(principalDrPlannedActivities_(caller, e.parameter.campusId));
    if (action === 'yesterdaystasks') return jsonOut_(principalDrYesterdaysTasks_(caller, e.parameter.campusId, e.parameter.date));
    if (action === 'dailyreport') return jsonOut_(principalDrGetDailyReport_(caller, e.parameter.campusId, e.parameter.date));
    if (action === 'approvalslist') return jsonOut_(aprList_(caller));
    if (action === 'approvaldetail') return jsonOut_(aprDetail_(caller, e.parameter.id));

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
  try {
    const body = JSON.parse(e.postData.contents);
    const caller = verifyCallerToken_(body.idToken);
    if (!caller) return jsonOut_({ success: false, error: 'Not authorized' });

    const action = String(body.action || '').toLowerCase();

    if (action === 'savedailyreport') return jsonOut_(principalDrSaveDailyReport_(caller, body));
    if (action === 'addplannedactivity') return jsonOut_(principalDrAddPlannedActivity_(caller, body));
    if (action === 'setplannedactivitycompleted') return jsonOut_(principalDrSetPlannedActivityCompleted_(caller, body));
    if (action === 'deleteplannedactivity') return jsonOut_(principalDrDeletePlannedActivity_(caller, body));
    if (action === 'submitapproval') return jsonOut_(aprSubmit_(caller, body));
    if (action === 'addapprovalcomment') return jsonOut_(aprAddComment_(caller, body));
    if (action === 'deleteapprovalcomment') return jsonOut_(aprDeleteComment_(caller, body));
    if (action === 'decideapproval') return jsonOut_(aprDecide_(caller, body));

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
      const role = String(rows[i][3] || '').trim();
      if (role !== 'Principal' && role !== 'Coordinator' && role !== 'Owner') return null;
      // Column E (added 2026-09-10, Approvals delegation) -- a
      // Coordinator with this TRUE can decide approvals same as Owner;
      // Uday flips this cell by hand to delegate/revoke. Blank/FALSE
      // (including every pre-existing row before this column existed)
      // is "not delegated" -- fails safe.
      const canApprove = String(rows[i][4] || '').trim().toUpperCase() === 'TRUE';
      const caller = { email: email, campusId: campusId, role: role, canApprove: canApprove };
      cache.put(cacheKey, JSON.stringify(caller), PDR_AUTH_CACHE_SECONDS);
      return caller;
    }
    return null; // not on the allowlist at all
  } catch (err) {
    return null;
  }
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
