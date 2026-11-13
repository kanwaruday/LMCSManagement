// apps-script/af-video.gs: AF dance videos to each school's Drive. Runs the real .gs in a vm against a fake Drive (folders, a
// resumable-upload session, permissions) and a fake allowlist. Synthetic clip only (a made-up MP4 header and a byte pattern),
// synthetic people (@test.invalid). Usage: node tests/af-video/test-af-video.js
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path'), crypto = require('crypto');
const src = fs.readFileSync(path.join(__dirname, '../../apps-script/af-video.gs'), 'utf8');

const KEY = 'r'.repeat(48), ME = 'owner@test.invalid', PRINCIPAL = 'principal1@test.invalid', ACC = 'accountable@test.invalid';
const VIDEO = '0b6f3c1e-2a4d-4e8f-9a1b-3c5d7e9f1a2b', PART = 1310720;
const signed = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));

// the event_videos rows af-drive answers (541's, as the server reads them): the caller's own unfinished row unless a test says otherwise
const row = (o = {}) => Object.assign({ campus: 'LMS1', event: 'af2026', mime: 'video/mp4', deleteAfter: '2026-12-24', email: 'teacher@test.invalid', open: true }, o);
function setup({ props = {}, lose = 0, inherited = null, live = null, liveCode = 200, rows = {}, rowCode = 200, now = Date.parse('2026-11-14T05:00:00Z') } = {}) {
  let ids = 0, sessions = {}, lost = 0;
  const reg = {}, store = {}, logs = [], calls = [];
  const folder = (name) => {
    const f = { name, id: 'FOLDER' + String(++ids).padStart(6, '0'), kids: [], files: [], getId: () => f.id, getName: () => name,
      getFoldersByName(n) { const m = f.kids.filter((k) => k.name === n); let i = 0; return { hasNext: () => i < m.length, next: () => m[i++] }; },
      getFolders() { let i = 0; return { hasNext: () => i < f.kids.length, next: () => f.kids[i++] }; },
      getFiles() { const m = f.files.filter((x) => !x.trashed); let i = 0; return { hasNext: () => i < m.length, next: () => m[i++].api }; },
      createFolder(n) { const k = folder(n); f.kids.push(k); return k; } };
    reg[f.id] = f; return f;
  };
  const central = folder('LMCS Repository');
  ['LMS 1 - Dhalpur', 'LMS 2 - Kelheli'].forEach((n) => central.createFolder(n));
  const addFile = (meta, bytes) => {
    const id = 'DRIVEfile' + String(++ids).padStart(8, '0');
    const x = { id, meta, name: meta.name, mime: meta.mimeType, description: meta.description, bytes, trashed: false, created: new Date(now),
      perms: [{ type: 'user', emailAddress: ME }].concat(inherited ? [inherited] : []) };
    x.api = { getId: () => id, getDescription: () => x.description, getDateCreated: () => x.created, setTrashed: (v) => { x.trashed = v; } };
    store[id] = x; reg[meta.parents[0]].files.push(x); return x;
  };
  const resp = (code, body = '', headers = {}) => ({ getResponseCode: () => code, getContentText: () => body, getHeaders: () => headers });
  const P = Object.assign({ ROSTER_GAME_KEY: KEY, AF_VIDEO_ACCOUNTABLE: ACC, AF_VIDEO_OWNER: ME, AF_VIDEO_LIVE_URL: 'https://stub.invalid/functions/v1/af-drive',
    ROSTER_WEBAPP_URL: 'https://script.google.com/macros/s/ROSTER/exec' }, props);
  const cache = new Map();
  const ctx = {
    console: { log: (m) => logs.push(m), error: (m) => logs.push(m) }, JSON, String, Array, Number, Math, Object, Date: class extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => P[k] ?? null, setProperty: (k, v) => { P[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, v), remove: (k) => cache.delete(k) }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => ME }) },
    ScriptApp: { getOAuthToken: () => 'oauth-token', getService: () => ({ getUrl: () => 'https://x' }), triggers: [],
      getProjectTriggers() { return this.triggers; }, deleteTrigger(t) { this.triggers = this.triggers.filter((x) => x !== t); },
      newTrigger(fn) { const self = this; return { timeBased: () => ({ everyDays: () => ({ atHour: (h) => ({ create: () => self.triggers.push({ fn, h, getHandlerFunction: () => fn }) }) }) }) }; } },
    DriveApp: { getFolderById: (id) => { if (!reg[id]) throw new Error('no folder'); return reg[id]; } },
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
      calls.push({ url, m, range: h['Content-Range'], auth: h.Authorization });
      if (url.startsWith(P.AF_VIDEO_LIVE_URL + '?video=')) {
        if (h['x-roster-key'] !== KEY) return resp(401);
        const v = url.split('?video=')[1], r = v in rows ? rows[v] : row();
        return rowCode !== 200 ? resp(rowCode) : r === false ? resp(404, '{}') : resp(200, JSON.stringify({ video: r }));
      }
      if (url === P.AF_VIDEO_LIVE_URL) return h['x-roster-key'] === KEY ? resp(liveCode, JSON.stringify({ ids: typeof live === 'function' ? live() : live || [] })) : resp(401);
      if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable') && m === 'post') {
        const s = 'https://upload.stub/session/' + (++ids); sessions[s] = { meta: JSON.parse(o.payload), got: [], len: 0 };
        return resp(200, '', { Location: s });
      }
      if (sessions[url] && m === 'put') {
        const s = sessions[url], r = h['Content-Range'];
        const held = () => (s.len ? { Range: 'bytes=0-' + (s.len - 1) } : {});
        if (/^bytes \*\//.test(r)) return s.file ? resp(200, JSON.stringify({ id: s.file.id })) : resp(308, '', held());
        const [, a, b, total] = r.match(/^bytes (\d+)-(\d+)\/(\d+|\*)$/);
        assert.strictEqual(Number(a), s.len, 'every part starts where Drive left off');
        const chunk = Buffer.from(o.payload.map((x) => x & 255));
        assert.strictEqual(chunk.length, Number(b) - Number(a) + 1);
        if (total === '*') assert.strictEqual(chunk.length % 262144, 0, 'a middle part is a multiple of 256 KiB');
        s.got.push(chunk); s.len += chunk.length;
        if (total !== '*' && s.len === Number(total)) s.file = addFile(s.meta, Buffer.concat(s.got));
        if (lost < lose) { lost++; return resp(503); } // stored, but the answer is lost
        return s.file ? resp(200, JSON.stringify({ id: s.file.id })) : resp(308, '', held());
      }
      const pm = url.match(/drive\/v3\/files\/([A-Za-z0-9_-]+)\/permissions/);
      if (pm && m === 'post') { const b = JSON.parse(o.payload); assert.ok(url.includes('sendNotificationEmail=false')); store[pm[1]].perms.push({ type: b.type, emailAddress: b.emailAddress, role: b.role }); return resp(200, '{}'); }
      if (pm && m === 'get') return resp(200, JSON.stringify({ permissions: store[pm[1]].perms.map((x) => ({ type: x.type, emailAddress: x.emailAddress, permissionDetails: x.permissionDetails })) }));
      const fm = url.match(/drive\/v3\/files\/([A-Za-z0-9_-]+)\?/);
      if (fm && m === 'patch') { const b = JSON.parse(o.payload); if (store[fm[1]] && b.trashed) store[fm[1]].trashed = true; return resp(200, '{}'); }
      throw new Error('unexpected fetch ' + m + ' ' + url);
    } },
  };
  vm.createContext(ctx);
  vm.runInContext(`var CENTRAL_REPO_FOLDER_ID_ = '${central.id}';
    var SCHOOL_TO_CAMPUS_DIR_ = { 'LMS 1': 'LMS 1 - Dhalpur', 'LMS 2': 'LMS 2 - Kelheli' };
    var STAFF_CAMPUS_SHEET_LABEL_ = { LMS1: 'LMS 1', LMS2: 'LMS 2' };
    function getSubfolder_(parent, name) { const it = parent.getFoldersByName(name); return it.hasNext() ? it.next() : null; }
    function readEntries() { return [{ email: '${PRINCIPAL}', campusId: 'LMS1', role: 'Principal' }, { email: 'principal2@test.invalid', campusId: 'LMS2', role: 'Principal' },
      { email: 'teacher@test.invalid', campusId: 'LMS1', role: 'Teacher' }]; }`, ctx);
  vm.runInContext(src, ctx);
  const J = (x) => JSON.parse(JSON.stringify(x));
  const ticket = (params, o = {}) => J(ctx.gameAfVideoTicket_(Object.assign({ action: 'gameAfVideoTicket', key: KEY, role: 'teacher', campus: 'LMS1', email: 'teacher@test.invalid',
    params: Object.assign({ video: VIDEO, event: 'af2026', deleteAfter: '2026-12-24', fileName: VIDEO + '.mp4' }, params) }, o)));
  // the browser side, as app/src/classic/upload.ts: the ticket and action from the URL, parts of PART bytes, a part resent on failure
  const upload = (url, clip, { tries = 3 } = {}) => {
    const u = new URL(url), of = Math.ceil(clip.length / PART);
    let last;
    for (let part = 1; part <= of; part++) {
      const body = { action: u.searchParams.get('action'), ticket: u.searchParams.get('ticket'), part, of, base64: clip.subarray((part - 1) * PART, part * PART).toString('base64') };
      for (let t = 0; t < tries; t++) { last = J(ctx.gameAfVideoPart_(body)); if (last.success) break; }
      if (!last.success) return last;
    }
    return last;
  };
  return { ctx, central, store, logs, calls, cache, P, rows, ticket, upload, J, daily: () => J(ctx.afVideoDaily()), part: (b) => J(ctx.gameAfVideoPart_(b)) };
}
const clip = (n) => { const b = Buffer.alloc(n); Buffer.from('\x00\x00\x00\x18ftypmp42synthetic').copy(b); for (let i = 24; i < n; i++) b[i] = (i * 7) & 255; return b; };
const find = (root, ...names) => names.reduce((f, n) => f && f.kids.find((k) => k.name === n), root);
let n = 0; const test = (name, fn) => { fn(); console.log('ok ' + ++n + ' - ' + name); };

