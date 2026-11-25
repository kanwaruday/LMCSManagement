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

const GAME_PAY_ACTIONS = ['gamePayRecordOffer', 'gamePayMonth', 'gamePayInput', 'gamePayAdjust', 'gamePayStep'];
// S5b (N3, 26 Nov): the month's inputs, each an Owner-only POST that writes ONE thing the old page's own writer writes, and nothing else:
//   gamePayInput (one person: paid days, CL days encashed, hold, release of an earlier hold, skip a loan recovery with its reason),
//   gamePayAdjust (add or delete one adjustment line), gamePayStep (tick or untick one of the five steps for one school).
// Only people and schools the proxy gives this Owner; a locked school refuses (payAssertOpen_). None locks, runs or schedules payroll: that is
// S5c, the Owner's own confirmed step. Each write is logged in 'Game Actions' (who, what, month, code or school), never an amount.
// S5a (N3, 26 Nov): gamePayMonth, the month's draft register, read-only: payMonth_ cut to the schools the proxy gives this Owner and to the
// columns the old Review step shows. An Owner-only POST (View as can't send it); the look is audited first (who, month, never a figure);
// nothing is written to the payroll sheets. Payroll runs stay the Owner's own step (S5c): nothing here locks, runs or schedules one.
const GAME_PAY_ROW_KEYS = ['code', 'name', 'entity', 'designation', 'paidDays', 'basic', 'ada', 'da', 'gross', 'epf', 'esi', 'esiEmployer', 'rrf', 'tds', 'loanRecovery',
  'totalDeductions', 'net', 'bankPayable', 'cti', 'gratuityProvision', 'prevNet', 'prevCti', 'heldForFnF', 'withheld', 'released'];

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

function gamePayAudit_(who, what, month) {
  const ss = payOpen_();
  const sh = ss.getSheetByName('Game Looks') || ss.insertSheet('Game Looks');
  if (sh.getLastRow() < 1) sh.appendRow(['At', 'Who', 'What', 'Month']);
  sh.appendRow([new Date(), who, what, month]);
}

/** payMonth_ for the schools given: the register rows (the old Review columns), warnings, what is locked and the six-step checklist */
function gamePayMonth_(caller, month, schools) {
  payCheckMonth_(month);
  gamePayAudit_(caller.email, 'month', month); // audited before the figures go out
  PAY_MEMO = new Map();
  let m;
  try { m = payMonth_(payOpen_(), month); } finally { PAY_MEMO = null; }
  const mine = function (e) { return schools.indexOf(payEntity_(e)) !== -1; };
  const rows = (m.rows || []).filter(function (r) { return mine(r.entity); }).map(function (r) {
    const o = {};
    GAME_PAY_ROW_KEYS.forEach(function (k) { o[k] = r[k] === undefined ? null : r[k]; });
    o.adjustments = (r.adjustments || []).map(function (a) { return { id: String(a.id || ''), type: a.type, direction: a.direction, amount: a.amount }; }); // the note stays in the sheet
    const inp = r.input && typeof r.input === 'object' ? r.input : {}; // S5b: the person's own inputs, so the screen can show and change them
    o.input = { paidDays: inp.paidDays === undefined ? null : inp.paidDays, clDays: inp.clDays === undefined ? null : inp.clDays, hold: inp.hold === true ? 'fnf' : String(inp.hold || ''),
      release: inp.release === undefined ? null : inp.release, skipLoan: !!inp.skipLoan, skipReason: String(inp.skipReason || '') };
    return o;
  });
  const keep = function (src) { const o = {}; Object.keys(src || {}).filter(mine).forEach(function (e) { o[e] = src[e]; }); return o; };
  return { month: month, daysInMonth: m.daysInMonth, steps: m.steps, adjTypes: m.adjTypes || {}, rows: rows,
    warnings: (m.warnings || []).filter(function (w) { return mine(w.entity); }).map(function (w) { return { entity: payEntity_(w.entity), text: String(w.text || '').slice(0, 300) }; }),
    locked: keep(m.locked), checklist: keep(m.checklist) };
}

