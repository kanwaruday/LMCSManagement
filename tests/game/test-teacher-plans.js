// node tests/game/test-teacher-plans.js -- planned activities: teacherplanactivity / teacherplans / tchPlansFor_ (game-teacher.gs)
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const dir = __dirname + '/../../apps-script/';
const store = new Map(), events = [], logs = [];
const book = { tabs: {}, getSheetByName: (n) => book.tabs[n] || null, insertSheet: (n) => (book.tabs[n] = fakeSheet([])) };
function fakeSheet(rows) {
  const sh = {
    rows, appendRow: (r) => { sh.rows.push(r.slice()); },
    getDataRange: () => ({ getValues: () => sh.rows.map((r) => r.slice()) }),
    getLastRow: () => sh.rows.length,
    getRange: (row, col, nr, nc) => {
      const rg = { setNumberFormat: () => rg, setValues: (vals) => { vals.forEach((v, i) => { const r = sh.rows[row - 1 + i] = sh.rows[row - 1 + i] || []; v.forEach((x, j) => { r[col - 1 + j] = x; }); }); return rg; } };
      return rg;
    },
  };
  return sh;
}
const ctx = {
  console, Logger: { log: (m) => logs.push(String(m)) },
  CacheService: { getScriptCache: () => ({ get: (k) => (store.has(k) ? store.get(k) : null), put: (k, v) => { store.set(k, v); }, remove: (k) => { store.delete(k); } }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'GAME_BOOK' }) },
  SpreadsheetApp: { openById: () => book },
  LockService: { getScriptLock: () => ({ waitLock: () => events.push('lock'), releaseLock: () => events.push('unlock') }) },
};
vm.createContext(ctx);
const load = (f) => vm.runInContext(fs.readFileSync(dir + f, 'utf8'), ctx);
load('game-teacher.gs'); load('acad-episodes.gs'); load('game.gs'); load('game-actions.gs'); load('game-missions.gs'); load('game-windows.gs'); load('game-quests.gs');
const J = (x) => JSON.parse(JSON.stringify(x));
const CODE = 'NCM/99/01/901', OTHER = 'NCM/99/01/902', EMAIL = 'teacher@lms.org.in';
const TAB = 'Teacher Planned Activities';
const HEADER = ['Code', 'Campus', 'Class', 'Subject', 'ChapterNorm', 'Chapter', 'Activity', 'PlannedAt', 'UpdatedAt'];
const NOW = new Date('2026-11-10T05:00:00Z');
const at = (iso) => Date.parse(iso);
const caller = (o) => Object.assign({ email: EMAIL, campusId: 'LMS4', roles: ['Teacher'], primaryRole: 'Teacher', canDecide: false, employeeCode: CODE }, o || {});
const state = (o) => Object.assign({ code: CODE, campus: 'LMS4', classSubjects: [{ cls: 'Class 7', subj: 'Math' }, { cls: 'Class 9', subj: 'Social Science' }],
  episodes: [{ cls: 'Class 7', subj: 'Math', ch: 'fractions', name: 'Fractions', first: at('2026-11-02T06:00:00Z'), last: at('2026-11-05T06:00:00Z'), cwaAt: null, cwaFrom: null, remediatedAt: null, plannedCwaDate: null },
    { cls: 'Class 8', subj: 'Science', ch: 'cells', name: 'Cells', first: at('2026-11-02T06:00:00Z'), last: at('2026-11-06T06:00:00Z'), cwaAt: null, cwaFrom: null, remediatedAt: null, plannedCwaDate: null },
    { cls: 'Class 6', subj: 'English', ch: 'old story', name: 'Old story', first: at('2026-08-02T06:00:00Z'), last: at('2026-08-05T06:00:00Z'), cwaAt: null, cwaFrom: null, remediatedAt: null, plannedCwaDate: null },
    { cls: 'Class 9', subj: 'History', ch: 'french revolution', name: 'French Revolution', first: at('2026-11-02T06:00:00Z'), last: at('2026-09-01T06:00:00Z'), cwaAt: null, cwaFrom: null, remediatedAt: null, plannedCwaDate: null }],
  loggedDays: {}, periodsByDay: null, nextChapters: [] }, o || {});
