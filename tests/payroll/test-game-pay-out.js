// node tests/payroll/test-game-pay-out.js -- W7 S5e (B7): game-pay-out.gs. Loaded with game-pay.gs's real helpers and fakes for the old payroll.gs
// functions. Checks: cut to the Owner's schools, only the output columns leave, every action audited, writes call the OLD function once under the
// lock, increments refuse when the previewed count moved, refusals in plain words. Fake data only (public repo).
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const calls = [], tabs = {};
let boom = null;
const SS = { getSheetByName: (n) => tabs[n] || null, insertSheet: (n) => { const rows = []; tabs[n] = { rows, getLastRow: () => rows.length, appendRow: (r) => rows.push(r) }; return tabs[n]; } };
const rec = (n, f) => (...a) => { if (boom) throw new Error(boom); calls.push([n, ...a.slice(1)]); return f ? f(...a) : undefined; };
const g = {
  PAY_MEMO: null, PAY_FNF_MANUAL: ['clDays', 'clRate', 'noticePay', 'otherEarnings', 'noticeRecovery', 'studentCollection', 'wardFee', 'otherDues'],
  SpreadsheetApp: { flush: () => {} }, LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => calls.push(['release']) }) },
  payOpen_: () => SS, payCheckMonth_: (m) => { if (!/^\d{4}-\d{2}$/.test(String(m || ''))) throw new Error('month must be YYYY-MM'); },
  payEntity_: (v) => String(v || '').replace(/\s+/g, '').toUpperCase(),
  payMonth_: rec('payMonth_', (ss, month) => ({ month, daysInMonth: 30, settings: { epfCeiling: 15000, epsRate: 0.0833, secret: 1 }, locked: { LMS1: {}, LMS3: {} }, rows: [
    { code: 'E001', name: 'Test One', entity: 'LMS1', designation: 'TGT', paidDays: 30, basic: 100, gross: 150, cti: 170, net: 140, bankPayable: 140, bankAccount: 'SECRET', adjustments: [{ type: 'Arrears', direction: 'Earning', amount: 5, note: 'private' }] },
    { code: 'E002', name: 'Test Two', entity: 'LMS3', designation: 'PRT', paidDays: 30, basic: 90, net: 80, bankPayable: 80, adjustments: [] }] })),
  payOutputs_: rec('payOutputs_', () => ({ keys: { E001: { account: '1', ifsc: 'X' }, E002: { account: '2' } }, leave: { E001: { counts: {} }, E002: {} },
    letters: [{ ref: 'R1', entity: 'LMS1' }, { ref: 'R2', entity: 'LMS3' }] })),
  payTallyVoucher_: rec('payTallyVoucher_', (ss, month) => ({ month, narration: 'N', vouchers: [{ company: 'A', entities: ['LMS1'] }, { company: 'B', entities: ['LMS2', 'LMS3'] }] })),
  payIssueLetter_: rec('payIssueLetter_', (ss, d) => { if (d.serial === 'dup') throw new Error('Reference 3 was already used'); }),
  payAccounts_: rec('payAccounts_', () => ({ openingImported: true, accounts: [{ code: 'E001', entity: 'LMS1' }, { code: 'E002', entity: 'LMS3' }, { code: 'F1', entity: '', former: true }] })),
  payFnfStatement_: rec('payFnfStatement_', (ss, code, manual) => ({ account: code === 'E002' ? { entity: 'LMS3' } : { entity: 'LMS1' }, manual })),
  paySettleFnf_: rec('paySettleFnf_'),
  payIncrementEligible_: rec('payIncrementEligible_', () => [{ code: 'E001', entity: 'LMS1' }, { code: 'E003', entity: 'LMS1' }, { code: 'E002', entity: 'LMS3' }]),
  payIncrementRuns_: () => [],
  payApplyIncrement_: rec('payApplyIncrement_', () => ({ runId: 'R-1', rosterSync: { success: false } })),
  payUndoIncrement_: rec('payUndoIncrement_', () => ({ undone: 2, undoNote: '' })),
};
vm.createContext(g);
const gs = (f) => new vm.Script(fs.readFileSync(path.join(__dirname, '../../apps-script', f), 'utf8')).runInContext(g);
gs('game-pay.gs'); gs('game-pay-out.gs');
const owner = { email: 'owner@lms.org.in' };
const run = (action, p, schools) => JSON.parse(JSON.stringify(g.gamePayOutRun_({ action }, owner, Object.assign({ month: '2026-11' }, p), schools || ['LMS1', 'LMS2'])));
const wrote = (n) => calls.filter((c) => c[0] === n).length;

// month: only the Owner's schools, only the output columns, audited first
let r = run('gamePayOutMonth');
assert.strictEqual(r.data.ok, true);
assert.deepStrictEqual(r.data.rows.map((x) => x.code), ['E001']);
assert.ok(!('bankAccount' in r.data.rows[0]) && !('secret' in r.data.settings));
assert.deepStrictEqual(r.data.rows[0].adjustments, [{ type: 'Arrears', direction: 'Earning', amount: 5 }]);
assert.deepStrictEqual([Object.keys(r.data.keys), Object.keys(r.data.leave), r.data.letters.map((l) => l.ref), r.data.locked], [['E001'], ['E001'], ['R1'], { LMS1: true }]);
assert.deepStrictEqual(JSON.parse(JSON.stringify(tabs['Game Looks'].rows[1].slice(1))), ['owner@lms.org.in', 'OutMonth', '2026-11']);
assert.ok(!JSON.stringify(tabs['Game Looks'].rows).includes('140'), 'no figure in the audit');
assert.strictEqual(g.PAY_MEMO, null);
assert.strictEqual(run('gamePayOutMonth', { month: 'next' }).data.code, 'refused');
assert.strictEqual(run('gamePayOutNope').error, 'unknown_action');

