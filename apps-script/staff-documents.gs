// ═══════════════════════════════════════════════════════════════════
// staff-documents.gs -- 2026-10-21, per Uday: staff documents as ONE TABLE, one row per file.
// Same project as staff-management-api.gs.
//
// The "Documents" tab of the response workbook (RESPONSE_WORKBOOK_ID_) holds every staff document:
//   Uploaded On | Employee Code | Employee Name | School | Document Type | Drive Link | Uploaded By | Source | ID Check
//   Source "Portal" -- uploaded from a "Missing" cell of the Staff Portal's Documents matrix
//     (staff/add-employee.html); these rows live only here and are never rebuilt.
//   Source "Form"   -- converted from the old LMS 1..6 tabs, where the six Google Forms still write (one
//     row per person, a column of links per type). Rebuilt from those tabs on every sync, so new form
//     submissions show up; the LMS n tabs themselves are never changed. Drop this half once the Clerk
//     Portal's forms replace the Google Forms.
//   Employee Code is the ROSTER code when the typed ID matches one (KUL/13/04/28 -> KUL/13/04/028);
//   otherwise ID Check says "Blank ID" or "Not on roster" and the code is left as typed.
// Synced: on every form submission (installable trigger, set up automatically on the first sync),
// and whenever Certificate Links is rebuilt (certificate-link-import.gs), which reads this table.
//
// Who may upload: Owner (any campus); Coordinator, or FeeClerk (the office role from the Fee Clerk
// portal), for their own campus -- a FeeClerk's campus column may be a comma list ("LMS1,LMS2") or ALL.
// The file itself goes where the Google Form puts it:
//   <campus>/Employee File - LMS n/LMS n Staff Document Submission form (File responses)/<type> (File responses)/
// ═══════════════════════════════════════════════════════════════════

const SDOC_MAX_BYTES_ = 10 * 1024 * 1024;
const SDOC_MIME_EXT_ = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/webp': 'webp' };
const SDOC_TABLE_TAB_ = 'Documents';
const SDOC_TABLE_HEADER_ = ['Uploaded On', 'Employee Code', 'Employee Name', 'School', 'Document Type', 'Drive Link', 'Uploaded By', 'Source', 'ID Check'];
const SDOC_COL_ = { at: 0, code: 1, name: 2, school: 3, type: 4, link: 5, by: 6, source: 7, check: 8 };

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

