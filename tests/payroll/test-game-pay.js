// node tests/payroll/test-game-pay.js -- W7 S3 + S5a (N3): the Payroll project's game gate (game-pay.gs). Loads game-pay.gs alone in a vm
// with fakes for the sheet, the lock and payRecordOffer_; checks the key, Owner only by the verified email, the school, and that the
// old 'recordoffer' function is what runs. Fake data only (public repo).
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path'), vm = require('vm');
const KEY = 'k'.repeat(40);
const calls = [], tabs = {};
const SS = { getSheetByName: (n) => tabs[n] || null, insertSheet: (n) => { const rows = []; tabs[n] = { rows, getLastRow: () => rows.length, appendRow: (r) => rows.push(r) }; return tabs[n]; } };
let boom = null;
const g = {
  PAY_ALLOWLIST_SHEET_ID: 'x', PAY_MEMO: new Map(),
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => ({ GAME_KEY: KEY })[k] || null }) },
  SpreadsheetApp: { openById: () => ({ getSheetByName: (n) => tabs[n] || null, insertSheet: (n) => { const rows = []; tabs[n] = { rows, getLastRow: () => rows.length, appendRow: (r) => rows.push(r) }; return tabs[n]; }, getSheets: () => [{ getDataRange: () => ({ getValues: () => [['Email', 'Name', 'Campus', 'Role'],
    ['owner@lms.org.in', 'O', 'ALL', 'Owner'], ['principal@lms.org.in', 'P', 'LMS1', 'Principal'], ['both@lms.org.in', 'B', 'ALL', 'Principal, Owner']] }) }] }) },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => calls.push(['release']) }) },
  payOpen_: () => SS,
  payCheckMonth_: (m) => { if (!/^\d{4}-\d{2}$/.test(String(m || ''))) throw new Error('month must be YYYY-MM'); },
  payEntity_: (v) => String(v || '').replace(/\s+/g, '').toUpperCase(),
  payMonth_: (ss, month) => {
    calls.push(['payMonth_', ss, month]);
    if (boom) throw new Error(boom);
    return { month, daysInMonth: 30, steps: ['staff', 'leave'], extraSecret: 'x', rows: [
      { code: 'E001', name: 'Test One', entity: 'LMS1', designation: 'TGT', paidDays: 30, basic: 15194, gross: 21272, net: 15679, cti: 24342, prevNet: 15000, prevCti: 24000,
        adjustments: [{ type: 'Arrears', direction: 'Earning', amount: 500, note: 'a private note' }], bankAccount: 'SECRET-ACCT', tds: 0 },
      { code: 'E002', name: 'Test Two', entity: 'LMS3', designation: 'PRT', paidDays: 30, basic: 7000, gross: 9000, net: 8000, cti: 10000, adjustments: [] }],
      warnings: [{ entity: 'LMS1', text: 'E001 has no leave record' }, { entity: 'LMS3', text: 'E002 is on hold' }], locked: { LMS1: true, LMS3: false },
      checklist: { LMS1: { staff: { by: 'o', at: 't' } }, LMS3: {} } };
  },
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
assert.deepStrictEqual(calls[0], ['payRecordOffer_', SS, { applicantId: 'T-0042', name: 'New Person', entity: 'LMS1', designation: 'TGT', subjects: 'English',
  fullBasic: 15194, epf: true, tuition: 0, childGrades: [], cti: 24342, netY1: 15679 }, 'owner@lms.org.in']);
assert.deepStrictEqual(calls[1], ['release']);
assert.ok(call({ email: 'both@lms.org.in' }, P).data.ok, 'an Owner who is also a Principal, acting as owner');
// refusals in plain words, unless they could carry data
boom = 'T-0042 is already Joined';
assert.deepStrictEqual(call({}, P).data, { ok: false, code: 'refused', say: 'T-0042 is already Joined' });
boom = 'Call 9000000002';
assert.deepStrictEqual(call({}, P).data, { ok: false, code: 'refused' });
boom = null;

// S5a: the month, read-only. Owner only, audited first (who + month, never a figure), cut to the proxy's schools and the old Review columns
const mo = (extra, params) => call(Object.assign({ action: 'gamePayMonth' }, extra), params);
calls.length = 0;
for (const [email, role] of [['principal@lms.org.in', 'owner'], [null, 'owner'], ['owner@lms.org.in', 'principal']]) assert.strictEqual(mo({ email, role }, { month: '2026-11' }).data.code, 'not_authorized');
assert.deepStrictEqual(mo({ key: 'bad' }, { month: '2026-11' }), { success: false, error: 'not_authorized' });
assert.strictEqual(calls.length, 0, 'nothing read for a refused call');
r = mo({}, { month: '2026-11' }).data;
assert.strictEqual(r.ok, true);
assert.deepStrictEqual(r.rows.map((x) => x.code), ['E001'], 'only the proxy’s schools (LMS1 and LMS2), never LMS3');
const row = r.rows[0];
assert.strictEqual(row.net, 15679);
assert.ok(!('bankAccount' in row) && !('extraSecret' in r), 'only the register columns leave');
assert.deepStrictEqual(row.adjustments, [{ type: 'Arrears', direction: 'Earning', amount: 500 }], 'the note stays in the sheet');
assert.deepStrictEqual(r.warnings, [{ entity: 'LMS1', text: 'E001 has no leave record' }]);
assert.deepStrictEqual([r.locked, Object.keys(r.checklist)], [{ LMS1: true }, ['LMS1']]);
const looks = JSON.parse(JSON.stringify(tabs['Game Looks'].rows));
assert.deepStrictEqual(looks[0], ['At', 'Who', 'What', 'Month']);
assert.deepStrictEqual(looks[1].slice(1), ['owner@lms.org.in', 'month', '2026-11'], 'audited: who and month only');
assert.ok(!JSON.stringify(looks).includes('15679'));
assert.deepStrictEqual(mo({}, { month: 'next' }).data.code, 'refused', 'a bad month');
boom = 'sheet unavailable';
assert.deepStrictEqual(mo({}, { month: '2026-11' }).data, { ok: false, code: 'refused', say: 'sheet unavailable' });
boom = null;
assert.strictEqual(g.PAY_MEMO, null, 'the memo is cleared after a read');
// no write path: the month handler never calls a writer
assert.ok(!/payWrite_|payLock_|payUnlock_|paySaveInputs_/.test(require('fs').readFileSync(path.join(__dirname, '../../apps-script/game-pay.gs'), 'utf8').replace(/\/\/.*$/gm, '')), 'game-pay.gs calls no payroll writer in S5a');

// payroll.gs routes gamePay* to the gate before any ID-token path; projects.json deploys game-pay with the Payroll project
const src = fs.readFileSync(path.join(__dirname, '../../apps-script/payroll.gs'), 'utf8');
const post = src.slice(src.indexOf('function doPost('));
assert.ok(post.indexOf('/^gamePay[A-Z]/') !== -1 && post.indexOf('/^gamePay[A-Z]/') < post.indexOf('payHandle_('));
assert.ok(require('../../apps-script/projects.json').payroll.files.includes('game-pay'));
console.log('test-game-pay: all passed');