test('a synthetic clip in 3 parts lands in <school>/AF Videos 2026/<event>/<video>.mp4, shared with exactly the 3, and its id comes back', () => {
  const t = setup(), c = clip(2 * PART + 5000), tk = t.ticket({ deleteAfter: '2099-01-01', fileName: 'x.mp4', event: 'other' }); // params other than video are ignored
  assert.strictEqual(tk.success, true);
  assert.match(tk.data.url, /^https:\/\/script\.google\.com\/macros\/s\/ROSTER\/exec\?ticket=[\w-]+\.[\w-]+&action=gameAfVideoPart$/);
  const r = t.upload(tk.data.url, c);
  assert.strictEqual(r.success, true);
  const f = t.store[r.fileId], dir = find(t.central, 'LMS 1 - Dhalpur', 'AF Videos 2026', 'af2026');
  assert.ok(dir && dir.files[0] === f, 'in the school\'s AF Videos 2026/af2026 folder');
  assert.strictEqual(f.name, VIDEO + '.mp4');
  assert.strictEqual(f.mime, 'video/mp4');
  assert.ok(f.bytes.equals(c), 'every byte, in order');
  assert.match(f.description, /^delete-after: 2026-12-24\n/, 'the row\'s delete-after, not the params\'');
  assert.strictEqual(f.meta.copyRequiresWriterPermission, true, 'viewers get no download, print or copy');
  assert.deepStrictEqual(f.perms.map((p) => p.emailAddress).sort(), [ACC, ME, PRINCIPAL].sort(), 'Principal, accountable, Owner (the file\'s owner), nobody else');
  assert.ok(f.perms.every((p) => p.type === 'user'), 'no link or domain sharing');
  assert.ok(t.calls.filter((x) => x.url.includes('googleapis')).every((x) => x.auth === 'Bearer oauth-token'));
  console.log('  uploaded ' + c.length + ' synthetic bytes in 3 parts → Drive id ' + r.fileId);
});

