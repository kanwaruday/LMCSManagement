// Run: node tests/classic-host/test-host.js -- the classic host is one value (classic-base.gs), and the public pages carry no ids/emails of the school.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const root = path.join(__dirname, '../..');
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (['.git', 'node_modules', 'tests', 'docs', 'tools', 'audit', 'apps-script', 'graphify-out'].includes(e.name) && d === root) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else out.push(p); } return out; };

// classicBase_: Script property, https only, always one trailing slash, else the default
const run = (prop) => { const ctx = vm.createContext({ PropertiesService: { getScriptProperties: () => ({ getProperty: () => prop }) } }); vm.runInContext(fs.readFileSync(path.join(root, 'apps-script/classic-base.gs'), 'utf8'), ctx); return vm.runInContext('classicBase_()', ctx); };
assert.strictEqual(run(null), 'https://lmcs-classic.pages.dev/');
assert.strictEqual(run('https://classic.example.test'), 'https://classic.example.test/');
assert.strictEqual(run('https://classic.example.test///'), 'https://classic.example.test/');
assert.strictEqual(run('http://insecure.test/'), 'https://lmcs-classic.pages.dev/', 'http is refused');
assert.strictEqual(run('javascript:alert(1)'), 'https://lmcs-classic.pages.dev/');

// no literal host anywhere that a page or the backend reads (docs/tests excluded)
const gs = fs.readdirSync(path.join(root, 'apps-script')).map((f) => path.join(root, 'apps-script', f));
const bad = [...walk(root), ...gs].filter((f) => /\.(html|js|mjs|gs|json)$/.test(f) && /kanwaruday\.github\.io\/LMCSManagement/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(root, f));
assert.deepStrictEqual(bad, [], 'the old GitHub Pages host is written in: ' + bad.join(', '));

// no email, phone or spreadsheet id in a file the host serves
const served = walk(root).filter((f) => /\.(html|js|json|css)$/.test(f) && !/vendor\//.test(f));
const leaks = [];
for (const f of served) {
  const t = fs.readFileSync(f, 'utf8'), rel = path.relative(root, f);
  const emails = new Set(t.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g) || []);
  if (emails.size) leaks.push(rel + ': ' + emails.size + ' email(s)');
  if (/spreadsheets\/d\/[A-Za-z0-9_-]{20,}/.test(t)) leaks.push(rel + ': spreadsheet id');
  if (/(^|[^0-9])[6-9][0-9]{9}([^0-9]|$)/.test(t)) leaks.push(rel + ': phone-like number');
}
assert.deepStrictEqual(leaks, [], 'public files expose school data:\n  ' + leaks.join('\n  '));
console.log('classic-host: ok');
