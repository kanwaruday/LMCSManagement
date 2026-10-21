// LMCS Office Backend -- Files: private Drive upload and audited view. Script Property OFFICE_DRIVE_ROOT
// is the root folder id. Files stay owned by the script owner and are never shared: no sharing call is
// made anywhere; the only way to read one is file.view, which writes an Audit row.

var OFFICE_FILE_MAX_BYTES = 3 * 1024 * 1024; // chunked upload for larger PDFs is deferred
var OFFICE_FILE_MIMES = ['image/jpeg', 'image/png', 'application/pdf'];
// Leading bytes (unsigned) each allowed type must start with: the declared mime is never trusted alone.
var OFFICE_FILE_MAGIC = { 'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2D], 'image/jpeg': [0xFF, 0xD8, 0xFF], 'image/png': [0x89, 0x50, 0x4E, 0x47] };
var OFFICE_FILE_CATEGORIES = ['deposit_proof', 'bill', 'document'];

function officeFilesActions_() {
  return {
    'file.upload': { roles: ['FeeClerk', 'AdminManager', 'FinanceHead', 'Owner'], write: true, run: officeFileUpload_ },
    'file.view': { roles: OFFICE_ALL_ROLES, write: true, run: officeFileView_ }, // write: the audit row needs the lock
  };
}

// Find-or-create a child folder by name.
function officeFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function officeFileUpload_(ctx, data) {
  if (!data.id) throw new Error('MISSING_ID');
  if (OFFICE_FILE_CATEGORIES.indexOf(data.category) === -1) throw new Error('BAD_CATEGORY');
  if (OFFICE_FILE_MIMES.indexOf(data.mime) === -1) throw new Error('BAD_MIME');
  let bytes;
  try { bytes = Utilities.base64Decode(String(data.base64 || '')); } catch (err) { throw new Error('BAD_FILE'); }
  if (!bytes || !bytes.length) throw new Error('BAD_FILE');
  if (!OFFICE_FILE_MAGIC[data.mime].every(function (m, i) { return (bytes[i] + 256) % 256 === m; })) throw new Error('BAD_MIME');
  if (bytes.length > OFFICE_FILE_MAX_BYTES) throw new Error('TOO_LARGE');
  const fy = officeFy_(officeToday_());
  const ss = officeOpen_(data.campus, fy);
  const rows = officeRows_(ss, 'Files');
  if (rows.some(function (r) { return r.id === String(data.id); })) return { id: String(data.id), duplicate: true }; // retry of the same request
  const name = String(data.name || 'file').replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 100);
  const fingerprint = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)
    .map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join('');
  const same = rows.filter(function (r) { return r.fingerprint === fingerprint; })[0];
  let driveId;
  if (same) driveId = same.drive_id; // same bytes already stored: point at that Drive file, create nothing
  else {
    let folder = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('OFFICE_DRIVE_ROOT'));
    [data.campus, fy, data.category].forEach(function (n) { folder = officeFolder_(folder, n); });
    driveId = folder.createFile(Utilities.newBlob(bytes, data.mime, data.id + '-' + name)).getId();
  }
  const res = officeAppend_(ss, 'Files', {
    id: data.id, campus: data.campus, drive_id: driveId, name: name, size: bytes.length, fingerprint: fingerprint,
    category: data.category, belongs_to: data.belongs_to || '',
  }, ctx.caller, { action: 'file.upload' });
  return same ? { id: res.id, duplicateOf: same.id } : { id: res.id };
}

function officeFileView_(ctx, data) {
  if (!data.id) throw new Error('MISSING_ID');
  if (!data.campus) throw new Error('BAD_CAMPUS');
  const fy = officeFy_(officeToday_());
  const prevStart = Number(fy.slice(0, 4)) - 1;
  const prevFy = prevStart + '-' + String((prevStart + 1) % 100).padStart(2, '0'); // year-end lookups, as daybook.reverse (R15)
  const ss = officeOpen_(data.campus, fy);
  const pick = function (book) { return officeRows_(book, 'Files').filter(function (r) { return r.id === String(data.id) && r.campus === data.campus; })[0]; };
  let row = pick(ss);
  if (!row && PropertiesService.getScriptProperties().getProperty('OFFICE_SS_' + data.campus + '_' + prevFy)) row = pick(officeOpen_(data.campus, prevFy));
  if (!row) throw new Error('NOT_FOUND');
  const blob = DriveApp.getFileById(row.drive_id).getBlob();
  officeAuditWrite_(ss, ctx.caller, 'file.view', row.id, data.campus, { name: row.name });
  return { name: row.name, mime: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) };
}
