// ═══════════════════════════════════════════════════════════════════
// transport-capture.gs -- 2026-10-25, transport game Phase 1a: server side of the capture portal.
// A Coordinator rides a bus with a school phone; timelapse frames (~every 15 m), stop photos and monthly safety-inspection
// photos are queued on the phone and uploaded later. Same project as transport-uploads.gs (Roster: the only project with
// Drive access) and reuses its helpers (tupNormReg_, tupVehicle_, tupCovers_, tupSniff_, TUP_*).
//
// POST {action:'capturefile', idToken, reg, runId, kind:'frame'|'stop'|'inspection', seq, lat, lng, takenAt, base64}
//   -> {success, fileId}. Image only, <= 2 MB. Saved as Capture/<REG>/<runId>/<kind>-<seq 5 digits>.jpg, a sibling of
//   'Bus Wise Documents' under the transport Drive folder. Idempotent on (runId, kind, seq): a repeat returns the existing fileId.
//   runKind ('timelapse'|'count'|'inspection') is required and decides what a run accepts: timelapse frame+stop, inspection
//   inspection only, count nothing (no camera). If the run's manifest row exists its Kind must equal runKind.
// POST {action:'capturerun', idToken, run:{runId, reg, kind, startedAt, endedAt, frames, gaps, stops, inspection, status}}
//   -> {success}. One row per runId in the tab 'Capture Runs' (upsert).
// Who: Owner / ALL any bus; Coordinator the buses of their district; FeeClerk their campus (tupCovers_, unchanged).
// ═══════════════════════════════════════════════════════════════════

const CAP_TAB_ = 'Capture Runs';
const CAP_RUN_HEADER_ = ['Run ID', 'Reg', 'Campus', 'Kind (timelapse/count/inspection)', 'Started', 'Ended', 'By', 'Role', 'Frames', 'Gaps JSON', 'Stops JSON', 'Inspection JSON', 'Status'];
const CAP_KINDS_ = ['frame', 'stop', 'inspection'];
const CAP_RUN_KINDS_ = ['timelapse', 'count', 'inspection'];
const CAP_RUN_ACCEPTS_ = { timelapse: ['frame', 'stop'], count: [], inspection: ['inspection'] }; // profile kinds: Task 8
const CAP_MAX_BYTES_ = 2 * 1024 * 1024;
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
  }
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
  if (CAP_RUN_KINDS_.indexOf(runKind) === -1) return fail('runKind is required (timelapse, count or inspection)');
  if (runKind === 'count') return fail('This is a count run: it takes no photos');
  if (CAP_RUN_ACCEPTS_[runKind].indexOf(kind) === -1) return fail('A ' + runKind + ' run does not take ' + kind + ' photos');
  if (!(seq >= 0 && seq <= 99999 && seq === Math.floor(seq))) return fail('Bad seq');
  const bytes = Utilities.base64Decode(String(body.base64 || ''));
  if (!bytes.length) return fail('Empty file');
  if (bytes.length > CAP_MAX_BYTES_) return fail('Photo is larger than 2 MB');
  const mime = tupSniff_(bytes);
  if (mime.indexOf('image/') !== 0) return fail('Only photos (JPG, PNG, HEIC, WEBP) are accepted');

  const name = kind + '-' + ('00000' + seq).slice(-5) + '.jpg', key = 'cap_' + runId + '_' + kind + '_' + seq;
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const row = capRunSheet_().getDataRange().getValues().slice(1).filter(function (r) { return String(r[0]) === runId; })[0];
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

function captureRun_(body) {
  const fail = function (m) { return { success: false, error: m }; };
  const run = body.run || {};
  const a = capAuth_({ idToken: body.idToken, reg: run.reg });
  if (a.error) return fail(a.error);
  const runId = String(run.runId || '');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(runId)) return fail('Bad runId');
  if (CAP_RUN_KINDS_.indexOf(run.kind) === -1) return fail('Unknown kind: ' + run.kind);
  const js = function (x) { return x === undefined || x === null ? '' : JSON.stringify(x); };
  const row = [runId, a.v.reg, a.v.campusId, run.kind, run.startedAt || '', run.endedAt || '', a.caller.email, a.caller.role,
    Number(run.frames) || 0, js(run.gaps), js(run.stops), js(run.inspection), String(run.status || 'open')];
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = capRunSheet_(), rows = sh.getDataRange().getValues();
    let at = 0;
    for (let i = 1; i < rows.length; i++) if (String(rows[i][0]) === runId) { at = i + 1; break; }
    if (at) sh.getRange(at, 1, 1, row.length).setValues([row]); else sh.appendRow(row);
  } finally {
    lock.releaseLock();
  }
  return { success: true };
}
