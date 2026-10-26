// node tests/game/test-windows.js -- decision windows: validate, decide, defaults, board, writes
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const ctx = { console };
vm.createContext(ctx);
// either order must work in Apps Script; the test loads game.gs first, then the windows file
for (const f of ['game.gs', 'game-actions.gs', 'game-windows.gs']) vm.runInContext(fs.readFileSync(__dirname + '/../../apps-script/' + f, 'utf8'), ctx);
// these tests pin a three-campus pilot (LMS4-6) so the outside-the-pilot paths stay covered; the shipped default is all six
vm.runInContext("var gameConfigDefaults0_ = gameConfigDefaults_; gameConfigDefaults_ = function () { var d = gameConfigDefaults0_(); d.pilotCampuses.Principal = ['LMS4', 'LMS5', 'LMS6']; d.pilotCampuses.Coordinator = ['LMS4', 'LMS5', 'LMS6']; return d; };", ctx);
const J = (x) => JSON.parse(JSON.stringify(x));

const now = new Date('2026-11-05T05:00:00Z'); // Thu 5 Nov, 10:30 IST
const principal = (campusId) => ({ email: 'p' + campusId + '@lms.org.in', campusId, roles: ['Principal'], primaryRole: 'Principal', canDecide: false });
const p4 = principal('LMS4');
const teacher = { email: 't@lms.org.in', campusId: 'LMS4', roles: ['Teacher'], primaryRole: 'Teacher', canDecide: false };
const coord = { email: 'c@lms.org.in', campusId: 'ALL', roles: ['Coordinator'], primaryRole: 'Coordinator', canDecide: false };
const owner = { email: 'o@lms.org.in', campusId: 'ALL', roles: ['Owner'], primaryRole: 'Owner', canDecide: true };

const TABS = vm.runInContext('GAME_TABS', ctx), WH = TABS['Game Windows'], DH = TABS['Game Decisions']; // const is not a ctx property
const winRow = (o) => WH.map((h) => (o && h in o ? o[h] : {
  WindowId: 'trackSuit', Title: "Choose your campus's track-suit days", Question: 'Which 3 days a week do students come in track suits?',
  Scope: 'campus', ScopeId: '*', Decider: 'Principal',
  Choice: '{"type":"pickN","n":3,"options":["Mon","Tue","Wed","Thu","Fri","Sat"]}', DefaultIfUndecided: '["Mon","Wed","Fri"]',
  Opens: '2026-11-01', Closes: '2026-11-08', AppliesFrom: '2026-11-10', Writes: 'trackSuitDays', OpenedBy: 'o@lms.org.in', ConfirmBy: '',
}[h]));
const decRow = (scopeId, value, kind, by, at) => [ 'trackSuit', scopeId, JSON.stringify(value), '', by || 'x@lms.org.in', at || '2026-11-03T06:00:00Z', kind || 'decided' ];
const WROWS = [WH, winRow()];
const noDec = [DH];
const win = () => J(ctx.gameParseWindow_(winRow())); // raw window: ScopeId stays '*'
const MWF = ['Mon', 'Wed', 'Fri'];

// ── validation ────────────────────────────────────────────────────────
assert.deepStrictEqual(J(ctx.gameValidateDecision_(p4, win(), 'LMS4', MWF, null, now)), { ok: true, kind: 'decided' });
const err = (caller, w, s, v, ex, at) => { const r = J(ctx.gameValidateDecision_(caller, w, s, v, ex === undefined ? null : ex, at || now)); assert.strictEqual(r.ok, false); return r.error; };
assert.strictEqual(err(p4, win(), 'LMS4', ['Mon', 'Wed']), 'Pick exactly 3 days.');
assert.strictEqual(err(p4, win(), 'LMS4', ['Mon', 'Thu', 'Thu']), 'Pick exactly 3 days.');
assert.strictEqual(err(p4, win(), 'LMS4', ['Mon', 'Wed', 'Sun']), "Sun isn't one of the options.");
assert.strictEqual(err(p4, win(), 'LMS4', 'Mon'), 'Pick exactly 3 days.');
assert.strictEqual(err(p4, win(), 'LMS2', MWF), "That campus isn't yours to decide.");
assert.strictEqual(err(p4, win(), 'LMS5', MWF), "That campus isn't yours to decide.");
assert.strictEqual(err(teacher, win(), 'LMS4', MWF), 'Only the Principal decides this.');
assert.strictEqual(err(coord, win(), 'LMS4', MWF), 'Only the Principal decides this.');
assert.strictEqual(err(p4, win(), 'LMS4', MWF, null, new Date('2026-11-09T05:00:00Z')), 'This window closed on Sun 8 Nov.');
assert.strictEqual(err(p4, win(), 'LMS4', MWF, null, new Date('2026-10-30T05:00:00Z')), 'This window opens on Sun 1 Nov.');
// the close date itself is still open, in IST: 23:30 IST on 8 Nov = 18:00Z
assert.strictEqual(ctx.gameValidateDecision_(p4, win(), 'LMS4', MWF, null, new Date('2026-11-08T18:00:00Z')).ok, true);
// 00:30 IST on 9 Nov = 19:00Z on 8 Nov: closed
assert.strictEqual(err(p4, win(), 'LMS4', MWF, null, new Date('2026-11-08T19:00:00Z')), 'This window closed on Sun 8 Nov.');
const earlier = J(ctx.gameParseDecisions_([DH, decRow('LMS4', MWF)])[0]);
assert.strictEqual(err(p4, win(), 'LMS4', ['Tue', 'Thu', 'Sat'], earlier), 'Already decided on Tue 3 Nov. The Owner can change it.');
// a window with no dates set is closed until the Owner opens it
assert.strictEqual(err(p4, Object.assign(win(), { opens: '', closes: '' }), 'LMS4', MWF), 'This window is not open yet.');

