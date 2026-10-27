// node tests/game/test-kingdom-assign.js -- the Kingdom's writes kingdomassign and kingdomallocate (game-kingdom.gs), the owner-aware
// setup missions (game-confirm.gs) and the Owner's tier assignees. Synthetic data only; the Coordinator backend is a stubbed UrlFetchApp.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const dir = __dirname + '/../../apps-script/';
const store = new Map(), events = [], warns = [], logs = [];
let lockFails = false, fetches = [], fetchReply = null;
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
const book = { tabs: {}, getSheetByName: (n) => book.tabs[n] || null, insertSheet: (n) => (book.tabs[n] = fakeSheet([])) };
const ALLOW = [['email', 'name', 'campus', 'roles', 'canDecide'],
  ['owner@example.org', 'Owner One', 'ALL', 'Owner', 'TRUE'],
  ['p4@example.org', 'Principal Four', 'LMS4', 'Principal', ''],
  ['p3@example.org', 'Principal Three', 'LMS3', 'Principal', ''],
  ['c1@example.org', 'Coordinator One', 'LMS1', 'Coordinator', 'TRUE'],
  ['t4@example.org', 'Teacher Four', 'LMS4', 'Teacher', '']];
const allowBook = { getSheets: () => [fakeSheet(ALLOW)] };
const ctx = {
  console: { log: (m) => logs.push(String(m)), error: (m) => logs.push(String(m)), warn: (m) => warns.push(String(m)) },
  CacheService: { getScriptCache: () => ({ get: (k) => (store.has(k) ? store.get(k) : null), put: (k, v) => { store.set(k, String(v)); }, remove: (k) => { store.delete(k); } }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === 'GAME_SHEET_ID' ? 'GAME_BOOK' : null) }) },
  LockService: { getScriptLock: () => ({ waitLock: () => { if (lockFails) throw new Error('lock'); events.push('lock'); }, releaseLock: () => events.push('unlock') }) },
  UrlFetchApp: { fetch: (url, opts) => {
    events.push('fetch');
    fetches.push({ url, opts });
    if (fetchReply === 'throw') throw new Error('network down');
    if (fetchReply === 'http500') return { getResponseCode: () => 500, getContentText: () => '<html>' };
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify(fetchReply) };
  } },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType: () => ({ body: s }) }) },
};
vm.createContext(ctx);
['game.gs', 'game-actions.gs', 'game-missions.gs', 'game-confirm.gs', 'game-office.gs', 'game-buddy.gs', 'game-kingdom.gs'].forEach((f) => vm.runInContext(fs.readFileSync(dir + f, 'utf8'), ctx));
ctx.SpreadsheetApp = { openById: (id) => (id === vm.runInContext('GAME_ALLOWLIST_SHEET_ID', ctx) ? allowBook : book) };
const J = (x) => JSON.parse(JSON.stringify(x));
const NOW = new Date('2026-10-29T05:00:00Z');
ctx.gameNow_ = () => NOW;
ctx.daybookProgress_ = () => null;
ctx.cqDefaults_ = () => ({}); // test definitions only (as test-confirm.js does)
const f = (id) => ({ id, label: id, type: 'text', required: true });
const DEFS = {
  tc: { title: 'Campus step', task: 'Do the campus step', scope: 'campus', roles: ['Principal'], fields: [f('name')], prefill: 'test.one' },
  tn: { title: 'Network step', task: 'Do the network step', scope: 'network', roles: ['Coordinator'], fields: [f('name')], prefill: 'test.one' },
  toff: { title: 'Off', scope: 'campus', roles: ['Principal'], fields: [f('name')], active: false },
  tself: { title: 'Mine', scope: 'self', roles: ['Teacher'], fields: [f('name')] },
};
const KINGDOM = { buildings: [{ id: 'hall', name: 'Hall', where: 'campus', tiers: [{ label: 'Campus step', refs: ['cq:tc'], owners: ['tc'] }] },
  { id: 'post', name: 'Post', where: 'darbar', tiers: [{ label: 'Network step', refs: ['cq:tn'], owners: ['tn'] }] }] };
