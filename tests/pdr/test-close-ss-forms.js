// closeSsForms() in ss-forms-sync.gs: closes exactly the 21 SS Google Forms listSsFormsToClose() lists, skips ones already closed, refuses if the list is not 21,
// logs counts only, and removes the daily sync timer only when every form is closed. Fake Forms; nothing real is touched. Usage: node tests/pdr/test-close-ss-forms.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '../../apps-script/ss-forms-sync.gs'), 'utf8');

function boot({ open = null, failOn = null } = {}) {
  const forms = {}, logs = [], timers = [{ h: 'syncAllSSForms' }, { h: 'otherJob' }], touched = [];
  const stub = () => new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : stub()), apply: () => stub(), construct: () => stub() });
  const sb = {
    Logger: { log: (m) => logs.push(String(m)) },
    FormApp: { openById: (id) => {
      touched.push(id);
      if (id === failOn) throw new Error('no access');
      const f = forms[id] || (forms[id] = { accepting: open ? open.includes(id) : true, sets: [] });
      return { isAcceptingResponses: () => f.accepting, setAcceptingResponses: (v) => { f.accepting = v; f.sets.push(v); }, getEditUrl: () => 'https://x/' + id, getItems: () => [] };
    } },
    ScriptApp: { getProjectTriggers: () => timers.map((t) => ({ getHandlerFunction: () => t.h, _t: t })), deleteTrigger: (t) => timers.splice(timers.indexOf(t._t), 1) },
  };
  ['SpreadsheetApp', 'DriveApp', 'PropertiesService', 'CacheService', 'LockService', 'Utilities', 'UrlFetchApp', 'ContentService', 'MailApp', 'Session'].forEach((n) => { sb[n] = stub(); });
  const ctx = vm.createContext(sb);
  vm.runInContext(src, ctx, { filename: 'ss-forms-sync.gs' });
  return { ctx, forms, logs, timers, touched, run: (code) => vm.runInContext(code, ctx) };
}

// 1. the list is 21 forms, ids all distinct, and it is what the config holds
{
  const b = boot(), t = b.run('ssFormTargets_()');
  assert.strictEqual(t.length, 21); assert.strictEqual(new Set(t.map((x) => x.id)).size, 21);
  assert.ok(t.every((x) => /^[\w-]{20,}$/.test(x.id)));
}
// 2. closes exactly those 21, once each, then removes only the sync timer
{
  const b = boot(), ids = new Set(b.run('ssFormTargets_()').map((x) => x.id));
  b.run('closeSsForms()');
  assert.deepStrictEqual(new Set(Object.keys(b.forms)), ids);                                          // nothing but the 21 was opened
  assert.ok(Object.values(b.forms).every((f) => f.accepting === false && f.sets.length === 1 && f.sets[0] === false));
  assert.deepStrictEqual(b.timers.map((t) => t.h), ['otherJob']);                                      // the sync timer is gone, another job is left alone
  assert.ok(b.logs.some((l) => l === 'closeSsForms: closed=21 already_closed=0 failed=0 of 21'));
  assert.ok(b.logs.every((l) => !/https?:|\/forms\//.test(l)));                                         // no link, no title
}
// 3. safe to re-run: closed forms are skipped, not set again
{
  const b = boot(), ids = b.run('ssFormTargets_()').map((x) => x.id), stillOpen = ids.slice(0, 5);
  const b2 = boot({ open: stillOpen });
  b2.run('closeSsForms()');
  assert.strictEqual(Object.values(b2.forms).filter((f) => f.sets.length).length, 5);
  assert.ok(b2.logs.includes('closeSsForms: closed=5 already_closed=16 failed=0 of 21'));
  b2.run('closeSsForms()');                                                                             // again: nothing left to close, timer already gone, no error
  assert.ok(b2.logs.includes('closeSsForms: closed=0 already_closed=21 failed=0 of 21'));
}
// 4. refuses when the list is not 21 (a form removed or added), and touches no form
for (const change of ['delete SS_ROLE_CONFIGS.teacher.forms["LMS 6"]', 'SS_ROLE_CONFIGS.pti.forms.extra = "formX"']) {
  const b = boot(); b.run(change);
  assert.throws(() => b.run('closeSsForms()'), /ss_forms_not_21/);
  assert.strictEqual(b.touched.length, 0); assert.strictEqual(b.timers.length, 2);
}
// 5. one form that cannot be closed: the rest are closed, the run stops with a code, the timer stays; a re-run can finish
{
  const probe = boot(), bad = probe.run('ssFormTargets_()')[3].id, b = boot({ failOn: bad });
  assert.throws(() => b.run('closeSsForms()'), /ss_forms_close_failed/);
  assert.ok(b.logs.includes('closeSsForms: closed=20 already_closed=0 failed=1 of 21'));
  assert.strictEqual(b.timers.length, 2);
  assert.ok(b.logs.every((l) => !l.includes(bad)));
}
// 6. the list command reads the same list
{
  const b = boot(); b.run('listSsFormsToClose()');
  assert.strictEqual(b.logs.length, 21); assert.strictEqual(Object.keys(b.forms).length, 21);
  assert.ok(Object.values(b.forms).every((f) => f.sets.length === 0));                                   // read-only
}
console.log('close-ss-forms: all passed');
