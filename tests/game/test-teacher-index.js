// node tests/game/test-teacher-index.js -- Teacher index (game-teacher.gs): name resolution, TeacherState, labels, refresh, employee fallback
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const dir = __dirname + '/../../apps-script/';
const ctx = { console };
vm.createContext(ctx);
const load = (f) => vm.runInContext(fs.readFileSync(dir + f, 'utf8'), ctx);
// game-teacher.gs may run BEFORE game.gs (guard lines): load it first, on purpose
load('game-teacher.gs'); load('acad-episodes.gs'); load('game.gs'); load('game-actions.gs');
const J = (x) => JSON.parse(JSON.stringify(x));
const DAY = 86400000, D0 = Date.UTC(2026, 8, 1), NOW = D0 + 60 * DAY;       // 'today' = 31 Oct 2026

// synthetic roster: T One / T Two at LMS4 (idx 3), T Four at LMS2, "Same Name" twice at LMS4 (ambiguous)
const C1 = 'NCM/99/01/901', C2 = 'NCM/25/01/002', C4 = 'KEL/24/01/010';
const employees = [
  { employeeCode: C1, name: 'T One', school: 'LMS 4' }, { employeeCode: C2, name: 'T Two', school: 'LMS 4' },
  { employeeCode: C4, name: 'T Four', school: 'LMS 2' },
  { employeeCode: 'NCM/20/01/001', name: 'Same Name', school: 'LMS 4' }, { employeeCode: 'NCM/20/01/002', name: 'Same Name', school: 'LMS 4' },
];
const academic = [
  { employeeCode: C1, school: 'LMS 4', class: 'Class 7', subject: 'Math', teacher: 'T One' },
  { employeeCode: C1, school: 'LMS 4', class: 'Class 7', subject: 'Math', teacher: 'T One' },     // duplicate row
  { employeeCode: C1, school: 'LMS 4', class: 'Class 7', subject: 'Games', teacher: 'T One' },     // not a CW/HW subject
  { employeeCode: C1, school: 'LMS 4', class: 'Class 8', subject: 'Science', teacher: 'T One' },
  { employeeCode: C2, school: 'LMS 4', class: 'Class 3', subject: 'English', teacher: 'T Two' },
];
const roster = { employees, academic };
const byCampus = ctx.tchRosterByCampus_(employees);

// ---- name resolution: the tpNormalizeName_ rule, exact match inside the campus only
assert.strictEqual(ctx.tchResolve_('T One maam', byCampus, 3), C1);
assert.strictEqual(ctx.tchResolve_('  t   ONE  Sir ', byCampus, 3), C1);
assert.strictEqual(ctx.tchResolve_('T Three', byCampus, 3), null);       // not on the roster
assert.strictEqual(ctx.tchResolve_('T One', byCampus, 1), null);         // a name only resolves inside its own campus
assert.strictEqual(ctx.tchResolve_('T Four', byCampus, 1), C4);
assert.strictEqual(ctx.tchResolve_('Same Name', byCampus, 3), null);     // two people, one name: never guess
assert.strictEqual(ctx.tchResolve_('', byCampus, 3), null);
assert.strictEqual(ctx.tchResolve_('constructor', byCampus, 3), null);

// ---- labels: timetable spellings line up with the feed's
const L = (c, s) => J(ctx.tchLabel_(c, s));
assert.deepStrictEqual(L('Class 7', 'MATH'), { cls: 'Class 7', subj: 'Math' });
assert.deepStrictEqual(L('Class 10', 'Maths'), { cls: 'Class 10', subj: 'Math' });
assert.deepStrictEqual(L('Class 3', 'ENGLSIH'), { cls: 'Class 3', subj: 'English' });
assert.deepStrictEqual(L('Class 11 (Medical)', 'Biology'), { cls: 'Class 11', subj: 'Biology' });      // the stream is not part of the class
assert.deepStrictEqual(L('Class 12 (Commerce)', 'Business Studies'), { cls: 'Class 12', subj: 'Business Study' });
assert.deepStrictEqual(L('Class 2', 'Computer (CIII)'), { cls: 'Class 2', subj: 'Computer' });
assert.deepStrictEqual(L('M-I', 'ENGLISH'), { cls: 'M-I', subj: 'English' });
assert.strictEqual(ctx.tchLabel_('M-I', 'Lunch Break'), null);
assert.strictEqual(ctx.tchLabel_('Class 3', 'Games'), null);
assert.strictEqual(ctx.tchLabel_('Class 11 (Commerce)', 'Economics Peer Teaching'), null);
assert.strictEqual(ctx.tchLabel_('', 'Math'), null);
assert.strictEqual(ctx.tchLabel_('Class 7', ''), null);

