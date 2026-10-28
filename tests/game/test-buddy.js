// node tests/game/test-buddy.js -- Ask Buddy v1 queue (game-buddy.gs): Owner actions, worker pull/reply, rate limits
const fs = require('fs'), vm = require('vm'), assert = require('assert'), crypto = require('crypto');
const dir = __dirname + '/../../apps-script/';
const store = new Map(), props = {}, events = [];
let lockFails = false, opens = 0, uuid = 0;
const book = { tabs: {}, getSheetByName: (n) => book.tabs[n] || null, insertSheet: (n) => (book.tabs[n] = fakeSheet([])) };
function fakeSheet(rows) {
  const sh = {
    rows,
    getDataRange: () => ({ getValues: () => sh.rows.map((r) => r.slice()) }),
    getLastRow: () => sh.rows.length,
    getRange: (row, col) => {
      const rg = { setNumberFormat: () => rg, setValues: (vals) => { vals.forEach((v, i) => { const r = sh.rows[row - 1 + i] = sh.rows[row - 1 + i] || []; v.forEach((x, j) => { r[col - 1 + j] = x; }); }); return rg; } };
      return rg;
    },
  };
  return sh;
}
const ctx = {
  console: { log() {}, error() {} },
  CacheService: { getScriptCache: () => ({ get: (k) => (store.has(k) ? store.get(k) : null), put: (k, v) => { store.set(k, String(v)); }, remove: (k) => { store.delete(k); } }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null) }) },
  SpreadsheetApp: { openById: () => { opens++; return book; } },
  LockService: { getScriptLock: () => ({ waitLock: () => { if (lockFails) throw new Error('lock'); events.push('lock'); }, releaseLock: () => events.push('unlock') }) },
  Utilities: { getUuid: () => { uuid++; return ('0000000' + uuid.toString(16)).slice(-8) + '-AAAA-4BBB-8CCC-DDDDDDDDDDDD'; } },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType: () => ({ body: s }) }) },
};
vm.createContext(ctx);
const load = (f) => vm.runInContext(fs.readFileSync(dir + f, 'utf8'), ctx);
['game.gs', 'game-actions.gs', 'game-missions.gs', 'game-windows.gs', 'game-confirm.gs', 'game-buddy.gs'].forEach(load);
const J = (x) => JSON.parse(JSON.stringify(x));
const T0 = Date.parse('2026-11-10T05:00:00Z'); // 10:30 IST, mid game day
let clock = T0;
ctx.gameNow_ = () => new Date(clock);
const SECRET = crypto.randomBytes(24).toString('hex'); // 48 chars, made per run: never a literal in the repo
const MIN = 60000;
const responses = [];
const R = (x) => { const j = J(x); responses.push(JSON.stringify(j)); return j; };
const mk = (o) => Object.assign({ email: 'owner@test.invalid', campusId: 'ALL', roles: ['Owner'] }, o || {});
const OWN = mk(), OWN2 = mk({ email: 'owner2@test.invalid' }); // a second allowlist row with the Owner role
const as2 = (fn) => { props.BUDDY_OWNER_EMAIL = OWN2.email; try { return fn(); } finally { props.BUDDY_OWNER_EMAIL = OWN.email; } };
const PR = mk({ email: 'p@test.invalid', roles: ['Principal'], campusId: 'LMS4' });
const STAFF = mk({ email: 's@test.invalid', roles: ['Staff'], campusId: 'LMS4' }); // the employee fallback's shape
const ask = (c, text, context) => R(ctx.buddyOwnerAction_(c, 'buddyask', { text: text === undefined ? 'How many campuses?' : text, context }));
const thread = (c) => R(ctx.buddyOwnerAction_(c || OWN, 'buddythread', {}));
const confirm = (c, id, decision) => R(ctx.buddyOwnerAction_(c, 'buddyconfirm', { id, decision: decision || 'confirm' }));
const pull = (secret) => R(ctx.buddyPull_({ secret: secret === undefined ? SECRET : secret }));
const reply = (o) => R(ctx.buddyReply_(Object.assign({ secret: SECRET }, o)));
const inbox = () => (book.tabs['Buddy Inbox'] ? book.tabs['Buddy Inbox'].rows.slice(1) : []);
const kinds = () => inbox().map((r) => r[1]);
const meta = (r) => JSON.parse(r[4]);
const reset = () => {
  book.tabs = {}; store.clear(); events.length = 0; lockFails = false; opens = 0; clock = T0;
  for (const k of Object.keys(props)) delete props[k];
  props.GAME_SHEET_ID = 'GAME_BOOK'; props.BUDDY_WORKER_SECRET = SECRET + '\n'; // a pasted property often carries a newline
  props.BUDDY_OWNER_EMAIL = ' Owner@Test.invalid '; // compared trimmed and case-insensitive
};
// seed rows straight into the tab (ids are valid, times relative to T0)
const seedAsk = (email, atMs, extra) => {
  const id = 'b' + atMs + '-' + crypto.randomBytes(4).toString('hex');
  if (!book.tabs['Buddy Inbox']) book.tabs['Buddy Inbox'] = fakeSheet([ctx.BUDDY_HEADER.slice()]);
  const rows = book.tabs['Buddy Inbox'].rows, iso = new Date(atMs).toISOString();
  rows.push([id, 'ask', email, 'q', '{"context":{}}', iso, email]);
  (extra || []).forEach((k) => rows.push([id, k, '', k === 'reply' ? 'a' : '', k === 'reply' ? '{"route":"claude","proposal":null}' : '{}', iso, 'worker']));
  return id;
};
// ask -> claim -> reply with a proposal; returns the id
// an ask written before Owner orders (no meta.order): its proposal still waits for the Confirm tap
const legacy = (id) => { const r = inbox().filter((x) => x[0] === id && x[1] === 'ask')[0]; r[4] = JSON.stringify({ context: meta(r).context }); return id; };
const answered = (summary) => {
  const id = legacy(ask(OWN, 'Please add a bus stop').id);
  pull();
  assert.strictEqual(reply({ id, kind: 'reply', text: 'I cannot change that.', route: 'claude', proposal: { summary: summary || 'Add a bus stop' } }).success, true);
  return id;
};
const tests = [];
const test = (n, fn) => tests.push([n, fn]);

