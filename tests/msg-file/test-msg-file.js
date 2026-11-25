// apps-script/msg-file.gs: messaging files to the school's restricted Drive (lms-game 678). Runs the real .gs (with af-video.gs, whose
// helpers it shares) in a vm against a fake Drive (folders, a resumable session, permissions, thumbnails, ranged reads) and a fake
// msg-drive. Synthetic bytes and synthetic people (@test.invalid) only. Usage: node tests/msg-file/test-msg-file.js
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path'), crypto = require('crypto');
const read = (f) => fs.readFileSync(path.join(__dirname, '../../apps-script', f), 'utf8');

const KEY = 'r'.repeat(48), ME = 'owner@test.invalid', A = 'a@test.invalid', B = 'b@test.invalid', PART = 1310720, READ = 4194304;
const U = '0b6f3c1e-2a4d-4e8f-9a1b-3c5d7e9f1a2b', U2 = '1c7f3c1e-2a4d-4e8f-9a1b-3c5d7e9f1a2b', CH = '2d8f3c1e-2a4d-4e8f-9a1b-3c5d7e9f1a2b';
const MSG = 'https://stub.invalid/functions/v1/msg-drive';
const signed = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
const bytes = (n, seed = 7) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * seed + 3) & 255; return b; };

function setup({ props = {}, rows = {}, thumbReady = true, members = { [A]: true }, live = null, liveCode = 200, bindCode = 200, extraPerm = null,
  now = Date.parse('2026-11-25T05:00:00Z') } = {}) {
  let ids = 0, clock = now;
  const reg = {}, store = {}, logs = [], calls = [], binds = [], views = [], sessions = {};
  const folder = (name) => {
    const f = { name, id: 'FOLDER' + String(++ids).padStart(6, '0'), kids: [], files: [], getId: () => f.id, getName: () => name,
      getFoldersByName(n) { const m = f.kids.filter((k) => k.name === n); let i = 0; return { hasNext: () => i < m.length, next: () => m[i++] }; },
      getFiles() { const m = f.files.filter((x) => !x.trashed); let i = 0; return { hasNext: () => i < m.length, next: () => m[i++].api }; },
      createFolder(n) { const k = folder(n); f.kids.push(k); return k; } };
    reg[f.id] = f; return f;
  };
  const root = folder('Messaging files');
  const addFile = (meta, content) => {
    const id = 'DRIVEfile' + String(++ids).padStart(8, '0');
    const x = { id, meta, name: meta.name, mime: meta.mimeType, description: meta.description, bytes: content, trashed: false, created: new Date(clock), parent: meta.parents[0],
      perms: [{ type: 'user', emailAddress: ME, role: 'owner' }].concat(extraPerm ? [extraPerm] : []), thumb: false };
    x.api = { getId: () => id, getDescription: () => x.description, getDateCreated: () => x.created, setTrashed: (v) => { x.trashed = v; } };
    store[id] = x; reg[meta.parents[0]].files.push(x); return x;
  };
  const resp = (code, body = '', headers = {}, content) => ({ getResponseCode: () => code, getContentText: () => body, getHeaders: () => headers, getContent: () => content });
  const P = Object.assign({ ROSTER_GAME_KEY: KEY, MSG_DRIVE_URL: MSG, MSG_ROOT_FOLDER_ID: root.id, ROSTER_WEBAPP_URL: 'https://script.google.com/macros/s/ROSTER/exec' }, props);
  const row = (o = {}) => Object.assign({ tenant: 't1', channel: CH, campus_code: 'LMS6', kind: 'photo', mime: 'image/jpeg', bytes: 2 * PART + 5000, drive_name: U, email: A, open: true }, o);
  const cache = new Map();
  const ctx = {
    console: { log: (m) => logs.push(m), error: (m) => logs.push(m) }, JSON, String, Array, Number, Math, Object, RegExp, Buffer,
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [clock])); } static now() { return clock; } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => P[k] ?? null, setProperty: (k, v) => { P[k] = v; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, v), remove: (k) => cache.delete(k) }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => ME }) },
    ScriptApp: { getOAuthToken: () => 'oauth-token', getService: () => ({ getUrl: () => 'https://x' }), triggers: [],
      getProjectTriggers() { return this.triggers; }, deleteTrigger(t) { this.triggers = this.triggers.filter((x) => x !== t); },
      newTrigger(fn) { const self = this; return { timeBased: () => ({ everyDays: () => ({ atHour: (h) => ({ create: () => self.triggers.push({ fn, h, getHandlerFunction: () => fn }) }) }),
        everyMinutes: (mins) => ({ create: () => self.triggers.push({ fn, mins, getHandlerFunction: () => fn }) }) }) }; } },
    DriveApp: { getFolderById: (id) => { if (!reg[id]) throw new Error('no folder'); return reg[id]; } },
    Utilities: {
      base64EncodeWebSafe: (s) => Buffer.from(typeof s === 'string' ? s : Buffer.from(s.map((b) => b & 255))).toString('base64url'),
      base64DecodeWebSafe: (s) => signed(Buffer.from(s, 'base64url')),
      base64Decode: (s) => signed(Buffer.from(s, 'base64')),
      base64Encode: (b) => Buffer.from(b.map((x) => x & 255)).toString('base64'),
      computeHmacSha256Signature: (body, key) => signed(crypto.createHmac('sha256', key).update(body).digest()),
      newBlob: (b) => ({ getDataAsString: () => Buffer.from(b.map((x) => x & 255)).toString('utf8') }),
      getUuid: () => crypto.randomUUID(),
      formatDate: (d, _tz, fmt) => { const s = new Date(d.getTime() + 5.5 * 3600e3).toISOString(); return fmt === 'yyyy-MM' ? s.slice(0, 7) : s.slice(0, 10); },
    },
    UrlFetchApp: { fetch(url, o = {}) {
      const m = (o.method || 'get').toLowerCase(), h = o.headers || {};
      calls.push({ url, m, h, payload: typeof o.payload === 'string' ? o.payload : '' });
      if (url.startsWith(MSG)) {
        if (h['x-roster-key'] !== KEY) return resp(401);
        if (url.startsWith(MSG + '?upload=')) { const id = url.split('=')[1], r = id in rows ? rows[id] : row(); return r === false ? resp(404, '{}') : resp(200, JSON.stringify({ upload: r })); }
        if (url === MSG + '?done=1') { const b = JSON.parse(o.payload); binds.push(b); return resp(bindCode, JSON.stringify({ ok: bindCode === 200 })); }
        if (url === MSG + '?view=1') { const b = JSON.parse(o.payload); views.push(b); return resp(200, JSON.stringify({ ok: !!members[b.email] && !!store[b.file] })); }
        if (url === MSG) return resp(liveCode, JSON.stringify({ ids: typeof live === 'function' ? live() : live || [] }));
      }
      if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable') && m === 'post') {
        const s = 'https://upload.stub/session/' + (++ids); sessions[s] = { meta: JSON.parse(o.payload), got: [], len: 0 };
        return resp(200, '', { Location: s });
      }
      if (sessions[url] && m === 'put') {
        const s = sessions[url], r = h['Content-Range'];
        if (/^bytes \*\//.test(r)) return s.file ? resp(200, JSON.stringify({ id: s.file.id })) : resp(308, '', s.len ? { Range: 'bytes=0-' + (s.len - 1) } : {});
        const [, a, b2, total] = r.match(/^bytes (\d+)-(\d+)\/(\d+|\*)$/);
        assert.strictEqual(Number(a), s.len, 'every part starts where Drive left off');
        const chunk = Buffer.from(o.payload.map((x) => x & 255));
        assert.strictEqual(chunk.length, Number(b2) - Number(a) + 1);
        s.got.push(chunk); s.len += chunk.length;
        if (total !== '*' && s.len === Number(total)) s.file = addFile(s.meta, Buffer.concat(s.got));
        return s.file ? resp(200, JSON.stringify({ id: s.file.id })) : resp(308, '', { Range: 'bytes=0-' + (s.len - 1) });
      }
      if (url.startsWith('https://thumb.stub/')) { assert.strictEqual(h.Authorization, 'Bearer oauth-token'); assert.match(url, /=s320$/); return resp(200, '', {}, signed(bytes(900, 3))); }
      const media = url.match(/upload\/drive\/v3\/files\/([A-Za-z0-9_-]+)\?uploadType=media/);
      if (media && m === 'patch') { store[media[1]].bytes = Buffer.from(o.payload.map((x) => x & 255)); return resp(200, '{}'); }
      if (url.startsWith('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id') && m === 'post') return resp(200, JSON.stringify({ id: addFile(JSON.parse(o.payload), Buffer.alloc(0)).id }));
      const pm = url.match(/drive\/v3\/files\/([A-Za-z0-9_-]+)\/permissions/);
      if (pm && m === 'get') return store[pm[1]] ? resp(200, JSON.stringify({ permissions: store[pm[1]].perms })) : resp(404, '{}');
      const alt = url.match(/drive\/v3\/files\/([A-Za-z0-9_-]+)\?alt=media/);
      if (alt) { const [, a, b2] = h.Range.match(/^bytes=(\d+)-(\d+)$/); return resp(206, '', {}, signed(store[alt[1]].bytes.subarray(Number(a), Number(b2) + 1))); }
      const fm = url.match(/drive\/v3\/files\/([A-Za-z0-9_-]+)\?supportsAllDrives=true(?:&fields=([\w,]+))?$/);
      if (fm && m === 'get' && fm[2] === 'thumbnailLink,parents') { const f = store[fm[1]]; return resp(200, JSON.stringify(Object.assign({ parents: [f.parent] }, thumbReady ? { thumbnailLink: 'https://thumb.stub/' + f.id + '=s220' } : {}))); }
      if (fm && m === 'get' && fm[2] === 'size,trashed') { const f = store[fm[1]]; return f ? resp(200, JSON.stringify({ size: String(f.bytes.length), trashed: f.trashed })) : resp(404, '{}'); }
      if (fm && m === 'patch') { const b = JSON.parse(o.payload); if (store[fm[1]] && b.trashed) store[fm[1]].trashed = true; return resp(200, '{}'); }
      throw new Error('unexpected fetch ' + m + ' ' + url);
    } },
  };
  vm.createContext(ctx);
  vm.runInContext('function getSubfolder_(parent, name) { const it = parent.getFoldersByName(name); return it.hasNext() ? it.next() : null; }', ctx);
  vm.runInContext(read('af-video.gs'), ctx);
  vm.runInContext(read('msg-file.gs'), ctx);
  const J = (x) => JSON.parse(JSON.stringify(x));
  const ticket = (o = {}) => J(ctx.gameMsgFileTicket_(Object.assign({ action: 'gameMsgFileTicket', key: KEY, role: 'teacher', campus: null, campuses: ['LMS6'], email: A, params: { upload: U } }, o)));
  // the phone, as app/src/classic/upload.ts: the ticket and action from the URL, parts of PART bytes, a failed part resent
  const upload = (url, content, { of } = {}) => {
    const u = new URL(url), n = of || Math.ceil(content.length / PART);
    let last;
    for (let part = 1; part <= n; part++) {
      const body = { action: u.searchParams.get('action'), ticket: u.searchParams.get('ticket'), part, of: n, base64: content.subarray((part - 1) * PART, part * PART).toString('base64') };
      for (let t = 0; t < 3; t++) { last = J(ctx.gameMsgFilePart_(body)); if (last.success || last.error !== 'DRIVE') break; }   // only a Drive hiccup is retried
      if (!last.success) return last;
    }
    return last;
  };
  const view = (file, email = A) => J(ctx.gameMsgFileView_({ action: 'gameMsgFileView', key: KEY, role: 'teacher', email, params: { file } }));
  const readAll = (url, size, between) => {
    const u = new URL(url), out = [];
    for (let part = 1; part <= Math.ceil(size / READ); part++) {
      if (between) between(part);
      const r = J(ctx.gameMsgFileRead_({ action: u.searchParams.get('action'), ticket: u.searchParams.get('ticket'), part }));
      if (!r.success) return r;
      out.push(Buffer.from(r.base64, 'base64'));
    }
    return Buffer.concat(out);
  };
  return { ctx, root, store, logs, calls, binds, views, cache, P, rows, row, members, ticket, upload, view, readAll, J, tick: (ms) => { clock += ms; } };
}
const find = (root, ...names) => names.reduce((f, n) => f && f.kids.find((k) => k.name === n), root);
const noPii = (t) => { for (const l of t.logs) assert.ok(!/@|DRIVEfile|LMS6|[0-9a-f]{8}-[0-9a-f]{4}/.test(String(l)), 'a log line carries only codes and counts: ' + l); };
let n = 0; const test = (name, fn) => { fn(); console.log('ok ' + ++n + ' - ' + name); };

