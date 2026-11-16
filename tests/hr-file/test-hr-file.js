// apps-script/hr-file.gs: a staff paper to the school's HR Drive folder. Runs the real .gs (with af-video.gs, whose helpers it shares)
// in a vm against a fake Drive (a resumable session, permissions) and a fake hr-drive. Synthetic ids and bytes only, synthetic people
// (@test.invalid), no real folder id. Usage: node tests/hr-file/test-hr-file.js
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path'), crypto = require('crypto');
const read = (f) => fs.readFileSync(path.join(__dirname, '../../apps-script', f), 'utf8');

const KEY = 'r'.repeat(48), UPLOAD = '0b6f3c1e-2a4d-4e8f-9a1b-3c5d7e9f1a2b', FOLDER = 'SYNTHETICfolder000001', PART = 1310720;
const LIVE = 'https://stub.invalid/functions/v1/hr-drive';
const signed = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
const row = (o = {}) => Object.assign({ campus: 'LMS1', folder: FOLDER, mime: 'application/pdf', email: 'teacher@test.invalid', open: true }, o);

function setup({ rows = {}, rowCode = 200, papers = [], linkOnCreate = null, permsCode = 200, doneCode = 200, claimed = [] } = {}) {
  let n = 0;
  const sessions = {}, store = {}, logs = [], swept = [], done = [], claims = new Set(claimed), P = { ROSTER_GAME_KEY: KEY, HR_DRIVE_LIVE_URL: LIVE, ROSTER_WEBAPP_URL: 'https://script.google.com/macros/s/ROSTER/exec' };
  const cache = new Map();
  const resp = (code, body = '', headers = {}) => ({ getResponseCode: () => code, getContentText: () => body, getHeaders: () => headers });
  const ctx = {
    console: { log: (m) => logs.push(m), error: (m) => logs.push(m) }, JSON, String, Array, Number, Math, Object, Date,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => P[k] ?? null, setProperty: (k, v) => { P[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, v), remove: (k) => cache.delete(k) }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@test.invalid' }) },
    ScriptApp: { getOAuthToken: () => 'oauth-token', getService: () => ({ getUrl: () => 'https://x' }), triggers: [],
      getProjectTriggers() { return this.triggers; }, deleteTrigger(t) { this.triggers = this.triggers.filter((x) => x !== t); },
      newTrigger(fn) { const self = this; return { timeBased: () => ({ everyDays: () => ({ atHour: (h) => ({ create: () => self.triggers.push({ fn, h, getHandlerFunction: () => fn }) }) }) }) }; } },
    Utilities: {
      base64EncodeWebSafe: (s) => Buffer.from(typeof s === 'string' ? s : Buffer.from(s.map((b) => b & 255))).toString('base64url'),
      base64DecodeWebSafe: (s) => signed(Buffer.from(s, 'base64url')),
      base64Decode: (s) => signed(Buffer.from(s, 'base64')),
      computeHmacSha256Signature: (body, key) => signed(crypto.createHmac('sha256', key).update(body).digest()),
      newBlob: (bytes) => ({ getDataAsString: () => Buffer.from(bytes.map((b) => b & 255)).toString('utf8') }),
      getUuid: () => crypto.randomUUID(),
      formatDate: (d) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10),
    },
    UrlFetchApp: { fetch(url, o = {}) {
      const m = (o.method || 'get').toLowerCase(), h = o.headers || {};
      if (url === LIVE) {   // the fake hr-drive: claim once, done, swept, the live papers
        if (h['x-roster-key'] !== KEY) return resp(401);
        if (m === 'get') return resp(200, JSON.stringify({ papers }));
        const b = JSON.parse(o.payload);
        if (b.claim) {
          const r = b.claim in rows ? rows[b.claim] : row();
          if (rowCode !== 200) return resp(rowCode);
          if (r === false) return resp(404, '{}');
          if (claims.has(b.claim) && r.open) return resp(423, '{"error":"ticket_issued"}');
          claims.add(b.claim); return resp(200, JSON.stringify({ upload: r }));
        }
        if (b.done) { done.push([b.done, b.file]); return resp(doneCode, doneCode === 200 ? '{"ok":true}' : '{}'); }
        swept.push(b.swept); return resp(200, '{"returned":1}');
      }
      if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable') && m === 'post') {
        const s = 'https://upload.stub/session/' + (++n); sessions[s] = { meta: JSON.parse(o.payload), got: [], len: 0 }; return resp(200, '', { Location: s });
      }
      if (sessions[url] && m === 'put') {
        const s = sessions[url], r = h['Content-Range'];
        if (/^bytes \*\//.test(r)) return s.file ? resp(200, JSON.stringify({ id: s.file })) : resp(308, '', s.len ? { Range: 'bytes=0-' + (s.len - 1) } : {});
        const [, a, , total] = r.match(/^bytes (\d+)-(\d+)\/(\d+|\*)$/);
        assert.strictEqual(Number(a), s.len);
        s.got.push(Buffer.from(o.payload.map((x) => x & 255))); s.len += s.got[s.got.length - 1].length;
        if (total !== '*' && s.len === Number(total)) {
          const id = 'SYNTHETICfile' + String(++n).padStart(8, '0');
          store[id] = { meta: s.meta, perms: [{ type: 'user' }, { type: 'group' }].concat(linkOnCreate ? [{ type: linkOnCreate }] : []), trashed: false };
          s.file = id;
        }
        return s.file ? resp(200, JSON.stringify({ id: s.file })) : resp(308, '', { Range: 'bytes=0-' + (s.len - 1) });
      }
      const meta = url.match(/drive\/v3\/files\/([A-Za-z0-9_-]+)\?supportsAllDrives=true&fields=parents,appProperties/);
      if (meta && m === 'get') return store[meta[1]] ? resp(200, JSON.stringify({ parents: store[meta[1]].meta.parents, appProperties: store[meta[1]].meta.appProperties })) : resp(404, '{}');
      const pm = url.match(/drive\/v3\/files\/([A-Za-z0-9_-]+)\/permissions/);
      if (pm && m === 'get') return permsCode !== 200 ? resp(permsCode, '{}') : store[pm[1]] ? resp(200, JSON.stringify({ permissions: store[pm[1]].perms })) : resp(404, '{}');
      const fm = url.match(/drive\/v3\/files\/([A-Za-z0-9_-]+)\?/);
      if (fm && m === 'patch') { if (store[fm[1]] && JSON.parse(o.payload).trashed) store[fm[1]].trashed = true; return resp(200, '{}'); }
      throw new Error('unexpected fetch ' + m + ' ' + url);
    } },
  };
  vm.createContext(ctx);
  vm.runInContext(read('af-video.gs'), ctx);
  vm.runInContext(read('hr-file.gs'), ctx);
  const J = (x) => JSON.parse(JSON.stringify(x));
  const ticket = (o = {}) => J(ctx.gameHrFileTicket_(Object.assign({ action: 'gameHrFileTicket', key: KEY, role: 'teacher', campus: 'LMS1', email: 'teacher@test.invalid', params: { upload: UPLOAD } }, o)));
  const upload = (url, bytes) => {
    const u = new URL(url), of = Math.ceil(bytes.length / PART);
    let last;
    for (let part = 1; part <= of; part++) {
      last = J(ctx.gameHrFilePart_({ action: u.searchParams.get('action'), ticket: u.searchParams.get('ticket'), part, of, base64: bytes.subarray((part - 1) * PART, part * PART).toString('base64') }));
      if (!last.success) return last;
    }
    return last;
  };
  return { ctx, ticket, upload, store, sessions, logs, swept, done, P };
}

