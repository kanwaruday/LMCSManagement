// The route World (Uday, 28 Oct: Principals and Fee Clerks see their own school's bus routes and stops on their World map, no money;
// each driver sees only their own route, through the Roster project's driverroute in driver-link.gs).
//   GET transportworld  a signed-in Principal (their one campus), Fee Clerk (their campus or comma list), Coordinator (their district)
//                       or Owner (all): the buses, stops and route tracks of those campuses, read only. Never money (no pnl, no
//                       proposals), never follow-ups, checks or the parts catalog; driver names only for staff who manage the buses
//                       (not the Principal). The Fee Clerk, Coordinator and Owner also get counts per bus: today's roll call recorded
//                       or not, and the number of fuel fills on record. Stop locations live only in the private transport workbook
//                       and leave it only through here, for the caller's own campuses.
//   GET transportrun    the route view of one bus (reg, optional runId), for every World caller on their own buses: see coordWorldRun_.
//   POST transportrun   {deviceToken, reg, runId}: a linked driver phone, its own bus only.
// Never where a bus parks at night (GPS Meta bases: often a driver's home).
// The page side is coordinator/route-map.js (LMCSRouteMap.mount), which draws it with coordinator/transport-views.js.

/** The World's caller: the transport staff gate first (Coordinator, Owner, Fee Clerk), else a Principal of one campus, or of the
 *  school they support when actAs names it (supporting-charge.gs; everything here is read only); null otherwise. */
function coordWorldCaller_(idToken, actAs) {
  return coordVerifyCaller_(idToken) || supportActAs_(coordVerifyPrincipal_(idToken), actAs);
}

/** A linked driver phone (driver-token.gs dlkLink_) -> {driverReg}, the one bus coordWorldRun_ serves it; null otherwise.
 *  ponytail: bus in-charge teachers are not callers yet: their tie (the ERP Sheet's assignments, kind bus) lives in the Game
 *  backend and no school has named one. Add them here once those ties are filled. */
function coordRunDriver_(deviceToken) {
  const link = deviceToken ? dlkLink_(deviceToken) : null;
  return link ? { driverReg: FleetQuests.normReg(link.reg) } : null;
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
 *  processed route videos (the newest, or runId from `runs`). Here: the bus (driver, campus, route, seats), the run (times, frames, stops with children as counts)
 *  and the plan (Transport Plan tab: planned stops, km from school, children). The Drive side (the frame path, the BLURRED video and
 *  stop photos) is the Roster's capturerunview, which has the Drive access this project lacks: it serves only a run this answer signs a
 *  ticket for, good for 30 minutes. Who sees which bus (Uday, 7 Nov: "Principal, driver, clerk, bus incharge teachers"): the Owner
 *  every bus; a Coordinator their district's; a Principal and a Fee Clerk their own school's; a driver phone its own bus. Everyone
 *  gets the blurred output only. A Principal does not get the driver's name (as the World's vehicles). */
function coordWorldRun_(caller, reg, runId) {
  if (!caller) return { success: false, error: 'Not authorized' };
  reg = FleetQuests.normReg(reg);
  const visible = caller.driverReg ? [] : caller.principal ? [caller.campusId] : coordVisibleCampuses_(caller); // [] = by bus, below
  const bus = coordTransportBase_().fleet.filter(function (b) { return FleetQuests.normReg(b.reg) === reg; })[0];
  const mine = bus && (caller.driverReg ? caller.driverReg === reg : !visible || visible.indexOf(gpsCampusId_(bus.campus)) !== -1);
  if (!reg || !mine) return { success: false, error: 'No such bus in your schools' };
  const out = { success: true, bus: { reg: bus.reg, campus: bus.campus, route: bus.route || '', start: bus.start || '', seats: bus.seats || null, driver: caller.principal ? '' : bus.driver || '' } };
  out.plan = gpsRows_(COORD_TRANSPORT_TAB_PLAN).filter(function (p) { return FleetQuests.normReg(p.Reg) === reg; }).map(function (p) {
    return { seq: Number(p.Seq) || 0, name: String(p.Stop || ''), km: p['Km from school'] === '' ? null : Number(p['Km from school']), children: p.Children === '' ? null : Number(p.Children),
      route: String(p.Route || ''), kmDay: p['Km a day'] === '' ? null : Number(p['Km a day']), rounds: p.Rounds === '' ? null : Number(p.Rounds) };
  }).sort(function (a, b) { return a.seq - b.seq; });
  const sh = SpreadsheetApp.openById(COORD_TRANSPORT_FORM_ID).getSheetByName(COORD_TRANSPORT_TAB_CAPTURE), meta = {};
  (sh ? sh.getDataRange().getValues().slice(1) : []).forEach(function (r) { meta[String(r[0])] = r; }); // Capture Runs, by run id
  const ms = function (v) { const n = v instanceof Date ? v.getTime() : Number(v); return isFinite(n) && n > 0 ? n : null; };
  // Capture Stops keys a run by the folder's reg, already normalised (HP665805); a run discarded on the review shelf (capturediscard,
  // Capture Runs status 'closed') has a binned folder, so it is never listed
  const runs = gpsRows_(GPS_TAB_CAPTURE).filter(function (r) { return r.reg === reg && String((meta[String(r.runId)] || [])[12]) !== 'closed'; })
    .sort(function (a, b) { return String(b.runId) < String(a.runId) ? -1 : 1; }).slice(0, 20);
  out.runs = runs.map(function (r) { const m = meta[String(r.runId)] || []; return { runId: String(r.runId), startedAt: ms(m[4]), frames: Number(m[8]) || 0 }; });
  const latest = runs.filter(function (r) { return String(r.runId) === String(runId || ''); })[0] || runs[0];
  if (!latest) { out.run = null; return out; }
  let stops = [];
  try { stops = JSON.parse(latest.stops || '[]'); } catch (e) { stops = []; } // a cut-off or hand-edited cell must not break the page
  latest.stops = Array.isArray(stops) ? stops : [];
  const row = meta[String(latest.runId)] || [];
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
