// node tests/game/test-event-design.js -- the Owner quest "Design the event quests": apps-script/game-event-design.gs (GET eventdesign,
// POST eventdesigndecide, the quest and missions) and the pure helpers of assets/game/event-design.js, against data/event-proposals.json
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const J = (x) => JSON.parse(JSON.stringify(x));
const FILE = fs.readFileSync(__dirname + '/../../data/event-proposals.json', 'utf8');
const ITEMS = JSON.parse(FILE).items;

function build(dec, opts) {
  opts = opts || {};
  const ctx = { console: { log() {}, warn() {}, error() {} }, JSON }; vm.createContext(ctx);
  const sheet = { getDataRange: () => ({ getValues: () => dec }), getLastRow: () => dec.length,
    getRange: () => ({ setNumberFormat() { return this; }, setValues(rows) { rows.forEach((r) => dec.push(r)); } }) };
  ctx.SpreadsheetApp = { openById: () => ({ getSheetByName: (n) => (n === 'Game Decisions' ? sheet : null) }) };
  ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => (k === 'GAME_SHEET_ID' ? 'B' : null) }) };
  ctx.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
  const store = {}; ctx.fetches = 0;
  ctx.CacheService = { getScriptCache: () => ({ get: (k) => (k in store ? store[k] : null), put: (k, v) => { store[k] = v; } }) };
  ctx.UrlFetchApp = { fetch: () => { ctx.fetches++; return { getResponseCode: () => (opts.http || 200), getContentText: () => FILE }; } };
  for (const f of ['game-quests.gs', 'game.gs', 'game-actions.gs', 'game-missions.gs', 'game-windows.gs', 'game-event-design.gs'])
    vm.runInContext(fs.readFileSync(__dirname + '/../../apps-script/' + f, 'utf8'), ctx);
  ctx.store = store;
  return ctx;
}

const HEAD = ['WindowId', 'ScopeId', 'Value', 'Note', 'DecidedBy', 'DecidedAt', 'Kind'];
const OWNER = { email: 'Owner@Example.org', roles: ['Owner'] };
const PRIN = { email: 'p@example.org', roles: ['Principal'] };

// the export parses: 23 items, groups as the spec says, ids unique
let ctx = build([HEAD]);
const parsed = J(ctx.edParse_(FILE));
assert.strictEqual(parsed.length, 23);
assert.deepStrictEqual(parsed.map((x) => x.group).filter((g, i, a) => a.indexOf(g) === i), ['calendar', 'chain', 'design']);
assert.strictEqual(ctx.edParse_('not json'), null);
assert.strictEqual(ctx.edParse_('{"items":[{"id":"x y","group":"calendar"},{"id":"Z","group":"other"}]}'), null); // bad id, bad group dropped -> nothing usable

// quest before any fetch (cache only, under the lock): one "open" step, never a fetch
let dec = [HEAD, ['trackSuit', 'LMS1', '"blue"', '', 'x', 't', 'decided']];
ctx = build(dec);
let q = J(ctx.edQuests_(OWNER, {}, new Date()))[0];
assert.strictEqual(q.questId, 'owner:event-design');
assert.deepStrictEqual(q.steps.map((s) => s.id), ['open']);
assert.strictEqual(ctx.fetches, 0);

// missions warm the cache: one mission "23 to decide", no calendar mission yet
let m = J(ctx.edMissions_(OWNER, {}, new Date()));
assert.strictEqual(ctx.fetches, 1);
assert.deepStrictEqual(m.map((x) => x.id), ['ed_decide:network']);
assert.ok(/23 to decide/.test(m[0].title) && m[0].progress.total === 23 && !m[0].done && m[0].go === 'owner/event-design.html');
q = J(ctx.edQuests_(OWNER, {}, new Date()))[0];
assert.deepStrictEqual(q.steps.map((s) => s.title), ['Calendar changes: 0 of 15 decided', 'Event chains: 0 of 6 decided', 'Designs: 0 of 2 decided']);
assert.ok(q.parallel && !q.complete && q.steps[0].go === 'owner/event-design.html#calendar');

