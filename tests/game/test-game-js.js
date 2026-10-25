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

console.log('test-game-js: ok');
