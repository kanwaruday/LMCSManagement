// ═══════════════════════════════════════════════════════════════════
// PAYROLL -- "LMCS Payroll Backend", its OWN Apps Script project and
// deployment (2026-09-29, per Uday: payroll is money data, split out of
// the PDR project as planned in the Salary Dashboard design). Two files:
// this one (routing, auth, sheet I/O) and payroll-calc.gs (the formula).
//
// Owner-only on every action: verified Google ID token -> allowlist ->
// role must include Owner. Same token check as staff-management-api.gs's
// verifyStaffManagerToken_ (separate project, so its own copy).
//
// Data:
//   "LMCS Payroll" sheet (PAY_SHEET_ID) -- tabs AND any newly added columns
//     are created with their headers on first use (payEnsureTabs_). All
//     reads/writes go by header text, never by column position.
//   "LMCS-Salary-PayScale" (PAY_RATES_SHEET_ID) -- PayRoll Rates (per-
//     entity DA/ADA % + EPF/ESI registration) and PayRoll Constants,
//     shared with the Salary Dashboard so both read the same rates.
//
// The page is a month CHECKLIST (2026-09-30 redesign, per Uday): staff
// changes, leave & paid days, adjustments, holds, review, lock -- scoped to
// all schools or one. Every action returns the full month (payMonth_).
//
// Actions (GET: month; everything else POST):
//   month          -- the month for every school: open schools computed live,
//                     locked schools read back from Payroll Register
//   saveinputs     -- upsert paid days / CL days encashed / hold / release
//   addadjustment, deleteadjustment -- one-off earning/deduction line items
//   markstep       -- tick (or untick) a checklist step for a school or ALL
//   lock           -- one school or ALL: Register + Run Log + Ledger, read-only after
//
// DEPLOY: Deploy -> New deployment -> Web app, Execute as: Me, Who has
// access: Anyone (every call is still token-checked). Paste the /exec
// URL into PAYROLL_BACKEND_URL in payroll/index.html.
// ═══════════════════════════════════════════════════════════════════

const PAY_SHEET_ID = '1sal-zeXPZazN2ASqF7CchfJo-tF9_-Q80zcZtXbNwY8';        // "LMCS Payroll"
const PAY_RATES_SHEET_ID = '1d8MdOgXNM5KVJjLwejAKpbbDaINnvPZO6zX_E5xABYU';  // "LMCS-Salary-PayScale"
const PAY_ALLOWLIST_SHEET_ID = '1NZu0ElismFytG395Nxjz29vAz7OfkmJtZhs70bOwT58'; // "LMCS Principal Allowlist"
const PAY_GOOGLE_CLIENT_ID = '697999989724-mvi85iobr20g4mm8a8nrjd1rms2o8tf6.apps.googleusercontent.com';
const PAY_TZ = 'Asia/Kolkata';
const PAY_ENTITIES = ['HES', 'LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6'];

// Columns appended to an existing tab keep working (payEnsureTabs_ adds any
// header missing from a live sheet at the end), so order only matters for new tabs.
const PAY_TABS = {
  'Salary Master': ['Employee Code', 'Name', 'Entity', 'Designation', 'Date of Joining', 'Effective From', 'Full Basic',
    'EPF Member (Y/N)', 'RRF Member (Y/N)', 'Staff-Child Tuition', 'Pay Mode', 'Bank Account No', 'IFSC', 'UAN', 'PAN',
    'Status (Active/Left)', 'Remarks'],
  // Other Earnings/Deductions columns are from Stage 2 and no longer used --
  // one-offs live in the Adjustments tab (2026-09-30).
  'Monthly Inputs': ['Month', 'Employee Code', 'Paid Days', 'CL Days Encashed', 'Hold for F&F (Y/N)', 'Other Earnings',
    'Other Earnings Note', 'Other Deductions', 'Other Deductions Note', 'Updated By', 'Updated At',
    'Hold (F&F/Grievance)', 'Release Held (₹)'],
  'Adjustments': ['ID', 'Month', 'Employee Code', 'Type', 'Direction', 'Amount', 'Note', 'Added By', 'Added At'],
  'Payroll Register': ['Month', 'Employee Code', 'Name', 'Entity', 'Designation', 'Paid Days', 'Month Basic', 'ADA', 'DA',
    'CL Encashment', 'Tuition (A)', 'Other Earnings', 'Gross', 'EPF Employee', 'ESI Employee', 'RRF Rate', 'RRF',
    'Tuition (D)', 'Other Deductions', 'Total Deductions', 'Net Pay', 'Bank Payable', 'Held for F&F', 'EPF Employer',
    'ESI Employer', 'CTI', 'Gratuity Provision', 'Locked At', 'Locked By', 'Withheld (Grievance)', 'Released Held'],
  'Run Log': ['Month', 'Entity', 'Status (Draft/Locked)', 'Headcount', 'Gross', 'Net Pay', 'CTI', 'Settings Snapshot',
    'Locked By', 'Locked At', 'Notes'],
  'Checklist': ['Month', 'Entity', 'Step', 'Done By', 'Done At'],
  'Ledger': ['Date', 'Month', 'Employee Code', 'Account (RRF/Security/Loan/Held Salary)',
    'Type (Opening/Deduction/Payout/Loan Issued/Loan Repaid/Adjustment)', 'Amount', 'Reference', 'Notes', 'Entered By', 'Entered At'],
  'Tally Ledger Map': ['Entity', 'Payroll Head', 'Tally Ledger Name', 'Cost Centre', 'Dr/Cr'],
  'ERP Reference': ['Month', 'Employee Code', 'ERP Gross', 'ERP EPF', 'ERP ESI', 'ERP RRF', 'ERP Net Pay', 'ERP CTI'],
};

