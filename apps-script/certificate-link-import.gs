// ═══════════════════════════════════════════════════════════════════
// Employee Certificate Links -- the "Certificate Links" tab of the Employee Master workbook, rebuilt from the
// one-row-per-file Documents table by refreshCertificateLinksFromResponseSheets() below (run automatically:
// refreshCertificateLinksIfStale_ in staff-documents.gs). Only ever clears and rewrites that one tab.
// 2026-10-24: the 184 KB embedded CERT_LINKS_DATA snapshot and its importCertificateLinks() fallback were removed --
// unused since the live refresh, and parsed on every request to this project (git history still has them).
// ═══════════════════════════════════════════════════════════════════

const CERT_LINKS_TAB = 'Certificate Links';

// Document type -> keywords matched against form-column headers and upload-folder names (staff-documents.gs uses it
// too). drive-index/build_employee_cert_links.py keeps its own copy -- keep both in sync if a type is added/renamed.
const CERT_CATEGORY_KEYWORDS_ = {
  'BACHELORS CERTIFICATE': ['BACHELOR'],
  'CLASS 10 BOARD RESULT SHEET': ['CLASS 10'],
  'CLASS 12 BOARD RESULT SHEET': ['CLASS 12'],
  'MASTER CERTIFICATE': ['MASTER CERTI'],
  'MEDICAL CERTIFICATE': ['MEDICAL CERTIFICATE'],
  'POLICE VERIFICATION CHARACTER CERTIFICATE': ['POLICE VERIFICATION', 'CHARACTER CERTIFICATE'],
  'Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)': ['PROFESSIONAL DEGREE'],
  'HIGHEST QUALIFICATION': ['HIGHEST QUALIFICATION'],
  // ID / employment documents, added 2026-10-21 per Uday (Documents matrix shows all 19).
  'BIODATA + PROFICIENCY': ['BIODATA'],
  'HIRING SLIP': ['HIRING SLIP'],
  'SERVICE CONTRACT': ['SERVICE CONTRACT'],
  'SIGNED JOB ROLE': ['SIGNED JOB ROLE'],
  'TET DOCUMENT': ['TET DOCUMENT'],
  'EXPERIENCE CERTIFICATE': ['EXPERIENCE CERTIFICATE'],
  'LAST SALARY DRAWN CERTIFICATE': ['LAST SALARY'],
  'PAN CARD': ['PAN CARD'],
  'AADHAAR CARD': ['AADHAR', 'AADHAAR'],
  'CANCELLED CHEQUE / BANK COPY': ['CHEQUE'],
  'DRIVING LICENCE': ['DRIVING LICEN'],
  'NTT / JBT CERTIFICATE': ['NTT / JBT', 'JBT CERTIFICATE'], // portal-only: no Google Form column asks for it
};

// Employee Code -> a known data-quality problem with that person's row,
// found 2026-09-24 cross-checking filenames against the sheet's own
// Employee Name/ID columns (drive-index/drive-index-todo.md has the
// detail). Forced into the Needs Verification queue below regardless of
// what the sheet says -- the sheet itself is what's in question here,
// not something the matching logic can catch on its own.
const CERT_MANUAL_FLAGS_ = {
  'KUL/23/04/082': 'Every filename on this row says "Shailly/Shaily/Shelly" but the sheet keys the row to Neerja Prashar -- likely Jai Chand picked the wrong row while submitting on her behalf. Confirm the real owner before trusting.',
};

function refreshCertificateLinksFromResponseSheets() {
  // Built from the one-row-per-file Documents table (staff-documents.gs), which this also re-syncs.
  // Files whose typed Employee ID is blank or not on the roster are left out: they'd flood Needs
  // Verification one file at a time. They stay in the Documents table (filter "ID Check") to fix per person.
  const C = SDOC_COL_;
  const rows = sdocSyncDocumentsTable_().filter(function (r) { return !r[C.check]; }).map(function (r) {
    const code = String(r[C.code] || '').trim(), name = String(r[C.name] || '').trim();
    const flag = CERT_MANUAL_FLAGS_[sdocNormCode_(code)];
    const status = flag ? 'Ambiguous -- manually flagged: ' + flag
      : r[C.source] === 'Portal' ? 'Uploaded via Staff Portal by ' + r[C.by]
      : 'Matched (from Response sheet)';
    return [code, name, r[C.school], r[C.type], r[C.type] + ' (' + name + ')', r[C.link], status];
  });

  const ss = SpreadsheetApp.openById(STAFF_EMP_SHEET_ID);
  let sheet = ss.getSheetByName(CERT_LINKS_TAB);
  if (!sheet) sheet = ss.insertSheet(CERT_LINKS_TAB);

  // Keep the human decisions made in the Needs Verification queue ("Reassigned ..."/"Resolved ...")
  // -- otherwise every refresh would undo them. Matched by Drive file ID + document type.
  const kept = {};
  if (sheet.getLastRow() > 1) {
    const old = sheet.getDataRange().getValues();
    const h = old[0];
    const c = { code: h.indexOf('Employee Code'), name: h.indexOf('Employee Name'), school: h.indexOf('School'),
      type: h.indexOf('Document Type'), link: h.indexOf('Drive Link'), status: h.indexOf('Status') };
    old.slice(1).forEach(function (r) {
      const status = String(r[c.status] || '');
      if (!/^(Reassigned|Resolved)/.test(status)) return;
      const id = extractDriveFileId_(r[c.link]);
      if (id) kept[id + '|' + r[c.type]] = [r[c.code], r[c.name], r[c.school], status];
    });
  }
  rows.forEach(function (row) {
    const k = kept[extractDriveFileId_(row[5]) + '|' + row[3]];
    if (k) { row[0] = k[0]; row[1] = k[1]; row[2] = k[2]; row[6] = k[3]; }
  });

  sheet.clearContents();
  const header = ['Employee Code', 'Employee Name', 'School', 'Document Type', 'Filename', 'Drive Link', 'Status'];
  sheet.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  if (rows.length) sheet.getRange(2, 1, rows.length, header.length).setValues(rows);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, header.length);
  Logger.log('Refreshed ' + rows.length + ' certificate link rows into "' + CERT_LINKS_TAB + '" directly from Response sheets (' + Object.keys(kept).length + ' manual decisions kept).');
}

// One-time setup -- Uday runs this once from the Apps Script editor: it
// installs a time-driven trigger so the tab above stays current without
// any manual re-run/paste cycle going forward. Safe to run again -- it
// clears any prior trigger for this function first, so it can't stack
// duplicates that would refresh the sheet multiple times per run.
function installCertificateLinksRefreshTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'refreshCertificateLinksFromResponseSheets') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('refreshCertificateLinksFromResponseSheets').timeBased().everyHours(6).create();
  Logger.log('Installed: refreshCertificateLinksFromResponseSheets will now run every 6 hours automatically.');
}
