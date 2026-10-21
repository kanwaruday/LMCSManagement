#!/usr/bin/env node
// Legacy day book importer (Office portal, Task 15).
//   node tools/office-import-daybook.mjs <legacy.csv> --campus LMS1 --mapping <mapping.json> --out <dir> [--at <ISO timestamp>]
// Reads a CSV export of the legacy day book and writes <dir>/opening-<FY>.csv (one per financial year),
// <dir>/daybook.csv, <dir>/closes.csv (exact Opening/DayBook/Closes column order of OFFICE_TABLES, created_by
// 'import') and <dir>/report.txt (counts, skipped rows with reasons, per-day total diffs, load order).
// Nothing is ever guessed: a row that cannot be read exactly is skipped with its reason.
// The CSV and the real mapping stay OUTSIDE the repo (public repo; they name real people). Load the output with
// officeImportRows_ (apps-script/office-import.gs), per financial year: Opening first, then DayBook, then Closes.
//
// Filling a real mapping: copy tools/office-import-mapping.example.json outside the repo and set
//   dateColumn + dateFormat ('DD/MM/YYYY' or 'YYYY-MM-DD')
//   amount: {signed: col} (negative = payment) OR {receipt: col, payment: col} (exactly one filled per row)
//   modeColumn + modeMap (legacy text -> cash|bank|upi); an unmapped mode skips the row
//   bucket: {default:'fee'} or {column, map, default} (cash rows only; petty|fee|other); no default + unmapped skips
//   categoryColumn + categoryMap (legacy text -> category id from office-config.gs); unmapped -> other_in/other_out
//   payeeColumn, narrationColumn (optional)
//   closingColumn (optional): the legacy balance after that day, summed over all modes, in rupees. Checked against the
//     balance computed by the backend's own officeBalances_; differences are listed in report.txt (never "fixed").
//   opening (optional, officeOpening_ shape, paise): balances before the first imported day; default zero. It is the
//     first year's Opening; each later year's Opening is the import's own 31 March closing of the year before.
// A row is identified by campus + its row number in the CSV (header = row 1), so re-running gives identical ids.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { parseRupeesToPaise } from '../office/js/format.js';

const here = dirname(fileURLToPath(import.meta.url));
const DAYBOOK_COLS = ['id', 'campus', 'entry_date', 'direction', 'mode', 'bucket', 'category', 'amount_paise', 'payee', 'narration', 'file_id', 'reverses', 'created_at', 'created_by'];
const CLOSES_COLS = ['id', 'campus', 'close_date', 'closing_json', 'created_at', 'created_by'];
const OPENING_COLS = ['id', 'campus', 'mode', 'bucket', 'amount_paise', 'created_at', 'created_by'];

// officeBalances_ from the real backend file (pure function), so the closing figures cannot drift from the backend's.
const gs = vm.createContext({});
vm.runInContext(readFileSync(join(here, '..', 'apps-script', 'office-daybook.gs'), 'utf8'), gs, { filename: 'office-daybook.gs' });
const balances = (opening, rows, date) => JSON.parse(JSON.stringify(gs.officeBalances_(opening, rows, date)));

const ZERO_OPENING = () => ({ cash: { petty: 0, fee: 0, other: 0 }, bank: 0, upi: 0 });
const norm = (s) => String(s ?? '').trim().toLowerCase();
const lookup = (map, v) => { const k = Object.keys(map || {}).find((x) => norm(x) === norm(v)); return k === undefined ? undefined : map[k]; };

