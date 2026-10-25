// Run: node tests/hiring/test-owner-page.js -- owner/index.html escapes the session's name and campus in the welcome strip.
const vm = require('vm'), fs = require('fs'), assert = require('assert'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '../../owner/index.html'), 'utf8');
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).pop();
const els = {};
const el = (id) => els[id] || (els[id] = { id, style: {}, innerHTML: '', addEventListener() {} });
const session = { name: '<img src=x onerror=alert(1)>', campusName: '"><b>All</b>', role: 'Owner', campusId: 'ALL' };
vm.runInContext(inline, vm.createContext({
  document: { getElementById: el },
  LMCS: { getSession: () => session, canViewOwnerPortal: () => true, signOut() {} },
  LMCSAppts: { mount() {} },
  LMCSGame: { mount() {} },
}));
const strip = els['welcome-strip'].innerHTML;
assert.ok(!/<img/.test(strip) && /&lt;img src=x onerror=alert\(1\)&gt;/.test(strip), 'name escaped');
assert.ok(!/<b>All<\/b>/.test(strip) && /&quot;&gt;&lt;b&gt;All&lt;\/b&gt;/.test(strip), 'campus escaped');
console.log('ok  - owner page escapes session.name and session.campusName');
