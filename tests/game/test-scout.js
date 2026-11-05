// node tests/game/test-scout.js -- 📜 Scout report (game-scout.gs): strip, on time, streak, bars, insights, holidays, scope, rank. Made-up data only.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const dir = __dirname + '/../../apps-script/';
const ctx = { console: Object.assign(Object.create(console), { error() {}, warn() {} }), Logger: { log() {} } };
vm.createContext(ctx);
['game.gs', 'game-windows.gs', 'game-missions.gs', 'game-actions.gs', 'game-scout.gs'].forEach((f) => vm.runInContext(fs.readFileSync(dir + f, 'utf8'), ctx));
const J = (x) => JSON.parse(JSON.stringify(x));
const cfg = (o) => Object.assign(ctx.scoutCfg_([]), o || {});

// Fri 6 Nov 2026, 15:00 IST. IST hh:mm on a day -> ISO
const at = (day, hm) => new Date(Date.parse(day + 'T' + hm + ':00+05:30')).toISOString();
const rep = (campus, day, hm, extra) => Object.assign({ date: day, campus, at: at(day, hm), maClass: '5A', maScore: '', done: 'Rounds', tomorrow: 'Rounds', registers: 'Fee, Attendance', message: '' }, extra || {});
const DAYS = ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'];
const base = (over) => Object.assign({ campus: 'LMS4', today: '2026-11-06', nowHM: '15:00', cfg: cfg(), reports: [], issues: [], actions: {}, merges: {}, repeats: [], tags: {}, holidays: {}, ss: null }, over);
const lms1 = DAYS.concat('2026-11-06').map((d) => rep('LMS1', d, '16:00'));

