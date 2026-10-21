// ═══════════════════════════════════════════════════════════════════
// staff-documents.gs -- 2026-10-21, per Uday: portal form (staff/documents.html) for staff document
// uploads, replacing the Google Form's data entry. Same project as staff-management-api.gs.
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

const SDOC_TYPES_ = [
  { key: 'biodata', label: 'Biodata + Proficiency', match: ['BIODATA'] },
  { key: 'hiringslip', label: 'Hiring Slip', match: ['HIRING SLIP'] },
  { key: 'class10', label: 'Class 10 Board Result Sheet', match: ['CLASS 10'] },
  { key: 'class12', label: 'Class 12 Board Result Sheet', match: ['CLASS 12'] },
  { key: 'bachelors', label: 'Bachelors Certificate', match: ['BACHELOR'] },
  { key: 'masters', label: 'Master Certificate', match: ['MASTER CERTI'] },
  { key: 'professional', label: 'Professional Degree (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical)', match: ['PROFESSIONAL DEGREE'] },
  { key: 'highest', label: 'Highest Qualification', match: ['HIGHEST QUALIFICATION'] },
  { key: 'tetdoc', label: 'TET Document', match: ['TET DOCUMENT'] },
  { key: 'experience', label: 'Experience Certificate', match: ['EXPERIENCE CERTIFICATE'] },
  { key: 'lastsalary', label: 'Last Salary Drawn Certificate', match: ['LAST SALARY'] },
  { key: 'contract', label: 'Service Contract', match: ['SERVICE CONTRACT'] },
  { key: 'jobrole', label: 'Signed Job Role', match: ['SIGNED JOB ROLE'] },
  { key: 'pan', label: 'PAN Card', match: ['PAN CARD'] },
  { key: 'aadhaar', label: 'Aadhaar Card', match: ['AADHAR'] },
  { key: 'cheque', label: 'Cancelled Cheque / Bank Copy', match: ['CHEQUE'] },
  { key: 'police', label: 'Police Verification / Character Certificate', match: ['POLICE VERIFICATION'] },
  { key: 'medical', label: 'Medical Certificate', match: ['MEDICAL CERTIFICATE'] },
  { key: 'licence', label: 'Driving Licence', match: ['DRIVING LICEN'] },
];
const SDOC_TEXT_FIELDS_ = { tetQualified: ['TET QUALIFIED'], remarks: ['REMARKS'] };
const SDOC_MAX_BYTES_ = 10 * 1024 * 1024;
const SDOC_MIME_EXT_ = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/webp': 'webp' };

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
  const allowed = caller.campusId === 'ALL' || caller.campusId.split(',').map(function (c) { return c.trim(); }).indexOf(campus) !== -1;
  if (!allowed) throw new Error('You can only upload documents for your own school');
  const tab = STAFF_CAMPUS_SHEET_LABEL_[campus];
  if (!tab || RESPONSE_CAMPUSES_.indexOf(campus) === -1) throw new Error('No document sheet for campus ' + campus);
  return { code: String(emp.EmployeeCode).trim(), name: String(emp.Name || '').trim(), campus: campus, tab: tab };
}

