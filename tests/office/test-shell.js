// Browser-side ES module test (office/js). Standalone: node tests/office/test-shell.js (no-op under run.js).
'use strict';
const assert = require('assert');
if (require.main !== module) { module.exports = () => {}; return; }
(async () => {
  const { syncLabel, canSignOut, signOutPlan, esc } = await import('../../office/js/shell.js');
  assert.strictEqual(syncLabel({ waiting: 0, attention: 0, online: true }), 'All synced');
  assert.strictEqual(syncLabel({ waiting: 3, attention: 0, online: true }), '3 waiting');
  assert.strictEqual(syncLabel({ waiting: 3, attention: 0, online: false }), 'Offline');
  assert.strictEqual(syncLabel({ waiting: 0, attention: 2, online: false }), '2 need attention');
  assert.strictEqual(canSignOut({ waiting: 0, attention: 0 }), true);
  assert.strictEqual(canSignOut({ waiting: 1, attention: 0 }), false);
  assert.strictEqual(canSignOut({ waiting: 0, attention: 1 }), false);
  console.log('  ok  - shell pure parts, sign-out blocked by waiting and attention');
  // R38: sign-out deletes only the signed-in user's entries; other users' are kept and shown in the label.
  const es = [{ id: '1', status: 'waiting', owner: 'a@x.org' }, { id: '2', status: 'attention', owner: 'a@x.org' }, { id: '3', status: 'waiting', owner: 'b@x.org' }];
  assert.deepStrictEqual(signOutPlan(es, (e) => e.owner === 'a@x.org'), { ids: ['1', '2'], waiting: 1, attention: 1, kept: 1 });
  assert.deepStrictEqual(signOutPlan(es, (e) => e.owner === 'c@x.org'), { ids: [], waiting: 0, attention: 0, kept: 3 });
  assert.strictEqual(syncLabel({ waiting: 0, attention: 0, others: 2, online: true }), 'All synced · 2 from another user');
  const { waitingFor } = await import('../../office/js/attention.js');
  assert.strictEqual(waitingFor({ owner: 'b@x.org', status: 'waiting' }), 'Waiting for b@x.org to sign in on this device.');
  assert.ok(waitingFor({ owner: 'b@x.org', status: 'attention', code: 'DAY_CLOSED' }).includes('Needs attention: That day is closed'));
  console.log('  ok  - sign-out keeps other users\' entries; their entries say who they wait for');

  // R42: the page's user is the session it booted with, even after the Google token lapses (getSession() -> null).
  const { pageUser } = await import('../../office/js/shell.js');
  const { createOutbox } = await import('../../office/js/outbox.js');
  let live = { email: 'A@x.org', idToken: 't1' };
  const L = { getSession: () => live };
  const u = pageUser(L, live);
  const m = new Map(), store = { put: async (e) => { m.set(e.id, { ...e }); }, getAll: async () => [...m.values()], delete: async (id) => { m.delete(id); } };
  const ob = createOutbox({ store, api: { write: async () => ({ success: false, code: 'AUTH' }) }, who: u.who });
  live = null; // token expired: auth.js drops the stored session
  await ob.enqueue('daybook.add', {});
  assert.deepStrictEqual([...m.values()].map((e) => e.owner), ['a@x.org'], 'stamped with the boot email');
  assert.deepStrictEqual(await ob.counts(), { waiting: 1, attention: 0, others: 0 }, 'own entries stay theirs during a lapse');
  await assert.rejects(u.token(), 'no token while lapsed');
  live = { email: 'b@x.org', idToken: 't2' };
  await assert.rejects(u.token(), 'another user\'s token is never used for this page\'s entries');
  live = { email: 'a@x.org', idToken: 't3' };
  assert.strictEqual(await u.token(), 't3');
  assert.strictEqual(u.otherUserSignedIn({ key: 'lmcs_session', newValue: JSON.stringify({ email: 'B@x.org' }) }), true);
  assert.strictEqual(u.otherUserSignedIn({ key: 'lmcs_session', newValue: JSON.stringify({ email: 'a@x.org' }) }), false);
  assert.strictEqual(u.otherUserSignedIn({ key: 'lmcs_session', newValue: null }), false, 'a lapse elsewhere is not a new user');
  assert.strictEqual(u.otherUserSignedIn({ key: 'other', newValue: '{}' }), false);
  assert.ok(waitingFor({ owner: null, status: 'waiting' }).includes('Retry'), 'ownerless entries say how to claim them');
  console.log('  ok  - entries keep the boot user through a token lapse; another user\'s sign-in is detected');

  const evil = '<img src=x onerror=alert(1)>';
  assert.ok(!esc(evil).includes('<'));
  const { renderTasks } = await import('../../office/js/today.js');
  const el = {};
  renderTasks(el, { date: '2026-10-21', tasks: [{ id: '1', title: evil, due: '2026-10-21', status: 'due', action: 'report' }] }, evil);
  assert.ok(!el.innerHTML.includes('<img'), el.innerHTML);
  assert.ok(el.innerHTML.includes('&lt;img'));
  console.log('  ok  - task titles and notes are escaped');
  const { dueLabel } = await import('../../office/js/today.js');
  assert.strictEqual(dueLabel('2026-10-21 18:00'), '21/10/2026 18:00');
  assert.strictEqual(dueLabel('2026-10-21'), '21/10/2026');
  console.log('  ok  - due times read DD/MM/YYYY HH:MM');

  // Service worker: load sw.js with a fake self and probe the fetch filter.
  const vm = require('vm'), fs = require('fs');
  const sandbox = { URL, self: { location: new URL('https://x.github.io/LMCSManagement/office/sw.js'), addEventListener() {} }, caches: {} };
  vm.runInNewContext(fs.readFileSync(__dirname + '/../../office/sw.js', 'utf8') + ';this.shellHref=shellHref;', sandbox);
  const h = (url, method = 'GET') => sandbox.shellHref({ url, method });
  assert.ok(h('https://x.github.io/LMCSManagement/office/index.html?v=1'));
  assert.ok(h('https://x.github.io/LMCSManagement/assets/style.css'));
  assert.strictEqual(h('https://script.google.com/macros/s/abc/exec?action=today.get'), null);
  assert.strictEqual(h('https://lh3.googleusercontent.com/file'), null);
  assert.strictEqual(h('https://x.github.io/LMCSManagement/office/other.json'), null);
  assert.strictEqual(h('https://x.github.io/LMCSManagement/office/index.html', 'POST'), null);
  console.log('  ok  - service worker caches only same-origin shell files');

  // Network-first: a release is served at once when online; the cached copy only when the network fails.
  const handlers = {}, swStore = new Map([['https://x.github.io/LMCSManagement/office/index.html', 'OLD']]);
  let online = true;
  const net = { url: 'https://x.github.io/LMCSManagement/office/index.html', method: 'GET' };
  const sb2 = { URL, Response: { error: () => 'ERR' }, self: { location: new URL('https://x.github.io/LMCSManagement/office/sw.js'), addEventListener: (k, f) => { handlers[k] = f; } },
    fetch: async () => { if (!online) throw new Error('offline'); return { ok: true, body: 'NEW', clone() { return 'NEW'; } }; },
    caches: { open: async () => ({ put: async (k, v) => swStore.set(k, v), match: async (k) => swStore.get(k) }) } };
  vm.runInNewContext(fs.readFileSync(__dirname + '/../../office/sw.js', 'utf8'), sb2);
  const serve = async () => { let p; handlers.fetch({ request: net, respondWith: (x) => { p = x; } }); return p; };
  assert.strictEqual((await serve()).body, 'NEW', 'online: the network copy, not the stale cache');
  await new Promise((r) => setTimeout(r, 0));
  assert.strictEqual(swStore.get(net.url), 'NEW', 'cache refreshed for offline use');
  online = false;
  assert.strictEqual(await serve(), 'NEW', 'offline: the cached copy');
  console.log('  ok  - service worker is network-first with an offline fallback');
})().catch((e) => { console.log('  FAIL -', e.message); process.exit(1); });
