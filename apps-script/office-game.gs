// LMCS Office Backend -- the game's native Fee Clerk screens (lms-game W2, lane-g; Uday, 12 Nov: money screens "Read and write now").
// Two ways in, both from doPost (office.gs), both for game* actions only:
//  1. The classic proxy (lms-game supabase/functions/classic), server to server:
//     {action:'gameX', key, role, campus, email, params} -> {success:true, data} | {success:true, data:{ok:false, code}} | {success:false, error}
//     The game has already checked the caller's role and school (role_grants under RLS); the key proves the call came from it.
//     The bridge then runs the SAME office action through officeDispatch_: the office's own role check, campus check, script
//     lock and Audit rows (who, when, action, row id) are unchanged. No money rule lives here.
//  2. The browser's upload parts for a photo (a bill, a deposit slip), against a ticket the proxy handed out (gameFileTicket):
//     {action:'gameUploadPart', ticket, part, of, base64}: ~1.9 MB base64 parts, in order; the last one runs file.upload and
//     answers {success, fileId}. Fleet's contract (V2, 12 Nov), so lane-t's shared uploader (app/src/classic/upload.ts) serves both.
// Who: a Fee Clerk at their own school reads and writes; the Owner reads only (V2, 12 Nov). Script Property OFFICE_GAME_KEY (set by
// Uday; the same value as the game's CLASSIC_OFFICE_KEY secret). Never logs the key, email, params or amounts.

var OFFICE_GAME_ROLE = { fee_clerk: 'FeeClerk', owner: 'Owner' };
var OFFICE_GAME_TICKET_MS = 10 * 60 * 1000;
var OFFICE_GAME_PART_MAX = 2000000; // base64 characters per part (~1.5 MB of bytes)
var OFFICE_GAME_PARTS_MAX = 20;     // a 25 MB fuel video is 18 parts

// game action -> the office action it runs. num: params turned into integers; json: params parsed as JSON; bool: 'true' / 'false'
// only. Every other param stays a
// string. `write` must match the office action's own `write` (a test checks it). The campus always comes from the proxy, never params.
var OFFICE_GAME_ACTIONS = {
  gameToday: { act: 'today.get' },
  gameConfig: { act: 'config.get' },
  gameDaybookList: { act: 'daybook.list' },
  gameDaybookBalances: { act: 'daybook.balances' },
  gameDaybookAdd: { act: 'daybook.add', write: true, num: ['amount_paise', 'litres_ml', 'odometer_km'] },
  gameDaybookReverse: { act: 'daybook.reverse', write: true },
  gameDaybookAttachVideo: { act: 'daybook.attach_video', write: true, bool: ['replace'] }, // a pump video for a saved fuel entry (W2 slice 2)
  gameDepositList: { act: 'deposit.list' },
  gameRecon: { act: 'recon.get' },
  gameDepositAdd: { act: 'deposit.add', write: true, num: ['amount_paise'] },
  gameErpSet: { act: 'erp.set', write: true, num: ['amount_paise'] },
  gameLedger: { act: 'ledger.summary' },
  gameFundTransfer: { act: 'fund.transfer', write: true, num: ['amount_paise'] },
  gameHandovers: { act: 'cash.handovers' },
  gameHandover: { act: 'cash.handover', write: true, num: ['amount_paise'] },
  gameHandoverAccept: { act: 'cash.accept', write: true },
  gameHandoverDispute: { act: 'cash.dispute', write: true },
  gameReportGet: { act: 'report.get' },
  gameReportSubmit: { act: 'report.submit', write: true, num: ['footfall'], json: ['hourly', 'cash'] },
  gameDriverFillDaybook: { act: 'driverfill.daybook', write: true }, // Fleet's office-driver-fills.gs action, unchanged: a confirmed fill into the day book
  gameFileView: { act: 'file.view' }, // the office marks it write only to take the lock for its Audit row; it changes no data
  gameFileTicket: { ticket: true, write: true },
};

function officeGameRefuse_(code) { return { success: true, data: { ok: false, code: code } }; }

