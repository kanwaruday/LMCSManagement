var GAME_MODULE_ACTIONS = GAME_MODULE_ACTIONS || {};
var GAME_MODULE_QUESTS = GAME_MODULE_QUESTS || {};

// ═══════════════════════════════════════════════════════════════════
// LMCS Game Backend -- 🏫 Room setup chain, steps 1–2 (V2 row #8, Uday 1 Nov): the Principal names the school's rooms and puts staff
// in them. Steps 3–4 (each person photographs their workplace, the Principal approves) read this through roomsmine / roomsOf_.
//   roomsget    (GET) the school's rooms, the room types, the school's staff (for the picker) and suggested room names not yet used.
//               Principal: their own school. Owner, and a Coordinator who sees every school: ?campus=LMS1..LMS6.
//   roomssave   (POST only, dispatched from game.gs doPost; never in GAME_MODULE_ACTIONS) the whole room list of one school, replaced.
//               Principal (own school) or Owner. Every name, type and person checked; the staff list is the only source of a person.
//   roomsmine   (GET) the caller's own rooms ({ id, name, type }), for the workplace photo chain. Never anyone else's.
// Storage: tab `Game Rooms` in the Game workbook (created on the first save), one row per room, plain text.
// Room types: Game Config key `roomTypes` ([{ id, label, emoji }]) when set, else ROOMS_TYPES_DEFAULT. Read here straight from the
// Config rows, since gameConfigDefaults_ (game.gs) does not carry the key.
// Suggestions: the usual rooms of a school; the ERP's classes and sections join them once game-erp.gs exists (erp-read-contract.md).
// Children's faces rule: nothing here touches students. Staff names reach only that school's Principal, the Owner and Coordinators.
// Only this file's own functions are used at top level (load order: tests/apps-script/test-load-order.js).
// ═══════════════════════════════════════════════════════════════════

var ROOMS_TAB = 'Game Rooms';
var ROOMS_HEADER = ['Campus', 'RoomId', 'Name', 'Type', 'StaffEmail', 'At', 'By'];
var ROOMS_SCHOOLS = ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6'];
var ROOMS_MAX = 150, ROOMS_NAME_MAX = 60;
var ROOMS_GO = 'principal/rooms.html';
// classroom, lab, library, office, staff room: the emoji.js room keys, so the picker matches the school building
var ROOMS_TYPES_DEFAULT = [
  { id: 'classroom', label: 'Classroom', emoji: '✏️' }, { id: 'lab', label: 'Lab', emoji: '🔬' }, { id: 'office', label: 'Office', emoji: '🗄️' },
  { id: 'library', label: 'Library', emoji: '📕' }, { id: 'staffroom', label: 'Staff room', emoji: '☕' }, { id: 'activity', label: 'Activity room', emoji: '🎨' },
  { id: 'pt', label: 'PT room or ground', emoji: '⚽' }, { id: 'records', label: 'Records room', emoji: '🗃️' }, { id: 'accounts', label: 'Accounts room', emoji: '🧾' },
  { id: 'other', label: 'Other', emoji: '🚪' }];
// the usual rooms of a school, offered as one-tap suggestions while unused (names, not people)
var ROOMS_USUAL = [['Office', 'office'], ['Staff room', 'staffroom'], ['Library', 'library'], ['Computer lab', 'lab'], ['Science lab', 'lab'],
  ['Activity room', 'activity'], ['PT room and ground', 'pt'], ['Records room', 'records']];
var ROOMS_CODES = { ROOMS_NO_RIGHT: 'Only the Principal of this school can set up its rooms.', ROOMS_BAD_CAMPUS: 'Choose one school.',
  ROOMS_BAD_INPUT: 'Something in the list does not look right. Nothing was saved.', ROOMS_NO_NAME: 'Every room needs a name.',
  ROOMS_DUP: 'Two rooms have the same name. Give each room its own name.', ROOMS_TOO_MANY: 'That is more rooms than one school can have (150).',
  ROOMS_BAD_STAFF: 'One of the people chosen is not on this school’s staff list. Pick them again.', ROOMS_ERROR: 'Something went wrong. Please try again.' };

function roomsFail_(code) { return { success: false, code: code, error: ROOMS_CODES[code] }; }

// -> the school this caller may act on, or a ROOMS_ code. write: Principal (own school) or Owner; read also a network-wide Coordinator.
function roomsCampus_(caller, asked, write) {
  const roles = (caller && caller.roles) || [], want = String(asked || '').trim().toUpperCase();
  if (caller && caller.primaryRole === 'Principal' && ROOMS_SCHOOLS.indexOf(caller.campusId) !== -1) {
    return !want || want === caller.campusId ? caller.campusId : 'ROOMS_NO_RIGHT';
  }
  const wide = roles.indexOf('Owner') !== -1 || (!write && roles.indexOf('Coordinator') !== -1 && gameVisibleCampuses_(caller) === null);
  if (!wide) return 'ROOMS_NO_RIGHT';
  return ROOMS_SCHOOLS.indexOf(want) !== -1 ? want : 'ROOMS_BAD_CAMPUS';
}

