// node tests/game/test-room-setup-js.js -- the room setup page (assets/game/room-setup.js) helpers in a vm, and the page's source rules.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..', '..'), read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(read('assets/game/room-setup.js') + '\nthis.R = LMCSRooms;', ctx);
const R = ctx.R, J = (x) => JSON.parse(JSON.stringify(x));
const TYPES = [{ id: 'classroom' }, { id: 'lab' }, { id: 'office' }, { id: 'library' }, { id: 'staffroom' }, { id: 'activity' }, { id: 'pt' }, { id: 'other' }];

assert.strictEqual(R.cleanName('  Class   7A  '), 'Class 7A');
assert.strictEqual(R.cleanName('x'.repeat(80)).length, 60);
assert.deepStrictEqual(J(R.splitNames('Class 1A, Class 1B,,\n Class 2A ')), ['Class 1A', 'Class 1B', 'Class 2A']);
assert.deepStrictEqual(J(R.splitNames('   ')), []);
const rooms = [{ name: 'Office' }, { name: 'Class 7A' }];
assert.strictEqual(R.clash(rooms, ['office'], -1), 'office', 'case-insensitive');
assert.strictEqual(R.clash(rooms, ['Office'], 0), '', 'renaming a room to itself is not a clash');
assert.strictEqual(R.clash(rooms, ['Lab', 'lab'], -1), 'lab', 'a clash inside the new names');
assert.strictEqual(R.clash(rooms, ['Library'], -1), '');
[['Class 7A', 'classroom'], ['7A', 'classroom'], ['UKG', 'classroom'], ['Physics lab', 'lab'], ['Office', 'office'], ['Library', 'library'], ['Staff room', 'staffroom'],
  ['Music room', 'activity'], ['PT ground', 'pt'], ['Store', 'other']].forEach(([n, t]) => assert.strictEqual(R.guessType(n, TYPES), t, n));
assert.strictEqual(R.guessType('Library', [{ id: 'classroom' }]), 'classroom', 'no "other" type configured: the first type');
assert.strictEqual(R.stepText({ total: 0, allocated: 0 }), 'Step 1 of 2: name your rooms');
assert.strictEqual(R.stepText({ total: 8, allocated: 3 }), '3 of 8 rooms have someone in charge');
assert.strictEqual(R.stepText({ total: 2, allocated: 2, complete: true }), 'All 2 rooms have someone in charge ✓');
assert.strictEqual(R.pct({ total: 0, allocated: 0 }), 0, 'never NaN');
assert.strictEqual(R.pct({ total: 3, allocated: 1 }), 33);
assert.deepStrictEqual(J(R.payload([{ id: 'r1', name: 'A', type: 'lab', staff: 'x@e.org', staffName: 'X' }, { name: 'B', type: 'other' }])),
  [{ id: 'r1', name: 'A', type: 'lab', staff: 'x@e.org' }, { name: 'B', type: 'other', staff: '' }], 'only id, name, type, staff go back; no id for a new room');

// the source: text nodes only, the save posts, 44px targets, a live region, a confirm before removing
const src = read('assets/game/room-setup.js'), css = read('assets/game/room-setup.css'), page = read('principal/rooms.html');
assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(src + page), 'no parsed HTML');
assert.ok(/action: 'roomssave'/.test(src) && /method: 'POST'/.test(src), 'the save posts');
assert.ok(/action=roomsget/.test(src), 'the read is a GET');
assert.ok(/aria-live/.test(src) && /window\.confirm\(/.test(src), 'live region and a confirm before Remove');
assert.ok(/min-height:44px/.test(css), '44px targets');
assert.ok(/a-room-unlock/.test(src) && /a-quest-complete/.test(src) && /v2-animations\.css/.test(page), 'v2 animation classes wired');
assert.ok(/<script src="\.\.\/assets\/game\/room-setup\.js(\?v=[0-9a-f]+)?"><\/script>/.test(page), 'the page loads room-setup.js (stamped or not)');
assert.ok(/Add all ' \+ fromErp\.length/.test(src), 'one tap adds every ERP classroom');
assert.ok(/a-room-tap-pop/.test(src) && /S\.fresh = null; S\.pop = -1/.test(src) && /is-paused/.test(src), 'tap-pop on assign, once-only animations, idle paused when hidden');
console.log('room-setup.js: all checks passed');
