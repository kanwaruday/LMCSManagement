var GAME_MODULE_ACTIONS = GAME_MODULE_ACTIONS || {};
var GAME_MODULE_MISSIONS = GAME_MODULE_MISSIONS || {};
var GAME_MODULE_QUESTS = GAME_MODULE_QUESTS || {};
var GAME_CALLER_FALLBACKS = GAME_CALLER_FALLBACKS || {};
var GAME_MODULE_DONE_AT = GAME_MODULE_DONE_AT || {};
var GAME_FOLLOWUP_SKIP = GAME_FOLLOWUP_SKIP || {};

// ═══════════════════════════════════════════════════════════════════
// LMCS Game Backend -- the Fleet setup module (Fleet Command's six setup quests per bus, Buddy on the transport pages).
// Rulings B1 (amended) and B2, .superpowers/sdd/2026-10-26-fleet-buddy/progress.md:
//   Fee Clerk    daily missions for their own campus's papers, driver, fuel and parts quests
//   Coordinator  daily missions for the safety check and the route timelapse, then "get it done" follow-ups for the rest
//                (shared: the Fee Clerk does them, so no personal credit); one parallel quest per bus
//   Owner        quests only: per campus "LMS 4 fleet: N of M buses ready" (a step per bus), that campus's bus quests after it.
//                Its missions hook (fleetWarm_) only warms the cache and returns no missions
// Scope (Ruling B4): exactly the Coordinator backend's (coordVisibleCampuses_), so no mission points at a bus the setup page
// won't open: Owner or ALL every campus, a Coordinator their district, a Fee Clerk their campus or comma list.
// LOCK (review I1): the quests run under the script lock, so they read ONLY the cache (fleetCachedRows_), never the workbook;
// a cold cache is no fleet quests for that load. The missions hooks run before the lock and warm it (fleetRows_).
// One source of truth (B2): fleetRows_ reads the transport workbook read-only, shaped exactly as the Coordinator backend's
// coordFleet_ shapes it (coordinator-transport.gs), and FleetQuests (coordinator/capture/fleet-quests.js, pushed into this
// project as fleet-quests.gs by projects.json) turns it into done / {done, total}, so missions agree with the Fleet setup
// counters. Missions are not core and keep no history of their own, so no GAME_MODULE_DONE_AT.
// A read failure throws (the framework then marks the day down instead of snapshotting an empty list).
// Mission order is the rank (the next-step bar shows the first open one): values to confirm first (most known items), then
// the buses closest to ready, then the rest. Every open mission is returned; the framework's cap picks today's few, and a
// mission in today's set never vanishes because another one moved ahead of it.
// Fleet Operations (Task 2, vault work/Fleet Operations design.md): the transport follow-ups of the Coordinator Tasks tab become fleet_ops_<domain>
// missions (and are skipped by the generic follow-up builder: GAME_FOLLOWUP_SKIP, the game director's contract), plus new missions where no
// follow-up exists: paper and driver-document renewals, the daily roll call, parts due. Per-bus heat (compliance only, never a ranking of people)
// and the campus operations quest ride on the same cached rows. Defaults live in Game Config key `fleet` (game.gs gameConfigDefaults_).
// Privacy: the cache holds dates and flags only. No date of birth, phone or licence number is ever read into it; a mission names a driver and a document.
// Only this file's own functions are used at top level (load order: tests/apps-script/test-load-order.js).
// ═══════════════════════════════════════════════════════════════════

var FLEET_BOOK_ID = '1VXTMZjqCS82ftB1rwoN4BzoiOTP7-Vg0m5vTH01Tfzc'; // the transport workbook (coordinator-transport.gs COORD_TRANSPORT_FORM_ID); read only
var FLEET_TABS = { fleet: 'LM Studio Fleet', profile: 'Fleet Profile', driver: 'Driver Profile', parts: 'Parts History',
  papers: 'LM Studio Vehicle Papers', runs: 'Capture Runs', stops: 'Capture Stops', fills: 'Fuel Fills',
  docs: 'LM Studio Documents', roll: 'Duty Roll Call', daily: 'GPS Daily', service: 'Service Bills', catalog: 'Parts Catalog', agency: 'Agency Vehicles',
  checks: 'Fuel Checks', answers: 'Fuel Responses' };
var FLEET_REQUIRED_TABS = ['fleet', 'docs']; // the others may not exist yet (no roll call saved, no catalog pushed): empty, not an outage
var FLEET_FORM_GID = 1365845375; // the transport document form's responses tab (coordinator-transport.gs COORD_TRANSPORT_FORM_GID); read by id
var FLEET_TASKS_TAB = 'Tasks'; // in GAME_APPROVALS_SHEET_ID, the Coordinator Tasks tab (columns as game-missions.gs reads them)
var FLEET_CACHE_KEY = 'fleet_rows_v2', FLEET_CACHE_S = 300; // a save on the setup page shows here within 5 minutes
// keep in sync with COORD_DISTRICTS in coordinator.gs (the Coordinator backend's scope)
var FLEET_DISTRICTS = { LMS1: ['LMS1', 'LMS2', 'LMS3'], LMS2: ['LMS1', 'LMS2', 'LMS3'], LMS3: ['LMS1', 'LMS2', 'LMS3'],
  LMS4: ['LMS4', 'LMS5', 'LMS6'], LMS5: ['LMS4', 'LMS5', 'LMS6'], LMS6: ['LMS4', 'LMS5', 'LMS6'] };
var FLEET_CLERK_QUESTS = ['papers', 'driver', 'fuel', 'parts'];
// the transport follow-up domains (coordinator-transport-gps.gs GPS.due) that Fleet Operations shows as its own missions
var FLEET_OPS_DOMAINS = ['gps_dead', 'gps_blind', 'gps_none', 'bus_away', 'bus_speed', 'fuel_check', 'fuel_proof', 'bus_inspection', 'bus_equipment', 'capture_route', 'bus_age'];
GAME_FOLLOWUP_SKIP.fleet = FLEET_OPS_DOMAINS;
// the papers with an expiry: [key, the label of the LM Studio Documents tab (and the form's type, upper-cased), the name in a mission title]
var FLEET_PAPERS = [['insurance', 'Insurance', 'insurance'], ['fitness', 'Fitness', 'fitness'], ['mv_tax', 'MV tax', 'MV tax'],
  ['pollution', 'Pollution', 'PUC'], ['route_permit', 'Route permit', 'route permit'], ['speed_governor', 'Speed governor', 'speed governor']];
