// node tests/game/test-actions.js -- gametoday / gamedecide / gametourseen against fake Apps Script services
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const J = (x) => JSON.parse(JSON.stringify(x));

// ── fakes ──────────────────────────────────────────────────────────────
function fakeSheet(rows) {
  const sh = {
    rows: rows.map((r) => r.slice()), formats: [],
    getDataRange: () => ({ getValues: () => sh.rows.map((r) => r.slice()) }),
    getLastRow: () => sh.rows.length,
    appendRow: (r) => { sh.rows.push(r.slice()); },
    getRange: (row, col, nr, nc) => {
      const rg = {
        setNumberFormat: (f) => { sh.formats.push({ row, col, nr: nr || 1, nc: nc || 1, f }); return rg; },
        setValues: (vals) => {
          vals.forEach((v, i) => { const r = sh.rows[row - 1 + i] = sh.rows[row - 1 + i] || []; v.forEach((x, j) => { r[col - 1 + j] = x; }); });
          return rg;
        },
        setValue: (v) => rg.setValues([[v]]),
      };
      return rg;
    },
  };
  return sh;
}

const NOW = '2026-11-05T05:00:00Z'; // Thu 5 Nov 2026, 10:30 IST -> game day 2026-11-05
const P4 = { email: 'p4@lms.org.in', campusId: 'LMS4', roles: ['Principal'], primaryRole: 'Principal', canDecide: false };
const COORD = { email: 'c@lms.org.in', campusId: 'ALL', roles: ['Coordinator'], primaryRole: 'Coordinator', canDecide: false };
const OWNER = { email: 'o@lms.org.in', campusId: 'ALL', roles: ['Owner'], primaryRole: 'Owner', canDecide: true };

function setup(opts) {
  opts = opts || {};
  const ctx = { console, JSON };
  vm.createContext(ctx);
  for (const f of ['game-quests.gs', 'game.gs', 'game-actions.gs', 'game-missions.gs', 'game-windows.gs']) vm.runInContext(fs.readFileSync(__dirname + '/../../apps-script/' + f, 'utf8'), ctx);
  // these tests pin a three-campus pilot (LMS4-6) so the outside-the-pilot paths stay covered; the shipped default is all six
  vm.runInContext("var gameConfigDefaults0_ = gameConfigDefaults_; gameConfigDefaults_ = function () { var d = gameConfigDefaults0_(); d.pilotCampuses.Principal = ['LMS4', 'LMS5', 'LMS6']; d.pilotCampuses.Coordinator = ['LMS4', 'LMS5', 'LMS6']; return d; };", ctx);
  const T = vm.runInContext('GAME_TABS', ctx);
  const win = (o) => T['Game Windows'].map((h) => (o && h in o ? o[h] : {
    WindowId: 'trackSuit', Title: "Choose your campus's track-suit days", Question: 'Which 3 days?', Scope: 'campus', ScopeId: '*', Decider: 'Principal',
    Choice: '{"type":"pickN","n":3,"options":["Mon","Tue","Wed","Thu","Fri","Sat"]}', DefaultIfUndecided: '["Mon","Wed","Fri"]',
    Opens: '2026-11-01', Closes: '2026-11-08', AppliesFrom: '2026-11-10', Writes: 'trackSuitDays', OpenedBy: '', ConfirmBy: '',
  }[h]));
  const game = {
    'Game Config': fakeSheet([T['Game Config'], ['trackSuitDays', '{}']].concat(opts.config || [])),
    'Game Daily': fakeSheet([T['Game Daily']].concat(opts.daily || [])),
    'Game Progress': fakeSheet([T['Game Progress']]),
    'Game Windows': fakeSheet([T['Game Windows'], win(opts.window)]),
    'Game Decisions': fakeSheet([T['Game Decisions']]),
    'Game Quests': fakeSheet([T['Game Quests']].concat(ctx.gameQuestSeedRows_())),
  };
  const AH = ['Id', 'Campus', '', '', 'Title', '', '', '', '', '', '', 'RequestedBy', 'RequestedAt', 'Status', 'DecidedBy', 'DecidedAt', '', '', 'Archived'];
  const appr = (id, campus, by, status) => [id, campus, '', '', 'Projector for ' + id, '', '', '', '', '', '', by, '2026-10-20T05:00:00Z', status, '', '', '', '', ''];
  const task = (id, domain, campus, assignee) => [id, domain, campus, 'Task ' + id, 'why ' + id, 'open', '', '', '', '', '', '', '', assignee, ''];
  const books = {
    GAMEBOOK: game,
    '1Tr4Rfc6DN698eeGVjuCoXfSRR-NhBTWJibR00Ibj6P4': {
      Approvals: fakeSheet([AH, appr('A1', 'LMS 4', 'p4@lms.org.in', 'Info Requested'), appr('A2', 'LMS 5', 'x@lms.org.in', 'Pending')]),
      Tasks: fakeSheet([['TaskId'], task('t1', 'followup', 'LMS4', 'c@lms.org.in'), task('t2', 'followup', 'LMS2', 'c@lms.org.in')]),
    },
    '1GzGdakmjjkou0GGgljY6ugXvOM21MLkyeyc85Ke3i1Y': {
      'Daily Reports': fakeSheet([['Timestamp', 'Date', 'CampusId']]),
      'PDR Issue Actions': fakeSheet([['Issue id', 'Status', 'Assignee email', 'Assignee name', 'Note', 'Updated by', 'Updated at', 'CampusId'],
        ['i1', 'assigned', 'a@x', 'A', 'Sent the plumber', 'C@lms.org.in', '2026-11-04', 'LMS4'],
        ['i2', 'acknowledged', '', '', 'seen', 'c@lms.org.in', '2026-11-04', 'LMS4']]),
    },
  };
  const ss = { success: true, quotaPerMonth: 4, roster: [{ school: 'LMS 4', submissionsThisMonth: 1, history: [] }] };
  const fetches = [];
  const cache = {};
  ctx.SpreadsheetApp = { openById: (id) => {
    if (!books[id]) throw new Error('no such workbook ' + id);
    return { getSheetByName: (n) => books[id][n] || null };
  } };
  ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => (k === 'GAME_SHEET_ID' ? 'GAMEBOOK' : null) }) };
  ctx.CacheService = { getScriptCache: () => ({ get: (k) => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; } }) };
  const lock = { held: 0, waits: 0 };
  ctx.LockService = { getScriptLock: () => ({ waitLock: () => { lock.waits++; lock.held++; }, releaseLock: () => { lock.held--; } }) };
  ctx.Utilities = { DigestAlgorithm: { MD5: 'md5' }, computeDigest: (a, s) => Array.from(Buffer.from(String(s))), base64EncodeWebSafe: (b) => Buffer.from(b).toString('base64') };
  ctx.UrlFetchApp = { fetch: (url, o) => {
    fetches.push({ url, o });
    const fail = (opts.down || []).some((a) => url.indexOf('action=' + a) !== -1);
    const body = url.indexOf('action=ssdashboard') !== -1 ? ss : { success: true, issues: [] };
    return { getResponseCode: () => (fail ? 500 : 200), getContentText: () => (fail ? '<html>error</html>' : JSON.stringify(body)) };
  } };
  ctx.ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ text: s, setMimeType() { return this; } }) };
  ctx.gameNow_ = () => vm.runInContext("new Date('" + (opts.now || NOW) + "')", ctx);
  const call = (caller, action, params) => J(ctx.gameDispatch_(caller, action, Object.assign({ idToken: 'tok' }, params || {})));
  return { ctx, game, books, fetches, cache, lock, call, T };
}

