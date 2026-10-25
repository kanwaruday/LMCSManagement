// Pure helpers in assets/game/game.js (outfit calendar, Buddy lines, days line), loaded in a vm with a minimal window.
// Usage: node tests/game/test-game-js.js
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '../../assets/game/game.js'), 'utf8');
const ctx = { console };
ctx.window = ctx;
vm.createContext(ctx); vm.runInContext(src, ctx);
const G = ctx.LMCSGame;

const cfg = {
  trackSuitDays: { LMS4: ['Mon', 'Wed', 'Fri'] },
  uniform: { summerFrom: '2027-05-03', winterFrom: '2026-10-26', festivals: ['2026-11-08'] },
};
const ist = (s) => new Date(s + '+05:30');

// outfit: LMS4 track-suit days Mon/Wed/Fri
assert.strictEqual(G.outfit(ist('2026-11-02T10:00:00'), 'LMS4', cfg), 'tracksuit-winter'); // Mon
assert.strictEqual(G.outfit(ist('2026-11-03T10:00:00'), 'LMS4', cfg), 'winter-formal');    // Tue
assert.strictEqual(G.outfit(ist('2027-05-10T10:00:00'), 'LMS1', cfg), 'summer-formal');    // Mon, campus with no track-suit days
assert.strictEqual(G.outfit(ist('2027-05-10T10:00:00'), 'LMS4', cfg), 'tracksuit-summer'); // same Monday at LMS4
assert.strictEqual(G.outfit(ist('2026-11-08T10:00:00'), 'LMS4', cfg), 'festival');         // festival beats everything (Sunday)
assert.strictEqual(G.outfit(ist('2026-11-08T10:00:00'), 'LMS1', cfg), 'festival');
// Sunday is never a track-suit day, even if listed
assert.strictEqual(G.outfit(ist('2026-11-01T10:00:00'), 'LMS4', { trackSuitDays: { LMS4: ['Sun'] }, uniform: cfg.uniform }), 'winter-formal');
// R4: latest switch <= today wins; neither passed -> winter
assert.strictEqual(G.outfit(ist('2026-10-20T10:00:00'), 'LMS1', cfg), 'winter-formal');
assert.strictEqual(G.outfit(ist('2026-06-01T10:00:00'), 'LMS1', { trackSuitDays: {}, uniform: { summerFrom: '2026-05-03', winterFrom: '2025-10-26', festivals: [] } }), 'summer-formal');
assert.strictEqual(G.outfit(ist('2026-12-01T10:00:00'), 'LMS1', { trackSuitDays: {}, uniform: { summerFrom: '2026-05-03', winterFrom: '2026-10-26' } }), 'winter-formal');
// the date is read in IST: 23:30 UTC on Mon 2 Nov is already Tue 3 Nov in IST
assert.strictEqual(G.outfit(new Date('2026-11-02T23:30:00Z'), 'LMS4', cfg), 'winter-formal');
// missing config never throws
assert.strictEqual(G.outfit(ist('2026-11-03T10:00:00'), 'LMS4', {}), 'winter-formal');

// greeting
const mission = (t) => ({ id: t, title: t });
assert.strictEqual(G.greetingLine({ missions: [] }, { name: 'Meena Sharma' }, ist('2026-11-03T09:00:00')),
  'Good morning, Meena. Nothing is waiting today. Enjoy the calm.');
assert.strictEqual(G.greetingLine({ missions: [mission('Approve the leave'), mission('B')] }, { name: 'Meena Sharma' }, ist('2026-11-03T09:00:00')),
  'Good morning, Meena. 2 things are waiting today. The first is Approve the leave.');
assert.strictEqual(G.greetingLine({ missions: [mission('Approve the leave')] }, { name: 'Meena' }, ist('2026-11-03T09:00:00')),
  'Good morning, Meena. 1 thing is waiting today. The first is Approve the leave.');
