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
const CACHE_TTL_SECONDS = 300; // 5 min

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
  if (hit) return JSON.parse(hit);

  const rows = getSheet().getDataRange().getValues();
  const entries = [];
  for (let i = 1; i < rows.length; i++) {
    const [email, name, campusId, role] = rows[i];
    if (email) {
      entries.push({
        email: String(email).trim().toLowerCase(),
        name: String(name || '').trim(),
        campusId: String(campusId || '').trim().toUpperCase(),
        role: String(role || '').trim(),
      });
    }
  }
  cache.put(CACHE_KEY, JSON.stringify(entries), CACHE_TTL_SECONDS);
  return entries;
}

function invalidateCache_() {
  CacheService.getScriptCache().remove(CACHE_KEY);
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
    const email = (payload.email || '').toLowerCase();
    return ADMIN_EMAILS.indexOf(email) !== -1 ? email : null;
  } catch (err) {
    return null;
  }
}

// jsonOut() is NOT redefined here -- employee-roster.gs's identical
// implementation is already in this project's shared global scope
// (same signature, byte-for-byte the same body); a second definition
// of the same function name would collide, and Apps Script would just
// silently use whichever one loads last.
