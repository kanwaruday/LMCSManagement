// ═══════════════════════════════════════════════════════════════════
// Payroll Backend -- the game's payroll OUTPUTS (W7 S5e, B7, 2026-11-26; Uday: "keep it in the game").
//
// Reached only through game-pay.gs's gamePayDispatch_ (key check + Owner by the game's verified email are done THERE; this file never sees
// a key): `gamePayOutRun_(body, caller, params, schools)` for every action named gamePayOut*. Same envelope (gamePayOk_ / gamePayNo_).
// What it serves, from the SAME old payroll.gs functions the old page runs (no money logic is copied here):
//   Month       payMonth_ + payOutputs_ cut to the Owner's schools: the register with every column the bank letter, salary sheet and slips need,
//               bank / UAN / ESI numbers, leave, letters already recorded. The files themselves are built on the screen.
//   Tally       payTallyVoucher_ (refuses unless every school is locked; refuses anything that would not balance)
//   Letter      payIssueLetter_: records a bank letter's reference number. Moves no money.
//   Accounts    payAccounts_: who has left, balances. Fnf / FnfSettle: payFnfStatement_ / paySettleFnf_.
//   IncPreview / IncApply / IncUndo: payIncrementEligible_ / payApplyIncrement_ / payUndoIncrement_.
// Nothing here pays anyone or runs unprompted: every write is an Owner button on the screen. Looks are audited (who, what, month: never a figure).
// Opening balances stay on the old page (a workbook import; the proxy's 500-character parameters cannot carry it).
// ═══════════════════════════════════════════════════════════════════

const GAME_PAY_OUT_ROW_KEYS = ['code', 'name', 'entity', 'designation', 'paidDays', 'basic', 'ada', 'da', 'gross', 'cti', 'epf', 'epfEmployer', 'esi', 'esiEmployer', 'tds', 'rrf',
  'loanRecovery', 'otherDeductions', 'tuitionA', 'tuitionD', 'clEncashment', 'totalDeductions', 'net', 'bankPayable', 'heldForFnF', 'withheld'];
const GAME_PAY_OUT_ACTIONS = ['gamePayOutMonth', 'gamePayOutTally', 'gamePayOutLetter', 'gamePayOutAccounts', 'gamePayOutFnf', 'gamePayOutFnfSettle',
  'gamePayOutIncPreview', 'gamePayOutIncApply', 'gamePayOutIncUndo'];

function gamePayOutNum_(v) { const n = Number(v); return isNaN(n) ? 0 : n; }
/** the F&F form's manual boxes: only the known keys, only numbers (the proxy gave a JSON string) */
function gamePayOutManual_(s) {
  let o = {};
  try { o = JSON.parse(String(s || '{}')); } catch (err) { throw new Error('The F&F boxes could not be read'); }
  const m = {};
  PAY_FNF_MANUAL.forEach(function (k) { if (o && o[k] !== undefined && o[k] !== '') m[k] = Number(o[k]); });
  return m;
}
/** one write at a time (the script lock), fresh reads, nothing memoised */
function gamePayOutWrite_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { PAY_MEMO = null; const r = fn(payOpen_()); SpreadsheetApp.flush(); return r; } finally { lock.releaseLock(); }
}
function gamePayOutRead_(fn) {
  PAY_MEMO = new Map();
  try { return fn(payOpen_()); } finally { PAY_MEMO = null; }
}

