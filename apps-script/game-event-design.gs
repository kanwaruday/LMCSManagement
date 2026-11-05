var GAME_MODULE_ACTIONS = GAME_MODULE_ACTIONS || {};
var GAME_MODULE_MISSIONS = GAME_MODULE_MISSIONS || {};
var GAME_MODULE_QUESTS = GAME_MODULE_QUESTS || {};

// Owner quest "Design the event quests" (Uday, 2 Nov: "make that my quest to design quests"). Spec: owner-quest-event-design-spec.md.
// The Events Director exports its proposals (calendar changes C*, event chains B*, designs D*) from the vault into
// data/event-proposals.json on the portal site; Uday approves, edits, discusses or declines each one on owner/event-design.html.
// Nothing here writes to a calendar: an approved calendar item becomes a mission "Add to the calendar", and Uday adds it himself.
// Store: append-only Game Decisions rows, WindowId 'event-design', ScopeId = the item id, Value = the decision (JSON text),
//   Note = JSON { note, edit }. An item's state is its rows in order (edState_); nothing is edited or deleted.
// Gates: GET eventdesign (read) and POST eventdesigndecide (write, one game.gs doPost line, never in GAME_MODULE_ACTIONS) are
//   Owner only, refused before anything is read. The item list is fetched from the site outside the lock and cached (ED_CACHE_S);
//   the quest hook runs under the lock, so it reads only that cache.
// Uses game.gs / game-actions.gs / game-missions.gs globals only inside function bodies: load order is not ours.

var ED_WINDOW = 'event-design';
var ED_URL = 'https://kanwaruday.github.io/LMCSManagement/data/event-proposals.json'; // Game Config eventDesignUrl overrides it
var ED_CACHE_KEY = 'ed_items', ED_CACHE_S = 600;
var ED_GO = 'owner/event-design.html';
var ED_GROUPS = [['calendar', 'Calendar changes'], ['chain', 'Event chains'], ['design', 'Designs']];
var ED_DECISIONS = ['approved', 'declined', 'edited', 'discussing', 'reopened', 'added'];
var ED_MAX = { note: 1000, title: 120, summary: 600 };

function edIsOwner_(caller) { return !!caller && Array.isArray(caller.roles) && caller.roles.indexOf('Owner') !== -1; }
function edFail_(code, error) { return { success: false, code: code, error: error }; }
function edIsDate_(s) { const d = new Date(s + 'T00:00:00Z'); return /^\d{4}-\d\d-\d\d$/.test(s) && !isNaN(d) && d.toISOString().slice(0, 10) === s; } // no 30 Feb
function edText_(v, max) { return typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max) : ''; }

// the export -> the few fields the server needs per item, or null if it isn't a usable list
function edParse_(json) {
  let d;
  try { d = JSON.parse(json); } catch (err) { return null; }
  if (!d || !Array.isArray(d.items)) return null;
  const seen = {}, out = [];
  d.items.forEach(function (it) {
    if (!it || typeof it.id !== 'string' || !/^[A-Za-z0-9_-]{1,20}$/.test(it.id) || seen[it.id]) return;
    if (!ED_GROUPS.some(function (g) { return g[0] === it.group; })) return;
    seen[it.id] = true;
    const p = it.payload && typeof it.payload === 'object' ? it.payload : {};
    out.push({ id: it.id, group: it.group, title: String(it.title || it.id), calendar: String(p.calendar || ''), eventTitle: String(p.eventTitle || ''), to: String(p.to || '') });
  });
  return out.length ? out : null;
}

// cacheOnly (under the lock): never fetches. Else a cache miss fetches the site once. null when unknown.
function edItems_(cfg, cacheOnly) {
  const cache = CacheService.getScriptCache(), hit = cache.get(ED_CACHE_KEY);
  if (hit) { try { return JSON.parse(hit); } catch (err) { /* refetch */ } }
  if (cacheOnly) return null;
  try {
    const url = (cfg && typeof cfg.eventDesignUrl === 'string' && /^https:\/\//.test(cfg.eventDesignUrl)) ? cfg.eventDesignUrl : ED_URL;
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() !== 200) { console.warn('event-design: proposals HTTP ' + res.getResponseCode()); return null; }
    const items = edParse_(res.getContentText());
    if (items) cache.put(ED_CACHE_KEY, JSON.stringify(items), ED_CACHE_S);
    return items;
  } catch (err) { console.error('event-design: proposals fetch ' + (err && err.message)); return null; }
}

