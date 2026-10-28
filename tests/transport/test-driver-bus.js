// apps-script/coordinator-driverbus.gs + driver-token.gs: the driver's Home Base data. A linked phone gets its own bus only (make,
// model, seats from Fleet setup, else the RC scan, else the fleet list), paper expiry dates and the parts history; an unknown and a
// revoked token get the same UNLINKED answer; nothing about money or other buses. Fictional data only.
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path'), crypto = require('crypto');
const gs = (f) => fs.readFileSync(path.join(__dirname, '../../apps-script', f), 'utf8').replace(/^const /gm, 'var ');
const hash = (t) => 'sha256:' + crypto.createHash('sha256').update(t, 'utf8').digest('hex');
const T1 = 'a'.repeat(64), T2 = 'b'.repeat(64), T3 = 'c'.repeat(64);
const devices = [['Link ID', 'Token Hash', 'Reg', 'Campus', 'Driver Code', 'Driver Name', 'Created', 'Created By', 'Revoked', 'Revoked By', 'Last Seen'],
  ['L1', hash(T1), 'HP659511', 'LMS4', '', 'Test Driver', '', '', '', '', ''],
  ['L2', hash(T2), 'HP665805', 'LMS1', '', 'Other Driver', '', '', 'yes', 'x', '']];
const tabs = {
  'Fleet Profile': [{ reg: 'HP659511', papers: JSON.stringify({ make: 'Tata', modelAndVariant: '', seatingCapacityAsPerRc: '32+1' }) }, { reg: 'HP665805', papers: '{"make":"Force"}' }],
  'Parts History': [{ reg: 'HP659511', component: 'battery', fields: '{"lastReplacedOn":"2026-03-04"}' }, { reg: 'HP659511', component: 'tyre_fl', fields: '{"lastReplacedOn":"unknown"}' },
    { reg: 'HP665805', component: 'battery', fields: '{"lastReplacedOn":"2026-01-01"}' }, { reg: 'HP659511', component: 'clutch', fields: 'not json' }]
};
const ctx = { console, Date, Object, String, Math, JSON, Array, Number, RegExp, isFinite,
  SpreadsheetApp: { openById: () => ({ getSheetByName: (n) => (n === 'Driver Devices' ? { getDataRange: () => ({ getValues: () => devices.map((r) => r.slice()) }) } : null) }) },
  Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(s, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)) },
  COORD_FLEET_TABS: { profile: 'Fleet Profile', driver: 'Driver Profile', parts: 'Parts History' },
  gpsRows_: (t) => tabs[t] || [],
  coordFleetScan_: (regs) => (regs.HP659511 ? { HP659511: { modelAndVariant: { value: 'Starbus 32', disagree: false }, make: { value: 'Eicher', disagree: false } } } : {}),
  coordTransportBase_: () => ({ fleet: [{ reg: 'HP659511', bus: 'Bus 4', route: '18', seats: 33, year: 2017 }, { reg: 'HP665805', bus: 'Bus 1', seats: 12, year: 2015 }] }),
  coordTransportFleet_: () => ({ fleet: [{ reg: 'HP659511', docs: { insurance: { date: '2027-01-31', link: 'secret-link', src: 'drive' }, pollution: { na: true, date: '' } } }] }) };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../coordinator/capture/fleet-quests.js'), 'utf8'), ctx);
vm.runInContext(gs('driver-token.gs'), ctx);
vm.runInContext(gs('coordinator-driverbus.gs'), ctx);
const call = (b) => JSON.parse(JSON.stringify(vm.runInContext('coordDriverBus_(' + JSON.stringify(b) + ')', ctx)));

const me = call({ deviceToken: T1 });
assert.deepStrictEqual([me.success, me.reg, me.bus, me.route, me.year], [true, 'HP659511', 'Bus 4', '18', '2017']);
assert.deepStrictEqual([me.make, me.model, me.seats, me.fromScan], ['Tata', 'Starbus 32', '32+1', ['modelAndVariant']], 'Fleet setup first, the RC scan for what it lacks, and says which');
assert.deepStrictEqual(me.parts, { battery: '2026-03-04' }, 'own bus only; "unknown" and a bad cell stay out');
assert.deepStrictEqual(me.papers, { insurance: { date: '2027-01-31', na: false }, fitness: { date: '' }, pollution: { date: '', na: true }, speed_governor: { date: '' } }, 'dates only, never a file link');
assert.ok(!/secret-link|Other Driver|HP665805/.test(JSON.stringify(me)), 'no paper links, no other bus or driver');
const unknown = call({ deviceToken: T3 }), revoked = call({ deviceToken: T2 }), bad = call({ deviceToken: 'x' });
assert.deepStrictEqual(unknown, { success: false, code: 'UNLINKED', error: 'This phone is not linked. Ask the office for a new link.' });
assert.deepStrictEqual([revoked, bad], [unknown, unknown], 'unknown, revoked and malformed tokens get one answer');
ctx.coordTransportFleet_ = () => { throw new Error('papers tab missing'); };
assert.deepStrictEqual(call({ deviceToken: T1 }).papers.insurance, { date: '' }, 'unreadable papers: blank dates, the bus still loads');
console.log('driver bus: all checks passed');
