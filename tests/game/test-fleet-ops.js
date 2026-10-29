// node tests/game/test-fleet-ops.js -- Fleet Operations (game-fleet.gs): follow-up missions, renewals, roll call, parts due, heat, campus quests.
// Synthetic data only: regs TEST01..., names "Driver One"; no DOB, phone or licence number anywhere.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const dir = __dirname + '/../../apps-script/';
const ctx = { console: Object.assign(Object.create(console), { error() {} }), Logger: { log() {} } };
vm.createContext(ctx);
const load = (f) => vm.runInContext(fs.readFileSync(dir + f, 'utf8'), ctx);
load('game-fleet.gs'); load('../coordinator/capture/fleet-quests.js'); load('../coordinator/transport-rank.js'); load('game.gs'); load('game-actions.gs'); load('game-missions.gs'); load('game-windows.gs'); load('game-quests.gs');
const J = (x) => JSON.parse(JSON.stringify(x));
const NOW = new Date('2026-10-26T05:00:00Z'); // Mon 26 Oct 2026, 10:30 IST
const cfg = J(ctx.gameConfigDefaults_());
const coord = { email: 'coord@test.invalid', campusId: 'ALL', roles: ['Coordinator'], primaryRole: 'Coordinator' };
const coord4 = Object.assign({}, coord, { campusId: 'LMS4' });
const clerk = { email: 'clerk@test.invalid', campusId: 'LMS4', roles: ['FeeClerk'], primaryRole: 'FeeClerk' };
const owner = { email: 'owner@test.invalid', campusId: 'ALL', roles: ['Owner'], primaryRole: 'Owner' };

// ---- config defaults (Game Config key `fleet`)
const F = cfg.fleet;
assert.strictEqual(F.policeVerificationYears, null, 'O1: no police-verification renewal by default'); assert.strictEqual(F.rollCallFrom, '2026-10-27', 'I4: the deploy date (placeholder)');
const defaults = J(cfg); cfg.fleet.rollCallFrom = '2026-10-01'; // the missions below run from before the deploy date; I4 has its own test
assert.ok(F, 'cfg.fleet exists');
assert.strictEqual(F.renewDays, 30); assert.strictEqual(F.rollCallBy, '10:00');
assert.deepStrictEqual(J(ctx.gameParseConfig_([['Key', 'Value'], ['fleet', '{"renewDays":45}']]).fleet.renewDays), 45);
assert.strictEqual(ctx.gameParseConfig_([['Key', 'Value'], ['fleet', '{"renewDays":45}']]).fleet.rollCallBy, '10:00', 'one key overridden, the rest keep their defaults');

// ---- the follow-up skip registry, as game-fleet.gs sets it
assert.deepStrictEqual(J(vm.runInContext('GAME_FOLLOWUP_SKIP.fleet', ctx)),
  ['gps_dead', 'gps_blind', 'gps_none', 'bus_away', 'bus_speed', 'fuel_check', 'fuel_proof', 'bus_inspection', 'bus_equipment', 'capture_route', 'bus_age']);

// ---- heat: one pure function
const heat = (b) => J(ctx.fleetHeat_(Object.assign({ expired: [], open: {} }, b), F));
assert.deepStrictEqual(heat({}), { level: 'cool', reasons: [] });
assert.deepStrictEqual(heat({ expired: ['insurance'] }), { level: 'hot', reasons: ['insurance expired'] });
assert.deepStrictEqual(heat({ open: { gps_blind: 1 } }), { level: 'warm', reasons: ['tracker dark on part of its trips'] });
assert.deepStrictEqual(heat({ noAttendant: true }), { level: 'warm', reasons: ['no attendant on record'] });
assert.strictEqual(heat({ noAttendant: true, open: { fuel_proof: 1 } }).level, 'warm', 'two small items stay warm');
assert.strictEqual(heat({ noAttendant: true, open: { fuel_proof: 2 }, driver60: true }).level, 'hot', 'weights add up to the hot threshold');
assert.deepStrictEqual(heat({ open: { gps_dead: 1 } }), { level: 'hot', reasons: ['tracker silent'] });
assert.deepStrictEqual(heat({ open: { gps_none: 1 } }).reasons, ['no tracker']);
assert.deepStrictEqual(heat({ open: { bus_inspection: 1 } }).reasons, ['no safety check this month']);
assert.deepStrictEqual(heat({ open: { bus_equipment: 2 } }).reasons, ['2 safety items missing']);
assert.deepStrictEqual(heat({ open: { bus_equipment: 1 } }).reasons, ['1 safety item missing']);
assert.deepStrictEqual(heat({ open: { fuel_proof: 1 } }).reasons, ['fuel without proof']);
assert.deepStrictEqual(heat({ overAge: true }).reasons, ['past the 15-year limit']);
assert.deepStrictEqual(heat({ driver60: true }).reasons, ['driver is 60 or over']);
assert.deepStrictEqual(heat({ wrong: ['insurance'] }), { level: 'hot', reasons: ['insurance is the wrong document'] }, 'I3: a wrong document counts like an expired paper');
assert.deepStrictEqual(heat({ driverExpired: ['licence'] }), { level: 'warm', reasons: ['licence expired'] }, 'M1: an expired driver document');
assert.deepStrictEqual(heat({ rollMissing: true }), { level: 'warm', reasons: ['roll call missing yesterday'] }, 'M1: no roll call on a day the bus ran');
assert.deepStrictEqual(heat({ open: { bus_speed: 2 } }), { level: 'cool', reasons: [] }, 'two over-speed follow-ups are not "repeated"');
assert.deepStrictEqual(heat({ open: { bus_speed: 3 } }), { level: 'warm', reasons: ['repeated over-speed'] }, 'three or more: a breach, counted once');
assert.deepStrictEqual(heat({ open: { bus_speed: 9 } }).reasons, ['repeated over-speed']);
assert.deepStrictEqual(heat({ expired: ['insurance', 'PUC'], open: { gps_dead: 1 }, noAttendant: true }).reasons, ['insurance expired', 'PUC expired', 'tracker silent', 'no attendant on record'], 'stable order');
assert.ok(!/fast|quick|speed up|rank|best|worst/i.test(JSON.stringify(heat({ open: { bus_speed: 3 }, expired: ['fitness'] }).reasons)), 'compliance words only');
assert.deepStrictEqual(J(ctx.fleetHeat_({ expired: ['insurance'], open: {} }, { weights: { expiredPaper: 1 }, heat: { warm: 1, hot: 2 } })), { level: 'warm', reasons: ['insurance expired'] }, 'weights and thresholds come from the config');

