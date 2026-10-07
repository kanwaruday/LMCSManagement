// ═══════════════════════════════════════════════════════════════════
// Coordinator Backend -- Systems department: Principals' daily report analysis (third file of the same
// "LMCS Coordinator Backend" project, next to coordinator.gs). Coordinator-only; principals never see this.
//
// Reads the "Daily Reports" tab of the Principal DR workbook live (written by principal-dr.gs in the OTHER project),
// plus the "LM Studio Tags" tab in that same workbook: topic tags for each Important Message, written by
// drive-index/pdr/pdr_tag.py on Uday's Mac over HTTPS (action=pdrtagpush). Same shared secret as the transport push
// (Script property TRANSPORT_PUSH_SECRET), so there is nothing new to set up.
//
// Powers GET action=coordinatorpdr and POST action=pdrtagpush. Compliance is worked out in the browser.
// ponytail: rows before PDR_REAL_FROM are form testing and are never sent to the page.
// ═══════════════════════════════════════════════════════════════════

const COORD_PDR_SHEET_ID = '1GzGdakmjjkou0GGgljY6ugXvOM21MLkyeyc85Ke3i1Y';
const COORD_PDR_TAB = 'Daily Reports';
const COORD_PDR_TAGS_TAB = 'LM Studio Tags';
const COORD_PDR_REAL_FROM = '2026-09-23';
const COORD_FEES_SHEET_ID = '1za2G5vEOcR0fOpNr8oPF-RNJtYnYVSCkCSTYnpV_ok4'; // "LMCS Fee Defaulter Emails", written daily by the UK Data Sync Apps Script project (fee-mail-capture.gs)
const COORD_FEES_CAMPUS = { Kullu: 'LMS1', Kelheli: 'LMS2', Dunkhra: 'LMS3', NerChowk: 'LMS4', Sayoli: 'LMS5', Jogindernagar: 'LMS6' }; // campus name in the email subject -> id
const COORD_PDR_HISTORY_TAB = 'PDR History'; // Jan to 22 Sep 2026 reports parsed from the old Google Spaces group (push from the Mac)
const COORD_PDR_ADMISSIONS_TAB = 'PDR Admissions'; // daily admission status posts from the campuses' WhatsApp admissions group (push from the Mac)
const COORD_PDR_ACTIONS_TAB = 'PDR Issue Actions'; // what coordinators did with each issue: acknowledged / assigned / resolved
const COORD_PDR_REPEATS_TAB = 'PDR Repeats'; // how much of each report repeats the campus's previous one (push from the Mac)
const COORD_PDR_MERGES_TAB = 'PDR Issue Merges'; // 'this issue is the same problem as that one': source id -> target id, applied by the page
const COORD_PDR_ISSUES_TAB = 'PDR Issues';   // issues grouped from the principals' Important Messages (push from the Mac)

