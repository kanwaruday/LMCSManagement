// node tests/game/test-teacher-missions.js -- Teacher missions (game-teacher.gs): daily log card, remediation, activity plan, CWA due, Staff info_requested
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const dir = __dirname + '/../../apps-script/';
const ctx = { console, Logger: { log() {} } };
vm.createContext(ctx);
const load = (f) => vm.runInContext(fs.readFileSync(dir + f, 'utf8'), ctx);
load('game-teacher.gs'); load('acad-episodes.gs'); load('game.gs'); load('game-actions.gs'); load('game-missions.gs'); load('game-windows.gs');
const J = (x) => JSON.parse(JSON.stringify(x));
const kinds = (ms, k) => ms.filter((m) => m.kind === k);
const CODE = 'NCM/99/01/901';
const at = (iso) => Date.parse(iso);
const NOW = (iso) => new Date(iso);                       // game-day instants
const TUE = '2026-11-10', now = NOW('2026-11-10T05:00:00Z'); // Tue 10 Nov, 10:30 IST
const ep = (o) => Object.assign({ cls: 'Class 7', subj: 'Math', ch: 'fractions', name: 'Fractions', first: at('2026-10-28T06:00:00Z'), last: at('2026-10-30T06:00:00Z'),
  cwaAt: null, cwaFrom: null, remediatedAt: null, plannedCwaDate: null }, o || {});
// by default the teacher logged a chapter recently (no CWA, no planned date: no mission of its own), so the state is linked (Ruling 34)
const state = (o) => Object.assign({ code: CODE, campus: 'LMS4', builtAt: now.getTime(), classSubjects: [], episodes: [ep({ cls: 'Class 5', ch: 'earlier', name: 'Earlier' })], loggedDays: {}, periodsByDay: null, nextChapters: [] }, o || {});
const run = (st, day, working, plans, cfg, n, um) => J(ctx.tchMissions_(st, day, working, plans || {}, cfg || {}, n || NOW(day + 'T05:00:00Z'), undefined, um));

// ---- tchWorkingDay_: pure, takes the calendar as data
const W = (day, events, cfg) => ctx.tchWorkingDay_('LMS4', day, events || [], cfg || {});
assert.strictEqual(W('2026-11-10'), true);                                        // Tue
assert.strictEqual(W('2026-11-08'), false);                                       // Sun
assert.strictEqual(W('2026-11-14'), false);                                       // 2nd Sat
assert.strictEqual(W('2026-11-07'), true);                                        // 1st Sat
assert.strictEqual(W('2026-11-21'), true);                                        // 3rd Sat
assert.strictEqual(W('2026-11-10', [{ title: 'GH Diwali' }]), false);             // holiday prefix
assert.strictEqual(W('2026-11-10', [{ title: 'Staff GH' }]), true);               // prefix only
assert.strictEqual(W('2026-11-10', [{ title: 'Half-Yearly Examination' }]), false);
assert.strictEqual(W('2026-11-10', [{ title: 'PT-2 begins' }]), false);           // default keyword, case-insensitive
assert.strictEqual(W('2026-11-10', [{ title: 'Sports Day' }]), true);
assert.strictEqual(W('2026-11-10', [{ title: 'Unit Review' }], { teacher: { examKeywords: ['review'] } }), false);   // keywords come from config
assert.strictEqual(W('2026-11-10', [{ title: 'Half-Yearly Examination' }], { teacher: { examKeywords: ['review'] } }), true);
assert.strictEqual(W('2026-11-10', [{}, { title: null }]), true);                 // malformed events do not throw

