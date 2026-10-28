// Every portal page shows its data-source links (or is deliberately exempt), and the shared strip behaves.
// Usage: node tests/datasrc/test-datasrc.js
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '../..');
const src = fs.readFileSync(path.join(root, 'assets/datasrc.js'), 'utf8');

// The real auth.js, so the visibility rule under test is the shipped one, not a stub.
const authCtx = vm.createContext({
  localStorage: { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 }, URL, Response, console, setTimeout: () => 0, clearTimeout() {},
  atob: (x) => Buffer.from(x, 'base64').toString('binary'), navigator: {}, performance: { getEntriesByType: () => [] }, location: { href: 'https://portal.test/' },
  document: { readyState: 'loading', hidden: false, body: null, addEventListener() {}, getElementById: () => null }, fetch: async () => new Response('{}'),
});
authCtx.window = authCtx; authCtx.addEventListener = () => {};
vm.runInContext(fs.readFileSync(path.join(root, 'assets/auth.js'), 'utf8'), authCtx);
const realLMCS = authCtx.window.LMCS;
for (const [role, expected] of [['Owner', true], ['Coordinator', true], ['Coordinator,Teacher', true], ['Owner,Teacher', true], ['Principal', false], ['Teacher', false], ['', false]]) {
  assert.strictEqual(realLMCS.canViewDataSources({ role, campusId: 'LMS1' }), expected, 'canViewDataSources(' + role + ')');
}
assert.strictEqual(realLMCS.canViewDataSources(null), false);

// ── 1. coverage: every page is covered, has its own strip, or is exempt on purpose ──────────
const OFFICE_REASON = 'Office portal: data sits behind the Office backend; sheet IDs live in Script Properties and never appear in page source';
const NO_SOURCES = {
  'index.html': 'role chooser, public, no data',
  'owner/index.html': 'Owner home: appointment box only (PDR data, whose sources are linked on hiring/); Owner Part A adds a strip',
  'lm-monitor/dashboard.html': 'local LM Studio monitor, not part of the portal data',
  'lmcs-last-2-months.html': 'static summary page',
  'curriculum-progress/course-mapping-admin.html': 'Admin Panel: an "↗ Open" link sits beside every sheet ID it configures (each school, Daily, Allocation)',
  'office/accounts.html': OFFICE_REASON,
  'office/close.html': OFFICE_REASON,
  'office/daybook.html': OFFICE_REASON,
  'office/deposits.html': OFFICE_REASON,
  'office/hiring.html': OFFICE_REASON,
  'office/index.html': OFFICE_REASON,
  'office/report.html': OFFICE_REASON,
  'office/transport.html': OFFICE_REASON,
  'office/buses.html': OFFICE_REASON,
  'office/starting-data.html': OFFICE_REASON,
  'coordinator/transport/live.html': 'live GPS positions from the vendor through the Coordinator backend; no sheet behind it, and the vendor id stays out of page source',
  'docs/mockups/transport-visual/template.html': 'design mock-up with no data in it (data is injected locally, never committed)',
  'owner/kingdom.html': 'the Kingdom: game backend reads only (gamekingdom), no sheet links',
  'owner/transport/index.html': 'GPS checks through the Coordinator backend (same data as coordinator/transport/live.html); the vendor id stays out of page source',
  'teacher/plan-activity.html': 'one-line write to the Game backend; shows no sheet data',
  'guide/index.html': 'the user guide: feature help from assets/game/guide.js, no data',
  'setup/index.html': 'setup quests: confirm-values screens backed by the game backend (setupget/setupsave), no source sheet links',
  'driver/index.html': 'driver portal: a demo, or the driver\'s own bus through the Roster web app (driverme) once the office links the phone; the fuel record is not decided yet',
  'coordinator/transport/drivers.html': 'driver phone links: lists and creates links through the Roster web app (apps-script/driver-link.gs); it shows no sheet data and never stores the link token',
  'coordinator/transport/capture.html': 'phone capture page: writes photos and run rows through the Roster web app (apps-script/transport-capture.gs); it shows no sheet data',
};
function pages(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.claude', '.git', 'graphify-out', 'drive-index', 'tests', 'node_modules', 'web', 'ai-coordinator', 'vendor', 'transport'].includes(e.name) && dir === root) continue;
    if (e.name === 'node_modules' || e.name.startsWith('_') || e.name === 'vendor') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) pages(p, out); else if (e.name.endsWith('.html')) out.push(path.relative(root, p));
  }
  return out;
}
const env0 = vm.createContext({ window: {}, document: { readyState: 'complete', addEventListener() {}, getElementById: () => null, querySelector: () => null, head: { appendChild() {} }, body: { insertBefore() {} } }, location: { pathname: '/x/' }, console });
env0.window = env0; env0.LMCS = { getSession: () => null, hasRole: () => false };
vm.runInContext(src, env0);
const { SRC, PAGES } = env0.window.LMCS_DATASRC;

