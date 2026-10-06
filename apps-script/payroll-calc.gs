// ═══════════════════════════════════════════════════════════════════
// PAYROLL-CALC -- the monthly salary formula, one employee at a time.
// Pure function, no Sheets/Script services, so the same file runs under
// node for the self-test below (and against the Sep 2026 ERP register,
// see the design conversation of 2026-09-29).
//
// "LMCS Payroll Backend" project (separate deployment -- see
// apps-script/README.md). Rules are the ones Uday settled 2026-09-29:
//   Month Basic   = ROUND(Full Basic × Paid Days / Days in Month)
//   ADA, DA       = ROUND(Month Basic × entity ADA% / DA%)
//   Wages         = Basic + ADA + DA  (EPF/ESI base; tuition & CL encashment excluded)
//   EPF           = 12% × MIN(Wages, EPF ceiling) if member (or gross < EPF Mandatory Below Gross) AND entity registered;
//                   employer contribution = the same amount
//   ESI           = 0.75% employee / 3.25% employer of Wages, if Wages <= threshold
//                   AND entity registered
//   CL Encashment = CL days × (Wages − EPF − ESI) / divisor (30)
//   Gross         = Wages + CL Encashment + Tuition + Other Earnings
//   CTI           = Gross + EPF employer + ESI employer
//   RRF rate      = non-member 0; <12 months Y1; <24 Y2; <36 Y3; 36+ Y3 only
//                   while (target on) balance < target × CTI, else 0
//   RRF           = rate × CTI, capped (target on) at the gap to target × CTI
//   Deductions    = EPF + ESI + RRF + Tuition + Other Deductions
//   Net           = Gross − Deductions; Hold → Held for F&F instead of Bank
//   Gratuity prov = ROUND((Basic + DA) × 5%) -- employer provision, not deducted
// Gratuity wages exclude ADA by law (EPF wages include it).
// ═══════════════════════════════════════════════════════════════════

function payMonthsBetween_(from, to) {
  let m = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) m--;
  return Math.max(0, m);
}

// emp: {fullBasic, epfMember, rrfMember, tuition, doj (Date), esiCovered (optional -- coverage for
//      the ESI contribution period; see payEsiCovered_ in payroll.gs)}
// input: {paidDays, clDays, hold ('fnf' | 'grievance' | ''; true = 'fnf'), release (₹ of earlier
//         held salary paid out this month), otherEarnings, otherDeductions,
//         loanRecovery (₹ due this month on salary advances / RRF loans), tds (₹ income tax)}
// rates: {da, ada, epfRegistered, esiRegistered}   (fractions / booleans)
// s: settings -- {epfRate, epfCeiling, esiEmpRate, esiErRate, esiThreshold,
//    rrfY1, rrfY2, rrfY3, rrfTargetMonths, rrfStopAtTarget, gratRate, clDivisor}
// ctx: {monthEnd (Date), daysInMonth, openingRrf}
// Rounds like Excel's ROUND(x, 0): 0.35 × 12345 is 4320.7499999… in
// binary floating point, which Math.round alone would send the wrong way.
function payRound_(x) { return Math.round(Math.round(x * 1e6) / 1e6); }

