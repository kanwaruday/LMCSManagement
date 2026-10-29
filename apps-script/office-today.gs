// LMCS Office Backend -- Today task list. Each provider is a function (ctx) => task[]; ctx is
// {caller, campus, today, ss} (ss = this financial year's book). officeTodayProviders_() lists them
// (R1: later plans add a line there). Task: {id, title, due, status: done|due|overdue|waiting, action}.
// Providers filter by the caller's role themselves and are read-only.

function officeTodayActions_() {
  return {
    'today.get': { roles: OFFICE_ALL_ROLES, write: false, run: officeTodayGet_ },
    'today.summary': { roles: OFFICE_DESK_ROLES, write: false, run: officeTodaySummary_ },
  };
}

// The money desk: the roles whose daily routine is the Day Book (a Principal or Coordinator alone gets no summary).
var OFFICE_DESK_ROLES = ['FeeClerk', 'AdminManager', 'FinanceHead', 'Owner'];

function officeTodayProviders_() {
  return [
    officeTodayReportTasks_,
    officeTodayDepositTasks_,
    officeTodayCloseTasks_,
    officeTodaySignTasks_,
  ];
}

function officeTodayHas_(ctx, roles) {
  return roles.some(function (r) { return ctx.caller.roles.indexOf(r) !== -1; });
}

// The seven business days before today, newest first.
function officeTodayLastDays_(today) {
  const out = [];
  for (let i = 1; i <= 7; i++) out.push(officeAddDays_(today, -i));
  return out;
}

// A date whose financial-year book was never created has no data: providers skip it instead of throwing.
function officeTodayHasBook_(campus, isoDate) {
  return officeHasBook_(campus, officeFy_(isoDate));
}

function officeTodayGet_(ctx, data) {
  if (!data.campus) throw new Error('MISSING_CAMPUS');
  const today = officeToday_();
  const pctx = { caller: ctx.caller, campus: data.campus, today: today, ss: officeOpen_(data.campus, officeFy_(today)) };
  officeFuelMirrorDaily_(data.campus); // catches fills saved before the mirror existed; once a day per campus, never blocks Today
  let tasks = [];
  officeTodayProviders_().forEach(function (p, i) {
    try {
      tasks = tasks.concat(p(pctx));
    } catch (err) {
      tasks.push({ id: 'provider:' + i, title: 'Some tasks could not load', due: today, status: 'waiting', action: 'today' });
    }
  });
  const rank = { overdue: 0, due: 1, waiting: 2, done: 3 };
  tasks = tasks.map(function (t, i) { return { t: t, i: i }; }).sort(function (a, b) {
    return rank[a.t.status] - rank[b.t.status] || (a.t.due < b.t.due ? -1 : a.t.due > b.t.due ? 1 : 0) || a.i - b.i;
  }).map(function (x) { return x.t; });
  return { date: today, tasks: tasks };
}

// Daily report: due 18:00 today; done once any report exists for today (latest wins elsewhere, existence is enough here).
function officeTodayReportTasks_(ctx) {
  if (!officeTodayHas_(ctx, ['FeeClerk', 'AdminManager', 'Owner'])) return [];
  const done = officeRows_(ctx.ss, 'Reports').some(function (r) { return r.campus === ctx.campus && r.report_date === ctx.today; });
  return [{
    id: 'report:' + ctx.today, title: 'Submit the daily report', due: ctx.today + ' 18:00', action: 'report',
    status: done ? 'done' : officeReportLate_(ctx.today) ? 'overdue' : 'due',
  }];
}

// Deposits: overdue per recon.get for each of the last 7 days; yesterday still short of its cash is due.
function officeTodayDepositTasks_(ctx) {
  if (!officeTodayHas_(ctx, ['FeeClerk', 'AdminManager', 'Owner'])) return [];
  const out = [];
  officeTodayLastDays_(ctx.today).forEach(function (date, i) {
    if (!officeTodayHasBook_(ctx.campus, date)) return;
    const r = officeReconGet_({ caller: ctx.caller }, { campus: ctx.campus, date: date });
    if (r.overdue) out.push({ id: 'deposit:' + date, title: 'Deposit fee cash for ' + date, due: officeAddDays_(date, 1), status: 'overdue', action: 'deposits' });
    else if (i === 0 && r.deposited < r.daybook_fee_cash) out.push({ id: 'deposit:' + date, title: 'Deposit fee cash for ' + date, due: ctx.today, status: 'due', action: 'deposits' });
  });
  // Older than the window, this financial year only (M7): one summary task, so nothing is forgotten. One pass over
  // DayBook + Deposits across the recent books, the same totals recon.get gives per day (R43: not a recon per day).
  const cutoff = officeAddDays_(ctx.today, -7), fy = officeFy_(ctx.today);
  const rows = function (tab) {
    return officeRecentBooks_(ctx.campus).reduce(function (acc, b) { return acc.concat(officeRows_(b, tab)); }, []).filter(function (r) { return r.campus === ctx.campus; });
  };
  const cash = officeFeeCashByDate_(rows('DayBook')), deposited = {};
  rows('Deposits').forEach(function (d) { deposited[d.covers_date] = (deposited[d.covers_date] || 0) + d.amount_paise; });
  const short = Object.keys(cash).filter(function (date) {
    return date < cutoff && officeFy_(date) === fy && (deposited[date] || 0) < cash[date];
  }).sort();
  if (short.length) out.push({ id: 'deposit:older', title: 'Fee cash not fully deposited for ' + short.length + ' older day' + (short.length > 1 ? 's' : '') + ', oldest ' + short[0], due: officeAddDays_(short[0], 1), status: 'overdue', action: 'deposits' });
  return out;
}

