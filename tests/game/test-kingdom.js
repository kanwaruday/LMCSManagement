// node tests/game/test-kingdom.js -- the Kingdom read model gamekingdom (game-kingdom.gs). Synthetic data only.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const dir = __dirname + '/../../apps-script/';
const ctx = { console: Object.assign(Object.create(console), { error() {}, warn() {} }), Logger: { log() {} } };
vm.createContext(ctx);
['game.gs', 'game-actions.gs', 'game-missions.gs', 'game-confirm.gs', 'game-office.gs', 'game-kingdom.gs'].forEach((f) => vm.runInContext(fs.readFileSync(dir + f, 'utf8'), ctx));
const J = (x) => JSON.parse(JSON.stringify(x));
const NOW = new Date('2026-10-28T06:00:00Z');

// ---- stubs: the engine view, setup steps, Office, Approvals sheet, clock
let views, cfgOverride, daybook, daybookThrows, approvalsRows, setupRows, opened, buddySeen, stepsDone;
const reset = () => {
  views = {}; cfgOverride = {}; daybook = null; daybookThrows = false; approvalsRows = [[]]; setupRows = []; opened = []; buddySeen = null; stepsDone = false;
};
ctx.gameNow_ = () => NOW;
ctx.cqLoadCfg_ = () => Object.assign(J(ctx.gameConfigDefaults_()), cfgOverride);
ctx.cqRead_ = () => setupRows;
ctx.cqView_ = (caller, def, scope) => {
  const v = views[def.id + '|' + scope.scopeKey] || { done: false };
  return { id: def.id, campus: scope.campus, ring: { done: !!v.done }, prefillDown: !!v.down };
};
ctx.setupSteps_ = () => ['signin', 'secret', 'refresh', 'form', 'term', 'suit'].map((id) => ({ id, title: 'Step ' + id, done: stepsDone, locked: false, go: '', guide: 'setup-' + id }));
ctx.buddyDesk_ = () => ({ open: false, seenAt: buddySeen });
ctx.daybookProgress_ = () => { if (daybookThrows) throw new Error('office down'); return daybook; };
ctx.SpreadsheetApp = {
  openById: (id) => {
    opened.push(id);
    return { getSheetByName: () => ({ getDataRange: () => ({ getValues: () => approvalsRows }) }),
      getSheets: () => [{ getDataRange: () => ({ getValues: () => [['email', 'name'], ['owner@example.org', 'Owner One'], ['head1@example.org', 'Head One', 'ALL', 'Coordinator'], ['head2@example.org', 'Head Two', 'LMS1', 'Teacher']] }) }] };
  },
};
const owner = { email: 'owner@example.org', campusId: 'ALL', roles: ['Owner'], primaryRole: 'Owner', idToken: 't' };
const principal4 = { email: 'p4@example.org', campusId: 'LMS4', roles: ['Principal'], primaryRole: 'Principal', idToken: 't' };
const teacher = { email: 't@example.org', campusId: 'LMS4', roles: ['Teacher'], primaryRole: 'Teacher', idToken: 't' };
const C = (confirmed, known, total) => ({ confirmed, known, total });
const base = (o) => Object.assign({ progress: {}, rings: {}, overall: {}, states: {}, labels: {} }, o);
const run = (c) => J(ctx.kingdomGet_(c, {}));
const baseOf = (r, id) => r.kingdom.campuses.filter((b) => b.id === id)[0];
const bld = (b, id) => b.buildings.filter((x) => x.id === id)[0];

// ---- level: building = leading done tiers
assert.strictEqual(ctx.kingdomBuildingLevel_([true, true, false, true]), 2);
assert.strictEqual(ctx.kingdomBuildingLevel_([true, null, true]), 1);
assert.strictEqual(ctx.kingdomBuildingLevel_([]), 0);

