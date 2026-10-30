// LMCS Office Backend -- store layer: tables, idempotent append, audit.
// Script Properties (read at call time; no IDs in source):
//   OFFICE_SS_<CAMPUS>_<FY>  the campus's yearly book, e.g. OFFICE_SS_LMS1_2026-27
//   OFFICE_CONFIG_SS         the Office Config book
// One tab per table, header in row 1. Records are append-only: nothing here updates or deletes a row.

var OFFICE_TABLES = {
  DayBook: ['id', 'campus', 'entry_date', 'direction', 'mode', 'bucket', 'category', 'amount_paise', 'payee', 'narration', 'file_id', 'reverses', 'created_at', 'created_by',
    'account', 'charged_to', 'vehicle', 'litres_ml', 'odometer_km', 'odometer_note', 'supplier_bill_no', 'settles_account', 'settles', 'source', 'legacy_category', 'mapped_by', 'collection', 'components', 'video_file_id'],
  Opening: ['id', 'campus', 'mode', 'bucket', 'amount_paise', 'created_at', 'created_by', 'account'],
  Closes: ['id', 'campus', 'close_date', 'closing_json', 'created_at', 'created_by'],
  Reopens: ['id', 'campus', 'close_date', 'reason', 'created_at', 'created_by'],
  Reports: ['id', 'campus', 'report_date', 'json', 'late', 'submitted_for', 'created_at', 'created_by'],
  Deposits: ['id', 'campus', 'covers_date', 'amount_paise', 'bank_ref', 'file_id', 'created_at', 'created_by', 'bank_account'],
  DepositSigns: ['id', 'campus', 'deposit_id', 'created_at', 'created_by'],
  ErpTotals: ['id', 'campus', 'total_date', 'amount_paise', 'created_at', 'created_by'],
  Files: ['id', 'campus', 'drive_id', 'name', 'size', 'fingerprint', 'category', 'belongs_to', 'created_at', 'created_by'],
  Substitutes: ['id', 'campus', 'email', 'from_date', 'to_date', 'created_at', 'created_by'],
  Audit: ['id', 'ts', 'who', 'action', 'tab', 'row_id', 'campus', 'after'],
};

// Per-request memo (payroll.gs PAY_MEMO pattern): officeHandle_ starts it for each call and drops it at the end;
// books opened and tab values read are reused within the call, and every row write forgets the values read.
// null (outside a request: editor runs, nightly backup) means no memo.
var OFFICE_MEMO = null;
function officeMemoStart_() { OFFICE_MEMO = { books: {}, values: new Map() }; }

// Script Property naming a campus's book for a financial year, and whether it is configured.
function officeBookKey_(campus, fy) { return 'OFFICE_SS_' + String(campus).toUpperCase() + '_' + fy; }
function officeHasBook_(campus, fy) { return !!PropertiesService.getScriptProperties().getProperty(officeBookKey_(campus, fy)); }

// The financial year before `fy`: '2026-27' -> '2025-26'.
function officePrevFy_(fy) {
  const start = Number(fy.slice(0, 4)) - 1;
  return start + '-' + String((start + 1) % 100).padStart(2, '0');
}

// Books holding records for a campus: this financial year's, then the previous one's if it exists (R15 pattern).
function officeRecentBooks_(campus) {
  const prevFy = officePrevFy_(officeFy_(officeToday_()));
  const books = [officeOpen_(campus, officeFy_(officeToday_()))];
  if (officeHasBook_(campus, prevFy)) books.push(officeOpen_(campus, prevFy));
  return books;
}

