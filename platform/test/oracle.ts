// Parity oracle: the real Apps Script files, run in a node vm over in-memory sheets, so platform code can be checked
// against what production does today. Same approach as tests/hiring/test-actions.js (sheet() shape) and
// tests/teacher-portal/test-staff-signin.js (the verifyCallerToken_ stubs).
//
//   const o = loadPdrOracle({ allowlist, tabs: { Approvals: [...], Comments: [...] }, props: { STAFF_AUTO_SIGNIN: 'on' } });
//   o.get('owner@example.test', 'approvalslist')              -> doGet's JSON, signed in as that email
//   o.post('owner@example.test', { action: 'decideapproval', id, decision, note })
//   o.ctx.aprCanDecide_(caller), o.top('APR_CATEGORIES')       -> any global function / top-level const
//   o.as('x@example.test').ctx.verifyCallerToken_('tok')       -> the caller Apps Script derives for that email
//   o.reset({ Approvals: [...] })                               -> fresh copies of the fixture tabs (plus overrides)
//   o.tabs.Approvals, o.mail                                    -> what the writes left behind
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const GS_DIR = fileURLToPath(new URL('../../apps-script/', import.meta.url));

export type Rows = unknown[][];
export type Fixture = {
  allowlist?: Rows;                 // the Allowlist sheet incl. header: Email, Name, Campus, Role, CanApprove
  tabs?: Record<string, Rows>;      // every other tab, by name (Approvals, Comments, Tasks, Recommendations, EmpMaster, ...)
  props?: Record<string, string>;   // Script Properties, e.g. { STAFF_AUTO_SIGNIN: 'on' }
  consts?: Record<string, unknown>; // replaces a one-line top-level `const NAME = ...;` before loading (e.g. APR_LEAVE_PRINCIPAL_TYPES)
  fetch?: (url: string) => { code: number; body: unknown } | undefined; // UrlFetchApp calls other than tokeninfo
  extraFiles?: string[];            // more apps-script/*.gs files to load (e.g. 'hiring.gs')
};
export type Mail = { to: string; subject: string; body: string; options?: unknown };
export type Oracle = {
  ctx: any;
  top(name: string): any;
  tabs: Record<string, Rows>;
  mail: Mail[];
  get(email: string, action: string, params?: Record<string, string>): any;
  post(email: string, body: Record<string, unknown>): any;
  as(email: string): Oracle; // the email the next tokeninfo stub returns, for calling verifyCallerToken_ / coordVerifyCaller_ directly
  reset(overrides?: Record<string, Rows>): void;
};

const PDR_FILES = ['main.gs', 'teacher-portal.gs', 'approvals.gs', 'approvals-leave.gs'];
const COORD_FILES = ['coordinator.gs', 'coordinator-approvals.gs', 'coordinator-recommend.gs'];

export const loadPdrOracle = (fx: Fixture): Oracle => load(PDR_FILES, fx);
export const loadCoordOracle = (fx: Fixture): Oracle => load(COORD_FILES, fx);

const copy = (rows: Rows): Rows => rows.map((r) => r.slice());

// In-memory sheet: 1-based getRange(r, c[, nr, nc]); grows as written, like Apps Script does.
export function sheet(rows: Rows, name: string) {
  let maxCols = 40;
  const cell = (r: number, c: number) => { const v = (rows[r - 1] || [])[c - 1]; return v === undefined ? '' : v; };
  const put = (r: number, c: number, v: unknown) => { while (rows.length < r) rows.push([]); rows[r - 1][c - 1] = v; };
  const s = {
    rows,
    getName: () => name, getSheetName: () => name,
    getLastRow: () => rows.length,
    getLastColumn: () => rows.reduce((m, r) => Math.max(m, r.length), 0),
    getMaxColumns: () => maxCols,
    insertColumnsAfter(_n: number, k: number) { maxCols += k; },
    setFrozenRows() {},
    appendRow(r: unknown[]) { rows.push(r.slice()); },
    deleteRow(r: number) { rows.splice(r - 1, 1); },
    getDataRange: () => ({ getValues: () => copy(rows) }),
    getRange(r: number, c: number, nr = 1, nc = 1) {
      const rng = {
        getValue: () => cell(r, c),
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cell(r + i, c + j))),
        setValue(v: unknown) { put(r, c, v); return rng; },
        setValues(vals: unknown[][]) { vals.forEach((vr, i) => vr.forEach((v, j) => put(r + i, c + j, v))); return rng; },
        setNumberFormat() { return rng; }, setFontWeight() { return rng; },
      };
      return rng;
    },
  };
  return s;
}

