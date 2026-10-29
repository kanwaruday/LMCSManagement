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
  function draw(opts) {
    var places = window.LMCSPlaces || {}, level = {}, pins = drawable(places), total = Object.keys(places).filter(function (k) { return k !== 'CENTER'; }).length;
    (opts.bases || []).forEach(function (b) { level[b.id] = Number(b.level) || 0; });
    if (!V.map) {
      var c = places.CENTER || { lat: 31.8, lng: 77.0, zoom: 9 };
      V.map = L.map(V.mapEl, { zoomControl: true, attributionControl: true }).setView([c.lat, c.lng], c.zoom);
      L.tileLayer(TILES, { maxZoom: 19, attribution: ATTR }).addTo(V.map);
      V.layer = L.layerGroup().addTo(V.map);
    }
    V.map.invalidateSize(); V.layer.clearLayers();
    var pts = pins.map(function (p) {
      var b = el('button', 'kgm-pin' + (p.id === 'HES' ? ' kgm-hq' : '')); b.type = 'button';
      b.setAttribute('aria-label', p.name + (level[p.id] !== undefined ? ', level ' + level[p.id] : ''));
      b.appendChild(emoji(p.id === 'HES' ? 'hq' : 'school'));
      b.appendChild(el('span', 'kgm-nm', p.name));
      if (level[p.id] !== undefined) b.appendChild(el('span', 'kgm-lv', 'Lv ' + level[p.id]));
      b.addEventListener('click', function (e) {
        L.DomEvent.stopPropagation(e);
        if (!opts.onPick) return;
        V.release(false); // the sheet that opens traps focus itself; take the trap back when it closes
        opts.onPick(p.id, b);
        var dlg = document.querySelector('dialog[open]');
        if (dlg) dlg.addEventListener('close', function () { if (!V.root.hidden) { V.release = LMCSGame.ui.trap(V.root, close); b.focus(); } }, { once: true });
        else V.release = LMCSGame.ui.trap(V.root, close);
      });
      L.marker([p.lat, p.lng], { icon: L.divIcon({ html: b, className: 'kgm-ico', iconSize: null }), keyboard: false }).addTo(V.layer);
      return [p.lat, p.lng];
    });
    if (pts.length) V.map.fitBounds(pts, { padding: [60, 60], maxZoom: 14 });
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
  return { drawable: drawable, missingText: missingText, open: open, close: close, TILES: TILES, ATTRIBUTION: ATTR };
})();
if (typeof module !== 'undefined') module.exports = window.LMCSKingdomMap;