// refusals: not the Owner (before anything is read or fetched), bad choice, missing reason/note, unknown id, bad date
const before = ctx.fetches;
assert.strictEqual(ctx.eventDesignDecide_(PRIN, { id: 'C2', decision: 'approved' }).code, 'ED_OWNER_ONLY');
assert.strictEqual(ctx.eventDesignDecide_(null, {}).code, 'ED_OWNER_ONLY');
assert.strictEqual(ctx.edGet_(PRIN).code, 'ED_OWNER_ONLY');
assert.strictEqual(ctx.fetches, before);
assert.strictEqual(ctx.eventDesignDecide_(OWNER, { id: 'C2', decision: 'write-calendar' }).code, 'ED_BAD');
assert.strictEqual(ctx.eventDesignDecide_(OWNER, { id: 'C2', decision: 'declined', note: '  ' }).code, 'ED_NOTE');
assert.strictEqual(ctx.eventDesignDecide_(OWNER, { id: 'C2', decision: 'discussing' }).code, 'ED_NOTE');
assert.strictEqual(ctx.eventDesignDecide_(OWNER, { id: 'C99', decision: 'approved' }).code, 'ED_UNKNOWN');
assert.strictEqual(ctx.eventDesignDecide_(OWNER, { id: 'C2', decision: 'edited', edit: { to: '2027-02-30' } }).code, 'ED_DATE');
assert.strictEqual(ctx.eventDesignDecide_(OWNER, { id: 'C2', decision: 'edited', edit: { to: '2027-02-08x' } }).code, 'ED_DATE');
assert.strictEqual(ctx.eventDesignDecide_(OWNER, { id: 'C2', decision: 'edited', edit: {} }).code, 'ED_EDIT');
assert.strictEqual(ctx.eventDesignDecide_(OWNER, { id: 'C2', decision: 'added' }).code, 'ED_NOT_APPROVED');
assert.strictEqual(ctx.eventDesignDecide_(OWNER, { id: 'B1', decision: 'added' }).code, 'ED_NOT_APPROVED');
assert.strictEqual(dec.length, 2);

// edit -> edited (merged), then approve; the row is a plain Game Decisions row
let r = ctx.eventDesignDecide_(OWNER, { id: 'C2', decision: 'edited', edit: { title: 'Sports Day - LMS 1 (Dhalpur)', to: '2027-02-09', junk: 'x' } });
assert.ok(r.success && r.state.status === 'edited' && r.state.edit.to === '2027-02-09' && !('junk' in r.state.edit));
r = ctx.eventDesignDecide_(OWNER, { id: 'C2', decision: 'edited', edit: { summary: 'One day per school.' } });
assert.deepStrictEqual(J(r.state.edit), { title: 'Sports Day - LMS 1 (Dhalpur)', to: '2027-02-09', summary: 'One day per school.' });
r = ctx.eventDesignDecide_(OWNER, { id: 'C2', decision: 'approved' });
assert.ok(r.success && r.state.status === 'approved' && !r.state.added);
const last = dec[dec.length - 1];
assert.deepStrictEqual(J([last[0], last[1], last[2], last[4], last[6]]), ['event-design', 'C2', '"approved"', 'owner@example.org', 'decided']);
assert.strictEqual(dec.length, 5);

// the windows code still ignores these rows (no window 'event-design')
assert.deepStrictEqual(J(ctx.gameApplyDefaults_([['WindowId']], dec, new Date())), []);

// approved calendar change -> the "add to the calendars" mission; added once, a second tap is unchanged
m = J(ctx.edMissions_(OWNER, {}, new Date()));
const cal = m.filter((x) => x.id === 'ed_calendar:network')[0];
assert.ok(cal && /Add 1 approved event to the calendars/.test(cal.title) && !cal.done && cal.go === 'owner/event-design.html#to-add');
assert.ok(/22 to decide/.test(m[0].title));
r = ctx.eventDesignDecide_(OWNER, { id: 'C2', decision: 'added' });
assert.ok(r.success && r.state.added && !r.unchanged);
r = ctx.eventDesignDecide_(OWNER, { id: 'C2', decision: 'added' });
assert.ok(r.success && r.unchanged);
assert.strictEqual(dec.length, 6);

