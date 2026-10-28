// assets/game/bus-model.js: the driver's bus drawn from data. Body from seats and model, every part named in Hindi and English with
// a stable unique id, every placed part inside its view, a part's card from the parts history, and labels escaped.
const assert = require('assert'), B = require('../../assets/game/bus-model.js');
assert.deepStrictEqual([B.body({ seats: '12+1' }), B.body({ seats: '32+1' }), B.body({ seats: 43 }), B.body({}), B.body({ seats: 40, model: 'Force Traveller 26' })],
  ['van', 'mini', 'large', 'mini', 'van']);
const ids = B.PARTS.map((p) => p.id);
assert.strictEqual(new Set(ids).size, ids.length, 'part ids are unique');
['engine', 'battery', 'tyre_fl', 'tyre_fr', 'tyre_rl', 'tyre_rr', 'brakes', 'steering', 'lights_front', 'lights_back', 'indicators', 'horn', 'wipers', 'windscreen',
  'doors', 'seats', 'seat_belts', 'ac_fan', 'body', 'mirrors', 'fuel_tank', 'speedometer', 'gps_tracker', 'first_aid', 'fire_extinguisher']
  .forEach((id) => assert.ok(ids.includes(id), 'part ' + id));
B.PARTS.forEach((p) => {
  assert.ok(p.hi && /[ऀ-ॿ]/.test(p.hi) && p.en, p.id + ' has a Hindi and an English name');
  assert.ok(Object.keys(p.at).length, p.id + ' shows in at least one view');
  ['van', 'mini', 'large'].forEach((k) => B.VIEWS.forEach((v) => {
    const xy = B.place(p, k, v);
    if (!xy) return;
    const w = v === 'side' ? 400 : 240;
    assert.ok(xy[0] >= 0 && xy[0] <= w && xy[1] >= 0 && xy[1] <= 190, p.id + ' inside the ' + k + ' ' + v + ' view: ' + xy);
  }));
});
const eng = B.PARTS.find((p) => p.id === 'engine'), horn = B.PARTS.find((p) => p.id === 'horn'), speedo = B.PARTS.find((p) => p.id === 'speedometer');
assert.deepStrictEqual(B.info(eng, { parts: { engine_oil: '2026-05-01', clutch: '2025-12-01' } }), [{ k: 'Engine oil', v: '2026-05-01' }, { k: 'Clutch plate', v: '2025-12-01' }]);
assert.deepStrictEqual(B.info(horn, {}), [{ k: 'Last service', v: '—' }], 'nothing on file: a dash');
assert.deepStrictEqual(B.info(speedo, { papers: { speed_governor: { date: '2027-02-01' } } }), [{ k: 'Speed governor certificate', v: '2027-02-01' }]);
const svg = B.svg('large', 'front', { reg: '<HP>', sel: 'horn' });
assert.ok(svg.includes('&lt;HP&gt;') && !svg.includes('<HP>'), 'the plate is escaped');
assert.strictEqual((svg.match(/is-sel/g) || []).length, 1, 'one part chosen');
assert.ok(!/animate|transition/.test(svg), 'no animation');
console.log('bus model: all checks passed');