function officeGameKeyOk_(given) {
  const want = PropertiesService.getScriptProperties().getProperty('OFFICE_GAME_KEY');
  if (!want || typeof given !== 'string' || given.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

function officeGame_(b) {
  if (b.action === 'gameUploadPart') return officeGameUploadPart_(b);
  if (!officeGameKeyOk_(b.key)) return { success: false, error: 'not_authorized' };
  const spec = Object.prototype.hasOwnProperty.call(OFFICE_GAME_ACTIONS, b.action) ? OFFICE_GAME_ACTIONS[b.action] : null;
  const role = Object.prototype.hasOwnProperty.call(OFFICE_GAME_ROLE, b.role) ? OFFICE_GAME_ROLE[b.role] : null;
  if (!spec || !role) return officeGameRefuse_('unknown_action');
  if (spec.write && b.role !== 'fee_clerk') return officeGameRefuse_('read_only'); // the Owner reads only here
  const campus = String(b.campus || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{2,8}$/.test(campus)) return officeGameRefuse_('campus_needed');
  if (spec.write && !(typeof b.email === 'string' && /^[^\s@]+@[^\s@]+$/.test(b.email))) return officeGameRefuse_('who');
  const caller = { email: spec.write ? String(b.email).toLowerCase() : 'game:' + b.role, name: '', roles: [role], campuses: [campus], functions: [] };
  const data = {};
  const p = b.params && typeof b.params === 'object' ? b.params : {};
  try {
    Object.keys(p).forEach(function (k) {
      if (k === 'campus') return;
      const v = String(p[k]);
      if ((spec.num || []).indexOf(k) !== -1) { if (!/^-?\d{1,12}$/.test(v)) throw officeCoded_('BAD_INPUT'); data[k] = Number(v); }
      else if ((spec.bool || []).indexOf(k) !== -1) { if (v !== 'true' && v !== 'false') throw officeCoded_('BAD_INPUT'); data[k] = v === 'true'; }
      else if ((spec.json || []).indexOf(k) !== -1) data[k] = JSON.parse(v);
      else data[k] = v;
    });
  } catch (err) { return officeGameRefuse_('BAD_INPUT'); }
  data.campus = campus;
  officeMemoStart_();
  try {
    if (spec.ticket) return { success: true, data: officeGameTicket_(caller, data) };
    const r = officeDispatch_(caller, spec.act, data);
    if (r.success === false) return officeGameRefuse_(officeGameCode_(r.code || r.error));
    const out = Object.assign({}, r); delete out.success;
    return { success: true, data: out };
  } catch (err) {
    return officeGameRefuse_(officeGameCode_(err.code || err.message));
  } finally {
    OFFICE_MEMO = null;
  }
}

// A code word only: the office's own codes (DAY_CLOSED, FILE_REQUIRED, BAD_AMOUNT, FORBIDDEN_CAMPUS…); a sentence becomes FAILED.
function officeGameCode_(s) { const c = String(s || ''); return /^[A-Z][A-Z0-9_]{1,40}$/.test(c) ? c : 'FAILED'; }

// ── Photo tickets ────────────────────────────────────────────────────
// gameFileTicket {id, category, mime, name?, belongs_to?} -> {url, expiresAt}. The ticket binds who (email), where (campus) and
// which file (id, category, mime), expires in 10 minutes and is burned by the last part. Signed with the game key, so only this
// backend can mint or check one. The browser holds it for minutes; it is never the key.
function officeGameB64_(s) { return Utilities.base64EncodeWebSafe(s).replace(/=+$/, ''); }
function officeGameSign_(body) {
  const key = PropertiesService.getScriptProperties().getProperty('OFFICE_GAME_KEY');
  return officeGameB64_(Utilities.computeHmacSha256Signature(body, key));
}

function officeGameTicket_(caller, data) {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(String(data.id || ''))) throw officeCoded_('MISSING_ID');
  if (OFFICE_FILE_CATEGORIES.indexOf(data.category) === -1) throw officeCoded_('BAD_CATEGORY');
  if (OFFICE_FILE_MIMES.indexOf(data.mime) === -1) throw officeCoded_('BAD_MIME');
  const exp = officeNow_().getTime() + OFFICE_GAME_TICKET_MS;
  const t = { c: data.campus, e: caller.email, i: String(data.id), k: data.category, m: data.mime, n: String(data.name || '').slice(0, 100),
    b: String(data.belongs_to || '').slice(0, 80), x: exp, r: Utilities.getUuid() };
  const body = officeGameB64_(JSON.stringify(t));
  const url = (PropertiesService.getScriptProperties().getProperty('OFFICE_WEBAPP_URL') || ScriptApp.getService().getUrl());
  return { url: url + '?ticket=' + body + '.' + officeGameSign_(body) + '&action=gameUploadPart', expiresAt: new Date(exp).toISOString() };
}

// The ticket's fields if its signature holds and it hasn't expired or been burned; else null.
function officeGameTicketOk_(s) {
  const at = String(s || '').indexOf('.');
  if (at < 1) return null;
  const body = s.slice(0, at), sig = s.slice(at + 1);
  if (!PropertiesService.getScriptProperties().getProperty('OFFICE_GAME_KEY') || sig !== officeGameSign_(body)) return null;
  let t;
  try { t = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(body + '==='.slice((body.length + 3) % 4))).getDataAsString()); } catch (err) { return null; }
  if (!t || typeof t.x !== 'number' || t.x < officeNow_().getTime()) return null;
  if (CacheService.getScriptCache().get('office_game_burnt_' + t.r)) return null;
  return t;
}

