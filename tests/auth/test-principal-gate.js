// The Principal portal gate (assets/auth.js canViewPrincipalPortal + showNotForRole) and its use on every principal/* page.
// Uday, 30 Oct: a Fee Clerk "should not be able to login to the Principal/ coordinator/ owner portals, only itself and below".
// Usage: node tests/auth/test-principal-gate.js
const vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');
const root = path.join(__dirname, '../..'), src = fs.readFileSync(path.join(root, 'assets/auth.js'), 'utf8');
const mk = (tag) => { let text = ''; return { tag, children: [], attrs: {}, style: {}, get textContent() { return text; }, set textContent(v) { text = v; this.children = []; }, // like the DOM: setting text clears the children
  setAttribute(k, v) { this.attrs[k] = String(v); }, appendChild(c) { this.children.push(c); return c; } }; };
const box = mk('section');
const ctx = { localStorage: { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 }, console, setTimeout, clearTimeout, setInterval, clearInterval,
  location: { href: 'https://portal.test/' }, navigator: {}, URL, addEventListener() {},
  document: { readyState: 'loading', addEventListener() {}, querySelector: (s) => (s === '#auth-root' ? box : null), getElementById: () => null, createElement: mk, head: { appendChild() {} } } };
ctx.window = ctx; vm.createContext(ctx); vm.runInContext(src, ctx);
const L = ctx.window.LMCS, S = (role, campusId) => ({ email: 'x@example.org', role, campusId: campusId || 'LMS4' });

assert.deepStrictEqual(['Principal', 'Coordinator', 'Owner', 'Principal,Teacher'].map((r) => L.canViewPrincipalPortal(S(r))), [true, true, true, true]);
assert.deepStrictEqual(['FeeClerk', 'Teacher', 'Staff', 'Accounts', 'Driver', ''].map((r) => L.canViewPrincipalPortal(S(r))), [false, false, false, false, false, false]);
assert.strictEqual(L.canViewPrincipalPortal(S('FeeClerk', 'ALL')), false, 'an ALL-campus Fee Clerk is still a Fee Clerk');
assert.strictEqual(L.canViewPrincipalPortal(null), false);

L.showNotForRole('#auth-root', S('FeeClerk'), '../');
const card = box.children[0], link = card.children[2];
assert.strictEqual(card.children[0].textContent, "This portal isn't for your role");
assert.strictEqual(link.href, '../office/index.html', 'a Fee Clerk is sent to the Fee Clerk portal');
L.showNotForRole('#auth-root', S('Teacher'), '../');
assert.strictEqual(box.children.length, 1, 'redrawn, not stacked');
assert.strictEqual(box.children[0].children[2].href, '../teacher/index.html');

// every principal page runs the gate first thing in showApp, before any read
fs.readdirSync(path.join(root, 'principal')).filter((f) => f.endsWith('.html')).forEach((f) => {
  const html = fs.readFileSync(path.join(root, 'principal', f), 'utf8'), i = html.indexOf('function showApp(session) {');
  assert.ok(i !== -1, f + ' has showApp');
  assert.ok(/^\s*if \(!LMCS\.canViewPrincipalPortal\(session\)\) \{ LMCS\.showNotForRole\('#auth-root', session, '\.\.\/'\); return; \}/.test(html.slice(i + 27)), f + ' gates first');
});
console.log('test-principal-gate: ok');
