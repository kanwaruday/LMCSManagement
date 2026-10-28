/* Transport route views, drawn like a transport game so each decision reads at a glance (directions chosen by Uday 2026-10-25:
   all three, for Coordinators and the Owner; may be split by role later -- pages pick views through TransportChecks' opts.views):
     metro  -- Route map (Mini Metro): merge two routes? combine stops? which lines lose money?
     city   -- Stops and walking areas (Cities: Skylines): move a stop? two buses in one village? where the road really goes
     depot  -- Depot (OpenTTD vehicle list): scrap a bus? fix a tracker? too big a bus? which buses lose money?
   Data: the Coordinator backend's coordinatortransportinsight (stops, tracks, vehicles, pnl, days), already scoped to the caller's
   campuses. Stop locations never live in this public repo. When the staff stop workbook is wired in, a stop's `name` (checked name)
   and `students` (children at the stop) are used where present; until then the GPS place name and route totals stand in.
   Needs Leaflet (window.L) for the city view. Without pnl in the data (the route World: transportworld, driverroute) nothing shows
   money: no badges, no money lines, no money colours. Mounted outside the transport pages by coordinator/route-map.js. */
window.TransportViews = (function () {
  const LINES = ['#d1495b', '#00798c', '#d68c1a', '#30638e', '#5b9a6f', '#8d6a9f', '#2e4057', '#b5604f', '#3c9d9b', '#9a7b24'];
  const PROFIT = '#15803d', LOSS = '#CE0000', WARN = '#b45309', OFF = '#8a939c', INK = '#1a1a1a';
  const WALK_M = 500; // a stop's walking area
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const lakh = n => (n < 0 ? '−' : '+') + '₹' + (Math.abs(n) / 100000).toFixed(2) + ' L';
  const mins = t => +String(t).slice(0, 2) * 60 + +String(t).slice(3, 5);

  /** "0.87 Km S of HVXP X7Q, Nalwari, Himachal Pradesh 175008, India" -> "Nalwari" (the village, not the plus code or the state) */
  function village(place) {
    const p = String(place || '').replace(/^[\d.]+\s*Km\s+[NSEW]+\s+of\s+/i, '').replace(/\(Himachal Pradesh\s*\)/g, '');
    const parts = p.split(',').map(x => x.trim()).filter(x => x && !/^[A-Z0-9]{4}\s?[A-Z0-9]{2,3}\b/.test(x) && !/Himachal|India/.test(x) && !/\d{6}/.test(x));
    return (parts[parts.length - 1] || p.trim()).slice(0, 30);
  }

  /** Everything the three views share, built once per data load. */
  function model(d) {
    if (d._views) return d._views;
    const veh = {};
    d.vehicles.forEach(v => { veh[v.reg] = Object.assign({ net: null, months: 0 }, v); });
    const months = Array.from(new Set((d.pnl || []).map(r => r.month))).sort();
    (d.pnl || []).forEach(r => { const v = veh[r.reg]; if (!v) return; v.net = (v.net || 0) + r.fee - r.fuel - r.loan - r.fixed - r.pay; });
    const km = {};
    d.days.forEach(x => { if (Number(x.km) > 5) (km[x.reg] = km[x.reg] || []).push(Number(x.km)); });
    Object.keys(km).forEach(r => { if (veh[r]) veh[r].kmday = Math.round(km[r].reduce((a, b) => a + b, 0) / km[r].length); });
    const buses = Array.from(new Set(d.stops.map(s => s.bus))).sort();
    const colour = {};
    buses.forEach((b, i) => { colour[b] = LINES[i % LINES.length]; });
    const trips = {}, waits = {};
    d.stops.forEach(s => {
      const st = { bus: s.bus, trip: s.trip, seq: Number(s.seq), name: s.name || village(s.place), t: s.arrive_usual, lat: Number(s.lat), lng: Number(s.lng),
        sure: Number(s.days_seen) / Math.max(1, Number(s.run_days)), shared: s.shared_with ? String(s.shared_with).split(' ').filter(Boolean) : [], students: s.students == null || s.students === '' ? null : Number(s.students) };
      if (s.kind === 'stop') ((trips[s.bus] = trips[s.bus] || {})[s.trip] = trips[s.bus][s.trip] || []).push(st);
      else (waits[s.bus] = waits[s.bus] || []).push(st);
    });
    Object.values(trips).forEach(t => Object.values(t).forEach(list => list.sort((a, b) => a.seq - b.seq)));
    const tracks = {};
    (d.tracks || []).forEach(t => { ((tracks[t.reg] = tracks[t.reg] || {})[t.trip] = t.path); });
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], mon = ym => MON[+ym.slice(5, 7) - 1];
    const period = !months.length ? '' : months.length === 1 ? mon(months[0]) + ' ' + months[0].slice(0, 4) : mon(months[0]) + '–' + mon(months[months.length - 1]) + ' ' + months[months.length - 1].slice(0, 4);
    return (d._views = { veh, buses, colour, trips, waits, tracks, months, period });
  }

  /** Children a bus can carry per direction: seats on each round it makes (rounds count both directions). */
  function capacity(v) { return v.seats ? v.seats * Math.max(1, Math.round((v.rounds || 2) / 2)) : 0; }

  /** Decision tags for a vehicle: suggestions from the data, for the Owner to decide. */
  function decisions(v, year) {
    const out = [], age = v.year ? year - Number(v.year) : 0, cap = capacity(v);
    if (!v.operational) out.push(['Off the road: scrap or sell', OFF]);
    else if (age >= 15) out.push(['Past 15 years: replace', LOSS]);
    else if (age >= 13) out.push(['15 years in ' + (Number(v.year) + 15), WARN]);
    if (v.operational && v.tracker === 'dead') out.push(['Fix tracker', LOSS]);
    if (v.operational && v.tracker === 'blind') out.push(['Check tracker wiring', WARN]);
    if (v.operational && v.tracker === 'none') out.push(['Fit a tracker', OFF]);
    if (v.operational && v.net != null && v.net < -100000) out.push(['Losing over ₹1 L: review the route', LOSS]);
    if (v.operational && cap && v.students != null && v.students / cap < 0.6) out.push(['Under 60% full', WARN]);
    if (v.operational && cap && v.students != null && v.students > cap) out.push(['More children than seats', LOSS]);
    return out;
  }

  // ── A. Route map ──
  // The picker lives outside the redraw so it keeps focus; its choice is read fresh from storage each time the tab opens.
  function metro(el, d, S) {
    el.innerHTML = '<div class="tv-pick"></div><div class="tv-body"></div>';
    const body = el.querySelector('.tv-body'), draw = () => metroBody(body, d, S, draw);
    let ready = false;
    if (window.LMCSCampus) LMCSCampus.mount(el.querySelector('.tv-pick'), { label: 'Show lines for', onChange: s => { S.sel = s; if (ready) draw(); } });
    ready = true;
    draw();
  }
  function metroBody(el, d, S, redraw) {
    const m = model(d);
    S.half = S.half || 'AM';
    el.innerHTML = '<p class="note">Each bus is a line. Stations keep their real order but are spaced evenly, as on a metro map. <b>Thick</b> lines carry more children; ' + (m.buses.some(b => (m.veh[b] || {}).tracker != null) ? '<b>dashed</b> lines have a tracker problem, so their stops are incomplete; ' : '') + '<b>rings</b> are stations two buses share, the first places to look at merging; <b>squares</b> are where a bus waits.' + (m.months.length ? ' The badge is the line\'s result ' + esc(m.period) + '.' : '') + '</p>' +
      '<div class="ctl"><span class="seg">' + [['AM', 'Morning runs'], ['PM', 'Afternoon runs']].map(x => '<button data-half="' + x[0] + '" class="' + (S.half === x[0] ? 'on' : '') + '" aria-pressed="' + (S.half === x[0]) + '">' + x[1] + '</button>').join('') + '</span></div>' +
      '<div class="tv-split"><svg class="tv-metro" viewBox="0 0 1000 640" role="img" aria-label="Route map: one line per bus"></svg><div class="tv-info"><b>Tap a line or a station.</b><p class="note">A line shows its children, seats, km a day' + (m.months.length ? ' and money' : '') + ', and stops within 2 minutes of each other. A station shows every bus that stops there and when.</p></div></div>';
    el.querySelectorAll('[data-half]').forEach(b => b.addEventListener('click', () => { S.half = b.dataset.half; redraw(); }));
    const svg = el.querySelector('.tv-metro'), info = el.querySelector('.tv-info');
    const routes = (S.sel ? LMCSCampus.filter(m.buses.map(reg => ({ reg, campusId: (m.veh[reg] || {}).campusId })), S.sel, 'campusId').map(x => x.reg) : m.buses).map(b => {
      const name = Object.keys(m.trips[b] || {}).filter(k => k.indexOf(S.half) === 0).sort()[0];
      if (!name) return null;
      // a village visited twice in one trip is drawn once: the line follows first visits, the station lists every time
      const seen = {}, stops = m.trips[b][name].filter(s => { const k = Math.round(s.lat / 0.0015) + ':' + Math.round(s.lng / 0.0015); return seen[k] ? false : (seen[k] = true); });
      return { b, name, stops, all: m.trips[b][name], wait: (m.waits[b] || [])[0] };
    }).filter(Boolean);
    const pts = routes.reduce((a, r) => a.concat(r.stops, r.wait ? [r.wait] : []), []);
    if (!pts.length) { svg.outerHTML = '<p class="status">No ' + (S.half === 'AM' ? 'morning' : 'afternoon') + ' runs recorded here yet.</p>'; return; }
    const W = 1000, H = 640, pad = 70, key = p => Math.round(p.lat / 0.0015) + ':' + Math.round(p.lng / 0.0015);
    const uniq = Object.values(pts.reduce((o, p) => { o[key(p)] = p; return o; }, {})), rx = {}, ry = {};
    uniq.slice().sort((a, b) => a.lng - b.lng).forEach((p, i) => { rx[key(p)] = i; });
    uniq.slice().sort((a, b) => a.lat - b.lat).forEach((p, i) => { ry[key(p)] = i; });
    const n = Math.max(1, uniq.length - 1), P = p => [Math.round((pad + rx[key(p)] / n * (W - 2 * pad)) / 4) * 4, Math.round((H - pad - ry[key(p)] / n * (H - 2 * pad)) / 4) * 4];
    const elbow = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], k = Math.min(Math.abs(dx), Math.abs(dy)); return 'L' + (a[0] + Math.sign(dx) * k) + ' ' + (a[1] + Math.sign(dy) * k) + ' L' + b.join(' '); };
    let lines = '', marks = '';
    const station = {};
    routes.forEach(r => {
      const v = m.veh[r.b] || {}, c = m.colour[r.b], w = Math.max(4, Math.min(13, (v.students || 24) / 5));
      const seq = r.stops.map(P).concat(r.wait ? [P(r.wait)] : []);
      lines += '<path d="M' + seq[0].join(' ') + seq.slice(1).map((p, i) => elbow(seq[i], p)).join(' ') + '" fill="none" stroke="' + c + '" stroke-width="' + w + '" stroke-linecap="round" stroke-linejoin="round"' + (v.tracker === 'ok' || v.tracker == null ? '' : ' stroke-dasharray="12 8"') + ' data-line="' + esc(r.b) + '" tabindex="0" role="button" aria-label="' + esc(r.b) + ' line"/>';
      r.all.forEach(s => { const [x, y] = P(s), k = x + ',' + y; (station[k] = station[k] || { x, y, list: [] }).list.push(s); });
      if (r.wait) { const [x, y] = P(r.wait); marks += '<rect x="' + (x - 9) + '" y="' + (y - 9) + '" width="18" height="18" rx="3" fill="#fff" stroke="' + INK + '" stroke-width="3"/>'; }
      const [x0, y0] = seq[0], loss = v.net != null && v.net < 0;
      marks += '<g data-line="' + esc(r.b) + '" style="cursor:pointer"><rect x="' + (x0 - 6) + '" y="' + (y0 - 32) + '" rx="4" width="76" height="19" fill="' + c + '"/><text class="tv-tag" x="' + x0 + '" y="' + (y0 - 18) + '">' + esc(r.b) + '</text>' +
        (v.net != null ? '<rect x="' + (x0 + 72) + '" y="' + (y0 - 32) + '" rx="4" width="66" height="19" fill="' + (loss ? LOSS : PROFIT) + '"/><text class="tv-tag" x="' + (x0 + 77) + '" y="' + (y0 - 18) + '">' + lakh(v.net) + '</text>' : '') + '</g>';
    });
    Object.keys(station).forEach(k => {
      const s = station[k], regs = Array.from(new Set(s.list.map(x => x.bus))), shared = regs.length > 1, sure = Math.max.apply(null, s.list.map(x => x.sure)) >= 0.3;
      marks += '<circle cx="' + s.x + '" cy="' + s.y + '" r="' + (shared ? 9 : sure ? 5.5 : 4) + '" fill="#fff" stroke="' + (shared ? INK : m.colour[regs[0]]) + '" stroke-width="' + (shared ? 4 : 3) + '"' + (sure ? '' : ' stroke-dasharray="2 2"') + ' data-st="' + k + '" tabindex="0" role="button" aria-label="Station ' + esc(s.list[0].name) + '" style="cursor:pointer"/>';
      if (shared) marks += '<text class="tv-lbl" x="' + (s.x + 13) + '" y="' + (s.y + 4) + '">' + esc(s.list[0].name) + '</text>';
    });
    svg.innerHTML = lines + marks;
    const lineInfo = reg => {
      const r = routes.find(x => x.b === reg), v = m.veh[reg] || {}, cap = capacity(v);
      const close = r.all.slice(1).filter((s, i) => mins(s.t) - mins(r.all[i].t) <= 2 && s.name === r.all[i].name).length;
      info.innerHTML = '<b style="color:' + m.colour[reg] + '">' + esc(reg) + ' · ' + esc(r.name) + '</b><p>' + esc(v.campus || '') + (v.start ? ' · from ' + esc(v.start) : '') + '</p>' +
        '<p>' + (v.students != null ? v.students + ' children' : 'children not known') + ' · ' + (cap ? cap + ' seats across ' + (v.rounds || 2) + ' rounds' : 'seats not known') + (v.kmday ? ' · ' + v.kmday + ' km a day' : '') + '</p>' +
        (v.net != null ? '<p>' + esc(m.period) + ': <b style="color:' + (v.net < 0 ? LOSS : PROFIT) + '">' + lakh(v.net) + '</b> after fuel, fixed costs and driver pay.</p>' : '') +
        '<p>' + r.all.length + ' stops, ' + esc(r.all[0].t) + ' to ' + esc(r.all[r.all.length - 1].t) + '.' + (close ? ' <b>' + close + ' stop' + (close > 1 ? 's' : '') + ' within 2 minutes of the previous one in the same village</b>: could they be one?' : '') + '</p>';
    };
    const stInfo = k => {
      const s = station[k], regs = Array.from(new Set(s.list.map(x => x.bus)));
      info.innerHTML = '<b>' + esc(s.list[0].name) + '</b>' + s.list.map(x => '<p><b style="color:' + m.colour[x.bus] + '">' + esc(x.bus) + '</b> usually ' + esc(x.t) + (x.students != null ? ' · ' + x.students + ' children' : '') + (x.sure < 0.3 ? ' <span class="sm">(seen on few days)</span>' : '') + '</p>').join('') +
        (regs.length > 1 ? '<p><b>Shared station.</b> If both buses pass within minutes of each other, one of them may not need this stop.</p>' : '');
    };
    svg.querySelectorAll('[data-line]').forEach(e => { const go = () => lineInfo(e.dataset.line); e.addEventListener('click', go); e.addEventListener('keydown', ev => { if (ev.key === 'Enter') go(); }); });
    svg.querySelectorAll('[data-st]').forEach(e => { const go = () => stInfo(e.dataset.st); e.addEventListener('click', go); e.addEventListener('keydown', ev => { if (ev.key === 'Enter') go(); }); });
  }

  // ── B. Stops and walking areas ──
  function city(el, d, S) {
    const m = model(d);
    if (!S.bus || m.buses.indexOf(S.bus) === -1) S.bus = m.buses.slice().sort((a, b) => ((m.veh[a] || {}).net || 0) - ((m.veh[b] || {}).net || 0))[0] || ''; // open on the biggest loss
    el.innerHTML = '<p class="note">The line is the road the bus really drives (a typical day from the GPS)' + (m.months.length ? ', green if the bus earns more than it costs ' + esc(m.period) + ', red if it loses' : '') + '. Each stop has a ' + WALK_M + ' m walking circle in the bus\'s colour: circles of two colours overlapping mean two buses serve the same houses. Square: where the bus waits.</p>' +
      '<div class="ctl"><select class="tv-bus" aria-label="Bus"><option value="">All buses</option>' + m.buses.map(b => '<option' + (b === S.bus ? ' selected' : '') + '>' + esc(b) + '</option>').join('') + '</select>' +
      '<label class="sm"><input type="checkbox" class="tv-walk"' + (S.walk === false ? '' : ' checked') + '> Walking circles</label></div><div class="tv-city" role="region" aria-label="Map of routes and stops"></div>';
    el.querySelector('.tv-bus').addEventListener('change', e => { S.bus = e.target.value; draw(); });
    el.querySelector('.tv-walk').addEventListener('change', e => { S.walk = e.target.checked; draw(); });
    const map = L.map(el.querySelector('.tv-city'), { dragging: !L.Browser.mobile }); // a phone: one finger scrolls the page, two fingers zoom the map
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    const layer = L.layerGroup().addTo(map);
    function draw() {
      layer.clearLayers();
      const all = [];
      m.buses.filter(b => !S.bus || b === S.bus).forEach(b => {
        const v = m.veh[b] || {}, money = v.net == null ? INK : v.net < 0 ? LOSS : PROFIT;
        Object.keys(m.tracks[b] || {}).filter(t => t.indexOf('AM') === 0).forEach(t => { L.polyline(m.tracks[b][t], { color: money, weight: 5, opacity: .85 }).addTo(layer); all.push.apply(all, m.tracks[b][t]); });
        Object.keys(m.trips[b] || {}).forEach(t => m.trips[b][t].forEach(s => {
          all.push([s.lat, s.lng]);
          if (S.walk !== false) L.circle([s.lat, s.lng], { radius: WALK_M, color: m.colour[b], weight: 1, dashArray: '4 4', fillColor: m.colour[b], fillOpacity: s.students != null ? Math.min(.45, .08 + s.students * .03) : .12 }).addTo(layer);
          L.circleMarker([s.lat, s.lng], { radius: 6, color: '#fff', weight: 2, fillColor: m.colour[b], fillOpacity: 1 }).addTo(layer)
            .bindPopup('<b>' + esc(s.name) + '</b><br>' + esc(b) + ' ' + esc(t.split(' ')[0]) + ' usually ' + esc(s.t) + (s.students != null ? '<br>' + s.students + ' children' : '') + (s.shared.length ? '<br>Also: ' + esc(s.shared.join(', ')) : '') +
              '<br><a target="_blank" rel="noopener noreferrer" href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=' + s.lat + ',' + s.lng + '">Street View</a>');
        }));
        (m.waits[b] || []).forEach(w => L.marker([w.lat, w.lng], { icon: L.divIcon({ className: '', iconSize: null, html: '<div class="tv-wait"></div>' }) }).addTo(layer).bindPopup(esc(b) + ' waits here: ' + esc(w.name)));
      });
      map.invalidateSize();
      if (all.length) map.fitBounds(all, { padding: [24, 24], maxZoom: 15 }); else map.setView([31.85, 77.15], 9);
    }
    setTimeout(draw, 0);
  }

  // ── C. Depot ──
  function depot(el, d, S) {
    const m = model(d), year = Number(String(d.today).slice(0, 4)), vs = Object.values(m.veh);
    S.sort = S.sort || 'need';
    const maxL = Math.max.apply(null, vs.map(v => Math.abs(v.net || 0)).concat([1]));
    const lamp = { ok: PROFIT, blind: WARN, dead: LOSS, none: OFF, unknown: OFF };
    const lampText = { ok: 'tracker working', blind: 'tracker dark while driving', dead: 'tracker silent', none: 'no tracker', unknown: 'GPS provider not answering' };
    const order = S.sort === 'loss' ? (a, b) => (a.net || 0) - (b.net || 0) : S.sort === 'age' ? (a, b) => a.year - b.year : (a, b) => decisions(b, year).length - decisions(a, year).length || (a.net || 0) - (b.net || 0);
    const card = v => {
      const age = v.year ? year - Number(v.year) : null, cap = capacity(v), fill = cap && v.students != null ? v.students / cap : null, pl = v.net == null ? null : v.net / maxL, dec = decisions(v, year);
      return '<div class="tv-veh"><div class="tv-vh"><b>' + esc(v.reg) + '</b><span class="tv-lamp" style="background:' + lamp[v.tracker] + '" title="' + lampText[v.tracker] + '" aria-label="' + lampText[v.tracker] + '"></span></div>' +
        '<div class="sm">' + esc(v.campus) + ' · ' + esc(v.route || 'no route') + (v.start ? ' from ' + esc(v.start) : '') + (v.operational ? '' : ' · off the road') + '</div>' +
        '<div class="tv-row"><span>Result</span><div class="tv-bar">' + (pl == null ? '' : '<span class="tv-mid"></span><i style="' + (pl < 0 ? 'right:50%;width:' + (-pl * 50) : 'left:50%;width:' + (pl * 50)) + '%;background:' + (pl < 0 ? LOSS : PROFIT) + '"></i>') + '</div><b style="color:' + (v.net == null ? OFF : v.net < 0 ? LOSS : PROFIT) + '">' + (v.net == null ? '–' : lakh(v.net)) + '</b></div>' +
        '<div class="tv-row"><span>Age</span><div class="tv-bar">' + (age == null ? '' : '<i style="left:0;width:' + Math.min(100, age / 20 * 100) + '%;background:' + (age >= 15 ? LOSS : age >= 13 ? WARN : '#555') + '"></i><span class="tv-mid" style="left:75%" title="15-year limit"></span>') + '</div><span>' + (age == null ? '–' : age + ' yrs') + '</span></div>' +
        '<div class="tv-row"><span>Seats filled</span><div class="tv-bar">' + (fill == null ? '' : '<i style="left:0;width:' + Math.min(100, fill * 100) + '%;background:' + (fill > 1 ? LOSS : fill < 0.6 ? WARN : PROFIT) + '"></i>') + '</div><span>' + (fill == null ? '–' : v.students + '/' + cap) + '</span></div>' +
        (v.kmday ? '<div class="tv-row"><span>Per day</span><div></div><span>' + v.kmday + ' km</span></div>' : '') +
        '<div class="tv-dec">' + (dec.length ? dec.map(x => '<span style="background:' + x[1] + '">' + esc(x[0]) + '</span>').join('') : '<span style="background:' + PROFIT + '">Nothing to decide</span>') + '</div></div>';
    };
    const list = vs.slice().sort(order), campuses = Array.from(new Set(list.map(v => v.campus))).sort();
    el.innerHTML = '<p class="note">One card per vehicle. Result is ' + (m.period ? esc(m.period) + ', ' : '') + 'fee collected minus fuel, loan interest, fixed costs and driver pay. Age bar has a mark at the 15-year legal limit. Seats filled counts seats on every round the bus makes. Tags are suggestions from the data; nothing changes until a decision is made.</p>' +
      '<div class="ctl"><span class="seg">' + [['need', 'Most to decide first'], ['loss', 'Biggest loss first'], ['age', 'Oldest first']].map(x => '<button data-sort="' + x[0] + '" class="' + (S.sort === x[0] ? 'on' : '') + '" aria-pressed="' + (S.sort === x[0]) + '">' + x[1] + '</button>').join('') + '</span></div>' +
      (S.sort === 'need' ? campuses.map(c => '<h3 class="tc-h">' + esc(c) + '</h3><div class="tv-depot">' + list.filter(v => v.campus === c).map(card).join('') + '</div>').join('') : '<div class="tv-depot">' + list.map(card).join('') + '</div>');
    el.querySelectorAll('[data-sort]').forEach(b => b.addEventListener('click', () => { S.sort = b.dataset.sort; depot(el, d, S); }));
  }

  const VIEWS = { metro: ['Route map', metro], city: ['Stops and walking areas', city], depot: ['Depot', depot] };
  return { VIEWS, render: (el, d, view, S) => VIEWS[view][1](el, d, S), village, capacity, decisions };
})();
