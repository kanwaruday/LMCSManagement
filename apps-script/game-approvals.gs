// ═══════════════════════════════════════════════════════════════════
// PDR Backend -- the game's native Approvals room (W4, lane-h, 2026-11-12): key-gated game* actions over the SAME approvals.gs rules.
//
// Called only by lms-game's `classic` Edge Function, server to server (classic-proxy-contract.md). POST text/plain:
//   { action, key, role, campus, campuses, email, params }
//   key       the PDR game key (Script property GAME_KEY); anything else gets {success:false, error:'not_authorized'}
//   email     the person, from the game's VERIFIED Supabase JWT (never the browser). Every action here needs it (V2: `actor: true`).
//             Roles, the decide right and the visible schools come from this project's own Allowlist by that email (pdrCallerForEmail_),
//             exactly as the portal's Google sign-in would give them. No caller flags are taken from the request.
//   campus    campus-scope actions: the one school the game checked. The row must be at that school.
//   campuses  tenant-scope actions: the caller's game-side school codes, already expanded by the proxy (a list, possibly empty).
//             Reads are the intersection of this and the Allowlist view, so the old portal's wider view never leaks back in. Anything
//             else (missing, null) = no school: fail closed.
// Answers {success:true, data:{ok:true, ...}} or, for a business refusal, {success:true, data:{ok:false, code}} (short codes only, never
// sheet text). People come back as {key, name}: key is an HMAC of the email (Script property GAME_PEOPLE_SECRET), mapped back here.
// No email or key is ever logged or returned.
// ═══════════════════════════════════════════════════════════════════

const GAME_APR_ACTIONS = ['gameApprovalsList', 'gameApprovalDetail', 'gameApprovalComment', 'gameApprovalCommentDelete', 'gameApprovalDecide',
  'gameApprovalArchive', 'gameApprovalReferees'];
// approvals.gs error text -> the room's short code (anything unlisted is 'refused')
const GAME_APR_CODES = [
  [/not found/i, 'not_found'], [/not authorized|only delete your own/i, 'not_authorized'], [/already decided/i, 'decided'], [/archived/i, 'archived'],
  [/md academics|interview/i, 'awaiting_md'], [/only an approved request can be revoked/i, 'not_approved'],
  [/invalid decision|required|nothing to archive/i, 'bad_input'],
];

function gameSameKey_(want, got) {
  if (!want || typeof got !== 'string' || want.length !== got.length) return false;
  let d = 0;
  for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return d === 0;
}
function gameKeyOk_(body) {
  const want = String(PropertiesService.getScriptProperties().getProperty('GAME_KEY') || '').trim();
  return want.length >= 32 && !!body && gameSameKey_(want, String(body.key || '').trim());
}
const gameOk_ = function (data) { return { success: true, data: Object.assign({ ok: true }, data || {}) }; };
const gameNo_ = function (code) { return { success: true, data: { ok: false, code: code } }; };
function gameCode_(res) {
  const e = String((res && res.error) || '');
  for (let i = 0; i < GAME_APR_CODES.length; i++) if (GAME_APR_CODES[i][0].test(e)) return GAME_APR_CODES[i][1];
  return 'refused';
}

/** An opaque, stable key for a person: HMAC-SHA256(email) with GAME_PEOPLE_SECRET, web-safe, 22 chars. */
function gamePersonKey_(email) {
  const secret = String(PropertiesService.getScriptProperties().getProperty('GAME_PEOPLE_SECRET') || '');
  if (secret.length < 32) throw new Error('GAME_PEOPLE_SECRET not set');
  const sig = Utilities.computeHmacSha256Signature(String(email).trim().toLowerCase(), secret);
  return Utilities.base64EncodeWebSafe(sig).replace(/=+$/, '').slice(0, 22);
}

/** email -> display name: the Allowlist names, then active staff from the Employee Master (the referee list). Never the email itself. */
function gameNames_() {
  const out = {};
  try {
    aprReferees_({ roles: ['Owner'] }).staff.forEach(function (s) { out[s.email] = s.name; }); // same cached source as the Refer-to box
  } catch (err) { /* names fall back below */ }
  const rows = pdrAllowlistRows_();
  for (let i = 1; i < rows.length; i++) {
    const e = String(rows[i][0] || '').trim().toLowerCase(), n = String(rows[i][1] || '').trim();
    if (e && n) out[e] = n;
  }
  return out;
}
const gameNameOf_ = function (names, email) { return names[String(email || '').trim().toLowerCase()] || (email ? 'Staff member' : ''); };

