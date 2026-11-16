// hr-file.gs (Roster project; lms-game brief C slice 2, migration 618): a staff member's paper (a photo or a PDF) straight into their
// school's HR Drive folder, the way af-video.gs streams AF videos. Reuses af-video.gs's helpers (same project, one global scope):
// afvKeyOk_, afvB64_, afvSign_, afvTicket_, afvProps_, afvApi_, afvEmail_, afvOut_, AFV_DRIVE_, AFV_PART_BYTES_.
//  1. gameHrFileTicket, through lms-game's classic proxy (server to server, the ROSTER_GAME_KEY): a staff member at their own school
//     asks for a ticket for one upload id. The row (school, folder, mime, the uploader's email) comes from lms-game's hr-drive
//     function, never from the app's params; a row that isn't the caller's, is finished or has no folder is refused.
//  2. gameHrFilePart, the browser's parts against that ticket (signed, 2 h to start), into a Drive resumable session in the folder.
//     The file inherits the HR folder's own access: nothing is shared. On finish, any permission beyond the folder's people (anyone
//     with the link, a whole domain) trashes the file and refuses: a paper with ID or bank details never sits behind a link.
//  3. hrFileDaily (a daily trigger; Uday runs installHrFileTrigger() once): every live paper is checked again, so a link shared later
//     is caught too: the file is trashed and hr-drive returns the paper to the person ("upload it again").
// Script properties (set by Uday, never in the repo): ROSTER_GAME_KEY (as af-video.gs), HR_DRIVE_LIVE_URL (lms-game's hr-drive
// function), ROSTER_WEBAPP_URL optional. Folder ids live only in lms-game's hr_drive_folders setting. Logs carry codes and counts
// only: never an email, a school, a file name or a paper.

var HRF_TICKET_MS_ = 2 * 60 * 60 * 1000;   // a ticket starts an upload within 2 h
var HRF_PARTS_MAX_ = 8;                    // 8 x 1.31 MB = 10.5 MB; lms-game caps a paper at 10 MB (618), so a bigger one is refused here too
var HRF_MIME_ = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', pdf: 'application/pdf' };
var HRF_ROLES_ = ['principal', 'coordinator', 'teacher', 'fee_clerk', 'driver', 'bus_incharge', 'it_teacher', 'pti', 'non_teaching'];
var HRF_SWEEP_MAX_ = 400;                  // files checked per daily run; ponytail: page through more if a tenant ever holds more papers

