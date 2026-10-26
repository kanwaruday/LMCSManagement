// coordinator/capture/fleet-quests.js: the Fleet setup quests' pure logic, shared by the setup page and the Coordinator backend
// (deployed into that Apps Script project by deploy.mjs) and, from December, the Game Backend. Covers completion, missing
// fields, the questionnaire mapping (header-only fixture), the Game Quests / Game Config row shape, missions, the team bar and
// the Owner's gaps. Plain asserts, one line per named check.
const fs = require('fs'), path = require('path'), assert = require('assert');
const FILE = path.join(__dirname, '../../coordinator/capture/fleet-quests.js');
const FQ = require(FILE);
const t = (name, fn) => { fn(); console.log('ok  ' + name); };
const TODAY = '2026-10-25';

// a bus with every quest done (fields as the forms send them)
const fleetRow = { reg: 'HP659511', campus: 'LMS 4', campusId: 'LMS4', route: '18', driver: 'D1', driverCode: 'E101', operational: true };
function fullRows() {
  const cfg = FQ.questConfig(), step = (id) => cfg.steps.find((s) => s.id === id);
  const fill = (id) => { const o = {}; step(id).fields.forEach((f) => { if (f.type !== 'inspection' && f.type !== 'derived') o[f.id] = f.type === 'photo' ? 'FILEID0123456789' : f.type === 'date' ? '2026-01-10' : f.type === 'yesno' ? 'yes' : f.options ? f.options[0] : f.type === 'number' ? '100' : f.type === 'phone' ? '9800000000' : 'x'; }); return o; };
  const driver = fill('driver'); driver.dateOfBirth = '1980-05-02';
  return {
    fleet: [fleetRow],
    profiles: [{ reg: 'HP659511', campus: 'LMS 4', papers: JSON.stringify(fill('papers')), safety: JSON.stringify(fill('safety')), fuel: JSON.stringify(fill('fuel')), capture: JSON.stringify(fill('capture')) }],
    drivers: [{ driverKey: 'E101', reg: 'HP659511', campus: 'LMS 4', driver: 'D1', fields: JSON.stringify(driver), ageLimit: '' }],
    parts: step('parts').parts.map((p) => ({ reg: 'HP659511', campus: 'LMS 4', component: p.id, fields: JSON.stringify({ lastReplacedOn: p.id === 'battery' ? 'not known' : '2025-03-01' }) })),
    inspected: { HP659511: true }, captured: { HP659511: true },
  };
}

t('completion is 0 for an empty profile and 100 when all six quests are done', () => {
  assert.strictEqual(FQ.completion({}), 0);
  const p = FQ.profilesFromRows(fullRows())[0];
  assert.deepStrictEqual(FQ.questsFor(p).map((q) => q.id), ['papers', 'safety', 'parts', 'driver', 'fuel', 'capture'], 'the six quest ids, in order');
  assert.deepStrictEqual(FQ.questsFor(p).filter((q) => !q.done).map((q) => q.id + ':' + q.missing), [], 'every quest done');
  assert.strictEqual(FQ.completion(p), 100);
  assert.strictEqual(FQ.isReady(p), true);
  const noRun = FQ.profilesFromRows(Object.assign(fullRows(), { captured: {} }))[0];
  assert.strictEqual(FQ.completion(noRun), 83, 'each quest weighs one sixth: five done is 83%');
  assert.deepStrictEqual(FQ.questsFor(noRun).find((q) => q.id === 'capture').missing, ['routeTimelapse'], 'the capture quest is done only by a processed route timelapse, never a tick');
  const noCheck = FQ.profilesFromRows(Object.assign(fullRows(), { inspected: {} }))[0];
  assert.deepStrictEqual(FQ.questsFor(noCheck).find((q) => q.id === 'safety').missing, ['inspection'], 'the safety quest needs the first safety check');
});

