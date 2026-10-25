// node tests/game/test-auth.js -- employee sign-in fallback: the pure gate, then gameVerifyCaller_ with the Google services faked
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const J = (x) => JSON.parse(JSON.stringify(x));

function load(extra) {
  const ctx = Object.assign({ console, JSON }, extra || {});
  vm.createContext(ctx);
  for (const f of ['game.gs', 'game-actions.gs']) vm.runInContext(fs.readFileSync(__dirname + '/../../apps-script/' + f, 'utf8'), ctx);
  return ctx;
}

// ── the pure gate ──────────────────────────────────────────────────────
const ctx = load();
const E = 'someone@lms.org.in';
const ok = { campusId: 'LMS4', employeeCode: 'NCM/99/09/904', role: 'Teacher' };
const gate = (flag, fn, email) => J(ctx.gameCallerFromFallback_(email === undefined ? E : email, flag, fn));
const fb = (r) => () => r;

assert.deepStrictEqual(gate('on', fb(ok)), { email: E, campusId: 'LMS4', roles: ['Teacher'], primaryRole: 'Teacher', canDecide: false, employeeCode: 'NCM/99/09/904' });
assert.deepStrictEqual(gate('on', fb(Object.assign({}, ok, { role: 'Staff' }))), { email: E, campusId: 'LMS4', roles: ['Staff'], primaryRole: 'Staff', canDecide: false, employeeCode: 'NCM/99/09/904' });
assert.strictEqual(gate('on', fb(Object.assign({}, ok, { campusId: ' lms6 ' }))).campusId, 'LMS6');          // trimmed + upper-cased
assert.strictEqual(gate('on', fb({ campusId: 'LMS1', role: 'Teacher' })).employeeCode, '');                  // missing code -> ''
assert.strictEqual(gate('on', fb(ok), 'Mixed.Case@LMS.org.in').email, 'mixed.case@lms.org.in');             // verified email, lower-cased

assert.strictEqual(gate('on', fb({ campusId: 'LMS1', role: 'Staff', employeeCode: 4521 })).employeeCode, '4521'); // a numeric code from Sheets

// the fallback is called with the lower-cased verified email, nothing else
let seen; gate('on', function (e) { seen = [e, arguments.length]; return null; }, 'A.B@LMS.org.in');
assert.deepStrictEqual(seen, ['a.b@lms.org.in', 1]);

// no role above Teacher/Staff, ever
for (const role of ['Owner', 'Principal', 'Coordinator', 'Fee Clerk', '', 'teacher', 'STAFF', ' Teacher', 'Teacher ', undefined, null, 5, ['Teacher'], { toString: () => 'Teacher' }])
  assert.strictEqual(gate('on', fb({ campusId: 'LMS4', employeeCode: 'x', role })), null, 'role ' + String(role));
assert.strictEqual(gate('on', fb({ campusId: 'LMS4', employeeCode: 'x' })), null);

// extra fields from the fallback are ignored
const sneaky = { campusId: 'LMS4', role: 'Teacher', roles: ['Owner'], primaryRole: 'Owner', canDecide: true, email: 'other@x', employeeCode: 'E1' };
assert.deepStrictEqual(gate('on', fb(sneaky)), { email: E, campusId: 'LMS4', roles: ['Teacher'], primaryRole: 'Teacher', canDecide: false, employeeCode: 'E1' });

// the switch is exactly 'on'
for (const flag of ['ON', 'On', 'on ', ' on', 'off', 'true', '1', '', null, undefined, true, 1])
  assert.strictEqual(gate(flag, fb(ok)), null, 'flag ' + String(flag));
let called = false; gate('off', () => { called = true; return ok; }); assert.strictEqual(called, false); // flag off: the lookup never runs

// no fallback / bad result / throw
for (const fn of [undefined, null, 'x', {}, fb(null), fb(undefined), fb('LMS4'), fb(5), fb([]), fb(true), () => { throw new Error('boom'); }])
  assert.strictEqual(gate('on', fn), null);
