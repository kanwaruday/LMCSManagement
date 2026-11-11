// ═══════════════════════════════════════════════════════════════════
// Coordinator Backend -- follow-ups on APPROVED approval requests (a file of the same "LMCS Coordinator Backend" project).
//
// Once a request is approved, someone has to make it happen (buy the fan, run the event). A decider (the Owner, or a Coordinator with the delegated
// approve right) allocates that to a portal user with a due date. Two things are written:
//   1. the Approvals row itself, in six extra columns after the existing ones, so BOTH portals show it: the Systems Approvals tab and, through
//      approvals.gs's aprRowToObj_, the principal's own request page (who has it, due when, done with what note);
//   2. a follow-up task (TaskId apr_follow|<approval id>) with the assignee and the due date, which is what shows on the assignee's All follow-ups.
// Resolving that follow-up marks the row done. Revoking the approval cancels the allocation.
// Hiring requests (New/ Backup Position, Salary Offer Approval) are left out: the Hiring dashboard already tracks them through to joining.
//
// POST action=coordinatorallocate {idToken, approvalId, assignee, due, note}  |  {approvalId, cancel: true}
// ═══════════════════════════════════════════════════════════════════

const COORD_APR_FOLLOW_SKIP = ['New/ Backup Position', 'Salary Offer Approval']; // tracked in Hiring
const COORD_APR_FOLLOW_COL = 20; // 1-based sheet column of the first follow-up field (after Archived, which is column 19)
const COORD_APR_FOLLOW_HEADERS = ['FollowUpEmail', 'FollowUpName', 'FollowUpDue', 'FollowUpStatus', 'FollowUpNote', 'FollowUpDoneAt'];

/** Row number (1-based) of an approval in the Approvals tab, with its values, or null. */
function coordAprFind_(id) {
  const sh = SpreadsheetApp.openById(COORD_SHEET_ID).getSheetByName('Approvals');
  if (!sh || sh.getLastRow() < 2) return null;
  const values = sh.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) if (String(values[i][0]) === id) return { sh: sh, row: i + 1, v: values[i] };
  return null;
}

/** Headers for the six follow-up columns, once (a sheet that has never had a follow-up has none). */
function coordAprFollowHeaders_(sh) {
  const need = COORD_APR_FOLLOW_COL + COORD_APR_FOLLOW_HEADERS.length - 1;
  if (sh.getMaxColumns() < need) sh.insertColumnsAfter(sh.getMaxColumns(), need - sh.getMaxColumns()); // writing past the sheet's last column would fail
  if (!sh.getRange(1, COORD_APR_FOLLOW_COL).getValue()) sh.getRange(1, COORD_APR_FOLLOW_COL, 1, COORD_APR_FOLLOW_HEADERS.length).setValues([COORD_APR_FOLLOW_HEADERS]).setFontWeight('bold');
}

