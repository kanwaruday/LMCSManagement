var GAME_MODULE_ACTIONS = GAME_MODULE_ACTIONS || {};
var GAME_MODULE_MISSIONS = GAME_MODULE_MISSIONS || {};
var GAME_MODULE_QUESTS = GAME_MODULE_QUESTS || {};
var GAME_CALLER_FALLBACKS = GAME_CALLER_FALLBACKS || {};

// ═══════════════════════════════════════════════════════════════════
// LMCS Game Backend -- the Teacher module. This part: the Teacher INDEX, plus the employee sign-in fallback.
// Spec/plan: docs/superpowers/plans/2026-10-25-teacher-game-chapter-quest.md (Task 3).
//
// Every 30 minutes gameTeacherRefresh() reads the public CW/HW feed (~15 MB), the staff roster, the Chapter Tracker and
// the timetable once and writes one small TeacherState per teacher into CacheService (tch_<code>, 6 h), plus tch_meta.
// Later parts of this module (missions, quests) read those states, so a teacher's request never fetches the feed.
// Names in the feed are matched to employee codes with the Teacher Portal's exact rule (copy below), inside one campus;
// a name that does not match (or matches two people) is listed in tch_meta.unmatched, never guessed.
// Pure functions (tch*_ taking data in, data out) hold the logic; only gameTeacherRefresh / tchStateFor_ / the
// fallback touch Apps Script services. Source data is only ever READ.
//
// SETUP: add a time-driven trigger, gameTeacherRefresh, every 30 minutes (or run it once from the editor).
// ponytail: TeacherState keeps the last TCH_LOGGED_DAYS days of logged entries, not the whole year (one CacheService
//   value is 100 KB). A longer view means a second key per teacher.
// ═══════════════════════════════════════════════════════════════════

// Sources. Keep in sync: TP_CWHW_PROXY_URL / TP_EMPLOYEE_ROSTER_URL in teacher-portal.gs, CHAPTER_TRACKER_SHEET_ID in ChapterTracker.gs,
// TP_EMP_SHEET_ID in teacher-portal.gs.
var TCH_FEED_URL = 'https://script.google.com/macros/s/AKfycbyYk0uDnp-PHdUDdOh5-KfD2xK1ahYCQ_vt7SJigQMhSA3DSs5t5v_q4tnseoZKw3_L/exec';
var TCH_ROSTER_URL = 'https://script.google.com/macros/s/AKfycbyHiaZY_iWK2VTKKFJcCsBNnIbUndJYUSjnPkxvJ-dYavaihiul2xBJuJohPRsP9Spf/exec';
var TCH_TIMETABLE_URL = 'https://kanwaruday.github.io/LMCSManagement/teacher/data/timetable.json';
var TCH_TRACKER_SHEET_ID = '11u0Aeonc_CdwDa7ysXrdsF6vs2xYKxckQjOnc7ZEuCM';
var TCH_EMP_SHEET_ID = '1OjVMUvpLM8JkdAwjmljCtZUI1VUqGLbic36cW9dm0C0';

