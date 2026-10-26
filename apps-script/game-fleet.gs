var GAME_MODULE_ACTIONS = GAME_MODULE_ACTIONS || {};
var GAME_MODULE_MISSIONS = GAME_MODULE_MISSIONS || {};
var GAME_MODULE_QUESTS = GAME_MODULE_QUESTS || {};
var GAME_CALLER_FALLBACKS = GAME_CALLER_FALLBACKS || {};
var GAME_MODULE_DONE_AT = GAME_MODULE_DONE_AT || {};

// ═══════════════════════════════════════════════════════════════════
// LMCS Game Backend -- the Fleet setup module (Fleet Command's six setup quests per bus, Buddy on the transport pages).
// Rulings B1 (amended) and B2, .superpowers/sdd/2026-10-26-fleet-buddy/progress.md:
//   Fee Clerk    daily missions for their own campus's papers, driver, fuel and parts quests
//   Coordinator  daily missions for the safety check and the route timelapse, then "get it done" follow-ups for the rest
//                (shared: the Fee Clerk does them, so no personal credit); one parallel quest per bus
//   Owner        quests only: per campus "LMS 4 fleet: N of M buses ready" (a step per bus), that campus's bus quests after it
// One source of truth (B2): fleetRows_ reads the transport workbook read-only, shaped exactly as the Coordinator backend's
// coordFleet_ shapes it (coordinator-transport.gs), and FleetQuests (coordinator/capture/fleet-quests.js, pushed into this
// project as fleet-quests.gs by projects.json) turns it into done / {done, total}, so missions agree with the Fleet setup
// counters. Missions are not core and keep no history of their own, so no GAME_MODULE_DONE_AT.
// A read failure throws (the framework then marks the day down instead of snapshotting an empty list).
// Mission order is the rank (the next-step bar shows the first open one): values to confirm first (most known items), then
// the buses closest to ready, then the rest. Every open mission is returned; the framework's cap picks today's few, and a
// mission in today's set never vanishes because another one moved ahead of it.
// Only this file's own functions are used at top level (load order: tests/apps-script/test-load-order.js).
// ═══════════════════════════════════════════════════════════════════

var FLEET_BOOK_ID = '1VXTMZjqCS82ftB1rwoN4BzoiOTP7-Vg0m5vTH01Tfzc'; // the transport workbook (coordinator-transport.gs COORD_TRANSPORT_FORM_ID); read only
var FLEET_TABS = { fleet: 'LM Studio Fleet', profile: 'Fleet Profile', driver: 'Driver Profile', parts: 'Parts History',
  papers: 'LM Studio Vehicle Papers', runs: 'Capture Runs', stops: 'Capture Stops', fills: 'Fuel Fills' };
var FLEET_CACHE_KEY = 'fleet_rows_v1', FLEET_CACHE_S = 300; // a save on the setup page shows here within 5 minutes
var FLEET_CLERK_QUESTS = ['papers', 'driver', 'fuel', 'parts'];
var FLEET_FOLLOW = { papers: 'papers for {reg} wait', driver: 'driver card for {reg} waits', fuel: 'fuel pump details for {reg} wait',
  parts: 'parts history for {reg} waits' }; // + ' on the Fee Clerk'

// ── reader ───────────────────────────────────────────────────────────
// Every bus's rows for FleetQuests.profilesFromRows, cached (the quests run under the script lock). One openById.
function fleetRows_() {
  const hit = fleetCacheGet_(FLEET_CACHE_KEY);
  if (hit) return hit;
  const ss = SpreadsheetApp.openById(FLEET_BOOK_ID), tabs = {};
  Object.keys(FLEET_TABS).forEach(function (k) { const sh = ss.getSheetByName(FLEET_TABS[k]); tabs[k] = sh ? sh.getDataRange().getValues() : null; });
  const rows = fleetShape_(tabs);
  fleetCachePut_(FLEET_CACHE_KEY, rows, FLEET_CACHE_S);
  return rows;
}

