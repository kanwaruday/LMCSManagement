// ═══════════════════════════════════════════════════════════════════
// Coordinator Backend -- Transport GPS checks (third file of the "LMCS Coordinator Backend" project).
// Spec: docs/superpowers/specs/2026-10-24-transport-optimisation-design.md
//
// The Mac (~/Projects/transport-gps/insights.py, daily) pushes per-bus daily facts from the GPS (action=transportgpspush,
// same shared secret as the fleet push). On each push this file stores them, checks every fuel fill the Office backend
// mirrors into the "Fuel Fills" tab against the GPS km, and raises follow-ups in the Tasks store, each with an owner,
// a due date and one plain instruction. It also raises the safety-loadout follow-ups from the capture portal's monthly
// safety checks (Capture Runs tab, read by coordInspections_ in coordinator-transport.gs): bus_inspection and bus_equipment.
// Capture timelapses (transport/capture/capture.py on the Mac, daily, same secret): it pulls the ended timelapse runs
// (POST transportcapturepull), blurs and stitches them in Drive, and pushes back each processed run's stop list
// (POST transportcapturepush, kept in the "Capture Stops" tab). This project has no Drive access, so the ids of the blurred
// route.mp4 and stop photos come from the Roster project by path (captureprocessed, transport-capture.gs), never from the push.
// An operational bus with no processed run gets capture_route (from GPS.captureFrom).
// Agency service data (transport/capture/agency_import.py on the Mac, same secret): the vehicle agencies' filled templates become the
// parts catalog the garage reads (POST transportcatalogpush -> Parts Catalog, Agency Vehicles, Agency History; idempotent), served
// read-only in coordinatortransportinsight as `catalog`: models and parts fleet-wide, vehicles and history by reg like the rest.
// Three views read it:
//   GET  coordinatortransportinsight  Coordinator / Owner, scoped to their campuses (the Owner also gets proposals);
//                                     feeds the checks and the route views (metro map, city overlay, depot)
//   GET  coordinatorbuschecks         Fee Clerk: fuel bills of their campus waiting for their check
//   POST transportclerkcheck          Fee Clerk answers one: 'matches' (slip agrees with the bill) or 'corrected'
// ponytail: thresholds are the spec's starting values; tune them here once a few weeks of answers exist.
// ═══════════════════════════════════════════════════════════════════

const GPS_TAB_DAILY = 'GPS Daily', GPS_TAB_META = 'GPS Meta', GPS_TAB_STOPS = 'GPS Stops', GPS_TAB_TRACKS = 'GPS Tracks', GPS_TAB_FILLS = 'Fuel Fills',
  GPS_TAB_CHECKS = 'Fuel Checks', GPS_TAB_ANSWERS = 'Fuel Responses', GPS_TAB_CAPTURE = 'Capture Stops';
const GPS_CAPTURE_COLS = ['runId', 'reg', 'campus', 'videoFileId', 'stops', 'pushedAt'];
const GPS_TAB_CATALOG = 'Parts Catalog', GPS_TAB_AGVEH = 'Agency Vehicles', GPS_TAB_AGHIST = 'Agency History';
const GPS_CATALOG_COLS = ['key', 'model', 'code', 'lifeKm', 'lifeMonths', 'price', 'labour', 'spec', 'components', 'asOf', 'pushedAt'];
const GPS_AGVEH_COLS = ['chassis', 'reg', 'model', 'catalogModel', 'variant', 'engine', 'emission', 'year', 'warrantyDate', 'warrantyKm', 'recalls', 'asOf', 'pushedAt'];
const GPS_AGHIST_COLS = ['key', 'reg', 'chassis', 'jobCard', 'date', 'odometer', 'work', 'part', 'partNo', 'qty', 'partAmount', 'labour', 'asOf', 'pushedAt'];
const GPS_DAILY_COLS = ['reg', 'date', 'km', 'blindKm', 'firstMove', 'lastMove', 'nightLat', 'nightLng', 'nightPlace', 'nightAwayKm', 'maxKmh', 'minOver40'];
const GPS_STOP_COLS = ['bus', 'trip', 'seq', 'kind', 'place', 'arrive_usual', 'arrive_early', 'arrive_late', 'spread_min', 'dwell_min', 'days_seen', 'run_days', 'shared_with', 'lat', 'lng'];
const GPS_CHECK_COLS = ['id', 'campus', 'date', 'reg', 'litres', 'gpsKm', 'billKm', 'kmpl', 'norm', 'flag', 'reason', 'excessL', 'excessRs', 'proof'];
const GPS = {
  speedLimit: 40, speedMinutes: 10, awayKm: 2, deadDays: 2, longSilentDays: 14, blindShare: 0.2, blindMinKm: 30, ageLimit: 15,
  proofFrom: '2026-10-26', normSmall: 7.5, normBig: 5.0, smallSeats: 26, lowShare: 0.8, odoShare: 0.2, odoMinKm: 25, minCheckKm: 50, clerkDays: 2,
  due: { gps_dead: 3, gps_blind: 7, gps_none: 14, bus_away: 2, bus_speed: 3, fuel_check: 3, fuel_proof: 1, bus_age: 30, bus_inspection: 5, bus_equipment: 3, capture_route: 14 },
  inspectionDay: 5, // the monthly safety check is due by the 5th
  inspectionFrom: '2026-11', // set at deploy: the first month a safety check is asked for (no follow-up for months before it)
  captureFrom: '2026-12', // set at deploy: the first month a bus without a route timelapse gets capture_route
  catalogHistory: 100, // agency service-history rows the insight carries per bus (the newest); the tab keeps them all
  captureBatch: 20, // runs looked up in the Roster per capture push (about 2 Drive calls per stop): well inside UrlFetch's ~60 s
};
const GPS_DOMAINS = Object.keys(GPS.due);
const COORD_DEPT_TRANSPORT = 'Transport';

