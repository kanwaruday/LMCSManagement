// Browser-side ES module test (office/js). Standalone: node tests/office/test-outbox.js. run.js requires every
// test-*.js synchronously for the backend suite, so under require() this file exports a no-op.
'use strict';
const assert = require('assert');
if (require.main !== module) { module.exports = () => {}; return; }
let failed = 0;
const test = async (name, fn) => { try { await fn(); console.log('  ok  -', name); } catch (e) { failed++; console.log('  FAIL -', name, '\n       ', e.message); } };
const done = () => process.exit(failed ? 1 : 0);

(async () => {
  const { createOutbox } = await import('../../office/js/outbox.js');
  const memStore = () => { const m = new Map(); return { m, put: async (e) => { m.set(e.id, JSON.parse(JSON.stringify(e))); }, getAll: async () => [...m.values()].map((e) => ({ ...e })), delete: async (id) => { m.delete(id); } }; };
  // Fake server: accepts each id once (duplicate otherwise); `script` can override per call.
  const mkApi = (script = () => null) => {
    const sent = [], seen = new Set();
    return { sent, seen, write: async (action, data) => {
      sent.push({ action, id: data.id });
      const o = script(action, data, sent.length); if (o) return o;
      const dup = seen.has(data.id); seen.add(data.id);
      return dup ? { success: true, duplicate: true } : { success: true };
    } };
  };
  const mk = (api, store = memStore()) => {
    let n = 0; const changes = [];
    return { store, changes, ob: createOutbox({ store, api, newId: () => 'id' + (++n), onChange: (c) => changes.push(c) }) };
  };
  const NET = { success: false, network: true, error: 'offline' };
  const CLOSED = { success: false, error: 'Day closed', code: 'DAY_CLOSED' };

  await test('enqueue persists before network', async () => {
    const api = mkApi(); const { ob, store } = mk(api);
    const id = await ob.enqueue('daybook.add', { amount_paise: 100 });
    assert.strictEqual(id, 'id1');
    assert.strictEqual(api.sent.length, 0);
    assert.strictEqual((await store.getAll())[0].data.amount_paise, 100);
  });
  await test('success deletes the entry and sends data plus id', async () => {
    const api = mkApi(); const { ob, store } = mk(api);
    await ob.enqueue('a', {}); await ob.flush();
    assert.strictEqual((await store.getAll()).length, 0);
    assert.deepStrictEqual(api.sent, [{ action: 'a', id: 'id1' }]);
  });
  await test('retry after network error sends the same id once', async () => {
    const api = mkApi((a, d, n) => (n === 1 ? NET : null)); const { ob, store } = mk(api);
    await ob.enqueue('a', {});
    await ob.flush();
    assert.deepStrictEqual(await ob.counts(), { waiting: 1, attention: 0 });
    await ob.flush();
    assert.deepStrictEqual(api.sent.map((s) => s.id), ['id1', 'id1']);
    assert.strictEqual(api.seen.size, 1);
    assert.strictEqual((await store.getAll()).length, 0);
  });
  await test('double flush sends once', async () => {
    const api = mkApi(); const { ob } = mk(api);
    await ob.enqueue('a', {});
    const p1 = ob.flush(), p2 = ob.flush();
    assert.strictEqual(p1, p2);
    await Promise.all([p1, p2]);
    assert.strictEqual(api.sent.length, 1);
  });
  await test('FIFO: network failure stops the flush, later entries wait', async () => {
    const api = mkApi((a, d, n) => (n === 1 ? NET : null)); const { ob } = mk(api);
    await ob.enqueue('file.upload', {}); await ob.enqueue('deposit.add', {});
    await ob.flush();
    assert.deepStrictEqual(api.sent.map((s) => s.action), ['file.upload']);
    await ob.flush();
    assert.deepStrictEqual(api.sent.map((s) => s.action), ['file.upload', 'file.upload', 'deposit.add']);
  });
  await test('DAY_CLOSED moves to attention, does not block later entries, and stays after reload', async () => {
    const api = mkApi((a) => (a === 'old' ? CLOSED : null)); const { ob, store } = mk(api);
    await ob.enqueue('old', {}); await ob.enqueue('next', {});
    await ob.flush();
    assert.deepStrictEqual(api.sent.map((s) => s.action), ['old', 'next']);
    assert.deepStrictEqual(await ob.counts(), { waiting: 0, attention: 1 });
    const reloaded = mk(mkApi(), store).ob; // new outbox over the same store
    const att = await reloaded.attention();
    assert.deepStrictEqual([att.length, att[0].code, att[0].action], [1, 'DAY_CLOSED', 'old']);
    await reloaded.flush();
    assert.strictEqual((await store.getAll()).length, 1);
  });
  await test('auth failure stops the flush, keeps the entry waiting and signals authRequired', async () => {
    const api = mkApi(() => ({ success: false, error: 'Not authorized' })); const { ob, changes } = mk(api);
    await ob.enqueue('a', {}); await ob.enqueue('b', {});
    await ob.flush();
    assert.strictEqual(api.sent.length, 1);
    assert.deepStrictEqual(await ob.counts(), { waiting: 2, attention: 0 });
    assert.strictEqual(changes[changes.length - 1].authRequired, true);
  });
  await test('discard needs an explicit call; retry re-queues and sends', async () => {
    let closed = true; const api = mkApi(() => (closed ? CLOSED : null)); const { ob } = mk(api);
    const id = await ob.enqueue('a', {}); await ob.flush(); await ob.flush();
    assert.strictEqual((await ob.attention()).length, 1); // survives repeated flushes
    closed = false; await ob.retry(id);
    assert.deepStrictEqual(await ob.counts(), { waiting: 0, attention: 0 });
    const id2 = await ob.enqueue('b', {}); closed = true; await ob.flush();
    await ob.discard(id2);
    assert.deepStrictEqual(await ob.counts(), { waiting: 0, attention: 0 });
  });
  await test('counts reflect waiting and attention; onChange reports them', async () => {
    const api = mkApi((a) => (a === 'bad' ? CLOSED : null)); const { ob, changes } = mk(api);
    await ob.enqueue('bad', {}); await ob.enqueue('ok', {});
    assert.deepStrictEqual(await ob.counts(), { waiting: 2, attention: 0 });
    await ob.flush();
    assert.deepStrictEqual(changes[changes.length - 1], { waiting: 0, attention: 1 });
  });
  await test('enqueue + flush during a running flush is still sent (no lost wake-up)', async () => {
    let release; const gate = new Promise((r) => { release = r; });
    const api = mkApi(); const real = api.write;
    api.write = async (a, d) => { if (a === 'slow') await gate; return real(a, d); };
    const { ob } = mk(api);
    await ob.enqueue('slow', {});
    const first = ob.flush();
    await ob.enqueue('late', {});
    const second = ob.flush();
    release();
    await Promise.all([first, second]);
    assert.deepStrictEqual(api.sent.map((s) => s.action), ['slow', 'late']);
    assert.deepStrictEqual(await ob.counts(), { waiting: 0, attention: 0 });
  });
  await test('concurrent enqueues keep call order (FIFO)', async () => {
    const api = mkApi(); const { ob } = mk(api);
    await Promise.all([ob.enqueue('file.upload', {}), ob.enqueue('deposit.add', {}), ob.enqueue('third', {})]);
    await ob.flush();
    assert.deepStrictEqual(api.sent.map((s) => s.action), ['file.upload', 'deposit.add', 'third']);
  });
  await test('AUTH code from api raises authRequired', async () => {
    const api = mkApi(() => ({ success: false, code: 'AUTH', error: 'x' })); const { ob, changes } = mk(api);
    await ob.enqueue('a', {}); await ob.flush();
    assert.strictEqual(changes[changes.length - 1].authRequired, true);
    assert.strictEqual((await ob.counts()).waiting, 1);
  });
  // I4 / R38: entries belong to the person who queued them; only that person's session sends them.
  await test('entries carry their author; flush sends only the signed-in user\'s, others wait for them', async () => {
    const api = mkApi(); let me = 'a@example.org'; const store = memStore();
    const ob = createOutbox({ store, api, newId: (() => { let n = 0; return () => 'id' + (++n); })(), who: () => me });
    await ob.enqueue('x', { n: 1 }); me = 'b@example.org'; await ob.enqueue('y', { n: 2 });
    assert.deepStrictEqual((await store.getAll()).map((e) => e.owner), ['a@example.org', 'b@example.org']);
    await ob.flush();
    assert.deepStrictEqual(api.sent.map((s) => s.action), ['y'], 'b does not send a\'s entry');
    assert.deepStrictEqual(await ob.counts(), { waiting: 0, attention: 0, others: 1 });
    assert.deepStrictEqual((await ob.others()).map((e) => [e.action, e.owner]), [['x', 'a@example.org']]);
    await ob.retry('id1'); await ob.discard('id1');
    assert.strictEqual((await store.getAll()).length, 1, 'b can neither retry nor discard a\'s entry');
    me = 'a@example.org'; await ob.flush();
    assert.deepStrictEqual(api.sent.map((s) => s.action), ['y', 'x']);
    assert.deepStrictEqual(await ob.counts(), { waiting: 0, attention: 0, others: 0 });
  });
  await test('without a session nothing is sent', async () => {
    const api = mkApi(); let me = null; const store = memStore();
    const ob = createOutbox({ store, api, who: () => me });
    await ob.enqueue('x', {});
    await ob.flush();
    assert.strictEqual(api.sent.length, 0);
    me = 'a@example.org'; await ob.flush();
    assert.deepStrictEqual(api.sent.map((s) => s.action), [], 'an entry queued with no user belongs to nobody');
  });
  // R42: an ownerless entry is never sent under whoever is signed in; Retry by the signed-in user claims it.
  await test('an ownerless entry is not sent by flush; it shows as another\'s until Retry claims it or Discard drops it', async () => {
    const api = mkApi(); const store = memStore();
    await store.put({ id: 'old', seq: 1, action: 'legacy', data: {}, status: 'waiting', code: null, error: null, owner: null });
    await store.put({ id: 'old2', seq: 2, action: 'legacy2', data: {}, status: 'waiting', code: null, error: null });
    const ob = createOutbox({ store, api, who: () => 'a@example.org' });
    await ob.enqueue('x', {});
    await ob.flush();
    assert.deepStrictEqual(api.sent.map((s) => s.action), ['x']);
    assert.deepStrictEqual(await ob.counts(), { waiting: 0, attention: 0, others: 2 });
    assert.deepStrictEqual((await ob.others()).map((e) => e.id), ['old', 'old2']);
    await ob.retry('old');
    assert.deepStrictEqual(api.sent.map((s) => s.action), ['x', 'legacy'], 'Retry sends it as the signed-in user');
    await ob.discard('old2');
    assert.deepStrictEqual(await store.getAll(), []);
  });
  await test('a claimed ownerless entry that is refused again stays with the claimer', async () => {
    const api = mkApi(() => CLOSED); const store = memStore();
    await store.put({ id: 'old', seq: 1, action: 'legacy', data: {}, status: 'attention', code: 'DAY_CLOSED', error: 'x', owner: null });
    const ob = createOutbox({ store, api, who: () => 'a@example.org' });
    await ob.retry('old');
    assert.deepStrictEqual((await store.getAll()).map((e) => [e.owner, e.status]), [['a@example.org', 'attention']]);
    assert.deepStrictEqual(await ob.counts(), { waiting: 0, attention: 1, others: 0 });
  });
  done();
})();
