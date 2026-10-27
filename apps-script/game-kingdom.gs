var GAME_MODULE_ACTIONS = GAME_MODULE_ACTIONS || {};
var GAME_MODULE_MISSIONS = GAME_MODULE_MISSIONS || {};
var GAME_MODULE_QUESTS = GAME_MODULE_QUESTS || {};

// ═══════════════════════════════════════════════════════════════════
// LMCS Game Backend -- the Owner's Kingdom read model: action `gamekingdom` (GET, pure read, writes nothing, so a peek is safe).
// The valley: the HES Darbar at the centre and the six school bases. A base's buildings are setup quests (cq: engine quests, the Fee
// Clerk's Day Book quest, the Owner's "Set up the game" steps); a building's level = its leading done tiers; a base's level comes from
// the sum of its building levels (Game Config `kingdom.levelAt`). A tier that cannot be checked is `unknown` or `soon` and never counted.
// Scope: the Owner sees everything; a Principal sees only their own base (no heads, cards, advice or owner names); anyone else is refused
// before anything is read. Rank is never computed here (private, Phase 2). Counts only: no personal data about people is read.
// Every weight and threshold is config (kingdomCfg_). Only this file's own functions are used at top level (load order).
// ═══════════════════════════════════════════════════════════════════

// copy of COORD_APR_FOLLOW_SKIP (coordinator-approvals.gs, another project): tracked in Hiring, never a follow-up card
var KINGDOM_FOLLOW_SKIP = ['New/ Backup Position', 'Salary Offer Approval'];
var KINGDOM_NOT_YOURS = { success: false, code: 'KINGDOM_NOT_YOURS', error: 'The Kingdom is for the Owner.' };

// cfg.kingdom with every missing (or wrongly typed) sub-key taken from the default
function kingdomCfg_(cfg) {
  const d = gameConfigDefaults_().kingdom, k = (cfg && cfg.kingdom && typeof cfg.kingdom === 'object') ? cfg.kingdom : {}, out = {};
  Object.keys(d).forEach(function (key) {
    const v = k[key];
    out[key] = v !== undefined && v !== null && typeof v === typeof d[key] && Array.isArray(v) === Array.isArray(d[key]) ? v : d[key];
  });
  return out;
}

// MVP: only the Owner, and only when the rights list names the Owner role or their email; any other entry is ignored
function kingdomCan_(caller, right, cfg) {
  if (!caller || (caller.roles || []).indexOf('Owner') === -1) return false;
  const r = kingdomCfg_(cfg).rights[right];
  if (!r) return false;
  return (Array.isArray(r.roles) && r.roles.indexOf('Owner') !== -1) || (Array.isArray(r.emails) && r.emails.indexOf(gameLower_(caller.email)) !== -1);
}

// leading true values; a false or null stops it
function kingdomBuildingLevel_(tierStates) {
  let n = 0;
  while (n < tierStates.length && tierStates[n] === true) n++;
  return n;
}

// highest L (1-based) with points >= levelAt[L-1]; never below 1
function kingdomBaseLevel_(points, levelAt) {
  let level = 1;
  for (let i = 0; i < levelAt.length; i++) if (points >= levelAt[i]) level = i + 1;
  return level;
}

