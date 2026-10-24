// ═══════════════════════════════════════════════════════════════════
// Coordinator Backend -- Transport GPS checks (third file of the "LMCS Coordinator Backend" project).
// Spec: docs/superpowers/specs/2026-10-24-transport-optimisation-design.md
//
// The Mac (~/Projects/transport-gps/insights.py, daily) pushes per-bus daily facts from the GPS (action=transportgpspush,
// same shared secret as the fleet push). On each push this file stores them, checks every fuel fill the Office backend
// mirrors into the "Fuel Fills" tab against the GPS km, and raises follow-ups in the Tasks store, each with an owner,
// a due date and one plain instruction. Three views read it:
//   GET  coordinatortransportinsight  Coordinator / Owner (the Owner also gets money and proposals)
//   GET  coordinatorbuschecks         Fee Clerk: fuel bills of their campus waiting for their check
//   POST transportclerkcheck          Fee Clerk answers one: 'matches' (slip agrees with the bill) or 'corrected'
// ponytail: thresholds are the spec's starting values; tune them here once a few weeks of answers exist.
// ═══════════════════════════════════════════════════════════════════

const GPS_TAB_DAILY = 'GPS Daily', GPS_TAB_META = 'GPS Meta', GPS_TAB_STOPS = 'GPS Stops', GPS_TAB_FILLS = 'Fuel Fills',
  GPS_TAB_CHECKS = 'Fuel Checks', GPS_TAB_ANSWERS = 'Fuel Responses';
const GPS_DAILY_COLS = ['reg', 'date', 'km', 'blindKm', 'firstMove', 'lastMove', 'nightLat', 'nightLng', 'nightPlace', 'nightAwayKm', 'maxKmh', 'minOver40'];
const GPS_STOP_COLS = ['bus', 'trip', 'seq', 'kind', 'place', 'arrive_usual', 'arrive_early', 'arrive_late', 'spread_min', 'dwell_min', 'days_seen', 'run_days', 'shared_with', 'lat', 'lng'];
const GPS_CHECK_COLS = ['id', 'campus', 'date', 'reg', 'litres', 'gpsKm', 'billKm', 'kmpl', 'norm', 'flag', 'reason', 'excessL', 'excessRs'];
const GPS = {
  speedLimit: 40, speedMinutes: 10, awayKm: 2, deadDays: 2, longSilentDays: 14, blindShare: 0.2, blindMinKm: 30, ageLimit: 15,
  normSmall: 7.5, normBig: 5.0, smallSeats: 26, lowShare: 0.8, odoShare: 0.2, odoMinKm: 25, minCheckKm: 50, clerkDays: 2,
  due: { gps_dead: 3, gps_blind: 7, gps_none: 14, bus_away: 2, bus_speed: 3, fuel_check: 3, bus_age: 30 },
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
/** fills [{id,campus,date,reg,litres,odometer,amount_rs}], days [{reg,date,km}], seats {reg: n} -> checks (GPS_CHECK_COLS objects).
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
        excessL: Math.round(excessL), excessRs: Math.round(excessL * ((Number(cur.amount_rs) || 0) / litres)) });
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

/** Upserts the wanted follow-ups and closes self-clearing ones whose condition is gone. `covered` = {domain: {reg: true}}:
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
      const id = String(rows[i][0]), dom = rows[i][1], reg = id.split('|')[1];
      if (rows[i][5] !== 'open' || live[id] || !covered[dom] || !covered[dom][reg]) continue;
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
  gpsWrite_(GPS_TAB_META, ['key', 'value'], [{ key: 'syncedAt', value: p.syncedAt }, { key: 'health', value: JSON.stringify(p.health) },
    { key: 'bases', value: JSON.stringify(p.bases || []) }, { key: 'proposals', value: JSON.stringify(p.proposals || {}) }]);
  const n = gpsRefresh_(p.days, p.health);
  CacheService.getScriptCache().remove('coord_gps_insight_v1');
  return { success: true, days: p.days.length, checks: n.checks, followUps: n.followUps };
}

/** Recomputes the fuel checks and the follow-ups from the stored facts (also after a clerk answers). */
function gpsRefresh_(days, health) {
  const base = coordTransportBase_(), seats = {};
  base.fleet.forEach(function (b) { seats[b.reg] = b.seats; });
  const checks = gpsFuelChecks_(gpsRows_(GPS_TAB_FILLS), days, seats);
  gpsWrite_(GPS_TAB_CHECKS, GPS_CHECK_COLS, checks);
  const today = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  let live = null;
  try { live = coordBusFetch_().buses; } catch (err) { console.error('GPS live feed: ' + err.message); }
  if (live && !live.length) live = null; // an empty answer (bad id, vendor glitch) must not read as "no bus has a tracker"
  const wanted = gpsFollowUps_({ today: today, fleet: base.fleet, live: live, health: health, days: days, checks: checks, answers: gpsRows_(GPS_TAB_ANSWERS) });
  // which vehicles each self-clearing check actually looked at this time: only those may be closed by it
  const fleetRegs = {}, healthRegs = {};
  base.fleet.forEach(function (b) { fleetRegs[b.reg] = true; });
  health.forEach(function (h) { healthRegs[h.reg] = true; });
  gpsRaise_(wanted, { gps_blind: healthRegs, gps_dead: live ? fleetRegs : {}, gps_none: live ? fleetRegs : {}, bus_age: fleetRegs });
  return { checks: checks.length, followUps: wanted.length };
}

// ── Reads ──
function gpsMeta_() {
  const m = {};
  gpsRows_(GPS_TAB_META).forEach(function (r) { m[r.key] = r.value; });
  return { syncedAt: m.syncedAt || '', health: JSON.parse(m.health || '[]'), bases: JSON.parse(m.bases || '[]'), proposals: JSON.parse(m.proposals || '{}') };
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
  const silent = gpsSilent_(base.fleet, live, today);
  const vehicles = base.fleet.filter(function (b) { return /^HP/.test(b.reg) && mine(campusOf[b.reg]); }).map(function (b) {
    const g = live[b.reg], h = health[b.reg] || {};
    const state = !liveOk ? 'unknown' : !g ? 'none' : silent[b.reg] ? 'dead' : h.blind7 >= GPS.blindMinKm && h.blind7 >= GPS.blindShare * h.km7 ? 'blind' : 'ok';
    return { reg: b.reg, campus: b.campus, campusId: campusOf[b.reg], operational: b.operational, route: b.route, driver: b.driver, seats: b.seats, year: b.year,
      tracker: state, lastFix: g ? g.at : '', km7: h.km7 || 0, blind7: h.blind7 || 0 };
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
    proposals: owner ? meta.proposals : {}, pnl: owner ? (base.pnl || []) : [],
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
