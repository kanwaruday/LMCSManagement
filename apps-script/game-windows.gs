// ═══════════════════════════════════════════════════════════════════
// LMCS Game Backend -- decision windows. A window is a stated period in which a named role makes a
// real settings call for its own scope (e.g. the Principal picks the track-suit days for their campus).
// The decision writes a real setting and is logged in Game Decisions; if nobody decides by the close
// date the window's default applies (logged as default_applied); the Owner can override any time
// (logged as override). Shown as a date, never a countdown.
//
// Pure functions over sheet rows (header first, like gameParseConfig_): the caller reads the tabs,
// these decide, the caller appends the returned rows and applies gameDecisionWrites_. Part of the
// "game" project; the shared registries/helpers live in game.gs. Load order is not controlled, so game.gs
// symbols are used only inside function bodies. `cfg` is optional everywhere (defaults to season 0).
//
// ponytail: windows are day-granular in IST (Opens/Closes are dates; Closes is inclusive). Only the
//   pickN choice type exists; add types to gameCheckChoice_ when a second window needs one.
// ═══════════════════════════════════════════════════════════════════

var GAME_MODULE_ACTIONS = GAME_MODULE_ACTIONS || {};
var GAME_MODULE_MISSIONS = GAME_MODULE_MISSIONS || {};
var GAME_MODULE_QUESTS = GAME_MODULE_QUESTS || {};

// ── dates (IST, day granularity) ─────────────────────────────────────
// Date, 'YYYY-MM-DD' or ISO timestamp -> 'YYYY-MM-DD' (IST); '' when blank or unreadable
function gameDateKey_(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return v.trim();
  const d = v instanceof Date ? v : new Date(String(v));
  if (isNaN(d.getTime())) return '';
  return new Date(d.getTime() + GAME_IST_OFFSET_MIN * 60000).toISOString().slice(0, 10);
}

// 'YYYY-MM-DD' -> 'Sat 8 Nov'
function gameDateLabel_(key) {
  const d = new Date(key + 'T00:00:00Z');
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' +
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
}

// ── parsing ──────────────────────────────────────────────────────────
function gameJsonCell_(v, fallback) {
  if (v !== null && typeof v === 'object') return v;
  try { return JSON.parse(String(v)); } catch (err) { return fallback; }
}

function gameParseWindow_(r) {
  return {
    windowId: String(r[0] || '').trim(), title: String(r[1] || ''), question: String(r[2] || ''),
    scope: String(r[3] || '').trim(), scopeId: String(r[4] || '').trim(), decider: String(r[5] || '').trim(),
    choice: gameJsonCell_(r[6], null), defaultValue: gameJsonCell_(r[7], null),
    opens: gameDateKey_(r[8]), closes: gameDateKey_(r[9]), appliesFrom: gameDateKey_(r[10]),
    writes: String(r[11] || '').trim(), openedBy: String(r[12] || ''), confirmBy: String(r[13] || ''),
  };
}

function gameParseWindows_(rows) {
  return rows.slice(1).map(gameParseWindow_).filter(function (w) { return w.windowId; });
}

function gameParseDecisions_(rows) {
  return rows.slice(1).filter(function (r) { return r[0]; }).map(function (r) {
    return { windowId: String(r[0]), scopeId: String(r[1]), value: gameJsonCell_(r[2], null), note: String(r[3] || ''),
      decidedBy: String(r[4] || ''), decidedAt: r[5] instanceof Date ? r[5].toISOString() : String(r[5] || ''), kind: String(r[6] || 'decided') };
  });
}

// Decision -> a Game Decisions row, in column order, Value as JSON text
function gameDecisionRow_(d) {
  return [d.windowId, d.scopeId, JSON.stringify(d.value), d.note || '', d.decidedBy || '', d.decidedAt, d.kind];
}

// the scope ids a window covers: '*' = the pilot campuses of its decider's role
function gameWindowScopeIds_(w, cfg) {
  if (w.scopeId !== '*') return w.scopeId.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  const pilot = cfg.pilotCampuses[w.decider];
  return Array.isArray(pilot) ? pilot : [];
}

// scope ids the caller may see (board): the window's scope, narrowed to the caller's campuses (null = all)
function gameCallerScopeIds_(caller, w, cfg) {
  const ids = gameWindowScopeIds_(w, cfg), vis = gameVisibleCampuses_(caller);
  return vis ? ids.filter(function (id) { return vis.indexOf(id) !== -1; }) : ids;
}

// scope ids a non-Owner may DECIDE: the window's real scope, only their own campus (an ALL-campus Principal decides nothing)
function gameDecidableScopeIds_(caller, w, cfg) {
  return gameWindowScopeIds_(w, cfg).filter(function (id) { return id === caller.campusId; });
}

// the latest decision for each window+scope wins (an Owner override comes after the original)
function gameLatestDecisions_(decisions) {
  const out = {};
  decisions.forEach(function (d) { out[d.windowId + '|' + d.scopeId] = d; });
  return out;
}

function gameCfg_(cfg) { return cfg || gameParseConfig_([['Key', 'Value']]); }

// 'open' | 'closed' | 'notyet' | 'unset' (no dates yet: the template is closed until the Owner opens it)
function gameWindowState_(w, now) {
  if (!w.opens || !w.closes) return 'unset';
  const today = gameDateKey_(now);
  return today < w.opens ? 'notyet' : today > w.closes ? 'closed' : 'open';
}

