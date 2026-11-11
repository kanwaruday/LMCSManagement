// Game doors (V2, 12 Nov: "one game door per old panel"): each transport page opens the panel named in location.hash; an unknown
// hash lands on the page's home. Fleet Command's tabs are tested by behaviour in tests/coordinator/test-campus-views.js; the rest here.
const fs = require('fs'), path = require('path'), assert = require('assert'), vm = require('vm');
const root = path.join(__dirname, '../..'), read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

// TransportChecks (live.html, owner/transport): the tab ids, by behaviour on a tiny fake page
function checksTab(hash, owner) {
  const btns = [], node = { set innerHTML(h) { btns.length = 0; (h.match(/data-tab="(\w+)" class="(on)?"/g) || []).forEach((m) => btns.push(m)); this._h = h; }, get innerHTML() { return this._h || ''; },
    hidden: false, querySelectorAll: () => [], querySelector: (s) => (s === '.tc-tabs' ? { querySelector: () => null } : { innerHTML: '', querySelectorAll: () => [], querySelector: () => null, addEventListener() {} }), addEventListener() {} };
  const el = { innerHTML: '', querySelector: (s) => (s === '.tc-body' || s === '.tc-map' ? node : { innerHTML: '', hidden: false, querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, appendChild() {} }) };
  const d = { success: true, today: '2026-11-12', tasks: [], checks: [], days: [], vehicles: [], stops: [], proposals: { shared: [] }, pnl: [] };
  const ctx = vm.createContext({ console, Date, Math, JSON, Promise, Object, Set, setTimeout, location: { hash }, localStorage: { getItem: () => null, setItem() {} },
    document: { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, classList: { add() {}, toggle() {} } }), querySelector: () => null, getElementById: () => null, head: { appendChild() {} } },
    fetch: () => Promise.resolve({ json: () => Promise.resolve(d) }) });
  ctx.window = ctx;
  ctx.LMCSCampus = { mount() {}, filter: (rows) => rows, overlay: () => '' }; // the picker, not under test here
  vm.runInContext(read('coordinator/transport-checks.js'), ctx);
  ctx.TransportChecks.mount(el, { idToken: 't', campusId: 'LMS1', email: 'c' }, owner ? { owner: true } : {});
  return new Promise((r) => setTimeout(() => (r((btns.find((b) => /class="on"/.test(b)) || '').replace(/^data-tab="(\w+)".*$/, "$1"))), 10));
}

(async () => {
  assert.strictEqual(await checksTab('#fuel'), 'fuel', 'live.html#fuel opens Fuel');
  assert.strictEqual(await checksTab('#stops'), 'stops', 'live.html#stops opens Stop times');
  assert.strictEqual(await checksTab('#nope'), 'checks', 'an unknown hash: Follow-ups, the Coordinator\'s home tab');
  assert.strictEqual(await checksTab(''), 'checks', 'no hash: as before');
  assert.strictEqual(await checksTab('#overview'), 'checks', 'Overview is the Owner\'s only: a Coordinator lands on Follow-ups');
  assert.strictEqual(await checksTab('#overview', true), 'overview', 'owner/transport#overview');
  assert.strictEqual(await checksTab('#loadout', true), 'overview', 'owner/transport#loadout: tabs stay home, the page scrolls to the loadout');

  // the panels that are not tabs
  assert.ok(/runs\.length && location\.hash === '#review'\) box\.scrollIntoView/.test(read('coordinator/transport/index.html')), 'Fleet Command#review scrolls to the trial-runs shelf when it has runs');
  assert.ok(/location\.hash === '#loadout'\) setTimeout\(function \(\) \{ box\.scrollIntoView/.test(read('owner/transport/index.html')), 'owner/transport#loadout scrolls to the safety loadout');
  const drv = read('driver/driver.js');
  assert.ok(/if \(h === 'route' && !S\.sending\) \{ history\.replaceState\(null, '', location\.pathname \+ location\.search\); route\(\); \$\('viewRoute'\)\.click\(\); return; \}/.test(drv), 'driver#route: home with My route open; never during a send');
  assert.ok(/<section class="block" id="bus-checks">/.test(read('office/buses.html')) && /<section class="block" id="today">/.test(read('office/buses.html')), 'office/buses.html: #bus-checks and #today are the sections\' own ids');
  console.log('door hashes: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
