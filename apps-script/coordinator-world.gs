// The route World (Uday, 28 Oct: Principals and Fee Clerks see their own school's bus routes and stops on their World map, no money;
// each driver sees only their own route, through the Roster project's driverroute in driver-link.gs).
//   GET transportworld  a signed-in Principal (their one campus), Fee Clerk (their campus or comma list), Coordinator (their district)
//                       or Owner (all): the buses, stops and route tracks of those campuses, read only. Never money (no pnl, no
//                       proposals), never follow-ups, checks or the parts catalog; driver names only for staff who manage the buses
//                       (not the Principal). The Fee Clerk, Coordinator and Owner also get counts per bus: today's roll call recorded
//                       or not, and the number of fuel fills on record. Stop locations live only in the private transport workbook
//                       and leave it only through here, for the caller's own campuses.
//   GET transportrun    the route view of one bus (reg), for the Owner and Coordinators of its district only (never a Principal or a
//                       Fee Clerk): see coordWorldRun_.
// Never where a bus parks at night (GPS Meta bases: often a driver's home).
// The page side is coordinator/route-map.js (LMCSRouteMap.mount), which draws it with coordinator/transport-views.js.

/** The World's caller: the transport staff gate first (Coordinator, Owner, Fee Clerk), else a Principal of one campus; null otherwise. */
function coordWorldCaller_(idToken) {
  return coordVerifyCaller_(idToken) || coordVerifyPrincipal_(idToken);
}

/** GET action=transportworld: see the top of this file. */
function coordWorld_(caller) {
  if (!caller) return { success: false, error: 'Not authorized' };
  const visible = caller.principal ? [caller.campusId] : coordVisibleCampuses_(caller); // null = every campus (the Owner, or campus ALL)
  const mine = function (campusId) { return !visible || visible.indexOf(campusId) !== -1; };
  const base = coordTransportBase_(), meta = gpsMeta_(), extra = {};
  meta.fleetExtra.forEach(function (x) { extra[x.reg] = x; });
  const today = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  const vehicles = base.fleet.filter(function (b) { return /^HP/.test(b.reg) && mine(gpsCampusId_(b.campus)); }).map(function (b) {
    const x = extra[b.reg] || {}, v = { reg: b.reg, campus: b.campus, campusId: gpsCampusId_(b.campus), operational: b.operational, route: b.route,
      seats: b.seats, rounds: x.rounds || null, students: x.students || null, start: x.start || b.start || '' };
    if (!caller.principal) v.driver = b.driver;
    return v;
  });
  const regs = {};
  vehicles.forEach(function (v) { regs[v.reg] = true; });
  const out = { success: true, today: today, syncedAt: meta.syncedAt, vehicles: vehicles,
    days: gpsRows_(GPS_TAB_DAILY).filter(function (d) { return regs[d.reg] && d.date > gpsAddDays_(today, -30); }).map(function (d) { return { reg: d.reg, date: d.date, km: d.km }; }),
    stops: gpsRows_(GPS_TAB_STOPS).filter(function (s) { return regs[s.bus]; }).map(function (s) { // a stop shared with a bus outside the caller's campuses does not name it
      s.shared_with = String(s.shared_with || '').split(' ').filter(function (r) { return regs[r]; }).join(' '); return s; }),
    tracks: gpsRows_(GPS_TAB_TRACKS).filter(function (t) { return regs[t.reg]; }).map(function (t) { return { reg: t.reg, trip: t.trip, date: t.date, path: coordWorldPath_(t.path) }; }) };
  if (!caller.principal) { // the people who run the buses: today's roll call and the fills on record, as counts
    const rolled = {}, fills = coordFleetFills_(regs);
    gpsRows_(COORD_ROLLCALL_TAB).forEach(function (r) { if (String(r.Date) === today) rolled[FleetQuests.normReg(r.Reg)] = true; });
    out.counts = {};
    vehicles.forEach(function (v) { out.counts[v.reg] = { rollCallToday: !!rolled[FleetQuests.normReg(v.reg)], fuelFills: (fills[v.reg] || fills[FleetQuests.normReg(v.reg)] || {}).count || 0 }; });
  }
  return out;
}

