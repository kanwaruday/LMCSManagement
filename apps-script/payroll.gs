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
//   unlock         -- undo one school's lock (only if no later month is locked for it)
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

// ── Speed (2026-09-30) ── Every Sheets call is a network round trip, so within
// one request each workbook is opened once and each tab read once. Globals are
// reset for every request, so these never serve stale data across requests.
// PAY_MEMO is switched off while a write action runs and back on to build the
// refreshed month afterwards.
const PAY_BOOKS = {};
let PAY_MEMO = null;
function payOpenById_(id) {
  if (!PAY_BOOKS[id]) {
    const real = SpreadsheetApp.openById(id), sheets = {};
    PAY_BOOKS[id] = {
      getSheetByName: function (n) { return n in sheets ? sheets[n] : (sheets[n] = real.getSheetByName(n)); },
      insertSheet: function (n) { return (sheets[n] = real.insertSheet(n)); },
    };
  }
  return PAY_BOOKS[id];
}
function payValues_(sheet) {
  if (!PAY_MEMO) return sheet.getDataRange().getValues();
  if (!PAY_MEMO.has(sheet)) PAY_MEMO.set(sheet, sheet.getDataRange().getValues());
  return PAY_MEMO.get(sheet);
}
const PAY_ENTITIES = ['HES', 'LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6'];

// Columns appended to an existing tab keep working (payEnsureTabs_ adds any
// header missing from a live sheet at the end), so order only matters for new tabs.
const PAY_TABS = {
  'Salary Master': ['Employee Code', 'Name', 'Entity', 'Designation', 'Date of Joining', 'Effective From', 'Full Basic',
    'EPF Member (Y/N)', 'RRF Member (Y/N)', 'Staff-Child Tuition', 'Pay Mode', 'Bank Account No', 'IFSC', 'UAN', 'PAN',
    'Status (Active/Left)', 'Remarks', 'Last Working Day', 'Monthly TDS (₹)'],
  // Structured offers from the Offer Calculator's "Record as Salary Offer" (stage c, 2026-09-30).
  'Salary Offers': ['Applicant ID', 'Name', 'Entity', 'Designation', 'Subjects', 'Full Basic', 'EPF Member (Y/N)', 'Staff-Child Tuition',
    'CTI', 'Net Y1', 'Recorded By', 'Recorded At', 'Status (Offered/Joined/Dismissed)', 'Employee Code', 'Date of Joining', 'Closed By', 'Closed At'],
  // Other Earnings/Deductions columns are from Stage 2 and no longer used --
  // one-offs live in the Adjustments tab (2026-09-30).
  'Monthly Inputs': ['Month', 'Employee Code', 'Paid Days', 'CL Days Encashed', 'Hold for F&F (Y/N)', 'Other Earnings',
    'Other Earnings Note', 'Other Deductions', 'Other Deductions Note', 'Updated By', 'Updated At',
    'Hold (F&F/Grievance)', 'Release Held (₹)', 'Skip Loan Recovery (Y/N)', 'Skip Reason'],
  'Adjustments': ['ID', 'Month', 'Employee Code', 'Type', 'Direction', 'Amount', 'Note', 'Added By', 'Added At'],
  'Payroll Register': ['Month', 'Employee Code', 'Name', 'Entity', 'Designation', 'Paid Days', 'Month Basic', 'ADA', 'DA',
    'CL Encashment', 'Tuition (A)', 'Other Earnings', 'Gross', 'EPF Employee', 'ESI Employee', 'RRF Rate', 'RRF',
    'Tuition (D)', 'Other Deductions', 'Total Deductions', 'Net Pay', 'Bank Payable', 'Held for F&F', 'EPF Employer',
    'ESI Employer', 'CTI', 'Gratuity Provision', 'Locked At', 'Locked By', 'Withheld (Grievance)', 'Released Held', 'Loan Recovery', 'TDS'],
  'Run Log': ['Month', 'Entity', 'Status (Draft/Locked)', 'Headcount', 'Gross', 'Net Pay', 'CTI', 'Settings Snapshot',
    'Locked By', 'Locked At', 'Notes'],
  'Checklist': ['Month', 'Entity', 'Step', 'Done By', 'Done At'],
  'Ledger': ['Date', 'Month', 'Employee Code', 'Account (RRF/Security/Loan/Held Salary)',
    'Type (Opening/Deduction/Payout/Loan Issued/Loan Repaid/Adjustment)', 'Amount', 'Reference', 'Notes', 'Entered By', 'Entered At'],
  // Salary advances and RRF loans, recovered automatically each month (stage 4, 2026-09-30).
  // 'Tally Ledger Name' (2026-10-01): each advance/loan has its own named Tally ledger, not a
  // shared one (confirmed from a real voucher -- two advances in the same voucher used different
  // naming patterns) -- filled in once per loan, the Tally export looks it up here.
  'Loans': ['Loan ID', 'Employee Code', 'Type (Salary Advance/RRF Loan)', 'Given On', 'Amount', 'Monthly Recovery', 'Start Month',
    'Status (Active/Closed)', 'Notes', 'Tally Ledger Name', 'Added By', 'Added At'],
  // One row per Full & Final settlement.
  'F&F': ['F&F ID', 'Employee Code', 'Name', 'Entity', 'Date of Joining', 'Last Working Day', 'Salary Security', 'Security', 'RRF', 'Gratuity',
    'Gratuity Years', 'CL Days', 'CL Encashment', 'Notice Pay', 'Other Earnings', 'Notice Period Recovery', 'Loan Outstanding', 'Collection from Students',
    'Outstanding Fee of Ward', 'Other Dues', 'Total Earnings', 'Total Deductions', 'Net Payable', 'Paid On', 'Payment Mode', 'Reference', 'Notes',
    'Settled By', 'Settled At'],
  // Every bank letter recorded as issued (stage 3, 2026-09-30): the reference series and what was sent.
  'Bank Letters': ['Ref No', 'Serial', 'Month', 'Entity', 'Letter Date', 'Cheque No', 'Amount', 'Staff', 'Addressee', 'Debit Account',
    'Issued By', 'Issued At'],
  'Tally Ledger Map': ['Entity', 'Payroll Head', 'Tally Ledger Name', 'Cost Centre', 'Dr/Cr'],
  'ERP Reference': ['Month', 'Employee Code', 'ERP Gross', 'ERP EPF', 'ERP ESI', 'ERP RRF', 'ERP Net Pay', 'ERP CTI'],
  // Annual increments (2026-10-01, per Uday): flat Annual Increment % on Full
  // Basic, every September, once an employee has completed the RRF cycle
  // (36 months). One row per person per time this was applied.
  // Run ID ties each person's row to the Salary Master rows one Apply wrote (it is also in their Remarks)
  // so a whole run can be undone; Undone By/At keep the audit trail instead of deleting it (2026-10-05).
  'Increments': ['Month', 'Employee Code', 'Name', 'Entity', 'Old Basic', 'New Basic', 'Rate %', 'Times', 'Applied By', 'Applied At',
    'Run ID', 'Roster Synced (Y/N)', 'Undone By', 'Undone At'],
  // 'Leave Records' is added by payEnsureTabs_ at run time -- its headers come from
  // PAY_LEAVE_FIELDS in payroll-calc.gs, which loads AFTER this file.
};

// Payroll-only settings, appended to PayRoll Constants if missing.
const PAY_NEW_CONSTANTS = [['RRF Target Months', 3], ['RRF Stop At Target (1=Yes)', 0],
  ['Gratuity Provision %', 5], ['CL Encashment Divisor', 30], ['CL Accrual Per Month', 1], ['Annual Increment %', 3], ['EPF Mandatory Below Gross', 25000],
  // Off by default while Payroll is still being tested against the ERP (2026-10-01, per
  // Uday) -- an annual increment only touches Payroll's own Salary Master until this is
  // flipped to 1, so the live Roster/Staff Master sheet stays untouched during testing.
  ['Sync Roster Increment (1=Yes)', 0]];

// Adjustment line-item types (Uday, 2026-09-30) -> Earning / Deduction.
const PAY_ADJ_TYPES = {
  'Arrears': 'Earning', 'Admission Incentive': 'Earning', 'Performance Bonus': 'Earning', 'Travel Allowance': 'Earning',
  'Notice Pay': 'Earning', 'Other Earning': 'Earning', 'TDS': 'Deduction',
  'Advance / Loan Recovery': 'Deduction', 'Fine': 'Deduction', 'Notice Period Recovery': 'Deduction', 'Other Deduction': 'Deduction',
  // Added 2026-10-01: a staff member's own child's fees recovered via salary -- confirmed by
  // Uday as distinct from the Staff-Child Tuition waiver (that one nets to zero via the
  // Free Education Staff / Tuition Fee Staff ledger pair; this is real cash recovered).
  // Maps 1:1 to the "Fee Recovery-Staff" Tally ledger.
  'Child Fee Recovery': 'Deduction',
};

// Checklist steps that must be ticked for a school before it can be locked.
const PAY_STEPS = ['staff', 'leave', 'adjustments', 'holds', 'review'];

const PAY_READ_ACTIONS_ = ['month', 'draft', 'accounts', 'fnfpreview', 'outputs'];

function doGet(e) {
  return payHandle_(e.parameter.action, e.parameter.idToken, e.parameter.data ? JSON.parse(e.parameter.data) : {});
}

// Writes come as POST -- a month of inputs is too long for a URL.
function doPost(e) {
  const body = JSON.parse((e.postData && e.postData.contents) || '{}');
  return payHandle_(body.action, body.idToken, body.data || {});
}

function payHandle_(action, idToken, data) {
  PAY_MEMO = new Map();
  try {
    action = String(action || '').toLowerCase();
    // The Offer Calculator (Principals/Coordinators too) may only append an offer.
    if (action === 'recordoffer') {
      const staff = payCachedStaff_(idToken);
      if (!staff) return payJson_({ success: false, error: 'Not authorized to record offers' });
      const lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try { PAY_MEMO = null; payRecordOffer_(payOpen_(), data, staff) } finally { lock.releaseLock(); }
      return payJson_({ success: true });
    }
    // Verified sign-in cached 5 min for every action (2026-09-30, for speed): removing
    // someone's Owner access takes up to 5 minutes to apply.
    const caller = payCachedOwner_(idToken);
    if (!caller) return payJson_({ success: false, error: 'Not authorized -- payroll is Owner-only' });
    const writes = {
      saveinputs: function (ss) { paySaveInputs_(ss, data.month, data.rows || [], caller); },
      addadjustment: function (ss) { extra = { adjustmentResult: payAddAdjustment_(ss, data, caller) }; },
      deleteadjustment: function (ss) { payDeleteAdjustment_(ss, data.month, data.id); },
      markstep: function (ss) { payMarkStep_(ss, data, caller); },
      uploadleave: function (ss) { payUploadLeave_(ss, data, caller, false); },
      lock: function (ss) { payLock_(ss, data.month, data.entity, caller); },
      unlock: function (ss) { payUnlock_(ss, data.month, data.entity, caller); },
      joinoffer: function (ss) { payJoinOffer_(ss, data, caller) },
      dismissoffer: function (ss) { payCloseOffer_(ss, String(data.applicantId || ''), 'Dismissed', {}, caller) },
      addemployee: function (ss) { payNewMasterRow_(ss, data, caller) },
      markleft: function (ss) { payMarkLeft_(ss, data) },
      applytransfer: function (ss) { payApplyTransfer_(ss, data, caller) },
      importopening: function (ss) { payImportOpening_(ss, data, caller); },
      applyincrement: function (ss) { extra = payApplyIncrement_(ss, data, caller, idToken); },
      undoincrement: function (ss) { extra = payUndoIncrement_(ss, data, caller); },
      issueloan: function (ss) { payIssueLoan_(ss, data, caller); },
      settlefnf: function (ss) { paySettleFnf_(ss, data, caller); },
      issueletter: function (ss) { payIssueLetter_(ss, data, caller); },
    };
    let result, extra; // extra: a write can attach fields beyond the refreshed month (e.g. applyincrement's rosterSync)
    if (action === 'month' || action === 'draft') result = payMonth_(payOpen_(), data.month);
    else if (action === 'previewleave') result = { preview: payUploadLeave_(payOpen_(), data, caller, true) };
    else if (action === 'accounts') result = payAccounts_(payOpen_(), data.month);
    else if (action === 'outputs') result = payOutputs_(payOpen_(), data.month);
    else if (action === 'dataquality') result = payDataQuality_(payOpen_(), data.month);
    else if (action === 'incrementpreview') result = { eligible: payIncrementEligible_(payOpen_(), data.month, data.times), runs: payIncrementRuns_(payOpen_(), data.month) };
    else if (action === 'tallyexport') result = payTallyVoucher_(payOpen_(), data.month);
    else if (action === 'fnfpreview') result = { statement: payFnfStatement_(payOpen_(), String(data.code || '').trim(), data.manual) };
    else if (writes[action]) result = payWrite_(data.month, writes[action]);
    else return payJson_({ success: false, error: 'Unknown action: ' + action });
    return payJson_(Object.assign({ success: true }, result, extra));
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
    PAY_MEMO = null; // writes always read fresh
    fn(ss);
    SpreadsheetApp.flush();
    PAY_MEMO = new Map();
    return payMonth_(ss, month);
  } finally {
    lock.releaseLock();
  }
}

function payOpen_() {
  const ss = payOpenById_(PAY_SHEET_ID);
  payEnsureTabs_(ss);
  return ss;
}

function payJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ── Auth ─────────────────────────────────────────────────────────────
function payVerifyOwner_(idToken) {
  const c = payVerifyAllowlist_(idToken);
  return c && c.roles.indexOf('Owner') !== -1 ? { email: c.email } : null;
}

