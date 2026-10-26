// node tests/game/test-fleet.js -- Fleet setup missions and quests (game-fleet.gs). Synthetic rows only: regs TEST01..., no real values.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const dir = __dirname + '/../../apps-script/';
const ctx = { console: Object.assign(Object.create(console), { error() {} }), Logger: { log() {} } }; // the expected failures below log through console.error
vm.createContext(ctx);
const load = (f) => vm.runInContext(fs.readFileSync(dir + f, 'utf8'), ctx);
load('game-fleet.gs'); load('../coordinator/capture/fleet-quests.js'); load('game.gs'); load('game-actions.gs'); load('game-missions.gs'); load('game-windows.gs'); load('game-quests.gs'); load('../coordinator/transport-rank.js');
const zlib = require('zlib');
// Apps Script services, small: a counting SpreadsheetApp (the quests must never open the workbook) and a real-ish cache
let opened = 0, store = {};
ctx.SpreadsheetApp = { openById() { opened++; throw new Error('workbook read'); } };
ctx.CacheService = { getScriptCache: () => ({ get: (k) => (k in store ? store[k] : null), getAll: (ks) => Object.fromEntries(ks.filter((k) => k in store).map((k) => [k, store[k]])), putAll: (m) => { Object.assign(store, m); } }) };
const blob = (x) => ({ data: Buffer.isBuffer(x) ? x : Buffer.from(String(x)) });
ctx.Utilities = { newBlob: (x) => blob(x), gzip: (b) => ({ getBytes: () => zlib.gzipSync(b.data) }), ungzip: (b) => ({ getDataAsString: () => zlib.gunzipSync(b.data).toString() }),
  base64Encode: (bytes) => Buffer.from(bytes).toString('base64'), base64Decode: (t) => Buffer.from(t, 'base64') };
const real = { fleetRows_: ctx.fleetRows_, fleetCachedRows_: ctx.fleetCachedRows_ };
const FQ = ctx.FleetQuests, J = (x) => JSON.parse(JSON.stringify(x));
const NOW = new Date('2026-10-26T05:00:00Z'), TODAY = '2026-10-26'; // Mon, 10:30 IST
const cfg = J(ctx.gameConfigDefaults_());
const coord = { email: 'coord@test.invalid', campusId: 'ALL', roles: ['Coordinator'], primaryRole: 'Coordinator' };
const clerk = { email: 'clerk@test.invalid', campusId: 'LMS4', roles: ['FeeClerk'], primaryRole: 'FeeClerk' };
const owner = { email: 'owner@test.invalid', campusId: 'ALL', roles: ['Owner'], primaryRole: 'Owner' };