// ---- cwhw_log
let ms = run(state(), '2026-11-08', false);                                        // a Sunday (caller says not a working day)
assert.strictEqual(kinds(ms, 'cwhw_log').length, 0);
ms = run(state(), TUE, false);                                                     // any non-working weekday (holiday, exam week: W() above decides): nothing is invented
assert.strictEqual(ms.length, 0);
const tt = { Mon: [], Tue: [{ cls: 'Class 7', subj: 'Math' }, { cls: 'Class 7', subj: 'Math' }, { cls: 'Class 8', subj: 'Science' }, { cls: 'Class 3', subj: 'English' }, { cls: 'M-I', subj: 'Hindi' }], Wed: [], Thu: [], Fri: [], Sat: [] };
const ent = (cls, subj, iso) => ({ cls, subj, at: at(iso), hw: false });
ms = kinds(run(state({ periodsByDay: tt, loggedDays: { [TUE]: [ent('Class 7', 'Math', TUE + 'T04:00:00Z'), ent('Class 3', 'English', TUE + 'T04:30:00Z')], '2026-11-09': [ent('Class 8', 'Science', '2026-11-09T04:00:00Z')] } }), TUE, true), 'cwhw_log');
assert.strictEqual(ms.length, 1);
assert.deepStrictEqual(ms[0].progress, { done: 2, total: 4 });                     // a class-subject taught twice counts once; yesterday's entry does not count
assert.strictEqual(ms[0].done, false); assert.strictEqual(ms[0].doneAt, null);
assert.strictEqual(ms[0].core, true);                                              // cfg.core default
assert.strictEqual(ms[0].id, 'teacher:cwhw_log:' + CODE + ':' + TUE);
assert.strictEqual(ms[0].title, "Log today's classwork and homework (2 of 4 classes)");
assert.strictEqual(ms[0].due, TUE); assert.strictEqual(ms[0].owner, CODE); assert.strictEqual(ms[0].campus, 'LMS4');
assert.strictEqual(ms[0].go, 'teacher/index.html#panel-tags');                           // Ruling 13 default
assert.ok(/Class 8 Science/.test(ms[0].why) && /M-I Hindi/.test(ms[0].why) && !/Class 3 English/.test(ms[0].why));
// all four logged: done, doneAt = the entry that completed it
const all = [ent('Class 7', 'Math', TUE + 'T03:00:00Z'), ent('Class 8', 'Science', TUE + 'T05:30:00Z'), ent('Class 3', 'English', TUE + 'T04:00:00Z'), ent('M-I', 'Hindi', TUE + 'T04:30:00Z'), ent('Class 8', 'Science', TUE + 'T06:00:00Z')];
ms = kinds(run(state({ periodsByDay: tt, loggedDays: { [TUE]: all } }), TUE, true), 'cwhw_log');
assert.deepStrictEqual(ms[0].progress, { done: 4, total: 4 }); assert.strictEqual(ms[0].done, true);
assert.strictEqual(ms[0].doneAt, new Date(TUE + 'T05:30:00Z').toISOString());      // the last class-subject's first entry
// the feed's finer subject name still matches the timetable's (E.V.S. spelling aside)
ms = kinds(run(state({ periodsByDay: { Tue: [{ cls: 'Class 1', subj: 'E.V.S.' }] }, loggedDays: { [TUE]: [ent('Class 1', 'E.V.S.', TUE + 'T04:00:00Z')] } }), TUE, true), 'cwhw_log');
assert.strictEqual(ms[0].done, true);
// no timetable: one item, any entry today completes it
ms = kinds(run(state({ loggedDays: {} }), TUE, true), 'cwhw_log');
assert.deepStrictEqual(ms[0].progress, { done: 0, total: 1 }); assert.strictEqual(ms[0].done, false);
ms = kinds(run(state({ loggedDays: { [TUE]: [ent('Class 9', 'Hindi', TUE + 'T04:10:00Z'), ent('Class 9', 'Math', TUE + 'T04:20:00Z')] } }), TUE, true), 'cwhw_log');
assert.deepStrictEqual(ms[0].progress, { done: 1, total: 1 }); assert.strictEqual(ms[0].done, true);
assert.strictEqual(ms[0].doneAt, new Date(TUE + 'T04:10:00Z').toISOString());
// a timetable with nothing on this weekday: nothing to log
ms = kinds(run(state({ periodsByDay: { Mon: [{ cls: 'Class 7', subj: 'Math' }], Tue: [] } }), TUE, true), 'cwhw_log');
assert.strictEqual(ms.length, 0);
// core comes from config, not hard-coded
ms = kinds(run(state(), TUE, true, {}, { teacher: { core: [] } }), 'cwhw_log');
assert.strictEqual(ms[0].core, false);

// ---- remediation_due: CWA on 1 Nov
const cwa1 = ep({ cwaAt: at('2026-11-01T06:00:00Z'), cwaFrom: 'tag' });
ms = kinds(run(state({ episodes: [cwa1] }), '2026-11-10', true), 'remediation_due');
assert.strictEqual(ms.length, 1);
assert.strictEqual(ms[0].due, '2026-11-15'); assert.strictEqual(ms[0].done, false); assert.strictEqual(ms[0].gone, false);
assert.strictEqual(ms[0].id, 'teacher:remediation_due:' + CODE + ':Class 7|Math|fractions');
assert.strictEqual(ms[0].title, 'Log the remediation for Fractions (Class 7 Math)');
assert.ok(/Fractions/.test(ms[0].why));                                            // no pre-fill map: the chapter is named in why
assert.strictEqual(ms[0].go, 'teacher/index.html#panel-tags');
ms = kinds(run(state({ episodes: [cwa1] }), '2026-11-15', true), 'remediation_due');
assert.strictEqual(ms[0].gone, false);                                             // the last day of the window
ms = kinds(run(state({ episodes: [cwa1] }), '2026-11-16', true), 'remediation_due');
assert.strictEqual(ms.length, 1); assert.strictEqual(ms[0].gone, true);            // window passed: closed without remediation
ms = kinds(run(state({ episodes: [cwa1] }), '2026-11-22', true), 'remediation_due');
assert.strictEqual(ms[0].gone, true);                                              // still inside remediationShowDays (21)
assert.strictEqual(kinds(run(state({ episodes: [cwa1] }), '2026-11-23', true), 'remediation_due').length, 0);
// the windows come from config
ms = kinds(run(state({ episodes: [cwa1] }), '2026-11-10', true, {}, { teacher: { remediationDays: 5 } }), 'remediation_due');
assert.strictEqual(ms[0].gone, true);                                              // 1 Nov + 5 d = 6 Nov
// remediated on the same chapter: done, doneAt = that entry
const REM = at('2026-11-09T06:30:00Z');
ms = kinds(run(state({ episodes: [Object.assign({}, cwa1, { remediatedAt: REM })] }), TUE, true), 'remediation_due');
assert.strictEqual(ms.length, 1); assert.strictEqual(ms[0].done, true); assert.strictEqual(ms[0].gone, false);
assert.strictEqual(ms[0].doneAt, new Date(REM).toISOString()); assert.strictEqual(ms[0].doneBy, CODE);
// remediated long ago: not today's story
ms = kinds(run(state({ episodes: [Object.assign({}, cwa1, { remediatedAt: at('2026-11-03T06:30:00Z') })] }), TUE, true), 'remediation_due');
assert.strictEqual(ms.length, 0);
// no CWA, or a CWA that came from the Tracker only: only an episode with cwaAt counts
assert.strictEqual(kinds(run(state({ episodes: [ep()] }), TUE, true), 'remediation_due').length, 0);

