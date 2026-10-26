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
vm.runInContext(fs.readFileSync(path.join(root, 'assets/campus-picker.js'), 'utf8'), ctx);
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

  // fresh requests: "New request" cards after the existing cards, filtered by district, opening the same decision view
  const freshT = { taskId: 'doc_missing|E1', domain: 'doc_missing', campus: 'LMS1', title: 'Docs missing', detail: '', severity: 'low', assignee: '', due: '', createdAt: '2026-10-01T05:00:00.000Z' };
  const freshList = [{ approvalId: 'APR-9', campus: 'LMS4', title: 'Fan <b>repair</b>', category: 'Financial / Purchase', status: 'Pending', requestedAt: '2026-10-25T05:00:00.000Z', recommendation: null },
    { approvalId: 'APR-8', campus: 'LMS2', title: 'Trip', category: 'Off-Campus Trip / Excursion', status: 'Pending', requestedAt: '2026-10-24T05:00:00.000Z', recommendation: { by: 'x@lms.test', byName: 'A <i>N</i>', recommendation: 'Approve', reason: 'fine' } }];
  vm.runInContext('TASKS = ' + JSON.stringify([freshT]) + '; FRESH = ' + JSON.stringify(freshList) + "; SEL = LMCSCampus.get({ campusId: 'ALL' }); SHOW_ALL = false; OPEN = null;", ctx);
  ctx.renderBoard();
  const b = els.board.innerHTML;
  assert.ok(b.indexOf('Docs missing') !== -1 && b.indexOf('Docs missing') < b.indexOf('Fan &lt;b&gt;repair') && b.indexOf('Fan &lt;b&gt;repair') < b.indexOf('Trip'), 'existing cards first, then the new requests (no recommendation yet first)');
  assert.ok(!b.includes('<b>repair'), 'fresh title escaped');
  const nc = ctx.freshHtml(freshList[0]);
  assert.ok(/class="flag new"[^>]*>New request</.test(nc) && nc.includes('raised 25 Oct') && nc.includes('Needs your recommendation') && /data-open="APR-9"/.test(nc), 'new chip, raised date, rec line, opens #d=<id>');
  assert.ok(nc.includes('Financial / Purchase'), 'category shown');
  const rc = ctx.freshHtml(freshList[1]);
  assert.ok(rc.includes('A &lt;i&gt;N&lt;/i&gt; recommends Approve: fine'), 'same recommendation line, escaped');
  // the picker's own selection filters cards and new requests; two schools overlay the open count, one school shows a total
  vm.runInContext("SEL = { all: false, campuses: ['LMS1', 'LMS2'] }", ctx);
  ctx.renderBoard(); ctx.renderBases();
  assert.ok(els.board.innerHTML.includes('Trip') && els.board.innerHTML.includes('Docs missing') && !els.board.innerHTML.includes('Fan'), 'picker filter applies to cards and new requests');
  assert.ok(/lmcs-ov/.test(els.tabcount.innerHTML) && /LMS 1 <b>1<\/b>/.test(els.tabcount.innerHTML) && /LMS 2 <b>1<\/b>/.test(els.tabcount.innerHTML), 'two schools: one open count each');
  vm.runInContext("SEL = { all: false, campuses: ['LMS4'] }", ctx);
  ctx.renderBases();
  assert.ok(!/lmcs-ov/.test(els.tabcount.innerHTML) && els.tabcount.innerHTML.endsWith('1'), 'one school: a single total');
  vm.runInContext("TASKS = []; SEL = LMCSCampus.get({ campusId: 'ALL' })", ctx);
  ctx.renderBoard();
  assert.ok(els.board.innerHTML.includes('Fan') && !els.board.innerHTML.includes('Nothing in the network'), 'new requests show even with no follow-ups');
  ctx.fetch = () => Promise.resolve({ json: () => Promise.resolve({ success: true, tasks: [freshT], fresh: freshList }) });
  await ctx.load();
  assert.strictEqual(vm.runInContext('FRESH.length', ctx), 2, 'load keeps fresh from coordinatortasks');

  // a late day-book answer fills in the spend line only: the form the Coordinator is typing in is never repainted
  vm.runInContext("SESSION = { idToken: 'tok', email: 'c@lms.test' }; OPEN = 'APR-1'; DECISIONS['APR-1'] = " + JSON.stringify(dec), ctx);
  const preview = ctx.previewHtml(dec);
  assert.ok(/id="dv-spend"[^>]*>Reading the day book/.test(preview), 'spend line has its own id while the day book loads');
  els.decision.innerHTML = '<form id="rec-form">(the form as the Coordinator left it)</form>';
  const reason = el('rec-reason'), radio = { value: 'Reject', checked: true };
  reason.value = 'Quotation is twice the day-book rate';
  let answer;
  ctx.fetch = (url) => { assert.ok(/action=daybook\.list/.test(url), 'Office day book'); return new Promise((ok) => { answer = ok; }); };
  const spend = ctx.loadSpend('LMS4');
  answer({ json: () => Promise.resolve({ success: true, entries: [{ id: 'e1', direction: 'OUT', amount_paise: 4820000 }] }) });
  await spend;
  assert.strictEqual(els.decision.innerHTML, '<form id="rec-form">(the form as the Coordinator left it)</form>', 'decision panel not repainted');
  assert.strictEqual(reason.value, 'Quotation is twice the day-book rate', 'reason kept');
  assert.ok(radio.checked && radio.value === 'Reject', 'choice kept');
  assert.ok(/^This request: ₹12,500\. LMS 4 spent ₹48,200 from the day book since \d+ \w{3}\.$/.test(els['dv-spend'].textContent), 'spend line filled in place: ' + els['dv-spend'].textContent);
  console.log('hq page: ok');
})().catch((e) => { console.error(e); process.exit(1); });
