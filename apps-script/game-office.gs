var GAME_MODULE_MISSIONS = GAME_MODULE_MISSIONS || {};
var GAME_MODULE_QUESTS = GAME_MODULE_QUESTS || {};

// ═══════════════════════════════════════════════════════════════════
// LMCS Game Backend -- the Day Book starting data module (Office: office/starting-data.html).
//   Accounts, Fee Clerk  missions: per (quest, school) "Confirm N starting figures for LMS 4" (shared: no personal credit)
//   Owner, Accounts      quests: one parallel quest per school, a step per starting-data quest
// One source of truth: the Office backend's start.progress, fetched as the caller (caller.idToken), so the Office applies its
// own role and campus scope and the counts match the page's rings exactly. Cached per caller for DAYBOOK_CACHE_S.
// The missions hook runs before the script lock and warms the cache; the quests hook runs under the lock and reads it.
// ponytail: the Owner has no missions hook to warm the cache, so an Owner's cold load fetches under the lock (one call,
//   once per DAYBOOK_CACHE_S); add an Owner warm hook if that ever shows up as lock contention.
// A failed fetch or {success:false} THROWS (missions: the framework marks the day down; quests: only these are dropped).
// Only this file's own functions are used at top level (load order: tests/apps-script/test-load-order.js).
// ═══════════════════════════════════════════════════════════════════

// = office/js/config.js OFFICE_BACKEND_URL; Script Property OFFICE_BACKEND_URL overrides it (a redeploy under a new URL)
var DAYBOOK_OFFICE_URL = 'https://script.google.com/macros/s/AKfycbzdVhCwnTnMybe6cdcDC87PbINCFG1n6U7UncMHDvk9eHFG6hC4dn7oEiqJKki4-lULEw/exec';
var DAYBOOK_CACHE_S = 300;
// keep in sync with officeStartQuests_() in office-start.gs (play order and labels)
var DAYBOOK_QUESTS = [['cash', 'Cash in hand'], ['bank', 'Bank balances'], ['supplier', 'Credit suppliers'], ['odometer', 'Vehicle odometers'],
  ['loan', 'Vehicle loans'], ['users', 'Portal users']];

function daybookUrl_() {
  const p = PropertiesService.getScriptProperties().getProperty('OFFICE_BACKEND_URL');
  return String(p || '').trim() || DAYBOOK_OFFICE_URL;
}

// The caller's start.progress {progress, rings, overall}, cached per caller. Throws on any failure.
function daybookProgress_(caller) {
  const cache = CacheService.getScriptCache(), key = 'daybook_start_' + String(caller.email || '').trim().toLowerCase();
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  if (!caller.idToken) throw new Error('daybook: no caller token');
  const url = daybookUrl_();
  const res = UrlFetchApp.fetch(url + (url.indexOf('?') === -1 ? '?' : '&') + 'action=start.progress&idToken=' + encodeURIComponent(caller.idToken),
    { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) throw new Error('daybook: Office answered HTTP ' + res.getResponseCode());
  const json = JSON.parse(res.getContentText()); // an HTML error page throws here
  if (!json || json.success !== true) throw new Error('daybook: ' + ((json && json.error) || 'start.progress failed'));
  const out = { progress: json.progress || {}, rings: json.rings || {}, overall: json.overall || {} };
  cache.put(key, JSON.stringify(out), DAYBOOK_CACHE_S);
  return out;
}

function daybookPlace_(campus) { return campus === 'ALL' ? 'all schools' : gameCampusLabel_(campus); }
function daybookGo_(campus, quest) { return 'office/starting-data.html?campus=' + campus + '&quest=' + quest; }
// The school's quests in play order, as [id, label, counts]; nothing to count (total 0) is left out of missions by the caller.
function daybookHere_(p) {
  return DAYBOOK_QUESTS.filter(function (q) { return p[q[0]]; }).map(function (q) { return [q[0], q[1], p[q[0]]]; });
}

// Accounts / Fee Clerk -> Mission[]: one per (quest, school) with something to confirm. A finished one stays (done) so a
// mission finished today still shows as done on today's list; the framework keeps only today's snapshot ids.
function daybookMissions_(caller, cfg, now) {
  const role = caller.primaryRole;
  if (role !== 'Accounts' && role !== 'FeeClerk') return [];
  const prog = daybookProgress_(caller).progress, out = [];
  Object.keys(prog).forEach(function (campus) {
    daybookHere_(prog[campus]).forEach(function (q) {
      const n = q[2];
      if (!n.total) return; // nothing there yet: no figures to confirm
      out.push(gameMission_('daybook_' + q[0], campus, {
        title: 'Confirm ' + (n.total - n.confirmed) + ' starting figure' + (n.total - n.confirmed === 1 ? '' : 's') + ' for ' + daybookPlace_(campus),
        why: q[1], owner: caller.email, campus: campus, go: daybookGo_(campus, q[0]),
        progress: { done: n.confirmed, total: n.total }, done: n.confirmed === n.total, core: false, shared: true,
      }));
    });
  });
  return out;
}

// Owner / Accounts -> one parallel quest per school: a step per quest it has (loan only when present, as start.progress sends it).
function daybookQuests_(caller, cfg, now) {
  const role = caller.primaryRole;
  if (role !== 'Owner' && role !== 'Accounts') return [];
  const prog = daybookProgress_(caller).progress;
  return Object.keys(prog).map(function (campus) {
    const steps = daybookHere_(prog[campus]).map(function (q) {
      return { id: q[0], title: q[1], go: daybookGo_(campus, q[0]), done: q[2].total > 0 && q[2].confirmed === q[2].total, locked: false };
    });
    return { questId: 'daybook:' + campus, title: (campus === 'ALL' ? 'All schools' : gameCampusLabel_(campus)) + ' · Starting data', parallel: true,
      steps: steps, complete: steps.every(function (s) { return s.done; }) };
  });
}

// ── registration (this file's own functions only) ───────────────────
GAME_MODULE_MISSIONS.Accounts = [].concat(GAME_MODULE_MISSIONS.Accounts || [], daybookMissions_);
GAME_MODULE_MISSIONS.FeeClerk = [].concat(GAME_MODULE_MISSIONS.FeeClerk || [], daybookMissions_);
GAME_MODULE_QUESTS.Owner = [].concat(GAME_MODULE_QUESTS.Owner || [], daybookQuests_);
GAME_MODULE_QUESTS.Accounts = [].concat(GAME_MODULE_QUESTS.Accounts || [], daybookQuests_);
