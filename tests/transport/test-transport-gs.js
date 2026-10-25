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
assert.match(cg, /caller\.feeClerkOnly && \['coordinatortransport', 'coordinatorbuslive', 'coordinatorbuschecks', 'coordinatortransportloadout', 'coordinatortransportfleet'\]\.indexOf\(action\) === -1/, 'Fee Clerks are refused every other read (the loadout and the fleet setup are reads for every transport role)');
assert.match(cg, /!caller \|\| caller\.feeClerkOnly\) return coordJson_/, 'Fee Clerks are refused every write');
assert.ok(cg.indexOf("=== 'transportclerkcheck') return coordJson_(coordGpsClerkAnswer_") < cg.indexOf('!caller || caller.feeClerkOnly) return coordJson_'), 'the clerk fuel answer is a write a Fee Clerk may make');
assert.ok(cg.indexOf("=== 'coordinatortransportfleetsave') return coordJson_(coordFleetSave_(caller, body))") < cg.indexOf('!caller || caller.feeClerkOnly) return coordJson_'), 'and so is a fleet setup quest (scope checked inside)');
assert.match(cg, /action === 'coordinatortransportfleet'\) return coordJson_\(coordFleet_\(caller\)\)/, 'fleet setup GET route');

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
  const seedTab = J(book(FORM).getSheetByName('Safety Loadout')._rows());
  assert.deepStrictEqual(seedTab.slice(1).map(x => x[0]), seed.items.map(i => i.id), 'the seed is written to the tab on first read, so the capture server knows its ids');
  assert.strictEqual(typeof seed.version, 'string', 'the list carries a version, so a stale editor cannot overwrite a newer list');
  const edit = seed.items.map(i => Object.assign({}, i, { active: true }));
  edit.unshift(edit.splice(edit.findIndex(i => i.id === 'fire_extinguisher'), 1)[0]);            // reorder: fire extinguisher first
  edit.find(i => i.id === 'gps_tracker').label = 'GPS tracker (Blackbox)';                        // rename
  edit.find(i => i.id === 'cctv').active = false;                                                 // deactivate
  edit.push({ label: 'Seat belts for the driver', needsPhoto: true, needsDate: false, active: true }); // add
  c.edit = edit; c.v0 = seed.version;
  const refused = r('coordLoadoutSet_(' + coord + ', {items: edit, version: v0})');
  assert.strictEqual(refused.success, false); assert.match(refused.error, /Owner/, 'Coordinator POST refused');
  const tabNow = () => J(book(FORM).getSheetByName('Safety Loadout')._rows());
  assert.deepStrictEqual(tabNow(), seedTab, 'a refused POST writes nothing');
  // ids are for life: every known id must come back, new items come without one, and a stale editor is refused
  c.omit = edit.filter(i => i.id !== 'cctv');
  assert.match(r('coordLoadoutSet_(' + owner + ', {items: omit, version: v0})').error, /switch it off.*cctv/i, 'an item left out is refused, never deleted');
  c.unknown = edit.concat([{ id: 'foo', label: 'Foo' }]);
  assert.match(r('coordLoadoutSet_(' + owner + ', {items: unknown, version: v0})').error, /Unknown item id: foo/, 'an id the server never issued is refused');
  assert.match(r('coordLoadoutSet_(' + owner + ', {items: edit, version: "old"})').error, /The list changed since you opened it. Reload, then save again./, 'a stale editor is refused');
  assert.match(r('coordLoadoutSet_(' + owner + ', {items: edit})').error, /Reload/, 'no version, no save');
  assert.deepStrictEqual(tabNow(), seedTab, 'and none of those wrote anything');
  edit.find(i => i.id === 'door_lock').needsPhoto = 'false'; // only a real true counts
  edit.find(i => i.id === 'attendant').label = '=HYPERLINK("x")Attendant on board';
  assert.strictEqual(r('coordLoadoutSet_(' + owner + ', {items: edit, version: v0})').success, true, 'Owner can set the list');
  assert.match(r('coordLoadoutSet_(' + owner + ', {items: edit, version: v0})').error, /Reload/, 'the same old version cannot save twice');
  const tab = book(FORM).getSheetByName('Safety Loadout')._rows();
  assert.deepStrictEqual(tab[0], ['Item ID', 'Label', 'Needs photo', 'Needs date', 'Order', 'Active']);
  const after = r('coordLoadout_(' + coord + ')').items;
  assert.strictEqual(after[0].id, 'fire_extinguisher', 'the Owner\'s order is kept');
  assert.strictEqual(after.find(i => i.id === 'gps_tracker').label, 'GPS tracker (Blackbox)', 'a rename keeps the id');
  assert.deepStrictEqual(after[after.length - 1], { id: 'seat_belts_for_the_driver', label: 'Seat belts for the driver', needsPhoto: true, needsDate: false, order: 11 }, 'a new item gets an id from its label');
  assert.strictEqual(after.find(i => i.id === 'door_lock').needsPhoto, false, 'the string "false" is not true');
  assert.ok(!/^[=+\-@]/.test(after.find(i => i.id === 'attendant').label), 'a label never starts like a formula');
  // inactive items hidden from inspection
  assert.ok(!after.some(i => i.id === 'cctv'), 'inactive items hidden from inspection');
  const all = r('coordLoadout_(' + owner + ')').all;
  assert.deepStrictEqual([all.length, all.find(i => i.id === 'cctv').active], [11, false], 'the Owner still sees the inactive item, to switch it back on');
  c.v1 = r('coordLoadout_(' + owner + ')').version;
  c.dup = all.concat([{ id: 'cctv', label: 'B' }]);
  assert.match(r('coordLoadoutSet_(' + owner + ', {items: dup, version: v1})').error, /twice/);
  c.blank = all.concat([{ label: '  ' }]);
  assert.match(r('coordLoadoutSet_(' + owner + ', {items: blank, version: v1})').error, /name/);
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
  capRun('HP2-d', 'HP2', 'inspection', '2026-10-01', okAll({ door_lock: { ok: 'true' } }));  // hand-edited row: only ok === true is present
  const ins = r('coordInspections_()');
  assert.strictEqual(ins.find(x => x.runId === 'HP2-d').items.door_lock.ok, false, 'ok "true" (text) does not count as present');
  assert.deepStrictEqual(ins.map(x => x.reg + ' ' + x.day).sort(), ['HP1 2026-10-20', 'HP2 2026-10-01', 'HP2 2026-10-21'], 'only ended inspection runs with answers count');

  // inspection run with fire extinguisher ok:false raises a follow-up for that bus
  const oct = r('gpsFollowUps_(factsOn("2026-10-25"))');
  const eq = oct.filter(x => x.domain === 'bus_equipment');
  assert.deepStrictEqual(eq.map(x => x.taskId), ['bus_equipment|HP1|fire_extinguisher'], 'the missing item raises a follow-up for that bus; an inactive item does not');
  assert.deepStrictEqual([eq[0].due, eq[0].campus, eq[0].auto, eq[0].severity], ['2026-10-28', 'LMS4', true, 'high'], 'due in 3 days, closes itself');
  assert.match(eq[0].title, /^HP1: Fire extinguisher/);
  assert.ok(!oct.some(x => x.domain === 'bus_inspection'), 'both buses were checked this month');

  // Ruling 21: no bus_inspection for months before the deploy-set start month; M2: none while every item is switched off
  const from0 = vm.runInContext('GPS.inspectionFrom', c);
  assert.match(from0, /^\d{4}-\d{2}$/, 'GPS.inspectionFrom is a yyyy-MM set at deploy');
  c.bare = today => Object.assign(c.factsOn(today), { inspections: [] });
  vm.runInContext('GPS.inspectionFrom = "2026-11"', c);
  assert.ok(!r('gpsFollowUps_(bare("2026-10-25"))').some(x => x.domain === 'bus_inspection'), 'October is before the start month: nothing raised');
  assert.ok(!r('gpsFollowUps_(bare("2026-11-04"))').some(x => x.domain === 'bus_inspection'), 'before the 5th the due month is still October: nothing raised');
  assert.strictEqual(r('gpsFollowUps_(bare("2026-11-05"))').filter(x => x.domain === 'bus_inspection').length, 2, 'from the 5th of the start month it is raised');
  vm.runInContext('GPS.inspectionFrom = "2026-10"', c);
  assert.strictEqual(r('gpsFollowUps_(bare("2026-10-25"))').filter(x => x.domain === 'bus_inspection').length, 2, 'an earlier start month raises it in October');
  assert.ok(!r('gpsFollowUps_(Object.assign(bare("2026-10-25"), {loadout: []}))').some(x => x.domain === 'bus_inspection'), 'every item switched off: no check can be done, nothing raised');
  vm.runInContext('GPS.inspectionFrom = ' + JSON.stringify(from0), c);
  vm.runInContext('GPS.inspectionFrom = "2026-11"', c); // the scenario below starts in November

  // bus_inspection raised on the 5th when no inspection this month, resolves after one is saved
  assert.ok(!r('gpsFollowUps_(factsOn("2026-11-04"))').some(x => x.domain === 'bus_inspection'), 'before the 5th, last month\'s check still counts');
  const nov = r('gpsFollowUps_(factsOn("2026-11-05"))').filter(x => x.domain === 'bus_inspection');
  assert.deepStrictEqual(nov.map(x => x.taskId).sort(), ['bus_inspection|HP1', 'bus_inspection|HP2'], 'raised on the 5th for every running bus without a check this month (not HP3, off the road)');
  assert.deepStrictEqual([nov[0].due, nov[0].auto, nov[0].campus], ['2026-11-10', true, 'LMS4'], 'due in 5 days, closes itself');
  assert.strictEqual(nov[0].detail, 'Do this month\'s safety check in the capture portal');
  c.COORD_ALLOWLIST_SHEET_ID = 'ALLOW'; c.COORD_SHEET_ID = 'TASKS';
  book('ALLOW').insertSheet('a')._rows().push(['Email', 'Name', 'Campus', 'Roles'], ['c4@x.org', 'C4', 'LMS4', 'Coordinator']);
  const cover = 'gpsInspectionCover_(factsOn("x").fleet, coordInspections_(), coordLoadoutAll_().filter(function (i) { return i.active; }))';
  const cv = r(cover);
  assert.deepStrictEqual(Object.keys(cv.bus_inspection).sort(), ['HP1', 'HP2', 'HP3'], 'only the fleet\'s buses are covered');
  assert.ok(cv.bus_equipment['HP1|fire_extinguisher'] && !cv.bus_equipment['HP1|cctv'], 'equipment is covered per bus and active item');
  assert.deepStrictEqual(r('gpsInspectionCover_(factsOn("x").fleet, null, [])'), { bus_inspection: {}, bus_equipment: {} }, 'no Capture Runs tab: nothing may close');
  vm.runInContext('gpsRaise_(gpsFollowUps_(factsOn("2026-11-05")), ' + cover + ')', c);
  const task = id => book('TASKS').getSheetByName('Tasks')._rows().find(x => x[0] === id);
  assert.deepStrictEqual([task('bus_inspection|HP1')[5], task('bus_inspection|HP1')[13], task('bus_inspection|HP1')[14]], ['open', 'c4@x.org', '2026-11-10']);
  assert.strictEqual(task('bus_equipment|HP1|fire_extinguisher')[5], 'open', 'the October fire extinguisher is still missing');
  // switching an item off must not read as "cleared": its open follow-up stays for a person to close
  c.v2 = r('coordLoadout_(' + owner + ')'); c.off = c.v2.all.map(i => Object.assign({}, i, { active: i.id === 'fire_extinguisher' ? false : i.active }));
  assert.strictEqual(r('coordLoadoutSet_(' + owner + ', {items: off, version: v2.version})').success, true);
  vm.runInContext('gpsRaise_(gpsFollowUps_(Object.assign(factsOn("2026-11-05"), {loadout: coordLoadoutAll_().filter(function (i) { return i.active; })})), ' + cover + ')', c);
  assert.strictEqual(task('bus_equipment|HP1|fire_extinguisher')[5], 'open', 'the item was switched off, not fixed: the follow-up stays open');
  c.on = r('coordLoadout_(' + owner + ')'); c.on2 = c.on.all.map(i => Object.assign({}, i, { active: i.id === 'fire_extinguisher' ? true : i.active }));
  assert.strictEqual(r('coordLoadoutSet_(' + owner + ', {items: on2, version: on.version})').success, true);
  capRun('HP1-b', 'HP1', 'inspection', '2026-11-06', okAll({ fire_extinguisher: { ok: true, date: '2026-11-06', fileId: 'F2' } }));
  vm.runInContext('gpsRaise_(gpsFollowUps_(factsOn("2026-11-06")), ' + cover + ')', c);
  assert.strictEqual(task('bus_inspection|HP1')[5], 'resolved', 'the check is saved: the follow-up closes itself');
  assert.strictEqual(task('bus_equipment|HP1|fire_extinguisher')[5], 'resolved', 'the new check has the fire extinguisher: closed');
  assert.strictEqual(task('bus_inspection|HP2')[5], 'open', 'HP2 still has no check this month');
  assert.ok(r('GPS_DOMAINS').indexOf('bus_inspection') !== -1 && r('GPS_DOMAINS').indexOf('bus_equipment') !== -1, 'the Coordinator page lists them with the other transport follow-ups');
  assert.ok(/gpsInspectionCover_\(base\.fleet, inspections, loadout\)/.test(fs.readFileSync(path.join(__dirname, '../../apps-script/coordinator-transport-gps.gs'), 'utf8')), 'the daily refresh closes them with that cover');
  c.partial = Object.assign(c.factsOn('2026-11-09'), { inspections: [{ reg: 'HP1', runId: 'a', day: '2026-11-01', items: { fire_extinguisher: { ok: false } } },
    { reg: 'HP1', runId: 'b', day: '2026-11-08', items: { door_lock: { ok: true } } }] });
  assert.ok(r('gpsFollowUps_(partial)').some(x => x.taskId === 'bus_equipment|HP1|fire_extinguisher'), 'a later check that left the item out (an older list on the phone) does not clear it');
  // a new item never takes an id that answers already use, even if its row was deleted from the sheet by hand
  capRun('HP1-z', 'HP1', 'inspection', '2026-11-07', okAll({ old_kit: { ok: true } }));
  c.v3 = r('coordLoadout_(' + owner + ')'); c.add = c.v3.all.concat([{ label: 'Old kit' }]);
  assert.strictEqual(r('coordLoadoutSet_(' + owner + ', {items: add, version: v3.version})').all.slice(-1)[0].id, 'old_kit_2', 'a fresh id, never a reused one');
  // a row typed into the sheet by hand with a messy id is read back clean, so it does not block the Owner's saves
  book(FORM).getSheetByName('Safety Loadout')._rows().push(['Seat-Belts ', 'Seat belts', 'no', 'no', '99', '']);
  assert.ok(r('coordLoadout_(' + owner + ')').all.some(i => i.id === 'seat_belts'), 'a hand-typed id is normalised on read');
}

