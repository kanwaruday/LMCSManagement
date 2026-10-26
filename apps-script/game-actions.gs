// ═══════════════════════════════════════════════════════════════════
// LMCS Game Backend -- the built-in action layer (gametoday, gamedecide, gametourseen),
// split out of game.gs (ruling R22). Wires the pure modules (game-missions.gs, game-windows.gs,
// game-quests.gs) to the Game workbook and the PDR / Coordinator backends.
// Everything it uses from game.gs (config, GAME_TABS, gameDayKey_, gameVisibleCampuses_ ...) is a
// global; Apps Script loads all files in one scope, so function declarations here need no ordering.
// ═══════════════════════════════════════════════════════════════════

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
  // no email = no cache: an entry keyed on '' would be shared by everyone without one
  const cache = email ? CacheService.getScriptCache() : null;
  const key = cache ? 'gamefetch_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, url + '|' + String(email).toLowerCase())) : '';
  const hit = cache && cache.get(key);
  if (hit) return JSON.parse(hit);
  try {
    const res = UrlFetchApp.fetch(url + (url.indexOf('?') === -1 ? '?' : '&') + 'idToken=' + encodeURIComponent(idToken), { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() !== 200) return null;
    let json = JSON.parse(res.getContentText());
    if (!json || json.success === false) return null;
    if (project) json = project(json);
    if (cache) try { cache.put(key, JSON.stringify(json), GAME_FETCH_CACHE_S); } catch (err) { /* too big to cache */ }
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
// down = names of the sources that failed. A missing Recommendations or PDR Issue Actions tab is empty, not a failure.
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
    src.issueActions = tab(GAME_PDR_SHEET_ID, 'PDR Issue Actions', 'issueactions', true); // not created yet = no actions, not an outage
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
  const hooks = gameModuleHooks_(GAME_MODULE_DONE_AT, role); // first module with an answer wins; a throw is null (finalize's rule)
  const doneAtFn = hooks.length ? function (id) {
    for (let i = 0; i < hooks.length; i++) { let at = null; try { at = hooks[i](caller, id); } catch (err) { at = null; } if (typeof at === 'number' && isFinite(at)) return at; }
    return null;
  } : null;
  const finalize = [];
  let latest = null;
  for (let i = 1; i < dailyRows.length; i++) {
    const r = dailyRows[i], day = gameDayCell_(r[0]);
    if (gameLower_(r[1]) !== who || day >= dayKey) continue;
    const ids = gameIdList_(r[4]), doneIds = gameIdList_(r[5]);
    if (!latest || day > latest.day) latest = { day: day, ids: ids, doneIds: doneIds };
    if (!sourcesOk || r[6] === true || String(r[6]).toLowerCase() === 'true') continue;
    const f = gameFinalizeDay_({ missionIds: ids, doneIds: doneIds, coreIds: gameIdList_(r[9]) }, missionsNow, day, doneAtFn);
    finalize.push({ row: i + 1, onTrack: f.counted ? f.onTrack : '' }); // R14: blank = nothing to count
  }
  // rolled over = the latest earlier day's ids that were not seen done that day
  const carried = latest ? latest.ids.filter(function (id) { return latest.doneIds.indexOf(id) === -1; }) : [];
  const snap = gameSnapshot_(dailyRows, caller.email, dayKey);
  return {
    finalize: finalize, carried: carried, snapshotIds: snap ? snap.missionIds : null, snapshot: snap,
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
  // response (no greeting), and the first healthy load creates the day's set. A new snapshot starts with DoneIds '[]';
  // later loads add each snapshot id seen done (and not shared), so a day-scoped mission that is gone by tomorrow
  // morning still counts for its day. Ids already there are kept.
  if (plan.snapshot) {
    const seen = plan.snapshot.doneIds.slice(), byId = {};
    missionsNow.forEach(function (m) { byId[m.id] = m; });
    plan.snapshot.missionIds.forEach(function (id) {
      const m = byId[id];
      if (m && m.done && !m.shared && seen.indexOf(id) === -1) seen.push(id);
    });
    if (seen.length > plan.snapshot.doneIds.length) {
      sh.getRange(plan.snapshot.row, 6).setNumberFormat('@').setValue(JSON.stringify(seen));
      rows[plan.snapshot.row - 1][5] = JSON.stringify(seen);
    }
  }
  const created = !!plan.newIds && sourcesOk;
  if (created) {
    const byId = {};
    missionsNow.forEach(function (m) { byId[m.id] = m; });
    const coreIds = plan.newIds.filter(function (id) { return byId[id] && byId[id].core && !byId[id].shared; });
    const r = [dayKey, gameLower_(caller.email), caller.primaryRole, caller.campusId, JSON.stringify(plan.newIds), '[]', '', '', now.toISOString(), JSON.stringify(coreIds)];
    gameAppendText_(sh, [r]);
    rows.push(r);
  }
  return { rows: rows, carried: plan.carried, snapshotIds: plan.newIds || plan.snapshotIds, created: created };
}

// Closed windows: append each undecided campus's default and write it to Game Config (lazily, on read)
function gameSyncWindows_(ss, now, peek) {
  const cfgSheet = ss.getSheetByName('Game Config'), cfgRows = cfgSheet.getDataRange().getValues();
  const winRows = ss.getSheetByName('Game Windows').getDataRange().getValues();
  const decSheet = ss.getSheetByName('Game Decisions'), decRows = decSheet.getDataRange().getValues();
  const defaults = gameApplyDefaults_(winRows, decRows, now, gameParseConfig_(cfgRows));
  if (defaults.length && !peek) { // peek (the floating Buddy) writes nothing: a closed window's default lands on the next real load
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
  let missionsNow = gameMissionsFor_(caller, loaded.src, cfg0, now, loaded.down);
  if (!Array.isArray(missionsNow)) return { success: true, notYet: true }; // no missions for this role yet
  if (role === 'Coordinator') missionsNow = missionsNow.filter(function (m) { return !m.campus || gameInPilot_(cfg0.pilotCampuses.Coordinator, m.campus); });

  const peek = String(params.peek || '') === '1'; // same view, no writes, no lock: opening Buddy must not use up the home greeting
  return (peek ? function (fn) { return fn(); } : gameWithLock_)(function () {
    let daily;
    if (peek) {
      const rows = ss.getSheetByName('Game Daily').getDataRange().getValues(), plan = gameDailyPlan_(rows, caller, dayKey, missionsNow, cfg0, loaded.down.length === 0);
      daily = { rows: rows, carried: plan.carried, snapshotIds: plan.newIds || plan.snapshotIds, created: false };
    } else daily = gamePersistDaily_(ss.getSheetByName('Game Daily'), caller, dayKey, missionsNow, cfg0, loaded.down.length === 0, now);
    const win = gameSyncWindows_(ss, now, peek), cfg = win.cfg;
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
    if (!peek) gameAppendText_(progSheet, newly.map(function (n) { return [me, 'quest_step', n.questId + ':' + n.stepId, 'done', now.toISOString()]; }));
    let quests = gameQuestState_(questRows, role, evidence, progRows, me, cfg);
    gameModuleHooks_(GAME_MODULE_QUESTS, role).forEach(function (fn) { // runs under the lock: modules keep this cheap; a throw drops only its quests
      try { const q = fn(caller, cfg, now); if (Array.isArray(q)) quests = quests.concat(q); } catch (err) { console.error('game module quests', fn.name, err); }
    });

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
