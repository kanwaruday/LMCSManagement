// Kingdom real map: the places config, no other coordinates in assets/, and the map module's pins and attribution.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..', '..'), read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const ctx = { window: {}, console };
vm.createContext(ctx);
vm.runInContext(read('assets/game/places.js'), ctx);
vm.runInContext(read('assets/game/kingdom-map.js'), ctx);
const P = ctx.window.LMCSPlaces, M = ctx.window.LMCSKingdomMap;

assert.strictEqual(Object.keys(P).filter((k) => k !== 'CENTER').sort().join(), 'HES,LMS1,LMS2,LMS3,LMS4,LMS5,LMS6');
assert.ok(P.CENTER.lat > 31 && P.CENTER.lat < 33 && P.CENTER.zoom === 9, 'the empty-map centre lives in places.js');
Object.keys(P).filter((k) => k !== 'CENTER').forEach((k) => {
  const p = P[k];
  assert.ok(p.name, k + ' has a name');
  const set = p.lat !== null || p.lng !== null;
  if (set) assert.ok(p.lat >= 31 && p.lat <= 33 && p.lng >= 75.5 && p.lng <= 78, k + ' is in the Himachal box');
});

// no other decimal-degree pairs anywhere in assets/
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const pair = /(?<![\d.])(?:(?:2[89]|3[0-4])\.\d+\s*,\s*[67]\d\.\d+|[67]\d\.\d+\s*,\s*(?:2[89]|3[0-4])\.\d+)(?![\d.])/; // any lat,lng or lng,lat pair in north India, however short
walk(path.join(root, 'assets')).filter((f) => /\.(js|css|html|json)$/.test(f) && !f.endsWith(path.join('game', 'places.js'))).forEach((f) => {
  assert.ok(!pair.test(fs.readFileSync(f, 'utf8')), 'coordinates outside places.js: ' + path.relative(root, f));
});

// the module draws only valid, non-null pins
const ids = (o) => M.drawable(o).map((p) => p.id).join();
assert.strictEqual(ids(P), 'HES,LMS1,LMS2,LMS3,LMS4,LMS5,LMS6', 'all seven pinned, HQ first (CENTER is not a place)');
assert.strictEqual(ids({ A: { name: 'a', lat: 31.9, lng: 77 }, B: { name: 'b', lat: null, lng: null }, C: { name: 'c', lat: 31.9, lng: null }, D: { name: 'd', lat: 10, lng: 77 } }), 'A');
assert.strictEqual(ids(null), '');
assert.strictEqual(M.missingText(1), '1 place still needs a map pin');
assert.strictEqual(M.missingText(7), '7 places still need a map pin');

// attribution, tiles and Leaflet from the same pinned files as the route map
const src = read('assets/game/kingdom-map.js'), rm = read('coordinator/route-map.js');
assert.strictEqual(M.ATTRIBUTION, '&copy; OpenStreetMap contributors');
assert.ok(/attribution: ATTR/.test(src) && M.TILES === 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
['leaflet/1.9.4/', ...(rm.match(/sha512-[\w+/=]+/g) || [])].forEach((s) => assert.ok(src.includes(s), 'same Leaflet pin: ' + s.slice(0, 20)));
assert.ok(!/innerHTML/.test(src), 'no HTML from strings');
assert.ok(/aria-modal/.test(src) && /LMCSGame\.ui\.trap/.test(src), 'modal, focus trapped');
assert.ok(!/KULLU/.test(src) && !/\[\s*31\./.test(src), 'no coordinates in the module');
const page = read('owner/kingdom.html');
assert.ok(page.includes('places.js') && page.includes('kingdom-map.js') && /LMCSKingdomMap\.open/.test(page));
assert.ok(!/leaflet/i.test(page), 'Leaflet loads only when the map is opened');
console.log('kingdom map: ok');