// ---- synthetic rows, in fleetRows_'s shape (FleetQuests.profilesFromRows input)
const PAPERS = { make: 'Testmake', modelAndVariant: 'T1', chassisNo: 'CH0', engineNo: 'EN0', fuel: 'Diesel', seatingCapacityAsPerRc: '40+1', odometerToday: '100', odometerPhoto: 'photo_test_0001' };
const allParts = () => FQ.questConfig().steps.filter((s) => s.id === 'parts')[0].parts.map((p) => ({ reg: 'TEST02', component: p.id, fields: JSON.stringify({ lastReplacedOn: 'not known' }) }));
const scan = {}; ['make', 'modelAndVariant', 'chassisNo', 'engineNo', 'fuel', 'seatingCapacityAsPerRc', 'emissionNorm'].forEach((k) => { scan[k] = { value: PAPERS[k] || 'BS-VI' }; });
const rows = () => J({
  fleet: [
    { reg: 'TEST01', campus: 'LMS 4', campusId: 'LMS4', driver: 'x', driverCode: '', operational: true, scan: scan }, // papers known from scans: 6
    { reg: 'TEST02', campus: 'LMS 4', campusId: 'LMS4', driver: 'x', driverCode: '', operational: true, scan: {} },   // all but capture
    { reg: 'TEST03', campus: 'LMS 1', campusId: 'LMS1', driver: 'x', driverCode: '', operational: true, scan: {} },
    { reg: 'TEST04', campus: 'LMS 5', campusId: 'LMS5', driver: 'x', driverCode: '', operational: true, scan: {} },
    { reg: 'TEST05', campus: 'LMS 4', campusId: 'LMS4', driver: 'x', driverCode: '', operational: true, scan: {} },   // papers short of the odometer only
  ],
  profiles: [
    { reg: 'TEST02', papers: JSON.stringify(PAPERS), fuel: JSON.stringify({ usualFuelPump: 'P', paymentCreditAccountOrCash: 'Cash', driverHasASmartphoneForTheFillVideo: 'yes', whoReceivesTheFillVideoAndBill: 'C' }),
      safety: JSON.stringify({ attendantHelperName: 'none' }) },
    { reg: 'TEST05', papers: JSON.stringify(Object.assign({}, PAPERS, { odometerToday: '', odometerPhoto: '' })) },
  ],
  drivers: [{ driverKey: 'bus:TEST02', fields: JSON.stringify({ driverPhone: '9000000000', licenceClass: 'HTV', licenceValidTill: '2030-01-01', dateOfBirth: '1980-01-01',
    medicalCertificateValidTill: '2030-01-01', policeVerificationDone: 'yes', driverPhoto: 'photo_test_0002' }) }],
  parts: allParts(), inspected: { TEST02: { by: 'coord@test.invalid', at: '2026-10-01' } }, captured: {},
});
const run = (caller, r, c) => { ctx.fleetRows_ = () => r || rows(); return J(ctx.fleetMissions_(caller, c || cfg, NOW)).filter((m) => !/^fleet_ops_/.test(m.kind)); }; // Fleet Operations missions: test-fleet-ops.js
const quests = (caller, r, c) => { ctx.fleetRows_ = () => { throw new Error('quests read the workbook'); }; ctx.fleetCachedRows_ = () => r || rows(); return J(ctx.fleetQuests_(caller, c || cfg, NOW)).filter((q) => !/^fleet-(ops|pnl):/.test(q.questId)); }; // the operations quests: test-fleet-ops.js
const profileOf = (r, reg) => FQ.profilesFromRows(r).filter((p) => p.reg === reg)[0];

// ---- registration: Coordinator and FeeClerk missions, Coordinator and Owner quests, never Owner missions
const hooks = (reg, role) => J(ctx.gameModuleHooks_(ctx[reg], role).map((f) => f.name));
assert.ok(hooks('GAME_MODULE_MISSIONS', 'Coordinator').includes('fleetMissions_'));
assert.ok(hooks('GAME_MODULE_MISSIONS', 'FeeClerk').includes('fleetMissions_'));
assert.ok(!hooks('GAME_MODULE_MISSIONS', 'Owner').includes('fleetMissions_'));
assert.ok(hooks('GAME_MODULE_MISSIONS', 'Owner').includes('fleetWarm_'));      // warms the cache outside the lock (I1)
assert.ok(hooks('GAME_MODULE_QUESTS', 'Coordinator').includes('fleetQuests_'));
assert.ok(hooks('GAME_MODULE_QUESTS', 'Owner').includes('fleetQuests_'));
assert.deepStrictEqual(run(owner), []); // the Owner gets no missions, even if called
const r0warm = rows(); let warmed = 0; ctx.fleetRows_ = () => { warmed++; return r0warm; };
assert.deepStrictEqual(J(ctx.fleetWarm_()), []); assert.strictEqual(warmed, 1);
ctx.fleetRows_ = () => { throw new Error('workbook down'); };
assert.deepStrictEqual(J(ctx.fleetWarm_()), [], 'a failing warm never throws and never adds missions');

