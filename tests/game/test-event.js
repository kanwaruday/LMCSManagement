// node tests/game/test-event.js -- the 🎉 event (game-event.gs): detectors, % and level, HES/ALL, scope, the self tick, dedupe. Made-up people only.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const dir = __dirname + '/../../apps-script/';
const ctx = { console: Object.assign(Object.create(console), { error() {}, warn() {} }), Logger: { log() {} } };
vm.createContext(ctx);
['game.gs', 'game-actions.gs', 'game-missions.gs', 'game-quests.gs', 'game-confirm.gs', 'game-office.gs', 'game-kingdom.gs', 'game-teacher.gs', 'game-event.gs']
  .forEach((f) => vm.runInContext(fs.readFileSync(dir + f, 'utf8'), ctx));
const J = (x) => JSON.parse(JSON.stringify(x));

// ---- made-up data
const ALLOW = [['Email', 'Name', 'Campus', 'Roles', 'CanDecide', 'Functions'],
  ['owner@example.org', 'Owner One', 'ALL', 'Owner', 'TRUE', ''],
  ['p4@example.org', 'Dr. Asha Verma', 'LMS4', 'Principal', '', ''],
  ['p3@example.org', 'Kiran Rao', 'LMS3', 'Principal', '', ''],
  ['call@example.org', 'Coord All', 'ALL', 'Coordinator', '', 'Transport'],
  ['c4@example.org', 'Coord Four', 'LMS4', 'Coordinator', '', 'Fees & Accounts'],
  ['fc4@example.org', 'Clerk Four', 'LMS4', 'FeeClerk', '', ''],
  ['T4A@example.org', 'Teacher Allow', 'LMS4', 'Teacher', '', ''],
  ['acc@example.org', 'Accounts One', 'LMS4', 'Accounts', '', ''],
  ['multi@example.org', 'Clerk Multi', 'LMS1,LMS2', 'FeeClerk', '', '']];
