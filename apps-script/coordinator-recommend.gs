// ═══════════════════════════════════════════════════════════════════
// Coordinator Backend -- recommendations on approval requests (a file of the same "LMCS Coordinator Backend" project).
//
// The Owner decides every approval. A Coordinator records a recommendation (Approve / Reject / Info) with a reason; the Owner sees the latest one
// next to the request. Each write supersedes every live row for that request (any coordinator's), so the tab keeps the history and one row stays live.
// A private track record (how often the recommendation matched the final decision) is built from this tab; nothing here measures speed or volume.
//
// "Recommendations" tab in the LMCS Approvals workbook (COORD_SHEET_ID), read by position (the Game Backend does too), so never reorder:
//   RecId, ApprovalId, Campus, Category, RecommendedBy, Recommendation, Reason, Checked, RecommendedAt, Superseded
//
// POST action=coordinatorrecommend {idToken, approvalId, recommendation: Approve|Reject|Info, reason, checked: [..]}
// GET  action=coordinatortrackrecord  ->  {records: {email: {byCategory, recent}}}  (a Coordinator gets only their own; the Owner gets everyone's)
// ═══════════════════════════════════════════════════════════════════

const COORD_REC_TAB = 'Recommendations';
const COORD_REC_HEADERS = ['RecId', 'ApprovalId', 'Campus', 'Category', 'RecommendedBy', 'Recommendation', 'Reason', 'Checked', 'RecommendedAt', 'Superseded'];
const COORD_REC_MAX_REASON = 500;
const COORD_REC_MAX_CHECKED = 500;
const COORD_REC_CHOICES = ['Approve', 'Reject', 'Info'];
const COORD_REC_RECENT = 10;
// the final status that each recommendation is judged against; a Revoked approval counts as a Reject match
const COORD_REC_MATCH = { Approve: ['Approved'], Reject: ['Rejected', 'Revoked'], Info: ['Info Requested'] };
const COORD_REC_DECIDED = ['Approved', 'Rejected', 'Revoked', 'Info Requested'];

// Sheets may turn an ISO string into a Date and the text 'TRUE' into a boolean; read both back as plain strings.
function coordRecStr_(v) { return v instanceof Date ? v.toISOString() : String(v == null ? '' : v); }
function coordRecIsLive_(r) { return String(r[0]) !== 'RecId' && String(r[9]).toUpperCase() !== 'TRUE'; }

/** Error message for a recommendation request, or null when it is fine. aprRow is the Approvals row (status 13, archived 18). */
function coordRecValidate_(body, aprRow) {
  const reason = String(body.reason == null ? '' : body.reason).trim();
  if (typeof body.recommendation !== 'string' || COORD_REC_CHOICES.indexOf(body.recommendation) === -1) return 'Pick Approve, Reject or Ask for information.';
  if (!reason) return 'Write the reason for your recommendation.';
  if (reason.length > COORD_REC_MAX_REASON) return 'Keep the reason under ' + COORD_REC_MAX_REASON + ' characters.';
  if (['Pending', 'Info Requested'].indexOf(String(aprRow[13])) === -1) return 'This request was already decided.';
  if (String(aprRow[18]).toUpperCase() === 'TRUE') return 'This request is archived.';
  return null;
}

/** {approvalId: {by, recommendation, reason, checked, at}} from Recommendations rows (header row optional): live rows only, the later RecommendedAt wins. */
function coordRecLatest_(recRows) {
  const out = {};
  recRows.forEach(function (r) {
    if (!coordRecIsLive_(r) || !r[1]) return;
    const at = coordRecStr_(r[8]), id = String(r[1]);
    if (out[id] && out[id].at > at) return;
    const checked = coordRecStr_(r[7]);
    out[id] = { by: String(r[4]).toLowerCase(), recommendation: String(r[5]), reason: String(r[6]), checked: checked, at: at };
  });
  return out;
}

/** The recommendation as a client sees it: byName from the allowlist names ([{email, name}]), falling back to the email. */
function coordRecNamed_(rec, names) {
  const hit = names.filter(function (n) { return n.email === rec.by; })[0];
  return Object.assign({}, rec, { byName: (hit && hit.name) || rec.by });
}

function coordRecNames_() {
  try { return coordPdrCoordinators_(); } catch (err) { console.error('Recommendation names: ' + err.message); return []; }
}

