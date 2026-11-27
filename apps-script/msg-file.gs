// msg-file.gs (Roster project, the one with Drive; lane-t, 25 Nov): messaging v2 files (documents, photos, videos) go to the school's
// restricted Drive, never the database. lms-game keeps text and Drive ids only (N1's 678; the 541/663 AF video pattern).
//  1. gameMsgFileTicket, through lms-game's classic proxy (roster.msgFileTicket, server to server, the ROSTER_GAME_KEY): after
//     msg_upload_start, the uploader gets a ticket for that upload id only. The kind, mime, size, school and group come from the row,
//     read on the server from lms-game's msg-drive (msg_upload_row), never from the app; the row must be the caller's own (its
//     uploader's email = the proxy's JWT-verified email) and not finished. -> {url, expiresAt}
//  2. gameMsgFilePart, the phone's parts against that ticket (app/src/classic/upload.ts: {action, ticket, part, of, base64}). Each part
//     goes straight on into a Drive resumable upload (a resent part is safe), so a file is never reassembled here. The parts must add up
//     to exactly the row's size (caps: documents 25 MB, photos 10 MB, videos 50 MB). The last part answers {success, fileId}; the Roster
//     has already recorded that id with msg-drive (msg_upload_roster_file), and msg_send_files binds only that one.
//  3. Previews: a photo's or video's ~320 px preview is made here from Drive's own thumbnail and bound with msg-drive too (the phone
//     never makes or names one). A photo's is usually ready at once; a video's comes when Drive has processed it, so a 10-minute pass
//     (msgFileThumbSync) tries again for up to a day. N1's 678 binds a preview even after the message was sent.
//  4. gameMsgFileView (roster.msgFileView, a read carrying the caller's email): a member opens a file or preview by Drive id. msg-drive
//     answers msg_file_can_view (a live message in a group they're in; the Owner, audited). Only then a short-lived read ticket ->
//     {url, expiresAt}; the phone reads the file in 4 MiB parts (it knows the size from msg_files_list) with gameMsgFileRead
//     {action, ticket, part: 1..ceil(bytes / 4 MiB)} -> {success, part, of, base64},
//     and EVERY part asks msg_file_can_view again, so leaving a group cuts access at once. Files are never shared with a person or by link.
//  5. msgFileDaily (daily trigger; Uday runs installMsgFileTriggers() once): trashes our tagged files that no live message holds (an
//     upload never sent, a deleted message) once they are 48 h old, from msg-drive's live list; untagged files are never touched.
// Saved as <MSG_ROOT_FOLDER_ID>/<school code or NETWORK>/<group id>/<yyyy-MM>/<upload id>.<ext>, owned by the deploying account and
// seen by no one else (inherited access off on each school folder; any extra permission after an upload trashes the file).
// Script properties (set by Uday, never in the repo): MSG_ROOT_FOLDER_ID (a Drive folder shared with no one), MSG_DRIVE_URL (lms-game's
// msg-drive function), ROSTER_GAME_KEY (already set). MSG_FOLDERS and MSG_THUMBS are kept by this file.
// Logs carry codes and counts only: never an email, a school, a group, a file name or a file id.
// Shares af-video.gs's helpers (same project): afvKeyOk_, afvB64_, afvSign_, afvEmail_, afvApi_, afvTicket_.

var MSG_TICKET_MS_ = 2 * 60 * 60 * 1000;   // an upload ticket starts within 2 h; its parts then have the 6 h of the cache
var MSG_READ_MS_ = 15 * 60 * 1000;         // a read ticket lasts 15 min (a 50 MB video is 13 parts)
var MSG_PART_BYTES_ = 1310720;             // = app/src/classic/upload.ts PART_BYTES (5 × 256 KiB, as Drive needs for every part but the last)
var MSG_READ_BYTES_ = 4194304;             // 4 MiB a read part (~5.6 MB of base64 in the answer)
var MSG_ORPHAN_AGE_MS_ = 48 * 60 * 60 * 1000;
var MSG_THUMB_TRIES_MS_ = 24 * 60 * 60 * 1000;
var MSG_CAPS_ = { document: 26214400, photo: 10485760, video: 52428800 };   // = 678's caps
var MSG_EXT_ = { 'application/pdf': 'pdf', 'text/plain': 'txt', 'text/csv': 'csv', 'application/msword': 'doc', 'application/vnd.ms-excel': 'xls',
  'application/vnd.ms-powerpoint': 'ppt', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };   // = 678's msg_file_kind allow-list
