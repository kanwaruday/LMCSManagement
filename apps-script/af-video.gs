// af-video.gs (Roster project, the one with Drive): the Annual Function dance videos go to each school's Google Drive, never the
// database (Uday, 13 Nov: "route the dance videos through google drive… not to the database"). lms-game keeps text only (541).
//  1. gameAfVideoTicket, through lms-game's classic proxy (server to server, the ROSTER_GAME_KEY): a class teacher at their own
//     school, after af_video_start. Params {video, event, deleteAfter, fileName}; the school comes from the proxy. -> {url, expiresAt}
//  2. gameAfVideoPart, the browser's parts against that ticket (app/src/classic/upload.ts: {action, ticket, part, of, base64}).
//     Each part goes straight on into a Drive resumable upload, so a big clip is never reassembled here. The last part answers
//     {success, fileId}; the app records it with af_video_done.
//  Saved as <school folder>/AF Videos <year>/<event>/<video id>.<ext>, shared with that school's Principal, the event's
//  accountable person and the Owner only (no link sharing, no notification email). A file that would be seen by anyone else is
//  trashed and refused (OVERSHARED). The description carries "delete-after: YYYY-MM-DD" (30 days after the school's AF).
//  3. afVideoDaily (a daily trigger; Uday runs installAfVideoTrigger() once): trashes files past their delete-after date, and
//     orphans (no live event_videos row, older than 36 h) from lms-game's af-drive list.
// Script properties (set by Uday, never in the repo): ROSTER_GAME_KEY (= lms-game's CLASSIC_ROSTER_KEY secret), AF_VIDEO_ACCOUNTABLE,
// AF_VIDEO_OWNER (emails), AF_VIDEO_LIVE_URL (lms-game's af-drive function). ROSTER_WEBAPP_URL optional. Logs carry codes and counts
// only: never an email, a school, a file name or a video.

var AFV_TICKET_MS_ = 2 * 60 * 60 * 1000;   // a ticket starts an upload within 2 h; its parts then have the 6 h of the cache
var AFV_PART_BYTES_ = 1310720;             // = app/src/classic/upload.ts PART_BYTES: 5 × 256 KiB, as Drive needs for every part but the last
var AFV_PARTS_MAX_ = 120;                  // 157 MB; lms-game caps a clip at 150 MB
var AFV_ORPHAN_AGE_MS_ = 36 * 60 * 60 * 1000; // af_video_done must come within a day of the start
var AFV_MIME_ = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };
var AFV_DRIVE_ = 'https://www.googleapis.com/drive/v3/files';

