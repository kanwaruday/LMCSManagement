// Browser-side ES module test (office/js). Standalone: node tests/office/test-format.js. run.js requires every
// test-*.js synchronously for the backend suite, so under require() this file exports a no-op.
'use strict';
const assert = require('assert');
if (require.main !== module) { module.exports = () => {}; return; }
let failed = 0;
const test = async (name, fn) => { try { await fn(); console.log('  ok  -', name); } catch (e) { failed++; console.log('  FAIL -', name, '\n       ', e.message); } };
const done = () => process.exit(failed ? 1 : 0);

(async () => {
  const { formatInr, parseRupeesToPaise: p, isoToDmy, dmyToIso } = await import('../../office/js/format.js');
  await test('formatInr uses Indian grouping', () => {
    assert.strictEqual(formatInr(12345650), '₹1,23,456.50');
    assert.strictEqual(formatInr(0), '₹0.00');
    assert.strictEqual(formatInr(99999), '₹999.99');
    assert.strictEqual(formatInr(100000), '₹1,000.00');
    assert.strictEqual(formatInr(1000000000), '₹1,00,00,000.00');
    assert.strictEqual(formatInr(-5), '-₹0.05');
  });
  await test('parseRupeesToPaise accepts good input exactly', () => {
    assert.strictEqual(p('0.1'), 10);
    assert.strictEqual(p('1,234.50'), 123450);
    assert.strictEqual(p('₹ 1,23,456.5'), 12345650);
    assert.strictEqual(p(' 250 '), 25000);
    assert.strictEqual(p('0.29'), 29);
    assert.strictEqual(p('1,234,567'), 123456700);
    assert.strictEqual(p('12,34,567'), 123456700);
  });
  await test('parseRupeesToPaise rejects zero, negatives, >2 decimals, junk', () => {
    for (const bad of ['0', '0.00', '-5', '1.234', '', 'abc', '1,2,3', '12,50', '1,00', '1,2345', '12,34,56', '1e3', '.5', '1.'])
      assert.strictEqual(p(bad), null, bad);
  });
  await test('date conversion', () => {
    assert.strictEqual(isoToDmy('2026-10-21'), '21/10/2026');
    assert.strictEqual(dmyToIso('21/10/2026'), '2026-10-21');
  });
  done();
})();
