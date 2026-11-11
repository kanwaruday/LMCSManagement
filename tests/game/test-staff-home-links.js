// node tests/game/test-staff-home-links.js -- the game's doors open one staff-home spot each (staff-home/roles.js hashSource; Uday, 11 Nov).
const assert = require('assert'), path = require('path');
const S = require(path.join(__dirname, '..', '..', 'staff-home/roles.js'));
for (const role of ['itTeacher', 'pti', 'nonTeaching']) {
  for (const k of ['today', 'rules', 'routes', 'requests']) assert.strictEqual(S.hashSource('#' + k, role), k, role + ' #' + k);
  assert.strictEqual(S.hashSource('#world', role), 'routes', role + ' #world is the routes view');
  for (const h of ['', '#', '#nope', '#toString', undefined]) assert.strictEqual(S.hashSource(h, role), null, role + ' ' + h + ' opens nothing');
}
assert.strictEqual(S.hashSource('#lab', 'itTeacher'), 'lab', "a role's own spot");
assert.strictEqual(S.hashSource('#lab', 'pti'), null, "another role's spot is not this home's");
assert.strictEqual(S.hashSource('#today', 'nobody'), null);
console.log('staff home deep links ok');
