// node tests/chapter/test-chapter-lock.js -- 26 Nov SECURITY: the CW/HW (chapter) web app's data paths need CHAPTER_GAME_KEY or a signed-in token.
// Loads the whole chapter project (projects.json) in a vm with fake services; synthetic rows only (public repo).
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const here = path.join(__dirname, '../../apps-script');
const projects = JSON.parse(fs.readFileSync(path.join(here, 'projects.json'), 'utf8'));
const KEY = 'c'.repeat(40), CLIENT = '697999989724-mvi85iobr20g4mm8a8nrjd1rms2o8tf6.apps.googleusercontent.com';
const ROSTERKEY = 'r'.repeat(40);
const SOURCES = JSON.stringify({ cw: 'cw-fake', payroll: 'pay-fake', schools: ['s1', 's2', 's3', 's4', 's5', 's6'] });
const FEED = JSON.stringify({ generated: 'x', cwRecords: [{ teacher: 'Teacher Alpha' }], cmData: {} });

function boot({ props = { CHAPTER_GAME_KEY: KEY, ROSTER_GAME_KEY: ROSTERKEY, CHAPTER_SOURCES: SOURCES }, tokens = {} } = {}) {
  const P = Object.assign({}, props), cache = new Map(), calls = { appended: [], payroll: 0, built: 0 };
  const stub = () => new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : stub()), apply: () => stub(), construct: () => stub() });
  const ctx = { console: { log() {}, info() {}, warn() {}, error() {} }, JSON, Date, Math, Object, Array, String, Number, RegExp, Error, encodeURIComponent, parseInt };
  ['SpreadsheetApp', 'DriveApp', 'Logger', 'CalendarApp', 'MimeType'].forEach((s) => { ctx[s] = stub(); });
  ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => P[k] ?? null, setProperty: (k, v) => { P[k] = v; } }) };
  ctx.CacheService = { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, v) }) };
  ctx.Utilities = { base64EncodeWebSafe: (b) => Buffer.from(b).toString('base64url'), computeDigest: (_a, s) => Array.from(require('crypto').createHash('sha256').update(s).digest()), DigestAlgorithm: { SHA_256: 1 } };
  ctx.UrlFetchApp = { fetch: (url) => {
    url = String(url);
    if (url.includes('action=allowlist_list')) return !url.includes('&key=' + ROSTERKEY) ? { getResponseCode: () => 200, getContentText: () => JSON.stringify({ success: false, error: 'not_authorized' }) } : { getResponseCode: () => 200, getContentText: () => JSON.stringify({ success: true, entries: [{ email: 'coord@lms.org.in', role: 'Coordinator' }, { email: 'owner@lms.org.in', role: 'Owner' }, { email: 'prin@lms.org.in', role: 'Principal' }] }) };
    const m = url.match(/id_token=([^&]+)/), t = m && tokens[decodeURIComponent(m[1])];
    return { getResponseCode: () => (t ? 200 : 400), getContentText: () => JSON.stringify(t || {}) };
  } };
  ctx.ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType: () => ({ body: s }), body: s }) };
  vm.createContext(ctx);
  vm.runInContext(projects.chapter.files.map((f) => fs.readFileSync(path.join(here, f + '.gs'), 'utf8')).join('\n;\n'), ctx, { filename: 'chapter.gs' });
  ctx.getOrBuildCache = () => { calls.built++; return FEED; };
  ctx.appendPayrollSubmission = () => { calls.payroll++; return ctx.ContentService.createTextOutput('{"success":true}'); };
  ctx.getOrCreateTrackerSpreadsheet = () => ({ getSheetByName: () => ({ appendRow: (r) => calls.appended.push(r), getLastRow: () => 1 }) });
  const get = (parameter) => ctx.doGet({ parameter }).body;
  return { get, calls, P, ctx };
}
const NO = JSON.stringify({ success: false, error: 'not_authorized' });
const mk = (email, extra) => Object.assign({ aud: CLIENT, email_verified: 'true', email }, extra);
const TOKENS = { staff: mk('teacher@lms.org.in'), coord: mk('coord@lms.org.in'), owner: mk('owner@lms.org.in'), prin: mk('prin@lms.org.in'), outsider: mk('x@gmail.com'),
  lookalike: mk('x@evil-lms.org.in'), 'wrong-aud': mk('teacher@lms.org.in', { aud: 'other' }), unverified: mk('teacher@lms.org.in', { email_verified: 'false' }) };
const r = boot({ tokens: TOKENS });
const OV = JSON.stringify({ school: 'LMS 1', cls: 'Class 1', subject: 'Maths', chapterName: 'Ch', actualDate: '2026-11-01', email: 'a@b' });

