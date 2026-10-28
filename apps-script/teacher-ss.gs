// ═══════════════════════════════════════════════════════════════════
// Teacher SS — dashboard stats for the "Teacher SS" (Support Session
// teacher-evaluation rubric) part of the Principal's Daily Reporting
// hub. One concern-specific file inside the single "LMCS Principal's
// Daily Reporting Backend" project -- see main.gs's header for the
// full project layout and naming convention. doGet lives in main.gs,
// which calls teacherSsStats_() below for action=teacherstats.
//
// Reads "LMCS Teacher SS 2026 (Responses)" -- the 6 campus Google Forms'
// old response tabs (now read-only history, replaced as of 2026-10-28 by
// a native in-game form; see ss-forms-sync.gs's own header for the full
// migration) AND (also 2026-10-28) the unified "SS Submissions" tab's
// 'teacher' rows via ssReadNewSubmissions_, so a Teacher SS entered
// through the new form still reaches this file's two readers: the
// Teacher Portal's own Evaluations view and Rank score. Never writes.
//
// TERMINOLOGY (2026-09-02): "DR" (Daily Report) for teachers was
// renamed to "SS" (Support Session) -- this file, the 6 Forms, and the
// response sheet's Drive file title all now say SS. The sheet's
// internal TAB names below (TSS_CAMPUS_TO_TAB) used to still say
// "Teacher DR" because Google Forms doesn't rename an already-linked
// destination tab when you rename the form -- but the tabs themselves
// HAVE since been renamed to "LMS N Teacher SS" (confirmed live via a
// tab inspection 2026-09-09), which means this file was silently
// returning empty stats for a while (getSheetByName() found nothing
// under the old "Teacher DR" names). Fixed below -- if this breaks
// again, re-inspect the live tab names before assuming the fix itself
// is wrong.
// ═══════════════════════════════════════════════════════════════════

const TSS_RESPONSES_SHEET_ID = '1cP-f8ShSJJPMBXkQCfkSvmajPA1db6fMBOPCbLH3oIc'; // "LMCS Teacher SS 2026 (Responses)"

// campusId (as used by the portal, e.g. 'LMS1') -> the exact tab name
// in the responses sheet. Confirmed live 2026-09-09 -- see TERMINOLOGY above.
const TSS_CAMPUS_TO_TAB = {
  LMS1: 'LMS 1 Teacher SS', LMS2: 'LMS 2 Teacher SS', LMS3: 'LMS 3 Teacher SS',
  LMS4: 'LMS 4 Teacher SS', LMS5: 'LMS 5 Teacher SS', LMS6: 'LMS 6 Teacher SS',
};

// Same 10 rubric columns every tab has, in sheet order — must match
// THE OLD TAB'S real headers exactly (independently hardcoded here, not
// read from SS_ROLE_CONFIGS.teacher -- this happens to be identical to
// its legacyRubricTitles, since both exist to describe this same frozen
// sheet; it's deliberately NOT ss-forms-sync.gs's live rubricTitles,
// which can change later without this needing to).
const TSS_RUBRIC_COLUMNS = [
  'Pedagogy', 'Teacher Content', 'Student Response', 'Activity Based Approach',
  'Notebook Checking of Students', 'BUTCHER Scheme',
  'Discipline- English, Aerobics, Morning Assembly & Dispersal',
  'Extra Curricular (Non Academic Competitions)', 'Attitude Towards School',
  'Dedication Towards Class',
];

/** Teacher Portal (2026-09-19), action=myssstats -- self-scoped to the
 *  caller's OWN submissions, never the campus roster teacherSsStats_
 *  below returns. Teacher-only callers can never reach teacherstats
 *  (see main.gs's PDR_TEACHER_GET_ACTIONS/pdrIsTeacherOnly_), so this is
 *  the only SS view available to them -- reuses readCampusStats_
 *  verbatim (same data, same computation) rather than a second reader.
 *
 *  Matches by EmployeeCode (updated 2026-09-20, per Uday), not name --
 *  the caller resolves via tpResolveCallerEmployeeCode_ (AuthEmail
 *  first, name-fallback only if that's unpopulated; see
 *  teacher-portal.gs, same project/shared scope). Each SS sheet row's
 *  "Teacher Name" cell is then resolved via tpResolveTeacherFieldToCode_
 *  -- turns out that cell isn't a plain name at all: the Form's
 *  dropdown (ss-forms-sync.gs's getActiveEmployeeChoices_) builds its
 *  choices as "EmployeeCode Name", so the code is already sitting
 *  right there as the first token of every response, extracted
 *  directly rather than re-derived via name-matching (confirmed after
 *  a live example -- Vipin Thakur, LMS4 -- showed 0 here despite a
 *  real score on the PDR SS Dashboard, which already parsed this
 *  correctly). `found: false` is returned explicitly rather than silently
 *  rendering "0 submissions" as if that were real data -- a resolution
 *  gap and genuinely zero submissions must look different to the
 *  teacher looking at their own screen. */