var TCH_DAY_MS = 86400000;
var TCH_IST_OFFSET_MS = 330 * 60000;
var TCH_STATE_TTL_S = 21600;      // 6 h
var TCH_LOCK_MS = 60000;
var TCH_FRESH_MS = 60000;         // a refresh that finds the index younger than this does nothing (a miss storm builds once)
var TCH_LOGGED_DAYS = 60;         // logged days kept per teacher
var TCH_NEXT_PER_CLASS = 3;       // upcoming chapters kept per class-subject
var TCH_NEXT_GRACE_DAYS = 14;     // a chapter whose planned start is further back than this and never started is skipped, not "next"
var TCH_MIN_KEEP_RATIO = 0.8;     // a feed under this share of the last build's records is treated as broken
var TCH_MAX_VALUE_BYTES = 95000;  // CacheService caps one value at 100 KB
var TCH_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── names ────────────────────────────────────────────────────────────
// Keep in sync with tpNormalizeName_ in teacher-portal.gs: strips honorific suffixes, collapses spaces, lower-cases. Exact match after that.
function tchNormalizeName_(name) {
  return String(name || '')
    .trim().toLowerCase()
    .replace(/\s+(maam|ma'am|mam|madam|sir)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tchHas_(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
function tchCampusIdx_(school) { const m = /^LMS\s*(\d)$/i.exec(String(school || '').trim()); return m ? Number(m[1]) - 1 : -1; }

// employees [{employeeCode, name, school:'LMS 4'}] -> { lmsIdx: { nameNorm: code } }; a name two people share maps to '' (ambiguous)
function tchRosterByCampus_(employees) {
  const out = {};
  (employees || []).forEach(function (e) {
    const idx = tchCampusIdx_(e.school), nm = tchNormalizeName_(e.name), code = String(e.employeeCode || '').trim();
    if (idx < 0 || !nm || !code) return;
    const m = out[idx] = out[idx] || {};
    m[nm] = (tchHas_(m, nm) && m[nm] !== code) ? '' : code;
  });
  return out;
}

function tchResolve_(name, rosterByCampus, lmsIdx) {
  const nm = tchNormalizeName_(name), m = rosterByCampus && rosterByCampus[lmsIdx];
  if (!nm || !m || !tchHas_(m, nm)) return null;
  return m[nm] || null;
}

// ── labels: the timetable and Course Map spell classes and subjects differently from the feed ──────────────
// Subjects exactly as the feed spells them (classMapped / subject). Only these are CW/HW subjects: Games, Library, Lunch Break,
// Peer Teaching and the like have no CW/HW and map to null.
var TCH_SUBJECTS = ['Math', 'Hindi', 'English', 'Computer', 'General Awareness', 'Social Science', 'Science', 'E.V.S.', 'Art & Craft',
  'Sanskrit', 'GK', 'Biology', 'Civics', 'History', 'Chemistry', 'History & Civics', 'Accountancy', 'Business Study', 'Physics',
  'Economics', 'Political Science', 'Cognitive Activities', 'Geography', 'Book of Rhymes & Stories', 'Information Technology',
  'My Book of Phonics', 'Activity Book'];
// spellings seen in timetable.json, the Course Map and EmpAcademic -> the feed's subject
var TCH_SUBJECT_ALIASES = { 'Maths': 'Math', 'Englsih': 'English', 'Eng': 'English', 'Art and Craft': 'Art & Craft', 'Business Studies': 'Business Study',
  'Accounts': 'Accountancy', 'Phonics': 'My Book of Phonics', 'Rhymes': 'Book of Rhymes & Stories', 'General Knowledge': 'GK',
  'IT': 'Information Technology', 'Cognitive Activity': 'Cognitive Activities' };

function tchRawKey_(s) { return String(s || '').replace(/\([^)]*\)/g, ' ').toLowerCase().replace(/[^a-z0-9]/g, ''); }
var TCH_SUBJECT_BY_KEY = (function () {
  const m = Object.create(null);
  TCH_SUBJECTS.forEach(function (s) { m[tchRawKey_(s)] = s; });
  Object.keys(TCH_SUBJECT_ALIASES).forEach(function (a) { m[tchRawKey_(a)] = TCH_SUBJECT_ALIASES[a]; });
  return m;
})();

// A timetable period says "Science" or "E.V.S." where teachers log the finer subject (Class 9 Physics, Chemistry, Biology; Class 4 Science and
// Social Science): the period then snaps to the finer subject the campus logs, preferring the one this teacher logs most (tchSnap_).
// ponytail: most-logged subject wins; a teacher with two finer subjects in one umbrella period gets the busier one.
var TCH_UMBRELLA = {
  'Science': ['Physics', 'Chemistry', 'Biology'],
  'Social Science': ['History', 'Civics', 'Geography', 'History & Civics', 'Political Science', 'Economics'],
  'E.V.S.': ['Science', 'Social Science'],
  'Biology': ['Science'], 'Physics': ['Science'], 'Chemistry': ['Science'],
  'History': ['Social Science'], 'Civics': ['Social Science'], 'Geography': ['Social Science'],
};

// the feed's subject for a spelling, or null
function tchSubjectName_(s) { return TCH_SUBJECT_BY_KEY[tchRawKey_(s)] || null; }
// a join key that agrees across spellings ('Maths', 'MATH', 'Math' -> 'math'); unknown subjects keep their own key
function tchSubjKey_(s) { const c = tchSubjectName_(s); return tchRawKey_(c || s); }

// "Class 11 (Medical)" -> "Class 11" (the stream is not part of the class), "m-i" -> "M-I"; anything else -> null
function tchClassName_(c) {
  c = String(c || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  let m = /^class\s*(\d{1,2})$/i.exec(c);
  if (m) return 'Class ' + Number(m[1]);
  m = /^m-?\s*(i{1,3})$/i.exec(c);
  return m ? 'M-' + m[1].toUpperCase() : null;
}

// (class, subject) as the timetable / EmpAcademic write them -> {cls, subj} in the feed's spelling, or null if it is not a CW/HW class-subject
function tchLabel_(cls, subj) {
  const c = tchClassName_(cls), s = tchSubjectName_(subj);
  return c && s ? { cls: c, subj: s } : null;
}

// chapter join key: letters/marks/digits of any script (Task 2's normaliser) with the spaces removed too, so
// "The Lost-Child" and "The Lost Child" and "TheLostChild" agree
function tchChKey_(s) { return ownAcadNormChapter_(s).replace(/ /g, ''); }

// lab = {cls, subj} from tchLabel_. As logged by the campus -> unchanged; else the umbrella's finer subject this teacher logs most in
// that class, else one the campus logs, else unchanged.
function tchSnap_(lab, lmsIdx, myPairs, campusPairs) {
  if (campusPairs[lmsIdx + '|' + lab.cls + '|' + tchSubjKey_(lab.subj)]) return lab;
  const alts = tchHas_(TCH_UMBRELLA, lab.subj) ? TCH_UMBRELLA[lab.subj] : [];
  let best = null, bestN = 0, anyCampus = null;
  alts.forEach(function (a) {
    const k = lab.cls + '|' + tchSubjKey_(a), n = myPairs[k] || 0;
    if (n > bestN) { best = a; bestN = n; }
    if (!anyCampus && campusPairs[lmsIdx + '|' + k]) anyCampus = a;
  });
  const subj = best || anyCampus;
  return subj ? { cls: lab.cls, subj: subj } : lab;
}

// ── Chapter Tracker sheets -> [{lmsIdx, cls, subj, ch, cwaAt}] ────────────────────────────────────────────
function tchDateMs_(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? null : v.getTime();
  const t = Date.parse(String(v));
  return isNaN(t) ? null : t;
}

// trackerValues = the AY tab (header first, columns by name); overrideValues = the "Overrides" tab ("Mark as taken");
// ayLabel filters the overrides like chapterReadOverrides_. Only rows with an Actual CWA Date are kept.
function tchTrackerRows_(trackerValues, overrideValues, ayLabel) {
  const out = [];
  const add = function (school, cls, subj, ch, dateVal) {
    const idx = tchCampusIdx_(school), at = tchDateMs_(dateVal);
    subj = String(subj || '').replace(/\s*\([^)]*\)\s*$/, '').trim(); // "Economics (Commerce)" is the Tracker's stream suffix
    if (idx < 0 || at === null || !String(cls || '').trim() || !subj || !String(ch || '').trim()) return;
    out.push({ lmsIdx: idx, cls: String(cls).trim(), subj: subj, ch: String(ch).trim(), cwaAt: at });
  };
  const rows = function (values, names, fn) {
    if (!values || values.length < 2) return;
    const at = names.map(function (n) { return values[0].indexOf(n); });
    if (at.some(function (i) { return i < 0; })) return;
    for (let i = 1; i < values.length; i++) fn(at.map(function (c) { return values[i][c]; }));
  };
  rows(trackerValues, ['School', 'Class', 'Subject', 'Chapter Name', 'Actual CWA Date'], function (r) { add(r[0], r[1], r[2], r[3], r[4]); });
  rows(overrideValues, ['AcademicYear', 'School', 'Class', 'Subject', 'ChapterName', 'ActualDate'], function (r) {
    if (ayLabel && String(r[0] || '') !== ayLabel) return;
    add(r[1], r[2], r[3], r[4], r[5]);
  });
  return out;
}

// ── the index ────────────────────────────────────────────────────────
function tchIstDay_(ms) { return new Date(ms + TCH_IST_OFFSET_MS).toISOString().slice(0, 10); }

// feed = {cwRecords, cmData}; roster = {employees:[{employeeCode,name,school}], academic:[{employeeCode,class,subject}]};
// trackerRows from tchTrackerRows_; timetable = timetable.json; prevMeta = the last build's meta or null; cfg = {now?} (ms)
// -> { byCode:{code:TeacherState}, meta:{builtAt, records, unmatched:{lmsIdx:[name]}, resolution:{lmsIdx:{records,resolved}}} }
//    | { keepPrevious:true, reason }   (a feed that looks broken must not replace a good index)
function tchBuildIndex_(feed, roster, trackerRows, timetable, prevMeta, cfg) {
  const now = Number(cfg && cfg.now) || Date.now();
  const recs = feed && Array.isArray(feed.cwRecords) ? feed.cwRecords : [];
  const employees = roster && Array.isArray(roster.employees) ? roster.employees : [];
  if (!recs.length) return { keepPrevious: true, reason: 'feed has no records' };
  if (!employees.length) return { keepPrevious: true, reason: 'roster is empty' };
  if (prevMeta && prevMeta.records && recs.length < prevMeta.records * TCH_MIN_KEEP_RATIO) {
    return { keepPrevious: true, reason: 'feed fell from ' + prevMeta.records + ' to ' + recs.length + ' records' };
  }

  const byCampus = tchRosterByCampus_(employees);
  const codeByLower = {}, campusOf = {};
  employees.forEach(function (e) {
    const code = String(e.employeeCode || '').trim(), idx = tchCampusIdx_(e.school);
    if (code && idx >= 0) { codeByLower[code.toLowerCase()] = code; campusOf[code] = idx; }
  });

  // pass 1: resolve every entry's teacher; note which chapters have started (any teacher, resolved or not)
  const nameCache = {}, unmatchedBy = {}, resolution = {}, started = {}, rawName = {}, chCache = {}, campusPairs = {}, codePairs = {};
  const slim = [];
  recs.forEach(function (r) {
    const idx = Number(r.lmsIdx), res = resolution[idx] = resolution[idx] || { records: 0, resolved: 0 };
    res.records++;
    const rawCh = String(r.cwChapter || '');
    const ch = tchHas_(chCache, rawCh) ? chCache[rawCh] : (chCache[rawCh] = tchChKey_(rawCh));
    const cs = idx + '|' + r.classMapped + '|' + tchSubjKey_(r.subject);
    if (ch) { started[cs + '|' + ch] = true; if (!tchHas_(rawName, cs + '|' + ch)) rawName[cs + '|' + ch] = rawCh.trim(); }
    campusPairs[cs] = true;
    const nk = idx + '|' + r.teacher;
    if (!tchHas_(nameCache, nk)) nameCache[nk] = tchResolve_(r.teacher, byCampus, idx);
    const code = nameCache[nk];
    if (!code) {
      const raw = String(r.teacher || '').trim();
      if (raw) {
        const u = unmatchedBy[idx] = unmatchedBy[idx] || {};
        if (!tchHas_(u, tchNormalizeName_(raw))) u[tchNormalizeName_(raw)] = raw;
      }
      return;
    }
    res.resolved++;
    const pk = r.classMapped + '|' + tchSubjKey_(r.subject), cp = codePairs[code] = codePairs[code] || {};
    cp[pk] = (cp[pk] || 0) + 1;
    slim.push({ lmsIdx: idx, classMapped: r.classMapped, subject: r.subject, teacher: code, cwChapter: r.cwChapter, cwTag: r.cwTag,
      hwDesc: r.hwDesc, hwTag: r.hwTag, timeMs: r.timeMs, dateStr: r.dateStr });
  });
  const unmatched = {};
  Object.keys(unmatchedBy).forEach(function (idx) { unmatched[idx] = Object.keys(unmatchedBy[idx]).map(function (k) { return unmatchedBy[idx][k]; }).slice(0, 200); });

  // lookups
  const cmBy = {}; // 'lmsIdx|cls|subjKey' -> [chapter]
  const cm = feed.cmData && typeof feed.cmData === 'object' ? feed.cmData : {};
  Object.keys(cm).forEach(function (idx) {
    const tabs = cm[idx] || {};
    Object.keys(tabs).forEach(function (cls) {
      (Array.isArray(tabs[cls]) ? tabs[cls] : []).forEach(function (c) {
        const k = idx + '|' + cls + '|' + tchSubjKey_(c.subject);
        (cmBy[k] = cmBy[k] || []).push(c);
      });
    });
  });
  const trackerCwa = {};
  (trackerRows || []).forEach(function (t) {
    const k = t.lmsIdx + '|' + t.cls + '|' + tchSubjKey_(t.subj) + '|' + tchChKey_(t.ch);
    if (!tchHas_(trackerCwa, k) || t.cwaAt < trackerCwa[k]) trackerCwa[k] = t.cwaAt;
  });
  const ttByCode = {};
  const campuses = timetable && timetable.campuses && typeof timetable.campuses === 'object' ? timetable.campuses : {};
  Object.keys(campuses).forEach(function (cp) { Object.keys(campuses[cp] || {}).forEach(function (code) { ttByCode[code] = campuses[cp][code]; }); });

  // per-teacher states
  const states = {};
  const stateOf = function (code) {
    return states[code] = states[code] || { code: code, campus: 'LMS' + (campusOf[code] + 1), classSubjects: [], episodes: [], loggedDays: {}, periodsByDay: null, nextChapters: [] };
  };
  (roster.academic || []).forEach(function (a) {
    const code = String(a.employeeCode || '').trim(), lab = tchLabel_(a.class, a.subject);
    if (!lab || !tchHas_(campusOf, code)) return;
    const st = stateOf(code);
    if (!st.classSubjects.some(function (x) { return x.cls === lab.cls && x.subj === lab.subj; })) st.classSubjects.push(lab);
  });

  const cutoff = now - TCH_LOGGED_DAYS * TCH_DAY_MS;
  slim.forEach(function (r) {
    const t = Number(r.timeMs);
    if (!(t >= cutoff)) return;
    const day = /^\d{4}-\d\d-\d\d$/.test(String(r.dateStr || '')) ? r.dateStr : tchIstDay_(t);
    const st = stateOf(r.teacher);
    (st.loggedDays[day] = st.loggedDays[day] || []).push({ cls: r.classMapped, subj: String(r.subject || '').trim(), at: t, hw: !!String(r.hwDesc || '').trim() });
  });

  ownAcadEpisodes_(slim, cfg && cfg.acadRules).forEach(function (e) {
    const code = codeByLower[e.key.teacher];
    if (!code) return;
    const cs = e.key.lms + '|' + e.key.cls + '|' + tchSubjKey_(e.key.subj), ck = tchChKey_(e.key.ch);
    const planned = (cmBy[cs] || []).filter(function (c) { return tchChKey_(c.chapterName) === ck; })[0];
    const trackerAt = tchHas_(trackerCwa, cs + '|' + ck) ? trackerCwa[cs + '|' + ck] : null;
    stateOf(code).episodes.push({
      cls: e.key.cls, subj: e.key.subj, ch: e.key.ch, name: rawName[cs + '|' + ck] || e.key.ch, first: e.first, last: e.last,
      cwaAt: e.cwa !== null ? e.cwa : trackerAt,
      cwaFrom: e.cwa !== null ? 'tag' : (trackerAt !== null ? 'tracker' : null),
      remediatedAt: e.cwa !== null ? e.remediationWithin : null,
      plannedCwaDate: planned && planned.cwaDate ? String(planned.cwaDate) : null,
    });
  });

  Object.keys(ttByCode).forEach(function (code) { if (tchHas_(campusOf, code)) stateOf(code); }); // timetabled, nothing logged yet: still gets a state
  const nextFrom = tchIstDay_(now - TCH_NEXT_GRACE_DAYS * TCH_DAY_MS);
  Object.keys(states).forEach(function (code) {
    const st = states[code];
    st.episodes.sort(function (a, b) { return b.last - a.last; });
    // upcoming chapters: per class-subject the course map's chapters nobody has started, soonest planned start first
    const seen = {};
    st.classSubjects.concat(st.episodes).forEach(function (x) {
      const cs = campusOf[code] + '|' + x.cls + '|' + tchSubjKey_(x.subj);
      if (seen[cs]) return;
      seen[cs] = true;
      (cmBy[cs] || [])
        .filter(function (c) { return /^\d{4}-\d\d-\d\d/.test(String(c.startDate || '')) && String(c.startDate).slice(0, 10) >= nextFrom && !started[cs + '|' + tchChKey_(c.chapterName)]; })
        .sort(function (a, b) { return String(a.startDate).localeCompare(String(b.startDate)) || (a.chapterNo || 0) - (b.chapterNo || 0); })
        .slice(0, TCH_NEXT_PER_CLASS)
        .forEach(function (c) { st.nextChapters.push({ cls: x.cls, subj: x.subj, ch: ownAcadNormChapter_(c.chapterName), name: String(c.chapterName).trim(), startDate: String(c.startDate).slice(0, 10) }); });
    });
    // timetable: only CW/HW class-subjects, by weekday; null when this teacher has none
    const tt = ttByCode[code];
    if (tt && Array.isArray(tt.periods)) {
      const days = {};
      TCH_DAYS.forEach(function (d) { days[d] = []; });
      let n = 0;
      tt.periods.slice().sort(function (a, b) { return (a.period || 0) - (b.period || 0); }).forEach(function (p) {
        const lab = !p.free && tchHas_(days, p.day) ? tchLabel_(p.class, p.subject) : null;
        if (lab) { days[p.day].push(tchSnap_(lab, campusOf[code], codePairs[code] || {}, campusPairs)); n++; }
      });
      if (n) st.periodsByDay = days;
    }
  });
  Object.keys(states).forEach(function (code) { // a teacher with nothing at all has no state
    const st = states[code];
    if (!st.classSubjects.length && !st.episodes.length && !Object.keys(st.loggedDays).length && !st.periodsByDay) delete states[code];
  });

  return { byCode: states, meta: { builtAt: now, records: recs.length, unmatched: unmatched, resolution: resolution } };
}

// ── refresh (time-driven trigger, every 30 minutes) ─────────────────────────────────────────
function tchBytes_(s) { return unescape(encodeURIComponent(s)).length; }

function tchReadJson_(cache, key) {
  const v = cache.get(key);
  if (!v) return null;
  try { return JSON.parse(v); } catch (err) { return null; }
}

// Game Config (for the framework's defaults and any Owner overrides); the defaults if the game workbook is not reachable
function tchConfig_() {
  try {
    const id = PropertiesService.getScriptProperties().getProperty('GAME_SHEET_ID');
    if (id) return gameParseConfig_(SpreadsheetApp.openById(id).getSheetByName('Game Config').getDataRange().getValues());
  } catch (err) { /* defaults below */ }
  return gameParseConfig_([['Key', 'Value']]);
}

function tchAyLabel_(date) { // same academic year rule as chapterAcademicYear in ChapterTracker.gs
  const y = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return y + '-' + String(y + 1).slice(2);
}

function tchReadTracker_() { // the Chapter Tracker's AY tab and Overrides tab; [] if unreadable (the index then just has no tracker-only CWAs)
  try {
    const book = SpreadsheetApp.openById(TCH_TRACKER_SHEET_ID), ay = tchAyLabel_(new Date());
    const values = function (name) { const sh = book.getSheetByName(name); return sh ? sh.getDataRange().getValues() : []; };
    return tchTrackerRows_(values(ay), values('Overrides'), ay);
  } catch (err) {
    Logger.log('[game-teacher] Chapter Tracker unreadable: ' + err);
    return [];
  }
}

// -> {feed, roster, timetable} or null if the feed or the roster could not be read (the timetable is optional: without it periodsByDay is null)
function tchFetchInputs_() {
  const urls = [TCH_FEED_URL, TCH_ROSTER_URL + '?action=employees', TCH_ROSTER_URL + '?action=roster', TCH_TIMETABLE_URL];
  const res = UrlFetchApp.fetchAll(urls.map(function (u) { return { url: u, muteHttpExceptions: true }; }));
  const parse = function (r) {
    if (!r || r.getResponseCode() !== 200) return null;
    try { return JSON.parse(r.getContentText()); } catch (err) { return null; }
  };
  const feed = parse(res[0]), emp = parse(res[1]), acad = parse(res[2]), timetable = parse(res[3]);
  if (!feed || !emp || !emp.success || !Array.isArray(emp.employees) || !acad || !acad.success || !Array.isArray(acad.rows)) return null;
  return { feed: feed, roster: { employees: emp.employees, academic: acad.rows }, timetable: timetable };
}

// Squeeze a state under the CacheService limit by dropping its oldest logged days, then oldest episodes
function tchFit_(state) {
  let json = JSON.stringify(state);
  const days = Object.keys(state.loggedDays).sort();
  while (tchBytes_(json) > TCH_MAX_VALUE_BYTES && days.length) { delete state.loggedDays[days.shift()]; json = JSON.stringify(state); }
  while (tchBytes_(json) > TCH_MAX_VALUE_BYTES && state.episodes.length) { state.episodes.pop(); json = JSON.stringify(state); }
  return json;
}

function gameTeacherRefresh() {
  const lock = LockService.getScriptLock();
  lock.waitLock(TCH_LOCK_MS);
  try {
    const cache = CacheService.getScriptCache();
    const prev = tchReadJson_(cache, 'tch_meta');
    if (prev && prev.builtAt && Date.now() - prev.builtAt < TCH_FRESH_MS) return { success: true, skipped: true };
    const inputs = tchFetchInputs_();
    if (!inputs) { Logger.log('[game-teacher] sources unreadable: keeping the cached index'); return { success: false, error: 'sources unreadable' }; }
    const out = tchBuildIndex_(inputs.feed, inputs.roster, tchReadTracker_(), inputs.timetable, prev, Object.assign(tchConfig_(), { now: Date.now() }));
    if (out.keepPrevious) { Logger.log('[game-teacher] keeping the cached index: ' + out.reason); return { success: false, error: out.reason }; }
    const codes = Object.keys(out.byCode);
    for (let i = 0; i < codes.length; i += 100) {
      const chunk = {};
      codes.slice(i, i + 100).forEach(function (c) { chunk['tch_' + c] = tchFit_(out.byCode[c]); });
      cache.putAll(chunk, TCH_STATE_TTL_S);
    }
    cache.put('tch_meta', JSON.stringify(out.meta), TCH_STATE_TTL_S); // last: a reader that sees the new meta sees the new states
    return { success: true, teachers: codes.length };
  } finally {
    lock.releaseLock();
  }
}

// The cached TeacherState for an employee code, or null. A miss with the index present means "no state for this person"
// (not on the roster, nothing logged, no timetable); only an absent index (cold cache, 6 h expiry) rebuilds, once, under the lock.
function tchStateFor_(code) {
  const cache = CacheService.getScriptCache();
  const hit = tchReadJson_(cache, 'tch_' + code);
  if (hit) return hit;
  if (cache.get('tch_meta')) return null;
  try { gameTeacherRefresh(); } catch (err) { return null; }
  return tchReadJson_(cache, 'tch_' + code);
}

// Owner only: how many names per campus the roster could not match, and the share of entries that resolved. Counts, never names.
GAME_MODULE_ACTIONS.teacherindexaudit = function (caller) {
  if (!caller || (caller.roles || []).indexOf('Owner') === -1) return { success: false, error: 'Owner only' };
  const meta = tchReadJson_(CacheService.getScriptCache(), 'tch_meta');
  if (!meta) return { success: false, error: 'Teacher index not built yet' };
  const unmatched = {}, resolution = {};
  for (let i = 0; i < 6; i++) {
    unmatched['LMS' + (i + 1)] = ((meta.unmatched || {})[i] || []).length;
    resolution['LMS' + (i + 1)] = (meta.resolution || {})[i] || { records: 0, resolved: 0 };
  }
  return { success: true, builtAt: meta.builtAt, records: meta.records, unmatched: unmatched, resolution: resolution };
};

// ── employee sign-in fallback ────────────────────────────────────────
// game.gs calls this only for a verified email that missed the allowlist, and only with Script property STAFF_AUTO_SIGNIN === 'on'.
// KEEP IN SYNC with pdrStaffFromEmployeeMaster_ and PDR_AUTO_ROLE_BY_DEPARTMENT / PDR_CAMPUS_BY_PREFIX in main.gs: the game backend
// must accept exactly the people PDR accepts. Active in EmpMaster, AuthEmail in EmpPersonal, role from EmpSalary.Department
// (lower-cased keys; AdminTM, blank and unknown departments get nothing), HES and unknown code prefixes get nothing.
var TCH_AUTO_ROLE_BY_DEPARTMENT = { teaching: 'Teacher', adminpti: 'Teacher', adminit: 'Teacher', adminclerk: 'Staff', 'non-teaching': 'Staff', transport: 'Staff' };
var TCH_CAMPUS_BY_PREFIX = { KUL: 'LMS1', KEL: 'LMS2', DUN: 'LMS3', NCM: 'LMS4', SAY: 'LMS5', JOG: 'LMS6' };

function tchEmployeeFromBook_(email, book) {
  email = String(email || '').trim().toLowerCase();
  if (!email) return null;
  const cell = function (v) { return String(v || '').replace(/[​-‏﻿⁠]/g, '').trim(); }; // same cleaning as ss-forms-sync.gs normalizeCell_
  const rowsOf = function (tab) { return book.getSheetByName(tab).getDataRange().getValues(); };
  let code = null;
  const personal = rowsOf('EmpPersonal'), pe = personal[0].indexOf('AuthEmail'), pc = personal[0].indexOf('EmployeeCode');
  if (pe < 0 || pc < 0) return null;
  for (let i = 1; i < personal.length; i++) {
    const e = String(personal[i][pe] || '').trim().toLowerCase(), c = String(personal[i][pc] || '').trim();
    if (e && e.indexOf('@') !== -1 && c && e === email) code = c; // last row wins, like the PDR map
  }
  if (!code) return null;
  const campusId = TCH_CAMPUS_BY_PREFIX[code.split('/')[0]];
  if (!campusId || !tchHas_(TCH_CAMPUS_BY_PREFIX, code.split('/')[0])) return null;
  const find = function (tab, valueCol) { // -> the valueCol cell of this code's row, or null
    const rows = rowsOf(tab), codeAt = rows[0].indexOf('EmployeeCode'), valAt = rows[0].indexOf(valueCol);
    if (codeAt < 0 || valAt < 0) return null;
    for (let i = 1; i < rows.length; i++) if (cell(rows[i][codeAt]) === code) return cell(rows[i][valAt]);
    return null;
  };
  if ((find('EmpMaster', 'Status') || '').toLowerCase() !== 'active') return null;
  const dept = (find('EmpSalary', 'Department') || '').toLowerCase();
  if (!tchHas_(TCH_AUTO_ROLE_BY_DEPARTMENT, dept)) return null;
  return { campusId: campusId, employeeCode: code, role: TCH_AUTO_ROLE_BY_DEPARTMENT[dept] };
}

GAME_CALLER_FALLBACKS.employee = function (verifiedEmail) {
  try { return tchEmployeeFromBook_(verifiedEmail, SpreadsheetApp.openById(TCH_EMP_SHEET_ID)); } catch (err) { return null; }
};