// ---- the cache shape: new tabs in, compact masked rows out
const H = (h, ...r) => [h].concat(r);
const ID0 = 'a'.repeat(28), ID1 = 'b'.repeat(28), ID2 = 'c'.repeat(28);
const TASKH = ['TaskId', 'Domain', 'Campus', 'Title', 'Detail', 'Status', 'Severity', 'CreatedAt', 'LastSeenAt', 'ResolvedAt', 'ResolvedBy', 'Note', 'Department', 'Assignee', 'Due'];
const trow = (id, domain, campus, title, o) => { o = o || {}; const r = new Array(15).fill(''); r[0] = id; r[1] = domain; r[2] = campus; r[3] = title; r[4] = 'Call the driver Driver One'; r[5] = o.status || 'open'; r[7] = o.created || '2026-10-20T04:00:00.000Z'; r[9] = o.at || ''; r[10] = o.by || ''; r[13] = o.assignee || ''; r[14] = o.due || ''; return r; };
const fleetTab = H(['Reg', 'Bus', 'Campus', 'Operational', 'Route', 'Start', 'Driver', 'Seats', 'Year', 'Driver code'],
  ['TEST-01', '1', 'LMS 4', 'yes', 'R1', '', 'Driver One', 40, 2020, ''], ['TEST02', '2', 'LMS-5', 'yes', '', '', 'Driver Two', 30, 2010, 'E2'], ['TEST09', '9', 'LMS 1', 'no', '', '', '', 0, 0, '']);
