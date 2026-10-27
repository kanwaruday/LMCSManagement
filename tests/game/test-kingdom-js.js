// Kingdom page (assets/game/kingdom.js): the pure helpers in a vm, then source checks on the page.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..', '..'), read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const ctx = { window: {}, LMCSGame: { safeHref: (g, r) => (/^[a-z]+:/i.test(g) ? null : (r || '') + g) }, console };
vm.createContext(ctx);
vm.runInContext(read('assets/game/kingdom.js'), ctx);
const K = ctx.window.LMCSKingdom;
assert.ok(K && typeof K.tierText === 'function', 'helpers returned without a document');
assert.strictEqual(typeof K.mount, 'undefined', 'no page code without a document');

// tierText: the four states
assert.strictEqual(K.tierText({ label: 'Houses', state: 'done' }), '✓ Houses');
assert.strictEqual(K.tierText({ label: 'Houses', state: 'open' }), 'Houses');
assert.strictEqual(K.tierText({ label: 'Houses', state: 'soon' }), 'Houses · coming soon');
assert.strictEqual(K.tierText({ label: 'Houses', state: 'unknown' }), "Houses · couldn't check");

// buildingState: empty, partial, full
assert.strictEqual(K.buildingState({ level: 0, maxLevel: 5 }), 'empty');
assert.strictEqual(K.buildingState({ level: 2, maxLevel: 5 }), 'construction');
assert.strictEqual(K.buildingState({ level: 5, maxLevel: 5 }), 'built');
assert.strictEqual(K.baseBadge({ level: 4 }), 'Lv 4');

// sortBases: the Darbar first, the rest in config order (never by level)
const order = (a) => a.map((b) => b.id).join();
assert.strictEqual(order(K.sortBases([{ id: 'LMS1', level: 9 }, { id: 'LMS2', level: 1 }, { id: 'HES', darbar: true, level: 1 }, { id: 'LMS3', level: 5 }])), 'HES,LMS1,LMS2,LMS3');
assert.strictEqual(order(K.sortBases(null)), '');

// small helpers
assert.strictEqual(K.baseOfGo('#base-LMS5'), 'LMS5');
assert.strictEqual(K.baseOfGo('javascript:alert(1)'), '');
assert.strictEqual(K.safeGo('setup/index.html', '../'), '../setup/index.html');
assert.strictEqual(K.safeGo('javascript:alert(1)', '../'), null);
assert.strictEqual(K.pos({ x: 500, y: 310 }), 'left:50%;top:50%');
assert.strictEqual(K.countText(1), '1 mission open');
assert.strictEqual(K.countText(0), '0 missions open');
assert.strictEqual(K.openCount({ missions: [{ done: true }, {}, {}] }), 2);
assert.ok(/level 2, 1 step couldn't/.test(K.baseLabel({ full: 'LMS 2', level: 2, unknown: 1 })), 'unknown steps are named in the label');

// source: no HTML from strings; no write calls (K4 is read-only); links only through safeHref
const src = read('assets/game/kingdom.js');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(src.replace(/innerHTML = ''/g, '')), 'no innerHTML-type APIs');
assert.ok(!/method: 'POST'|XMLHttpRequest|sendBeacon/.test(src), 'read-only: no writes on this page');
assert.ok(/action=gamekingdom/.test(src), 'reads gamekingdom');
assert.ok(!/\.href\s*=|setAttribute\('href'/.test(src.replace(/u\.setAttribute\('href', '#k-'/, '')), 'links are never assigned directly');
assert.ok(/prefers-reduced-motion/.test(read('assets/game/kingdom.css')), 'css respects reduced motion');
assert.ok(/min-height:44px/.test(read('assets/game/kingdom.css')), '44px targets');
assert.ok(/location\.hostname === 'localhost'/.test(src), '_render only on localhost');

// page: same backend as the dock, loaded scripts, linked from the owner home, stamped, guided, exempt from data-source links
const page = read('owner/kingdom.html'), dock = read('assets/game/buddy-dock.js');
assert.strictEqual(/const GAME_BACKEND_URL = '([^']*)'/.exec(page)[1], /var BACKEND = '([^']*)'/.exec(dock)[1], 'GAME_BACKEND_URL equals the dock BACKEND');
for (const f of ['auth.js', 'game/game.js', 'game/kingdom.js']) assert.ok(page.includes('../assets/' + f), 'loads ' + f);
assert.ok(page.includes('../assets/game/kingdom.css'), 'loads kingdom.css');
assert.ok(/LMCS\.canViewOwnerPortal/.test(page) && /Your school's view comes soon\./.test(page), 'same gate as the owner home; Principals get the soon line');
assert.ok(!/innerHTML/.test(page), 'page: no innerHTML');
assert.ok(/url: 'kingdom\.html'/.test(read('owner/index.html')), 'owner/index.html links to kingdom.html');
assert.ok(read('tools/stamp-assets.mjs').includes("'owner/kingdom.html'"), 'page is stamped');
assert.ok(read('tests/datasrc/test-datasrc.js').includes("'owner/kingdom.html'"), 'page is in the data-source exemptions');
assert.ok(read('assets/game/guide.js').includes("'owner/kingdom.html'"), 'guide covers the page');
assert.ok(/open: open \}/.test(dock), 'the dock exposes open()');
console.log('kingdom js: all passed');