function afvOut_(code) { return { success: true, data: { ok: false, code: code } }; }
function afvProps_() { return PropertiesService.getScriptProperties(); }
function afvKeyOk_(given) {
  const want = afvProps_().getProperty('ROSTER_GAME_KEY');
  if (!want || typeof given !== 'string' || given.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}
function afvB64_(s) { return Utilities.base64EncodeWebSafe(s).replace(/=+$/, ''); }
function afvSign_(body) { return afvB64_(Utilities.computeHmacSha256Signature(body, afvProps_().getProperty('ROSTER_GAME_KEY'))); }
function afvToday_() { return Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd'); }
function afvEmail_(s) { const e = String(s || '').trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : ''; }

/** who sees a school's videos: its Principal(s) on the allowlist, the accountable person, the Owner. null if any is missing. */
function afvViewers_(campus) {
  const principals = readEntries().filter(function (x) { return x.role === 'Principal' && x.campusId === campus; }).map(function (x) { return afvEmail_(x.email); }).filter(Boolean);
  const acc = afvEmail_(afvProps_().getProperty('AF_VIDEO_ACCOUNTABLE')), owner = afvEmail_(afvProps_().getProperty('AF_VIDEO_OWNER'));
  if (!principals.length || !acc || !owner) return null;
  return principals.concat([acc, owner]).filter(function (e, i, a) { return a.indexOf(e) === i; });
}

function afvApi_(method, url, body) {
  const o = { method: method, muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } };
  if (body !== undefined) { o.contentType = 'application/json'; o.payload = JSON.stringify(body); }
  return UrlFetchApp.fetch(url, o);
}

/** <school folder>/AF Videos <year>/<event>, made if missing. The year folder is made with inherited access turned off where Drive
 *  allows it; the OVERSHARED check after each upload is what guarantees who can see a file. Folder ids are kept for the sweep. */
function afvFolder_(campus, event, year) {
  const dir = SCHOOL_TO_CAMPUS_DIR_[STAFF_CAMPUS_SHEET_LABEL_[campus]];
  const school = dir && getSubfolder_(DriveApp.getFolderById(CENTRAL_REPO_FOLDER_ID_), dir);
  if (!school) return null;
  const name = 'AF Videos ' + year;
  let top = getSubfolder_(school, name);
  if (!top) {
    top = school.createFolder(name);
    afvApi_('patch', AFV_DRIVE_ + '/' + top.getId() + '?supportsAllDrives=true', { inheritedPermissionsDisabled: true });
  }
  const p = afvProps_(), known = JSON.parse(p.getProperty('AFV_FOLDERS') || '{}');
  if (known[campus + ':' + year] !== top.getId()) { known[campus + ':' + year] = top.getId(); p.setProperty('AFV_FOLDERS', JSON.stringify(known)); }
  return getSubfolder_(top, event) || top.createFolder(event);
}

// ── 1. the ticket ──────────────────────────────────────────────────
function gameAfVideoTicket_(b) {
  if (!afvKeyOk_(b.key)) return { success: false, error: 'not_authorized' };
  if (b.role !== 'teacher') return afvOut_('not_authorized');
  const campus = String(b.campus || '').trim().toUpperCase(), email = afvEmail_(b.email), p = b.params && typeof b.params === 'object' ? b.params : {};
  if (!/^[A-Z0-9]{2,8}$/.test(campus)) return afvOut_('campus_needed');
  if (!email) return afvOut_('who');
  const video = String(p.video || ''), event = String(p.event || ''), del = String(p.deleteAfter || ''), name = String(p.fileName || '');
  const ext = (name.match(/^([0-9a-f-]{36})\.(mp4|mov|webm)$/) || [])[2];
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(video) || name.indexOf(video + '.') !== 0 || !ext
    || !/^[a-z][a-z0-9_]{1,39}$/.test(event) || !/^\d{4}-\d{2}-\d{2}$/.test(del) || del < afvToday_()) return afvOut_('bad_input');
  if (!afvViewers_(campus)) return afvOut_('not_configured');
  const exp = Date.now() + AFV_TICKET_MS_;
  const body = afvB64_(JSON.stringify({ c: campus, ev: event, d: del, n: name, m: AFV_MIME_[ext], y: (event.match(/20\d\d/) || [del.slice(0, 4)])[0],
    x: exp, r: Utilities.getUuid() }));
  const url = afvProps_().getProperty('ROSTER_WEBAPP_URL') || ScriptApp.getService().getUrl();
  return { success: true, data: { url: url + '?ticket=' + body + '.' + afvSign_(body) + '&action=gameAfVideoPart', expiresAt: new Date(exp).toISOString() } };
}

function afvTicket_(s) {
  const at = String(s || '').indexOf('.');
  if (at < 1 || !afvProps_().getProperty('ROSTER_GAME_KEY')) return null;
  const body = s.slice(0, at);
  if (s.slice(at + 1) !== afvSign_(body)) return null;
  try { return JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(body + '==='.slice((body.length + 3) % 4))).getDataAsString()); } catch (e) { return null; }
}