// ---- level: base from points (config thresholds)
const at = J(ctx.kingdomCfg_({}).levelAt);
assert.deepStrictEqual([0, 2, 9, 54, 400].map((p) => ctx.kingdomBaseLevel_(p, at)), [1, 2, 4, 10, 10]);
assert.strictEqual(ctx.kingdomBaseLevel_(5, [0, 10]), 1, 'thresholds are config, not constants');
// config: a missing or wrongly typed sub-key falls back to its default
assert.strictEqual(ctx.kingdomCfg_({ kingdom: { levelAt: 'x', followupDueDays: 3 } }).followupDueDays, 3);
assert.strictEqual(J(ctx.kingdomCfg_({ kingdom: { levelAt: 'x' } }).levelAt).length, 10);

// ---- cq ref: campus scope, network shared, inactive or missing def is soon, prefill down is unknown
reset();
cfgOverride = { confirmQuests: { p1: { active: true }, p3: { active: true } } };
views['p1|campus:LMS4'] = { done: true };
views['p1|campus:LMS3'] = { done: false };
views['p3|network'] = { done: true };
let r = run(owner);
const hall = (id) => bld(baseOf(r, id), 'hall').tiers.map((t) => t.state);
assert.deepStrictEqual(hall('LMS4'), ['done', 'soon', 'done', 'soon'], 'p1 campus-scoped, p2 inactive, p3 network, cev missing');
assert.deepStrictEqual(hall('LMS3'), ['open', 'soon', 'done', 'soon']);
assert.deepStrictEqual(hall('LMS1'), hall('LMS5').map((s, i) => (i === 0 ? 'open' : s)), 'network quest: the same on every base');
assert.strictEqual(bld(baseOf(r, 'LMS4'), 'hall').level, 1, 'tier 2 is soon, so the leading run stops at 1');
assert.strictEqual(bld(baseOf(r, 'HES'), 'darbar').tiers[1].state, 'soon', 'cq:o2 does not exist yet');
views['p1|campus:LMS3'] = { down: true };
daybook = base({ progress: { LMS3: { cash: C(0, 0, 3), odometer: C(0, 0, 2) } } });
r = run(owner);
assert.strictEqual(hall('LMS3')[0], 'unknown');
assert.strictEqual(baseOf(r, 'LMS3').unknown, 1);
// a campus quest is not run at HES, and the Darbar has no hall
assert.strictEqual(ctx.kingdomRef_({ caller: owner, cfg: ctx.cqLoadCfg_(), views: {}, setupRows: [], defs: null }, 'HES', 'cq:p1'), null);

// ---- darbar: setup:game tier carries the six steps with guide ids
reset();
r = run(owner);
const dar = bld(baseOf(r, 'HES'), 'darbar');
assert.strictEqual(dar.tiers[0].state, 'open');
assert.deepStrictEqual(dar.tiers[0].steps.map((s) => s.guide), ['signin', 'secret', 'refresh', 'form', 'term', 'suit'].map((s) => 'setup-' + s));
assert.strictEqual(dar.tiers[0].go, 'owner/index.html');
stepsDone = true; buddySeen = '2026-10-28T05:00:00.000Z';
dar.tiers = bld(baseOf(run(owner), 'HES'), 'darbar').tiers;
assert.deepStrictEqual(dar.tiers.map((t) => t.state), ['done', 'soon', 'soon', 'soon', 'done']);
assert.strictEqual(bld(baseOf(run(owner), 'HES'), 'darbar').level, 1, 'tier 2 stops the run');
assert.strictEqual(baseOf(r, 'HES').darbar, true);
assert.strictEqual(baseOf(r, 'LMS1').buildings.some((b) => b.id === 'darbar'), false, 'darbar sits only in HES');
assert.ok(!baseOf(r, 'HES').buildings.some((b) => b.id === 'treasury'), 'campus buildings not at HES');

