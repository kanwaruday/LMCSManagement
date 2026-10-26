// Shared campus picker (assets/campus-picker.js) with a tiny fake DOM.
// Usage: node tests/auth/test-campus-picker.js
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '../../assets/campus-picker.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../../assets/campus-picker.css'), 'utf8');

function fakeEl(tag) {
  const e = {
    tagName: tag.toUpperCase(), children: [], attrs: {}, listeners: {}, textContent: '', className: '', hidden: false, style: { setProperty(k, v) { this[k] = v; } },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    click() { (this.listeners.click || []).forEach((fn) => fn({ currentTarget: this, target: this })); },
  };
  Object.defineProperty(e, 'innerHTML', { set(v) { if (v === '') this.children = []; }, get() { return ''; } });
  return e;
}
const NAMES = { LMS1: 'LMS 1 — Dhalpur', LMS2: 'LMS 2 — Kelheli', LMS3: 'LMS 3 — Dunkhra', LMS4: 'LMS 4 — Ner Chowk', LMS5: 'LMS 5 — Sayoli', LMS6: 'LMS 6 — Jogindernagar', HES: 'HES — Head Office' };
function load({ store = {}, blocked = false } = {}) {
  const localStorage = blocked
    ? { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } }
    : { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const ctx = { localStorage, console, document: { createElement: fakeEl, querySelector: () => null } };
  ctx.window = ctx;
  ctx.LMCS = { campusLabel: (c) => NAMES[c] || c, getSession: () => null };
  vm.createContext(ctx); vm.runInContext(src, ctx);
  return { C: ctx.LMCSCampus, store };
}
const S = (campusId, email = 'a@lms.org.in') => ({ email, campusId, roles: ['Coordinator'] });
const plain = (o) => JSON.parse(JSON.stringify(o));
const chips = (el) => el.children[0].children;
const chip = (el, code) => chips(el).find((b) => b.getAttribute('data-code') === code);
const pressed = (el) => chips(el).filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.getAttribute('data-code'));
const ALL6 = ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6'];

// --- scope: from the session only, canonical order, HES only for ALL + hes:true
{
  const { C } = load();
  assert.deepStrictEqual(plain(C.scope(S('ALL'))), ALL6);
  assert.deepStrictEqual(plain(C.scope(S('ALL'), { hes: true })), [...ALL6, 'HES']);
  assert.deepStrictEqual(plain(C.scope(S('LMS4, LMS1'), { hes: true })), ['LMS1', 'LMS4'], 'comma list, sorted, no HES');
  assert.deepStrictEqual(plain(C.scope(S('LMS3'))), ['LMS3']);
  assert.deepStrictEqual(plain(C.scope(S('HES'), { hes: true })), ['HES'], 'HES session on a hes page');
  assert.deepStrictEqual(plain(C.scope(S('HES'))), [], 'HES session without hes: nothing');
  assert.deepStrictEqual(plain(C.scope(S('LMS2,HES'), { hes: true })), ['LMS2', 'HES'], 'comma list with HES');
  assert.deepStrictEqual(plain(C.scope(S('LMS2,HES'))), ['LMS2'], 'comma list, HES only with hes');
  const h = fakeEl('div');
  C.mount(h, { session: S('HES') });
  assert.strictEqual(h.hidden, true, 'HES session without hes: picker hidden');
  assert.deepStrictEqual(plain(C.scope(S('LMS9,<b>'))), [], 'unknown codes never enter scope');
  assert.deepStrictEqual(plain(C.scope(null)), []);
}