// tally: a company is handed over only when the Owner reaches every school in it
assert.deepStrictEqual(run('gamePayOutTally').data.vouchers.map((v) => v.company), ['A']);
assert.deepStrictEqual(run('gamePayOutTally', {}, ['LMS1', 'LMS2', 'LMS3']).data.vouchers.map((v) => v.company), ['A', 'B']);

// letter: one old call under the lock; a school outside the Owner's is not found; a clash comes back in words
calls.length = 0;
const L = { entity: 'lms1', serial: '33', ref: 'HES/LMS/SAL/33/26', date: '2026-11-30', cheque: 'c', amount: '140', staff: '1', addressee: 'a', debitAccount: 'd' };
assert.strictEqual(run('gamePayOutLetter', L).data.recorded, true);
assert.deepStrictEqual(calls.map((c) => c[0]), ['payIssueLetter_', 'release']);
assert.strictEqual(run('gamePayOutLetter', { ...L, entity: 'LMS3' }).data.code, 'not_found');
assert.strictEqual(wrote('payIssueLetter_'), 1);
assert.strictEqual(run('gamePayOutLetter', { ...L, serial: 'dup' }).data.say, 'Reference 3 was already used');
assert.strictEqual(calls.filter((c) => c[0] === 'release').length, 2, 'lock released after a refusal');

// accounts and F&F
assert.deepStrictEqual(run('gamePayOutAccounts').data.accounts.map((a) => a.code), ['E001', 'F1']);
calls.length = 0;
const man = JSON.stringify({ clDays: '2', noticePay: 100, evil: 9, otherDues: '' });
assert.deepStrictEqual(run('gamePayOutFnf', { code: 'E001', month: '', manual: man }).data.statement.manual, { clDays: 2, noticePay: 100 });
assert.strictEqual(run('gamePayOutFnf', { code: 'E002', manual: man }).data.code, 'not_found', 'a school the Owner does not reach');
assert.strictEqual(run('gamePayOutFnfSettle', { code: 'E002', manual: man }).data.code, 'not_found');
assert.strictEqual(wrote('paySettleFnf_'), 0, 'nothing settled for a school out of reach');
assert.strictEqual(run('gamePayOutFnfSettle', { code: 'E001', manual: man, paidOn: '2026-11-30', mode: 'Bank transfer' }).data.settled, true);
assert.strictEqual(wrote('paySettleFnf_'), 1);
assert.strictEqual(run('gamePayOutFnf', { code: 'E001', manual: '{bad' }).data.code, 'refused');

// increments: preview in the Owner's schools; apply refuses when the count moved, else applies exactly the ticked people
assert.deepStrictEqual(run('gamePayOutIncPreview', { times: '2' }).data.eligible.map((e) => e.code), ['E001', 'E003']);
calls.length = 0;
assert.match(run('gamePayOutIncApply', { times: '1', expect: '3', exclude: '' }).data.say, /list changed/);
assert.strictEqual(wrote('payApplyIncrement_'), 0);
r = run('gamePayOutIncApply', { times: '1', expect: '1', exclude: 'E003, ', entity: 'LMS1' });
assert.deepStrictEqual([r.data.runId, r.data.count, r.data.rosterBumped], ['R-1', 1, false]);
const ap = JSON.parse(JSON.stringify(calls.find((c) => c[0] === 'payApplyIncrement_')));
assert.deepStrictEqual(ap[1], { month: '2026-11', times: 1, codes: ['E001'] });
assert.strictEqual(run('gamePayOutIncApply', { times: '1', expect: '1', entity: 'LMS3' }).data.code, 'not_found');
// an empty list must write nothing: the old function would read it as everyone (G2b money-safety)
calls.length = 0;
for (const x of [{ expect: '0', exclude: 'E001,E003' }, { expect: '0', exclude: '' , entity: 'LMS2' }, { expect: '', exclude: 'E001,E003' }, { expect: '-1', exclude: 'E001,E003' }]) {
  const e = run('gamePayOutIncApply', { times: '1', ...x }).data;
  assert.strictEqual(e.ok, false); assert.strictEqual(e.code, 'refused');
}
assert.strictEqual(wrote('payApplyIncrement_'), 0, 'an empty list writes nothing');
assert.strictEqual(run('gamePayOutIncApply', { times: '1', expect: '1', exclude: 'E003' }).data.runId, 'R-1', 'a real list still applies');
assert.strictEqual(run('gamePayOutIncUndo', { runId: 'R-1' }).data.undone, 2);

// the whole file calls no pay-run writer: no lock/unlock/save inputs, nothing scheduled
const src = fs.readFileSync(path.join(__dirname, '../../apps-script/game-pay-out.gs'), 'utf8').replace(/\/\/.*$/gm, '');
assert.ok(!/payLock_|payUnlock_|paySaveInputs_|payWrite_|ScriptApp|Trigger|payImportOpening_/.test(src));
assert.ok(require('../../apps-script/projects.json').payroll.files.includes('game-pay-out'));
console.log('test-game-pay-out: all passed');
