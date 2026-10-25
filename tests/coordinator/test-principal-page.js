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
const ctx = vm.createContext({
  console, setTimeout: (fn) => fn(), Date,
  document: { getElementById: () => ({ style: {}, innerHTML: '', addEventListener() {} }) },
  LMCS: { getSession: () => null, requireSession: () => new Promise(() => {}), campusLabel: (c) => c },
});
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
  console.log('principal issues page: ok');
})().catch((e) => { console.error(e); process.exit(1); });