test('a photo in 3 parts lands in <root>/LMS6/<group>/2026-11/<upload>.jpg, private, bound by the Roster with its preview', () => {
  const t = setup(), c = bytes(2 * PART + 5000), tk = t.ticket();
  assert.strictEqual(tk.success, true);
  assert.match(tk.data.url, /^https:\/\/script\.google\.com\/macros\/s\/ROSTER\/exec\?ticket=[\w-]+\.[\w-]+&action=gameMsgFilePart$/);
  const r = t.upload(tk.data.url, c);
  assert.strictEqual(r.success, true);
  const f = t.store[r.fileId];
  assert.ok(f.bytes.equals(c), 'the bytes arrive whole');
  assert.strictEqual(f.name, U + '.jpg');
  assert.ok(find(t.root, 'LMS6', CH, '2026-11').files.includes(f));
  assert.match(f.description, new RegExp('^msg-upload: ' + U));
  assert.deepStrictEqual(t.binds[0], { upload: U, file: r.fileId });
  assert.strictEqual(t.binds.length, 2, 'then the preview');
  const th = t.store[t.binds[1].thumb];
  assert.deepStrictEqual(t.binds[1], { upload: U, file: r.fileId, thumb: th.id });
  assert.strictEqual(th.name, U + '.thumb.jpg'); assert.match(th.description, /^msg-thumb: /); assert.strictEqual(th.bytes.length, 900);
  assert.ok(t.calls.some((x) => x.url.includes('inheritedPermissionsDisabled') || (x.m === 'patch' && x.payload.includes('inheritedPermissionsDisabled'))), 'the school folder has inherited access off');
  assert.strictEqual(t.upload(tk.data.url, c).fileId, r.fileId, 'the last part resent answers the same file, no second upload');
  noPii(t);
});