var FLEET_DRIVER_DOCS = [['licence', 'licence'], ['medical', 'medical certificate'], ['police', 'police verification']];
var FLEET_FOLLOW = { papers: 'papers for {reg} wait', driver: 'driver card for {reg} waits', fuel: 'fuel pump details for {reg} wait',
  parts: 'parts history for {reg} waits' }; // + ' on the Fee Clerk'

// ── reader ───────────────────────────────────────────────────────────
// Every bus's rows for FleetQuests.profilesFromRows, cached (the quests run under the script lock). One openById.
function fleetRows_() {
  const hit = fleetCacheGet_(FLEET_CACHE_KEY);
  if (hit) return hit;
  const ss = SpreadsheetApp.openById(FLEET_BOOK_ID), tabs = {};
  Object.keys(FLEET_TABS).forEach(function (k) {
    const sh = ss.getSheetByName(FLEET_TABS[k]);
    if (!sh && FLEET_REQUIRED_TABS.indexOf(k) !== -1) throw new Error('Tab "' + FLEET_TABS[k] + '" is missing');
    tabs[k] = sh ? sh.getDataRange().getValues() : null;
  });
  const form = ss.getSheets().filter(function (x) { return x.getSheetId() === FLEET_FORM_GID; })[0];
  if (!form) throw new Error('Transport form responses tab not found'); // never mistake an unreadable source for "nothing uploaded"
  tabs.form = form.getDataRange().getValues();
  const tk = SpreadsheetApp.openById(GAME_APPROVALS_SHEET_ID).getSheetByName(FLEET_TASKS_TAB);
  if (!tk) throw new Error('Tab "' + FLEET_TASKS_TAB + '" is missing');
  tabs.tasks = tk.getDataRange().getValues();
  const rows = fleetShape_(tabs, fleetIstDay_(Date.now()));
  fleetCachePut_(FLEET_CACHE_KEY, rows, FLEET_CACHE_S);
  return rows;
}
// the cached rows only (null when cold): what code under the script lock may read
function fleetCachedRows_() { return fleetCacheGet_(FLEET_CACHE_KEY); }

// The Owner's missions hook: warms the cache outside the lock for the Owner's quests. Never throws (a transport outage must not
// mark the Owner's day down) and never returns a mission.
function fleetWarm_() {
  try { fleetRows_(); } catch (err) { console.error('fleet warm', err); }
  return [];
}

// tabs = {fleet, profile, driver, parts, papers, runs, stops, fills}: sheet values, header first (null = no tab) -> {fleet,
// profiles, drivers, parts, inspected, captured}, as coordFleet_ builds them (coordFleetBuses_, coordFleetScan_,
// coordFleetFills_, coordFleetDone_). The papers on file (docs) are left out: they never count towards a quest.
function fleetShape_(tabs, today) {
  today = today || fleetIstDay_(Date.now());
  const FQ = FleetQuests, objs = function (v) {
    if (!v || v.length < 2) return [];
    const head = v[0];
    return v.slice(1).map(function (r) { const o = {}; head.forEach(function (h, i) { o[h] = r[i] instanceof Date ? fleetIstDay_(r[i].getTime()) : r[i]; }); return o; });
  };
  if (!tabs.fleet) throw new Error('Tab "' + FLEET_TABS.fleet + '" is missing');
  const fleetRows = tabs.fleet.slice(1);
  if (!fleetRows.length) throw new Error('Tab "' + FLEET_TABS.fleet + '" has no vehicles in it');
  const fleet = fleetRows.filter(function (r) { return r[3] === 'yes'; }).map(function (r) {
    const n = String(r[2]).replace(/\D/g, '');
    return { reg: FQ.normReg(r[0]), campus: 'LMS ' + n, campusId: 'LMS' + n, route: String(r[4] || ''), driver: String(r[6] || ''), driverCode: String(r[9] || ''), year: Number(r[8]) || 0, operational: true };
  });
  const scan = {}, fills = {}, inspected = {}, captured = {}, first = {};
  objs(tabs.papers).forEach(function (r) {
    const reg = FQ.normReg(r.Reg), k = String(r.Field || '');
    if (FQ.SCAN_FIELDS.indexOf(k) === -1 || String(r.Value == null ? '' : r.Value) === '') return;
    (scan[reg] = scan[reg] || {})[k] = { value: String(r.Value) };
  });
  objs(tabs.fills).forEach(function (f) {
    const o = fills[FQ.normReg(f.reg)] = fills[FQ.normReg(f.reg)] || { count: 0, withVideo: 0, withVideoAndBill: 0 };
    o.count++;
    if (String(f.hasVideo) === 'yes') { o.withVideo++; if (String(f.hasBill) === 'yes') o.withVideoAndBill++; }
  });
  fleet.forEach(function (b) { b.scan = scan[b.reg] || {}; b.fills = fills[b.reg] || { count: 0, withVideo: 0, withVideoAndBill: 0 }; });
  // the first ended safety check per bus (coordInspections_: kind inspection, status ended, at least one answer)
  (tabs.runs || []).slice(1).forEach(function (r) {
    if (String(r[3]) !== 'inspection' || String(r[12]) !== 'ended') return;
    let raw = null;
    try { raw = JSON.parse(String(r[11] || 'null')); } catch (e) { raw = null; }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Object.keys(raw).some(function (k) { return raw[k] && typeof raw[k] === 'object'; })) return;
    const v = r[5] || r[4], t = v instanceof Date ? v.getTime() : /^\d+$/.test(String(v).trim()) ? Number(v) : Date.parse(String(v));
    if (isNaN(t)) return;
    const reg = FQ.normReg(r[1]), day = fleetIstDay_(t);
    if (!inspected[reg] || day < inspected[reg].at) inspected[reg] = { by: String(r[14] || r[6] || ''), at: day };
  });
  // the first processed route timelapse per bus (gpsCaptured_: runIds sort by time)
  objs(tabs.stops).forEach(function (r) {
    const reg = FQ.normReg(r.reg);
    if (first[reg] && first[reg] < r.runId) return;
    first[reg] = r.runId; captured[reg] = { by: String(r.capturedBy || ''), at: String(r.pushedAt || '') };
  });
  // the driver card only as "filled in or not" (the quest's done check): no date of birth, licence or phone in the cache (review M1)
  const drivers = objs(tabs.driver).map(function (d) {
    let f = {};
    try { f = JSON.parse(String(d.fields || '{}')) || {}; } catch (e) { f = {}; }
    const kept = {};
    Object.keys(f).forEach(function (k) { kept[k] = f[k] == null || String(f[k]).trim() === '' ? '' : 1; });
    return { driverKey: d.driverKey, reg: d.reg, fields: JSON.stringify(kept), ageLimit: d.ageLimit };
  });
  return Object.assign({ fleet: fleet, profiles: objs(tabs.profile), drivers: drivers, parts: objs(tabs.parts), inspected: inspected, captured: captured },
    fleetShapeOps_(tabs, today, fleet, objs));
}

