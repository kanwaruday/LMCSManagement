// ═══════════════════════════════════════════════════════════════════
// transport-capture.gs -- 2026-10-25, transport game Phase 1a: server side of the capture portal.
// A Coordinator rides a bus with a school phone; timelapse frames (~every 15 m), stop photos and monthly safety-inspection
// photos are queued on the phone and uploaded later. Same project as transport-uploads.gs (Roster: the only project with
// Drive access) and reuses its helpers (tupNormReg_, tupVehicle_, tupCovers_, tupSniff_, TUP_*).
//
// POST {action:'capturefile', idToken, reg, runId, kind:'frame'|'stop'|'inspection'|'profile', seq, lat, lng, takenAt, base64}
//   -> {success, fileId}. Image only, <= 2 MB. Saved as Capture/<REG>/<runId>/<kind>-<seq 5 digits>.jpg, a sibling of
//   'Bus Wise Documents' under the transport Drive folder. Idempotent on (runId, kind, seq): a repeat returns the existing fileId.
//   runKind ('timelapse'|'count'|'inspection'|'profile') is required and decides what a run accepts: timelapse frame+stop,
//   inspection inspection only, profile profile only (the Fleet setup quests' odometer and driver photos, one run per quest
//   save), count nothing (no camera). If the run's manifest row exists its Kind must equal runKind.
// POST {action:'capturerun', idToken, run:{runId, reg, kind, startedAt, endedAt, frames, gaps, stops, inspection, status, capturedBy}}
//   -> {success}. One row per runId in the tab 'Capture Runs' (upsert). The phone is shared (Ruling 41): anyone signed in may
//   send a run, so By/Role are the sender, and Captured By (the last column) is the run's author from the manifest, kept from
//   the first manifest that set it; credit for a capture goes to Captured By. No or a bad capturedBy (an old phone): By.
//   `inspection` (inspection runs only, end manifest: the start one carries none) must be
//   {itemId: {ok: boolean, date?: 'yyyy-MM-dd', fileId?}} with ids from the 'Safety Loadout' tab (kept by the Coordinator
//   backend, coordinator-transport.gs): answers raise and close follow-ups, so nothing else is stored (no free text).
//   A timelapse's end manifest also carries frameTimes: indexed by seq, whole seconds since the previous frame (the first since
//   startedAt), null where the seq is a stop. The Mac (transport/capture/capture.py) uses them to place each stop's chapter in the
//   route video. Too big or invalid, they are dropped and the run is stored without them (the Mac falls back to capture order).
// Who: Owner / ALL any bus; Coordinator the buses of their district; FeeClerk their campus (tupCovers_, unchanged).
//   A linked driver phone (driver-link.gs) sends deviceToken instead of idToken: only route timelapses (frame/stop) of its own bus;
//   By is 'driver:<linkId>', Role 'Driver', and Captured By the driver's name.
// POST {action:'captureprocessed', secret, runs:[{reg, runId, stops:[seq]}]} -> {success, found:{runId:{videoFileId, photos:{seq:id}}},
//   notYet:[runId]}. The Coordinator backend (no Drive access) asks here for the ids of the Mac's BLURRED output:
//   Capture/<REG>/<runId>/processed/route.mp4 and processed/stop-NNNNN.jpg, never the phone's originals. A run whose processed
//   folder has not synced up from the Mac yet is "not yet". Same shared secret as the Mac's pushes (TRANSPORT_PUSH_SECRET).
// Trial runs (2 Nov): run.trial === true marks a practice timelapse; the 'Trial' column (found or appended by header name) says
//   'yes'. Only an Owner or Coordinator idToken may start one; once set it never flips. The Coordinator shelves trials on its
//   'Capture Review' tab (coordinator-transport-gps.gs) instead of publishing them.
// Staff entries (2 Nov): a staff sender's route timelapse also writes 'Driver' (found or appended by header name, like Trial): the
//   bus's fleet driver at run time (dlkFleet_), the run's "on behalf of" note. Kept from the first manifest that set it; a driver
//   phone's run never writes it (Captured By already names the driver).
// POST {action:'capturediscard', secret, reg, runId} -> {success}. The Coordinator's Discard on that shelf: Capture/<REG>/<runId>/
//   goes to the Drive bin (recoverable 30 days) and the run's Status becomes 'closed', so the Mac's pull never lists it again.
// ═══════════════════════════════════════════════════════════════════

