// ═══════════════════════════════════════════════════════════════════
// Coordinator Backend -- Transport department (second file of the same
// "LMCS Coordinator Backend" Apps Script project, next to coordinator.gs).
//
// Fleet document compliance: for every running school vehicle, the newest expiry date of
// insurance, fitness, MV tax, pollution, route permit and speed governor, from two sources:
//   scans = three "LM Studio ..." tabs in the form-responses workbook: fleet roster + the dates LM Studio
//           read off the Drive scans + dates typed in the vault's "Transport Overrides" note. The drive-index
//           sync on Uday's Mac pushes them here over HTTPS (action=transportpush, shared secret) after every
//           run, so they are only as fresh as that sync; the sync time is shown on the page.
//   form  = the "LMCS Transport Document Submission Form" responses tab of the same workbook, read live
//           (about 5 min).
// The newer date wins; on a tie the form wins. A date typed in the overrides note replaces the scan-read
// date (Status "override"); "n/a" there means the vehicle does not need that paper.
//
// Powers GET action=coordinatortransport (the Transport page) and the transport adapter
// (follow-up tasks: expired / due soon / no date on file, one per campus per month).
// No Drive access is needed anywhere in here (the Workspace blocks DriveApp for scripts).
//
// SETUP: Project Settings > Script properties > add TRANSPORT_PUSH_SECRET (the same value as
// ~/.lmcs/transport_push_secret on the Mac). Without it every push is refused.
//
// ponytail: the roster comes from the transport workbook on the Mac via the sync, so a campus or driver change
// shows up after the next sync. If the Mac is off for days the page says how old the scan data is.
// ═══════════════════════════════════════════════════════════════════

const COORD_TRANSPORT_FORM_ID = '1VXTMZjqCS82ftB1rwoN4BzoiOTP7-Vg0m5vTH01Tfzc'; // "LMCS TRANSPORT DOCUMENT SUBMISSION FORM (Responses)"; also holds the LM Studio tabs
const COORD_TRANSPORT_FORM_GID = 1365845375;                                   // its form-responses tab
const COORD_TRANSPORT_TAB_FLEET = 'LM Studio Fleet';
const COORD_TRANSPORT_TAB_DOCS = 'LM Studio Documents';
const COORD_TRANSPORT_TAB_SYNC = 'LM Studio Sync';
const COORD_TRANSPORT_MIN_FLEET = 15; // a push with fewer vehicles is a read gone wrong; never overwrite good data with it
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
  const s = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // form sheet text: m/d/yyyy
  return m ? m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2) : '';
}

/** {docs: {'REG|type': 'yyyy-MM-dd'}, regs, rows}: newest valid-till per bus and document in the form responses. */
function coordTransportLive_() {
  const hit = coordCacheGetBig_('coord_transport_live');
  if (hit) return hit;
  const ss = SpreadsheetApp.openById(COORD_TRANSPORT_FORM_ID);
  const sh = ss.getSheets().filter(function (s) { return s.getSheetId() === COORD_TRANSPORT_FORM_GID; })[0];
  if (!sh) throw new Error('Transport form responses tab not found'); // never mistake an unreadable source for "nothing uploaded"
  const rows = sh.getDataRange().getValues(), tz = ss.getSpreadsheetTimeZone();
  const docs = {}, regs = {};
  for (let i = 1; i < rows.length; i++) {
    const reg = String(rows[i][1] || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const type = COORD_TRANSPORT_FORM_TYPES[String(rows[i][2] || '').trim().toUpperCase()];
    const date = coordTransportDate_(rows[i][3], tz);
    if (!reg) continue;
    regs[reg] = true;
    if (!type || !date) continue;
    if (!docs[reg + '|' + type] || date > docs[reg + '|' + type]) docs[reg + '|' + type] = date;
  }
  const live = { docs: docs, regs: Object.keys(regs), rows: rows.length - 1 };
  coordCachePutBig_('coord_transport_live', live, COORD_TRANSPORT_LIVE_CACHE_SECONDS);
  return live;
}

// ── The LM Studio tabs: written by the push, read back as the "scans" source ──
function coordTransportWriteTab_(ss, name, header, rows) {
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clear();
  const all = [header].concat(rows);
  sh.getRange(1, 1, all.length, header.length).setNumberFormat('@').setValues(all); // text, so Sheets never turns 2027-03-04 into a date
  sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
  sh.setFrozenRows(1);
}

// Trimmed on both sides: a pasted Script property often carries a trailing newline.
function coordTransportSecretOk_(given) {
  const secret = String(PropertiesService.getScriptProperties().getProperty('TRANSPORT_PUSH_SECRET') || '').trim();
  return !!secret && String(given || '').trim() === secret;
}

/** POST action=transportpushcheck {secret}: says whether this deployment has the push code, whether the Script property is set and whether the secret matches. Changes nothing. */
function coordTransportPushCheck_(body) {
  const set = !!String(PropertiesService.getScriptProperties().getProperty('TRANSPORT_PUSH_SECRET') || '').trim();
  return { success: true, pushCode: true, secretConfigured: set, secretMatches: coordTransportSecretOk_(body.secret) };
}

/** POST action=transportpush {secret, payload:{syncedAt, warnings, fleet:[...]}} from transport/export_fleet.py. No ID token: the shared secret is the gate. */
function coordTransportPush_(body) {
  if (!coordTransportSecretOk_(body.secret)) return { success: false, error: 'Not authorized' };
  const p = body.payload;
  if (!p || !Array.isArray(p.fleet) || p.fleet.length < COORD_TRANSPORT_MIN_FLEET || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(String(p.syncedAt))) {
    return { success: false, error: 'Payload rejected: expected syncedAt and at least ' + COORD_TRANSPORT_MIN_FLEET + ' vehicles' };
  }
  const label = {};
  COORD_TRANSPORT_DOCS.forEach(function (d) { label[d[0]] = d[1]; });
  const fleet = [], docs = [];
  p.fleet.forEach(function (b) {
    fleet.push([b.reg, b.bus, b.campus, b.operational ? 'yes' : 'no', b.route || '', b.start || '', b.driver || '', b.seats || '', b.year || '']);
    Object.keys(b.docs || {}).forEach(function (k) {
      const d = b.docs[k];
      if (!label[k]) return;
      docs.push([b.reg, label[k], d.na ? '' : d.date, d.na ? 'n/a' : (d.src === 'override' ? 'override' : 'read'),
        d.src === 'override' ? 'overrides note' : 'drive scan', d.file || '', d.link || '', d.note || '']);
    });
    (b.unreadable || []).forEach(function (u) {
      if (label[u.key]) docs.push([b.reg, label[u.key], '', 'unread', 'drive scan', u.file || '', u.link || '', 'LM Studio could not read a date']);
    });
  });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.openById(COORD_TRANSPORT_FORM_ID);
    coordTransportWriteTab_(ss, COORD_TRANSPORT_TAB_FLEET, ['Reg', 'Bus', 'Campus', 'Running', 'Route', 'Start point', 'Driver', 'Seats', 'Year'], fleet);
    coordTransportWriteTab_(ss, COORD_TRANSPORT_TAB_DOCS, ['Reg', 'Document', 'Valid to', 'Status', 'Source', 'File', 'Link', 'Note'], docs);
    coordTransportWriteTab_(ss, COORD_TRANSPORT_TAB_SYNC, ['Key', 'Value'], [
      ['syncedAt', p.syncedAt], ['pushedAt', new Date().toISOString()], ['vehicles', String(fleet.length)],
      ['documents', String(docs.length)], ['warnings', (p.warnings || []).join(' | ')]]);
  } finally { lock.releaseLock(); }
  const cache = CacheService.getScriptCache();
  ['coord_transport_base', 'coord_transport_refreshed'].forEach(function (k) { cache.remove(k); });
  return { success: true, vehicles: fleet.length, documents: docs.length };
}