// Verified Google ID token -> {email, roles} from the allowlist, or null.
function payVerifyAllowlist_(idToken) {
  if (!idToken) return null;
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  const p = JSON.parse(res.getContentText());
  if (p.aud !== PAY_GOOGLE_CLIENT_ID || (p.email_verified !== 'true' && p.email_verified !== true)) return null;
  const email = String(p.email || '').toLowerCase();
  const rows = SpreadsheetApp.openById(PAY_ALLOWLIST_SHEET_ID).getSheets()[0].getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '').trim().toLowerCase() !== email) continue;
    return { email: email, roles: String(rows[i][3] || '').split(',').map(function (r) { return r.trim(); }) };
  }
  return null;
}

// A verified caller is cached 5 min under a hash of the token.
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
  PAY_TABS['Leave Records'] = PAY_TABS['Leave Records'] || payLeaveHeaders_();
  // Skipped when this exact tab layout was already checked in the last 6 hours
  // (was 14 header reads on every request).
  const cache = CacheService.getScriptCache();
  const version = 'pay_tabs_' + Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(PAY_TABS))
    .map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join('');
  if (cache.get(version)) return;
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
  cache.put(version, '1', 21600);
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
  const values = payValues_(sheet);
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
  const values = payValues_(sh);
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
    gratRate: c['Gratuity Provision %'] / 100, clDivisor: c['CL Encashment Divisor'], epsRate: c['EPF Rate %'] / 100,
    clAccrual: c['CL Accrual Per Month'], annualIncrementPct: c['Annual Increment %'], epfMandatoryBelow: c['EPF Mandatory Below Gross'],
    syncRosterIncrement: c['Sync Roster Increment (1=Yes)'] === 1,
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
function payNextMonth_(month) {
  const d = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1);
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
  ['Gratuity Provision', 'gratuityProvision'], ['Loan Recovery', 'loanRecovery'], ['TDS', 'tds']];

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
// Employees are listed in order of their number at the school, not as text: in KUL/08/05/072 the
// serial is 072 (the last part), so it sorts after 021, 028, 042 ... (Uday, 2026-10-05). Ties
// (a school's old and new codes, "...#2" duplicates) fall back to the whole code.
function payCodeSerial_(code) {
  // the part after the last "/", leading digits only ("054#2" -> 54)
  const m = String(code || '').split('/').pop().match(/^\d+/);
  return m ? Number(m[0]) : Infinity;
}
function payCompareCodes_(a, b) {
  const x = payCodeSerial_(a), y = payCodeSerial_(b);
  return x === y ? (a < b ? -1 : a > b ? 1 : 0) : x < y ? -1 : 1;
}
function payCompareStaff_(a, b) {
  return (PAY_ENTITIES.indexOf(a.entity) - PAY_ENTITIES.indexOf(b.entity)) || payCompareCodes_(a.code, b.code);
}

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
  const prevLeave = payPrevLeaveClosing_(ss, payPrevMonth_(month), live.settings.clAccrual);
  rows.forEach(function (r) {
    const e = erp[r.code];
    r.erpNet = e ? e.net : null;
    r.erpCti = e ? e.cti : null;
    r.prevNet = r.code in prev ? prev[r.code].net : null;
    r.prevCti = r.code in prev ? prev[r.code].cti : null;
    // Only a suggestion for the downloaded template -- never overrides an
    // actual upload already on file for this month (r.leave).
    if (!r.leave && prevLeave[r.code]) r.leaveCarryOpening = prevLeave[r.code];
  });
  rows.sort(payCompareStaff_);
  return { month: month, daysInMonth: ctx.daysInMonth, settings: live.settings, rates: live.rates, rows: rows,
    warnings: live.warnings.filter(function (w) { return !locks[w.entity]; }), locked: locks,
    checklist: payChecklist_(ss, month), steps: PAY_STEPS, adjTypes: PAY_ADJ_TYPES, staff: payStaffSafe_(ss, month),
    leaveFields: PAY_LEAVE_FIELDS.map(function (f) { return [f[0], f[1], f[2]]; }), vacRules: PAY_VAC_RULES };
}

// code -> {cl, comp}, each person's CL/Comp balance as of the start of `month`:
// whatever was left over (Opening - Used) after the most recent month that
// actually has a Leave Records row for them, plus CL Accrual Per Month for
// every month since that's gone by with no upload (walks back up to 12
// months -- most months won't have an upload for someone with nothing to
// report). Comp isn't accrued automatically (it's earned ad hoc), so only CL
// gets the per-month addition.
function payPrevLeaveClosing_(ss, month, clAccrual) {
  const out = {}, want = {};
  payRows_(ss.getSheetByName('Salary Master')).forEach(function (r) { want[String(r['Employee Code']).trim()] = true; });
  let m = month, elapsed = 1;
  for (let i = 0; i < 12 && Object.keys(want).length; i++) {
    const accrued = elapsed * (Number(clAccrual) || 0);
    payForMonth_(ss, 'Leave Records', m).forEach(function (l) {
      const code = String(l['Employee Code']).trim();
      if (!want[code]) return;
      out[code] = { cl: payRound2_(payNum_(l['Opening CL Balance']) - payNum_(l['CL Used']) + accrued),
        comp: payRound2_(payNum_(l['Opening Comp Balance']) - payNum_(l['Comp Used'])) };
      delete want[code];
    });
    m = payPrevMonth_(m);
    elapsed++;
  }
  return out;
}

// code -> {net, cti} for the previous month: locked schools from the Register,
// the rest recomputed (so month-on-month works before anything is locked). Both figures always
// travel together: Net Pay is what the employee receives, CTI is what the employer bears.
function payPrevNets_(ss, month) {
  const out = {};
  const locks = payLocks_(ss, month);
  payCompute_(ss, month).rows.forEach(function (r) { if (!locks[r.entity]) out[r.code] = { net: r.net, cti: r.cti }; });
  payForMonth_(ss, 'Payroll Register', month).forEach(function (r) { out[String(r['Employee Code'])] = { net: payNum_(r['Net Pay']), cti: payNum_(r['CTI']) }; });
  return out;
}

function payCompute_(ss, month) {
  const ctx0 = payCheckMonth_(month);
  const monthEnd = ctx0.monthEnd;
  const rs = payOpenById_(PAY_RATES_SHEET_ID);
  const settings = paySettings_(rs);
  const rates = payRates_(rs);
  const warnings = [];

  // Salary Master: latest row per code effective on or before month end (all rows kept for ESI coverage).
  const master = {}, history = {};
  payRows_(ss.getSheetByName('Salary Master')).forEach(function (r) {
    const code = String(r['Employee Code'] || '').trim();
    const eff = payDate_(r['Effective From']);
    if (!code || !eff) return;
    (history[code] = history[code] || []).push({ eff: eff, row: r });
    if (eff > monthEnd) return;
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
  const roleOf = payJobRoles_(rs);
  const leave = {};
  payForMonth_(ss, 'Leave Records', month).forEach(function (l) { leave[String(l['Employee Code']).trim()] = payLeaveRecord_(l); });
  const heldBalance = payLedgerBalances_(ss, 'Held Salary', month);
  const securityBalance = payLedgerBalances_(ss, 'Security', month);
  const loanBalance = payLedgerBalances_(ss, 'Loan', month);
  const loanSched = payLoanSchedules_(ss, month);

  const rows = [], calcArgs = {};
  Object.keys(master).forEach(function (code) {
    const r = master[code].row;
    const lwd = payDate_(r['Last Working Day']);
    if (lwd ? lwd < ctx0.start : /^left/i.test(String(r['Status (Active/Left)'] || ''))) return; // left before this month
    const entity = payEntity_(r['Entity']);
    const doj = payDate_(r['Date of Joining']);
    if (!rates[entity]) { warnings.push({ entity: entity, text: code + ': no PayRoll Rates row for entity "' + r['Entity'] + '" -- skipped' }); return; }
    if (!doj) { warnings.push({ entity: entity, text: code + ': no Date of Joining -- skipped' }); return; }
    const inp = inputs[code] || {};
    // Joiners / leavers: paid days default to the days employed this month.
    const employed = payEmployedDays_(doj, lwd, ctx0);
    const paidDays = inp['Paid Days'] === undefined || inp['Paid Days'] === '' ? (employed < ctx0.daysInMonth ? employed : '') : inp['Paid Days'];
    const adj = adjustments[code] || [];
    // Advance / RRF-loan recovery: the scheduled monthly amount, never more than what is still owed.
    const loanDue = Math.max(0, Math.min(loanSched[code] || 0, loanBalance[code] || 0));
    const skipLoan = payYes_(inp['Skip Loan Recovery (Y/N)']);
    const sumDir = function (dir) { return adj.reduce(function (t, a) { return t + (a.direction === dir && a.type !== 'TDS' ? a.amount : 0); }, 0); };
    const tds = payNum_(r['Monthly TDS (₹)']) + adj.reduce(function (t, a) { return t + (a.type === 'TDS' ? a.amount : 0); }, 0);
    const hold = /^f/i.test(String(inp['Hold (F&F/Grievance)'] || '')) ? 'fnf'
      : /^g/i.test(String(inp['Hold (F&F/Grievance)'] || '')) ? 'grievance'
      : payYes_(inp['Hold for F&F (Y/N)']) ? 'fnf' : '';
    const empArg = { esiCovered: payEsiCovered_(history[code], rates, settings, ctx0), fullBasic: payNum_(r['Full Basic']), epfMember: payYes_(r['EPF Member (Y/N)']), rrfMember: payYes_(r['RRF Member (Y/N)']),
      tuition: payNum_(r['Staff-Child Tuition']), doj: doj };
    const inputArg = { paidDays: paidDays, clDays: inp['CL Days Encashed'], hold: hold, release: inp['Release Held (₹)'],
      otherEarnings: sumDir('Earning'), otherDeductions: sumDir('Deduction'), loanRecovery: skipLoan ? 0 : loanDue, tds: tds };
    const ctxArg = Object.assign({ openingRrf: openingRrf[code] || 0 }, ctx0);
    const calc = payCalc_(empArg, inputArg, rates[entity], settings, ctxArg);
    calcArgs[code] = { emp: empArg, input: inputArg, rates: rates[entity], settings: settings, ctx: ctxArg };
    if (!payNum_(r['Full Basic'])) warnings.push({ entity: entity, text: code + ': Full Basic is 0' });
    rows.push(Object.assign({ code: code, name: String(r['Name'] || '').trim(), entity: entity,
      designation: String(r['Designation'] || '').trim(), adjustments: adj, heldBalance: heldBalance[code] || 0,
      probation: payMonthsBetween_(doj, monthEnd) < 12, vacRule: roleOf(r['Designation']), leave: leave[code] || null,
      rrfBalance: openingRrf[code] || 0, securityBalance: securityBalance[code] || 0, loanBalance: loanBalance[code] || 0, loanDue: loanDue,
      skipLoan: skipLoan, skipReason: String(inp['Skip Reason'] || ''),
      input: { paidDays: inp['Paid Days'] === undefined ? '' : inp['Paid Days'], clDays: inp['CL Days Encashed'] || '',
        hold: hold, release: inp['Release Held (₹)'] || '' } }, calc));
  });
  Object.keys(inputs).forEach(function (code) { if (!master[code]) warnings.push({ entity: '', text: code + ': has Monthly Inputs but no Salary Master row' }); });
  Object.keys(adjustments).forEach(function (code) { if (!master[code]) warnings.push({ entity: '', text: code + ': has Adjustments but no Salary Master row' }); });
  // calcArgs: code -> the exact {emp, input, rates, settings, ctx} passed to payCalc_ this month --
  // lets a caller re-run payCalc_ with a hypothetical Full Basic (annual increment preview) without
  // re-deriving entity rates/leave/adjustments/loan-recovery/etc. a second time.
  return { settings: settings, rates: rates, rows: rows, warnings: warnings, calcArgs: calcArgs };
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
    const k = month + '|' + code;
    if (!(k in idx)) { idx[k] = values.length; values.push(hdr.map(function () { return ''; })); }
    const row = values[idx[k]];
    const set = function (h, v) { row[col(h)] = v; };
    // Only the fields sent are changed -- e.g. a leave upload sets Paid Days
    // without touching a hold set earlier from the Holds card.
    set('Month', ctx.start); set('Employee Code', code);
    if ('paidDays' in r) set('Paid Days', num(r.paidDays, 'Paid Days', code, ctx.daysInMonth));
    if ('clDays' in r) set('CL Days Encashed', num(r.clDays, 'CL Days', code));
    if ('hold' in r) { set('Hold for F&F (Y/N)', ''); set('Hold (F&F/Grievance)', r.hold === 'fnf' ? 'F&F' : r.hold === 'grievance' ? 'Grievance' : ''); }
    if ('release' in r) set('Release Held (₹)', num(r.release, 'Release Held', code, held[code] || 0));
    if ('skipLoan' in r) {
      // Uday, 2026-09-30: skipping a recovery needs the employee's application -- record why.
      if (r.skipLoan && !String(r.skipReason || '').trim()) throw new Error(code + ': give a reason (the employee\'s application) to skip this month\'s recovery');
      set('Skip Loan Recovery (Y/N)', r.skipLoan ? 'Y' : ''); set('Skip Reason', r.skipLoan ? String(r.skipReason).trim() : '');
    }
    set('Updated By', caller.email); set('Updated At', now);
  });
  sheet.getRange(1, 1, values.length, hdr.length).setValues(values);
}

