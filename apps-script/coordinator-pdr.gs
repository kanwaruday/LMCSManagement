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
const COORD_PDR_ISSUES_TAB = 'PDR Issues';   // issues grouped from the principals' Important Messages (push from the Mac)

// action=coordinatorpdr
function coordPdr_(caller) {
  const ss = SpreadsheetApp.openById(COORD_PDR_SHEET_ID);
  const visible = coordVisibleCampuses_(caller);
  const ok = function (campus) { return !visible || visible.indexOf(campus) !== -1; };
  const rows = ss.getSheetByName(COORD_PDR_TAB).getDataRange().getDisplayValues(); // dates are stored as ISO text
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
  return { success: true, fees: fees, admissions: admissions, reports: reports, tags: tags, taggedAt: taggedAt, history: history, issues: issues, pushedAt: pushedAt };
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
  return { success: true, issues: body.issues.length, history: body.history.length, admissions: (body.admissions || []).length };
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