// ---- Fee Clerk: own campus, papers / driver / fuel / parts only, ranked (scan values to confirm first)
let ms = run(clerk);
assert.ok(ms.length > 0 && ms.every((m) => m.campus === 'LMS4'), 'own campus only');
assert.ok(ms.every((m) => ['fleet_papers', 'fleet_driver', 'fleet_fuel', 'fleet_parts'].includes(m.kind)));
assert.strictEqual(ms[0].id, 'fleet_papers:TEST01');
assert.strictEqual(ms[0].title, 'Confirm the 6 papers found in scans for TEST01');
assert.strictEqual(ms[0].go, 'coordinator/transport/setup.html?reg=TEST01&quest=papers');
assert.strictEqual(ms.filter((m) => m.id === 'fleet_papers:TEST05')[0].title, "Add today's odometer and photo for TEST05");
assert.strictEqual(ms.filter((m) => m.id === 'fleet_driver:TEST01')[0].title, 'Fill in the driver card for TEST01');
// closest to ready before the rest: TEST05 (papers mostly in) before TEST01's other quests
const order = ms.map((m) => m.id);
assert.ok(order.indexOf('fleet_papers:TEST05') < order.indexOf('fleet_driver:TEST01'), order.join(' '));
// a comma list of campuses is honoured; another campus's clerk sees none of LMS 4
assert.ok(run(Object.assign({}, clerk, { campusId: 'LMS4,LMS5' })).some((m) => m.campus === 'LMS5'));
assert.ok(run(Object.assign({}, clerk, { campusId: 'LMS1' })).every((m) => m.campus === 'LMS1'));

// ---- every mission: id = kind:reg, kind fleet_<quest>, go link, not core, progress = FleetQuests.progressFor
const r0 = rows();
run(coord).concat(run(clerk)).forEach((m) => {
  const [kind, reg] = m.id.split(':'), quest = kind.slice(6);
  assert.strictEqual(m.kind, kind); assert.ok(/^fleet_(papers|safety|parts|driver|fuel|capture)$/.test(kind));
  assert.strictEqual(m.go, 'coordinator/transport/setup.html?reg=' + reg + '&quest=' + quest);
  assert.strictEqual(m.core, false); assert.strictEqual(m.done, false);
  const p = FQ.progressFor(profileOf(r0, reg), TODAY).filter((x) => x.id === quest)[0];
  assert.deepStrictEqual(m.progress, { done: p.confirmed, total: p.total }, m.id);
  assert.ok(!/fast|quick|speed|hurry|rank/i.test(m.title + ' ' + m.why), 'no speed or ranking words: ' + m.title);
});

// ---- Coordinator: their own safety check + timelapse first, then "get it done" follow-ups; pilot campuses only
ms = run(coord);
assert.strictEqual(ms[0].id, 'fleet_capture:TEST02');                           // closest to ready
assert.strictEqual(ms[0].title, 'LMS 4: run the route timelapse for TEST02');
assert.strictEqual(ms.filter((m) => m.id === 'fleet_safety:TEST01')[0].title, 'LMS 4: record the monthly safety check for TEST01');
const firstFollow = ms.findIndex((m) => m.shared);
assert.ok(firstFollow > 0 && ms.slice(firstFollow).every((m) => m.shared) && ms.slice(0, firstFollow).every((m) => /safety|capture/.test(m.kind)));
assert.strictEqual(ms[firstFollow].id, 'fleet_papers:TEST01');                 // values to confirm lead the follow-ups
assert.strictEqual(ms[firstFollow].title, 'LMS 4: papers for TEST01 wait on the Fee Clerk');
assert.strictEqual(ms.filter((m) => m.id === 'fleet_driver:TEST01')[0].title, 'LMS 4: driver card for TEST01 waits on the Fee Clerk');
assert.deepStrictEqual([...new Set(ms.map((m) => m.campus))].sort(), ['LMS1', 'LMS4', 'LMS5']);
// B4: a non-ALL Coordinator gets exactly their district, as the Coordinator backend and the setup page scope them
const coord4 = Object.assign({}, coord, { campusId: 'LMS4' });
assert.deepStrictEqual([...new Set(run(coord4).map((m) => m.campus))].sort(), ['LMS4', 'LMS5'], 'district LMS 4-6 only');
assert.deepStrictEqual(quests(coord4).map((q) => q.questId), ['fleet:TEST01', 'fleet:TEST02', 'fleet:TEST04', 'fleet:TEST05']);
assert.ok(run(Object.assign({}, coord, { campusId: 'LMS2' })).every((m) => m.campus === 'LMS1'), 'district LMS 1-3');
const pilot = J(cfg); pilot.pilotCampuses.Coordinator = ['LMS4', 'LMS5'];
assert.deepStrictEqual([...new Set(run(coord, null, pilot).map((m) => m.campus))].sort(), ['LMS4', 'LMS5'], 'scoped to the pilot campuses');

