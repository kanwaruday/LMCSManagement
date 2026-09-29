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
//   "LMCS Payroll" sheet (PAY_SHEET_ID) -- tabs are created with their
//     headers on first use (payEnsureTabs_), never by hand.
//   "LMCS-Salary-PayScale" (PAY_RATES_SHEET_ID) -- PayRoll Rates (per-
//     entity DA/ADA % + EPF/ESI registration) and PayRoll Constants,
//     shared with the Salary Dashboard so both read the same rates.
//
// Actions:
//   draft (GET)       -- any month from Salary Master + Monthly Inputs vs the
//                        ERP Reference tab; a locked month is read back from
//                        Payroll Register instead (Stage 1, 2026-09-29)
//   saveinputs (POST) -- upsert paid days / CL encashed / hold / one-offs
//   lock (POST)       -- write Register + Run Log + Ledger; month then read-only
//                        (Stage 2, 2026-09-29)
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

const PAY_TABS = {
  'Salary Master': ['Employee Code', 'Name', 'Entity', 'Designation', 'Date of Joining', 'Effective From', 'Full Basic',
    'EPF Member (Y/N)', 'RRF Member (Y/N)', 'Staff-Child Tuition', 'Pay Mode', 'Bank Account No', 'IFSC', 'UAN', 'PAN',
    'Status (Active/Left)', 'Remarks'],
  'Monthly Inputs': ['Month', 'Employee Code', 'Paid Days', 'CL Days Encashed', 'Hold for F&F (Y/N)', 'Other Earnings',
    'Other Earnings Note', 'Other Deductions', 'Other Deductions Note', 'Updated By', 'Updated At'],
  'Payroll Register': ['Month', 'Employee Code', 'Name', 'Entity', 'Designation', 'Paid Days', 'Month Basic', 'ADA', 'DA',
    'CL Encashment', 'Tuition (A)', 'Other Earnings', 'Gross', 'EPF Employee', 'ESI Employee', 'RRF Rate', 'RRF',
    'Tuition (D)', 'Other Deductions', 'Total Deductions', 'Net Pay', 'Bank Payable', 'Held for F&F', 'EPF Employer',
    'ESI Employer', 'CTI', 'Gratuity Provision', 'Locked At', 'Locked By'],
  'Run Log': ['Month', 'Entity', 'Status (Draft/Locked)', 'Headcount', 'Gross', 'Net Pay', 'CTI', 'Settings Snapshot',
    'Locked By', 'Locked At', 'Notes'],
  'Ledger': ['Date', 'Month', 'Employee Code', 'Account (RRF/Security/Loan/Held Salary)',
    'Type (Opening/Deduction/Payout/Loan Issued/Loan Repaid/Adjustment)', 'Amount', 'Reference', 'Notes', 'Entered By', 'Entered At'],
  'Tally Ledger Map': ['Entity', 'Payroll Head', 'Tally Ledger Name', 'Cost Centre', 'Dr/Cr'],
  'ERP Reference': ['Month', 'Employee Code', 'ERP Gross', 'ERP EPF', 'ERP ESI', 'ERP RRF', 'ERP Net Pay'],
};

// Payroll-only settings, appended to PayRoll Constants if missing.
const PAY_NEW_CONSTANTS = [['RRF Target Months', 3], ['RRF Stop At Target (1=Yes)', 0],
  ['Gratuity Provision %', 5], ['CL Encashment Divisor', 30]];

const PAY_READ_ACTIONS_ = ['draft'];

function doGet(e) {
  return payHandle_(e.parameter.action, e.parameter.idToken, e.parameter.data ? JSON.parse(e.parameter.data) : {});
}

// Writes (Stage 2) come as POST -- a month of inputs is too long for a URL.
function doPost(e) {
  const body = JSON.parse((e.postData && e.postData.contents) || '{}');
  return payHandle_(body.action, body.idToken, body.data || {});
}