const reset = (cfgExtra) => {
  const cfg = Object.assign({ confirmQuests: DEFS, kingdom: KINGDOM }, cfgExtra || {});
  book.tabs = { 'Game Config': fakeSheet([['Key', 'Value']].concat(Object.keys(cfg).map((k) => [k, JSON.stringify(cfg[k])]))) };
  events.length = 0; warns.length = 0; logs.length = 0; fetches = []; fetchReply = null; lockFails = false; ctx.CQ_MEMO = null;
  ctx.CQ_PREFILL['test.one'] = () => [{ item: 'a', fields: { name: 'Sample' } }];
};
const mk = (o) => Object.assign({ campusId: 'ALL', idToken: 'tok-' + o.email.split('@')[0] }, o);
const OWN = mk({ email: 'owner@example.org', roles: ['Owner'], primaryRole: 'Owner' });
const COORD = mk({ email: 'c1@example.org', roles: ['Coordinator'], primaryRole: 'Coordinator', campusId: 'LMS1' });
const P4 = mk({ email: 'p4@example.org', roles: ['Principal'], primaryRole: 'Principal', campusId: 'LMS4' });
const P3 = mk({ email: 'p3@example.org', roles: ['Principal'], primaryRole: 'Principal', campusId: 'LMS3' });
const assign = (c, b) => J(ctx.kingdomAssign_(c, b));
const allocate = (c, b) => J(ctx.kingdomAllocate_(c, b));
const rows = (tab) => (book.tabs[tab] ? book.tabs[tab].rows.slice(1) : []);
const setup = () => rows('Setup Data');
const audit = () => rows('Game Allocations');
const H = J(vm.runInContext('KINGDOM_ALLOC_HEADER', ctx));
const col = (r, name) => r[H.indexOf(name)];
const tests = [];
const test = (n, fn) => tests.push([n, fn]);