// ---- Ruling 13: the form URL and its pre-fill
const form = 'https://docs.google.com/forms/d/e/FORMID/viewform';
const pre = { cls: 'entry.123', subj: 'entry.456', ch: 'entry.789', tag: 'entry.111' };
ms = run(state({ episodes: [cwa1] }), TUE, true, {}, { teacher: { cwhwFormUrl: form, cwhwPrefill: pre } });
const rem = kinds(ms, 'remediation_due')[0];
assert.strictEqual(rem.go, form + '?usp=pp_url&entry.123=Class%207&entry.456=Math&entry.789=Fractions&entry.111=Remediation');
assert.strictEqual(kinds(ms, 'cwhw_log')[0].go, form);                              // the daily card is not pre-filled
assert.strictEqual(rem.why, 'The form opens with the class, subject, chapter and Remediation tag filled in');
// partial pre-fill (Ruling 17): only what was filled is claimed; the chapter is named whenever it was not
ms = run(state({ episodes: [cwa1] }), TUE, true, {}, { teacher: { cwhwFormUrl: form, cwhwPrefill: { cls: 'entry.1', subj: 'entry.2' } } });
assert.strictEqual(kinds(ms, 'remediation_due')[0].why, 'The form fills in part of it. Pick chapter \u201cFractions\u201d, tag Remediation');
ms = run(state({ episodes: [cwa1] }), TUE, true, {}, { teacher: { cwhwFormUrl: form, cwhwPrefill: { ch: 'entry.3', tag: 'entry.4' } } });
assert.strictEqual(kinds(ms, 'remediation_due')[0].why, 'The form fills in part of it. Pick Class 7 Math');
ms = run(state({ episodes: [cwa1] }), TUE, true, {}, { teacher: { cwhwFormUrl: form } });   // empty map: plain form, chapter in why
assert.strictEqual(kinds(ms, 'remediation_due')[0].go, form); assert.ok(/Fractions/.test(kinds(ms, 'remediation_due')[0].why));
ms = run(state({ episodes: [cwa1] }), TUE, true, {}, { teacher: { cwhwFormUrl: 'https://forms.gle/abc', cwhwPrefill: pre } });   // a short link cannot take usp=pp_url: plain, chapter named in why
assert.strictEqual(kinds(ms, 'remediation_due')[0].go, 'https://forms.gle/abc'); assert.ok(/Fractions/.test(kinds(ms, 'remediation_due')[0].why));
ms = run(state({ episodes: [cwa1] }), TUE, true, {}, { teacher: { cwhwFormUrl: form + '?hl=en', cwhwPrefill: { cls: 'entry.1' } } });  // existing query string; keys missing from the map are skipped
assert.strictEqual(kinds(ms, 'remediation_due')[0].go, form + '?hl=en&usp=pp_url&entry.1=Class%207');
// Ruling 16: only https://docs.google.com/forms/ and https://forms.gle/ are accepted (the client allowlist); the check is anchored
const T = (u) => J(ctx.tchConfig_({ teacher: { cwhwFormUrl: u } })).cwhwFormUrl;
assert.strictEqual(T(form), form); assert.strictEqual(T(' https://forms.gle/abc '), 'https://forms.gle/abc');
for (const bad of ['https://evil.example/?docs.google.com/forms/', 'javascript:alert(1)', 'http://docs.google.com/forms/x', 'https://docs.google.com/document/d/1', 'https://forms.gle.evil.example/x', '//docs.google.com/forms/x', 'teacher/index.html']) assert.strictEqual(T(bad), '', bad);
ms = run(state({ episodes: [cwa1] }), TUE, true, {}, { teacher: { cwhwFormUrl: 'https://evil.example/?docs.google.com/forms/', cwhwPrefill: pre } });
assert.strictEqual(kinds(ms, 'remediation_due')[0].go, 'teacher/index.html#panel-tags'); assert.strictEqual(kinds(ms, 'cwhw_log')[0].go, 'teacher/index.html#panel-tags');
ms = run(state({ episodes: [cwa1] }), TUE, true, {}, { teacher: { cwhwFormUrl: 'javascript:alert(1)' } });
assert.strictEqual(kinds(ms, 'cwhw_log')[0].go, 'teacher/index.html#panel-tags');
ms = run(state({ episodes: [cwa1] }), TUE, true, {}, { teacher: { cwhwFormUrl: 42, cwhwPrefill: 'x' } });   // wrong types: defaults
assert.strictEqual(kinds(ms, 'remediation_due')[0].go, 'teacher/index.html#panel-tags');

// ---- activity_plan_due
const nxt = (startDate, o) => Object.assign({ cls: 'Class 7', subj: 'Math', ch: 'decimals', name: 'Decimals', startDate }, o || {});
ms = kinds(run(state({ nextChapters: [nxt('2026-11-15')] }), TUE, true), 'activity_plan_due');            // starts in 5 days
assert.strictEqual(ms.length, 1);
assert.strictEqual(ms[0].due, '2026-11-15'); assert.strictEqual(ms[0].done, false);
assert.strictEqual(ms[0].title, 'Plan an activity for Decimals (Class 7 Math)');
assert.strictEqual(ms[0].go, 'teacher/plan-activity.html?cls=Class%207&subj=Math&ch=decimals&name=Decimals');
assert.strictEqual(ms[0].id, 'teacher:activity_plan_due:' + CODE + ':Class 7|Math|decimals');
assert.strictEqual(ms[0].core, false);
assert.strictEqual(kinds(run(state({ nextChapters: [nxt('2026-11-19')] }), TUE, true), 'activity_plan_due').length, 0);   // in 9 days
assert.strictEqual(kinds(run(state({ nextChapters: [nxt('2026-11-17')] }), TUE, true), 'activity_plan_due').length, 1);   // exactly planLeadDays (7)
assert.strictEqual(kinds(run(state({ nextChapters: [nxt('2026-11-19')] }), TUE, true, {}, { teacher: { planLeadDays: 10 } }), 'activity_plan_due').length, 1);
// a plan exists: done (any time), shown while fresh
ms = kinds(run(state({ nextChapters: [nxt('2026-11-15')] }), TUE, true, { 'Class 7|Math|decimals': { activity: 'Fraction pizza', plannedAt: '2026-11-09T07:00:00.000Z' } }), 'activity_plan_due');
assert.strictEqual(ms.length, 1); assert.strictEqual(ms[0].done, true); assert.strictEqual(ms[0].doneAt, '2026-11-09T07:00:00.000Z');
ms = kinds(run(state({ nextChapters: [nxt('2026-11-15')] }), TUE, true, { 'Class 7|Math|decimals': { activity: 'Old', plannedAt: '2026-10-01T07:00:00.000Z' } }), 'activity_plan_due');
assert.strictEqual(ms.length, 0);                                                    // planned long ago: not today's story
// a plan for another chapter does not count
assert.strictEqual(kinds(run(state({ nextChapters: [nxt('2026-11-15')] }), TUE, true, { 'Class 7|Math|other': { activity: 'x', plannedAt: '2026-11-09T07:00:00.000Z' } }), 'activity_plan_due')[0].done, false);

