// node tests/game/test-home-engine.js -- Home engine v2 (game-home.gs): slot states from config, the progressive unlock, per-school
// overrides, GAME_MODULE_FILLS, the Townhall doors, and gameToday_ adding home/townhall. Synthetic data only.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const dir = __dirname + '/../../apps-script/';
const errors = [];
let progress = [];
const ctx = {
  console: { log: () => {}, warn: () => {}, error: (...a) => errors.push(a.join(' ')) },
  gameLower_: (v) => String(v || '').trim().toLowerCase(),
  gameBook_: () => ({ getSheetByName: (n) => (n === 'Game Progress' ? { getDataRange: () => ({ getValues: () => progress }) } : null) }),
};
vm.createContext(ctx);
// a module file may load before game-home.gs: its FILLS row must survive
vm.runInContext("var GAME_MODULE_FILLS = GAME_MODULE_FILLS || {}; GAME_MODULE_FILLS['daybook.opening'] = function (c) { return c.campusId === 'LMS4'; };", ctx);
vm.runInContext(fs.readFileSync(dir + 'game-home.gs', 'utf8'), ctx);
vm.runInContext("GAME_MODULE_FILLS['boom'] = function () { throw new Error('x'); };", ctx);

const cfg = {
  homes: { FeeClerk: { scene: 'office-counter', slots: [
    { id: 'treasury', label: 'Day Book', emoji: 'dayBook', at: [30, 56], fills: { quest: 'daybook-setup:approved', data: 'daybook.opening' }, opens: 'office/daybook.html' },
    { id: 'bank', label: 'Deposits', after: 'treasury', fills: { quest: 'deposit:{campus}:first' }, opens: 'office/deposits.html' },
    { id: 'close', label: 'Close the day', after: 'bank', fills: { data: 'boom' }, opens: 'office/close.html' } ],
    schools: { LMS6: { scene: 'office-small', hide: ['close'], slots: [{ id: 'bank', label: 'Bank (LMS 6)', fills: { quest: 'x:y' } }] } } } },
  townhall: { rooms: [
    { id: 'requests', label: 'Requests & leave', roles: ['all'], opens: 'teacher/index.html#panel-requests' },
    { id: 'office', label: 'Office & fees', roles: ['FeeClerk'], needs: 'treasury', opens: 'office/index.html' },
    { id: 'meet', label: 'Meeting room', roles: ['Principal'] },
    { id: 'books', label: 'Library', needs: 'daybook.opening' } ] },
};
const clerk = (campus) => ({ email: 'F@example.org', primaryRole: 'FeeClerk', campusId: campus });
const st = (h) => h.slots.map((s) => s.id + ':' + s.state).join(' ');

// nothing done: the first slot is buildable (gold), each later one waits on the one before
let h = ctx.homeSlotStates_(clerk('LMS3'), cfg, new Date(), {});
assert.strictEqual(h.scene, 'office-counter');
assert.strictEqual(st(h), 'treasury:building bank:locked close:locked');
assert.deepStrictEqual(JSON.parse(JSON.stringify(h.slots[0])), { id: 'treasury', label: 'Day Book', emoji: 'dayBook', at: [30, 56], state: 'building', after: null, opens: 'office/daybook.html' });
assert(errors.some((e) => /boom/.test(e)), 'a throwing fills fn is logged and counts as not filled');

// data present fills the slot without its quest (LMS4 has opening values); {campus} in the quest key
h = ctx.homeSlotStates_(clerk('LMS4'), cfg, new Date(), { 'deposit:LMS4:first': true });
assert.strictEqual(st(h), 'treasury:filled bank:filled close:building');
// the quest step alone fills it too
assert.strictEqual(st(ctx.homeSlotStates_(clerk('LMS3'), cfg, new Date(), { 'daybook-setup:approved': true })), 'treasury:filled bank:building close:locked');

// per-school override: scene, a replaced slot (keeps base order rules: replaced slots go last), a hidden slot
h = ctx.homeSlotStates_(clerk('LMS6'), cfg, new Date(), {});
assert.strictEqual(h.scene, 'office-small');
assert.strictEqual(st(h), 'treasury:building bank:building');
assert.strictEqual(h.slots[1].label, 'Bank (LMS 6)');

// an `after` naming a slot this person doesn't have never locks forever
const cfgOrphan = { homes: { Teacher: { slots: [{ id: 'a', after: 'gone' }] } } };
assert.strictEqual(st(ctx.homeSlotStates_({ primaryRole: 'Teacher', campusId: 'LMS1' }, cfgOrphan, new Date(), {})), 'a:building');

// no row for the role: no home (the page keeps today's look); a bad row (no slots array) too
assert.strictEqual(ctx.homeSlotStates_({ primaryRole: 'Teacher', campusId: 'LMS1' }, cfg, new Date(), {}), null);
assert.strictEqual(ctx.homeSlotStates_(clerk('LMS1'), { homes: { FeeClerk: { slots: 'x' } } }, new Date(), {}), null);

// homeDoneMap_: steps and complete quests
assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.homeDoneMap_([{ questId: 'q', complete: true, steps: [{ id: 'a', done: true }, { id: 'b', done: false }] }]))), { q: true, 'q:a': true });

