// ═══════════════════════════════════════════════════════════════════
// Coordinator Backend -- Transport department (second file of the same
// "LMCS Coordinator Backend" Apps Script project, next to coordinator.gs).
//
// Fleet document compliance: for every running school vehicle, the newest expiry date of
// insurance, fitness, MV tax, pollution, route permit and speed governor, from two sources:
//   scans = LMCS_Transport_Fleet.json in Google Drive (My Drive root): fleet roster + the dates LM Studio
//           read off the Drive scans. Written by transport/export_fleet.py at the end of every
//           drive-index sync on Uday's Mac, so it is only as fresh as that sync (its syncedAt is shown).
//   form  = the "LMCS Transport Document Submission Form" responses sheet, read live (about 5 min).
// A date typed in the vault's "Transport Overrides" note replaces the scan-read date (src 'override'); "n/a" there
// means the vehicle does not need that paper. The newer date wins; on a tie the form wins. Scans uploaded to the Transport folder since the last
// sync are listed as "waiting to be read" so a new upload is visible before its date is known.
//
// Powers GET action=coordinatortransport (the Transport page) and the transport adapter
// (follow-up tasks: expired / due soon / no date on file, one per campus per month).
//
// ponytail: the roster comes from the transport workbook on the Mac via the sync, so a campus or driver change
// shows up after the next sync. If the Mac is off for days the page says how old the scan data is.
// ═══════════════════════════════════════════════════════════════════

const COORD_TRANSPORT_FORM_ID = '1VXTMZjqCS82ftB1rwoN4BzoiOTP7-Vg0m5vTH01Tfzc'; // "LMCS TRANSPORT DOCUMENT SUBMISSION FORM (Responses)"
const COORD_TRANSPORT_FORM_GID = 1365845375;                                   // its responses tab
const COORD_TRANSPORT_FLEET_FILE = 'LMCS_Transport_Fleet.json';
const COORD_TRANSPORT_ROOT_FOLDER = 'Important Documents Transport'; // Drive folder holding every bus folder and the form uploads
const COORD_TRANSPORT_PENDING_MAX = 80; // files examined for "waiting to be read" before giving up
const COORD_TRANSPORT_DOCS = [['insurance', 'Insurance'], ['fitness', 'Fitness'], ['mv_tax', 'MV tax'],
  ['pollution', 'Pollution'], ['route_permit', 'Route permit'], ['speed_governor', 'Speed governor']];
// Form "Document Type" -> key. RC is collected by the form but has no expiry worth tracking; passenger tax is not on the form.
const COORD_TRANSPORT_FORM_TYPES = { 'FITNESS': 'fitness', 'ROUTE PERMIT': 'route_permit', 'INSURANCE': 'insurance',
  'MV TAX': 'mv_tax', 'POLLUTION': 'pollution', 'SPEED GOVERNOR': 'speed_governor' };
const COORD_TRANSPORT_LEGAL = ['insurance', 'fitness', 'mv_tax', 'route_permit']; // expired = the bus should not be on the road -> high
const COORD_TRANSPORT_SOON_DAYS = 30;
const COORD_TRANSPORT_LIVE_CACHE_SECONDS = 300;
const COORD_TRANSPORT_REFRESH_CACHE_SECONDS = 600;

function coordTransportDate_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  const m = String(v || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // form sheet text: m/d/yyyy
  return m ? m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2) : '';
}

