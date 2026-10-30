// The school building (assets/game/school-building.js): each campus drawn as an isometric 2.5D building, Kingshot-style, from
// data, never hand-drawn per school. Uday (28 Oct): "Can the Principal home screen have a 3d of their own School building? So
// that we can later event introduce class room related things on the building, maybe even move the inventory and logistics
// to these views". Plain SVG: fast on cheap phones, works offline, no animation.
//
// The model (a config value, so a new school is set up by data, and a Principal can later correct their own building):
//   { campus, name, sample, floorH, hills, blocks: [ block… ], grounds: [ ground… ] }
//   Ground units are tens of feet; floorH is a floor's height in the same units (default 1.15). Floors count up from 0.
//   A block is a box or an arc:
//     box: { id, name, x, y, w, d, floors, rooms }            (x runs right-down, y runs left-down on the screen)
//     arc: { id, name, kind: 'arc', cx, cy, r, depth, a0, a1, floors, rooms }   (a curved range: inner radius r, angles in degrees,
//          0 = along x, 90 = along y; rooms sit on the inner, concave face)
//   A room on a box: { id, name, short?, type, holds?, host?, e?, face: 'front' | 'side', floor, at, span }
//     front = the face along x (at = x offset from the block's x), side = the face along y (at = y offset).
//   A room on an arc: { id, name, short?, type, holds?, host?, e?, floor, from, to }  (from/to: 0..1 along the arc, a0 to a1)
//   A ground: { id, name, short?, type, host?, x, y, w, d } or { …, pts: [[x, y], …] } for any flat outline.
//   type: classroom | lab | computer | library | office | staff | store | washroom | hall | lobby | ground | busbay | site
//   holds: the class/section a classroom holds ("5A"). e: the room's own LMCSEmoji key when its type's emoji would mislead. host: the Home Base room it opens today (daily, hr, rules, setup, ss).
//   Later layers attach to a room's id: per-classroom (class teacher, CW/HW, attendance), 📦 inventory per room, 🚚 logistics.
//
//   LMCSBuilding.svg(model, { title, hosts }) -> an SVG string (every label escaped); rooms are <g class="sb-room" data-room="id">.
//   hosts: the host keys the page can open; only those rooms are drawn gold. LMCSBuilding.SAMPLE: a placeholder, marked
//   "sample". Real campuses come from assets/game/school-models.js (LMCSBuildingModels), later from Game Config.
var LMCSBuilding = (function () {
  // a room type -> its key in the shared emoji map (assets/game/emoji.js: one emoji per concept, everywhere)
  var TYPE_KEY = { classroom: 'classroom', lab: 'lab', computer: 'computerLab', library: 'library', office: 'office', staff: 'staffRoom', store: 'store',
    washroom: 'washroom', hall: 'hall', lobby: 'lobby', ground: 'ground', busbay: 'busBay', site: 'site' };
  var TYPES = Object.keys(TYPE_KEY);
  function emoji(type, key) { var E = typeof LMCSEmoji !== 'undefined' ? LMCSEmoji : null; return E ? E.get(key || TYPE_KEY[type]) : ''; } // key: a room's own LMCSEmoji key, else its type's

  // A placeholder school: a two-floor classroom block and a one-floor office wing, with a playground, a bus bay and a
  // building site. Shown, marked "sample", for any campus whose own building isn't set yet.
  var SAMPLE = {
    campus: '', name: 'Sample school', sample: true,
    blocks: [
      { id: 'main', name: 'Classroom block', x: 0, y: 0, w: 6, d: 2, floors: 2, rooms: [
        { id: 'c1a', name: 'Class 1A', type: 'classroom', holds: '1A', face: 'front', floor: 0, at: 0, span: 1 },
        { id: 'c2a', name: 'Class 2A', type: 'classroom', holds: '2A', face: 'front', floor: 0, at: 1, span: 1 },
        { id: 'c3a', name: 'Class 3A', type: 'classroom', holds: '3A', face: 'front', floor: 0, at: 2, span: 1 },
        { id: 'meet', name: 'Meeting room', short: 'Sessions', type: 'office', host: 'ss', e: 'supportSession', face: 'front', floor: 0, at: 3, span: 1 },
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

  var C30 = Math.cos(Math.PI / 6), S30 = 0.5, RAD = Math.PI / 180;
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v, d) { v = Number(v); return isFinite(v) ? v : d; }
  function clamp(v, lo, hi, d) { return Math.max(lo, Math.min(hi, num(v, d))); }
  function str(v, n) { return v == null ? '' : String(v).slice(0, n); }
  function obj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function roomBase(r) { return { id: str(r.id, 40), name: str(r.name, 60), short: str(r.short, 16), type: r.type, holds: str(r.holds, 12), host: str(r.host, 20), e: /^\w{1,30}$/.test(r.e) ? r.e : '' }; }

  // keep only what the drawing understands: numbers in range, known types, short names; a bad room is dropped, never drawn wrong
  function clean(m) {
    if (!obj(m)) return null;
    var blocks = (Array.isArray(m.blocks) ? m.blocks : []).filter(obj).slice(0, 12).map(function (b) {
      var f = Math.round(clamp(b.floors, 1, 8, 1)), arc = b.kind === 'arc';
      var out = { id: str(b.id, 40), name: str(b.name, 60), kind: arc ? 'arc' : 'box', floors: f };
      if (arc) {
        out.cx = clamp(b.cx, -100, 100, 0); out.cy = clamp(b.cy, -100, 100, 0); out.r = clamp(b.r, 0, 60, 5); out.depth = clamp(b.depth, 0.3, 20, 2);
        out.a0 = clamp(b.a0, -360, 720, 0); out.a1 = clamp(b.a1, -360, 720, 90);
        if (out.a1 - out.a0 < 1) out.a1 = out.a0 + 1;
        if (out.a1 - out.a0 > 300) out.a1 = out.a0 + 300;
      } else {
        out.x = clamp(b.x, -100, 100, 0); out.y = clamp(b.y, -100, 100, 0); out.w = clamp(b.w, 0.5, 30, 1); out.d = clamp(b.d, 0.5, 30, 1);
      }
      out.rooms = (Array.isArray(b.rooms) ? b.rooms : []).filter(obj).slice(0, 120).map(function (r) {
        var fl = Math.round(num(r.floor, -1));
        if (TYPES.indexOf(r.type) === -1 || fl < 0 || fl >= f) return null;
        var o = roomBase(r); o.floor = fl;
        if (arc) {
          o.from = clamp(r.from, 0, 1, 0); o.to = clamp(r.to, 0, 1, 1);
          if (o.to - o.from < 0.01) return null;
        } else {
          if (r.face !== 'front' && r.face !== 'side') return null;
          var len = r.face === 'front' ? out.w : out.d;
          o.face = r.face; o.at = clamp(r.at, 0, len, 0); o.span = Math.min(len - o.at, clamp(r.span, 0, 30, 1));
          if (o.span < 0.1) return null;
        }
        return o;
      }).filter(Boolean);
      return out;
    });
    var grounds = (Array.isArray(m.grounds) ? m.grounds : []).filter(obj).slice(0, 16).map(function (g) {
      if (TYPES.indexOf(g.type) === -1) return null;
      var o = roomBase(g), pts = Array.isArray(g.pts) ? g.pts.filter(function (p) { return Array.isArray(p) && p.length >= 2; }).slice(0, 64) : null;
      if (pts && pts.length >= 3) o.pts = pts.map(function (p) { return [clamp(p[0], -100, 100, 0), clamp(p[1], -100, 100, 0)]; });
      else { var x = clamp(g.x, -100, 100, 0), y = clamp(g.y, -100, 100, 0), w = clamp(g.w, 0.3, 30, 1), d = clamp(g.d, 0.3, 30, 1); o.pts = [[x, y], [x + w, y], [x + w, y + d], [x, y + d]]; }
      return o;
    }).filter(Boolean);
    if (!blocks.length) return null;
    return { campus: str(m.campus, 12), name: str(m.name, 60), sample: m.sample === true, floorH: clamp(m.floorH, 0.6, 2.5, 1.15),
      hills: m.hills === true, blocks: blocks, grounds: grounds };
  }

  // every room (grounds first, then block rooms) in one list: what a page lists beside the drawing
  function rooms(m) {
    var out = [];
    ((m && m.grounds) || []).forEach(function (g) { out.push(g); });
    ((m && m.blocks) || []).forEach(function (b) { (b.rooms || []).forEach(function (r) { out.push(r); }); });
    return out;
  }

  // ── geometry: every block becomes prisms (a 4-corner plan outline, floors high); faces turned to the viewer are drawn ──
  function arcPt(b, a, rr) { return [b.cx + rr * Math.cos(a * RAD), b.cy + rr * Math.sin(a * RAD)]; }
  function prismsOf(b) {
    if (b.kind === 'box') return [{ b: b, pl: [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.d], [b.x, b.y + b.d]], first: true, last: true }];
    var n = Math.max(2, Math.min(24, Math.ceil((b.a1 - b.a0) / 8))), out = [];
    for (var i = 0; i < n; i++) {
      var s = b.a0 + (b.a1 - b.a0) * i / n, e = b.a0 + (b.a1 - b.a0) * (i + 1) / n;
      // corners: inner start, inner end, outer end, outer start -> edges 0 inner face, 1 end cap, 2 outer face, 3 start cap
      out.push({ b: b, pl: [arcPt(b, s, b.r), arcPt(b, e, b.r), arcPt(b, e, b.r + b.depth), arcPt(b, s, b.r + b.depth)], first: i === 0, last: i === n - 1 });
    }
    return out;
  }
  // the viewer sits towards +x+y: a vertical face is seen when its outward normal (away from the prism's middle) points that way
  function seen(a, c, mid) {
    var nx = c[1] - a[1], ny = a[0] - c[0], ex = (a[0] + c[0]) / 2 - mid[0], ey = (a[1] + c[1]) / 2 - mid[1];
    if (nx * ex + ny * ey < 0) { nx = -nx; ny = -ny; }
    return nx + ny > 1e-6;
  }
  // a room's panel corners, inset a little from its slot
  function roomCorners(b, r) {
    var z0 = r.floor + 0.14, z1 = r.floor + 0.86;
    if (b.kind === 'arc') {
      var a = b.a0 + (b.a1 - b.a0) * r.from, e = b.a0 + (b.a1 - b.a0) * r.to, pad = Math.min(1.2, (e - a) * 0.08), steps, lo = [], hi = [];
      a += pad; e -= pad; steps = Math.max(1, Math.ceil((e - a) / 6));
      for (var i = 0; i <= steps; i++) { var t = a + (e - a) * i / steps, p = arcPt(b, t, b.r); lo.push([p[0], p[1], z0]); hi.unshift([p[0], p[1], z1]); }
      return lo.concat(hi);
    }
    var X = b.x, Y = b.y, X2 = b.x + b.w, Y2 = b.y + b.d, s = r.at + 0.08, f = r.at + r.span - 0.08;
    return r.face === 'front' ? [[X + s, Y2, z0], [X + f, Y2, z0], [X + f, Y2, z1], [X + s, Y2, z1]] : [[X2, Y + s, z0], [X2, Y + f, z0], [X2, Y + f, z1], [X2, Y + s, z1]];
  }

  // the drawing: optional hills, grounds, then prisms back to front (painter's order by plan depth), then the rooms

  // The campus picture (Art Bible v3, stylized 3D; assets/game/art/): shown above the drawn building, which stays the control. Only where a
  // reviewed render exists; a campus without one shows the drawn building alone. A picture is decoration: it carries a short alt, no logic.
  var ART_BASE = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src || '').replace(/[^\/]*$/, '') + 'art/';
  var ART = { LMS1: ['lms1-dhalpur', 'Dhalpur'], LMS2: ['lms2-kelheli', 'Kelheli'], LMS3: ['lms3-dunkhra', 'Dunkhra'], LMS4: ['lms4-nerchowk', 'Ner Chowk'] };
  function artFigure(campus) {
    var a = ART[String(campus || '').toUpperCase().replace(/\s+/g, '')]; if (!a) return '';
    return '<figure class="sb-art" style="margin:0 0 8px;position:sticky;left:0;width:min(100%,480px)"><img src="' + ART_BASE + a[0] + '-1x.webp" srcset="' + ART_BASE + a[0] +
      '-1x.webp 480w, ' + ART_BASE + a[0] + '-2x.webp 960w" sizes="(max-width:520px) 100vw, 480px" width="480" height="480" alt="Illustration of the ' + a[1] +
      ' school building" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:12px"></figure>';
  }

  function svg(model, opts) {
    var m = clean(model); if (!m) return '';
    opts = opts || {};
    var hosts = Array.isArray(opts.hosts) ? opts.hosts : null;
    var U = 40, H = U * m.floorH; // px per ground unit, px per floor
    function P(x, y, z) { return [(x - y) * U * C30, (x + y) * U * S30 - z * H]; }
    function poly(list) { return list.map(function (p) { var q = P(p[0], p[1], p[2] || 0); return q[0].toFixed(1) + ',' + q[1].toFixed(1); }).join(' '); }
    function centre(list) { var s = [0, 0]; list.forEach(function (p) { var q = P(p[0], p[1], p[2] || 0); s[0] += q[0]; s[1] += q[1]; }); return [s[0] / list.length, s[1] / list.length]; }
    var prisms = [];
    m.blocks.forEach(function (b) { prismsOf(b).forEach(function (p) { prisms.push(p); }); }); // for the bounds
    var pts = [];
    prisms.forEach(function (p) { p.pl.forEach(function (c) { pts.push(P(c[0], c[1], 0)); pts.push(P(c[0], c[1], p.b.floors)); }); });
    m.grounds.forEach(function (g) { g.pts.forEach(function (c) { pts.push(P(c[0], c[1], 0)); }); });
    var minX = Math.min.apply(null, pts.map(function (p) { return p[0]; })) - 24, maxX = Math.max.apply(null, pts.map(function (p) { return p[0]; })) + 24;
    var minY = Math.min.apply(null, pts.map(function (p) { return p[1]; })) - 34, maxY = Math.max.apply(null, pts.map(function (p) { return p[1]; })) + 24;
    function label(r) { return r.name + (r.holds && r.name.indexOf(r.holds) === -1 ? ' (' + r.holds + ')' : ''); }
    function isHost(r) { return !!r.host && (!hosts || hosts.indexOf(r.host) !== -1); }
    function roomG(r, corners, flat) {
      var c = centre(corners), host = isHost(r);
      return '<g class="sb-room' + (host ? ' sb-host' : '') + '" data-room="' + esc(r.id) + '" tabindex="0" role="button" aria-label="' + esc(label(r) + (host ? ', opens below' : '')) + '">' +
        '<polygon points="' + poly(corners) + '" class="sb-' + (flat ? 'ground' : 'win') + '"/>' +
        '<text x="' + c[0].toFixed(1) + '" y="' + (c[1] + 1).toFixed(1) + '" class="sb-e" aria-hidden="true">' + emoji(r.type, r.e) + '</text>' +
        (r.holds || host || flat ? '<text x="' + c[0].toFixed(1) + '" y="' + (c[1] + 15).toFixed(1) + '" class="sb-t" aria-hidden="true">' + esc(r.holds || r.short || r.name) + '</text>' : '') + '</g>';
    }
    var out = [];
    if (m.hills) { // the hillside behind, as in the photos: soft ridges, decoration only
      var w = maxX - minX, y0 = minY + (maxY - minY) * 0.42;
      out.push('<polygon class="sb-hill" aria-hidden="true" points="' + [minX, y0, minX + w * 0.28, minY + 6, minX + w * 0.6, y0 - 24, minX + w * 0.84, minY + 20, maxX, y0 - 12, maxX, y0 + 50, minX, y0 + 50].map(function (v) { return v.toFixed(0); }).join(' ') + '"/>');
    }
    m.grounds.forEach(function (g) { out.push(roomG(g, g.pts, true)); });
    function dep(x) { return x.pl.reduce(function (n, c) { return n + c[0] + c[1]; }, 0) / x.pl.length; }
    function drawPrism(p) {
      var F = p.b.floors, pl = p.pl, mid = [(pl[0][0] + pl[1][0] + pl[2][0] + pl[3][0]) / 4, (pl[0][1] + pl[1][1] + pl[2][1] + pl[3][1]) / 4], g = '<g class="sb-block" aria-hidden="true">';
      for (var i = 0; i < 4; i++) {
        if (p.b.kind === 'arc' && ((i === 3 && !p.first) || (i === 1 && !p.last))) continue; // the joins between arc pieces are inside the building
        var a = pl[i], c = pl[(i + 1) % 4];
        if (!seen(a, c, mid)) continue;
        var side = Math.abs(c[1] - a[1]) > Math.abs(c[0] - a[0]); // faces running along y read a shade darker, as the sun is to the right
        g += '<polygon class="' + (side ? 'sb-side' : 'sb-front') + '" points="' + poly([[a[0], a[1], 0], [c[0], c[1], 0], [c[0], c[1], F], [a[0], a[1], F]]) + '"/>';
        for (var f = 1; f < F; f++) g += '<polyline class="sb-floorline" points="' + poly([[a[0], a[1], f], [c[0], c[1], f]]) + '"/>';
      }
      g += '<polygon class="sb-roof" points="' + poly(pl.map(function (c) { return [c[0], c[1], F]; })) + '"/>';
      return g + '</g>';
    }
    // painter's order over every piece of every block, back to front; each room is drawn with the last-drawn piece it spans,
    // so a nearer piece (the tower in front of the range) covers what is behind it
    var pieces = [];
    m.blocks.forEach(function (bl) {
      var ps = prismsOf(bl);
      ps.forEach(function (p, i) { p.rooms = []; p.i = i; pieces.push(p); });
      bl.rooms.forEach(function (r) { // of the pieces a room spans, the one drawn last carries it
        var lo = bl.kind === 'arc' ? Math.min(ps.length - 1, Math.floor(r.from * ps.length)) : 0, hi = bl.kind === 'arc' ? Math.max(lo, Math.ceil(r.to * ps.length) - 1) : 0, best = ps[lo];
        for (var k = lo; k <= hi; k++) if (dep(ps[k]) >= dep(best)) best = ps[k];
        best.rooms.push(r);
      });
    });
    pieces.sort(function (p, q) { return dep(p) - dep(q); }).forEach(function (p) {
      out.push(drawPrism(p));
      p.rooms.forEach(function (r) { out.push(roomG(r, roomCorners(p.b, r), false)); });
    });
    var title = opts.title || ((m.name || 'School') + (m.sample ? ' (sample building)' : ''));
    return (opts.art === false ? '' : artFigure(opts.campus || m.campus)) + '<svg class="sb" viewBox="' + [minX, minY, maxX - minX, maxY - minY].map(function (v) { return v.toFixed(0); }).join(' ') + '" role="group" aria-label="' + esc(title) + '">' +
      out.join('') + (m.sample ? '<text x="' + (minX + 10).toFixed(0) + '" y="' + (minY + 20).toFixed(0) + '" class="sb-sample">Sample building</text>' : '') + '</svg>';
  }

  return { SAMPLE: SAMPLE, TYPE_KEY: TYPE_KEY, emoji: emoji, clean: clean, rooms: rooms, svg: svg };
})();
if (typeof module !== 'undefined') module.exports = LMCSBuilding;