// action=coordinatorpdr
function coordPdr_(caller) {
  const ss = SpreadsheetApp.openById(COORD_PDR_SHEET_ID);
  const visible = coordVisibleCampuses_(caller);
  const ok = function (campus) { return !visible || visible.indexOf(campus) !== -1; };
  const rows = ss.getSheetByName(COORD_PDR_TAB).getDataRange().getDisplayValues(); // dates are stored as ISO text
  let latestReportAt = '';
  const stamps = ss.getSheetByName(COORD_PDR_TAB).getRange(2, 1, Math.max(1, rows.length - 1), 1).getValues();
  stamps.forEach(function (r) { if (r[0] instanceof Date && r[0].toISOString() > latestReportAt) latestReportAt = r[0].toISOString(); });
  const reports = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r[1] < COORD_PDR_REAL_FROM || !ok(r[2])) continue;
    reports.push({ date: r[1], campus: r[2], email: r[3], maClass: r[4], maScore: r[5], done: r[6], tomorrow: r[7], registers: r[8], message: r[9] });
  }
  const tags = {}, tsh = ss.getSheetByName(COORD_PDR_TAGS_TAB);
  let taggedAt = '';
  if (tsh && tsh.getLastRow() > 1) {
    tsh.getDataRange().getDisplayValues().slice(1).forEach(function (t) {
      if (ok(t[1])) tags[t[0] + '|' + t[1]] = { topics: t[2] ? t[2].split(', ') : [], action: t[3] === 'yes', summary: t[4] };
      if (t[6] > taggedAt) taggedAt = t[6];
    });
  }
  const history = [], issues = [];
  const hsh = ss.getSheetByName(COORD_PDR_HISTORY_TAB), ish = ss.getSheetByName(COORD_PDR_ISSUES_TAB);
  let pushedAt = '';
  if (hsh && hsh.getLastRow() > 1) hsh.getDataRange().getDisplayValues().slice(1).forEach(function (h) { if (ok(h[1])) history.push({ date: h[0], campus: h[1] }); });
  if (ish && ish.getLastRow() > 1) {
    ish.getDataRange().getDisplayValues().slice(1).forEach(function (r) {
      if (!ok(r[1])) return;
      if (r[9] > pushedAt) pushedAt = r[9];
      issues.push({ id: r[0], campus: r[1], type: r[2], subject: r[3], first: r[4], last: r[5], count: +r[6], needsAction: r[7] === 'yes', items: JSON.parse(r[8] || '[]') });
    });
  }
  let fees = null;
  try { fees = coordFees_(ok); } catch (e) { fees = { error: e.message, series: [] }; } // a fee-sheet problem must not blank the rest of the page
  const admissions = [], ash = ss.getSheetByName(COORD_PDR_ADMISSIONS_TAB);
  if (ash && ash.getLastRow() > 1) ash.getDataRange().getDisplayValues().slice(1).forEach(function (a) { if (ok(a[1])) admissions.push({ date: a[0], campus: a[1], total: +a[2], registered: +a[3], tc: a[4] === '' ? null : +a[4], byClass: JSON.parse(a[5] || '{}') }); });
  const actions = {}, acsh = ss.getSheetByName(COORD_PDR_ACTIONS_TAB);
  if (acsh && acsh.getLastRow() > 1) acsh.getDataRange().getDisplayValues().slice(1).forEach(function (a) {
    if (ok(a[7])) actions[a[0]] = { status: a[1], assignee: a[2], assigneeName: a[3], note: a[4], by: a[5], at: a[6], lastAtAction: a[8] };
  });
  const repeats = [], rsh = ss.getSheetByName(COORD_PDR_REPEATS_TAB), n = function (v) { return v === '' ? null : +v; };
  if (rsh && rsh.getLastRow() > 1) rsh.getDataRange().getDisplayValues().slice(1).forEach(function (r) { if (ok(r[1])) repeats.push({ date: r[0], campus: r[1], tasks: n(r[2]), message: n(r[3]), prev: r[4], sample: r[5] }); });
  const merges = {}, msh = ss.getSheetByName(COORD_PDR_MERGES_TAB);
  if (msh && msh.getLastRow() > 1) msh.getDataRange().getDisplayValues().slice(1).forEach(function (r) { if (ok(r[4])) merges[r[0]] = r[1]; });
  return { success: true, merges: merges, repeats: repeats, latestReportAt: latestReportAt, actions: actions, coordinators: coordPdrCoordinators_(), fees: fees, admissions: admissions, reports: reports, tags: tags, taggedAt: taggedAt, history: history, issues: issues, pushedAt: pushedAt };
}

/** POST action=pdrtagpush {secret, tags:[{date, campus, topics:[], action, summary, hash}]}: replaces the "LM Studio Tags" tab. */
function coordPdrTagPush_(body) {
  if (!coordTransportSecretOk_(body.secret)) return { success: false, error: 'Not authorized' };
  if (!Array.isArray(body.tags) || !body.tags.length) return { success: false, error: 'No tags in payload' };
  const now = new Date().toISOString();
  const rows = body.tags.map(function (t) { return [t.date, t.campus, (t.topics || []).join(', '), t.action ? 'yes' : 'no', t.summary || '', t.hash || '', now]; });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    coordTransportWriteTab_(SpreadsheetApp.openById(COORD_PDR_SHEET_ID), COORD_PDR_TAGS_TAB, ['Date', 'CampusId', 'Topics', 'Needs action', 'Summary', 'Message hash', 'Tagged at'], rows);
  } finally { lock.releaseLock(); }
  return { success: true, written: rows.length };
}