function payCalc_(emp, input, rates, s, ctx) {
  const R = payRound_;
  const paidDays = input.paidDays === undefined || input.paidDays === '' ? ctx.daysInMonth : Number(input.paidDays);
  const basic = R(emp.fullBasic * paidDays / ctx.daysInMonth);
  const ada = R(basic * rates.ada);
  const da = R(basic * rates.da);
  const wages = basic + ada + da;
  // EPF and ESI are both rounded UP to the next rupee (Uday, confirmed with Pawan Sir 2026-10-01 --
  // overrides the ERP's own normal rounding on EPF, which the September validation had matched).
  const up = function (x) { return Math.ceil(Math.round(x * 1e6) / 1e6); };
  // EPF is compulsory below a gross threshold whatever the Salary Master says (Uday, 2026-10-05): gross
  // here = wages + tuition + other earnings, i.e. before CL encashment, which itself depends on EPF.
  // The school must still be EPF-registered. Setting "EPF Mandatory Below Gross" (0 = switched off).
  const preGross = wages + (Number(emp.tuition) || 0) + (Number(input.otherEarnings) || 0);
  const epfMandatory = (Number(s.epfMandatoryBelow) || 0) > 0 && preGross < s.epfMandatoryBelow;
  const epf = (emp.epfMember || epfMandatory) && rates.epfRegistered ? up(Math.min(wages, s.epfCeiling) * s.epfRate) : 0;
  // ESI: coverage is decided once per contribution period (Apr-Sep, Oct-Mar) -- someone covered at
  // its start stays covered even if wages cross the threshold mid-period.
  const esiOn = rates.esiRegistered && (emp.esiCovered !== undefined ? !!emp.esiCovered : wages <= s.esiThreshold);
  const esi = esiOn ? up(wages * s.esiEmpRate) : 0;
  const esiEr = esiOn ? up(wages * s.esiErRate) : 0;
  const clEnc = R((Number(input.clDays) || 0) * (wages - epf - esi) / s.clDivisor);
  const tuition = Number(emp.tuition) || 0;
  const otherEarnings = Number(input.otherEarnings) || 0;
  const gross = wages + clEnc + tuition + otherEarnings;
  const cti = gross + epf + esiEr;

  const months = payMonthsBetween_(emp.doj, ctx.monthEnd);
  const opening = Number(ctx.openingRrf) || 0;
  const target = s.rrfTargetMonths * cti;
  let rrfRate = 0;
  // Once the target has been reached, RRF stays stopped for good: a later increment that lifts the
  // target above the balance does not restart it (Uday, 2026-10-06; ctx.rrfReached comes from payroll.gs).
  const reached = !!s.rrfStopAtTarget && !!ctx.rrfReached;
  if (emp.rrfMember && !reached) {
    if (months < 12) rrfRate = s.rrfY1;
    else if (months < 24) rrfRate = s.rrfY2;
    else if (months < 36 || (s.rrfStopAtTarget && opening < target)) rrfRate = s.rrfY3;
  }
  let rrf = R(rrfRate * cti);
  if (rrfRate && s.rrfStopAtTarget) rrf = Math.min(rrf, Math.max(0, R(target - opening)));

  const otherDeductions = Number(input.otherDeductions) || 0;
  const tds = Number(input.tds) || 0;
  // Loan / advance recovery never takes net pay below zero (stage 4, 2026-09-30).
  const loanRecovery = Math.max(0, Math.min(Number(input.loanRecovery) || 0, gross - (epf + esi + rrf + tuition + otherDeductions + tds)));
  const totalDeductions = epf + esi + rrf + tuition + otherDeductions + tds + loanRecovery;
  const net = gross - totalDeductions;
  // Held for F&F = leaving month's salary, paid at F&F. Withheld (grievance)
  // = Appointment Letter: up to 2 extra weeks. Either way it leaves the bank
  // transfer; `release` pays an earlier hold out on top of this month's pay.
  const hold = input.hold === true ? 'fnf' : String(input.hold || '');
  const release = Number(input.release) || 0;
  return {
    paidDays: paidDays, serviceMonths: months, basic: basic, ada: ada, da: da, wages: wages,
    clEncashment: clEnc, tuitionA: tuition, otherEarnings: otherEarnings, gross: gross,
    epf: epf, esi: esi, rrfRate: rrfRate, rrf: rrf, tuitionD: tuition, otherDeductions: otherDeductions, loanRecovery: loanRecovery, tds: tds,
    totalDeductions: totalDeductions, net: net, bankPayable: (hold ? 0 : net) + release, released: release,
    heldForFnF: hold === 'fnf' ? net : 0, withheld: hold === 'grievance' ? net : 0,
    epfEmployer: epf, esiEmployer: esiEr, cti: cti, gratuityProvision: R((basic + da) * s.gratRate),
    closingRrf: opening + rrf,
    rrfTargetReached: !!emp.rrfMember && !!s.rrfStopAtTarget && (reached || (target > 0 && opening + rrf >= target)),
  };
}

// ── Gratuity (Payment of Gratuity Act; stage 4, 2026-09-30) ──────────
// 15/26 × last drawn monthly (Basic + DA) × years of service, a final part-year
// of 6+ months counting as a full year, capped at ₹20,00,000; payable only after
// 5 years. Wages exclude ADA by law (Uday, 2026-09-29). Same rule as
// gratuity-liability.gs, here so payroll and F&F use it directly.
function payGratuity_(fullBasic, daRate, doj, asOf) {
  const months = payMonthsBetween_(doj, asOf);
  const years = Math.floor(months / 12) + (months % 12 >= 6 ? 1 : 0);
  const wages = payRound_(fullBasic) + payRound_(fullBasic * daRate);
  const amount = Math.min(2000000, payRound_(15 / 26 * wages * years));
  return { months: months, years: years, wages: wages, accrued: amount, vested: months >= 60, payable: months >= 60 ? amount : 0 };
}