t('missions: a safety or capture quest completed by the run itself credits the run\'s capturer (Captured By, Ruling 41)', () => {
  const rows = fullRows();
  rows.inspected = { HP659511: { by: 'rider@x.org', at: '2026-10-21' } }; rows.captured = { HP659511: { by: 'rider2@x.org', at: '2026-10-30T02:00:00Z' } };
  const m = (id) => FQ.transportMissions(rows).find((x) => x.id === 'transport:setup_' + id + ':HP659511');
  assert.deepStrictEqual([m('capture').done, m('capture').doneBy, m('capture').doneAt], [true, 'rider2@x.org', '2026-10-30T02:00:00Z'], 'the route timelapse completes the capture quest: its capturer');
  assert.deepStrictEqual([m('safety').doneBy, m('safety').doneAt], ['rider@x.org', '2026-10-21'], 'the attendant was saved first: the safety check completed it, so its capturer');
  rows.profiles[0].saved = JSON.stringify({ safety: { by: 'clerk@x.org', at: 't', doneBy: 'clerk@x.org', doneAt: 't' } });
  assert.strictEqual(m('safety').doneBy, 'clerk@x.org', 'a save that completed the quest (after the check) keeps its own credit');
  assert.strictEqual(FQ.profilesFromRows(rows)[0].inspected, true, 'the flags stay booleans on the profile');
});

t('papers quest missing chassisNo lists it in missing', () => {
  const rows = fullRows(), papers = JSON.parse(rows.profiles[0].papers);
  delete papers.chassisNo; papers.engineNo = '  ';
  rows.profiles[0].papers = JSON.stringify(papers);
  const q = FQ.questsFor(FQ.profilesFromRows(rows)[0]).find((x) => x.id === 'papers');
  assert.strictEqual(q.done, false);
  assert.deepStrictEqual(q.missing, ['chassisNo', 'engineNo'], 'a blank counts as missing');
  assert.strictEqual(q.label, 'Vehicle papers');
  const parts = FQ.profilesFromRows(Object.assign(fullRows(), { parts: [] }))[0];
  assert.strictEqual(FQ.questsFor(parts).find((x) => x.id === 'parts').missing.length, 20, 'parts lists every part with no date or "not known"');
  const old = FQ.profilesFromRows(Object.assign(fullRows(), { parts: fullRows().parts.map((r) => Object.assign({}, r, { fields: '{"lastReplacedOn":"not known"}' })) }))[0];
  assert.strictEqual(FQ.questsFor(old).find((x) => x.id === 'parts').done, true, '"not known" answers a part (no guessing)');
});

