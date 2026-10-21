// LMCS Office Backend -- one-off legacy import. Owner runs officeImportRows_ from the Apps Script editor with the
// daybook.csv / closes.csv text written by tools/office-import-daybook.mjs. Not an HTTP action: no route reaches it.

var OFFICE_IMPORT_TABS = ['DayBook', 'Closes'];

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

// Appends the CSV's rows to `tab` (DayBook or Closes) of campus's book for financial year `fy`, once per id
// (officeAppend_ skips duplicates), under the script lock. Rows dated in another financial year are counted in
// otherFy and left for that year's run; rows of another campus abort the whole import before anything is written.
// Returns {tab, rows, appended, duplicates, otherFy}.
function officeImportRows_(campus, fy, tab, csvText) {
  if (OFFICE_IMPORT_TABS.indexOf(tab) === -1) throw new Error('BAD_TAB: ' + tab);
  const cols = OFFICE_TABLES[tab];
  const parsed = officeImportParseCsv_(String(csvText)).filter(function (r) { return r.some(function (c) { return c !== ''; }); });
  if (!parsed.length || parsed[0].join(',') !== cols.join(',')) throw new Error('BAD_HEADER');
  const dateCol = tab === 'DayBook' ? 'entry_date' : 'close_date';
  const objs = parsed.slice(1).map(function (r) {
    const o = {};
    cols.forEach(function (c, i) { o[c] = r[i] === undefined ? '' : r[i]; });
    return o;
  });
  objs.forEach(function (o) {
    if (o.campus !== campus) throw new Error('WRONG_CAMPUS: ' + o.id);
    if (!officeIsoDate_(o[dateCol])) throw new Error('BAD_DATE: ' + o.id);
    if (tab === 'DayBook' && !/^[1-9]\d*$/.test(o.amount_paise)) throw new Error('BAD_AMOUNT: ' + o.id);
  });
  const ss = officeOpen_(campus, fy);
  const res = { tab: tab, rows: objs.length, appended: 0, duplicates: 0, otherFy: 0 };
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    objs.forEach(function (o) {
      if (officeFy_(o[dateCol]) !== fy) { res.otherFy++; return; }
      if (tab === 'DayBook') o.amount_paise = Number(o.amount_paise);
      // created_at is stamped now (officeAppend_); created_by 'import' marks the row as imported.
      if (officeAppend_(ss, tab, o, { email: 'import' }, { action: 'import', campus: campus }).duplicate) res.duplicates++; else res.appended++;
    });
  } finally {
    lock.releaseLock();
  }
  return res;
}