function load(files: string[], fx: Fixture): Oracle {
  let email = '';
  const mail: Mail[] = [];
  const props: Record<string, string> = { ...(fx.props || {}) };
  const o = { mail, tabs: {} as Record<string, Rows> } as Oracle;
  let sheets: Record<string, ReturnType<typeof sheet>> = {};
  let allow = sheet(copy(fx.allowlist || [['Email', 'Name', 'Campus', 'Role', 'CanApprove']]), 'Allowlist');
  o.reset = (overrides = {}) => {
    const tabs = { ...(fx.tabs || {}), ...overrides };
    sheets = {};
    o.tabs = {};
    for (const [n, rows] of Object.entries(tabs)) { sheets[n] = sheet(copy(rows), n); o.tabs[n] = sheets[n].rows; }
    allow = sheet(copy(fx.allowlist || [['Email', 'Name', 'Campus', 'Role', 'CanApprove']]), 'Allowlist');
    mail.length = 0;
  };
  o.reset();
  const top = (name: string) => vm.runInContext(name, ctx); // top-level const/let are not properties of the context
  const has = (name: string) => vm.runInContext(`typeof ${name} !== 'undefined'`, ctx);
  const allowlistId = () => (has('ALLOWLIST_SHEET_ID') ? top('ALLOWLIST_SHEET_ID') : top('COORD_ALLOWLIST_SHEET_ID'));
  const clientId = () => (has('GOOGLE_CLIENT_ID') ? top('GOOGLE_CLIENT_ID') : top('COORD_GOOGLE_CLIENT_ID'));
  const workbook = {
    getSheetByName: (n: string) => sheets[n] || null,
    insertSheet: (n: string) => { sheets[n] = sheet([], n); o.tabs[n] = sheets[n].rows; return sheets[n]; },
    getSheets: () => Object.values(sheets),
  };
  const ctx: any = {
    console: { log() {}, error() {}, warn() {} },
    Logger: { log() {} },
    Session: { getScriptTimeZone: () => 'Asia/Kolkata' },
    Utilities: {
      base64EncodeWebSafe: (x: unknown) => String(x),
      computeDigest: (_a: unknown, s: unknown) => s,
      DigestAlgorithm: { MD5: 'MD5' },
      // ponytail: enough for the formats the loaded files use (yyyy-MM-dd, d MMM); extend when a test needs another.
      formatDate: (d: Date, _tz: string, fmt: string) => {
        const ist = new Date(new Date(d).getTime() + 5.5 * 3600000).toISOString();
        if (fmt === 'yyyy-MM-dd') return ist.slice(0, 10);
        if (fmt === 'd MMM') return new Date(ist).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
        return ist;
      },
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) }, // no caching: every call re-derives
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k: string) => (k in props ? props[k] : null),
      setProperty: (k: string, v: string) => { props[k] = v; },
    }) },
    SpreadsheetApp: { openById: (id: string) => (id === allowlistId() ? { getSheets: () => [allow] } : workbook) },
    MailApp: { sendEmail: (to: any, subject?: string, body?: string, options?: unknown) => {
      mail.push(typeof to === 'object' ? { to: to.to, subject: to.subject, body: to.body, options: to } : { to, subject: subject!, body: body!, options });
    } },
    CalendarApp: { getCalendarById: () => ({ getEvents: () => [] }) },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.example.test/exec' }), getProjectTriggers: () => [] },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s: string) => ({ setMimeType: () => JSON.parse(s) }) },
    UrlFetchApp: { fetch: (url: string) => {
      const r = url.startsWith('https://oauth2.googleapis.com/tokeninfo')
        ? { code: 200, body: { aud: clientId(), email_verified: 'true', email } }
        : (fx.fetch && fx.fetch(url)) || { code: 404, body: {} };
      return { getResponseCode: () => r.code, getContentText: () => JSON.stringify(r.body) };
    } },
  };
  vm.createContext(ctx);
  for (const f of [...files, ...(fx.extraFiles || [])]) {
    let src = readFileSync(GS_DIR + f, 'utf8');
    for (const [name, value] of Object.entries(fx.consts || {})) {
      const re = new RegExp(`^const ${name} = .*;.*$`, 'm');
      if (re.test(src)) src = src.replace(re, `const ${name} = ${JSON.stringify(value)};`);
    }
    vm.runInContext(src, ctx, { filename: f });
  }
  for (const name of Object.keys(fx.consts || {})) {
    if (JSON.stringify(top(name)) !== JSON.stringify(fx.consts![name])) throw new Error(`oracle: const ${name} was not replaced`);
  }
  // JSON round trip: results come back as plain main-realm objects.
  const json = (v: unknown) => JSON.parse(JSON.stringify(v));
  o.ctx = ctx;
  o.top = top;
  o.as = (who) => { email = who; return o; };
  o.get = (who, action, params = {}) => { email = who; return json(ctx.doGet({ parameter: { idToken: 'tok-' + who, action, ...params } })); };
  o.post = (who, body) => { email = who; return json(ctx.doPost({ postData: { contents: JSON.stringify({ idToken: 'tok-' + who, ...body }) } })); };
  return o;
}
