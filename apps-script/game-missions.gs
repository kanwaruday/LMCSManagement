// ═══════════════════════════════════════════════════════════════════
// LMCS Game Backend -- mission adapters. Pure functions: each takes rows/JSON already read by
// the caller (Task 6 loads the sources) and returns Mission[]. Nothing here reads or writes a sheet.
// Mission = { id, kind, title, why, owner, campus, go, due, core, shared, done, doneAt, doneBy,
//             rolledOver, gone, progress? }   id = "<kind>:<recordId>"
// `done` always comes from source data (a decision, a resolved task, a report row), never a tick.
// `rolledOver` is set by the framework (game-today), `core` comes from cfg.core[role].
//
// Apps Script runs every .gs of a project in one global scope in no fixed order, so this file only
// uses game.gs / game-windows.gs functions INSIDE function bodies, never at top level.
// ═══════════════════════════════════════════════════════════════════
var GAME_MODULE_ACTIONS = GAME_MODULE_ACTIONS || {};
var GAME_MODULE_MISSIONS = GAME_MODULE_MISSIONS || {};
var GAME_MODULE_QUESTS = GAME_MODULE_QUESTS || {};

const GAME_DAY_MS = 86400000;
const GAME_DONE_LOOKBACK_DAYS = 2;    // a finished (or gone) record stays visible for today and yesterday: yesterday's day is finalized this morning
const GAME_PORTAL_PDR = 'principals-daily-reporting/index.html';
const GAME_PORTAL_FOLLOWUPS = 'coordinator/followups/index.html';

// ── Copy: one plain line per kind, Buddy's voice (work/LMS Mascot Voice Guide.md) ──
// Verb first, warm, short, factual; no speed language, no guilt, no pronouns for people. Campus as "LMS 4", dates as
// "Mon 26 Oct" (IST). Done missions use the same line. Plain text: the UI never parses it as HTML.
function gameTitle_(kind, d) {
  const q = function (t) { t = String(t || '').trim(); return t ? ' \u201c' + t + '\u201d' : ''; };
  const req = (d.campus ? 'the ' + gameCampusLabel_(d.campus) + ' request' : 'the request') + q(d.title);
  switch (kind) {
    case 'ss_pace': return 'Submit ' + d.target + ' SS evaluation' + (d.target === 1 ? '' : 's') + ' today';
    case 'pdr_report': return d.date === d.today ? "Submit today's daily report" : 'Submit the daily report for ' + gameDateLabel_(d.date);
    case 'pdr_issue': return 'Close the issue' + q(d.title);
    case 'info_requested': return 'Reply to Management about' + (q(d.title) || ' the request');
    case 'approval_recommend': return 'Recommend on ' + req;
    case 'approval_wait': return 'Decide ' + req;
    case 'hiring_stall': return 'Move hiring forward on' + (q(d.title) || ' a stalled role');
    case 'followup': return 'Resolve the follow-up' + q(d.title);
    default: return d.title;
  }
}
// the small line ("why") pieces the adapters share
function gameCampusLabel_(c) { return String(c || '').replace(/^LMS\s*(\d)/i, 'LMS $1'); } // 'LMS4' -> 'LMS 4'
function gameWaiting_(days) { return 'Waiting ' + (days === 1 ? '1 day' : days + ' days'); }
const GAME_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// an issue's first-raised date, relative to the game day: 'raised today' / 'raised yesterday' / 'raised Mon 26 Oct'
function gameRaised_(first, dayKey) {
  const key = gameDateKey_(first);
  if (!key) return '';
  const y = gameDayKey_(new Date(Date.parse(dayKey + 'T12:00:00+05:30') - GAME_DAY_MS));
  return key === dayKey ? 'raised today' : key === y ? 'raised yesterday' : 'raised ' + gameDateLabel_(key);
}