/** The Recommendations sheet; read: null if the tab does not exist yet, write: created with its headers on first use. */
function coordRecSheet_(create) {
  const ss = SpreadsheetApp.openById(COORD_SHEET_ID);
  let sh = ss.getSheetByName(COORD_REC_TAB);
  if (!sh && create) {
    sh = ss.insertSheet(COORD_REC_TAB);
    sh.getRange(1, 1, 1, COORD_REC_HEADERS.length).setValues([COORD_REC_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** Rows of the Recommendations tab, or [] when it does not exist yet. */
function coordRecRows_() {
  const sh = coordRecSheet_(false);
  return sh && sh.getLastRow() > 1 ? sh.getDataRange().getValues() : [];
}

/** POST action=coordinatorrecommend. Coordinators only: the Owner decides directly. */
function coordRecommend_(caller, body) {
  if (caller.roles.indexOf('Owner') !== -1) return { success: false, error: 'The Owner decides directly.' };
  if (caller.roles.indexOf('Coordinator') === -1) return { success: false, error: 'Not authorized' };
  const id = String(body.approvalId || '');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const hit = coordAprFind_(id);
    if (!hit) return { success: false, error: 'Request not found' };
    const visible = coordVisibleCampuses_(caller);
    if (visible && visible.indexOf(String(hit.v[1]).trim()) === -1) return { success: false, error: 'Not authorized' };
    const bad = coordRecValidate_(body, hit.v);
    if (bad) return { success: false, error: bad };

    const sh = coordRecSheet_(true);
    const rows = sh.getLastRow() > 1 ? sh.getDataRange().getValues() : [];
    const at = new Date().toISOString();
    // "What I checked": optional free text (a list is joined), trimmed
    const checked = (Array.isArray(body.checked) ? body.checked.join('; ') : String(body.checked == null ? '' : body.checked)).trim().slice(0, COORD_REC_MAX_CHECKED);
    const rec = { by: caller.email, recommendation: body.recommendation, reason: String(body.reason).trim(), checked: checked, at: at };
    const row = ['rec-' + Date.now(), id, String(hit.v[1]).trim(), String(hit.v[2]), caller.email, rec.recommendation, rec.reason, checked, at, ''];
    sh.getRange(Math.max(sh.getLastRow(), 1) + 1, 1, 1, row.length).setNumberFormat('@').setValues([row]); // text format: keep the ISO string and a blank/TRUE flag as written
    // append first, supersede after: a failed append must not leave the request with no live recommendation
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][1]) === id && coordRecIsLive_(rows[i])) sh.getRange(i + 1, 10).setNumberFormat('@').setValue('TRUE');
    }
    return { success: true, recommendation: coordRecNamed_(rec, coordRecNames_()) };
  } finally { lock.releaseLock(); }
}

/** {email: {byCategory: {cat: {made, decided, matched}}, recent: [...]}}: the latest live recommendation per approval counts; email limits the result to one key.
    ponytail: matched compares with the row's CURRENT decision only; an Info Requested that was later overturned is invisible here. Upgrade: a decisions log. */
function coordTrackRecord_(recRows, aprRows, email) {
  const aprs = {};
  aprRows.forEach(function (r) { aprs[String(r[0])] = r; });
  const latest = {};
  recRows.forEach(function (r) {
    if (!coordRecIsLive_(r) || !r[1]) return;
    const id = String(r[1]);
    if (!latest[id] || coordRecStr_(latest[id][8]) <= coordRecStr_(r[8])) latest[id] = r;
  });
  const out = {}, mine = email ? String(email).toLowerCase() : null;
  Object.keys(latest).map(function (id) { return latest[id]; })
    .sort(function (a, b) { return coordRecStr_(a[8]) < coordRecStr_(b[8]) ? 1 : -1; }) // newest first, so `recent` fills in order
    .forEach(function (r) {
      const by = String(r[4]).toLowerCase();
      if (mine && by !== mine) return;
      const apr = aprs[String(r[1])] || [];
      // decided only by a decision made AFTER this recommendation (an earlier Info Requested must not score it)
      const decided = COORD_REC_DECIDED.indexOf(String(apr[13])) !== -1 && !!apr[14] && new Date(coordRecStr_(apr[15])).getTime() > new Date(coordRecStr_(r[8])).getTime();
      const matched = decided ? (Object.prototype.hasOwnProperty.call(COORD_REC_MATCH, r[5]) ? COORD_REC_MATCH[r[5]] : []).indexOf(String(apr[13])) !== -1 : null;
      const rec = out[by] = out[by] || { byCategory: {}, recent: [] };
      const cat = String(r[3] || apr[2] || '');
      const c = rec.byCategory[cat] = rec.byCategory[cat] || { made: 0, decided: 0, matched: 0 };
      c.made++;
      if (decided) { c.decided++; if (matched) c.matched++; }
      if (rec.recent.length < COORD_REC_RECENT) rec.recent.push({ approvalId: String(r[1]), title: String(apr[4] || ''), campus: String(r[2]), recommendation: String(r[5]), reason: String(r[6]),
        decision: decided ? String(apr[13]) : '', decisionNote: decided ? String(apr[16] || '') : '', matched: matched });
    });
  return out;
}

/** GET action=coordinatortrackrecord. Private: a Coordinator sees only their own, the Owner everyone's. */
function coordTrackRecordGet_(caller) {
  const owner = caller.roles.indexOf('Owner') !== -1;
  const apr = SpreadsheetApp.openById(COORD_SHEET_ID).getSheetByName('Approvals');
  const aprRows = apr && apr.getLastRow() > 1 ? apr.getDataRange().getValues() : [];
  return { success: true, records: coordTrackRecord_(coordRecRows_(), aprRows, owner ? null : caller.email) };
}

/** Attach `recommendation` ({by, byName, recommendation, reason, at} or null) to each approval|<id>|... task. */
function coordRecAttach_(tasks) {
  const wanted = tasks.filter(function (t) { return String(t.taskId).indexOf('approval|') === 0; });
  if (!wanted.length) return;
  const latest = coordRecLatest_(coordRecRows_()), names = coordRecNames_();
  wanted.forEach(function (t) {
    const l = latest[String(t.taskId).split('|')[1]];
    t.recommendation = l ? coordRecNamed_({ by: l.by, recommendation: l.recommendation, reason: l.reason, at: l.at }, names) : null;
  });
}
