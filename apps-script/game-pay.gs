// ═══════════════════════════════════════════════════════════════════
// Payroll Backend -- the game's calls (W7, N3, 2026-11-25; Uday: "keep it in the game").
//
// Called only by lms-game's `classic` Edge Function (classic-proxy-contract.md), POST text/plain:
//   { action, key, role, campus, campuses, email, params }
// Gate: this project's own Script property GAME_KEY (32+ characters, compared in constant time); the person is the game's verified
// email, re-checked against this project's own Allowlist (PAY_ALLOWLIST_SHEET_ID) for the Owner role. Owner only.
// S3: gamePayRecordOffer -- the Offer Calculator's payroll copy of a salary offer, the SAME payRecordOffer_ the old page's
// 'recordoffer' runs (its rules: applicant id, school, Full Basic > 0, up to 2 children for the fee wash; an offer already Joined or
// Dismissed is refused). Nothing here runs a pay run, and nothing is scheduled: payroll runs stay the Owner's own steps.
// No figures are logged; refusals come back as plain words unless they could carry data.
// ═══════════════════════════════════════════════════════════════════

const GAME_PAY_ACTIONS = ['gamePayRecordOffer'];

function gamePaySameKey_(want, got) {
  if (!want || typeof got !== 'string' || want.length !== got.length) return false;
  let d = 0;
  for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return d === 0;
}
function gamePayKeyOk_(body) {
  const want = String(PropertiesService.getScriptProperties().getProperty('GAME_KEY') || '').trim();
  return want.length >= 32 && !!body && gamePaySameKey_(want, String(body.key || '').trim());
}
/** the game's verified email -> { email } when this project's Allowlist gives it the Owner role, else null */
function gamePayOwner_(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return null;
  const rows = SpreadsheetApp.openById(PAY_ALLOWLIST_SHEET_ID).getSheets()[0].getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '').trim().toLowerCase() !== e) continue;
    const roles = String(rows[i][3] || '').split(',').map(function (r) { return r.trim(); });
    return roles.indexOf('Owner') !== -1 ? { email: e } : null;
  }
  return null;
}
const gamePayOk_ = function (data) { return { success: true, data: Object.assign({ ok: true }, data || {}) }; };
const gamePayNo_ = function (code, say) { return { success: true, data: Object.assign({ ok: false, code: code }, say ? { say: say } : {}) }; };
function gamePaySay_(err) {
  const m = String((err && err.message) || '').slice(0, 160);
  return m && !/@|\d{5,}/.test(m) ? m : '';
}

function gamePayDispatch_(body) {
  if (!gamePayKeyOk_(body)) return { success: false, error: 'not_authorized' };
  if (GAME_PAY_ACTIONS.indexOf(String(body.action)) === -1) return { success: false, error: 'unknown_action' };
  let caller = null;
  try { caller = body.role === 'owner' ? gamePayOwner_(body.email) : null; } catch (err) { caller = null; }
  if (!caller) return gamePayNo_('not_authorized');
  const p = body.params || {};
  const schools = Array.isArray(body.campuses) ? body.campuses.map(function (c) { return String(c).toUpperCase(); }) : [];
  if (String(body.action) === 'gamePayRecordOffer') {
    const entity = String(p.campus || '').toUpperCase();
    if (schools.indexOf(entity) === -1) return gamePayNo_('not_found'); // only a school the proxy says this Owner reaches
    let grades = [];
    try { grades = JSON.parse(String(p.childGrades || '[]')); } catch (err) { return gamePayNo_('bad_input'); }
    const d = { applicantId: String(p.id || ''), name: String(p.name || ''), entity: entity, designation: String(p.designation || ''), subjects: String(p.subjects || ''),
      fullBasic: Number(p.fullBasic), epf: p.epf === '1', tuition: Number(p.tuition) || 0, childGrades: Array.isArray(grades) ? grades : [], cti: Number(p.cti) || 0, netY1: Number(p.netY1) || 0 };
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(20000);
      try { PAY_MEMO = null; payRecordOffer_(payOpen_(), d, caller); } finally { lock.releaseLock(); }
    } catch (err) { return gamePayNo_('refused', gamePaySay_(err)); }
    return gamePayOk_({ recorded: true });
  }
  return { success: false, error: 'unknown_action' };
}