function gpsSheet_(name) {
  const ss = SpreadsheetApp.openById(COORD_TRANSPORT_FORM_ID);
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function gpsRows_(name) {
  const sh = SpreadsheetApp.openById(COORD_TRANSPORT_FORM_ID).getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getDataRange().getValues(), head = v[0];
  return v.slice(1).map(function (r) { const o = {}; head.forEach(function (h, i) { o[h] = r[i] instanceof Date ? Utilities.formatDate(r[i], 'Asia/Kolkata', 'yyyy-MM-dd') : r[i]; }); return o; });
}

function gpsWrite_(name, cols, objs) {
  const sh = gpsSheet_(name), all = [cols].concat(objs.map(function (o) { return cols.map(function (c) { return o[c] == null ? '' : String(o[c]); }); }));
  sh.clear();
  sh.getRange(1, 1, all.length, cols.length).setNumberFormat('@').setValues(all);
}

function gpsAddDays_(iso, n) {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** '2026-10-09' -> '9 Oct', with the year when it is not this year: dates as staff say them */
function gpsDay_(iso, today) {
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], s = String(iso || '');
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return s || 'never';
  return Number(s.slice(8, 10)) + ' ' + m[Number(s.slice(5, 7)) - 1] + (today && s.slice(0, 4) !== String(today).slice(0, 4) ? ' ' + s.slice(0, 4) : '');
}

function gpsCampusId_(campus) { return 'LMS' + String(campus).replace(/\D/g, ''); }

// ── Fuel checks: each fill against the GPS km since the bus's previous fill ──
/** fills [{id,campus,date,reg,litres,odometer,amount_rs,hasVideo,hasBill}], days [{reg,date,km}], seats {reg: n} -> checks (GPS_CHECK_COLS objects).
 *  The first fill of a bus has nothing to compare with and gives no check. */
function gpsFuelChecks_(fills, days, seats) {
  const km = {};
  days.forEach(function (d) { km[d.reg + '|' + d.date] = Number(d.km) || 0; });
  const tracked = {};
  days.forEach(function (d) { tracked[d.reg] = true; });
  const byReg = {};
  fills.forEach(function (f) { if (tracked[f.reg]) (byReg[f.reg] = byReg[f.reg] || []).push(f); });
  const out = [];
  Object.keys(byReg).forEach(function (reg) {
    const list = byReg[reg].sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : Number(a.odometer) - Number(b.odometer); });
    const own = []; // km/L of this bus's unflagged fills: its own norm once there are 4
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1], cur = list[i], litres = Number(cur.litres) || 0;
      let gpsKm = 0, missing = 0;
      for (let d = gpsAddDays_(prev.date, 1); d <= cur.date; d = gpsAddDays_(d, 1)) {
        if (km[reg + '|' + d] !== undefined) gpsKm += km[reg + '|' + d];
        else if (new Date(d + 'T00:00:00Z').getUTCDay() !== 0) missing++; // no fix at all on a Sunday is a parked bus; on a weekday the tracker may have been off
      }
      const odoOk = Number(prev.odometer) > 0 && Number(cur.odometer) > 0 && !prev.odometer_note && !cur.odometer_note; // a meter change or a pre-23-Oct row without one
      const billKm = odoOk ? Number(cur.odometer) - Number(prev.odometer) : '';
      if (!litres || gpsKm < GPS.minCheckKm) continue; // too little driving to judge (or a same-day top-up)
      const norm = own.length >= 4 ? own.slice().sort(function (a, b) { return a - b; })[Math.floor(own.length / 2)] : (Number(seats[reg]) || 99) <= GPS.smallSeats ? GPS.normSmall : GPS.normBig;
      const kmpl = gpsKm / litres, reasons = [];
      // with weekday gaps the GPS km is only a floor: never accuse a fill on it (spec: gaps are not called deliberate)
      if (missing) reasons.push('gps_gap');
      else {
        if (kmpl < GPS.lowShare * norm) reasons.push('low');
        if (odoOk && Math.abs(billKm - gpsKm) > Math.max(GPS.odoMinKm, GPS.odoShare * gpsKm)) reasons.push('odometer');
      }
      const excessL = reasons.indexOf('low') !== -1 ? Math.max(0, litres - gpsKm / norm) : 0;
      if (!reasons.length) own.push(kmpl);
      out.push({ id: String(cur.id), campus: String(cur.campus), date: String(cur.date), reg: reg, litres: litres, gpsKm: Math.round(gpsKm), billKm: billKm,
        kmpl: Math.round(kmpl * 10) / 10, norm: norm, flag: reasons.filter(function (r) { return r !== 'gps_gap'; }).length ? 'yes' : 'no', reason: reasons.join(' '),
        excessL: Math.round(excessL), excessRs: Math.round(excessL * ((Number(cur.amount_rs) || 0) / litres)),
        // what the day book holds for this fill: the driver's video and the bill photo ('bill' also for a row from before the two columns existed)
        proof: cur.hasVideo === 'yes' ? 'video+bill' : cur.hasBill === 'no' ? 'none' : 'bill' });
    }
  });
  return out;
}

/** A clerk's sentence for a flagged check: what is wrong, in rupees and litres, and what to do. */
function gpsCheckText_(c) {
  const what = c.reason.indexOf('low') !== -1
    ? c.litres + ' litres for ' + c.gpsKm + ' km of GPS driving (' + c.kmpl + ' km per litre; this bus should do about ' + c.norm + ')'
    : 'the bill odometer moved ' + c.billKm + ' km, but the GPS recorded ' + c.gpsKm + ' km';
  return c.reg + ', fuel on ' + gpsDay_(c.date) + ': ' + what + '.';
}

/** {reg: true} for trackers that count as silent: no signal for deadDays while another bus of the same district reported (school is
 *  running), or no signal for longSilentDays whatever the calendar. During Dussehra or a vacation a whole district goes quiet. */
function gpsSilent_(fleet, liveByReg, today) {
  const district = function (b) { const c = gpsCampusId_(b.campus); return (COORD_DISTRICTS[c] || [c]).join(); };
  const fresh = function (g) { return g && g.at && g.at.slice(0, 10) >= gpsAddDays_(today, -GPS.deadDays); };
  const running = {}, out = {};
  fleet.forEach(function (b) { if (fresh(liveByReg[b.reg])) running[district(b)] = true; });
  fleet.forEach(function (b) {
    const g = liveByReg[b.reg];
    if (g && !fresh(g) && (running[district(b)] || !g.at || g.at.slice(0, 10) < gpsAddDays_(today, -GPS.longSilentDays))) out[b.reg] = true;
  });
  return out;
}

