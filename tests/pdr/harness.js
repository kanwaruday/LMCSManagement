// Test harness for the "LMCS Principal's Daily Reporting Backend" project
// (apps-script/main.gs + ss-forms-sync.gs + ss-tracker.gs) -- just the 3
// files the SS Submissions migration touches, not the whole pdr project
// (principal-dr.gs/teacher-ss.gs/approvals.gs/... are untouched by this
// work and load fine without the rest in a focused test, same scoping
// tests/office/harness.js and tests/payroll/harness.js already use for
// their own projects). Runs the REAL .gs files under node with in-memory
// fakes of the Google services. Fake data only: this repo is public.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { makeSheet, makeBook } = require('../payroll/harness');

const ROOT = path.join(__dirname, '..', '..', 'apps-script');
const FILES = ['main', 'ss-forms-sync', 'ss-tracker'];

const ALLOWLIST_ID = '1NZu0ElismFytG395Nxjz29vAz7OfkmJtZhs70bOwT58';
const CLIENT_ID = '697999989724-mvi85iobr20g4mm8a8nrjd1rms2o8tf6.apps.googleusercontent.com';

// payroll/harness's bare makeSheet has no setNumberFormat (its own code never
// calls it) -- ss-forms-sync.gs's new SS Submissions/SS Rubrics writers do
// (plain-text columns, see ssSubmit_/ssEnsureTab_'s own comments). A no-op
// is enough here: this harness tests the WRITTEN VALUES, not cell formatting.
function withNumberFormat(sheet) {
  const getRange = sheet.getRange;
  sheet.getRange = (...a) => { const r = getRange(...a); r.setNumberFormat = () => r; return r; };
  return sheet;
}

// A fake Book whose insertSheet() ALSO gets withNumberFormat (the lazy-create
// path ssEnsureTab_ takes for a brand-new tab), not just pre-seeded tabs.
function makeBookWithNumberFormat(tabs, counter) {
  const book = makeBook(tabs, counter);
  const insertSheet = book.insertSheet;
  book.insertSheet = (n) => withNumberFormat(insertSheet(n));
  return book;
}

/** Boots the 3 files into one vm context over `books` ({sheetId: {tabName: rows[][]}}),
 *  with `allowlistRows` (same shape as the real Allowlist sheet: Email, Name, CampusId,
 *  Role, CanApprove) and `tokens` ({idToken: {email, verified}}, verified defaults true)
 *  standing in for a real Google ID token's tokeninfo response.
 *  Returns { get(action, params), post(action, body), books, counter }. */
function boot({ books = {}, allowlistRows, tokens = {} }) {
  const counter = { open: 0, read: 0, write: 0 };
  const fakeBooks = {};
  Object.keys(books).forEach((id) => {
    const tabs = {};
    Object.keys(books[id]).forEach((n) => { tabs[n] = withNumberFormat(makeSheet(books[id][n], n, counter)); });
    fakeBooks[id] = makeBookWithNumberFormat(tabs, counter);
  });
  fakeBooks[ALLOWLIST_ID] = makeBookWithNumberFormat({ Allowlist: withNumberFormat(makeSheet(allowlistRows, 'Allowlist', counter)) }, counter);
  // getSheets()[0] (pdrAllowlistRows_) needs the Allowlist tab first regardless of insertion order.
  fakeBooks[ALLOWLIST_ID].getSheets = () => [fakeBooks[ALLOWLIST_ID].tabs.Allowlist];

  const cache = new Map();
  const g = {
    console,
    SpreadsheetApp: {
      openById: (id) => {
        counter.open++;
        // insertSheet(name) on a book not yet seeded (the lazy-create path) -- keep a growing fake.
        if (!fakeBooks[id]) fakeBooks[id] = makeBookWithNumberFormat({}, counter);
        return fakeBooks[id];
      },
    },
    CacheService: { getScriptCache: () => ({ get: (k) => (cache.has(k) ? cache.get(k) : null), put: (k, v) => cache.set(k, v) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      DigestAlgorithm: { MD5: 'md5' },
      computeDigest: (_a, x) => Array.from(crypto.createHash('md5').update(String(x)).digest()).map((b) => (b > 127 ? b - 256 : b)),
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes.map((b) => (b < 0 ? b + 256 : b))).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    },
    UrlFetchApp: {
      fetch: (url, opts) => {
        const m = /id_token=([^&]+)/.exec(String(url));
        const idToken = m ? decodeURIComponent(m[1]) : null;
        const claim = idToken && tokens[idToken];
        if (!claim) return { getResponseCode: () => 400, getContentText: () => '{}' };
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify({ aud: CLIENT_ID, email_verified: claim.verified !== false ? 'true' : 'false', email: claim.email }),
        };
      },
    },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: (text) => ({ text, setMimeType() { return this; }, getContent: () => text }),
    },
    // approvals.gs isn't loaded (out of scope for this harness -- see FILES
    // above) but doGet/doPost call its per-request memo reset unconditionally.
    aprResetRequestMemo_: () => {},
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) }, // STAFF_AUTO_SIGNIN off -- no fixture exercises the auto-signin fallback
  };
  vm.createContext(g);
  FILES.forEach((f) => new vm.Script(fs.readFileSync(path.join(ROOT, f + '.gs'), 'utf8'), { filename: f + '.gs' }).runInContext(g));

  const get = (action, params) => JSON.parse(g.doGet({ parameter: Object.assign({ action }, params) }).getContent());
  const post = (action, body) => JSON.parse(g.doPost({ postData: { contents: JSON.stringify(Object.assign({ action }, body)) } }).getContent());
  return { get, post, books: fakeBooks, counter, g };
}

module.exports = { boot, makeSheet, makeBook, ALLOWLIST_ID };
