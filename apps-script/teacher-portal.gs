// ═══════════════════════════════════════════════════════════════════
// Teacher Portal — composite performance score (added 2026-09-19).
// One concern-specific file inside the single "LMCS Principal's Daily
// Reporting Backend" project -- see main.gs's header for the full
// project layout/naming convention (prefix: tp/TP). doGet dispatch
// lives in main.gs, which calls myRankScore_() for action=myrankscore.
//
// WHAT THIS IS: 50% Teacher SS average + 50% CW/HW logging Regularity,
// ranked within the caller's own campus only. Per Uday (2026-09-19):
// this is meant to eventually feed the real incentive engine's DR
// Average blend (see the "LMCS Software Platform" vault note's
// Incentive Algorithm section) -- specifically, it answers that note's
// own still-open 2026-07-06 decision, "exact CW/HW-vs-eval-score
// weighting in the DR Average blend," just settled later than planned.
// It is NOT wired to actual payroll -- that still runs off a separate
// Excel workbook outside this codebase -- so the Teacher Portal
// frontend deliberately labels this "draft, not yet your official
// incentive" rather than presenting it as settled pay.
//
// JOIN KEY: EmployeeCode, not name (explicit call from Uday, having
// watched this session repeatedly hit name-matching gaps). Neither
// source system carries a code natively -- the Teacher SS response
// sheet's Teacher Name is a Google Form dropdown selection (a typed
// string, not an ID), and the CW/HW daily log's Teacher field is the
// same. Both get resolved against the Employee Roster Proxy
// (employee-roster.gs's action=employees, backed by EmpMaster --
// the canonical name/code list) before anything is joined or ranked.
// A name that fails to resolve is EXCLUDED from ranking, not guessed
// at via fuzzy matching -- misattributing someone else's score would
// be a worse failure mode than an honest gap, especially once this
// feeds real pay. tpUnresolvedCount in myRankScore_'s response is a
// diagnostic (aggregate count only, never names) for spotting a
// systemic matching problem, not shown prominently in the frontend.
//
// VISIBILITY: myRankScore_ returns ONLY the caller's own score
// breakdown + rank position/count -- never another teacher's name or
// score. Matches the visibility-tier sequencing agreed for the
// Teacher Portal (team-level rank, not a full leaderboard).
// ═══════════════════════════════════════════════════════════════════

const TP_EMPLOYEE_ROSTER_URL = 'https://script.google.com/macros/s/AKfycbyHiaZY_iWK2VTKKFJcCsBNnIbUndJYUSjnPkxvJ-dYavaihiul2xBJuJohPRsP9Spf/exec';
// Same public, unauthenticated proxy the Teacher Portal frontend
// already calls client-side for "My CW/HW Patterns" -- called here
// server-side too (UrlFetchApp, same pattern ChapterTracker.gs already
// uses to call the Roster Proxy) so regularity can be computed for
// EVERY teacher at a campus without shipping their raw records to one
// teacher's browser (that's the actual privacy boundary -- the ranking
// math has to happen server-side even though the source data is public).
const TP_CWHW_PROXY_URL = 'https://script.google.com/macros/s/AKfycbyYk0uDnp-PHdUDdOh5-KfD2xK1ahYCQ_vt7SJigQMhSA3DSs5t5v_q4tnseoZKw3_L/exec';

// FIXED 2026-09-20: cwRecords carries NO `school` field at all --
// confirmed by fetching the live proxy directly (26,317 real records
// inspected). The ORIGINAL version of this function checked r.school,
// which is always undefined, so it silently rejected EVERY record for
// EVERY campus -- Regularity has been reading as 0% for everyone since
// My Score shipped, not a name-matching edge case. The real per-record
// campus field is `lmsIdx`, a 0-based numeric index (0=LMS1..5=LMS6)
// matching curriculum-progress/daily-progress.html's DAILY_SCHOOL_NAMES
// order -- confirmed against the live data (lmsIdx 0-5 all present,
// correct distribution across the 6 campuses).
const TP_LMS_IDX_TO_CAMPUS_ID = ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6'];
function tpRecordMatchesCampus_(record, campusId) {
  return TP_LMS_IDX_TO_CAMPUS_ID[record.lmsIdx] === campusId;
}

