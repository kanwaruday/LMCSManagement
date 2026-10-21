#!/usr/bin/env node
// Legacy day book importer (Office portal, Task 15).
//   node tools/office-import-daybook.mjs <legacy.csv> --campus LMS1 --mapping <mapping.json> --out <dir> [--at <ISO timestamp>]
// Reads a CSV export of the legacy day book and writes <dir>/daybook.csv, <dir>/closes.csv (exact DayBook/Closes
// column order of OFFICE_TABLES, created_by 'import') and <dir>/report.txt (counts, skipped rows with reasons,
// per-day total diffs). Nothing is ever guessed: a row that cannot be read exactly is skipped with its reason.
// The CSV and the real mapping stay OUTSIDE the repo (public repo; they name real people). Load the output with
// officeImportRows_ (apps-script/office-import.gs), once per file, once per financial year.
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
//   opening (optional, officeOpening_ shape, paise): balances before the first imported day; default zero.
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

// officeBalances_ from the real backend file (pure function), so the closing figures cannot drift from the backend's.
const gs = vm.createContext({});
vm.runInContext(readFileSync(join(here, '..', 'apps-script', 'office-daybook.gs'), 'utf8'), gs, { filename: 'office-daybook.gs' });
const balances = (opening, rows, date) => JSON.parse(JSON.stringify(gs.officeBalances_(opening, rows, date)));

const ZERO_OPENING = () => ({ cash: { petty: 0, fee: 0, other: 0 }, bank: 0, upi: 0 });
const norm = (s) => String(s ?? '').trim().toLowerCase();
const lookup = (map, v) => { const k = Object.keys(map || {}).find((x) => norm(x) === norm(v)); return k === undefined ? undefined : map[k]; };

// RFC-4180 reader: quoted fields, "" escapes, CRLF/LF. Returns array of arrays.
export function parseCsv(text) {
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

const rupees = (p) => (p < 0 ? '-' : '') + Math.floor(Math.abs(p) / 100) + '.' + String(Math.abs(p) % 100).padStart(2, '0');

// Whole import in memory: {daybook, closes, report} as CSV/text strings plus counts.
export function buildImport(csvText, mapping, campus, at) {
  const [head, ...lines] = parseCsv(csvText);
  const rows = [], skipped = [], legacyTotals = {};
  lines.forEach((cells, i) => {
    if (cells.every((c) => c.trim() === '')) return;
    const rowNumber = i + 2; // spreadsheet row: header is row 1
    const obj = Object.fromEntries(head.map((h, j) => [h, cells[j] ?? '']));
    const r = mapLegacyRow(obj, mapping, { campus, rowNumber });
    if (r.skip) return skipped.push({ rowNumber, reason: r.reason });
    r.created_at = at; r.created_by = 'import';
    rows.push(r);
    if (mapping.closingColumn && String(obj[mapping.closingColumn]).trim() !== '') {
      const c = parseAmount(obj[mapping.closingColumn]);
      if (c && !c.empty) legacyTotals[r.entry_date] = c.neg ? -c.paise : c.paise; // last row of the day wins
      else if (c && c.empty) legacyTotals[r.entry_date] = 0;
      else skipped.push({ rowNumber, reason: `row imported, but closing balance "${obj[mapping.closingColumn]}" unreadable` });
    }
  });
  const opening = mapping.opening || ZERO_OPENING();
  const dates = [...new Set(rows.map((r) => r.entry_date))].sort();
  const closes = dates.map((d) => ({ id: `impclose-${campus}-${d}`, campus, close_date: d, closing_json: JSON.stringify(balances(opening, rows, d)), created_at: at, created_by: 'import' }));
  const v = verifyTotals(rows, legacyTotals, opening);
  const report = [
    `Legacy day book import, campus ${campus}, run at ${at}`,
    `Data rows read: ${rows.length + skipped.filter((s) => !s.reason.startsWith('row imported')).length}`,
    `Imported: ${rows.length} rows, ${closes.length} closed days${dates.length ? ` (${dates[0]} to ${dates[dates.length - 1]})` : ''}`,
    `Skipped: ${skipped.length}`, ...skipped.map((s) => `  row ${s.rowNumber}: ${s.reason}`),
    `Days checked against legacy closing: ${Object.keys(legacyTotals).length}, differing: ${v.diffs.length}`,
    ...v.diffs.map((d) => `  ${d.date}: legacy ${rupees(d.legacy)}, computed ${rupees(d.computed)}, diff ${rupees(d.diff)}`),
  ].join('\n') + '\n';
  return { daybook: toCsv(DAYBOOK_COLS, rows), closes: toCsv(CLOSES_COLS, closes), report, rows, skipped, diffs: v.diffs };
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
  process.stdout.write(res.report);
}
