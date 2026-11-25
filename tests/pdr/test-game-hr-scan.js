// node tests/pdr/test-game-hr-scan.js -- W7 S3 part 2 (N3): the report scan through a ticket and parts (game-hr.gs). Synthetic bytes only.
// Runs the REAL main.gs dispatch + game-approvals.gs gate helpers + game-hr.gs; hiring.gs / hiring-appointments.gs are faked so each
// step's call (which function, which sheet row, which arguments) can be checked. Fake data only (public repo).
'use strict';
const assert = require('assert');
const { boot } = require('./harness');

const KEY = 'k'.repeat(40);
const appl = (n, branches, extra) => Object.assign({
  row: n + 10, applicantId: 'T-' + String(n + 1).padStart(4, '0'), name: 'Applicant ' + n, phone: '+91 90000 0000' + n, branches,
  subjects: 'English', qualification: 'MA', status: 'Shortlisted', matchScore: 7, timestamp: '2026-11-01T05:00:00.000Z', round: 1,
  rejectReason: '', positionLabel: 'TGT: English', notes: '', appointments: [], interviewReports: [], demoReports: [], history: [], docsMissing: [],
}, extra);
const LIST = [
  appl(0, 'LMS-1 Dhalpur', { name: 'Same Name' }),
  appl(1, 'LMS-1 Dhalpur', { appointments: [{ id: 'AP-1', kind: 'interview', start: '2099-01-01T05:00:00.000Z', status: 'proposed', reportFiled: false }] }),
  appl(2, 'LMS-2 Kelheli', { status: 'Rejected', stageMarks: { rejectPending: { reason: 'Demo not up to the mark', note: 'n' } } }),
];
const calls = [], tabs = {};
let boom = null;
const fake = (name) => (caller, body) => {
  if (boom) throw new Error(boom);
  calls.push([name, caller.name, JSON.parse(JSON.stringify(body))]);
  return {};
};
const h = boot({
  allowlistRows: [['Email', 'Name', 'CampusId', 'Role', 'CanApprove'],
    ['owner@lms.org.in', 'Owner Person', 'ALL', 'Owner', ''],
    ['coord@lms.org.in', 'Coord Decider', 'ALL', 'Coordinator', 'TRUE'],
    ['principal@lms.org.in', 'Principal One', 'LMS1', 'Principal', ''],
    ['clerk@lms.org.in', 'Clerk One', 'LMS1', 'FeeClerk', '']],
  files: ['supporting-charge', 'approvals-leave', 'approvals', 'game-approvals', 'game-hr'],
  extra: {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => ({ GAME_KEY: KEY })[k] || null }) },
    HIR_STATUSES: ['Shortlisted', 'Interview Scheduled', 'Interview Done', 'Demo Done', 'Salary Offer', 'MD Academics Interview Scheduled', 'Hiring Approved', 'Hired', 'Rejected'],
    hirMs_: (v) => (v ? new Date(v).getTime() || 0 : 0),
    hiringApplicants_: () => ({ success: true, applicants: JSON.parse(JSON.stringify(LIST)) }),
    hiringApprovalStatus_: () => ({ success: true, campuses: [] }),
    hirWorkbook_: () => ({
      getSheetByName: (n) => tabs[n] || null,
      insertSheet: (n) => { const rows = []; tabs[n] = { rows, getLastRow: () => rows.length, appendRow: (r) => rows.push(r) }; return tabs[n]; },
    }),
    hiringShortlist_: fake('hiringShortlist_'), hiringMarkStage_: fake('hiringMarkStage_'), apptPropose_: fake('apptPropose_'), apptHeld_: fake('apptHeld_'),
    hiringSubmitInterview_: fake('hiringSubmitInterview_'), hiringSubmitDemo_: fake('hiringSubmitDemo_'), hiringDupSettle_: fake('hiringDupSettle_'),
    apptCalendarRetry_: fake('apptCalendarRetry_'),
    hiringAddApplicant_: (caller, body) => { if (boom) throw new Error(boom); calls.push(['hiringAddApplicant_', caller.name, JSON.parse(JSON.stringify(body))]);
      return body.name === 'Dup Name' ? { duplicate: true, applicantId: '' } : { duplicate: false, applicantId: 'T-0042' }; },
    apptDecide_: fake('apptDecide_'), apptCancel_: fake('apptCancel_'), hiringConfirmReject_: fake('hiringConfirmReject_'), hiringRevive_: fake('hiringRevive_'),
  },
});
// fuller Apps Script fakes for the ticket path (string or byte input, web-safe base64, a cache with remove, a Drive folder tree)
const crypto = require('crypto');
const toBuf = (x) => (typeof x === 'string' ? Buffer.from(x, 'utf8') : Buffer.from(x.map((b) => (b < 0 ? b + 256 : b))));
const signed = (buf) => Array.from(buf).map((b) => (b > 127 ? b - 256 : b));
const store = new Map();
let uuid = 0;
h.g.Utilities = Object.assign({}, h.g.Utilities, {
  getUuid: () => 'nonce-' + (++uuid),
  computeHmacSha256Signature: (v, k) => signed(crypto.createHmac('sha256', String(k)).update(String(v)).digest()),
  base64EncodeWebSafe: (x) => toBuf(x).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
  base64DecodeWebSafe: (s) => signed(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
  base64Decode: (s) => signed(Buffer.from(String(s), 'base64')),
  base64Encode: (bytes) => toBuf(bytes).toString('base64'),
  newBlob: (bytes) => ({ getDataAsString: () => toBuf(bytes).toString('utf8') }),
});
h.g.CacheService = { getScriptCache: () => ({ get: (k) => (store.has(k) ? store.get(k) : null), put: (k, v) => store.set(k, v), remove: (k) => store.delete(k) }) };
h.g.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => ({ GAME_KEY: KEY, HIR_SCAN_FOLDER_ID: 'root', PDR_WEBAPP_URL: 'https://script.example.invalid/exec' })[k] || null }) };
const folder = (name) => { const files = [], subs = []; let trashed = false; const f = {
  name, files, subs, get trashed() { return trashed; },
  getFoldersByName: (n) => { const hit = subs.filter((x) => x.name === n && !x.trashed); let i = 0; return { hasNext: () => i < hit.length, next: () => hit[i++] }; },
  createFolder: (n) => { const x = folder(n); subs.push(x); return x; },
  getFilesByName: (n) => { const hit = files.filter((x) => x.name === n && !x.trashed); let i = 0; return { hasNext: () => i < hit.length, next: () => hit[i++] }; },
  createFile: (n, content) => { const x = { name: n, trashed: false, setTrashed(v) { this.trashed = v; }, getBlob: () => ({ getDataAsString: () => content }) }; files.push(x); return x; },
  setTrashed: (v) => { trashed = v; } }; return f; };
