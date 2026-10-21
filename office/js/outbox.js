// Offline-safe write queue. An entry is persisted before any network call and removed only when the
// backend accepts it (success, including duplicate). Status: 'waiting' (will be sent) or 'attention'
// (backend refused it, e.g. DAY_CLOSED; kept until retry() or an explicit discard()).
// Flush is strictly FIFO (R7): a network failure stops it; an attention entry does not block later ones.
// Each entry carries `owner`, the email of the session that queued it (R38): only that person's session sends,
// retries or discards it, so created_by and the audit trail stay right on a shared PC. `who` returns the current
// session email (null when signed out: nothing is sent). An entry without an owner goes with whoever is signed in.
// Without a `who` option every entry counts as the current user's.
import { isAuthFailure } from './api.js';

export function createOutbox({ store, api, newId = () => crypto.randomUUID(), onChange = () => {}, who = null }) {
  let running = null, dirty = false, chain = Promise.resolve(), seq = null;
  const me = () => (who ? who() : null);
  const owned = (e) => !who || (me() !== null && (!e.owner || e.owner === me()));
  const sorted = async () => (await store.getAll()).sort((a, b) => a.seq - b.seq);
  const counts = async () => {
    const all = await store.getAll(), mine = all.filter(owned);
    return { waiting: mine.filter((e) => e.status === 'waiting').length, attention: mine.filter((e) => e.status === 'attention').length, ...(who ? { others: all.length - mine.length } : {}) };
  };
  const notify = async (extra) => onChange({ ...(await counts()), ...extra });

  async function run() {
    let authRequired = false;
    for (const e of await sorted()) {
      if (e.status !== 'waiting' || !owned(e)) continue;
      const r = await api.write(e.action, { ...e.data, id: e.id });
      if (r && r.success === true) { await store.delete(e.id); continue; }
      if (isAuthFailure(r)) { authRequired = true; break; }
      if (!r || r.network || !(r.code || r.error)) break; // retryable: later entries wait
      await store.put({ ...e, status: 'attention', code: r.code || null, error: r.error || r.code });
    }
    await notify(authRequired ? { authRequired: true } : undefined);
  }

  // A flush requested during a run marks it dirty; the run loops (re-reading the store) until clean.
  const flush = () => {
    if (running) { dirty = true; return running; }
    return (running = (async () => { do { dirty = false; await run(); } while (dirty); })().finally(() => { running = null; }));
  };
  return {
    // Serialised so concurrent enqueues get distinct, ordered seq numbers (counter seeded from the store).
    enqueue(action, data) {
      const job = chain.then(async () => {
        if (seq === null) seq = Math.max(0, ...(await store.getAll()).map((e) => e.seq));
        const id = newId();
        await store.put({ id, seq: ++seq, action, data, status: 'waiting', code: null, error: null, owner: me() });
        await notify();
        return id;
      });
      chain = job.catch(() => {});
      return job;
    },
    flush,
    counts,
    entries: sorted, // every queued entry (waiting and attention, any owner), oldest first, for screens that show unsynced work
    attention: async () => (await sorted()).filter((e) => e.status === 'attention' && owned(e)),
    others: async () => (await sorted()).filter((e) => !owned(e)), // queued by someone else on this device
    owned,
    async retry(id) {
      const e = (await store.getAll()).find((x) => x.id === id);
      if (e && owned(e)) await store.put({ ...e, status: 'waiting', code: null, error: null });
      return flush();
    },
    async discard(id) {
      const e = (await store.getAll()).find((x) => x.id === id);
      if (e && owned(e)) await store.delete(id);
      await notify();
    },
  };
}
