// node tests/game/test-teacher-quests.js -- Teacher chapter quests, Quest 1 and Quest 2 (game-teacher.gs)
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const dir = __dirname + '/../../apps-script/';
const ctx = { console, Logger: { log() {} } };
vm.createContext(ctx);
const load = (f) => vm.runInContext(fs.readFileSync(dir + f, 'utf8'), ctx);
load('game-teacher.gs'); load('acad-episodes.gs'); load('game.gs'); load('game-actions.gs'); load('game-missions.gs'); load('game-windows.gs'); load('game-quests.gs');
const J = (x) => JSON.parse(JSON.stringify(x));
const CODE = 'NCM/99/01/901', EMAIL = 'teacher@lms.org.in';
const at = (iso) => Date.parse(iso);
const NOW = new Date('2026-11-10T05:00:00Z'), TUE = '2026-11-10'; // Tue, 10:30 IST
const state = (o) => { // classSubjects default to the episodes' class-subjects (the teacher teaches what they logged)
  const st = Object.assign({ code: CODE, campus: 'LMS4', classSubjects: null, episodes: [], loggedDays: {}, periodsByDay: null, nextChapters: [] }, o || {});
  if (!st.classSubjects) st.classSubjects = st.episodes.map((e) => ({ cls: e.cls, subj: e.subj }));
  return st;
};
const ep = (o) => Object.assign({ cls: 'Class 7', subj: 'Math', ch: 'fractions', name: 'Fractions', first: at('2026-11-02T06:00:00Z'), last: at('2026-11-05T06:00:00Z'),
  cwaAt: null, cwaFrom: null, remediatedAt: null, plannedCwaDate: null }, o || {});
const KEY = 'Class 7|Math|fractions';
const plan = { [KEY]: { activity: 'Pizza slices', plannedAt: '2026-11-01' } };
const chapter = (st, plans, matches, cfg, now) => J(ctx.tchChapterQuests_(st, plans || {}, matches || {}, cfg || {}, now || NOW));
const done = (q) => q.steps.map((s) => s.done);
const ids = (q) => q.steps.map((s) => s.id);

// ---- chapter quest: ids, title, five steps
let qs = chapter(state({ episodes: [ep()] }));
assert.strictEqual(qs.length, 1);
assert.strictEqual(qs[0].questId, 'chapter:' + CODE + ':Class 7:Math:fractions');
assert.strictEqual(qs[0].title, 'Class 7 Math · Fractions');
assert.deepStrictEqual(ids(qs[0]), ['plan', 'teach', 'activity', 'cwa', 'remediate']);
assert.deepStrictEqual(qs[0].steps.map((s) => s.title), ['Plan the activity', 'Teach', 'Run the activity', 'Take the CWA', 'Remediate this chapter']);
assert.ok(qs[0].steps.every((s) => s.locked === false && typeof s.go === 'string' && s.go));
assert.deepStrictEqual(done(qs[0]), [false, true, false, false, false]); assert.strictEqual(qs[0].complete, false);

// taught, CWA, same-chapter remediation, but no plan: steps 2, 4, 5 done, step 1 not
const full = ep({ cwaAt: at('2026-11-06T06:00:00Z'), cwaFrom: 'tag', remediatedAt: at('2026-11-09T06:00:00Z') });
qs = chapter(state({ episodes: [full] }));
assert.deepStrictEqual(done(qs[0]), [false, true, false, true, true]); assert.strictEqual(qs[0].complete, false);

// plan + match 0.9 -> step 3 done; 0.5 -> not; matched:false -> not; the threshold comes from config
qs = chapter(state({ episodes: [ep()] }), plan, { [KEY]: { matched: true, confidence: 0.9 } });
assert.deepStrictEqual(done(qs[0]), [true, true, true, false, false]);
assert.strictEqual(qs[0].steps[2].title, 'Run the activity');
qs = chapter(state({ episodes: [ep()] }), plan, { [KEY]: { matched: true, confidence: 0.5 } });
assert.strictEqual(qs[0].steps[2].done, false); assert.strictEqual(qs[0].steps[2].title, 'Run the activity');
qs = chapter(state({ episodes: [ep()] }), plan, { [KEY]: { matched: false, confidence: 0.95 } });
assert.strictEqual(qs[0].steps[2].done, false);
qs = chapter(state({ episodes: [ep()] }), plan, { [KEY]: { matched: true, confidence: 0.5 } }, { teacher: { matchMinConfidence: 0.4 } });
assert.strictEqual(qs[0].steps[2].done, true);