// ── Follow-ups ──
/** Every follow-up the facts call for: [{taskId, domain, campus, title, detail, severity, due, auto}]. `auto` = may close by itself. */
function gpsFollowUps_(facts) {
  const t = facts.today, out = [], fleet = facts.fleet.filter(function (b) { return /^HP/.test(b.reg); }), live = {}, health = {}, answers = {};
  (facts.live || []).forEach(function (b) { live[b.reg] = b; });
  facts.health.forEach(function (h) { health[h.reg] = h; });
  facts.answers.forEach(function (a) { answers[a.id] = a; });
  const due = function (domain) { return gpsAddDays_(t, GPS.due[domain]); };
  const silent = gpsSilent_(fleet, live, t);
  // the monthly safety check (capture portal, Inspection mode): from the 5th, a running bus needs one this month; until then last
  // month's still counts, so a check that was missed stays open across the turn of the month instead of closing itself
  const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const dueMonth = Number(t.slice(8, 10)) >= GPS.inspectionDay ? t.slice(0, 7) : gpsAddDays_(t.slice(0, 7) + '-01', -1).slice(0, 7);
  const lastCheck = {}, lastAnswer = {}, loadout = {}; // per bus; per bus and item: the newest check that answered it (a check from an
  // older list on the phone may leave an item out, and leaving it out says nothing about it)
  (facts.inspections || []).slice().sort(function (a, b) { return a.day < b.day ? -1 : a.day > b.day ? 1 : 0; }).forEach(function (x) {
    lastCheck[x.reg] = x;
    Object.keys(x.items).forEach(function (id) { lastAnswer[x.reg + '|' + id] = { a: x.items[id], day: x.day }; });
  });
  (facts.loadout || []).forEach(function (i) { loadout[i.id] = i; }); // active items only: a switched-off item raises nothing
  const add = function (o) { out.push(Object.assign({ due: due(o.domain), auto: false }, o)); };
  fleet.forEach(function (b) {
    if (!b.operational) return;
    const c = gpsCampusId_(b.campus), drv = b.driver ? ' (driver ' + b.driver + ')' : '', g = live[b.reg], h = health[b.reg];
    if (!facts.live) { /* vendor unreachable: say nothing about tracker presence this time */ }
    else if (!g) add({ taskId: 'gps_none|' + b.reg, domain: 'gps_none', campus: c, severity: 'medium', auto: true,
      title: b.reg + ': no GPS tracker', detail: 'School buses must have a working GPS tracker (HP rules, 2018). Get one fitted and connected to the school account, then mark this done with the date it was fitted.' });
    else if (silent[b.reg]) add({ taskId: 'gps_dead|' + b.reg, domain: 'gps_dead', campus: c, severity: 'high', auto: true,
      title: b.reg + ': GPS tracker silent since ' + gpsDay_(g.at ? g.at.slice(0, 10) : '', t), detail: 'Call Blackbox and ask them to repair it. Write their complaint number when you mark this done.' });
    if (h && h.blind7 >= GPS.blindMinKm && h.blind7 >= GPS.blindShare * h.km7) add({ taskId: 'gps_blind|' + b.reg, domain: 'gps_blind', campus: c, severity: 'medium', auto: true,
      title: b.reg + ': ' + Math.round(h.blind7) + ' of ' + Math.round(h.km7) + ' km in 7 days driven with the tracker dark', detail: 'Ask Blackbox to check the tracker\'s power wiring' + drv + '. Write their complaint number when you mark this done.' });
    const age = Number(b.year) ? Number(t.slice(0, 4)) - Number(b.year) : 0;
    if (age >= GPS.ageLimit - 1) add({ taskId: 'bus_age|' + b.reg, domain: 'bus_age', campus: c, severity: age >= GPS.ageLimit ? 'high' : 'medium', auto: true,
      title: b.reg + ': registered ' + b.year + (age >= GPS.ageLimit ? ', over the 15-year limit for school buses' : ', reaches the 15-year limit in ' + (Number(b.year) + GPS.ageLimit)),
      detail: 'HP rules (2018) allow school vehicles up to 15 years. Send the Owner a plan: replace, merge its route into another bus, or retire it.' });
    const chk = lastCheck[b.reg];
    if (facts.inspections && dueMonth >= GPS.inspectionFrom && (!facts.loadout || facts.loadout.length) && !(chk && chk.day >= dueMonth + '-01')) add({ taskId: 'bus_inspection|' + b.reg, domain: 'bus_inspection', campus: c, severity: 'medium', auto: true,
      title: b.reg + ': no safety check in ' + MON[Number(dueMonth.slice(5, 7)) - 1], detail: 'Do this month\'s safety check in the capture portal' });
    // every active item whose newest answer for this bus is not a Yes, until a later check has it
    Object.keys(loadout).forEach(function (id) {
      const last = lastAnswer[b.reg + '|' + id], item = loadout[id];
      if (!last || last.a.ok === true) return; // a switched-off item is not in `loadout`: nothing new (gpsInspectionCover_ leaves its open one alone)
      add({ taskId: 'bus_equipment|' + b.reg + '|' + id, domain: 'bus_equipment', campus: c, severity: 'high', auto: true,
        title: b.reg + ': ' + item.label + ' missing in the safety check of ' + gpsDay_(last.day, t), detail: 'Get it fitted or repaired, then check it again in the capture portal.' });
    });
    if (facts.captured && t.slice(0, 7) >= GPS.captureFrom && !facts.captured[b.reg]) add({ taskId: 'capture_route|' + b.reg, domain: 'capture_route', campus: c, severity: 'medium', auto: true,
      title: b.reg + ': no route timelapse yet', detail: 'Ask the Fee Clerk to send the school phone on this route\'s next empty run, and do the timelapse run' });
  });
  const bus = {};
  fleet.forEach(function (b) { bus[b.reg] = b; });
  const week = facts.days.filter(function (d) { return d.date > gpsAddDays_(t, -7); });
  week.forEach(function (d) {
    const b = bus[d.reg]; if (!b) return;
    if (Number(d.nightAwayKm) > GPS.awayKm && Number(d.km) > 5) add({ taskId: 'bus_away|' + d.reg + '|' + d.date, domain: 'bus_away', campus: gpsCampusId_(b.campus), severity: 'medium',
      title: d.reg + ' parked ' + d.nightAwayKm + ' km from its usual place on the night of ' + gpsDay_(d.date), detail: 'Call the driver' + (b.driver ? ' ' + b.driver : '') + ' and ask why. Write the reason when you mark this done. Last position: ' + d.nightPlace + '.' });
  });
  // speeding per calendar week (this week so far, and last week), so a week is reported once
  const thisMonday = gpsAddDays_(t, -((new Date(t + 'T00:00:00Z').getUTCDay() + 6) % 7));
  [gpsAddDays_(thisMonday, -7), thisMonday].forEach(function (monday) {
    const over = {}, sunday = gpsAddDays_(monday, 6);
    facts.days.forEach(function (d) { if (d.date >= monday && d.date <= sunday) over[d.reg] = (over[d.reg] || 0) + Number(d.minOver40 || 0); });
    Object.keys(over).forEach(function (reg) {
      const b = bus[reg]; if (!b || over[reg] < GPS.speedMinutes) return;
      add({ taskId: 'bus_speed|' + reg + '|' + monday, domain: 'bus_speed', campus: gpsCampusId_(b.campus), severity: over[reg] >= 3 * GPS.speedMinutes ? 'high' : 'medium',
        title: reg + ': about ' + over[reg] + ' minutes above 40 km/h in the week of ' + gpsDay_(monday), detail: 'Warn the driver' + (b.driver ? ' ' + b.driver : '') + ': the legal limit for school buses is 40 km/h. Write "warned on <date>" when you mark this done.' });
    });
  });
  facts.checks.forEach(function (c) {
    if (c.flag !== 'yes') return;
    const a = answers[c.id], waited = !a && c.date < gpsAddDays_(t, -GPS.clerkDays);
    // "corrected" means the day book entry was reversed and re-entered, which gives a new id: the same id days later was not corrected
    const unchanged = a && a.answer === 'corrected' && String(a.at).slice(0, 10) < gpsAddDays_(t, -GPS.clerkDays);
    if (!(a && a.answer === 'matches') && !waited && !unchanged) return;
    add({ taskId: 'fuel_check|' + c.id, domain: 'fuel_check', campus: gpsCampusId_(c.campus), severity: c.excessRs > 2000 ? 'high' : 'medium',
      title: gpsCheckText_(c), detail: (unchanged ? 'The fee clerk said the bill was corrected, but the day book entry is unchanged. ' : a ? 'The fee clerk checked the pump slip: it matches the bill. ' : 'The fee clerk has not checked the pump slip in ' + GPS.clerkDays + ' days. ') +
        'Ask the driver to explain' + (c.excessRs ? ' about ' + c.excessL + ' extra litres (Rs ' + c.excessRs + ')' : '') + '. If it cannot be explained, recover the cost. Write the outcome when you mark this done.' });
  });
  // every fill in the Fuel Fills mirror (checked against the GPS or not: a bus's first fill, a top-up, a bus without a tracker) with no
  // video 2 days after its date: get it from the driver. Dates carry no time of day, so a fill dated yesterday may be under 24 hours old. Closes itself when the video is attached or the fill is gone. 'no' only: a mirror
  // row written before the hasVideo column existed says nothing.
  (facts.fills || []).forEach(function (f) {
    if (f.hasVideo !== 'no' || f.date < GPS.proofFrom || f.date > gpsAddDays_(t, -2)) return;
    add({ taskId: 'fuel_proof|' + f.id, domain: 'fuel_proof', campus: gpsCampusId_(f.campus), severity: 'medium', auto: true,
      title: f.reg + ', fuel on ' + gpsDay_(f.date, t) + ': no video of the fill', detail: 'Get the fill video from the driver and attach it to the fuel entry.' });
  });
  return out;
}

