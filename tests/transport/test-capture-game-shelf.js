// apps-script/coordinator-transport-gps.gs coordGameCapture_ (lms-game T3): the capture shelf through the classic proxy. Key-gated; the caller
// is the proxy's verified email; it adds no rule of its own, it calls the shelf's coordCaptureReview_ / coordCaptureDecide_. Synthetic only.
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../../apps-script/coordinator-transport-gps.gs'), 'utf8');
const fn = src.slice(src.indexOf('function coordGameCapture_'), src.indexOf("/** Asks the Roster to bin one run's Drive folder"));
const calls = [];
const ctx = { coordGameKeyOk_: (b) => b.key === 'k',
  coordCallerForEmail_: (e) => (e === 'coord@test.invalid' ? { email: e, roles: ['Coordinator'] } : null),
  coordCaptureReview_: (c) => (c.email === 'coord@test.invalid' ? { success: true, runs: [{ runId: 'R1', reg: 'HP1', videoFileId: 'V', stops: [] }] } : { success: false }),
  coordCaptureDecide_: (c, b) => { calls.push([c.email, b.runId, b.decision]); return b.decision === 'discard' && b.runId === 'bad' ? { success: false, error: 'That run is not waiting for your check' } : { success: true }; } };
vm.createContext(ctx); vm.runInContext(fn, ctx);
const go = (b) => JSON.parse(JSON.stringify(ctx.coordGameCapture_(b)));
assert.deepStrictEqual(go({ key: 'x', action: 'gameTransportCaptureReview', email: 'coord@test.invalid' }), { success: false, error: 'not_authorized' });
assert.deepStrictEqual(go({ key: 'k', action: 'gameTransportCaptureReview', email: 'nobody@test.invalid' }).data, { ok: false, code: 'not_authorized' });
assert.deepStrictEqual(go({ key: 'k', action: 'gameTransportCaptureReview', email: 'coord@test.invalid' }), { success: true, data: { runs: [{ runId: 'R1', reg: 'HP1', videoFileId: 'V', stops: [] }] } });
assert.deepStrictEqual(go({ key: 'k', action: 'gameTransportCaptureDecide', email: 'coord@test.invalid', params: { runId: 'R1', decision: 'publish' } }).data, { ok: true });
assert.deepStrictEqual(go({ key: 'k', action: 'gameTransportCaptureDecide', email: 'coord@test.invalid', params: { runId: 'bad', decision: 'discard' } }).data, { ok: false, code: 'That run is not waiting for your check' });
assert.deepStrictEqual(go({ key: 'k', action: 'gameTransportCaptureDecide', email: 'nobody@test.invalid', params: { runId: 'R1', decision: 'publish' } }).data, { ok: false, code: 'not_authorized' });
assert.deepStrictEqual(calls, [['coord@test.invalid', 'R1', 'publish'], ['coord@test.invalid', 'bad', 'discard']], 'the decide rules run in the shelf, never here');
console.log('capture shelf game actions: all passed');
