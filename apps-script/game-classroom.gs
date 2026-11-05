var GAME_MODULE_ACTIONS = GAME_MODULE_ACTIONS || {};
var GAME_MODULE_MISSIONS = GAME_MODULE_MISSIONS || {};
var GAME_MODULE_QUESTS = GAME_MODULE_QUESTS || {};

// ═══════════════════════════════════════════════════════════════════
// LMCS Game Backend -- the Classroom setup chain (V2 row #4; Uday, 1 Nov). A teacher's own class from the ERP's Assignments tab
// (game-erp.gs erpScope_), "Meet your students" (the teacher confirms the list), and the classroom's items photographed for the
// inventory. Steps 3 (the classroom as 3D) and 4 (a class photo) are NOT built: no student photo anywhere, ever, in this file.
//
//   GET  classroomget                        the caller's ties, confirmed lists, items (Teacher / Staff; own data only)
//   POST classroomsave {op:confirm|item|remove|itemsdone}   one doPost line in game.gs
//   Quest classroom:setup "Set up your classroom" (Teacher), gate family hook:classroom (QUEST_GATE_HOOKS)
//
// Storage: Game Progress rows (Kind classroom_meet / classroom_itemsdone, Key <campus>:<class>:<section>, never a name) and the
// append-only Game workbook tab `Classroom Items` (latest row per email+campus+class+section+itemId wins). Photos go to Drive under
// Script property CLASSROOM_PHOTOS_FOLDER_ID / <campus>; while that property is unset the items step and op:item do not exist.
// LOCKS: the quest hook runs under gameWithLock_ and reads CacheService only (ties 10 min, state 6 h), warmed by the missions hook
// (outside the lock) and by classroomget / classroomsave. A cold cache is a calm `waiting`, never a Sheet read.
// LOGS: counts and codes only. Never a name, email, item name or file id, in a log line or in an error sent to the page.
// ═══════════════════════════════════════════════════════════════════

var CLASSROOM_QUEST_ID = 'classroom:setup';
var CLASSROOM_TAB = 'Classroom Items';
var CLASSROOM_HEAD = ['At', 'Email', 'Campus', 'Class', 'Section', 'ItemId', 'Name', 'Count', 'FileId', 'Status'];
var CLASSROOM_MEET = 'classroom_meet';
var CLASSROOM_ITEMS_DONE = 'classroom_itemsdone';
var CLASSROOM_PHOTOS_PROP = 'CLASSROOM_PHOTOS_FOLDER_ID';
var CLASSROOM_TIES_TTL_S = 600;
var CLASSROOM_STATE_TTL_S = 21600; // CacheService's maximum; every write refreshes it
var CLASSROOM_MAX_PHOTO = 2 * 1024 * 1024;
var CLASSROOM_GO = 'teacher/index.html#classroom';
var CLASSROOM_GATE = { id: 'hook:classroom', title: 'Set up your classroom', roles: ['Teacher'] };

// The quest gate row. game-kingdom.gs ASSIGNS QUEST_GATE_HOOKS (no `|| {}`) and clasp pushes files alphabetically, so this file can run
// first and a plain `QUEST_GATE_HOOKS.x = ...` here would be wiped. Either order: add now, or add when game-kingdom.gs assigns it.
// (No `var` here on purpose: a var binding is non-configurable and would block the accessor.)
// ponytail: remove the accessor once game-kingdom.gs declares `var QUEST_GATE_HOOKS = Object.assign(QUEST_GATE_HOOKS || {}, {...})`.
(function () {
  if (typeof QUEST_GATE_HOOKS === 'object' && QUEST_GATE_HOOKS) { QUEST_GATE_HOOKS.classroomQuests_ = CLASSROOM_GATE; return; }
  var held;
  Object.defineProperty(globalThis, 'QUEST_GATE_HOOKS', { configurable: true, enumerable: true,
    get: function () { return held; },
    set: function (v) { held = v; if (v && typeof v === 'object') v.classroomQuests_ = CLASSROOM_GATE; } });
  globalThis.QUEST_GATE_HOOKS = { classroomQuests_: CLASSROOM_GATE };
})();

