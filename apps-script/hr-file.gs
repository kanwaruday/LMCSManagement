// hr-file.gs (Roster project; lms-game brief C slice 2, migration 618): a staff member's paper (a photo or a PDF) straight into their
// school's HR Drive folder, the way af-video.gs streams AF videos. Reuses af-video.gs's helpers (same project, one global scope):
// afvKeyOk_, afvB64_, afvSign_, afvTicket_, afvProps_, afvApi_, afvEmail_, afvOut_, AFV_DRIVE_, AFV_PART_BYTES_.
//  1. gameHrFileTicket, through lms-game's classic proxy (server to server, the ROSTER_GAME_KEY): a staff member at their own school
//     asks for a ticket for one upload id. The row (school, folder, mime, the uploader's email) is CLAIMED from lms-game's hr-drive
//     function (one ticket per upload, G2), never taken from the app's params; a row that isn't the caller's, is finished, has no folder
//     or already has a ticket is refused.
//  2. gameHrFilePart, the browser's parts against that ticket (signed, 2 h to start), into a Drive resumable session in the folder.
//     Each file is tagged at create (appProperties lmsStaffPaper = the upload id). The file inherits the HR folder's own access:
//     nothing is shared. On finish, any permission beyond the folder's people (anyone with the link, a whole domain) trashes the file
//     and refuses; otherwise the Roster records it with lms-game itself (hr-drive done), server to server: the browser never sends a
//     Drive id (G2b). If that record fails, the file is trashed (no paper the game doesn't know about).
//  3. hrFileDaily (a daily trigger; hrfSelfSetup_() installs it once, from the first doGet/doPost, and derives HR_DRIVE_LIVE_URL from PROOF_MIRROR_URL when unset): every live paper is checked again, so a link shared later
//     is caught too: the file is trashed and hr-drive returns the paper to the person ("upload it again"). It touches ONLY a file that
//     carries this upload's tag AND sits in that school's HR folder, so a foreign id can never get a school document swept (G2b).
// Script properties (set by Uday, never in the repo): ROSTER_GAME_KEY (as af-video.gs), HR_DRIVE_LIVE_URL (lms-game's hr-drive
// function), ROSTER_WEBAPP_URL optional. Folder ids live only in lms-game's hr_drive_folders setting. Logs carry codes and counts
// only: never an email, a school, a file name or a paper.

var HRF_TICKET_MS_ = 2 * 60 * 60 * 1000;   // a ticket starts an upload within 2 h
var HRF_PARTS_MAX_ = 8;                    // 8 x 1.31 MB = 10.5 MB; lms-game caps a paper at 10 MB (618), so a bigger one is refused here too
var HRF_MIME_ = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', pdf: 'application/pdf' };
var HRF_ROLES_ = ['principal', 'coordinator', 'teacher', 'fee_clerk', 'driver', 'bus_incharge', 'it_teacher', 'pti', 'non_teaching'];
var HRF_SWEEP_MAX_ = 400;                  // files checked per daily run; ponytail: page through more if a tenant ever holds more papers

/** lms-game's hr-drive call (server to server, the Roster key); the parsed answer and status, or null when unreachable */
function hrfCall_(method, body) {
  const url = String(afvProps_().getProperty('HR_DRIVE_LIVE_URL') || ''), key = afvProps_().getProperty('ROSTER_GAME_KEY');
  if (!/^https:\/\//.test(url) || !key) return null;
  const o = { method: method, headers: { 'x-roster-key': key }, muteHttpExceptions: true };
  if (body !== undefined) { o.contentType = 'application/json'; o.payload = JSON.stringify(body); }
  const r = UrlFetchApp.fetch(url, o);
  let data = null;
  try { data = JSON.parse(r.getContentText()); } catch (e) { data = null; }
  return { code: r.getResponseCode(), data: data };
}

/** claim the upload's row for a ticket (once). false = no such row, 'no_folder' / 'ticket_issued' as said, null = unreachable. */
function hrfClaim_(upload) {
  const r = hrfCall_('post', { claim: upload });
  if (!r) return null;
  if (r.code === 404) return false;
  if (r.code === 409) return 'no_folder';
  if (r.code === 423) return 'ticket_issued';
  const u = r.code === 200 && r.data ? r.data.upload : null;
  return u && typeof u === 'object' ? u : null;
}

function gameHrFileTicket_(b) {
  if (!afvKeyOk_(b.key)) return { success: false, error: 'not_authorized' };
  if (HRF_ROLES_.indexOf(b.role) === -1) return afvOut_('not_authorized');
  const campus = String(b.campus || '').trim().toUpperCase(), email = afvEmail_(b.email), p = b.params && typeof b.params === 'object' ? b.params : {};
  if (!/^[A-Z0-9]{2,8}$/.test(campus)) return afvOut_('campus_needed');
  if (!email) return afvOut_('who');
  const upload = String(p.upload || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(upload)) return afvOut_('bad_input');
  const row = hrfClaim_(upload);
  if (row === 'ticket_issued') return afvOut_('ticket_issued');
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
      { name: t.n, parents: [t.f], mimeType: t.m, copyRequiresWriterPermission: true, appProperties: { lmsStaffPaper: t.u },
        description: 'Staff file paper (lms-game). Kept in the school HR folder only; never shared by link.' });
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
  const rec = hrfCall_('post', { done: t.u, file: id });   // the game records it, keyed by the ticket's upload id (G2b)
  if (!rec || rec.code !== 200) {
    afvApi_('patch', AFV_DRIVE_ + '/' + id + '?supportsAllDrives=true', { trashed: true });
    cache.remove('hrf_st_' + t.r); cache.put('hrf_fail_' + t.r, '1', 21600);
    console.error('hr-file: record_failed ' + (rec ? rec.code : 'unreachable'));
    return { success: false, error: 'RECORD' };
  }
  cache.put('hrf_done_' + t.r, id, 21600);
  cache.remove('hrf_st_' + t.r);
  return { success: true, fileId: id };
}