function coordAprAllocate_(caller, body) {
  const id = String(body.approvalId || '');
  if (!caller.canDecide) return { success: false, error: 'Only the Owner, or a Coordinator with decision rights, can allocate a follow-up' };
  const hit = coordAprFind_(id);
  if (!hit) return { success: false, error: 'Request not found' };
  const r = hit.v, campus = String(r[1]).trim(), category = String(r[2]), title = String(r[4]);
  const visible = coordVisibleCampuses_(caller);
  if (visible && visible.indexOf(campus) === -1) return { success: false, error: 'Not authorized' };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (body.cancel) { coordAprClear_(hit, caller, 'allocation removed'); return { success: true, cancelled: true }; }
    if (String(r[13]) !== 'Approved') return { success: false, error: 'Only an approved request can have a follow-up' };
    if (COORD_APR_FOLLOW_SKIP.indexOf(category) !== -1) return { success: false, error: category + ' requests are tracked in the Hiring dashboard' };
    const who = coordPdrCoordinators_().filter(function (c) { return c.email === String(body.assignee || '').toLowerCase(); })[0];
    if (!who) return { success: false, error: 'Pick a coordinator to allocate this to' };
    const due = String(body.due || '');
    const today = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || due < today) return { success: false, error: 'Pick a due date that is today or later' };
    const note = String(body.note || '').slice(0, 300);

    coordAprFollowHeaders_(hit.sh);
    hit.sh.getRange(hit.row, COORD_APR_FOLLOW_COL, 1, 6).setNumberFormat('@').setValues([[who.email, who.name, due, 'open', note, '']]);

    // the assignee's follow-up: created, or reopened and updated if it existed
    const sh = coordSheet_(), rows = sh.getDataRange().getValues(), now = new Date(), taskId = 'apr_follow|' + id;
    const decided = r[15] ? Utilities.formatDate(new Date(r[15]), 'Asia/Kolkata', 'd MMM') : '';
    const dept = COORD_APPROVAL_DEPT[category] || COORD_DEPT_OPS;
    const ftitle = 'Follow up on approval: ' + title + ' (' + category + ')';
    const detail = 'Approved' + (decided ? ' ' + decided : '') + (r[14] ? ' by ' + String(r[14]).split('@')[0] : '') + ', requested by ' + String(r[11]).split('@')[0] + '. Due ' + due + '.' + (note ? ' Note: ' + note : '');
    let row = -1;
    for (let i = 1; i < rows.length; i++) if (rows[i][0] === taskId) { row = i + 1; break; }
    if (row < 0) sh.appendRow([taskId, 'apr_follow', campus, ftitle, detail, 'open', 'medium', now, now, '', '', '', dept, who.email, due]);
    else {
      sh.getRange(row, 4, 1, 4).setValues([[ftitle, detail, 'open', 'medium']]);
      sh.getRange(row, 9, 1, 3).setValues([[now, '', '']]);
      sh.getRange(row, 13, 1, 3).setValues([[dept, who.email, due]]);
    }
    return { success: true, followUp: { assignee: who.email, assigneeName: who.name, due: due, status: 'open', note: note } };
  } finally { lock.releaseLock(); }
}

/** Removes the allocation from the row and closes the assignee's follow-up. Caller holds the lock. */
function coordAprClear_(hit, caller, why) {
  coordAprFollowHeaders_(hit.sh);
  hit.sh.getRange(hit.row, COORD_APR_FOLLOW_COL, 1, 6).setNumberFormat('@').setValues([['', '', '', '', '', '']]);
  const sh = coordSheet_(), rows = sh.getDataRange().getValues(), taskId = 'apr_follow|' + String(hit.v[0]);
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] !== taskId || rows[i][5] !== 'open') continue;
    sh.getRange(i + 1, 6).setValue('resolved');
    sh.getRange(i + 1, 10, 1, 2).setValues([[new Date(), caller.email + ' (' + why + ')']]);
  }
}

/** The assignee resolved the follow-up on the All follow-ups page: mark the approval's follow-up done, with their note. */
function coordAprFollowDone_(approvalId, caller, note) {
  const hit = coordAprFind_(approvalId);
  if (!hit) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    coordAprFollowHeaders_(hit.sh);
    const kept = String(hit.v[COORD_APR_FOLLOW_COL - 1 + 4] || ''); // the allocation note stays if the assignee adds none; a done note replaces it
    hit.sh.getRange(hit.row, COORD_APR_FOLLOW_COL + 3, 1, 3).setNumberFormat('@').setValues([['done', String(note || kept).slice(0, 300), new Date().toISOString().slice(0, 16).replace('T', ' ')]]);
  } finally { lock.releaseLock(); }
}

/** A task's severity once its due date has passed: overdue is always high. */
function coordDueSeverity_(severity, due, today) {
  return due && due < today ? 'high' : severity;
}

