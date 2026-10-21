// ═══════════════════════════════════════════════════════════════════
// staff-documents.gs -- 2026-10-21, per Uday: upload a staff document straight from a "Missing" cell
// of the Staff Portal's Documents matrix (staff/add-employee.html), replacing the Google Form's data
// entry. Same project as staff-management-api.gs.
//
// Why: the Google Form made people TYPE the Employee ID -- 17 blank IDs and 13 that match nobody
// (KUL/13/04/28 vs the real KUL/13/04/028, "krel/", serial 104 used three times), and its document
// questions were duplicated by a later revision. Here the employee is picked from the roster and
// every document type is asked once.
//
// Who: Owner (any campus); Coordinator, or FeeClerk (the office role from the Fee Clerk portal), for their own
// campus -- a FeeClerk's campus column may be a comma list ("LMS1,LMS2") or ALL.
// Where it writes -- the SAME places the Google Form does, so Certificate Links refresh, auto-resolve
// and the upload-status banner keep working unchanged:
//   file -> <campus>/Employee File - LMS n/LMS n Staff Document Submission form (File responses)/<type> (File responses)/
//   link -> that employee's row on the campus tab ("LMS n") of the response workbook (RESPONSE_WORKBOOK_ID_),
//           first column whose header matches the type; an existing link is kept, the new one appended ", ".
// ═══════════════════════════════════════════════════════════════════

const SDOC_MAX_BYTES_ = 10 * 1024 * 1024;
const SDOC_MIME_EXT_ = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/webp': 'webp' };

// campusId is ALL, one campus, or (FeeClerk) a comma list like "LMS1,LMS2".
function callerCovers_(caller, campus) {
  return caller.campusId === 'ALL' || caller.campusId.split(',').map(function (c) { return c.trim(); }).indexOf(campus) !== -1;
}

function sdocNorm_(s) { return String(s || '').toUpperCase().replace(/\s+/g, ' ').trim(); }

// KUL/13/04/28 and kul/13/04/028 are the same person -- the roster pads the last part to 3 digits.
function sdocNormCode_(c) {
  const p = String(c || '').toUpperCase().replace(/\s+/g, '').split('/');
  if (p.length === 4 && /^\d+$/.test(p[3])) p[3] = ('000' + p[3]).slice(-Math.max(3, p[3].length));
  return p.join('/');
}

function sdocCols_(header, keywords) {
  const out = [];
  header.forEach(function (h, i) {
    const n = sdocNorm_(h);
    if (keywords.some(function (k) { return n.indexOf(k) !== -1; })) out.push(i);
  });
  return out;
}

// Employee must be a real roster row the caller may act on; returns {code, name, campus ("LMS1"), tab ("LMS 1")}.
function sdocEmployee_(caller, code) {
  const emp = readRowByCode_(openEmpWorkbook_(), 'EmpMaster', String(code || '').trim());
  if (!emp) throw new Error('Employee not found: ' + code);
  const campus = String(emp.SchoolCode || '').trim().toUpperCase();
  if (!callerCovers_(caller, campus)) throw new Error('You can only upload documents for your own school');
  const tab = STAFF_CAMPUS_SHEET_LABEL_[campus];
  if (!tab || RESPONSE_CAMPUSES_.indexOf(campus) === -1) throw new Error('No document sheet for campus ' + campus);
  return { code: String(emp.EmployeeCode).trim(), name: String(emp.Name || '').trim(), campus: campus, tab: tab };
}

function sdocFormFolder_(campus) {
  const school = STAFF_CAMPUS_SHEET_LABEL_[campus];
  const root = DriveApp.getFolderById(CENTRAL_REPO_FOLDER_ID_);
  const campusFolder = getSubfolder_(root, SCHOOL_TO_CAMPUS_DIR_[school]);
  const empFile = campusFolder && getSubfolder_(campusFolder, 'Employee File - ' + school);
  const formRoot = empFile && getSubfolder_(empFile, school + ' Staff Document Submission form (File responses)');
  if (!formRoot) throw new Error('Upload folder not found for ' + school);
  return formRoot;
}

function sdocTypeFolder_(formRoot, docType, keywords) {
  const subs = formRoot.getFolders();
  while (subs.hasNext()) {
    const f = subs.next();
    const n = sdocNorm_(f.getName());
    if (keywords.some(function (k) { return n.indexOf(k) !== -1; })) return f;
  }
  return formRoot.createFolder(docType + ' (File responses)');
}