// --- order, labels, a11y markup
{
  const { C } = load();
  const el = fakeEl('div');
  C.mount(el, { session: S('ALL'), hes: true, label: 'School' });
  const g = el.children[0];
  assert.strictEqual(g.getAttribute('role'), 'group');
  assert.strictEqual(g.getAttribute('aria-label'), 'School');
  assert.deepStrictEqual(chips(el).map((b) => b.textContent), ['All campuses', 'LMS 1', 'LMS 2', 'LMS 3', 'LMS 4', 'LMS 5', 'LMS 6', 'HES']);
  assert.ok(chips(el).every((b) => b.tagName === 'BUTTON' && b.getAttribute('type') === 'button' && b.getAttribute('aria-pressed') !== null));
  assert.strictEqual(chip(el, 'LMS2').getAttribute('aria-label'), 'LMS 2 — Kelheli');
  assert.strictEqual(chip(el, 'LMS2').getAttribute('title'), 'LMS 2 — Kelheli');
  assert.strictEqual(chip(el, 'HES').getAttribute('aria-label'), 'HES — Head Office');
  assert.strictEqual(el.hidden, false);
}

// --- multi-select: All -> pick clears All -> add -> clear last returns to All; onChange once on mount and per change
{
  const { C, store } = load();
  const el = fakeEl('div'), seen = [];
  const p = C.mount(el, { session: S('ALL'), onChange: (s) => seen.push(plain(s)) });
  assert.deepStrictEqual(seen, [{ all: true, campuses: ALL6 }], 'onChange fires once on mount with All');
  assert.deepStrictEqual(pressed(el), ['ALL']);
  chip(el, 'LMS3').click();
  assert.deepStrictEqual(plain(p.get()), { all: false, campuses: ['LMS3'] });
  assert.deepStrictEqual(pressed(el), ['LMS3']);
  chip(el, 'LMS1').click();
  assert.deepStrictEqual(plain(p.get()), { all: false, campuses: ['LMS1', 'LMS3'] }, 'canonical order');
  assert.deepStrictEqual(JSON.parse(store['lmcs-campus:a@lms.org.in']), { v: 1, sel: ['LMS1', 'LMS3'] }, 'persistence key + shape');
  chip(el, 'LMS1').click(); chip(el, 'LMS3').click();
  assert.deepStrictEqual(plain(p.get()), { all: true, campuses: ALL6 }, 'clearing the last chip returns to All');
  assert.deepStrictEqual(JSON.parse(store['lmcs-campus:a@lms.org.in']), { v: 1, sel: 'ALL' });
  chip(el, 'LMS5').click(); chip(el, 'ALL').click();
  assert.deepStrictEqual(plain(p.get()), { all: true, campuses: ALL6 });
  assert.strictEqual(seen.length, 7, 'one onChange per change');
  p.set(['LMS6', 'LMS2']);
  assert.deepStrictEqual(plain(seen[seen.length - 1]), { all: false, campuses: ['LMS2', 'LMS6'] });
  let raw; const q = C.mount(fakeEl('div'), { session: S('ALL', 'q@lms.org.in'), onChange: (x) => { raw = x; } });
  raw.campuses.push('HES'); raw.all = false;
  assert.deepStrictEqual(plain(q.get()), { all: true, campuses: ALL6 }, 'onChange hands out a copy');
  const n = seen.length; p.set(['LMS2', 'LMS6']);
  p.get().campuses.push('LMS1'); seen[seen.length - 1].campuses.push('LMS1');
  assert.deepStrictEqual(plain(p.get()), { all: false, campuses: ['LMS2', 'LMS6'] }, 'returned sel is a copy');
  assert.strictEqual(seen.length, n, 'set() to the same selection does not fire');
}

// --- restore remembered choice; one shared choice across multi pages
{
  const { C } = load({ store: { 'lmcs-campus:a@lms.org.in': JSON.stringify({ v: 1, sel: ['LMS4', 'LMS2'] }) } });
  assert.deepStrictEqual(plain(C.get(S('ALL'))), { all: false, campuses: ['LMS2', 'LMS4'] });
  const el = fakeEl('div');
  C.mount(el, { session: S('ALL') });
  assert.deepStrictEqual(pressed(el), ['LMS2', 'LMS4']);
  assert.deepStrictEqual(plain(C.get(S('ALL', 'b@lms.org.in'))).all, true, 'per-person key');
}

