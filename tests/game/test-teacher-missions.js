// node tests/game/test-teacher-missions.js -- Teacher missions (game-teacher.gs): daily log card, remediation, activity plan, CWA due, Staff info_requested
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const dir = __dirname + '/../../apps-script/';
const ctx = { console, Logger: { log() {} } };
vm.createContext(ctx);
const load = (f) => vm.runInContext(fs.readFileSync(dir + f, 'utf8'), ctx);
load('game-teacher.gs'); load('acad-episodes.gs'); load('game.gs'); load('game-actions.gs'); load('game-missions.gs'); load('game-windows.gs');
const J = (x) => JSON.parse(JSON.stringify(x));
const kinds = (ms, k) => ms.filter((m) => m.kind === k);
const CODE = 'NCM/24/04/073';
const at = (iso) => Date.parse(iso);
const NOW = (iso) => new Date(iso);                       // game-day instants
const TUE = '2026-11-10', now = NOW('2026-11-10T05:00:00Z'); // Tue 10 Nov, 10:30 IST
const state = (o) => Object.assign({ code: CODE, campus: 'LMS4', classSubjects: [], episodes: [], loggedDays: {}, periodsByDay: null, nextChapters: [] }, o || {});
const ep = (o) => Object.assign({ cls: 'Class 7', subj: 'Math', ch: 'fractions', name: 'Fractions', first: at('2026-10-28T06:00:00Z'), last: at('2026-10-30T06:00:00Z'),
  cwaAt: null, cwaFrom: null, remediatedAt: null, plannedCwaDate: null }, o || {});
const run = (st, day, working, plans, cfg, n) => J(ctx.tchMissions_(st, day, working, plans || {}, cfg || {}, n || NOW(day + 'T05:00:00Z')));

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
ms = run(state(), TUE, false);                                                     // an exam day: same flag
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
assert.strictEqual(ms[0].go, 'teacher/index.html#tags');                           // Ruling 13 default
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
assert.strictEqual(ms[0].title, 'Remediate Fractions in Class 7 Math: name this chapter so it counts');
assert.ok(/Fractions/.test(ms[0].why));                                            // no pre-fill map: the chapter is named in why
assert.strictEqual(ms[0].go, 'teacher/index.html#tags');
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
assert.ok(!/Fractions/.test(rem.why) || /Remediation/.test(rem.why));
ms = run(state({ episodes: [cwa1] }), TUE, true, {}, { teacher: { cwhwFormUrl: form } });   // empty map: plain form, chapter in why
assert.strictEqual(kinds(ms, 'remediation_due')[0].go, form); assert.ok(/Fractions/.test(kinds(ms, 'remediation_due')[0].why));
ms = run(state({ episodes: [cwa1] }), TUE, true, {}, { teacher: { cwhwFormUrl: 'https://example.com/form', cwhwPrefill: pre } });   // not a Google Form: no pre-fill
assert.strictEqual(kinds(ms, 'remediation_due')[0].go, 'https://example.com/form');
ms = run(state({ episodes: [cwa1] }), TUE, true, {}, { teacher: { cwhwFormUrl: form + '?hl=en', cwhwPrefill: { cls: 'entry.1' } } });  // existing query string; keys missing from the map are skipped
assert.strictEqual(kinds(ms, 'remediation_due')[0].go, form + '?hl=en&usp=pp_url&entry.1=Class%207');
ms = run(state({ episodes: [cwa1] }), TUE, true, {}, { teacher: { cwhwFormUrl: 42, cwhwPrefill: 'x' } });   // wrong types: defaults
assert.strictEqual(kinds(ms, 'remediation_due')[0].go, 'teacher/index.html#tags');

// ---- activity_plan_due
const nxt = (startDate, o) => Object.assign({ cls: 'Class 7', subj: 'Math', ch: 'decimals', name: 'Decimals', startDate }, o || {});
ms = kinds(run(state({ nextChapters: [nxt('2026-11-15')] }), TUE, true), 'activity_plan_due');            // starts in 5 days
assert.strictEqual(ms.length, 1);
assert.strictEqual(ms[0].due, '2026-11-15'); assert.strictEqual(ms[0].done, false);
assert.strictEqual(ms[0].title, 'Plan an activity for Decimals (Class 7 Math), which starts Sun 15 Nov');
assert.strictEqual(ms[0].go, 'teacher/plan-activity.html?cls=Class%207&subj=Math&ch=decimals');
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

