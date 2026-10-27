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

// email -> name from the allowlist (first sheet, columns: email, name), only for the emails asked about
function kingdomNames_(emails) {
  const out = {};
  if (!emails.length) return out;
  try {
    SpreadsheetApp.openById(GAME_ALLOWLIST_SHEET_ID).getSheets()[0].getDataRange().getValues().slice(1).forEach(function (r) {
      const e = gameLower_(r[0]);
      if (emails.indexOf(e) !== -1) out[e] = String(r[1] || '').trim();
    });
  } catch (err) { console.error('kingdom names: ' + (err && err.message)); }
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
    const owners = isOwner ? kingdomOwners_(setupRows) : null;
    const names = isOwner ? kingdomNames_(Object.keys(owners).map(function (k) { return owners[k].email; })) : null;
    const ctx = { caller: caller, cfg: cfg, now: now, setupRows: setupRows, daybook: daybook, approvals: null, owners: owners, names: names, views: {}, defs: null };

    const bases = campuses.map(function (c) {
      const buildings = kingdomBuildings_(ctx, c, cfgK);
      buildings.forEach(function (b) {
        const spec = cfgK.buildings.filter(function (x) { return x.id === b.id; })[0];
        b.tiers.forEach(function (t, i) { if (isOwner && t.state === 'open' && t.questId && ((spec.tiers[i] || {}).owners || []).length) t.assignable = true; });
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
      res.advice = kingdomAdvice_(bases, cards);
    }
    return res;
  } catch (err) {
    console.error('kingdom: ' + (err && err.message)); // a raw message may carry data, so it is logged, never returned
    return { success: false, code: 'KINGDOM_ERROR', error: 'The Kingdom could not load. Try again.' };
  }
}

// ── registration (this file's own functions only) ───────────────────
GAME_MODULE_ACTIONS.gamekingdom = kingdomGet_;
