// LMCS Office Backend -- Day Book: entries, reversal, balances. Append-only: a correction is a new
// opposite-direction entry whose `reverses` names the original. Money is integer paise throughout.

function officeDaybookActions_() {
  return {
    'daybook.add': { roles: ['FeeClerk', 'AdminManager', 'FinanceHead', 'Owner'], write: true, run: officeDaybookAdd_ },
    'daybook.reverse': { roles: ['FeeClerk', 'AdminManager', 'FinanceHead', 'Owner'], write: true, run: officeDaybookReverse_ },
    'daybook.list': { roles: OFFICE_ALL_ROLES, write: false, run: officeDaybookList_ },
    'daybook.balances': { roles: OFFICE_ALL_ROLES, write: false, run: officeDaybookBalances_ },
  };
}

var OFFICE_BUCKETS = ['petty', 'fee', 'other'];
var OFFICE_COLLECTION_CATEGORIES = ['student_collection', 'student_collection_paid'];
var OFFICE_DEPOSIT_LEG_CATEGORIES = ['deposit_cash_out', 'deposit_bank_in'];

// Strict ISO calendar date: shape and a real day (rejects 2026-02-30).
function officeIsoDate_(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; // invalid month/day gives Invalid Date, which has no ISO string
}

// Defaults for rows written before Day Book v2 (blank account / charged_to).
function officeRowAccount_(row) { return row.account || (row.mode === 'cash' ? 'cash:' : 'bank:') + row.campus; }
function officeRowChargedTo_(row) { return row.charged_to || row.campus; }

function officeBlank_(v) { return v === undefined || v === null || v === ''; }

// Fee Clerk / Admin Manager (no FinanceHead or Owner role, P8): own campus, cash accounts, credit bills only for
// vehicle categories; no bank rows or settlements (own cash transfers are allowed, P10). Used by daybook.add and daybook.reverse.
function officeAssertAccountAllowed_(caller, acct, cat) {
  if (caller.roles.indexOf('FinanceHead') !== -1 || caller.roles.indexOf('Owner') !== -1) return;
  const id = cat && cat.id;
  if (id === 'credit_settlement' || acct.kind === 'bank' ||
      (acct.kind === 'credit' && !(cat && cat.needs_vehicle)) ||
      (caller.campuses.indexOf('ALL') === -1 && caller.campuses.indexOf(acct.campus) === -1)) throw officeCoded_('FORBIDDEN_ACCOUNT');
}

