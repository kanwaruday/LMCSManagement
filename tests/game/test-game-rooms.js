// node tests/game/test-game-rooms.js -- 🏫 room setup (game-rooms.gs): who may read/write, the checks on a save, the quest, roomsmine. Made-up people only.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const dir = __dirname + '/../../apps-script/';
const ctx = { console: Object.assign(Object.create(console), { error() {}, warn() {} }), Logger: { log() {} } };
vm.createContext(ctx);
['game.gs', 'game-actions.gs', 'game-missions.gs', 'game-quests.gs', 'game-confirm.gs', 'game-kingdom.gs', 'game-teacher.gs', 'game-event.gs', 'game-rooms.gs']
  .forEach((f) => vm.runInContext(fs.readFileSync(dir + f, 'utf8'), ctx));
const J = (x) => JSON.parse(JSON.stringify(x));

let roster, rooms, cfgRows, locked, tabMade;
const reset = () => {
  roster = { complete: true, people: [
    { email: 'p4@example.org', name: 'Asha Verma', role: 'Principal', campusId: 'LMS4' },
    { email: 't4@example.org', name: 'Neha Test', role: 'Teacher', campusId: 'LMS4' },
    { email: 'fc4@example.org', name: 'Clerk Four', role: 'FeeClerk', campusId: 'LMS4' },
    { email: 't3@example.org', name: 'Tara Test', role: 'Teacher', campusId: 'LMS3' },
    { email: 'owner@example.org', name: 'Owner One', role: 'Owner', campusId: 'HES' }] };
  rooms = null; cfgRows = [['Key', 'Value']]; locked = 0; tabMade = 0;
};
// a sheet stub that supports getRange(r, c, n, m).clearContent / setNumberFormat().setValues on a 2-D array
const sheet = (rows) => ({
  _rows: rows,
  getDataRange: () => ({ getValues: () => rows.map((r) => r.slice()) }),
  getLastRow: () => rows.length,
  getRange: (r, c, n, m) => {
    const api = {
      clearContent: () => { for (let i = 0; i < n; i++) rows[r - 1 + i] = new Array(m).fill(''); return api; },
      setNumberFormat: () => api,
      setValues: (v) => { v.forEach((row, i) => { rows[r - 1 + i] = row.slice(); }); return api; },
    };
    return api;
  },
});
let roomsSheet = null;
ctx.gameBook_ = () => ({
  getSheetByName: (n) => (n === 'Game Config' ? sheet(cfgRows) : n === 'Game Rooms' ? roomsSheet : null),
  insertSheet: (n) => { tabMade++; roomsSheet = sheet([]); return roomsSheet; },
});
ctx.gameNow_ = () => new Date('2026-11-06T06:00:00Z');
ctx.gameWithLock_ = (fn) => { locked++; return fn(); };
ctx.gameAppendText_ = (sh, rows) => rows.forEach((r) => sh._rows.push(r));
ctx.eventRoster_ = () => J(roster);
const caller = (email, role, campusId) => ({ email, roles: [role], primaryRole: role, campusId, functions: [] });
const P4 = caller('p4@example.org', 'Principal', 'LMS4'), P3 = caller('p3@example.org', 'Principal', 'LMS3'), OWNER = caller('owner@example.org', 'Owner', 'ALL');
const CALL = caller('call@example.org', 'Coordinator', 'ALL'), C4 = caller('c4@example.org', 'Coordinator', 'LMS4'), T4 = caller('t4@example.org', 'Teacher', 'LMS4');
const get = (c, campus) => J(ctx.roomsGet_(c, campus ? { campus } : {}));
const save = (c, list, campus) => J(ctx.roomsSave_(c, { campus, rooms: list }));

reset(); roomsSheet = null;