// tabs = {fleet, profile, driver, parts, papers, runs, stops, fills}: sheet values, header first (null = no tab) -> {fleet,
// profiles, drivers, parts, inspected, captured}, as coordFleet_ builds them (coordFleetBuses_, coordFleetScan_,
// coordFleetFills_, coordFleetDone_). The papers on file (docs) are left out: they never count towards a quest.
function fleetShape_(tabs) {
  const FQ = FleetQuests, objs = function (v) {
    if (!v || v.length < 2) return [];
    const head = v[0];
    return v.slice(1).map(function (r) { const o = {}; head.forEach(function (h, i) { o[h] = r[i] instanceof Date ? fleetIstDay_(r[i].getTime()) : r[i]; }); return o; });
  };
  if (!tabs.fleet) throw new Error('Tab "' + FLEET_TABS.fleet + '" is missing');
  const fleetRows = tabs.fleet.slice(1);
  if (!fleetRows.length) throw new Error('Tab "' + FLEET_TABS.fleet + '" has no vehicles in it');
  const fleet = fleetRows.filter(function (r) { return r[3] === 'yes'; }).map(function (r) {
    const n = String(r[2]).replace(/\D/g, '');
    return { reg: FQ.normReg(r[0]), campus: 'LMS ' + n, campusId: 'LMS' + n, route: String(r[4] || ''), driver: String(r[6] || ''), driverCode: String(r[9] || ''), operational: true };
  });
  const scan = {}, fills = {}, inspected = {}, captured = {}, first = {};
  objs(tabs.papers).forEach(function (r) {
    const reg = FQ.normReg(r.Reg), k = String(r.Field || '');
    if (FQ.SCAN_FIELDS.indexOf(k) === -1 || String(r.Value == null ? '' : r.Value) === '') return;
    (scan[reg] = scan[reg] || {})[k] = { value: String(r.Value) };
  });
  objs(tabs.fills).forEach(function (f) {
    const o = fills[FQ.normReg(f.reg)] = fills[FQ.normReg(f.reg)] || { count: 0, withVideo: 0, withVideoAndBill: 0 };
    o.count++;
    if (String(f.hasVideo) === 'yes') { o.withVideo++; if (String(f.hasBill) === 'yes') o.withVideoAndBill++; }
  });
  fleet.forEach(function (b) { b.scan = scan[b.reg] || {}; b.fills = fills[b.reg] || { count: 0, withVideo: 0, withVideoAndBill: 0 }; });
  // the first ended safety check per bus (coordInspections_: kind inspection, status ended, at least one answer)
  (tabs.runs || []).slice(1).forEach(function (r) {
    if (String(r[3]) !== 'inspection' || String(r[12]) !== 'ended') return;
    let raw = null;
    try { raw = JSON.parse(String(r[11] || 'null')); } catch (e) { raw = null; }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Object.keys(raw).some(function (k) { return raw[k] && typeof raw[k] === 'object'; })) return;
    const v = r[5] || r[4], t = v instanceof Date ? v.getTime() : /^\d+$/.test(String(v).trim()) ? Number(v) : Date.parse(String(v));
    if (isNaN(t)) return;
    const reg = FQ.normReg(r[1]), day = fleetIstDay_(t);
    if (!inspected[reg] || day < inspected[reg].at) inspected[reg] = { by: String(r[14] || r[6] || ''), at: day };
  });
  // the first processed route timelapse per bus (gpsCaptured_: runIds sort by time)
  objs(tabs.stops).forEach(function (r) {
    const reg = FQ.normReg(r.reg);
    if (first[reg] && first[reg] < r.runId) return;
    first[reg] = r.runId; captured[reg] = { by: String(r.capturedBy || ''), at: String(r.pushedAt || '') };
  });
  return { fleet: fleet, profiles: objs(tabs.profile), drivers: objs(tabs.driver), parts: objs(tabs.parts), inspected: inspected, captured: captured };
}

function fleetIstDay_(ms) { return new Date(ms + 330 * 60000).toISOString().slice(0, 10); }