/** The coordinator who answers for a campus: the one Coordinator whose campus (or district) covers it, else nobody. */
function gpsOwners_() {
  const rows = SpreadsheetApp.openById(COORD_ALLOWLIST_SHEET_ID).getSheets()[0].getDataRange().getValues().slice(1), by = {};
  rows.forEach(function (r) {
    const roles = String(r[3] || '').split(',').map(function (x) { return x.trim(); }), id = String(r[2] || '').trim().toUpperCase();
    if (!r[0] || roles.indexOf('Coordinator') === -1 || !id || id === 'ALL') return;
    (COORD_DISTRICTS[id] || [id]).forEach(function (c) { (by[c] = by[c] || []).push(String(r[0]).trim().toLowerCase()); });
  });
  const out = {};
  Object.keys(by).forEach(function (c) { if (by[c].length === 1) out[c] = by[c][0]; });
  return out;
}

/** Upserts the wanted follow-ups and closes self-clearing ones whose condition is gone. `covered` = {domain: {reg: true}, or domain: true when this run looked at every one of them}:
 *  a self-clearing follow-up is closed only if this run looked at its vehicle. A closed self-clearing follow-up whose problem is
 *  back reopens -- at once if the system closed it, after its due window if a person did (Blackbox gets time to repair). */
function gpsRaise_(wanted, covered) {
  const owners = gpsOwners_(), live = {}, now = new Date(), today = Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = coordSheet_(), rows = sh.getDataRange().getValues();
    wanted.forEach(function (w) {
      live[w.taskId] = true;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] !== w.taskId || rows[i][5] === 'open' || !w.auto) continue;
        const at = rows[i][9] instanceof Date ? Utilities.formatDate(rows[i][9], 'Asia/Kolkata', 'yyyy-MM-dd') : String(rows[i][9] || '').slice(0, 10);
        if (String(rows[i][10]).indexOf('system') !== 0 && at > gpsAddDays_(today, -GPS.due[w.domain])) break; // a person closed it recently
        sh.getRange(i + 1, 6).setValue('open');
        sh.getRange(i + 1, 10, 1, 3).setValues([['', '', 'reopened ' + today + (rows[i][11] ? ' (before: ' + rows[i][11] + ')' : '')]]);
        sh.getRange(i + 1, 15).setNumberFormat('@').setValue(w.due);
        rows[i][5] = 'open';
      }
      coordTaskUpsert_(sh, rows, { taskId: w.taskId, domain: w.domain, campus: w.campus, title: w.title, detail: w.detail, severity: w.severity,
        department: COORD_DEPT_TRANSPORT, assignee: owners[w.campus] || '', due: w.due });
    });
    for (let i = 1; i < rows.length; i++) {
      const id = String(rows[i][0]), dom = rows[i][1], reg = id.split('|')[1], rest = id.slice(String(dom).length + 1);
      // true: every follow-up of the domain; else keyed by vehicle, or by everything after the domain ('HP1|fire_extinguisher')
      if (rows[i][5] !== 'open' || live[id] || !covered[dom] || (covered[dom] !== true && !covered[dom][reg] && !covered[dom][rest])) continue;
      sh.getRange(i + 1, 6).setValue('resolved');
      sh.getRange(i + 1, 10, 1, 2).setValues([[now, 'system (condition cleared)']]);
      rows[i][5] = 'resolved';
    }
  } finally { lock.releaseLock(); }
}

// ── Push from the Mac ──
/** POST action=transportgpspush {secret, payload:{syncedAt, days, health, bases, stops, proposals}} */
function coordGpsPush_(body) {
  if (!coordTransportSecretOk_(body.secret)) return { success: false, error: 'Not authorized' };
  const p = body.payload || {};
  if (!Array.isArray(p.days) || !p.days.length || !Array.isArray(p.health) || !p.health.length) return { success: false, error: 'Payload rejected: no GPS days or trackers' };
  gpsWrite_(GPS_TAB_DAILY, GPS_DAILY_COLS, p.days);
  gpsWrite_(GPS_TAB_STOPS, GPS_STOP_COLS, p.stops || []);
  // one drawn road path per bus and trip (a typical day, simplified on the Mac): the route maps draw these, not stop-to-stop lines
  gpsWrite_(GPS_TAB_TRACKS, ['reg', 'trip', 'date', 'path'], (p.tracks || []).map(function (t) { return { reg: t.reg, trip: t.trip, date: t.date, path: JSON.stringify(t.path) }; }));
  gpsWrite_(GPS_TAB_META, ['key', 'value'], [{ key: 'syncedAt', value: p.syncedAt }, { key: 'health', value: JSON.stringify(p.health) },
    { key: 'bases', value: JSON.stringify(p.bases || []) }, { key: 'proposals', value: JSON.stringify(p.proposals || {}) },
    { key: 'fleetExtra', value: JSON.stringify(p.fleetExtra || []) }]);
  const n = gpsRefresh_(p.days, p.health);
  CacheService.getScriptCache().remove('coord_gps_insight_v1');
  return { success: true, days: p.days.length, checks: n.checks, followUps: n.followUps };
}

