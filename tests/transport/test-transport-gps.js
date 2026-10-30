// coordinator-transport-gps.gs: fuel checks against GPS km, follow-ups with owners and due dates, auto-close only for what a
// push covered, the clerk's answer, and the note a transport follow-up needs before it can be closed. Fake data only.
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const J = x => JSON.parse(JSON.stringify(x)); // arrays and objects from the vm realm

// in-memory sheets
function sheet(name) {
  let data = [];
  const s = { name, getLastRow: () => data.length, setFrozenRows() {}, clear() { data = []; }, appendRow(r) { data.push(r.slice()); }, _rows: () => data,
    getDataRange: () => ({ getValues: () => data.map(r => r.slice()) }),
    getRange(r, c, nr, nc) {
      return { setNumberFormat() { return this; }, setFontWeight() { return this; },
        setValues(v) { v.forEach((row, i) => { data[r - 1 + i] = data[r - 1 + i] || []; row.forEach((x, j) => { data[r - 1 + i][c - 1 + j] = x; }); }); return this; },
        setValue(x) { data[r - 1] = data[r - 1] || []; data[r - 1][c - 1] = x; return this; }, getValue: () => (data[r - 1] || [])[c - 1] };
    } };
  return s;
}
const books = {};
const book = id => books[id] = books[id] || { sheets: {}, getSheetByName(n) { return this.sheets[n] || null; }, insertSheet(n) { return this.sheets[n] = sheet(n); }, getSheets() { return Object.values(this.sheets); } };
const ctx = { console, Date, Object, String, Math, JSON, Array, Number, isFinite, parseFloat,
  SpreadsheetApp: { openById: id => book(id) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k === 'TRANSPORT_PUSH_SECRET' ? 'S' : null) }) },
  Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) } };
vm.createContext(ctx);
const load = f => vm.runInContext(fs.readFileSync(path.join(__dirname, '../../apps-script', f), 'utf8').replace(/^const /gm, 'var '), ctx);
load('coordinator.gs'); load('coordinator-approvals.gs'); load('coordinator-transport.gs'); load('coordinator-transport-gps.gs'); load('coordinator-world.gs'); load('../coordinator/capture/fleet-quests.js'); // the Coordinator project carries it
const run = c => vm.runInContext(c, ctx);
const realRefresh = ctx.gpsRefresh_; // later sections stub it; the capture section needs the real one

// ── fuel checks ──
const days = [];
for (let d = 1; d <= 10; d++) days.push({ reg: 'HP1', date: '2026-10-' + String(d).padStart(2, '0'), km: 60 });
ctx.days = days;
ctx.fills = [
  { id: 'f1', campus: 'LMS 4', date: '2026-10-01', reg: 'HP1', litres: 40, odometer: 1000, amount_rs: 3800 },   // first fill: no check
  { id: 'f2', campus: 'LMS 4', date: '2026-10-06', reg: 'HP1', litres: 60, odometer: 1300, amount_rs: 5700, hasVideo: 'yes', hasBill: 'yes' },   // 300 km / 60 L = 5 vs 7.5
  { id: 'f3', campus: 'LMS 4', date: '2026-10-10', reg: 'HP1', litres: 30, odometer: 1600, amount_rs: 2850, hasVideo: 'no', hasBill: 'yes' },   // 240 km / 30 L = 8: ok km/L, odometer off by 60
  { id: 'x1', campus: 'LMS 4', date: '2026-10-05', reg: 'HP9', litres: 50, odometer: 10, amount_rs: 4750 },     // bus without GPS: never checked
];
const checks = J(run('gpsFuelChecks_(fills, days, {HP1: 15})'));
assert.deepStrictEqual(checks.map(c => c.id), ['f2', 'f3'], 'first fill and untracked buses give no check');
assert.deepStrictEqual(checks.map(c => c.proof), ['video+bill', 'bill'], "fuel check proof is 'video+bill' / 'bill'");
ctx.noBill = [ctx.fills[0], Object.assign({}, ctx.fills[1], { hasVideo: 'no', hasBill: 'no' })];
assert.strictEqual(J(run('gpsFuelChecks_(noBill, days, {HP1: 15})'))[0].proof, 'none', 'neither video nor bill: proof is none');
assert.strictEqual(J(run('gpsFuelChecks_([fills[0], Object.assign({}, fills[1], {hasVideo: undefined, hasBill: undefined})], days, {HP1: 15})'))[0].proof, 'bill', 'a row from before the columns existed reads as bill only');
assert.ok(run('GPS_CHECK_COLS').indexOf('proof') !== -1, 'proof is stored with the check');
const c2 = checks[0];
assert.deepStrictEqual([c2.gpsKm, c2.kmpl, c2.norm, c2.flag, c2.reason, c2.excessL, c2.excessRs], [300, 5, 7.5, 'yes', 'low', 20, 1900]);
assert.deepStrictEqual([checks[1].flag, checks[1].reason, checks[1].billKm], ['yes', 'odometer', 300]);
assert.strictEqual(J(run('gpsFuelChecks_([fills[0], {id:"f2b",campus:"LMS 4",date:"2026-10-01",reg:"HP1",litres:5,odometer:1001,amount_rs:475}], days, {HP1: 15})')).length, 0, 'a same-day top-up is too little driving to judge');
assert.strictEqual(J(run('gpsFuelChecks_(fills.slice(0,2), days, {HP1: 41})'))[0].flag, 'no', '5 km/L is normal for a big bus');
ctx.noted = [ctx.fills[0], Object.assign({}, ctx.fills[2], { date: '2026-10-06', odometer: 50, odometer_note: 'meter replaced' })];
assert.ok(!/odometer/.test(J(run('gpsFuelChecks_(noted, days, {HP1: 41})'))[0].reason), 'a meter change is not an odometer mismatch');
ctx.blank = [Object.assign({}, ctx.fills[0], { odometer: '' }), ctx.fills[2]];
assert.ok(!/odometer/.test(J(run('gpsFuelChecks_(blank, days, {HP1: 41})'))[0].reason), 'an old fill without an odometer is not compared');
ctx.gappy = days.filter(d => d.date !== '2026-10-05'); // a Monday with no fix at all
const g = J(run('gpsFuelChecks_(fills.slice(0,2), gappy, {HP1: 15})'))[0];
assert.deepStrictEqual([g.flag, g.reason, g.excessRs], ['no', 'gps_gap', 0], 'a weekday the tracker missed: never accuse the fill');
ctx.sunday = days.filter(d => d.date !== '2026-10-04');
assert.match(J(run('gpsFuelChecks_(fills.slice(0,2), sunday, {HP1: 15})'))[0].reason, /^low/, 'no fix on a Sunday is a parked bus, not a gap');
assert.match(run('gpsCheckText_(' + JSON.stringify(c2) + ')'), /^HP1, fuel on 6 Oct: 60 litres for 300 km .*about 7.5\)\.$/);

