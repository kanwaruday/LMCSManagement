// ═══════════════════════════════════════════════════════════════════
// driver-google.gs -- 2026-10-29, Uday: "i think a lot of the drivers have a registered email id, can they also use the gmail id
// login". A second way in beside the Fee Clerk's QR: a driver signs in with Google on the driver page, and if that account is a
// driver's, this links the phone exactly as a QR would (driver-link.gs's Driver Devices row, only the token's hash kept).
//
// POST {action:'driverlinkself', idToken} -> {success, linkId, token} | {success:false, error: DGL_REFUSE_}
//   1. idToken -> email: Google tokeninfo, our client id (STAFF_GOOGLE_CLIENT_ID), a verified email.
//   2. email -> employee code: EmpPersonal.AuthEmail, the same field staff sign in with (teacher-portal.gs's map, main.gs's
//      auto sign-in); then EmpMaster Status Active and EmpSalary Department Transport with a Driver designation.
//   3. code -> bus: the fleet register ('LM Studio Fleet') row whose driver code is this code, running; exactly one.
//   4. a new link for that bus, created by DGL_BY_; the driver's earlier active links are revoked (one phone per driver, as a QR).
//   Every refusal is the same one answer, whatever failed. Nothing is logged: no email, no code, no token.
// driverLinkList_ (driver-link.gs) adds googleReady: how many of the caller's running buses have a driver who could sign in this way.
// ═══════════════════════════════════════════════════════════════════

const DGL_BY_ = 'google:self';
const DGL_REFUSE_ = 'यह Google खाता किसी ड्राइवर का नहीं है · This Google account is not set up for a driver. Ask your Fee Clerk for the QR.';

/** A verified Google account's email (lower case), or '' for anything else. */
function dglTokenEmail_(idToken) {
  if (!idToken || String(idToken).length > 4096) return '';
  try {
    const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return '';
    const p = JSON.parse(res.getContentText());
    if (p.aud !== STAFF_GOOGLE_CLIENT_ID || (p.email_verified !== true && p.email_verified !== 'true')) return '';
    return String(p.email || '').trim().toLowerCase();
  } catch (e) { return ''; }
}

/** {code: {name}} of every active Transport driver who has an AuthEmail, keyed also by email: {byEmail: {email: code}, byCode: {code: name}}. */
function dglDrivers_() {
  const cache = CacheService.getScriptCache(), hit = cache.get('dgl_drivers_v1');
  if (hit) return JSON.parse(hit); // 5 minutes: one roster read serves every sign-in and Driver phones load meanwhile
  const book = SpreadsheetApp.openById(EMP_ROSTER_SHEET_ID);
  const cell = function (v) { return String(v == null ? '' : v).replace(/[​-‏﻿⁠]/g, '').trim(); };
  const table = function (tab) { const v = book.getSheetByName(tab).getDataRange().getValues(); return { h: v[0].map(cell), rows: v.slice(1) }; };
  const sal = table('EmpSalary'), mas = table('EmpMaster'), per = table('EmpPersonal');
  const col = function (t, name) { return t.h.indexOf(name); };
  const drivers = {};
  sal.rows.forEach(function (r) {
    const code = cell(r[col(sal, 'EmployeeCode')]).toUpperCase();
    if (code && cell(r[col(sal, 'Department')]).toLowerCase() === 'transport' && /^driver/i.test(cell(r[col(sal, 'Designation')]))) drivers[code] = '';
  });
  mas.rows.forEach(function (r) {
    const code = cell(r[col(mas, 'EmployeeCode')]).toUpperCase();
    if (!(code in drivers)) return;
    if (cell(r[col(mas, 'Status')]).toLowerCase() !== 'active') delete drivers[code];
    else drivers[code] = cell(r[col(mas, 'Name')]) || '-'; // seen and active, even with no name
  });
  Object.keys(drivers).forEach(function (code) { if (drivers[code] === '') delete drivers[code]; }); // not in EmpMaster: not active
  const codesOf = {}; // every row's AuthEmail, drivers or not: an email against two people opens nothing
  per.rows.forEach(function (r) {
    const email = cell(r[col(per, 'AuthEmail')]).toLowerCase(), code = cell(r[col(per, 'EmployeeCode')]).toUpperCase();
    if (email.indexOf('@') > 0 && code) (codesOf[email] = codesOf[email] || {})[code] = true;
  });
  const byEmail = {};
  Object.keys(codesOf).forEach(function (email) { const codes = Object.keys(codesOf[email]); if (codes.length === 1 && codes[0] in drivers) byEmail[email] = codes[0]; });
  const out = { byEmail: byEmail, byCode: drivers };
  try { cache.put('dgl_drivers_v1', JSON.stringify(out), 300); } catch (e) { /* too big for the cache: read each time */ }
  return out;
}

/** The running buses of the fleet register by driver code: {code: [{reg, campusId, name}]}. */
function dglBusesByDriver_() {
  const sh = SpreadsheetApp.openById(TUP_SHEET_ID_).getSheetByName(TUP_FLEET_TAB_);
  const out = {};
  (sh ? sh.getDataRange().getValues().slice(1) : []).forEach(function (r) {
    const code = String(r[9] || '').replace(/[\u200B-\u200F\uFEFF\u2060]/g, '').trim().toUpperCase(), reg = tupNormReg_(r[0]);
    if (!code || !reg || String(r[3]) !== 'yes') return;
    (out[code] = out[code] || []).push({ reg: reg, campusId: 'LMS' + String(r[2]).replace(/\D/g, ''), name: String(r[6] || '') });
  });
  return out;
}

function driverLinkSelf_(body) {
  const refuse = { success: false, error: DGL_REFUSE_ };
  const email = dglTokenEmail_(body.idToken);
  if (!email) return refuse;
  const d = dglDrivers_(), code = d.byEmail[email];
  const buses = code ? (dglBusesByDriver_()[code] || []) : [];
  if (buses.length !== 1) return refuse; // no bus, or two buses for one driver: the Fee Clerk's QR settles which
  const bus = buses[0];
  const name = (String(d.byCode[code] || bus.name).replace(/[^A-Za-z .]/g, ' ').replace(/\s+/g, ' ').trim() || 'Driver').slice(0, 60);
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); // as driverLinkCreate_
  const linkId = 'DL-' + Utilities.getUuid().replace(/-/g, '').slice(0, 12), now = new Date();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = dlkSheet_(), rows = sh.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) { // one phone per driver: this sign-in replaces the driver's earlier phone, as a new QR does
      const mine = String(rows[i][4]).toUpperCase() === code || (!rows[i][4] && String(rows[i][2]) === bus.reg); // a QR made without a code, for this bus
      if (mine && !rows[i][8]) sh.getRange(i + 1, 9, 1, 2).setValues([[now, DGL_BY_]]);
    }
    sh.appendRow([linkId, dlkHash_(token), bus.reg, bus.campusId, code, name, now, DGL_BY_, '', '', '']);
  } finally {
    lock.releaseLock();
  }
  return { success: true, linkId: linkId, token: token };
}

/** How many of these running buses have a driver who can sign in with Google (a count, never who). */
function dglGoogleReady_(campusOk) {
  try {
    const d = dglDrivers_(), ready = {};
    Object.keys(d.byEmail).forEach(function (e) { ready[d.byEmail[e]] = true; });
    const buses = dglBusesByDriver_();
    let n = 0;
    Object.keys(buses).forEach(function (code) { if (ready[code] && buses[code].length === 1 && campusOk(buses[code][0].campusId)) n++; });
    return n;
  } catch (e) { return null; } // the roster could not be read: the page shows no count rather than a wrong one
}