var MSG_KIND_ = { pdf: 'document', txt: 'document', csv: 'document', doc: 'document', xls: 'document', ppt: 'document', docx: 'document', xlsx: 'document',
  pptx: 'document', jpg: 'photo', png: 'photo', webp: 'photo', heic: 'photo', heif: 'photo', mp4: 'video', mov: 'video', webm: 'video' };
var MSG_UUID_ = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
var MSG_DRIVE_ID_ = /^[A-Za-z0-9_-]{10,200}$/;

function msgOut_(code) { console.log('msg-file: ' + code); return { success: true, data: { ok: false, code: code } }; }
function msgProps_() { return PropertiesService.getScriptProperties(); }

/** lms-game's msg-drive, server to server (the key in a header, ids in the query, an email only in a POST body). null = unreachable */
function msgDrive_(method, query, body) {
  const p = msgProps_(), url = String(p.getProperty('MSG_DRIVE_URL') || ''), key = p.getProperty('ROSTER_GAME_KEY');
  if (!/^https:\/\//.test(url) || !key) return null;
  const o = { method: method, headers: { 'x-roster-key': key }, muteHttpExceptions: true };
  if (body !== undefined) { o.contentType = 'application/json'; o.payload = JSON.stringify(body); }
  try {
    const r = UrlFetchApp.fetch(url + (query || ''), o);
    let j = null;
    try { j = JSON.parse(r.getContentText() || 'null'); } catch (e) { j = null; }
    return { code: r.getResponseCode(), body: j };
  } catch (e) { return null; }
}
/** the upload's row (msg_upload_row): false = no such row, null = msg-drive unreachable or not set up */
function msgRow_(upload) {
  const r = msgDrive_('get', '?upload=' + upload);
  if (!r) return null;
  if (r.code === 404) return false;
  return r.code === 200 && r.body && r.body.upload && typeof r.body.upload === 'object' ? r.body.upload : null;
}
/** may this person open this Drive file (or preview) now? Only a 200 {ok:true} counts */
function msgCanView_(file, email) {
  const r = msgDrive_('post', '?view=1', { file: file, email: email });
  return !!(r && r.code === 200 && r.body && r.body.ok === true);
}
/** record the file (and preview) this upload made; true once recorded. Two tries; a 400/409 can't succeed on retry */
function msgBind_(upload, file, thumb) {
  for (let i = 0; i < 2; i++) {
    const r = msgDrive_('post', '?done=1', thumb ? { upload: upload, file: file, thumb: thumb } : { upload: upload, file: file });
    if (r && r.code === 200 && r.body && r.body.ok === true) return true;
    if (r && (r.code === 400 || r.code === 409)) return false;
  }
  return false;
}

/** <root>/<school or NETWORK>/<group>/<yyyy-MM>, made if missing; the school folder gets inherited access turned off. Ids kept in MSG_FOLDERS */
function msgFolder_(campus, channel, month) {
  const p = msgProps_(), rootId = p.getProperty('MSG_ROOT_FOLDER_ID');
  if (!rootId) return null;
  const k = campus + '/' + channel + '/' + month, known = JSON.parse(p.getProperty('MSG_FOLDERS') || '{}');
  if (known[k]) { try { return DriveApp.getFolderById(known[k]); } catch (e) { delete known[k]; } }
  let root;
  try { root = DriveApp.getFolderById(rootId); } catch (e) { return null; }
  let school = getSubfolder_(root, campus);
  if (!school) {
    school = root.createFolder(campus);
    afvApi_('patch', AFV_DRIVE_ + '/' + school.getId() + '?supportsAllDrives=true', { inheritedPermissionsDisabled: true });
  }
  const group = getSubfolder_(school, channel) || school.createFolder(channel);
  const m = getSubfolder_(group, month) || group.createFolder(month);
  known[k] = m.getId(); p.setProperty('MSG_FOLDERS', JSON.stringify(known));
  return m;
}
/** a file no one but the deploying account can see; anything else (a shared drive's members, a link, a person) is false */
function msgPrivate_(id) {
  const me = afvEmail_(Session.getEffectiveUser().getEmail());
  const l = afvApi_('get', AFV_DRIVE_ + '/' + id + '/permissions?supportsAllDrives=true&fields=permissions(type,emailAddress)');
  let perms = null;
  try { perms = l.getResponseCode() === 200 ? JSON.parse(l.getContentText()).permissions : null; } catch (e) { perms = null; }
  return Array.isArray(perms) && perms.length > 0 && perms.every(function (x) { return x.type === 'user' && afvEmail_(x.emailAddress) === me; });
}
function msgTrash_(id) { afvApi_('patch', AFV_DRIVE_ + '/' + id + '?supportsAllDrives=true', { trashed: true }); }
function msgMonth_() { return Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM'); }

// ── 1. the upload ticket ───────────────────────────────────────────
function gameMsgFileTicket_(b) {
  if (!afvKeyOk_(b.key)) return { success: false, error: 'not_authorized' };
  const email = afvEmail_(b.email), p = b.params && typeof b.params === 'object' ? b.params : {};
  if (!email) return msgOut_('who');
  const upload = String(p.upload || '');
  if (!MSG_UUID_.test(upload)) return msgOut_('bad_input');
  const row = msgRow_(upload);
  if (row === null) return msgOut_('not_configured');
  if (!row || afvEmail_(row.email) !== email) return msgOut_('not_authorized');
  if (!row.open) return msgOut_('done');
  const ext = MSG_EXT_[row.mime], kind = ext && MSG_KIND_[ext], bytes = Number(row.bytes);
  const campus = row.campus_code ? String(row.campus_code).toUpperCase() : 'NETWORK';
  if (!ext || kind !== row.kind || !(bytes >= 1 && bytes <= MSG_CAPS_[kind]) || !MSG_UUID_.test(String(row.channel || '')) || !/^[A-Z0-9]{2,8}$|^NETWORK$/.test(campus)) return msgOut_('bad_input');
  if (!msgProps_().getProperty('MSG_ROOT_FOLDER_ID')) return msgOut_('not_configured');
  const exp = Date.now() + MSG_TICKET_MS_;
  const body = afvB64_(JSON.stringify({ t: 'up', u: upload, c: campus, ch: row.channel, m: row.mime, k: kind, b: bytes, x: exp, r: Utilities.getUuid() }));
  const url = msgProps_().getProperty('ROSTER_WEBAPP_URL') || ScriptApp.getService().getUrl();
  return { success: true, data: { url: url + '?ticket=' + body + '.' + afvSign_(body) + '&action=gameMsgFilePart', expiresAt: new Date(exp).toISOString() } };
}

// ── 2. the parts ───────────────────────────────────────────────────
// As af-video's: state per ticket nonce in the script cache (the Drive session, the next part, the bytes sent); parts in order, one at a
// time; a resent part that already went answers success; a part whose answer was lost asks Drive how much it holds.
function gameMsgFilePart_(b) {
  const t = afvTicket_(b.ticket);
  if (!t || t.t !== 'up') return { success: false, error: 'not_authorized' };
  const cache = CacheService.getScriptCache(), done = cache.get('msg_done_' + t.r);
  if (done) return { success: true, fileId: done };
  if (cache.get('msg_fail_' + t.r)) return { success: false, error: 'not_authorized' };
  const part = Number(b.part), of = Number(b.of), base64 = String(b.base64 || '');
  if (!Number.isInteger(part) || !Number.isInteger(of) || of !== Math.ceil(t.b / MSG_PART_BYTES_) || part < 1 || part > of) return { success: false, error: 'BAD_PART' };
  if (!base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length > Math.ceil(MSG_PART_BYTES_ / 3) * 4) return { success: false, error: 'BAD_PART' };
  const bytes = Utilities.base64Decode(base64), last = part === of;
  if (bytes.length !== (last ? t.b - (of - 1) * MSG_PART_BYTES_ : MSG_PART_BYTES_)) return { success: false, error: 'BAD_PART' };   // exactly the row's size
  let st = JSON.parse(cache.get('msg_st_' + t.r) || 'null');
  if (!st) {
    if (part !== 1) return { success: false, error: 'NO_UPLOAD' };
    if (t.x < Date.now()) return { success: false, error: 'not_authorized' };
    const folder = msgFolder_(t.c, t.ch, msgMonth_());
    if (!folder) return { success: false, error: 'NO_FOLDER' };
    const r = afvApi_('post', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true',
      { name: t.u + '.' + MSG_EXT_[t.m], parents: [folder.getId()], mimeType: t.m, description: 'msg-upload: ' + t.u + '\nA messaging file (lms-game). Opened through the portal only.' });
    const loc = r.getResponseCode() === 200 && (r.getHeaders().Location || r.getHeaders().location);
    if (!loc) { console.error('msg-file: session ' + r.getResponseCode()); return { success: false, error: 'DRIVE' }; }
    st = { s: loc, next: 1, off: 0 };
  }
  if (part < st.next) return { success: true };
  if (part > st.next) return { success: false, error: 'OUT_OF_ORDER' };
  let skip = 0;
  if (st.fly === part) {
    const q = UrlFetchApp.fetch(st.s, { method: 'put', payload: '', muteHttpExceptions: true, headers: { 'Content-Range': 'bytes */' + (last ? t.b : '*') } });
    if (q.getResponseCode() === 200 || q.getResponseCode() === 201) return msgFinish_(t, cache, q);
    const got = q.getResponseCode() === 308 ? (String(q.getHeaders().Range || q.getHeaders().range || '').match(/-(\d+)$/) || [])[1] : undefined;
    skip = got === undefined ? 0 : Number(got) + 1 - st.off;
    if (!(skip >= 0 && skip <= bytes.length)) return { success: false, error: 'DRIVE' };
  }
  st.fly = part; cache.put('msg_st_' + t.r, JSON.stringify(st), 21600);
  const from = st.off + skip, to = st.off + bytes.length - 1;
  if (from > to && last) return { success: false, error: 'DRIVE' };
  if (from <= to) {
    const r = UrlFetchApp.fetch(st.s, { method: 'put', contentType: t.m, payload: skip ? bytes.slice(skip) : bytes, muteHttpExceptions: true,
      headers: { 'Content-Range': 'bytes ' + from + '-' + to + '/' + (last ? t.b : '*') } });
    const code = r.getResponseCode();
    if (last && (code === 200 || code === 201)) return msgFinish_(t, cache, r);
    if (last || code !== 308) { console.error('msg-file: part ' + code); return { success: false, error: 'DRIVE' }; }
  }
  st.next = part + 1; st.off = to + 1; delete st.fly;
  cache.put('msg_st_' + t.r, JSON.stringify(st), 21600);
  return { success: true };
}

/** the upload is complete: it must be private, then recorded with msg-drive; a photo's preview is tried at once, a video's later */
function msgFinish_(t, cache, res) {
  let id;
  try { id = JSON.parse(res.getContentText()).id; } catch (e) { id = null; }
  if (!MSG_DRIVE_ID_.test(String(id || ''))) return { success: false, error: 'DRIVE' };
  const spent = function (code, log) { msgTrash_(id); cache.remove('msg_st_' + t.r); cache.put('msg_fail_' + t.r, '1', 21600); console.error('msg-file: ' + log); return { success: false, error: code }; };
  if (!msgPrivate_(id)) return spent('OVERSHARED', 'overshared');
  if (!msgBind_(t.u, id, null)) return spent('RECORD', 'record_failed');
  cache.put('msg_done_' + t.r, id, 21600);
  cache.remove('msg_st_' + t.r);
  if (t.k === 'photo' || t.k === 'video') { if (!msgThumb_(t.u, id)) msgThumbLater_(t.u, id); }
  console.log('msg-file: uploaded ' + t.k);
  return { success: true, fileId: id };
}

// ── 3. previews ────────────────────────────────────────────────────
/** make the ~320 px preview from Drive's thumbnail, save it next to the file (private), bind it; true when bound */
function msgThumb_(upload, file) {
  const m = afvApi_('get', AFV_DRIVE_ + '/' + file + '?supportsAllDrives=true&fields=thumbnailLink,parents');
  let meta = null;
  try { meta = m.getResponseCode() === 200 ? JSON.parse(m.getContentText()) : null; } catch (e) { meta = null; }
  if (!meta || !meta.thumbnailLink || !Array.isArray(meta.parents) || !meta.parents[0]) return false;   // not ready yet (a video's processing)
  const img = UrlFetchApp.fetch(String(meta.thumbnailLink).replace(/=s\d+$/, '=s320'), { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (img.getResponseCode() !== 200) return false;
  const made = afvApi_('post', AFV_DRIVE_ + '?supportsAllDrives=true&fields=id', { name: upload + '.thumb.jpg', parents: [meta.parents[0]], mimeType: 'image/jpeg',
    description: 'msg-thumb: ' + upload });
  let thumb = null;
  try { thumb = made.getResponseCode() === 200 ? JSON.parse(made.getContentText()).id : null; } catch (e) { thumb = null; }
  if (!MSG_DRIVE_ID_.test(String(thumb || ''))) return false;
  const put = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files/' + thumb + '?uploadType=media&supportsAllDrives=true',
    { method: 'patch', contentType: 'image/jpeg', payload: img.getContent(), muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } });
  if (put.getResponseCode() !== 200 || !msgPrivate_(thumb) || !msgBind_(upload, file, thumb)) { msgTrash_(thumb); return false; }
  return true;
}
/** a preview to try again on the 10-minute pass (for a day) */
function msgThumbLater_(upload, file) {
  const p = msgProps_(), list = JSON.parse(p.getProperty('MSG_THUMBS') || '[]');
  if (!list.some(function (x) { return x.u === upload; })) list.push({ u: upload, f: file, at: Date.now() });
  p.setProperty('MSG_THUMBS', JSON.stringify(list.slice(-200)));
}
function msgFileThumbSync() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const p = msgProps_(), list = JSON.parse(p.getProperty('MSG_THUMBS') || '[]'), keep = [];
    let made = 0;
    list.forEach(function (x) {
      if (msgThumb_(x.u, x.f)) made++;
      else if (Date.now() - x.at < MSG_THUMB_TRIES_MS_) keep.push(x);
    });
    p.setProperty('MSG_THUMBS', JSON.stringify(keep));
    console.log('msg-file: previews ' + made + ', waiting ' + keep.length);
  } finally { lock.releaseLock(); }
}

