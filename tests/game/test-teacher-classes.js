// node tests/game/test-teacher-classes.js -- My classes (game-teacher.gs): state.lastCw at index build, the Social Studies join,
// tchClasses_ cards (placeholders: no done, no form), the teacherclasses action. Synthetic names and codes only.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const dir = __dirname + '/../../apps-script/';
const ctx = { console, Logger: { log() {} } };
vm.createContext(ctx);
const load = (f) => vm.runInContext(fs.readFileSync(dir + f, 'utf8'), ctx);
load('game-teacher.gs'); load('acad-episodes.gs'); load('game.gs'); load('game-actions.gs'); load('game-missions.gs'); load('game-windows.gs');
const J = (x) => JSON.parse(JSON.stringify(x));
const at = (iso) => Date.parse(iso);
const DAY = 86400000;

// ---- index build: lastCw (latest row per upload day, two newest days) and the Social Studies course-map join
{
  const C1 = 'NCM/99/01/901', NOW = at('2026-11-10T12:00:00Z');
  const employees = [{ employeeCode: C1, name: 'T One', school: 'LMS 4' }];
  const academic = [{ employeeCode: C1, class: 'Class 4', subject: 'Social Science' }, { employeeCode: C1, class: 'M-I', subject: 'English' }];
  const r = (day, hhmm, subj, ch, desc, cls) => ({ lmsIdx: 3, classMapped: cls || 'Class 4', subject: subj, teacher: 'T One', cwBook: 'Book A', cwChapter: ch,
    cwDesc: desc, cwTag: 'Chapter Teaching', hwDesc: 'hw', hwTag: '', timeMs: at(day + 'T' + hhmm + ':00+05:30'), dateStr: day });
  const recs = [
    r('2026-11-06', '10:00', 'Social Science', 'Maps', 'oldest day'),
    r('2026-11-07', '10:00', 'Social Science', 'Maps', 'saved first'),
    r('2026-11-07', '15:30', 'Social Science', 'Maps', 'x'.repeat(300)),            // the Update row the same day: wins, desc capped at 200
    r('2026-11-09', '09:00', 'Social Science', 'Rivers', 'monday'),
    Object.assign(r('2026-11-09', '16:00', 'Social Science', '', ''), { cwBook: '' }), // a later row with no classwork: not a plan
    r('2026-11-09', '11:00', 'English', 'Colours', 'montessori', 'M-I'),
  ];
  const cmData = { 3: { 'Class 4': [
    { subject: 'Social Studies', chapterNo: 1, chapterName: 'Maps', startDate: '2026-10-20', cwaDate: '2026-11-20' },
    { subject: 'Social Studies', chapterNo: 3, chapterName: 'Forests', startDate: '2026-11-20', cwaDate: '2026-12-05' },
  ] } };
  const out = ctx.tchBuildIndex_({ cwRecords: recs, cmData }, { employees, academic }, [], { campuses: {} }, null, { now: NOW });
  const st = J(out.byCode[C1]);
  assert.deepStrictEqual(st.lastCw['Class 4|socialscience'].map((x) => x.day), ['2026-11-09', '2026-11-07'], 'two newest upload days, newest first');
  assert.deepStrictEqual(st.lastCw['Class 4|socialscience'][0], { day: '2026-11-09', book: 'Book A', chapter: 'Rivers', desc: 'monday' }, 'a row without classwork is skipped');
  assert.strictEqual(st.lastCw['Class 4|socialscience'][1].desc, 'x'.repeat(200), 'the latest row of the day (Update over Save), capped');
  assert.strictEqual(st.loggedDays['2026-11-07'].length, 2, 'loggedDays keeps both rows; counts are per day (below)');
  // join break 3: Course Mapping's "Social Studies" joins the feed's "Social Science"
  assert.strictEqual(ctx.tchSubjKey_('Social Studies'), ctx.tchSubjKey_('Social Science'));
  assert.deepStrictEqual(J(ctx.tchLabel_('Class 4', 'Social Studies')), { cls: 'Class 4', subj: 'Social Science' });
  assert.strictEqual(st.episodes.find((e) => e.ch === 'maps').plannedCwaDate, '2026-11-20', 'the planned CWA date joins');
  assert.deepStrictEqual(st.nextChapters.map((c) => c.name), ['Forests'], 'the next chapter joins');
  // Montessori has no Course Mapping: its episode has no planned date, nothing breaks
  assert.strictEqual(st.episodes.find((e) => e.cls === 'M-I').plannedCwaDate, null);
  assert.deepStrictEqual(st.lastCw['M-I|english'][0].chapter, 'Colours');
}

