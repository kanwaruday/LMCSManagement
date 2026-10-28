// driver/driver-logic.js: the driver portal's fuel-fill checks and its mission cards. Plain asserts, one line per named check.
const path = require('path'), assert = require('assert');
const DL = require(path.join(__dirname, '../../driver/driver-logic.js'));
const t = (name, fn) => { fn(); console.log('ok  ' + name); };
const full = { litres: '42.5', amount: '4000', odometer: '58210', bill: 'blob1', video: 'blob2' };

t('an empty form: all five missing, not ready, "Send · 5 left"', () => {
  const c = DL.checkFill({}, null);
  assert.deepStrictEqual(c.missing, ['litres', 'amount', 'odometer', 'bill', 'video']);
  assert.strictEqual(c.ready, false);
  assert.strictEqual(DL.sendLabel(c), 'Send · 5 left');
});
t('a full form is ready and says Send', () => {
  const c = DL.checkFill(full, 58000);
  assert.strictEqual(c.ready, true); assert.strictEqual(DL.sendLabel(c), 'Send'); assert.strictEqual(c.warn, '');
});
t('commas and spaces in numbers are fine', () => assert.strictEqual(DL.checkFill(Object.assign({}, full, { odometer: ' 58,210 ', amount: '4,000' }), null).ready, true));
t('amount and odometer must be whole numbers', () => {
  const c = DL.checkFill(Object.assign({}, full, { amount: '4000.5', odometer: '5.5' }), null);
  assert.strictEqual(c.errors.amount, 'Whole number'); assert.strictEqual(c.errors.odometer, 'Whole number'); assert.strictEqual(DL.sendLabel(c), 'Send · 2 left');
});
t('a number that is not a number says so, it is not "missing"', () => { const c = DL.checkFill(Object.assign({}, full, { litres: '42.542.5' }), null); assert.strictEqual(c.errors.litres, 'Check the number'); assert.ok(!c.missing.includes('litres')); });
t('litres out of range', () => assert.ok(DL.checkFill(Object.assign({}, full, { litres: '0' }), null).errors.litres));
t('odometer below the last fill is refused', () => assert.match(DL.checkFill(full, 60000).errors.odometer, /Less than last time \(60000\)/));
t('odometer more than 5000 km past the last fill is refused', () => assert.match(DL.checkFill(full, 50000).errors.odometer, /Too far/));
t('no last odometer: any sane reading passes', () => assert.strictEqual(DL.checkFill(full, null).errors.odometer, undefined));
t('an odd rate warns but does not block', () => {
  const c = DL.checkFill(Object.assign({}, full, { amount: '400' }), null);
  assert.match(c.warn, /₹9 a litre/); assert.strictEqual(c.ready, true);
});
t('route unfinished: route first and red, fuel quiet', () => {
  const m = DL.missions({ reg: 'X', runsNeeded: 2, runsDone: 1, lastFill: '2026-10-21' });
  assert.deepStrictEqual(m.map((x) => x.id), ['route', 'fuel']);
  assert.strictEqual(m[0].primary, true); assert.strictEqual(m[1].primary, false);
  assert.strictEqual(m[0].status, '1 of 2 runs done'); assert.strictEqual(m[0].action, 'Record the next run'); assert.strictEqual(m[0].progress, 0.5);
  assert.strictEqual(m[1].status, 'Last fill: 21 Oct');
});
t('route done: fuel first and red, route shows done with no button', () => {
  const m = DL.missions({ reg: 'X', runsNeeded: 2, runsDone: 3, lastFill: null });
  assert.deepStrictEqual(m.map((x) => x.id), ['fuel', 'route']);
  assert.strictEqual(m[0].primary, true); assert.strictEqual(m[1].done, true); assert.strictEqual(m[1].action, ''); assert.strictEqual(m[1].progress, 1);
  assert.strictEqual(m[0].status, 'No fill logged yet');
});
t('no runs planned: route is not done and has no button; fuel is the red one', () => {
  const m = DL.missions({ reg: 'X', runsNeeded: 0, runsDone: 0, lastFill: null });
  const r = m.find((x) => x.id === 'route');
  assert.strictEqual(r.done, false); assert.strictEqual(r.action, ''); assert.strictEqual(m[0].id, 'fuel');
});
t('exactly one red button, always', () => [[2, 0], [2, 2], [0, 0], [1, 1]].forEach(([n, d]) =>
  assert.strictEqual(DL.missions({ runsNeeded: n, runsDone: d }).filter((x) => x.primary).length, 1)));
t('scientific or hex notation is not a number', () => ['1e2', '0x10', '-5', '4 2'].forEach((v) => assert.strictEqual(DL.checkFill(Object.assign({}, full, { litres: v }), null).errors.litres, 'Check the number', v)));
t('a bad date is shown as it came, never "undefined"', () => assert.strictEqual(DL.missions({ runsNeeded: 0, lastFill: '2026-13-01' })[0].status, 'Last fill: 2026-13-01'));
t('fuel steps: the pump order, every field once', () => assert.deepStrictEqual(DL.FUEL_STEPS.map((x) => x.id).sort(), DL.FUEL_FIELDS.map((f) => f.id).sort()) || assert.deepStrictEqual(DL.FUEL_STEPS.map((x) => x.id), ['video', 'bill', 'litres', 'amount', 'odometer']));
t('a step says what is wrong only for itself', () => {
  assert.strictEqual(DL.stepError('litres', { litres: '42.5' }, null), '');
  assert.match(DL.stepError('amount', { litres: '42.5' }, null), /Type the number/);
  assert.match(DL.stepError('odometer', { odometer: '100' }, 58000), /Less than last time/);
  assert.match(DL.stepError('video', {}, null), /Take the video/);
  assert.strictEqual(DL.stepError('bill', { bill: {} }, null), '');
});