// campus must be one of LMS1-LMS6
for (const campusId of ['ALL', 'HES', '', 'LMS7', 'LMS0', 'LMS 4', 'LMS44', undefined, null, ['LMS4'], 4])
  assert.strictEqual(gate('on', fb({ campusId, role: 'Teacher' })), null, 'campus ' + String(campusId));
for (const c of ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6']) assert.strictEqual(gate('on', fb({ campusId: c, role: 'Staff' })).campusId, c);
// no verified email -> nothing to look up
assert.strictEqual(gate('on', fb(ok), ''), null);
assert.strictEqual(gate('on', fb(ok), null), null);

// M34: role is read once -- a getter that answers 'Teacher' to the checks and 'Owner' afterwards still yields Teacher (or null)
let reads = 0;
const shifty = { campusId: 'LMS4', employeeCode: 'x', get role() { return ++reads <= 2 ? 'Teacher' : 'Owner'; } };
const sh = gate('on', fb(shifty));
assert.ok(sh === null || (sh.primaryRole === 'Teacher' && sh.roles.length === 1 && sh.roles[0] === 'Teacher'), 'shifting role: ' + JSON.stringify(sh));

// the constants a module file must not be able to widen
assert.deepStrictEqual(J(vm.runInContext('GAME_FALLBACK_ROLES', ctx)), ['Teacher', 'Staff']);
assert.throws(() => vm.runInContext("'use strict'; GAME_FALLBACK_ROLES.push('Owner')", ctx));
assert.strictEqual(J(vm.runInContext('GAME_FALLBACK_ROLES', ctx)).length, 2);

// config: Staff is in the pilot for every campus; Buddy stays their speaker (no entry)
const cfg = ctx.gameParseConfig_([['Key', 'Value']]);
assert.strictEqual(cfg.pilotCampuses.Staff, 'ALL');
assert.strictEqual(cfg.speaker.Staff, undefined);
assert.strictEqual(ctx.gamePilotPasses_({ primaryRole: 'Staff', campusId: 'LMS2' }, cfg), true);

// registry: guarded, so a module file may register before game.gs loads
const pre = { console, JSON }; vm.createContext(pre);
vm.runInContext("var GAME_CALLER_FALLBACKS = GAME_CALLER_FALLBACKS || {}; GAME_CALLER_FALLBACKS.employee = function () { return 1; };", pre);
for (const f of ['game.gs']) vm.runInContext(fs.readFileSync(__dirname + '/../../apps-script/' + f, 'utf8'), pre);
assert.strictEqual(typeof vm.runInContext('GAME_CALLER_FALLBACKS.employee', pre), 'function');

// ── gameVerifyCaller_ with the services faked ──────────────────────────
function world(o) {
  o = o || {};
  const store = {}, puts = [], log = { allowlistReads: 0, fallbackCalls: 0 };
  const svc = {
    CacheService: { getScriptCache: () => ({ get: (k) => (k in store ? store[k] : null), put: (k, v, s) => { store[k] = v; puts.push([k, v, s]); } }) },
    Utilities: { base64EncodeWebSafe: (x) => String(x), computeDigest: (a, s) => s, DigestAlgorithm: { MD5: 'MD5' } },
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => o.code || 200, getContentText: () => JSON.stringify(o.payload || { aud: '697999989724-mvi85iobr20g4mm8a8nrjd1rms2o8tf6.apps.googleusercontent.com', email: 'Emp@LMS.org.in', email_verified: 'true' }) }) },
    SpreadsheetApp: { openById: () => ({ getSheets: () => [{ getDataRange: () => ({ getValues: () => { log.allowlistReads++; return o.rows || [['Email', '', '', 'Roles', 'CanDecide']]; } }) }] }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === 'STAFF_AUTO_SIGNIN' ? (o.flag === undefined ? null : o.flag) : null) }) },
  };
  const c = load(svc);
  if (o.fn) { c.__fn = (e) => { log.fallbackCalls++; return o.fn(e); }; vm.runInContext('GAME_CALLER_FALLBACKS.employee = __fn', c); }
  return { c, store, puts, log };
}
const verify = (w, tok) => J(w.c.gameVerifyCaller_(tok || 'tok'));
const emp = () => ({ campusId: 'LMS4', employeeCode: 'E104', role: 'Teacher' });
const TEACHER = { email: 'emp@lms.org.in', campusId: 'LMS4', roles: ['Teacher'], primaryRole: 'Teacher', canDecide: false, employeeCode: 'E104' };

