// node tests/coordinator/test-district-scope.js -- the map homes never get another district's data from the server: the Coordinator backend cuts
// follow-ups (coordinatortasks), the resolve write and the routes (transportworld) to the caller's district before they leave Apps Script, and
// gamekingdom (the Owner's map: bases, cards, people) refuses a Coordinator before anything is read.
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const src = (f) => fs.readFileSync(path.join(__dirname, '../../apps-script', f + '.gs'), 'utf8').replace(/^const /gm, 'var ');

// a fake Tasks tab: one open follow-up per campus, one at HQ, one LMS1 follow-up assigned to the south Coordinator, one resolved
const H = ['TaskId', 'Domain', 'Campus', 'Title', 'Detail', 'Status', 'Severity', 'CreatedAt', 'LastSeenAt', 'ResolvedAt', 'ResolvedBy', 'Notes', 'Department', 'Assignee', 'Due'];
const row = (id, campus, status, assignee) => [id, 'doc_missing', campus, 'Title ' + id, 'Detail ' + id, status || 'open', 'low', new Date('2026-10-20'), new Date('2026-10-20'), '', '', '', 'HR & Staff', assignee || '', ''];
const tab = [H, row('n1', 'LMS1'), row('n2', 'LMS2'), row('n3', 'LMS3'), row('s4', 'LMS4'), row('s5', 'LMS5'), row('s6', 'LMS6'), row('hq', 'HES'),
  row('n1-mine', 'LMS1', 'open', 'south@lms.org.in'), row('s4-done', 'LMS4', 'resolved')];
const writes = [];
const sheet = { getDataRange: () => ({ getValues: () => tab.map((r) => r.slice()) }), getRange: (r, c) => ({ setValue: (v) => writes.push([r, c, v]), setValues: (v) => writes.push([r, c, v]), getValue: () => H[c - 1] }),
  getLastRow: () => tab.length };
const ctx = { console, Date, JSON, Object, String, Array, Math, Number, isFinite,
  Utilities: { formatDate: () => '2026-10-29' },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  SpreadsheetApp: { openById: () => ({ getSheetByName: () => sheet }) } };
vm.createContext(ctx);
['coordinator', 'coordinator-approvals', 'coordinator-world'].forEach((f) => vm.runInContext(src(f), ctx));
// the adapters and their sources are other tests' business: here they do nothing, so the scoping alone is under test
vm.runInContext(`
  coordRefreshSsCompliance_ = coordRefreshApprovals_ = coordRefreshHiring_ = coordRefreshDocuments_ = coordTransportRetireTasks_ = function () {};
  coordRecAttach_ = function () {}; coordFreshApprovals_ = function () { return []; }; coordAprRows_ = coordRecRows_ = function () { return []; }; coordRecLatest_ = coordRecNames_ = function () { return {}; };
  var GPS_DOMAINS = [];
  coordTransportBase_ = function () { return { fleet: ['LMS 1', 'LMS 2', 'LMS 3', 'LMS 4', 'LMS 5', 'LMS 6'].map(function (c, i) { return { reg: 'HP0' + (i + 1), campus: c, operational: true, route: 'R' + (i + 1), driver: 'D' + (i + 1) }; }) }; };
  gpsMeta_ = function () { return { fleetExtra: [], syncedAt: '' }; };
  gpsCampusId_ = function (c) { return 'LMS' + String(c).replace(/\\D/g, ''); };
  gpsAddDays_ = function (d) { return d; };
  gpsRows_ = function (name) { return name === GPS_TAB_STOPS ? [{ bus: 'HP01', name: 'Stop A', shared_with: 'HP01 HP04' }, { bus: 'HP04', name: 'Stop B', shared_with: 'HP04 HP01' }] : name === GPS_TAB_TRACKS ? [{ reg: 'HP01', path: '[]' }, { reg: 'HP05', path: '[]' }] : []; };
  var GPS_TAB_DAILY = 'd', GPS_TAB_STOPS = 's', GPS_TAB_TRACKS = 't', COORD_ROLLCALL_TAB = 'r';
  var FleetQuests = { normReg: function (r) { return r; } };
  coordFleetFills_ = function () { return {}; };
`, ctx);
const run = (c) => { const v = vm.runInContext(c, ctx); return v === undefined ? v : JSON.parse(JSON.stringify(v)); }; // plain objects: arrays from the vm are another realm's
const south = { email: 'south@lms.org.in', campusId: 'LMS5', roles: ['Coordinator'] }, north = { email: 'north@lms.org.in', campusId: 'LMS2', roles: ['Coordinator'] };
const owner = { email: 'o@lms.org.in', campusId: 'ALL', roles: ['Owner'] }, clerk = { email: 'f@lms.org.in', campusId: 'LMS4', roles: ['FeeClerk'], feeClerkOnly: true };
ctx.S = south; ctx.N = north; ctx.O = owner; ctx.F = clerk;

