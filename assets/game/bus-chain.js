// The bus setup chain (V2, vault work/Role Screens Drafts.html "Bus setup chain"): a driver's guided steps for their own bus.
// Pure logic, shared like coordinator/capture/fleet-quests.js, so it is plain ES5 with no I/O, no DOM and no clock:
//   - driver/index.html and coordinator/transport/capture.html load it as a classic script: window.BusChain;
//   - the Roster (transport-capture.gs: which bus-photo ids a safety check may carry), the Coordinator (driverbus: is the bus
//     photographed) and the Game backend (game-bus-chain.gs: the staff quest) get it as bus-chain.gs (apps-script/projects.json).
// Steps: 1 my bus (the phone is linked) -> 2 photograph the bus -> 3 route video -> 4 my riders (names from the ERP, no photos).
// "Your bus is home" (the 3D bus) is the home engine's (Game Director), not a step here.
// The bus photos ride on the existing safety check (an 'inspection' run): the vehicle shots below plus the Owner's safety loadout,
// so there is no new register. Empty bus only: vehicles, never people.
var BusChain = (function () {
  'use strict';
  // the vehicle shots, in the order a driver walks round the bus. id: 'bus_' + where (never a loadout id: those come from the
  // Owner's list and have no bus_ prefix in the seed). label: Hindi · English, as the driver page speaks.
  var SHOTS = [
    { id: 'bus_front', label: 'बस आगे से · Front of the bus' },
    { id: 'bus_back', label: 'बस पीछे से · Back of the bus' },
    { id: 'bus_left', label: 'बाईं तरफ़ · Left side' },
    { id: 'bus_right', label: 'दाईं तरफ़ · Right side' },
    { id: 'bus_plate', label: 'नंबर प्लेट · Number plate' },
    { id: 'bus_tyres', label: 'टायर · Tyres' },
    { id: 'bus_seats', label: 'सीटें · Seats' },
    { id: 'bus_aisle', label: 'बीच का रास्ता · Aisle' }
  ];
  function isShot(id) { for (var i = 0; i < SHOTS.length; i++) if (SHOTS[i].id === id) return true; return false; }

  // the safety check's items in driver mode: the shots (a Yes needs a photo) then the Owner's active loadout items
  function photoItems(loadout) {
    var shots = SHOTS.map(function (s, i) { return { id: s.id, label: s.label, needsPhoto: true, needsDate: false, order: i + 1, active: true, shot: true }; });
    return shots.concat((loadout || []).filter(function (i) { return i && i.active !== false && !isShot(i.id); }));
  }

  // true when a safety check's answers {id: {ok, fileId?}} cover every shot: each answered, and a Yes has its photo.
  // A No ("needs repair") counts: the finding is the point.
  function photosDone(answers) {
    if (!answers || typeof answers !== 'object') return false;
    for (var i = 0; i < SHOTS.length; i++) {
      var a = answers[SHOTS[i].id];
      if (!a || typeof a.ok !== 'boolean' || (a.ok && !a.fileId)) return false;
    }
    return true;
  }

  // the driver's steps. s: {linked, photos (bool), runsNeeded, runsDone, riders (array or null = the ERP list not set up yet)}
  // Each step: {id, hi, en, done, next, status, action}. next: the first open step. Nothing is locked: the route video was live
  // before this chain, so a driver who has not photographed the bus yet can still record the route.
  function steps(s) {
    s = s || {};
    var need = Math.max(0, s.runsNeeded || 0), runs = Math.min(need, Math.max(0, s.runsDone || 0));
    var riders = s.riders;
    var list = [
      { id: 'bus', hi: 'मेरी बस', en: 'My bus', done: !!s.linked, status: s.linked ? 'फ़ोन बस से जुड़ा · Phone linked' : 'ऑफ़िस से लिंक लें · Get a link from the office' },
      { id: 'photos', hi: 'बस की फ़ोटो', en: 'Photograph your bus', done: !!s.photos,
        status: s.photos ? 'फ़ोटो भेजी गईं · Photos sent' : 'खाली बस · 8 फ़ोटो + सुरक्षा सामान · Empty bus: 8 photos + safety kit',
        action: 'फ़ोटो लें · Take the photos' },
      { id: 'route', hi: 'रूट वीडियो', en: 'Route video', done: need > 0 && runs >= need,
        status: need === 0 ? 'अभी कोई रूट नहीं · No route runs planned yet' : runs + ' / ' + need + ' · runs done',
        action: need > 0 && runs < need ? 'रूट रिकॉर्ड करें · Record your route' : '' },
      { id: 'riders', hi: 'मेरे बच्चे', en: 'My riders', done: !!(riders && riders.length),
        status: riders == null ? 'जल्द · Soon: the school list is being set up' : riders.length ? riders.length + ' बच्चे · riders' : 'कोई नाम नहीं · No riders listed yet',
        action: riders && riders.length ? 'सूची देखें · See the list' : '' }
    ];
    var found = false;
    list.forEach(function (x) { x.next = !x.done && !found; if (x.next) found = true; });
    return list;
  }
  // how many steps are done, for the card's "2 of 4"
  function progress(list) { var d = 0; list.forEach(function (x) { if (x.done) d++; }); return { done: d, total: list.length }; }

  // the newest photographed safety check per bus from Capture Runs rows (Run ID | Reg | Campus | Kind | Started | Ended | By | Role |
  // Frames | Gaps | Stops | Inspection JSON | Status ...): {REG: true}. normReg: the caller's reg normaliser.
  function photographed(rows, normReg) {
    var out = {};
    (rows || []).forEach(function (r) {
      if (String(r[3]) !== 'inspection' || String(r[12]) !== 'ended') return;
      var a = null;
      try { a = JSON.parse(String(r[11] || 'null')); } catch (e) { a = null; }
      if (photosDone(a)) out[normReg(r[1])] = true;
    });
    return out;
  }

  return { SHOTS: SHOTS, isShot: isShot, photoItems: photoItems, photosDone: photosDone, steps: steps, progress: progress, photographed: photographed };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = BusChain;
