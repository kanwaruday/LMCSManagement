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
// complete-hire (Teaching Applicants + Approvals + Employee Master, read-only).
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

// ── Adapter: approvals bottleneck (reads the Approvals tab directly) ──
// The Approvals tab sits in the same workbook as the Tasks tab, so it is read here directly
// (read-only, every campus) instead of through PDR's caller-scoped approvalslist -- no PDR
// load, no PDR change. Column positions follow approvals.gs's own layout.
// One task per request still waiting: TaskId includes the status, so a request that moves
// Pending -> Info Requested gets a fresh task, and the old one auto-resolves.
function coordApprovalWanted_(rows, now) {
  const wanted = [];
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
    wanted.push({
      taskId: 'approval|' + r[0] + '|' + status,
      domain: 'approval',
      campus: campus,
      title: String(r[2]) + ' request waiting ' + days + ' days for ' + waitingOn + ' (' + campus + ')',
      detail: '"' + String(r[4]) + '" - ' + status + (urgent ? ', marked Urgent' : '') + ' since ' + Utilities.formatDate(since, 'Asia/Kolkata', 'd MMM'),
      severity: days >= high ? 'high' : 'medium',
    });
  }
  return wanted;
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
        taskId: 'complete_hire|' + id, domain: 'complete_hire', campus: campus,
        title: 'Complete hire in Staff Portal: ' + name + ' (' + campus + ')',
        detail: 'Marked Hired, ' + (code || 'no employee code') + ' not in Employee Master yet; ' + dojText,
        severity: severity,
      });
      continue;
    }

    if (approvedAt[id] && r[13]) { // approved to hire after the MD interview, but not Hired yet
      const days = Math.floor((now.getTime() - approvedAt[id].getTime()) / 86400000);
      if (days < COORD_STALL_MEDIUM_DAYS) continue;
      wanted.push({
        taskId: 'hiring_stall|' + id, domain: 'hiring_stall', campus: campus,
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

// ── Actions ──────────────────────────────────────────────────────────
function coordTasksList_(caller, idToken) {
  // one adapter failing must not hide the others' tasks
  try { coordRefreshSsCompliance_(idToken); } catch (err) { console.error('SS adapter: ' + err.message); }
  try { coordRefreshApprovals_(); } catch (err) { console.error('Approvals adapter: ' + err.message); }
  try { coordRefreshHiring_(); } catch (err) { console.error('Hiring adapter: ' + err.message); }
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