const dailyRow = (day, email, ids, coreIds, role) => [day, email, role || 'Principal', 'LMS4', JSON.stringify(ids), '[]', '', '', '2026-11-04T05:00:00Z', JSON.stringify(coreIds || [])];

// ── gametoday: first load creates the snapshot, the second reuses it ─────
{
  const t = setup();
  const a = t.call(P4, 'gametoday');
  assert.strictEqual(a.success, true);
  assert.strictEqual(a.firstLoadToday, true);
  assert.strictEqual(a.day, '2026-11-05');
  assert.strictEqual(a.role, 'Principal');
  assert.strictEqual(a.campus, 'LMS4');
  assert.strictEqual(a.speaker, 'buddy');
  assert.deepStrictEqual(a.sourcesDown, []);
  const ids = a.missions.map((m) => m.id);
  assert.deepStrictEqual(ids, ['ss_pace:LMS4:2026-11-05', 'pdr_report:LMS4:2026-11-05', 'info_requested:A1']); // core first, then source order
  assert.ok(a.missions[0].title && a.missions[0].title.indexOf('Submit') === 0); // titles in the response...
  assert.strictEqual(a.next.id, 'ss_pace:LMS4:2026-11-05');
  const daily = t.game['Game Daily'].rows;
  assert.strictEqual(daily.length, 2);
  assert.deepStrictEqual(daily[1].slice(0, 8), ['2026-11-05', 'p4@lms.org.in', 'Principal', 'LMS4', JSON.stringify(ids), '[]', '', '']);
  assert.deepStrictEqual(JSON.parse(daily[1][9]), ['ss_pace:LMS4:2026-11-05']); // CoreIds: the core, non-shared ids picked
  assert.ok(JSON.stringify(daily).indexOf('SS evaluations') === -1);                    // ...never in the workbook
  assert.ok(t.game['Game Daily'].formats.some((f) => f.row === 2 && f.col === 1 && f.f === '@')); // Day stored as plain text
  assert.strictEqual(t.lock.held, 0);
  assert.ok(t.lock.waits >= 1);
  assert.deepStrictEqual(a.config.trackSuitDays, {});
  assert.ok(a.config.uniform && a.config.uniform.winterFrom);
  assert.deepStrictEqual(a.daysOnTrack, { onTrack: 0, counted: 0, lastMonthOnTrack: 0, lastMonthCounted: 0, showDenominator: true });
  assert.deepStrictEqual(a.windows.map((w) => w.windowId + '|' + w.scopeId), ['trackSuit|LMS4']); // open window for the Principal
  assert.strictEqual(a.board, undefined);
  assert.strictEqual(a.quests[0].questId, 'principal1');
  assert.deepStrictEqual(a.toursSeen, []);
  // PDR ssdashboard with the caller's token, cached per (url, email)
  assert.strictEqual(t.fetches.length, 1);
  assert.ok(t.fetches[0].url.indexOf('AKfycbzpkFLy4KvTdSJfioz6wlgRGLjvO_GvbffhOYBb-hHybFtjGTk0ps-GzXz0FrQ9GmYdfg/exec?action=ssdashboard&idToken=tok') !== -1);
  assert.strictEqual(t.fetches[0].o.muteHttpExceptions, true);

  const b = t.call(P4, 'gametoday');
  assert.strictEqual(b.firstLoadToday, false);
  assert.deepStrictEqual(b.missions.map((m) => m.id), ids);
  assert.strictEqual(t.game['Game Daily'].rows.length, 2); // no second snapshot
  assert.strictEqual(t.fetches.length, 1);                 // served from the cache

  // a mission finished later in the day stays in the set, done; next moves on
  t.books['1GzGdakmjjkou0GGgljY6ugXvOM21MLkyeyc85Ke3i1Y']['Daily Reports'].rows.push(['2026-11-05T06:00:00Z', '2026-11-05', 'LMS4']);
  const c = t.call(P4, 'gametoday');
  assert.deepStrictEqual(c.missions.map((m) => m.id), ids);
  assert.strictEqual(c.missions[1].done, true);
  assert.strictEqual(c.next.id, 'ss_pace:LMS4:2026-11-05');
}

