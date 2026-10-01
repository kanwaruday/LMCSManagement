#!/usr/bin/env node
// Permanent payroll test suite. One command: `node tests/payroll/run.js`.
// Runs the real apps-script/payroll.gs + payroll-calc.gs under node against a
// fake org (fixtures.js) -- no real staff data, safe in this public repo.
'use strict';
const path = require('path');

let pass = 0, fail = 0;
const t = {
  test(name, fn) {
    try {
      fn();
      pass++;
      console.log('  ok  -', name);
    } catch (err) {
      fail++;
      console.log('  FAIL -', name);
      console.log('       ', err.message);
    }
  },
};

console.log('payroll-calc self-tests:');
const calc = require(path.join('..', '..', 'apps-script', 'payroll-calc.gs'));
t.test('payrollCalcSelfTest_', () => { const r = calc.payrollCalcSelfTest_(); if (!/passed/.test(r)) throw new Error(r); });
t.test('payLeaveSelfTest_', () => { const r = calc.payLeaveSelfTest_(); if (!/passed/.test(r)) throw new Error(r); });

console.log('backend flow tests:');
require('./test-flows')(t);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
