var GAME_MODULE_ACTIONS = GAME_MODULE_ACTIONS || {};
var GAME_MODULE_QUESTS = GAME_MODULE_QUESTS || {};
var QUEST_GATE_HOOKS = QUEST_GATE_HOOKS || {};

// ═══════════════════════════════════════════════════════════════════
// LMCS Game Backend -- 🏛️ "Photograph LMCS HQ and pin it" (Uday, 7 Nov: "now through the principal quests"): the HQ building's outside
// photos (3 required, a 4th optional, no people) and its map pin, for the Art Studio's HQ render, collected through a quest instead of
// asking Uday. One quest at HQ (network scope): the Owner gives it to one person in Kingdom → All quests (family hook:hq-photos, any
// Principal, Coordinator or Accounts person), the existing setup-owner flow. Only that person (and the Owner) can open it.
//   hqphotosget  (GET)  the slots, the pin and the status, for the holder or the Owner.
//   hqphotossave (POST only, from game.gs doPost; never in GAME_MODULE_ACTIONS) op photo | pin | submit.
// Storage: tab `HQ Photos` in the Game workbook (created on first save), one row per slot (the photos and 'pin'). The photos go to a
// private folder "LMCS HQ Photos" in the deploying account's Drive (never shared, never the repo), where the Art Studio picks them up;
// a retake bins the old file. Building only: the page asks for no people, and submit needs that tick.
// Only this file's own functions are used at top level (load order: tests/apps-script/test-load-order.js).
// ═══════════════════════════════════════════════════════════════════

var HQP_FAMILY = 'hook:hq-photos';
var HQP_TAB = 'HQ Photos';
var HQP_HEADER = ['Slot', 'FileId', 'Lat', 'Lng', 'At', 'By', 'Status'];
var HQP_SHOTS = [{ id: 'front', label: 'The front of the building, from across the road', required: true },
  { id: 'gate', label: 'The gate and the entrance', required: true },
  { id: 'side', label: 'One side, so the depth shows', required: true },
  { id: 'wide', label: 'Wide, with the street or the hills (optional)', required: false }];
var HQP_ROLES = ['Principal', 'Coordinator', 'Accounts'];
var HQP_FOLDER = 'LMCS HQ Photos';
var HQP_MAX_B64 = 2800000; // ~2 MB of JPEG; the page sends 1600 px at 0.75, under it
var HQP_GO = 'hq-photos/index.html';
var HQP_CODES = { HQP_NOT_YOURS: 'This quest is with someone else. The Owner gives it out in All quests.', HQP_BAD_INPUT: 'Something in that does not look right. Try again.',
  HQP_BAD_PIN: 'That place is outside the LMS area. Pin LMCS HQ itself.', HQP_DONE: 'These photos and the pin are already sent.',
  HQP_MISSING: 'Take the three required photos and set the pin first.', HQP_TICK: 'Tick the box first: no people in the photos.' };

function hqpFail_(code) { return { success: false, code: code, error: HQP_CODES[code] }; }
function hqpRows_() { const sh = gameBook_().getSheetByName(HQP_TAB); return sh ? sh.getDataRange().getValues() : [HQP_HEADER]; }
function hqpSheet_() {
  const book = gameBook_();
  let sh = book.getSheetByName(HQP_TAB);
  if (!sh) { sh = book.insertSheet(HQP_TAB); sh.appendRow(HQP_HEADER); sh.setFrozenRows(1); }
  return sh;
}
// who may open it: the Owner, or the person (or role group) the Owner gave the HQ row to; with the setup gate off, any of HQP_ROLES
function hqpMay_(caller) {
  const roles = (caller && caller.roles) || [];
  if (roles.indexOf('Owner') !== -1) return true;
  if (!roles.some(function (r) { return HQP_ROLES.indexOf(r) !== -1; }) || caller.viewAs || caller.supportingAt) return false;
  const keep = questGateKeep_(caller, cqLoadCfg_());
  return !keep || keep(HQP_FAMILY, '');
}
// the slots from the rows: {shots: {id: {fileId, row}}, pin: {lat, lng, row} | null, sent: bool}
function hqpState_(rows) {
  const st = { shots: {}, pin: null, sent: false };
  rows.slice(1).forEach(function (r, i) {
    const slot = String(r[0]);
    if (slot === 'pin') st.pin = { lat: Number(r[2]), lng: Number(r[3]), row: i + 2 };
    else if (HQP_SHOTS.some(function (s) { return s.id === slot; })) st.shots[slot] = { fileId: String(r[1]), row: i + 2 };
    if (String(r[6]) === 'sent') st.sent = true;
  });
  return st;
}
function hqpReady_(st) { return !!st.pin && HQP_SHOTS.every(function (s) { return !s.required || st.shots[s.id]; }); }
// the LMS area (the same box as assets/game/places.js accepts): Kullu, Mandi and around
function hqpPinOk_(lat, lng) { return typeof lat === 'number' && typeof lng === 'number' && isFinite(lat) && isFinite(lng) && lat >= 31 && lat <= 33 && lng >= 75.5 && lng <= 78; }

