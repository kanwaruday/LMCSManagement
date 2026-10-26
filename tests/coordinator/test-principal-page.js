// node tests/coordinator/test-principal-page.js -- principal/issues.html: the Principal closes daily-report issues with a note
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '../../principal/issues.html'), 'utf8');
const inlineAt = html.search(/<script>/);
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).pop();

// the brief's checks
assert.ok(/principalissues\b/.test(inline), 'reads principalissues');
assert.ok(/principalissueresolve\b/.test(inline), 'posts principalissueresolve');
const authAt = html.search(/<script src="\.\.\/assets\/auth\.js(\?v=[0-9a-f]+)?"><\/script>/);
assert.ok(authAt !== -1 && inlineAt !== -1 && authAt < inlineAt, 'auth.js loads before the inline script');
assert.ok(html.includes('No open issues from your daily reports.'), 'empty-state text');
assert.ok(!/[a-z0-9.]+@lms\.org\.in/i.test(html), 'no email addresses in the page');

// run the inline script with no session: it only defines its helpers and waits on the sign-in gate
const els = {}, el = (id) => els[id] || (els[id] = { id, style: {}, innerHTML: '', textContent: '', addEventListener() {}, querySelector: () => ({}) });
let banners = 0;
const ctx = vm.createContext({
  console, setTimeout: (fn) => fn(), Date,
  document: { getElementById: el },
  LMCS: { getSession: () => null, requireSession: () => new Promise(() => {}), campusLabel: (c) => c, notifyAuthFailure: () => { banners++; } },
});
ctx.CoordHQ = require('../../coordinator/hq-logic.js'); // the page loads it for the shared sync line
vm.runInContext(inline, ctx);

