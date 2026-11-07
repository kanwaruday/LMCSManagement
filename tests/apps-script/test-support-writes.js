// A supporting Principal's switched session (assets/auth.js adds actAs to every backend call) can write only where a backend
// handles actAs on purpose: PDR comments (tests/pdr/test-supporting.js). Every other backend refuses a write carrying actAs
// before anything runs: game, coordinator, roster, office, payroll. Each project is loaded whole (as tests/apps-script/
// test-load-order.js does) with services that record any use, so "before anything runs" means no service was touched.
// Usage: node tests/apps-script/test-support-writes.js
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const here = path.join(__dirname, '../../apps-script');
const projects = JSON.parse(fs.readFileSync(path.join(here, 'projects.json'), 'utf8'));
const sourceOf = (f) => (f.includes('/') ? path.join(here, f) : path.join(here, f + '.gs'));

function load(name) {
  const used = [];
  const stub = (label) => new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : stub(label)), apply: () => { used.push(label); return stub(label); }, construct: () => stub(label) });
  const ctx = { console: { log() {}, info() {}, warn() {}, error() {} }, JSON, Date, Math, Object, Array, String, Number, RegExp, Error };
  ['SpreadsheetApp', 'DriveApp', 'PropertiesService', 'CacheService', 'LockService', 'Utilities', 'Logger', 'UrlFetchApp', 'HtmlService', 'ScriptApp',
    'Session', 'MailApp', 'GmailApp', 'CalendarApp', 'DocumentApp', 'FormApp', 'Drive', 'Calendar', 'Sheets'].forEach((s) => { ctx[s] = stub(s); });
  ctx.ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType: () => ({ body: s }), body: s }) };
  vm.createContext(ctx);
  vm.runInContext(projects[name].files.map((f) => fs.readFileSync(sourceOf(f), 'utf8')).join('\n;\n'), ctx, { filename: name + '.gs' });
  used.length = 0; // whatever top-level code touched while loading doesn't count
  const out = (r) => JSON.parse(r.body !== undefined ? r.body : (r.getContent ? r.getContent() : JSON.stringify(r)));
  return {
    used,
    post: (body) => out(ctx.doPost({ postData: { contents: JSON.stringify(body) } })),
    get: (params) => out(ctx.doGet({ parameter: params })),
  };
}
const refused = (r, where) => { assert.strictEqual(r.success, false, where); assert.strictEqual(r.code, 'SUPPORT_READ_ONLY', where + ': ' + JSON.stringify(r)); };

// game: every POST with actAs, next to view-as's own refusal; GETs follow the switch through gameActAs_ instead
let p = load('game');
for (const action of ['roomssave', 'kingdomassign', 'missiondone', 'peoplesupport', 'scoutsave']) refused(p.post({ action, idToken: 't', actAs: 'LMS3' }), 'game ' + action);
assert.deepStrictEqual(p.used, [], 'game: refused before the token was even checked');

// coordinator: every POST, including the Principal's issue resolve
p = load('coordinator');
for (const action of ['principalissueresolve', 'coordinatorresolvetask', 'transportclerkcheck', 'coordinatortransportfleetsave', 'coordinatorallocate']) refused(p.post({ action, idToken: 't', actAs: 'LMS3' }), 'coordinator ' + action);
assert.deepStrictEqual(p.used, []);

// roster: its writes are GETs as well as POSTs; reads still answer (the allowlist read signs people in)
p = load('roster');
for (const action of ['addnewhire', 'starthire', 'joinhire', 'transfer', 'markinactive', 'reassigncertificate', 'autoresolvequeue', 'installjobrolesync', 'bumpincrement', 'savedocrules', 'allowlist_add', 'allowlist_edit', 'allowlist_delete', 'somethingnew']) {
  refused(p.get({ action, idToken: 't', actAs: 'LMS3' }), 'roster GET ' + action);
}
for (const action of ['uploaddocument', 'transportupload', 'driverfilldecide', 'driverlinkcreate']) refused(p.post({ action, idToken: 't', actAs: 'LMS3' }), 'roster POST ' + action);
assert.deepStrictEqual(p.used, []);
p.get({ action: 'allowlist_list', actAs: 'LMS3' });
assert.ok(p.used.length > 0, 'a read with actAs still runs');

// office and payroll: not Principal backends; anything with actAs is refused
for (const name of ['office', 'payroll']) {
  p = load(name);
  refused(p.post({ action: 'anything', idToken: 't', actAs: 'LMS3', data: {} }), name + ' POST');
  refused(p.get({ action: 'anything', idToken: 't', actAs: 'LMS3' }), name + ' GET');
  assert.deepStrictEqual(p.used, [], name);
}
// an empty actAs is no switch at all
p = load('payroll');
assert.notStrictEqual(p.post({ action: 'anything', idToken: 't', actAs: '' }).code, 'SUPPORT_READ_ONLY');
console.log('supporting charge, writes refused outside PDR comments: ok');