// ── a failed source: other missions still present, earlier days stay unfinalized (R15) ─
{
  const t = setup({ down: ['ssdashboard'], daily: [dailyRow('2026-11-04', 'p4@lms.org.in', ['ss_pace:LMS4:2026-11-05'])] });
  const a = t.call(P4, 'gametoday');
  assert.deepStrictEqual(a.sourcesDown, ['ssdashboard']);
  assert.deepStrictEqual(a.missions.map((m) => m.id), ['pdr_report:LMS4:2026-11-05', 'info_requested:A1']);
  const y = t.game['Game Daily'].rows[1];
  assert.strictEqual(y[6], '');  // Finalized left blank: retried next load
  assert.strictEqual(y[7], '');
  assert.deepStrictEqual(Object.keys(t.cache), []); // a failure is never cached
  // R24: no snapshot while a source is down; the live list is shown, without the greeting
  assert.strictEqual(a.firstLoadToday, false);
  assert.strictEqual(t.game['Game Daily'].rows.length, 2);
  assert.ok(t.game['Game Daily'].rows.every((r) => r[0] !== '2026-11-05'));
  assert.strictEqual(a.next.id, 'pdr_report:LMS4:2026-11-05');
  // the first healthy load creates it, with the core mission from the recovered source
  t.ctx.UrlFetchApp.fetch = () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ success: true, quotaPerMonth: 4, roster: [{ school: 'LMS 4', submissionsThisMonth: 1, history: [] }] }) });
  const b = t.call(P4, 'gametoday');
  assert.strictEqual(b.firstLoadToday, true);
  assert.deepStrictEqual(b.sourcesDown, []);
  assert.strictEqual(b.missions[0].id, 'ss_pace:LMS4:2026-11-05');
  const today = t.game['Game Daily'].rows.filter((r) => r[0] === '2026-11-05');
  assert.strictEqual(today.length, 1);
  assert.ok(today[0][4].indexOf('ss_pace:LMS4:2026-11-05') !== -1);
}

