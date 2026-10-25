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
// Powers GET action=coordinatortransport (the Transport page) and POST action=transportpush. No follow-up tasks: they were
// built and switched off (see coordTransportRetireTasks_). Also the safety loadout and the Fleet setup quests (sections below).
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
const COORD_TRANSPORT_TAB_PEOPLE = 'Transport Staff'; // every person on the transport Man Power sheet, linked to the staff master by employee code
const COORD_TRANSPORT_TAB_PNL = 'Transport P&L'; // per bus per month money, from the transport workbook (push)
const COORD_TRANSPORT_MIN_FLEET = 15; // a push with fewer vehicles is a read gone wrong; never overwrite good data with it
const COORD_TRANSPORT_DOCS = [['insurance', 'Insurance'], ['fitness', 'Fitness'], ['mv_tax', 'MV tax'],
  ['pollution', 'Pollution'], ['route_permit', 'Route permit'], ['speed_governor', 'Speed governor']];
// Form "Document Type" -> key. RC is collected by the form but has no expiry worth tracking; passenger tax is not on the form.
const COORD_TRANSPORT_FORM_TYPES = { 'FITNESS': 'fitness', 'ROUTE PERMIT': 'route_permit', 'INSURANCE': 'insurance',
  'MV TAX': 'mv_tax', 'POLLUTION': 'pollution', 'SPEED GOVERNOR': 'speed_governor' };
const COORD_TRANSPORT_LIVE_CACHE_SECONDS = 300;
const COORD_TRANSPORT_FORM_CACHE_SECONDS = 60; // form rows + portal uploads: short, so a reload soon after an upload shows it
const COORD_TRANSPORT_TAB_UPLOADS = 'Portal Uploads'; // written by transport-uploads.gs (Roster project): Uploaded On | Reg | Paper | File ID | Link | Uploaded By | ... | Status

function coordTransportDate_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  const s = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // form sheet text: m/d/yyyy
  return m ? m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2) : '';
}

/** {docs: {'REG|type': 'yyyy-MM-dd'}, links: {'REG|type': url of the uploaded certificate}, regs, rows, uploads}: newest valid-till per bus and
 *  document in the form responses, and the newest portal upload per bus and document ({'REG|type': {at, by, link, id}}). */
