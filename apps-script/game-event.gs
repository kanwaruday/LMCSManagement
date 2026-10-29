var GAME_MODULE_ACTIONS = GAME_MODULE_ACTIONS || {};
var GAME_MODULE_MISSIONS = GAME_MODULE_MISSIONS || {};
var GAME_MODULE_QUESTS = GAME_MODULE_QUESTS || {};

// ═══════════════════════════════════════════════════════════════════
// LMCS Game Backend -- 🎉 Events (the first: "Set up the Game Day", 30 Oct 2026). Config only: Game Config key `events` (game.gs
// gameConfigDefaults_), so a later event day is a new row, not new code.
//   gameevent       (GET, read only) the caller's checklist for the running event: steps ticked from data where we have it, their own
//                   school's % and the network bar. A Principal also gets "X of Y teachers in" (names of their own school only).
//   gameeventtick   (POST only, dispatched from game.gs doPost; never in GAME_MODULE_ACTIONS) the one write: a `self` step's tap,
//                   a Game Progress row (Kind 'event', Key 'event:<eventId>:<stepId>'), idempotent.
//   gameeventboard  (GET, Owner only, checked against the verified caller before anything is read) per school: in / done / % / level,
//                   who is not in and who is stuck (names), one nudge sentence; plus the network total.
// Detectors (eventCheck_) read only what the game backend already reads: Game Daily (opened = a row on an event day, missions:N = its
// DoneIds), Game Progress (self ticks, quests via gameQuestState_), the Kingdom's cq: and daybook-setup: resolvers. A step that cannot be
// told (null) is never counted, as in the Kingdom: a person has finished when every step that can be told is done.
// School % = people who finished / people expected at that school. Expected = the allowlist (its campus) plus the Employee Master's
// active staff by tchEmployeeFromBook_'s exact rule (the books looped once) minus the Transport department (drivers and conductors never
// open a portal home), deduped by email, roles with steps only (never the Owner, Accounts or Drivers). A campus that is not one school
// (ALL, blank, a list) and the Owner count under HES, outside every school.
// LOAD: only the caller's own steps are computed live (a tick shows at once). The school numbers, the network and each school's names
// are computed once a minute per event (eventShared_, CacheService) and are the same for every caller, so they never ask the Office
// (it answers as the caller): there a daybook-setup step is "cannot be told" and is left out of the %. A school's % may lag 60 s.
// ROSTER: cached 10 min, and the last good one kept 6 h for when the Employee Master can't be read; with neither, there are no school
// numbers (an allowlist-only % would be wrong) and the Owner's board says the roster is incomplete.
// Nobody but the Owner sees another school's numbers or any names beyond a Principal's own teachers.
// Only this file's own functions are used at top level (load order: tests/apps-script/test-load-order.js).
// ═══════════════════════════════════════════════════════════════════

var EVENT_SCHOOLS = ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6'];
var EVENT_KIND = 'event'; // Game Progress Kind of a self tick
var EVENT_ROSTER_KEY = 'event_roster_v2', EVENT_ROSTER_S = 600; // the expected people, cached 10 min
var EVENT_ROSTER_GOOD_KEY = 'event_roster_good_v2', EVENT_ROSTER_GOOD_S = 21600; // the last roster read with the Employee Master, 6 h
var EVENT_SHARED_S = 60; // the school numbers and names (eventShared_)
var EVENT_SKIP_DEPTS = ['transport']; // Employee Master departments never expected: they have no portal home to open
var EVENT_OFFICE_ROLES = ['Owner', 'Coordinator', 'FeeClerk', 'Accounts']; // roles worth asking the Office backend (start.progress); anyone else: no call
var EVENT_CODES = { EVENT_OWNER_ONLY: 'The Game Day board is for the Owner.', EVENT_NOT_ACTIVE: 'That event is not running today.',
  EVENT_NOT_SELF: 'That step ticks itself when the work is done.', EVENT_ERROR: 'Something went wrong. Please try again.' };