// flag on, allowlist miss -> fallback caller, cached 5 min
let w = world({ flag: 'on', fn: emp });
assert.deepStrictEqual(verify(w), TEACHER);
assert.strictEqual(w.puts.length, 1); assert.strictEqual(w.puts[0][2], 300);
assert.deepStrictEqual(JSON.parse(w.puts[0][1]), TEACHER);
verify(w); assert.strictEqual(w.log.fallbackCalls, 1);            // second call is a cache hit

// flag off / unset / wrong case: null, the lookup never runs, nothing cached
for (const flag of [undefined, null, 'off', 'ON', 'on ', '']) {
  w = world({ flag, fn: emp });
  assert.strictEqual(w.c.gameVerifyCaller_('tok'), null, 'flag ' + String(flag));
  assert.strictEqual(w.log.fallbackCalls, 0); assert.strictEqual(w.puts.length, 0);
}
// flag on but no fallback registered: null, null not cached
w = world({ flag: 'on' });
assert.strictEqual(w.c.gameVerifyCaller_('tok'), null); assert.strictEqual(w.puts.length, 0);
// fallback null / invalid / throws: null, not cached
for (const fn of [() => null, () => ({ campusId: 'ALL', role: 'Teacher' }), () => ({ campusId: 'LMS4', role: 'Owner' }), () => { throw new Error('x'); }]) {
  w = world({ flag: 'on', fn });
  assert.strictEqual(w.c.gameVerifyCaller_('tok'), null); assert.strictEqual(w.puts.length, 0);
}

// an allowlist hit always wins: the fallback is never consulted, even for a higher or lower role
const row = (roles, campus) => [['Email', '', '', 'Roles', 'CanDecide'], ['emp@lms.org.in', '', campus || 'LMS2', roles, 'TRUE']];
w = world({ flag: 'on', fn: emp, rows: row('Principal') });
assert.deepStrictEqual(verify(w), { email: 'emp@lms.org.in', campusId: 'LMS2', roles: ['Principal'], primaryRole: 'Principal', canDecide: false });
assert.strictEqual(w.log.fallbackCalls, 0);
w = world({ flag: 'on', fn: emp, rows: row('Coordinator', 'ALL') });
assert.strictEqual(verify(w).canDecide, true);                        // allowlist semantics unchanged
assert.strictEqual(w.log.fallbackCalls, 0);
// an allowlisted row with no roles is a miss for the allowlist (as today: null) and does not fall through to the fallback
w = world({ flag: 'on', fn: emp, rows: row('') });
assert.strictEqual(w.c.gameVerifyCaller_('tok'), null); assert.strictEqual(w.log.fallbackCalls, 0);

// the token checks run before any fallback: bad aud, unverified email, HTTP error, no token
const good = { aud: '697999989724-mvi85iobr20g4mm8a8nrjd1rms2o8tf6.apps.googleusercontent.com', email: 'emp@lms.org.in', email_verified: 'true' };
for (const o of [{ payload: Object.assign({}, good, { aud: 'other' }) }, { payload: Object.assign({}, good, { email_verified: 'false' }) }, { payload: Object.assign({}, good, { email_verified: undefined }) }, { code: 401 }]) {
  w = world(Object.assign({ flag: 'on', fn: emp }, o));
  assert.strictEqual(w.c.gameVerifyCaller_('tok'), null); assert.strictEqual(w.log.fallbackCalls, 0);
}
w = world({ flag: 'on', fn: emp }); assert.strictEqual(w.c.gameVerifyCaller_(''), null); assert.strictEqual(w.log.fallbackCalls, 0);
// a verified token with no email never reaches the fallback
w = world({ flag: 'on', fn: emp, payload: { aud: good.aud, email_verified: true } });
assert.strictEqual(w.c.gameVerifyCaller_('tok'), null); assert.strictEqual(w.log.fallbackCalls, 0);

console.log('game auth tests passed');
