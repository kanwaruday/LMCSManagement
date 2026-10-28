// node tests/game/test-event-js.js -- the event card (assets/game/event.js) helpers in a vm, the Kingdom's Game Day lines, and the page hooks.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..', '..'), read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(read('assets/game/event.js') + '\nthis.E = LMCSEvent;', ctx);
const E = ctx.E;
assert.strictEqual(E.gameDay(new Date('2026-10-29T22:29:00Z')), '2026-10-29', 'before 04:00 IST: still the day before');
assert.strictEqual(E.gameDay(new Date('2026-10-29T22:30:00Z')), '2026-10-30');
assert.strictEqual(E.safeHref('office/daybook.html', '../'), '../office/daybook.html');
['javascript:alert(1)', '//evil.example', '/abs', 'https://x.example', '', 'a\\b', 'a\nb'].forEach((g) => assert.strictEqual(E.safeHref(g, '../'), null, g));
assert.strictEqual(E.progressText({ done: 2, total: 5 }), '2 of 5 done');
assert.strictEqual(E.networkText({ schoolsAtGoal: 4, of: 6, goalPct: 80, reward: '🎁 HQ unlocks a reward' }), '4 of 6 schools at 80% → 🎁 HQ unlocks a reward');
assert.strictEqual(E.schoolText({ pct: 28 }), 'Your school: 28% finished');
assert.strictEqual(E.levelText({ level: 1 }), '🎉 Level 1 of 5');
assert.strictEqual(E.teachersText({ n: 1, of: 1 }), '1 of 1 teacher in');
assert.strictEqual(E.teachersText({ n: 6, of: 14 }), '6 of 14 teachers in');
assert.ok(E.driverDays.indexOf('2026-10-30') !== -1, 'the driver line shows on the Game Day');
assert.strictEqual(E.driverLine, '🎉 आज का दिन: ✅ QR स्कैन ✅ होम खुला');
// the driver days follow the Game Config default (game.gs): an event date the driver page doesn't know is a miss
const gs = read('apps-script/game.gs'), dates = [...gs.slice(gs.indexOf('events: [{')).matchAll(/date: '(\d{4}-\d\d-\d\d)'/g)].map((m) => m[1]);
dates.forEach((d) => assert.ok(E.driverDays.indexOf(d) !== -1, 'driver days include ' + d));

// the source: text nodes only, the tick is a POST, never innerHTML
const src = read('assets/game/event.js');
assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(src), 'no parsed HTML');
assert.ok(/action: 'gameeventtick'/.test(src) && /method: 'POST'/.test(src), 'the tick posts');
assert.ok(/aria-live/.test(src) && /min-height:44px/.test(src), 'live region and 44px targets');

// pages: one script line each (with the roles of that home), and a next-step slot
[['principal/index.html', 'Principal'], ['coordinator/index.html', 'Coordinator'], ['office/index.html', 'FeeClerk'], ['teacher/index.html', 'Teacher,Staff']].forEach(([p, roles]) => {
  const html = read(p);
  assert.strictEqual((html.match(/assets\/game\/event\.js/g) || []).length, 1, p + ': one event.js line');
  assert.ok(new RegExp('event\\.js\\?v=[0-9a-f]{8}" data-roles="' + roles + '"').test(html), p + ': stamped, data-roles ' + roles);
  assert.ok(/class="gb-next-slot"/.test(html), p + ': a next-step slot');
});
assert.ok(/event\.js\?v=[0-9a-f]{8}" data-mode="driver"/.test(read('driver/index.html')), 'driver page: driver mode');

// the Kingdom's Game Day lines
const kctx = { window: {}, LMCSGame: { safeHref: (g) => g }, console };
vm.createContext(kctx);
vm.runInContext(read('assets/game/kingdom.js'), kctx);
const K = kctx.window.LMCSKingdom;
assert.strictEqual(K.gdSchoolLine({ name: 'LMS 4', in: 3, people: 7, done: 2, pct: 28 }), 'LMS 4: 3 of 7 in · 2 done · 28%');
assert.strictEqual(K.gdNetworkText({ schoolsAtGoal: 1, of: 6, goalPct: 80, reward: '' }), '1 of 6 schools at 80%');
assert.strictEqual(K.gdNetworkText(null), '');
assert.ok(/action=gameeventboard/.test(read('assets/game/kingdom.js')), 'the Kingdom reads the board');
console.log('event card: ok');