// ── 4. viewing ─────────────────────────────────────────────────────
function gameMsgFileView_(b) {
  if (!afvKeyOk_(b.key)) return { success: false, error: 'not_authorized' };
  const email = afvEmail_(b.email), p = b.params && typeof b.params === 'object' ? b.params : {}, file = String(p.file || '');
  if (!email) return msgOut_('who');
  if (!MSG_DRIVE_ID_.test(file)) return msgOut_('bad_input');
  if (!msgCanView_(file, email)) return msgOut_('not_member');
  const m = afvApi_('get', AFV_DRIVE_ + '/' + file + '?supportsAllDrives=true&fields=size,trashed');
  let meta = null;
  try { meta = m.getResponseCode() === 200 ? JSON.parse(m.getContentText()) : null; } catch (e) { meta = null; }
  const size = meta && Number(meta.size);
  if (!meta || meta.trashed || !(size >= 1)) return msgOut_('gone');
  const exp = Date.now() + MSG_READ_MS_, nonce = Utilities.getUuid();
  CacheService.getScriptCache().put('msg_rd_' + nonce, email, Math.ceil(MSG_READ_MS_ / 1000));   // the email stays here, never in the URL
  const body = afvB64_(JSON.stringify({ t: 'rd', f: file, s: size, x: exp, r: nonce }));
  const url = msgProps_().getProperty('ROSTER_WEBAPP_URL') || ScriptApp.getService().getUrl();
  return { success: true, data: { url: url + '?ticket=' + body + '.' + afvSign_(body) + '&action=gameMsgFileRead', expiresAt: new Date(exp).toISOString() } };
}
/** one read part: membership asked again every time, then that byte range from Drive */
function gameMsgFileRead_(b) {
  const t = afvTicket_(b.ticket);
  if (!t || t.t !== 'rd' || t.x < Date.now()) return { success: false, error: 'not_authorized' };
  const of = Math.ceil(t.s / MSG_READ_BYTES_), part = Number(b.part);
  if (!Number.isInteger(part) || part < 1 || part > of) return { success: false, error: 'BAD_PART' };
  const email = CacheService.getScriptCache().get('msg_rd_' + t.r);
  if (!email || !msgCanView_(t.f, email)) return { success: false, error: 'not_authorized' };   // left the group, message deleted: cut at once
  const from = (part - 1) * MSG_READ_BYTES_, to = Math.min(t.s, part * MSG_READ_BYTES_) - 1;
  const r = UrlFetchApp.fetch(AFV_DRIVE_ + '/' + t.f + '?alt=media&supportsAllDrives=true',
    { muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), Range: 'bytes=' + from + '-' + to } });
  if (r.getResponseCode() !== 206 && r.getResponseCode() !== 200) { console.error('msg-file: read ' + r.getResponseCode()); return { success: false, error: 'DRIVE' }; }
  const bytes = r.getContent();
  if (bytes.length !== to - from + 1) return { success: false, error: 'DRIVE' };
  return { success: true, part: part, of: of, base64: Utilities.base64Encode(bytes) };
}

