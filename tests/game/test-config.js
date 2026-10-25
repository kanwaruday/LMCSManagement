// node tests/game/test-config.js -- game day key (04:00 IST), config parsing, caller scope
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../../apps-script/game.gs', 'utf8'), ctx);

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
assert.strictEqual(cfg.recommendationsReady, false);
assert.strictEqual(cfg.speaker.Teacher, 'teacher-owl');
assert.strictEqual(cfg.uniform.winterFrom, '2026-10-26');
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
console.log('game config: ok');
