// node tests/coordinator/test-pdr-reopen.js -- coordinator/shared.js pdrView (Systems): closures and Reopen on daily-report issues
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../../coordinator/shared.js'), 'utf8');

const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); };
const issue = (id, last) => ({ id, campus: 'LMS4', type: 'Infrastructure', subject: 'Subject ' + id, first: day(20), last, count: 2, needsAction: true, items: [{ date: last, text: 't' }] });
const DATA = {
  success: true, reports: [], tags: {}, history: [], coordinators: [], merges: {},
  issues: [issue('re', day(3)), issue('res', day(9)), issue('ack', day(9)), issue('old', day(30))],
  actions: {
    re: { status: 'reopened', note: 'Leak is back', by: 'c@lms.test', at: day(1) + ' 09:00', lastAtAction: day(3) },
    res: { status: 'resolved', note: 'Fixed', by: 'p@lms.test', at: day(2) + ' 09:00', lastAtAction: day(9) },
    ack: { status: 'acknowledged', note: '', by: 'c@lms.test', at: day(2) + ' 09:00', lastAtAction: day(9) },
    old: { status: 'resolved', note: 'Long ago', by: 'p@lms.test', at: day(20) + ' 09:00', lastAtAction: day(30) },
  },
};

// render the Systems page's Today tab with a given status filter; returns the issue area's HTML
async function render(hash) {
  const box = { innerHTML: '', dataset: {}, querySelectorAll: () => [], querySelector: () => null };
  const body = { innerHTML: '', querySelector: () => box };
  const ctx = vm.createContext({ console, Date, setTimeout, location: { hash }, LMCS: {}, fetch: () => Promise.resolve({ json: () => Promise.resolve(JSON.parse(JSON.stringify(DATA))) }) });
  ctx.window = ctx;
  vm.runInContext(src, ctx);
  ctx.Coord.setSession({ idToken: 'tok', email: 'c@lms.test' });
  ctx.Coord.pdrView(body);
  await new Promise((ok) => setTimeout(ok, 0));
  await new Promise((ok) => setTimeout(ok, 0));
  return box.innerHTML;
}
const row = (html, id) => (html.match(new RegExp('<tr data-id="' + id + '">[\\s\\S]*?</tr>')) || [''])[0];

(async () => {
  // Open: the reopened issue is there, its editor keeps "reopened" selected (Save without a change can't alter it), and it has no Reopen box
  const open = await render('');
  const re = row(open, 're');
  assert.ok(re, 'reopened issue listed under Open');
  assert.ok(/<option value="reopened" selected>/.test(re), 'editor keeps the reopened status selected');
  assert.ok(!/<option value="acknowledged" selected>/.test(re), 'not defaulted to Acknowledge');
  assert.ok(re.includes('Reopened') && !/pd-reopen/.test(re), 'Reopened chip, no Reopen box');

  // Closed this week (#closed): resolved in the last 7 days only, each with a Reopen box; not on acknowledged or older closures
  const closed = await render('#closed');
  assert.ok(/Closed this week \(1\)/.test(closed), 'count of closures this week');
  assert.ok(/class="pd-reopen" data-id="res"/.test(row(closed, 'res')), 'Reopen on a closure');
  assert.ok(/class="btn pd-reopen-go" disabled/.test(row(closed, 'res')), 'Reopen disabled until there is a reason');
  assert.ok(!row(closed, 'ack') && !row(closed, 'old') && !row(closed, 're'), 'only this week\'s closures');
  assert.ok(!/<option value="reopened"/.test(row(closed, 'res')), 'no reopened option on an issue that is not reopened');
  console.log('pdr reopen: ok');
})().catch((e) => { console.error(e); process.exit(1); });
