// ═══════════════════════════════════════════════════════════════════
// APR — Approvals: requester/approver workflow so a Principal can ask
// the School Owner for sign-off (hiring, compensation, disciplinary,
// events, trips, holidays, financial/purchase, academic changes,
// other -- see APR_CATEGORIES) with their reasoning + evidence,
// instead of ad hoc calls/WhatsApp, and get a timestamped decision +
// reason back.
//
// Reuses this project's existing auth (verifyCallerToken_ in main.gs)
// and the SAME "LMCS Principal Allowlist" sheet every other file here
// already trusts. Decide-rights are NOT a new role:
//   - Owner can always decide.
//   - A Coordinator can ALSO decide ONLY if their Allowlist row has
//     column E (CanApprove) set to TRUE. Delegate/revoke by hand-
//     editing that one cell in the Allowlist sheet -- same
//     hand-edit-the-sheet pattern role/campusId already use, no new
//     admin UI for v1.
//   - Every decision permanently writes decidedBy + decidedAt +
//     decisionNote onto the row (rows are never edited after the
//     fact except by a later decision on the SAME row) -- so "what
//     did this delegate approve, and why" stays answerable by
//     filtering the sheet, even after CanApprove is later revoked.
//     Accountability falls out of the schema; there's no separate
//     audit-log feature to build.
//
// SETUP:
//   1. New Google Sheet "LMCS Approvals", two tabs (header row + these
//      columns, in this exact order -- the code below indexes by
//      column position, not header name):
//        Approvals: id, campusId, category, urgency, title,
//          description, amount, itemName, quantity,
//          linkedPlannedActivityId, evidenceLink, requestedByEmail,
//          requestedAt, status, decidedByEmail, decidedAt, decisionNote
//        Comments: id, approvalId, authorEmail, authorRole, body, postedAt
//   2. Paste that Sheet's id into APR_SHEET_ID below.
//   3. In the existing "LMCS Principal Allowlist" sheet, add a column
//      E header "CanApprove" -- leave blank for everyone; set a
//      Coordinator's cell to TRUE to delegate decide-rights to them,
//      blank/FALSE to revoke it.
//   4. Paste this file into the same "LMCS Principal's Daily Reporting
//      Backend" Apps Script project as main.gs -- no separate
//      deployment, main.gs's doGet/doPost already dispatch to it.
//
// v1 deliberately skips (see conversation this was designed in for
// the fuller rationale): multi-level approval chains, amount-based
// auto-routing/thresholds, real file upload for evidence (a pasted
// Drive/Photos link covers it for now -- upgrade path is a Drive
// upload endpoint if a principal actually needs one), and SLA/
// escalation emails beyond the one notify-on-submit / notify-on-
// decide pair below.
// ═══════════════════════════════════════════════════════════════════

const APR_SHEET_ID = '1Tr4Rfc6DN698eeGVjuCoXfSRR-NhBTWJibR00Ibj6P4'; // "LMCS Approvals"
const APR_TAB = 'Approvals';
const APR_COMMENTS_TAB = 'Comments';

// 2026-09-10, per Uday: replaced the generic 'HR' bucket with 3 named
// splits (Long Leave/Sabbatical and the other 4 brainstormed
// categories -- School Management, Fee Concession/Refund, Student
// Incident/Expulsion, Compliance/Regulatory -- were considered and cut).
const APR_CATEGORIES = ['Hiring / New Position', 'Compensation Change', 'Disciplinary / Termination', 'Compensatory Leave', 'Event / Invitation', 'Off-Campus Trip / Excursion', 'Holiday / Calendar', 'Financial / Purchase', 'Academic Change', 'Other'];
// Categories that show the Amount + Item fields -- Item doubles as
// "Item" (Financial/Purchase) or "Employee" (Compensation Change),
// same generic string column, just a different frontend label, so no
// new sheet column was needed for Compensation Change. Quantity only
// makes sense for an actual purchase, so it's gated separately.
const APR_AMOUNT_CATEGORIES = ['Financial / Purchase', 'Compensation Change'];
const APR_ITEM_QTY_CATEGORIES = ['Financial / Purchase'];
const APR_STATUS = { PENDING: 'Pending', INFO_REQUESTED: 'Info Requested', APPROVED: 'Approved', REJECTED: 'Rejected', REVOKED: 'Revoked' };
const APR_DECISIONS = [APR_STATUS.APPROVED, APR_STATUS.REJECTED, APR_STATUS.INFO_REQUESTED, APR_STATUS.REVOKED];

