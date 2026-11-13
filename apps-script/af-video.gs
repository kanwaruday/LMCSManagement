// af-video.gs (Roster project, the one with Drive): the Annual Function dance videos go to each school's Google Drive, never the
// database (Uday, 13 Nov: "route the dance videos through google drive… not to the database"). lms-game keeps text only (541).
//  1. gameAfVideoTicket, through lms-game's classic proxy (server to server, the ROSTER_GAME_KEY): a class teacher at their own
//     school, after af_video_start. Only params.video is used: the school, event, file name, mime and delete-after come from that
//     event_videos row, read on the server from lms-game's af-drive (G2, 14 Nov). The row must be the caller's own (its uploader's
//     email = the proxy's JWT-verified email), at the proxy's school, and not finished. -> {url, expiresAt}
//  2. gameAfVideoPart, the browser's parts against that ticket (app/src/classic/upload.ts: {action, ticket, part, of, base64}).
//     Each part goes straight on into a Drive resumable upload, so a big clip is never reassembled here. The last part answers
//     {success, fileId}; the app records it with af_video_done.
//  Saved as <school folder>/AF Videos <year>/<event>/<video id>.<ext>, shared with that school's viewers only (no link sharing, no
//  notification email). The viewers are data, decided in lms-game (af_viewers; Uday, 14 Nov: "Let this be flexible"): every Owner,
//  everyone Uday grants the event role af_judge for that school or all schools, and the school's Principal. A file that would be seen by anyone else is
//  trashed and refused (OVERSHARED). copyRequiresWriterPermission: viewers get no download, print or copy (Drive's preview
//  pop-out). The description carries "delete-after: YYYY-MM-DD" (30 days after the school's AF).
//  3. afVideoDaily (a daily trigger; Uday runs installAfVideoTrigger() once): trashes files past their delete-after date, and
//     orphans (no live event_videos row, older than 36 h) from lms-game's af-drive list; then a full share check.
//  4. afVideoShareSync (every 10 min): a grant or revoke of af_judge (or a new Owner or Principal) reaches Drive within ~10 minutes.
//     One af-drive call lists each school + event's viewers and live files; only a group whose viewers changed since the last
//     pass is re-synced: missing readers added, readers no longer allowed removed (a permission, never the file).
// Script properties (set by Uday, never in the repo): ROSTER_GAME_KEY (= lms-game's CLASSIC_ROSTER_KEY secret), AF_VIDEO_LIVE_URL
// (lms-game's af-drive function), ROSTER_WEBAPP_URL optional. AF_VIDEO_ACCOUNTABLE / AF_VIDEO_OWNER: a fallback only, used while
// af-drive sends no viewer list (before af_viewers ships); ignored once it does. Logs carry codes and counts
// only: never an email, a school, a file name or a video.

var AFV_TICKET_MS_ = 2 * 60 * 60 * 1000;   // a ticket starts an upload within 2 h; its parts then have the 6 h of the cache
var AFV_PART_BYTES_ = 1310720;             // = app/src/classic/upload.ts PART_BYTES: 5 × 256 KiB, as Drive needs for every part but the last
var AFV_PARTS_MAX_ = 40;                   // 52.4 MB; lms-game caps a clip at 50 MB (541 bytes check), so a bigger upload is refused here too
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

/** who sees a school's videos: the viewer list af-drive sent with the row (lms-game's af_viewers), else the old fallback (the
 *  school's Principal(s) on the allowlist + the two properties). null if there is no one to share with. */
