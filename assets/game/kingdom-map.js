// The Kingdom on a real map (assets/game/kingdom-map.js): LMCS HQ and LMS 1-6 pinned on OpenStreetMap, the Owner's Map view.
//   LMCSKingdomMap.mount(host, { bases, onPick }) -> draws the map inside host (call again with fresh bases to update the levels);
//   bases: the Kingdom's campuses ({id, level, pct?, next?}); onPick(id, pin) opens that base's sheet; root: the way up to assets/;
//   townhall: {open, onPick(btn)} draws the Townhall beside LMCS HQ; pad: [[left, top], [right, bottom]] px the HUD covers, for the first fit.
// Each place is drawn as its building: art from places.js `art` (one path per place), level badge, progress bar, a "Next" flag.
// Positions and the connection lines (each place's `links`) come only from assets/game/places.js. Leaflet 1.9.4 (same cdnjs files and SRI as coordinator/route-map.js) loads here,
// when the Map page mounts the map (after the Owner check), never on other pages.
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
  // the connection lines: each pair of drawable places joined by either one's `links`, once
  function links(places, pins) {
    var at = {}, seen = {}, out = [];
    (pins || []).forEach(function (p) { at[p.id] = p; });
    (pins || []).forEach(function (p) {
      var l = places[p.id].links;
      (Array.isArray(l) ? l : []).forEach(function (q) {
        var k = [p.id, q].sort().join('|');
        if (q !== p.id && at[q] && !seen[k]) { seen[k] = true; out.push([p.id, q]); }
      });
    });
    return out;
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

  // one map for the page's life, inside the page (not a dialog): the base sheet a pin opens traps focus itself
  var V; // { root, mapEl, note }
  function build(host) {
    var root = el('div', 'kgm'), mapEl = el('div', 'kgm-map'), note = el('p', 'kgm-note');
    root.setAttribute('role', 'region'); root.setAttribute('aria-label', 'Map of LMCS HQ and the schools');
    root.appendChild(mapEl); root.appendChild(note);
    host.textContent = ''; host.appendChild(root);
    return (V = { root: root, mapEl: mapEl, note: note });
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
  var COMPACT_BELOW = 9; // far out (the whole valley and beyond), a building is small and shows its number only ("1", "HQ"): full names need room the map hasn't got
  function tag(p, compact) { return compact ? (p.id === 'HES' ? 'HQ' : p.id.replace(/^LMS/, '')) : short(p); }
  // a place's building: its art (places.js `art`, one path per place; a path with "placeholder" in it is marked "Art soon"),
  // the level badge, the progress bar, a flag on the place with the Owner's next step, and its name plate
  function art(src, cls) {
    var i = el('img', cls);
    i.alt = ''; i.decoding = 'async'; i.draggable = false;
    if (src && /^assets\/game\/[\w\/.-]+\.(webp|png|svg)$/.test(src) && src.indexOf('..') === -1) i.src = (V.opts.root || '') + src; // repo art only
    if (i.src && /-1x\.webp$/.test(src)) i.srcset = (V.opts.root || '') + src.replace(/-1x\.webp$/, '-2x.webp') + ' 2x';
    return i;
  }
  function pinFor(p, compact) {
    var b0 = V.base[p.id] || {}, opts = V.opts, b = el('button', 'kgm-b' + (p.id === 'HES' ? ' kgm-hq' : '') + (compact ? ' kgm-sm' : '') + (b0.next ? ' kgm-next' : '')); b.type = 'button';
    var src = (window.LMCSPlaces[p.id] || {}).art || '';
    b.setAttribute('aria-label', p.name + (b0.level !== undefined ? ', level ' + b0.level : '') + (b0.pct !== undefined ? ', ' + b0.pct + '% built' : '') + (b0.next ? ', your next step is here' : ''));
    if (b0.next) b.appendChild(el('span', 'kgm-flag', 'Next'));
    var pic = el('span', 'kgm-pic'); pic.appendChild(art(src, 'kgm-art'));
    if (/placeholder/.test(src)) pic.appendChild(el('span', 'kgm-ph', 'Art soon'));
    if (b0.level !== undefined) pic.appendChild(el('span', 'kgm-lvb', String(b0.level)));
    b.appendChild(pic);
    var plate = el('span', 'kgm-plate'); plate.appendChild(el('span', 'kgm-nm', tag(p, compact)));
    if (b0.pct !== undefined) { var hp = el('span', 'kgm-hp'), i = el('i'); i.style.width = Math.max(0, Math.min(100, b0.pct)) + '%'; hp.appendChild(i); plate.appendChild(hp); }
    b.appendChild(plate);
    b.addEventListener('click', function (e) {
      L.DomEvent.stopPropagation(e);
      if (opts.onPick) opts.onPick(p.id, b);
    });
    if (p.id !== 'HES' || !opts.townhall) return b;
    // the Townhall stands beside LMCS HQ (it has no place of its own on the real map)
    var wrap = el('span', 'kgm-hqset'), th = el('button', 'kgm-b kgm-th' + (compact ? ' kgm-sm' : '')); th.type = 'button';
    th.setAttribute('aria-label', 'Townhall: the services you can use' + (opts.townhall.open ? ', ' + opts.townhall.open + ' open' : ''));
    var thSrc = (window.LMCSPlaces.HES || {}).townhallArt || '', tp = el('span', 'kgm-pic'); tp.appendChild(art(thSrc, 'kgm-art'));
    if (/placeholder/.test(thSrc)) tp.appendChild(el('span', 'kgm-ph', 'Art soon'));
    th.appendChild(tp);
    var tpl = el('span', 'kgm-plate'); tpl.appendChild(el('span', 'kgm-nm', compact ? 'Hall' : 'Townhall')); th.appendChild(tpl);
    th.addEventListener('click', function (e) { L.DomEvent.stopPropagation(e); opts.townhall.onPick(th); });
    wrap.appendChild(b); wrap.appendChild(th);
    return wrap;
  }
  function groupPin(g, compact) {
    var nx = g.some(function (p) { return (V.base[p.id] || {}).next; }), b = el('button', 'kgm-b kgm-grp' + (compact ? ' kgm-sm' : '') + (nx ? ' kgm-next' : '')); b.type = 'button';
    b.setAttribute('aria-label', g.map(function (p) { return p.name; }).join(' and ') + ': zoom in' + (nx ? ', your next step is in here' : ''));
    if (nx) b.appendChild(el('span', 'kgm-flag', 'Next'));
    var pic = el('span', 'kgm-pic'); g.slice(0, 3).forEach(function (p) { pic.appendChild(art((window.LMCSPlaces[p.id] || {}).art, 'kgm-art')); }); b.appendChild(pic);
    var plate = el('span', 'kgm-plate'); plate.appendChild(el('span', 'kgm-nm', g.map(function (p) { return tag(p, compact); }).join(compact ? ' · ' : ' + '))); plate.appendChild(el('span', 'kgm-zm', 'Zoom in'));
    b.appendChild(plate);
    b.addEventListener('click', function (e) {
      L.DomEvent.stopPropagation(e);
      V.map.fitBounds(g.map(function (p) { return [p.lat, p.lng]; }), { padding: [120, 120], maxZoom: 15 });
    });
    return b;
  }
  function render() {
    if (!V.pins) return;
    var fx = document.activeElement && V.root.contains(document.activeElement) && document.activeElement.classList.contains('kgm-grp');
    V.layer.clearLayers();
    var pts = V.pins.map(function (p) { var c = V.map.latLngToContainerPoint([p.lat, p.lng]); return { id: p.id, name: p.name, lat: p.lat, lng: p.lng, x: c.x, y: c.y }; });
    var first, compact = V.map.getZoom() < COMPACT_BELOW + (V.mapEl.clientWidth < 600 ? 1 : 0); // a phone shows less ground per building
    cluster(pts, compact ? 84 : 150, compact ? 80 : 120).forEach(function (g) { // a building is about as tall as it is wide
      var b = g.length === 1 ? pinFor(g[0], compact) : groupPin(g, compact), lat = 0, lng = 0;
      g.forEach(function (p) { lat += p.lat / g.length; lng += p.lng / g.length; });
      L.marker([lat, lng], { icon: L.divIcon({ html: b, className: 'kgm-ico', iconSize: null }), keyboard: false }).addTo(V.layer);
      first = first || b;
    });
    if (fx && first) first.focus(); // a tapped group is gone after the zoom: keep focus on the map, not lost to the page
  }
  function draw(opts) {
    var places = window.LMCSPlaces || {}, base = {}, pins = drawable(places), total = Object.keys(places).filter(function (k) { return k !== 'CENTER'; }).length;
    (opts.bases || []).forEach(function (b) { base[b.id] = { level: Number(b.level) || 0, pct: typeof b.pct === 'number' ? b.pct : undefined, next: !!b.next }; });
    if (!V.map) {
      var c = places.CENTER || { lat: 31.8, lng: 77.0, zoom: 9 };
      V.map = L.map(V.mapEl, { attributionControl: true, scrollWheelZoom: true, zoomControl: false }).setView([c.lat, c.lng], c.zoom); // the map is the whole screen: the wheel zooms
      L.control.zoom({ position: 'bottomleft' }).addTo(V.map); // top and right belong to the HUD
      L.tileLayer(TILES, { maxZoom: 19, attribution: ATTR }).addTo(V.map);
      V.lines = L.layerGroup().addTo(V.map); // under the pins
      V.layer = L.layerGroup().addTo(V.map);
      V.map.on('zoomend', render);
    }
    V.map.invalidateSize(); V.pins = pins; V.base = base; V.opts = opts;
    var at = {}; pins.forEach(function (p) { at[p.id] = [p.lat, p.lng]; });
    V.lines.clearLayers();
    links(places, pins).forEach(function (l) { L.polyline([at[l[0]], at[l[1]]], { color: '#a10000', weight: 3, opacity: 0.55, dashArray: '6 8', interactive: false }).addTo(V.lines); });
    if (pins.length && !V.fitted) { V.fitted = true; V.map.fitBounds(pins.map(function (p) { return [p.lat, p.lng]; }), { paddingTopLeft: opts.pad ? opts.pad[0] : [40, 40], paddingBottomRight: opts.pad ? opts.pad[1] : [40, 40], maxZoom: 14, animate: false }); } // once: a refresh keeps where the Owner panned
    render(); // fitBounds without animation fires zoomend only when the zoom changes
    V.note.textContent = total - pins.length ? missingText(total - pins.length) : '';
    V.note.hidden = !V.note.textContent;
  }
  function mount(host, opts) {
    if (!V || V.root.parentNode !== host) build(host);
    V.opts = opts || {};
    if (window.L) return draw(V.opts);
    V.note.hidden = false; V.note.textContent = 'Loading the map…';
    loadLeaflet().then(function () { draw(V.opts); }, function (e) { V.note.textContent = e.message; });
  }
  return { drawable: drawable, links: links, missingText: missingText, group: group, cluster: cluster, short: short, tag: tag, mount: mount, TILES: TILES, ATTRIBUTION: ATTR };
})();
if (typeof module !== 'undefined') module.exports = window.LMCSKingdomMap;
