var GAME_MODULE_ACTIONS = GAME_MODULE_ACTIONS || {};
var GAME_MODULE_QUESTS = GAME_MODULE_QUESTS || {};

// ═══════════════════════════════════════════════════════════════════
// LMCS Game Backend -- 📸 the workplace setup chain (V2 row #5; vault work/Role Screens Drafts.html, room setup chain steps 3–4).
// Uday, 1 Nov: "Once the Principal has allocated rooms names, allocated staff to the rooms, let the Teachers, Drivers, Fee Clerks all
// take pictures of their respective work places, to setup their home."
//   3  each person with a room (game-rooms.gs, N2: the Principal named it and put them in it) photographs it: the whole room from the
//      door, their desk or counter, the cupboard or files. Empty room only, ticked before sending. Classrooms are not here: the
//      Teacher Portal's classroom chain photographs those item by item. Buses are not rooms: the bus setup chain (game-bus-chain.gs).
//   4  the school's Principal approves the set or asks for a redo with a reason. A Principal's own room goes to the Owner.
//   workplaceget   (GET)  mine: the caller's rooms with each shot's state; review=1: the rooms waiting for this reviewer (Principal: own
//                         school, Owner: ?campus or every school's Principal-held rooms).
//   workplaceimage (GET)  one photo as base64, for the room's person or its reviewer only.
//   workplacesave  (POST only, from game.gs doPost; never in GAME_MODULE_ACTIONS) op photo | submit | decide.
// Storage: tab `Workplace Photos` in the Game workbook (created on first save), one row per room and shot. The photos go to a private
// folder "LMCS Workplace Photos/<campus>" in the deploying account's Drive (never shared, never the repo); a retake bins the old file.
// Rooms: read through game-rooms.gs (roomsRows_/roomsOf_); until that module is deployed there are no rooms, so no quests.
// Children's faces rule: rooms and furniture only. The page asks for an empty room; nobody below the reviewer sees another person's photos.
// Only this file's own functions are used at top level (load order: tests/apps-script/test-load-order.js).
// ═══════════════════════════════════════════════════════════════════

var WP_TAB = 'Workplace Photos';
var WP_HEADER = ['Campus', 'RoomId', 'RoomName', 'StaffEmail', 'Shot', 'FileId', 'At', 'Status', 'DecidedBy', 'DecidedAt', 'Note'];
var WP_SHOTS = [{ id: 'wide', label: 'The whole room, from the door' }, { id: 'desk', label: 'Your desk or counter' }, { id: 'store', label: 'Cupboard, shelves or files' }];
var WP_FOLDER = 'LMCS Workplace Photos';
var WP_MAX_B64 = 2800000; // ~2 MB of JPEG; the page sends 1280 px at 0.7, well under it
var WP_GO = 'workplace/index.html';
var WP_CODES = { WP_NO_ROOM: 'This room is not yours. Ask your Principal to put you in it.', WP_BAD_INPUT: 'Something in the photo does not look right. Take it again.',
  WP_DONE: 'This room is already approved.', WP_WAITING: 'These photos are with the reviewer now.', WP_MISSING: 'Take every photo first.',
  WP_TICK: 'Tick the box first: empty room, no children or people in the photos.', WP_NO_RIGHT: 'Only this school\'s Principal (or the Owner) can check these photos.',
  WP_NOT_WAITING: 'These photos are not waiting for a check.', WP_NOTE: 'Say what to take again (a few words).' };

function wpFail_(code) { return { success: false, code: code, error: WP_CODES[code] }; }
function wpRows_() { const sh = gameBook_().getSheetByName(WP_TAB); return sh ? sh.getDataRange().getValues() : [WP_HEADER]; }
function wpSheet_() {
  const book = gameBook_();
  let sh = book.getSheetByName(WP_TAB);
  if (!sh) { sh = book.insertSheet(WP_TAB); sh.appendRow(WP_HEADER); sh.setFrozenRows(1); }
  return sh;
}

