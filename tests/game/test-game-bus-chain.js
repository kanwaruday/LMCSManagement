// node tests/game/test-game-bus-chain.js -- the bus setup chain: assets/game/bus-chain.js (pure) and game-bus-chain.gs (the staff quest).
// Fictional buses only.
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const BC = require('../../assets/game/bus-chain.js');
const all = (extra) => Object.assign(Object.fromEntries(BC.SHOTS.map((s) => [s.id, { ok: true, fileId: 'FILEabcdefghij' }])), extra || {});

// photoItems: the shots first (a Yes needs a photo), then the active loadout; a switched-off item and a clashing id stay out
const items = BC.photoItems([{ id: 'fire_extinguisher', label: 'Fire extinguisher', needsPhoto: true, active: true }, { id: 'cctv', active: false }, { id: 'bus_front', active: true }]);
assert.deepStrictEqual(items.map((i) => i.id), BC.SHOTS.map((s) => s.id).concat('fire_extinguisher'));
assert.ok(items.slice(0, 8).every((i) => i.needsPhoto && i.shot));

// photosDone: every shot answered, a Yes with its photo; a "needs repair" (No) counts
assert.strictEqual(BC.photosDone(all()), true);
assert.strictEqual(BC.photosDone(all({ bus_tyres: { ok: false } })), true, 'a No is a finding, not a gap');
assert.strictEqual(BC.photosDone(all({ bus_aisle: { ok: true } })), false, 'a Yes without its photo');
const less = all(); delete less.bus_plate;
assert.strictEqual(BC.photosDone(less), false, 'a shot missing');
assert.strictEqual(BC.photosDone(null), false);

// steps: the first open step is next, nothing locked (the route video stays open before the photos); riders null = the ERP list not set up yet
let st = BC.steps({ linked: true, photos: false, runsNeeded: 2, runsDone: 0, riders: null });
assert.deepStrictEqual(st.map((s) => [s.id, s.done, s.next]), [['bus', true, false], ['photos', false, true], ['route', false, false], ['riders', false, false]]);
assert.strictEqual(st[2].action, 'रूट रिकॉर्ड करें · Record your route', 'the route can be recorded before the photos');
assert.match(st[3].status, /Soon/);
st = BC.steps({ linked: true, photos: true, runsNeeded: 2, runsDone: 2, riders: [{ name: 'A' }, { name: 'B' }] });
assert.ok(st.every((s) => s.done && !s.next));
assert.deepStrictEqual(BC.progress(st), { done: 4, total: 4 });
assert.strictEqual(BC.steps({ linked: true, photos: true, runsNeeded: 0 })[2].done, false, 'no runs planned is not done');

// photographed: ended safety checks covering every shot, per bus
const row = (reg, kind, status, a) => ['R', reg, 'LMS4', kind, '', '', '', '', 0, '', '', JSON.stringify(a), status];
assert.deepStrictEqual(BC.photographed([row('hp 65 9511', 'inspection', 'ended', all()), row('HP665805', 'inspection', 'running', all()), row('HP665686', 'timelapse', 'ended', all()),
  row('HP111111', 'inspection', 'ended', { fire_extinguisher: { ok: true } })], (r) => String(r).toUpperCase().replace(/[^A-Z0-9]/g, '')), { HP659511: true });

// the staff quest: per campus, a step per bus, scoped by game-fleet.gs's fleetScopedRows_ (stubbed); a cold cache is no quest
const ctx = { console, Object, String, JSON, Array, encodeURIComponent };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../apps-script/game-bus-chain.gs'), 'utf8'), ctx);
let rows = { fleet: [{ reg: 'HP659511', campus: 'LMS 4', campusId: 'LMS4' }, { reg: 'HP665686', campus: 'LMS 4', campusId: 'LMS4' }, { reg: 'HP665805', campus: 'LMS 1', campusId: 'LMS1' }],
  photographed: { HP659511: true } };
ctx.fleetScopedRows_ = (caller, cfg, cacheOnly) => (assert.strictEqual(cacheOnly, true, 'cache only, under the lock'), rows);
const q = (role) => JSON.parse(JSON.stringify(vm.runInContext('busChainQuests_(' + JSON.stringify({ primaryRole: role }) + ', {})', ctx)));
const owner = q('Owner');
assert.deepStrictEqual(owner.map((x) => [x.questId, x.title, x.complete]), [['bus-photos:LMS1', '📸 LMS 1 bus photos: 0 of 1', false], ['bus-photos:LMS4', '📸 LMS 4 bus photos: 1 of 2', false]]);
assert.deepStrictEqual(owner[1].steps.map((s) => [s.id, s.done]), [['HP659511', true], ['HP665686', false]]);
assert.strictEqual(owner[1].steps[1].go, 'coordinator/transport/capture.html?mode=inspection&shots=1&reg=HP665686');
assert.strictEqual(q('Coordinator').length, 2);
assert.deepStrictEqual([q('Principal'), q('FeeClerk'), q('Teacher')], [[], [], []], 'Owner and Coordinators only');
rows = null;
assert.deepStrictEqual(q('Owner'), [], 'a cold cache: no quest');
assert.strictEqual(ctx.GAME_MODULE_QUESTS.Owner.length, 1, 'registered for the Owner');
console.log('game bus chain: ok');