// the button is disabled until the note has text
assert.strictEqual(ctx.noteReady(''), false);
assert.strictEqual(ctx.noteReady('   \n '), false);
assert.strictEqual(ctx.noteReady('Plumber fixed the tank'), true);
const issue = (id, status, last, extra) => Object.assign({ id, subject: 'Subject ' + id, campus: 'LMS4', first: '2026-10-01', last, count: 2, needsAction: true, status, assignee: '', resolvedBy: '', resolvedAt: '', note: '' }, extra);
const row = ctx.openRowHtml(issue('i1', 'open', '2026-10-10'), '');
assert.ok(/<button[^>]*\bdisabled\b[^>]*>\s*Close with this note\s*<\/button>/.test(row), 'empty note: button disabled');
assert.ok(!/<button[^>]*\bdisabled\b/.test(ctx.openRowHtml(issue('i1', 'open', '2026-10-10'), 'Fixed')), 'kept draft: button enabled');
assert.ok(/\.disabled\s*=\s*!noteReady\(/.test(inline), 'typing re-checks the button');

// reopened: tagged, with the Coordinator's note, escaped
const re = ctx.openRowHtml(issue('i2', 'reopened', '2026-10-12', { note: 'Still <b>leaking</b>' }), '');
assert.ok(re.includes('Reopened') && re.includes('Still &lt;b&gt;leaking&lt;/b&gt;') && !re.includes('<b>leaking'), 'reopened tag and escaped note');

// raised again after it was closed: in the open list, with a "Raised again" tag and the normal close box
const again = issue('i3', 'open', '2026-10-14', { raisedAgain: true });
const ag = ctx.openRowHtml(again, '');
assert.ok(ag.includes('Raised again') && /class="close-form"/.test(ag) && ag.includes('Close with this note'), 'raised-again tag and close box');
assert.ok(!ctx.openRowHtml(issue('i4', 'open', '2026-10-14'), '').includes('Raised again'), 'no tag on a plain open issue');
assert.deepStrictEqual(ctx.splitIssues([again], '2026-10-26').open.map((i) => i.id), ['i3']);
// the backend sends a Principal only the reopen reason (and their own closure notes): the page promises no other note
assert.ok(!/Coordinator\\?'s note/.test(html), 'no "Coordinator\'s note" label');
assert.ok(!ctx.openRowHtml(issue('i5', 'assigned', '2026-10-14', { note: 'stray' }), '').includes('stray'), 'a note is shown only on a reopened issue');

// open and reopened first, oldest Last seen first; "Closed recently" = resolved in the last 14 days, newest first
const all = [issue('a', 'open', '2026-10-20'), issue('b', 'reopened', '2026-10-05'), issue('c', 'assigned', '2026-10-11'),
  issue('d', 'resolved', '2026-10-09', { resolvedAt: '2026-10-12', note: 'done' }), issue('e', 'resolved', '2026-09-01', { resolvedAt: '2026-10-11', note: 'old' }),
  issue('f', 'resolved', '2026-10-15', { resolvedAt: '2026-10-25', note: 'new' }), issue('g', 'acknowledged', '2026-10-01')];
const s = ctx.splitIssues(all, '2026-10-26');
assert.deepStrictEqual(s.open.map((i) => i.id), ['g', 'b', 'c', 'a']);
assert.deepStrictEqual(s.closed.map((i) => i.id), ['f', 'd']);

// POST: text/plain JSON (no custom headers), retried only when the backend answers with an HTML error page, at most 3 tries
let calls = [];
const answer = (bodies) => { calls = []; ctx.fetch = (url, init) => { calls.push(init); const b = bodies[Math.min(calls.length - 1, bodies.length - 1)]; return b instanceof Error ? Promise.reject(b) : Promise.resolve({ text: () => Promise.resolve(b) }); }; };
(async () => {
  answer(['<html>error</html>', '{"success":true}']);
  assert.strictEqual(JSON.stringify(await ctx.post({ action: 'principalissueresolve', id: 'a', note: 'x' }, 'tok')), '{"success":true}');
  assert.strictEqual(calls.length, 2);
  assert.ok(!calls[0].headers && calls[0].method === 'POST' && JSON.parse(calls[0].body).idToken === 'tok', 'CORS-simple POST carrying the token');
  answer(['<html>error</html>']);
  await assert.rejects(ctx.post({ action: 'principalissueresolve' }, 'tok'), /error page/);
  assert.strictEqual(calls.length, 3, 'three tries at most');
  answer([new Error('Failed to fetch')]);
  await assert.rejects(ctx.post({ action: 'principalissueresolve' }, 'tok'));
  assert.strictEqual(calls.length, 1, 'a network failure is not retried');

  // "Not authorized" (expired sign-in, or one that doesn't cover this school): the auth.js banner, plain words, no dead "Try again"
  vm.runInContext("SESSION = { idToken: 'tok', email: 'p@lms.test' }", ctx);
  answer(['{"success":false,"error":"Not authorized"}']); banners = 0;
  await ctx.load();
  assert.strictEqual(banners, 1, 'load raises the sign-in banner');
  assert.ok(/Sign in again/.test(els.body.innerHTML) && !/retry|Try again/.test(els.body.innerHTML), 'load: sign-in words, no Try again');
  answer(['{"success":false,"error":"Database busy"}']);
  await ctx.load();
  assert.ok(/Database busy/.test(els.body.innerHTML) && /id="retry"/.test(els.body.innerHTML), 'other load errors keep Try again');
  const ta = { value: 'Plumber fixed the tank', readOnly: false, focus() {} }, btn = { dataset: {}, disabled: false, textContent: '' }, err = { textContent: '' };
  const form = { dataset: { id: 'i1' }, querySelector: (q) => ({ textarea: ta, '.btn': btn, '.err': err })[q] };
  answer(['{"success":false,"error":"Not authorized"}']); banners = 0;
  await ctx.closeIssue(form);
  assert.strictEqual(banners, 1, 'close raises the sign-in banner');
  assert.ok(/Sign in again/.test(err.textContent) && /note is kept/.test(err.textContent), err.textContent);
  assert.ok(ta.value === 'Plumber fixed the tank' && !ta.readOnly && !btn.disabled, 'the typed note is kept and can be sent again');
  // the sync line from pushedAt (hq-logic's syncLine): shown fresh or stale, empty without it
  assert.ok(/hq-logic\.js/.test(html), 'the page loads hq-logic.js');
  const ok = (extra) => JSON.stringify(Object.assign({ success: true, campus: 'LMS4', issues: [] }, extra));
  answer([ok({ pushedAt: '2026-01-02 08:30' })]);
  await ctx.load();
  assert.ok(/^Daily-report issues last synced 2 Jan, 08:30 \(the Mac hasn't pushed since then\)$/.test(els['issue-sync'].textContent), els['issue-sync'].textContent);
  answer([ok({})]);
  await ctx.load();
  assert.strictEqual(els['issue-sync'].textContent, '', 'no pushedAt: nothing shown');
  console.log('principal issues page: ok');
})().catch((e) => { console.error(e); process.exit(1); });