// every school's rooms with a person (not classrooms): [{campus, id, name, type, staff}]; [] until game-rooms.gs is deployed
function wpRooms_() {
  if (typeof roomsRows_ !== 'function' || typeof roomsOf_ !== 'function') return [];
  const rows = roomsRows_(gameBook_()), out = [];
  ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6'].forEach(function (c) {
    roomsOf_(rows, c).forEach(function (r) { if (r.staff && r.type !== 'classroom') out.push({ campus: c, id: r.id, name: r.name, type: r.type, staff: r.staff }); });
  });
  return out;
}
// a room's state from the photo rows: {shots: {id: {fileId, at, row}}, status: 'none'|'draft'|'pending'|'approved'|'redo', note}
function wpState_(rows, room) {
  const st = { shots: {}, status: 'none', note: '' };
  rows.slice(1).forEach(function (r, i) {
    if (String(r[0]) !== room.campus || String(r[1]) !== room.id || gameLower_(r[3]) !== room.staff) return; // a room given to someone else starts over
    st.shots[String(r[4])] = { fileId: String(r[5]), at: r[6] instanceof Date ? r[6].toISOString() : String(r[6]), row: i + 2 };
    st.status = String(r[7]) || 'draft'; st.note = String(r[10] || '');
  });
  return st;
}
// who checks a room: its school's Principal, or the Owner when the room is a Principal's
function wpReviewerOf_(caller, room) {
  const roles = caller.roles || [];
  if (roles.indexOf('Owner') !== -1) return true;
  return caller.primaryRole === 'Principal' && caller.campusId === room.campus && room.staff !== gameLower_(caller.email);
}
function wpIsPrincipalRoom_(room, allow) { return (allow || []).indexOf(room.campus + '|' + room.staff) !== -1; }
// "LMS4|email" for every Principal on the allowlist (the Owner's review list: Principal-held rooms only)
function wpPrincipals_() {
  const rows = SpreadsheetApp.openById(GAME_ALLOWLIST_SHEET_ID).getSheets()[0].getDataRange().getValues().slice(1);
  return rows.filter(function (r) { return String(r[3] || '').split(',').map(function (x) { return x.trim(); }).indexOf('Principal') !== -1; })
    .map(function (r) { return String(r[2] || '').trim().toUpperCase() + '|' + gameLower_(r[0]); });
}
function wpPublic_(room, st) {
  return { campus: room.campus, roomId: room.id, roomName: room.name, staff: room.staff, status: st.status, note: st.note,
    shots: WP_SHOTS.map(function (s) { return { id: s.id, label: s.label, taken: !!st.shots[s.id] }; }) };
}

function workplaceGet_(caller, params) {
  const rooms = wpRooms_(), rows = wpRows_(), me = gameLower_(caller.email);
  if (String(params.review || '') !== '1') {
    return { success: true, shots: WP_SHOTS, rooms: rooms.filter(function (r) { return r.staff === me; }).map(function (r) { return wpPublic_(r, wpState_(rows, r)); }) };
  }
  const isOwner = (caller.roles || []).indexOf('Owner') !== -1;
  if (!isOwner && caller.primaryRole !== 'Principal') return wpFail_('WP_NO_RIGHT');
  const allow = isOwner ? wpPrincipals_() : null, want = String(params.campus || '').toUpperCase();
  const mine = rooms.filter(function (r) {
    if (!wpReviewerOf_(caller, r)) return false;
    return !isOwner || (want ? r.campus === want : wpIsPrincipalRoom_(r, allow));
  });
  return { success: true, shots: WP_SHOTS, rooms: mine.map(function (r) { return wpPublic_(r, wpState_(rows, r)); }).filter(function (x) { return x.status !== 'none' && x.status !== 'draft'; }) };
}

function workplaceImage_(caller, params) {
  const room = wpRooms_().filter(function (r) { return r.campus === String(params.campus || '').toUpperCase() && r.id === String(params.roomId || ''); })[0];
  if (!room || (room.staff !== gameLower_(caller.email) && !wpReviewerOf_(caller, room))) return wpFail_('WP_NO_ROOM');
  const shot = wpState_(wpRows_(), room).shots[String(params.shot || '')];
  if (!shot) return wpFail_('WP_BAD_INPUT');
  return { success: true, base64: Utilities.base64Encode(DriveApp.getFileById(shot.fileId).getBlob().getBytes()) };
}

function wpFolder_(campus) {
  const root = DriveApp.getRootFolder(), sub = function (parent, name) { const it = parent.getFoldersByName(name); return it.hasNext() ? it.next() : parent.createFolder(name); };
  return sub(sub(root, WP_FOLDER), campus);
}

