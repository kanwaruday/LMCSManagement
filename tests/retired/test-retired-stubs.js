// Batch (a) of the old-portal retirement (plan 1a + 1b row 1): each retired page is a stub that sends a bookmark or old link on to
// its game screen ("home" = the game's own home for the role), and stays put (with the link) in a tab a game door opened. The
// office's offline worker deletes its caches and unregisters. Usage: node tests/retired/test-retired-stubs.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const ROOT = path.join(__dirname, '../..');

const { PLAN } = require('./retired-pages');
assert.strictEqual(Object.keys(PLAN).length, 40);
assert.ok(fs.existsSync(path.join(ROOT, 'owner/event-design.html')) && !fs.readFileSync(path.join(ROOT, 'owner/event-design.html'), 'utf8').includes('lmcs-moved-to'), 'event-design.html is not retired');

const GAME = 'https://game.example/', FLAG = 'lmcs_from_game';
function run(html, search, flag, hash) {
  const hm = (html.match(/<meta name="lmcs-moved-hashes" content='([^']+)'/) || [])[1];
  const script = html.match(/<script>\n\/\/ A retired old-portal page[\s\S]*?<\/script>/)[0].replace(/^<script>|<\/script>$/g, '');
  const to = html.match(/<meta name="lmcs-moved-to" content="([^"]+)"/)[1];
  const link = { href: '' }, store = { v: flag ? { [FLAG]: '1' } : {}, setItem(k, v) { this.v[k] = v; }, getItem(k) { return this.v[k] ?? null; } };
  let replaced = null;
  const ctx = { window: { LMCSGameDoor: { GAME, FLAG } }, URLSearchParams, sessionStorage: store, location: { search, hash: hash || '', replace(u) { replaced = u; } },
    document: { querySelector: (q) => (q.includes('moved-hashes') ? (hm ? { getAttribute: () => hm } : null) : { getAttribute: () => to }), getElementById: () => link } };
  vm.runInNewContext(script, ctx);
  return { replaced, link: link.href };
}

let n = 0;
for (const [p, to] of Object.entries(PLAN)) {
  const html = fs.readFileSync(path.join(ROOT, p), 'utf8');
  assert.ok(html.includes(`<meta name="lmcs-moved-to" content="${to}" />`), p + ': target');
  const src = html.match(/<script src="([^"?]+auth\.js)(?:\?v=[0-9a-f]{8})?"><\/script>/)[1];
  assert.ok(fs.existsSync(path.join(ROOT, path.dirname(p), src)), p + ': loads assets/auth.js');
  const url = GAME + (to === 'home' ? '' : to);
  assert.deepStrictEqual(run(html, ''), { replaced: url, link: url }, p + ': a bookmark goes on to the game');
  assert.deepStrictEqual(run(html, '?from=game'), { replaced: null, link: url }, p + ': a game door\'s tab stays, with the link');
  assert.deepStrictEqual(run(html, '', true), { replaced: null, link: url }, p + ': a flagged tab stays');
  assert.ok(html.includes('This page moved to the game'), p + ': says so');
  n++;
}
{ // coordinator/systems: old e-mail links keep their meaning
  const h = fs.readFileSync(path.join(ROOT, 'coordinator/systems/index.html'), 'utf8');
  for (const [hash, to] of [['#approvals', '#/hq/approvals'], ['#leave', '#/hq/approvals?show=leave'], ['#fees', '#/pdr'], ['#nonsense', '']]) assert.strictEqual(run(h, '', false, hash).replaced, GAME + to, hash);
}
assert.ok(/LMCSGameDoor[\s\S]*const GAME = '/.test(fs.readFileSync(path.join(ROOT, 'assets/auth.js'), 'utf8')), 'the game address comes from LMCSGameDoor');

// office/sw.js: deletes every cache, unregisters, reloads its pages only when it cleared something
async function sw(cacheKeys) {
  const L = {}, out = { deleted: [], unregistered: false, navigated: [] };
  const self = { addEventListener: (t, f) => (L[t] = f), skipWaiting() {}, registration: { unregister: async () => (out.unregistered = true) },
    clients: { matchAll: async () => [{ url: 'https://p/office/daybook.html', navigate: async (u) => out.navigated.push(u) }] } };
  const caches = { keys: async () => cacheKeys, delete: async (k) => out.deleted.push(k) };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'office/sw.js'), 'utf8'), { self, caches });
  let wait; L.activate({ waitUntil: (p) => (wait = p) }); await wait;
  return out;
}
(async () => {
  assert.deepStrictEqual(await sw(['lmcs-office-v23']), { deleted: ['lmcs-office-v23'], unregistered: true, navigated: ['https://p/office/daybook.html'] });
  assert.deepStrictEqual(await sw([]), { deleted: [], unregistered: true, navigated: [] });
  console.log(`retired stubs: ${n} pages go to their game screens (a game door's tab stays); office/sw.js clears and unregisters — all passed`);
})().catch((e) => { console.error(e); process.exit(1); });