function coordTransportLive_() {
  const hit = coordCacheGetBig_('coord_transport_live_v3');
  if (hit) return hit;
  const ss = SpreadsheetApp.openById(COORD_TRANSPORT_FORM_ID);
  const sh = ss.getSheets().filter(function (s) { return s.getSheetId() === COORD_TRANSPORT_FORM_GID; })[0];
  if (!sh) throw new Error('Transport form responses tab not found'); // never mistake an unreadable source for "nothing uploaded"
  const rows = sh.getDataRange().getValues(), tz = ss.getSpreadsheetTimeZone();
  const docs = {}, links = {}, regs = {};
  for (let i = 1; i < rows.length; i++) {
    const reg = String(rows[i][1] || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const type = COORD_TRANSPORT_FORM_TYPES[String(rows[i][2] || '').trim().toUpperCase()];
    const date = coordTransportDate_(rows[i][3], tz);
    if (!reg) continue;
    regs[reg] = true;
    if (!type || !date) continue;
    const k = reg + '|' + type, url = (String(rows[i][4] || '').match(/https?:\/\/[^\s,;]+/) || [''])[0]; // the form's 'Upload certificate' column
    if (!docs[k] || date > docs[k]) { docs[k] = date; links[k] = url; } else if (date === docs[k] && !links[k]) links[k] = url;
  }
  const uploads = {}, up = ss.getSheetByName(COORD_TRANSPORT_TAB_UPLOADS); // optional: no tab until the first portal upload
  (up ? up.getDataRange().getValues().slice(1) : []).forEach(function (r) {
    const at = r[0] instanceof Date ? r[0].toISOString() : '', k = String(r[1]) + '|' + String(r[2]);
    if (!at || String(r[9]).trim().toLowerCase() === 'withdrawn') return;
    if (!uploads[k] || at > uploads[k].at) uploads[k] = { at: at, by: String(r[5]), link: String(r[4]), id: String(r[3]) };
  });
  const live = { docs: docs, links: links, regs: Object.keys(regs), rows: rows.length - 1, uploads: uploads };
  coordCachePutBig_('coord_transport_live_v3', live, COORD_TRANSPORT_FORM_CACHE_SECONDS);
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
    fleet.push([b.reg, b.bus, b.campus, b.operational ? 'yes' : 'no', b.route || '', b.start || '', b.driver || '', b.seats || '', b.year || '', b.driverCode || '', b.driverStatus || '', b.driverRosterName || '']);
    Object.keys(b.docs || {}).forEach(function (k) {
      const d = b.docs[k];
      if (!label[k]) return;
      docs.push([b.reg, label[k], d.na ? '' : d.date, d.na ? 'n/a' : (d.src === 'override' ? 'override' : d.src === 'reread' ? 'reread' : 'read'),
        d.src === 'override' ? 'overrides note' : d.src === 'reread' ? 'drive scan (re-read)' : 'drive scan', d.file || '', d.link || '', d.note || '']);
    });
    (b.unreadable || []).forEach(function (u) {
      if (label[u.key]) docs.push([b.reg, label[u.key], '', 'unread', 'drive scan', u.file || '', u.link || '', 'LM Studio could not read a date']);
    });
    // second-pass outcomes: the right paper with no expiry printed, and scans that are not the paper their folder says
    (b.noexpiry || []).forEach(function (u) { if (label[u.key]) docs.push([b.reg, label[u.key], '', 'no expiry', 'drive scan', u.file || '', u.link || '', u.note || '']); });
    (b.other || []).forEach(function (u) { if (label[u.key]) docs.push([b.reg, label[u.key], '', 'other document', 'drive scan', u.file || '', u.link || '', u.note || '']); });
  });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.openById(COORD_TRANSPORT_FORM_ID);
    coordTransportWriteTab_(ss, COORD_TRANSPORT_TAB_FLEET, ['Reg', 'Bus', 'Campus', 'Running', 'Route', 'Start point', 'Driver', 'Seats', 'Year', 'Driver code', 'Driver link to staff master', 'Staff master name'], fleet);
    if (Array.isArray(p.people) && p.people.length) {
      coordTransportWriteTab_(ss, COORD_TRANSPORT_TAB_PEOPLE, ['Name', 'Campus', 'Designation', 'Employee code', 'Link to staff master', 'Staff master name', 'Staff master campus', 'Buses'],
        p.people.map(function (q) { return [q.name, q.campus, q.designation, q.code, q.status, q.rosterName || '', q.rosterCampus || '', (q.vehicles || []).join(', ')]; }));
    }
    coordTransportWriteTab_(ss, COORD_TRANSPORT_TAB_DOCS, ['Reg', 'Document', 'Valid to', 'Status', 'Source', 'File', 'Link', 'Note'], docs);
    if (Array.isArray(p.pnl) && p.pnl.length) {
      coordTransportWriteTab_(ss, COORD_TRANSPORT_TAB_PNL, ['Reg', 'Campus', 'Month', 'Fee collected', 'Fuel', 'Loan interest', 'Fixed costs', 'Driver and helper pay', 'Note'],
        p.pnl.map(function (r) { return [r.reg, r.campus, r.month, r.fee, r.fuel, r.loan, r.fixed, r.pay, r.note || '']; }));
    }
    coordTransportWriteTab_(ss, COORD_TRANSPORT_TAB_SYNC, ['Key', 'Value'], [
      ['syncedAt', p.syncedAt], ['pushedAt', new Date().toISOString()], ['vehicles', String(fleet.length)],
      ['documents', String(docs.length)], ['warnings', (p.warnings || []).join(' | ')],
      ['seen', (p.seen || []).join(',')]]); // every bus scan file id the AI Coordinator has read: clears "waiting to be read". ponytail: one cell (50k chars) holds ~1,400 ids; split it when the bus scans pass ~1,200
  } finally { lock.releaseLock(); }
  const cache = CacheService.getScriptCache();
  ['coord_transport_base'].forEach(function (k) { cache.remove(k); });
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
    return { reg: String(r[0]), bus: r[1], campus: String(r[2]), operational: r[3] === 'yes', route: r[4], start: r[5], driver: r[6], seats: r[7], year: r[8], driverCode: String(r[9] || ''), driverStatus: String(r[10] || ''), driverRosterName: String(r[11] || ''), docs: {}, unreadable: [], noexpiry: [], other: [] };
  });
  const byReg = {}, keyOf = {};
  fleet.forEach(function (b) { byReg[b.reg] = b; });
  COORD_TRANSPORT_DOCS.forEach(function (d) { keyOf[d[1]] = d[0]; });
  docRows.forEach(function (r) {
    const b = byReg[String(r[0])], key = keyOf[String(r[1])], status = String(r[3]);
    if (!b || !key) return;
    if (status === 'unread') b.unreadable.push({ key: key, file: String(r[5]), link: String(r[6]) });
    else if (status === 'no expiry') b.noexpiry.push({ key: key, file: String(r[5]), link: String(r[6]), note: String(r[7]) });
    else if (status === 'other document') b.other.push({ key: key, file: String(r[5]), link: String(r[6]), note: String(r[7]) });
    else if (status === 'n/a') b.docs[key] = { na: true, date: '', src: 'override', note: String(r[7]), file: '', link: '' };
    else b.docs[key] = { date: coordTransportDate_(r[2], tz), src: status === 'override' ? 'override' : status === 'reread' ? 'reread' : 'drive', file: String(r[5]), link: String(r[6]), note: String(r[7]) };
  });
  const pnlSheet = ss.getSheetByName(COORD_TRANSPORT_TAB_PNL); // optional: older pushes had no money
  const pnl = pnlSheet ? pnlSheet.getDataRange().getValues().slice(1).map(function (r) {
    return { reg: String(r[0]), campus: String(r[1]), month: String(r[2]), fee: Number(r[3]) || 0, fuel: Number(r[4]) || 0, loan: Number(r[5]) || 0,
      fixed: Number(r[6]) || 0, pay: Number(r[7]) || 0, note: String(r[8] || '') };
  }) : [];
  const peopleSheet = ss.getSheetByName(COORD_TRANSPORT_TAB_PEOPLE); // optional, like the P&L tab
  const people = peopleSheet ? peopleSheet.getDataRange().getValues().slice(1).map(function (r) {
    return { name: String(r[0]), campus: String(r[1]), designation: String(r[2]), code: String(r[3]), status: String(r[4]), rosterName: String(r[5]), rosterCampus: String(r[6]), vehicles: String(r[7]).split(', ').filter(String) };
  }) : [];
  const seen = meta.seen ? meta.seen.split(',') : [];
  docRows.forEach(function (r) { const id = (String(r[6]).match(/[-\w]{25,}/) || [''])[0]; if (id) seen.push(id); }); // pushes from before the seen list
  const base = { syncedAt: meta.syncedAt || '', warnings: meta.warnings ? meta.warnings.split(' | ') : [], fleet: fleet, pnl: pnl, people: people, seen: seen };
  coordCachePutBig_('coord_transport_base', base, COORD_TRANSPORT_LIVE_CACHE_SECONDS);
  return base;
}