// Game Config `roomTypes` when it is a well-formed list, else the default
function roomsTypes_(cfgRows) {
  const row = (cfgRows || []).filter(function (r) { return String(r[0] || '').trim() === 'roomTypes'; })[0];
  let list = null;
  try { list = row ? JSON.parse(String(row[1])) : null; } catch (err) { list = null; }
  const ok = Array.isArray(list) ? list.filter(function (t) { return t && /^[a-z][\w-]{0,30}$/.test(t.id) && typeof t.label === 'string' && t.label.trim(); }) : [];
  if (!ok.length) return ROOMS_TYPES_DEFAULT;
  const out = ok.map(function (t) { return { id: t.id, label: t.label.trim().slice(0, 40), emoji: String(t.emoji || '').slice(0, 8) }; });
  if (!out.some(function (t) { return t.id === 'other'; })) out.push(ROOMS_TYPES_DEFAULT[ROOMS_TYPES_DEFAULT.length - 1]);
  return out;
}

// the Game Rooms values (header first), or just the header when the tab doesn't exist yet
function roomsRows_(book) {
  const sh = book.getSheetByName(ROOMS_TAB);
  return sh ? sh.getDataRange().getValues() : [ROOMS_HEADER];
}
// one school's rooms from the rows, in sheet order -> [{ id, name, type, staff }]
function roomsOf_(rows, campus) {
  return rows.slice(1).filter(function (r) { return String(r[0]).trim().toUpperCase() === campus && String(r[1]).trim(); }).map(function (r) {
    return { id: String(r[1]).trim(), name: String(r[2]).trim(), type: String(r[3]).trim(), staff: gameLower_(r[4]) };
  });
}

// the school's staff for the picker -> [{ email, name, role }]: the event roster (allowlist + active Employee Master staff, drivers left
// out: a bus is set in Transport), that school only, never the Owner. complete: false when the Employee Master couldn't be read.
function roomsStaff_(campus) {
  const roster = eventRoster_();
  const people = roster.people.filter(function (p) { return p.campusId === campus && p.role !== 'Owner'; }).map(function (p) {
    return { email: p.email, name: p.name || p.email, role: p.role };
  }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  return { people: people, complete: roster.complete };
}

// suggested rooms not yet named (case-insensitive) -> [{ name, type }]
function roomsSuggest_(rooms) {
  const have = {};
  rooms.forEach(function (r) { have[r.name.toLowerCase()] = true; });
  return ROOMS_USUAL.filter(function (u) { return !have[u[0].toLowerCase()]; }).map(function (u) { return { name: u[0], type: u[1] }; });
}

// the two steps' state -> { named, allocated, total, complete }
function roomsProgress_(rooms) {
  const allocated = rooms.filter(function (r) { return !!r.staff; }).length;
  return { named: rooms.length > 0, allocated: allocated, total: rooms.length, complete: rooms.length > 0 && allocated === rooms.length };
}

// ── actions ──────────────────────────────────────────────────────────
// GET roomsget [campus] -> { success, campus, campusName, canEdit, types, rooms: [{ id, name, type, staff, staffName }], staff: [{ email, name, role }],
//   staffComplete, suggest: [{ name, type }], progress }
function roomsGet_(caller, params) {
  const campus = roomsCampus_(caller, params && params.campus, false);
  if (ROOMS_CODES[campus]) return roomsFail_(campus);
  try {
    const book = gameBook_(), rooms = roomsOf_(roomsRows_(book), campus), staff = roomsStaff_(campus);
    const nameOf = {};
    staff.people.forEach(function (p) { nameOf[p.email] = p.name; });
    return { success: true, campus: campus, campusName: gameCampusLabel_(campus), canEdit: !ROOMS_CODES[roomsCampus_(caller, campus, true)],
      types: roomsTypes_(book.getSheetByName('Game Config').getDataRange().getValues()),
      rooms: rooms.map(function (r) { return { id: r.id, name: r.name, type: r.type, staff: r.staff, staffName: r.staff ? nameOf[r.staff] || r.staff : '' }; }),
      staff: staff.people, staffComplete: staff.complete, suggest: roomsSuggest_(rooms), progress: roomsProgress_(rooms) };
  } catch (err) {
    console.error('roomsget: ' + (err && err.message)); // a raw message may carry data, so it is logged, never returned
    return roomsFail_('ROOMS_ERROR');
  }
}

// body.rooms -> { rooms } | { code }: names trimmed and required, unique per school, types known (else 'other'), people from the staff
// list only, ids kept when well formed and unique (else a new r<n>).
function roomsClean_(list, types, staffEmails, existing) {
  if (!Array.isArray(list)) return { code: 'ROOMS_BAD_INPUT' };
  if (list.length > ROOMS_MAX) return { code: 'ROOMS_TOO_MANY' };
  const typeIds = types.map(function (t) { return t.id; }), seenName = {}, seenId = {}, out = [];
  let next = 1;
  existing.concat(list).forEach(function (r) { const m = /^r(\d{1,5})$/.exec(String((r && r.id) || '')); if (m) next = Math.max(next, +m[1] + 1); });
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (!r || typeof r !== 'object' || typeof r.name !== 'string') return { code: r && typeof r === 'object' && !r.name ? 'ROOMS_NO_NAME' : 'ROOMS_BAD_INPUT' };
    const name = gameSafeNote_(r.name.replace(/\s+/g, ' ')).slice(0, ROOMS_NAME_MAX);
    if (!name) return { code: 'ROOMS_NO_NAME' };
    if (seenName[name.toLowerCase()]) return { code: 'ROOMS_DUP' };
    seenName[name.toLowerCase()] = true;
    const staff = gameLower_(typeof r.staff === 'string' ? r.staff : '');
    if (staff && staffEmails.indexOf(staff) === -1) return { code: 'ROOMS_BAD_STAFF' };
    let id = typeof r.id === 'string' && /^r\d{1,5}$/.test(r.id) && !seenId[r.id] ? r.id : 'r' + next++;
    seenId[id] = true;
    out.push({ id: id, name: name, type: typeIds.indexOf(r.type) !== -1 ? r.type : 'other', staff: staff });
  }
  return { rooms: out };
}