// ── follow-ups ──
const fleet = [
  { reg: 'HP1', campus: 'LMS 4', operational: true, driver: 'Ram', seats: 15, year: 2017 },
  { reg: 'HP2', campus: 'LMS 4', operational: true, driver: 'Shyam', seats: 41, year: 2011 },  // no tracker, 15 years old
  { reg: 'HP3', campus: 'LMS 5', operational: true, driver: '', seats: 41, year: 2013 },       // tracker dead (HP1, same district, reports)
  { reg: 'HP4', campus: 'LMS 2', operational: false, seats: 41, year: 2010 },                  // off the road: nothing
  { reg: 'AF', campus: 'LMS-5', operational: true, seats: 10, year: 2026 },                    // not a registration: nothing
];
ctx.facts = { today: '2026-10-24', fleet, live: [{ reg: 'HP1', at: '2026-10-24T09:00:00+05:30' }, { reg: 'HP3', at: '2026-10-20T09:00:00+05:30' }],
  health: [{ reg: 'HP1', km7: 300, blind7: 90 }],
  days: [{ reg: 'HP1', date: '2026-10-22', km: 60, nightAwayKm: 6.4, nightPlace: 'Driver village', minOver40: 7 }, { reg: 'HP1', date: '2026-10-23', km: 55, nightAwayKm: 0.1, minOver40: 6 },
    { reg: 'HP1', date: '2026-10-10', km: 60, nightAwayKm: 9, minOver40: 30 }], // older than 7 days: ignored
  checks: [Object.assign({}, c2, { date: '2026-10-21' }), Object.assign({}, checks[1], { date: '2026-10-23' }), Object.assign({}, c2, { id: 'f9', date: '2026-10-23' })],
  answers: [{ id: 'f9', answer: 'matches' }] };
const f = J(run('gpsFollowUps_(facts)'));
const ids = f.map(x => x.taskId).sort();
assert.deepStrictEqual(ids, ['bus_age|HP2', 'bus_away|HP1|2026-10-22', 'bus_speed|HP1|2026-10-19', 'fuel_check|f2', 'fuel_check|f9', 'gps_blind|HP1', 'gps_dead|HP3', 'gps_none|HP2']);
const by = id => f.find(x => x.taskId === id);
assert.deepStrictEqual([by('gps_dead|HP3').due, by('gps_dead|HP3').severity, by('gps_dead|HP3').campus], ['2026-10-27', 'high', 'LMS5']);
assert.strictEqual(by('bus_away|HP1|2026-10-22').due, '2026-10-26');
assert.strictEqual(by('gps_none|HP2').due, '2026-11-07');
assert.match(by('fuel_check|f2').detail, /has not checked the pump slip in 2 days/, 'no clerk answer for 2 days escalates');
assert.match(by('fuel_check|f9').detail, /it matches the bill/, 'a "matches" answer escalates at once');
assert.ok(!by('fuel_check|' + checks[1].id), 'a check the clerk still has time for stays with the clerk');
const holiday = JSON.parse(JSON.stringify(ctx.facts)); holiday.live = [{ reg: 'HP1', at: '2026-10-20T15:00:00+05:30' }, { reg: 'HP3', at: '2026-10-20T09:00:00+05:30' }];
ctx.holiday = holiday; ctx.holiday.fleet = ctx.facts.fleet;
assert.ok(!J(run('gpsFollowUps_(holiday)')).some(x => x.taskId === 'gps_dead|HP3'), 'the whole district quiet (a holiday): no silent-tracker follow-up');
ctx.holiday.live.push({ reg: 'HPX', at: '2026-10-24T08:00:00+05:30' }); ctx.holiday.fleet = ctx.facts.fleet.concat([{ reg: 'HPX', campus: 'LMS 6', operational: true, year: 2020 }]);
assert.ok(J(run('gpsFollowUps_(holiday)')).some(x => x.taskId === 'gps_dead|HP3'), 'another bus of the district reported: the silent one is flagged');
ctx.holiday.live = [{ reg: 'HP1', at: '2026-10-20T15:00:00+05:30' }, { reg: 'HP3', at: '2025-01-20T09:00:00+05:30' }]; ctx.holiday.fleet = ctx.facts.fleet;
assert.ok(J(run('gpsFollowUps_(holiday)')).some(x => x.taskId === 'gps_dead|HP3'), 'silent for months is dead even in a holiday');
// ── fuel_proof: no video once the fill is 2 days old (dates carry no time of day, so "yesterday" may be under 24 hours ago) ──
run('GPS.proofFrom = "2026-10-26"'); // these fixtures assume the video rule began on 26 Oct; the shipped value is set on deploy day
const fill = (id, date, hasVideo, o) => Object.assign({ id, campus: 'LMS 4', date, reg: 'HP1', litres: 40, odometer: 1000, amount_rs: 3800, hasVideo, hasBill: 'yes' }, o);
ctx.pf = { today: '2026-10-28', fleet, live: [{ reg: 'HP1', at: '2026-10-28T09:00:00+05:30' }], health: [], days: [], answers: [], checks: [],
  fills: [fill('p1', '2026-10-26', 'no'), fill('p2', '2026-10-27', 'no'), fill('p3', '2026-10-26', 'yes'), fill('p4', '2026-10-20', 'no'), fill('p5', '2026-10-26', 'no', { reg: 'HP9', campus: 'LMS 5' }), fill('p6', '2026-10-26', ''), fill('p7', '2026-10-26', 'no', { hasBill: 'no' }), fill('p8', '2026-10-28', 'no')] };
const pf = J(run('gpsFollowUps_(pf)')).filter(x => x.domain === 'fuel_proof');
assert.deepStrictEqual(pf.map(x => x.taskId).sort(), ['fuel_proof|p1', 'fuel_proof|p5', 'fuel_proof|p7'],
  'a fill dated 2 days ago with no video raises it, checked or not (p5 is an untracked bus, p1 a first fill); not a fill dated yesterday (p2) or today (p8), not with video (p3), not before the video rule (p4), not a mirror row whose video state is unknown (p6)');
assert.ok(!pf.some(x => x.taskId === 'fuel_proof|p2'), 'a fill dated yesterday raises nothing: 23:30 yesterday is not yet 24 hours at 00:30 today');
assert.deepStrictEqual([pf[0].due, pf[0].campus, pf[0].auto], ['2026-10-29', 'LMS4', true], 'due in 1 day, closes itself');
assert.deepStrictEqual(pf.filter(x => x.taskId === 'fuel_proof|p5').map(x => x.campus), ['LMS5']);
assert.match(pf[0].detail, /Get the fill video from the driver and attach it to the fuel entry/);
assert.match(pf[0].title, /^HP1, fuel on 26 Oct: no video of the fill/);
assert.strictEqual(run('GPS_DOMAINS').indexOf('fuel_proof') !== -1, true);
ctx.facts.live = null;
assert.ok(!J(run('gpsFollowUps_(facts)')).some(x => /^gps_(none|dead)/.test(x.taskId)), 'vendor down: no tracker presence follow-ups');