// Ruling 32: "checking overnight" only for {pending:true} (a described note awaits tonight's check), flagged waiting (muted, unlinked in the panel)
qs = chapter(state({ episodes: [ep()] }), plan, { [KEY]: { pending: true } });
assert.strictEqual(qs[0].steps[2].title, 'Run the activity · checking overnight'); assert.strictEqual(qs[0].steps[2].done, false); assert.strictEqual(qs[0].steps[2].waiting, true);
// a plan with no match row at all (nothing described to check yet): plain title, not waiting
qs = chapter(state({ episodes: [ep()] }), plan, {});
assert.strictEqual(qs[0].steps[2].title, 'Run the activity'); assert.strictEqual(qs[0].steps[2].waiting, false);
// no plan: nothing to check, plain title
qs = chapter(state({ episodes: [ep()] }), {}, { [KEY]: { pending: true } });
assert.strictEqual(qs[0].steps[2].title, 'Run the activity'); assert.strictEqual(qs[0].steps[2].waiting, false);
// a checked answer is never waiting
assert.strictEqual(chapter(state({ episodes: [ep()] }), plan, { [KEY]: { matched: false, confidence: 0.4 } })[0].steps[2].waiting, false);
// every chapter quest is parallel (the panel lists them all after the sequential quest); the other steps carry no waiting flag
assert.ok(chapter(state({ episodes: [ep(), ep({ cls: 'Class 8', subj: 'Science', ch: 'light', name: 'Light' })] })).every((q) => q.parallel === true && q.steps.filter((x) => x.waiting !== undefined).length === 1));

// Montessori: steps 1-3 only
const mKey = 'M-II|Hindi|swar';
qs = chapter(state({ episodes: [ep({ cls: 'M-II', subj: 'Hindi', ch: 'swar', name: 'Swar', cwaAt: at('2026-11-06T06:00:00Z') })] }), { [mKey]: { activity: 'x', plannedAt: '2026-11-01' } }, { [mKey]: { matched: true, confidence: 0.9 } });
assert.strictEqual(qs[0].steps.length, 3); assert.deepStrictEqual(ids(qs[0]), ['plan', 'teach', 'activity']);
assert.strictEqual(qs[0].complete, true);

// all done -> complete
qs = chapter(state({ episodes: [full] }), plan, { [KEY]: { matched: true, confidence: 0.9 } });
assert.deepStrictEqual(done(qs[0]), [true, true, true, true, true]); assert.strictEqual(qs[0].complete, true);

// remediation window passed (CWA 1 Nov + 14 d = 15 Nov; today 16 Nov): "Closed without remediation", never complete
const late = ep({ cwaAt: at('2026-11-01T06:00:00Z'), cwaFrom: 'tag' });
qs = chapter(state({ episodes: [late] }), plan, { [KEY]: { matched: true, confidence: 0.9 } }, {}, new Date('2026-11-16T05:00:00Z'));
assert.strictEqual(qs[0].steps[4].title, 'The remediation window has passed'); assert.strictEqual(qs[0].steps[4].done, false); assert.strictEqual(qs[0].complete, false);
qs = chapter(state({ episodes: [late] }), plan, {}, {}, new Date('2026-11-15T05:00:00Z')); // last day of the window: still open
assert.strictEqual(qs[0].steps[4].title, 'Remediate this chapter');
qs = chapter(state({ episodes: [late] }), plan, {}, { teacher: { remediationDays: 5 } }, NOW); // config: 1 Nov + 5 d = 6 Nov
assert.strictEqual(qs[0].steps[4].title, 'The remediation window has passed');
// remediated in time: done even after the window
qs = chapter(state({ episodes: [Object.assign({}, late, { remediatedAt: at('2026-11-08T06:00:00Z') })] }), {}, {}, {}, new Date('2026-12-20T05:00:00Z'));
assert.strictEqual(qs[0].steps[4].done, true);

