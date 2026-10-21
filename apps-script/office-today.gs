// LMCS Office Backend -- Today task list. Each provider is a function (ctx) => task[]; ctx is
// {caller, campus, today, ss} (ss = this financial year's book). officeTodayProviders_() lists them
// (R1: later plans add a line there). Task: {id, title, due, status: done|due|overdue|waiting, action}.
// Providers filter by the caller's role themselves and are read-only.

function officeTodayActions_() {
  return {
    'today.get': { roles: OFFICE_ALL_ROLES, write: false, run: officeTodayGet_ },
  };
}

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
