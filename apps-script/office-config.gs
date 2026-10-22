// LMCS Office Backend -- config (categories, limits, campuses) and opening balances.
// Config tabs live in the Office Config book and are created + seeded on first open if missing.

var OFFICE_CAMPUSES = ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6', 'HES'];
var OFFICE_CONFIG_SEED = {
  Categories: [
    ['id', 'label', 'direction'],
    ['fee_collection', 'Fee collection', 'IN'],
    ['deposit_cash_out', 'Bank deposit (cash out)', 'OUT'],
    ['deposit_bank_in', 'Bank deposit (bank in)', 'IN'],
    ['petty_expense', 'Petty expense', 'OUT'],
    ['bill_payment', 'Bill payment', 'OUT'],
    ['donation', 'Donation', 'IN'],
    ['other_in', 'Other receipt', 'IN'],
    ['other_out', 'Other payment', 'OUT'],
  ],
  // Headers only; rows are added by the Accounts page. Default cash:/bank: accounts per campus are not stored.
  Accounts: [['id', 'label', 'kind', 'campus', 'active', 'created_at', 'created_by']],
  Vehicles: [['reg', 'label', 'kind', 'campus', 'active', 'created_at', 'created_by']],
  // Placeholder until Uday decides the approval limits (0 = no limit set).
  Limits: [
    ['role', 'max_amount_paise'],
    ['AdminManager', '0'],
    ['FinanceHead', '0'],
    ['Principal', '0'],
  ],
};
var OFFICE_ALL_ROLES = ['FeeClerk', 'AdminManager', 'FinanceHead', 'Principal', 'Coordinator', 'Owner'];

function officeConfigActions_() {
  return {
    'config.get': { roles: OFFICE_ALL_ROLES, write: false, run: officeConfigGet_ },
    'opening.set': { roles: ['FinanceHead', 'Owner'], write: true, run: officeOpeningSet_ },
  };
}

// The Office Config book with Categories and Limits created and seeded if missing.
function officeConfigBook_() {
  const ss = officeConfig_();
  Object.keys(OFFICE_CONFIG_SEED).forEach(function (tab) {
    const v = OFFICE_CONFIG_SEED[tab];
    const have = ss.getSheetByName(tab);
    if (have) { officeEnsureHeader_(have, v[0]); return; }
    const sh = ss.insertSheet(tab);
    sh.getRange(1, 1, v.length, v[0].length).setNumberFormat('@').setValues(v); // plain text, as in the store
    sh.setFrozenRows(1);
  });
  return ss;
}

function officeConfigGet_() {
  const ss = officeConfigBook_();
  const limits = {};
  officeRows_(ss, 'Limits').forEach(function (r) { limits[r.role] = r.max_amount_paise; });
  return { categories: officeRows_(ss, 'Categories'), limits: limits, campuses: OFFICE_CAMPUSES };
}

function officeOpeningSet_(ctx, data) {
  const id = String(data.id || '');
  if (!id) throw new Error('MISSING_ID');
  if (!data.campus) throw new Error('MISSING_CAMPUS');
  if (!Array.isArray(data.balances) || !data.balances.length) throw new Error('NO_BALANCES');
  const bucketOk = { petty: 1, fee: 1, other: 1 };
  const rows = data.balances.map(function (b, i) {
    if (['cash', 'bank', 'upi'].indexOf(b.mode) === -1) throw new Error('BAD_MODE');
    if (b.mode === 'cash' && !bucketOk[b.bucket]) throw new Error('BUCKET_REQUIRED');
    if (b.mode !== 'cash' && b.bucket) throw new Error('BUCKET_NOT_ALLOWED');
    if (!Number.isInteger(b.amount_paise) || b.amount_paise < 0) throw new Error('BAD_AMOUNT');
    return { id: id + ':' + i, campus: data.campus, mode: b.mode, bucket: b.bucket || '', amount_paise: b.amount_paise };
  });
  // A retry (same id) is a duplicate wherever it landed, even in last year's book after 1 April (R41).
  const prior = officeRecentBooks_(data.campus).filter(function (b) {
    return officeRows_(b, 'Opening').some(function (r) { return r.id.indexOf(id + ':') === 0; });
  })[0];
  if (prior) return { opening: officeOpening_(prior), duplicate: true };
  const ss = officeOpen_(data.campus, officeFy_(officeToday_()));
  // Opening feeds every day's balance: locked once any entry exists or any day has ever been closed (R36).
  if (officeRows_(ss, 'DayBook').length || officeRows_(ss, 'Closes').length) throw new Error('OPENING_LOCKED');
  rows.forEach(function (r) { officeAppend_(ss, 'Opening', r, ctx.caller, { action: 'opening.set', campus: data.campus }); });
  return { opening: officeOpening_(ss) };
}

// Opening balances in paise; zero when absent, the latest row per mode/bucket wins.
function officeOpening_(ss) {
  const o = { cash: { petty: 0, fee: 0, other: 0 }, bank: 0, upi: 0 };
  officeRows_(ss, 'Opening').forEach(function (r) {
    if (r.mode === 'cash') o.cash[r.bucket] = r.amount_paise; else o[r.mode] = r.amount_paise;
  });
  return o;
}
