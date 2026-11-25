// node tests/roster/test-roster-lock.js -- 26 Nov SECURITY: the Roster web app's data reads need ROSTER_GAME_KEY or a signed-in token.
// Loads the whole Roster project (projects.json) in a vm with fake services; synthetic rows only (public repo).
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const here = path.join(__dirname, '../../apps-script');
const projects = JSON.parse(fs.readFileSync(path.join(here, 'projects.json'), 'utf8'));
const KEY = 'k'.repeat(40), CLIENT = '697999989724-mvi85iobr20g4mm8a8nrjd1rms2o8tf6.apps.googleusercontent.com';

function boot({ props = { ROSTER_GAME_KEY: KEY }, tokens = {} } = {}) {
  const P = Object.assign({}, props), cache = new Map(), calls = { fetch: 0, setup: 0, drive: 0 };
  const stub = () => new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : stub()), apply: () => stub(), construct: () => stub() });
  const ctx = { console: { log() {}, info() {}, warn() {}, error() {} }, JSON, Date, Math, Object, Array, String, Number, RegExp, Error, encodeURIComponent, parseInt };
  ['SpreadsheetApp', 'DriveApp', 'LockService', 'Logger', 'HtmlService', 'Session', 'MailApp', 'GmailApp', 'CalendarApp', 'Drive'].forEach((s) => { ctx[s] = stub(); });
  ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => P[k] ?? null, setProperty: (k, v) => { P[k] = v; } }) };
  ctx.CacheService = { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, v), remove: (k) => cache.delete(k) }) };
  ctx.Utilities = { base64EncodeWebSafe: (b) => Buffer.from(b).toString('base64url'), computeDigest: (_a, s) => Array.from(require('crypto').createHash('sha256').update(s).digest()), DigestAlgorithm: { SHA_256: 1 } };
  ctx.UrlFetchApp = { fetch: (url) => {
    calls.fetch++;
    const m = String(url).match(/id_token=([^&]+)/);
    const t = m && tokens[decodeURIComponent(m[1])];
    return { getResponseCode: () => (t ? 200 : 400), getContentText: () => JSON.stringify(t || {}) };
  } };
  ctx.ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType: () => ({ body: s }), body: s }) };
  vm.createContext(ctx);
  vm.runInContext(projects.roster.files.map((f) => fs.readFileSync(path.join(here, f.includes('/') ? f : f + '.gs'), 'utf8')).join('\n;\n'), ctx, { filename: 'roster.gs' });
  // the data behind the reads: synthetic rows
  ctx.readRosterRows = () => [{ school: 'LMS 1', class: 'VI', subject: 'Maths', teacher: 'Teacher Alpha' }];
  ctx.readEmployees = () => [{ employeeCode: 'T/1', name: 'Staff Alpha', school: 'LMS 1' }];
  ctx.readDesignationSummary = () => [{ designation: 'Teacher', count: 1 }];
  ctx.readEntries = () => [{ email: 'principal@lms.org.in', name: 'P', campusId: 'LMS1', role: 'Principal' }];
  ctx.rosterKnownEmail_ = (email) => ctx.readEntries().some((x) => x.email === email) || email === 'teacher@lms.org.in';
  ctx.hrfSelfSetup_ = () => { calls.setup++; };
  ctx.allowlistDoGet_ = () => ({ getContent: () => '', body: JSON.stringify({ success: true, entries: ctx.readEntries() }) });
  ctx.captureDriveCheck_ = () => { calls.drive++; return { success: true, drive: 'ok', capture: 'found', write: 'ok' }; };
  const get = (parameter) => JSON.parse(ctx.doGet({ parameter }).body);
  return { get, calls, P };
}
const NO = { success: false, error: 'not_authorized' };
const TOKENS = { 'good-principal': { aud: CLIENT, email_verified: 'true', email: 'principal@lms.org.in' }, 'good-teacher': { aud: CLIENT, email_verified: 'true', email: 'teacher@lms.org.in' },
  'wrong-aud': { aud: 'other', email_verified: 'true', email: 'principal@lms.org.in' }, 'stranger': { aud: CLIENT, email_verified: 'true', email: 'stranger@x.org' }, 'unverified': { aud: CLIENT, email_verified: 'false', email: 'principal@lms.org.in' } };
const r = boot({ tokens: TOKENS });
const dataOf = (x) => JSON.stringify(x);

