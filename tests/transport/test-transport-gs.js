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
assert.strictEqual(fc.fleet.find(b => b.reg === 'HP1').seats, 40, 'Fee Clerks get the seats (the capture page\'s count-run summary needs them)');
// Fee Clerks see only their own campus or comma list, never a whole district
const cg = fs.readFileSync(path.join(__dirname, '../../apps-script/coordinator.gs'), 'utf8');
const vis = new Function(cg.match(/const COORD_DISTRICTS = \{[\s\S]*?\};/)[0] + cg.match(/function coordVisibleCampuses_[\s\S]*?\n\}/)[0] + '; return coordVisibleCampuses_;')();
assert.deepStrictEqual(vis({ campusId: 'LMS1,LMS2', feeClerkOnly: true }), ['LMS1', 'LMS2']);
assert.deepStrictEqual(vis({ campusId: 'LMS1', feeClerkOnly: true }), ['LMS1'], 'a Fee Clerk of LMS1 does not see LMS2 and LMS3');
assert.deepStrictEqual(vis({ campusId: 'LMS1' }), ['LMS1', 'LMS2', 'LMS3'], 'a Coordinator still sees their district');
assert.match(cg, /caller\.feeClerkOnly && \['coordinatortransport', 'coordinatorbuslive', 'coordinatorbuschecks', 'coordinatortransportloadout'\]\.indexOf\(action\) === -1/, 'Fee Clerks are refused every other read (the loadout is a read for every transport role)');
assert.match(cg, /!caller \|\| caller\.feeClerkOnly\) return coordJson_/, 'Fee Clerks are refused every write');
assert.ok(cg.indexOf("=== 'transportclerkcheck') return coordJson_(coordGpsClerkAnswer_") < cg.indexOf('!caller || caller.feeClerkOnly) return coordJson_'), 'the clerk fuel answer is the one write a Fee Clerk may make');

// an old-shaped cached form entry (no links) must not break the page
run('coordTransportLive_ = function(){ return { docs: { "HP1|pollution": "2027-09-01" }, regs: ["HP1"], rows: 1 }; }');
assert.strictEqual(run('coordTransport_({})').success, true, 'old cached shape tolerated');