// ── ref resolvers: (ctx, campusId, arg) -> true | false | null (null = cannot be told, never counted) ──
function kingdomCqDef_(ctx, id) {
  if (!ctx.defs) ctx.defs = cqDefs_(ctx.cfg, false);
  return ctx.defs.filter(function (d) { return d.id === id; })[0] || null;
}
// the engine scope a quest has at a base, or null (campus quest not run there, self quest: null in the MVP)
function kingdomCqScope_(def, campusId) {
  if (def.scope === 'network') return { scopeKey: 'network', campus: null };
  if (def.scope === 'campus' && def.campuses.indexOf(campusId) !== -1) return { scopeKey: 'campus:' + campusId, campus: campusId };
  return null;
}
function kingdomCqView_(ctx, def, scope) {
  const key = def.id + '|' + scope.scopeKey;
  if (!Object.prototype.hasOwnProperty.call(ctx.views, key)) {
    try { ctx.views[key] = cqView_(ctx.caller, def, scope, ctx.setupRows, {}); } catch (err) { console.error('kingdom cq view ' + def.id + ': ' + (err && err.message)); ctx.views[key] = null; }
  }
  return ctx.views[key];
}
function kingdomRefCq_(ctx, campusId, id) {
  const def = kingdomCqDef_(ctx, id), scope = def && kingdomCqScope_(def, campusId);
  if (!scope) return null;
  const view = kingdomCqView_(ctx, def, scope);
  return !view || view.prefillDown ? null : view.ring.done;
}
function kingdomRefSetup_(ctx, campusId, arg) {
  if (arg !== 'game' || campusId !== 'HES' || ctx.caller.primaryRole !== 'Owner') return null; // the Owner's own steps: never shown to anyone else
  try { return setupSteps_(ctx.cfg).every(function (s) { return s.done; }); } catch (err) { console.error('kingdom setup steps: ' + (err && err.message)); return null; }
}
function kingdomRefDaybook_(ctx, campusId, step) {
  const q = ctx.daybook ? daybookSetupQuest_(ctx.daybook, campusId) : null, s = q && q.steps.filter(function (x) { return x.id === step; })[0];
  return s ? s.done : null;
}
function kingdomRefBuddy_(ctx, campusId, arg) {
  if (arg !== 'desk') return null;
  try { return buddyDesk_(ctx.now.getTime()).seenAt !== null; } catch (err) { return null; }
}
var KINGDOM_REFS = { cq: kingdomRefCq_, setup: kingdomRefSetup_, 'daybook-setup': kingdomRefDaybook_, buddy: kingdomRefBuddy_ };

function kingdomRef_(ctx, campusId, ref) {
  const i = ref.indexOf(':'), type = i === -1 ? ref : ref.slice(0, i), arg = i === -1 ? '' : ref.slice(i + 1);
  if (!Object.prototype.hasOwnProperty.call(KINGDOM_REFS, type)) return null; // `soon` and anything unknown
  return KINGDOM_REFS[type](ctx, campusId, arg);
}
// shown "coming soon": the `soon` ref, or an engine quest that is inactive, missing, self-scoped or not run at this base
function kingdomIsSoon_(ctx, campusId, ref) {
  if (ref === 'soon') return true;
  if (ref.indexOf('cq:') !== 0) return false;
  const def = kingdomCqDef_(ctx, ref.slice(3));
  return !def || !kingdomCqScope_(def, campusId);
}

// one tier -> { n, label, state, go, questId?, stepId?, owner?, steps? }
function kingdomTier_(ctx, campusId, tier, n) {
  const refs = tier.refs || [], rs = refs.map(function (r) { return kingdomRef_(ctx, campusId, r); });
  const done = rs.every(function (r) { return r === true; });
  const soon = refs.some(function (r) { return kingdomIsSoon_(ctx, campusId, r); });
  const out = { n: n, label: String(tier.label), state: done ? 'done' : soon ? 'soon' : rs.indexOf(null) !== -1 ? 'unknown' : 'open', go: '' };
  const ref = refs[0] || '';
  if (ref.indexOf('cq:') === 0 && out.state !== 'soon') {
    const def = kingdomCqDef_(ctx, ref.slice(3)), scope = def && kingdomCqScope_(def, campusId), view = scope && kingdomCqView_(ctx, def, scope);
    if (view) out.go = cqGo_(view);
    if (def) {
      out.questId = def.id; // the bare engine quest id (what kingdomassign takes), assignable only when the tier lists it in `owners`
      const o = scope && ctx.owners && ctx.owners[def.id + '|' + scope.scopeKey];
      if (o && ctx.names) out.owner = { email: o.email, name: ctx.names[o.email] || '' };
    }
    if (!(tier.owners || []).length) delete out.questId;
  } else if (ref === 'setup:game') {
    out.go = 'owner/index.html';
    if (ctx.caller.primaryRole === 'Owner') {
      try { out.steps = setupSteps_(ctx.cfg).map(function (s) { return { id: s.id, title: s.title, done: s.done, guide: s.guide }; }); } catch (err) { /* the tier state already says unknown */ }
    }
  } else if (ref.indexOf('daybook-setup:') === 0 && ctx.daybook) {
    const q = daybookSetupQuest_(ctx.daybook, campusId), s = q && q.steps.filter(function (x) { return x.id === ref.slice(14); })[0];
    if (s) { out.go = s.go; out.questId = q.questId; out.stepId = s.id; }
  }
  return out;
}

