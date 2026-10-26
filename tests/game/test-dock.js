// node tests/game/test-dock.js -- the floating Buddy (assets/game/buddy-dock.js): pure helpers in a vm without a DOM,
// then source checks: no HTML from strings, one backend URL, auth.js loads the dock once, the guide page's conventions.
const vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');
const root = path.join(__dirname, '../..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const J = (x) => JSON.parse(JSON.stringify(x));
const src = read('assets/game/buddy-dock.js');

const ctx = { console }; ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(read('assets/game/guide.js'), ctx);
vm.runInContext(src, ctx); // no document: helpers only, nothing mounts
const D = ctx.LMCSDock;
assert.strictEqual(D.avoid, '#lmcs-warm-chip, .bottom-nav', 'avoid defaults to the warm-up chip and the Teacher home bottom nav');
assert.ok(/if \(navigator\.onLine && PATH !== 'guide\/index\.html'\)/.test(src), 'offline: no navigation to the guide page');
assert.ok(/action=gametoday&peek=1&/.test(src), 'the dock only peeks: opening Buddy never uses up the home greeting');

// the page's path relative to the portal root
assert.strictEqual(D.pagePath('/LMCSManagement/coordinator/x.html', '/LMCSManagement/'), 'coordinator/x.html');
assert.strictEqual(D.pagePath('/LMCSManagement/', '/LMCSManagement/'), 'index.html');
assert.strictEqual(D.pagePath('/LMCSManagement/coordinator/transport/', '/LMCSManagement/'), 'coordinator/transport/index.html');
assert.strictEqual(D.pagePath('/coordinator/transport/setup.html', '/'), 'coordinator/transport/setup.html'); // served from the repo root
assert.strictEqual(D.pagePath('/LMCSManagement/guide/index.html', '/LMCSManagement/'), 'guide/index.html');
assert.strictEqual(D.pagePath('/other/x.html', '/LMCSManagement/'), 'other/x.html'); // outside the root: just the path
// the way back up to the portal root from a page
assert.strictEqual(D.rootFrom('index.html'), '');
assert.strictEqual(D.rootFrom('coordinator/x.html'), '../');
assert.strictEqual(D.rootFrom('coordinator/transport/setup.html'), '../../');

// tourId from path: the backend accepts [\w-]{1,60}
assert.strictEqual(D.tourId('coordinator/transport/setup.html'), 'page-coordinator-transport-setup-html');
assert.strictEqual(D.tourId('index.html'), 'page-index-html');
assert.ok(/^[\w-]{1,60}$/.test(D.tourId('a/'.repeat(40) + 'x.html')));

// guide search: case-insensitive, title hits before body hits, at most 5, nothing for an empty query
const arts = [
  { id: 'b1', title: 'Days on track', body: ['How the fleet counts.'] },
  { id: 't1', title: 'Fleet setup', body: ['x'] },
  { id: 'b2', title: 'Quests', body: 'A FLEET quest too.' },
  { id: 'n', title: 'Decisions', body: ['Track-suit days.'] },
  { id: 't2', title: 'The fleet page', body: [] },
  { id: 'b3', title: 'c', body: ['fleet'] }, { id: 'b4', title: 'd', body: ['fleet'] }, { id: 'b5', title: 'e', body: ['fleet'] },
];
assert.deepStrictEqual(J(D.search(arts, 'Fleet')).map((a) => a.id), ['t1', 't2', 'b1', 'b2', 'b3']);
assert.deepStrictEqual(J(D.search(arts, '  ')), []);
assert.deepStrictEqual(J(D.search(arts, 'suit')).map((a) => a.id), ['n']);
assert.deepStrictEqual(J(D.search(null, 'x')), []);
assert.ok(D.search(ctx.LMCSGuide.articles, 'buddy').length >= 1, 'the shipped sample articles are searchable');

// the first open setup step: setup:* quests only, first unfinished quest, first open unlocked not-waiting step
const step = (id, o) => Object.assign({ id, title: id, go: '', done: false, locked: false }, o);
assert.strictEqual(D.setupStep({ quests: [{ questId: 'fleet:a', steps: [step('f')] }] }), null);
assert.strictEqual(D.setupStep({}), null);
assert.strictEqual(D.setupStep({ quests: [{ questId: 'setup:game', complete: true, steps: [step('a', { done: true })] }] }), null);
assert.strictEqual(D.setupStep({ quests: [{ questId: 'setup:game', steps: [step('a', { done: true }), step('b', { waiting: true }), step('c', { guide: 'setup-form' }), step('d')] }] }).id, 'c');
assert.strictEqual(D.setupStep({ quests: [{ questId: 'setup:game', steps: [step('a', { locked: true })] }] }), null);

// no HTML from strings in the dock or the guide page's script
const banned = /innerHTML|outerHTML|insertAdjacentHTML|document\.write|createContextualFragment|DOMParser/;
assert.ok(!banned.test(src), 'buddy-dock.js must not build HTML from strings');
const guideHtml = read('guide/index.html');
const guideJs = (guideHtml.match(/<script>([\s\S]*?)<\/script>/g) || []).join('\n');
assert.ok(guideJs.length > 200, 'guide/index.html has its own inline script');
assert.ok(!banned.test(guideJs), "guide/index.html's script must not build HTML from strings");

// the dock's backend URL is every page's GAME_BACKEND_URL
const dockUrl = /var BACKEND = '(https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec)';/.exec(src);
assert.ok(dockUrl, 'buddy-dock.js: one BACKEND constant');
const pages = execPages();
assert.ok(pages.length >= 7, 'pages with GAME_BACKEND_URL found');
for (const p of pages) {
  const m = /const GAME_BACKEND_URL = '([^']*)';/.exec(read(p));
  assert.strictEqual(m[1], dockUrl[1], p + ': GAME_BACKEND_URL matches the dock');
}
function execPages() {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (['.git', 'node_modules', 'tests', 'graphify-out', '.superpowers'].includes(e.name)) continue;
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) walk(rel); else if (e.name.endsWith('.html') && read(rel).includes('const GAME_BACKEND_URL = ')) out.push(rel);
    }
  })('');
  return out;
}

