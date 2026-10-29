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
  assert.strictEqual(assign(OWN, { quest: 'hook:daybook-setup', campus: 'LMS4', assignee: 'role:FeeClerk' }).success, true);
  assert.strictEqual(ctx.questGateHookKeep_(keepOf(F4), hook('daybookClerkQuests_'), { questId: 'daybook-setup:LMS4' }), true);
  assert.strictEqual(ctx.questGateHookKeep_(keepOf(P4), hook('daybookClerkQuests_'), { questId: 'daybook-setup:LMS4' }), false);
});
test('role groups: everyone with the role at that campus; the network for Coordinators; bulk to all schools', () => {
  reset();
  const g = assign(OWN, { quest: 'hook:teacher-quests', campus: 'LMS4', assignee: 'role:Teacher' });
  assert.deepStrictEqual(g.owner, { email: 'role:teacher', name: 'All teachers at LMS 4' });
  assert.deepStrictEqual([can(T4, 'hook:teacher-quests'), can(T3, 'hook:teacher-quests'), can(P4, 'hook:teacher-quests')], [true, false, false]);
  assert.strictEqual(ctx.questGateHookKeep_(keepOf(T4), hook('tchQuestsHook_'), { questId: 'chapter:x' }), true);
  for (const c of ['LMS1', 'LMS2', 'LMS3', 'LMS5', 'LMS6']) assert.strictEqual(assign(OWN, { quest: 'hook:teacher-quests', campus: c, assignee: 'role:Teacher' }).success, true, c);
  assert.strictEqual(setup().filter((r) => r[0] === '_owner:hook:teacher-quests').length, 6, 'one owner row per school');
  assert.strictEqual(can(T3, 'hook:teacher-quests'), true);
  assert.strictEqual(assign(OWN, { quest: 'hook:teacher-quests', campus: 'LMS4', assignee: 'role:Teacher' }).unchanged, true, 'idempotent');
  assert.strictEqual(assign(OWN, { quest: 'hook:fleet', campus: '', assignee: 'role:Coordinator' }).success, true);
  assert.strictEqual(can(COORD, 'hook:fleet'), true);
  assert.strictEqual(assign(OWN, { quest: 'hook:fleet', campus: 'LMS1', assignee: 'role:Coordinator' }).code, 'KINGDOM_BAD_CAMPUS', 'a network family');
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
  assign(OWN, { quest: 'hook:teacher-quests', campus: 'LMS4', assignee: 'role:Teacher' });
  assign(OWN, { quest: EV, campus: 'LMS3', assignee: 'p3@example.org' });
  assert.deepStrictEqual([can(V4, 'tc', 'LMS4'), can(V4, 'hook:teacher-quests'), can(V4, EV)], [true, false, false]);
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
  for (const id of [EV + '@LMS1', EV + '@LMS6', EV + '@', 'gq:principal1@LMS4', 'hook:teacher-quests@LMS3', 'hook:fleet@', 'hook:daybook-accountant@']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('gq:principal1@') && !ids.includes('hook:fleet@LMS1'));
  const ev4 = r.rows.find((x) => x.questId === EV && x.campus === 'LMS4');
  assert.deepStrictEqual([ev4.title, ev4.state, ev4.progress, ev4.owner, ev4.go, ev4.stuck, ev4.assignable], ['🎉 Set up the Game Day (Chapter 1: The Keys)', 'open', null, null, 'principal/index.html', false, true]);
  assert.ok(ev4.groups.some((g) => g.value === 'role:Principal' && g.label === 'All principals at LMS 4'));
  assert.ok(ev4.assignees.some((p) => p.email === 'p4@example.org') && !ev4.assignees.some((p) => p.email === 'p3@example.org'));
  assert.deepStrictEqual(r.rows.find((x) => x.questId === 'tc' && x.campus === 'LMS3').groups, [{ value: 'role:Principal', label: 'All principals at LMS 3' }]);
  assign(OWN, { quest: 'hook:teacher-quests', campus: 'LMS3', assignee: 'role:Teacher' });
  const tq = J(ctx.kingdomQuests_(OWN, {})).rows.find((x) => x.questId === 'hook:teacher-quests' && x.campus === 'LMS3');
  assert.deepStrictEqual([tq.owner, tq.held], [null, [{ value: 'role:Teacher', label: 'All teachers at LMS 3' }]], 'a group is a holder, not the owner');
  for (const c of [P4, COORD, T4]) assert.strictEqual(J(ctx.kingdomQuests_(c, {})).code, 'KINGDOM_NOT_YOURS');
  ctx.gameNow_ = () => new Date('2026-11-05T05:00:00Z');
  try { assert.ok(!J(ctx.kingdomQuests_(OWN, {})).rows.some((x) => x.questId === EV), 'a past event is not listed'); } finally { ctx.gameNow_ = () => NOW; }
});