// discuss keeps it open; decline needs and keeps the reason; reopen puts it back; the GET returns the same state
assert.strictEqual(ctx.eventDesignDecide_(OWNER, { id: 'B1', decision: 'discussing', note: 'Let the school pay.' }).state.status, 'discussing');
r = ctx.eventDesignDecide_(OWNER, { id: 'B6', decision: 'declined', note: '=HYPERLINK("x") not now' });
assert.ok(r.state.status === 'declined' && r.state.note === '=HYPERLINK("x") not now');
assert.ok(/^\{/.test(dec[dec.length - 1][3])); // the note cell is JSON text, never a formula
assert.strictEqual(ctx.eventDesignDecide_(OWNER, { id: 'C2', decision: 'reopened' }).state.status, 'proposed');
let g = J(ctx.edGet_(OWNER));
assert.ok(g.success && g.decisions.C2.status === 'proposed' && g.decisions.C2.added === false && g.decisions.B1.note === 'Let the school pay.');
ctx.eventDesignDecide_(OWNER, { id: 'C2', decision: 'approved' });
assert.strictEqual(J(ctx.edGet_(OWNER)).decisions.C2.added, false); // re-approval needs a fresh "added"

// everything decided -> quest complete
ITEMS.forEach((it) => ctx.eventDesignDecide_(OWNER, { id: it.id, decision: 'approved' }));
q = J(ctx.edQuests_(OWNER, {}, new Date()))[0];
assert.ok(q.complete && q.steps.every((s) => s.done));
m = J(ctx.edMissions_(OWNER, {}, new Date()));
assert.ok(m[0].done && /all decided/.test(m[0].title)); // shown, done, on the day it finished
m = J(ctx.edMissions_(OWNER, {}, new Date(Date.now() + 3 * 86400000)));
assert.ok(m.every((x) => x.id !== 'ed_decide:network')); // gone on a later day

// the site down: the write refuses cleanly, the quest falls back to the open step
const down = build([HEAD], { http: 404 });
assert.strictEqual(down.eventDesignDecide_(OWNER, { id: 'C2', decision: 'approved' }).code, 'ED_NO_ITEMS');
assert.deepStrictEqual(J(down.edMissions_(OWNER, {}, new Date())), []);

// registration: Owner hooks; eventdesign GET; the write only through doPost
assert.ok(ctx.GAME_MODULE_QUESTS.Owner.indexOf(ctx.edQuests_) !== -1 && ctx.GAME_MODULE_MISSIONS.Owner.indexOf(ctx.edMissions_) !== -1);
assert.strictEqual(ctx.GAME_MODULE_ACTIONS.eventdesign, ctx.edGet_);
assert.ok(!('eventdesigndecide' in ctx.GAME_MODULE_ACTIONS));
assert.ok(/action === 'eventdesigndecide'\) return gameJson_\(eventDesignDecide_\(caller, body\)\)/.test(fs.readFileSync(__dirname + '/../../apps-script/game.gs', 'utf8')));

// ── the page's pure helpers ──
const w = { console }; vm.createContext(w);
vm.runInContext(fs.readFileSync(__dirname + '/../../assets/game/event-design.js', 'utf8'), w);
const E = w.LMCSEventDesign;
assert.strictEqual(E.fmtDate('2027-02-08'), 'Mon 8 Feb 2027');
assert.strictEqual(E.fmtWhen('2026-12-25..2026-12-28'), 'Fri 25 Dec 2026 to Mon 28 Dec 2026');
assert.strictEqual(E.fmtWhen(null), 'No date yet');
assert.strictEqual(E.fmtWhen('-7'), '7 days before');
assert.strictEqual(E.label('mockDrill1'), 'Mock drill 1');
assert.strictEqual(E.label('LMS2'), 'LMS 2');
assert.strictEqual(E.label('sop'), 'SOP');
assert.strictEqual(E.valueText({ LMS2: '2027-03-16' }), 'LMS 2 Tue 16 Mar 2027');
assert.strictEqual(E.schoolsText(['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6']), 'All six schools');
const byId = (id) => ITEMS.filter((x) => x.id === id)[0];
let v = E.view(byId('C2'));
assert.strictEqual(E.calLine(v), 'Add "Sports Day - LMS 1" to LMS 1 Students on Mon 8 Feb 2027');
v = E.view(byId('C2'), { status: 'edited', edit: { title: 'Sports Day', to: '2027-02-09' } });
assert.ok(v.edited && E.calLine(v) === 'Add "Sports Day" to LMS 1 Students on Tue 9 Feb 2027');
assert.strictEqual(E.calLine(E.view(byId('C8'))), 'Move "Open House Boards Classes" on LMS 1, 2&3, 4, 5 Students from Fri 25 Dec 2026 to Thu 24 Dec 2026');
assert.ok(/^Move "Sports Week" on LMCS Master from .+: replaced by/.test(E.calLine(E.view(byId('C1')))));
assert.ok(/^Uday's note on event proposal B1 \(Board-class Farewell\), for the Events Director: hi$/.test(E.discussText(E.view(byId('B1')), 'hi')));
assert.deepStrictEqual(J(E.counts([E.view(byId('C2'), { status: 'approved' }), E.view(byId('C3'), { status: 'discussing' })])), { decided: 1, total: 2, left: 1 });
// every item renders a date line and a summary
ITEMS.forEach((it) => { const x = E.view(it); assert.ok(x.title && E.fmtWhen(x.when)); if (it.group === 'calendar') assert.ok(!/undefined/.test(E.calLine(x))); });

// the public file (GitHub Pages): titles and proposed dates only, no staff names, no note paths (Owner's answer "A", 6 Nov)
ITEMS.forEach((it) => assert.deepStrictEqual(Object.keys(it).filter((k) => ['id', 'group', 'title', 'schools', 'when', 'payload'].indexOf(k) === -1), [], it.id + ': public fields only'));
assert.ok(!/Tilak|Urvashi|Pawan|Deepshikha|Neha|Banta|Mukherjee|Puri|Uday|work\/|\.md\b/.test(FILE), 'no staff names or note paths in the public file');
console.log('test-event-design OK');