/** The latest live recommendation per approval, from the Recommendations tab of the same workbook. Twin of the Coordinator project's
 *  coordRecLatest_ (a different Apps Script project; both read the tab by position): RecId, ApprovalId, Campus, Category,
 *  RecommendedBy, Recommendation, Reason, Checked, RecommendedAt, Superseded. */
function gameRecLatest_() {
  const sh = aprWorkbook_().getSheetByName('Recommendations');
  const rows = sh && sh.getLastRow() > 1 ? sh.getDataRange().getValues() : [];
  const str = function (v) { return v instanceof Date ? v.toISOString() : String(v == null ? '' : v); };
  const out = {};
  rows.forEach(function (r) {
    if (String(r[0]) === 'RecId' || String(r[9]).toUpperCase() === 'TRUE' || !r[1]) return;
    const id = String(r[1]), at = str(r[8]);
    if (out[id] && out[id].at > at) return;
    out[id] = { by: String(r[4]).toLowerCase(), recommendation: String(r[5]), reason: String(r[6]), at: at };
  });
  return out;
}

/** The school codes this request may touch. Campus scope: exactly the proxy's one school; tenant scope: its list; otherwise none. */
function gameSchools_(body) {
  if (body.campus) return [String(body.campus).trim().toUpperCase()];
  return Array.isArray(body.campuses) ? body.campuses.map(function (c) { return String(c).trim().toUpperCase(); }) : [];
}
const gameIn_ = function (schools, code) { return schools.indexOf(String(code).trim().toUpperCase()) !== -1; };

/** A JSON-string param: parsed, or undefined when it is not valid JSON. */
function gameJson_(v) { try { return JSON.parse(String(v)); } catch (err) { return undefined; } }

/** A request as the room sees it: approvals.gs's own object, with names in place of emails. */
function gameRequest_(o, names, recs, me) {
  const r = Object.assign({}, o);
  r.requestedByName = gameNameOf_(names, o.requestedBy);
  r.requestedByMe = String(o.requestedBy || '').trim().toLowerCase() === me;
  r.decidedByName = gameNameOf_(names, o.decidedBy);
  delete r.requestedBy; delete r.decidedBy; delete r.referredTo; // referredTo is the email audit trail
  if (r.followUp) r.followUp = { assigneeName: o.followUp.assigneeName || gameNameOf_(names, o.followUp.assignee), due: o.followUp.due,
    status: o.followUp.status, note: o.followUp.note, doneAt: o.followUp.doneAt };
  const rec = recs ? recs[o.id] : null;
  r.recommendation = rec ? { byName: gameNameOf_(names, rec.by), mine: rec.by === me, recommendation: rec.recommendation, reason: rec.reason, at: rec.at } : null;
  return r;
}

/** The approval row (values) and whether it sits inside `schools`; null when not found. */
function gameAprRow_(id) {
  const values = aprValues_(), i = aprFindRowIndex_(values, id);
  return i === -1 ? null : values[i];
}

