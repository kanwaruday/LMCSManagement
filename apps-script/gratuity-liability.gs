// ═══════════════════════════════════════════════════════════════════
// GRATUITY-LIABILITY -- "what would we owe if every active employee left
// today" (2026-09-29, per Uday), the backlog the gratuity fund has to
// cover before the 5%-a-month provision keeps it level.
//
// Writes/overwrites a "Gratuity Liability" tab in LMCS-Salary-PayScale
// (Uday's own Owner-only workbook) -- no Web App route, no UI. Run
// writeGratuityLiability from the editor (or re-run any time; it's a
// snapshot as of the run date).
//
// Formula (Payment of Gratuity Act): 15/26 × monthly (Basic + DA) ×
// years of service, a final part-year of 6+ months counting as a full
// year, capped at ₹20,00,000. Legally payable only after 5 years --
// "Payable Today" is that vested subset; "Accrued" is everyone, which
// is what the fund actually has to grow toward.
//
// Basic/DA are derived exactly the way salary/index.html's existing-
// employee flow derives "what her present salary must be": PayScale
// Table (Pre-Basic + Grade Pay) × (1 + Annual Increment %)^Increment ×
// WorkingHour/Ideal Hours, DA from PayRoll Rates by campus. ADA is
// EXCLUDED: by law gratuity wages are Basic + DA only (EPF, by contrast,
// does include ADA) -- confirmed by Uday 2026-09-29.
// ═══════════════════════════════════════════════════════════════════

const GRAT_TAB = 'Gratuity Liability';
const GRAT_CAP = 2000000;
const GRAT_PROVISION_RATE = 0.05; // per Uday -- 15/26/12 = 4.81%, rounded up

// Completed years for gratuity: whole years, +1 if the leftover is 6+ months.
function gratServiceMonths_(doj, asOf) {
  let m = (asOf.getFullYear() - doj.getFullYear()) * 12 + (asOf.getMonth() - doj.getMonth());
  if (asOf.getDate() < doj.getDate()) m--;
  return Math.max(0, m);
}
function gratYears_(months) {
  return Math.floor(months / 12) + (months % 12 >= 6 ? 1 : 0);
}
function gratAmount_(wages, years) {
  return Math.min(GRAT_CAP, Math.round(15 / 26 * wages * years));
}

function gratNum_(v) {
  if (typeof v === 'number') return v;
  const cleaned = String(v || '').replace(/[^0-9.-]/g, '');
  return cleaned ? Number(cleaned) : 0;
}