// ── raise, auto-close only what was covered, owners, note required ──
ctx.COORD_SHEET_ID = 'TASKS'; ctx.COORD_ALLOWLIST_SHEET_ID = 'ALLOW';
book('ALLOW').insertSheet('a')._rows().push(['Email', 'Name', 'Campus', 'Roles'], ['c4@x.org', 'C4', 'LMS4', 'Coordinator'], ['c1@x.org', 'C1', 'LMS1', 'Coordinator'], ['o@x.org', 'O', 'ALL', 'Owner']);
ctx.wanted = f;
ctx.all3 = {gps_blind:{HP1:true},gps_dead:{HP1:true,HP2:true,HP3:true},gps_none:{HP1:true,HP2:true,HP3:true},bus_age:{HP1:true,HP2:true,HP3:true}};
run('gpsRaise_(wanted, all3)');
run('gpsRaise_(wanted, all3)'); // the same push twice: no duplicates
let rows = book('TASKS').getSheetByName('Tasks')._rows();
assert.strictEqual(rows.length - 1, f.length, 'one row per follow-up');
const row = id => rows.find(r => r[0] === id);
assert.deepStrictEqual([row('gps_dead|HP3')[12], row('gps_dead|HP3')[13], row('gps_dead|HP3')[14]], ['Transport', 'c4@x.org', '2026-10-27'], 'LMS5 is in C4\'s district');
assert.strictEqual(row('bus_away|HP1|2026-10-22')[13], 'c4@x.org');
ctx.w2 = f.filter(x => x.taskId !== 'gps_dead|HP3' && x.taskId !== 'gps_blind|HP1');
run('gpsRaise_(w2, {gps_blind:{HP1:true},gps_dead:{HP1:true,HP2:true},gps_none:{HP1:true,HP2:true},bus_age:{HP1:true,HP2:true}})'); // HP3 not covered by this push
rows = book('TASKS').getSheetByName('Tasks')._rows();
assert.strictEqual(row('gps_dead|HP3')[5], 'open', 'a vehicle the push did not cover keeps its follow-up');
assert.strictEqual(row('gps_blind|HP1')[5], 'resolved', 'a cleared condition closes itself');
run('gpsRaise_([], {gps_blind:{},gps_dead:{},gps_none:{},bus_age:{}})'); // no live feed, no health: nothing was looked at
rows = book('TASKS').getSheetByName('Tasks')._rows();
assert.strictEqual(row('gps_dead|HP3')[5], 'open', 'without the live feed tracker follow-ups stay open');
assert.strictEqual(row('bus_away|HP1|2026-10-22')[5], 'open', 'a parking follow-up never closes itself');
assert.strictEqual(row('gps_dead|HP3')[14], '2026-10-27', 'Due is stored as text, so lateness can be computed');
assert.strictEqual(run('coordDueIso_(new Date("2026-10-27T05:00:00Z"))'), '2026-10-27', 'an older Date-valued Due still reads as yyyy-MM-dd');
// a system-closed follow-up whose problem is back reopens; a person's recent close is respected
run('gpsRaise_(wanted, all3)');
rows = book('TASKS').getSheetByName('Tasks')._rows();
assert.strictEqual(row('gps_blind|HP1')[5], 'open', 'the tracker went dark again: the follow-up is back');
assert.match(String(row('gps_blind|HP1')[11]), /^reopened /);
const r3 = row('gps_dead|HP3'); r3[5] = 'resolved'; r3[9] = new Date(); r3[10] = 'c4@x.org'; r3[11] = 'Blackbox complaint 77';
run('gpsRaise_(wanted, all3)');
rows = book('TASKS').getSheetByName('Tasks')._rows();
assert.strictEqual(row('gps_dead|HP3')[5], 'resolved', 'closed by a person today: Blackbox gets its repair window');
r3[9] = new Date(Date.now() - 10 * 86400000);
run('gpsRaise_(wanted, all3)');
rows = book('TASKS').getSheetByName('Tasks')._rows();
assert.strictEqual(row('gps_dead|HP3')[5], 'open', 'still silent after the repair window: back on the list');
// fuel_proof raises at 24 h without a video and closes itself when the video is there (or the fill is gone)
ctx.fp = pf;
run('gpsRaise_(fp, {fuel_proof: true})');
rows = book('TASKS').getSheetByName('Tasks')._rows();
assert.deepStrictEqual([row('fuel_proof|p1')[1], row('fuel_proof|p1')[5], row('fuel_proof|p1')[13], row('fuel_proof|p1')[14]], ['fuel_proof', 'open', 'c4@x.org', '2026-10-29']);
ctx.pf.fills[4].hasVideo = 'yes'; // the untracked bus's video is attached later: the mirror row now says so
run('gpsRaise_(gpsFollowUps_(pf), {fuel_proof: true})');
rows = book('TASKS').getSheetByName('Tasks')._rows();
assert.strictEqual(row('fuel_proof|p5')[5], 'resolved', 'the video exists: the follow-up closes itself');
assert.strictEqual(row('fuel_proof|p1')[5], 'open', 'the other fills still have no video');
run('gpsRaise_([], {fuel_proof: true})'); // the fill was reversed and re-entered (new id): the old follow-up is not left open
rows = book('TASKS').getSheetByName('Tasks')._rows();
assert.strictEqual(row('fuel_proof|p1')[5], 'resolved');
ctx.coordVisibleCampuses_ = () => null;
assert.match(J(run('coordTaskResolveCore_({email:"o@x.org"}, {taskId:"bus_away|HP1|2026-10-22", note:"  "})')).error, /Write what was done/);
assert.strictEqual(J(run('coordTaskResolveCore_({email:"o@x.org"}, {taskId:"bus_away|HP1|2026-10-22", note:"Driver went to hospital"})')).success, true);