// scope leaks: the requested campus must be in the window's real set (the pilot), for everyone
assert.strictEqual(err(principal('LMS2'), win(), 'LMS2', MWF), "That campus isn't yours to decide.");   // own campus, outside the pilot
assert.strictEqual(err(principal('ALL'), win(), 'LMS9', MWF), "That campus isn't yours to decide.");
assert.strictEqual(err(principal('ALL'), win(), 'LMS4', MWF), "That campus isn't yours to decide.");    // an ALL-campus Principal decides nothing
assert.strictEqual(err(owner, win(), 'LMS9', MWF), "That campus isn't yours to decide.");               // the Owner too
assert.strictEqual(err(owner, win(), 'LMS2', MWF), "That campus isn't yours to decide.");
assert.deepStrictEqual(J(ctx.gameValidateDecision_(owner, win(), 'LMS5', MWF, null, now)), { ok: true, kind: 'override' });

// ── Owner override: any time, any scope, still validated ──────────────
assert.deepStrictEqual(J(ctx.gameValidateDecision_(owner, win(), 'LMS5', MWF, earlier, now)), { ok: true, kind: 'override' });
assert.deepStrictEqual(J(ctx.gameValidateDecision_(owner, win(), 'LMS4', MWF, earlier, new Date('2026-12-01T05:00:00Z'))), { ok: true, kind: 'override' });
assert.deepStrictEqual(J(ctx.gameValidateDecision_(owner, win(), 'LMS5', MWF, null, now)), { ok: true, kind: 'override' });
assert.strictEqual(err(owner, win(), 'LMS5', ['Mon']), 'Pick exactly 3 days.');

// ── gameWindowsFor_: what a Principal is asked ────────────────────────
let mine = J(ctx.gameWindowsFor_(p4, WROWS, noDec, now));
assert.strictEqual(mine.length, 1);
assert.strictEqual(mine[0].windowId, 'trackSuit');
assert.strictEqual(mine[0].scopeId, 'LMS4');
assert.strictEqual(mine[0].closes, 'Sun 8 Nov');
assert.strictEqual(mine[0].decided, null);
assert.deepStrictEqual(mine[0].current, MWF);                    // nothing decided, no setting: the default stands
assert.strictEqual(mine[0].choice.n, 3);
mine = J(ctx.gameWindowsFor_(p4, WROWS, [DH, decRow('LMS4', ['Tue', 'Thu', 'Sat'])], now));
assert.deepStrictEqual(mine[0].decided.value, ['Tue', 'Thu', 'Sat']);
assert.deepStrictEqual(mine[0].current, ['Tue', 'Thu', 'Sat']);
assert.strictEqual(ctx.gameWindowsFor_(teacher, WROWS, noDec, now).length, 0);
assert.strictEqual(ctx.gameWindowsFor_(coord, WROWS, noDec, now).length, 0);        // not the decider: sees the board
assert.strictEqual(ctx.gameWindowsFor_(principal('LMS2'), WROWS, noDec, now).length, 0); // LMS2 is outside the pilot
assert.strictEqual(ctx.gameWindowsFor_(p4, WROWS, noDec, new Date('2026-11-09T05:00:00Z')).length, 0); // closed
assert.strictEqual(ctx.gameWindowsFor_(p4, [WH, winRow({ Opens: '', Closes: '' })], noDec, now).length, 0); // template, not opened
assert.strictEqual(ctx.gameWindowsFor_(p4, WROWS, noDec, new Date('2026-10-30T05:00:00Z')).length, 0); // not open yet
// an ALL-campus Principal decides nothing, so is asked nothing
assert.strictEqual(ctx.gameWindowsFor_(principal('ALL'), WROWS, noDec, now).length, 0);