function gamePayLog_(who, what, month, subject) {
  const ss = payOpen_();
  const sh = ss.getSheetByName('Game Actions') || ss.insertSheet('Game Actions');
  if (sh.getLastRow() < 1) sh.appendRow(['At', 'Who', 'What', 'Month', 'For']);
  sh.appendRow([new Date(), who, what, month, subject]);
}
/** one write at a time (the script lock), reading fresh, as payWrite_ does, without building the whole month again */
function gamePayWrite_(month, fn) {
  payCheckMonth_(month);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { PAY_MEMO = null; const ss = payOpen_(); fn(ss); SpreadsheetApp.flush(); } finally { lock.releaseLock(); }
}
const GAME_PAY_INPUT_NUMS = ['paidDays', 'clDays', 'release'];
/** one person's inputs for the month: only the fields sent change (paySaveInputs_), at a school this Owner reaches */
function gamePayInput_(caller, p, schools) {
  const code = String(p.code || '').trim();
  const r = { code: code };
  GAME_PAY_INPUT_NUMS.forEach(function (k) { if (p[k] !== undefined) r[k] = String(p[k]); });
  if (p.hold !== undefined) r.hold = p.hold === 'none' ? '' : String(p.hold);
  if (p.skipLoan !== undefined) { r.skipLoan = p.skipLoan === '1'; r.skipReason = String(p.skipReason || ''); }
  if (Object.keys(r).length < 2) throw new Error('Nothing to change.');
  gamePayWrite_(String(p.month || ''), function (ss) {
    if (schools.indexOf(payEntityOf_(ss)(code)) === -1) throw new Error('That person isn’t at one of your schools.');
    paySaveInputs_(ss, p.month, [r], caller);
  });
  gamePayLog_(caller.email, 'input', p.month, code);
}
/** add one adjustment line (a single month, as the old page's default), or delete one by its id */
function gamePayAdjust_(caller, p, schools) {
  if (String(p.op) === 'add') {
    const code = String(p.code || '').trim();
    gamePayWrite_(String(p.month || ''), function (ss) {
      if (schools.indexOf(payEntityOf_(ss)(code)) === -1) throw new Error('That person isn’t at one of your schools.');
      payAddAdjustment_(ss, { month: p.month, code: code, type: p.type, amount: p.amount, note: p.note }, caller);
    });
    gamePayLog_(caller.email, 'adjustment added', p.month, code);
    return;
  }
  gamePayWrite_(String(p.month || ''), function (ss) {
    const rows = payRows_(ss.getSheetByName('Adjustments')).filter(function (a) { return String(a['ID']) === String(p.id) && payMonthKey_(a['Month']) === p.month; });
    if (!rows.length) throw new Error('Adjustment not found');
    if (schools.indexOf(payEntityOf_(ss)(String(rows[0]['Employee Code']).trim())) === -1) throw new Error('That adjustment isn’t at one of your schools.');
    payDeleteAdjustment_(ss, p.month, p.id);
  });
  gamePayLog_(caller.email, 'adjustment removed', p.month, String(p.id));
}
/** tick or untick one step of the month's checklist for one school (never ALL) */
function gamePayStep_(caller, p, schools) {
  const entity = payEntity_(p.entity);
  if (schools.indexOf(entity) === -1) throw new Error('That school isn’t one of yours.');
  gamePayWrite_(String(p.month || ''), function (ss) { payMarkStep_(ss, { month: p.month, entity: entity, step: p.step, done: p.done === '1' }, caller); });
  gamePayLog_(caller.email, p.done === '1' ? 'step ticked: ' + p.step : 'step unticked: ' + p.step, p.month, entity);
}

function gamePayDispatch_(body) {
  if (!gamePayKeyOk_(body)) return { success: false, error: 'not_authorized' };
  // S5e (B7, 26 Nov): game-pay-out.gs (outputs, final settlements, increments) answers every gamePayOut* action itself, in this file's envelope.
  // Same gate as everything here: the key above, the Owner by the verified email below. Missing file = unknown_action, never a half answer.
  const isOut = /^gamePayOut[A-Z]/.test(String(body.action || ''));
  if (isOut ? typeof gamePayOutRun_ !== 'function' : GAME_PAY_ACTIONS.indexOf(String(body.action)) === -1) return { success: false, error: 'unknown_action' };
  let caller = null;
  try { caller = body.role === 'owner' ? gamePayOwner_(body.email) : null; } catch (err) { caller = null; }
  if (!caller) return gamePayNo_('not_authorized');
  const p = body.params || {};
  const schools = Array.isArray(body.campuses) ? body.campuses.map(function (c) { return String(c).toUpperCase(); }) : [];
  if (isOut) {
    try { return gamePayOutRun_(body, caller, p, schools); }
    catch (err) { return gamePayNo_('refused', gamePaySay_(err)); }
  }
  if (['gamePayInput', 'gamePayAdjust', 'gamePayStep'].indexOf(String(body.action)) !== -1) {
    try {
      ({ gamePayInput: gamePayInput_, gamePayAdjust: gamePayAdjust_, gamePayStep: gamePayStep_ })[String(body.action)](caller, p, schools);
    } catch (err) { return gamePayNo_('refused', gamePaySay_(err)); }
    return gamePayOk_({ done: true });
  }
  if (String(body.action) === 'gamePayMonth') {
    try { return gamePayOk_(gamePayMonth_(caller, String(p.month || ''), schools)); }
    catch (err) { return gamePayNo_('refused', gamePaySay_(err)); }
  }
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
