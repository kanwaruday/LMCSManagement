// ═══════════════════════════════════════════════════════════════════
// SALARY -- Salary Dashboard v1: offer-letter/new-hire calculator only
// (not monthly payroll/incentives/leave -- see the design conversation
// this was built in). The calculation FORMULA itself still runs
// client-side in salary/index.html (same as the old lmcs-salary-dashboard
// repo's dashboard.html did) -- but every rate/table it feeds on is read
// live from the "LMCS-Salary-PayScale" Google Sheet (Uday's own workbook,
// built 2026-09-28) via salaryConfig_() below, instead of being hardcoded
// in JS. Editing that sheet takes effect immediately, no redeploy.
//
// Two actions (GET, wired in main.gs's doGet):
//   salaryepfexemptionstatus -- per-candidate EPF exemption approval check
//   salaryconfig             -- the whole pay-scale/rates/constants bundle
// ═══════════════════════════════════════════════════════════════════

// "LMCS-Salary-PayScale" -- Uday's own workbook, 5 tabs, built 2026-09-28
// as a live replacement for what was originally a hardcoded JS table
// ported from the old lmcs-salary-dashboard repo. Read-only from this
// project's side; Uday edits the sheet directly, no admin UI needed.
const SAL_CONFIG_SHEET_ID = '1d8MdOgXNM5KVJjLwejAKpbbDaINnvPZO6zX_E5xABYU';
const SAL_TAB_PAYSCALE = 'PayScale Table';
const SAL_TAB_JOBROLE_NORMS = 'JobRole Norms';
const SAL_TAB_TUITION_FEES = 'Tuition Fees';
const SAL_TAB_PAYROLL_RATES = 'PayRoll Rates';
const SAL_TAB_PAYROLL_CONSTANTS = 'PayRoll Constants';
const SAL_CONFIG_CACHE_SECONDS = 300; // same TTL as pdrAllowlistRows_ -- config rarely changes mid-session

// 2026-09-29 -- memoized within one execution (a plain global, reset
// fresh each request the same way every other var here is): salaryConfig_
// calls all 5 tab-readers below in one request, and on a cold cache
// (nothing in CacheService yet, e.g. first load after the 5-minute TTL)
// each one was calling SpreadsheetApp.openById() separately -- 5 real
// opens of the SAME spreadsheet for one page load, a real chunk of "this
// is slow" latency. Opening it once and reusing the handle for every tab
// read doesn't change what's cached (each tab still has its own
// CacheService entry/TTL below), just removes the redundant re-opens on
// a miss.
let salSpreadsheet_ = null;
function salConfigValues_(tabName) {
  if (!salSpreadsheet_) salSpreadsheet_ = SpreadsheetApp.openById(SAL_CONFIG_SHEET_ID);
  const sheet = salSpreadsheet_.getSheetByName(tabName);
  if (!sheet) throw new Error('Sheet tab not found: ' + tabName);
  return sheet.getDataRange().getValues();
}

// "LMS 1" / "lms1" / " LMS 6 " -> "LMS1" -- normalizes the sheet's
// school-name spelling (with a space) to this portal's campusId
// convention (no space) used everywhere else (hiring.gs, approvals.gs,
// assets/auth.js). HES has no campusId equivalent in this portal (only
// LMS1-6 are real campuses here) -- rows for it just end up under a key
// nothing ever looks up, harmless.
function salNormalizeCampus_(raw) {
  return String(raw || '').replace(/\s+/g, '').toUpperCase();
}

