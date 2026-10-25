// Run: node tests/hiring/test-employee-code.js -- exercises hiring.gs's employee-code
// numbering/locking and the document check against stubbed sheets.
const vm = require('vm'), fs = require('fs'), assert = require('assert'), path = require('path');
const ctx = vm.createContext({
  console, Logger: { log(m) { if (process.env.DBG) console.log('LOG', m); } }, Session: { getScriptTimeZone: () => 'Asia/Kolkata' },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  Utilities: { formatDate: (d, tz, f) => '26/10' },
  PropertiesService: {}, APR_STATUS: { APPROVED: 'Approved', REJECTED: 'Rejected' },
  aprValues_: () => [[], ['x', 'LMS4', 'Salary Offer Approval', '', '', '', '', 'T-0943 — Preeti Sood']],
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../apps-script/hiring.gs'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../apps-script/hiring-appointments.gs'), 'utf8'), ctx);
const realAssign = ctx.hirAssignEmployeeCodes_; // a later test stubs it on ctx
ctx.apptAll_ = () => [];

function fakeSheet(rows, maxCols) {            // rows: 2D, 1-based accessors
  return {
    rows, getMaxColumns: () => maxCols, insertColumnsAfter(n, k) { maxCols += k; },
    getLastRow: () => rows.length,
    getRange(r, c, nr, nc) {
      return {
        getValue: () => (rows[r - 1] || [])[c - 1] || '',
        setValue(v) { rows[r - 1] = rows[r - 1] || []; rows[r - 1][c - 1] = v; },
        getValues: () => { const out = []; for (let i = 0; i < nr; i++) out.push([(rows[r - 1 + i] || [])[c - 1] || '']); return out; },
      };
    },
  };
}
const T = (name, fn) => { fn(); console.log('ok  -', name); };

T('next seq counts roster + locked, per prefix', () => {
  assert.strictEqual(ctx.hirNextSeq_('NCM', [['NCM/26/07/103', 'KEL/22/03/086'], ['NCM/26/10/110']]), 111);
  assert.strictEqual(ctx.hirNextSeq_('SAY', [['NCM/26/07/103']]), 1);
});
T('new code format', () => assert.strictEqual(ctx.hirNewCode_('NCM', [['NCM/26/07/103']]), 'NCM/26/10/104'));

const sheet = fakeSheet([['hdr'], [], [], []], 15);
ctx.hirSheet_ = () => sheet;
T('lock uses a valid preferred code and grows the grid', () => {
  const r = ctx.hirLockEmployeeCode_(sheet, 2, 'NCM', 'ncm/26/10/110', ['NCM/26/07/103']);
  assert.strictEqual(JSON.stringify(r), JSON.stringify({ code: 'NCM/26/10/110', note: '' }));
  assert.strictEqual(sheet.rows[1][15], 'NCM/26/10/110');
  assert.strictEqual(sheet.getMaxColumns(), 16);
  assert.strictEqual(sheet.rows[0][15], 'Employee Code (locked)');
});
T('lock is permanent (second call returns the same)', () => {
  assert.strictEqual(ctx.hirLockEmployeeCode_(sheet, 2, 'NCM', 'NCM/26/10/999', []).code, 'NCM/26/10/110');
});
T('preferred already used -> next free + note', () => {
  const r = ctx.hirLockEmployeeCode_(sheet, 3, 'NCM', 'NCM/26/10/110', ['NCM/26/07/103']);
  assert.strictEqual(r.code, 'NCM/26/10/111'); assert.ok(/already in use/.test(r.note));
});
T('garbage preferred -> next free + note', () => {
  const r = ctx.hirLockEmployeeCode_(sheet, 4, 'NCM', 'abcd', ['NCM/26/07/103']);
  assert.strictEqual(r.code, 'NCM/26/10/112'); assert.ok(/not a valid NCM code/.test(r.note));
});