const tabs = {
  fleet: fleetTab,
  driver: H(['driverKey', 'reg', 'campus', 'driver', 'fields', 'ageLimit', 'updatedAt', 'updatedBy'],
    ['bus:TEST01', 'TEST01', 'LMS4', 'Driver One', JSON.stringify({ driverPhone: '0000000001', dateOfBirth: '1900-01-01', licenceValidTill: '2026-11-10', medicalCertificateValidTill: '2026-10-20', policeVerificationDate: '2023-11-05', licenceClass: 'HTV' }), 'no', '', ''],
    ['E2', 'TEST02', 'LMS5', 'Driver Two', JSON.stringify({ licenceValidTill: 'soon', medicalCertificateValidTill: '2027-01-01' }), 'yes', '', '']),
  docs: H(['Reg', 'Document', 'Valid to', 'Status', 'Source', 'File', 'Link', 'Note'],
    ['TEST01', 'Insurance', '2026-12-01', 'read', '', '', 'https://x/' + ID0, ''], ['TEST01', 'Insurance', '', 'other document', '', '', 'https://x/' + ID2, ''], ['TEST01', 'Fitness', '2026-11-20', 'override', '', '', '', ''], ['TEST01', 'MV tax', '', 'n/a', '', '', '', 'n'],
    ['TEST01', 'Pollution', '', 'unread', '', '', '', ''], ['TEST02', 'Insurance', '2026-10-20', 'read', '', '', '', ''], ['TEST09', 'Insurance', '2026-10-01', 'read', '', '', '', '']),
  form: H(['Timestamp', 'Reg', 'Document Type', 'Valid till', 'Upload'], ['t', 'TEST01', 'INSURANCE', '12/15/2026', 'https://x/' + ID1], ['t', 'test-02', 'Insurance', '10/30/2026', ''], ['t', 'TEST01', 'RC', '1/1/2030', '']),
  tasks: H(TASKH,
    trow('gps_dead|TEST01', 'gps_dead', 'LMS4', 'TEST01: GPS tracker silent since 20 Oct', { due: '2026-10-29' }),
    trow('fuel_proof|fillx', 'fuel_proof', 'LMS5', 'TEST02, fuel on 24 Oct: no video of the fill', { assignee: 'Coord@Test.invalid' }),
    trow('bus_age|TEST02', 'bus_age', 'LMS5', 'TEST02: registered 2010', { status: 'resolved', at: '2026-10-25T10:00:00.000Z', by: 'coord@test.invalid' }),
    trow('capture_route|TEST01', 'capture_route', 'LMS4', 'old', { status: 'resolved', at: '2026-10-10T10:00:00.000Z', by: 'coord@test.invalid' }),
    trow('fuel_proof|zz', 'fuel_proof', 'LMS4', 'GONE9, fuel on 23 Oct: no video of the fill'),
    trow('hiring|x', 'hiring_stall', 'LMS4', 'not transport')),
  roll: H(['Date', 'Reg', 'Campus', 'Driver', 'Attendant', 'Driver is substitute', 'Attendant is substitute', 'Recorded by', 'Recorded at'],
    ['2026-10-26', 'TEST02', 'LMS5', 'Driver Two', 'Attendant Two', 'no', 'no', 'clerk@test.invalid', '2026-10-26T04:15:00.000Z'], ['2026-10-10', 'TEST01', 'LMS4', 'Driver One', '', 'no', 'no', 'x@test.invalid', '2026-10-10T04:00:00.000Z']),
  daily: H(['reg', 'date', 'km', 'blindKm'], ['TEST01', '2026-10-25', '41.5', '0'], ['TEST01', '2026-10-24', '30', '0'], ['TEST02', '2026-10-25', '0', '0'], ['TEST02', '2026-10-10', '50', '0']),
  service: H(['id', 'campus', 'date', 'reg', 'components', 'amount_rs', 'odometer', 'vendor', 'hasBill'],
    ['s1', 'LMS4', '2026-04-30', 'TEST01', 'brake_front,clutch', '9999', '', 'Test Garage', 'yes'], ['s2', 'LMS4', '2026-02-01', 'TEST01', 'brake_front', '1', '', '', 'no'], ['s3', 'LMS1', '2026-03-01', 'TEST09', 'battery', '1', '', '', 'no']),
  catalog: H(['key', 'model', 'code', 'lifeKm', 'lifeMonths', 'price', 'labour', 'spec', 'components', 'asOf', 'pushedAt'],
    ['k1', 'M1', 'P1', '60000', '6', '1000', '200', 'Brake pads', 'brake_front,brake_rear', '', ''], ['k2', 'M1', 'P2', '60000', '', '1', '1', 'No life', 'clutch', '', '']),
  agency: H(['chassis', 'reg', 'model', 'catalogModel'], ['C1', 'TEST01', 'Long name', 'M1'], ['C2', 'TEST09', 'x', 'M1']),
  checks: H(['id', 'campus', 'date', 'reg', 'litres', 'gpsKm', 'billKm', 'kmpl', 'norm', 'flag'], ['chk1', 'LMS4', '2026-10-24', 'TEST01', 50, 100, 100, 2, 5, 'yes'], ['chk2', 'LMS4', '2026-10-24', 'TEST01', 50, 100, 100, 5, 5, 'no'], ['chk3', 'LMS4', '2026-10-23', 'TEST01', 1, 1, 1, 1, 1, 'yes'], ['chk0', 'LMS4', '2026-08-01', 'TEST01', 1, 1, 1, 1, 1, 'yes']),
  answers: H(['id', 'answer', 'by', 'at'], ['chk3', 'matches', 'clerk@test.invalid', '2026-10-26T03:00:00.000Z']),
};
const sh = J(ctx.fleetShape_(tabs, '2026-10-26'));
assert.strictEqual(sh.fleet[0].year, 2020); assert.strictEqual(sh.fleet[1].year, 2010);
assert.deepStrictEqual(sh.paperDates, { TEST01: { insurance: '2026-12-15', fitness: '2026-11-20' }, TEST02: { insurance: '2026-10-30' } }, 'the form wins when newer; n/a and unread leave no date; not-running buses are dropped');
assert.deepStrictEqual(sh.driverDocs, { 'bus:TEST01': { licence: '2026-11-10', medical: '2026-10-20', police: '2023-11-05' }, E2: { medical: '2027-01-01' } }, 'dates only, and only real dates');
assert.deepStrictEqual(sh.tasks.map((t) => t.id), ['gps_dead|TEST01', 'fuel_proof|fillx', 'bus_age|TEST02', 'fuel_proof|zz'], 'I2: every task of the 11 transport domains, open or resolved in the last 3 days, whether or not its reg is a running bus');
assert.strictEqual(sh.tasks[3].reg, ''); assert.strictEqual(sh.tasks[3].campus, 'LMS4');
assert.deepStrictEqual(sh.tasks[0], { id: 'gps_dead|TEST01', domain: 'gps_dead', campus: 'LMS4', reg: 'TEST01', title: 'TEST01: GPS tracker silent since 20 Oct', status: 'open', assignee: '', due: '2026-10-29', createdAt: '2026-10-20', resolvedAt: '', resolvedBy: '' });
assert.strictEqual(sh.tasks[1].reg, 'TEST02', 'the reg comes from the title when the id carries a fill id'); assert.strictEqual(sh.tasks[1].assignee, 'coord@test.invalid');
assert.deepStrictEqual(sh.tasks[2], { id: 'bus_age|TEST02', domain: 'bus_age', campus: 'LMS5', reg: 'TEST02', title: 'TEST02: registered 2010', status: 'resolved', assignee: '', due: '', createdAt: '2026-10-20', resolvedAt: '2026-10-25T10:00:00.000Z', resolvedBy: 'coord@test.invalid' });
assert.deepStrictEqual(sh.paperDocs, { TEST01: { insurance: { link: ID1, other: [ID2] } } }, 'I3: file ids only (never links): the chosen paper and the other-document scans');
assert.deepStrictEqual(sh.rolls, { TEST02: { '2026-10-26': { by: 'clerk@test.invalid', at: '2026-10-26T04:15:00.000Z' } } }, 'the last 3 days only; no names');
assert.deepStrictEqual(sh.ran, { TEST01: ['2026-10-24', '2026-10-25'] }, 'days the bus moved, last 3 days');
assert.deepStrictEqual(sh.service, { TEST01: { brake_front: '2026-04-30', clutch: '2026-04-30' } }, 'last replacement per component; running buses; no money, no vendor');
assert.deepStrictEqual(sh.partLife, [{ model: 'M1', code: 'P1', name: 'Brake pads', months: 6, components: ['brake_front', 'brake_rear'] }], 'parts with a life in months only');
assert.deepStrictEqual(sh.catModel, { TEST01: 'M1' });
assert.deepStrictEqual(sh.checks, [{ id: 'chk1', campus: 'LMS4', reg: 'TEST01', date: '2026-10-24', answered: false, by: '', at: '' }, { id: 'chk3', campus: 'LMS4', reg: 'TEST01', date: '2026-10-23', answered: true, by: 'clerk@test.invalid', at: '2026-10-26T03:00:00.000Z' }], 'flagged checks of the last 14 days');
assert.ok(!/0000000001|1900-01-01|Test Garage|9999|Attendant/.test(JSON.stringify(sh)), 'no phone, date of birth, money or other names in the cached rows');
assert.ok(!/Driver One|Driver Two/.test(JSON.stringify(Object.assign({}, sh, { fleet: [] }))), 'the roster driver name stays in the fleet rows only (as before)');
const none = J(ctx.fleetShape_({ fleet: fleetTab }, '2026-10-26')); // the new tabs not made yet: empty, not an outage
assert.deepStrictEqual([none.paperDocs, none.paperDates, none.driverDocs, none.tasks, none.rolls, none.ran, none.service, none.partLife, none.checks], [{}, {}, {}, [], {}, {}, {}, [], []]);

