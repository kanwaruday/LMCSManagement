// ═══════════════════════════════════════════════════════════════════
// SS Tracker — the completion/compliance dashboard sitting on top of
// SS_ROLE_CONFIGS (ss-forms-sync.gs). Reads every ACTIVE role's
// response sheet (config.responseSheetId/responseTabs), cross-
// references against the live roster (the SAME matchesEmployee() each
// role's form-sync already uses, via employee-roster.gs's EmpMaster/
// EmpSalary), and produces: quota compliance, Principal Compliance
// escalation, per-employee score analysis + full drill-down history,
// and rubber-stamp (suspiciously-uniform-score) flags per evaluator.
// doGet action lives in main.gs. Never writes.
//
// Named "ss-tracker.gs" per main.gs's own header, which already
// earmarked this file name for "the SS completion/pending tracker".
//
// v1 SCOPE (2026-09-09, per Uday): flat 2 SS/employee/month quota,
// same for every role; Apr-Sep / Oct-Mar incentive cycles; NO
// attendance/leave cross-check yet (self-report vs reality is
// deferred); NO employee-facing view yet (may exclude Helpers/Drivers
// when built, since most likely have no Google account to sign in
// with). Gamification: nothing built here beyond the raw data itself
// -- streaks/completion-% are a query over `history`'s timestamps
// once this ships, no separate engine needed.
// ═══════════════════════════════════════════════════════════════════

// ── Incentive cycles ─────────────────────────────────────────────
// Cycle 1: Apr-Sep. Cycle 2: Oct-Mar (spans the calendar-year boundary,
// so Jan-Mar belongs to the cycle that STARTED the previous October).
function getCurrentCycleRange_(refDate) {
  const d = refDate || new Date();
  const y = d.getFullYear();
  const m = d.getMonth(); // 0-11
  if (m >= 3 && m <= 8) { // Apr(3)..Sep(8)
    return { start: new Date(y, 3, 1), end: new Date(y, 9, 1), label: 'Cycle 1 (Apr-Sep ' + y + ')' };
  }
  if (m >= 9) { // Oct(9)..Dec(11)
    return { start: new Date(y, 9, 1), end: new Date(y + 1, 3, 1), label: 'Cycle 2 (Oct ' + y + '-Mar ' + (y + 1) + ')' };
  }
  return { start: new Date(y - 1, 9, 1), end: new Date(y, 3, 1), label: 'Cycle 2 (Oct ' + (y - 1) + '-Mar ' + y + ')' }; // Jan-Mar
}

function getCurrentMonthRange_(refDate) {
  const d = refDate || new Date();
  return { start: new Date(d.getFullYear(), d.getMonth(), 1), end: new Date(d.getFullYear(), d.getMonth() + 1, 1) };
}

// ── Quota ─────────────────────────────────────────────────────────
// Flat 2/employee/month for every role today -- Uday's explicit call,
// "presently the same for all employees" (2026-09-09). Structured as a
// per-role override map (empty for now) falling back to the shared
// default, so a future role-specific quota doesn't need a rewrite of
// every caller.
const SS_QUOTA_DEFAULT_PER_MONTH = 2;
const SS_QUOTA_OVERRIDES_PER_MONTH = {}; // roleKey -> number, once role-specific quotas are needed
function getMonthlyQuota_(roleKey) {
  return SS_QUOTA_OVERRIDES_PER_MONTH[roleKey] || SS_QUOTA_DEFAULT_PER_MONTH;
}

// ── Rubber-stamp detection ──────────────────────────────────────────
// Every SS form captures "Email Address" (Forms' verified-email column
// -- confirmed live 2026-09-09 these forms DO collect it, which also
// explains the earlier "asking for login again" iframe complaint: that
// setting forces sign-in). That gives real per-evaluator identity, so
// this can flag a specific evaluator, not just a whole campus.
// Threshold is a judgment call, not statistically derived -- revisit
// once there's enough real data to see what normal variance looks
// like. Needs >=3 submissions from an evaluator before judging (1-2
// data points can't show a pattern).
const SS_RUBBER_STAMP_MIN_SUBMISSIONS = 3;
const SS_RUBBER_STAMP_MAX_STDDEV = 3; // out of a 100-point rubric total