// ── Adjustments ──────────────────────────────────────────────────────
// d: {month, code, type, amount, note, endMonth (optional -- 'YYYY-MM', repeats the SAME
// adjustment on its own row for every month from month..endMonth, inclusive). Per Uday
// 2026-10-01: for recurring items (an allowance/recovery running several months) instead of
// adding it by hand each month. A month in the range that's already locked for this entity
// is skipped, not an error -- same "corrections go into next month" rule as a single add;
// capped at 36 months so a typo in endMonth can't silently queue years of rows.
function payAddAdjustment_(ss, d, caller) {
  const code = String(d.code || '').trim();
  const dir = PAY_ADJ_TYPES[d.type];
  if (!dir) throw new Error('Unknown adjustment type: ' + d.type);
  const amount = Number(d.amount);
  if (!(amount > 0)) throw new Error('Amount must be more than 0');
  const entity = payEntityOf_(ss)(code);
  if (!d.endMonth) {
    // Single month: the original, exact "go fix next month instead" error.
    payAssertOpen_(payLocks_(ss, d.month), entity, d.month);
    const ctx = payCheckMonth_(d.month);
    payAppend_(ss.getSheetByName('Adjustments'), [{ 'ID': Utilities.getUuid().slice(0, 8), 'Month': ctx.start, 'Employee Code': code,
      'Type': d.type, 'Direction': dir, 'Amount': Math.round(amount), 'Note': String(d.note || ''), 'Added By': caller.email, 'Added At': new Date() }]);
    return { months: [d.month], skippedLocked: [] };
  }
  payCheckMonth_(d.endMonth);
  const months = [String(d.month)];
  let m = d.month;
  while (m !== d.endMonth) {
    m = payNextMonth_(m);
    months.push(m);
    if (months.length > 36) throw new Error('That start/end range is more than 36 months -- check the end month');
  }
  if (months.length < 2) throw new Error('End month must be after the start month');
  const locks = {}; // month -> locks map, computed once per month
  const now = new Date(), rows = [], added = [], skippedLocked = [];
  months.forEach(function (month) {
    const ctx = payCheckMonth_(month);
    if (!(month in locks)) locks[month] = payLocks_(ss, month);
    if (locks[month][entity]) { skippedLocked.push(month); return; }
    rows.push({ 'ID': Utilities.getUuid().slice(0, 8), 'Month': ctx.start, 'Employee Code': code,
      'Type': d.type, 'Direction': dir, 'Amount': Math.round(amount), 'Note': String(d.note || ''), 'Added By': caller.email, 'Added At': now });
    added.push(month);
  });
  if (!rows.length) throw new Error('Every month from ' + d.month + ' to ' + d.endMonth + ' is already locked for ' + entity);
  payAppend_(ss.getSheetByName('Adjustments'), rows);
  return { months: added, skippedLocked: skippedLocked };
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
    if (r.loanRecovery) entry(r, 'Loan', 'Loan Repaid', -r.loanRecovery, 'Recovered from salary');
  });
  payAppend_(ss.getSheetByName('Ledger'), ledger);
}

// ── Leave template upload (stage b, 2026-09-30) ──────────────────────
// Designation -> vacation rule from JobRole Norms ("Vacations" / "Casual
// Leave" columns). ERP designations are spelled differently from JobRole
// Norms, so a few confident aliases; anything else -> '' (picked in the template).
const PAY_ROLE_ALIASES = { peoncumdriver: 'drivercumpeon', driver: 'drivercumpeon', daftri: 'drivercumdaftri',
  headmaster: 'headmasterprincipal', principal: 'headmasterprincipal', mdprincipal: 'headmasterprincipal',
  systemcoordinator: 'systemscoordinator', physicaltraininginstructor: 'gamesteacherpti', clerk: 'clerkpro',
  gardner: 'gardener', sweeperesspt: 'sweeper', md: 'mdoperations' };
function payNormRole_(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

function payJobRoles_(rs) {
  const map = {};
  const sh = rs.getSheetByName('JobRole Norms');
  if (sh) payRows_(sh).forEach(function (r) {
    const vac = String(r['Vacations'] || '').split('\n')[0].trim().toLowerCase();
    const rule = /^na$/i.test(String(r['Casual Leave'] || '').trim()) ? 'Not tracked'
      : /^half/.test(vac) ? 'Half' : /^no vacation/.test(vac) ? 'Works' : vac ? 'Full' : '';
    map[payNormRole_(r['Designation'])] = rule;
  });
  return function (designation) {
    const k = payNormRole_(designation);
    return map[k] !== undefined ? map[k] : map[PAY_ROLE_ALIASES[k]] || '';
  };
}

// Leave Records headers (one row per person per month from the template upload).
function payLeaveHeaders_() {
  return ['Month', 'Employee Code'].concat(PAY_LEAVE_FIELDS.map(function (f) { return f[1]; })).concat(['Opening CL Balance',
    'Opening Comp Balance', 'Vacation Rule', 'Vacation Working Days', 'Vacation Days Worked', 'Leave Days Charged', 'Comp Used',
    'CL Used', 'Unpaid Leave Days', 'Vacation Unpaid Days', 'Paid Days', 'Notes', 'Uploaded By', 'Uploaded At']);
}

function payLeaveRecord_(l) {
  const counts = {};
  PAY_LEAVE_FIELDS.forEach(function (f) { if (l[f[1]] !== '' && l[f[1]] !== undefined) counts[f[0]] = payNum_(l[f[1]]); });
  return { counts: counts, clBalance: l['Opening CL Balance'], compBalance: l['Opening Comp Balance'], vacRule: String(l['Vacation Rule'] || ''),
    vacDays: l['Vacation Working Days'], vacWorked: l['Vacation Days Worked'], charged: payNum_(l['Leave Days Charged']),
    compUsed: payNum_(l['Comp Used']), clUsed: payNum_(l['CL Used']), unpaidLeave: payNum_(l['Unpaid Leave Days']),
    vacUnpaid: payNum_(l['Vacation Unpaid Days']), paidDays: payNum_(l['Paid Days']), notes: String(l['Notes'] || '') };
}

// d: {month, vacDays: {entity: n}, rows: [{code, counts: {key: n}, clBalance, compBalance, vacRule, vacWorked}]}
// Converts every row (payLeaveConvert_) and, unless preview, saves Leave
// Records and sets Paid Days in Monthly Inputs. A row with nothing in it
// clears that person's earlier upload for the month. Returns the conversion.
function payUploadLeave_(ss, d, caller, preview) {
  const ctx = payCheckMonth_(d.month);
  const month = d.month;
  const locks = payLocks_(ss, month);
  const master = {};
  payRows_(ss.getSheetByName('Salary Master')).forEach(function (r) {
    const eff = payDate_(r['Effective From']);
    const code = String(r['Employee Code']).trim();
    if (eff && eff <= ctx.monthEnd && (!master[code] || eff >= master[code].eff)) master[code] = { eff: eff, row: r };
  });
  const existing = {};
  payForMonth_(ss, 'Leave Records', month).forEach(function (l) { existing[String(l['Employee Code']).trim()] = true; });
  const blank = function (v) { return v === '' || v === null || v === undefined; };
  const vacDays = {};
  Object.keys(d.vacDays || {}).forEach(function (e) {
    const n = blank(d.vacDays[e]) ? 0 : Number(d.vacDays[e]);
    if (!(n >= 0 && n <= ctx.daysInMonth && n === Math.floor(n))) throw new Error(e + ': vacation working days "' + d.vacDays[e] + '" is not valid');
    vacDays[payEntity_(e)] = n;
  });
  const num = function (v, label, code, max, whole) {
    if (blank(v)) return '';
    const n = Number(v);
    if (isNaN(n) || n < 0 || (max !== undefined && n > max) || (whole && n !== Math.floor(n))) throw new Error(code + ': ' + label + ' "' + v + '" is not valid');
    return n;
  };
  const out = [];
  (d.rows || []).forEach(function (r) {
    const code = String(r.code || '').trim();
    if (!master[code]) throw new Error(code + ': not in Salary Master for ' + month);
    const m = master[code].row;
    const entity = payEntity_(m['Entity']);
    if (locks[entity]) return; // locked schools are skipped, not an error -- the template may cover all schools
    const counts = {};
    PAY_LEAVE_FIELDS.forEach(function (f) { const v = num((r.counts || {})[f[0]], f[1], code, 99, true); if (v !== '' && v !== 0) counts[f[0]] = v; });
    const rule = String(r.vacRule || '');
    if (rule && PAY_VAC_RULES.indexOf(rule) === -1) throw new Error(code + ': unknown vacation rule "' + rule + '"');
    const l = { counts: counts, clBalance: num(r.clBalance, 'Opening CL Balance', code), compBalance: num(r.compBalance, 'Opening Comp Balance', code),
      vacRule: rule, vacDays: vacDays[entity] || 0, vacWorked: num(r.vacWorked, 'Vacation Days Worked', code, vacDays[entity] || 0, true),
      probation: payMonthsBetween_(payDate_(m['Date of Joining']), ctx.monthEnd) < 12 };
    const empty = !Object.keys(counts).length && !(l.vacDays && (l.probation || rule === 'Half'));
    if (empty && !existing[code]) return;
    const c = payLeaveConvert_(l, payEmployedDays_(payDate_(m['Date of Joining']), payDate_(m['Last Working Day']), ctx));
    if (l.vacDays && (l.probation || rule === 'Half') && blank(r.vacWorked)) c.notes.unshift('Vacation Days Worked left blank -- counted as 0');
    out.push(Object.assign({ code: code, name: String(m['Name'] || ''), entity: entity, clear: empty, input: l }, c));
  });
  if (preview) return out;

  // Replace this month's Leave Records for every uploaded person, then set Paid Days.
  const sheet = ss.getSheetByName('Leave Records');
  const values = sheet.getDataRange().getValues();
  const hdr = values[0].map(function (h) { return String(h).trim(); });
  const codes = {};
  out.forEach(function (o) { codes[o.code] = true; });
  for (let i = values.length - 1; i >= 1; i--) {
    if (payMonthKey_(values[i][hdr.indexOf('Month')]) === month && codes[String(values[i][hdr.indexOf('Employee Code')]).trim()]) sheet.deleteRow(i + 1);
  }
  const now = new Date();
  payAppend_(sheet, out.filter(function (o) { return !o.clear; }).map(function (o) {
    const row = { 'Month': ctx.start, 'Employee Code': o.code, 'Opening CL Balance': o.input.clBalance, 'Opening Comp Balance': o.input.compBalance,
      'Vacation Rule': o.input.vacRule, 'Vacation Working Days': o.input.vacDays, 'Vacation Days Worked': o.input.vacWorked,
      'Leave Days Charged': o.charged, 'Comp Used': o.compUsed, 'CL Used': o.clUsed, 'Unpaid Leave Days': o.unpaidLeave,
      'Vacation Unpaid Days': o.vacUnpaid, 'Paid Days': o.paidDays, 'Notes': o.notes.join('; '), 'Uploaded By': caller.email, 'Uploaded At': now };
    PAY_LEAVE_FIELDS.forEach(function (f) { row[f[1]] = f[0] in o.input.counts ? o.input.counts[f[0]] : ''; });
    return row;
  }));
  // Full month -> blank Paid Days (the "everyone else" default), so the leave list stays exceptions-only.
  paySaveInputs_(ss, month, out.map(function (o) { return { code: o.code, paidDays: o.paidDays === ctx.daysInMonth ? '' : o.paidDays }; }), caller);
  return out;
}

// ── Staff changes (stage c, 2026-09-30) ──────────────────────────────
// Offers recorded in the Offer Calculator (Salary Offers tab), their Owner
// decision in LMCS Approvals, and the Employee Master compared with the
// Salary Master: who is in the Staff Portal but not on payroll, who was
// marked Inactive or Transferred there, and who joined or left this month.
const PAY_ROSTER_SHEET_ID = '1OjVMUvpLM8JkdAwjmljCtZUI1VUqGLbic36cW9dm0C0'; // Employee Roster (EmpMaster)
// "LMCS Employee Roster Proxy" web app -- same URL salary/index.html, staff/add-employee.html etc.
// already use. payApplyIncrement_ calls its 'bumpincrement' action (2026-10-01, per Uday).
const PAY_ROSTER_WEB_URL = 'https://script.google.com/macros/s/AKfycbyHiaZY_iWK2VTKKFJcCsBNnIbUndJYUSjnPkxvJ-dYavaihiul2xBJuJohPRsP9Spf/exec';
const PAY_APPROVALS_SHEET_ID = '1Tr4Rfc6DN698eeGVjuCoXfSRR-NhBTWJibR00Ibj6P4'; // "LMCS Approvals"

// Allowlisted Principal / Coordinator / Owner -- only for recordoffer, which
// can append an offer and read nothing back.
function payVerifyStaff_(idToken) {
  const c = payVerifyAllowlist_(idToken);
  return c && c.roles.some(function (r) { return ['Owner', 'Coordinator', 'Principal'].indexOf(r) !== -1; }) ? c : null;
}

// Cached 5 min, same as payCachedOwner_ -- speed fix (audit 2026-10-01): recordoffer
// is called on every "Record as Salary Offer" click (Offer Calculator), each one a
// tokeninfo round trip plus a full Allowlist sheet read with no caching at all.
function payCachedStaff_(idToken) {
  const key = 'pay_stafftok_' + Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, idToken || '')
    .map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join('');
  const cache = CacheService.getScriptCache();
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const staff = payVerifyStaff_(idToken);
  if (staff) cache.put(key, JSON.stringify(staff), 300);
  return staff;
}