// ---- treasury: tiers follow daybook-setup steps
reset();
daybook = base({ progress: { LMS4: { cash: C(2, 0, 2), odometer: C(1, 0, 8) }, LMS3: { cash: C(0, 3, 3), odometer: C(0, 1, 2) } } });
r = run(owner);
const tre = bld(baseOf(r, 'LMS4'), 'treasury');
assert.strictEqual(tre.level, 2);
assert.deepStrictEqual(tre.tiers.map((t) => t.state), ['done', 'done', 'open', 'open', 'open']);
assert.ok(tre.tiers.every((t) => t.questId === 'daybook-setup:LMS4'));
assert.deepStrictEqual(tre.tiers.map((t) => t.stepId), ['check', 'cash', 'odometer', 'submit', 'approved']);
assert.ok(tre.tiers[2].go.indexOf('odometer') !== -1);
assert.strictEqual(bld(baseOf(r, 'LMS3'), 'treasury').level, 0);
assert.strictEqual(bld(baseOf(r, 'LMS1'), 'treasury').tiers[0].state, 'unknown', 'no quest for that school: not counted');

// ---- office down: treasury unknown, sourcesDown has office, other buildings still computed
reset(); daybookThrows = true; stepsDone = true;
r = run(owner);
assert.deepStrictEqual(r.sourcesDown, ['office']);
assert.ok(bld(baseOf(r, 'LMS4'), 'treasury').tiers.every((t) => t.state === 'unknown'));
assert.strictEqual(baseOf(r, 'LMS4').unknown, 5);
assert.strictEqual(bld(baseOf(r, 'HES'), 'darbar').tiers[0].state, 'done');
assert.strictEqual(r.success, true);

// ---- principal: only own base, no heads, cards, advice or names; no Approvals sheet read
reset();
approvalsRows = [[], ['a1', 'LMS4', 'Purchase', 'Normal', 'Fans', '', '', '', '', '', '', 'x', '', 'Approved', 'o', NOW.toISOString(), '', '', '', '']];
daybook = base({ progress: { LMS4: { cash: C(2, 0, 2), odometer: C(1, 0, 8) } } });
setupRows = [{ quest: '_owner:p1', scope: 'campus:LMS4', item: '_quest', field: 'owner', value: 'head1@example.org', status: 'assigned', note: '', at: 'x' }];
cfgOverride = { confirmQuests: { p1: { active: true } } };
r = run(principal4);
assert.strictEqual(r.role, 'Principal');
assert.deepStrictEqual(r.kingdom.campuses.map((b) => b.id), ['LMS4']);
['heads', 'cards', 'advice'].forEach((k) => assert.ok(!(k in r), k + ' is Owner only'));
assert.ok(!JSON.stringify(r).includes('Head One') && !JSON.stringify(r).includes('head1@example.org'), 'no owner names or emails');
assert.ok(!baseOf(r, 'LMS4').buildings.some((b) => b.tiers.some((t) => 'owner' in t)));
assert.strictEqual(bld(baseOf(r, 'LMS4'), 'treasury').level, 2);
assert.deepStrictEqual(opened, [], 'no Approvals sheet (and no allowlist) read for a Principal');
const o = run(owner);
assert.ok(opened.indexOf(vm.runInContext('GAME_APPROVALS_SHEET_ID', ctx)) !== -1, 'the Owner does read it');
assert.strictEqual(o.cards.length, 1);
// a Principal whose base is not on the map sees nothing
assert.deepStrictEqual(run(Object.assign({}, principal4, { campusId: 'LMS9' })).kingdom.campuses, []);

// ---- teacher (and Coordinator): KINGDOM_NOT_YOURS, nothing read
reset();
[teacher, { email: 'c@example.org', campusId: 'ALL', roles: ['Coordinator'], primaryRole: 'Coordinator' }].forEach((c) => {
  const res = run(c);
  assert.deepStrictEqual(res, { success: false, code: 'KINGDOM_NOT_YOURS', error: 'The Kingdom is for the Owner.' });
});
assert.deepStrictEqual(opened, []);
ctx.cqRead_ = () => { throw new Error('should not be read'); };
assert.strictEqual(run(teacher).code, 'KINGDOM_NOT_YOURS');
ctx.cqRead_ = () => setupRows;

