// Run: TZ=Asia/Kolkata node tests/hiring/test-upload.js -- hiringuploadreport (a scanned report + its typed
// contents, Fee Clerk or elevated) and hiringconfirmreject (a Principal confirms a clerk's "reject").
const vm = require('vm'), fs = require('fs'), assert = require('assert'), path = require('path');
// The script lock is not re-entrant in Apps Script: this fake throws if anything takes it while it is held.
let held = false, props = {};
// Utilities.base64Decode returns SIGNED bytes (Java byte[]): 0xFF comes back as -1.
const signed = (b64) => Array.from(Buffer.from(b64, 'base64'), (b) => (b > 127 ? b - 256 : b));
let drive;
function fakeDrive() {
  const folders = {};
  const folder = (id, name) => (folders[id] = { id, name, files: [], subs: {},
    getId: () => id,
    getFoldersByName(n) { const f = this.subs[n]; let done = !f; return { hasNext: () => !done, next() { done = true; return f; } }; },
    createFolder(n) { return (this.subs[n] = folder(id + '/' + n, n)); },
    createFile(blob) {
      const file = { blob, sharing: null, trashed: false, setTrashed(v) { this.trashed = v; }, getName: () => blob.name, getUrl: () => 'https://drive.google.com/file/d/' + blob.name + '/view',
        setSharing(a, p) { this.sharing = [a, p]; return this; } };
      this.files.push(file); return file;
    } });
  return { folders, root: folder('root1', 'Hiring scans'),
    api: { Access: { DOMAIN_WITH_LINK: 'DOMAIN_WITH_LINK' }, Permission: { VIEW: 'VIEW' },
      getFolderById: (id) => { if (!folders[id]) throw new Error('no folder ' + id); return folders[id]; },
      createFolder: (n) => folder('new-' + n, n) } };
}
const ctx = vm.createContext({
  console, Logger: { log() {} }, Session: { getScriptTimeZone: () => 'Asia/Kolkata' },
  Utilities: {
    base64Decode: signed,
    newBlob: (bytes, mime, name) => ({ bytes, mime, name }),
    formatDate: (d, tz, fmt) => { assert.strictEqual(fmt, 'yyyy-MM-dd'); return new Date(d).toLocaleDateString('en-CA', { timeZone: tz }); },
  },
  APR_STATUS: { APPROVED: 'Approved', REJECTED: 'Rejected' },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (props[k] === undefined ? null : props[k]), setProperty: (k, v) => { props[k] = v; } }) },
  LockService: { getScriptLock: () => ({
    waitLock() { if (held) throw new Error('lock taken while held (nested lock)'); held = true; },
    tryLock() { if (held) throw new Error('lock taken while held (nested lock)'); held = true; return true; },
    releaseLock() { held = false; } }) },
});
['hiring.gs', 'hiring-appointments.gs'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '../../apps-script', f), 'utf8'), ctx));
const C = vm.runInContext('HIR_COL', ctx);
const T = (name, fn) => { held = false; fn(); assert.strictEqual(held, false, 'lock left held'); console.log('ok  -', name); };
const throws = (fn, re) => assert.throws(fn, (e) => re.test(e.message), String(re));

