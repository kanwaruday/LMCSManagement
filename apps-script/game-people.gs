var GAME_MODULE_ACTIONS = GAME_MODULE_ACTIONS || {};
var GAME_MODULE_MISSIONS = GAME_MODULE_MISSIONS || {};
var GAME_MODULE_QUESTS = GAME_MODULE_QUESTS || {};

// ═══════════════════════════════════════════════════════════════════
// LMCS Game Backend -- the Owner's 👥 People room (owner/people.html): the Coordinators on the allowlist ("LMCS Principal Allowlist",
// first sheet: email, name, campus, roles, canDecide, ... and a Functions column found by its header).
//   peoplelist         GET, Owner only (refused before anything is read): every Coordinator row, the fixed function list.
//   peoplecoordinator  POST only (doPost in game.gs; never in GAME_MODULE_ACTIONS): add a Coordinator, change one's campus and
//                      functions, or remove one. Owner + kingdomCan_(caller, 'allocate'); the same order as the Kingdom's writes:
//                      inputs checked, audit `requested`, the write under the game lock, audit `done`; refusals audited too.
// What a write may touch, and nothing else: the Coordinator role, that row's campus and its functions from PEOPLE_FUNCTIONS (any other
// function already in the cell is kept). It never edits or removes a row holding Owner, never grants Owner, and leaves a row that holds
// any other role (Principal, Accounts, ...) to the sheet. One row per email (two rows for one email: refused). A new row is plain text.
// ponytail: other backends cache the allowlist (game 5 min, roster 10 min), so a change reaches sign-in within ~10 minutes.
// Logs carry codes, never people. Only this file's own functions are used at top level (load order).
// ═══════════════════════════════════════════════════════════════════

var PEOPLE_FUNCTIONS = ['Fees & Accounts', 'Transport', 'Academics', 'HR', 'Events', 'Systems'];
var PEOPLE_CAMPUSES = ['ALL', 'LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6'];
var PEOPLE_EMAIL = /^[a-z0-9._%+\-]{1,64}@[a-z0-9\-]{1,63}(\.[a-z0-9\-]{1,63})*\.[a-z]{2,24}$/;
var PEOPLE_NOT_YOURS = { success: false, code: 'PEOPLE_NOT_YOURS', error: 'The People room is for the Owner.' };
var PEOPLE_CODES = { PEOPLE_BAD_EMAIL: 'That email does not look right.', PEOPLE_BAD_NAME: 'Add their name (letters, up to 80).',
  PEOPLE_OWNER_ROW: "The Owner's own row can't be changed here.", PEOPLE_OTHER_ROLES: 'This person has other roles too. Change them in the allowlist sheet.',
  PEOPLE_NOT_FOUND: 'That person is not a Coordinator.', PEOPLE_NO_FUNCTIONS_COLUMN: 'The allowlist has no Functions column yet, so functions cannot be saved.',
  PEOPLE_DUPLICATE: 'That email is on the allowlist more than once. Fix the sheet first.', PEOPLE_CHANGED: 'The allowlist changed just now. Nothing was removed; please try again.', PEOPLE_ERROR: 'Something went wrong. Nothing was changed.' };

function peopleFail_(code) { return { success: false, code: code, error: PEOPLE_CODES[code] || KINGDOM_CODES[code] || PEOPLE_CODES.PEOPLE_ERROR }; }
function peopleRoles_(cell) { return String(cell || '').split(',').map(function (r) { return r.trim(); }).filter(Boolean); }
function peopleSheet_() { return SpreadsheetApp.openById(GAME_ALLOWLIST_SHEET_ID).getSheets()[0]; }
function peopleFnAt_(header) { return (header || []).map(function (h) { return String(h || '').trim().toLowerCase(); }).indexOf('functions'); }
function peopleOut_(header, r) {
  const roles = peopleRoles_(r[3]);
  return { email: gameLower_(r[0]), name: String(r[1] || '').trim(), campus: String(r[2] || '').trim().toUpperCase(), functions: gameFunctionsOf_(header, r),
    editable: roles.length === 1 }; // only a Coordinator-only row can be changed here
}