// Payroll-only settings, appended to PayRoll Constants if missing.
const PAY_NEW_CONSTANTS = [['RRF Target Months', 3], ['RRF Stop At Target (1=Yes)', 0],
  ['Gratuity Provision %', 5], ['CL Encashment Divisor', 30]];

// Adjustment line-item types (Uday, 2026-09-30) -> Earning / Deduction.
const PAY_ADJ_TYPES = {
  'Arrears': 'Earning', 'Admission Incentive': 'Earning', 'Performance Bonus': 'Earning', 'Travel Allowance': 'Earning',
  'Notice Pay': 'Earning', 'Other Earning': 'Earning',
  'Advance / Loan Recovery': 'Deduction', 'Fine': 'Deduction', 'Notice Period Recovery': 'Deduction', 'Other Deduction': 'Deduction',
};

// Checklist steps that must be ticked for a school before it can be locked.
// 'staff' joins this list when Staff Changes is built (stage c).
const PAY_STEPS = ['leave', 'adjustments', 'holds', 'review'];

const PAY_READ_ACTIONS_ = ['month', 'draft'];

function doGet(e) {
  return payHandle_(e.parameter.action, e.parameter.idToken, e.parameter.data ? JSON.parse(e.parameter.data) : {});
}

// Writes come as POST -- a month of inputs is too long for a URL.
function doPost(e) {
  const body = JSON.parse((e.postData && e.postData.contents) || '{}');
  return payHandle_(body.action, body.idToken, body.data || {});
}

function payHandle_(action, idToken, data) {
  try {
    action = String(action || '').toLowerCase();
    const caller = PAY_READ_ACTIONS_.indexOf(action) !== -1 ? payCachedOwner_(idToken) : payVerifyOwner_(idToken);
    if (!caller) return payJson_({ success: false, error: 'Not authorized -- payroll is Owner-only' });
    const writes = {
      saveinputs: function (ss) { paySaveInputs_(ss, data.month, data.rows || [], caller); },
      addadjustment: function (ss) { payAddAdjustment_(ss, data, caller); },
      deleteadjustment: function (ss) { payDeleteAdjustment_(ss, data.month, data.id); },
      markstep: function (ss) { payMarkStep_(ss, data, caller); },
      lock: function (ss) { payLock_(ss, data.month, data.entity, caller); },
    };
    let result;
    if (action === 'month' || action === 'draft') result = payMonth_(payOpen_(), data.month);
    else if (writes[action]) result = payWrite_(data.month, writes[action]);
    else return payJson_({ success: false, error: 'Unknown action: ' + action });
    return payJson_(Object.assign({ success: true }, result));
  } catch (err) {
    return payJson_({ success: false, error: err.message });
  }
}

// One write at a time (script lock), then the refreshed month.
function payWrite_(month, fn) {
  payCheckMonth_(month);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = payOpen_();
    fn(ss);
    SpreadsheetApp.flush();
    return payMonth_(ss, month);
  } finally {
    lock.releaseLock();
  }
}

