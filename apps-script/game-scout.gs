var GAME_MODULE_ACTIONS = GAME_MODULE_ACTIONS || {};
var GAME_MODULE_MISSIONS = GAME_MODULE_MISSIONS || {};
var GAME_MODULE_QUESTS = GAME_MODULE_QUESTS || {};
// ═══════════════════════════════════════════════════════════════════
// LMCS Game Backend -- 📜 Scout report: a school's Principal daily reports as a game (V2 row #9, N3).
// Design: daily-report-in-game-design.md (Game Director, 30 Oct; Uday 2 Nov: on time is till 5 pm, CW/HW 4 pm).
//
//   gamescout&campus=LMSn  (GET) the last 7 school days of one school: regularity (filed? on time?), a 🔥 streak, compliance
//                          bars, 3-5 insights worked out by rules (every line traces to a row), each day's report text, and for the
//                          Owner and Coordinators only, the weekly rank of the 6 schools. A Principal gets only their own school.
//   quest "Your Scout report"  the entry point to principal/scout.html on the Principal's (own school only), Owner's and Coordinators'
//                          quests. Runs under the script lock, so it reads only the cache: the counts in its title are what gamescout
//                          last worked out for that school today (no score, no rank); a cold cache is the same link without counts.
//
// READ ONLY. The PDR workbook (GAME_PDR_SHEET_ID: Daily Reports, PDR Issues / Issue Actions / Issue Merges, PDR Repeats, LM Studio Tags)
// is opened and read; nothing in it is ever written, so the PDR backend's behaviour is untouched.
// Config: Game Config key `scout` (JSON), merged over SCOUT_DEFAULTS here (read in this file, so game.gs needs no edit).
//   requiredRegisters is EMPTY by design: the Owner sets it in the quest builder (Uday, 2 Nov). Until then the bar reads "not set yet".
// ponytail: "on time" uses the Daily Reports Timestamp, which principal-dr.gs overwrites on every save (last edit, not first filing):
//   a report filed at 4 pm and edited at 6 pm reads late. A first-filed column in principal-dr.gs is the fix if that bites.
// ponytail: holidays = Sunday, the 2nd Saturday, a "GH…" event on the school's own calendar (selected school only, cached by
//   game-teacher.gs), or a past weekday on which no school filed. The other schools in the rank skip the calendar read (speed).
// ═══════════════════════════════════════════════════════════════════

var SCOUT_DEFAULTS = {
  dueBy: '17:00',            // on time = saved by this IST time on the report's own date
  cwhwDueBy: '16:00',        // CW/HW cut-off (game-teacher cwhwDeferred: shown, not counted, until CW/HW returns from the ERP)
  requiredRegisters: [],     // set by the Owner in the quest builder; empty = the Registers bar is "not set yet"
  rankVisibleTo: ['Owner', 'Coordinator'],
  days: 7,                   // school days in the strip
  lookbackDays: 45,          // how far back a streak is counted
  issueDays: 7,              // an issue handled (acknowledged or resolved) within this many days counts; open longer = named
  issueWindowDays: 30,       // issues last seen within this many days are in the Issues bar
  repeatPct: 60,             // a day whose tasks or message repeat the previous report by this much is a "repeat" day
  realFrom: '2026-09-23',    // earlier Daily Reports rows were form testing (coordinator-pdr.gs COORD_PDR_REAL_FROM)
};
var SCOUT_CAMPUSES = ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6'];
var SCOUT_ISSUES_GO = { Principal: 'principal/issues.html', other: 'coordinator/systems/index.html' };
var SCOUT_GO = 'principal/scout.html';
var SCOUT_EMOJI = '\ud83d\udcca'; // = LMCSEmoji.get('dailyReport'), the Scout report window's own title (tests/game/test-scout.js checks they match)
var SCOUT_SUM_TTL = 21600;     // seconds: a school's counts for the quest title (the day is stored too, so yesterday's never shows)

