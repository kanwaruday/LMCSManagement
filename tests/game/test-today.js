// node tests/game/test-today.js -- Today picking, snapshot lookup, day finalize, days on track
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const ctx = { console };
vm.createContext(ctx);
for (const f of ['game.gs', 'game-actions.gs', 'game-missions.gs']) vm.runInContext(fs.readFileSync(__dirname + '/../../apps-script/' + f, 'utf8'), ctx);
const J = (x) => JSON.parse(JSON.stringify(x));

const M = (id, o) => Object.assign({ id: id, kind: id.split(':')[0], title: '', why: '', owner: '', campus: 'LMS4', go: 'x', due: null,
  core: false, shared: false, done: false, doneAt: null, doneBy: null, rolledOver: false, gone: false }, o || {});

// ── gamePick_ ──────────────────────────────────────────────────────────
const eight = [
  M('t:1', { due: '2026-11-05' }), M('t:2'), M('ss_pace:LMS4', { core: true }), M('t:3', { due: '2026-10-30' }),
  M('t:4'), M('pdr_issue:9', { core: true, due: '2026-10-29' }), M('t:5'), M('t:6'),
];
let picked = J(ctx.gamePick_(eight, 5, ['ss_pace', 'pdr_issue'], ['t:5']));
assert.deepStrictEqual(picked.map((m) => m.id), ['t:5', 'pdr_issue:9', 'ss_pace:LMS4', 't:3', 't:1']); // rolled over, core (by due), then due, nulls last
assert.strictEqual(picked[0].rolledOver, true);
assert.strictEqual(picked[1].rolledOver, false);
assert.deepStrictEqual(J(ctx.gamePick_([], 5, ['ss_pace'], [])), []);
// among equals the earlier (older) one wins; done and gone missions never take a slot
picked = J(ctx.gamePick_([M('t:a'), M('t:b', { done: true }), M('t:c', { gone: true }), M('t:d')], 5, [], []));
assert.deepStrictEqual(picked.map((m) => m.id), ['t:a', 't:d']);
assert.strictEqual(ctx.gamePick_([M('t:a'), M('t:b')], 1, [], []).length, 1);

// ── gameSnapshot_ ──────────────────────────────────────────────────────
const H = ['Day', 'Email', 'Role', 'Campus', 'MissionIds', 'DoneIds', 'Finalized', 'OnTrack', 'CreatedAt'];
const row = (day, email, ids, done, fin, on) => [day, email, 'Principal', 'LMS4', JSON.stringify(ids), JSON.stringify(done || []), fin === undefined ? '' : fin, on === undefined ? '' : on, ''];
const rows = [H, row('2026-10-26', 'p@lms.org.in', ['a:1']), row('2026-10-27', 'q@lms.org.in', ['z:1']), row('2026-10-27', 'P@lms.org.in', ['a:2', 'b:3'], ['a:2'])];
assert.deepStrictEqual(J(ctx.gameSnapshot_(rows, 'p@lms.org.in', '2026-10-27')), { row: 4, missionIds: ['a:2', 'b:3'], doneIds: ['a:2'] }); // row = sheet row, header is 1
assert.strictEqual(ctx.gameSnapshot_(rows, 'p@lms.org.in', '2026-10-28'), null);
assert.strictEqual(ctx.gameSnapshot_([H], 'p@lms.org.in', '2026-10-27'), null);

// ── gameFinalizeDay_ ───────────────────────────────────────────────────
// day 2026-10-27 runs to 04:00 IST on the 28th = 2026-10-27T22:30Z
const snap = { row: 2, missionIds: ['ss_pace:LMS4', 'pdr_issue:9', 'x:1'], doneIds: [] };
const core = ['ss_pace', 'pdr_issue'];
const done = (id, at) => M(id, { core: core.indexOf(id.split(':')[0]) !== -1, done: true, doneAt: at });
const fin = (s, ms) => J(ctx.gameFinalizeDay_(s, ms, '2026-10-27', core));
assert.deepStrictEqual(fin(snap, [done('ss_pace:LMS4', '2026-10-27T05:00:00Z'), done('pdr_issue:9', '2026-10-27T22:29:00Z'), M('x:1')]),
  { counted: true, onTrack: true });                                              // 03:59 IST next day still counts; non-core x:1 is open and irrelevant
