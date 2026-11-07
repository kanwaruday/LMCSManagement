// A campus or role changed in the allowlist (the Owner's People room) reaches a session that is already signed in (assets/auth.js
// refreshSession_ and the background re-check). Fake DOM + scripted allowlist backend, synthetic people only.
// Usage: node tests/auth/test-session-refresh.js
const vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '../../assets/auth.js'), 'utf8');

const sess = (o) => JSON.stringify(Object.assign({ name: 'X', ts: Date.now(), expiresAt: Date.now() + 3600e3 }, o));
const list = (...entries) => ({ success: true, entries });
function page(store, reply) {
  const calls = { allowlist: 0 };
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; },
    key: (i) => Object.keys(store)[i] || null, get length() { return Object.keys(store).length; } };
  const ctx = {
    localStorage, URL, Response, console: { log() {}, warn() {}, error: console.error }, AbortController,
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 5)), clearTimeout, setInterval: () => 0, clearInterval,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'), navigator: {}, performance: { getEntriesByType: () => [] },
    location: { href: 'https://portal.test/', reload() {} },
    document: { readyState: 'complete', hidden: false, body: null, addEventListener() {}, querySelector: () => ({ innerHTML: '' }), getElementById: () => ({ style: {} }), createElement: () => ({}), head: { appendChild() {} } },
    fetch: async (url, init) => {
      calls.sent = (calls.sent || []).concat([[String(url), init && init.body]]);
      if (!String(url).includes('allowlist_list')) return new Response('{"success":true}');
      calls.allowlist++;
      return new Response(JSON.stringify(reply), { status: 200 });
    },
  };
  ctx.window = ctx; ctx.addEventListener = () => {};
  vm.createContext(ctx); vm.runInContext(src, ctx);
  ctx.window.__lmcsClearFetchCache = () => { calls.cleared = (calls.cleared || 0) + 1; }; // spy (the refresh runs after load)
  return { calls, LMCS: ctx.window.LMCS, ctx };
}
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const stored = (store) => JSON.parse(store.lmcs_session);