// The Fleet Operations rows, compact and masked: dates, flags and ids only (no money, no names, no DOB, phone or licence number).
// cached by fleetRows_ with the rest, so the quests (under the script lock) can use them.
function fleetShapeOps_(tabs, today, fleet, objs) {
  const FQ = FleetQuests, regs = {}, keys = {}, num = function (c) { return 'LMS' + String(c || '').replace(/\D/g, ''); }, add = fleetAddDays_;
  fleet.forEach(function (b) { regs[b.reg] = true; keys[FQ.driverKey(b)] = true; });
  // papers: the scan dates (LM Studio Documents) merged with the form, as coordTransportFleet_ does: the form wins when at least as new;
  // an unread, no-expiry or other-document row says nothing; n/a with no newer form date is not needed
  const keyOf = {}, scan = {}, form = {}, paperDates = {};
  FLEET_PAPERS.forEach(function (p) { keyOf[p[1]] = p[0]; });
  const fid = TransportRank.fid, scanLink = {}, formLink = {}, other = {}, paperDocs = {}; // file ids only (the Transport page's wrong-document check compares ids)
  objs(tabs.docs).forEach(function (r) {
    const reg = FQ.normReg(r.Reg), key = keyOf[String(r.Document)], st = String(r.Status);
    if (!regs[reg] || !key) return;
    if (st === 'other document') { (other[reg + '|' + key] = other[reg + '|' + key] || []).push(fid(r.Link)); return; }
    if (['unread', 'no expiry'].indexOf(st) !== -1) return;
    scan[reg + '|' + key] = st === 'n/a' ? { na: true, date: '' } : { date: fleetDay_(r['Valid to']) };
    scanLink[reg + '|' + key] = fid(r.Link);
  });
  (tabs.form || []).slice(1).forEach(function (r) {
    const reg = FQ.normReg(r[1]), key = fleetFormType_(r[2]), date = fleetDay_(r[3]);
    if (!regs[reg] || !key || !date) return;
    if (!form[reg + '|' + key] || date > form[reg + '|' + key]) { form[reg + '|' + key] = date; formLink[reg + '|' + key] = fid((String(r[4] || '').match(/https?:\/\/[^\s,;]+/) || [''])[0]); }
  });
  Object.keys(scan).concat(Object.keys(form)).forEach(function (k) {
    const sc = scan[k], l = form[k], d = l && (!sc || l >= sc.date) ? l : sc && !sc.na ? sc.date : '', reg = k.split('|')[0];
    if (!d) return;
    (paperDates[reg] = paperDates[reg] || {})[k.split('|')[1]] = d;
    const link = d === l ? formLink[k] : scanLink[k], oth = (other[k] || []).filter(String);
    if (link || oth.length) (paperDocs[reg] = paperDocs[reg] || {})[k.split('|')[1]] = { link: link || '', other: oth };
  });
  // driver documents: only the three dates, only when they read as a date
  const driverDocs = {}, isDay = function (v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : ''; };
  objs(tabs.driver).forEach(function (d) {
    if (!keys[d.driverKey]) return;
    let f = {};
    try { f = JSON.parse(String(d.fields || '{}')) || {}; } catch (e) { f = {}; }
    const o = {}, a = isDay(f.licenceValidTill), b = isDay(f.medicalCertificateValidTill), c = isDay(f.policeVerificationDate);
    if (a) o.licence = a; if (b) o.medical = b; if (c) o.police = c;
    if (Object.keys(o).length) driverDocs[d.driverKey] = o;
  });
  // the transport follow-ups: open ones and ones resolved in the last 3 days
  const from = add(today, -3), tasks = [];
  (tabs.tasks || []).slice(1).forEach(function (r) {
    const domain = String(r[1] || '').trim(), status = String(r[5] || '').trim(), id = String(r[0] || '').trim();
    if (!id || FLEET_OPS_DOMAINS.indexOf(domain) === -1 || (status !== 'open' && status !== 'resolved')) return;
    const title = String(r[3] || '').replace(/\s+/g, ' ').trim().slice(0, 160), reg = fleetTaskReg_(id, title, regs), at = fleetIso_(r[9]);
    if (status === 'resolved' && (!at || fleetIstDay_(Date.parse(at)) < from)) return;
    // every task of the 11 domains stays, whether or not it names a running bus (reg '' then): it is scoped by its own campus
    tasks.push({ id: id, domain: domain, campus: String(r[2] || '').trim() ? num(r[2]) : '', reg: reg, title: title, status: status, assignee: String(r[13] || '').trim().toLowerCase(),
      due: fleetDay_(r[14]), createdAt: fleetDay_(r[7]), resolvedAt: status === 'resolved' ? at : '', resolvedBy: status === 'resolved' ? String(r[10] || '').trim() : '' });
  });
  // roll calls of the last 3 days (who recorded it, when; never the names), and the days a bus moved (GPS Daily km > 0)
  const rolls = {}, ran = {}, ranFrom = add(today, -2);
  objs(tabs.roll).forEach(function (r) {
    const reg = FQ.normReg(r.Reg), day = fleetDay_(r.Date);
    if (regs[reg] && day >= ranFrom) (rolls[reg] = rolls[reg] || {})[day] = { by: String(r['Recorded by'] || '').trim().toLowerCase(), at: fleetIso_(r['Recorded at']) };
  });
  objs(tabs.daily).forEach(function (r) {
    const reg = FQ.normReg(r.reg), day = fleetDay_(r.date);
    if (regs[reg] && day >= ranFrom && Number(r.km) > 0 && (ran[reg] = ran[reg] || []).indexOf(day) === -1) ran[reg].push(day);
  });
  Object.keys(ran).forEach(function (k) { ran[k].sort(); });
  // service history: the last replacement per bus and component (no amounts, no workshop), the catalog's parts with a life in months, each bus's catalog model
  const service = {}, partLife = [], catModel = {};
  objs(tabs.service).forEach(function (r) {
    const reg = FQ.normReg(r.reg), day = fleetDay_(r.date);
    if (!regs[reg] || !day) return;
    String(r.components || '').split(',').forEach(function (c) {
      c = c.trim();
      if (c && (!(service[reg] || {})[c] || day > service[reg][c])) (service[reg] = service[reg] || {})[c] = day;
    });
  });
  objs(tabs.catalog).forEach(function (r) {
    const months = Number(r.lifeMonths), comps = String(r.components || '').split(',').map(function (c) { return c.trim(); }).filter(String);
    if (months > 0 && r.model && comps.length) partLife.push({ model: String(r.model), code: String(r.code), name: String(r.spec || r.code).replace(/\s+/g, ' ').trim().slice(0, 60), months: months, components: comps });
  });
  objs(tabs.agency).forEach(function (r) { const reg = FQ.normReg(r.reg), m = String(r.catalogModel || '').trim(); if (regs[reg] && m) catModel[reg] = m; });
  // the Fee Clerk's fuel bill checks: flagged ones of the last 14 days, answered or not
  const answers = {}, checks = [];
  objs(tabs.answers).forEach(function (a) { answers[String(a.id)] = a; });
  objs(tabs.checks).forEach(function (c) {
    const reg = FQ.normReg(c.reg), day = fleetDay_(c.date), a = answers[String(c.id)];
    if (String(c.flag) !== 'yes' || !regs[reg] || day < add(today, -14)) return;
    checks.push({ id: String(c.id), campus: num(c.campus), reg: reg, date: day, answered: !!a, by: a ? String(a.by || '').trim().toLowerCase() : '', at: a ? fleetIso_(a.at) : '' });
  });
  return { paperDates: paperDates, paperDocs: paperDocs, driverDocs: driverDocs, tasks: tasks, rolls: rolls, ran: ran, service: service, partLife: partLife, catModel: catModel, checks: checks };
}