ctx.hirRosterCodes_ = () => ['NCM/26/07/103'];
T('assign: no joining date -> no code offered', () => {
  const a = { status: 'Hiring Approved', applicantId: 'T-0943', row: 5, name: 'Preeti Sood', branches: 'LMS-4', interviewAt: '2026-10-03T10:00:00Z', employeeCode: '', dateOfJoining: '' };
  ctx.hirAssignEmployeeCodes_([a], []);
  assert.strictEqual(a.expectedEmployeeCode, undefined);
});
T('assign: joining date sets YY/MM of the code', () => {
  const a = { status: 'Hiring Approved', applicantId: 'T-0943', row: 5, name: 'Preeti Sood', branches: 'LMS-4', interviewAt: '2026-10-03T10:00:00Z', employeeCode: '', dateOfJoining: '2027-01-05' };
  ctx.hirAssignEmployeeCodes_([a], []);
  assert.strictEqual(a.expectedEmployeeCode, 'NCM/27/01/104');
});

// Mapping Audit (2026-10-13): subject-less requisitions are role-aware.
T('NTT requisition matches "MW to C-2" but not a plain English applicant', () => {
  const m = ctx.HIR_ROLE_DEFAULT_SUBJECTS || vm.runInContext('HIR_ROLE_DEFAULT_SUBJECTS', ctx);
  assert.strictEqual(ctx.hirSubjectsMatch_(m.NTT, 'MW to C-2, English'), true);
  assert.strictEqual(ctx.hirSubjectsMatch_(m.NTT, 'English, Maths'), false);
  assert.strictEqual(ctx.hirSubjectsMatch_(m.LIBRARIAN, 'Librarian'), true);
  assert.strictEqual(ctx.hirSubjectsMatch_(m.LIBRARIAN, 'English'), false);
  assert.strictEqual(ctx.hirSubjectsMatch_(m.ACTIVITY, 'Music'), true);
});
T('Mother Teacher C-1 & 2 requisition matches MW to C-2 applicants (not English-only); NTT matches them too', () => {
  assert.strictEqual(ctx.hirSubjectsMatch_('Mother Teacher C-1 & 2', 'MW to C-2, English'), true);
  assert.strictEqual(ctx.hirSubjectsMatch_('Mother Teacher C-1 & 2', 'English, Maths'), false);
  assert.strictEqual(ctx.hirSubjectsMatch_('English, Mother Teacher C-1 & 2', 'English'), true);
  assert.strictEqual(ctx.hirSubjectsMatch_('NTT, MW to C-2', 'MW to C-2'), true);
});
T('position label matches the dashboard role (campus + role + subjects)', () => {
  assert.strictEqual(ctx.hirPositionLabel_('LMS4', { roleLevel: 'PRT', subjects: 'Mother Teacher C-1 & 2' }), 'LMS 4 - PRT: Mother Teacher C-1 & 2');
  assert.strictEqual(ctx.hirPositionLabel_('LMS1', { roleLevel: 'LIBRARIAN', subjects: '' }), 'LMS 1 - LIBRARIAN');
});
T('hiringApplicants_: a position picked on the report form wins over subject mismatch', () => {
  const hdr = ['ts', 'Name', 'Phone', 'Age', 'Subjects', 'Branches', 'Qual', 'BEd', 'G', 'CV', 'Status', 'Notes', 'IntAt'];
  const rows = [hdr, [new Date(), 'Simar', '7876160890', '', 'MW to C-2', 'LMS-4', 'Bachelors', 'No', '', '', '', '', '']];
  ctx.hirSheet_ = () => ({ getDataRange: () => ({ getValues: () => rows }) });
  ctx.hirAutoBackfillWalkIns_ = () => {};
  ctx.hirSalaryOfferDecisions_ = () => ({});
  ctx.hirAssignEmployeeCodes_ = () => {};
  ctx.hirApprovedRequisitions_ = () => ({ LMS4: [{ subjects: 'English', matchSubjects: 'English', roleLevel: 'TGT', openings: null }] });
  ctx.hirPortalReports_ = () => [];
  // Interview Report form rows: timestamp, name, phone, branch, subject, remarks, pdf, position.
  const ir = (pos) => { ctx.hirIrSheet_ = () => ({ getDataRange: () => ({ getValues: () => [['ts', 'n', 'p', 'b', 's', 'r', 'pdf', 'Position interviewed for'], [new Date(), 'Simar', '7876160890', 'LMS 4', '', '', '', pos]] }) }); };
  ir('LMS 4 - TGT: English');
  let res = ctx.hiringApplicants_({ campusId: 'ALL' });
  assert.strictEqual(res.applicants.length, 1);
  assert.deepStrictEqual(Array.from(res.applicants[0].matchedRoleKeys), ['LMS4|TGT|English']);
  ir('Not for any open role');
  res = ctx.hiringApplicants_({ campusId: 'ALL' });
  // 2026-10-22: an interviewed candidate stays visible (in progress), just under no role chip --
  // MW to C-2 alone matches no English requisition.
  assert.strictEqual(res.applicants.length, 1);
  assert.strictEqual(res.applicants[0].matchedRoleKeys.length, 0); assert.strictEqual(res.applicants[0].noOpenRole, true);
});

