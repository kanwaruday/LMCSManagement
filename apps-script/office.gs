// LMCS Office Backend -- Fee Clerk + PRO Portal. Entry points, auth, campus/role enforcement, clock.
// Modules (separate files) each define a hoisted officeXxxActions_() returning
// {name: {roles, write, run(ctx, data)}}; officeAllActions_() below merges them, so a module
// file needs no registration beyond its line there. Script Properties (read at call time):
// OFFICE_GOOGLE_CLIENT_ID, OFFICE_ALLOWLIST_SHEET_ID. No IDs live in source (public repo).
// Allowlist (first tab): A email, B name, C campuses (comma list or ALL), D roles (comma list).

var officeClock_ = null; // tests set a Date here (see officeNow_)

function doGet(e) {
  return officeHandle_(e.parameter.action, e.parameter.idToken, e.parameter.data || {});
}

// Writes are POST with a text/plain JSON body (no CORS preflight).
function doPost(e) {
  return officeHandle_(null, null, null, (e.postData && e.postData.contents) || '{}');
}

function officeAllActions_() {
  return Object.assign({},
    typeof officeConfigActions_ === 'function' ? officeConfigActions_() : {},
    typeof officeDaybookActions_ === 'function' ? officeDaybookActions_() : {},
    typeof officeCloseActions_ === 'function' ? officeCloseActions_() : {},
    typeof officeReportActions_ === 'function' ? officeReportActions_() : {},
    typeof officeFilesActions_ === 'function' ? officeFilesActions_() : {},
    typeof officeDepositsActions_ === 'function' ? officeDepositsActions_() : {},
    typeof officeTodayActions_ === 'function' ? officeTodayActions_() : {});
}

// Verify the token on every call (cached 5 min), then check role and campus, then run.
// JSON is parsed inside the try so malformed input returns {success:false}: `data` may be a JSON
// string (GET), and `rawBody` (POST) carries the whole {action, idToken, data} envelope.
function officeHandle_(action, idToken, data, rawBody) {
  try {
    if (rawBody !== undefined) { const b = JSON.parse(rawBody); action = b.action; idToken = b.idToken; data = b.data; }
    if (typeof data === 'string') data = JSON.parse(data);
    const caller = officeCaller_(idToken);
    if (!caller) return officeJson_({ success: false, error: 'Not authorized' });
    data = data || {};
    const def = officeAllActions_()[String(action || '')];
    if (!def) return officeJson_({ success: false, error: 'Unknown action: ' + action });
    if (!def.roles.some(function (r) { return caller.roles.indexOf(r) !== -1; })) return officeJson_({ success: false, error: 'FORBIDDEN_ROLE' });
    // Enforced here so no module can forget it: any action naming a campus must be one the caller holds.
    if (data.campus !== undefined && data.campus !== null && data.campus !== '') {
      officeAssertCampus_(caller, data.campus);
      data.campus = String(data.campus).trim().toUpperCase(); // canonical form: officeOpen_ builds its property key from it
    }
    const ctx = { caller: caller, now: officeNow_() };
    if (!def.write) return officeJson_(Object.assign({ success: true }, def.run(ctx, data)));
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      return officeJson_(Object.assign({ success: true }, def.run(ctx, data)));
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    // A thrown error with a `code` (e.g. DAY_CLOSED) returns both, so clients can branch on code.
    return officeJson_(err.code ? { success: false, code: err.code, error: err.message } : { success: false, error: err.message });
  }
}

function officeJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ── Auth ─────────────────────────────────────────────────────────────
// Verified Google ID token -> {email, name, campuses[], roles[]} from the allowlist, or null.
// Cached 5 min under a token hash: removing someone's access takes up to 5 minutes to apply.
function officeCaller_(idToken) {
  if (!idToken) return null;
  const key = 'office_tok_' + Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, idToken)
    .map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join('');
  const cache = CacheService.getScriptCache();
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const caller = officeVerifyAllowlist_(idToken);
  if (caller) cache.put(key, JSON.stringify(caller), 300);
  return caller;
}

function officeVerifyAllowlist_(idToken) {
  const props = PropertiesService.getScriptProperties();
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  const p = JSON.parse(res.getContentText());
  if (p.aud !== props.getProperty('OFFICE_GOOGLE_CLIENT_ID') || (p.email_verified !== 'true' && p.email_verified !== true)) return null;
  const email = String(p.email || '').toLowerCase();
  const rows = SpreadsheetApp.openById(props.getProperty('OFFICE_ALLOWLIST_SHEET_ID')).getSheets()[0].getDataRange().getValues();
  const list = function (v) { return String(v || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean); };
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '').trim().toLowerCase() !== email) continue;
    return { email: email, name: String(rows[i][1] || '').trim(), campuses: list(rows[i][2]).map(function (c) { return c.toUpperCase(); }), roles: list(rows[i][3]) };
  }
  return null;
}

function officeAssertCampus_(caller, campus) {
  const c = String(campus || '').trim().toUpperCase();
  if (!c || (caller.campuses.indexOf('ALL') === -1 && caller.campuses.indexOf(c) === -1)) throw new Error('FORBIDDEN_CAMPUS');
}

// ── Clock ────────────────────────────────────────────────────────────
function officeNow_() { return officeClock_ || new Date(); }

// Business date in Asia/Kolkata, 'YYYY-MM-DD'.
function officeToday_() { return Utilities.formatDate(officeNow_(), 'Asia/Kolkata', 'yyyy-MM-dd'); }

// Financial year (Apr-Mar) of an ISO date: '2026-04-01' -> '2026-27'.
function officeFy_(isoDate) {
  const y = Number(isoDate.slice(0, 4)), m = Number(isoDate.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return start + '-' + String((start + 1) % 100).padStart(2, '0');
}
