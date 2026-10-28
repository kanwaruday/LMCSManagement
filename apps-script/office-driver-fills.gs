// LMCS Office Backend -- a driver's confirmed fuel fill becomes the Day Book fuel entry (2026-10-28, per Uday).
// The driver phone stores the fill in 'Driver Fills' of the transport workbook (driver-fuel.gs, Roster); the Fee Clerk confirms it
// there (driver-fill-confirm.gs). This backend owns the Day Book, so it makes the entry: it reads the confirmed row from the same
// workbook the fuel mirror writes (OFFICE_FUEL_MIRROR_SS), copies the bill and the pump video into the Office store as Files rows
// (bill / fuel_video, so file.view, the fuel check and the 90-day video pruning treat them like a clerk's own upload), then runs the
// ordinary daybook.add with them: every Day Book rule (account, vehicle, odometer, closed day) applies unchanged. The entry id is
// written back into the row's 'Day Book Entry ID'.
// One entry per fill: the entry id is 'dfl-<fillId>' and daybook.add treats a known id as a retry, so a second call writes nothing.
// OFF until after the 31 Oct count: Script Property OFFICE_DRIVER_FILLS_TO_DAYBOOK must be 'on'. Otherwise the action refuses
// (code DRIVER_FILLS_OFF) before it reads or writes anything.
//
// driverfill.daybook {campus, fill_id, account, bucket?} -> {id, duplicate}. account/bucket: the money account it was paid from
// (a pump's credit account, or campus cash with its bucket), as daybook.add takes them.

var OFFICE_DFL_TAB = 'Driver Fills';

function officeDriverFillsActions_() {
  return {
    'driverfill.daybook': { roles: ['FeeClerk', 'AdminManager', 'FinanceHead', 'Owner'], write: true, run: officeDriverFillDaybook_ },
  };
}

function officeDriverFillsOn_() { return PropertiesService.getScriptProperties().getProperty('OFFICE_DRIVER_FILLS_TO_DAYBOOK') === 'on'; }

function officeDriverFillDaybook_(ctx, data) {
  if (!officeDriverFillsOn_()) {
    const off = new Error('Confirmed fills go into the Day Book after the 31 Oct count. Until then this is off and nothing was written.');
    off.code = 'DRIVER_FILLS_OFF';
    throw off;
  }
  // the clerk names the account the fuel was paid from: daybook.add would turn a blank one into the campus bank, and money never
  // goes to a default
  if (!String(data.account || '').trim()) throw new Error('BAD_ACCOUNT');
  const fillId = String(data.fill_id || '');
  if (!/^[A-Za-z][A-Za-z0-9_-]{7,63}$/.test(fillId)) throw new Error('MISSING_ID'); // driver-fuel.gs's fillId rule
  const sh = SpreadsheetApp.openById(OFFICE_FUEL_MIRROR_SS).getSheetByName(OFFICE_DFL_TAB);
  const v = sh ? sh.getDataRange().getValues() : [[]], head = v[0].map(String), col = function (n) { return head.indexOf(n); };
  const at = v.findIndex(function (r, i) { return i > 0 && String(r[col('Fill ID')]) === fillId; });
  if (at < 1) throw new Error('NOT_FOUND');
  const r = v[at], cell = function (n) { return r[col(n)]; };
  if (String(cell('Campus')) !== data.campus) throw new Error('NOT_FOUND'); // another campus's fill: as if absent
  if (String(cell('Status')) !== 'confirmed') throw officeCoded_('NOT_CONFIRMED');
  if (String(cell('Day Book Entry ID') || '')) return { id: String(cell('Day Book Entry ID')), duplicate: true };

  const id = 'dfl-' + fillId, when = cell('Filled At') instanceof Date ? cell('Filled At') : cell('Received');
  if (!(when instanceof Date) || !isFinite(when.getTime())) throw new Error('BAD_DATE');
  const entryDate = Utilities.formatDate(when, 'Asia/Kolkata', 'yyyy-MM-dd'), name = String(cell('Driver Name'));
  const fileId = officeDriverFillFile_(ctx, data.campus, id + '-bill', String(cell('Bill File ID')), 'bill', 'fuel-bill');
  const videoId = officeDriverFillFile_(ctx, data.campus, id + '-video', String(cell('Video File ID')), 'fuel_video', 'fuel-video');
  const res = officeDaybookAdd_(ctx, {
    id: id, campus: data.campus, entry_date: entryDate, direction: 'OUT', category: 'fuel', account: data.account, mode: '', bucket: data.bucket || '',
    amount_paise: Math.round(Number(cell('Amount')) * 100), litres_ml: Math.round(Number(cell('Litres')) * 1000), odometer_km: Number(cell('Odometer')),
    vehicle: String(cell('Reg')), file_id: fileId, video_file_id: videoId, payee: '', narration: 'Driver fill ' + fillId + (name ? ' (' + name + ')' : ''),
  });
  sh.getRange(at + 1, col('Day Book Entry ID') + 1).setValue(res.id); // 'dfl-...': starts with a letter, never a formula
  return res;
}

// The Files row id of a driver fill's bill or video in this campus's book: an earlier try's row, else a server-side copy of the
// Roster's Drive file into the Office store (OFFICE_DRIVE_ROOT/<campus>/<fy>/<category>, as file.upload files it), so the Office
// owns what it later shows and prunes. The same bytes already stored are pointed at, not copied again (file.upload's rule).
function officeDriverFillFile_(ctx, campus, id, driveId, category, name) {
  const books = officeRecentBooks_(campus), ss = books[0];
  if (books.some(function (b) { return officeRows_(b, 'Files').some(function (f) { return f.id === id; }); })) return id;
  if (!driveId) throw officeCoded_(category === 'bill' ? 'FILE_MISSING' : 'VIDEO_MISSING');
  const blob = DriveApp.getFileById(driveId).getBlob(), bytes = blob.getBytes();
  const fingerprint = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)
    .map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join('');
  const same = officeRows_(ss, 'Files').filter(function (r) { return r.fingerprint === fingerprint; })[0];
  let copy = same && same.drive_id;
  if (!copy) {
    let folder = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('OFFICE_DRIVE_ROOT'));
    [campus, officeFy_(officeToday_()), category].forEach(function (n) { folder = officeFolder_(folder, n); });
    copy = folder.createFile(Utilities.newBlob(bytes, blob.getContentType(), id + '-' + name)).getId();
  }
  officeAppend_(ss, 'Files', { id: id, campus: campus, drive_id: copy, name: name, size: bytes.length, fingerprint: fingerprint,
    category: category, belongs_to: '' }, ctx.caller, { action: 'driverfill.daybook' });
  return id;
}