function sheet(rows) {
  let maxCols = Math.max(25, ...rows.map((r) => r.length));
  const s = {
    rows, getLastRow: () => rows.length, getMaxColumns: () => maxCols, insertColumnsAfter(n, k) { maxCols += k; },
    appendRow(r) { rows.push(r.slice()); },
    getDataRange: () => ({ getValues: () => rows.map((r) => r.slice()) }),
    getRange(r, c) {
      if (c > maxCols) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
      const rng = {
        getValue: () => ((rows[r - 1] || [])[c - 1] === undefined ? '' : rows[r - 1][c - 1]),
        setValue(v) { while (rows.length < r) rows.push([]); rows[r - 1][c - 1] = v; return rng; },
        setValues(vals) { vals.forEach((vr, i) => vr.forEach((v, j) => { while (rows.length < r + i) rows.push([]); rows[r - 1 + i][c - 1 + j] = v; })); return rng; },
        setNumberFormat() { return rng; }, setFontWeight() { return rng; },
      };
      return rng;
    },
  };
  return s;
}
const day = (n) => new Date(Date.UTC(2026, 9, 22 + n, 5, 0));
const FUTURE = '2030-01-10T10:30';
function appRow(o) {
  const r = new Array(25).fill('');
  r[C.TIMESTAMP - 1] = day(-10); r[C.NAME - 1] = 'Asha'; r[C.PHONE - 1] = '9876543210';
  r[C.SUBJECTS - 1] = 'English'; r[C.BRANCHES - 1] = 'LMS-4';
  Object.keys(o).forEach((k) => { if (C[k] !== undefined) r[C[k] - 1] = o[k]; });
  return r;
}
let apps, tabs, lockedDuringList;
function reset(rows) {
  apps = sheet([['Timestamp']].concat(rows));
  tabs = {};
  ctx.hirSheet_ = () => apps;
  ctx.hirIrSheet_ = () => sheet([['h']]);
  ctx.hirWorkbook_ = () => ({ getSheetByName: (n) => tabs[n] || null, insertSheet: (n) => (tabs[n] = sheet([])) });
  ctx.hiringApplicants_ = () => { lockedDuringList = held; return { success: true, applicants: [] }; };
  ctx.hirSalaryOfferDecisions_ = () => ({});
  ctx.APPT_CAL_ = { insert: () => ({ id: 'ev1' }), remove() {} };
  drive = fakeDrive(); ctx.DriveApp = drive.api;
  props = { HIR_SCAN_FOLDER_ID: 'root1' };
  lockedDuringList = null;
}
const principal = { email: 'p@lms.org.in', campusId: 'LMS4', roles: ['Principal'] };
const clerk = { email: 'c@lms.org.in', campusId: 'LMS4', roles: ['FeeClerk'] };
const SL = { SHORTLISTED_AT: day(-1), SHORTLISTED_BY: 'p@lms.org.in' };
const MARKED = JSON.stringify({ interview: { at: day(-1).toISOString(), by: 'p@lms.org.in' } });
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const PDF = { name: 'scan.pdf', mime: 'application/pdf', base64: b64([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]) };
const JPG = { name: 'scan.jpg', mime: 'image/jpeg', base64: b64([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]) };
const PNG = { name: 'scan.png', mime: 'image/png', base64: b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]) };
const interview = (o) => Object.assign({ row: 2, kind: 'interview', file: PDF, interviewDate: '2026-10-23', position: 'LMS 4 - TGT: English',
  confidence: 4, english: 3, capability: { English: { C6: 4 } }, recommendation: 'proceed' }, o);
const demo = (o) => Object.assign({ row: 2, kind: 'demo', file: JPG, demoDate: '2026-10-24', class: '6', subject: 'English',
  scores: { pedagogy: 4, content: 4, interaction: 3, response: 4, management: 3, clarity: 5, relatable: 4, aids: 3 }, studentFeedback: 4,
  recommendation: 'proceed' }, o);
const reports = (tab) => ctx.hirPortalReports_(tab);
const PI = vm.runInContext('HIR_PI_TAB', ctx), PD = vm.runInContext('HIR_PD_TAB', ctx);
const appts = () => ctx.apptAll_();
const REJ = { recommendation: 'reject', rejectReason: 'Salary expectation too high' };

