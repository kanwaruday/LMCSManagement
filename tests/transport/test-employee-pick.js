// assets/employee-pick.js (ES module, so standalone like test-capture-core.js): the order of the driver picker and turning a chosen line back into the person. Made-up people only.
'use strict';
const assert = require('assert');
if (require.main !== module) { module.exports = () => {}; return; }
const path = require('path');
(async () => {
  const { rankStaff, lineOf, findPick } = await import(path.join(__dirname, '../../assets/employee-pick.js'));
  const p = (employeeCode, name, school, role, status) => ({ employeeCode, name, school, role, status });
  const staff = [
    p('E5', 'Asha Teacher', 'LMS4', 'TGT', 'Active'),
    p('E1', 'Ravi Driver', 'LMS2', 'Driver', 'Active'),
    p('E2', 'Mohan Driver', 'LMS4', 'Driver Cum Peon', 'Active'),
    p('E3', 'Gone Driver', 'LMS4', 'Driver', 'Inactive'),
    p('E4', 'Bina Clerk', 'LMS2', 'Clerk', 'Active'),
    p('E6', 'Same Name', 'LMS4', 'Driver', 'Active'),
    p('E7', 'Same Name', 'LMS4', 'Peon', 'Active'),
  ];
  const ranked = rankStaff(staff, { school: 'LMS4' });
  assert.deepStrictEqual(ranked.map((e) => e.employeeCode), ['E2', 'E6', 'E1', 'E5', 'E7', 'E4'],
    'this school\'s drivers, other drivers, this school\'s others, the rest; inactive left out');
  assert.strictEqual(findPick(ranked, lineOf(staff[2])).employeeCode, 'E2', 'a chosen line is that person');
  assert.strictEqual(findPick(ranked, '  mohan   driver ').employeeCode, 'E2', 'the fleet register name finds the one person by it');
  assert.strictEqual(findPick(ranked, 'Same Name'), null, 'two people by one name: no guess');
  assert.strictEqual(findPick(ranked, 'Same Name (E7)').employeeCode, 'E7', 'the line with the code settles it');
  assert.strictEqual(findPick(ranked, 'Pur'), null, 'half a name is no pick');
  assert.strictEqual(findPick(ranked, 'Gone Driver'), null, 'an inactive person cannot be picked');
  console.log('ok    employee-pick: order, picks, same names, inactive');
})().catch((e) => { console.error('FAIL ', e.message); process.exit(1); });