/** POST action=pdrpush {secret, issues:[...], history:[...]} from drive-index/pdr/pdr_push.py: replaces the two tabs. */
function coordPdrPush_(body) {
  if (!coordTransportSecretOk_(body.secret)) return { success: false, error: 'Not authorized' };
  if (!Array.isArray(body.issues) || !Array.isArray(body.history) || body.history.length < 100) return { success: false, error: 'Payload rejected: expected issues and at least 100 history rows' };
  const now = new Date().toISOString(), ss = SpreadsheetApp.openById(COORD_PDR_SHEET_ID);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    coordTransportWriteTab_(ss, COORD_PDR_HISTORY_TAB, ['Date', 'CampusId', 'Source', 'Posts', 'TasksCompleted', 'TasksForTomorrow', 'Registers', 'ImportantMessage', 'Principal'],
      body.history.map(function (h) { return [h.Date, h.CampusId, h.Source, h.Posts, h.TasksCompleted, h.TasksForTomorrow, h.Registers, h.ImportantMessage, h.Principal]; }));
    coordTransportWriteTab_(ss, COORD_PDR_ISSUES_TAB, ['Id', 'CampusId', 'Type', 'Subject', 'First seen', 'Last seen', 'Days raised', 'Needs action', 'Items (JSON)', 'Pushed at'],
      body.issues.map(function (i) { return [i.id, i.campus, i.type, i.subject, i.first, i.last, i.count, i.needsAction ? 'yes' : 'no', JSON.stringify(i.items), now]; }));
  } finally { lock.releaseLock(); }
  if (Array.isArray(body.admissions) && body.admissions.length) {
    coordTransportWriteTab_(ss, COORD_PDR_ADMISSIONS_TAB, ['Date', 'CampusId', 'Total', 'Registered', 'TC issued', 'By class (JSON)'],
      body.admissions.map(function (a) { return [a.Date, a.Campus, a.Total, a.Registered, a.TCIssued, JSON.stringify(a.ByClass)]; }));
  }
  if (Array.isArray(body.repeats) && body.repeats.length) {
    coordTransportWriteTab_(ss, COORD_PDR_REPEATS_TAB, ['Date', 'CampusId', 'Tasks % repeated', 'Message % repeated', 'Previous report', 'Sample'],
      body.repeats.map(function (r) { return [r.Date, r.Campus, r.Tasks, r.Message, r.Prev, r.Sample]; }));
  }
  return { success: true, issues: body.issues.length, history: body.history.length, admissions: (body.admissions || []).length, repeats: (body.repeats || []).length };
}

/** Daily fee figures per campus, read from the body text of the CSM "Defaulters Followup Summary" emails the capture script saved.
 *  series rows: [date, campus id, fees received that day, follow-ups logged that day, total outstanding defaulter amount]. */
function coordFees_(ok) {
  const sh = SpreadsheetApp.openById(COORD_FEES_SHEET_ID).getSheetByName('Emails');
  const num = function (m) { return m ? parseInt(String(m[1]).replace(/[^\d]/g, ''), 10) || 0 : 0; };
  const series = [];
  if (sh && sh.getLastRow() > 1) sh.getDataRange().getDisplayValues().slice(1).forEach(function (r) {
    const campus = COORD_FEES_CAMPUS[r[1]];
    if (!campus || !ok(campus) || !r[0]) return;
    const b = r[4];
    series.push([r[0], campus, num(b.match(/Total Fees Received Today\*?\s*:\s*\**\u20B9?([\d,]+)/)), num(b.match(/Total Followups Done Today\s*:\*?\s*\**(\d+)/)), num(b.match(/Outstanding Fee Defaulter Amount\s*:\s*\**\u20B9?([\d,]+)/))]);
  });
  series.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
  return { series: series };
}

/** People an issue can be assigned to: Coordinators and the Owner in the allowlist. */
function coordPdrCoordinators_() {
  const out = [];
  SpreadsheetApp.openById(COORD_ALLOWLIST_SHEET_ID).getSheets()[0].getDataRange().getValues().slice(1).forEach(function (r) {
    const roles = String(r[3] || '').split(',').map(function (x) { return x.trim(); });
    if (r[0] && (roles.indexOf('Coordinator') !== -1 || roles.indexOf('Owner') !== -1)) out.push({ email: String(r[0]).trim().toLowerCase(), name: String(r[1] || '').trim() });
  });
  return out;
}