// ---- tchClasses_: Tue 10 Nov 2026; school days = the working days before today, newest first
const T = (t) => ctx.tchConfig_({ teacher: t || {} });
const TUE = '2026-11-10', NOWMS = at('2026-11-10T05:00:00Z');
const days = []; for (let i = 1; days.length < 21; i++) { const d = new Date(at(TUE + 'T00:00:00Z') - i * DAY).toISOString().slice(0, 10); if (ctx.tchWorkingDay_('LMS4', d, [], {})) days.push(d); }
const logged = {};
const log = (day, cls, subj) => (logged[day] = logged[day] || []).push({ cls, subj, at: 0, hw: false });
// Class 7 Math is timetabled Tue and Thu; logged today and on 3 earlier Tue/Thu (one of them twice: Save + Update) plus one Wed (not due: does not count)
const tueThu = days.filter((d) => [2, 4].includes(new Date(d + 'T00:00:00Z').getUTCDay()));
log(TUE, 'Class 7', 'Math'); tueThu.slice(0, 3).forEach((d) => log(d, 'Class 7', 'Math')); log(tueThu[0], 'Class 7', 'Math');
log(days.find((d) => new Date(d + 'T00:00:00Z').getUTCDay() === 3), 'Class 7', 'Math');
days.slice(0, 5).forEach((d) => log(d, 'Class 6', 'English'));
const MON = days[0];
const state = {
  code: 'NCM/99/01/901', campus: 'LMS4', builtAt: NOWMS,
  classSubjects: [{ cls: 'Class 6', subj: 'English' }, { cls: 'Class 9', subj: 'Science' }],                 // Class 9 Science: an umbrella over the logged Physics
  episodes: [{ cls: 'Class 9', subj: 'Physics', ch: 'motion', name: 'Motion', first: at('2026-11-02T06:00:00Z'), last: at('2026-11-05T06:00:00Z') },
    { cls: 'Class 5', subj: 'Hindi', ch: 'old', name: 'Old', first: at('2026-08-01T06:00:00Z'), last: at('2026-08-05T06:00:00Z') }], // logged too long ago: not taught
  loggedDays: logged,
  lastCw: { 'Class 6|english': [{ day: MON, book: 'Reader', chapter: 'The Kite', desc: 'read p. 4' }], 'Class 7|math': [{ day: '2026-11-05', book: 'B', chapter: 'C', desc: 'D' }] },
  periodsByDay: { Mon: [], Tue: [{ cls: 'Class 7', subj: 'Math' }], Wed: [{ cls: 'Class 9', subj: 'Physics' }], Thu: [{ cls: 'Class 7', subj: 'Math' }, { cls: 'Class 8', subj: 'Science' }], Fri: [], Sat: [] },
};
const WED = '2026-11-11';
const cards = J(ctx.tchClasses_(state, T(), TUE, true, days, MON, WED, NOWMS));
const by = Object.fromEntries(cards.map((c) => [c.cls + ' ' + c.subj, c]));
assert.deepStrictEqual(Object.keys(by).sort(), ['Class 6 English', 'Class 7 Math', 'Class 8 Science', 'Class 9 Physics'], 'taught + timetabled, umbrella covered, stale log out');
assert.deepStrictEqual(by['Class 7 Math'], { cls: 'Class 7', subj: 'Math', scheduledToday: true, periodsTomorrow: false, yesterdayPlan: null,
  last21: { logged: 3, of: tueThu.length, days: 21 } }, 'due on its weekdays only; a Save + Update day counts once; no plan uploaded yesterday');
assert.ok(cards.every((c) => !('loggedToday' in c) && !('go' in c) && !('done' in c)), 'placeholders: nothing claims done, no form link');
assert.strictEqual(by['Class 9 Physics'].periodsTomorrow, true, 'timetabled Wednesday');
assert.deepStrictEqual(by['Class 8 Science'].last21, { logged: 0, of: days.filter((d) => new Date(d + 'T00:00:00Z').getUTCDay() === 4).length, days: 21 });
assert.strictEqual(by['Class 8 Science'].scheduledToday, false, 'timetabled Thu only');
assert.deepStrictEqual(by['Class 6 English'].last21, { logged: 0, of: 0, days: 21 }, 'a timetable with no slot for it: never due, not in the denominator');
assert.deepStrictEqual(by['Class 6 English'].yesterdayPlan, { book: 'Reader', chapter: 'The Kite', desc: 'read p. 4' }, "the previous school day's upload");
// no timetable at all: every class-subject is due every school day, and tomorrow when it is a school day
const noTt = J(ctx.tchClasses_(Object.assign({}, state, { periodsByDay: null }), T(), TUE, true, days, MON, WED, NOWMS));
const eng = noTt.find((c) => c.subj === 'English');
assert.deepStrictEqual(eng.last21, { logged: 5, of: 21, days: 21 }); assert.strictEqual(eng.scheduledToday, true); assert.strictEqual(eng.periodsTomorrow, true);
assert.strictEqual(J(ctx.tchClasses_(Object.assign({}, state, { periodsByDay: null }), T(), TUE, true, days, MON, null, NOWMS)).every((c) => !c.periodsTomorrow), true, 'next day unknown: no periods tomorrow');
assert.strictEqual(J(ctx.tchClasses_(state, T(), TUE, true, days, null, WED, NOWMS)).every((c) => c.yesterdayPlan === null), true, 'previous day unknown: no plan');
assert.strictEqual(J(ctx.tchClasses_(state, T(), TUE, false, days, MON, WED, NOWMS)).every((c) => !c.scheduledToday), true, 'not a working day: nothing scheduled');
assert.deepStrictEqual(J(ctx.tchClasses_(Object.assign({}, state, { lastCw: undefined }), T(), TUE, true, days, MON, WED, NOWMS)).map((c) => c.yesterdayPlan), [null, null, null, null], 'an old state without lastCw');
assert.deepStrictEqual(J(ctx.tchClasses_(null, T(), TUE, true, days, MON, WED, NOWMS)), []);