test('a part whose answer was lost is resent without sending a byte twice; the last part resent answers the same id', () => {
  const t = setup({ lose: 1 }), c = clip(PART + 10), tk = t.ticket({});
  const r = t.upload(tk.data.url, c);
  assert.strictEqual(r.success, true);
  assert.ok(t.store[r.fileId].bytes.equals(c));
  const u = new URL(tk.data.url);
  assert.deepStrictEqual(t.part({ ticket: u.searchParams.get('ticket'), part: 2, of: 2, base64: c.subarray(PART).toString('base64') }), { success: true, fileId: r.fileId });
  assert.deepStrictEqual(t.part({ ticket: u.searchParams.get('ticket'), part: 1, of: 2, base64: c.subarray(0, PART).toString('base64') }), { success: true, fileId: r.fileId });
});

test('parts out of order, a middle part of the wrong size, a forged ticket and an expired one are refused', () => {
  const t = setup(), c = clip(2 * PART + 1), tk = t.ticket({}), u = new URL(tk.data.url), tick = u.searchParams.get('ticket');
  assert.strictEqual(t.part({ ticket: tick, part: 2, of: 3, base64: c.subarray(PART, 2 * PART).toString('base64') }).error, 'NO_UPLOAD');
  assert.strictEqual(t.part({ ticket: tick, part: 1, of: 3, base64: c.subarray(0, PART - 1).toString('base64') }).error, 'BAD_PART');
  assert.strictEqual(t.part({ ticket: tick, part: 1, of: 3, base64: c.subarray(0, PART).toString('base64') }).success, true);
  assert.strictEqual(t.part({ ticket: tick, part: 3, of: 3, base64: c.subarray(2 * PART).toString('base64') }).error, 'OUT_OF_ORDER');
  assert.strictEqual(t.part({ ticket: tick.slice(0, -2) + 'xx', part: 1, of: 3, base64: 'AA==' }).error, 'not_authorized');
  assert.strictEqual(t.part({ ticket: tick, part: 1, of: 41, base64: 'AA==' }).error, 'BAD_PART', '41 parts = over 50 MB');
  const late = setup({ now: Date.parse('2026-11-14T05:00:00Z') }), lt = late.ticket({});
  const old = setup({ now: Date.parse('2026-11-14T08:00:00Z') }); // 3 h later, the same key: the ticket no longer starts an upload
  assert.strictEqual(old.part({ ticket: new URL(lt.data.url).searchParams.get('ticket'), part: 1, of: 1, base64: 'AAAA' }).error, 'not_authorized');
});