/** {evaluatorEmail, submissionCount, meanScore, stddev} for every
 *  evaluator whose given scores are suspiciously uniform. Rows with no
 *  captured email (shouldn't happen given the forms collect it, but
 *  fail open rather than crash) are skipped -- can't attribute those. */
function ssRubberStampFlags_(submissions) {
  const byEvaluator = {};
  submissions.forEach(function (s) {
    if (!s.evaluatorEmail) return;
    if (!byEvaluator[s.evaluatorEmail]) byEvaluator[s.evaluatorEmail] = [];
    byEvaluator[s.evaluatorEmail].push(s.total);
  });
  const flags = [];
  Object.keys(byEvaluator).forEach(function (email) {
    const totals = byEvaluator[email];
    if (totals.length < SS_RUBBER_STAMP_MIN_SUBMISSIONS) return;
    const mean = totals.reduce(function (a, b) { return a + b; }, 0) / totals.length;
    const variance = totals.reduce(function (a, t) { return a + Math.pow(t - mean, 2); }, 0) / totals.length;
    const stddev = Math.sqrt(variance);
    if (stddev <= SS_RUBBER_STAMP_MAX_STDDEV) {
      flags.push({
        evaluatorEmail: email,
        submissionCount: totals.length,
        meanScore: Math.round(mean * 10) / 10,
        stddev: Math.round(stddev * 10) / 10,
      });
    }
  });
  return flags;
}

// ── Response reading ─────────────────────────────────────────────
/** Raw submissions for one role's one form (a campus tab if perCampus,
 *  else the single shared tab under key 'all') -- NOT pre-aggregated,
 *  so callers can filter by date range or drill into individual rows.
 *  Column lookup reuses the SAME rubricTitles/nameFieldTitle from
 *  SS_ROLE_CONFIGS the form-sync engine already trusts -- one source of
 *  truth for "what does this role's data look like." */
// Memoized per spreadsheet ID for the life of ONE execution -- same
// fix as ss-forms-sync.gs's getDepartmentByCode_/getEmpMasterRows_.
// Teacher/IT/PTI/Clerk all share ONE response spreadsheet, so without
// this, opening it fresh per tab (6x just for Teacher's 6 campuses)
// was pure waste on top of the EmpMaster/EmpSalary N+1 fix.
var _ssSpreadsheetCache_ = {};
function ssOpenSpreadsheet_(sheetId) {
  if (!_ssSpreadsheetCache_[sheetId]) _ssSpreadsheetCache_[sheetId] = SpreadsheetApp.openById(sheetId);
  return _ssSpreadsheetCache_[sheetId];
}

function ssReadSubmissions_(config, formKey) {
  const tabName = config.responseTabs[formKey];
  const sheet = tabName ? ssOpenSpreadsheet_(config.responseSheetId).getSheetByName(tabName) : null;
  if (!sheet) return [];

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const header = values[0];
  const tsCol = header.indexOf('Timestamp');
  const emailCol = header.indexOf('Email Address');
  const nameCol = header.indexOf(config.nameFieldTitle(formKey));
  const rubricCols = config.rubricTitles.map(function (t) { return header.indexOf(t); });

  const out = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const employeeName = nameCol >= 0 ? normalizeCell_(row[nameCol]) : '';
    if (!employeeName) continue;
    const ts = row[tsCol];
    const scores = rubricCols.map(function (col) { return col >= 0 ? Number(row[col]) || 0 : 0; });
    const total = scores.reduce(function (a, b) { return a + b; }, 0);
    out.push({
      employeeName: employeeName,
      evaluatorEmail: emailCol >= 0 ? normalizeCell_(row[emailCol]).toLowerCase() : '',
      timestamp: ts instanceof Date ? ts : (ts ? new Date(ts) : null),
      scores: scores,
      total: total,
    });
  }
  return out;
}

