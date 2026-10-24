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
assert.strictEqual(typeof out.serverMs, 'number', 'the page shows how long the server took');
assert.strictEqual(out.people.length, 1); assert.strictEqual(out.pnl.length, 1); assert.deepStrictEqual(out.warnings, ['bad row']);
assert.strictEqual(out.fleet.find(b => b.reg === 'HP3').driverCode, 'C3');
const sheetNames = sheets.map(s => s.name);
['LM Studio Fleet', 'LM Studio Documents', 'LM Studio Sync', 'Transport Staff', 'Transport P&L'].forEach(n => assert.ok(sheetNames.includes(n), 'tab ' + n));

// a district-limited caller only sees their campuses
const lim = JSON.parse(JSON.stringify(run('coordTransport_({only:["LMS1"]})')));
assert.ok(lim.fleet.every(b => b.campusId === 'LMS1') && lim.pnl.length === 1 && lim.people.length === 1, 'campus visibility');
// uploads from the portals: the newest one per bus and paper is "pending" until the AI Coordinator's push says it has seen the file
const up = (d, reg, paper, id, status) => [new Date(d), reg, paper, id, 'https://drive.google.com/file/d/' + id + '/view', 'clerk@lms.org.in', 'FeeClerk', 'LMS1', 'Fee Clerk Portal', status || ''];
const uploads = sheet('Portal Uploads', 900); sheets.push(uploads);
uploads._set([['Uploaded On'], up('2026-10-20T05:00:00Z', 'HP1', 'pollution', 'OLDUP'), up('2026-10-21T05:00:00Z', 'HP1', 'pollution', 'NEWUP'),
  up('2026-10-21T05:00:00Z', 'HP2', 'fitness', 'SEENUP'), up('2026-10-21T05:00:00Z', 'HP2', 'insurance', 'GONEUP', 'Withdrawn')]);
payload.seen = ['SEENUP', 'OLDUP'];
run('coordTransportPush_({secret:"S3CRET",payload:payload})');
const pu = JSON.parse(JSON.stringify(run('coordTransport_({})')));
const p1 = pu.fleet.find(b => b.reg === 'HP1').docs, p2 = pu.fleet.find(b => b.reg === 'HP2').docs;
assert.deepStrictEqual(p1.pollution.pending, { at: '2026-10-21T05:00:00.000Z', by: 'clerk@lms.org.in', link: 'https://drive.google.com/file/d/NEWUP/view' }, 'the newer of two uploads is the pending one');
assert.strictEqual(p2.fitness.pending, undefined, 'an upload the push has seen is no longer pending');
assert.strictEqual(p2.insurance.pending, undefined, 'a withdrawn upload is not pending');
assert.strictEqual(p1.fitness.pending, undefined);
const fc = JSON.parse(JSON.stringify(run('coordTransport_({feeClerkOnly:true})')));
assert.ok(fc.fleet.length && !fc.pnl.length && !fc.people.length, 'Fee Clerks get the papers but no bus money or staff list');
// Fee Clerks see only their own campus or comma list, never a whole district
const cg = fs.readFileSync(path.join(__dirname, '../../apps-script/coordinator.gs'), 'utf8');
const vis = new Function(cg.match(/const COORD_DISTRICTS = \{[\s\S]*?\};/)[0] + cg.match(/function coordVisibleCampuses_[\s\S]*?\n\}/)[0] + '; return coordVisibleCampuses_;')();
assert.deepStrictEqual(vis({ campusId: 'LMS1,LMS2', feeClerkOnly: true }), ['LMS1', 'LMS2']);
assert.deepStrictEqual(vis({ campusId: 'LMS1', feeClerkOnly: true }), ['LMS1'], 'a Fee Clerk of LMS1 does not see LMS2 and LMS3');
assert.deepStrictEqual(vis({ campusId: 'LMS1' }), ['LMS1', 'LMS2', 'LMS3'], 'a Coordinator still sees their district');
assert.match(cg, /caller\.feeClerkOnly && \['coordinatortransport', 'coordinatorbuslive', 'coordinatorbuschecks'\]\.indexOf\(action\) === -1/, 'Fee Clerks are refused every other read');
assert.match(cg, /!caller \|\| caller\.feeClerkOnly\) return coordJson_/, 'Fee Clerks are refused every write');
assert.ok(cg.indexOf("=== 'transportclerkcheck') return coordJson_(coordGpsClerkAnswer_") < cg.indexOf('!caller || caller.feeClerkOnly) return coordJson_'), 'the clerk fuel answer is the one write a Fee Clerk may make');

// an old-shaped cached form entry (no links) must not break the page
run('coordTransportLive_ = function(){ return { docs: { "HP1|pollution": "2027-09-01" }, regs: ["HP1"], rows: 1 }; }');
assert.strictEqual(run('coordTransport_({})').success, true, 'old cached shape tolerated');
console.log('transport .gs: all checks passed');
