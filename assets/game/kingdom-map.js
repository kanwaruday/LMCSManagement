// The Kingdom on a real map (assets/game/kingdom-map.js): LMCS HQ and LMS 1-6 pinned on OpenStreetMap, a full-screen pannable scene.
//   LMCSKingdomMap.open({ bases, onPick, opener }) -> bases: the Kingdom's campuses ({id, name, level}); onPick(id) opens that base's sheet.
// Positions come only from assets/game/places.js. Leaflet 1.9.4 (same cdnjs files and SRI as coordinator/route-map.js) loads here,
// the first time the map is opened, never on the Kingdom's first paint.
window.LMCSKingdomMap = (function () {
  var LEAFLET = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/';
  var SRI = { js: 'sha512-puJW3E/qXDqYp9IfhAI54BJEaWIfloJ7JWs7OeD5i6ruC9JZL1gERT1wjtwXFlh7CjE7ZJ+/vcRZRkIYIb6p4g==',
    css: 'sha512-h9FcoyWjHcOcmEVkxOfTLnmZFWIH0iZhZT1H2TbOq55xssQGEJHEaIm+PgoUaZbRvQTNTluNOEfb1ZRy6D3BOw==' };
  var TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', ATTR = '&copy; OpenStreetMap contributors';
  var ok = function (n, lo, hi) { return typeof n === 'number' && isFinite(n) && n >= lo && n <= hi; };

  // the places that can be drawn (valid coordinates), and how many cannot yet
  function drawable(places) {
    return Object.keys(places || {}).filter(function (k) { return k !== 'CENTER'; }).filter(function (k) { var p = places[k]; return p && ok(p.lat, 31, 33) && ok(p.lng, 75.5, 78); })
      .map(function (k) { return { id: k, name: places[k].name, lat: places[k].lat, lng: places[k].lng }; });
  }
  function missingText(n) { return n + (n === 1 ? ' place still needs a map pin' : ' places still need a map pin'); }

  var loading;
  function loadLeaflet() {
    if (window.L) return Promise.resolve();
    if (loading) return loading;
    var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = LEAFLET + 'leaflet.min.css'; l.integrity = SRI.css; l.crossOrigin = 'anonymous';
    document.head.appendChild(l);
    return loading = new Promise(function (ok, no) {
      var s = document.createElement('script'); s.src = LEAFLET + 'leaflet.min.js'; s.integrity = SRI.js; s.crossOrigin = 'anonymous';
      s.onload = ok; s.onerror = function () { loading = null; no(new Error('Could not load the map. Check the connection.')); };
      document.head.appendChild(s);
    });
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }
  function emoji(k) { return (window.LMCSEmoji && LMCSEmoji.tag(k)) || document.createTextNode(''); }

  // one map for the page's life: closing hides it, opening shows it again and redraws the pins
  var V; // { root, map, layer, note, release, opener, retrap }
  function close() {
    if (!V || V.root.hidden) return;
    V.release(false); V.root.hidden = true;
    var o = V.opener; V.opener = null;
    if (o && o.isConnected) o.focus();
  }
  function build() {
    var root = el('div', 'kgm'), mapEl = el('div', 'kgm-map'), note = el('p', 'kgm-note');
    var x = el('button', 'kgm-x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Close the map'); x.onclick = close;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Kingdom on a real map');
    mapEl.setAttribute('aria-label', 'Map of LMCS HQ and the schools');
    root.appendChild(mapEl); root.appendChild(x); root.appendChild(note);
    document.body.appendChild(root);
    return (V = { root: root, mapEl: mapEl, note: note, x: x, release: function () {} });
  }
  function short(p) { return p.id === 'HES' ? 'HQ' : p.name.split(' ').slice(0, 2).join(' '); } // "LMS 1": the full name is in the label
  // pins closer than gx by gy px on screen (a pin is wide and short) join one group, so labels never stack; tapping a group zooms in to split it
  function group(pts, gx, gy) {
    var out = [];
    pts.forEach(function (p) {
      var g = out.filter(function (g) { return g.some(function (q) { return Math.abs(q.x - p.x) < gx && Math.abs(q.y - p.y) < gy; }); })[0];
      if (g) g.push(p); else out.push([p]);
    });
    return out;
  }
  // regroup by each group's centre until nothing more joins, so a group's label never lands on a neighbour
  function cluster(pts, gx, gy) {
    var gs = pts.map(function (p) { return [p]; });
    for (;;) {
      var cs = gs.map(function (g) { var x = 0, y = 0; g.forEach(function (p) { x += p.x / g.length; y += p.y / g.length; }); return { x: x, y: y, m: g }; });
      var next = group(cs, gx, gy).map(function (gg) { return [].concat.apply([], gg.map(function (c) { return c.m; })); });
      if (next.length === gs.length) return next;
      gs = next;
    }
  }
  var COMPACT_BELOW = 11; // zoomed out, a pin shows its number only ("1", "HQ"): full names need room the map hasn't got
  function tag(p, compact) { return compact ? (p.id === 'HES' ? 'HQ' : p.id.replace(/^LMS/, '')) : short(p); }
  function pinFor(p, compact) {
    var level = V.level, opts = V.opts, b = el('button', 'kgm-pin' + (p.id === 'HES' ? ' kgm-hq' : '')); b.type = 'button';
    b.setAttribute('aria-label', p.name + (level[p.id] !== undefined ? ', level ' + level[p.id] : ''));
    b.appendChild(emoji(p.id === 'HES' ? 'hq' : 'school'));
    b.appendChild(el('span', 'kgm-nm', tag(p, compact)));
    if (!compact && level[p.id] !== undefined) b.appendChild(el('span', 'kgm-lv', 'Lv ' + level[p.id]));
    b.addEventListener('click', function (e) {
      L.DomEvent.stopPropagation(e);
      if (!opts.onPick) return;
      V.release(false); // the sheet that opens traps focus itself; take the trap back when it closes
      opts.onPick(p.id, b);
      var dlg = document.querySelector('dialog[open]');
      if (dlg) dlg.addEventListener('close', function () { if (!V.root.hidden) { V.release = LMCSGame.ui.trap(V.root, close); b.focus(); } }, { once: true });
      else V.release = LMCSGame.ui.trap(V.root, close);
    });
    return b;
  }
  function groupPin(g, compact) {
    var b = el('button', 'kgm-pin kgm-grp'); b.type = 'button';
    b.setAttribute('aria-label', g.map(function (p) { return p.name; }).join(' and ') + ': zoom in');
    b.appendChild(emoji('school')); b.appendChild(el('span', 'kgm-nm', g.map(function (p) { return tag(p, compact); }).join(compact ? ' · ' : ' + ')));
    b.addEventListener('click', function (e) {
      L.DomEvent.stopPropagation(e);
      V.map.fitBounds(g.map(function (p) { return [p.lat, p.lng]; }), { padding: [90, 90], maxZoom: 15 });
    });
    return b;
  }
  function render() {
    if (!V.pins) return;
    var fx = document.activeElement && V.root.contains(document.activeElement) && document.activeElement.classList.contains('kgm-grp');
    V.layer.clearLayers();
    var pts = V.pins.map(function (p) { var c = V.map.latLngToContainerPoint([p.lat, p.lng]); return { id: p.id, name: p.name, lat: p.lat, lng: p.lng, x: c.x, y: c.y }; });
    var first, compact = V.map.getZoom() < COMPACT_BELOW;
    cluster(pts, compact ? 72 : 130, 50).forEach(function (g) {
      var b = g.length === 1 ? pinFor(g[0], compact) : groupPin(g, compact), lat = 0, lng = 0;
      g.forEach(function (p) { lat += p.lat / g.length; lng += p.lng / g.length; });
      L.marker([lat, lng], { icon: L.divIcon({ html: b, className: 'kgm-ico', iconSize: null }), keyboard: false }).addTo(V.layer);
      first = first || b;
    });
    if (fx && first) first.focus(); // a tapped group is gone after the zoom: keep focus on the map, not lost to the page
  }
  function draw(opts) {
    var places = window.LMCSPlaces || {}, level = {}, pins = drawable(places), total = Object.keys(places).filter(function (k) { return k !== 'CENTER'; }).length;
    (opts.bases || []).forEach(function (b) { level[b.id] = Number(b.level) || 0; });
    if (!V.map) {
      var c = places.CENTER || { lat: 31.8, lng: 77.0, zoom: 9 };
      V.map = L.map(V.mapEl, { zoomControl: true, attributionControl: true }).setView([c.lat, c.lng], c.zoom);
      L.tileLayer(TILES, { maxZoom: 19, attribution: ATTR }).addTo(V.map);
      V.layer = L.layerGroup().addTo(V.map);
    }
    V.map.invalidateSize(); V.pins = pins; V.level = level; V.opts = opts;
    if (!V.zoomed) { V.zoomed = true; V.map.on('zoomend', render); }
    if (pins.length) V.map.fitBounds(pins.map(function (p) { return [p.lat, p.lng]; }), { padding: [70, 70], maxZoom: 14 });
    render(); // fitBounds without animation fires zoomend only when the zoom changes
    V.note.textContent = total - pins.length ? missingText(total - pins.length) : '';
    V.note.hidden = !V.note.textContent;
  }
  function open(opts) {
    var v = V || build(), opener = opts.opener || document.activeElement;
    v.root.hidden = false; v.opener = opener;
    v.release = LMCSGame.ui.trap(v.root, close);
    v.x.focus();
    v.note.hidden = false; v.note.textContent = 'Loading the map…';
    loadLeaflet().then(function () { if (!v.root.hidden) draw(opts); }, function (e) { v.note.textContent = e.message; });
  }
  return { drawable: drawable, missingText: missingText, group: group, cluster: cluster, short: short, tag: tag, open: open, close: close, TILES: TILES, ATTRIBUTION: ATTR,
    load: loadLeaflet }; // load: the Owner's map home (assets/game/map-home.js) draws its own pins on the same Leaflet
})();
if (typeof module !== 'undefined') module.exports = window.LMCSKingdomMap;