// ---- teacherclasses: Teacher only, the caller's own state, read-only
const stub = (st) => {
  ctx.tchLoadCfg_ = () => ({ teacher: {} }); ctx.tchStateFor_ = () => st; ctx.tchCodeFor_ = () => 'NCM/99/01/901';
  ctx.tchCalendarEvents_ = () => []; ctx.gameNow_ = () => new Date('2026-11-10T05:00:00Z'); ctx.tchIndexLoading_ = () => false;
  ctx.gameWithLock_ = () => { throw new Error('teacherclasses must not take the lock'); };
};
stub(state);
assert.strictEqual(ctx.GAME_MODULE_ACTIONS.teacherclasses({ roles: ['Staff'], email: 's@x' }).success, false, 'Staff are refused');
assert.strictEqual(ctx.GAME_MODULE_ACTIONS.teacherclasses({ roles: ['Principal'], email: 'p@x' }).success, false, 'a Principal is refused');
let r = J(ctx.GAME_MODULE_ACTIONS.teacherclasses({ roles: ['Teacher'], email: 't@x' }));
assert.strictEqual(r.success, true); assert.strictEqual(r.builtAt, NOWMS);
assert.strictEqual(r.classes.length, 4);
assert.deepStrictEqual(r.classes.find((c) => c.subj === 'Math').last21, { logged: 3, of: tueThu.length, days: 21 });
assert.strictEqual(r.classes.find((c) => c.subj === 'English').yesterdayPlan.chapter, 'The Kite', 'previous school day = Mon 9 Nov');
assert.strictEqual(r.classes.find((c) => c.subj === 'Physics').periodsTomorrow, true, 'next school day = Wed 11 Nov');
// an unreadable calendar (the Today rule): today unknown -> nothing scheduled today; yesterday unknown -> no plan; tomorrow unknown -> no periods
ctx.tchCalendarEvents_ = (campus, day) => (day === TUE || day === MON || day === WED ? null : []);
r = J(ctx.GAME_MODULE_ACTIONS.teacherclasses({ roles: ['Teacher'], email: 't@x' }));
assert.ok(r.classes.every((c) => !c.scheduledToday && !c.periodsTomorrow && c.yesterdayPlan === null));
assert.strictEqual(r.classes[0].last21.days, 21, 'the window reaches further back past an unknown day');
// a holiday tomorrow: the next school day is Thursday
ctx.tchCalendarEvents_ = (campus, day) => (day === WED ? [{ title: 'GH Diwali' }] : []);
r = J(ctx.GAME_MODULE_ACTIONS.teacherclasses({ roles: ['Teacher'], email: 't@x' }));
assert.strictEqual(r.classes.find((c) => c.subj === 'Math').periodsTomorrow, true, 'Thu has Math');
assert.strictEqual(r.classes.find((c) => c.subj === 'Physics').periodsTomorrow, false);
// a long break: fewer school days in the 42-day lookback -> days says so
ctx.tchCalendarEvents_ = (campus, day) => (day < '2026-11-03' ? [{ title: 'GH Winter break' }] : []);
r = J(ctx.GAME_MODULE_ACTIONS.teacherclasses({ roles: ['Teacher'], email: 't@x' }));
assert.strictEqual(r.classes[0].last21.days, 6, 'Tue 3 to Mon 9 Nov, Sunday out');
stub(null);
r = J(ctx.GAME_MODULE_ACTIONS.teacherclasses({ roles: ['Teacher'], email: 't@x' }));
assert.deepStrictEqual([r.success, r.classes, r.builtAt], [true, [], null], 'no state: no cards, no error');
console.log('teacher-classes: ok');