// POST roomssave { campus?, rooms: [{ id?, name, type, staff }] } -> roomsget's answer for that school (so the page redraws from the truth)
function roomsSave_(caller, body) {
  body = body && typeof body === 'object' ? body : {};
  const campus = roomsCampus_(caller, body.campus, true);
  if (ROOMS_CODES[campus]) return roomsFail_(campus);
  try {
    const book = gameBook_(), types = roomsTypes_(book.getSheetByName('Game Config').getDataRange().getValues());
    const staff = roomsStaff_(campus).people.map(function (p) { return p.email; });
    const res = gameWithLock_(function () { // read and rewrite under the lock: two saves never interleave
      let sh = book.getSheetByName(ROOMS_TAB);
      if (!sh) { sh = book.insertSheet(ROOMS_TAB); gameAppendText_(sh, [ROOMS_HEADER]); }
      const rows = sh.getDataRange().getValues(), clean = roomsClean_(body.rooms, types, staff, roomsOf_(rows, campus));
      if (clean.code) return clean;
      const at = gameNow_().toISOString(), by = gameLower_(caller.email);
      const keep = rows.slice(1).filter(function (r) { return String(r[0]).trim().toUpperCase() !== campus; });
      const mine = clean.rooms.map(function (r) { return [campus, r.id, r.name, r.type, r.staff, at, by]; });
      // ponytail: the whole tab is rewritten per save (six schools × ≤150 rows); per-school tabs if it ever grows past a few thousand rows
      const all = keep.concat(mine);
      if (rows.length > 1) sh.getRange(2, 1, rows.length - 1, ROOMS_HEADER.length).clearContent();
      if (all.length) sh.getRange(2, 1, all.length, ROOMS_HEADER.length).setNumberFormat('@').setValues(all);
      return { ok: true };
    });
    if (res.code) return roomsFail_(res.code);
    return roomsGet_(caller, { campus: campus });
  } catch (err) {
    console.error('roomssave: ' + (err && err.message));
    return roomsFail_('ROOMS_ERROR');
  }
}

// GET roomsmine -> { success, campus, rooms: [{ id, name, type }] }: the rooms the caller is put in, at their own school
function roomsMine_(caller, params) {
  const campus = String((caller && caller.campusId) || '').toUpperCase();
  if (ROOMS_SCHOOLS.indexOf(campus) === -1) return { success: true, campus: '', rooms: [] };
  try {
    const me = gameLower_(caller.email);
    return { success: true, campus: campus, rooms: roomsOf_(roomsRows_(gameBook_()), campus).filter(function (r) { return r.staff === me; })
      .map(function (r) { return { id: r.id, name: r.name, type: r.type }; }) };
  } catch (err) {
    console.error('roomsmine: ' + (err && err.message));
    return roomsFail_('ROOMS_ERROR');
  }
}

// ── the Principal's quest (under the lock: one small tab read; a throw drops only this quest) ──
function roomsQuests_(caller, cfg, now, opts) {
  const campus = caller && caller.campusId;
  if (ROOMS_SCHOOLS.indexOf(campus) === -1) return [];
  const p = roomsProgress_(roomsOf_(roomsRows_(gameBook_()), campus));
  return [{ questId: 'rooms:' + campus, title: '🏫 Set up your school’s rooms', parallel: false, complete: p.complete, steps: [
    { id: 'name', title: p.named ? 'Name your rooms (' + p.total + ' named)' : 'Name your rooms', go: ROOMS_GO, done: p.named, locked: false },
    { id: 'staff', title: 'Put your staff in their rooms' + (p.total ? ' (' + p.allocated + ' of ' + p.total + ')' : ''), go: ROOMS_GO + '#staff', done: p.complete, locked: !p.named }] }];
}

// ── registration (this file's own functions only) ───────────────────
GAME_MODULE_ACTIONS.roomsget = roomsGet_;
GAME_MODULE_ACTIONS.roomsmine = roomsMine_;
GAME_MODULE_QUESTS.Principal = [].concat(GAME_MODULE_QUESTS.Principal || [], roomsQuests_);