// auth.js loads the dock exactly once: on load with a session, never again after, never without one, never when opted out
function runAuth(session, extra) {
  const added = [];
  const el = (tag) => ({ tag, setAttribute() {} });
  const store = { lmcs_session: session ? JSON.stringify(session) : null };
  const c = vm.createContext(Object.assign({
    localStorage: { getItem: (k) => store[k] || null, setItem() {}, removeItem() {}, key: () => null, length: 0 }, URL, Response, console,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, atob: (x) => Buffer.from(x, 'base64').toString('binary'), navigator: {},
    performance: { getEntriesByType: () => [] }, location: { href: 'https://portal.test/LMCSManagement/coordinator/' },
    document: { readyState: 'loading', hidden: false, body: null, addEventListener() {}, getElementById: () => null,
      currentScript: { src: 'https://portal.test/LMCSManagement/assets/auth.js?v=1234abcd' },
      createElement: el, head: { appendChild: (n) => added.push(n) } },
    fetch: async () => new Response('{}'),
  }, extra || {}));
  c.window = c; c.addEventListener = () => {};
  vm.runInContext(read('assets/auth.js'), c);
  return added.map((n) => n.src || n.href || '').filter((u) => /buddy-dock/.test(u));
}
const live = { email: 'a@lms.org.in', role: 'Owner', campusId: 'ALL', expiresAt: Date.now() + 3600e3, idToken: 'x' };
const DOCK_V = (read('assets/auth.js').match(/const DOCK_V = '([0-9a-f]{8})'; \/\/ stamp-assets/) || [])[1];
assert.ok(DOCK_V, 'auth.js carries a stamped DOCK_V');
{ // stale-stamp detection: --check fails when a dock file moved after stamping (tools/stamp-assets.mjs; verify.mjs runs the same check)
  const stamp = fs.readFileSync(path.join(root, 'tools/stamp-assets.mjs'), 'utf8');
  assert.ok(/DOCK_FILES = \['buddy-dock\.js', 'buddy-dock\.css', 'game\.js', 'game\.css', 'guide\.js'\]/.test(stamp) && /stale\.push\('assets\/auth\.js \(DOCK_V\)'\)/.test(stamp), 'the stamp covers the five dock files and checks DOCK_V');
}
assert.deepStrictEqual(runAuth(live), ['https://portal.test/LMCSManagement/assets/game/buddy-dock.css?v=' + DOCK_V,
  'https://portal.test/LMCSManagement/assets/game/buddy-dock.js?v=' + DOCK_V]);