// ── 5. the daily sweep ─────────────────────────────────────────────
/** may the sweep trash on a live list of n ids, when the last good run saw `last`? Never on an empty list, nor one under half the last count (27 Nov
 *  audit A #8: one bad read must not trash every chat file). Returns the case it hit, or null. A real, lasting drop: run msgFileAcceptLive(). */
function msgLiveVerdict_(n, last) {
  if (n === 0) return 'empty_list';
  if (last > 0 && n < last * 0.5) return 'sudden_drop';
  return null;
}
function msgFileDaily() {
  const out = { orphans: 0, kept: 0 };
  const r = msgDrive_('get', '');
  const live = r && r.code === 200 && r.body && Array.isArray(r.body.ids) && r.body.ids.every(function (x) { return MSG_DRIVE_ID_.test(String(x)); }) ? r.body.ids : null;
  if (!live) { console.error('msg-file: live_list_unavailable'); return out; }   // never trash on a list that can't be read
  const last = Number(msgProps_().getProperty('MSG_LIVE_LAST') || 0), why = msgLiveVerdict_(live.length, last);
  if (why) { console.error('msg-file: sweep_refused ' + why + ' (' + live.length + ' now, ' + last + ' last run)'); out.refused = why; return out; }   // counts only; nothing is trashed
  const known = JSON.parse(msgProps_().getProperty('MSG_FOLDERS') || '{}');
  Object.keys(known).forEach(function (k) {
    let folder;
    try { folder = DriveApp.getFolderById(known[k]); } catch (e) { return; }
    const files = folder.getFiles();
    while (files.hasNext()) {
      const f = files.next(), tagged = /^msg-(upload|thumb): [0-9a-f-]{36}/.test(String(f.getDescription() || ''));
      if (tagged && live.indexOf(f.getId()) === -1 && Date.now() - f.getDateCreated().getTime() > MSG_ORPHAN_AGE_MS_) { f.setTrashed(true); out.orphans++; }
      else out.kept++;
    }
  });
  msgProps_().setProperty('MSG_LIVE_LAST', String(live.length));   // the baseline for the next run: only a list that was allowed to sweep sets it
  console.log('msg-file: orphans ' + out.orphans + ', kept ' + out.kept);
  return out;
}
/** Uday runs this once if sweep_refused sudden_drop is a real, lasting drop (files really were deleted): the next run takes today's count as normal */
function msgFileAcceptLive() {
  const r = msgDrive_('get', '');
  const n = r && r.code === 200 && r.body && Array.isArray(r.body.ids) ? r.body.ids.length : -1;
  if (n < 1) { console.error('msg-file: accept_failed'); return { ok: false }; }
  msgProps_().setProperty('MSG_LIVE_LAST', String(n));
  return { ok: true, count: n };
}

function installMsgFileTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['msgFileDaily', 'msgFileThumbSync'].indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('msgFileDaily').timeBased().everyDays(1).atHour(3).create();
  ScriptApp.newTrigger('msgFileThumbSync').timeBased().everyMinutes(10).create();
}