function aprSheet_() { return SpreadsheetApp.openById(APR_SHEET_ID).getSheetByName(APR_TAB); }
function aprCommentsSheet_() { return SpreadsheetApp.openById(APR_SHEET_ID).getSheetByName(APR_COMMENTS_TAB); }

// Owner always decides; a Coordinator decides only with the delegated
// flag main.gs's verifyCallerToken_ read off the Allowlist row.
function aprCanDecide_(caller) {
  return caller.role === 'Owner' || !!caller.canApprove;
}

function aprISO_(v) { return v instanceof Date ? v.toISOString() : String(v || ''); }

function aprRowToObj_(row) {
  return {
    id: String(row[0]), campusId: String(row[1]).trim(), category: String(row[2]),
    urgency: String(row[3] || 'Normal'), title: String(row[4]), description: String(row[5]),
    amount: row[6] === '' ? null : Number(row[6]),
    itemName: String(row[7] || ''), quantity: row[8] === '' ? null : Number(row[8]),
    linkedPlannedActivityId: String(row[9] || ''), evidenceLink: String(row[10] || ''),
    requestedBy: String(row[11]), requestedAt: aprISO_(row[12]),
    status: String(row[13]), decidedBy: String(row[14] || ''),
    decidedAt: row[15] ? aprISO_(row[15]) : '', decisionNote: String(row[16] || ''),
  };
}

// action=approvalslist -- Principal sees only their own campus;
// Owner/Coordinator (campusId 'ALL') see every campus, same
// campusId-based scoping every other action in this project uses.
function aprList_(caller) {
  const values = aprSheet_().getDataRange().getValues();
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row[0]) continue;
    if (caller.campusId !== 'ALL' && String(row[1]).trim() !== caller.campusId) continue;
    out.push(aprRowToObj_(row));
  }
  out.sort(function (a, b) { return b.requestedAt.localeCompare(a.requestedAt); });
  return { success: true, requests: out, canDecide: aprCanDecide_(caller) };
}

// action=approvaldetail&id=...
function aprDetail_(caller, id) {
  const values = aprSheet_().getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) !== String(id)) continue;
    if (caller.campusId !== 'ALL' && String(values[i][1]).trim() !== caller.campusId) {
      return { success: false, error: 'Not authorized for that campus' };
    }
    return { success: true, request: aprRowToObj_(values[i]), comments: aprComments_(id), canDecide: aprCanDecide_(caller) };
  }
  return { success: false, error: 'Request not found' };
}

function aprComments_(approvalId) {
  const values = aprCommentsSheet_().getDataRange().getValues();
  const out = [];
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][1]) !== String(approvalId)) continue;
    out.push({ id: String(values[i][0]), authorEmail: String(values[i][2]), authorRole: String(values[i][3]), body: String(values[i][4]), postedAt: aprISO_(values[i][5]) });
  }
  return out;
}

// Finds an Approval row by id, 0-indexed into getDataRange().getValues().
// Returns -1 if not found. Shared by comment/decide so both use the
// same lookup instead of two slightly different scans.
function aprFindRowIndex_(values, id) {
  for (let i = 1; i < values.length; i++) { if (String(values[i][0]) === String(id)) return i; }
  return -1;
}

// action=submitapproval (doPost) -- Principal only, always against
// their own campus (never a param -- can't be spoofed to file under
// another school).
function aprSubmit_(caller, body) {
  if (caller.role !== 'Principal') return { success: false, error: 'Only Principals submit approval requests' };
  const category = String(body.category || '').trim();
  if (APR_CATEGORIES.indexOf(category) === -1) return { success: false, error: 'Invalid category' };
  const title = String(body.title || '').trim();
  if (!title) return { success: false, error: 'Title required' };
  const description = String(body.description || '').trim();
  if (!description) return { success: false, error: 'Description required -- explain the reasoning' };

  const showsAmount = APR_AMOUNT_CATEGORIES.indexOf(category) !== -1;
  const showsQty = APR_ITEM_QTY_CATEGORIES.indexOf(category) !== -1;
  const id = 'apr-' + new Date().getTime() + '-' + Math.floor(Math.random() * 1000);
  aprSheet_().appendRow([
    id, caller.campusId, category, String(body.urgency || '') === 'Urgent' ? 'Urgent' : 'Normal',
    title, description,
    showsAmount && body.amount !== undefined && body.amount !== '' ? Number(body.amount) : '',
    showsAmount ? String(body.itemName || '').trim() : '',
    showsQty && body.quantity !== undefined && body.quantity !== '' ? Number(body.quantity) : '',
    String(body.linkedPlannedActivityId || ''), String(body.evidenceLink || '').trim(),
    caller.email, new Date(), APR_STATUS.PENDING, '', '', '',
  ]);
  aprNotifyDeciders_(caller, title, category);
  return { success: true, id: id };
}

