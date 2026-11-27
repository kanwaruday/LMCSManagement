// gamePdrExport in principal-dr.gs: owner only, key-gated, one school per call, header + that school's rows of the two tabs. Fake sheets. Usage: node tests/pdr/test-pdr-export.js
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '../../apps-script/principal-dr.gs'), 'utf8');
const daily = [['Timestamp', 'Date', 'CampusId'], ['t1', '2026-11-20', 'LMS1'], ['t2', '2026-11-20', 'LMS2'], ['t3', '2026-11-21', 'lms1 ']];
const planned = [['Id', 'CampusId'], ['a', 'LMS2'], ['b', 'LMS1']];
const stub = () => new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : stub()), apply: () => stub(), construct: () => stub() });
const sb = { SpreadsheetApp: { openById: () => ({ getSheetByName: (n) => ({ getDataRange: () => ({ getDisplayValues: () => (n === 'Daily Reports' ? daily : planned) }) }) }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'k' }) } };
['DriveApp', 'CacheService', 'LockService', 'Utilities', 'UrlFetchApp', 'ContentService', 'MailApp', 'Session', 'CalendarApp', 'ScriptApp', 'Logger'].forEach((n) => { sb[n] = stub(); });
const ctx = vm.createContext(sb); vm.runInContext(src, ctx, { filename: 'principal-dr.gs' });
const call = (b) => JSON.parse(JSON.stringify(vm.runInContext('pdrGame_(' + JSON.stringify(b) + ')', ctx)));
const ok = call({ action: 'gamePdrExport', key: 'k', role: 'owner', campus: 'LMS1' });
assert.strictEqual(ok.success, true);
assert.deepStrictEqual(ok.data.daily.map((r) => r[0]), ['Timestamp', 't1', 't3']);       // header + LMS1 only, case and spaces ignored
assert.deepStrictEqual(ok.data.planned.map((r) => r[0]), ['Id', 'b']);
assert.strictEqual(call({ action: 'gamePdrExport', key: 'k', role: 'principal', campus: 'LMS1' }).success, false);   // a Principal may not
assert.strictEqual(call({ action: 'gamePdrExport', key: 'bad', role: 'owner', campus: 'LMS1' }).error, 'not_authorized');
assert.strictEqual(call({ action: 'gamePdrExport', key: 'k', role: 'owner', campus: 'HES' }).success, false);
console.log('pdr export: ok');
