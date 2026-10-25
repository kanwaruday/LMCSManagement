var GAME_MODULE_ACTIONS = GAME_MODULE_ACTIONS || {};
var GAME_MODULE_MISSIONS = GAME_MODULE_MISSIONS || {};
var GAME_MODULE_QUESTS = GAME_MODULE_QUESTS || {};
var GAME_CALLER_FALLBACKS = GAME_CALLER_FALLBACKS || {};
var GAME_MODULE_DONE_AT = GAME_MODULE_DONE_AT || {};

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
// ponytail: TeacherState keeps the last teacher.loggedDaysWindow days (60) of logged entries, not the whole year (one CacheService
//   value is 100 KB). A longer view means a second key per teacher.
// LOCKS: the refresh takes NO script lock (fetching + building takes tens of seconds, and the Game workbook writes in game-actions.gs
//   wait on that same lock for 20 s, gameWithLock_). Concurrent refreshes are de-duplicated with a short tch_building cache marker.
//   Callers (missions, quests) must call tchStateFor_ BEFORE gameWithLock_, never inside it: on a cold cache it runs the refresh.
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
var TCH_BUILDING_TTL_S = 300;     // the tch_building marker outlives a crashed run by at most this
var TCH_FRESH_MS = 60000;         // a refresh that finds the index younger than this does nothing (a miss storm builds once)
var TCH_NEXT_PER_CLASS = 3;       // upcoming chapters kept per class-subject
var TCH_NEXT_GRACE_DAYS = 14;     // a chapter whose planned start is further back than this and never started is skipped, not "next"
var TCH_MIN_KEEP_RATIO = 0.7;     // a feed under this share of the last build's records is treated as broken
var TCH_MAX_VALUE_BYTES = 95000;  // CacheService caps one value at 100 KB
var TCH_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── config: the Game Config key `teacher` (a JSON object) merged over these defaults (Ruling 12) ──────────────
// Tasks 4 and 5 read the same object through tchConfig_(cfg). A missing key, a value of the wrong type or a non-positive number falls back
// to its default; nothing here throws.
var TCH_DEFAULTS = {
  remediationDays: 14, tagInflationThreshold: 7, planLeadDays: 7, remediationShowDays: 21,
  examKeywords: ['exam', 'examination', 'test week', 'pt-'], core: ['cwhw_log'], cap: 3, matchMinConfidence: 0.7,
  loggedDaysWindow: 60, taughtLookbackDays: 30, // taughtLookbackDays: a class-subject logged this recently counts as taught even if the roster lacks it
  // Ruling 13: where the missions send the teacher to log, and the Google Form entry ids to pre-fill ({cls, subj, ch, tag} -> 'entry.123')
  cwhwFormUrl: '', cwhwPrefill: {},
  // Task 5: Quest 1's "on track" day target; quests.termEnd (a string setting, 'YYYY-MM-DD'; unset = no cut-off) drops upcoming chapters starting after the term from Quest 2
  questDays: 5, quests: {},
};

// Ruling 16: the CW/HW form URL is accepted only when it starts with exactly one of these (the client renders Go for nothing else); anything else is ''.
var TCH_FORM_URL_RE = /^https:\/\/(docs\.google\.com\/forms\/|forms\.gle\/)/;

// cfg = the framework's parsed config (gameParseConfig_) or any object with an optional `teacher` object -> a fresh, complete object
function tchConfig_(cfg) {
  const out = {}, given = cfg && cfg.teacher && typeof cfg.teacher === 'object' && !Array.isArray(cfg.teacher) ? cfg.teacher : {};
  Object.keys(TCH_DEFAULTS).forEach(function (k) {
    const def = TCH_DEFAULTS[k], v = tchHas_(given, k) ? given[k] : undefined;
    if (Array.isArray(def)) out[k] = Array.isArray(v) && v.every(function (x) { return typeof x === 'string'; }) ? v.slice() : def.slice();
    else if (typeof def === 'string') out[k] = typeof v === 'string' && (k !== 'cwhwFormUrl' || TCH_FORM_URL_RE.test(v.trim())) ? v.trim() : def;
    else if (typeof def === 'object') { // a map of strings; anything else is ignored
      out[k] = {};
      if (v && typeof v === 'object' && !Array.isArray(v)) Object.keys(v).forEach(function (n) { if (typeof v[n] === 'string' && v[n]) out[k][n] = v[n]; });
    }
    else out[k] = typeof v === 'number' && isFinite(v) && v > 0 ? v : def;
  });
  return out;
}

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
// Ruling 23, the ONE rule for which feed entries the overnight activity check can look at: an entry with a chapter, a usable time and a
// non-empty CW description (trimmed), before or after the CWA. The index (episode.lastDescribed) and the nightly pull (tchMatchPull_) both use it.
// chKey = tchChKey_ of r.cwChapter (the caller caches that). -> {key:'lmsIdx|class|subjectKey|chapterKey', desc, t} or null. The teacher is the caller's to resolve.
function tchCandidate_(r, chKey) {
  const desc = String(r.cwDesc || '').trim(), t = Number(r.timeMs);
  if (!chKey || !desc || !isFinite(t) || t <= 0) return null;
  return { key: Number(r.lmsIdx) + '|' + r.classMapped + '|' + tchSubjKey_(r.subject) + '|' + chKey, desc: desc, t: t };
}

function tchIstDay_(ms) { return new Date(ms + TCH_IST_OFFSET_MS).toISOString().slice(0, 10); }