/** The fleet with each document resolved to {date, src, link, unread}: the form if it is at least as new as the scan-read date, else the scan. */
function coordTransportFleet_() {
  const base = coordTransportBase_(), live = coordTransportLive_();
  const formDocs = live.docs || {}, formLinks = live.links || {}, uploads = live.uploads || {}; // tolerate an entry cached in an older shape
  const seen = {};
  (base.seen || []).forEach(function (id) { seen[id] = true; });
  const fleet = base.fleet.map(function (b) {
    const docs = {};
    COORD_TRANSPORT_DOCS.forEach(function (d) {
      const sc = (b.docs || {})[d[0]], l = formDocs[b.reg + '|' + d[0]] || '';
      const doc = l && (!sc || l >= sc.date) ? { date: l, src: 'form', link: formLinks[b.reg + '|' + d[0]] || '' }
        : sc ? { date: sc.date, src: sc.src || 'drive', link: sc.link, na: !!sc.na, note: sc.note || '' } : { date: '', src: '', link: '' };
      // scans of this type whose date LM Studio could not read; one of them may be the renewal
      const of = function (list) { return (list || []).filter(function (u) { return u.key === d[0]; }).map(function (u) { return { file: u.file, link: u.link, note: u.note || '' }; }); };
      doc.unread = of(b.unreadable);
      doc.noexp = of(b.noexpiry);  // the right paper, but it prints no expiry (a speed governor fitment certificate, say)
      doc.other = of(b.other);     // a scan whose content is not the paper its folder says (a refusal letter, an initial compliance certificate...)
      const u = uploads[b.reg + '|' + d[0]];
      if (u && !seen[u.id]) doc.pending = { at: u.at, by: u.by, link: u.link }; // uploaded from a portal, not read by LM Studio yet
      docs[d[0]] = doc;
    });
    const n = String(b.campus).replace(/\D/g, ''); // roster says 'LMS-5' in one row
    return { reg: b.reg, bus: b.bus, campus: 'LMS ' + n, campusId: 'LMS' + n, operational: b.operational,
      route: b.route, driver: b.driver, seats: b.seats, driverCode: b.driverCode || '', driverStatus: b.driverStatus || '', driverRosterName: b.driverRosterName || '', docs: docs };
  });
  const known = {};
  base.fleet.forEach(function (b) { known[b.reg] = true; });
  return { fleet: fleet, base: base, live: live, unknown: (live.regs || []).filter(function (r) { return !known[r]; }) };
}

// action=coordinatortransport
function coordTransport_(caller) {
  const t0 = Date.now();
  const all = coordTransportFleet_();
  const visible = coordVisibleCampuses_(caller), clerk = !!caller.feeClerkOnly; // Fee Clerks see the papers only: no money, no staff list
  return {
    success: true, generated: new Date().toISOString(), serverMs: Date.now() - t0, formRows: all.live.rows, unknown: all.unknown, // serverMs: shown on the page so slow loads are visible
    syncedAt: all.base.syncedAt, warnings: all.base.warnings,
    people: clerk ? [] : (all.base.people || []).filter(function (q) { return !visible || visible.indexOf('LMS' + q.campus.replace(/\D/g, '')) !== -1; }),
    pnl: clerk ? [] : (all.base.pnl || []).filter(function (r) { return !visible || visible.indexOf('LMS' + r.campus.replace(/\D/g, '')) !== -1; }),
    docs: COORD_TRANSPORT_DOCS.map(function (d) { return { key: d[0], label: d[1] }; }),
    fleet: all.fleet.filter(function (b) { return !visible || visible.indexOf(b.campusId) !== -1; }),
  };
}