// ---- fixtures for the missions
const rows = () => {
  const r = J(ctx.fleetShape_(tabs, '2026-10-26'));
  // our own synthetic fleet (the shape test's has 2 buses): five buses over three campuses
  r.fleet = [
    { reg: 'TEST01', campus: 'LMS 4', campusId: 'LMS4', route: '', driver: 'Driver One', driverCode: '', operational: true, year: 2020, scan: {} },
    { reg: 'TEST02', campus: 'LMS 4', campusId: 'LMS4', route: '', driver: 'Driver Two', driverCode: '', operational: true, year: 2018, scan: {} },
    { reg: 'TEST03', campus: 'LMS 1', campusId: 'LMS1', route: '', driver: 'Driver Three', driverCode: '', operational: true, year: 2019, scan: {} },
    { reg: 'TEST04', campus: 'LMS 5', campusId: 'LMS5', route: '', driver: 'Driver Four', driverCode: '', operational: true, year: 2010, scan: {} },
    { reg: 'TEST05', campus: 'LMS 4', campusId: 'LMS4', route: '', driver: 'Driver Five', driverCode: '', operational: true, year: 2021, scan: {} },
  ];
  const safety = (a) => JSON.stringify({ attendantHelperName: a });
  r.profiles = [{ reg: 'TEST02', safety: safety('none') }, { reg: 'TEST05', safety: safety('Attendant Five') }, { reg: 'TEST01', safety: safety('Attendant One') }, { reg: 'TEST03', safety: safety('A3') }];
  r.drivers = [{ driverKey: 'bus:TEST03', reg: 'TEST03', fields: '{}', ageLimit: 'yes' }];
  r.paperDates = { TEST01: { insurance: '2026-11-25', fitness: '2026-11-26', mv_tax: '2026-10-26', pollution: '2026-10-21', route_permit: '2027-05-01', speed_governor: '2020-01-01' }, TEST03: { insurance: '2026-10-30' } };
  r.driverDocs = { 'bus:TEST01': { licence: '2026-11-10', medical: '2026-10-20', police: '2023-11-05' } };
  r.rolls = { TEST02: { '2026-10-26': { by: 'clerk@test.invalid', at: '2026-10-26T04:15:00.000Z' }, '2026-10-25': { by: 'clerk@test.invalid', at: '2026-10-25T04:15:00.000Z' } } };
  r.ran = { TEST01: ['2026-10-25'], TEST02: ['2026-10-25'] };
  const t = (id, domain, campus, reg, title, o) => Object.assign({ id: id, domain: domain, campus: campus, reg: reg, title: title, status: 'open', assignee: '', due: '', createdAt: '2026-10-20', resolvedAt: '', resolvedBy: '' }, o || {});
  r.tasks = [
    t('gps_dead|TEST01', 'gps_dead', 'LMS4', 'TEST01', 'TEST01: GPS tracker silent since 20 Oct', { due: '2026-10-29' }),
    t('fuel_proof|fill9', 'fuel_proof', 'LMS4', 'TEST02', 'TEST02, fuel on 24 Oct: no video of the fill', { due: '2026-10-25' }),
    t('bus_speed|TEST01|2026-10-12', 'bus_speed', 'LMS4', 'TEST01', 'x', { assignee: 'coord@test.invalid' }),
    t('bus_speed|TEST01|2026-10-19', 'bus_speed', 'LMS4', 'TEST01', 'x', { assignee: 'coord@test.invalid' }),
    t('bus_speed|TEST01|2026-10-05', 'bus_speed', 'LMS4', 'TEST01', 'x', { assignee: 'coord@test.invalid' }),
    t('bus_speed|TEST01|2026-09-14', 'bus_speed', 'LMS4', 'TEST01', 'old week, over 30 days ago', { assignee: 'coord@test.invalid' }),
    t('bus_equipment|TEST01|first_aid', 'bus_equipment', 'LMS4', 'TEST01', 'TEST01: First-aid box missing in the safety check of 20 Oct', { assignee: 'coord@test.invalid' }),
    t('gps_blind|TEST05', 'gps_blind', 'LMS4', 'TEST05', 'TEST05: 40 of 100 km in 7 days driven with the tracker dark', { status: 'resolved', assignee: 'coord@test.invalid', resolvedAt: '2026-10-26T03:00:00.000Z', resolvedBy: 'coord@test.invalid' }),
    t('bus_age|TEST04', 'bus_age', 'LMS5', 'TEST04', 'TEST04: registered 2010, over the 15-year limit', { assignee: 'other@test.invalid' }),
    t('bus_inspection|TEST02', 'bus_inspection', 'LMS4', 'TEST02', 'TEST02: no safety check in October', { status: 'resolved', resolvedAt: '2026-10-26T03:00:00.000Z', resolvedBy: 'system (condition cleared)' }),
    t('capture_route|TEST02', 'capture_route', 'LMS4', 'TEST02', 'TEST02: no route timelapse yet', { assignee: 'coord@test.invalid' }),
    t('bus_away|TEST05|2026-10-24', 'bus_away', 'LMS4', 'TEST05', 'x', { assignee: 'coord@test.invalid' }),
    t('fuel_check|chk7', 'fuel_check', 'LMS4', 'TEST05', 'TEST05: fuel use looks high', { assignee: 'coord@test.invalid' }),
    t('gps_none|TEST03', 'gps_none', 'LMS1', 'TEST03', 'TEST03: no GPS tracker'),
  ];
  r.checks = [{ id: 'chkOld', campus: 'LMS4', reg: 'TEST05', date: '2026-10-20', answered: false, by: '', at: '' }, { id: 'chkA', campus: 'LMS4', reg: 'TEST05', date: '2026-10-24', answered: false, by: '', at: '' }, { id: 'chkB', campus: 'LMS4', reg: 'TEST05', date: '2026-10-23', answered: true, by: 'clerk@test.invalid', at: '2026-10-26T03:00:00.000Z' }];
  r.partLife = [{ model: 'M1', code: 'P1', name: 'Brake pads', months: 6, components: ['brake_front'] }];
  r.catModel = { TEST01: 'M1', TEST02: 'M1', TEST03: 'M1' };
  r.service = { TEST01: { brake_front: '2026-04-30' }, TEST02: { brake_front: '2026-10-01' } };
  return r;
};
const run = (caller, r, c, now) => { ctx.fleetRows_ = () => r || rows(); return J(ctx.fleetMissions_(caller, c || cfg, now || NOW)); };
const quests = (caller, r, c) => { ctx.fleetRows_ = () => { throw new Error('quests read the workbook'); }; ctx.fleetCachedRows_ = () => r || rows(); return J(ctx.fleetQuests_(caller, c || cfg, NOW)); };
const ops = (ms) => ms.filter((m) => /^fleet_ops_/.test(m.kind));
const by = (ms) => { const o = {}; ms.forEach((m) => { o[m.id] = m; }); return o; };

