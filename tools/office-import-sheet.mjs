#!/usr/bin/env node
// Old Google-Form day book Sheet -> Office Day Book v2 import files (FY 2026-27).
//   node tools/office-import-sheet.mjs --sheet-dir <dir> --review <review.csv> --from 2026-04-01 --to 2026-10-22 \
//        --actual <actual.json> --out <dir> [--date-format DMY|MDY] [--at <ISO>]
// No xlsx reader is installed (and none is added): export each campus tab as CSV (Google Sheets: File > Download >
// CSV, one tab at a time; Excel: Save As CSV UTF-8) into --sheet-dir, named LMS1.csv ... LMS6.csv ("LMS 1.csv" also
// works). Ignore the 'Cash In Hand' tab. Export dates as DD/MM/YYYY or YYYY-MM-DD (--date-format MDY if the export
// is US-style). "Sheet row" in the review file = the row in the tab (header = row 1), which is also the CSV line.
// --review: CSV with columns Campus, Sheet row, Proposed category, Your correction (others ignored); a correction
//   overrides the proposal; only 'Not on this List' rows use it.
// --actual: JSON {"LMS1": <rupees counted in the cash box on --to>, ...}; a number is adjusted in the fee bucket, or give
//   {"LMS1": {"fee": n, "other": n}} to adjust each bucket separately. Negative or non-numeric figures are an error.
// Output per campus: <out>/<campus>/opening-2026-27.csv (zero opening), daybook.csv and meta.json {from,to}; <out>/report.txt.
// Row ids are built from the row's content (not its Sheet row number), so re-running after the Sheet is re-sorted gives
// the same ids. Rows already loaded are corrected only by reversal: a re-run never edits them.
// Load with officeImportFromDrive (apps-script/office-import.gs). Real data stays OUTSIDE the repo.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { parseRupeesToPaise } from '../office/js/format.js';
import { parseCsv, toCsv } from './office-import-daybook.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const gs = vm.createContext({});
for (const f of ['office-store', 'office-config', 'office-daybook']) vm.runInContext(readFileSync(join(here, '..', 'apps-script', f + '.gs'), 'utf8'), gs, { filename: f + '.gs' });
const balances = (opening, rows, date) => JSON.parse(JSON.stringify(gs.officeBalances_(opening, rows, date)));
const tableCols = (t) => JSON.parse(JSON.stringify(gs.OFFICE_TABLES[t]));
export const DAYBOOK_COLS = [...tableCols('DayBook'), ...(tableCols('DayBook').includes('collection') ? [] : ['collection'])];
const OPENING_COLS = tableCols('Opening').slice(0, 7); // the original Opening columns, as the v1 importer
const CATS = Object.fromEntries(JSON.parse(JSON.stringify(gs.OFFICE_CATEGORIES)).map((c) => [c.id, c]));
// Ids the Day Book v2 branch adds (not all exist in office-config.gs on this branch).
for (const [id, direction] of [['construction_works', 'OUT'], ['student_collection_paid', 'OUT'], ['cash_received', 'IN'], ['transport_legacy', 'OUT'], ['import_adjustment_in', 'IN'], ['import_adjustment_out', 'OUT']]) CATS[id] = CATS[id] || { id, direction, group: 'school' };

const CAMPUSES = ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6'];
const bucketOf = (category) => (category === 'fee_collection' || category === 'deposit_cash_out' ? 'fee' : 'other'); // fee receipts and what is deposited from them; the rest is 'other' (balances sum all buckets)
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/\s*\/\s*/g, '/');
const head = (s) => norm(s).replace(/[^a-z0-9]/g, '');
const campusId = (s) => { const m = /^lms\s*([1-6])$/i.exec(String(s).trim()); return m ? 'LMS' + m[1] : /^hes$/i.test(String(s).trim()) ? 'HES' : null; };