// The campus's book for a financial year, with any missing tab created (existing headers are never rewritten).
function officeOpen_(campus, fy) {
  const key = officeBookKey_(campus, fy);
  if (OFFICE_MEMO && OFFICE_MEMO.books[key]) return OFFICE_MEMO.books[key];
  const id = PropertiesService.getScriptProperties().getProperty(key);
  if (!id) throw new Error('NO_BOOK');
  const ss = SpreadsheetApp.openById(id);
  Object.keys(OFFICE_TABLES).forEach(function (tab) {
    const have = ss.getSheetByName(tab);
    if (have) { officeEnsureHeader_(have, OFFICE_TABLES[tab]); return; }
    const sh = ss.insertSheet(tab);
    officeWidenGrid_(sh, OFFICE_TABLES[tab].length); // a new sheet has 26 columns (P7)
    sh.getRange(1, 1, 1, OFFICE_TABLES[tab].length).setNumberFormat('@').setValues([OFFICE_TABLES[tab]]);
    sh.setFrozenRows(1);
  });
  if (OFFICE_MEMO) OFFICE_MEMO.books[key] = ss; // memoised only once the headers check out
  return ss;
}

// Sheets throws past the grid, so widen it to `n` columns before writing there.
function officeWidenGrid_(sheet, n) {
  if (sheet.getMaxColumns() < n) sheet.insertColumnsAfter(sheet.getMaxColumns(), n - sheet.getMaxColumns());
}

// Brings an existing tab's header up to `columns` by appending the missing trailing ones (text-formatted).
// Existing header cells and rows are never rewritten; a header that is not a prefix of `columns` is a mismatch.
function officeEnsureHeader_(sheet, columns) {
  const n = sheet.getLastColumn();
  const head = n ? sheet.getRange(1, 1, 1, n).getValues()[0].map(String) : [];
  while (head.length && head[head.length - 1] === '') head.pop();
  const at = officeHeaderMismatch_(head, columns);
  if (at !== -1) { // names the tab and column so the fix is a header repair, not a hunt (code stays HEADER_MISMATCH)
    const err = new Error('HEADER_MISMATCH: ' + sheet.getName() + '!' + (at + 1));
    err.code = 'HEADER_MISMATCH';
    throw err;
  }
  if (head.length >= columns.length) return;
  officeWidenGrid_(sheet, columns.length);
  sheet.getRange(1, head.length + 1, 1, columns.length - head.length).setNumberFormat('@').setValues([columns.slice(head.length)]);
}

// The first column (0-based) where `head` stops being a prefix of `columns`, or -1 when it is one.
function officeHeaderMismatch_(head, columns) {
  for (let i = 0; i < head.length; i++) if (head[i] !== columns[i]) return i;
  return -1;
}

// Run from the editor: logs every tab whose header would raise HEADER_MISMATCH, in the Config book and every campus
// book named in Script Properties, with the column, what the sheet has and what the code expects. Reads only.
function officeCheckHeaders() {
  const props = PropertiesService.getScriptProperties().getProperties(), out = [];
  const check = function (label, ss, tabs) {
    Object.keys(tabs).forEach(function (tab) {
      const sh = ss.getSheetByName(tab);
      if (!sh || !sh.getLastColumn()) return;
      const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
      while (head.length && head[head.length - 1] === '') head.pop();
      const at = officeHeaderMismatch_(head, tabs[tab]);
      if (at !== -1) out.push(label + ' / ' + tab + ' column ' + (at + 1) + ': sheet has "' + head[at] + '", code expects "' + (tabs[tab][at] || '(nothing: extra column)') + '". Sheet row 1: ' + head.join(' | '));
    });
  };
  if (props.OFFICE_CONFIG_SS) {
    const tabs = {};
    ['Accounts', 'Vehicles', 'Collections', 'StartData', 'SetupQuests', 'Settings', 'Handovers'].forEach(function (t) { tabs[t] = OFFICE_CONFIG_SEED[t][0]; });
    check('Config', SpreadsheetApp.openById(props.OFFICE_CONFIG_SS), tabs);
  }
  Object.keys(props).filter(function (k) { return /^OFFICE_SS_/.test(k); }).sort().forEach(function (k) {
    check(k.replace('OFFICE_SS_', ''), SpreadsheetApp.openById(props[k]), OFFICE_TABLES);
  });
  Logger.log(out.length ? out.join('\n') : 'Every Office header matches.');
  return out;
}