// ---- empty state: no tab yet, the Principal sees no rooms, the usual suggestions, their own school's staff only (no Owner)
let g = get(P4);
assert.strictEqual(g.success, true);
assert.strictEqual(g.campus, 'LMS4'); assert.strictEqual(g.campusName, 'LMS 4'); assert.strictEqual(g.canEdit, true);
assert.deepStrictEqual(g.rooms, []);
assert.deepStrictEqual(g.staff.map((p) => p.email), ['p4@example.org', 'fc4@example.org', 't4@example.org'], 'own school, sorted by name, never the Owner or another school');
assert.ok(g.suggest.some((s) => s.name === 'Office' && s.type === 'office'));
assert.deepStrictEqual(g.progress, { named: false, allocated: 0, total: 0, complete: false });
assert.strictEqual(g.types[g.types.length - 1].id, 'other');

// ---- the quest: step 2 locked until a room is named
let q = J(ctx.roomsQuests_(P4, {}, new Date(), {}));
assert.strictEqual(q.length, 1); assert.strictEqual(q[0].questId, 'rooms:LMS4');
assert.deepStrictEqual(q[0].steps.map((s) => [s.id, s.done, s.locked]), [['name', false, false], ['staff', false, true]]);
assert.strictEqual(q[0].steps[0].go, 'principal/rooms.html');
assert.deepStrictEqual(J(ctx.roomsQuests_(T4, {}, new Date(), {})).length, 1, 'registered for the Principal only; a caller check is the registry\'s job');
assert.deepStrictEqual(J(ctx.roomsQuests_(caller('x@example.org', 'Principal', 'ALL'), {}, new Date(), {})), [], 'no single school: no quest');
assert.ok(ctx.GAME_MODULE_QUESTS.Principal.indexOf(ctx.roomsQuests_) !== -1);
assert.ok(!('roomssave' in ctx.GAME_MODULE_ACTIONS), 'the write is POST only');
assert.strictEqual(ctx.QUEST_GATE_HOOKS.roomsQuests_.id, 'hook:rooms', 'the Owner can assign it in the setup period');

// ---- who may read and write
assert.strictEqual(get(P4, 'LMS3').code, 'ROOMS_NO_RIGHT', 'a Principal never reads another school');
assert.strictEqual(get(T4).code, 'ROOMS_NO_RIGHT');
assert.strictEqual(get(C4, 'LMS4').canEdit, false, 'every Coordinator sees every school (gameVisibleCampuses_): read only');
assert.strictEqual(get(OWNER).code, 'ROOMS_BAD_CAMPUS', 'the Owner names the school');
assert.strictEqual(get(OWNER, 'lms4').campus, 'LMS4');
assert.strictEqual(get(CALL, 'LMS4').canEdit, false, 'a network Coordinator reads, never writes');
assert.strictEqual(save(CALL, [], 'LMS4').code, 'ROOMS_NO_RIGHT');
assert.strictEqual(save(T4, [{ name: 'X' }]).code, 'ROOMS_NO_RIGHT');
assert.strictEqual(save(P4, [{ name: 'X' }], 'LMS3').code, 'ROOMS_NO_RIGHT');
assert.strictEqual(tabMade, 0, 'refusals never create the tab');

// ---- input checks: nothing written on a refusal
assert.strictEqual(save(P4, 'nope').code, 'ROOMS_BAD_INPUT');
assert.strictEqual(save(P4, [{ name: '   ' }]).code, 'ROOMS_NO_NAME');
assert.strictEqual(save(P4, [{ type: 'lab' }]).code, 'ROOMS_NO_NAME');
assert.strictEqual(save(P4, [{ name: 'Lab' }, { name: ' lab ' }]).code, 'ROOMS_DUP', 'case and spaces do not make a new name');
assert.strictEqual(save(P4, [{ name: 'Office', staff: 't3@example.org' }]).code, 'ROOMS_BAD_STAFF', 'another school\'s teacher');
assert.strictEqual(save(P4, [{ name: 'Office', staff: 'owner@example.org' }]).code, 'ROOMS_BAD_STAFF', 'never the Owner');
assert.strictEqual(save(P4, Array.from({ length: 151 }, (_, i) => ({ name: 'R' + i }))).code, 'ROOMS_TOO_MANY');
assert.ok(roomsSheet && roomsSheet._rows.length === 1, 'only the header so far');