// ── Principal's view ─────────────────────────────────────────────────
// Open windows where the caller is the decider, one item per campus they may decide.
// current = what stands now: the decision, else the real setting, else the window's default.
function gameWindowsFor_(caller, windowRows, decisionRows, now, cfg) {
  cfg = gameCfg_(cfg);
  const latest = gameLatestDecisions_(gameParseDecisions_(decisionRows)), out = [];
  gameParseWindows_(windowRows).forEach(function (w) {
    if (caller.roles.indexOf(w.decider) === -1 || gameWindowState_(w, now) !== 'open') return;
    gameDecidableScopeIds_(caller, w, cfg).forEach(function (scopeId) {
      const decided = latest[w.windowId + '|' + scopeId] || null;
      const setting = cfg[w.writes] && cfg[w.writes][scopeId];
      out.push({ windowId: w.windowId, title: w.title, question: w.question, scopeId: scopeId, choice: w.choice,
        current: decided ? decided.value : (setting !== undefined ? setting : w.defaultValue),
        closes: gameDateLabel_(w.closes), decided: decided });
    });
  });
  return out;
}

// ── Coordinator / Owner board ────────────────────────────────────────
// Every campus a window covers, once it has opened (open or closed). Coordinators are network-wide.
function gameWindowBoard_(caller, windowRows, decisionRows, now, cfg) {
  if (caller.roles.indexOf('Owner') === -1 && caller.roles.indexOf('Coordinator') === -1) return [];
  cfg = gameCfg_(cfg);
  const latest = gameLatestDecisions_(gameParseDecisions_(decisionRows)), out = [];
  gameParseWindows_(windowRows).forEach(function (w) {
    const st = gameWindowState_(w, now);
    if (st !== 'open' && st !== 'closed') return;
    gameCallerScopeIds_(caller, w, cfg).forEach(function (scopeId) {
      const d = latest[w.windowId + '|' + scopeId];
      if (d) out.push({ windowId: w.windowId, scopeId: scopeId, state: d.kind === 'default_applied' ? 'default_applied' : 'decided', value: d.value });
      else if (st === 'closed') out.push({ windowId: w.windowId, scopeId: scopeId, state: 'default_applied', value: w.defaultValue }); // the close default, not yet written
      else out.push({ windowId: w.windowId, scopeId: scopeId, state: 'waiting', value: null });
    });
  });
  return out;
}

// ── Deciding ─────────────────────────────────────────────────────────
// win = a parsed window (raw ScopeId, e.g. '*'); scopeId = the campus being decided; existing = the latest
// decision for it or null. Every caller, the Owner included, needs scopeId in the window's real scope set.
// The Owner then skips role/campus/date/already-decided checks; an Owner decision is always logged as an override.
function gameValidateDecision_(caller, win, scopeId, value, existing, now, cfg) {
  cfg = gameCfg_(cfg);
  const isOwner = caller.roles.indexOf('Owner') !== -1;
  const notYours = { ok: false, error: "That campus isn't yours to decide." };
  if (!isOwner && caller.roles.indexOf(win.decider) === -1) return { ok: false, error: 'Only the ' + win.decider + ' decides this.' };
  if (gameWindowScopeIds_(win, cfg).indexOf(scopeId) === -1) return notYours;
  if (!isOwner) {
    if (gameDecidableScopeIds_(caller, win, cfg).indexOf(scopeId) === -1) return notYours;
    const st = gameWindowState_(win, now);
    if (st === 'closed') return { ok: false, error: 'This window closed on ' + gameDateLabel_(win.closes) + '.' };
    if (st === 'notyet') return { ok: false, error: 'This window opens on ' + gameDateLabel_(win.opens) + '.' };
    if (st === 'unset') return { ok: false, error: 'This window is not open yet.' };
    if (existing) return { ok: false, error: 'Already decided on ' + gameDateLabel_(gameDateKey_(existing.decidedAt)) + '. The Owner can change it.' };
  }
  const bad = gameCheckChoice_(win.choice, value);
  if (bad) return { ok: false, error: bad };
  return { ok: true, kind: isOwner ? 'override' : 'decided' };
}

// null when value is a valid answer to the choice, else the plain message
function gameCheckChoice_(choice, value) {
  if (!choice || choice.type !== 'pickN' || !Array.isArray(choice.options) || !(choice.n > 0)) return "This window can't be decided here yet.";
  const picks = Array.isArray(value) ? value : [];
  for (let i = 0; i < picks.length; i++) if (choice.options.indexOf(picks[i]) === -1) return picks[i] + " isn't one of the options.";
  const distinct = picks.filter(function (p, i) { return picks.indexOf(p) === i; });
  if (!Array.isArray(value) || distinct.length !== picks.length || picks.length !== choice.n) return 'Pick exactly ' + choice.n + ' days.';
  return null;
}

// ── Defaults ─────────────────────────────────────────────────────────
// Closed windows: a default_applied decision for each covered scope with no decision yet, to append.
function gameApplyDefaults_(windowRows, decisionRows, now, cfg) {
  cfg = gameCfg_(cfg);
  const latest = gameLatestDecisions_(gameParseDecisions_(decisionRows)), out = [];
  gameParseWindows_(windowRows).forEach(function (w) {
    if (gameWindowState_(w, now) !== 'closed') return;
    gameWindowScopeIds_(w, cfg).forEach(function (scopeId) {
      if (latest[w.windowId + '|' + scopeId]) return;
      out.push({ windowId: w.windowId, scopeId: scopeId, value: w.defaultValue, note: '', decidedBy: '', decidedAt: now.toISOString(), kind: 'default_applied' });
    });
  });
  return out;
}

// The real setting a decision writes: Writes 'trackSuitDays' + scope LMS4 -> trackSuitDays.LMS4 = value
function gameDecisionWrites_(win, scopeId, value) {
  return { key: win.writes, path: win.writes + '.' + scopeId, value: value };
}