store.set('tch_' + CODE, JSON.stringify(state()));
store.set('tch_meta', JSON.stringify({ codes: [CODE], builtAt: NOW.getTime() }));
ctx.gameNow_ = () => NOW;
const act = ctx.GAME_MODULE_ACTIONS;
const post = (p, c) => J(act.teacherplanactivity(c || caller(), Object.assign({ cls: 'Class 7', subj: 'Math', ch: 'Fractions!', activity: '  Pizza slices  ' }, p || {})));
const rows = () => (book.tabs[TAB] ? book.tabs[TAB].rows : null);

// ---- registered; nothing written before a save, tchPlansFor_ is {} with no tab
assert.strictEqual(typeof act.teacherplanactivity, 'function'); assert.strictEqual(typeof act.teacherplans, 'function');
assert.deepStrictEqual(J(ctx.tchPlansFor_(CODE)), {}); assert.strictEqual(rows(), null);

// ---- first save: tab created lazily with the exact header, one row, activity trimmed, lock taken only around the write
assert.deepStrictEqual(post(), { success: true });
assert.deepStrictEqual(rows()[0], HEADER); assert.strictEqual(rows().length, 2);
let r = rows()[1];
assert.deepStrictEqual(r.slice(0, 7), [CODE, 'LMS4', 'Class 7', 'Math', 'fractions', 'Fractions!', 'Pizza slices']);
assert.ok(r[7] && r[8] && r[7] === r[8]); assert.ok(!isNaN(Date.parse(r[7])));
assert.deepStrictEqual(events, ['lock', 'unlock']);

// ---- tchPlansFor_ sees the write at once, in the shape the quests read
let plans = J(ctx.tchPlansFor_(CODE));
assert.deepStrictEqual(Object.keys(plans), ['Class 7|Math|fractions']);
assert.strictEqual(plans['Class 7|Math|fractions'].activity, 'Pizza slices'); assert.strictEqual(plans['Class 7|Math|fractions'].plannedAt, r[7]);

// ---- KEY MATCH: the saved plan ticks step 1 of the same chapter's quest (tchChapterQuests_), and Quest 1's "plan one" step
const quest = () => J(ctx.tchChapterQuests_(state(), ctx.tchPlansFor_(CODE), {}, {}, NOW)).filter((q) => q.title.indexOf('Class 7 Math') === 0)[0];
assert.strictEqual(quest().steps[0].id, 'plan'); assert.strictEqual(quest().steps[0].done, true);
// the link the quest hands out (chapter = the quest's normalised key) saves onto the very same key
const goQs = new URLSearchParams(ctx.tchPlanGo_('Class 7', 'Math', 'fractions').split('?')[1]);
assert.deepStrictEqual(post({ cls: goQs.get('cls'), subj: goQs.get('subj'), ch: goQs.get('ch'), activity: 'Cut a pizza' }), { success: true });
assert.strictEqual(rows().length, 2); // same key: still one row

// ---- upsert: one row, activity and UpdatedAt change, PlannedAt keeps the first save; the old tchPlansFor_ answer is busted
const planned = rows()[1][7];
ctx.gameNow_ = () => new Date('2026-11-11T05:00:00Z');
assert.deepStrictEqual(post({ activity: 'Fraction bars' }), { success: true });
assert.strictEqual(rows().length, 2); r = rows()[1];
assert.strictEqual(r[6], 'Fraction bars'); assert.strictEqual(r[7], planned); assert.strictEqual(r[8], '2026-11-11T05:00:00.000Z'); assert.notStrictEqual(r[8], r[7]);
plans = J(ctx.tchPlansFor_(CODE)); assert.strictEqual(plans['Class 7|Math|fractions'].activity, 'Fraction bars');