// Header of an LMS n tab -> canonical Document Type (STAFF_DOCUMENT_TYPES), '' if it isn't a document column.
function sdocTypeOfHeader_(header) {
  const h = sdocNorm_(header);
  const types = Object.keys(CERT_CATEGORY_KEYWORDS_);
  for (let i = 0; i < types.length; i++) {
    if (CERT_CATEGORY_KEYWORDS_[types[i]].some(function (k) { return h.indexOf(k) !== -1; })) return types[i];
  }
  return '';
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

// normalized code -> {code, name} for every EmpMaster row (any status -- a departed person's files are still theirs).
function sdocRosterCodes_() {
  const rows = openEmpWorkbook_().getSheetByName('EmpMaster').getDataRange().getValues();
  const iCode = rows[0].indexOf('EmployeeCode'), iName = rows[0].indexOf('Name');
  const map = {};
  for (let i = 1; i < rows.length; i++) {
    const code = String(rows[i][iCode] || '').trim();
    if (code) map[sdocNormCode_(code)] = { code: code, name: String(rows[i][iName] || '').trim() };
  }
  return map;
}

// One table row per file found in the LMS 1..6 form tabs.
function sdocFormRows_() {
  const roster = sdocRosterCodes_();
  const out = [];
  RESPONSE_CAMPUSES_.forEach(function (campus) {
    let grid;
    try { grid = openResponseSheet_(campus).getDataRange().getValues(); }
    catch (err) { console.log('sdocFormRows_: ' + campus + ' -- ' + err.message); return; }
    const h = grid[0].map(sdocNorm_);
    const iTs = h.indexOf('TIMESTAMP'), iEmail = h.indexOf('EMAIL ADDRESS'), iName = h.indexOf('EMPLOYEE NAME'), iId = h.indexOf('EMPLOYEE ID');
    const typeOf = grid[0].map(sdocTypeOfHeader_);
    const school = STAFF_CAMPUS_SHEET_LABEL_[campus];
    for (let r = 1; r < grid.length; r++) {
      const row = grid[r];
      const typed = String(row[iId] || '').trim();
      const match = typed ? roster[sdocNormCode_(typed)] : null;
      const code = match ? match.code : typed;
      const name = match ? match.name : String(row[iName] || '').trim();
      const check = !typed ? 'Blank ID' : (match ? '' : 'Not on roster');
      typeOf.forEach(function (type, c) {
        if (!type) return;
        (String(row[c] || '').match(/https?:\/\/[^\s,;]+/g) || []).forEach(function (link) {
          out.push([row[iTs], code, name, school, type, link, String(row[iEmail] || '').trim(), 'Form', check]);
        });
      });
    }
  });
  return out;
}

// Rebuilds the Form half of the Documents table, keeps every Portal row, returns all rows (no header).
// Callers hold the script lock.
function sdocSyncDocumentsTable_() {
  const wb = SpreadsheetApp.openById(RESPONSE_WORKBOOK_ID_);
  const sheet = wb.getSheetByName(SDOC_TABLE_TAB_) || wb.insertSheet(SDOC_TABLE_TAB_, 0);
  const n = SDOC_TABLE_HEADER_.length;
  const old = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, n).getValues() : [];
  const formRows = sdocFormRows_();
  const inForms = {};
  formRows.forEach(function (r) { const id = extractDriveFileId_(r[SDOC_COL_.link]); if (id) inForms[id] = true; });
  // Keep Portal uploads, and the "No form record" Drive files the upload check added (computeNewUploads_)
  // until a form row turns up for them.
  const rows = formRows.concat(old.filter(function (r) {
    return r[SDOC_COL_.source] === 'Portal' || (r[SDOC_COL_.source] === 'Drive' && !inForms[extractDriveFileId_(r[SDOC_COL_.link])]);
  }));
  const key = function (r) { return [r[SDOC_COL_.school], r[SDOC_COL_.name], r[SDOC_COL_.type]].join('|').toUpperCase(); };
  rows.sort(function (a, b) { return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0; });

  if (sheet.getFilter()) sheet.getFilter().remove();
  sheet.clearContents();
  sheet.getRange(1, 1, 1, n).setValues([SDOC_TABLE_HEADER_]).setFontWeight('bold');
  if (rows.length) sheet.getRange(2, 1, rows.length, n).setValues(rows);
  sheet.getRange(2, SDOC_COL_.at + 1, Math.max(rows.length, 1), 1).setNumberFormat('dd-mmm-yyyy hh:mm');
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, rows.length + 1, n).createFilter();
  sdocEnsureFormTrigger_();
  return rows;
}

// Installs, once, the trigger that re-syncs whenever any of the six Google Forms is submitted.
function sdocEnsureFormTrigger_() {
  try {
    const has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'sdocOnFormSubmit'; });
    if (!has) ScriptApp.newTrigger('sdocOnFormSubmit').forSpreadsheet(RESPONSE_WORKBOOK_ID_).onFormSubmit().create();
  } catch (err) {
    console.log('sdocEnsureFormTrigger_: ' + err.message); // the hourly rebuild still catches new submissions
  }
}

function sdocOnFormSubmit() {
  sdocMarkStale_();
  refreshCertificateLinksIfStale_();
}

// POST {action:'uploaddocument', idToken, employeeCode, documentType, mimeType, base64}
// documentType is one of STAFF_DOCUMENT_TYPES (the matrix columns); CERT_CATEGORY_KEYWORDS_
// (certificate-link-import.gs) says which Drive folder it belongs in.
function sdocUpload_(body) {
  const caller = verifyStaffManagerToken_(body.idToken, STAFF_LIMITED_ROLES_, true); // FeeClerk, Principal and HR & Hiring may upload too
  if (!caller) return { success: false, error: 'Not authorized' };
  const emp = sdocEmployee_(staffDocCaller_(caller), body.employeeCode);
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
    const wb = SpreadsheetApp.openById(RESPONSE_WORKBOOK_ID_);
    if (!wb.getSheetByName(SDOC_TABLE_TAB_)) sdocSyncDocumentsTable_(); // first ever upload: build the table first
    wb.getSheetByName(SDOC_TABLE_TAB_).appendRow([new Date(), emp.code, emp.name, emp.tab, body.documentType, link, caller.email, 'Portal', '']);
  } finally {
    lock.releaseLock();
  }
  sdocMarkStale_();
  return { success: true, link: link };
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

