// Run: node tests/hiring/test-owner-page.js -- owner/index.html puts the session's name in as text, never as markup.
const vm = require('vm'), fs = require('fs'), assert = require('assert'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '../../owner/index.html'), 'utf8');
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).pop();
const els = {}, made = [];
const node = (tag) => { const n = { tag, style: {}, textContent: '', className: '', children: [], appendChild(c) { this.children.push(c); return c; }, addEventListener() {} };
  Object.defineProperty(n, 'innerHTML', { set(v) { made.push(String(v)); }, get() { return ''; } }); return n; };
const el = (id) => els[id] || (els[id] = node('#' + id));
const session = { name: '<img src=x onerror=alert(1)>', campusName: '"><b>All</b>', role: 'Owner', campusId: 'ALL' };
vm.runInContext(inline, vm.createContext({
  document: { getElementById: el, createElement: node },
  LMCS: { getSession: () => session, canViewOwnerPortal: () => true, signOut() {} },
  LMCSAppts: { mount() {} },
  LMCSRail: { mount() {} },
}));
assert.ok(els['hub-hello'].textContent.includes('<img'), 'the name goes in as text');
assert.ok(!made.some((h) => /<img|<b>All/.test(h)), 'no session value is written as markup');
assert.strictEqual(els['modules-grid'].children.length, 5, 'the five Owner tools render as rows');
console.log('ok  - owner page puts session.name in as text');
