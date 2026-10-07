// Runs assets/auth.js's fetch cache in a sandbox (fake localStorage + fetch).
// Usage: node tests/fetchcache/test-fetchcache.js
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROSTER = 'https://script.google.com/macros/s/AKfycbyHiaZY_iWK2VTKKFJcCsBNnIbUndJYUSjnPkxvJ-dYavaihiul2xBJuJohPRsP9Spf/exec';
const PDR = 'https://script.google.com/macros/s/AKfycbzpkFLy4KvTdSJfioz6wlgRGLjvO_GvbffhOYBb-hHybFtjGTk0ps-GzXz0FrQ9GmYdfg/exec';

function makeEnv(email = 'a@lms.org.in', fetchImpl) {
  const store = {};
  const localStorage = {
    get length() { return Object.keys(store).length; },
    key: (i) => Object.keys(store)[i] || null,
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  if (email) localStorage.setItem('lmcs_session', JSON.stringify({ email, expiresAt: Date.now() + 3600e3, campusId: 'LMS1', role: 'Principal' }));
  const calls = [];
  let nextBody = () => JSON.stringify({ success: true, n: calls.length });
  const ctx = {
    localStorage, URL, Response, console, setTimeout: () => 0, clearTimeout: () => {},
    location: { href: 'https://portal.test/x/', reload() {} },
    document: { readyState: 'loading', getElementById: () => null, addEventListener() {}, hidden: false, body: null },
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    navigator: {},
    fetch: fetchImpl || (async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(nextBody(), { status: 200 });
    }),
  };
  ctx.window = ctx;
  ctx.addEventListener = () => {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../assets/auth.js'), 'utf8'), ctx);
  return { ctx, calls, localStorage, setBody: (f) => { nextBody = f; }, f: (u, i) => ctx.window.fetch(u, i) };
}

(async () => {
  let t;

  // miss -> network, then fresh hit with no network
  t = makeEnv();
  let r = await t.f(ROSTER + '?action=employees&_=1');
  assert.strictEqual((await r.json()).success, true);
  r = await t.f(ROSTER + '?action=employees&_=999'); // different cache-buster, same key
  assert.strictEqual(t.calls.length, 1, 'second call should be served from cache');

  // idToken is not part of the key
  t = makeEnv();
  await t.f(PDR + '?action=ssdashboard&idToken=AAA');
  await t.f(PDR + '?action=ssdashboard&idToken=BBB');
  assert.strictEqual(t.calls.length, 1, 'token rotation must not miss the cache');

  // query params differing -> different entries
  t = makeEnv();
  await t.f(PDR + '?action=principaldrload&campusId=LMS1&date=2026-10-07&idToken=x');
  await t.f(PDR + '?action=principaldrload&campusId=LMS2&date=2026-10-07&idToken=x');
  assert.strictEqual(t.calls.length, 2);

  // non-whitelisted action passes straight through, never cached
  t = makeEnv();
  await t.f(ROSTER + '?action=uploadstatus');
  await t.f(ROSTER + '?action=uploadstatus');
  assert.strictEqual(t.calls.length, 2);

  // failures are not cached
  t = makeEnv();
  t.setBody(() => JSON.stringify({ success: false, error: 'Not authorized' }));
  await t.f(PDR + '?action=approvalslist&idToken=x');
  await t.f(PDR + '?action=approvalslist&idToken=x');
  assert.strictEqual(t.calls.length, 2, '{success:false} must not be cached');

  // no session -> no caching at all
  t = makeEnv(null);
  await t.f(ROSTER + '?action=employees');
  await t.f(ROSTER + '?action=employees');
  assert.strictEqual(t.calls.length, 2);

  // per-user isolation
  t = makeEnv('a@lms.org.in');
  await t.f(ROSTER + '?action=employees');
  t.localStorage.setItem('lmcs_session', JSON.stringify({ email: 'b@lms.org.in', expiresAt: Date.now() + 3600e3 }));
  await t.f(ROSTER + '?action=employees');
  assert.strictEqual(t.calls.length, 2, "another user must not see a's cached data");

  // POST busts that script's entries (and only that script's)
  t = makeEnv();
  await t.f(PDR + '?action=approvalslist&idToken=x');
  await t.f(ROSTER + '?action=employees');
  await t.f(PDR, { method: 'POST', body: '{}' });
  t.calls.length = 0;
  await t.f(PDR + '?action=approvalslist&idToken=x');
  await t.f(ROSTER + '?action=employees');
  assert.strictEqual(t.calls.length, 1, 'PDR entry busted, roster entry kept');
  assert.ok(t.calls[0].url.startsWith(PDR));

  // GET-style write (staff API uses GET for writes) busts the roster script
  t = makeEnv();
  await t.f(ROSTER + '?action=employees');
  await t.f(ROSTER + '?action=markinactive&code=X');
  t.calls.length = 0;
  await t.f(ROSTER + '?action=employees');
  assert.strictEqual(t.calls.length, 1);

  // epoch guard: a read that started before a write must not store pre-write data
  {
    const pending = [];
    const e = makeEnv('a@lms.org.in', (url) => new Promise((res) => pending.push(() => res(new Response(JSON.stringify({ success: true, v: 'pre-write' }))))));
    const slowRead = e.f(PDR + '?action=approvalslist&idToken=x'); // starts, stays pending
    const write = e.f(PDR, { method: 'POST', body: '{}' });        // busts + bumps epoch
    pending[1](); await write;                                      // write completes
    pending[0](); await slowRead;                                   // old read finishes AFTER the write
    const stored = Array.from({ length: e.localStorage.length }, (_, i) => e.localStorage.key(i)).filter((k) => k.startsWith('lmcs_fc|'));
    assert.strictEqual(stored.length, 0, 'pre-write read must not be stored');
  }

  // stale-while-revalidate for roster: serve old instantly, refresh behind
  t = makeEnv();
  await t.f(ROSTER + '?action=employees');
  const key = Object.keys(JSON.parse(JSON.stringify(Object.fromEntries(Array.from({ length: t.localStorage.length }, (_, i) => [t.localStorage.key(i), 1]))))).find((k) => k.startsWith('lmcs_fc|'));
  const entry = JSON.parse(t.localStorage.getItem(key));
  entry.t = Date.now() - 700 * 1000; // older than ttl(600s), inside stale window
  t.localStorage.setItem(key, JSON.stringify(entry));
  t.calls.length = 0;
  const stale = await (await t.f(ROSTER + '?action=employees')).json();
  assert.strictEqual(stale.n, 1, 'stale copy served immediately');
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(t.calls.length, 1, 'background refresh fired');
  // volatile data past ttl is NOT served stale
  await t.f(PDR + '?action=approvalslist&idToken=x');
  const k2 = Array.from({ length: t.localStorage.length }, (_, i) => t.localStorage.key(i)).find((k) => k.includes('approvalslist'));
  const e2 = JSON.parse(t.localStorage.getItem(k2)); e2.t = Date.now() - 61 * 1000; t.localStorage.setItem(k2, JSON.stringify(e2));
  t.calls.length = 0;
  await t.f(PDR + '?action=approvalslist&idToken=x');
  assert.strictEqual(t.calls.length, 1, 'volatile entry past ttl goes to network');

  // in-flight dedupe
  t = makeEnv();
  await Promise.all([t.f(PDR + '?action=hiringapplicants&idToken=x'), t.f(PDR + '?action=hiringapplicants&idToken=x')]);
  assert.strictEqual(t.calls.length, 1, 'concurrent identical requests share one network call');

  // clearCache wipes everything
  t = makeEnv();
  await t.f(ROSTER + '?action=employees');
  t.ctx.window.LMCS.clearCache();
  t.calls.length = 0;
  await t.f(ROSTER + '?action=employees');
  assert.strictEqual(t.calls.length, 1);

  console.log('fetchcache: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