// ── R23: ssdashboard is cached as a trimmed projection, so a big response still fits the 100 KB cap ──
{
  const t = setup();
  const hist = (who, at) => ({ timestamp: at, evaluatorEmail: who, employeeName: 'Somebody Long Name', remarks: 'x'.repeat(200), scores: [1, 2, 3, 4, 5] });
  const roster = [];
  for (let i = 0; i < 400; i++) {
    const all = [hist('other@lms.org.in', '2026-11-05T04:00:00Z'), hist('p4@lms.org.in', '2026-11-04T04:00:00Z'), hist('p4@lms.org.in', '2026-11-05T04:00:00Z')];
    roster.push({ school: i % 2 ? 'LMS 4' : 'LMS 5', employeeName: 'Employee ' + i, designation: 'TGT', submissionsThisMonth: i % 2 ? 0 : 4, // LMS4 far behind: ss_pace stays open
      history: i < 2 ? all : all.slice(0, 1) });
  }
  const big = { success: true, roles: { teaching: { label: 'Teaching', quotaPerMonth: 4, monthLabel: 'Nov', campusCompliance: [], roster } } };
  const bigText = JSON.stringify(big);
  assert.ok(bigText.length > 100000);
  t.ctx.UrlFetchApp.fetch = (url) => { t.fetches.push({ url }); return { getResponseCode: () => 200, getContentText: () => bigText }; };
  const full = J(t.ctx.gamePrincipalMissions_(P4, { ss: big }, t.ctx.gameParseConfig_([['Key', 'Value']]), t.ctx.gameNow_()));
  const a = t.call(P4, 'gametoday');
  const keys = Object.keys(t.cache);
  assert.strictEqual(keys.length, 1);
  const cached = t.cache[keys[0]];
  assert.ok(cached.length < 100000, 'cached ' + cached.length + ' chars');
  const c = JSON.parse(cached);
  assert.deepStrictEqual(Object.keys(c.roles.teaching).sort(), ['quotaPerMonth', 'roster']);
  assert.deepStrictEqual(Object.keys(c.roles.teaching.roster[1]).sort(), ['history', 'school', 'submissionsThisMonth']);
  assert.deepStrictEqual(c.roles.teaching.roster[1].history, [{ timestamp: '2026-11-05T04:00:00Z', evaluatorEmail: 'p4@lms.org.in' }]); // today's, this caller's
  assert.deepStrictEqual(c.roles.teaching.roster[2].history, []);
  const ssFull = full.find((m) => m.kind === 'ss_pace');
  assert.ok(ssFull && !ssFull.done && ssFull.progress.done === 2);
  assert.deepStrictEqual(a.missions.find((m) => m.kind === 'ss_pace'), Object.assign({}, ssFull, { rolledOver: false })); // same mission from trimmed data
  t.call(P4, 'gametoday');
  assert.strictEqual(t.fetches.length, 1); // second load: from the cache
}
{
  // earlier days, sources up: finalized. info_requested (core here) still open -> counted, not on track; it rolls over.
  // Yesterday's ss_pace is day-scoped: today's is a new mission, never "from yesterday".
  const t = setup({ config: [['core', '{"Principal":["ss_pace","info_requested"]}']],
    daily: [dailyRow('2026-11-04', 'p4@lms.org.in', ['ss_pace:LMS4:2026-11-04', 'info_requested:A1'], ['ss_pace:LMS4:2026-11-04', 'info_requested:A1']), dailyRow('2026-11-03', 'p4@lms.org.in', ['info_requested:GONE'], ['info_requested:GONE'])] });
  const a = t.call(P4, 'gametoday');
  const rows = t.game['Game Daily'].rows;
  assert.strictEqual(String(rows[1][6]).toUpperCase(), 'TRUE');
  assert.strictEqual(String(rows[1][7]).toUpperCase(), 'FALSE');
  assert.strictEqual(String(rows[2][6]).toUpperCase(), 'TRUE'); // only a gone (archived) request that day: nothing to count
  assert.strictEqual(rows[2][7], '');
  assert.deepStrictEqual(a.missions.map((m) => m.id + ':' + m.rolledOver), ['info_requested:A1:true', 'ss_pace:LMS4:2026-11-05:false', 'pdr_report:LMS4:2026-11-05:false']);
  assert.deepStrictEqual(a.daysOnTrack, { onTrack: 0, counted: 1, lastMonthOnTrack: 0, lastMonthCounted: 0, showDenominator: true });
  const again = t.call(P4, 'gametoday'); // finalized rows are not touched again
  assert.strictEqual(again.daysOnTrack.counted, 1);
}

// ── C1: a day-scoped ss_pace finished later in the day makes the day on track, and is never "from yesterday" ──
{
  const t = setup({ now: '2026-11-05T05:00:00Z' }); // Thu 5 Nov
  let cur = { success: true, quotaPerMonth: 4, roster: [{ school: 'LMS 4', submissionsThisMonth: 3, history: [] }] };
  t.ctx.UrlFetchApp = { fetch: (url) => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify(url.indexOf('ssdashboard') !== -1 ? cur : { success: true, issues: [] }) }) };
  const clear = () => Object.keys(t.cache).forEach((k) => delete t.cache[k]);
  const a = t.call(P4, 'gametoday');
  assert.deepStrictEqual(a.missions.map((m) => m.id + ':' + m.done), ['ss_pace:LMS4:2026-11-05:false', 'pdr_report:LMS4:2026-11-05:false', 'info_requested:A1:false']);
  clear();
  cur = { success: true, quotaPerMonth: 4, roster: [{ school: 'LMS 4', submissionsThisMonth: 4, history: [{ timestamp: '2026-11-05T04:00:00Z', evaluatorEmail: 'p4@lms.org.in' }] }] };
  const b = t.call(P4, 'gametoday');
  assert.strictEqual(b.missions[0].done, true);
  const day1 = t.game['Game Daily'].rows[1];
  assert.deepStrictEqual(JSON.parse(day1[5]), ['ss_pace:LMS4:2026-11-05']); // DoneIds: the done, non-shared snapshot ids
  assert.ok(t.game['Game Daily'].formats.some((f) => f.row === 2 && f.col === 6 && f.f === '@'));
  t.call(P4, 'gametoday');
  assert.deepStrictEqual(JSON.parse(t.game['Game Daily'].rows[1][5]), ['ss_pace:LMS4:2026-11-05']); // kept, not duplicated
  // day 2 (Fri 6 Nov, 08:30 IST): yesterday is on track; today's ss_pace is a fresh mission
  clear();
  cur = { success: true, quotaPerMonth: 5, roster: [{ school: 'LMS 4', submissionsThisMonth: 4, history: [] }] };
  t.ctx.gameNow_ = () => vm.runInContext("new Date('2026-11-06T03:00:00Z')", t.ctx);
  const c = t.call(P4, 'gametoday');
  const y = t.game['Game Daily'].rows[1];
  assert.strictEqual(String(y[6]).toUpperCase(), 'TRUE');
  assert.strictEqual(String(y[7]).toUpperCase(), 'TRUE');
  const ss = c.missions.find((m) => m.kind === 'ss_pace');
  assert.strictEqual(ss.id, 'ss_pace:LMS4:2026-11-06');
  assert.strictEqual(ss.rolledOver, false);
  assert.strictEqual(c.missions.find((m) => m.id === 'info_requested:A1').rolledOver, true); // still open: carried
  assert.deepStrictEqual(c.daysOnTrack, { onTrack: 1, counted: 1, lastMonthOnTrack: 0, lastMonthCounted: 0, showDenominator: true });
}

