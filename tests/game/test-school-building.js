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
assert.deepStrictEqual(B.rooms(m).filter((r) => r.host).map((r) => r.host).sort(), ['daily', 'hr', 'rules', 'setup', 'ss'], 'the five Home Base rooms are hosted on the drawing');

const svg = B.svg(B.SAMPLE);
assert.ok(svg.startsWith('<svg') && svg.includes('Sample building') && svg.includes('data-room="c3a"') && svg.includes('data-room="meet"') && /\p{Extended_Pictographic}/u.test(svg), 'the drawing has rooms, emoji and the sample mark');
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
assert.strictEqual(B.clean({ blocks: [{ w: 99, d: -4, floors: 40, rooms: [] }] }).blocks[0].floors, 8, 'sizes are clamped');
// a null block, fractional floors and the arc model: none throw, floors are whole, the LMS 2 model draws with its hosts gold
assert.strictEqual(B.clean({ blocks: [null, 5, { floors: 2, w: 2, d: 1, rooms: [null, { id: 'f', name: 'x', type: 'classroom', face: 'front', floor: 1.6, at: 0, span: 1 }] }] }).blocks[0].rooms.length, 0, 'a floor that rounds past the top is dropped');
const M = require(path.join(root, 'assets/game/school-models.js'));
const lm = B.clean(M.LMS2);
assert.ok(lm && !lm.sample && lm.blocks[0].kind === 'arc', 'LMS 2 is a real (not sample) curved building');
assert.deepStrictEqual(B.rooms(lm).filter((r) => r.host).map((r) => r.host).sort(), ['daily', 'hr', 'rules', 'setup', 'ss'], 'LMS 2 hosts the five Home Base rooms');
const ls = B.svg(M.LMS2, { hosts: ['daily', 'hr'] });
assert.ok(!ls.includes('Sample building') && (ls.match(/sb-host/g) || []).length === 2, 'only rooms the page can open are gold');
assert.ok(!/\d{2}\.\d{4,}°|lat|lng|longitude/i.test(JSON.stringify(M)), 'no map location in the models');
// a room's own emoji key beats its type's: the Support Sessions rooms show 🤝, not the office/hall emoji
assert.ok(/data-room="meet"[^]*?class="sb-e"[^>]*>🤝</.test(svg), 'the sample Meeting room shows 🤝');
assert.ok(/data-room="f4-hall"[^]*?class="sb-e"[^>]*>🤝</.test(B.svg(M.LMS2)), 'LMS 2 Sessions hall shows 🤝');
assert.strictEqual(B.rooms(B.clean({ name: 'T', blocks: [{ id: 'b', x: 0, y: 0, w: 1, d: 1, floors: 1, rooms: [{ id: 'r', name: 'R', type: 'office', e: '"><x', face: 'front', floor: 0, at: 0, span: 1 }] }] }))[0].e, '', 'a bad emoji key is dropped');
// the campus picture: Art Studio's real-building cut-out for every school (7 Nov), the 960 px export's own size as the img size (sized by
// width, each campus its own aspect), in the 480 px slot, and the old renders gone
const fs = require('fs');
const webpSize = (f) => { // VP8X / VP8L / VP8 headers -> [width, height]
  const b = fs.readFileSync(f), k = b.toString('ascii', 12, 16);
  if (k === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
  if (k === 'VP8L') { const n = b.readUInt32LE(21); return [1 + (n & 0x3fff), 1 + ((n >> 14) & 0x3fff)]; }
  return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
};
const NAMES = { LMS1: 'LMS 1 Dhalpur', LMS2: 'LMS 2 Kelheli', LMS3: 'LMS 3 Dunkhra', LMS4: 'LMS 4 Ner Chowk', LMS5: 'LMS 5 Sayoli', LMS6: 'LMS 6 Jogindernagar' };
for (const [c, name] of Object.entries(NAMES)) {
  const html = B.svg(Object.assign({}, B.SAMPLE, { campus: c }));
  const img = (html.match(/<img [^>]+>/) || [''])[0], att = (k) => (img.match(new RegExp(' ' + k + '="([^"]*)"')) || [])[1];
  const stem = c.toLowerCase().replace('lms', 'lms');
  assert.ok(new RegExp('art/real-' + stem + '-[a-z]+-map-1x\\.webp').test(att('src')), c + ': the real cut-out');
  assert.strictEqual(att('alt'), 'The ' + name + ' school building', c + ' alt');
  const big = path.join(root, 'assets/game', att('src').replace(/^.*?art\//, 'art/').replace('-1x', '-960')), [w, h] = webpSize(big);
  assert.deepStrictEqual([Number(att('width')), Number(att('height')), w], [w, h, 960], c + ': width/height are the 960 px file\'s own');
  assert.ok(att('srcset').includes('-960.webp 960w') && att('srcset').includes('-1x.webp 200w') && fs.existsSync(big.replace('-960', '-1x')), c + ': 1x and the 960 px export');
  assert.ok(/width:min\(100%,480px\)/.test(html) && 480 * 2 <= w, c + ': the 480 px slot, sharp at 2x without upscaling');
}
assert.ok(!B.svg(Object.assign({}, B.SAMPLE, { campus: 'LMS3' }), { art: false }).includes('<img'), 'art:false draws no picture');
assert.ok(!fs.readdirSync(path.join(root, 'assets/game/art')).some((f) => /^lms\d-/.test(f)), 'the old renders are gone');
console.log('test-school-building: ok');
