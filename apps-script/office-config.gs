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
// Categories are code, not config (P2). group: fee|income|school|transport|movement. active false = not offered for typing.
// [id, label, direction, group, needs_vehicle, pnl_column, active]
var OFFICE_CATEGORIES = [
  ['fee_collection', 'Fee cash', 'IN', 'fee', 0, '', 1],
  ['fee_online', 'Fee online', 'IN', 'fee', 0, '', 1],
  ['fee_cheque', 'Fee cheque (imported from ERP)', 'IN', 'fee', 0, '', 0],
  ['student_collection', 'Student collection (trips, ID cards, events)', 'IN', 'income', 0, '', 1],
  ['transport_income', 'Transport income (cashback, scrap, hire)', 'IN', 'transport', 1, 'income', 1],
  ['donation', 'Donation', 'IN', 'income', 0, '', 1],
  ['other_in', 'Other receipt', 'IN', 'income', 0, '', 1],
  ['stationery', 'Stationery', 'OUT', 'school', 0, '', 1],
  ['postage_courier', 'Postage and courier', 'OUT', 'school', 0, '', 1],
  ['travel_errands', 'Travel and errands', 'OUT', 'school', 0, '', 1],
  ['cleaning_housekeeping', 'Cleaning and housekeeping', 'OUT', 'school', 0, '', 1],
  ['snacks_pantry', 'Snacks and pantry', 'OUT', 'school', 0, '', 1],
  ['activities_events', 'Activities and events', 'OUT', 'school', 0, '', 1],
  ['exams_board', 'Exams and board fees', 'OUT', 'school', 0, '', 1],
  ['utilities', 'Utilities (electricity, internet, phone, gas)', 'OUT', 'school', 0, '', 1],
  ['repairs_hardware', 'Repairs and hardware', 'OUT', 'school', 0, '', 1],
  ['labour_wages', 'Labour and daily wages', 'OUT', 'school', 0, '', 1],
  ['medical_first_aid', 'Medical and first aid', 'OUT', 'school', 0, '', 1],
  ['security_refund', 'Security deposit refund', 'OUT', 'school', 0, '', 1],
  ['salary_advance', 'Salary advance', 'OUT', 'school', 0, '', 1],
  ['govt_legal', 'Government and legal (stamp paper, NOC, fees)', 'OUT', 'school', 0, '', 1],
  ['chairman_personal', 'Chairman (personal)', 'OUT', 'school', 0, '', 1],
  ['other_out', 'Other payment (say what for)', 'OUT', 'school', 0, '', 1],
  ['petty_expense', 'Petty expense (old)', 'OUT', 'school', 0, '', 0],
  ['bill_payment', 'Bill payment (old)', 'OUT', 'school', 0, '', 0],
  ['fuel', 'Fuel (diesel/petrol)', 'OUT', 'transport', 1, 'fuel', 1],
  ['vehicle_service', 'Vehicle service and repair', 'OUT', 'transport', 1, 'service', 1],
  ['tyres', 'Tyres', 'OUT', 'transport', 1, 'service', 1],
  ['vehicle_insurance', 'Vehicle insurance', 'OUT', 'transport', 1, 'insurance', 1],
  ['vehicle_tax_permit', 'Vehicle tax, permit, fitness, pollution', 'OUT', 'transport', 1, 'taxes', 1],
  ['parking', 'Parking', 'OUT', 'transport', 1, 'parking', 1],
  ['challan', 'Challan (traffic fine)', 'OUT', 'transport', 1, 'challan', 1],
  ['loan_interest', 'Vehicle loan interest', 'OUT', 'transport', 1, 'loan_interest', 1],
  ['loan_principal', 'Vehicle loan principal', 'OUT', 'transport', 1, 'loan_principal', 1],
  ['driver_travel', 'Driver travel', 'OUT', 'transport', 1, 'other', 1],
  ['deposit_cash_out', 'Bank deposit (cash out)', 'OUT', 'movement', 0, '', 0],
  ['deposit_bank_in', 'Bank deposit (bank in)', 'IN', 'movement', 0, '', 0],
  ['credit_settlement', 'Settle a supplier credit account', 'OUT', 'movement', 0, '', 1],
  ['cash_transfer', 'Cash transfer between cash boxes', 'OUT', 'movement', 0, '', 1],
].map(function (c) {
  return { id: c[0], label: c[1], direction: c[2], group: c[3], needs_vehicle: !!c[4], pnl_column: c[5], active: !!c[6] };
});