// ── clerk answer: own campus only, once ──
book(run('COORD_TRANSPORT_FORM_ID'));
run('gpsWrite_(GPS_TAB_CHECKS, GPS_CHECK_COLS, [' + JSON.stringify(Object.assign({}, c2, { campus: 'LMS 4' })) + '])');
ctx.coordVisibleCampuses_ = c => c.only || null;
ctx.gpsRefresh_ = () => ({});
assert.strictEqual(J(run('coordGpsClerkAnswer_({email:"k@x.org", only:["LMS2"], feeClerkOnly:true, roles:["FeeClerk"]}, {fillId:"f2", answer:"matches"})')).error, 'Not authorized', 'another campus\'s bill is refused');
assert.match(J(run('coordGpsClerkAnswer_({email:"c4@x.org", only:["LMS4"], roles:["Coordinator"]}, {fillId:"f2", answer:"corrected"})')).error, /Only the Fee Clerk/, 'a coordinator cannot answer for their own buses');
assert.strictEqual(J(run('coordGpsClerkChecks_({only:["LMS4"]})')).checks.length, 1);
assert.strictEqual(J(run('coordGpsClerkAnswer_({email:"k@x.org", only:["LMS4"], feeClerkOnly:true, roles:["FeeClerk"]}, {fillId:"f2", answer:"corrected"})')).success, true);
assert.strictEqual(J(run('coordGpsClerkAnswer_({email:"k@x.org", only:["LMS4"], feeClerkOnly:true, roles:["FeeClerk"]}, {fillId:"f2", answer:"matches"})')).already, true, 'answered once');
assert.strictEqual(J(run('coordGpsClerkChecks_({only:["LMS4"]})')).checks.length, 0, 'an answered bill leaves the clerk list');
assert.strictEqual(J(run('coordGpsPush_({secret:"S", payload:{days:[], health:[]}})')).success, false, 'an empty push is refused, so it cannot close anything');
assert.strictEqual(run('gpsDay_("2024-12-16", "2026-10-24")'), '16 Dec 2024'); assert.strictEqual(run('gpsDay_("2026-10-09", "2026-10-24")'), '9 Oct');
ctx.f3 = { today: '2026-10-24', fleet, live: ctx.facts.live || [], health: [], days: [], checks: [Object.assign({}, c2, { date: '2026-10-23' })], answers: [{ id: 'f2', answer: 'corrected', at: '2026-10-20T10:00:00Z' }] };
assert.match(J(run('gpsFollowUps_(f3)')).find(x => x.taskId === 'fuel_check|f2').detail, /said the bill was corrected, but the day book entry is unchanged/);
ctx.f3.answers[0].at = '2026-10-24T08:00:00Z';
assert.ok(!J(run('gpsFollowUps_(f3)')).some(x => x.taskId === 'fuel_check|f2'), 'a fresh "corrected" waits for the re-entry');
// ── route views data: tracks and roster extras round-trip; money and tracks scoped like everything else ──
ctx.coordTransportBase_ = () => ({ fleet: [{ reg: 'HP1', campus: 'LMS 4', operational: true, seats: 15, year: 2017 }, { reg: 'HP7', campus: 'LMS 1', operational: true, seats: 41, year: 2014 }],
  pnl: [{ reg: 'HP1', campus: 'LMS 4', month: '2026-09', fee: 100, fuel: 50, loan: 0, fixed: 10, pay: 20 }, { reg: 'HP7', campus: 'LMS 1', month: '2026-09', fee: 90, fuel: 10, loan: 0, fixed: 0, pay: 0 }] });
ctx.coordBusFetch_ = () => ({ buses: [{ reg: 'HP1', at: '2026-10-24T09:00:00+05:30' }, { reg: 'HP7', at: '2026-10-24T09:00:00+05:30' }] });
ctx.gpsRefresh_ = () => ({ checks: 0, followUps: 0 });
ctx.coordVisibleCampuses_ = c => c.only || null;
assert.strictEqual(J(run('coordGpsPush_({secret:"S", payload:{syncedAt:"2026-10-25T01:00:00Z", days:[{reg:"HP1",date:"2026-10-24",km:50}], health:[{reg:"HP1",km7:50,blind7:0}], ' +
  'tracks:[{reg:"HP1",trip:"AM-1 ~07:29",date:"2026-10-22",path:[[31.6,76.9],[31.61,76.91]]},{reg:"HP7",trip:"AM-1 ~07:00",date:"2026-10-22",path:[[31.9,77.1],[31.91,77.12]]}], ' +
  'fleetExtra:[{reg:"HP1",rounds:4,students:25,start:"Nalwari"}]}})')).success, true);
const coord = J(run('coordGpsInsight_({email:"c4@x.org", roles:["Coordinator"], only:["LMS4","LMS5","LMS6"]})'));
assert.deepStrictEqual(coord.tracks.map(t => t.reg), ['HP1'], 'a coordinator gets the tracks of their campuses only');
assert.deepStrictEqual(coord.tracks[0].path, [[31.6, 76.9], [31.61, 76.91]]);
assert.deepStrictEqual(coord.pnl.map(r => r.reg), ['HP1'], 'and the money of their campuses only');
assert.deepStrictEqual([coord.vehicles[0].rounds, coord.vehicles[0].students, coord.vehicles[0].start], [4, 25, 'Nalwari']);
assert.deepStrictEqual(coord.proposals, {}, 'proposals stay with the Owner');
const own = J(run('coordGpsInsight_({email:"o@x.org", roles:["Owner"]})'));
assert.deepStrictEqual([own.tracks.length, own.pnl.length, own.vehicles.find(v => v.reg === 'HP7').rounds], [2, 2, null], 'the Owner sees all; a bus missing from the roster extras has no rounds, not a guess');
// ── the route World (transportworld): routes and stops of the caller's campuses, never money; driver names and counts for staff only ──
run('gpsWrite_(GPS_TAB_STOPS, GPS_STOP_COLS, [{bus:"HP1",trip:"AM-1",seq:1,kind:"stop",place:"Village A",shared_with:"HP7",lat:31.6,lng:76.9},{bus:"HP7",trip:"AM-1",seq:1,kind:"stop",place:"Village B",lat:31.9,lng:77.1}])');
ctx.todayIso = new Date().toISOString().slice(0, 10);
ctx.coordCacheGetBig_ = () => null; ctx.coordCachePutBig_ = () => {}; // no gzip in this vm
run('gpsWrite_(COORD_ROLLCALL_TAB, ["Date","Reg"], [{Date: todayIso, Reg: "HP1"}])');
ctx.coordTransportBase_ = () => ({ fleet: [{ reg: 'HP1', campus: 'LMS 4', operational: true, seats: 15, driver: 'Driver One' }, { reg: 'HP7', campus: 'LMS 1', operational: true, seats: 41, driver: 'Driver Seven' }],
  pnl: [{ reg: 'HP1', campus: 'LMS 4', month: '2026-09', fee: 100, fuel: 50, loan: 0, fixed: 10, pay: 20 }] });