/** A track's stored path, or [] when the cell is not a JSON list (one bad cell must not hide every route). */
function coordWorldPath_(cell) {
  try { const p = JSON.parse(cell || '[]'); return Array.isArray(p) ? p : []; } catch (e) { return []; }
}

/** GET action=transportrun&reg= (Uday, 7 Nov: "the actual route view along with plans and all of the other meta data"): one bus's
 *  newest processed route video. Here: the bus (driver, campus, route, seats), the run (times, frames, stops with children as counts)
 *  and the plan (Transport Plan tab: planned stops, km from school, children). The Drive side (the frame path, the BLURRED video and
 *  stop photos) is the Roster's capturerunview, which has the Drive access this project lacks: it serves only a run this answer signs a
 *  ticket for, good for 30 minutes. The Owner sees every bus; a Coordinator their district's. */
function coordWorldRun_(caller, reg) {
  if (!caller || caller.principal || caller.feeClerkOnly) return { success: false, error: 'Not authorized' };
  reg = FleetQuests.normReg(reg);
  const visible = coordVisibleCampuses_(caller);
  const bus = coordTransportBase_().fleet.filter(function (b) { return FleetQuests.normReg(b.reg) === reg; })[0];
  if (!reg || !bus || (visible && visible.indexOf(gpsCampusId_(bus.campus)) === -1)) return { success: false, error: 'No such bus in your schools' };
  const out = { success: true, bus: { reg: bus.reg, campus: bus.campus, route: bus.route || '', start: bus.start || '', seats: bus.seats || null, driver: bus.driver || '' } };
  out.plan = gpsRows_(COORD_TRANSPORT_TAB_PLAN).filter(function (p) { return FleetQuests.normReg(p.Reg) === reg; }).map(function (p) {
    return { seq: Number(p.Seq) || 0, name: String(p.Stop || ''), km: p['Km from school'] === '' ? null : Number(p['Km from school']), children: p.Children === '' ? null : Number(p.Children),
      route: String(p.Route || ''), kmDay: p['Km a day'] === '' ? null : Number(p['Km a day']), rounds: p.Rounds === '' ? null : Number(p.Rounds) };
  }).sort(function (a, b) { return a.seq - b.seq; });
  const one = {};
  one[reg] = true; // Capture Stops keys a run by the folder's reg, already normalised (HP665805)
  const latest = gpsCaptureByReg_(one)[reg];
  if (!latest) { out.run = null; return out; }
  const sh = SpreadsheetApp.openById(COORD_TRANSPORT_FORM_ID).getSheetByName(COORD_TRANSPORT_TAB_CAPTURE);
  const row = (sh ? sh.getDataRange().getValues().slice(1) : []).filter(function (r) { return String(r[0]) === String(latest.runId); })[0] || [];
  const ms = function (v) { const n = v instanceof Date ? v.getTime() : Number(v); return isFinite(n) && n > 0 ? n : null; };
  out.run = { runId: String(latest.runId), startedAt: ms(row[4]), endedAt: ms(row[5]), frames: Number(row[8]) || 0,
    stops: latest.stops.map(function (s) { return { seq: Number(s.seq) || 0, name: String(s.name || ''), lat: s.lat, lng: s.lng, at: String(s.at || ''), boardOn: Number(s.boardOn) || 0, boardOff: Number(s.boardOff) || 0, photo: !!s.photoFileId }; }) };
  out.ticket = coordRunTicket_(reg, out.run.runId, Date.now() + 30 * 60000);
  out.rosterUrl = COORD_ROSTER_URL;
  return out;
}

/** {reg, runId, exp, sig}: the Roster's capturerunview checks sig with the same TRANSPORT_PUSH_SECRET (transport-capture.gs capTicketOk_). */
function coordRunTicket_(reg, runId, exp) {
  const secret = String(PropertiesService.getScriptProperties().getProperty('TRANSPORT_PUSH_SECRET') || '').trim();
  return { reg: reg, runId: runId, exp: exp, sig: Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature('runview|' + reg + '|' + runId + '|' + exp, secret)) }; // 'runview|': this signature means nothing anywhere else
}