// ---- 1. strip, on time / late, today waiting, streak
{
  const mine = DAYS.map((d) => rep('LMS4', d, d === '2026-11-04' ? '18:30' : '16:10'));
  const r = J(ctx.scoutCompute_(base({ reports: lms1.concat(mine) })));
  assert.deepStrictEqual(r.strip.map((s) => s.date), ['2026-10-30', '2026-10-31', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'], 'Sunday 1 Nov is skipped; 7 school days');
  assert.deepStrictEqual(r.strip.map((s) => s.state), ['ontime', 'ontime', 'ontime', 'ontime', 'late', 'ontime', 'waiting']);
  assert.deepStrictEqual(r.tally, { ontime: 5, late: 1, missing: 0 });
  assert.strictEqual(r.judged, 6, 'today, not in yet, is not judged');
  assert.strictEqual(r.streak.days, 1, 'Thu on time, Wed late ends it');
  assert.strictEqual(r.strip[4].at, '18:30');
  assert.ok(r.reports['2026-11-05'] && r.reports['2026-11-05'].done === 'Rounds', 'each day carries its text');
  const after = J(ctx.scoutCompute_(base({ nowHM: '17:30', reports: lms1.concat(mine) })));
  assert.strictEqual(after.strip[6].state, 'overdue', 'after 5 pm and nothing in: overdue, still not judged');
  const late = J(ctx.scoutCompute_(base({ cfg: cfg({ dueBy: '19:00' }), reports: lms1.concat(mine) })));
  assert.strictEqual(late.streak.days, 7, 'a later cut-off from Game Config makes Wed on time; streak runs back through all of them');
  assert.strictEqual(late.streak.capped, false, 'the run reached the start of the data: 7, not 7+');
  assert.ok(late.insights.some((i) => i.icon === 'done'), 'all on time -> the done line');
}

// ---- 2. streak lost, missing day, late insight
{
  const mine = DAYS.filter((d) => d !== '2026-11-05').map((d) => rep('LMS4', d, '16:00')).concat(rep('LMS4', '2026-11-06', '14:00'));
  const r = J(ctx.scoutCompute_(base({ reports: lms1.concat(mine) })));
  assert.strictEqual(r.strip[6].state, 'ontime', 'filed today before 5 pm');
  assert.strictEqual(r.strip[5].state, 'missing');
  assert.strictEqual(r.streak.days, 1, 'today counts');
  const lost = J(ctx.scoutCompute_(base({ reports: lms1.concat(mine.slice(0, -1)) })));
  assert.strictEqual(lost.streak.days, 0);
  assert.ok(lost.streak.lost && lost.streak.lostAfter === 6, 'the missing Thu ended a 6-day run (29 Oct to 4 Nov)');
  assert.strictEqual(lost.insights[0].icon, 'streakLost', 'a lost streak is the biggest news');
  assert.ok(lost.insights.some((i) => /1 report missing/.test(i.text)));
}

// ---- 3. holidays: nobody filed on a weekday, a GH calendar day, a 2nd Saturday
{
  const days = DAYS.filter((d) => d !== '2026-11-03');
  const all = days.map((d) => rep('LMS1', d, '16:00')).concat(days.map((d) => rep('LMS4', d, '16:00')));
  const r = J(ctx.scoutCompute_(base({ reports: all })));
  assert.ok(!r.strip.some((s) => s.date === '2026-11-03'), 'no school filed on Tue 3 Nov: closed, not missing');
  assert.strictEqual(r.tally.missing, 0);
  const h = J(ctx.scoutCompute_(base({ reports: lms1, holidays: { '2026-11-05': true } })));
  assert.ok(!h.strip.some((s) => s.date === '2026-11-05'), 'a GH day on the school calendar is skipped');
  assert.strictEqual(ctx.scoutRestDay_('2026-11-14'), true, '2nd Saturday');
  assert.strictEqual(ctx.scoutRestDay_('2026-10-31'), false, '5th Saturday is a school day');
}

// ---- 4. bars: registers not set, then set; issues; SS pace
{
  const mine = DAYS.map((d, i) => rep('LMS4', d, '16:00', { registers: i < 4 ? 'Fee' : 'Fee, Attendance' }));
  const r = J(ctx.scoutCompute_(base({ reports: lms1.concat(mine) })));
  assert.deepStrictEqual(r.bars[0], { id: 'registers', label: 'Registers', pct: null, note: 'not set yet' }, 'no default list: not set yet');
  assert.ok(!r.insights.some((i) => i.icon === 'registers'), 'no register insight while the list is empty');
  const set = J(ctx.scoutCompute_(base({ cfg: cfg({ requiredRegisters: ['Fee', 'attendance'] }), reports: lms1.concat(mine) })));
  assert.strictEqual(set.bars[0].pct, 50, 'Attendance missing on 3 of the 6 judged days');
  assert.ok(set.insights.some((i) => i.text === 'Register "attendance" not checked on 3 days.'));

  const issues = [
    { id: 'a', campus: 'LMS4', subject: 'Bus 3 late', first: '2026-10-20', last: '2026-11-05' },
    { id: 'b', campus: 'LMS4', subject: 'Water cooler', first: '2026-10-25', last: '2026-11-01' },
    { id: 'c', campus: 'LMS4', subject: 'Bus 3 again', first: '2026-10-28', last: '2026-11-02' },
    { id: 'd', campus: 'LMS1', subject: 'Not mine', first: '2026-10-01', last: '2026-11-05' },
    { id: 'e', campus: 'LMS4', subject: 'Old', first: '2026-08-01', last: '2026-08-10' } ];
  const ir = J(ctx.scoutCompute_(base({ reports: lms1.concat(mine), issues, actions: { b: { status: 'resolved', at: '2026-10-28 10:00' } }, merges: { c: 'a' } })));
  const ib = ir.bars.find((b) => b.id === 'issues');
  assert.strictEqual(ib.pct, 50, 'a open, b resolved in 3 days; c merged into a; d another school; e outside 30 days');
  assert.deepStrictEqual(ir.openIssues, [{ id: 'a', subject: 'Bus 3 late', days: 17 }]);
  assert.ok(ir.insights.some((i) => i.text === '"Bus 3 late" still open after 17 days.'));
  assert.strictEqual(r.bars.find((b) => b.id === 'issues').note, 'none raised in 30 days');

  assert.strictEqual(r.bars.find((b) => b.id === 'ss').note, "couldn't check");
  const ss = J(ctx.scoutCompute_(base({ reports: lms1.concat(mine), ss: { done: 6, expected: 8 } })));
  assert.strictEqual(ss.bars.find((b) => b.id === 'ss').pct, 75);
  const pace = ctx.scoutSsPace_({ quotaPerMonth: 4, roster: [{ school: 'LMS 4', submissionsThisMonth: 2 }, { school: 'LMS4', submissionsThisMonth: 1 }, { school: 'LMS1', submissionsThisMonth: 9 }] }, 'LMS4', '2026-11-06');
  assert.strictEqual(pace.done, 3);
  assert.strictEqual(Math.round(pace.expected * 100) / 100, Math.round(8 * 5 / 25 * 100) / 100, 'Nov 2026 has 25 Mon-Sat days; 5 gone by Fri 6');
}

// ---- 5. MA trend, repeats, topics
{
  const mine = DAYS.map((d, i) => rep('LMS4', d, '16:00', { maScore: String([6, 6, 6, 7, 8, 8, 8][i]) }));
  const repeats = DAYS.slice(2).map((d) => ({ date: d, campus: 'LMS4', tasks: '0.8', message: '' }));
  const tags = {}; DAYS.slice(3).forEach((d) => { tags[d + '|LMS4'] = { topics: ['Transport'] }; });
  const r = J(ctx.scoutCompute_(base({ reports: lms1.concat(mine), repeats, tags })));
  const t = r.insights.map((i) => i.text);
  assert.ok(t.includes('Morning assembly score up: 6.3 → 8.'), t.join(' | '));
  assert.ok(t.includes('Mostly the same report repeated on 5 days.'), 'repeats in 0-1 form count: 31 Oct to 5 Nov, all in the strip');
  assert.ok(t.includes('"Transport" came up on 4 days.'));
  assert.ok(r.insights.length <= 5);
}

// ---- 6. scoutCfg_: only the scout row, right types
{
  const c = ctx.scoutCfg_([['Key', 'Value'], ['scout', '{"dueBy":"17:30","requiredRegisters":["Fee"],"days":"9"}'], ['other', '{"dueBy":"1"}']]);
  assert.strictEqual(c.dueBy, '17:30');
  assert.deepStrictEqual(J(c.requiredRegisters), ['Fee']);
  assert.strictEqual(c.days, 7, 'a wrong type keeps the default');
  assert.strictEqual(ctx.scoutCfg_([['Key', 'Value'], ['scout', 'not json']]).dueBy, '17:00');
  assert.strictEqual(ctx.scoutHm_('17:00'), '5 pm');
  assert.strictEqual(ctx.scoutHm_('16:30'), '4:30 pm');
}

// ---- 7. scoutGet_: scope, read-only sheets, rank only for Owner/Coordinator
{
  const sheet = (rows) => ({ getLastRow: () => rows.length, getDataRange: () => ({ getValues: () => rows, getDisplayValues: () => rows.map((r) => r.map(String)) }) });
  const writes = [];
  const drRows = [['Timestamp', 'Date', 'CampusId', 'Email', 'MA', 'Score', 'Done', 'Tomorrow', 'Registers', 'Message']]
    .concat(lms1.concat(DAYS.map((d) => rep('LMS4', d, '16:00'))).map((r) => [new Date(r.at), r.date, r.campus, 'p@example.org', '', '', 'x', 'y', 'Fee', '']));
  const book = { getSheetByName: (n) => (n === 'Daily Reports' ? sheet(drRows) : n === 'Game Config' ? sheet([['Key', 'Value']]) : null),
    insertSheet: () => writes.push('insert') };
  ctx.SpreadsheetApp = { openById: () => book };
  ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: () => 'gamebook' }) };
  ctx.gameNow_ = () => new Date(at('2026-11-06', '15:00'));
  ctx.gameFetchJson_ = () => null;
  let calls = 0;
  ctx.tchCalendarEvents_ = (campus, d) => { calls++; return d === '2026-11-05' && campus === 'LMS4' ? [{ title: 'GH Diwali' }] : []; };
  const P = { email: 'p4@example.org', roles: ['Principal'], primaryRole: 'Principal', campusId: 'LMS4' };
  const own = J(ctx.gameDispatch_(P, 'gamescout', {}));
  assert.strictEqual(own.success, true, own.error);
  assert.strictEqual(own.campus, 'LMS4', 'a Principal gets their own school without asking');
  assert.ok(!own.board && !own.rank && own.score === undefined, 'a Principal never sees a rank or a score');
  assert.ok(own.strip.some((s) => s.date === '2026-11-05'), 'a day the school filed on counts even when the calendar says GH');
  assert.ok(calls > 0, 'the school calendar was read');
  assert.strictEqual(own.issuesGo, 'principal/issues.html');
  assert.strictEqual(J(ctx.gameDispatch_(P, 'gamescout', { campus: 'LMS1' })).error, 'Not authorized', 'another school: refused');
  assert.strictEqual(J(ctx.gameDispatch_(Object.assign({}, P, { roles: ['Teacher'], primaryRole: 'Teacher' }), 'gamescout', { campus: 'LMS4' })).error, 'Not authorized');
  for (const c of ['ALL', '', 'LMS1,LMS4']) assert.strictEqual(J(ctx.gameDispatch_(Object.assign({}, P, { campusId: c }), 'gamescout', { campus: 'LMS1' })).error, 'Not authorized', 'a Principal with campus "' + c + '" gets nothing (fails closed)');
  const O = { email: 'o@example.org', roles: ['Owner'], primaryRole: 'Owner', campusId: 'ALL' };
  assert.strictEqual(J(ctx.gameDispatch_(O, 'gamescout', {})).error, 'Pick a school (LMS1 to LMS6)');
  const ow = J(ctx.gameDispatch_(O, 'gamescout', { campus: 'lms 1' }));
  assert.strictEqual(ow.campus, 'LMS1');
  assert.strictEqual(ow.board.length, 6);
  assert.deepStrictEqual(ow.rank, { pos: 1, of: 6 }, 'LMS1 filed every day on time');
  assert.strictEqual(ow.issuesGo, 'coordinator/systems/index.html');
  assert.strictEqual(ow.board.find((b) => b.campus === 'LMS2').score, 0, 'a school that never filed scores 0');
  const C = { email: 'c@example.org', roles: ['Coordinator'], primaryRole: 'Coordinator', campusId: 'LMS2' };
  assert.ok(J(ctx.gameDispatch_(C, 'gamescout', { campus: 'LMS4' })).rank, 'Coordinators are network-wide and see the rank');
  assert.deepStrictEqual(writes, [], 'nothing written');
}