// Sheet category (normalised) -> {IN, OUT, any}; 'contra' = cash out + paired bank in.
const RULES = {};
const rule = (names, r) => names.forEach((n) => { RULES[norm(n)] = r; });
rule(['Fee Received'], { IN: 'fee_collection', OUT: 'contra' });
rule(['Fee Online'], { IN: 'fee_online', OUT: 'contra' });
rule(['Fee Cheque'], { IN: 'fee_cheque', OUT: 'contra' });
rule(['Bank Deposit'], { OUT: 'contra' });
rule(['Cash in Hand'], { OUT: 'cash_transfer', IN: 'cash_received' });
rule(['Activity at School'], { OUT: 'activities_events', IN: 'student_collection' });
rule(['Scholastic Books'], { IN: 'student_collection' });
rule(['Reverse Entry'], { IN: 'other_in' });
rule(['Transportation', 'Parking Fees (Transport)', 'Vehicle Fuel'], { any: 'transport_legacy' });
rule(['Snacks & Eatables', 'Pantry'], { any: 'snacks_pantry' });
rule(['Personal'], { any: 'chairman_personal' });
rule(['Office Stationary'], { any: 'stationery' });
rule(['Office Expenses'], { any: 'other_out' });
rule(['Electrical Appliances'], { any: 'repairs_hardware' });
rule(['Construction Hardware'], { any: 'construction_works' });
rule(['Decoration/ Festival Celebrations', 'Bouquet/ Gerden Related', 'Garden Expense', 'Flag Money'], { any: 'activities_events' });
rule(['Internet', 'Electricity Bills', 'Cylinder', 'Cable', 'Phone Bill', 'Mobile Bills', 'Newspapers'], { any: 'utilities' });
rule(['Security Refund'], { any: 'security_refund' });
rule(['Medicines & First Aid'], { any: 'medical_first_aid' });
rule(['Labour/ Manpower Wage'], { any: 'labour_wages' });
rule(['Salary'], { any: 'salary' }); // advance or wages by particulars
rule(['Not on this List'], { any: 'review' });

const COLLECTIONS = [['mun', 'MUN'], ['olympiads', 'SOF|OLYMPIAD'], ['field_trips', 'FIELD TRIP|TRIP'], ['senior_tour', 'TOUR'], ['id_cards', 'ID CARD|I CARD'],
  ['red_cross', 'RED CROSS'], ['scouts_guides', 'SCOUT'], ['board_registration', 'REGISTRATION'], ['certificates', 'NAME CORRECTION|DOB|CERTIFICATE'],
  ['annual_function', 'ANNUAL FUNCTION'], ['sports', 'SPORT|TOURNAMENT']].map(([id, re]) => [id, new RegExp(`\\b(?:${re})S?\\b`, 'i')]);
export const collectionOf = (particulars) => (COLLECTIONS.find(([, re]) => re.test(particulars)) || [''])[0];

// Date text -> ISO or null. ISO, ISO datetime, DD/MM/YYYY (or MM/DD with fmt MDY), DD-MM-YYYY, Excel serial.
export function parseDate(s, fmt = 'DMY') {
  const t = String(s ?? '').trim();
  let y, m, d, x;
  if ((x = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/.exec(t))) [, y, m, d] = x;
  else if ((x = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T].*)?$/.exec(t))) { y = x[3]; [m, d] = fmt === 'MDY' ? [x[1], x[2]] : [x[2], x[1]]; }
  else if (/^\d{5}(\.\d+)?$/.test(t)) return new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(t)) * 86400000).toISOString().slice(0, 10);
  else return null;
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const dt = new Date(iso + 'T00:00:00Z');
  return !isNaN(dt) && dt.toISOString().slice(0, 10) === iso ? iso : null;
}

const directionOf = (type) => { const t = norm(type); return /^rec/.test(t) ? 'IN' : /^(pai|pia)/.test(t) ? 'OUT' : null; };
const hash = (...parts) => createHash('sha256').update(parts.join('\u241f')).digest('hex').slice(0, 16);
const rupees = (p) => (p < 0 ? '-' : '') + Math.floor(Math.abs(p) / 100) + '.' + String(Math.abs(p) % 100).padStart(2, '0');

// review CSV text -> Map 'LMS1:12' -> {proposed, correction}
export function parseReview(text) {
  const [h, ...lines] = parseCsv(text);
  const ix = (re) => h.findIndex((c) => re.test(head(c)));
  const [ci, ri, pi, yi] = [ix(/^campus$/), ix(/^sheetrow$/), ix(/^proposedcategory$/), ix(/^yourcorrection$/)];
  if ([ci, ri, pi, yi].includes(-1)) throw new Error('review file needs columns Campus, Sheet row, Proposed category, Your correction');
  const map = new Map();
  for (const c of lines) {
    const campus = campusId(c[ci] ?? '');
    if (campus && /^\d+$/.test((c[ri] ?? '').trim())) map.set(`${campus}:${Number(c[ri])}`, { proposed: (c[pi] ?? '').trim(), correction: (c[yi] ?? '').trim() });
  }
  return map;
}