// the form's "Document Type" (upper case) -> the paper's key (coordinator-transport.gs COORD_TRANSPORT_FORM_TYPES)
function fleetFormType_(v) {
  const t = String(v || '').trim().toUpperCase();
  for (let i = 0; i < FLEET_PAPERS.length; i++) if (FLEET_PAPERS[i][1].toUpperCase() === t) return FLEET_PAPERS[i][0];
  return '';
}
// a sheet cell (Date, 'yyyy-MM-dd', a timestamp, or the form sheet's m/d/yyyy text) -> the IST day 'yyyy-MM-dd', or ''
function fleetDay_(v) {
  if (v === '' || v == null) return '';
  if (typeof v === 'object' && typeof v.getTime === 'function') return isNaN(v.getTime()) ? '' : fleetIstDay_(v.getTime());
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
  const t = Date.parse(s);
  return isNaN(t) ? '' : fleetIstDay_(t);
}
function fleetIso_(v) { if (v === '' || v == null) return ''; const t = new Date(v).getTime(); return isNaN(t) ? '' : new Date(t).toISOString(); }
function fleetAddDays_(day, n) { return new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
function fleetDayDiff_(a, b) { return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000); }
function fleetAddMonths_(day, n) { // clamped: 30 Aug + 6 months = 28 Feb, not 2 Mar
  const d = new Date(day + 'T00:00:00Z'), dd = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + n);
  if (d.getUTCDate() !== dd) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}
// a follow-up's bus: the second part of its id ('gps_dead|HP12AB1234'), else the first word of its title (fuel fills and checks are keyed by their own id)
function fleetTaskReg_(id, title, regs) {
  const a = FleetQuests.normReg(id.split('|')[1]), b = FleetQuests.normReg(String(title).split(/[\s,:;]+/)[0]);
  return regs[a] ? a : regs[b] ? b : '';
}

function fleetIstDay_(ms) { return new Date(ms + 330 * 60000).toISOString().slice(0, 10); }

// CacheService caps a value at 100 KB: gzipped JSON in chunks (as coordCachePutBig_ in the Coordinator backend)
function fleetCachePut_(key, obj, seconds) {
  const b64 = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(obj), 'application/json')).getBytes());
  const parts = Math.ceil(b64.length / 90000), m = {};
  m[key + '_n'] = String(parts);
  for (let i = 0; i < parts; i++) m[key + '_' + i] = b64.slice(i * 90000, (i + 1) * 90000);
  CacheService.getScriptCache().putAll(m, seconds);
}
function fleetCacheGet_(key) {
  const cache = CacheService.getScriptCache(), n = parseInt(cache.get(key + '_n'), 10);
  if (!n) return null;
  const keys = [];
  for (let i = 0; i < n; i++) keys.push(key + '_' + i);
  const got = cache.getAll(keys);
  let b64 = '';
  for (let i = 0; i < n; i++) { if (!got[keys[i]]) return null; b64 += got[keys[i]]; }
  return JSON.parse(Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(b64), 'application/x-gzip')).getDataAsString());
}

// ── scope ────────────────────────────────────────────────────────────
// The campuses whose buses the caller plays (null = every campus): coordVisibleCampuses_'s rule (B4). A Coordinator's district is
// further narrowed by pilotCampuses.Coordinator, as gameToday_ narrows their missions (it never widens).
function fleetScope_(caller, cfg) {
  const role = caller.primaryRole, own = String(caller.campusId || '').toUpperCase();
  if (role === 'Owner') return null;
  if (role === 'Coordinator') {
    const vis = own === 'ALL' ? null : FLEET_DISTRICTS[own] || [own], pilot = fleetPilot_(cfg);
    return vis && pilot ? vis.filter(function (c) { return pilot.indexOf(c) !== -1; }) : vis || pilot;
  }
  return own === 'ALL' ? null : own.split(',').map(function (c) { return c.trim(); }).filter(Boolean);
}
function fleetPilot_(cfg) { const p = cfg && cfg.pilotCampuses && cfg.pilotCampuses.Coordinator; return Array.isArray(p) ? p : null; }

// the caller's buses' rows (fleet filtered; the other rows join by reg inside FleetQuests)
// cacheOnly: under the script lock (the quests); null when the cache is cold
function fleetScopedRows_(caller, cfg, cacheOnly) {
  const rows = cacheOnly ? fleetCachedRows_() : fleetRows_();
  if (!rows) return null;
  const scope = fleetScope_(caller, cfg);
  return Object.assign({}, rows, { fleet: rows.fleet.filter(function (b) { return !scope || scope.indexOf(b.campusId) !== -1; }) });
}
function fleetGo_(reg, quest) { return 'coordinator/transport/setup.html?reg=' + reg + (quest ? '&quest=' + quest : ''); }