/** Recomputes the fuel checks and the follow-ups from the stored facts (also after a clerk answers). */
function gpsRefresh_(days, health) {
  const base = coordTransportBase_(), seats = {};
  base.fleet.forEach(function (b) { seats[b.reg] = b.seats; });
  const fills = gpsRows_(GPS_TAB_FILLS), checks = gpsFuelChecks_(fills, days, seats);
  gpsWrite_(GPS_TAB_CHECKS, GPS_CHECK_COLS, checks);
  const today = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  let live = null;
  try { live = coordBusFetch_().buses; } catch (err) { console.error('GPS live feed: ' + err.message); }
  if (live && !live.length) live = null; // an empty answer (bad id, vendor glitch) must not read as "no bus has a tracker"
  const inspections = coordInspections_(), loadout = coordLoadoutAll_().filter(function (i) { return i.active; });
  const wanted = gpsFollowUps_({ today: today, fleet: base.fleet, live: live, health: health, days: days, checks: checks, fills: fills, answers: gpsRows_(GPS_TAB_ANSWERS),
    inspections: inspections || [], loadout: loadout, captured: gpsCaptured_() }); // no Capture Runs tab: no check has been sent, so the monthly ones are due (but nothing closes, below)
  // which vehicles each self-clearing check actually looked at this time: only those may be closed by it
  const fleetRegs = {}, healthRegs = {};
  base.fleet.forEach(function (b) { fleetRegs[b.reg] = true; });
  health.forEach(function (h) { healthRegs[h.reg] = true; });
  const cover = gpsInspectionCover_(base.fleet, inspections, loadout);
  gpsRaise_(wanted, { gps_blind: healthRegs, gps_dead: live ? fleetRegs : {}, gps_none: live ? fleetRegs : {}, bus_age: fleetRegs, fuel_proof: true,
    bus_inspection: cover.bus_inspection, bus_equipment: cover.bus_equipment, capture_route: fleetRegs });
  return { checks: checks.length, followUps: wanted.length };
}

/** What the safety-check follow-ups may close: the fleet's buses for bus_inspection, and each bus x ACTIVE item for bus_equipment
 *  (an item switched off or gone is not "fixed": its open follow-up waits for a person). Nothing when Capture Runs is unreadable. */
function gpsInspectionCover_(fleet, inspections, loadout) {
  const ins = {}, eq = {};
  if (inspections) fleet.forEach(function (b) {
    ins[b.reg] = true;
    (loadout || []).forEach(function (i) { eq[b.reg + '|' + i.id] = true; });
  });
  return { bus_inspection: ins, bus_equipment: eq };
}

// ── Capture timelapses: the Mac pulls the runs to process and pushes back the processed ones ──
/** POST action=transportcapturepull {secret} -> {success, runs:[{runId, reg, kind, status, frames, startedAt, endedAt, stops, frameTimes, done}]}:
 *  the ended timelapse runs of the Capture Runs tab. The Mac finds the files in its Drive copy, Capture/<REG>/<runId>/. frameTimes
 *  (seconds since startedAt by seq) is null when the phone sent none; `done` = already in Capture Stops, so not pushed again. */
function coordCapturePull_(body) {
  if (!coordTransportSecretOk_(body.secret)) return { success: false, error: 'Not authorized' };
  const sh = SpreadsheetApp.openById(COORD_TRANSPORT_FORM_ID).getSheetByName(COORD_TRANSPORT_TAB_CAPTURE), runs = [], stored = {};
  gpsRows_(GPS_TAB_CAPTURE).forEach(function (r) { if (r.videoFileId) stored[r.runId] = true; });
  const list = function (cell) { let v = null; try { v = JSON.parse(String(cell || 'null')); } catch (e) { v = null; } return Array.isArray(v) ? v : null; };
  (sh ? sh.getDataRange().getValues().slice(1) : []).forEach(function (r) { // Run ID | Reg | Campus | Kind | Started | Ended | By | Role | Frames | Gaps | Stops | Inspection | Status | Frame Times
    if (String(r[3]) !== 'timelapse' || String(r[12]) !== 'ended') return;
    runs.push({ runId: String(r[0]), reg: String(r[1]), kind: 'timelapse', status: 'ended', frames: Number(r[8]) || 0, startedAt: r[4], endedAt: r[5],
      stops: list(r[10]) || [], frameTimes: list(r[13]), done: !!stored[String(r[0])] });
  });
  return { success: true, runs: runs };
}

/** One stop as stored and served: counts of children, never names; the stop's name is the place. */
function gpsCaptureStop_(s) {
  const n = function (v) { return Math.max(0, Math.floor(Number(v)) || 0); }, f = function (v) { return v === '' || v == null || !isFinite(Number(v)) ? '' : Number(v); };
  return { seq: n(s.seq), name: String(s.name || '').slice(0, 80), lat: f(s.lat), lng: f(s.lng), at: String(s.at || '').slice(0, 30), photoFileId: gpsDriveId_(s.photoFileId), boardOn: n(s.boardOn), boardOff: n(s.boardOff) };
}

/** A Drive file id, or '' (the Mac sends '' until Drive has uploaded the file). */
function gpsDriveId_(v) { return /^[A-Za-z0-9_-]{10,128}$/.test(String(v || '')) ? String(v) : ''; }

/** POST action=transportcapturepush {secret, payload:{runs:[{runId, reg, stops:[{seq,name,lat,lng,at,boardOn,boardOff,photo}]}]}}.
 *  The video and stop-photo ids are looked up in the Roster project (gpsCaptureFiles_): only the Mac's blurred output is ever served,
 *  whatever a push says. `photo: true` = the Mac has a blurred photo of that stop. Drive uploads route.mp4 and the photos one by
 *  one, so a run is stored only once the video AND every such photo have an id; until then it comes back in `notYet` (not stored,
 *  so not done) and is pushed again tomorrow. At most GPS.captureBatch runs are looked up per push; the rest come back in `later`.
 *  Upsert by runId into Capture Stops (a push never removes another run); a bus not in the fleet is skipped. Then the follow-ups refresh. */