// ── Small helpers ────────────────────────────────────────────────────
function gameCampusKey_(v) { return String(v || '').replace(/\s+/g, '').toUpperCase(); } // 'LMS 4' -> 'LMS4'
function gameLower_(v) { return String(v || '').trim().toLowerCase(); }
function gameIso_(v) { // Date or text from a sheet -> ISO, or '' when empty/unparseable
  if (v === '' || v === null || v === undefined) return '';
  const t = new Date(v).getTime();
  return isNaN(t) ? '' : new Date(t).toISOString();
}
function gameDueIso_(v) { return gameDateKey_(v) || null; } // a Date cell (midnight IST) reads as its IST date
// start of the previous game day (04:00 IST), as epoch ms: finished records older than this are not today's story
function gameLookbackStart_(now) {
  return Date.parse(gameDayKey_(new Date(now.getTime() - (GAME_DONE_LOOKBACK_DAYS - 1) * GAME_DAY_MS)) + 'T04:00:00+05:30');
}
function gameIsCore_(cfg, role, kind) { return !!(cfg.core && cfg.core[role] && cfg.core[role].indexOf(kind) !== -1); }

function gameMission_(kind, recordId, f) {
  return {
    id: kind + ':' + recordId, kind: kind, title: f.title, why: f.why || '', owner: f.owner || '', campus: f.campus || '',
    go: f.go, due: f.due || null, core: !!f.core, shared: !!f.shared, done: !!f.done, doneAt: f.doneAt || null, doneBy: f.doneBy || null,
    rolledOver: false, gone: !!f.gone, progress: f.progress,
  };
}

// ── SS (staff evaluations) ───────────────────────────────────────────
// ss is either one role dashboard ({ quotaPerMonth, roster }) or the all-roles response ({ roles: { <role>: dashboard } }).
function gameSsDashboards_(ss) {
  if (!ss) return [];
  if (ss.roles) return Object.keys(ss.roles).map(function (k) { return ss.roles[k]; });
  return [ss];
}

// ISO timestamps of today's SS submissions by this evaluator, oldest first
function gameSsTimes_(ss, email, dayKey) {
  const times = [], me = gameLower_(email);
  gameSsDashboards_(ss).forEach(function (dash) {
    (dash.roster || []).forEach(function (r) {
      (r.history || []).forEach(function (h) {
        const iso = gameIso_(h.timestamp);
        if (iso && gameLower_(h.evaluatorEmail) === me && gameDayKey_(new Date(iso)) === dayKey) times.push(iso);
      });
    });
  });
  return times.sort();
}
function gameSsSubmittedBy_(ss, email, dayKey) { return gameSsTimes_(ss, email, dayKey).length; }

// Working days left in the game day's month, today included, Mon-Sat (Sunday is the only rest day)
function gameWorkingDaysLeft_(now) {
  const p = gameDayKey_(now).split('-'), y = +p[0], m = +p[1] - 1, d0 = +p[2];
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  let n = 0;
  for (let d = d0; d <= last; d++) if (new Date(Date.UTC(y, m, d)).getUTCDay() !== 0) n++;
  return n;
}
function gameSsPaceTarget_(needed, now) {
  if (!(needed > 0)) return 0;
  return Math.ceil(needed / Math.max(1, gameWorkingDaysLeft_(now))); // a Sunday on the month's last day: the whole need falls on the day
}

// ── Source readers ───────────────────────────────────────────────────
// The latest non-superseded Recommendations row per approval id (RecommendedAt, ISO, decides)
function gameLatestRecs_(rows) {
  const by = {};
  (rows || []).slice(1).forEach(function (r) {
    const sup = r[9] === true || String(r[9] || '').trim().toUpperCase() === 'TRUE';
    const id = String(r[1] || '').trim();
    if (!id || sup) return;
    const at = gameIso_(r[8]);
    if (!by[id] || at >= by[id].at) by[id] = { by: String(r[4] || '').trim(), what: String(r[5] || '').trim(), reason: String(r[6] || '').trim(), at: at };
  });
  return by;
}
const GAME_REC_WORDS = { Approve: 'approve', Reject: 'reject', Info: 'ask for more information' };
function gameRecWhy_(rec) {
  return 'Recommended to ' + (GAME_REC_WORDS[rec.what] || rec.what.toLowerCase()) + ' by ' + rec.by + (rec.reason ? ': ' + rec.reason : '');
}