const P4T = mk({ email: 'p4@example.org', roles: ['Principal', 'Teacher'], primaryRole: 'Principal', campusId: 'LMS4' }); // a Principal who also teaches
const bulk = (c, b) => J(ctx.kingdomAssignBulk_(c, b));
test('C1: role groups add up: Principals and Teachers both hold the same event at one school; a clear names its group', () => {
  reset();
  assert.strictEqual(assign(OWN, { quest: EV, campus: 'LMS4', assignee: 'role:Principal' }).success, true);
  assert.strictEqual(assign(OWN, { quest: EV, campus: 'LMS4', assignee: 'role:Teacher' }).success, true);
  assert.deepStrictEqual([can(P4, EV), can(T4, EV), can(F4, EV)], [true, true, false]);
  assert.strictEqual(assign(OWN, { quest: EV, campus: 'LMS4', assignee: 'role:Teacher' }).unchanged, true, 'idempotent per group');
  assert.strictEqual(assign(OWN, { quest: EV, campus: 'LMS4', assignee: 'p4@example.org' }).success, true, 'a person too');
  assert.strictEqual(can(T4, EV), true, 'the person does not replace the groups');
  assert.strictEqual(assign(OWN, { quest: EV, campus: 'LMS4', assignee: 'role:Teacher', clear: true }).success, true);
  assert.deepStrictEqual([can(P4, EV), can(T4, EV)], [true, false], 'only the named group is cleared');
});
test('a person clear names its person: naming someone else changes nothing', () => {
  reset();
  assert.strictEqual(assign(OWN, { quest: EV, campus: 'LMS4', assignee: 'p4@example.org' }).success, true);
  assert.strictEqual(assign(OWN, { quest: EV, campus: 'LMS4', assignee: 'p3@example.org', clear: true }).unchanged, true, 'p3 does not hold it');
  assert.strictEqual(can(P4, EV), true, 'p4 keeps it');
  assert.strictEqual(bulk(OWN, { items: [{ quest: EV, campus: 'LMS4', assignee: 'p3@example.org', clear: true }] }).unchanged, 1, 'bulk too');
  assert.strictEqual(assign(OWN, { quest: EV, campus: 'LMS4', assignee: 'p4@example.org', clear: true }).success, true);
  assert.strictEqual(can(P4, EV), false, 'naming the holder clears it');
});
test('I1: a group matches the primary role only', () => {
  reset();
  assign(OWN, { quest: EV, campus: 'LMS4', assignee: 'role:Teacher' });
  assert.strictEqual(can(P4T, EV), false, 'a Principal who also teaches is not in the Teachers group');
  assign(OWN, { quest: 'tc', campus: 'LMS4', assignee: 'role:Principal' });
  assert.strictEqual(tcMission(P4T).length, 1);
});
test("I2: viewAs previews a person only when they could be this school's Principal", () => {
  reset();
  assign(OWN, { quest: EV, campus: 'LMS4', assignee: 't4@example.org' });
  assert.strictEqual(can(V4, EV), false, 'a Teacher holding it is not what the Principal sees');
  assign(OWN, { quest: EV, campus: 'LMS4', assignee: 'p4@example.org' });
  assert.strictEqual(can(V4, EV), true);
});
test('kingdomassignbulk: Owner only, each item checked, one lock, idempotent, audited per item', () => {
  reset();
  for (const c of [P4, COORD]) assert.strictEqual(bulk(c, { items: [{ quest: EV, campus: 'LMS4', assignee: 'role:Principal' }] }).code, 'KINGDOM_NO_RIGHT');
  assert.strictEqual(bulk(OWN, { items: [] }).code, 'KINGDOM_BAD_INPUT');
  assert.strictEqual(bulk(OWN, { items: 'x' }).code, 'KINGDOM_BAD_INPUT');
  assert.strictEqual(bulk(OWN, { items: new Array(401).fill({ quest: EV, campus: 'LMS4', assignee: 'role:Principal' }) }).code, 'KINGDOM_BAD_INPUT', 'capped at 400');
  assert.strictEqual(setup().length, 0, 'nothing written for a refused batch');
  assert.deepStrictEqual(audit().map((r) => [col(r, 'Result'), col(r, 'Code')]), [['refused', 'KINGDOM_BAD_INPUT'], ['refused', 'KINGDOM_BAD_INPUT'], ['refused', 'KINGDOM_BAD_INPUT']], 'each bad batch audited once (the Owner); a non-Owner is refused before anything');
  audit().length && book.tabs['Game Allocations'].rows.splice(1);
  events.length = 0;
  const items = ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6'].map((c) => ({ quest: EV, campus: c, assignee: 'role:Teacher' }))
    .concat([{ quest: EV, campus: 'LMS4', assignee: 'role:Principal' }, { quest: EV, campus: 'LMS4', assignee: 'role:Principal' },
      { quest: 'nope', campus: 'LMS4', assignee: 'role:Teacher' }, { quest: EV, campus: 'LMS9', assignee: 'role:Teacher' },
      { quest: EV, campus: 'LMS4', assignee: 'p3@example.org' }, { quest: EV, campus: 'LMS4', assignee: 'role:Owner' }, { quest: EV, campus: 'LMS4', clear: true, assignee: 'role:Teacher' }]);
  const r = bulk(OWN, { items });
  assert.deepStrictEqual([r.success, r.done, r.unchanged], [true, 8, 1], 'the repeat is unchanged; the last item clears Teachers at LMS 4');
  assert.deepStrictEqual(r.refused.map((x) => x.code), ['KINGDOM_BAD_QUEST', 'KINGDOM_BAD_CAMPUS', 'KINGDOM_NOT_ELIGIBLE', 'KINGDOM_NOT_ELIGIBLE']);
  assert.strictEqual(events.filter((e) => e === 'lock').length, 1, 'one lock for the batch');
  assert.strictEqual(setup().length, 8, 'one row per grant or clear');
  assert.strictEqual(audit().length, items.length + 1, 'a batch requested row, then an audit row per item');
  assert.deepStrictEqual([col(audit()[0], 'Phase'), col(audit()[0], 'SourceId')], ['requested', 'bulk']);
  assert.deepStrictEqual([can(T3, EV), can(T4, EV), can(P4, EV), can(P3, EV)], [true, false, true, false]);
  const again = bulk(OWN, { items: items.slice(0, 3) });
  assert.deepStrictEqual([again.done, again.unchanged, setup().length], [0, 3, 8], 'idempotent');
  const viaPost = (() => { const saved = ctx.gameVerifyCaller_; ctx.gameVerifyCaller_ = () => J(OWN); try { return JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ action: 'kingdomassignbulk', idToken: 't', items: items.slice(0, 1) }) } }).body); } finally { ctx.gameVerifyCaller_ = saved; } })();
  assert.deepStrictEqual([viaPost.success, viaPost.unchanged], [true, 1], 'dispatched by doPost');
  assert.strictEqual(J(ctx.gameDispatch_(OWN, 'kingdomassignbulk', {})).error, 'Unknown action', 'never over GET');
});
test('setupget lists only assigned quests while the gate is on', () => {
  reset();
  const list = (c) => { ctx.CQ_MEMO = null; return J(ctx.cqGetAction_(c, {})).quests.map((q) => q.id); };
  assert.ok(!list(P4).includes('tc'));
  assign(OWN, { quest: 'tc', campus: 'LMS4', assignee: 'role:Principal' });
  assert.ok(list(P4).includes('tc'));
});

