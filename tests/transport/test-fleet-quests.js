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
  assert.deepStrictEqual(cfg.workshopCols, fx.Workshops.map(camel), 'the Workshops tab keeps the questionnaire columns');
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
  assert.ok(d.config.every((r) => Object.keys(r).join() === 'Key,Value' && typeof r.Value === 'string'), 'Game Config rows: Key, Value (JSON text)');
  assert.strictEqual(FQ.questConfig().loadCapFactor, 1.4);
  assert.strictEqual(FQ.questConfig().driverAgeLimit, 60);
  assert.deepStrictEqual(JSON.parse(d.quests[0].StepsJson).map((s) => s.id), ['papers', 'safety', 'parts', 'driver', 'fuel', 'capture']);
  const over = FQ.questConfig({ config: [{ Key: 'transport.driverAgeLimit', Value: '62' }, { Key: 'transport.loadCapFactor', Value: 'not json' }] });
  assert.deepStrictEqual([over.driverAgeLimit, over.loadCapFactor], [62, 1.4], 'an override row wins; bad JSON falls back to the default');
  const src = fs.readFileSync(FILE, 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(!/\b(window|document|localStorage|fetch|navigator|SpreadsheetApp|Date\.now|new Date\(\))\b|=>|\b(let|const|class)\s+[A-Za-z_$]|`/.test(src), 'plain ES5, no I/O, no clock: copies into a .gs file unchanged');
});

t('missions: one per unfinished quest, in the contract shape', () => {
  const rows = fullRows();
  rows.fleet.push({ reg: 'HP2', campus: 'LMS 5', campusId: 'LMS5', route: '', driver: '', driverCode: '', operational: true },
    { reg: 'HP3', campus: 'LMS 5', campusId: 'LMS5', operational: false });
  const ms = FQ.transportMissions(rows);
  assert.strictEqual(ms.length, 6, 'the ready bus has none, the empty bus six, a bus off the road none');
  const m = ms.find((x) => x.kind === 'setup_papers');
  assert.deepStrictEqual(Object.keys(m), ['id', 'module', 'kind', 'title', 'why', 'owner', 'role', 'campus', 'go', 'due', 'source', 'done']);
  assert.strictEqual(m.id, 'transport:setup_papers:HP2');
  assert.strictEqual(m.module, 'transport'); assert.strictEqual(m.campus, 'LMS5'); assert.strictEqual(m.role, 'FeeClerk');
  assert.strictEqual(m.due, null); assert.strictEqual(m.done, false);
  assert.strictEqual(m.go, 'coordinator/transport/setup.html?reg=HP2&quest=papers');
  assert.match(m.why, /^Still needs /);
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
  assert.deepStrictEqual(g.find((x) => x.quest === 'parts'), { quest: 'parts', count: 2, text: '2 buses still need parts history' });
  assert.ok(g.every((x) => Object.keys(x).join() === 'quest,count,text'), 'gaps carry no names');
  assert.strictEqual(FQ.gaps([ps[1]]).find((x) => x.quest === 'papers').text, '1 bus still needs vehicle papers');
});

t('validation: types, unknown fields, the 60+ driver rule', () => {
  assert.match(FQ.validateQuest('nope', {}, TODAY).error, /Unknown quest/);
  assert.match(FQ.validateQuest('papers', { colour: 'red' }, TODAY).error, /Unknown field: colour/);
  assert.match(FQ.validateQuest('papers', { odometerToday: '84,560 km' }, TODAY).error, /Odometer today/);
  assert.match(FQ.validateQuest('papers', { fuel: 'Water' }, TODAY).error, /Fuel/);
  assert.match(FQ.validateQuest('safety', { gpsTrackerFittedAndWorking: 'yes' }, TODAY).error, /safety check/, 'equipment answers come from the safety check, not the form');
  assert.deepStrictEqual(FQ.validateQuest('papers', { chassisNo: ' MAT4 ', make: '' }, TODAY).fields, { chassisNo: 'MAT4' }, 'trimmed; blanks dropped');
  assert.match(FQ.validateQuest('parts', { brakes: { lastReplacedOn: '2026-01-01' } }, TODAY).error, /Unknown part: brakes/);
  assert.strictEqual(FQ.validateQuest('parts', { battery: { lastReplacedOn: 'not known' } }, TODAY).fields.battery.lastReplacedOn, 'not known');
  assert.match(FQ.validateQuest('parts', { battery: { lastReplacedOn: '2027-01-01' } }, TODAY).error, /future/);
  assert.match(FQ.validateQuest('driver', { dateOfBirth: '2015-01-01' }, TODAY).error, /date of birth/i);
  assert.strictEqual(FQ.ageOn('1966-10-26', TODAY), 59); assert.strictEqual(FQ.ageOn('1966-10-25', TODAY), 60);
  const old = FQ.validateQuest('driver', { dateOfBirth: '1966-10-25' }, TODAY);
  assert.strictEqual(old.ageLimit, true); assert.match(old.warning, /60 or over/);
  assert.strictEqual(FQ.validateQuest('driver', { dateOfBirth: '1966-10-26' }, TODAY).ageLimit, false);
});
console.log('fleet quests: all checks passed');