function classroomErr_(code, error) { return { success: false, code: code, error: error }; }
function classroomNorm_(v) { return String(v === null || v === undefined ? '' : v).trim().replace(/\s+/g, ' ').toUpperCase(); }
function classroomKey_(campus, cls, section) { return [classroomNorm_(campus).replace(/\s/g, ''), classroomNorm_(cls), classroomNorm_(section)].join(':'); }
function classroomMayUse_(caller) { const r = (caller && caller.roles) || []; return r.indexOf('Teacher') !== -1 || r.indexOf('Staff') !== -1; }
function classroomPhotosOn_() { return !!String(PropertiesService.getScriptProperties().getProperty(CLASSROOM_PHOTOS_PROP) || '').trim(); }
function classroomCache_() { return CacheService.getScriptCache(); }
function classroomCacheKey_(kind, caller) { return 'clsr_' + kind + '_' + gameLower_(caller.email); }
function classroomCacheGet_(kind, caller) {
  try { const s = classroomCache_().get(classroomCacheKey_(kind, caller)); return s ? JSON.parse(s) : null; } catch (err) { return null; }
}
function classroomCachePut_(kind, caller, val, ttl) {
  try { classroomCache_().put(classroomCacheKey_(kind, caller), JSON.stringify(val), ttl); } catch (err) { /* uncached: read again next time */ }
}

// ── ties: the caller's class / subject ties on their own campus, from the ERP module (absent = "ERP not connected") ──
// -> { connected, configured, note, ties: [{campus, kind, class, section, subject}] }. Reads the ERP Sheet: never under the lock.
function classroomTiesFresh_(caller) {
  if (typeof erpScope_ !== 'function') return { connected: false, configured: false, note: "The school's ERP list isn't connected yet.", ties: [] };
  const r = erpScope_(caller) || {};
  const own = String(caller.campusId || '').toUpperCase().split(',').map(function (c) { return c.replace(/\s/g, ''); });
  const ties = (r.ties || []).filter(function (t) { return (t.kind === 'class' || t.kind === 'subject') && own.indexOf(classroomNorm_(t.campus).replace(/\s/g, '')) !== -1; })
    .map(function (t) { return { campus: classroomNorm_(t.campus).replace(/\s/g, ''), kind: t.kind, class: classroomNorm_(t.class), section: classroomNorm_(t.section), subject: classroomNorm_(t.subject) }; });
  const cs = (r.campuses || []).filter(function (c) { return own.indexOf(c.campus) !== -1; });
  const configured = cs.some(function (c) { return c.configured; });
  const out = { connected: true, configured: configured, note: configured ? '' : 'ERP data for ' + gameCampusLabel_(own[0] || '') + " isn't connected yet.", ties: ties };
  classroomCachePut_('ties', caller, out, CLASSROOM_TIES_TTL_S);
  return out;
}
function classroomTies_(caller) { return classroomCacheGet_('ties', caller) || classroomTiesFresh_(caller); }
function classroomTieFor_(ties, key) { return (ties || []).filter(function (t) { return classroomKey_(t.campus, t.class, t.section) === key; })[0] || null; }

// ── state: confirmed lists, items, items-done, from Game Progress + Classroom Items (the caller's rows only) ──
function classroomItemsTab_(ss) {
  let sh = ss.getSheetByName(CLASSROOM_TAB);
  if (!sh) { sh = ss.insertSheet(CLASSROOM_TAB); gameAppendText_(sh, [CLASSROOM_HEAD]); }
  return sh;
}
// rows (header first) -> { <classKey>: { <itemId>: {id, name, count, fileId, status, at} } }, latest row wins
function classroomItemsFrom_(rows, me) {
  const out = {};
  (rows || []).slice(1).forEach(function (r) {
    if (gameLower_(r[1]) !== me) return;
    const key = classroomKey_(r[2], r[3], r[4]), id = String(r[5] || '');
    if (!id) return;
    (out[key] = out[key] || {})[id] = { id: id, name: String(r[6] || ''), count: Number(r[7]) || 0, fileId: String(r[8] || ''), status: String(r[9] || 'live'), at: String(r[0] || '') };
  });
  return out;
}
function classroomLive_(items, key) {
  const m = items[key] || {};
  return Object.keys(m).map(function (id) { return m[id]; }).filter(function (it) { return it.status !== 'removed'; });
}
// -> { confirmed: {key:true}, itemsDone: {key:true}, items } (itemsDone only while a live item with a photo remains). Caches the summary.
function classroomReadState_(caller) {
  const me = gameLower_(caller.email), ss = gameBook_(), confirmed = {}, flagged = {};
  ss.getSheetByName('Game Progress').getDataRange().getValues().slice(1).forEach(function (r) {
    if (gameLower_(r[0]) !== me) return;
    if (r[1] === CLASSROOM_MEET) confirmed[String(r[2])] = true;
    if (r[1] === CLASSROOM_ITEMS_DONE) flagged[String(r[2])] = true;
  });
  const tab = ss.getSheetByName(CLASSROOM_TAB), items = classroomItemsFrom_(tab ? tab.getDataRange().getValues() : [], me), itemsDone = {};
  Object.keys(flagged).forEach(function (k) { if (classroomLive_(items, k).some(function (it) { return !!it.fileId; })) itemsDone[k] = true; });
  classroomCachePut_('state', caller, { confirmed: confirmed, itemsDone: itemsDone }, CLASSROOM_STATE_TTL_S);
  return { confirmed: confirmed, itemsDone: itemsDone, items: items };
}

