// The school building (assets/game/school-building.js): each campus drawn as an isometric 2.5D building, Kingshot-style, from
// data, never hand-drawn per school. Uday (28 Oct): "Can the Principal home screen have a 3d of their own School building? So
// that we can later event introduce class room related things on the building, maybe even move the inventory and logistics
// to these views". Plain SVG: fast on cheap phones, works offline, no animation.
//
// The model (a config value, so a new school is set up by data, and a Principal can later correct their own building):
//   { campus, name, sample, blocks: [ { id, name, x, y, w, d, floors, rooms: [ room… ] } ], grounds: [ room… ] }
//   x, y, w, d are grid units on the ground (x runs right-down, y runs left-down); floors count upward from 0.
//   A room: { id, name, short?, type, holds?, host?, face: 'front' | 'side', floor, at, span }  (short: the label on the drawing)
//     front = the block's face along x (at = x offset from the block's x), side = the face along y (at = y offset).
//     A ground (playground, bus bay, building site) has x, y, w, d instead and sits on the ground.
//   type: classroom | lab | computer | library | office | staff | store | washroom | ground | busbay | site
//   holds: the class/section a classroom holds ("5A"). host: the Home Base room it opens today (daily, hr, rules, setup).
//   Later layers attach to a room's id: per-classroom (class teacher, CW/HW, attendance), 📦 inventory per room, 🚚 logistics.
//
//   LMCSBuilding.svg(model, { title }) -> an SVG string (every label escaped); rooms are <g class="sb-room" data-room="id">.
//   LMCSBuilding.SAMPLE is a believable placeholder, always marked "sample", until a campus's photos or floor plan arrive.
var LMCSBuilding = (function () {
  // a room type -> its key in the shared emoji map (assets/game/emoji.js: one emoji per concept, everywhere)
  var TYPE_KEY = { classroom: 'classroom', lab: 'lab', computer: 'computerLab', library: 'library', office: 'office', staff: 'staffRoom', store: 'store',
    washroom: 'washroom', ground: 'ground', busbay: 'busBay', site: 'site' };
  var TYPES = Object.keys(TYPE_KEY);
  function emoji(type) { var E = typeof LMCSEmoji !== 'undefined' ? LMCSEmoji : null; return E ? E.get(TYPE_KEY[type]) : ''; }

  // LMS 2 Kelheli placeholder: an L-shaped school, a two-floor classroom block and a one-floor office wing, with a playground,
  // a bus bay and a building site. The shape is a guess until Uday's photos come: the page says "sample" wherever it shows.
  var SAMPLE = {
    campus: 'LMS2', name: 'LMS 2 Kelheli', sample: true,
    blocks: [
      { id: 'main', name: 'Classroom block', x: 0, y: 0, w: 6, d: 2, floors: 2, rooms: [
        { id: 'c1a', name: 'Class 1A', type: 'classroom', holds: '1A', face: 'front', floor: 0, at: 0, span: 1 },
        { id: 'c2a', name: 'Class 2A', type: 'classroom', holds: '2A', face: 'front', floor: 0, at: 1, span: 1 },
        { id: 'c3a', name: 'Class 3A', type: 'classroom', holds: '3A', face: 'front', floor: 0, at: 2, span: 1 },
        { id: 'store', name: 'Store', type: 'store', face: 'front', floor: 0, at: 3, span: 1 },
        { id: 'wash', name: 'Washrooms', type: 'washroom', face: 'front', floor: 0, at: 4, span: 1 },
        { id: 'library', name: 'Library', type: 'library', host: 'rules', face: 'front', floor: 0, at: 5, span: 1 },
        { id: 'c4a', name: 'Class 4A', type: 'classroom', holds: '4A', face: 'front', floor: 1, at: 0, span: 1 },
        { id: 'c5a', name: 'Class 5A', type: 'classroom', holds: '5A', face: 'front', floor: 1, at: 1, span: 1 },
        { id: 'c6a', name: 'Class 6A', type: 'classroom', holds: '6A', face: 'front', floor: 1, at: 2, span: 1 },
        { id: 'c7a', name: 'Class 7A', type: 'classroom', holds: '7A', face: 'front', floor: 1, at: 3, span: 1 },
        { id: 'comp', name: 'Computer lab', type: 'computer', face: 'front', floor: 1, at: 4, span: 2 }
      ] },
      { id: 'wing', name: 'Office wing', x: 6, y: -2, w: 2, d: 4, floors: 1, rooms: [
        { id: 'office', name: "Principal's office", short: 'Office', type: 'office', host: 'daily', face: 'side', floor: 0, at: 0, span: 2 },
        { id: 'staff', name: 'Staff room', type: 'staff', host: 'hr', face: 'side', floor: 0, at: 2, span: 2 },
        { id: 'reception', name: 'Fee office', type: 'office', face: 'front', floor: 0, at: 0, span: 2 }
      ] }
    ],
    grounds: [
      { id: 'play', name: 'Playground', type: 'ground', x: 0.4, y: 2.8, w: 4.2, d: 2.2 },
      { id: 'site', name: 'Building site', short: 'Setup', type: 'site', host: 'setup', x: 8.8, y: 2.6, w: 1.8, d: 1.6 },
      { id: 'busbay', name: 'Bus bay', type: 'busbay', x: 8.8, y: -1.6, w: 1.8, d: 2.4 }
    ]
  };

  var C30 = Math.cos(Math.PI / 6), S30 = 0.5;
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v, d) { v = Number(v); return isFinite(v) ? v : d; }

  // keep only what the drawing understands: numbers in range, known types, short names; a bad room is dropped, never drawn wrong
  function clean(m) {
    if (!m || typeof m !== 'object') return null;
    var blocks = (Array.isArray(m.blocks) ? m.blocks : []).slice(0, 12).map(function (b) {
      var w = Math.max(0.5, Math.min(20, num(b.w, 1))), d = Math.max(0.5, Math.min(20, num(b.d, 1))), f = Math.max(1, Math.min(6, Math.round(num(b.floors, 1))));
      return { id: String(b.id || ''), name: String(b.name || '').slice(0, 60), x: num(b.x, 0), y: num(b.y, 0), w: w, d: d, floors: f,
        rooms: (Array.isArray(b.rooms) ? b.rooms : []).slice(0, 80).filter(function (r) {
          return r && TYPES.indexOf(r.type) !== -1 && (r.face === 'front' || r.face === 'side') && num(r.floor, -1) >= 0 && num(r.floor, -1) < f;
        }).map(function (r) {
          var len = r.face === 'front' ? w : d, at = Math.max(0, Math.min(len, num(r.at, 0)));
          return { id: String(r.id || ''), name: String(r.name || '').slice(0, 60), short: String(r.short || '').slice(0, 16), type: r.type, holds: r.holds ? String(r.holds).slice(0, 12) : '', host: r.host ? String(r.host) : '',
            face: r.face, floor: Math.round(num(r.floor, 0)), at: at, span: Math.max(0.3, Math.min(len - at, num(r.span, 1))) };
        }) };
    });
    var grounds = (Array.isArray(m.grounds) ? m.grounds : []).slice(0, 12).filter(function (g) { return g && TYPES.indexOf(g.type) !== -1; }).map(function (g) {
      return { id: String(g.id || ''), name: String(g.name || '').slice(0, 60), short: String(g.short || '').slice(0, 16), type: g.type, host: g.host ? String(g.host) : '',
        x: num(g.x, 0), y: num(g.y, 0), w: Math.max(0.3, Math.min(20, num(g.w, 1))), d: Math.max(0.3, Math.min(20, num(g.d, 1))) };
    });
    if (!blocks.length) return null;
    return { campus: String(m.campus || ''), name: String(m.name || '').slice(0, 60), sample: m.sample === true, blocks: blocks, grounds: grounds };
  }

  // every room (block rooms and grounds) with its block, in one list: what a page lists beside the drawing
  function rooms(m) {
    var out = [];
    (m.grounds || []).forEach(function (g) { out.push(g); });
    (m.blocks || []).forEach(function (b) { (b.rooms || []).forEach(function (r) { out.push(r); }); });
    return out;
  }

  // the drawing: ground diamond, grounds, then blocks back to front (painter's order), each with top, front and side faces;
  // rooms are panels on the faces; a room with a host is outlined gold (it opens a Home Base room today)
  function svg(model, opts) {
    var m = clean(model); if (!m) return '';
    opts = opts || {};
    var U = 40, H = 46; // px per grid unit, px per floor
    function P(x, y, z) { return [(x - y) * U * C30, (x + y) * U * S30 - z * H]; }
    var pts = [];
    m.blocks.forEach(function (b) { [[b.x, b.y, 0], [b.x + b.w, b.y, 0], [b.x, b.y + b.d, 0], [b.x + b.w, b.y + b.d, 0], [b.x, b.y, b.floors], [b.x + b.w, b.y, b.floors], [b.x, b.y + b.d, b.floors]].forEach(function (p) { pts.push(P(p[0], p[1], p[2])); }); });
    m.grounds.forEach(function (g) { [[g.x, g.y], [g.x + g.w, g.y], [g.x, g.y + g.d], [g.x + g.w, g.y + g.d]].forEach(function (p) { pts.push(P(p[0], p[1], 0)); }); });
    var minX = Math.min.apply(null, pts.map(function (p) { return p[0]; })) - 24, maxX = Math.max.apply(null, pts.map(function (p) { return p[0]; })) + 24;
    var minY = Math.min.apply(null, pts.map(function (p) { return p[1]; })) - 30, maxY = Math.max.apply(null, pts.map(function (p) { return p[1]; })) + 24;
    function poly(list) { return list.map(function (p) { var q = P(p[0], p[1], p[2]); return q[0].toFixed(1) + ',' + q[1].toFixed(1); }).join(' '); }
    function centre(list) { var s = [0, 0]; list.forEach(function (p) { var q = P(p[0], p[1], p[2]); s[0] += q[0]; s[1] += q[1]; }); return [s[0] / list.length, s[1] / list.length]; }
    function label(r) { return r.name + (r.holds && r.name.indexOf(r.holds) === -1 ? ' (' + r.holds + ')' : ''); }
    function roomG(r, corners, flat) {
      var c = centre(corners), host = !!r.host;
      return '<g class="sb-room' + (host ? ' sb-host' : '') + '" data-room="' + esc(r.id) + '" tabindex="0" role="button" aria-label="' + esc(label(r)) + '">' +
        '<polygon points="' + poly(corners) + '" class="sb-' + (flat ? 'ground' : 'win') + '"/>' +
        '<text x="' + c[0].toFixed(1) + '" y="' + (c[1] + 1).toFixed(1) + '" class="sb-e" aria-hidden="true">' + emoji(r.type) + '</text>' +
        (r.holds || host || flat ? '<text x="' + c[0].toFixed(1) + '" y="' + (c[1] + 15).toFixed(1) + '" class="sb-t" aria-hidden="true">' + esc(r.holds || r.short || r.name) + '</text>' : '') + '</g>';
    }
    var out = [];
    m.grounds.forEach(function (g) { out.push(roomG(g, [[g.x, g.y, 0], [g.x + g.w, g.y, 0], [g.x + g.w, g.y + g.d, 0], [g.x, g.y + g.d, 0]], true)); });
    m.blocks.slice().sort(function (a, b) { return (a.x + a.y) - (b.x + b.y); }).forEach(function (b) {
      var X = b.x, Y = b.y, X2 = b.x + b.w, Y2 = b.y + b.d, F = b.floors, g = '<g class="sb-block" aria-hidden="true">';
      g += '<polygon class="sb-front" points="' + poly([[X, Y2, 0], [X2, Y2, 0], [X2, Y2, F], [X, Y2, F]]) + '"/>';
      g += '<polygon class="sb-side" points="' + poly([[X2, Y, 0], [X2, Y2, 0], [X2, Y2, F], [X2, Y, F]]) + '"/>';
      g += '<polygon class="sb-roof" points="' + poly([[X, Y, F], [X2, Y, F], [X2, Y2, F], [X, Y2, F]]) + '"/>';
      for (var f = 1; f < F; f++) g += '<polyline class="sb-floorline" points="' + poly([[X, Y2, f], [X2, Y2, f], [X2, Y, f]]) + '"/>';
      out.push(g + '</g>');
      b.rooms.forEach(function (r) {
        var i = 0.08, z0 = r.floor + 0.14, z1 = r.floor + 0.86, a = r.at + i, e = r.at + r.span - i;
        out.push(roomG(r, r.face === 'front' ? [[X + a, Y2, z0], [X + e, Y2, z0], [X + e, Y2, z1], [X + a, Y2, z1]] : [[X2, Y + a, z0], [X2, Y + e, z0], [X2, Y + e, z1], [X2, Y + a, z1]], false));
      });
    });
    var title = opts.title || ((m.name || 'School') + (m.sample ? ' (sample building)' : ''));
    return '<svg class="sb" viewBox="' + [minX, minY, maxX - minX, maxY - minY].map(function (v) { return v.toFixed(0); }).join(' ') + '" role="group" aria-label="' + esc(title) + '">' +
      out.join('') + (m.sample ? '<text x="' + (minX + 10).toFixed(0) + '" y="' + (minY + 20).toFixed(0) + '" class="sb-sample">Sample building</text>' : '') + '</svg>';
  }

  return { SAMPLE: SAMPLE, TYPE_KEY: TYPE_KEY, emoji: emoji, clean: clean, rooms: rooms, svg: svg };
})();
if (typeof module !== 'undefined') module.exports = LMCSBuilding;