// Keeps "Certificate Links" (what the Staff Portal's Documents / Needs Verification tabs read) and the
// Documents table current: rebuilt when those tabs are opened and it's over an hour old, straight after
// a portal upload, and on every form submission. tryLock: two tabs loading at once rebuild it only once.
const SDOC_REFRESHED_AT_ = 'certlinks_refreshed_at_v4'; // bump the suffix to force a rebuild after a format change
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

// ── Which documents each designation must have (Uday, 2026-10-21) ──────────────────────────────
// Keyed by EmpSalary.Designation (normalized). R = required (shows Missing), N = not applicable
// (hidden); every other type is optional (uploadable, never counted missing). Hiring Slip is N/A
// for everyone. A designation not listed gets STAFF_DOC_RULES_[''] -- the core documents only.
const DT_ = {
  bio: 'BIODATA + PROFICIENCY', hs: 'HIRING SLIP', sc: 'SERVICE CONTRACT', sjr: 'SIGNED JOB ROLE', pan: 'PAN CARD',
  aad: 'AADHAAR CARD', chq: 'CANCELLED CHEQUE / BANK COPY', pol: 'POLICE VERIFICATION CHARACTER CERTIFICATE',
  med: 'MEDICAL CERTIFICATE', c10: 'CLASS 10 BOARD RESULT SHEET', c12: 'CLASS 12 BOARD RESULT SHEET',
  ba: 'BACHELORS CERTIFICATE', ma: 'MASTER CERTIFICATE', jbt: 'NTT / JBT CERTIFICATE',
  pd: 'Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)', hq: 'HIGHEST QUALIFICATION',
  tet: 'TET DOCUMENT', dl: 'DRIVING LICENCE',
};
const STAFF_DOC_RULES_ = (function () {
  const core = ['bio', 'sc', 'sjr', 'pan', 'aad', 'chq', 'pol', 'med'];
  const rule = function (req, na) {
    return { R: core.concat(req).map(function (k) { return DT_[k]; }), N: ['hs'].concat(na).map(function (k) { return DT_[k]; }) };
  };
  const teacherPrt = rule(['c10', 'c12', 'ba', 'pd', 'tet'], ['dl']);
  const senior = rule(['c10', 'c12', 'ba', 'ma', 'pd'], ['jbt', 'dl']);
  const artsy = rule(['c10', 'c12', 'hq'], ['jbt', 'tet', 'dl']);
  const support = rule([], ['c12', 'ba', 'ma', 'jbt', 'pd', 'hq', 'tet', 'dl']);
  return {
    'NTT': rule(['c10', 'c12', 'jbt', 'pd'], ['dl']),
    'PRT': teacherPrt,
    'PRT COORDINATOR': teacherPrt,
    'TGT': rule(['c10', 'c12', 'ba', 'pd', 'tet'], ['jbt', 'dl']),
    'PGT': senior,
    'VICE PRINCIPAL': senior,
    'HEAD MASTER/ PRINCIPAL': senior,
    'COMPUTER TEACHER': rule(['c10', 'c12', 'ba'], ['jbt', 'tet', 'dl']),
    'GAMES TEACHER (PTI)': rule(['c10', 'c12', 'ba', 'pd'], ['jbt', 'tet', 'dl']),
    'DRAWING TEACHER': artsy,
    'ACTIVITY TEACHER': artsy,
    'LIBRARIAN': rule(['c10', 'c12', 'ba'], ['jbt', 'tet', 'dl']),
    'CLERK + PRO': rule(['c10', 'c12', 'ba'], ['jbt', 'pd', 'tet', 'dl']),
    'DRIVER CUM PEON': rule(['c10', 'dl'], ['ba', 'ma', 'jbt', 'pd', 'hq', 'tet']),
    'TECHNICIAN': rule(['c10'], ['ba', 'ma', 'jbt', 'tet', 'dl']),
    'HELPER': support,
    'SWEEPER': support,
    'GARDENER': support,
    '': rule([], []),
  };
})();
// Same job, different wording in EmpSalary.
const STAFF_DOC_RULE_ALIASES_ = { 'ADMIN CLERK + PRO': 'CLERK + PRO', 'PTI (11, 12)': 'GAMES TEACHER (PTI)' };

// `rules` = staffDocRules_() (pass it in when resolving many people at once).
function staffDocRuleKey_(designation, rules) {
  const d = sdocNorm_(designation);
  const k = STAFF_DOC_RULE_ALIASES_[d] || d;
  return (rules || staffDocRules_())[k] ? k : '';
}

