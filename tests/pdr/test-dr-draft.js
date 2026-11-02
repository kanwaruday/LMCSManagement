// P33 (2 Nov): the daily report draft on the device. The draft block from principals-daily-reporting/index.html runs under node with a
// tiny fake page: every edit saves per person + school + date; a reload after an expired sign-in restores it; only a confirmed submit,
// Discard or Sign out clears it. Fake data only. Usage: node tests/pdr/test-dr-draft.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const root = path.join(__dirname, '..', '..'), page = fs.readFileSync(path.join(root, 'principals-daily-reporting/index.html'), 'utf8');
const block = page.slice(page.indexOf('// ── The report draft on this device'), page.indexOf('function listToArray(listId) {'));
assert.ok(block.length > 500, 'draft block found');

function el(id) {
  const e = { id, value: '', checked: false, hidden: true, children: [], style: {}, listeners: {}, parentNode: null,
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }, setAttribute() {},
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; }, insertBefore(c) { this.children.push(c); c.parentNode = this; return c; } };
  Object.defineProperty(e, 'innerHTML', { set(v) { if (v === '') e.children = []; }, get() { return ''; } });
  Object.defineProperty(e, 'textContent', { set(v) { if (v === '') e.children = []; e._t = v; }, get() { return e._t || ''; } });
  return e;
}
const els = {}, get = (id) => (els[id] = els[id] || el(id));
['reportDate', 'maNone', 'maClass', 'maScore', 'tasksCompletedList', 'tasksTomorrowList', 'importantMsgList', 'tasksCompletedInput', 'tasksTomorrowInput', 'importantMsgInput', 'panel-principal', 'dayHolidayNotice'].forEach(get);
get('panel-principal').appendChild(get('dayHolidayNotice'));
const store = {};
const ctx = {
  console, JSON, Date, Number, Object, Array, String, setTimeout: (fn) => fn(), clearTimeout() {}, confirm: () => true,
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  document: { getElementById: (id) => els[id] || null, createElement: () => el(''), createTextNode: (t) => ({ t }) },
  window: {}, SESSION: { email: 'P4@Example.org' }, principalCampusId: 'LMS4', selectedRegisters: ['Teachers TRR'],
  todayISO: () => '2026-11-02', syncMaNone() {}, renderMultiselectOptions() {}, renderMsTags() {}, loadReportForDate() { ctx.reloaded = true; },
  listToArray: (id) => get(id).children.map((c) => c.t),
  addItemDirect: (id, t) => { get(id).children.push({ t }); },
};
vm.createContext(ctx);
vm.runInContext(block + '\nthis.draftSave_ = draftSave_; this.draftRestore_ = draftRestore_; this.draftClear_ = draftClear_; this.setLoading = function (v) { draftLoading = v; };', ctx);
get('reportDate').value = '2026-11-02';
const KEY = 'lmcsDraft:pdr:p4@example.org:LMS4:2026-11-02';

// typing saves (the panel's input listener), keyed by person + school + date
get('maScore').value = '8'; get('maClass').value = 'Class 7';
ctx.addItemDirect('tasksCompletedList', 'Checked registers'); ctx.addItemDirect('tasksTomorrowList', 'Staff meeting');
get('importantMsgInput').value = 'half-typed message';
get('panel-principal').listeners.input[0]({ target: get('maScore') });
const saved = JSON.parse(store[KEY]);
assert.deepStrictEqual([saved.maScore, saved.tasksCompleted.join(), saved.tasksTomorrow.join(), saved.typed.importantMsgInput], ['8', 'Checked registers', 'Staff meeting', 'half-typed message']);
// the date field itself is not an edit, and nothing saves while the server prefill runs
ctx.setLoading(true); get('maScore').value = '1'; get('panel-principal').listeners.input[0]({ target: get('maScore') }); ctx.setLoading(false);
assert.strictEqual(JSON.parse(store[KEY]).maScore, '8', 'a prefill never overwrites the device copy');

// the sign-in expired: the page reloads and the form comes back empty from the server; the copy is restored over it
['tasksCompletedList', 'tasksTomorrowList', 'importantMsgList'].forEach((id) => { get(id).children = []; });
get('maScore').value = ''; get('importantMsgInput').value = '';
ctx.draftRestore_();
assert.deepStrictEqual([get('maScore').value, ctx.listToArray('tasksCompletedList').join(), ctx.listToArray('tasksTomorrowList').join(), get('importantMsgInput').value], ['8', 'Checked registers', 'Staff meeting', 'half-typed message']);
const note = get('panel-principal').children.find((c) => c.id === 'draftRestoredNotice');
assert.ok(note && !note.hidden && /NOT submitted yet/.test(note.children[0].t), 'a note says it is not submitted');

// another person, school or date never sees it
ctx.SESSION = { email: 'other@example.org' }; vm.runInContext('SESSION = this.SESSION', ctx);
get('maScore').value = ''; ctx.draftRestore_(); assert.strictEqual(get('maScore').value, '', 'other person: nothing restored');
ctx.SESSION = { email: 'P4@Example.org' }; vm.runInContext('SESSION = this.SESSION', ctx);

// Discard clears it and reloads the form; a confirmed submit clears that date's copy
note.children[1].onclick(); assert.ok(!(KEY in store) && ctx.reloaded, 'Discard: cleared and reloaded');
store[KEY] = '{"maScore":"5"}'; ctx.draftClear_('2026-11-02'); assert.ok(!(KEY in store));

// wiring in the page and in auth.js
assert.ok(/if \(result && result\.success\) \{\n\s+draftClear_\(payload\.date\);/.test(page), 'only a confirmed submit clears it');
assert.ok(/draftLoading = true;[^]*?renderMsTags\(\);\n\s+draftRestore_\(\);/.test(page.slice(page.indexOf('async function loadReportForDate'))), 'restored after the server prefill');
const auth = fs.readFileSync(path.join(root, 'assets/auth.js'), 'utf8');
const signOut = auth.slice(auth.indexOf('function signOut()'), auth.indexOf('function campusLabel'));
assert.ok(/lmcsDraft:/.test(signOut), 'Sign out clears drafts');
assert.ok(!/lmcsDraft:/.test(auth.replace(signOut, '')), 'an expired sign-in (anything else in auth.js) never clears them');
console.log('test-dr-draft: ok');
