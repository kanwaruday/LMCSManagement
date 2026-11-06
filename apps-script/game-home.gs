// game-home.gs -- Home engine v2: the progressive unlock (engine-contract.md B and C; design: work/Role Screens Drafts, approved 1 Nov).
// Config, not code: Game Config `homes.<Role>` = { scene, slots: [{ id, label, emoji, at, after, fills: { quest, data }, opens }],
// schools: { <LMSn>: { scene, slots (added, or replace by id), hide: [slotId] } } } and `townhall.rooms[]` = { id, label, emoji, roles, needs, opens }.
// The server works out each state; the page only draws. A role with no `homes` row gets no `home` field (the page keeps today's look).
// Locked only hides or greys a door: nothing here blocks a page or an action.
var GAME_MODULE_FILLS = GAME_MODULE_FILLS || {}; // { 'rooms.named': fn(caller, cfg, now) -> bool }: reads only, cheap, under the lock; a throw counts as false

// `fills.quest` may say {campus}: 'rooms:{campus}:name' is the rooms quest's first step at the caller's school
function homeKey_(key, caller) { return String(key || '').replace(/\{campus\}/g, (caller && caller.campusId) || ''); }

// the role's slot list after the per-school override; null when the role has no home config
function homeConfigFor_(cfg, role, campus) {
  const base = cfg && cfg.homes && cfg.homes[role];
  if (!base || !Array.isArray(base.slots)) return null;
  const ov = (base.schools && base.schools[campus]) || {}, hide = ov.hide || [], extra = Array.isArray(ov.slots) ? ov.slots : [];
  const extraIds = extra.map(function (s) { return s.id; });
  const slots = base.slots.filter(function (s) { return hide.indexOf(s.id) === -1 && extraIds.indexOf(s.id) === -1; })
    .concat(extra.filter(function (s) { return hide.indexOf(s.id) === -1; }));
  return { scene: ov.scene || base.scene || null, slots: slots };
}

// 'questId:stepId' and 'questId' (complete) -> true, from the quests Today already worked out (built-in and module quests alike)
function homeDoneMap_(quests) {
  const done = {};
  (quests || []).forEach(function (q) {
    if (q.complete) done[q.questId] = true;
    (q.steps || []).forEach(function (s) { if (s.done) done[q.questId + ':' + s.id] = true; });
  });
  return done;
}

// a fills key (GAME_MODULE_FILLS) answered by its module; unknown key or a throw = false
function homeFillsData_(key, caller, cfg, now) {
  if (!key || !Object.prototype.hasOwnProperty.call(GAME_MODULE_FILLS, key)) return false;
  try { return GAME_MODULE_FILLS[key](caller, cfg, now) === true; } catch (err) { console.error('game home fills', key, err); return false; }
}

function homeSlotFilled_(slot, caller, cfg, now, done) {
  const f = slot.fills || {};
  return !!(f.quest && done[homeKey_(f.quest, caller)]) || homeFillsData_(f.data, caller, cfg, now);
}

// [{ id, label, emoji, at, state: 'filled' | 'building' | 'locked', after, opens }]. A slot is buildable once its `after` slot is filled;
// an `after` naming a slot this person doesn't have (hidden, mistyped) never locks it forever.
function homeSlotStates_(caller, cfg, now, done) {
  const home = homeConfigFor_(cfg, caller.primaryRole, caller.campusId);
  if (!home) return null;
  const filled = {};
  home.slots.forEach(function (s) { filled[s.id] = homeSlotFilled_(s, caller, cfg, now, done); });
  return { scene: home.scene, slots: home.slots.map(function (s) {
    const blocked = s.after && Object.prototype.hasOwnProperty.call(filled, s.after) && !filled[s.after];
    return { id: s.id, label: s.label, emoji: s.emoji || null, at: s.at || null,
      state: filled[s.id] ? 'filled' : blocked ? 'locked' : 'building', after: s.after || null, opens: s.opens || null };
  }) };
}

// The Townhall: the same building for everyone, only the doors this role has. A door with `needs` (a fills key or one of the person's
// slot ids) shows locked until that is filled. The building itself is never locked or hidden.
function homeTownhall_(caller, cfg, now, home) {
  const rooms = (cfg && cfg.townhall && Array.isArray(cfg.townhall.rooms)) ? cfg.townhall.rooms : [], role = caller.primaryRole;
  const slotState = {};
  ((home && home.slots) || []).forEach(function (s) { slotState[s.id] = s.state; });
  return { rooms: rooms.filter(function (r) { return !r.roles || r.roles.indexOf('all') !== -1 || r.roles.indexOf(role) !== -1; }).map(function (r) {
    const open = !r.needs || (Object.prototype.hasOwnProperty.call(slotState, r.needs) ? slotState[r.needs] === 'filled' : homeFillsData_(r.needs, caller, cfg, now));
    return { id: r.id, label: r.label, emoji: r.emoji || null, state: open ? 'open' : 'locked', after: open ? null : r.needs, opens: r.opens || null };
  }) };
}

// For a backend outside Today (engine-contract.md C): 'filled' | 'building' | 'locked' | null (not configured = treat as open).
// Without `done` it reads this person's recorded quest steps from Game Progress (module quests' live `done` isn't there: pass `done` when you have it).
function homeSlotState_(caller, cfg, now, slotId, done) {
  if (!done) {
    const me = gameLower_(caller.email);
    done = {};
    gameBook_().getSheetByName('Game Progress').getDataRange().getValues().forEach(function (r) {
      if (gameLower_(r[0]) === me && r[1] === 'quest_step' && r[3] === 'done') done[String(r[2])] = true;
    });
  }
  const home = homeSlotStates_(caller, cfg, now, done), s = home && home.slots.filter(function (x) { return x.id === slotId; })[0];
  return s ? s.state : null;
}

// Today's two fields (gameToday_ calls this once, after the quests): { home?, townhall }
function homeTodayFields_(caller, cfg, now, quests) {
  const home = homeSlotStates_(caller, cfg, now, homeDoneMap_(quests)), out = { townhall: homeTownhall_(caller, cfg, now, home) };
  if (home) out.home = home;
  return out;
}