test('setupget quest= and setupsave refuse a quest the Owner has not assigned (no API way round the gate)', () => {
  reset();
  const get1 = (c, p) => { ctx.CQ_MEMO = null; return J(ctx.cqGetAction_(c, p)); };
  const save1 = (c, p) => { ctx.CQ_MEMO = null; return J(ctx.cqSaveAction_(c, p)); };
  const err = (r) => r.code || r.error;
  const before = (book.tabs['Setup Data'] ? book.tabs['Setup Data'].rows.length : 0);
  assert.strictEqual(err(get1(P4, { quest: 'tc' })), 'SETUP_NOT_YOURS', 'read refused before assignment');
  assert.strictEqual(err(save1(P4, { quest: 'tc', item: 'x', fields: { name: 'A' } })), 'SETUP_NOT_YOURS', 'write refused before assignment');
  assert.strictEqual((book.tabs['Setup Data'] ? book.tabs['Setup Data'].rows.length : 0), before, 'nothing written');
  assign(OWN, { quest: 'tc', campus: 'LMS4', assignee: 'role:Principal' });
  const g = get1(P4, { quest: 'tc' });
  assert.strictEqual(g.success, true, JSON.stringify(g));
  assert.deepStrictEqual(g.quests.map((q) => q.campus), ['LMS4']);
  assert.strictEqual(err(get1(P3, { quest: 'tc' })), 'SETUP_NOT_YOURS', 'assigned at LMS4 only: LMS3 still refused');
  assert.notStrictEqual(err(save1(P4, { quest: 'tc', item: 'x', fields: { name: 'A' } })), 'SETUP_NOT_YOURS', 'assigned: the gate lets the write through');
});

test('removal: a group cleared at one school, or at every school in one bulk (clear items)', () => {
  reset();
  bulk(OWN, { items: ['LMS3', 'LMS4'].map((c) => ({ quest: EV, campus: c, assignee: 'role:Teacher' })).concat([{ quest: EV, campus: 'LMS4', assignee: 'p4@example.org' }]) });
  assert.deepStrictEqual([can(T3, EV), can(T4, EV)], [true, true]);
  const r = bulk(OWN, { items: ['LMS3', 'LMS4', 'LMS5'].map((c) => ({ quest: EV, campus: c, assignee: 'role:Teacher', clear: true })) });
  assert.deepStrictEqual([r.done, r.unchanged, r.refused.length], [2, 1, 0], 'LMS5 never had it: unchanged');
  assert.deepStrictEqual([can(T3, EV), can(T4, EV), can(P4, EV)], [false, false, true], 'the person keeps it');
  assert.strictEqual(bulk(OWN, { items: [{ quest: EV, campus: 'LMS4', clear: true }] }).done, 1, 'a clear with no group clears the person');
  assert.strictEqual(can(P4, EV), false);
});

let fail = 0;
for (const [n, fn] of tests) { try { fn(); console.log('ok  ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n  ' + (e.stack || e).split('\n').slice(0, 4).join('\n  ')); } }
if (fail) process.exit(1);