// One part. Parts wait in a Drive folder (OFFICE_DRIVE_ROOT/_game_parts) under the ticket's nonce: a resent part replaces its file,
// so a retry stores nothing twice. The last part reassembles the bytes, runs file.upload as the ticket's Fee Clerk, burns the
// ticket and removes the parts.
function officeGameUploadPart_(b) {
  const t = officeGameTicketOk_(b.ticket);
  if (!t) return { success: false, error: 'not_authorized' };
  const part = Number(b.part), of = Number(b.of), base64 = String(b.base64 || '');
  if (!Number.isInteger(part) || !Number.isInteger(of) || of < 1 || of > OFFICE_GAME_PARTS_MAX || part < 1 || part > of) return { success: false, error: 'BAD_PART' };
  if (!base64 || base64.length > OFFICE_GAME_PART_MAX || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return { success: false, error: 'BAD_PART' };
  const root = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('OFFICE_DRIVE_ROOT'));
  const lock = LockService.getScriptLock();
  let dir;
  lock.waitLock(20000);
  try { // only the part's own file under the lock; file.upload below takes the lock itself
    dir = officeFolder_(officeFolder_(root, '_game_parts'), t.r);
    const name = 'part-' + part + '-of-' + of;
    const old = dir.getFilesByName(name);
    while (old.hasNext()) old.next().setTrashed(true);
    dir.createFile(name, base64, 'text/plain');
  } finally { lock.releaseLock(); }
  if (part < of) return { success: true };
  const bytes = [];
  for (let i = 1; i <= of; i++) {
    const it = dir.getFilesByName('part-' + i + '-of-' + of);
    if (!it.hasNext()) return { success: false, error: 'PARTS_MISSING' };
    Array.prototype.push.apply(bytes, Utilities.base64Decode(it.next().getBlob().getDataAsString()));
  }
  const caller = { email: t.e, name: '', roles: ['FeeClerk'], campuses: [t.c], functions: [] };
  officeMemoStart_();
  let r;
  try {
    r = officeDispatch_(caller, 'file.upload', { id: t.i, campus: t.c, category: t.k, mime: t.m, name: t.n || 'photo', belongs_to: t.b,
      base64: Utilities.base64Encode(bytes) });
  } catch (err) { return { success: false, error: officeGameCode_(err.code || err.message) }; }
  finally { OFFICE_MEMO = null; }
  if (r.success === false) return { success: false, error: officeGameCode_(r.code || r.error) };
  CacheService.getScriptCache().put('office_game_burnt_' + t.r, '1', 21600);
  dir.setTrashed(true);
  return { success: true, fileId: r.id };
}
