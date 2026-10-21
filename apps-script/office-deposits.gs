// LMCS Office Backend -- bank deposits, deposit signing, hand-entered ERP totals and reconciliation.
// Append-only: a deposit is a Deposits row plus two Day Book legs; signing is a DepositSigns row
// (signed status is derived, R6); an ERP total is a new row and the latest per date wins.

function officeDepositsActions_() {
  return {
    'deposit.add': { roles: ['FeeClerk', 'AdminManager', 'Owner'], write: true, run: officeDepositAdd_ },
    'deposit.sign': { roles: ['FinanceHead', 'Owner'], write: true, run: officeDepositSign_ },
    'erp.set': { roles: ['FeeClerk', 'AdminManager', 'FinanceHead', 'Owner'], write: true, run: officeErpSet_ },
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

// Books holding records for a campus: this financial year's, and the previous one's if it exists (R15 pattern).
function officeRecentBooks_(campus) {
  const fy = officeFy_(officeToday_());
  const prevStart = Number(fy.slice(0, 4)) - 1;
  const prevFy = prevStart + '-' + String((prevStart + 1) % 100).padStart(2, '0');
  const books = [officeOpen_(campus, fy)];
  if (PropertiesService.getScriptProperties().getProperty('OFFICE_SS_' + campus + '_' + prevFy)) books.push(officeOpen_(campus, prevFy));
  return books;
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
  if (officeRows_(ss, 'Deposits').some(function (r) { return r.id === String(data.id); })) return { id: String(data.id), duplicate: true }; // retry
  officeAssertOpen_(ss, today); // covers_date may be a closed day; the deposit itself lands today
  const book = officeRows_(ss, 'DayBook');
  if (data.amount_paise > officeBalances_(officeOpening_(ss), book, today).closing.cash.fee) throw officeCoded_('INSUFFICIENT_CASH');
  const res = officeAppend_(ss, 'Deposits', {
    id: data.id, campus: data.campus, covers_date: data.covers_date, amount_paise: data.amount_paise, bank_ref: bankRef, file_id: data.file_id,
  }, ctx.caller, { action: 'deposit.add', campus: data.campus });
  const leg = function (suffix, category, direction, mode, bucket) {
    officeDaybookWrite_(ss, ctx, {
      id: data.id + ':' + suffix, campus: data.campus, entry_date: today, direction: direction, mode: mode, bucket: bucket, category: category,
      amount_paise: data.amount_paise, payee: '', narration: 'Deposit ' + bankRef + ' for ' + data.covers_date, file_id: data.file_id, reverses: '',
    }, 'deposit.add');
  };
  leg('out', 'deposit_cash_out', 'OUT', 'cash', 'fee');
  leg('in', 'deposit_bank_in', 'IN', 'bank', '');
  return { id: res.id, duplicate: false };
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

function officeErpSet_(ctx, data) {
  if (!data.id) throw new Error('MISSING_ID');
  if (!officeIsoDate_(data.total_date)) throw new Error('BAD_DATE');
  if (typeof data.amount_paise !== 'number' || !Number.isSafeInteger(data.amount_paise) || data.amount_paise < 0) throw new Error('BAD_AMOUNT');
  const ss = officeOpen_(data.campus, officeFy_(data.total_date));
  const res = officeAppend_(ss, 'ErpTotals', { id: data.id, campus: data.campus, total_date: data.total_date, amount_paise: data.amount_paise },
    ctx.caller, { action: 'erp.set', campus: data.campus });
  return { id: res.id, duplicate: res.duplicate };
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
  // Day-book fee cash for the date: its fee_collection cash receipts less their reversals (which are dated later).
  const book = all('DayBook');
  const orig = book.filter(function (r) {
    return r.entry_date === date && r.category === 'fee_collection' && r.direction === 'IN' && r.mode === 'cash' && !r.reverses;
  });
  const ids = {};
  let daybook = 0;
  orig.forEach(function (r) { ids[r.id] = true; daybook += r.amount_paise; });
  book.forEach(function (r) { if (r.reverses && ids[r.reverses]) daybook -= r.amount_paise; });
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
    overdue: officeToday_() > officeAddDays_(date, 1) && deposited < daybook, // due by the end of the next IST day
    differences: differences,
  };
}
