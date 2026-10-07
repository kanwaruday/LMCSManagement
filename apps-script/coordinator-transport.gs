// ═══════════════════════════════════════════════════════════════════
// Coordinator Backend -- Transport department (second file of the same
// "LMCS Coordinator Backend" Apps Script project, next to coordinator.gs and
// the generated coordinator-transport-data.gs).
//
// Fleet document compliance: for every running school vehicle, the newest expiry date of
// insurance, fitness, MV tax, pollution, route permit and speed governor. Baseline =
// COORD_TRANSPORT_FLEET (generated from the fleet workbook + Drive index); live = the
// "LMCS Transport Document Submission Form" responses sheet, read on every refresh, so a
// renewal uploaded through the form lands here without regenerating anything.
//
// Powers GET action=coordinatortransport (the Transport page) and the transport adapter
// (follow-up tasks: expired / due soon / no record, one per campus per month).
//
// ponytail: fleet roster (campus, route, driver, running or not) is a generated constant,
// so a bus moving campus or a driver change needs export_to_coordinator.py re-run and the
// data file re-pasted. Move it to a sheet if that happens more than a few times a year.
// ═══════════════════════════════════════════════════════════════════

const COORD_TRANSPORT_FORM_ID = '1VXTMZjqCS82ftB1rwoN4BzoiOTP7-Vg0m5vTH01Tfzc'; // "LMCS TRANSPORT DOCUMENT SUBMISSION FORM (Responses)"
const COORD_TRANSPORT_FORM_GID = 1365845375;                                   // its responses tab
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

/** {'REG|type': 'yyyy-MM-dd'} newest valid-till per bus and document in the form responses, plus the registrations seen. */
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

/** The fleet with each document resolved to {date, src}: the form if it is newer than the baseline, else the baseline. */
function coordTransportFleet_() {
  const live = coordTransportLive_();
  const fleet = COORD_TRANSPORT_FLEET.map(function (b) {
    const docs = {};
    COORD_TRANSPORT_DOCS.forEach(function (d) {
      const base = b.docs[d[0]] || ['', ''], l = live.docs[b.reg + '|' + d[0]] || '';
      docs[d[0]] = l && l >= base[0] ? { date: l, src: 'form' } : { date: base[0], src: base[1] };
    });
    const n = String(b.campus).replace(/\D/g, ''); // roster says 'LMS-5' in one row
    return { reg: b.reg, bus: b.bus, campus: 'LMS ' + n, campusId: 'LMS' + n,
      operational: b.operational, route: b.route, driver: b.driver, docs: docs };
  });
  const known = {};
  COORD_TRANSPORT_FLEET.forEach(function (b) { known[b.reg] = true; });
  return { fleet: fleet, unknown: live.regs.filter(function (r) { return !known[r]; }), formRows: live.rows };
}

// 'expired' | 'missing' | 'due' (within the soon window) | 'ok', given ISO dates
function coordTransportState_(date, today) {
  if (!date) return 'missing';
  if (date < today) return 'expired';
  const days = Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
  return days <= COORD_TRANSPORT_SOON_DAYS ? 'due' : 'ok';
}

// action=coordinatortransport
function coordTransport_(caller) {
  const all = coordTransportFleet_();
  const visible = coordVisibleCampuses_(caller);
  return {
    success: true, generated: new Date().toISOString(), formRows: all.formRows, unknown: all.unknown,
    docs: COORD_TRANSPORT_DOCS.map(function (d) { return { key: d[0], label: d[1] }; }),
    fleet: all.fleet.filter(function (b) { return !visible || visible.indexOf(b.campusId) !== -1; }),
  };
}

// ── Adapter: follow-up tasks, one per campus per month per problem kind ──
function coordTransportWanted_(fleet, now) {
  const today = Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd'), month = today.slice(0, 7);
  const by = {}; // campusId -> { campus, expired: [], due: [], missing: [] }
  fleet.filter(function (b) { return b.operational; }).forEach(function (b) {
    COORD_TRANSPORT_DOCS.forEach(function (d) {
      const st = coordTransportState_(b.docs[d[0]].date, today);
      if (st === 'ok') return;
      const c = by[b.campusId] = by[b.campusId] || { campus: b.campus, expired: [], due: [], missing: [] };
      c[st].push({ reg: b.reg, key: d[0], label: d[1] });
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
      title: c.campus + ': ' + c.missing.length + ' vehicle document' + (c.missing.length > 1 ? 's' : '') + ' with no record',
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