// the district table and who sees what
assert.deepStrictEqual(run('coordVisibleCampuses_(S)'), ['LMS4', 'LMS5', 'LMS6']);
assert.deepStrictEqual(run('coordVisibleCampuses_(N)'), ['LMS1', 'LMS2', 'LMS3']);
assert.strictEqual(run('coordVisibleCampuses_(O)'), null, 'the Owner (campus ALL): every campus');
assert.deepStrictEqual(run('coordVisibleCampuses_(F)'), ['LMS4'], 'a Fee Clerk: own campus only, never a district');
assert.deepStrictEqual(run('coordVisibleCampuses_({ email: "x", campusId: "LMS1,LMS2", roles: ["Coordinator"] })'), ['LMS1,LMS2'], 'a comma list matches no campus: nothing, never everything');

// coordinatortasks: the south Coordinator gets the south's open follow-ups and what was assigned to them; never the north's, never HQ's unassigned
const ids = (r) => r.tasks.map((t) => t.taskId).sort();
assert.deepStrictEqual(ids(run('coordTasksList_(S, "tok")')), ['n1-mine', 's4', 's5', 's6']);
assert.deepStrictEqual(ids(run('coordTasksList_(N, "tok")')), ['n1', 'n1-mine', 'n2', 'n3'], 'the north never sees south rows (a north row assigned to someone else is still the north\'s; the map leaves it off their bubbles)');
assert.deepStrictEqual(ids(run('coordTasksList_(O, "tok")')), ['hq', 'n1', 'n1-mine', 'n2', 'n3', 's4', 's5', 's6'], 'the Owner: everything open');
assert.ok(run('coordTasksList_(N, "tok")').tasks.every((t) => ['LMS1', 'LMS2', 'LMS3'].includes(t.campus)), 'every row the north gets is in the north');

// Mark resolved (from a map window): another district's follow-up is refused before anything is written
writes.length = 0;
assert.deepStrictEqual(run('coordTaskResolveCore_(N, { taskId: "s4", note: "x" })'), { success: false, error: 'Not authorized' });
assert.strictEqual(writes.length, 0, 'nothing written');
assert.strictEqual(run('coordTaskResolveCore_(S, { taskId: "s4", note: "done" })').success, true);
assert.strictEqual(run('coordTaskResolveCore_(S, { taskId: "n1-mine", note: "done" })').success, true, 'an assignee may close what was assigned to them');

// transportworld (the World): buses, stops and tracks of the district only; a shared stop does not name the other district's bus
const w = run('coordWorld_(S)');
assert.deepStrictEqual(w.vehicles.map((v) => v.reg), ['HP04', 'HP05', 'HP06']);
assert.deepStrictEqual(w.stops.map((s) => s.bus + ':' + s.shared_with), ['HP04:HP04']);
assert.deepStrictEqual(w.tracks.map((t) => t.reg), ['HP05']);
assert.strictEqual(run('coordWorld_(null)').success, false);

// gamekingdom: a Coordinator is refused before any sheet is opened (the map homes' Owner data never reaches them)
const gctx = { console, SpreadsheetApp: { openById() { throw new Error('read before the refusal'); } } };
vm.createContext(gctx);
vm.runInContext(src('game-kingdom'), gctx);
gctx.cqLoadCfg_ = () => { throw new Error('config read before the refusal'); };
for (const role of ['Coordinator', 'FeeClerk', 'Teacher', 'Driver']) {
  const r = vm.runInContext('kingdomGet_({ primaryRole: "' + role + '", roles: ["' + role + '"], email: "c@lms.org.in", campusId: "LMS5" }, {})', gctx);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r)), { success: false, code: 'KINGDOM_NOT_YOURS', error: 'The Kingdom is for the Owner.' }, role + ' refused');
}
assert.strictEqual(vm.runInContext('kingdomQuests_({ roles: ["Coordinator"] }, {})', gctx).code, 'KINGDOM_NOT_YOURS', 'All quests: Owner only');
console.log('test-district-scope ok');
