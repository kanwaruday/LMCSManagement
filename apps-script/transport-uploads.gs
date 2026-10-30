// ═══════════════════════════════════════════════════════════════════
// transport-uploads.gs -- 2026-10-21, per Uday: upload a renewed bus paper from the screen that shows it needs one.
// Same project as staff-management-api.gs (LMCS Employee Roster Proxy): it has Drive access and already verifies
// Fee Clerks. ONE action for both callers, so a paper lands and shows the same way whoever uploaded it:
//   the Coordinator Transport page (coordinator/transport/) and the Fee Clerk Portal's Transport screen (office/).
// Spec: docs/superpowers/specs/2026-10-21-transport-uploads-design.md
//
// POST {action:'transportupload', idToken, reg, paper, mimeType, base64, via}
//   paper: insurance | fitness | route_permit | mv_tax | pollution | speed_governor
//   The file goes to LMCS Repository/Important Documents @ LMCS/Important Documents Transport/Bus Wise Documents/<bus>/<year>/
//   named "<Paper> <REG> uploaded <DD-MM-YYYY>.<ext>", and one row is added to "Portal Uploads" in the transport sheet:
//   Uploaded On | Reg | Paper | File ID | Link | Uploaded By | Role | Campus | Via | Status
//   No expiry date is typed: the AI Coordinator's LM Studio pass reads it off the scan. Until then the Coordinator backend
//   (coordinator-transport.gs) shows the paper as "uploaded, waiting to be read". Status "Withdrawn" (typed in the sheet)
//   drops a row from that.
// Who: Owner or ALL any bus; a Coordinator the buses of their district (as the Coordinator page shows them);
// a FeeClerk their campus or comma list ("LMS1,LMS2").
// ═══════════════════════════════════════════════════════════════════

const TUP_SHEET_ID_ = '1VXTMZjqCS82ftB1rwoN4BzoiOTP7-Vg0m5vTH01Tfzc'; // transport form responses sheet, also COORD_TRANSPORT_FORM_ID
const TUP_FLEET_TAB_ = 'LM Studio Fleet';
const TUP_TAB_ = 'Portal Uploads';
const TUP_HEADER_ = ['Uploaded On', 'Reg', 'Paper', 'File ID', 'Link', 'Uploaded By', 'Role', 'Campus', 'Via', 'Status'];
const TUP_PAPERS_ = { insurance: 'Insurance', fitness: 'Fitness', route_permit: 'Route permit', mv_tax: 'MV tax', pollution: 'Pollution', speed_governor: 'Speed governor' };
const TUP_PATH_ = ['LMCS Repository', 'Important Documents @ LMCS', 'Important Documents Transport', 'Bus Wise Documents'];
const TUP_DISTRICTS_ = [['LMS1', 'LMS2', 'LMS3'], ['LMS4', 'LMS5', 'LMS6']]; // same split as COORD_DISTRICTS (Coordinator project)
const TUP_TZ_ = 'Asia/Kolkata';