// ── Fleet setup quests (Task 8): GET coordinatortransportfleet and POST coordinatortransportfleetsave, with the real
// coordinator .gs files, the shared pure logic (coordinator/capture/fleet-quests.js, deployed into this project) and fake books ──
{
  const J = x => JSON.parse(JSON.stringify(x));
  function sheet3(name) {
    let data = [];
    return { name, clears: 0, getLastRow: () => data.length, setFrozenRows() {}, clear() { this.clears++; data = []; }, appendRow(r) { data.push(r.slice()); }, _rows: () => data,
      getDataRange: () => ({ getValues: () => data.map(r => r.slice()) }),
      getRange(r, c) { return { setNumberFormat() { return this; }, setFontWeight() { return this; },
        setValues(v) { v.forEach((row, i) => { data[r - 1 + i] = data[r - 1 + i] || []; row.forEach((x, j) => { data[r - 1 + i][c - 1 + j] = x; }); }); return this; },
        setValue(x) { data[r - 1][c - 1] = x; return this; } }; } };
  }
  const books = {};
  const book = id => books[id] = books[id] || { sheets: {}, getSpreadsheetTimeZone: () => 'Asia/Kolkata', getSheetByName(n) { return this.sheets[n] || null; }, insertSheet(n) { return this.sheets[n] = sheet3(n); }, getSheets() { return Object.values(this.sheets); } };
  const c = { console, Date, Object, String, Math, JSON, Array, Number, isFinite, parseFloat, isNaN, RegExp,
    SpreadsheetApp: { openById: id => book(id) }, LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) }, Utilities: { formatDate: d => d.toISOString().slice(0, 10) } };
  vm.createContext(c);
  ['coordinator.gs', 'coordinator-approvals.gs', 'coordinator-transport.gs', 'coordinator-transport-gps.gs']
    .forEach(f => vm.runInContext(fs.readFileSync(path.join(__dirname, '../../apps-script', f), 'utf8').replace(/^const /gm, 'var '), c));
  const proj = JSON.parse(fs.readFileSync(path.join(__dirname, '../../apps-script/projects.json'), 'utf8')).coordinator.files;
  const shared = proj.filter(f => f.indexOf('/') !== -1);
  assert.deepStrictEqual(shared, ['../coordinator/capture/fleet-quests.js'], 'deploy.mjs puts the shared quest logic into the Coordinator project');
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../apps-script', shared[0]), 'utf8'), c);
  vm.runInContext('coordCacheGetBig_ = function () { return null; }; coordCachePutBig_ = function () {}; coordFleetToday_ = function () { return "2026-10-25"; };', c);
  const r = code => J(vm.runInContext(code, c));
  const FORM = vm.runInContext('COORD_TRANSPORT_FORM_ID', c), tb = n => book(FORM).getSheetByName(n);
  const fleetTab = book(FORM).insertSheet('LM Studio Fleet');
  fleetTab.appendRow(['Reg', 'Bus', 'Campus', 'Running', 'Route', 'Start point', 'Driver', 'Seats', 'Year', 'Driver code', 'Driver link', 'Staff master name']);
  [['HP1', 'LMS 4', 'yes', 'E1'], ['HP2', 'LMS 1', 'yes', 'E2'], ['HP5', 'LMS-5', 'yes', 'E5'], ['HP9', 'LMS 5', 'no', ''], ['HP 6-7', 'LMS 6', 'yes', '']].forEach(x => fleetTab.appendRow([x[0], 'Bus', x[1], x[2], '18', '', 'D ' + x[0], 40, 2020, x[3], '', '']));
  book(FORM).insertSheet('LM Studio Documents').appendRow(['Reg']); book(FORM).insertSheet('LM Studio Sync').appendRow(['Key', 'Value']);
  const fc4 = '{email:"f4@x.org", campusId:"LMS4", roles:["FeeClerk"], feeClerkOnly:true}', fc1 = '{email:"f1@x.org", campusId:"LMS1", roles:["FeeClerk"], feeClerkOnly:true}';
  const co4 = '{email:"c4@x.org", campusId:"LMS4", roles:["Coordinator"]}', co1 = '{email:"c1@x.org", campusId:"LMS1", roles:["Coordinator"]}', own = '{email:"o@x.org", campusId:"ALL", roles:["Owner"]}', coAll = '{email:"ca@x.org", campusId:"ALL", roles:["Coordinator"]}';
  const save = (who, b) => { c.b = b; return r('coordFleetSave_(' + who + ', b)'); };

  // Fee Clerk can save LMS 4 papers, refused for LMS 1
  const ok = save(fc4, { reg: 'HP1', quest: 'papers', fields: { make: 'Tata', chassisNo: 'MAT4X', usualWorkshop: 'Shiva Motors' } });
  assert.strictEqual(ok.success, true, JSON.stringify(ok));
  const fp = J(tb('Fleet Profile')._rows());
  assert.deepStrictEqual(fp[0], ['reg', 'campus', 'papers', 'safety', 'fuel', 'capture', 'saved']);
  assert.deepStrictEqual(JSON.parse(fp[1][2]), { make: 'Tata', chassisNo: 'MAT4X', usualWorkshop: 'Shiva Motors' }, 'one row per reg, the quest as JSON');
  assert.deepStrictEqual([fp[1][0], fp[1][1]], ['HP1', 'LMS4']);
  const sv = JSON.parse(fp[1][6]).papers;
  assert.deepStrictEqual([sv.by, typeof sv.at, sv.doneBy], ['f4@x.org', 'string', undefined], 'saved per quest: by and at; not done yet, so no doneBy');
  const refused = save(fc4, { reg: 'HP2', quest: 'papers', fields: { make: 'Tata' } });
  assert.strictEqual(refused.success, false); assert.match(refused.error, /your own campus/);
  assert.strictEqual(J(tb('Fleet Profile')._rows()).length, 2, 'nothing written for LMS 1');
  assert.match(save(fc1, { reg: 'HP1', quest: 'papers', fields: {} }).error, /your own campus/, 'and the LMS 1 Fee Clerk cannot touch LMS 4');
  assert.match(save(fc4, { reg: 'HP404', quest: 'papers', fields: {} }).error, /not in the fleet/);
  assert.match(save(fc4, { reg: 'HP1', quest: 'papers', fields: { colour: 'red' } }).error, /Unknown field/);
  assert.match(save(fc4, { reg: 'HP1', quest: 'speed', fields: {} }).error, /Unknown quest/);
  const ws = () => J(tb('Workshops')._rows());
  assert.deepStrictEqual(ws().map(x => x.slice(0, 5)), [['Workshop name', 'Place', 'Contact person', 'Phone', 'Which of our buses go there'], ['Shiva Motors', '', '', '', 'HP1']], 'a workshop named in a quest joins the Workshops tab with its bus');
  // the Owner fills the Workshops tab by hand: a later save touches only the buses cell of that workshop's row
  const wtab = tb('Workshops'), wrows = wtab._rows();
  wrows[0].push('Rating (Owner)'); wrows[1][1] = 'Ner Chowk'; wrows[1][3] = '=HYPERLINK("tel:98")'; wrows[1][9] = 'good';
  wrows.push(['Other Garage', 'Mandi', 'Ram', '98', '', '', '', '', '', '']);
  assert.strictEqual(save(fc4, { reg: 'HP1', quest: 'papers', fields: { usualWorkshop: 'Shiva Motors' } }).success, true);
  assert.strictEqual(save(own, { reg: 'HP5', quest: 'papers', fields: { usualWorkshop: 'shiva motors' } }).success, true);
  assert.strictEqual(save(own, { reg: 'HP5', quest: 'papers', fields: { usualWorkshop: 'New Garage' } }).success, true);
  assert.strictEqual(wtab.clears, 0, 'the Workshops tab is never cleared or rewritten');
  assert.deepStrictEqual(ws()[1], ['Shiva Motors', 'Ner Chowk', '', '=HYPERLINK("tel:98")', 'HP1, HP5', '', '', '', '', 'good'], 'hand-filled cells, a formula and an extra column survive; the bus is added once');
  assert.deepStrictEqual(ws()[2], ['Other Garage', 'Mandi', 'Ram', '98', '', '', '', '', '', ''], 'another workshop\'s row is untouched');
  assert.deepStrictEqual(ws()[3].slice(0, 5), ['New Garage', '', '', '', 'HP5'], 'a new workshop is appended with its name and bus only');
  assert.strictEqual(save(fc4, { reg: 'HP1', quest: 'papers', fields: { make: 'Tata', chassisNo: 'MAT4X', usualWorkshop: 'Shiva Motors' } }).success, true);
  assert.strictEqual(save(fc4, { reg: 'HP1', quest: 'papers', fields: { make: 'Tata', chassisNo: 'MAT4X', engineNo: 'E9' } }).success, true);
  assert.deepStrictEqual(JSON.parse(J(tb('Fleet Profile')._rows())[1][2]), { make: 'Tata', chassisNo: 'MAT4X', engineNo: 'E9' }, 'a save replaces that quest (the form sends all of it); still one row');

  // Coordinator LMS4-6 can save driver quest for LMS 5
  const dv = save(co4, { reg: 'HP5', quest: 'driver', fields: { driverPhone: '9800000000', licenceClass: 'HTV + PSV badge', dateOfBirth: '1981-05-02' } });
  assert.strictEqual(dv.success, true, JSON.stringify(dv)); assert.strictEqual(dv.ageLimit, false); assert.strictEqual(dv.warning, undefined);
  const dp = J(tb('Driver Profile')._rows());
  assert.deepStrictEqual(dp[0], ['driverKey', 'reg', 'campus', 'driver', 'fields', 'ageLimit', 'updatedAt', 'updatedBy']);
  assert.deepStrictEqual([dp[1][0], dp[1][1], dp[1][2], dp[1][3], dp[1][5]], ['E5', 'HP5', 'LMS5', 'D HP5', 'no'], 'one row per driver, keyed by employee code');
  assert.match(save(co1, { reg: 'HP5', quest: 'driver', fields: {} }).error, /your own campus/, 'a Coordinator of LMS 1-3 is refused for LMS 5');
  assert.strictEqual(save(own, { reg: 'HP2', quest: 'fuel', fields: { paymentCreditAccountOrCash: 'Credit' } }).success, true, 'the Owner saves anywhere');
  assert.strictEqual(save(coAll, { reg: 'HP2', quest: 'fuel', fields: { paymentCreditAccountOrCash: 'Cash' } }).success, true, 'an ALL Coordinator saves for any campus (network-wide)');
  assert.strictEqual(save(coAll, { reg: 'hp-6 7', quest: 'fuel', fields: { usualFuelPump: 'HP pump' } }).success, true, 'a roster reg with a space or hyphen still matches');
  // a save that completes a quest records who completed it (the mission's doneBy)
  const fuel = { usualFuelPump: 'HP pump', paymentCreditAccountOrCash: 'Credit', driverHasASmartphoneForTheFillVideo: 'yes', whoReceivesTheFillVideoAndBill: 'Neha' };
  assert.strictEqual(save(fc4, { reg: 'HP1', quest: 'fuel', fields: fuel }).success, true);
  assert.strictEqual(JSON.parse(J(tb('Fleet Profile')._rows()).find(x => x[0] === 'HP1')[6]).fuel.doneBy, 'f4@x.org', 'doneBy recorded in Fleet Profile');

  // driver quest accepts a date of birth that makes the driver 60+, saves it with flag ageLimit:true, and returns a warning
  const old = save(co4, { reg: 'HP5', quest: 'driver', fields: { driverPhone: '9800000000', dateOfBirth: '1966-10-25' } });
  assert.strictEqual(old.success, true, 'recorded: the line-up board (1b) is what keeps the driver off a bus');
  assert.strictEqual(old.ageLimit, true); assert.match(old.warning, /60 or over/);
  const dp2 = J(tb('Driver Profile')._rows());
  assert.strictEqual(dp2.length, 2, 'still one row for that driver');
  assert.deepStrictEqual([JSON.parse(dp2[1][4]).dateOfBirth, dp2[1][5]], ['1966-10-25', 'yes']);

  // parts: one row per bus and component; the workshop joins the Workshops tab
  const pt = save(fc4, { reg: 'HP1', quest: 'parts', fields: { engine_oil: { lastReplacedOn: '2026-09-05', workshop: 'Thakur Motors', cost: '4850' }, battery: { lastReplacedOn: 'not known' } } });
  assert.strictEqual(pt.success, true, JSON.stringify(pt));
  const ph = J(tb('Parts History')._rows());
  assert.deepStrictEqual(ph[0], ['reg', 'campus', 'component', 'fields', 'updatedAt', 'updatedBy']);
  assert.deepStrictEqual(ph.slice(1).map(x => x[0] + ' ' + x[2]).sort(), ['HP1 battery', 'HP1 engine_oil']);
  save(fc4, { reg: 'HP1', quest: 'parts', fields: { battery: { lastReplacedOn: '2025-01-01' } } });
  assert.strictEqual(J(tb('Parts History')._rows()).length, 3, 'a part saved again replaces its row; the others stay');
  assert.strictEqual(save(fc4, { reg: 'HP1', quest: 'parts', fields: { battery: {} } }).success, true);
  assert.strictEqual(JSON.parse(J(tb('Parts History')._rows()).find(x => x[2] === 'battery')[3]).lastReplacedOn, '2025-01-01', 'an empty part never wipes a saved one');
  assert.ok(J(tb('Workshops')._rows()).some(x => x[0] === 'Thakur Motors' && x[4] === 'HP1'));
  assert.match(save(fc4, { reg: 'HP1', quest: 'safety', fields: { gpsTrackerFittedAndWorking: 'yes' } }).error, /safety check/, 'equipment answers come from the safety check');

  // GET: rows for the caller's campuses only (driver data never leaves its campus scope); done derived from real data
  const runs = book(FORM).insertSheet('Capture Runs');
  runs.appendRow(['Run ID', 'Reg', 'Campus', 'Kind', 'Started', 'Ended', 'By', 'Role', 'Frames', 'Gaps', 'Stops', 'Inspection JSON', 'Status']);
  runs.appendRow(['HP1-i', 'HP1', 'LMS4', 'inspection', 1, Date.parse('2026-10-20T06:00:00Z'), 'c', 'Coordinator', 0, '', '', '{"cctv":{"ok":true}}', 'ended']);
  const caps = book(FORM).insertSheet('Capture Stops'); caps.appendRow(['runId', 'reg', 'campus', 'videoFileId', 'stops', 'pushedAt']); caps.appendRow(['HP5-x', 'HP5', 'LMS5', 'VID', '[]', '']);
  const g4 = r('coordFleet_(' + fc4 + ')');
  assert.strictEqual(g4.success, true);
  assert.deepStrictEqual(g4.rows.fleet.map(b => b.reg + ' ' + b.campusId), ['HP1 LMS4'], 'a Fee Clerk gets their campus (running buses only)');
  assert.deepStrictEqual(g4.rows.drivers, [], 'and no other campus\'s drivers');
  assert.deepStrictEqual(g4.rows.inspected, { HP1: true }, 'the first safety check comes from Capture Runs');
  assert.deepStrictEqual(g4.rows.captured, {}, 'route timelapses only for visible buses');
  assert.deepStrictEqual(g4.campuses, ['LMS4']);
  const gc = r('coordFleet_(' + co4 + ')');
  assert.deepStrictEqual(gc.rows.fleet.map(b => b.reg).sort(), ['HP1', 'HP5', 'HP67'], 'a district Coordinator gets LMS 4-6');
  assert.deepStrictEqual(gc.rows.drivers.map(d => d.driverKey), ['E5']); assert.deepStrictEqual(gc.rows.captured, { HP5: true });
  const go = r('coordFleet_(' + own + ')');
  assert.deepStrictEqual(go.rows.fleet.map(b => b.reg).sort(), ['HP1', 'HP2', 'HP5', 'HP67']);
  assert.deepStrictEqual(r('coordFleet_(' + coAll + ')').rows.fleet.map(b => b.reg).sort(), ['HP1', 'HP2', 'HP5', 'HP67'], 'an ALL Coordinator sees every campus'); assert.deepStrictEqual(go.campuses, ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6'], 'network-wide');
  c.rows = gc.rows;
  const p1 = r('FleetQuests.profilesFromRows(rows)').find(p => p.reg === 'HP1');
  assert.deepStrictEqual(r('FleetQuests.questsFor(FleetQuests.profilesFromRows(rows)[0]).find(function (q) { return q.id === "safety"; }).missing'), ['attendantHelperName'], 'the page reads the GET rows with the same pure logic');
  assert.strictEqual(p1.data.papers.chassisNo, 'MAT4X');
  assert.ok(r('FleetQuests.transportMissions(rows)').every(m => ['LMS4', 'LMS5', 'LMS6'].includes(m.campus)), 'missions only for the caller\'s district');
}
console.log('transport .gs: all checks passed');
