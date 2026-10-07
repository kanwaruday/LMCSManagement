// Runs assets/auth.js's fetch cache in a sandbox (fake localStorage + fetch).
// Usage: node tests/fetchcache/test-fetchcache.js
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROSTER = 'https://script.google.com/macros/s/AKfycbyHiaZY_iWK2VTKKFJcCsBNnIbUndJYUSjnPkxvJ-dYavaihiul2xBJuJohPRsP9Spf/exec';
const PDR = 'https://script.google.com/macros/s/AKfycbzpkFLy4KvTdSJfioz6wlgRGLjvO_GvbffhOYBb-hHybFtjGTk0ps-GzXz0FrQ9GmYdfg/exec';

function makeEnv(email = 'a@lms.org.in', fetchImpl, opts = {}) {
  const store = opts.store || {};
  const localStorage = {
    get length() { return Object.keys(store).length; },
    key: (i) => Object.keys(store)[i] || null,
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  if (email && !opts.store) localStorage.setItem('lmcs_session', JSON.stringify({ email, expiresAt: Date.now() + 3600e3, campusId: 'LMS1', role: 'Principal' }));
  const calls = [];
  let nextBody = () => JSON.stringify({ success: true, n: calls.length });
  const ctx = {
    localStorage, URL, Response, console, setTimeout: () => 0, clearTimeout: () => {},
    location: { href: 'https://portal.test/x/', reload() {} },
    document: { readyState: 'loading', getElementById: () => null, addEventListener() {}, hidden: false, body: null },
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    navigator: {},
    performance: { getEntriesByType: () => [{ type: opts.navType || 'navigate' }] },
    fetch: fetchImpl || (async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(nextBody(), { status: 200 });
    }),
  };
  ctx.window = ctx;
  ctx.addEventListener = () => {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../assets/auth.js'), 'utf8'), ctx);
  return { ctx, calls, localStorage, store, setBody: (f) => { nextBody = f; }, f: (u, i) => ctx.window.fetch(u, i) };
}

// A second page load in the same browser: fresh JS context, same localStorage.
const nextPage = (t, opts) => makeEnv('a@lms.org.in', undefined, Object.assign({ store: t.store }, opts));

(async () => {
  let t;

  // miss -> network, then fresh hit with no network
  t = makeEnv();
  let r = await t.f(ROSTER + '?action=employees&_=1');
  assert.strictEqual((await r.json()).success, true);
  let t2 = nextPage(t);
  r = await t2.f(ROSTER + '?action=employees&_=999'); // next page, different cache-buster, same key
  assert.strictEqual(t2.calls.length, 0, 'next page load should be served from cache');
  r = await t2.f(ROSTER + '?action=employees&_=1000'); // repeat in the SAME page = a refresh
  assert.strictEqual(t2.calls.length, 1, 'repeat within one page goes to the network');

  // browser reload skips the cache for the first seconds of the page
  t2 = nextPage(t, { navType: 'reload' });
  await t2.f(ROSTER + '?action=employees');
  assert.strictEqual(t2.calls.length, 1, 'reload must fetch fresh');

  // kill switch
  t2 = nextPage(t);
  t2.localStorage.setItem('lmcs_fc_off', '1');
  await t2.f(ROSTER + '?action=employees');
  assert.strictEqual(t2.calls.length, 1, 'lmcs_fc_off disables the cache');
  t2.localStorage.removeItem('lmcs_fc_off');

  // warm-up's own forced fetch always hits the network but is stored for the next real request
  t2 = nextPage(t);
  await t2.f(ROSTER + '?action=employees', { cache: 'reload' });
  assert.strictEqual(t2.calls.length, 1);
  await t2.f(ROSTER + '?action=employees'); // page's first real request afterwards
  assert.strictEqual(t2.calls.length, 1, 'page request after warm-up is served from the warmed cache');

  // idToken is not part of the key
  t = makeEnv();
  await t.f(PDR + '?action=ssdashboard&idToken=AAA');
  t2 = nextPage(t);
  await t2.f(PDR + '?action=ssdashboard&idToken=BBB');
  assert.strictEqual(t2.calls.length, 0, 'token rotation must not miss the cache');

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
  t2 = nextPage(t);
  await t2.f(ROSTER + '?action=employees');
  assert.strictEqual(t2.calls.length, 1, "another user must not see a's cached data");

  // POST busts that script's entries (and only that script's)
  t = makeEnv();
  await t.f(PDR + '?action=approvalslist&idToken=x');
  await t.f(ROSTER + '?action=employees');
  await t.f(PDR, { method: 'POST', body: '{}' });
  t2 = nextPage(t);
  await t2.f(PDR + '?action=approvalslist&idToken=x');
  await t2.f(ROSTER + '?action=employees');
  assert.strictEqual(t2.calls.length, 1, 'PDR entry busted, roster entry kept');
  assert.ok(t2.calls[0].url.startsWith(PDR));

  // GET-style write (staff API uses GET for writes) busts the roster script
  t = makeEnv();
  await t.f(ROSTER + '?action=employees');
  await t.f(ROSTER + '?action=markinactive&code=X');
  t2 = nextPage(t);
  await t2.f(ROSTER + '?action=employees');
  assert.strictEqual(t2.calls.length, 1);

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
  t2 = nextPage(t);
  const stale = await (await t2.f(ROSTER + '?action=employees')).json();
  assert.strictEqual(stale.n, 1, 'stale copy served immediately');
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(t2.calls.length, 1, 'background refresh fired');
  // volatile data past ttl is NOT served stale
  await t.f(PDR + '?action=approvalslist&idToken=x');
  const k2 = Array.from({ length: t.localStorage.length }, (_, i) => t.localStorage.key(i)).find((k) => k.includes('approvalslist'));
  const e2 = JSON.parse(t.localStorage.getItem(k2)); e2.t = Date.now() - 61 * 1000; t.localStorage.setItem(k2, JSON.stringify(e2));
  t2 = nextPage(t);
  await t2.f(PDR + '?action=approvalslist&idToken=x');
  assert.strictEqual(t2.calls.length, 1, 'volatile entry past ttl goes to network');

  // in-flight dedupe
  t = makeEnv();
  await Promise.all([t.f(PDR + '?action=hiringapplicants&idToken=x'), t.f(PDR + '?action=hiringapplicants&idToken=x')]);
  assert.strictEqual(t.calls.length, 1, 'concurrent identical requests share one network call');

  // clearCache wipes everything
  t = makeEnv();
  await t.f(ROSTER + '?action=employees');
  t.ctx.window.LMCS.clearCache();
  t2 = nextPage(t);
  await t2.f(ROSTER + '?action=employees');
  assert.strictEqual(t2.calls.length, 1);

  // coordinator reads are cached too
  const COORD = 'https://script.google.com/macros/s/AKfycbwilcvrgZQga_qo1A-fBTUzKLifrBYIwlPHoWMITmchf5sZOYjKIJ7_4J0TeBF_-6B6/exec';
  t = makeEnv();
  await t.f(COORD + '?action=coordinatortasks&idToken=x');
  t2 = nextPage(t);
  await t2.f(COORD + '?action=coordinatortasks&idToken=y');
  assert.strictEqual(t2.calls.length, 0, 'coordinatortasks served from cache on next page');

  console.log('fetchcache: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