const pw = J(run('coordWorld_({email:"p4@x.org", campusId:"LMS4", principal:true})'));
assert.deepStrictEqual([pw.vehicles.map(v => v.reg), pw.stops.map(x => x.bus), pw.tracks.map(t => t.reg)], [['HP1'], ['HP1'], ['HP1']], 'a Principal sees their own campus only');
assert.ok(!('driver' in pw.vehicles[0]) && !('counts' in pw), 'a Principal gets no driver names and no counts');
['pnl', 'proposals', 'tasks', 'checks', 'catalog', 'bases'].forEach(k => assert.ok(!(k in pw), 'no ' + k + ' in the World (bases: where buses park at night)'));
assert.strictEqual(pw.stops[0].shared_with, '', 'a stop shared with another campus\'s bus does not name it');
assert.strictEqual(J(run('coordWorld_({email:"o@x.org", roles:["Owner"]})')).stops[0].shared_with, 'HP7', 'the Owner sees both buses, so the share stays');
assert.strictEqual(J(run('coordGpsInsight_({email:"c4@x.org", roles:["Coordinator"], only:["LMS4"]})')).stops.find(x => x.bus === 'HP1').shared_with, '', 'the GPS page trims it too (school lock)');
assert.strictEqual(J(run('coordGpsInsight_({email:"o@x.org", roles:["Owner"]})')).stops.find(x => x.bus === 'HP1').shared_with, 'HP7');
const kw = J(run('coordWorld_({email:"k@x.org", campusId:"LMS4", only:["LMS4"], feeClerkOnly:true, roles:["FeeClerk"]})'));
assert.deepStrictEqual([kw.vehicles.map(v => v.reg), kw.vehicles[0].driver, kw.counts.HP1.rollCallToday], [['HP1'], 'Driver One', true], 'a Fee Clerk: their campus, the driver, today\'s roll call');
assert.strictEqual(typeof kw.counts.HP1.fuelFills, 'number');
assert.ok(!('pnl' in kw), 'and still no money');
const ow = J(run('coordWorld_({email:"o@x.org", roles:["Owner"]})'));
assert.deepStrictEqual([ow.vehicles.length, ow.stops.length, ow.counts.HP7.rollCallToday, 'pnl' in ow], [2, 2, false, false], 'the Owner: every campus, still no money here');
assert.strictEqual(J(run('coordWorld_(null)')).error, 'Not authorized', 'no caller, no World');
ctx.coordVerifyCaller_ = () => null; ctx.coordVerifyPrincipal_ = () => null;
assert.strictEqual(J(run('coordWorldCaller_("t")')), null, 'a teacher or a stranger is neither gate');
ctx.coordVerifyPrincipal_ = () => ({ email: 'p4@x.org', campusId: 'LMS4', principal: true });
assert.strictEqual(J(run('coordWorldCaller_("t")')).campusId, 'LMS4', 'a Principal passes the World gate');

// ── capture runs (Task 7): the Mac pulls the ended timelapse runs and pushes back the processed ones; stops carry counts only ──
book(run('COORD_TRANSPORT_FORM_ID')).insertSheet('Capture Runs')._rows().push(
  ['Run ID', 'Reg', 'Campus', 'Kind (timelapse/count/inspection)', 'Started', 'Ended', 'By', 'Role', 'Frames', 'Gaps JSON', 'Stops JSON', 'Inspection JSON', 'Status', 'Frame Times JSON'],
  ['HP1-20261025-071500-ab12', 'HP1', 'LMS4', 'timelapse', 1000, 2000, 'c4@x.org', 'Coordinator', 40, '[]', JSON.stringify([{ seq: 3, name: 'Nalwari', lat: 31.6, lng: 76.9, takenAt: 5, boardOn: 2, boardOff: 0 }]), '', 'ended', '[0,4,9,null,15]', 'rider@x.org'],
  ['HP1-20261025-090000-cd34', 'HP1', 'LMS4', 'timelapse', 1, '', 'c4@x.org', 'Coordinator', 10, '[]', '[]', '', 'running'],
  ['HP7-20261025-071500-ef56', 'HP7', 'LMS1', 'count', 1, 2, 'c4@x.org', 'Coordinator', 0, '[]', '[]', '', 'ended'],
  ['HP7-20261025-080000-gh78', 'HP7', 'LMS1', 'inspection', 1, 2, 'c4@x.org', 'Coordinator', 3, '[]', '[]', '{}', 'ended'],
  ['HP7-20261024-071500-zz99', 'HP7', 'LMS1', 'timelapse', 1000, 2000, 'c4@x.org', 'Coordinator', 2, '[]', '[]', '', 'ended', 'not json']);
assert.strictEqual(J(run('coordCapturePull_({secret:"X"})')).error, 'Not authorized', 'transportcapturepull with a wrong secret refused');
let pulled = J(run('coordCapturePull_({secret:" S\\n"})'));
assert.deepStrictEqual(pulled.runs.map(r => r.runId), ['HP1-20261025-071500-ab12', 'HP7-20261024-071500-zz99'], 'only ended timelapse runs are pulled');
assert.deepStrictEqual([pulled.runs[0].reg, pulled.runs[0].kind, pulled.runs[0].status, pulled.runs[0].frames, pulled.runs[0].stops[0].name, pulled.runs[0].startedAt],
  ['HP1', 'timelapse', 'ended', 40, 'Nalwari', 1000]);
assert.deepStrictEqual([pulled.runs[0].frameTimes, pulled.runs[1].frameTimes, pulled.runs[0].done], [[0, 4, 9, null, 15], null, false], 'frame times come along (null when unreadable); not pushed yet');
// capture_route: every operational bus with no processed timelapse, due in 14 days, closes itself; nothing before GPS.captureFrom (Ruling 30)
assert.strictEqual(run('GPS.captureFrom'), '2026-12');
ctx.cr = { today: '2026-12-01', fleet, live: null, health: [], days: [], checks: [], answers: [], captured: { HP2: true } };
const cr = J(run('gpsFollowUps_(cr)')).filter(x => x.domain === 'capture_route');
assert.deepStrictEqual(cr.map(x => x.taskId), ['capture_route|HP1', 'capture_route|HP3'], 'raised for an operational bus with no processed run (not HP2, processed; not HP4, off the road; not AF)');
assert.deepStrictEqual([cr[0].due, cr[0].campus, cr[0].auto], ['2026-12-15', 'LMS4', true]);
assert.strictEqual(cr[0].detail, 'Ask the Fee Clerk to send the school phone on this route\'s next empty run, and do the timelapse run');
assert.ok(!J(run('gpsFollowUps_(Object.assign({}, cr, {captured: undefined}))')).some(x => x.domain === 'capture_route'), 'no captured facts: nothing said');
assert.ok(!J(run('gpsFollowUps_(Object.assign({}, cr, {today: "2026-11-30"}))')).some(x => x.domain === 'capture_route'), 'before the start month: nothing raised');
run('GPS.captureFrom = "2026-10"'); // the real refresh below runs on today's date
ctx.gpsRefresh_ = realRefresh;
run('gpsRefresh_([], [])');
const capRow = id => book('TASKS').getSheetByName('Tasks')._rows().find(r => r[0] === id);
assert.deepStrictEqual([capRow('capture_route|HP1')[5], capRow('capture_route|HP7')[5], capRow('capture_route|HP1')[13]], ['open', 'open', 'c4@x.org'], 'the refresh raises it, owned by the Coordinator');
// Ruling 29: the push carries no file ids; the backend asks the Roster project (Drive access) for the processed copies' ids
const fetched = [];
let roster = {};
ctx.UrlFetchApp = { fetch: (url, o) => { fetched.push({ url, body: JSON.parse(o.payload) }); return { getResponseCode: () => 200, getContentText: () => JSON.stringify(roster) }; } };
ctx.capPush = { runs: [
  { runId: 'HP1-20261025-071500-ab12', reg: 'HP1', stops: [{ seq: 3, name: 'Nalwari', lat: 31.6, lng: 76.9, at: '2026-10-25T01:45:00Z', boardOn: 2, boardOff: 0, child: 'Asha', photoFileId: 'ORIGINAL123456', photo: true }] },
  { runId: 'HP7-20261024-071500-zz99', reg: 'HP7', stops: [] },
  { runId: 'HP9-20261024-071500-zz99', reg: 'HP9', stops: [] }] };