function hqPhotosGet_(caller) {
  if (!hqpMay_(caller)) return hqpFail_('HQP_NOT_YOURS');
  const st = hqpState_(hqpRows_());
  return { success: true, sent: st.sent, ready: hqpReady_(st), pin: st.pin ? { lat: st.pin.lat, lng: st.pin.lng } : null,
    shots: HQP_SHOTS.map(function (s) { return { id: s.id, label: s.label, required: s.required, taken: !!st.shots[s.id] }; }) };
}

function hqpFolder_() {
  const root = DriveApp.getRootFolder(), it = root.getFoldersByName(HQP_FOLDER);
  return it.hasNext() ? it.next() : root.createFolder(HQP_FOLDER);
}

function hqPhotosSave_(caller, body) {
  if (!hqpMay_(caller)) return hqpFail_('HQP_NOT_YOURS');
  body = body && typeof body === 'object' ? body : {};
  const op = String(body.op || ''), me = gameLower_(caller.email);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const st = hqpState_(hqpRows_());
    if (st.sent) return hqpFail_('HQP_DONE');
    if (op === 'photo') {
      const shot = String(body.shot || ''), b64 = String(body.base64 || '');
      if (!HQP_SHOTS.some(function (s) { return s.id === shot; }) || !b64 || b64.length > HQP_MAX_B64 || !/^[A-Za-z0-9+/=]+$/.test(b64)) return hqpFail_('HQP_BAD_INPUT');
      const bytes = Utilities.base64Decode(b64);
      if ((bytes[0] & 0xFF) !== 0xFF || (bytes[1] & 0xFF) !== 0xD8) return hqpFail_('HQP_BAD_INPUT'); // JPEG only
      const file = hqpFolder_().createFile(Utilities.newBlob(bytes, 'image/jpeg', 'hq-' + shot + '-' + Date.now() + '.jpg'));
      const line = [shot, file.getId(), '', '', new Date(), me, 'draft'], old = st.shots[shot], sh = hqpSheet_();
      if (old) {
        sh.getRange(old.row, 1, 1, HQP_HEADER.length).setValues([line]);
        try { DriveApp.getFileById(old.fileId).setTrashed(true); } catch (e) { /* already gone */ }
      } else sh.appendRow(line);
      return { success: true };
    }
    if (op === 'pin') {
      const lat = body.lat, lng = body.lng;
      if (!hqpPinOk_(lat, lng)) return hqpFail_(typeof lat === 'number' && typeof lng === 'number' ? 'HQP_BAD_PIN' : 'HQP_BAD_INPUT');
      const line = ['pin', '', Math.round(lat * 1e7) / 1e7, Math.round(lng * 1e7) / 1e7, new Date(), me, 'draft'], sh = hqpSheet_();
      if (st.pin) sh.getRange(st.pin.row, 1, 1, HQP_HEADER.length).setValues([line]); else sh.appendRow(line);
      return { success: true };
    }
    if (op === 'submit') {
      if (body.noPeople !== true) return hqpFail_('HQP_TICK');
      if (!hqpReady_(st)) return hqpFail_('HQP_MISSING');
      const sh = hqpSheet_();
      Object.keys(st.shots).map(function (k) { return st.shots[k].row; }).concat([st.pin.row]).forEach(function (row) { sh.getRange(row, 7).setValue('sent'); });
      return { success: true, sent: true };
    }
    return hqpFail_('HQP_BAD_INPUT');
  } finally {
    lock.releaseLock();
  }
}

// ── the quest: on the holder's board (the setup gate shows it only to whoever the Owner gave the HQ row) ──
function hqPhotosQuests_(caller) {
  if ((caller.roles || []).indexOf('Owner') !== -1 || !hqpMay_(caller)) return []; // never on the Owner's own board: this asks someone else
  const st = hqpState_(hqpRows_());
  const steps = HQP_SHOTS.filter(function (s) { return s.required; }).map(function (s) { return { id: s.id, title: '📷 ' + s.label, go: HQP_GO, done: !!st.shots[s.id], locked: false }; })
    .concat([{ id: 'pin', title: '📍 Pin LMCS HQ on the map', go: HQP_GO, done: !!st.pin, locked: false },
      { id: 'send', title: 'No people in them: send', go: HQP_GO, done: st.sent, locked: false }]);
  return [{ questId: 'hq-photos', title: '🏛️ Photograph LMCS HQ and pin it', parallel: false, steps: steps, complete: st.sent }];
}

// Run once from the Apps Script editor after the first deploy with this file if the Drive permission isn't granted yet (same as
// authorizeWorkplaceDrive): creates the private folder.
function authorizeHqPhotosDrive() { Logger.log(hqpFolder_().getName()); }

QUEST_GATE_HOOKS.hqPhotosQuests_ = { id: HQP_FAMILY, title: 'Photograph LMCS HQ and pin it', roles: HQP_ROLES.slice(), networkOnly: true, go: HQP_GO };
GAME_MODULE_ACTIONS.hqphotosget = hqPhotosGet_;
HQP_ROLES.forEach(function (role) { GAME_MODULE_QUESTS[role] = [].concat(GAME_MODULE_QUESTS[role] || [], hqPhotosQuests_); });
