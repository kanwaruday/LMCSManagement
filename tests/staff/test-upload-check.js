// Upload check: Drive files missing from the Documents table get added ("No form record"), once,
// and the banner counts come from the table's ID Check column. Usage: node tests/staff/test-upload-check.js
const vm = require('vm');
const fs = require('fs');
const assert = require('assert');
const gs = (f) => fs.readFileSync(__dirname + '/../../apps-script/' + f, 'utf8');

const ctx = vm.createContext({ console });
vm.runInContext(gs('staff-management-api.gs') + '\n' + gs('certificate-link-import.gs') + '\n' + gs('staff-documents.gs') +
  '\nthis.SDOC_COL_ = SDOC_COL_; this.SDOC_TABLE_HEADER_ = SDOC_TABLE_HEADER_;', ctx); // consts aren\'t context properties

// Documents table: two form rows (one fine, one blank ID) at LMS 1.
const HEADER = ctx.SDOC_TABLE_HEADER_;
let table = [HEADER,
  ['t', 'KUL/1', 'A', 'LMS 1', 'PAN CARD', 'https://drive.google.com/open?id=aaaaaaaaaaaaaaaaaaaaaaaaaaaa1', 'c', 'Form', ''],
  ['t', '', 'B', 'LMS 1', 'PAN CARD', 'https://drive.google.com/open?id=aaaaaaaaaaaaaaaaaaaaaaaaaaaa2', 'c', 'Form', 'Blank ID'],
];
const sheet = {
  getLastRow: () => table.length,
  getRange: (r, c, nr, nc) => ({
    getValues: () => table.slice(r - 1, r - 1 + nr).map((row) => row.slice(c - 1, c - 1 + nc)),
    setValues: (v) => { v.forEach((row, i) => { table[r - 1 + i] = row; }); },
  }),
};
ctx.SpreadsheetApp = { openById: () => ({ getSheetByName: () => sheet }) };
ctx.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };

// Drive: LMS 1's upload folder has the two known files plus one unknown, in a "PAN CARD (File responses) (2)" folder.
const file = (id) => ({ getId: () => id, getDateCreated: () => 'd' });
const folder = (name, files, subs) => ({
  getName: () => name,
  getFiles: () => { let i = 0; return { hasNext: () => i < files.length, next: () => files[i++] }; },
  getFolders: () => { let i = 0; return { hasNext: () => i < (subs || []).length, next: () => subs[i++] }; },
});
const pan = folder('PAN CARD (File responses) (2)', ['aaaaaaaaaaaaaaaaaaaaaaaaaaaa1', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa2', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbb3'].map(file));
const formRoot = folder('LMS 1 Staff Document Submission form (File responses)', [], [pan]);
const tree = { 'LMS 1 - Dhalpur': folder('c', [], [folder('Employee File - LMS 1', [], [formRoot])]) };
ctx.getSubfolder_ = (parent, name) => {
  if (name === 'LMS 1 - Dhalpur') return tree[name];
  if (name === 'Employee File - LMS 1') return folder('Employee File - LMS 1', [], [formRoot]);
  if (name === 'LMS 1 Staff Document Submission form (File responses)') return formRoot;
  return null;
};
ctx.DriveApp = { getFolderById: () => folder('root', []) };

const first = ctx.computeNewUploads_();
assert.strictEqual(table.length, 4, 'one unknown file added');
const added = table[3];
assert.strictEqual(added[ctx.SDOC_COL_.source], 'Drive');
assert.strictEqual(added[ctx.SDOC_COL_.check], 'No form record');
assert.strictEqual(added[ctx.SDOC_COL_.type], 'PAN CARD');
assert.strictEqual(added[ctx.SDOC_COL_.school], 'LMS 1');
assert.strictEqual(JSON.stringify(first['LMS 1']), JSON.stringify({ 'Blank ID': 1, 'No form record': 1 }));
assert.strictEqual(first['LMS 2'], null, 'a school whose folders are missing reports null');

ctx.computeNewUploads_();
assert.strictEqual(table.length, 4, 'running again adds nothing');
console.log('upload check ok');