// ── gameApplyDefaults_ ────────────────────────────────────────────────
const afterClose = new Date('2026-11-09T05:00:00Z');
const some = [DH, decRow('LMS4', ['Tue', 'Thu', 'Sat']), decRow('LMS6', MWF, 'override', 'o@lms.org.in')];
const defs = J(ctx.gameApplyDefaults_(WROWS, some, afterClose));
assert.strictEqual(defs.length, 1);
assert.strictEqual(defs[0].scopeId, 'LMS5');
assert.strictEqual(defs[0].kind, 'default_applied');
assert.deepStrictEqual(defs[0].value, MWF);
assert.strictEqual(defs[0].windowId, 'trackSuit');
assert.strictEqual(defs[0].decidedAt, afterClose.toISOString());
assert.strictEqual(ctx.gameApplyDefaults_(WROWS, some, now).length, 0);                       // still open: nothing yet
assert.strictEqual(ctx.gameApplyDefaults_([WH, winRow({ Opens: '', Closes: '' })], noDec, afterClose).length, 0);
assert.strictEqual(ctx.gameApplyDefaults_(WROWS, some.concat(defs.map((d) => ctx.gameDecisionRow_(d))), afterClose).length, 0); // idempotent
// the row to append is plain text in column order
const row = ctx.gameDecisionRow_(defs[0]);
assert.strictEqual(row.length, DH.length);
assert.strictEqual(row[2], '["Mon","Wed","Fri"]');
assert.strictEqual(row[6], 'default_applied');

// ── gameDecisionWrites_ ───────────────────────────────────────────────
assert.deepStrictEqual(J(ctx.gameDecisionWrites_(win(), 'LMS4', MWF)), { key: 'trackSuitDays', path: 'trackSuitDays.LMS4', value: MWF });

// ── gameWindowBoard_ ──────────────────────────────────────────────────
const mix = [DH, decRow('LMS4', ['Tue', 'Thu', 'Sat']), decRow('LMS6', MWF, 'default_applied', '')];
const board = J(ctx.gameWindowBoard_(coord, WROWS, mix, now));
assert.deepStrictEqual(board.map((b) => b.scopeId), ['LMS4', 'LMS5', 'LMS6']);                // every campus the window covers, nothing else
assert.deepStrictEqual(board.map((b) => b.state), ['decided', 'waiting', 'default_applied']);
assert.deepStrictEqual(board[0].value, ['Tue', 'Thu', 'Sat']);
assert.strictEqual(board[1].value, null);
assert.deepStrictEqual(J(ctx.gameWindowBoard_(owner, WROWS, mix, now)).map((b) => b.scopeId), ['LMS4', 'LMS5', 'LMS6']);
assert.strictEqual(ctx.gameWindowBoard_(p4, WROWS, mix, now).length, 0);                      // Principals and Teachers have no board
assert.strictEqual(ctx.gameWindowBoard_(teacher, WROWS, mix, now).length, 0);
// after close, an undecided campus shows its default as the state it will become
assert.deepStrictEqual(J(ctx.gameWindowBoard_(coord, WROWS, noDec, afterClose)).map((b) => b.state), ['default_applied', 'default_applied', 'default_applied']);
// a template with no dates is not on the board
assert.strictEqual(ctx.gameWindowBoard_(coord, [WH, winRow({ Opens: '', Closes: '' })], noDec, now).length, 0);
// pilot list comes from config
const cfg5 = ctx.gameParseConfig_([['Key', 'Value'], ['pilotCampuses', '{"Principal":["LMS4"]}']]);
assert.deepStrictEqual(J(ctx.gameWindowBoard_(coord, WROWS, noDec, now, cfg5)).map((b) => b.scopeId), ['LMS4']);

// M18: a choice row missing its options or a positive n can't be decided here (no throw, no "Pick exactly undefined")
const NOT_HERE = "This window can't be decided here yet.";
assert.strictEqual(ctx.gameCheckChoice_({ type: 'pickN', n: 3 }, ['Mon', 'Tue', 'Wed']), NOT_HERE);
assert.strictEqual(ctx.gameCheckChoice_({ type: 'pickN', options: ['Mon', 'Tue'] }, []), NOT_HERE);
assert.strictEqual(ctx.gameCheckChoice_({ type: 'pickN', n: 0, options: ['Mon'] }, []), NOT_HERE);
assert.strictEqual(ctx.gameCheckChoice_({ type: 'pickN', n: 1, options: ['Mon'] }, ['Mon']), null);
console.log('ok  test-windows');
