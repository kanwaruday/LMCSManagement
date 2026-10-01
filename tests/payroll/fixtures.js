// Deterministic fake org for the payroll test suite. No real names, codes, bank
// details, or salaries -- this repo is public. Shapes match the real workbooks
// (apps-script/payroll.gs PAY_TABS, and the PayRoll Rates / Constants / JobRole
// Norms tabs in the Rates sheet) so the real backend code runs against it unmodified.
'use strict';

const RATES = [['School', 'DA %', 'ADA %', 'EPF Enrolled by Default', 'ESI Enrolled by Default'],
  ['HES', 5, 35, 'Y', 'Y'], ['LMS 1', 5, 35, 'Y', 'Y'], ['LMS 2', 5, 35, 'Y', 'Y'], ['LMS 3', 5, 25, 'Y', 'Y'],
  ['LMS 4', 5, 35, 'Y', 'Y'], ['LMS 5', 5, 35, 'Y', 'Y'], ['LMS 6', 5, 35, 'N', 'N']];

const CONSTS = [['Setting', 'Value'],
  ['RRF Y1 %', 12], ['RRF Y2 %', 9], ['RRF Y3 %', 6], ['EPF Cap Salary', 15000], ['EPF Rate %', 8.33],
  ['PF Rate %', 3.67], ['ESI Threshold', 21000], ['ESI Employer %', 3.25], ['ESI Employee %', 0.75]];

const JOBROLE_NORMS = [['Designation', 'Vacations', 'Casual Leave'],
  ['Helper', 'Half Vacation Working\nProbationer', '12 CL'],
  ['PRT', 'Full Vacation\nProbationer', '12 CL'],
  ['Driver Cum Peon', 'Half Vacation Working', '12 CL'],
  ['School Coordinator', 'Online if needed', 'NA']];

// Fake staff, code format <SCHOOL3>/<join-yy>/<join-mm>/<seq> like the real sheet.
// Covers: PRT (full vac), Helper (half vac), Peon Cum Driver (alias), an unmapped
// designation (Karate Teacher), EPF member/non-member, long tenure (RRF Y3 + gratuity-
// eligible), a probationer, LMS6 (unregistered EPF/ESI), and a Staff-Child Tuition case.
const STAFF = [
  { code: 'FOX/24/02/090', name: 'Staff One', entity: 'LMS 1', designation: 'PRT', doj: new Date(2024, 1, 15), basic: 12000, epf: 'Y', rrf: 'Y', tuition: 0 },
  { code: 'FOX/23/09/104', name: 'Staff Two', entity: 'LMS 1', designation: 'Helper', doj: new Date(2023, 8, 1), basic: 9000, epf: 'Y', rrf: 'Y', tuition: 0 },
  { code: 'OWL/24/01/050', name: 'Staff Three', entity: 'LMS 2', designation: 'Peon Cum Driver', doj: new Date(2024, 0, 10), basic: 10000, epf: 'Y', rrf: 'Y', tuition: 0 },
  { code: 'OWL/22/07/054', name: 'Staff Four', entity: 'LMS 3', designation: 'School Coordinator', doj: new Date(2022, 6, 1), basic: 14000, epf: 'Y', rrf: 'Y', tuition: 0 },
  { code: 'ELK/05/03/005', name: 'Staff Five', entity: 'HES', designation: 'PRT', doj: new Date(2005, 2, 1), basic: 20000, epf: 'Y', rrf: 'Y', tuition: 0 }, // 20+ yrs, gratuity-eligible
  { code: 'ELK/25/04/100', name: 'Staff Six', entity: 'HES', designation: 'Helper', doj: new Date(2025, 3, 1), basic: 8000, epf: 'Y', rrf: 'Y', tuition: 0 }, // probationer
  { code: 'ELK/24/02/090', name: 'Staff Seven', entity: 'LMS 4', designation: 'PRT', doj: new Date(2024, 1, 1), basic: 11000, epf: 'Y', rrf: 'Y', tuition: 0 },
  { code: 'JAY/19/07/014', name: 'Staff Eight', entity: 'LMS 5', designation: 'Helper', doj: new Date(2019, 6, 1), basic: 9500, epf: 'N', rrf: 'N', tuition: 0 }, // EPF non-member
  { code: 'JAY/21/03/020', name: 'Staff Nine', entity: 'LMS 6', designation: 'PRT', doj: new Date(2021, 2, 1), basic: 13000, epf: 'N', rrf: 'Y', tuition: 500 }, // LMS6 unregistered
  { code: 'JAY/20/05/030', name: 'Staff Ten', entity: 'LMS 3', designation: 'Karate Teacher', doj: new Date(2020, 4, 1), basic: 7000, epf: 'Y', rrf: 'Y', tuition: 0 }, // unmapped designation
];

function salaryMasterRows() {
  return [
    ['Employee Code', 'Name', 'Entity', 'Designation', 'Date of Joining', 'Effective From', 'Full Basic',
      'EPF Member (Y/N)', 'RRF Member (Y/N)', 'Staff-Child Tuition', 'Pay Mode', 'Bank Account No', 'IFSC', 'UAN', 'PAN',
      'Status (Active/Left)', 'Remarks', 'Last Working Day', 'Monthly TDS (₹)'],
    ...STAFF.map((s) => [s.code, s.name, s.entity, s.designation, s.doj, s.doj, s.basic, s.epf, s.rrf, s.tuition,
      'Bank', '000011112222', 'TEST0000001', 'UAN' + s.code.replace(/\W/g, ''), 'TESTP0000F', 'Active', '', '', '']),
  ];
}

// Returns a fresh fixture: { books, tokens, clientId }. The payroll sheet starts
// with only the Salary Master populated (new tabs appear via payEnsureTabs_,
// exactly like the real "live sheet, old layout" case).
function buildFixture() {
  // Must match PAY_GOOGLE_CLIENT_ID in apps-script/payroll.gs -- the fake tokeninfo
  // response's `aud` is checked against the real constant, not a fixture value.
  const clientId = '697999989724-mvi85iobr20g4mm8a8nrjd1rms2o8tf6.apps.googleusercontent.com';
  return {
    clientId,
    tokens: { 'owner-token': 'owner@test.lms', 'principal-token': 'principal@test.lms', 'bad-token': null },
    books: {
      '1sal': { 'Salary Master': salaryMasterRows() },
      '1d8': { 'PayRoll Rates': RATES, 'PayRoll Constants': CONSTS, 'JobRole Norms': JOBROLE_NORMS },
      '1NZ': { Allowlist: [['Email', 'Name', 'Role', 'Roles'], ['owner@test.lms', 'Test Owner', 'Owner', 'Owner'], ['principal@test.lms', 'Test Principal', 'Principal', 'Principal']] },
      '1Oj': { EmpMaster: [['EmployeeCode', 'Name', 'SchoolCode', 'DateOfJoining', 'Status', 'DoRel']], EmpSalary: [['EmployeeCode', 'Designation', 'Increment']] },
      '1Tr': { Approvals: [['ID', 'x', 'Category', 'a', 'b', 'c', 'd', 'Item', 'e', 'f', 'g', 'h', 'i', 'Status']] },
    },
  };
}

module.exports = { buildFixture, STAFF };