// Strips common honorific suffixes seen in this project's messier name
// sources (the timetable workload export alone had "Seema"/"SEEMA
// MAAM"/"SEEMA MAAM" all for one EmployeeCode) before comparing --
// still an EXACT match after normalizing, not fuzzy/edit-distance,
// per the JOIN KEY note above.
function tpNormalizeName_(name) {
  return String(name || '')
    .trim().toLowerCase()
    .replace(/\s+(maam|ma'am|mam|madam|sir)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const TP_ROSTER_CACHE_SECONDS = 300;
function tpRosterByCampus_(campusId) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'tp_roster_' + campusId;
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  let employees = [];
  try {
    const res = UrlFetchApp.fetch(TP_EMPLOYEE_ROSTER_URL + '?action=employees', { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      const data = JSON.parse(res.getContentText());
      if (data.success && Array.isArray(data.employees)) employees = data.employees;
    }
  } catch (err) { /* fails safe to empty roster below */ }

  const wantSchool = 'LMS ' + campusId.replace('LMS', '');
  const roster = employees
    .filter(function (e) { return e.school === wantSchool; })
    .map(function (e) { return { employeeCode: e.employeeCode, nameNorm: tpNormalizeName_(e.name) }; });

  cache.put(cacheKey, JSON.stringify(roster), TP_ROSTER_CACHE_SECONDS);
  return roster;
}

function tpResolveEmployeeCode_(rawName, roster) {
  const wanted = tpNormalizeName_(rawName);
  if (!wanted) return null;
  for (let i = 0; i < roster.length; i++) { if (roster[i].nameNorm === wanted) return roster[i].employeeCode; }
  return null;
}

// The SS response sheets' "Teacher Name" cell is NOT a plain name --
// confirmed 2026-09-20 against a live example (Vipin Thakur, LMS4,
// showed 0 on My Score despite a real 39/100 on the PDR SS Dashboard).
// Root cause: ss-forms-sync.gs's getActiveEmployeeChoices_ builds the
// Form's dropdown choices as `empRow.code + ' ' + empRow.name` --
// e.g. "NCM/24/04/073 VIPIN THAKUR" -- so that's literally what a
// Principal selects and what lands in the response sheet, every time.
// The code is the first token; extract it directly instead of trying
// to name-match the WHOLE "code + name" string against the roster's
// plain names, which can only ever fail. Falls back to
// tpResolveEmployeeCode_ (plain name-matching) for any row that
// doesn't fit the pattern -- older/legacy rows predating this
// convention, if any exist.
const TP_SS_NAME_CODE_RE = /^([A-Z]{3}\/\d{2}\/\d{2}\/\d+)\s+/;
function tpResolveTeacherFieldToCode_(rawTeacherField, roster) {
  const m = TP_SS_NAME_CODE_RE.exec(String(rawTeacherField || '').trim());
  if (m) return m[1];
  return tpResolveEmployeeCode_(rawTeacherField, roster);
}

// Resolving "who is the CALLER" (as opposed to resolving some other
// name string found in an SS/CW-HW row) doesn't have to rely on name
// matching at all -- EmpMaster has an AuthEmail column that
// employee-roster.gs deliberately never exposes through its public
// proxy (more sensitive than name/code/school), so this reads it
// directly. Matches the caller's VERIFIED Google sign-in email --
// exact, not normalized/fuzzy, since email has no casing-variant
// problem the way typed names do. Falls back to name-matching
// (tpResolveEmployeeCode_ against the caller's own name) only when a
// person's AuthEmail cell is empty -- an older row predating this
// column, most likely -- so someone isn't newly locked out by an
// upgrade meant to make things MORE reliable. `resolvedBy` in the
// return tells callers which path was actually used, for visibility
// into how many people are still on the weaker fallback.
const TP_EMP_SHEET_ID = '1OjVMUvpLM8JkdAwjmljCtZUI1VUqGLbic36cW9dm0C0'; // same Employee Master / "LMCSStaffMasters" workbook employee-roster.gs reads
const TP_AUTHEMAIL_CACHE_SECONDS = 300;
// CORRECTED 2026-09-20: the real, populated AuthEmail column lives on
// the EmpPersonal tab (confirmed by inspecting a live export --
// EmpMaster ALSO has a column literally named "AuthEmail", but every
// value in it is just a sequential row number, not an email -- reading
// from there would have silently fallen back to name-matching for
// EVERY caller, with no error to reveal it. EmpPersonal's AuthEmail
// was 170/174 rows (97.7%) real-looking addresses when checked.
// EmpPersonal is one of the PII tabs employee-roster.gs deliberately
// never exposes through its public proxy -- consistent with this
// staying a direct, authenticated read here, not a public one.
function tpAuthEmailToCode_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('tp_authemail_map');
  if (cached) return JSON.parse(cached);

  const map = {};
  try {
    const rows = SpreadsheetApp.openById(TP_EMP_SHEET_ID).getSheetByName('EmpPersonal').getDataRange().getValues();
    const header = rows[0];
    const emailCol = header.indexOf('AuthEmail');
    const codeCol = header.indexOf('EmployeeCode');
    if (emailCol >= 0 && codeCol >= 0) {
      for (let i = 1; i < rows.length; i++) {
        const email = String(rows[i][emailCol] || '').trim().toLowerCase();
        const code = String(rows[i][codeCol] || '').trim();
        if (email && email.indexOf('@') !== -1 && code) map[email] = code;
      }
    }
  } catch (err) { /* fails safe to empty map -> every caller falls back to name-matching */ }

  cache.put('tp_authemail_map', JSON.stringify(map), TP_AUTHEMAIL_CACHE_SECONDS);
  return map;
}

function tpResolveCallerEmployeeCode_(caller, roster) {
  // Owner Test Mode (main.gs's pdrResolveViewAsCaller_) already knows
  // the viewed person's code directly -- checked FIRST so it's used as
  // -is, not re-derived from caller.email (which stays OWNER's own
  // email on a view-as caller, deliberately, so nothing downstream
  // could mistake this for a real sign-in as the viewed person).
  if (caller.employeeCode) return { code: caller.employeeCode, resolvedBy: 'explicit' };
  const byEmail = tpAuthEmailToCode_();
  const emailMatch = byEmail[String(caller.email || '').trim().toLowerCase()];
  if (emailMatch) return { code: emailMatch, resolvedBy: 'email' };
  const nameMatch = tpResolveEmployeeCode_(caller.name, roster);
  if (nameMatch) return { code: nameMatch, resolvedBy: 'name' };
  return { code: null, resolvedBy: null };
}

// campusId's expected working days in the trailing `windowDays` --
// Sunday/2nd Saturday/GH-calendar-holiday all excluded.
//
// PERF (2026-09-20): the original version called pdrDayLabel_ once PER
// DAY (principal-dr.gs) -- fine for its actual use case (one date at a
// time, on a Principal viewing a single day's report), but calling it
// 30 times in a loop here meant up to ~25 individual CalendarApp reads
// on a cold cache (Sun/2nd-Sat skip the read, everything else doesn't)
// -- measured as the single biggest contributor to My Score feeling
// slow. This does ONE CalendarApp read for the whole window instead,
// then checks each day locally against that one batch of events. A
// GH event spanning multiple days (a week-long break, not just its
// start date) marks every day it covers, not just day one.
function tpExpectedWorkingDays_(campusId, windowDays) {
  const today = new Date();
  const rangeStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - windowDays + 1);
  const rangeEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const ghEvents = pdrSchoolCalendarEvents_(campusId, rangeStart, rangeEnd)
    .filter(function (ev) { return ev.getTitle().indexOf('GH') === 0; });

  const holidayDates = {};
  ghEvents.forEach(function (ev) {
    const evStart = new Date(ev.getStartTime().getFullYear(), ev.getStartTime().getMonth(), ev.getStartTime().getDate());
    const evEnd = ev.getEndTime(); // exclusive end, per Calendar's own all-day-event convention
    for (let d = new Date(evStart); d < evEnd; d.setDate(d.getDate() + 1)) {
      holidayDates[pdrFormatISO_(d)] = true;
    }
  });

  const days = [];
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    if (d.getDay() === 0) continue; // Sunday
    if (d.getDay() === 6 && Math.ceil(d.getDate() / 7) === 2) continue; // 2nd Saturday
    const iso = pdrFormatISO_(d);
    if (holidayDates[iso]) continue; // GH calendar holiday
    days.push(iso);
  }
  return days; // array of ISO date strings, working days only
}