function workplaceSave_(caller, body) {
  const op = String(body.op || ''), me = gameLower_(caller.email);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const rooms = wpRooms_(), rows = wpRows_();
    const room = rooms.filter(function (r) { return r.id === String(body.roomId || '') && (!body.campus || r.campus === String(body.campus).toUpperCase()); })[0];
    if (op === 'decide') {
      if (!room || !wpReviewerOf_(caller, room)) return wpFail_('WP_NO_RIGHT');
      const st = wpState_(rows, room);
      if (st.status !== 'pending') return wpFail_('WP_NOT_WAITING');
      const ok = body.decision === 'approve', note = String(body.note || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (!ok && body.decision !== 'redo') return wpFail_('WP_BAD_INPUT');
      if (!ok && !note) return wpFail_('WP_NOTE');
      const sh = wpSheet_(), now = new Date();
      Object.keys(st.shots).forEach(function (k) { sh.getRange(st.shots[k].row, 8, 1, 4).setValues([[ok ? 'approved' : 'redo', me, now, ok ? '' : note.replace(/^[=+\-@]+/, '')]]); });
      return { success: true, status: ok ? 'approved' : 'redo' };
    }
    if (!room || room.staff !== me) return wpFail_('WP_NO_ROOM');
    const st = wpState_(rows, room);
    if (st.status === 'approved') return wpFail_('WP_DONE');
    if (st.status === 'pending') return wpFail_('WP_WAITING');
    if (op === 'photo') {
      const shot = String(body.shot || ''), b64 = String(body.base64 || '');
      if (!WP_SHOTS.some(function (s) { return s.id === shot; }) || !b64 || b64.length > WP_MAX_B64 || !/^[A-Za-z0-9+/=]+$/.test(b64)) return wpFail_('WP_BAD_INPUT');
      const bytes = Utilities.base64Decode(b64);
      if ((bytes[0] & 0xFF) !== 0xFF || (bytes[1] & 0xFF) !== 0xD8) return wpFail_('WP_BAD_INPUT'); // JPEG only
      const file = wpFolder_(room.campus).createFile(Utilities.newBlob(bytes, 'image/jpeg', room.id + '-' + shot + '-' + Date.now() + '.jpg'));
      const sh = wpSheet_(), now = new Date(), old = st.shots[shot];
      const line = [room.campus, room.id, room.name, room.staff, shot, file.getId(), now, 'draft', '', '', st.status === 'redo' ? st.note : ''];
      Object.keys(st.shots).forEach(function (k) { if (k !== shot) sh.getRange(st.shots[k].row, 8).setValue('draft'); }); // after a redo the whole set is a draft again (the note stays)
      if (old) {
        sh.getRange(old.row, 1, 1, WP_HEADER.length).setValues([line]);
        try { DriveApp.getFileById(old.fileId).setTrashed(true); } catch (e) { /* already gone */ }
      } else sh.appendRow(line);
      return { success: true };
    }
    if (op === 'submit') {
      if (body.noPeople !== true) return wpFail_('WP_TICK');
      if (!WP_SHOTS.every(function (s) { return st.shots[s.id]; })) return wpFail_('WP_MISSING');
      const sh = wpSheet_();
      Object.keys(st.shots).forEach(function (k) { sh.getRange(st.shots[k].row, 8).setValue('pending'); });
      return { success: true, status: 'pending' };
    }
    return wpFail_('WP_BAD_INPUT');
  } finally {
    lock.releaseLock();
  }
}

// ── quests ───────────────────────────────────────────────────────────
// The person's: one per room, its shots then "send" then "approved". The reviewer's: one while any room waits for them.
function workplaceQuests_(caller) {
  const me = gameLower_(caller.email), rooms = wpRooms_().filter(function (r) { return r.staff === me; });
  if (!rooms.length) return [];
  const rows = wpRows_();
  return rooms.map(function (r) {
    const st = wpState_(rows, r), go = WP_GO + '?room=' + encodeURIComponent(r.id);
    const sent = st.status === 'pending' || st.status === 'approved';
    const steps = WP_SHOTS.map(function (s) { return { id: s.id, title: '📸 ' + s.label, go: go, done: !!st.shots[s.id], locked: false }; }).concat([
      { id: 'send', title: st.status === 'redo' ? 'Take them again: ' + st.note : 'Send them to be checked', go: go, done: sent, locked: false },
      { id: 'checked', title: 'Checked and approved', go: go, done: st.status === 'approved', locked: false }]);
    return { questId: 'workplace:' + r.campus + ':' + r.id, title: '📸 Photograph your workplace: ' + r.name, parallel: false, steps: steps, complete: st.status === 'approved' };
  });
}
function workplaceReviewQuests_(caller) {
  const isOwner = (caller.roles || []).indexOf('Owner') !== -1;
  if (!isOwner && caller.primaryRole !== 'Principal') return [];
  const rows = wpRows_(), allow = isOwner ? wpPrincipals_() : null;
  const waiting = wpRooms_().filter(function (r) { return wpReviewerOf_(caller, r) && (!isOwner || wpIsPrincipalRoom_(r, allow)) && wpState_(rows, r).status === 'pending'; });
  if (!waiting.length) return [];
  return [{ questId: 'workplace-review', title: '📸 Check workplace photos: ' + waiting.length + ' waiting', parallel: true, complete: false,
    steps: waiting.map(function (r) { return { id: r.campus + ':' + r.id, title: r.name + (isOwner ? ' (' + r.campus + ')' : ''), go: WP_GO + '?review=1' + (isOwner ? '&campus=' + r.campus : ''), done: false, locked: false }; }) }];
}

// Run once from the Apps Script editor (Run > authorizeWorkplaceDrive) after the first deploy with this file: the Game backend
// never used Drive before, so the deploying account must allow it once (the Roster's capture uploads failed on 2 Nov for this reason).
function authorizeWorkplaceDrive() { Logger.log(DriveApp.getRootFolder().getName()); wpFolder_('LMS1'); }

GAME_MODULE_ACTIONS.workplaceget = workplaceGet_;
GAME_MODULE_ACTIONS.workplaceimage = workplaceImage_;
['Principal', 'Teacher', 'Staff', 'FeeClerk', 'Accounts'].forEach(function (role) { GAME_MODULE_QUESTS[role] = [].concat(GAME_MODULE_QUESTS[role] || [], workplaceQuests_); });
GAME_MODULE_QUESTS.Principal = [].concat(GAME_MODULE_QUESTS.Principal || [], workplaceReviewQuests_);
GAME_MODULE_QUESTS.Owner = [].concat(GAME_MODULE_QUESTS.Owner || [], workplaceReviewQuests_);