// one quest per class-subject, for its latest chapter; the next chapter replaces the old quest
const older = ep({ ch: 'decimals', name: 'Decimals', first: at('2026-10-01T06:00:00Z'), last: at('2026-10-10T06:00:00Z'), cwaAt: at('2026-10-09T06:00:00Z') });
const sci = ep({ cls: 'Class 8', subj: 'Science', ch: 'light', name: 'Light', last: at('2026-11-04T06:00:00Z') });
qs = chapter(state({ episodes: [older, ep(), sci] }));
assert.deepStrictEqual(qs.map((q) => q.questId), ['chapter:' + CODE + ':Class 7:Math:fractions', 'chapter:' + CODE + ':Class 8:Science:light']);
assert.deepStrictEqual(chapter(state()), []); assert.deepStrictEqual(chapter(null), []);

// Ruling 21 (replaces 20a): taught = on the roster (umbrella-snapped) OR logged within teacher.taughtLookbackDays (30)
const old = (o) => ep(Object.assign({ last: at('2026-08-01T06:00:00Z') }, o));       // 100 days before NOW
const hist = { cls: 'Class 8', subj: 'History', ch: 'mughals', name: 'Mughals' };
const art = (days) => ep({ cls: 'Class 3', subj: 'Art & Craft', ch: 'collage', name: 'Collage', last: NOW.getTime() - days * 86400000 });
const SS = [{ cls: 'Class 8', subj: 'Social Science' }];
assert.strictEqual(chapter(state({ episodes: [old(hist)], classSubjects: SS })).length, 1);                    // roster Social Science covers feed History, however long ago
assert.strictEqual(chapter(state({ episodes: [old(Object.assign({}, hist, { subj: 'Geography' }))], classSubjects: SS })).length, 1);
assert.strictEqual(chapter(state({ episodes: [old(hist)], classSubjects: [{ cls: 'Class 7', subj: 'Social Science' }] })).length, 0);   // another class: not covered
assert.strictEqual(chapter(state({ episodes: [old({ cls: 'Class 8', subj: 'Science', ch: 'x', name: 'X' })], classSubjects: SS })).length, 0);   // Social Science does not cover Science
assert.strictEqual(chapter(state({ episodes: [art(10)], classSubjects: [] })).length, 1);                      // not on the roster, logged 10 days ago
assert.strictEqual(chapter(state({ episodes: [art(40)], classSubjects: [] })).length, 0);                      // 40 days ago, not on the roster
assert.strictEqual(chapter(state({ episodes: [art(10)], classSubjects: [] }), {}, {}, { teacher: { taughtLookbackDays: 5 } }).length, 0);   // the window comes from config
assert.strictEqual(chapter(state({ episodes: [art(40)], classSubjects: [] }), {}, {}, { teacher: { taughtLookbackDays: 60 } }).length, 1);
qs = chapter(state({ episodes: [ep(), old(Object.assign({}, hist))], classSubjects: [{ cls: 'Class 7', subj: 'Math' }] }));                  // mixed: only the taught one
assert.deepStrictEqual(qs.map((q) => q.questId), ['chapter:' + CODE + ':Class 7:Math:fractions']);

// Ruling 20b: a tracker-only CWA (remediatedAt is always null) is never "Closed without remediation"
qs = chapter(state({ episodes: [Object.assign({}, late, { cwaFrom: 'tracker' })] }), plan, {}, {}, new Date('2026-12-20T05:00:00Z'));
assert.strictEqual(qs[0].steps[3].done, true);
assert.strictEqual(qs[0].steps[4].title, 'Remediate this chapter'); assert.strictEqual(qs[0].steps[4].done, false);