// ---- the Owner gets no missions
assert.deepStrictEqual(run(owner), []);

// ---- Coordinator: follow-ups as fleet_ops_<domain> missions
let cm = by(ops(run(coord)));
let m = cm['fleet_ops_gps_dead:gps_dead|TEST01'];
assert.ok(m, Object.keys(cm).join('\n'));
assert.strictEqual(m.kind, 'fleet_ops_gps_dead'); assert.strictEqual(m.title, 'TEST01 tracker is silent: ask Blackbox to check it');
assert.strictEqual(m.campus, 'LMS4'); assert.strictEqual(m.due, '2026-10-29'); assert.strictEqual(m.go, 'coordinator/transport/live.html'); // C8: closed there with its note
assert.strictEqual(m.shared, true, 'no assignee: shared, no personal credit'); assert.strictEqual(m.owner, ''); assert.strictEqual(m.done, false); assert.strictEqual(m.core, false);
m = cm['fleet_ops_bus_equipment:bus_equipment|TEST01|first_aid'];
assert.strictEqual(m.title, 'First-aid box on TEST01 failed the safety check: fix it and check again'); assert.strictEqual(m.owner, 'coord@test.invalid'); assert.strictEqual(m.shared, false);
assert.ok(!cm['fleet_ops_capture_route:capture_route|TEST02'], 'I1: the setup mission for the timelapse is open, so the follow-up is not a second one');
const capDone = rows(); capDone.captured = { TEST02: { by: 'c@test.invalid', at: '2026-10-01T00:00:00Z' } };
assert.strictEqual(by(ops(run(coord, capDone)))['fleet_ops_capture_route:capture_route|TEST02'].title, 'Run the route timelapse for TEST02', 'once the setup one is done the follow-up shows');
assert.strictEqual(cm['fleet_ops_bus_away:bus_away|TEST05|2026-10-24'].title, 'TEST05 stayed away from its base on Sat 24 Oct: ask the driver why');
assert.strictEqual(cm['fleet_ops_bus_speed:bus_speed|TEST01|2026-10-12'].title, 'Talk to the driver of TEST01 about the 40 km/h limit: week of Mon 12 Oct');
assert.strictEqual(cm['fleet_ops_gps_none:gps_none|TEST03'].title, 'TEST03 has no GPS tracker: get one fitted');
assert.strictEqual(cm['fleet_ops_fuel_check:fuel_check|chk7'].title, 'Fuel use for TEST05 looks high: ask the driver to explain');
assert.ok(!cm['fleet_ops_bus_age:bus_age|TEST04'], "another person's follow-up is not here");
// done: resolved by a person today; gone: cleared by the system
m = cm['fleet_ops_gps_blind:gps_blind|TEST05'];
assert.ok(m.done && m.doneBy === 'coord@test.invalid' && m.doneAt === '2026-10-26T03:00:00.000Z' && !m.shared && !m.gone, JSON.stringify(m));
// the system's resolve of a Fee Clerk item is not the coordinator's: bus_inspection is "gone"
m = cm['fleet_ops_bus_inspection:bus_inspection|TEST02'];
assert.ok(m && m.gone === true && m.done === false);
// one source of truth: the follow-up sits in the registry, so the generic builder would skip it (see test-missions.js)
// the Coordinator's scope: a district Coordinator sees their district only
cm = by(ops(run(coord4)));
assert.ok(cm['fleet_ops_gps_dead:gps_dead|TEST01'] && !cm['fleet_ops_gps_none:gps_none|TEST03'], 'LMS 1 is outside the LMS 4-6 district');
assert.ok(ops(run(coord4)).every((m) => ['LMS4', 'LMS5'].includes(m.campus)));
// pilot
const pilot = J(cfg); pilot.pilotCampuses.Coordinator = ['LMS4'];
assert.ok(ops(run(coord, null, pilot)).every((m) => m.campus === 'LMS4'));

// ---- the Coordinator also gets "get it done" copies of Fee Clerk items that are late (shared, no personal credit)
cm = by(ops(run(coord)));
m = cm['fleet_ops_fuel_proof:fuel_proof|fill9'];
assert.ok(m, 'overdue fuel proof reaches the Coordinator'); assert.strictEqual(m.shared, true);
assert.strictEqual(m.title, "Fuel bill and video for TEST02's fill on 24 Oct still wait on the Fee Clerk");
const onTime = rows(); onTime.tasks.filter((t) => t.id === 'fuel_proof|fill9')[0].due = '2026-10-27';
assert.ok(!by(ops(run(coord, onTime)))['fleet_ops_fuel_proof:fuel_proof|fill9'], 'not late yet: with the clerk only');
assert.strictEqual(cm['fleet_ops_paper:TEST01:pollution'].shared, true, 'an expired paper that waits on the Fee Clerk');
assert.strictEqual(cm['fleet_ops_paper:TEST01:pollution'].title, 'PUC for TEST01 expired on Wed 21 Oct: ask the Fee Clerk to renew it');
assert.ok(!cm['fleet_ops_paper:TEST01:insurance'], 'a paper only expiring soon is the clerk\'s, not the Coordinator\'s');
assert.strictEqual(cm['fleet_ops_driver_doc:TEST01:medical'].title, "Driver One's medical certificate expired on Tue 20 Oct: ask the Fee Clerk to renew it");
assert.strictEqual(cm['fleet_ops_rollcall:TEST01:2026-10-25'].title, "Yesterday's roll call for TEST01 is still missing: ask the Fee Clerk");

