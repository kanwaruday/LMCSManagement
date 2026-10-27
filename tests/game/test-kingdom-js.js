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

// K5: write bodies, due date, suggestion
const tierC = { questId: 'p1' };
assert.deepStrictEqual(JSON.parse(JSON.stringify(K.assignBody(tierC, 'LMS4', 'a@x.org', 'hi'))), { action: 'kingdomassign', quest: 'p1', campus: 'LMS4', assignee: 'a@x.org', note: 'hi' });
assert.strictEqual(K.assignBody({ questId: 'p3' }, 'HES', 'a@x.org', '').campus, '', 'network quest at the Darbar: campus is empty');
const clr = K.assignBody(tierC, 'LMS4', 'a@x.org', '', true);
assert.ok(clr.clear === true && clr.assignee === '', 'clear carries clear:true and no assignee');
assert.deepStrictEqual(Object.keys(K.allocateBody({ id: 'A1', title: 'x' }, 'h@x.org', '2026-11-06', 'n')).sort(), ['action', 'approvalId', 'assignee', 'due', 'note']);
assert.strictEqual(K.allocateBody({ id: 'A1' }, 'h@x.org', '2026-11-06', 'n').action, 'kingdomallocate');
assert.strictEqual(K.defaultDue('2026-10-30', 7), '2026-11-06');
assert.strictEqual(K.defaultDue('2026-12-28', 7), '2027-01-04', 'year rollover');
assert.strictEqual(K.defaultDue('2028-02-26', 3), '2028-02-29', 'leap day');
assert.strictEqual(K.defaultDue('nonsense', 7), '');
const hd = [{ id: 'a', email: 'a@x.org', functions: ['hr'] }, { id: 'b', email: 'b@x.org', functions: ['finance', 'events'] }];
assert.strictEqual(K.suggestHead({ category: 'Financial / Purchase' }, hd, K.deptFunction).id, 'b');
assert.strictEqual(K.suggestHead({ category: 'Leave' }, hd).id, 'a');
assert.strictEqual(K.suggestHead({ category: 'Other' }, hd), null);
assert.strictEqual(K.suggestHead({ category: 'Academic Change' }, hd), null, 'no head has the function');
assert.strictEqual(K.cardText({ title: 'Bus repair', campus: 'LMS4' }), 'Approved: Bus repair · LMS4');
// K5 source: both writes are POST, behind a confirm button; no write on load; Owner-only; text nodes only
assert.ok(/method: 'POST'/.test(src) && /'kingdomassign'/.test(src) && /'kingdomallocate'/.test(src), 'both write actions are POST');
assert.strictEqual((src.match(/method: 'POST'/g) || []).length, 1, 'one write path');
assert.ok(/if \(W\.busy\) return;/.test(src) && /c\.disabled = true/.test(src) && /c\.disabled = false/.test(src), 'controls disabled in flight, re-enabled on failure');
assert.ok(/d\.role !== 'Owner'/.test(src) && /S\.data\.role === 'Owner'/.test(src), 'tray and buttons are Owner only');
assert.ok(/ctl\.err\.textContent = /.test(src), 'server sentence shown as text');
// K6 fixes
assert.strictEqual(K.guideGo({ guide: 'setup-signin' }), 'guide/index.html#setup-signin', 'I1: a step gets a How link');
assert.strictEqual(K.guideGo({ guide: 'x"><b' }), '', 'I1: a non-id guide never becomes a link');
assert.strictEqual(K.guideGo({}), '');
assert.ok(/guideGo\(s\) \? goLink\(guideGo\(s\), 'How'\)/.test(src), 'I1: tierRow renders the How link');
const sentTo = (tier, base) => K.assignBody(tier, base, 'a@x.org', '').campus;
assert.strictEqual(sentTo({ questId: 'p1', campus: 'LMS4' }, 'HES'), 'LMS4', 'M3: tier.campus wins over the base');
assert.strictEqual(sentTo({ questId: 'p3', campus: '' }, 'LMS4'), '', 'M3: network quest sends empty campus');
assert.ok(/e && e\.server \? e\.message : SEND_ERR/.test(src) && !/e\.message !== 'Failed to fetch'/.test(src), 'M6: only the server sentence passes through');
assert.ok(/function dismiss\(\) \{ if \(!W\.busy\) closeLayer\(\); \}/.test(src) && !/onclick: closeLayer|, closeLayer\)|dlg, closeLayer/.test(src), 'M7: every way out goes through dismiss');
assert.ok(/!L\.opener\.isConnected/.test(src), 'M8: focus returns to the base button when the opener is gone');
assert.ok(/h\('legend'/.test(src), 'M10: radio groups have a legend');
assert.ok(!/aria-live/.test(src) && !/aria-live/.test(read('owner/kingdom.html')), 'M10: no live region on the root or advisor');
assert.ok(/\.kg-go \{[^}]*min-width:44px/.test(read('assets/game/kingdom.css')), 'M10: .kg-go is 44px both ways');
console.log('kingdom js: all passed');