const uncovered = [];
for (const rel of pages(root)) {
  const html = fs.readFileSync(path.join(root, rel), 'utf8');
  const folder = '/' + rel.replace(/index\.html$/, '');
  const own = /class="datasrc-links"/.test(html);
  const registered = Object.keys(PAGES).some((k) => folder === k || folder.endsWith(k));
  if (!own && !registered && !(rel in NO_SOURCES)) uncovered.push(rel);
  if (own && !/canViewDataSources\(/.test(html)) uncovered.push(rel + ' (draws its own strip but does not use LMCS.canViewDataSources -- it would drift from the shared rule)');
  if (own && registered) uncovered.push(rel + ' (has its own strip AND an entry in datasrc.js -- remove one)');
}
assert.deepStrictEqual(uncovered, [], 'pages with no data-source links:\n  ' + uncovered.join('\n  '));
for (const rel of Object.keys(NO_SOURCES)) assert.ok(fs.existsSync(path.join(root, rel)), 'stale exemption ' + rel);

// ── 2. every configured source is a well-formed link ────────────────────────────────────────
for (const [key, [label, url]] of Object.entries(SRC)) {
  assert.ok(label && /^https:\/\//.test(url), key + ' malformed');
  if (url.includes('docs.google.com/spreadsheets/d/')) assert.ok(/\/d\/[A-Za-z0-9_-]{30,}\/edit/.test(url), key + ' sheet id looks wrong');
}
for (const [page, keys] of Object.entries(PAGES)) {
  assert.ok(keys.length, page + ' is empty');
  keys.forEach((k) => assert.ok(SRC[k], page + ' uses unknown source ' + k));
  assert.strictEqual(new Set(keys).size, keys.length, page + ' lists a source twice');
}
// the ids must be ones the backend really reads
const gs = fs.readdirSync(path.join(root, 'apps-script')).filter((f) => f.endsWith('.gs')).map((f) => fs.readFileSync(path.join(root, 'apps-script', f), 'utf8')).join('\n')
  + fs.readFileSync(path.join(root, 'principals-daily-reporting/index.html'), 'utf8') + fs.readFileSync(path.join(root, 'curriculum-progress/daily-progress.html'), 'utf8');
for (const [key, [, url]] of Object.entries(SRC)) {
  const m = url.match(/\/d\/([A-Za-z0-9_-]+)\/edit/);
  if (m) assert.ok(gs.includes(m[1]), key + ': sheet id not found anywhere in the backend/page source (typo?)');
}

// ── 3. behaviour in a fake DOM ──────────────────────────────────────────────────────────────
function node(tag, id) {
  const n = { tag, id: id || '', className: '', innerHTML: '', textContent: '', parentNode: null, children: [], nextSibling: null };
  n.insertBefore = (child, ref) => {
    if (child.parentNode) child.parentNode.children = child.parentNode.children.filter((c) => c !== child);
    const i = ref ? n.children.indexOf(ref) : n.children.length;
    n.children.splice(i < 0 ? n.children.length : i, 0, child); child.parentNode = n;
    n.children.forEach((c, j) => { c.nextSibling = n.children[j + 1] || null; });
    return child;
  };
  n.appendChild = (c) => n.insertBefore(c, null);
  n.removeChild = (c) => { n.children = n.children.filter((x) => x !== c); c.parentNode = null; };
  Object.defineProperty(n, 'firstChild', { get: () => n.children[0] || null });
  return n;
}
function run(pathname, session, { own = false, home = false } = {}) {
  const body = node('body'), head = node('head'), hdr = node('div'); hdr.className = 'hdr';
  body.appendChild(hdr);
  let app = null;
  if (home) { app = node('div', 'app-root'); body.appendChild(app); }
  const all = () => { const out = []; (function w(n) { out.push(n); n.children.forEach(w); })(body); (function w(n) { out.push(n); n.children.forEach(w); })(head); return out; };
  const doc = {
    readyState: 'complete', addEventListener() {}, body, head,
    createElement: (t) => node(t),
    getElementById: (id) => all().find((n) => n.id === id) || null,
    querySelector: (sel) => {
      if (sel === '.datasrc-links') return own ? node('div') : null;
      if (sel === '.hdr, header.site') return hdr;
      return null;
    },
  };
  const ctx = vm.createContext({ document: doc, location: { pathname: pathname }, console });
  ctx.window = ctx;
  ctx.LMCS = { getSession: () => session, hasRole: realLMCS.hasRole, canViewDataSources: realLMCS.canViewDataSources };
  vm.runInContext(src, ctx);
  return { strip: doc.getElementById('lmcs-datasrc'), hdr, body, app, ctx };
}
const owner = { role: 'Owner', campusId: 'ALL' };

let r = run('/LMCSManagement/coordinator/transport/', owner);
assert.ok(r.strip && /Transport responses sheet/.test(r.strip.innerHTML), 'Owner sees the strip');
assert.ok(/target="_blank" rel="noopener">Transport responses sheet ↗<\/a>/.test(r.strip.innerHTML), 'opens in a new tab, same ↗ style as the other pages');
assert.strictEqual(r.hdr.nextSibling, r.strip, 'sits directly under the header');
assert.ok(r.strip.innerHTML.startsWith('📄 '));

r = run('/LMCSManagement/coordinator/transport/index.html', owner);
assert.ok(r.strip, 'index.html in the URL works too');

assert.ok(run('/LMCSManagement/coordinator/transport/', { role: 'Coordinator', campusId: 'LMS2' }).strip, 'Coordinators see it too');
assert.ok(run('/LMCSManagement/teacher/', { role: 'Coordinator,Teacher', campusId: 'LMS2' }).strip, 'a Coordinator who is also a Teacher');
assert.strictEqual(run('/LMCSManagement/coordinator/transport/', { role: 'Principal', campusId: 'LMS2' }).strip, null, 'Principals do not');
assert.strictEqual(run('/LMCSManagement/teacher/', { role: 'Teacher', campusId: 'LMS2' }).strip, null, 'Teachers do not');
assert.strictEqual(run('/LMCSManagement/coordinator/transport/', null).strip, null, 'signed out: nothing');
assert.strictEqual(run('/LMCSManagement/coordinator/transport/', owner, { own: true }).strip, null, 'a page that draws its own strip is left alone');
assert.strictEqual(run('/LMCSManagement/hiring/', owner).strip, null, 'unlisted page: nothing');

// the landing page and a section page are different entries
assert.ok(/Fee Defaulter/.test(run('/LMCSManagement/coordinator/systems/', owner).strip.innerHTML));
assert.ok(!/Fee Defaulter/.test(run('/LMCSManagement/coordinator/', owner).strip.innerHTML), '/coordinator/ must not match /coordinator/systems/');

// home screens: inside the centred wrapper, not floating full-width
r = run('/LMCSManagement/principal/', owner, { home: true });
assert.strictEqual(r.strip.parentNode, r.app);
assert.strictEqual(r.strip.className, 'inset');
// re-render after a no-reload sign-in replaces rather than duplicates
r.ctx.LMCS_renderDataSources();
assert.strictEqual(r.app.children.filter((c) => c.id === 'lmcs-datasrc').length, 1);

console.log('datasrc: all checks passed (' + Object.keys(PAGES).length + ' pages registered)');
