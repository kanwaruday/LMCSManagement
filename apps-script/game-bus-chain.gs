var GAME_MODULE_QUESTS = GAME_MODULE_QUESTS || {};

// ═══════════════════════════════════════════════════════════════════
// LMCS Game Backend -- the bus setup chain's staff side (V2; vault work/Role Screens Drafts.html "Bus setup chain").
// The driver walks the chain on their own page (driver/index.html: my bus, photograph the bus, route video, my riders; the steps are
// assets/game/bus-chain.js). Here the Owner and each Coordinator get one quest per campus: "<campus> bus photos: N of M", a step per
// running bus, done once that bus has a photographed safety check (BusChain.photographed, read into game-fleet.gs's cached rows).
// A step opens the staff capture page on that bus's photo check, so a Coordinator can also take the photos themself.
// Scope and lock: game-fleet.gs's (fleetScopedRows_ with cacheOnly: the quests run under the script lock and read only the cache;
// a cold cache is no quest for that load). Buses and photos only: never a person ranked, never a child.
// ═══════════════════════════════════════════════════════════════════

function busChainGo_(reg) { return 'coordinator/transport/capture.html?mode=inspection&shots=1&reg=' + encodeURIComponent(reg); }

function busChainQuests_(caller, cfg) {
  const role = caller.primaryRole;
  if (role !== 'Coordinator' && role !== 'Owner') return [];
  const rows = fleetScopedRows_(caller, cfg, true);
  if (!rows) return [];
  const shot = rows.photographed || {}, campuses = {};
  rows.fleet.forEach(function (b) { (campuses[b.campusId] = campuses[b.campusId] || { label: b.campus, buses: [] }).buses.push(b); });
  return Object.keys(campuses).sort().map(function (id) {
    const c = campuses[id], steps = c.buses.map(function (b) {
      return { id: b.reg, title: b.reg + (shot[b.reg] ? ' · photographed' : ' · photograph the empty bus'), go: busChainGo_(b.reg), done: !!shot[b.reg], locked: false };
    }), done = steps.filter(function (s) { return s.done; }).length;
    return { questId: 'bus-photos:' + id, title: '📷 ' + c.label + ' bus photos: ' + done + ' of ' + steps.length, parallel: true, steps: steps, complete: done === steps.length };
  });
}

GAME_MODULE_QUESTS.Coordinator = [].concat(GAME_MODULE_QUESTS.Coordinator || [], busChainQuests_);
GAME_MODULE_QUESTS.Owner = [].concat(GAME_MODULE_QUESTS.Owner || [], busChainQuests_);
