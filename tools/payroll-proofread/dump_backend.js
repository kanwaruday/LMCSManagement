// Runs the REAL backend (apps-script/payroll.gs + payroll-calc.gs) over a JSON dataset and prints every
// employee's computed row. Used by verify.py to prove the workbook formulas equal the backend.
const fs = require('fs'), path = require('path');
const { boot } = require(path.join(__dirname, '..', '..', 'tests', 'payroll', 'harness'));
const { buildFixture } = require(path.join(__dirname, '..', '..', 'tests', 'payroll', 'fixtures'));
const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const conv = (v) => v; // date markers {d:'YYYY-MM-DD'} are swapped for in-VM Dates after boot (see below)
const fx = buildFixture();
const H = input.headers;
for (const tab of ['Salary Master', 'Monthly Inputs', 'Adjustments', 'Ledger', 'Loans']) fx.books['1sal'][tab] = [H[tab]].concat(input.data[tab].map((r) => r.map(conv)));
fx.books['1d8']['PayRoll Constants'] = [H['PayRoll Constants']].concat(input.data['PayRoll Constants']);
fx.books['1d8']['PayRoll Rates'] = [H['PayRoll Rates']].concat(input.data['PayRoll Rates']);
const h = boot(fx);
// The backend runs inside a vm context, so `x instanceof Date` is false for a Date made out here --
// build every date marker with the context's own Date, as Apps Script would hand them over.
for (const book of Object.values(h.books)) for (const tab of Object.values(book.tabs)) tab.values.forEach((row) => row.forEach((v, i) => {
  if (v && typeof v === 'object' && v.d) row[i] = h.run('new Date(' + Number(v.d.slice(0, 4)) + ',' + (Number(v.d.slice(5, 7)) - 1) + ',' + Number(v.d.slice(8, 10)) + ')');
}));
const out = {};
for (const month of input.months) {
  const res = h.call('month', { month });
  if (!res.success) { console.error('backend error', res.error); process.exit(2); }
  out[month] = {};
  res.rows.forEach((r) => { out[month][r.code] = r; });
}
fs.writeFileSync(process.argv[3], JSON.stringify(out));