// ── missions ─────────────────────────────────────────────────────────
// Buddy's line for one open quest (work/LMS Mascot Voice Guide.md: verb first, plain, no speed, no people ranked)
function fleetTitle_(role, p, q, prog, step) {
  const reg = p.reg, camp = p.campus + ': ';
  if (role === 'Coordinator') {
    if (q.id === 'safety') return camp + 'record the monthly safety check for ' + reg;
    if (q.id === 'capture') return camp + 'run the route timelapse for ' + reg;
    return camp + FLEET_FOLLOW[q.id].replace('{reg}', reg) + ' on the Fee Clerk';
  }
  if (q.id === 'papers' && prog.known) return 'Confirm the ' + (prog.known === 1 ? 'paper' : prog.known + ' papers') + ' found in scans for ' + reg;
  if (q.id === 'papers' && q.missing.every(function (id) { return id === 'odometerToday' || id === 'odometerPhoto'; })) return "Add today's odometer and photo for " + reg;
  return step.task + ' for ' + reg;
}

// Coordinator / Fee Clerk -> Mission[] in rank order: open ones, plus the ones done since the start of yesterday's game day
// (done from the data, with who completed it), so a mission finished today stays on today's list as done.
function fleetMissions_(caller, cfg, now) {
  const role = caller.primaryRole;
  if (role !== 'Coordinator' && role !== 'FeeClerk') return [];
  const FQ = FleetQuests, rows = fleetScopedRows_(caller, cfg), today = fleetIstDay_(now.getTime()), since = gameLookbackStart_(now), me = gameLower_(caller.email);
  const steps = {}, credit = {};
  FQ.questConfig().steps.forEach(function (s) { steps[s.id] = s; });
  FQ.transportMissions(rows).forEach(function (m) { credit[m.id] = m; }); // FleetQuests' own done, doneBy/doneAt (the save or run that completed it) and why
  const open = [], done = [];
  FQ.profilesFromRows(rows).forEach(function (p, bi) {
    const prog = FQ.progressFor(p, today), bus = FQ.busProgress(p, today).confirmed;
    FQ.questsFor(p).forEach(function (q, qi) {
      if (role === 'FeeClerk' && FLEET_CLERK_QUESTS.indexOf(q.id) === -1) return;
      const tm = credit['transport:setup_' + q.id + ':' + p.reg], pr = prog[qi], follow = role === 'Coordinator' && FLEET_CLERK_QUESTS.indexOf(q.id) !== -1;
      const run = q.done && !tm.doneAt && (p.credit || {})[q.id === 'safety' ? 'inspected' : q.id === 'capture' ? 'captured' : ''], doneAt = tm.doneAt || (run && run.at) || null; // a run with no capturer named still has its time
      if (q.done && !(doneAt && new Date(doneAt).getTime() >= since)) return; // confirmed a while ago: not today's story
      const m = gameMission_('fleet_' + q.id, p.reg, {
        title: fleetTitle_(role, p, q, pr, steps[q.id]), why: tm.why, campus: p.campusId, go: fleetGo_(p.reg, q.id),
        shared: follow || (q.done && gameLower_(tm.doneBy) !== me), done: q.done, doneAt: q.done ? doneAt : null, doneBy: q.done ? tm.doneBy || null : null,
        progress: { done: pr.confirmed, total: pr.total },
      });
      (q.done ? done : open).push({ m: m, follow: follow, known: pr.known, bus: bus, i: bi * 10 + qi });
    });
  });
  // the setup missions still open: their follow-ups (monthly safety check, route timelapse) are the same job, so they are not shown a second time
  const setupOpen = {};
  open.forEach(function (x) { const k = x.m.kind === 'fleet_safety' ? 'bus_inspection' : x.m.kind === 'fleet_capture' ? 'capture_route' : ''; if (k) setupOpen[k + '|' + x.m.id.split(':')[1]] = true; });
  open.sort(function (a, b) { return (a.follow - b.follow) || (b.known - a.known) || (b.bus - a.bus) || (a.i - b.i); });
  return open.concat(done).map(function (x) { return x.m; }).concat(fleetOpsMissions_(caller, cfg, now, rows, setupOpen));
}

// ── Fleet Operations ─────────────────────────────────────────────────
// The Game Config `fleet` object over its defaults (a partial override, or none, is fine)
function fleetCfg_(cfg) {
  const d = gameConfigDefaults_().fleet, c = (cfg && cfg.fleet) || {}, out = Object.assign({}, d, c);
  out.heat = Object.assign({}, d.heat, c.heat); out.weights = Object.assign({}, d.weights, c.weights);
  return out;
}

// The dated papers of one bus with their state today, by TransportRank.cellState (the Transport page's own rules): [{key, label, date, n}]
// for the papers that have an expiry date on file (n = days left, negative when expired). A one-time paper (speed governor) never expires: left out.
function fleetPaperStates_(rows, reg, today) {
  const dates = (rows.paperDates || {})[reg] || {}, out = [];
  FLEET_PAPERS.forEach(function (p) {
    if (!dates[p[0]]) return;
    // the file link and the other-document list go into the Transport page's own check, as the "papers on file" counter does: a wrong document is not current
    const d = ((rows.paperDocs || {})[reg] || {})[p[0]] || {};
    const c = TransportRank.cellState({ date: dates[p[0]], link: d.link || '', other: (d.other || []).map(function (l) { return { link: l }; }), noexp: [], unread: [] }, p[0], today);
    if (c.n !== null && c.t !== 'na') out.push({ key: p[0], label: p[2], date: dates[p[0]], n: c.n, bad: !!c.bad });
  });
  return out;
}

// One bus's heat from its open compliance items. Pure. bus = {expired: [paper names], open: {domain: count}, overAge, driver60, noAttendant};
// the weights and thresholds are the Game Config `fleet` object. Compliance only: speed counts only as a breach, and heat is about buses, never people.
function fleetHeat_(bus, fleet) {
  const F = fleetCfg_({ fleet: fleet }), W = F.weights, open = bus.open || {}, why = [];
  let score = 0;
  const add = function (w, text) { score += Number(w) || 0; why.push(text); };
  (bus.expired || []).forEach(function (l) { add(W.expiredPaper, l + ' expired'); });
  (bus.wrong || []).forEach(function (l) { add(W.expiredPaper, l + ' is the wrong document'); });
  (bus.driverExpired || []).forEach(function (l) { add(W.expiredDriverDoc, l + ' expired'); });
  if (open.gps_dead) add(W.trackerDead, 'tracker silent');
  if (open.gps_none) add(W.trackerNone, 'no tracker');
  if (open.gps_blind) add(W.trackerBlind, 'tracker dark on part of its trips');
  if (open.bus_inspection) add(W.safetyCheck, 'no safety check this month');
  if (open.bus_equipment) add(W.equipment, open.bus_equipment + ' safety item' + (open.bus_equipment === 1 ? '' : 's') + ' missing');
  if (open.fuel_proof) add(W.fuelProof, 'fuel without proof');
  if (bus.overAge) add(W.overAge, 'past the ' + F.busAgeLimit + '-year limit');
  if (bus.driver60) add(W.driver60, 'driver is 60 or over');
  if (bus.noAttendant) add(W.noAttendant, 'no attendant on record');
  if (bus.rollMissing) add(W.rollCallMissing, 'roll call missing yesterday');
  if (open.bus_speed >= F.speedCount) add(W.speed, 'repeated over-speed');
  return { level: score >= F.heat.hot ? 'hot' : score >= F.heat.warm ? 'warm' : 'cool', reasons: why };
}