function coordCapturePush_(body) {
  if (!coordTransportSecretOk_(body.secret)) return { success: false, error: 'Not authorized' };
  const runs = (body.payload || {}).runs;
  if (!Array.isArray(runs)) return { success: false, error: 'Payload rejected: runs must be a list' };
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i] || {};
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(r.runId || '')) || String(r.runId).indexOf(String(r.reg) + '-') !== 0 || !Array.isArray(r.stops))
      return { success: false, error: 'Payload rejected: run ' + (i + 1) + ' needs a runId of its bus and a stops list' };
  }
  const campusOf = {}, now = new Date().toISOString(), skipped = [], notYet = [], fresh = [];
  coordTransportBase_().fleet.forEach(function (b) { campusOf[b.reg] = gpsCampusId_(b.campus); });
  const known = runs.filter(function (r) { if (!campusOf[r.reg]) skipped.push(String(r.runId)); return !!campusOf[r.reg]; });
  const mine = known.slice(0, GPS.captureBatch), later = known.slice(GPS.captureBatch).map(function (r) { return String(r.runId); });
  const files = mine.length ? gpsCaptureFiles_(mine) : { found: {} };
  if (files.error) return { success: false, error: files.error };
  mine.forEach(function (r) {
    const f = files.found[r.runId], photos = (f && f.photos) || {};
    const missing = function (s) { return s && s.photo === true && !gpsDriveId_(photos[Number(s.seq)]); };
    if (!f || !gpsDriveId_(f.videoFileId) || r.stops.some(missing)) { notYet.push(String(r.runId)); return; }
    fresh.push({ runId: String(r.runId), reg: r.reg, campus: campusOf[r.reg], videoFileId: f.videoFileId, pushedAt: now,
      stops: JSON.stringify(r.stops.map(function (s) { const x = gpsCaptureStop_(s || {}); x.photoFileId = gpsDriveId_(photos[x.seq]); return x; })) });
  });
  if (fresh.length) {
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const ids = {};
      fresh.forEach(function (r) { ids[r.runId] = true; });
      gpsWrite_(GPS_TAB_CAPTURE, GPS_CAPTURE_COLS, gpsRows_(GPS_TAB_CAPTURE).filter(function (r) { return !ids[r.runId]; }).concat(fresh));
    } finally { lock.releaseLock(); }
    try { gpsRefresh_(gpsRows_(GPS_TAB_DAILY), gpsMeta_().health); } catch (err) { console.error('GPS refresh after capture push: ' + err.message); } // the next GPS push retries
    CacheService.getScriptCache().remove('coord_gps_insight_v1');
  }
  return { success: true, runs: fresh.length, notYet: notYet, later: later, skipped: skipped };
}

/** Asks the Roster project (the one with Drive access) for the processed files' ids: {found:{runId:{videoFileId, photos:{seq:id}}}} or {error}. */
function gpsCaptureFiles_(runs) {
  const secret = String(PropertiesService.getScriptProperties().getProperty('TRANSPORT_PUSH_SECRET') || '').trim();
  const res = UrlFetchApp.fetch(COORD_ROSTER_URL, { method: 'post', contentType: 'text/plain', muteHttpExceptions: true, followRedirects: true,
    payload: JSON.stringify({ action: 'captureprocessed', secret: secret, runs: runs.map(function (r) {
      return { reg: r.reg, runId: String(r.runId), stops: r.stops.filter(function (s) { return s && s.photo === true; }).map(function (s) { return Number(s.seq); }) };
    }) }) });
  let out = null;
  try { out = JSON.parse(res.getContentText()); } catch (e) { out = null; }
  if (res.getResponseCode() !== 200 || !out || !out.success) return { error: 'Roster lookup of the processed files failed: ' + ((out && out.error) || 'HTTP ' + res.getResponseCode()) };
  return { found: out.found || {} };
}

/** {reg: true} for every bus with a processed timelapse. */
function gpsCaptured_() {
  const out = {};
  gpsRows_(GPS_TAB_CAPTURE).forEach(function (r) { out[r.reg] = true; });
  return out;
}

/** {reg: {runId, videoFileId, stops}}: each visible bus's newest processed run (runIds sort by time: <REG>-<yyyyMMdd-HHmmss>-<4>). */
function gpsCaptureByReg_(regs) {
  const out = {};
  gpsRows_(GPS_TAB_CAPTURE).forEach(function (r) {
    if (!regs[r.reg] || (out[r.reg] && out[r.reg].runId > r.runId)) return;
    let stops = [];
    try { stops = JSON.parse(r.stops || '[]'); } catch (e) { stops = []; } // a cut-off or hand-edited cell must not break the page
    out[r.reg] = { runId: r.runId, videoFileId: r.videoFileId, stops: Array.isArray(stops) ? stops : [] };
  });
  return out;
}

// ── Agency service data: the parts catalog ──

function gpsCatNum_(v) { return typeof v === 'number' && isFinite(v) && v >= 0 ? v : ''; }
function gpsCatNumOut_(v) { return v === '' || v == null || !isFinite(Number(v)) ? null : Number(v); }
function gpsCatStr_(v) { return v == null ? '' : String(v).trim().slice(0, 500); }
function gpsCatReg_(v) { return gpsCatStr_(v).replace(/[^A-Za-z0-9]/g, '').toUpperCase(); } // as officeNormReg_ / tupNormReg_ do: HP-66-5805 is HP665805
function gpsCatAsOf_(v, now) { const a = gpsCatStr_(v); return /^\d{4}-\d{2}-\d{2}(T[\d:]+)?$/.test(a) ? a : a ? null : now.slice(0, 19); } // null: not an ISO stamp; none given: the push time
function gpsCatDate_(v) { return /^\d{4}-\d{2}-\d{2}$/.test(v); }

/** POST action=transportcatalogpush {secret, payload:{models:[{model, parts:{code:{lifeKm, lifeMonths, price, labour, spec, components, asOf}}}],
 *  vehicles:[{chassis, reg, model, ...}], history:[{reg, chassis, jobCard, date, odometer, work, part, partNo, qty, partAmount, labour}]}}.
 *  Idempotent: a part is keyed by model and code (an older asOf never replaces a newer one), a vehicle by chassis, a history row by its
 *  job card line, so pushing the same file again adds nothing. A push never removes rows. Money stays in these tabs and the insight. */
