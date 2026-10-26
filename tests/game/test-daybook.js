// node tests/game/test-daybook.js -- Day Book starting data missions and quests (game-office.gs). Synthetic data only.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const dir = __dirname + '/../../apps-script/';
const ctx = { console: Object.assign(Object.create(console), { error() {} }), Logger: { log() {} } };
vm.createContext(ctx);
const load = (f) => vm.runInContext(fs.readFileSync(dir + f, 'utf8'), ctx);
load('game-office.gs'); load('game.gs'); load('game-actions.gs'); load('game-missions.gs'); load('game-quests.gs');
const J = (x) => JSON.parse(JSON.stringify(x));

// Apps Script services: a recording UrlFetchApp, a real-ish cache, Script Properties
let store = {}, props = {}, calls = [], answer;
ctx.CacheService = { getScriptCache: () => ({ get: (k) => (k in store ? store[k] : null), put: (k, v) => { store[k] = v; } }) };
ctx.Utilities = { DigestAlgorithm: { MD5: 'md5' }, computeDigest: (a, t) => Array.from(require('crypto').createHash('md5').update(t).digest()), base64EncodeWebSafe: (b) => Buffer.from(b).toString('base64url') };
ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null) }) };
ctx.UrlFetchApp = { fetch: (url) => { calls.push(url); const a = typeof answer === 'function' ? answer(url) : answer; return { getResponseCode: () => a.code || 200, getContentText: () => a.body }; } };
const ok = (body) => ({ body: JSON.stringify(Object.assign({ success: true }, body)) });
const reset = (a) => { store = {}; calls = []; answer = a; };

const NOW = new Date('2026-10-26T05:00:00Z'), cfg = J(ctx.gameConfigDefaults_());
const acc = { email: 'Acc@test.invalid', campusId: 'ALL', roles: ['Accounts'], primaryRole: 'Accounts', idToken: 'tok-acc' };
const clerk = { email: 'clerk@test.invalid', campusId: 'LMS4', roles: ['FeeClerk'], primaryRole: 'FeeClerk', idToken: 'tok-clerk' };
const owner = { email: 'owner@test.invalid', campusId: 'ALL', roles: ['Owner'], primaryRole: 'Owner', idToken: 'tok-owner' };
const C = (confirmed, known, total) => ({ confirmed, known, total });
const PROG = {
  progress: {
    LMS4: { cash: C(0, 2, 2), bank: C(4, 0, 4), odometer: C(1, 2, 8), loan: C(0, 0, 6), users: C(0, 0, 0) },
    HES: { cash: C(2, 0, 2), bank: C(0, 0, 0), odometer: C(0, 0, 0), users: C(0, 0, 0) },
    ALL: { supplier: C(0, 3, 12), users: C(5, 0, 5) },
  },
  rings: {}, overall: {},
};

// ---- registration
const hooks = (reg, role) => J(ctx.gameModuleHooks_(ctx[reg], role).map((f) => f.name));
assert.ok(hooks('GAME_MODULE_MISSIONS', 'Accounts').includes('daybookMissions_'));
assert.ok(hooks('GAME_MODULE_MISSIONS', 'FeeClerk').includes('daybookMissions_'));
assert.ok(!hooks('GAME_MODULE_MISSIONS', 'Owner').includes('daybookMissions_'));
assert.ok(hooks('GAME_MODULE_MISSIONS', 'Owner').includes('daybookOwnerWarm_'), 'warms the cache outside the lock');
assert.ok(hooks('GAME_MODULE_MISSIONS', 'Coordinator').includes('daybookMissions_'), 'an Accounts + Coordinator person');
assert.ok(hooks('GAME_MODULE_QUESTS', 'Owner').includes('daybookQuests_'));
assert.ok(hooks('GAME_MODULE_QUESTS', 'Accounts').includes('daybookQuests_'));

// ---- the fetch: Office URL (constant = office/js/config.js), caller's own token, action start.progress
reset(ok(PROG));
let ms = J(ctx.daybookMissions_(acc, cfg, NOW));
assert.strictEqual(calls.length, 1);
const officeUrl = /OFFICE_BACKEND_URL = '([^']+)'/.exec(fs.readFileSync(__dirname + '/../../office/js/config.js', 'utf8'))[1];
assert.strictEqual(calls[0], officeUrl + '?action=start.progress&idToken=tok-acc');
props.OFFICE_BACKEND_URL = 'https://script.google.com/macros/s/TESTOFFICE/exec';
reset(ok(PROG)); ctx.daybookMissions_(acc, cfg, NOW);
assert.ok(calls[0].startsWith('https://script.google.com/macros/s/TESTOFFICE/exec?'), 'Script Property overrides the constant');
delete props.OFFICE_BACKEND_URL;

