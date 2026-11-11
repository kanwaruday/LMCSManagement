// The old portal's front doors open the game (assets/auth.js LMCSGameDoor, Uday 12 Nov: "close the door").
// Bare visits to entry pages redirect; game-door visits (?from=game / ?only=) never do, nor anything after them in that tab;
// driver/* and the capture camera never redirect. Usage: node tests/game/test-portal-redirect.js
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '../..');
const src = fs.readFileSync(path.join(root, 'assets/auth.js'), 'utf8');
const BASE = 'https://kanwaruday.github.io/LMCSManagement/';
const SELF = BASE + 'assets/auth.js?v=abc';

const tab = () => { const s = {}; return { getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); } }; };
// run auth.js as a page would: currentScript set, a location with replace(), sessionStorage for this tab
function load(href, store = tab(), self = SELF) {
  const went = [];
  const ctx = { URL, URLSearchParams, console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, setInterval, clearInterval,
    localStorage: tab(), sessionStorage: store, navigator: {}, atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    location: { href, replace: (u) => went.push(u), reload() {} },
    document: { currentScript: self ? { src: self } : null, readyState: 'loading', addEventListener() {}, querySelector: () => null, getElementById: () => null,
      createElement: () => ({}), head: { appendChild() {} } },
    fetch: async () => new Response('{}') };
  ctx.window = ctx; ctx.addEventListener = () => {};
  vm.createContext(ctx); vm.runInContext(src, ctx);
  return { went, api: ctx.LMCSGameDoor, store };
}

const ENTRY_PAGES = ['', 'index.html', 'principal/', 'principal/index.html', 'office/', 'office/index.html', 'teacher/', 'coordinator/',
  'coordinator/index.html', 'coordinator/hq.html', 'coordinator/systems/', 'staff-home/', 'owner/', 'owner/index.html'];

// 1. a bare visit to every entry page goes to the game
for (const p of ENTRY_PAGES) assert.deepStrictEqual(load(BASE + p).went, ['https://lms-game.pages.dev/'], 'bare visit should redirect: ' + p);

// 2. a door visit (from=game, with or without a #hash or ?only=) to any of them stays
for (const p of ENTRY_PAGES) {
  assert.deepStrictEqual(load(BASE + p + '?from=game').went, [], 'door visit must stay: ' + p);
  assert.deepStrictEqual(load(BASE + p + '?from=game#today').went, [], 'door visit with a hash must stay: ' + p);
  assert.deepStrictEqual(load(BASE + p + '?only=x&from=game').went, [], 'door visit with only= must stay: ' + p);
  assert.deepStrictEqual(load(BASE + p + '?only=x').went, [], 'older ?only= door must stay: ' + p);
}

// 3. driver/* and the capture camera never redirect, even bare; nor do pages a door opens
for (const p of ['driver/', 'driver/index.html', 'driver/index.html#fuel-1', 'coordinator/transport/capture.html', 'coordinator/transport/index.html',
  'office/hiring.html', 'principal/support-sessions.html', 'owner/transport/index.html', 'live.html', 'staff-home/roles.js'])
  assert.deepStrictEqual(load(BASE + p).went, [], 'must never redirect: ' + p);

// 4. the flag survives in-portal navigation in that tab; a fresh tab redirects again
{
  const t = tab();
  assert.deepStrictEqual(load(BASE + 'office/index.html?from=game#today', t).went, []);
  assert.strictEqual(t.getItem('lmcs_from_game'), '1');
  for (const p of ['principal/', 'office/', '', 'coordinator/hq.html']) assert.deepStrictEqual(load(BASE + p, t).went, [], 'same tab, later page: ' + p);
  assert.deepStrictEqual(load(BASE + 'principal/', tab()).went.length, 1, 'a new tab redirects again');
}

// 5. never trapped: no script URL (tests, inline), no storage, or a page outside the portal's base → no redirect
assert.deepStrictEqual(load(BASE + 'office/', tab(), '').went, []);
assert.deepStrictEqual(load(BASE + 'office/', null).went, []);
assert.deepStrictEqual(load('https://elsewhere.test/office/').went, []);
assert.strictEqual(load(BASE + 'x.html').api.rel(BASE + 'coordinator/systems/index.html', SELF), 'coordinator/systems/');

// 6. every entry page really loads assets/auth.js (or the redirect wouldn't run there); the driver app doesn't load it at all
for (const f of ['index.html', 'principal/index.html', 'office/index.html', 'teacher/index.html', 'coordinator/index.html', 'coordinator/hq.html',
  'coordinator/systems/index.html', 'staff-home/index.html', 'owner/index.html'])
  assert.match(fs.readFileSync(path.join(root, f), 'utf8'), /<script src="(\.\.\/)*assets\/auth\.js[?"]/, f + ' should load auth.js');
assert.doesNotMatch(fs.readFileSync(path.join(root, 'driver/index.html'), 'utf8'), /assets\/auth\.js/, 'driver app stays outside');

console.log('portal-redirect: ok');