function officeDaybookAdd_(ctx, data) {
  if (!data.id) throw new Error('MISSING_ID');
  if (!officeIsoDate_(data.entry_date)) throw new Error('BAD_DATE');
  if (data.entry_date > officeToday_()) throw new Error('FUTURE_DATE');
  // P9: a retry of a saved entry is a duplicate before any validation, so a later config change (account or
  // vehicle switched off, day closed) never strands it in the outbox.
  const ss = officeOpen_(data.campus, officeFy_(data.entry_date));
  if (officeRows_(ss, 'DayBook').some(function (r) { return r.id === String(data.id); })) return { id: String(data.id), duplicate: true };
  // typeof number only: "1,234.50" and other strings never reach arithmetic; floats and 0/negatives fail safe-integer > 0.
  if (typeof data.amount_paise !== 'number' || !Number.isSafeInteger(data.amount_paise) || data.amount_paise <= 0) throw new Error('BAD_AMOUNT');
  const cat = officeCategory_(data.category);
  if (!cat) throw new Error('BAD_CATEGORY');
  if (OFFICE_DEPOSIT_LEG_CATEGORIES.indexOf(cat.id) !== -1) throw officeCoded_('DEPOSIT_LEG_CATEGORY'); // only deposit.add writes legs (R37)
  if (!cat.active) throw new Error('CATEGORY_INACTIVE');
  if (data.direction !== 'IN' && data.direction !== 'OUT') throw new Error('DIRECTION_MISMATCH');
  if (cat.direction !== data.direction) throw new Error('DIRECTION_MISMATCH');

  // Money account: who may use it, then that it is this campus's, then what it may carry.
  // Entries queued before accounts existed carry none: cash or bank of their own campus.
  if (officeBlank_(data.account)) data.account = (data.mode === 'cash' ? 'cash:' : 'bank:') + data.campus;
  const acct = officeAccount_(String(data.account || ''));
  if (!acct || !acct.active) throw new Error('BAD_ACCOUNT');
  officeAssertAccountAllowed_(ctx.caller, acct, cat);
  if (acct.campus !== data.campus) throw new Error('BAD_ACCOUNT');
  let settlesAccount = '';
  if (cat.id === 'credit_settlement') {
    const sa = officeAccount_(String(data.settles_account || ''));
    if (acct.kind !== 'bank' || !sa || !sa.active || sa.kind !== 'credit') throw new Error('SETTLEMENT_ACCOUNT_REQUIRED');
    settlesAccount = sa.id;
  } else if (!officeBlank_(data.settles_account) || !officeBlank_(data.settles)) throw new Error('NOT_A_SETTLEMENT');
  // Credit is an expense when incurred, so only expense categories; cash_transfer moves cash only.
  if (acct.kind === 'credit' && (cat.direction !== 'OUT' || (cat.group !== 'school' && cat.group !== 'transport'))) throw officeCoded_('FORBIDDEN_ACCOUNT');
  if (cat.id === 'cash_transfer' && acct.kind !== 'cash') throw officeCoded_('FORBIDDEN_ACCOUNT');

  // mode is derived from the account kind; only a bank account lets the client choose (bank or upi).
  const mode = acct.kind === 'bank' ? data.mode : acct.kind;
  if (acct.kind === 'bank' ? ['bank', 'upi'].indexOf(mode) === -1 : !officeBlank_(data.mode) && data.mode !== acct.kind) throw new Error('BAD_MODE');
  if (mode === 'cash' && OFFICE_BUCKETS.indexOf(data.bucket) === -1) throw new Error('BUCKET_REQUIRED');
  if (mode !== 'cash' && data.bucket) throw new Error('BUCKET_NOT_ALLOWED');

  const chargedTo = officeBlank_(data.charged_to) ? data.campus : data.charged_to;
  if (chargedTo !== 'CHAIRMAN' && OFFICE_CAMPUSES.indexOf(chargedTo) === -1) throw new Error('BAD_CHARGED_TO');

  const vehicle = officeNormReg_(data.vehicle);
  if (cat.needs_vehicle) {
    if (!vehicle) throw new Error('VEHICLE_REQUIRED');
    if (vehicle === 'FLEET' && cat.id === 'fuel') throw new Error('VEHICLE_REQUIRED'); // a fill needs one real meter (P9)
    if (vehicle !== 'FLEET' && !officeVehicles_().some(function (v) { return v.active && officeNormReg_(v.reg) === vehicle; })) throw new Error('BAD_VEHICLE');
  } else if (vehicle) throw new Error('BAD_VEHICLE');

  const isFuel = cat.id === 'fuel';
  if (isFuel) {
    if (typeof data.litres_ml !== 'number' || !Number.isSafeInteger(data.litres_ml) || data.litres_ml <= 0) throw new Error('LITRES_REQUIRED');
    if (typeof data.odometer_km !== 'number' || !Number.isSafeInteger(data.odometer_km) || data.odometer_km < 0) throw new Error('ODOMETER_REQUIRED');
  } else if (!officeBlank_(data.litres_ml) || !officeBlank_(data.odometer_km)) throw new Error('BAD_FIELD');
  // Every payment carries a photo of the bill or the signed receipt (deposit legs and reversals never come through here).
  if (data.direction === 'OUT') {
    if (!data.file_id) throw officeCoded_('FILE_REQUIRED');
    if (!officeRecentBooks_(data.campus).some(function (b) {
      return officeRows_(b, 'Files').some(function (f) { return f.id === String(data.file_id) && f.campus === data.campus; });
    })) throw officeCoded_('FILE_MISSING'); // same check as deposit.add
  }
  const odometerNote = isFuel ? String(data.odometer_note || '').trim() : '';

  // Student collections are tracked per head; no other category carries one.
  const collection = String(officeBlank_(data.collection) ? '' : data.collection);
  if (OFFICE_COLLECTION_CATEGORIES.indexOf(cat.id) !== -1) {
    if (!collection) throw officeCoded_('COLLECTION_REQUIRED');
    const head = officeCollection_(collection);
    if (!head || !head.active) throw officeCoded_('BAD_COLLECTION');
  } else if (collection) throw new Error('BAD_FIELD');

  // Day close is the cash count: it freezes cash-account rows only (bank, UPI and credit carry their real date).
  if (acct.kind === 'cash') officeAssertOpen_(ss, data.entry_date);
  if (isFuel && !odometerNote && data.odometer_km < officeLastOdometer_(data.campus, vehicle, data.entry_date)) throw officeCoded_('ODOMETER_BACKWARDS');
  return officeDaybookWrite_(ss, ctx, {
    id: data.id, campus: data.campus, entry_date: data.entry_date, direction: data.direction, mode: mode,
    bucket: mode === 'cash' ? data.bucket : '', category: data.category, amount_paise: data.amount_paise,
    payee: data.payee || '', narration: data.narration || '', file_id: data.file_id || '', reverses: '',
    account: acct.id, charged_to: chargedTo, vehicle: vehicle, litres_ml: isFuel ? data.litres_ml : '', odometer_km: isFuel ? data.odometer_km : '',
    odometer_note: odometerNote, supplier_bill_no: String(data.supplier_bill_no || '').trim(), settles_account: settlesAccount,
    settles: settlesAccount ? String(data.settles || '').trim() : '', source: 'live', collection: collection,
  }, 'daybook.add');
}