test('a network group (no school) goes under NETWORK; a document gets no preview', () => {
  const t = setup({ rows: { [U]: Object.assign(setup().row({ campus_code: null, kind: 'document', mime: 'application/pdf', bytes: 3000 })) } });
  const r = t.upload(t.ticket().data.url, bytes(3000));
  assert.strictEqual(r.success, true);
  assert.ok(find(t.root, 'NETWORK', CH, '2026-11').files.includes(t.store[r.fileId]));
  assert.strictEqual(t.store[r.fileId].name, U + '.pdf');
  assert.strictEqual(t.binds.length, 1);
});

test('a video whose preview Drive hasn\'t made yet: uploaded and bound now, the preview bound by the 10-minute pass once it exists', () => {
  let ready = false;
  const t = setup({ thumbReady: false, rows: { [U]: setup().row({ kind: 'video', mime: 'video/mp4', bytes: PART + 10 }) } });
  const r = t.upload(t.ticket().data.url, bytes(PART + 10));
  assert.strictEqual(r.success, true);
  assert.strictEqual(t.binds.length, 1);
  assert.strictEqual(JSON.parse(t.P.MSG_THUMBS).length, 1);
  t.ctx.msgFileThumbSync();
  assert.strictEqual(JSON.parse(t.P.MSG_THUMBS).length, 1, 'still waiting');
  // Drive has processed it now
  const t2 = t; t2.ctx.UrlFetchApp.fetch = ((orig) => function (url, o) {
    if (/fields=thumbnailLink,parents$/.test(url)) { const id = url.match(/files\/([A-Za-z0-9_-]+)\?/)[1]; return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ parents: [t.store[id].parent], thumbnailLink: 'https://thumb.stub/' + id + '=s220' }), getHeaders: () => ({}) }; }
    return orig.call(this, url, o);
  })(t2.ctx.UrlFetchApp.fetch);
  ready = true;
  t.ctx.msgFileThumbSync();
  assert.ok(ready);
  assert.strictEqual(t.binds.length, 2); assert.strictEqual(t.binds[1].file, r.fileId);
  assert.strictEqual(JSON.parse(t.P.MSG_THUMBS).length, 0);
  // a preview that never comes is dropped after a day
  const t3 = setup({ thumbReady: false, rows: { [U]: setup().row({ kind: 'video', mime: 'video/mp4', bytes: 100 }) } });
  t3.upload(t3.ticket().data.url, bytes(100)); t3.tick(25 * 3600e3); t3.ctx.msgFileThumbSync();
  assert.strictEqual(JSON.parse(t3.P.MSG_THUMBS).length, 0);
});

