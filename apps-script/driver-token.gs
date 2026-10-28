// driver-token.gs -- a linked driver phone's device token -> its link (driver-link.gs makes and revokes links). Shared by two Apps
// Script projects through apps-script/projects.json: the Roster (driverme, driverfuel, driverroute, capture) and the Coordinator
// (driverbus: the driver's Home Base, coordinator-driverbus.gs), so both read a token the same way. Only a token's SHA-256 is stored.
const DLK_TAB_ = 'Driver Devices';
const DLK_UNLINKED_ = 'This phone is not linked. Ask the office for a new link.'; // unknown and revoked tokens alike
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