function payOpen_() {
  const ss = SpreadsheetApp.openById(PAY_SHEET_ID);
  payEnsureTabs_(ss);
  return ss;
}

function payJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ── Auth ─────────────────────────────────────────────────────────────
function payVerifyOwner_(idToken) {
  if (!idToken) return null;
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  const p = JSON.parse(res.getContentText());
  if (p.aud !== PAY_GOOGLE_CLIENT_ID || (p.email_verified !== 'true' && p.email_verified !== true)) return null;
  const email = String(p.email || '').toLowerCase();
  const rows = SpreadsheetApp.openById(PAY_ALLOWLIST_SHEET_ID).getSheets()[0].getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '').trim().toLowerCase() !== email) continue;
    const roles = String(rows[i][3] || '').split(',').map(function (r) { return r.trim(); });
    return roles.indexOf('Owner') !== -1 ? { email: email } : null;
  }
  return null;
}

// Reads only: a verified caller is cached 5 min under a hash of the token.
function payCachedOwner_(idToken) {
  const key = 'pay_tok_' + Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, idToken || '')
    .map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join('');
  const cache = CacheService.getScriptCache();
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const caller = payVerifyOwner_(idToken);
  if (caller) cache.put(key, JSON.stringify(caller), 300);
  return caller;
}


// ── Sheet helpers ────────────────────────────────────────────────────
// Creates missing tabs, and appends any header a live tab is missing.
function payEnsureTabs_(ss) {
  Object.keys(PAY_TABS).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) {
      const blank = ss.getSheetByName('Sheet1');
      sh = blank && blank.getLastRow() === 0 ? blank.setName(name) : ss.insertSheet(name);
      sh.getRange(1, 1, 1, PAY_TABS[name].length).setValues([PAY_TABS[name]]).setFontWeight('bold');
      sh.setFrozenRows(1);
      return;
    }
    const have = sh.getLastRow() ? sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
    const missing = PAY_TABS[name].filter(function (h) { return have.indexOf(h) === -1; });
    let last = have.length;
    while (last > 0 && !have[last - 1]) last--;
    if (missing.length) sh.getRange(1, last + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
  });
}

// Appends objects as rows, placing each value under its header.
function payAppend_(sheet, objs) {
  if (!objs.length) return;
  const hdr = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
  const rows = objs.map(function (o) { return hdr.map(function (h) { return h in o ? o[h] : ''; }); });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, hdr.length).setValues(rows);
}

// Rows of a tab as objects keyed by header text.
function payRows_(sheet) {
  const values = sheet.getDataRange().getValues();
  const hdr = values[0].map(function (h) { return String(h).trim(); });
  return values.slice(1).filter(function (r) { return r.some(function (v) { return v !== ''; }); })
    .map(function (r) { const o = {}; hdr.forEach(function (h, i) { o[h] = r[i]; }); return o; });
}

