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
//   peopleprincipal    POST only: change a Principal's campus to one school (never ALL) (any row holding Principal, also with other roles), same rights and order.
//                      It writes the Campus cell of that row only: roles, name and functions stay. Never a row holding Owner.
//   peopleoffice       POST only: change a Fee Clerk's or Accounts person's campus (any row holding FeeClerk or Accounts), same rights,
//                      order and Campus-cell-only write. Uday's answer "A" (7 Nov), the same rule as auth.js onlyFeeClerk: a row whose
//                      only role is FeeClerk may be LMS1-6 or ALL; Accounts and any mixed row get one school only (ALL refused).
//   peoplesupport      POST only: a Principal's supporting charge (Uday, 7 Nov: "can see everything and advise while approvals stay with the
//                      School's Principal"). Writes the allowlist column headed "Supporting" (added at the end of the header row, under the
//                      lock, when missing): a comma list of LMS1-6, never ALL, never their own school; [] clears it. Only a row holding
//                      Principal with no Owner or Coordinator role and its own school LMS1-6 (supporting-charge.gs supportEligible_). Same
//                      rights and order as peopleprincipal. What a supporting Principal may do there is decided by each backend (supportActAs_).
//   peopleowner        POST only: grant or take away the Owner role (Uday, 10 Nov: "there is no owner tag/ option, add that"). Only the accounts in
//                      PEOPLE_OWNER_ADMINS may call it (other Owners see the Owners read-only); same rights and order as peoplecoordinator. Adds a row
//                      for a new email; else adds Owner to, or takes it out of, the Roles cell and keeps the other roles. Never your own Owner row,
//                      never the last Owner. A row left with no role at all is deleted (a role-less row must not linger, as a Coordinator remove).
// What peoplecoordinator may touch, and nothing else: the Coordinator role, that row's campus and its functions from PEOPLE_FUNCTIONS (any other
// function already in the cell is kept). It never edits or removes a row holding Owner, never grants Owner, and leaves a row that holds
// any other role (Principal, Accounts, ...) to the sheet. One row per email (two rows for one email: refused). A new row is plain text.
// Sign-in (principal-allowlist.gs) notices a sheet change within ~30 s; this backend caches a caller 5 min (gameVerifyCaller_), so a role
// change reaches the game layer within 5 minutes. ponytail: a removed Owner keeps game-backend Owner rights until that cache ends.
// Logs carry codes, never people. Only this file's own functions are used at top level (load order).
// ═══════════════════════════════════════════════════════════════════