test('assign: refuses a Coordinator without the right', () => {
  reset();
  const r = assign(COORD, { quest: 'tn', campus: '', assignee: 'c1@example.org' });
  assert.deepStrictEqual(r, { success: false, code: 'KINGDOM_NO_RIGHT', error: 'Only the Owner can assign work for now.' });
  assert.strictEqual(setup().length, 0); assert.strictEqual(audit().length, 0);
  assert.strictEqual(warns.length, 1);
  assert.strictEqual(allocate(P4, { approvalId: 'a1', assignee: 'c1@example.org', due: '2026-11-05' }).code, 'KINGDOM_NO_RIGHT');
  assert.strictEqual(fetches.length, 0);
});
test('assign: ignores a non-Owner entry in rights.emails', () => {
  reset({ kingdom: Object.assign({ rights: { allocate: { roles: ['Owner', 'Coordinator'], emails: ['c1@example.org'] } } }, KINGDOM) });
  assert.strictEqual(assign(COORD, { quest: 'tn', campus: '', assignee: 'c1@example.org' }).code, 'KINGDOM_NO_RIGHT');
  assert.strictEqual(allocate(COORD, { approvalId: 'a1', assignee: 'c1@example.org', due: '2026-11-05' }).code, 'KINGDOM_NO_RIGHT');
  assert.strictEqual(setup().length + audit().length + fetches.length, 0);
  // and an Owner whom the rights list does not name is refused too
  reset({ kingdom: Object.assign({ rights: { allocate: { roles: ['Coordinator'], emails: [] } } }, KINGDOM) });
  assert.strictEqual(assign(OWN, { quest: 'tc', campus: 'LMS4', assignee: 'p4@example.org' }).code, 'KINGDOM_NO_RIGHT');
});
test('assign: unknown, inactive or self quest -> KINGDOM_BAD_QUEST', () => {
  reset();
  for (const quest of ['nope', 'toff', 'tself', '', undefined, { x: 1 }]) {
    assert.strictEqual(assign(OWN, { quest, campus: 'LMS4', assignee: 'p4@example.org' }).code, 'KINGDOM_BAD_QUEST', String(quest));
  }
  assert.strictEqual(setup().length, 0);
  assert.strictEqual(audit().length, 6, 'each refusal after the rights check is audited');
  assert.ok(audit().every((r) => col(r, 'Result') === 'refused' && col(r, 'Code') === 'KINGDOM_BAD_QUEST' && col(r, 'Phase') === 'done'));
});
test('assign: campus not in the quest -> KINGDOM_BAD_CAMPUS; network quest with a campus -> KINGDOM_BAD_CAMPUS', () => {
  reset();
  assert.strictEqual(assign(OWN, { quest: 'tc', campus: 'HES', assignee: 'p4@example.org' }).code, 'KINGDOM_BAD_CAMPUS');
  assert.strictEqual(assign(OWN, { quest: 'tc', campus: '', assignee: 'p4@example.org' }).code, 'KINGDOM_BAD_CAMPUS');
  assert.strictEqual(assign(OWN, { quest: 'tc', campus: 'LMS9', assignee: 'p4@example.org' }).code, 'KINGDOM_BAD_CAMPUS');
  assert.strictEqual(assign(OWN, { quest: 'tn', campus: 'LMS1', assignee: 'c1@example.org' }).code, 'KINGDOM_BAD_CAMPUS');
  assert.strictEqual(setup().length, 0);
  assert.strictEqual(audit().length, 4);
});
test('assign: eligibility', () => {
  reset();
  assert.strictEqual(assign(OWN, { quest: 'tc', campus: 'LMS4', assignee: 't4@example.org' }).code, 'KINGDOM_NOT_ELIGIBLE', 'Teacher: wrong role');
  assert.strictEqual(assign(OWN, { quest: 'tc', campus: 'LMS4', assignee: 'p3@example.org' }).code, 'KINGDOM_NOT_ELIGIBLE', 'Principal of another school');
  assert.strictEqual(assign(OWN, { quest: 'tc', campus: 'LMS4', assignee: 'stranger@example.org' }).code, 'KINGDOM_NOT_ELIGIBLE', 'not on the allowlist');
  assert.strictEqual(assign(OWN, { quest: 'tc', campus: 'LMS4', assignee: ['p4@example.org'] }).code, 'KINGDOM_BAD_INPUT');
  assert.strictEqual(setup().length, 0);
  const ok = assign(OWN, { quest: 'tc', campus: 'lms4', assignee: ' P4@Example.org ' });
  assert.deepStrictEqual(ok, { success: true, owner: { email: 'p4@example.org', name: 'Principal Four' } });
  assert.deepStrictEqual(assign(OWN, { quest: 'tn', campus: '', assignee: 'c1@example.org' }).owner, { email: 'c1@example.org', name: 'Coordinator One' }, 'any Coordinator for a network quest');
  // the pure helpers
  const allow = ALLOW.slice(1), defs = J(ctx.cqDefs_({ confirmQuests: DEFS }, false));
  const tc = defs.find((d) => d.id === 'tc'), tn = defs.find((d) => d.id === 'tn');
  assert.deepStrictEqual(J(ctx.kingdomAssignees_(allow, tc, 'LMS4', {})).map((p) => p.email), ['p4@example.org']);
  assert.deepStrictEqual(J(ctx.kingdomAssignees_(allow, tc, 'LMS3', {})).map((p) => p.email), ['p3@example.org']);
  assert.deepStrictEqual(J(ctx.kingdomAssignees_(allow, tn, '', {})).map((p) => p.email), ['c1@example.org']);
  assert.strictEqual(ctx.kingdomEligible_(allow, Object.assign({}, tc, { roles: ['Coordinator'] }), 'LMS4', 'c1@example.org', {}).email, 'c1@example.org', 'a Coordinator sees every campus');
});
test('assign: writes the owner row and two audit rows', () => {
  reset();
  const r = assign(OWN, { quest: 'tc', campus: 'LMS4', assignee: 'p4@example.org', note: '=HYPERLINK("x")' });
  assert.strictEqual(r.success, true);
  assert.deepStrictEqual(setup(), [['_owner:tc', 'campus:LMS4', '_quest', 'owner', 'p4@example.org', 'assigned', '\'=HYPERLINK("x")', NOW.toISOString(), 'owner@example.org']]);
  assert.deepStrictEqual(book.tabs['Game Allocations'].rows[0], H, 'header first');
  assert.deepStrictEqual(audit().map((x) => [col(x, 'Action'), col(x, 'Source'), col(x, 'SourceId'), col(x, 'Campus'), col(x, 'Assignee'), col(x, 'Phase'), col(x, 'Result'), col(x, 'Code'), col(x, 'By')]),
    [['setup_owner', 'setup', 'tc', 'LMS4', 'p4@example.org', 'requested', '', '', 'owner@example.org'], ['setup_owner', 'setup', 'tc', 'LMS4', 'p4@example.org', 'done', 'ok', '', 'owner@example.org']]);
  assert.ok(audit().every((x) => col(x, 'Note') === '\'=HYPERLINK("x")'), 'formula text neutralised');
  assert.deepStrictEqual(events.filter((e) => e !== 'fetch'), ['lock', 'unlock'], 'one lock section, no fetch');
  // the owner row reads back with its `by` (cqRead_ gained the column)
  assert.deepStrictEqual(J(ctx.kingdomOwners_(ctx.cqRead_())), { 'tc|campus:LMS4': { email: 'p4@example.org', at: NOW.toISOString(), by: 'owner@example.org' } });
  assert.strictEqual(ctx.cqRead_()[0].by, 'owner@example.org');
});
test('assign: same owner again: no new Setup Data row, audit code unchanged', () => {
  reset();
  assign(OWN, { quest: 'tc', campus: 'LMS4', assignee: 'p4@example.org' });
  const r = assign(OWN, { quest: 'tc', campus: 'LMS4', assignee: 'p4@example.org' });
  assert.strictEqual(r.success, true); assert.strictEqual(r.unchanged, true);
  assert.strictEqual(setup().length, 1);
  assert.deepStrictEqual(audit().slice(2).map((x) => [col(x, 'Phase'), col(x, 'Result'), col(x, 'Code')]), [['requested', '', ''], ['done', 'ok', 'unchanged']]);
});
test("assign: clear writes 'cleared'", () => {
  reset();
  assert.strictEqual(assign(OWN, { quest: 'tc', campus: 'LMS4', clear: true }).unchanged, true, 'nothing to clear: no row');
  assert.strictEqual(setup().length, 0);
  assign(OWN, { quest: 'tc', campus: 'LMS4', assignee: 'p4@example.org' });
  const r = assign(OWN, { quest: 'tc', campus: 'LMS4', clear: true, assignee: 'ignored@example.org' });
  assert.deepStrictEqual(r, { success: true, owner: null });
  const last = setup()[setup().length - 1];
  assert.deepStrictEqual(last.slice(0, 6), ['_owner:tc', 'campus:LMS4', '_quest', 'owner', '', 'cleared']);
  assert.deepStrictEqual(J(ctx.kingdomOwners_(ctx.cqRead_())), {});
  const a = audit()[audit().length - 1];
  assert.deepStrictEqual([col(a, 'Action'), col(a, 'Result'), col(a, 'Assignee')], ['setup_owner_clear', 'ok', 'p4@example.org']);
});
test('assign: busy lock -> KINGDOM_BUSY, nothing written', () => {
  reset(); lockFails = true;
  assert.strictEqual(assign(OWN, { quest: 'tc', campus: 'LMS4', assignee: 'p4@example.org' }).code, 'KINGDOM_BUSY');
  assert.strictEqual(setup().length + audit().length, 0);
});
test('assign: engine counts unaffected', () => {
  reset();
  const cfg = ctx.cqLoadCfg_(), tc = ctx.cqDefs_(cfg, false).find((d) => d.id === 'tc'), sc = { scopeKey: 'campus:LMS4', campus: 'LMS4' };
  const before = J(ctx.cqView_(P4, tc, sc, ctx.cqRead_(), {}));
  assign(OWN, { quest: 'tc', campus: 'LMS4', assignee: 'p4@example.org' });
  const after = J(ctx.cqView_(P4, tc, sc, ctx.cqRead_(), {}));
  assert.deepStrictEqual(after.ring, before.ring);
  assert.deepStrictEqual(after.items, before.items);
});
test('allocate: forwards only whitelisted fields with the caller\'s token', () => {
  reset();
  fetchReply = { success: true, followUp: { assignee: 'c1@example.org', assigneeName: 'Coordinator One', due: '2026-11-05', status: 'open', note: 'n' } };
  const r = allocate(OWN, { action: 'coordinatorresolvetask', approvalId: 'apr-123', assignee: 'C1@example.org', due: '2026-11-05', note: 'n', extra: 'x', idToken: 'someone-else' });
  assert.deepStrictEqual(r, { success: true, followUp: fetchReply.followUp, cancelled: false });
  assert.strictEqual(fetches.length, 1);
  assert.strictEqual(fetches[0].url, vm.runInContext('GAME_COORD_URL', ctx));
  assert.strictEqual(fetches[0].opts.method, 'post');
  const sent = JSON.parse(fetches[0].opts.payload);
  assert.deepStrictEqual(Object.keys(sent), ['action', 'idToken', 'approvalId', 'assignee', 'due', 'note', 'cancel']);
  assert.strictEqual(sent.action, 'coordinatorallocate');
  assert.strictEqual(sent.idToken, OWN.idToken, "the caller's own token, never anything from the body");
  assert.deepStrictEqual([sent.approvalId, sent.assignee, sent.due, sent.note, sent.cancel], ['apr-123', 'c1@example.org', '2026-11-05', 'n', false]);
  assert.deepStrictEqual(audit().map((x) => [col(x, 'Action'), col(x, 'Source'), col(x, 'SourceId'), col(x, 'Phase'), col(x, 'Result')]),
    [['approval_followup', 'approval', 'apr-123', 'requested', ''], ['approval_followup', 'approval', 'apr-123', 'done', 'ok']]);
  assert.deepStrictEqual(events, ['lock', 'unlock', 'fetch', 'lock', 'unlock'], 'the game lock is never held across the fetch');
  assert.ok(!logs.concat(warns).some((l) => l.includes('tok-') || l.includes('@')), 'no token or email in logs');
  // cancel: due may be blank, cancel forwarded as true
  fetchReply = { success: true, cancelled: true };
  assert.deepStrictEqual(allocate(OWN, { approvalId: 'apr-123', cancel: true }), { success: true, followUp: null, cancelled: true });
  const c = JSON.parse(fetches[1].opts.payload);
  assert.deepStrictEqual([c.cancel, c.due, c.assignee], [true, '', '']);
  assert.strictEqual(col(audit()[audit().length - 1], 'Action'), 'approval_followup_cancel');
});
test('allocate: upstream refusal is audited as refused with its sentence', () => {
  reset();
  fetchReply = { success: false, error: 'Pick a coordinator to allocate this to' };
  const r = allocate(OWN, { approvalId: 'apr-1', assignee: 'p4@example.org', due: '2026-11-05' });
  assert.deepStrictEqual(r, { success: false, code: 'KINGDOM_REFUSED', error: 'Pick a coordinator to allocate this to' });
  const a = audit()[1];
  assert.deepStrictEqual([col(a, 'Phase'), col(a, 'Result'), col(a, 'Code')], ['done', 'refused', 'Pick a coordinator to allocate this to']);
  reset();
  fetchReply = { success: false, error: 'x'.repeat(500) };
  // M5: a long reply or one shaped like a stack trace never reaches the page; the fixed sentence does
  const FIXED = 'Something went wrong. Please try again.';
  assert.strictEqual(allocate(OWN, { approvalId: 'apr-1', assignee: 'p4@example.org', due: '2026-11-05' }).error, FIXED);
  assert.ok(col(audit()[1], 'Code').length <= 200);
  for (const bad of ['TypeError: x is undefined\n    at foo (Code.gs:12)', 'Error: boom', 'oops at run (a.gs:3)']) {
    reset(); fetchReply = { success: false, error: bad };
    assert.strictEqual(allocate(OWN, { approvalId: 'apr-1', assignee: 'p4@example.org', due: '2026-11-05' }).error, FIXED, bad);
  }
  // the audit cell is formula-safe
  reset(); fetchReply = { success: false, error: '=HYPERLINK("x")' };
  allocate(OWN, { approvalId: 'apr-1', assignee: 'p4@example.org', due: '2026-11-05' });
  assert.ok(!/^[=+\-@]/.test(col(audit()[1], 'Code')), 'audit Code cell has no formula prefix');
});
test('allocate: fetch failure -> KINGDOM_UPSTREAM, audit error', () => {
  for (const reply of ['throw', 'http500', 'not json shaped']) {
    reset(); fetchReply = reply;
    const r = allocate(OWN, { approvalId: 'apr-1', assignee: 'p4@example.org', due: '2026-11-05' });
    assert.deepStrictEqual(r, { success: false, code: 'KINGDOM_UPSTREAM', error: 'The Coordinator system could not be reached. Nothing was changed.' }, reply);
    assert.deepStrictEqual([col(audit()[1], 'Result'), col(audit()[1], 'Code')], ['error', 'KINGDOM_UPSTREAM']);
  }
});
test('allocate: bad due or email -> KINGDOM_BAD_INPUT, no fetch', () => {
  reset();
  const good = { approvalId: 'apr-1', assignee: 'p4@example.org', due: '2026-11-05' };
  const bads = [{ due: '05-11-2026' }, { due: '2026-02-30' }, { due: '' }, { assignee: 'not-an-email' }, { assignee: '' }, { assignee: 'a b@example.org' },
    { approvalId: '' }, { approvalId: 'a/b' }, { approvalId: 'x'.repeat(81) }, { note: 'x'.repeat(301) }, { cancel: 'yes' }, { assignee: ['p4@example.org'] }, { approvalId: 42 }];
  bads.forEach((b) => assert.strictEqual(allocate(OWN, Object.assign({}, good, b)).code, 'KINGDOM_BAD_INPUT', JSON.stringify(b)));
  assert.strictEqual(fetches.length, 0);
  assert.strictEqual(audit().length, bads.length, 'every refusal audited');
  assert.ok(audit().every((x) => col(x, 'Result') === 'refused' && col(x, 'Code') === 'KINGDOM_BAD_INPUT'));
  lockFails = true;
  assert.strictEqual(allocate(OWN, good).code, 'KINGDOM_BUSY');
  assert.strictEqual(fetches.length, 0, 'busy: nothing forwarded');
});
test('allocate/assign over GET are unknown actions', () => {
  reset();
  const saved = ctx.gameVerifyCaller_;
  ctx.gameVerifyCaller_ = () => J(OWN);
  try {
    for (const action of ['kingdomassign', 'kingdomallocate']) {
      const out = JSON.parse(ctx.doGet({ parameter: { idToken: 't', action, quest: 'tc', campus: 'LMS4', assignee: 'p4@example.org', approvalId: 'a1', due: '2026-11-05' } }).body);
      assert.deepStrictEqual(out, { success: false, error: 'Unknown action' }, action);
      assert.ok(!(action in ctx.GAME_MODULE_ACTIONS));
    }
    assert.strictEqual(setup().length + audit().length + fetches.length, 0);
    const p = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ action: 'kingdomassign', idToken: 't', quest: 'tc', campus: 'LMS4', assignee: 'p4@example.org' }) } }).body);
    assert.strictEqual(p.success, true, JSON.stringify(p));
    fetchReply = { success: true, followUp: {} };
    const q = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ action: 'kingdomallocate', idToken: 't', approvalId: 'a1', assignee: 'c1@example.org', due: '2026-11-05' }) } }).body);
    assert.strictEqual(q.success, true, JSON.stringify(q));
    assert.strictEqual(JSON.parse(fetches[0].opts.payload).idToken, 't', 'doPost passes the verified token on');
    ctx.gameVerifyCaller_ = () => J(P4);
    const z = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ action: 'kingdomassign', idToken: 't', quest: 'tc', campus: 'LMS4', assignee: 'p4@example.org' }) } }).body);
    assert.strictEqual(z.code, 'KINGDOM_NO_RIGHT');
  } finally { ctx.gameVerifyCaller_ = saved; }
});
test("missions: an assigned quest shows only for its assignee (and the Owner), with why 'Assigned by the Owner'", () => {
  reset();
  const ALLP = mk({ email: 'pall@example.org', roles: ['Principal'], primaryRole: 'Principal', campusId: 'LMS4' }); // a second Principal at LMS4
  const OWNP = mk({ email: 'owner@example.org', roles: ['Owner', 'Principal'], primaryRole: 'Owner' });
  const mission = (c) => { ctx.CQ_MEMO = null; return J(ctx.cqMissions_(c, ctx.cqLoadCfg_(), NOW)).filter((m) => m.id.indexOf('cq_tc') === 0 && m.campus === 'LMS4')[0]; };
  assert.ok(mission(P4) && mission(ALLP), 'no owner: unchanged for everyone');
  const whyBefore = mission(P4).why;
  assign(OWN, { quest: 'tc', campus: 'LMS4', assignee: 'p4@example.org' });
  assert.strictEqual(mission(P4).why, 'Assigned by the Owner');
  assert.strictEqual(mission(ALLP), undefined, 'someone else: dropped');
  assert.strictEqual(mission(OWNP).why, whyBefore, 'the Owner keeps it, unchanged');
  // the page stays open to the other Principal
  assert.strictEqual(J(ctx.cqGetAction_(ALLP, { quest: 'tc', campus: 'LMS4' })).success, true);
  // other campuses are untouched
  const p3m = (ctx.CQ_MEMO = null, J(ctx.cqMissions_(P3, ctx.cqLoadCfg_(), NOW)).filter((m) => m.campus === 'LMS3')[0]);
  assert.ok(p3m && p3m.why !== 'Assigned by the Owner');
  assign(OWN, { quest: 'tc', campus: 'LMS4', clear: true });
  assert.ok(mission(ALLP), 'cleared: back for everyone');
});
test('gamekingdom: assignees on the Owner\'s assignable open tiers only', () => {
  reset();
  const r = J(ctx.kingdomGet_(OWN, {}));
  const tier = (base, b) => r.kingdom.campuses.find((x) => x.id === base).buildings.find((x) => x.id === b).tiers[0];
  assert.strictEqual(tier('LMS4', 'hall').assignable, true);
  assert.deepStrictEqual(tier('LMS4', 'hall').assignees, [{ email: 'p4@example.org', name: 'Principal Four' }]);
  assert.deepStrictEqual(tier('LMS3', 'hall').assignees.map((p) => p.email), ['p3@example.org']);
  assert.deepStrictEqual(tier('HES', 'post').assignees.map((p) => p.email), ['c1@example.org']);
  assert.strictEqual(tier('LMS4', 'hall').questId, 'tc');
  const pr = J(ctx.kingdomGet_(P4, {}));
  assert.ok(!JSON.stringify(pr).includes('assignees') && !JSON.stringify(pr).includes('@'), 'a Principal gets no assignees and no emails');
});

let fail = 0;
for (const [n, fn] of tests) { try { fn(); console.log('ok  ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n  ' + (e.stack || e).split('\n').slice(0, 4).join('\n  ')); } }
if (fail) process.exit(1);
