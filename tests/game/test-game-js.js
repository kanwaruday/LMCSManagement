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
const J = (x) => JSON.parse(JSON.stringify(x));

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
// B1 / R31: "{firstName} ji"; counts open items only (missions not done/gone + undecided windows), spelled one to nine;
// the first item is never spliced into the sentence
const g = (t, name) => G.greetingLine(t, name === undefined ? { name: 'Meena Sharma' } : name, ist('2026-11-03T09:00:00'));
assert.strictEqual(g({ missions: [] }), 'Good morning, Meena ji. Nothing is waiting today. Enjoy the calm.');
assert.strictEqual(g({ missions: [mission('Approve the leave'), mission('B')] }), 'Good morning, Meena ji. Two things are waiting today.');
assert.strictEqual(g({ missions: [mission('Approve the leave')] }), 'Good morning, Meena ji. One thing is waiting today.');
assert.strictEqual(g({ missions: [mission('A'), Object.assign(mission('B'), { done: true }), Object.assign(mission('C'), { gone: true })],
  windows: [{ windowId: 'w', title: 'W', decided: null }, { windowId: 'v', title: 'V', decided: { value: [] } }] }), 'Good morning, Meena ji. Two things are waiting today.');
assert.strictEqual(g({ missions: [1, 2, 3, 4].map((i) => mission('m' + i)) }), 'Good morning, Meena ji. Four things are waiting today.');
assert.strictEqual(g({ missions: Array.from({ length: 12 }, (x, i) => mission('m' + i)) }), 'Good morning, Meena ji. 12 things are waiting today.');
assert.strictEqual(g({ missions: [Object.assign(mission('B'), { done: true })] }), 'Good morning, Meena ji. Nothing is waiting today. Enjoy the calm.');
assert.ok(!/Approve/.test(g({ missions: [mission('Approve the leave')] })));
assert.ok(/^Good afternoon, /.test(G.greetingLine({ missions: [] }, { name: 'A' }, ist('2026-11-03T12:00:00'))));
assert.ok(/^Good morning, /.test(G.greetingLine({ missions: [] }, { name: 'A' }, ist('2026-11-03T11:59:00'))));
assert.ok(/^Good evening, /.test(G.greetingLine({ missions: [] }, { name: 'A' }, ist('2026-11-03T17:00:00'))));
assert.ok(/^Good afternoon, /.test(G.greetingLine({ missions: [] }, { name: 'A' }, ist('2026-11-03T16:59:00'))));
// hour is IST regardless of the browser zone: 07:00 UTC = 12:30 IST
assert.ok(/^Good afternoon, /.test(G.greetingLine({ missions: [] }, { name: 'A' }, new Date('2026-11-03T07:00:00Z'))));
// M37: honorifics and initials are skipped for the first name
assert.strictEqual(g({ missions: [] }, { name: 'Dr. Meena Sharma' }), 'Good morning, Meena ji. Nothing is waiting today. Enjoy the calm.');
assert.strictEqual(g({ missions: [] }, { name: 'Smt Meena Sharma' }), 'Good morning, Meena ji. Nothing is waiting today. Enjoy the calm.');
assert.strictEqual(g({ missions: [] }, { name: 'MRS. A. K. Meena' }), 'Good morning, Meena ji. Nothing is waiting today. Enjoy the calm.');
assert.strictEqual(g({ missions: [] }, { name: 'Dr.' }), 'Good morning. Nothing is waiting today. Enjoy the calm.');
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

// R28: no ".." whatever the titles
assert.ok(!/\.\./.test(G.greetingLine({ missions: [mission('A.')] }, {}, ist('2026-11-03T09:00:00'))));
// openItems: core first (server order kept within groups), then undecided windows -- the Today panel's order
const oi = G.openItems({ missions: [mission('a'), Object.assign(mission('b'), { core: true }), mission('c'), Object.assign(mission('d'), { core: true }), Object.assign(mission('e'), { done: true })],
  windows: [{ windowId: 'w', title: "Choose your campus's track-suit days", decided: null }] });
assert.deepStrictEqual(J(oi.map((x) => x.title)), ['b', 'd', 'a', 'c', "Choose your campus's track-suit days"]); // R2-2: one name, no 'Decide: '
assert.deepStrictEqual(J(G.openItems({})), []);
// nextMission: the first open mission in panel order when the server's next is in the set; else the server's own
const nset = { missions: [mission('a'), Object.assign(mission('b'), { core: true })], next: mission('a') };
assert.strictEqual(G.nextMission(nset).id, 'b');
assert.strictEqual(G.nextMission(Object.assign({}, nset, { next: mission('z') })).id, 'z');
assert.strictEqual(G.nextMission({ missions: [], next: null }), null);
// smallLine: why, else the source page; dropped when the progress bar already says it
assert.strictEqual(G.smallLine({ why: '6 still needed for October', go: 'principals-daily-reporting/index.html', progress: { done: 0, total: 2 } }), '6 still needed for October');
assert.strictEqual(G.smallLine({ why: '', go: 'principals-daily-reporting/index.html' }), 'Daily Reporting');
assert.strictEqual(G.smallLine({ why: '2 of 4 classes done', progress: { done: 2, total: 4 } }), '');
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