// Highest odometer of the vehicle's fuel fills dated on or before `date` in the campus's recent books (P4).
// Reversed fills and reversals are left out, so a mistyped reading that was reversed stops counting. -1 when none.
function officeLastOdometer_(campus, vehicle, date) {
  const rows = officeRecentBooks_(campus).reduce(function (acc, b) { return acc.concat(officeRows_(b, 'DayBook')); }, []);
  const reversed = {};
  rows.forEach(function (r) { if (r.reverses) reversed[r.reverses] = true; });
  return rows.reduce(function (m, r) {
    if (r.category !== 'fuel' || r.reverses || reversed[r.id] || r.entry_date > date || typeof r.odometer_km !== 'number' || !isFinite(r.odometer_km) || officeNormReg_(r.vehicle) !== vehicle) return m;
    return Math.max(m, r.odometer_km);
  }, -1);
}

function officeDaybookWrite_(ss, ctx, row, action) {
  const res = officeAppend_(ss, 'DayBook', row, ctx.caller, { action: action, campus: row.campus });
  return { id: res.id, duplicate: res.duplicate };
}

// Reversal is dated today and written to today's book. The original, its reversals and a retry of this same
// request are all looked up in today's book and the previous financial year's (if configured; R15, R41).
function officeDaybookReverse_(ctx, data) {
  if (!data.id) throw new Error('MISSING_ID');
  const books = officeRecentBooks_(data.campus), ss = books[0];
  const all = books.reduce(function (acc, b) { return acc.concat(officeRows_(b, 'DayBook')); }, []);
  if (all.some(function (r) { return r.id === String(data.id); })) return { id: String(data.id), duplicate: true }; // retry, even across 1 April
  const orig = all.filter(function (r) { return r.id === String(data.reverses) && r.campus === data.campus; })[0];
  if (!orig) throw new Error('NOT_FOUND');
  // A leg reversed alone would split a deposit; correcting a deposit is a later feature (R37).
  if (/:(out|in)$/.test(orig.id) || OFFICE_DEPOSIT_LEG_CATEGORIES.indexOf(orig.category) !== -1) throw officeCoded_('DEPOSIT_LEG');
  if (orig.reverses || all.some(function (r) { return r.reverses === orig.id; })) throw new Error('ALREADY_REVERSED');
  const account = officeRowAccount_(orig);
  const acct = officeAccount_(account) || { id: account, kind: orig.mode === 'cash' ? 'cash' : orig.mode === 'credit' ? 'credit' : 'bank', campus: orig.campus };
  officeAssertAccountAllowed_(ctx.caller, acct, officeCategory_(orig.category)); // inactive categories still reverse
  // defence in depth: day.close refuses today, but a closed today must never take a cash row
  if (orig.mode === 'cash') officeAssertOpen_(ss, officeToday_());
  return officeDaybookWrite_(ss, ctx, {
    id: data.id, campus: data.campus, entry_date: officeToday_(), direction: orig.direction === 'IN' ? 'OUT' : 'IN',
    mode: orig.mode, bucket: orig.bucket, category: orig.category, amount_paise: orig.amount_paise, payee: orig.payee,
    narration: data.narration || 'Reversal of ' + orig.id, file_id: '', reverses: orig.id,
    account: account, charged_to: officeRowChargedTo_(orig), vehicle: orig.vehicle, litres_ml: orig.litres_ml, odometer_km: orig.odometer_km,
    odometer_note: orig.odometer_note, supplier_bill_no: orig.supplier_bill_no, settles_account: orig.settles_account, settles: orig.settles,
    source: orig.source || 'live', legacy_category: orig.legacy_category, mapped_by: orig.mapped_by, collection: orig.collection,
  }, 'daybook.reverse');
}