const EMP = {
  personal: [['EmployeeCode', 'AuthEmail'], ['NCM/1', 't4b@example.org'], ['NCM/2', 's4@example.org'], ['NCM/3', 'gone@example.org'], ['NCM/4', 'tm@example.org'],
    ['HES/1', 'hes@example.org'], ['NCM/3', 'dup@example.org'], ['NCM/6', 'dup@example.org'], ['NCM/2', 't4a@example.org'], ['NCM/7', 'no-at-sign'], ['DUN/1', 't3@example.org']],
  master: [['EmployeeCode', 'Name', 'Status'], ['NCM/1​', 'Neha Test', 'Active'], ['NCM/2', 'Ravi Test', 'active'], ['NCM/3', 'Gone Test', 'Left'], ['NCM/4', 'Tm Test', 'Active'],
    ['HES/1', 'Hes Test', 'Active'], ['NCM/6', 'Mohan Test', 'Active'], ['NCM/1', 'Second Row', 'Left'], ['DUN/1', 'Tara Test', 'Active']],
  salary: [['EmployeeCode', 'Department'], ['NCM/1', 'Teaching'], ['NCM/2', 'Non-Teaching'], ['NCM/3', 'Teaching'], ['NCM/4', 'AdminTM'], ['HES/1', 'Teaching'], ['NCM/6', 'Teaching'], ['DUN/1', 'Teaching']],
};
const ID = 'gameday-2026-10-30';
let NOW, daily, progress, quests, cfgRows, cache, empThrows, opened, daybook, daybookCalls, views, bookCalls;
const reset = () => {
  NOW = new Date('2026-10-30T06:00:00Z');
  daily = [['Day', 'Email', 'Role', 'Campus', 'MissionIds', 'DoneIds'],
    ['2026-10-30', 'p4@example.org', 'Principal', 'LMS4', '["m1"]', '["m1"]'],
    ['2026-10-30', 't4a@example.org', 'Teacher', 'LMS4', '[]', '[]'],
    ['2026-10-29', 't4b@example.org', 'Teacher', 'LMS4', '[]', '[]'], // the day before: not in
    ['2026-10-30', 'S4@EXAMPLE.ORG', 'Staff', 'LMS4', '[]', '[]']];
  progress = [['Email', 'Kind', 'Key', 'Value', 'At'],
    ...['rooms', 'ss', 'teachers'].map((s) => ['p4@example.org', 'event', 'event:' + ID + ':' + s, 'done', '']),
    ...['chapters', 'classes'].map((s) => ['t4a@example.org', 'event', 'event:' + ID + ':' + s, 'done', '']),
    ['s4@example.org', 'event', 'event:other-event:requests', 'done', ''], // another event's tick never counts
    ['s4@example.org', 'tour', 'event:' + ID + ':requests', 'seen', '']]; // nor does another Kind
  quests = [['QuestId', 'Role', 'Title', 'UnlockAfter', 'StepsJson', 'Reward'], ['q1', 'Teacher', 'Q', '', JSON.stringify([{ id: 'a', title: 'A', check: { kind: 'decision', count: 1 } }]), '']];
  cfgRows = [['Key', 'Value']]; cache = {}; empThrows = false; opened = []; daybookCalls = 0; views = {}; bookCalls = 0;
  daybook = { progress: { LMS4: { cash: { confirmed: 1, known: 0, total: 1 }, odometer: { confirmed: 1, known: 0, total: 1 } } }, states: { LMS4: { cash: { state: 'submitted' }, odometer: { state: 'submitted' } } }, labels: {} };
};
const sheet = (rows) => ({ getDataRange: () => ({ getValues: () => rows }), _rows: rows });
ctx.gameNow_ = () => NOW;
ctx.gameBook_ = () => { bookCalls++; return { getSheetByName: (n) => sheet({ 'Game Config': cfgRows, 'Game Daily': daily, 'Game Progress': progress, 'Game Quests': quests }[n]) }; };
ctx.gameWithLock_ = (fn) => fn();
ctx.gameAppendText_ = (sh, rows) => rows.forEach((r) => sh._rows.push(r));
ctx.CacheService = { getScriptCache: () => ({ get: (k) => cache[k] || null, put: (k, v) => { cache[k] = v; } }) };
ctx.SpreadsheetApp = { openById: (id) => {
  opened.push(id);
  if (id !== ctx.TCH_EMP_SHEET_ID) return { getSheets: () => [sheet(ALLOW)] }; // the allowlist (its id is a const, not on the context)
  if (empThrows) throw new Error('emp down');
  return { getSheetByName: (n) => sheet({ EmpPersonal: EMP.personal, EmpMaster: EMP.master, EmpSalary: EMP.salary }[n]) };
} };
ctx.daybookProgress_ = () => { daybookCalls++; return daybook; };
ctx.cqRead_ = () => [];
ctx.cqView_ = (caller, def, scope) => ({ id: def.id, campus: scope.campus, ring: { done: !!views[def.id + '|' + scope.scopeKey] }, prefillDown: false });
const caller = (email, role, campusId, functions) => ({ email, roles: [role], primaryRole: role, campusId, functions: functions || [], idToken: 't' });
const OWNER = caller('owner@example.org', 'Owner', 'ALL'), P4 = caller('p4@example.org', 'Principal', 'LMS4'), P3 = caller('p3@example.org', 'Principal', 'LMS3');
const T4A = caller('t4a@example.org', 'Teacher', 'LMS4'), S4 = caller('s4@example.org', 'Staff', 'LMS4'), C4 = caller('c4@example.org', 'Coordinator', 'LMS4', ['Fees & Accounts']);
const get = (c) => J(ctx.eventGet_(c, {})), board = (c) => J(ctx.eventBoard_(c, {})), tick = (c, stepId, eventId) => J(ctx.eventTick_(c, { eventId: eventId || ID, stepId }));
const cfg = () => ctx.gameParseConfig_(cfgRows);

// ---- % and level maths
assert.deepStrictEqual([0, 19, 20, 39, 79, 80, 99, 100, 140].map((p) => ctx.eventLevel_(p)), [0, 0, 1, 1, 3, 4, 4, 5, 5]);
assert.strictEqual(ctx.eventPct_(4, 5), 80);
assert.strictEqual(ctx.eventPct_(159, 200), 79, '79.5% is not 80%');
assert.strictEqual(ctx.eventPct_(0, 0), 0, 'nobody expected: 0, never NaN');
assert.strictEqual(ctx.eventFirst_('Dr. Asha Verma'), 'Asha');
assert.strictEqual(ctx.eventFill_('{n} of {of} at {goal}% {x}', { n: 4, of: 6, goal: 80 }), '4 of 6 at 80% {x}');