function payNum_(v) {
  if (typeof v === 'number') return v;
  const s = String(v || '').replace(/[^0-9.-]/g, '');
  return s ? Number(s) : 0;
}
function payYes_(v) { return /^y/i.test(String(v || '').trim()); }
function payEntity_(v) { return String(v || '').replace(/\s+/g, '').toUpperCase(); }
function payMonthKey_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, PAY_TZ, 'yyyy-MM');
  return String(v || '').trim().slice(0, 7);
}
function payDate_(v) {
  if (v instanceof Date && !isNaN(v)) return v;
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

function paySettings_(rs) {
  const sh = rs.getSheetByName('PayRoll Constants');
  const values = sh.getDataRange().getValues();
  const c = {};
  values.slice(1).forEach(function (r) { if (r[0]) c[String(r[0]).trim()] = payNum_(r[1]); });
  const missing = PAY_NEW_CONSTANTS.filter(function (kv) { return !(kv[0] in c); });
  if (missing.length) {
    sh.getRange(sh.getLastRow() + 1, 1, missing.length, 2).setValues(missing);
    missing.forEach(function (kv) { c[kv[0]] = kv[1]; });
  }
  const need = ['EPF Rate %', 'PF Rate %', 'EPF Cap Salary', 'ESI Threshold', 'ESI Employee %', 'ESI Employer %', 'RRF Y1 %', 'RRF Y2 %', 'RRF Y3 %'];
  need.forEach(function (k) { if (!(k in c)) throw new Error('PayRoll Constants is missing "' + k + '"'); });
  return {
    epfRate: (c['EPF Rate %'] + c['PF Rate %']) / 100, epfCeiling: c['EPF Cap Salary'],
    esiEmpRate: c['ESI Employee %'] / 100, esiErRate: c['ESI Employer %'] / 100, esiThreshold: c['ESI Threshold'],
    rrfY1: c['RRF Y1 %'] / 100, rrfY2: c['RRF Y2 %'] / 100, rrfY3: c['RRF Y3 %'] / 100,
    rrfTargetMonths: c['RRF Target Months'], rrfStopAtTarget: c['RRF Stop At Target (1=Yes)'] === 1,
    gratRate: c['Gratuity Provision %'] / 100, clDivisor: c['CL Encashment Divisor'],
  };
}

function payRates_(rs) {
  const rows = payRows_(rs.getSheetByName('PayRoll Rates'));
  // Uday's sheet (2026-09-29) names these "EPF/ESI Enrolled by Default" --
  // entity-level Y/N, N = not registered (LMS 6). "... Registered" also accepted.
  const hdr = rows.length ? rows[0] : {};
  const epfKey = 'EPF Registered' in hdr ? 'EPF Registered' : 'EPF Enrolled by Default';
  const esiKey = 'ESI Registered' in hdr ? 'ESI Registered' : 'ESI Enrolled by Default';
  if (rows.length && !(epfKey in hdr && esiKey in hdr)) {
    throw new Error('PayRoll Rates tab needs "EPF Enrolled by Default" and "ESI Enrolled by Default" (Y/N) columns');
  }
  const out = {};
  rows.forEach(function (r) {
    const key = payEntity_(r['School']);
    if (key) out[key] = { da: payNum_(r['DA %']) / 100, ada: payNum_(r['ADA %']) / 100,
      epfRegistered: payYes_(r[epfKey]), esiRegistered: payYes_(r[esiKey]) };
  });
  return out;
}


// ── Month helpers ────────────────────────────────────────────────────
function payCheckMonth_(month) {
  if (!/^\d{4}-\d{2}$/.test(String(month || ''))) throw new Error('month must be YYYY-MM');
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
  const monthEnd = new Date(y, m, 0);
  return { start: new Date(y, m - 1, 1), monthEnd: monthEnd, daysInMonth: monthEnd.getDate() };
}
function payPrevMonth_(month) {
  const d = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function payStamp_(d) { return d instanceof Date ? Utilities.formatDate(d, PAY_TZ, 'dd MMM yyyy, HH:mm') : String(d || ''); }

// Register columns <-> payCalc_ keys -- one list for writing and reading back.
const PAY_REG_FIELDS = [['Paid Days', 'paidDays'], ['Month Basic', 'basic'], ['ADA', 'ada'], ['DA', 'da'],
  ['CL Encashment', 'clEncashment'], ['Tuition (A)', 'tuitionA'], ['Other Earnings', 'otherEarnings'], ['Gross', 'gross'],
  ['EPF Employee', 'epf'], ['ESI Employee', 'esi'], ['RRF Rate', 'rrfRate'], ['RRF', 'rrf'], ['Tuition (D)', 'tuitionD'],
  ['Other Deductions', 'otherDeductions'], ['Total Deductions', 'totalDeductions'], ['Net Pay', 'net'],
  ['Bank Payable', 'bankPayable'], ['Held for F&F', 'heldForFnF'], ['Withheld (Grievance)', 'withheld'],
  ['Released Held', 'released'], ['EPF Employer', 'epfEmployer'], ['ESI Employer', 'esiEmployer'], ['CTI', 'cti'],
  ['Gratuity Provision', 'gratuityProvision']];

function payForMonth_(ss, tab, month) {
  return payRows_(ss.getSheetByName(tab)).filter(function (r) { return payMonthKey_(r['Month']) === month; });
}

// entity -> {by, at} for every school locked in this month.
function payLocks_(ss, month) {
  const out = {};
  payForMonth_(ss, 'Run Log', month).forEach(function (r) {
    if (/^locked/i.test(String(r['Status (Draft/Locked)'] || ''))) out[payEntity_(r['Entity'])] = { by: String(r['Locked By'] || ''), at: payStamp_(r['Locked At']) };
  });
  return out;
}

// entity|'ALL' -> step -> {by, at}
function payChecklist_(ss, month) {
  const out = {};
  payForMonth_(ss, 'Checklist', month).forEach(function (r) {
    const e = String(r['Entity']).trim();
    (out[e] = out[e] || {})[String(r['Step']).trim()] = { by: String(r['Done By'] || ''), at: payStamp_(r['Done At']) };
  });
  return out;
}

// code -> {net, cti}. "ERP CTI" (2026-09-30) = the ERP's CTI INCLUDING the
// 3.25% employer ESI its own CTI column leaves out -- like-for-like with payCalc_.
function payErp_(ss, month) {
  const erp = {};
  payForMonth_(ss, 'ERP Reference', month).forEach(function (r) {
    erp[String(r['Employee Code']).trim()] = { net: payNum_(r['ERP Net Pay']),
      cti: r['ERP CTI'] === undefined || r['ERP CTI'] === '' ? null : payNum_(r['ERP CTI']) };
  });
  return erp;
}

// code -> sum of Ledger amounts for one account, over months before `month`.
function payLedgerBalances_(ss, account, month) {
  const out = {};
  payRows_(ss.getSheetByName('Ledger')).forEach(function (r) {
    if (String(r['Account (RRF/Security/Loan/Held Salary)'] || '').trim().toLowerCase() !== account.toLowerCase()) return;
    if (payMonthKey_(r['Month']) >= month) return;
    const code = String(r['Employee Code']).trim();
    out[code] = (out[code] || 0) + payNum_(r['Amount']);
  });
  return out;
}

// ── The month ────────────────────────────────────────────────────────
// Open schools are computed live; locked schools are read back from the
// Payroll Register exactly as locked. Adds the previous month's net (for the
// review's month-on-month check) and the ERP comparison to every row.
function payMonth_(ss, month) {
  const ctx = payCheckMonth_(month);
  const locks = payLocks_(ss, month);
  const live = payCompute_(ss, month);
  const locked = payForMonth_(ss, 'Payroll Register', month).filter(function (r) { return locks[payEntity_(r['Entity'])]; })
    .map(function (r) {
      const o = { code: String(r['Employee Code']), name: String(r['Name']), entity: payEntity_(r['Entity']),
        designation: String(r['Designation']), adjustments: [], input: null };
      PAY_REG_FIELDS.forEach(function (f) { o[f[1]] = payNum_(r[f[0]]); });
      return o;
    });
  const rows = live.rows.filter(function (r) { return !locks[r.entity]; }).concat(locked);
  const adj = payForMonth_(ss, 'Adjustments', month);
  const byCode = {};
  rows.forEach(function (r) { byCode[r.code] = r; });
  adj.forEach(function (a) {
    const r = byCode[String(a['Employee Code']).trim()];
    if (r && locks[r.entity]) r.adjustments.push({ id: String(a['ID']), type: String(a['Type']), direction: String(a['Direction']), amount: payNum_(a['Amount']), note: String(a['Note'] || '') });
  });

  const erp = payErp_(ss, month);
  const prev = payPrevNets_(ss, payPrevMonth_(month));
  rows.forEach(function (r) {
    const e = erp[r.code];
    r.erpNet = e ? e.net : null;
    r.erpCti = e ? e.cti : null;
    r.prevNet = r.code in prev ? prev[r.code] : null;
  });
  rows.sort(function (a, b) { return (PAY_ENTITIES.indexOf(a.entity) - PAY_ENTITIES.indexOf(b.entity)) || (a.code < b.code ? -1 : 1); });
  return { month: month, daysInMonth: ctx.daysInMonth, settings: live.settings, rates: live.rates, rows: rows,
    warnings: live.warnings.filter(function (w) { return !locks[w.entity]; }), locked: locks,
    checklist: payChecklist_(ss, month), steps: PAY_STEPS, adjTypes: PAY_ADJ_TYPES };
}

// code -> net for the previous month: locked schools from the Register,
// the rest recomputed (so month-on-month works before anything is locked).
function payPrevNets_(ss, month) {
  const out = {};
  const locks = payLocks_(ss, month);
  payCompute_(ss, month).rows.forEach(function (r) { if (!locks[r.entity]) out[r.code] = r.net; });
  payForMonth_(ss, 'Payroll Register', month).forEach(function (r) { out[String(r['Employee Code'])] = payNum_(r['Net Pay']); });
  return out;
}

function payCompute_(ss, month) {
  const ctx0 = payCheckMonth_(month);
  const monthEnd = ctx0.monthEnd;
  const rs = SpreadsheetApp.openById(PAY_RATES_SHEET_ID);
  const settings = paySettings_(rs);
  const rates = payRates_(rs);
  const warnings = [];

  // Salary Master: latest row per code effective on or before month end.
  const master = {};
  payRows_(ss.getSheetByName('Salary Master')).forEach(function (r) {
    const code = String(r['Employee Code'] || '').trim();
    const eff = payDate_(r['Effective From']);
    if (!code || !eff || eff > monthEnd) return;
    if (!master[code] || eff >= master[code].eff) master[code] = { eff: eff, row: r };
  });

  const inputs = {};
  payForMonth_(ss, 'Monthly Inputs', month).forEach(function (r) { inputs[String(r['Employee Code']).trim()] = r; });
  const adjustments = {};
  payForMonth_(ss, 'Adjustments', month).forEach(function (a) {
    const code = String(a['Employee Code']).trim();
    (adjustments[code] = adjustments[code] || []).push({ id: String(a['ID']), type: String(a['Type']),
      direction: String(a['Direction']), amount: payNum_(a['Amount']), note: String(a['Note'] || '') });
  });
  const openingRrf = payLedgerBalances_(ss, 'RRF', month);
  const heldBalance = payLedgerBalances_(ss, 'Held Salary', month);

  const rows = [];
  Object.keys(master).forEach(function (code) {
    const r = master[code].row;
    if (/^left/i.test(String(r['Status (Active/Left)'] || ''))) return;
    const entity = payEntity_(r['Entity']);
    const doj = payDate_(r['Date of Joining']);
    if (!rates[entity]) { warnings.push({ entity: entity, text: code + ': no PayRoll Rates row for entity "' + r['Entity'] + '" -- skipped' }); return; }
    if (!doj) { warnings.push({ entity: entity, text: code + ': no Date of Joining -- skipped' }); return; }
    const inp = inputs[code] || {};
    const adj = adjustments[code] || [];
    const sumDir = function (dir) { return adj.reduce(function (t, a) { return t + (a.direction === dir ? a.amount : 0); }, 0); };
    const hold = /^f/i.test(String(inp['Hold (F&F/Grievance)'] || '')) ? 'fnf'
      : /^g/i.test(String(inp['Hold (F&F/Grievance)'] || '')) ? 'grievance'
      : payYes_(inp['Hold for F&F (Y/N)']) ? 'fnf' : '';
    const calc = payCalc_(
      { fullBasic: payNum_(r['Full Basic']), epfMember: payYes_(r['EPF Member (Y/N)']), rrfMember: payYes_(r['RRF Member (Y/N)']),
        tuition: payNum_(r['Staff-Child Tuition']), doj: doj },
      { paidDays: inp['Paid Days'], clDays: inp['CL Days Encashed'], hold: hold, release: inp['Release Held (₹)'],
        otherEarnings: sumDir('Earning'), otherDeductions: sumDir('Deduction') },
      rates[entity], settings, Object.assign({ openingRrf: openingRrf[code] || 0 }, ctx0));
    if (!payNum_(r['Full Basic'])) warnings.push({ entity: entity, text: code + ': Full Basic is 0' });
    rows.push(Object.assign({ code: code, name: String(r['Name'] || '').trim(), entity: entity,
      designation: String(r['Designation'] || '').trim(), adjustments: adj, heldBalance: heldBalance[code] || 0,
      input: { paidDays: inp['Paid Days'] === undefined ? '' : inp['Paid Days'], clDays: inp['CL Days Encashed'] || '',
        hold: hold, release: inp['Release Held (₹)'] || '' } }, calc));
  });
  Object.keys(inputs).forEach(function (code) { if (!master[code]) warnings.push({ entity: '', text: code + ': has Monthly Inputs but no Salary Master row' }); });
  Object.keys(adjustments).forEach(function (code) { if (!master[code]) warnings.push({ entity: '', text: code + ': has Adjustments but no Salary Master row' }); });
  return { settings: settings, rates: rates, rows: rows, warnings: warnings };
}

// code -> entity for everyone in Salary Master (any row); throws on unknown code.
function payEntityOf_(ss) {
  const out = {};
  payRows_(ss.getSheetByName('Salary Master')).forEach(function (r) { out[String(r['Employee Code']).trim()] = payEntity_(r['Entity']); });
  return function (code) {
    if (!(code in out)) throw new Error(code + ': not in Salary Master');
    return out[code];
  };
}

function payAssertOpen_(locks, entity, month) {
  if (locks[entity]) throw new Error(entity + ' is locked for ' + month + ' -- corrections go into next month as Adjustments');
}

// ── Monthly Inputs ───────────────────────────────────────────────────
// rows: [{code, paidDays, clDays, hold ('fnf'|'grievance'|''), release}] --
// upserted by Month + Employee Code, one row per person per month.
function paySaveInputs_(ss, month, rows, caller) {
  const ctx = payCheckMonth_(month);
  const locks = payLocks_(ss, month);
  const entityOf = payEntityOf_(ss);
  const held = payLedgerBalances_(ss, 'Held Salary', month);
  const num = function (v, label, code, max) {
    if (v === '' || v === null || v === undefined) return '';
    const n = Number(v);
    if (isNaN(n) || n < 0 || (max !== undefined && n > max)) throw new Error(code + ': ' + label + ' "' + v + '" is not valid');
    return n;
  };
  const sheet = ss.getSheetByName('Monthly Inputs');
  const values = sheet.getDataRange().getValues();
  const hdr = values[0].map(function (h) { return String(h).trim(); });
  const col = function (h) { return hdr.indexOf(h); };
  const idx = {};
  for (let i = 1; i < values.length; i++) idx[payMonthKey_(values[i][col('Month')]) + '|' + String(values[i][col('Employee Code')]).trim()] = i;
  const now = new Date();
  rows.forEach(function (r) {
    const code = String(r.code || '').trim();
    payAssertOpen_(locks, entityOf(code), month);
    const hold = r.hold === 'fnf' ? 'F&F' : r.hold === 'grievance' ? 'Grievance' : '';
    const release = num(r.release, 'Release Held', code, held[code] || 0);
    const k = month + '|' + code;
    if (!(k in idx)) { idx[k] = values.length; values.push(hdr.map(function () { return ''; })); }
    const row = values[idx[k]];
    const set = function (h, v) { row[col(h)] = v; };
    set('Month', ctx.start); set('Employee Code', code);
    set('Paid Days', num(r.paidDays, 'Paid Days', code, ctx.daysInMonth)); set('CL Days Encashed', num(r.clDays, 'CL Days', code));
    set('Hold for F&F (Y/N)', ''); set('Hold (F&F/Grievance)', hold); set('Release Held (₹)', release);
    set('Updated By', caller.email); set('Updated At', now);
  });
  sheet.getRange(1, 1, values.length, hdr.length).setValues(values);
}

// ── Adjustments ──────────────────────────────────────────────────────
function payAddAdjustment_(ss, d, caller) {
  const ctx = payCheckMonth_(d.month);
  const code = String(d.code || '').trim();
  payAssertOpen_(payLocks_(ss, d.month), payEntityOf_(ss)(code), d.month);
  const dir = PAY_ADJ_TYPES[d.type];
  if (!dir) throw new Error('Unknown adjustment type: ' + d.type);
  const amount = Number(d.amount);
  if (!(amount > 0)) throw new Error('Amount must be more than 0');
  payAppend_(ss.getSheetByName('Adjustments'), [{ 'ID': Utilities.getUuid().slice(0, 8), 'Month': ctx.start, 'Employee Code': code,
    'Type': d.type, 'Direction': dir, 'Amount': Math.round(amount), 'Note': String(d.note || ''), 'Added By': caller.email, 'Added At': new Date() }]);
}

function payDeleteAdjustment_(ss, month, id) {
  const sheet = ss.getSheetByName('Adjustments');
  const values = sheet.getDataRange().getValues();
  const hdr = values[0].map(function (h) { return String(h).trim(); });
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][hdr.indexOf('ID')]) !== String(id) || payMonthKey_(values[i][hdr.indexOf('Month')]) !== month) continue;
    payAssertOpen_(payLocks_(ss, month), payEntityOf_(ss)(String(values[i][hdr.indexOf('Employee Code')]).trim()), month);
    sheet.deleteRow(i + 1);
    return;
  }
  throw new Error('Adjustment not found');
}

