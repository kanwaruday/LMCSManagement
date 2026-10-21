// LMCS Office Backend -- store layer: tables, idempotent append, audit.
// Script Properties (read at call time; no IDs in source):
//   OFFICE_SS_<CAMPUS>_<FY>  the campus's yearly book, e.g. OFFICE_SS_LMS1_2026-27
//   OFFICE_CONFIG_SS         the Office Config book
// One tab per table, header in row 1. Records are append-only: nothing here updates or deletes a row.

var OFFICE_TABLES = {
  DayBook: ['id', 'campus', 'entry_date', 'direction', 'mode', 'bucket', 'category', 'amount_paise', 'payee', 'narration', 'file_id', 'reverses', 'created_at', 'created_by'],
  Opening: ['id', 'campus', 'mode', 'bucket', 'amount_paise', 'created_at', 'created_by'],
  Closes: ['id', 'campus', 'close_date', 'closing_json', 'created_at', 'created_by'],
  Reopens: ['id', 'campus', 'close_date', 'reason', 'created_at', 'created_by'],
  Reports: ['id', 'campus', 'report_date', 'json', 'late', 'submitted_for', 'created_at', 'created_by'],
  Deposits: ['id', 'campus', 'covers_date', 'amount_paise', 'bank_ref', 'file_id', 'created_at', 'created_by'],
  DepositSigns: ['id', 'campus', 'deposit_id', 'created_at', 'created_by'],
  ErpTotals: ['id', 'campus', 'total_date', 'amount_paise', 'created_at', 'created_by'],
  Files: ['id', 'campus', 'drive_id', 'name', 'size', 'fingerprint', 'category', 'belongs_to', 'created_at', 'created_by'],
  Substitutes: ['id', 'campus', 'email', 'from_date', 'to_date', 'created_at', 'created_by'],
  Audit: ['id', 'ts', 'who', 'action', 'tab', 'row_id', 'campus', 'after'],
};

// The campus's book for a financial year, with any missing tab created (existing headers are never rewritten).
function officeOpen_(campus, fy) {
  const id = PropertiesService.getScriptProperties().getProperty('OFFICE_SS_' + String(campus).toUpperCase() + '_' + fy);
  if (!id) throw new Error('NO_BOOK');
  const ss = SpreadsheetApp.openById(id);
  Object.keys(OFFICE_TABLES).forEach(function (tab) {
    if (ss.getSheetByName(tab)) return;
    const sh = ss.insertSheet(tab);
    sh.getRange(1, 1, 1, OFFICE_TABLES[tab].length).setNumberFormat('@').setValues([OFFICE_TABLES[tab]]);
    sh.setFrozenRows(1);
  });
  return ss;
}

function officeConfig_() {
  const id = PropertiesService.getScriptProperties().getProperty('OFFICE_CONFIG_SS');
  if (!id) throw new Error('NO_BOOK');
  return SpreadsheetApp.openById(id);
}

// All rows of a tab as objects keyed by the header row. Cells are text; *_paise and size read as Number, late as boolean.
function officeCell_(col, v) {
  if (/_paise$/.test(col) || col === 'size') return v === '' ? '' : Number(v);
  if (col === 'late') return v === true || v === 'true';
  return v === null || v === undefined ? '' : String(v);
}

function officeRows_(ss, tab) {
  const sh = ss.getSheetByName(tab);
  if (!sh) throw new Error('NO_TAB: ' + tab);
  const v = sh.getDataRange().getValues();
  const head = v[0] || [];
  return v.slice(1).map(function (r) {
    const o = {};
    head.forEach(function (h, i) { o[h] = officeCell_(h, r[i]); });
    return o;
  });
}

function officeWriteRow_(ss, tab, obj) {
  const cols = OFFICE_TABLES[tab];
  const sh = ss.getSheetByName(tab);
  // '@' = plain text, so Sheets never turns ISO dates into Dates or '=...' text into formulas.
  sh.getRange(sh.getLastRow() + 1, 1, 1, cols.length).setNumberFormat('@').setValues([cols.map(function (c) { return obj[c] === undefined ? '' : obj[c]; })]);
}

// Appends `row` to `tab` once per row.id and audits it. Caller must hold the script lock (officeHandle_ does
// for write actions). Stamps created_at/created_by, and campus if absent. opts: {action} names the audit row.
function officeAppend_(ss, tab, row, caller, opts) {
  if (!OFFICE_TABLES[tab]) throw new Error('NO_TAB: ' + tab);
  if (!row || !row.id) throw new Error('MISSING_ID');
  const id = String(row.id);
  if (officeRows_(ss, tab).some(function (r) { return String(r.id) === id; })) return { id: id, duplicate: true };
  const iso = officeNow_().toISOString();
  const full = Object.assign({}, row, { id: id, created_at: iso, created_by: caller.email });
  if (!full.campus) full.campus = (opts && opts.campus) || '';
  officeWriteRow_(ss, tab, full);
  officeWriteRow_(ss, 'Audit', {
    id: Utilities.getUuid(), ts: iso, who: caller.email, action: (opts && opts.action) || '',
    tab: tab, row_id: id, campus: full.campus, after: JSON.stringify(full),
  });
  return { id: id, duplicate: false };
}