// ---- config: the default event, a row replaces the list, a wrong type falls back, a malformed event is ignored
reset();
assert.strictEqual(ctx.eventActive_(cfg(), '2026-10-30').id, ID);
assert.strictEqual(ctx.eventActive_(cfg(), '2026-10-31').id, ID, 'stays until showTo');
assert.strictEqual(ctx.eventActive_(cfg(), '2026-10-29'), null);
assert.strictEqual(ctx.eventActive_(cfg(), '2026-11-01'), null);
cfgRows.push(['events', JSON.stringify([{ id: 'bad id!', date: '2026-10-30', steps: {} }, { id: 'later', date: '2026-12-01', steps: { Teacher: [] } }])]);
assert.strictEqual(ctx.eventActive_(cfg(), '2026-10-30'), null, 'the row replaced the list; a malformed event never runs');
cfgRows[1] = ['events', '{"not":"an array"}'];
assert.strictEqual(ctx.eventActive_(cfg(), '2026-10-30').id, ID, 'a non-array falls back to the default');
const evDefault = ctx.eventActive_(cfg(), '2026-10-30');
assert.deepStrictEqual(J(ctx.eventStepsFor_(evDefault, 'Coordinator', ['fees & accounts ']).map((s) => s.id)), ['open', 'followup', 'accounts'], 'fn steps by Functions, case-insensitive');
assert.deepStrictEqual(J(ctx.eventStepsFor_(evDefault, 'Coordinator', []).map((s) => s.id)), ['open', 'followup']);
assert.deepStrictEqual(J(ctx.eventStepsFor_(evDefault, 'Owner', [])), [], 'the Owner has the board, not a checklist');

// ---- roster: allowlist wins, the employee rule (books looped once), dedupe, HES for the Owner and ALL / list campuses
reset();
const roster = J(ctx.eventRosterFrom_(ALLOW, EMP));
const by = {}; roster.forEach((p) => { assert.ok(!by[p.email], 'one row per email: ' + p.email); by[p.email] = p; });
assert.strictEqual(by['owner@example.org'].campusId, 'HES');
assert.strictEqual(by['call@example.org'].campusId, 'HES', 'a Coordinator with ALL campuses counts under HES');
assert.strictEqual(by['multi@example.org'].campusId, 'HES', 'a campus list is not one school');
assert.deepStrictEqual(by['c4@example.org'].functions, ['Fees & Accounts']);
assert.strictEqual(by['t4a@example.org'].role, 'Teacher', 'the allowlist row wins over the Employee Master (lower-cased email)');
assert.strictEqual(by['t4b@example.org'].name, 'Neha Test', 'zero-width characters cleaned; the first EmpMaster row of a code wins');
assert.deepStrictEqual([by['s4@example.org'].role, by['s4@example.org'].campusId], ['Staff', 'LMS4']);
assert.strictEqual(by['dup@example.org'].name, 'Mohan Test', 'the last EmpPersonal row of an email wins');
assert.strictEqual(by['t3@example.org'].campusId, 'LMS3');
['gone@example.org', 'tm@example.org', 'hes@example.org', 'no-at-sign'].forEach((e) => assert.ok(!by[e], e + ' is not expected'));
// same answers as tchEmployeeFromBook_, person by person
const bookOf = { getSheetByName: (n) => sheet({ EmpPersonal: EMP.personal, EmpMaster: EMP.master, EmpSalary: EMP.salary }[n]) };
['t4b@example.org', 's4@example.org', 'gone@example.org', 'tm@example.org', 'hes@example.org', 'dup@example.org', 't3@example.org'].forEach((e) => {
  const t = ctx.tchEmployeeFromBook_(e, bookOf), mine = J(ctx.eventRosterFrom_([ALLOW[0]], EMP)).filter((p) => p.email === e)[0];
  assert.deepStrictEqual(mine ? [mine.role, mine.campusId] : null, t ? [t.role, t.campusId] : null, 'tchEmployeeFromBook_ rule for ' + e);
});
// cached 10 min; an unreadable Employee Master is not cached
reset();
ctx.eventRoster_(); ctx.eventRoster_();
assert.strictEqual(opened.length, 2, 'second call read the cache');
reset(); empThrows = true;
assert.ok(J(ctx.eventRoster_()).every((p) => ALLOW.some((r) => r[0].toLowerCase() === p.email)), 'allowlist only');
assert.ok(!cache[ctx.EVENT_ROSTER_KEY], 'not cached');