// Day close (R16/R22): the OLDEST past day with Day Book rows that is not closed, the only one day.close accepts.
function officeTodayCloseTasks_(ctx) {
  if (!officeTodayHas_(ctx, ['FinanceHead', 'Owner'])) return [];
  const dates = {};
  officeRecentBooks_(ctx.campus).forEach(function (b) {
    officeRows_(b, 'DayBook').forEach(function (r) { if (r.campus === ctx.campus && r.entry_date < ctx.today) dates[r.entry_date] = true; });
  });
  const open = Object.keys(dates).sort().filter(function (d) {
    return !officeIsFrozen_(officeOpen_(ctx.campus, officeFy_(d)), d);
  })[0];
  return open ? [{ id: 'close:' + open, title: 'Close the day ' + open, due: ctx.today, status: 'due', action: 'close' }] : [];
}

// Unsigned deposits: one task per covered date in the last 7 days.
function officeTodaySignTasks_(ctx) {
  if (!officeTodayHas_(ctx, ['FinanceHead', 'Owner'])) return [];
  const out = [];
  officeTodayLastDays_(ctx.today).forEach(function (date) {
    if (!officeTodayHasBook_(ctx.campus, date)) return;
    const n = officeReconGet_({ caller: ctx.caller }, { campus: ctx.campus, date: date }).unsigned.length;
    if (n) out.push({ id: 'sign:' + date, title: 'Sign ' + n + ' deposit' + (n > 1 ? 's' : '') + ' for ' + date, due: ctx.today, status: 'due', action: 'deposits' });
  });
  return out;
}

// today.summary: the Game backend's desk rows (game-forms.gs), every campus the caller holds in one call, as flags and dates only
// (no amounts): {date, yesterday, campuses: {LMS1: {can, tasks, day, handovers}}}.
//   can        {report, close}: this person files the campus's report and deposits / closes its days and signs its deposits (the providers' roles)
//   tasks      today.get's list for the campus (the same providers, so the game's rows agree with the office Today list)
//   day        yesterday's recon as flags: booked (Day Book rows), cash (fee cash taken), banked (all of it deposited), erp (ERP total entered),
//              closed, unsigned (deposits waiting for a signature); null when yesterday has no book
//   handovers  cash sent to this campus by someone else, waiting (pending) or accepted since the start of yesterday: {id, from, date, state}
function officeTodaySummary_(ctx) {
  const today = officeToday_(), yday = officeAddDays_(today, -1), fy = officeFy_(today), holds = function (c) {
    return ctx.caller.campuses.indexOf('ALL') !== -1 || ctx.caller.campuses.indexOf(c) !== -1;
  };
  const me = String(ctx.caller.email).toLowerCase(), since = officeAddDays_(today, -1), accepted = {}, all = officeHandovers_();
  officeRows_(officeConfigBook_(), 'Handovers').forEach(function (r) { if (r.state === 'accepted') accepted[r.handover] = String(r.created_at || '').slice(0, 10); });
  const out = {};
  OFFICE_CAMPUSES.filter(function (c) { return holds(c) && officeHasBook_(c, fy); }).forEach(function (c) {
    const can = { report: officeTodayHas_(ctx, ['FeeClerk', 'AdminManager', 'Owner']), close: officeTodayHas_(ctx, ['FinanceHead', 'Owner']) };
    let day = null;
    if (officeTodayHasBook_(c, yday)) {
      const r = officeReconGet_({ caller: ctx.caller }, { campus: c, date: yday });
      const booked = officeRows_(officeOpen_(c, officeFy_(yday)), 'DayBook').some(function (x) { return x.campus === c && x.entry_date === yday; });
      day = { booked: booked, cash: r.daybook_fee_cash > 0, banked: r.deposited >= r.daybook_fee_cash, erp: r.erp !== null, closed: r.closed, unsigned: r.unsigned.length };
    }
    const handovers = Object.keys(all).map(function (k) { return all[k]; }).filter(function (ho) {
      if (ho.to_campus !== c || String(ho.created_by).toLowerCase() === me) return false; // the sender never accepts their own
      return ho.state === 'pending' || (ho.state === 'accepted' && (accepted[ho.id] || '') >= since);
    }).map(function (ho) { return { id: ho.id, from: ho.from_campus, date: ho.handover_date, state: ho.state }; });
    out[c] = { can: can, tasks: officeTodayGet_(ctx, { campus: c }).tasks, day: day, handovers: handovers };
  });
  return { date: today, yesterday: yday, campuses: out };
}
