// coordinator/transport-views.js: the pure parts of the route views -- village names from GPS place strings, seats across
// rounds, and the decision tags on the depot cards. Fake data only.
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const ctx = { window: {}, String, Number, Math, Object, Array, JSON };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../coordinator/transport-views.js'), 'utf8'), ctx);
const V = ctx.window.TransportViews;
assert.strictEqual(V.village('0.87 Km S of HVXP X7Q, Nalwari, Himachal Pradesh 175008, India'), 'Nalwari');
assert.strictEqual(V.village('0.05 Km E of La Montessori School LMS Rd, Kalehli, Sarabai (Himachal Pradesh)'), 'Sarabai');
assert.strictEqual(V.village('0.01 Km W of Famra filling station Nerchowk (Himachal Pradesh )'), 'Famra filling station Nerchowk');
assert.strictEqual(V.capacity({ seats: 24, rounds: 4 }), 48, 'four rounds = two trips each way');
assert.strictEqual(V.capacity({ seats: 41, rounds: 2 }), 41);
assert.strictEqual(V.capacity({ seats: 41, rounds: null }), 41, 'unknown rounds: one trip each way');
assert.strictEqual(V.capacity({ seats: 0 }), 0);
const tags = v => JSON.parse(JSON.stringify(V.decisions(Object.assign({ operational: true, tracker: 'ok', year: 2020, seats: 41, rounds: 2, students: 30, net: 0 }, v), 2026))).map(x => x[0]); // JSON: arrays from the vm realm
assert.deepStrictEqual(tags({}), []);
assert.deepStrictEqual(tags({ year: 2011 }), ['Past 15 years: replace']);
assert.deepStrictEqual(tags({ year: 2013 }), ['15 years in 2028']);
assert.deepStrictEqual(tags({ operational: false, year: 2010, tracker: 'none' }), ['Off the road: scrap or sell'], 'a bus off the road is not asked for a tracker');
assert.deepStrictEqual(tags({ tracker: 'dead', net: -150000 }), ['Fix tracker', 'Losing over ₹1 L: review the route']);
assert.deepStrictEqual(tags({ students: 20 }), ['Under 60% full']);
assert.deepStrictEqual(tags({ students: 50 }), ['More children than seats']);
assert.deepStrictEqual(tags({ students: null, net: null }), [], 'unknown children or money: no tag, not a guess');
console.log('transport views: all checks passed');