// ---- detectors
reset();
const data = ctx.eventData_(ctx.gameBook_(), evDefault, '2026-10-30');
const dctx = { caller: OWNER, cfg: cfg(), now: NOW, data };
const person = (email, role, campusId) => ({ email, role, campusId, functions: [] });
const chk = (check, email, campusId, id) => ctx.eventCheck_({ id: id || 'x', check }, person(email, 'Teacher', campusId || 'LMS4'), dctx);
assert.strictEqual(chk('opened', 'p4@example.org'), true);
assert.strictEqual(chk('opened', 's4@example.org'), true, 'email case in Game Daily');
assert.strictEqual(chk('opened', 't4b@example.org'), false, 'a row before the event day does not count');
assert.strictEqual(chk('missions:1', 'p4@example.org'), true);
assert.strictEqual(chk('missions:2', 'p4@example.org'), false);
assert.strictEqual(chk('missions:1', 't4a@example.org'), false);
assert.strictEqual(chk('self', 'p4@example.org', 'LMS4', 'rooms'), true);
assert.strictEqual(chk('self', 's4@example.org', 'LMS4', 'requests'), false, 'another event or Kind never counts');
assert.strictEqual(chk('quest:q1', 't4a@example.org'), false);
progress.push(['t4a@example.org', 'quest_step', 'q1:_done', 'done', '']);
assert.strictEqual(ctx.eventCheck_({ id: 'x', check: 'quest:q1' }, person('t4a@example.org', 'Teacher', 'LMS4'), { caller: OWNER, cfg: cfg(), now: NOW, data: ctx.eventData_(ctx.gameBook_(), evDefault, '2026-10-30') }), true);
assert.strictEqual(chk('quest:nope', 't4a@example.org'), null, 'no such quest: cannot be told');
const cqCfg = Object.assign(cfg(), { confirmQuests: { p1: { active: true } } });
views['p1|campus:LMS4'] = true;
const cqCtx = { caller: OWNER, cfg: cqCfg, now: NOW, data };
assert.strictEqual(ctx.eventCheck_({ id: 'x', check: 'cq:p1' }, person('p4@example.org', 'Principal', 'LMS4'), cqCtx), true);
assert.strictEqual(ctx.eventCheck_({ id: 'x', check: 'cq:p1' }, person('p3@example.org', 'Principal', 'LMS3'), cqCtx), false, 'per campus');
assert.strictEqual(chk('daybook-setup:submit', 'fc4@example.org'), true);
assert.strictEqual(chk('daybook-setup:approved', 'fc4@example.org'), false);
assert.strictEqual(chk('daybook-setup:submit', 'fc4@example.org', 'LMS3'), null, 'no data for that campus: cannot be told');
assert.strictEqual(daybookCalls, 1, 'the Office is asked once per request');
assert.strictEqual(chk('nonsense', 'p4@example.org'), null);