// Ruling 18: through tchBuildIndex_, a Montessori chapter and a chapter with a single entry (both dropped by the Owner's engine rules) get chapter quests
{
  const D0 = Date.UTC(2026, 10, 1), C5 = 'NCM/99/01/905', DAY = 86400000;
  const roster = { employees: [{ employeeCode: C5, name: 'T Five', school: 'LMS 4' }], academic: [
    { employeeCode: C5, school: 'LMS 4', class: 'M-II', subject: 'Hindi' }, { employeeCode: C5, school: 'LMS 4', class: 'Class 7', subject: 'Science' }] };
  let n = 0;
  const r = (cls, subj, ch, tag, d) => ({ lmsIdx: 3, classMapped: cls, subject: subj, teacher: 'T Five', cwChapter: ch, cwTag: tag, hwDesc: '', hwTag: '', timeMs: D0 + d * DAY + n++, dateStr: new Date(D0 + d * DAY).toISOString().slice(0, 10) });
  const feed = { cwRecords: [r('M-II', 'Hindi', 'Swar', 'Chapter Teaching', 1), r('M-II', 'Hindi', 'Swar', 'Activity', 2), r('Class 7', 'Science', 'Light', 'Chapter Teaching', 3)], cmData: {} };
  const built = J(ctx.tchBuildIndex_(feed, roster, [], null, null, { now: D0 + 5 * DAY }).byCode[C5]);
  const cq = J(ctx.tchChapterQuests_(built, {}, {}, {}, new Date(D0 + 5 * DAY)));
  assert.deepStrictEqual(cq.map((q) => q.title).sort(), ['Class 7 Science \u00b7 Light', 'M-II Hindi \u00b7 Swar']);
  assert.strictEqual(cq.filter((q) => /^M-II/.test(q.title))[0].steps.length, 3);
  assert.strictEqual(cq.filter((q) => /^Class 7/.test(q.title))[0].steps.length, 5);
  // the Owner's rules are unchanged: no flag, no Montessori episode and no one-entry episode
  assert.strictEqual(J(ctx.ownAcadEpisodes_(feed.cwRecords, {})).length, 0);
  assert.strictEqual(J(ctx.ownAcadEpisodes_(feed.cwRecords, { includeMClasses: true, minEpisodePeriods: 1 })).length, 2);
}

// ---- setup quests: Quest 1 "Your portal"
const day = (...es) => ({ [TUE]: es.map((e) => Object.assign({ cls: 'Class 7', subj: 'Math', at: at(TUE + 'T04:00:00Z'), hw: false }, e)) });
const setup = (st, plans, days, cfg, now, rec) => J(ctx.tchSetupQuests_(st, plans || {}, days === undefined ? { onTrack: 0 } : days, cfg || {}, now || NOW, rec || {}));
let sq = setup(state());
assert.strictEqual(sq[0].title, 'Your portal');
assert.deepStrictEqual(sq[0].steps.map((s) => [s.id, s.title]), [['cw_today', "Log today's classwork"], ['hw_today', "Log today's homework"], ['plan_one', 'Plan the activity for your next chapter'], ['days_5', 'Five days on track']]);
assert.deepStrictEqual(done(sq[0]), [false, false, false, false]);
// "plan one" opens the plan page on a chapter (never the bare page, which has nothing to plan): the first upcoming chapter without a plan
const planGo = (st, plans) => setup(st, plans)[0].steps[2].go;
assert.strictEqual(planGo(state()), 'teacher/index.html');                                                       // no upcoming chapter: the teacher's page
const nx = (ch, name) => ({ cls: 'Class 7', subj: 'Math', ch, name, startDate: '2026-11-20' });
assert.strictEqual(planGo(state({ nextChapters: [nx('ratio', 'Ratio & Proportion'), nx('angles', 'Angles')] })), 'teacher/plan-activity.html?cls=Class%207&subj=Math&ch=ratio&name=Ratio%20%26%20Proportion');
assert.strictEqual(planGo(state({ nextChapters: [nx('ratio', 'Ratio'), nx('angles', 'Angles')] }), { 'Class 7|Math|ratio': { activity: 'x', plannedAt: '2026-11-01' } }), 'teacher/plan-activity.html?cls=Class%207&subj=Math&ch=angles&name=Angles');
assert.strictEqual(planGo(state({ nextChapters: [nx('ratio', 'Ratio')] }), { 'Class 7|Math|ratio': { activity: 'x', plannedAt: '2026-11-01' } }), 'teacher/plan-activity.html?cls=Class%207&subj=Math&ch=ratio&name=Ratio');
sq = setup(state({ loggedDays: day({}) }));
assert.deepStrictEqual(done(sq[0]), [true, false, false, false]);                       // an entry without HW: classwork only
sq = setup(state({ loggedDays: day({}, { subj: 'Hindi', hw: true }) }), plan, { onTrack: 4 });
assert.deepStrictEqual(done(sq[0]), [true, true, true, false]);
sq = setup(state({ loggedDays: { '2026-11-09': [{ cls: 'Class 7', subj: 'Math', at: 1, hw: true }] } }));
assert.deepStrictEqual(done(sq[0]), [false, false, false, false]);                      // yesterday's entry is not today's
sq = setup(state({ loggedDays: day({ hw: true }) }), plan, { onTrack: 5 });
assert.deepStrictEqual(done(sq[0]), [true, true, true, true]); assert.strictEqual(sq[0].complete, true);
sq = setup(state({ loggedDays: day({ hw: true }) }), plan, { onTrack: 3 }, { teacher: { questDays: 3 } });
assert.strictEqual(sq[0].steps[3].done, true);                                           // the day count comes from config
assert.strictEqual(sq[0].steps[3].title, 'Three days on track'); assert.strictEqual(setup(state(), {}, undefined, { teacher: { questDays: 12 } })[0].steps[3].title, '12 days on track');
assert.strictEqual(setup(state(), {}, undefined, { teacher: { questDays: 1 } })[0].steps[3].title, 'One day on track');