// Final category for one row: {id | contra:true, by, why?}. Fallback ids carry `why` for the report.
function categorise(sheetCat, other, dir, particulars, review) {
  const fallback = (why) => ({ id: dir === 'IN' ? 'other_in' : 'other_out', by: 'fallback', why });
  const rl = RULES[norm(sheetCat)];
  if (!rl) return fallback(`unknown Sheet category "${sheetCat}"`);
  let id = rl[dir] ?? rl.any, by = 'rule';
  if (id === 'contra') return { contra: true, by };
  if (id === undefined) return fallback(`no rule for ${sheetCat} (${dir})`);
  if (id === 'salary') id = /ADVANCE/i.test(particulars) ? 'salary_advance' : 'labour_wages';
  if (id === 'review') {
    if (!review) return fallback('Not on this List: not in the review file');
    const corrected = review.correction !== '';
    id = review.correction || review.proposed; by = corrected ? 'review-corrected' : 'review';
    if (!CATS[id]) return fallback(`review category "${id}" is not a category id`);
    if (id.startsWith('deposit_')) return fallback(`review category ${id} cannot be written alone`);
    if (CATS[id].group === 'transport' || CATS[id].needs_vehicle) id = 'transport_legacy';
    if (id === 'student_collection' && dir === 'OUT') id = 'student_collection_paid';
    if (id === 'student_collection_paid' && dir === 'IN') id = 'student_collection';
  }
  if (CATS[id].direction !== dir) return fallback(`${id} is ${CATS[id].direction}, row is ${dir}`);
  return { id, by };
}

const SOURCE_ROW = (cells, cols) => Object.fromEntries(Object.entries(cols).map(([k, i]) => [k, i < 0 ? '' : String(cells[i] ?? '').trim()]));

// One tab's CSV text -> {rows (DayBook objects), skipped, notes, mapCounts, fallbacks, bankLegs}
export function buildCampus(csvText, campus, o) {
  const [h, ...lines] = parseCsv(csvText);
  const find = (re) => h.findIndex((c) => re.test(head(c)));
  const cols = { stamp: find(/^timestamp$/), date: find(/^date$/) >= 0 ? find(/^date$/) : find(/^column1$/), type: find(/^typeoftransaction|^type/), bill: find(/^bill|^receipt/), cat: find(/^category$/),
    other: find(/^othercategory|^other/), school: find(/^school$/), part: find(/^particular/), amount: find(/^amount/) };
  for (const k of ['date', 'type', 'cat', 'amount']) if (cols[k] < 0) throw new Error(`${campus}: no ${k} column in the header`);
  const out = { rows: [], skipped: [], notes: [], mapCounts: {}, fallbacks: [], bankLegs: 0, ids: {} }, seen = {};
  lines.forEach((cells, i) => {
    if (cells.every((c) => c.trim() === '')) return;
    const n = i + 2, r = SOURCE_ROW(cells, cols), skip = (why) => out.skipped.push({ n, why });
    const date = parseDate(r.date, o.dateFormat);
    if (!date) return skip(`undated or unreadable date "${r.date}"`);
    if (date < o.from || date > o.to) return skip(`date ${date} outside ${o.from}..${o.to}`);
    const dir = directionOf(r.type);
    if (!dir) return skip(`unreadable type "${r.type}"`);
    const paise = parseRupeesToPaise(r.amount.replace(/\.0+$/, ''));
    if (paise === null) return skip(`non-positive or unreadable amount "${r.amount}"`);
    const cat = categorise(r.cat, r.other, dir, r.part, o.review.get(`${campus}:${n}`));
    const legacy = r.cat + (r.other ? ' / ' + r.other : '');
    const sch = r.school === '' ? campus : campusId(r.school);
    if (!sch) out.notes.push(`row ${n}: unknown School "${r.school}", charged to ${campus}`);
    const narration = (r.part + (r.bill && !/^[-.\s]*$/.test(r.bill) ? ' (' + r.bill + ')' : '')).trim();
    const base = {
      campus, entry_date: date, amount_paise: paise, payee: '', narration, file_id: '', reverses: '', created_at: o.at, created_by: 'import',
      vehicle: '', litres_ml: '', odometer_km: '', odometer_note: '', supplier_bill_no: '', settles_account: '', settles: '', source: 'sheet', legacy_category: legacy,
    };
    const h = hash(campus, r.stamp, date, r.type, paise, r.part, r.bill, r.cat, r.other), k = seen[h] = (seen[h] ?? -1) + 1;
    const id = `sheet-${campus}-${h}${k ? '-' + k : ''}`;
    out.ids[n] = id;
    const charged = (c) => (/^personal$/i.test(r.cat) || c === 'chairman_personal' ? 'CHAIRMAN' : sch || campus);
    const key = cat.contra ? 'deposit_cash_out + deposit_bank_in' : cat.id;
    out.mapCounts[`${r.cat} (${dir}) -> ${key}`] = (out.mapCounts[`${r.cat} (${dir}) -> ${key}`] || 0) + 1;
    if (cat.by === 'fallback') out.fallbacks.push(`row ${n}: ${cat.why}`);
    if (cat.contra) {
      const cs = charged('deposit_cash_out');
      out.rows.push({ ...base, id, direction: 'OUT', mode: 'cash', bucket: 'fee', category: 'deposit_cash_out', account: 'cash:' + campus, charged_to: cs, mapped_by: 'rule', collection: '' });
      out.rows.push({ ...base, id: id + '-bank', direction: 'IN', mode: 'bank', bucket: '', category: 'deposit_bank_in', account: 'bank:' + campus, charged_to: cs, mapped_by: 'rule', collection: '' });
      out.bankLegs++;
      return;
    }
    out.rows.push({ ...base, id, direction: dir, mode: 'cash', bucket: bucketOf(cat.id), category: cat.id, account: 'cash:' + campus, charged_to: charged(cat.id), mapped_by: cat.by,
      collection: cat.id.startsWith('student_collection') ? collectionOf(r.part) : '' });
  });
  return out;
}