function officeCategory_(id) {
  return OFFICE_CATEGORIES.filter(function (c) { return c.id === id; })[0] || null;
}

// Config rows keep every cell as text, so 'false' (any case) is the only way to switch one off.
function officeActiveCell_(v) { return String(v).toLowerCase() !== 'false'; }

// The default cash:/bank: account of every campus, then the Config Accounts rows.
function officeAccounts_() {
  const out = [];
  OFFICE_CAMPUSES.forEach(function (c) {
    out.push({ id: 'cash:' + c, label: c + ' cash', kind: 'cash', campus: c, active: true });
    out.push({ id: 'bank:' + c, label: c + ' bank', kind: 'bank', campus: c, active: true });
  });
  officeRows_(officeConfigBook_(), 'Accounts').forEach(function (r) {
    out.push({ id: r.id, label: r.label, kind: r.kind, campus: r.campus, active: officeActiveCell_(r.active) });
  });
  return out;
}
function officeAccount_(id) {
  return officeAccounts_().filter(function (a) { return a.id === id; })[0] || null;
}

function officeVehicles_() {
  return officeRows_(officeConfigBook_(), 'Vehicles').map(function (r) {
    return { reg: r.reg, label: r.label, kind: r.kind, campus: r.campus, active: officeActiveCell_(r.active) };
  });
}
function officeNormReg_(s) { return String(s === undefined || s === null ? '' : s).toUpperCase().replace(/[\s.\-]/g, ''); }

function officeAccountAdd_(ctx, data) {
  const id = String(data.id || '');
  if (!id) throw new Error('MISSING_ID');
  if (data.kind !== 'bank' && data.kind !== 'credit') throw new Error('BAD_KIND');
  if (!String(data.label || '').trim()) throw new Error('LABEL_REQUIRED');
  if (OFFICE_CAMPUSES.indexOf(data.campus) === -1) throw new Error('BAD_CAMPUS');
  // Default ids are reserved; a clash with another stored id is a duplicate (retry).
  if (/^(cash|bank):/.test(id) && OFFICE_CAMPUSES.some(function (c) { return id === 'cash:' + c || id === 'bank:' + c; })) throw new Error('BAD_ID');
  const row = { id: id, label: String(data.label).trim(), kind: data.kind, campus: data.campus, active: 'true' };
  const res = officeAppend_(officeConfigBook_(), 'Accounts', row, ctx.caller,
    { action: 'account.add', campus: data.campus, auditSs: officeOpen_(data.campus, officeFy_(officeToday_())) });
  return { id: id, duplicate: res.duplicate };
}

var OFFICE_VEHICLE_KINDS = ['bus', 'jeep', 'car', 'van'];

// Validates one vehicle and returns the Config row, or throws.
function officeVehicleRow_(caller, v) {
  const reg = officeNormReg_(v && v.reg);
  if (!reg) throw new Error('MISSING_REG');
  if (OFFICE_VEHICLE_KINDS.indexOf(v.kind) === -1) throw new Error('BAD_KIND');
  const campus = String(v.campus || '').trim().toUpperCase();
  if (OFFICE_CAMPUSES.indexOf(campus) === -1) throw new Error('BAD_CAMPUS');
  officeAssertCampus_(caller, campus);
  return { reg: reg, label: String(v.label || '').trim() || reg, kind: v.kind, campus: campus, active: 'true' };
}

function officeVehicleWrite_(ctx, row, action) {
  return officeAppend_(officeConfigBook_(), 'Vehicles', row, ctx.caller,
    { action: action, key: 'reg', campus: row.campus, auditSs: officeOpen_(row.campus, officeFy_(officeToday_())) });
}

function officeVehicleAdd_(ctx, data) {
  const res = officeVehicleWrite_(ctx, officeVehicleRow_(ctx.caller, data), 'vehicle.add');
  return { reg: res.id, duplicate: res.duplicate };
}

