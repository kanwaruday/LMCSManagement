// ═══════════════════════════════════════════════════════════════════
// LMCS Game Backend -- its OWN Apps Script project, the server side of the
// portal-wide game layer (mascot Buddy, daily missions, quests). Powers the
// "Today" home of every portal role.
// Spec: docs/superpowers/specs/2026-10-25-portal-game-layer-mascot-design.md
// Plan: docs/superpowers/plans/2026-10-25-portal-game-layer-phase-1.md
//
// This file: config, the game-day clock, caller scope, the doGet/doPost dispatch and the
// built-in actions (gametoday, gamedecide, gametourseen) that wire the pure modules to the
// sheets and the PDR / Coordinator backends. Later files in the same project (game-missions.gs,
// game-windows.gs, game-quests.gs, role modules such as game-teacher.gs) add
// behaviour by registering into GAME_MODULE_ACTIONS / _MISSIONS / _QUESTS below.
// Apps Script runs all files in one global scope in an order we do not control (game-*.gs
// sorts before game.gs), so the registries are `var ... || {}` and EVERY module file starts
// with the same three guard lines, whichever file runs first:
//   var GAME_MODULE_ACTIONS = GAME_MODULE_ACTIONS || {};
//   var GAME_MODULE_MISSIONS = GAME_MODULE_MISSIONS || {};
//   var GAME_MODULE_QUESTS = GAME_MODULE_QUESTS || {};
//
// Every allowlisted role may call this backend; what each role SEES is decided by
// the mission and quest code, not here. Source data is only ever READ.
//
// SETUP:
//   1. script.google.com -> New project -> "LMCS Game Backend",
//      paste this file as game.gs (the other game-*.gs files as they land)
//   2. Run gameSetup() once: creates the "LMCS Game" workbook with its tabs, seeds
//      Game Config, and stores the workbook id in Script Properties (GAME_SHEET_ID)
//   3. Deploy -> New deployment -> Web App, Execute as: Me, access: Anyone
//      (the verified-token check below is the real gate)
//   4. Put the resulting URL in the portal pages' GAME_BACKEND_URL and the deploymentId
//      in apps-script/projects.json
//   The script time zone is irrelevant: IST is computed explicitly (gameDayKey_).
//
// ponytail: Game Config / Game Windows / Game Quests are edited by the Owner as sheets
//   (the Season setup screen is Phase 3). Days on track are finalized lazily at the
//   person's first load of a later day (nightly snapshot for everyone is Phase 2). Go
//   links open the page, not the exact record (deep links are Phase 2).
// ═══════════════════════════════════════════════════════════════════

const GAME_ALLOWLIST_SHEET_ID = '1NZu0ElismFytG395Nxjz29vAz7OfkmJtZhs70bOwT58'; // "LMCS Principal Allowlist" (same as PDR's ALLOWLIST_SHEET_ID)
const GAME_GOOGLE_CLIENT_ID = '697999989724-mvi85iobr20g4mm8a8nrjd1rms2o8tf6.apps.googleusercontent.com'; // same as assets/auth.js
const GAME_TZ = 'Asia/Kolkata';
const GAME_DAY_START_HOUR = 4;          // the game day rolls over at 04:00 IST
const GAME_IST_OFFSET_MIN = 330;        // UTC+5:30, no DST
const GAME_SHEET_PROP = 'GAME_SHEET_ID';
const GAME_WORKBOOK_NAME = 'LMCS Game';
// Sources, read-only. The two backends are called with the caller's own idToken, so they apply their own scope.
const GAME_PDR_URL = 'https://script.google.com/macros/s/AKfycbzpkFLy4KvTdSJfioz6wlgRGLjvO_GvbffhOYBb-hHybFtjGTk0ps-GzXz0FrQ9GmYdfg/exec'; // projects.json "pdr"
const GAME_COORD_URL = 'https://script.google.com/macros/s/AKfycbwilcvrgZQga_qo1A-fBTUzKLifrBYIwlPHoWMITmchf5sZOYjKIJ7_4J0TeBF_-6B6/exec'; // projects.json "coordinator"
const GAME_APPROVALS_SHEET_ID = '1Tr4Rfc6DN698eeGVjuCoXfSRR-NhBTWJibR00Ibj6P4'; // "LMCS Approvals": Approvals, Tasks, Recommendations
const GAME_PDR_SHEET_ID = '1GzGdakmjjkou0GGgljY6ugXvOM21MLkyeyc85Ke3i1Y';       // PDR Daily Reports workbook: Daily Reports, PDR Issue Actions
const GAME_FETCH_TIMEOUT_MS = 20000;
const GAME_FETCH_CACHE_S = 600;
const GAME_LOCK_MS = 20000;

