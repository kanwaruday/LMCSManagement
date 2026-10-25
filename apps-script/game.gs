// ═══════════════════════════════════════════════════════════════════
// LMCS Game Backend -- its OWN Apps Script project, the server side of the
// portal-wide game layer (mascot Buddy, daily missions, quests). Powers the
// "Today" home of every portal role.
// Spec: docs/superpowers/specs/2026-10-25-portal-game-layer-mascot-design.md
// Plan: docs/superpowers/plans/2026-10-25-portal-game-layer-phase-1.md
//
// This file is the skeleton: config, the game-day clock, caller scope and the
// doGet/doPost dispatch. Later files in the same project (game-missions.gs,
// game-windows.gs, game-quests.gs, role modules such as game-teacher.gs) add
// behaviour by registering into GAME_MODULE_ACTIONS / _MISSIONS / _QUESTS below.
// game.gs must stay FIRST in the project's file order so those registries exist
// when the other files run.
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
const GAME_MODULE_ACTIONS = {};  // { action: fn(caller, params) }, looked up after the built-ins
const GAME_MODULE_MISSIONS = {}; // { Teacher: fn(caller, cfg, now) -> Mission[] }
const GAME_MODULE_QUESTS = {};   // { Teacher: fn(caller, cfg, now) -> QuestState[] }

function gameJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function gameDispatch_(caller, action, params) {
  // ponytail: no built-in actions yet; missions/windows/quests files add theirs via GAME_MODULE_ACTIONS
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
  return ss.getUrl();
}