const CAP_TAB_ = 'Capture Runs';
const CAP_RUN_HEADER_ = ['Run ID', 'Reg', 'Campus', 'Kind (timelapse/count/inspection)', 'Started', 'Ended', 'By', 'Role', 'Frames', 'Gaps JSON', 'Stops JSON', 'Inspection JSON', 'Status', 'Frame Times JSON', 'Captured By'];
const CAP_KINDS_ = ['frame', 'stop', 'inspection', 'profile'];
const CAP_RUN_STATUSES_ = ['open', 'running', 'ended', 'error', 'closed'];
const CAP_RUN_KINDS_ = ['timelapse', 'count', 'inspection', 'profile'];
const CAP_RUN_ACCEPTS_ = { timelapse: ['frame', 'stop'], count: [], inspection: ['inspection'], profile: ['profile'] };
const CAP_MAX_BYTES_ = 2 * 1024 * 1024;
const CAP_MAX_FRAME_TIMES_ = 40000; // characters of frameTimes JSON kept: well inside Sheets' 50,000 per cell (a 75 km run is ~10,000)
const CAP_TRIAL_COL_ = 'Trial'; // read and written by header name: appended after Captured By on first use
const CAP_DRIVER_COL_ = 'Driver'; // by header name, as Trial: the fleet driver a staff member's timelapse was run for
const CAP_TRIAL_DENIED_ = 'Only the Owner or a Coordinator can record a trial run';
const CAP_LOADOUT_TAB_ = 'Safety Loadout'; // Item ID | Label | ... (coordinator-transport.gs writes it, seed included, on first read)
// sibling of 'Bus Wise Documents'. A function, not a top-level const: TUP_PATH_ lives in transport-uploads.gs, which Apps Script
// loads after this file, so reading it at load time took the whole Roster web app down (v49). tests/apps-script/test-load-order.js
// A capture-path subfolder by name, never one in the bin: getFoldersByName also returns binned folders, so a discarded
// trial's folder must not be found again (review M1, 2 Nov).
function capSub_(parent, name) {
  const it = parent.getFoldersByName(name);
  while (it.hasNext()) { const f = it.next(); if (!(f.isTrashed && f.isTrashed())) return f; }
  return null;
}
function capPath_() { return TUP_PATH_.slice(0, -1).concat(['Capture']); }

// Capture/<REG>/<runId>/, created on first use.
function capFolder_(reg, runId) {
  let f = DriveApp.getFolderById(CENTRAL_REPO_FOLDER_ID_);
  const path = capPath_();
  path.forEach(function (n, i) {
    f = f && (capSub_(f, n) || (i === path.length - 1 ? f.createFolder(n) : null));
  });
  if (!f) throw new Error('Transport folder not found');
  const bus = capSub_(f, reg) || f.createFolder(reg);
  return capSub_(bus, runId) || bus.createFolder(runId);
}

// A linked driver phone (driver-link.gs) sends body.deviceToken instead of an idToken: route timelapses of its own bus only.
function capAuth_(body) {
  if (!body.idToken && body.deviceToken) {
    const link = dlkLink_(body.deviceToken);
    if (!link) return { error: DLK_UNLINKED_ };
    if (tupNormReg_(body.reg) !== link.reg) return { error: 'This phone can only send for bus ' + link.reg };
    if (body.runKind !== 'timelapse' && body.runKind !== 'inspection') return { error: 'A driver phone sends only route videos and bus photos' }; // bus photos: the bus setup chain (assets/game/bus-chain.js)
    const v = tupVehicle_(link.reg);
    if (!v) return { error: 'Vehicle ' + link.reg + ' is not in the fleet' };
    return { caller: { roles: ['Driver'], role: 'Driver', campusId: link.campus, email: 'driver:' + link.linkId, name: link.name }, v: v };
  }
  const caller = verifyStaffManagerToken_(body.idToken, ['FeeClerk']); // Coordinator and Owner pass as managers
  if (!caller) return { error: 'Not authorized' };
  const reg = tupNormReg_(body.reg), v = reg && tupVehicle_(reg);
  if (!v) return { error: 'Vehicle ' + (body.reg || '(none)') + ' is not in the fleet' };
  if (!tupCovers_(caller, v.campusId)) return { error: 'You can only upload for buses of your own campuses' };
  return { caller: caller, v: v };
}