// ── Leave -> paid days (2026-09-30, bye-laws leave norms / OO-09/26) ──
// Each count is converted to leave days by its bye-law weight; the month's
// total is charged Compensatory Leave first, then CL, then unpaid (Uday,
// 2026-09-29). No carry-over between months; total rounded to 2 decimals.
const PAY_LEAVE_FIELDS = [ // [key, template/sheet header, leave days per instance]
  ['casual', 'Casual Leave', 1], ['comp', 'Compensatory Leave', 1], ['single', 'Single Leave', 1],
  ['double', 'Double Leave', 2], ['absent', 'Absent', 2], ['late', 'Late', 0.25], ['short', 'Short', 1 / 3],
  ['half', 'Half', 0.5], ['sd7', 'Special Day (7+ days notice)', 2], ['sdLt7', 'Special Day (<7 days notice)', 3],
  ['sdNone', 'Special Day (no notice)', 5], ['nonCompliance', 'Non-Compliance', 0.1]];

// Vacation rule per role (JobRole Norms): 'Full' vacation is paid; 'Half' roles
// must work floor(vacation working days / 2) -- the shortfall becomes leave;
// 'Works' roles have no vacation; 'Not tracked' roles (CL "NA") have no leave
// deductions. Probationers (first 12 months): no work no pay for vacation days.
const PAY_VAC_RULES = ['Full', 'Half', 'Works', 'Not tracked'];

function payRound2_(x) { return Math.round(Math.round(x * 1e6) / 1e4) / 100; }

// l: {counts: {key: n}, clBalance, compBalance, vacRule, vacDays, vacWorked, probation}
function payLeaveConvert_(l, daysInMonth) {
  const notes = [];
  const counts = l.counts || {};
  let charged = 0;
  PAY_LEAVE_FIELDS.forEach(function (f) { charged += (Number(counts[f[0]]) || 0) * f[2]; });
  const vacDays = Number(l.vacDays) || 0, worked = Number(l.vacWorked) || 0;
  let vacUnpaid = 0;
  if (l.vacRule === 'Not tracked') {
    if (charged) notes.push('leave not tracked for this role -- ignored');
    charged = 0;
  }
  if (vacDays && l.probation) {
    vacUnpaid = Math.max(0, vacDays - worked);
    if (vacUnpaid) notes.push('probation: ' + vacUnpaid + ' vacation day(s) not worked, unpaid');
  } else if (vacDays && l.vacRule === 'Half') {
    const shortfall = Math.max(0, Math.floor(vacDays / 2) - worked);
    if (shortfall) { charged += shortfall; notes.push('worked ' + worked + ' of ' + Math.floor(vacDays / 2) + ' required vacation days -- ' + shortfall + ' as leave'); }
  } else if (vacDays && !l.vacRule) {
    notes.push('no vacation rule -- vacation days not checked');
  }
  charged = payRound2_(charged);
  const comp = Number(l.compBalance) || 0, cl = Number(l.clBalance) || 0;
  if (charged && l.clBalance === '' && l.compBalance === '') notes.push('no CL/Comp balance given -- charged as unpaid');
  const compUsed = Math.min(charged, comp);
  const clUsed = payRound2_(Math.min(charged - compUsed, cl));
  const unpaid = payRound2_(charged - compUsed - clUsed);
  return { charged: charged, compUsed: compUsed, clUsed: clUsed, unpaidLeave: unpaid, vacUnpaid: vacUnpaid,
    paidDays: payRound2_(Math.max(0, daysInMonth - unpaid - vacUnpaid)), notes: notes };
}