// ---- a different chapter is a second row; another teacher's row is untouched by this caller and not returned
assert.deepStrictEqual(post({ ch: 'Decimals', activity: 'Money games' }), { success: true });
assert.strictEqual(rows().length, 3);
book.tabs[TAB].rows.push([OTHER, 'LMS4', 'Class 7', 'Math', 'fractions', 'Fractions', 'Theirs', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z']);
assert.deepStrictEqual(Object.keys(J(ctx.tchPlansFor_(CODE))).sort(), ['Class 7|Math|decimals', 'Class 7|Math|fractions']);
assert.strictEqual(J(ctx.tchPlansFor_(OTHER))['Class 7|Math|fractions'].activity, 'Theirs');
// a code in the params is ignored: the caller's own code decides whose row is written
assert.deepStrictEqual(post({ code: OTHER, employeeCode: OTHER, activity: 'Still mine' }), { success: true });
assert.strictEqual(rows()[3][6], 'Theirs'); assert.strictEqual(rows()[1][6], 'Still mine');

// ---- GET teacherplans: the caller's rows only
let got = J(act.teacherplans(caller(), {}));
assert.strictEqual(got.success, true); assert.strictEqual(got.plans.length, 2);
assert.ok(got.plans.every((p) => p.activity !== 'Theirs'));
assert.deepStrictEqual(Object.keys(got.plans[0]).sort(), ['activity', 'chapter', 'chapterNorm', 'cls', 'plannedAt', 'subj', 'updatedAt']);

// ---- validation: activity 3-200 chars after trim
const before = rows().length, ev = events.length;
['x', '  a ', 'ab', '', null, undefined, '   '].forEach((a) => assert.deepStrictEqual(post({ activity: a }), { success: false, error: 'Write the activity in a few words.' }));
assert.deepStrictEqual(post({ activity: 'y'.repeat(201) }), { success: false, error: 'Write the activity in a few words.' });
assert.deepStrictEqual(post({ activity: 'y'.repeat(200) }), { success: true }); assert.deepStrictEqual(post({ activity: 'abc' }), { success: true });
assert.strictEqual(rows().length, before);
// bad input never reaches the lock
assert.strictEqual(events.length - ev, 4);

// ---- taught rule: roster, umbrella, recent log; not a class-subject the caller does not teach
const notMine = { success: false, error: "That class isn't on your list." };
assert.deepStrictEqual(post({ cls: 'Class 10', subj: 'Math' }), notMine);                       // nowhere
assert.deepStrictEqual(post({ cls: 'Class 6', subj: 'English', ch: 'Old story' }), notMine);     // logged, but 3 months ago
assert.deepStrictEqual(post({ cls: 'Class 7', subj: 'Hindi' }), notMine);
assert.deepStrictEqual(post({ cls: '', subj: 'Math' }), notMine);
assert.deepStrictEqual(post({ cls: 'Class 8', subj: 'Science', ch: 'Cells', activity: 'Onion peel' }), { success: true }); // not on roster, logged this month
assert.deepStrictEqual(post({ cls: 'Class 9', subj: 'History', ch: 'French Revolution', activity: 'Role play' }), { success: true }); // roster Social Science covers History
assert.deepStrictEqual(post({ cls: 'Class 7', subj: 'Maths', ch: 'Fractions', activity: 'Pizza again' }), { success: true }); // spelling differs: stored under the quest's own spelling
assert.strictEqual(Object.keys(J(ctx.tchPlansFor_(CODE))).filter((k) => k.indexOf('Class 7|Math|fractions') === 0).length, 1);
assert.ok(rows().every((x, i) => i === 0 || ['Math', 'Science', 'History'].indexOf(x[3]) !== -1));
// an upcoming chapter's class-subject (Quest 2's link) is taught too
store.set('tch_' + CODE, JSON.stringify(state({ nextChapters: [{ cls: 'Class 5', subj: 'EVS', ch: 'plants', name: 'Plants', startDate: '2026-11-20' }] })));
assert.deepStrictEqual(post({ cls: 'Class 5', subj: 'EVS', ch: 'plants', activity: 'Seed pots' }), { success: true });
store.set('tch_' + CODE, JSON.stringify(state()));
// the lookback is config: teacher.taughtLookbackDays is read through tchConfig_ (default 30; 120 covers the August log)
assert.strictEqual(ctx.tchTaught_(state(), ctx.tchConfig_({ teacher: { taughtLookbackDays: 120 } }), 'Class 6', 'English', NOW.getTime()), true);
assert.strictEqual(ctx.tchTaught_(state(), ctx.tchConfig_({}), 'Class 6', 'English', NOW.getTime()), false);

// ---- who may write: Teacher only, with a code and a state
const noWrite = (c, p) => { const n = rows().length; const res = post(p, c); assert.strictEqual(res.success, false); assert.strictEqual(rows().length, n); return res.error; };
noWrite(caller({ roles: ['Owner'], primaryRole: 'Owner' }));
noWrite(caller({ roles: ['Principal'], primaryRole: 'Principal' }));
noWrite(caller({ roles: ['Teacher', 'Owner'], primaryRole: 'Owner', employeeCode: undefined, email: 'owner-no-code@lms.org.in' }), {}); // roles ok but no employee code
store.set('tch_code_nostate@lms.org.in', JSON.stringify({ code: 'NCM/99/01/999' }));
store.set('tch_meta', JSON.stringify({ codes: [CODE], builtAt: NOW.getTime() })); // meta says this code has no state: no refresh, no state
noWrite(caller({ email: 'nostate@lms.org.in', employeeCode: undefined }));
assert.deepStrictEqual(J(act.teacherplans(caller({ roles: ['Owner'], primaryRole: 'Owner' }), {})).success, false);

// ---- ordering: the state is read (it may refresh the feed) BEFORE the script lock, never inside it
let lockHeld = false, stateInLock = null;
ctx.CacheService.getScriptCache = (orig => () => { const c = orig(); return { get: (k) => { if (k === 'tch_' + CODE) stateInLock = stateInLock || lockHeld; return c.get(k); }, put: c.put, remove: c.remove }; })(ctx.CacheService.getScriptCache);
ctx.LockService = { getScriptLock: () => ({ waitLock: () => { lockHeld = true; }, releaseLock: () => { lockHeld = false; } }) };
assert.deepStrictEqual(post({ activity: 'Order check' }), { success: true });
assert.strictEqual(stateInLock, false);

// ---- plan links carry the chapter's display name next to its key (the page heading shows `name`, a save still files under `ch`)
{
  const NAME = 'Ratio & Proportion', KEYCH = ctx.ownAcadNormChapter_(NAME); // 'ratio proportion'
  assert.notStrictEqual(KEYCH, NAME);
  const st = state({ episodes: [{ cls: 'Class 7', subj: 'Math', ch: KEYCH, name: NAME, first: at('2026-11-02T06:00:00Z'), last: at('2026-11-05T06:00:00Z'), cwaAt: null, cwaFrom: null, remediatedAt: null, plannedCwaDate: null }],
    nextChapters: [{ cls: 'Class 7', subj: 'Math', ch: 'decimals', name: 'Decimals & Place Value', startDate: '2026-11-12' }] });
  store.set('tch_' + CODE, JSON.stringify(st));
  const query = (go) => { const i = go.indexOf('?'); return { path: go.slice(0, i), raw: go.slice(i + 1), qs: new URLSearchParams(go.slice(i + 1)) }; };
  const q = J(ctx.tchChapterQuests_(st, ctx.tchPlansFor_(CODE), {}, {}, NOW)).filter((x) => x.title === 'Class 7 Math \u00b7 ' + NAME)[0];
  const link = query(q.steps[0].go);
  assert.strictEqual(link.path, 'teacher/plan-activity.html');
  assert.strictEqual(link.qs.get('ch'), KEYCH); assert.strictEqual(link.qs.get('name'), NAME);
  assert.ok(link.raw.indexOf('name=Ratio%20%26%20Proportion') !== -1);                      // URL-encoded
  // the mission and Quest 2's steps carry both too
  const ms = J(ctx.tchMissions_(st, '2026-11-10', false, {}, {}, NOW, EMAIL)).filter((m) => m.kind === 'activity_plan_due');
  assert.strictEqual(ms.length, 1); const ml = query(ms[0].go);
  assert.strictEqual(ml.qs.get('ch'), 'decimals'); assert.strictEqual(ml.qs.get('name'), 'Decimals & Place Value');
  const t2 = J(ctx.tchSetupQuests_(st, {}, { onTrack: 5 }, {}, NOW, {})).filter((x) => x.questId.indexOf('term:') === 0)[0], tl = query(t2.steps[0].go);
  assert.strictEqual(tl.qs.get('ch'), 'decimals'); assert.strictEqual(tl.qs.get('name'), 'Decimals & Place Value');
  // a save made from that link (the page posts cls, subj, ch and name) ticks step 1 of that same quest, and the sheet keeps the display name
  assert.deepStrictEqual(post({ cls: link.qs.get('cls'), subj: link.qs.get('subj'), ch: link.qs.get('ch'), name: link.qs.get('name'), activity: 'Sort the bars' }), { success: true });
  const saved = rows().filter((x) => x[4] === KEYCH)[0];
  assert.strictEqual(saved[5], NAME); assert.strictEqual(saved[4], KEYCH);       // Chapter = 'Ratio & Proportion', ChapterNorm = the key
  assert.deepStrictEqual(post({ cls: 'Class 7', subj: 'Math', ch: KEYCH, name: '   ', activity: 'Sort the bars again' }), { success: true });
  assert.strictEqual(rows().filter((x) => x[4] === KEYCH).length, 1); assert.strictEqual(rows().filter((x) => x[4] === KEYCH)[0][5], KEYCH);   // no name: falls back to ch
  assert.deepStrictEqual(post({ cls: 'Class 7', subj: 'Math', ch: KEYCH, name: NAME, activity: 'Sort the bars again' }), { success: true });
  const after = J(ctx.tchChapterQuests_(st, ctx.tchPlansFor_(CODE), {}, {}, NOW)).filter((x) => x.title === 'Class 7 Math \u00b7 ' + NAME)[0];
  assert.strictEqual(after.steps[0].done, true);
  // the link without a name (an older link) is still the same key
  assert.ok(ctx.tchPlanGo_('Class 7', 'Math', 'fractions').indexOf('name=') === -1);
  store.set('tch_' + CODE, JSON.stringify(state()));
}

// ---- Ruling 32: a save while the index is cold or rebuilding says so, instead of "not on your list"
{
  const LOADING = { success: false, error: 'Your classes are still loading; try again in a minute.' }, saved = new Map(store);
  const n = rows().length;
  store.delete('tch_' + CODE); store.delete('tch_meta');                         // cold: no index at all (the refresh it starts cannot read the feed here)
  assert.deepStrictEqual(post({ activity: 'Cold save' }), LOADING);
  store.set('tch_meta', JSON.stringify({ codes: [], failedAt: NOW.getTime() })); // only failed builds so far
  assert.deepStrictEqual(post({ activity: 'Cold save' }), LOADING);
  store.set('tch_meta', JSON.stringify({ codes: [], builtAt: NOW.getTime() })); store.set('tch_building', '1');   // a rebuild is running
  assert.deepStrictEqual(post({ activity: 'Cold save' }), LOADING);
  store.delete('tch_building');                                                  // built, and this code is not in it: the plain answer
  assert.deepStrictEqual(post({ activity: 'Cold save' }), notMine);
  assert.strictEqual(rows().length, n);
  store.clear(); saved.forEach((v, k) => store.set(k, v));
}
// a save drops this teacher's cached match summary too (an edit is a new planKey, Ruling 31)
store.set('tch_matches_' + CODE, '{}');
assert.deepStrictEqual(post({ activity: 'Busts the match cache' }), { success: true }); assert.ok(!store.has('tch_matches_' + CODE));

// ---- Ruling 22: the activity text is never logged
assert.ok(!logs.some((l) => /Pizza|Fraction|Money|Order check/.test(l)));

// ---- cached 10 min, and the read survives a missing workbook
let reads = 0; const sh = book.tabs[TAB], orig = sh.getDataRange;
sh.getDataRange = () => { reads++; return orig(); };
store.delete('tch_plans_' + CODE); ctx.tchPlansFor_(CODE); ctx.tchPlansFor_(CODE); assert.strictEqual(reads, 1);
ctx.SpreadsheetApp = { openById: () => { throw new Error('no access'); } };
assert.deepStrictEqual(J(ctx.tchPlansFor_(OTHER + 'x')), {});

console.log('test-teacher-plans: ok');