function kingdomBuildings_(ctx, campus, cfgK) {
  const darbar = campus.darbar === true;
  return cfgK.buildings.filter(function (b) { return (b.where === 'darbar') === darbar; }).map(function (b) {
    const tiers = b.tiers.map(function (t, i) { return kingdomTier_(ctx, campus.id, t, i + 1); });
    return { id: b.id, name: b.name, level: kingdomBuildingLevel_(tiers.map(function (t) { return t.state === 'done' ? true : t.state === 'open' ? false : null; })), maxLevel: tiers.length, tiers: tiers };
  });
}

// latest `_owner:<quest>` row per (quest, scope) from Setup Data rows; 'cleared' removes it. -> { '<questId>|<scopeKey>': { email, at, by } }
function kingdomOwners_(setupRows) {
  const out = {};
  (setupRows || []).forEach(function (r) {
    if (String(r.quest).indexOf('_owner:') !== 0) return;
    const key = String(r.quest).slice(7) + '|' + r.scope;
    if (r.status === 'cleared' || !r.value) delete out[key];
    else out[key] = { email: gameLower_(r.value), at: r.at, by: r.by || '' };
  });
  return out;
}

// Approved, not archived, not a hiring request, nobody following it up, decided in the last cardWindowDays; oldest first; at most cardsMax
function kingdomCards_(approvalsRows, nowMs, cfgK) {
  const out = [], from = nowMs - cfgK.cardWindowDays * 86400000;
  (approvalsRows || []).slice(1).forEach(function (r) {
    if (!r[0] || String(r[13]) !== 'Approved' || String(r[18] || '').toUpperCase() === 'TRUE' || KINGDOM_FOLLOW_SKIP.indexOf(String(r[2])) !== -1 || String(r[19] || '').trim() !== '') return;
    const at = r[15] ? new Date(r[15]).getTime() : NaN;
    if (!isFinite(at) || at < from || at > nowMs) return;
    out.push({ at: at, card: { id: String(r[0]), kind: 'approval_followup', title: String(r[4]), campus: String(r[1]).trim(), category: String(r[2]), decidedAt: new Date(at).toISOString() } });
  });
  out.sort(function (a, b) { return a.at - b.at; });
  return out.slice(0, cfgK.cardsMax).map(function (x) { return x.card; });
}

// finance (or all-function) heads -> the Day Book approvals still waiting for a decision, as that head's missions
function kingdomHeadMissions_(ctx, cfgK) {
  const out = {};
  if (!ctx.daybook) return out;
  cfgK.heads.forEach(function (h) {
    if (!h || !h.id || !Array.isArray(h.functions) || (h.functions.indexOf('finance') === -1 && h.functions.indexOf('all') === -1)) return;
    out[h.id] = daybookApproveList_(ctx.daybook, gameLower_(h.email)).filter(function (m) { return !m.done; });
  });
  return out;
}

// the allowlist's rows without the header (first sheet: email, name, campus, roles, canDecide); [] when it cannot be read
function kingdomAllowRows_() {
  try { return SpreadsheetApp.openById(GAME_ALLOWLIST_SHEET_ID).getSheets()[0].getDataRange().getValues().slice(1); } catch (err) { console.error('kingdom allowlist: ' + (err && err.message)); return []; }
}

// email -> name from allowlist rows, only for the emails asked about
function kingdomNames_(emails, allowRows) {
  const out = {};
  (allowRows || []).forEach(function (r) {
    const e = gameLower_(r[0]);
    if (emails.indexOf(e) !== -1) out[e] = String(r[1] || '').trim();
  });
  return out;
}

// first rule that matches (Owner only)
function kingdomAdvice_(bases, cards) {
  for (let i = 0; i < bases.length; i++) {
    for (let j = 0; j < bases[i].buildings.length; j++) {
      const tiers = bases[i].buildings[j].tiers;
      for (let k = 0; k < tiers.length; k++) {
        if (tiers[k].state === 'open' && tiers[k].assignable && !tiers[k].owner) {
          return { text: 'Assign ' + tiers[k].label + ' at ' + bases[i].name + '. One tap does it.', go: '#base-' + bases[i].id };
        }
      }
    }
  }
  if (cards.length) return { text: 'An approved request is waiting for someone to follow it up.', go: '' };
  return { text: 'Every building that can be checked is up to date.', go: '' };
}