test('ask: Owner queues a question', () => {
  reset();
  const r = ask(OWN, '  How many campuses?\r\n ', { page: 'owner/kingdom.html' });
  assert.strictEqual(r.success, true, JSON.stringify(r));
  assert.strictEqual(r.state, 'queued'); assert.ok(ctx.buddyIdOk_(r.id), r.id);
  assert.deepStrictEqual(book.tabs['Buddy Inbox'].rows[0], ['Id', 'Kind', 'Email', 'Text', 'Meta', 'At', 'By']);
  const row = inbox()[0];
  assert.deepStrictEqual(row, [r.id, 'ask', 'owner@test.invalid', 'How many campuses?', '{"context":{"page":"owner/kingdom.html"},"order":true}', new Date(T0).toISOString(), 'owner@test.invalid']);
  assert.strictEqual(store.get('buddy_pending'), '1');
  assert.deepStrictEqual(events, ['lock', 'unlock']);
  assert.strictEqual(thread().threads[0].state, 'queued');
});
test('ask: refuses a Principal', () => {
  reset();
  const r = ask(PR);
  assert.strictEqual(r.code, 'BUDDY_OWNER_ONLY'); assert.strictEqual(r.error, 'Ask Buddy is for the Owner for now.');
  assert.strictEqual(thread(PR).code, 'BUDDY_OWNER_ONLY');
  assert.strictEqual(opens, 0); assert.strictEqual(inbox().length, 0); assert.strictEqual(store.has('buddy_pending'), false);
});
test('ask: refuses a fallback Staff caller', () => {
  reset();
  assert.strictEqual(ask(STAFF).code, 'BUDDY_OWNER_ONLY');
  assert.strictEqual(R(ctx.buddyOwnerAction_(null, 'buddyask', { text: 'x' })).code, 'BUDDY_OWNER_ONLY');
  assert.strictEqual(opens, 0); assert.strictEqual(inbox().length, 0);
});
test('ask: empty and too long', () => {
  reset();
  assert.strictEqual(ask(OWN, '   \u0000\n ').code, 'BUDDY_EMPTY');
  assert.strictEqual(ask(OWN, { text: 'x' }).code, 'BUDDY_EMPTY'); // not a string
  assert.strictEqual(ask(OWN, 'x'.repeat(2001)).code, 'BUDDY_TOO_LONG');
  assert.strictEqual(inbox().length, 0);
  assert.strictEqual(ask(OWN, 'x'.repeat(2000)).success, true);
  assert.strictEqual(inbox()[0][3].length, 2000);
});
test('ask: one in flight', () => {
  reset();
  store.set('buddy_hb', String(T0)); // desk open (offline is the superseded case below)
  const a = ask(OWN);
  assert.strictEqual(ask(OWN).code, 'BUDDY_IN_FLIGHT');
  pull();
  assert.strictEqual(ask(OWN).code, 'BUDDY_IN_FLIGHT'); // working counts too
  reply({ id: a.id, kind: 'reply', text: 'Six.', route: 'claude' });
  assert.strictEqual(ask(OWN).success, true);
  assert.strictEqual(kinds().filter((k) => k === 'ask').length, 2);
});
test('ask: hourly and daily caps', () => {
  reset();
  for (let i = 0; i < 20; i++) seedAsk('owner@test.invalid', T0 - 50 * MIN + i * MIN, ['claim', 'reply']);
  assert.strictEqual(ask(OWN).code, 'BUDDY_HOURLY');
  clock = T0 + 11 * MIN; // the oldest is now over an hour old
  assert.strictEqual(ask(OWN).success, true);
  reset();
  for (let i = 0; i < 100; i++) seedAsk('o' + (i % 3) + '@test.invalid', T0 - 5 * 3600000 + i * MIN, ['claim', 'reply']); // from 05:30 IST today
  assert.strictEqual(ask(OWN).code, 'BUDDY_DAILY');
  clock = Date.parse('2026-11-10T22:31:00Z'); // 04:01 IST: a new game day
  assert.strictEqual(ask(OWN).success, true);
});
test('ask: formula text is stored inert', () => {
  reset();
  const r = ask(OWN, '=IMPORTXML("http://x.invalid","//a")');
  assert.strictEqual(inbox()[0][3], '\'=IMPORTXML("http://x.invalid","//a")');
  assert.strictEqual(thread().threads[0].text, '=IMPORTXML("http://x.invalid","//a")');
  const item = pull().items[0];
  assert.strictEqual(item.id, r.id); assert.strictEqual(item.text, '=IMPORTXML("http://x.invalid","//a")');
  reply({ id: r.id, kind: 'reply', text: '- a list line', route: 'claude' });
  assert.strictEqual(inbox()[2][3], "'- a list line");
});
test('ask: context keeps only page and campus', () => {
  reset();
  ask(OWN, 'q1', { page: 'owner/kingdom.html', campus: 'LMS4', evil: 'x' });
  assert.deepStrictEqual(meta(inbox()[0]), { context: { page: 'owner/kingdom.html', campus: 'LMS4' }, order: true });
  assert.deepStrictEqual(J(ctx.buddyContext_({ page: '<script>', campus: 'LMS9' })), {});
  assert.deepStrictEqual(J(ctx.buddyContext_('owner/kingdom.html')), {});
  assert.deepStrictEqual(J(ctx.buddyContext_({ page: 'x'.repeat(81) })), {});
});
test('doGet: buddyask over GET is unknown', () => {
  reset();
  const saved = ctx.gameVerifyCaller_;
  ctx.gameVerifyCaller_ = () => J(OWN);
  try {
    for (const action of ['buddyask', 'buddythread', 'buddyconfirm', 'buddypull', 'buddyreply']) {
      const out = JSON.parse(ctx.doGet({ parameter: { idToken: 't', action, text: 'hello', secret: SECRET } }).body);
      assert.deepStrictEqual(out, { success: false, error: 'Unknown action' }, action);
    }
    assert.strictEqual(inbox().length, 0);
    // the same over POST reaches the queue
    const p = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ action: 'buddyask', idToken: 't', text: 'hello' }) } }).body);
    assert.strictEqual(p.success, true, JSON.stringify(p));
    ctx.gameVerifyCaller_ = () => J(PR);
    const q = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ action: 'buddythread', idToken: 't' }) } }).body);
    assert.strictEqual(q.code, 'BUDDY_OWNER_ONLY');
  } finally { ctx.gameVerifyCaller_ = saved; }
  assert.strictEqual(Object.keys(ctx.GAME_MODULE_ACTIONS).filter((k) => /^buddy/.test(k)).length, 0);
});
test('pull: wrong or missing secret', () => {
  reset();
  ask(OWN);
  for (const s of ['', null, 'nope', SECRET.slice(0, -1), SECRET + 'x', { secret: SECRET }]) {
    assert.deepStrictEqual(pull(s), { success: false, error: 'Not authorized' }, String(s));
  }
  assert.deepStrictEqual(R(ctx.buddyPull_(undefined)), { success: false, error: 'Not authorized' });
  assert.deepStrictEqual(reply({ secret: 'nope', id: 'b1234567890123-abcdef01', kind: 'failed', reason: 'timeout' }), { success: false, error: 'Not authorized' });
  assert.strictEqual(store.has('buddy_hb'), false); // a refused call never marks the desk open
  const ten = SECRET.slice(0, 10);
  props.BUDDY_WORKER_SECRET = ten;
  assert.deepStrictEqual(pull(ten), { success: false, error: 'Not authorized' });
  delete props.BUDDY_WORKER_SECRET;
  assert.deepStrictEqual(pull(''), { success: false, error: 'Not authorized' });
  assert.deepStrictEqual(kinds(), ['ask']);
});
test('pull: no pending flag never opens the workbook', () => {
  reset();
  store.set('buddy_hb', String(T0 - 5000)); // the worker is running (polled 5 s ago)
  opens = 0;
  assert.deepStrictEqual(pull(), { success: true, items: [] });
  assert.strictEqual(opens, 0); assert.deepStrictEqual(events, []);
  assert.strictEqual(store.get('buddy_hb'), String(T0));
});
test('pull: a worker coming back sweeps once', () => {
  reset();
  const a = ask(OWN);
  store.delete('buddy_pending'); // the flag expired while the Mac slept
  clock = T0 + 7 * 3600000;
  assert.strictEqual(pull().items[0].id, a.id); // no heartbeat: look anyway
  clock += 5000; store.delete('buddy_pending'); opens = 0;
  assert.deepStrictEqual(pull().items, []);
  assert.strictEqual(opens, 0);
});
test('pull: claims the oldest ask once', () => {
  reset();
  const a = ask(OWN, 'first');
  clock += MIN;
  const b = as2(() => ask(OWN2, 'second'));
  const r = pull();
  assert.deepStrictEqual(r, { success: true, items: [{ id: a.id, kind: 'ask', text: 'first', context: {}, attempt: 1 }] });
  const claim = inbox()[2];
  assert.strictEqual(claim[1], 'claim'); assert.deepStrictEqual(meta(claim), { attempt: 1 }); assert.strictEqual(claim[6], 'worker');
  assert.strictEqual(pull().items[0].id, b.id);
  opens = 0;
  assert.deepStrictEqual(pull().items, []); // both claimed: nothing more, and the flag waits for a claim to go stale
  assert.strictEqual(opens, 0);
  assert.deepStrictEqual(kinds(), ['ask', 'ask', 'claim', 'claim']);
  assert.strictEqual(thread().threads[0].state, 'working');
});
test('pull: stale claim re-offered once, then gave_up', () => {
  reset();
  const a = ask(OWN);
  assert.strictEqual(pull().items[0].attempt, 1);
  clock += 10 * MIN;
  assert.deepStrictEqual(pull().items, []);
  clock = T0 + 21 * MIN;
  const r = pull().items[0];
  assert.strictEqual(r.id, a.id); assert.strictEqual(r.attempt, 2);
  clock += 21 * MIN;
  assert.deepStrictEqual(pull().items, []);
  const last = inbox()[inbox().length - 1];
  assert.strictEqual(last[1], 'failed'); assert.deepStrictEqual(meta(last), { reason: 'gave_up' });
  const t = thread().threads[0];
  assert.strictEqual(t.state, 'failed'); assert.strictEqual(t.failReason, 'gave_up'); assert.strictEqual(t.attempts, 2);
  assert.strictEqual(store.has('buddy_pending'), false);
  assert.strictEqual(reply({ id: a.id, kind: 'reply', text: 'late', route: 'claude' }).code, 'BUDDY_BAD_STATE');
  assert.strictEqual(ask(OWN).success, true); // no longer in flight
});
test('buddyPullable_: a stale claim with no attempts left is never offered', () => {
  const id = 'b' + T0 + '-0000abcd', at = new Date(T0).toISOString();
  const rows = [ctx.BUDDY_HEADER, [id, 'ask', 'owner@test.invalid', 'q', '{}', at, ''], [id, 'claim', '', '', '{}', at, 'worker']];
  assert.strictEqual(ctx.buddyPullable_(ctx.buddyThreads_(rows, T0), T0 + 10 * MIN), null);
  assert.strictEqual(ctx.buddyPullable_(ctx.buddyThreads_(rows, T0), T0 + 21 * MIN).attempt, 2);
  rows.push([id, 'claim', '', '', '{}', at, 'worker']);
  assert.strictEqual(ctx.buddyPullable_(ctx.buddyThreads_(rows, T0), T0 + 21 * MIN), null);
});
test('reply: answer with proposal', () => {
  reset();
  const id = answered('S'.repeat(400));
  const t = thread().threads[0];
  assert.strictEqual(t.state, 'answered'); assert.strictEqual(t.reply, 'I cannot change that.'); assert.strictEqual(t.route, 'claude');
  assert.strictEqual(t.proposalState, 'open');
  assert.strictEqual(t.proposal.summary.length, 300); assert.ok(t.proposal.summary.endsWith('…'));
  reset();
  const id2 = legacy(ask(OWN).id); pull();
  reply({ id: id2, kind: 'reply', text: 'R'.repeat(9000), route: 'claude', proposal: { summary: '   ' } });
  const t2 = thread().threads[0];
  assert.strictEqual(t2.reply.length, 8000); assert.strictEqual(t2.proposal, null); assert.strictEqual(t2.proposalState, null);
  assert.ok(id);
});
test('reply: refuses wrong state', () => {
  reset();
  const a = ask(OWN).id;
  assert.strictEqual(reply({ id: a, kind: 'reply', text: 'x', route: 'claude' }).code, 'BUDDY_BAD_STATE'); // not claimed
  assert.strictEqual(reply({ id: a, kind: 'forwarded', via: 'telegram' }).code, 'BUDDY_BAD_STATE');
  pull();
  assert.strictEqual(reply({ id: a, kind: 'reply', text: 'x', route: 'shell' }).code, 'BUDDY_BAD_STATE');
  assert.strictEqual(reply({ id: a, kind: 'failed', reason: 'oops' }).code, 'BUDDY_BAD_STATE');
  assert.strictEqual(reply({ id: a, kind: 'delete' }).code, 'BUDDY_BAD_STATE');
  assert.strictEqual(reply({ id: 'b0000000000000-00000000', kind: 'failed', reason: 'timeout' }).code, 'BUDDY_NOT_FOUND');
  assert.strictEqual(reply({ id: '../x', kind: 'failed', reason: 'timeout' }).code, 'BUDDY_NOT_FOUND');
  assert.deepStrictEqual(kinds(), ['ask', 'claim']);
  assert.strictEqual(reply({ id: a, kind: 'failed', reason: 'timeout' }).success, true);
  assert.strictEqual(thread().threads[0].state, 'failed');
  assert.strictEqual(reply({ id: a, kind: 'failed', reason: 'timeout' }).code, 'BUDDY_BAD_STATE'); // once
});
test('order: an Owner ask with a proposal is confirmed at the reply and forwarded once, no tap', () => {
  reset();
  const id = ask(OWN, 'Make this map interactive', { page: 'owner/kingdom.html', campus: 'LMS2' }).id;
  pull();
  store.delete('buddy_pending');
  reply({ id, kind: 'reply', text: 'Here is a plan.', route: 'claude', proposal: { summary: 'Tap a base to open it' } });
  assert.strictEqual(thread().threads[0].proposalState, 'confirmed');
  assert.strictEqual(store.get('buddy_pending'), '1'); // the reply marks pending, so the forward goes at the next poll
  assert.strictEqual(confirm(OWN, id).code, 'BUDDY_PROPOSAL_CLOSED'); // nothing left to tap
  assert.strictEqual(confirm(OWN, id, 'decline').code, 'BUDDY_PROPOSAL_CLOSED');
  assert.deepStrictEqual(pull().items, [{ id, kind: 'forward', text: 'Make this map interactive', summary: 'Tap a base to open it', reply: 'Here is a plan.',
    context: { page: 'owner/kingdom.html', campus: 'LMS2' }, order: true, attempt: 1 }]);
  assert.strictEqual(reply({ id, kind: 'forwarded', via: 'sendmessage' }).success, true);
  assert.strictEqual(thread().threads[0].proposalState, 'forwarded');
  assert.deepStrictEqual(pull().items, []);
  assert.strictEqual(inbox().filter((r) => r[1] === 'fclaim').length, 1);
  assert.strictEqual(inbox().filter((r) => r[1] === 'confirm').length, 0); // no confirm row is invented
  // an answer without a proposal is forwarded too (V1 decides), once, with an empty summary; the dock shows no proposal
  reset();
  const q = ask(OWN, 'How many buses?').id; pull();
  reply({ id: q, kind: 'reply', text: '42', route: 'claude' });
  assert.strictEqual(thread().threads[0].proposal, null); assert.strictEqual(thread().threads[0].proposalState, 'confirmed');
  assert.strictEqual(confirm(OWN, q).code, 'BUDDY_PROPOSAL_CLOSED');
  assert.deepStrictEqual(pull().items, [{ id: q, kind: 'forward', text: 'How many buses?', summary: '', reply: '42', context: {}, order: true, attempt: 1 }]);
  assert.strictEqual(reply({ id: q, kind: 'forwarded', via: 'telegram' }).success, true);
  assert.strictEqual(thread().threads[0].proposalState, 'forwarded');
  assert.deepStrictEqual(pull().items, []);
  // a failed ask (no answer) is not forwarded
  reset();
  const f = ask(OWN, 'x').id; pull(); reply({ id: f, kind: 'failed', reason: 'timeout' });
  assert.strictEqual(thread().threads[0].proposalState, null);
  assert.deepStrictEqual(pull().items, []);
  // only an ask row buddyAsk_ wrote counts: a seeded ask with no order, or order other than true, waits for the tap
  reset();
  const s1 = legacy(ask(OWN, 'old').id), r1 = inbox()[0]; r1[4] = JSON.stringify({ context: {}, order: 'true' });
  pull(); reply({ id: s1, kind: 'reply', text: 'x', route: 'claude', proposal: { summary: 'y' } });
  assert.strictEqual(thread().threads[0].proposalState, 'open');
  assert.deepStrictEqual(pull().items, []);
  // the worker cannot turn an answer into an order: reply meta has no say
  reset();
  const s2 = legacy(ask(OWN, 'old2').id); pull();
  reply({ id: s2, kind: 'reply', text: 'x', route: 'claude', proposal: { summary: 'y' }, order: true });
  assert.strictEqual(thread().threads[0].proposalState, 'open');
});
test('confirm: only own thread, once, within 24 h', () => {
  reset();
  const id = answered();
  assert.strictEqual(as2(() => confirm(OWN2, id)).code, 'BUDDY_NOT_FOUND');
  assert.strictEqual(confirm(OWN, 'nope').code, 'BUDDY_NOT_FOUND');
  assert.strictEqual(confirm(OWN, id, 'maybe').code, 'BUDDY_BAD_STATE');
  assert.strictEqual(confirm(PR, id).code, 'BUDDY_OWNER_ONLY');
  store.delete('buddy_pending');
  assert.deepStrictEqual(confirm(OWN, id), { success: true, proposalState: 'confirmed' });
  assert.strictEqual(store.get('buddy_pending'), '1');
  const row = inbox()[inbox().length - 1];
  assert.deepStrictEqual([row[1], row[2], row[6]], ['confirm', 'owner@test.invalid', 'owner@test.invalid']);
  assert.strictEqual(confirm(OWN, id).code, 'BUDDY_PROPOSAL_CLOSED');
  assert.strictEqual(confirm(OWN, id, 'decline').code, 'BUDDY_PROPOSAL_CLOSED');
  reset();
  const id2 = answered();
  assert.deepStrictEqual(confirm(OWN, id2, 'decline'), { success: true, proposalState: 'declined' });
  assert.strictEqual(confirm(OWN, id2).code, 'BUDDY_PROPOSAL_CLOSED');
  reset();
  const id3 = answered();
  clock += 24 * 3600000 + 1;
  assert.strictEqual(thread().threads[0].proposalState, 'expired');
  assert.strictEqual(confirm(OWN, id3).code, 'BUDDY_PROPOSAL_CLOSED');
  // a reply with no proposal cannot be confirmed
  reset();
  const id4 = legacy(ask(OWN).id); pull(); reply({ id: id4, kind: 'reply', text: 'x', route: 'claude' });
  assert.strictEqual(confirm(OWN, id4).code, 'BUDDY_PROPOSAL_CLOSED');
});
test('pull: confirmed proposal comes back as a forward item', () => {
  reset();
  const id = answered('Add a bus stop');
  clock += MIN;
  ask(OWN, 'next question');
  confirm(OWN, id);
  const r = pull();
  assert.deepStrictEqual(r.items, [{ id, kind: 'forward', text: 'Please add a bus stop', summary: 'Add a bus stop', context: {}, order: false, attempt: 1 }]); // before the queued ask
  assert.strictEqual(reply({ id, kind: 'forwarded', via: 'carrier-pigeon' }).code, 'BUDDY_BAD_STATE');
  assert.strictEqual(reply({ id, kind: 'forwarded', via: 'sendmessage' }).success, true);
  assert.strictEqual(thread().threads[0].proposalState, 'forwarded');
  const next = pull().items[0];
  assert.strictEqual(next.kind, 'ask'); assert.strictEqual(next.text, 'next question');
  assert.strictEqual(reply({ id, kind: 'forwarded', via: 'sendmessage' }).code, 'BUDDY_BAD_STATE');
});
test('forward: fails 3 times, stops being offered, asks are served', () => {
  reset();
  const id = answered('Add a bus stop');
  confirm(OWN, id);
  clock += MIN;
  const a2 = legacy(ask(OWN, 'second').id); // a pre-orders ask: its plain answer does not forward
  assert.deepStrictEqual(pull().items.map((i) => i.kind + i.attempt), ['forward1']);
  assert.strictEqual(pull().items[0].id, a2); // the forward being sent never holds up the queue
  reply({ id: a2, kind: 'reply', text: 'ok', route: 'claude' });
  assert.deepStrictEqual(pull().items, []); // in progress: not offered again
  assert.strictEqual(reply({ id, kind: 'forward_failed' }).success, true);
  assert.strictEqual(reply({ id, kind: 'forward_failed' }).code, 'BUDDY_BAD_STATE'); // one failure per attempt
  assert.deepStrictEqual(pull().items.map((i) => i.kind + i.attempt), ['forward2']);
  reply({ id, kind: 'forward_failed' });
  assert.deepStrictEqual(pull().items.map((i) => i.kind + i.attempt), ['forward3']);
  assert.strictEqual(thread().threads[0].proposalState, 'confirmed');
  clock += 21 * MIN; // the third attempt goes quiet: that is the third failure
  assert.deepStrictEqual(pull().items, []);
  const last = inbox()[inbox().length - 1];
  assert.deepStrictEqual([last[1], meta(last)], ['forward_failed', { reason: 'gave_up' }]);
  const t = thread().threads[0];
  assert.strictEqual(t.proposalState, 'failed');
  assert.strictEqual(t.proposalNote, "Buddy couldn't pass this on. Try again later or send it on Telegram.");
  assert.strictEqual(store.has('buddy_pending'), false);
  const a3 = ask(OWN, 'third').id;
  assert.strictEqual(pull().items[0].id, a3);
  assert.strictEqual(reply({ id, kind: 'forwarded', via: 'sendmessage' }).code, 'BUDDY_BAD_STATE');
  assert.strictEqual(confirm(OWN, id).code, 'BUDDY_PROPOSAL_CLOSED');
  assert.strictEqual(inbox().filter((r) => r[1] === 'fclaim').length, 3);
  // three reported failures settle it at once
  reset();
  const id2 = answered();
  confirm(OWN, id2);
  for (let i = 1; i <= 3; i++) { assert.strictEqual(pull().items[0].attempt, i); reply({ id: id2, kind: 'forward_failed' }); }
  assert.strictEqual(thread().threads[0].proposalState, 'failed');
  assert.deepStrictEqual(pull().items, []);
  // a stale forward claim (worker died mid-send) is re-offered
  reset();
  const id3 = answered();
  confirm(OWN, id3);
  pull();
  clock += 21 * MIN;
  assert.deepStrictEqual(pull().items.map((i) => i.kind + i.attempt), ['forward2']);
});
test('ask: a claim stuck while the worker is gone closes as offline', () => {
  reset();
  const a = ask(OWN).id;
  pull(); // claimed at T0; the heartbeat says T0
  clock = T0 + 12 * MIN; // a long answer: the worker does not poll meanwhile
  assert.strictEqual(ask(OWN).code, 'BUDDY_IN_FLIGHT');
  clock = T0 + 21 * MIN;
  store.set('buddy_hb', String(T0 + 20 * MIN)); // worker alive: the pull re-offers it, the ask does not touch it
  assert.strictEqual(ask(OWN).code, 'BUDDY_IN_FLIGHT');
  store.set('buddy_hb', String(T0)); // worker gone since the claim
  const r = ask(OWN, 'are you there?');
  assert.strictEqual(r.success, true, JSON.stringify(r));
  const t = thread().threads[0];
  assert.strictEqual(t.id, a); assert.strictEqual(t.state, 'failed'); assert.strictEqual(t.failReason, 'offline');
  assert.deepStrictEqual(kinds(), ['ask', 'claim', 'failed', 'ask']);
  assert.strictEqual(inbox()[2][6], 'system');
  assert.strictEqual(reply({ id: a, kind: 'reply', text: 'late', route: 'claude' }).code, 'BUDDY_BAD_STATE');
  store.set('buddy_hb', String(clock)); // desk open again
  assert.strictEqual(ask(OWN).code, 'BUDDY_IN_FLIGHT'); // still one at a time
});
test('ask: desk offline, a new ask replaces the unclaimed queued one', () => {
  reset();
  store.set('buddy_hb', String(T0));
  const a = ask(OWN, 'first').id;
  assert.strictEqual(ask(OWN, 'again').code, 'BUDDY_IN_FLIGHT'); // desk open: one at a time
  clock = T0 + 2 * MIN + 1; // no pull for over 2 minutes
  const r = ask(OWN, 'again');
  assert.strictEqual(r.success, true, JSON.stringify(r));
  const th = thread().threads;
  assert.deepStrictEqual(th.map((t) => t.state + ':' + t.failReason), ['failed:superseded', 'queued:null']);
  assert.deepStrictEqual(kinds(), ['ask', 'failed', 'ask']);
  assert.deepStrictEqual(meta(inbox()[1]), { reason: 'superseded' });
  assert.strictEqual(pull().items[0].text, 'again'); // only the new one is pulled
  assert.strictEqual(reply({ id: a, kind: 'reply', text: 'x', route: 'claude' }).code, 'BUDDY_BAD_STATE');
  // a claimed (working) ask is not superseded while the worker may still be on it
  clock += 3 * MIN;
  assert.strictEqual(ask(OWN).code, 'BUDDY_IN_FLIGHT');
});
test('owner: only BUDDY_OWNER_EMAIL may use Ask Buddy, fail closed', () => {
  reset();
  for (const c of [OWN2, mk({ email: 'OWNER@test.invalid', roles: ['Principal'] })]) {
    assert.strictEqual(ask(c).code, 'BUDDY_OWNER_ONLY');
    assert.strictEqual(thread(c).code, 'BUDDY_OWNER_ONLY');
    assert.strictEqual(confirm(c, 'b' + T0 + '-0000abcd').code, 'BUDDY_OWNER_ONLY');
  }
  assert.strictEqual(opens, 0); assert.strictEqual(inbox().length, 0);
  assert.strictEqual(ask(mk({ email: 'OWNER@TEST.INVALID' })).success, true); // case-insensitive
  delete props.BUDDY_OWNER_EMAIL;
  assert.strictEqual(thread().code, 'BUDDY_OWNER_ONLY');
  assert.strictEqual(thread(mk({ email: '' })).code, 'BUDDY_OWNER_ONLY'); // unset never matches an empty email
  props.BUDDY_OWNER_EMAIL = '  ';
  assert.strictEqual(thread().code, 'BUDDY_OWNER_ONLY');
});
test('forward: a confirmed proposal unsent after 24 h fails with its note', () => {
  reset();
  const id = answered();
  store.set('buddy_hb', String(T0)); // keep the desk open for the asks below
  clock += MIN;
  confirm(OWN, id);
  const decided = clock;
  clock = decided + 24 * 3600000; // exactly 24 h: still open
  store.set('buddy_hb', String(clock - 5000));
  assert.strictEqual(thread().threads[0].proposalState, 'confirmed');
  clock += 1;
  const t = thread().threads[0];
  assert.strictEqual(t.proposalState, 'failed');
  assert.strictEqual(t.proposalNote, "Buddy couldn't pass this on. Try again later or send it on Telegram.");
  store.set('buddy_pending', '1');
  assert.deepStrictEqual(pull().items, []);
  const last = inbox()[inbox().length - 1];
  assert.deepStrictEqual([last[1], meta(last)], ['forward_failed', { reason: 'expired' }]);
  const n = inbox().length;
  store.set('buddy_pending', '1');
  pull();
  assert.strictEqual(inbox().length, n); // recorded once
  assert.strictEqual(reply({ id, kind: 'forwarded', via: 'sendmessage' }).code, 'BUDDY_BAD_STATE');
});
test('thread: only the caller\'s threads, max 20, no email field', () => {
  reset();
  for (let i = 0; i < 22; i++) seedAsk('owner@test.invalid', T0 - 30 * 3600000 + i * MIN, ['claim', 'reply']);
  seedAsk('owner2@test.invalid', T0 - MIN);
  const r = thread();
  assert.strictEqual(r.success, true); assert.strictEqual(r.threads.length, 20);
  const asks = inbox().filter((x) => x[1] === 'ask' && x[2] === 'owner@test.invalid').map((x) => x[0]);
  assert.deepStrictEqual(r.threads.map((t) => t.id), asks.slice(-20)); // newest last
  r.threads.forEach((t) => { assert.strictEqual('email' in t, false); assert.strictEqual(Object.keys(t).some((k) => k[0] === '_'), false); });
  assert.ok(!JSON.stringify(r).includes('@test.invalid'));
  assert.deepStrictEqual(as2(() => thread(OWN2)).threads.length, 1);
  reset();
  opens = 0;
  assert.deepStrictEqual(thread().threads, []); // no tab yet: nothing created
  assert.strictEqual(book.tabs['Buddy Inbox'], undefined); assert.deepStrictEqual(events, []);
});
test('desk: open within 2 minutes of the last pull, closed after', () => {
  reset();
  assert.deepStrictEqual(J(ctx.buddyDesk_(T0)), { open: false, seenAt: null });
  pull();
  assert.deepStrictEqual(J(ctx.buddyDesk_(T0 + 2 * MIN)), { open: true, seenAt: new Date(T0).toISOString() });
  assert.strictEqual(ctx.buddyDesk_(T0 + 2 * MIN + 1).open, false);
  assert.strictEqual(ask(OWN).desk.open, true);
  clock += 3 * MIN;
  assert.strictEqual(thread().desk.open, false);
});
test('lock timeout is BUDDY_BUSY_SERVER', () => {
  reset();
  lockFails = true;
  const r = ask(OWN);
  assert.strictEqual(r.code, 'BUDDY_BUSY_SERVER'); assert.strictEqual(r.error, 'The system was busy. Please try again.');
  store.set('buddy_pending', '1');
  assert.strictEqual(pull().code, 'BUDDY_BUSY_SERVER');
  assert.strictEqual(inbox().length, 0);
});
test('a non-coded error returns a fixed message', () => {
  reset();
  const saved = ctx.gameBook_;
  ctx.gameBook_ = () => { throw new TypeError('detail with ' + SECRET); };
  try {
    const r = ask(OWN);
    assert.deepStrictEqual(r, { success: false, code: 'BUDDY_ERROR', error: 'Something went wrong. Try again.' });
    store.set('buddy_pending', '1');
    assert.strictEqual(pull().code, 'BUDDY_ERROR');
  } finally { ctx.gameBook_ = saved; }
});
test('buddyClean_ and ids', () => {
  assert.strictEqual(ctx.buddyClean_('a\u0007b\tc\r\nd\u007f', 100, false), 'ab\tc\nd');
  assert.strictEqual(ctx.buddyClean_('abcdef', 4, true), 'abc…');
  assert.strictEqual(ctx.buddyCell_('+91'), "'+91"); assert.strictEqual(ctx.buddyCell_('@x'), "'@x"); assert.strictEqual(ctx.buddyCell_('ok'), 'ok');
  assert.ok(/^b\d{13}-[0-9a-f]{8}$/.test(ctx.buddyNewId_(T0)));
  assert.strictEqual(ctx.buddyIdOk_('b123-abc'), false); assert.strictEqual(ctx.buddyIdOk_(12), false);
});
test('responses never contain the secret', () => {
  assert.ok(responses.length > 50, String(responses.length));
  responses.forEach((s) => assert.ok(!s.includes(SECRET), s));
  assert.ok(!fs.readFileSync(dir + 'game-buddy.gs', 'utf8').includes(SECRET));
});

let fail = 0;
for (const [n, fn] of tests) { try { fn(); console.log('ok  ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n  ' + (e.stack || e).split('\n').slice(0, 4).join('\n  ')); } }
if (fail) process.exit(1);
