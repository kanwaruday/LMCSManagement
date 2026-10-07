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
  return { success: true, reports: reports, tags: tags, taggedAt: taggedAt };
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
