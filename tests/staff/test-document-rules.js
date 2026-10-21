// Document rules: save from the editor -> "Document Rules" sheet -> read back gives the same rules.
// Usage: node tests/staff/test-document-rules.js
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '../..');

let sheetData = null;
const sheet = {
  clearContents() { sheetData = []; },
  getRange(r) { return { setValues(v) { v.forEach((row, i) => { sheetData[r - 1 + i] = row; }); return { setFontWeight() {} }; } }; },
  setFrozenRows() {}, setFrozenColumns() {},
  getLastRow() { return sheetData ? sheetData.length : 0; },
  getDataRange() { return { getValues() { return sheetData; } }; },
};
const ctx = {
  SpreadsheetApp: { openById: () => ({ getSheetByName: () => (sheetData ? sheet : null), insertSheet: () => sheet }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  CacheService: { getScriptCache: () => ({ remove() {} }) },
  bustStaffListCache_() {}, cachedStaff_: (k, f) => f(), RESPONSE_WORKBOOK_ID_: 'x',
};
vm.createContext(ctx);
const api = fs.readFileSync(path.join(root, 'apps-script/staff-management-api.gs'), 'utf8');
ctx.STAFF_DOCUMENT_TYPES = api.match(/const STAFF_DOCUMENT_TYPES = \[([\s\S]*?)\];/)[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
const types = ctx.STAFF_DOCUMENT_TYPES;
vm.runInContext(fs.readFileSync(path.join(root, 'apps-script/staff-documents.gs'), 'utf8') +
  ';this.D=STAFF_DOC_RULES_;this.read=staffDocRules_;this.save=sdocSaveRules_;this.key=staffDocRuleKey_;', ctx);
const letters = (r) => types.map((t) => (r.R.includes(t) ? 'R' : r.N.includes(t) ? 'N' : 'O')).join('');

// every built-in rule names only real document types, and never marks one both required and n/a
for (const [k, r] of Object.entries(ctx.D)) {
  r.R.concat(r.N).forEach((t) => assert.ok(types.includes(t), k + ': unknown type ' + t));
  assert.deepStrictEqual(r.R.filter((t) => r.N.includes(t)), [], k + ': required and n/a at once');
}
assert.strictEqual(letters(ctx.read().NTT), letters(ctx.D.NTT)); // no sheet yet -> built-in rules

const rules = {}, labels = {};
for (const k of Object.keys(ctx.D)) { rules[k] = letters(ctx.D[k]); labels[k] = k === 'HEAD MASTER/ PRINCIPAL' ? 'Head Master/ Principal' : k; }
const mi = types.indexOf('MASTER CERTIFICATE');
rules.PRT = rules.PRT.slice(0, mi) + 'R' + rules.PRT.slice(mi + 1);
assert.throws(() => ctx.save({ rules, labels }, { roles: ['Coordinator'] }), /Only the Owner/);
assert.throws(() => ctx.save({ rules: { PRT: 'RRX' }, labels }, { roles: ['Owner'] }), /Bad rule/);
ctx.save({ rules, labels }, { roles: ['Owner'] });

const back = ctx.read();
for (const k of Object.keys(rules)) assert.strictEqual(letters(back[k]), rules[k], 'round trip ' + (k || '(any other)'));
assert.ok(back.PRT.R.includes('MASTER CERTIFICATE'));
assert.strictEqual(ctx.key('Head Master/ Principal', back), 'HEAD MASTER/ PRINCIPAL');
assert.strictEqual(ctx.key('Admin Clerk + PRO', back), 'CLERK + PRO');
assert.strictEqual(ctx.key('Unknown Job', back), '');
console.log('document rules ok');