function capRunSheet_() {
  const ss = SpreadsheetApp.openById(TUP_SHEET_ID_);
  let sh = ss.getSheetByName(CAP_TAB_);
  if (!sh) {
    sh = ss.insertSheet(CAP_TAB_);
    sh.appendRow(CAP_RUN_HEADER_);
    sh.getRange(1, 1, 1, CAP_RUN_HEADER_.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  } else if (sh.getLastColumn() < CAP_RUN_HEADER_.length) sh.getRange(1, 1, 1, CAP_RUN_HEADER_.length).setValues([CAP_RUN_HEADER_]); // a tab made before a column was added
  return sh;
}

function captureFile_(body) {
  const fail = function (m) { return { success: false, error: m }; };
  const a = capAuth_(body);
  if (a.error) return fail(a.error);
  const reg = a.v.reg, runId = String(body.runId || ''), kind = String(body.kind || ''), seq = Number(body.seq);
  if (CAP_KINDS_.indexOf(kind) === -1) return fail('Unknown kind: ' + kind);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(runId)) return fail('Bad runId');
  const runKind = String(body.runKind || '');
  if (CAP_RUN_KINDS_.indexOf(runKind) === -1) return fail('runKind is required (timelapse, count, inspection or profile)');
  if (runKind === 'count') return fail('This is a count run: it takes no photos');
  if (CAP_RUN_ACCEPTS_[runKind].indexOf(kind) === -1) return fail('A ' + runKind + ' run does not take ' + kind + ' photos');
  if (!(seq >= 0 && seq <= 99999 && seq === Math.floor(seq))) return fail('Bad seq');
  const bytes = Utilities.base64Decode(String(body.base64 || ''));
  if (!bytes.length) return fail('Empty file');
  if (bytes.length > CAP_MAX_BYTES_) return fail('Photo is larger than 2 MB');
  const mime = tupSniff_(bytes);
  if (mime.indexOf('image/') !== 0) return fail('Only photos (JPG, PNG, HEIC, WEBP) are accepted');

  const name = kind + '-' + ('00000' + seq).slice(-5) + '.jpg', key = 'cap_' + reg + '_' + runId + '_' + kind + '_' + seq;
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const row = capRunSheet_().getDataRange().getValues().slice(1).filter(function (r) { return String(r[0]) === runId; })[0];
    if (row && String(row[1]) !== reg) return fail('This run belongs to another bus (' + row[1] + ')');
    if (row && String(row[3]) !== runKind) return fail('runKind ' + runKind + ' does not match this run (' + row[3] + ')');
    if (row && String(row[12]) === 'closed') return fail('This run was discarded. Record a new one.'); // no new folder for a binned run
    const hit = CacheService.getScriptCache().get(key);
    if (hit) return { success: true, fileId: hit };
    const dir = capFolder_(reg, runId), it = dir.getFilesByName(name);
    if (it.hasNext()) return { success: true, fileId: it.next().getId() };
    const file = dir.createFile(Utilities.newBlob(bytes, mime, name));
    file.setDescription(JSON.stringify({ lat: body.lat, lng: body.lng, takenAt: body.takenAt, by: a.caller.email }));
    CacheService.getScriptCache().put(key, file.getId(), 21600);
    return { success: true, fileId: file.getId() };
  } finally {
    lock.releaseLock();
  }
}

/** '' if `insp` is a valid set of safety-check answers, else what is wrong with it. */
function capInspectionError_(insp) {
  if (!insp || typeof insp !== 'object' || Array.isArray(insp)) return 'The safety check answers must be an object';
  const keys = Object.keys(insp);
  if (!keys.length) return 'The safety check has no answers';
  const sh = SpreadsheetApp.openById(TUP_SHEET_ID_).getSheetByName(CAP_LOADOUT_TAB_), known = {};
  if (!sh) return 'The safety list is not set up yet. Open the capture page on Wi-Fi, then send again';
  sh.getDataRange().getValues().slice(1).forEach(function (r) { // same id rule as coordLoadoutId_
    const id = String(r[0] || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (id) known[id] = true;
  });
  BusChain.SHOTS.forEach(function (x) { known[x.id] = true; }); // the bus setup chain's vehicle shots (assets/game/bus-chain.js)
  for (let i = 0; i < keys.length; i++) {
    const id = keys[i], a = insp[id];
    if (!known[id]) return 'Unknown safety item: ' + String(id).slice(0, 40);
    if (!a || typeof a !== 'object' || Array.isArray(a)) return 'The answer for ' + id + ' must be an object';
    if (Object.keys(a).some(function (k) { return ['ok', 'date', 'fileId'].indexOf(k) === -1; })) return 'An answer has only ok, date and fileId (' + id + ')';
    if (typeof a.ok !== 'boolean') return 'ok must be true or false (' + id + ')';
    if (!a.ok && (a.date !== undefined || a.fileId !== undefined)) return 'A date or photo goes only on a Yes (' + id + ')';
    if (a.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(a.date))) return 'The date must be yyyy-MM-dd (' + id + ')';
    if (a.fileId !== undefined && !/^[A-Za-z0-9_-]{10,128}$/.test(String(a.fileId))) return 'Bad photo fileId (' + id + ')';
  }
  return '';
}