// CacheService caps a value at 100 KB: gzipped JSON in chunks (as coordCachePutBig_ in the Coordinator backend)
function fleetCachePut_(key, obj, seconds) {
  const b64 = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(obj), 'application/json')).getBytes());
  const parts = Math.ceil(b64.length / 90000), m = {};
  m[key + '_n'] = String(parts);
  for (let i = 0; i < parts; i++) m[key + '_' + i] = b64.slice(i * 90000, (i + 1) * 90000);
  CacheService.getScriptCache().putAll(m, seconds);
}
function fleetCacheGet_(key) {
  const cache = CacheService.getScriptCache(), n = parseInt(cache.get(key + '_n'), 10);
  if (!n) return null;
  const keys = [];
  for (let i = 0; i < n; i++) keys.push(key + '_' + i);
  const got = cache.getAll(keys);
  let b64 = '';
  for (let i = 0; i < n; i++) { if (!got[keys[i]]) return null; b64 += got[keys[i]]; }
  return JSON.parse(Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(b64), 'application/x-gzip')).getDataAsString());
}

// ── scope ────────────────────────────────────────────────────────────
// The campuses whose buses the caller plays (null = every campus). Coordinators as the framework scopes their other missions
// (gameVisibleCampuses_: network-wide) narrowed to pilotCampuses.Coordinator, as gameToday_ does; a Fee Clerk their own campus
// or comma list (as the Coordinator backend reads a Fee Clerk's row); the Owner every campus.
function fleetScope_(caller, cfg) {
  const role = caller.primaryRole, own = String(caller.campusId || '').toUpperCase();
  if (role === 'Owner') return null;
  if (role === 'Coordinator') {
    const vis = gameVisibleCampuses_(caller), pilot = fleetPilot_(cfg);
    return vis && pilot ? vis.filter(function (c) { return pilot.indexOf(c) !== -1; }) : vis || pilot;
  }
  return own === 'ALL' ? null : own.split(',').map(function (c) { return c.trim(); }).filter(Boolean);
}
function fleetPilot_(cfg) { const p = cfg && cfg.pilotCampuses && cfg.pilotCampuses.Coordinator; return Array.isArray(p) ? p : null; }

// the caller's buses' rows (fleet filtered; the other rows join by reg inside FleetQuests)
function fleetScopedRows_(caller, cfg) {
  const rows = fleetRows_(), scope = fleetScope_(caller, cfg);
  return Object.assign({}, rows, { fleet: rows.fleet.filter(function (b) { return !scope || scope.indexOf(b.campusId) !== -1; }) });
}
function fleetGo_(reg, quest) { return 'coordinator/transport/setup.html?reg=' + reg + (quest ? '&quest=' + quest : ''); }

// ── missions ─────────────────────────────────────────────────────────
// Buddy's line for one open quest (work/LMS Mascot Voice Guide.md: verb first, plain, no speed, no people ranked)
function fleetTitle_(role, p, q, prog, step) {
  const reg = p.reg, camp = p.campus + ': ';
  if (role === 'Coordinator') {
    if (q.id === 'safety') return camp + 'record the monthly safety check for ' + reg;
    if (q.id === 'capture') return camp + 'run the route timelapse for ' + reg;
    return camp + FLEET_FOLLOW[q.id].replace('{reg}', reg) + ' on the Fee Clerk';
  }
  if (q.id === 'papers' && prog.known) return 'Confirm the ' + (prog.known === 1 ? 'paper' : prog.known + ' papers') + ' found in scans for ' + reg;
  if (q.id === 'papers' && q.missing.every(function (id) { return id === 'odometerToday' || id === 'odometerPhoto'; })) return "Add today's odometer and photo for " + reg;
  return step.task + ' for ' + reg;
}