/** lms-game's hr-drive row for an upload. false = no such row, 'no_folder' = the school has no HR folder set, null = unreachable. */
function hrfRow_(upload) {
  const url = String(afvProps_().getProperty('HR_DRIVE_LIVE_URL') || ''), key = afvProps_().getProperty('ROSTER_GAME_KEY');
  if (!/^https:\/\//.test(url) || !key) return null;
  const r = UrlFetchApp.fetch(url + '?upload=' + upload, { method: 'get', headers: { 'x-roster-key': key }, muteHttpExceptions: true });
  if (r.getResponseCode() === 404) return false;
  if (r.getResponseCode() === 409) return 'no_folder';
  try { const u = r.getResponseCode() === 200 ? JSON.parse(r.getContentText()).upload : null; return u && typeof u === 'object' ? u : null; } catch (e) { return null; }
}

function gameHrFileTicket_(b) {
  if (!afvKeyOk_(b.key)) return { success: false, error: 'not_authorized' };
  if (HRF_ROLES_.indexOf(b.role) === -1) return afvOut_('not_authorized');
  const campus = String(b.campus || '').trim().toUpperCase(), email = afvEmail_(b.email), p = b.params && typeof b.params === 'object' ? b.params : {};
  if (!/^[A-Z0-9]{2,8}$/.test(campus)) return afvOut_('campus_needed');
  if (!email) return afvOut_('who');
  const upload = String(p.upload || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(upload)) return afvOut_('bad_input');
  const row = hrfRow_(upload);
  if (row === null || row === 'no_folder') return afvOut_('not_configured');
  if (!row || row.campus !== campus || afvEmail_(row.email) !== email) return afvOut_('not_authorized');
  if (!row.open) return afvOut_('done');
  const ext = Object.keys(HRF_MIME_).filter(function (k) { return HRF_MIME_[k] === row.mime; })[0];
  if (!ext || !/^[A-Za-z0-9_-]{10,200}$/.test(String(row.folder || ''))) return afvOut_('bad_input');
  const exp = Date.now() + HRF_TICKET_MS_;
  const body = afvB64_(JSON.stringify({ k: 'hr', u: upload, f: row.folder, n: upload + '.' + ext, m: HRF_MIME_[ext], x: exp, r: Utilities.getUuid() }));
  const url = afvProps_().getProperty('ROSTER_WEBAPP_URL') || ScriptApp.getService().getUrl();
  return { success: true, data: { url: url + '?ticket=' + body + '.' + afvSign_(body) + '&action=gameHrFilePart', expiresAt: new Date(exp).toISOString() } };
}

// ── 2. the parts ── as af-video.gs's gameAfVideoPart_ (state per ticket nonce in the script cache; parts in order; a resent part
// that already went answers success), with the folder from the signed ticket and no sharing step.
// ponytail: this mirrors gameAfVideoPart_ rather than sharing it, so lane-t's AF file stays untouched; fold the two together if a
// third ticket upload ever needs the same machinery.
function gameHrFilePart_(b) {
  const t = afvTicket_(b.ticket);
  if (!t || t.k !== 'hr') return { success: false, error: 'not_authorized' };   // an AF ticket never uploads into an HR folder
  const cache = CacheService.getScriptCache(), done = cache.get('hrf_done_' + t.r);
  if (done) return { success: true, fileId: done };
  if (cache.get('hrf_fail_' + t.r)) return { success: false, error: 'not_authorized' };
  const part = Number(b.part), of = Number(b.of), base64 = String(b.base64 || '');
  if (!Number.isInteger(part) || !Number.isInteger(of) || of < 1 || of > HRF_PARTS_MAX_ || part < 1 || part > of) return { success: false, error: 'BAD_PART' };
  if (!base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length > Math.ceil(AFV_PART_BYTES_ / 3) * 4) return { success: false, error: 'BAD_PART' };
  const bytes = Utilities.base64Decode(base64), last = part === of;
  if (!last && bytes.length !== AFV_PART_BYTES_) return { success: false, error: 'BAD_PART' };
  let st = JSON.parse(cache.get('hrf_st_' + t.r) || 'null');
  if (!st) {
    if (part !== 1) return { success: false, error: 'NO_UPLOAD' };
    if (t.x < Date.now()) return { success: false, error: 'not_authorized' };
    const r = afvApi_('post', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true',
      { name: t.n, parents: [t.f], mimeType: t.m, copyRequiresWriterPermission: true, description: 'Staff file paper (lms-game). Kept in the school HR folder only; never shared by link.' });
    const loc = r.getResponseCode() === 200 && (r.getHeaders().Location || r.getHeaders().location);
    if (!loc) { console.error('hr-file: session ' + r.getResponseCode()); return { success: false, error: 'DRIVE' }; }
    st = { s: loc, next: 1, off: 0 };
  }
  if (part < st.next) return { success: true };
  if (part > st.next) return { success: false, error: 'OUT_OF_ORDER' };
  let skip = 0;
  if (st.fly === part) {
    const q = UrlFetchApp.fetch(st.s, { method: 'put', payload: '', muteHttpExceptions: true, headers: { 'Content-Range': 'bytes */' + (last ? st.off + bytes.length : '*') } });
    if (q.getResponseCode() === 200 || q.getResponseCode() === 201) return hrfFinish_(t, cache, q);
    const got = q.getResponseCode() === 308 ? (String(q.getHeaders().Range || q.getHeaders().range || '').match(/-(\d+)$/) || [])[1] : undefined;
    skip = got === undefined ? 0 : Number(got) + 1 - st.off;
    if (!(skip >= 0 && skip <= bytes.length)) return { success: false, error: 'DRIVE' };
  }
  st.fly = part; cache.put('hrf_st_' + t.r, JSON.stringify(st), 21600);
  const from = st.off + skip, to = st.off + bytes.length - 1;
  if (from > to && last) return { success: false, error: 'DRIVE' };
  if (from <= to) {
    const r = UrlFetchApp.fetch(st.s, { method: 'put', contentType: t.m, payload: skip ? bytes.slice(skip) : bytes, muteHttpExceptions: true,
      headers: { 'Content-Range': 'bytes ' + from + '-' + to + '/' + (last ? to + 1 : '*') } });
    const code = r.getResponseCode();
    if (last && (code === 200 || code === 201)) return hrfFinish_(t, cache, r);
    if (last || code !== 308) { console.error('hr-file: part ' + code); return { success: false, error: 'DRIVE' }; }
  }
  st.next = part + 1; st.off = to + 1; delete st.fly;
  cache.put('hrf_st_' + t.r, JSON.stringify(st), 21600);
  return { success: true };
}

/** is the file reachable beyond its folder's people? (anyone with the link, a whole domain). null = the permissions can't be read. */
function hrfOpen_(id) {
  const list = afvApi_('get', AFV_DRIVE_ + '/' + id + '/permissions?supportsAllDrives=true&fields=permissions(type)');
  let perms = null;
  try { perms = list.getResponseCode() === 200 ? JSON.parse(list.getContentText()).permissions : null; } catch (e) { perms = null; }
  return Array.isArray(perms) ? perms.some(function (x) { return x.type === 'anyone' || x.type === 'domain'; }) : null;
}

function hrfFinish_(t, cache, res) {
  let id;
  try { id = JSON.parse(res.getContentText()).id; } catch (e) { id = null; }
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(String(id || ''))) return { success: false, error: 'DRIVE' };
  const open = hrfOpen_(id);
  if (open !== false) { // shared by link or domain, or unknown: never leave a paper with ID or bank details there
    afvApi_('patch', AFV_DRIVE_ + '/' + id + '?supportsAllDrives=true', { trashed: true });
    cache.remove('hrf_st_' + t.r); cache.put('hrf_fail_' + t.r, '1', 21600);
    console.error('hr-file: ' + (open ? 'overshared' : 'perms_unreadable'));
    return { success: false, error: open ? 'OVERSHARED' : 'SHARE_CHECK' };
  }
  cache.put('hrf_done_' + t.r, id, 21600);
  cache.remove('hrf_st_' + t.r);
  return { success: true, fileId: id };
}

