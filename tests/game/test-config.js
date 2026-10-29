// node tests/game/test-config.js -- game day key (04:00 IST), config parsing, caller scope
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const ctx = { console };
vm.createContext(ctx);
// a module file (game-teacher.gs) can run BEFORE game.gs: it starts with the guard lines, then registers
vm.runInContext(`
  var GAME_MODULE_ACTIONS = GAME_MODULE_ACTIONS || {};
  var GAME_MODULE_MISSIONS = GAME_MODULE_MISSIONS || {};
  var GAME_MODULE_QUESTS = GAME_MODULE_QUESTS || {};
  GAME_MODULE_ACTIONS.teacherping = function (caller, params) { return { success: true, who: caller.email, n: params.n }; };
  GAME_MODULE_MISSIONS.Teacher = function () { return []; };
`, ctx);
for (const f of ['game.gs', 'game-actions.gs']) vm.runInContext(fs.readFileSync(__dirname + '/../../apps-script/' + f, 'utf8'), ctx);

// the game day starts at 04:00 IST (22:30 UTC the evening before)
assert.strictEqual(ctx.gameDayKey_(new Date('2026-10-26T22:29:00Z')), '2026-10-26'); // 03:59 IST on the 27th
assert.strictEqual(ctx.gameDayKey_(new Date('2026-10-26T22:30:00Z')), '2026-10-27'); // 04:00 IST
assert.strictEqual(ctx.gameDayKey_(new Date('2026-12-31T22:30:00Z')), '2027-01-01'); // year roll

// config: Value cells are JSON; partial objects merge over the defaults; bad JSON falls back
const cfg = ctx.gameParseConfig_([['Key', 'Value'], ['cap', '{"Principal":3}']]);
assert.strictEqual(cfg.cap.Principal, 3);
assert.strictEqual(cfg.cap.Coordinator, 5);
assert.strictEqual(cfg.cap.Owner, 5);
assert.strictEqual(cfg.approvalWaitDays, 3);                       // untouched keys keep their default
assert.strictEqual(cfg.recommendationsReady, true);                 // coordinator/hq.html makes recommendations
assert.strictEqual(cfg.principalIssuesReady, true);                 // principal/issues.html closes daily-report issues
assert.strictEqual(cfg.recommendGo, 'coordinator/hq.html');
assert.strictEqual(cfg.speaker.Teacher, 'teacher-owl');
assert.strictEqual(cfg.uniform.winterFrom, '2026-10-26');
assert.strictEqual(cfg.approvalsGo, 'coordinator/systems/index.html#approvals'); // I1
assert.strictEqual(cfg.daysDenominator.Staff, false);                         // R27
const bad = ctx.gameParseConfig_([['Key', 'Value'], ['cap', '{not json'], ['approvalWaitDays', '"three"'], ['core', '']]);
assert.strictEqual(bad.cap.Principal, 5);                          // bad JSON -> default
assert.strictEqual(bad.approvalWaitDays, 3);                       // wrong type -> default
assert.deepStrictEqual(JSON.parse(JSON.stringify(bad.core.Owner)), ['approval_wait']);
const g1 = ctx.gameParseConfig_([['Key', 'Value']]); g1.cap.Owner = 99;
assert.strictEqual(ctx.gameParseConfig_([['Key', 'Value']]).cap.Owner, 5); // defaults are never shared

// who sees which campuses: null = all
const vc = (c) => { const r = ctx.gameVisibleCampuses_(c); return r === null ? null : Array.from(r); };
assert.strictEqual(vc({ campusId: 'LMS5', roles: ['Coordinator'] }), null);
assert.strictEqual(vc({ campusId: 'ALL', roles: ['Owner'] }), null);
assert.deepStrictEqual(vc({ campusId: 'LMS2', roles: ['Principal'] }), ['LMS2']);

// primary role precedence: Owner > Coordinator > Principal > Teacher > others
assert.strictEqual(ctx.gamePrimaryRole_(['Teacher', 'Principal']), 'Principal');
assert.strictEqual(ctx.gamePrimaryRole_(['Principal', 'Owner', 'Coordinator']), 'Owner');
assert.strictEqual(ctx.gamePrimaryRole_(['FeeClerk']), 'FeeClerk');

// module registries exist for later .gs files to add to
assert.strictEqual(typeof vm.runInContext('GAME_MODULE_ACTIONS', ctx), 'object');
assert.strictEqual(typeof vm.runInContext('GAME_MODULE_MISSIONS', ctx), 'object');
assert.strictEqual(typeof vm.runInContext('GAME_MODULE_QUESTS', ctx), 'object');
// registrations made before game.gs loaded survive it, and the dispatch finds them
assert.strictEqual(typeof vm.runInContext('GAME_MODULE_MISSIONS.Teacher', ctx), 'function');
const r = vm.runInContext("gameDispatch_({ email: 't@lms.org.in' }, 'teacherping', { n: 7 })", ctx);
assert.strictEqual(r.success, true); assert.strictEqual(r.who, 't@lms.org.in'); assert.strictEqual(r.n, 7);
assert.strictEqual(vm.runInContext("gameDispatch_({}, 'constructor', {}).success", ctx), false);
assert.strictEqual(vm.runInContext("gameDispatch_({}, 'nope', {}).error", ctx), 'Unknown action');
console.log('game config: ok');

// shipped default (Uday, 2026-10-26: review on the live site from day one): Principals and Coordinators at all six campuses
{ const vm = require('vm'), fs = require('fs'), c = {}; vm.createContext(c); vm.runInContext(fs.readFileSync(__dirname + '/../../apps-script/game.gs', 'utf8'), c);
  const all = ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6'], d = JSON.parse(JSON.stringify(c.gameConfigDefaults_().pilotCampuses));
  require('assert').deepStrictEqual(d, { Principal: all, Coordinator: all, Owner: 'ALL', Teacher: 'ALL', Staff: 'ALL', FeeClerk: 'ALL', Accounts: 'ALL' }); }