// ── Rules editor (Uday, 2026-10-21): the Owner edits the rules in the Staff Portal's "Document rules"
// tab; they're stored in a "Document Rules" tab of the response workbook (one row per designation,
// one column per document type, cells Required / Optional / N/A), so they can be read -- or edited --
// as a plain sheet too. No tab yet = STAFF_DOC_RULES_ above, which stay as the starting point.
const SDOC_RULES_TAB_ = 'Document Rules';
const SDOC_ANY_DESIGNATION_ = '(any other designation)';

function staffDocRules_() {
  return cachedStaff_('doc_rules', function () {
    const sheet = SpreadsheetApp.openById(RESPONSE_WORKBOOK_ID_).getSheetByName(SDOC_RULES_TAB_);
    if (!sheet || sheet.getLastRow() < 2) return STAFF_DOC_RULES_;
    const g = sheet.getDataRange().getValues();
    const types = g[0].slice(1).map(function (t) { return String(t).trim(); });
    const out = {};
    g.slice(1).forEach(function (r) {
      const label = String(r[0] || '').trim();
      if (!label) return;
      const rule = { R: [], N: [] };
      types.forEach(function (t, i) {
        const v = sdocNorm_(r[i + 1]);
        if (v === 'REQUIRED') rule.R.push(t); else if (v === 'N/A') rule.N.push(t);
      });
      out[label === SDOC_ANY_DESIGNATION_ ? '' : sdocNorm_(label)] = rule;
    });
    if (!out['']) out[''] = STAFF_DOC_RULES_[''];
    return out;
  });
}

// GET action=docrules -> what the editor needs: the document types (column order), the current rules,
// and every designation on the roster (aliases folded in) with how many people hold it.
function sdocRulesForEditor_() {
  const rules = staffDocRules_();
  const salary = readEmpSalaryByCode_();
  const seen = {};
  Object.keys(salary).forEach(function (code) {
    const s = salary[code];
    if (!s.designation || STAFF_HIDDEN_DEPARTMENTS.indexOf(s.department) !== -1) return;
    const d = sdocNorm_(s.designation);
    const key = STAFF_DOC_RULE_ALIASES_[d] || d;
    if (key === 'N/A') return; // a blank-ish designation; covered by "(any other designation)"
    seen[key] = seen[key] || { key: key, label: s.designation.trim(), count: 0 };
    seen[key].count++;
  });
  Object.keys(rules).forEach(function (k) { if (k && !seen[k]) seen[k] = { key: k, label: k, count: 0 }; });
  const designations = Object.keys(seen).map(function (k) { return seen[k]; })
    .sort(function (a, b) { return b.count - a.count || a.label.localeCompare(b.label); });
  designations.push({ key: '', label: SDOC_ANY_DESIGNATION_, count: 0 });
  return { types: STAFF_DOCUMENT_TYPES, rules: rules, designations: designations };
}

// data: {rules: {designationKey: "RON..." -- one letter per STAFF_DOCUMENT_TYPES entry, in order},
//        labels: {designationKey: label shown in the sheet}}. Owner only.
function sdocSaveRules_(data, caller) {
  if (caller.roles.indexOf('Owner') === -1) throw new Error('Only the Owner can change document rules');
  const word = { R: 'Required', O: 'Optional', N: 'N/A' };
  const rows = Object.keys(data.rules || {}).map(function (key) {
    const code = String(data.rules[key]);
    if (code.length !== STAFF_DOCUMENT_TYPES.length || /[^RON]/.test(code)) throw new Error('Bad rule for ' + (key || 'any other designation'));
    const label = key ? String((data.labels || {})[key] || key) : SDOC_ANY_DESIGNATION_;
    return [label].concat(code.split('').map(function (c) { return word[c]; }));
  });
  if (!rows.length) throw new Error('No rules sent');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const wb = SpreadsheetApp.openById(RESPONSE_WORKBOOK_ID_);
    const sheet = wb.getSheetByName(SDOC_RULES_TAB_) || wb.insertSheet(SDOC_RULES_TAB_);
    sheet.clearContents();
    sheet.getRange(1, 1, 1, STAFF_DOCUMENT_TYPES.length + 1).setValues([['Designation'].concat(STAFF_DOCUMENT_TYPES)]).setFontWeight('bold');
    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
    sheet.setFrozenRows(1);
    sheet.setFrozenColumns(1);
  } finally {
    lock.releaseLock();
  }
  CacheService.getScriptCache().remove('doc_rules');
  bustStaffListCache_(); // cached Documents rows carry their resolved rule key
  return { saved: rows.length };
}