// ── 3. the daily sweep: a link shared after the upload is caught too ──
function hrFileDaily() {
  const out = { checked: 0, trashed: 0, unreadable: 0 };
  const url = String(afvProps_().getProperty('HR_DRIVE_LIVE_URL') || ''), key = afvProps_().getProperty('ROSTER_GAME_KEY');
  if (!/^https:\/\//.test(url) || !key) { console.error('hr-file: sweep_not_configured'); return out; }
  const r = UrlFetchApp.fetch(url, { method: 'get', headers: { 'x-roster-key': key }, muteHttpExceptions: true });
  let ids = null;
  try { ids = r.getResponseCode() === 200 ? JSON.parse(r.getContentText()).ids : null; } catch (e) { ids = null; }
  if (!Array.isArray(ids)) { console.error('hr-file: live_list_unavailable'); return out; }
  ids.slice(0, HRF_SWEEP_MAX_).forEach(function (id) {
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(String(id))) return;
    out.checked++;
    const open = hrfOpen_(id);
    if (open === null) { out.unreadable++; return; }   // can't tell today: tomorrow's run asks again (nothing is trashed on a guess)
    if (!open) return;
    afvApi_('patch', AFV_DRIVE_ + '/' + id + '?supportsAllDrives=true', { trashed: true });
    UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload: JSON.stringify({ swept: id }), headers: { 'x-roster-key': key }, muteHttpExceptions: true });
    out.trashed++;
  });
  console.log('hr-file: sweep ' + JSON.stringify(out));
  return out;
}

/** Uday runs this once from the editor: the daily HR file sweep at about 04:00 IST. */
function installHrFileTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'hrFileDaily') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('hrFileDaily').timeBased().everyDays(1).atHour(4).create();
}