// Days employed in the month: from the later of month start / joining date
// to the earlier of month end / last working day. Default paid days for
// joiners and leavers.
function payEmployedDays_(doj, lwd, ctx) {
  const from = doj && doj > ctx.start ? doj : ctx.start;
  const to = lwd && lwd < ctx.monthEnd ? lwd : ctx.monthEnd;
  return Math.max(0, Math.round((new Date(to.getFullYear(), to.getMonth(), to.getDate()) - new Date(from.getFullYear(), from.getMonth(), from.getDate())) / 86400000) + 1);
}

function payNormName_(s) { return String(s || '').toLowerCase().replace(/[^a-z]/g, ''); }
function payIso_(d) { return d instanceof Date && !isNaN(d) ? Utilities.formatDate(d, PAY_TZ, 'yyyy-MM-dd') : ''; }

// Latest Salary Master row per code (any date), with its sheet row number.
function payMasterLatest_(ss) {
  const sheet = ss.getSheetByName('Salary Master');
  const values = sheet.getDataRange().getValues();
  const hdr = values[0].map(function (h) { return String(h).trim(); });
  const out = {};
  for (let i = 1; i < values.length; i++) {
    const o = {};
    hdr.forEach(function (h, j) { o[h] = values[i][j]; });
    const code = String(o['Employee Code'] || '').trim();
    const eff = payDate_(o['Effective From']);
    if (code && (!out[code] || (eff && eff >= out[code].eff))) out[code] = { eff: eff, row: o, rowNum: i + 1 };
  }
  return out;
}

function payApprovalStatus_() {
  const out = {};
  try {
    const values = payOpenById_(PAY_APPROVALS_SHEET_ID).getSheetByName('Approvals').getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][2]) !== 'Salary Offer Approval') continue;
      const m = String(values[i][7] || '').match(/T-\d{4}/);
      if (m) out[m[0]] = String(values[i][13] || 'Pending'); // later rows win
    }
  } catch (e) { /* approvals unreadable -> shown as unknown */ }
  return out;
}


// ── Hiring Dashboard hand-off (2026-10-05, per Uday) ───────────────────
// The Principal enters the Date of Joining in the Hiring Dashboard (Teaching Applicants workbook,
// column Q, text yyyy-MM-dd; the locked employee code is column P; row = digits of the applicant id,
// T-0943 -> row 943). Payroll reads it from there instead of asking again. Returns
// {ok: false} when that sheet can't be read (callers then fall back to the typed date) and
// {ok: true, doj: '' | 'yyyy-MM-dd', code} otherwise.
const PAY_HIRING_SHEET_ID = '1aSCQ3IGO-ZP_5yRjtnMpZdlauTdWj3814ATD9qwskPQ'; // "Teaching Applicants"
const PAY_HIRING_SHEET_GID = 1181288827;
function payHiringInfo_(id) {
  try {
    const row = Number(String(id).replace(/\D/g, ''));
    if (!row) return { ok: false };
    const book = payOpenById_(PAY_HIRING_SHEET_ID);
    const sh = book.getSheetByName('Form Responses 1') || null;
    let sheet = sh;
    if (!sheet && book.getSheets) sheet = book.getSheets().filter(function (x) { return x.getSheetId() === PAY_HIRING_SHEET_GID; })[0];
    if (!sheet) return { ok: false };
    const v = sheet.getRange(row, 16, 1, 2).getValues()[0];
    const d = v[1];
    const doj = d instanceof Date ? payIso_(d) : (/^\d{4}-\d{2}-\d{2}/.test(String(d)) ? String(d).slice(0, 10) : '');
    return { ok: true, doj: doj, code: String(v[0] || '').trim() };
  } catch (e) { return { ok: false }; }
}

function payOfferApproved_(status) { return /^approved$/i.test(String(status || '').trim()); }

function payStaffChanges_(ss, month) {
  const ctx = payCheckMonth_(month);
  const latest = payMasterLatest_(ss);
  const emp = payOpenById_(PAY_ROSTER_SHEET_ID);
  const roster = payRows_(emp.getSheetByName('EmpMaster')).map(function (r) {
    return { code: String(r['EmployeeCode'] || '').trim(), name: String(r['Name'] || '').trim(), entity: payEntity_(r['SchoolCode']),
      doj: payIso_(payDate_(r['DateOfJoining'])), status: String(r['Status'] || '').trim() || 'Active', dorel: payIso_(payDate_(r['DoRel'])) };
  }).filter(function (r) { return r.code; });
  const desig = {};
  const es = emp.getSheetByName('EmpSalary');
  if (es) payRows_(es).forEach(function (r) { desig[String(r['EmployeeCode'] || '').trim()] = String(r['Designation'] || '').trim(); });
  const inRoster = {};
  roster.forEach(function (r) { inRoster[r.code] = r; });
  const active = function (code) { return latest[code] && !/^left/i.test(String(latest[code].row['Status (Active/Left)'] || '')); };

  const approvals = payApprovalStatus_();
  const offers = payRows_(ss.getSheetByName('Salary Offers')).filter(function (o) { return /^offered/i.test(String(o['Status (Offered/Joined/Dismissed)'] || 'Offered')); })
    .map(function (o) {
      const id = String(o['Applicant ID']).trim();
      return { id: id, name: String(o['Name'] || ''), entity: payEntity_(o['Entity']), designation: String(o['Designation'] || ''),
        subjects: String(o['Subjects'] || ''), fullBasic: payNum_(o['Full Basic']), epf: payYes_(o['EPF Member (Y/N)']),
        tuition: payNum_(o['Staff-Child Tuition']), cti: payNum_(o['CTI']), recordedBy: String(o['Recorded By'] || ''),
        recordedAt: payStamp_(o['Recorded At']), approval: approvals[id] || 'Not submitted', hiring: payHiringInfo_(id) };
    })
    // Only Owner-approved offers are actionable here (2026-10-03, per Uday): the list has a live
    // "Joined" button, so Pending / Rejected / Not-submitted offers must not appear at all.
    .filter(function (o) { return payOfferApproved_(o.approval); });

  const transfers = [], left = [], newCodes = {};
  Object.keys(latest).forEach(function (code) {
    if (!active(code)) return;
    const r = inRoster[code];
    if (!r || r.status === 'Active') return;
    if (/^transferred/i.test(r.status)) {
      const yymm = code.split('/').slice(1, 3).join('/');
      const to = roster.filter(function (x) { return x.status === 'Active' && !latest[x.code] && payNormName_(x.name) === payNormName_(r.name) && x.code.split('/').slice(1, 3).join('/') === yymm; })[0];
      if (to) { newCodes[to.code] = true; transfers.push({ oldCode: code, name: r.name, from: payEntity_(latest[code].row['Entity']), newCode: to.code, to: to.entity }); return; }
    }
    left.push({ code: code, name: String(latest[code].row['Name'] || r.name), entity: payEntity_(latest[code].row['Entity']), status: r.status, dorel: r.dorel });
  });
  const notOnPayroll = roster.filter(function (r) { return r.status === 'Active' && !latest[r.code] && !newCodes[r.code]; })
    .map(function (r) {
      const offer = offers.filter(function (o) { return payNormName_(o.name) === payNormName_(r.name); })[0];
      return { code: r.code, name: r.name, entity: r.entity, doj: r.doj, designation: desig[r.code] || '', offerId: offer ? offer.id : '' };
    });
  const notInRoster = Object.keys(latest).filter(function (c) { return active(c) && !inRoster[c]; })
    .map(function (c) { return { code: c, name: String(latest[c].row['Name'] || ''), entity: payEntity_(latest[c].row['Entity']) }; });

  // Joined or leaving within this month (prorated automatically).
  const joiners = [], leavers = [];
  Object.keys(latest).forEach(function (code) {
    const r = latest[code].row;
    const doj = payDate_(r['Date of Joining']), lwd = payDate_(r['Last Working Day']);
    const base = { code: code, name: String(r['Name'] || ''), entity: payEntity_(r['Entity']) };
    if (doj && doj >= ctx.start && doj <= ctx.monthEnd) joiners.push(Object.assign({ date: payIso_(doj), days: payEmployedDays_(doj, lwd, ctx) }, base));
    if (lwd && lwd >= ctx.start && lwd <= ctx.monthEnd) leavers.push(Object.assign({ date: payIso_(lwd), days: payEmployedDays_(doj, lwd, ctx) }, base));
  });
  return { offers: offers, notOnPayroll: notOnPayroll, transfers: transfers, left: left, notInRoster: notInRoster, joiners: joiners, leavers: leavers };
}

// ── Staff change actions ─────────────────────────────────────────────
// d: {applicantId, name, entity, designation, subjects, fullBasic, epf, tuition, cti, netY1}
// Upserted by Applicant ID; a joined/dismissed offer is not reopened.
function payRecordOffer_(ss, d, caller) {
  payStaffChanged_(); // staff lists are cached -- refresh them after any staff change
  const id = String(d.applicantId || '').trim();
  if (!/^T-\d{4}$/.test(id)) throw new Error('applicantId must look like T-0000');
  const entity = payEntity_(d.entity);
  if (PAY_ENTITIES.indexOf(entity) === -1) throw new Error('Unknown school: ' + d.entity);
  const basic = Number(d.fullBasic);
  if (!(basic > 0)) throw new Error('Full Basic must be more than 0');
  const sheet = ss.getSheetByName('Salary Offers');
  const values = sheet.getDataRange().getValues();
  const hdr = values[0].map(function (h) { return String(h).trim(); });
  const obj = { 'Applicant ID': id, 'Name': String(d.name || '').trim(), 'Entity': entity, 'Designation': String(d.designation || ''),
    'Subjects': String(d.subjects || ''), 'Full Basic': Math.round(basic), 'EPF Member (Y/N)': d.epf ? 'Y' : 'N',
    'Staff-Child Tuition': Math.round(Number(d.tuition) || 0), 'CTI': Math.round(Number(d.cti) || 0), 'Net Y1': Math.round(Number(d.netY1) || 0),
    'Recorded By': caller.email, 'Recorded At': new Date(), 'Status (Offered/Joined/Dismissed)': 'Offered' };
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][hdr.indexOf('Applicant ID')]).trim() !== id) continue;
    if (!/^offered/i.test(String(values[i][hdr.indexOf('Status (Offered/Joined/Dismissed)')] || 'Offered'))) throw new Error(id + ' is already ' + values[i][hdr.indexOf('Status (Offered/Joined/Dismissed)')]);
    sheet.getRange(i + 1, 1, 1, hdr.length).setValues([hdr.map(function (h, j) { return h in obj ? obj[h] : values[i][j]; })]);
    return;
  }
  payAppend_(sheet, [obj]);
}

function payCloseOffer_(ss, id, status, extra, caller) {
  payStaffChanged_(); // staff lists are cached -- refresh them after any staff change
  const sheet = ss.getSheetByName('Salary Offers');
  const values = sheet.getDataRange().getValues();
  const hdr = values[0].map(function (h) { return String(h).trim(); });
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][hdr.indexOf('Applicant ID')]).trim() !== id) continue;
    const o = Object.assign({ 'Status (Offered/Joined/Dismissed)': status, 'Closed By': caller.email, 'Closed At': new Date() }, extra);
    sheet.getRange(i + 1, 1, 1, hdr.length).setValues([hdr.map(function (h, j) { return h in o ? o[h] : values[i][j]; })]);
    return values[i].reduce(function (acc, v, j) { acc[hdr[j]] = v; return acc; }, {});
  }
  throw new Error('Offer not found: ' + id);
}

function payNewMasterRow_(ss, d, caller) {
  payStaffChanged_(); // staff lists are cached -- refresh them after any staff change
  const code = String(d.code || '').trim();
  if (!/^[A-Z]{3}\/\d{2}\/\d{2}\/\d+$/.test(code)) throw new Error('Employee code "' + code + '" does not look like KUL/26/10/123');
  if (payMasterLatest_(ss)[code]) throw new Error(code + ' is already on payroll');
  const doj = payDate_(d.doj);
  if (!doj) throw new Error('Date of Joining is required');
  const entity = payEntity_(d.entity);
  if (PAY_ENTITIES.indexOf(entity) === -1) throw new Error('Unknown school: ' + d.entity);
  const basic = Number(d.fullBasic);
  if (!(basic > 0)) throw new Error('Full Basic must be more than 0');
  payAppend_(ss.getSheetByName('Salary Master'), [{ 'Employee Code': code, 'Name': String(d.name || '').trim(), 'Entity': entity,
    'Designation': String(d.designation || ''), 'Date of Joining': doj, 'Effective From': doj, 'Full Basic': Math.round(basic),
    'EPF Member (Y/N)': d.epf ? 'Y' : 'N', 'RRF Member (Y/N)': d.rrf === false ? 'N' : 'Y', 'Staff-Child Tuition': Math.round(Number(d.tuition) || 0),
    'Status (Active/Left)': 'Active', 'Remarks': String(d.remarks || 'Added by ' + caller.email) }]);
}

// d: {applicantId, code, doj} -- offer -> Salary Master row, offer marked Joined.
function payJoinOffer_(ss, d, caller) {
  const o = payRows_(ss.getSheetByName('Salary Offers')).filter(function (x) {
    return String(x['Applicant ID']).trim() === d.applicantId && /^offered/i.test(String(x['Status (Offered/Joined/Dismissed)'] || 'Offered'));
  })[0];
  if (!o) throw new Error('Open offer not found: ' + d.applicantId);
  // The joining date comes from the Hiring Dashboard when that sheet is readable (it is authoritative);
  // a missing date there blocks Joined, an unreadable sheet falls back to the date typed on the page.
  const hiring = payHiringInfo_(d.applicantId);
  if (hiring.ok) {
    if (!hiring.doj) throw new Error(d.applicantId + ': the Principal has not entered the Date of Joining in the Hiring Dashboard yet');
    d.doj = hiring.doj;
  }
  const approval = payApprovalStatus_()[d.applicantId];
  if (!payOfferApproved_(approval)) throw new Error(d.applicantId + ' is not Owner-approved (status: ' + (approval || 'Not submitted') + ') -- it cannot be joined');
  payNewMasterRow_(ss, { code: d.code, name: o['Name'], entity: o['Entity'], designation: o['Designation'], doj: d.doj, fullBasic: payNum_(o['Full Basic']),
    epf: payYes_(o['EPF Member (Y/N)']), rrf: true, tuition: payNum_(o['Staff-Child Tuition']), remarks: 'From offer ' + d.applicantId }, caller);
  payCloseOffer_(ss, d.applicantId, 'Joined', { 'Employee Code': String(d.code).trim(), 'Date of Joining': payDate_(d.doj) }, caller);
}