// ── lms-game W4: the native Approvals room's game* actions (lane-h, 2026-11-12) ──────────────────────────────────────────────────
// Called only by lms-game's `classic` Edge Function (classic-proxy-contract.md), POST {action, key, role, campus, campuses, email, params}.
// key: GAME_READ_KEY (the same gate as gameworld; the proxy's CLASSIC_COORD_KEY is that value). email: from the game's VERIFIED JWT,
// sent on writes and on the actor reads (allocatees, track record); roles and the decide right are re-derived from the allowlist by it
// (coordCallerForEmail_), never taken from the request. campus: the one school a campus-scope action may touch (the row must be there);
// campuses: a tenant-scope action's school list (rows outside it are dropped). Answers {success:true, data:{ok, ...}}; a business refusal
// is {success:true, data:{ok:false, code}}. People are {key, name}: key = HMAC of the email (GAME_PEOPLE_SECRET). Never an email.
const COORD_GAME_ACTIONS = ['gameApprovalAllocate', 'gameApprovalAllocatees', 'gameRecommend', 'gameDecisionPreview', 'gameTrackRecord'];
const COORD_GAME_CODES = [
  [/not found/i, 'not_found'], [/not authorized|only the owner|owner decides directly/i, 'not_authorized'], [/already decided/i, 'decided'],
  [/archived/i, 'archived'], [/only an approved request/i, 'not_approved'], [/tracked in the hiring dashboard/i, 'hiring'],
  [/pick a coordinator|due date|pick approve|write the reason|keep the reason/i, 'bad_input'],
];
const coordGameOk_ = function (data) { return { success: true, data: Object.assign({ ok: true }, data || {}) }; };
const coordGameNo_ = function (code) { return { success: true, data: { ok: false, code: code } }; };
function coordGameCode_(res) {
  const e = String((res && res.error) || '');
  for (let i = 0; i < COORD_GAME_CODES.length; i++) if (COORD_GAME_CODES[i][0].test(e)) return COORD_GAME_CODES[i][1];
  return 'refused';
}
/** An opaque, stable key for a person: HMAC-SHA256(email) with GAME_PEOPLE_SECRET, web-safe, 22 chars. */
function coordGameKey_(email) {
  const secret = String(PropertiesService.getScriptProperties().getProperty('GAME_PEOPLE_SECRET') || '');
  if (secret.length < 32) throw new Error('GAME_PEOPLE_SECRET not set');
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(String(email).trim().toLowerCase(), secret)).replace(/=+$/, '').slice(0, 22);
}
/** The school codes this request may touch: campus scope = the one school; tenant scope = its list; anything else = none. */
function coordGameSchools_(body) {
  if (body.campus) return [String(body.campus).trim().toUpperCase()];
  return Array.isArray(body.campuses) ? body.campuses.map(function (c) { return String(c).trim().toUpperCase(); }) : [];
}

/** POST action=game*: dispatched from coordinator.gs doPost before the Google-token check (the key is this path's gate). */
function coordGameApprovals_(body) {
  if (!coordGameKeyOk_(body)) return { success: false, error: 'not_authorized' };
  const action = String(body.action);
  if (COORD_GAME_ACTIONS.indexOf(action) === -1) return { success: false, error: 'unknown_action' };
  const p = body.params || {}, schools = coordGameSchools_(body);
  try {
    if (action === 'gameDecisionPreview') return coordGameDecisionPreview_(String(p.id || ''), schools); // a plain read: no person needed
    let caller;
    try { caller = coordCallerForEmail_(body.email); } catch (err) { caller = null; }
    if (!caller || caller.feeClerkOnly) return coordGameNo_('not_authorized');
    if (action === 'gameApprovalAllocatees') {
      if (!caller.canDecide) return coordGameNo_('not_authorized');
      return coordGameOk_({ people: coordPdrCoordinators_().map(function (c) { return { key: coordGameKey_(c.email), name: c.name }; }) });
    }
    if (action === 'gameTrackRecord') return coordGameTrackRecord_(caller, schools);
    const id = String(p.id || ''), hit = coordAprFind_(id);
    if (!hit) return coordGameNo_('not_found');
    if (schools.indexOf(String(hit.v[1]).trim().toUpperCase()) === -1) return coordGameNo_('not_authorized');
    if (action === 'gameRecommend') return coordGameRecommend_(caller, id, p);
    // gameApprovalAllocate: {id, assignee: key, due, note} or {id, cancel: '1'}
    if (p.cancel !== undefined && p.cancel !== '1') return coordGameNo_('bad_input');
    let assignee = '';
    if (p.cancel !== '1') {
      const who = coordPdrCoordinators_().filter(function (c) { return coordGameKey_(c.email) === String(p.assignee || ''); })[0];
      if (!who) return coordGameNo_('bad_input');
      assignee = who.email;
    }
    const res = coordAprAllocate_(caller, { approvalId: id, assignee: assignee, due: String(p.due || ''), note: String(p.note || '').slice(0, 300), cancel: p.cancel === '1' });
    if (!res.success) return coordGameNo_(coordGameCode_(res));
    return coordGameOk_(res.cancelled ? { cancelled: true } : { followUp: { assigneeName: res.followUp.assigneeName, due: res.followUp.due, status: res.followUp.status, note: res.followUp.note } });
  } catch (err) {
    console.error('coordGameApprovals ' + action + ': ' + (err && err.name)); // never the message: it can carry sheet text
    return { success: false, error: 'backend' };
  }
}