const results = [];
const T = (name, fn) => { try { fn(); results.push('  ok  - ' + name); } catch (e) { results.push('  FAIL - ' + name + '\n       ' + e.message); } };
const pdf = Buffer.concat([Buffer.from('%PDF-1.4 synthetic\n'), Buffer.alloc(PART + 5000, 7)]);   // two parts, synthetic bytes

T('a ticket for the caller\'s own open upload: the folder, name and type come from the row, never the app', () => {
  const s = setup(), t = s.ticket();
  assert.ok(t.success && /action=gameHrFilePart/.test(t.data.url));
  const r = s.upload(t.data.url, pdf);
  assert.ok(r.success && /^SYNTHETICfile/.test(r.fileId));
  const meta = Object.values(s.sessions)[0].meta;
  assert.deepStrictEqual(meta.parents, [FOLDER]); assert.strictEqual(meta.name, UPLOAD + '.pdf'); assert.strictEqual(meta.mimeType, 'application/pdf');
  assert.strictEqual(meta.copyRequiresWriterPermission, true);
  assert.deepStrictEqual(meta.appProperties, { lmsStaffPaper: UPLOAD }, 'tagged for this upload at create');
  assert.strictEqual(s.store[r.fileId].trashed, false);
  assert.deepStrictEqual(s.done, [[UPLOAD, r.fileId]], 'the Roster records it with the game, keyed by the ticket\'s upload id');
});