// Game Decisions rows -> { id: { status, note, edit, decidedAt, decidedBy, added } } for this window only, in row order
function edState_(rows) {
  const out = {};
  (rows || []).slice(1).forEach(function (r) {
    if (String(r[0]) !== ED_WINDOW) return;
    const id = String(r[1]); let v, n;
    try { v = JSON.parse(String(r[2])); } catch (err) { v = String(r[2]); }
    if (ED_DECISIONS.indexOf(v) === -1) return;
    try { n = JSON.parse(String(r[3] || '{}')) || {}; } catch (err) { n = {}; }
    const s = out[id] = out[id] || { status: 'proposed', note: '', edit: {}, decidedAt: '', decidedBy: '', added: false };
    const at = r[5] instanceof Date ? r[5].toISOString() : String(r[5] || '');
    if (v === 'added') { if (s.status === 'approved') { s.added = true; s.addedAt = at; } return; }
    if (v === 'edited' && n.edit && typeof n.edit === 'object') Object.keys(n.edit).forEach(function (k) { s.edit[k] = n.edit[k]; });
    s.status = v === 'reopened' ? 'proposed' : v;
    s.note = typeof n.note === 'string' ? n.note : '';
    s.decidedAt = at; s.decidedBy = String(r[4] || '');
    if (v !== 'approved') s.added = false;
  });
  return out;
}

function edDecided_(s) { return !!s && (s.status === 'approved' || s.status === 'declined'); }
function edDecRows_() { return gameBook_().getSheetByName('Game Decisions').getDataRange().getValues(); }

// GET eventdesign -> { success, decisions }. The page reads the items themselves from the same site.
function edGet_(caller) {
  if (!edIsOwner_(caller)) return edFail_('ED_OWNER_ONLY', 'This quest is for the Owner.');
  try { return { success: true, decisions: edState_(edDecRows_()) }; }
  catch (err) { console.error('eventdesign: ' + (err && err.message)); return edFail_('ED_ERROR', "Uday's decisions couldn't be read. Try again."); }
}

// POST eventdesigndecide { id, decision, note?, edit? } -> { success, id, state }
//   approved | declined (note = the reason, required) | edited (edit = { title?, to?, summary? }, at least one) |
//   discussing (note required) | reopened | added (only an approved calendar item: Uday has put it on the calendar himself)
function eventDesignDecide_(caller, body) {
  if (!edIsOwner_(caller)) return edFail_('ED_OWNER_ONLY', 'This quest is for the Owner.');
  try {
    body = body && typeof body === 'object' ? body : {};
    const decision = String(body.decision || '');
    if (ED_DECISIONS.indexOf(decision) === -1) return edFail_('ED_BAD', "That isn't a choice here.");
    const note = edText_(body.note, ED_MAX.note);
    if ((decision === 'declined' || decision === 'discussing') && !note) return edFail_('ED_NOTE', decision === 'declined' ? 'Say why you are declining it.' : 'Type your note first.');
    let edit = null;
    if (decision === 'edited') {
      const e = body.edit && typeof body.edit === 'object' ? body.edit : {};
      edit = {};
      const t = edText_(e.title, ED_MAX.title), s = edText_(e.summary, ED_MAX.summary), to = edText_(e.to, 20);
      if (t) edit.title = t;
      if (s) edit.summary = s;
      if (to) { if (!edIsDate_(to)) return edFail_('ED_DATE', 'That date does not look right.'); edit.to = to; }
      if (!Object.keys(edit).length) return edFail_('ED_EDIT', 'Change the title, date or text first.');
    }
    const items = edItems_(null, false); // outside the lock
    if (!items) return edFail_('ED_NO_ITEMS', "The proposals couldn't be loaded. Try again in a minute.");
    const item = items.filter(function (x) { return x.id === body.id; })[0];
    if (!item) return edFail_('ED_UNKNOWN', 'That proposal is not on the list any more. Reload the page.');
    const me = gameLower_(caller.email);
    return gameWithLock_(function () {
      const sh = gameBook_().getSheetByName('Game Decisions');
      const cur = edState_(sh.getDataRange().getValues())[item.id] || { status: 'proposed', added: false };
      if (decision === 'added' && (item.group !== 'calendar' || cur.status !== 'approved')) return edFail_('ED_NOT_APPROVED', 'Approve the calendar change first.');
      if (decision === 'added' && cur.added) return { success: true, id: item.id, state: cur, unchanged: true };
      gameAppendText_(sh, [gameDecisionRow_({ windowId: ED_WINDOW, scopeId: item.id, value: decision,
        note: JSON.stringify(edit ? { note: note, edit: edit } : { note: note }), decidedBy: me, decidedAt: gameNow_().toISOString(), kind: 'decided' })]);
      return { success: true, id: item.id, state: edState_(sh.getDataRange().getValues())[item.id] };
    });
  } catch (err) {
    console.error('eventdesigndecide: ' + (err && err.message)); // logged, never returned
    return edFail_('ED_ERROR', "That didn't save. Try again.");
  }
}