// --- Review Focus 1: scope leak. Stale stored value + page-passed list never widen scope
{
  const store = { 'lmcs-campus:p@lms.org.in': JSON.stringify({ v: 1, sel: ['LMS1', 'LMS5', 'HES'] }) };
  const { C } = load({ store });
  const sess = S('LMS2,LMS5', 'p@lms.org.in');
  assert.deepStrictEqual(plain(C.get(sess)), { all: false, campuses: ['LMS5'] }, 'out-of-scope stored campuses dropped');
  const el = fakeEl('div');
  const p = C.mount(el, { session: sess, hes: true });
  assert.deepStrictEqual(chips(el).map((b) => b.getAttribute('data-code')), ['ALL', 'LMS2', 'LMS5'], 'only in-scope chips');
  p.set(['LMS1', 'LMS3']);
  assert.deepStrictEqual(plain(p.get()), { all: true, campuses: ['LMS2', 'LMS5'] }, 'set() with out-of-scope codes cannot widen');
  assert.deepStrictEqual(plain(C.filter([{ campus: 'LMS1' }, { campus: 'LMS2' }], { all: false, campuses: p.get().campuses })), [{ campus: 'LMS2' }], 'scope clips when schools are picked (All keeps the backend rows, per P3)');
  // Fee Clerk / single-campus session
  const fee = load({ store: { 'lmcs-campus:f@lms.org.in': JSON.stringify({ v: 1, sel: ['LMS1'] }) } });
  assert.deepStrictEqual(plain(fee.C.get({ email: 'f@lms.org.in', campusId: 'LMS6', roles: ['Fee Clerk'] })), { all: true, campuses: ['LMS6'] });
}

// --- Review Focus 2: stored selection that is now empty, or garbage, falls back to All
{
  for (const v of [JSON.stringify({ v: 1, sel: [] }), JSON.stringify({ v: 1, sel: ['LMS9'] }), '{bad json', JSON.stringify({ v: 2, sel: ['LMS1'] })]) {
    const { C } = load({ store: { 'lmcs-campus:a@lms.org.in': v } });
    assert.deepStrictEqual(plain(C.get(S('ALL'))), { all: true, campuses: ALL6 }, v);
  }
}

// --- Review Focus 3: one school in scope -> picker hidden, page behaves as today
{
  const { C } = load();
  const el = fakeEl('div'), seen = [];
  C.mount(el, { session: S('LMS3'), onChange: (s) => seen.push(plain(s)) });
  assert.strictEqual(el.hidden, true);
  assert.deepStrictEqual(seen, [{ all: true, campuses: ['LMS3'] }]);
  assert.strictEqual(C.overlay({ LMS3: 9 }, seen[0]), '9');
}

// --- single-select: same chips (no All), exactly one pick, own key
{
  const { C, store } = load({ store: { 'lmcs-campus:a@lms.org.in': JSON.stringify({ v: 1, sel: ['LMS4', 'LMS5'] }) } });
  const el = fakeEl('div'), seen = [];
  const p = C.mount(el, { session: S('ALL'), multi: false, onChange: (s) => seen.push(plain(s)) });
  assert.deepStrictEqual(chips(el).map((b) => b.textContent), ['LMS 1', 'LMS 2', 'LMS 3', 'LMS 4', 'LMS 5', 'LMS 6']);
  assert.deepStrictEqual(seen, [{ all: false, campuses: ['LMS1'] }], 'single-select ignores the multi key, defaults to the first');
  chip(el, 'LMS4').click(); chip(el, 'LMS2').click(); chip(el, 'LMS2').click();
  assert.deepStrictEqual(plain(p.get()), { all: false, campuses: ['LMS2'] }, 'exactly one; re-click keeps it');
  assert.deepStrictEqual(pressed(el), ['LMS2']);
  assert.deepStrictEqual(JSON.parse(store['lmcs-campus1:a@lms.org.in']), { v: 1, sel: ['LMS2'] });
  assert.deepStrictEqual(JSON.parse(store['lmcs-campus:a@lms.org.in']).sel, ['LMS4', 'LMS5'], 'multi choice untouched');
  assert.deepStrictEqual(plain(C.get(S('ALL'), { multi: false })), { all: false, campuses: ['LMS2'] });
}