function officeVehiclesImport_(ctx, data) {
  if (!Array.isArray(data.vehicles)) throw new Error('NO_VEHICLES');
  const rows = data.vehicles.map(function (v) { return officeVehicleRow_(ctx.caller, v); }); // all valid before any write
  let added = 0;
  rows.forEach(function (r) { if (!officeVehicleWrite_(ctx, r, 'vehicles.import').duplicate) added++; });
  return { added: added };
}

// Opening balance of a bank or credit account (cash accounts use opening.set). Once per account, any time.
function officeAccountOpening_(ctx, data) {
  const id = String(data.id || '');
  if (!id) throw new Error('MISSING_ID');
  const acct = officeAccount_(String(data.account || ''));
  if (!acct) throw new Error('UNKNOWN_ACCOUNT');
  if (acct.kind === 'cash') throw new Error('BAD_KIND');
  if (acct.campus !== data.campus) throw new Error('BAD_CAMPUS');
  if (!Number.isSafeInteger(data.amount_paise) || data.amount_paise < 0) throw new Error('BAD_AMOUNT');
  const prior = officeRecentBooks_(data.campus).reduce(function (all, b) { return all.concat(officeRows_(b, 'Opening')); }, []);
  if (prior.some(function (r) { return r.id === id; })) return { id: id, duplicate: true };
  if (prior.some(function (r) { return r.account === acct.id; })) throw officeCoded_('ACCOUNT_OPENING_EXISTS');
  const ss = officeOpen_(data.campus, officeFy_(officeToday_()));
  officeAppend_(ss, 'Opening', { id: id, campus: data.campus, mode: acct.kind, bucket: '', amount_paise: data.amount_paise, account: acct.id },
    ctx.caller, { action: 'account.opening', campus: data.campus });
  return { id: id, duplicate: false };
}

var OFFICE_ALL_ROLES = ['FeeClerk', 'AdminManager', 'FinanceHead', 'Principal', 'Coordinator', 'Owner'];

function officeConfigActions_() {
  return {
    'config.get': { roles: OFFICE_ALL_ROLES, write: false, run: officeConfigGet_ },
    'account.add': { roles: ['FinanceHead', 'Owner'], write: true, run: officeAccountAdd_ },
    'vehicle.add': { roles: ['FinanceHead', 'Owner'], write: true, run: officeVehicleAdd_ },
    'vehicles.import': { roles: ['FinanceHead', 'Owner'], write: true, run: officeVehiclesImport_ },
    'account.opening': { roles: ['FinanceHead', 'Owner'], write: true, run: officeAccountOpening_ },
    'opening.set': { roles: ['FinanceHead', 'Owner'], write: true, run: officeOpeningSet_ },
  };
}

// The Office Config book with every seed tab present (created if missing). Only Accounts and Vehicles get a
// header check (Limits and the retired Categories tab are left as they are). Checked once per request.
function officeConfigBook_() {
  const ss = officeConfig_();
  if (OFFICE_MEMO && OFFICE_MEMO.books.OFFICE_CONFIG_CHECKED) return ss;
  Object.keys(OFFICE_CONFIG_SEED).forEach(function (tab) {
    const v = OFFICE_CONFIG_SEED[tab];
    const have = ss.getSheetByName(tab);
    if (have) { if (tab === 'Accounts' || tab === 'Vehicles') officeEnsureHeader_(have, v[0]); return; }
    const sh = ss.insertSheet(tab);
    sh.getRange(1, 1, v.length, v[0].length).setNumberFormat('@').setValues(v); // plain text, as in the store
    sh.setFrozenRows(1);
  });
  if (OFFICE_MEMO) OFFICE_MEMO.books.OFFICE_CONFIG_CHECKED = true;
  return ss;
}

function officeConfigGet_() {
  const ss = officeConfigBook_();
  const limits = {};
  officeRows_(ss, 'Limits').forEach(function (r) { limits[r.role] = r.max_amount_paise; });
  return { categories: OFFICE_CATEGORIES, accounts: officeAccounts_(), vehicles: officeVehicles_(), limits: limits, campuses: OFFICE_CAMPUSES };
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
    if (r.account) return; // per-account openings (bank/credit accounts) are not the campus cash/bank/upi opening
    if (r.mode === 'cash') o.cash[r.bucket] = r.amount_paise; else o[r.mode] = r.amount_paise;
  });
  return o;
}
