// node tests/game/test-owner-tick.js -- the Owner tick-off quests (apps-script/game-setup.gs): ownerTickQuests_ + POST ownertick
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const J = (x) => JSON.parse(JSON.stringify(x));

function build(prog) {
  const ctx = { console, JSON }; vm.createContext(ctx);
  const sheet = { getDataRange: () => ({ getValues: () => prog }), getLastRow: () => prog.length,
    getRange: () => ({ setNumberFormat() { return this; }, setValues(rows) { rows.forEach((r) => prog.push(r)); } }) };
  ctx.SpreadsheetApp = { openById: () => ({ getSheetByName: (n) => (n === 'Game Progress' ? sheet : null) }) };
  ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => (k === 'GAME_SHEET_ID' ? 'B' : null) }) };
  ctx.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
  for (const f of ['game-quests.gs', 'game.gs', 'game-actions.gs', 'game-missions.gs', 'game-setup.gs'])
    vm.runInContext(fs.readFileSync(__dirname + '/../../apps-script/' + f, 'utf8'), ctx);
  return ctx;
}

const HEAD = ['Email', 'Kind', 'Key', 'Value', 'At'];
const OWNER = { email: 'Owner@Example.org', roles: ['Owner'] };
const prog = [HEAD, ['someone@example.org', 'owner_tick', 'owner:oo-02-26:lms1', 'done', 'x'], ['owner@example.org', 'quest_step', 'owner:oo-02-26:month', 'done', 'x']];
const ctx = build(prog);

// the quest: 4 tick steps, parallel, nothing done (another person's tick and another Kind don't count)
let q = J(ctx.ownerTickQuests_(OWNER, {}, new Date())).filter((x) => x.questId === 'owner:oo-02-26')[0];
assert.deepStrictEqual(q.steps.map((s) => s.id), ['brackets', 'lms1', 'month', 'referral']);
assert.ok(q.parallel && !q.complete && q.reward && /admission incentive order/.test(q.title));
q.steps.forEach((s) => { assert.strictEqual(s.tick, true); assert.strictEqual(s.done, false); assert.strictEqual(s.locked, false); assert.strictEqual(s.go, ''); });

// refusals: not the Owner (before any read), unknown quest or step
assert.strictEqual(ctx.ownerTick_({ email: 'p@example.org', roles: ['Principal'] }, { questId: 'owner:oo-02-26', stepId: 'lms1' }).code, 'OWNER_TICK_NOT_YOURS');
assert.strictEqual(ctx.ownerTick_(null, {}).code, 'OWNER_TICK_NOT_YOURS');
assert.strictEqual(ctx.ownerTick_(OWNER, { questId: 'owner:oo-02-26', stepId: 'nope' }).code, 'OWNER_TICK_UNKNOWN');
assert.strictEqual(ctx.ownerTick_(OWNER, { questId: 'setup:game', stepId: 'signin' }).code, 'OWNER_TICK_UNKNOWN');
assert.strictEqual(prog.length, 3);

// a tick writes one row, lower-cased email; a second tap is unchanged
let r = ctx.ownerTick_(OWNER, { questId: 'owner:oo-02-26', stepId: 'lms1' });
assert.ok(r.success && !r.unchanged);
assert.deepStrictEqual(J(prog[3].slice(0, 4)), ['owner@example.org', 'owner_tick', 'owner:oo-02-26:lms1', 'done']);
r = ctx.ownerTick_(OWNER, { questId: 'owner:oo-02-26', stepId: 'lms1' });
assert.ok(r.success && r.unchanged);
assert.strictEqual(prog.length, 4);

// all four ticked -> complete
['brackets', 'month', 'referral'].forEach((id) => ctx.ownerTick_(OWNER, { questId: 'owner:oo-02-26', stepId: id }));
q = J(ctx.ownerTickQuests_(OWNER, {}, new Date())).filter((x) => x.questId === 'owner:oo-02-26')[0];
assert.ok(q.complete && q.steps.every((s) => s.done));

// registered for the Owner beside the setup quest; dispatched from doPost only
assert.ok(ctx.GAME_MODULE_QUESTS.Owner.indexOf(ctx.ownerTickQuests_) !== -1 && ctx.GAME_MODULE_QUESTS.Owner.indexOf(ctx.setupQuests_) !== -1);
assert.ok(!('ownertick' in ctx.GAME_MODULE_ACTIONS));
assert.ok(/action === 'ownertick'\) return gameJson_\(ownerTick_\(caller, body\)\)/.test(fs.readFileSync(__dirname + '/../../apps-script/game.gs', 'utf8')));
console.log('test-owner-tick OK');
