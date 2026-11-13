// apps-script/staff-logins.gs: gameStaffLogins_, lms-game's teacher-rollout lookup. Runs the real .gs (with af-video.gs's key check) in a
// vm against a fake Employee Master. Synthetic codes and emails only (@test.invalid). Usage: node tests/staff-logins/test-staff-logins.js
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '../../apps-script', f), 'utf8');
const KEY = 'k'.repeat(48);
function setup({ master, personal, key = KEY } = {}) {
  const sheets = {
    EmpMaster: master || [['EmployeeCode', 'Name', 'Status'], ['E1', 'A', 'Active'], ['E2', 'B', ''], ['E3', 'C', 'Left'], ['E4', 'D', 'active']],
    EmpPersonal: personal || [['EmployeeCode', 'Aadhaar', 'AuthEmail'], ['E1', '1111', ' E1@Test.Invalid '], ['e2', '2222', 'e2@test.invalid'],
      ['E3', '3333', 'e3@test.invalid'], ['E4', '4444', 'not an email'], ['E9', '9999', 'e9@test.invalid']],
  };
  const ctx = { console, JSON, String, Array, Object, Math, Number, Date, Utilities: { base64EncodeWebSafe: (s) => Buffer.from(String(s)).toString('base64') },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === 'ROSTER_GAME_KEY' ? key : null) }) },
    openWorkbook_: () => ({ getSheetByName: (n) => ({ getDataRange: () => ({ getValues: () => sheets[n] }) }) }) };
  vm.createContext(ctx);
  vm.runInContext(read('af-video.gs'), ctx, { filename: 'af-video.gs' });
  vm.runInContext(read('staff-logins.gs'), ctx, { filename: 'staff-logins.gs' });
  return (b) => JSON.parse(JSON.stringify(ctx.gameStaffLogins_(b)));
}
let n = 0;
const t = (name, fn) => { fn(); console.log('ok ' + ++n + ' - ' + name); };
t('only asked-for, active codes with a valid AuthEmail; lowercased; nothing else returned', () => {
  const r = setup()({ key: KEY, codes: ['e1', 'E2', 'E3', 'E4', 'E5'] });
  assert.deepStrictEqual(r, { success: true, staff: [{ code: 'E1', email: 'e1@test.invalid' }, { code: 'E2', email: 'e2@test.invalid' }] });
  assert.ok(!JSON.stringify(r).includes('1111'), 'no other column leaks');
});
t('a code not asked for is never returned (E9 is in EmpPersonal but not asked)', () => {
  assert.deepStrictEqual(setup()({ key: KEY, codes: ['E1'] }).staff.map((s) => s.code), ['E1']);
});
t('wrong, missing or unset key refused before any sheet is read', () => {
  for (const b of [{ key: 'x'.repeat(48), codes: ['E1'] }, { codes: ['E1'] }, null]) assert.deepStrictEqual(setup()(b), { success: false, error: 'not_authorized' });
  assert.deepStrictEqual(setup({ key: null })({ key: KEY, codes: ['E1'] }), { success: false, error: 'not_authorized' });
});
t('bad codes refused: none, over 500, odd characters', () => {
  const go = setup();
  for (const codes of [[], 'E1', Array(501).fill('E1'), ['E1', 'E 2'], ['E1;DROP']]) assert.deepStrictEqual(go({ key: KEY, codes }), { success: false, error: 'bad_input' });
});
t('a sheet without the columns answers sheet_shape', () => {
  assert.deepStrictEqual(setup({ personal: [['EmployeeCode', 'Email'], ['E1', 'e1@test.invalid']] })({ key: KEY, codes: ['E1'] }), { success: false, error: 'sheet_shape' });
});
console.log('staff-logins: all ' + n + ' passed (synthetic)');