// Approvals rows -> plain records, every campus (Coordinator and Owner are network-wide; the Principal path filters by requester). days = waited so far, or until the decision.
function gameApprovals_(rows, now) {
  const out = [];
  (rows || []).slice(1).forEach(function (r) {
    const campus = gameCampusKey_(r[1]);
    if (!r[0]) return;
    const requestedAt = new Date(r[12]).getTime();
    if (isNaN(requestedAt)) return;
    const decidedAt = gameIso_(r[15]);
    const status = String(r[13] || '').trim();
    const decided = status === 'Approved' || status === 'Rejected' || status === 'Revoked';
    const endMs = decided && decidedAt ? new Date(decidedAt).getTime() : now.getTime();
    out.push({
      id: String(r[0]).trim(), campus: campus, title: String(r[4] || '').trim(), by: gameLower_(r[11]), status: status,
      decided: decided, decidedBy: gameLower_(r[14]), decidedAt: decidedAt, archived: String(r[18] || '').trim().toUpperCase() === 'TRUE',
      days: Math.floor((endMs - requestedAt) / GAME_DAY_MS),
    });
  });
  return out;
}

// ── Principal ────────────────────────────────────────────────────────
function gamePrincipalMissions_(caller, src, cfg, now) {
  const out = [], role = 'Principal', dayKey = gameDayKey_(now), since = gameLookbackStart_(now);
  const go = GAME_PORTAL_PDR, mine = gameLower_(caller.email);
  // An all-campus Principal (visible set null) has no campus of their own: the campus-bound missions (ss_pace, pdr_report,
  // pdr_issue) could never complete, so only the caller's own Info Requested request is emitted.
  const visible = gameVisibleCampuses_(caller), campus = visible === null ? '' : gameCampusKey_(visible[0]);
  // Sunday (the game day, IST) is the rest day: no SS target and no daily report
  const workday = new Date(dayKey + 'T00:00:00Z').getUTCDay() !== 0;

  if (campus && workday && src.ss) {
    let needed = 0;
    gameSsDashboards_(src.ss).forEach(function (dash) {
      (dash.roster || []).forEach(function (r) {
        if (gameCampusKey_(r.school) === campus) needed += Math.max(0, (dash.quotaPerMonth || 0) - (r.submissionsThisMonth || 0));
      });
    });
    const times = gameSsTimes_(src.ss, caller.email, dayKey);
    // ponytail: the day's starting need is estimated as need-now + what this person logged today, so the target does not
    // shrink as they log (a colleague's logging mid-day can still nudge it); an exact start-of-day need is in the snapshot (game-today).
    const target = gameSsPaceTarget_(needed + times.length, now);
    if (target > 0) {
      const done = times.length >= target;
      out.push(gameMission_('ss_pace', campus + ':' + dayKey, { // day-scoped, like pdr_report: tomorrow's target is a new mission
        title: gameTitle_('ss_pace', { needed: needed, target: target }), why: needed + ' still needed for ' + GAME_MONTHS[+dayKey.slice(5, 7) - 1], owner: mine, campus: campus, go: go,
        core: gameIsCore_(cfg, role, 'ss_pace'), done: done, doneAt: done ? times[target - 1] : null, doneBy: done ? mine : null,
        progress: { done: times.length, total: target },
      }));
    }
  }

  if (campus && workday && src.reports) {
    let stamp = null;
    src.reports.slice(1).forEach(function (r) { if (gameDateKey_(r[1]) === dayKey && gameCampusKey_(r[2]) === campus) stamp = stamp || gameIso_(r[0]) || dayKey; });
    out.push(gameMission_('pdr_report', campus + ':' + dayKey, {
      title: gameTitle_('pdr_report', { campus: campus, date: dayKey, today: dayKey }), owner: mine, campus: campus, go: go,
      core: gameIsCore_(cfg, role, 'pdr_report'), done: !!stamp, doneAt: stamp, doneBy: stamp ? mine : null,
    }));
  }

  if (campus && src.issues && cfg.principalIssuesReady) {
    (Array.isArray(src.issues) ? src.issues : src.issues.issues || []).forEach(function (i) {
      if (gameCampusKey_(i.campus) !== campus) return;
      const resolved = i.status === 'resolved', at = gameIso_(i.resolvedAt);
      if (resolved && !(at && new Date(at).getTime() >= since)) return; // resolved a while ago: not today's story
      out.push(gameMission_('pdr_issue', i.id, {
        title: gameTitle_('pdr_issue', { title: i.subject || i.title || i.id }), owner: mine,
        why: ['From the daily reports', gameRaised_(i.first, dayKey)].filter(Boolean).join(' \u00b7 '), campus: campus, go: cfg.principalIssuesGo,
        core: gameIsCore_(cfg, role, 'pdr_issue'), done: resolved, doneAt: resolved ? at : null, doneBy: resolved ? gameLower_(i.resolvedBy) : null,
      }));
    });
  }

  // ponytail: done for info_requested (the requester answered, status left Info Requested) is not visible in one row;
  // the framework sees the id vanish from the open set. A response log would make it exact.
  gameApprovals_(src.approvals, now).forEach(function (a) {
    if (a.by !== mine || a.status !== 'Info Requested' || a.archived) return;
    out.push(gameMission_('info_requested', a.id, {
      title: gameTitle_('info_requested', { title: a.title }), why: 'They asked for more information', owner: mine, campus: a.campus, go: go, core: gameIsCore_(cfg, role, 'info_requested'),
    }));
  });
  return out;
}

