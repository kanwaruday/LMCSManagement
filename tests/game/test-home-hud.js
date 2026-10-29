// The Principal home HUD (assets/game/home-hud.js, home-hud.css; hotspots in school-models.js): every LMS 1 hotspot names a known source, each
// source is reachable exactly once (a room or the Quest board), the rank slot stays hidden without `rank`, no lists show on load.
const assert = require('assert'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..'), read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
global.LMCSEmoji = require(path.join(root, 'assets/game/emoji.js'));
const B = require(path.join(root, 'assets/game/school-building.js'));
const M = require(path.join(root, 'assets/game/school-models.js'));
const H = require(path.join(root, 'assets/game/home-hud.js'));
const cfg = M.hotspots;

// hotspots: known sources and kinds, one room each, every room real in the building the campus draws
const lms1 = cfg.LMS1, ids = B.rooms(B.clean(B.SAMPLE)).map((r) => r.id); // LMS 1 has no plan yet: it draws the sample building
for (const s of lms1.hotspots) {
  assert.ok(H.SOURCES[s.source], 'LMS 1 hotspot source is known: ' + s.source);
  assert.ok(H.KINDS.includes(s.kind), 'kind ' + s.kind);
  assert.ok(ids.includes(s.room), 'room ' + s.room + ' is in the drawn building');
}
assert.ok(ids.includes(lms1.entrance), 'the Quest board sits at a real room');
for (const k of ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6']) assert.ok(Array.isArray(cfg[k].hotspots), k + ' has a hotspots array');
assert.deepStrictEqual(Object.keys(M).sort(), ['LMS2'], 'the models stay campus keys only');

// each source exactly once: a placed hotspot or the Quest board, never both, never neither
for (const [name, c, rooms] of [['LMS1', lms1, ids], ['LMS1 with no rooms drawn', lms1, []], ['LMS2 (none)', cfg.LMS2, ids], ['unknown campus', undefined, ids]]) {
  const p = H.plan(c, rooms), placed = p.placed.map((s) => s.source), all = placed.concat(p.board).sort();
  assert.deepStrictEqual(all, Object.keys(H.SOURCES).sort(), name + ': every source once');
  assert.strictEqual(new Set(placed).size, placed.length, name + ': no source on two rooms');
}
assert.deepStrictEqual(H.plan({ hotspots: [{ room: 'x', kind: 'quest', source: 'nope' }, { room: 'office', kind: 'quest', source: 'today' }, { room: 'staff', kind: 'quest', source: 'today' }] }, ['office', 'staff']).placed.length, 1, 'an unknown source and a repeat are dropped');
assert.ok(H.plan(lms1, ids).board.includes('appointments'), 'the gate has no room in the sample: appointments go to the Quest board');

// the rank slot: hidden without `rank`, shown with it
assert.strictEqual(H.rankText({ missions: [] }, { level: 2, points: 40 }), '', 'no rank field: nothing');
assert.strictEqual(H.rankText(null, null), '');
assert.strictEqual(H.rankText({}, { rank: 3 }), 'Rank 3', 'a rank field shows');
const js = read('assets/game/home-hud.js');
assert.ok(/el\.rank = h\('span', \{ class: 'hh-chip hh-rank', hidden: 'hidden' \}\); \/\/ shown only when/.test(js), 'the slot starts hidden, with its comment');
assert.ok(!/fetch\(|XMLHttpRequest|innerHTML|insertAdjacentHTML/.test(js), 'presentation only: no backend call, no parsed HTML');

// the day clock (IST, 15:30)
assert.strictEqual(H.dayClock(new Date('2026-10-29T06:50:00Z')), 'Day closes in 3h 10m', '12:20 IST');
assert.strictEqual(H.dayClock(new Date('2026-10-29T09:55:00Z')), 'Day closes in 5m', '15:25 IST');
assert.strictEqual(H.dayClock(new Date('2026-10-29T10:00:00Z')), 'Day closed', '15:30 IST');
assert.strictEqual(H.setupLeft({ buildings: [{ tiers: [{ state: 'done' }, { state: 'open' }, { state: 'soon' }] }, { tiers: [{ state: 'open' }] }] }), 2);
assert.strictEqual(H.setupLeft(null), 0);

// the page: no list is visible on load (Today, rooms, appointments, sign out wait in the stash; #rooms and #panels are hidden)
const page = read('principal/index.html'), css = read('assets/game/home-hud.css');
assert.ok(/<div id="hh-stash" hidden>[\s\S]*id="game-root"[\s\S]*id="appt-box"[\s\S]*id="signout-link"[\s\S]*<\/div>\s*<div class="hh-scene"/.test(page), 'Today, appointments and sign out sit in the hidden stash');
assert.ok(/<aside class="gb-panels" id="panels" aria-label="More" hidden><\/aside>/.test(page), '#panels hidden and empty');
assert.ok(/body\.hh #base-h, body\.hh #rooms \{ display:none; \}/.test(css), '#rooms hidden by the HUD');
const at = (f) => page.indexOf('<script src="../assets/game/' + f);
assert.ok(at('home-hud.js') > at('game.js') && at('home-hud.js') > at('school-models.js') && at('home-hud.js') < at('rail.js'), 'home-hud.js after game.js and the models');
assert.ok(/id="view-home"[^>]*><span data-emoji="school"><\/span>Town<\/button>/.test(page) && />World<\/button>/.test(page), 'the switch reads Town / World');
// rules: tap size, reduced motion, no raw emoji in markup, the sheet is a labelled modal dialog
assert.ok(/\.hh-b \{[^}]*width:44px; height:44px/.test(css), 'bubbles are 44px');
assert.ok(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*hh-bob/.test(css) && (css.match(/animation:|transition:/g) || []).length === (css.slice(css.indexOf('prefers-reduced-motion')).match(/animation:|transition:/g) || []).length, 'all motion sits inside the no-preference query');
assert.ok(/role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'hh-sheet-h'/.test(js) && /LMCSGame\.ui\.trap/.test(js) && /'aria-label': 'Close'/.test(js) && /role: 'status', 'aria-live': 'polite'/.test(js), 'one sheet: dialog, focus trap, close, live region');
assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(page.slice(page.indexOf('<body'), page.indexOf('<script src')).replace(/<!--[\s\S]*?-->/g, '')), 'no raw emoji in the markup');
console.log('test-home-hud: ok');