/** Every submission for one role across every form it has (all 6
 *  campuses for perCampus roles, or the single shared tab otherwise). */
function ssReadAllSubmissions_(roleKey) {
  const config = SS_ROLE_CONFIGS[roleKey];
  const out = [];
  Object.keys(config.responseTabs).forEach(function (formKey) {
    ssReadSubmissions_(config, formKey).forEach(function (s) { out.push(s); });
  });
  return out;
}

// "CODE Name" -> "LMS N" (the short-form school label), derived from
// the EmployeeCode prefix via ss-forms-sync.gs's own SS_PREFIX_TO_SCHOOL
// map. Needed because itComputer/pti/feeClerkPRO's roster isn't split
// by campus at the FORM level (one shared form for all 6 schools), but
// the Dashboard still needs each employee's REAL campus to scope counts
// and compliance per school -- added 2026-09-09 per Uday: "only show
// the employees from that school in the counter". Every role gets this
// field now, not just those 3 -- for perCampus roles it just confirms
// what formKey already said.
function ssSchoolFromEmployeeString_(employeeStr) {
  const code = employeeStr.split(' ')[0];
  const prefix = code.split('/')[0];
  return SS_PREFIX_TO_SCHOOL[prefix] || null;
}

// ── Roster + submissions, combined ──────────────────────────────────
/** One role's full picture. `campusFilter` ('LMS 1' style, or null for
 *  everyone) scopes EVERY role to one real campus (via each employee's
 *  actual school, not the form's own structure) -- same Owner-sees-all/
 *  Principal-sees-own-campus rule teacherSsStats_ already enforces.
 *  itComputer/pti/feeClerkPRO read from one shared form (formKey
 *  'all') but are still scoped per real campus here, same as everyone
 *  else -- only READING the response data is form-structure-dependent,
 *  scoping who's included never was meant to be.
 *
 *  Every employee CURRENTLY matching this role (from the live roster,
 *  via the exact matchesEmployee() the form-sync engine already uses)
 *  is included even with zero submissions -- so a never-evaluated
 *  employee is visible, not silently absent (same principle as Teacher
 *  SS's existing Dashboard). */