// ── Coordinator ──────────────────────────────────────────────────────
function gameApprovalsGo_(cfg) { return cfg.approvalsGo; }

function gameCoordinatorMissions_(caller, src, cfg, now) {
  const out = [], role = 'Coordinator', me = gameLower_(caller.email), since = gameLookbackStart_(now);
  const tasks = (src.tasks || []).slice(1);

  if (cfg.recommendationsReady) {
    const recs = gameLatestRecs_(src.recommendations);
    const assignee = {};
    tasks.forEach(function (t) { assignee[String(t[0]).trim()] = gameLower_(t[13]); });
    gameApprovals_(src.approvals, now).forEach(function (a) {
      if (a.archived || a.days < cfg.approvalWaitDays) return;
      const rec = recs[a.id], recommended = !!(rec && rec.reason);
      const state = recommended ? { done: true, doneAt: rec.at, doneBy: gameLower_(rec.by) } : { done: false };
      if (recommended) { if (!rec.at || new Date(rec.at).getTime() < since) return; } // recommended a while ago: not today's story
      else if (a.decided) { // the Owner decided before any recommendation: no longer needed
        if (!a.decidedAt || new Date(a.decidedAt).getTime() < since) return;
        state.gone = true;
      } else if (a.status !== 'Pending') return;
      out.push(gameMission_('approval_recommend', a.id, Object.assign({
        title: gameTitle_('approval_recommend', { campus: a.campus, days: a.days, title: a.title }),
        why: state.gone ? 'Decided before a recommendation was needed' : state.done ? '' : gameWaiting_(a.days), owner: assignee['approval|' + a.id + '|Pending'] || '', campus: a.campus, go: gameApprovalsGo_(cfg),
        core: gameIsCore_(cfg, role, 'approval_recommend'), shared: assignee['approval|' + a.id + '|Pending'] !== me,
      }, state)));
    });
  }

  tasks.forEach(function (t) {
    const id = String(t[0] || '').trim(), domain = String(t[1] || '').trim(), campus = gameCampusKey_(t[2]);
    if (!id) return;
    if (cfg.recommendationsReady && /^approval\|.*\|Pending$/.test(id)) return; // approval_recommend already covers it
    const assignee = gameLower_(t[13]), resolved = String(t[5]).trim() === 'resolved', at = gameIso_(t[9]), by = String(t[10] || '').trim();
    const stall = domain === 'hiring_stall';
    if (!stall && assignee && assignee !== me) return; // another person's follow-up
    if (resolved && !(at && new Date(at).getTime() >= since)) return;
    if (!resolved && String(t[5]).trim() !== 'open') return;
    const kind = stall ? 'hiring_stall' : 'followup', system = /^system/i.test(by);
    const gone = resolved && !stall && system; // cleared by the system, not by a person
    out.push(gameMission_(kind, id, {
      title: gameTitle_(kind, { title: String(t[3] || '').trim() }), why: gone ? 'No longer needed' : String(t[4] || '').trim(),
      owner: assignee, campus: campus, go: GAME_PORTAL_FOLLOWUPS, due: gameDueIso_(t[14]),
      core: gameIsCore_(cfg, role, kind), shared: stall || !assignee,
      done: resolved && !gone, doneAt: resolved && !gone ? at : null, doneBy: resolved && !gone ? gameLower_(by) : null, gone: gone,
    }));
  });
  return out;
}