function classroomView_(tiesR, state, photosOn) {
  const items = [];
  if (photosOn) Object.keys(state.items).forEach(function (k) {
    classroomLive_(state.items, k).forEach(function (it) { items.push({ classKey: k, id: it.id, name: it.name, count: it.count, hasPhoto: !!it.fileId, at: it.at }); });
  });
  return { success: true, ties: tiesR.ties, erp: { connected: tiesR.connected, configured: tiesR.configured, note: tiesR.note || '' },
    confirmed: state.confirmed, photosOn: photosOn, items: items, itemsDone: photosOn && Object.keys(state.itemsDone).length > 0, itemsDoneFor: photosOn ? state.itemsDone : {} };
}

// ── GET classroomget ──
function classroomGet_(caller) {
  if (!classroomMayUse_(caller)) return classroomErr_('CLASSROOM_NOT_YOURS', 'My class is for teachers and staff.');
  try {
    const tiesR = classroomTiesFresh_(caller), state = classroomReadState_(caller);
    console.log('classroomget ties=' + tiesR.ties.length);
    return classroomView_(tiesR, state, classroomPhotosOn_());
  } catch (err) {
    console.error('classroomget failed: CLASSROOM_READ_FAILED'); // no message: it could carry an id
    return classroomErr_('CLASSROOM_READ_FAILED', "Your class couldn't be loaded just now. Try again in a minute.");
  }
}

// ── POST classroomsave ──
function classroomJpeg_(photo) {
  const s = String(photo || '').replace(/^data:[^,]*,/, '');
  if (!s) return { code: 'CLASSROOM_NEED_PHOTO', error: 'Add a photo of the item.' };
  if (s.length > Math.ceil(CLASSROOM_MAX_PHOTO * 4 / 3) + 4) return { code: 'CLASSROOM_TOO_BIG', error: 'That photo is too big (over 2 MB). Take it again.' }; // before decoding
  let bytes;
  try { bytes = Utilities.base64Decode(s); } catch (err) { return { code: 'CLASSROOM_NOT_JPEG', error: 'That photo could not be read. Take it again.' }; }
  if (bytes.length > CLASSROOM_MAX_PHOTO) return { code: 'CLASSROOM_TOO_BIG', error: 'That photo is too big (over 2 MB). Take it again.' };
  if (bytes.length < 3 || (bytes[0] & 255) !== 0xFF || (bytes[1] & 255) !== 0xD8 || (bytes[2] & 255) !== 0xFF) return { code: 'CLASSROOM_NOT_JPEG', error: 'Only JPEG photos can be saved. Take the photo again.' };
  return { bytes: bytes };
}
function classroomStamp_(d) { return new Date(d.getTime() + 330 * 60000).toISOString().replace(/[-:T]/g, '').slice(0, 12); } // yyyymmddHHMM, IST
function classroomSafe_(s) { return classroomNorm_(s).replace(/[^A-Z0-9]/g, ''); }

