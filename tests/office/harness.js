// Test harness for the Office backend (apps-script/office*.gs).
// Loads the REAL .gs files, in the order listed under office.files in
// apps-script/projects.json (mirrors deploy), into a vm context with in-memory
// fakes of the Google services. Fake data only: this repo is public.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { makeSheet, makeBook } = require('../payroll/harness');

const ROOT = path.join(__dirname, '..', '..', 'apps-script');
const CLIENT_ID = 'fake-client-id';
const ALLOWLIST_ID = 'ALLOW-FAKE';

// Allowlist columns: email, name, campuses (comma list or ALL), roles (comma list).
const DEFAULT_FIXTURE = {
  tokens: {
    'clerk1-token': 'clerk1@example.org',
    'owner-token': 'owner@example.org',
  },
  allowlist: [
    ['Email', 'Name', 'Campuses', 'Roles'],
    ['clerk1@example.org', 'Clerk One', 'LMS1', 'FeeClerk'],
    ['owner@example.org', 'Owner', 'ALL', 'Owner'],
  ],
};

// Makes a fake sheet's setValues coerce like Google Sheets does for a range NOT formatted '@' (plain text):
// ISO dates/datetimes become Date, '='-prefixed text becomes a formula marker, numeric text becomes a Number.
function sheetsLike(sheet) {
  const getRange = sheet.getRange;
  sheet.getRange = (...a) => {
    const r = getRange(...a); let fmt = null; const setValues = r.setValues;
    r.setNumberFormat = (f) => { fmt = f; return r; };
    r.setValues = (v) => setValues(fmt === '@' ? v : v.map((row) => row.map((x) => {
      if (typeof x !== 'string') return x;
      if (/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(x)) return new Date(x);
      if (x[0] === '=') return { formula: x };
      return /^-?\d+(\.\d+)?$/.test(x) ? Number(x) : x;
    })));
    return r;
  };
  return sheet;
}
function makeOfficeBook(counter) {
  const book = makeBook({}, counter); const ins = book.insertSheet;
  book.insertSheet = (n) => sheetsLike(ins(n));
  return book;
}

// Fake Drive: folders by id, files by id. Counts creations and records every call so tests can assert none is a sharing call.
function makeDrive() {
  const d = { folders: {}, files: {}, calls: [], n: 0 };
  const folder = (name, parent) => {
    const id = 'F' + (++d.n);
    const f = {
      id, name, parent, kids: [],
      getId: () => id,
      getFoldersByName(nm) { d.calls.push('getFoldersByName'); const m = f.kids.filter((k) => d.folders[k].name === nm).map((k) => d.folders[k]); let i = 0; return { hasNext: () => i < m.length, next: () => m[i++] }; },
      createFolder(nm) { d.calls.push('createFolder'); return folder(nm, id); },
      createFile(blob) {
        d.calls.push('createFile'); const fid = 'D' + (++d.n);
        d.files[fid] = { id: fid, folder: id, name: blob.getName(), mime: blob.getContentType(), bytes: blob.getBytes(), getId: () => fid, getBlob: () => d.files[fid].blob };
        d.files[fid].blob = blob; return d.files[fid];
      },
    };
    d.folders[id] = f; if (parent) d.folders[parent].kids.push(id);
    return f;
  };
  d.root = folder('root', null);
  // 'a/b/c' path of a file's folder chain below the root.
  d.pathOf = (fid) => { const out = []; for (let f = d.folders[d.files[fid].folder]; f.parent; f = d.folders[f.parent]) out.unshift(f.name); return out.join('/'); };
  d.app = { getFolderById: (id) => { if (id !== d.root.id) throw new Error('No folder ' + id); return d.root; }, getFileById: (id) => { if (!d.files[id]) throw new Error('No file ' + id); return d.files[id]; } };
  return d;
}

