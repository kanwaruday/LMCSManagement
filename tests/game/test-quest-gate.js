// node tests/game/test-quest-gate.js -- the setup-period quest gate (game-kingdom.gs questGateKeep_): Owner-assigned quests only, every role
// but the Owner, by person or role group; kingdomassign / kingdomquests for the gated families; the gate in setup missions and the event.
// Synthetic data only.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const dir = __dirname + '/../../apps-script/';
const store = new Map(), events = [], warns = [], logs = [];
let lockFails = false, fetches = [], fetchReply = null;
function fakeSheet(rows) {
  const sh = {
    rows,
    getDataRange: () => ({ getValues: () => sh.rows.map((r) => r.slice()) }),
    getLastRow: () => sh.rows.length,
    getRange: (row, col) => {
      const rg = { setNumberFormat: () => rg, setValues: (vals) => { vals.forEach((v, i) => { const r = sh.rows[row - 1 + i] = sh.rows[row - 1 + i] || []; v.forEach((x, j) => { r[col - 1 + j] = x; }); }); return rg; } };
      return rg;
    },
  };
  return sh;
}
const book = { tabs: {}, getSheetByName: (n) => book.tabs[n] || null, insertSheet: (n) => (book.tabs[n] = fakeSheet([])) };
const ALLOW = [['email', 'name', 'campus', 'roles', 'canDecide'],
  ['owner@example.org', 'Owner One', 'ALL', 'Owner', 'TRUE'],
  ['p4@example.org', 'Principal Four', 'LMS4', 'Principal', ''],
  ['p3@example.org', 'Principal Three', 'LMS3', 'Principal', ''],
  ['c1@example.org', 'Coordinator One', 'LMS1', 'Coordinator', 'TRUE'],
  ['t4@example.org', 'Teacher Four', 'LMS4', 'Teacher', ''],
  ['t3@example.org', 'Teacher Three', 'LMS3', 'Teacher', ''],
  ['f4@example.org', 'Clerk Four', 'LMS4', 'FeeClerk', '']];
const allowBook = { getSheets: () => [fakeSheet(ALLOW)] };
const ctx = {
  console: { log: (m) => logs.push(String(m)), error: (m) => logs.push(String(m)), warn: (m) => warns.push(String(m)) },
  CacheService: { getScriptCache: () => ({ get: (k) => (store.has(k) ? store.get(k) : null), put: (k, v) => { store.set(k, String(v)); }, remove: (k) => { store.delete(k); } }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === 'GAME_SHEET_ID' ? 'GAME_BOOK' : null) }) },
  LockService: { getScriptLock: () => ({ waitLock: () => { if (lockFails) throw new Error('lock'); events.push('lock'); }, releaseLock: () => events.push('unlock') }) },
  UrlFetchApp: { fetch: (url, opts) => {
    events.push('fetch');
    fetches.push({ url, opts });
    if (fetchReply === 'throw') throw new Error('network down');
    if (fetchReply === 'http500') return { getResponseCode: () => 500, getContentText: () => '<html>' };
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify(fetchReply) };
  } },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType: () => ({ body: s }) }) },
};
vm.createContext(ctx);
['game.gs', 'game-actions.gs', 'game-missions.gs', 'game-confirm.gs', 'game-office.gs', 'game-buddy.gs', 'game-kingdom.gs', 'game-event.gs'].forEach((f) => vm.runInContext(fs.readFileSync(dir + f, 'utf8'), ctx));
ctx.SpreadsheetApp = { openById: (id) => (id === vm.runInContext('GAME_ALLOWLIST_SHEET_ID', ctx) ? allowBook : book) };
const J = (x) => JSON.parse(JSON.stringify(x));
const NOW = new Date('2026-10-29T05:00:00Z');
ctx.gameNow_ = () => NOW;
ctx.daybookProgress_ = () => null;
ctx.cqDefaults_ = () => ({}); // test definitions only (as test-confirm.js does)
const f = (id) => ({ id, label: id, type: 'text', required: true });
const DEFS = {
  tc: { title: 'Campus step', task: 'Do the campus step', scope: 'campus', roles: ['Principal'], fields: [f('name')], prefill: 'test.one' },
  tn: { title: 'Network step', task: 'Do the network step', scope: 'network', roles: ['Coordinator'], fields: [f('name')], prefill: 'test.one' },
  toff: { title: 'Off', scope: 'campus', roles: ['Principal'], fields: [f('name')], active: false },
  tself: { title: 'Mine', scope: 'self', roles: ['Teacher'], fields: [f('name')] },
};
const KINGDOM = { buildings: [{ id: 'hall', name: 'Hall', where: 'campus', tiers: [{ label: 'Campus step', refs: ['cq:tc'], owners: ['tc'] }] },
  { id: 'post', name: 'Post', where: 'darbar', tiers: [{ label: 'Network step', refs: ['cq:tn'], owners: ['tn'] }] }] };