// Drive: <parent>/<campus>/<campus>-<class><section>-<itemId>-<yyyymmddHHMM>.jpg (no person's name). -> file
function classroomDriveSave_(campus, cls, section, itemId, bytes, now) {
  const parent = DriveApp.getFolderById(String(PropertiesService.getScriptProperties().getProperty(CLASSROOM_PHOTOS_PROP)).trim());
  const it = parent.getFoldersByName(campus), folder = it.hasNext() ? it.next() : parent.createFolder(campus);
  const name = campus + '-' + classroomSafe_(cls) + classroomSafe_(section) + '-' + itemId + '-' + classroomStamp_(now) + '.jpg';
  return folder.createFile(Utilities.newBlob(bytes, 'image/jpeg', name));
}

function classroomSave_(caller, body) {
  try {
    if (!classroomMayUse_(caller)) return classroomErr_('CLASSROOM_NOT_YOURS', 'My class is for teachers and staff.');
    body = body && typeof body === 'object' ? body : {};
    const op = String(body.op || ''), me = gameLower_(caller.email), now = gameNow_(), tiesR = classroomTiesFresh_(caller); // fresh: an unlinked teacher can't write from a cached tie
    const NOT_YOURS = classroomErr_('CLASSROOM_NOT_YOURS', "That class isn't linked to you. Your Principal links you to your class.");
    const key = op === 'confirm' ? classroomKey_(body.campus, body.class, body.section) : String(body.classKey || '');
    const tie = classroomTieFor_(tiesR.ties, key);
    const photosOn = classroomPhotosOn_();
    if (['confirm', 'item', 'remove', 'itemsdone'].indexOf(op) === -1) return classroomErr_('CLASSROOM_BAD_REQUEST', 'That change is not one this page can make.');
    if (op !== 'confirm' && !photosOn) return classroomErr_('CLASSROOM_PHOTOS_OFF', 'Classroom photos are not switched on yet.');
    if (op === 'item' && body.noChildren !== true) return classroomErr_('CLASSROOM_NO_CHILDREN_TICK', 'Tick "There are no children in this photo" first.');
    if (!tie) return NOT_YOURS;
    const progRow = function (kind) {
      gameWithLock_(function () {
        const sh = gameBook_().getSheetByName('Game Progress');
        const have = sh.getDataRange().getValues().slice(1).some(function (r) { return gameLower_(r[0]) === me && r[1] === kind && String(r[2]) === key; });
        if (!have) gameAppendText_(sh, [[me, kind, key, 'done', now.toISOString()]]);
      });
    };
    const done = function () {
      const out = classroomView_(tiesR, classroomReadState_(caller), photosOn);
      console.log('classroomsave ' + op + ' ok items=' + out.items.length);
      return out;
    };

    if (op === 'confirm') { progRow(CLASSROOM_MEET); return done(); }

    const live = classroomLive_(classroomReadState_(caller).items, key);
    if (op === 'itemsdone') {
      if (!live.some(function (it) { return !!it.fileId; })) return classroomErr_('CLASSROOM_NEEDS_PHOTO', 'Save at least one item with its photo first.');
      progRow(CLASSROOM_ITEMS_DONE); return done();
    }
    const itemId = String(body.itemId || '');
    const old = itemId ? live.filter(function (it) { return it.id === itemId; })[0] : null;
    if (itemId && !old) return classroomErr_('CLASSROOM_NO_ITEM', "That item isn't on your list any more.");
    // under the lock: an edit or removal applies only while the item is still live (two tabs: Remove then Change must not revive it)
    const row = function (vals) {
      let ok = true;
      gameWithLock_(function () {
        const sh = classroomItemsTab_(gameBook_());
        if (old) ok = classroomLive_(classroomItemsFrom_(sh.getDataRange().getValues(), me), key).some(function (it) { return it.id === old.id; });
        if (ok) gameAppendText_(sh, [vals]);
      });
      return ok;
    };
    // a removed or replaced photo leaves Drive too (a child caught in frame must be deletable); after the row lands
    const trash = function (id) { if (!id) return; try { DriveApp.getFileById(id).setTrashed(true); } catch (err) { console.error('classroom photo trash failed'); } };
    const GONE = classroomErr_('CLASSROOM_NO_ITEM', "That item isn't on your list any more.");
    if (op === 'remove') {
      if (!old) return classroomErr_('CLASSROOM_NO_ITEM', "That item isn't on your list any more.");
      if (!row([now.toISOString(), me, tie.campus, tie.class, tie.section, old.id, old.name, String(old.count), '', 'removed'])) return GONE;
      trash(old.fileId);
      return done();
    }

    // op === 'item'
    const name = String(body.name || '').trim().replace(/\s+/g, ' ');
    if (!name || name.length > 60) return classroomErr_('CLASSROOM_BAD_NAME', 'Give the item a name (up to 60 letters).');
    const count = Number(body.count);
    if (!(Number.isInteger(count) && count >= 1 && count <= 999)) return classroomErr_('CLASSROOM_BAD_COUNT', 'The count is a whole number from 1 to 999.');
    let fileId = old ? old.fileId : '', file = null;
    const id = old ? old.id : 'i' + now.getTime().toString(36) + Math.floor(Math.random() * 1296).toString(36);
    if (body.photo || !old) {
      const j = classroomJpeg_(body.photo);
      if (!j.bytes) return classroomErr_(j.code, j.error);
      file = classroomDriveSave_(tie.campus, tie.class, tie.section, id, j.bytes, now); // slow: outside the lock
      fileId = file.getId();
    }
    let landed;
    try { landed = row([now.toISOString(), me, tie.campus, tie.class, tie.section, id, name, String(count), fileId, 'live']); }
    catch (err) { if (file) { try { file.setTrashed(true); } catch (e) { /* left in the folder */ } } throw err; }
    if (!landed) { if (file) trash(fileId); return GONE; }
    if (file && old && old.fileId && old.fileId !== fileId) trash(old.fileId);
    return done();
  } catch (err) {
    console.error('classroomsave failed: CLASSROOM_SAVE_FAILED'); // no message: it could carry an id
    return classroomErr_('CLASSROOM_SAVE_FAILED', "That didn't save. Try again.");
  }
}