// boot(fixture?, {extraSource?}) -> {ctx, call(action, data, token), books, counter, locks, setNow(date), run(code)}
// extraSource: test-only module code evaluated after the real files (e.g. an officeTestActions_ function).
function boot(fixture, opts) {
  fixture = fixture || DEFAULT_FIXTURE;
  opts = opts || {};
  const counter = { open: 0, read: 0, hdr: 0, write: 0, fetch: 0 };
  const books = { [ALLOWLIST_ID]: makeBook({ Allowlist: makeSheet(fixture.allowlist, 'Allowlist', counter) }, counter) };
  const props = { OFFICE_GOOGLE_CLIENT_ID: CLIENT_ID, OFFICE_ALLOWLIST_SHEET_ID: ALLOWLIST_ID };
  const locks = { acquired: 0, released: 0 };
  const store = new Map();
  const drive = makeDrive(); props.OFFICE_DRIVE_ROOT = drive.root.id;
  const g = {
    console,
    DriveApp: drive.app,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null) }) },
    SpreadsheetApp: {
      openById: (id) => { counter.open++; if (!books[id]) throw new Error('No fake workbook for ' + id); return books[id]; },
      flush() {},
    },
    CacheService: { getScriptCache: () => ({ get: (k) => (store.has(k) ? store.get(k) : null), put: (k, v) => store.set(k, v), remove: (k) => store.delete(k) }) },
    LockService: { getScriptLock: () => ({ waitLock() { locks.acquired++; }, releaseLock() { locks.released++; } }) },
    Utilities: {
      DigestAlgorithm: { MD5: 'md5', SHA_256: 'sha256' },
      getUuid: () => crypto.randomUUID(),
      // Like Apps Script: bytes are signed; invalid base64 throws.
      base64Decode: (s) => { if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4) throw new Error('Invalid base64'); return Array.from(Buffer.from(s, 'base64')).map((b) => (b > 127 ? b - 256 : b)); },
      base64Encode: (b) => Buffer.from(b.map((x) => (x + 256) % 256)).toString('base64'),
      newBlob: (bytes, mime, name) => ({ getBytes: () => bytes, getContentType: () => mime, getName: () => name }),
      computeDigest: (a, x) => Array.from(crypto.createHash(a).update(typeof x === 'string' ? x : Buffer.from(x)).digest()).map((b) => (b > 127 ? b - 256 : b)),
      // Only the format the backend uses; Asia/Kolkata is UTC+5:30, anything else is UTC.
      formatDate: (d, tz, f) => {
        const s = new Date(d.getTime() + (tz === 'Asia/Kolkata' ? 19800000 : 0)).toISOString();
        return f.replace('yyyy', s.slice(0, 4)).replace('MM', s.slice(5, 7)).replace('dd', s.slice(8, 10));
      },
    },
    UrlFetchApp: {
      fetch: (url) => {
        counter.fetch++;
        const who = fixture.tokens[decodeURIComponent(String(url).split('id_token=')[1] || '')];
        return { getResponseCode: () => (who ? 200 : 400), getContentText: () => JSON.stringify(who ? { aud: CLIENT_ID, email_verified: true, email: who } : {}) };
      },
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType: () => s }) },
  };
  const ctx = vm.createContext(g);
  const files = JSON.parse(fs.readFileSync(path.join(ROOT, 'projects.json'), 'utf8')).office.files;
  files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(ROOT, f + '.gs'), 'utf8'), ctx, { filename: f + '.gs' }));
  if (opts.extraSource) vm.runInContext(opts.extraSource, ctx, { filename: 'test-module.gs' });
  const call = (action, data, token) => JSON.parse(ctx.officeHandle_(action, token === undefined ? 'owner-token' : token, data || {}));
  return {
    ctx, call, books, counter, locks, props, drive,
    // Registers an empty fake book as the Script Property OFFICE_SS_<CAMPUS>_<FY>; returns it.
    addBook: (campus, fy) => { const id = 'BOOK-' + campus + '-' + fy; props['OFFICE_SS_' + campus + '_' + fy] = id; return (books[id] = makeOfficeBook(counter)); },
    // Registers an empty fake Office Config book as OFFICE_CONFIG_SS; returns it.
    addConfig: () => { props.OFFICE_CONFIG_SS = 'CONFIG-FAKE'; return (books['CONFIG-FAKE'] = makeOfficeBook(counter)); },
    setNow: (d) => { ctx.officeClock_ = d; },
    run: (code) => vm.runInContext(code, ctx),
  };
}

module.exports = { boot, makeSheet, makeBook, CLIENT_ID, ALLOWLIST_ID };