// ── Owner ────────────────────────────────────────────────────────────
function gameOwnerMissions_(caller, src, cfg, now) {
  const out = [], role = 'Owner', since = gameLookbackStart_(now);
  const recs = cfg.recommendationsReady ? gameLatestRecs_(src.recommendations) : {};
  gameApprovals_(src.approvals, now).forEach(function (a) {
    if (a.archived || a.days < cfg.approvalWaitDays) return; // archived without a decision: gone, and the framework sees the id vanish
    if (a.decided && !(a.decidedAt && new Date(a.decidedAt).getTime() >= since)) return;
    if (!a.decided && a.status !== 'Pending') return;
    out.push(gameMission_('approval_wait', a.id, {
      title: gameTitle_('approval_wait', { campus: a.campus, days: a.days, title: a.title }), why: recs[a.id] ? gameRecWhy_(recs[a.id]) : gameWaiting_(a.days),
      owner: gameLower_(caller.email), campus: a.campus, go: gameApprovalsGo_(cfg), core: gameIsCore_(cfg, role, 'approval_wait'),
      done: a.decided, doneAt: a.decided ? a.decidedAt : null, doneBy: a.decided ? a.decidedBy : null,
    }));
  });
  return out;
}

// ── Dispatch ─────────────────────────────────────────────────────────
// Owner beats Coordinator beats Principal (primaryRole is already chosen that way). Other roles come from their
// module's registration (Teacher), else "not available yet".
function gameMissionsFor_(caller, src, cfg, now) {
  switch (caller.primaryRole) {
    case 'Principal': return gamePrincipalMissions_(caller, src, cfg, now);
    case 'Coordinator': return gameCoordinatorMissions_(caller, src, cfg, now);
    case 'Owner': return gameOwnerMissions_(caller, src, cfg, now);
  }
  if (Object.prototype.hasOwnProperty.call(GAME_MODULE_MISSIONS, caller.primaryRole)) return GAME_MODULE_MISSIONS[caller.primaryRole](caller, cfg, now);
  return { notYet: true };
}

// ── Today: fixed daily set, roll-over, days on track ─────────────────
// The Today set is fixed at a person's first load of the game day (a snapshot row of ids in Game Daily);
// later loads show the same ids with live done state. Only ids are stored, never titles or names.

// Today's set: open missions only (done / gone take no slot). Order: rolled over from yesterday, then core, then
// by due date (none last), then source order (adapters list oldest first).
function gamePick_(missions, cap, coreKinds, yesterdayOpenIds) {
  const carried = {};
  (yesterdayOpenIds || []).forEach(function (id) { carried[id] = true; });
  const rank = missions.filter(function (m) { return !m.done && !m.gone; }).map(function (m, i) {
    return { m: Object.assign({}, m, { rolledOver: !!carried[m.id] || !!m.rolledOver }), i: i,
      core: m.core || (coreKinds || []).indexOf(m.kind) !== -1 };
  });
  rank.sort(function (a, b) {
    if (a.m.rolledOver !== b.m.rolledOver) return a.m.rolledOver ? -1 : 1;
    if (a.core !== b.core) return a.core ? -1 : 1;
    if (a.m.due !== b.m.due) return !a.m.due ? 1 : !b.m.due ? -1 : (a.m.due < b.m.due ? -1 : 1);
    return a.i - b.i;
  });
  return rank.slice(0, cap).map(function (r) { return r.m; });
}