// --- Review Focus 5: localStorage blocked -> still works, just forgets
{
  const { C } = load({ blocked: true });
  const el = fakeEl('div');
  const p = C.mount(el, { session: S('ALL') });
  assert.deepStrictEqual(plain(p.get()).all, true);
  chip(el, 'LMS2').click();
  assert.deepStrictEqual(plain(p.get()), { all: false, campuses: ['LMS2'] });
  assert.deepStrictEqual(plain(C.get(S('ALL'))).all, true);
}

// --- colours + overlay (Review Focus 4: missing value shows a dash) + escaping
{
  const { C } = load();
  assert.strictEqual(C.color('LMS3'), 'var(--campus-lms3)');
  assert.strictEqual(C.color('HES'), 'var(--campus-hes)');
  assert.strictEqual(C.color('x);background:url(evil)'), 'var(--gray)', 'unknown codes never reach a style');
  for (const c of [...ALL6, 'HES']) assert.ok(new RegExp(`--campus-${c.toLowerCase()}:\\s*#[0-9a-f]{6}`).test(css), `token for ${c}`);

  const all = { all: true, campuses: ALL6 };
  assert.strictEqual(C.overlay({ LMS1: 2, LMS2: 3 }, all), '5', 'All: single total of what is there');
  assert.strictEqual(C.overlay({}, all), '–', 'no data at all: dash, not 0');
  assert.strictEqual(C.overlay({ LMS1: 2 }, { all: false, campuses: ['LMS1'] }, (v) => `₹${v}`), '₹2');
  const two = C.overlay({ LMS1: 4, LMS3: 0 }, { all: false, campuses: ['LMS1', 'LMS2', 'LMS3'] });
  assert.ok(/class="lmcs-ov"/.test(two));
  assert.strictEqual((two.match(/class="lmcs-ov-item"/g) || []).length, 3);
  assert.ok(two.includes('var(--campus-lms2)') && /LMS 2[^]*?–/.test(two), 'missing school shows a dash');
  assert.ok(/LMS 3[^]*?>0</.test(two), 'a real zero stays 0');
  const x = C.overlay({ LMS1: '<img onerror=1>', LMS2: 1 }, { all: false, campuses: ['LMS1', 'LMS2'] });
  assert.ok(!x.includes('<img') && x.includes('&lt;img'), 'values escaped');
  assert.ok(!C.overlay({ LMS1: 1 }, { all: false, campuses: ['LMS1'] }, () => '<b>').includes('<b>'), 'single total escaped');
}

// --- filter
{
  const { C } = load();
  const rows = [{ campus: 'LMS1' }, { campus: 'LMS2' }, { school: 'LMS2' }];
  assert.deepStrictEqual(plain(C.filter(rows, { all: false, campuses: ['LMS2'] })), [{ campus: 'LMS2' }]);
  assert.deepStrictEqual(plain(C.filter(rows, { all: false, campuses: ['LMS2'] }, 'school')), [{ school: 'LMS2' }]);
  // P3: All keeps every row, even one with no campus or an unknown one; picked schools hide them; All returns a copy
  const odd = [{ campus: 'LMS1' }, { campus: '' }, {}, { campus: 'XX' }];
  assert.strictEqual(C.filter(odd, { all: true, campuses: ['LMS1', 'LMS2'] }).length, 4);
  assert.notStrictEqual(C.filter(odd, { all: true, campuses: [] }), odd);
  assert.deepStrictEqual(plain(C.filter(odd, { all: false, campuses: ['LMS1'] })), [{ campus: 'LMS1' }]);
}

console.log('campus picker: all checks passed');