assert.deepStrictEqual(runAuth(null), []);
assert.deepStrictEqual(runAuth(live, { LMCS_NO_DOCK: true }), []);
const auth = read('assets/auth.js');
assert.strictEqual((auth.match(/loadDock_\(\);/g) || []).length, 2, 'loadDock_() is called in two places: on load and after a fresh sign-in');
const enterWith = auth.slice(auth.indexOf('function enterWith_('), auth.indexOf('function showChecking_('));
assert.ok(/\n {10}loadDock_\(\);\n/.test(enterWith), 'a fresh sign-in loads the dock');
assert.ok(/if \(docked \|\| window\.LMCS_NO_DOCK/.test(auth), 'loadDock_ runs once per page and honours LMCS_NO_DOCK');

// the guide page follows the page conventions: in the stamp list, exempt from data-source links, loads auth.js and guide.js
assert.ok(read('tools/stamp-assets.mjs').includes("'guide/index.html'"), 'guide page is stamped');
assert.ok(read('tests/datasrc/test-datasrc.js').includes("'guide/index.html'"), 'guide page is in the data-source exemptions');
assert.ok(/<script src="\.\.\/assets\/game\/guide\.js(\?v=[0-9a-f]+)?"/.test(guideHtml), 'guide page loads guide.js');
assert.ok(/<script src="\.\.\/assets\/auth\.js(\?v=[0-9a-f]+)?"/.test(guideHtml), 'guide page loads auth.js (the dock shows there too)');
// the guide's content: every page entry exists, every tour target is an #id that is in its page (static HTML, or the office
// pages' own scripts), every portal page is covered, every setup step has an article, no honorifics
const G = ctx.LMCSGuide;
const html = (p) => read(p) + (p.startsWith('office/') ? fs.readdirSync(path.join(root, 'office/js')).map((f) => read('office/js/' + f)).join('') : '');
for (const [p, g] of Object.entries(G.pages)) {
  assert.ok(fs.existsSync(path.join(root, p)), 'guide page entry exists: ' + p);
  assert.ok(g.purpose && g.purpose.length < 140 && Array.isArray(g.roles), p + ': a one-sentence purpose and roles');
  const beats = g.tour || [];
  assert.ok(!beats.length || (beats.length >= 2 && beats.length <= 5), p + ': 2-5 tour beats');
  for (const b of beats) {
    assert.ok(/^#[\w-]+$/.test(b.target) && b.text, p + ': tour beat is an #id with text');
    assert.ok(html(p).includes('id="' + b.target.slice(1) + '"'), p + ': tour target ' + b.target);
  }
}
const portalPages = require('child_process').execSync('git ls-files "*.html"', { cwd: root }).toString().trim().split('\n').filter((p) => !/^(docs|tests)\//.test(p));
for (const p of portalPages) assert.ok(G.pages[p], 'guide covers ' + p);
for (const p of ['principal/index.html', 'coordinator/index.html', 'owner/index.html', 'teacher/index.html', 'coordinator/transport/setup.html', 'teacher/plan-activity.html', 'office/index.html', 'office/daybook.html'])
  assert.ok((G.pages[p].tour || []).length >= 2, p + ' has a tour');
const ids = G.articles.map((a) => a.id);
assert.strictEqual(new Set(ids).size, ids.length, 'article ids are unique');
for (const a of G.articles) {
  assert.ok(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(a.id), a.id + ': kebab-case');
  assert.ok(a.title && a.body.length >= 2 && a.body.length <= 5, a.id + ': 2-5 paragraphs');
}
for (const id of ['meet-buddy', 'setup-signin', 'setup-secret', 'setup-refresh', 'setup-form', 'setup-term', 'setup-suit']) assert.ok(ids.includes(id), 'article ' + id);
for (const m of read('apps-script/game-setup.gs').matchAll(/^\s+\['(\w+)', /gm)) assert.ok(ids.includes('setup-' + m[1]), 'setup step ' + m[1] + ' has an article');
const text = JSON.stringify(G);
assert.ok(!/\b(Sir|Ma'am|Mr|Mrs|Ms|Dr)\b/.test(text), 'no honorifics (no people in the guide)');
assert.ok(!/@[\w-]+\.|\b\d{10}\b/.test(text), 'no emails or phone numbers');
assert.ok(!/!/.test(text), "Buddy's voice: no exclamation marks");
assert.ok(!/Day Book starting data/i.test(text), 'Day Book starting data is not live on this branch');

console.log('test-dock: ok');