function ssRoleDashboard_(roleKey, campusFilter) {
  const config = SS_ROLE_CONFIGS[roleKey];
  const monthRange = getCurrentMonthRange_();
  const cycleRange = getCurrentCycleRange_();
  const quota = getMonthlyQuota_(roleKey);

  const submissions = ssReadAllSubmissions_(roleKey);
  const byEmployee = {}; // employeeName -> submission[]
  submissions.forEach(function (s) {
    if (!byEmployee[s.employeeName]) byEmployee[s.employeeName] = [];
    byEmployee[s.employeeName].push(s);
  });

  const roster = [];
  Object.keys(config.forms).forEach(function (formKey) {
    getActiveEmployeeChoices_(config, formKey).forEach(function (name) {
      const school = ssSchoolFromEmployeeString_(name);
      if (campusFilter && school !== campusFilter) return; // real-campus scoping, every role

      const subs = (byEmployee[name] || []).slice().sort(function (a, b) {
        return (b.timestamp ? b.timestamp.getTime() : 0) - (a.timestamp ? a.timestamp.getTime() : 0);
      });
      const thisMonth = subs.filter(function (s) { return s.timestamp && s.timestamp >= monthRange.start && s.timestamp < monthRange.end; });
      const thisCycle = subs.filter(function (s) { return s.timestamp && s.timestamp >= cycleRange.start && s.timestamp < cycleRange.end; });
      const avgTotal = subs.length
        ? Math.round((subs.reduce(function (sum, s) { return sum + s.total; }, 0) / subs.length) * 10) / 10
        : null;
      const avgPerParam = config.rubricTitles.map(function (_, idx) {
        if (!subs.length) return null;
        const sum = subs.reduce(function (a, s) { return a + (s.scores[idx] || 0); }, 0);
        return Math.round((sum / subs.length) * 10) / 10;
      });

      roster.push({
        formKey: formKey, // which physical form/tab this data was read from -- structural, not who-owns-it
        school: school,   // the employee's real campus -- what scoping/grouping should use
        employee: name,
        submissionsThisMonth: thisMonth.length,
        submissionsThisCycle: thisCycle.length,
        quotaMetThisMonth: thisMonth.length >= quota,
        lastSubmission: subs.length && subs[0].timestamp ? subs[0].timestamp.toISOString() : null,
        avgTotal: avgTotal,
        avgPerParam: avgPerParam,
        // Full drill-down: every individual SS, newest first.
        history: subs.map(function (s) {
          return {
            timestamp: s.timestamp ? s.timestamp.toISOString() : null,
            total: s.total,
            scores: s.scores,
            evaluatorEmail: s.evaluatorEmail,
          };
        }),
      });
    });
  });

  // Per-campus quota-compliance rollup, grouped by each employee's REAL
  // school (not formKey -- see the note above) -- the data behind
  // Principal Compliance escalation. Seeded from every real campus in
  // scope (not just derived from `roster`) so a campus with genuinely
  // zero staff in this role (e.g. Driver Cum Peon at LMS 5) still shows
  // up as "0 employees" instead of silently vanishing -- found
  // 2026-09-09 via the first real test run.
  const byCampus = {};
  Object.values(SS_PREFIX_TO_SCHOOL).forEach(function (school) {
    if (campusFilter && school !== campusFilter) return;
    byCampus[school] = { total: 0, metQuota: 0 };
  });
  roster.forEach(function (r) {
    if (!r.school) return; // shouldn't happen -- unknown EmployeeCode prefix, fail open rather than crash
    byCampus[r.school].total++;
    if (r.quotaMetThisMonth) byCampus[r.school].metQuota++;
  });
  const campusCompliance = Object.keys(byCampus).map(function (school) {
    const c = byCampus[school];
    return {
      formKey: school, // named formKey for the frontend's sake -- always a real "LMS N" school now, every role
      totalEmployees: c.total,
      metQuota: c.metQuota,
      compliancePct: c.total ? Math.round((c.metQuota / c.total) * 1000) / 10 : 100,
    };
  });

  return {
    role: roleKey,
    label: config.label,
    perCampus: config.perCampus,
    rubricTitles: config.rubricTitles,
    rubricMax: config.rubricMax,
    quotaPerMonth: quota,
    // NOT toISOString().slice(0,7) -- that converts to UTC first, which
    // (in a timezone ahead of UTC, e.g. IST) shifts local month-start
    // back into the previous UTC day/month, showing "2026-08" for
    // September. This formats from the LOCAL y/m directly instead.
    // Found 2026-09-09 via the first real test run.
    monthLabel: monthRange.start.getFullYear() + '-' + String(monthRange.start.getMonth() + 1).padStart(2, '0'),
    cycleLabel: cycleRange.label,
    roster: roster,
    campusCompliance: campusCompliance,
    evaluatorFlags: ssRubberStampFlags_(submissions),
  };
}

/** Called from main.gs's doGet for action=ssdashboard. Every ACTIVE
 *  role's full dashboard data in one response -- same "fetch once,
 *  re-render per selected campus/role" pattern the existing Dashboard
 *  tab already uses for Teacher SS, generalized to all 6 roles.
 *  Non-ALL callers are scoped to their own campus, same rule as
 *  teacherSsStats_. */
function ssDashboardAll_(caller) {
  const campusFilter = caller.campusId === 'ALL' ? null : caller.campusId.replace('LMS', 'LMS ');
  const roles = {};
  ACTIVE_SS_ROLES.forEach(function (roleKey) {
    roles[roleKey] = ssRoleDashboard_(roleKey, campusFilter);
  });
  return { success: true, roles: roles };
}
