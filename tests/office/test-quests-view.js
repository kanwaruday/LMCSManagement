// Setup quests first (office/js/quests.js). Standalone: node tests/office/test-quests-view.js (no-op under run.js).
'use strict';
const assert = require('assert');
if (require.main !== module) { module.exports = () => {}; return; }
(async () => {
  const Q = await import('../../office/js/quests.js');
  const ok = (n) => console.log('  ok  - ' + n);
  const st = (id, done, locked, go) => ({ id, title: id, go: go === undefined ? 'office/starting-data.html?campus=LMS1&quest=cash' : go, done, locked });
  const clerk = { questId: 'daybook-setup:LMS1', title: 'LMS 1 · Start your Day Book', steps: [st('check', true, false), st('cash', false, false), st('odometer', false, true)], complete: false };
  const acc = { questId: 'daybook-accountant', title: 'Bank side', steps: [st('banks', false, false)], complete: false };
  const other = { questId: 'cq:1', title: 'Other', steps: [st('a', false, false)], complete: false };
  const owner = { questId: 'daybook:LMS1', title: 'LMS 1 · Starting data', parallel: true, steps: [st('cash', false, false)], complete: false };
  assert.deepStrictEqual(Q.setupQuests([other, acc, clerk]).map((q) => q.questId), ['daybook-setup:LMS1', 'daybook-accountant', 'cq:1']); ok('Starting data first, then the Accountant, then the rest');
  assert.deepStrictEqual(Q.setupQuests([other, owner]), []); ok('no setup quest open: the home');
  assert.deepStrictEqual(Q.setupQuests([{ ...clerk, complete: true }, other]), []); ok('setup done: the home');
  assert.deepStrictEqual(Q.setupQuests(undefined), []); ok('no quests: the home');
  assert.strictEqual(Q.nextStep(clerk).id, 'cash'); ok('next step skips done and locked');
  assert.strictEqual(Q.nextStep({ steps: [st('x', false, false, 'https://evil.example/x'), st('y', false, false, 'javascript:alert(1)')] }), null); ok('only relative links');
  assert.strictEqual(Q.nextStep({ steps: [st('w', false, true)] }), null); ok('all locked: no step');
  const T = await import('../../office/js/today.js');
  assert.strictEqual(T.emo('dayBook'), ''); ok('no emoji map loaded: no emoji');
  globalThis.window = { LMCSEmoji: { get: (k) => (k === 'dayBook' ? '📒' : '') } };
  assert.strictEqual(T.emo('dayBook'), '<span class="gb-emoji" aria-hidden="true">📒</span> '); assert.strictEqual(T.emo('nope'), ''); ok('emoji is aria-hidden, unknown keys add nothing');
  const el = { innerHTML: '', querySelector: () => ({}) };
  Q.renderQuests(el, [{ questId: 'daybook-setup:LMS1', title: 'LMS 1', steps: [st('cash', false, false)] }], { name: 'A' });
  assert.ok(/gb-next[\s\S]*view-slot[\s\S]*Start here/.test(el.innerHTML)); ok('the switch slot sits under the next step');
  delete globalThis.window;
})().catch((e) => { console.error(e); process.exit(1); });