// READS: bare GET, no action, wrong action, no/short/wrong key, bad tokens: refused, no data, no build
for (const q of [{}, { action: 'feed' }, { action: 'FEED', key: '' }, { key: KEY }, { action: 'nope', key: KEY }, { action: 'feed', key: 'wrong' }, { action: 'feed', key: KEY.slice(1) }, { action: 'feed', key: KEY + 'x' },
  { action: 'feed', idToken: 'junk' }, { action: 'feed', idToken: 'wrong-aud' }, { action: 'feed', idToken: 'unverified' }, { action: 'feed', idToken: 'outsider' }, { action: 'feed', idToken: 'lookalike' }]) {
  if (q.action === 'FEED' && q.key === '') { assert.strictEqual(r.get(q), NO); continue; }
  assert.strictEqual(r.get(q), NO, JSON.stringify(q));
}
assert.strictEqual(r.calls.built, 0, 'nothing was built for a refused caller');
// the key reads; so does any signed-in @lms.org.in staff
assert.strictEqual(r.get({ action: 'feed', key: KEY }), FEED);
assert.strictEqual(r.get({ action: 'Feed', idToken: 'staff' }), FEED);
// WRITES: override and payroll refused without key / writer token (a plain staff token and a Principal are not writers)
for (const extra of [{}, { key: 'wrong' }, { idToken: 'staff' }, { idToken: 'prin' }, { idToken: 'outsider' }, { idToken: 'wrong-aud' }, { idToken: 'junk' }]) {
  assert.strictEqual(r.get(Object.assign({ overrideData: OV }, extra)), NO, 'override ' + JSON.stringify(extra));
  assert.strictEqual(r.get(Object.assign({ data: '{}' }, extra)), NO, 'payroll ' + JSON.stringify(extra));
}
assert.strictEqual(r.calls.appended.length, 0); assert.strictEqual(r.calls.payroll, 0);
assert.ok(JSON.parse(r.get({ overrideData: OV, key: KEY })).success); assert.ok(JSON.parse(r.get({ overrideData: OV, idToken: 'coord' })).success); assert.ok(JSON.parse(r.get({ overrideData: OV, idToken: 'owner' })).success);
assert.strictEqual(r.calls.appended.length, 3);
assert.ok(JSON.parse(r.get({ data: '{}', key: KEY })).success); assert.strictEqual(r.calls.payroll, 1);
// no key set / a short key: refused for everyone without a token ("empty key matches empty" never happens)
for (const props of [{ CHAPTER_SOURCES: SOURCES }, { CHAPTER_GAME_KEY: 'short', CHAPTER_SOURCES: SOURCES }]) {
  const b = boot({ props });
  assert.strictEqual(b.get({ action: 'feed', key: '' }), NO); assert.strictEqual(b.get({ action: 'feed', key: props.CHAPTER_GAME_KEY || '' }), NO);
  assert.strictEqual(b.get({ overrideData: OV, key: props.CHAPTER_GAME_KEY || '' }), NO);
}
// open, no data: the ping
assert.deepStrictEqual(JSON.parse(r.get({ op: 'ping' })), { success: true, ok: true });
// a build failure says nothing (no stack, no message)
const bad = boot({ tokens: TOKENS }); bad.ctx.getOrBuildCache = () => { throw new Error('secret detail ' + 'S'.repeat(5)); };
assert.strictEqual(bad.get({ action: 'feed', key: KEY }), JSON.stringify({ success: false, error: 'feed_unavailable' }));
// the source ids are not in the code (public repo): no long id-looking strings, the sources come from CHAPTER_SOURCES
for (const f of ['chapter-main']) { // ChapterTracker.gs's tracker sheet id and calendar ids were already in this repo: flagged to V2
  const src = fs.readFileSync(path.join(here, f + '.gs'), 'utf8');
  assert.ok(!/['"][A-Za-z0-9_-]{40,}['"]/.test(src.replace(/AKfycb[\w-]+/g, '')), f + ' holds a long id');
}
assert.throws(() => boot({ props: { CHAPTER_GAME_KEY: KEY } }).ctx.chapterSources_(), /CHAPTER_SOURCES not set/);
// every caller sends the key or a token (none fetches the bare URL)
for (const [f, re] of [['teacher-portal.gs', /TP_CWHW_PROXY_URL \+ '\?action=feed&key='/], ['coordinator.gs', /COORD_CWHW_URL \+ '\?action=feed&key='/], ['game-teacher.gs', /TCH_FEED_URL \+ tchFeedKey_\(\)/]]) assert.ok(re.test(fs.readFileSync(path.join(here, f), 'utf8')), f);
// the old teacher page (which sent the token) is a redirect stub since batch 1, 26 Nov
console.log('chapter lock: ok');