// ---- Fee Clerk: fuel proof, fuel check answers, renewals, roll call. Own campus only.
let km = by(ops(run(clerk)));
const kinds = [...new Set(Object.values(km).map((m) => m.kind))].sort();
assert.deepStrictEqual(kinds, ['fleet_ops_driver_doc', 'fleet_ops_fuel_answer', 'fleet_ops_fuel_proof', 'fleet_ops_paper', 'fleet_ops_rollcall']);
assert.ok(Object.values(km).every((m) => m.campus === 'LMS4'));
m = km['fleet_ops_fuel_proof:fuel_proof|fill9'];
assert.strictEqual(m.title, "Fuel bill and video missing for TEST02's fill on 24 Oct"); assert.strictEqual(m.shared, false); assert.strictEqual(m.due, '2026-10-25');
assert.strictEqual(km['fleet_ops_fuel_answer:chkA'].title, "Check the pump slip for TEST05's fill on Sat 24 Oct"); assert.strictEqual(km['fleet_ops_fuel_answer:chkA'].go, 'office/buses.html');
m = km['fleet_ops_fuel_answer:chkB'];
assert.ok(m.done && m.doneBy === 'clerk@test.invalid' && !m.shared, 'answered today: done with credit');

// renewals at 31, 30, 0 and -5 days
const pap = (id) => km['fleet_ops_paper:' + id];
assert.ok(!pap('TEST01:fitness'), '31 days: not yet');
m = pap('TEST01:insurance');
assert.ok(m, '30 days'); assert.strictEqual(m.title, 'Renew insurance for TEST01: expires Wed 25 Nov'); assert.strictEqual(m.due, '2026-11-25');
assert.strictEqual(m.kind, 'fleet_ops_paper'); assert.strictEqual(m.owner, ''); assert.strictEqual(m.shared, false); assert.strictEqual(m.go, 'office/transport.html');
assert.strictEqual(pap('TEST01:mv_tax').title, 'Renew MV tax for TEST01: expires Mon 26 Oct'); assert.strictEqual(pap('TEST01:mv_tax').due, '2026-10-26');
assert.strictEqual(pap('TEST01:pollution').title, 'Renew PUC for TEST01: expired Wed 21 Oct'); assert.strictEqual(pap('TEST01:pollution').due, '2026-10-21', 'expired: the same mission, overdue');
assert.ok(!pap('TEST01:route_permit') && !pap('TEST01:speed_governor'), 'later, and a one-time paper never expires');
assert.ok(!km['fleet_ops_paper:TEST03:insurance'], 'another campus');
const wide = J(cfg); wide.fleet.renewDays = 31;
assert.ok(by(ops(run(clerk, null, wide)))['fleet_ops_paper:TEST01:fitness'], 'cfg.fleet.renewDays moves the window');
// driver documents: the driver's name and the document only
assert.strictEqual(km['fleet_ops_driver_doc:TEST01:licence'].title, "Renew Driver One's licence: expires Tue 10 Nov");
assert.strictEqual(km['fleet_ops_driver_doc:TEST01:medical'].title, "Renew Driver One's medical certificate: expired Tue 20 Oct");
assert.ok(!km['fleet_ops_driver_doc:TEST01:police'], 'O1: no police-verification renewal by default');
const pol = J(cfg); pol.fleet.policeVerificationYears = 3;
assert.strictEqual(by(ops(run(clerk, null, pol)))['fleet_ops_driver_doc:TEST01:police'].title, "Renew Driver One's police verification: expires Thu 5 Nov", 'configured: date plus the years');
assert.strictEqual(km['fleet_ops_driver_doc:TEST01:licence'].go, 'coordinator/transport/setup.html?reg=TEST01&quest=driver');
// roll call: after 10:00 IST, today's missing; yesterday's when the bus ran
assert.strictEqual(km['fleet_ops_rollcall:TEST01:2026-10-26'].title, "Mark today's roll call for TEST01");
assert.strictEqual(km['fleet_ops_rollcall:TEST01:2026-10-25'].title, "Mark yesterday's roll call for TEST01");
assert.ok(km['fleet_ops_rollcall:TEST05:2026-10-26'] && !km['fleet_ops_rollcall:TEST05:2026-10-25'], 'yesterday only when GPS shows the bus ran');
m = km['fleet_ops_rollcall:TEST02:2026-10-26'];
assert.ok(m.done && m.doneBy === 'clerk@test.invalid' && m.doneAt === '2026-10-26T04:15:00.000Z' && !m.shared, 'recorded today: done with credit');
m = km['fleet_ops_rollcall:TEST02:2026-10-25'];
assert.ok(m && m.done && m.doneBy === 'clerk@test.invalid', 'yesterday\'s, recorded yesterday: still in the done window');
assert.strictEqual(km['fleet_ops_rollcall:TEST01:2026-10-26'].go, 'coordinator/transport/rollcall.html');
const early = run(clerk, null, null, new Date('2026-10-26T03:00:00Z')); // 08:30 IST
assert.ok(!ops(early).some((m) => m.id === 'fleet_ops_rollcall:TEST01:2026-10-26'), 'before cfg.fleet.rollCallBy: not yet');
assert.ok(ops(early).some((m) => m.id === 'fleet_ops_rollcall:TEST01:2026-10-25'), "yesterday's is still missing in the morning");
const sunday = run(clerk, null, null, new Date('2026-11-01T06:00:00Z'));
assert.ok(!ops(sunday).some((m) => /rollcall:TEST01:2026-11-01/.test(m.id)), 'no roll call on a Sunday');
const late = J(cfg); late.fleet.rollCallBy = '12:00';
assert.ok(!ops(run(clerk, null, late)).some((m) => m.id === 'fleet_ops_rollcall:TEST01:2026-10-26'), 'rollCallBy is config');
// a clerk of another campus sees only their own
assert.ok(ops(run(Object.assign({}, clerk, { campusId: 'LMS1' }))).every((m) => m.campus === 'LMS1'));
// no clerk item is a Coordinator-only follow-up and vice versa
assert.ok(!ops(run(clerk)).some((m) => ['fleet_ops_gps_dead', 'fleet_ops_bus_equipment', 'fleet_ops_capture_route'].includes(m.kind)));