// no key, no token: every read action, a bare GET, an unknown action, an empty key: refused, nothing echoed, nothing leaked
for (const q of [{}, { action: 'roster' }, { action: 'employees' }, { action: 'designations' }, { action: 'drivecheck' }, { action: 'nope' }, { action: 'EMPLOYEES' },
  { action: 'roster', key: '' }, { action: 'roster', key: 'wrong' }, { action: 'roster', key: KEY.slice(1) }, { action: 'roster', key: KEY + 'x' }, { action: 'roster', idToken: 'junk' },
  { action: 'allowlist_list' }, { action: 'allowlist_list', key: 'wrong' }, { action: 'allowlist_list', idToken: 'stranger' }, { action: 'allowlist_list', idToken: 'wrong-aud' },
  { action: 'drivecheck', idToken: 'good-principal' }, { action: 'drivecheck', idToken: 'good-teacher' },
  { action: 'roster', idToken: 'wrong-aud' }, { action: 'roster', idToken: 'stranger' }, { action: 'roster', idToken: 'unverified' }]) {
  assert.deepStrictEqual(r.get(q), NO, JSON.stringify(q));
}
// the right key reads; so does a signed-in Allowlist person and an Employee Master teacher
assert.deepStrictEqual(r.get({ action: 'roster', key: KEY }).rows[0].teacher, 'Teacher Alpha');
assert.strictEqual(r.get({ action: 'employees', key: KEY }).employees[0].employeeCode, 'T/1');
assert.strictEqual(r.get({ action: 'designations', key: KEY }).designations[0].designation, 'Teacher');
assert.strictEqual(r.get({ action: 'drivecheck', key: KEY }).drive, 'ok');
assert.strictEqual(r.get({ action: 'employees', idToken: 'good-principal' }).success, true);
assert.strictEqual(r.get({ action: 'employees', idToken: 'good-teacher' }).success, true);
assert.deepStrictEqual(r.get({ action: 'nope', key: KEY }), { success: false, error: 'Unknown action: nope' }, 'an authorized caller still hears about a bad action');
// the access list: the key sees every entry; a signed-in person sees only their own; a teacher known only by the Employee Master sees none
assert.strictEqual(r.get({ action: 'allowlist_list', key: KEY }).entries.length, 1);
assert.deepStrictEqual(r.get({ action: 'allowlist_list', idToken: 'good-principal' }).entries.map((x) => x.email), ['principal@lms.org.in']);
assert.deepStrictEqual(r.get({ action: 'allowlist_list', idToken: 'good-teacher' }).entries, []);
// drivecheck creates and bins a folder: the key only, and it runs nothing for a refused caller
const d0 = r.calls.drive;
assert.deepStrictEqual(r.get({ action: 'drivecheck', idToken: 'good-principal' }), NO); assert.strictEqual(r.calls.drive, d0, 'a token never runs the drive check');
// the self-setup runs only after a key or token check passed: refused calls never reach it
const sx = boot({ tokens: TOKENS });
for (const q of [{}, { action: 'roster' }, { action: 'allowlist_list' }, { action: 'drivecheck' }, { action: 'roster', idToken: 'stranger' }]) sx.get(q);
assert.strictEqual(sx.calls.setup, 0, 'no setup for a refused read');
sx.get({ action: 'roster', key: KEY }); assert.strictEqual(sx.calls.setup, 1, 'setup after a good key');
// a token that checked out once is remembered (no second Google call)
const f0 = r.calls.fetch; r.get({ action: 'employees', idToken: 'good-principal' }); assert.strictEqual(r.calls.fetch, f0, 'cached');
// no key set in the project: the read is refused for everyone without a token (never "empty key matches empty")
const nokey = boot({ props: {} });
assert.deepStrictEqual(nokey.get({ action: 'roster', key: '' }), NO); assert.deepStrictEqual(nokey.get({ action: 'roster' }), NO);
const shortKey = boot({ props: { ROSTER_GAME_KEY: 'short' } });
assert.deepStrictEqual(shortKey.get({ action: 'roster', key: 'short' }), NO, 'a short key never counts');
// still open, booleans only: the status op and the ping; neither runs the setup nor leaks
const s0 = r.calls.setup;
const st = r.get({ op: 'hrSetupStatus' });
assert.deepStrictEqual(Object.keys(st).sort(), ['flag', 'trigger', 'url_set']); assert.ok(Object.values(st).every((v) => typeof v === 'boolean'));
assert.deepStrictEqual(r.get({ op: 'ping' }), { success: true, ok: true });
assert.strictEqual(r.calls.setup, s0, 'status and ping never run the setup');
for (const q of [{ op: 'ping' }, { op: 'hrSetupStatus' }, {}, { action: 'roster' }]) assert.ok(!/Teacher Alpha|Staff Alpha|principal@|T\/1/.test(dataOf(r.get(q))), 'no data in ' + JSON.stringify(q));
// a switched (actAs) caller is refused for what is not a read, as before
assert.strictEqual(r.get({ action: 'addnewhire', actAs: 'LMS3' }).success, false);
console.log('roster lock: ok');
