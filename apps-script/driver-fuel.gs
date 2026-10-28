// ═══════════════════════════════════════════════════════════════════
// driver-fuel.gs -- 2026-10-28, per Uday: a linked driver phone (driver-link.gs) logs a fuel fill. It lands in a holding tab,
// 'Driver Fills' of the transport workbook (TUP_SHEET_ID_), NOT the Day Book: the Fee Clerk later confirms each fill against the
// bill into the Day Book (a later task: it fills Confirmed At / Confirmed By / Day Book Entry ID and moves Status on).
// Same project as driver-link.gs and transport-capture.gs (Roster: the only one with Drive).
//
// POST {action:'driverfuel', deviceToken, fillId, litres, amount, odometer, filledAt?, bill:{mime, base64}, video:{mime, base64}}
//   -> {success, fillId, status}. fillId is the phone's id for this fill: a repeat (the phone resending after a timeout) returns
//   the stored row and creates no new files. The numbers follow driver/driver-logic.js checkFill; the odometer may not go below
//   the bus's last recorded odometer nor more than 5000 km past it (dflLast_: the 'Fuel Fills' mirror and pending fills).
//   Files: the declared mime is ignored, the bytes are sniffed. Bill: a photo, <= 3 MB. Video: MP4/MOV/3GP ('ftyp' box), <= 25 MB.
//   Saved as Capture/Fuel/<REG>/<fillId>/bill.<ext> and video.<ext> (capFolder_). Every cell is a number, a Date or a server value.
// ═══════════════════════════════════════════════════════════════════

const DFL_TAB_ = 'Driver Fills';
const DFL_HEADER_ = ['Fill ID', 'Reg', 'Campus', 'Driver Link ID', 'Driver Name', 'Filled At', 'Litres', 'Amount', 'Odometer',
  'Bill File ID', 'Video File ID', 'Received', 'Status', 'Confirmed At', 'Confirmed By', 'Day Book Entry ID'];
const DFL_BILL_MAX_ = 3 * 1024 * 1024;
const DFL_VIDEO_MAX_ = 25 * 1024 * 1024;
const DFL_MAX_KM_ = 5000; // = MAX_KM_SINCE_LAST in driver/driver-logic.js
// = FUEL_FIELDS in driver/driver-logic.js
const DFL_NUMS_ = { litres: { min: 1, max: 400, int: false }, amount: { min: 1, max: 100000, int: true }, odometer: { min: 1, max: 9999999, int: true } };