// ---- the synthetic feed (LMS4 = lmsIdx 3)
let seq = 0;
const rec = (teacher, cls, subj, ch, tag, d, hw) => ({
  lmsIdx: 3, classMapped: cls, subject: subj, teacher, cwChapter: ch, cwTag: tag, hwDesc: hw || '', hwTag: '',
  timeMs: D0 + d * DAY + (seq++), dateStr: new Date(D0 + d * DAY).toISOString().slice(0, 10),
});
const recs = [
  // T One, Class 7 Math "Light": 3 teaching days + CWA on day 3 + a same-chapter remediation on day 10
  rec('T One maam', 'Class 7', 'Math', 'Light', 'Chapter Teaching', 0, 'do ex 1'),
  rec('T One maam', 'Class 7', 'Math', 'Light', 'Activity', 1),
  rec('T One maam', 'Class 7', 'Math', 'Light', 'Chapter Teaching', 2),
  rec('T One maam', 'Class 7', 'Math', 'Light', 'CWA', 3),
  rec('T One', 'Class 7', 'Math', 'Light', 'Remediation', 10),                           // the name spelt without "maam": same person
  // "Heat": three days, NO CWA tag in the feed (the Tracker has one), a 7-tag entry on day 5 counts as logged
  rec('T One maam', 'Class 7', 'Math', 'Heat', 'Chapter Teaching', 4),
  rec('T One maam', 'Class 7', 'Math', 'Heat', 'Chapter Teaching, Activity, New Words, Question & Answers, RT, OTT, Laboratory', 5),
  rec('T One maam', 'Class 7', 'Math', 'Heat', 'Chapter Teaching', 6),
  // Class 8 Science, the chapter that has started
  rec('T One maam', 'Class 8', 'Science', 'Sound', 'Chapter Teaching', 59), rec('T One maam', 'Class 8', 'Science', 'Sound', 'Chapter Teaching', 60),
  rec('T One maam', 'Class 8', 'Science', 'Sound', 'Activity', 60),
  // T Three is not on the roster; a Hindi chapter for T Two
  rec('T Three', 'Class 7', 'Math', 'Light', 'Chapter Teaching', 0),
  rec('T Two', 'Class 3', 'English', 'सच्ची दोस्ती', 'Chapter Teaching', 2), rec('T Two', 'Class 3', 'English', 'सच्ची दोस्ती', 'Chapter Teaching', 3),
  rec('T Two', 'Class 3', 'English', 'सच्ची दोस्ती', 'CWA', 4),
];
const cmData = { 3: {
  'Class 7': [
    { subject: 'Maths', chapterNo: 1, chapterName: 'Light', term: 'Term 1', startDate: '2026-09-01', cwaDate: '2026-09-04' },
    { subject: 'Maths', chapterNo: 2, chapterName: 'Heat', term: 'Term 1', startDate: '2026-09-05', cwaDate: '2026-09-20' },
    { subject: 'Maths', chapterNo: 3, chapterName: 'Air', term: 'Term 1', startDate: '2026-11-03', cwaDate: '2026-11-20' },
    { subject: 'Maths', chapterNo: 4, chapterName: 'Water', term: 'Term 1', startDate: '2026-11-10', cwaDate: '2026-11-25' },
    { subject: 'Maths', chapterNo: 5, chapterName: 'Soil', term: 'Term 2', startDate: '2026-11-15', cwaDate: '2026-12-01' },
    { subject: 'Maths', chapterNo: 6, chapterName: 'Rocks', term: 'Term 2', startDate: '2026-11-20', cwaDate: '2026-12-10' },
    { subject: 'Maths', chapterNo: 7, chapterName: 'Old', term: 'Term 1', startDate: '2026-04-10', cwaDate: '2026-04-20' },   // planned long ago, never started: not "next"
  ],
  'Class 8': [{ subject: 'Science', chapterNo: 1, chapterName: 'Sound', term: 'Term 1', startDate: '2026-10-29', cwaDate: '2026-11-05' }],
} };
const feed = { cwRecords: recs, cmData };
const timetable = { campuses: { LMS4: {
  [C1]: { name: 'T One', periods: [
    { day: 'Mon', period: 1, subject: 'MATH', class: 'Class 7', free: false },
    { day: 'Mon', period: 2, subject: '', class: '', free: true },
    { day: 'Mon', period: 3, subject: 'Lunch Break', class: 'M-I', free: false },
    { day: 'Mon', period: 4, subject: 'Science', class: 'Class 8', free: false },
    { day: 'Tue', period: 1, subject: 'MATH', class: 'Class 7', free: false },
    { day: 'Tue', period: 2, subject: 'MATH', class: 'Class 7', free: false },
  ] },
} } };
const tracker = [{ lmsIdx: 3, cls: 'Class 7', subj: 'Math', ch: 'heat', cwaAt: D0 + 7 * DAY }];
const cfg = { now: NOW };

