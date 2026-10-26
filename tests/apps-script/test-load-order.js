// Every Apps Script project loads, whatever order its files run in.
// Apps Script runs each file's top-level code one file at a time, in the project's file order (alphabetical after a clasp
// push), all in one global scope. A top-level `const X = Y...` where Y lives in another file throws a ReferenceError when the
// other file comes later, and that takes the whole web app down (Roster v49, 2026-10-26: transport-capture.gs read
// transport-uploads.gs's TUP_PATH_). This loads each project's files the way the runtime does, in alphabetical order and in
// reverse, so top-level code that depends on another file fails here instead of in production.
// Usage: node tests/apps-script/test-load-order.js
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '../..');
const here = path.join(root, 'apps-script');
const projects = JSON.parse(fs.readFileSync(path.join(here, 'projects.json'), 'utf8'));

// Apps Script's built-in services: any property or call on them returns another stub, so top-level code that only
// touches the runtime (Script Properties, a cache handle) loads; a name the project itself never defines still throws.
function stub() {
  const f = function () { return stub(); };
  return new Proxy(f, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : stub()), apply: () => stub(), construct: () => stub() });
}
const SERVICES = ['SpreadsheetApp', 'DriveApp', 'PropertiesService', 'CacheService', 'LockService', 'Utilities', 'Logger', 'UrlFetchApp',
  'ContentService', 'HtmlService', 'ScriptApp', 'Session', 'MailApp', 'GmailApp', 'CalendarApp', 'DocumentApp', 'FormApp', 'Drive',
  'Calendar', 'Sheets', 'AdminDirectory', 'console', 'BigQuery', 'XmlService', 'Charts', 'SitesApp', 'SlidesApp', 'Maps', 'Gmail', 'People'];

const pushedAs = (f) => (f.includes('/') ? path.basename(f).replace(/\.js$/, '') : f);
const sourceOf = (f) => (f.includes('/') ? path.join(here, f) : path.join(here, f + '.gs'));

function load(name, files) {
  const ctx = { Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, TypeError, Map, Set, Promise, Symbol, parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent };
  SERVICES.forEach((s) => { ctx[s] = stub(); });
  vm.createContext(ctx);
  for (const f of files) {
    try { vm.runInContext(fs.readFileSync(sourceOf(f), 'utf8'), ctx, { filename: pushedAs(f) + '.gs' }); }
    catch (e) { return pushedAs(f) + '.gs: ' + e.message; }
  }
  return null;
}

const failures = [];
let checked = 0;
for (const [name, p] of Object.entries(projects)) {
  if (!p || !Array.isArray(p.files)) continue;
  const alpha = p.files.slice().sort((a, b) => (pushedAs(a) < pushedAs(b) ? -1 : pushedAs(a) > pushedAs(b) ? 1 : 0));
  for (const [order, files] of [['alphabetical', alpha], ['reverse', alpha.slice().reverse()]]) {
    const err = load(name, files);
    if (err) failures.push(name + ' (' + order + ' order): ' + err);
  }
  checked++;
}
assert.ok(checked > 0, 'no Apps Script projects found in projects.json');
assert.deepStrictEqual(failures, [], 'top-level code that depends on another file (it breaks the web app at load):\n  ' + failures.join('\n  '));
console.log('apps-script load order: ' + checked + ' projects load in alphabetical and reverse order');
