// node tests/coordinator/test-approvals-open.js -- opening a request draws the detail ONCE (with the recommendation if it arrived in time),
// so the Owner's typing is never wiped and the decide buttons never jump; late or stale answers are ignored.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const tick = () => new Promise(ok => setTimeout(ok, 10));
const REQ = id => ({ id, campusId: 'LMS1', title: 'T ' + id, category: 'Other', urgency: 'Normal', status: 'Pending', description: 'd', requestedBy: 'r@lms.org.in', requestedAt: '2026-10-20T10:00:00Z' });

async function run(getImpl, { canDecide = true, detailGate } = {}) {
  const slots = {}, handlers = {};
  const slot = k => slots[k] || (slots[k] = { writes: [], set innerHTML(v) { this.writes.push(v); }, get innerHTML() { return this.writes[this.writes.length - 1] || ''; } });
  const root = {
    set className(v) {}, set innerHTML(v) {}, contains: () => true,
    addEventListener: (ev, fn) => { handlers[ev] = fn; },
    querySelector: sel => { const m = sel.match(/^\[data-slot="(\w+)"\]$/); return m ? slot(m[1]) : null; },
  };
  const clickRow = id => handlers.click({ target: { closest: s => s === '[data-act]' ? { getAttribute: a => ({ 'data-act': 'row', 'data-id': id })[a] } : null } });
  const gated = {};
  const win = {};
  const sandbox = {
    console, window: win, JSON, Promise, encodeURIComponent, Date, String, Object, Array, alert() {}, confirm() { return true; },
    // the 4 s recommendation timeout runs fast here
    setTimeout: (fn, ms) => setTimeout(fn, ms === 4000 ? 30 : ms), clearTimeout,
    document: { getElementById: () => ({}), createElement: () => ({}), head: { appendChild() {} } },
    LMCS: { getSession: () => ({ email: 'o@lms.org.in', idToken: 't' }) },
    fetch: async url => {
      const body = /approvalslist/.test(url) ? { success: true, canDecide, requests: [REQ('A'), REQ('B')] }
        : /approvaldetail&id=(\w+)/.test(url) ? (detailGate ? await detailGate(url.match(/id=(\w+)/)[1]) : { success: true, canDecide, request: REQ(url.match(/id=(\w+)/)[1]), comments: [] })
        : { success: true, staff: [] };
      return { text: async () => JSON.stringify(body), json: async () => body };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(__dirname + '/../../coordinator/approvals.js', 'utf8'), sandbox);
  win.CoordApprovals.mount(root, getImpl ? { get: getImpl } : {});
  await tick();
  return { slot, clickRow, detailWrites: () => (slots.detail ? slots.detail.writes : []) };
}

(async () => {
  const REC = reason => ({ success: true, decision: { recommendation: { byName: 'Test Coordinator', recommendation: 'Approve', reason, checked: '', at: '2026-10-25T10:00:00Z' } } });
  const defer = () => { let ok; const p = new Promise(r => { ok = r; }); return { p, ok }; };

  // 1. slow recommendation: the detail is drawn once, after both settle, with the block above the decide bar
  let d = defer(), env = await run(() => d.p);
  env.clickRow('A'); await tick();
  const before = env.detailWrites().length; // only the "Loading…" placeholder from renderList, none from toggleRow yet
  d.ok(REC('Quotes compared')); await tick();
  let w = env.detailWrites();
  assert.strictEqual(w.length, before + 1, 'detail drawn exactly once after settle');
  let html = w[w.length - 1];
  assert.ok(html.includes('Test Coordinator recommends Approve: Quotes compared'));
  assert.ok(html.indexOf('Coordinator recommendation') < html.indexOf('data-act="decide"'), 'block above the decide buttons');

  // 2. the recommendation call fails / throws / not authorized: detail still drawn once, without the block
  for (const impl of [() => Promise.reject(new Error('x')), () => { throw new Error('sync'); }, () => Promise.resolve({ success: false, error: 'Not authorized' })]) {
    env = await run(impl); env.clickRow('A'); await tick();
    w = env.detailWrites(); html = w[w.length - 1];
    assert.ok(html.includes('data-act="decide"') && !html.includes('Coordinator recommendation'), 'no block on failure');
  }
  // no ctx.get at all
  env = await run(null); env.clickRow('A'); await tick();
  assert.ok(!env.detailWrites().slice(-1)[0].includes('Coordinator recommendation'));

  // 3. a recommendation that never answers cannot hold the detail longer than the timeout
  env = await run(() => new Promise(() => {})); env.clickRow('A'); await tick(); await new Promise(ok => setTimeout(ok, 60));
  assert.ok(env.detailWrites().slice(-1)[0].includes('data-act="decide"'), 'detail shown after the timeout');

  // 4. not a decider: nothing extra shown even if the call answered
  env = await run(() => Promise.resolve(REC('x')), { canDecide: false }); env.clickRow('A'); await tick();
  assert.ok(!env.detailWrites().slice(-1)[0].includes('Coordinator recommendation'));

  // 5. A -> close -> A again: the first open's late answer must not land on the second
  const d1 = defer(), d2 = defer(), q = [d1, d2];
  env = await run(() => q.shift().p);
  env.clickRow('A'); await tick(); env.clickRow('A'); await tick(); env.clickRow('A'); await tick();
  d2.ok(REC('second')); await tick(); d1.ok(REC('first')); await tick();
  const all = env.detailWrites().join('\n');
  assert.ok(all.includes('second') && !all.includes('first'), 'stale answer dropped');
  console.log('test-approvals-open: ok');
})().catch(e => { console.error(e); process.exit(1); });