// Tab -> header row. Code indexes by position, so never reorder.
const GAME_TABS = {
  'Game Config': ['Key', 'Value'],
  'Game Daily': ['Day', 'Email', 'Role', 'Campus', 'MissionIds', 'DoneIds', 'Finalized', 'OnTrack', 'CreatedAt'],
  'Game Progress': ['Email', 'Kind', 'Key', 'Value', 'At'], // Kind: tour, quest_step
  'Game Windows': ['WindowId', 'Title', 'Question', 'Scope', 'ScopeId', 'Decider', 'Choice', 'DefaultIfUndecided',
    'Opens', 'Closes', 'AppliesFrom', 'Writes', 'OpenedBy', 'ConfirmBy'],
  'Game Decisions': ['WindowId', 'ScopeId', 'Value', 'Note', 'DecidedBy', 'DecidedAt', 'Kind'], // Kind: decided, default_applied, override
  'Game Quests': ['QuestId', 'Role', 'Title', 'UnlockAfter', 'StepsJson', 'Reward'],
};

// Season-0 defaults. Never constants in logic: a Game Config row (Value = JSON) overrides its key.
function gameConfigDefaults_() {
  return {
    pilotCampuses: { Principal: ['LMS4', 'LMS5', 'LMS6'], Coordinator: ['LMS4', 'LMS5', 'LMS6'], Owner: 'ALL', Teacher: 'ALL' },
    speaker: { Teacher: 'teacher-owl' }, // every other role: Buddy
    cap: { Principal: 5, Coordinator: 5, Owner: 5 },
    core: { Principal: ['ss_pace', 'pdr_issue'], Coordinator: ['approval_recommend', 'hiring_stall'], Owner: ['approval_wait'] },
    approvalWaitDays: 3,
    uniform: { summerFrom: '2027-05-03', winterFrom: '2026-10-26', festivals: [] },
    trackSuitDays: {},
    principalIssuesReady: false,
    principalIssuesGo: 'principal/issues.html', // from the Coordinator chat; ships with its C1
    recommendationsReady: false, // until the Recommendations tab exists: no approval_recommend missions, Owner's `why` blank
    daysDenominator: { Principal: true, Coordinator: true, Owner: true, Teacher: false },
  };
}

// Module registries. A module .gs file adds its role's pieces here; the framework does the
// picking, roll-over, done display and days on track for every role.
// var, not const, guarded: a module file may run before this one (see header).
var GAME_MODULE_ACTIONS = GAME_MODULE_ACTIONS || {};   // { action: fn(caller, params) }, looked up after the built-ins
var GAME_MODULE_MISSIONS = GAME_MODULE_MISSIONS || {}; // { Teacher: fn(caller, cfg, now) -> Mission[] }
var GAME_MODULE_QUESTS = GAME_MODULE_QUESTS || {};     // { Teacher: fn(caller, cfg, now) -> QuestState[] }

function gameJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function gameDispatch_(caller, action, params) {
  if (action === 'gametoday') return gameToday_(caller, params);
  if (action === 'gamedecide') return gameDecide_(caller, params);
  if (action === 'gametourseen') return gameTourSeen_(caller, params);
  if (Object.prototype.hasOwnProperty.call(GAME_MODULE_ACTIONS, action)) return GAME_MODULE_ACTIONS[action](caller, params);
  return { success: false, error: 'Unknown action' };
}

function doGet(e) {
  try {
    const caller = gameVerifyCaller_(e.parameter.idToken);
    if (!caller) return gameJson_({ success: false, error: 'Not authorized' });
    return gameJson_(gameDispatch_(caller, String(e.parameter.action || '').toLowerCase(), e.parameter));
  } catch (err) {
    return gameJson_({ success: false, error: err.message });
  }
}