// ---- cached per caller: a second load (and the quests) do not fetch; another caller does
reset(ok(PROG));
ctx.daybookMissions_(acc, cfg, NOW); ctx.daybookQuests_(acc, cfg, NOW); ctx.daybookMissions_(acc, cfg, NOW);
assert.strictEqual(calls.length, 1);
assert.strictEqual(Object.keys(store).length, 1, 'cached once for this caller');
ctx.daybookMissions_(clerk, cfg, NOW);
assert.strictEqual(calls.length, 2);

// ---- missions: one per (quest, school) with figures, open and done, in play order
reset(ok(PROG));
ms = J(ctx.daybookMissions_(acc, cfg, NOW));
assert.deepStrictEqual(ms.map((m) => m.id), ['daybook_cash:LMS4', 'daybook_bank:LMS4', 'daybook_odometer:LMS4', 'daybook_loan:LMS4', 'daybook_cash:HES', 'daybook_supplier:ALL', 'daybook_users:ALL']);
const cash = ms[0];
assert.deepStrictEqual(cash, { id: 'daybook_cash:LMS4', kind: 'daybook_cash', title: 'Confirm 2 starting figures for LMS 4', why: 'Cash in hand', owner: 'Acc@test.invalid',
  campus: 'LMS4', go: 'office/starting-data.html?campus=LMS4&quest=cash', due: null, core: false, shared: true, done: false, doneAt: null, doneBy: null,
  rolledOver: false, gone: false, progress: { done: 0, total: 2 } });
assert.strictEqual(ms[2].title, 'Confirm 7 starting figures for LMS 4');
assert.strictEqual(ms[5].title, 'Confirm 12 starting figures for all schools');
assert.strictEqual(ms[1].done, true); assert.strictEqual(ms[1].title, 'Confirm 0 starting figures for LMS 4');
assert.strictEqual(ms[5].go, 'office/starting-data.html?campus=ALL&quest=supplier');
assert.ok(ms.every((m) => m.kind.startsWith('daybook') && !m.core && m.shared));
assert.ok(!ms.some((m) => m.id === 'daybook_users:LMS4'), 'nothing to confirm: no mission');
reset(ok({ progress: { LMS4: { cash: C(1, 0, 2) } } }));
assert.strictEqual(J(ctx.daybookMissions_(clerk, cfg, NOW))[0].title, 'Confirm 1 starting figure for LMS 4');
reset(ok(PROG));
assert.deepStrictEqual(J(ctx.daybookMissions_(owner, cfg, NOW)), [], 'the Owner gets quests, not missions');
assert.strictEqual(calls.length, 0);

// ---- Owner warm: fetches once (so the quests under the lock read the cache), never a mission, never throws
reset(ok(PROG));
assert.deepStrictEqual(J(ctx.daybookOwnerWarm_(owner, cfg, NOW)), []);
ctx.daybookQuests_(owner, cfg, NOW);
assert.strictEqual(calls.length, 1, 'the quests read what the warm fetched');
reset({ code: 500, body: '' });
assert.deepStrictEqual(J(ctx.daybookOwnerWarm_(owner, cfg, NOW)), [], 'a failing warm never throws');

// ---- a Coordinator gets missions only when they also hold Accounts
const coordAcc = { email: 'ca@test.invalid', campusId: 'ALL', roles: ['Accounts', 'Coordinator'], primaryRole: 'Coordinator', idToken: 'tok-ca' };
const coord = { email: 'co@test.invalid', campusId: 'LMS4', roles: ['Coordinator'], primaryRole: 'Coordinator', idToken: 'tok-co' };
reset(ok(PROG));
assert.strictEqual(J(ctx.daybookMissions_(coordAcc, cfg, NOW)).length, 7);
assert.deepStrictEqual(J(ctx.daybookMissions_(coord, cfg, NOW)), [], 'a plain Coordinator has no figures to confirm');
assert.ok(hooks('GAME_MODULE_MISSIONS', 'Coordinator').includes('daybookApproveMissions_'));

