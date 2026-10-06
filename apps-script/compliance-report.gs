// ═══════════════════════════════════════════════════════════════════
// Principal Compliance Report — RUN-MENU ONLY (no doGet/doPost, nothing
// here is reachable from the web app). One concern-specific file inside
// the single "LMCS Principal's Daily Reporting Backend" project, same
// as ss-forms-sync.gs's run-menu half.
//
// Pulls, for ONE calendar month (default: Sept 2026), per campus/Principal:
//   1. Principal DR (Daily Reports tab): submission rate against the
//      portal's own definition of a working day, timeliness, content
//      completeness, who actually filed, + Planned Activities hygiene.
//   2. Calendar updation: how promptly the Principal logs their
//      Support Sessions in their PERSONAL Calendar (event created vs
//      event date), SS per working day vs the portal's 3/day target,
//      and how current the school's OFFICIAL Calendar is.
//   3. SS Dashboard for that month: per role/campus staff quota
//      compliance (2 SS/employee/month), zero-SS staff by name, who
//      filed the SS, and a rubber-stamp (uniform-score) check.
//
// Definitions deliberately mirror what the portal itself does, so the
// numbers agree with what an Owner sees on screen:
//   - working day  = not Sunday, not 2nd Saturday, not a school-Calendar
//     event whose title starts "GH" (principal-dr.gs pdrDayLabel_)
//   - SS event     = personal-Calendar event whose title has the token
//     "SS" (principal-dr.gs pdrReadSupportSessionsForDate_)
//   - SS target    = 3 per working day (index.html MIN_SS_PER_DAY)
//   - SS quota     = getMonthlyQuota_() (ss-tracker.gs), met when >= quota
//     in the month; roster = getActiveEmployeeChoices_() (the same
//     department-based matching that fills each form's Name dropdown)
//
// OUTPUT: compact JSON, logged in numbered chunks (one campus can run
// past the Execution log's comfortable display size). Copy the WHOLE
// log. Each chunk starts with "@@CR|<campus>|<i>/<n>|" so a pasted log
// can be reassembled mechanically.
//
// USAGE: run complianceReportAll() from the editor. If it ever hits the
// 6-minute limit, run complianceReportLMS1() .. complianceReportLMS6()
// one at a time instead. complianceReportCalendarCheck() is a fast
// (few-seconds) dry run that only reports which Calendars this script
// can actually open -- run it first if you want to know in advance.
//
// Read-only: never writes to any Sheet or Calendar.
// ═══════════════════════════════════════════════════════════════════

const CMP_REPORT_YEAR = 2026;
const CMP_REPORT_MONTH = 9; // 1-12 -- the month being reported ("previous month" as of 2026-10-05)
const CMP_CAMPUSES = ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6'];
const CMP_MIN_SS_PER_DAY = 3; // keep in sync with index.html's MIN_SS_PER_DAY
const CMP_CHUNK = 3000;       // max characters per logged chunk

function complianceReportAll() { cmpRun_(CMP_CAMPUSES); }
function complianceReportLMS1() { cmpRun_(['LMS1']); }
function complianceReportLMS2() { cmpRun_(['LMS2']); }
function complianceReportLMS3() { cmpRun_(['LMS3']); }
function complianceReportLMS4() { cmpRun_(['LMS4']); }
function complianceReportLMS5() { cmpRun_(['LMS5']); }
function complianceReportLMS6() { cmpRun_(['LMS6']); }

/** Fast dry run: can this script open each Calendar the report needs? */
function complianceReportCalendarCheck() {
  const out = { personal: {}, school: {} };
  CMP_CAMPUSES.forEach(function (c) {
    const email = PDR_PRINCIPAL_PERSONAL_CALENDARS[c];
    let cal = null;
    try { cal = email ? CalendarApp.getCalendarById(email) : null; } catch (e) { cal = null; }
    out.personal[c] = { email: email || null, accessible: !!cal };
    const calId = PDR_SCHOOL_CALENDAR_IDS[c];
    let scal = null;
    try { scal = calId ? CalendarApp.getCalendarById(calId) : null; } catch (e) { scal = null; }
    out.school[c] = { accessible: !!scal };
  });
  Logger.log('@@CALCHECK ' + JSON.stringify(out));
}

// ── helpers ─────────────────────────────────────────────────────────