/** is this file one the Roster made for this upload, inside this school's HR folder? (G2b: never touch anything else) */
function hrfOurs_(id, upload, folder) {
  const r = afvApi_('get', AFV_DRIVE_ + '/' + id + '?supportsAllDrives=true&fields=parents,appProperties');
  let f = null;
  try { f = r.getResponseCode() === 200 ? JSON.parse(r.getContentText()) : null; } catch (e) { f = null; }
  return !!f && !!f.appProperties && f.appProperties.lmsStaffPaper === upload && Array.isArray(f.parents) && f.parents.indexOf(folder) !== -1;
}

// ── 3. the daily sweep: a link shared after the upload is caught too ──
function hrFileDaily() {
  const out = { checked: 0, trashed: 0, unreadable: 0, foreign: 0 };
  const r = hrfCall_('get');
  const papers = r && r.code === 200 && r.data && Array.isArray(r.data.papers) ? r.data.papers : null;
  if (!papers) { console.error('hr-file: live_list_unavailable'); return out; }
  papers.slice(0, HRF_SWEEP_MAX_).forEach(function (p) {
    const id = String(p && p.id || ''), upload = String(p && p.upload || ''), folder = String(p && p.folder || '');
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(id) || !/^[0-9a-f-]{36}$/.test(upload) || !/^[A-Za-z0-9_-]{10,200}$/.test(folder)) { out.foreign++; return; }
    if (!hrfOurs_(id, upload, folder)) { out.foreign++; return; }   // not our tagged file in that HR folder: never trashed
    out.checked++;
    const open = hrfOpen_(id);
    if (open === null) { out.unreadable++; return; }   // can't tell today: tomorrow's run asks again (nothing is trashed on a guess)
    if (!open) return;
    afvApi_('patch', AFV_DRIVE_ + '/' + id + '?supportsAllDrives=true', { trashed: true });
    hrfCall_('post', { swept: id });
    out.trashed++;
  });
  console.log('hr-file: sweep ' + JSON.stringify(out));
  return out;
}

/** the daily HR file sweep at about 04:00 IST. Idempotent: no-op when the trigger exists (never a second one). */
function installHrFileTrigger() {
  if (ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'hrFileDaily'; })) return false;
  ScriptApp.newTrigger('hrFileDaily').timeBased().everyDays(1).atHour(4).create();
  return true;
}

/** Self-setup, no editor run (scripts.run can't reach Roster): called first from doGet/doPost (the 5-minute keep-warm hits doGet).
 *  (1) HR_DRIVE_LIVE_URL unset -> PROOF_MIRROR_URL's supabase.co host + /functions/v1/hr-drive (an https supabase.co URL only, else a code).
 *  (2) the sweep trigger installed once, guarded by the HRF_SETUP script property; the flag is set only when both are done.
 *  Never throws; logs codes only (no URL, id or host). */
function hrfSelfSetup_() {
  try {
    const p = afvProps_();
    if (p.getProperty('HRF_SETUP') === '1') return;
    let url = String(p.getProperty('HR_DRIVE_LIVE_URL') || '').trim();
    if (!url) {
      const m = String(p.getProperty('PROOF_MIRROR_URL') || '').trim().match(/^https:\/\/([a-z0-9-]+\.supabase\.co)(?:[\/?#]|$)/i);
      if (!m) { console.error('hr-file: setup_no_base_url'); return; }
      url = 'https://' + m[1].toLowerCase() + '/functions/v1/hr-drive';
      p.setProperty('HR_DRIVE_LIVE_URL', url);
      console.log('hr-file: setup_url_derived');
    }
    // two first hits at the same moment must not each add a trigger: one takes the lock; the other skips and tries on its next call
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) { console.log('hr-file: setup_busy'); return; }
    try {
      if (installHrFileTrigger()) console.log('hr-file: setup_trigger_installed');   // re-checks the existing triggers inside the lock
      p.setProperty('HRF_SETUP', '1');
    } finally { lock.releaseLock(); }
  } catch (e) { console.error('hr-file: setup_failed'); }
}

/** Read-only proof for Jarvis (it can't read Roster logs): three booleans, no URL, id or auth data. Never runs the setup. */
function hrfSetupStatus_() {
  const out = { url_set: false, trigger: false, flag: false };
  try { const p = afvProps_(); out.url_set = !!String(p.getProperty('HR_DRIVE_LIVE_URL') || '').trim(); out.flag = p.getProperty('HRF_SETUP') === '1'; } catch (e) { /* stays false */ }
  try { out.trigger = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'hrFileDaily'; }); } catch (e) { /* stays false */ }
  return out;
}
