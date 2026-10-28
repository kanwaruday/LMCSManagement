// ═══════════════════════════════════════════════════════════════════
// driver-fill-confirm.gs -- 2026-10-28, per Uday: a driver's fuel fill waits in 'Driver Fills' (driver-fuel.gs, status 'pending')
// until the Fee Clerk checks it against the bill photo and the pump video and confirms it with one tap (or rejects it with a reason).
// Only a confirmed fill becomes the Day Book fuel entry, and that write belongs to the Office backend (office-driver-fills.gs
// 'driverfill.daybook'): it reads the confirmed row from the same workbook and writes the entry id back into 'Day Book Entry ID'.
// Same project as driver-fuel.gs (Roster). Who: verifyStaffManagerToken_ with FeeClerk; tupCovers_ of the fill's campus.
//
// POST {action:'driverfilllist', idToken} -> {success, fills:[{fillId, reg, campus, driverName, filledAt, received, litres, amount,
//   odometer, billFileId, videoFileId, status, decidedAt, decidedBy, reason, dayBookEntryId}]}: every pending fill of the caller's
//   campuses, and those decided in the last 14 days. Drive ids only: the page opens them in Drive.
// POST {action:'driverfilldecide', idToken, fillId, decision:'confirm'|'reject', reason?} -> {success, fillId, status}.
//   Under the lock. The same decision again is a no-op; the other decision on a decided fill is refused. A reject needs a short
//   reason (3-200 characters, staff eyes only: the driver's page never reads it). Confirmed At / Confirmed By record either decision.
// ═══════════════════════════════════════════════════════════════════

const DFC_REASON_COL_ = 'Reject Reason'; // column 17, after driver-fuel.gs's 16; its header is added on the first decision
const DFC_KEEP_DAYS_ = 14;

function dfcIso_(v) { return v instanceof Date && isFinite(v.getTime()) ? v.toISOString() : String(v || ''); }

// Free text a person typed, made safe for a cell: one line, at most 200 characters, never starting with a formula character.
function dfcReason_(s) { return String(s || '').replace(/\s+/g, ' ').trim().replace(/^[=+\-@'\s]+/, '').slice(0, 200); }

function driverFillList_(body) {
  const caller = verifyStaffManagerToken_(body.idToken, ['FeeClerk']);
  if (!caller) return { success: false, error: 'Not authorized' };
  const since = Date.now() - DFC_KEEP_DAYS_ * 86400000;
  const fills = dlkRows_(DFL_TAB_).filter(function (r) {
    if (!r['Fill ID'] || !tupCovers_(caller, String(r['Campus']))) return false;
    const st = String(r['Status']);
    return st === 'pending' || (r['Confirmed At'] instanceof Date && r['Confirmed At'].getTime() >= since);
  }).map(function (r) {
    return { fillId: String(r['Fill ID']), reg: String(r['Reg']), campus: String(r['Campus']), driverName: String(r['Driver Name']),
      filledAt: dfcIso_(r['Filled At']), received: dfcIso_(r['Received']), litres: Number(r['Litres']), amount: Number(r['Amount']),
      odometer: Number(r['Odometer']), billFileId: String(r['Bill File ID']), videoFileId: String(r['Video File ID']), status: String(r['Status']),
      decidedAt: dfcIso_(r['Confirmed At']), decidedBy: String(r['Confirmed By'] || ''), reason: String(r[DFC_REASON_COL_] || ''),
      dayBookEntryId: String(r['Day Book Entry ID'] || '') };
  });
  return { success: true, fills: fills };
}

function driverFillDecide_(body) {
  const fail = function (m) { return { success: false, error: m }; };
  const caller = verifyStaffManagerToken_(body.idToken, ['FeeClerk']);
  if (!caller) return fail('Not authorized');
  const fillId = String(body.fillId || ''), decision = body.decision;
  if (decision !== 'confirm' && decision !== 'reject') return fail('Bad decision');
  const status = decision === 'confirm' ? 'confirmed' : 'rejected';
  const reason = decision === 'reject' ? dfcReason_(body.reason) : '';
  if (decision === 'reject' && reason.length < 3) return fail('Say in a few words why the fill is rejected');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = dflSheet_(), v = sh.getDataRange().getValues(), head = v[0].map(String);
    for (let i = 1; i < v.length; i++) {
      if (String(v[i][0]) !== fillId || !fillId) continue;
      if (!tupCovers_(caller, String(v[i][2]))) return fail('You can only decide fills of your own campuses');
      const now = String(v[i][12]);
      if (now === status) return { success: true, fillId: fillId, status: status }; // a repeat tap
      if (now !== 'pending') return fail('This fill is already ' + now);
      let rc = head.indexOf(DFC_REASON_COL_) + 1;
      if (!rc) { rc = Math.max(head.length, DFL_HEADER_.length) + 1; sh.getRange(1, rc).setValue(DFC_REASON_COL_); }
      sh.getRange(i + 1, 13, 1, 3).setValues([[status, new Date(), caller.email]]);
      if (reason) sh.getRange(i + 1, rc).setValue(reason);
      return { success: true, fillId: fillId, status: status };
    }
  } finally {
    lock.releaseLock();
  }
  return fail('Fill not found');
}