function coordCatalogPush_(body) {
  if (!coordTransportSecretOk_(body.secret)) return { success: false, error: 'Not authorized' };
  const p = body.payload || {};
  if (!Array.isArray(p.models) || !Array.isArray(p.vehicles) || !Array.isArray(p.history)) return { success: false, error: 'Payload rejected: models, vehicles and history must be lists' };
  const now = new Date().toISOString(), parts = [], vehicles = [], history = [];
  for (let i = 0; i < p.models.length; i++) {
    const m = p.models[i] || {}, model = gpsCatStr_(m.model);
    if (!model || !m.parts || typeof m.parts !== 'object' || Array.isArray(m.parts)) return { success: false, error: 'Payload rejected: model ' + (i + 1) + ' needs a name and its parts' };
    const codes = Object.keys(m.parts);
    for (let k = 0; k < codes.length; k++) {
      if (!/^[A-Za-z0-9_]{1,40}$/.test(codes[k]) || gpsCatAsOf_((m.parts[codes[k]] || {}).asOf, now) === null) return { success: false, error: 'Payload rejected: part ' + codes[k] + ' of ' + model + ' needs a plain code and an ISO asOf' };
    }
    codes.forEach(function (code) {
      const x = m.parts[code] || {};
      parts.push({ key: model + '|' + code, model: model, code: code, lifeKm: gpsCatNum_(x.lifeKm), lifeMonths: gpsCatNum_(x.lifeMonths), price: gpsCatNum_(x.price),
        labour: gpsCatNum_(x.labour), spec: gpsCatStr_(x.spec), components: Array.isArray(x.components) ? x.components.map(gpsCatStr_).join(',') : '', asOf: gpsCatAsOf_(x.asOf, now), pushedAt: now });
    });
  }
  for (let i = 0; i < p.vehicles.length; i++) {
    const v = p.vehicles[i] || {};
    if (!gpsCatStr_(v.chassis)) return { success: false, error: 'Payload rejected: vehicle ' + (i + 1) + ' needs its chassis number' };
    if (gpsCatAsOf_(v.asOf, now) === null) return { success: false, error: 'Payload rejected: vehicle ' + (i + 1) + ' asOf must be an ISO date' };
    if (gpsCatStr_(v.warrantyDate) && !gpsCatDate_(gpsCatStr_(v.warrantyDate))) return { success: false, error: 'Payload rejected: vehicle ' + (i + 1) + ' warranty date must be yyyy-mm-dd' };
    vehicles.push({ chassis: gpsCatStr_(v.chassis), reg: gpsCatReg_(v.reg), model: gpsCatStr_(v.model), catalogModel: gpsCatStr_(v.catalogModel), variant: gpsCatStr_(v.variant), engine: gpsCatStr_(v.engine),
      emission: gpsCatStr_(v.emission), year: gpsCatNum_(v.year), warrantyDate: gpsCatStr_(v.warrantyDate), warrantyKm: gpsCatNum_(v.warrantyKm), recalls: gpsCatStr_(v.recalls), asOf: gpsCatAsOf_(v.asOf, now), pushedAt: now });
  }
  for (let i = 0; i < p.history.length; i++) {
    const h = p.history[i] || {};
    if (!gpsCatStr_(h.chassis) || !gpsCatDate_(gpsCatStr_(h.date))) return { success: false, error: 'Payload rejected: history row ' + (i + 1) + ' needs a chassis number and a yyyy-mm-dd date' };
    const row = { reg: gpsCatReg_(h.reg), chassis: gpsCatStr_(h.chassis), jobCard: gpsCatStr_(h.jobCard), date: gpsCatStr_(h.date), odometer: gpsCatNum_(h.odometer), work: gpsCatStr_(h.work),
      part: gpsCatStr_(h.part), partNo: gpsCatStr_(h.partNo), qty: gpsCatStr_(h.qty), partAmount: gpsCatNum_(h.partAmount), labour: gpsCatNum_(h.labour), asOf: gpsCatAsOf_(h.asOf, now), pushedAt: now };
    if (row.asOf === null) return { success: false, error: 'Payload rejected: history row ' + (i + 1) + ' asOf must be an ISO date' };
    row.key = [row.chassis, row.jobCard, row.date, row.part, row.partNo, row.qty].join('|'); // ponytail: two identical lines on one job card count as one
    history.push(row);
  }
  const unresolved = [];
  let storedCount = 0;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    // the newest asOf wins per row, whole (blanks included: an agency can clear a price, close a recall); an older row changes nothing;
    // `identity` fields are never blanked (a bus must stay findable)
    const upsert = function (tab, cols, keyOf, fresh, identity) {
      const by = {}, order = [];
      gpsRows_(tab).forEach(function (r) { by[keyOf(r)] = r; order.push(keyOf(r)); });
      fresh.forEach(function (r) {
        const k = keyOf(r), old = by[k];
        if (old && String(old.asOf) > r.asOf) return;
        if (!old) order.push(k);
        else identity.forEach(function (c) { if (r[c] === '' && old[c]) r[c] = old[c]; });
        by[k] = r;
      });
      const seen = {};
      gpsWrite_(tab, cols, order.filter(function (k) { return seen[k] ? false : (seen[k] = true); }).map(function (k) { return by[k]; }));
    };
    upsert(GPS_TAB_CATALOG, GPS_CATALOG_COLS, function (r) { return r.key; }, parts, []);
    upsert(GPS_TAB_AGVEH, GPS_AGVEH_COLS, function (r) { return r.chassis; }, vehicles, ['reg', 'catalogModel']);
    // history rows come without a reg when the chassis was not on this push's vehicle sheets: the stored vehicles know it
    const regOf = {};
    gpsRows_(GPS_TAB_AGVEH).forEach(function (v) { if (v.reg) regOf[v.chassis] = v.reg; });
    const stored = [];
    history.forEach(function (h) { h.reg = h.reg || regOf[h.chassis] || ''; if (h.reg) stored.push(h); else if (unresolved.indexOf(h.chassis) === -1) unresolved.push(h.chassis); });
    upsert(GPS_TAB_AGHIST, GPS_AGHIST_COLS, function (r) { return r.key; }, stored, ['reg']);
    storedCount = stored.length;
  } finally { lock.releaseLock(); }
  CacheService.getScriptCache().remove('coord_gps_insight_v1');
  return { success: true, parts: parts.length, vehicles: vehicles.length, history: storedCount, unresolved: unresolved };
}

/** The catalog for the insight: {models:{model:{parts:{code:{...}}}}, vehicles, history}. Models and parts for everyone; vehicles and history of the visible buses only. */
function gpsCatalog_(regs) {
  const models = {}, num = gpsCatNumOut_, n = {};
  gpsRows_(GPS_TAB_CATALOG).forEach(function (r) {
    (models[r.model] = models[r.model] || { parts: {} }).parts[r.code] = { lifeKm: num(r.lifeKm), lifeMonths: num(r.lifeMonths), price: num(r.price), labour: num(r.labour),
      spec: r.spec || '', components: r.components ? String(r.components).split(',') : [], asOf: r.asOf || '' };
  });
  return {
    models: models,
    vehicles: gpsRows_(GPS_TAB_AGVEH).filter(function (v) { return regs[v.reg]; }).map(function (v) {
      return { chassis: v.chassis, reg: v.reg, model: v.model, catalogModel: v.catalogModel, variant: v.variant, engine: v.engine, emission: v.emission, year: num(v.year), warrantyDate: v.warrantyDate, warrantyKm: num(v.warrantyKm), recalls: v.recalls };
    }),
    history: gpsRows_(GPS_TAB_AGHIST).filter(function (h) { return regs[h.reg]; }).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; }).filter(function (h) {
      n[h.reg] = (n[h.reg] || 0) + 1; return n[h.reg] <= GPS.catalogHistory; // the newest GPS.catalogHistory per bus
    }).map(function (h) {
      return { reg: h.reg, chassis: h.chassis, jobCard: h.jobCard, date: h.date, odometer: num(h.odometer), work: h.work, part: h.part, partNo: h.partNo, qty: h.qty, partAmount: num(h.partAmount), labour: num(h.labour) };
    }),
  };
}

// ── Reads ──
function gpsMeta_() {
  const m = {};
  gpsRows_(GPS_TAB_META).forEach(function (r) { m[r.key] = r.value; });
  return { syncedAt: m.syncedAt || '', health: JSON.parse(m.health || '[]'), bases: JSON.parse(m.bases || '[]'), proposals: JSON.parse(m.proposals || '{}'),
    fleetExtra: JSON.parse(m.fleetExtra || '[]') };
}