function officeConfig_() {
  const id = PropertiesService.getScriptProperties().getProperty('OFFICE_CONFIG_SS');
  if (!id) throw new Error('NO_BOOK');
  if (OFFICE_MEMO && OFFICE_MEMO.books.OFFICE_CONFIG_SS) return OFFICE_MEMO.books.OFFICE_CONFIG_SS;
  const ss = SpreadsheetApp.openById(id);
  if (OFFICE_MEMO) OFFICE_MEMO.books.OFFICE_CONFIG_SS = ss;
  return ss;
}

// All rows of a tab as objects keyed by the header row. Cells are text; *_paise, *_ml, *_km and size read as Number, late as boolean.
function officeCell_(col, v) {
  if (/_(paise|ml|km)$/.test(col) || col === 'size') return v === '' ? '' : Number(v);
  if (col === 'late') return v === true || String(v).toLowerCase() === 'true';
  return v === null || v === undefined ? '' : String(v);
}

function officeRows_(ss, tab) {
  const seen = OFFICE_MEMO && OFFICE_MEMO.values.get(ss);
  let v = seen && seen[tab];
  if (!v) {
    const sh = ss.getSheetByName(tab);
    if (!sh) throw new Error('NO_TAB: ' + tab);
    v = sh.getDataRange().getValues();
    if (OFFICE_MEMO) { if (!seen) OFFICE_MEMO.values.set(ss, {}); OFFICE_MEMO.values.get(ss)[tab] = v; }
  }
  const head = v[0] || [];
  return v.slice(1).map(function (r) {
    const o = {};
    head.forEach(function (h, i) { o[h] = officeCell_(h, r[i]); });
    return o;
  });
}

// Columns of a campus-book table, or of a Config tab (Accounts, Vehicles) from its seed header.
function officeCols_(tab) { return OFFICE_TABLES[tab] || (OFFICE_CONFIG_SEED[tab] && OFFICE_CONFIG_SEED[tab][0]); }

function officeWriteRow_(ss, tab, obj) {
  const cols = officeCols_(tab);
  const sh = ss.getSheetByName(tab);
  // '@' = plain text, so Sheets never turns ISO dates into Dates or '=...' text into formulas.
  sh.getRange(sh.getLastRow() + 1, 1, 1, cols.length).setNumberFormat('@').setValues([cols.map(function (c) { return obj[c] === undefined ? '' : obj[c]; })]);
  if (OFFICE_MEMO) OFFICE_MEMO.values = new Map(); // reads after a write see it
}

// Appends `row` to `tab` once per row.id and audits it. Caller must hold the script lock (officeHandle_ does
// for write actions). Stamps created_at/created_by, and campus if absent. opts: {action} names the audit row;
// {key} the unique column (default 'id'; Vehicles use 'reg'); {auditSs} the book whose Audit tab records it
// (Config books have none).
function officeAppend_(ss, tab, row, caller, opts) {
  if (!officeCols_(tab)) throw new Error('NO_TAB: ' + tab);
  const key = (opts && opts.key) || 'id';
  if (!row || !row[key]) throw new Error('MISSING_ID');
  const id = String(row[key]);
  if (officeRows_(ss, tab).some(function (r) { return String(r[key]) === id; })) return { id: id, duplicate: true };
  const iso = officeNow_().toISOString();
  const full = Object.assign({}, row, { [key]: id, created_at: iso, created_by: caller.email });
  if (!full.campus) full.campus = (opts && opts.campus) || '';
  officeWriteRow_(ss, tab, full);
  officeWriteRow_((opts && opts.auditSs) || ss, 'Audit', {
    id: Utilities.getUuid(), ts: iso, who: caller.email, action: (opts && opts.action) || '',
    tab: tab, row_id: id, campus: full.campus, after: JSON.stringify(full),
  });
  return { id: id, duplicate: false };
}

// One Audit row for an event that is not an appended record (e.g. file.view). Caller holds the lock.
function officeAuditWrite_(ss, caller, action, rowId, campus, after) {
  officeWriteRow_(ss, 'Audit', {
    id: Utilities.getUuid(), ts: officeNow_().toISOString(), who: caller.email, action: action,
    tab: 'Files', row_id: rowId, campus: campus, after: JSON.stringify(after),
  });
}