// ---- cwa_due
ms = kinds(run(state({ episodes: [ep({ plannedCwaDate: '2026-11-05' })] }), TUE, true), 'cwa_due');
assert.strictEqual(ms.length, 1); assert.strictEqual(ms[0].due, '2026-11-05'); assert.strictEqual(ms[0].done, false);
assert.strictEqual(ms[0].title, 'The CWA for Fractions (Class 7 Math) was planned for Thu 5 Nov');
assert.strictEqual(ms[0].id, 'teacher:cwa_due:' + CODE + ':Class 7|Math|fractions');
assert.strictEqual(kinds(run(state({ episodes: [ep({ plannedCwaDate: '2026-11-10' })] }), TUE, true), 'cwa_due').length, 0);   // planned today: not yet late
assert.strictEqual(kinds(run(state({ episodes: [ep()] }), TUE, true), 'cwa_due').length, 0);                                    // no planned date
ms = kinds(run(state({ episodes: [ep({ plannedCwaDate: '2026-11-05', cwaAt: at('2026-11-09T06:00:00Z'), cwaFrom: 'tag' })] }), TUE, true), 'cwa_due');
assert.strictEqual(ms[0].done, true); assert.strictEqual(ms[0].doneAt, new Date(at('2026-11-09T06:00:00Z')).toISOString());
assert.strictEqual(kinds(run(state({ episodes: [ep({ plannedCwaDate: '2026-11-05', cwaAt: at('2026-11-06T06:00:00Z') })] }), TUE, true), 'cwa_due').length, 0);   // done a while ago
// the working-day flag gates only the daily log card; a missed CWA is still a missed CWA on a holiday
ms = run(state({ episodes: [ep({ plannedCwaDate: '2026-11-05' })] }), TUE, false);
assert.strictEqual(kinds(ms, 'cwhw_log').length, 0); assert.strictEqual(kinds(ms, 'cwa_due').length, 1);
ms = run(state({ episodes: [ep({ plannedCwaDate: '2026-11-05' })] }), TUE, true, {}, { teacher: { cwhwFormUrl: form, cwhwPrefill: pre } });
assert.ok(/entry\.111=CWA/.test(kinds(ms, 'cwa_due')[0].go));

// Ruling 27: only each taught class-subject's CURRENT chapter (the latest episode, the chapter quests' own rule), only until planned + remediationShowDays (21)
const olderCh = ep({ ch: 'decimals', name: 'Decimals', first: at('2026-10-01T06:00:00Z'), last: at('2026-10-10T06:00:00Z'), plannedCwaDate: '2026-11-03' });   // inside the show window
const currentCh = ep({ plannedCwaDate: '2026-11-05' });
ms = kinds(run(state({ episodes: [olderCh, currentCh] }), TUE, true), 'cwa_due');
assert.deepStrictEqual(ms.map((m) => m.id), ['teacher:cwa_due:' + CODE + ':Class 7|Math|fractions']);       // the old chapter's missed CWA gives no mission
assert.strictEqual(kinds(run(state({ episodes: [Object.assign({}, olderCh, { last: at('2026-11-07T06:00:00Z') }), currentCh] }), TUE, true), 'cwa_due')[0].id,
  'teacher:cwa_due:' + CODE + ':Class 7|Math|decimals');                                                       // whichever chapter has the latest entry is current
// not taught: not on the roster and last logged more than taughtLookbackDays (30) ago; on the roster it is taught however long ago
const stale = ep({ cls: 'Class 9', subj: 'Hindi', ch: 'kabir', name: 'Kabir', first: at('2026-09-01T06:00:00Z'), last: at('2026-09-20T06:00:00Z'), plannedCwaDate: '2026-11-01' });
assert.strictEqual(kinds(run(state({ episodes: [currentCh, stale] }), TUE, true), 'cwa_due').length, 1);   // only Class 7's
assert.strictEqual(kinds(run(state({ episodes: [currentCh, stale], classSubjects: [{ cls: 'Class 9', subj: 'Hindi' }] }), TUE, true), 'cwa_due').length, 2);
assert.strictEqual(kinds(run(state({ episodes: [currentCh, stale] }), TUE, true, {}, { teacher: { taughtLookbackDays: 60 } }), 'cwa_due').length, 2);
// the show window: planned 5 Nov + 21 d = 26 Nov is the last day shown; gone after it
assert.strictEqual(kinds(run(state({ episodes: [ep({ plannedCwaDate: '2026-11-05', last: at('2026-11-20T06:00:00Z') })] }), '2026-11-26', true), 'cwa_due').length, 1);
assert.strictEqual(kinds(run(state({ episodes: [ep({ plannedCwaDate: '2026-11-05', last: at('2026-11-20T06:00:00Z') })] }), '2026-11-27', true), 'cwa_due').length, 0);
assert.strictEqual(kinds(run(state({ episodes: [ep({ plannedCwaDate: '2026-11-05' })] }), TUE, true, {}, { teacher: { remediationShowDays: 3 } }), 'cwa_due').length, 0);
assert.strictEqual(kinds(run(state({ episodes: [ep({ plannedCwaDate: '2026-04-20' })] }), TUE, true), 'cwa_due').length, 0);   // a CWA planned before the term's middle: never nagged

