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
// Source data is READ from the other backends over HTTP with the
// caller's own ID token (this project never opens their sheets, never
// writes to them). v1 adapter: SS compliance, from PDR's action=ssdashboard.
//
// Actions: GET action=coordinatortasks, POST action=coordinatorresolvetask.
// Coordinator or Owner only; a locked Coordinator sees their district.
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
  'CreatedAt', 'LastSeenAt', 'ResolvedAt', 'ResolvedBy', 'Notes'];

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

function coordJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    const caller = coordVerifyCaller_(e.parameter.idToken);
    if (!caller) return coordJson_({ success: false, error: 'Not authorized' });
    const action = String(e.parameter.action || '').toLowerCase();
    if (action === 'coordinatortasks') return coordJson_(coordTasksList_(caller, e.parameter.idToken));
    return coordJson_({ success: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return coordJson_({ success: false, error: err.message });
  }
}

// Plain-text JSON body (no Content-Type) so the browser skips a preflight; this project has no doOptions.
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const caller = coordVerifyCaller_(body.idToken);
    if (!caller) return coordJson_({ success: false, error: 'Not authorized' });
    const action = String(body.action || '').toLowerCase();
    if (action === 'coordinatorresolvetask') return coordJson_(coordTaskResolve_(caller, body));
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
    const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    const payload = JSON.parse(res.getContentText());
    if (payload.aud !== COORD_GOOGLE_CLIENT_ID) return null;
    if (payload.email_verified !== 'true' && payload.email_verified !== true) return null;
    const email = (payload.email || '').toLowerCase();
    const rows = SpreadsheetApp.openById(COORD_ALLOWLIST_SHEET_ID).getSheets()[0].getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0] || '').trim().toLowerCase() !== email) continue;
      const roles = String(rows[i][3] || '').split(',').map(function (r) { return r.trim(); }).filter(Boolean);
      if (roles.indexOf('Coordinator') === -1 && roles.indexOf('Owner') === -1) return null;
      const caller = { email: email, campusId: String(rows[i][2] || '').trim().toUpperCase(), roles: roles };
      cache.put(key, JSON.stringify(caller), 300);
      return caller;
    }
    return null;
  } catch (err) {
    return null;
  }
}

// null = every campus (Owner / ALL); otherwise the campuses the caller may see
function coordVisibleCampuses_(caller) {
  return caller.campusId === 'ALL' ? null : (COORD_DISTRICTS[caller.campusId] || [caller.campusId]);
}

// ── Task store ───────────────────────────────────────────────────────
function coordSheet_() {
  const ss = SpreadsheetApp.openById(COORD_SHEET_ID);
  let sh = ss.getSheetByName(COORD_TAB);
  if (!sh) {
    sh = ss.insertSheet(COORD_TAB);
    sh.getRange(1, 1, 1, COORD_HEADERS.length).setValues([COORD_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
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
    return;
  }
  const row = [t.taskId, t.domain, t.campus, t.title, t.detail, 'open', t.severity, now, now, '', '', ''];
  sh.appendRow(row);
  rows.push(row);
}

/** Open tasks of `domain` on a campus in `covered` whose TaskId is not in `liveIds` get resolved
 *  by the system. Only campuses the source data actually covered are touched, so a refresh that
 *  saw a narrower scope never closes tasks it couldn't see. */
function coordTasksAutoResolve_(sh, rows, domain, covered, liveIds) {
  const now = new Date();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] !== domain || rows[i][5] !== 'open' || !covered[rows[i][2]] || liveIds[rows[i][0]]) continue;
    sh.getRange(i + 1, 6).setValue('resolved');
    sh.getRange(i + 1, 10, 1, 2).setValues([[now, 'system (condition cleared)']]);
    rows[i][5] = 'resolved';
  }
}

// ── Adapter: SS compliance (reads PDR's action=ssdashboard) ──────────
// One task per (role, campus, month) whose quota compliance is under threshold.
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
  Object.keys(dash.roles).forEach(function (roleKey) {
    const d = dash.roles[roleKey];
    d.campusCompliance.forEach(function (c) {
      const campus = coordCampusId_(c.formKey);
      covered[campus] = true;
      if (!c.totalEmployees || c.compliancePct >= COORD_SS_MEDIUM_BELOW_PCT) return;
      wanted.push({
        taskId: 'ss_compliance|' + roleKey + '|' + campus + '|' + d.monthLabel,
        domain: 'ss_compliance',
        campus: campus,
        title: d.label + ' SS behind quota at ' + c.formKey,
        detail: c.metQuota + ' of ' + c.totalEmployees + ' met ' + d.quotaPerMonth + '/month (' + c.compliancePct + '%) - ' + d.monthLabel,
        severity: c.compliancePct < COORD_SS_HIGH_BELOW_PCT ? 'high' : 'medium',
      });
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

// ── Actions ──────────────────────────────────────────────────────────
function coordTasksList_(caller, idToken) {
  coordRefreshSsCompliance_(idToken);
  const visible = coordVisibleCampuses_(caller);
  const rows = coordSheet_().getDataRange().getValues();
  const rank = { high: 0, medium: 1, low: 2 };
  const tasks = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r[5] !== 'open') continue;
    if (visible && visible.indexOf(r[2]) === -1) continue;
    tasks.push({
      taskId: r[0], domain: r[1], campus: r[2], title: r[3], detail: r[4], severity: r[6],
      createdAt: r[7] instanceof Date ? r[7].toISOString() : r[7], notes: r[11] || '',
    });
  }
  tasks.sort(function (a, b) { return (rank[a.severity] - rank[b.severity]) || (a.createdAt < b.createdAt ? -1 : 1); });
  return { success: true, tasks: tasks };
}

// POST action=coordinatorresolvetask {taskId, note}
function coordTaskResolve_(caller, body) {
  const taskId = String(body.taskId || '');
  const visible = coordVisibleCampuses_(caller);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = coordSheet_();
    const rows = sh.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] !== taskId) continue;
      if (visible && visible.indexOf(rows[i][2]) === -1) return { success: false, error: 'Not authorized' };
      if (rows[i][5] !== 'open') return { success: true, alreadyResolved: true };
      sh.getRange(i + 1, 6).setValue('resolved');
      sh.getRange(i + 1, 10, 1, 2).setValues([[new Date(), caller.email]]);
      if (body.note) sh.getRange(i + 1, 12).setValue(String(body.note).slice(0, 500));
      return { success: true };
    }
    return { success: false, error: 'Task not found' };
  } finally { lock.releaseLock(); }
}