/** POST action=coordinatorpdrissue {idToken, id, status: open|acknowledged|assigned|resolved, assignee: email, note}: one row per issue in the actions tab. */
function coordPdrIssueAction_(caller, body) {
  const id = String(body.id || ''), status = String(body.status || '');
  if (['open', 'acknowledged', 'assigned', 'resolved'].indexOf(status) === -1) return { success: false, error: 'Unknown status' };
  const ss = SpreadsheetApp.openById(COORD_PDR_SHEET_ID), visible = coordVisibleCampuses_(caller);
  const ish = ss.getSheetByName(COORD_PDR_ISSUES_TAB);
  const issue = ish && ish.getLastRow() > 1 ? ish.getDataRange().getDisplayValues().slice(1).filter(function (r) { return r[0] === id; })[0] : null;
  if (!issue) return { success: false, error: 'Issue not found (it may have been regrouped by the latest sync); refresh the page' };
  if (visible && visible.indexOf(issue[1]) === -1) return { success: false, error: 'Not authorized' };
  let who = null;
  if (status === 'assigned') {
    who = coordPdrCoordinators_().filter(function (c) { return c.email === String(body.assignee || '').toLowerCase(); })[0];
    if (!who) return { success: false, error: 'Pick a coordinator to assign this to' };
  }
  const rec = [id, status, who ? who.email : '', who ? who.name : '', String(body.note || '').slice(0, 500), caller.email, new Date().toISOString().slice(0, 16).replace('T', ' '), issue[1], issue[5]];
  coordPdrWriteAction_(ss, rec);
  let taskError = '';
  try { coordPdrSyncTask_(issue, status, who, caller, rec[4]); } catch (err) { taskError = err.message; } // the action is saved either way
  return { success: true, taskError: taskError, action: { status: rec[1], assignee: rec[2], assigneeName: rec[3], note: rec[4], by: rec[5], at: rec[6], lastAtAction: rec[8] } };
}

/** One row per issue in the actions tab (insert or replace). Takes the script lock, so callers must not hold it. */
function coordPdrWriteAction_(ss, rec) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let sh = ss.getSheetByName(COORD_PDR_ACTIONS_TAB);
    if (!sh) {
      sh = ss.insertSheet(COORD_PDR_ACTIONS_TAB);
      sh.getRange(1, 1, 1, 9).setValues([['Issue id', 'Status', 'Assignee email', 'Assignee name', 'Note', 'Updated by', 'Updated at', 'CampusId', 'Last mention when updated']]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    const ids = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues() : [];
    let row = -1;
    for (let i = 0; i < ids.length; i++) if (ids[i][0] === rec[0]) { row = i + 2; break; }
    if (row < 0) row = sh.getLastRow() + 1;
    sh.getRange(row, 1, 1, 9).setNumberFormat('@').setValues([rec]);
  } finally { lock.releaseLock(); }
}

/** Keeps the All follow-ups page in step with an issue action. Assigned -> an open follow-up for the assignee (reopened if it was resolved);
 *  resolved or reset -> the follow-up is closed; acknowledged -> left as it is. issue = the row of the PDR Issues tab. */
function coordPdrSyncTask_(issue, status, who, caller, note) {
  const taskId = 'pdr_issue|' + issue[0];
  if (status === 'acknowledged') return;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = coordSheet_(), rows = sh.getDataRange().getValues(), now = new Date();
    let row = -1;
    for (let i = 1; i < rows.length; i++) if (rows[i][0] === taskId) { row = i + 1; break; }
    if (status === 'assigned') {
      const items = JSON.parse(issue[8] || '[]'), lastItem = items[items.length - 1] || { date: issue[5], text: '' };
      const daysOpen = Math.round((new Date(now.toISOString().slice(0, 10)) - new Date(issue[4])) / 86400000);
      const title = 'Systems: ' + issue[1] + ' ' + issue[3] + ' (' + issue[2] + ')';
      const detail = 'Open ' + daysOpen + ' days, raised on ' + issue[6] + ' days. Principal wrote (' + lastItem.date + '): ' + String(lastItem.text).slice(0, 220).replace(/[.\s]+$/, '') +
        '. Assigned by ' + caller.email.split('@')[0] + (note ? '. Note: ' + note : '.');
      const severity = issue[7] === 'yes' && daysOpen >= 7 ? 'high' : 'medium';
      if (row < 0) sh.appendRow([taskId, 'pdr_issue', issue[1], title, detail, 'open', severity, now, now, '', '', '', 'Systems', who.email]);
      else {
        sh.getRange(row, 4, 1, 4).setValues([[title, detail, 'open', severity]]);
        sh.getRange(row, 9, 1, 3).setValues([[now, '', '']]);
        sh.getRange(row, 13, 1, 2).setValues([['Systems', who.email]]);
      }
    } else if (row > 0 && rows[row - 1][5] === 'open') { // resolved or reset
      sh.getRange(row, 6).setValue('resolved');
      sh.getRange(row, 10, 1, 2).setValues([[now, caller.email + ' (Systems issue ' + (status === 'resolved' ? 'resolved' : status === 'merged' ? 'merged into another issue' : 'reset') + ')']]);
    }
  } finally { lock.releaseLock(); }
}

