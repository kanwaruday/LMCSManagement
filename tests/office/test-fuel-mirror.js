// office-fuel-mirror.gs: which day-book rows become fuel fills. Standalone: node tests/office/test-fuel-mirror.js (no-op under run.js).
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
if (require.main !== module) { module.exports = () => {}; return; }
let written = null, tabRows = []; // the fake Fuel Fills tab: what officeFuelMirror_ read and wrote
const fakeSheet = { getLastRow: () => tabRows.length, getDataRange: () => ({ getValues: () => tabRows }), clear() {},
  getRange: (r, c, nr, nc) => ({ setNumberFormat() { return this; }, setValues(v) { if (v.some(x => x.length !== nc)) throw new Error('ragged'); written = v; } }) };
const ctx = { String, Number, Object, officeToday_: () => '2026-10-25', officeAddDays_: () => '2026-06-27', officeRecentBooks_: () => [{}], officeRows_: () => rowsNow,
  SpreadsheetApp: { openById: () => ({ getSheetByName: () => fakeSheet }) } };
let rowsNow = [];
vm.createContext(ctx);
for (const f of ['office-files.gs', 'office-fuel-mirror.gs']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../../apps-script', f), 'utf8').replace(/^const /gm, 'var '), ctx);
const row = (id, o) => Object.assign({ id, campus: 'LMS4', entry_date: '2026-10-24', category: 'fuel', vehicle: 'HP665686', litres_ml: 60000, odometer_km: 75500, amount_paise: 570000, reverses: '', file_id: 'b1' }, o);
const out = JSON.parse(JSON.stringify(ctx.officeFuelFills_([
  row('a'), row('b', { entry_date: '2026-10-23' }),
  row('c'), row('c-rev', { reverses: 'c' }),               // reversed: both out
  row('d', { category: 'vehicle_service' }),              // not fuel
  row('e', { entry_date: '2026-05-01' }),                 // older than the window
], '2026-06-26'))); // JSON: arrays from the vm realm
assert.deepStrictEqual(out.map(r => r[0]), ['b', 'a']);
assert.deepStrictEqual(out[1], ['a', 'LMS4', '2026-10-24', 'HP665686', 60, 75500, 5700, '', 'no', 'yes']);
const old = JSON.parse(JSON.stringify(ctx.officeFuelFills_([row('o', { litres_ml: '', odometer_km: '', odometer_note: '' }), row('m', { odometer_note: 'meter replaced' })], '2026-06-26')));
assert.deepStrictEqual(old.map(r => [r[4], r[5], r[7]]), [['', '', ''], [60, 75500, 'meter replaced']], 'blank stays blank; the meter note travels');
console.log('  ok  - fuel mirror rows');

const proof = JSON.parse(JSON.stringify(ctx.officeFuelFills_([row('v', { video_file_id: 'vid1' }), row('w', { file_id: '', video_file_id: '' })], '2026-06-26')));
assert.deepStrictEqual(proof.map(r => [r[0], r[8], r[9]]), [['v', 'yes', 'yes'], ['w', 'no', 'no']], 'mirror marks hasVideo when video_file_id is set, hasBill when file_id is');
const linked = JSON.parse(JSON.stringify(ctx.officeFuelFills_([row('w2', { file_id: '' }), row('x2')], '2026-06-26', { w2: 'at1' })));
assert.deepStrictEqual(linked.map(r => [r[0], r[8]]), [['w2', 'yes'], ['x2', 'no']], 'a video attached after the save (a side record) counts too');
console.log('  ok  - mirror marks hasVideo and hasBill');
// another campus's rows from before the two columns existed are kept, padded, not dropped or written ragged
tabRows = [['id', 'campus', 'date', 'reg', 'litres', 'odometer', 'amount_rs', 'odometer_note'], ['z', 'LMS2', '2026-10-20', 'HP1', '40', '1000', '3800', '']];
rowsNow = [row('a', { video_file_id: 'vid1' })];
ctx.officeFuelMirror_('LMS4');
assert.deepStrictEqual(JSON.parse(JSON.stringify(written)).map(r => r.length), [10, 10, 10]);
assert.deepStrictEqual(JSON.parse(JSON.stringify(written))[0].slice(8), ['hasVideo', 'hasBill']);
assert.deepStrictEqual(JSON.parse(JSON.stringify(written))[1].slice(8), ['', ''], 'an old row of another campus stays unknown until its campus refreshes');
console.log('  ok  - fuel mirror keeps old-width rows of other campuses');