// ── Safety loadout (Owner-edited) and the monthly safety check, with the real task store (fake books) ──
{
  const J = x => JSON.parse(JSON.stringify(x));
  function sheet2(name) {
    let data = [];
    return { name, getLastRow: () => data.length, setFrozenRows() {}, clear() { data = []; }, appendRow(r) { data.push(r.slice()); }, _rows: () => data,
      getDataRange: () => ({ getValues: () => data.map(r => r.slice()) }),
      getRange(r, c) {
        return { setNumberFormat() { return this; }, setFontWeight() { return this; },
          setValues(v) { v.forEach((row, i) => { data[r - 1 + i] = data[r - 1 + i] || []; row.forEach((x, j) => { data[r - 1 + i][c - 1 + j] = x; }); }); return this; },
          setValue(x) { data[r - 1] = data[r - 1] || []; data[r - 1][c - 1] = x; return this; }, getValue: () => (data[r - 1] || [])[c - 1] };
      } };
  }
  const books = {};
  const book = id => books[id] = books[id] || { sheets: {}, getSheetByName(n) { return this.sheets[n] || null; }, insertSheet(n) { return this.sheets[n] = sheet2(n); }, getSheets() { return Object.values(this.sheets); } };
  const c = { console, Date, Object, String, Math, JSON, Array, Number, isFinite, parseFloat, isNaN,
    SpreadsheetApp: { openById: id => book(id) }, LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) }, Utilities: { formatDate: d => d.toISOString().slice(0, 10) } };
  vm.createContext(c);
  ['coordinator.gs', 'coordinator-approvals.gs', 'coordinator-transport.gs', 'coordinator-transport-gps.gs']
    .forEach(f => vm.runInContext(fs.readFileSync(path.join(__dirname, '../../apps-script', f), 'utf8').replace(/^const /gm, 'var '), c));
  const r = code => J(vm.runInContext(code, c));
  const FORM = vm.runInContext('COORD_TRANSPORT_FORM_ID', c);
  const owner = '{email:"o@x.org", campusId:"ALL", roles:["Owner"]}', coord = '{email:"c4@x.org", campusId:"LMS4", roles:["Coordinator"]}';

  // Owner can set the list; Coordinator POST refused
  const seed = r('coordLoadout_(' + coord + ')');
  assert.strictEqual(seed.success, true);
  assert.strictEqual(seed.items.length, 10, 'an empty Safety Loadout tab gives the seed list');
  assert.deepStrictEqual(Object.keys(seed.items[0]).sort(), ['id', 'label', 'needsDate', 'needsPhoto', 'order']);
  const fe = seed.items.find(i => /fire extinguisher/i.test(i.label)), sg = seed.items.find(i => /speed governor/i.test(i.label));
  assert.ok(fe && fe.id === 'fire_extinguisher' && fe.needsDate, 'fire extinguisher with its refill date');
  assert.ok(sg && /40 km\/h/.test(sg.label) && sg.needsDate, 'speed governor (40 km/h) with its certificate date');
  ['GPS tracker', 'CCTV', 'First-aid box', 'Window grills', 'Emergency exit', 'Door lock', 'School name and phone', 'Attendant on board']
    .forEach(l => assert.ok(seed.items.some(i => i.label.toLowerCase().indexOf(l.toLowerCase()) === 0), 'seed has ' + l));
  assert.strictEqual(seed.all, undefined, 'a Coordinator gets the active list only');
  const edit = seed.items.map(i => Object.assign({}, i, { active: true }));
  edit.unshift(edit.splice(edit.findIndex(i => i.id === 'fire_extinguisher'), 1)[0]);            // reorder: fire extinguisher first
  edit.find(i => i.id === 'gps_tracker').label = 'GPS tracker (Blackbox)';                        // rename
  edit.find(i => i.id === 'cctv').active = false;                                                 // deactivate
  edit.push({ label: 'Seat belts for the driver', needsPhoto: true, needsDate: false, active: true }); // add
  c.edit = edit;
  const refused = r('coordLoadoutSet_(' + coord + ', {items: edit})');
  assert.strictEqual(refused.success, false); assert.match(refused.error, /Owner/, 'Coordinator POST refused');
  assert.strictEqual(book(FORM).getSheetByName('Safety Loadout'), null, 'a refused POST writes nothing');
  assert.strictEqual(r('coordLoadoutSet_(' + owner + ', {items: edit})').success, true, 'Owner can set the list');
  const tab = book(FORM).getSheetByName('Safety Loadout')._rows();
  assert.deepStrictEqual(tab[0], ['Item ID', 'Label', 'Needs photo', 'Needs date', 'Order', 'Active']);
  const after = r('coordLoadout_(' + coord + ')').items;
  assert.strictEqual(after[0].id, 'fire_extinguisher', 'the Owner\'s order is kept');
  assert.strictEqual(after.find(i => i.id === 'gps_tracker').label, 'GPS tracker (Blackbox)', 'a rename keeps the id');
  assert.deepStrictEqual(after[after.length - 1], { id: 'seat_belts_for_the_driver', label: 'Seat belts for the driver', needsPhoto: true, needsDate: false, order: 11 }, 'a new item gets an id from its label');
  // inactive items hidden from inspection
  assert.ok(!after.some(i => i.id === 'cctv'), 'inactive items hidden from inspection');
  const all = r('coordLoadout_(' + owner + ')').all;
  assert.deepStrictEqual([all.length, all.find(i => i.id === 'cctv').active], [11, false], 'the Owner still sees the inactive item, to switch it back on');
  c.dup = [{ id: 'cctv', label: 'A' }, { id: 'cctv', label: 'B' }];
  assert.match(r('coordLoadoutSet_(' + owner + ', {items: dup})').error, /twice/);
  assert.match(r('coordLoadoutSet_(' + owner + ', {items: [{label: "  "}]})').error, /name/);
  assert.strictEqual(r('coordLoadout_(' + owner + ')').all.length, 11, 'a refused list leaves the saved one alone');
  assert.match(cg, /action === 'coordinatortransportloadout'\) return coordJson_\(coordLoadout_\(caller\)\)/, 'GET route');
  assert.match(cg, /action === 'coordinatortransportloadout'\) return coordJson_\(coordLoadoutSet_\(caller, body\)\)/, 'POST route');
  assert.ok(cg.indexOf('coordLoadoutSet_(caller, body)') > cg.indexOf('!caller || caller.feeClerkOnly) return coordJson_'), 'Fee Clerks never reach the loadout POST');

  // Capture Runs rows as transport-capture.gs writes them (startedAt/endedAt in ms)
  const runs = book(FORM).insertSheet('Capture Runs');
  runs.appendRow(['Run ID', 'Reg', 'Campus', 'Kind (timelapse/count/inspection)', 'Started', 'Ended', 'By', 'Role', 'Frames', 'Gaps JSON', 'Stops JSON', 'Inspection JSON', 'Status']);
  const ms = iso => Date.parse(iso + 'T06:00:00Z');
  const capRun = (id, reg, kind, day, insp, status) => runs.appendRow([id, reg, 'LMS4', kind, ms(day) - 600000, status === 'running' ? '' : ms(day), 'c4@x.org', 'Coordinator', 2, '[]', '[]', insp ? JSON.stringify(insp) : '', status || 'ended']);
  const okAll = extra => Object.assign({}, ...after.map(i => ({ [i.id]: { ok: true } })), extra);
  capRun('HP1-a', 'HP1', 'inspection', '2026-10-20', okAll({ fire_extinguisher: { ok: false }, cctv: { ok: false } }));  // cctv is inactive now
  capRun('HP1-t', 'HP1', 'timelapse', '2026-11-02', null);
  capRun('HP2-a', 'HP2', 'inspection', '2026-10-21', okAll({ fire_extinguisher: { ok: true, date: '2026-09-01', fileId: 'F1' } }));
  capRun('HP2-b', 'HP2', 'inspection', '2026-11-03', okAll(), 'running');                  // never finished: does not count
  capRun('HP2-c', 'HP2', 'inspection', '2026-11-03', null);                              // ended without answers: does not count
  const fleet2 = [{ reg: 'HP1', campus: 'LMS 4', operational: true, year: 2020 }, { reg: 'HP2', campus: 'LMS 4', operational: true, year: 2020 }, { reg: 'HP3', campus: 'LMS 4', operational: false, year: 2020 }];
  c.factsOn = today => ({ today, fleet: fleet2, live: null, health: [], days: [], checks: [], fills: [], answers: [], inspections: vm.runInContext('coordInspections_()', c), loadout: after });
  const ins = r('coordInspections_()');
  assert.deepStrictEqual(ins.map(x => x.reg + ' ' + x.day).sort(), ['HP1 2026-10-20', 'HP2 2026-10-21'], 'only ended inspection runs with answers count');

  // inspection run with fire extinguisher ok:false raises a follow-up for that bus
  const oct = r('gpsFollowUps_(factsOn("2026-10-25"))');
  const eq = oct.filter(x => x.domain === 'bus_equipment');
  assert.deepStrictEqual(eq.map(x => x.taskId), ['bus_equipment|HP1|fire_extinguisher'], 'the missing item raises a follow-up for that bus; an inactive item does not');
  assert.deepStrictEqual([eq[0].due, eq[0].campus, eq[0].auto, eq[0].severity], ['2026-10-28', 'LMS4', true, 'high'], 'due in 3 days, closes itself');
  assert.match(eq[0].title, /^HP1: Fire extinguisher/);
  assert.ok(!oct.some(x => x.domain === 'bus_inspection'), 'both buses were checked this month');

  // bus_inspection raised on the 5th when no inspection this month, resolves after one is saved
  assert.ok(!r('gpsFollowUps_(factsOn("2026-11-04"))').some(x => x.domain === 'bus_inspection'), 'before the 5th, last month\'s check still counts');
  const nov = r('gpsFollowUps_(factsOn("2026-11-05"))').filter(x => x.domain === 'bus_inspection');
  assert.deepStrictEqual(nov.map(x => x.taskId).sort(), ['bus_inspection|HP1', 'bus_inspection|HP2'], 'raised on the 5th for every running bus without a check this month (not HP3, off the road)');
  assert.deepStrictEqual([nov[0].due, nov[0].auto, nov[0].campus], ['2026-11-10', true, 'LMS4'], 'due in 5 days, closes itself');
  assert.strictEqual(nov[0].detail, 'Do this month\'s safety check in the capture portal');
  c.COORD_ALLOWLIST_SHEET_ID = 'ALLOW'; c.COORD_SHEET_ID = 'TASKS';
  book('ALLOW').insertSheet('a')._rows().push(['Email', 'Name', 'Campus', 'Roles'], ['c4@x.org', 'C4', 'LMS4', 'Coordinator']);
  const cover = '{bus_inspection: true, bus_equipment: true}';
  vm.runInContext('gpsRaise_(gpsFollowUps_(factsOn("2026-11-05")), ' + cover + ')', c);
  const task = id => book('TASKS').getSheetByName('Tasks')._rows().find(x => x[0] === id);
  assert.deepStrictEqual([task('bus_inspection|HP1')[5], task('bus_inspection|HP1')[13], task('bus_inspection|HP1')[14]], ['open', 'c4@x.org', '2026-11-10']);
  assert.strictEqual(task('bus_equipment|HP1|fire_extinguisher')[5], 'open', 'the October fire extinguisher is still missing');
  capRun('HP1-b', 'HP1', 'inspection', '2026-11-06', okAll({ fire_extinguisher: { ok: true, date: '2026-11-06', fileId: 'F2' } }));
  vm.runInContext('gpsRaise_(gpsFollowUps_(factsOn("2026-11-06")), ' + cover + ')', c);
  assert.strictEqual(task('bus_inspection|HP1')[5], 'resolved', 'the check is saved: the follow-up closes itself');
  assert.strictEqual(task('bus_equipment|HP1|fire_extinguisher')[5], 'resolved', 'the new check has the fire extinguisher: closed');
  assert.strictEqual(task('bus_inspection|HP2')[5], 'open', 'HP2 still has no check this month');
  assert.ok(r('GPS_DOMAINS').indexOf('bus_inspection') !== -1 && r('GPS_DOMAINS').indexOf('bus_equipment') !== -1, 'the Coordinator page lists them with the other transport follow-ups');
  assert.ok(/bus_inspection: true, bus_equipment: true/.test(fs.readFileSync(path.join(__dirname, '../../apps-script/coordinator-transport-gps.gs'), 'utf8')), 'the daily refresh closes them');
}
console.log('transport .gs: all checks passed');
