// The driver's Home Base: their own bus (Uday, 28 Oct: "the home view of the buses that they are allocated to, you know the bus make
// model etc", so that later a driver can show which part needs a repair). Drawn by assets/game/bus-model.js on driver/index.html.
//   POST {action:'driverbus', deviceToken} -> {success, reg, campus, bus, route, make, model, fuel, seats, year, fromScan, papers, parts}
//   for the linked phone's own bus only (driver-token.gs's dlkLink_, the same read as the Roster's driverme); an unknown or revoked
//   token gets the one UNLINKED answer. make/model/seats come from Fleet setup's Vehicle papers, else the RC scan's reading (then
//   fromScan lists the fields read that way), else the fleet list's seats; year is the fleet list's. papers: the bus-level
//   expiry dates (insurance, fitness, pollution, speed governor) as the Transport page resolves them, dates only. parts: Fleet
//   setup's parts history, {part id: last replaced on}. Never money, never other buses, never the driver card.

const DBUS_PAPERS_ = ['insurance', 'fitness', 'pollution', 'speed_governor'];

function coordDriverBus_(body) {
  const link = dlkLinkOrView_(body, function (t) { // or a staff view (driver-token.gs): the Owner, or a Coordinator in their district
    const c = coordVerifyCaller_(t), seen = c && dlkStaff_(c.roles) ? coordVisibleCampuses_(c) : undefined;
    return seen === undefined ? null : function (campus) { return !seen || seen.indexOf(campus) !== -1; };
  });
  if (!link) return { success: false, code: 'UNLINKED', error: DLK_UNLINKED_ };
  const reg = FleetQuests.normReg(link.reg), T = COORD_FLEET_TABS, same = function (r) { return FleetQuests.normReg(r) === reg; };
  const fleetBus = coordTransportBase_().fleet.filter(function (b) { return same(b.reg); })[0] || {};
  const prof = gpsRows_(T.profile).filter(function (r) { return same(r.reg); })[0] || {};
  const papers = coordDriverBusObj_(prof.papers), scan = coordFleetScan_((function () { const o = {}; o[reg] = true; return o; })())[reg] || {};
  const fromScan = [], pick = function (id) {
    if (String(papers[id] || '').trim()) return String(papers[id]).trim();
    if (scan[id] && !scan[id].disagree) { fromScan.push(id); return scan[id].value; }
    return '';
  };
  const parts = {};
  gpsRows_(T.parts).forEach(function (r) {
    if (!same(r.reg)) return;
    const d = String(coordDriverBusObj_(r.fields).lastReplacedOn || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) parts[String(r.component)] = d; // 'unknown' and blanks stay out: the card says —
  });
  const docs = {};
  try {
    const b = coordTransportFleet_().fleet.filter(function (x) { return same(x.reg); })[0];
    DBUS_PAPERS_.forEach(function (k) { const d = b && b.docs && b.docs[k]; docs[k] = d ? { date: String(d.date || ''), na: !!d.na } : { date: '' }; });
  } catch (e) { DBUS_PAPERS_.forEach(function (k) { docs[k] = { date: '' }; }); } // papers unreadable: the card says —, the bus still draws
  return { success: true, reg: reg, campus: link.campus, bus: String(fleetBus.bus || ''), route: String(fleetBus.route || ''),
    make: pick('make'), model: pick('modelAndVariant'), fuel: pick('fuel'), seats: pick('seatingCapacityAsPerRc') || String(fleetBus.seats || ''),
    year: String(fleetBus.year || ''), fromScan: fromScan, papers: docs, parts: parts };
}

function coordDriverBusObj_(v) {
  if (v && typeof v === 'object') return v;
  try { const o = JSON.parse(v || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (e) { return {}; }
}