// Game Config rows (header first) -> the `scout` object over SCOUT_DEFAULTS; bad JSON or a wrong type keeps the default
function scoutCfg_(rows) {
  const out = JSON.parse(JSON.stringify(SCOUT_DEFAULTS));
  (rows || []).slice(1).forEach(function (r) {
    if (String(r[0] || '').trim() !== 'scout') return;
    let v = null;
    try { v = JSON.parse(String(r[1])); } catch (err) { return; }
    if (!v || typeof v !== 'object' || Array.isArray(v)) return;
    Object.keys(out).forEach(function (k) { if (v[k] !== undefined && v[k] !== null && typeof v[k] === typeof out[k] && Array.isArray(v[k]) === Array.isArray(out[k])) out[k] = v[k]; });
  });
  return out;
}

function scoutAddDays_(key, n) { return new Date(Date.parse(key + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
// Sunday, or the 2nd Saturday of the month
function scoutRestDay_(key) { const d = new Date(key + 'T00:00:00Z'), dow = d.getUTCDay(), dom = d.getUTCDate(); return dow === 0 || (dow === 6 && dom >= 8 && dom <= 14); }
// ISO -> { day: 'YYYY-MM-DD', hm: 'HH:MM' } in IST
function scoutIst_(iso) {
  const t = Date.parse(iso);
  if (isNaN(t)) return null;
  const s = new Date(t + GAME_IST_OFFSET_MIN * 60000).toISOString();
  return { day: s.slice(0, 10), hm: s.slice(11, 16) };
}
function scoutList_(cell) { return String(cell || '').split(/[,\n]/).map(function (s) { return s.trim(); }).filter(Boolean); }
function scoutPct_(v) { if (v === null || v === undefined || v === '' || isNaN(+v)) return null; v = +v; return v <= 1 ? v * 100 : v; }
function scoutDayLabel_(key) { const d = new Date(key + 'T00:00:00Z'); return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()] + ' ' + d.getUTCDate(); }

// filed report -> 'ontime' | 'late'
function scoutTiming_(rep, cfg) {
  const at = scoutIst_(rep.at);
  if (!at) return 'ontime'; // no timestamp: the row exists, nothing says it was late
  return at.day < rep.date || (at.day === rep.date && at.hm <= cfg.dueBy) ? 'ontime' : 'late';
}

// The pure part (tests call this). inp = { campus, today, nowHM, cfg, reports: [{date, campus, at, maClass, maScore, done, tomorrow, registers, message}],
// issues: [{id, campus, subject, first, last}], actions: {id: {status, at}}, merges: {source: target}, repeats: [{date, campus, tasks, message}],
// tags: {'date|campus': {topics}}, holidays: {date: true} (this school's calendar), ss: {done, expected} | null }
function scoutCompute_(inp) {
  const cfg = inp.cfg, campus = inp.campus, today = inp.today;
  const mine = {}, anyFiled = {};
  (inp.reports || []).forEach(function (r) {
    if (r.date < cfg.realFrom) return;
    anyFiled[r.date] = true;
    if (r.campus === campus) mine[r.date] = r;
  });
  const isSchoolDay = function (d) {
    if (mine[d]) return true; // filed on it: it counts, whatever the calendar says
    if (scoutRestDay_(d) || (inp.holidays || {})[d]) return false;
    return d === today || !!anyFiled[d]; // a past weekday nobody filed on: the network was closed
  };
  const state = function (d) {
    if (mine[d]) return scoutTiming_(mine[d], cfg);
    if (d === today) return inp.nowHM <= cfg.dueBy ? 'waiting' : 'overdue';
    return 'missing';
  };

  // the strip: the last N school days, oldest first
  const strip = [];
  for (let d = today, n = 0; strip.length < cfg.days && n < cfg.lookbackDays; d = scoutAddDays_(d, -1), n++) {
    if (isSchoolDay(d)) strip.unshift({ date: d, label: scoutDayLabel_(d), state: state(d), at: mine[d] ? (scoutIst_(mine[d].at) || {}).hm || '' : '' });
  }
  const counted = strip.filter(function (s) { return s.state !== 'waiting' && s.state !== 'overdue'; }); // today not in yet: not judged
  const tally = { ontime: 0, late: 0, missing: 0 };
  counted.forEach(function (s) { tally[s.state]++; });

  // 🔥 streak: on-time school days back from today (or yesterday while today is not in yet)
  let streak = 0, prevRun = 0, broke = null, capped = true;
  const earliest = Object.keys(anyFiled).sort()[0] || today; // before the first report anywhere there is nothing to count, not a holiday
  for (let d = today, n = 0; n < cfg.lookbackDays; d = scoutAddDays_(d, -1), n++) {
    if (d < earliest) { capped = false; break; }
    if (!isSchoolDay(d)) continue;
    const st = state(d);
    if (st === 'waiting' || st === 'overdue') continue;
    if (st === 'ontime') { if (broke) prevRun++; else streak++; continue; }
    if (broke || streak) { capped = false; break; }
    broke = d; // the latest judged day was late or missing: count the run it ended
  }
  const lost = streak === 0 && prevRun >= 2;

  // compliance bars over the judged strip days
  const bars = [];
  const req = (cfg.requiredRegisters || []).map(function (x) { return String(x).trim().toLowerCase(); }).filter(Boolean);
  const skipped = {};
  if (!req.length) bars.push({ id: 'registers', label: 'Registers', pct: null, note: 'not set yet' });
  else {
    let ok = 0;
    counted.forEach(function (s) {
      const have = scoutList_(mine[s.date] && mine[s.date].registers).join(' | ').toLowerCase(), miss = req.filter(function (x) { return have.indexOf(x) === -1; });
      miss.forEach(function (x) { skipped[x] = (skipped[x] || 0) + 1; });
      if (!miss.length) ok++;
    });
    bars.push({ id: 'registers', label: 'Registers', pct: counted.length ? Math.round(ok / counted.length * 100) : null, note: counted.length ? ok + ' of ' + counted.length + ' days' : 'no days yet' });
  }

  const rootOf = function (id) { let x = id, n = 0; while ((inp.merges || {})[x] && n++ < 5) x = inp.merges[x]; return x; };
  const since = scoutAddDays_(today, -cfg.issueWindowDays), openLong = [];
  let considered = 0, handled = 0;
  (inp.issues || []).forEach(function (i) {
    if (i.campus !== campus || rootOf(i.id) !== i.id || !(String(i.last) >= since)) return;
    considered++;
    const a = (inp.actions || {})[i.id], closed = a && (a.status === 'resolved' || a.status === 'acknowledged');
    const aDay = a ? String(a.at || '').slice(0, 10) : '';
    if (closed && aDay && aDay <= scoutAddDays_(String(i.first), cfg.issueDays)) handled++;
    const age = Math.round((Date.parse(today) - Date.parse(String(i.first))) / 86400000);
    if (!closed && age > cfg.issueDays) openLong.push({ id: i.id, subject: i.subject, days: age });
  });
  openLong.sort(function (a, b) { return b.days - a.days; });
  bars.push(considered ? { id: 'issues', label: 'Issues', pct: Math.round(handled / considered * 100), note: handled + ' of ' + considered + ' handled within ' + cfg.issueDays + ' days' }
    : { id: 'issues', label: 'Issues', pct: null, note: 'none raised in ' + cfg.issueWindowDays + ' days' });

  if (inp.ss && inp.ss.expected > 0) bars.push({ id: 'ss', label: 'SS pace', pct: Math.min(100, Math.round(inp.ss.done / inp.ss.expected * 100)), note: inp.ss.done + ' done, ' + Math.round(inp.ss.expected) + ' due by today' });
  else bars.push({ id: 'ss', label: 'SS pace', pct: null, note: inp.ss ? 'nothing due yet' : "couldn't check" });

  // insights, by rules, biggest first, at most 5. icon = an LMCSEmoji key (assets/game/emoji.js); streakLost, registers, trendUp/Down, repeat
  // and topic are new concepts not in emoji.js yet: they show text only until the Game Director picks their emoji
  const ins = [], add = function (size, icon, text) { ins.push({ size: size, icon: icon, text: text }); };
  if (lost) add(95, 'streakLost', 'Streak lost after ' + prevRun + ' days. Start again today.');
  else if (streak >= 3) add(50 + streak, 'onTrack', streak + (capped ? '+' : '') + ' school days on time in a row.');
  if (tally.missing) add(85, 'overdue', tally.missing + (tally.missing === 1 ? ' report' : ' reports') + ' missing this week.');
  if (tally.late >= 2) add(65, 'due', 'Filed after ' + scoutHm_(cfg.dueBy) + ' on ' + tally.late + ' days.');
  Object.keys(skipped).forEach(function (x) { if (skipped[x] >= 2) add(70, 'registers', 'Register "' + x + '" not checked on ' + skipped[x] + ' days.'); });
  openLong.slice(0, 2).forEach(function (o) { add(60 + Math.min(30, o.days), 'issues', '"' + o.subject + '" still open after ' + o.days + ' days.'); });
  const scores = counted.map(function (s) { return mine[s.date] ? parseFloat(mine[s.date].maScore) : NaN; }).filter(function (v) { return !isNaN(v); });
  if (scores.length >= 4) {
    const avg = function (a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; };
    const a = Math.round(avg(scores.slice(0, 3)) * 10) / 10, b = Math.round(avg(scores.slice(-3)) * 10) / 10;
    if (Math.abs(b - a) >= 1) add(40 + Math.abs(b - a) * 10, b > a ? 'trendUp' : 'trendDown', 'Morning assembly score ' + (b > a ? 'up' : 'down') + ': ' + a + ' → ' + b + '.');
  }
  const inStrip = {};
  strip.forEach(function (s) { inStrip[s.date] = true; });
  const rep = (inp.repeats || []).filter(function (r) { return r.campus === campus && inStrip[r.date] && ((scoutPct_(r.tasks) || 0) >= cfg.repeatPct || (scoutPct_(r.message) || 0) >= cfg.repeatPct); }).length;
  if (rep >= 3) add(55, 'repeat', 'Mostly the same report repeated on ' + rep + ' days.');
  const topics = {};
  strip.forEach(function (s) { const t = (inp.tags || {})[s.date + '|' + campus]; ((t && t.topics) || []).forEach(function (w) { topics[w] = (topics[w] || 0) + 1; }); });
  Object.keys(topics).filter(function (w) { return topics[w] >= 3; }).sort(function (a, b) { return topics[b] - topics[a]; }).slice(0, 1)
    .forEach(function (w) { add(35, 'topic', '"' + w + '" came up on ' + topics[w] + ' days.'); });
  if (counted.length && tally.ontime === counted.length) add(30, 'done', 'Every report this week came in on time.');
  ins.sort(function (a, b) { return b.size - a.size; });

  const texts = {};
  strip.forEach(function (s) {
    const r = mine[s.date];
    if (r) texts[s.date] = { maClass: r.maClass, maScore: r.maScore, done: r.done, tomorrow: r.tomorrow, registers: r.registers, message: r.message };
  });
  const setBars = bars.filter(function (b) { return b.pct !== null; });
  const compliance = setBars.length ? setBars.reduce(function (x, b) { return x + b.pct; }, 0) / setBars.length : 100;
  return {
    campus: campus, today: today, dueBy: cfg.dueBy, cwhwDueBy: cfg.cwhwDueBy, strip: strip, tally: tally, judged: counted.length,
    streak: { days: streak, capped: streak > 0 && capped, lost: lost, lostAfter: lost ? prevRun : 0 }, bars: bars,
    openIssues: openLong.slice(0, 5), insights: ins.slice(0, 5).map(function (x) { return { icon: x.icon, text: x.text }; }), reports: texts,
    score: counted.length ? Math.round(tally.ontime / counted.length * compliance) : 0, // on time x compliance, 0-100 (the weekly rank)
  };
}
function scoutHm_(hm) { const p = String(hm).split(':'), h = +p[0]; return (h % 12 || 12) + (p[1] && p[1] !== '00' ? ':' + p[1] : '') + (h < 12 ? ' am' : ' pm'); }

// ═══ I/O: GET gamescout ═══
// SS submissions this month vs the pro-rated monthly quota, for one school (shape: gameSsTrim_). null = not readable.
function scoutSsPace_(ss, campus, today) {
  if (!ss) return null;
  let done = 0, quota = 0;
  gameSsDashboards_(ss).forEach(function (d) {
    (d.roster || []).forEach(function (r) { if (gameCampusKey_(r.school) === campus) { done += +r.submissionsThisMonth || 0; quota += +d.quotaPerMonth || 0; } });
  });
  const p = today.split('-'), y = +p[0], m = +p[1] - 1, last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  let all = 0, gone = 0;
  for (let d = 1; d <= last; d++) if (new Date(Date.UTC(y, m, d)).getUTCDay() !== 0) { all++; if (d <= +p[2]) gone++; }
  return { done: done, expected: all ? quota * gone / all : 0 };
}

function scoutGet_(caller, p) {
  const roles = caller.roles || [], wide = roles.indexOf('Owner') !== -1 || roles.indexOf('Coordinator') !== -1;
  let campus = gameCampusKey_(p && p.campus);
  if (!wide) { // fails closed: a Principal reads exactly one school of their own (campus ALL, empty or a list gets nothing, as erpread does)
    if (roles.indexOf('Principal') === -1 || SCOUT_CAMPUSES.indexOf(caller.campusId) === -1) return { success: false, error: 'Not authorized' };
    if (campus && campus !== caller.campusId) return { success: false, error: 'Not authorized' };
    campus = caller.campusId;
  }
  if (SCOUT_CAMPUSES.indexOf(campus) === -1) return { success: false, error: 'Pick a school (LMS1 to LMS6)' };

  let cfg = scoutCfg_([]);
  try { cfg = scoutCfg_(gameBook_().getSheetByName('Game Config').getDataRange().getValues()); } catch (err) { /* defaults */ }
  const now = gameNow_(), today = gameDayKey_(now), nowHM = (scoutIst_(now.toISOString()) || {}).hm || '00:00';
  const from = scoutAddDays_(today, -cfg.lookbackDays - 1);
  const ss = SpreadsheetApp.openById(GAME_PDR_SHEET_ID);
  const tab = function (name) { const sh = ss.getSheetByName(name); return sh && sh.getLastRow() > 1 ? sh.getDataRange().getDisplayValues().slice(1) : []; };

  const reports = [], dr = ss.getSheetByName('Daily Reports').getDataRange().getValues();
  for (let i = 1; i < dr.length; i++) {
    const r = dr[i], date = gameDateKey_(r[1]);
    if (!date || date < from) continue;
    reports.push({ date: date, campus: gameCampusKey_(r[2]), at: gameIso_(r[0]), maClass: String(r[4]), maScore: String(r[5]), done: String(r[6]), tomorrow: String(r[7]), registers: String(r[8]), message: String(r[9]) });
  }
  const issues = tab('PDR Issues').map(function (r) { return { id: r[0], campus: gameCampusKey_(r[1]), subject: r[3], first: r[4], last: r[5] }; });
  const actions = {};
  tab('PDR Issue Actions').forEach(function (a) { actions[a[0]] = { status: a[1], at: a[6] }; });
  const merges = {};
  tab('PDR Issue Merges').forEach(function (m) { merges[m[0]] = m[1]; });
  const repeats = tab('PDR Repeats').map(function (r) { return { date: r[0], campus: gameCampusKey_(r[1]), tasks: r[2], message: r[3] }; });
  const tags = {};
  tab('LM Studio Tags').forEach(function (t) { if (t[0] >= from) tags[t[0] + '|' + gameCampusKey_(t[1])] = { topics: t[2] ? t[2].split(', ') : [] }; });

  // the selected school's own calendar, window days only (game-teacher.gs caches each campus-day for 6 h)
  const holidays = {};
  if (typeof tchCalendarEvents_ === 'function') {
    for (let d = today, n = 0; n < cfg.days * 2; d = scoutAddDays_(d, -1), n++) {
      if (scoutRestDay_(d)) continue;
      const ev = tchCalendarEvents_(campus, d);
      if (ev && ev.some(function (e) { return String((e && e.title) || '').indexOf('GH') === 0; })) holidays[d] = true;
    }
  }
  let ssd = null;
  try { ssd = gameFetchJson_(GAME_PDR_URL + '?action=ssdashboard', caller.idToken, GAME_FETCH_TIMEOUT_MS, caller.email, function (j) { return gameSsTrim_(j, caller.email, today); }); } catch (err) { ssd = null; }

  const base = { today: today, nowHM: nowHM, cfg: cfg, reports: reports, issues: issues, actions: actions, merges: merges, repeats: repeats, tags: tags };
  const out = scoutCompute_(Object.assign({ campus: campus, holidays: holidays, ss: scoutSsPace_(ssd, campus, today) }, base));
  out.success = true;
  out.role = caller.primaryRole;
  out.issuesGo = wide ? SCOUT_ISSUES_GO.other : SCOUT_ISSUES_GO.Principal;
  out.cwhwCounted = false; // CW/HW returns from the ERP later (game-teacher cwhwDeferred); the 4 pm cut-off is shown, not scored
  const rankOk = (cfg.rankVisibleTo || []).some(function (r) { return roles.indexOf(r) !== -1; });
  if (rankOk) {
    const board = SCOUT_CAMPUSES.map(function (c) {
      const r = c === campus ? out : scoutCompute_(Object.assign({ campus: c, holidays: {}, ss: scoutSsPace_(ssd, c, today) }, base));
      return { campus: c, score: r.score, streak: r.streak.days };
    }).sort(function (a, b) { return b.score - a.score || b.streak - a.streak || (a.campus < b.campus ? -1 : 1); });
    out.board = board;
    out.rank = { pos: board.map(function (b) { return b.campus; }).indexOf(campus) + 1, of: board.length };
  }
  delete out.score; // a Principal never sees a number that implies a ranking; the board carries scores for those allowed
  try { // counts only, for the quest title: never the score or rank
    CacheService.getScriptCache().put('scout:sum:' + campus, JSON.stringify({ day: today, ontime: out.tally.ontime, judged: out.judged }), SCOUT_SUM_TTL);
  } catch (err) { /* the quest shows its link without counts */ }
  return out;
}

// The quest: one link step to the Scout report (never done: it is a standing entry point). Under the lock: one cache read at most.
// A Principal gets their own school only and fails closed like gamescout (campus ALL, empty or a list: no quest).
function scoutQuests_(caller, cfg, now) {
  try {
    const role = caller.primaryRole, step = { id: 'open', title: 'Open the last 7 school days', go: SCOUT_GO, done: false, locked: false };
    if (role === 'Owner' || role === 'Coordinator') {
      return [{ questId: 'scout', title: SCOUT_EMOJI + ' Scout reports', parallel: true, complete: false,
        steps: [Object.assign(step, { title: "Open a school's last 7 school days" })] }];
    }
    if (role !== 'Principal' || SCOUT_CAMPUSES.indexOf(caller.campusId) === -1) return [];
    let sum = null;
    try { sum = JSON.parse(CacheService.getScriptCache().get('scout:sum:' + caller.campusId) || 'null'); } catch (err) { sum = null; }
    const counts = sum && sum.day === gameDayKey_(now) && sum.judged > 0 ? ': ' + sum.ontime + ' of ' + sum.judged + ' on time' : '';
    return [{ questId: 'scout', title: SCOUT_EMOJI + ' Your Scout report' + counts, parallel: true, complete: false, steps: [step] }];
  } catch (err) { console.error('scout quest: ' + (err && err.message)); return []; }
}

GAME_MODULE_ACTIONS.gamescout = scoutGet_;
['Principal', 'Owner', 'Coordinator'].forEach(function (r) { GAME_MODULE_QUESTS[r] = [].concat(GAME_MODULE_QUESTS[r] || [], scoutQuests_); });