(async () => {
  // 1. a Principal moved LMS4 -> LMS6 in the sheet: the background re-check updates the stored session; role and token stay
  let store = { lmcs_session: sess({ email: 'p4@example.org', campusId: 'LMS4', campusName: 'x', role: 'Principal', idToken: 'tok' }) };
  let p = page(store, list({ email: 'p4@example.org', name: 'P', campusId: 'LMS6', role: 'Principal' }));
  await tick();
  assert.strictEqual(p.calls.allowlist, 1, 'one background re-check');
  assert.strictEqual(p.calls.cleared, 1, 'a changed campus clears the fetch cache (cached reads are keyed by email, not campus)');
  assert.deepStrictEqual([stored(store).campusId, stored(store).role, stored(store).idToken], ['LMS6', 'Principal', 'tok']);
  assert.strictEqual(stored(store).campusName, p.LMCS.campusLabel('LMS6'));
  // requireSession hands back the refreshed session, not the stale one it started with
  store.lmcs_session = sess({ email: 'p4@example.org', campusId: 'LMS4', role: 'Principal' });
  p = page(store, list({ email: 'p4@example.org', name: 'P', campusId: 'LMS2', role: 'Principal' }));
  const s = await p.LMCS.requireSession('#gate');
  assert.strictEqual(s.campusId, 'LMS2');

  // 2. a fresh copy of the list (under 5 min old): no re-check
  store = { lmcs_session: sess({ email: 'p4@example.org', campusId: 'LMS4', role: 'Principal' }), lmcs_allowlist_v1: JSON.stringify({ t: Date.now() - 60e3, map: {} }) };
  p = page(store, list());
  await tick();
  assert.strictEqual(p.calls.allowlist, 0, 'throttled');
  assert.strictEqual(stored(store).campusId, 'LMS4');

  // 3. off the list: the background re-check never signs anyone out (requireSession decides that); 4. autoSignIn left alone
  store = { lmcs_session: sess({ email: 'gone@example.org', campusId: 'LMS3', role: 'Principal' }) };
  page(store, list({ email: 'other@example.org', campusId: 'LMS1', role: 'Principal' }));
  await tick();
  assert.strictEqual(stored(store).campusId, 'LMS3');
  store = { lmcs_session: sess({ email: 't@example.org', campusId: 'LMS5', role: 'Teacher', autoSignIn: true, employeeCode: 'E1' }) };
  page(store, list({ email: 't@example.org', campusId: 'LMS1', role: 'Principal' }));
  await tick();
  assert.deepStrictEqual([stored(store).campusId, stored(store).role], ['LMS5', 'Teacher']);

  // 5. ALL stays a plain-Fee-Clerk rule: a Fee Clerk moved to ALL gets ALL, and still none of the ALL portals
  store = { lmcs_session: sess({ email: 'fc@example.org', campusId: 'LMS2', role: 'FeeClerk' }) };
  p = page(store, list({ email: 'fc@example.org', campusId: 'ALL', role: 'FeeClerk' }));
  await tick();
  const fc = stored(store);
  assert.strictEqual(fc.campusId, 'ALL');
  assert.ok(!p.LMCS.canViewOwnerPortal(fc) && !p.LMCS.canManageStaff(fc) && !p.LMCS.canViewCoordinatorPortal(fc), 'ALL widens a Fee Clerk\'s campus only');

  // 6. nothing changed: the stored session is not rewritten
  store = { lmcs_session: sess({ email: 'o@example.org', campusId: 'ALL', role: 'Owner' }) };
  const before = store.lmcs_session;
  p = page(store, list({ email: 'o@example.org', campusId: 'ALL', role: 'Owner' }));
  await tick();
  assert.strictEqual(store.lmcs_session, before);
  assert.strictEqual(p.calls.cleared, undefined, 'nothing changed: the cache stays');
  // 7. a supporting charge (Owner's People room): carried from the list; the switch reads the supported school, read-only by the backends
  store = { lmcs_session: sess({ email: 'p4@example.org', campusId: 'LMS4', role: 'Principal', idToken: 't' }) };
  p = page(store, list({ email: 'p4@example.org', campusId: 'LMS4', role: 'Principal', supporting: ['LMS3', 'ALL', 'x'] }));
  await tick();
  assert.deepStrictEqual(Array.from(stored(store).supporting), ['LMS3'], 'LMS1-6 only: ALL never reaches a session');
  assert.strictEqual(p.LMCS.supportSwitch('ALL'), false);
  assert.strictEqual(p.LMCS.supportSwitch('LMS5'), false, 'not one of theirs');
  assert.strictEqual(p.LMCS.supportSwitch('LMS3'), true);
  assert.deepStrictEqual([stored(store).campusId, stored(store).actAs, stored(store).homeCampusId, stored(store).role], ['LMS3', 'LMS3', 'LMS4', 'Principal']);
  const GAS = 'https://script.google.com/macros/s/AKfycbTEST/exec';
  p.calls.sent = [];
  await p.ctx.window.fetch(GAS + '?action=approvalslist&idToken=t');
  await p.ctx.window.fetch(GAS, { method: 'POST', body: JSON.stringify({ action: 'decideapproval', idToken: 't' }) });
  assert.ok(new URL(p.calls.sent[0][0]).searchParams.get('actAs') === 'LMS3', 'GET says which school');
  assert.strictEqual(JSON.parse(p.calls.sent[1][1]).actAs, 'LMS3', 'POST says which school (the backend refuses a decision there)');
  // the list still names LMS3: the switch stays; the charge removed: back to their own school
  p = page(store, list({ email: 'p4@example.org', campusId: 'LMS4', role: 'Principal', supporting: ['LMS3', 'LMS1'] }));
  store.lmcs_allowlist_v1 = undefined; delete store.lmcs_allowlist_v1;
  await p.LMCS.requireSession('#gate'); await tick();
  assert.deepStrictEqual([stored(store).campusId, stored(store).actAs], ['LMS3', 'LMS3']);
  p = page(store, list({ email: 'p4@example.org', campusId: 'LMS4', role: 'Principal' }));
  await p.LMCS.requireSession('#gate'); await tick();
  const back = stored(store);
  assert.deepStrictEqual([back.campusId, back.actAs, back.homeCampusId, back.supporting], ['LMS4', undefined, undefined, undefined], 'charge removed: home again');
  // switching back by hand
  store.lmcs_session = sess({ email: 'p4@example.org', campusId: 'LMS3', actAs: 'LMS3', homeCampusId: 'LMS4', supporting: ['LMS3'], role: 'Principal' });
  p = page(store, list({ email: 'p4@example.org', campusId: 'LMS4', role: 'Principal', supporting: ['LMS3'] }));
  assert.strictEqual(p.LMCS.supportSwitch(null), true);
  assert.deepStrictEqual([stored(store).campusId, stored(store).actAs], ['LMS4', undefined]);
  console.log('session refresh: ok');
})().catch((e) => { console.error(e); process.exit(1); });
