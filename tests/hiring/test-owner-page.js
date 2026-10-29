// Run: node tests/hiring/test-owner-page.js -- owner/index.html puts the session's name in as text, never as markup.
const vm = require('vm'), fs = require('fs'), assert = require('assert'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '../../owner/index.html'), 'utf8');
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).pop();
const els = {}, made = [];
const node = (tag) => { const n = { tag, style: {}, textContent: '', className: '', children: [], appendChild(c) { this.children.push(c); return c; }, addEventListener() {}, setAttribute() {} };
  Object.defineProperty(n, 'innerHTML', { set(v) { made.push(String(v)); }, get() { return ''; } }); return n; };
const el = (id) => els[id] || (els[id] = node('#' + id));
const session = { name: '<img src=x onerror=alert(1)>', campusName: '"><b>All</b>', role: 'Owner', campusId: 'ALL' };
vm.runInContext(inline, vm.createContext({
  document: { getElementById: el, createElement: node, createTextNode: (t) => ({ text: String(t) }) },
  fetch: () => new Promise(() => {}), // HQ Home's gamekingdom read: left pending (the tiles show as links first)
  LMCS: { getSession: () => session, canViewOwnerPortal: () => true, signOut() {} },
  LMCSAppts: { mount() {} },
  LMCSRail: { mount() {} },
  LMCSKingdom: { hooks: {}, mount: () => new Promise(() => {}), last: () => null }, // the off-screen Kingdom: its read left pending
  LMCSMapHome: { setKingdom() {}, setIcon() {} },
  window: {},
}));
assert.ok(els['hub-hello'].textContent.includes('<img'), 'the name goes in as text');
assert.ok(!made.some((h) => /<img|<b>All/.test(h)), 'no session value is written as markup');
assert.strictEqual(els['modules-grid'].children.length, 6, 'the six Owner tools render as rows');
assert.strictEqual(els['hq-tiles'].children.length, 4, 'HQ Home: four tiles before the read answers');
console.log('ok  - owner page puts session.name in as text');