{
  // R34: an undone day-scoped core mission (yesterday's ss_pace, gone this morning, not in DoneIds) -> counted, not on track.
  // A missing id that is not day-scoped (an archived request) stays gone (R9).
  const t = setup({ config: [['core', '{"Principal":["ss_pace","info_requested"]}']],
    daily: [dailyRow('2026-11-04', 'p4@lms.org.in', ['ss_pace:LMS4:2026-11-04'], ['ss_pace:LMS4:2026-11-04']), dailyRow('2026-11-03', 'p4@lms.org.in', ['info_requested:GONE'], ['info_requested:GONE'])] });
  const a = t.call(P4, 'gametoday');
  const rows = t.game['Game Daily'].rows;
  assert.strictEqual(String(rows[1][6]).toUpperCase(), 'TRUE');
  assert.strictEqual(String(rows[1][7]).toUpperCase(), 'FALSE');
  assert.strictEqual(rows[2][7], '');
  assert.strictEqual(a.missions.find((m) => m.kind === 'ss_pace').rolledOver, false); // today's is a new mission
  assert.deepStrictEqual(a.daysOnTrack, { onTrack: 0, counted: 1, lastMonthOnTrack: 0, lastMonthCounted: 0, showDenominator: true });
}

// ── a module mission with a namespaced id (teacher:<kind>:<code>:<day>) is judged from the snapshot's CoreIds, not its parsed kind ──
{
  const TEACHER = { email: 't@lms.org.in', campusId: 'LMS4', roles: ['Teacher'], primaryRole: 'Teacher', canDecide: false };
  const id = 'teacher:cwhw_log:T1:2026-11-04';
  const mk = (extra) => Object.assign({ id, kind: 'cwhw_log', title: 'Log', why: '', owner: 't@lms.org.in', campus: 'LMS4', go: 'teacher/', due: null, core: true, shared: false, done: false, doneAt: null, doneBy: null, rolledOver: false, gone: false }, extra);
  const run = (doneIds, live) => {
    const t = setup({ daily: [dailyRow('2026-11-04', 't@lms.org.in', [id], [id], 'Teacher')] });
    t.game['Game Daily'].rows[1][5] = JSON.stringify(doneIds);
    t.ctx.GAME_MODULE_MISSIONS.Teacher = () => live;
    t.call(TEACHER, 'gametoday');
    return t.game['Game Daily'].rows[1];
  };
  let y = run([id], []); // done on the day (DoneIds), gone this morning
  assert.strictEqual(String(y[6]).toUpperCase(), 'TRUE');
  assert.strictEqual(String(y[7]).toUpperCase(), 'TRUE');
  y = run([], []);       // not done, day-scoped, gone: missed (R34)
  assert.strictEqual(String(y[7]).toUpperCase(), 'FALSE');
  // GAME_MODULE_DONE_AT: a module whose source keeps history says when a core id not in DoneIds was done
  const withHook = (fn) => {
    const t = setup({ daily: [dailyRow('2026-11-04', 't@lms.org.in', [id], [id], 'Teacher')] });
    t.ctx.GAME_MODULE_MISSIONS.Teacher = () => [];
    if (fn) t.ctx.GAME_MODULE_DONE_AT.Teacher = fn;
    t.call(TEACHER, 'gametoday');
    return String(t.game['Game Daily'].rows[1][7]).toUpperCase();
  };
  const seen = [];
  assert.strictEqual(withHook((c, i) => { seen.push(c.email + '|' + i); return Date.parse('2026-11-04T10:00:00Z'); }), 'TRUE'); // before 04:00 IST next day
  assert.deepStrictEqual(seen, ['t@lms.org.in|' + id]);
  assert.strictEqual(withHook(() => Date.parse('2026-11-04T23:00:00Z')), 'FALSE');  // after the cutoff: counted, late
  assert.strictEqual(withHook(() => null), 'FALSE');                                 // null: falls through to R34
  assert.strictEqual(withHook(() => { throw new Error('sheet down'); }), 'FALSE');   // a throw is null
  assert.strictEqual(withHook(null), 'FALSE');                                       // none registered: unchanged
  { // an id already in DoneIds never calls the hook
    const t = setup({ daily: [dailyRow('2026-11-04', 't@lms.org.in', [id], [id], 'Teacher')] });
    t.game['Game Daily'].rows[1][5] = JSON.stringify([id]);
    t.ctx.GAME_MODULE_MISSIONS.Teacher = () => [];
    t.ctx.GAME_MODULE_DONE_AT.Teacher = () => { throw new Error('should not be called'); };
    t.call(TEACHER, 'gametoday');
    assert.strictEqual(String(t.game['Game Daily'].rows[1][7]).toUpperCase(), 'TRUE');
  }
  // a new Teacher snapshot records its core ids
  const t = setup();
  t.ctx.GAME_MODULE_MISSIONS.Teacher = () => [mk({ id: 'teacher:cwhw_log:T1:2026-11-05' }), mk({ id: 'teacher:x:T1', core: false }), mk({ id: 'teacher:s:T1', shared: true })];
  t.call(TEACHER, 'gametoday');
  assert.deepStrictEqual(JSON.parse(t.game['Game Daily'].rows[1][9]), ['teacher:cwhw_log:T1:2026-11-05']);
}
{
  // a snapshot whose only ids are non-core: nothing to count, OnTrack blank
  const t = setup({ daily: [dailyRow('2026-11-04', 'p4@lms.org.in', ['info_requested:A1', 'pdr_report:LMS4:2026-11-04'], [])] });
  t.call(P4, 'gametoday');
  const y = t.game['Game Daily'].rows[1];
  assert.strictEqual(String(y[6]).toUpperCase(), 'TRUE');
  assert.strictEqual(y[7], '');
}

