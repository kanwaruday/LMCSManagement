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

// Strict ISO calendar date: shape and a real day (rejects 2026-02-30).
function officeIsoDate_(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
}

function officeDaybookAdd_(ctx, data) {
  if (!data.id) throw new Error('MISSING_ID');
  if (!officeIsoDate_(data.entry_date)) throw new Error('BAD_DATE');
  if (data.entry_date > officeToday_()) throw new Error('FUTURE_DATE');
  // typeof number only: "1,234.50" and other strings never reach arithmetic; floats and 0/negatives fail safe-integer > 0.
  if (typeof data.amount_paise !== 'number' || !Number.isSafeInteger(data.amount_paise) || data.amount_paise <= 0) throw new Error('BAD_AMOUNT');
  const cat = officeRows_(officeConfigBook_(), 'Categories').filter(function (c) { return c.id === data.category; })[0];
  if (!cat) throw new Error('BAD_CATEGORY');
  if (data.direction !== 'IN' && data.direction !== 'OUT') throw new Error('DIRECTION_MISMATCH');
  if (cat.direction !== data.direction) throw new Error('DIRECTION_MISMATCH');
  officeCheckModeBucket_(data.mode, data.bucket);
  const ss = officeOpen_(data.campus, officeFy_(data.entry_date));
  return officeDaybookWrite_(ss, ctx, {
    id: data.id, campus: data.campus, entry_date: data.entry_date, direction: data.direction, mode: data.mode,
    bucket: data.mode === 'cash' ? data.bucket : '', category: data.category, amount_paise: data.amount_paise,
    payee: data.payee || '', narration: data.narration || '', file_id: data.file_id || '', reverses: '',
  }, 'daybook.add');
}

function officeCheckModeBucket_(mode, bucket) {
  if (['cash', 'bank', 'upi'].indexOf(mode) === -1) throw new Error('BAD_MODE');
  if (mode === 'cash' && OFFICE_BUCKETS.indexOf(bucket) === -1) throw new Error('BUCKET_REQUIRED');
  if (mode !== 'cash' && bucket) throw new Error('BUCKET_NOT_ALLOWED');
}

function officeDaybookWrite_(ss, ctx, row, action) {
  const res = officeAppend_(ss, 'DayBook', row, ctx.caller, { action: action, campus: row.campus });
  return { id: res.id, duplicate: res.duplicate };
}

// Reversal is dated today and written to today's book; the original must be in that book.
function officeDaybookReverse_(ctx, data) {
  if (!data.id) throw new Error('MISSING_ID');
  const ss = officeOpen_(data.campus, officeFy_(officeToday_()));
  const rows = officeRows_(ss, 'DayBook');
  if (rows.some(function (r) { return r.id === String(data.id); })) return { id: String(data.id), duplicate: true }; // retry of the same request
  const orig = rows.filter(function (r) { return r.id === String(data.reverses) && r.campus === data.campus; })[0];
  if (!orig) throw new Error('NOT_FOUND');
  if (orig.reverses || rows.some(function (r) { return r.reverses === orig.id; })) throw new Error('ALREADY_REVERSED');
  return officeDaybookWrite_(ss, ctx, {
    id: data.id, campus: data.campus, entry_date: officeToday_(), direction: orig.direction === 'IN' ? 'OUT' : 'IN',
    mode: orig.mode, bucket: orig.bucket, category: orig.category, amount_paise: orig.amount_paise, payee: orig.payee,
    narration: data.narration || 'Reversal of ' + orig.id, file_id: '', reverses: orig.id,
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