// Plain-text JSON body (no Content-Type) so the browser skips a preflight; this project has no doOptions.
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const caller = gameVerifyCaller_(body.idToken);
    if (!caller) return gameJson_({ success: false, error: 'Not authorized' });
    return gameJson_(gameDispatch_(caller, String(body.action || '').toLowerCase(), body));
  } catch (err) {
    return gameJson_({ success: false, error: err.message });
  }
}

// ── Clock ────────────────────────────────────────────────────────────
// The game day as 'YYYY-MM-DD': a day runs 04:00 IST to 04:00 IST, labelled by the date it starts on.
// Plain UTC+5:30 arithmetic, so it never depends on the script's time zone.
function gameDayKey_(date) {
  const shifted = new Date(date.getTime() + (GAME_IST_OFFSET_MIN - GAME_DAY_START_HOUR * 60) * 60000);
  return shifted.toISOString().slice(0, 10);
}

// ── Config ───────────────────────────────────────────────────────────
// rows = Game Config values (header first). Each Value is JSON; a missing key, bad JSON or a value of
// the wrong type falls back to that key's default. Object values merge over the default's keys,
// so {"Principal":3} changes one cap and leaves the others.
function gameParseConfig_(rows) {
  const cfg = gameConfigDefaults_();
  for (let i = 1; i < rows.length; i++) {
    const key = String(rows[i][0] || '').trim();
    if (!Object.prototype.hasOwnProperty.call(cfg, key)) continue;
    let val;
    try { val = JSON.parse(String(rows[i][1])); } catch (err) { continue; }
    const def = cfg[key];
    if (val === null || typeof val !== typeof def || Array.isArray(val) !== Array.isArray(def)) continue;
    cfg[key] = (def && typeof def === 'object' && !Array.isArray(def)) ? Object.assign(def, val) : val;
  }
  return cfg;
}

// ── Auth ─────────────────────────────────────────────────────────────
// Owner > Coordinator > Principal > Teacher > anything else (first listed)
function gamePrimaryRole_(roles) {
  const order = ['Owner', 'Coordinator', 'Principal', 'Teacher'];
  for (let i = 0; i < order.length; i++) if (roles.indexOf(order[i]) !== -1) return order[i];
  return roles[0] || '';
}

// Verified Google ID token -> {email, campusId, roles, primaryRole, canDecide}, re-derived from the
// allowlist; null unless the caller is allowlisted with at least one role (every role may play).
// Cached 5 min (a role change in the allowlist takes up to 5 min to apply).
function gameVerifyCaller_(idToken) {
  if (!idToken) return null;
  const cache = CacheService.getScriptCache();
  const key = 'gameauth_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, idToken));
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  try {
    const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    const payload = JSON.parse(res.getContentText());
    if (payload.aud !== GAME_GOOGLE_CLIENT_ID) return null;
    if (payload.email_verified !== 'true' && payload.email_verified !== true) return null;
    const email = (payload.email || '').toLowerCase();
    const rows = SpreadsheetApp.openById(GAME_ALLOWLIST_SHEET_ID).getSheets()[0].getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0] || '').trim().toLowerCase() !== email) continue;
      const roles = String(rows[i][3] || '').split(',').map(function (r) { return r.trim(); }).filter(Boolean);
      if (!roles.length) return null;
      const canDecide = roles.indexOf('Owner') !== -1 || (roles.indexOf('Coordinator') !== -1 && String(rows[i][4] || '').trim().toUpperCase() === 'TRUE'); // same rule as aprCanDecide_ in approvals.gs
      const caller = { email: email, campusId: String(rows[i][2] || '').trim().toUpperCase(), roles: roles, primaryRole: gamePrimaryRole_(roles), canDecide: canDecide };
      cache.put(key, JSON.stringify(caller), 300);
      return caller;
    }
    return null;
  } catch (err) {
    return null;
  }
}

// null = every campus (Owner and Coordinator are network-wide, no district scoping; campus ALL);
// otherwise the caller's own campus
function gameVisibleCampuses_(caller) {
  if (caller.roles.indexOf('Owner') !== -1 || caller.roles.indexOf('Coordinator') !== -1 || caller.campusId === 'ALL') return null;
  return [caller.campusId];
}