T('one ticket per open upload (G2): a second ticket for the same upload is refused', () => {
  const s = setup();
  assert.ok(s.ticket().success);
  assert.strictEqual(s.ticket().data.code, 'ticket_issued');
});

T('if the game can\'t record the finished paper, the file is trashed (no paper it doesn\'t know about)', () => {
  const s = setup({ doneCode: 500 }), r = s.upload(s.ticket().data.url, pdf);
  assert.strictEqual(r.success, false); assert.strictEqual(r.error, 'RECORD');
  assert.ok(Object.values(s.store).every((f) => f.trashed));
});

T('refusals: wrong key, the Owner\'s role, someone else\'s row, another school, a finished row, no folder, hr-drive down, a bad id', () => {
  assert.strictEqual(setup().ticket({ key: 'x'.repeat(48) }).error, 'not_authorized');
  assert.strictEqual(setup().ticket({ role: 'owner' }).data.code, 'not_authorized');
  assert.strictEqual(setup({ rows: { [UPLOAD]: row({ email: 'other@test.invalid' }) } }).ticket().data.code, 'not_authorized');
  assert.strictEqual(setup({ rows: { [UPLOAD]: row({ campus: 'LMS2' }) } }).ticket().data.code, 'not_authorized');
  assert.strictEqual(setup({ rows: { [UPLOAD]: row({ open: false }) } }).ticket().data.code, 'done');
  assert.strictEqual(setup({ rowCode: 409 }).ticket().data.code, 'not_configured');
  assert.strictEqual(setup({ rowCode: 500 }).ticket().data.code, 'not_configured');
  assert.strictEqual(setup({ rows: { [UPLOAD]: false } }).ticket().data.code, 'not_authorized');
  assert.strictEqual(setup().ticket({ params: { upload: 'x' } }).data.code, 'bad_input');
  assert.strictEqual(setup({ rows: { [UPLOAD]: row({ mime: 'video/mp4' }) } }).ticket().data.code, 'bad_input');
});

T('a paper that lands with a link (anyone or a domain) or unreadable permissions is trashed and refused', () => {
  for (const [link, code, err] of [['anyone', 200, 'OVERSHARED'], ['domain', 200, 'OVERSHARED'], [null, 500, 'SHARE_CHECK']]) {
    const s = setup({ linkOnCreate: link, permsCode: code }), t = s.ticket(), r = s.upload(t.data.url, pdf);
    assert.strictEqual(r.success, false); assert.strictEqual(r.error, err);
    assert.ok(Object.values(s.store).every((f) => f.trashed), 'the file is in the trash');
    assert.strictEqual(s.upload(t.data.url, pdf).success, false, 'a spent ticket never uploads again');
  }
});