function payHandle_(action, idToken, data) {
  try {
    action = String(action || '').toLowerCase();
    const caller = PAY_READ_ACTIONS_.indexOf(action) !== -1 ? payCachedOwner_(idToken) : payVerifyOwner_(idToken);
    if (!caller) return payJson_({ success: false, error: 'Not authorized -- payroll is Owner-only' });
    let result;
    if (action === 'draft') result = payDraft_(data.month);
    else if (action === 'saveinputs') result = paySaveInputs_(data.month, data.rows || [], caller);
    else if (action === 'lock') result = payLock_(data.month, caller);
    else return payJson_({ success: false, error: 'Unknown action: ' + action });
    return payJson_(Object.assign({ success: true }, result));
  } catch (err) {
    return payJson_({ success: false, error: err.message });
  }
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
function payEnsureTabs_(ss) {
  Object.keys(PAY_TABS).forEach(function (name) {
    if (ss.getSheetByName(name)) return;
    const blank = ss.getSheetByName('Sheet1');
    const sh = blank && blank.getLastRow() === 0 ? blank.setName(name) : ss.insertSheet(name);
    sh.getRange(1, 1, 1, PAY_TABS[name].length).setValues([PAY_TABS[name]]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
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

// Register columns after Month/Code/Name/Entity/Designation, in PAY_TABS order,
// mapped to payCalc_'s keys -- one list for both writing and reading back.
const PAY_REG_FIELDS = [['Paid Days', 'paidDays'], ['Month Basic', 'basic'], ['ADA', 'ada'], ['DA', 'da'],
  ['CL Encashment', 'clEncashment'], ['Tuition (A)', 'tuitionA'], ['Other Earnings', 'otherEarnings'], ['Gross', 'gross'],
  ['EPF Employee', 'epf'], ['ESI Employee', 'esi'], ['RRF Rate', 'rrfRate'], ['RRF', 'rrf'], ['Tuition (D)', 'tuitionD'],
  ['Other Deductions', 'otherDeductions'], ['Total Deductions', 'totalDeductions'], ['Net Pay', 'net'],
  ['Bank Payable', 'bankPayable'], ['Held for F&F', 'heldForFnF'], ['EPF Employer', 'epfEmployer'],
  ['ESI Employer', 'esiEmployer'], ['CTI', 'cti'], ['Gratuity Provision', 'gratuityProvision']];

// {by, at} if this month is locked in the Run Log, else null.
function payLockInfo_(ss, month) {
  const hit = payRows_(ss.getSheetByName('Run Log')).filter(function (r) {
    return payMonthKey_(r['Month']) === month && /^locked/i.test(String(r['Status (Draft/Locked)'] || ''));
  })[0];
  if (!hit) return null;
  const at = hit['Locked At'];
  return { by: String(hit['Locked By'] || ''), at: at instanceof Date ? Utilities.formatDate(at, PAY_TZ, 'dd MMM yyyy, HH:mm') : String(at || '') };
}

function payErp_(ss, month) {
  const erp = {};
  payRows_(ss.getSheetByName('ERP Reference')).forEach(function (r) {
    if (payMonthKey_(r['Month']) === month) erp[String(r['Employee Code']).trim()] = payNum_(r['ERP Net Pay']);
  });
  return erp;
}

// ── Draft run ────────────────────────────────────────────────────────
// A locked month is read back from the Payroll Register exactly as locked;
// an open month is recomputed from Salary Master + Monthly Inputs.
function payDraft_(month) {
  const ss = SpreadsheetApp.openById(PAY_SHEET_ID);
  payEnsureTabs_(ss);
  payCheckMonth_(month);
  const lock = payLockInfo_(ss, month);
  if (!lock) return payCompute_(ss, month);
  const erp = payErp_(ss, month);
  const rows = payRows_(ss.getSheetByName('Payroll Register')).filter(function (r) { return payMonthKey_(r['Month']) === month; })
    .map(function (r) {
      const o = { code: String(r['Employee Code']), name: String(r['Name']), entity: String(r['Entity']), designation: String(r['Designation']) };
      PAY_REG_FIELDS.forEach(function (f) { o[f[1]] = payNum_(r[f[0]]); });
      o.erpNet = o.code in erp ? erp[o.code] : null;
      return o;
    });
  const rs = SpreadsheetApp.openById(PAY_RATES_SHEET_ID);
  return { month: month, daysInMonth: payCheckMonth_(month).daysInMonth, locked: lock, settings: paySettings_(rs), rows: rows, warnings: [] };
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
  payRows_(ss.getSheetByName('Monthly Inputs')).forEach(function (r) {
    if (payMonthKey_(r['Month']) === month) inputs[String(r['Employee Code']).trim()] = r;
  });
  const erp = payErp_(ss, month);
  // Opening RRF = every RRF ledger entry from months before this one.
  const openingRrf = {};
  payRows_(ss.getSheetByName('Ledger')).forEach(function (r) {
    if (!/^rrf/i.test(String(r['Account (RRF/Security/Loan/Held Salary)'] || ''))) return;
    if (payMonthKey_(r['Month']) >= month) return;
    const code = String(r['Employee Code']).trim();
    openingRrf[code] = (openingRrf[code] || 0) + payNum_(r['Amount']);
  });

  const rows = [];
  Object.keys(master).forEach(function (code) {
    const r = master[code].row;
    if (/^left/i.test(String(r['Status (Active/Left)'] || ''))) return;
    const entity = payEntity_(r['Entity']);
    const doj = payDate_(r['Date of Joining']);
    if (!rates[entity]) { warnings.push(code + ': no PayRoll Rates row for entity "' + r['Entity'] + '" -- skipped'); return; }
    if (!doj) { warnings.push(code + ': no Date of Joining -- skipped'); return; }
    const inp = inputs[code] || {};
    const calc = payCalc_(
      { fullBasic: payNum_(r['Full Basic']), epfMember: payYes_(r['EPF Member (Y/N)']), rrfMember: payYes_(r['RRF Member (Y/N)']),
        tuition: payNum_(r['Staff-Child Tuition']), doj: doj },
      { paidDays: inp['Paid Days'], clDays: inp['CL Days Encashed'], hold: payYes_(inp['Hold for F&F (Y/N)']),
        otherEarnings: inp['Other Earnings'], otherDeductions: inp['Other Deductions'] },
      rates[entity], settings, Object.assign({ openingRrf: openingRrf[code] || 0 }, ctx0));
    if (!payNum_(r['Full Basic'])) warnings.push(code + ': Full Basic is 0');
    rows.push(Object.assign({ code: code, name: String(r['Name'] || '').trim(), entity: entity,
      designation: String(r['Designation'] || '').trim(), erpNet: code in erp ? erp[code] : null,
      input: { paidDays: inp['Paid Days'] === undefined ? '' : inp['Paid Days'], clDays: inp['CL Days Encashed'] || '',
        hold: payYes_(inp['Hold for F&F (Y/N)']), otherEarnings: inp['Other Earnings'] || '', otherEarningsNote: inp['Other Earnings Note'] || '',
        otherDeductions: inp['Other Deductions'] || '', otherDeductionsNote: inp['Other Deductions Note'] || '' } }, calc));
  });
  Object.keys(inputs).forEach(function (code) { if (!master[code]) warnings.push(code + ': has Monthly Inputs but no Salary Master row'); });

  const order = ['HES', 'LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6'];
  rows.sort(function (a, b) { return (order.indexOf(a.entity) - order.indexOf(b.entity)) || (a.code < b.code ? -1 : 1); });
  return { month: month, daysInMonth: ctx0.daysInMonth, locked: null, settings: settings, rates: rates, rows: rows, warnings: warnings };
}

// ── Stage 2: save Monthly Inputs ─────────────────────────────────────
// rows: [{code, paidDays, clDays, hold, otherEarnings, otherEarningsNote,
// otherDeductions, otherDeductionsNote}] -- upserted by Month + Employee
// Code (one row per person per month). Returns the recomputed draft.
function paySaveInputs_(month, rows, caller) {
  const ctx = payCheckMonth_(month);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.openById(PAY_SHEET_ID);
    payEnsureTabs_(ss);
    if (payLockInfo_(ss, month)) throw new Error(month + ' is locked -- corrections go into next month as Other Earnings/Deductions');
    const known = {};
    payRows_(ss.getSheetByName('Salary Master')).forEach(function (r) { known[String(r['Employee Code']).trim()] = true; });
    const num = function (v, label, code, max) {
      if (v === '' || v === null || v === undefined) return '';
      const n = Number(v);
      if (isNaN(n) || n < 0 || (max !== undefined && n > max)) throw new Error(code + ': ' + label + ' "' + v + '" is not valid');
      return n;
    };
    const sheet = ss.getSheetByName('Monthly Inputs');
    const values = sheet.getDataRange().getValues();
    const idx = {};
    for (let i = 1; i < values.length; i++) idx[payMonthKey_(values[i][0]) + '|' + String(values[i][1]).trim()] = i;
    const now = new Date();
    rows.forEach(function (r) {
      const code = String(r.code || '').trim();
      if (!known[code]) throw new Error(code + ': not in Salary Master');
      const row = [ctx.start, code, num(r.paidDays, 'Paid Days', code, ctx.daysInMonth), num(r.clDays, 'CL Days', code),
        r.hold ? 'Y' : '', num(r.otherEarnings, 'Other Earnings', code), String(r.otherEarningsNote || ''),
        num(r.otherDeductions, 'Other Deductions', code), String(r.otherDeductionsNote || ''), caller.email, now];
      const k = month + '|' + code;
      if (k in idx) values[idx[k]] = row; else { idx[k] = values.length; values.push(row); }
    });
    sheet.getRange(1, 1, values.length, values[0].length).setValues(values);
    SpreadsheetApp.flush();
    return payCompute_(ss, month);
  } finally {
    lock.releaseLock();
  }
}

// ── Stage 2: lock a month ────────────────────────────────────────────
// Appends the computed rows to Payroll Register, one Run Log row per
// entity (with the rates in force), and the month's RRF deductions and
// held salaries to the Ledger. Refuses if already locked or if the draft
// has warnings (someone would be silently left out).
function payLock_(month, caller) {
  const ctx = payCheckMonth_(month);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.openById(PAY_SHEET_ID);
    payEnsureTabs_(ss);
    if (payLockInfo_(ss, month)) throw new Error(month + ' is already locked');
    const d = payCompute_(ss, month);
    if (d.warnings.length) throw new Error('Fix these before locking: ' + d.warnings.join('; '));
    if (!d.rows.length) throw new Error('Nothing to lock -- no employees for ' + month);
    const now = new Date();
    const append = function (name, rows) {
      if (!rows.length) return;
      const sh = ss.getSheetByName(name);
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    };
    append('Payroll Register', d.rows.map(function (r) {
      return [ctx.start, r.code, r.name, r.entity, r.designation]
        .concat(PAY_REG_FIELDS.map(function (f) { return r[f[1]]; })).concat([now, caller.email]);
    }));
    const byEntity = {};
    d.rows.forEach(function (r) {
      const e = byEntity[r.entity] = byEntity[r.entity] || { n: 0, gross: 0, net: 0, cti: 0 };
      e.n++; e.gross += r.gross; e.net += r.net; e.cti += r.cti;
    });
    append('Run Log', Object.keys(byEntity).map(function (e) {
      const t = byEntity[e];
      return [ctx.start, e, 'Locked', t.n, t.gross, t.net, t.cti,
        JSON.stringify({ settings: d.settings, rates: d.rates[e] }), caller.email, now, ''];
    }));
    const ledger = [];
    d.rows.forEach(function (r) {
      if (r.rrf) ledger.push([now, ctx.start, r.code, 'RRF', 'Deduction', r.rrf, 'Payroll ' + month, '', caller.email, now]);
      if (r.heldForFnF) ledger.push([now, ctx.start, r.code, 'Held Salary', 'Deduction', r.heldForFnF, 'Payroll ' + month, 'Salary held for F&F', caller.email, now]);
    });
    append('Ledger', ledger);
    SpreadsheetApp.flush();
    return payDraft_(month);
  } finally {
    lock.releaseLock();
  }
}
