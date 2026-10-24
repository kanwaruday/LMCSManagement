// office-fuel-mirror.gs: which day-book rows become fuel fills. Standalone: node tests/office/test-fuel-mirror.js (no-op under run.js).
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
if (require.main !== module) { module.exports = () => {}; return; }
const ctx = { String, Number, Object };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../apps-script/office-fuel-mirror.gs'), 'utf8').replace(/^const /gm, 'var '), ctx);
const row = (id, o) => Object.assign({ id, campus: 'LMS4', entry_date: '2026-10-24', category: 'fuel', vehicle: 'HP665686', litres_ml: 60000, odometer_km: 75500, amount_paise: 570000, reverses: '' }, o);
const out = JSON.parse(JSON.stringify(ctx.officeFuelFills_([
  row('a'), row('b', { entry_date: '2026-10-23' }),
  row('c'), row('c-rev', { reverses: 'c' }),               // reversed: both out
  row('d', { category: 'vehicle_service' }),              // not fuel
  row('e', { entry_date: '2026-05-01' }),                 // older than the window
], '2026-06-26'))); // JSON: arrays from the vm realm
assert.deepStrictEqual(out.map(r => r[0]), ['b', 'a']);
assert.deepStrictEqual(out[1], ['a', 'LMS4', '2026-10-24', 'HP665686', 60, 75500, 5700, '']);
const old = JSON.parse(JSON.stringify(ctx.officeFuelFills_([row('o', { litres_ml: '', odometer_km: '', odometer_note: '' }), row('m', { odometer_note: 'meter replaced' })], '2026-06-26')));
assert.deepStrictEqual(old.map(r => [r[4], r[5], r[7]]), [['', '', ''], [60, 75500, 'meter replaced']], 'blank stays blank; the meter note travels');
console.log('  ok  - fuel mirror rows');