t('old questionnaire columns map 1:1 to quest fields', () => {
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/questionnaire-headers.json'), 'utf8'));
  // the rule: camelCase of the column with its (bracket note), "?", and " uploaded to portal" dropped
  const camel = (h) => h.replace(/\([^)]*\)/g, ' ').replace(/ uploaded to portal/i, ' ').replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ')
    .map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join('');
  const SHEET = { Vehicles: 'papers', 'Safety equipment': 'safety', 'Parts last replaced': 'parts', Drivers: 'driver', Fuel: 'fuel', 'Capture plan': 'capture' };
  const KEY = ['Registration no.', 'Campus', 'Part']; // the row's key, not a field
  const cfg = FQ.questConfig();
  Object.keys(SHEET).forEach((sheet) => {
    const step = cfg.steps.find((s) => s.id === SHEET[sheet]);
    const cols = fx[sheet].filter((c) => KEY.indexOf(c) === -1 && !/\(our records\)/.test(c)); // grey "our records" columns come from the roster
    assert.deepStrictEqual(step.fields.map((f) => f.col), cols, sheet + ': one field per column, in order');
    step.fields.forEach((f) => assert.strictEqual(f.id, camel(f.col), sheet + ': ' + f.col));
  });
  assert.deepStrictEqual(cfg.workshopCols, fx.Workshops, 'the Workshops tab keeps the questionnaire\'s own column names (people fill it in)');
  assert.ok(!fx.Agencies.some((c) => cfg.steps.some((s) => s.fields.some((f) => f.col === c && c !== 'Notes'))), 'Agencies is the agency import (Task 9), not a quest');
  // parts are the day book's component ids (Task 1)
  const office = fs.readFileSync(path.join(__dirname, '../../apps-script/office-config.gs'), 'utf8');
  const ids = [...office.match(/var OFFICE_COMPONENTS = \[[\s\S]*?\n\];/)[0].matchAll(/\['([a-z_]+)', '/g)].map((m) => m[1]);
  const parts = cfg.steps.find((s) => s.id === 'parts').parts;
  assert.strictEqual(parts.length, 20);
  parts.forEach((p) => assert.ok(ids.indexOf(p.id) !== -1, 'part ' + p.id + ' is a day-book component id'));
  assert.deepStrictEqual(parts.filter((p) => /^tyre_/.test(p.id)).map((p) => p.id), ['tyre_fl', 'tyre_fr', 'tyre_rl', 'tyre_rr', 'tyre_spare'], 'tyres by position, as the day book books them');
});

t('goals are config: questConfig() reads Game Quests / Game Config rows', () => {
  const d = FQ.DEFAULT_ROWS;
  assert.deepStrictEqual(Object.keys(d.quests[0]), ['QuestId', 'Role', 'Title', 'UnlockAfter', 'StepsJson', 'Reward'], 'a Game Quests row');
  assert.strictEqual(d.quests[0].Reward, 'Ready badge');
  const steps = JSON.parse(d.quests[0].StepsJson);
  assert.deepStrictEqual(steps.map((s) => s.id), ['papers', 'safety', 'parts', 'driver', 'fuel', 'capture']);
  steps.forEach((s) => assert.deepStrictEqual(Object.keys(s), ['id', 'title', 'go', 'doneCheck'], 'StepsJson holds the contract step shape only'));
  assert.ok(d.config.every((r) => Object.keys(r).join() === 'Key,Value' && typeof r.Value === 'string'), 'Game Config rows: Key, Value (JSON text)');
  assert.deepStrictEqual(d.config.map((r) => r.Key), ['transport', 'transportSetupForms'], 'one namespaced key, like the plan\'s cap: {...}');
  assert.deepStrictEqual(JSON.parse(d.config[0].Value), { loadCapFactor: 1.4, driverAgeLimit: 60 });
  assert.strictEqual(FQ.questConfig().loadCapFactor, 1.4);
  assert.strictEqual(FQ.questConfig().driverAgeLimit, 60);
  // an override wins; bad JSON falls back; sheet arrays (header row first) work too
  const over = FQ.questConfig({ config: [{ Key: 'transport', Value: '{"driverAgeLimit":62}' }, { Key: 'transportSetupForms', Value: 'not json' }] });
  assert.deepStrictEqual([over.driverAgeLimit, over.loadCapFactor, over.steps[0].fields.length], [62, 1.4, 15], 'an override row wins; bad JSON falls back to the default');
  const arr = FQ.questConfig({ config: [['Key', 'Value'], ['transport', '{"loadCapFactor":1.2}']],
    quests: [['QuestId', 'Role', 'Title', 'UnlockAfter', 'StepsJson', 'Reward'], ['transport:setup', 'FeeClerk', 'Bus setup', '', JSON.stringify(steps.slice(0, 2)), 'Star']] });
  assert.deepStrictEqual([arr.loadCapFactor, arr.title, arr.reward, arr.steps.map((s) => s.id)], [1.2, 'Bus setup', 'Star', ['papers', 'safety']]);
  assert.strictEqual(arr.steps[0].fields[2].id, 'chassisNo', 'a step\'s form comes from transportSetupForms by its id');
  // a copy: callers cannot change the defaults
  const c = FQ.questConfig(); c.steps[0].title = 'X'; c.steps[0].doneCheck.required.length = 0; c.driverAgeLimit = 1;
  assert.deepStrictEqual([FQ.questConfig().steps[0].title, FQ.questConfig().steps[0].doneCheck.required.length, FQ.questConfig().driverAgeLimit], ['Vehicle papers', 8, 60], 'the defaults stay intact');
  // setConfigRows: every function uses the override, until it is cleared
  FQ.setConfigRows({ config: [{ Key: 'transport', Value: '{"driverAgeLimit":55}' }] });
  try {
    assert.strictEqual(FQ.validateQuest('driver', { dateOfBirth: '1968-01-01' }, TODAY).ageLimit, true, 'validation uses the override (55)');
    assert.strictEqual(FQ.questConfig().driverAgeLimit, 55);
  } finally { FQ.setConfigRows(null); }
  assert.strictEqual(FQ.validateQuest('driver', { dateOfBirth: '1968-01-01' }, TODAY).ageLimit, false, 'cleared: back to 60');
  const src = fs.readFileSync(FILE, 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(!/\b(window|document|localStorage|fetch|navigator|SpreadsheetApp|Date\.now|new Date\(\))\b|=>|\b(let|const|class)\s+[A-Za-z_$]|`/.test(src), 'plain ES5, no I/O, no clock: copies into a .gs file unchanged');
});

t('missions: one per setup quest, done from data, doneBy from the completing save', () => {
  const rows = fullRows();
  rows.fleet.push({ reg: 'HP2', campus: 'LMS 5', campusId: 'LMS5', route: '', driver: '', driverCode: '', operational: true },
    { reg: 'HP3', campus: 'LMS 5', campusId: 'LMS5', operational: false });
  let ms = FQ.transportMissions(rows);
  assert.strictEqual(ms.length, 12, 'six per running bus, done or not; none for a bus off the road');
  assert.strictEqual(ms.filter((m) => m.done).length, 6, 'the ready bus: six done missions');
  const m = ms.find((x) => x.id === 'transport:setup_papers:HP2');
  assert.deepStrictEqual(Object.keys(m), ['id', 'module', 'kind', 'title', 'why', 'owner', 'role', 'campus', 'go', 'due', 'source', 'done'], 'an open mission: no doneBy');
  assert.strictEqual(m.module, 'transport'); assert.strictEqual(m.kind, 'setup_papers'); assert.strictEqual(m.campus, 'LMS5'); assert.strictEqual(m.role, 'FeeClerk');
  assert.strictEqual(m.due, null); assert.strictEqual(m.done, false); assert.strictEqual(m.owner, null);
  assert.strictEqual(m.go, 'coordinator/transport/setup.html?reg=HP2&quest=papers');
  assert.match(m.why, /^Still needs /);
  // a save that completes the fuel quest: done, with doneBy and doneAt; a later edit keeps the completer
  const fuel = { usualFuelPump: 'HP pump', paymentCreditAccountOrCash: 'Credit', driverHasASmartphoneForTheFillVideo: 'yes' };
  FQ.applySave(rows, 'hp-2', 'fuel', fuel, { by: 'a@x.org', at: '2026-10-25T05:00:00Z' });
  assert.strictEqual(FQ.transportMissions(rows).find((x) => x.id === 'transport:setup_fuel:HP2').done, false, 'three of four: still open');
  FQ.applySave(rows, 'HP2', 'fuel', Object.assign({ whoReceivesTheFillVideoAndBill: 'Neha' }, fuel), { by: 'b@x.org', at: '2026-10-25T06:00:00Z' });
  FQ.applySave(rows, 'HP2', 'fuel', Object.assign({ whoReceivesTheFillVideoAndBill: 'Neha', notes: 'typo fixed' }, fuel), { by: 'c@x.org', at: '2026-10-25T07:00:00Z' });
  const done = FQ.transportMissions(rows).find((x) => x.id === 'transport:setup_fuel:HP2');
  assert.deepStrictEqual([done.done, done.doneBy, done.doneAt, done.why], [true, 'b@x.org', '2026-10-25T06:00:00Z', 'Done.'], 'doneBy is whoever saved the completing data, not a later editor');
  assert.deepStrictEqual(JSON.parse(rows.profiles.find((p) => p.reg === 'HP2').saved).fuel, { by: 'c@x.org', at: '2026-10-25T07:00:00Z', doneBy: 'b@x.org', doneAt: '2026-10-25T06:00:00Z' }, 'savedBy/savedAt per quest in Fleet Profile');
  FQ.applySave(rows, 'HP2', 'fuel', {}, { by: 'd@x.org', at: 'x' });
  assert.strictEqual(FQ.transportMissions(rows).find((x) => x.id === 'transport:setup_fuel:HP2').doneBy, undefined, 'cleared: open again, no doneBy');
  assert.strictEqual(FQ.applySave(rows, 'HP404', 'fuel', {}, {}), null, 'a bus not in the rows');
  const q = FQ.questFor(FQ.profilesFromRows(rows)[1]);
  assert.deepStrictEqual(Object.keys(q), ['id', 'role', 'module', 'title', 'unlockAfter', 'steps', 'reward']);
  assert.strictEqual(q.id, 'transport:setup:HP2'); assert.strictEqual(q.unlockAfter, null); assert.strictEqual(q.reward, 'Ready badge');
  assert.deepStrictEqual(Object.keys(q.steps[0]), ['id', 'title', 'go', 'doneCheck']);
});

t('team bar and gaps: counts only, nobody ranked', () => {
  const rows = fullRows();
  rows.fleet.push({ reg: 'HP2', campus: 'LMS 4', campusId: 'LMS4', operational: true }, { reg: 'HP4', campus: 'LMS 4', campusId: 'LMS4', operational: true });
  const ps = FQ.profilesFromRows(rows);
  assert.strictEqual(FQ.teamBar('LMS 4', ps).text, 'LMS 4 fleet: 1 of 3 buses ready');
  assert.strictEqual(FQ.teamBar('LMS 6', ps).text, 'LMS 6 fleet: 0 of 0 buses ready');
  const g = FQ.gaps(ps);
  assert.deepStrictEqual(g.find((x) => x.quest === 'parts'), { quest: 'parts', count: 2, known: 0, text: '2 buses still need parts history' });
  assert.ok(g.every((x) => Object.keys(x).join() === 'quest,count,known,text'), 'gaps carry no names: counts only');
  assert.strictEqual(FQ.gaps([ps[1]]).find((x) => x.quest === 'papers').text, '1 bus still needs vehicle papers');
});

t('validation: types, unknown fields, the 60+ driver rule', () => {
  assert.match(FQ.validateQuest('nope', {}, TODAY).error, /Unknown quest/);
  assert.match(FQ.validateQuest('papers', { colour: 'red' }, TODAY).error, /Unknown field: colour/);
  assert.match(FQ.validateQuest('papers', { odometerToday: '84,560 km' }, TODAY).error, /Odometer today/);
  assert.match(FQ.validateQuest('papers', { fuel: 'Water' }, TODAY).error, /Fuel/);
  assert.match(FQ.validateQuest('safety', { gpsTrackerFittedAndWorking: 'yes' }, TODAY).error, /safety check/, 'equipment answers come from the safety check, not the form');
  assert.deepStrictEqual(FQ.validateQuest('papers', { chassisNo: ' MAT4 ', make: '' }, TODAY).fields, { chassisNo: 'MAT4' }, 'trimmed; blanks dropped');
  assert.strictEqual(FQ.validateQuest('papers', { make: '=HYPERLINK("x")' }, TODAY).fields.make, 'HYPERLINK("x")', 'text never starts like a formula');
  assert.deepStrictEqual(FQ.validateQuest('parts', { battery: {}, clutch: { notes: ' ' }, coolant: { lastReplacedOn: 'not known' } }, TODAY).fields, { coolant: { lastReplacedOn: 'not known' } }, 'an empty part is dropped, so it never wipes a saved one');
  assert.match(FQ.validateQuest('parts', { brakes: { lastReplacedOn: '2026-01-01' } }, TODAY).error, /Unknown part: brakes/);
  assert.strictEqual(FQ.validateQuest('parts', { battery: { lastReplacedOn: 'not known' } }, TODAY).fields.battery.lastReplacedOn, 'not known');
  assert.match(FQ.validateQuest('parts', { battery: { lastReplacedOn: '2027-01-01' } }, TODAY).error, /future/);
  assert.match(FQ.validateQuest('driver', { dateOfBirth: '2015-01-01' }, TODAY).error, /date of birth/i);
  assert.strictEqual(FQ.ageOn('1966-10-26', TODAY), 59); assert.strictEqual(FQ.ageOn('1966-10-25', TODAY), 60);
  const old = FQ.validateQuest('driver', { dateOfBirth: '1966-10-25' }, TODAY);
  assert.strictEqual(old.ageLimit, true); assert.match(old.warning, /60 or over/);
  assert.strictEqual(FQ.validateQuest('driver', { dateOfBirth: '1966-10-26' }, TODAY).ageLimit, false);
});
t('papers: scanAccepted records which fields were confirmed unchanged from the scans; it never counts towards done', () => {
  const v = FQ.validateQuest('papers', { chassisNo: 'TESTCHASSIS01', make: 'TESTMAKER', scanAccepted: ['chassisNo', 'engineNo', 'odometerToday', 'colour', 7] }, TODAY);
  assert.deepStrictEqual(v.fields, { chassisNo: 'TESTCHASSIS01', make: 'TESTMAKER', scanAccepted: ['chassisNo'] }, 'only scan fields that were saved stay in the list');
  assert.deepStrictEqual(FQ.validateQuest('papers', { make: 'TESTMAKER', scanAccepted: [] }, TODAY).fields, { make: 'TESTMAKER' }, 'an empty list is dropped');
  assert.match(FQ.validateQuest('papers', { scanAccepted: 'chassisNo' }, TODAY).error, /scanAccepted/, 'a list, nothing else');
  assert.match(FQ.validateQuest('fuel', { scanAccepted: [] }, TODAY).error, /Unknown field/, 'only the papers quest has scans');
  const p = { data: { papers: { scanAccepted: ['make', 'modelAndVariant', 'chassisNo', 'engineNo', 'fuel', 'seatingCapacityAsPerRc'] } } };
  assert.strictEqual(FQ.questsFor(p)[0].done, false, 'scan provenance alone never completes the papers quest');
});
// ── Two-level progress (Ruling G1): confirmed (saved, or the run that IS the requirement) and known (a scan value, a fill video:
// suggests the answer, needs confirming). Done and ready never change. SYNTHETIC values only.
const prog = (p, id) => FQ.progressFor(p).find((x) => x.id === id);
t('progress: each quest counts its required items (fields, each part, each run it needs)', () => {
  assert.deepStrictEqual(FQ.progressFor({}).map((x) => x.id + ' ' + x.total + ' ' + x.confirmed + ' ' + x.known),
    ['papers 8 0 0', 'safety 2 0 0', 'parts 20 0 0', 'driver 7 0 0', 'fuel 4 0 0', 'capture 1 0 0']);
  const p = FQ.profilesFromRows(fullRows())[0];
  assert.ok(FQ.progressFor(p).every((x) => x.confirmed === x.total && x.known === 0), 'a ready bus: everything confirmed, nothing left to confirm');
  const noRun = FQ.profilesFromRows(Object.assign(fullRows(), { captured: {}, inspected: {} }))[0];
  FQ.progressFor(noRun).forEach((x) => assert.strictEqual(x.total - x.confirmed, FQ.questsFor(noRun).find((q) => q.id === x.id).missing.length, x.id + ': confirmed matches missingFor exactly'));
  assert.deepStrictEqual([prog(noRun, 'safety').confirmed, prog(noRun, 'capture').confirmed], [1, 0], 'no safety check or timelapse on record: those items are not confirmed');
});
const SCAN = { make: { value: 'Testmake', doc: 'RC' }, chassisNo: { value: 'TESTCHASSIS01', doc: 'RC', disagree: true }, fuel: { value: 'Steam', doc: 'RC' },
  modelAndVariant: { value: '', doc: 'RC' }, dateOfRegistration: { value: '2017-04-05', doc: 'RC' } };
t('progress: scan values count as known, not confirmed', () => {
  const p = { reg: 'TEST01', data: {}, scan: SCAN };
  assert.deepStrictEqual(prog(p, 'papers'), { id: 'papers', total: 8, confirmed: 0, known: 2 },
    'make and chassis no. (even when the scans disagree) are known; a value the form would refuse, a blank one and a field the quest does not require are not');
  assert.strictEqual(FQ.questsFor(p)[0].done, false); assert.strictEqual(FQ.completion(p), 0); assert.strictEqual(FQ.isReady(p), false);
});
t('progress: a saved value moves an item from known to confirmed', () => {
  const p = { reg: 'TEST01', data: { papers: { make: 'Testmake', odometerToday: '84560' } }, scan: SCAN };
  assert.deepStrictEqual(prog(p, 'papers'), { id: 'papers', total: 8, confirmed: 2, known: 1 }, 'make is confirmed now, chassis no. still only known');
});
t('progress: a fill with a video is known for "driver has a smartphone"; nothing else is inferred', () => {
  const fuel = (fills, data) => prog({ reg: 'TEST01', data: { fuel: data || {} }, fills }, 'fuel');
  assert.deepStrictEqual(fuel({ count: 4, withVideo: 3, withVideoAndBill: 3 }), { id: 'fuel', total: 4, confirmed: 0, known: 1 });
  assert.strictEqual(fuel({ count: 4, withVideo: 0, withVideoAndBill: 0 }).known, 0, 'fills without a video say nothing');
  assert.strictEqual(fuel(undefined).known, 0, 'an older backend sends no fills');
  assert.deepStrictEqual(fuel({ count: 1, withVideo: 1, withVideoAndBill: 1 }, { driverHasASmartphoneForTheFillVideo: 'no' }), { id: 'fuel', total: 4, confirmed: 1, known: 0 }, 'a saved answer wins, whatever it says');
  const p = { reg: 'TEST01', data: {}, fills: { count: 9, withVideo: 9, withVideoAndBill: 9 } };
  assert.strictEqual(FQ.questsFor(p).find((q) => q.id === 'fuel').done, false, 'fills never complete the quest');
});
t('progress: profilesFromRows carries the scan, the papers on file and the fills; fleetProgress sums them; gaps say how many have values to confirm', () => {
  const rows = fullRows();
  rows.fleet = [Object.assign({}, fleetRow, { reg: 'TEST01', driverCode: 'E103', scan: SCAN, docs: { current: 5, total: 6, expired: 1 }, fills: { count: 4, withVideo: 3, withVideoAndBill: 3 } }),
    Object.assign({}, fleetRow, { reg: 'TEST02', driverCode: 'E102' }), fleetRow];
  const ps = FQ.profilesFromRows(rows), a = ps.find((p) => p.reg === 'TEST01');
  assert.deepStrictEqual([a.scan.make.value, a.docs, a.fills.withVideo], ['Testmake', { current: 5, total: 6, expired: 1 }, 3]);
  assert.deepStrictEqual(ps.find((p) => p.reg === 'TEST02').scan, {}, 'no scan: an empty object');
  assert.deepStrictEqual(FQ.fleetProgress(ps), { confirmed: 42, known: 3, total: 126 }, 'items over every bus: the ready bus is all confirmed, TEST01 has 2 scan values and a fill video');
  assert.deepStrictEqual(FQ.fleetProgress([]), { confirmed: 0, known: 0, total: 0 });
  const g = FQ.gaps(ps);
  assert.deepStrictEqual(g.map((x) => x.quest + ' ' + x.count + ' ' + x.known), ['papers 2 1', 'safety 2 0', 'parts 2 0', 'driver 2 0', 'fuel 2 1', 'capture 2 0']);
  assert.strictEqual(g[0].text, '2 buses still need vehicle papers', 'the gap text is unchanged');
  assert.strictEqual(FQ.teamBar('LMS 4', ps).text, 'LMS 4 fleet: 1 of 3 buses ready', 'ready counts only confirmed quests');
});
console.log('fleet quests: all checks passed');