// ---- cards: approved, unallocated, not hiring, last 60 days, oldest first
const DAY = 86400000, iso = (d) => new Date(NOW.getTime() - d * DAY).toISOString();
const row = (id, campus, cat, status, decided, archived, follow) => {
  const x = new Array(19).fill(''); x[0] = id; x[1] = campus; x[2] = cat; x[4] = 'Title ' + id; x[13] = status; x[15] = decided; x[18] = archived || '';
  x[19] = follow || ''; return x;
};
const cfgK = ctx.kingdomCfg_({});
let cards = J(ctx.kingdomCards_([[], row('new', 'LMS1', 'Purchase', 'Approved', iso(2)), row('old', 'LMS2', 'Event', 'Approved', iso(40)),
  row('stale', 'LMS2', 'Event', 'Approved', iso(61)), row('hire', 'LMS2', 'New/ Backup Position', 'Approved', iso(3)), row('offer', 'LMS2', 'Salary Offer Approval', 'Approved', iso(3)),
  row('pend', 'LMS2', 'Event', 'Pending', iso(3)), row('arch', 'LMS2', 'Event', 'Approved', iso(3), 'TRUE'), row('taken', 'LMS2', 'Event', 'Approved', iso(3), '', 'head1@example.org'),
  row('nodate', 'LMS2', 'Event', 'Approved', ''), row('dateobj', 'LMS3', 'Event', 'Approved', new Date(NOW.getTime() - 10 * DAY))], NOW.getTime(), cfgK));
assert.deepStrictEqual(cards.map((c) => c.id), ['old', 'dateobj', 'new']);
assert.deepStrictEqual(cards[2], { id: 'new', kind: 'approval_followup', title: 'Title new', campus: 'LMS1', category: 'Purchase', decidedAt: iso(2) });
const many = [[]]; for (let i = 0; i < 40; i++) many.push(row('c' + i, 'LMS1', 'Purchase', 'Approved', iso(1 + i / 10)));
assert.strictEqual(ctx.kingdomCards_(many, NOW.getTime(), cfgK).length, 30);

// ---- head missions: open daybook approvals go to finance heads only
reset();
daybook = base({ progress: {}, states: { LMS4: { cash: { state: 'submitted', by: 'Clerk' }, odometer: { state: 'approved' } }, LMS3: { cash: { state: 'draft' } } } });
const heads = [{ id: 'h1', name: 'Accounts head', email: 'head1@example.org', functions: ['finance'], colour: '--f-acc' },
  { id: 'h2', name: 'Transport head', email: 'head2@example.org', functions: ['transport'], colour: '--f-trn' },
  { id: 'h3', name: 'Overall head', email: 'head3@example.org', functions: ['all'], colour: '--f-all' }];
const hm = J(ctx.kingdomHeadMissions_({ daybook }, ctx.kingdomCfg_({ kingdom: { heads } })));
assert.deepStrictEqual(Object.keys(hm), ['h1', 'h3']);
assert.deepStrictEqual(hm.h1.map((m) => m.id), ['daybook_approve:cash:LMS4'], 'the approved one is done, the draft is not an approval');
assert.strictEqual(hm.h1[0].owner, 'head1@example.org');
assert.deepStrictEqual(J(ctx.kingdomHeadMissions_({ daybook: null }, ctx.kingdomCfg_({ kingdom: { heads } }))), {});
cfgOverride = { kingdom: Object.assign(J(ctx.gameConfigDefaults_().kingdom), { heads }) };
r = run(owner);
assert.deepStrictEqual(r.heads.map((h) => h.id), ['h1', 'h2', 'h3'], 'config order');
assert.ok(r.heads.every((h) => !('email' in h)), 'heads leave the server without emails');
assert.deepStrictEqual(r.followHeads, [{ id: 'h1', name: 'Accounts head', email: 'head1@example.org', functions: ['finance'] }], 'follow-up picker: only heads who are Coordinators on the allowlist');
assert.strictEqual(r.heads[0].missions.length, 1);
// M4: a head's mission leaves the server as {id, title, go, done} only: no owner email, no why (it names people)
assert.deepStrictEqual(Object.keys(r.heads[0].missions[0]).sort(), ['done', 'go', 'id', 'title']);
assert.ok(!JSON.stringify(r.heads).includes('@') && !JSON.stringify(r.heads).includes('Clerk'), 'no email or name in heads');
assert.strictEqual(r.heads[1].missions.length, 0);