// Game Daily cell -> 'YYYY-MM-DD'. Sheets may turn the text into a Date at midnight IST.
function gameDayCell_(v) {
  return v instanceof Date ? new Date(v.getTime() + GAME_IST_OFFSET_MIN * 60000).toISOString().slice(0, 10) : String(v || '').trim();
}
function gameIdList_(v) {
  try { const a = JSON.parse(String(v)); return Array.isArray(a) ? a : []; } catch (err) { return []; }
}

// dailyRows = Game Daily values, header first. row = the 1-based sheet row (header is row 1).
function gameSnapshot_(dailyRows, email, dayKey) {
  const who = gameLower_(email);
  for (let i = 1; i < dailyRows.length; i++) {
    const r = dailyRows[i];
    if (gameDayCell_(r[0]) === dayKey && gameLower_(r[1]) === who) return { row: i + 1, missionIds: gameIdList_(r[4]), doneIds: gameIdList_(r[5]) };
  }
  return null;
}

// Judge one finished game day. counted = the snapshot held a core, non-shared mission that still exists or was seen done
// that day (snapshot.doneIds); onTrack = every such mission is done by 04:00 IST the next day. A snapshot id in doneIds
// counts as done even when it has left missionsNow. A missing id that is day-scoped to that day (ends ':<dayKey>', e.g.
// ss_pace / pdr_report) and not in doneIds expired undone (R34): counted if core, not on track. Any other id missing from
// missionsNow is gone (R9), not done. A mission done before the day began counts as done for that day (credit is Task 5's
// business, not this one's).
// ponytail: doneIds is only written on a portal visit, so work finished after the person's last visit that day counts as
// missed; Phase 2's nightly snapshot closes the gap.
function gameFinalizeDay_(snapshot, missionsNow, dayKey, cfgCore) {
  const now = {}, seenDone = {};
  missionsNow.forEach(function (m) { now[m.id] = m; });
  (snapshot.doneIds || []).forEach(function (id) { seenDone[id] = true; });
  const end = Date.parse(dayKey + 'T04:00:00+05:30') + GAME_DAY_MS;
  let counted = false, onTrack = true;
  snapshot.missionIds.forEach(function (id) {
    const m = now[id];
    if (seenDone[id]) { // recorded done and non-shared on that day: kind from the live mission, else from the id
      if ((m && m.core) || (cfgCore || []).indexOf(m ? m.kind : String(id).split(':')[0]) !== -1) counted = true;
      return;
    }
    if (!m && String(id).slice(-(dayKey.length + 1)) === ':' + dayKey) { // day-scoped, expired undone (R34)
      if ((cfgCore || []).indexOf(String(id).split(':')[0]) !== -1) { counted = true; onTrack = false; }
      return;
    }
    if (!m || m.gone || m.shared || !(m.core || (cfgCore || []).indexOf(m.kind) !== -1)) return;
    counted = true;
    if (!(m.done && (!m.doneAt || new Date(m.doneAt).getTime() < end))) onTrack = false;
  });
  return { counted: counted, onTrack: counted && onTrack };
}

// Finalized rows only. A counted day has OnTrack TRUE/FALSE; a day with nothing to count has OnTrack blank.
function gameDaysOnTrack_(dailyRows, email, monthKey) {
  const who = gameLower_(email);
  const y = +monthKey.slice(0, 4), m = +monthKey.slice(5, 7);
  const lastKey = m === 1 ? (y - 1) + '-12' : y + '-' + String(m - 1).padStart(2, '0');
  const out = { onTrack: 0, counted: 0, lastMonthOnTrack: 0, lastMonthCounted: 0 };
  const flag = function (v) { return v === true || String(v).toLowerCase() === 'true'; };
  for (let i = 1; i < dailyRows.length; i++) {
    const r = dailyRows[i];
    if (gameLower_(r[1]) !== who || !flag(r[6])) continue;
    const on = String(r[7]).toLowerCase();
    if (on !== 'true' && on !== 'false') continue;
    const month = gameDayCell_(r[0]).slice(0, 7);
    if (month === monthKey) { out.counted++; if (on === 'true') out.onTrack++; }
    else if (month === lastKey) { out.lastMonthCounted++; if (on === 'true') out.lastMonthOnTrack++; }
  }
  return out;
}