// ── Checklist ────────────────────────────────────────────────────────
// d: {month, entity ('ALL' or a school), step, done}
function payMarkStep_(ss, d, caller) {
  const ctx = payCheckMonth_(d.month);
  if (PAY_STEPS.indexOf(d.step) === -1) throw new Error('Unknown step: ' + d.step);
  const entity = d.entity === 'ALL' ? 'ALL' : payEntity_(d.entity);
  const sheet = ss.getSheetByName('Checklist');
  const values = sheet.getDataRange().getValues();
  for (let i = values.length - 1; i >= 1; i--) {
    if (payMonthKey_(values[i][0]) === d.month && String(values[i][1]).trim() === entity && String(values[i][2]).trim() === d.step) sheet.deleteRow(i + 1);
  }
  if (d.done) payAppend_(sheet, [{ 'Month': ctx.start, 'Entity': entity, 'Step': d.step, 'Done By': caller.email, 'Done At': new Date() }]);
}

// ── Lock ─────────────────────────────────────────────────────────────
// entity: a school, or 'ALL' for every school not yet locked. Needs every
// PAY_STEPS step ticked (for that school or ALL) and no warnings. Writes
// Payroll Register rows, a Run Log row per school with the rates in force,
// and Ledger entries: RRF deducted, salary held/withheld, earlier holds released.
function payLock_(ss, month, entity, caller) {
  const ctx = payCheckMonth_(month);
  const locks = payLocks_(ss, month);
  const d = payCompute_(ss, month);
  const present = PAY_ENTITIES.filter(function (e) { return d.rows.some(function (r) { return r.entity === e; }); });
  const targets = entity === 'ALL' ? present.filter(function (e) { return !locks[e]; }) : [payEntity_(entity)];
  if (!targets.length) throw new Error('Nothing left to lock for ' + month);
  const checklist = payChecklist_(ss, month);
  targets.forEach(function (e) {
    if (locks[e]) throw new Error(e + ' is already locked for ' + month);
    const notDone = PAY_STEPS.filter(function (s) { return !((checklist[e] || {})[s] || (checklist.ALL || {})[s]); });
    if (notDone.length) throw new Error(e + ': tick these steps first -- ' + notDone.join(', '));
    const w = d.warnings.filter(function (x) { return x.entity === e || !x.entity; });
    if (w.length) throw new Error('Fix these before locking ' + e + ': ' + w.map(function (x) { return x.text; }).join('; '));
  });
  const rows = d.rows.filter(function (r) { return targets.indexOf(r.entity) !== -1; });
  if (!rows.length) throw new Error('Nothing to lock -- no employees for ' + targets.join(', '));
  const now = new Date();

  payAppend_(ss.getSheetByName('Payroll Register'), rows.map(function (r) {
    const o = { 'Month': ctx.start, 'Employee Code': r.code, 'Name': r.name, 'Entity': r.entity, 'Designation': r.designation,
      'Locked At': now, 'Locked By': caller.email };
    PAY_REG_FIELDS.forEach(function (f) { o[f[0]] = r[f[1]]; });
    return o;
  }));
  payAppend_(ss.getSheetByName('Run Log'), targets.map(function (e) {
    const rs = rows.filter(function (r) { return r.entity === e; });
    const sum = function (k) { return rs.reduce(function (t, r) { return t + r[k]; }, 0); };
    return { 'Month': ctx.start, 'Entity': e, 'Status (Draft/Locked)': 'Locked', 'Headcount': rs.length, 'Gross': sum('gross'),
      'Net Pay': sum('net'), 'CTI': sum('cti'), 'Settings Snapshot': JSON.stringify({ settings: d.settings, rates: d.rates[e] }),
      'Locked By': caller.email, 'Locked At': now };
  }));
  const ledger = [];
  const entry = function (r, account, type, amount, notes) {
    ledger.push({ 'Date': now, 'Month': ctx.start, 'Employee Code': r.code, 'Account (RRF/Security/Loan/Held Salary)': account,
      'Type (Opening/Deduction/Payout/Loan Issued/Loan Repaid/Adjustment)': type, 'Amount': amount,
      'Reference': 'Payroll ' + month, 'Notes': notes, 'Entered By': caller.email, 'Entered At': now });
  };
  rows.forEach(function (r) {
    if (r.rrf) entry(r, 'RRF', 'Deduction', r.rrf, '');
    if (r.heldForFnF) entry(r, 'Held Salary', 'Deduction', r.heldForFnF, 'Salary held for F&F');
    if (r.withheld) entry(r, 'Held Salary', 'Deduction', r.withheld, 'Withheld (grievance) -- release within 2 weeks of the 10th');
    if (r.released) entry(r, 'Held Salary', 'Payout', -r.released, 'Earlier held salary released');
  });
  payAppend_(ss.getSheetByName('Ledger'), ledger);
}
