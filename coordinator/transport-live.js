/* Live bus map -- coordinator/transport/live.html and office/buses.html. Positions come from the Coordinator backend
   (action=coordinatorbuslive), which reads the GPS provider and scopes buses to the caller's campuses; the browser never
   calls the provider. Needs Leaflet (window.L) loaded by the page. */
window.TransportLive = (function () {
  // same deployment as coordinator/shared.js BACKEND_URL
  const BACKEND_URL = 'https://script.google.com/macros/s/AKfycbwilcvrgZQga_qo1A-fBTUzKLifrBYIwlPHoWMITmchf5sZOYjKIJ7_4J0TeBF_-6B6/exec';
  const REFRESH_MS = 60000;
  const MOVING_MIN = 5, SEEN_MIN = 30; // a fix older than SEEN_MIN minutes: the device is off or out of signal
  const COLOR = { moving: '#15803d', stopped: '#b45309', offline: '#6b7280' };
  const LABEL = { moving: 'Moving', stopped: 'Stopped', offline: 'No signal' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  /** moving / stopped / offline from the fix's age and speed */
  function state(b, now) {
    const age = b.at ? (now - Date.parse(b.at)) / 60000 : Infinity;
    return age > SEEN_MIN ? 'offline' : b.speed > 0 && age <= MOVING_MIN ? 'moving' : 'stopped';
  }

  function ago(iso, now) {
    if (!iso) return 'never';
    const m = Math.round((now - Date.parse(iso)) / 60000);
    return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 2880 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago';
  }

  function mount(el, session, opts) {
    opts = opts || {};
    el.innerHTML = '<h2 class="pagetitle">Live buses</h2><p class="pagesub">Where every bus is now, from the GPS devices. Refreshes every minute.</p>' +
      '<div class="note tl-status" role="status">Loading bus positions...</div>' +
      '<div class="tl-pick"></div>' +
      '<div class="tl-map" style="height:60vh;min-height:320px;border-radius:8px;margin:8px 0"></div><div class="tw"><table class="l"><thead><tr>' +
      '<th>Bus</th><th>Campus</th><th>Route / driver</th><th>Status</th><th>Speed</th><th>Last seen</th><th>Where</th></tr></thead><tbody class="tl-rows"></tbody></table></div>';
    const status = el.querySelector('.tl-status'), pickEl = el.querySelector('.tl-pick'), rowsEl = el.querySelector('.tl-rows');
    const map = L.map(el.querySelector('.tl-map')).setView([31.85, 77.15], 9);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    const layer = L.layerGroup().addTo(map);
    // opts.campus: the page fixes the campus (the Office header's); otherwise the shared picker chooses
    let data = null, pick = null, fitted = false, sel = { all: true, campuses: [] };
    if (opts.campus) sel = { all: false, campuses: [opts.campus] };
    else if (window.LMCSCampus) pick = LMCSCampus.mount(pickEl, { session, label: 'Show buses for', onChange: (s) => { sel = s; fitted = false; if (data) render(); } });

    function render() {
      const now = Date.now(), list = LMCSCampus.filter(data.buses, sel, 'campusId')
        .map(b => Object.assign({ st: state(b, now) }, b))
        .sort((a, b) => ['moving', 'stopped', 'offline'].indexOf(a.st) - ['moving', 'stopped', 'offline'].indexOf(b.st) || a.reg.localeCompare(b.reg));
      // one count per picked school when 2+ are picked (overlay), else one total
      const count = s => { const v = {}; sel.campuses.forEach(c => { v[c] = list.filter(b => b.st === s && b.campusId === c).length; }); return LMCSCampus.overlay(v, sel); };
      const total = s => sel.all ? String(list.filter(b => b.st === s).length) : count(s); // All counts every bus the backend sent
      status.innerHTML = '<b>' + total('moving') + '</b> moving, <b>' + total('stopped') + '</b> stopped, <b>' + total('offline') + '</b> with no signal for over ' + SEEN_MIN + ' min. ' +
        'Updated ' + new Date(data.fetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + '.';
      layer.clearLayers();
      const sv = b => 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=' + b.lat + ',' + b.lng;
      list.forEach(b => {
        L.circleMarker([b.lat, b.lng], { radius: 9, color: '#fff', weight: 2, fillColor: COLOR[b.st], fillOpacity: 0.95 }).addTo(layer)
          .bindTooltip(esc(b.reg), { permanent: list.length <= 15, direction: 'right', offset: [8, 0] })
          .bindPopup('<b>' + esc(b.reg) + '</b> &middot; ' + LABEL[b.st] + (b.speed ? ' &middot; ' + b.speed + ' km/h' : '') + '<br>' + esc([b.campus, b.route, b.driver].filter(Boolean).join(' · ')) +
            '<br>' + esc(b.place) + '<br>Last seen ' + ago(b.at, now) + (b.kmToday ? ' &middot; ' + b.kmToday.toFixed(1) + ' km today' : '') +
            '<br><a href="' + sv(b) + '" target="_blank" rel="noopener noreferrer">Street View</a>');
      });
      if (!fitted && list.length) { map.invalidateSize(); map.fitBounds(list.map(b => [b.lat, b.lng]), { padding: [30, 30], maxZoom: 13 }); fitted = true; }
      rowsEl.innerHTML = list.map(b => '<tr><td><b>' + esc(b.reg) + '</b></td><td>' + esc(b.campus || 'not on roster') + '</td><td>' + esc(b.route) + '<div class="sm">' + esc(b.driver) + '</div></td>' +
        '<td><span style="color:' + COLOR[b.st] + ';font-weight:600">&#9679; ' + LABEL[b.st] + '</span></td><td>' + (b.st === 'moving' ? b.speed + ' km/h' : '-') + '</td>' +
        '<td>' + ago(b.at, now) + '</td><td>' + esc(b.place) + ' <a href="' + sv(b) + '" target="_blank" rel="noopener noreferrer">Street View</a></td></tr>').join('') ||
        '<tr><td colspan="7">No buses to show for this campus.</td></tr>';
    }

    async function load() {
      try {
        const res = await (await fetch(BACKEND_URL + '?action=coordinatorbuslive&idToken=' + encodeURIComponent(session.idToken))).json();
        if (!res.success) throw new Error(res.error || 'Request failed');
        data = res; render();
      } catch (err) {
        status.innerHTML = '<span class="stale">' + esc(/not authori[sz]ed/i.test(err.message) ? 'Your account is not allowed to see the bus positions.'
          : 'Could not load bus positions' + (data ? ' (showing the last ones)' : '') + '. It will try again in a minute.') + '</span><div class="sm">Details: ' + esc(err.message) + '</div>';
      }
    }

    load();
    setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
    // another picker on the page (the Route map's) may have changed the shared choice: re-read it when this tab is shown
    return { sync: () => { if (pick) pick.set(LMCSCampus.get(session)); } };
  }

  return { mount, state, ago };
})();