// ---- a confirmed quest drops out: kept as done only on the day it was confirmed (with credit), then gone
const saved = (at) => { const r = rows(); FQ.applySave(r, 'TEST01', 'papers', PAPERS, { by: 'clerk@test.invalid', at: at }); return r; };
ms = run(clerk, saved('2026-10-26T04:00:00Z'));
let d = ms.filter((m) => m.id === 'fleet_papers:TEST01')[0];
assert.ok(d && d.done && d.doneBy === 'clerk@test.invalid' && d.doneAt === '2026-10-26T04:00:00Z' && !d.shared);
assert.deepStrictEqual(d.progress, { done: 8, total: 8 });
assert.strictEqual(ms.filter((m) => !m.done)[0].id, 'fleet_parts:TEST01', 'TEST01 is now the closest to ready: its next quest leads');
ms = run(clerk, saved('2026-10-20T04:00:00Z'));
assert.ok(!ms.some((m) => m.id === 'fleet_papers:TEST01'), 'confirmed a while ago: not today\'s story');
d = run(coord, saved('2026-10-26T04:00:00Z')).filter((m) => m.id === 'fleet_papers:TEST01')[0];
assert.ok(d.done && d.shared, 'the Coordinator sees it done, no personal credit');

const anon = rows(); anon.captured.TEST02 = { by: '', at: '2026-10-26T03:00:00Z' };
d = run(coord, anon).filter((m) => m.id === 'fleet_capture:TEST02')[0];
assert.ok(d && d.done && d.doneAt === '2026-10-26T03:00:00Z' && d.doneBy === null, 'a run with no capturer named still shows done today (M2)');

// ---- quests: one per bus for the Coordinator, parallel, six steps done from data
let qs = quests(coord);
assert.deepStrictEqual(qs.map((q) => q.questId), ['fleet:TEST01', 'fleet:TEST02', 'fleet:TEST03', 'fleet:TEST04', 'fleet:TEST05']);
let q2 = qs[1];
assert.strictEqual(q2.title, 'TEST02 · Fleet setup'); assert.strictEqual(q2.parallel, true); assert.strictEqual(q2.complete, false);
assert.deepStrictEqual(q2.steps.map((s) => [s.id, s.done]), [['papers', true], ['safety', true], ['parts', true], ['driver', true], ['fuel', true], ['capture', false]]);
assert.strictEqual(q2.steps[5].go, 'coordinator/transport/setup.html?reg=TEST02&quest=capture');
assert.ok(q2.steps.every((s) => s.locked === false));
assert.deepStrictEqual(quests(coord, null, pilot).map((q) => q.questId), ['fleet:TEST01', 'fleet:TEST02', 'fleet:TEST04', 'fleet:TEST05']);
assert.deepStrictEqual(quests(clerk), []); // Fee Clerks: missions only

// ---- Owner: per-campus readiness quests with that campus's bus quests folded in after each
const ready = rows(); ready.captured.TEST02 = { by: 'coord@test.invalid', at: '2026-10-02T00:00:00Z' };
qs = quests(owner, ready);
assert.deepStrictEqual(qs.map((q) => q.questId), ['fleet-campus:LMS1', 'fleet:TEST03', 'fleet-campus:LMS4', 'fleet:TEST01', 'fleet:TEST02', 'fleet:TEST05', 'fleet-campus:LMS5', 'fleet:TEST04']);
const c4 = qs[2];
assert.strictEqual(c4.title, 'LMS 4 fleet: 1 of 3 buses ready'); assert.strictEqual(c4.parallel, true); assert.strictEqual(c4.complete, false);
assert.deepStrictEqual(c4.steps.map((s) => [s.id, s.done]), [['TEST01', false], ['TEST02', true], ['TEST05', false]]);
assert.strictEqual(c4.steps[1].title, 'TEST02 · 6 of 6 set up'); assert.strictEqual(c4.steps[0].title, 'TEST01 · 0 of 6 set up');
assert.strictEqual(c4.steps[0].go, 'coordinator/transport/setup.html?reg=TEST01');
assert.strictEqual(qs[4].complete, true);

