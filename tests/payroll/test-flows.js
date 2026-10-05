// Backend flow tests against the fake fixture (no real salary data). Run via
// `node tests/payroll/run.js`. Ported from the pre-audit scratchpad e2e tests,
// with the real-ERP comparison assertions removed (can't commit real data here)
// and fixture codes/entities in place of the real Sep-2026 names.
'use strict';
const assert = require('assert');
const { boot, makeSheet, makeBook } = require('./harness');
const { buildFixture } = require('./fixtures');

module.exports = function run(t) {
  const h = boot(buildFixture());
  const call = h.call;
  const M = '2026-10';

  t.test('owner-only auth', () => {
    const anon = call('month', { month: M }, 'bad-token');
    assert.equal(anon.success, false);
    assert.match(anon.error, /Owner-only/);
  });

  let m = call('month', { month: M });
  assert.equal(m.rows.length, 10, 'all fixture staff appear');
  const A = m.rows.find((r) => r.entity === 'LMS1'), B = m.rows.find((r) => r.entity === 'LMS2'), C = m.rows.find((r) => r.entity === 'LMS3');

  t.test('adjustments add/delete/validate', () => {
    m = call('addadjustment', { month: M, code: A.code, type: 'Arrears', amount: 2000, note: 'Aug arrears' });
    m = call('addadjustment', { month: M, code: A.code, type: 'Advance / Loan Recovery', amount: 500 });
    let a = m.rows.find((r) => r.code === A.code);
    assert.equal(a.otherEarnings, 2000);
    assert.equal(a.otherDeductions, 500);
    assert.equal(a.adjustments.length, 2);
    m = call('deleteadjustment', { month: M, id: a.adjustments[1].id });
    a = m.rows.find((r) => r.code === A.code);
    assert.equal(a.adjustments.length, 1);
    assert.equal(a.otherDeductions, 0);
    let bad = call('addadjustment', { month: M, code: A.code, type: 'Bribe', amount: 5 });
    assert.match(bad.error, /Unknown adjustment/);
    bad = call('addadjustment', { month: M, code: A.code, type: 'Fine', amount: 0 });
    assert.match(bad.error, /more than 0/);
  });

  t.test('recurring adjustment: start/end month range', () => {
    const code = 'OWL/24/01/050'; // untouched elsewhere so far
    const r = call('addadjustment', { month: '2026-10', endMonth: '2027-01', code, type: 'Travel Allowance', amount: 300, note: 'recurring' });
    assert.equal(r.success, true, r.error);
    assert.deepEqual(r.adjustmentResult, { months: ['2026-10', '2026-11', '2026-12', '2027-01'], skippedLocked: [] });
    ['2026-10', '2026-11', '2026-12', '2027-01'].forEach((mo) => {
      assert.equal(call('month', { month: mo }).rows.find((x) => x.code === code).otherEarnings, 300, mo + ' got the recurring entry');
    });
    assert.ok(!call('month', { month: '2027-02' }).rows.find((x) => x.code === code).otherEarnings, 'does not spill past endMonth');
    const noRange = call('addadjustment', { month: '2026-10', endMonth: '2026-10', code, type: 'Fine', amount: 10 });
    assert.match(noRange.error, /End month must be after the start month/);
    const tooLong = call('addadjustment', { month: '2026-10', endMonth: '2030-01', code, type: 'Fine', amount: 10 });
    assert.match(tooLong.error, /more than 36 months/);
  });

  t.test('holds and release validation', () => {
    m = call('saveinputs', { month: M, rows: [{ code: B.code, hold: 'grievance' }] });
    const b = m.rows.find((r) => r.code === B.code);
    assert.equal(b.withheld, b.net);
    assert.equal(b.bankPayable, 0);
    const bad = call('saveinputs', { month: M, rows: [{ code: C.code, release: 100 }] });
    assert.match(bad.error, /not valid/);
  });

  t.test('lock requires all checklist steps', () => {
    const bad = call('lock', { month: M, entity: 'LMS1' });
    assert.match(bad.error, /tick these steps first -- staff, leave, adjustments, holds, review/);
    ['staff', 'leave', 'adjustments', 'holds', 'review'].forEach((step) => call('markstep', { month: M, entity: 'LMS1', step, done: true }));
    m = call('lock', { month: M, entity: 'LMS1' });
    assert.deepEqual(Object.keys(m.locked), ['LMS1']);
    const a = m.rows.find((r) => r.code === A.code);
    assert.equal(a.adjustments.length, 1, 'locked row keeps its adjustment');
    const bad2 = call('addadjustment', { month: M, code: A.code, type: 'Fine', amount: 10 });
    assert.match(bad2.error, /LMS1 is locked/);
  });

  t.test('untick resets a step; lock ALL writes every remaining school', () => {
    call('markstep', { month: M, entity: 'LMS1', step: 'review', done: false });
    let d = call('month', { month: M });
    assert.equal(Object.keys(d.checklist.LMS1).length, 4, 'untick works');
    ['staff', 'leave', 'adjustments', 'holds', 'review'].forEach((step) => call('markstep', { month: M, entity: 'ALL', step, done: true }));
    m = call('lock', { month: M, entity: 'ALL' });
    assert.equal(Object.keys(m.locked).length, 7, 'all 7 entities locked');
    const bad = call('lock', { month: M, entity: 'ALL' });
    assert.match(bad.error, /Nothing left to lock/);
  });

  t.test('held salary carries forward and can be released next month', () => {
    const b = m.rows.find((r) => r.code === B.code);
    const O = '2026-11';
    let o = call('month', { month: O });
    let ob = o.rows.find((r) => r.code === B.code);
    assert.equal(ob.heldBalance, b.withheld);
    assert.equal(ob.prevNet, b.net, 'prev month net read from the register, not recomputed');
    assert.equal(ob.prevCti, b.cti, 'prev month CTI travels with it');
    const bad = call('saveinputs', { month: O, rows: [{ code: B.code, release: b.withheld + 1 }] });
    assert.match(bad.error, /not valid/);
    o = call('saveinputs', { month: O, rows: [{ code: B.code, release: b.withheld }] });
    ob = o.rows.find((r) => r.code === B.code);
    assert.equal(ob.bankPayable, ob.net + b.withheld);
    assert.equal(ob.released, b.withheld);
  });

  t.test('leave template: vacation rules, balances, bad input', () => {
    const N = '2027-09'; // 30-day month, so the late/short conversion matches the ported values
    let n = call('month', { month: N });
    const prt = n.rows.find((r) => r.designation === 'PRT' && r.entity === 'LMS1');
    const hel = n.rows.find((r) => r.designation === 'Helper' && r.entity === 'LMS1');
    const pcd = n.rows.find((r) => r.designation === 'Peon Cum Driver');
    const odd = n.rows.find((r) => r.designation === 'Karate Teacher');
    assert.equal(prt.vacRule, 'Full');
    assert.equal(hel.vacRule, 'Half');
    assert.equal(pcd.vacRule, 'Half', 'Peon Cum Driver aliases Driver Cum Peon');
    assert.equal(odd.vacRule, '', 'unmapped designation');
    call('saveinputs', { month: N, rows: [{ code: prt.code, hold: 'fnf' }] });
    const up = {
      month: N, vacDays: { [hel.entity]: 21 },
      rows: [
        { code: prt.code, counts: { late: 3, short: 1 } },
        { code: pcd.code, counts: { casual: 2, absent: 1 }, clBalance: 3, compBalance: 1 },
        { code: hel.code, counts: {}, vacRule: 'Half', vacWorked: 7 },
        { code: odd.code, counts: {} },
      ],
    };
    const pv = call('previewleave', up).preview;
    const g = (c) => pv.find((x) => x.code === c);
    assert.equal(g(prt.code).paidDays, 28.92);
    assert.equal(g(pcd.code).paidDays, 30);
    assert.equal(g(pcd.code).compUsed, 1);
    assert.ok(!g(odd.code), 'empty row with no earlier record skipped');
    n = call('uploadleave', up);
    const np = n.rows.find((r) => r.code === prt.code);
    assert.equal(np.paidDays, 28.92);
    assert.equal(np.heldForFnF, np.net, 'hold kept after leave upload');
    const bad = call('previewleave', { month: N, rows: [{ code: prt.code, counts: { late: 1.5 } }] });
    assert.match(bad.error, /not valid/);
    const bad2 = call('previewleave', { month: N, rows: [{ code: prt.code, counts: {}, vacRule: 'Sometimes' }] });
    assert.match(bad2.error, /unknown vacation rule/);
  });

  // Also the regression test for the payStaffChanged_ cache-generation race (audit
  // 2026-10-01, fixed in apps-script/payroll.gs): back-to-back staff-changing writes,
  // each immediately followed by a staff-list read, must never see stale data.
  t.test('staff changes: joiner via offer, leaver, duplicate-code flag', () => {
    const O2 = '2027-01';
    h.books['1Oj'].tabs.EmpMaster.values.push(['NEW/27/01/200', 'New Person', 'LMS1', new Date(2027, 0, 5), 'Active', '']);
    h.books['1Tr'].tabs.Approvals.values.push(['1', '', 'Salary Offer Approval', '', '', '', '', 'T-0001 — New Person', '', '', '', '', '', 'Approved']);
    const rec = call('recordoffer', { applicantId: 'T-0001', name: 'New Person', entity: 'LMS1', designation: 'PRT', fullBasic: 12000, epf: true, tuition: 0, cti: 18000, netY1: 14000 }, 'principal-token');
    assert.equal(rec.success, true, rec.error);
    let st = call('month', { month: O2 }).staff;
    assert.equal(st.offers.length, 1);
    assert.equal(st.offers[0].approval, 'Approved');
    assert.deepEqual(st.notOnPayroll.map((x) => x.code), ['NEW/27/01/200']);
    let d = call('joinoffer', { month: O2, applicantId: 'T-0001', code: 'NEW/27/01/200', doj: '2027-01-05' });
    const j = d.rows.find((r) => r.code === 'NEW/27/01/200');
    assert.equal(j.paidDays, 27, 'joined 5 Jan -> 27 days');
    assert.equal(d.staff.joiners.length, 1);
    const leaverCode = 'JAY/20/05/030';
    d = call('markleft', { month: O2, code: leaverCode, lastDay: '2027-01-20' });
    assert.equal(d.rows.find((r) => r.code === leaverCode).paidDays, 20);
    assert.equal(d.staff.leavers.length, 1);
    assert.ok(!call('month', { month: '2027-02' }).rows.find((r) => r.code === leaverCode), 'gone next month');
  });

  t.test('transfer: whole month at new entity', () => {
    const O2 = '2027-01';
    const oldCode = 'ELK/24/02/090', newCode = 'ELK-TR/24/02/090';
    const d = call('applytransfer', { month: O2, oldCode, newCode, entity: 'LMS5' });
    assert.equal(d.success, true, d.error);
    assert.ok(!d.rows.find((r) => r.code === oldCode), 'old code not paid this month');
    const tn = d.rows.find((r) => r.code === newCode);
    assert.equal(tn.entity, 'LMS5');
    assert.equal(tn.paidDays, 31, 'whole month at the new school');
  });

  t.test('unlock: removes only that school/month, blocked if a later month is locked', () => {
    const U = '2027-03', V = '2027-04', steps = ['staff', 'leave', 'adjustments', 'holds', 'review'];
    steps.forEach((step) => call('markstep', { month: U, entity: 'ALL', step, done: true }));
    let u = call('lock', { month: U, entity: 'LMS2' });
    const lms2n = u.rows.filter((r) => r.entity === 'LMS2').length;
    steps.forEach((step) => call('markstep', { month: V, entity: 'ALL', step, done: true }));
    call('lock', { month: V, entity: 'LMS2' });
    const blocked = call('unlock', { month: U, entity: 'LMS2' });
    assert.match(blocked.error, /also locked for 2027-04/);
    call('unlock', { month: V, entity: 'LMS2' });
    u = call('unlock', { month: U, entity: 'LMS2' });
    assert.ok(!u.locked.LMS2, 'LMS2 unlocked');
    const again = call('unlock', { month: U, entity: 'LMS2' });
    assert.match(again.error, /not locked/);
    u = call('lock', { month: U, entity: 'LMS2' });
    assert.ok(u.locked.LMS2, 'can lock again');
  });

  t.test('opening balances, loans, accounts, F&F', () => {
    const S = '2027-05';
    const rrfCode = 'ELK/05/03/005', loanCode = 'FOX/24/02/090';
    const bad = call('importopening', { month: S, balances: [{ code: 'NOPE/1/1/1', account: 'RRF', amount: 5, source: 'x' }] });
    assert.match(bad.error, /not in Salary Master/);
    const bad2 = call('importopening', { month: S, loans: [{ code: loanCode, amount: 100, source: 'y' }] });
    assert.match(bad2.error, /monthly recovery is required/);
    const imp = { month: S, balances: [{ code: rrfCode, account: 'RRF', amount: 50000, source: 'Opening RRF' }], loans: [{ code: loanCode, amount: 25000, monthly: 5000, source: 'Sal Adv' }] };
    call('importopening', imp);
    const dup = call('importopening', imp);
    assert.match(dup.error, /already imported/);
    let m4 = call('month', { month: S });
    const rr = m4.rows.find((r) => r.code === loanCode);
    assert.equal(rr.loanDue, 5000);
    assert.equal(rr.loanRecovery, 5000);
    const skipBad = call('saveinputs', { month: S, rows: [{ code: loanCode, skipLoan: true }] });
    assert.match(skipBad.error, /give a reason/);
    m4 = call('saveinputs', { month: S, rows: [{ code: loanCode, skipLoan: true, skipReason: 'test' }] });
    assert.equal(m4.rows.find((r) => r.code === loanCode).loanRecovery, 0);
    call('saveinputs', { month: S, rows: [{ code: loanCode, skipLoan: false }] });
    ['staff', 'leave', 'adjustments', 'holds', 'review'].forEach((step) => call('markstep', { month: S, entity: 'ALL', step, done: true }));
    call('lock', { month: S, entity: 'ALL' });
    const O4 = '2027-06';
    let o4 = call('month', { month: O4 });
    assert.equal(o4.rows.find((r) => r.code === loanCode).loanBalance, 20000, '25000 - 5000 recovered in May');

    const acc = call('accounts', { month: O4 });
    assert.ok(acc.openingImported);
    const gs = acc.accounts.find((x) => x.code === rrfCode);
    assert.ok(gs.gratuity.vested && gs.gratuity.accrued > 0, '20+ year staff is gratuity-vested');

    const earlyFnf = call('fnfpreview', { code: rrfCode });
    assert.match(earlyFnf.error, /has not left/);
    call('markleft', { month: O4, code: rrfCode, lastDay: '2027-06-15' });
    const statement = call('fnfpreview', { code: rrfCode, manual: { clDays: 3, noticeRecovery: 1000 } }).statement;
    assert.ok(statement.earnings.gratuity > 0, 'gratuity paid for 20+ years');
    assert.equal(statement.net, statement.totalEarnings - statement.totalDeductions);
    call('settlefnf', { month: O4, code: rrfCode, manual: { clDays: 3, noticeRecovery: 1000 }, paidOn: '2027-07-10', mode: 'Bank', reference: 'UTR1' });
    const after = call('accounts', { month: O4 }).accounts.find((x) => x.code === rrfCode);
    assert.equal(after.security, 0);
    assert.ok(after.settled);
    const resettle = call('settlefnf', { month: O4, code: rrfCode, paidOn: '2027-07-10' });
    assert.match(resettle.error, /already has a Full/);
  });

  t.test('data quality: missing bank details, no EmpKeyNumbers row, EPF member with no UAN', () => {
    h.books['1Oj'].tabs.EmpKeyNumbers = makeSheet([
      ['EmployeeCode', 'BankAcNumber', 'IFSCCode', 'UanNumber', 'EsiNumber', 'PanNo'],
      ['FOX/24/02/090', '', '', '', '', ''], // on payroll, EPF member, nothing on file
      ['FOX/23/09/104', '1234567890', 'HDFC0001234', 'UAN456', 'ESI789', 'PAN1234A'], // clean
      ['ELK/05/03/005', '1234567890', 'HDFC0001234', 'UAN789', '', 'PAN5678B'], // wages above the ESI threshold, no ESI number
    ], 'EmpKeyNumbers', h.counter);
    const r = call('dataquality', { month: M });
    const byCode = {};
    r.issues.forEach((x) => (byCode[x.code] = byCode[x.code] || []).push(x.text));
    assert.ok(byCode['FOX/24/02/090'].some((t) => /bank account/.test(t)));
    assert.ok(byCode['FOX/24/02/090'].some((t) => /no UAN/.test(t)));
    assert.ok(!byCode['FOX/23/09/104'], 'clean row raises nothing');
    assert.ok(byCode['OWL/24/01/050'].some((t) => /Not found in EmpKeyNumbers/.test(t)), 'everyone else is missing from EmpKeyNumbers entirely');
    assert.ok(!byCode['JAY/21/03/020'].some((t) => /No ESI number/.test(t)), 'LMS6 is not ESI-registered, so no ESI-number flag even though absent from EmpKeyNumbers');
    assert.ok(!byCode['ELK/05/03/005'], 'wages above the ESI threshold -- no ESI-number flag even with none on file');
  });

  t.test('leave template: CL/Comp balance carries forward when a month has no upload yet', () => {
    const code = 'JAY/19/07/014'; // untouched by earlier tests
    const aug = call('uploadleave', { month: '2027-08', vacDays: {}, rows: [{ code, counts: { late: 4 }, clBalance: 5, compBalance: 2 }] });
    const augRow = aug.rows.find((r) => r.code === code);
    assert.equal(augRow.leave.compUsed, 1, 'comp covers the 1 charged day first');
    assert.equal(augRow.leave.clUsed, 0);
    const sep = call('month', { month: '2027-09' }); // nothing uploaded for September yet
    const sepRow = sep.rows.find((r) => r.code === code);
    assert.equal(sepRow.leave, null, 'carry-forward never fakes an actual upload');
    assert.deepEqual(sepRow.leaveCarryOpening, { cl: 6, comp: 1 }, 'leftover CL (5 unused + 1 month accrual) and Comp (2 - 1 used, no accrual) carried forward');
    // Once September itself has an upload, its own numbers win, not the carried ones.
    const sep2 = call('uploadleave', { month: '2027-09', vacDays: {}, rows: [{ code, counts: { single: 1 }, clBalance: 3, compBalance: 0 }] });
    const sep2Row = sep2.rows.find((r) => r.code === code);
    assert.equal(sep2Row.leave.clBalance, 3, "this month's own upload, not the carried-forward 5");

    // Multi-month gap: accrual adds up for every month since the last real upload.
    const code2 = 'JAY/21/03/020';
    call('uploadleave', { month: '2027-08', vacDays: {}, rows: [{ code: code2, counts: { single: 1 }, clBalance: 3, compBalance: 1 }] });
    const nov = call('month', { month: '2027-11' }); // Sep, Oct, Nov all have no upload for code2
    const novRow = nov.rows.find((r) => r.code === code2);
    assert.deepEqual(novRow.leaveCarryOpening, { cl: 6, comp: 0 }, '3 untouched CL (comp covered the 1 charged day) + 3 months accrual (Sep, Oct, Nov)');
  });

  t.test('annual increment: 3% at 36 months, recurring, idempotent per month, Roster sync', () => {
    const longTenured = 'ELK/05/03/005'; // doj 2005 -- always eligible
    const notYet = 'ELK/24/02/090'; // doj Feb 2024 -- well under 36 months by Sept 2026
    h.books['1Oj'].tabs.EmpSalary.values.push([longTenured, 'PRT', 4]);
    let pv = call('incrementpreview', { month: '2026-09' }).eligible;
    assert.ok(pv.some((e) => e.code === longTenured));
    assert.ok(!pv.some((e) => e.code === notYet), 'not yet 36 months');
    const before = pv.find((e) => e.code === longTenured).basic;
    const applied = call('applyincrement', { month: '2026-09', codes: [longTenured] });
    assert.equal(applied.success, true, applied.error);
    assert.deepEqual(applied.rosterSync, { success: true, skipped: true, updated: [], notFound: [] },
      'Roster sync is OFF by default while Payroll is still being tested -- Staff Master untouched');
    assert.equal(h.books['1Oj'].tabs.EmpSalary.values.find((r) => r[0] === longTenured)[2], 4, 'Increment count NOT touched');
    const sep = call('month', { month: '2026-09' });
    assert.equal(sep.rows.find((r) => r.code === longTenured).basic, Math.round(before * 1.03), '3% applied, effective this same September');
    // Idempotent: re-running the same month does nothing more for them.
    pv = call('incrementpreview', { month: '2026-09' }).eligible;
    assert.ok(!pv.some((e) => e.code === longTenured), 'already incremented this month -- not offered again');
    const reapply = call('applyincrement', { month: '2026-09', codes: [longTenured] });
    assert.match(reapply.error, /Nothing eligible/);
    // Recurring: next September, compounds on the NEW basic. (A different code --
    // longTenured gets marked left by an earlier test before Sept 2027.)
    const again = 'OWL/22/07/054';
    const base = call('incrementpreview', { month: '2026-09' }).eligible.find((e) => e.code === again).basic;
    call('applyincrement', { month: '2026-09', codes: [again] });
    const next = call('incrementpreview', { month: '2027-09' }).eligible.find((e) => e.code === again);
    assert.equal(next.basic, Math.round(base * 1.03));
    assert.equal(next.newBasic, Math.round(base * 1.03 * 1.03));
  });

  t.test('annual increment: Roster sync actually runs once turned on', () => {
    h.books['1d8'].tabs['PayRoll Constants'].values.push(['Sync Roster Increment (1=Yes)', 1]);
    const code = 'JAY/20/05/030'; // untouched by the increment tests above
    h.books['1Oj'].tabs.EmpSalary.values.push([code, 'Karate Teacher', 2]);
    const applied = call('applyincrement', { month: '2026-09', codes: [code] });
    assert.equal(applied.success, true, applied.error);
    assert.deepEqual(applied.rosterSync, { success: true, updated: [code], notFound: [] });
    assert.equal(h.books['1Oj'].tabs.EmpSalary.values.find((r) => r[0] === code)[2], 3, 'Increment count went 2 -> 3');
  });

  t.test('annual increment: multi-step (times) compounds and projects Net/CTI from the real calc', () => {
    const code = 'ELK/05/03/005'; // doj 2005, Full Basic 20000 at this point in the fixture
    const one = call('incrementpreview', { month: '2027-01' }).eligible.find((e) => e.code === code);
    const three = call('incrementpreview', { month: '2027-01', times: 3 }).eligible.find((e) => e.code === code);
    assert.equal(one.newBasic, Math.round(one.basic * 1.03));
    const stepped = Math.round(Math.round(Math.round(one.basic * 1.03) * 1.03) * 1.03);
    assert.equal(three.newBasic, stepped, 'compounds like 3 separate annual runs, rounding each step');
    assert.ok(three.newNet > one.newNet && three.newCti > one.newCti, 'bigger basic -> bigger projected Net and CTI');
    assert.equal(one.oldNet, three.oldNet, 'the "before" figures do not depend on times');
    const applied = call('applyincrement', { month: '2027-01', codes: [code], times: 3 });
    assert.equal(applied.success, true, applied.error);
    assert.equal(applied.rows.find((r) => r.code === code).basic, stepped, '3-step increment actually applied');
  });

  t.test('tally export: balances per company, blocks on unmapped deductions / missing loan ledger', () => {
    const T = '2027-11';
    const loanCode = 'ELK/25/04/100'; // HES, untouched by earlier tests
    const feeCode = 'FOX/23/09/104'; // LMS1
    // The Stage 4 test's opening-import loan (FOX/24/02/090) predates the Tally Ledger Name
    // column and recovers every month forever -- set its ledger once so it stops blocking
    // every month from here on, same as Uday would do once for a real pre-existing loan.
    const preexisting = h.books['1sal'].tabs.Loans.values;
    const preHdr = preexisting[0];
    const preRow = preexisting.find((r) => r[preHdr.indexOf('Employee Code')] === 'FOX/24/02/090');
    if (preRow) preRow[preHdr.indexOf('Tally Ledger Name')] = 'Sal Adv. Rakesh Kumar FOX/24/02/090';
    // Given a month before T -- payLedgerBalances_ only counts entries strictly before the
    // month being computed, so a loan "given" and due to start in the SAME month wouldn't
    // actually recover anything that month (its balance isn't on the books yet).
    const issued = call('issueloan', { month: T, code: loanCode, type: 'Salary Advance', amount: 10000, monthly: 2000, givenOn: '2027-10-15', startMonth: T });
    if (!issued.success) throw new Error('setup failed: ' + issued.error);
    call('addadjustment', { month: T, code: feeCode, type: 'Child Fee Recovery', amount: 500 });
    call('addadjustment', { month: T, code: feeCode, type: 'Fine', amount: 50 });
    const bad = call('tallyexport', { month: T });
    assert.match(bad.error, /not locked/, 'refuses before the month is even locked');
    ['staff', 'leave', 'adjustments', 'holds', 'review'].forEach((st) => call('markstep', { month: T, entity: 'ALL', step: st, done: true }));
    call('lock', { month: T, entity: 'ALL' });
    // Both problems present at once: missing loan ledger AND the unmapped Fine type.
    const blocked = call('tallyexport', { month: T });
    assert.match(blocked.error, /no Tally Ledger Name/);
    assert.match(blocked.error, new RegExp(loanCode.replace(/\//g, '\\/')));
    assert.match(blocked.error, /"Fine".*no confirmed Tally ledger/);
    // Fill in the loan ledger -- Fine alone still blocks it (can't add a correcting
    // adjustment after locking, so this proves the Fine check independently).
    const loanSheet = h.books['1sal'].tabs.Loans.values;
    const hdr = loanSheet[0];
    const row = loanSheet.find((r) => r[hdr.indexOf('Employee Code')] === loanCode);
    row[hdr.indexOf('Tally Ledger Name')] = 'Sal Adv. Test Person ' + loanCode;
    const stillBlocked = call('tallyexport', { month: T });
    assert.ok(!/no Tally Ledger Name/.test(stillBlocked.error), 'loan ledger problem is resolved');
    assert.match(stillBlocked.error, /"Fine".*no confirmed Tally ledger/);
  });

  t.test('tally export: a clean month balances and groups companies correctly', () => {
    const T = '2027-12';
    ['staff', 'leave', 'adjustments', 'holds', 'review'].forEach((st) => call('markstep', { month: T, entity: 'ALL', step: st, done: true }));
    call('lock', { month: T, entity: 'ALL' });
    const res = call('tallyexport', { month: T });
    assert.equal(res.success, true, res.error);
    // LMS4's only fixture employee was transferred to LMS5 in an earlier test, so LMS4 has no
    // staff by now -- 6 entities with staff, HES+LMS2 share one company -> 5 vouchers.
    assert.equal(res.vouchers.length, 5);
    const kelheli = res.vouchers.find((v) => v.company === 'LMS Kelheli Branch [2021-22]');
    assert.deepEqual(kelheli.entities, ['HES', 'LMS2'], 'HES and LMS2 combined into one company voucher');
    res.vouchers.forEach((v) => {
      const drTotal = Math.round(v.dr.reduce((t, x) => t + x.amount, 0) * 100);
      const crTotal = Math.round(v.cr.reduce((t, x) => t + x.amount, 0) * 100);
      assert.equal(drTotal, crTotal, v.company + ' balances');
    });
  });

  t.test('offers awaiting joining: only Owner-approved ones, enforced on join too', () => {
    const O = '2028-02', ap = h.books['1Tr'].tabs.Approvals.values;
    ap.push(['2', '', 'Salary Offer Approval', '', '', '', '', 'T-0500 — Rejected Person', '', '', '', '', '', 'Rejected']);
    ap.push(['3', '', 'Salary Offer Approval', '', '', '', '', 'T-0501 — Approved Person', '', '', '', '', '', 'Approved']);
    [['T-0500', 'Rejected Person'], ['T-0501', 'Approved Person'], ['T-0502', 'Unsubmitted Person']].forEach(([id, name]) => {
      const r = call('recordoffer', { applicantId: id, name, entity: 'LMS1', designation: 'PRT', fullBasic: 10000, epf: true, tuition: 0, cti: 15000, netY1: 12000 }, 'principal-token');
      assert.equal(r.success, true, r.error);
    });
    const ids = call('month', { month: O }).staff.offers.map((x) => x.id);
    assert.deepEqual(ids, ['T-0501'], 'Rejected and Not-submitted offers are hidden');
    const bad = call('joinoffer', { month: O, applicantId: 'T-0500', code: 'KUL/28/02/900', doj: '2028-02-03' });
    assert.match(bad.error, /not Owner-approved/);
  });

  t.test('EPF compulsory below the gross limit, whatever the Salary Master says', () => {
    const code = 'JAY/19/07/014'; // EPF member N, LMS5 (EPF-registered), wages well under 25,000
    const T = '2028-05', row = () => call('month', { month: T }).rows.find((r) => r.code === code);
    assert.ok(row().epf > 0, 'non-member below the limit pays EPF');
    const c = h.books['1d8'].tabs['PayRoll Constants'].values;
    c.push(['EPF Mandatory Below Gross', 0]); // later row wins
    assert.equal(row().epf, 0, 'rule switched off -> the Y/N decides again');
    c.push(['EPF Mandatory Below Gross', 25000]);
  });

  t.test('joining date comes from the Hiring Dashboard, and Joined waits for it', () => {
    const O = '2028-03', ap = h.books['1Tr'].tabs.Approvals.values;
    ap.push(['9', '', 'Salary Offer Approval', '', '', '', '', 'T-0600 — Hiring Person', '', '', '', '', '', 'Approved']);
    const r = call('recordoffer', { applicantId: 'T-0600', name: 'Hiring Person', entity: 'LMS1', designation: 'PRT', fullBasic: 10000, epf: true, tuition: 0, cti: 15000, netY1: 12000 }, 'principal-token');
    assert.equal(r.success, true, r.error);
    // Teaching Applicants workbook: row 600, column P = locked code, column Q = Date of Joining (text yyyy-MM-dd).
    const rows = [];
    rows[599] = [];
    rows[599][15] = 'KUL/28/03/900';
    h.books['1aS'] = makeBook({ 'Form Responses 1': makeSheet(rows, 'Form Responses 1', h.counter) }, h.counter);
    call('recordoffer', { applicantId: 'T-0600', name: 'Hiring Person', entity: 'LMS1', designation: 'PRT', fullBasic: 10001, epf: true, tuition: 0, cti: 15000, netY1: 12000 }, 'principal-token'); // bumps the staff cache
    let offer = call('month', { month: O }).staff.offers.find((x) => x.id === 'T-0600');
    assert.deepEqual(offer.hiring, { ok: true, doj: '', code: 'KUL/28/03/900' }, 'read from the hiring sheet, no date yet');
    const early = call('joinoffer', { month: O, applicantId: 'T-0600', code: 'KUL/28/03/900', doj: '2028-03-20' });
    assert.match(early.error, /has not entered the Date of Joining/);
    rows[599][16] = '2028-03-04';
    const ok = call('joinoffer', { month: O, applicantId: 'T-0600', code: 'KUL/28/03/900', doj: '2028-03-20' }); // typed date is ignored
    assert.equal(ok.success, true, ok.error);
    const row = ok.rows.find((x) => x.code === 'KUL/28/03/900');
    assert.equal(row.paidDays, 28, 'prorated from 4 March (28 of 31 days), not from the typed 20th');
  });

  t.test('staff are listed by the serial at the end of the code, not as text', () => {
    const fn = (c) => h.run("payCompareCodes_('" + c[0] + "','" + c[1] + "')");
    assert.equal(fn(['KUL/08/05/072', 'KUL/42/00/028']) > 0, true, '072 sorts after 028');
    const codes = ['KUL/08/05/072', 'KUL/12/05/021', 'KUL/17/08/042', 'KUL/13/04/028', 'KUL/95/10/001', 'NCM/22/07/054#2', 'NCM/22/07/054', 'KUL/26/02/1994'];
    const sorted = codes.slice().sort((a, b) => h.run("payCompareCodes_('" + a + "','" + b + "')"));
    assert.deepEqual(sorted, ['KUL/95/10/001', 'KUL/12/05/021', 'KUL/13/04/028', 'KUL/17/08/042', 'NCM/22/07/054', 'NCM/22/07/054#2', 'KUL/08/05/072', 'KUL/26/02/1994']);
    const rows = call('month', { month: '2028-04' }).rows.filter((r) => r.entity === 'LMS3' || r.entity === 'HES');
    ['HES', 'LMS3'].forEach((e) => {
      const ser = rows.filter((r) => r.entity === e).map((r) => Number(r.code.match(/(\d+)\D*$/)[1]));
      assert.deepEqual(ser, ser.slice().sort((a, b) => a - b), e + ' rows come back in serial order');
    });
  });

  t.test('annual increment: a whole run can be undone, safely', () => {
    const code = 'JAY/21/03/020'; // LMS6, untouched by earlier increment tests
    const basicIn = (mo) => call('month', { month: mo }).rows.find((r) => r.code === code).basic;
    const smRows = () => h.books['1sal'].tabs['Salary Master'].values.length;
    const before = smRows(), b0 = basicIn('2029-09');
    const a = call('applyincrement', { month: '2029-09', codes: [code] });
    assert.equal(a.success, true, a.error);
    assert.match(a.runId, /^R-/);
    assert.ok(basicIn('2029-09') > b0, 'raised');
    let runs = call('incrementpreview', { month: '2029-09' }).runs;
    assert.deepEqual([runs[0].runId, runs[0].count, runs[0].undone], [a.runId, 1, 0]);
    const u = call('undoincrement', { month: '2029-09', runId: a.runId });
    assert.equal(u.success, true, u.error);
    assert.equal(u.undone, 1);
    assert.equal(smRows(), before, 'the Salary Master row it wrote is gone');
    assert.equal(basicIn('2029-09'), b0, 'pay is back to what it was');
    runs = call('incrementpreview', { month: '2029-09' }).runs;
    assert.equal(runs[0].undone, 1, 'kept in the audit trail, marked undone');
    assert.ok(call('incrementpreview', { month: '2029-09' }).eligible.some((e) => e.code === code), 'eligible again');
    assert.match(call('undoincrement', { month: '2029-09', runId: a.runId }).error, /already undone/);
    // A later Salary Master row on top blocks it until that one is undone first.
    const first = call('applyincrement', { month: '2029-09', codes: [code] });
    const second = call('applyincrement', { month: '2029-10', codes: [code] });
    assert.match(call('undoincrement', { month: '2029-09', runId: first.runId }).error, /later Salary Master row/);
    assert.equal(call('undoincrement', { month: '2029-10', runId: second.runId }).success, true);
    assert.equal(call('undoincrement', { month: '2029-09', runId: first.runId }).success, true);
    assert.equal(basicIn('2029-09'), b0);
    // Locked school: refused until unlocked.
    const third = call('applyincrement', { month: '2029-11', codes: [code] });
    ['staff', 'leave', 'adjustments', 'holds', 'review'].forEach((st) => call('markstep', { month: '2029-11', entity: 'LMS6', step: st, done: true }));
    assert.equal(call('lock', { month: '2029-11', entity: 'LMS6' }).success, true);
    assert.match(call('undoincrement', { month: '2029-11', runId: third.runId }).error, /LMS6 is locked/);
    call('unlock', { month: '2029-11', entity: 'LMS6' });
    assert.equal(call('undoincrement', { month: '2029-11', runId: third.runId }).success, true);
    assert.match(call('undoincrement', { month: '2029-11', runId: 'bogus' }).error, /no id/);
  });

  t.test('data quality: an increment/raise row is not a duplicate; same Effective From is', () => {
    const code = 'OWL/22/07/054';
    const had = call('dataquality', { month: '2030-01' }).issues.some((x) => x.code === code && /same Effective From|more than once/.test(x.text));
    assert.equal(had, false);
    call('applyincrement', { month: '2030-01', codes: [code] }); // second Salary Master row for this code
    let issues = call('dataquality', { month: '2030-01' }).issues;
    assert.ok(!issues.some((x) => x.code === code && /same Effective From|more than once/.test(x.text)), 'a newer row for the same code is normal');
    const sm = h.books['1sal'].tabs['Salary Master'].values, hd = sm[0];
    const row = sm.filter((r) => r[0] === code).pop();
    sm.push(row.slice()); // a true duplicate: identical Effective From
    issues = call('dataquality', { month: '2030-01' }).issues;
    assert.ok(issues.some((x) => x.code === code && /same Effective From/.test(x.text)), 'identical Effective From is flagged');
    sm.pop();
  });
};