// ---- gameevent: the Principal's own school only
reset();
let r = get(P4);
assert.strictEqual(r.success, true);
assert.deepStrictEqual(r.event.steps.map((s) => [s.id, s.done, s.self]), [['open', true, false], ['mission', true, false], ['rooms', true, true], ['ss', true, true], ['teachers', true, true]]);
assert.deepStrictEqual([r.event.done, r.event.total], [5, 5]);
assert.strictEqual(r.event.buddy, evDefault.buddy.done);
// LMS4 expected: p4, c4, fc4, t4a (allowlist) + t4b, s4, dup (Employee Master) = 7; finished: p4, t4a; fc4's starting data can't be told for a Principal
assert.deepStrictEqual(r.event.school, { pct: 28, level: 1 });
assert.deepStrictEqual(r.event.teachersIn, { n: 1, of: 3, notIn: ['Neha Test', 'Mohan Test'] });
assert.strictEqual(r.event.steps[4].hint, '1 of 3 teachers are in');
assert.deepStrictEqual(r.event.network, { schoolsAtGoal: 0, of: 6, goalPct: 80, reward: evDefault.reward, line: '0 of 6 schools are at 80%. Every tick helps HQ unlock the reward.' });
assert.strictEqual(daybookCalls, 0, 'a Principal never triggers an Office call');
const raw = JSON.stringify(r);
['Kiran', 'Tara', 'Coord', 'Clerk', 'Ravi', 'example.org', 'LMS3'].forEach((s) => assert.ok(raw.indexOf(s) === -1, 'never leaks ' + s));
// another campus's Principal: their own numbers and teachers only
r = get(P3);
assert.deepStrictEqual(r.event.school, { pct: 0, level: 0 });
assert.deepStrictEqual(r.event.teachersIn, { n: 0, of: 1, notIn: ['Tara Test'] });
['Neha', 'Mohan', 'Asha', 'LMS4'].forEach((s) => assert.ok(JSON.stringify(r).indexOf(s) === -1, 'P3 never sees ' + s));
// a Teacher: no teachersIn, no names at all
r = get(T4A);
assert.deepStrictEqual(r.event.steps.map((s) => s.done), [true, true, true]);
assert.ok(!('teachersIn' in r.event));
['Neha', 'Mohan', 'Asha', 'Ravi'].forEach((s) => assert.ok(JSON.stringify(r).indexOf(s) === -1));
// Buddy's line follows progress
r = get(S4);
assert.deepStrictEqual([r.event.done, r.event.total, r.event.buddy], [1, 2, evDefault.buddy.cheer50]);
// the Owner, an Accounts person: no checklist
assert.strictEqual(get(OWNER).event, null);
assert.strictEqual(get(caller('acc@example.org', 'Accounts', 'LMS4')).event, null);
// a Fee Clerk: the Office is asked as them
r = get(caller('fc4@example.org', 'FeeClerk', 'LMS4'));
assert.deepStrictEqual(r.event.steps.map((s) => [s.id, s.done]), [['starting', true], ['daybook', false], ['phones', false]]);
assert.strictEqual(daybookCalls, 1);
// a Coordinator with ALL campuses: a checklist, no school
r = get(caller('call@example.org', 'Coordinator', 'ALL', ['Transport']));
assert.deepStrictEqual(r.event.steps.map((s) => s.id), ['open', 'followup', 'transport']);
assert.strictEqual(r.event.school, null, 'HES is not a school');
// before the day: nothing; on showTo: a finished person's card steps aside, an unfinished one stays
NOW = new Date('2026-10-29T06:00:00Z');
assert.strictEqual(get(P4).event, null);
NOW = new Date('2026-10-31T06:00:00Z');
assert.strictEqual(get(P4).event, null, 'finished on the day: gone the day after');
assert.notStrictEqual(get(S4).event, null, 'unfinished: still there on showTo');
NOW = new Date('2026-11-01T06:00:00Z');
assert.strictEqual(get(S4).event, null, 'after showTo');
// an error is a fixed sentence, never the raw message
reset();
ctx.gameBook_ = () => { throw new Error('secret detail'); };
assert.deepStrictEqual(get(P4), { success: false, code: 'EVENT_ERROR', error: ctx.EVENT_CODES.EVENT_ERROR });
ctx.gameBook_ = () => { bookCalls++; return { getSheetByName: (n) => sheet({ 'Game Config': cfgRows, 'Game Daily': daily, 'Game Progress': progress, 'Game Quests': quests }[n]) }; };

