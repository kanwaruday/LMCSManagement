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

const DLK_HEADER_ = ['Link ID', 'Token Hash', 'Reg', 'Campus', 'Driver Code', 'Driver Name', 'Created', 'Created By', 'Revoked', 'Revoked By', 'Last Seen'];
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

// dlkHash_ and dlkLink_ live in driver-token.gs, shared with the Coordinator project (its driverbus reads the same links).

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
        : String(r[2]) === reg && String(r[5]).toLowerCase() === name.toLowerCase(); // no code typed: the same name on the same bus, coded or not (a Google sign-in row has a code)
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
  return { success: true, links: links, googleReady: dglGoogleReady_(function (c) { return tupCovers_(caller, c); }) }; // driver-google.gs: a count only
}

/** Rows of a tab of the transport workbook as objects keyed by its header, or [] when the tab is missing. */
function dlkRows_(tab) {
  const sh = SpreadsheetApp.openById(TUP_SHEET_ID_).getSheetByName(tab);
  const v = sh ? sh.getDataRange().getValues() : [];
  return v.slice(1).map(function (r) { const o = {}; v[0].forEach(function (h, i) { o[h] = r[i]; }); return o; });
}

/** POST driverroute {deviceToken}: the linked bus's own route for the driver's World map, read only: its stops and tracks from the
 *  GPS tabs of the transport workbook (the same rows Coordinators see in transportworld), never another bus's, never money.
 *  Unknown or revoked token: the same UNLINKED answer as driverme. */
function driverRoute_(body) {
  const link = dlkLinkOrView_(body, dlkRosterRoles_); // or the Owner's or a Coordinator's read-only view (driver-token.gs)
  if (!link) return { success: false, code: 'UNLINKED', error: DLK_UNLINKED_ };
  const own = function (reg) { return tupNormReg_(reg) === link.reg; };
  const cell = function (v) { return v instanceof Date ? Utilities.formatDate(v, TUP_TZ_, 'yyyy-MM-dd') : v; };
  const path = function (p) { try { const x = JSON.parse(p || '[]'); return Array.isArray(x) ? x : []; } catch (e) { return []; } };
  const stops = dlkRows_('GPS Stops').filter(function (r) { return own(r.bus); }).map(function (r) {
    const o = {}; Object.keys(r).forEach(function (k) { o[k] = cell(r[k]); }); o.bus = link.reg; o.shared_with = ''; return o; // other buses are not named
  });
  const tracks = dlkRows_('GPS Tracks').filter(function (t) { return own(t.reg); }).map(function (t) { return { reg: link.reg, trip: String(t.trip), date: cell(t.date), path: path(t.path) }; });
  return { success: true, vehicles: [{ reg: link.reg, campus: link.campus, operational: true }], days: [], stops: stops, tracks: tracks };
}

function driverMe_(body) {
  const link = dlkLinkOrView_(body, dlkRosterRoles_);
  if (!link) return { success: false, code: 'UNLINKED', error: DLK_UNLINKED_ }; // the phone forgets its token only on this code
  const cache = CacheService.getScriptCache(), seen = 'dlk_seen_' + link.linkId;
  if (!link.view && !cache.get(seen)) { // a staff view is not the driver's phone: Last Seen stays the driver's
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
    lastFill: fuel.lastFill, lastOdometer: fuel.lastOdometer, view: !!link.view };
}

/** The Roster's staff check for a view: verifyStaffManagerToken_'s roles (staff-management-api.gs), or null. */
function dlkRosterRoles_(idToken) { const c = verifyStaffManagerToken_(idToken); return c && c.roles; }

/** POST driverviewbuses {idToken}: the running buses the Owner or a Coordinator can view as their driver. */
function driverViewBuses_(body) {
  if (!body.idToken || !dlkStaff_(dlkRosterRoles_(body.idToken))) return { success: false, error: DLK_NOVIEW_ };
  return { success: true, buses: dlkFleet_() };
}
