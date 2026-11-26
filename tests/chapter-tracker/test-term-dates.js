// node tests/chapter-tracker/test-term-dates.js -- termDatesReport (ChapterTracker.gs): codes and dates only, "not found" on a miss, no writes
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const log = [];
const cal = (events) => ({ getEvents: (a, b) => events.filter((e) => e.s >= a && e.s < b).map((e) => ({ getTitle: () => e.t, getStartTime: () => e.s })) });
const T1 = { t: 'Term 1 Revision', s: new Date(2026, 8, 18) }, B = { t: 'Board Term 1 Exam', s: new Date(2026, 6, 11) };
const cals = {};
const ctx = { Logger: { log: (m) => log.push(m) }, Utilities: { formatDate: (d) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10) },
  CalendarApp: { getCalendarById: (id) => cals[id] || null } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../../apps-script/ChapterTracker.gs', 'utf8'), ctx);
cals[vm.runInContext('CHAPTER_CALENDAR_IDS[1]', ctx)] = cal([T1, B]); // only LMS1 has events
ctx.termDatesReport(2026);
assert.ok(/LMS1 {2}T1=2026-09-17 {2}T2=not found {2}\| board T1=2026-07-10 {2}T2=not found/.test(log[1]), log[1]);
assert.ok(/LMS5 {2}T1=not found/.test(log[5]) && log.length === 7, log.join('\n'));
console.log('term dates: ok');
