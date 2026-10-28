// The school building (assets/game/school-building.js): the model is cleaned before drawing, labels are escaped, the sample
// says so, rooms point at the shared emoji map, and a broken model draws nothing rather than something wrong.
const assert = require('assert'), path = require('path');
const root = path.join(__dirname, '..', '..');
global.LMCSEmoji = require(path.join(root, 'assets/game/emoji.js'));
const B = require(path.join(root, 'assets/game/school-building.js'));

const m = B.clean(B.SAMPLE);
assert.ok(m && m.sample === true && m.blocks.length === 2, 'the sample cleans to two blocks, marked sample');
assert.strictEqual(B.rooms(m).length, 17, 'every sample room and ground is listed');
for (const t of Object.keys(B.TYPE_KEY)) assert.ok(LMCSEmoji.get(B.TYPE_KEY[t]), 'room type ' + t + ' has an emoji in the shared map');
assert.deepStrictEqual(B.rooms(m).filter((r) => r.host).map((r) => r.host).sort(), ['daily', 'hr', 'rules', 'setup'], 'the four Home Base rooms are hosted on the drawing');

const svg = B.svg(B.SAMPLE);
assert.ok(svg.startsWith('<svg') && svg.includes('Sample building') && svg.includes('data-room="c3a"') && svg.includes('📦'), 'the drawing has rooms, emoji and the sample mark');
assert.ok(!B.svg(Object.assign({}, B.SAMPLE, { sample: false })).includes('Sample building'), 'a real building is not marked sample');

// bad input: a hostile name is escaped, an unknown type or out-of-range floor is dropped, junk draws nothing
const evil = { name: '<img src=x onerror=alert(1)>', blocks: [{ id: 'a"b', name: 'x', x: 0, y: 0, w: 2, d: 1, floors: 1, rooms: [
  { id: 'r1', name: '<b>bad</b>', type: 'classroom', holds: '<i>', face: 'front', floor: 0, at: 0, span: 1 },
  { id: 'r2', name: 'ghost', type: 'dungeon', face: 'front', floor: 0, at: 1, span: 1 },
  { id: 'r3', name: 'roof garden', type: 'ground', face: 'front', floor: 3, at: 1, span: 1 }] }] };
const es = B.svg(evil);
assert.ok(!/<img|<b>|<i>/.test(es) && es.includes('&lt;img') && es.includes('a&quot;b') === false, 'labels are escaped; block ids never reach the markup');
assert.strictEqual(B.rooms(B.clean(evil)).length, 1, 'an unknown type and a floor the block does not have are dropped');
assert.strictEqual(B.svg(null), '', 'no model, no drawing');
assert.strictEqual(B.svg({ blocks: [] }), '', 'no blocks, no drawing');
assert.strictEqual(B.clean({ blocks: [{ w: 99, d: -4, floors: 40, rooms: [] }] }).blocks[0].floors, 6, 'sizes are clamped');
console.log('test-school-building: ok');