function afvViewers_(campus, row) {
  if (row && Array.isArray(row.viewers)) {
    const v = row.viewers.map(afvEmail_).filter(function (e, i, a) { return e && a.indexOf(e) === i; });
    return v.length ? v : null;
  }
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
  const video = String(p.video || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(video)) return afvOut_('bad_input');
  const row = afvRow_(video);
  if (row === null) return afvOut_('not_configured');
  if (!row || row.campus !== campus || afvEmail_(row.email) !== email) return afvOut_('not_authorized');
  if (!row.open) return afvOut_('done');
  if (!afvViewers_(campus, row)) return afvOut_('not_configured');
  const event = String(row.event || ''), del = String(row.deleteAfter || ''), ext = Object.keys(AFV_MIME_).filter(function (k) { return AFV_MIME_[k] === row.mime; })[0];
  if (!ext || !/^[a-z][a-z0-9_]{1,39}$/.test(event) || !/^\d{4}-\d{2}-\d{2}$/.test(del) || del < afvToday_()) return afvOut_('bad_input');
  const name = video + '.' + ext;
  const exp = Date.now() + AFV_TICKET_MS_;
  const body = afvB64_(JSON.stringify({ c: campus, v: video, ev: event, d: del, n: name, m: AFV_MIME_[ext], y: (event.match(/20\d\d/) || [del.slice(0, 4)])[0],
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

/** the event_videos row from lms-game's af-drive (service role there; teachers can't read the table). false = no such row,
 *  null = af-drive unreachable or not set up. The key goes in a header, the video id in the query (an id, never a person). */
function afvRow_(video) {
  const url = String(afvProps_().getProperty('AF_VIDEO_LIVE_URL') || ''), key = afvProps_().getProperty('ROSTER_GAME_KEY');
  if (!/^https:\/\//.test(url) || !key) return null;
  const r = UrlFetchApp.fetch(url + '?video=' + video, { method: 'get', headers: { 'x-roster-key': key }, muteHttpExceptions: true });
  if (r.getResponseCode() === 404) return false;
  try { const v = r.getResponseCode() === 200 ? JSON.parse(r.getContentText()).video : null; return v && typeof v === 'object' ? v : null; } catch (e) { return null; }
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
      { name: t.n, parents: [folder.getId()], mimeType: t.m, copyRequiresWriterPermission: true, description: 'delete-after: ' + t.d + '\nAnnual Function video (lms-game). Shared with the school\'s AF video viewers only.' });
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
  const fresh = t.v ? afvRow_(t.v) : null; // the viewers as they are now, not when the ticket was issued
  const viewers = afvViewers_(t.c, fresh || null), me = afvEmail_(Session.getEffectiveUser().getEmail()); // me: the deploying account owns the file
  const ok = viewers && viewers.every(function (e) {
    return e === me || afvApi_('post', AFV_DRIVE_ + '/' + id + '/permissions?sendNotificationEmail=false&supportsAllDrives=true', { type: 'user', role: 'reader', emailAddress: e }).getResponseCode() === 200;
  });
  const list = afvApi_('get', AFV_DRIVE_ + '/' + id + '/permissions?supportsAllDrives=true&fields=permissions(type,emailAddress,permissionDetails(permissionType))');
  let perms = null;
  try { perms = list.getResponseCode() === 200 ? JSON.parse(list.getContentText()).permissions : null; } catch (e) { perms = null; }
  const allowed = (viewers || []).concat([me]);
  const extra = Array.isArray(perms) ? perms.filter(function (x) { return !(x.type === 'user' && allowed.indexOf(afvEmail_(x.emailAddress)) !== -1); }) : null;
  const clean = ok && extra && !extra.length;
  // a school folder inside a shared drive: its members see every file, so every upload there is refused; say so in the log (G2 low)
  const member = extra && extra.some(function (x) { return (x.permissionDetails || []).some(function (d) { return d.permissionType === 'member'; }); });
  if (!clean) { // never leave a child's video where someone else could see it
    afvApi_('patch', AFV_DRIVE_ + '/' + id + '?supportsAllDrives=true', { trashed: true });
    cache.remove('afv_st_' + t.r); cache.put('afv_fail_' + t.r, '1', 21600); // the ticket is spent: a resend never uploads again or answers the trashed id
    console.error('af-video: ' + (!ok ? 'share_failed' : member ? 'overshared_shared_drive_members' : 'overshared'));
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
  afVideoShareSync(true); // once a day every group, whatever its hash: catches a reader added or removed by hand
  return out;
}

// ── 4. keeping Drive's readers = the viewers ───────────────────────
// ponytail: a group's set is compared by a hash in a script property (one small JSON); a pass that runs out of time leaves the rest
// unhashed and the next pass carries on.
var AFV_SYNC_BUDGET_MS_ = 4.5 * 60 * 1000;

function afVideoShareSync(full) {
  const out = { groups: 0, changed: 0, added: 0, removed: 0, failed: 0 };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) { console.log('af-video: sync busy'); return out; }
  try {
    const p = afvProps_(), url = String(p.getProperty('AF_VIDEO_LIVE_URL') || ''), key = p.getProperty('ROSTER_GAME_KEY');
    if (!/^https:\/\//.test(url) || !key) { console.error('af-video: sync not_configured'); return out; }
    const r = UrlFetchApp.fetch(url + '?groups=1', { method: 'get', headers: { 'x-roster-key': key }, muteHttpExceptions: true });
    let groups = null;
    try { groups = r.getResponseCode() === 200 ? JSON.parse(r.getContentText()).groups : null; } catch (e) { groups = null; }
    if (!Array.isArray(groups)) { console.error('af-video: sync list ' + r.getResponseCode()); return out; }
    const hashes = JSON.parse(p.getProperty('AFV_SHARE_HASHES') || '{}'), me = afvEmail_(Session.getEffectiveUser().getEmail()), started = Date.now();
    const next = {};
    groups.forEach(function (g) {
      const k = String(g.campus) + ':' + String(g.event), emails = (Array.isArray(g.emails) ? g.emails : []).map(afvEmail_).filter(Boolean).sort();
      const h = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, emails.join(',')));
      out.groups++;
      if (!full && hashes[k] === h) { next[k] = h; return; }
      if (!emails.length || Date.now() - started > AFV_SYNC_BUDGET_MS_) return; // no one listed: never strip every reader; out of time: next pass
      out.changed++;
      let ok = true;
      (Array.isArray(g.files) ? g.files : []).forEach(function (id) {
        if (!/^[A-Za-z0-9_-]{10,200}$/.test(String(id))) return;
        const c = afvSyncFile_(String(id), emails, me);
        out.added += c.added; out.removed += c.removed;
        if (!c.ok) { ok = false; out.failed++; }
      });
      if (ok) next[k] = h; // a group with a failed file is tried again next pass
    });
    p.setProperty('AFV_SHARE_HASHES', JSON.stringify(next));
    console.log('af-video: sync ' + out.groups + ' groups, ' + out.changed + ' changed, +' + out.added + ' -' + out.removed + ', failed ' + out.failed);
    return out;
  } finally { lock.releaseLock(); }
}

/** one file: readers = emails (plus the owning account). Adds the missing (no email), removes every other direct permission. An
 *  inherited one (a shared drive's members) can't be removed from the file: it is logged, and the upload check refuses such folders. */
function afvSyncFile_(id, emails, me) {
  const res = { ok: true, added: 0, removed: 0 };
  const list = afvApi_('get', AFV_DRIVE_ + '/' + id + '/permissions?supportsAllDrives=true&fields=permissions(id,type,emailAddress,role,permissionDetails(inherited))');
  let perms;
  try { perms = list.getResponseCode() === 200 ? JSON.parse(list.getContentText()).permissions : null; } catch (e) { perms = null; }
  if (list.getResponseCode() === 404) return res; // trashed or gone: nothing to share
  if (!Array.isArray(perms)) return { ok: false, added: 0, removed: 0 };
  const have = perms.filter(function (x) { return x.type === 'user'; }).map(function (x) { return afvEmail_(x.emailAddress); });
  emails.forEach(function (e) {
    if (e === me || have.indexOf(e) !== -1) return;
    const r = afvApi_('post', AFV_DRIVE_ + '/' + id + '/permissions?sendNotificationEmail=false&supportsAllDrives=true', { type: 'user', role: 'reader', emailAddress: e });
    if (r.getResponseCode() === 200) res.added++; else res.ok = false;
  });
  perms.forEach(function (x) {
    const e = afvEmail_(x.emailAddress);
    if (x.role === 'owner' || (x.type === 'user' && (e === me || emails.indexOf(e) !== -1))) return;
    if ((x.permissionDetails || []).some(function (d) { return d.inherited; })) { console.error('af-video: inherited_extra'); res.ok = false; return; }
    const r = afvApi_('delete', AFV_DRIVE_ + '/' + id + '/permissions/' + encodeURIComponent(x.id) + '?supportsAllDrives=true');
    if (r.getResponseCode() === 204 || r.getResponseCode() === 200) res.removed++; else res.ok = false;
  });
  return res;
}

/** Uday runs this once from the editor (again after this change); it replaces the earlier AF video triggers: the daily sweep at about
 *  03:00 IST and the share sync every 10 minutes. */
function installAfVideoTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (['afVideoDaily', 'afVideoShareSync'].indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('afVideoDaily').timeBased().everyDays(1).atHour(3).create();
  ScriptApp.newTrigger('afVideoShareSync').timeBased().everyMinutes(10).create();
}