// ---- quests: one parallel quest per school, a step per quest it has
reset(ok(PROG));
const qs = J(ctx.daybookQuests_(owner, cfg, NOW));
assert.deepStrictEqual(qs.map((q) => q.questId), ['daybook:LMS4', 'daybook:HES', 'daybook:ALL']);
assert.deepStrictEqual(qs[0].steps.map((s) => s.id), ['cash', 'bank', 'odometer', 'loan', 'users']);
assert.strictEqual(qs[0].title, 'LMS 4 · Starting data'); assert.strictEqual(qs[2].title, 'All schools · Starting data');
assert.strictEqual(qs[0].parallel, true);
assert.deepStrictEqual(qs[0].steps[1], { id: 'bank', title: 'Bank balances', go: 'office/starting-data.html?campus=LMS4&quest=bank', done: true, locked: false });
assert.strictEqual(qs[0].steps[4].done, false, 'nothing entered yet is not done');
assert.deepStrictEqual(qs[1].steps.map((s) => s.id), ['cash', 'bank', 'odometer', 'users'], 'no loan where there is none');
assert.strictEqual(qs[2].steps[1].done, true);
assert.deepStrictEqual(J(ctx.daybookQuests_(clerk, cfg, NOW)), [], 'Fee Clerks get missions, not quests');

// ---- failures throw: HTTP error, HTML page, success:false, no token; nothing is cached
for (const bad of [{ code: 500, body: 'x' }, { body: '<html>error</html>' }, { body: JSON.stringify({ success: false, error: 'FORBIDDEN_ROLE' }) }]) {
  reset(bad);
  assert.throws(() => ctx.daybookMissions_(acc, cfg, NOW));
  assert.throws(() => ctx.daybookQuests_(owner, cfg, NOW));
  assert.deepStrictEqual(store, {}, 'a failure is not cached');
}
reset(ok(PROG));
assert.throws(() => ctx.daybookMissions_(Object.assign({}, acc, { idToken: '' })), /token/);
// through the framework: a throwing module marks the day down
reset({ code: 500, body: '' });
const down = [];
ctx.gameMissionsFor_(clerk, {}, cfg, NOW, down);
assert.ok(down.some((d) => /daybookMissions_/.test(d)), JSON.stringify(down));

// ---- Fee Clerk setup quest (states come from start.progress)
const P2 = (st, cash, odo) => ({ progress: { LMS4: { cash: cash || C(2, 0, 2), odometer: odo || C(8, 0, 8) } }, rings: {}, overall: {}, states: { LMS4: st } });
const S = (state, note) => ({ state: state, by: 'x@test.invalid', at: '', note: note || '' });
assert.ok(hooks('GAME_MODULE_QUESTS', 'FeeClerk').includes('daybookClerkQuests_'));
const stepsOf = (p) => { reset(ok(p)); const q = J(ctx.daybookClerkQuests_(clerk, cfg, NOW)); return q; };
let cq = stepsOf(P2({ cash: S('draft'), odometer: S('draft') }, C(0, 2, 2), C(0, 1, 8)));
assert.strictEqual(cq.length, 1);
assert.strictEqual(cq[0].questId, 'daybook-setup:LMS4'); assert.strictEqual(cq[0].title, 'LMS 4 · Start your Day Book'); assert.strictEqual(cq[0].parallel, false);
assert.deepStrictEqual(cq[0].steps.map((s) => [s.id, s.title, s.done, s.locked]), [['check', 'Check what we know', false, false], ['cash', 'Count the cash', false, true],
  ['odometer', 'Record the odometers', false, true], ['submit', 'Send for approval', false, true], ['approved', 'Approved', false, true]]);