// ── Follow-ups switched off (2026-10-07): the Transport page's tables carry everything, and alerts will come back in a different
// form. The adapter that raised transport_expired / transport_due / transport_missing tasks is in git history (commit 1a192f9).
// The first task listing after this deploy resolves the ones still open, then never runs again; delete this once that has happened.
function coordTransportRetireTasks_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('TRANSPORT_TASKS_RETIRED')) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = coordSheet_();
    const rows = sh.getDataRange().getValues(), now = new Date();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][1]).indexOf('transport_') !== 0 || rows[i][5] !== 'open') continue;
      sh.getRange(i + 1, 6).setValue('resolved');
      sh.getRange(i + 1, 10, 1, 2).setValues([[now, 'system (transport follow-ups switched off)']]);
    }
    props.setProperty('TRANSPORT_TASKS_RETIRED', '1');
  } finally { lock.releaseLock(); }
}

/** Run from the Apps Script editor (Run > coordTransportCheck) after a push to see what the Transport page would load.
 *  Private (trailing _) functions cannot be run from the editor. */
function coordTransportCheck() {
  const all = coordTransportFleet_();
  console.log('scan data synced at ' + all.base.syncedAt + ': ' + all.fleet.length + ' vehicles, ' + all.live.rows + ' form rows, unknown vehicles in form: ' + (all.unknown.join(', ') || 'none'));
  console.log('override warnings: ' + (all.base.warnings.join('; ') || 'none'));
}

// ── Live bus positions (GPS, Blackbox trackmaster.in) ─────────────────
// action=coordinatorbuslive: where every bus is now, joined to the fleet roster (campus, route, driver) and scoped like the
// rest of this page (Fee Clerks: own campus). The vendor's live-status call needs only the customer id, no login -- a vendor
// flaw we have reported -- so the id is a Script property (TRACKMASTER_CUSTID, set once with action=transportgpsconfig), never in
// this public repo, and browsers never call the vendor themselves. History (every GPS point) is archived on the Mac
// (~/Projects/transport-gps), not here: a year of points is ~1M rows, too many for a sheet.
const COORD_BUS_LIVE_URL = 'https://api1.trackmaster.in/api/LiveStatus/LiveStatusWithAjax';
const COORD_BUS_LIVE_CACHE_SECONDS = 45; // the devices report about once a minute while moving

/** '24-Oct-2026 10:00:14 AM' (India time) -> ISO 8601 with +05:30, or '' */
function coordBusTime_(s) {
  const M = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
  const m = String(s || '').trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) ?([AP]M)$/i);
  if (!m || !M[m[2]]) return '';
  const h = (+m[4] % 12) + (/p/i.test(m[7]) ? 12 : 0), p = function (n) { return ('0' + n).slice(-2); };
  return m[3] + '-' + p(M[m[2]]) + '-' + p(m[1]) + 'T' + p(h) + ':' + m[5] + ':' + m[6] + '+05:30';
}

/** The vendor's live rows -> [{reg, lat, lng, speed, at, state, place, kmToday, bbid}] (rows without a position are dropped). */
function coordBusParse_(rows) {
  return (rows || []).map(function (r) {
    return { reg: String(r.VehicleName || '').toUpperCase().replace(/[^A-Z0-9]/g, ''), lat: parseFloat(r.Latitude), lng: parseFloat(r.Longitude),
      speed: Number(r.Speed) || 0, at: coordBusTime_(r.DateTime), state: String(r.ProgressStatus || ''),
      place: String(r.LocationWithoutLink || '').replace(/\s+/g, ' ').trim(), kmToday: Number(r.Distance) || 0, bbid: String(r.BBID || '') };
  }).filter(function (b) { return b.reg && isFinite(b.lat) && isFinite(b.lng) && (b.lat || b.lng); });
}

function coordBusFetch_() {
  const cache = CacheService.getScriptCache(), hit = cache.get('coord_bus_live_v1');
  if (hit) return JSON.parse(hit);
  const custid = String(PropertiesService.getScriptProperties().getProperty('TRACKMASTER_CUSTID') || '').trim();
  if (!custid) throw new Error('GPS tracking is not set up yet (TRACKMASTER_CUSTID)');
  // the API 404s unless the full DataTables parameter set is sent
  const cols = ['Sno', '1', '2', '3', 'DateTime', 'Location', '6', '7', 'Distance', '9', '10', '11', '12', '13', '', '15'];
  const q = { sEcho: 1, iColumns: cols.length, sColumns: new Array(cols.length).join(','), iDisplayStart: 0, iDisplayLength: 500, sSearch: '', bRegex: 'false',
    iSortCol_0: 3, sSortDir_0: 'desc', iSortingCols: 1, custid: custid, StatusCode: '', type: 0 };
  cols.forEach(function (c, i) { q['mDataProp_' + i] = c; q['sSearch_' + i] = ''; q['bRegex_' + i] = 'false'; q['bSearchable_' + i] = 'true'; q['bSortable_' + i] = c ? 'true' : 'false'; });
  const url = COORD_BUS_LIVE_URL + '?' + Object.keys(q).map(function (k) { return k + '=' + encodeURIComponent(q[k]); }).join('&');
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('The GPS provider did not answer (HTTP ' + res.getResponseCode() + ')');
  const out = { at: new Date().toISOString(), buses: coordBusParse_(JSON.parse(res.getContentText()).aaData) };
  cache.put('coord_bus_live_v1', JSON.stringify(out), COORD_BUS_LIVE_CACHE_SECONDS);
  return out;
}