assert.strictEqual(J(run('coordCapturePush_({secret:"X", payload: capPush})')).error, 'Not authorized', 'transportcapturepush with a wrong secret refused');
assert.strictEqual(run('gpsRows_(GPS_TAB_CAPTURE).length') + fetched.length, 0, 'a refused push stores and asks nothing');
assert.strictEqual(J(run('coordCapturePush_({secret:"S", payload: {runs: [{runId: "HP7-20261024-071500-zz99", reg: "HP7", stops: "nope"}]}})')).success, false, 'a run whose stops are not a list is refused');
assert.match(J(run('coordCapturePush_({secret:"S", payload: {runs: [{runId: "HP7-20261024-071500-zz99", reg: "HP1", stops: []}]}})')).error, /run 1/, 'a runId of another bus is refused');
// I-a: Drive uploads route.mp4 and the stop photos one by one: the video alone is not enough
roster = { success: true, found: { 'HP1-20261025-071500-ab12': { videoFileId: 'VIDblurred123', photos: {} } }, notYet: ['HP7-20261024-071500-zz99'] };
const half = J(run('coordCapturePush_({secret:"S", payload: capPush})'));
assert.deepStrictEqual([half.success, half.runs, half.notYet], [true, 0, ['HP1-20261025-071500-ab12', 'HP7-20261024-071500-zz99']], 'video there, a stop photo not yet: the whole run is not yet');
assert.strictEqual(run('gpsRows_(GPS_TAB_CAPTURE).length'), 0, 'and nothing is stored');
assert.deepStrictEqual(J(run('coordCapturePull_({secret:"S"})')).runs.map(r => r.done), [false, false], 'so it is not done: the Mac pushes it again tomorrow');
fetched.length = 0;
roster = { success: true, found: { 'HP1-20261025-071500-ab12': { videoFileId: 'VIDblurred123', photos: { 3: 'PHOTOblurred1' } } }, notYet: ['HP7-20261024-071500-zz99'] };
const pushed = J(run('coordCapturePush_({secret:"S", payload: capPush})'));
assert.deepStrictEqual([pushed.success, pushed.runs, pushed.notYet, pushed.skipped], [true, 1, ['HP7-20261024-071500-zz99'], ['HP9-20261024-071500-zz99']], 'an unsynced run is "not yet"; a bus not in the fleet is skipped');
assert.deepStrictEqual([fetched[0].url, fetched[0].body.action, fetched[0].body.secret, fetched[0].body.runs],
  [run('COORD_ROSTER_URL'), 'captureprocessed', 'S', [{ reg: 'HP1', runId: 'HP1-20261025-071500-ab12', stops: [3] }, { reg: 'HP7', runId: 'HP7-20261024-071500-zz99', stops: [] }]]);
assert.deepStrictEqual([capRow('capture_route|HP1')[5], capRow('capture_route|HP7')[5]], ['resolved', 'open'], 'resolved by the push; the bus still without a timelapse keeps it');
pulled = J(run('coordCapturePull_({secret:"S"})'));
assert.deepStrictEqual(pulled.runs.map(r => r.done), [true, false], 'a stored run is not pushed again; the "not yet" one is');
roster = { success: false, error: 'Not authorized' };
assert.match(J(run('coordCapturePush_({secret:"S", payload: capPush})')).error, /Roster.*Not authorized/, 'the Roster refusing is an error the Mac sees');
roster = { success: true, found: { 'HP7-20261024-071500-zz99': { videoFileId: 'VID7blurred12', photos: {} } }, notYet: [] };
assert.strictEqual(J(run('coordCapturePush_({secret:"S", payload: {runs: [capPush.runs[1]]}})')).runs, 1);
const capCoord = J(run('coordGpsInsight_({email:"c4@x.org", roles:["Coordinator"], only:["LMS4"]})')).capture;
assert.deepStrictEqual(Object.keys(capCoord.byReg), ['HP1'], 'an LMS 4 coordinator sees only LMS 4 capture stops');
assert.deepStrictEqual(capCoord.byReg.HP1, { runId: 'HP1-20261025-071500-ab12', videoFileId: 'VIDblurred123',
  stops: [{ seq: 3, name: 'Nalwari', lat: 31.6, lng: 76.9, at: '2026-10-25T01:45:00Z', photoFileId: 'PHOTOblurred1', boardOn: 2, boardOff: 0 }] }, 'the processed ids from the Roster, never one the push sent; counts only');
