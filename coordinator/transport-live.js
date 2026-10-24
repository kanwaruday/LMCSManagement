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
      '<div class="ctl"><select class="tl-campus" aria-label="Filter by campus"><option value="">All campuses</option></select></div>' +
      '<div class="tl-map" style="height:60vh;min-height:320px;border-radius:8px;margin:8px 0"></div><div class="tw"><table class="l"><thead><tr>' +
      '<th>Bus</th><th>Campus</th><th>Route / driver</th><th>Status</th><th>Speed</th><th>Last seen</th><th>Where</th></tr></thead><tbody class="tl-rows"></tbody></table></div>';
    const status = el.querySelector('.tl-status'), sel = el.querySelector('.tl-campus'), rowsEl = el.querySelector('.tl-rows');
    const map = L.map(el.querySelector('.tl-map')).setView([31.85, 77.15], 9);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    const layer = L.layerGroup().addTo(map);
    let data = null, campus = opts.campus || '', fitted = false;

    function render() {
      const now = Date.now(), list = data.buses.filter(b => !campus || b.campus === campus)
        .map(b => Object.assign({ st: state(b, now) }, b))
        .sort((a, b) => ['moving', 'stopped', 'offline'].indexOf(a.st) - ['moving', 'stopped', 'offline'].indexOf(b.st) || a.reg.localeCompare(b.reg));
      const campuses = Array.from(new Set(data.buses.map(b => b.campus).filter(Boolean))).sort();
      sel.innerHTML = '<option value="">All campuses</option>' + campuses.map(c => '<option' + (c === campus ? ' selected' : '') + '>' + esc(c) + '</option>').join('');
      sel.parentNode.style.display = campuses.length > 1 ? '' : 'none';
      const n = s => list.filter(b => b.st === s).length;
      status.innerHTML = '<b>' + n('moving') + '</b> moving, <b>' + n('stopped') + '</b> stopped, <b>' + n('offline') + '</b> with no signal for over ' + SEEN_MIN + ' min. ' +
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

    sel.addEventListener('change', () => { campus = sel.value; fitted = false; if (data) render(); });
    load();
    setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
  }

  return { mount, state, ago };
})();