const ROOT = folder('root');
h.g.DriveApp = { getFolderById: () => ROOT };
const filed = [];
h.g.hiringUploadReport_ = (caller, b) => { if (boom) throw new Error(boom); filed.push([caller.name, JSON.parse(JSON.stringify(b))]); return {}; };

const data = (r) => { assert.strictEqual(r.success, true, JSON.stringify(r)); return JSON.parse(JSON.stringify(r.data)); };
const ticket = (role, who, params) => h.post('gameHrScanTicket', { key: KEY, role, email: who + '@lms.org.in', campus: null, campuses: ['LMS1'], params });
const part = (t, n, of, bytes) => JSON.parse(JSON.stringify(h.g.gameHrDispatch_({ action: 'gameHrUploadPart', ticket: t, part: n, of, base64: Buffer.from(bytes).toString('base64') })));
const P = { id: 'T-0002', kind: 'interview', mime: 'application/pdf', recommendation: 'proceed', interviewDate: '2026-11-20', confidence: '4', capability: JSON.stringify({ English: { 5: 4 } }) };

// who may: the Owner and the Principal; the Fee Clerk can't file a report
assert.strictEqual(data(ticket('fee_clerk', 'clerk', P)).code, 'not_authorized');
assert.strictEqual(data(ticket('principal', 'principal', { ...P, id: 'T-0003' })).code, 'not_found', 'another school’s applicant');
assert.strictEqual(data(ticket('principal', 'principal', { ...P, mime: 'image/gif' })).code, 'refused');
const tk = data(ticket('principal', 'principal', P));
assert.match(tk.url, /^https:\/\/script\.example\.invalid\/exec\?ticket=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+&action=gameHrUploadPart$/);
const t = new URL(tk.url).searchParams.get('ticket');
// a forged or unknown ticket is refused; a bad part is refused
assert.deepStrictEqual(part(t.slice(0, -2) + 'xx', 1, 1, [1]), { success: false, error: 'not_authorized' });
assert.deepStrictEqual(part('bm9uY2UtOTk.' + t.split('.')[1], 1, 1, [1]), { success: false, error: 'not_authorized' });
assert.deepStrictEqual(part(t, 3, 2, [1]), { success: false, error: 'BAD_PART' });
assert.deepStrictEqual(part(t, 1, 7, [1]), { success: false, error: 'BAD_PART' });
// two parts, the first resent: the report is filed once, by the ticket's person, on the applicant's row, with the bound form
const pdf = Buffer.from('%PDF-1.4 synthetic scan');
assert.deepStrictEqual(part(t, 1, 2, pdf.subarray(0, 10)), { success: true });
assert.deepStrictEqual(part(t, 1, 2, pdf.subarray(0, 10)), { success: true });
assert.deepStrictEqual(part(t, 2, 2, pdf.subarray(10)), { success: true, fileId: 'filed' });
assert.strictEqual(filed.length, 1);
assert.deepStrictEqual(filed[0][0], 'Principal One');
const b = filed[0][1];
assert.deepStrictEqual([b.row, b.kind, b.recommendation, b.confidence, b.capability], [11, 'interview', 'proceed', '4', { English: { 5: 4 } }]);
assert.strictEqual(Buffer.from(b.file.base64, 'base64').toString(), '%PDF-1.4 synthetic scan', 'the parts reassemble in order');
// the ticket is burnt and the parts folder trashed; a replay is refused
assert.deepStrictEqual(part(t, 2, 2, pdf.subarray(10)), { success: false, error: 'not_authorized' });
assert.ok(ROOT.subs[0].subs.every((x) => x.trashed));
assert.ok(tabs['Game Actions'].rows.some((x) => x[2] === 'interview scan' && x[3] === 'T-0002'));
// the old page's refusal at the last part: nothing burnt, the plain words come back
const t2 = new URL(data(ticket('owner', 'owner', { ...P, kind: 'demo', scores: JSON.stringify({ pedagogy: 3 }) })).url).searchParams.get('ticket');
boom = 'Give every demo score (1 to 5)';
assert.deepStrictEqual(part(t2, 1, 1, pdf), { success: false, error: 'REFUSED', say: boom });
boom = null;
assert.deepStrictEqual(part(t2, 1, 1, pdf), { success: true, fileId: 'filed' }, 'a refused last part keeps the ticket, so a retry can still file it');
console.log('test-game-hr-scan: all passed');