function kingdomGet_(caller, params) {
  const isOwner = caller.primaryRole === 'Owner', isPrincipal = caller.primaryRole === 'Principal';
  if (!isOwner && !isPrincipal) return KINGDOM_NOT_YOURS; // before anything is read
  try {
    const cfg = cqLoadCfg_(), cfgK = kingdomCfg_(cfg), now = gameNow_(), sourcesDown = [];
    // a Principal's list is cut to their own base BEFORE any building is computed
    const campuses = cfgK.campuses.filter(function (c) { return isOwner || c.id === caller.campusId; });
    const setupRows = cqRead_();
    let daybook = null;
    try { daybook = daybookProgress_(caller); } catch (err) { console.error('kingdom office: ' + (err && err.message)); sourcesDown.push('office'); }
    const owners = isOwner ? kingdomOwners_(setupRows) : null, ownerEmails = isOwner ? Object.keys(owners).map(function (k) { return owners[k].email; }) : [];
    let allow = null; // the allowlist, read once and only when the Owner's response needs it (owner names, assignees)
    const allowRows = function () { if (allow === null) allow = kingdomAllowRows_(); return allow; };
    const names = isOwner ? kingdomNames_(ownerEmails, ownerEmails.length ? allowRows() : []) : null;
    const ctx = { caller: caller, cfg: cfg, now: now, setupRows: setupRows, daybook: daybook, approvals: null, owners: owners, names: names, views: {}, defs: null };

    const bases = campuses.map(function (c) {
      const buildings = kingdomBuildings_(ctx, c, cfgK);
      buildings.forEach(function (b) {
        const spec = cfgK.buildings.filter(function (x) { return x.id === b.id; })[0];
        b.tiers.forEach(function (t, i) {
          if (!(isOwner && t.state === 'open' && t.questId && ((spec.tiers[i] || {}).owners || []).length)) return;
          t.assignable = true;
          const def = kingdomCqDef_(ctx, t.questId); // the people the Owner may pick (names and emails: the Owner's response only)
          t.assignees = def ? kingdomAssignees_(allowRows(), def, def.scope === 'campus' ? c.id : '', cfg) : [];
        });
      });
      const points = buildings.reduce(function (n, b) { return n + b.level; }, 0);
      const unknown = buildings.reduce(function (n, b) { return n + b.tiers.filter(function (t) { return t.state === 'unknown'; }).length; }, 0);
      return { id: c.id, name: c.name, full: c.full, x: c.x, y: c.y, darbar: c.darbar === true, level: kingdomBaseLevel_(points, cfgK.levelAt), points: points, buildings: buildings, unknown: unknown };
    });
    const res = { success: true, role: isOwner ? 'Owner' : 'Principal', day: gameDayKey_(now),
      kingdom: { level: bases.reduce(function (n, b) { return n + b.level; }, 0), followupDueDays: cfgK.followupDueDays, campuses: bases }, sourcesDown: sourcesDown };
    if (isOwner) {
      let cards = [];
      try { cards = kingdomCards_(SpreadsheetApp.openById(GAME_APPROVALS_SHEET_ID).getSheetByName('Approvals').getDataRange().getValues(), now.getTime(), cfgK); } catch (err) { console.error('kingdom approvals: ' + (err && err.message)); sourcesDown.push('approvals'); }
      const missions = kingdomHeadMissions_(ctx, cfgK);
      res.heads = cfgK.heads.filter(function (h) { return h && h.id; }).map(function (h) { return { id: h.id, name: h.name, functions: h.functions, colour: h.colour, missions: missions[h.id] || [] }; });
      res.cards = cards;
      // follow-up picker: only heads who are Coordinators on the allowlist (the Coordinator backend refuses anyone else); Owner response only
      const rows = allowRows();
      res.followHeads = cfgK.heads.filter(function (h) {
        const r = h && h.id && h.email ? rows.filter(function (x) { return gameLower_(x[0]) === gameLower_(h.email); })[0] : null;
        return r && String(r[3] || '').split(',').map(function (x) { return x.trim(); }).indexOf('Coordinator') !== -1;
      }).map(function (h) { return { id: h.id, name: h.name, email: gameLower_(h.email), functions: h.functions }; });
      res.advice = kingdomAdvice_(bases, cards);
    }
    return res;
  } catch (err) {
    console.error('kingdom: ' + (err && err.message)); // a raw message may carry data, so it is logged, never returned
    return { success: false, code: 'KINGDOM_ERROR', error: 'The Kingdom could not load. Try again.' };
  }
}