test('the ticket: a wrong key, another role, bad params and missing set-up are refused before any upload', () => {
  const t = setup();
  assert.deepStrictEqual(t.ticket({}, { key: 'x' }), { success: false, error: 'not_authorized' });
  assert.strictEqual(t.ticket({}, { role: 'principal' }).data.code, 'not_authorized');
  assert.strictEqual(t.ticket({}, { campus: '' }).data.code, 'campus_needed');
  assert.strictEqual(t.ticket({}, { email: null }).data.code, 'who');
  assert.strictEqual(t.ticket({ video: 'x' }).data.code, 'bad_input');
  assert.strictEqual(setup({ props: { AF_VIDEO_ACCOUNTABLE: '' } }).ticket({}).data.code, 'not_configured');
  assert.strictEqual(setup().ticket({}, { campus: 'LMS3' }).data.code, 'not_configured', 'no Principal on the allowlist for that school');
  assert.ok(t.calls.every((x) => !x.url.includes('upload')), 'no Drive call');
});

test('the ticket comes only from the caller\'s own unfinished row at their own school, read on the server', () => {
  const other = VIDEO.replace('0b6f', '9b6f'), t = setup({ rows: { [VIDEO]: row({ campus: 'LMS2' }), [other]: row({ email: 'someone@test.invalid' }) } });
  assert.strictEqual(t.ticket({}).data.code, 'not_authorized', 'another school\'s row (a teacher can\'t write into its folder)');
  assert.strictEqual(t.ticket({ video: other }).data.code, 'not_authorized', 'someone else\'s row');
  assert.strictEqual(setup({ rows: { [VIDEO]: row({ open: false }) } }).ticket({}).data.code, 'done');
  assert.strictEqual(setup({ rows: { [VIDEO]: false } }).ticket({}).data.code, 'not_authorized', 'no such row');
  assert.strictEqual(setup({ rows: { [VIDEO]: row({ deleteAfter: '2026-11-01' }) } }).ticket({}).data.code, 'bad_input', 'already past its date');
  assert.strictEqual(setup({ rows: { [VIDEO]: row({ mime: 'video/x-msvideo' }) } }).ticket({}).data.code, 'bad_input');
  assert.strictEqual(setup({ rowCode: 500 }).ticket({}).data.code, 'not_configured', 'af-drive down: no ticket');
  const ok = setup({ rows: { [VIDEO]: row({ mime: 'video/webm', event: 'af2027', deleteAfter: '2027-12-01' }) } });
  const r = ok.upload(ok.ticket({ fileName: VIDEO + '.mp4' }).data.url, clip(100));
  const f = ok.store[r.fileId];
  assert.deepStrictEqual([f.name, f.mime], [VIDEO + '.webm', 'video/webm']);
  assert.ok(find(ok.central, 'LMS 1 - Dhalpur', 'AF Videos 2027', 'af2027').files[0] === f);
  assert.ok(ok.calls.filter((x) => x.url.includes('?video=')).every((x) => !/@/.test(x.url)), 'no person in a URL');
});

