// Test harness for the LMCS Payroll Backend (apps-script/payroll.gs + payroll-calc.gs).
// Runs the REAL backend code under node with in-memory fakes of the Google
// services it uses (SpreadsheetApp, CacheService, LockService, Utilities,
// UrlFetchApp, ContentService). Files load in Apps Script's order: payroll.gs
// first, then payroll-calc.gs -- so a top-level reference across files fails here
// exactly as it would live. Fake data only (see fixtures.js): this repo is public.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..', 'apps-script');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// A fake Sheet over a 2-D array. Counts calls so tests can measure round trips.
function makeSheet(values, name, counter) {
  const width = () => Math.max(0, ...values.map((r) => r.length));
  const pad = (r) => { const x = r.slice(); while (x.length < width()) x.push(''); return x; };
  const s = {
    values,
    getName: () => name,
    getDataRange: () => ({
      getValues: () => { counter.read++; return values.map(pad); },
      getDisplayValues: () => { counter.read++; return values.map((r) => pad(r).map((v) => String(v))); },
    }),
    getLastRow: () => values.length,
    getLastColumn: () => width(),
    getRange: (r, c, n, w) => ({
      getValues: () => { counter.hdr++; const row = values[r - 1] || []; const out = []; for (let j = 0; j < w; j++) out.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); return [out]; },
      getValue: () => (values[r - 1] || [])[c - 1],
      setValue: (x) => { counter.write++; values[r - 1] = values[r - 1] || []; values[r - 1][c - 1] = x; },
      setValues: (v) => { counter.write++; v.forEach((row, i) => { values[r - 1 + i] = values[r - 1 + i] || []; row.forEach((x, j) => { values[r - 1 + i][c - 1 + j] = x; }); }); return { setFontWeight() {} }; },
      setFontWeight() {},
    }),
    deleteRow: (i) => { counter.write++; values.splice(i - 1, 1); },
    setName: (n) => { name = n; return s; },
    setFrozenRows() {},
  };
  return s;
}

function makeBook(tabs, counter) {
  const book = {
    tabs,
    getSheetByName: (n) => tabs[n] || null,
    insertSheet: (n) => (tabs[n] = makeSheet([], n, counter)),
    getSheets: () => Object.values(tabs),
  };
  return book;
}

// Builds a fresh backend instance over the given workbooks (see fixtures.js).
// Returns { ctx, call(action, data), books, counter }.
function boot(fixture) {
  const counter = { open: 0, read: 0, hdr: 0, write: 0 };
  const books = {};
  Object.keys(fixture.books).forEach((id) => {
    const tabs = {};
    Object.keys(fixture.books[id]).forEach((n) => { tabs[n] = makeSheet(fixture.books[id][n], n, counter); });
    books[id] = makeBook(tabs, counter);
  });
  const store = new Map();
  let uid = 0;
  const g = {
    console,
    SpreadsheetApp: {
      openById: (id) => { counter.open++; const key = Object.keys(books).find((k) => id.startsWith(k)); if (!key) throw new Error('No fake workbook for ' + id); return books[key]; },
      flush() {},
    },
    CacheService: { getScriptCache: () => ({ get: (k) => (store.has(k) ? store.get(k) : null), put: (k, v) => store.set(k, v), remove: (k) => store.delete(k), removeAll: (ks) => ks.forEach((k) => store.delete(k)) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      DigestAlgorithm: { MD5: 'md5' },
      computeDigest: (a, x) => Array.from(crypto.createHash('md5').update(String(x)).digest()).map((b) => (b > 127 ? b - 256 : b)),
      getUuid: () => crypto.createHash('md5').update(String(++uid)).digest('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5'),
      formatDate: (d, tz, f) => f.replace('yyyy', d.getFullYear()).replace('MMM', MONTHS[d.getMonth()]).replace('MM', String(d.getMonth() + 1).padStart(2, '0'))
        .replace('dd', String(d.getDate()).padStart(2, '0')).replace('HH', String(d.getHours()).padStart(2, '0')).replace('mm', String(d.getMinutes()).padStart(2, '0')),
    },
    UrlFetchApp: {
      fetch: (url) => {
        const token = decodeURIComponent(String(url).split('id_token=')[1] || '');
        const who = fixture.tokens[token];
        return { getResponseCode: () => (who ? 200 : 400), getContentText: () => JSON.stringify(who ? { aud: fixture.clientId, email_verified: true, email: who } : {}) };
      },
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType: () => s }) },
  };
  const ctx = vm.createContext(g);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'payroll.gs'), 'utf8'), ctx, { filename: 'payroll.gs' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'payroll-calc.gs'), 'utf8'), ctx, { filename: 'payroll-calc.gs' });
  const call = (action, data, token) => JSON.parse(ctx.payHandle_(action, token === undefined ? 'owner-token' : token, data || {}));
  return { ctx, call, books, counter, run: (code) => vm.runInContext(code, ctx) };
}

module.exports = { boot };