/** A follow-up raised from an issue was resolved on the All follow-ups page: mark the issue resolved too. */
function coordPdrResolveFromTask_(issueId, caller, note) {
  const ss = SpreadsheetApp.openById(COORD_PDR_SHEET_ID), ish = ss.getSheetByName(COORD_PDR_ISSUES_TAB);
  const issue = ish && ish.getLastRow() > 1 ? ish.getDataRange().getDisplayValues().slice(1).filter(function (r) { return r[0] === issueId; })[0] : null;
  if (!issue) return;
  coordPdrWriteAction_(ss, [issueId, 'resolved', '', '', String(note || 'Resolved from All follow-ups').slice(0, 500), caller.email, new Date().toISOString().slice(0, 16).replace('T', ' '), issue[1], issue[5]]);
}

/** POST action=coordinatorpdrmerge {idToken, source, target}: the source issue is the same problem as the target (same campus only). Empty target = undo.
 *  Merges never chain: the target is followed to its root, and anything already merged into the source is re-pointed to it. */
function coordPdrMerge_(caller, body) {
  const src = String(body.source || ''), tgt = String(body.target || '');
  const ss = SpreadsheetApp.openById(COORD_PDR_SHEET_ID), visible = coordVisibleCampuses_(caller);
  const ish = ss.getSheetByName(COORD_PDR_ISSUES_TAB);
  const all = ish && ish.getLastRow() > 1 ? ish.getDataRange().getDisplayValues().slice(1) : [];
  const find = function (id) { return all.filter(function (r) { return r[0] === id; })[0]; };
  const s = find(src);
  if (!s) return { success: false, error: 'Issue not found (it may have been regrouped by the latest sync); refresh the page' };
  if (visible && visible.indexOf(s[1]) === -1) return { success: false, error: 'Not authorized' };
  let t = null;
  if (tgt) {
    t = find(tgt);
    if (!t) return { success: false, error: 'The issue to merge into was not found; refresh the page' };
    if (t[1] !== s[1]) return { success: false, error: 'Only issues from the same campus can be merged' };
    if (tgt === src) return { success: false, error: 'An issue cannot be merged into itself' };
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let sh = ss.getSheetByName(COORD_PDR_MERGES_TAB);
    if (!sh) {
      sh = ss.insertSheet(COORD_PDR_MERGES_TAB);
      sh.getRange(1, 1, 1, 5).setValues([['Source id', 'Target id', 'Updated by', 'Updated at', 'CampusId']]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    const rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues() : [], map = {};
    rows.forEach(function (r) { map[r[0]] = r[1]; });
    let root = tgt;
    while (root && map[root]) root = map[root];
    if (tgt && root === src) return { success: false, error: 'That would merge the issues into each other' };
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const out = rows.filter(function (r) { return r[0] !== src; }).map(function (r) { return tgt && r[1] === src ? [r[0], root, r[2], r[3], r[4]] : r; });
    if (tgt) out.push([src, root, caller.email, stamp, s[1]]);
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 5).clearContent();
    if (out.length) sh.getRange(2, 1, out.length, 5).setNumberFormat('@').setValues(out);
    const merges = {};
    out.forEach(function (r) { merges[r[0]] = r[1]; });
    var result = { success: true, merges: merges };
  } finally { lock.releaseLock(); }
  if (tgt) { try { coordPdrSyncTask_(s, 'merged', null, caller, ''); } catch (err) { result.taskError = err.message; } } // an open follow-up for the merged-away issue closes
  return result;
}