// ── Actions: gametoday, gamedecide, gametourseen ─────────────────────
// Three layers: load sources (read-only I/O, before the lock), build today (pure helpers), persist (the Game
// workbook, under the script lock so two parallel loads create one snapshot and one set of default_applied rows).
// The workbook stores ids, flags and counts only; mission titles and `why` exist only in the HTTP response.
// ponytail: one script lock for every Game workbook write; per-person locks if loads ever queue.

function gameNow_() { return new Date(); } // the one clock read, so tests can pin it
function gameBook_() { return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty(GAME_SHEET_PROP)); }
function gameWithLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(GAME_LOCK_MS);
  try { return fn(); } finally { lock.releaseLock(); }
}
// appended as plain text, so Sheets never turns a day, id or JSON cell into a Date or number
function gameAppendText_(sh, rows) {
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setNumberFormat('@').setValues(rows);
}

// GET a sibling backend as the caller (their idToken, so it applies its own scope). null on any failure: HTTP
// error, HTML error page, {success:false}, a throw. Successes are cached 10 min per (url, email): ssdashboard
// can take 20 s+, and a failure is retried on the next load.
// ponytail: UrlFetchApp has no request timeout (platform limit ~60 s), so timeoutMs is accepted but cannot
//   cut a slow call short; the panel renders after the page, so a slow source delays only the game panel.
// project(json), optional, trims the body before it is cached and returned (R23: CacheService caps a value at
// 100 KB); a value still over the cap is simply not cached.
function gameFetchJson_(url, idToken, timeoutMs, email, project) {
  const cache = CacheService.getScriptCache();
  const key = 'gamefetch_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, url + '|' + String(email || '').toLowerCase()));
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  try {
    const res = UrlFetchApp.fetch(url + (url.indexOf('?') === -1 ? '?' : '&') + 'idToken=' + encodeURIComponent(idToken), { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() !== 200) return null;
    let json = JSON.parse(res.getContentText());
    if (!json || json.success === false) return null;
    if (project) json = project(json);
    try { cache.put(key, JSON.stringify(json), GAME_FETCH_CACHE_S); } catch (err) { /* too big to cache */ }
    return json;
  } catch (err) {
    return null;
  }
}

// R21: the Owner and Coordinators are always in (Coordinator missions are narrowed to the pilot campuses);
// anyone else needs their campus in pilotCampuses[role]. A role with no pilot entry (Fee Clerk) is not in yet.
function gameInPilot_(pilot, campus) { return pilot === 'ALL' || (Array.isArray(pilot) && pilot.indexOf(campus) !== -1); }
function gamePilotPasses_(caller, cfg) {
  const role = caller.primaryRole;
  return role === 'Owner' || role === 'Coordinator' || gameInPilot_(cfg.pilotCampuses[role], caller.campusId);
}

// Only the sources the caller's role needs, as the mission adapters expect them (sheet rows WITH the header).
// down = names of the sources that failed. A missing Recommendations tab is empty, not a failure.
function gameLoadSources_(caller, idToken, cfg, now) {
  const role = caller.primaryRole, src = {}, down = [], books = {}, dayKey = gameDayKey_(now);
  const tab = function (id, name, key, optional) {
    try {
      const sh = (books[id] = books[id] || SpreadsheetApp.openById(id)).getSheetByName(name);
      if (sh) return sh.getDataRange().getValues();
      if (optional) return [];
    } catch (err) { /* counted as down below */ }
    down.push(key);
    return null;
  };
  const fetch = function (url, action, project) {
    const json = gameFetchJson_(url + '?action=' + action, idToken, GAME_FETCH_TIMEOUT_MS, caller.email, project);
    if (!json) down.push(action);
    return json;
  };
  if (role === 'Principal' || role === 'Coordinator' || role === 'Owner') src.approvals = tab(GAME_APPROVALS_SHEET_ID, 'Approvals', 'approvals');
  if (role === 'Principal') {
    src.reports = tab(GAME_PDR_SHEET_ID, 'Daily Reports', 'dailyreports');
    src.ss = fetch(GAME_PDR_URL, 'ssdashboard', function (ss) { return gameSsTrim_(ss, caller.email, dayKey); });
    if (cfg.principalIssuesReady) src.issues = fetch(GAME_COORD_URL, 'principalissues');
  }
  if (role === 'Coordinator') {
    src.tasks = tab(GAME_APPROVALS_SHEET_ID, 'Tasks', 'tasks');
    src.issueActions = tab(GAME_PDR_SHEET_ID, 'PDR Issue Actions', 'issueactions');
  }
  if ((role === 'Coordinator' || role === 'Owner') && cfg.recommendationsReady) src.recommendations = tab(GAME_APPROVALS_SHEET_ID, 'Recommendations', 'recommendations', true);
  return { src: src, down: down };
}

// R23: ssdashboard cut to what game-missions.gs reads (gameSsDashboards_, gameSsTimes_, gamePrincipalMissions_):
// per dashboard quotaPerMonth + roster { school, submissionsThisMonth, history }, history only this caller's
// entries of the game day as { timestamp, evaluatorEmail }. Keeps the one-dashboard or { roles } shape.
// ponytail: a copy cached just before 04:00 IST keeps the old day's history for up to 10 min (cache life).
function gameSsTrim_(ss, email, dayKey) {
  const me = gameLower_(email);
  const dash = function (d) {
    return { quotaPerMonth: d.quotaPerMonth, roster: (d.roster || []).map(function (r) {
      return { school: r.school, submissionsThisMonth: r.submissionsThisMonth, history: (r.history || []).filter(function (h) {
        const iso = gameIso_(h.timestamp);
        return iso && gameLower_(h.evaluatorEmail) === me && gameDayKey_(new Date(iso)) === dayKey;
      }).map(function (h) { return { timestamp: h.timestamp, evaluatorEmail: h.evaluatorEmail }; }) };
    }) };
  };
  if (!ss.roles) return Object.assign({ success: ss.success }, dash(ss));
  const roles = {};
  Object.keys(ss.roles).forEach(function (k) { roles[k] = dash(ss.roles[k]); });
  return { success: ss.success, roles: roles };
}

// PDR Issue Actions rows -> how many issues this person assigned or resolved with a note (a count, never names)
function gameIssueActionsBy_(rows, email) {
  const me = gameLower_(email);
  return (rows || []).slice(1).filter(function (r) {
    const st = String(r[1]).trim();
    return gameLower_(r[5]) === me && (st === 'assigned' || st === 'resolved') && String(r[4] || '').trim() !== '';
  }).length;
}

// Game Daily for one person: earlier unfinalized rows to finalize (none if a source failed: R15), the latest
// earlier day's ids (roll-over), and today's ids: the existing snapshot, or newIds picked now.
function gameDailyPlan_(dailyRows, caller, dayKey, missionsNow, cfg, sourcesOk) {
  const role = caller.primaryRole, who = gameLower_(caller.email), core = (cfg.core && cfg.core[role]) || [];
  const finalize = [];
  let latest = null;
  for (let i = 1; i < dailyRows.length; i++) {
    const r = dailyRows[i], day = gameDayCell_(r[0]);
    if (gameLower_(r[1]) !== who || day >= dayKey) continue;
    const ids = gameIdList_(r[4]);
    if (!latest || day > latest.day) latest = { day: day, ids: ids };
    if (!sourcesOk || r[6] === true || String(r[6]).toLowerCase() === 'true') continue;
    const f = gameFinalizeDay_({ missionIds: ids }, missionsNow, day, core);
    finalize.push({ row: i + 1, onTrack: f.counted ? f.onTrack : '' }); // R14: blank = nothing to count
  }
  const carried = latest ? latest.ids : [];
  const snap = gameSnapshot_(dailyRows, caller.email, dayKey);
  return {
    finalize: finalize, carried: carried, snapshotIds: snap ? snap.missionIds : null,
    newIds: snap ? null : gamePick_(missionsNow, (cfg.cap && cfg.cap[role]) || 5, core, carried).map(function (m) { return m.id; }),
  };
}

// Today's set in snapshot order with live state (ids gone from missionsNow are dropped: R9). next = the first
// open one in the set, else the best open mission outside it (work that arrived mid-day).
function gameTodayView_(snapshotIds, missionsNow, carried, cfg, role) {
  const byId = {}, inSet = {}, rolled = {};
  missionsNow.forEach(function (m) { byId[m.id] = m; });
  carried.forEach(function (id) { rolled[id] = true; });
  const missions = snapshotIds.filter(function (id) { return byId[id]; }).map(function (id) {
    inSet[id] = true;
    return Object.assign({}, byId[id], { rolledOver: !!rolled[id] });
  });
  const open = missions.filter(function (m) { return !m.done && !m.gone; });
  const rest = missionsNow.filter(function (m) { return !inSet[m.id]; });
  return { missions: missions, next: open[0] || gamePick_(rest, 1, (cfg.core && cfg.core[role]) || [], carried)[0] || null };
}

// A decision's write merged into its key's Game Config row (Value = JSON object by scope): { row (0 = append), text }
function gameConfigMerge_(cfgRows, write) {
  const scopeId = write.path.slice(write.key.length + 1);
  for (let i = 1; i < cfgRows.length; i++) {
    if (String(cfgRows[i][0]).trim() !== write.key) continue;
    const cur = gameJsonCell_(cfgRows[i][1], {});
    const obj = cur && typeof cur === 'object' && !Array.isArray(cur) ? cur : {};
    obj[scopeId] = write.value;
    return { row: i + 1, text: JSON.stringify(obj) };
  }
  const fresh = {};
  fresh[scopeId] = write.value;
  return { row: 0, text: JSON.stringify(fresh) };
}

function gameToursSeen_(progRows, email) {
  const me = gameLower_(email);
  return progRows.slice(1).filter(function (r) { return gameLower_(r[0]) === me && r[1] === 'tour'; }).map(function (r) { return String(r[2]); });
}

// the decider's own words (the one free-text field): capped, and never read as a formula
function gameSafeNote_(v) {
  const s = String(v || '').trim().slice(0, 500);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

// ── persist (call under gameWithLock_) ──
// cfgRows is updated in place, so several writes in one request accumulate
function gameWriteConfig_(sh, cfgRows, write) {
  if (!write.key) return;
  const m = gameConfigMerge_(cfgRows, write);
  if (m.row) { sh.getRange(m.row, 2).setNumberFormat('@').setValue(m.text); cfgRows[m.row - 1][1] = m.text; }
  else { gameAppendText_(sh, [[write.key, m.text]]); cfgRows.push([write.key, m.text]); }
}

function gamePersistDaily_(sh, caller, dayKey, missionsNow, cfg, sourcesOk, now) {
  const rows = sh.getDataRange().getValues();
  const plan = gameDailyPlan_(rows, caller, dayKey, missionsNow, cfg, sourcesOk);
  plan.finalize.forEach(function (f) {
    sh.getRange(f.row, 7, 1, 2).setValues([[true, f.onTrack]]);
    rows[f.row - 1][6] = true;
    rows[f.row - 1][7] = f.onTrack;
  });
  // R24: a snapshot is persisted only when every source loaded; otherwise newIds is just the live view for this
  // response (no greeting), and the first healthy load creates the day's set. DoneIds stays '[]': done state is
  // re-derived from the sources on every read.
  const created = !!plan.newIds && sourcesOk;
  if (created) {
    const r = [dayKey, gameLower_(caller.email), caller.primaryRole, caller.campusId, JSON.stringify(plan.newIds), '[]', '', '', now.toISOString()];
    gameAppendText_(sh, [r]);
    rows.push(r);
  }
  return { rows: rows, carried: plan.carried, snapshotIds: plan.newIds || plan.snapshotIds, created: created };
}

// Closed windows: append each undecided campus's default and write it to Game Config (lazily, on read)
function gameSyncWindows_(ss, now) {
  const cfgSheet = ss.getSheetByName('Game Config'), cfgRows = cfgSheet.getDataRange().getValues();
  const winRows = ss.getSheetByName('Game Windows').getDataRange().getValues();
  const decSheet = ss.getSheetByName('Game Decisions'), decRows = decSheet.getDataRange().getValues();
  const defaults = gameApplyDefaults_(winRows, decRows, now, gameParseConfig_(cfgRows));
  if (defaults.length) {
    const rows = defaults.map(gameDecisionRow_), byId = {};
    gameAppendText_(decSheet, rows);
    rows.forEach(function (r) { decRows.push(r); });
    gameParseWindows_(winRows).forEach(function (w) { byId[w.windowId] = w; });
    defaults.forEach(function (d) { gameWriteConfig_(cfgSheet, cfgRows, gameDecisionWrites_(byId[d.windowId], d.scopeId, d.value)); });
  }
  return { cfg: gameParseConfig_(cfgRows), winRows: winRows, decRows: decRows };
}

// ── the actions ──
function gameToday_(caller, params) {
  const now = gameNow_(), ss = gameBook_(), role = caller.primaryRole, dayKey = gameDayKey_(now), me = gameLower_(caller.email);
  const cfg0 = gameParseConfig_(ss.getSheetByName('Game Config').getDataRange().getValues());
  if (!gamePilotPasses_(caller, cfg0)) return { success: true, notYet: true };
  const loaded = gameLoadSources_(caller, params.idToken, cfg0, now);
  let missionsNow = gameMissionsFor_(caller, loaded.src, cfg0, now);
  if (!Array.isArray(missionsNow)) return { success: true, notYet: true }; // no missions for this role yet
  if (role === 'Coordinator') missionsNow = missionsNow.filter(function (m) { return !m.campus || gameInPilot_(cfg0.pilotCampuses.Coordinator, m.campus); });

  return gameWithLock_(function () {
    const daily = gamePersistDaily_(ss.getSheetByName('Game Daily'), caller, dayKey, missionsNow, cfg0, loaded.down.length === 0, now);
    const win = gameSyncWindows_(ss, now), cfg = win.cfg;
    const view = gameTodayView_(daily.snapshotIds, missionsNow, daily.carried, cfg, role);
    const days = gameDaysOnTrack_(daily.rows, me, dayKey.slice(0, 7));
    days.showDenominator = !(cfg.daysDenominator && cfg.daysDenominator[role] === false);

    const progSheet = ss.getSheetByName('Game Progress'), progRows = progSheet.getDataRange().getValues();
    const questRows = ss.getSheetByName('Game Quests').getDataRange().getValues();
    const evidence = {
      missionsDoneByMe: missionsNow.filter(function (m) { return m.done; }),
      ssByMe: gameSsSubmittedBy_(loaded.src.ss, me, dayKey),
      decisionsByMe: gameParseDecisions_(win.decRows).filter(function (d) { return gameLower_(d.decidedBy) === me; }),
      issueActionsByMe: gameIssueActionsBy_(loaded.src.issueActions, me),
      daysOnTrack: days,
    };
    const newly = gameQuestNewlyDone_(questRows, role, evidence, progRows, me, cfg);
    gameAppendText_(progSheet, newly.map(function (n) { return [me, 'quest_step', n.questId + ':' + n.stepId, 'done', now.toISOString()]; }));
    const quests = gameQuestState_(questRows, role, evidence, progRows, me, cfg)
      .concat(Object.prototype.hasOwnProperty.call(GAME_MODULE_QUESTS, role) ? GAME_MODULE_QUESTS[role](caller, cfg, now) : []);

    const out = {
      success: true, day: dayKey, firstLoadToday: daily.created, role: role, campus: caller.campusId,
      speaker: (cfg.speaker && cfg.speaker[role]) || 'buddy',
      missions: view.missions, next: view.next, quests: quests, daysOnTrack: days,
      windows: gameWindowsFor_(caller, win.winRows, win.decRows, now, cfg),
      config: { trackSuitDays: cfg.trackSuitDays, uniform: cfg.uniform },
      sourcesDown: loaded.down, toursSeen: gameToursSeen_(progRows, me),
    };
    if (role === 'Owner' || role === 'Coordinator') out.board = gameWindowBoard_(caller, win.winRows, win.decRows, now, cfg);
    return out;
  });
}

// POST {windowId, scopeId, value, note}: validated first, then the decision row and its real setting, under the lock
function gameDecide_(caller, p) {
  const now = gameNow_(), ss = gameBook_();
  const windowId = String(p.windowId || '').trim(), scopeId = String(p.scopeId || '').trim();
  return gameWithLock_(function () {
    const cfgSheet = ss.getSheetByName('Game Config'), cfgRows = cfgSheet.getDataRange().getValues();
    const cfg = gameParseConfig_(cfgRows);
    const win = gameParseWindows_(ss.getSheetByName('Game Windows').getDataRange().getValues()).filter(function (w) { return w.windowId === windowId; })[0];
    if (!win) return { success: false, error: "That decision isn't available." };
    const decSheet = ss.getSheetByName('Game Decisions');
    const existing = gameLatestDecisions_(gameParseDecisions_(decSheet.getDataRange().getValues()))[windowId + '|' + scopeId] || null;
    const v = gameValidateDecision_(caller, win, scopeId, p.value, existing, now, cfg);
    if (!v.ok) return { success: false, error: v.error };
    gameAppendText_(decSheet, [gameDecisionRow_({ windowId: windowId, scopeId: scopeId, value: p.value, note: gameSafeNote_(p.note),
      decidedBy: gameLower_(caller.email), decidedAt: now.toISOString(), kind: v.kind })]);
    gameWriteConfig_(cfgSheet, cfgRows, gameDecisionWrites_(win, scopeId, p.value));
    return { success: true };
  });
}

// POST {tourId}: recorded once per person (Game Progress, Kind 'tour')
function gameTourSeen_(caller, p) {
  const tourId = String(p.tourId || '').trim();
  if (!/^[\w-]{1,60}$/.test(tourId)) return { success: false, error: 'Unknown tour.' };
  const now = gameNow_(), ss = gameBook_(), me = gameLower_(caller.email);
  return gameWithLock_(function () {
    const sh = ss.getSheetByName('Game Progress');
    if (gameToursSeen_(sh.getDataRange().getValues(), me).indexOf(tourId) === -1) gameAppendText_(sh, [[me, 'tour', tourId, 'seen', now.toISOString()]]);
    return { success: true };
  });
}

// ── Setup ────────────────────────────────────────────────────────────
// Run once from the editor. Safe to re-run: creates only what is missing and never overwrites a Config value.
function gameSetup() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(GAME_SHEET_PROP);
  const ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.create(GAME_WORKBOOK_NAME);
  if (!id) props.setProperty(GAME_SHEET_PROP, ss.getId());
  Object.keys(GAME_TABS).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) {
      const first = ss.getSheets()[0];
      sh = (first.getName() === 'Sheet1' && first.getLastRow() === 0) ? first.setName(name) : ss.insertSheet(name);
    }
    sh.getRange(1, 1, 1, GAME_TABS[name].length).setValues([GAME_TABS[name]]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  const cfgSheet = ss.getSheetByName('Game Config');
  const have = {};
  cfgSheet.getDataRange().getValues().slice(1).forEach(function (r) { have[String(r[0]).trim()] = true; });
  const defaults = gameConfigDefaults_();
  const seed = Object.keys(defaults).filter(function (k) { return !have[k]; }).map(function (k) { return [k, JSON.stringify(defaults[k])]; });
  if (seed.length) cfgSheet.getRange(cfgSheet.getLastRow() + 1, 1, seed.length, 2).setNumberFormat('@').setValues(seed); // text: stops Sheets turning "true"/"3" into booleans/numbers
  // The track-suit window template: Opens/Closes blank = closed until the Owner sets the dates
  const winSheet = ss.getSheetByName('Game Windows');
  if (!winSheet.getDataRange().getValues().slice(1).some(function (r) { return String(r[0]).trim() === 'trackSuit'; })) {
    winSheet.getRange(winSheet.getLastRow() + 1, 1, 1, GAME_TABS['Game Windows'].length).setNumberFormat('@').setValues([[
      'trackSuit', 'Track-suit days for your campus', 'Which 3 days a week do students come in track suits?',
      'campus', '*', 'Principal', '{"type":"pickN","n":3,"options":["Mon","Tue","Wed","Thu","Fri","Sat"]}', '["Mon","Wed","Fri"]',
      '', '', '', 'trackSuitDays', '', '']]);
  }
  // Quest 1 for Principal and Coordinator (game-quests.gs); only rows whose QuestId is absent
  const questSheet = ss.getSheetByName('Game Quests');
  const questSeed = gameQuestRowsToSeed_(questSheet.getDataRange().getValues());
  if (questSeed.length) questSheet.getRange(questSheet.getLastRow() + 1, 1, questSeed.length, GAME_TABS['Game Quests'].length).setNumberFormat('@').setValues(questSeed);
  return ss.getUrl();
}