/** True for frame times worth keeping: a list of whole-second deltas (or null) adding up to at most a day, small enough for a cell. */
function capFrameTimesOk_(ft) {
  if (!Array.isArray(ft) || JSON.stringify(ft).length > CAP_MAX_FRAME_TIMES_) return false;
  let sum = 0;
  for (let i = 0; i < ft.length; i++) {
    const t = ft[i];
    if (t === null) continue;
    if (typeof t !== 'number' || t !== Math.floor(t) || t < 0) return false;
    sum += t;
  }
  return sum <= 86400;
}

function captureRun_(body) {
  const fail = function (m) { return { success: false, error: m }; };
  const run = body.run || {};
  const a = capAuth_({ idToken: body.idToken, deviceToken: body.deviceToken, reg: run.reg, runKind: run.kind });
  if (a.error) return fail(a.error);
  const runId = String(run.runId || '');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(runId)) return fail('Bad runId');
  if (CAP_RUN_KINDS_.indexOf(run.kind) === -1) return fail('Unknown kind: ' + run.kind);
  if (run.inspection != null) {
    if (run.kind !== 'inspection') return fail('Only an inspection run carries safety check answers');
    const bad = capInspectionError_(run.inspection);
    if (bad) return fail(bad);
    // a driver phone's photos (the bus setup chain) must be files of this run, so "photographed" can't be claimed with made-up ids
    const ids = Object.keys(run.inspection).map(function (k) { return run.inspection[k].fileId; }).filter(Boolean);
    if (ids.length && a.caller.role === 'Driver') {
      const have = {}, it = capFolder_(a.v.reg, runId).getFiles();
      while (it.hasNext()) have[it.next().getId()] = true;
      if (!ids.every(function (id) { return have[id]; })) return fail('A photo of this check has not arrived yet. Send again.');
    }
  }
  const trial = run.trial === true;
  if (trial && run.kind !== 'timelapse') return fail('Only a route timelapse can be a trial run'); // a trial safety check would still tick its quest
  if (trial && a.caller.role === 'Driver') return fail(CAP_TRIAL_DENIED_);
  const trialDenied = trial && !dlkStaff_(a.caller.roles); // a Fee Clerk: refused below unless the row already says yes (the shared phone, Ruling 41)
  const frameTimes = run.kind === 'timelapse' && capFrameTimesOk_(run.frameTimes) ? run.frameTimes : null; // else dropped, never a refusal
  const driver = run.kind === 'timelapse' && a.caller.role !== 'Driver' ? String((dlkFleet_().filter(function (b) { return b.reg === a.v.reg; })[0] || {}).driver || '').replace(/^[=+\-@\s']+/, '') : ''; // driver-token.gs; never a formula (review L4)
  const js = function (x) { return x === undefined || x === null ? '' : JSON.stringify(x); };
  const author = String(run.capturedBy || '').trim().toLowerCase();
  // Only shapes the phone really sends reach the sheet: a time is epoch ms or an ISO string, a status one of the phone's words.
  // Anything else (a "=..." formula from a forwarded driver link, say) would run as a formula when the workbook is opened.
  const when = function (t) { return typeof t === 'number' && isFinite(t) ? t : /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})?$/.test(String(t || '')) ? String(t) : ''; };
  const status = CAP_RUN_STATUSES_.indexOf(run.status) !== -1 && run.status !== 'closed' ? run.status : 'open'; // 'closed' is the server's (capturediscard) alone
  const row = [runId, a.v.reg, a.v.campusId, run.kind, when(run.startedAt), when(run.endedAt), a.caller.email, a.caller.role,
    Number(run.frames) || 0, js(run.gaps), js(run.stops), js(run.inspection), status, js(frameTimes),
    a.caller.role === 'Driver' ? a.caller.name : /^(?![=+\-@])[^\s@<>"]{1,64}@[A-Za-z0-9.-]{1,190}$/.test(author) ? author : a.caller.email];
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = capRunSheet_(), rows = sh.getDataRange().getValues();
    let at = 0;
    for (let i = 1; i < rows.length; i++) if (String(rows[i][0]) === runId) { at = i + 1; break; }
    if (at && (String(rows[at - 1][1]) !== a.v.reg || String(rows[at - 1][3]) !== run.kind)) return fail('A run\'s bus and kind cannot change (' + rows[at - 1][1] + ', ' + rows[at - 1][3] + ')');
    if (at && String(rows[at - 1][12]) === 'closed') return fail('This run was discarded. Record a new one.'); // discard is final: a resent manifest must not bring it back
    const head = rows[0].slice(), col = function (name) { // by header name; appended (after any added columns) on first use
      let c = head.indexOf(name);
      if (c === -1) { c = head.length; head.push(name); sh.getRange(1, 1, 1, head.length).setValues([head]); }
      return c;
    };
    let tc = head.indexOf(CAP_TRIAL_COL_);
    const was = at && tc !== -1 && String(rows[at - 1][tc]) === 'yes';
    if (trialDenied && !was) return fail(CAP_TRIAL_DENIED_);
    if (at && was !== trial) return fail('A run cannot become a trial or stop being one');
    if (at && rows[at - 1][14]) row[14] = rows[at - 1][14]; // a run keeps its capturer, whoever sends the next manifest
    if (trial && tc === -1) tc = col(CAP_TRIAL_COL_);
    const dc = driver ? col(CAP_DRIVER_COL_) : head.indexOf(CAP_DRIVER_COL_);
    const pad = function (c) { while (row.length <= c) row.push(at ? rows[at - 1][row.length] : ''); }; // whole row: columns past Captured By keep their values
    if (tc !== -1) { pad(tc); row[tc] = trial ? 'yes' : ''; }
    if (dc !== -1) { pad(dc); if (driver && !row[dc]) row[dc] = driver; } // the first manifest's driver stands
    if (at) sh.getRange(at, 1, 1, row.length).setValues([row]); else sh.appendRow(row);
  } finally {
    lock.releaseLock();
  }
  return { success: true };
}

