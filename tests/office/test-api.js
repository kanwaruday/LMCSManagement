// Browser-side ES module test (office/js). Standalone: node tests/office/test-api.js. run.js requires every
// test-*.js synchronously for the backend suite, so under require() this file exports a no-op.
'use strict';
const assert = require('assert');
if (require.main !== module) { module.exports = () => {}; return; }
let failed = 0;
const test = async (name, fn) => { try { await fn(); console.log('  ok  -', name); } catch (e) { failed++; console.log('  FAIL -', name, '\n       ', e.message); } };
const done = () => process.exit(failed ? 1 : 0);

(async () => {
  const { createApi } = await import('../../office/js/api.js');
  const res = (body) => ({ text: async () => body });
  const mk = (responses, extra = {}) => {
    const calls = [], delays = [];
    const fetch = async (url, opts) => { calls.push({ url, opts }); const r = responses.shift(); if (r instanceof Error) throw r; return typeof r === 'function' ? r() : r; };
    return { calls, delays, api: createApi({ fetch, getToken: async () => 'tok', backendUrl: 'https://x.test/exec', sleep: async (ms) => { delays.push(ms); }, ...extra }) };
  };
  const ok = res('{"success":true,"v":1}');

  await test('read is GET with action, token and JSON data; write is text/plain POST', async () => {
    const { api, calls } = mk([ok, ok]);
    await api.read('today.get', { campus: 'LMS1' });
    const u = new URL(calls[0].url);
    assert.strictEqual(u.searchParams.get('action'), 'today.get');
    assert.strictEqual(u.searchParams.get('idToken'), 'tok');
    assert.deepStrictEqual(JSON.parse(u.searchParams.get('data')), { campus: 'LMS1' });
    await api.write('daybook.add', { id: 'a' });
    assert.strictEqual(calls[1].opts.method, 'POST');
    assert.match(calls[1].opts.headers['Content-Type'], /^text\/plain/);
    assert.deepStrictEqual(JSON.parse(calls[1].opts.body), { action: 'daybook.add', idToken: 'tok', data: { id: 'a' } });
  });
  await test('HTML response is retried', async () => {
    const { api, calls, delays } = mk([res('<html>Error</html>'), res('<html>Error</html>'), ok]);
    assert.strictEqual((await api.write('a', {})).success, true);
    assert.strictEqual(calls.length, 3);
    assert.deepStrictEqual(delays, [1000, 2000]);
  });
  await test('network errors give up after 4 retries with 1,2,4,8s back-off', async () => {
    const { api, calls, delays } = mk(Array(9).fill(new Error('offline')));
    const r = await api.read('a', {});
    assert.deepStrictEqual([r.success, r.network], [false, true]);
    assert.strictEqual(calls.length, 5);
    assert.deepStrictEqual(delays, [1000, 2000, 4000, 8000]);
  });
  await test('token expiry error is surfaced, not retried', async () => {
    const { api, calls } = mk([res('{"success":false,"error":"Not authorized"}')]);
    const r = await api.read('a', {});
    assert.deepStrictEqual([r.success, r.error], [false, 'Not authorized']);
    assert.strictEqual(calls.length, 1);
  });
  await test('getToken rejection maps to AUTH without fetching or retrying', async () => {
    const { api, calls, delays } = mk([ok], { getToken: async () => { throw new Error('no session'); } });
    const r = await api.write('a', {});
    assert.deepStrictEqual([r.success, r.code], [false, 'AUTH']);
    assert.deepStrictEqual([calls.length, delays.length], [0, 0]);
  });
  await test('failed response surfaces its code without retry', async () => {
    const { api, calls } = mk([res('{"success":false,"error":"closed","code":"DAY_CLOSED"}')]);
    assert.strictEqual((await api.write('a', {})).code, 'DAY_CLOSED');
    assert.strictEqual(calls.length, 1);
  });
  await test('older response does not overwrite newer', async () => {
    let release;
    const slow = () => new Promise((r) => { release = () => r(res('{"success":true,"v":"old"}')); });
    const { api } = mk([slow, res('{"success":true,"v":"new"}')]);
    const first = api.read('today.get', {}, 'today');
    const second = await api.read('today.get', {}, 'today');
    assert.strictEqual(second.v, 'new');
    release();
    assert.deepStrictEqual(await first, { stale: true });
  });
  done();
})();
