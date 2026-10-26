// platform-push.gs (Roster project): what leaves the Sheets for the platform, and how it is signed.
// Runs the real employee-roster.gs + principal-allowlist.gs + platform-push.gs in a sandbox over synthetic sheets that also
// carry personal columns (Aadhaar, PAN, bank, salary, phone, campus): none of those may appear in a payload.
// Usage: node tests/apps-script/test-platform-push.js
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const root = path.join(__dirname, '../..');

const ZW = String.fromCharCode(0x200B);
const SECRET = 'test-sync-secret';
const sheets = {
  EmpMaster: [['EmployeeCode', 'Name', 'SchoolCode', 'ReportsTo', 'Status', 'AuthEmail', 'DateOfBirth'],
    ['KUL/T-0001', ' Person One' + ZW, 'LMS6', 'KUL/T-0009', 'Active', '17', 'DOB-SECRET'],
    ['HES/T-0002', 'Ánya Śarmā', 'HES', '', 'Inactive', '18', 'DOB-SECRET'],
    ['', 'Blank Code', '', '', 'Active', '', '']],
  EmpSalary: [['EmployeeCode', 'Designation', 'Department', 'BasicPay', 'BankAccount'],
    ['KUL/T-0001', 'PRT', ZW + 'Teaching ', 'SALARY-SECRET', 'BANK-SECRET'], ['HES/T-0002', 'Clerk', 'AdminClerk', 'SALARY-SECRET', 'BANK-SECRET']],
  EmpPersonal: [['EmployeeCode', 'AuthEmail', 'Aadhaar', 'PAN', 'Phone'],
    ['KUL/T-0001', ' Person1@Example.TEST ', 'AADHAAR-SECRET', 'PAN-SECRET', 'PHONE-SECRET'],
    ['HES/T-0002', 'person2@example.test', 'AADHAAR-SECRET', 'PAN-SECRET', 'PHONE-SECRET']],
  EmpAcademic: [['EmployeeCode', 'Name', 'Class_Subject1', 'Class_Subject2', 'Class_Subject3'],
    ['KUL/T-0001', 'Person One', 'C4_Science', ' ' + ZW, 'C5_Maths']],
};
const allow = [['Email', 'Name', 'Campus', 'Role', 'CanApprove', 'Notes'],
  [' Owner@Example.test', 'Owner One', 'all', 'Owner', '', 'NOTE-SECRET'],
  ['coord@example.test', 'Coord One', 'ALL', 'Coordinator, Principal', 'true', 'NOTE-SECRET'],
  ['', 'No Email', 'LMS1', 'Principal', '', '']];

const fetches = [];
const props = { PLATFORM_SYNC_SECRET: SECRET, PLATFORM_URL: 'https://platform.example.test/' };
let pending = false;
const gas = {
  console,
  Logger: { log() {} },
  CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null) }) },
  SpreadsheetApp: { openById: (id) => (id === vm.runInContext('SHEET_ID', gas)
    ? { getSheets: () => [{ getDataRange: () => ({ getValues: () => allow }) }] }
    : { getSheetByName: (n) => ({ getDataRange: () => ({ getValues: () => sheets[n] }) }) }) },
  Utilities: {
    Charset: { UTF_8: 'UTF-8' },
    // Apps Script returns signed bytes (-128..127)
    computeHmacSha256Signature: (value, key) => Array.from(crypto.createHmac('sha256', key).update(value, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
  },
  UrlFetchApp: { fetch: (url, opts) => {
    fetches.push({ url, opts });
    const body = url.includes('/api/sync/pending') ? { ok: true, pending } : { ok: true, received: 2, changed: 0, deactivated: 0 };
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) };
  } },
  ScriptApp: {},
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType: () => s }) },
};
vm.createContext(gas);
for (const f of ['employee-roster.gs', 'principal-allowlist.gs', 'platform-push.gs']) vm.runInContext(fs.readFileSync(path.join(root, 'apps-script', f), 'utf8'), gas);

const hmac = (s) => crypto.createHmac('sha256', SECRET).update(s, 'utf8').digest('hex');
const SECRETS = /SECRET/;

