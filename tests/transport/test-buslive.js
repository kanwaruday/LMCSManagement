// coordinator-transport.gs live GPS: vendor time format, row parsing, roster join and campus scoping, missing-config error.
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
let props = { TRANSPORT_PUSH_SECRET: "S" }, fetched = 0;
const rows = [
  { VehicleName: 'HP665686', Latitude: '31.61194', Longitude: '76.918755', Speed: 31, DateTime: '23-Oct-2026 05:38:58 PM', ProgressStatus: 'Running', LocationWithoutLink: 'Ner  Chowk', Distance: 12.5, BBID: 'I1' },
  { VehicleName: 'HP34B6083', Latitude: '31.86', Longitude: '77.15', Speed: 0, DateTime: '24-Oct-2026 12:05:00 AM', ProgressStatus: 'Stop', BBID: 'I2' },
  { VehicleName: 'HP999', Latitude: '31.9', Longitude: '77.2', Speed: 0, DateTime: 'bad', ProgressStatus: 'Unreachable' }, // not on the roster
  { VehicleName: 'HP000', Latitude: '0', Longitude: '0' }, // no fix: dropped
];
const ctx = { console, Date, Object, String, Math, JSON, Array, Number, isFinite, parseFloat,
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
  CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
  UrlFetchApp: { fetch: u => { fetched++; assert.ok(u.indexOf('custid=37381') !== -1 && u.indexOf('mDataProp_15=15') !== -1); return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ aaData: rows }) }; } } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../apps-script/coordinator-transport.gs'), 'utf8').replace(/^const /gm, 'var '), ctx);
// stubs go in after the real file so they replace its fleet reader
vm.runInContext('function coordVisibleCampuses_(c){return c.only||null} function coordTransportFleet_(){return {fleet:[' +
  '{reg:"HP665686",campus:"LMS 4",campusId:"LMS4",route:"Ner Chowk",driver:"Ram",operational:true},{reg:"HP34B6083",campus:"LMS 2",campusId:"LMS2",route:"R2",driver:"Shyam",operational:true}]}}', ctx);
const run = c => vm.runInContext(c, ctx);

assert.strictEqual(run('coordBusTime_("23-Oct-2026 05:38:58 PM")'), '2026-10-23T17:38:58+05:30');
assert.strictEqual(run('coordBusTime_("24-Oct-2026 12:05:00 AM")'), '2026-10-24T00:05:00+05:30');
assert.strictEqual(run('coordBusTime_("24-Oct-2026 12:05:00 PM")'), '2026-10-24T12:05:00+05:30');
assert.strictEqual(run('coordBusTime_("bad")'), '');

assert.throws(() => run('coordBusLive_({})'), /not set up/);
assert.deepStrictEqual(run('coordBusConfig_({secret:"x",custid:"37381"})').success, false);
assert.deepStrictEqual(run('coordBusConfig_({secret:"S",custid:"37381;drop"})').success, false);
assert.deepStrictEqual(run('coordBusConfig_({secret:"S",custid:"37381"})').success, true);

const all = run('coordBusLive_({})');
assert.strictEqual(all.buses.length, 3);
const b = all.buses.find(x => x.reg === 'HP665686');
assert.deepStrictEqual([b.campusId, b.route, b.driver, b.speed, b.place, b.kmToday], ['LMS4', 'Ner Chowk', 'Ram', 31, 'Ner Chowk', 12.5]);
assert.strictEqual(all.buses.find(x => x.reg === 'HP999').operational, null);
const clerk = run('coordBusLive_({only:["LMS2"]})');
assert.deepStrictEqual(clerk.buses.map(x => x.reg), ['HP34B6083']); // own campus only; off-roster bus hidden
console.log('ok buslive');