// d: {code, lastDay} -- the latest Salary Master row becomes Left with a last working day.
function payMarkLeft_(ss, d) {
  payStaffChanged_(); // staff lists are cached -- refresh them after any staff change
  const latest = payMasterLatest_(ss)[String(d.code || '').trim()];
  if (!latest) throw new Error(d.code + ': not on payroll');
  const lwd = payDate_(d.lastDay);
  if (!lwd) throw new Error('Last working day is required');
  const sheet = ss.getSheetByName('Salary Master');
  const hdr = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
  sheet.getRange(latest.rowNum, hdr.indexOf('Status (Active/Left)') + 1).setValue('Left');
  sheet.getRange(latest.rowNum, hdr.indexOf('Last Working Day') + 1).setValue(lwd);
}

// d: {month, oldCode, newCode, entity} -- per Uday, the whole month is paid at
// the new school: old code ends the day before this month, new code starts on
// the 1st with the same pay and joining date, and RRF / held-salary balances
// move across (entries dated last month, so they count in this month's opening).
function payApplyTransfer_(ss, d, caller) {
  payStaffChanged_(); // staff lists are cached -- refresh them after any staff change
  const ctx = payCheckMonth_(d.month);
  const latest = payMasterLatest_(ss);
  const old = latest[String(d.oldCode || '').trim()];
  if (!old) throw new Error(d.oldCode + ': not on payroll');
  if (latest[String(d.newCode || '').trim()]) throw new Error(d.newCode + ' is already on payroll');
  const r = old.row;
  payMarkLeft_(ss, { code: d.oldCode, lastDay: new Date(ctx.start.getTime() - 86400000) });
  const row = {};
  Object.keys(r).forEach(function (h) { row[h] = r[h]; });
  Object.assign(row, { 'Employee Code': String(d.newCode).trim(), 'Entity': payEntity_(d.entity), 'Effective From': ctx.start,
    'Status (Active/Left)': 'Active', 'Last Working Day': '', 'Remarks': 'Transferred from ' + d.oldCode });
  payAppend_(ss.getSheetByName('Salary Master'), [row]);
  const prevMonth = new Date(ctx.start.getFullYear(), ctx.start.getMonth() - 1, 1);
  const now = new Date(), ledger = [];
  ['RRF', 'Held Salary', 'Security', 'Loan'].forEach(function (acct) {
    const bal = payLedgerBalances_(ss, acct, d.month)[d.oldCode] || 0;
    if (!bal) return;
    [[d.oldCode, -bal], [d.newCode, bal]].forEach(function (x) {
      ledger.push({ 'Date': now, 'Month': prevMonth, 'Employee Code': x[0], 'Account (RRF/Security/Loan/Held Salary)': acct,
        'Type (Opening/Deduction/Payout/Loan Issued/Loan Repaid/Adjustment)': 'Adjustment', 'Amount': x[1],
        'Reference': 'Transfer ' + d.oldCode + ' -> ' + d.newCode, 'Notes': '', 'Entered By': caller.email, 'Entered At': now });
    });
  });
  payAppend_(ss.getSheetByName('Ledger'), ledger);
}

// ── Annual increment (2026-10-01, per Uday) ───────────────────────────
// Flat Annual Increment % on Full Basic, every September, for anyone who's
// completed 36 months -- the same cutoff as the RRF Y3 tier in payCalc_, so
// "finished the RRF cycle" and "increment-eligible" are literally the same
// check. Recurring: there's no year limit, so someone keeps getting it every
// September for as long as they're employed. Skips anyone already given an
// increment for this exact month (the Increments tab is the record of that,
// not a Remarks-text guess). Only touches Payroll's own Salary Master Full
// Basic -- the Roster's separate EmpSalary.Increment count (used by the
// Offer Calculator) is NOT updated here, see audit/REPORT.md.
// times: how many increments to compound in one go (Owner-only feature -- every caller
// of this is already Owner, payCachedOwner_ gates the whole backend). Defaults to 1,
// the normal "one September" case; >1 compounds like that many separate annual runs
// would, rounding after each step, for a deliberate multi-year catch-up.
function payIncrementEligible_(ss, month, times) {
  const ctx = payCheckMonth_(month);
  const n = Math.max(1, Math.round(Number(times) || 1));
  const master = {};
  payRows_(ss.getSheetByName('Salary Master')).forEach(function (r) {
    const code = String(r['Employee Code'] || '').trim();
    const eff = payDate_(r['Effective From']);
    if (!code || !eff || eff > ctx.monthEnd) return;
    const lwd = payDate_(r['Last Working Day']);
    if (lwd ? lwd < ctx.start : /^left/i.test(String(r['Status (Active/Left)'] || ''))) return;
    if (!master[code] || eff >= master[code].eff) master[code] = { eff: eff, row: r };
  });
  const already = {};
  payForMonth_(ss, 'Increments', month).forEach(function (r) { if (!String(r['Undone At'] || '').trim()) already[String(r['Employee Code']).trim()] = true; });
  const live = payCompute_(ss, month);
  const byCode = {};
  live.rows.forEach(function (r) { byCode[r.code] = r; });
  const pct = live.settings.annualIncrementPct;
  const out = [];
  Object.keys(master).forEach(function (code) {
    if (already[code]) return;
    const r = master[code].row;
    const doj = payDate_(r['Date of Joining']);
    const basic = payNum_(r['Full Basic']);
    if (!doj || !basic || payMonthsBetween_(doj, ctx.monthEnd) < 36) return;
    let newBasic = basic;
    for (let i = 0; i < n; i++) newBasic = Math.round(newBasic * (1 + pct / 100));
    const row = { code: code, name: String(r['Name'] || ''), entity: payEntity_(r['Entity']), designation: String(r['Designation'] || ''),
      doj: payIso_(doj), months: payMonthsBetween_(doj, ctx.monthEnd), basic: basic, newBasic: newBasic, rate: pct, times: n };
    // Projected Net Pay/CTI this month with the new Basic -- re-runs the REAL payCalc_
    // with everything else about this month unchanged (paid days, leave, adjustments,
    // loan recovery, holds), not a guess from the % alone.
    const args = live.calcArgs[code], current = byCode[code];
    if (args && current) {
      const projected = payCalc_(Object.assign({}, args.emp, { fullBasic: newBasic }), args.input, args.rates, args.settings, args.ctx);
      row.oldNet = current.net; row.newNet = projected.net; row.oldCti = current.cti; row.newCti = projected.cti;
    }
    out.push(row);
  });
  out.sort(payCompareStaff_);
  return out;
}

// d: {month, codes (optional -- restrict to a subset of the preview, else everyone eligible)}
function payApplyIncrement_(ss, d, caller, idToken) {
  const ctx = payCheckMonth_(d.month);
  const want = d.codes && d.codes.length ? {} : null;
  if (want) d.codes.forEach(function (c) { want[String(c).trim()] = true; });
  const eligible = payIncrementEligible_(ss, d.month, d.times).filter(function (e) { return !want || want[e.code]; });
  if (!eligible.length) throw new Error('Nothing eligible to increment for ' + d.month);
  const latest = payMasterLatest_(ss);
  const now = new Date();
  const runId = 'R-' + Utilities.getUuid().slice(0, 6);
  const settings = paySettings_(payOpenById_(PAY_RATES_SHEET_ID));
  const newRows = [], incRows = [], appliedCodes = [];
  eligible.forEach(function (e) {
    const src = latest[e.code] && latest[e.code].row;
    if (!src) return;
    const row = {};
    Object.keys(src).forEach(function (h) { row[h] = src[h]; });
    Object.assign(row, { 'Full Basic': e.newBasic, 'Effective From': ctx.start,
      'Remarks': 'Annual Increment ' + d.month + ' (+' + e.rate + '%' + (e.times > 1 ? ' x ' + e.times : '') + ') [' + runId + ']' });
    newRows.push(row);
    incRows.push({ 'Month': ctx.start, 'Employee Code': e.code, 'Name': e.name, 'Entity': e.entity, 'Old Basic': e.basic,
      'New Basic': e.newBasic, 'Rate %': e.rate, 'Times': e.times, 'Applied By': caller.email, 'Applied At': now,
      'Run ID': runId, 'Roster Synced (Y/N)': settings.syncRosterIncrement ? 'Y' : 'N' });
    appliedCodes.push(e.code);
  });
  payAppend_(ss.getSheetByName('Salary Master'), newRows);
  payAppend_(ss.getSheetByName('Increments'), incRows);
  if (!settings.syncRosterIncrement) return { runId: runId, rosterSync: { success: true, skipped: true, updated: [], notFound: [] } };
  return { runId: runId, rosterSync: payBumpRosterIncrement_(appliedCodes, idToken) };
}

// Runs applied for a month, newest first, for the Undo list.
function payIncrementRuns_(ss, month) {
  const runs = {}, order = [];
  payForMonth_(ss, 'Increments', month).forEach(function (r) {
    const id = String(r['Run ID'] || '').trim() || 'earlier';
    if (!runs[id]) { runs[id] = { runId: id, count: 0, undone: 0, appliedBy: String(r['Applied By'] || ''), appliedAt: payStamp_(r['Applied At']), times: payNum_(r['Times']) || 1,
      rate: payNum_(r['Rate %']), rosterSynced: payYes_(r['Roster Synced (Y/N)']) }; order.push(id); }
    runs[id].count++;
    if (String(r['Undone At'] || '').trim()) runs[id].undone++;
  });
  return order.reverse().map(function (id) { return runs[id]; });
}

// Undo one run: delete exactly the Salary Master rows it wrote (found by code + that month's Effective
// From + the run id in Remarks) and mark its Increments rows undone (kept, not deleted). All-or-nothing:
// nothing is touched unless every person can be undone cleanly. Refused when a school is locked for the
// month (the locked register already holds the new pay -- unlock first) or the person has a LATER
// Salary Master row (a transfer / newer raise sits on top of it -- undo that first).
// d: {month, runId}
function payUndoIncrement_(ss, d, caller) {
  const ctx = payCheckMonth_(d.month);
  const runId = String(d.runId || '').trim();
  if (!/^R-/.test(runId)) throw new Error('This run has no id (it predates undo) -- delete its Salary Master rows by hand');
  const inc = ss.getSheetByName('Increments'), iv = inc.getDataRange().getValues();
  const ih = iv[0].map(function (h) { return String(h).trim(); });
  const mine = [];
  for (let i = 1; i < iv.length; i++) {
    if (String(iv[i][ih.indexOf('Run ID')]).trim() === runId && payMonthKey_(iv[i][ih.indexOf('Month')]) === d.month) mine.push(i);
  }
  if (!mine.length) throw new Error('Run ' + runId + ' not found for ' + d.month);
  if (mine.every(function (i) { return String(iv[i][ih.indexOf('Undone At')] || '').trim(); })) throw new Error('Run ' + runId + ' was already undone');
  const locks = payLocks_(ss, d.month);
  const sm = ss.getSheetByName('Salary Master'), sv = sm.getDataRange().getValues();
  const sh = sv[0].map(function (h) { return String(h).trim(); });
  const problems = [], deleteRows = [], undoIdx = [];
  mine.forEach(function (i) {
    if (String(iv[i][ih.indexOf('Undone At')] || '').trim()) return;
    const code = String(iv[i][ih.indexOf('Employee Code')]).trim(), entity = payEntity_(iv[i][ih.indexOf('Entity')]);
    if (locks[entity]) { problems.push(code + ': ' + entity + ' is locked for ' + d.month + ' -- unlock it first'); return; }
    let found = -1, later = '';
    for (let j = 1; j < sv.length; j++) {
      if (String(sv[j][sh.indexOf('Employee Code')]).trim() !== code) continue;
      const eff = payDate_(sv[j][sh.indexOf('Effective From')]);
      if (eff && eff > ctx.start) later = payIso_(eff);
      if (String(sv[j][sh.indexOf('Remarks')] || '').indexOf('[' + runId + ']') !== -1) found = j;
    }
    if (found === -1) { problems.push(code + ': the Salary Master row written by this run is gone'); return; }
    if (later) { problems.push(code + ': has a later Salary Master row (effective ' + later + ') -- undo or remove that first'); return; }
    deleteRows.push(found + 1);
    undoIdx.push(i);
  });
  if (problems.length) throw new Error('Cannot undo ' + runId + ': ' + problems.slice(0, 12).join('; ') + (problems.length > 12 ? ' ...' : ''));
  deleteRows.sort(function (a, b) { return b - a; }).forEach(function (r) { sm.deleteRow(r); });
  const now = new Date();
  undoIdx.forEach(function (i) {
    inc.getRange(i + 1, ih.indexOf('Undone By') + 1).setValue(caller.email);
    inc.getRange(i + 1, ih.indexOf('Undone At') + 1).setValue(now);
  });
  const synced = mine.some(function (i) { return payYes_(iv[i][ih.indexOf('Roster Synced (Y/N)')]); });
  return { undone: undoIdx.length, undoNote: synced ? 'The Roster\'s EmpSalary.Increment counts were bumped when this run was applied -- reduce them by 1 there by hand (Payroll cannot do that yet).' : '' };
}

