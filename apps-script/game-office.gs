var GAME_MODULE_MISSIONS = GAME_MODULE_MISSIONS || {};
var GAME_MODULE_QUESTS = GAME_MODULE_QUESTS || {};

// ═══════════════════════════════════════════════════════════════════
// LMCS Game Backend -- the Day Book starting data module (Office: office/starting-data.html).
//   Accounts, Fee Clerk  missions (and a Coordinator who also holds Accounts): per (quest, school) "Confirm N starting figures for LMS 4" (shared: no personal credit)
//   Owner, Accounts      quests: one parallel quest per school, a step per starting-data quest
// One source of truth: the Office backend's start.progress, fetched as the caller (caller.idToken), so the Office applies its
// own role and campus scope and the counts match the page's rings exactly. gameFetchJson_ does the call (its timeout
// pattern, GAME_FETCH_TIMEOUT_MS) and caches successes per (url, caller) for GAME_FETCH_CACHE_S.
// The missions hooks run before the script lock and warm the cache (the Owner's: daybookOwnerWarm_, no missions); the
// quests hook runs under the lock and reads it.
// ponytail: a cache that expires between the warm and the quests (or a warm that failed) still fetches under the lock,
//   one call per cache period; read the cache only there if that ever shows up as lock contention.
// A failed fetch or {success:false} THROWS (missions: the framework marks the day down; quests: only these are dropped).
// Only this file's own functions are used at top level (load order: tests/apps-script/test-load-order.js).
// ═══════════════════════════════════════════════════════════════════

// = office/js/config.js OFFICE_BACKEND_URL; Script Property OFFICE_BACKEND_URL overrides it (a redeploy under a new URL)
var DAYBOOK_OFFICE_URL = 'https://script.google.com/macros/s/AKfycbzdVhCwnTnMybe6cdcDC87PbINCFG1n6U7UncMHDvk9eHFG6hC4dn7oEiqJKki4-lULEw/exec';
// keep in sync with officeStartQuests_() in office-start.gs (play order and labels)
var DAYBOOK_QUESTS = [['cash', 'Cash in hand'], ['bank', 'Bank balances'], ['supplier', 'Credit suppliers'], ['odometer', 'Vehicle odometers'],
  ['loan', 'Vehicle loans'], ['users', 'Portal users']];

function daybookUrl_() {
  const p = PropertiesService.getScriptProperties().getProperty('OFFICE_BACKEND_URL');
  return String(p || '').trim() || DAYBOOK_OFFICE_URL;
}

// The caller's start.progress {progress, rings, overall}, cached per caller. Throws on any failure (HTTP error, HTML page,
// success:false), which gameFetchJson_ reports as null and never caches.
function daybookProgress_(caller) {
  if (!caller.idToken) throw new Error('daybook: no caller token');
  const url = daybookUrl_();
  const json = gameFetchJson_(url + (url.indexOf('?') === -1 ? '?' : '&') + 'action=start.progress', caller.idToken, GAME_FETCH_TIMEOUT_MS, caller.email,
    function (j) { return { progress: j.progress || {}, rings: j.rings || {}, overall: j.overall || {}, states: j.states || {}, labels: j.labels || {} }; });
  if (!json) throw new Error('daybook: start.progress failed');
  return json;
}

function daybookPlace_(campus) { return campus === 'ALL' ? 'all schools' : gameCampusLabel_(campus); }
function daybookGo_(campus, quest) { return 'office/starting-data.html?campus=' + campus + '&quest=' + quest; }
// The school's quests in play order, as [id, label, counts]; nothing to count (total 0) is left out of missions by the caller.
function daybookHere_(p, labels) {
  return DAYBOOK_QUESTS.filter(function (q) { return p[q[0]]; }).map(function (q) { return [q[0], (labels && labels[q[0]]) || q[1], p[q[0]]]; });
}
// 'LMS 4's starting cash count' / '... odometers': what an approval is about (the server's quest label lower-cased as the fallback)
var DAYBOOK_NOUN = { cash: 'cash count', odometer: 'odometers' };
function daybookNoun_(quest, labels) { return DAYBOOK_NOUN[quest] || String((labels && labels[quest]) || quest).toLowerCase(); }
function daybookState_(prog, campus, quest) { return ((prog.states || {})[campus] || {})[quest] || { state: 'draft', note: '' }; }

// Accounts / Fee Clerk -> Mission[]: one per (quest, school) with something to confirm. A finished one stays (done) so a
// mission finished today still shows as done on today's list; the framework keeps only today's snapshot ids.
function daybookMissions_(caller, cfg, now) {
  const role = caller.primaryRole;
  if (role === 'Coordinator' ? (caller.roles || []).indexOf('Accounts') === -1 : role !== 'Accounts' && role !== 'FeeClerk') return [];
  const full = daybookProgress_(caller), prog = full.progress, out = [];
  Object.keys(prog).forEach(function (campus) {
    daybookHere_(prog[campus], full.labels).forEach(function (q) {
      const n = q[2];
      if (!n.total) return; // nothing there yet: no figures to confirm
      const st = role === 'FeeClerk' ? daybookState_(full, campus, q[0]) : null, back = !!st && st.state === 'returned';
      out.push(gameMission_('daybook_' + q[0], campus, {
        title: back ? 'Fix and resend ' + daybookPlace_(campus) + '\'s ' + daybookNoun_(q[0], full.labels)
          : 'Confirm ' + (n.total - n.confirmed) + ' starting figure' + (n.total - n.confirmed === 1 ? '' : 's') + ' for ' + daybookPlace_(campus),
        why: back ? String(st.note || '') : q[1], owner: caller.email, campus: campus, go: daybookGo_(campus, q[0]),
        progress: { done: back ? Math.min(n.confirmed, n.total - 1) : n.confirmed, total: n.total }, done: back ? false : n.confirmed === n.total, core: false, shared: true,
      }));
    });
  });
  return out;
}

