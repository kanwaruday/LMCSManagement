// node tests/apps-script/test-allowlist-cache.js: a sheet edit (any source) reaches readEntries() within the check window.
const fs = require('fs'), assert = require('assert');
let now = 1000, lastUpdated = 0, sheetReads = 0, rows = [['email', 'name', 'campus', 'role'], ['a@x', 'A', 'LMS1', 'Principal']];
const store = {};
const cache = { get: (k) => (store[k] && store[k].until > now ? store[k].v : null), put: (k, v, s) => { store[k] = { v, until: now + s * 1000 }; }, remove: (k) => delete store[k] };
const ctx = {
  CacheService: { getScriptCache: () => cache },
  DriveApp: { getFileById: () => ({ getLastUpdated: () => ({ getTime: () => lastUpdated }) }) },
  SpreadsheetApp: { openById: () => ({ getSheets: () => [{ getDataRange: () => ({ getValues: () => { sheetReads++; return rows; } }) }] }) },
  supportSchools_: () => [], Date: { now: () => now },
};
const src = fs.readFileSync(__dirname + '/../../apps-script/principal-allowlist.gs', 'utf8');
const f = new Function(...Object.keys(ctx), src + '\nreturn { readEntries, invalidateCache_ };');
const { readEntries } = f(...Object.values(ctx));

assert.strictEqual(readEntries()[0].role, 'Principal'); assert.strictEqual(sheetReads, 1);
now += 5000; readEntries(); assert.strictEqual(sheetReads, 1, 'no change: served from cache');
rows = [rows[0], ['a@x', 'A', 'LMS1', 'Owner']]; lastUpdated = now + 1; // a direct sheet edit
now += 10000; assert.strictEqual(readEntries()[0].role, 'Principal', 'inside the 30 s check window: still cached');
now += 30000; assert.strictEqual(readEntries()[0].role, 'Owner', 'after the window: the edit shows'); assert.strictEqual(sheetReads, 2);
now += 31000; readEntries(); assert.strictEqual(sheetReads, 2, 'checked again, unchanged: no re-read');
store.allowlist_entries.v = JSON.stringify([{ email: 'old', role: 'x' }]); assert.strictEqual(readEntries()[0].email, 'old', 'pre-stamp cache entry is served');
console.log('allowlist cache: all checks passed');