function dflSheet_() {
  const ss = SpreadsheetApp.openById(TUP_SHEET_ID_);
  let sh = ss.getSheetByName(DFL_TAB_);
  if (!sh) {
    sh = ss.insertSheet(DFL_TAB_);
    sh.appendRow(DFL_HEADER_);
    sh.getRange(1, 1, 1, DFL_HEADER_.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

// driver-logic.js num(): plain digits with an optional decimal point, commas as thousands separators; else NaN.
function dflNum_(v) { const s = String(v == null ? '' : v).replace(/,/g, '').trim(); return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN; }

function dflDay_(d) { return d instanceof Date && isFinite(d.getTime()) ? Utilities.formatDate(d, TUP_TZ_, 'yyyy-MM-dd') : ''; }

/** {lastFill: 'yyyy-MM-dd'|null, lastOdometer: number|null} of a bus: the 'Fuel Fills' mirror's latest fill, raised by any
 *  pending Driver Fill. Neither source ever throws out of here (driverme must not fail on them). */
function dflLast_(reg) {
  let lastFill = null, lastOdometer = null;
  try {
    dlkRows_('Fuel Fills').forEach(function (f) {
      if (tupNormReg_(f.reg) !== reg) return;
      const day = f.date instanceof Date ? dflDay_(f.date) : String(f.date || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || (lastFill && day < lastFill)) return;
      lastFill = day;
      if (String(f.odometer) !== '' && isFinite(Number(f.odometer))) lastOdometer = Number(f.odometer);
    });
  } catch (e) { lastFill = null; lastOdometer = null; }
  try {
    dlkRows_(DFL_TAB_).forEach(function (f) {
      if (String(f['Reg']) !== reg || ['pending', 'confirmed'].indexOf(String(f['Status'])) === -1) return; // confirmed: not in the mirror until the Day Book has it
      const day = dflDay_(f['Filled At']) || dflDay_(f['Received']), odo = Number(f['Odometer']);
      if (day && (!lastFill || day > lastFill)) lastFill = day;
      if (String(f['Odometer']) !== '' && isFinite(odo) && (lastOdometer == null || odo > lastOdometer)) lastOdometer = odo;
    });
  } catch (e) { /* the mirror's answer stands */ }
  return { lastFill: lastFill, lastOdometer: lastOdometer };
}

/** {bytes, mime, ext} of an uploaded file, or {error}. kind 'bill' (a photo) or 'video'; the declared mime is never trusted. */
function dflFile_(f, kind) {
  const max = kind === 'video' ? DFL_VIDEO_MAX_ : DFL_BILL_MAX_, what = kind === 'video' ? 'The pump video' : 'The bill photo';
  const b64 = String((f && f.base64) || '');
  if (!b64) return { error: what + ' is missing' };
  if (b64.length > Math.ceil(max / 3) * 4 + 4) return { error: what + ' is larger than ' + max / 1048576 + ' MB' }; // before decoding it
  let bytes;
  try { bytes = Utilities.base64Decode(b64); } catch (e) { return { error: what + ' could not be read' }; }
  if (!bytes.length) return { error: what + ' is missing' };
  if (bytes.length > max) return { error: what + ' is larger than ' + max / 1048576 + ' MB' };
  const sniffed = tupSniff_(bytes);
  if (kind === 'bill') {
    if (sniffed.indexOf('image/') !== 0) return { error: 'The bill must be a photo (JPG, PNG, HEIC or WEBP)' };
    return { bytes: bytes, mime: sniffed, ext: SDOC_MIME_EXT_[sniffed] };
  }
  const txt = function (i, n) { let s = ''; for (let k = i; k < i + n; k++) s += String.fromCharCode(bytes[k] & 0xFF); return s; };
  if (bytes.length < 12 || txt(4, 4) !== 'ftyp' || sniffed) return { error: 'The pump video must be a video (MP4, MOV or 3GP)' }; // sniffed: a HEIC photo
  const brand = txt(8, 4);
  return brand === 'qt  ' ? { bytes: bytes, mime: 'video/quicktime', ext: 'mov' }
    : /^3g/.test(brand) ? { bytes: bytes, mime: 'video/3gpp', ext: '3gp' } : { bytes: bytes, mime: 'video/mp4', ext: 'mp4' };
}

function driverFuel_(body) {
  const fail = function (m) { return { success: false, error: m }; };
  const link = dlkLink_(body.deviceToken);
  if (!link) return fail(DLK_UNLINKED_);
  const fillId = String(body.fillId || '');
  // a leading letter: never a number, a date or a formula in the cell
  if (!/^[A-Za-z][A-Za-z0-9_-]{7,63}$/.test(fillId)) return fail('Bad fillId');
  const n = {};
  for (const k in DFL_NUMS_) {
    const r = DFL_NUMS_[k], v = dflNum_(body[k]);
    if (isNaN(v) || v < r.min || v > r.max || (r.int && Math.floor(v) !== v)) return fail('Check the ' + k);
    n[k] = v;
  }
  const t = body.filledAt, at = typeof t === 'number' && isFinite(t) ? new Date(t)
    : /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})?$/.test(String(t || '')) ? new Date(String(t)) : null;
  const filledAt = at && isFinite(at.getTime()) ? at : '';
  const bill = dflFile_(body.bill, 'bill');
  if (bill.error) return fail(bill.error);
  const video = dflFile_(body.video, 'video');
  if (video.error) return fail(video.error);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = dflSheet_(), old = sh.getDataRange().getValues().slice(1).filter(function (r) { return String(r[0]) === fillId; })[0];
    if (old) return String(old[1]) === link.reg ? { success: true, fillId: fillId, status: String(old[12]) } : fail('Bad fillId');
    const last = dflLast_(link.reg).lastOdometer;
    if (last != null && n.odometer < last) return fail('The odometer is less than last time (' + last + ')');
    if (last != null && n.odometer - last > DFL_MAX_KM_) return fail('The odometer is too far since last time (' + last + ')');
    const bus = capFolder_('Fuel', link.reg), dir = getSubfolder_(bus, fillId) || bus.createFolder(fillId); // Capture/Fuel/<REG>/<fillId>
    const save = function (f, name) { // an earlier try that died before its row was written left the file: reuse it
      const it = dir.getFilesByName(name);
      return (it.hasNext() ? it.next() : dir.createFile(Utilities.newBlob(f.bytes, f.mime, name))).getId();
    };
    const billId = save(bill, 'bill.' + bill.ext), videoId = save(video, 'video.' + video.ext);
    sh.appendRow([fillId, link.reg, link.campus, link.linkId, link.name, filledAt, n.litres, n.amount, n.odometer,
      billId, videoId, new Date(), 'pending', '', '', '']);
  } finally {
    lock.releaseLock();
  }
  return { success: true, fillId: fillId, status: 'pending' };
}