function gamePayOutRun_(body, caller, p, schools) {
  const action = String(body.action);
  if (GAME_PAY_OUT_ACTIONS.indexOf(action) === -1) return { success: false, error: 'unknown_action' };
  const mine = function (e) { return schools.indexOf(payEntity_(e)) !== -1; };
  const month = String(p.month || '');
  try {
    if (action !== 'gamePayOutFnf' && action !== 'gamePayOutFnfSettle') payCheckMonth_(month);
    gamePayAudit_(caller.email, action.replace('gamePay', ''), month); // before any figure goes out or any write lands

    if (action === 'gamePayOutMonth') {
      return gamePayOk_(gamePayOutRead_(function (ss) {
        const m = payMonth_(ss, month), o = payOutputs_(ss, month);
        const rows = (m.rows || []).filter(function (r) { return mine(r.entity); }).map(function (r) {
          const x = {}; GAME_PAY_OUT_ROW_KEYS.forEach(function (k) { x[k] = r[k] === undefined ? null : r[k]; });
          x.adjustments = (r.adjustments || []).map(function (a) { return { type: a.type, direction: a.direction, amount: a.amount }; });
          return x;
        });
        const codes = {}; rows.forEach(function (r) { codes[r.code] = true; });
        const pick = function (src) { const t = {}; Object.keys(src || {}).forEach(function (c) { if (codes[c]) t[c] = src[c]; }); return t; };
        const locked = {}; Object.keys(m.locked || {}).filter(mine).forEach(function (e) { locked[e] = true; });
        const s = m.settings || {};
        return { month: month, daysInMonth: m.daysInMonth, rows: rows, keys: pick(o.keys), leave: pick(o.leave), locked: locked,
          letters: (o.letters || []).filter(function (l) { return mine(l.entity); }), settings: { epfCeiling: s.epfCeiling, epsRate: s.epsRate } };
      }));
    }
    if (action === 'gamePayOutTally') {
      const t = gamePayOutRead_(function (ss) { return payTallyVoucher_(ss, month); });
      // a company's voucher adds up schools that may share books: hand it over only when the Owner reaches every school in it
      return gamePayOk_({ month: t.month, narration: t.narration, vouchers: t.vouchers.filter(function (v) { return v.entities.every(mine); }) });
    }
    if (action === 'gamePayOutLetter') {
      const entity = payEntity_(p.entity);
      if (!mine(entity)) return gamePayNo_('not_found');
      gamePayOutWrite_(function (ss) {
        payIssueLetter_(ss, { month: month, entity: entity, serial: p.serial, ref: p.ref, date: p.date, cheque: p.cheque, amount: gamePayOutNum_(p.amount),
          staff: gamePayOutNum_(p.staff), addressee: p.addressee, debitAccount: p.debitAccount }, caller);
      });
      return gamePayOk_({ recorded: true });
    }
    if (action === 'gamePayOutAccounts') {
      return gamePayOk_(gamePayOutRead_(function (ss) {
        const a = payAccounts_(ss, month);
        return { month: month, openingImported: a.openingImported, accounts: a.accounts.filter(function (x) { return x.former || mine(x.entity); }) };
      }));
    }
    if (action === 'gamePayOutFnf' || action === 'gamePayOutFnfSettle') {
      const code = String(p.code || '').trim();
      const st = gamePayOutRead_(function (ss) { return payFnfStatement_(ss, code, gamePayOutManual_(p.manual)); });
      if (!st.account.former && !mine(st.account.entity)) return gamePayNo_('not_found');
      if (action === 'gamePayOutFnf') return gamePayOk_({ statement: st });
      gamePayOutWrite_(function (ss) {
        paySettleFnf_(ss, { code: code, manual: gamePayOutManual_(p.manual), paidOn: p.paidOn, mode: p.mode, reference: p.reference, notes: p.notes }, caller);
      });
      return gamePayOk_({ settled: true });
    }
    const times = Math.max(1, Math.min(12, Math.round(Number(p.times) || 1)));
    if (action === 'gamePayOutIncPreview') {
      return gamePayOk_(gamePayOutRead_(function (ss) {
        return { month: month, times: times, eligible: payIncrementEligible_(ss, month, times).filter(function (e) { return mine(e.entity); }), runs: payIncrementRuns_(ss, month) };
      }));
    }
    if (action === 'gamePayOutIncApply') {
      // the Owner approved a list on the screen: apply exactly the schools' eligible people minus the unticked, and refuse if the count moved
      const entity = p.entity ? payEntity_(p.entity) : '';
      if (entity && !mine(entity)) return gamePayNo_('not_found');
      const skip = {}; String(p.exclude || '').split(',').forEach(function (c) { if (c.trim()) skip[c.trim()] = true; });
      const res = gamePayOutWrite_(function (ss) {
        const codes = payIncrementEligible_(ss, month, times).filter(function (e) { return mine(e.entity) && (!entity || e.entity === entity) && !skip[e.code]; })
          .map(function (e) { return e.code; });
        if (codes.length !== Number(p.expect)) throw new Error('The list changed: it is ' + codes.length + ' people now, not ' + Number(p.expect) + '. Open the preview again.');
        const r = payApplyIncrement_(ss, { month: month, times: times, codes: codes }, caller, ''); // no Google ID token here: the Roster count is bumped by hand (said on screen)
        r.count = codes.length; return r;
      });
      return gamePayOk_({ runId: res.runId, count: res.count, rosterBumped: !!(res.rosterSync && res.rosterSync.success && !res.rosterSync.skipped) });
    }
    if (action === 'gamePayOutIncUndo') {
      const runId = String(p.runId || '');
      const r = gamePayOutWrite_(function (ss) { return payUndoIncrement_(ss, { month: month, runId: runId }, caller); });
      return gamePayOk_({ undone: r.undone, undoNote: r.undoNote });
    }
  } catch (err) { PAY_MEMO = null; return gamePayNo_('refused', gamePaySay_(err)); }
  return { success: false, error: 'unknown_action' };
}