assert.deepStrictEqual(fin(snap, [done('ss_pace:LMS4', '2026-10-27T05:00:00Z'), done('pdr_issue:9', '2026-10-27T22:31:00Z'), M('x:1')]),
  { counted: true, onTrack: false });                                             // 04:01 IST next day does not
assert.deepStrictEqual(fin(snap, [done('ss_pace:LMS4', '2026-10-27T05:00:00Z'), M('pdr_issue:9', { core: true }), M('x:1')]),
  { counted: true, onTrack: false });                                             // open at the end
assert.deepStrictEqual(fin(snap, [done('ss_pace:LMS4', '2026-10-26T20:00:00Z'), done('pdr_issue:9', '2026-10-25T05:00:00Z')]),
  { counted: true, onTrack: true });                                              // finished before the day began: still done for that day
assert.deepStrictEqual(fin({ row: 2, missionIds: ['hiring_stall:1', 'x:1'], doneIds: [] }, [M('hiring_stall:1', { core: true, shared: true }), M('x:1')]),
  { counted: false, onTrack: false });                                            // shared never counts
assert.deepStrictEqual(fin({ row: 2, missionIds: ['x:1'], doneIds: [] }, [M('x:1')]), { counted: false, onTrack: false }); // no core missions
assert.deepStrictEqual(fin({ row: 2, missionIds: [], doneIds: [] }, []), { counted: false, onTrack: false });
// gone core mission is ignored (flagged gone, or missing from today's list: R9)
assert.deepStrictEqual(fin(snap, [done('ss_pace:LMS4', '2026-10-27T05:00:00Z'), M('pdr_issue:9', { core: true, gone: true })]), { counted: true, onTrack: true });
assert.deepStrictEqual(fin(snap, [M('pdr_issue:9', { core: true, gone: true })]), { counted: false, onTrack: false });
assert.deepStrictEqual(fin(snap, []), { counted: false, onTrack: false });

// ── gameDaysOnTrack_ ───────────────────────────────────────────────────
// Finalized TRUE + OnTrack TRUE/FALSE = counted day; Finalized TRUE + OnTrack blank = day with no counted missions
const month = (key, n, counted, onTrack, email) => {
  const out = [];
  for (let d = 1; d <= n; d++) {
    const day = key + '-' + String(d).padStart(2, '0');
    if (d <= onTrack) out.push(row(day, email, ['a:' + d], [], true, true));
    else if (d <= counted) out.push(row(day, email, ['a:' + d], [], true, false));
    else out.push(row(day, email, ['x:' + d], [], true, ''));
  }
  return out;
};
const fx = [H].concat(month('2026-10', 31, 21, 18, 'p@lms.org.in'), month('2026-09', 30, 20, 15, 'p@lms.org.in'), month('2026-10', 31, 31, 31, 'q@lms.org.in'),
  [row('2026-10-31', 'p@lms.org.in', ['a:99'], [], '', ''), row('2026-10-30', 'p@lms.org.in', ['a:98'], [], false, true)]); // not finalized: ignored
assert.deepStrictEqual(J(ctx.gameDaysOnTrack_(fx, 'p@lms.org.in', '2026-10')), { onTrack: 18, counted: 21, lastMonthOnTrack: 15, lastMonthCounted: 20 });
assert.deepStrictEqual(J(ctx.gameDaysOnTrack_(fx, 'P@lms.org.in', '2027-01')), { onTrack: 0, counted: 0, lastMonthOnTrack: 0, lastMonthCounted: 0 });
assert.deepStrictEqual(J(ctx.gameDaysOnTrack_(fx, 'p@lms.org.in', '2026-11')).lastMonthCounted, 21); // year/month rollover: Jan -> Dec checked below
assert.strictEqual(ctx.gameDaysOnTrack_([H, row('2026-12-05', 'p@lms.org.in', ['a:1'], [], true, true)], 'p@lms.org.in', '2027-01').lastMonthOnTrack, 1);
// a Sheets Date in the Day column (midnight IST) still reads as that day
assert.strictEqual(ctx.gameSnapshot_([H, [vm.runInContext("new Date('2026-10-26T18:30:00Z')", ctx), 'p@lms.org.in', 'P', 'L', '["a:1"]', '[]', '', '', '']], 'p@lms.org.in', '2026-10-27').row, 2);
console.log('test-today OK');