// ---- 8. scout-report.js helpers (no DOM)
{
  global.window = {};
  require('../../assets/game/scout-report.js');
  const L = global.window.LMCSScout;
  const d = { campus: 'LMS4', today: '2026-11-06', dueBy: '17:00', judged: 6, tally: { ontime: 5, late: 1, missing: 0 }, streak: { days: 1, capped: false, lost: false },
    strip: [{ date: '2026-11-05', label: 'Thu 5', state: 'ontime', at: '16:10' }, { date: '2026-11-06', label: 'Fri 6', state: 'waiting', at: '' }], openIssues: [] };
  assert.strictEqual(L.hm12('16:10'), '4:10 pm');
  assert.strictEqual(L.hm12('09:00'), '9 am');
  assert.deepStrictEqual(J(L.todayLine(d)), { key: 'waiting', text: 'Today: due by 5 pm' });
  assert.deepStrictEqual(J(L.todayLine(Object.assign({}, d, { strip: [{ date: '2026-11-06', state: 'ontime', at: '16:12' }] }))), { key: 'done', text: 'Today: in at 4:12 pm' });
  assert.strictEqual(L.todayLine(Object.assign({}, d, { strip: [{ date: '2026-11-05', state: 'ontime', at: '16:12' }] })).text, 'No school today. Rest well.');
  assert.deepStrictEqual(J(L.streakLine(d)), { key: 'onTrack', text: 'Streak 1 day' });
  assert.deepStrictEqual(J(L.streakLine(Object.assign({}, d, { streak: { lost: true, lostAfter: 6 } }))), { key: 'streakLost', text: 'Streak lost after 6 days. Start again today.' });
  assert.strictEqual(L.buddyLine(d), 'Scout here. 5 of 6 reports on time this week.');
  assert.strictEqual(L.buddyMood(d), 'neutral');
  const emojiKeys = fs.readFileSync(__dirname + '/../../assets/game/emoji.js', 'utf8');
  for (const k of Object.values(L.KEY)) assert.ok(new RegExp('\\b' + k + ": '").test(emojiKeys), 'strip key ' + k + ' is an existing LMCSEmoji key');
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u2600-\u27BF\u2B1C\u231B\u23F0\u23F3]/u.test(fs.readFileSync(__dirname + '/../../assets/game/scout-report.js', 'utf8').replace(/^\s*\/\/.*$/gm, '')), 'no emoji literals in scout-report.js (LMCSEmoji keys only)');
  assert.strictEqual(L.buddyMood(Object.assign({}, d, { tally: { ontime: 6, late: 0, missing: 0 } })), 'celebrate');
  assert.strictEqual(L.nudgeText(d), 'LMS 4: 1 filed late. Please take a look.', 'before 5 pm today is not chased');
  const od = Object.assign({}, d, { strip: [d.strip[0], Object.assign({}, d.strip[1], { state: 'overdue' })] });
  assert.strictEqual(L.nudgeText(od), "LMS 4: today's daily report is not in yet (due 5 pm); 1 filed late. Please take a look.");
  assert.strictEqual(L.nudgeText(Object.assign({}, d, { tally: { ontime: 6, late: 0, missing: 0 }, streak: { days: 6 } }), 'Ner Chowk'), 'Shabash Ner Chowk! Daily reports all on time, 6-day streak. Keep it going.');
  assert.strictEqual(L.dayLabel(d.strip[0]), 'Thu 5, on time, last saved 4:10 pm');
}

console.log('test-scout: all passed');