assert.ok(/^Good afternoon, /.test(G.greetingLine({ missions: [] }, { name: 'A' }, ist('2026-11-03T12:00:00'))));
assert.ok(/^Good morning, /.test(G.greetingLine({ missions: [] }, { name: 'A' }, ist('2026-11-03T11:59:00'))));
assert.ok(/^Good evening, /.test(G.greetingLine({ missions: [] }, { name: 'A' }, ist('2026-11-03T17:00:00'))));
assert.ok(/^Good afternoon, /.test(G.greetingLine({ missions: [] }, { name: 'A' }, ist('2026-11-03T16:59:00'))));
// hour is IST regardless of the browser zone: 07:00 UTC = 12:30 IST
assert.ok(/^Good afternoon, /.test(G.greetingLine({ missions: [] }, { name: 'A' }, new Date('2026-11-03T07:00:00Z'))));
// no name: still a clean greeting
assert.strictEqual(G.greetingLine({ missions: [] }, {}, ist('2026-11-03T09:00:00')), 'Good morning. Nothing is waiting today. Enjoy the calm.');

// days line
assert.ok(G.daysLine({ onTrack: 18, counted: 21 }).includes('18 of 21'));
assert.strictEqual(G.daysLine({ counted: 0 }), '');
assert.strictEqual(G.daysLine(null), '');
assert.strictEqual(G.daysLine({ onTrack: 18, counted: 21, showDenominator: false }), '18 days on track this month');
assert.strictEqual(G.daysLine({ onTrack: 18, counted: 21, lastMonthOnTrack: 20, lastMonthCounted: 22 }),
  '18 of 21 days on track this month. Last month: 20 of 22.');
assert.strictEqual(G.daysLine({ onTrack: 18, counted: 21, lastMonthOnTrack: 20, lastMonthCounted: 22, showDenominator: false }),
  '18 days on track this month. Last month: 20.');
assert.strictEqual(G.daysLine({ onTrack: 18, counted: 21, lastMonthCounted: 0 }), '18 of 21 days on track this month');

// R28: greeting never says "The first is ." for an untitled mission, never ends in ".."
assert.strictEqual(G.greetingLine({ missions: [{ id: 'x', title: '' }] }, { name: 'Meena' }, ist('2026-11-03T09:00:00')),
  'Good morning, Meena. 1 thing is waiting today.');
assert.strictEqual(G.greetingLine({ missions: [{ id: 'x' }, mission('B')] }, { name: 'Meena' }, ist('2026-11-03T09:00:00')),
  'Good morning, Meena. 2 things are waiting today.');
assert.strictEqual(G.greetingLine({ missions: [mission('Reply to the parent.')] }, { name: 'Meena' }, ist('2026-11-03T09:00:00')),
  'Good morning, Meena. 1 thing is waiting today. The first is Reply to the parent.');
assert.ok(!/\.\./.test(G.greetingLine({ missions: [mission('A.')] }, {}, ist('2026-11-03T09:00:00'))));
// R28: daysLine uses (onTrack || 0)
assert.strictEqual(G.daysLine({ counted: 3 }), '0 of 3 days on track this month');
assert.strictEqual(G.daysLine({ onTrack: 2, counted: 3, lastMonthCounted: 20 }), '2 of 3 days on track this month. Last month: 0 of 20.');

// joinList: the decision card's "Mon, Wed and Fri"
assert.strictEqual(G.joinList([]), '');
assert.strictEqual(G.joinList(undefined), '');
assert.strictEqual(G.joinList(['Mon']), 'Mon');
assert.strictEqual(G.joinList(['Mon', 'Wed']), 'Mon and Wed');
assert.strictEqual(G.joinList(['Mon', 'Wed', 'Fri']), 'Mon, Wed and Fri');

// dateLabel
assert.strictEqual(G.dateLabel('2026-11-08'), 'Sun 8 Nov');
assert.strictEqual(G.dateLabel('Sat 8 Nov'), 'Sat 8 Nov');
assert.strictEqual(G.dateLabel(null), '');

