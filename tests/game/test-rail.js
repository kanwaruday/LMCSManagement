// The game bar (assets/game/rail.js): counts from a Today payload, spoken labels, the badge cap; game.js fires the event
// only for the whole day; base.css carries the kit classes the gallery shows.
const assert = require('assert'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..');
const R = require(path.join(root, 'assets/game/rail.js'));
assert.deepStrictEqual(R.counts({ missions: [{}, { done: true }, { gone: true }, {}], windows: [{}, { decided: true }], quests: [{ complete: true }, {}] }), { missions: 3, quests: 1 });
assert.deepStrictEqual(R.counts(null), { missions: 0, quests: 0 });
assert.strictEqual(R.label('Missions', 3), 'Missions, 3 waiting');
assert.strictEqual(R.label('Quests', 0), 'Quests');
assert.strictEqual(R.badge(7), '7');
assert.strictEqual(R.badge(120), '99+');
assert.ok(R.valid({ missions: 2, quests: 0 }) && !R.valid({ missions: '2', quests: 0 }) && !R.valid(null) && !R.valid({ missions: -1, quests: 0 }), 'stored counts are used only when well formed');
assert.strictEqual(R.hubHref('index.html'), 'index.html#game-root');
assert.strictEqual(R.hubHref('index.html#today'), 'index.html#today', 'a hub link with its own spot keeps it');
const game = fs.readFileSync(path.join(root, 'assets/game/game.js'), 'utf8');
assert.ok(/if \(!opts\.only\) try \{ document\.dispatchEvent\(new CustomEvent\('lmcs-game-today', \{ detail: d \}\)\)/.test(game), 'game.js fires lmcs-game-today for the whole day only');
const css = fs.readFileSync(path.join(root, 'assets/game/base.css'), 'utf8');
const gallery = fs.readFileSync(path.join(root, 'tests/game/base-gallery.html'), 'utf8');
for (const c of ['gb-shell', 'gb-stage', 'gb-panels', 'gb-panel', 'gb-next-slot', 'gb-btn-danger', 'gb-quest', 'gb-count', 'gb-rail', 'gb-field', 'gb-input', 'gb-field-err', 'gb-loading', 'gb-alert', 'gb-table', 'gb-saved', 'gb-saved-local', 'gb-toast']) {
  assert.ok(css.includes('.' + c), 'base.css has .' + c);
  if (!/^gb-(shell|stage|panels|panel|next-slot)$/.test(c)) assert.ok(gallery.includes(c), 'the gallery shows ' + c);
}
assert.ok(!/@keyframes|transition\s*:|animation\s*:/.test(css), 'base.css has no motion');
// the skeleton: Owner home and the Kingdom put the bar, stage and panels in the shell; element headings don't outrank component ones
for (const p of ['owner/index.html', 'owner/kingdom.html']) {
  const h = fs.readFileSync(path.join(root, p), 'utf8');
  assert.ok(/class="gb-shell"/.test(h) && /class="gb-rail"/.test(h) && /class="gb-stage"/.test(h) && /class="gb-panels"/.test(h), p + ' uses the skeleton');
}
assert.ok(css.includes(':where(.gb) h2') && !/^\.gb h2/m.test(css), 'base.css element headings are weightless');
console.log('test-rail: ok');
