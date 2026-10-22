// LMCS Office Backend -- one-off legacy import. Owner runs officeImportRows_ from the Apps Script editor with the
// opening-<FY>.csv / daybook.csv / closes.csv text written by tools/office-import-daybook.mjs, per financial year
// in that order (R39). Not an HTTP action: no route reaches it.

var OFFICE_IMPORT_TABS = ['Opening', 'DayBook', 'Closes'];

// RFC-4180 reader (quoted fields, "" escapes, CRLF/LF) -> array of arrays. Mirrors parseCsv in the tool.
function officeImportParseCsv_(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}

// Appends the CSV's rows to `tab` (Opening, DayBook or Closes) of campus's book for financial year `fy`, once per
// id (officeAppend_ skips duplicates), under the script lock. Rows dated in another financial year are counted in
// otherFy and left for that year's run; rows of another campus abort the whole import before anything is written.
// Opening comes first: DayBook is refused while the book has no Opening rows, and a new Opening row is refused
// once DayBook rows exist (it would change every imported day's balance).
// Returns {tab, rows, appended, duplicates, otherFy}.
function officeImportRows_(campus, fy, tab, csvText) {
  if (OFFICE_IMPORT_TABS.indexOf(tab) === -1) throw new Error('BAD_TAB: ' + tab);
  const cols = OFFICE_TABLES[tab];
  const parsed = officeImportParseCsv_(String(csvText)).filter(function (r) { return r.some(function (c) { return c !== ''; }); });
  // The importer's CSVs carry the original columns (through created_by); any longer prefix of the table is also accepted.
  const minLen = cols.indexOf('created_by') + 1;
  if (!parsed.length || parsed[0].length < minLen || parsed[0].join(',') !== cols.slice(0, parsed[0].length).join(',')) {
    // The Sheet importer's DayBook ends with `collection`; refuse (never drop it) until that column is deployed.
    throw new Error(parsed[0][parsed[0].length - 1] === 'collection' && cols.indexOf('collection') === -1 ? 'BAD_HEADER: the collection column is not deployed yet' : 'BAD_HEADER');
  }
  const dateCol = { DayBook: 'entry_date', Closes: 'close_date' }[tab]; // Opening rows carry no date: the file is per year
  const objs = parsed.slice(1).map(function (r) {
    const o = {};
    cols.forEach(function (c, i) { o[c] = r[i] === undefined ? '' : r[i]; });
    return o;
  });
  objs.forEach(function (o) {
    if (o.campus !== campus) throw new Error('WRONG_CAMPUS: ' + o.id);
    if (dateCol && !officeIsoDate_(o[dateCol])) throw new Error('BAD_DATE: ' + o.id);
    if (tab === 'DayBook' && !/^[1-9]\d*$/.test(o.amount_paise)) throw new Error('BAD_AMOUNT: ' + o.id);
    if (tab === 'Opening' && !/^-?\d+$/.test(o.amount_paise)) throw new Error('BAD_AMOUNT: ' + o.id);
  });
  const ss = officeOpen_(campus, fy);
  if (tab === 'DayBook' && !officeRows_(ss, 'Opening').length) throw new Error('OPENING_FIRST: load opening-' + fy + '.csv as Opening first');
  if (tab === 'Opening' && officeRows_(ss, 'DayBook').length) {
    const have = officeRows_(ss, 'Opening').map(function (r) { return r.id; });
    if (objs.some(function (o) { return have.indexOf(o.id) === -1; })) throw new Error('OPENING_LOCKED: day book rows already exist in ' + fy);
  }
  const res = { tab: tab, rows: objs.length, appended: 0, duplicates: 0, otherFy: 0 };
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    objs.forEach(function (o) {
      if (dateCol && officeFy_(o[dateCol]) !== fy) { res.otherFy++; return; }
      if (tab !== 'Closes') o.amount_paise = Number(o.amount_paise);
      // created_at is stamped now (officeAppend_); created_by 'import' marks the row as imported.
      if (officeAppend_(ss, tab, o, { email: 'import' }, { action: 'import', campus: campus }).duplicate) res.duplicates++; else res.appended++;
    });
  } finally {
    lock.releaseLock();
  }
  return res;
}

// Owner runs once from the editor: loads the Sheet import files written by tools/office-import-sheet.mjs.
// `folderId` = Drive folder holding one subfolder per campus (named LMS1..LMS6), each with opening-2026-27.csv and
// daybook.csv. Opening first, then DayBook; re-running is safe (duplicates are skipped). A campus that fails is logged
// and the others still load. Returns [{campus, opening, daybook} | {campus, error}].
var OFFICE_SHEET_IMPORT_FY = '2026-27';
function officeImportFromDrive(folderId) {
  const root = DriveApp.getFolderById(folderId), out = [];
  const read = function (folder, name) {
    const it = folder.getFilesByName(name);
    if (!it.hasNext()) throw new Error('MISSING_FILE: ' + name);
    return it.next().getBlob().getDataAsString();
  };
  const kids = root.getFolders();
  while (kids.hasNext()) {
    const folder = kids.next(), campus = folder.getName();
    if (OFFICE_CAMPUSES.indexOf(campus) === -1) { Logger.log('Skipped folder ' + campus + ': not a campus'); continue; }
    try {
      const opening = officeImportRows_(campus, OFFICE_SHEET_IMPORT_FY, 'Opening', read(folder, 'opening-' + OFFICE_SHEET_IMPORT_FY + '.csv'));
      const daybook = officeImportRows_(campus, OFFICE_SHEET_IMPORT_FY, 'DayBook', read(folder, 'daybook.csv'));
      Logger.log(campus + ' opening ' + JSON.stringify(opening) + ' daybook ' + JSON.stringify(daybook));
      out.push({ campus: campus, opening: opening, daybook: daybook });
    } catch (e) {
      Logger.log(campus + ' FAILED: ' + e.message);
      out.push({ campus: campus, error: e.message });
    }
  }
  return out;
}