// safeHref (A1): root-relative portal paths get the root; any scheme, protocol-relative, or control-character trick -> null
assert.strictEqual(G.safeHref('principal/issues.html', '../'), '../principal/issues.html');
assert.strictEqual(G.safeHref('principal/issues.html'), 'principal/issues.html');
assert.strictEqual(G.safeHref('/LMCSManagement/x.html', '../'), '/LMCSManagement/x.html');
assert.strictEqual(G.safeHref('https://example.org/a', '../'), null);
assert.strictEqual(G.safeHref('java\nscript:alert(1)'), null);
assert.strictEqual(G.safeHref('java\tscript:x'), null);
assert.strictEqual(G.safeHref('\u0001javascript:x'), null);
assert.strictEqual(G.safeHref('\u0001//evil.example'), null);
assert.strictEqual(G.safeHref('\u0001//evil.example', ''), null);
assert.strictEqual(G.safeHref(' /\\evil.example'), null);
assert.strictEqual(G.safeHref('coordinator/followups/index.html', ''), 'coordinator/followups/index.html');
assert.strictEqual(G.safeHref('javascript:alert(1)'), null);
assert.strictEqual(G.safeHref(' JavaScript:alert(1)'), null);
assert.strictEqual(G.safeHref('data:text/html,x'), null);
assert.strictEqual(G.safeHref('//evil.example/x'), null);
assert.strictEqual(G.safeHref('\\\\evil.example/x'), null);
assert.strictEqual(G.safeHref(''), null);
assert.strictEqual(G.safeHref(undefined), null);
// the two Google Form prefixes pass exactly (Teacher CW/HW form); look-alikes and other https stay refused
assert.strictEqual(G.safeHref('https://docs.google.com/forms/d/e/abc/viewform?entry.1=x', '../'), 'https://docs.google.com/forms/d/e/abc/viewform?entry.1=x');
assert.strictEqual(G.safeHref('https://forms.gle/AbC123'), 'https://forms.gle/AbC123');
assert.strictEqual(G.safeHref('https://forms.gle.evil.example/x'), null);
assert.strictEqual(G.safeHref('https://docs.google.com/spreadsheets/d/x'), null);
assert.strictEqual(G.safeHref('http://docs.google.com/forms/d/x'), null);
assert.strictEqual(G.safeHref('https://docs.google.com.evil.example/forms/x'), null);

// sourceLabel
assert.strictEqual(G.sourceLabel('principals-daily-reporting/index.html'), 'Daily Reporting');
assert.strictEqual(G.sourceLabel('coordinator/followups/index.html'), 'Follow-ups');
assert.strictEqual(G.sourceLabel('elsewhere.html'), '');
assert.strictEqual(G.sourceLabel('coordinator/systems/index.html#approvals'), 'Systems'); // N3

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
// D6: every figure and avatar art() can return exists -- each outfit (by date and campus config) x each pose
const artDir = path.join(__dirname, '../../assets/game');
const outfitDays = { 'winter-formal': ist('2026-11-03T10:00:00'), 'tracksuit-winter': ist('2026-11-02T10:00:00'),
  'summer-formal': ist('2027-05-11T10:00:00'), 'tracksuit-summer': ist('2027-05-10T10:00:00'), festival: ist('2026-11-08T10:00:00') };
const poseDays = { neutral: { missions: [{ id: 'a' }], sourcesDown: [] }, celebrate: { missions: [{ id: 'a', done: true }], sourcesDown: [] },
  bad: { missions: [{ id: 'a' }], sourcesDown: ['x'] } };
const seen = new Set();
Object.keys(outfitDays).forEach((o) => Object.keys(poseDays).forEach((pose) => ['buddy', 'teacher-owl'].forEach((sp) => [false, true].forEach((fv) => {
  const a = G.art(Object.assign({ speaker: sp, campus: 'LMS4', config: cfg }, poseDays[pose]), outfitDays[o], fv);
  if (sp === 'buddy') assert.strictEqual(a.figure, 'buddy/' + o + '-' + pose + '.webp');
  [a.figure, a.avatar].forEach((f) => { seen.add(f); assert.ok(fs.existsSync(path.join(artDir, f)), f); });
}))));
assert.strictEqual(seen.size, 15 + 5 + 4 + 1); // 15 Buddy figures, 5 avatars, 4 Teacher Owl poses (intro, neutral, celebrate, bad), 1 owl avatar