// ── staff ─────────────────────────────────────────────────────────
gas.platformPushStaff();
let f = fetches.pop();
assert.strictEqual(f.url, 'https://platform.example.test/api/sync/staff');
assert.strictEqual(f.opts.method, 'post');
assert.strictEqual(f.opts.contentType, 'application/json; charset=utf-8', 'UTF-8 on the wire, the bytes the signature covers');
let body = JSON.parse(f.opts.payload);
assert.deepStrictEqual(Object.keys(body).sort(), ['rows', 'sentAt']);
assert.ok(Math.abs(Date.parse(body.sentAt) - Date.now()) < 5000, 'sentAt is now, ISO');
assert.strictEqual(f.opts.headers['X-Sync-Signature'], hmac(body.sentAt + '.' + f.opts.payload), 'signature = Node HMAC of sentAt.rawBody');
assert.doesNotMatch(f.opts.payload, SECRETS, 'no personal or salary column leaves');
assert.strictEqual(body.rows.length, 2, 'a row without an employee code is skipped');
for (const r of body.rows) {
  assert.deepStrictEqual(Object.keys(r).sort(), ['active', 'authEmail', 'department', 'designation', 'employeeCode', 'name', 'reportsTo', 'subjects'],
    'staff row keys exactly (no campusId: the platform maps the code prefix)');
}
assert.deepStrictEqual(body.rows[0], { employeeCode: 'KUL/T-0001', authEmail: 'person1@example.test', name: 'Person One', department: 'Teaching',
  designation: 'PRT', reportsTo: 'KUL/T-0009', subjects: ['C4_Science', 'C5_Maths'], active: true });
assert.deepStrictEqual(body.rows[1], { employeeCode: 'HES/T-0002', authEmail: 'person2@example.test', name: 'Ánya Śarmā', department: 'AdminClerk',
  designation: 'Clerk', reportsTo: '', subjects: [], active: false });

// ── allowlist ─────────────────────────────────────────────────────
gas.platformPushAllowlist();
f = fetches.pop();
assert.strictEqual(f.url, 'https://platform.example.test/api/sync/allowlist');
body = JSON.parse(f.opts.payload);
assert.strictEqual(f.opts.headers['X-Sync-Signature'], hmac(body.sentAt + '.' + f.opts.payload));
assert.doesNotMatch(f.opts.payload, SECRETS);
assert.deepStrictEqual(body.rows, [
  { email: 'owner@example.test', name: 'Owner One', campusId: 'ALL', roles: 'Owner', canApprove: false },
  { email: 'coord@example.test', name: 'Coord One', campusId: 'ALL', roles: 'Coordinator, Principal', canApprove: true },
]);

// ── poll: pushes both only when the platform asks ──────────────────
gas.platformPollRequest();
f = fetches.pop();
assert.strictEqual(fetches.length, 0, 'nothing pending: no push');
const sentAt = decodeURIComponent(/[?&]sentAt=([^&]+)/.exec(f.url)[1]);
assert.ok(f.url.startsWith('https://platform.example.test/api/sync/pending?sentAt='));
assert.strictEqual(f.opts.headers['X-Sync-Signature'], hmac(sentAt + '.'), 'GET signs sentAt with an empty body');
pending = true;
gas.platformPollRequest();
assert.deepStrictEqual(fetches.map((x) => x.url.replace('https://platform.example.test', '').split('?')[0]),
  ['/api/sync/pending', '/api/sync/allowlist', '/api/sync/staff'], 'allowlist first (sign-in), then staff');
fetches.length = 0;

// one push failing: the other is still attempted, then the failure is rethrown (the server keeps the request pending)
const realFetch = gas.UrlFetchApp.fetch;
gas.UrlFetchApp.fetch = (url, opts) => {
  if (url.includes('/api/sync/allowlist')) { fetches.push({ url, opts }); return { getResponseCode: () => 500, getContentText: () => '{"ok":false,"error":"SERVER_ERROR"}' }; }
  return realFetch(url, opts);
};
assert.throws(() => gas.platformPollRequest(), /allowlist 500: SERVER_ERROR/);
assert.deepStrictEqual(fetches.map((x) => x.url.split('/api/sync/')[1].split('?')[0]).sort(), ['allowlist', 'pending', 'staff'], 'staff still pushed after the allowlist failed');
gas.UrlFetchApp.fetch = realFetch;

// ── refused or unset: fails loudly (the trigger's failure mail reaches Uday) ──
gas.UrlFetchApp.fetch = () => ({ getResponseCode: () => 409, getContentText: () => JSON.stringify({ ok: false, refused: 'MASS_DEACTIVATION' }) });
assert.throws(() => gas.platformPushStaff(), /MASS_DEACTIVATION/);
delete props.PLATFORM_SYNC_SECRET;
assert.throws(() => gas.platformPushStaff(), /PLATFORM_SYNC_SECRET/);

console.log('platform-push: all checks passed');