const out = ctx.tchBuildIndex_(feed, roster, tracker, timetable, null, cfg);
assert.ok(!out.keepPrevious);
const s1 = J(out.byCode[C1]), s2 = J(out.byCode[C2]);
assert.strictEqual(s1.code, C1); assert.strictEqual(s1.campus, 'LMS4');
assert.ok(!out.byCode['T Three'] && Object.keys(out.byCode).every((k) => /\//.test(k)));
// "T Three" is on no state and is listed as unmatched for her campus
assert.deepStrictEqual(J(out.meta.unmatched), { 3: ['T Three'] });
assert.strictEqual(out.meta.records, recs.length);
assert.strictEqual(typeof out.meta.builtAt, 'number');
assert.deepStrictEqual(J(out.meta.resolution[3]), { records: recs.length, resolved: recs.length - 1 });

// class-subjects from EmpAcademic: deduped, labels in the feed's spelling, Games dropped
assert.deepStrictEqual(s1.classSubjects, [{ cls: 'Class 7', subj: 'Math' }, { cls: 'Class 8', subj: 'Science' }]);

// loggedDays: every entry counts (the 7-tag one too); items carry the time and whether HW was set
const day5 = s1.loggedDays['2026-09-06'];
assert.strictEqual(day5.length, 1);
assert.deepStrictEqual(Object.keys(day5[0]).sort(), ['at', 'cls', 'hw', 'subj']);
assert.strictEqual(day5[0].cls, 'Class 7'); assert.strictEqual(day5[0].subj, 'Math'); assert.strictEqual(day5[0].hw, false);
assert.strictEqual(s1.loggedDays['2026-09-01'][0].hw, true);
assert.strictEqual(s1.loggedDays['2026-09-01'][0].at, recs[0].timeMs);
assert.ok(!s1.loggedDays['2026-09-09']);                       // no entry that day
assert.strictEqual(Object.keys(s1.loggedDays).length, 10);     // days 0-6, 10, 59, 60
assert.ok(s1.loggedDays['2026-10-31'] && s1.loggedDays['2026-10-30']);

// episodes: tag CWA vs Tracker CWA vs none; same-chapter remediation; planned CWA from the course map
const ep = (st, ch) => st.episodes.find((e) => e.ch === ch);
const light = ep(s1, 'light'), heat = ep(s1, 'heat');
assert.strictEqual(light.cls, 'Class 7'); assert.strictEqual(light.subj, 'Math');
assert.strictEqual(light.cwaAt, D0 + 3 * DAY + 3);             // the CWA entry's timeMs (seq adds the ms)
assert.strictEqual(light.cwaFrom, 'tag');
assert.strictEqual(light.remediatedAt, D0 + 10 * DAY + 4);
assert.strictEqual(light.first, recs[0].timeMs); assert.strictEqual(light.plannedCwaDate, '2026-09-04');
assert.strictEqual(heat.cwaFrom, 'tracker');                    // no CWA tag in the feed, only the Chapter Tracker has it
assert.strictEqual(heat.cwaAt, D0 + 7 * DAY); assert.strictEqual(heat.remediatedAt, null);
assert.strictEqual(heat.plannedCwaDate, '2026-09-20');
assert.strictEqual(ep(s1, 'sound').cwaFrom, null); assert.strictEqual(ep(s1, 'sound').cwaAt, null);
assert.strictEqual(ep(s1, 'sound').plannedCwaDate, '2026-11-05');
assert.strictEqual(s1.episodes.length, 3);
// Hindi chapters form episodes too (T Two) and are keyed by the normalised name
assert.strictEqual(s2.episodes.length, 1); assert.strictEqual(s2.episodes[0].ch, 'सच्ची दोस्ती');
assert.strictEqual(s2.episodes[0].plannedCwaDate, null);        // no course-map row for this class-subject
// no Tracker row: nothing changes (tag wins when both exist)
const both = J(ctx.tchBuildIndex_(feed, roster, [{ lmsIdx: 3, cls: 'Class 7', subj: 'Math', ch: 'Light', cwaAt: D0 + 99 * DAY }], timetable, null, cfg).byCode[C1]);
assert.strictEqual(ep(both, 'light').cwaFrom, 'tag'); assert.strictEqual(ep(both, 'light').cwaAt, D0 + 3 * DAY + 3);

// next chapters: the course map's chapters nobody has started, soonest first, capped; "Old" (planned months ago) is not next
assert.deepStrictEqual(s1.nextChapters.map((c) => c.ch), ['air', 'water', 'soil']);
assert.deepStrictEqual(J(s1.nextChapters[0]), { cls: 'Class 7', subj: 'Math', ch: 'air', name: 'Air', startDate: '2026-11-03' });
assert.ok(!s1.nextChapters.some((c) => c.cls === 'Class 8'));   // Sound has started
assert.deepStrictEqual(s2.nextChapters, []);

// periodsByDay: labels normalised, free/Lunch dropped; null for a teacher not in the timetable
assert.deepStrictEqual(J(s1.periodsByDay), {
  Mon: [{ cls: 'Class 7', subj: 'Math' }, { cls: 'Class 8', subj: 'Science' }],
  Tue: [{ cls: 'Class 7', subj: 'Math' }, { cls: 'Class 7', subj: 'Math' }],
  Wed: [], Thu: [], Fri: [], Sat: [],
});
assert.strictEqual(s2.periodsByDay, null);
// ... and every timetable label lines up with a feed class-subject
const feedPairs = new Set(recs.map((r) => r.classMapped + '|' + r.subject));
J(s1.periodsByDay).Mon.concat(J(s1.periodsByDay).Tue).forEach((p) => assert.ok(feedPairs.has(p.cls + '|' + p.subj), p.cls + p.subj));

// umbrella periods snap to the finer subject the teacher logs: a "Science" period for a teacher who logs Class 9 Physics
const r9 = (d) => rec('T Two', 'Class 9', 'Physics', 'Force', 'Chapter Teaching', 30 + d);
const snap = J(ctx.tchBuildIndex_({ cwRecords: [r9(0), r9(1), r9(2), r9(3)] }, roster, [], { campuses: { LMS4: { [C2]: { periods: [
  { day: 'Mon', period: 1, subject: 'Science', class: 'Class 9', free: false },
  { day: 'Mon', period: 2, subject: 'Science', class: 'Class 10', free: false },        // nobody logs Class 10 Science here: stays as the timetable says
  { day: 'Mon', period: 3, subject: 'Social Science', class: 'Class 9', free: false },  // nothing logged to snap to
] } } } }, null, cfg).byCode[C2]);
assert.deepStrictEqual(snap.periodsByDay.Mon, [{ cls: 'Class 9', subj: 'Physics' }, { cls: 'Class 10', subj: 'Science' }, { cls: 'Class 9', subj: 'Social Science' }]);

// the state fits one CacheService value (100 KB) with room to spare
assert.ok(JSON.stringify(s1).length < 90000);

// ---- teacher config (Ruling 12): defaults, Game Config `teacher` overrides, bad values fall back
const D = J(ctx.tchConfig_(null));
assert.deepStrictEqual(D, { remediationDays: 14, tagInflationThreshold: 7, planLeadDays: 7, remediationShowDays: 21,
  examKeywords: ['exam', 'examination', 'test week', 'pt-'], core: ['cwhw_log'], cap: 3, matchMinConfidence: 0.7, loggedDaysWindow: 60, taughtLookbackDays: 30, cwhwFormUrl: '', cwhwPrefill: {}, questDays: 5, quests: {} });
assert.deepStrictEqual(J(ctx.tchConfig_({ teacher: { remediationDays: 10, examKeywords: ['quiz'], cap: -1, core: 'x', planLeadDays: NaN, junk: 1 } })),
  Object.assign({}, D, { remediationDays: 10, examKeywords: ['quiz'] }));
for (const bad of [undefined, null, 5, 'x', [], { teacher: 'x' }, { teacher: null }, { teacher: [1] }]) assert.deepStrictEqual(J(ctx.tchConfig_(bad)), D);
ctx.tchConfig_(null).examKeywords.push('mutated'); assert.deepStrictEqual(J(ctx.tchConfig_(null)).examKeywords, D.examKeywords);   // defaults are never shared
// remediationDays reaches the episode rule: a remediation 12 days after the CWA counts by default, not with {"remediationDays":10}
const rr = (ch, tag, d) => rec('T Two', 'Class 3', 'English', ch, tag, 100 + d);
const remFeed = { cwRecords: [rr('Rain', 'Chapter Teaching', 0), rr('Rain', 'Chapter Teaching', 1), rr('Rain', 'Chapter Teaching', 2), rr('Rain', 'CWA', 3), rr('Rain', 'Remediation', 15)] };
const remAt = (c) => J(ctx.tchBuildIndex_(remFeed, roster, [], null, null, Object.assign({ now: D0 + 130 * DAY }, c)).byCode[C2]).episodes[0].remediatedAt;
assert.strictEqual(remAt({}), D0 + 115 * DAY + remFeed.cwRecords[4].timeMs % DAY);
assert.strictEqual(remAt({ teacher: { remediationDays: 10 } }), null);
// tagInflationThreshold reaches the tag rule: with 3, an entry carrying 3 tags is not a CWA marker
const tagFeed = { cwRecords: [rr('Sun', 'Chapter Teaching', 0), rr('Sun', 'Chapter Teaching', 1), rr('Sun', 'CWA, Activity, RT', 2), rr('Sun', 'Chapter Teaching', 3)] };
const tagEp = (c) => J(ctx.tchBuildIndex_(tagFeed, roster, [], null, null, Object.assign({ now: D0 + 130 * DAY }, c)).byCode[C2]).episodes[0];
assert.strictEqual(tagEp({}).cwaFrom, 'tag'); assert.strictEqual(tagEp({ teacher: { tagInflationThreshold: 3 } }).cwaFrom, null);
// loggedDaysWindow replaces the 60-day constant
assert.deepStrictEqual(Object.keys(J(ctx.tchBuildIndex_(feed, roster, tracker, timetable, null, { now: NOW, teacher: { loggedDaysWindow: 5 } }).byCode[C1]).loggedDays), ['2026-10-30', '2026-10-31']);

// keepPrevious: the feed fell from 1,000 to 600 records, or came back empty/invalid, or the roster is empty
const filler = (n) => Array.from({ length: n }, (_, i) => rec('T One', 'Class 7', 'Math', 'Light', 'Chapter Teaching', i % 50));
const k = ctx.tchBuildIndex_({ cwRecords: filler(600), cmData: {} }, roster, [], timetable, { records: 1000 }, cfg);
assert.strictEqual(k.keepPrevious, true); assert.ok(k.reason);
const prev1000 = (n) => ctx.tchBuildIndex_({ cwRecords: filler(n), cmData: {} }, roster, [], timetable, { records: 1000 }, cfg);
assert.ok(!prev1000(750).keepPrevious); assert.ok(!prev1000(700).keepPrevious);          // 0.7 of the last build is the line: 750 and 700 build
assert.strictEqual(prev1000(699).keepPrevious, true); assert.strictEqual(prev1000(650).keepPrevious, true);
assert.ok(!ctx.tchBuildIndex_({ cwRecords: filler(900), cmData: {} }, roster, [], timetable, { records: 1000 }, cfg).keepPrevious);  // a normal wobble is fine
assert.ok(!ctx.tchBuildIndex_({ cwRecords: filler(600), cmData: {} }, roster, [], timetable, null, cfg).keepPrevious);                // nothing to protect
assert.strictEqual(ctx.tchBuildIndex_({ cwRecords: [], cmData: {} }, roster, [], timetable, null, cfg).keepPrevious, true);
assert.strictEqual(ctx.tchBuildIndex_({}, roster, [], timetable, null, cfg).keepPrevious, true);
assert.strictEqual(ctx.tchBuildIndex_(feed, { employees: [], academic: [] }, [], timetable, null, cfg).keepPrevious, true);
// a bad timetable or course map never blocks the build
const noTt = ctx.tchBuildIndex_({ cwRecords: recs }, roster, [], null, null, cfg);
assert.strictEqual(J(noTt.byCode[C1]).periodsByDay, null); assert.deepStrictEqual(J(noTt.byCode[C1]).nextChapters, []);
// entries from before the logged-days window are not carried (state stays small)
const old = J(ctx.tchBuildIndex_(feed, roster, tracker, timetable, null, { now: NOW + 400 * DAY }).byCode[C1]);
assert.deepStrictEqual(old.loggedDays, {});

// ---- tracker sheets -> rows
const tr = ctx.tchTrackerRows_(
  [['School', 'Class', 'Subject', 'Chapter No.', 'Chapter Name', 'Teacher', 'Term', 'Planned CWA Date', 'Effective Deadline', 'Actual CWA Date', 'Status'],
    ['LMS 4', 'Class 7', 'Economics (Commerce)', 1, 'Heat!', 'x', 'Term 1', '', '', '2026-09-08', 'OnTime'],
    ['LMS 4', 'Class 7', 'Maths', 2, 'Air', 'x', 'Term 1', '', '', new Date(D0 + 9 * DAY), 'Verified'],
    ['LMS 4', 'Class 7', 'Maths', 3, 'Water', 'x', 'Term 1', '', '', '', 'Pending'],
    ['', '', '', '', '', '', '', '', '', '2026-09-08', 'OnTime']],
  [['Timestamp', 'Email', 'Name', 'AcademicYear', 'School', 'Class', 'Subject', 'ChapterName', 'ActualDate', 'Note'],
    [new Date(), 'a@b', 'n', '2026-27', 'LMS 4', 'Class 7', 'Maths', 'Soil', '2026-10-01', ''],
    [new Date(), 'a@b', 'n', '2025-26', 'LMS 4', 'Class 7', 'Maths', 'Rocks', '2026-10-01', '']], '2026-27');
assert.deepStrictEqual(J(tr).map((r) => [r.lmsIdx, r.cls, r.subj, r.ch, r.cwaAt]),
  [[3, 'Class 7', 'Economics', 'Heat!', Date.parse('2026-09-08')], [3, 'Class 7', 'Maths', 'Air', D0 + 9 * DAY], [3, 'Class 7', 'Maths', 'Soil', Date.parse('2026-10-01')]]);

// ---- refresh + cache + audit, with Apps Script services stubbed
const store = new Map(), fetched = [];
let now = NOW, mode = 'ok';
const fetchOne = (url) => {
  fetched.push(url);
  if (mode === 'fail') return { getResponseCode: () => 500, getContentText: () => '' };
  const body = /action=employees/.test(url) ? { success: true, employees } : /action=roster/.test(url) ? { success: true, rows: academic }
    : /timetable\.json/.test(url) ? timetable : feed;
  return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) };
};
Object.assign(ctx, {
  Logger: { log: () => {} },
  CacheService: { getScriptCache: () => ({
    get: (k) => (store.has(k) ? store.get(k) : null), put: (k, v) => { assert.ok(v.length < 100000, 'value over 100 KB'); store.set(k, v); },
    putAll: (o) => Object.keys(o).forEach((k) => { assert.ok(o[k].length < 100000); store.set(k, o[k]); }), remove: (k) => store.delete(k) }) },
  LockService: { getScriptLock: () => { throw new Error('the refresh must not take the script lock'); } },
  UrlFetchApp: { fetch: fetchOne, fetchAll: (rs) => rs.map((r) => fetchOne(typeof r === 'string' ? r : r.url)) },
  SpreadsheetApp: { openById: () => ({ getSheetByName: (n) => ({ getDataRange: () => ({ getValues: () => (n === 'Overrides' ? [['Timestamp']] : [['School', 'Class', 'Subject', 'Chapter Name', 'Actual CWA Date']]) }) }) }) },
  Date: class extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } },
});
now += 120000; ctx.gameTeacherRefresh();
assert.ok(!store.has('tch_building'), 'building marker cleared');
const meta = JSON.parse(store.get('tch_meta'));
assert.strictEqual(meta.records, recs.length);
assert.strictEqual(JSON.parse(store.get('tch_' + C1)).code, C1);
assert.ok(store.has('tch_' + C2));
assert.deepStrictEqual(meta.codes.slice().sort(), Object.keys(out.byCode).sort());
assert.ok(fetched.some((u) => /action=employees/.test(u)) && fetched.some((u) => /timetable\.json/.test(u)));
// tchStateFor_: a hit reads the cache; a miss with meta present is a plain null (no rebuild); with nothing cached it rebuilds once
const n0 = fetched.length;
assert.strictEqual(ctx.tchStateFor_(C1).code, C1);
assert.strictEqual(ctx.tchStateFor_('NOPE/00/00/000'), null);
assert.strictEqual(fetched.length, n0);
// ... a single key evicted while tch_meta survives: a code the index lists is rebuilt (not null); the 60 s guard stops a storm
store.delete('tch_' + C2);
assert.strictEqual(ctx.tchStateFor_(C2), null);                 // index built a moment ago: no rebuild yet
assert.strictEqual(fetched.length, n0);
now += 120000;
assert.strictEqual(ctx.tchStateFor_(C2).code, C2);
assert.ok(fetched.length > n0);
store.clear();
const n00 = fetched.length;
assert.strictEqual(ctx.tchStateFor_(C2).code, C2);
assert.ok(fetched.length > n00 && store.has('tch_meta'));
// another refresh already running: this one does nothing (and a crashed run's marker expires with its TTL)
store.clear(); store.set('tch_building', '1');
const nb = fetched.length; ctx.gameTeacherRefresh();
assert.strictEqual(fetched.length, nb); store.delete('tch_building');
// a failed fetch keeps what is cached; so does a feed that suddenly shrinks
const before = store.get('tch_' + C1);
mode = 'fail'; now += 120000;
ctx.gameTeacherRefresh();
assert.strictEqual(store.get('tch_' + C1), before); assert.ok(!store.has('tch_building'));
mode = 'ok'; now += 120000; store.set('tch_meta', JSON.stringify({ records: 100000, builtAt: 1 }));
ctx.gameTeacherRefresh();
assert.strictEqual(JSON.parse(store.get('tch_meta')).records, 100000);
// two refreshes in a row (a miss storm) build once
now += 120000; store.clear(); ctx.gameTeacherRefresh();
const n1 = fetched.length; ctx.gameTeacherRefresh();
assert.strictEqual(fetched.length, n1);

