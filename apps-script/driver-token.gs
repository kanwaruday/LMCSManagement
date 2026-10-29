// driver-token.gs -- a linked driver phone's device token -> its link (driver-link.gs makes and revokes links). Shared by two Apps
// Script projects through apps-script/projects.json: the Roster (driverme, driverfuel, driverroute, capture) and the Coordinator
// (driverbus: the driver's Home Base, coordinator-driverbus.gs), so both read a token the same way. Only a token's SHA-256 is stored.
const DLK_TAB_ = 'Driver Devices';
const DLK_UNLINKED_ = 'This phone is not linked. Ask the office for a new link.'; // unknown and revoked tokens alike
const DLK_NOVIEW_ = 'Only the Owner and Coordinators can view a driver\'s page.';
const DLK_BOOK_ID_ = '1VXTMZjqCS82ftB1rwoN4BzoiOTP7-Vg0m5vTH01Tfzc'; // the transport workbook: TUP_SHEET_ID_ (Roster), COORD_TRANSPORT_FORM_ID (Coordinator)

// 'sha256:<hex>': the prefix keeps Sheets from reading an all-digit hash as a number.
function dlkHash_(token) {
  const d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(token), Utilities.Charset.UTF_8);
  return 'sha256:' + d.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function dlkIso_(v) { return v instanceof Date ? v.toISOString() : String(v || ''); }

/** The active link of a device token: {at (sheet row), linkId, reg, campus, name}, or null (unknown, revoked or malformed). */
function dlkLink_(token) {
  if (!/^[a-f0-9]{64}$/.test(String(token || ''))) return null;
  const hash = dlkHash_(token), sh = SpreadsheetApp.openById(DLK_BOOK_ID_).getSheetByName(DLK_TAB_);
  const rows = sh ? sh.getDataRange().getValues() : [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]) !== hash) continue;
    if (rows[i][8]) return null;
    return { at: i + 1, linkId: String(rows[i][0]), reg: String(rows[i][2]), campus: String(rows[i][3]), name: String(rows[i][5]) };
  }
  return null;
}

// The staff view (Uday, 29 Oct: "normal google login is also possible especially for owner and coordinators"): the Owner or a
// Coordinator opens the driver page as a running bus's driver, read only, as the Owner views a school as its Principal. Its link is
// built from the fleet register, never from a Driver Devices row: no token is made, no Last Seen is written, no phone is unlinked.
// Only driverme, driverroute and driverbus take it; driverfuel and capture read dlkLink_ alone, so a staff view can send nothing.

/** Running buses of the fleet register ('LM Studio Fleet'): [{reg, bus, campus, driver}], reg as Driver Devices keeps it. */
function dlkFleet_() {
  const sh = SpreadsheetApp.openById(DLK_BOOK_ID_).getSheetByName('LM Studio Fleet');
  const out = [];
  (sh ? sh.getDataRange().getValues().slice(1) : []).forEach(function (r) {
    const reg = String(r[0] || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); // = tupNormReg_ (Roster only)
    if (reg && String(r[3]) === 'yes') out.push({ reg: reg, bus: String(r[1] || ''), campus: 'LMS' + String(r[2]).replace(/\D/g, ''), driver: String(r[6] || '') });
  });
  return out;
}

/** Owner or Coordinator, by the roles the calling project's own staff check found (null: not on its allowlist). */
function dlkStaff_(roles) { return !!roles && (roles.indexOf('Owner') !== -1 || roles.indexOf('Coordinator') !== -1); }

/** A driver phone's link (body.deviceToken), or, with no device token, a staff view of body.viewReg when rolesOf(body.idToken) is
 *  the Owner's or a Coordinator's: {at: 0, linkId: '', reg, campus, name, view: true}. null for anything else. */
function dlkLinkOrView_(body, rolesOf) {
  if (body.deviceToken || !body.viewReg || !body.idToken) return dlkLink_(body.deviceToken);
  if (!dlkStaff_(rolesOf(body.idToken))) return null;
  const want = String(body.viewReg).toUpperCase().replace(/[^A-Z0-9]/g, ''), b = dlkFleet_().filter(function (x) { return x.reg === want; })[0];
  return b ? { at: 0, linkId: '', reg: b.reg, campus: b.campus, name: b.driver || 'Driver', view: true } : null;
}