// ---- I1: the quests read only the cache; cold cache = no fleet quests, and the workbook is never opened
ctx.fleetRows_ = real.fleetRows_; ctx.fleetCachedRows_ = real.fleetCachedRows_; store = {}; opened = 0;
assert.deepStrictEqual(J(ctx.fleetQuests_(owner, cfg, NOW)), []); assert.deepStrictEqual(J(ctx.fleetQuests_(coord, cfg, NOW)), []);
assert.strictEqual(opened, 0, 'quests never call openById');
assert.throws(() => ctx.fleetMissions_(coord, cfg, NOW), /workbook read/); assert.strictEqual(opened, 1); // the missions hook does read (outside the lock)
// a failing read reaches the framework as down (the day is not snapshotted empty)
const down = []; ctx.gameMissionsFor_(coord, {}, Object.assign({}, cfg, { recommendationsReady: false }), NOW, down);
assert.ok(down.includes('module fleetMissions_'), JSON.stringify(down));
// cache round trip, chunked past 90,000 characters; a lost chunk is a miss
const big = rows(); big.fleet[0].route = require('crypto').randomBytes(150000).toString('hex');
ctx.fleetCachePut_('fleet_rows_v2', big, 300);
assert.ok(+store.fleet_rows_v2_n > 1, 'chunked'); assert.deepStrictEqual(J(ctx.fleetCachedRows_()), J(big));
assert.strictEqual(quests(coord, null).length, 5); store = {}; ctx.fleetCachedRows_ = real.fleetCachedRows_;
ctx.fleetCachePut_('k', { a: 1 }, 1); delete store.k_0; assert.strictEqual(ctx.fleetCacheGet_('k'), null);
opened = 0; assert.strictEqual(J(ctx.fleetQuests_(owner, cfg, NOW)).length, 0); assert.strictEqual(opened, 0);

