// Run: node tests/hiring/test-employee-code.js -- exercises hiring.gs's employee-code
// numbering/locking and the document check against stubbed sheets.
const vm = require('vm'), fs = require('fs'), assert = require('assert'), path = require('path');
const ctx = vm.createContext({
  console, Logger: { log() {} }, Session: { getScriptTimeZone: () => 'Asia/Kolkata' },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  Utilities: { formatDate: (d, tz, f) => '26/10' },
  PropertiesService: {}, APR_STATUS: { APPROVED: 'Approved', REJECTED: 'Rejected' },
  aprValues_: () => [[], ['x', 'LMS4', 'Salary Offer Approval', '', '', '', '', 'T-0943 — Preeti Sood']],
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../apps-script/hiring.gs'), 'utf8'), ctx);

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

// documents sheet: header + old complete row (9/24) + new partial row (10/3)
const hdr = ['Timestamp', 'Email', 'Employee Name', 'Employee ID', 'Job', 'BIODATA', 'HIRING SLIP', 'PAN CARD', 'AADHAR', 'CANCELLED CHEQUE', 'BACHELORS', 'POLICE VERIFICATION', 'MEDICAL CERTIFICATE'];
const full = ['d', 'd', 'd', 'd', 'd', 'd', 'd', 'd'];
const docVals = [hdr,
  [new Date('2026-09-24'), 'e', 'Preeti Sood', 'NCM/26/07/103', 'PRT', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x'],
  [new Date('2026-10-04'), 'e', ' preeti  SOOD', 'NCM/26/10/110', 'TGT', 'x', '', '', '', '', '', '', ''],
];
ctx.SpreadsheetApp = { openById: () => ({ getDataRange: () => ({ getValues: () => docVals }) }) };
T('docs: without a cutoff the old row makes it complete (the bug)', () => assert.strictEqual(ctx.hiringCheckDocuments_('LMS4', 'Preeti Sood').complete, true));
T('docs: cutoff ignores the pre-interview row', () => {
  const d = ctx.hiringCheckDocuments_('LMS4', 'Preeti Sood', { notBefore: new Date('2026-10-02') });
  assert.strictEqual(d.found, true); assert.strictEqual(d.complete, false);
  assert.ok(d.missing.indexOf('PAN Card') !== -1); assert.strictEqual(d.employeeId, 'NCM/26/10/110');
});
T('docs: nothing after cutoff -> not found', () => assert.strictEqual(ctx.hiringCheckDocuments_('LMS4', 'Preeti Sood', { notBefore: new Date('2026-11-01') }).found, false));

T('assign: incomplete docs -> expected code + missing list, nothing written', () => {
  ctx.hirRosterCodes_ = () => ['NCM/26/07/103'];
  const a = { status: 'Hiring Approved', applicantId: 'T-0943', row: 5, name: 'Preeti Sood', branches: 'LMS-4', interviewAt: '2026-10-03T10:00:00Z', employeeCode: '' };
  const s2 = fakeSheet([['h'], [], [], [], []], 16); ctx.hirSheet_ = () => s2;
  ctx.hirAssignEmployeeCodes_([a], []);
  assert.strictEqual(a.expectedEmployeeCode, 'NCM/26/10/104'); assert.ok(a.docsMissing.length > 0);
  assert.strictEqual(a.employeeCode, ''); assert.strictEqual(s2.rows[4][15], undefined);
});
T('assign: complete docs -> locked & written; Hired rows untouched', () => {
  docVals.push([new Date('2026-10-05'), 'e', 'Preeti Sood', 'NCM/26/10/104', 'TGT', 'x', 'x', 'x', 'x', 'x', 'x', 'x', 'x']);
  const a = { status: 'Hiring Approved', applicantId: 'T-0943', row: 5, name: 'Preeti Sood', branches: 'LMS-4', interviewAt: '2026-10-03T10:00:00Z', employeeCode: '' };
  const hired = { status: 'Hired', applicantId: 'T-0001', row: 3, name: 'Old Hire', branches: 'LMS-4', employeeCode: '' };
  const s3 = fakeSheet([['h'], [], [], [], []], 16); ctx.hirSheet_ = () => s3;
  ctx.hirAssignEmployeeCodes_([a, hired], []);
  assert.strictEqual(a.employeeCode, 'NCM/26/10/104'); assert.strictEqual(a.employeeCodePermanent, true);
  assert.strictEqual(s3.rows[4][15], 'NCM/26/10/104'); assert.strictEqual(hired.employeeCode, '');
});
console.log('ALL PASSED');
