// ═══════════════════════════════════════════════════════════════════
// LMCS Game Backend -- kingdomsethead (POST only, dispatched from game.gs; never in GAME_MODULE_ACTIONS, so a GET is unknown).
// The Owner makes an allowlist Coordinator an alliance head from the Kingdom's follow-up sheet: one entry appended to Game Config
// `kingdom.heads`, server side (heads' emails live only in the Game Config sheet, never in the repo). Owner + the allocate right first,
// then the email must be a Coordinator on the allowlist, then under the lock: an audit row `requested`, the config write, an audit row
// `done` (Game Allocations, as kingdomassign). Already a head = unchanged. Uses game-kingdom.gs helpers at call time only (load order).
// ═══════════════════════════════════════════════════════════════════

var KINGDOM_HEAD_FUNCTIONS = ['finance', 'transport', 'academics', 'hr', 'events', 'systems', 'all'];

// a head id from the email's local part, unique among ids already in heads
function kingdomHeadId_(email, heads) {
  const base = ('h-' + email.split('@')[0].replace(/[^a-z0-9]+/g, '-')).slice(0, 24).replace(/-+$/, '');
  const taken = heads.map(function (x) { return x && x.id; });
  let id = base, n = 2;
  while (taken.indexOf(id) !== -1) id = base + '-' + n++;
  return id;
}

// POST {email, functions?: [KINGDOM_HEAD_FUNCTIONS]} -> {success, head: {id, name, email, functions}, unchanged?}
function kingdomSetHead_(caller, body) {
  try {
    const ok = kingdomAssignRights_(caller, 'kingdomsethead');
    if (ok.fail) return ok.fail;
    body = body && typeof body === 'object' ? body : {};
    const email = typeof body.email === 'string' ? gameLower_(body.email) : '', fns = body.functions === undefined ? [] : body.functions;
    const by = gameLower_(caller.email), at = gameNow_().toISOString();
    const row = function (phase, result, code) { return [at, by, 'kingdom_head_add', 'config', 'kingdom.heads', '', kingdomCell_(email, 200), '', '', phase, result, kingdomCell_(String(code), 200)]; };
    if (!KINGDOM_EMAIL.test(email) || !Array.isArray(fns) || fns.length > KINGDOM_HEAD_FUNCTIONS.length || !fns.every(function (f) { return KINGDOM_HEAD_FUNCTIONS.indexOf(f) !== -1; })) {
      kingdomAuditRefusal_(row('done', 'refused', 'KINGDOM_BAD_INPUT')); return kingdomFail_('KINGDOM_BAD_INPUT');
    }
    const r = kingdomAllowRows_().filter(function (x) { return gameLower_(x[0]) === email; })[0];
    if (!r || String(r[3] || '').split(',').map(function (x) { return x.trim(); }).indexOf('Coordinator') === -1) {
      kingdomAuditRefusal_(row('done', 'refused', 'KINGDOM_NOT_ELIGIBLE')); return kingdomFail_('KINGDOM_NOT_ELIGIBLE');
    }
    const name = String(r[1] || '').trim();
    return kingdomLocked_(function () {
      kingdomAudit_(row('requested', '', ''), true);
      const sh = gameBook_().getSheetByName('Game Config'), rows = sh.getDataRange().getValues(); // read under the lock: a double tap is unchanged
      let at0 = 0, obj = {};
      for (let i = 1; i < rows.length; i++) if (String(rows[i][0]).trim() === 'kingdom') { at0 = i + 1; break; }
      if (at0) {
        try { obj = JSON.parse(String(rows[at0 - 1][1] || '{}')); } catch (err) { obj = null; }
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { kingdomAudit_(row('done', 'refused', 'KINGDOM_ERROR'), true); return kingdomFail_('KINGDOM_ERROR'); } // never overwrite a cell we can't read
      }
      const heads = Array.isArray(obj.heads) ? obj.heads : [];
      const had = heads.filter(function (x) { return x && gameLower_(x.email) === email; })[0];
      if (had) {
        kingdomAudit_(row('done', 'ok', 'unchanged'), true);
        return { success: true, unchanged: true, head: { id: had.id, name: had.name, email: email, functions: had.functions } };
      }
      const head = { id: kingdomHeadId_(email, heads), name: name, email: email, functions: fns.slice() };
      obj.heads = heads.concat([head]);
      const text = JSON.stringify(obj);
      if (at0) sh.getRange(at0, 2).setNumberFormat('@').setValue(text);
      else gameAppendText_(sh, [['kingdom', text]]);
      kingdomAudit_(row('done', 'ok', ''), true);
      return { success: true, head: head };
    });
  } catch (err) {
    console.error('kingdomsethead: ' + (err && err.message));
    return kingdomFail_('KINGDOM_ERROR');
  }
}