// every mission has the full framework shape
for (const m of run(state({ periodsByDay: tt, episodes: [cwa1, ep({ ch: 'x', plannedCwaDate: '2026-11-05' })], nextChapters: [nxt('2026-11-15')] }), TUE, true)) {
  for (const k of ['id', 'kind', 'title', 'why', 'owner', 'campus', 'go', 'due', 'core', 'shared', 'done', 'doneAt', 'doneBy', 'rolledOver', 'gone']) assert.ok(k in m, m.kind + ' lacks ' + k);
  assert.strictEqual(m.shared, false); assert.strictEqual(m.rolledOver, false);
}

// ---- the wiring: GAME_MODULE_MISSIONS.Teacher
const store = new Map(); let calls = 0, events = [], calErr = false, nowMs = now.getTime();
ctx.CacheService = { getScriptCache: () => ({ get: (k) => (store.has(k) ? store.get(k) : null), put: (k, v) => { store.set(k, v); }, remove: (k) => store.delete(k) }) };
ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: () => 'sheet-id' }) };
const cfgRows = [['Key', 'Value'], ['teacher', JSON.stringify({ examKeywords: ['exam'] })]];
ctx.SpreadsheetApp = { openById: () => ({ getSheetByName: () => ({ getDataRange: () => ({ getValues: () => cfgRows }) }) }) };
ctx.CalendarApp = { getCalendarById: (id) => { assert.strictEqual(id, 'lms.org.in_snflpd3f357jv8l380s8sc4ju0@group.calendar.google.com'); calls++; return { getEvents: (s, e) => { if (calErr) throw new Error('no cal'); assert.strictEqual(e.getTime() - s.getTime(), 86400000); return events.map((t) => ({ getTitle: () => t })); } }; } };
store.set('tch_' + CODE, JSON.stringify(state({ periodsByDay: tt })));
store.set('tch_meta', JSON.stringify({ codes: [CODE], builtAt: nowMs }));
const caller = { email: 't@lms.org.in', campusId: 'LMS4', roles: ['Teacher'], primaryRole: 'Teacher', employeeCode: CODE };
const fw = ctx.gameParseConfig_([['Key', 'Value']]);                                // the framework drops `teacher`: the wiring reads it itself
assert.strictEqual(typeof ctx.GAME_MODULE_MISSIONS.Teacher, 'function');
ms = J(ctx.GAME_MODULE_MISSIONS.Teacher(caller, fw, now));
assert.strictEqual(kinds(ms, 'cwhw_log').length, 1); assert.strictEqual(calls, 1);
ctx.GAME_MODULE_MISSIONS.Teacher(caller, fw, now); assert.strictEqual(calls, 1);   // the campus's events are cached
events = ['Half-Yearly Examination']; store.clear();
store.set('tch_' + CODE, JSON.stringify(state({ periodsByDay: tt }))); store.set('tch_meta', JSON.stringify({ codes: [CODE], builtAt: nowMs }));
assert.strictEqual(J(ctx.GAME_MODULE_MISSIONS.Teacher(caller, fw, now)).length, 0);   // exam keyword from the sheet's teacher row
store.delete('tch_cal_LMS4_' + TUE); events = []; calErr = true;
assert.strictEqual(kinds(J(ctx.GAME_MODULE_MISSIONS.Teacher(caller, fw, now)), 'cwhw_log').length, 1);   // calendar unreadable: a working day, never a throw
calErr = false;
// plans are read through tchPlansFor_ (a stub until Task 6)
assert.deepStrictEqual(J(ctx.tchPlansFor_(CODE)), {}); assert.deepStrictEqual(J(ctx.tchMatchesFor_(CODE)), {});
// no state: no missions, never an error
store.delete('tch_' + CODE); store.set('tch_meta', JSON.stringify({ codes: [], builtAt: nowMs }));
assert.deepStrictEqual(J(ctx.GAME_MODULE_MISSIONS.Teacher(caller, fw, now)), []);
// a caller without an employeeCode (allowlisted) is looked up by email in the Employee Master
const sheet = (rows) => ({ getDataRange: () => ({ getValues: () => rows }) });
const emp = { getSheetByName: (n) => sheet({ EmpPersonal: [['EmployeeCode', 'AuthEmail'], [CODE, 't@lms.org.in']], EmpMaster: [['EmployeeCode', 'Status'], [CODE, 'Active']], EmpSalary: [['EmployeeCode', 'Department'], [CODE, 'Teaching']] }[n]) };
ctx.SpreadsheetApp = { openById: (id) => (id === '1OjVMUvpLM8JkdAwjmljCtZUI1VUqGLbic36cW9dm0C0' ? emp : { getSheetByName: () => ({ getDataRange: () => ({ getValues: () => cfgRows }) }) }) };
store.set('tch_' + CODE, JSON.stringify(state({ periodsByDay: tt })));
const noCode = Object.assign({}, caller); delete noCode.employeeCode;
assert.strictEqual(kinds(J(ctx.GAME_MODULE_MISSIONS.Teacher(noCode, fw, now)), 'cwhw_log').length, 1);
ctx.SpreadsheetApp = { openById: () => { throw new Error('down'); } };
assert.deepStrictEqual(J(ctx.GAME_MODULE_MISSIONS.Teacher(noCode, fw, now)), []);