function officeDaybookList_(ctx, data) {
  if (!officeIsoDate_(data.from)) throw new Error('BAD_DATE');
  const to = data.to === undefined || data.to === '' ? data.from : data.to;
  if (!officeIsoDate_(to)) throw new Error('BAD_DATE');
  const fy = officeFy_(data.from);
  if (officeFy_(to) !== fy) throw new Error('RANGE_SPANS_YEARS');
  const ss = officeOpen_(data.campus, fy);
  return { entries: officeRows_(ss, 'DayBook').filter(function (r) { return r.entry_date >= data.from && r.entry_date <= to; }) };
}

function officeDaybookBalances_(ctx, data) {
  if (!officeIsoDate_(data.date)) throw new Error('BAD_DATE');
  const ss = officeOpen_(data.campus, officeFy_(data.date));
  return officeBalances_(officeOpening_(ss), officeRows_(ss, 'DayBook'), data.date);
}

// Pure. `opening` is officeOpening_ shape; result.opening is that plus every row before `date`;
// in/out are `date`'s movements; closing = opening + in - out. Rows after `date` are ignored.
function officeBalances_(opening, rows, date) {
  const zero = function () { return { cash: { petty: 0, fee: 0, other: 0 }, bank: 0, upi: 0 }; };
  const add = function (acc, r, sign) {
    if (r.mode === 'credit') return; // a supplier credit line is neither cash nor bank (owed amounts: ledger.summary)
    if (r.mode === 'cash') acc.cash[r.bucket] += sign * r.amount_paise; else acc[r.mode] += sign * r.amount_paise;
  };
  const open = zero(), inn = zero(), out = zero(), close = zero();
  [open, close].forEach(function (a) {
    a.cash.petty = opening.cash.petty; a.cash.fee = opening.cash.fee; a.cash.other = opening.cash.other; a.bank = opening.bank; a.upi = opening.upi;
  });
  rows.forEach(function (r) {
    if (r.entry_date > date) return;
    const sign = r.direction === 'IN' ? 1 : -1;
    if (r.entry_date < date) { add(open, r, sign); add(close, r, sign); return; }
    add(r.direction === 'IN' ? inn : out, r, 1);
    add(close, r, sign);
  });
  return { opening: open, in: inn, out: out, closing: close };
}
