// Sign-in flow in assets/auth.js with a fake DOM + scripted allowlist backend.
// Usage: node tests/auth/test-signin.js
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '../../assets/auth.js'), 'utf8');

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const cred = (email, verified = true) => ({ credential: b64({ alg: 'x' }) + '.' + b64({ email, email_verified: verified, exp: Math.floor(Date.now() / 1000) + 3600 }) + '.sig' });
const LIST = { success: true, entries: [{ email: 'lalita.kanwar@lms.org.in', name: 'Lalita Kanwar', campusId: 'ALL', role: 'Owner' }] };

// script: array of 'html' | 'hang' | {json} consumed per allowlist fetch
function makePage({ script, store = {} }) {
  const els = {}, calls = { allowlist: 0, reloads: 0 };
  const el = (id) => (els[id] = els[id] || { id, innerHTML: '', textContent: '', onclick: null, style: {} });
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; },
    key: (i) => Object.keys(store)[i] || null, get length() { return Object.keys(store).length; },
  };
  const ctx = {
    localStorage, URL, Response, console: { log() {}, warn() {}, error: console.error }, AbortController,
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 5)), clearTimeout, setInterval, clearInterval,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'), navigator: {}, performance: { getEntriesByType: () => [] },
    location: { href: 'https://portal.test/', reload() { calls.reloads++; } },
    document: {
      readyState: 'loading', hidden: false, body: null, addEventListener() {},
      querySelector: () => el('gate'), getElementById: (id) => el(id), createElement: () => ({}), head: { appendChild() {} },
    },
    fetch: async (url) => {
      if (!String(url).includes('allowlist_list')) return new Response('{"success":true}'); // e.g. the post-sign-in warm-up
      calls.allowlist++;
      const step = script.shift();
      if (step === 'hang') return new Promise(() => {});
      if (step === 'html') return new Response('<!DOCTYPE html><html>error</html>', { status: 200 });
      return new Response(JSON.stringify(step), { status: 200 });
    },
  };
  ctx.window = ctx; ctx.addEventListener = () => {};
  vm.createContext(ctx); vm.runInContext(src, ctx);
  return { ctx, els, calls, store, LMCS: ctx.window.LMCS };
}
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // 1. first live attempt returns an HTML error page, the retry succeeds -> signs in, keeps a copy of the list
  let p = makePage({ script: ['html', LIST] });
  let session = null;
  p.LMCS.requireSession('#gate').then((s) => { session = s; });
  await tick(); // prefetch has already started (and failed once / retried)
  await p.ctx.window.onGoogleSignIn(cred('lalita.kanwar@lms.org.in'));
  assert.ok(session, 'signed in after a retry');
  assert.strictEqual(session.campusId, 'ALL');
  assert.strictEqual(session.role, 'Owner');
  assert.ok(p.store.lmcs_allowlist_v1, 'last good list was saved');
  assert.strictEqual(p.calls.allowlist, 2, 'one failed attempt + one successful retry (prefetch shared with sign-in)');

  // 2. every attempt fails (the prefetch's three, then sign-in's own three) -> honest message + Try again,
  //    never "not on the access list"; clicking Try again signs in once the backend answers
  p = makePage({ script: ['html', 'html', 'html', 'html', 'html', 'html', LIST] });
  session = null;
  p.LMCS.requireSession('#gate').then((s) => { session = s; });
  await tick(100);
  await p.ctx.window.onGoogleSignIn(cred('lalita.kanwar@lms.org.in'));
  const status = p.els['lmcs-auth-status'].innerHTML;
  assert.ok(/Couldn’t reach the access list/.test(status), 'failure message shown');
  assert.ok(!/isn’t on it yet/.test(status), 'a failed check must never claim the person is not on the list');
  assert.ok(!session);
  p.els['lmcs-auth-retry'].onclick();
  await tick(100);
  assert.ok(session, 'Try again signs in once the backend answers');

  // 3. returning user: cached copy lets them in without waiting for the (hanging) live call
  p = makePage({ script: ['hang'], store: { lmcs_allowlist_v1: JSON.stringify({ t: Date.now(), map: { 'lalita.kanwar@lms.org.in': { campusId: 'ALL', name: 'Lalita Kanwar', role: 'Owner' } } }) } });
  session = null;
  p.LMCS.requireSession('#gate').then((s) => { session = s; });
  await p.ctx.window.onGoogleSignIn(cred('lalita.kanwar@lms.org.in'));
  assert.ok(session, 'in immediately from the cached list');

  // 3b. ...and if the live list later shows they were removed, the session is dropped
  p = makePage({ script: [{ success: true, entries: [] }], store: { lmcs_allowlist_v1: JSON.stringify({ t: Date.now(), map: { 'gone@lms.org.in': { campusId: 'LMS1', name: 'Gone', role: 'Principal' } } }) } });
  p.LMCS.requireSession('#gate');
  await p.ctx.window.onGoogleSignIn(cred('gone@lms.org.in'));
  await tick(100);
  assert.strictEqual(p.calls.reloads, 1, 'removed since the copy was taken -> reload to the gate');
  assert.ok(!p.store.lmcs_session, 'session cleared');

  // 4. genuinely not on the list (live answered) -> the denial, no session
  p = makePage({ script: [LIST] });
  session = null;
  p.LMCS.requireSession('#gate').then((s) => { session = s; });
  await p.ctx.window.onGoogleSignIn(cred('stranger@lms.org.in'));
  assert.ok(/isn’t on it yet/.test(p.els['lmcs-auth-status'].innerHTML));
  assert.ok(!session);

  // 5. unverified Google email is never let in, even if the address is on the list
  p = makePage({ script: [LIST] });
  session = null;
  p.LMCS.requireSession('#gate').then((s) => { session = s; });
  await p.ctx.window.onGoogleSignIn(cred('lalita.kanwar@lms.org.in', false));
  assert.ok(!session);

  console.log('signin: all checks passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