// Game Config: the `teacher` row is read even when the framework's defaults do not list it, and merged over TCH_DEFAULTS
ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: () => 'sheet-id' }) };
ctx.SpreadsheetApp = { openById: () => ({ getSheetByName: () => ({ getDataRange: () => ({ getValues: () => [['Key', 'Value'], ['cap', '{"Principal":3}'], ['teacher', '{"remediationDays":10,"cap":"x"}']] }) }) }) };
const loaded = J(ctx.tchLoadCfg_());
assert.strictEqual(loaded.cap.Principal, 3);                       // the framework's own keys still parse
assert.strictEqual(J(ctx.tchConfig_(loaded)).remediationDays, 10);
assert.strictEqual(J(ctx.tchConfig_(loaded)).cap, 3);              // bad type -> default
ctx.PropertiesService = { getScriptProperties: () => { throw new Error('no'); } };
assert.strictEqual(J(ctx.tchLoadCfg_()).cap.Principal, 5);        // workbook unreachable: framework defaults, no throw

// the audit action: Owner only, counts only (no names)
assert.strictEqual(typeof ctx.GAME_MODULE_ACTIONS.teacherindexaudit, 'function');
assert.strictEqual(J(ctx.GAME_MODULE_ACTIONS.teacherindexaudit({ roles: ['Principal'] }, {})).success, false);
store.set('tch_meta', JSON.stringify(out.meta));
const audit = J(ctx.GAME_MODULE_ACTIONS.teacherindexaudit({ roles: ['Owner'] }, {}));
assert.strictEqual(audit.success, true);
assert.strictEqual(audit.unmatched.LMS4, 1); assert.strictEqual(audit.unmatched.LMS2, 0);
assert.strictEqual(audit.resolution.LMS4.records, recs.length);
assert.ok(!JSON.stringify(audit).includes('T Three'));

