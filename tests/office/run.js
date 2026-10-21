#!/usr/bin/env node
// Permanent Office backend test suite: `node tests/office/run.js`.
// Runs the real apps-script/office*.gs under node against fakes (harness.js). Fake data only.
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const t = {
  test(name, fn) {
    try { fn(); pass++; console.log('  ok  -', name); } catch (err) { fail++; console.log('  FAIL -', name); console.log('       ', err.message); }
  },
};

// Every tests/office/test-*.js exports run(t); later tasks just add a file.
fs.readdirSync(__dirname).filter((f) => /^test-.+\.js$/.test(f)).sort().forEach((f) => {
  console.log(f + ':');
  require(path.join(__dirname, f))(t);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