// Coordinator -> one mission per submitted (or already decided) cash / odometer count in their schools: approve or return it.
// Shared (no personal credit); done once approved or returned.
function daybookApproveMissions_(caller, cfg, now) {
  const out = [];
  try {
  const full = daybookProgress_(caller);
  Object.keys(full.states).forEach(function (campus) {
    Object.keys(full.states[campus]).forEach(function (quest) {
      const st = full.states[campus][quest];
      if (st.state !== 'submitted' && st.state !== 'approved' && st.state !== 'returned') return;
      out.push(gameMission_('daybook_approve', quest + ':' + campus, {
        title: 'Approve ' + daybookPlace_(campus) + '\'s starting ' + daybookNoun_(quest, full.labels),
        why: 'Sent for approval by ' + (st.by || 'the Fee Clerk'), owner: caller.email, campus: campus, go: daybookGo_(campus, quest),
        done: st.state !== 'submitted', core: false, shared: true,
      }));
    });
  });
  } catch (err) { console.error('daybook approve', err); return []; } // never marks the day down
  return out;
}

// The Owner's missions hook: warms the start.progress cache outside the lock for the Owner's quests. Never throws (an Office
// outage must not mark the Owner's day down) and never returns a mission.
function daybookOwnerWarm_(caller) {
  try { daybookProgress_(caller); } catch (err) { console.error('daybook warm', err); }
  return [];
}

// Owner / Accounts -> one parallel quest per school: a step per quest it has (loan only when present, as start.progress sends it).
function daybookQuests_(caller, cfg, now) {
  const role = caller.primaryRole;
  if (role !== 'Owner' && role !== 'Accounts') return [];
  const full = daybookProgress_(caller), prog = full.progress;
  return Object.keys(prog).map(function (campus) {
    const steps = daybookHere_(prog[campus], full.labels).map(function (q) {
      return { id: q[0], title: q[1], go: daybookGo_(campus, q[0]), done: q[2].total > 0 && q[2].confirmed === q[2].total, locked: false };
    });
    if (campus !== 'ALL' && role === 'Owner' && (full.states[campus] || {}).cash) {
      steps.push({ id: 'approved', title: 'Approved', go: daybookGo_(campus, 'cash'), done: daybookBoth_(full, campus, ['approved']), locked: false });
    }
    return { questId: 'daybook:' + campus, title: (campus === 'ALL' ? 'All schools' : gameCampusLabel_(campus)) + ' · Starting data', parallel: true,
      steps: steps, complete: steps.every(function (s) { return s.done; }) };
  });
}

// FeeClerk -> one sequential setup quest per school: check what we know, count the cash, record the odometers, send, approved.
function daybookClerkQuests_(caller, cfg, now) {
  if (caller.primaryRole !== 'FeeClerk') return [];
  const full = daybookProgress_(caller), prog = full.progress;
  return Object.keys(prog).filter(function (c) { return c !== 'ALL' && (prog[c].cash || prog[c].odometer); }).map(function (campus) {
    const cash = prog[campus].cash || { confirmed: 0, known: 0, total: 0 }, odo = prog[campus].odometer || { confirmed: 0, known: 0, total: 0 };
    const lab = full.labels || {}, go = function (q) { return daybookGo_(campus, q); };
    const defs = [
      ['check', lab.check || 'Check what we know', go('cash'), cash.known === 0 && odo.known === 0],
      ['cash', lab.cashStep || 'Count the cash', go('cash'), cash.total > 0 && cash.confirmed === cash.total],
      ['odometer', lab.odometerStep || 'Record the odometers', go('odometer'), odo.confirmed === odo.total],
      ['submit', lab.submit || 'Send for approval', go('cash'), daybookBoth_(full, campus, ['submitted', 'approved'])],
      ['approved', lab.approved || 'Approved', go('cash'), daybookBoth_(full, campus, ['approved'])],
    ];
    let open = false;
    const steps = defs.map(function (d) {
      const locked = open; if (!d[3]) open = true;
      return { id: d[0], title: d[1], go: d[2], done: d[3], locked: locked };
    });
    return { questId: 'daybook-setup:' + campus, title: daybookPlace_(campus) + ' · Start your Day Book', parallel: false,
      steps: steps, complete: steps.every(function (s) { return s.done; }) };
  });
}
// both the cash and the odometer count of a school are in one of these states
function daybookBoth_(full, campus, states) {
  return ['cash', 'odometer'].every(function (q) { return states.indexOf(daybookState_(full, campus, q).state) !== -1; });
}

// ── registration (this file's own functions only) ───────────────────
GAME_MODULE_MISSIONS.Accounts = [].concat(GAME_MODULE_MISSIONS.Accounts || [], daybookMissions_);
GAME_MODULE_MISSIONS.FeeClerk = [].concat(GAME_MODULE_MISSIONS.FeeClerk || [], daybookMissions_);
GAME_MODULE_MISSIONS.Coordinator = [].concat(GAME_MODULE_MISSIONS.Coordinator || [], daybookMissions_, daybookApproveMissions_);
GAME_MODULE_MISSIONS.Owner = [].concat(GAME_MODULE_MISSIONS.Owner || [], daybookOwnerWarm_);
GAME_MODULE_QUESTS.Owner = [].concat(GAME_MODULE_QUESTS.Owner || [], daybookQuests_);
GAME_MODULE_QUESTS.FeeClerk = [].concat(GAME_MODULE_QUESTS.FeeClerk || [], daybookClerkQuests_);
GAME_MODULE_QUESTS.Accounts = [].concat(GAME_MODULE_QUESTS.Accounts || [], daybookQuests_);