/** GET action=coordinatortransportinsight: everything the Coordinator page needs, scoped to the caller's campuses; money and proposals for the Owner. */
function coordGpsInsight_(caller) {
  const visible = coordVisibleCampuses_(caller), owner = caller.roles.indexOf('Owner') !== -1;
  const base = coordTransportBase_(), campusOf = {}, meta = gpsMeta_();
  base.fleet.forEach(function (b) { campusOf[b.reg] = gpsCampusId_(b.campus); });
  const mine = function (campusId) { return !visible || visible.indexOf(campusId) !== -1; };
  const live = {};
  let liveOk = true;
  try { const l = coordBusFetch_().buses; l.forEach(function (b) { live[b.reg] = b; }); liveOk = l.length > 0; } catch (err) { liveOk = false; }
  const health = {};
  meta.health.forEach(function (h) { health[h.reg] = h; });
  const today = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  const silent = gpsSilent_(base.fleet, live, today), extra = {};
  meta.fleetExtra.forEach(function (x) { extra[x.reg] = x; });
  const vehicles = base.fleet.filter(function (b) { return /^HP/.test(b.reg) && mine(campusOf[b.reg]); }).map(function (b) {
    const g = live[b.reg], h = health[b.reg] || {};
    const state = !liveOk ? 'unknown' : !g ? 'none' : silent[b.reg] ? 'dead' : h.blind7 >= GPS.blindMinKm && h.blind7 >= GPS.blindShare * h.km7 ? 'blind' : 'ok';
    const x = extra[b.reg] || {};
    return { reg: b.reg, campus: b.campus, campusId: campusOf[b.reg], operational: b.operational, route: b.route, driver: b.driver, seats: b.seats, year: b.year,
      tracker: state, lastFix: g ? g.at : '', km7: h.km7 || 0, blind7: h.blind7 || 0, rounds: x.rounds || null, students: x.students || null, start: x.start || b.start || '' };
  });
  const regs = {};
  vehicles.forEach(function (v) { regs[v.reg] = true; });
  const tasks = coordSheet_().getDataRange().getValues().slice(1).filter(function (r) {
    return GPS_DOMAINS.indexOf(r[1]) !== -1 && (mine(r[2]) || r[13] === caller.email);
  }).map(function (r) {
    return { taskId: r[0], domain: r[1], campus: r[2], title: r[3], detail: r[4], status: r[5], severity: coordDueSeverity_(r[6], coordDueIso_(r[14]), today),
      createdAt: r[7] instanceof Date ? r[7].toISOString() : String(r[7]), resolvedAt: r[9] instanceof Date ? r[9].toISOString() : String(r[9] || ''),
      resolvedBy: r[10] || '', note: r[11] || '', assignee: r[13] || '', due: coordDueIso_(r[14]) };
  }).filter(function (x) { return x.status === 'open' || x.resolvedAt >= gpsAddDays_(today, -30); }); // open, plus the last 30 days' outcomes
  const checks = gpsRows_(GPS_TAB_CHECKS).filter(function (c) { return regs[c.reg]; });
  const answers = {};
  gpsRows_(GPS_TAB_ANSWERS).forEach(function (a) { answers[a.id] = a; });
  checks.forEach(function (c) { const a = answers[c.id]; if (a) { c.answer = a.answer; c.answeredBy = a.by; c.answeredAt = a.at; } });
  return {
    success: true, syncedAt: meta.syncedAt, today: today, owner: owner, liveOk: liveOk, vehicles: vehicles, tasks: tasks, checks: checks,
    days: gpsRows_(GPS_TAB_DAILY).filter(function (d) { return regs[d.reg] && d.date > gpsAddDays_(today, -30); }),
    bases: meta.bases.filter(function (b) { return regs[b.reg]; }),
    stops: gpsRows_(GPS_TAB_STOPS).filter(function (s) { return regs[s.bus]; }),
    tracks: gpsRows_(GPS_TAB_TRACKS).filter(function (t) { return regs[t.reg]; }).map(function (t) { return { reg: t.reg, trip: t.trip, date: t.date, path: JSON.parse(t.path || '[]') }; }),
    capture: { byReg: gpsCaptureByReg_(regs) }, // processed route timelapses with their stops (blurred; counts only)
    catalog: gpsCatalog_(regs), // the agencies' parts catalog: models and parts fleet-wide, vehicles and service history of the visible buses
    // money per bus: the Owner sees every bus, a Coordinator their campuses (the same rows the Transport page's Bus P&L tab shows them)
    proposals: owner ? meta.proposals : {}, pnl: (base.pnl || []).filter(function (r) { return mine(gpsCampusId_(r.campus)); }),
  };
}

/** GET action=coordinatorbuschecks (Fee Clerk): flagged fuel bills of their campus that they have not answered yet. */
function coordGpsClerkChecks_(caller) {
  const visible = coordVisibleCampuses_(caller), answers = {};
  gpsRows_(GPS_TAB_ANSWERS).forEach(function (a) { answers[a.id] = a; });
  const open = gpsRows_(GPS_TAB_CHECKS).filter(function (c) {
    return c.flag === 'yes' && !answers[c.id] && (!visible || visible.indexOf(gpsCampusId_(c.campus)) !== -1);
  }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  return { success: true, checks: open.map(function (c) { return { id: c.id, reg: c.reg, date: c.date, text: gpsCheckText_(c) }; }) };
}

/** POST action=transportclerkcheck {fillId, answer: 'matches'|'corrected'} -- the Fee Clerk's answer, recorded with who and when. */
function coordGpsClerkAnswer_(caller, body) {
  const id = String(body.fillId || ''), answer = String(body.answer || '');
  if (['matches', 'corrected'].indexOf(answer) === -1) return { success: false, error: 'Unknown answer' };
  if (!caller.feeClerkOnly && caller.roles.indexOf('FeeClerk') === -1 && caller.roles.indexOf('Owner') === -1) return { success: false, error: 'Only the Fee Clerk (or the Owner) answers a fuel bill check' };
  const c = gpsRows_(GPS_TAB_CHECKS).filter(function (x) { return x.id === id; })[0];
  if (!c) return { success: false, error: 'This fuel bill is no longer waiting for a check; reload the page' };
  const visible = coordVisibleCampuses_(caller);
  if (visible && visible.indexOf(gpsCampusId_(c.campus)) === -1) return { success: false, error: 'Not authorized' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (gpsRows_(GPS_TAB_ANSWERS).some(function (a) { return a.id === id; })) return { success: true, already: true };
    const sh = gpsSheet_(GPS_TAB_ANSWERS);
    if (sh.getLastRow() === 0) sh.appendRow(['id', 'answer', 'by', 'at']);
    sh.appendRow([id, answer, caller.email, new Date().toISOString()]);
  } finally { lock.releaseLock(); }
  if (answer === 'matches') { // the slip agrees with the bill, so the fuel itself is in question: the coordinator gets it now
    try { const m = gpsMeta_(); gpsRefresh_(gpsRows_(GPS_TAB_DAILY), m.health); } catch (err) { console.error('GPS refresh: ' + err.message); }
  }
  return { success: true };
}
