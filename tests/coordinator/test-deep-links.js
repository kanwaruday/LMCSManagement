// Deep links for the game's classic doors (lane-h, 12 Nov): each page opens the panel its #hash names, and an unknown hash
// lands on the page's home. Runs the pages' own hash lines in a sandbox with a fake location.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const line = (src, re) => { const m = src.match(re); assert.ok(m, 'missing: ' + re); return m[0]; };
const run = (code, hash, expr) => vm.runInNewContext(code + ';' + expr, { location: { hash } });

// coordinator/systems -> shared.js pdrView: every tab by id, #leave = Approvals filtered to Leave
const shared = read('coordinator/shared.js');
const sys = line(shared, /const PDR_TABS = \[[^\]]+\];/) + line(shared, /const hashTab = [^\n]+;/);
for (const t of ['today', 'digest', 'approvals', 'compliance', 'repeats', 'fees', 'admissions', 'messages', 'registers', 'assembly']) {
  assert.strictEqual(run(sys, '#' + t, 'hashTab(location.hash.slice(1))'), t, t);
  assert.ok(shared.includes("['" + t + "', "), 'tab ' + t + ' is a real tab button');
}
assert.strictEqual(run(sys, '#leave', 'hashTab(location.hash.slice(1))'), 'approvals');
assert.strictEqual(run(sys, '#nonsense', 'hashTab(location.hash.slice(1))'), 'today');
assert.strictEqual(run(sys, '', 'hashTab(location.hash.slice(1))'), 'today');
assert.ok(shared.includes("aprCat: location.hash === '#leave' ? 'Leave' : ''") && shared.includes('cat: P.aprCat'), '#leave passes the Leave category to approvals');
assert.ok(read('coordinator/approvals.js').includes("cat: CATEGORIES.indexOf(ctx.cat) !== -1 ? ctx.cat : 'All'"), 'approvals takes ctx.cat');

// hiring: #today #appts #role #actions #pool
const hiring = line(read('hiring/index.html'), /let VIEW = \(function \(\) \{[^\n]+\}\)\(\);/);
for (const v of ['today', 'appts', 'role', 'actions', 'pool']) assert.strictEqual(run(hiring, '#' + v, 'VIEW'), v, v);
assert.strictEqual(run(hiring, '#x', 'VIEW'), 'today');

// owner/people: #owner #coord #principal #office
const people = read('owner/people.html');
const pp = line(people, /const FILTERS = \[[^\n]+\];/) + line(people, /let FILTER = [^\n]+;/);
for (const f of ['owner', 'coord', 'principal', 'office']) assert.strictEqual(run(pp, '#' + f, 'FILTER'), f, f);
assert.strictEqual(run(pp, '#x', 'FILTER'), 'all');

// coordinator/hq.html: #track scrolls to My track record; #d= still reopens a request
const hq = read('coordinator/hq.html');
assert.ok(hq.includes("location.hash === '#track' && $('track')") && hq.includes('id="track"'), '#track');
assert.ok(hq.includes("/^#d=(.+)$/.exec(location.hash"), '#d= kept');
console.log('deep links: ok');
