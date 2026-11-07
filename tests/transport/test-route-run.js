// coordinator/route-map.js runFacts: the route view's facts from a run, its frame path and the workbook plan. Fake places only.
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const ctx = { window: {}, document: { currentScript: null }, location: { href: 'http://x/' }, URL, Math, Date, JSON, String, Number, Object, Array, isFinite };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../coordinator/route-map.js'), 'utf8'), ctx);
const { runFacts } = ctx.window.LMCSRouteMap;
const J = (x) => JSON.parse(JSON.stringify(x));

// three frames 1 km apart going north (0.009 deg of latitude ~ 1 km), the middle one with no position on record
const pts = [[31.000, 77, 1000], null, [31.018, 77, 3000], [31.027, 77, 4000]];
const run = { stops: [{ seq: 4, name: 'Upper Village', at: new Date(3100).toISOString(), lat: 31.018, lng: 77, boardOn: 3, boardOff: 0, photo: true },
  { seq: 9, name: '', at: '', lat: 31.027, lng: 77, boardOn: 0, boardOff: 1 }] };
const plan = [{ name: 'Upper  village', km: 2, children: 3, kmDay: 12, rounds: 2 }, { name: 'Lower Village', km: 5, children: 4, kmDay: 12, rounds: 2 }];
const f = J(runFacts(run, pts, plan));
assert.strictEqual(f.km, 3, 'length: the GPS path, skipping frames with no position');
assert.deepStrictEqual(f.chapters.map((c) => c.frame), [2, 3], 'a stop jumps to the frame nearest its time, else nearest its place');
assert.deepStrictEqual([f.boardOn, f.boardOff], [3, 1], 'children as counts');
assert.deepStrictEqual(f.planned.map((p) => p.seen), [true, false], 'a planned stop is matched by name, ignoring case and spaces');
assert.ok(f.diffs.some((d) => /Not marked on the run: Lower Village/.test(d)), 'a planned stop the run missed is flagged');
assert.ok(f.diffs.some((d) => /got on during the run; the plan has 7/.test(d)), 'children on the run vs the plan');
assert.ok(f.diffs.some((d) => /one way of a planned round is about 3 km/.test(d)) === false, 'within 20% of a round (12 km / 2 rounds / 2 ways = 3 km): no flag');
const long = J(runFacts(run, pts.concat([[31.1, 77, 5000]]), plan));
assert.ok(long.diffs.some((d) => /one way of a planned round is about 3 km/.test(d)), 'a much longer run is flagged');
const unnamed = J(runFacts({ stops: [{ seq: 1, name: '', at: '', lat: 31, lng: 77 }] }, pts, plan));
assert.deepStrictEqual(unnamed.planned.map((p) => p.seen), [null, null], 'no names on the run: not matched, not called missed');
assert.ok(unnamed.diffs.some((d) => /no names yet/.test(d)));
assert.deepStrictEqual(J(runFacts(run, pts, [])).diffs, [], 'no plan: nothing to compare');
assert.deepStrictEqual(J(runFacts(null, [], plan)).chapters, [], 'no run: the plan alone');
// mount(): the map is drawn for everyone; only the Owner and Coordinators get "See the run" (the reviewer's comment-swallowed arrow)
const src = fs.readFileSync(path.join(__dirname, '../../coordinator/route-map.js'), 'utf8');
const line = src.split('\n').find((l) => /state\.onRun =/.test(l));
assert.ok(line && line.indexOf('//') === -1 && /state\.onRun = \(reg\) => run\(/.test(line), 'onRun is code, not a comment');
assert.ok(/\n\s*TransportViews\.render\(el, d, opts\.mode, state\);\n\s*\} catch/.test(src), 'the map is drawn for every caller');
console.log('route run: all checks passed');