// ---- the reader's shaping: sheet values in, profilesFromRows rows out; read failures throw
const H = (h, ...r) => [h].concat(r);
const tabs = {
  fleet: H(['Reg', 'Bus', 'Campus', 'Operational', 'Route', 'Start', 'Driver', 'Seats', 'Year', 'Driver code'],
    ['TEST-01', '1', 'LMS 4', 'yes', 'R1', '', 'x', 40, 2020, ''], ['TEST02', '2', 'LMS-5', 'yes', '', '', 'y', 30, 2019, 'E1'], ['TEST09', '9', 'LMS 1', 'no', '', '', '', 0, 0, '']),
  profile: H(['reg', 'campus', 'papers', 'safety', 'fuel', 'capture', 'saved'], ['TEST01', 'LMS4', JSON.stringify(PAPERS), '', '', '', '']),
  driver: H(['driverKey', 'reg', 'campus', 'driver', 'fields', 'ageLimit', 'updatedAt', 'updatedBy'], ['E1', 'TEST02', 'LMS5', 'Test Driver', JSON.stringify({ driverPhone: '9000000001', dateOfBirth: '1980-01-01', licenceClass: '' }), 'no', '', '']),
  parts: H(['reg', 'campus', 'component', 'fields', 'updatedAt', 'updatedBy'], ['TEST02', 'LMS5', 'battery', '{"lastReplacedOn":"not known"}', '', '']),
  papers: H(['Reg', 'Field', 'Value', 'Source document', 'Link', 'Disagree'], ['TEST02', 'make', 'Testmake', 'RC', 'l', 'no'], ['TEST02', 'mfgYear', '2019', 'RC', 'l', 'no'], ['TEST02', 'chassisNo', '', 'RC', '', 'no']),
  // Run ID | Reg | Campus | Kind | Started | Ended | By | ... | Inspection JSON (12th) | Status | Frame Times | Captured By
  runs: H(['Run ID', 'Reg', 'Campus', 'Kind', 'Started', 'Ended', 'By', '', '', '', '', 'Inspection', 'Status', 'Frames', 'Captured By'],
    ['r1', 'TEST02', 'LMS5', 'inspection', '', String(Date.parse('2026-10-25T20:00:00Z')), 'phone@test.invalid', '', '', '', '', '{"cctv":{"ok":true}}', 'ended', '', 'coord@test.invalid'],
    ['r2', 'TEST01', 'LMS4', 'inspection', '', '', 'p', '', '', '', '', '{"cctv":{"ok":true}}', 'started', '', '']),
  stops: H(['runId', 'reg', 'campus', 'videoFileId', 'stops', 'pushedAt', 'capturedBy'], ['TEST01-20261002-1', 'TEST01', 'LMS4', 'v', '[]', '2026-10-02T00:00:00Z', 'c@test.invalid'], ['TEST01-20261001-1', 'TEST01', 'LMS4', 'v', '[]', '2026-10-01T00:00:00Z', 'b@test.invalid']),
  fills: H(['reg', 'hasVideo', 'hasBill'], ['TEST02', 'yes', 'yes'], ['TEST02', 'yes', 'no'], ['TEST02', 'no', 'no']),
};
const sh = J(ctx.fleetShape_(tabs));
assert.deepStrictEqual(sh.fleet.map((b) => [b.reg, b.campusId, b.campus, b.driverCode]), [['TEST01', 'LMS4', 'LMS 4', ''], ['TEST02', 'LMS5', 'LMS 5', 'E1']]); // not running: left out
assert.deepStrictEqual(sh.fleet[1].scan, { make: { value: 'Testmake' } });   // only the papers quest's scan fields, never blanks
assert.deepStrictEqual(sh.fleet[1].fills, { count: 3, withVideo: 2, withVideoAndBill: 1 });
assert.deepStrictEqual(sh.inspected, { TEST02: { by: 'coord@test.invalid', at: '2026-10-26' } }); // ended runs only, IST day
assert.deepStrictEqual(sh.captured, { TEST01: { by: 'b@test.invalid', at: '2026-10-01T00:00:00Z' } }); // the first run
assert.strictEqual(sh.profiles.length, 1); assert.strictEqual(sh.parts.length, 1);
assert.deepStrictEqual(sh.drivers, [{ driverKey: 'E1', reg: 'TEST02', fields: JSON.stringify({ driverPhone: 1, dateOfBirth: 1, licenceClass: '' }), ageLimit: 'no' }], 'driver cards only as filled in or not (M1)');
assert.ok(!/9000000001|1980|Test Driver/.test(JSON.stringify(sh)), 'no driver values in the cached rows');
assert.deepStrictEqual(J(FQ.questsFor(FQ.profilesFromRows(sh).filter((p) => p.reg === 'TEST02')[0]).filter((q) => q.id === 'driver')[0].missing),
  ['licenceClass', 'licenceValidTill', 'medicalCertificateValidTill', 'policeVerificationDone', 'driverPhoto'], 'the done check still works on the masked card');
const p1 = FQ.profilesFromRows(sh).filter((p) => p.reg === 'TEST01')[0];
assert.strictEqual(FQ.questsFor(p1).filter((q) => q.id === 'papers')[0].done, true);
assert.strictEqual(p1.captured, true);
assert.throws(() => ctx.fleetShape_(Object.assign({}, tabs, { fleet: null })), /LM Studio Fleet/);
assert.throws(() => ctx.fleetShape_(Object.assign({}, tabs, { fleet: H(tabs.fleet[0]) })), /no vehicles/);
const noTabs = J(ctx.fleetShape_({ fleet: tabs.fleet })); // the quest tabs not made yet: nothing saved, not an outage
assert.deepStrictEqual([noTabs.profiles, noTabs.parts, noTabs.inspected, noTabs.captured], [[], [], {}, {}]);

console.log('game fleet: ok');
