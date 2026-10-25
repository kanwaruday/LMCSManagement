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
// POST {action:'capturerun', idToken, run:{runId, reg, kind, startedAt, endedAt, frames, gaps, stops, inspection, status}}
//   -> {success}. One row per runId in the tab 'Capture Runs' (upsert). `inspection` (inspection runs only) must be
//   {itemId: {ok: boolean, date?: 'yyyy-MM-dd', fileId?}} with ids from the 'Safety Loadout' tab (kept by the Coordinator
//   backend, coordinator-transport.gs): answers raise and close follow-ups, so nothing else is stored (no free text).
//   A timelapse's end manifest also carries frameTimes: indexed by seq, whole seconds since the previous frame (the first since
//   startedAt), null where the seq is a stop. The Mac (transport/capture/capture.py) uses them to place each stop's chapter in the
//   route video. Too big or invalid, they are dropped and the run is stored without them (the Mac falls back to capture order).
// Who: Owner / ALL any bus; Coordinator the buses of their district; FeeClerk their campus (tupCovers_, unchanged).
// POST {action:'captureprocessed', secret, runs:[{reg, runId, stops:[seq]}]} -> {success, found:{runId:{videoFileId, photos:{seq:id}}},
//   notYet:[runId]}. The Coordinator backend (no Drive access) asks here for the ids of the Mac's BLURRED output:
//   Capture/<REG>/<runId>/processed/route.mp4 and processed/stop-NNNNN.jpg, never the phone's originals. A run whose processed
//   folder has not synced up from the Mac yet is "not yet". Same shared secret as the Mac's pushes (TRANSPORT_PUSH_SECRET).
// ═══════════════════════════════════════════════════════════════════

const CAP_TAB_ = 'Capture Runs';
const CAP_RUN_HEADER_ = ['Run ID', 'Reg', 'Campus', 'Kind (timelapse/count/inspection)', 'Started', 'Ended', 'By', 'Role', 'Frames', 'Gaps JSON', 'Stops JSON', 'Inspection JSON', 'Status', 'Frame Times JSON'];
const CAP_KINDS_ = ['frame', 'stop', 'inspection', 'profile'];
const CAP_RUN_KINDS_ = ['timelapse', 'count', 'inspection', 'profile'];
const CAP_RUN_ACCEPTS_ = { timelapse: ['frame', 'stop'], count: [], inspection: ['inspection'], profile: ['profile'] };
const CAP_MAX_BYTES_ = 2 * 1024 * 1024;
const CAP_MAX_FRAME_TIMES_ = 40000; // characters of frameTimes JSON kept: well inside Sheets' 50,000 per cell (a 75 km run is ~10,000)
const CAP_LOADOUT_TAB_ = 'Safety Loadout'; // Item ID | Label | ... (coordinator-transport.gs writes it, seed included, on first read)
const CAP_PATH_ = TUP_PATH_.slice(0, -1).concat(['Capture']); // sibling of 'Bus Wise Documents'

// Capture/<REG>/<runId>/, created on first use.
function capFolder_(reg, runId) {
  let f = DriveApp.getFolderById(CENTRAL_REPO_FOLDER_ID_);
  CAP_PATH_.forEach(function (n, i) {
    f = f && (getSubfolder_(f, n) || (i === CAP_PATH_.length - 1 ? f.createFolder(n) : null));
  });
  if (!f) throw new Error('Transport folder not found');
  const bus = getSubfolder_(f, reg) || f.createFolder(reg);
  return getSubfolder_(bus, runId) || bus.createFolder(runId);
}

function capAuth_(body) {
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
  const a = capAuth_({ idToken: body.idToken, reg: run.reg });
  if (a.error) return fail(a.error);
  const runId = String(run.runId || '');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(runId)) return fail('Bad runId');
  if (CAP_RUN_KINDS_.indexOf(run.kind) === -1) return fail('Unknown kind: ' + run.kind);
  if (run.inspection != null) {
    if (run.kind !== 'inspection') return fail('Only an inspection run carries safety check answers');
    const bad = capInspectionError_(run.inspection);
    if (bad) return fail(bad);
  }
  const frameTimes = run.kind === 'timelapse' && capFrameTimesOk_(run.frameTimes) ? run.frameTimes : null; // else dropped, never a refusal
  const js = function (x) { return x === undefined || x === null ? '' : JSON.stringify(x); };
  const row = [runId, a.v.reg, a.v.campusId, run.kind, run.startedAt || '', run.endedAt || '', a.caller.email, a.caller.role,
    Number(run.frames) || 0, js(run.gaps), js(run.stops), js(run.inspection), String(run.status || 'open'), js(frameTimes)];
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = capRunSheet_(), rows = sh.getDataRange().getValues();
    let at = 0;
    for (let i = 1; i < rows.length; i++) if (String(rows[i][0]) === runId) { at = i + 1; break; }
    if (at && (String(rows[at - 1][1]) !== a.v.reg || String(rows[at - 1][3]) !== run.kind)) return fail('A run\'s bus and kind cannot change (' + rows[at - 1][1] + ', ' + rows[at - 1][3] + ')');
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
  CAP_PATH_.forEach(function (n) { f = f && getSubfolder_(f, n); });
  const found = {}, notYet = [], one = function (dir, name) { const it = dir.getFilesByName(name); return it.hasNext() ? it.next().getId() : ''; };
  (Array.isArray(body.runs) ? body.runs : []).forEach(function (r) {
    const runId = String(r.runId || ''), reg = String(r.reg || '');
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(runId) || !/^[A-Z0-9]{1,16}$/.test(reg)) return;
    const bus = f && getSubfolder_(f, reg), run = bus && getSubfolder_(bus, runId), out = run && getSubfolder_(run, 'processed');
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