// feed = {cwRecords, cmData}; roster = {employees:[{employeeCode,name,school}], academic:[{employeeCode,class,subject}]};
// trackerRows from tchTrackerRows_; timetable = timetable.json; prevMeta = the last build's meta or null; cfg = the parsed Game Config (see
// tchConfig_) plus an optional now (ms)
// -> { byCode:{code:TeacherState}, meta:{builtAt, records, codes:[code], unmatched:{lmsIdx:[name]}, resolution:{lmsIdx:{records,resolved}}} }
//    | { keepPrevious:true, reason }   (a feed that looks broken must not replace a good index)
function tchBuildIndex_(feed, roster, trackerRows, timetable, prevMeta, cfg) {
  const now = Number(cfg && cfg.now) || Date.now(), T = tchConfig_(cfg);
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
  const nameCache = {}, unmatchedBy = {}, resolution = {}, started = {}, rawName = {}, chCache = {}, campusPairs = {}, codePairs = {}, lastDescribed = {};
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
    const cand = tchCandidate_(r, ch);
    if (cand) { const dk = code + '|' + cand.key; if (!tchHas_(lastDescribed, dk) || cand.t > lastDescribed[dk]) lastDescribed[dk] = cand.t; }
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

  const cutoff = now - T.loggedDaysWindow * TCH_DAY_MS;
  slim.forEach(function (r) {
    const t = Number(r.timeMs);
    if (!(t >= cutoff)) return;
    const day = /^\d{4}-\d\d-\d\d$/.test(String(r.dateStr || '')) ? r.dateStr : tchIstDay_(t);
    const st = stateOf(r.teacher);
    (st.loggedDays[day] = st.loggedDays[day] || []).push({ cls: r.classMapped, subj: String(r.subject || '').trim(), at: t, hw: !!String(r.hwDesc || '').trim() });
  });

  // includeMClasses / minEpisodePeriods 1: a Montessori chapter or a chapter with a single entry still gets a chapter quest
  ownAcadEpisodes_(slim, { remWindowDays: T.remediationDays, maxEntryTags: Math.max(1, Math.round(T.tagInflationThreshold) - 1), includeMClasses: true, minEpisodePeriods: 1 }).forEach(function (e) {
    const code = codeByLower[e.key.teacher];
    if (!code) return;
    const cs = e.key.lms + '|' + e.key.cls + '|' + tchSubjKey_(e.key.subj), ck = tchChKey_(e.key.ch);
    const planned = (cmBy[cs] || []).filter(function (c) { return tchChKey_(c.chapterName) === ck; })[0];
    const trackerAt = tchHas_(trackerCwa, cs + '|' + ck) ? trackerCwa[cs + '|' + ck] : null;
    stateOf(code).episodes.push({
      cls: e.key.cls, subj: e.key.subj, ch: e.key.ch, name: rawName[cs + '|' + ck] || e.key.ch, first: e.first, last: e.last,
      lastDescribed: lastDescribed[code + '|' + cs + '|' + ck] || 0, // newest candidate note (tchCandidate_), for the overnight check's "checking" hint
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

  return { byCode: states, meta: { builtAt: now, records: recs.length, codes: Object.keys(states), unmatched: unmatched, resolution: resolution } };
}

// ── refresh (time-driven trigger, every 30 minutes) ─────────────────────────────────────────
function tchBytes_(s) { return unescape(encodeURIComponent(s)).length; }

function tchReadJson_(cache, key) {
  const v = cache.get(key);
  if (!v) return null;
  try { return JSON.parse(v); } catch (err) { return null; }
}

// The parsed Game Config (framework defaults + Owner overrides) with the `teacher` row carried through even when the framework's own
// defaults do not list that key yet; the framework defaults if the game workbook is not reachable.
function tchLoadCfg_() {
  try {
    const id = PropertiesService.getScriptProperties().getProperty('GAME_SHEET_ID');
    if (id) {
      const rows = SpreadsheetApp.openById(id).getSheetByName('Game Config').getDataRange().getValues();
      const cfg = gameParseConfig_(rows);
      if (!cfg.teacher) {
        for (let i = 1; i < rows.length; i++) {
          if (String(rows[i][0] || '').trim() !== 'teacher') continue;
          try { cfg.teacher = JSON.parse(String(rows[i][1])); } catch (err) { /* bad JSON: defaults */ }
        }
      }
      return cfg;
    }
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

// Builds the whole index and writes it to CacheService. No script lock (see LOCKS above): a refresh that finds the index younger than
// TCH_FRESH_MS, or another refresh running (tch_building), does nothing. A failed fetch or a broken-looking feed leaves the cache as it was.
function gameTeacherRefresh() {
  const cache = CacheService.getScriptCache();
  const prev = tchReadJson_(cache, 'tch_meta');
  if (prev && prev.builtAt && Date.now() - prev.builtAt < TCH_FRESH_MS) return { success: true, skipped: true };
  if (cache.get('tch_building')) return { success: true, skipped: true, building: true };
  cache.put('tch_building', '1', TCH_BUILDING_TTL_S);
  try {
    const inputs = tchFetchInputs_();
    if (!inputs) { Logger.log('[game-teacher] sources unreadable: keeping the cached index'); return { success: false, error: 'sources unreadable' }; }
    const out = tchBuildIndex_(inputs.feed, inputs.roster, tchReadTracker_(), inputs.timetable, prev, Object.assign(tchLoadCfg_(), { now: Date.now() }));
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
    cache.remove('tch_building');
  }
}

// The cached TeacherState for an employee code, or null. Call it BEFORE gameWithLock_, never inside (a cold cache runs the refresh).
// A miss for a code the index lists (a single key evicted early) or an absent index (cold cache, 6 h expiry) rebuilds; a code the
// index does not list has no state (not on the roster, nothing logged, no timetable) and gets null with no rebuild.
function tchStateFor_(code) {
  const cache = CacheService.getScriptCache();
  const hit = tchReadJson_(cache, 'tch_' + code);
  if (hit) return hit;
  const meta = tchReadJson_(cache, 'tch_meta');
  if (meta && (!Array.isArray(meta.codes) || meta.codes.indexOf(code) === -1)) return null;
  try { gameTeacherRefresh(); } catch (err) { return null; }
  return tchReadJson_(cache, 'tch_' + code);
}

// ── missions ─────────────────────────────────────────────────────────
// Spec/plan: Task 4. Pure part: tchWorkingDay_ and tchMissions_ take data in, Mission[] out. The wiring (GAME_MODULE_MISSIONS.Teacher) is the
// only part that touches CalendarApp / CacheService. Mission ids: teacher:<kind>:<code>:<key>.
// Source of the campus calendars: PDR_SCHOOL_CALENDAR_IDS in principal-dr.gs. KEEP IN SYNC (LMS2 and LMS3 share one calendar).
var TCH_CALENDAR_IDS = {
  LMS1: 'c_88402c40e6c9a435cbed4810bfae632d781ac9e7ca167b5435e4a9586bda7595@group.calendar.google.com',
  LMS2: 'c_25n5qbggh7u9s5o6vq31iho4vc@group.calendar.google.com',
  LMS3: 'c_25n5qbggh7u9s5o6vq31iho4vc@group.calendar.google.com',
  LMS4: 'lms.org.in_snflpd3f357jv8l380s8sc4ju0@group.calendar.google.com',
  LMS5: 'c_d367ca2cb9bbab4f6a5b6864d6e03c28fbfccf02b5212621e89daf2f9f3f8523@group.calendar.google.com',
  LMS6: 'c_3db6cb2edb78d889cf166771c426f0fe3ba78b04cf9ca8e566329c888d023635@group.calendar.google.com',
};
var TCH_CAL_TTL_S = 21600;                    // 6 h: a campus's events for one day
var TCH_CAL_UNKNOWN_TTL_S = 1800;             // 30 min: an unreadable calendar is not retried on every load
var TCH_CODE_MISS_TTL_S = 600;                // 10 min: an email with no employee code
var TCH_DEFAULT_FORM_GO = 'teacher/index.html#tags';
var TCH_PLAN_GO = 'teacher/plan-activity.html';
var TCH_STAFF_GO = 'teacher/index.html';      // Staff land on the teacher page, which has the game mount

// Mon-Sat, not the 2nd Saturday, no event titled GH..., no event whose title has an exam keyword (cfg.teacher.examKeywords, case-insensitive).
// calendarEvents = [{title}] for that day only; campus is unused here (the caller already picked the campus's events).
function tchWorkingDay_(campus, dayKey, calendarEvents, cfg) {
  const d = new Date(dayKey + 'T00:00:00Z'), dow = d.getUTCDay(), dom = d.getUTCDate();
  if (dow === 0 || (dow === 6 && dom >= 8 && dom <= 14)) return false;
  const words = tchConfig_(cfg).examKeywords.map(function (w) { return w.toLowerCase(); }).filter(Boolean);
  return !(calendarEvents || []).some(function (e) {
    const t = String((e && e.title) || '');
    return t.indexOf('GH') === 0 || words.some(function (w) { return t.toLowerCase().indexOf(w) !== -1; });
  });
}

function tchAddDays_(dayKey, n) { return new Date(Date.parse(dayKey + 'T00:00:00Z') + n * TCH_DAY_MS).toISOString().slice(0, 10); }
function tchCsKey_(cls, subj) { return cls + '|' + tchSubjKey_(subj); }
function tchIso_(ms) { return ms === null || ms === undefined ? null : new Date(ms).toISOString(); }

// The CW/HW form for a mission: cfg.cwhwFormUrl (else the teacher page's tags tab). Google Forms get usp=pp_url pre-fill from cfg.cwhwPrefill
// ({cls, subj, ch, tag} -> 'entry.N') -> {go, filled:{cls,subj,ch,tag -> true}} listing exactly the fields that were pre-filled.
function tchFormGo_(T, fields) {
  const base = T.cwhwFormUrl || TCH_DEFAULT_FORM_GO, parts = [], filled = {};
  if (fields && /^https:\/\/docs\.google\.com\/forms\//.test(base)) {
    ['cls', 'subj', 'ch', 'tag'].forEach(function (k) {
      if (T.cwhwPrefill[k] && fields[k]) { parts.push(encodeURIComponent(T.cwhwPrefill[k]) + '=' + encodeURIComponent(fields[k])); filled[k] = true; }
    });
  }
  return { go: parts.length ? base + (base.indexOf('?') === -1 ? '?' : '&') + 'usp=pp_url&' + parts.join('&') : base, filled: filled };
}

// The mission's small line, decided per field: say "filled in" only when every field was, otherwise ask for what is left, naming the chapter
// whenever it was not pre-filled. label = 'Class 7 Math', tag = 'Remediation' | 'CWA'.
function tchFormHint_(f, label, chapter, tag) {
  if (f.filled.cls && f.filled.subj && f.filled.ch && f.filled.tag) return 'The form opens with the class, subject, chapter and ' + tag + ' tag filled in';
  const ask = [];
  if (!f.filled.cls || !f.filled.subj) ask.push(label);
  if (!f.filled.ch) ask.push('chapter “' + chapter + '”');
  if (!f.filled.tag) ask.push('tag ' + tag);
  return (Object.keys(f.filled).length ? 'The form fills in part of it. ' : '') + 'Pick ' + ask.join(', ');
}

// Today's log card numbers, or null when a timetable exists but has nothing on this weekday (nothing is expected).
// -> {total, done, doneAt (ms | null: when the last due class-subject was first logged, or the first entry without a timetable), missing:[label]}
function tchLogProgress_(state, dayKey) {
  const entries = (state.loggedDays && state.loggedDays[dayKey]) || [], first = {}; // 'cls|subj' -> earliest entry time that day
  entries.forEach(function (e) { const k = tchCsKey_(e.cls, e.subj); if (!tchHas_(first, k) || e.at < first[k]) first[k] = e.at; });
  const wd = TCH_DAYS[(new Date(dayKey + 'T00:00:00Z').getUTCDay() + 6) % 7];
  const slots = state.periodsByDay && tchHas_(state.periodsByDay, wd) ? state.periodsByDay[wd] : null;
  if (state.periodsByDay && !slots) return null;
  if (!slots) { // no timetable: the honest fallback is one item, never invented per-class work
    const times = Object.keys(first).map(function (k) { return first[k]; });
    return { total: 1, done: times.length ? 1 : 0, doneAt: times.length ? Math.min.apply(null, times) : null, missing: [] };
  }
  const want = [], seen = {};
  slots.forEach(function (p) { const k = tchCsKey_(p.cls, p.subj); if (!seen[k]) { seen[k] = true; want.push({ k: k, label: p.cls + ' ' + p.subj }); } });
  if (!want.length) return null;
  const have = want.filter(function (w) { return tchHas_(first, w.k); });
  return { total: want.length, done: have.length, doneAt: have.length === want.length ? Math.max.apply(null, have.map(function (w) { return first[w.k]; })) : null,
    missing: want.filter(function (w) { return !tchHas_(first, w.k); }).map(function (w) { return w.label; }) };
}

// state = TeacherState; email = the caller's (owner / doneBy: quest evidence matches doneBy against the caller's email; defaults to the code); plans = {"cls|subj|ch": {activity, plannedAt}}; cfg = the parsed Game Config (with its `teacher` row); now = Date
// Pending, done and gone rules: the plan's Task 4 table. A finished mission shows only while it is fresh (today and yesterday, like the
// other roles); a closed-without-remediation chapter shows as gone until remediationShowDays, never as a mission after that.
function tchMissions_(state, dayKey, isWorkingDay, plans, cfg, now, email) {
  if (!state) return [];
  const T = tchConfig_(cfg), code = state.code, who = gameLower_(email) || code, campus = state.campus, out = [], since = gameLookbackStart_(now);
  const mk = function (kind, key, f) {
    f.owner = who; f.campus = campus; f.core = T.core.indexOf(kind) !== -1;
    const m = gameMission_(kind, '', f);
    m.id = 'teacher:' + kind + ':' + code + ':' + key;
    return m;
  };
  const fresh = function (ms) { return ms !== null && ms >= since; };

  const log = isWorkingDay ? tchLogProgress_(state, dayKey) : null;
  if (log) {
    const isDone = log.done >= log.total;
    out.push(mk('cwhw_log', dayKey, {
      title: "Log today's classwork and homework (" + log.done + ' of ' + log.total + ' class' + (log.total === 1 ? '' : 'es') + ')',
      why: isDone ? '' : log.missing.length ? 'Still to log: ' + log.missing.join(', ') : 'No timetable on file yet, so a log for any of your classes counts',
      go: tchFormGo_(T, null).go, due: dayKey, done: isDone, doneAt: isDone ? tchIso_(log.doneAt) : null, doneBy: isDone ? who : null,
      progress: { done: log.done, total: log.total },
    }));
  }

  (state.episodes || []).forEach(function (e) {
    const key = e.cls + '|' + e.subj + '|' + e.ch, label = e.cls + ' ' + e.subj;
    if (e.cwaAt !== null && e.cwaAt !== undefined) {
      const cwaDay = tchIstDay_(e.cwaAt), due = tchAddDays_(cwaDay, T.remediationDays);
      const f = tchFormGo_(T, { cls: e.cls, subj: e.subj, ch: e.name, tag: 'Remediation' }), go = f.go, how = tchFormHint_(f, label, e.name, 'Remediation');
      const title = 'Log the remediation for ' + e.name + ' (' + label + ')';
      if (e.remediatedAt !== null && e.remediatedAt !== undefined) {
        if (fresh(e.remediatedAt)) out.push(mk('remediation_due', key, { title: title, why: '', go: go, due: due, done: true, doneAt: tchIso_(e.remediatedAt), doneBy: who }));
      } else if (dayKey <= due) {
        out.push(mk('remediation_due', key, { title: title, why: how, go: go, due: due }));
      } else if (dayKey <= tchAddDays_(cwaDay, T.remediationShowDays)) {
        out.push(mk('remediation_due', key, { title: title, why: 'The remediation window has passed', go: go, due: due, gone: true }));
      }
    }
    const planned = /^\d{4}-\d\d-\d\d/.test(String(e.plannedCwaDate || '')) ? String(e.plannedCwaDate).slice(0, 10) : '';
    if (planned && planned < dayKey) {
      const title = 'The CWA for ' + e.name + ' (' + label + ') was planned for ' + gameDateLabel_(planned);
      const f = tchFormGo_(T, { cls: e.cls, subj: e.subj, ch: e.name, tag: 'CWA' }), go = f.go, how = tchFormHint_(f, label, e.name, 'CWA');
      if (e.cwaAt === null || e.cwaAt === undefined) out.push(mk('cwa_due', key, { title: title, why: how, go: go, due: planned }));
      else if (fresh(e.cwaAt)) out.push(mk('cwa_due', key, { title: title, why: '', go: go, due: planned, done: true, doneAt: tchIso_(e.cwaAt), doneBy: who }));
    }
  });

  const lastDay = tchAddDays_(dayKey, T.planLeadDays);
  (state.nextChapters || []).forEach(function (c) {
    if (String(c.startDate) > lastDay) return;
    const key = c.cls + '|' + c.subj + '|' + c.ch, plan = plans && tchHas_(plans, key) ? plans[key] : null;
    const title = 'Plan an activity for ' + c.name + ' (' + c.cls + ' ' + c.subj + ')'; // the due tag carries the start date
    const go = tchPlanGo_(c.cls, c.subj, c.ch, c.name);
    if (!plan) { out.push(mk('activity_plan_due', key, { title: title, why: 'A one-line plan is enough', go: go, due: c.startDate })); return; }
    const at = tchDateMs_(plan.plannedAt);
    if (fresh(at)) out.push(mk('activity_plan_due', key, { title: title, why: '', go: go, due: c.startDate, done: true, doneAt: tchIso_(at), doneBy: who }));
  });
  return out;
}

// ── overnight activity check (Task 7) ────────────────────────────────
// Each night the Mac asks local LM Studio whether a chapter's CW notes describe the activity the teacher planned (tools/teacher_activity_match.py).
// Tab "Teacher Activity Matches" (PlanKey, EntryTimeMs, Matched, Confidence, Reason, CheckedAt), created on the first push, one row per
// checked entry. PlanKey is a SHA-256 of the plan's row key salted with Script property GAME_PUSH_SECRET: the Mac never sees a name or a code.
// SETUP: Script property GAME_PUSH_SECRET (and the Mac's ~/.lmcs/game_push_secret). ROTATING IT RESETS EVERY ACTIVITY CHECK: it salts planKey, so every
// stored result stops matching its plan and the next night re-asks about all of them.
// teachermatchpull / teachermatchpush carry no Google token; the shared secret is the gate (game.gs doPost has a caller-less branch for exactly
// these two actions). tchMatchesFor_ is called INSIDE gameWithLock_ by the quests hook: sheet and cache reads only, never a feed fetch.
// ponytail: tchMatchesFor_ scans the whole matches tab on a cache miss (10 min per teacher); add a per-teacher tab if it passes a few thousand rows.
var TCH_MATCH_TAB = 'Teacher Activity Matches';
var TCH_MATCH_HEADER = ['PlanKey', 'EntryTimeMs', 'Matched', 'Confidence', 'Reason', 'CheckedAt'];
var TCH_MATCH_TTL_S = 600;
var TCH_PULL_MAX_ITEMS = 400, TCH_PULL_MAX_ENTRIES = 20, TCH_PULL_DESC_MAX = 300, TCH_PUSH_MAX_ROWS = 2000, TCH_REASON_MAX = 100;

function tchPushSecret_() { return String(PropertiesService.getScriptProperties().getProperty('GAME_PUSH_SECRET') || '').trim(); }

// Trimmed both sides (a pasted Script property often carries a newline); every character is compared, so the time does not say where they differ.
function tchSecretOk_(given) {
  const secret = tchPushSecret_(), g = String(given === null || given === undefined ? '' : given).trim();
  if (!secret) return false;
  let diff = secret.length ^ g.length;
  for (let i = 0; i < Math.max(secret.length, g.length); i++) diff |= (secret.charCodeAt(i) || 0) ^ (g.charCodeAt(i) || 0);
  return diff === 0;
}

function tchPlanKey_(secret, code, cls, subj, chNorm) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, secret + '|' + [code, cls, subj, chNorm].join('|'), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}

function tchAllPlanRows_() { // -> [{code, campus, cls, subj, chapterNorm, activity}]; [] when there is no tab yet
  const sh = gameBook_().getSheetByName(TCH_PLAN_TAB);
  if (!sh) return [];
  return sh.getDataRange().getValues().slice(1).filter(function (r) { return r[0]; }).map(function (r) {
    return { code: String(r[0]), campus: String(r[1]), cls: String(r[2]), subj: String(r[3]), chapterNorm: String(r[4]), activity: String(r[6]) };
  });
}

// PlanKey -> {maxT (newest entry checked), bestM (a match exists), bestC (best confidence: among matches if any, else among non-matches)}
function tchMatchSums_() {
  const sh = gameBook_().getSheetByName(TCH_MATCH_TAB), out = {};
  if (!sh) return out;
  sh.getDataRange().getValues().slice(1).forEach(function (r) {
    const k = String(r[0]), t = Number(r[1]), c = Number(r[3]), m = String(r[2]) === 'true';
    if (!k || !isFinite(t) || !isFinite(c)) return;
    const s = out[k] = out[k] || { maxT: 0, bestM: false, bestC: -1 };
    if (t > s.maxT) s.maxT = t;
    if ((m && !s.bestM) || (m === s.bestM && c > s.bestC)) { s.bestM = m; s.bestC = c; }
  });
  return out;
}

// POST action=teachermatchpull {secret} -> {success, items:[{planKey, activity, entries:[{timeMs, desc}]}]}: plans whose chapter has CW notes newer than the
// last check (at most 400 plans, 20 oldest entries each). Fetches the feed itself and resolves teacher names with the index's own resolver
// (tchRosterByCampus_ / tchResolve_). Run outside the lock: it reads ~15 MB.
function tchMatchPull_(body) {
  if (!tchSecretOk_(body && body.secret)) return { success: false, error: 'Not authorized' };
  const secret = tchPushSecret_(), plans = tchAllPlanRows_();
  if (!plans.length) return { success: true, items: [] };
  const sums = tchMatchSums_(), minConf = tchConfig_(tchLoadCfg_()).matchMinConfidence, want = {}, all = [];
  plans.forEach(function (p) {
    const idx = tchCampusIdx_(p.campus), pk = tchPlanKey_(secret, p.code, p.cls, p.subj, p.chapterNorm), s = sums[pk] || { maxT: 0, bestM: false, bestC: -1 };
    if (idx < 0 || (s.bestM && s.bestC >= minConf)) return; // already matched: nothing more to ask
    const w = { planKey: pk, activity: p.activity, code: p.code, idx: idx, maxT: s.maxT, entries: [] }, k = idx + '|' + p.cls + '|' + tchSubjKey_(p.subj) + '|' + tchChKey_(p.chapterNorm);
    (want[k] = want[k] || []).push(w);
    all.push(w);
  });
  const res = UrlFetchApp.fetchAll([{ url: TCH_FEED_URL, muteHttpExceptions: true }, { url: TCH_ROSTER_URL + '?action=employees', muteHttpExceptions: true }]);
  const parse = function (r) { try { return r && r.getResponseCode() === 200 ? JSON.parse(r.getContentText()) : null; } catch (err) { return null; } };
  const feed = parse(res[0]), emp = parse(res[1]);
  if (!feed || !Array.isArray(feed.cwRecords) || !feed.cwRecords.length || !emp || !emp.success || !Array.isArray(emp.employees)) return { success: false, error: 'sources unreadable' };
  const byCampus = tchRosterByCampus_(emp.employees), chCache = {}, nameCache = {};
  feed.cwRecords.forEach(function (r) {
    const rawCh = String(r.cwChapter || '');
    const ch = tchHas_(chCache, rawCh) ? chCache[rawCh] : (chCache[rawCh] = tchChKey_(rawCh));
    const cand = tchCandidate_(r, ch), list = cand && want[cand.key]; // the index's own eligibility rule (Ruling 23)
    if (!list) return;
    // Ruling 24, deliberate: a note logged before the plan's PlannedAt may still confirm the activity, so there is no PlannedAt filter.
    const nk = Number(r.lmsIdx) + '|' + r.teacher;
    if (!tchHas_(nameCache, nk)) nameCache[nk] = tchResolve_(r.teacher, byCampus, Number(r.lmsIdx));
    list.forEach(function (w) { if (nameCache[nk] === w.code && cand.t > w.maxT) w.entries.push({ timeMs: cand.t, desc: cand.desc.slice(0, TCH_PULL_DESC_MAX) }); });
  });
  const items = all.filter(function (w) { return w.entries.length; }).slice(0, TCH_PULL_MAX_ITEMS).map(function (w) {
    return { planKey: w.planKey, activity: w.activity, entries: w.entries.sort(function (a, b) { return a.timeMs - b.timeMs; }).slice(0, TCH_PULL_MAX_ENTRIES) };
  });
  return { success: true, items: items };
}

// POST action=teachermatchpush {secret, results:[{planKey, timeMs, matched, confidence, reason}]}: the whole batch is rejected, nothing written,
// for an unknown planKey, a confidence outside 0-1, a malformed row or more than 2000 rows.
function tchMatchPush_(body) {
  if (!tchSecretOk_(body && body.secret)) return { success: false, error: 'Not authorized' };
  const results = body.results;
  if (!Array.isArray(results) || results.length > TCH_PUSH_MAX_ROWS) return { success: false, error: 'Expected at most ' + TCH_PUSH_MAX_ROWS + ' results' };
  if (!results.length) return { success: true, written: 0 };
  const secret = tchPushSecret_(), codeOf = {};
  tchAllPlanRows_().forEach(function (p) { codeOf[tchPlanKey_(secret, p.code, p.cls, p.subj, p.chapterNorm)] = p.code; });
  const nowMs = gameNow_().getTime(), now = new Date(nowMs).toISOString(), rows = [], codes = {};
  for (let i = 0; i < results.length; i++) {
    const r = results[i] || {}, t = Number(r.timeMs), c = r.confidence;
    if (!tchHas_(codeOf, String(r.planKey)) || !(t > 0) || !isFinite(t) || t > nowMs + TCH_DAY_MS || typeof r.matched !== 'boolean' || typeof c !== 'number' || !(c >= 0 && c <= 1)) return { success: false, error: 'Result ' + (i + 1) + ' rejected' };
    codes[codeOf[r.planKey]] = true;
    rows.push([r.planKey, String(Math.floor(t)), String(r.matched), String(c), String(r.reason || '').replace(/^[=+\-@\s]+/, '').slice(0, TCH_REASON_MAX), now]); // a note never starts a formula
  }
  const ss = gameBook_();
  gameWithLock_(function () {
    let sh = ss.getSheetByName(TCH_MATCH_TAB);
    if (!sh) { sh = ss.insertSheet(TCH_MATCH_TAB); gameAppendText_(sh, [TCH_MATCH_HEADER]); }
    gameAppendText_(sh, rows);
    Object.keys(codes).forEach(function (code) { try { CacheService.getScriptCache().remove('tch_matches_' + code); } catch (err) { /* expires in 10 min */ } });
  });
  return { success: true, written: rows.length };
}

// {"cls|subj|chNorm": {matched, confidence} | {pending:true}} for the quests: a plan with a match at or above matchMinConfidence keeps its best match;
// else {pending:true} while the chapter's newest candidate note (episode.lastDescribed in the cached TeacherState, the pull's own eligibility rule) is
// newer than the last one checked; else the best result so far (a weak match or a non-match); a plan with no candidate note and no check has no key.
// Safe inside gameWithLock_: sheet reads and cache only. cfg (optional) is the parsed Game Config the quests hook already holds.
function tchMatchesFor_(code, cfg) {
  if (!code) return {};
  try {
    const T = tchConfig_(cfg || tchLoadCfg_()), secret = tchPushSecret_();
    if (!secret) return {};
    const cache = CacheService.getScriptCache(), mkey = 'tch_matches_' + code;
    let sums = tchReadJson_(cache, mkey);
    if (!sums) {
      const all = tchMatchSums_();
      sums = {};
      tchPlanRows_(code).forEach(function (p) { const k = tchPlanKey_(secret, code, p.cls, p.subj, p.chapterNorm); if (tchHas_(all, k)) sums[p.cls + '|' + p.subj + '|' + p.chapterNorm] = all[k]; });
      try { cache.put(mkey, JSON.stringify(sums), TCH_MATCH_TTL_S); } catch (err) { /* uncached */ }
    }
    const state = tchReadJson_(cache, 'tch_' + code), eps = (state && state.episodes) || [], out = {};
    Object.keys(tchPlansFor_(code)).concat(Object.keys(sums)).forEach(function (key) {
      if (tchHas_(out, key)) return;
      const s = tchHas_(sums, key) ? sums[key] : null, p = key.split('|');
      const last = eps.reduce(function (n, e) { return e.cls === p[0] && e.subj === p[1] && e.ch === p[2] && e.lastDescribed > n ? e.lastDescribed : n; }, 0);
      if (s && s.bestM && s.bestC >= T.matchMinConfidence) out[key] = { matched: true, confidence: s.bestC }; // a weak match falls through: newer notes may still confirm it
      else if (last > (s ? s.maxT : 0)) out[key] = { pending: true };
      else if (s) out[key] = { matched: s.bestM, confidence: s.bestC };
    });
    return out;
  } catch (err) { return {}; }
}

// ── planned activities (Task 6) ──────────────────────────────────────
// Tab "Teacher Planned Activities", created on the first save: one row per (Code, Class, Subject, ChapterNorm). Ruling 22: it holds the teacher's own
// typed line (max 200 characters), keyed by employee code, no names; the text is never logged. tchPlansFor_ returns {"cls|subj|chNorm": {activity,
// plannedAt}} (the shape the missions and quests read), cached 10 min per teacher and removed on every write.
// ponytail: the read scans the whole tab on a cache miss; add an index column or a per-teacher tab if it ever passes a few thousand rows.
var TCH_PLAN_TAB = 'Teacher Planned Activities';
var TCH_PLAN_HEADER = ['Code', 'Campus', 'Class', 'Subject', 'ChapterNorm', 'Chapter', 'Activity', 'PlannedAt', 'UpdatedAt'];
var TCH_PLAN_TTL_S = 600;
var TCH_PLAN_MIN = 3, TCH_PLAN_MAX = 200;

function tchPlanRows_(code) { // -> [{cls, subj, chapterNorm, chapter, activity, plannedAt, updatedAt}] for this code; [] when there is no tab yet
  const sh = gameBook_().getSheetByName(TCH_PLAN_TAB);
  if (!sh) return [];
  return sh.getDataRange().getValues().slice(1).filter(function (r) { return String(r[0]) === code; }).map(function (r) {
    return { cls: String(r[2]), subj: String(r[3]), chapterNorm: String(r[4]), chapter: String(r[5]), activity: String(r[6]), plannedAt: String(r[7]), updatedAt: String(r[8]) };
  });
}

function tchPlansFor_(code) {
  if (!code) return {};
  const cache = CacheService.getScriptCache(), key = 'tch_plans_' + code, hit = tchReadJson_(cache, key);
  if (hit) return hit;
  let plans = {};
  try {
    tchPlanRows_(code).forEach(function (p) { plans[p.cls + '|' + p.subj + '|' + p.chapterNorm] = { activity: p.activity, plannedAt: p.plannedAt }; });
  } catch (err) { return {}; } // an unreadable workbook is no plans, not an error, and is not cached
  try { cache.put(key, JSON.stringify(plans), TCH_PLAN_TTL_S); } catch (err) { /* uncached */ }
  return plans;
}

// The caller as a teacher with an employee code: only the Teacher role writes or reads its own plans.
function tchPlanCaller_(caller) {
  const code = caller && (caller.roles || []).indexOf('Teacher') !== -1 ? tchCodeFor_(caller) : '';
  return code || null;
}

// POST {cls, subj, ch, activity}: validated first (the state may refresh the 15 MB feed, so it is read before the lock), then the
// read-modify-write upsert under the script lock. The row is keyed on the caller's own code, never one from the request.
GAME_MODULE_ACTIONS.teacherplanactivity = function (caller, p) {
  const code = tchPlanCaller_(caller);
  if (!code) return { success: false, error: 'Only a teacher can plan an activity.' };
  const activity = String(p.activity === null || p.activity === undefined ? '' : p.activity).trim();
  if (activity.length < TCH_PLAN_MIN || activity.length > TCH_PLAN_MAX) return { success: false, error: 'Write the activity in a few words.' };
  const cls = String(p.cls || '').trim(), subj = String(p.subj || '').trim(), chapter = String(p.ch || '').trim().slice(0, TCH_PLAN_MAX), chNorm = ownAcadNormChapter_(chapter);
  const state = tchStateFor_(code), now = gameNow_();
  if (!state || !cls || !subj || !chNorm || !tchTaught_(state, tchConfig_(tchLoadCfg_()), cls, subj, now.getTime())) return { success: false, error: "That class isn't on your list." };
  // the subject in the spelling the quests key on (the index's own episode / upcoming-chapter spelling), so the saved plan ticks step 1
  const spelled = (state.episodes || []).concat(state.nextChapters || []).filter(function (x) { return x.cls === cls && tchSubjKey_(x.subj) === tchSubjKey_(subj); })[0];
  const useSubj = spelled ? spelled.subj : subj;
  const iso = now.toISOString(), ss = gameBook_();
  gameWithLock_(function () {
    let sh = ss.getSheetByName(TCH_PLAN_TAB);
    if (!sh) { sh = ss.insertSheet(TCH_PLAN_TAB); gameAppendText_(sh, [TCH_PLAN_HEADER]); }
    const values = sh.getDataRange().getValues();
    let at = -1;
    for (let i = 1; i < values.length; i++) {
      const r = values[i];
      if (String(r[0]) === code && String(r[2]) === cls && String(r[3]) === useSubj && String(r[4]) === chNorm) { at = i; break; }
    }
    if (at === -1) gameAppendText_(sh, [[code, state.campus, cls, useSubj, chNorm, chapter, activity, iso, iso]]);
    else sh.getRange(at + 1, 1, 1, TCH_PLAN_HEADER.length).setNumberFormat('@').setValues([[code, state.campus, cls, useSubj, chNorm, chapter, activity, String(values[at][7] || iso), iso]]);
    try { CacheService.getScriptCache().remove('tch_plans_' + code); } catch (err) { /* expires in 10 min */ }
  });
  return { success: true };
};

// GET: the caller's own plans, no state needed
GAME_MODULE_ACTIONS.teacherplans = function (caller) {
  const code = tchPlanCaller_(caller);
  if (!code) return { success: false, error: 'Only a teacher can see planned activities.' };
  return { success: true, plans: tchPlanRows_(code).map(function (p) { return { cls: p.cls, subj: p.subj, chapterNorm: p.chapterNorm, chapter: p.chapter, activity: p.activity, plannedAt: p.plannedAt, updatedAt: p.updatedAt }; }) };
};

// ── quests ───────────────────────────────────────────────────────────
// Pure part: tchChapterQuests_ and tchSetupQuests_ take data in, QuestState[] out ({questId, title, steps:[{id, title, go, done, locked}], complete}).
// Chapter quests are derived from durable data, so they need no stickiness. Quest 1 and Quest 2 are not (today's log, the month's on-track
// days), so the hook records each finished step as a Game Progress quest_step row, exactly as the framework does for its own quests.
var TCH_QUEST1_ID = 'teacher1';

// ch = the normalised chapter key (what a save is filed under); name = the chapter as the teacher knows it, shown on the plan page heading.
function tchPlanGo_(cls, subj, ch, name) { return TCH_PLAN_GO + '?cls=' + encodeURIComponent(cls) + '&subj=' + encodeURIComponent(subj) + '&ch=' + encodeURIComponent(ch) + (name ? '&name=' + encodeURIComponent(name) : ''); }

// On the roster: classSubjects has the class and the subject, or an umbrella roster subject that covers it (the table the timetable matching snaps with).
function tchOnRoster_(state, cls, subj) {
  return (state.classSubjects || []).some(function (c) {
    return c.cls === cls && (tchSubjKey_(c.subj) === tchSubjKey_(subj) || (tchHas_(TCH_UMBRELLA, c.subj) && TCH_UMBRELLA[c.subj].some(function (a) { return tchSubjKey_(a) === tchSubjKey_(subj); })));
  });
}

// Taught (Ruling 21), for planning: on the roster, or logged within taughtLookbackDays (T = tchConfig_), or an upcoming chapter of the index (the
// Quest 2 links), so every class-subject that shows a quest or a plan link can be planned. nowMs is the game clock.
function tchTaught_(state, T, cls, subj, nowMs) {
  if (!state) return false;
  const cutoff = nowMs - T.taughtLookbackDays * TCH_DAY_MS, same = function (x) { return x.cls === cls && tchSubjKey_(x.subj) === tchSubjKey_(subj); };
  return tchOnRoster_(state, cls, subj) || (state.episodes || []).some(function (e) { return same(e) && e.last >= cutoff; }) || (state.nextChapters || []).some(same);
}

// One quest per class-subject, for its current chapter (the episode with the latest entry). Montessori classes (same /^m-/i test as the episode
// engine) get steps 1-3 only: they have no CWA or remediation.
function tchChapterQuests_(state, plans, matches, cfg, now) {
  if (!state) return [];
  let order = [];
  const T = tchConfig_(cfg), today = gameDayKey_(now), latest = {}, set = function (v) { return v !== null && v !== undefined; };
  // Taught = on the roster (an umbrella roster subject covers its finer feed subjects, the table the timetable matching snaps with) or logged within taughtLookbackDays.
  const cutoff = now.getTime() - T.taughtLookbackDays * TCH_DAY_MS, onRoster = function (e) { return tchOnRoster_(state, e.cls, e.subj); };
  (state.episodes || []).forEach(function (e) {
    const k = tchCsKey_(e.cls, e.subj);
    if (!tchHas_(latest, k)) order.push(k);
    if (!tchHas_(latest, k) || e.last > latest[k].last) latest[k] = e;
  });
  order = order.filter(function (k) { return latest[k].last >= cutoff || onRoster(latest[k]); }); // neither: no quest
  return order.map(function (k) {
    const e = latest[k], key = e.cls + '|' + e.subj + '|' + e.ch;
    const hasPlan = !!plans && tchHas_(plans, key), m = matches && tchHas_(matches, key) ? matches[key] : null;
    const matched = !!m && m.matched === true && m.confidence >= T.matchMinConfidence;
    const checking = hasPlan && !matched && (!m || m.pending === true); // planned, and last night's check has no answer yet
    const form = function (tag) { return tchFormGo_(T, tag ? { cls: e.cls, subj: e.subj, ch: e.name, tag: tag } : null).go; };
    const steps = [
      { id: 'plan', title: 'Plan the activity', go: tchPlanGo_(e.cls, e.subj, e.ch, e.name), done: hasPlan, locked: false },
      { id: 'teach', title: 'Teach', go: form(''), done: true, locked: false },
      { id: 'activity', title: 'Run the activity' + (checking ? ' \u00b7 checking overnight' : ''), go: form(''), done: matched, locked: false },
    ];
    if (!/^m-/i.test(e.cls)) {
      const cwa = set(e.cwaAt), remDone = set(e.remediatedAt);
      const closed = cwa && e.cwaFrom !== 'tracker' && !remDone && today > tchAddDays_(tchIstDay_(e.cwaAt), T.remediationDays);
      steps.push({ id: 'cwa', title: 'Take the CWA', go: form('CWA'), done: cwa, locked: false });
      steps.push({ id: 'remediate', title: closed ? 'The remediation window has passed' : 'Remediate this chapter', go: form('Remediation'), done: remDone, locked: false });
    }
    return { questId: 'chapter:' + state.code + ':' + e.cls + ':' + e.subj + ':' + e.ch, title: e.cls + ' ' + e.subj + ' \u00b7 ' + e.name,
      steps: steps, complete: steps.every(function (s) { return s.done; }) };
  });
}

// Quest 1 "Your portal", then Quest 2 "Plan your term's activities" per class-subject with upcoming chapters (locked until Quest 1 is complete).
// plans = {"cls|subj|ch": ...}; daysOnTrack = gameDaysOnTrack_'s {onTrack, ...}; recorded = {'<questId>:<stepId>': true} (Game Progress quest_step
// rows, key -> the row's Value): a recorded step stays done, and a recorded '<questId>:_done' keeps a quest complete. now defaults to the game clock, recorded to none.
function tchSetupQuests_(state, plans, daysOnTrack, cfg, now, recorded) {
  if (!state) return [];
  const T = tchConfig_(cfg), rec = recorded || {}, today = gameDayKey_(now || gameNow_()), entries = (state.loggedDays && state.loggedDays[today]) || [];
  const termEnd = /^\d{4}-\d\d-\d\d$/.test(T.quests.termEnd || '') ? T.quests.termEnd : '';
  const has = function (key) { return !!plans && tchHas_(plans, key); };
  const mk = function (questId, title, defs, open) {
    const fin = rec[questId + ':_done']; // a finished quest stays finished with the steps it finished with (the value holds [{id, title}])
    if (fin) {
      let kept = null;
      try { kept = JSON.parse(fin); } catch (err) { /* not JSON: keep the current steps, all done */ }
      const list = Array.isArray(kept) && kept.length ? kept : defs;
      return { questId: questId, title: title, complete: true,
        steps: list.map(function (d) { return { id: String(d.id), title: String(d.title), go: TCH_PLAN_GO, done: true, locked: false }; }) };
    }
    const steps = defs.map(function (d) {
      return { id: d.id, title: d.title, go: d.go, done: !!rec[questId + ':' + d.id] || (open && d.met), locked: !open };
    });
    return { questId: questId, title: title, steps: steps, complete: steps.every(function (s) { return s.done; }) };
  };
  const dayWords = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
  const daysTitle = (dayWords[T.questDays - 1] || String(T.questDays)) + (T.questDays === 1 ? ' day' : ' days') + ' on track';
  const form = tchFormGo_(T, null).go;
  // the plan page needs a chapter to open on: the first upcoming chapter still without a plan, else the first one, else the teacher's own page
  const nextOnes = state.nextChapters || [], unplanned = nextOnes.filter(function (c) { return !has(c.cls + '|' + c.subj + '|' + c.ch); })[0] || nextOnes[0];
  const planOneGo = unplanned ? tchPlanGo_(unplanned.cls, unplanned.subj, unplanned.ch, unplanned.name) : TCH_STAFF_GO;
  const q1 = mk(TCH_QUEST1_ID, 'Your portal', [
    { id: 'cw_today', title: "Log today's classwork", go: form, met: entries.length > 0 },
    { id: 'hw_today', title: "Log today's homework", go: form, met: entries.some(function (x) { return x.hw; }) },
    { id: 'plan_one', title: 'Plan the activity for your next chapter', go: planOneGo, met: !!plans && Object.keys(plans).length > 0 },
    { id: 'days_5', title: daysTitle, go: TCH_STAFF_GO, met: ((daysOnTrack && +daysOnTrack.onTrack) || 0) >= T.questDays },
  ], true);
  const out = [q1], byCs = {}, order = [];
  (state.nextChapters || []).forEach(function (c) {
    if (termEnd && String(c.startDate) > termEnd) return;
    const k = tchCsKey_(c.cls, c.subj);
    if (!tchHas_(byCs, k)) { byCs[k] = []; order.push(k); }
    byCs[k].push(c);
  });
  order.forEach(function (k) {
    const cs = byCs[k][0];
    out.push(mk('term:' + state.code + ':' + cs.cls + ':' + cs.subj, "Plan your term's activities \u00b7 " + cs.cls + ' ' + cs.subj, byCs[k].map(function (c) {
      return { id: 'plan:' + c.ch, title: 'Plan the activity for ' + c.name, go: tchPlanGo_(c.cls, c.subj, c.ch, c.name), met: has(c.cls + '|' + c.subj + '|' + c.ch) };
    }), q1.complete));
  });
  return out;
}

// A campus's events for one game day as [{title}], cached 6 h per campus and day; null when the calendar cannot be read (no calendar object, a
// throw). Unknown is not a working day: the caller withholds the day's log card. The unknown result is cached 30 min so a broken calendar is
// not hit on every Today load, and logged as a count only (no ids, no names).
function tchCalendarEvents_(campus, dayKey) {
  const cache = CacheService.getScriptCache(), key = 'tch_cal_' + campus + '_' + dayKey, hit = tchReadJson_(cache, key);
  if (Array.isArray(hit)) return hit;
  if (hit && hit.unknown) return null;
  let events = null;
  try {
    const id = tchHas_(TCH_CALENDAR_IDS, campus) ? TCH_CALENDAR_IDS[campus] : '';
    const cal = id ? CalendarApp.getCalendarById(id) : null;
    if (cal) {
      const start = new Date(Date.parse(dayKey + 'T00:00:00+05:30'));
      events = cal.getEvents(start, new Date(start.getTime() + TCH_DAY_MS)).map(function (e) { return { title: String(e.getTitle() || '') }; });
    }
  } catch (err) { events = null; }
  try {
    if (events) cache.put(key, JSON.stringify(events), TCH_CAL_TTL_S);
    else { cache.put(key, '{"unknown":true}', TCH_CAL_UNKNOWN_TTL_S); Logger.log('[game-teacher] campus calendar unreadable: 1 campus-day, daily log card withheld'); }
  } catch (err) { /* a cache failure only costs a retry */ }
  return events;
}

// The caller's employee code: set on employee-fallback callers; an allowlisted Teacher is looked up by email in the Employee Master, and the
// answer is cached per email (6 h; a non-employee 10 min) so Today does not open the Employee Master on every load.
function tchCodeFor_(caller) {
  if (caller.employeeCode) return caller.employeeCode;
  const email = gameLower_(caller.email);
  if (!email) return '';
  const cache = CacheService.getScriptCache(), key = 'tch_code_' + email, hit = tchReadJson_(cache, key);
  if (hit && typeof hit.code === 'string') return hit.code;
  let code = '';
  try { const r = GAME_CALLER_FALLBACKS.employee(email); code = r && r.employeeCode ? String(r.employeeCode) : ''; } catch (err) { code = ''; }
  try { cache.put(key, JSON.stringify({ code: code }), code ? TCH_STATE_TTL_S : TCH_CODE_MISS_TTL_S); } catch (err) { /* uncached */ }
  return code;
}

// No state (not on the roster, nothing logged) is no missions, never an error. tchStateFor_ runs here, outside any gameWithLock_.
GAME_MODULE_MISSIONS.Teacher = function (caller, cfg, now) {
  const code = tchCodeFor_(caller), state = code ? tchStateFor_(code) : null;
  if (!state) return [];
  const dayKey = gameDayKey_(now), tcfg = cfg && cfg.teacher ? cfg : tchLoadCfg_(), events = tchCalendarEvents_(state.campus, dayKey);
  // events === null: the calendar is unreadable, so whether today is a holiday or an exam day is unknown; no log card rather than an invented one
  return tchMissions_(state, dayKey, events !== null && tchWorkingDay_(state.campus, dayKey, events, tcfg), tchPlansFor_(code), tcfg, now, caller.email);
};

// gameToday_ calls this INSIDE gameWithLock_, so it never runs tchStateFor_ (a cold cache would run the refresh under the lock): it reads the cached
// state, which GAME_MODULE_MISSIONS.Teacher (outside the lock, earlier in the same load) has just warmed. No state is no quests. For the same reason
// the quest_step rows are appended here directly: the caller already holds the lock.
GAME_MODULE_QUESTS.Teacher = function (caller, cfg, now) {
  const code = tchCodeFor_(caller), state = code ? tchReadJson_(CacheService.getScriptCache(), 'tch_' + code) : null;
  if (!state) return [];
  const tcfg = cfg && cfg.teacher ? cfg : tchLoadCfg_(), me = gameLower_(caller.email), ss = gameBook_();
  const progSheet = ss.getSheetByName('Game Progress'), rec = {};
  progSheet.getDataRange().getValues().slice(1).forEach(function (r) { if (gameLower_(r[0]) === me && r[1] === 'quest_step') rec[String(r[2])] = String(r[3] || 'done'); });
  const days = gameDaysOnTrack_(ss.getSheetByName('Game Daily').getDataRange().getValues(), me, gameDayKey_(now).slice(0, 7));
  const setup = tchSetupQuests_(state, tchPlansFor_(code), days, tcfg, now, rec), fresh = [];
  setup.forEach(function (q) {
    if (rec[q.questId + ':_done']) return; // finished and recorded: nothing more to write
    q.steps.forEach(function (s) {
      const key = q.questId + ':' + s.id;
      if (s.done && !rec[key]) { rec[key] = 'done'; fresh.push([me, 'quest_step', key, 'done', now.toISOString()]); }
    });
    // Quest 2's window slides as chapters start, so its completion is recorded with the step titles it was finished with (Value)
    if (q.complete && q.questId !== TCH_QUEST1_ID) {
      rec[q.questId + ':_done'] = 'done';
      fresh.push([me, 'quest_step', q.questId + ':_done', JSON.stringify(q.steps.map(function (s) { return { id: s.id, title: s.title }; })), now.toISOString()]);
    }
  });
  // view-as never reaches this hook: the game backend has no view-as caller (no marker in game.gs), every caller is the signed-in person
  gameAppendText_(progSheet, fresh);
  return setup.concat(tchChapterQuests_(state, tchPlansFor_(code), tchMatchesFor_(code, tcfg), tcfg, now));
};

// Day finalize (the framework calls it for a core id that was not seen done, INSIDE gameWithLock_): when was that day's log card completed?
// For teacher:cwhw_log:<code>:<dayKey> -> the time the last due class-subject was first logged (same rule as the mission), else null. Reads only the
// cached TeacherState (never tchStateFor_: a cold cache would run the refresh inside the lock), and never throws.
GAME_MODULE_DONE_AT.Teacher = function (caller, missionId) {
  try {
    const m = /^teacher:cwhw_log:(.+):(\d{4}-\d\d-\d\d)$/.exec(String(missionId));
    if (!m || m[1] !== tchCodeFor_(caller)) return null;
    const state = tchReadJson_(CacheService.getScriptCache(), 'tch_' + m[1]);
    const log = state ? tchLogProgress_(state, m[2]) : null;
    return log && log.done >= log.total && log.doneAt !== null ? log.doneAt : null;
  } catch (err) { return null; }
};

// Staff (Q9: Non-Teaching, AdminClerk, Transport) get one mission kind: their own Approvals requests that Management sent back for more
// information, built by the framework's Principal builder. Staff are not loaded by gameLoadSources_, so the Approvals tab is read here.
GAME_MODULE_MISSIONS.Staff = function (caller, cfg, now) {
  let rows;
  try { rows = SpreadsheetApp.openById(GAME_APPROVALS_SHEET_ID).getSheetByName('Approvals').getDataRange().getValues(); } catch (err) { return []; }
  return gameInfoRequested_(rows, gameLower_(caller.email), 'Staff', cfg, now, TCH_STAFF_GO);
};
GAME_MODULE_QUESTS.Staff = function () { return []; }; // Staff have no quests

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
  const cell = function (v) { return String(v || '').replace(/[\u200B-\u200F\uFEFF\u2060]/g, '').trim(); }; // same cleaning as ss-forms-sync.gs normalizeCell_
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