const cashBuckets = (campus, rows, date) => balances({ cash: { petty: 0, fee: 0, other: 0 }, bank: 0, upi: 0 }, rows.filter((r) => r.account === 'cash:' + campus), date).closing.cash;
const cashClosing = (campus, rows, date) => { const c = cashBuckets(campus, rows, date); return c.petty + c.fee + c.other; };

// One --actual figure (rupees, number or text) -> paise. Zero is fine; negative, blank or non-numeric is an error.
function actualPaise(campus, v) {
  const t = typeof v === 'number' || typeof v === 'string' ? String(v).trim() : '';
  const p = /^0+(\.0*)?$/.test(t) ? 0 : parseRupeesToPaise(t);
  if (p === null || p === undefined) throw new Error(`${campus}: --actual figure ${JSON.stringify(v)} must be a number of rupees, zero or more`);
  return p;
}

// Whole import. sheets = {LMS1: csvText, ...}. Returns {campuses: {LMS1: {daybook, opening}}, report}.
export function buildImport(sheets, reviewText, actual, opts) {
  const o = { dateFormat: 'DMY', at: new Date().toISOString(), ...opts, review: reviewText ? parseReview(reviewText) : new Map() };
  const fy = `${o.from.slice(0, 4)}-${String((Number(o.from.slice(0, 4)) + 1) % 100).padStart(2, '0')}`;
  const res = { campuses: {}, report: '' }, rep = [`Day book Sheet import, FY ${fy}, ${o.from} to ${o.to}, run at ${o.at}`, 'Rows already loaded are corrected only by reversal: a re-run (same ids for same content) never edits them.', ''];
  for (const campus of CAMPUSES) {
    if (sheets[campus] === undefined) { rep.push(`${campus}: no tab file found, nothing imported`, ''); continue; }
    const b = buildCampus(sheets[campus], campus, o);
    const rows = b.rows;
    if (actual && actual[campus] !== undefined) {
      const v = actual[campus], obj = v && typeof v === 'object';
      if (obj && Object.keys(v).some((k) => k !== 'fee' && k !== 'other')) throw new Error(`${campus}: --actual takes a number or {"fee": n, "other": n}`);
      const want = obj ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, actualPaise(campus, x)])) : { fee: actualPaise(campus, v) };
      b.adjustment = 0;
      for (const bk of ['fee', 'other']) {
        if (want[bk] === undefined) continue;
        // a plain number counts the whole box: the fee bucket takes whatever the other bucket does not already hold
        const diff = want[bk] - cashBuckets(campus, rows, o.to)[bk] - (obj ? 0 : cashBuckets(campus, rows, o.to).other);
        b.adjustment += diff;
        if (diff) rows.push({ id: `sheet-${campus}-adjustment-${bk}`, campus, entry_date: o.to, direction: diff > 0 ? 'IN' : 'OUT', mode: 'cash', bucket: bk, category: diff > 0 ? 'import_adjustment_in' : 'import_adjustment_out',
          amount_paise: Math.abs(diff), payee: '', narration: `Sheet import adjustment to the counted cash in hand on ${o.to}`, file_id: '', reverses: '', created_at: o.at, created_by: 'import',
          account: 'cash:' + campus, charged_to: campus, vehicle: '', litres_ml: '', odometer_km: '', odometer_note: '', supplier_bill_no: '', settles_account: '', settles: '', source: 'sheet',
          legacy_category: '', mapped_by: 'rule', collection: '' });
      }
    }
    const z = (m, bk, a) => ({ id: `impopen-${campus}-${fy}-${m}${bk ? '-' + bk : ''}`, campus, mode: m, bucket: bk, amount_paise: a, created_at: o.at, created_by: 'import' });
    res.campuses[campus] = { daybook: toCsv(DAYBOOK_COLS, rows), opening: toCsv(OPENING_COLS, [z('cash', 'petty', 0), z('cash', 'fee', 0), z('cash', 'other', 0), z('bank', '', 0), z('upi', '', 0)]), rows, ids: b.ids };
    const cash = rows.filter((r) => r.account === 'cash:' + campus), sum = (d) => cash.filter((r) => r.direction === d).reduce((s, r) => s + r.amount_paise, 0);
    const noColl = rows.filter((r) => r.category.startsWith('student_collection') && !r.collection);
    rep.push(`== ${campus} ==`, `Rows imported: ${rows.length} (${cash.length} cash, ${b.bankLegs} paired bank legs${b.adjustment ? ', 1 adjustment' : ''}); skipped: ${b.skipped.length}`,
      `Cash in ${rupees(sum('IN'))}, cash out ${rupees(sum('OUT'))}, cash closing ${o.to}: ${rupees(cashClosing(campus, rows, o.to))}`,
      ...(actual && actual[campus] !== undefined ? [`Adjustment to counted cash: ${b.adjustment ? rupees(b.adjustment) : 'none (already equal)'} (${rows.filter((r) => r.id.includes('-adjustment-')).length} row(s))`] : ['No --actual for this campus: NO adjustment written']),
      'Category mapping:', ...Object.entries(b.mapCounts).sort().map(([k, v]) => `  ${v}  ${k}`),
      `Mapped by fallback (other_in/other_out): ${b.fallbacks.length}`, ...b.fallbacks.map((x) => '  ' + x),
      `Student collection rows with no collection keyword: ${noColl.length}`, ...noColl.map((r) => `  ${r.entry_date} ${rupees(r.amount_paise)} ${r.narration}`),
      ...(b.notes.length ? ['Notes:', ...b.notes.map((x) => '  ' + x)] : []),
      'Skipped rows:', ...b.skipped.map((s) => `  row ${s.n}: ${s.why}`), '');
  }
  res.report = rep.join('\n');
  return res;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2), opt = (n) => { const i = args.indexOf('--' + n); return i < 0 ? undefined : args[i + 1]; };
  const [dir, from, to, out] = ['sheet-dir', 'from', 'to', 'out'].map(opt);
  if (!dir || !from || !to || !out || !parseDate(from) || !parseDate(to) || from > to) {
    console.error('usage: node tools/office-import-sheet.mjs --sheet-dir <dir of per-tab CSVs> --review <review.csv> --from 2026-04-01 --to 2026-10-22 --actual <actual.json> --out <dir> [--date-format DMY|MDY] [--at <ISO>]');
    process.exit(2);
  }
  const sheets = {};
  for (const c of CAMPUSES) for (const name of [c, c.replace('LMS', 'LMS ')]) if (sheets[c] === undefined && existsSync(join(dir, name + '.csv'))) sheets[c] = readFileSync(join(dir, name + '.csv'), 'utf8');
  const r = buildImport(sheets, opt('review') && readFileSync(opt('review'), 'utf8'), opt('actual') && JSON.parse(readFileSync(opt('actual'), 'utf8')),
    { from, to, dateFormat: opt('date-format') || 'DMY', at: opt('at') || new Date().toISOString() });
  mkdirSync(out, { recursive: true });
  const fy = `${from.slice(0, 4)}-${String((Number(from.slice(0, 4)) + 1) % 100).padStart(2, '0')}`;
  for (const [c, f] of Object.entries(r.campuses)) {
    mkdirSync(join(out, c), { recursive: true });
    writeFileSync(join(out, c, `opening-${fy}.csv`), f.opening);
    writeFileSync(join(out, c, 'daybook.csv'), f.daybook);
    writeFileSync(join(out, c, 'meta.json'), JSON.stringify({ from, to }));
  }
  writeFileSync(join(out, 'report.txt'), r.report);
  process.stdout.write(r.report);
}