// a driver document's expiry day: the licence and medical certificate print one; police verification only when cfg.fleet.policeVerificationYears is set (Ruling O1)
function fleetDriverDocExpiry_(date, key, F) {
  if (!date) return '';
  return key === 'police' ? (F.policeVerificationYears > 0 ? fleetAddMonths_(date, 12 * F.policeVerificationYears) : '') : date;
}

// {reg: {level, reasons}} for every bus in rows.fleet, from the cached rows (open follow-ups, papers, the driver card's age flag, the safety kit's attendant)
function fleetHeats_(rows, today, cfg) {
  const F = fleetCfg_(cfg), FQ = FleetQuests, open = {}, safety = {}, drivers = {}, out = {}, from = fleetAddDays_(today, -F.speedDays);
  (rows.tasks || []).forEach(function (t) {
    if (t.status !== 'open') return;
    const o = open[t.reg] = open[t.reg] || {};
    if (t.domain === 'bus_speed') { const day = t.id.split('|')[2] || t.createdAt || ''; if (day >= from) o.bus_speed = (o.bus_speed || 0) + 1; } // a breach in the last 30 days
    else o[t.domain] = (o[t.domain] || 0) + 1;
  });
  (rows.profiles || []).forEach(function (r) {
    let sf = {};
    try { sf = JSON.parse(String(r.safety || '{}')) || {}; } catch (e) { sf = {}; }
    safety[FQ.normReg(r.reg)] = String(sf.attendantHelperName || '').trim();
  });
  (rows.drivers || []).forEach(function (d) { drivers[d.driverKey] = d.ageLimit === true || d.ageLimit === 'yes'; });
  rows.fleet.forEach(function (b) {
    const states = fleetPaperStates_(rows, b.reg, today), docs = (rows.driverDocs || {})[FQ.driverKey(b)] || {}, yesterday = fleetAddDays_(today, -1);
    out[b.reg] = fleetHeat_({
      expired: states.filter(function (p) { return p.n < 0 && !p.bad; }).map(function (p) { return p.label; }), wrong: states.filter(function (p) { return p.bad; }).map(function (p) { return p.label; }),
      driverExpired: FLEET_DRIVER_DOCS.filter(function (d) { const e = fleetDriverDocExpiry_(docs[d[0]], d[0], F); return e && e < today; }).map(function (d) { return d[1]; }),
      rollMissing: yesterday >= F.rollCallFrom && ((rows.ran || {})[b.reg] || []).indexOf(yesterday) !== -1 && !((rows.rolls || {})[b.reg] || {})[yesterday],
      open: open[b.reg] || {},
      overAge: !!b.year && Number(today.slice(0, 4)) - b.year >= F.busAgeLimit, driver60: !!drivers[FQ.driverKey(b)],
      noAttendant: !safety[b.reg] || /^(none|no|nil|-)$/i.test(safety[b.reg]),
    }, F);
  });
  return out;
}

var FLEET_WHY = { gps_dead: 'School buses must have a working tracker', gps_none: 'School buses must have a working tracker', gps_blind: 'The tracker loses the bus on some trips',
  bus_speed: 'The limit for school buses is 40 km/h', fuel_proof: 'Every fill needs its video and bill', bus_equipment: 'Safety equipment must be on board',
  bus_inspection: 'A safety check is due every month', bus_age: 'School buses may run up to 15 years' };

// Buddy's line for one follow-up (work/LMS Mascot Voice Guide.md: verb first, plain, no speed language). late: a Fee Clerk item shown to the Coordinator.
function fleetOpsTitle_(t, late, b, today) {
  const reg = t.reg, part = t.id.split('|')[2] || '', day = /^\d{4}-\d{2}-\d{2}$/.test(part) ? gameDateLabel_(part) : '';
  const fill = (String(t.title).match(/fuel on (\d{1,2} [A-Za-z]{3})/) || [])[1] || 'a recent day';
  switch (t.domain) {
    case 'gps_dead': return reg + ' tracker is silent: ask Blackbox to check it';
    case 'gps_blind': return reg + ' tracker goes dark on some trips: ask Blackbox to check its wiring';
    case 'gps_none': return reg + ' has no GPS tracker: get one fitted';
    case 'bus_away': return reg + ' stayed away from its base' + (day ? ' on ' + day : '') + ': ask the driver why';
    case 'bus_speed': return 'Talk to the driver of ' + reg + ' about the 40 km/h limit: ' + (day ? 'week of ' + day : 'this week');
    case 'fuel_check': return 'Fuel use for ' + reg + ' looks high: ask the driver to explain';
    case 'fuel_proof': return late ? 'Fuel bill and video for ' + reg + "'s fill on " + fill + ' still wait on the Fee Clerk' : 'Fuel bill and video missing for ' + reg + "'s fill on " + fill;
    case 'bus_inspection': return 'Record the monthly safety check for ' + reg;
    case 'bus_equipment': return ((String(t.title).match(/^\S+: (.+?) missing in the safety check/) || [])[1] || 'A safety item') + ' on ' + reg + ' failed the safety check: fix it and check again';
    case 'capture_route': return 'Run the route timelapse for ' + reg;
    case 'bus_age': return b.year && b.year + 15 > Number(today.slice(0, 4)) ? reg + ' reaches the 15-year limit in ' + (b.year + 15) + ': plan its replacement' : reg + ' has reached the 15-year limit: plan its replacement';
    default: return t.title;
  }
}

