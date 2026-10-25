// node tests/coordinator/test-academics.js -- checks coordAcademicsAggregate_
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const ctx = { console, Utilities: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../../apps-script/coordinator.gs', 'utf8'), ctx);

const now = new Date('2026-10-20T10:00:00+05:30'), ms = (d) => new Date(d + 'T10:00:00+05:30').getTime();
const rec = (teacher, lmsIdx, dateStr, cls, subj, cwTag, hwTag) => ({ teacher, lmsIdx, dateStr, timeMs: ms(dateStr), classMapped: cls, subject: subj, cwTag, hwTag });
const feed = { ayStart: '2026-04-01', cwRecords: [
  rec('SEEMA MAAM', 1, '2026-10-15', 'Class 5', 'Math', 'Chapter Teaching, OTT', 'Revise for OTT'),
  rec('seema', 1, '2026-10-16', 'Class 5', 'Math', 'Question & Answers', ''),         // same person, different spelling/case -> one teacher
  rec('Seema', 1, '2026-05-02', 'Class 6', 'Hindi', 'Chapter Teaching', ''),          // old: counts in ay, not in d30
  rec('Unknown Teacher', 2, '2026-10-15', 'Class 3', 'EVS', 'Activity', ''),         // not in roster
  rec('Seema', 3, '2026-10-15', 'Class 3', 'EVS', 'Activity', ''),                    // same name, other campus: not the roster's LMS2 Seema
  rec('Before Year', 0, '2026-03-20', 'Class 1', 'Math', 'Activity', ''),            // before ayStart: ignored
] };
const roster = [{ employeeCode: 'KEL/20/01/001', name: 'SEEMA', school: 'LMS 2' }];
const r = ctx.coordAcademicsAggregate_(feed, roster, now);

const ay = r.ay.teachers, by = {}; ay.forEach((t) => { by[t.key] = t; });
assert.strictEqual(ay.length, 3);                                  // Seema (LMS2), Unknown (LMS3), Seema-at-LMS4 unmatched
const s = by['KEL/20/01/001'];
assert.strictEqual(s.entries, 3);  assert.strictEqual(s.days, 3);  assert.strictEqual(s.matched, true);
assert.strictEqual(s.cwN, 3);      assert.strictEqual(s.hwN, 1);
assert.strictEqual(s.cw['Chapter Teaching'], 2); assert.strictEqual(s.cw['OTT'], 1); assert.strictEqual(s.hw['Revise for OTT'], 1);
assert.strictEqual(s.groups['Class 5 | Math'].n, 2);
assert.strictEqual(s.lastDate, '2026-10-16');
assert.ok(ay.some((t) => !t.matched && t.campus === 'LMS3'));       // unmatched kept, not dropped
assert.ok(ay.some((t) => !t.matched && t.campus === 'LMS4'));       // roster match is per campus
assert.strictEqual(ay.reduce((a, t) => a + t.entries, 0), 5);       // every in-window entry accounted for; the pre-AY one is not
assert.strictEqual(r.d30.teachers.find((t) => t.key === 'KEL/20/01/001').entries, 2);
assert.strictEqual(JSON.stringify(r.ay.tags.cw), JSON.stringify(['Activity', 'Chapter Teaching', 'OTT', 'Question & Answers']));
console.log('coordinator academics: ok');