// ---- part-due missions (Coordinator): last replacement from Service Bills + the catalog's life in months
cm = by(ops(run(coord)));
m = cm['fleet_ops_part:TEST01:P1'];
assert.ok(m, Object.keys(cm).join('\n')); assert.strictEqual(m.title, 'Check Brake pads on TEST01: last replaced Thu 30 Apr'); assert.strictEqual(m.due, '2026-10-30'); assert.strictEqual(m.shared, false);
assert.ok(!cm['fleet_ops_part:TEST02:P1'], 'replaced recently: not due'); assert.ok(!cm['fleet_ops_part:TEST03:P1'], 'no service bill on file: nothing to say');
const emptyCat = rows(); emptyCat.partLife = [];
assert.ok(!ops(run(coord, emptyCat)).some((x) => x.kind === 'fleet_ops_part'), 'an empty Parts Catalog emits nothing');
assert.ok(!ops(run(clerk)).some((x) => x.kind === 'fleet_ops_part'));

// ---- heat from the rows
const heats = J(ctx.fleetHeats_(rows(), '2026-10-26', cfg));
assert.strictEqual(heats.TEST01.level, 'hot');
assert.deepStrictEqual(heats.TEST01.reasons, ['PUC expired', 'medical certificate expired', 'tracker silent', '1 safety item missing', 'roll call missing yesterday', 'repeated over-speed'], 'only the 3 over-speed weeks inside 30 days count: ' + JSON.stringify(heats.TEST01.reasons));
assert.deepStrictEqual(heats.TEST02, { level: 'warm', reasons: ['fuel without proof', 'no attendant on record'] });
assert.deepStrictEqual(heats.TEST03, { level: 'hot', reasons: ['no tracker', 'driver is 60 or over'] });
assert.strictEqual(heats.TEST05.level, 'cool');
assert.deepStrictEqual(heats.TEST04.reasons, ['past the 15-year limit', 'no attendant on record']);

// ---- quests: the campus operations quest (Coordinator + Owner), the Owner's monthly P&L reminder; the cache only
let qs = quests(coord).filter((q) => /^fleet-ops:/.test(q.questId));
assert.deepStrictEqual(qs.map((q) => q.questId), ['fleet-ops:LMS1', 'fleet-ops:LMS4', 'fleet-ops:LMS5']);
let q4 = qs[1];
assert.strictEqual(q4.title, 'LMS 4 operations: every bus cool this week'); assert.strictEqual(q4.parallel, true); assert.strictEqual(q4.complete, false);
assert.deepStrictEqual(q4.steps.map((s) => [s.id, s.done]), [['heat', false], ['TEST01', false], ['TEST02', false], ['TEST05', true]], 'the hot ones first, then the warm, then the cool');
assert.strictEqual(q4.steps[0].title, 'LMS 4: 1 hot, 1 warm, 1 cool');
assert.strictEqual(q4.steps[1].title, 'TEST01 · hot: PUC expired, medical certificate expired, tracker silent, 1 safety item missing, roll call missing yesterday, repeated over-speed');
assert.strictEqual(q4.steps[3].title, 'TEST05 · cool'); assert.strictEqual(q4.steps[1].go, 'coordinator/transport/setup.html?reg=TEST01');
assert.ok(q4.steps.every((s) => s.locked === false));
assert.deepStrictEqual(quests(coord4).filter((q) => /^fleet-ops:/.test(q.questId)).map((q) => q.questId), ['fleet-ops:LMS4', 'fleet-ops:LMS5']);
const allCool = rows(); allCool.tasks = []; allCool.paperDates = {}; allCool.driverDocs = {}; allCool.drivers = []; allCool.ran = {};
allCool.profiles.forEach((p) => { p.safety = JSON.stringify({ attendantHelperName: 'A' }); });
const qc = quests(coord, allCool).filter((q) => /^fleet-ops:LMS4/.test(q.questId))[0];
assert.strictEqual(qc.complete, true, JSON.stringify(qc)); assert.strictEqual(qc.steps[0].title, 'LMS 4: 0 hot, 0 warm, 3 cool'); assert.strictEqual(qc.steps[0].done, true);
let oq = quests(owner);
assert.deepStrictEqual(oq.filter((q) => /^fleet-ops:/.test(q.questId)).map((q) => q.questId), ['fleet-ops:LMS1', 'fleet-ops:LMS4', 'fleet-ops:LMS5'], 'the Owner sees every campus');
assert.ok(!quests(owner).concat(quests(coord)).some((q) => /^fleet-pnl:/.test(q.questId)), 'O2: no P&L review step');
// the quests read the cache only; a cold cache gives no quests
let opened = 0; ctx.SpreadsheetApp = { openById() { opened++; throw new Error('workbook read'); } };
ctx.fleetCachedRows_ = () => null;
assert.deepStrictEqual(J(ctx.fleetQuests_(owner, cfg, NOW)), []); assert.deepStrictEqual(J(ctx.fleetQuests_(coord, cfg, NOW)), []); assert.strictEqual(opened, 0);
ctx.fleetRows_ = () => { throw new Error('workbook down'); };
assert.throws(() => ctx.fleetMissions_(clerk, cfg, NOW), /workbook down/, 'read failures throw');