// Ruling 29: a tracker-only CWA (no CWA tag, so its remediation is not knowable) gives no remediation_due at all, open or gone
for (const day of [TUE, '2026-11-16']) assert.strictEqual(kinds(run(state({ episodes: [Object.assign({}, cwa1, { cwaFrom: 'tracker' })] }), day, true), 'remediation_due').length, 0);

// Ruling 34: unlinked only when the index resolved ZERO entries to this code in the whole feed (state.resolvedEntries === 0) AND the campus has an unmatched feed name
const UNL = "Your entries aren't linked to you yet; your Principal can fix this.", UM = ['Tee Six maam'];
const z = (o) => state(Object.assign({ resolvedEntries: 0 }, o));
for (const st of [z({ episodes: [], periodsByDay: tt, nextChapters: [nxt('2026-11-15')] }), z({ periodsByDay: tt }), z({ episodes: [], loggedDays: { '2026-10-05': [ent('Class 7', 'Math', '2026-10-05T04:00:00Z')] } })]) {
  ms = run(st, TUE, true, {}, {}, null, UM);
  assert.strictEqual(ms.length, 1); assert.strictEqual(ms[0].id, 'teacher:unlinked:' + CODE); assert.strictEqual(ms[0].kind, 'unlinked');
  assert.strictEqual(ms[0].title, UNL); assert.strictEqual(ms[0].go, ''); assert.strictEqual(ms[0].why, '');
  assert.strictEqual(ms[0].core, false); assert.strictEqual(ms[0].shared, false); assert.strictEqual(ms[0].done, false); assert.strictEqual(ms[0].due, null);
}
assert.strictEqual(run(z({ episodes: [] }), TUE, true, {}, { teacher: { core: ['cwhw_log', 'unlinked'] } }, null, UM)[0].core, false);   // never core, whatever the config says
// 1. winter break: logged 40 days ago, nothing since, resolved to this teacher -> the normal log card (the old 30-day rule said "unlinked")
for (const um of [UM, [], undefined]) {
  ms = run(state({ resolvedEntries: 25, episodes: [ep({ last: at('2026-09-30T06:00:00Z') })], periodsByDay: tt }), TUE, true, {}, {}, null, um);
  assert.strictEqual(ms[0].kind, 'cwhw_log'); assert.ok(!ms.some((m) => m.kind === 'unlinked'));
}
// 2. new joiner: zero resolved entries but the campus has no unmatched names -> the normal log card
for (const um of [[], undefined, null]) assert.strictEqual(run(z({ episodes: [], periodsByDay: tt }), TUE, true, {}, {}, null, um)[0].kind, 'cwhw_log');
// 4. a state cached before resolvedEntries existed never shows "unlinked", whatever the campus's unmatched list
assert.strictEqual(run(state({ episodes: [], periodsByDay: tt }), TUE, true, {}, {}, null, UM)[0].kind, 'cwhw_log');
assert.strictEqual(ctx.tchLinked_({}, UM), true);
assert.strictEqual(ctx.tchLinked_({ resolvedEntries: 0 }, UM), false);
assert.strictEqual(ctx.tchLinked_({ resolvedEntries: 1 }, UM), true);

// 3. ... through the index: a roster teacher (EmpAcademic + timetable) with ZERO resolved entries (the feed has her typed name, which differs from the roster's) on a campus with an unmatched name gets exactly that mission
{
  const C6 = 'NCM/99/01/906', D = 86400000;
  const roster = { employees: [{ employeeCode: C6, name: 'T Six', school: 'LMS 4' }], academic: [{ employeeCode: C6, class: 'Class 7', subject: 'Math' }] };
  const r = (d) => ({ lmsIdx: 3, classMapped: 'Class 7', subject: 'Math', teacher: 'Tee Six maam', cwChapter: 'Fractions', cwTag: 'CWA', cwDesc: 'x', hwDesc: 'y', hwTag: '', timeMs: now.getTime() - d * D, dateStr: '' });
  const tt6 = { campuses: { LMS4: { [C6]: { periods: [{ day: 'Tue', period: 1, subject: 'Maths', class: 'Class 7', free: false }] } } } };
  const built = ctx.tchBuildIndex_({ cwRecords: [r(1), r(2), r(3)], cmData: { 3: { 'Class 7': [{ subject: 'Maths', chapterName: 'Fractions', startDate: '2026-11-01', cwaDate: '2026-11-05' }] } } }, roster, [], tt6, null, { now: now.getTime() });
  assert.deepStrictEqual(J(built.meta.unmatched), { 3: ['Tee Six maam'] });
  assert.strictEqual(built.byCode[C6].resolvedEntries, 0);
  ms = J(ctx.tchMissions_(built.byCode[C6], TUE, true, {}, {}, now, 't6@example.org', built.meta.unmatched[3]));
  assert.deepStrictEqual(ms.map((m) => [m.id, m.title, m.go, m.core]), [['teacher:unlinked:' + C6, UNL, '', false]]);
  ms = J(ctx.tchMissions_(built.byCode[C6], TUE, true, {}, {}, now, 't6@example.org', []));   // same teacher, campus with no unmatched names: normal missions
  assert.strictEqual(ms[0].kind, 'cwhw_log');
}