test('the ticket: only the uploader, only an open row, only the row\'s own kind, mime and size; nothing from the app is used', () => {
  const t = setup({ rows: { [U2]: false } });
  assert.deepStrictEqual(t.ticket({ email: B }).data, { ok: false, code: 'not_authorized' });
  assert.deepStrictEqual(t.ticket({ params: { upload: U2 } }).data, { ok: false, code: 'not_authorized' });
  assert.deepStrictEqual(t.ticket({ params: { upload: 'x' } }).data, { ok: false, code: 'bad_input' });
  assert.deepStrictEqual(t.ticket({ email: '' }).data, { ok: false, code: 'who' });
  assert.deepStrictEqual(t.ticket({ key: 'x' }), { success: false, error: 'not_authorized' });
  for (const o of [{ open: false }]) assert.deepStrictEqual(setup({ rows: { [U]: setup().row(o) } }).ticket().data, { ok: false, code: 'done' });
  for (const o of [{ mime: 'image/gif' }, { kind: 'video' }, { bytes: 10485761 }, { bytes: 0 }, { channel: 'x' }, { campus_code: 'bad code!' }])
    assert.deepStrictEqual(setup({ rows: { [U]: setup().row(o) } }).ticket().data, { ok: false, code: 'bad_input' }, JSON.stringify(o));
  assert.deepStrictEqual(setup({ props: { MSG_ROOT_FOLDER_ID: null } }).ticket().data, { ok: false, code: 'not_configured' });
  assert.deepStrictEqual(setup({ props: { MSG_DRIVE_URL: null } }).ticket().data, { ok: false, code: 'not_configured' });
  const ok = setup().ticket({ params: { upload: U, mime: 'video/mp4', bytes: '999999999', campus: 'LMS1' } });   // extra params are ignored
  assert.strictEqual(ok.success, true);
});