/** {docs: {'REG|type': 'yyyy-MM-dd'}, regs, ids, rows}: newest valid-till per bus and document in the form responses. */
function coordTransportLive_() {
  const hit = coordCacheGetBig_('coord_transport_live');
  if (hit) return hit;
  const ss = SpreadsheetApp.openById(COORD_TRANSPORT_FORM_ID);
  const sh = ss.getSheets().filter(function (s) { return s.getSheetId() === COORD_TRANSPORT_FORM_GID; })[0];
  if (!sh) throw new Error('Transport form responses tab not found'); // never mistake an unreadable source for "nothing uploaded"
  const rows = sh.getDataRange().getValues(), tz = ss.getSpreadsheetTimeZone();
  const docs = {}, regs = {}, ids = {};
  for (let i = 1; i < rows.length; i++) {
    const up = String(rows[i][4] || '').match(/[-\w]{25,}/);
    if (up) ids[up[0]] = true; // files the form itself uploaded: their dates arrive as form rows, so they are never "pending"
    const reg = String(rows[i][1] || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const type = COORD_TRANSPORT_FORM_TYPES[String(rows[i][2] || '').trim().toUpperCase()];
    const date = coordTransportDate_(rows[i][3], tz);
    if (!reg) continue;
    regs[reg] = true;
    if (!type || !date) continue;
    if (!docs[reg + '|' + type] || date > docs[reg + '|' + type]) docs[reg + '|' + type] = date;
  }
  const live = { docs: docs, regs: Object.keys(regs), ids: Object.keys(ids), rows: rows.length - 1 };
  coordCachePutBig_('coord_transport_live', live, COORD_TRANSPORT_LIVE_CACHE_SECONDS);
  return live;
}

/** LMCS_Transport_Fleet.json from Drive (newest copy by name). Throws if absent: an unreadable source must never look like "no vehicles". */
function coordTransportBase_() {
  const hit = coordCacheGetBig_('coord_transport_base');
  if (hit) return hit;
  const it = DriveApp.getFilesByName(COORD_TRANSPORT_FLEET_FILE);
  let file = null;
  while (it.hasNext()) { const f = it.next(); if (!file || f.getLastUpdated() > file.getLastUpdated()) file = f; }
  if (!file) throw new Error(COORD_TRANSPORT_FLEET_FILE + ' is not in Google Drive yet. transport/export_fleet.py writes it at the end of the drive-index sync.');
  const base = JSON.parse(file.getBlob().getDataAsString());
  if (!base.fleet || !base.fleet.length) throw new Error(COORD_TRANSPORT_FLEET_FILE + ' has no vehicles in it');
  coordCachePutBig_('coord_transport_base', base, COORD_TRANSPORT_LIVE_CACHE_SECONDS);
  return base;
}

/** The fleet with each document resolved to {date, src, link, unread}: the form if it is at least as new as the scan-read date, else the scan. */
function coordTransportFleet_() {
  const base = coordTransportBase_(), live = coordTransportLive_();
  const fleet = base.fleet.map(function (b) {
    const docs = {};
    COORD_TRANSPORT_DOCS.forEach(function (d) {
      const sc = (b.docs || {})[d[0]], l = live.docs[b.reg + '|' + d[0]] || '';
      const doc = l && (!sc || l >= sc.date) ? { date: l, src: 'form', link: '' }
        : sc ? { date: sc.date, src: sc.src || 'drive', link: sc.link, na: !!sc.na, note: sc.note || '' } : { date: '', src: '', link: '' };
      // scans of this type whose date LM Studio could not read; one of them may be the renewal
      doc.unread = (b.unreadable || []).filter(function (u) { return u.key === d[0]; }).map(function (u) { return { file: u.file, link: u.link }; });
      docs[d[0]] = doc;
    });
    const n = String(b.campus).replace(/\D/g, ''); // roster says 'LMS-5' in one row
    return { reg: b.reg, bus: b.bus, campus: 'LMS ' + n, campusId: 'LMS' + n, operational: b.operational,
      route: b.route, driver: b.driver, docs: docs };
  });
  const known = {};
  base.fleet.forEach(function (b) { known[b.reg] = true; });
  return { fleet: fleet, base: base, live: live, unknown: live.regs.filter(function (r) { return !known[r]; }) };
}

// 'na' | 'expired' | 'check' (a scan exists but no date could be read) | 'missing' | 'due' (within the soon window) | 'ok'
function coordTransportState_(doc, today) {
  if (doc.na) return 'na';
  if (!doc.date) return doc.unread.length ? 'check' : 'missing';
  if (doc.date < today) return 'expired';
  const days = Math.round((Date.parse(doc.date + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
  return days <= COORD_TRANSPORT_SOON_DAYS ? 'due' : 'ok';
}

/** Files created in the Transport folder tree since the last sync that nothing has read yet. Garnish: any failure returns an empty list. */
function coordTransportPending_(base, live) {
  const hit = coordCacheGetBig_('coord_transport_pending');
  if (hit) return hit;
  const out = { files: [], capped: false };
  try {
    const known = {}, idOf = function (link) { const m = String(link || '').match(/[-\w]{25,}/); return m ? m[0] : ''; };
    live.ids.forEach(function (i) { known[i] = true; });
    let anchor = '';
    base.fleet.forEach(function (b) {
      Object.keys(b.docs || {}).forEach(function (k) { const id = idOf(b.docs[k].link); if (id) { known[id] = true; anchor = anchor || id; } });
      (b.unreadable || []).forEach(function (u) { const id = idOf(u.link); if (id) known[id] = true; });
    });
    // find the Transport root by walking up from any scanned file
    let node = anchor ? DriveApp.getFileById(anchor) : null, root = '';
    for (let i = 0; node && i < 10 && !root; i++) {
      const ps = node.getParents();
      if (!ps.hasNext()) break;
      node = ps.next();
      if (node.getName() === COORD_TRANSPORT_ROOT_FOLDER) root = node.getId();
    }
    if (!root) return out;
    const under = function (f) {
      let cur = f;
      for (let i = 0; i < 10; i++) {
        const ps = cur.getParents();
        if (!ps.hasNext()) return false;
        cur = ps.next();
        if (cur.getId() === root) return true;
      }
      return false;
    };
    const it = DriveApp.searchFiles("createdDate > '" + base.syncedAt + "' and trashed = false and mimeType != 'application/vnd.google-apps.folder'");
    for (let n = 0; it.hasNext(); n++) {
      if (n >= COORD_TRANSPORT_PENDING_MAX) { out.capped = true; break; }
      const f = it.next();
      if (known[f.getId()] || !under(f)) continue;
      out.files.push({ name: f.getName(), created: f.getDateCreated().toISOString(), url: f.getUrl() });
    }
  } catch (err) { console.error('Transport pending: ' + err.message); }
  coordCachePutBig_('coord_transport_pending', out, 600);
  return out;
}

// action=coordinatortransport
function coordTransport_(caller) {
  const all = coordTransportFleet_();
  const visible = coordVisibleCampuses_(caller);
  return {
    success: true, generated: new Date().toISOString(), formRows: all.live.rows, unknown: all.unknown,
    syncedAt: all.base.syncedAt, warnings: all.base.warnings || [], pending: coordTransportPending_(all.base, all.live),
    docs: COORD_TRANSPORT_DOCS.map(function (d) { return { key: d[0], label: d[1] }; }),
    fleet: all.fleet.filter(function (b) { return !visible || visible.indexOf(b.campusId) !== -1; }),
  };
}

// ── Adapter: follow-up tasks, one per campus per month per problem kind ──
function coordTransportWanted_(fleet, now) {
  const today = Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd'), month = today.slice(0, 7);
  const by = {}; // campusId -> { campus, expired: [], due: [], missing: [] }; 'check' items ride in missing
  fleet.filter(function (b) { return b.operational; }).forEach(function (b) {
    COORD_TRANSPORT_DOCS.forEach(function (d) {
      const st = coordTransportState_(b.docs[d[0]], today);
      if (st === 'ok' || st === 'na') return;
      const c = by[b.campusId] = by[b.campusId] || { campus: b.campus, expired: [], due: [], missing: [] };
      c[st === 'check' ? 'missing' : st].push({ reg: b.reg, key: d[0], label: d[1] + (st === 'check' ? ' [scan, date unread]' : '') });
    });
  });
  const regs = function (items) { // 'HP34B6082 (Pollution, Speed governor)'
    const per = {};
    items.forEach(function (i) { (per[i.reg] = per[i.reg] || []).push(i.label); });
    return Object.keys(per).map(function (r) { return r + ' (' + per[r].join(', ') + ')'; });
  };
  const shown = function (items) {
    const list = regs(items);
    return list.slice(0, 6).join('; ') + (list.length > 6 ? '; and ' + (list.length - 6) + ' more' : '');
  };
  const wanted = [];
  Object.keys(by).forEach(function (id) {
    const c = by[id];
    const base = { department: COORD_DEPT_TRANSPORT, campus: id };
    if (c.expired.length) wanted.push(Object.assign({}, base, {
      taskId: 'transport_expired|' + id + '|' + month, domain: 'transport_expired',
      title: c.campus + ': ' + c.expired.length + ' vehicle document' + (c.expired.length > 1 ? 's' : '') + ' expired',
      detail: shown(c.expired),
      severity: c.expired.some(function (i) { return COORD_TRANSPORT_LEGAL.indexOf(i.key) !== -1; }) ? 'high' : 'medium',
    }));
    if (c.due.length) wanted.push(Object.assign({}, base, {
      taskId: 'transport_due|' + id + '|' + month, domain: 'transport_due',
      title: c.campus + ': ' + c.due.length + ' vehicle document' + (c.due.length > 1 ? 's' : '') + ' due within ' + COORD_TRANSPORT_SOON_DAYS + ' days',
      detail: shown(c.due), severity: 'medium',
    }));
    if (c.missing.length) wanted.push(Object.assign({}, base, {
      taskId: 'transport_missing|' + id + '|' + month, domain: 'transport_missing',
      title: c.campus + ': ' + c.missing.length + ' vehicle document' + (c.missing.length > 1 ? 's' : '') + ' with no date on file',
      detail: shown(c.missing) + '. Upload through the Transport Document Submission form, or confirm they are current', severity: 'low',
    }));
  });
  return wanted;
}

function coordRefreshTransport_() {
  const cache = CacheService.getScriptCache();
  if (cache.get('coord_transport_refreshed')) return;
  const wanted = coordTransportWanted_(coordTransportFleet_().fleet, new Date());
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = coordSheet_();
    const rows = sh.getDataRange().getValues();
    const live = {};
    wanted.forEach(function (t) { live[t.taskId] = true; coordTaskUpsert_(sh, rows, t); });
    ['transport_expired', 'transport_due', 'transport_missing'].forEach(function (d) { coordTasksAutoResolve_(sh, rows, d, null, live); });
  } finally { lock.releaseLock(); }
  cache.put('coord_transport_refreshed', '1', COORD_TRANSPORT_REFRESH_CACHE_SECONDS);
}
