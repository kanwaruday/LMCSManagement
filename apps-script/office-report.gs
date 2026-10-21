// LMCS Office Backend -- Daily Report and substitute grants. Append-only: a re-submit for the same
// date is a new Reports row and the latest created_at wins in report.get (R5). Money is integer paise.

function officeReportActions_() {
  return {
    'report.submit': { roles: ['FeeClerk', 'AdminManager', 'Owner'], substitute: true, write: true, run: officeReportSubmit_ },
    'report.get': { roles: OFFICE_ALL_ROLES, write: false, run: officeReportGet_ },
    'substitute.grant': { roles: ['AdminManager', 'Owner'], write: true, run: officeSubstituteGrant_ },
  };
}

// True when `email` holds a Substitutes row (in `ss`, the campus book for isoDate's year) covering isoDate.
// Rows are per campus book, so the campus check is the book itself.
function officeSubstitute_(ss, email, isoDate) {
  const e = String(email || '').toLowerCase();
  return officeRows_(ss, 'Substitutes').some(function (r) {
    return r.email === e && r.from_date <= isoDate && isoDate <= r.to_date;
  });
}

// Late = after 18:00:00 IST on report_date, or submitted on any later day (R14: accepted and flagged).
function officeReportLate_(reportDate) {
  const today = officeToday_();
  if (reportDate !== today) return reportDate < today;
  return new Date(officeNow_().getTime() + 19800000).toISOString().slice(11, 19) > '18:00:00';
}

function officeReportSubmit_(ctx, data) {
  if (!data.id) throw new Error('MISSING_ID');
  if (!officeIsoDate_(data.report_date)) throw new Error('BAD_DATE');
  if (data.report_date > officeToday_()) throw new Error('FUTURE_DATE');
  const cash = data.cash;
  OFFICE_BUCKETS.forEach(function (b) {
    if (!cash || typeof cash[b] !== 'number' || !Number.isSafeInteger(cash[b]) || cash[b] < 0) throw new Error('BAD_AMOUNT');
  });
  if (typeof data.footfall !== 'number' || !Number.isSafeInteger(data.footfall) || data.footfall < 0) throw new Error('BAD_FOOTFALL');
  if (!Array.isArray(data.hourly) || data.hourly.some(function (h) { return !h || typeof h.text !== 'string'; })) throw new Error('BAD_HOURLY');
  const ss = officeOpen_(data.campus, officeFy_(data.report_date));
  // A retry of a saved report stays a duplicate even if its day has since been closed.
  if (!officeRows_(ss, 'Reports').some(function (r) { return r.id === String(data.id); })) officeAssertOpen_(ss, data.report_date);
  const body = {
    hourly: data.hourly, footfall: data.footfall, feedback_pos: data.feedback_pos || '', feedback_neg: data.feedback_neg || '',
    leave_status: data.leave_status || '', external_docs: data.external_docs || '',
    cash: { petty: cash.petty, fee: cash.fee, other: cash.other },
  };
  const res = officeAppend_(ss, 'Reports', {
    id: data.id, campus: data.campus, report_date: data.report_date, json: JSON.stringify(body),
    late: officeReportLate_(data.report_date) ? 'true' : 'false', submitted_for: ctx.viaSubstitute ? 'substitute' : 'self',
  }, ctx.caller, { action: 'report.submit', campus: data.campus });
  return { id: res.id, duplicate: res.duplicate };
}

function officeReportGet_(ctx, data) {
  if (!officeIsoDate_(data.report_date)) throw new Error('BAD_DATE');
  const ss = officeOpen_(data.campus, officeFy_(data.report_date));
  // Latest created_at wins; on a tie the later row (rows are in append order).
  const mine = officeRows_(ss, 'Reports').filter(function (r) { return r.campus === data.campus && r.report_date === data.report_date; });
  const last = mine.reduce(function (m, r) { return !m || r.created_at >= m.created_at ? r : m; }, null);
  if (!last) return { report: null, cashMismatch: [] };
  const body = JSON.parse(last.json || '{}');
  const closing = officeBalances_(officeOpening_(ss), officeRows_(ss, 'DayBook'), data.report_date).closing.cash;
  const cashMismatch = [];
  OFFICE_BUCKETS.forEach(function (b) {
    if (body.cash[b] !== closing[b]) cashMismatch.push({ bucket: b, report_paise: body.cash[b], daybook_paise: closing[b] });
  });
  const report = Object.assign({ id: last.id, campus: last.campus, report_date: last.report_date, late: last.late, submitted_for: last.submitted_for, created_at: last.created_at, created_by: last.created_by }, body);
  return { report: report, cashMismatch: cashMismatch };
}

function officeSubstituteGrant_(ctx, data) {
  if (!data.id) throw new Error('MISSING_ID');
  if (!officeIsoDate_(data.from_date) || !officeIsoDate_(data.to_date)) throw new Error('BAD_DATE');
  if (data.from_date > data.to_date) throw new Error('BAD_RANGE');
  const email = String(data.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('BAD_EMAIL');
  // The check reads the book of the report date's year, so a grant spanning April is written to both books.
  let dup = false;
  [officeFy_(data.from_date), officeFy_(data.to_date)].filter(function (fy, i, a) { return a.indexOf(fy) === i; }).forEach(function (fy) {
    const res = officeAppend_(officeOpen_(data.campus, fy), 'Substitutes', { id: data.id, campus: data.campus, email: email, from_date: data.from_date, to_date: data.to_date },
      ctx.caller, { action: 'substitute.grant', campus: data.campus });
    dup = dup || res.duplicate;
  });
  return { id: String(data.id), duplicate: dup };
}