test('the parts must add up to exactly the row\'s size; a forged or expired ticket uploads nothing', () => {
  const t = setup(), tk = t.ticket().data.url, c = bytes(2 * PART + 5000);
  assert.deepStrictEqual(t.upload(tk, bytes(2 * PART + 4999)), { success: false, error: 'BAD_PART' }, 'one byte short');
  assert.deepStrictEqual(setup().upload(setup().ticket().data.url, c, { of: 4 }), { success: false, error: 'BAD_PART' }, 'a wrong part count');
  const forged = tk.replace(/ticket=([\w-]+)\./, (_m, b) => 'ticket=' + b.slice(0, -2) + 'AA.');
  assert.deepStrictEqual(t.upload(forged, c), { success: false, error: 'not_authorized' });
  const late = setup(), url = late.ticket().data.url; late.tick(3 * 3600e3);
  assert.deepStrictEqual(late.upload(url, c), { success: false, error: 'not_authorized' });
  assert.strictEqual(Object.keys(t.store).length + Object.keys(late.store).length, 0, 'no file was made');
});

test('a file anyone else could see (a shared drive, a link) is trashed and refused; so is one msg-drive won\'t record', () => {
  const t = setup({ extraPerm: { type: 'anyone' } }), c = bytes(1000);
  t.rows[U] = t.row({ bytes: 1000 });
  const url = t.ticket().data.url;
  assert.deepStrictEqual(t.upload(url, c), { success: false, error: 'OVERSHARED' });
  assert.ok(Object.values(t.store).every((f) => f.trashed));
  assert.deepStrictEqual(t.upload(url, c), { success: false, error: 'not_authorized' }, 'the ticket is spent');
  const r = setup({ bindCode: 409 }); r.rows[U] = r.row({ bytes: 1000 });
  assert.deepStrictEqual(r.upload(r.ticket().data.url, c), { success: false, error: 'RECORD' });
  assert.ok(Object.values(r.store).every((f) => f.trashed));
  assert.ok(t.logs.includes('msg-file: overshared') && r.logs.includes('msg-file: record_failed'));
});

