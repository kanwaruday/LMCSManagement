// ═══════════════════════════════════════════════════════════════════
// driver-link.gs -- 2026-10-28, per Uday: drivers have no lms.org.in Google account, so a phone is linked to a driver instead.
// The Fee Clerk (or a Coordinator / the Owner) taps "Add driver phone", a QR with a one-time token appears, the driver scans it
// once, and that phone is tied to that driver and their bus until revoked. Phone-code sign-in replaces this later.
// Same project as transport-capture.gs (Roster: the only one with Drive) and reuses transport-uploads.gs's helpers
// (tupNormReg_, tupVehicle_, tupCovers_, TUP_SHEET_ID_) and staff-management-api.gs's HIR_EMPCODE_RE_.
//
// Store: the tab 'Driver Devices' of the transport workbook (private). Only the SHA-256 of a token is kept, never the token.
//
// POST {action:'driverlinkcreate', idToken, reg, driverCode?, driverName} -> {success, linkId, token}. The ONLY response that
//   ever carries a token. Who: as for capture (tupCovers_ of the bus's campus). One phone per driver: a new link revokes the
//   driver's earlier active links (same driver code; with no code, the same name on the same bus).
// POST {action:'driverlinkrevoke', idToken, linkId} -> {success}. Same rule against the link's campus. Idempotent.
// POST {action:'driverlinklist', idToken} -> {success, links:[{linkId, reg, campus, driverName, created, createdBy, revoked, lastSeen}]}
//   for the caller's campuses: active links, and those revoked in the last 30 days. No token, no hash.
// POST {action:'driverme', deviceToken} -> {success, name, reg, campus, runsNeeded, runsDone, lastFill, lastOdometer}, or one error
//   for an unknown and a revoked token alike. runsDone = the bus's processed route timelapses (rows of 'Capture Stops' with a video:
//   the Capture Runs Status column only ever says running/ended, the Mac's processed output is what lands in Capture Stops);
//   runsNeeded is 1 (no capture plan carries a number yet). lastFill/lastOdometer come from the 'Fuel Fills' mirror
//   (office-fuel-mirror.gs) raised by the bus's pending 'Driver Fills' (driver-fuel.gs dflLast_), null when neither can be read. Last Seen is written at most once an hour.
// capture: capAuth_ (transport-capture.gs) takes body.deviceToken in place of idToken: route timelapses of the linked bus only.
// ═══════════════════════════════════════════════════════════════════

const DLK_TAB_ = 'Driver Devices';
const DLK_HEADER_ = ['Link ID', 'Token Hash', 'Reg', 'Campus', 'Driver Code', 'Driver Name', 'Created', 'Created By', 'Revoked', 'Revoked By', 'Last Seen'];
const DLK_UNLINKED_ = 'This phone is not linked. Ask the office for a new link.'; // unknown and revoked tokens alike
const DLK_KEEP_DAYS_ = 30; // revoked links stay on the list this long
const DLK_RUNS_NEEDED_ = 1;

function dlkSheet_() {
  const ss = SpreadsheetApp.openById(TUP_SHEET_ID_);
  let sh = ss.getSheetByName(DLK_TAB_);
  if (!sh) {
    sh = ss.insertSheet(DLK_TAB_);
    sh.appendRow(DLK_HEADER_);
    sh.getRange(1, 1, 1, DLK_HEADER_.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

// 'sha256:<hex>': the prefix keeps Sheets from reading an all-digit hash as a number.
function dlkHash_(token) {
  const d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(token), Utilities.Charset.UTF_8);
  return 'sha256:' + d.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function dlkIso_(v) { return v instanceof Date ? v.toISOString() : String(v || ''); }

/** The active link of a device token: {at (sheet row), linkId, reg, campus, name}, or null (unknown, revoked or malformed). */
function dlkLink_(token) {
  if (!/^[a-f0-9]{64}$/.test(String(token || ''))) return null;
  const hash = dlkHash_(token), sh = SpreadsheetApp.openById(TUP_SHEET_ID_).getSheetByName(DLK_TAB_);
  const rows = sh ? sh.getDataRange().getValues() : [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]) !== hash) continue;
    if (rows[i][8]) return null;
    return { at: i + 1, linkId: String(rows[i][0]), reg: String(rows[i][2]), campus: String(rows[i][3]), name: String(rows[i][5]) };
  }
  return null;
}