// Townhall: only this role's doors; `needs` = a slot id or a fills key; a door without needs is open
let th = ctx.homeTownhall_(clerk('LMS3'), cfg, new Date(), ctx.homeSlotStates_(clerk('LMS3'), cfg, new Date(), {}));
assert.strictEqual(th.rooms.map((r) => r.id + ':' + r.state).join(' '), 'requests:open office:locked books:locked');
assert.strictEqual(th.rooms[1].after, 'Day Book', 'a locked door names the slot it waits on, by its label');
assert.strictEqual(th.rooms[2].after, null, 'a fills key with no needsLabel: no words (the page says Not open yet)');
th = ctx.homeTownhall_(clerk('LMS4'), cfg, new Date(), ctx.homeSlotStates_(clerk('LMS4'), cfg, new Date(), {}));
assert.strictEqual(th.rooms.map((r) => r.id + ':' + r.state).join(' '), 'requests:open office:open books:open');
assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.homeTownhall_(clerk('LMS1'), {}, new Date(), null))), { rooms: [] });

// homeTodayFields_: townhall always, home only when configured
let f = ctx.homeTodayFields_({ primaryRole: 'Teacher', campusId: 'LMS1' }, cfg, new Date(), []);
assert(!('home' in f) && f.townhall.rooms.length === 2, 'Teacher: townhall (requests, library), no home');
f = ctx.homeTodayFields_(clerk('LMS3'), cfg, new Date(), [{ questId: 'daybook-setup', steps: [{ id: 'approved', done: true }] }]);
assert.strictEqual(st(f.home), 'treasury:filled bank:building close:locked');

// homeSlotState_ for a backend: reads this person's recorded steps from Game Progress; null = not configured (treat as open)
progress = [['f@example.org', 'quest_step', 'daybook-setup:approved', 'done', 't'], ['other@example.org', 'quest_step', 'deposit:LMS3:first', 'done', 't']];
assert.strictEqual(ctx.homeSlotState_(clerk('LMS3'), cfg, new Date(), 'treasury'), 'filled');
assert.strictEqual(ctx.homeSlotState_(clerk('LMS3'), cfg, new Date(), 'bank'), 'building', "someone else's step never counts");
assert.strictEqual(ctx.homeSlotState_(clerk('LMS3'), cfg, new Date(), 'nope'), null);

// the shipped defaults: valid emoji keys, Principal's rooms chain, and gameToday_ wires it in after the quests
const emojiSrc = fs.readFileSync(__dirname + '/../../assets/game/emoji.js', 'utf8');
const gameSrc = fs.readFileSync(dir + 'game.gs', 'utf8');
const defaults = new Function(gameSrc.slice(gameSrc.indexOf('function gameConfigDefaults_'), gameSrc.indexOf('\n}\n', gameSrc.indexOf('function gameConfigDefaults_')) + 2) + 'return gameConfigDefaults_();')();
const used = [].concat(...Object.values(defaults.homes).map((r) => r.slots.map((s) => s.emoji)), defaults.townhall.rooms.map((r) => r.emoji));
used.forEach((k) => assert(new RegExp('\\b' + k + ": '").test(emojiSrc), 'emoji key in emoji.js: ' + k));
const p = ctx.homeSlotStates_({ primaryRole: 'Principal', campusId: 'LMS4' }, defaults, new Date(), { 'rooms:LMS4:name': true });
assert.strictEqual(st(p), 'rooms:filled staff:building');
const actions = fs.readFileSync(dir + 'game-actions.gs', 'utf8');
assert(/if \(typeof homeTodayFields_ === 'function'\) Object\.assign\(out, homeTodayFields_\(caller, cfg, now, quests\)\);/.test(actions), 'gameToday_ adds home/townhall, guarded');
assert(JSON.parse(fs.readFileSync(dir + 'projects.json', 'utf8')).game.files.includes('game-home'), 'game-home in the Game project');
// the pages: game.js folds the Townhall after the quests on every home but the Principal's (its HUD has the button); never on a module page
const gjs = fs.readFileSync(__dirname + '/../../assets/game/game.js', 'utf8'), hud = fs.readFileSync(__dirname + '/../../assets/game/home-hud.js', 'utf8');
assert(/parEls, townhallPanel\(\), days/.test(gjs) && /if \(opts\.only \|\| !Array\.isArray\(rooms\) \|\| document\.body\.classList\.contains\('hh'\)\) return null;/.test(gjs), 'game.js Townhall panel, skipped on module pages and the HUD home');
assert(/slots\(\); el\.townhall\.hidden = !t\.townhall;/.test(hud) && /play\(b, 'room-unlock'\)/.test(hud), 'the HUD draws the slots and the Townhall button after each Today');
assert(/<link rel="stylesheet" href="\.\.\/assets\/game\/v2-animations\.css(\?v=[0-9a-f]+)?" \/>/.test(fs.readFileSync(__dirname + '/../../principal/index.html', 'utf8')), 'the Principal home loads v2-animations.css (room-unlock plays)');
assert(!defaults.townhall.rooms.filter((r) => r.id === 'requests')[0].roles.includes('Owner'), 'no Requests door for the Owner (no one to ask)');
assert(/home = at \? layer : row;/.test(hud) && /el\.slots = h\('div', \{ class: 'hh-slots'/.test(hud), 'a slot with no `at` docks above the quest line, never on the rooms (G2 nit)');
console.log('test-home-engine: ok');