// ---- employee fallback: the PDR rule (Active, EmpPersonal.AuthEmail, department map, HES/unknown prefix -> null)
const sheet = (rows) => ({ getDataRange: () => ({ getValues: () => rows }) });
const book = (extra) => ({ getSheetByName: (n) => sheet({
  EmpPersonal: [['EmployeeCode', 'AuthEmail'], ['NCM/99/01/901', 'Teach.One@lms.org.in '], ['NCM/24/04/099', 'clerk@lms.org.in'], ['NCM/24/04/100', 'gone@lms.org.in'],
    ['NCM/24/04/101', 'tm@lms.org.in'], ['HES/24/04/001', 'hes@lms.org.in'], ['ZZZ/24/04/002', 'zzz@lms.org.in'], ['NCM/24/04/102', 'unk@lms.org.in'],
    ['NCM/24/04/103', 'admin.it@lms.org.in'], ['NCM/24/04/104', 'driver@lms.org.in'], ['NCM/24/04/105', 'ctor@lms.org.in']],
  EmpMaster: [['EmployeeCode', 'Status'], ['NCM/99/01/901', 'Active'], ['NCM/24/04/099', ' active​'], ['NCM/24/04/100', 'Inactive'], ['NCM/24/04/101', 'Active'],
    ['HES/24/04/001', 'Active'], ['ZZZ/24/04/002', 'Active'], ['NCM/24/04/103', 'Active'], ['NCM/24/04/104', 'Active'], ['NCM/24/04/105', 'Active']],
  EmpSalary: [['EmployeeCode', 'Department'], ['NCM/99/01/901', 'Teaching'], ['NCM/24/04/099', 'AdminClerk'], ['NCM/24/04/100', 'Teaching'], ['NCM/24/04/101', 'AdminTM'],
    ['HES/24/04/001', 'Teaching'], ['ZZZ/24/04/002', 'Teaching'], ['NCM/24/04/103', 'AdminIT'], ['NCM/24/04/104', 'Transport'], ['NCM/24/04/105', 'constructor']],
}[n]) });
const fb = (email) => J(ctx.tchEmployeeFromBook_(email, book()));
assert.deepStrictEqual(fb('teach.one@lms.org.in'), { campusId: 'LMS4', employeeCode: 'NCM/99/01/901', role: 'Teacher' });
assert.deepStrictEqual(fb('TEACH.ONE@lms.org.in'), { campusId: 'LMS4', employeeCode: 'NCM/99/01/901', role: 'Teacher' });
assert.strictEqual(fb('clerk@lms.org.in').role, 'Staff');                 // AdminClerk, and an invisible character in Status is cleaned
assert.strictEqual(fb('admin.it@lms.org.in').role, 'Teacher');
assert.strictEqual(fb('driver@lms.org.in').role, 'Staff');
for (const e of ['gone@lms.org.in', 'tm@lms.org.in', 'hes@lms.org.in', 'zzz@lms.org.in', 'unk@lms.org.in', 'ctor@lms.org.in', 'nobody@lms.org.in', '', null, undefined]) assert.strictEqual(ctx.tchEmployeeFromBook_(e, book()), null, String(e));
// the registered hook is the one game.gs reads, and it opens the Employee Master itself
ctx.SpreadsheetApp = { openById: (id) => { assert.strictEqual(id, '1OjVMUvpLM8JkdAwjmljCtZUI1VUqGLbic36cW9dm0C0'); return book(); } };
assert.strictEqual(typeof ctx.GAME_CALLER_FALLBACKS.employee, 'function');
assert.strictEqual(J(ctx.GAME_CALLER_FALLBACKS.employee('teach.one@lms.org.in')).role, 'Teacher');
// ... and game.gs accepts exactly its answer
const caller = J(ctx.gameCallerFromFallback_('teach.one@lms.org.in', 'on', ctx.GAME_CALLER_FALLBACKS.employee));
assert.strictEqual(caller.campusId, 'LMS4'); assert.strictEqual(caller.canDecide, false); assert.deepStrictEqual(caller.roles, ['Teacher']);
ctx.SpreadsheetApp = { openById: () => { throw new Error('no access'); } };
assert.strictEqual(ctx.GAME_CALLER_FALLBACKS.employee('teach.one@lms.org.in'), null);   // a read failure is a refusal, never a throw
console.log('teacher-index: ok');
