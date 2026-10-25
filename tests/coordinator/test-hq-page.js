// node tests/coordinator/test-hq-page.js -- coordinator/hq.html: the Coordinator HQ page (board, decision view, track record)
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const root = path.join(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'coordinator/hq.html'), 'utf8');
const logic = fs.readFileSync(path.join(root, 'coordinator/hq-logic.js'), 'utf8');
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).pop();

// the brief's checks
const at = (re) => html.search(re);
const auth = at(/<script src="\.\.\/assets\/auth\.js(\?v=[0-9a-f]+)?"><\/script>/), shared = at(/<script src="\.\/shared\.js(\?v=[0-9a-f]+)?"><\/script>/),
  hq = at(/<script src="\.\/hq-logic\.js(\?v=[0-9a-f]+)?"><\/script>/), own = at(/<script>/);
assert.ok(auth !== -1 && shared > auth && hq > shared && own > hq, 'auth.js, shared.js, hq-logic.js, then the inline script');
for (const a of ['coordinatortasks', 'coordinatordecision', 'coordinatorrecommend', 'coordinatortrackrecord']) assert.ok(new RegExp('\\b' + a + '\\b').test(inline), 'calls ' + a);
assert.ok(/daybook\.list/.test(inline), 'reads the day book');
for (const [name, text] of [['hq.html', html], ['hq-logic.js', logic]]) {
  assert.ok(!/[a-z0-9.]+@lms\.org\.in/i.test(text), name + ': no email addresses');
  assert.ok(!/\bUday\b/.test(text), name + ': no names in static copy (the Owner)');
}
assert.ok(html.includes('Nothing in the network is past its line today.'), 'empty-state copy');
assert.ok(html.includes("Your recommendations and the Owner's decisions"), 'track record wording');
assert.ok(/\.disabled\s*=\s*!H\.recReady\(/.test(inline), 'the form re-checks the submit as it changes');

// run the real shared.js, hq-logic.js and the inline script with no session: helpers get defined, the gate waits
const els = {}, el = (id) => els[id] || (els[id] = { id, style: {}, dataset: {}, innerHTML: '', textContent: '', hidden: false, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], setAttribute() {}, removeAttribute() {}, focus() {}, showModal() {}, close() {} });
let banners = 0, fetches = [];
const ctx = vm.createContext({
  console, setTimeout: (fn) => fn(), clearTimeout() {}, Date, URLSearchParams, AbortController, encodeURIComponent, JSON,
  document: { getElementById: el, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
  location: { hash: "" }, history: { state: null, pushState() {}, back() {}, replaceState() {} }, addEventListener() {}, scrollY: 0, CSS: { escape: (s) => s },
  LMCS: { getSession: () => null, requireSession: () => new Promise(() => {}), campusLabel: (c) => c, hasRole: () => false, canViewCoordinatorPortal: () => true, notifyAuthFailure: () => { banners++; } },
});
ctx.window = ctx;
vm.runInContext(fs.readFileSync(path.join(root, 'coordinator/shared.js'), 'utf8'), ctx);
vm.runInContext(logic, ctx);
vm.runInContext(inline, ctx);
assert.ok(ctx.Coord.api && ctx.Coord.postJson && ctx.Coord.WORK_LINKS, 'shared.js exports api, postJson and WORK_LINKS (R7)');
assert.ok(ctx.CoordHQ && ctx.CoordHQ.rankContracts, 'hq-logic.js sets window.CoordHQ');

// the recommendation form: the submit starts disabled
const dec = { id: 'APR-1', campus: 'LMS4', category: 'Financial / Purchase', title: 'Water <b>tank</b>', amount: 12500, waitingDays: 5, requestedBy: 'p@lms.test', preview: { history: { approved: 2, rejected: 1 } }, recommendation: null };
const form = ctx.formHtml(dec, null);
assert.ok(/<button[^>]*type="submit"[^>]*\bdisabled\b/.test(form), 'submit disabled until there is a reason');
assert.ok(/value="Approve"/.test(form) && /value="Reject"/.test(form) && /value="Info"/.test(form) && form.includes('Ask for information'), 'three choices');
assert.ok(/What I checked/.test(form), 'optional "What I checked" box');

// cards: escaped, recommendation shown by byName, or "Needs your recommendation"
const t = { taskId: 'approval|APR-1|Pending', domain: 'approval', campus: 'LMS4', title: 'Purchase <img src=x>', detail: 'd', severity: 'high', assignee: '', due: '', createdAt: '2026-10-21T05:00:00.000Z', recommendation: null };
const c1 = ctx.cardHtml(t);
assert.ok(c1.includes('Purchase &lt;img src=x&gt;') && !c1.includes('<img src=x>'), 'title escaped');
assert.ok(c1.includes('Needs your recommendation') && c1.includes('waiting since 21 Oct') && /stuck/i.test(c1), 'needs-rec, age as a date, flag chip');
const c2 = ctx.cardHtml(Object.assign({}, t, { recommendation: { by: 'x@lms.test', byName: 'A <i>Name</i>', recommendation: 'Reject', reason: 'r' } }));
assert.ok(c2.includes('A &lt;i&gt;Name&lt;/i&gt;') && /Reject/.test(c2) && !c2.includes('Needs your recommendation'), 'recommendation by byName, escaped');

// a "Not authorized" answer raises the sign-in banner, says so plainly and offers no dead Try again
ctx.Coord.setSession({ idToken: 'tok', email: 'c@lms.test', role: 'Coordinator' });
ctx.fetch = (url) => { fetches.push(url); return Promise.resolve({ json: () => Promise.resolve({ success: false, error: 'Not authorized' }), text: () => Promise.resolve('{"success":false,"error":"Not authorized"}') }); };
(async () => {
  await ctx.load();
  assert.ok(banners >= 1, 'sign-in banner raised');
  assert.ok(/Sign in again/.test(els.board.innerHTML) && !/Retry|Try again/.test(els.board.innerHTML), 'plain words, no Retry');
  ctx.fetch = () => Promise.resolve({ json: () => Promise.resolve({ success: false, error: 'Database busy' }) });
  await ctx.load();
  assert.ok(/Database busy/.test(els.board.innerHTML) && /Retry/.test(els.board.innerHTML), 'other errors keep Retry');
  console.log('hq page: ok');
})().catch((e) => { console.error(e); process.exit(1); });
