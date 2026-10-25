// Fleet setup quests: the staff transport questionnaire as six quests per bus (spec: "Fleet setup quests", 2026-10-25).
// Pure logic, shared three ways, so it is plain ES5 with no I/O, no DOM and no clock (callers pass today as 'yyyy-MM-dd'):
//   - the setup page (coordinator/transport/setup.html) loads it as a classic script: window.FleetQuests;
//   - the Coordinator backend gets it as a .gs file (apps-script/projects.json maps this path; deploy.mjs copies it);
//   - the LMCS Game Backend (December) copies it unchanged into a .gs file and computes the missions server-side.
// Goals are config: every quest, field, part and done check lives in DEFAULT_ROWS, shaped as the Game Backend's rows
// (Game Quests: QuestId, Role, Title, UnlockAfter, StepsJson, Reward; Game Config: Key, Value as JSON text), and is read
// only through questConfig(), which takes those rows as overrides.
// Field ids are the questionnaire's column names in camelCase (bracket notes, "?" and " uploaded to portal" dropped);
// tests/transport/fixtures/questionnaire-headers.json holds those headers (header rows only, no data).
// "done" is always derived from saved data: a quest's required fields, each part's date, the first safety check and the
// processed route timelapse (never a tick box). Each of the six quests weighs one sixth; a bus at 100% is "ready".
var FleetQuests = (function () {
  'use strict';
  var GO = 'coordinator/transport/setup.html?reg={reg}&quest=';
  var PART_FIELDS = [
    { id: 'lastReplacedOn', col: 'Last replaced on (date)', type: 'dateOrUnknown', past: true, label: 'Last replaced on' },
    { id: 'odometerAtThatTime', col: 'Odometer at that time (km)', type: 'number', label: 'Odometer then (km)' },
    { id: 'workshop', col: 'Workshop', type: 'workshop', label: 'Workshop' },
    { id: 'cost', col: 'Cost (₹)', type: 'number', label: 'Cost (₹)' },
    { id: 'billOrJobCardAvailable', col: 'Bill or job card available?', type: 'yesno', label: 'Bill or job card kept?' },
    { id: 'notes', col: 'Notes', type: 'text', label: 'Notes' }
  ];
  // Parts by the day book's component ids (Task 1, OFFICE_COMPONENTS). The questionnaire's "Tyres (all positions)" is split by
  // position, as the day book books tyres; its "Shock absorbers" and "Leaf springs" are both the day book's suspension.
  var PARTS = [['engine_oil', 'Engine oil'], ['oil_filter', 'Oil filter'], ['fuel_filter', 'Fuel filter'], ['air_filter', 'Air filter'],
    ['coolant', 'Coolant'], ['gearbox_oil', 'Gearbox oil'], ['brake_front', 'Front brakes (linings, pads)'], ['brake_rear', 'Rear brakes (linings, pads)'],
    ['clutch', 'Clutch plate'], ['tyre_fl', 'Tyre front left'], ['tyre_fr', 'Tyre front right'], ['tyre_rl', 'Tyre rear left'],
    ['tyre_rr', 'Tyre rear right'], ['tyre_spare', 'Spare tyre'], ['battery', 'Battery'], ['suspension', 'Suspension (shock absorbers, leaf springs)'],
    ['steering', 'Steering joints, king pins'], ['wheel_bearing', 'Wheel bearings'], ['lights_wiring', 'Wiring and lights'], ['body_paint', 'Body and paint']];
  var STEPS = [
    { id: 'papers', title: 'Vehicle papers', task: 'Fill in the vehicle papers', gap: 'vehicle papers', source: 'Fleet Profile', go: GO + 'papers',
      doneCheck: { required: ['make', 'modelAndVariant', 'chassisNo', 'engineNo', 'fuel', 'seatingCapacityAsPerRc', 'odometerToday', 'odometerPhoto'] },
      fields: [
        { id: 'make', col: 'Make (Tata, Ashok Leyland, Force…)', type: 'text', label: 'Make', hint: 'Tata, Ashok Leyland, Force…' },
        { id: 'modelAndVariant', col: 'Model and variant', type: 'text', label: 'Model and variant' },
        { id: 'chassisNo', col: 'Chassis no. (from RC)', type: 'text', label: 'Chassis no.', hint: 'From the RC' },
        { id: 'engineNo', col: 'Engine no. (from RC)', type: 'text', label: 'Engine no.', hint: 'From the RC' },
        { id: 'fuel', col: 'Fuel', type: 'choice', options: ['Diesel', 'CNG', 'Petrol', 'Electric'], label: 'Fuel' },
        { id: 'emissionNorm', col: 'Emission norm (BS-IV / BS-VI)', type: 'choice', options: ['BS-III', 'BS-IV', 'BS-VI'], label: 'Emission norm' },
        { id: 'seatingCapacityAsPerRc', col: 'Seating capacity as per RC', type: 'text', label: 'Seats on the RC', hint: 'As written, e.g. 43+1' },
        { id: 'dateOfRegistration', col: 'Date of registration', type: 'date', past: true, label: 'Date of registration' },
        { id: 'odometerToday', col: 'Odometer today (km)', type: 'number', label: 'Odometer today (km)' },
        { id: 'odometerPhoto', col: 'Odometer photo uploaded to portal?', type: 'photo', label: 'Odometer photo' },
        { id: 'dealerAgency', col: 'Dealer / agency (name, city)', type: 'text', label: 'Dealer or agency', hint: 'Name and city' },
        { id: 'warrantyValidTill', col: 'Warranty valid till', type: 'date', label: 'Warranty valid till' },
        { id: 'usualWorkshop', col: 'Usual workshop', type: 'workshop', label: 'Usual workshop' },
        { id: 'tyreSize', col: 'Tyre size', type: 'text', label: 'Tyre size', hint: 'e.g. 7.50-16' },
        { id: 'notes', col: 'Notes', type: 'text', label: 'Notes' }
      ] },
    { id: 'safety', title: 'Safety kit', task: 'Do the first safety check', gap: 'a safety check', source: 'Capture Runs', go: GO + 'safety',
      doneCheck: { required: ['attendantHelperName'], needs: ['inspection'] },
      fields: [ // the equipment is answered by the safety check on the capture page (Safety Loadout item ids), not typed here
        { id: 'gpsTrackerFittedAndWorking', col: 'GPS tracker fitted and working', type: 'inspection', item: 'gps_tracker' },
        { id: 'speedGovernorFitted', col: 'Speed governor (40 km/h) fitted', type: 'inspection', item: 'speed_governor' },
        { id: 'speedGovernorCertificateValidTill', col: 'Speed governor certificate valid till', type: 'inspection', item: 'speed_governor' },
        { id: 'cctvFittedAndWorking', col: 'CCTV fitted and working', type: 'inspection', item: 'cctv' },
        { id: 'firstAidBox', col: 'First-aid box (stocked)', type: 'inspection', item: 'first_aid' },
        { id: 'fireExtinguisherPresent', col: 'Fire extinguisher present', type: 'inspection', item: 'fire_extinguisher' },
        { id: 'fireExtinguisherRefillDue', col: 'Fire extinguisher refill due', type: 'inspection', item: 'fire_extinguisher' },
        { id: 'windowGrills', col: 'Window grills', type: 'inspection', item: 'window_grills' },
        { id: 'emergencyExitWorking', col: 'Emergency exit working', type: 'inspection', item: 'emergency_exit' },
        { id: 'doorLockWorking', col: 'Door lock working', type: 'inspection', item: 'door_lock' },
        { id: 'schoolNameAndPhonePainted', col: 'School name and phone painted', type: 'inspection', item: 'school_name_phone' },
        { id: 'attendantHelperName', col: 'Attendant / helper name', type: 'text', label: 'Attendant or helper on this bus', hint: 'Write "none" if there is no one' },
        { id: 'photos', col: 'Photos uploaded to portal?', type: 'inspection', item: '' },
        { id: 'notes', col: 'Notes', type: 'text', label: 'Notes' }
      ] },
    { id: 'parts', title: 'Parts history', task: 'Add the parts history', gap: 'parts history', source: 'Parts History', go: GO + 'parts',
      doneCheck: { eachPart: 'lastReplacedOn' }, fields: PART_FIELDS,
      parts: PARTS.map(function (p) { return { id: p[0], label: p[1] }; }) },
    { id: 'driver', title: 'Driver card', task: 'Fill in the driver card', gap: 'a driver card', source: 'Driver Profile', go: GO + 'driver',
      doneCheck: { required: ['driverPhone', 'licenceClass', 'licenceValidTill', 'dateOfBirth', 'medicalCertificateValidTill', 'policeVerificationDone', 'driverPhoto'] },
      fields: [
        { id: 'driverPhone', col: 'Driver phone', type: 'phone', label: 'Driver phone' },
        { id: 'licenceClass', col: 'Licence class (LMV / HTV / PSV badge)', type: 'choice', options: ['LMV', 'HTV', 'LMV + PSV badge', 'HTV + PSV badge'], label: 'Licence class' },
        { id: 'licenceValidTill', col: 'Licence valid till', type: 'date', label: 'Licence valid till' },
        { id: 'dateOfBirth', col: 'Date of birth', type: 'date', past: true, label: 'Date of birth' },
        { id: 'medicalCertificateValidTill', col: 'Medical certificate valid till', type: 'date', label: 'Medical certificate valid till' },
        { id: 'policeVerificationDone', col: 'Police verification done?', type: 'yesno', label: 'Police verification done?' },
        { id: 'policeVerificationDate', col: 'Police verification date', type: 'date', past: true, label: 'Police verification date' },
        { id: 'driverPhoto', col: 'Driver photo uploaded to portal?', type: 'photo', label: 'Driver photo', hint: 'Face only, plain background' },
        { id: 'notes', col: 'Notes', type: 'text', label: 'Notes' }
      ] },
    { id: 'fuel', title: 'Fuel pump', task: 'Add the fuel pump', gap: 'fuel pump details', source: 'Fleet Profile', go: GO + 'fuel',
      doneCheck: { required: ['usualFuelPump', 'paymentCreditAccountOrCash', 'driverHasASmartphoneForTheFillVideo', 'whoReceivesTheFillVideoAndBill'] },
      fields: [
        { id: 'usualFuelPump', col: 'Usual fuel pump (name, place)', type: 'text', label: 'Usual fuel pump', hint: 'Name and place' },
        { id: 'paymentCreditAccountOrCash', col: 'Payment: credit account or cash', type: 'choice', options: ['Credit', 'Cash'], label: 'Payment' },
        { id: 'driverHasASmartphoneForTheFillVideo', col: 'Driver has a smartphone for the fill video?', type: 'yesno', label: 'Driver has a smartphone for the fill video?' },
        { id: 'whoReceivesTheFillVideoAndBill', col: 'Who receives the fill video and bill (Fee Clerk name)', type: 'text', label: 'Who gets the fill video and bill?', hint: 'Fee Clerk name' },
        { id: 'notes', col: 'Notes', type: 'text', label: 'Notes' }
      ] },
    { id: 'capture', title: 'Capture plan', task: 'Capture the route', gap: 'a route timelapse', source: 'Capture Stops', go: GO + 'capture',
      doneCheck: { needs: ['routeTimelapse'] }, // the plan helps arrange the run; the quest is done by the run itself
      fields: [
        { id: 'schoolPhoneToUse', col: 'School phone to use', type: 'text', label: 'School phone to use' },
        { id: 'phoneMountAndChargerReady', col: 'Phone mount and charger ready?', type: 'yesno', label: 'Phone mount and charger ready?' },
        { id: 'timelapseRunDate', col: 'Timelapse run date (outside school hours)', type: 'date', label: 'Timelapse run date', hint: 'Outside school hours' },
        { id: 'countRunDate', col: 'Count run date (normal school run)', type: 'date', label: 'Count run date', hint: 'A normal school run' },
        { id: 'coordinatorRiding', col: 'Coordinator riding', type: 'text', label: 'Coordinator riding' },
        { id: 'done', col: 'Done?', type: 'derived', from: 'routeTimelapse' },
        { id: 'notes', col: 'Notes', type: 'text', label: 'Notes' }
      ] }
  ];
  var NEEDS = { inspection: { flag: 'inspected', label: 'the first safety check' }, routeTimelapse: { flag: 'captured', label: 'a route timelapse' } };
  var WORKSHOP_COLS = ['workshopName', 'place', 'contactPerson', 'phone', 'whichOfOurBusesGoThere', 'jobsTheyDo', 'givesAJobCard', 'pickUpAndDrop', 'notes'];
  var DEFAULT_ROWS = {
    quests: [{ QuestId: 'transport:setup', Role: 'FeeClerk', Title: 'Fleet setup', UnlockAfter: '', StepsJson: JSON.stringify(STEPS), Reward: 'Ready badge' }],
    config: [{ Key: 'transport.loadCapFactor', Value: '1.4' }, { Key: 'transport.driverAgeLimit', Value: '60' }]
  };

  function parse(text, fallback) { try { var v = JSON.parse(text); return v == null ? fallback : v; } catch (e) { return fallback; } }
  function obj(v) { var o = typeof v === 'string' ? parse(v || '{}', {}) : v; return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; }
  function configValue(rows, key, fallback) {
    var out = fallback;
    (rows || []).forEach(function (r) { if (r && r.Key === key) { var v = parse(String(r.Value), null); if (typeof v === typeof fallback) out = v; } });
    return out;
  }

  var cached = null;
  /** The quest definitions and tunables: defaults, overridden by Game Quests / Game Config rows when given ({quests, config}). */
  function questConfig(over) {
    if (!over && cached) return cached;
    var rows = over || {}, q = null, d = DEFAULT_ROWS.quests[0];
    (rows.quests || []).forEach(function (r) { if (r && r.QuestId === d.QuestId) q = r; });
    q = q || d;
    var steps = parse(q.StepsJson, null);
    if (!Array.isArray(steps) || !steps.length) steps = parse(d.StepsJson, []);
    var cfgRows = DEFAULT_ROWS.config.concat(rows.config || []);
    var out = { questId: q.QuestId, role: q.Role || d.Role, title: q.Title || d.Title, reward: q.Reward || d.Reward, steps: steps,
      loadCapFactor: configValue(cfgRows, 'transport.loadCapFactor', 1.4), driverAgeLimit: configValue(cfgRows, 'transport.driverAgeLimit', 60),
      workshopCols: WORKSHOP_COLS.slice() };
    if (!over) cached = out;
    return out;
  }
  function step(id) { var s = questConfig().steps; for (var i = 0; i < s.length; i++) if (s[i].id === id) return s[i]; return null; }
  function blank(v) { return v == null || String(v).trim() === ''; }
  function campusId(c) { return 'LMS' + String(c || '').replace(/\D/g, ''); }

  /** The Driver Profile key of a bus's driver: the employee code from the roster, else the bus itself. */
  function driverKey(bus) { return bus.driverCode ? String(bus.driverCode) : 'bus:' + bus.reg; }

  /** rows {fleet, profiles, drivers, parts, inspected:{reg:true}, captured:{reg:true}} -> one profile per running bus. */
  function profilesFromRows(rows) {
    rows = rows || {};
    var prof = {}, drv = {}, parts = {}, out = [];
    (rows.profiles || []).forEach(function (r) { prof[r.reg] = r; });
    (rows.drivers || []).forEach(function (r) { drv[r.driverKey] = r; });
    (rows.parts || []).forEach(function (r) { (parts[r.reg] = parts[r.reg] || {})[r.component] = obj(r.fields); });
    (rows.fleet || []).forEach(function (b) {
      if (b.operational === false || b.operational === 'no') return;
      var p = prof[b.reg] || {}, k = driverKey(b), d = drv[k];
      out.push({ reg: b.reg, campus: 'LMS ' + campusId(b.campusId || b.campus).slice(3), campusId: campusId(b.campusId || b.campus), route: b.route || '',
        driverName: b.driver || '', driverKey: k,
        data: { papers: obj(p.papers), safety: obj(p.safety), parts: parts[b.reg] || {}, driver: d ? obj(d.fields) : {}, fuel: obj(p.fuel), capture: obj(p.capture) },
        ageLimit: !!d && (d.ageLimit === true || d.ageLimit === 'yes'),
        inspected: !!(rows.inspected || {})[b.reg], captured: !!(rows.captured || {})[b.reg] });
    });
    return out;
  }

  function missingFor(s, profile) {
    var data = (profile.data || {})[s.id] || {}, dc = s.doneCheck || {}, m = [];
    (dc.required || []).forEach(function (id) { if (blank(data[id])) m.push(id); });
    if (dc.eachPart) (s.parts || []).forEach(function (p) { if (!data[p.id] || blank(data[p.id][dc.eachPart])) m.push(p.id); });
    (dc.needs || []).forEach(function (n) { if (!profile[NEEDS[n].flag]) m.push(n); });
    return m;
  }
  /** [{id, label, done, missing:[field id | part id | 'inspection' | 'routeTimelapse']}] for the six quests, in order. */
  function questsFor(profile) {
    profile = profile || {};
    return questConfig().steps.map(function (s) { var m = missingFor(s, profile); return { id: s.id, label: s.title, done: !m.length, missing: m }; });
  }
  function completion(profile) {
    var q = questsFor(profile), n = q.filter(function (x) { return x.done; }).length;
    return Math.round(100 * n / q.length);
  }
  function isReady(profile) { return completion(profile) === 100; }

  /** Plain names for a quest's missing entries ('Chassis no.', 'Engine oil', 'the first safety check'). */
  function missingLabels(questId, missing) {
    var s = step(questId);
    return missing.map(function (id) {
      if (NEEDS[id]) return NEEDS[id].label;
      var all = (s.fields || []).concat(s.parts || []);
      for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i].label;
      return id;
    });
  }

  /** The bus's quest in the game layer's contract shape. */
  function questFor(profile) {
    var cfg = questConfig();
    return { id: 'transport:setup:' + profile.reg, role: cfg.role, module: 'transport', title: cfg.title + ' ' + profile.reg, unlockAfter: null,
      steps: cfg.steps.map(function (s) { return { id: s.id, title: s.title, go: s.go.replace('{reg}', profile.reg), doneCheck: s.doneCheck }; }),
      reward: cfg.reward };
  }

  /** THE transport mission mapping (rows in, Mission objects out): one mission per unfinished quest of every running bus.
   *  The framework applies the Today cap; Fleet Command's own screen shows them all. */
  function transportMissions(rows) {
    var cfg = questConfig(), out = [];
    profilesFromRows(rows).forEach(function (p) {
      questsFor(p).forEach(function (q) {
        if (q.done) return;
        var s = step(q.id), names = missingLabels(q.id, q.missing);
        out.push({ id: 'transport:setup_' + q.id + ':' + p.reg, module: 'transport', kind: 'setup_' + q.id, title: s.task + ' for ' + p.reg,
          why: 'Still needs ' + names.slice(0, 3).join(', ') + (names.length > 3 ? ' and ' + (names.length - 3) + ' more' : '') + '.',
          owner: null, role: cfg.role, campus: p.campusId, go: s.go.replace('{reg}', p.reg), due: null, source: s.source, done: false });
      });
    });
    return out;
  }

  /** The campus team bar: "LMS 4 fleet: 5 of 8 buses ready". Counts only. */
  function teamBar(campus, profiles) {
    var mine = (profiles || []).filter(function (p) { return p.campus === campus; });
    var ready = mine.filter(isReady).length;
    return { campus: campus, ready: ready, total: mine.length, text: campus + ' fleet: ' + ready + ' of ' + mine.length + ' buses ready' };
  }

  /** The Owner's gaps: per quest, how many buses still need it ("14 buses still need parts history"). No names. */
  function gaps(profiles) {
    return questConfig().steps.map(function (s) {
      var n = (profiles || []).filter(function (p) { return missingFor(s, p).length > 0; }).length;
      return { quest: s.id, count: n, text: n + (n === 1 ? ' bus still needs ' : ' buses still need ') + s.gap };
    });
  }

  // ── validation (the page before saving, the backend on every save) ──
  function ymd(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (!m) return false;
    var y = +m[1], mo = +m[2], d = +m[3], days = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return y >= 1900 && mo >= 1 && mo <= 12 && d >= 1 && d <= days[mo - 1];
  }
  /** Whole years from dob to today (both 'yyyy-MM-dd'). */
  function ageOn(dob, today) {
    var a = +today.slice(0, 4) - +dob.slice(0, 4);
    return today.slice(5) < dob.slice(5) ? a - 1 : a;
  }
  function checkValue(f, raw, today) {
    if (f.type === 'inspection') return { error: (f.col || f.id) + ' comes from the safety check on the capture page' };
    if (f.type === 'derived') return { error: (f.col || f.id) + ' comes from the route timelapse' };
    if (raw != null && typeof raw !== 'string' && typeof raw !== 'number') return { error: f.label + ': send text' };
    var v = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim(), L = f.label;
    if (!v) return { value: '' };
    if (v.length > 200) return { error: L + ': too long' };
    if (f.type === 'dateOrUnknown' && v.toLowerCase() === 'not known') return { value: 'not known' };
    if (f.type === 'date' || f.type === 'dateOrUnknown') {
      if (!ymd(v)) return { error: L + ': pick a date' };
      if (f.past && v > today) return { error: L + ' is in the future' };
    } else if (f.type === 'number') {
      if (!/^\d{1,8}(\.\d{1,2})?$/.test(v)) return { error: L + ': numbers only, no commas or units' };
    } else if (f.type === 'yesno') {
      v = v.toLowerCase();
      if (v !== 'yes' && v !== 'no') return { error: L + ': yes or no' };
    } else if (f.type === 'choice') {
      var hit = (f.options || []).filter(function (o) { return o.toLowerCase() === v.toLowerCase(); })[0];
      if (!hit) return { error: L + ': pick one of ' + f.options.join(', ') };
      v = hit;
    } else if (f.type === 'phone') {
      if (!/^\+?[0-9][0-9 -]{6,16}$/.test(v)) return { error: L + ': digits only' };
    } else if (f.type === 'photo') {
      if (!/^[A-Za-z0-9_-]{10,128}$/.test(v)) return { error: L + ': take the photo again' };
    } else if (v.length > 120) return { error: L + ': at most 120 characters' };
    return { value: v };
  }
  function checkFields(defs, given, today) {
    if (!given || typeof given !== 'object' || Array.isArray(given)) return { error: 'Send the fields as an object' };
    var out = {}, keys = Object.keys(given);
    for (var i = 0; i < keys.length; i++) {
      var f = null;
      for (var j = 0; j < defs.length; j++) if (defs[j].id === keys[i]) f = defs[j];
      if (!f) return { error: 'Unknown field: ' + String(keys[i]).slice(0, 40) };
      var c = checkValue(f, given[keys[i]], today);
      if (c.error) return c;
      if (c.value !== '') out[f.id] = c.value;
    }
    return { fields: out };
  }
  /** {fields: the clean, non-empty values} or {error}. The driver quest also says {ageLimit, warning?}: a driver 60 or over
   *  (Game Config transport.driverAgeLimit) is recorded and flagged; the line-up board keeps them off a bus. */
  function validateQuest(questId, given, today) {
    var s = step(questId);
    if (!s) return { error: 'Unknown quest: ' + String(questId).slice(0, 40) };
    var r;
    if (s.parts) {
      if (!given || typeof given !== 'object' || Array.isArray(given)) return { error: 'Send the parts as an object' };
      r = { fields: {} };
      var keys = Object.keys(given);
      for (var i = 0; i < keys.length; i++) {
        if (!s.parts.some(function (p) { return p.id === keys[i]; })) return { error: 'Unknown part: ' + String(keys[i]).slice(0, 40) };
        var c = checkFields(s.fields, given[keys[i]], today);
        if (c.error) return { error: missingLabels('parts', [keys[i]])[0] + ': ' + c.error };
        r.fields[keys[i]] = c.fields;
      }
      return r;
    }
    r = checkFields(s.fields, given, today);
    if (r.error || questId !== 'driver') return r;
    r.ageLimit = false;
    if (r.fields.dateOfBirth) {
      var age = ageOn(r.fields.dateOfBirth, today), limit = questConfig().driverAgeLimit;
      if (age < 18 || age > 90) return { error: 'Check the date of birth: that makes the driver ' + age };
      r.ageLimit = age >= limit;
      if (r.ageLimit) r.warning = 'Saved. The driver is ' + age + ', so ' + limit + ' or over: they cannot drive a school bus (the rule is under ' + limit + ').';
    }
    return r;
  }

  return { DEFAULT_ROWS: DEFAULT_ROWS, questConfig: questConfig, profilesFromRows: profilesFromRows, driverKey: driverKey,
    questsFor: questsFor, completion: completion, isReady: isReady, missingLabels: missingLabels, questFor: questFor,
    transportMissions: transportMissions, teamBar: teamBar, gaps: gaps, validateQuest: validateQuest, ageOn: ageOn };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = FleetQuests;
