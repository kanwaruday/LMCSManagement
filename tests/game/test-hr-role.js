// N3 28 Nov: the game's `hr` role in game-hr.gs. Synthetic callers only. node tests/game/test-hr-role.js
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const ctx = { Utilities: {}, console, callerHasRole_: (c, r) => !!c && c.roles.indexOf(r) !== -1 }; // main.gs's own check, as it is
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../../apps-script/game-hr.gs', 'utf8')
  + '\nthis.T = { ROLES: GAME_HR_ROLES, OPS: GAME_HR_ROLE_OPS, OWNER: GAME_HR_OWNER_ACTIONS, actAs: gameHrActAs_ };', ctx);
const T = ctx.T, has = (c, r) => (c.roles || []).indexOf(r) !== -1;
const coord = { email: 'v@x.invalid', name: 'Demo', roles: ['Coordinator'], campusId: 'ALL' };

assert.strictEqual(T.ROLES.hr, 'Hr');
// hr acts as a Principal for the old hiring rules, never as the Owner; the caller passed in is not changed
const c = T.actAs(coord, 'Hr');
assert.ok(has(c, 'Principal') && has(c, 'Coordinator') && !has(c, 'Owner'));
assert.deepStrictEqual(coord.roles, ['Coordinator']);
assert.ok(!has(T.actAs(Object.assign({}, coord, { roles: ['Owner', 'Coordinator'] }), 'Hr'), 'Owner'), 'an Owner row never leaks Owner into the hr act');
// the other roles still need the role on their own Allowlist row
assert.strictEqual(T.actAs(coord, 'Principal'), null);
assert.strictEqual(T.actAs(coord, 'Owner'), null);
assert.strictEqual(T.actAs(null, 'Hr'), null);
assert.strictEqual(T.actAs(Object.assign({}, coord, { roles: ['Principal'] }), 'Principal').roles[0], 'Principal');
assert.strictEqual(T.actAs(coord, undefined), null);
// hr gets the Principal's steps, and no salary action
assert.deepStrictEqual(T.OPS.Hr, T.OPS.Principal);
assert.ok(T.OWNER.length === 3 && T.OWNER.every((a) => /Salary|Offer|Epf/.test(a)));
console.log('test-hr-role: ok');