// safeHref: root-relative portal paths get the root; only http(s) schemes pass; protocol-relative never
assert.strictEqual(G.safeHref('principal/issues.html', '../'), '../principal/issues.html');
assert.strictEqual(G.safeHref('principal/issues.html'), 'principal/issues.html');
assert.strictEqual(G.safeHref('/LMCSManagement/x.html', '../'), '/LMCSManagement/x.html');
assert.strictEqual(G.safeHref('https://example.org/a', '../'), 'https://example.org/a');
assert.strictEqual(G.safeHref('javascript:alert(1)'), null);
assert.strictEqual(G.safeHref(' JavaScript:alert(1)'), null);
assert.strictEqual(G.safeHref('data:text/html,x'), null);
assert.strictEqual(G.safeHref('//evil.example/x'), null);
assert.strictEqual(G.safeHref('\\\\evil.example/x'), null);
assert.strictEqual(G.safeHref(''), null);
assert.strictEqual(G.safeHref(undefined), null);

// sourceLabel
assert.strictEqual(G.sourceLabel('principals-daily-reporting/index.html'), 'Daily Reporting');
assert.strictEqual(G.sourceLabel('coordinator/followups/index.html'), 'Follow-ups');
assert.strictEqual(G.sourceLabel('elsewhere.html'), '');

// art: speaker, outfit and pose
const mon = ist('2026-11-02T10:00:00');
const tday = (x) => Object.assign({ speaker: 'buddy', campus: 'LMS4', config: cfg, missions: [{ id: 'a', done: false }], sourcesDown: [] }, x);
assert.deepStrictEqual(JSON.parse(JSON.stringify(G.art(tday({}), mon))),
  { name: 'Buddy', figure: 'buddy/tracksuit-winter-neutral.webp', avatar: 'buddy/avatar-tracksuit-winter.webp' });
assert.strictEqual(G.art(tday({ missions: [{ id: 'a', done: true }, { id: 'b', gone: true }] }), mon).figure, 'buddy/tracksuit-winter-celebrate.webp');
assert.strictEqual(G.art(tday({ missions: [] }), mon).figure, 'buddy/tracksuit-winter-neutral.webp'); // nothing pending is not "all done"
assert.strictEqual(G.art(tday({ sourcesDown: ['ssdashboard'], missions: [{ id: 'a', done: true }] }), mon).figure, 'buddy/tracksuit-winter-bad.webp');
assert.strictEqual(G.art(tday({ speaker: 'teacher-owl' }), mon, true).figure, 'teacher-owl/teacher-owl-intro.webp');
assert.strictEqual(G.art(tday({ speaker: 'teacher-owl' }), mon, false).figure, 'teacher-owl/teacher-owl-neutral.webp');
assert.strictEqual(G.art(tday({ speaker: 'teacher-owl' }), mon).name, 'Teacher Owl');
assert.strictEqual(G.art(tday({ speaker: 'teacher-owl' }), mon).avatar, 'teacher-owl/avatar-teacher-owl.webp');
assert.strictEqual(G.art(tday({}), mon, true).figure, 'buddy/tracksuit-winter-neutral.webp'); // intro is the Teacher Owl's only
// every path art() can return exists in assets/game
const artDir = path.join(__dirname, '../../assets/game');
['buddy', 'teacher-owl'].forEach((sp) => ['neutral', 'celebrate', 'bad'].forEach((pose) => ['winter-formal', 'summer-formal', 'tracksuit-winter', 'tracksuit-summer', 'festival'].forEach((o) => {
  const a = G.art({ speaker: sp, campus: 'LMS4', missions: [], sourcesDown: pose === 'bad' ? ['x'] : [] }, mon);
  assert.ok(fs.existsSync(path.join(artDir, a.figure)), a.figure);
  assert.ok(fs.existsSync(path.join(artDir, a.avatar)), a.avatar);
  void o;
})));

// R28 structurally: game.js never parses HTML -- every text goes in as a text node or an attribute
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|createContextualFragment|DOMParser/.test(src), 'game.js must not build HTML from strings');
// mount with no backendUrl renders nothing and touches nothing else
let cleared = 0;
G.mount({ set textContent(v) { cleared++; } }, { session: {}, backendUrl: '' });
assert.strictEqual(cleared, 1);

console.log('test-game-js: ok');