// The employee's newest row on the campus tab; appends one (Timestamp, Email, Name, ID) if they have none.
function sdocRow_(sheet, header, emp, callerEmail) {
  const values = sheet.getDataRange().getValues();
  const idCol = sdocCols_(header, ['EMPLOYEE ID'])[0];
  const want = sdocNormCode_(emp.code);
  for (let i = values.length - 1; i >= 1; i--) {
    if (sdocNormCode_(values[i][idCol]) === want) return i + 1;
  }
  const row = new Array(header.length).fill('');
  row[sdocCols_(header, ['TIMESTAMP'])[0]] = new Date();
  row[sdocCols_(header, ['EMAIL'])[0]] = callerEmail;
  row[sdocCols_(header, ['EMPLOYEE NAME'])[0]] = emp.name;
  row[idCol] = emp.code;
  sheet.appendRow(row);
  return sheet.getLastRow();
}

// POST {action:'uploaddocument', idToken, employeeCode, documentType, mimeType, base64}
// documentType is one of STAFF_DOCUMENT_TYPES (the matrix columns); CERT_CATEGORY_KEYWORDS_
// (certificate-link-import.gs) says which response-sheet column and Drive folder it belongs to.
function sdocUpload_(body) {
  const caller = verifyStaffManagerToken_(body.idToken, ['FeeClerk']);
  if (!caller) return { success: false, error: 'Not authorized' };
  const emp = sdocEmployee_(caller, body.employeeCode);
  const keywords = CERT_CATEGORY_KEYWORDS_[body.documentType];
  if (!keywords) throw new Error('Unknown document type: ' + body.documentType);
  const ext = SDOC_MIME_EXT_[body.mimeType];
  if (!ext) throw new Error('Only PDF or photo files (JPG, PNG, HEIC, WEBP) are accepted');
  const bytes = Utilities.base64Decode(String(body.base64 || ''));
  if (!bytes.length) throw new Error('Empty file');
  if (bytes.length > SDOC_MAX_BYTES_) throw new Error('File is larger than 10 MB');
  const name = body.documentType + ' - ' + emp.name + ' (' + emp.code.replace(/\//g, '-') + ').' + ext;
  const file = sdocTypeFolder_(sdocFormFolder_(emp.campus), body.documentType, keywords)
    .createFile(Utilities.newBlob(bytes, body.mimeType, name));
  const link = 'https://drive.google.com/open?id=' + file.getId();

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = openResponseSheet_(emp.campus);
    const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const col = sdocCols_(header, keywords)[0];
    if (col === undefined) throw new Error('No column for ' + body.documentType + ' on tab ' + emp.tab);
    const cell = sheet.getRange(sdocRow_(sheet, header, emp, caller.email), col + 1);
    const old = String(cell.getValue() || '').trim();
    cell.setValue(old ? old + ', ' + link : link);
  } finally {
    lock.releaseLock();
  }
  sdocMarkStale_();
  return { success: true, link: link };
}

// Keeps the "Certificate Links" tab (what the Staff Portal's Documents / Needs Verification tabs read)
// current with no trigger to install: rebuilt when those tabs are opened and it's over an hour old,
// or straight away after an upload here. tryLock: two tabs loading at once rebuild it only once.
const SDOC_REFRESHED_AT_ = 'certlinks_refreshed_at_v2'; // bump the suffix to force a rebuild after the document types change
const SDOC_MAX_AGE_MS_ = 60 * 60 * 1000;

function sdocMarkStale_() { PropertiesService.getScriptProperties().deleteProperty(SDOC_REFRESHED_AT_); }

function refreshCertificateLinksIfStale_() {
  const props = PropertiesService.getScriptProperties();
  if (Date.now() - Number(props.getProperty(SDOC_REFRESHED_AT_) || 0) < SDOC_MAX_AGE_MS_) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    refreshCertificateLinksFromResponseSheets();
    bustStaffListCache_(); // Documents / Needs Verification answers are cached per campus
    props.setProperty(SDOC_REFRESHED_AT_, String(Date.now()));
  } finally {
    lock.releaseLock();
  }
}