// Fee Clerk: fuel proof, fuel check answers, renewals, roll call. Coordinator: the other follow-ups, parts due, and "get it done" copies (shared, no personal
// credit) of the clerk's items that have gone late. Open ones first, then the ones done since the start of yesterday's game day. rows = the caller's scope.
function fleetOpsMissions_(caller, cfg, now, rows, setupOpen) {
  setupOpen = setupOpen || {};
  const role = caller.primaryRole, clerk = role === 'FeeClerk', F = fleetCfg_(cfg), today = fleetIstDay_(now.getTime()), yesterday = fleetAddDays_(today, -1);
  const since = gameLookbackStart_(now), me = gameLower_(caller.email), bus = {}, open = [], done = [];
  const hm = new Date(now.getTime() + 330 * 60000).toISOString().slice(11, 16), dow = new Date(today + 'T00:00:00Z').getUTCDay();
  rows.fleet.forEach(function (b) { bus[b.reg] = b; });
  const scope = fleetScope_(caller, cfg), inScope = function (c) { return !scope || scope.indexOf(c) !== -1; };
  const put = function (kind, id, f) { const m = gameMission_(kind, id, f); (m.done || m.gone ? done : open).push(m); };

  // 1. the transport follow-ups, from the Tasks rows (the same rules as the generic builder: resolved by a person is done, by the system is gone)
  (rows.tasks || []).forEach(function (t) {
    const b = bus[t.reg], campus = t.campus || (b && b.campusId) || '', resolved = t.status === 'resolved', by = gameLower_(t.resolvedBy), gone = resolved && /^system/i.test(by), own = t.domain === 'fuel_proof';
    if (!inScope(campus) || (resolved && !(t.resolvedAt && Date.parse(t.resolvedAt) >= since))) return; // scoped by the task row's own campus, not by the roster
    if (!resolved && setupOpen[t.domain + '|' + t.reg]) return; // the setup mission for this bus is the same job
    let late = false;
    if (clerk) { if (!own) return; }
    else {
      if (t.assignee && t.assignee !== me) return; // another person's follow-up
      if (own) { if (resolved || !(t.due && t.due < today)) return; late = true; } // the clerk's until it has gone late
    }
    put('fleet_ops_' + t.domain, t.id, {
      title: b ? fleetOpsTitle_(t, late, b, today) : t.title, why: gone ? 'No longer needed' : FLEET_WHY[t.domain] || '', owner: t.assignee, campus: campus,
      go: clerk ? 'office/daybook.html' : GAME_PORTAL_FOLLOWUPS, due: t.due || null,
      shared: clerk ? resolved && !gone && by !== me : late || !t.assignee,
      done: resolved && !gone, doneAt: resolved && !gone ? t.resolvedAt : null, doneBy: resolved && !gone ? by : null, gone: gone,
    });
  });

  // 2. renewals: papers expiring within cfg.fleet.renewDays (or expired, overdue); the driver's licence, medical certificate and police verification
  const renew = function (kind, id, b, label, date, n, go, bad) {
    if (bad) { // a paper read as the wrong document is not current, whatever its date
      if (clerk) put(kind, id, { title: 'Upload the right ' + label.paper + ' for ' + b.reg, why: 'The file on record is another document', campus: b.campusId, go: go });
      return;
    }
    if (n > F.renewDays || (!clerk && n >= 0)) return; // the Coordinator only hears of the ones that are overdue
    const dl = gameDateLabel_(date);
    put(kind, id, clerk ? { title: 'Renew ' + label.what + ': ' + (n < 0 ? 'expired ' : 'expires ') + dl, why: label.why, campus: b.campusId, go: go, due: date }
      : { title: label.who + ' expired on ' + dl + ': ask the Fee Clerk to renew it', why: label.why, campus: b.campusId, go: go, due: date, shared: true });
  };
  const seen = {};
  rows.fleet.forEach(function (b) {
    fleetPaperStates_(rows, b.reg, today).forEach(function (p) {
      renew('fleet_ops_paper', b.reg + ':' + p.key, b, { what: p.label + ' for ' + b.reg, who: p.label.replace(/^./, function (c) { return c.toUpperCase(); }) + ' for ' + b.reg, why: 'The bus cannot run on an expired paper', paper: p.label }, p.date, p.n, clerk ? 'office/transport.html' : 'coordinator/transport/index.html', p.bad); // the Fee Clerk uploads on the Office transport page (TR7)
    });
    const key = FleetQuests.driverKey(b), docs = (rows.driverDocs || {})[key];
    if (!docs || seen[key]) return;
    seen[key] = true;
    const name = String(b.driver || '').trim();
    FLEET_DRIVER_DOCS.forEach(function (d) {
      const date = fleetDriverDocExpiry_(docs[d[0]], d[0], F);
      if (!date) return;
      const what = name ? name + "'s " + d[1] : 'the ' + d[1] + ' of the driver of ' + b.reg;
      renew('fleet_ops_driver_doc', b.reg + ':' + d[0], b, { what: what, who: name ? name + "'s " + d[1] : 'The ' + d[1] + ' of the driver of ' + b.reg, why: 'Drivers need valid documents' }, date, fleetDayDiff_(date, today), fleetGo_(b.reg, 'driver'));
    });
  });

  // 3. the daily roll call: today's after cfg.fleet.rollCallBy (not on a Sunday), yesterday's when the GPS shows the bus ran
  rows.fleet.forEach(function (b) {
    const rl = (rows.rolls || {})[b.reg] || {}, ran = ((rows.ran || {})[b.reg] || []).indexOf(yesterday) !== -1;
    [[today, true], [yesterday, ran]].forEach(function (x) {
      if (x[0] < F.rollCallFrom) return; // nothing for a day before the roll call existed
      const day = x[0], rec = rl[day], word = day === today ? 'today' : 'yesterday', id = b.reg + ':' + day;
      if (rec) {
        if (clerk && rec.at && Date.parse(rec.at) >= since) put('fleet_ops_rollcall', id, { title: (word === 'today' ? "Mark today's" : "Mark yesterday's") + ' roll call for ' + b.reg, campus: b.campusId,
          go: 'coordinator/transport/rollcall.html', shared: rec.by !== me, done: true, doneAt: rec.at, doneBy: rec.by });
        return;
      }
      if (day === today ? dow === 0 || hm < F.rollCallBy : !x[1]) return;
      if (clerk) put('fleet_ops_rollcall', id, { title: (word === 'today' ? "Mark today's" : "Mark yesterday's") + ' roll call for ' + b.reg, why: 'Who drove and who attended', campus: b.campusId, go: 'coordinator/transport/rollcall.html' });
      else if (day === yesterday) put('fleet_ops_rollcall', id, { title: "Yesterday's roll call for " + b.reg + ' is still missing: ask the Fee Clerk', why: 'Who drove and who attended', campus: b.campusId, go: 'coordinator/transport/rollcall.html', shared: true });
    });
  });

  // 4. the Fee Clerk's fuel bill checks (the slip against the bill), while still with the clerk
  if (clerk) (rows.checks || []).forEach(function (c) {
    const b = bus[c.reg];
    if (!b || (c.answered ? !(c.at && Date.parse(c.at) >= since) : c.date < fleetAddDays_(today, -F.fuelClerkDays))) return; // unanswered past the clerk's days: it is the Coordinator's fuel_check now
    put('fleet_ops_fuel_answer', c.id, { title: 'Check the pump slip for ' + c.reg + "'s fill on " + gameDateLabel_(c.date), why: 'The slip should agree with the bill', campus: c.campus || b.campusId, go: 'office/buses.html', // TR8 lives there
      shared: c.answered && c.by !== me, done: c.answered, doneAt: c.answered ? c.at : null, doneBy: c.answered ? c.by : null });
  });

  // 5. parts due: the last replacement (Service Bills) plus the agency part life in months (Parts Catalog); nothing without both
  if (!clerk) rows.fleet.forEach(function (b) {
    const model = (rows.catModel || {})[b.reg], svc = (rows.service || {})[b.reg] || {};
    (rows.partLife || []).forEach(function (p) {
      if (p.model !== model) return;
      const last = p.components.reduce(function (a, c) { return svc[c] && svc[c] > a ? svc[c] : a; }, '');
      if (!last || fleetAddMonths_(last, p.months) > fleetAddDays_(today, F.partDueDays)) return;
      put('fleet_ops_part', b.reg + ':' + p.code, { title: 'Check ' + p.name + ' on ' + b.reg + ': last replaced ' + gameDateLabel_(last), why: 'It is due by the agency part life', campus: b.campusId,
        go: fleetGo_(b.reg, 'parts'), due: fleetAddMonths_(last, p.months) });
    });
  });
  return open.concat(done);
}

