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
assert.strictEqual(H.dayClock(new Date('2026-10-29T06:50:00Z')), 'Closes 3:30 pm', '12:20 IST');
assert.strictEqual(H.dayClock(new Date('2026-10-29T09:55:00Z')), 'Closes 3:30 pm', '15:25 IST');
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
assert.ok(/role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'hh-sheet-h'/.test(js) && /s\.onKey/.test(js) && /'aria-label': S\.L\.close/.test(js) && H.LABELS.close === 'Close' && /role: 'status', 'aria-live': 'polite'/.test(js), 'one sheet: dialog, focus trap, close, live region');
assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(page.slice(page.indexOf('<body'), page.indexOf('<script src')).replace(/<!--[\s\S]*?-->/g, '')), 'no raw emoji in the markup');
// the tours point at visible HUD controls, not the stash; other pages keep their targets
const guide = read('assets/game/guide.js'), gp = guide.slice(guide.indexOf("'principal/index.html'"), guide.indexOf("'coordinator/index.html'"));
assert.ok(gp.includes("target: '#hh-strip'") && gp.includes("target: '#school-3d'") && !gp.includes('#game-root') && !gp.includes("'#modules'"), 'guide tour: quest strip and building');
assert.ok(/LMCSGame\.setTourTargets\(\{ today: '#hh-strip', go: null, bar: '#hh-edge', quest: null \}\)/.test(js), 'the HUD sets the greeting/first-visit tour targets');
const game = read('assets/game/game.js');
assert.ok(/function tt\(k, d\) \{ return k in tourTargets \? tourTargets\[k\] : d; \}/.test(game) && /target: tt\('today', todayEl\)/.test(game) && /var tourTargets = \{\};/.test(game), 'game.js: defaults unchanged when no targets are set');
// drawSchool finds the campus from campusId when session.campus is absent
assert.ok(/LMCSBuildingModels\[session\.campus \|\| String\(session\.campusId/.test(page), 'drawSchool: session.campus || session.campusId');
// review fixes: the edge follows the drawer in the DOM (so `.is-open ~ .hh-edge` matches), the drawer has an X and closes on an outside tap
assert.ok(/\[tl, top, el\.events, el\.drawer, el\.edge, bottom\]/.test(js) && /\.hh-drawer\.is-open ~ \.hh-edge/.test(css), 'edge is built after the drawer');
assert.ok(/'aria-label': L\.closeTasks \}, '\\u00d7'/.test(js) && H.LABELS.closeTasks === 'Close tasks' && /pointerdown', function \(e\) \{ if \(el\.drawer\.classList\.contains\('is-open'\)/.test(js) && /if \(S\.drawer\) S\.drawer\(false\)/.test(js), 'drawer: X, outside tap, closes when a sheet opens');
assert.ok(/body\.hh \.lg-nextbar \{ display:none !important; \}/.test(css), "game.js's next-step bar is hidden here");
assert.ok(/if \(document\.querySelector\('\.lg-layer'\)\) return;/.test(js) && !/LMCSGame\.ui\.trap/.test(js), 'the sheet leaves Esc and Tab to a game.js card');
assert.ok(/data-hh/.test(js) && /S\.bm\[key\]/.test(js) && /function backTo/.test(js) && !/layer\.textContent = ''/.test(js), 'bubbles update in place; focus returns by key');
assert.ok(/LINK_ONLY = \['daily', 'hr', 'routes'\]/.test(js), 'link-only bubbles');
assert.strictEqual(H.rankText({ rank: 'x'.repeat(50) }).length, 20, 'rank text is capped');
assert.ok(LMCSEmoji.get('setupUp') && !/u2b06|\u2b06/.test(js) && /function chip\(/.test(js) && !/textContent = LMCSEmoji/.test(js), 'setup bubble and chips use the emoji map, not typed or glued emoji');
// Uday's first look: Esc closes the drawer from the edge tab too, a header with a 44px X that stays put, a labelled edge tab, no hint line
assert.ok(/document\.addEventListener\('keydown', function \(e\) \{[^\n]*\n\s*if \(e\.key === 'Escape' && el\.drawer\.classList\.contains\('is-open'\)[^\n]*drawer\(false, true\)/.test(js) && !/el\.drawer\.addEventListener\('keydown'/.test(js), 'Esc closes the open drawer from anywhere, focus back on the tab');
assert.ok(/h\('div', \{ class: 'hh-drawer-head' \}, \[h\('h2', \{\}, L\.tasks\), el\.drawerX\]\)/.test(js) && H.LABELS.tasks === 'Tasks' && /\.hh-drawer-head \{ position:sticky; top:0/.test(css) && /\.hh-x \{ width:44px; height:44px/.test(css), 'drawer header: Tasks title and a 44px X, sticky');
assert.ok(/focus\)? \(on \? el\.drawerX : el\.edge\)\.focus\(\)|\(on \? el\.drawerX : el\.edge\)\.focus\(\)/.test(js), 'opening moves focus to the X');
assert.ok(LMCSEmoji.get('tasks') && /emoji\('tasks'\), h\('span', \{ class: 'hh-edge-t' \}, L\.tasks\)/.test(js) && /u25c2 Close/.test(js) && /textContent = on \? L\.closeTab : L\.tasks/.test(js) && /\.hh-edge \{[^}]*min-width:56px; min-height:72px/.test(css), 'the edge tab: Tasks + emoji, reads Close when open, 56x72');
assert.ok(!/Tap a room/.test(page) && /id="school-said"/.test(page), 'the hint line is gone (only an empty spoken status remains)');
assert.ok(/getElementById\('lmcs-datasrc'\)/.test(js) && /body\.hh #lmcs-datasrc \{ display:none; \}/.test(css), 'the data-source row moves into the profile sheet');
assert.ok(/\.hh-bottom \{ position:fixed; left:8px; right:68px; bottom:calc\(8px \+ var\(--bd-lift/.test(css), 'bottom controls clear the rail and the Buddy button');
console.log('test-home-hud: ok');
assert.ok(/e\.key === 'Escape' && el\.drawer\.classList\.contains\('is-open'\) && !e\.defaultPrevented/.test(js), 'one Esc closes one window: a sheet or card that handled Esc first leaves the drawer open');
assert.ok(/body\.hh #lmcs-warm-chip \{ bottom:calc\(190px/.test(fs.readFileSync(path.join(root, 'assets/game/home-hud.css'), 'utf8')), 'the loading chip clears the Town/World row');
assert.ok(/body\.hh \.sb-art \{ display:none; \}/.test(fs.readFileSync(path.join(root, 'assets/game/home-hud.css'), 'utf8')), 'one building on the home: the separate campus picture is hidden');