// ── pilot gate and roles without missions ───────────────────────────────
{
  const t = setup();
  assert.deepStrictEqual(t.call(Object.assign({}, P4, { email: 'p2@lms.org.in', campusId: 'LMS2' }), 'gametoday'), { success: true, notYet: true });
  assert.deepStrictEqual(t.call({ email: 'f@lms.org.in', campusId: 'LMS4', roles: ['Fee Clerk'], primaryRole: 'Fee Clerk', canDecide: false }, 'gametoday'), { success: true, notYet: true });
  assert.deepStrictEqual(t.call({ email: 't@lms.org.in', campusId: 'LMS4', roles: ['Teacher'], primaryRole: 'Teacher', canDecide: false }, 'gametoday'), { success: true, notYet: true }); // no Teacher module yet
  assert.strictEqual(t.game['Game Daily'].rows.length, 1);
  assert.strictEqual(t.fetches.length, 0);
}
{
  // a Teacher module registers missions and quests; Teachers get the Teacher Owl
  const t = setup();
  t.ctx.GAME_MODULE_MISSIONS.Teacher = () => [{ id: 'cw:1', kind: 'cw', title: 'Class work for 5A', why: '', owner: 't@lms.org.in', campus: 'LMS4', go: 'teacher/', due: null, core: false, shared: false, done: false, doneAt: null, doneBy: null, rolledOver: false, gone: false }];
  t.ctx.GAME_MODULE_QUESTS.Teacher = () => [{ questId: 'teacher1', title: 'Your class', steps: [], complete: false, reward: '' }];
  const a = t.call({ email: 't@lms.org.in', campusId: 'LMS4', roles: ['Teacher'], primaryRole: 'Teacher', canDecide: false }, 'gametoday');
  assert.strictEqual(a.speaker, 'teacher-owl');
  assert.deepStrictEqual(a.missions.map((m) => m.id), ['cw:1']);
  assert.deepStrictEqual(a.quests.map((q) => q.questId), ['teacher1']);
  assert.strictEqual(a.daysOnTrack.showDenominator, false);
}
{
  // Coordinator: always in, missions only for pilot campuses; issue actions feed the quest; the step is recorded once
  const t = setup();
  const a = t.call(COORD, 'gametoday');
  assert.deepStrictEqual(a.missions.map((m) => m.id), ['followup:t1']); // t2 is at LMS2, outside the Coordinator pilot
  assert.deepStrictEqual(a.board.map((b) => b.scopeId + ':' + b.state), ['LMS4:waiting', 'LMS5:waiting', 'LMS6:waiting']);
  const q = a.quests[0];
  assert.strictEqual(q.questId, 'coordinator1');
  assert.strictEqual(q.steps.find((s) => s.id === 'issueact').done, true);
  const prog = () => t.game['Game Progress'].rows.slice(1);
  assert.deepStrictEqual(prog().map((r) => r.slice(0, 4)), [['c@lms.org.in', 'quest_step', 'coordinator1:issueact', 'done']]);
  t.call(COORD, 'gametoday');
  assert.strictEqual(prog().length, 1);
  assert.ok(JSON.stringify(t.game).indexOf('Sent the plumber') === -1); // issue notes are only counted, never stored
}