// ---- gameeventboard: Owner only, refused before anything is read
reset();
[P4, T4A, C4, caller('call@example.org', 'Coordinator', 'ALL'), Object.assign(caller('x@example.org', 'Coordinator', 'ALL'), { roles: ['Coordinator', 'Owner'], primaryRole: 'Coordinator' })].forEach((c) => {
  assert.strictEqual(board(c).code, 'EVENT_OWNER_ONLY');
});
assert.strictEqual(bookCalls, 0, 'nothing read for a refused caller');
assert.strictEqual(opened.length, 0);
let b = board(OWNER);
assert.strictEqual(b.event.upcoming, false);
const s4 = b.schools.filter((s) => s.id === 'LMS4')[0];
// the Owner's Office call sees fc4's starting data (submitted), but fc4 has not opened, so not finished either way
assert.deepStrictEqual([s4.people, s4.in, s4.done, s4.pct, s4.level], [7, 3, 2, 28, 1]);
assert.deepStrictEqual(s4.notIn.slice().sort(), ['Clerk Four', 'Coord Four', 'Mohan Test', 'Neha Test']);
assert.deepStrictEqual(s4.stuck, ['Ravi Test']);
assert.strictEqual(s4.nudge, 'Call Asha ji: 4 people not in yet.');
assert.strictEqual(b.schools.length, 6);
assert.deepStrictEqual(b.schools.map((s) => s.id), ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6']);
assert.strictEqual(b.schools.filter((s) => s.id === 'LMS1')[0].nudge, 'Nobody is listed for this school yet.');
assert.ok(JSON.stringify(b).indexOf('Coord All') === -1 && JSON.stringify(b).indexOf('Owner One') === -1, 'HES people are in no school');
// a school at goal turns the network bar
['t4b', 'dup', 'c4'].forEach((p) => daily.push(['2026-10-30', p + '@example.org', '', '', '["m"]', '["m"]']));
progress.push(['t4b@example.org', 'event', 'event:' + ID + ':chapters', 'done', ''], ['t4b@example.org', 'event', 'event:' + ID + ':classes', 'done', ''],
  ['dup@example.org', 'event', 'event:' + ID + ':chapters', 'done', ''], ['dup@example.org', 'event', 'event:' + ID + ':classes', 'done', ''],
  ['c4@example.org', 'event', 'event:' + ID + ':accounts', 'done', ''], ['s4@example.org', 'event', 'event:' + ID + ':requests', 'done', '']);
b = board(OWNER);
const s4b = b.schools.filter((s) => s.id === 'LMS4')[0];
assert.deepStrictEqual([s4b.done, s4b.pct, s4b.level, s4b.stuck], [6, 85, 4, []], 'fc4 still not in');
assert.strictEqual(s4b.nudge, 'Call Asha ji: 1 person not in yet.');
assert.strictEqual(b.network.schoolsAtGoal, 1);
assert.strictEqual(get(P4).event.network.schoolsAtGoal, 1);
// the Principal not in: no "call them" sentence
daily.splice(1, 1);
assert.strictEqual(board(OWNER).schools.filter((s) => s.id === 'LMS4')[0].nudge, '2 people not in yet, the Principal too.');
// before the day the board shows the coming event
reset(); NOW = new Date('2026-10-28T06:00:00Z');
b = board(OWNER);
assert.deepStrictEqual([b.event.id, b.event.upcoming], [ID, true]);
NOW = new Date('2026-11-05T06:00:00Z');
assert.strictEqual(board(OWNER).event, null);

// ---- gameeventtick: self steps of the caller's own role in the running event only; idempotent
reset();
const before = progress.length;
assert.deepStrictEqual(tick(S4, 'requests'), { success: true, stepId: 'requests', unchanged: false });
assert.strictEqual(progress.length, before + 1);
assert.deepStrictEqual(J(progress[progress.length - 1].slice(0, 4)), ['s4@example.org', 'event', 'event:' + ID + ':requests', 'done']);
assert.deepStrictEqual(tick(S4, 'requests'), { success: true, stepId: 'requests', unchanged: true });
assert.strictEqual(progress.length, before + 1, 'a second tap writes nothing');
assert.strictEqual(tick(S4, 'open').code, 'EVENT_NOT_SELF', 'a detected step cannot be ticked');
assert.strictEqual(tick(T4A, 'rooms').code, 'EVENT_NOT_SELF', "another role's step");
assert.strictEqual(tick(C4, 'transport').code, 'EVENT_NOT_SELF', 'a function step the caller does not hold');
assert.strictEqual(tick(C4, 'accounts').success, true);
assert.strictEqual(tick(OWNER, 'rooms').code, 'EVENT_NOT_SELF');
assert.strictEqual(tick(S4, 'requests', 'other-event').code, 'EVENT_NOT_ACTIVE');
assert.strictEqual(J(ctx.eventTick_(S4, null)).code, 'EVENT_NOT_ACTIVE');
assert.strictEqual(J(ctx.eventTick_(S4, { eventId: ID, stepId: { toString: () => 'requests' } })).code, 'EVENT_NOT_SELF', 'only strings');
NOW = new Date('2026-11-01T06:00:00Z');
assert.strictEqual(tick(S4, 'requests').code, 'EVENT_NOT_ACTIVE', 'after showTo');
// never a GET action
assert.ok(!('gameeventtick' in ctx.GAME_MODULE_ACTIONS));
assert.strictEqual(ctx.GAME_MODULE_ACTIONS.gameevent, ctx.eventGet_);
assert.strictEqual(ctx.GAME_MODULE_ACTIONS.gameeventboard, ctx.eventBoard_);
assert.strictEqual(ctx.gameDispatch_(S4, 'gameeventtick', {}).error, 'Unknown action');

console.log('game event: ok');