function cmpDayStart_(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function cmpAddDays_(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function cmpDayDiff_(a, b) { return Math.round((cmpDayStart_(a).getTime() - cmpDayStart_(b).getTime()) / 86400000); }
function cmpYM_(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
function cmpRound_(n, dp) { const f = Math.pow(10, dp || 0); return Math.round(n * f) / f; }
function cmpPct_(num, den) { return den ? cmpRound_((num / den) * 100, 1) : null; }
function cmpMean_(a) { return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : null; }
function cmpMedian_(a) {
  if (!a.length) return null;
  const s = a.slice().sort(function (x, y) { return x - y; });
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function cmpSd_(a) {
  if (a.length < 2) return null;
  const mu = cmpMean_(a);
  return Math.sqrt(a.reduce(function (s, x) { return s + (x - mu) * (x - mu); }, 0) / a.length);
}
function cmpCount_(map, key) { map[key] = (map[key] || 0) + 1; }
function cmpToDate_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (v === '' || v === null || v === undefined) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
function cmpIsSecondSaturday_(d) { return d.getDay() === 6 && Math.ceil(d.getDate() / 7) === 2; }

/** Logs `obj` as numbered chunks so nothing gets truncated. */
function cmpLogChunks_(tag, obj) {
  const s = JSON.stringify(obj);
  const n = Math.max(1, Math.ceil(s.length / CMP_CHUNK));
  for (let i = 0; i < n; i++) {
    Logger.log('@@CR|' + tag + '|' + (i + 1) + '/' + n + '|' + s.substr(i * CMP_CHUNK, CMP_CHUNK));
  }
}

// ── main ────────────────────────────────────────────────────────────

function cmpRun_(campuses) {
  const t0 = new Date();
  const monthStart = new Date(CMP_REPORT_YEAR, CMP_REPORT_MONTH - 1, 1);
  const monthEnd = new Date(CMP_REPORT_YEAR, CMP_REPORT_MONTH, 1); // exclusive
  const today = cmpDayStart_(new Date());

  const shared = {
    monthStart: monthStart,
    monthEnd: monthEnd,
    today: today,
    principals: cmpSafe_(cmpPrincipals_, {}),
    reports: cmpSafe_(cmpReadDailyReports_, []),
    planned: cmpSafe_(cmpReadPlanned_, []),
    schoolCal: {},   // calId -> events (light objects) | null if inaccessible
    ss: cmpSafe_(function () { return cmpSsMonth_(monthStart, monthEnd); }, { byCampus: {}, evaluators: {}, orphans: {}, err: 'ss failed' }),
  };

  const meta = {
    month: cmpYM_(monthStart),
    generatedAt: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss"),
    tz: Session.getScriptTimeZone(),
    minSsPerDay: CMP_MIN_SS_PER_DAY,
    ssQuota: SS_QUOTA_DEFAULT_PER_MONTH,
    dailyReportRowsTotal: shared.reports.length,
    plannedRowsTotal: shared.planned.length,
    evaluators: shared.ss.evaluators,
    orphans: shared.ss.orphans,
  };
  cmpLogChunks_('META', meta);

  campuses.forEach(function (campusId) {
    let out;
    try { out = cmpCampus_(campusId, shared); }
    catch (e) { out = { campus: campusId, fatal: String(e && e.message || e) }; }
    cmpLogChunks_(campusId, out);
  });

  Logger.log('@@CR|DONE|1/1|elapsed ' + Math.round((new Date() - t0) / 1000) + 's, campuses=' + campuses.join(','));
}

function cmpSafe_(fn, fallback) {
  try { return fn(); } catch (e) { Logger.log('@@CR|WARN|1/1|' + (fn.name || 'fn') + ': ' + (e && e.message || e)); return fallback; }
}

// ── data readers ────────────────────────────────────────────────────

/** campusId -> [{name,email,role}] for allowlist rows whose Role includes "Principal". */
function cmpPrincipals_() {
  const rows = SpreadsheetApp.openById(ALLOWLIST_SHEET_ID).getSheets()[0].getDataRange().getValues();
  const out = {};
  for (let i = 1; i < rows.length; i++) {
    const email = String(rows[i][0] || '').trim().toLowerCase();
    const role = String(rows[i][3] || '');
    if (!email || !/Principal/i.test(role)) continue;
    const campus = String(rows[i][2] || '').trim().toUpperCase();
    (out[campus] = out[campus] || []).push({ name: String(rows[i][1] || '').trim(), email: email, role: role.trim() });
  }
  return out;
}

function cmpReadDailyReports_() {
  const v = pdrDailyReportsSheet_().getDataRange().getValues();
  const h = v[0].map(function (x) { return String(x).trim(); });
  const ix = function (name, fallback) { const i = h.indexOf(name); return i >= 0 ? i : fallback; };
  const c = {
    ts: ix('Timestamp', 0), date: ix('Date', 1), campus: ix('CampusId', 2), email: ix('PrincipalEmail', 3),
    maClass: ix('MA_ClassOrHouse', 4), maScore: ix('MA_Score', 5), tc: ix('TasksCompleted', 6),
    tft: ix('TasksForTomorrow', 7), reg: ix('RegistersCrosschecked', 8), msg: ix('ImportantMessage', 9),
  };
  const out = [];
  for (let i = 1; i < v.length; i++) {
    const r = v[i];
    const campus = String(r[c.campus] || '').trim().toUpperCase();
    const dateISO = pdrCellDateToISO_(r[c.date]);
    if (!campus || !/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) continue;
    const scoreRaw = r[c.maScore];
    out.push({
      campus: campus,
      dateISO: dateISO,
      ts: cmpToDate_(r[c.ts]),
      email: String(r[c.email] || '').trim().toLowerCase(),
      ma: (scoreRaw === '' || scoreRaw === null || scoreRaw === undefined || isNaN(Number(scoreRaw))) ? null : Number(scoreRaw),
      tc: pdrSplitList_(r[c.tc]).length,
      tft: pdrSplitList_(r[c.tft]).length,
      reg: pdrSplitList_(r[c.reg]).length,
      msg: String(r[c.msg] || '').trim() !== '',
    });
  }
  return out;
}

function cmpReadPlanned_() {
  const v = pdrPlannedActivitiesSheet_().getDataRange().getValues();
  const h = v[0].map(function (x) { return String(x).trim(); });
  const ix = function (name, fallback) { const i = h.indexOf(name); return i >= 0 ? i : fallback; };
  const c = { campus: ix('CampusId', 1), due: ix('DueDate', 3), created: ix('CreatedAt', 5), status: ix('Status', 7), completed: ix('CompletedAt', 8) };
  const out = [];
  for (let i = 1; i < v.length; i++) {
    const r = v[i];
    const campus = String(r[c.campus] || '').trim().toUpperCase();
    if (!campus) continue;
    out.push({
      campus: campus,
      dueISO: pdrCellDateToISO_(r[c.due]),
      created: cmpToDate_(r[c.created]),
      status: String(r[c.status] || '').trim(),
      completed: cmpToDate_(r[c.completed]),
    });
  }
  return out;
}

/** School Calendar events as light objects, cached per calendar id (LMS2/LMS3 share one). */
function cmpSchoolEvents_(campusId, shared) {
  const calId = PDR_SCHOOL_CALENDAR_IDS[campusId];
  if (!calId) return { accessible: false, events: [] };
  if (shared.schoolCal.hasOwnProperty(calId)) return shared.schoolCal[calId];
  let res;
  try {
    const cal = CalendarApp.getCalendarById(calId);
    if (!cal) { res = { accessible: false, events: [] }; }
    else {
      // previous month .. +4 months: enough for GH detection, a few months of "is the future populated" counts, and recent-edit stats.
      const winStart = new Date(shared.monthStart.getFullYear(), shared.monthStart.getMonth() - 1, 1);
      const winEnd = new Date(shared.monthStart.getFullYear(), shared.monthStart.getMonth() + 4, 1);
      const evs = cal.getEvents(winStart, winEnd).map(function (ev) {
        let created = null, updated = null;
        try { created = ev.getDateCreated(); } catch (e) {}
        try { updated = ev.getLastUpdated(); } catch (e) {}
        return { title: ev.getTitle(), start: ev.getStartTime(), end: ev.getEndTime(), created: created, updated: updated };
      });
      res = { accessible: true, events: evs };
    }
  } catch (e) { res = { accessible: false, events: [], err: String(e && e.message || e) }; }
  shared.schoolCal[calId] = res;
  return res;
}

// ── SS dashboard for the month (same logic as ss-tracker.gs, month-parameterised) ──

function cmpSsMonth_(monthStart, monthEnd) {
  const byCampus = {};   // campus -> { roleKey -> stats, filedBy:{email:n}, totalSs }
  const evaluators = {}; // email -> [totals] (turned into stats below)
  const orphans = {};    // roleKey -> count of in-month submissions for someone not on that role's current roster
  const inMonth = function (s) { return s.timestamp && s.timestamp >= monthStart && s.timestamp < monthEnd; };

  ACTIVE_SS_ROLES.forEach(function (roleKey) {
    const config = SS_ROLE_CONFIGS[roleKey];
    const quota = getMonthlyQuota_(roleKey);
    const subs = ssReadAllSubmissions_(roleKey).filter(inMonth);

    const byEmp = {};
    subs.forEach(function (s) { (byEmp[s.employeeName] = byEmp[s.employeeName] || []).push(s); });

    const rosterSet = {};
    Object.keys(config.forms).forEach(function (formKey) {
      getActiveEmployeeChoices_(config, formKey).forEach(function (name) {
        rosterSet[name] = true;
        const school = ssSchoolFromEmployeeString_(name);
        if (!school) return;
        const campus = school.replace(' ', '');
        const cb = byCampus[campus] = byCampus[campus] || { roles: {}, filedBy: {}, totalSs: 0 };
        const st = cb.roles[roleKey] = cb.roles[roleKey] || { n: 0, met: 0, one: 0, zero: 0, zeroNames: [], ss: 0, scores: [] };
        const arr = byEmp[name] || [];
        st.n++;
        st.ss += arr.length;
        if (arr.length >= quota) st.met++;
        else if (arr.length === 1) st.one++;
        if (arr.length === 0) { st.zero++; st.zeroNames.push(name); }
        arr.forEach(function (s) { st.scores.push(s.total); });
      });
    });

    subs.forEach(function (s) {
      if (!rosterSet[s.employeeName]) orphans[roleKey] = (orphans[roleKey] || 0) + 1;
      const school = ssSchoolFromEmployeeString_(s.employeeName);
      const campus = school ? school.replace(' ', '') : 'UNKNOWN';
      const cb = byCampus[campus] = byCampus[campus] || { roles: {}, filedBy: {}, totalSs: 0 };
      cb.totalSs++;
      cmpCount_(cb.filedBy, s.evaluatorEmail || '(no email)');
      (evaluators[s.evaluatorEmail || '(no email)'] = evaluators[s.evaluatorEmail || '(no email)'] || []).push(s.total);
    });
  });

  // collapse score arrays to compact stats
  Object.keys(byCampus).forEach(function (campus) {
    Object.keys(byCampus[campus].roles).forEach(function (roleKey) {
      const st = byCampus[campus].roles[roleKey];
      st.avg = st.scores.length ? cmpRound_(cmpMean_(st.scores), 1) : null;
      delete st.scores;
    });
  });
  const evStats = {};
  Object.keys(evaluators).forEach(function (email) {
    const a = evaluators[email];
    evStats[email] = { n: a.length, mean: cmpRound_(cmpMean_(a), 1), sd: a.length > 1 ? cmpRound_(cmpSd_(a), 1) : null, min: Math.min.apply(null, a), max: Math.max.apply(null, a) };
  });
  return { byCampus: byCampus, evaluators: evStats, orphans: orphans };
}

// ── per-campus assembly ─────────────────────────────────────────────

function cmpCampus_(campusId, shared) {
  const principals = shared.principals[campusId] || [];
  const calEmail = PDR_PRINCIPAL_PERSONAL_CALENDARS[campusId] || null;
  const principalEmails = principals.map(function (p) { return p.email; });
  if (calEmail && principalEmails.indexOf(calEmail) < 0) principalEmails.push(calEmail);

  const school = cmpSchoolEvents_(campusId, shared);
  const gh = school.events
    .filter(function (e) { return String(e.title || '').indexOf('GH') === 0; })
    .map(function (e) { return { title: e.title, start: e.start, end: e.end }; });

  const wdMonth = cmpWorkingDays_(shared.monthStart, shared.monthEnd, gh);
  const dr = cmpDailyReport_(campusId, shared, wdMonth, principalEmails, gh);
  const ssCal = cmpPersonalCalendar_(campusId, calEmail, wdMonth);
  const schoolCal = cmpSchoolCalendar_(school, shared, campusId);
  const ssc = shared.ss.byCampus[campusId] || { roles: {}, filedBy: {}, totalSs: 0 };

  return {
    campus: campusId,
    principals: principals.map(function (p) { return { name: p.name, email: p.email }; }),
    calendarEmail: calEmail,
    dr: dr.dr,
    planned: cmpPlanned_(campusId, shared),
    ssCal: ssCal,
    schoolCal: schoolCal,
    ssDash: ssc.roles,
    ssFiledBy: ssc.filedBy,
    ssTotal: ssc.totalSs,
    wd: dr.wd,
  };
}

function cmpWorkingDays_(start, end, ghEvents) {
  const wd = [], non = [];
  for (let d = new Date(start); d < end; d = cmpAddDays_(d, 1)) {
    let label = null;
    if (d.getDay() === 0) label = 'Sunday';
    else if (cmpIsSecondSaturday_(d)) label = '2nd Saturday';
    else {
      const dayEnd = cmpAddDays_(d, 1);
      for (let i = 0; i < ghEvents.length; i++) {
        if (ghEvents[i].start < dayEnd && ghEvents[i].end > d) { label = ghEvents[i].title; break; }
      }
    }
    const rec = { d: new Date(d), iso: pdrFormatISO_(d), day: d.getDate(), label: label };
    (label ? non : wd).push(rec);
  }
  return { wd: wd, non: non };
}

function cmpDailyReport_(campusId, shared, wdMonth, principalEmails, gh) {
  const rows = shared.reports.filter(function (r) { return r.campus === campusId; });
  const inRange = function (r, a, b) { return r.dateISO >= pdrFormatISO_(a) && r.dateISO < pdrFormatISO_(b); };
  const monthRows = rows.filter(function (r) { return inRange(r, shared.monthStart, shared.monthEnd); });

  // one row per date (latest save wins); count duplicates
  let dup = 0, badTs = 0;
  const byDate = {};
  monthRows.forEach(function (r) {
    if (!r.ts) badTs++;
    const prev = byDate[r.dateISO];
    if (prev) {
      dup++;
      if (r.ts && (!prev.ts || r.ts > prev.ts)) byDate[r.dateISO] = r;
    } else byDate[r.dateISO] = r;
  });

  const isPrincipal = function (r) { return principalEmails.indexOf(r.email) >= 0; };
  const wdISO = wdMonth.wd.map(function (x) { return x.iso; });
  const submittedWd = wdMonth.wd.filter(function (x) { return byDate[x.iso]; });
  const creditedWd = wdMonth.wd.filter(function (x) { return byDate[x.iso] && isPrincipal(byDate[x.iso]); });
  const missed = wdMonth.wd.filter(function (x) { return !byDate[x.iso]; }).map(function (x) { return x.day; });
  const onNon = wdMonth.non.filter(function (x) { return byDate[x.iso]; }).map(function (x) { return x.day + ':' + x.label; });

  // adoption-adjusted (from this campus's first report in the month)
  const dates = Object.keys(byDate).sort();
  const first = dates.length ? dates[0] : null;
  const adjWd = first ? wdMonth.wd.filter(function (x) { return x.iso >= first; }) : [];
  const adjSub = adjWd.filter(function (x) { return byDate[x.iso]; });

  // last-saved lag vs report date (Timestamp is the LAST save -- an upsert overwrites it)
  const lag = { early: 0, same: 0, next: 0, later: 0 };
  const hours = [];
  Object.keys(byDate).forEach(function (iso) {
    const r = byDate[iso];
    if (!r.ts) return;
    const diff = cmpDayDiff_(r.ts, pdrParseISO_(iso));
    if (diff < 0) lag.early++; else if (diff === 0) { lag.same++; hours.push(r.ts.getHours() + r.ts.getMinutes() / 60); } else if (diff === 1) lag.next++; else lag.later++;
  });

  // longest run of consecutive WORKING days with a report
  let streak = 0, best = 0;
  wdMonth.wd.forEach(function (x) { if (byDate[x.iso]) { streak++; best = Math.max(best, streak); } else streak = 0; });

  // content
  const uniq = Object.keys(byDate).map(function (k) { return byDate[k]; });
  const maRows = uniq.filter(function (r) { return r.ma !== null; });
  const tcRows = uniq.filter(function (r) { return r.tc > 0; });
  const tftRows = uniq.filter(function (r) { return r.tft > 0; });
  const regRows = uniq.filter(function (r) { return r.reg > 0; });
  const filers = {};
  monthRows.forEach(function (r) { cmpCount_(filers, r.email || '(none)'); });

  // month-to-date of the FOLLOWING month (trend since the reported month closed)
  const mtdStart = shared.monthEnd, mtdEnd = shared.today; // today exclusive: today's report may not be filed yet
  let mtd = null;
  if (mtdEnd > mtdStart) {
    const wdM = cmpWorkingDays_(mtdStart, mtdEnd, gh);
    const mRows = {};
    rows.forEach(function (r) { if (r.dateISO >= pdrFormatISO_(mtdStart) && r.dateISO < pdrFormatISO_(mtdEnd)) mRows[r.dateISO] = r; });
    mtd = {
      month: cmpYM_(mtdStart),
      through: pdrFormatISO_(cmpAddDays_(mtdEnd, -1)),
      wd: wdM.wd.length,
      submitted: wdM.wd.filter(function (x) { return mRows[x.iso]; }).length,
      missed: wdM.wd.filter(function (x) { return !mRows[x.iso]; }).map(function (x) { return x.day; }),
    };
  }
  const lastEver = rows.length ? rows.map(function (r) { return r.dateISO; }).sort().slice(-1)[0] : null;

  return {
    wd: { days: wdMonth.wd.map(function (x) { return x.day; }), non: wdMonth.non.filter(function (x) { return x.label !== 'Sunday'; }).map(function (x) { return x.day + ':' + x.label; }) },
    dr: {
      workingDays: wdMonth.wd.length,
      submitted: submittedWd.length,
      ratePct: cmpPct_(submittedWd.length, wdMonth.wd.length),
      creditedToPrincipal: creditedWd.length,
      creditedPct: cmpPct_(creditedWd.length, wdMonth.wd.length),
      missedDays: missed,
      filedOnNonWorking: onNon,
      firstReport: first,
      adoptionAdj: { wd: adjWd.length, submitted: adjSub.length, pct: cmpPct_(adjSub.length, adjWd.length) },
      lastSaved: { sameDay: lag.same, nextDay: lag.next, laterThan1Day: lag.later, beforeDate: lag.early, medianHourSameDay: hours.length ? cmpRound_(cmpMedian_(hours), 1) : null },
      longestStreakWd: best,
      duplicatesForADate: dup,
      unparsedTimestamps: badTs,
      filers: filers,
      content: {
        maFilledDays: maRows.length,
        maAvg: maRows.length ? cmpRound_(cmpMean_(maRows.map(function (r) { return r.ma; })), 1) : null,
        tasksCompletedDays: tcRows.length,
        tasksCompletedAvgItems: tcRows.length ? cmpRound_(cmpMean_(tcRows.map(function (r) { return r.tc; })), 1) : null,
        tasksForTomorrowDays: tftRows.length,
        tasksForTomorrowAvgItems: tftRows.length ? cmpRound_(cmpMean_(tftRows.map(function (r) { return r.tft; })), 1) : null,
        registersDays: regRows.length,
        registersAvgItems: regRows.length ? cmpRound_(cmpMean_(regRows.map(function (r) { return r.reg; })), 1) : null,
        importantMessageDays: uniq.filter(function (r) { return r.msg; }).length,
        reportsConsidered: uniq.length,
      },
      monthToDateNext: mtd,
      lastReportEver: lastEver,
    },
  };
}

function cmpPlanned_(campusId, shared) {
  const rows = shared.planned.filter(function (r) { return r.campus === campusId; });
  const todayISO = pdrFormatISO_(shared.today);
  const inMonth = function (d) { return d && d >= shared.monthStart && d < shared.monthEnd; };
  return {
    total: rows.length,
    active: rows.filter(function (r) { return r.status === 'Active'; }).length,
    completed: rows.filter(function (r) { return r.status === 'Completed'; }).length,
    deleted: rows.filter(function (r) { return r.status === 'Deleted'; }).length,
    createdInMonth: rows.filter(function (r) { return inMonth(r.created); }).length,
    completedInMonth: rows.filter(function (r) { return inMonth(r.completed); }).length,
    overdueOpenNow: rows.filter(function (r) { return r.status === 'Active' && r.dueISO && r.dueISO < todayISO; }).length,
  };
}

function cmpPersonalCalendar_(campusId, email, wdMonth) {
  if (!email) return { accessible: false, reason: 'no calendar email configured' };
  let cal = null;
  try { cal = CalendarApp.getCalendarById(email); } catch (e) { return { accessible: false, email: email, err: String(e && e.message || e) }; }
  if (!cal) return { accessible: false, email: email };

  const start = new Date(CMP_REPORT_YEAR, CMP_REPORT_MONTH - 1, 1);
  const end = new Date(CMP_REPORT_YEAR, CMP_REPORT_MONTH, 1);
  const events = cal.getEvents(start, end);
  const ssTag = /\bSS\b/;
  const perDay = {};
  let blank = 0, ssCount = 0, recurring = 0, lastUpd = null;
  const adv = [], same = [], back = []; // lag in days for non-recurring SS events
  events.forEach(function (ev) {
    const title = ev.getTitle();
    if (!title || /^busy$/i.test(title)) blank++;
    if (!ssTag.test(title)) return;
    ssCount++;
    const dayISO = pdrFormatISO_(ev.getStartTime());
    cmpCount_(perDay, dayISO);
    let isRec = false;
    try { isRec = ev.isRecurringEvent(); } catch (e) {}
    if (isRec) { recurring++; return; }
    try {
      const created = ev.getDateCreated();
      const lag = cmpDayDiff_(created, ev.getStartTime()); // <0 created before the day, 0 same day, >0 back-filled
      if (lag < 0) adv.push(lag); else if (lag === 0) same.push(lag); else back.push(lag);
      const upd = ev.getLastUpdated();
      if (!lastUpd || upd > lastUpd) lastUpd = upd;
    } catch (e) {}
  });

  const perWd = wdMonth.wd.map(function (x) { return perDay[x.iso] || 0; });
  const onNonWd = wdMonth.non.reduce(function (s, x) { return s + (perDay[x.iso] || 0); }, 0);
  const lagN = adv.length + same.length + back.length;
  return {
    accessible: true,
    email: email,
    eventsTotal: events.length,
    blankOrBusyTitles: blank,
    ssEvents: ssCount,
    ssRecurring: recurring,
    ssOnWorkingDays: perWd.reduce(function (s, x) { return s + x; }, 0),
    ssOnNonWorking: onNonWd,
    perWorkingDay: perWd, // aligned with wd.days
    avgPerWorkingDay: wdMonth.wd.length ? cmpRound_(perWd.reduce(function (s, x) { return s + x; }, 0) / wdMonth.wd.length, 2) : null,
    daysMeetingTarget: perWd.filter(function (n) { return n >= CMP_MIN_SS_PER_DAY; }).length,
    daysWithZero: perWd.filter(function (n) { return n === 0; }).length,
    maxInADay: perWd.length ? Math.max.apply(null, perWd) : 0,
    entryTiming: {
      nonRecurringSs: lagN,
      loggedInAdvance: adv.length,
      loggedSameDay: same.length,
      backFilled: back.length,
      backFilledPct: cmpPct_(back.length, lagN),
      backFilledMedianLagDays: back.length ? cmpMedian_(back) : null,
      backFilledMaxLagDays: back.length ? Math.max.apply(null, back) : null,
    },
    lastUpdatedSs: lastUpd ? Utilities.formatDate(lastUpd, Session.getScriptTimeZone(), 'yyyy-MM-dd') : null,
  };
}

function cmpSchoolCalendar_(school, shared, campusId) {
  if (!school.accessible) return { accessible: false, err: school.err || null };
  const evs = school.events;
  const now = shared.today;
  const byMonth = {};
  let maxCreated = null, maxUpdated = null, updated30 = 0, created30 = 0, gh = 0;
  const cut = cmpAddDays_(now, -30);
  evs.forEach(function (e) {
    cmpCount_(byMonth, cmpYM_(e.start));
    if (String(e.title || '').indexOf('GH') === 0) gh++;
    if (e.created) { if (!maxCreated || e.created > maxCreated) maxCreated = e.created; if (e.created >= cut) created30++; }
    if (e.updated) { if (!maxUpdated || e.updated > maxUpdated) maxUpdated = e.updated; if (e.updated >= cut) updated30++; }
  });
  const fmt = function (d) { return d ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd') : null; };
  return {
    accessible: true,
    sharedWithOtherCampus: (campusId === 'LMS2' || campusId === 'LMS3'), // one calendar serves both (principal-dr.gs)
    eventsByMonth: byMonth,
    ghHolidayEvents: gh,
    newestCreated: fmt(maxCreated),
    lastUpdated: fmt(maxUpdated),
    daysSinceLastUpdate: maxUpdated ? cmpDayDiff_(now, maxUpdated) : null,
    createdLast30d: created30,
    updatedLast30d: updated30,
  };
}

// ═══════════════════════════════════════════════════════════════════
// REGULARITY REPORT — Principal DR only (added 2026-10-05).
// Lightweight alternative to complianceReportAll(): reads ONLY the Daily
// Reports tab + each school Calendar (for GH holidays), covers every
// working day from CMP_REGULARITY_START up to YESTERDAY (today's report
// may not be filed yet), and logs one short line per campus.
//
// Per campus, one character per WORKING day, in date order:
//   P = filed by the campus Principal, last saved the same day
//   p = filed by the campus Principal, last saved on a LATER day
//       (Timestamp is the LAST save -- an upsert overwrites it -- so
//        this means "touched again later", not necessarily "filed late")
//   O = filed by someone else (Owner/coordinator/test), same day
//   o = filed by someone else, last saved later
//   - = no report on file
// Run: complianceReportRegularity()   Output tag: @@CR|REG-<campus>|..
// ═══════════════════════════════════════════════════════════════════

const CMP_REGULARITY_START = new Date(2026, 8, 1); // portal went live 2026-09-01/02

function complianceReportRegularity() {
  const start = CMP_REGULARITY_START;
  const today = cmpDayStart_(new Date());
  const shared = {
    monthStart: start, monthEnd: today, today: today,
    principals: cmpSafe_(cmpPrincipals_, {}),
    reports: cmpSafe_(cmpReadDailyReports_, []),
    schoolCal: {},
  };
  const startISO = pdrFormatISO_(start), endISO = pdrFormatISO_(today);

  cmpLogChunks_('REG-META', {
    from: startISO, toExclusive: endISO, rowsInSheet: shared.reports.length,
    generatedAt: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss"),
    legend: 'P/p principal same-day/later-saved; O/o other filer same-day/later-saved; - missing',
  });

  CMP_CAMPUSES.forEach(function (campusId) {
    let out;
    try {
      const principals = shared.principals[campusId] || [];
      const emails = principals.map(function (p) { return p.email; });
      const calEmail = PDR_PRINCIPAL_PERSONAL_CALENDARS[campusId];
      if (calEmail && emails.indexOf(calEmail) < 0) emails.push(calEmail);

      const school = cmpSchoolEvents_(campusId, shared);
      const gh = school.events
        .filter(function (e) { return String(e.title || '').indexOf('GH') === 0; })
        .map(function (e) { return { title: e.title, start: e.start, end: e.end }; });
      const wdr = cmpWorkingDays_(start, today, gh);

      const byDate = {};
      shared.reports.forEach(function (r) {
        if (r.campus !== campusId || r.dateISO < startISO || r.dateISO >= endISO) return;
        const prev = byDate[r.dateISO];
        if (!prev || (r.ts && (!prev.ts || r.ts > prev.ts))) byDate[r.dateISO] = r;
      });

      const mine = function (r) { return emails.indexOf(r.email) >= 0; };
      const code = wdr.wd.map(function (x) {
        const r = byDate[x.iso];
        if (!r) return '-';
        const later = r.ts ? cmpDayDiff_(r.ts, x.d) > 0 : false;
        return mine(r) ? (later ? 'p' : 'P') : (later ? 'o' : 'O');
      }).join('');

      const filers = {};
      Object.keys(byDate).forEach(function (iso) { cmpCount_(filers, byDate[iso].email || '(none)'); });
      const allDates = Object.keys(byDate).sort();
      out = {
        campus: campusId,
        principals: principals.map(function (p) { return p.name + ' <' + p.email + '>'; }),
        days: wdr.wd.map(function (x) { return x.iso.slice(5); }),            // 'MM-DD', aligned with code
        code: code,
        nonWorkingOrHoliday: wdr.non.filter(function (x) { return x.label !== 'Sunday'; }).map(function (x) { return x.iso.slice(5) + ' ' + x.label; }),
        filedOnNonWorking: wdr.non.filter(function (x) { return byDate[x.iso]; }).map(function (x) { return x.iso.slice(5) + ' ' + x.label + (mine(byDate[x.iso]) ? '' : ' (non-principal)'); }),
        emptyShells: wdr.wd.filter(function (x) { const r = byDate[x.iso]; return r && r.ma === null && r.tc === 0 && r.tft === 0 && r.reg === 0; }).map(function (x) { return x.iso.slice(5); }),
        first: allDates[0] || null,
        last: allDates[allDates.length - 1] || null,
        filers: filers,
        holidaysDetected: school.accessible, // false => GH holidays NOT excluded, working-day count may be overstated
      };
    } catch (e) { out = { campus: campusId, fatal: String(e && e.message || e) }; }
    cmpLogChunks_('REG-' + campusId, out);
  });
  Logger.log('@@CR|DONE|1/1|regularity');
}