function coordBusLive_(caller) {
  const live = coordBusFetch_(), fleet = coordTransportFleet_().fleet, visible = coordVisibleCampuses_(caller), by = {};
  fleet.forEach(function (b) { by[b.reg] = b; });
  return { success: true, fetchedAt: live.at, buses: live.buses.map(function (g) {
    const b = by[g.reg] || {};
    return Object.assign(g, { campus: b.campus || '', campusId: b.campusId || '', route: b.route || '', driver: b.driver || '', operational: b.reg ? !!b.operational : null });
  }).filter(function (g) { return !visible || visible.indexOf(g.campusId) !== -1; }) }; // a bus missing from the roster is shown to the Owner only
}

/** POST action=transportgpsconfig {secret, custid}: stores the GPS customer id (same shared secret as the push). */
function coordBusConfig_(body) {
  if (!coordTransportSecretOk_(body.secret)) return { success: false, error: 'Not authorized' };
  if (!/^\d{3,10}$/.test(String(body.custid || ''))) return { success: false, error: 'custid must be digits' };
  PropertiesService.getScriptProperties().setProperty('TRACKMASTER_CUSTID', String(body.custid));
  return { success: true };
}

// ── Safety loadout (transport game Phase 1a): what every bus must carry, kept by the Owner ──
// Tab 'Safety Loadout' in the transport workbook. The Owner edits it from the Owner portal (POST below); the capture portal's
// Inspection mode shows one card per active item. Item IDs are for life: inspection answers and bus_equipment follow-ups are
// keyed by them, so a rename keeps the ID, an item is switched off (never deleted), and a new item gets an ID no answer has
// ever used. The seed below is the default for an empty tab: the first read writes it into the tab (so the capture server,
// another project, can check answers against real IDs); from then on the tab is the list.
// GET  action=coordinatortransportloadout  every transport role: {items:[{id,label,needsPhoto,needsDate,order}] (active only),
//                                           version}; the Owner also gets `all` (with `active`) for the editor
// POST action=coordinatortransportloadout  Owner only: {version, items:[{id?,label,needsPhoto,needsDate,active}]} in display
//                                           order. Every known id must come back; new items come without one; `version` must be
//                                           the one the editor loaded, else "The list changed since you opened it".
const COORD_TRANSPORT_TAB_LOADOUT = 'Safety Loadout';
const COORD_LOADOUT_HEADER = ['Item ID', 'Label', 'Needs photo', 'Needs date', 'Order', 'Active'];
const COORD_LOADOUT_SEED = [ // [id, label, needs photo, needs date]: the date is the speed governor's certificate date, the extinguisher's refill date
  ['gps_tracker', 'GPS tracker', false, false], ['speed_governor', 'Speed governor (40 km/h)', true, true],
  ['cctv', 'CCTV camera', false, false], ['first_aid', 'First-aid box', true, false],
  ['fire_extinguisher', 'Fire extinguisher', true, true], ['window_grills', 'Window grills', false, false],
  ['emergency_exit', 'Emergency exit', false, false], ['door_lock', 'Door lock', false, false],
  ['school_name_phone', 'School name and phone painted', true, false], ['attendant', 'Attendant on board', false, false]];
const COORD_LOADOUT_MAX = 40;
const COORD_TRANSPORT_TAB_CAPTURE = 'Capture Runs'; // written by transport-capture.gs (Roster project) in this same workbook
const COORD_LOADOUT_STALE = 'The list changed since you opened it. Reload, then save again.';

/** An item id as stored: lower case, a-z 0-9 _ only (a hand-typed 'Seat-Belts ' reads as 'seat_belts'). Same rule in transport-capture.gs. */
function coordLoadoutId_(v) { return String(v || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40); }
/** A label as stored: one line, at most 80 characters, never starting like a spreadsheet formula. */
function coordLoadoutLabel_(v) { return String(v || '').replace(/\s+/g, ' ').trim().replace(/^[=+\-@\s]+/, '').slice(0, 80); }

