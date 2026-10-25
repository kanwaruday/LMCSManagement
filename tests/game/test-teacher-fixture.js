// node tests/game/test-teacher-fixture.js -- the ui-stub's `teacher` fixture is exactly what make-teacher-fixture.js builds from the real module,
// and it has the shapes the UI review needs. Regenerate with: node tests/game/make-teacher-fixture.js
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const { build, OUT } = require('./make-teacher-fixture.js');
const win = {};
vm.runInNewContext(fs.readFileSync(OUT, 'utf8'), { window: win });
const built = build();
assert.deepStrictEqual(JSON.parse(JSON.stringify(win.TEACHER_FIXTURE)), built, 'fixtures/teacher-today.js is stale: run node tests/game/make-teacher-fixture.js');

// the shapes the stub is for
const log = built.missions.filter((m) => m.kind === 'cwhw_log');
assert.strictEqual(log.length, 1); assert.deepStrictEqual(log[0].progress, { done: 2, total: 4 }); assert.strictEqual(built.next.id, log[0].id);
assert.strictEqual(built.missions.filter((m) => m.kind === 'remediation_due').length, 1);
const q1 = built.quests[0];
assert.strictEqual(q1.questId, 'teacher1'); assert.ok(q1.steps.some((s) => s.done) && q1.steps.some((s) => !s.done));
const chapters = built.quests.filter((q) => q.questId.indexOf('chapter:') === 0);
assert.strictEqual(chapters.length, 3);
assert.strictEqual(chapters.filter((q) => q.steps[2].title === 'Run the activity · checking overnight').length, 1);
const m2 = chapters.filter((q) => /^chapter:[^:]+:M-II:/.test(q.questId));
assert.strictEqual(m2.length, 1); assert.strictEqual(m2[0].steps.length, 3);
assert.ok(built.quests.some((q) => q.questId.indexOf('term:') === 0));
// synthetic only
assert.ok(!/@lms\.org\.in/i.test(JSON.stringify(built)));
console.log('test-teacher-fixture: ok');
