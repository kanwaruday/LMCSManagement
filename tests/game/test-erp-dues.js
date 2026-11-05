// node tests/game/test-erp-dues.js -- ERP fee dues missions (game-office.gs, V2 row 6) against a stub erpread. Synthetic data only.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const dir = __dirname + '/../../apps-script/';
const ctx = { console: Object.assign(Object.create(console), { error() {} }), Logger: { log() {} } };
vm.createContext(ctx);
const load = (f) => vm.runInContext(fs.readFileSync(dir + f, 'utf8'), ctx);
load('game-office.gs'); load('game.gs'); load('game-actions.gs'); load('game-missions.gs'); load('game-quests.gs');
const J = (x) => JSON.parse(JSON.stringify(x));

let store = {}, reads = [], answer;
ctx.CacheService = { getScriptCache: () => ({ get: (k) => (k in store ? store[k] : null), put: (k, v) => { store[k] = v; } }) };
const reset = (a) => { store = {}; reads = []; answer = a; };
ctx.GAME_MODULE_ACTIONS.erpread = (caller, p) => { reads.push([caller.email, p.what]); if (answer instanceof Error) throw answer; return answer; };

const NOW = new Date('2026-11-06T05:00:00Z'), cfg = J(ctx.gameConfigDefaults_());
const clerk = { email: 'clerk@test.invalid', campusId: 'LMS4', roles: ['FeeClerk'], primaryRole: 'FeeClerk' };
const prin = { email: 'prin@test.invalid', campusId: 'LMS4', roles: ['Principal'], primaryRole: 'Principal' };
const teacher = { email: 't@test.invalid', campusId: 'LMS4', roles: ['Teacher'], primaryRole: 'Teacher' };
const row = (name, receivable, received, pending) => ({ enrollNo: 'E-' + name, name, class: '7', section: 'A', receivable, received, concession: 0, pending, heads: [] });
const DUES = { success: true, what: 'dues', campus: 'LMS4', configured: true, missing: [], count: 2, totalPending: 125500,
  rows: [row('Test Child A', 150000, 50000, 100000), row('Test Child B', 40000, 14500, 25500)] };
const run = (who) => J(ctx.erpDuesMissions_(who, cfg, NOW));

const hooks = (role) => J(ctx.gameModuleHooks_(ctx.GAME_MODULE_MISSIONS, role).map((f) => f.name));
assert.ok(hooks('FeeClerk').includes('erpDuesMissions_') && hooks('Principal').includes('erpDuesMissions_'));
assert.ok(!hooks('Teacher').includes('erpDuesMissions_') && !hooks('Owner').includes('erpDuesMissions_'));
console.log('  ok  - registered for Fee Clerk and Principal only');

reset(DUES);
let m = run(prin);
assert.strictEqual(m.length, 1);
assert.strictEqual(m[0].title, 'Fee dues: 2 students owe ₹1,25,500');
assert.strictEqual(m[0].go, 'principal/index.html#erp-dues');
assert.deepStrictEqual(m[0].progress, { done: 64500, total: 190000 }, 'the bar is fees collected of receivable');
assert.strictEqual(m[0].id, 'erp_dues:LMS4:' + ctx.gameDayKey_(NOW), 'a new id each day: never rolls over');
assert.strictEqual(m[0].done, false); assert.strictEqual(m[0].core, false); assert.strictEqual(m[0].campus, 'LMS4');
assert.ok(!JSON.stringify(m).includes('Test Child'), 'no names in the mission');
assert.ok(!store['erpdues:LMS4'].includes('Test Child'), 'no names in the cache');
console.log('  ok  - Principal mission: count, total, collected bar, no names');

assert.strictEqual(run(clerk)[0].go, 'office/index.html#erp-dues');
assert.strictEqual(reads.length, 1, 'the second home within 10 minutes reads the cache, not the Sheet');
console.log('  ok  - Fee Clerk mission from the cache');

reset(Object.assign({}, DUES, { rows: [row('Test Child A', 900, 0, 900), row('', 500, 0, 500), row('Test Child Z', 100, 100, 0)] }));
assert.strictEqual(run(clerk)[0].title, 'Fee dues: 1 student owes ₹900');
console.log('  ok  - one student, small amount; nameless and settled rows are not counted (as in the window)');

reset(DUES);
assert.deepStrictEqual(run(Object.assign({}, prin, { viewAs: true })), []); assert.strictEqual(reads.length, 0, 'the Owner viewing as a Principal: no erpread');
console.log('  ok  - no mission under view-as');

for (const [why, a] of [['not connected', { success: true, configured: false, rows: [], missing: [], note: 'x' }],
  ['no Dues tab', { success: true, configured: true, rows: [], missing: ['Dues'] }],
  ['nothing due', { success: true, configured: true, rows: [], missing: [] }],
  ['refused', { success: false, code: 'ERP_NOT_ALLOWED', error: 'x' }],
  ['read throws', new Error('sheet down')]]) {
  reset(a);
  assert.deepStrictEqual(run(prin), [], why);
}
reset(DUES);
assert.deepStrictEqual(run(teacher), []); assert.strictEqual(reads.length, 0, 'a Teacher never reads dues');
const saved = ctx.GAME_MODULE_ACTIONS.erpread; delete ctx.GAME_MODULE_ACTIONS.erpread;
assert.deepStrictEqual(run(prin), [], 'no ERP module assembled yet');
ctx.GAME_MODULE_ACTIONS.erpread = saved;
console.log('  ok  - no mission when not connected, no tab, nothing due, refused, failing, or no module');
console.log('erp dues: ok');