// R2-2: a window's small line; the track-suit one adds what it changes
const tsw = { windowId: 'trackSuit', choice: { type: 'pickN', n: 3, options: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] } };
assert.strictEqual(G.windowSmall(tsw), 'Pick 3 of Mon–Sat · Buddy dresses to match');
assert.strictEqual(G.windowSmall(Object.assign({}, tsw, { windowId: 'other' })), 'Pick 3 of Mon–Sat');
assert.strictEqual(G.windowSmall({ windowId: 'x' }), '');
// R2-3: the live pick count, and the over-picking line
assert.strictEqual(G.pickedText(2, 3), '2 of 3 picked');
assert.strictEqual(G.pickedText(3, 3), '3 of 3 picked');
assert.strictEqual(G.pickedText(5, 3), '5 picked. Untick 2 to save.');
assert.strictEqual(G.pickedText(1, 0), '');

// a quest step with a guide id and no usable go links to the guide (root-relative); it is the next action like any other step
assert.ok(/s\.guide/.test(src) && /root \+ 'guide\/index\.html#' \+ s\.guide/.test(src), 'guide link on quest steps');
assert.ok(/open && !href && !win && \/\^\[\\w-\]\+\$\/\.test\(s\.guide/.test(src), 'only an open step with a plain id gets the guide link');

// R28 structurally: game.js never parses HTML -- every text goes in as a text node or an attribute
// quest panel source checks (DOM-free): parallel quests are folded and unnumbered; waiting steps are never the next action; due is neutral
assert.ok(/q\.parallel/.test(src) && /'details'/.test(src), 'parallel quests render in <details>');
assert.ok(/!s\.locked && !wait && !linked/.test(src), 'a waiting step is never the next action');
assert.ok(/\['due', 'due '/.test(src), 'mission due tag uses the neutral due class');
// onlyModule (a module page, mount's `only`): just that module's missions and quests; no windows, days, greeting or home tour
{ const d = { role: 'Coordinator', firstLoadToday: true, toursSeen: [], daysOnTrack: { onTrack: 3, counted: 4 }, windows: [{ windowId: 'w' }],
    missions: [{ id: 'fleet_papers:HP1', kind: 'fleet_papers' }, { id: 'approval_recommend:A1', kind: 'approval_recommend' }],
    next: { id: 'approval_recommend:A2', kind: 'approval_recommend' },
    quests: [{ questId: 'fleet:HP1', steps: [] }, { questId: 'coord1', steps: [] }] };
  const f = G.onlyModule(d, 'fleet');
  assert.deepStrictEqual(f.missions.map((m) => m.id), ['fleet_papers:HP1']);
  assert.deepStrictEqual(f.quests.map((q) => q.questId), ['fleet:HP1']);
  assert.strictEqual(f.next, null); assert.strictEqual(JSON.stringify(f.windows), '[]'); assert.strictEqual(f.daysOnTrack, null);
  assert.strictEqual(f.firstLoadToday, false); assert.strictEqual(JSON.stringify(f.toursSeen), '[]'); // kept: a page tour checks it
  assert.strictEqual(G.onlyModule(Object.assign({}, d, { next: d.missions[0] }), 'fleet').next.id, 'fleet_papers:HP1');
  assert.strictEqual(d.missions.length, 2, 'the response itself is not changed'); }
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|createContextualFragment|DOMParser/.test(src), 'game.js must not build HTML from strings');
// one tour UI: LMCSGame.tour (the floating Buddy's "Show me how"), the home tour and mount's page tour all run runTour
assert.strictEqual(typeof G.tour, 'function');
assert.strictEqual((src.match(/lg-tourcard/g) || []).length, 1, 'the tour card is built in one place');
assert.strictEqual((src.match(/runTour\(beats, \{/g) || []).length, 2, "mount's tour() and LMCSGame.tour both call runTour");
assert.ok(/function tour\(beats, after, tourId\) \{\s*runTour\(/.test(src), "mount's home and page tours go through runTour");
assert.strictEqual(G.tour([], {}), undefined); // no beats: nothing happens, no DOM touched
{ // a hidden target (no client rects) gets the centred card, like an absent one
  const bt = new Function('document', /function beatTarget\(x\) \{[\s\S]*?\n  \}/.exec(src)[0] + '; return beatTarget;');
  const shown = { getClientRects: () => [1] }, hidden = { getClientRects: () => [] };
  assert.strictEqual(bt({ querySelector: () => hidden })('#x'), null);
  assert.strictEqual(bt({ querySelector: () => shown })('#x'), shown);
  assert.strictEqual(bt({ querySelector: () => null })('#x'), null);
}
assert.strictEqual(G.last(), null);            // no mount yet
for (const k of ['h', 'img', 'trap', 'reduced']) assert.strictEqual(typeof G.ui[k], 'function', 'ui.' + k);
// mount with no backendUrl renders nothing and touches nothing else
let cleared = 0;
G.mount({ set textContent(v) { cleared++; } }, { session: {}, backendUrl: '' });
assert.strictEqual(cleared, 1);

console.log('test-game-js: ok');