/** POST captureprocessed (see the header): ids of the processed (blurred) files, looked up by path; creates nothing. */
function captureProcessed_(body) {
  const secret = String(PropertiesService.getScriptProperties().getProperty('TRANSPORT_PUSH_SECRET') || '').trim();
  if (!secret || String(body.secret || '').trim() !== secret) return { success: false, error: 'Not authorized' };
  let f = DriveApp.getFolderById(CENTRAL_REPO_FOLDER_ID_);
  capPath_().forEach(function (n) { f = f && capSub_(f, n); });
  const found = {}, notYet = [], one = function (dir, name) { const it = dir.getFilesByName(name); return it.hasNext() ? it.next().getId() : ''; };
  (Array.isArray(body.runs) ? body.runs : []).forEach(function (r) {
    const runId = String(r.runId || ''), reg = String(r.reg || '');
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(runId) || !/^[A-Z0-9]{1,16}$/.test(reg)) return;
    const bus = f && capSub_(f, reg), run = bus && capSub_(bus, runId), out = run && capSub_(run, 'processed');
    const video = out ? one(out, 'route.mp4') : '';
    if (!video) { notYet.push(runId); return; }
    const photos = {};
    (Array.isArray(r.stops) ? r.stops : []).forEach(function (seq) {
      const n = Number(seq);
      if (!(n >= 0 && n <= 99999 && n === Math.floor(n))) return;
      const id = one(out, 'stop-' + ('00000' + n).slice(-5) + '.jpg');
      if (id) photos[n] = id;
    });
    found[runId] = { videoFileId: video, photos: photos };
  });
  return { success: true, found: found, notYet: notYet };
}