// action=addapprovalcomment (doPost) -- anyone with view access to the
// request (campus-scoped, same rule as aprDetail_) can post into its
// thread: the requester explaining more, a Coordinator flagging
// something, or the Owner asking a question before deciding.
function aprAddComment_(caller, body) {
  const values = aprSheet_().getDataRange().getValues();
  const rowIdx = aprFindRowIndex_(values, body.approvalId);
  if (rowIdx === -1) return { success: false, error: 'Request not found' };
  const target = values[rowIdx];
  if (caller.campusId !== 'ALL' && String(target[1]).trim() !== caller.campusId) {
    return { success: false, error: 'Not authorized for that campus' };
  }
  const text = String(body.body || '').trim();
  if (!text) return { success: false, error: 'Comment text required' };

  const commentId = 'cmt-' + new Date().getTime() + '-' + Math.floor(Math.random() * 1000);
  aprCommentsSheet_().appendRow([commentId, String(target[0]), caller.email, caller.role, text, new Date()]);
  aprNotifyThread_(caller, target, text);
  return { success: true };
}

// action=decideapproval (doPost) -- Owner, or a Coordinator with
// CanApprove=TRUE. `decision` is Approved / Rejected / Info Requested
// / Revoked (Revoked only valid starting from Approved -- an Owner
// changing their mind after the fact, not a first decision). A note
// is required on every decision -- that's half the point of this
// portal existing.
function aprDecide_(caller, body) {
  if (!aprCanDecide_(caller)) return { success: false, error: 'Not authorized to decide approvals' };
  const decision = String(body.decision || '');
  if (APR_DECISIONS.indexOf(decision) === -1) return { success: false, error: 'Invalid decision' };
  const note = String(body.note || '').trim();
  if (!note) return { success: false, error: 'A note explaining the decision is required' };

  const sheet = aprSheet_();
  const values = sheet.getDataRange().getValues();
  const rowIdx = aprFindRowIndex_(values, body.id);
  if (rowIdx === -1) return { success: false, error: 'Request not found' };
  if (caller.campusId !== 'ALL' && String(values[rowIdx][1]).trim() !== caller.campusId) {
    return { success: false, error: 'Not authorized for that campus' };
  }
  if (decision === APR_STATUS.REVOKED && String(values[rowIdx][13]) !== APR_STATUS.APPROVED) {
    return { success: false, error: 'Only an Approved request can be revoked' };
  }

  const row = rowIdx + 1; // 1-based sheet row
  sheet.getRange(row, 14).setValue(decision);   // status
  sheet.getRange(row, 15).setValue(caller.email); // decidedBy
  sheet.getRange(row, 16).setValue(new Date());   // decidedAt
  sheet.getRange(row, 17).setValue(note);         // decisionNote
  aprNotifyRequester_(values[rowIdx], decision, note, caller);
  return { success: true };
}

// ── Email notifications (best-effort plain MailApp -- a mail failure
// must never fail the underlying submit/comment/decide, so every
// caller here is wrapped and swallows its own error). ────────────────
function aprNotifyDeciders_(caller, title, category) {
  try {
    const rows = pdrAllowlistRows_(); // shared cache from main.gs
    const to = [];
    for (let i = 1; i < rows.length; i++) {
      const role = String(rows[i][3] || '').trim();
      const canApprove = String(rows[i][4] || '').trim().toUpperCase() === 'TRUE';
      if (role === 'Owner' || canApprove) to.push(String(rows[i][0]).trim());
    }
    if (!to.length) return;
    MailApp.sendEmail(to.join(','), 'New approval request: ' + title,
      caller.email + ' (' + caller.campusId + ') requested approval for "' + title + '" [' + category +
      ']. Review it in the Approvals tab of the Principal’s Daily Reporting portal.');
  } catch (err) { /* best-effort */ }
}

function aprNotifyRequester_(row, decision, note, caller) {
  try {
    MailApp.sendEmail(String(row[11]), 'Approval ' + decision + ': ' + row[4],
      caller.email + ' marked "' + row[4] + '" as ' + decision + '.\n\nNote: ' + note);
  } catch (err) { /* best-effort */ }
}

function aprNotifyThread_(caller, row, text) {
  try {
    const requesterEmail = String(row[11]);
    if (caller.email === requesterEmail) return; // don't email yourself for your own comment
    MailApp.sendEmail(requesterEmail, 'New comment on "' + row[4] + '"', caller.email + ' commented: ' + text);
  } catch (err) { /* best-effort */ }
}