// ═══ Writes: kingdomassign, kingdomallocate (doPost only, dispatched from game.gs; never in GAME_MODULE_ACTIONS, so a GET is unknown) ═══
// Order in both: Owner + rights (kingdomCan_) first, then every input checked, then an audit row `requested`, the write, an audit row
// `done`. Every refusal after the rights check is audited too. Audit rows go to `Game Allocations` (append-only, plain text).
// kingdomassign writes a `_owner:<quest>` row in Setup Data (this backend owns that tab; the engine never counts that quest key).
// kingdomallocate forwards one whitelisted call, coordinatorallocate, to the Coordinator backend with the CALLER's own token, so that
// backend's own canDecide, scope and assignee checks decide (and it keeps its own record). Logs carry codes, never people or tokens.

var KINGDOM_ALLOC_TAB = 'Game Allocations';
var KINGDOM_ALLOC_HEADER = ['At', 'By', 'Action', 'Source', 'SourceId', 'Campus', 'Assignee', 'Due', 'Note', 'Phase', 'Result', 'Code'];
var KINGDOM_CODES = { KINGDOM_NO_RIGHT: 'Only the Owner can assign work for now.', KINGDOM_BAD_QUEST: 'That setup step is not available.',
  KINGDOM_BAD_CAMPUS: 'That school does not fit this step.', KINGDOM_NOT_ELIGIBLE: 'That person cannot do this step.',
  KINGDOM_BAD_INPUT: 'Something in the request does not look right.', KINGDOM_BUSY: 'The system was busy. Please try again.',
  KINGDOM_UPSTREAM: 'The Coordinator system could not be reached. Nothing was changed.', KINGDOM_ERROR: 'Something went wrong. Please try again.' };

function kingdomFail_(code) { return { success: false, code: code, error: KINGDOM_CODES[code] }; }
// a user-typed value as an audit cell: plain text, formula prefix neutralised, capped
function kingdomCell_(v, max) { return gameSafeNote_(typeof v === 'string' || typeof v === 'number' ? v : '').slice(0, max); }

// appends one KINGDOM_ALLOC_HEADER row. held = the caller already holds gameWithLock_; else it takes the lock.
function kingdomAudit_(row, held) {
  const write = function () {
    const book = gameBook_();
    let sh = book.getSheetByName(KINGDOM_ALLOC_TAB);
    if (!sh) { sh = book.insertSheet(KINGDOM_ALLOC_TAB); gameAppendText_(sh, [KINGDOM_ALLOC_HEADER]); }
    gameAppendText_(sh, [row]);
  };
  return held ? write() : gameWithLock_(write);
}
// a refusal's audit row: never throws (a busy lock or a sheet error is logged; the refusal is still returned)
function kingdomAuditRefusal_(row) {
  try { kingdomAudit_(row, false); } catch (err) { console.error('kingdom audit (refusal) not written: ' + (err && err.message)); }
}