// ---- owners: latest _owner row wins, cleared removes it
const orow = (q, scope, value, status, at) => ({ quest: '_owner:' + q, scope, item: '_quest', field: 'owner', value, status, note: '', at });
const ow = J(ctx.kingdomOwners_([orow('p1', 'campus:LMS4', 'a@example.org', 'assigned', '1'), orow('p1', 'campus:LMS4', 'B@example.org', 'assigned', '2'),
  orow('p3', 'network', 'a@example.org', 'assigned', '3'), orow('p3', 'network', '', 'cleared', '4'), { quest: 'p1', scope: 'campus:LMS4', item: 'x', field: 'y', value: 'z', status: 'confirmed', at: '5' }]));
assert.deepStrictEqual(Object.keys(ow), ['p1|campus:LMS4']);
assert.strictEqual(ow['p1|campus:LMS4'].email, 'b@example.org');
assert.strictEqual(ow['p1|campus:LMS4'].at, '2');

// ---- advice: first unowned open assignable tier; owner names reach the Owner only
reset();
cfgOverride = { confirmQuests: { p1: { active: true } } };
r = run(owner);
assert.deepStrictEqual(r.advice, { text: 'Assign Sections and class teachers at LMS 1. One tap does it.', go: '#base-LMS1' });
assert.strictEqual(bld(baseOf(r, 'LMS1'), 'hall').tiers[0].assignable, true);
assert.strictEqual(bld(baseOf(r, 'LMS1'), 'hall').tiers[0].questId, 'p1');
// M3: the tier carries its engine scope's campus ('' for a network quest)
assert.strictEqual(bld(baseOf(r, 'LMS1'), 'hall').tiers[0].campus, 'LMS1');
setupRows = ['LMS1', 'LMS2'].map((c, i) => orow('p1', 'campus:' + c, 'head1@example.org', 'assigned', String(i)));
r = run(owner);
assert.strictEqual(r.advice.go, '#base-LMS3', 'owned tiers are skipped');
assert.deepStrictEqual(bld(baseOf(r, 'LMS1'), 'hall').tiers[0].owner, { email: 'head1@example.org', name: 'Head One' });
// no assignable open tier left -> the oldest card -> up to date
views = {}; ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6'].forEach((c) => { views['p1|campus:' + c] = { done: true }; });
r = run(owner);
assert.strictEqual(r.advice.text, 'Every building that can be checked is up to date.');
approvalsRows = [[], row('a1', 'LMS4', 'Purchase', 'Approved', iso(2))];
assert.strictEqual(run(owner).advice.text, 'An approved request is waiting for someone to follow it up.');

// ---- reads only: nothing in the read part of game-kingdom.gs writes (the K3 writes sit after the "Writes:" marker, POST only)
const srcAll = fs.readFileSync(dir + 'game-kingdom.gs', 'utf8'), cut = srcAll.indexOf('═══ Writes:');
assert.ok(cut > 0, 'writes marker present');
const src = srcAll.slice(0, cut);
assert.ok(!/appendRow|setValues|gameAppendText_|gameWithLock_|\.put\(|setProperty/.test(src), 'gamekingdom is a pure read');
assert.strictEqual(ctx.GAME_MODULE_ACTIONS.gamekingdom, ctx.kingdomGet_);
// no staff names, emails or ids in the shipped defaults
assert.ok(!/@/.test(JSON.stringify(ctx.gameConfigDefaults_().kingdom)));

// ---- rights (K3 uses it): only an Owner whose role or email is listed
const can = (c, k) => ctx.kingdomCan_(c, 'allocate', { kingdom: k });
assert.strictEqual(can(owner, undefined), true);
assert.strictEqual(can({ email: 'c@example.org', roles: ['Coordinator'] }, { rights: { allocate: { roles: ['Owner', 'Coordinator'], emails: ['c@example.org'] } } }), false);
assert.strictEqual(can(owner, { rights: { allocate: { roles: [], emails: ['owner@example.org'] } } }), true);
assert.strictEqual(can(owner, { rights: { allocate: { roles: ['Coordinator'], emails: [] } } }), false);
console.log('game kingdom: ok');