/** Every loadout item in display order, with `active`. An empty tab gets the seed written into it first. */
function coordLoadoutAll_() {
  const ss = SpreadsheetApp.openById(COORD_TRANSPORT_FORM_ID), sh = ss.getSheetByName(COORD_TRANSPORT_TAB_LOADOUT);
  const rows = sh ? sh.getDataRange().getValues().slice(1).filter(function (r) { return coordLoadoutId_(r[0]); }) : [];
  const yes = function (v) { return v === true || /^(yes|true|y)$/i.test(String(v).trim()); };
  if (!rows.length) {
    coordTransportWriteTab_(ss, COORD_TRANSPORT_TAB_LOADOUT, COORD_LOADOUT_HEADER,
      COORD_LOADOUT_SEED.map(function (x, i) { return [x[0], x[1], x[2] ? 'yes' : 'no', x[3] ? 'yes' : 'no', String(i + 1), 'yes']; }));
    return COORD_LOADOUT_SEED.map(function (x, i) { return { id: x[0], label: x[1], needsPhoto: x[2], needsDate: x[3], order: i + 1, active: true }; });
  }
  return rows.map(function (r, i) {
    return { id: coordLoadoutId_(r[0]), label: coordLoadoutLabel_(r[1]), needsPhoto: yes(r[2]), needsDate: yes(r[3]), order: Number(r[4]) || i + 1,
      active: String(r[5]).trim() === '' || yes(r[5]) }; // a row typed into the sheet by hand with Active left blank counts as active
  }).sort(function (a, b) { return a.order - b.order; });
}

/** A short fingerprint of the whole list: the editor sends back the one it loaded, so a stale tab cannot overwrite newer edits. */
function coordLoadoutVersion_(all) {
  const t = JSON.stringify(all);
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0;
  return h.toString(36) + '.' + t.length;
}

function coordLoadout_(caller) {
  const all = coordLoadoutAll_(), owner = caller.roles.indexOf('Owner') !== -1;
  const items = all.filter(function (x) { return x.active; }).map(function (x) { return { id: x.id, label: x.label, needsPhoto: x.needsPhoto, needsDate: x.needsDate, order: x.order }; });
  const out = { success: true, items: items, version: coordLoadoutVersion_(all) };
  if (owner) out.all = all;
  return out;
}

function coordLoadoutSet_(caller, body) {
  if (caller.roles.indexOf('Owner') === -1) return { success: false, error: 'Only the Owner edits the safety loadout' };
  const list = body.items;
  if (!Array.isArray(list) || !list.length || list.length > COORD_LOADOUT_MAX) return { success: false, error: 'Send 1 to ' + COORD_LOADOUT_MAX + ' items' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const current = coordLoadoutAll_(), known = {}, taken = {}, used = {}, rows = [];
    if (String(body.version || '') !== coordLoadoutVersion_(current)) return { success: false, error: COORD_LOADOUT_STALE };
    current.forEach(function (x) { known[x.id] = true; taken[x.id] = true; });
    (coordInspections_() || []).forEach(function (r) { Object.keys(r.items).forEach(function (k) { taken[coordLoadoutId_(k)] = true; }); }); // ids answers ever used
    for (let i = 0; i < list.length; i++) {
      const x = list[i] || {}, label = coordLoadoutLabel_(x.label), sent = x.id != null && String(x.id).trim() !== '';
      if (!label) return { success: false, error: 'Item ' + (i + 1) + ' has no name' };
      let id = sent ? String(x.id).trim() : '';
      if (sent && !known[id]) return { success: false, error: 'Unknown item id: ' + id + '. New items are sent without an id.' };
      if (!sent) {
        const base = coordLoadoutId_(label).slice(0, 32) || 'item';
        id = base;
        for (let n = 2; taken[id] || used[id]; n++) id = base + '_' + n;
      }
      if (used[id]) return { success: false, error: '"' + label + '" is in the list twice' };
      used[id] = true;
      rows.push([id, label, x.needsPhoto === true ? 'yes' : 'no', x.needsDate === true ? 'yes' : 'no', String(i + 1), x.active === false ? 'no' : 'yes']);
    }
    const missing = Object.keys(known).filter(function (id) { return !used[id]; });
    if (missing.length) return { success: false, error: 'An item cannot be removed, only switched off: switch it off instead (missing: ' + missing.join(', ') + ').' };
    coordTransportWriteTab_(SpreadsheetApp.openById(COORD_TRANSPORT_FORM_ID), COORD_TRANSPORT_TAB_LOADOUT, COORD_LOADOUT_HEADER, rows);
  } finally { lock.releaseLock(); }
  const all = coordLoadoutAll_();
  return { success: true, all: all, version: coordLoadoutVersion_(all) };
}

/** Finished safety checks from the capture portal: [{reg, runId, day: 'yyyy-MM-dd' (India), by, items: {itemId: {ok, date?, fileId?}}}],
 *  or null when the Capture Runs tab is missing (unknown, which is not "no checks": nothing may close on it).
 *  Counts only runs of kind 'inspection' whose end manifest arrived (Status 'ended') with answers in it. Only ok === true is
 *  present: a hand-edited "true" or 1 reads as missing. */