function payLeaveSelfTest_() {
  const eq = function (a, b, msg) { if (a !== b) throw new Error(msg + ': expected ' + b + ', got ' + a); };
  let r = payLeaveConvert_({ counts: { late: 3, short: 1 }, clBalance: '', compBalance: '' }, 30);
  eq(r.charged, 1.08, '3 late + 1 short = 0.75 + 0.33'); eq(r.unpaidLeave, 1.08, 'no balance -> unpaid'); eq(r.paidDays, 28.92, 'paid days');
  r = payLeaveConvert_({ counts: { casual: 2, absent: 1 }, clBalance: 3, compBalance: 1 }, 31);
  eq(r.charged, 4, '2 CL + absent (2)'); eq(r.compUsed, 1, 'comp first'); eq(r.clUsed, 3, 'then CL'); eq(r.unpaidLeave, 0, 'nothing unpaid'); eq(r.paidDays, 31, 'full month');
  r = payLeaveConvert_({ counts: { short: 3 }, clBalance: 0, compBalance: 0 }, 30);
  eq(r.charged, 1, '3 short = exactly 1 day');
  r = payLeaveConvert_({ counts: {}, vacRule: 'Half', vacDays: 21, vacWorked: 7, clBalance: 0, compBalance: 0 }, 30);
  eq(r.charged, 3, '21 vacation days -> 10 required (rounded down), worked 7 -> 3 leave');
  r = payLeaveConvert_({ counts: {}, vacRule: 'Full', vacDays: 20, vacWorked: 4, probation: true }, 30);
  eq(r.vacUnpaid, 16, 'probationer: 16 unworked vacation days unpaid'); eq(r.paidDays, 14, 'paid days');
  r = payLeaveConvert_({ counts: { absent: 2 }, vacRule: 'Not tracked' }, 30);
  eq(r.paidDays, 30, 'not tracked -> no deduction');
  return 'payLeaveSelfTest_ passed';
}