T('an AF ticket never uploads into an HR folder; parts over the 10 MB cap are refused', () => {
  const s = setup(), t = s.ticket(), u = new URL(t.data.url);
  const body = JSON.parse(Buffer.from(u.searchParams.get('ticket').split('.')[0], 'base64url').toString());
  assert.strictEqual(body.k, 'hr');
  const forged = Buffer.from(JSON.stringify(Object.assign({}, body, { k: undefined }))).toString('base64url');
  const sig = Buffer.from(crypto.createHmac('sha256', KEY).update(forged).digest()).toString('base64url');
  assert.strictEqual(s.ctx.gameHrFilePart_({ ticket: forged + '.' + sig, part: 1, of: 1, base64: 'AA==' }).error, 'not_authorized');
  assert.strictEqual(s.ctx.gameHrFilePart_({ ticket: u.searchParams.get('ticket'), part: 1, of: 9, base64: 'AA==' }).error, 'BAD_PART');
});

T('the daily sweep trashes a paper shared by link later and tells hr-drive; untouched ones stay; unreadable ones wait', () => {
  const s = setup(), r = s.upload(s.ticket().data.url, pdf);
  const s2 = setup({ papers: [{ id: r.fileId, upload: UPLOAD, folder: FOLDER }] });
  Object.assign(s2.store, s.store);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(s2.ctx.hrFileDaily())), { checked: 1, trashed: 0, unreadable: 0, foreign: 0 });
  s2.store[r.fileId].perms.push({ type: 'anyone' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(s2.ctx.hrFileDaily())), { checked: 1, trashed: 1, unreadable: 0, foreign: 0 });
  assert.strictEqual(s2.store[r.fileId].trashed, true); assert.deepStrictEqual(s2.swept, [r.fileId]);
  const s3 = setup({ papers: [{ id: r.fileId, upload: UPLOAD, folder: FOLDER }], permsCode: 500 });
  Object.assign(s3.store, JSON.parse(JSON.stringify(s.store)));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(s3.ctx.hrFileDaily())), { checked: 1, trashed: 0, unreadable: 1, foreign: 0 });
  assert.deepStrictEqual(s3.swept, []);
});

T('G2b: a foreign link-shared file (no tag, wrong upload or outside the HR folder) is never swept', () => {
  const s = setup(), r = s.upload(s.ticket().data.url, pdf);
  const school = 'SCHOOLdoc0000000001', OTHER = '1c7a4d2f-3b5e-4f9a-8b2c-4d6e8f0a2b3c';
  const s2 = setup({ papers: [{ id: school, upload: UPLOAD, folder: FOLDER }, { id: r.fileId, upload: OTHER, folder: FOLDER },
    { id: r.fileId, upload: UPLOAD, folder: 'SOMEotherFolder00001' }] });
  Object.assign(s2.store, s.store);
  s2.store[school] = { meta: { parents: ['SCHOOLdocsFolder0001'] }, perms: [{ type: 'anyone' }], trashed: false };   // a school document shared by link
  s2.store[r.fileId].perms.push({ type: 'anyone' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(s2.ctx.hrFileDaily())), { checked: 0, trashed: 0, unreadable: 0, foreign: 3 });
  assert.strictEqual(s2.store[school].trashed, false, 'the school document is untouched');
  assert.strictEqual(s2.store[r.fileId].trashed, false, 'a tagged file listed under another upload or folder is untouched too');
  assert.deepStrictEqual(s2.swept, []);
});

T('logs carry codes and counts only; the trigger installs once at about 04:00', () => {
  const s = setup({ linkOnCreate: 'anyone' }); s.upload(s.ticket().data.url, pdf);
  assert.ok(s.logs.every((l) => !/@|SYNTHETICfolder|\.pdf/.test(String(l))), 'no email, folder or file name in a log');
  s.ctx.installHrFileTrigger(); s.ctx.installHrFileTrigger();
  assert.deepStrictEqual(s.ctx.ScriptApp.triggers.map((x) => [x.fn, x.h]), [['hrFileDaily', 4]]);
});

console.log(results.join('\n'));
if (results.some((r) => r.includes('FAIL'))) process.exit(1);