// ── 2. the parts ───────────────────────────────────────────────────
// State per ticket (its nonce) in the script cache: the Drive session, the next part, the bytes sent. Parts come in order, one
// at a time (upload.ts); a resent part that already went answers success, so a retry never sends bytes twice.
// ponytail: the cache can drop an entry under memory pressure; then the upload fails and the teacher sends it again (no
// half file is left: Drive keeps nothing from an unfinished session). PropertiesService if that is ever seen.
function gameAfVideoPart_(b) {
  const t = afvTicket_(b.ticket);
  if (!t) return { success: false, error: 'not_authorized' };
  const cache = CacheService.getScriptCache(), done = cache.get('afv_done_' + t.r);
  if (done) return { success: true, fileId: done }; // the last part resent after it finished
  if (cache.get('afv_fail_' + t.r)) return { success: false, error: 'not_authorized' };
  const part = Number(b.part), of = Number(b.of), base64 = String(b.base64 || '');
  if (!Number.isInteger(part) || !Number.isInteger(of) || of < 1 || of > AFV_PARTS_MAX_ || part < 1 || part > of) return { success: false, error: 'BAD_PART' };
  if (!base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length > Math.ceil(AFV_PART_BYTES_ / 3) * 4) return { success: false, error: 'BAD_PART' };
  const bytes = Utilities.base64Decode(base64), last = part === of;
  if (!last && bytes.length !== AFV_PART_BYTES_) return { success: false, error: 'BAD_PART' };
  let st = JSON.parse(cache.get('afv_st_' + t.r) || 'null');
  if (!st) {
    if (part !== 1) return { success: false, error: 'NO_UPLOAD' };
    if (t.x < Date.now()) return { success: false, error: 'not_authorized' }; // a ticket only starts an upload while it's fresh
    const folder = afvFolder_(t.c, t.ev, t.y);
    if (!folder) return { success: false, error: 'NO_FOLDER' };
    const r = afvApi_('post', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true',
      { name: t.n, parents: [folder.getId()], mimeType: t.m, description: 'delete-after: ' + t.d + '\nAnnual Function video (lms-game). Shared with the Principal, the accountable person and the Owner only.' });
    const loc = r.getResponseCode() === 200 && (r.getHeaders().Location || r.getHeaders().location);
    if (!loc) { console.error('af-video: session ' + r.getResponseCode()); return { success: false, error: 'DRIVE' }; }
    st = { s: loc, next: 1, off: 0 };
  }
  if (part < st.next) return { success: true };
  if (part > st.next) return { success: false, error: 'OUT_OF_ORDER' };
  let skip = 0;
  if (st.fly === part) { // this part was sent before and its answer was lost: ask Drive how much it holds
    const q = UrlFetchApp.fetch(st.s, { method: 'put', payload: '', muteHttpExceptions: true, headers: { 'Content-Range': 'bytes */' + (last ? st.off + bytes.length : '*') } });
    if (q.getResponseCode() === 200 || q.getResponseCode() === 201) return afvFinish_(t, cache, q);
    const got = q.getResponseCode() === 308 ? (String(q.getHeaders().Range || q.getHeaders().range || '').match(/-(\d+)$/) || [])[1] : undefined;
    skip = got === undefined ? 0 : Number(got) + 1 - st.off;
    if (!(skip >= 0 && skip <= bytes.length)) return { success: false, error: 'DRIVE' };
  }
  st.fly = part; cache.put('afv_st_' + t.r, JSON.stringify(st), 21600);
  const from = st.off + skip, to = st.off + bytes.length - 1;
  let r = null;
  if (from > to && last) return { success: false, error: 'DRIVE' }; // Drive holds every byte yet didn't say it finished
  if (from <= to) {
    r = UrlFetchApp.fetch(st.s, { method: 'put', contentType: t.m, payload: skip ? bytes.slice(skip) : bytes, muteHttpExceptions: true,
      headers: { 'Content-Range': 'bytes ' + from + '-' + to + '/' + (last ? to + 1 : '*') } });
    const code = r.getResponseCode();
    if (last && (code === 200 || code === 201)) return afvFinish_(t, cache, r);
    if (last || code !== 308) { console.error('af-video: part ' + code); return { success: false, error: 'DRIVE' }; }
  }
  st.next = part + 1; st.off = to + 1; delete st.fly;
  cache.put('afv_st_' + t.r, JSON.stringify(st), 21600);
  return { success: true };
}