// it never counts for or against days on track: not core, so the day's snapshot holds no core id for it, and DONE_AT has nothing to say about it
{
  const only = run(z({ episodes: [], periodsByDay: tt }), TUE, true, {}, {}, null, UM), coreIds = only.filter((m) => m.core && !m.shared).map((m) => m.id);   // what gamePersistDaily_ snapshots
  assert.deepStrictEqual(coreIds, []);
  assert.deepStrictEqual(J(ctx.gameFinalizeDay_({ coreIds, doneIds: [] }, only, TUE, () => null)), { counted: false, onTrack: false });   // a day with nothing counted
}

// I2: an index older than 2 h (the feed has been failing) says "as of" on the log card; a fresh one says nothing
const asOf = (builtIso) => kinds(run(state({ builtAt: at(builtIso), periodsByDay: tt }), TUE, true), 'cwhw_log')[0].why;
assert.ok(!/as of/.test(asOf('2026-11-10T04:00:00Z')));                                                          // 1 h old
assert.ok(!/as of/.test(asOf('2026-11-10T03:00:00Z')));                                                          // exactly 2 h: still fresh
assert.ok(/ \(as of 08:29 IST\)$/.test(asOf('2026-11-10T02:59:00Z')), asOf('2026-11-10T02:59:00Z'));           // just over 2 h
assert.strictEqual(asOf('2026-11-09T12:30:00Z').slice(-28), '(as of Mon 9 Nov, 18:00 IST)');                   // another day names the day
assert.strictEqual(kinds(run(state({ builtAt: at('2026-11-09T12:30:00Z'), periodsByDay: { Tue: [{ cls: 'Class 7', subj: 'Math' }] }, loggedDays: { [TUE]: [ent('Class 7', 'Math', TUE + 'T04:00:00Z')] } }), TUE, true), 'cwhw_log')[0].why,
  '(as of Mon 9 Nov, 18:00 IST)');                                                                               // a done card says it too
assert.ok(!/as of/.test(kinds(run(state({ builtAt: undefined, periodsByDay: tt }), TUE, true), 'cwhw_log')[0].why));   // an old state without builtAt: nothing claimed

// owner and doneBy are the caller's email (quest evidence matches doneBy against it), the ids keep the code
const who = J(ctx.tchMissions_(state({ periodsByDay: { Tue: [{ cls: 'Class 7', subj: 'Math' }] }, loggedDays: { [TUE]: [ent('Class 7', 'Math', TUE + 'T04:00:00Z')] }, episodes: [Object.assign({}, cwa1, { remediatedAt: REM })], nextChapters: [nxt('2026-11-15')] }), TUE, true, { 'Class 7|Math|decimals': { activity: 'x', plannedAt: '2026-11-09T07:00:00.000Z' } }, {}, now, 'T@LMS.org.in'));
assert.strictEqual(who.length, 3);
for (const m of who) { assert.strictEqual(m.owner, 't@lms.org.in'); assert.strictEqual(m.done, true); assert.strictEqual(m.doneBy, 't@lms.org.in'); assert.ok(m.id.indexOf(':' + CODE + ':') !== -1, m.id); }

// every mission has the full framework shape
for (const m of run(state({ periodsByDay: tt, episodes: [cwa1, ep({ ch: 'x', plannedCwaDate: '2026-11-05' })], nextChapters: [nxt('2026-11-15')] }), TUE, true)) {
  for (const k of ['id', 'kind', 'title', 'why', 'owner', 'campus', 'go', 'due', 'core', 'shared', 'done', 'doneAt', 'doneBy', 'rolledOver', 'gone']) assert.ok(k in m, m.kind + ' lacks ' + k);
  assert.strictEqual(m.shared, false); assert.strictEqual(m.rolledOver, false);
}