function writeGratuityLiability() {
  const asOf = new Date();
  const ps = SpreadsheetApp.openById(SALPS_SHEET_ID);

  // PayScale Table -- header found by content, same as syncJobRoleNorms_.
  const psValues = ps.getSheetByName(SALPS_TAB_PAYSCALE).getDataRange().getValues();
  let hdr = psValues.findIndex(function (r) { return String(r[0]).trim() === 'Role Code' && String(r[1]).trim() === 'Designation'; });
  if (hdr === -1) throw new Error('PayScale Table header row not found');
  const scale = {};
  for (let i = hdr + 1; i < psValues.length; i++) {
    const d = String(psValues[i][1] || '').trim();
    if (d) scale[d] = { pre: gratNum_(psValues[i][2]), gp: gratNum_(psValues[i][3]), ideal: gratNum_(psValues[i][4]) || 8 };
  }
  const rates = {};
  ps.getSheetByName('PayRoll Rates').getDataRange().getValues().slice(1).forEach(function (r) {
    const c = String(r[0] || '').replace(/\s+/g, '').toUpperCase();
    if (c) rates[c] = gratNum_(r[1]) / 100;
  });
  const consts = {};
  ps.getSheetByName('PayRoll Constants').getDataRange().getValues().slice(1).forEach(function (r) {
    if (r[0]) consts[String(r[0]).trim()] = gratNum_(r[1]);
  });
  const incRate = 1 + (consts['Annual Increment %'] || 3) / 100;

  const emp = openEmpWorkbook_();
  const sal = emp.getSheetByName('EmpSalary').getDataRange().getValues();
  const sIdx = {}; sal[0].forEach(function (h, i) { sIdx[h] = i; });
  const salByCode = {};
  sal.slice(1).forEach(function (r) { const c = String(r[sIdx.EmployeeCode] || '').trim(); if (c) salByCode[c] = r; });

  const master = emp.getSheetByName('EmpMaster').getDataRange().getValues();
  const mIdx = {}; master[0].forEach(function (h, i) { mIdx[h] = i; });

  const out = [];
  for (let i = 1; i < master.length; i++) {
    const m = master[i];
    const code = String(m[mIdx.EmployeeCode] || '').trim();
    if (!code) continue;
    const status = (mIdx.Status >= 0 ? String(m[mIdx.Status] || '').trim() : '') || 'Active';
    if (status !== 'Active') continue; // Inactive/Transferred -- a transfer's new row carries the original DOJ
    const school = String(m[mIdx.SchoolCode] || '').trim().toUpperCase();
    const s = salByCode[code] || [];
    const desig = String(s[sIdx.Designation] || '').trim();
    const notes = [];

    const sc = scale[desig];
    let nb;
    if (sc) {
      const wh = gratNum_(s[sIdx.WorkingHour]) || sc.ideal;
      nb = Math.floor((sc.pre + sc.gp) * Math.pow(incRate, gratNum_(s[sIdx.Increment])) * (wh / sc.ideal));
    } else {
      nb = gratNum_(s[sIdx.Basic]) + gratNum_(s[sIdx.GradePay]);
      notes.push('no PayScale match for "' + desig + '" -- raw Basic+GP used');
    }
    if (rates[school] === undefined) notes.push('no PayRoll Rates row for ' + school + ' -- default DA 5%');
    const da = Math.floor((rates[school] === undefined ? 0.05 : rates[school]) * nb);

    const doj = m[mIdx.DateOfJoining];
    const hasDoj = doj instanceof Date && !isNaN(doj.getTime());
    if (!hasDoj) notes.push('no Date of Joining');
    const months = hasDoj ? gratServiceMonths_(doj, asOf) : 0;
    const years = gratYears_(months);
    const accrued = gratAmount_(nb + da, years);
    const vested = months >= 60;

    out.push([code, String(m[mIdx.Name] || '').trim(), school, desig,
      hasDoj ? doj : '', Math.floor(months / 12) + 'y ' + (months % 12) + 'm', years,
      nb, da, nb + da, accrued, vested ? 'Yes' : 'No', vested ? accrued : 0,
      Math.round((nb + da) * GRAT_PROVISION_RATE), notes.join('; ')]);
  }

  const header = ['Employee Code', 'Name', 'School', 'Designation', 'Date of Joining', 'Service', 'Gratuity Years',
    'Basic', 'DA', 'Basic + DA', 'Accrued Gratuity', 'Vested (5+ yrs)', 'Payable Today',
    'Monthly Provision (5%)', 'Notes'];
  const sum = function (col) { return out.reduce(function (a, r) { return a + (Number(r[col]) || 0); }, 0); };
  const total = ['TOTAL (' + out.length + ' active)', '', '', '', '', '', '', sum(7), sum(8), sum(9), sum(10), '', sum(12), sum(13), ''];

  let sheet = ps.getSheetByName(GRAT_TAB) || ps.insertSheet(GRAT_TAB);
  sheet.clear();
  sheet.getRange(1, 1).setValue('Gratuity liability as of ' + Utilities.formatDate(asOf, 'Asia/Kolkata', 'dd MMM yyyy') +
    ' -- 15/26 × (Basic+DA) × years, cap ₹20L. Generated by writeGratuityLiability; re-run to refresh, edits here are overwritten.');
  sheet.getRange(3, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  if (out.length) {
    sheet.getRange(4, 1, out.length, header.length).setValues(out);
    sheet.getRange(4, 5, out.length, 1).setNumberFormat('dd-mm-yyyy');
  }
  sheet.getRange(4 + out.length, 1, 1, header.length).setValues([total]).setFontWeight('bold');
  sheet.getRange(4, 8, out.length + 1, 7).setNumberFormat('#,##0');
  sheet.setFrozenRows(3);
  Logger.log('Gratuity Liability: ' + out.length + ' active employees, accrued ₹' + total[10] + ', payable today ₹' + total[12] + ', monthly provision ₹' + total[13]);
}

// Run from the editor to check the formula; throws on any mismatch.
function gratuitySelfTest_() {
  const d = function (s) { return new Date(s + 'T00:00:00'); };
  const eq = function (a, b, msg) { if (a !== b) throw new Error(msg + ': expected ' + b + ', got ' + a); };
  eq(gratServiceMonths_(d('2020-04-15'), d('2026-09-14')), 76, 'one day short of 77 months');
  eq(gratServiceMonths_(d('2020-04-15'), d('2026-09-15')), 77, 'exactly 77 months');
  eq(gratYears_(77), 6, '6y 5m -> 6');
  eq(gratYears_(78), 7, '6y 6m rounds up -> 7');
  eq(gratAmount_(26000, 10), 150000, '15/26 × 26000 × 10');
  eq(gratAmount_(1000000, 40), GRAT_CAP, 'capped at 20L');
  Logger.log('gratuitySelfTest_ passed');
}