function coordInspections_() {
  const sh = SpreadsheetApp.openById(COORD_TRANSPORT_FORM_ID).getSheetByName(COORD_TRANSPORT_TAB_CAPTURE);
  if (!sh) return null;
  const day = function (v) { // the phone sends ms since 1970; a hand-edited cell may be a Date or ISO text
    const d = v instanceof Date ? v : /^\d+$/.test(String(v).trim()) ? new Date(Number(v)) : new Date(String(v));
    return isNaN(d.getTime()) ? '' : Utilities.formatDate(d, 'Asia/Kolkata', 'yyyy-MM-dd');
  };
  const out = [];
  sh.getDataRange().getValues().slice(1).forEach(function (r) { // Run ID | Reg | Campus | Kind | Started | Ended | By | ... | Inspection JSON (12th) | Status | Frame Times | Captured By
    if (String(r[3]) !== 'inspection' || String(r[12]) !== 'ended') return;
    let raw = null;
    try { raw = JSON.parse(String(r[11] || 'null')); } catch (e) { raw = null; }
    const items = {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) Object.keys(raw).forEach(function (k) {
      const a = raw[k];
      if (!a || typeof a !== 'object') return;
      items[k] = { ok: a.ok === true };
      if (a.ok === true && a.date) items[k].date = String(a.date);
      if (a.ok === true && a.fileId) items[k].fileId = String(a.fileId);
    });
    const d = day(r[5] || r[4]);
    // by: who did the check (Captured By), else the sender (By: a row from before the column); the shared phone, Ruling 41
    if (Object.keys(items).length && d) out.push({ reg: String(r[1]), runId: String(r[0]), day: d, by: String(r[14] || r[6] || ''), items: items });
  });
  return out;
}

// ── Fleet setup quests (transport game Phase 1a): the staff questionnaire as six quests per bus ──
// Papers, safety, parts, driver, fuel and capture. The quest definitions and the pure logic (validation, the 60+ driver rule,
// completion, missions) are coordinator/capture/fleet-quests.js (FleetQuests): projects.json deploys it into this project and
// the setup page (coordinator/transport/setup.html) loads the same file; FleetQuests.applySave makes the write on both. Data
// lives in four tabs of this private transport workbook; the first three are machine-kept and rewritten whole under the
// script lock (a few hundred rows), Workshops is edited in place (people fill it in):
//   Fleet Profile   one row per reg: the papers, safety, fuel and capture quests, each as JSON, and `saved`: per quest who saved
//                   it last and who saved the data that completed it (the mission's doneBy)
//   Driver Profile  one row per driver (employee code; 'bus:<REG>' when the roster has none): the driver card as JSON, ageLimit
//   Parts History   one row per reg x component (the day book's component ids): that part's fields as JSON
//   Workshops       one row per workshop named in a quest (the questionnaire's column names), with the buses that go there; the
//                   other columns are the Owner's, filled by hand, and never touched
// Driver personal data (date of birth, licence, phone) lives only here and is served only within the caller's campuses.
// Photos (odometer, driver) are uploaded first through the Roster's capturefile (kind 'profile'); a quest holds their file ids.
// GET  action=coordinatortransportfleet      every transport role: {rows:{fleet, profiles, drivers, parts, inspected, captured},
//                                             campuses, owner, today}, only the caller's campuses (Fee Clerk: own campus;
//                                             Coordinator: their district, ALL every campus; Owner: all)
// POST action=coordinatortransportfleetsave  {reg, quest, fields}: one quest at a time, the whole quest (parts: the parts sent),
//                                             same scope -> {success} (driver: + ageLimit, and a warning when 60 or over)
const COORD_FLEET_TABS = { profile: 'Fleet Profile', driver: 'Driver Profile', parts: 'Parts History', workshops: 'Workshops' };
const COORD_FLEET_COLS = { // saved: per quest {by, at, doneBy?, doneAt?}: the last save, and the save that completed it (mission doneBy)
  profile: ['reg', 'campus', 'papers', 'safety', 'fuel', 'capture', 'saved'],
  driver: ['driverKey', 'reg', 'campus', 'driver', 'fields', 'ageLimit', 'updatedAt', 'updatedBy'],
  parts: ['reg', 'campus', 'component', 'fields', 'updatedAt', 'updatedBy'] };
const COORD_ALL_CAMPUSES = ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6'];