// ── quests ───────────────────────────────────────────────────────────
// Coordinator: one parallel quest per bus, the six setup quests as steps. Owner: per campus a readiness quest (a step per bus,
// done when it is ready) followed by that campus's bus quests. Cheap: the cached rows, pure FleetQuests.
function fleetQuests_(caller, cfg, now) {
  const role = caller.primaryRole;
  if (role !== 'Coordinator' && role !== 'Owner') return [];
  const rows = fleetScopedRows_(caller, cfg, true);
  if (!rows) return []; // cold cache: never read the workbook under the lock
  const FQ = FleetQuests, profiles = FQ.profilesFromRows(rows);
  const busQuest = function (p) {
    const steps = FQ.questsFor(p).map(function (q) { return { id: q.id, title: q.label, go: fleetGo_(p.reg, q.id), done: q.done, locked: false }; });
    return { questId: 'fleet:' + p.reg, title: p.reg + ' · Fleet setup', parallel: true, steps: steps, complete: steps.every(function (s) { return s.done; }) };
  };
  const ops = fleetOpsQuests_(rows, role, cfg, now);
  if (role === 'Coordinator') return profiles.map(busQuest).concat(ops);
  const campuses = profiles.map(function (p) { return p.campus; }).filter(function (c, i, a) { return a.indexOf(c) === i; }).sort();
  const out = [];
  campuses.forEach(function (c) {
    const mine = profiles.filter(function (p) { return p.campus === c; }), bar = FQ.teamBar(c, mine);
    const steps = mine.map(function (p) {
      const q = FQ.questsFor(p), n = q.filter(function (x) { return x.done; }).length;
      return { id: p.reg, title: p.reg + ' · ' + n + ' of ' + q.length + ' set up', go: fleetGo_(p.reg), done: FQ.isReady(p), locked: false };
    });
    out.push({ questId: 'fleet-campus:' + mine[0].campusId, title: bar.text, parallel: true, steps: steps, complete: bar.ready === bar.total });
    mine.forEach(function (p) { out.push(busQuest(p)); });
  });
  return out.concat(ops);
}

// The campus operations quest (Coordinator and Owner): per campus, "every bus cool this week". A first step with the campus's heat count, then a step per bus,
// the hot ones first, each done when the bus is cool. A team quest about buses, never a ranking of people. No P&L review step (Ruling O2: no read signal
// exists, so it would always be open). Cached rows only (the quests run under the lock).
function fleetOpsQuests_(rows, role, cfg, now) {
  const today = fleetIstDay_(now.getTime()), heats = fleetHeats_(rows, today, cfg), order = { hot: 0, warm: 1, cool: 2 }, out = [], campuses = {};
  rows.fleet.forEach(function (b) { (campuses[b.campusId] = campuses[b.campusId] || { label: b.campus, buses: [] }).buses.push(b); });
  Object.keys(campuses).sort().forEach(function (id) {
    const c = campuses[id], n = { hot: 0, warm: 0, cool: 0 };
    c.buses.forEach(function (b) { n[heats[b.reg].level]++; });
    const buses = c.buses.slice().sort(function (a, b) { return (order[heats[a.reg].level] - order[heats[b.reg].level]) || (a.reg < b.reg ? -1 : a.reg > b.reg ? 1 : 0); });
    const steps = [{ id: 'heat', title: c.label + ': ' + n.hot + ' hot, ' + n.warm + ' warm, ' + n.cool + ' cool', go: 'coordinator/transport/index.html', done: !n.hot && !n.warm, locked: false }].concat(buses.map(function (b) {
      const h = heats[b.reg];
      return { id: b.reg, title: b.reg + ' · ' + h.level + (h.reasons.length ? ': ' + h.reasons.join(', ') : ''), go: fleetGo_(b.reg), done: h.level === 'cool', locked: false };
    }));
    out.push({ questId: 'fleet-ops:' + id, title: c.label + ' operations: every bus cool this week', parallel: true, steps: steps, complete: !n.hot && !n.warm });
  });
  return out;
}

// ── registration (this file's own functions only) ───────────────────
GAME_MODULE_MISSIONS.Coordinator = [].concat(GAME_MODULE_MISSIONS.Coordinator || [], fleetMissions_);
GAME_MODULE_MISSIONS.FeeClerk = [].concat(GAME_MODULE_MISSIONS.FeeClerk || [], fleetMissions_);
GAME_MODULE_MISSIONS.Owner = [].concat(GAME_MODULE_MISSIONS.Owner || [], fleetWarm_);
GAME_MODULE_QUESTS.Coordinator = [].concat(GAME_MODULE_QUESTS.Coordinator || [], fleetQuests_);
GAME_MODULE_QUESTS.Owner = [].concat(GAME_MODULE_QUESTS.Owner || [], fleetQuests_);