// allowRows: allowlist rows (no header). -> {email, name} | null. The person must be on the allowlist, hold one of the quest's roles and
// see the campus: their own campus, or a network-wide role (Owner, Coordinator) or campus ALL. A network quest (campus '') fits any campus.
// cfg: reserved for L1's head-function rule.
function kingdomEligible_(allowRows, def, campus, email, cfg) {
  const e = gameLower_(email);
  if (!e || !def) return null;
  const r = (allowRows || []).filter(function (x) { return gameLower_(x[0]) === e; })[0];
  if (!r) return null;
  const roles = String(r[3] || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  if (!roles.some(function (x) { return def.roles.indexOf(x) !== -1; })) return null;
  if (def.scope === 'campus') {
    const rc = String(r[2] || '').trim().toUpperCase();
    if (rc !== campus && rc !== 'ALL' && roles.indexOf('Owner') === -1 && roles.indexOf('Coordinator') === -1) return null;
  }
  return { email: e, name: String(r[1] || '').trim() };
}

// every eligible person for the picker (Owner only), allowlist order, no repeats
function kingdomAssignees_(allowRows, def, campus, cfg) {
  const out = [], seen = {};
  (allowRows || []).forEach(function (r) {
    const p = kingdomEligible_(allowRows, def, campus, r[0], cfg);
    if (p && !seen[p.email]) { seen[p.email] = true; out.push(p); }
  });
  return out;
}

// gameWithLock_ with a lock timeout turned into KINGDOM_BUSY (an error inside fn passes through)
function kingdomLocked_(fn) {
  let entered = false;
  try { return gameWithLock_(function () { entered = true; return fn(); }); } catch (err) { if (!entered) return kingdomFail_('KINGDOM_BUSY'); throw err; }
}

// POST {quest, campus, assignee, note?, clear?: true} -> {success, owner: {email, name} | null}
function kingdomAssign_(caller, body) {
  try {
    if (!caller || (caller.roles || []).indexOf('Owner') === -1) { console.warn('kingdomassign refused: not the Owner'); return kingdomFail_('KINGDOM_NO_RIGHT'); }
    const cfg = cqLoadCfg_();
    if (!kingdomCan_(caller, 'allocate', cfg)) { console.warn('kingdomassign refused: no allocate right'); return kingdomFail_('KINGDOM_NO_RIGHT'); }
    body = body && typeof body === 'object' ? body : {};
    const clear = body.clear === true, by = gameLower_(caller.email), at = gameNow_().toISOString();
    const quest = typeof body.quest === 'string' ? body.quest : '', campus = typeof body.campus === 'string' ? body.campus.trim().toUpperCase() : '';
    const assignee = clear ? '' : (typeof body.assignee === 'string' ? gameLower_(body.assignee) : ''), note = gameSafeNote_(typeof body.note === 'string' ? body.note : '');
    const row = function (phase, result, code, who) {
      return [at, by, clear ? 'setup_owner_clear' : 'setup_owner', 'setup', kingdomCell_(quest, 80), kingdomCell_(campus, 10), who === undefined ? kingdomCell_(assignee, 200) : who, '', note, phase, result, code];
    };
    const refuse = function (code) { kingdomAuditRefusal_(row('done', 'refused', code)); return kingdomFail_(code); };

    const def = cqDefs_(cfg, false).filter(function (d) { return d.id === quest; })[0]; // the Owner may assign any active quest (no role filter)
    if (!def || def.scope === 'self') return refuse('KINGDOM_BAD_QUEST');
    if (def.scope === 'campus' ? def.campuses.indexOf(campus) === -1 : campus !== '') return refuse('KINGDOM_BAD_CAMPUS');
    const scopeKey = def.scope === 'campus' ? 'campus:' + campus : 'network';
    let person = null;
    if (!clear) {
      if (body.assignee !== undefined && typeof body.assignee !== 'string') return refuse('KINGDOM_BAD_INPUT');
      person = kingdomEligible_(kingdomAllowRows_(), def, campus, assignee, cfg);
      if (!person) return refuse('KINGDOM_NOT_ELIGIBLE');
    }
    return kingdomLocked_(function () {
      kingdomAudit_(row('requested', '', ''), true);
      const cur = kingdomOwners_(cqRead_())[def.id + '|' + scopeKey]; // read under the lock: idempotency holds against a double tap
      if (clear ? !cur : (cur && cur.email === person.email)) {
        kingdomAudit_(row('done', 'ok', 'unchanged'), true);
        return { success: true, owner: person, unchanged: true };
      }
      gameAppendText_(cqEnsureTab_(gameBook_()), [['_owner:' + def.id, scopeKey, '_quest', 'owner', clear ? '' : person.email, clear ? 'cleared' : 'assigned', note, at, by]]);
      kingdomAudit_(row('done', 'ok', '', clear ? cur.email : undefined), true); // a clear records whom it took the step from
      CQ_MEMO = null;
      return { success: true, owner: person };
    });
  } catch (err) {
    console.error('kingdomassign: ' + (err && err.message));
    return kingdomFail_('KINGDOM_ERROR');
  }
}

// UrlFetchApp POST, text/plain JSON (no preflight, as the browser does). -> the parsed reply if it carries a boolean `success`, else null.
// Logs the HTTP status only: the payload holds the caller's token.
function kingdomPost_(url, payload) {
  try {
    const res = UrlFetchApp.fetch(url, { method: 'post', contentType: 'text/plain', payload: JSON.stringify(payload), muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() !== 200) { console.error('kingdom post: HTTP ' + res.getResponseCode()); return null; }
    const j = JSON.parse(res.getContentText());
    if (!j || typeof j !== 'object' || typeof j.success !== 'boolean') { console.error('kingdom post: unexpected reply'); return null; }
    return j;
  } catch (err) { console.error('kingdom post: ' + (err && err.message)); return null; }
}

var KINGDOM_APPROVAL_ID = /^[\w\-:|.]{1,80}$/;
var KINGDOM_EMAIL = /^[^@\s]{1,64}@[^@\s]{1,190}$/;
// a real calendar date as YYYY-MM-DD
function kingdomIsDate_(s) {
  const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(s), d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return !!m && d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

// POST {approvalId, assignee, due, note?, cancel?: true} -> {success, followUp, cancelled} | the Coordinator's refusal sentence
// cancel: assignee and due may be blank (the Coordinator ignores them); if given they must still be well formed.
function kingdomAllocate_(caller, body) {
  try {
    if (!caller || (caller.roles || []).indexOf('Owner') === -1) { console.warn('kingdomallocate refused: not the Owner'); return kingdomFail_('KINGDOM_NO_RIGHT'); }
    const cfg = cqLoadCfg_();
    if (!kingdomCan_(caller, 'allocate', cfg)) { console.warn('kingdomallocate refused: no allocate right'); return kingdomFail_('KINGDOM_NO_RIGHT'); }
    body = body && typeof body === 'object' ? body : {};
    const str = function (v) { return typeof v === 'string' ? v.trim() : ''; };
    const cancel = body.cancel === true, approvalId = str(body.approvalId), assignee = str(body.assignee).toLowerCase(), due = str(body.due);
    const note = typeof body.note === 'string' ? body.note.trim() : '', by = gameLower_(caller.email), at = gameNow_().toISOString();
    const row = function (phase, result, code) {
      return [at, by, cancel ? 'approval_followup_cancel' : 'approval_followup', 'approval', kingdomCell_(approvalId, 80), '', kingdomCell_(assignee, 200), kingdomCell_(due, 10), kingdomCell_(note, 300), phase, result, String(code).slice(0, 200)];
    };
    const ok = KINGDOM_APPROVAL_ID.test(approvalId) && (body.cancel === undefined || typeof body.cancel === 'boolean') &&
      [body.approvalId, body.assignee, body.due, body.note].every(function (v) { return v === undefined || v === null || typeof v === 'string'; }) &&
      (cancel && !assignee ? true : KINGDOM_EMAIL.test(assignee)) && (cancel && !due ? true : kingdomIsDate_(due)) && note.length <= 300;
    if (!ok) { kingdomAuditRefusal_(row('done', 'refused', 'KINGDOM_BAD_INPUT')); return kingdomFail_('KINGDOM_BAD_INPUT'); }

    const first = kingdomLocked_(function () { kingdomAudit_(row('requested', '', ''), true); return null; });
    if (first) return first; // busy: nothing forwarded
    // the game lock is never held across the fetch; the Coordinator backend takes its own lock for its write
    const res = kingdomPost_(GAME_COORD_URL, { action: 'coordinatorallocate', idToken: caller.idToken, approvalId: approvalId, assignee: assignee, due: due, note: note, cancel: cancel });
    let out, audit;
    if (!res) { out = kingdomFail_('KINGDOM_UPSTREAM'); audit = row('done', 'error', 'KINGDOM_UPSTREAM'); }
    else if (!res.success) {
      const sentence = String(res.error || '').slice(0, 200) || 'The Coordinator system refused this.';
      out = { success: false, code: 'KINGDOM_REFUSED', error: sentence }; audit = row('done', 'refused', sentence);
    } else { out = { success: true, followUp: res.followUp || null, cancelled: res.cancelled === true }; audit = row('done', 'ok', ''); }
    try { kingdomAudit_(audit, false); } catch (err) { console.error('kingdom audit (done) not written: ' + (err && err.message)); } // the upstream answer stands
    return out;
  } catch (err) {
    console.error('kingdomallocate: ' + (err && err.message));
    return kingdomFail_('KINGDOM_ERROR');
  }
}

// ── registration (this file's own functions only) ───────────────────
GAME_MODULE_ACTIONS.gamekingdom = kingdomGet_;