// PERF (2026-09-20): TP_CWHW_PROXY_URL returns ~13MB (every campus's
// full daily log, rebuilt fresh on every request as far as this repo
// can tell) -- fetching it on every single myrankscore call was the
// single largest cost in the whole action, AND meant it was being
// fetched twice per page load (once here server-side, once again
// client-side for "My CW/HW Patterns"), plus once per Owner Test Mode
// switch. The RESULT of this function is tiny (one integer per
// employee) even though the INPUT is huge, so cache the result, not
// the raw payload -- CacheService's 100KB/key limit couldn't hold the
// raw 13MB response anyway. 30-min TTL: a teacher's Regularity number
// doesn't need to be fresher than that, and it matches this project's
// existing day-label cache granularity (see pdrDayLabel_).
const TP_REGULARITY_CACHE_SECONDS = 1800;
function tpCwHwLoggedDaysByCode_(campusId, workingDaysSet, roster) {
  const cache = CacheService.getScriptCache();
  // Keyed by the window's actual boundary dates, not just windowDays --
  // so the cache key naturally rolls over as "today" advances, instead
  // of serving a stale window under an unchanging key.
  const cacheKey = 'tp_regularity_' + campusId + '_' + (workingDaysSet[0] || '') + '_' + (workingDaysSet[workingDaysSet.length - 1] || '');
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const byCode = {};
  let data;
  try {
    const res = UrlFetchApp.fetch(TP_CWHW_PROXY_URL, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return byCode;
    data = JSON.parse(res.getContentText());
  } catch (err) { return byCode; }
  if (!data || !Array.isArray(data.cwRecords)) return byCode;

  const workingDays = {}; workingDaysSet.forEach(function (d) { workingDays[d] = true; });
  const loggedByCodeDay = {}; // employeeCode -> {dateISO: true}

  data.cwRecords.forEach(function (r) {
    if (!tpRecordMatchesCampus_(r, campusId)) return;
    const code = tpResolveEmployeeCode_(r.teacher, roster);
    if (!code) return;
    const dateISO = pdrFormatISO_(new Date(r.timeMs));
    if (!workingDays[dateISO]) return; // only expected working days count either direction
    if (!loggedByCodeDay[code]) loggedByCodeDay[code] = {};
    loggedByCodeDay[code][dateISO] = true;
  });

  Object.keys(loggedByCodeDay).forEach(function (code) {
    byCode[code] = Object.keys(loggedByCodeDay[code]).length;
  });
  return byCode;
}

const TP_RANK_SS_WEIGHT = 0.5;
const TP_RANK_REGULARITY_WEIGHT = 0.5;
const TP_RANK_REGULARITY_WINDOW_DAYS = 30;

// Numbers only, no ranking (2026-09-20, per Uday: "show the numbers
// first, move to ranks later" -- matches the growth-only visibility
// tier agreed at the start of the Teacher Portal plan, which the
// earlier peer-ranked version skipped past). Deliberately does NOT
// fetch/score every other teacher at the campus -- there's no reader
// left in this function, so re-add the scored/sorted array (see git
// history on this file around 2026-09-20 for the exact shape) when
// ranks actually come back, rather than keeping unused ranking code
// sitting here unverified in the meantime.
function myRankScore_(caller) {
  const roster = tpRosterByCampus_(caller.campusId);
  const myCode = tpResolveCallerEmployeeCode_(caller, roster).code;
  if (!myCode) {
    return { success: true, found: false, campusId: caller.campusId };
  }

  const ssStats = readCampusStats_(caller.campusId); // teacher-ss.gs, existing
  // tpResolveTeacherFieldToCode_, not the plain tpResolveEmployeeCode_
  // -- the SS sheet's "Teacher Name" cell is actually "EmployeeCode
  // Name" (see that function's comment), not a bare name.
  const myStats = ssStats.teachers.filter(function (t) { return tpResolveTeacherFieldToCode_(t.teacher, roster) === myCode; })[0];
  const ssScore = myStats ? myStats.avgTotal : 0;

  const workingDays = tpExpectedWorkingDays_(caller.campusId, TP_RANK_REGULARITY_WINDOW_DAYS);
  const loggedDaysByCode = tpCwHwLoggedDaysByCode_(caller.campusId, workingDays, roster);
  const expectedCount = workingDays.length || 1; // guard div-by-zero on a campus with e.g. every day off somehow
  const regularityPct = Math.min(100, ((loggedDaysByCode[myCode] || 0) / expectedCount) * 100);

  const total = TP_RANK_SS_WEIGHT * ssScore + TP_RANK_REGULARITY_WEIGHT * regularityPct;
  return {
    success: true, found: true, campusId: caller.campusId,
    ssScore: Math.round(ssScore * 10) / 10,
    regularityPct: Math.round(regularityPct * 10) / 10,
    total: Math.round(total * 10) / 10,
    windowDays: TP_RANK_REGULARITY_WINDOW_DAYS,
  };
}

// action=myemployeecode -- lets the Teacher Portal FRONTEND resolve its
// own EmployeeCode once, for features that read a public static/proxy
// data source directly in the browser (Your Timetable, My CW/HW
// Patterns) rather than through this backend. Those can't read
// AuthEmail themselves (employee-roster.gs's public proxy deliberately
// excludes it, more sensitive than name/code/school), so this is the
// one narrow, authenticated hole through which a caller learns ONLY
// their own code -- never anyone else's.
function myEmployeeCode_(caller) {
  const roster = tpRosterByCampus_(caller.campusId);
  const resolved = tpResolveCallerEmployeeCode_(caller, roster);
  // campusId/name included so the frontend (Timetable/CW-HW Patterns)
  // can use the EFFECTIVE identity's campus/name for matching -- under
  // Owner Test Mode that's the viewed teacher's, not Owner's own
  // (Owner's real campusId is 'ALL', which isn't a valid lookup key).
  return { success: true, found: !!resolved.code, employeeCode: resolved.code, resolvedBy: resolved.resolvedBy, campusId: caller.campusId, name: caller.name || '' };
}