// PayScale Table: title/subtitle/blank rows above a header row, then
// data. 2026-09-28 -- was hardcoded as "header always row 4, data always
// row 5" until a stray edit (something typed into the title cell while
// it was mid-edit) silently shifted the real header down a row and broke
// every Designation lookup in the app with no error anywhere -- the
// title/subtitle rows above the header aren't load-bearing structure,
// they're just decoration a human can accidentally disturb, so trusting
// a fixed offset into them was the actual bug. Now finds the header row
// by CONTENT (column A === 'Role Code', column B === 'Designation') and
// reads data starting the row after, however many decoration rows came
// before it -- immune to this whole class of accident. Throws a clear
// error instead of silently returning nothing if the header can't be
// found at all (e.g. both header cells got wiped, not just shifted).
// 2026-09-28 -- the ACTUAL root cause of Pre-Basic Pay/Grade Pay always
// coming through as 0: Number("10,300") is NaN in JavaScript (the comma
// breaks it), and `NaN || 0` silently becomes 0 with no error anywhere.
// Ideal Hours (single digits, e.g. "6") happened to keep working, which
// is what made this look like a row-matching problem instead of what it
// actually was. Strips any non-numeric formatting (₹, commas, spaces)
// before parsing -- works whether the cell holds a real number, a
// formatted-currency number, or literal currency text.
function salParseNumber_(v) {
  if (typeof v === 'number') return v;
  const cleaned = String(v || '').replace(/[^0-9.-]/g, '');
  return cleaned ? Number(cleaned) : 0;
}
function salPayScaleHeaderRow_(values) {
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === 'Role Code' && String(values[i][1] || '').trim() === 'Designation') return i;
  }
  return -1;
}
function salPayScale_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('sal_payscale');
  if (cached) return JSON.parse(cached);
  const values = salConfigValues_(SAL_TAB_PAYSCALE);
  const headerRow = salPayScaleHeaderRow_(values);
  if (headerRow === -1) throw new Error('PayScale Table: could not find the header row (looking for "Role Code"/"Designation" in columns A/B) -- sheet structure may have changed');
  const out = [];
  for (let i = headerRow + 1; i < values.length; i++) {
    const r = values[i];
    if (!String(r[1] || '').trim()) continue; // blank Designation -- notes row or trailing blank
    out.push({
      roleCode: String(r[0] || '').trim().toUpperCase(),
      designation: String(r[1]).trim(),
      preBasic: salParseNumber_(r[2]),
      gradePay: salParseNumber_(r[3]),
      idealHours: salParseNumber_(r[4]) || 8,
      classification: String(r[5] || ''),
      esBand: String(r[6] || ''),
    });
  }
  cache.put('sal_payscale', JSON.stringify(out), SAL_CONFIG_CACHE_SECONDS);
  return out;
}

// JobRole Norms: header row1, data from row2. Reference info only (leave/
// timing/travel policy) -- doesn't feed the salary formula itself, RRF
// Policy is shown here per-role but its actual numbers live in PayRoll
// Constants (RRF Y1/Y2/Y3 %) since every role's policy reads the same.
function salJobRoleNorms_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('sal_jobrolenorms');
  if (cached) return JSON.parse(cached);
  const values = salConfigValues_(SAL_TAB_JOBROLE_NORMS);
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!String(r[0] || '').trim()) continue;
    out.push({
      designation: String(r[0]).trim(), vacations: String(r[1] || ''),
      casualLeave: String(r[2] || ''), timing: String(r[3] || ''),
      travelAllowance: String(r[4] || ''), rrfPolicy: String(r[5] || ''),
    });
  }
  cache.put('sal_jobrolenorms', JSON.stringify(out), SAL_CONFIG_CACHE_SECONDS);
  return out;
}

// Tuition Fees: header row1 has grade labels (M1/M2/M3/C1-C10/C11-Sci/
// C11-Com/C11-Hum/C12-Sci/C12-Com/C12-Hum) from column B onward -- read
// directly from the header rather than hardcoded, so a sheet column
// added/renamed later (e.g. a new stream) shows up without a code change.
// Shape: { campusId: { gradeLabel: feeNumber } }.
function salTuitionFees_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('sal_tuitionfees');
  if (cached) return JSON.parse(cached);
  const values = salConfigValues_(SAL_TAB_TUITION_FEES);
  const header = values[0];
  const out = {};
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const campusId = salNormalizeCampus_(r[0]);
    if (!campusId) continue;
    const grades = {};
    for (let c = 1; c < header.length; c++) {
      const label = String(header[c] || '').trim();
      if (!label || r[c] === '' || r[c] == null) continue;
      grades[label] = salParseNumber_(r[c]);
    }
    out[campusId] = grades;
  }
  cache.put('sal_tuitionfees', JSON.stringify(out), SAL_CONFIG_CACHE_SECONDS);
  return out;
}