// the approved calendar changes still to add, with the final title and date (an edit wins)
function edToAdd_(items, state) {
  return items.filter(function (it) { const s = state[it.id]; return it.group === 'calendar' && s && s.status === 'approved' && !s.added; });
}

// Missions (outside the lock: warms the item cache). Owner only by registration. Never throws.
function edMissions_(caller, cfg, now) {
  try {
    const items = edItems_(cfg, false);
    if (!items) return [];
    const state = edState_(edDecRows_()), left = items.filter(function (it) { return !edDecided_(state[it.id]); }).length;
    const approvedCal = items.filter(function (it) { const s = state[it.id]; return it.group === 'calendar' && s && s.status === 'approved'; });
    const toAdd = edToAdd_(items, state).length, out = [], today = gameDayKey_(now);
    // a finished mission shows (as done) only on the day it was finished
    const lastDay = Object.keys(state).reduce(function (m, k) { const t = state[k].addedAt || state[k].decidedAt; return t > m ? t : m; }, '');
    const fresh = !!lastDay && gameDayKey_(new Date(lastDay)) === today;
    if (left || fresh) out.push(gameMission_('ed_decide', 'network', { title: left ? 'Design the event quests: ' + left + ' to decide' : 'Design the event quests: all decided',
      why: 'Events Director proposals', owner: caller.email, go: ED_GO, progress: { done: items.length - left, total: items.length }, done: !left }));
    if (approvedCal.length && (toAdd || fresh)) out.push(gameMission_('ed_calendar', 'network', { title: toAdd ? 'Add ' + toAdd + ' approved event' + (toAdd === 1 ? '' : 's') + ' to the calendars' : 'Approved events are on the calendars',
      why: 'You add them yourself; nothing is written for you', owner: caller.email, go: ED_GO + '#to-add', progress: { done: approvedCal.length - toAdd, total: approvedCal.length }, done: !toAdd }));
    return out;
  } catch (err) { console.error('event-design missions: ' + (err && err.message)); return []; }
}

// The quest (under the lock: cached items only, one Game Decisions read). One step per group, done when the group is all decided.
function edQuests_(caller, cfg, now) {
  try {
    const items = edItems_(cfg, true);
    if (!items) return [{ questId: 'owner:event-design', title: '📅 Design the event quests', parallel: true, complete: false,
      steps: [{ id: 'open', title: 'Open the Events Director’s proposals', go: ED_GO, done: false, locked: false }] }];
    const state = edState_(edDecRows_());
    const steps = ED_GROUPS.map(function (g) {
      const mine = items.filter(function (it) { return it.group === g[0]; }), n = mine.filter(function (it) { return edDecided_(state[it.id]); }).length;
      return mine.length ? { id: g[0], title: g[1] + ': ' + n + ' of ' + mine.length + ' decided', go: ED_GO + '#' + g[0], done: n === mine.length, locked: false } : null;
    }).filter(Boolean);
    return [{ questId: 'owner:event-design', title: '📅 Design the event quests', parallel: true, steps: steps, complete: steps.every(function (s) { return s.done; }),
      reward: 'Every proposal decided. The Events Director turns the approved ones into quests.' }];
  } catch (err) { console.error('event-design quest: ' + (err && err.message)); return []; }
}

// ── registration (this file's own functions only) ───────────────────
GAME_MODULE_ACTIONS.eventdesign = edGet_;
GAME_MODULE_MISSIONS.Owner = [].concat(GAME_MODULE_MISSIONS.Owner || [], edMissions_);
GAME_MODULE_QUESTS.Owner = [].concat(GAME_MODULE_QUESTS.Owner || [], edQuests_);