// Quest 2 "Plan your term's activities": one per class-subject with upcoming chapters, locked until Quest 1 is complete
const nxt = (o) => Object.assign({ cls: 'Class 7', subj: 'Math', ch: 'ratio', name: 'Ratio', startDate: '2026-11-20' }, o);
const nextState = (extra) => state(Object.assign({ nextChapters: [nxt(), nxt({ ch: 'angles', name: 'Angles', startDate: '2026-12-01' }), nxt({ cls: 'Class 8', subj: 'Science', ch: 'sound', name: 'Sound' })] }, extra));
sq = setup(nextState());
assert.strictEqual(sq.length, 3);
assert.strictEqual(sq[1].questId, 'term:' + CODE + ':Class 7:Math'); assert.strictEqual(sq[1].title, "Plan your term's activities · Class 7 Math");
assert.deepStrictEqual(sq[1].steps.map((s) => s.title), ['Plan the activity for Ratio', 'Plan the activity for Angles']);
assert.ok(sq[1].steps.every((s) => s.locked && !s.done) && sq[2].steps.every((s) => s.locked));   // Quest 1 not complete
const q1done = { loggedDays: day({ hw: true }) };
const plans2 = { 'Class 7|Math|ratio': { activity: 'a', plannedAt: '2026-11-02' }, [KEY]: { activity: 'b', plannedAt: '2026-11-02' } };
sq = setup(nextState(q1done), plans2, { onTrack: 5 });
assert.strictEqual(sq[0].complete, true);
assert.ok(sq[1].steps.every((s) => !s.locked)); assert.deepStrictEqual(done(sq[1]), [true, false]); assert.strictEqual(sq[1].complete, false);
sq = setup(nextState(q1done), Object.assign({ 'Class 7|Math|angles': { activity: 'c', plannedAt: '2026-11-02' } }, plans2), { onTrack: 5 });
assert.strictEqual(sq[1].complete, true); assert.strictEqual(sq[2].complete, false);
// nothing to plan: no Quest 2 for that class-subject; an optional term end drops later chapters
assert.strictEqual(setup(state()).length, 1);
sq = setup(nextState(q1done), plans2, { onTrack: 5 }, { teacher: { quests: { termEnd: '2026-11-30' } } });
assert.deepStrictEqual(sq[1].steps.map((s) => s.id), ['plan:ratio']); assert.strictEqual(sq[1].complete, true);

// Ruling 19: a recorded '<questId>:_done' keeps Quest 2 complete with the steps it finished with, however the window slides
const Q2ID = 'term:' + CODE + ':Class 7:Math';
const slid = nextState({ nextChapters: [nxt({ ch: 'volume', name: 'Volume', startDate: '2026-12-10' })] });
sq = setup(slid, {}, { onTrack: 0 }, {}, NOW, { 'teacher1:cw_today': 'done', 'teacher1:hw_today': 'done', 'teacher1:plan_one': 'done', 'teacher1:days_5': 'done', [Q2ID + ':_done']: JSON.stringify([{ id: 'plan:ratio', title: 'Plan the activity for Ratio' }, { id: 'plan:angles', title: 'Plan the activity for Angles' }]) });
const q2 = sq.filter((q) => q.questId === Q2ID)[0];
assert.strictEqual(q2.complete, true); assert.deepStrictEqual(q2.steps.map((s) => s.title), ['Plan the activity for Ratio', 'Plan the activity for Angles']); assert.ok(q2.steps.every((s) => s.done && !s.locked));
// the same chapter list without the record is NOT complete (so the record is what keeps it so)
assert.strictEqual(setup(slid, {}, { onTrack: 0 }, {}, NOW, { 'teacher1:cw_today': 'done', 'teacher1:hw_today': 'done', 'teacher1:plan_one': 'done', 'teacher1:days_5': 'done' }).filter((q) => q.questId === Q2ID)[0].complete, false);

