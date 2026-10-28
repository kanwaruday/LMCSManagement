// The route World (Uday, 28 Oct: Principals and Fee Clerks see their own school's bus routes and stops on their World map, no money;
// each driver sees only their own route, through the Roster project's driverroute in driver-link.gs).
//   GET transportworld  a signed-in Principal (their one campus), Fee Clerk (their campus or comma list), Coordinator (their district)
//                       or Owner (all): the buses, stops and route tracks of those campuses, read only. Never money (no pnl, no
//                       proposals), never follow-ups, checks or the parts catalog; driver names only for staff who manage the buses
//                       (not the Principal). The Fee Clerk, Coordinator and Owner also get counts per bus: today's roll call recorded
//                       or not, and the number of fuel fills on record. Stop locations live only in the private transport workbook
//                       and leave it only through here, for the caller's own campuses.
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
    bases: meta.bases.filter(function (b) { return regs[b.reg]; }),
    stops: gpsRows_(GPS_TAB_STOPS).filter(function (s) { return regs[s.bus]; }),
    tracks: gpsRows_(GPS_TAB_TRACKS).filter(function (t) { return regs[t.reg]; }).map(function (t) { return { reg: t.reg, trip: t.trip, date: t.date, path: coordWorldPath_(t.path) }; }) };
  if (!caller.principal) { // the people who run the buses: today's roll call and the fills on record, as counts
    const rolled = {}, fills = coordFleetFills_(regs);
    gpsRows_(COORD_ROLLCALL_TAB).forEach(function (r) { if (String(r.Date) === today) rolled[FleetQuests.normReg(r.Reg)] = true; });
    out.counts = {};
    vehicles.forEach(function (v) { out.counts[v.reg] = { rollCallToday: !!rolled[FleetQuests.normReg(v.reg)], fuelFills: (fills[v.reg] || {}).count || 0 }; });
  }
  return out;
}

/** A track's stored path, or [] when the cell is not a JSON list (one bad cell must not hide every route). */
function coordWorldPath_(cell) {
  try { const p = JSON.parse(cell || '[]'); return Array.isArray(p) ? p : []; } catch (e) { return []; }
}
