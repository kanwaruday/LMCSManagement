// coordinator-transport.gs: push -> stored tabs -> read back -> merged with the live form rows. Runs the real .gs in a vm with
// in-memory sheets. Covers: secret gate, tiny-payload guard, statuses (read / reread / override / n/a / unread / no expiry /
// other document), form beating scans on a tie, links, tolerance of old cached shapes, campus visibility.
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');

function sheet(name, id) {
  let data = [];
  return { name, getSheetId: () => id, clear() { data = []; }, setFrozenRows() {}, _set(v) { data = v; },
    getRange() { return { setNumberFormat() { return this; }, setFontWeight() { return this; }, setValues(v) { data = v.map(r => r.slice()); } }; },
    getDataRange: () => ({ getValues: () => data.map(r => r.slice()) }) };
}
const form = sheet('Form Responses 1', 1365845375);
form._set([['Timestamp', 'Reg', 'Doc', 'VALID TILL', 'Upload'],
  ['x', 'HP1', 'POLLUTION', '9/1/2027', 'https://drive.google.com/open?id=FORMUPLOAD123456789012345'],
  ['x', 'HP2', 'FITNESS', '1/1/2027', ''], ['x', 'HP999', 'FITNESS', '1/1/2027', '']]);
const sheets = [form];
const ss = { getSheets: () => sheets, getSheetByName: n => sheets.find(s => s.name === n) || null, getSpreadsheetTimeZone: () => 'Asia/Kolkata',
  insertSheet(n) { const s = sheet(n, 100 + sheets.length); sheets.push(s); return s; } };
const mem = {};
const ctx = { console, Date, Object, String, Math, JSON, Array, Number,
  SpreadsheetApp: { openById: () => ss },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => ' S3CRET\n' }) }, // pasted with whitespace: must still match
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  CacheService: { getScriptCache: () => ({ remove: k => delete mem[k], get: k => mem[k] || null, put: (k, v) => { mem[k] = v; } }) },
  Utilities: { formatDate: d => d.toISOString().slice(0, 10) } };
vm.createContext(ctx);
vm.runInContext('var COORD_DEPT_TRANSPORT="Transport"; function coordCacheGetBig_(){return null} function coordCachePutBig_(){} function coordVisibleCampuses_(c){return c.only||null}', ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../apps-script/coordinator-transport.gs'), 'utf8').replace(/^const /gm, 'var '), ctx);

const bus = (i, campus, extra) => Object.assign({ reg: 'HP' + i, bus: 'Bus ' + i, campus, operational: true, route: 'Route ' + i, start: '', driver: 'D' + i, seats: 40, year: 2020,
  driverCode: 'C' + i, driverStatus: 'verified', driverRosterName: 'D' + i, docs: {}, unreadable: [], noexpiry: [], other: [] }, extra || {});
const fleet = [bus(1, 'LMS 1', { docs: { pollution: { date: '2027-03-01', file: 'p.pdf', link: 'L1' }, insurance: { date: '2027-04-04', file: 'i.pdf', link: 'L2', src: 'reread', note: 'LM Studio re-read: "Valid upto 04-04-2027"' } },
    unreadable: [{ key: 'fitness', file: 'f.pdf', link: 'L3' }], noexpiry: [{ key: 'speed_governor', file: 's.pdf', link: 'L4', note: 'speed governor installation certificate' }],
    other: [{ key: 'route_permit', file: 'r.pdf', link: 'L5', note: 'initial compliance certificate' }] }),
  bus(2, 'LMS 2', { docs: { fitness: { date: '2027-01-01', file: 'f.pdf', link: 'L6' }, mv_tax: { date: '', na: true, src: 'override', note: 'not needed', file: '', link: '' } } })];
for (let i = 3; i <= 16; i++) fleet.push(bus(i, 'LMS 3'));
const payload = { syncedAt: '2026-10-21T08:00:00Z', warnings: ['bad row'], fleet, people: [{ name: 'D1', campus: 'LMS 1', designation: 'DRIVER', code: 'C1', status: 'verified', rosterName: 'D1', rosterCampus: 'LMS 1', vehicles: ['HP1'] }],
  pnl: [{ reg: 'HP1', campus: 'LMS 1', month: '2026-09', fee: 100, fuel: 10, loan: 0, fixed: 5, pay: 20, note: '' }] };
ctx.payload = payload; ctx.small = { syncedAt: payload.syncedAt, fleet: [bus(1, 'LMS 1')] };
const run = code => vm.runInContext(code, ctx);

assert.deepStrictEqual(JSON.parse(JSON.stringify(run('coordTransportPush_({secret:"nope",payload:payload})'))), { success: false, error: 'Not authorized' }, 'wrong secret refused');
assert.match(run('coordTransportPush_({secret:"S3CRET",payload:small})').error, /rejected/, 'tiny payload refused');
const pushed = run('coordTransportPush_({secret:"S3CRET",payload:payload})');
assert.strictEqual(pushed.success, true); assert.strictEqual(pushed.vehicles, 16);

const out = JSON.parse(JSON.stringify(run('coordTransport_({})')));
const v1 = out.fleet.find(b => b.reg === 'HP1'), v2 = out.fleet.find(b => b.reg === 'HP2');
assert.strictEqual(v1.docs.pollution.date, '2027-09-01', 'form (later) beats the scan');
assert.strictEqual(v1.docs.pollution.src, 'form'); assert.match(v1.docs.pollution.link, /FORMUPLOAD/, 'form entry keeps its certificate link');
assert.strictEqual(v1.docs.insurance.src, 'reread', 'a re-read date keeps its source'); assert.match(v1.docs.insurance.note, /Valid upto/);
assert.strictEqual(v1.docs.fitness.unread.length, 1, 'illegible scan stays unread');
assert.strictEqual(v1.docs.speed_governor.noexp.length, 1, 'no-expiry scan is carried'); assert.match(v1.docs.speed_governor.noexp[0].note, /speed governor/);
assert.strictEqual(v1.docs.route_permit.other.length, 1, 'wrong-paper scan is carried');
assert.strictEqual(v2.docs.fitness.date, '2027-01-01'); assert.strictEqual(v2.docs.mv_tax.na, true, 'n/a override survives the round trip');
assert.deepStrictEqual(out.unknown, ['HP999'], 'form uploads for vehicles not in the fleet are reported');
assert.strictEqual(out.people.length, 1); assert.strictEqual(out.pnl.length, 1); assert.deepStrictEqual(out.warnings, ['bad row']);
assert.strictEqual(out.fleet.find(b => b.reg === 'HP3').driverCode, 'C3');
const sheetNames = sheets.map(s => s.name);
['LM Studio Fleet', 'LM Studio Documents', 'LM Studio Sync', 'Transport Staff', 'Transport P&L'].forEach(n => assert.ok(sheetNames.includes(n), 'tab ' + n));

// a district-limited caller only sees their campuses
const lim = JSON.parse(JSON.stringify(run('coordTransport_({only:["LMS1"]})')));
assert.ok(lim.fleet.every(b => b.campusId === 'LMS1') && lim.pnl.length === 1 && lim.people.length === 1, 'campus visibility');
// an old-shaped cached form entry (no links) must not break the page
run('coordTransportLive_ = function(){ return { docs: { "HP1|pollution": "2027-09-01" }, regs: ["HP1"], rows: 1 }; }');
assert.strictEqual(run('coordTransport_({})').success, true, 'old cached shape tolerated');
console.log('transport .gs: all checks passed');
