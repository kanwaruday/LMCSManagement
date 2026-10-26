// Shared by the coordinator campus-picker tests: runs coordinator/shared.js (and optionally approvals.js) with the real campus picker
// and a tiny fake DOM. Not a test itself (no test- prefix).
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '../..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

function fakeEl(tag) {
  const e = {
    tagName: String(tag).toUpperCase(), children: [], attrs: {}, listeners: {}, textContent: '', className: '', hidden: false, style: { setProperty() {} },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    appendChild(c) { this.children.push(c); return c; }, addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    click() { (this.listeners.click || []).forEach((fn) => fn({ currentTarget: this, target: this })); },
  };
  Object.defineProperty(e, 'innerHTML', { set(v) { if (v === '') this.children = []; }, get() { return ''; } });
  return e;
}
const NAMES = { LMS1: 'LMS 1 — Dhalpur', LMS2: 'LMS 2 — Kelheli', LMS3: 'LMS 3 — Dunkhra', LMS4: 'LMS 4 — Ner Chowk', LMS5: 'LMS 5 — Sayoli', LMS6: 'LMS 6 — Jogindernagar', HES: 'HES' };

// A view's body: querySelector('.x-pick') gives a real element for the picker, '.x-body' the page's draw box (innerHTML is captured,
// its [data-tab] buttons are real handlers). Anything else the views poke at is a harmless stub.
function makeBody(boxClass) {
  const pickers = {}, tabs = {};
  const stub = () => ({ addEventListener() {}, focus() {}, setSelectionRange() {}, style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, removeAttribute() {}, closest: () => null, querySelector: () => null, querySelectorAll: () => [] });
  const box = Object.assign(stub(), {
    innerHTML: '',
    querySelectorAll(sel) {
      if (sel !== '[data-tab]') return [];
      return [...this.innerHTML.matchAll(/data-tab="(\w+)"/g)].map((m) => ({ dataset: { tab: m[1] }, addEventListener: (ev, fn) => { tabs[m[1]] = fn; } }));
    },
    querySelector: (sel) => (sel === '.tw.stick' ? null : stub()),
  });
  const body = { innerHTML: '', querySelector(sel) { if (sel === boxClass) return box; if (!(sel in pickers)) pickers[sel] = Object.assign(fakeEl('div'), { hidden: false }); return pickers[sel]; } };
  return { body, box, pickers, openTab: (t) => { box.querySelectorAll('[data-tab]'); tabs[t]({ preventDefault() {} }); } };
}

function makeCtx({ session, hash = '', store = {}, data = {} } = {}) {
  const ctx = vm.createContext({
    console, Date, setTimeout, clearTimeout, performance: { now: () => 0 }, location: { hash }, Promise,
    document: { createElement: fakeEl, querySelector: () => null, getElementById: () => null, head: { appendChild() {} } },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    LMCS: { campusLabel: (c) => NAMES[c] || c, getSession: () => session },
    fetch: (url) => { const a = (String(url).match(/action=(\w+)/) || [])[1]; const body = JSON.parse(JSON.stringify(data[a] || { success: false, error: 'no data' })); return Promise.resolve({ json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) }); },
  });
  ctx.window = ctx;
  vm.runInContext(read('assets/campus-picker.js'), ctx);
  vm.runInContext(read('coordinator/transport-rank.js'), ctx);
  vm.runInContext(read('coordinator/shared.js'), ctx);
  ctx.Coord.setSession(session);
  return ctx;
}
const tick = () => new Promise((ok) => setTimeout(ok, 0));
const chip = (pickEl, code) => pickEl.children[0].children.find((b) => b.getAttribute('data-code') === code);
const pressed = (pickEl) => pickEl.children[0].children.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.getAttribute('data-code'));

module.exports = { read, fakeEl, makeBody, makeCtx, tick, chip, pressed, NAMES };