// GET action=drivecheck -> {success, drive: 'ok' | <the error>, capture: 'found' | 'missing' | 'n/a', write: 'ok' | <the error> | 'n/a'}
// (2 Nov, capture uploads failing with "You do not have permission to call DriveApp…" on the live web app). Reading alone passed
// while the upload's createFolder still failed (a read-only Drive grant does that), so it also creates an empty test folder where
// uploads create theirs (Capture/, else the transport folder) and bins it at once. Names no folder and returns no data.
function captureDriveCheck_() {
  let f;
  const out = { success: true, drive: 'ok', capture: 'n/a', write: 'n/a' };
  try {
    f = DriveApp.getFolderById(CENTRAL_REPO_FOLDER_ID_);
    f.getName(); // the call that needs a Drive grant
    let c = f;
    capPath_().forEach(function (n) { c = c && capSub_(c, n); });
    out.capture = c ? 'found' : 'missing';
    if (c) f = c;
  } catch (e) { out.drive = String(e && e.message || e).slice(0, 300); return out; }
  try { f.createFolder('_drivecheck-' + Date.now()).setTrashed(true); out.write = 'ok'; } // the call that needs the full Drive grant
  catch (e) { out.write = String(e && e.message || e).slice(0, 300); }
  return out;
}
// Run this once from the Apps Script editor (Run > authorizeDrive) as the account the web app executes as: it asks for the
// full Drive permission if it is missing, then logs what drivecheck would return.
function authorizeDrive() { Logger.log(JSON.stringify(captureDriveCheck_())); }

/** POST capturediscard (see the header): bins one run's Drive folder and closes its Capture Runs row. A folder already gone
 *  (a retry after a lost reply) is fine; an unknown run is refused.
 *  Two callers: the shelf (the push secret: trial runs only), or a linked driver phone (deviceToken, no secret: Uday, 6 Nov, "an
 *  option to remove a run in case the driver is not satisfied") -- its own bus, a route video it recorded itself, never a safety
 *  check (its findings must stay on record). Closed is final: captureRun_ and captureFile_ refuse a closed run. */
function captureDiscard_(body) {
  const runId = String(body.runId || ''), reg = String(body.reg || '');
  let driver = null;
  if (!body.secret && body.deviceToken) {
    driver = capAuth_({ deviceToken: body.deviceToken, reg: reg, runKind: 'timelapse' }); // linked phone, its own bus
    if (driver.error) return { success: false, error: driver.error };
  } else {
    const secret = String(PropertiesService.getScriptProperties().getProperty('TRANSPORT_PUSH_SECRET') || '').trim();
    if (!secret || String(body.secret || '').trim() !== secret) return { success: false, error: 'Not authorized' };
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(runId) || !/^[A-Z0-9]{1,16}$/.test(reg)) return { success: false, error: 'Bad run' };
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = capRunSheet_(), rows = sh.getDataRange().getValues();
    let at = 0;
    for (let i = 1; i < rows.length; i++) if (String(rows[i][0]) === runId && String(rows[i][1]) === reg) { at = i + 1; break; }
    if (!at) return { success: false, error: 'Unknown run ' + runId };
    if (driver) {
      if (String(rows[at - 1][3]) !== 'timelapse') return { success: false, error: 'Only a route video can be removed from the phone' };
      if (String(rows[at - 1][6]) !== driver.caller.email) return { success: false, error: 'Only the phone that recorded this run can remove it' };
      if (String(rows[at - 1][12]) === 'closed') return { success: true }; // already removed: a retry after a lost reply
    } else {
      const tcol = rows[0].indexOf(CAP_TRIAL_COL_); // only a trial timelapse is ever binned, whoever holds the secret
      if (String(rows[at - 1][3]) !== 'timelapse' || tcol === -1 || String(rows[at - 1][tcol]) !== 'yes') return { success: false, error: 'Only a trial run can be discarded' };
    }
    let f = DriveApp.getFolderById(CENTRAL_REPO_FOLDER_ID_);
    capPath_().forEach(function (n) { f = f && capSub_(f, n); });
    const bus = f && capSub_(f, reg), dir = bus && capSub_(bus, runId);
    if (dir) dir.setTrashed(true); // the bin, never a hard delete: 30 days to change one's mind
    sh.getRange(at, 13).setValue('closed'); // Status: the pull lists only 'ended' runs
  } finally {
    lock.releaseLock();
  }
  return { success: true };
}