// Best-effort cross-project call: the Roster's own EmpSalary.Increment count
// (used by the Offer Calculator) is a SEPARATE Apps Script project/sheet from
// Payroll's own Salary Master, which is already updated by the time this
// runs and remains the source of truth for actual pay regardless of whether
// this call succeeds. Reuses the SAME Google ID token the caller signed in
// with -- re-verified independently against the Roster project's own
// Allowlist, not trusted from Payroll's side. Never throws: a failure here
// is reported back for the Owner to see and retry/do by hand, not a reason
// to fail the increment that already landed in Payroll.
function payBumpRosterIncrement_(codes, idToken) {
  if (!codes.length) return { success: true, updated: [], notFound: [] };
  try {
    const url = PAY_ROSTER_WEB_URL + '?action=bumpincrement&idToken=' + encodeURIComponent(idToken) + '&data=' + encodeURIComponent(JSON.stringify({ codes: codes }));
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const body = JSON.parse(res.getContentText());
    if (!body.success) return { success: false, error: body.error || ('HTTP ' + res.getResponseCode()) };
    return { success: true, updated: body.updated || [], notFound: body.notFound || [] };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Staff changes read the Employee Master and Approvals -- if either is
// unreachable the month still opens, with the reason on the card.
// Cached 5 minutes (it opens the Employee Master and Approvals workbooks); any
// staff action in payroll bumps the generation so its result shows at once.
function payStaffSafe_(ss, month) {
  const cache = CacheService.getScriptCache();
  const key = 'pay_staff_' + month + '_' + (cache.get('pay_staff_gen') || '0');
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  try {
    const out = payStaffChanges_(ss, month);
    const json = JSON.stringify(out);
    if (json.length < 90000) cache.put(key, json, 300);
    return out;
  } catch (e) { return { error: e.message }; }
}
// A counter, not Date.now() -- two staff-changing writes inside the same millisecond
// (overnight audit, 2026-10-01) produced the same "generation" token, so the second
// write's payMonth_ call read the first write's now-stale cached staff-changes entry
// for the month it just changed (e.g. a just-joined offer still showing as pending).
// Every caller holds the script lock already, so this read-then-write is safe.
function payStaffChanged_() {
  const cache = CacheService.getScriptCache();
  cache.put('pay_staff_gen', String(Number(cache.get('pay_staff_gen') || '0') + 1), 21600);
}

// ── Unlock (2026-09-30, per Uday -- for accidental locks) ────────────
// Removes one school's lock for a month: its Run Log "Locked" row, its
// Payroll Register rows, and the Ledger entries that lock wrote (Reference
// "Payroll <month>" for that school's employees). Refused if a LATER month is
// locked for the school -- that month's RRF / held balances were built on this
// one. Leaves an "Unlocked" Run Log row as the audit trail.
function payUnlock_(ss, month, entity, caller) {
  const ctx = payCheckMonth_(month);
  const e = payEntity_(entity);
  if (!payLocks_(ss, month)[e]) throw new Error(e + ' is not locked for ' + month);
  const later = payRows_(ss.getSheetByName('Run Log')).filter(function (r) {
    return payEntity_(r['Entity']) === e && /^locked/i.test(String(r['Status (Draft/Locked)'] || '')) && payMonthKey_(r['Month']) > month;
  }).map(function (r) { return payMonthKey_(r['Month']); });
  if (later.length) throw new Error(e + ' is also locked for ' + later.join(', ') + ' -- unlock the latest month first');

  const codes = {};
  payForMonth_(ss, 'Payroll Register', month).forEach(function (r) { if (payEntity_(r['Entity']) === e) codes[String(r['Employee Code']).trim()] = true; });
  const del = function (tab, match) {
    const sheet = ss.getSheetByName(tab);
    const values = sheet.getDataRange().getValues();
    const hdr = values[0].map(function (h) { return String(h).trim(); });
    let n = 0;
    for (let i = values.length - 1; i >= 1; i--) {
      const o = {};
      hdr.forEach(function (h, j) { o[h] = values[i][j]; });
      if (match(o)) { sheet.deleteRow(i + 1); n++; }
    }
    return n;
  };
  const sameMonth = function (o) { return payMonthKey_(o['Month']) === month; };
  const reg = del('Payroll Register', function (o) { return sameMonth(o) && payEntity_(o['Entity']) === e; });
  const led = del('Ledger', function (o) { return String(o['Reference'] || '') === 'Payroll ' + month && codes[String(o['Employee Code']).trim()]; });
  del('Run Log', function (o) { return sameMonth(o) && payEntity_(o['Entity']) === e && /^locked/i.test(String(o['Status (Draft/Locked)'] || '')); });
  payAppend_(ss.getSheetByName('Run Log'), [{ 'Month': ctx.start, 'Entity': e, 'Status (Draft/Locked)': 'Unlocked', 'Headcount': reg,
    'Locked By': caller.email, 'Locked At': new Date(), 'Notes': 'Unlocked: removed ' + reg + ' register row(s) and ' + led + ' ledger entr' + (led === 1 ? 'y' : 'ies') }]);
}

// ── Stage 4: balances, loans, gratuity, F&F (2026-09-30) ─────────────
// Balances live in the Ledger as signed amounts per account (RRF, Security,
// Held Salary: money the school holds for the employee; Loan: money the
// employee owes). Opening balances come from Tally as of 31 Aug 2026.
const PAY_OPENING_REF = 'Opening 31-Aug-2026';
const PAY_OPENING_MONTH = new Date(2026, 7, 1); // August -> counts as opening for September onward
const PAY_ACCOUNTS = ['RRF', 'Security', 'Held Salary', 'Loan'];

function payLedgerAll_(ss) {
  return payRows_(ss.getSheetByName('Ledger')).map(function (r) {
    return { code: String(r['Employee Code']).trim(), account: String(r['Account (RRF/Security/Loan/Held Salary)'] || '').trim(),
      type: String(r['Type (Opening/Deduction/Payout/Loan Issued/Loan Repaid/Adjustment)'] || ''), amount: payNum_(r['Amount']),
      month: payMonthKey_(r['Month']), reference: String(r['Reference'] || ''), notes: String(r['Notes'] || '') };
  });
}

// code -> {RRF, Security, Held Salary, Loan} over every ledger entry (current balances).
function payBalancesNow_(ss) {
  const out = {};
  payLedgerAll_(ss).forEach(function (e) {
    const b = out[e.code] = out[e.code] || { 'RRF': 0, 'Security': 0, 'Held Salary': 0, 'Loan': 0 };
    const acct = PAY_ACCOUNTS.filter(function (a) { return a.toLowerCase() === e.account.toLowerCase(); })[0];
    if (acct) b[acct] += e.amount;
  });
  return out;
}

// code -> sum of Monthly Recovery for active loans that have started by `month`.
function payLoanSchedules_(ss, month) {
  const out = {};
  payRows_(ss.getSheetByName('Loans')).forEach(function (l) {
    if (/^closed/i.test(String(l['Status (Active/Closed)'] || ''))) return;
    const start = payMonthKey_(l['Start Month']);
    if (start && start > month) return;
    const code = String(l['Employee Code']).trim();
    out[code] = (out[code] || 0) + payNum_(l['Monthly Recovery']);
  });
  return out;
}

// ── Opening balance import (from the confirmed Tally mapping workbook) ──
// d: {balances: [{code, account, amount, source, former}], loans: [{code, source, amount, monthly, former, history}], replace}
// All-or-nothing; refused if an opening import already exists unless replace
// (which first removes the earlier import's ledger entries and loans).
function payImportOpening_(ss, d, caller) {
  const ledger = ss.getSheetByName('Ledger');
  const already = payLedgerAll_(ss).some(function (e) { return e.reference === PAY_OPENING_REF; });
  if (already && !d.replace) throw new Error('Opening balances were already imported -- tick "replace" to import again');
  const latest = payMasterLatest_(ss);
  const errors = [];
  const check = function (x, what) {
    const code = String(x.code || '').trim();
    if (!code) errors.push(what + ' "' + x.source + '": no employee code');
    else if (!x.former && !latest[code]) errors.push(what + ' "' + x.source + '": ' + code + ' is not in Salary Master');
    if (!(Number(x.amount) > 0)) errors.push(what + ' "' + x.source + '": amount must be more than 0');
    return code;
  };
  (d.balances || []).forEach(function (b) {
    check(b, 'Balance');
    if (['RRF', 'Security'].indexOf(b.account) === -1) errors.push('Balance "' + b.source + '": account must be RRF or Security');
  });
  (d.loans || []).forEach(function (l) {
    check(l, 'Advance');
    if (!l.former && !(Number(l.monthly) > 0)) errors.push('Advance "' + l.source + '": monthly recovery is required');
  });
  if (errors.length) throw new Error(errors.length + ' problem(s): ' + errors.slice(0, 15).join('; ') + (errors.length > 15 ? ' …' : ''));

  if (already) {
    const v = ledger.getDataRange().getValues();
    const h = v[0].map(function (x) { return String(x).trim(); });
    for (let i = v.length - 1; i >= 1; i--) if (String(v[i][h.indexOf('Reference')]) === PAY_OPENING_REF) ledger.deleteRow(i + 1);
    const loans = ss.getSheetByName('Loans');
    const lv = loans.getDataRange().getValues();
    const lh = lv[0].map(function (x) { return String(x).trim(); });
    for (let i = lv.length - 1; i >= 1; i--) if (/^opening import/i.test(String(lv[i][lh.indexOf('Notes')]))) loans.deleteRow(i + 1);
  }
  const now = new Date(), asOf = new Date(2026, 7, 31);
  const entry = function (code, account, amount, source, former) {
    return { 'Date': asOf, 'Month': PAY_OPENING_MONTH, 'Employee Code': code, 'Account (RRF/Security/Loan/Held Salary)': account,
      'Type (Opening/Deduction/Payout/Loan Issued/Loan Repaid/Adjustment)': 'Opening', 'Amount': Math.round(Number(amount)),
      'Reference': PAY_OPENING_REF, 'Notes': 'Tally: ' + source + (former ? ' (former staff, payable at F&F)' : ''), 'Entered By': caller.email, 'Entered At': now };
  };
  payAppend_(ledger, (d.balances || []).map(function (b) { return entry(String(b.code).trim(), b.account, b.amount, b.source, b.former); })
    .concat((d.loans || []).map(function (l) { return entry(String(l.code).trim(), 'Loan', l.amount, l.source, l.former); })));
  payAppend_(ss.getSheetByName('Loans'), (d.loans || []).filter(function (l) { return !l.former; }).map(function (l) {
    return { 'Loan ID': 'L-' + Utilities.getUuid().slice(0, 6), 'Employee Code': String(l.code).trim(), 'Type (Salary Advance/RRF Loan)': 'Salary Advance',
      'Given On': '', 'Amount': Math.round(Number(l.amount)), 'Monthly Recovery': Math.round(Number(l.monthly)), 'Start Month': new Date(2026, 8, 1),
      'Status (Active/Closed)': 'Active', 'Notes': 'Opening import (outstanding 31-Aug-2026): ' + l.source + (l.history ? ' -- ' + l.history : ''),
      'Added By': caller.email, 'Added At': now };
  }));
}

// ── New salary advance / RRF loan ────────────────────────────────────
// d: {month, code, type ('Salary Advance'|'RRF Loan'), amount, monthly, givenOn, startMonth ('YYYY-MM')}
// RRF loans (bye-laws): up to 70% of the accumulated RRF, at most once every 2 years.
function payIssueLoan_(ss, d, caller) {
  const code = String(d.code || '').trim();
  if (!payMasterLatest_(ss)[code]) throw new Error(code + ': not on payroll');
  const amount = Math.round(Number(d.amount)), monthly = Math.round(Number(d.monthly));
  if (!(amount > 0) || !(monthly > 0)) throw new Error('Amount and monthly recovery must be more than 0');
  if (['Salary Advance', 'RRF Loan'].indexOf(d.type) === -1) throw new Error('Unknown loan type');
  const given = payDate_(d.givenOn);
  if (!given) throw new Error('Date given is required');
  if (!/^\d{4}-\d{2}$/.test(String(d.startMonth || ''))) throw new Error('Recovery start month is required');
  if (d.type === 'RRF Loan') {
    const rrf = (payBalancesNow_(ss)[code] || {})['RRF'] || 0;
    if (amount > Math.floor(rrf * 0.7)) throw new Error('RRF loan can be at most 70% of the RRF balance (₹' + Math.floor(rrf * 0.7) + ')');
    const twoYears = new Date(given.getFullYear() - 2, given.getMonth(), given.getDate());
    const recent = payRows_(ss.getSheetByName('Loans')).filter(function (l) {
      return String(l['Employee Code']).trim() === code && /rrf/i.test(String(l['Type (Salary Advance/RRF Loan)'])) && (payDate_(l['Given On']) || 0) > twoYears;
    });
    if (recent.length) throw new Error('An RRF loan was already given in the last 2 years');
  }
  const now = new Date();
  payAppend_(ss.getSheetByName('Loans'), [{ 'Loan ID': 'L-' + Utilities.getUuid().slice(0, 6), 'Employee Code': code, 'Type (Salary Advance/RRF Loan)': d.type,
    'Given On': given, 'Amount': amount, 'Monthly Recovery': monthly, 'Start Month': new Date(Number(d.startMonth.slice(0, 4)), Number(d.startMonth.slice(5, 7)) - 1, 1),
    'Status (Active/Closed)': 'Active', 'Notes': String(d.notes || ''), 'Added By': caller.email, 'Added At': now }]);
  payAppend_(ss.getSheetByName('Ledger'), [{ 'Date': given, 'Month': new Date(given.getFullYear(), given.getMonth(), 1), 'Employee Code': code,
    'Account (RRF/Security/Loan/Held Salary)': 'Loan', 'Type (Opening/Deduction/Payout/Loan Issued/Loan Repaid/Adjustment)': 'Loan Issued',
    'Amount': amount, 'Reference': d.type + ' ' + payIso_(given), 'Notes': String(d.notes || ''), 'Entered By': caller.email, 'Entered At': now }]);
}

// ── Accounts: every employee's balances and gratuity ─────────────────
function payAccounts_(ss, month) {
  const ctx = payCheckMonth_(month);
  const rates = payRates_(payOpenById_(PAY_RATES_SHEET_ID));
  const latest = payMasterLatest_(ss);
  const bal = payBalancesNow_(ss);
  const sched = payLoanSchedules_(ss, month);
  const settled = {};
  payRows_(ss.getSheetByName('F&F')).forEach(function (f) { settled[String(f['Employee Code']).trim()] = payIso_(payDate_(f['Paid On'])) || 'yes'; });
  const lastNet = {};
  payRows_(ss.getSheetByName('Payroll Register')).forEach(function (r) { lastNet[String(r['Employee Code']).trim()] = payNum_(r['Net Pay']); });
  const rows = [];
  Object.keys(latest).forEach(function (code) {
    const r = latest[code].row;
    const entity = payEntity_(r['Entity']);
    const doj = payDate_(r['Date of Joining']), lwd = payDate_(r['Last Working Day']);
    const b = bal[code] || {};
    const left = !!lwd || /^left/i.test(String(r['Status (Active/Left)'] || ''));
    const g = doj ? payGratuity_(payNum_(r['Full Basic']), (rates[entity] || {}).da || 0, doj, lwd && lwd < ctx.monthEnd ? lwd : ctx.monthEnd) : null;
    rows.push({ code: code, name: String(r['Name'] || ''), entity: entity, designation: String(r['Designation'] || ''), doj: payIso_(doj), lwd: payIso_(lwd),
      left: left, former: false, rrf: b['RRF'] || 0, security: b['Security'] || 0, held: b['Held Salary'] || 0, loan: b['Loan'] || 0,
      loanMonthly: sched[code] || 0, gratuity: g, lastNet: lastNet[code] || null, settled: settled[code] || '' });
  });
  // Ledger balances for people not in the Salary Master (left before payroll started).
  Object.keys(bal).forEach(function (code) {
    if (latest[code]) return;
    const b = bal[code];
    if (!b['RRF'] && !b['Security'] && !b['Held Salary'] && !b['Loan']) return;
    const note = payLedgerAll_(ss).filter(function (e) { return e.code === code; })[0];
    rows.push({ code: code, name: note ? note.notes.replace(/^Tally: /, '').replace(/ \(former staff.*$/, '') : code, entity: '', designation: '', doj: '', lwd: '',
      left: true, former: true, rrf: b['RRF'], security: b['Security'], held: b['Held Salary'], loan: b['Loan'], loanMonthly: 0, gratuity: null, lastNet: null, settled: settled[code] || '' });
  });
  const loans = payRows_(ss.getSheetByName('Loans')).map(function (l) {
    return { id: String(l['Loan ID']), code: String(l['Employee Code']).trim(), type: String(l['Type (Salary Advance/RRF Loan)']), givenOn: payIso_(payDate_(l['Given On'])),
      amount: payNum_(l['Amount']), monthly: payNum_(l['Monthly Recovery']), start: payMonthKey_(l['Start Month']), status: String(l['Status (Active/Closed)']), notes: String(l['Notes'] || '') };
  });
  return { month: month, accounts: rows, loans: loans, openingImported: payLedgerAll_(ss).some(function (e) { return e.reference === PAY_OPENING_REF; }) };
}

// ── Full & Final settlement ──────────────────────────────────────────
// Earnings: Salary Security (held salary), Security, RRF, Gratuity (5+ years),
// CL Encashment (days × net/30), Notice Pay, Other. Deductions: Notice Period
// Recovery, loan outstanding, Collection from Students, Outstanding Fee of
// Ward, Other Dues. (F&F form as revised by Uday, 2026-09-29.)
const PAY_FNF_MANUAL = ['clDays', 'clRate', 'noticePay', 'otherEarnings', 'noticeRecovery', 'studentCollection', 'wardFee', 'otherDues'];

function payFnfStatement_(ss, code, manual) {
  const acc = payAccounts_(ss, Utilities.formatDate(new Date(), PAY_TZ, 'yyyy-MM')).accounts.filter(function (a) { return a.code === code; })[0];
  if (!acc) throw new Error(code + ': no payroll record or balances');
  if (!acc.left) throw new Error(code + ' has not left -- mark them left in Staff changes first');
  const m = manual || {};
  const n = function (k) { const v = Number(m[k]); if (m[k] !== undefined && m[k] !== '' && (isNaN(v) || v < 0)) throw new Error(k + ' must be 0 or more'); return isNaN(v) ? 0 : v; };
  // CL encashment = net salary / 30 per day (Uday, 2026-09-29): last locked net pay, or -- before any
  // month is locked -- this month's computed net scaled up to a full month.
  let lastNet = acc.lastNet;
  if (!lastNet && !acc.former) {
    const month = acc.lwd ? acc.lwd.slice(0, 7) : Utilities.formatDate(new Date(), PAY_TZ, 'yyyy-MM');
    const live = payCompute_(ss, month).rows.filter(function (r) { return r.code === code; })[0];
    if (live && live.paidDays) lastNet = live.net * payCheckMonth_(month).daysInMonth / live.paidDays;
  }
  const clRate = m.clRate === undefined || m.clRate === '' ? Math.round((lastNet || 0) / 30) : n('clRate');
  const e = { salarySecurity: acc.held, security: acc.security, rrf: acc.rrf, gratuity: acc.gratuity ? acc.gratuity.payable : 0,
    clEncashment: Math.round(n('clDays') * clRate), noticePay: n('noticePay'), otherEarnings: n('otherEarnings') };
  const dd = { noticeRecovery: n('noticeRecovery'), loan: acc.loan, studentCollection: n('studentCollection'), wardFee: n('wardFee'), otherDues: n('otherDues') };
  const sum = function (o) { return Object.keys(o).reduce(function (t, k) { return t + o[k]; }, 0); };
  return { account: acc, clRate: clRate, clDays: n('clDays'), earnings: e, deductions: dd, totalEarnings: sum(e), totalDeductions: sum(dd), net: sum(e) - sum(dd) };
}

// d: {month, code, manual: {...}, paidOn, mode, reference, notes}
function paySettleFnf_(ss, d, caller) {
  const code = String(d.code || '').trim();
  if (payRows_(ss.getSheetByName('F&F')).some(function (f) { return String(f['Employee Code']).trim() === code; })) throw new Error(code + ' already has a Full & Final settlement');
  const st = payFnfStatement_(ss, code, d.manual);
  const paid = payDate_(d.paidOn);
  if (!paid) throw new Error('Payment date is required');
  const a = st.account, now = new Date(), id = 'FNF-' + code;
  payAppend_(ss.getSheetByName('F&F'), [{ 'F&F ID': id, 'Employee Code': code, 'Name': a.name, 'Entity': a.entity, 'Date of Joining': a.doj, 'Last Working Day': a.lwd,
    'Salary Security': st.earnings.salarySecurity, 'Security': st.earnings.security, 'RRF': st.earnings.rrf, 'Gratuity': st.earnings.gratuity,
    'Gratuity Years': a.gratuity ? a.gratuity.years : '', 'CL Days': st.clDays, 'CL Encashment': st.earnings.clEncashment, 'Notice Pay': st.earnings.noticePay,
    'Other Earnings': st.earnings.otherEarnings, 'Notice Period Recovery': st.deductions.noticeRecovery, 'Loan Outstanding': st.deductions.loan,
    'Collection from Students': st.deductions.studentCollection, 'Outstanding Fee of Ward': st.deductions.wardFee, 'Other Dues': st.deductions.otherDues,
    'Total Earnings': st.totalEarnings, 'Total Deductions': st.totalDeductions, 'Net Payable': st.net, 'Paid On': paid,
    'Payment Mode': String(d.mode || ''), 'Reference': String(d.reference || ''), 'Notes': String(d.notes || ''), 'Settled By': caller.email, 'Settled At': now }]);
  // Close every balance the settlement paid out or recovered.
  const month = new Date(paid.getFullYear(), paid.getMonth(), 1);
  payAppend_(ss.getSheetByName('Ledger'), [['Security', a.security, 'Payout'], ['RRF', a.rrf, 'Payout'], ['Held Salary', a.held, 'Payout'], ['Loan', a.loan, 'Loan Repaid']]
    .filter(function (x) { return x[1]; }).map(function (x) {
      return { 'Date': paid, 'Month': month, 'Employee Code': code, 'Account (RRF/Security/Loan/Held Salary)': x[0],
        'Type (Opening/Deduction/Payout/Loan Issued/Loan Repaid/Adjustment)': x[2], 'Amount': -x[1], 'Reference': id, 'Notes': 'Full & Final settlement',
        'Entered By': caller.email, 'Entered At': now };
    }));
  const loans = ss.getSheetByName('Loans');
  const lv = loans.getDataRange().getValues();
  const lh = lv[0].map(function (x) { return String(x).trim(); });
  for (let i = 1; i < lv.length; i++) if (String(lv[i][lh.indexOf('Employee Code')]).trim() === code) loans.getRange(i + 1, lh.indexOf('Status (Active/Closed)') + 1).setValue('Closed');
}

// ── ESI coverage per contribution period (2026-09-30, "do what is legally right") ──
// Periods run Apr-Sep and Oct-Mar. Coverage is decided on the full-month wages
// (Basic + ADA + DA) in force at the start of the period -- or on joining, for
// someone who joined during it -- and holds for the whole period.
function payEsiCovered_(rows, rates, settings, ctx) {
  if (!rows || !rows.length) return undefined;
  const y = ctx.start.getFullYear(), m = ctx.start.getMonth();
  const periodStart = m >= 3 && m <= 8 ? new Date(y, 3, 1) : new Date(m >= 9 ? y : y - 1, 9, 1);
  const sorted = rows.slice().sort(function (a, b) { return a.eff - b.eff; });
  let pick = sorted[0];
  sorted.forEach(function (x) { if (x.eff <= periodStart) pick = x; });
  const r = pick.row, rt = rates[payEntity_(r['Entity'])];
  if (!rt) return undefined;
  const b = payNum_(r['Full Basic']);
  return b + payRound_(b * rt.ada) + payRound_(b * rt.da) <= settings.esiThreshold;
}

// ── Outputs (stage 3, 2026-09-30) ─────────────────────────────────────
// Everything the page needs to print bank letters, salary sheets and pay
// slips and to build the EPF (ECR) and ESI upload files: the month, each
// person's bank / UAN / ESI numbers from the Staff Master's EmpKeyNumbers tab,
// leave records, and the bank letters already recorded.
// Only the extras -- the page already holds the month (was a full recompute, 2026-09-30).
// ── Tally journal export (2026-10-01) ─────────────────────────────────
// Entity -> Tally company, confirmed with Uday against the real company list
// (HES and LMS2 share Kelheli's books; LMS6 is booked under Guru International). This is the
// grouping key (keep it simple/robust) -- PAY_TALLY_COMPANY_XML below is the separate, more
// fragile "exact string Tally's import expects" for the SVCURRENTCOMPANY tag specifically.
const PAY_TALLY_COMPANY = { HES: 'LMS Kelheli Branch [2021-22]', LMS1: 'LMS Kullu Branch [2021-22]', LMS2: 'LMS Kelheli Branch [2021-22]',
  LMS3: 'LMS Dunkhra Branch [2021-22]', LMS4: 'LMS Nerchowk Branch [2021-22]', LMS5: 'La Montessori School -Sayoli', LMS6: 'Guru International LMS' };
// The real voucher Uday sent used "1 LMS Kullu Branch [2021-22]" (WITH the leading "1 ") as
// SVCURRENTCOMPANY, matching exactly how the "List of Companies" screen shows it -- that
// prefix might be part of the actual Tally-internal name, not just a UI index, so these keep
// each company's own prefix style as shown rather than assuming it's safe to strip. UNVERIFIED
// for anything but LMS1 (the only one with a real working example) -- if an XML import for
// another company is rejected, the fix is almost certainly here, not in the money logic.
const PAY_TALLY_COMPANY_XML = {
  'LMS Kullu Branch [2021-22]': '1 LMS Kullu Branch [2021-22]',
  'LMS Kelheli Branch [2021-22]': '2.LMS Kelheli Branch[2021-22]',
  'LMS Dunkhra Branch [2021-22]': '3.LMS Dunkhra Branch[2021-22]',
  'LMS Nerchowk Branch [2021-22]': '4. LMS Nerchowk Branch [2021-22]',
  'La Montessori School -Sayoli': '5.La Montessori School -Sayoli',
  'Guru International LMS': 'Guru International LMS',
};
// Adjustment types with no confirmed Tally ledger -- if any of these has a nonzero amount for
// someone in the export, that company's export is refused (see payTallyVoucher_) rather than
// silently leaving the voucher unbalanced. 'Advance / Loan Recovery' here means a manual
// adjustment of that type, NOT the Loans-tab scheduled recovery (which IS handled, via each
// loan's own Tally Ledger Name).
const PAY_TALLY_UNMAPPED_TYPES = ['Fine', 'Notice Period Recovery', 'Other Deduction', 'Advance / Loan Recovery'];

// Builds one balanced journal per Tally company for a month that's fully locked for every
// entity booked into it. Throws (listing exactly what's missing) rather than ever returning
// an unbalanced voucher -- see PAY_TALLY_UNMAPPED_TYPES and the per-loan ledger-name lookup.
function payTallyVoucher_(ss, month) {
  const ctx = payCheckMonth_(month);
  const locks = payLocks_(ss, month);
  // Which entities actually have staff this month -- from the LIVE compute, not the Payroll
  // Register, which is empty for anyone not locked yet (that's exactly the case we need to catch).
  const live = payCompute_(ss, month);
  const entitiesWithStaff = {};
  live.rows.forEach(function (r) { entitiesWithStaff[r.entity] = true; });
  const reg = payForMonth_(ss, 'Payroll Register', month);
  const byCompany = {};
  const issues = [];
  Object.keys(entitiesWithStaff).forEach(function (e) {
    if (!locks[e]) issues.push(e + ' is not locked for ' + month + ' yet');
  });
  if (issues.length) throw new Error(issues.join('; '));
  const loansByCode = {};
  payRows_(ss.getSheetByName('Loans')).forEach(function (l) { loansByCode[String(l['Employee Code']).trim()] = String(l['Tally Ledger Name'] || '').trim(); });
  const adjByCode = {};
  payForMonth_(ss, 'Adjustments', month).forEach(function (a) {
    const code = String(a['Employee Code']).trim();
    (adjByCode[code] = adjByCode[code] || []).push({ type: String(a['Type']), direction: String(a['Direction']), amount: payNum_(a['Amount']) });
  });
  reg.forEach(function (r) {
    const e = payEntity_(r['Entity']);
    if (!locks[e]) return; // already flagged above
    const company = PAY_TALLY_COMPANY[e];
    if (!company) { issues.push(e + ' has no Tally company mapped (PAY_TALLY_COMPANY)'); return; }
    const code = String(r['Employee Code']).trim();
    const c = byCompany[company] = byCompany[company] || { entities: {}, gross: 0, tuitionA: 0, tuitionD: 0, epfEr: 0, epfEe: 0,
      esiEr: 0, esiEe: 0, rrf: 0, tds: 0, bankPayable: 0, childFeeRecovery: 0, loanLedgers: {} };
    c.entities[e] = true;
    c.gross += payNum_(r['Gross']); c.tuitionA += payNum_(r['Tuition (A)']); c.tuitionD += payNum_(r['Tuition (D)']);
    c.epfEr += payNum_(r['EPF Employer']); c.epfEe += payNum_(r['EPF Employee']); c.esiEr += payNum_(r['ESI Employer']); c.esiEe += payNum_(r['ESI Employee']);
    c.rrf += payNum_(r['RRF']); c.tds += payNum_(r['TDS']); c.bankPayable += payNum_(r['Bank Payable']);
    const loanRecovery = payNum_(r['Loan Recovery']);
    if (loanRecovery) {
      const ledger = loansByCode[code];
      if (!ledger) issues.push(code + ' (' + e + '): has a loan recovery this month but no Tally Ledger Name on its Loans row');
      else c.loanLedgers[ledger] = (c.loanLedgers[ledger] || 0) + loanRecovery;
    }
    (adjByCode[code] || []).forEach(function (a) {
      if (a.direction !== 'Deduction') return;
      if (a.type === 'Child Fee Recovery') { c.childFeeRecovery += a.amount; return; }
      if (PAY_TALLY_UNMAPPED_TYPES.indexOf(a.type) !== -1 && a.amount) {
        issues.push(code + ' (' + e + '): "' + a.type + '" ₹' + a.amount + ' has no confirmed Tally ledger for this type');
      }
    });
  });
  if (issues.length) throw new Error(issues.length + ' problem(s) before a Tally export can be generated: ' + issues.slice(0, 15).join('; ') + (issues.length > 15 ? ' …' : ''));

  const vouchers = Object.keys(byCompany).sort().map(function (company) {
    const c = byCompany[company];
    const dr = [{ ledger: 'Salary Account', amount: c.gross - c.tuitionA }];
    if (c.tuitionA) dr.push({ ledger: 'Free Education Staff', amount: c.tuitionA });
    if (c.epfEr) dr.push({ ledger: 'Own Contribution to EPF', amount: c.epfEr });
    if (c.esiEr) dr.push({ ledger: 'Own ESI Employer Cont. @ 3.25%', amount: c.esiEr });
    const cr = [{ ledger: 'Salary Payable', amount: c.bankPayable }];
    if (c.epfEr) cr.push({ ledger: 'Employer Contribution to EPF Payable', amount: c.epfEr });
    if (c.epfEe) cr.push({ ledger: 'Employee Contribution to EPF Payable', amount: c.epfEe });
    if (c.esiEr) cr.push({ ledger: 'ESI Payable Employer Share', amount: c.esiEr });
    if (c.esiEe) cr.push({ ledger: 'ESI Payable Employee Share', amount: c.esiEe });
    if (c.rrf) cr.push({ ledger: 'RRF Staff Payable', amount: c.rrf });
    if (c.tuitionD) cr.push({ ledger: 'Tuition Fee Staff', amount: c.tuitionD });
    if (c.childFeeRecovery) cr.push({ ledger: 'Fee Recovery-Staff', amount: c.childFeeRecovery });
    if (c.tds) cr.push({ ledger: 'TDS Payable', amount: c.tds });
    Object.keys(c.loanLedgers).sort().forEach(function (l) { cr.push({ ledger: l, amount: c.loanLedgers[l] }); });
    const round2 = function (x) { return Math.round(x * 100) / 100; };
    const drTotal = round2(dr.reduce(function (t, x) { return t + x.amount; }, 0));
    const crTotal = round2(cr.reduce(function (t, x) { return t + x.amount; }, 0));
    if (drTotal !== crTotal) throw new Error(company + ': voucher does not balance (Dr ' + drTotal + ' vs Cr ' + crTotal + ') -- this is a bug, not a data problem, tell Claude');
    return { company: company, svCurrentCompany: PAY_TALLY_COMPANY_XML[company] || company, entities: Object.keys(c.entities).sort(), dr: dr, cr: cr, total: drTotal };
  });
  return { month: month, narration: 'Salary for the Month of ' + Utilities.formatDate(ctx.start, PAY_TZ, 'MMM-yyyy').toUpperCase(), vouchers: vouchers };
}

function payOutputs_(ss, month) {
  payCheckMonth_(month);
  const keys = {};
  const kt = payOpenById_(PAY_ROSTER_SHEET_ID).getSheetByName('EmpKeyNumbers');
  if (kt) {
    const v = kt.getDataRange().getDisplayValues(); // display values keep leading zeros in account numbers
    const h = v[0].map(function (x) { return String(x).trim(); });
    const col = function (n) { return h.indexOf(n); };
    v.slice(1).forEach(function (r) {
      const code = String(r[col('EmployeeCode')] || '').trim();
      const clean = function (x) { x = String(x || '').trim(); return x === '-' || x === '0' ? '' : x; };
      if (code) keys[code] = { account: clean(r[col('BankAcNumber')]), ifsc: clean(r[col('IFSCCode')]), uan: clean(r[col('UanNumber')]),
        esi: clean(r[col('EsiNumber')]), pan: clean(r[col('PanNo')]) };
    });
  }
  const leave = {};
  payForMonth_(ss, 'Leave Records', month).forEach(function (l) { leave[String(l['Employee Code']).trim()] = payLeaveRecord_(l); });
  const letters = payRows_(ss.getSheetByName('Bank Letters')).map(function (l) {
    return { ref: String(l['Ref No']), serial: payNum_(l['Serial']), month: payMonthKey_(l['Month']), entity: payEntity_(l['Entity']),
      date: payIso_(payDate_(l['Letter Date'])), cheque: String(l['Cheque No'] || ''), amount: payNum_(l['Amount']), staff: payNum_(l['Staff']),
      addressee: String(l['Addressee'] || ''), debitAccount: String(l['Debit Account'] || '') };
  });
  return { month: month, keys: keys, leave: leave, letters: letters };
}

// ── Data quality (audit 2026-10-01, section 3) ────────────────────────
// Flags everything that will bite at outputs time if left until then: missing
// bank details/UAN/ESI number, and an employee code that doesn't resolve the
// same way in both places that key off it (Salary Master vs the Roster's
// EmpKeyNumbers, which payOutputs_ reads for the bank letter/ECR/ESI file).
function payDataQuality_(ss, month) {
  const ctx = payCheckMonth_(month);
  const keys = {};
  const kt = payOpenById_(PAY_ROSTER_SHEET_ID).getSheetByName('EmpKeyNumbers');
  if (kt) {
    const v = kt.getDataRange().getDisplayValues();
    const h = v[0].map(function (x) { return String(x).trim(); });
    const col = function (n) { return h.indexOf(n); };
    const clean = function (x) { x = String(x || '').trim(); return x === '-' || x === '0' ? '' : x; };
    v.slice(1).forEach(function (r) {
      const code = String(r[col('EmployeeCode')] || '').trim();
      if (code) keys[code] = { account: clean(r[col('BankAcNumber')]), ifsc: clean(r[col('IFSCCode')]), uan: clean(r[col('UanNumber')]), esi: clean(r[col('EsiNumber')]), pan: clean(r[col('PanNo')]) };
    });
  }
  const rates = payRates_(payOpenById_(PAY_RATES_SHEET_ID));
  const computed = payCompute_(ss, month);
  const wages = {};
  computed.rows.forEach(function (row) { wages[row.code] = row.wages; });
  const seen = {}, issues = [];
  const flag = function (code, name, entity, text) { issues.push({ code: code, name: name, entity: entity, text: text }); };
  // One row per person: the latest Salary Master row in force this month (a raise, increment or transfer adds
  // a newer row for the same code -- that is normal, not a duplicate). Only two rows sharing the SAME
  // Effective From are a real duplicate.
  const inForce = {};
  payRows_(ss.getSheetByName('Salary Master')).forEach(function (r) {
    const code = String(r['Employee Code'] || '').trim();
    if (!code) return;
    const eff = payDate_(r['Effective From']);
    if (!eff || eff > ctx.monthEnd) return;
    const cur = inForce[code];
    if (!cur || eff > cur.eff) inForce[code] = { eff: eff, row: r, dup: false };
    else if (eff.getTime() === cur.eff.getTime()) cur.dup = true;
  });
  Object.keys(inForce).forEach(function (code) {
    const r = inForce[code].row;
    const lwd = payDate_(r['Last Working Day']);
    if (lwd ? lwd < ctx.start : /^left/i.test(String(r['Status (Active/Left)'] || ''))) return;
    if (inForce[code].dup) flag(code, r['Name'], r['Entity'], 'Two Salary Master rows have the same Effective From date');
    seen[code] = true;
    const name = String(r['Name'] || ''), entity = String(r['Entity'] || '');
    const k = keys[code];
    if (!k) { flag(code, name, entity, 'Not found in EmpKeyNumbers (Roster) -- bank letter/ECR/ESI file will skip them'); return; }
    if (!k.account || !k.ifsc) flag(code, name, entity, 'Missing bank account number or IFSC');
    if (payYes_(r['EPF Member (Y/N)']) && !k.uan) flag(code, name, entity, 'EPF member but no UAN on file');
    if (!k.pan) flag(code, name, entity, 'Missing PAN');
    // Only flag a missing ESI number for someone actually at/under this month's wage
    // threshold -- per Uday, 2026-10-01, the entity-only check was flooding the report
    // with false positives for every high earner at an ESI-registered school. This still
    // isn't a precise coverage check (a contribution period keeps someone covered even
    // after a raise crosses the threshold -- payEsiCovered_ needs the wage history this
    // report doesn't build), so someone covered mid-period on a now-higher wage could
    // still be missed; it only clears the much larger false-positive case.
    if ((rates[payEntity_(r['Entity'])] || {}).esiRegistered && !k.esi && wages[code] !== undefined && wages[code] <= computed.settings.esiThreshold) {
      flag(code, name, entity, 'No ESI number on file (wages ₹' + wages[code] + ' are at/under the ESI threshold)');
    }
  });
  return { month: month, issues: issues, checked: Object.keys(seen).length };
}

// d: {month, entity, serial, ref, date, cheque, amount, staff, addressee, debitAccount}
function payIssueLetter_(ss, d, caller) {
  const ctx = payCheckMonth_(d.month);
  const e = payEntity_(d.entity);
  if (!payLocks_(ss, d.month)[e]) throw new Error('Lock ' + e + ' for ' + d.month + ' before recording its bank letter');
  const serial = Number(d.serial);
  if (!(serial > 0) || serial !== Math.floor(serial)) throw new Error('Reference serial must be a whole number');
  if (!String(d.ref || '').trim()) throw new Error('Reference number is required');
  if (payRows_(ss.getSheetByName('Bank Letters')).some(function (l) { return String(l['Ref No']).trim() === String(d.ref).trim(); })) throw new Error('Reference ' + d.ref + ' was already used');
  payAppend_(ss.getSheetByName('Bank Letters'), [{ 'Ref No': String(d.ref).trim(), 'Serial': serial, 'Month': ctx.start, 'Entity': e,
    'Letter Date': payDate_(d.date) || new Date(), 'Cheque No': String(d.cheque || ''), 'Amount': Math.round(Number(d.amount) || 0), 'Staff': Number(d.staff) || 0,
    'Addressee': String(d.addressee || ''), 'Debit Account': String(d.debitAccount || ''), 'Issued By': caller.email, 'Issued At': new Date() }]);
}