const reset = (cfgExtra) => {
  const cfg = Object.assign({ confirmQuests: DEFS, kingdom: KINGDOM }, cfgExtra || {}); // no setupPeriod row: the gate is on by its default
  book.tabs = { 'Game Config': fakeSheet([['Key', 'Value']].concat(Object.keys(cfg).map((k) => [k, JSON.stringify(cfg[k])]))),
    'Game Quests': fakeSheet([['QuestId', 'Role', 'Title', 'UnlockAfter', 'StepsJson', 'Reward'], ['principal1', 'Principal', 'Your portal', '', '[]', '']]),
    'Game Daily': fakeSheet([['Day']]), 'Game Progress': fakeSheet([['Email', 'Kind', 'Key', 'Value', 'At']]) };
  events.length = 0; warns.length = 0; logs.length = 0; fetches = []; fetchReply = null; lockFails = false; ctx.CQ_MEMO = null;
  ctx.CQ_PREFILL['test.one'] = () => [{ item: 'a', fields: { name: 'Sample' } }];
};
const mk = (o) => Object.assign({ campusId: 'ALL', idToken: 'tok-' + o.email.split('@')[0] }, o);
const OWN = mk({ email: 'owner@example.org', roles: ['Owner'], primaryRole: 'Owner' });
const COORD = mk({ email: 'c1@example.org', roles: ['Coordinator'], primaryRole: 'Coordinator', campusId: 'LMS1' });
const P4 = mk({ email: 'p4@example.org', roles: ['Principal'], primaryRole: 'Principal', campusId: 'LMS4' });
const P3 = mk({ email: 'p3@example.org', roles: ['Principal'], primaryRole: 'Principal', campusId: 'LMS3' });
const assign = (c, b) => J(ctx.kingdomAssign_(c, b));
const allocate = (c, b) => J(ctx.kingdomAllocate_(c, b));
const rows = (tab) => (book.tabs[tab] ? book.tabs[tab].rows.slice(1) : []);
const setup = () => rows('Setup Data');
const audit = () => rows('Game Allocations');
const H = J(vm.runInContext('KINGDOM_ALLOC_HEADER', ctx));
const col = (r, name) => r[H.indexOf(name)];
const T4 = mk({ email: 't4@example.org', roles: ['Teacher'], primaryRole: 'Teacher', campusId: 'LMS4' });
const T3 = mk({ email: 't3@example.org', roles: ['Teacher'], primaryRole: 'Teacher', campusId: 'LMS3' });
const F4 = mk({ email: 'f4@example.org', roles: ['FeeClerk'], primaryRole: 'FeeClerk', campusId: 'LMS4' });
const V4 = mk({ email: 'owner@example.org', roles: ['Principal'], primaryRole: 'Principal', campusId: 'LMS4', viewAs: true }); // the Owner viewing LMS4
const EV = 'event:gameday-2026-10-30';
const keepOf = (c) => ctx.questGateKeep_(c, ctx.cqLoadCfg_());
const can = (c, fam, campus) => { const k = keepOf(c); return k === null ? 'ungated' : k(fam, campus); };
const tcMission = (c) => { ctx.CQ_MEMO = null; return J(ctx.cqMissions_(c, ctx.cqLoadCfg_(), NOW)).filter((m) => m.id.indexOf('cq_tc') === 0); };
const hook = (name) => ({ name });
const tests = [];
const test = (n, fn) => tests.push([n, fn]);