function coordFleetToday_() { return Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd'); }

/** The running buses of the roster push: reg as A-Z 0-9 only, campus as 'LMS n' and campusId 'LMSn' (the roster says 'LMS-5' in one row). */
function coordFleetBuses_() {
  return coordTransportBase_().fleet.filter(function (b) { return b.operational; }).map(function (b) {
    const n = String(b.campus).replace(/\D/g, '');
    return { reg: FleetQuests.normReg(b.reg), campus: 'LMS ' + n, campusId: 'LMS' + n, route: String(b.route || ''), driver: String(b.driver || ''), driverCode: b.driverCode || '', seats: b.seats, operational: true };
  });
}

/** {reg: {by, at}} for the given regs: the first ended safety check (Capture Runs) and the first processed route timelapse
 *  (Capture Stops), with who captured it (the safety and capture quests' credit when the run itself completes the quest). */
function coordFleetDone_(regs) {
  const inspected = {}, captured = {}, cap = gpsCaptured_();
  (coordInspections_() || []).forEach(function (x) {
    const r = FleetQuests.normReg(x.reg);
    if (regs[r] && (!inspected[r] || x.day < inspected[r].at)) inspected[r] = { by: x.by, at: x.day };
  });
  Object.keys(cap).forEach(function (x) { const r = FleetQuests.normReg(x); if (regs[r]) captured[r] = cap[x]; });
  return { inspected: inspected, captured: captured };
}

function coordFleet_(caller) {
  const vis = coordVisibleCampuses_(caller), T = COORD_FLEET_TABS, regs = {}, keys = {}, mine = function (r) { return regs[FleetQuests.normReg(r.reg)]; };
  const fleet = coordFleetBuses_().filter(function (b) { return !vis || vis.indexOf(b.campusId) !== -1; });
  fleet.forEach(function (b) { regs[b.reg] = true; keys[FleetQuests.driverKey(b)] = true; });
  const done = coordFleetDone_(regs);
  return { success: true, today: coordFleetToday_(), campuses: vis || COORD_ALL_CAMPUSES, owner: caller.roles.indexOf('Owner') !== -1,
    rows: { fleet: fleet, inspected: done.inspected, captured: done.captured,
      profiles: gpsRows_(T.profile).filter(mine),
      drivers: gpsRows_(T.driver).filter(function (r) { return keys[r.driverKey]; }),
      parts: gpsRows_(T.parts).filter(mine) } };
}

function coordFleetSave_(caller, body) {
  const fail = function (m) { return { success: false, error: m }; };
  const reg = FleetQuests.normReg(body.reg), quest = String(body.quest || '');
  const bus = coordFleetBuses_().filter(function (b) { return b.reg === reg; })[0];
  if (!bus) return fail('Vehicle ' + (reg || '(none)') + ' is not in the fleet');
  const vis = coordVisibleCampuses_(caller);
  if (vis && vis.indexOf(bus.campusId) === -1) return fail('You can only set up buses of your own campuses');
  const v = FleetQuests.validateQuest(quest, body.fields, coordFleetToday_());
  if (v.error) return fail(v.error);
  const T = COORD_FLEET_TABS, C = COORD_FLEET_COLS, one = {};
  one[reg] = true;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const done = coordFleetDone_(one);
    const rows = { fleet: [bus], profiles: gpsRows_(T.profile), drivers: gpsRows_(T.driver), parts: gpsRows_(T.parts), inspected: done.inspected, captured: done.captured };
    FleetQuests.applySave(rows, reg, quest, v.fields, { by: caller.email, at: new Date().toISOString(), ageLimit: v.ageLimit }); // the same write the page makes
    gpsWrite_(T.profile, C.profile, rows.profiles); // machine-kept tabs, rewritten whole (a few hundred rows)
    if (quest === 'driver') gpsWrite_(T.driver, C.driver, rows.drivers);
    if (quest === 'parts') gpsWrite_(T.parts, C.parts, rows.parts);
    coordFleetWorkshops_(reg, quest, v.fields);
  } finally { lock.releaseLock(); }
  const out = { success: true };
  if (quest === 'driver') { out.ageLimit = v.ageLimit; if (v.warning) out.warning = v.warning; }
  return out;
}

/** A workshop named in the papers (usual workshop) or a part joins the Workshops tab, with the bus in its list. The tab is filled in
 *  by hand too, so it is never rewritten: an existing workshop's row gets only its buses cell set, a new one is appended with
 *  only its name and bus, and the header is written only when the tab is new. Columns are found by their header text. */
function coordFleetWorkshops_(reg, quest, fields) {
  const names = [];
  if (quest === 'papers' && fields.usualWorkshop) names.push(fields.usualWorkshop);
  if (quest === 'parts') Object.keys(fields).forEach(function (k) { if (fields[k].workshop) names.push(fields[k].workshop); });
  if (!names.length) return;
  const cols = FleetQuests.questConfig().workshopCols, ss = SpreadsheetApp.openById(COORD_TRANSPORT_FORM_ID);
  let sh = ss.getSheetByName(COORD_FLEET_TABS.workshops);
  if (!sh) { sh = ss.insertSheet(COORD_FLEET_TABS.workshops); sh.appendRow(cols); sh.setFrozenRows(1); }
  const v = sh.getDataRange().getValues(), head = (v[0] || []).map(function (h) { return String(h).trim(); });
  const iName = head.indexOf(cols[0]), iBus = head.indexOf(cols[4]);
  if (iName === -1 || iBus === -1) return; // the columns were renamed by hand: leave the tab alone
  names.forEach(function (n) {
    const name = coordLoadoutLabel_(n);
    if (!name) return;
    let at = -1;
    for (let i = 1; i < v.length; i++) if (String(v[i][iName]).trim().toLowerCase() === name.toLowerCase()) { at = i; break; }
    if (at === -1) {
      const row = head.map(function () { return ''; });
      row[iName] = name; row[iBus] = reg;
      sh.appendRow(row); v.push(row);
      return;
    }
    const buses = String(v[at][iBus] || '').split(/,\s*/).filter(String);
    if (buses.indexOf(reg) !== -1) return;
    buses.push(reg);
    v[at][iBus] = buses.join(', ');
    sh.getRange(at + 1, iBus + 1).setValue(v[at][iBus]);
  });
}