// ── Documents from the portal, by employee code (2026-10-25) ─────────────────────────────────────────────
const docRows = [['Uploaded On', 'Employee Code', 'Employee Name', 'School', 'Document Type', 'Drive Link', 'Uploaded By', 'Source', 'ID Check'],
  ['d', 'NCM/26/10/104', 'Preeti Sood', 'LMS4', 'BIODATA + PROFICIENCY', 'https://drive/x', 'c', 'Portal', ''],
  ['d', 'ncm/26/10/9', 'Other', 'LMS4', 'BIODATA + PROFICIENCY', 'https://drive/y', 'c', 'Form', ''],
  ['d', 'NCM/26/10/105', 'No link', 'LMS4', 'BIODATA + PROFICIENCY', '', 'c', 'Portal', ''],
  ['d', 'NCM/26/10/106', 'PAN only', 'LMS4', 'PAN CARD', 'https://drive/z', 'c', 'Portal', '']];
ctx.SpreadsheetApp = { openById: () => ({ getSheetByName: (n) => (n === 'Documents' ? { getDataRange: () => ({ getValues: () => docRows }) } : null) }) };
T('portal docs: Bio-Data is found by employee code, padded/lower-case codes match, a row with no link does not count', () => {
  assert.strictEqual(ctx.hirBioDataOnFile_('NCM/26/10/104'), true);
  assert.strictEqual(ctx.hirBioDataOnFile_('NCM/26/10/009'), true);   // typed ncm/26/10/9 on the form
  assert.strictEqual(ctx.hirBioDataOnFile_('NCM/26/10/105'), false);  // no Drive link
  assert.strictEqual(ctx.hirBioDataOnFile_('NCM/26/10/106'), false);  // PAN is not Bio-Data
  assert.strictEqual(ctx.hirBioDataOnFile_('NCM/26/10/999'), false);
});
T('assign: a started hire with no Bio-Data shows it as the one missing document; with it, complete', () => {
  const base = { status: 'Hiring Approved', applicantId: 'T-0943', row: 5, branches: 'LMS-4', hiringStartedAt: '2026-10-25T05:00:00Z', dateOfJoining: '2026-11-02' };
  const missing = Object.assign({}, base, { employeeCode: 'NCM/26/10/105' }), ok = Object.assign({}, base, { employeeCode: 'NCM/26/10/104' });
  realAssign([missing, ok], []);
  assert.strictEqual(JSON.stringify(missing.docsMissing), '["Bio-Data"]'); assert.strictEqual(missing.docsComplete, false);
  assert.strictEqual(JSON.stringify(ok.docsMissing), '[]'); assert.strictEqual(ok.docsComplete, true);
});
T('assign: an applicant whose hiring has not started gets no document list (nothing to chase yet)', () => {
  const a = { status: 'Hiring Approved', applicantId: 'T-0943', row: 5, branches: 'LMS-4', employeeCode: '', dateOfJoining: '2026-11-02' };
  realAssign([a], []);
  assert.strictEqual(a.docsMissing, undefined); assert.strictEqual(a.expectedEmployeeCode, 'NCM/26/11/104');
});