// sticky: recorded steps stay done (and Quest 2 stays unlocked) even when the data no longer says so
sq = setup(nextState(), {}, { onTrack: 0 }, {}, NOW, { 'teacher1:cw_today': true, 'teacher1:hw_today': true, 'teacher1:plan_one': true, 'teacher1:days_5': true, ['term:' + CODE + ':Class 7:Math:plan:ratio']: true });
assert.strictEqual(sq[0].complete, true); assert.deepStrictEqual(done(sq[1]), [true, false]); assert.ok(sq[1].steps.every((s) => !s.locked));

// ---- the wiring: GAME_MODULE_QUESTS.Teacher (runs inside gameWithLock_ in gameToday_: cache-only state, appends under the caller's lock)
assert.strictEqual(typeof ctx.GAME_MODULE_QUESTS.Teacher, 'function');
const store = new Map();
ctx.CacheService = { getScriptCache: () => ({ get: (k) => (store.has(k) ? store.get(k) : null), put: (k, v) => { store.set(k, v); }, remove: (k) => store.delete(k) }) };
ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: () => 'GAME_BOOK' }) };
const sheetOf = (rows) => ({
  rows: rows.map((r) => r.slice()), formats: 0,
  getDataRange() { return { getValues: () => this.rows.map((r) => r.slice()) }; },
  getLastRow() { return this.rows.length; },
  getRange(row, col, nr, nc) { const sh = this; const rg = { setNumberFormat() { sh.formats++; return rg; }, setValues(v) { v.forEach((r, i) => { sh.rows[row - 1 + i] = r.slice(); }); return rg; } }; return rg; },
});
const prog = sheetOf([['Email', 'Kind', 'Key', 'Value', 'At']]);
const daily = sheetOf([['Day', 'Email', 'a', 'b', 'c', 'd', 'Finalized', 'OnTrack']]
  .concat(['03', '04', '05', '06', '09'].map((d) => ['2026-11-' + d, EMAIL, '', '', '', '', true, true]))
  .concat([['2026-11-02', EMAIL, '', '', '', '', true, false], ['2026-10-30', EMAIL, '', '', '', '', true, true], ['2026-11-03', 'other@lms.org.in', '', '', '', '', true, true]]));