// ---- the wiring: GAME_MODULE_MISSIONS.Teacher
const store = new Map(); let calls = 0, events = [], calErr = false, nowMs = now.getTime();
const ttls = {}, logs = [];
ctx.Logger.log = (m) => { logs.push(String(m)); };
ctx.CacheService = { getScriptCache: () => ({ get: (k) => (store.has(k) ? store.get(k) : null), put: (k, v, t) => { store.set(k, v); ttls[k] = t; }, remove: (k) => store.delete(k) }) };
ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: () => 'sheet-id' }) };
const cfgRows = [['Key', 'Value'], ['teacher', JSON.stringify({ examKeywords: ['exam'] })]];
ctx.SpreadsheetApp = { openById: () => ({ getSheetByName: () => ({ getDataRange: () => ({ getValues: () => cfgRows }) }) }) };
const calendarOk = (id) => { assert.strictEqual(id, 'lms.org.in_snflpd3f357jv8l380s8sc4ju0@group.calendar.google.com'); calls++; return { getEvents: (s, e) => { if (calErr) throw new Error('no cal'); assert.strictEqual(e.getTime() - s.getTime(), 86400000); return events.map((t) => ({ getTitle: () => t })); } }; };
ctx.CalendarApp = { getCalendarById: calendarOk };
store.set('tch_' + CODE, JSON.stringify(state({ periodsByDay: tt })));
store.set('tch_meta', JSON.stringify({ codes: [CODE], builtAt: nowMs }));
const caller = { email: 't@lms.org.in', campusId: 'LMS4', roles: ['Teacher'], primaryRole: 'Teacher', employeeCode: CODE };
const fw = ctx.gameParseConfig_([['Key', 'Value']]);                                // the framework drops `teacher`: the wiring reads it itself
assert.ok(ctx.gameModuleHooks_(ctx.GAME_MODULE_MISSIONS, 'Teacher').includes(ctx.tchMissionsHook_));
ms = J(ctx.tchMissionsHook_(caller, fw, now));
assert.strictEqual(kinds(ms, 'cwhw_log').length, 1); assert.strictEqual(calls, 1);
ctx.tchMissionsHook_(caller, fw, now); assert.strictEqual(calls, 1);   // the campus's events are cached
events = ['Half-Yearly Examination']; store.clear();
store.set('tch_' + CODE, JSON.stringify(state({ periodsByDay: tt }))); store.set('tch_meta', JSON.stringify({ codes: [CODE], builtAt: nowMs }));
assert.strictEqual(J(ctx.tchMissionsHook_(caller, fw, now)).length, 0);   // exam keyword from the sheet's teacher row
// Ruling 17: an unreadable calendar is unknown, not a working day: no log card, a count-only log line, the unknown result cached 30 min
store.delete('tch_cal_LMS4_' + TUE); events = []; calErr = true; calls = 0;
ms = J(ctx.tchMissionsHook_(caller, fw, now));
assert.strictEqual(kinds(ms, 'cwhw_log').length, 0); assert.strictEqual(logs.length, 1); assert.ok(!/LMS4|@|group\.calendar|NCM/.test(logs[0]), logs[0]);
ctx.tchMissionsHook_(caller, fw, now); assert.strictEqual(calls, 1); assert.strictEqual(logs.length, 1);   // cached: not retried per load
assert.strictEqual(store.get('tch_cal_LMS4_' + TUE), '{"unknown":true}'); assert.strictEqual(ttls['tch_cal_LMS4_' + TUE], 1800);
calErr = false; ctx.CalendarApp.getCalendarById = () => null;                          // the calendar object itself missing: same
store.delete('tch_cal_LMS4_' + TUE);
assert.strictEqual(kinds(J(ctx.tchMissionsHook_(caller, fw, now)), 'cwhw_log').length, 0);
// other missions are still produced when the calendar is unknown
store.set('tch_' + CODE, JSON.stringify(state({ periodsByDay: tt, episodes: [ep({ plannedCwaDate: '2026-11-05' })] })));
store.delete('tch_cal_LMS4_' + TUE);
assert.strictEqual(kinds(J(ctx.tchMissionsHook_(caller, fw, now)), 'cwa_due').length, 1);
store.set('tch_' + CODE, JSON.stringify(state({ periodsByDay: tt })));
// the calendar recovers once the negative entry expires
store.delete('tch_cal_LMS4_' + TUE);
ctx.CalendarApp.getCalendarById = (id) => { calls++; return { getEvents: () => [] }; };
assert.strictEqual(kinds(J(ctx.tchMissionsHook_(caller, fw, now)), 'cwhw_log').length, 1);
ctx.CalendarApp.getCalendarById = calendarOk;
// plans are read through tchPlansFor_ (a stub until Task 6)
assert.deepStrictEqual(J(ctx.tchPlansFor_(CODE)), {}); assert.deepStrictEqual(J(ctx.tchMatchesFor_(CODE)), {});
// no state: no missions, never an error
store.delete('tch_' + CODE); store.set('tch_meta', JSON.stringify({ codes: [], builtAt: nowMs }));
assert.deepStrictEqual(J(ctx.tchMissionsHook_(caller, fw, now)), []);
// a caller without an employeeCode (allowlisted) is looked up by email in the Employee Master
const sheet = (rows) => ({ getDataRange: () => ({ getValues: () => rows }) });
const emp = { getSheetByName: (n) => sheet({ EmpPersonal: [['EmployeeCode', 'AuthEmail'], [CODE, 't@lms.org.in']], EmpMaster: [['EmployeeCode', 'Status'], [CODE, 'Active']], EmpSalary: [['EmployeeCode', 'Department'], [CODE, 'Teaching']] }[n]) };
ctx.SpreadsheetApp = { openById: (id) => (id === '1OjVMUvpLM8JkdAwjmljCtZUI1VUqGLbic36cW9dm0C0' ? emp : { getSheetByName: () => ({ getDataRange: () => ({ getValues: () => cfgRows }) }) }) };
store.set('tch_' + CODE, JSON.stringify(state({ periodsByDay: tt })));
const noCode = Object.assign({}, caller); delete noCode.employeeCode;
assert.strictEqual(kinds(J(ctx.tchMissionsHook_(noCode, fw, now)), 'cwhw_log').length, 1);
// Ruling 34 wiring: the module reads tch_meta.unmatched for the state's campus (LMS4 -> index 3)
store.set('tch_' + CODE, JSON.stringify(state({ periodsByDay: tt, resolvedEntries: 0 })));
assert.strictEqual(kinds(J(ctx.tchMissionsHook_(noCode, fw, now)), 'cwhw_log').length, 1);   // no tch_meta: never unlinked
store.set('tch_meta', JSON.stringify({ builtAt: now.getTime(), codes: [CODE], unmatched: { 2: ['Other campus'] } }));
assert.strictEqual(kinds(J(ctx.tchMissionsHook_(noCode, fw, now)), 'cwhw_log').length, 1);   // another campus's unmatched name does not count
store.set('tch_meta', JSON.stringify({ builtAt: now.getTime(), codes: [CODE], unmatched: { 3: ['Tee Six maam'] } }));
assert.deepStrictEqual(J(ctx.tchMissionsHook_(noCode, fw, now)).map((m) => m.kind), ['unlinked']);
store.delete('tch_meta'); store.set('tch_' + CODE, JSON.stringify(state({ periodsByDay: tt })));
// email -> code is cached 6 h: the second load does not open the Employee Master (it is down now and the answer still comes)
assert.strictEqual(ttls['tch_code_t@lms.org.in'], 21600);
ctx.SpreadsheetApp = { openById: () => { throw new Error('down'); } };
assert.strictEqual(kinds(J(ctx.tchMissionsHook_(noCode, fw, now)), 'cwhw_log').length, 1);
// a non-employee: no missions, and the miss is cached 10 min so the next load does not read again
let reads = 0;
ctx.SpreadsheetApp = { openById: () => { reads++; return { getSheetByName: () => sheet([['EmployeeCode', 'AuthEmail']]) }; } };
const stranger = { email: 'Nobody@lms.org.in', campusId: 'LMS4', roles: ['Teacher'], primaryRole: 'Teacher' };
assert.deepStrictEqual(J(ctx.tchMissionsHook_(stranger, fw, now)), []); assert.strictEqual(reads, 1);
assert.deepStrictEqual(J(ctx.tchMissionsHook_(stranger, fw, now)), []); assert.strictEqual(reads, 1);
assert.strictEqual(ttls['tch_code_nobody@lms.org.in'], 600);

