// startHire_: the Principal's "Start Hiring Process" -- adds the applicant's locked code to the roster, once, in their own school only.
// Usage: node tests/staff/test-start-hire.js
const vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '../../apps-script/staff-management-api.gs'), 'utf8');
const body = src.slice(src.indexOf('function startHire_'), src.indexOf('function addNewHire_'));
const sheetRows = { 5: { 2: 'Preeti Sood', 16: 'KEL/99/11/132', 17: '2026-11-02' }, 6: { 2: 'No Code', 16: '', 17: '2026-11-02' } };
const added = [], master = {};
const ctx = vm.createContext({
  HIR_EMP_CODE_COL_: 16,
  Utilities: { formatDate: () => '' },
  hirTeachingApplicantsSheet_: () => ({ getRange: (r, c) => ({ getValue: () => (sheetRows[r] || {})[c] || '' }) }),
  empMasterHasCode_: (c) => !!master[c],
  assertScope_: (caller, schools) => { if (caller.campusId !== 'ALL' && schools.some((s) => s !== caller.campusId)) throw new Error('own campus only'); },
  addNewHire_: (d) => { added.push(d); master[d.applicantId === 'T-0005' ? 'KEL/99/11/132' : 'x'] = true; return { employeeCode: 'KEL/99/11/132' }; },
});
vm.runInContext(body, ctx);
const principal = { campusId: 'LMS2' };
assert.strictEqual(ctx.startHire_({ applicantId: 'T-0005', school: 'LMS2', role: 'PRT: English' }, principal).employeeCode, 'KEL/99/11/132');
assert.deepStrictEqual(JSON.parse(JSON.stringify(added[0])), { applicantId: 'T-0005', name: 'Preeti Sood', dateOfJoining: '2026-11-02', school: 'LMS2', role: 'PRT: English', reportsTo: '', classSubjects: [] });
assert.strictEqual(ctx.startHire_({ applicantId: 'T-0005', school: 'LMS2' }, principal).alreadyAdded, true);   // idempotent
assert.strictEqual(added.length, 1);
assert.throws(() => ctx.startHire_({ applicantId: 'T-0005', school: 'LMS4' }, principal), /own campus/);       // another school
assert.throws(() => ctx.startHire_({ applicantId: 'T-0006', school: 'LMS2' }, principal), /No employee code is locked/);
console.log('start hire: ok');
