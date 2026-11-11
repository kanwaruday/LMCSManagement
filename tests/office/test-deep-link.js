// Browser-side ES module test (office/js/deep-link.js). Standalone: node tests/office/test-deep-link.js (no-op under run.js).
'use strict';
const assert = require('assert');
if (require.main !== module) { module.exports = () => {}; return; }
(async () => {
  const { panelFor, goPanel } = await import('../../office/js/deep-link.js');
  let failed = 0;
  const test = (name, fn) => { try { fn(); console.log('  ok  -', name); } catch (e) { failed++; console.log('  FAIL -', name, '\n       ', e.message); } };
  const scrolled = [];
  const doc = { getElementById: (id) => (['today', 'handovers', 'appt-box'].includes(id) ? { scrollIntoView: () => scrolled.push(id) } : null) };
  test('each game door hash names its panel', () => {
    assert.deepStrictEqual(['#today', '#handovers', '#appointments'].map(panelFor), ['today', 'handovers', 'appt-box']);
  });
  test('the panel is scrolled into view', () => { assert.strictEqual(goPanel(doc, '#handovers'), true); assert.deepStrictEqual(scrolled, ['handovers']); });
  test('an empty or unknown hash leaves the home alone', () => {
    for (const h of ['', '#', '#nope', '#erp-dues', undefined]) assert.strictEqual(goPanel(doc, h), false);
    assert.deepStrictEqual(scrolled, ['handovers']);
  });
  process.exit(failed ? 1 : 0);
})();