assert.deepStrictEqual(Object.keys(J(run('coordGpsInsight_({email:"o@x.org", roles:["Owner"]})')).capture.byReg).sort(), ['HP1', 'HP7'], 'the second push kept the first (upsert by run)');
assert.deepStrictEqual(J(run('gpsRows_(GPS_TAB_CAPTURE)')).map(r => r.runId.slice(0, 3) + ' ' + r.capturedBy), ['HP1 rider@x.org', 'HP7 c4@x.org'], 'each processed run keeps its capturer (Captured By, else By: a row from before the column)');
assert.deepStrictEqual(J(run('gpsCaptured_()')).HP1.by, 'rider@x.org', 'the route timelapse credits its capturer');
roster = { success: true, found: { 'HP1-20261026-071500-ab99': { videoFileId: 'VID2blurred12', photos: {} } }, notYet: [] };
run('coordCapturePush_({secret:"S", payload: {runs: [{runId: "HP1-20261026-071500-ab99", reg: "HP1", stops: []}]}})');
assert.strictEqual(J(run('coordGpsInsight_({email:"o@x.org", roles:["Owner"]})')).capture.byReg.HP1.runId, 'HP1-20261026-071500-ab99', 'the newest run per bus is served');
// one push asks the Roster about at most GPS.captureBatch runs (UrlFetch's ~60 s); the rest wait for the next daily run
assert.strictEqual(run('GPS.captureBatch'), 20);
roster = { success: true, found: {}, notYet: [] }; fetched.length = 0;
ctx.many = { runs: Array.from({ length: 22 }, (_, i) => ({ runId: 'HP1-20261101-0700' + String(i).padStart(2, '0') + '-zz' + String(i).padStart(2, '0'), reg: 'HP1', stops: [] })) };
const capped = J(run('coordCapturePush_({secret:"S", payload: many})'));
assert.deepStrictEqual([fetched.length, fetched[0].body.runs.length, capped.notYet.length, capped.later], [1, 20, 20, ['HP1-20261101-070020-zz20', 'HP1-20261101-070021-zz21']], 'capped at 20 runs; the rest come back as later');
const capTab = book(run('COORD_TRANSPORT_FORM_ID')).getSheetByName('Capture Stops')._rows();
capTab.find(r => r[0] === 'HP7-20261024-071500-zz99')[4] = '[{"seq":1,'; // a cut-off or hand-edited cell
assert.deepStrictEqual(J(run('coordGpsInsight_({email:"o@x.org", roles:["Owner"]})')).capture.byReg.HP7.stops, [], 'one bad cell does not break the page');
// ── parts catalog (Task 9): the agencies' service data, pushed from the Mac; models and parts fleet-wide, vehicles and history by reg ──
const part = (o) => Object.assign({ lifeKm: 40000, lifeMonths: 24, price: 9500, labour: 300, spec: '', components: ['tyre_fl', 'tyre_fr'], asOf: '2026-10-01T10:00:00' }, o);
ctx.catPush = {
  models: [{ model: 'MODEL ALPHA 36', parts: { tyre: part(), engine_oil: part({ lifeKm: 10000, lifeMonths: 6, price: null, labour: null, components: ['engine_oil'] }) } },
    { model: 'MODEL BETA 26', parts: { brake_front: part({ lifeKm: 30000, components: ['brake_front'] }) } }],
  vehicles: [{ chassis: 'TESTCH0001', reg: 'HP1', model: 'MODEL ALPHA 36', catalogModel: 'MODEL ALPHA 36', asOf: '2026-10-01T10:00:00', recalls: 'Open campaign 7', variant: 'Skool', year: 2022, warrantyDate: '2027-03-11', warrantyKm: 200000 },
    { chassis: 'TESTCH0007', reg: 'HP7', model: 'MODEL BETA 26', year: 2018, asOf: '2026-10-01T10:00:00' }],
  history: [{ asOf: '2026-10-01T10:00:00', reg: 'HP1', chassis: 'TESTCH0001', jobCard: 'JC-1', date: '2026-09-05', odometer: 81200, work: '10,000 km service', part: 'Engine oil', partNo: 'P1', qty: '7 L', partAmount: 3150, labour: 700 },
    { reg: 'HP1', chassis: 'TESTCH0001', jobCard: 'JC-1', date: '2026-09-05', odometer: 81200, work: '10,000 km service', part: 'Oil filter', partNo: 'P2', qty: '1', partAmount: 450, labour: null },
    { reg: 'HP7', chassis: 'TESTCH0007', jobCard: 'JC-7', date: '2026-10-17', odometer: 40000, work: 'Brakes', part: 'Liner', partNo: 'P3', qty: '4', partAmount: 2400, labour: 900 }],
};
assert.strictEqual(J(run('coordCatalogPush_({secret:"X", payload: catPush})')).error, 'Not authorized', 'catalogpush with a wrong secret refused');
assert.strictEqual(run('gpsRows_("Parts Catalog").length + gpsRows_("Agency Vehicles").length + gpsRows_("Agency History").length'), 0, 'a refused push stores nothing');
assert.strictEqual(J(run('coordCatalogPush_({secret:"S", payload: {models: "nope", vehicles: [], history: []}})')).success, false, 'models must be a list');
assert.strictEqual(J(run('coordCatalogPush_({secret:"S", payload: {models: [{model: "", parts: {}}], vehicles: [], history: []}})')).success, false, 'a model needs a name');
assert.strictEqual(J(run('coordCatalogPush_({secret:"S", payload: {models: [], vehicles: [{reg: "HP1"}], history: []}})')).success, false, 'a vehicle needs its chassis');
const cp = J(run('coordCatalogPush_({secret:" S\\n", payload: catPush})'));
assert.deepStrictEqual([cp.success, cp.parts, cp.vehicles, cp.history], [true, 3, 2, 3]);
const counts = () => run('[gpsRows_("Parts Catalog").length, gpsRows_("Agency Vehicles").length, gpsRows_("Agency History").length]');
assert.deepStrictEqual(J(counts()), [3, 2, 3]);
run('coordCatalogPush_({secret:"S", payload: catPush})'); run('coordCatalogPush_({secret:"S", payload: catPush})');
assert.deepStrictEqual(J(counts()), [3, 2, 3], 're-pushing the same file adds no rows');
// a push of one model leaves the others; an older file never overwrites a newer part; a newer one does
run('coordCatalogPush_({secret:"S", payload: {models: [{model: "MODEL ALPHA 36", parts: {tyre: ' + JSON.stringify(part({ lifeKm: 99, asOf: '2026-09-01T00:00:00' })) + '}}], vehicles: [], history: []}})');
let catRows = J(run('gpsRows_("Parts Catalog")'));
assert.strictEqual(catRows.find(r => r.code === 'tyre').lifeKm, '40000', 'an older file does not overwrite a newer part');
run('coordCatalogPush_({secret:"S", payload: {models: [{model: "MODEL ALPHA 36", parts: {tyre: ' + JSON.stringify(part({ lifeKm: 45000, price: 9800, asOf: '2026-10-20T00:00:00' })) + '}}], vehicles: [], history: []}})');
catRows = J(run('gpsRows_("Parts Catalog")'));
assert.deepStrictEqual([catRows.length, catRows.find(r => r.code === 'tyre').lifeKm, catRows.find(r => r.code === 'tyre').price], [3, '45000', '9800'], 'a newer file replaces the part');
const catOwn = J(run('coordGpsInsight_({email:"o@x.org", roles:["Owner"]})')).catalog;
assert.deepStrictEqual(Object.keys(catOwn.models).sort(), ['MODEL ALPHA 36', 'MODEL BETA 26']);
assert.deepStrictEqual(catOwn.models['MODEL ALPHA 36'].parts.tyre, { lifeKm: 45000, lifeMonths: 24, price: 9800, labour: 300, spec: '', components: ['tyre_fl', 'tyre_fr'], asOf: '2026-10-20T00:00:00' }, 'numbers and component ids, as the garage reads them');
assert.deepStrictEqual([catOwn.models['MODEL ALPHA 36'].parts.engine_oil.price, catOwn.models['MODEL ALPHA 36'].parts.engine_oil.lifeKm], [null, 10000], 'an empty price is null, not 0');
assert.deepStrictEqual([catOwn.vehicles.length, catOwn.history.length], [2, 3], 'the Owner sees every bus');
const catCoord = J(run('coordGpsInsight_({email:"c4@x.org", roles:["Coordinator"], only:["LMS4"]})')).catalog;
assert.deepStrictEqual(catCoord.vehicles.map(v => v.reg), ['HP1'], 'a coordinator gets the vehicles of their campuses only');
assert.deepStrictEqual(catCoord.history.map(h => h.part), ['Engine oil', 'Oil filter'], 'and their history');
assert.deepStrictEqual([catCoord.vehicles[0].warrantyKm, catCoord.history[0].partAmount, catCoord.history[0].odometer, catCoord.history[1].labour], [200000, 3150, 81200, null]);
assert.deepStrictEqual(Object.keys(catCoord.models).sort(), ['MODEL ALPHA 36', 'MODEL BETA 26'], 'models and parts are fleet-wide');