/** POST action=gameApproval*: dispatched from main.gs doPost, before the Google-token check (the key is this path's gate). */
function gameApprovalsDispatch_(body) {
  if (!gameKeyOk_(body)) return { success: false, error: 'not_authorized' };
  if (GAME_APR_ACTIONS.indexOf(String(body.action)) === -1) return { success: false, error: 'unknown_action' };
  let caller;
  try { caller = pdrCallerForEmail_(body.email); } catch (err) { caller = null; }
  if (!caller) return gameNo_('not_authorized');
  if (pdrIsTeacherOnly_(caller) || !(callerHasRole_(caller, 'Owner') || callerHasRole_(caller, 'Coordinator'))) return gameNo_('not_authorized'); // the room is Management's
  const p = body.params || {}, me = caller.email, schools = gameSchools_(body);
  const inRow = function (row) { return row && gameIn_(schools, row[1]); };
  try {
    switch (String(body.action)) {
      case 'gameApprovalsList': {
        const res = aprList_(caller);
        if (!res.success) return gameNo_(gameCode_(res));
        const names = gameNames_(), recs = gameRecLatest_();
        return gameOk_({ requests: res.requests.filter(function (o) { return gameIn_(schools, o.campusId); }).map(function (o) { return gameRequest_(o, names, recs, me); }),
          canDecide: res.canDecide });
      }
      case 'gameApprovalDetail': {
        const row = gameAprRow_(String(p.id || ''));
        if (!row) return gameNo_('not_found');
        if (!inRow(row)) return gameNo_('not_authorized');
        const res = aprDetail_(caller, String(p.id));
        if (!res.success) return gameNo_(gameCode_(res));
        const names = gameNames_();
        return gameOk_({ request: gameRequest_(res.request, names, gameRecLatest_(), me),
          comments: res.comments.map(function (c) { return { id: c.id, authorName: gameNameOf_(names, c.authorEmail), mine: c.authorEmail.trim().toLowerCase() === me, body: c.body, postedAt: c.postedAt }; }),
          canDecide: res.canDecide, canRecommend: callerHasRole_(caller, 'Coordinator') && !callerHasRole_(caller, 'Owner') });
      }
      case 'gameApprovalComment': {
        const row = gameAprRow_(String(p.id || ''));
        if (!row) return gameNo_('not_found');
        if (!inRow(row)) return gameNo_('not_authorized');
        const text = String(p.body || '').trim();
        if (!text || text.length > 500) return gameNo_('bad_input');
        const res = aprAddComment_(caller, { approvalId: String(p.id), body: text });
        return res.success ? gameOk_({ status: res.status }) : gameNo_(gameCode_(res));
      }
      case 'gameApprovalCommentDelete': { // params: id (the request), commentId
        const cid = String(p.commentId || '');
        const comments = aprCommentsSheet_().getDataRange().getValues(), c = comments.filter(function (r) { return String(r[0]) === cid; })[0];
        if (!c || String(c[1]) !== String(p.id || '')) return gameNo_('not_found');
        if (!inRow(gameAprRow_(String(c[1])))) return gameNo_('not_authorized');
        const res = aprDeleteComment_(caller, { id: cid });
        return res.success ? gameOk_({}) : gameNo_(gameCode_(res));
      }
      case 'gameApprovalDecide': {
        const row = gameAprRow_(String(p.id || ''));
        if (!row) return gameNo_('not_found');
        if (!inRow(row)) return gameNo_('not_authorized');
        // referAction / referAccountability / referInformation: JSON-string lists of 0-2 person keys (from gameApprovalReferees)
        const refer = {}, param = { action: 'referAction', accountability: 'referAccountability', information: 'referInformation' };
        for (const k of APR_REFER_KINDS) refer[k] = p[param[k]] === undefined || p[param[k]] === '' ? [] : gameJson_(p[param[k]]);
        const staff = {};
        if (APR_REFER_KINDS.some(function (k) { return Array.isArray(refer[k]) && refer[k].length; })) aprReferees_(caller).staff.forEach(function (s) { staff[gamePersonKey_(s.email)] = s.email; });
        const referTo = {};
        for (const k of APR_REFER_KINDS) {
          const keys = refer[k];
          if (!Array.isArray(keys) || keys.length > 2 || keys.some(function (x) { return typeof x !== 'string' || !staff[x]; })) return gameNo_('bad_input');
          referTo[k] = keys.map(function (x) { return staff[x]; }).join(',');
        }
        const res = aprDecide_(caller, { id: String(p.id), decision: String(p.decision || ''), note: String(p.note || '').slice(0, 500), referTo: referTo });
        if (!res.success) return gameNo_(gameCode_(res));
        const referred = res.referred ? APR_REFER_KINDS.reduce(function (n, k) { return n + res.referred[k].length; }, 0) : 0;
        return gameOk_({ referred: referred, mailed: !res.mailError });
      }
      case 'gameApprovalArchive': { // params: id, archive '1' | '0' (one request per call: campus scope is one school)
        const row = gameAprRow_(String(p.id || ''));
        if (!row) return gameNo_('not_found');
        if (!inRow(row)) return gameNo_('not_authorized');
        if (p.archive !== '1' && p.archive !== '0') return gameNo_('bad_input');
        const res = aprArchive_(caller, { ids: [String(p.id)], archive: p.archive === '1' });
        return res.success ? gameOk_({ count: res.count }) : gameNo_(gameCode_(res));
      }
      case 'gameApprovalReferees': {
        const res = aprReferees_(caller);
        if (!res.success) return gameNo_(gameCode_(res));
        return gameOk_({ staff: res.staff.map(function (s) { return { key: gamePersonKey_(s.email), name: s.name }; }) });
      }
    }
  } catch (err) {
    console.error('gameApprovals ' + String(body.action) + ': ' + (err && err.name)); // never the message: it can carry sheet text
    return { success: false, error: 'backend' };
  }
  return { success: false, error: 'unknown_action' };
}