// ── the quest: missions warm the caches (outside the lock); the quest reads only the caches (under the lock) ──
function classroomMissions_(caller) {
  try { classroomTies_(caller); if (!classroomCacheGet_('state', caller)) classroomReadState_(caller); }
  catch (err) { console.error('classroom warm failed'); }
  return [];
}

// Never a Sheet read: CacheService and one Script property only. Steps open one after another.
function classroomQuests_(caller) {
  const tiesR = classroomCacheGet_('ties', caller), st = classroomCacheGet_('state', caller) || { confirmed: {}, itemsDone: {} };
  const ties = tiesR ? tiesR.ties || [] : [], keys = [];
  ties.forEach(function (t) { const k = classroomKey_(t.campus, t.class, t.section); if (keys.indexOf(k) === -1) keys.push(k); });
  const linked = keys.length > 0;
  const steps = [
    { id: 'link', title: linked ? 'Your class is linked' : tiesR ? 'Your class is linked · ' + (tiesR.connected && tiesR.configured ? 'Your Principal links you to your class' : "the school's ERP list isn't connected yet") : 'Your class is linked · checking your class list',
      go: CLASSROOM_GO, done: linked, waiting: !linked },
    { id: 'meet', title: 'Meet your students', go: CLASSROOM_GO + '-students', done: linked && keys.every(function (k) { return !!st.confirmed[k]; }) },
  ];
  if (classroomPhotosOn_()) steps.push({ id: 'items', title: "Photograph your classroom's items", go: CLASSROOM_GO + '-items', done: keys.some(function (k) { return !!st.itemsDone[k]; }) });
  let open = true;
  steps.forEach(function (s) { s.locked = !open && !s.done; if (!s.done) open = false; s.waiting = !!s.waiting; });
  return [{ questId: CLASSROOM_QUEST_ID, title: 'Set up your classroom', parallel: true, steps: steps, complete: steps.every(function (s) { return s.done; }) }];
}

// ── registration (this file's own functions only) ──
GAME_MODULE_ACTIONS.classroomget = classroomGet_;
GAME_MODULE_MISSIONS.Teacher = [].concat(GAME_MODULE_MISSIONS.Teacher || [], classroomMissions_);
GAME_MODULE_QUESTS.Teacher = [].concat(GAME_MODULE_QUESTS.Teacher || [], classroomQuests_);