test('a file anyone else could see (inherited link sharing) is trashed and refused', () => {
  const t = setup({ inherited: { type: 'anyone' } }), tk = t.ticket({});
  const r = t.upload(tk.data.url, clip(1000), { tries: 1 });
  assert.deepStrictEqual(r, { success: false, error: 'OVERSHARED' });
  assert.ok(Object.values(t.store).every((f) => f.trashed));
  const u = new URL(tk.data.url); // the last part resent: never the trashed file's id
  assert.deepStrictEqual(t.part({ ticket: u.searchParams.get('ticket'), part: 1, of: 1, base64: clip(1000).toString('base64') }), { success: false, error: 'not_authorized' });
  assert.strictEqual(Object.keys(t.store).length, 1, 'no second upload');
});

test('a school folder in a shared drive: refused, and the log says it is the drive\'s members', () => {
  const t = setup({ inherited: { type: 'user', emailAddress: 'staff@test.invalid', permissionDetails: [{ permissionType: 'member', inherited: true }] } });
  assert.deepStrictEqual(t.upload(t.ticket({}).data.url, clip(1000), { tries: 1 }), { success: false, error: 'OVERSHARED' });
  assert.ok(t.logs.includes('af-video: overshared_shared_drive_members'));
  const plain = setup({ inherited: { type: 'anyone' } });
  plain.upload(plain.ticket({}).data.url, clip(1000), { tries: 1 });
  assert.ok(plain.logs.includes('af-video: overshared'));
});

test('the year folder is made once, with inherited access turned off, and kept for the sweep; logs carry no names or ids', () => {
  const t = setup();
  t.upload(t.ticket({}).data.url, clip(100));
  t.upload(t.ticket({ video: VIDEO.replace('0b6f', '1b6f'), fileName: VIDEO.replace('0b6f', '1b6f') + '.webm' }).data.url, clip(100));
  assert.strictEqual(find(t.central, 'LMS 1 - Dhalpur').kids.filter((k) => k.name === 'AF Videos 2026').length, 1);
  assert.strictEqual(t.calls.filter((x) => x.m === 'patch').length, 1, 'inheritedPermissionsDisabled set once, on the year folder');
  assert.deepStrictEqual(Object.keys(JSON.parse(t.P.AFV_FOLDERS)), ['LMS1:2026']);
  const all = t.logs.join('\n');
  for (const s of [PRINCIPAL, ACC, ME, 'LMS1', VIDEO, 'DRIVEfile']) assert.ok(!all.includes(s), 'log leaks ' + s);
});

test('the daily sweep trashes files past delete-after and orphans older than 36 h; keeps live and young files', () => {
  let liveIds = [];
  const t = setup({ live: () => liveIds });
  const up = (v, del) => { t.rows[v] = row({ deleteAfter: del }); return t.upload(t.ticket({ video: v }).data.url, clip(100)).fileId; };
  const v = (k) => VIDEO.replace('0b6f', k);
  const expired = up(v('aaaa'), '2026-11-20'), live = up(v('bbbb'), '2026-12-24'), orphan = up(v('cccc'), '2026-12-24'), young = up(v('dddd'), '2026-12-24');
  liveIds = [live];
  t.store[orphan].created = new Date(Date.parse('2026-11-12T00:00:00Z'));
  t.store[live].created = new Date(Date.parse('2026-11-01T00:00:00Z'));
  t.store[expired].description = 'delete-after: 2026-11-13\n';
  assert.deepStrictEqual(t.daily(), { trashed: 1, orphans: 1, kept: 2 });
  assert.deepStrictEqual([expired, live, orphan, young].map((id) => t.store[id].trashed), [true, false, true, false]);
  liveIds = [];
  t.store[live].created = new Date(Date.parse('2026-11-01T00:00:00Z'));
  assert.deepStrictEqual(t.daily(), { trashed: 0, orphans: 0, kept: 2 }, 'an empty live list touches no orphan');
  const down = setup({ liveCode: 500 });
  assert.deepStrictEqual(down.daily(), { trashed: 0, orphans: 0, kept: 0 });
  assert.ok(down.logs.includes('af-video: live_list_unavailable'));
});

test('installAfVideoTrigger keeps exactly one daily trigger', () => {
  const t = setup();
  t.ctx.installAfVideoTrigger(); t.ctx.installAfVideoTrigger();
  assert.deepStrictEqual(t.ctx.ScriptApp.triggers.map((x) => [x.fn, x.h]), [['afVideoDaily', 3]]);
});

console.log('af-video: all ' + n + ' passed (synthetic clip, fake Drive)');
