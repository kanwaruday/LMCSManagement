// The driver's bus (assets/game/bus-model.js): the driver's 🏠 Home Base, their own bus drawn from data, never hand-drawn per bus.
// Uday (28 Oct): "The Drivers should have the home view of the buses that they are allocated to, you know the bus make model etc,
// it needs to be built so that when later the drivers are expected to ask for repairs, they should be able to graphically explain
// what part is being serviced". Plain SVG in the school building's family (assets/game/school-building.js): no animation.
//
//   LMCSBus.body({ make, model, seats })  -> 'van' | 'mini' | 'large': the drawing to use (seats decide; a few model names win)
//   LMCSBus.PARTS                         -> the tappable parts: { id, hi, en, emoji?, svc: [Parts History ids], paper?, at: { side, front, back } }
//                                            at.<view> = [x, y] as shares of the body's box (0,0 top-left), absent when not seen from there
//   LMCSBus.svg(body, view, { sel, reg, title }) -> an SVG string; each part is <g class="bp-part" data-part="id" role="button" tabindex="0">
//   LMCSBus.info(part, bus)               -> [{ k, v }] lines for the part's card: service dates from the bus's parts history, or '—'
// A part's id is what a repair request will carry later (🔧 Report a problem: { reg, part, view, photo/voice }), so ids never change;
// new parts are added, old ones are not renamed. svc ids are the Fleet setup parts quest's (coordinator/capture/fleet-quests.js PARTS).
var LMCSBus = (function () {
  // side view: front on the left, as seen from the kerb side (the passenger door side in India)
  var SIDE = {
    van: { x0: 70, x1: 340, top: 72, bot: 146, nose: 0.13, noseTop: 104, wheels: [0.17, 0.82], r: 21 },
    mini: { x0: 44, x1: 358, top: 56, bot: 148, nose: 0.05, noseTop: 70, wheels: [0.16, 0.78], r: 23 },
    large: { x0: 18, x1: 384, top: 42, bot: 150, nose: 0.02, noseTop: 48, wheels: [0.17, 0.72], r: 25 }
  };
  var GROUND = 172;
  var VAN_MODELS = /traveller|winger|urbania|eeco|omni|tempo|cruiser|van/i;

  function seatsOf(s) { var m = String(s == null ? '' : s).match(/\d+/); return m ? Number(m[0]) : 0; }
  function body(bus) {
    var b = bus || {}, n = seatsOf(b.seats);
    if (VAN_MODELS.test(String(b.model || ''))) return 'van';
    if (!n) return 'mini'; // not on file: the middle size, and the page says the model is missing
    return n <= 14 ? 'van' : n <= 34 ? 'mini' : 'large';
  }

  // The parts. Positions are shares of the body's box so one table serves every size of bus.
  var PARTS = [
    { id: 'engine', hi: 'इंजन', en: 'Engine', svc: ['engine_oil', 'oil_filter', 'air_filter', 'fuel_filter', 'coolant', 'gearbox_oil', 'clutch'], at: { side: [0.07, 0.78], front: [0.5, 0.86] } },
    { id: 'battery', hi: 'बैटरी', en: 'Battery', svc: ['battery'], at: { side: [0.27, 0.93] } },
    { id: 'tyre_fl', hi: 'टायर, आगे बायाँ', en: 'Tyre, front left', svc: ['tyre_fl', 'wheel_bearing'], at: { side: ['w0', 1.12], front: [0.82, 1.1] } },
    { id: 'tyre_fr', hi: 'टायर, आगे दायाँ', en: 'Tyre, front right', svc: ['tyre_fr', 'wheel_bearing'], at: { front: [0.18, 1.1] } },
    { id: 'tyre_rl', hi: 'टायर, पीछे बायाँ', en: 'Tyre, rear left', svc: ['tyre_rl', 'wheel_bearing'], at: { side: ['w1', 1.12], back: [0.18, 1.1] } },
    { id: 'tyre_rr', hi: 'टायर, पीछे दायाँ', en: 'Tyre, rear right', svc: ['tyre_rr', 'wheel_bearing'], at: { back: [0.82, 1.1] } },
    { id: 'tyre_spare', hi: 'स्टेपनी', en: 'Spare tyre', svc: ['tyre_spare'], at: { back: [0.5, 0.62] } },
    { id: 'brakes', hi: 'ब्रेक', en: 'Brakes', svc: ['brake_front', 'brake_rear'], at: { side: ['w1', 0.62] } },
    { id: 'steering', hi: 'स्टीयरिंग', en: 'Steering', svc: ['steering', 'suspension'], at: { front: [0.3, 0.44] } },
    { id: 'lights_front', hi: 'आगे की लाइट', en: 'Headlights', svc: ['lights_wiring'], at: { front: [0.18, 0.72] } },
    { id: 'lights_back', hi: 'पीछे की लाइट', en: 'Tail lights', svc: ['lights_wiring'], at: { side: [0.985, 0.72], back: [0.15, 0.74] } },
    { id: 'indicators', hi: 'इंडिकेटर', en: 'Indicators', svc: ['lights_wiring'], at: { front: [0.08, 0.62], back: [0.85, 0.74] } },
    { id: 'horn', hi: 'हॉर्न', en: 'Horn', svc: ['lights_wiring'], at: { front: [0.5, 0.72] } },
    { id: 'wipers', hi: 'वाइपर', en: 'Wipers', svc: [], at: { front: [0.38, 0.5] } },
    { id: 'windscreen', hi: 'शीशे, खिड़कियाँ', en: 'Windscreen and windows', svc: [], at: { side: [0.58, 0.3], front: [0.62, 0.3], back: [0.5, 0.3] } },
    { id: 'doors', hi: 'दरवाज़े', en: 'Doors', svc: [], at: { side: [0.24, 0.55], back: [0.5, 0.5] } },
    { id: 'seats', hi: 'सीटें', en: 'Seats', svc: [], at: { side: [0.72, 0.3] } },
    { id: 'seat_belts', hi: 'सीट बेल्ट', en: 'Seat belts', svc: [], at: { side: [0.45, 0.3] } },
    { id: 'ac_fan', hi: 'AC / पंखा', en: 'AC or fan', svc: [], at: { side: [0.62, -0.08] } },
    { id: 'body', hi: 'बॉडी, डेंट', en: 'Body and dents', emoji: 'bus', svc: ['body_paint'], at: { side: [0.62, 0.72], back: [0.5, 0.86] } },
    { id: 'mirrors', hi: 'साइड मिरर', en: 'Mirrors', svc: [], at: { side: [0.0, 0.22], front: [0.96, 0.25] } },
    { id: 'fuel_tank', hi: 'डीज़ल टंकी', en: 'Fuel tank', emoji: 'fuel', svc: ['fuel_filter'], at: { side: [0.45, 0.93] } },
    { id: 'speedometer', hi: 'स्पीडोमीटर', en: 'Speedometer and odometer', svc: [], paper: 'speed_governor', at: { front: [0.7, 0.44] } },
    { id: 'gps_tracker', hi: 'GPS ट्रैकर', en: 'GPS tracker', svc: [], at: { side: [0.15, 0.3] } },
    { id: 'first_aid', hi: 'फर्स्ट-एड बॉक्स', en: 'First-aid box', svc: [], at: { side: [0.33, 0.42] } },
    { id: 'fire_extinguisher', hi: 'आग बुझाने का यंत्र', en: 'Fire extinguisher', svc: [], at: { side: [0.33, 0.75] } }
  ];
  var VIEWS = ['side', 'front', 'back'];
  var SVC = { engine_oil: 'Engine oil', oil_filter: 'Oil filter', fuel_filter: 'Fuel filter', air_filter: 'Air filter', coolant: 'Coolant',
    gearbox_oil: 'Gearbox oil', brake_front: 'Front brakes', brake_rear: 'Rear brakes', clutch: 'Clutch plate', tyre_fl: 'Tyre', tyre_fr: 'Tyre',
    tyre_rl: 'Tyre', tyre_rr: 'Tyre', tyre_spare: 'Spare tyre', battery: 'Battery', suspension: 'Suspension', steering: 'Steering joints',
    wheel_bearing: 'Wheel bearings', lights_wiring: 'Wiring and lights', body_paint: 'Body and paint' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function n(v) { return Math.round(v * 10) / 10; }

  /** Where a part sits in a view, in SVG units, or null when that view does not show it. */
  function place(part, kind, view) {
    var a = part.at[view];
    if (!a) return null;
    if (view === 'side') {
      var g = SIDE[kind], w = g.x1 - g.x0, h = g.bot - g.top;
      var fx = typeof a[0] === 'string' ? g.wheels[Number(a[0].slice(1))] : a[0];
      return [n(g.x0 + fx * w), n(g.top + a[1] * h)];
    }
    return [n(40 + a[0] * 160), n(40 + a[1] * 110)]; // front and back: a 160 x 110 box from (40, 40)
  }

  function wheel(cx, r) {
    return '<circle cx="' + cx + '" cy="' + (GROUND - r) + '" r="' + r + '" fill="#2b2f36"/><circle cx="' + cx + '" cy="' + (GROUND - r) + '" r="' + n(r * 0.45) + '" fill="#9aa1aa"/>';
  }
  function sideBody(kind) {
    var g = SIDE[kind], w = g.x1 - g.x0, nose = g.x0 + g.nose * w, out = '';
    // the body: a nose (bonnet) up front for vans and front-engine minis, then the box
    out += '<path d="M' + g.x0 + ' ' + g.bot + ' L' + g.x0 + ' ' + (g.noseTop + 8) + ' Q' + g.x0 + ' ' + g.noseTop + ' ' + (g.x0 + 8) + ' ' + g.noseTop +
      ' L' + nose + ' ' + g.noseTop + ' L' + (nose + 14) + ' ' + g.top + ' L' + (g.x1 - 8) + ' ' + g.top + ' Q' + g.x1 + ' ' + g.top + ' ' + g.x1 + ' ' + (g.top + 8) +
      ' L' + g.x1 + ' ' + g.bot + ' Z" fill="#f2c230" stroke="#7a5200" stroke-width="2.5"/>';
    out += '<rect x="' + g.x0 + '" y="' + (g.bot - 16) + '" width="' + w + '" height="6" fill="#7a5200" opacity=".35"/>'; // the school stripe
    // windows: a windscreen edge, then a row of windows behind the door
    var wy = g.top + 8, wh = Math.min(30, (g.bot - g.top) * 0.36), door = g.x0 + 0.24 * w;
    out += '<path d="M' + (nose + 3) + ' ' + (g.noseTop + 2) + ' L' + (nose + 15) + ' ' + wy + ' L' + (door - 18) + ' ' + wy + ' L' + (door - 18) + ' ' + (wy + wh) + ' L' + (nose + 3) + ' ' + (wy + wh) + ' Z" fill="#cfe6f5" stroke="#5a6b7a" stroke-width="1.5"/>';
    for (var x = door + 26; x < g.x1 - 30; x += 34) out += '<rect x="' + x + '" y="' + wy + '" width="28" height="' + wh + '" rx="3" fill="#cfe6f5" stroke="#5a6b7a" stroke-width="1.5"/>';
    out += '<rect x="' + (door - 12) + '" y="' + (wy + 2) + '" width="30" height="' + n(g.bot - wy - 14) + '" rx="3" fill="#e9b81f" stroke="#7a5200" stroke-width="2"/>'; // the door
    out += '<rect x="' + (g.x0 - 3) + '" y="' + n(g.top + 0.66 * (g.bot - g.top)) + '" width="9" height="9" rx="2" fill="#fff6c8" stroke="#7a5200"/>'; // headlight
    out += '<rect x="' + (g.x1 - 6) + '" y="' + n(g.top + 0.68 * (g.bot - g.top)) + '" width="8" height="12" rx="2" fill="#d1495b" stroke="#7a0000"/>'; // tail light
    out += '<path d="M' + (g.x0 + 2) + ' ' + n(g.top + 0.2 * (g.bot - g.top)) + ' l-12 -4 v10 z" fill="#5a6b7a"/>'; // mirror
    out += wheel(n(g.x0 + g.wheels[0] * w), g.r) + wheel(n(g.x0 + g.wheels[1] * w), g.r);
    return out;
  }
  function endBody(view) { // front or back: one shape for every size, the parts carry the difference
    var out = '<rect x="40" y="40" width="160" height="112" rx="12" fill="#f2c230" stroke="#7a5200" stroke-width="2.5"/>';
    out += '<rect x="52" y="50" width="136" height="' + (view === 'front' ? 46 : 38) + '" rx="6" fill="#cfe6f5" stroke="#5a6b7a" stroke-width="1.5"/>';
    if (view === 'front') {
      out += '<circle cx="69" cy="119" r="8" fill="#fff6c8" stroke="#7a5200"/><circle cx="171" cy="119" r="8" fill="#fff6c8" stroke="#7a5200"/>';
      out += '<rect x="96" y="112" width="48" height="16" rx="3" fill="#7a5200" opacity=".5"/>';
      out += '<path d="M34 64 l-10 -2 v14 z M206 64 l10 -2 v14 z" fill="#5a6b7a"/>';
    } else {
      out += '<rect x="58" y="114" width="14" height="18" rx="2" fill="#d1495b"/><rect x="168" y="114" width="14" height="18" rx="2" fill="#d1495b"/>';
      out += '<line x1="120" y1="92" x2="120" y2="150" stroke="#7a5200" stroke-width="2"/>';
    }
    out += '<rect x="56" y="150" width="30" height="22" rx="5" fill="#2b2f36"/><rect x="154" y="150" width="30" height="22" rx="5" fill="#2b2f36"/>';
    return out;
  }

  /** The bus in one view, every part a focusable button-like group; `sel` is the chosen part's id. */

  // The bus picture (Art Bible v3, stylized 3D; assets/game/art/): above the drawn bus, which stays the control. Only for the sizes with a reviewed render.
  var ART_BASE = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src || '').replace(/[^\/]*$/, '') + 'art/';
  var ART = { mini: 'bus-minibus-side', large: 'bus-large-side' };
  function artFigure(kind) {
    var a = ART[kind]; if (!a) return '';
    return '<figure class="bp-art" style="margin:0 0 8px"><img src="' + ART_BASE + a + '-1x.webp" srcset="' + ART_BASE + a + '-1x.webp 320w, ' + ART_BASE + a +
      '-2x.webp 640w" sizes="(max-width:360px) 100vw, 320px" width="320" height="160" alt="Illustration of a school bus" decoding="async" style="display:block;width:min(100%,320px);height:auto;margin:0 auto;border-radius:12px"></figure>';
  }

  function svg(kind, view, opts) {
    var o = opts || {}, k = SIDE[kind] ? kind : 'mini', v = VIEWS.indexOf(view) === -1 ? 'side' : view;
    var vb = v === 'side' ? '0 0 400 190' : '0 0 240 190';
    var out = '<svg class="bp-svg" viewBox="' + vb + '" role="group" aria-label="' + esc(o.title || 'Your bus') + '">';
    out += '<line x1="0" y1="' + GROUND + '" x2="400" y2="' + GROUND + '" stroke="#b9b2a5" stroke-width="2"/>';
    out += v === 'side' ? sideBody(k) : endBody(v);
    if (o.reg && v !== 'side') out += '<rect x="90" y="' + 138 + '" width="60" height="13" rx="2" fill="#fff" stroke="#1b2430"/><text x="120" y="' + 148 + '" text-anchor="middle" font-size="9" font-weight="800" fill="#1b2430">' + esc(o.reg) + '</text>';
    PARTS.forEach(function (p) {
      var xy = place(p, k, v);
      if (!xy) return;
      var on = o.sel === p.id;
      out += '<g class="bp-part' + (on ? ' is-sel' : '') + '" data-part="' + p.id + '" role="button" tabindex="0" aria-pressed="' + on + '" aria-label="' + esc(p.hi + ' · ' + p.en) + '">' +
        '<circle cx="' + xy[0] + '" cy="' + xy[1] + '" r="' + (v === 'side' ? 22 : 18) + '" fill="transparent"/>' + // the target, bigger than the dot (the side view is drawn smaller)
        '<circle cx="' + xy[0] + '" cy="' + xy[1] + '" r="' + (on ? 8 : 6) + '" fill="' + (on ? '#CE0000' : '#1b2430') + '" stroke="#fff" stroke-width="2"/></g>';
    });
    return (v === 'side' && o.art !== false ? artFigure(k) : '') + out + '</svg>';
  }

  /** Lines for a part's card: the latest saved date of each service the part covers, from Fleet setup's parts history. */
  function info(part, bus) {
    var hist = (bus && bus.parts) || {}, lines = [];
    (part.svc || []).forEach(function (id) {
      var d = hist[id];
      if (d && lines.every(function (l) { return l.k !== SVC[id]; })) lines.push({ k: SVC[id], v: d });
    });
    if (part.paper) {
      var p = ((bus && bus.papers) || {})[part.paper];
      lines.push({ k: 'Speed governor certificate', v: p && p.date ? p.date : '—' });
    }
    return lines.length ? lines : [{ k: 'Last service', v: '—' }];
  }

  return { body: body, seatsOf: seatsOf, PARTS: PARTS, VIEWS: VIEWS, place: place, svg: svg, info: info };
})();
if (typeof module !== 'undefined') module.exports = LMCSBus;
