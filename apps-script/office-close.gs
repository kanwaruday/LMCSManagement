// LMCS Office Backend -- day close and owner-only reopen. Append-only: a close is a Closes row, a
// reopen is a Reopens row; "closed" is derived (officeIsClosed_), never a flag edited in place.

function officeCloseActions_() {
  return {
    'day.close': { roles: ['FinanceHead', 'Owner'], write: true, run: officeDayClose_ },
    'day.reopen': { roles: ['Owner'], write: true, run: officeDayReopen_ },
  };
}

// Closed when the latest Closes row for the date is newer than the latest Reopens row (created_at;
// on a tie the counts decide: close/reopen strictly alternate, so more closes than reopens = closed).
// `ss` is the book of the date's financial year.
function officeIsClosed_(ss, isoDate) {
  const mine = function (tab) { return officeRows_(ss, tab).filter(function (r) { return r.close_date === isoDate; }); };
  const closes = mine('Closes'), reopens = mine('Reopens');
  if (!closes.length) return false;
  const latest = function (rows) { return rows.reduce(function (m, r) { return r.created_at > m ? r.created_at : m; }, ''); };
  const c = latest(closes), r = latest(reopens);
  return c !== r ? c > r : closes.length > reopens.length;
}

// Frozen (R36): `isoDate` or any later date of the book is currently closed. Balances run forward, so a
// row dated on or before a closed day would change that day's closing; such a date takes no writes.
function officeIsFrozen_(ss, isoDate) {
  const later = {};
  officeRows_(ss, 'Closes').forEach(function (r) { if (r.close_date >= isoDate) later[r.close_date] = true; });
  return Object.keys(later).some(function (d) { return officeIsClosed_(ss, d); });
}

// Shared guard for every write dated to a day (report.submit, deposit.add; daybook.add and daybook.reverse for cash-account rows only).
// The thrown error carries `code`, which officeHandle_ returns alongside `error`.
function officeAssertOpen_(ss, isoDate) {
  if (officeIsFrozen_(ss, isoDate)) throw officeCoded_('DAY_CLOSED');
}

function officeCloseDate_(data) {
  if (!data.id) throw new Error('MISSING_ID');
  if (!officeIsoDate_(data.close_date)) throw new Error('BAD_DATE');
  return data.close_date;
}

function officeDayClose_(ctx, data) {
  const date = officeCloseDate_(data);
  if (date > officeToday_()) throw new Error('FUTURE_DATE');
  if (date === officeToday_()) throw new Error('CANNOT_CLOSE_TODAY'); // reversals post to today, so today must stay open
  const ss = officeOpen_(data.campus, officeFy_(date));
  if (officeRows_(ss, 'Closes').some(function (r) { return r.id === String(data.id); })) return { id: String(data.id), duplicate: true }; // retry
  if (officeIsFrozen_(ss, date)) throw new Error('ALREADY_CLOSED'); // a day before a closed day is closed too
  const book = officeRows_(ss, 'DayBook');
  // Most recent earlier day with entries (this book only: the year's first day has no predecessor).
  const prev = book.reduce(function (m, r) { return r.entry_date < date && r.entry_date > m ? r.entry_date : m; }, '');
  if (prev && !officeIsFrozen_(ss, prev)) throw new Error('PREVIOUS_DAY_OPEN');
  const closing = officeBalances_(officeOpening_(ss), book, date);
  const res = officeAppend_(ss, 'Closes', { id: data.id, campus: data.campus, close_date: date, closing_json: JSON.stringify(closing) },
    ctx.caller, { action: 'day.close', campus: data.campus });
  return { id: res.id, duplicate: res.duplicate, closing: closing };
}

function officeDayReopen_(ctx, data) {
  const date = officeCloseDate_(data);
  const reason = String(data.reason || '').trim();
  if (!reason) throw new Error('REASON_REQUIRED');
  const ss = officeOpen_(data.campus, officeFy_(date));
  if (officeRows_(ss, 'Reopens').some(function (r) { return r.id === String(data.id); })) return { id: String(data.id), duplicate: true }; // retry
  // Latest-first (R36): reopening D under a later closed day would let D's new rows change that day's closing.
  const later = officeRows_(ss, 'Closes').some(function (r) { return r.close_date > date && officeIsClosed_(ss, r.close_date); });
  if (later) throw officeCoded_('LATER_DAY_CLOSED');
  if (!officeIsClosed_(ss, date)) throw new Error('NOT_CLOSED');
  const res = officeAppend_(ss, 'Reopens', { id: data.id, campus: data.campus, close_date: date, reason: reason },
    ctx.caller, { action: 'day.reopen', campus: data.campus });
  return { id: res.id, duplicate: res.duplicate };
}
