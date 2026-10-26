// Runs a portal page's real scripts (the shared campus picker, then the page's own external and inline <script>s) under node,
// with a permissive fake DOM: every element is a recording stub (innerHTML etc. kept as plain fields), except the picker slots
// (querySelector('#x')), which are real fake elements so chips can be clicked. Not a test itself (no test- prefix).
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '../..');
const { fakeEl, NAMES } = require('../coordinator/campus-env');

function stub() {
  const store = {};
  const fn = function () { return p; };
  const p = new Proxy(fn, {
    get(t, k) {
      if (k in store) return store[k];
      if (k === Symbol.toPrimitive) return () => '';
      if (k === 'then' || k === 'length') return undefined;
      if (k === 'style') return (store.style = { setProperty() {} });
      if (k === 'dataset') return (store.dataset = {});
      if (k === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
      if (k === 'querySelectorAll' || k === 'getElementsByClassName') return () => [];
      if (k === 'closest') return () => null;
      return p;
    },
    set(t, k, v) { store[k] = v; return true; },
    apply() { return p; },
  });
  return p;
}

// page: path relative to repo root. session: what LMCS.getSession() returns. extra: more globals.
function loadPage(page, { session, store = {}, extra = {}, caps = {} } = {}) {
  const els = {}, pickers = {};
  const doc = {
    getElementById: (id) => els[id] || (els[id] = stub()),
    querySelector: (sel) => (/^#/.test(sel) ? pickers[sel] || (pickers[sel] = Object.assign(fakeEl('div'), { hidden: false })) : stub()),
    querySelectorAll: () => [], createElement: (t) => fakeEl(t), addEventListener() {}, body: stub(), head: stub(), documentElement: stub(),
  };
  const never = () => new Promise(() => {});
  const ctx = vm.createContext(Object.assign({
    console, Date, Math, JSON, Promise, Set, Map, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, parseInt, parseFloat, Number, String, Array, Object, RegExp, Error, isNaN, encodeURIComponent, decodeURIComponent, URL, URLSearchParams, Blob: function () {},
    document: doc, location: { hash: '', search: '', href: '', replace() {} }, history: { replaceState() {} }, navigator: { userAgent: 'node' }, alert() {}, confirm: () => true,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem(k) { delete store[k]; } },
    fetch: never, performance: { now: () => 0 }, addEventListener() {}, matchMedia: () => ({ matches: false }),
    LMCS: Object.assign({ campusLabel: (c) => NAMES[c] || c, getSession: () => session, requireSession: never, signOut() {}, hasRole: (s, r) => ((s && s.roles) || []).includes(r),
      canViewDataSources: () => false, canManageStaff: () => true, canUseHiring: () => true, canViewCoordinatorPortal: () => false }, caps),
  }, extra));
  ctx.window = ctx; ctx.self = ctx;
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  const dir = path.dirname(page);
  const parts = [...html.matchAll(/<script(?:\s+src="([^"]+)")?[^>]*>([\s\S]*?)<\/script>/g)];
  for (const [, src, body] of parts) {
    if (src && /^https?:/.test(src)) continue; // CDN libs are not needed for these checks
    if (src && /auth\.js/.test(src)) continue; // LMCS is faked above
    const code = src ? fs.readFileSync(path.join(root, dir, src.replace(/\?.*$/, '')), 'utf8') : body;
    vm.runInContext(code, ctx, { filename: src || page });
  }
  return { ctx, els, pickers, run: (code) => vm.runInContext(code, ctx) };
}
const chip = (el, code) => el.children[0].children.find((b) => b.getAttribute('data-code') === code);
const pressed = (el) => el.children[0].children.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.getAttribute('data-code'));
const S = (campusId, extra) => Object.assign({ email: 'u-' + campusId + '@x', name: 'U', campusId, roles: ['Owner'], idToken: 't' }, extra);
module.exports = { loadPage, chip, pressed, S };