ctx.SpreadsheetApp = { openById: () => ({ getSheetByName: (n) => ({ 'Game Progress': prog, 'Game Daily': daily })[n] }) };
const caller = { email: 'Teacher@LMS.org.in', employeeCode: CODE, primaryRole: 'Teacher' };
const fw = { teacher: {} };
store.set('tch_' + CODE, JSON.stringify(nextState(Object.assign({ episodes: [ep()] }, q1done))));
let out = J(ctx.GAME_MODULE_QUESTS.Teacher(caller, fw, NOW));
assert.deepStrictEqual(out.map((q) => q.questId), ['teacher1', 'term:' + CODE + ':Class 7:Math', 'term:' + CODE + ':Class 8:Science', 'chapter:' + CODE + ':Class 7:Math:fractions']);   // setup first, then chapter quests
assert.deepStrictEqual(done(out[0]), [true, true, false, true]);                           // 5 on-track days this month (Nov 3, 4, 5, 6, 9); not October's, not another person's
assert.deepStrictEqual(J(prog.rows.slice(1).map((r) => r.slice(0, 4))), [[EMAIL, 'quest_step', 'teacher1:cw_today', 'done'], [EMAIL, 'quest_step', 'teacher1:hw_today', 'done'], [EMAIL, 'quest_step', 'teacher1:days_5', 'done']]);
assert.ok(prog.rows.slice(1).every((r) => !isNaN(Date.parse(r[4]))));
// the same load again appends nothing; a step done earlier stays done after the data goes
out = J(ctx.GAME_MODULE_QUESTS.Teacher(caller, fw, NOW)); assert.strictEqual(prog.rows.length, 4);
store.set('tch_' + CODE, JSON.stringify(nextState({ episodes: [ep()] })));                 // today's entries are gone (e.g. a new day)
daily.rows = daily.rows.slice(0, 1);                                                       // and the on-track days
out = J(ctx.GAME_MODULE_QUESTS.Teacher(caller, fw, new Date('2026-11-11T05:00:00Z')));
assert.deepStrictEqual(done(out[0]), [true, true, false, true]); assert.strictEqual(prog.rows.length, 4);
// Ruling 19 through the hook: Quest 2 completes -> one '<questId>:_done' row (Value = its step titles); the window then slides: still complete, no second row
prog.rows = prog.rows.slice(0, 1);
daily.rows = [daily.rows[0]].concat(['03', '04', '05', '06', '09'].map((d) => ['2026-11-' + d, EMAIL, '', '', '', '', true, true]));
ctx.tchPlansFor_ = () => ({ 'Class 7|Math|ratio': { activity: 'a', plannedAt: '2026-11-02' }, 'Class 7|Math|angles': { activity: 'b', plannedAt: '2026-11-02' } });
const two = (nc) => state({ loggedDays: day({ hw: true }), nextChapters: nc, classSubjects: [{ cls: 'Class 7', subj: 'Math' }] });
store.set('tch_' + CODE, JSON.stringify(two([nxt(), nxt({ ch: 'angles', name: 'Angles', startDate: '2026-12-01' })])));
out = J(ctx.GAME_MODULE_QUESTS.Teacher(caller, fw, NOW));
const keysOf = () => J(prog.rows.slice(1).map((r) => r[2]));
assert.deepStrictEqual(keysOf(), ['teacher1:cw_today', 'teacher1:hw_today', 'teacher1:plan_one', 'teacher1:days_5', 'term:' + CODE + ':Class 7:Math:plan:ratio', 'term:' + CODE + ':Class 7:Math:plan:angles', 'term:' + CODE + ':Class 7:Math:_done']);
assert.deepStrictEqual(J(JSON.parse(prog.rows[7][3])), [{ id: 'plan:ratio', title: 'Plan the activity for Ratio' }, { id: 'plan:angles', title: 'Plan the activity for Angles' }]);
assert.strictEqual(out[1].complete, true);
store.set('tch_' + CODE, JSON.stringify(two([nxt({ ch: 'volume', name: 'Volume', startDate: '2026-12-10' })])));   // ratio and angles have started; Volume is next
out = J(ctx.GAME_MODULE_QUESTS.Teacher(caller, fw, new Date('2026-12-02T05:00:00Z')));
assert.strictEqual(out[1].questId, Q2ID); assert.strictEqual(out[1].complete, true);
assert.deepStrictEqual(out[1].steps.map((x) => x.title), ['Plan the activity for Ratio', 'Plan the activity for Angles']);
assert.strictEqual(keysOf().length, 7);                                                    // nothing appended, no second _done
// peek: the same quests, nothing written
{
  const keep = prog.rows, kept = store.get('tch_' + CODE);
  prog.rows = keep.slice(0, 1); store.set('tch_' + CODE, JSON.stringify(nextState(Object.assign({ episodes: [ep()] }, q1done))));
  const pk = J(ctx.GAME_MODULE_QUESTS.Teacher(caller, fw, NOW, { peek: true }));
  assert.ok(pk.length > 0); assert.strictEqual(prog.rows.length, 1, 'peek appends no rows');
  ctx.GAME_MODULE_QUESTS.Teacher(caller, fw, NOW, { peek: false }); assert.ok(prog.rows.length > 1);
  prog.rows = keep.slice(0, 1); ctx.GAME_MODULE_QUESTS.Teacher(caller, fw, NOW); assert.ok(prog.rows.length > 1, 'no opts: writes as before');
  prog.rows = keep; store.set('tch_' + CODE, kept);
}
// no state (or no code): no quests, no writes, no refresh
store.delete('tch_' + CODE);
assert.deepStrictEqual(J(ctx.GAME_MODULE_QUESTS.Teacher(caller, fw, NOW)), []);
assert.deepStrictEqual(J(ctx.GAME_MODULE_QUESTS.Teacher({ email: 'x@lms.org.in', primaryRole: 'Teacher' }, fw, NOW)), []);
assert.strictEqual(prog.rows.length, 8);
console.log('teacher quests OK');