// fix round 1: registrations like the repo's other normalisers, the catalog model key, no blanking, a bounded history, stricter rows
assert.strictEqual(catCoord.vehicles[0].catalogModel, 'MODEL ALPHA 36', 'the resolved catalog model key is stored and served');
// Ruling 40: the newest asOf wins per row, whole, blanks included; only identity (reg, catalog model key) is never blanked; an older row is ignored
const ownCat = () => J(run('coordGpsInsight_({email:"o@x.org", roles:["Owner"]})')).catalog;
const veh1 = () => ownCat().vehicles.find(v => v.chassis === 'TESTCH0001');
const pushVeh = (o) => run('coordCatalogPush_({secret:"S", payload: {models: [], history: [], vehicles: [' + JSON.stringify(Object.assign({ chassis: 'TESTCH0001' }, o)) + ']}})');
pushVeh({ asOf: '2026-11-01T00:00:00', reg: '', model: '', catalogModel: '', variant: '', year: '', warrantyKm: null, recalls: '' });
let kept = veh1();
assert.deepStrictEqual([kept.reg, kept.catalogModel], ['HP1', 'MODEL ALPHA 36'], 'a newer blank never blanks the identity: reg and the catalog model key');
assert.deepStrictEqual([kept.variant, kept.year, kept.warrantyKm, kept.recalls, kept.warrantyDate], ['', null, null, '', ''], 'but it clears the rest: a closed recall, a dropped warranty, a cleared variant');
pushVeh({ asOf: '2026-09-01T00:00:00', reg: 'HP1', variant: 'OLD FILE', recalls: 'Open campaign 7', year: 2001 });
kept = veh1();
assert.deepStrictEqual([kept.variant, kept.recalls, kept.year], ['', '', null], 'a row with an OLDER asOf overwrites nothing');
pushVeh({ asOf: '2026-11-02T00:00:00', reg: 'H-p 1', variant: 'Skool 36', year: 2022 });
kept = veh1();
assert.deepStrictEqual([kept.reg, kept.variant, kept.year], ['HP1', 'Skool 36', 2022], 'a reg typed "H-p 1" is HP1 (every non-alphanumeric dropped, upper case); a newer row applies whole');
// a part: a newer file clears a wrong price; an older one is ignored (the tyre was set to 45000 km / 9800 above)
const tyre = () => ownCat().models['MODEL ALPHA 36'].parts.tyre;
run('coordCatalogPush_({secret:"S", payload: {models: [{model: "MODEL ALPHA 36", parts: {tyre: ' + JSON.stringify(part({ lifeKm: 46000, price: '', asOf: '2026-11-01T00:00:00' })) + '}}], vehicles: [], history: []}})');
assert.deepStrictEqual([tyre().lifeKm, tyre().price], [46000, null], 'a newer part row clears the price it no longer states');
run('coordCatalogPush_({secret:"S", payload: {models: [{model: "MODEL ALPHA 36", parts: {tyre: ' + JSON.stringify(part({ lifeKm: 1, price: 1, asOf: '2026-10-05T00:00:00' })) + '}}], vehicles: [], history: []}})');
assert.deepStrictEqual([tyre().lifeKm, tyre().price], [46000, null], 'an older part row is ignored');
run('coordCatalogPush_({secret:"S", payload: {models: [], vehicles: [], history: [{reg: "HP-1", chassis: "TESTCH0001", jobCard: "JC-8", date: "2026-10-01", part: "Wipers", partAmount: 100, asOf: "2026-11-01T00:00:00"}]}})');
assert.ok(J(run('coordGpsInsight_({email:"c4@x.org", roles:["Coordinator"], only:["LMS4"]})')).catalog.history.some(h => h.part === 'Wipers' && h.reg === 'HP1'), 'a hyphenated reg in a history row still reaches its bus');
const histOf = () => ownCat().history.find(h => h.part === 'Engine oil');
const oldH = Object.assign({}, ctx.catPush.history[0], { reg: '', odometer: 1, labour: 1, asOf: '2026-09-01T00:00:00' });
assert.strictEqual(J(run('coordCatalogPush_({secret:"S", payload: {models: [], vehicles: [], history: [' + JSON.stringify(oldH) + ']}})')).success, true);
assert.deepStrictEqual([histOf().odometer, histOf().labour], [81200, 700], 'an older history row is ignored');
run('coordCatalogPush_({secret:"S", payload: {models: [], vehicles: [], history: [' + JSON.stringify(Object.assign({}, oldH, { odometer: null, labour: null, asOf: '2026-11-03T00:00:00' })) + ']}})');
assert.deepStrictEqual([histOf().reg, histOf().odometer, histOf().labour], ['HP1', null, null], 'a newer history row clears what it leaves empty; its reg (blank) is found from the stored vehicle');
// N4: a history row for a chassis known only from an earlier push resolves through the stored vehicles; an unknown chassis is not stored and is reported
const hrow = (o) => Object.assign({ asOf: '2026-11-03T00:00:00', date: '2026-10-02', jobCard: 'JC-9', part: 'Belt' }, o);
const nres = J(run('coordCatalogPush_({secret:"S", payload: {models: [], vehicles: [], history: [' + JSON.stringify(hrow({ chassis: 'TESTCH0001' })) + ',' + JSON.stringify(hrow({ chassis: 'NOSUCHCHASSIS' })) + ']}})'));
assert.deepStrictEqual([nres.success, nres.history, nres.unresolved], [true, 1, ['NOSUCHCHASSIS']]);
assert.deepStrictEqual(ownCat().history.filter(h => h.part === 'Belt').map(h => h.reg), ['HP1']);
// the insight carries the newest GPS.catalogHistory rows per bus, not all years
assert.strictEqual(run('GPS.catalogHistory'), 100);
run('GPS.catalogHistory = 2');
const bounded = J(run('coordGpsInsight_({email:"o@x.org", roles:["Owner"]})')).catalog.history.filter(h => h.reg === 'HP1');
assert.deepStrictEqual(bounded.map(h => h.part), ['Belt', 'Wipers'], 'newest first, two per bus (HP1 has 4 rows: the oldest dropped)');
run('GPS.catalogHistory = 100');
const rej = (payload) => J(run('coordCatalogPush_({secret:"S", payload: ' + JSON.stringify(payload) + '})'));
assert.strictEqual(rej({ models: [{ model: 'M', parts: { 'a|b': part() } }], vehicles: [], history: [] }).success, false, 'a part code with | is refused (it is half the key)');
assert.strictEqual(rej({ models: [], vehicles: [], history: [{ chassis: 'C', date: '5-9-26' }] }).success, false, 'a history date must be yyyy-mm-dd');
assert.strictEqual(rej({ models: [], vehicles: [{ chassis: 'C', warrantyDate: 'soon' }], history: [] }).success, false, 'so must a warranty date');
assert.strictEqual(rej({ models: [{ model: 'M', parts: { tyre: part({ asOf: 'yesterday' }) } }], vehicles: [], history: [] }).success, false, 'and asOf an ISO stamp');
assert.deepStrictEqual(J(run('gpsRows_("Parts Catalog")')).filter(r => r.model === 'M'), [], 'a refused payload stores nothing');
console.log('transport gps: all checks passed');