test('viewing: a member gets a short-lived read ticket and the file in 4 MiB parts; a stranger gets nothing', () => {
  const t = setup(), c = bytes(9 * 1024 * 1024 + 17, 11);
  t.rows[U] = t.row({ kind: 'video', mime: 'video/mp4', bytes: c.length });
  const id = t.upload(t.ticket().data.url, c).fileId;
  assert.deepStrictEqual(t.view(id, B).data, { ok: false, code: 'not_member' });
  assert.deepStrictEqual(t.view('bad id').data, { ok: false, code: 'bad_input' });
  assert.deepStrictEqual(t.J(t.ctx.gameMsgFileView_({ key: 'x', email: A, params: { file: id } })), { success: false, error: 'not_authorized' });
  const v = t.view(id);
  assert.strictEqual(v.success, true);
  assert.deepStrictEqual(Object.keys(v.data).sort(), ['expiresAt', 'url']);
  assert.ok(!decodeURIComponent(v.data.url).includes('@') && !Buffer.from(new URL(v.data.url).searchParams.get('ticket').split('.')[0], 'base64url').toString().includes('@'), 'no email in the URL');
  const got = t.readAll(v.data.url, c.length);
  assert.ok(Buffer.isBuffer(got) && got.equals(c), '3 parts make the file again');
  assert.ok(t.views.length >= 4, 'membership asked at the ticket and on every part');
  const late = setup(); late.rows[U] = late.row({ bytes: 1000 }); const id2 = late.upload(late.ticket().data.url, bytes(1000)).fileId;
  const v2 = late.view(id2); late.tick(16 * 60e3);
  assert.deepStrictEqual(late.readAll(v2.data.url, 1000), { success: false, error: 'not_authorized' }, 'an expired read ticket');
});

test('leaving the group mid-read cuts access at the next part', () => {
  const t = setup(), c = bytes(9 * 1024 * 1024, 5);
  t.rows[U] = t.row({ kind: 'video', mime: 'video/mp4', bytes: c.length });
  const id = t.upload(t.ticket().data.url, c).fileId, v = t.view(id);
  const r = t.readAll(v.data.url, c.length, (part) => { if (part === 2) delete t.members[A]; });
  assert.deepStrictEqual(r, { success: false, error: 'not_authorized' });
});

test('the daily sweep trashes only our tagged files that no live message holds, once 48 h old; an unreadable list trashes nothing', () => {
  let liveIds = [];
  const t = setup({ live: () => liveIds });
  t.rows[U] = t.row({ kind: 'document', mime: 'application/pdf', bytes: 500 });
  const kept = t.upload(t.ticket().data.url, bytes(500)).fileId;
  t.rows[U2] = t.row({ kind: 'document', mime: 'application/pdf', bytes: 500 });
  const orphan = t.upload(t.ticket({ params: { upload: U2 } }).data.url, bytes(500)).fileId;
  const hand = Object.values(t.store)[0].parent, byHand = t.ctx.DriveApp.getFolderById(hand);
  byHand.files.push({ id: 'DRIVEbyhand000001', trashed: false, api: { getId: () => 'DRIVEbyhand000001', getDescription: () => 'notes', getDateCreated: () => new Date(0), setTrashed() { throw new Error('touched an untagged file'); } } });
  liveIds = [kept];
  assert.deepStrictEqual(t.J(t.ctx.msgFileDaily()), { orphans: 0, kept: 3 }, 'too young to be an orphan');
  t.tick(49 * 3600e3);
  assert.deepStrictEqual(t.J(t.ctx.msgFileDaily()), { orphans: 1, kept: 2 });
  assert.ok(t.store[orphan].trashed && !t.store[kept].trashed);
  const bad = setup({ liveCode: 500 }); bad.rows[U] = bad.row({ kind: 'document', mime: 'application/pdf', bytes: 500 });
  bad.upload(bad.ticket().data.url, bytes(500)); bad.tick(49 * 3600e3);
  assert.deepStrictEqual(bad.J(bad.ctx.msgFileDaily()), { orphans: 0, kept: 0 });
  assert.ok(bad.logs.includes('msg-file: live_list_unavailable'));
  noPii(t);
});

test('installMsgFileTriggers: one daily sweep and one 10-minute preview pass, never doubled', () => {
  const t = setup();
  t.ctx.installMsgFileTriggers(); t.ctx.installMsgFileTriggers();
  assert.deepStrictEqual(t.ctx.ScriptApp.triggers.map((x) => [x.fn, x.h ?? x.mins]).sort(), [['msgFileDaily', 3], ['msgFileThumbSync', 10]]);
});
