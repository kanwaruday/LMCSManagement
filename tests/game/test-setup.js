// node tests/game/test-setup.js -- the Owner setup quest (apps-script/game-setup.gs): each step flips on its data
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const J = (x) => JSON.parse(JSON.stringify(x));

function build(o) {
  o = o || {};
  const ctx = { console, JSON }; vm.createContext(ctx);
  const rows = [['WindowId', 'Title', 'Question', 'Scope', 'ScopeId', 'Decider', 'Choice', 'DefaultIfUndecided', 'Opens', 'Closes'],
    ['trackSuit', 't', 'q', 'campus', '*', 'Principal', '', '', o.opens || '', o.closes || '']];
  ctx.SpreadsheetApp = { openById: () => ({ getSheetByName: (n) => ({ getDataRange: () => ({ getValues: () => (n === 'Game Config' ? o.cfgRows || [['Key', 'Value']] : rows) }) }) }) };
  const props = Object.assign({ GAME_SHEET_ID: 'B' }, o.props || {});
  ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null) }) };
  const cache = o.cache || {};
  ctx.CacheService = { getScriptCache: () => ({ get: (k) => (k in cache ? cache[k] : null), put() {} }) };
  for (const f of ['game-quests.gs', 'game.gs', 'game-actions.gs', 'game-missions.gs', 'game-windows.gs', 'game-teacher.gs', 'game-fleet.gs', 'game-setup.gs'])
    vm.runInContext(fs.readFileSync(__dirname + '/../../apps-script/' + f, 'utf8'), ctx);
  const q = J(ctx.setupQuests_({}, o.cfg || {}, new Date()))[0];
  return { ctx, q, done: q.steps.filter((s) => s.done).map((s) => s.id) };
}

const FORM = 'https://docs.google.com/forms/d/e/x/viewform';
const none = build();
assert.deepStrictEqual(none.q.steps.map((s) => s.id), ['signin', 'secret', 'refresh', 'form', 'term', 'suit']);
assert.strictEqual(none.q.questId, 'setup:game');
assert.strictEqual(none.q.title, 'Set up the game');
assert.deepStrictEqual(none.done, []);
assert.strictEqual(none.q.complete, false);
none.q.steps.forEach((s) => { assert.strictEqual(s.guide, 'setup-' + s.id); assert.strictEqual(s.go, ''); assert.strictEqual(s.locked, false); assert.ok(s.title); });

assert.deepStrictEqual(build({ props: { STAFF_AUTO_SIGNIN: 'on' } }).done, ['signin']);
assert.deepStrictEqual(build({ props: { STAFF_AUTO_SIGNIN: 'off' } }).done, []);
assert.deepStrictEqual(build({ props: { GAME_PUSH_SECRET: 's3' } }).done, ['secret']);
assert.deepStrictEqual(build({ props: { GAME_PUSH_SECRET: '  ' } }).done, []);
assert.deepStrictEqual(build({ cache: { tch_meta: JSON.stringify({ builtAt: Date.now() - 3600e3 }) } }).done, ['refresh']);
assert.deepStrictEqual(build({ cache: { tch_meta: JSON.stringify({ builtAt: Date.now() - 3 * 3600e3 }) } }).done, []);
assert.deepStrictEqual(build({ cache: { tch_meta: 'not json' } }).done, []);
assert.deepStrictEqual(build({ cfg: { teacher: { cwhwFormUrl: FORM } } }).done, ['form']);
assert.deepStrictEqual(build({ cfg: { teacher: { cwhwFormUrl: 'http://evil.example' } } }).done, []);
assert.deepStrictEqual(build({ cfg: { teacher: { quests: { termEnd: '2027-03-31' } } } }).done, ['term']);
assert.deepStrictEqual(build({ cfg: { teacher: { quests: { termEnd: 'March' } } } }).done, []);
assert.deepStrictEqual(build({ opens: '2026-11-01', closes: '2026-11-08' }).done, ['suit']);
assert.deepStrictEqual(build({ opens: '2026-11-01' }).done, []);

const all = build({ props: { STAFF_AUTO_SIGNIN: 'on', GAME_PUSH_SECRET: 's3' }, cache: { tch_meta: JSON.stringify({ builtAt: Date.now() }) },
  cfg: { teacher: { cwhwFormUrl: FORM, quests: { termEnd: '2027-03-31' } } }, opens: '2026-11-01', closes: '2026-11-08' });
assert.strictEqual(all.done.length, 6);
assert.strictEqual(all.q.complete, true);

// the framework config drops the teacher key: the steps read the Game Config sheet's teacher row themselves
{
  const row = ['teacher', JSON.stringify({ cwhwFormUrl: FORM, quests: { termEnd: '2027-03-31' } })];
  const b = build({ cfg: { trackSuitDays: {} }, cfgRows: [['Key', 'Value'], row] });
  assert.deepStrictEqual(b.done, ['form', 'term']);
}

// registry: an array on Owner, other modules kept; the hook is the function this file defines
const reg = none.ctx.GAME_MODULE_QUESTS.Owner;
assert.ok(Array.isArray(reg) && reg.length >= 2 && reg.indexOf(none.ctx.setupQuests_) !== -1 && reg.indexOf(none.ctx.fleetQuests_) !== -1);
console.log('test-setup OK');