{
  // I3: no PDR Issue Actions tab yet is an empty source, not an outage
  const t = setup();
  delete t.books['1GzGdakmjjkou0GGgljY6ugXvOM21MLkyeyc85Ke3i1Y']['PDR Issue Actions'];
  const a = t.call(COORD, 'gametoday');
  assert.deepStrictEqual(a.sourcesDown, []);
  assert.strictEqual(a.firstLoadToday, true);
}

// ── gamedecide ─────────────────────────────────────────────────────────
{
  const t = setup();
  const bad = t.call(P4, 'gamedecide', { windowId: 'trackSuit', scopeId: 'LMS4', value: ['Mon', 'Wed'], note: '' });
  assert.deepStrictEqual(bad, { success: false, error: 'Pick exactly 3 days.' });
  assert.strictEqual(t.game['Game Decisions'].rows.length, 1);
  assert.deepStrictEqual(t.game['Game Config'].rows[1], ['trackSuitDays', '{}']);
  assert.deepStrictEqual(t.call(P4, 'gamedecide', { windowId: 'nope', scopeId: 'LMS4', value: ['Mon', 'Wed', 'Fri'] }).success, false);
  assert.strictEqual(t.game['Game Decisions'].rows.length, 1);
  assert.strictEqual(t.lock.held, 0);

  const ok = t.call(P4, 'gamedecide', { windowId: 'trackSuit', scopeId: 'LMS4', value: ['Tue', 'Thu', 'Sat'], note: 'Sports days' });
  assert.deepStrictEqual(ok, { success: true });
  const d = t.game['Game Decisions'].rows;
  assert.strictEqual(d.length, 2);
  assert.deepStrictEqual(d[1], ['trackSuit', 'LMS4', '["Tue","Thu","Sat"]', 'Sports days', 'p4@lms.org.in', '2026-11-05T05:00:00.000Z', 'decided']);
  assert.deepStrictEqual(JSON.parse(t.game['Game Config'].rows[1][1]), { LMS4: ['Tue', 'Thu', 'Sat'] });
  assert.strictEqual(t.lock.held, 0);
  // a second decision is refused with the validator's message
  assert.strictEqual(t.call(P4, 'gamedecide', { windowId: 'trackSuit', scopeId: 'LMS4', value: ['Mon', 'Wed', 'Fri'] }).error, 'Already decided on Thu 5 Nov. The Owner can change it.');
  // the Owner overrides; a missing config row is created
  const t2 = setup();
  t2.game['Game Config'].rows.splice(1, 1);
  assert.deepStrictEqual(t2.call(OWNER, 'gamedecide', { windowId: 'trackSuit', scopeId: 'LMS5', value: ['Mon', 'Tue', 'Wed'] }), { success: true });
  assert.strictEqual(t2.game['Game Decisions'].rows[1][6], 'override');
  assert.deepStrictEqual(t2.game['Game Config'].rows[1][0], 'trackSuitDays');
  assert.deepStrictEqual(JSON.parse(t2.game['Game Config'].rows[1][1]), { LMS5: ['Mon', 'Tue', 'Wed'] });
  // the response's config reflects it
  assert.deepStrictEqual(t.call(P4, 'gametoday').config.trackSuitDays, { LMS4: ['Tue', 'Thu', 'Sat'] });
  // through doPost (the HTTP path), with the caller check stubbed
  const t4 = setup();
  t4.ctx.gameVerifyCaller_ = (tok) => (tok === 'tok' ? P4 : null);
  const out = JSON.parse(t4.ctx.doPost({ postData: { contents: JSON.stringify({ idToken: 'tok', action: 'gamedecide', windowId: 'trackSuit', scopeId: 'LMS4', value: ['Mon'] }) } }).text);
  assert.deepStrictEqual(out, { success: false, error: 'Pick exactly 3 days.' });
  // a formula-looking note is stored as text
  const t3 = setup();
  t3.call(P4, 'gamedecide', { windowId: 'trackSuit', scopeId: 'LMS4', value: ['Mon', 'Wed', 'Fri'], note: '=HYPERLINK("x")' });
  assert.strictEqual(t3.game['Game Decisions'].rows[1][3], "'=HYPERLINK(\"x\")");
}

// ── defaults for closed windows: applied lazily, once ───────────────────
{
  const t = setup({ window: { Opens: '2026-10-25', Closes: '2026-11-01' } });
  const a = t.call(P4, 'gametoday');
  t.call(P4, 'gametoday');
  t.call(OWNER, 'gametoday');
  const d = t.game['Game Decisions'].rows.slice(1);
  assert.deepStrictEqual(d.map((r) => r[1] + ':' + r[6]), ['LMS4:default_applied', 'LMS5:default_applied', 'LMS6:default_applied']);
  assert.deepStrictEqual(JSON.parse(t.game['Game Config'].rows[1][1]), { LMS4: ['Mon', 'Wed', 'Fri'], LMS5: ['Mon', 'Wed', 'Fri'], LMS6: ['Mon', 'Wed', 'Fri'] });
  assert.deepStrictEqual(a.config.trackSuitDays.LMS4, ['Mon', 'Wed', 'Fri']);
  assert.deepStrictEqual(a.windows, []); // closed: nothing to decide
}