var PEOPLE_FUNCTIONS = ['Fees & Accounts', 'Transport', 'Academics', 'HR', 'Events', 'Systems'];
var PEOPLE_CAMPUSES = ['ALL', 'LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6'];
var PEOPLE_EMAIL = /^[a-z0-9][a-z0-9._%+\-]{0,63}@[a-z0-9\-]{1,63}(\.[a-z0-9\-]{1,63})*\.[a-z]{2,24}$/;
// SECURITY SETTING: who may grant or take away the Owner role (peopleowner). Owner is every right in every portal, so this is a code change
// reviewed like one, never a sheet or Game Config value. Other Owners get the Owners list read-only.
var PEOPLE_OWNER_ADMINS = ['uday.kanwar@lms.org.in'];
var PEOPLE_NOT_YOURS = { success: false, code: 'PEOPLE_NOT_YOURS', error: 'The People room is for the Owner.' };
var PEOPLE_CODES = { PEOPLE_BAD_EMAIL: 'That email does not look right.', PEOPLE_BAD_NAME: 'Add their name (letters, up to 80).',
  PEOPLE_OWNER_ROW: "The Owner's own row can't be changed here.", PEOPLE_OTHER_ROLES: 'This person has other roles too. Change them in the allowlist sheet.',
  PEOPLE_NOT_FOUND: 'That person is not a Coordinator.', PEOPLE_NOT_PRINCIPAL: 'That person is not a Principal.', PEOPLE_NOT_OFFICE: 'That person is not a Fee Clerk or Accounts.',
  PEOPLE_CANT_SUPPORT: 'Only a Principal at one school (not an Owner or Coordinator) can support another school.', PEOPLE_OWN_SCHOOL: "A Principal can't support their own school.",
  PEOPLE_ONE_SCHOOL: 'Only a plain Fee Clerk can cover all schools. Choose one school.', PEOPLE_NO_FUNCTIONS_COLUMN: 'The allowlist has no Functions column yet, so functions cannot be saved.',
  PEOPLE_NOT_OWNER: 'That person is not an Owner.', PEOPLE_SELF_OWNER: "You can't remove your own Owner role.", PEOPLE_LAST_OWNER: "That is the last Owner. Add another Owner first.",
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
    const principals = v.slice(1).filter(function (r) { return gameLower_(r[0]) && peopleRoles_(r[3]).indexOf('Principal') !== -1; }).map(function (r) {
      const roles = peopleRoles_(r[3]);
      const campus = String(r[2] || '').trim().toUpperCase();
      return { email: gameLower_(r[0]), name: String(r[1] || '').trim(), campus: campus, roles: roles, editable: roles.indexOf('Owner') === -1,
        supporting: supportSchools_(header, r), canSupport: supportEligible_(roles, campus) };
    });
    const office = v.slice(1).filter(function (r) { return gameLower_(r[0]) && peopleOfficeHolds_(peopleRoles_(r[3])); }).map(function (r) {
      const roles = peopleRoles_(r[3]);
      return { email: gameLower_(r[0]), name: String(r[1] || '').trim(), campus: String(r[2] || '').trim().toUpperCase(), roles: roles, editable: roles.indexOf('Owner') === -1, mayAll: peopleOnlyFeeClerk_(roles) };
    });
    const owners = v.slice(1).filter(function (r) { return gameLower_(r[0]) && peopleRoles_(r[3]).indexOf('Owner') !== -1; }).map(function (r) {
      return { email: gameLower_(r[0]), name: String(r[1] || '').trim(), campus: String(r[2] || '').trim().toUpperCase(), roles: peopleRoles_(r[3]) };
    });
    return { success: true, coordinators: list, principals: principals, office: office, owners: owners, canEditOwners: peopleOwnerAdmin_(caller), functions: PEOPLE_FUNCTIONS.slice(), campuses: PEOPLE_CAMPUSES.slice(), hasFunctions: peopleFnAt_(header) !== -1,
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
      // the row as it is this instant, before any write (remove or change): the roster backend and hand edits touch the sheet without our lock
      const now = sh.getRange(i + 1, 1, 1, 4).getValues()[0], nowRoles = peopleRoles_(now[3]);
      if (gameLower_(now[0]) !== email || nowRoles.length !== 1 || nowRoles[0] !== 'Coordinator') return refuseHeld('PEOPLE_CHANGED');
      if (remove) {
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

function peopleOwnerAdmin_(caller) { return !!caller && !caller.viewAs && (caller.roles || []).indexOf('Owner') !== -1 && PEOPLE_OWNER_ADMINS.indexOf(gameLower_(caller.email)) !== -1; }

// POST {email, name? (a new row only), remove?: true} -> {success, owner: {email, name, campus, roles} | removed, unchanged?}
function peopleOwner_(caller, body) {
  try {
    const noRight = function (why) {
      console.warn('people_owner refused: ' + why);
      kingdomAuditRefusal_([gameNow_().toISOString(), gameLower_(caller && caller.email), body && body.remove === true ? 'people_owner_remove' : 'people_owner', 'allowlist', '', '', '', '', '', 'done', 'refused', 'KINGDOM_NO_RIGHT']);
      return peopleFail_('KINGDOM_NO_RIGHT');
    };
    if (!caller || (caller.roles || []).indexOf('Owner') === -1) return noRight('not the Owner');
    if (!peopleOwnerAdmin_(caller)) return noRight('not an Owner admin');
    if (!kingdomCan_(caller, 'allocate', cqLoadCfg_())) return noRight('no allocate right');
    body = body && typeof body === 'object' ? body : {};
    const remove = body.remove === true, by = gameLower_(caller.email), at = gameNow_().toISOString();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const row = function (phase, result, code) {
      return [at, by, remove ? 'people_owner_remove' : 'people_owner', 'allowlist', kingdomCell_(email, 200), '', kingdomCell_(email, 200), '', '', phase, result, kingdomCell_(String(code), 200)];
    };
    const refuse = function (code) { kingdomAuditRefusal_(row('done', 'refused', code)); return peopleFail_(code); };
    if (!PEOPLE_EMAIL.test(email) || email.length > 254) return refuse('PEOPLE_BAD_EMAIL');
    if ((body.remove !== undefined && typeof body.remove !== 'boolean') || (body.name !== undefined && typeof body.name !== 'string')) return refuse('KINGDOM_BAD_INPUT');
    if (!remove && name && (name.length > 80 || /[\d<>{}=+@\r\n]/.test(name))) return refuse('PEOPLE_BAD_NAME');
    if (remove && email === by) return refuse('PEOPLE_SELF_OWNER');
    return kingdomLocked_(function () {
      kingdomAudit_(row('requested', '', ''), true);
      const refuseHeld = function (code) { kingdomAudit_(row('done', 'refused', code), true); return peopleFail_(code); };
      const sh = peopleSheet_(), v = sh.getDataRange().getValues(), header = v[0] || [], at_ = []; // read under the lock
      for (let i = 1; i < v.length; i++) if (gameLower_(v[i][0]) === email) at_.push(i);
      if (at_.length > 1) return refuseHeld('PEOPLE_DUPLICATE');
      if (!at_.length) { // a new person: an Owner covers every school
        if (remove) return refuseHeld('PEOPLE_NOT_OWNER');
        if (!name) return refuseHeld('PEOPLE_BAD_NAME');
        const out = []; for (let k = 0; k < Math.max(header.length, 5); k++) out.push('');
        out[0] = email; out[1] = name; out[2] = 'ALL'; out[3] = 'Owner';
        gameAppendText_(sh, [out]);
        kingdomAudit_(row('done', 'ok', 'added'), true);
        return { success: true, owner: { email: email, name: name, campus: 'ALL', roles: ['Owner'] } };
      }
      const i = at_[0], roles = peopleRoles_(v[i][3]), has = roles.indexOf('Owner') !== -1;
      const out = { email: email, name: String(v[i][1] || '').trim(), campus: String(v[i][2] || '').trim().toUpperCase(), roles: roles };
      if (!remove && has) { kingdomAudit_(row('done', 'ok', 'unchanged'), true); return { success: true, unchanged: true, owner: out }; }
      if (remove && !has) return refuseHeld('PEOPLE_NOT_OWNER');
      if (remove) { // the last Owner stays: count the Owner rows (one per email) as they are under the lock
        const owners = v.slice(1).filter(function (r) { return gameLower_(r[0]) && peopleRoles_(r[3]).indexOf('Owner') !== -1; }).length;
        if (owners <= 1) return refuseHeld('PEOPLE_LAST_OWNER');
      }
      // the row as it is this instant, before any write (the roster backend and hand edits touch the sheet without our lock)
      const now = sh.getRange(i + 1, 1, 1, 4).getValues()[0];
      if (gameLower_(now[0]) !== email || String(now[3]) !== String(v[i][3])) return refuseHeld('PEOPLE_CHANGED');
      const next = remove ? roles.filter(function (r) { return r !== 'Owner'; }) : roles.concat(['Owner']);
      if (!next.length) { sh.deleteRow(i + 1); kingdomAudit_(row('done', 'ok', 'removed'), true); return { success: true, removed: true }; }
      sh.getRange(i + 1, 4).setNumberFormat('@').setValue(next.join(', '));
      kingdomAudit_(row('done', 'ok', remove ? 'removed' : 'granted'), true);
      out.roles = next;
      return remove ? { success: true, removed: true, owner: out } : { success: true, owner: out };
    });
  } catch (err) {
    console.error('people_owner: ' + (err && err.message));
    return peopleFail_('PEOPLE_ERROR');
  }
}

// POST {email, campus: 'LMS1'..'LMS6'} -> {success, principal: {email, name, campus, roles, editable} , unchanged?}
// the rows each campus write may change, and when ALL is allowed (decided under the lock, from the row's roles as they are then)
var PEOPLE_CAMPUS_KINDS = {
  principal: { audit: 'people_principal', out: 'principal', holds: function (roles) { return roles.indexOf('Principal') !== -1; }, notCode: 'PEOPLE_NOT_PRINCIPAL',
    mayAll: function () { return false; } }, // ALL would make a Principal network-wide (auth.js: every school's staff, the Coordinator portal). That stays a sheet edit.
  office: { audit: 'people_office', out: 'person', holds: function (roles) { return peopleOfficeHolds_(roles); }, notCode: 'PEOPLE_NOT_OFFICE',
    mayAll: function (roles) { return peopleOnlyFeeClerk_(roles); } } // ALL widens a plain Fee Clerk's campus only (auth.js onlyFeeClerk)
};
function peopleOfficeHolds_(roles) { return roles.indexOf('FeeClerk') !== -1 || roles.indexOf('Accounts') !== -1; }
function peopleOnlyFeeClerk_(roles) { return roles.length > 0 && roles.every(function (r) { return r === 'FeeClerk'; }); }
function peoplePrincipal_(caller, body) { return peopleSetCampus_(caller, body, PEOPLE_CAMPUS_KINDS.principal); }
function peopleOffice_(caller, body) { return peopleSetCampus_(caller, body, PEOPLE_CAMPUS_KINDS.office); }

// POST {email, campus} -> {success, principal | person, unchanged?}: the Campus cell of one row, nothing else
function peopleSetCampus_(caller, body, kind) {
  try {
    const noRight = function (why) {
      console.warn(kind.audit + ' refused: ' + why);
      kingdomAuditRefusal_([gameNow_().toISOString(), gameLower_(caller && caller.email), kind.audit, 'allowlist', '', '', '', '', '', 'done', 'refused', 'KINGDOM_NO_RIGHT']);
      return peopleFail_('KINGDOM_NO_RIGHT');
    };
    if (!caller || (caller.roles || []).indexOf('Owner') === -1) return noRight('not the Owner');
    if (!kingdomCan_(caller, 'allocate', cqLoadCfg_())) return noRight('no allocate right');
    body = body && typeof body === 'object' ? body : {};
    const by = gameLower_(caller.email), at = gameNow_().toISOString();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const campus = typeof body.campus === 'string' ? body.campus.trim().toUpperCase() : '';
    const row = function (phase, result, code) {
      return [at, by, kind.audit, 'allowlist', kingdomCell_(email, 200), kingdomCell_(campus, 10), kingdomCell_(email, 200), '', '', phase, result, kingdomCell_(String(code), 200)];
    };
    const refuse = function (code) { kingdomAuditRefusal_(row('done', 'refused', code)); return peopleFail_(code); };
    if (!PEOPLE_EMAIL.test(email) || email.length > 254) return refuse('PEOPLE_BAD_EMAIL');
    if (PEOPLE_CAMPUSES.indexOf(campus) === -1 || (campus === 'ALL' && kind === PEOPLE_CAMPUS_KINDS.principal)) return refuse('KINGDOM_BAD_INPUT');
    return kingdomLocked_(function () {
      kingdomAudit_(row('requested', '', ''), true);
      const refuseHeld = function (code) { kingdomAudit_(row('done', 'refused', code), true); return peopleFail_(code); };
      const sh = peopleSheet_(), v = sh.getDataRange().getValues(), at_ = []; // read under the lock
      for (let i = 1; i < v.length; i++) if (gameLower_(v[i][0]) === email) at_.push(i);
      if (at_.length > 1) return refuseHeld('PEOPLE_DUPLICATE');
      if (!at_.length) return refuseHeld('PEOPLE_NOT_PRINCIPAL');
      const i = at_[0], roles = peopleRoles_(v[i][3]);
      if (roles.indexOf('Owner') !== -1) return refuseHeld('PEOPLE_OWNER_ROW');
      if (!kind.holds(roles)) return refuseHeld(kind.notCode);
      // the row as it is this instant (the roster backend and hand edits touch the sheet without our lock)
      const now = sh.getRange(i + 1, 1, 1, 4).getValues()[0];
      if (gameLower_(now[0]) !== email || String(now[3]) !== String(v[i][3])) return refuseHeld('PEOPLE_CHANGED');
      if (campus === 'ALL' && !kind.mayAll(roles)) return refuseHeld(kind === PEOPLE_CAMPUS_KINDS.principal ? 'KINGDOM_BAD_INPUT' : 'PEOPLE_ONE_SCHOOL'); // the roles just re-read
      const out = { email: email, name: String(now[1] || '').trim(), campus: campus, roles: roles, editable: true };
      if (kind === PEOPLE_CAMPUS_KINDS.office) out.mayAll = kind.mayAll(roles);
      const res = function (extra) { const o = { success: true }; o[kind.out] = out; return Object.assign(o, extra || {}); };
      if (String(now[2] || '').trim().toUpperCase() === campus) { kingdomAudit_(row('done', 'ok', 'unchanged'), true); return res({ unchanged: true }); }
      sh.getRange(i + 1, 3).setNumberFormat('@').setValue(campus);
      kingdomAudit_(row('done', 'ok', 'changed'), true);
      return res();
    });
  } catch (err) {
    console.error(kind.audit + ': ' + (err && err.message));
    return peopleFail_('PEOPLE_ERROR');
  }
}

// POST {email, schools: ['LMS1'..'LMS6'] (may be [])} -> {success, principal: {email, name, campus, supporting}, unchanged?}
function peopleSupport_(caller, body) {
  try {
    const noRight = function (why) {
      console.warn('people_support refused: ' + why);
      kingdomAuditRefusal_([gameNow_().toISOString(), gameLower_(caller && caller.email), 'people_support', 'allowlist', '', '', '', '', '', 'done', 'refused', 'KINGDOM_NO_RIGHT']);
      return peopleFail_('KINGDOM_NO_RIGHT');
    };
    if (!caller || (caller.roles || []).indexOf('Owner') === -1) return noRight('not the Owner');
    if (!kingdomCan_(caller, 'allocate', cqLoadCfg_())) return noRight('no allocate right');
    body = body && typeof body === 'object' ? body : {};
    const by = gameLower_(caller.email), at = gameNow_().toISOString();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const said = Array.isArray(body.schools) && body.schools.length <= SUPPORT_SCHOOLS.length && body.schools.every(function (c) { return typeof c === 'string'; })
      ? body.schools.map(function (c) { return c.trim().toUpperCase(); }) : null;
    const want = said ? SUPPORT_SCHOOLS.filter(function (c) { return said.indexOf(c) !== -1; }) : []; // LMS1-6 order, no repeats
    const row = function (phase, result, code) {
      return [at, by, 'people_support', 'allowlist', kingdomCell_(email, 200), kingdomCell_(want.join(','), 40), kingdomCell_(email, 200), '', '', phase, result, kingdomCell_(String(code), 200)];
    };
    const refuse = function (code) { kingdomAuditRefusal_(row('done', 'refused', code)); return peopleFail_(code); };
    if (!PEOPLE_EMAIL.test(email) || email.length > 254) return refuse('PEOPLE_BAD_EMAIL');
    if (!said || said.some(function (c) { return SUPPORT_SCHOOLS.indexOf(c) === -1; })) return refuse('KINGDOM_BAD_INPUT'); // ALL or anything else: never
    return kingdomLocked_(function () {
      kingdomAudit_(row('requested', '', ''), true);
      const refuseHeld = function (code) { kingdomAudit_(row('done', 'refused', code), true); return peopleFail_(code); };
      const sh = peopleSheet_(), v = sh.getDataRange().getValues(), header = v[0] || [], at_ = []; // read under the lock
      for (let i = 1; i < v.length; i++) if (gameLower_(v[i][0]) === email) at_.push(i);
      if (at_.length > 1) return refuseHeld('PEOPLE_DUPLICATE');
      if (!at_.length) return refuseHeld('PEOPLE_NOT_PRINCIPAL');
      const i = at_[0], roles = peopleRoles_(v[i][3]), campus = String(v[i][2] || '').trim().toUpperCase();
      if (roles.indexOf('Owner') !== -1) return refuseHeld('PEOPLE_OWNER_ROW');
      if (roles.indexOf('Principal') === -1) return refuseHeld('PEOPLE_NOT_PRINCIPAL');
      if (!supportEligible_(roles, campus)) return refuseHeld('PEOPLE_CANT_SUPPORT');
      if (want.indexOf(campus) !== -1) return refuseHeld('PEOPLE_OWN_SCHOOL');
      const now = sh.getRange(i + 1, 1, 1, 4).getValues()[0]; // the row as it is this instant (hand edits don't take our lock)
      if (gameLower_(now[0]) !== email || String(now[3]) !== String(v[i][3]) || String(now[2]) !== String(v[i][2])) return refuseHeld('PEOPLE_CHANGED');
      let col = supportColumn_(header);
      const out = { email: email, name: String(now[1] || '').trim(), campus: campus, supporting: want };
      if (col !== -1 && String(v[i][col] || '').trim() === want.join(', ')) {
        kingdomAudit_(row('done', 'ok', 'unchanged'), true); return { success: true, unchanged: true, principal: out };
      }
      if (col === -1) { col = header.length; sh.getRange(1, col + 1).setNumberFormat('@').setValue('Supporting'); } // the column, once
      sh.getRange(i + 1, col + 1).setNumberFormat('@').setValue(want.join(', '));
      kingdomAudit_(row('done', 'ok', 'changed'), true);
      return { success: true, principal: out };
    });
  } catch (err) {
    console.error('people_support: ' + (err && err.message));
    return peopleFail_('PEOPLE_ERROR');
  }
}

// GET only (one doGet line in game.gs): actAs=<school> from a Principal who supports it -> a read-only copy at that school
// (supporting-charge.gs); anything else (not on their Supporting cell, ALL, not a string, a failed read) -> the caller at home.
// POSTs never come through here, so a game write at a supported school is checked against the Principal's own school and fails.
// The Supporting cell is read from the allowlist by header, cached 5 minutes per person like the caller itself.
function gameActAs_(caller, actAs) {
  if (!caller || typeof actAs !== 'string' || !actAs) return caller;
  try {
    const cache = CacheService.getScriptCache(), key = 'gamesupport_' + String(caller.email || '').slice(0, 200);
    let sup = cache.get(key);
    if (sup) sup = JSON.parse(sup);
    else {
      const v = peopleSheet_().getDataRange().getValues(), row = v.slice(1).filter(function (r) { return gameLower_(r[0]) === gameLower_(caller.email); })[0];
      sup = row ? supportSchools_(v[0], row) : [];
      cache.put(key, JSON.stringify(sup), 300);
    }
    return supportActAs_(Object.assign({}, caller, { supporting: sup }), actAs) || caller;
  } catch (err) {
    console.error('gameActAs_: ' + (err && err.message));
    return caller;
  }
}

// The game GETs a switched (supporting) Principal may run: view-as's reads plus the reads the Principal pages make. Every one is read-only
// (scout only caches a per-school summary); anything else, setupsave, gamedecide, gametourseen, teacherplanactivity included, is refused.
var GAME_SUPPORT_EXTRA_READS = ['gametownhall', 'roomsget', 'gamescout', 'classroomget', 'erpread', 'workplaceget', 'workplaceimage'];
function gameSupportRead_(action) { return GAME_VIEW_AS_ACTIONS.indexOf(action) !== -1 || GAME_SUPPORT_EXTRA_READS.indexOf(action) !== -1; }

// ── registration (this file's own functions only) ───────────────────
GAME_MODULE_ACTIONS.peoplelist = peopleList_;