function myTeacherSsStats_(caller) {
  const roster = tpRosterByCampus_(caller.campusId);
  const myCode = tpResolveCallerEmployeeCode_(caller, roster).code;
  const stats = readCampusStats_(caller.campusId);
  const mine = myCode ? stats.teachers.filter(function (t) { return tpResolveTeacherFieldToCode_(t.teacher, roster) === myCode; })[0] : null;
  if (!mine) {
    return { success: true, found: false, rubricParams: TSS_RUBRIC_COLUMNS, campusId: caller.campusId, name: caller.name || '' };
  }
  return { success: true, found: true, rubricParams: TSS_RUBRIC_COLUMNS, campusId: caller.campusId, stats: mine };
}

/** Called from main.gs's doGet for action=teacherstats. Caller's own
 *  campus only, unless Owner (sees all 6). */
function teacherSsStats_(caller) {
  const campuses = caller.campusId === 'ALL' ? Object.keys(TSS_CAMPUS_TO_TAB) : [caller.campusId];
  const byCampus = {};
  campuses.forEach(function (campusId) {
    byCampus[campusId] = readCampusStats_(campusId);
  });
  return { success: true, rubricParams: TSS_RUBRIC_COLUMNS, campuses: byCampus };
}

// Cached 2026-09-20 (Teacher Portal perf): a single Home-tab page load
// now calls readCampusStats_ up to twice on its own (myssstats +
// myrankscore both need it), on top of whatever teacherstats/
// ssdashboard calls the SAME minute from Principal-side pages -- each
// call was a full re-read of the response sheet's getDataRange().
// Short TTL (2 min) since this is live evaluation data a Principal
// might submit at any moment, unlike the roster/day-label caches
// elsewhere in this project that can safely run longer.
const TSS_STATS_CACHE_SECONDS = 120;
function readCampusStats_(campusId) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'tss_stats_' + campusId;
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);
  const result = readCampusStatsUncached_(campusId);
  cache.put(cacheKey, JSON.stringify(result), TSS_STATS_CACHE_SECONDS);
  return result;
}

// 2026-10-28: folds in the unified "SS Submissions" tab's 'teacher' rows
// (apps-script/ss-forms-sync.gs) alongside the old per-campus Form tab,
// so a Teacher SS entered through the new native form still reaches the
// Teacher Portal's own Evaluations view (myssstats) and Rank score
// (myrankscore via teacher-portal.gs), not just the Principal-facing SS
// Dashboard (ss-tracker.gs already merged there). Found missing by code
// review, 2026-10-28 -- this function reads a DIFFERENT sheet/shape than
// ss-tracker.gs's own merge, so that merge alone didn't cover it.
function readCampusStatsUncached_(campusId) {
  const tabName = TSS_CAMPUS_TO_TAB[campusId];
  const sheet = SpreadsheetApp.openById(TSS_RESPONSES_SHEET_ID).getSheetByName(tabName);
  const values = sheet ? sheet.getDataRange().getValues() : [[]];
  const header = values[0] || [];
  const teacherNameCol = header.indexOf(campusId.replace('LMS', 'LMS ') + ' Teacher Name');
  const timestampCol = header.indexOf('Timestamp');
  const rubricCols = TSS_RUBRIC_COLUMNS.map(function (title) { return header.indexOf(title); });

  const byTeacher = {}; // teacherName -> {count, sumTotal, sumPerParam[10], lastDate}
  const addRow = function (teacher, scores, ts) {
    if (!teacher) return;
    if (!byTeacher[teacher]) {
      byTeacher[teacher] = { count: 0, sumTotal: 0, sumPerParam: TSS_RUBRIC_COLUMNS.map(function () { return 0; }), lastDate: null };
    }
    const entry = byTeacher[teacher];
    entry.count++;
    let rowTotal = 0;
    scores.forEach(function (v, idx) { rowTotal += v; entry.sumPerParam[idx] += v; });
    entry.sumTotal += rowTotal;
    if (ts && (!entry.lastDate || new Date(ts) > new Date(entry.lastDate))) {
      entry.lastDate = ts instanceof Date ? ts.toISOString() : String(ts);
    }
  };

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const teacher = String(row[teacherNameCol] || '').trim();
    if (!teacher) continue;
    addRow(teacher, rubricCols.map(function (col) { return col >= 0 ? Number(row[col]) || 0 : 0; }), row[timestampCol]);
  }
  if (typeof ssReadNewSubmissions_ === 'function') { // same project/scope as ss-forms-sync.gs/ss-tracker.gs; guarded only so this file alone still loads in a narrower test harness
    ssReadNewSubmissions_('teacher').forEach(function (s) {
      if (s.campusId !== campusId) return;
      addRow(s.employeeName, s.scores, s.timestamp);
    });
  }

  const teachers = Object.keys(byTeacher).map(function (name) {
    const e = byTeacher[name];
    return {
      teacher: name,
      submissionCount: e.count,
      avgTotal: e.count ? Math.round((e.sumTotal / e.count) * 10) / 10 : 0, // out of 100
      avgPerParam: e.sumPerParam.map(function (sum) { return e.count ? Math.round((sum / e.count) * 10) / 10 : 0; }),
      lastSubmission: e.lastDate,
    };
  });
  teachers.sort(function (a, b) { return a.teacher.localeCompare(b.teacher); });

  // Sum of counted rows (old tab + new unified tab), not values.length-1
  // -- that only ever counted the old tab, and even then included any
  // row with a blank Name cell that addRow() above actually skips.
  const responseCount = teachers.reduce(function (sum, t) { return sum + t.submissionCount; }, 0);
  return { teachers: teachers, responseCount: responseCount };
}