function driverLinkCreate_(body) {
  const fail = function (m) { return { success: false, error: m }; };
  const caller = verifyStaffManagerToken_(body.idToken, ['FeeClerk']);
  if (!caller) return fail('Not authorized');
  const reg = tupNormReg_(body.reg), v = reg && tupVehicle_(reg);
  if (!v) return fail('Vehicle ' + (body.reg || '(none)') + ' is not in the fleet');
  if (!tupCovers_(caller, v.campusId)) return fail('You can only link phones for buses of your own campuses');
  const name = String(body.driverName || '').trim().replace(/\s+/g, ' ');
  if (!name) return fail('Type the driver\'s name');
  if (name.length > 60 || !/^[A-Za-z][A-Za-z .]*$/.test(name)) return fail('The name takes only letters, spaces and dots (at most 60)');
  const code = String(body.driverCode || '').trim().toUpperCase();
  if (code && !HIR_EMPCODE_RE_.test(code)) return fail('Not an employee code: ' + code.slice(0, 20));

  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); // 2 x 122 random bits
  const linkId = 'DL-' + Utilities.getUuid().replace(/-/g, '').slice(0, 12), now = new Date();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = dlkSheet_(), rows = sh.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) { // one phone per driver
      const r = rows[i], same = code ? String(r[4]).toUpperCase() === code
        : !r[4] && String(r[2]) === reg && String(r[5]).toLowerCase() === name.toLowerCase();
      if (same && !r[8] && tupCovers_(caller, String(r[3]))) sh.getRange(i + 1, 9, 1, 2).setValues([[now, caller.email]]);
    }
    sh.appendRow([linkId, dlkHash_(token), reg, v.campusId, code, name, now, caller.email, '', '', '']);
  } finally {
    lock.releaseLock();
  }
  return { success: true, linkId: linkId, token: token };
}

function driverLinkRevoke_(body) {
  const fail = function (m) { return { success: false, error: m }; };
  const caller = verifyStaffManagerToken_(body.idToken, ['FeeClerk']);
  if (!caller) return fail('Not authorized');
  const linkId = String(body.linkId || '');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = dlkSheet_(), rows = sh.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) !== linkId) continue;
      if (!tupCovers_(caller, String(rows[i][3]))) return fail('You can only revoke phones for buses of your own campuses');
      if (!rows[i][8]) sh.getRange(i + 1, 9, 1, 2).setValues([[new Date(), caller.email]]);
      return { success: true };
    }
  } finally {
    lock.releaseLock();
  }
  return fail('Link not found');
}

function driverLinkList_(body) {
  const caller = verifyStaffManagerToken_(body.idToken, ['FeeClerk']);
  if (!caller) return { success: false, error: 'Not authorized' };
  const since = Date.now() - DLK_KEEP_DAYS_ * 86400000, sh = SpreadsheetApp.openById(TUP_SHEET_ID_).getSheetByName(DLK_TAB_);
  const links = (sh ? sh.getDataRange().getValues().slice(1) : []).filter(function (r) {
    return r[0] && tupCovers_(caller, String(r[3])) && (!r[8] || new Date(r[8]).getTime() >= since);
  }).map(function (r) { // never r[1], the hash
    return { linkId: String(r[0]), reg: String(r[2]), campus: String(r[3]), driverName: String(r[5]), created: dlkIso_(r[6]),
      createdBy: String(r[7]), revoked: dlkIso_(r[8]), lastSeen: dlkIso_(r[10]) };
  });
  return { success: true, links: links };
}

/** Rows of a tab of the transport workbook as objects keyed by its header, or [] when the tab is missing. */
function dlkRows_(tab) {
  const sh = SpreadsheetApp.openById(TUP_SHEET_ID_).getSheetByName(tab);
  const v = sh ? sh.getDataRange().getValues() : [];
  return v.slice(1).map(function (r) { const o = {}; v[0].forEach(function (h, i) { o[h] = r[i]; }); return o; });
}

function driverMe_(body) {
  const link = dlkLink_(body.deviceToken);
  if (!link) return { success: false, error: DLK_UNLINKED_ };
  const cache = CacheService.getScriptCache(), seen = 'dlk_seen_' + link.linkId;
  if (!cache.get(seen)) {
    const sh = SpreadsheetApp.openById(TUP_SHEET_ID_).getSheetByName(DLK_TAB_);
    if (String(sh.getRange(link.at, 1).getValue()) === link.linkId) sh.getRange(link.at, 11).setValue(new Date()); // rows moved by hand: skip
    cache.put(seen, '1', 3600);
  }
  let runsDone = 0;
  try {
    runsDone = dlkRows_('Capture Stops').filter(function (r) { return tupNormReg_(r.reg) === link.reg && String(r.videoFileId || ''); }).length;
  } catch (e) { runsDone = 0; }
  const fuel = dflLast_(link.reg); // driver-fuel.gs: the Fuel Fills mirror and pending Driver Fills; never throws
  return { success: true, name: link.name, reg: link.reg, campus: link.campus, runsNeeded: DLK_RUNS_NEEDED_, runsDone: runsDone,
    lastFill: fuel.lastFill, lastOdometer: fuel.lastOdometer };
}
