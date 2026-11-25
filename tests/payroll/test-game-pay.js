// node tests/payroll/test-game-pay.js -- W7 S3 (N3): the Payroll project's game gate (game-pay.gs). Loads game-pay.gs alone in a vm
// with fakes for the sheet, the lock and payRecordOffer_; checks the key, Owner only by the verified email, the school, and that the
// old 'recordoffer' function is what runs. Fake data only (public repo).
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path'), vm = require('vm');
const KEY = 'k'.repeat(40);
const calls = [];
let boom = null;
const g = {
  PAY_ALLOWLIST_SHEET_ID: 'x', PAY_MEMO: new Map(),
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => ({ GAME_KEY: KEY })[k] || null }) },
  SpreadsheetApp: { openById: () => ({ getSheets: () => [{ getDataRange: () => ({ getValues: () => [['Email', 'Name', 'Campus', 'Role'],
    ['owner@lms.org.in', 'O', 'ALL', 'Owner'], ['principal@lms.org.in', 'P', 'LMS1', 'Principal'], ['both@lms.org.in', 'B', 'ALL', 'Principal, Owner']] }) }] }) },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => calls.push(['release']) }) },
  payOpen_: () => 'SS',
  payRecordOffer_: (ss, d, caller) => { if (boom) throw new Error(boom); calls.push(['payRecordOffer_', ss, JSON.parse(JSON.stringify(d)), caller.email]); },
};
vm.createContext(g);
new vm.Script(fs.readFileSync(path.join(__dirname, '../../apps-script/game-pay.gs'), 'utf8')).runInContext(g);
const call = (extra, params) => JSON.parse(JSON.stringify(g.gamePayDispatch_(Object.assign({ action: 'gamePayRecordOffer', key: KEY, role: 'owner', email: 'owner@lms.org.in',
  campuses: ['LMS1', 'LMS2'], params }, extra))));
const P = { id: 'T-0042', name: 'New Person', campus: 'lms1', designation: 'TGT', subjects: 'English', fullBasic: '15194', epf: '1', tuition: '0', childGrades: '[]', cti: '24342', netY1: '15679' };

// the gate
assert.deepStrictEqual(call({ key: 'wrong' }, P), { success: false, error: 'not_authorized' });
assert.deepStrictEqual(call({ key: 'k'.repeat(39) }, P), { success: false, error: 'not_authorized' });
assert.deepStrictEqual(call({ action: 'gamePayRunMonth' }, P), { success: false, error: 'unknown_action' }, 'no pay run from the game');
for (const [email, role] of [['principal@lms.org.in', 'owner'], ['stranger@x.org', 'owner'], [null, 'owner'], ['owner@lms.org.in', 'principal'], ['both@lms.org.in', 'principal']])
  assert.strictEqual(call({ email, role }, P).data.code, 'not_authorized', email + ' ' + role);
assert.strictEqual(call({ campuses: ['LMS2'] }, P).data.code, 'not_found', 'a school the proxy does not give this Owner');
assert.strictEqual(call({}, { ...P, childGrades: '{nope' }).data.code, 'bad_input');
assert.strictEqual(calls.length, 0, 'nothing reached the sheet');

// the old function runs, with the school upper-cased and figures as numbers; the lock is released
let r = call({}, P);
assert.deepStrictEqual(r, { success: true, data: { ok: true, recorded: true } });
assert.deepStrictEqual(calls[0], ['payRecordOffer_', 'SS', { applicantId: 'T-0042', name: 'New Person', entity: 'LMS1', designation: 'TGT', subjects: 'English',
  fullBasic: 15194, epf: true, tuition: 0, childGrades: [], cti: 24342, netY1: 15679 }, 'owner@lms.org.in']);
assert.deepStrictEqual(calls[1], ['release']);
assert.ok(call({ email: 'both@lms.org.in' }, P).data.ok, 'an Owner who is also a Principal, acting as owner');
// refusals in plain words, unless they could carry data
boom = 'T-0042 is already Joined';
assert.deepStrictEqual(call({}, P).data, { ok: false, code: 'refused', say: 'T-0042 is already Joined' });
boom = 'Call 9000000002';
assert.deepStrictEqual(call({}, P).data, { ok: false, code: 'refused' });
boom = null;

// payroll.gs routes gamePay* to the gate before any ID-token path; projects.json deploys game-pay with the Payroll project
const src = fs.readFileSync(path.join(__dirname, '../../apps-script/payroll.gs'), 'utf8');
const post = src.slice(src.indexOf('function doPost('));
assert.ok(post.indexOf('/^gamePay[A-Z]/') !== -1 && post.indexOf('/^gamePay[A-Z]/') < post.indexOf('payHandle_('));
assert.ok(require('../../apps-script/projects.json').payroll.files.includes('game-pay'));
console.log('test-game-pay: all passed');
