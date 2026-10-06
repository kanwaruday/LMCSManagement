// ═══════════════════════════════════════════════════════════════════
// Coordinator Tasks -- the follow-up engine behind coordinator/index.html
// (planned 2026-10-06, see vault work/active/lmcs-management.md,
// "Coordinator Portal & Role-Based Restructure"). Lives in the shared
// "LMCS Principal's Daily Reporting Backend" project (main.gs routes:
// action=coordinatortasks GET, action=coordinatorresolvetask POST).
//
// ONE generic task store, many "adapters": an adapter scans some source
// data, upserts one task per problem (deterministic TaskId, so a re-run
// never duplicates), and auto-resolves tasks whose problem has cleared.
// v1 adapter: SS compliance (below). Next adapters (approvals bottleneck,
// hiring stalls + "complete hire", document compliance) just call
// coordTaskUpsert_ / coordTasksAutoResolve_ the same way.
//
// SETUP: none -- the "Tasks" tab creates itself on first call, inside the
// existing "LMCS Approvals" workbook (COORD_SHEET_ID below).
//
// ponytail: thresholds below are defaults, not decisions -- tune them.
// ═══════════════════════════════════════════════════════════════════

const COORD_SHEET_ID = '1Tr4Rfc6DN698eeGVjuCoXfSRR-NhBTWJibR00Ibj6P4'; // the "LMCS Approvals" workbook (same ID as APR_SHEET_ID); the Tasks tab lives there, per Uday 2026-10-06
const COORD_TAB = 'Tasks';
const COORD_HEADERS = ['TaskId', 'Domain', 'Campus', 'Title', 'Detail', 'Status', 'Severity',
  'CreatedAt', 'LastSeenAt', 'ResolvedAt', 'ResolvedBy', 'Notes'];

const COORD_SS_MEDIUM_BELOW_PCT = 70; // campus+role quota compliance under this -> medium task
const COORD_SS_HIGH_BELOW_PCT = 40;   // ... under this -> high
const COORD_SS_GRACE_DAYS = 10;       // first N days of a month: nobody can have met a 2/month quota yet, so don't flag or resolve
const COORD_SS_REFRESH_CACHE_SECONDS = 600;

function coordCanUse_(caller) {
  return callerHasRole_(caller, 'Coordinator') || callerHasRole_(caller, 'Owner');
}

function coordSheet_() {
  if (!COORD_SHEET_ID) throw new Error('COORD_SHEET_ID is not set in coordinator-tasks.gs');
  const ss = SpreadsheetApp.openById(COORD_SHEET_ID);
  let sh = ss.getSheetByName(COORD_TAB);
  if (!sh) {
    const blank = ss.getSheetByName('Sheet1');
    sh = blank && blank.getLastRow() === 0 ? blank.setName(COORD_TAB) : ss.insertSheet(COORD_TAB);
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

/** Open tasks of `domain` whose TaskId is not in `liveIds` get resolved by the system. */
function coordTasksAutoResolve_(sh, rows, domain, liveIds) {
  const now = new Date();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] !== domain || rows[i][5] !== 'open' || liveIds[rows[i][0]]) continue;
    sh.getRange(i + 1, 6).setValue('resolved');
    sh.getRange(i + 1, 10, 1, 2).setValues([[now, 'system (condition cleared)']]);
    rows[i][5] = 'resolved';
  }
}

// ── Adapter: SS compliance ───────────────────────────────────────────
// One task per (role, campus, month) whose quota compliance is under threshold.
function coordRefreshSsCompliance_() {
  const cache = CacheService.getScriptCache();
  if (cache.get('coord_ss_refreshed')) return;
  const today = new Date();
  if (today.getDate() <= COORD_SS_GRACE_DAYS) return;

  const wanted = [];
  ACTIVE_SS_ROLES.forEach(function (roleKey) {
    const d = ssRoleDashboard_(roleKey, null);
    d.campusCompliance.forEach(function (c) {
      if (!c.totalEmployees || c.compliancePct >= COORD_SS_MEDIUM_BELOW_PCT) return;
      const campus = coordCampusId_(c.formKey);
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
    coordTasksAutoResolve_(sh, rows, 'ss_compliance', live);
  } finally { lock.releaseLock(); }
  cache.put('coord_ss_refreshed', '1', COORD_SS_REFRESH_CACHE_SECONDS);
}

// ── Actions ──────────────────────────────────────────────────────────
// action=coordinatortasks. Owner/ALL sees every campus; a locked Coordinator
// sees their district (same map the Hiring Dashboard uses).
function coordTasksList_(caller) {
  if (!coordCanUse_(caller)) return { success: false, error: 'Not authorized' };
  coordRefreshSsCompliance_();
  const visible = caller.campusId === 'ALL' ? null : hirDistrictCampuses_(caller.campusId);
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
  if (!coordCanUse_(caller)) return { success: false, error: 'Not authorized' };
  const taskId = String(body.taskId || '');
  const visible = caller.campusId === 'ALL' ? null : hirDistrictCampuses_(caller.campusId);
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
