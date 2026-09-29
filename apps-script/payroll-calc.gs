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
//   EPF           = 12% × MIN(Wages, EPF ceiling) if member AND entity registered;
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

// emp: {fullBasic, epfMember, rrfMember, tuition, doj (Date)}
// input: {paidDays, clDays, hold, otherEarnings, otherDeductions}
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
  const epf = emp.epfMember && rates.epfRegistered ? R(Math.min(wages, s.epfCeiling) * s.epfRate) : 0;
  const esiOn = rates.esiRegistered && wages <= s.esiThreshold;
  const esi = esiOn ? R(wages * s.esiEmpRate) : 0;
  const esiEr = esiOn ? R(wages * s.esiErRate) : 0;
  const clEnc = R((Number(input.clDays) || 0) * (wages - epf - esi) / s.clDivisor);
  const tuition = Number(emp.tuition) || 0;
  const otherEarnings = Number(input.otherEarnings) || 0;
  const gross = wages + clEnc + tuition + otherEarnings;
  const cti = gross + epf + esiEr;

  const months = payMonthsBetween_(emp.doj, ctx.monthEnd);
  const opening = Number(ctx.openingRrf) || 0;
  const target = s.rrfTargetMonths * cti;
  let rrfRate = 0;
  if (emp.rrfMember) {
    if (months < 12) rrfRate = s.rrfY1;
    else if (months < 24) rrfRate = s.rrfY2;
    else if (months < 36 || (s.rrfStopAtTarget && opening < target)) rrfRate = s.rrfY3;
  }
  let rrf = R(rrfRate * cti);
  if (rrfRate && s.rrfStopAtTarget) rrf = Math.min(rrf, Math.max(0, R(target - opening)));

  const otherDeductions = Number(input.otherDeductions) || 0;
  const totalDeductions = epf + esi + rrf + tuition + otherDeductions;
  const net = gross - totalDeductions;
  const hold = !!input.hold;
  return {
    paidDays: paidDays, serviceMonths: months, basic: basic, ada: ada, da: da, wages: wages,
    clEncashment: clEnc, tuitionA: tuition, otherEarnings: otherEarnings, gross: gross,
    epf: epf, esi: esi, rrfRate: rrfRate, rrf: rrf, tuitionD: tuition, otherDeductions: otherDeductions,
    totalDeductions: totalDeductions, net: net, bankPayable: hold ? 0 : net, heldForFnF: hold ? net : 0,
    epfEmployer: epf, esiEmployer: esiEr, cti: cti, gratuityProvision: R((basic + da) * s.gratRate),
    closingRrf: opening + rrf,
  };
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

  r = payCalc_(emp, { hold: true, clDays: 3 }, rates, S, ctx);
  eq(r.clEncashment, 1222, 'CL encashment = 3 × 12215 / 30');
  eq(r.bankPayable, 0, 'held salary not paid to bank'); eq(r.heldForFnF, r.net, 'held for F&F');
  return 'payrollCalcSelfTest_ passed';
}

if (typeof module !== 'undefined') module.exports = { payCalc_: payCalc_, payrollCalcSelfTest_: payrollCalcSelfTest_ };
