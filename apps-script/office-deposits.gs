// LMCS Office Backend -- bank deposits, deposit signing, hand-entered ERP totals and reconciliation.
// Append-only: a deposit is a Deposits row plus two Day Book legs; signing is a DepositSigns row
// (signed status is derived, R6); an ERP total is a new row and the latest per date wins.

function officeDepositsActions_() {
  return {
    'deposit.add': { roles: ['FeeClerk', 'AdminManager', 'Owner'], write: true, run: officeDepositAdd_ },
    'deposit.sign': { roles: ['FinanceHead', 'Owner'], write: true, run: officeDepositSign_ },
    'erp.set': { roles: ['FeeClerk', 'AdminManager', 'FinanceHead', 'Owner'], write: true, run: officeErpSet_ },
    'deposit.list': { roles: OFFICE_ALL_ROLES, write: false, run: officeDepositList_ },
    'recon.get': { roles: OFFICE_ALL_ROLES, write: false, run: officeReconGet_ },
  };
}

// Error with a `code` so clients can branch on it (officeHandle_ returns code and error).
function officeCoded_(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

function officeAddDays_(iso, n) {
  return new Date(new Date(iso + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
}

function officeDepositAdd_(ctx, data) {
  if (!data.id) throw new Error('MISSING_ID');
  if (typeof data.amount_paise !== 'number' || !Number.isSafeInteger(data.amount_paise) || data.amount_paise <= 0) throw new Error('BAD_AMOUNT');
  const bankRef = String(data.bank_ref || '').trim();
  if (!bankRef) throw new Error('BANK_REF_REQUIRED');
  if (!officeIsoDate_(data.covers_date)) throw new Error('BAD_DATE');
  const today = officeToday_();
  if (data.covers_date > today) throw new Error('FUTURE_DATE');
  if (!data.file_id) throw officeCoded_('FILE_REQUIRED');
  const books = officeRecentBooks_(data.campus), ss = books[0];
  if (!books.some(function (b) {
    return officeRows_(b, 'Files').some(function (f) { return f.id === String(data.file_id) && f.campus === data.campus; });
  })) throw officeCoded_('FILE_MISSING');
  // A retry may arrive after 1 April: look in both recent books (R41).
  const prior = books.reduce(function (acc, b) { return acc.concat(officeRows_(b, 'Deposits')); }, []).filter(function (r) { return r.id === String(data.id); })[0];
  if (prior) return officeDepositRepair_(ctx, prior); // retry: complete any leg a crash left behind (R21)
  const bankAccount = officeBlank_(data.bank_account) ? 'bank:' + data.campus : String(data.bank_account);
  const acct = officeAccount_(bankAccount);
  if (!acct || !acct.active || acct.kind !== 'bank' || acct.campus !== data.campus) throw new Error('BAD_ACCOUNT');
  officeAssertOpen_(ss, today); // covers_date may be a closed day; the deposit itself lands today
  const book = officeRows_(ss, 'DayBook');
  if (data.amount_paise > officeBalances_(officeOpening_(ss), book, today).closing.cash.fee) throw officeCoded_('INSUFFICIENT_CASH');
  const res = officeAppend_(ss, 'Deposits', {
    id: data.id, campus: data.campus, covers_date: data.covers_date, amount_paise: data.amount_paise, bank_ref: bankRef, file_id: data.file_id, bank_account: bankAccount,
  }, ctx.caller, { action: 'deposit.add', campus: data.campus });
  officeDepositLegs_(ctx, ss, res.id, data.campus, today, data.amount_paise, bankRef, data.covers_date, data.file_id, bankAccount);
  return { id: res.id, duplicate: false };
}

// Writes both Day Book legs of a deposit; each is idempotent by id, so re-running only fills gaps.
function officeDepositLegs_(ctx, ss, id, campus, date, amount, bankRef, coversDate, fileId, bankAccount) {
  const leg = function (suffix, category, direction, mode, bucket, account) {
    officeDaybookWrite_(ss, ctx, {
      id: id + ':' + suffix, campus: campus, entry_date: date, direction: direction, mode: mode, bucket: bucket, category: category,
      amount_paise: amount, payee: '', narration: 'Deposit ' + bankRef + ' for ' + coversDate, file_id: fileId, reverses: '',
      account: account, charged_to: campus,
    }, 'deposit.add');
  };
  leg('out', 'deposit_cash_out', 'OUT', 'cash', 'fee', 'cash:' + campus);
  leg('in', 'deposit_bank_in', 'IN', 'bank', '', bankAccount);
}

// Retry of a saved deposit: legs belong to the deposit's own IST date. Open day: fill missing legs.
// Closed day with a leg missing: write nothing and say so (LEGS_MISSING), so it surfaces for attention.
function officeDepositRepair_(ctx, dep) {
  const date = Utilities.formatDate(new Date(dep.created_at), 'Asia/Kolkata', 'yyyy-MM-dd');
  const ss = officeOpen_(dep.campus, officeFy_(date));
  const have = officeRows_(ss, 'DayBook').map(function (r) { return r.id; });
  if (have.indexOf(dep.id + ':out') !== -1 && have.indexOf(dep.id + ':in') !== -1) return { id: dep.id, duplicate: true };
  if (officeIsFrozen_(ss, date)) throw officeCoded_('LEGS_MISSING');
  officeDepositLegs_(ctx, ss, dep.id, dep.campus, date, dep.amount_paise, dep.bank_ref, dep.covers_date, dep.file_id, dep.bank_account || 'bank:' + dep.campus);
  return { id: dep.id, duplicate: true };
}

function officeDepositSign_(ctx, data) {
  if (!data.id) throw new Error('MISSING_ID');
  if (!data.deposit_id) throw new Error('MISSING_DEPOSIT');
  const books = officeRecentBooks_(data.campus);
  const home = books.filter(function (b) {
    return officeRows_(b, 'Deposits').some(function (d) { return d.id === String(data.deposit_id) && d.campus === data.campus; });
  })[0];
  if (!home) throw new Error('NOT_FOUND');
  const signs = officeRows_(home, 'DepositSigns');
  if (signs.some(function (s) { return s.id === String(data.id); })) return { id: String(data.id), duplicate: true }; // retry
  if (signs.some(function (s) { return s.deposit_id === String(data.deposit_id); })) throw officeCoded_('ALREADY_SIGNED');
  const res = officeAppend_(home, 'DepositSigns', { id: data.id, campus: data.campus, deposit_id: String(data.deposit_id) },
    ctx.caller, { action: 'deposit.sign', campus: data.campus });
  return { id: res.id, duplicate: res.duplicate };
}

// Deposits covering a date (R30). A deposit lands in the book of the day it was recorded, so look in the
// recent books like recon.get does, not only the covers_date's year. signed is derived from DepositSigns.
function officeDepositList_(ctx, data) {
  if (!officeIsoDate_(data.covers_date)) throw new Error('BAD_DATE');
  const books = officeRecentBooks_(data.campus);
  const all = function (tab) {
    return books.reduce(function (acc, b) { return acc.concat(officeRows_(b, tab)); }, []).filter(function (r) { return r.campus === data.campus; });
  };
  const signed = {};
  all('DepositSigns').forEach(function (s) { signed[s.deposit_id] = true; });
  return {
    deposits: all('Deposits').filter(function (d) { return d.covers_date === data.covers_date; }).map(function (d) {
      return { id: d.id, covers_date: d.covers_date, amount_paise: d.amount_paise, bank_ref: d.bank_ref, file_id: d.file_id, created_at: d.created_at, created_by: d.created_by, signed: !!signed[d.id] };
    }),
  };
}

function officeErpSet_(ctx, data) {
  if (!data.id) throw new Error('MISSING_ID');
  if (!officeIsoDate_(data.total_date)) throw new Error('BAD_DATE');
  if (typeof data.amount_paise !== 'number' || !Number.isSafeInteger(data.amount_paise) || data.amount_paise < 0) throw new Error('BAD_AMOUNT');
  const ss = officeOpen_(data.campus, officeFy_(data.total_date));
  const res = officeAppend_(ss, 'ErpTotals', { id: data.id, campus: data.campus, total_date: data.total_date, amount_paise: data.amount_paise },
    ctx.caller, { action: 'erp.set', campus: data.campus });
  return { id: res.id, duplicate: res.duplicate };
}

// Day-book fee cash per entry_date: fee_collection cash receipts less their reversals (which are dated later,
// possibly in a later book, so a second pass). The one rule for recon.get and Today's older-cash task (R43).
function officeFeeCashByDate_(rows) {
  const dateOf = {}, out = {};
  rows.forEach(function (r) {
    if (r.category !== 'fee_collection' || r.direction !== 'IN' || r.mode !== 'cash' || r.reverses || r.source === 'sheet') return; // imported days were deposited long ago
    dateOf[r.id] = r.entry_date;
    out[r.entry_date] = (out[r.entry_date] || 0) + r.amount_paise;
  });
  rows.forEach(function (r) { if (r.reverses && dateOf[r.reverses] !== undefined) out[dateOf[r.reverses]] -= r.amount_paise; });
  return out;
}

function officeReconGet_(ctx, data) {
  const date = data.date;
  if (!officeIsoDate_(date)) throw new Error('BAD_DATE');
  const dateBook = officeOpen_(data.campus, officeFy_(date));
  const books = officeRecentBooks_(data.campus);
  if (books.every(function (b) { return b !== dateBook; })) books.push(dateBook); // older than the recent books
  const all = function (tab) {
    return books.reduce(function (acc, b) { return acc.concat(officeRows_(b, tab)); }, []).filter(function (r) { return r.campus === data.campus; });
  };
  const erpRows = officeRows_(dateBook, 'ErpTotals').filter(function (r) { return r.campus === data.campus && r.total_date === date; });
  const latest = erpRows.reduce(function (m, r) { return !m || r.created_at >= m.created_at ? r : m; }, null);
  const erp = latest ? latest.amount_paise : null;
  const daybook = officeFeeCashByDate_(all('DayBook'))[date] || 0;
  const deps = all('Deposits').filter(function (d) { return d.covers_date === date; });
  const signed = {};
  all('DepositSigns').forEach(function (s) { signed[s.deposit_id] = true; });
  const deposited = deps.reduce(function (n, d) { return n + d.amount_paise; }, 0);
  const differences = [];
  if (erp !== null && erp !== daybook) differences.push({ a: 'erp', b: 'daybook_fee_cash', delta_paise: erp - daybook });
  if (daybook !== deposited) differences.push({ a: 'daybook_fee_cash', b: 'deposited', delta_paise: daybook - deposited });
  return {
    erp: erp, daybook_fee_cash: daybook, deposited: deposited,
    unsigned: deps.filter(function (d) { return !signed[d.id]; }).map(function (d) { return d.id; }),
    closed: officeIsFrozen_(dateBook, date), // closed itself or under a later closed day (R36)
    overdue: officeToday_() > officeAddDays_(date, 1) && deposited < daybook, // due by the end of the next IST day
    differences: differences,
  };
}
