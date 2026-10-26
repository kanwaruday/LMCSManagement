// ═══════════════════════════════════════════════════════════════════
// Platform push (Roster project): sends the Employee Master and the allowlist to the new LMCS platform
// (platform/src/sync.ts), which keeps its own copy for sign-in. The Sheets stay the source.
//
// ONLY these fields leave the Sheets -- staff: employeeCode, authEmail (EmpPersonal), name, reportsTo, active (EmpMaster
// Status, exactly "active" like pdrStaffFromEmployeeMaster_), department, designation (EmpSalary), subjects (EmpAcademic
// Class_SubjectN codes); allowlist: email, name, campusId, roles, canApprove. Never Aadhaar, PAN, bank, salary, phone or any
// other column. No campus is sent for staff: the platform maps the Employee Code prefix itself.
//
// Signed: X-Sync-Signature = hex(HMAC-SHA256(PLATFORM_SYNC_SECRET, sentAt + '.' + body)); the platform refuses a bad
// signature, a sentAt more than 5 minutes off, and a staff push that would deactivate more than 10% of active people.
// A refused or failed push throws, so the trigger's failure mail reaches the script owner.
//
// SETUP (quest Q4): Script Properties PLATFORM_SYNC_SECRET (same value as SYNC_SECRET on Render) and PLATFORM_URL
// (the platform's https origin), then run platformInstallTriggers ONCE from the editor.
// ═══════════════════════════════════════════════════════════════════

// Same cleaning as main.gs pdrStaffFromEmployeeMaster_ (and the platform's clean()): zero-width characters out, trimmed.
function platformCell_(v) {
  return String(v == null ? '' : v).replace(/[​-‏﻿⁠]/g, '').trim();
}

// One tab, only the named columns, cleaned. Throws when a column is missing (a renamed header must not read as
// "everyone left"); Class_SubjectN columns are optional.
function platformTab_(book, name, cols) {
  const rows = book.getSheetByName(name).getDataRange().getValues();
  const at = cols.map(function (c) {
    const i = rows[0].indexOf(c);
    if (i < 0 && !/^Class_Subject/.test(c)) throw new Error(name + ' has no ' + c + ' column');
    return i;
  });
  return rows.slice(1).map(function (r) {
    const o = {};
    cols.forEach(function (c, k) { o[c] = at[k] < 0 ? '' : platformCell_(r[at[k]]); });
    return o;
  });
}

function platformByCode_(rows) {
  const m = {};
  rows.forEach(function (r) { if (r.EmployeeCode) m[r.EmployeeCode] = r; });
  return m;
}

function platformStaffRows_() {
  const book = openWorkbook_(); // employee-roster.gs
  const subjectCols = [];
  for (let i = 1; i <= 10; i++) subjectCols.push('Class_Subject' + i);
  const salary = platformByCode_(platformTab_(book, 'EmpSalary', ['EmployeeCode', 'Department', 'Designation']));
  const personal = platformByCode_(platformTab_(book, 'EmpPersonal', ['EmployeeCode', 'AuthEmail']));
  const academic = platformByCode_(platformTab_(book, 'EmpAcademic', ['EmployeeCode'].concat(subjectCols)));
  return platformTab_(book, 'EmpMaster', ['EmployeeCode', 'Name', 'ReportsTo', 'Status'])
    .filter(function (r) { return r.EmployeeCode; })
    .map(function (r) {
      const code = r.EmployeeCode, s = salary[code] || {}, a = academic[code];
      return {
        employeeCode: code,
        authEmail: ((personal[code] || {}).AuthEmail || '').toLowerCase(),
        name: r.Name,
        department: s.Department || '',
        designation: s.Designation || '',
        reportsTo: r.ReportsTo,
        subjects: a ? subjectCols.map(function (c) { return a[c]; }).filter(Boolean) : [],
        active: r.Status.toLowerCase() === 'active',
      };
    });
}

// Allowlist sheet columns A-E (Email, Name, Campus, Role, CanApprove), read like main.gs verifyCallerToken_. Not
// readEntries(): that one is cached for 10 minutes and has no CanApprove.
function platformAllowlistRows_() {
  return getSheet().getDataRange().getValues().slice(1) // principal-allowlist.gs
    .map(function (r) {
      return { email: platformCell_(r[0]).toLowerCase(), name: platformCell_(r[1]), campusId: platformCell_(r[2]).toUpperCase(),
        roles: platformCell_(r[3]), canApprove: platformCell_(r[4]).toUpperCase() === 'TRUE' };
    })
    .filter(function (r) { return r.email; });
}

function platformConfig_() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('PLATFORM_URL'), secret = props.getProperty('PLATFORM_SYNC_SECRET');
  if (!url || !secret) throw new Error('Set Script Properties PLATFORM_URL and PLATFORM_SYNC_SECRET first');
  return { url: url.replace(/\/+$/, ''), secret: secret };
}

function platformSign_(secret, text) {
  return Utilities.computeHmacSha256Signature(text, secret, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

// -> the parsed reply; throws on anything but a 2xx { ok:true } (counts and codes only in the message, never row data).
function platformFetch_(url, opts) {
  const res = UrlFetchApp.fetch(url, Object.assign({ muteHttpExceptions: true }, opts));
  let out = {};
  try { out = JSON.parse(res.getContentText()); } catch (e) { /* non-JSON reply: reported below */ }
  if (res.getResponseCode() >= 300 || !out.ok) {
    throw new Error('Platform ' + url.split('?')[0].split('/api/')[1] + ' ' + res.getResponseCode() + ': ' + (out.refused || out.error || 'no JSON reply'));
  }
  return out;
}

function platformPost_(kind, rows) {
  const c = platformConfig_();
  const sentAt = new Date().toISOString();
  const payload = JSON.stringify({ sentAt: sentAt, rows: rows });
  const out = platformFetch_(c.url + '/api/sync/' + kind, {
    method: 'post', contentType: 'application/json', payload: payload,
    headers: { 'X-Sync-Signature': platformSign_(c.secret, sentAt + '.' + payload) },
  });
  Logger.log('platform ' + kind + ' sync: received ' + out.received + ', changed ' + out.changed + ', deactivated ' + out.deactivated);
  return out;
}

function platformPushStaff() { return platformPost_('staff', platformStaffRows_()); }
function platformPushAllowlist() { return platformPost_('allowlist', platformAllowlistRows_()); }

// Every 5 minutes: an Owner's "sync now" on the platform sets a flag; this picks it up and pushes both.
function platformPollRequest() {
  const c = platformConfig_();
  const sentAt = new Date().toISOString();
  const out = platformFetch_(c.url + '/api/sync/pending?sentAt=' + encodeURIComponent(sentAt), {
    method: 'get', headers: { 'X-Sync-Signature': platformSign_(c.secret, sentAt + '.') },
  });
  if (!out.pending) return;
  platformPushStaff();
  platformPushAllowlist();
}

// Run ONCE from the editor (asks for the trigger permission); re-running replaces these triggers, never adds a second set.
function platformInstallTriggers() {
  const handlers = ['platformPushStaff', 'platformPushAllowlist', 'platformPollRequest'];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (handlers.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('platformPushStaff').timeBased().atHour(2).everyDays(1).inTimezone('Asia/Kolkata').create();
  ScriptApp.newTrigger('platformPushAllowlist').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('platformPollRequest').timeBased().everyMinutes(5).create();
  Logger.log('Platform triggers installed: staff nightly 02:00 IST, allowlist hourly, poll every 5 minutes');
}