// ---- a save: names cleaned, formula prefix neutralised, unknown type -> other, ids assigned, people kept
g = save(P4, [{ name: '  Class  7A ', type: 'classroom', staff: 'T4@example.org' }, { name: '=Office', type: 'nope' }, { name: 'Library', type: 'library' }]);
assert.strictEqual(g.success, true);
assert.deepStrictEqual(g.rooms.map((r) => [r.id, r.name, r.type, r.staff, r.staffName]),
  [['r1', 'Class 7A', 'classroom', 't4@example.org', 'Neha Test'], ['r2', "'=Office", 'other', '', ''], ['r3', 'Library', 'library', '', '']]);
assert.deepStrictEqual(g.progress, { named: true, allocated: 1, total: 3, complete: false });
assert.ok(!g.suggest.some((s) => s.name === 'Library'), 'a named room leaves the suggestions');
assert.strictEqual(roomsSheet._rows[1][6], 'p4@example.org', 'By is the caller');

// ---- another school's rows survive a save; ids stay; a removed room goes; new ids never reuse a live one
save(OWNER, [{ name: 'Office', type: 'office' }], 'LMS3');
g = save(P4, [{ id: 'r3', name: 'Library', type: 'library', staff: 'fc4@example.org' }, { id: 'r1', name: 'Class 7A', type: 'classroom', staff: 't4@example.org' }, { name: 'Staff room', type: 'staffroom', staff: 'p4@example.org' }]);
assert.deepStrictEqual(g.rooms.map((r) => r.id), ['r3', 'r1', 'r4']);
assert.deepStrictEqual(g.progress, { named: true, allocated: 3, total: 3, complete: true });
assert.deepStrictEqual(get(OWNER, 'LMS3').rooms.map((r) => r.name), ['Office'], 'LMS 3 untouched by the LMS 4 save');
q = J(ctx.roomsQuests_(P4, {}, new Date(), {}));
assert.strictEqual(q[0].complete, true);
assert.strictEqual(q[0].steps[1].title, 'Put your staff in their rooms (3 of 3)');

// ---- a forged duplicate id gets a fresh one
g = save(P4, [{ id: 'r1', name: 'A' }, { id: 'r1', name: 'B' }]);
assert.deepStrictEqual(g.rooms.map((r) => r.id), ['r1', 'r5']);

// ---- roomsmine: the caller's own rooms only, at their own school
save(P4, [{ name: 'Class 7A', staff: 't4@example.org' }, { name: 'Class 8B', staff: 't4@example.org' }, { name: 'Office', staff: 'fc4@example.org' }]);
assert.deepStrictEqual(J(ctx.roomsMine_(T4, {})).rooms.map((r) => r.name), ['Class 7A', 'Class 8B']);
assert.deepStrictEqual(J(ctx.roomsMine_(caller('t3@example.org', 'Teacher', 'LMS3'), {})).rooms, []);
assert.deepStrictEqual(J(ctx.roomsMine_(OWNER, {})).rooms, []);

// ---- Game Config roomTypes: a good list replaces the default (with 'other' kept); a bad one falls back
cfgRows = [['Key', 'Value'], ['roomTypes', JSON.stringify([{ id: 'classroom', label: 'Class' }, { id: 'BAD id', label: 'x' }])]];
assert.deepStrictEqual(get(P4).types.map((t) => t.id), ['classroom', 'other']);
cfgRows = [['Key', 'Value'], ['roomTypes', '{oops']];
assert.strictEqual(get(P4).types.length, ctx.ROOMS_TYPES_DEFAULT.length);

// ---- a read that throws is a fixed sentence, never the raw message
const keep = ctx.eventRoster_;
ctx.eventRoster_ = () => { throw new Error('secret sheet id 123'); };
g = get(P4);
assert.deepStrictEqual([g.success, g.code], [false, 'ROOMS_ERROR']); assert.ok(!/secret/.test(g.error));
ctx.eventRoster_ = keep;

// ---- doPost carries exactly one roomssave line
const post = fs.readFileSync(dir + 'game.gs', 'utf8').match(/action === 'roomssave'/g) || [];
assert.strictEqual(post.length, 1);

console.log('game-rooms: all checks passed');