function eventFail_(code) { return { success: false, code: code, error: EVENT_CODES[code] }; }
function eventHas_(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function eventCampus_(c) { c = String(c || '').trim().toUpperCase(); return EVENT_SCHOOLS.indexOf(c) !== -1 ? c : 'HES'; }
// CacheService as JSON. A put that fails (a value over 100 KB) is warned about and costs only a recompute.
function eventCacheGet_(cache, key) { try { const v = cache.get(key); return v ? JSON.parse(v) : null; } catch (err) { return null; } }
function eventCachePut_(cache, key, value, seconds) {
  const text = JSON.stringify(value);
  try { cache.put(key, text, seconds); return true; } catch (err) { console.warn('event cache: ' + key + ' not stored (' + text.length + ' chars): ' + (err && err.message)); return false; }
}

// ── config ───────────────────────────────────────────────────────────
// cfg.events, well-formed ones only
function eventList_(cfg) {
  const day = /^\d{4}-\d\d-\d\d$/;
  return (cfg && Array.isArray(cfg.events) ? cfg.events : []).filter(function (e) {
    return e && typeof e.id === 'string' && /^[\w-]{1,60}$/.test(e.id) && day.test(String(e.date)) && day.test(eventEnd_(e)) && e.steps && typeof e.steps === 'object';
  });
}
function eventEnd_(ev) { return String(ev.showTo || ev.date); }
// the event running on dayKey (the first listed), or null
function eventActive_(cfg, dayKey) { return eventList_(cfg).filter(function (e) { return e.date <= dayKey && dayKey <= eventEnd_(e); })[0] || null; }
// a role's steps; a step with `fn` only for someone whose allowlist Functions hold it (case-insensitive)
function eventStepsFor_(ev, role, functions) {
  const list = Array.isArray(ev.steps[role]) ? ev.steps[role] : [], fns = (functions || []).map(function (f) { return String(f).trim().toLowerCase(); });
  return list.filter(function (s) { return s && typeof s.id === 'string' && typeof s.check === 'string' && (!s.fn || fns.indexOf(String(s.fn).trim().toLowerCase()) !== -1); });
}
// '{n} of {of} schools' with values filled in
function eventFill_(s, vals) { return String(s || '').replace(/\{(\w+)\}/g, function (m, k) { return eventHas_(vals, k) ? String(vals[k]) : m; }); }
// Buddy's line for done of total: no guilt, just the next nudge
function eventBuddy_(ev, done, total, finished) {
  const b = ev.buddy || {}, p = total ? done / total : 0;
  return String((finished || (total && done >= total) ? b.done : p >= 0.75 ? b.cheer75 : p >= 0.5 ? b.cheer50 : p >= 0.25 ? b.cheer25 : b.welcome) || '');
}
// whole % rounded down (79.5 is not 80), level 0-5 every 20%
function eventPct_(done, people) { return people ? Math.floor(100 * done / people) : 0; }
function eventLevel_(pct) { return Math.max(0, Math.min(5, Math.floor((+pct || 0) / 20))); }
// the first name, honorifics and initials skipped (the greeting's rule, assets/game/game.js greetingLine)
function eventFirst_(name) {
  return String(name || '').trim().split(/\s+/).filter(function (w) { return w && !/\.$/.test(w) && !/^(dr|mr|mrs|ms|smt|shri)$/i.test(w); })[0] || '';
}

// ── the expected people ──────────────────────────────────────────────
// allow: the allowlist sheet WITH its header (email, name, campus, roles, canDecide, ..., Functions); emp: { personal, master, salary }, the
// EmpPersonal / EmpMaster / EmpSalary values (header first), or null. -> [{ email, name, role, campusId, functions }], one per email. An
// allowlist row wins, as at sign-in (even one with no roles: it blocks the fallback there too); then tchEmployeeFromBook_'s people.
function eventRosterFrom_(allow, emp) {
  const out = [], seen = {};
  (allow || []).slice(1).forEach(function (r) {
    const email = gameLower_(r[0]), roles = String(r[3] || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    if (!email || seen[email]) return;
    seen[email] = true;
    if (!roles.length) return;
    const role = gamePrimaryRole_(roles);
    const p = { email: email, name: String(r[1] || '').trim(), role: role, campusId: role === 'Owner' ? 'HES' : eventCampus_(r[2]) }, fns = gameFunctionsOf_(allow[0], r);
    if (fns.length) p.functions = fns; // left out when empty: the cached roster stays small
    out.push(p);
  });
  if (!emp) return out;
  const cell = function (v) { return String(v || '').replace(/[​-‏﻿⁠]/g, '').trim(); }; // tchEmployeeFromBook_'s cleaning
  // EmployeeCode -> the named cells of its FIRST row (tchEmployeeFromBook_'s find())
  const byCode = function (rows, cols) {
    const h = rows[0] || [], at = h.indexOf('EmployeeCode'), idx = cols.map(function (c) { return h.indexOf(c); }), map = {};
    if (at < 0) return map;
    for (let i = 1; i < rows.length; i++) {
      const k = cell(rows[i][at]);
      if (k && !eventHas_(map, k)) map[k] = idx.map(function (j) { return j < 0 ? '' : cell(rows[i][j]); });
    }
    return map;
  };
  const p = emp.personal || [], pe = (p[0] || []).indexOf('AuthEmail'), pc = (p[0] || []).indexOf('EmployeeCode');
  if (pe < 0 || pc < 0) return out;
  const codeOf = {}, order = [];
  for (let i = 1; i < p.length; i++) {
    const e = String(p[i][pe] || '').trim().toLowerCase(), c = String(p[i][pc] || '').trim();
    if (!e || e.indexOf('@') === -1 || !c) continue;
    if (!eventHas_(codeOf, e)) order.push(e);
    codeOf[e] = c; // last row wins, like the PDR map
  }
  const master = byCode(emp.master || [], ['Status', 'Name']), salary = byCode(emp.salary || [], ['Department']);
  order.forEach(function (email) {
    if (seen[email]) return;
    const code = codeOf[email], prefix = code.split('/')[0], m = master[code], dept = String((salary[code] || [])[0] || '').toLowerCase();
    if (!tchHas_(TCH_CAMPUS_BY_PREFIX, prefix) || !m || m[0].toLowerCase() !== 'active' || !tchHas_(TCH_AUTO_ROLE_BY_DEPARTMENT, dept)) return;
    seen[email] = true;
    if (EVENT_SKIP_DEPTS.indexOf(dept) !== -1) return; // signs in as Staff, but is not expected on the day
    out.push({ email: email, name: m[1], role: TCH_AUTO_ROLE_BY_DEPARTMENT[dept], campusId: TCH_CAMPUS_BY_PREFIX[prefix] });
  });
  return out;
}

// -> { people, complete }: cached 10 min; when the Employee Master can't be read, the last good roster (6 h). With neither, the allowlist
// only and complete: false (no school numbers are shown then).
function eventRoster_() {
  const cache = CacheService.getScriptCache(), fresh = eventCacheGet_(cache, EVENT_ROSTER_KEY);
  if (fresh) return { people: fresh, complete: true };
  const allow = SpreadsheetApp.openById(GAME_ALLOWLIST_SHEET_ID).getSheets()[0].getDataRange().getValues();
  let emp = null;
  try {
    const book = SpreadsheetApp.openById(TCH_EMP_SHEET_ID), v = function (t) { return book.getSheetByName(t).getDataRange().getValues(); };
    emp = { personal: v('EmpPersonal'), master: v('EmpMaster'), salary: v('EmpSalary') };
  } catch (err) { console.error('event roster: employee master ' + (err && err.message)); }
  if (emp) {
    const people = eventRosterFrom_(allow, emp);
    if (eventCachePut_(cache, EVENT_ROSTER_KEY, people, EVENT_ROSTER_S)) eventCachePut_(cache, EVENT_ROSTER_GOOD_KEY, people, EVENT_ROSTER_GOOD_S);
    return { people: people, complete: true };
  }
  const good = eventCacheGet_(cache, EVENT_ROSTER_GOOD_KEY);
  return good ? { people: good, complete: true } : { people: eventRosterFrom_(allow, null), complete: false };
}

// ── detectors ────────────────────────────────────────────────────────
// The rows the detectors read, once per request: Game Daily from the event's date up to today (opened, and the DoneIds of those days),
// this event's self ticks, Game Progress (quests). Reads only, no lock.
function eventData_(book, ev, dayKey) {
  const to = dayKey < eventEnd_(ev) ? dayKey : eventEnd_(ev), daily = {}, self = {}, prefix = 'event:' + ev.id + ':';
  book.getSheetByName('Game Daily').getDataRange().getValues().slice(1).forEach(function (r) {
    const day = gameDayCell_(r[0]), e = gameLower_(r[1]);
    if (!e || day < ev.date || day > to) return;
    const ids = daily[e] = eventHas_(daily, e) ? daily[e] : [];
    gameIdList_(r[5]).forEach(function (id) { if (ids.indexOf(id) === -1) ids.push(id); });
  });
  const prog = book.getSheetByName('Game Progress').getDataRange().getValues();
  prog.slice(1).forEach(function (r) {
    if (r[1] === EVENT_KIND && String(r[2]).indexOf(prefix) === 0) self[gameLower_(r[0]) + '|' + String(r[2]).slice(prefix.length)] = true;
  });
  return { book: book, daily: daily, self: self, prog: prog, questRows: null };
}

// the Kingdom resolvers' context, built on first use: Setup Data for cq:, the caller's Office progress for daybook-setup:
function eventK_(ctx, need) {
  const k = ctx.k = ctx.k || { caller: ctx.caller, cfg: ctx.cfg, now: ctx.now, views: {}, defs: null, setupRows: null, daybook: null, tried: {} };
  if (k.tried[need]) return k;
  k.tried[need] = true;
  if (need === 'cq') { try { k.setupRows = cqRead_(); } catch (err) { console.error('event setup data: ' + (err && err.message)); } }
  if (need === 'daybook' && !ctx.shared && EVENT_OFFICE_ROLES.indexOf(ctx.caller.primaryRole) !== -1) {
    try { k.daybook = daybookProgress_(ctx.caller); } catch (err) { console.error('event office: ' + (err && err.message)); }
  }
  return k;
}

// a Game Quests quest finished (gameQuestState_ over the recorded steps; null = no such quest)
function eventQuestDone_(ctx, email, questId) {
  const d = ctx.data;
  if (!d.questRows) d.questRows = d.book.getSheetByName('Game Quests').getDataRange().getValues();
  const row = d.questRows.slice(1).filter(function (r) { return String(r[0]).trim() === questId; })[0];
  if (!row) return null;
  const q = gameQuestState_(d.questRows, String(row[1]).trim(), {}, d.prog, email, ctx.cfg).filter(function (x) { return x.questId === questId; })[0];
  return q ? q.complete : null;
}

// one step for one person -> true | false | null (null = cannot be told here: never counted)
function eventCheck_(step, person, ctx) {
  const c = String(step.check), i = c.indexOf(':'), type = i === -1 ? c : c.slice(0, i), arg = i === -1 ? '' : c.slice(i + 1), e = person.email;
  if (type === 'opened') return eventHas_(ctx.data.daily, e);
  if (type === 'missions') return (eventHas_(ctx.data.daily, e) ? ctx.data.daily[e] : []).length >= (parseInt(arg, 10) || 1);
  if (type === 'self') return ctx.data.self[e + '|' + step.id] === true;
  if (type === 'quest') return eventQuestDone_(ctx, e, arg);
  if (type === 'cq') { const k = eventK_(ctx, 'cq'); return k.setupRows ? kingdomRefCq_(k, person.campusId, arg) : null; }
  if (type === 'daybook-setup') return kingdomRefDaybook_(eventK_(ctx, 'daybook'), person.campusId, arg);
  return null;
}

// -> { steps: [{ step, state }], done, total, opened, finished } (finished: every step that can be told is done, and one can)
function eventPerson_(ev, person, ctx) {
  const steps = eventStepsFor_(ev, person.role, person.functions).map(function (s) { return { step: s, state: eventCheck_(s, person, ctx) }; });
  const told = steps.filter(function (x) { return x.state !== null; });
  return { steps: steps, done: steps.filter(function (x) { return x.state === true; }).length, total: steps.length, opened: eventHas_(ctx.data.daily, person.email),
    finished: told.length > 0 && told.every(function (x) { return x.state === true; }) };
}

// ── schools ──────────────────────────────────────────────────────────
// { LMS1: [{ person, r }], ... }: the expected people of each school (roles with steps in this event only)
function eventSchools_(ev, roster, ctx) {
  const out = {};
  EVENT_SCHOOLS.forEach(function (c) { out[c] = []; });
  (roster || []).forEach(function (p) {
    if (!eventHas_(out, p.campusId) || !eventStepsFor_(ev, p.role, p.functions).length) return;
    out[p.campusId].push({ person: p, r: eventPerson_(ev, p, ctx) });
  });
  return out;
}
function eventStats_(list) {
  const done = list.filter(function (x) { return x.r.finished; }).length, pct = eventPct_(done, list.length);
  return { people: list.length, in: list.filter(function (x) { return x.r.opened; }).length, done: done, pct: pct, level: eventLevel_(pct) };
}
function eventNetwork_(ev, schools) {
  const goal = +ev.goalPct || 80, n = EVENT_SCHOOLS.filter(function (c) { return eventStats_(schools[c]).pct >= goal; }).length;
  return { schoolsAtGoal: n, of: EVENT_SCHOOLS.length, goalPct: goal, reward: String(ev.reward || ''),
    line: eventFill_((ev.buddy || {}).network, { n: n, of: EVENT_SCHOOLS.length, goal: goal }) };
}
function eventNames_(list) { return list.map(function (x) { return x.person.name || 'Someone with no name on file'; }); }

// the Owner's one plain sentence for a school
function eventNudge_(st, notIn, stuck, principal) {
  if (!st.people) return 'Nobody is listed for this school yet.';
  if (st.done === st.people) return 'Everyone is done. Shabash!';
  const who = principal && !notIn.some(function (x) { return x.person.email === principal.email; }) ? eventFirst_(principal.name) : '';
  const call = who ? 'Call ' + who + ' ji: ' : '';
  if (notIn.length) {
    const teachers = notIn.filter(function (x) { return x.person.role === 'Teacher'; }).length, all = teachers === notIn.length, n = notIn.length;
    return call + n + ' ' + (all ? (n === 1 ? 'teacher' : 'teachers') : (n === 1 ? 'person' : 'people')) + ' not in yet' +
      (principal && !who ? ', the Principal too' : '') + '.';
  }
  return call + stuck.length + (stuck.length === 1 ? ' person has' : ' people have') + ' started but not finished.';
}

// The numbers and names everyone's card and the board read, once a minute per event, the same for every caller (ctx.shared: no Office).
// Keys: event_sum_<id> { complete, stats: { LMS1: {people, in, done, pct, level} }, network } and, split by school (CacheService holds
// 100 KB a key), event_names_<id>_<school> { notIn, stuck, nudge, teachers: { n, of, notIn } }. Recomputed when any key is missing.
function eventShared_(ev, ctx) {
  const cache = CacheService.getScriptCache(), sumKey = 'event_sum_' + ev.id, nameKey = function (c) { return 'event_names_' + ev.id + '_' + c; };
  const keys = [sumKey].concat(EVENT_SCHOOLS.map(nameKey));
  let hit = {};
  try { hit = cache.getAll(keys) || {}; } catch (err) { hit = {}; }
  if (keys.every(function (k) { return hit[k]; })) {
    try { const names = {}; EVENT_SCHOOLS.forEach(function (c) { names[c] = JSON.parse(hit[nameKey(c)]); }); return { sum: JSON.parse(hit[sumKey]), names: names }; } catch (err) { /* recompute */ }
  }
  const roster = eventRoster_(), sctx = { caller: ctx.caller, cfg: ctx.cfg, now: ctx.now, data: ctx.data, shared: true }, schools = eventSchools_(ev, roster.people, sctx);
  const principal = {};
  roster.people.forEach(function (p) { if (p.role === 'Principal' && !principal[p.campusId]) principal[p.campusId] = p; });
  const out = { sum: { complete: roster.complete, stats: {}, network: roster.complete ? eventNetwork_(ev, schools) : null }, names: {} };
  EVENT_SCHOOLS.forEach(function (c) {
    const list = schools[c], st = eventStats_(list), teachers = list.filter(function (x) { return x.person.role === 'Teacher'; });
    const notIn = list.filter(function (x) { return !x.r.opened; }), stuck = list.filter(function (x) { return x.r.opened && !x.r.finished; });
    const tNot = teachers.filter(function (x) { return !x.r.opened; });
    out.sum.stats[c] = st;
    out.names[c] = { notIn: eventNames_(notIn), stuck: eventNames_(stuck), nudge: eventNudge_(st, notIn, stuck, principal[c]),
      teachers: { n: teachers.length - tNot.length, of: teachers.length, notIn: eventNames_(tNot) } };
    eventCachePut_(cache, nameKey(c), out.names[c], EVENT_SHARED_S);
  });
  eventCachePut_(cache, sumKey, out.sum, EVENT_SHARED_S);
  return out;
}

function eventLoad_() {
  const now = gameNow_(), book = gameBook_();
  return { now: now, dayKey: gameDayKey_(now), book: book, cfg: gameParseConfig_(book.getSheetByName('Game Config').getDataRange().getValues()) };
}

// ── actions ──────────────────────────────────────────────────────────
// GET gameevent -> { success, event: null | { id, name, emoji, date, showTo, role, steps: [{ id, emoji, label, go, done, self, hint? }], done, total,
//   finished, buddy, school: { pct, level } | null, network: { schoolsAtGoal, of, goalPct, reward, line } | null, teachersIn? } }
// The caller's own steps are live; school, network and teachersIn come from eventShared_ (up to 60 s old) and are left out with no roster.
function eventGet_(caller, params) {
  try {
    const L = eventLoad_(), ev = eventActive_(L.cfg, L.dayKey);
    if (!ev || !eventStepsFor_(ev, caller.primaryRole, caller.functions).length) return { success: true, event: null };
    const ctx = { caller: caller, cfg: L.cfg, now: L.now, data: eventData_(L.book, ev, L.dayKey) };
    const me = { email: gameLower_(caller.email), role: caller.primaryRole, campusId: eventCampus_(caller.campusId), functions: caller.functions || [] };
    const mine = eventPerson_(ev, me, ctx);
    if (L.dayKey > ev.date && mine.finished) return { success: true, event: null }; // finished: after its own day the card steps aside (a step that can't be told never pins it up)
    const sh = eventShared_(ev, ctx), complete = sh.sum.complete === true, own = complete && eventHas_(sh.sum.stats, me.campusId) ? sh.sum.stats[me.campusId] : null;
    const out = { id: ev.id, name: String(ev.name || ''), emoji: String(ev.emoji || ''), date: ev.date, showTo: eventEnd_(ev), role: me.role,
      steps: mine.steps.map(function (x) {
        return { id: x.step.id, emoji: String(x.step.emoji || ''), label: String(x.step.label || ''), go: String(x.step.go || ''), done: x.state === true, self: x.step.check === 'self' };
      }),
      done: mine.done, total: mine.total, finished: mine.finished, buddy: eventBuddy_(ev, mine.done, mine.total, mine.finished),
      school: own ? { pct: own.pct, level: own.level } : null, network: complete ? sh.sum.network : null };
    const st = ev.story;
    if (st && st.intro && typeof st.intro[me.role] === 'string') out.story = { chapter: +st.chapter || 1, of: +st.of || 1, title: String(st.title || ''), intro: mine.finished && st.done ? String(st.done) : st.intro[me.role] };
    if (me.role === 'Principal' && own) { // the Principal's own teachers only
      const t = sh.names[me.campusId].teachers;
      out.teachersIn = { n: t.n, of: t.of, notIn: t.notIn };
      mine.steps.forEach(function (x, i) { if (x.step.hint === 'teachersIn') out.steps[i].hint = t.n + ' of ' + t.of + ' teachers are in'; });
    }
    return { success: true, event: out };
  } catch (err) {
    console.error('gameevent: ' + (err && err.message)); // a raw message may carry data, so it is logged, never returned
    return eventFail_('EVENT_ERROR');
  }
}

// POST gameeventtick {eventId, stepId} -> { success, stepId, unchanged }. Only a `self` step of the caller's own steps in the running event.
function eventTick_(caller, body) {
  try {
    body = body && typeof body === 'object' ? body : {};
    const eventId = typeof body.eventId === 'string' ? body.eventId : '', stepId = typeof body.stepId === 'string' ? body.stepId : '';
    const L = eventLoad_(), ev = eventActive_(L.cfg, L.dayKey);
    if (!ev || ev.id !== eventId) return eventFail_('EVENT_NOT_ACTIVE');
    const step = eventStepsFor_(ev, caller.primaryRole, caller.functions).filter(function (s) { return s.id === stepId; })[0];
    if (!step || step.check !== 'self') return eventFail_('EVENT_NOT_SELF');
    const me = gameLower_(caller.email), key = 'event:' + ev.id + ':' + step.id;
    return gameWithLock_(function () { // read under the lock: a double tap writes one row
      const sh = L.book.getSheetByName('Game Progress');
      const have = sh.getDataRange().getValues().slice(1).some(function (r) { return gameLower_(r[0]) === me && r[1] === EVENT_KIND && String(r[2]) === key; });
      if (!have) gameAppendText_(sh, [[me, EVENT_KIND, key, 'done', L.now.toISOString()]]);
      return { success: true, stepId: step.id, unchanged: have };
    });
  } catch (err) {
    console.error('gameeventtick: ' + (err && err.message));
    return eventFail_('EVENT_ERROR');
  }
}

// GET gameeventboard (Owner only) -> { success, day, rosterIncomplete, event: null | { id, name, emoji, date, showTo, goalPct, reward, upcoming },
//   schools: [{ id, name, people, in, done, pct, level, notIn: [names], stuck: [names], nudge }], network | null }
// Before the day it shows the next event (upcoming: true), so the Owner can see who is expected. Numbers are up to 60 s old (eventShared_).
function eventBoard_(caller, params) {
  if (!caller || caller.primaryRole !== 'Owner') return eventFail_('EVENT_OWNER_ONLY'); // before anything is read
  try {
    const L = eventLoad_(), active = eventActive_(L.cfg, L.dayKey);
    const ev = active || eventList_(L.cfg).filter(function (e) { return e.date > L.dayKey; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; })[0];
    if (!ev) return { success: true, day: L.dayKey, event: null };
    const sh = eventShared_(ev, { caller: caller, cfg: L.cfg, now: L.now, data: eventData_(L.book, ev, L.dayKey) });
    return { success: true, day: L.dayKey, rosterIncomplete: sh.sum.complete !== true,
      event: { id: ev.id, name: String(ev.name || ''), emoji: String(ev.emoji || ''), date: ev.date, showTo: eventEnd_(ev), goalPct: +ev.goalPct || 80, reward: String(ev.reward || ''), upcoming: !active },
      schools: EVENT_SCHOOLS.map(function (c) {
        const n = sh.names[c];
        return Object.assign({ id: c, name: gameCampusLabel_(c) }, sh.sum.stats[c], { notIn: n.notIn, stuck: n.stuck, nudge: n.nudge });
      }),
      network: sh.sum.network };
  } catch (err) {
    console.error('gameeventboard: ' + (err && err.message));
    return eventFail_('EVENT_ERROR');
  }
}

// ── registration (this file's own functions only) ───────────────────
GAME_MODULE_ACTIONS.gameevent = eventGet_;
GAME_MODULE_ACTIONS.gameeventboard = eventBoard_;