// ── gametourseen ───────────────────────────────────────────────────────
{
  const t = setup();
  assert.deepStrictEqual(t.call(P4, 'gametourseen', { tourId: 'home-Principal' }), { success: true });
  assert.deepStrictEqual(t.call(P4, 'gametourseen', { tourId: 'home-Principal' }), { success: true });
  assert.deepStrictEqual(t.game['Game Progress'].rows.slice(1).map((r) => r.slice(0, 4)), [['p4@lms.org.in', 'tour', 'home-Principal', 'seen']]);
  assert.strictEqual(t.call(P4, 'gametourseen', { tourId: '' }).success, false);
  assert.deepStrictEqual(t.call(P4, 'gametoday').toursSeen, ['home-Principal']);
}

// ── gameFetchJson_: null on any failure, cached per (url, email) ──────────
{
  const t = setup({ down: ['principalissues'] });
  assert.strictEqual(t.ctx.gameFetchJson_('https://x/exec?action=principalissues', 'tok', 10000, 'a@x'), null);
  const r1 = J(t.ctx.gameFetchJson_('https://x/exec?action=ssdashboard', 'tok', 10000, 'a@x'));
  t.ctx.gameFetchJson_('https://x/exec?action=ssdashboard', 'tok2', 10000, 'A@x');
  assert.strictEqual(r1.quotaPerMonth, 4);
  assert.strictEqual(t.fetches.filter((f) => f.url.indexOf('ssdashboard') !== -1).length, 1);
  t.ctx.gameFetchJson_('https://x/exec?action=ssdashboard', 'tok', 10000, 'b@x');
  assert.strictEqual(t.fetches.filter((f) => f.url.indexOf('ssdashboard') !== -1).length, 2); // another person: own entry
  // M27: no email, no cache (an entry keyed on '' would be shared by everyone without one)
  const keysBefore = Object.keys(t.cache).length;
  t.ctx.gameFetchJson_('https://x/exec?action=ssdashboard', 'tok', 10000, '');
  t.ctx.gameFetchJson_('https://x/exec?action=ssdashboard', 'tok', 10000, '');
  assert.strictEqual(t.fetches.filter((f) => f.url.indexOf('ssdashboard') !== -1).length, 4);
  assert.strictEqual(Object.keys(t.cache).length, keysBefore);
  t.ctx.UrlFetchApp.fetch = () => { throw new Error('timeout'); };
  assert.strictEqual(t.ctx.gameFetchJson_('https://y/exec', 'tok', 10000, 'a@x'), null);
  t.ctx.UrlFetchApp.fetch = () => ({ getResponseCode: () => 200, getContentText: () => '{"success":false,"error":"Not authorized"}' });
  assert.strictEqual(t.ctx.gameFetchJson_('https://z/exec', 'tok', 10000, 'a@x'), null);
}
// principalissues is fetched from the Coordinator backend only once the Issues page is ready
{
  const t = setup({ config: [['principalIssuesReady', 'true']], down: ['principalissues'] });
  const a = t.call(P4, 'gametoday');
  assert.ok(t.fetches.some((f) => f.url.indexOf('AKfycbwilcvrgZQga_qo1A-fBTUzKLifrBYIwlPHoWMITmchf5sZOYjKIJ7_4J0TeBF_-6B6/exec?action=principalissues&idToken=tok') !== -1));
  assert.deepStrictEqual(a.sourcesDown, ['principalissues']);
}
// peek: the same view, nothing written, no lock, never the greeting
{
  const snap = (t) => JSON.stringify(Object.keys(t.game).map((k) => t.game[k].rows));
  const t = setup(), before = snap(t);
  const a = t.call(P4, 'gametoday', { peek: '1' });
  assert.strictEqual(a.success, true);
  assert.strictEqual(a.firstLoadToday, false);
  assert.deepStrictEqual(a.missions.map((m) => m.id), ['ss_pace:LMS4:2026-11-05', 'pdr_report:LMS4:2026-11-05', 'info_requested:A1']); // picked as a real load would
  assert.strictEqual(snap(t), before, 'every sheet unchanged');
  assert.strictEqual(t.lock.waits, 0);
  // a closed window's default is not written by a peek, and a later real load is still the first
  const c = setup({ window: { Opens: '2026-10-20', Closes: '2026-10-25' } }), cb = snap(c);
  c.call(P4, 'gametoday', { peek: '1' });
  assert.strictEqual(snap(c), cb, 'no window default written');
  assert.strictEqual(c.call(P4, 'gametoday').firstLoadToday, true);
  // an existing snapshot is reused, and the peek leaves its DoneIds alone
  const d = setup({ daily: [dailyRow('2026-11-05', 'p4@lms.org.in', ['ss_pace:LMS4:2026-11-05', 'pdr_report:LMS4:2026-11-05'], [])] }), db = snap(d);
  const e = d.call(P4, 'gametoday', { peek: '1' });
  assert.deepStrictEqual(e.missions.map((m) => m.id), ['ss_pace:LMS4:2026-11-05', 'pdr_report:LMS4:2026-11-05']);
  assert.strictEqual(snap(d), db);
}
console.log('test-actions OK');