// Coordinator / Fee Clerk -> Mission[] in rank order: open ones, plus the ones done since the start of yesterday's game day
// (done from the data, with who completed it), so a mission finished today stays on today's list as done.
function fleetMissions_(caller, cfg, now) {
  const role = caller.primaryRole;
  if (role !== 'Coordinator' && role !== 'FeeClerk') return [];
  const FQ = FleetQuests, rows = fleetScopedRows_(caller, cfg), today = fleetIstDay_(now.getTime()), since = gameLookbackStart_(now), me = gameLower_(caller.email);
  const steps = {}, credit = {};
  FQ.questConfig().steps.forEach(function (s) { steps[s.id] = s; });
  FQ.transportMissions(rows).forEach(function (m) { credit[m.id] = m; }); // FleetQuests' own done, doneBy/doneAt (the save or run that completed it) and why
  const open = [], done = [];
  FQ.profilesFromRows(rows).forEach(function (p, bi) {
    const prog = FQ.progressFor(p, today), bus = FQ.busProgress(p, today).confirmed;
    FQ.questsFor(p).forEach(function (q, qi) {
      if (role === 'FeeClerk' && FLEET_CLERK_QUESTS.indexOf(q.id) === -1) return;
      const tm = credit['transport:setup_' + q.id + ':' + p.reg], pr = prog[qi], follow = role === 'Coordinator' && FLEET_CLERK_QUESTS.indexOf(q.id) !== -1;
      if (q.done && !(tm.doneAt && new Date(tm.doneAt).getTime() >= since)) return; // confirmed a while ago: not today's story
      const m = gameMission_('fleet_' + q.id, p.reg, {
        title: fleetTitle_(role, p, q, pr, steps[q.id]), why: tm.why, campus: p.campusId, go: fleetGo_(p.reg, q.id),
        shared: follow || (q.done && gameLower_(tm.doneBy) !== me), done: q.done, doneAt: q.done ? tm.doneAt : null, doneBy: q.done ? tm.doneBy || null : null,
        progress: { done: pr.confirmed, total: pr.total },
      });
      (q.done ? done : open).push({ m: m, follow: follow, known: pr.known, bus: bus, i: bi * 10 + qi });
    });
  });
  open.sort(function (a, b) { return (a.follow - b.follow) || (b.known - a.known) || (b.bus - a.bus) || (a.i - b.i); });
  return open.concat(done).map(function (x) { return x.m; });
}

// ── quests ───────────────────────────────────────────────────────────
// Coordinator: one parallel quest per bus, the six setup quests as steps. Owner: per campus a readiness quest (a step per bus,
// done when it is ready) followed by that campus's bus quests. Cheap: the cached rows, pure FleetQuests.
function fleetQuests_(caller, cfg, now) {
  const role = caller.primaryRole;
  if (role !== 'Coordinator' && role !== 'Owner') return [];
  const FQ = FleetQuests, profiles = FQ.profilesFromRows(fleetScopedRows_(caller, cfg));
  const busQuest = function (p) {
    const steps = FQ.questsFor(p).map(function (q) { return { id: q.id, title: q.label, go: fleetGo_(p.reg, q.id), done: q.done, locked: false }; });
    return { questId: 'fleet:' + p.reg, title: p.reg + ' · Fleet setup', parallel: true, steps: steps, complete: steps.every(function (s) { return s.done; }) };
  };
  if (role === 'Coordinator') return profiles.map(busQuest);
  const campuses = profiles.map(function (p) { return p.campus; }).filter(function (c, i, a) { return a.indexOf(c) === i; }).sort();
  const out = [];
  campuses.forEach(function (c) {
    const mine = profiles.filter(function (p) { return p.campus === c; }), bar = FQ.teamBar(c, mine);
    const steps = mine.map(function (p) {
      const q = FQ.questsFor(p), n = q.filter(function (x) { return x.done; }).length;
      return { id: p.reg, title: p.reg + ' · ' + n + ' of ' + q.length + ' set up', go: fleetGo_(p.reg), done: FQ.isReady(p), locked: false };
    });
    out.push({ questId: 'fleet-campus:' + mine[0].campusId, title: bar.text, parallel: true, steps: steps, complete: bar.ready === bar.total });
    mine.forEach(function (p) { out.push(busQuest(p)); });
  });
  return out;
}

// ── registration (this file's own functions only) ───────────────────
GAME_MODULE_MISSIONS.Coordinator = [].concat(GAME_MODULE_MISSIONS.Coordinator || [], fleetMissions_);
GAME_MODULE_MISSIONS.FeeClerk = [].concat(GAME_MODULE_MISSIONS.FeeClerk || [], fleetMissions_);
GAME_MODULE_QUESTS.Coordinator = [].concat(GAME_MODULE_QUESTS.Coordinator || [], fleetQuests_);
GAME_MODULE_QUESTS.Owner = [].concat(GAME_MODULE_QUESTS.Owner || [], fleetQuests_);