test('on by default for every role but the Owner; the switch off = old behaviour', () => {
  reset();
  assert.strictEqual(keepOf(OWN), null, 'the Owner is never gated');
  for (const c of [P4, COORD, T4, F4, V4]) assert.strictEqual(typeof keepOf(c), 'function', c.primaryRole);
  assert.strictEqual(typeof ctx.questGateKeep_(P4, {}), 'function', 'a config with no setupPeriod: on');
  assert.deepStrictEqual(tcMission(P4), [], 'unassigned: no setup mission');
  reset({ setupPeriod: { ownerAssignedQuestsOnly: false } });
  assert.strictEqual(keepOf(P4), null);
  assert.strictEqual(tcMission(P4).length, 1, 'off: the unassigned mission is back');
});
test('a Principal gets nothing until assigned, then only their own; another campus never leaks', () => {
  reset();
  assert.deepStrictEqual([can(P4, 'tc', 'LMS4'), can(P4, EV), can(P4, 'gq:principal1')], [false, false, false]);
  assert.strictEqual(assign(OWN, { quest: 'tc', campus: 'LMS4', assignee: 'p4@example.org' }).success, true);
  assert.strictEqual(assign(OWN, { quest: EV, campus: 'LMS3', assignee: 'p3@example.org' }).success, true);
  assert.strictEqual(assign(OWN, { quest: 'gq:principal1', campus: 'LMS4', assignee: 'p4@example.org' }).success, true);
  assert.deepStrictEqual(tcMission(P4).map((m) => [m.campus, m.why]), [['LMS4', 'Assigned by the Owner']]);
  assert.deepStrictEqual([can(P4, EV), can(P4, 'gq:principal1'), can(P3, EV), can(P3, 'gq:principal1'), can(P3, 'tc', 'LMS3')], [false, true, true, false, false]);
  assert.deepStrictEqual(tcMission(P3), [], "LMS4's assignment is not LMS3's");
  const row = setup().find((r) => r[0] === '_owner:' + EV);
  assert.deepStrictEqual(row.slice(0, 6), ['_owner:' + EV, 'campus:LMS3', '_quest', 'owner', 'p3@example.org', 'assigned']);
});
test('hook quests: a cq quest by its id and campus, other hooks by family', () => {
  reset();
  assert.strictEqual(ctx.questGateHookKeep_(keepOf(P4), hook('cqQuests_'), { questId: 'cq:tc:LMS4' }), false);
  assign(OWN, { quest: 'tc', campus: 'LMS4', assignee: 'p4@example.org' });
  const k = keepOf(P4);
  assert.strictEqual(ctx.questGateHookKeep_(k, hook('cqQuests_'), { questId: 'cq:tc:LMS4' }), true);
  assert.strictEqual(ctx.questGateHookKeep_(k, hook('cqQuests_'), { questId: 'cq:tc:LMS3' }), false);
  assert.strictEqual(ctx.questGateHookKeep_(k, hook('somethingNew_'), { questId: 'x' }), false, 'an unknown hook stays hidden');
  assert.strictEqual(assign(OWN, { quest: 'daybook-setup', campus: 'LMS4', assignee: 'role:FeeClerk' }).success, true);
  assert.strictEqual(ctx.questGateHookKeep_(keepOf(F4), hook('daybookClerkQuests_'), { questId: 'daybook-setup:LMS4' }), true);
  assert.strictEqual(ctx.questGateHookKeep_(keepOf(P4), hook('daybookClerkQuests_'), { questId: 'daybook-setup:LMS4' }), false);
});
test('role groups: everyone with the role at that campus; the network for Coordinators; bulk to all schools', () => {
  reset();
  const g = assign(OWN, { quest: 'teacher-quests', campus: 'LMS4', assignee: 'role:Teacher' });
  assert.deepStrictEqual(g.owner, { email: 'role:teacher', name: 'All teachers at LMS 4' });
  assert.deepStrictEqual([can(T4, 'teacher-quests'), can(T3, 'teacher-quests'), can(P4, 'teacher-quests')], [true, false, false]);
  assert.strictEqual(ctx.questGateHookKeep_(keepOf(T4), hook('tchQuestsHook_'), { questId: 'chapter:x' }), true);
  for (const c of ['LMS1', 'LMS2', 'LMS3', 'LMS5', 'LMS6']) assert.strictEqual(assign(OWN, { quest: 'teacher-quests', campus: c, assignee: 'role:Teacher' }).success, true, c);
  assert.strictEqual(setup().filter((r) => r[0] === '_owner:teacher-quests').length, 6, 'one owner row per school');
  assert.strictEqual(can(T3, 'teacher-quests'), true);
  assert.strictEqual(assign(OWN, { quest: 'teacher-quests', campus: 'LMS4', assignee: 'role:Teacher' }).unchanged, true, 'idempotent');
  assert.strictEqual(assign(OWN, { quest: 'fleet', campus: '', assignee: 'role:Coordinator' }).success, true);
  assert.strictEqual(can(COORD, 'fleet'), true);
  assert.strictEqual(assign(OWN, { quest: 'fleet', campus: 'LMS1', assignee: 'role:Coordinator' }).code, 'KINGDOM_BAD_CAMPUS', 'a network family');
  assert.strictEqual(assign(OWN, { quest: 'tc', campus: 'LMS3', assignee: 'role:Principal' }).success, true, 'a cq quest takes its own roles');
  assert.strictEqual(can(P3, 'tc', 'LMS3'), true);
});
test('kingdomassign refuses a bad family, campus, group or person', () => {
  reset();
  const code = (b) => assign(OWN, b).code;
  assert.strictEqual(code({ quest: 'event:nope', campus: 'LMS4', assignee: 'p4@example.org' }), 'KINGDOM_BAD_QUEST');
  assert.strictEqual(code({ quest: 'gq:nope', campus: 'LMS4', assignee: 'p4@example.org' }), 'KINGDOM_BAD_QUEST');
  assert.strictEqual(code({ quest: 'hook:x', campus: 'LMS4', assignee: 'p4@example.org' }), 'KINGDOM_BAD_QUEST');
  assert.strictEqual(code({ quest: EV, campus: 'LMS9', assignee: 'p4@example.org' }), 'KINGDOM_BAD_CAMPUS');
  assert.strictEqual(code({ quest: 'gq:principal1', campus: '', assignee: 'p4@example.org' }), 'KINGDOM_BAD_CAMPUS', 'a Principal family runs per school');
  assert.strictEqual(code({ quest: EV, campus: 'LMS4', assignee: 'p3@example.org' }), 'KINGDOM_NOT_ELIGIBLE', "another school's Principal");
  assert.strictEqual(code({ quest: 'gq:principal1', campus: 'LMS4', assignee: 't4@example.org' }), 'KINGDOM_NOT_ELIGIBLE', 'not a Principal');
  assert.strictEqual(code({ quest: 'gq:principal1', campus: 'LMS4', assignee: 'role:Teacher' }), 'KINGDOM_NOT_ELIGIBLE', "not the family's role");
  assert.strictEqual(code({ quest: 'gq:principal1', campus: 'LMS4', assignee: 'role:Owner' }), 'KINGDOM_NOT_ELIGIBLE');
  assert.strictEqual(code({ quest: 'gq:principal1', campus: 'LMS4', assignee: 'role:' }), 'KINGDOM_NOT_ELIGIBLE');
  assert.strictEqual(assign(P4, { quest: EV, campus: 'LMS4', assignee: 'p4@example.org' }).code, 'KINGDOM_NO_RIGHT', 'Owner only');
  assert.strictEqual(setup().length, 0);
});
test("viewAs previews the school's assignments (people and the Principals' group only)", () => {
  reset();
  assert.strictEqual(can(V4, 'tc', 'LMS4'), false);
  assign(OWN, { quest: 'tc', campus: 'LMS4', assignee: 'p4@example.org' });
  assign(OWN, { quest: 'teacher-quests', campus: 'LMS4', assignee: 'role:Teacher' });
  assign(OWN, { quest: EV, campus: 'LMS3', assignee: 'p3@example.org' });
  assert.deepStrictEqual([can(V4, 'tc', 'LMS4'), can(V4, 'teacher-quests'), can(V4, EV)], [true, false, false]);
  assert.strictEqual(tcMission(V4).length, 1);
  assign(OWN, { quest: EV, campus: 'LMS4', assignee: 'role:Principal' });
  assert.strictEqual(can(V4, EV), true);
});
test('gameevent / gameeventtick: hidden and refused until the event is assigned', () => {
  reset();
  const savedShared = ctx.eventShared_;
  ctx.gameNow_ = () => new Date('2026-10-30T05:00:00Z');
  ctx.eventShared_ = () => ({ sum: { complete: false, stats: {} }, names: {} });
  try {
    assert.deepStrictEqual(J(ctx.eventGet_(P4, {})), { success: true, event: null });
    assert.strictEqual(J(ctx.eventTick_(P4, { eventId: 'gameday-2026-10-30', stepId: 'rooms' })).code, 'EVENT_NOT_ACTIVE');
    assert.strictEqual(rows('Game Progress').length, 0, 'nothing ticked');
    assign(OWN, { quest: EV, campus: 'LMS4', assignee: 'p4@example.org' });
    const ev = J(ctx.eventGet_(P4, {}));
    assert.strictEqual(ev.success, true);
    assert.strictEqual(ev.event.id, 'gameday-2026-10-30');
    assert.strictEqual(J(ctx.eventTick_(P4, { eventId: 'gameday-2026-10-30', stepId: 'rooms' })).success, true);
    assert.deepStrictEqual(J(ctx.eventGet_(P3, {})), { success: true, event: null }, 'LMS3 still hidden');
    assert.strictEqual(J(ctx.eventGet_(T4, {})).event, null, 'a Teacher too (every role)');
  } finally { ctx.gameNow_ = () => NOW; ctx.eventShared_ = savedShared; }
});
test('kingdomquests lists the families with role groups (Owner only)', () => {
  reset();
  ctx.daybookProgress_ = () => null;
  const r = J(ctx.kingdomQuests_(OWN, {}));
  assert.strictEqual(r.success, true);
  const ids = r.rows.map((x) => x.questId + '@' + x.campus);
  for (const id of [EV + '@LMS1', EV + '@LMS6', EV + '@', 'gq:principal1@LMS4', 'teacher-quests@LMS3', 'fleet@', 'daybook-accountant@']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('gq:principal1@') && !ids.includes('fleet@LMS1'));
  const ev4 = r.rows.find((x) => x.questId === EV && x.campus === 'LMS4');
  assert.deepStrictEqual([ev4.title, ev4.state, ev4.progress, ev4.owner, ev4.go, ev4.stuck, ev4.assignable], ['🎉 Set up the Game Day (Chapter 1: The Keys)', 'open', null, null, 'principal/index.html', false, true]);
  assert.ok(ev4.groups.some((g) => g.value === 'role:Principal' && g.label === 'All principals at LMS 4'));
  assert.ok(ev4.assignees.some((p) => p.email === 'p4@example.org') && !ev4.assignees.some((p) => p.email === 'p3@example.org'));
  assert.deepStrictEqual(r.rows.find((x) => x.questId === 'tc' && x.campus === 'LMS3').groups, [{ value: 'role:Principal', label: 'All principals at LMS 3' }]);
  assign(OWN, { quest: 'teacher-quests', campus: 'LMS3', assignee: 'role:Teacher' });
  assert.deepStrictEqual(J(ctx.kingdomQuests_(OWN, {})).rows.find((x) => x.questId === 'teacher-quests' && x.campus === 'LMS3').owner, { email: 'role:teacher', name: 'All teachers' });
  for (const c of [P4, COORD, T4]) assert.strictEqual(J(ctx.kingdomQuests_(c, {})).code, 'KINGDOM_NOT_YOURS');
  ctx.gameNow_ = () => new Date('2026-11-05T05:00:00Z');
  try { assert.ok(!J(ctx.kingdomQuests_(OWN, {})).rows.some((x) => x.questId === EV), 'a past event is not listed'); } finally { ctx.gameNow_ = () => NOW; }
});

let fail = 0;
for (const [n, fn] of tests) { try { fn(); console.log('ok  ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n  ' + (e.stack || e).split('\n').slice(0, 4).join('\n  ')); } }
if (fail) process.exit(1);