// RFC-4180 reader: quoted fields, "" escapes, CRLF/LF. Returns array of arrays.
export function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
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
export const toCsv = (cols, objs) => [cols, ...objs.map((o) => cols.map((c) => o[c] ?? ''))]
  .map((r) => r.map((v) => (/[",\r\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v))).join(',')).join('\n') + '\n';

function parseDate(s, fmt) {
  const m = (fmt === 'YYYY-MM-DD' ? /^(\d{4})-(\d{2})-(\d{2})$/ : /^(\d{2})\/(\d{2})\/(\d{4})$/).exec(String(s).trim());
  if (!m) return null;
  const [y, mo, d] = fmt === 'YYYY-MM-DD' ? [m[1], m[2], m[3]] : [m[3], m[2], m[1]];
  const iso = `${y}-${mo}-${d}`;
  const dt = new Date(iso + 'T00:00:00Z');
  return !isNaN(dt) && dt.toISOString().slice(0, 10) === iso ? iso : null;
}

// Signed or plain amount text -> {paise (>=0)} | {empty:true} (blank or zero) | null (unparseable). Exact, no floats.
function parseAmount(s) {
  const t = String(s ?? '').trim();
  if (!t || /^₹?\s*0+(\.0+)?$/.test(t)) return { empty: true };
  const p = parseRupeesToPaise(t.replace(/^-\s*/, ''));
  return p === null ? null : { paise: p, neg: /^-/.test(t) };
}

// One legacy CSV row (object keyed by header) -> DayBookRow (created_at/created_by left '' for the caller) or {skip, reason}.
// ctx = {campus, rowNumber} feeds the deterministic id.
export function mapLegacyRow(row, mapping, ctx) {
  const date = parseDate(row[mapping.dateColumn], mapping.dateFormat);
  if (!date) return { skip: true, reason: `unreadable date "${row[mapping.dateColumn] ?? ''}"` };
  let amount, direction;
  const a = mapping.amount;
  if (a.signed) {
    const p = parseAmount(row[a.signed]);
    if (!p) return { skip: true, reason: `unparseable amount "${row[a.signed]}"` };
    if (p.empty) return { skip: true, reason: 'zero or empty amount' };
    amount = p.paise; direction = p.neg ? 'OUT' : 'IN';
  } else {
    const r = parseAmount(row[a.receipt]), p = parseAmount(row[a.payment]);
    if (r?.neg || p?.neg) return { skip: true, reason: 'negative amount in receipt/payment column' };
    if (!r || !p) return { skip: true, reason: `unparseable amount "${!r ? row[a.receipt] : row[a.payment]}"` };
    if (!r.empty && !p.empty) return { skip: true, reason: 'both receipt and payment filled' };
    if (r.empty && p.empty) return { skip: true, reason: 'zero or empty amount' };
    amount = (r.empty ? p : r).paise; direction = r.empty ? 'OUT' : 'IN';
  }
  const mode = lookup(mapping.modeMap, row[mapping.modeColumn]);
  if (!['cash', 'bank', 'upi'].includes(mode)) return { skip: true, reason: `unmapped mode "${row[mapping.modeColumn] ?? ''}"` };
  let bucket = '';
  if (mode === 'cash') {
    const b = mapping.bucket || {};
    bucket = (b.column && lookup(b.map, row[b.column])) || b.default;
    if (!['petty', 'fee', 'other'].includes(bucket)) return { skip: true, reason: `unmapped cash bucket "${b.column ? row[b.column] ?? '' : ''}"` };
  }
  const category = (mapping.categoryColumn && lookup(mapping.categoryMap, row[mapping.categoryColumn])) || (direction === 'IN' ? 'other_in' : 'other_out');
  const hash = createHash('sha256').update(ctx.campus + ':' + ctx.rowNumber).digest('hex').slice(0, 16);
  return {
    id: `imp-${ctx.campus}-${hash}`, campus: ctx.campus, entry_date: date, direction, mode, bucket, category, amount_paise: amount,
    payee: mapping.payeeColumn ? String(row[mapping.payeeColumn] ?? '').trim() : '',
    narration: mapping.narrationColumn ? String(row[mapping.narrationColumn] ?? '').trim() : '',
    file_id: '', reverses: '', created_at: '', created_by: '',
  };
}

const total = (b) => b.cash.petty + b.cash.fee + b.cash.other + b.bank + b.upi;

// Computed closing total (all modes, paise) per day vs legacyTotals {iso: paise}. Only the days named are checked.
export function verifyTotals(rows, legacyTotals, opening = ZERO_OPENING()) {
  const diffs = [];
  for (const date of Object.keys(legacyTotals).sort()) {
    const computed = total(balances(opening, rows, date).closing);
    if (computed !== legacyTotals[date]) diffs.push({ date, legacy: legacyTotals[date], computed, diff: computed - legacyTotals[date] });
  }
  return { ok: diffs.length === 0, diffs };
}

// Financial year (Apr-Mar) of an ISO date, as officeFy_: '2026-04-01' -> '2026-27'.
const fyOf = (iso) => { const y = Number(iso.slice(0, 4)), s = Number(iso.slice(5, 7)) >= 4 ? y : y - 1; return s + '-' + String((s + 1) % 100).padStart(2, '0'); };
const nextFy = (fy) => fyOf(String(Number(fy.slice(0, 4)) + 1) + '-04-01');

// One Opening row per mode/bucket (zeros included, so every year's book gets a full set).
function openingRows(campus, fy, o, at) {
  const r = (mode, bucket, amount) => ({ id: `impopen-${campus}-${fy}-${mode}${bucket ? '-' + bucket : ''}`, campus, mode, bucket, amount_paise: amount, created_at: at, created_by: 'import' });
  return [r('cash', 'petty', o.cash.petty), r('cash', 'fee', o.cash.fee), r('cash', 'other', o.cash.other), r('bank', '', o.bank), r('upi', '', o.upi)];
}

const rupees = (p) => (p < 0 ? '-' : '') + Math.floor(Math.abs(p) / 100) + '.' + String(Math.abs(p) % 100).padStart(2, '0');

// Whole import in memory: {daybook, closes, report} as CSV/text strings plus counts.
export function buildImport(csvText, mapping, campus, at) {
  const [head, ...lines] = parseCsv(csvText);
  const rows = [], skipped = [], notes = [], legacyTotals = {}, openDays = new Set();
  let undated = 0, defaulted = 0;
  lines.forEach((cells, i) => {
    if (cells.every((c) => c.trim() === '')) return;
    const rowNumber = i + 2; // spreadsheet row: header is row 1
    const obj = Object.fromEntries(head.map((h, j) => [h, cells[j] ?? '']));
    const r = mapLegacyRow(obj, mapping, { campus, rowNumber });
    if (r.skip) {
      skipped.push({ rowNumber, reason: r.reason });
      const d = parseDate(obj[mapping.dateColumn], mapping.dateFormat);
      if (d) openDays.add(d); else undated++;
      return;
    }
    r.created_at = at; r.created_by = 'import';
    if (!(mapping.categoryColumn && lookup(mapping.categoryMap, obj[mapping.categoryColumn]))) defaulted++; // fell back to other_in/other_out
    rows.push(r);
    if (mapping.closingColumn && String(obj[mapping.closingColumn]).trim() !== '') {
      const c = parseAmount(obj[mapping.closingColumn]);
      if (c && !c.empty) legacyTotals[r.entry_date] = c.neg ? -c.paise : c.paise; // last row of the day wins
      else if (c && c.empty) legacyTotals[r.entry_date] = 0;
      else notes.push(`row ${rowNumber}: imported, but closing balance "${obj[mapping.closingColumn]}" unreadable`);
    }
  });
  const opening = mapping.opening || ZERO_OPENING();
  const dates = [...new Set(rows.map((r) => r.entry_date))].sort();
  const closeDates = dates.filter((d) => !openDays.has(d));
  const heldOpen = dates.filter((d) => openDays.has(d));
  for (const d of Object.keys(legacyTotals)) if (!closeDates.includes(d)) delete legacyTotals[d];
  const closes = closeDates.map((d) => ({ id: `impclose-${campus}-${d}`, campus, close_date: d, closing_json: JSON.stringify(balances(opening, rows, d)), created_at: at, created_by: 'import' }));
  const v = verifyTotals(rows, legacyTotals, opening);
  // Opening per financial year: the first from the mapping, each later one the previous 31 March closing.
  const openings = {};
  if (dates.length) {
    for (let fy = fyOf(dates[0]), o = opening; ; fy = nextFy(fy)) {
      openings[fy] = toCsv(OPENING_COLS, openingRows(campus, fy, o, at));
      if (fy === fyOf(dates[dates.length - 1])) break;
      o = balances(opening, rows, fy.slice(0, 2) + fy.slice(5, 7) + '-03-31').closing;
    }
  }
  const fys = Object.keys(openings);
  const report = [
    `Legacy day book import, campus ${campus}, run at ${at}`,
    `Data rows read: ${rows.length + skipped.length}`,
    `Imported: ${rows.length} rows, ${closes.length} closed days, ${heldOpen.length} days left open${dates.length ? ` (${dates[0]} to ${dates[dates.length - 1]})` : ''}`,
    `Skipped: ${skipped.length}`, ...skipped.map((s) => `  row ${s.rowNumber}: ${s.reason}`),
    ...(undated ? [`WARNING: ${undated} skipped row(s) have no readable date, so totals are partial and no day can be proven complete; check every day before closing it.`] : []),
    `Days left open (they have skipped rows; fix them in the portal, then close): ${heldOpen.length}`, ...heldOpen.map((d) => `  ${d}`),
    ...(notes.length ? ['Notes:', ...notes.map((n) => '  ' + n)] : []),
    `Category defaulted to other_in/other_out: ${defaulted} row${defaulted === 1 ? '' : 's'} (no category mapped; check them)`,
    `Days checked against legacy closing: ${Object.keys(legacyTotals).length}, differing: ${v.diffs.length}`,
    ...v.diffs.map((d) => `  ${d.date}: legacy ${rupees(d.legacy)}, computed ${rupees(d.computed)}, diff ${rupees(d.diff)}`),
    'Load order (officeImportRows_, in this order, each into that year\'s OFFICE_SS_' + campus + '_<FY> book):',
    ...fys.map((fy, i) => `  ${i + 1}. ${fy}: opening-${fy}.csv as 'Opening', then daybook.csv as 'DayBook', then closes.csv as 'Closes'`),
  ].join('\n') + '\n';
  return { daybook: toCsv(DAYBOOK_COLS, rows), closes: toCsv(CLOSES_COLS, closes), openings, report, rows, skipped, heldOpen, diffs: v.diffs, defaulted };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf('--' + n); return i < 0 ? undefined : args[i + 1]; };
  const src = args[0];
  if (!src || src.startsWith('--') || !opt('campus') || !opt('mapping') || !opt('out')) {
    console.error('usage: node tools/office-import-daybook.mjs <legacy.csv> --campus LMS1 --mapping <mapping.json> --out <dir> [--at <ISO>]');
    process.exit(2);
  }
  const res = buildImport(readFileSync(src, 'utf8'), JSON.parse(readFileSync(opt('mapping'), 'utf8')), opt('campus'), opt('at') || new Date().toISOString());
  mkdirSync(opt('out'), { recursive: true });
  for (const [f, k] of [['daybook.csv', 'daybook'], ['closes.csv', 'closes'], ['report.txt', 'report']]) writeFileSync(join(opt('out'), f), res[k]);
  for (const [fy, text] of Object.entries(res.openings)) writeFileSync(join(opt('out'), `opening-${fy}.csv`), text);
  process.stdout.write(res.report);
}