// PayRoll Rates: School, DA %, ADA %, EPF Enrolled by Default (Yes/No).
// Shape: { campusId: { da, ada, epfDefault } } -- da/ada stored as
// fractions (5 -> 0.05) to match what calcSalary_ multiplies by directly.
function salPayrollRates_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('sal_payrollrates');
  if (cached) return JSON.parse(cached);
  const values = salConfigValues_(SAL_TAB_PAYROLL_RATES);
  const out = {};
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const campusId = salNormalizeCampus_(r[0]);
    if (!campusId) continue;
    out[campusId] = {
      da: salParseNumber_(r[1]) / 100,
      ada: salParseNumber_(r[2]) / 100,
      epfDefault: !/^n/i.test(String(r[3] || '').trim()), // 'N' or 'No' (sheet switched to Y/N 2026-09-29)
    };
  }
  cache.put('sal_payrollrates', JSON.stringify(out), SAL_CONFIG_CACHE_SECONDS);
  return out;
}

// PayRoll Constants: Setting/Value two-column table -- returned as a
// plain {Setting: Value} map, keyed EXACTLY as the sheet spells it
// (salary/index.html reads by those same literal strings), so a renamed
// setting is a visible key miss on the frontend rather than a silent
// wrong number.
function salPayrollConstants_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('sal_payrollconstants');
  if (cached) return JSON.parse(cached);
  const values = salConfigValues_(SAL_TAB_PAYROLL_CONSTANTS);
  const out = {};
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const key = String(r[0] || '').trim();
    if (!key) continue;
    out[key] = salParseNumber_(r[1]);
  }
  cache.put('sal_payrollconstants', JSON.stringify(out), SAL_CONFIG_CACHE_SECONDS);
  return out;
}

function salaryConfig_() {
  return {
    success: true,
    payScale: salPayScale_(),
    jobRoleNorms: salJobRoleNorms_(),
    tuitionFees: salTuitionFees_(),
    payrollRates: salPayrollRates_(),
    constants: salPayrollConstants_(),
  };
}

// TEMPORARY diagnostic (2026-09-28) -- see main.gs's action=diagpayscale
// comment for how to trigger this from the browser. Checks whether
// PayScale Table's Pre-Basic Pay/Grade Pay cells are real numbers (what
// Number(cell) needs) or literal currency-symbol text (which Number()
// can't parse, silently becoming 0 via `Number(x) || 0`). Bypasses the
// cache so it always reflects the sheet's current state, not a stale
// cached parse from before a sheet fix. Remove once confirmed fixed.
function salDiagnosePayScale_() {
  const values = salConfigValues_(SAL_TAB_PAYSCALE);
  const headerRow = salPayScaleHeaderRow_(values);
  const pgtRowIdx = values.findIndex(function (r) { return String(r[1] || '').trim() === 'PGT'; });
  const pgtRow = pgtRowIdx >= 0 ? values[pgtRowIdx] : null;
  return {
    success: true,
    headerRowIndex: headerRow,
    headerRowContent: headerRow >= 0 ? values[headerRow] : null,
    pgtRowIndex: pgtRowIdx,
    pgtRowRaw: pgtRow,
    preBasicCell: pgtRow ? { typeofValue: typeof pgtRow[2], rawValue: pgtRow[2], numberOfIt: Number(pgtRow[2]) } : null,
    gradePayCell: pgtRow ? { typeofValue: typeof pgtRow[3], rawValue: pgtRow[3], numberOfIt: Number(pgtRow[3]) } : null,
  };
}

// Same free-text matching convention hirApprovedRequisitions_ (hiring.gs)
// already uses against the Approvals sheet's itemName column -- there is
// no per-instance foreign key on that sheet (confirmed when this was
// designed), so "is THIS candidate's exemption approved" is answered by
// scanning for an Approved 'EPF Exemption' row whose itemName/title
// contains their name, same as Hiring Dashboard already does for
// requisitions and hiring decisions.
function salEpfExemptionApproved_(candidateName) {
  const name = String(candidateName || '').trim().toLowerCase();
  if (!name) return false;
  const values = aprValues_();
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (String(row[2]) !== 'EPF Exemption') continue;
    if (String(row[13]) !== APR_STATUS.APPROVED) continue;
    const itemName = String(row[7] || '').toLowerCase();
    const title = String(row[4] || '').toLowerCase();
    if (itemName.indexOf(name) !== -1 || title.indexOf(name) !== -1) return true;
  }
  return false;
}