// GET action=docentry&employeeCode=... -> what's already on file for that employee, per document type.
function sdocStatus_(caller, code) {
  const emp = sdocEmployee_(caller, code);
  const values = openResponseSheet_(emp.campus).getDataRange().getValues();
  const header = values[0];
  const idCol = sdocCols_(header, ['EMPLOYEE ID'])[0];
  const want = sdocNormCode_(emp.code);
  const rows = values.slice(1).filter(function (r) { return sdocNormCode_(r[idCol]) === want; });

  const docs = {};
  SDOC_TYPES_.forEach(function (t) {
    const links = [];
    sdocCols_(header, t.match).forEach(function (c) {
      rows.forEach(function (r) {
        String(r[c] || '').split(',').forEach(function (l) { l = l.trim(); if (/^https?:\/\//.test(l)) links.push(l); });
      });
    });
    docs[t.key] = links;
  });
  const text = {};
  Object.keys(SDOC_TEXT_FIELDS_).forEach(function (k) {
    const cols = sdocCols_(header, SDOC_TEXT_FIELDS_[k]);
    text[k] = '';
    rows.forEach(function (r) { cols.forEach(function (c) { if (String(r[c] || '').trim()) text[k] = String(r[c]).trim(); }); });
  });
  return {
    employee: { code: emp.code, name: emp.name, campus: emp.campus },
    types: SDOC_TYPES_.map(function (t) { return { key: t.key, label: t.label }; }),
    docs: docs, tetQualified: text.tetQualified, remarks: text.remarks, responseRows: rows.length,
  };
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

function sdocTypeFolder_(formRoot, type) {
  const subs = formRoot.getFolders();
  while (subs.hasNext()) {
    const f = subs.next();
    const n = sdocNorm_(f.getName());
    if (type.match.some(function (k) { return n.indexOf(k) !== -1; })) return f;
  }
  return formRoot.createFolder(type.label.toUpperCase() + ' (File responses)');
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

// POST {action:'uploaddocument', idToken, employeeCode, typeKey, fileName, mimeType, base64}
//   or {action:'uploaddocument', idToken, employeeCode, tetQualified?, remarks?} for the two text answers.
function sdocUpload_(body) {
  const caller = verifyStaffManagerToken_(body.idToken, ['FeeClerk']);
  if (!caller) return { success: false, error: 'Not authorized' };
  const emp = sdocEmployee_(caller, body.employeeCode);

  let file = null, type = null;
  if (body.typeKey) {
    type = SDOC_TYPES_.filter(function (t) { return t.key === body.typeKey; })[0];
    if (!type) throw new Error('Unknown document type: ' + body.typeKey);
    const ext = SDOC_MIME_EXT_[body.mimeType];
    if (!ext) throw new Error('Only PDF or photo files (JPG, PNG, HEIC, WEBP) are accepted');
    const bytes = Utilities.base64Decode(String(body.base64 || ''));
    if (!bytes.length) throw new Error('Empty file');
    if (bytes.length > SDOC_MAX_BYTES_) throw new Error('File is larger than 10 MB');
    const name = type.label + ' - ' + emp.name + ' (' + emp.code.replace(/\//g, '-') + ').' + ext;
    file = sdocTypeFolder_(sdocFormFolder_(emp.campus), type).createFile(Utilities.newBlob(bytes, body.mimeType, name));
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = openResponseSheet_(emp.campus);
    const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const rowNum = sdocRow_(sheet, header, emp, caller.email);
    const setFirst = function (keywords, value, append) {
      const col = sdocCols_(header, keywords)[0];
      if (col === undefined) throw new Error('No column for ' + keywords[0] + ' on tab ' + emp.tab);
      const cell = sheet.getRange(rowNum, col + 1);
      const old = String(cell.getValue() || '').trim();
      cell.setValue(append && old ? old + ', ' + value : value);
    };
    let link = '';
    if (file) {
      link = 'https://drive.google.com/open?id=' + file.getId();
      setFirst(type.match, link, true);
      sdocMarkStale_();
    }
    if (body.tetQualified !== undefined) setFirst(SDOC_TEXT_FIELDS_.tetQualified, String(body.tetQualified), false);
    if (body.remarks !== undefined) setFirst(SDOC_TEXT_FIELDS_.remarks, String(body.remarks), false);
    return { success: true, link: link };
  } finally {
    lock.releaseLock();
  }
}

function sdocStatusAction_(e) {
  try {
    const caller = verifyStaffManagerToken_(e.parameter.idToken, ['FeeClerk']);
    if (!caller) return { success: false, error: 'Not authorized' };
    return Object.assign({ success: true }, sdocStatus_(caller, e.parameter.employeeCode));
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Keeps the "Certificate Links" tab (what the Staff Portal's Documents / Needs Verification tabs read)
// current with no trigger to install: rebuilt when those tabs are opened and it's over an hour old,
// or straight away after an upload here. tryLock: two tabs loading at once rebuild it only once.
const SDOC_REFRESHED_AT_ = 'certlinks_refreshed_at';
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