function tupNormReg_(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

// The file's own leading bytes, not the type the browser claims: a ZIP renamed .pdf is refused. Bytes are signed in Apps Script.
function tupSniff_(bytes) {
  const b = function (i) { return bytes[i] & 0xFF; }, txt = function (i, n) { let s = ''; for (let k = i; k < i + n; k++) s += String.fromCharCode(b(k)); return s; };
  if (bytes.length < 12) return '';
  if (txt(0, 5) === '%PDF-') return 'application/pdf';
  if (b(0) === 0xFF && b(1) === 0xD8 && b(2) === 0xFF) return 'image/jpeg';
  if (b(0) === 0x89 && txt(1, 3) === 'PNG') return 'image/png';
  if (txt(0, 4) === 'RIFF' && txt(8, 4) === 'WEBP') return 'image/webp';
  if (txt(4, 4) === 'ftyp' && ['heic', 'heix', 'hevc', 'mif1', 'msf1'].indexOf(txt(8, 4)) !== -1) return 'image/heic';
  return '';
}

function tupCovers_(caller, campusId) {
  // ALL covers every school, except for a Principal who is not a manager (the school lock, 29 Oct: as verifyStaffManagerToken_)
  if ((caller.campusId === 'ALL' && (caller.manager || caller.roles.indexOf('Principal') === -1)) || caller.roles.indexOf('Owner') !== -1) return true;
  const own = caller.campusId.split(',').map(function (c) { return c.trim(); });
  if (own.indexOf(campusId) !== -1) return true;
  return caller.roles.indexOf('Coordinator') !== -1 && TUP_DISTRICTS_.some(function (d) {
    return d.indexOf(campusId) !== -1 && own.some(function (c) { return d.indexOf(c) !== -1; });
  });
}

function tupFileName_(paper, reg, date) {
  return TUP_PAPERS_[paper] + ' ' + reg + ' uploaded ' + Utilities.formatDate(date, TUP_TZ_, 'dd-MM-yyyy');
}

// {reg, campusId ('LMS4')} of a fleet vehicle, or null. The fleet tab is written by the AI Coordinator's push.
function tupVehicle_(reg) {
  const sh = SpreadsheetApp.openById(TUP_SHEET_ID_).getSheetByName(TUP_FLEET_TAB_);
  if (!sh) throw new Error('The fleet list is missing (tab "' + TUP_FLEET_TAB_ + '")');
  const row = sh.getDataRange().getValues().slice(1).filter(function (r) { return tupNormReg_(r[0]) === reg; })[0];
  return row ? { reg: reg, campusId: 'LMS' + String(row[2]).replace(/\D/g, '') } : null; // the roster says 'LMS-5' in one row
}

function tupFolder_(reg, date) {
  let f = DriveApp.getFolderById(CENTRAL_REPO_FOLDER_ID_);
  TUP_PATH_.forEach(function (n) {
    f = f && getSubfolder_(f, n);
  });
  if (!f) throw new Error('Bus Wise Documents folder not found');
  let bus = null;
  const it = f.getFolders();
  while (it.hasNext() && !bus) { const k = it.next(); if (tupNormReg_(k.getName()) === reg) bus = k; } // "HP66 5805" is HP665805
  bus = bus || f.createFolder(reg);
  const year = Utilities.formatDate(date, TUP_TZ_, 'yyyy');
  return getSubfolder_(bus, year) || bus.createFolder(year);
}

function tupUpload_(body) {
  const fail = function (m) { return { success: false, error: m }; };
  const caller = verifyStaffManagerToken_(body.idToken, ['FeeClerk']);
  if (!caller) return fail('Not authorized');
  const reg = tupNormReg_(body.reg), v = reg && tupVehicle_(reg);
  if (!v) return fail('Vehicle ' + (body.reg || '(none)') + ' is not in the fleet');
  if (!tupCovers_(caller, v.campusId)) return fail('You can only upload for buses of your own campuses');
  if (!TUP_PAPERS_[body.paper]) return fail('Unknown paper: ' + body.paper);
  const bytes = Utilities.base64Decode(String(body.base64 || ''));
  if (!bytes.length) return fail('Empty file');
  if (bytes.length > SDOC_MAX_BYTES_) return fail('File is larger than 10 MB');
  const mime = tupSniff_(bytes);
  if (!mime) return fail('Only PDF or photo files (JPG, PNG, HEIC, WEBP) are accepted');

  const now = new Date();
  const file = tupFolder_(reg, now).createFile(Utilities.newBlob(bytes, mime, tupFileName_(body.paper, reg, now) + '.' + SDOC_MIME_EXT_[mime]));
  const link = 'https://drive.google.com/file/d/' + file.getId() + '/view';
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.openById(TUP_SHEET_ID_);
    let sh = ss.getSheetByName(TUP_TAB_);
    if (!sh) {
      sh = ss.insertSheet(TUP_TAB_);
      sh.appendRow(TUP_HEADER_);
      sh.getRange(1, 1, 1, TUP_HEADER_.length).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    sh.appendRow([now, reg, body.paper, file.getId(), link, caller.email, caller.role, v.campusId, String(body.via || ''), '']);
  } finally {
    lock.releaseLock();
  }
  return { success: true, link: link, fileId: file.getId(), folder: reg + '/' + Utilities.formatDate(now, TUP_TZ_, 'yyyy') };
}