// ---- fix round 1
// I1: one job, one mission: a never-inspected bus with an open bus_inspection follow-up gets exactly one safety mission
{
  const r = rows(); r.tasks.push({ id: 'bus_inspection|TEST01', domain: 'bus_inspection', campus: 'LMS4', reg: 'TEST01', title: 'TEST01: no safety check in October', status: 'open', assignee: '', due: '', createdAt: '2026-10-20', resolvedAt: '', resolvedBy: '' });
  const safety = run(coord, r).filter((m) => m.campus === 'LMS4' && /monthly safety check/.test(m.title) && /TEST01/.test(m.title));
  assert.deepStrictEqual(safety.map((m) => m.id), ['fleet_safety:TEST01'], 'exactly one safety mission: ' + JSON.stringify(safety.map((m) => m.id)));
  r.inspected = { TEST01: { by: 'c@test.invalid', at: '2026-10-02' } };
  assert.ok(by(run(coord, r))['fleet_ops_bus_inspection:bus_inspection|TEST01'], 'once the setup safety check is done, the monthly follow-up shows');
}
// I2: every transport follow-up appears somewhere, scoped by its own campus
{
  const r = rows(), t = (id, domain, campus, title, o) => Object.assign({ id: id, domain: domain, campus: campus, reg: '', title: title, status: 'open', assignee: '', due: '', createdAt: '2026-10-20', resolvedAt: '', resolvedBy: '' }, o || {});
  r.tasks.push(t('fuel_proof|zz', 'fuel_proof', 'LMS4', 'GONE9, fuel on 23 Oct: no video of the fill'), t('gps_dead|GONE8', 'gps_dead', 'LMS4', 'GONE8: GPS tracker silent since 20 Oct', { assignee: 'coord@test.invalid' }),
    t('fuel_proof|zy', 'fuel_proof', 'LMS1', 'GONE7, fuel on 23 Oct: no video of the fill'));
  m = by(ops(run(clerk, r)))['fleet_ops_fuel_proof:fuel_proof|zz'];
  assert.ok(m, 'a fuel_proof for a vehicle that is not a running bus still reaches the Fee Clerk'); assert.strictEqual(m.title, 'GONE9, fuel on 23 Oct: no video of the fill', 'its own title'); assert.strictEqual(m.campus, 'LMS4');
  assert.ok(!by(ops(run(clerk, r)))['fleet_ops_fuel_proof:fuel_proof|zy'], "another campus's clerk does not get it");
  assert.ok(by(ops(run(Object.assign({}, clerk, { campusId: 'LMS1' }), r)))['fleet_ops_fuel_proof:fuel_proof|zy']);
  assert.ok(by(ops(run(coord, r)))['fleet_ops_gps_dead:gps_dead|GONE8'], 'a Coordinator gets a follow-up for a vehicle outside the roster');
  assert.ok(!by(ops(run(coord4, r)))['fleet_ops_fuel_proof:fuel_proof|zy'] && by(ops(run(coord4, r)))['fleet_ops_gps_dead:gps_dead|GONE8'], 'scoped by the task row\'s campus');
}
// I3: a paper read as the wrong document (or unread) is never current
{
  const L = 'd'.repeat(28), r = rows(); r.paperDocs = { TEST01: { fitness: { link: L, other: [{ link: L }].map((x) => x.link) } }, TEST03: { insurance: { link: L, other: [L] } } };
  const km2 = by(ops(run(clerk, r)));
  m = km2['fleet_ops_paper:TEST01:fitness'];
  assert.ok(m, 'a wrong document gets a mission even 31 days out'); assert.strictEqual(m.title, 'Upload the right fitness for TEST01'); assert.strictEqual(m.due, null);
  assert.strictEqual(by(ops(run(Object.assign({}, clerk, { campusId: 'LMS1' }), r)))['fleet_ops_paper:TEST03:insurance'].title, 'Upload the right insurance for TEST03', 'inside the window too: the wrong-document wording wins');
  assert.ok(!by(ops(run(coord, r)))['fleet_ops_paper:TEST01:fitness'], 'not overdue: the clerk\'s');
  assert.ok(J(ctx.fleetHeats_(r, '2026-10-26', cfg)).TEST01.reasons.indexOf('fitness is the wrong document') !== -1, 'heat counts it');
  const r2 = rows(); r2.paperDocs = { TEST01: { fitness: { link: 'e'.repeat(28), other: [L] } } }; // another file is "other": the paper itself is fine
  assert.ok(!by(ops(run(clerk, r2)))['fleet_ops_paper:TEST01:fitness']);
}
// I4: no roll-call mission for a day before cfg.fleet.rollCallFrom
{
  const rc = (c, now) => ops(run(clerk, null, c, now)).filter((m) => m.kind === 'fleet_ops_rollcall').map((m) => m.id);
  assert.deepStrictEqual(rc(defaults, NOW), [], 'before the deploy date: no roll-call mission, today\'s or yesterday\'s');
  const d27 = rc(defaults, new Date('2026-10-27T05:00:00Z'));
  assert.ok(d27.indexOf('fleet_ops_rollcall:TEST01:2026-10-27') !== -1 && !d27.some((id) => /2026-10-26$/.test(id)), 'from the deploy date: today\'s only');
  const ex = J(defaults); ex.fleet.rollCallFrom = '2026-10-25';
  assert.ok(rc(ex, NOW).indexOf('fleet_ops_rollcall:TEST01:2026-10-25') !== -1, 'yesterday on the date itself');
}
// M3: the bus_age title says what is true; M8: a fuel check leaves the clerk after cfg days
{
  const r = rows(); r.fleet[2].year = 2012;
  r.tasks.push({ id: 'bus_age|TEST03', domain: 'bus_age', campus: 'LMS1', reg: 'TEST03', title: 'x', status: 'open', assignee: '', due: '', createdAt: '2026-10-20', resolvedAt: '', resolvedBy: '' });
  assert.strictEqual(by(ops(run(coord, r)))['fleet_ops_bus_age:bus_age|TEST03'].title, 'TEST03 reaches the 15-year limit in 2027: plan its replacement');
  r.fleet[2].year = 2010; assert.strictEqual(by(ops(run(coord, r)))['fleet_ops_bus_age:bus_age|TEST03'].title, 'TEST03 has reached the 15-year limit: plan its replacement');
  assert.ok(!km['fleet_ops_fuel_answer:chkOld'] && km['fleet_ops_fuel_answer:chkA'], 'an unanswered check older than the clerk window has gone to the Coordinator');
}

// ---- privacy and voice across every mission and quest
const all = run(coord).concat(run(clerk)); const allQ = quests(owner).concat(quests(coord));
const text = JSON.stringify(all.map((m) => [m.title, m.why]).concat(allQ));
assert.ok(!/0000000001|1900|\b\d{10}\b|dateOfBirth|driverPhone|licenceNo|DL-?\d/.test(text), 'no DOB, phone or licence number');
all.filter((m) => /^fleet_ops_/.test(m.kind)).forEach((m) => {
  assert.ok(!/\b(fast|quick|speed up|hurry|rank|best|worst|great|well done)\b/i.test(m.title + ' ' + m.why), 'no praise or speed words: ' + m.title);
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(m.title), 'no ISO dates in titles: ' + m.title);
  assert.ok(m.go && m.id.indexOf('fleet_ops_') === 0 && m.id.indexOf(m.kind + ':') === 0, m.id);
});
console.log('game fleet ops: ok');