/** the upload is complete: share it with exactly the school's viewers, check no one else can see it, answer the id */
function afvFinish_(t, cache, res) {
  let id;
  try { id = JSON.parse(res.getContentText()).id; } catch (e) { id = null; }
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(String(id || ''))) return { success: false, error: 'DRIVE' };
  const viewers = afvViewers_(t.c), me = afvEmail_(Session.getEffectiveUser().getEmail()); // me: the deploying account owns the file
  const ok = viewers && viewers.every(function (e) {
    return e === me || afvApi_('post', AFV_DRIVE_ + '/' + id + '/permissions?sendNotificationEmail=false&supportsAllDrives=true', { type: 'user', role: 'reader', emailAddress: e }).getResponseCode() === 200;
  });
  const list = afvApi_('get', AFV_DRIVE_ + '/' + id + '/permissions?supportsAllDrives=true&fields=permissions(type,emailAddress)');
  let perms = null;
  try { perms = list.getResponseCode() === 200 ? JSON.parse(list.getContentText()).permissions : null; } catch (e) { perms = null; }
  const allowed = (viewers || []).concat([me]);
  const clean = ok && Array.isArray(perms) && perms.every(function (x) { return x.type === 'user' && allowed.indexOf(afvEmail_(x.emailAddress)) !== -1; });
  if (!clean) { // never leave a child's video where someone else could see it
    afvApi_('patch', AFV_DRIVE_ + '/' + id + '?supportsAllDrives=true', { trashed: true });
    cache.remove('afv_st_' + t.r); cache.put('afv_fail_' + t.r, '1', 21600); // the ticket is spent: a resend never uploads again or answers the trashed id
    console.error('af-video: ' + (ok ? 'overshared' : 'share_failed'));
    return { success: false, error: ok ? 'OVERSHARED' : 'SHARE_FAILED' };
  }
  cache.put('afv_done_' + t.r, id, 21600);
  cache.remove('afv_st_' + t.r);
  return { success: true, fileId: id };
}

// ── 3. the daily sweep ─────────────────────────────────────────────
function afVideoDaily() {
  const out = { trashed: 0, orphans: 0, kept: 0 };
  const today = afvToday_(), p = afvProps_(), known = JSON.parse(p.getProperty('AFV_FOLDERS') || '{}');
  // the live file ids: null when the list can't be read or is empty, and then no orphan is touched
  let live = null;
  const url = String(p.getProperty('AF_VIDEO_LIVE_URL') || ''), key = p.getProperty('ROSTER_GAME_KEY');
  if (/^https:\/\//.test(url) && key) {
    const r = UrlFetchApp.fetch(url, { method: 'get', headers: { 'x-roster-key': key }, muteHttpExceptions: true });
    try { const ids = r.getResponseCode() === 200 ? JSON.parse(r.getContentText()).ids : null; if (Array.isArray(ids) && ids.length) live = ids; } catch (e) { live = null; }
  }
  if (!live) console.error('af-video: live_list_unavailable');
  Object.keys(known).forEach(function (k) {
    let top;
    try { top = DriveApp.getFolderById(known[k]); } catch (e) { console.error('af-video: folder_missing'); return; }
    const events = top.getFolders();
    while (events.hasNext()) {
      const files = events.next().getFiles();
      while (files.hasNext()) {
        const f = files.next(), when = (String(f.getDescription() || '').match(/delete-after: (\d{4}-\d{2}-\d{2})/) || [])[1];
        if (when && when < today) { f.setTrashed(true); out.trashed++; }
        else if (live && live.indexOf(f.getId()) === -1 && Date.now() - f.getDateCreated().getTime() > AFV_ORPHAN_AGE_MS_) { f.setTrashed(true); out.orphans++; }
        else out.kept++;
      }
    }
  });
  console.log('af-video: trashed ' + out.trashed + ', orphans ' + out.orphans + ', kept ' + out.kept);
  return out;
}

/** Uday runs this once from the editor; it replaces any earlier AF video trigger. Daily at about 03:00 IST. */
function installAfVideoTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'afVideoDaily') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('afVideoDaily').timeBased().everyDays(1).atHour(3).create();
}