// Run from the editor (or `node` -- see bottom) to check the formula; throws on mismatch.
function payrollCalcSelfTest_() {
  const eq = function (a, b, msg) { if (a !== b) throw new Error(msg + ': expected ' + b + ', got ' + a); };
  const S = { epfRate: 0.12, epfCeiling: 25000, esiEmpRate: 0.0075, esiErRate: 0.0325, esiThreshold: 21000,
    rrfY1: 0.12, rrfY2: 0.09, rrfY3: 0.06, rrfTargetMonths: 3, rrfStopAtTarget: false, gratRate: 0.05, clDivisor: 30 };
  const rates = { da: 0.05, ada: 0.35, epfRegistered: true, esiRegistered: true };
  const ctx = { monthEnd: new Date(2026, 8, 30), daysInMonth: 30, openingRrf: 0 };
  const emp = { fullBasic: 10000, epfMember: true, rrfMember: true, tuition: 0, doj: new Date(2026, 3, 1) };

  let r = payCalc_(emp, {}, rates, S, ctx);
  eq(r.wages, 14000, 'wages = 10000 + 3500 + 500');
  eq(r.epf, 1680, 'EPF 12% of 14000');
  eq(r.esi, 105, 'ESI 0.75%'); eq(r.esiEmployer, 455, 'ESI employer 3.25%');
  eq(r.cti, 16135, 'CTI = 14000 + 1680 + 455');
  eq(r.rrf, 1936, 'RRF 12% of CTI (5 months service)');
  eq(r.net, 14000 - 1680 - 105 - 1936, 'net');
  eq(r.gratuityProvision, 525, 'gratuity 5% of basic+DA');

  r = payCalc_(emp, { paidDays: 15 }, rates, S, ctx);
  eq(r.basic, 5000, 'half month prorates basic');

  r = payCalc_(Object.assign({}, emp, { fullBasic: 20000 }), {}, rates, S, ctx);
  eq(r.epf, 3000, 'EPF capped at 12% of 25000'); eq(r.esi, 0, 'no ESI above 21000');

  r = payCalc_(emp, {}, Object.assign({}, rates, { epfRegistered: false, esiRegistered: false }), S, ctx);
  eq(r.epf + r.esi + r.esiEmployer, 0, 'unregistered entity pays no EPF/ESI');

  const old = Object.assign({}, emp, { doj: new Date(2022, 0, 1) });
  eq(payCalc_(old, {}, rates, S, ctx).rrf, 0, 'no RRF after 36 months, target off');
  const Son = Object.assign({}, S, { rrfStopAtTarget: true });
  eq(payCalc_(old, {}, rates, Son, Object.assign({}, ctx, { openingRrf: 10000 })).rrfRate, 0.06, 'resumes 6% past 36 months while short of target');
  eq(payCalc_(emp, {}, rates, Son, Object.assign({}, ctx, { openingRrf: 3 * 16135 - 100 })).rrf, 100, 'capped at the gap to target');
  eq(payCalc_(old, {}, rates, Son, Object.assign({}, ctx, { openingRrf: 10000, rrfReached: true })).rrf, 0, 'target reached earlier: stays stopped after the target rises');
  eq(payCalc_(emp, {}, rates, Son, Object.assign({}, ctx, { openingRrf: 3 * 16135 - 100 })).rrfTargetReached, true, 'hitting the target this month marks it reached');

  r = payCalc_(emp, { hold: true, clDays: 3 }, rates, S, ctx);
  eq(r.clEncashment, 1222, 'CL encashment = 3 × 12215 / 30');
  eq(r.bankPayable, 0, 'held salary not paid to bank'); eq(r.heldForFnF, r.net, 'held for F&F');
  r = payCalc_(emp, { hold: 'grievance', release: 5000 }, rates, S, ctx);
  eq(r.withheld, r.net, 'withheld (grievance)'); eq(r.heldForFnF, 0, 'not an F&F hold');
  eq(r.bankPayable, 5000, 'only the released earlier hold goes to bank');
  r = payCalc_(emp, { tds: 2000 }, rates, S, ctx);
  eq(r.tds, 2000, 'TDS'); eq(r.net, 14000 - 1680 - 105 - 1936 - 2000, 'net after TDS');
  r = payCalc_(Object.assign({}, emp, { fullBasic: 16000, esiCovered: true }), {}, rates, S, ctx);
  eq(r.esi, Math.ceil(22400 * 0.0075), 'covered for the period even above 21000, rounded up'); eq(r.esiEmployer, 728, '3.25% of 22400');
  eq(payCalc_(Object.assign({}, emp, { esiCovered: false }), {}, rates, S, ctx).esi, 0, 'not covered this period');
  eq(payCalc_(Object.assign({}, emp, { fullBasic: 9950 }), {}, rates, S, ctx).esi, Math.ceil(13930 * 0.0075), 'rounds up (104.475 -> 105)');
  // EPF rounds up too (Uday, confirmed with Pawan Sir 2026-10-01) -- 7336 wages,
  // 12% = 880.32, which normal rounding would send to 880, not 881.
  eq(payCalc_(Object.assign({}, emp, { fullBasic: 5240 }), {}, rates, S, ctx).epf, 881, 'EPF rounds up (880.32 -> 881)');
  // Compulsory EPF below the gross threshold, even for a non-member; not above it; not at an unregistered school.
  const Sm = Object.assign({}, S, { epfMandatoryBelow: 25000 });
  const nonMember = Object.assign({}, emp, { epfMember: false });
  eq(payCalc_(nonMember, {}, rates, Sm, ctx).epf, 1680, 'non-member below 25,000 gross still pays EPF');
  eq(payCalc_(Object.assign({}, nonMember, { fullBasic: 20000 }), {}, rates, Sm, ctx).epf, 0, 'non-member at/above 25,000 gross pays none');
  eq(payCalc_(nonMember, {}, rates, S, ctx).epf, 0, 'rule off (0/undefined) -> Salary Master Y/N decides');
  eq(payCalc_(nonMember, {}, Object.assign({}, rates, { epfRegistered: false }), Sm, ctx).epf, 0, 'unregistered school: never');
  r = payCalc_(emp, { loanRecovery: 5000 }, rates, S, ctx);
  eq(r.loanRecovery, 5000, 'loan recovery'); eq(r.net, 14000 - 1680 - 105 - 1936 - 5000, 'net after recovery');
  r = payCalc_(emp, { loanRecovery: 50000 }, rates, S, ctx);
  eq(r.net, 0, 'recovery capped at net pay');
  const g = payGratuity_(20000, 0.05, new Date(2020, 3, 1), new Date(2026, 9, 31));
  eq(g.years, 7, '6y 6m rounds up to 7'); eq(g.wages, 21000, 'basic + DA'); eq(g.accrued, Math.round(15 / 26 * 21000 * 7), 'gratuity'); eq(g.vested, true, 'vested');
  eq(payGratuity_(20000, 0.05, new Date(2023, 0, 1), new Date(2026, 9, 31)).payable, 0, 'not payable before 5 years');
  return 'payrollCalcSelfTest_ passed';
}

if (typeof module !== 'undefined') module.exports = { payCalc_: payCalc_, payGratuity_: payGratuity_, payrollCalcSelfTest_: payrollCalcSelfTest_, payLeaveConvert_: payLeaveConvert_, payLeaveSelfTest_: payLeaveSelfTest_ };