function peopleList_(caller, params) {
  if (!caller || (caller.roles || []).indexOf('Owner') === -1) return PEOPLE_NOT_YOURS; // before anything is read
  try {
    const v = peopleSheet_().getDataRange().getValues(), header = v[0] || [];
    const list = v.slice(1).filter(function (r) { return gameLower_(r[0]) && peopleRoles_(r[3]).indexOf('Coordinator') !== -1; }).map(function (r) { return peopleOut_(header, r); });
    return { success: true, coordinators: list, functions: PEOPLE_FUNCTIONS.slice(), campuses: PEOPLE_CAMPUSES.slice(), hasFunctions: peopleFnAt_(header) !== -1,
      canEdit: kingdomCan_(caller, 'allocate', cqLoadCfg_()) };
  } catch (err) {
    console.error('peoplelist: ' + (err && err.message));
    return peopleFail_('PEOPLE_ERROR');
  }
}

// POST {email, name?, campus: 'ALL'|'LMS1'..'LMS6', functions: [...PEOPLE_FUNCTIONS], remove?: true} -> {success, coordinator | removed}
function peopleCoordinator_(caller, body) {
  try {
    // the rights refusals are audited too, without the target's email (only who asked and what kind of change)
    const noRight = function (why) {
      console.warn('peoplecoordinator refused: ' + why);
      kingdomAuditRefusal_([gameNow_().toISOString(), gameLower_(caller && caller.email), body && body.remove === true ? 'people_coordinator_remove' : 'people_coordinator', 'allowlist', '', '', '', '', '', 'done', 'refused', 'KINGDOM_NO_RIGHT']);
      return peopleFail_('KINGDOM_NO_RIGHT');
    };
    if (!caller || (caller.roles || []).indexOf('Owner') === -1) return noRight('not the Owner');
    const cfg = cqLoadCfg_();
    if (!kingdomCan_(caller, 'allocate', cfg)) return noRight('no allocate right');
    body = body && typeof body === 'object' ? body : {};
    const remove = body.remove === true, by = gameLower_(caller.email), at = gameNow_().toISOString();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const campus = typeof body.campus === 'string' ? body.campus.trim().toUpperCase() : '';
    const fns = Array.isArray(body.functions) ? body.functions : [];
    const row = function (phase, result, code) {
      return [at, by, remove ? 'people_coordinator_remove' : 'people_coordinator', 'allowlist', kingdomCell_(email, 200), kingdomCell_(campus, 10), kingdomCell_(email, 200), '',
        kingdomCell_(remove ? '' : fns.filter(function (f) { return typeof f === 'string'; }).join(', '), 300), phase, result, kingdomCell_(String(code), 200)];
    };
    const refuse = function (code) { kingdomAuditRefusal_(row('done', 'refused', code)); return peopleFail_(code); };
    if (!PEOPLE_EMAIL.test(email) || email.length > 254) return refuse('PEOPLE_BAD_EMAIL');
    if ((body.remove !== undefined && typeof body.remove !== 'boolean') || (body.name !== undefined && typeof body.name !== 'string')) return refuse('KINGDOM_BAD_INPUT');
    if (!remove) {
      if (PEOPLE_CAMPUSES.indexOf(campus) === -1) return refuse('KINGDOM_BAD_INPUT');
      if (body.functions !== undefined && !Array.isArray(body.functions)) return refuse('KINGDOM_BAD_INPUT');
      if (fns.some(function (f) { return PEOPLE_FUNCTIONS.indexOf(f) === -1; })) return refuse('KINGDOM_BAD_INPUT');
      if (name && (name.length > 80 || /[\d<>{}=+@\r\n]/.test(name))) return refuse('PEOPLE_BAD_NAME');
    }
    const chosen = PEOPLE_FUNCTIONS.filter(function (f) { return fns.indexOf(f) !== -1; }); // fixed order, no repeats
    return kingdomLocked_(function () {
      kingdomAudit_(row('requested', '', ''), true);
      const refuseHeld = function (code) { kingdomAudit_(row('done', 'refused', code), true); return peopleFail_(code); };
      const sh = peopleSheet_(), v = sh.getDataRange().getValues(), header = v[0] || [], fAt = peopleFnAt_(header); // read under the lock
      const at_ = [];
      for (let i = 1; i < v.length; i++) if (gameLower_(v[i][0]) === email) at_.push(i);
      if (at_.length > 1) return refuseHeld('PEOPLE_DUPLICATE');
      if (!at_.length) { // a new person
        if (remove) return refuseHeld('PEOPLE_NOT_FOUND');
        if (!name) return refuseHeld('PEOPLE_BAD_NAME');
        if (fAt === -1 && chosen.length) return refuseHeld('PEOPLE_NO_FUNCTIONS_COLUMN');
        const out = []; for (let k = 0; k < Math.max(header.length, 5); k++) out.push('');
        out[0] = email; out[1] = name; out[2] = campus; out[3] = 'Coordinator';
        if (fAt !== -1) out[fAt] = chosen.join(', ');
        gameAppendText_(sh, [out]);
        kingdomAudit_(row('done', 'ok', 'added'), true);
        return { success: true, coordinator: peopleOut_(header, out) };
      }
      const i = at_[0], cur = v[i], roles = peopleRoles_(cur[3]);
      if (roles.indexOf('Owner') !== -1) return refuseHeld('PEOPLE_OWNER_ROW');
      // only a row holding exactly Coordinator is this room's: other roles, or no role at all (other portals read campus alone), stay with the sheet
      if (roles.length !== 1 || roles[0] !== 'Coordinator') return refuseHeld('PEOPLE_OTHER_ROLES');
      if (remove) {
        const now = sh.getRange(i + 1, 1, 1, 4).getValues()[0]; // the row as it is this instant: the roster backend writes the sheet without our lock
        const nowRoles = peopleRoles_(now[3]);
        if (gameLower_(now[0]) !== email || nowRoles.length !== 1 || nowRoles[0] !== 'Coordinator') return refuseHeld('PEOPLE_CHANGED');
        sh.deleteRow(i + 1); // a Coordinator-only row: removing the role leaves nothing, and a role-less row must not linger
        kingdomAudit_(row('done', 'ok', 'removed'), true);
        return { success: true, removed: true };
      }
      const keep = gameFunctionsOf_(header, cur).filter(function (f) { return PEOPLE_FUNCTIONS.indexOf(f) === -1; }); // functions this room doesn't manage stay
      const fnCell = keep.concat(chosen).join(', ');
      if (fAt === -1 && chosen.length) return refuseHeld('PEOPLE_NO_FUNCTIONS_COLUMN');
      const same = String(cur[2] || '').trim().toUpperCase() === campus && (fAt === -1 || String(cur[fAt] || '').split(',').map(function (f) { return f.trim(); }).filter(Boolean).join(', ') === fnCell);
      if (same) { kingdomAudit_(row('done', 'ok', 'unchanged'), true); return { success: true, unchanged: true, coordinator: peopleOut_(header, cur) }; }
      sh.getRange(i + 1, 3, 1, 2).setNumberFormat('@').setValues([[campus, 'Coordinator']]);
      if (fAt !== -1) sh.getRange(i + 1, fAt + 1).setNumberFormat('@').setValue(fnCell);
      const next = cur.slice(); next[2] = campus; next[3] = 'Coordinator'; if (fAt !== -1) next[fAt] = fnCell;
      kingdomAudit_(row('done', 'ok', 'changed'), true);
      return { success: true, coordinator: peopleOut_(header, next) };
    });
  } catch (err) {
    console.error('peoplecoordinator: ' + (err && err.message));
    return peopleFail_('PEOPLE_ERROR');
  }
}

// ── registration (this file's own functions only) ───────────────────
GAME_MODULE_ACTIONS.peoplelist = peopleList_;