/** The scans source rebuilt from the LM Studio tabs. Throws if they are missing: an unreadable source must never look like "no vehicles". */
function coordTransportBase_() {
  const hit = coordCacheGetBig_('coord_transport_base');
  if (hit) return hit;
  const ss = SpreadsheetApp.openById(COORD_TRANSPORT_FORM_ID), tz = ss.getSpreadsheetTimeZone();
  const read = function (name) {
    const sh = ss.getSheetByName(name);
    if (!sh) throw new Error('Tab "' + name + '" is missing. It is created by the drive-index sync pushing to this backend (transport/export_fleet.py).');
    return sh.getDataRange().getValues().slice(1);
  };
  const fleetRows = read(COORD_TRANSPORT_TAB_FLEET), docRows = read(COORD_TRANSPORT_TAB_DOCS), syncRows = read(COORD_TRANSPORT_TAB_SYNC);
  if (!fleetRows.length) throw new Error('Tab "' + COORD_TRANSPORT_TAB_FLEET + '" has no vehicles in it');
  const meta = {};
  syncRows.forEach(function (r) { meta[String(r[0])] = String(r[1]); });
  const fleet = fleetRows.map(function (r) {
    return { reg: String(r[0]), bus: r[1], campus: String(r[2]), operational: r[3] === 'yes', route: r[4], start: r[5], driver: r[6], seats: r[7], year: r[8], docs: {}, unreadable: [] };
  });
  const byReg = {}, keyOf = {};
  fleet.forEach(function (b) { byReg[b.reg] = b; });
  COORD_TRANSPORT_DOCS.forEach(function (d) { keyOf[d[1]] = d[0]; });
  docRows.forEach(function (r) {
    const b = byReg[String(r[0])], key = keyOf[String(r[1])], status = String(r[3]);
    if (!b || !key) return;
    if (status === 'unread') b.unreadable.push({ key: key, file: String(r[5]), link: String(r[6]) });
    else if (status === 'n/a') b.docs[key] = { na: true, date: '', src: 'override', note: String(r[7]), file: '', link: '' };
    else b.docs[key] = { date: coordTransportDate_(r[2], tz), src: status === 'override' ? 'override' : 'drive', file: String(r[5]), link: String(r[6]), note: String(r[7]) };
  });
  const base = { syncedAt: meta.syncedAt || '', warnings: meta.warnings ? meta.warnings.split(' | ') : [], fleet: fleet };
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

// action=coordinatortransport
function coordTransport_(caller) {
  const all = coordTransportFleet_();
  const visible = coordVisibleCampuses_(caller);
  return {
    success: true, generated: new Date().toISOString(), formRows: all.live.rows, unknown: all.unknown,
    syncedAt: all.base.syncedAt, warnings: all.base.warnings,
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

/** Run from the Apps Script editor (Run > coordTransportCheck) after a push to see what the Transport page would load.
 *  Private (trailing _) functions cannot be run from the editor. */
function coordTransportCheck() {
  const all = coordTransportFleet_();
  console.log('scan data synced at ' + all.base.syncedAt + ': ' + all.fleet.length + ' vehicles, ' + all.live.rows + ' form rows, unknown vehicles in form: ' + (all.unknown.join(', ') || 'none'));
  console.log('override warnings: ' + (all.base.warnings.join('; ') || 'none'));
}