T('a JPEG with signed FF D8 FF passes (the fake decoder really returns -1,-40,-1)', () => {
  assert.deepStrictEqual(signed(JPG.base64).slice(0, 3), [-1, -40, -1]);
  reset([appRow(SL)]);
  ctx.hiringUploadReport_(clerk, interview({ file: JPG }));
  assert.ok(/\.jpg$/.test(drive.root.subs.LMS4.files[0].getName()));
  reset([appRow(SL)]);
  ctx.hiringUploadReport_(clerk, interview({ file: PNG }));
  assert.ok(/\.png$/.test(drive.root.subs.LMS4.files[0].getName()));
});
T('a text file fails "PDF, JPG or PNG"; nothing is saved', () => {
  reset([appRow(SL)]);
  throws(() => ctx.hiringUploadReport_(clerk, interview({ file: { name: 'a.pdf', mime: 'application/pdf', base64: b64(Buffer.from('hello world')) } })), /PDF, JPG or PNG/);
  throws(() => ctx.hiringUploadReport_(clerk, interview({ file: null })), /PDF, JPG or PNG/);
  assert.strictEqual(reports(PI).length, 0); assert.strictEqual(drive.root.subs.LMS4, undefined);
});
T('7 MB is fine, 7 MB + 1 byte fails', () => {
  const big = (n) => { const b = Buffer.alloc(n); b.set([0x25, 0x50, 0x44, 0x46]); return { name: 'big.pdf', mime: 'application/pdf', base64: b.toString('base64') }; };
  reset([appRow(SL)]);
  throws(() => ctx.hiringUploadReport_(clerk, interview({ file: big(7 * 1024 * 1024 + 1) })), /7 MB/);
  assert.strictEqual(reports(PI).length, 0);
  ctx.hiringUploadReport_(clerk, interview({ file: big(7 * 1024 * 1024) }));
  assert.strictEqual(reports(PI).length, 1);
});
T('a clerk with confidence 0 throws "1 to 5"; with no capability score, refused too', () => {
  reset([appRow(SL)]);
  throws(() => ctx.hiringUploadReport_(clerk, interview({ confidence: 0 })), /1 to 5/);
  throws(() => ctx.hiringUploadReport_(clerk, interview({ capability: {} })), /at least one capability score/);
  throws(() => ctx.hiringUploadReport_(clerk, demo({ studentFeedback: 6 })), /1 to 5/);
  throws(() => ctx.hiringUploadReport_(clerk, interview({ kind: 'md' })), /interview or demo/);
  assert.strictEqual(reports(PI).length, 0);
});
T('a clerk proceed -> saved with a scan link, role FeeClerk, counts as evidence; list built outside the lock', () => {
  reset([appRow(SL)]);
  ctx.hiringUploadReport_(clerk, interview());
  assert.strictEqual(lockedDuringList, false);
  const rep = reports(PI)[0];
  assert.ok(/^https:\/\/drive\.google\.com\//.test(rep['Scan Link']));
  assert.strictEqual(rep['Entered By Role'], 'clerk'); assert.strictEqual(rep['Submitted By'], 'c@lms.org.in');
  assert.strictEqual(rep['Recommendation'], 'proceed'); assert.strictEqual(rep['Confidence'], 4);
  assert.strictEqual(tabs[PI].rows[0].slice(-2).join('|'), 'Scan Link|Entered By Role');
  assert.strictEqual(ctx.hirRowEvidence_(apps, 2, '9876543210').interview, true);
  assert.deepStrictEqual(drive.root.subs.LMS4.files[0].sharing, ['DOMAIN_WITH_LINK', 'VIEW']);
});
T('the file is named "T-0002 Asha interview 2026-10-23.pdf" in the LMS4 subfolder (created once)', () => {
  reset([appRow(SL)]);
  ctx.hiringUploadReport_(clerk, interview());
  ctx.hiringUploadReport_(clerk, interview());
  assert.deepStrictEqual(Object.keys(drive.root.subs), ['LMS4']);
  assert.strictEqual(drive.root.subs.LMS4.files[0].getName(), 'T-0002 Asha interview 2026-10-23.pdf');
  assert.strictEqual(drive.root.subs.LMS4.files.length, 2);
  assert.strictEqual(drive.root.subs.LMS4.files[0].blob.mime, 'application/pdf');
});
T('no scans folder configured -> a clear error, nothing saved', () => {
  reset([appRow(SL)]); props = {};
  throws(() => ctx.hiringUploadReport_(clerk, interview()), /hirSetupScans/);
  assert.strictEqual(reports(PI).length, 0);
});
T('an existing report tab grows its header row on first write', () => {
  reset([appRow(SL)]);
  const old = Array.from(vm.runInContext('HIR_PI_HEADERS', ctx)).slice(0, -2);
  tabs[PI] = sheet([old.slice()]);
  ctx.hiringUploadReport_(clerk, interview());
  assert.strictEqual(tabs[PI].rows[0].length, old.length + 2);
  assert.strictEqual(reports(PI)[0]['Entered By Role'], 'clerk');
});
T('a clerk reject -> status unchanged and rejectPending set (no reject, no cancels)', () => {
  reset([appRow(SL)]);
  ctx.hiringUploadReport_(clerk, interview(REJ));
  assert.strictEqual(apps.rows[1][C.STATUS - 1], '');
  const m = JSON.parse(apps.rows[1][C.STAGE_MARKS - 1]);
  assert.strictEqual(m.rejectPending.reason, 'Salary expectation too high'); assert.strictEqual(m.rejectPending.by, 'c@lms.org.in');
  assert.strictEqual(m.rejectPending.kind, 'interview');
  throws(() => ctx.hiringUploadReport_(clerk, interview({ recommendation: 'reject', rejectReason: 'Other' })), /note/);
});
T('a clerk "another" + next time -> a proposed demo, DEMO_AT unchanged', () => {
  reset([appRow(Object.assign({ STAGE_MARKS: MARKED }, SL))]);
  ctx.hiringUploadReport_(clerk, demo({ recommendation: 'another', nextDemoAt: FUTURE }));
  const a = appts();
  assert.strictEqual(a.length, 1); assert.strictEqual(a[0].status, 'proposed'); assert.strictEqual(a[0].kind, 'demo');
  assert.strictEqual(apps.rows[1][C.DEMO_AT - 1], '');
  assert.strictEqual(reports(PD)[0]['Recommendation'], 'another');
  assert.strictEqual(drive.root.subs.LMS4.files[0].getName(), 'T-0002 Asha demo 2026-10-24.jpg');
});
T('a Principal upload: reject rejects, "another" books the demo directly', () => {
  reset([appRow(SL)]);
  ctx.hiringUploadReport_(principal, interview(REJ));
  assert.strictEqual(apps.rows[1][C.STATUS - 1], 'Rejected');
  assert.strictEqual(reports(PI)[0]['Entered By Role'], 'principal');
  reset([appRow(Object.assign({ STAGE_MARKS: MARKED }, SL))]);
  ctx.hiringUploadReport_(principal, demo({ recommendation: 'another', nextDemoAt: FUTURE }));
  assert.strictEqual(appts()[0].status, 'accepted');
  assert.strictEqual(apps.rows[1][C.DEMO_AT - 1].getTime(), new Date(FUTURE).getTime());
});
T('a walk-in without a shortlist -> a clerk may still upload its interview report', () => {
  reset([appRow({ SOURCE: 'Walk-in' })]);
  ctx.hiringUploadReport_(clerk, interview());
  assert.strictEqual(reports(PI).length, 1);
});
T('a clerk calling hiringConfirmReject_ throws', () => {
  reset([appRow(SL)]);
  ctx.hiringUploadReport_(clerk, interview(REJ));
  throws(() => ctx.hiringConfirmReject_(clerk, { row: 2, confirm: true }), /Principal/);
  assert.ok(JSON.parse(apps.rows[1][C.STAGE_MARKS - 1]).rejectPending);
});
T('confirm -> Rejected with the clerk\'s reason, pending cleared; don\'t -> cleared, status unchanged', () => {
  reset([appRow(SL)]);
  ctx.hiringUploadReport_(clerk, interview(REJ));
  ctx.hiringConfirmReject_(principal, { row: 2, confirm: true });
  assert.strictEqual(lockedDuringList, false);
  assert.strictEqual(apps.rows[1][C.STATUS - 1], 'Rejected');
  assert.strictEqual(apps.rows[1][C.REJECT_REASON - 1], 'Salary expectation too high');
  assert.strictEqual(JSON.parse(apps.rows[1][C.STAGE_MARKS - 1]).rejectPending, undefined);
  reset([appRow(SL)]);
  ctx.hiringUploadReport_(clerk, interview(REJ));
  ctx.hiringConfirmReject_(principal, { row: 2, confirm: false });
  assert.strictEqual(apps.rows[1][C.STATUS - 1], '');
  assert.strictEqual(JSON.parse(apps.rows[1][C.STAGE_MARKS - 1]).rejectPending, undefined);
  throws(() => ctx.hiringConfirmReject_(principal, { row: 2, confirm: true }), /No rejection is pending/);
});
T('hirSetupScans creates "Hiring scans" once and stores its id', () => {
  reset([]); props = {};
  ctx.hirSetupScans();
  assert.strictEqual(props.HIR_SCAN_FOLDER_ID, 'new-Hiring scans');
  props.HIR_SCAN_FOLDER_ID = 'keep';
  ctx.hirSetupScans();
  assert.strictEqual(props.HIR_SCAN_FOLDER_ID, 'keep');
});
T('a Principal\'s portal-form submission is Entered By Role "principal" (a Coordinator too)', () => {
  reset([appRow(SL)]);
  const body = interview(); delete body.file; delete body.kind;
  ctx.hiringSubmitInterview_(principal, body);
  ctx.hiringSubmitInterview_({ email: 'co@lms.org.in', campusId: 'LMS4', roles: ['Coordinator'] }, body);
  assert.deepStrictEqual(reports(PI).map((x) => x['Entered By Role']), ['principal', 'principal']);
});
T('no scans folder + a Principal\'s "another" + nextDemoAt -> throws, NO appointment, no DEMO_AT, no report', () => {
  reset([appRow(Object.assign({ STAGE_MARKS: MARKED }, SL))]); props = {};
  throws(() => ctx.hiringUploadReport_(principal, demo({ recommendation: 'another', nextDemoAt: FUTURE })), /hirSetupScans/);
  assert.strictEqual(appts().length, 0); assert.strictEqual(apps.rows[1][C.DEMO_AT - 1], ''); assert.strictEqual(reports(PD).length, 0);
});
T('a refused proposal or a throw in the append core after the save -> the saved file is trashed, the error rethrown', () => {
  reset([appRow(SL)]); // no interview evidence: the clerk's "another" proposal is refused inside the lock
  throws(() => ctx.hiringUploadReport_(clerk, demo({ recommendation: 'another', nextDemoAt: FUTURE })), /interview has to be done/);
  assert.strictEqual(drive.root.subs.LMS4.files[0].trashed, true);
  reset([appRow(SL)]);
  const real = ctx.hirAppendReportCore_;
  ctx.hirAppendReportCore_ = () => { throw new Error('sheet write failed'); };
  try { throws(() => ctx.hiringUploadReport_(clerk, interview()), /sheet write failed/); } finally { ctx.hirAppendReportCore_ = real; }
  assert.strictEqual(drive.root.subs.LMS4.files.length, 1); assert.strictEqual(drive.root.subs.LMS4.files[0].trashed, true);
  reset([appRow(SL)]);
  ctx.hiringUploadReport_(clerk, interview());
  assert.strictEqual(drive.root.subs.LMS4.files[0].trashed, false);
});
