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
load('coordinator.gs'); load('coordinator-approvals.gs'); load('coordinator-transport.gs'); load('coordinator-transport-gps.gs');
const run = c => vm.runInContext(c, ctx);

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
console.log('transport gps: all checks passed');