assert.strictEqual(cq[0].steps[0].go, 'office/starting-data.html?campus=LMS4&quest=cash');
assert.strictEqual(cq[0].steps[2].go, 'office/starting-data.html?campus=LMS4&quest=odometer');
cq = stepsOf(P2({ cash: S('draft'), odometer: S('draft') }, C(2, 0, 2), C(0, 0, 0)));
assert.deepStrictEqual(cq[0].steps.map((s) => s.done), [true, true, true, false, false], '0/0 odometers count as recorded');
assert.deepStrictEqual(cq[0].steps.map((s) => s.locked), [false, false, false, false, true], 'only the next step is open');
cq = stepsOf(P2({ cash: S('submitted'), odometer: S('approved') }));
assert.deepStrictEqual(cq[0].steps.map((s) => s.done), [true, true, true, true, false]); assert.strictEqual(cq[0].complete, false);
cq = stepsOf(P2({ cash: S('approved'), odometer: S('approved') })); assert.strictEqual(cq[0].complete, true);
cq = stepsOf(P2({ cash: S('returned', 'Recount'), odometer: S('submitted') })); assert.strictEqual(cq[0].steps[3].done, false, 'returned is not sent');
assert.deepStrictEqual(J(ctx.daybookClerkQuests_(owner, cfg, NOW)), [], 'FeeClerk only');
reset(ok(Object.assign(P2({ cash: S('draft'), odometer: S('draft') }), { labels: { check: 'Look it over' } })));
assert.strictEqual(J(ctx.daybookClerkQuests_(clerk, cfg, NOW))[0].steps[0].title, 'Look it over', 'server label wins');

// ---- Fee Clerk: a returned count becomes "Fix and resend", the note as why
reset(ok(P2({ cash: S('returned', 'Recount the box.'), odometer: S('draft') }, C(1, 1, 2), C(3, 0, 8))));
ms = J(ctx.daybookMissions_(clerk, cfg, NOW));
assert.strictEqual(ms[0].title, 'Fix and resend LMS 4\'s cash count'); assert.strictEqual(ms[0].why, 'Recount the box.');
assert.strictEqual(ms[1].title, 'Confirm 5 starting figures for LMS 4'); assert.strictEqual(ms[1].why, 'Vehicle odometers');
reset(ok(P2({ cash: S('returned', 'Recount.'), odometer: S('draft') }, C(1, 1, 2), C(3, 0, 8))));
assert.strictEqual(J(ctx.daybookMissions_(acc, cfg, NOW))[0].title, 'Confirm 1 starting figure for LMS 4', 'only Fee Clerks see the fix wording');

// ---- Coordinator: approve missions
reset(ok(P2({ cash: S('submitted'), odometer: S('returned', 'x') }, C(2, 0, 2), C(8, 0, 8))));
let am = J(ctx.daybookApproveMissions_(coord, cfg, NOW));
assert.deepStrictEqual(am.map((m) => [m.id, m.kind, m.title, m.done, m.shared]), [
  ['daybook_approve:cash:LMS4', 'daybook_approve', 'Approve LMS 4\'s starting cash count', false, true],
  ['daybook_approve:odometer:LMS4', 'daybook_approve', 'Approve LMS 4\'s starting odometers', true, true]]);
assert.strictEqual(am[0].go, 'office/starting-data.html?campus=LMS4&quest=cash');
reset(ok(P2({ cash: S('draft'), odometer: S('draft') }))); assert.deepStrictEqual(J(ctx.daybookApproveMissions_(coord, cfg, NOW)), [], 'nothing sent yet');
reset(ok(P2({ cash: S('approved'), odometer: S('submitted') })));
assert.deepStrictEqual(J(ctx.daybookApproveMissions_(coord, cfg, NOW)).map((m) => m.done), [true, false]);
reset(ok(P2({ cash: S('submitted'), odometer: S('draft') })));
assert.strictEqual(J(ctx.daybookMissions_(coordAcc, cfg, NOW)).length, 2, 'an Accounts Coordinator keeps the confirm missions');

// ---- Owner: an Approved step per school
reset(ok(P2({ cash: S('approved'), odometer: S('submitted') })));
let oq = J(ctx.daybookQuests_(owner, cfg, NOW))[0];
assert.deepStrictEqual(oq.steps.map((s) => s.id), ['cash', 'odometer', 'approved']); assert.strictEqual(oq.steps[2].done, false);
reset(ok(P2({ cash: S('approved'), odometer: S('approved') })));
assert.strictEqual(J(ctx.daybookQuests_(owner, cfg, NOW))[0].steps[2].done, true);
reset(ok(PROG)); assert.ok(J(ctx.daybookQuests_(owner, cfg, NOW)).every((q) => !q.steps.some((s) => s.id === 'approved')), 'no states: no Approved step');

console.log('game daybook module: ok');
