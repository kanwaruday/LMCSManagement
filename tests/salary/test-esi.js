// Run: node tests/salary/test-esi.js -- the Salary Dashboard offer calculator (salary/index.html calcSalary_)
// works out ESI exactly as monthly payroll does (apps-script/payroll-calc.gs payCalc_, Oct 2026 rule:
// Basic + DA, coverage on the same wage, rounded up, tuition never counts), and EPF stays on Basic + ADA + DA.
// Fake figures only (tests/payroll/fixtures.js basics and the payroll self-test's): this repo is public.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { payCalc_ } = require('../../apps-script/payroll-calc.gs');
const { STAFF } = require('../payroll/fixtures.js');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'salary', 'index.html'), 'utf8');
const grab = (start) => { const i = html.indexOf(start); assert(i >= 0, start); return html.slice(i, html.indexOf('\n}\n', i) + 2); };
const RATES = { 'LMS 1': { da: 0.05, ada: 0.35 }, 'LMS 3': { da: 0.05, ada: 0.25 } };

// one page context; each call sets the form fields and reruns calcSalary_
const f = {};
const ctx = vm.createContext({ CONFIG: { constants: {}, payrollRates: RATES }, EPF_EXEMPTION_APPROVED: false, f,
  document: { getElementById: (id) => ({ value: f[id], checked: f[id] }) } });
vm.runInContext(html.match(/const DEFAULT_C = \{[\s\S]*?\};/)[0] + grab('function cVal_(') + grab('function calcSalary_(') + ';this.calc = calcSalary_;', ctx);
function offer(basic, campus, opts) {
  const o = Object.assign({ esi: true, tuiFee: 0 }, opts);
  Object.assign(f, { fExisting: true, fCampus: campus, fLmsExp: 0, fOtherExp: 0, fPreBasic: basic, fGradePay: 0, fIdealHours: 1, fWorkHours: '',
    fEpf: true, fEsi: o.esi, fMdExempt: false, fTuiFee: o.tuiFee });
  return ctx.calc();
}

// payroll for a full October month on the same Full Basic and school rates
const S = { epfRate: 0.12, epfCeiling: 25000, esiEmpRate: 0.0075, esiErRate: 0.0325, esiThreshold: 21000,
  rrfY1: 0.12, rrfY2: 0.09, rrfY3: 0.06, rrfTargetMonths: 3, rrfStopAtTarget: false, gratRate: 0.05, clDivisor: 30 };
const pay = (basic, campus) => payCalc_({ fullBasic: basic, epfMember: true, rrfMember: true, tuition: 0, doj: new Date(2026, 0, 1) }, {},
  Object.assign({ epfRegistered: true, esiRegistered: true }, RATES[campus]), S, { monthEnd: new Date(2026, 9, 31), daysInMonth: 31, openingRrf: 0 });

// every fixture basic on an ESI-registered school: same ESI wage, coverage, employee and employer ESI as payroll
for (const st of STAFF.filter((x) => x.entity !== 'LMS 6')) {
  const campus = st.entity === 'LMS 3' ? 'LMS 3' : 'LMS 1';
  const o = offer(st.basic, campus), p = pay(st.basic, campus);
  assert.deepStrictEqual([o.esiWages, o.esiEe, o.esiE], [p.esiWages, p.esi, p.esiEmployer], st.code + ' matches payroll');
}
console.log('ok  - offer ESI matches payroll-calc.gs on every fixture basic');

// sweep (G2's): every basic 3,000-30,000 on both rate sets -- DA, ADA, ESI wage, coverage and ESI all equal payroll's
let diffs = 0;
for (const campus of Object.keys(RATES)) for (let b = 3000; b <= 30000; b++) {
  const o = offer(b, campus), p = pay(b, campus);
  if (o.da !== p.da || o.ada !== p.ada || o.esiWages !== p.esiWages || o.esiAllowed !== p.esi > 0 || o.esiEe !== p.esi || o.esiE !== p.esiEmployer) diffs++;
}
assert.strictEqual(diffs, 0, 'offer vs payroll differences over the sweep');
console.log('ok  - sweep: 54,002 basics x rate sets, 0 differences from payCalc_');

// covered: Basic + DA = 21000 is at the threshold (Basic + ADA + DA = 28000 would have been out)
let o = offer(20000, 'LMS 1');
assert.deepStrictEqual([o.esiAllowed, o.esiWages, o.esiEe, o.esiE], [true, 21000, 158, 683], 'covered at the threshold');
console.log('ok  - covered on Basic + DA <= 21000, ESI rounded up');

// not covered: Basic + DA over the threshold
o = offer(20500, 'LMS 1');
assert.deepStrictEqual([o.esiAllowed, o.esiEe, o.esiE], [false, 0, 0], 'not covered');
assert.strictEqual(pay(20500, 'LMS 1').esi, 0, 'payroll agrees');
console.log('ok  - not covered above the threshold');

// EPF unchanged: still on Basic + ADA + DA
o = offer(10000, 'LMS 1');
assert.deepStrictEqual([o.ns, o.epfE, o.pfE], [14000, Math.floor(14000 * 0.0833), Math.floor(14000 * 0.0367)], 'EPF on Basic + ADA + DA');
console.log('ok  - EPF stays on Basic + ADA + DA');

// tuition allowance never enters the ESI wage
o = offer(10000, 'LMS 1', { tuiFee: 8000 });
assert.deepStrictEqual([o.esiWages, o.esiEe], [10500, 79], 'tuition out of ESI');
console.log('ok  - child tuition allowance does not count toward ESI');

// ESI box unticked: none
o = offer(10000, 'LMS 1', { esi: false });
assert.deepStrictEqual([o.esiEe, o.esiE], [0, 0], 'ESI off');
console.log('ok  - ESI not applicable when unticked');