// ---- GAME_MODULE_DONE_AT.Teacher: when the day's last due class-subject was logged (cached state only)
store.set('tch_' + CODE, JSON.stringify(state({ periodsByDay: tt, loggedDays: { [TUE]: all, '2026-11-09': [ent('Class 7', 'Math', '2026-11-09T04:00:00Z')] } })));
const DA = ctx.GAME_MODULE_DONE_AT.Teacher, logId = (d) => 'teacher:cwhw_log:' + CODE + ':' + d;
assert.strictEqual(typeof DA, 'function');
assert.strictEqual(DA(caller, logId(TUE)), at(TUE + 'T05:30:00Z'));                // complete: the last class-subject's first entry
assert.strictEqual(DA(caller, logId('2026-11-09')), null);                          // a day with no entries
store.set('tch_' + CODE, JSON.stringify(state({ periodsByDay: tt, loggedDays: { [TUE]: all.slice(0, 2) } })));
assert.strictEqual(DA(caller, logId(TUE)), null);                                   // incomplete
store.set('tch_' + CODE, JSON.stringify(state({ loggedDays: { [TUE]: [ent('Class 9', 'Hindi', TUE + 'T04:10:00Z')] } })));
assert.strictEqual(DA(caller, logId(TUE)), at(TUE + 'T04:10:00Z'));                // no timetable: one entry is enough
assert.strictEqual(DA(caller, 'teacher:remediation_due:' + CODE + ':Class 7|Math|fractions'), null);   // other kinds
assert.strictEqual(DA(caller, 'teacher:cwhw_log:OTHER/01/01/001:' + TUE), null);   // another person's id
assert.strictEqual(DA(caller, 'info_requested:A1'), null); assert.strictEqual(DA(caller, undefined), null);
assert.strictEqual(DA(caller, 'teacher:unlinked:' + CODE), null);                  // Ruling 28/34: the unlinked line has no done time, ever
store.delete('tch_' + CODE);
assert.strictEqual(DA(caller, logId(TUE)), null);                                   // not cached: null, and no refresh runs inside the lock
ctx.CacheService = { getScriptCache: () => { throw new Error('down'); } };
assert.strictEqual(DA(caller, logId(TUE)), null);                                   // never throws

// ---- Staff: only the caller's own Info Requested rows, same shape as the Principal's
const apr = (id, by, status, o) => { o = o || {}; const r = new Array(19).fill(''); r[0] = id; r[1] = 'LMS4'; r[2] = 'Other'; r[4] = o.title || ('Title ' + id); r[11] = by; r[12] = '2026-11-05T05:00:00Z'; r[13] = status; r[18] = o.archived || ''; return r; };
const rows = [['id'], apr('A1', 't@lms.org.in', 'Info Requested', { title: 'New projector' }), apr('A2', 'other@lms.org.in', 'Info Requested'), apr('A3', 't@lms.org.in', 'Pending'),
  apr('A4', 't@lms.org.in', 'Info Requested', { archived: 'TRUE' }), apr('A5', 'T@lms.org.in', 'Info Requested', { title: 'Chairs' })];
const staff = { email: 't@lms.org.in', campusId: 'LMS4', roles: ['Staff'], primaryRole: 'Staff', employeeCode: CODE };
ctx.SpreadsheetApp = { openById: (id) => { assert.strictEqual(id, '1Tr4Rfc6DN698eeGVjuCoXfSRR-NhBTWJibR00Ibj6P4'); return { getSheetByName: (n) => { assert.strictEqual(n, 'Approvals'); return sheet(rows); } }; } };
ms = J(ctx.tchStaffMissionsHook_(staff, fw, now));
assert.deepStrictEqual(ms.map((m) => m.id), ['info_requested:A1', 'info_requested:A5']);
assert.strictEqual(ms[0].title, 'Reply to Management about “New projector”'); assert.strictEqual(ms[0].kind, 'info_requested');
assert.strictEqual(ms[0].go, 'teacher/index.html#panel-requests'); assert.strictEqual(ms[0].owner, 't@lms.org.in'); assert.strictEqual(ms[0].campus, 'LMS4');
// the Principal's own path still builds the same shape (one shared builder)
const principal = { email: 't@lms.org.in', campusId: 'LMS4', roles: ['Principal'], primaryRole: 'Principal', canDecide: false };
const pm = J(ctx.gamePrincipalMissions_(principal, { approvals: rows }, fw, now)).filter((m) => m.kind === 'info_requested');
assert.deepStrictEqual(pm.map((m) => m.id), ['info_requested:A1', 'info_requested:A5']);
ctx.SpreadsheetApp = { openById: () => { throw new Error('down'); } };
assert.deepStrictEqual(J(ctx.tchStaffMissionsHook_(staff, fw, now)), []);
assert.ok(!ctx.gameModuleHooks_(ctx.GAME_MODULE_QUESTS, 'Staff').some((f) => /^tch/.test(f.name)));
console.log('teacher-missions: ok');