// ---- Staff: only the caller's own Info Requested rows, same shape as the Principal's
const apr = (id, by, status, o) => { o = o || {}; const r = new Array(19).fill(''); r[0] = id; r[1] = 'LMS4'; r[2] = 'Other'; r[4] = o.title || ('Title ' + id); r[11] = by; r[12] = '2026-11-05T05:00:00Z'; r[13] = status; r[18] = o.archived || ''; return r; };
const rows = [['id'], apr('A1', 't@lms.org.in', 'Info Requested', { title: 'New projector' }), apr('A2', 'other@lms.org.in', 'Info Requested'), apr('A3', 't@lms.org.in', 'Pending'),
  apr('A4', 't@lms.org.in', 'Info Requested', { archived: 'TRUE' }), apr('A5', 'T@lms.org.in', 'Info Requested', { title: 'Chairs' })];
const staff = { email: 't@lms.org.in', campusId: 'LMS4', roles: ['Staff'], primaryRole: 'Staff', employeeCode: CODE };
ctx.SpreadsheetApp = { openById: (id) => { assert.strictEqual(id, '1Tr4Rfc6DN698eeGVjuCoXfSRR-NhBTWJibR00Ibj6P4'); return { getSheetByName: (n) => { assert.strictEqual(n, 'Approvals'); return sheet(rows); } }; } };
ms = J(ctx.GAME_MODULE_MISSIONS.Staff(staff, fw, now));
assert.deepStrictEqual(ms.map((m) => m.id), ['info_requested:A1', 'info_requested:A5']);
assert.strictEqual(ms[0].title, 'Reply to Management about “New projector”'); assert.strictEqual(ms[0].kind, 'info_requested');
assert.strictEqual(ms[0].go, 'teacher/index.html'); assert.strictEqual(ms[0].owner, 't@lms.org.in'); assert.strictEqual(ms[0].campus, 'LMS4');
// the Principal's own path still builds the same shape (one shared builder)
const principal = { email: 't@lms.org.in', campusId: 'LMS4', roles: ['Principal'], primaryRole: 'Principal', canDecide: false };
const pm = J(ctx.gamePrincipalMissions_(principal, { approvals: rows }, fw, now)).filter((m) => m.kind === 'info_requested');
assert.deepStrictEqual(pm.map((m) => m.id), ['info_requested:A1', 'info_requested:A5']);
ctx.SpreadsheetApp = { openById: () => { throw new Error('down'); } };
assert.deepStrictEqual(J(ctx.GAME_MODULE_MISSIONS.Staff(staff, fw, now)), []);
assert.deepStrictEqual(J(ctx.GAME_MODULE_QUESTS.Staff(staff, fw, now)), []);
console.log('teacher-missions: ok');
