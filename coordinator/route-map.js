/* The route World (Uday, 28 Oct): a school's bus routes and stops on a map, for whoever may see them, with no money.
     LMCSRouteMap.mount(el, { session, backendUrl, mode: 'metro' | 'city', campus?, driverToken? | driverView?, refused? }) -> { reload }
   - refused: a calm line shown (no Try again) when the backend says this person may not see routes yet (staff-home/: the Coordinator
     backend reads Principals, Fee Clerks, Coordinators and the Owner only).
   - staff and Principals: GET <backendUrl>?action=transportworld&idToken=… (the Coordinator backend, apps-script/coordinator-world.gs),
     which scopes to the caller's own campuses; `campus` ('LMS4') narrows it further on the page.
   - a driver's phone: POST {action:'driverroute', deviceToken} to the Roster backend (apps-script/driver-link.gs): their own bus only. driverView {viewReg, idToken} instead: the Owner's or a
     Coordinator's read-only view of one bus as its driver (the same POST, apps-script/driver-token.gs's dlkLinkOrView_).
   The route view (Uday, 7 Nov: "the actual route view along with plans and all of the other meta data"): staff tapping a line (metro)
     or a bus (city) open LMCSRouteMap.run(el, { session, backendUrl, reg, back }), also used by Fleet Command (transport-checks.js):
     the run's GPS path on a map you pan, zoom and tap (Uday, 7 Nov: "i dont see the need for a video, the map needs to be
     interactable": no video), a slider along the run, the stops as chapters, Street View at any point, the workbook's
     plan beside the run with the differences, and the run's facts (children as counts only). GET transportrun (coordinator-world.gs)
     says who may and signs a ticket; the path and the BLURRED stop photos come from the
     Roster's capturerunview with it (transport-capture.gs), which has the Drive access. Nothing is kept on the device.
   Drawn by coordinator/transport-views.js (loaded here when the page has not), styled by coordinator/route-map.css; the city map
   loads Leaflet 1.9.4 from cdnjs the first time it is needed. Stop locations are never in this repo: they come from the backend,
   for a signed-in person or a linked phone, and stay in memory. */
window.LMCSRouteMap = (function () {
  const HERE = (document.currentScript && document.currentScript.src) || '';
  const near = (f) => new URL(f, HERE || location.href).href.split('?')[0] + (HERE.split('?')[1] ? '?' + HERE.split('?')[1] : ''); // this file's stamp, so a deploy reaches phones
  const LEAFLET = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/';
  const SRI = { js: 'sha512-puJW3E/qXDqYp9IfhAI54BJEaWIfloJ7JWs7OeD5i6ruC9JZL1gERT1wjtwXFlh7CjE7ZJ+/vcRZRkIYIb6p4g==',
    css: 'sha512-h9FcoyWjHcOcmEVkxOfTLnmZFWIH0iZhZT1H2TbOq55xssQGEJHEaIm+PgoUaZbRvQTNTluNOEfb1ZRy6D3BOw==' };
  const loaded = {};
  function css(href, sri) {
    if ([].some.call(document.styleSheets, (s) => s.href && s.href.split('?')[0] === href.split('?')[0])) return;
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href;
    if (sri) { l.integrity = sri; l.crossOrigin = 'anonymous'; }
    document.head.appendChild(l);
  }
  function script(src, ready, sri) {
    if (ready()) return Promise.resolve();
    return loaded[src] = loaded[src] || new Promise((ok, no) => {
      const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('Could not load the map. Check the connection.'));
      if (sri) { s.integrity = sri; s.crossOrigin = 'anonymous'; }
      document.head.appendChild(s);
    });
  }
  async function data(opts) {
    let r;
    if (opts.driverToken || opts.driverView) {
      const who = opts.driverView ? { viewReg: opts.driverView.viewReg, idToken: opts.driverView.idToken } : { deviceToken: opts.driverToken };
      r = await (await fetch(opts.backendUrl, { method: 'POST', body: JSON.stringify(Object.assign({ action: 'driverroute' }, who)) })).json();
    } else {
      const s = opts.session || (window.LMCS && LMCS.getSession());
      if (!s || !s.idToken) throw new Error('Sign in to see the routes.');
      r = await (await fetch(opts.backendUrl + '?action=transportworld&idToken=' + encodeURIComponent(s.idToken), { cache: 'no-store' })).json();
    }
    if (!r.success) { const e = new Error(r.error || 'Could not load the routes.'); e.refused = /not authori[sz]ed/i.test(r.error || ''); throw e; }
    const d = { vehicles: r.vehicles || [], stops: r.stops || [], tracks: r.tracks || [], days: r.days || [] }; // no pnl: the views draw no money
    if (opts.campus) { // the server already scoped to the caller; this only narrows a Coordinator's district to one school
      const regs = {};
      d.vehicles = d.vehicles.filter((v) => v.campusId === opts.campus);
      d.vehicles.forEach((v) => { regs[v.reg] = true; });
      d.stops = d.stops.filter((x) => regs[x.bus]); d.tracks = d.tracks.filter((t) => regs[t.reg]); d.days = d.days.filter((x) => regs[x.reg]);
    }
    return d;
  }
  let hi = false; // a driver's phone reads Hindi first: the status lines are the part they must read
  function say(el, text, retry) {
    el.textContent = '';
    const p = document.createElement('p'); p.className = 'status'; p.setAttribute('role', 'status'); p.textContent = text; el.appendChild(p);
    if (retry) { const b = document.createElement('button'); b.type = 'button'; b.className = 'gb-btn'; b.textContent = hi ? 'फिर कोशिश करें · Try again' : 'Try again'; b.onclick = retry; el.appendChild(b); }
  }
  function mount(el, opts) {
    opts = Object.assign({ mode: 'metro' }, opts || {});
    hi = !!(opts.driverToken || opts.driverView);
    el.classList.add('rm');
    css(near('route-map.css'));
    const state = {};
    async function load() {
      say(el, hi ? 'रूट आ रहा है… · Loading your route…' : 'Loading the routes…');
      try {
        const views = script(near('transport-views.js'), () => !!window.TransportViews);
        const map = opts.mode === 'city' ? (css(LEAFLET + 'leaflet.min.css', SRI.css), script(LEAFLET + 'leaflet.min.js', () => !!window.L, SRI.js)) : null;
        const d = await data(opts);
        await views; await map;
        if (!d.stops.length) { say(el, hi ? 'अभी रूट नहीं बना है। कुछ दिन बस चलने के बाद दिखेगा · No route yet. It appears after the bus has run its route for a few days.' : 'No bus routes recorded here yet. They appear once the buses\' trackers have run their routes for a few days.'); return; }
        el.textContent = '';
        const who = opts.session || (window.LMCS && LMCS.getSession());
        // "See the run" for whoever sees these buses (transportrun checks again: the Owner, Coordinators, the Principal, the Fee Clerk,
        // a driver phone its own bus); a staff view of a driver's page has its own World instead
        const again = () => { el.textContent = ''; TransportViews.render(el, d, opts.mode, state); };
        if (opts.driverToken && opts.coordUrl) state.onRun = (reg) => run(el, { backendUrl: opts.coordUrl, deviceToken: opts.driverToken, reg, back: again });
        else if (!hi && who && who.idToken) state.onRun = (reg) => run(el, { session: opts.session, backendUrl: opts.backendUrl, reg, back: again });
        TransportViews.render(el, d, opts.mode, state);
      } catch (e) {
        if (e.refused && opts.refused) { say(el, opts.refused); return; }
        say(el, (hi ? 'रूट नहीं आया, नेटवर्क देखें · ' : '') + (e.message || 'Could not load the routes.'), load);
      }
    }
    load();
    return { reload: load };
  }

  // ── The route view ──
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function metres(a, b) {
    const r = Math.PI / 180, h = Math.sin((b[0] - a[0]) * r / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin((b[1] - a[1]) * r / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  const key = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  function bearing(a, b) { // degrees clockwise from north, a -> b
    const r = Math.PI / 180, y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r);
    const x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  }
  /** Google Street View where the bus is at frame i (Uday, 7 Nov: free, no key: the keyless api=1 link opens a new tab or the Maps app).
   *  Only the coordinates and the heading leave the page. points as runFacts; a frame with no position uses the last known one; the
   *  heading points to the next place the bus moved to (over 5 m), else from where it came; '' with no position. */
  function streetView(points, i) {
    const pts = points || [];
    let j = Math.max(0, Math.min(pts.length - 1, i));
    while (j > 0 && !pts[j]) j--;
    const p = pts[j];
    if (!p) return '';
    const far = (q) => q && metres(p, q) > 5;
    let k = j + 1, a = p, b;
    while (k < pts.length && !far(pts[k])) k++;
    b = pts[k];
    if (!b) { k = j - 1; while (k >= 0 && !far(pts[k])) k--; a = pts[k]; b = p; }
    return 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=' + Number(p[0]).toFixed(6) + ',' + Number(p[1]).toFixed(6) + '&heading=' + (a && b ? Math.round(bearing(a, b)) % 360 : 0);
  }
  /** The view's facts, pure (tests/transport/test-route-run.js). run {startedAt, endedAt, frames, stops:[{seq, name, lat, lng, at, boardOn, boardOff}]},
   *  points [[lat, lng, takenAt] | null] (one per processed photo, in order), plan [{name, km, children, kmDay, rounds}] -> {km, boardOn, boardOff, chapters, planned, diffs} */
  function runFacts(run, points, plan) {
    const pts = points || [], at = (i) => pts[i] && [pts[i][0], pts[i][1]];
    let m = 0, last = null;
    pts.forEach((p) => { if (!p) return; if (last) m += metres(last, p); last = p; }); // ponytail: a GPS jump counts as driven; drop jumps over ~1 km if it shows
    const stops = (run && run.stops) || [];
    const chapters = stops.map((s) => { // the frame nearest the stop's time, else nearest its place
      const t = Date.parse(s.at), ll = isFinite(Number(s.lat)) && s.lat !== '' ? [Number(s.lat), Number(s.lng)] : null;
      let best = -1, bd = Infinity;
      pts.forEach((p, i) => { if (!p) return; const dd = isFinite(t) && p[2] ? Math.abs(p[2] - t) : ll ? metres(ll, p) * 1000 : Infinity; if (dd < bd) { bd = dd; best = i; } });
      return { seq: s.seq, name: s.name, at: s.at, boardOn: s.boardOn || 0, boardOff: s.boardOff || 0, photo: !!s.photo, frame: best, ll: ll || (best >= 0 ? at(best) : null) };
    });
    const boardOn = stops.reduce((a, s) => a + (Number(s.boardOn) || 0), 0), boardOff = stops.reduce((a, s) => a + (Number(s.boardOff) || 0), 0);
    const named = stops.filter((s) => key(s.name)), seen = (n) => named.some((s) => key(s.name).indexOf(key(n)) !== -1 || key(n).indexOf(key(s.name)) !== -1);
    const planned = (plan || []).map((p) => ({ name: p.name, km: p.km, children: p.children, seen: named.length ? seen(p.name) : null }));
    const km = Math.round(m / 100) / 10, diffs = [], p0 = (plan || [])[0] || {};
    if (plan && plan.length) {
      if (stops.length !== plan.length) diffs.push(stops.length + ' stop' + (stops.length === 1 ? '' : 's') + ' marked on the run; the plan has ' + plan.length + '.');
      const missed = planned.filter((p) => p.seen === false);
      if (missed.length) diffs.push('Not marked on the run: ' + missed.map((p) => p.name).join(', ') + '.');
      if (!named.length && stops.length) diffs.push('The run\'s stops have no names yet, so they are not matched to the plan by name.');
      const extra = named.filter((s) => !(plan || []).some((p) => key(p.name).indexOf(key(s.name)) !== -1 || key(s.name).indexOf(key(p.name)) !== -1));
      if (extra.length) diffs.push('Stops not in the plan: ' + extra.map((s) => s.name).join(', ') + '.');
      const kids = plan.reduce((a, p) => a + (Number(p.children) || 0), 0);
      if (boardOn && kids && boardOn !== kids) diffs.push(boardOn + ' children got on during the run; the plan has ' + kids + '.');
      const round = p0.kmDay && p0.rounds ? p0.kmDay / p0.rounds / 2 : null; // km a day covers every round, both ways
      if (round && km && Math.abs(km - round) / round > 0.2) diffs.push('The run was ' + km + ' km; one way of a planned round is about ' + Math.round(round) + ' km.');
    }
    return { km, boardOn, boardOff, chapters, planned, diffs };
  }

  async function run(el, o) {
    el.classList.add('rm');
    css(near('route-map.css'));
    say(el, 'Loading the run…');
    const s = o.session || (window.LMCS && LMCS.getSession());
    let r;
    try {
      r = await (await (o.deviceToken // a driver phone: POST, its own bus only
        ? fetch(o.backendUrl, { method: 'POST', body: JSON.stringify({ action: 'transportrun', deviceToken: o.deviceToken, reg: o.reg, runId: o.runId || '' }) })
        : fetch(o.backendUrl + '?action=transportrun&reg=' + encodeURIComponent(o.reg) + (o.runId ? '&runId=' + encodeURIComponent(o.runId) : '') + (s && s.actAs ? '&actAs=' + encodeURIComponent(s.actAs) : '') + '&idToken=' + encodeURIComponent((s && s.idToken) || ''), { cache: 'no-store' }))).json();
    } catch (e) { r = { success: false, error: 'No connection. Try again when you have signal.' }; }
    if (!r.success) { say(el, r.error === 'Not authorized' ? 'This bus\'s run is not open to you.' : r.error || 'Could not load the run.', () => run(el, o)); back(el, o); return; }
    const roster = (part, extra) => fetch(r.rosterUrl, { method: 'POST', body: JSON.stringify(Object.assign({ action: 'capturerunview', ticket: r.ticket, part }, extra || {})) }).then((x) => x.json());
    const [pathR] = r.run ? await Promise.all([roster('path').catch(() => ({ success: false })), script(LEAFLET + 'leaflet.min.js', () => !!window.L, SRI.js), css(LEAFLET + 'leaflet.min.css', SRI.css)]) : [null];
    const points = pathR && pathR.success ? pathR.points : [];
    const f = runFacts(r.run, points, r.plan), b = r.bus, rn = r.run;
    const day = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
    const hm = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
    const p0 = r.plan[0] || {};
    el.innerHTML = '<div class="rr">' +
      '<div class="rr-head"><button type="button" class="gb-btn rr-back">‹ All routes</button><h3>' + esc(b.reg) + (b.route ? ' · ' + esc(b.route) : '') + '</h3></div>' +
      ((r.runs || []).length > 1 ? '<label class="rr-pick">Run <select>' + r.runs.map((x) => '<option value="' + esc(x.runId) + '"' + (rn && x.runId === rn.runId ? ' selected' : '') + '>' +
        (x.startedAt ? day(x.startedAt) + ', ' + hm(x.startedAt) : esc(x.runId)) + ' · ' + x.frames + ' frames</option>').join('') + '</select></label>' : '') +
      (rn ? '<p class="note">' + esc(b.campus) + (b.driver ? ' · Driver ' + esc(b.driver) : '') + (rn.startedAt ? ' · ' + day(rn.startedAt) + ', ' + hm(rn.startedAt) + (rn.endedAt ? '–' + hm(rn.endedAt) : '') : '') + '</p>' : '<p class="status">No run recorded for this bus yet. The plan is below.</p>') +
      (rn ? '<section class="rr-run" aria-label="The run"><h4>The run</h4><div class="rr-view"><div class="rr-map" role="region" aria-label="Map of the run: drag, zoom, tap the route"></div>' +
        '<figure class="rr-photo" hidden><div class="rr-img"><img alt=""><p class="rr-wait">Loading the photo…</p></div><figcaption>' +
        '<button type="button" class="gb-btn rr-prev" aria-label="Previous photo">‹</button><span class="rr-pcap">The bus\'s own photo, blurred</span>' +
        '<button type="button" class="gb-btn rr-next" aria-label="Next photo">›</button></figcaption></figure></div>' +
        '<div class="rr-scrub" hidden><label>Along the run <input type="range" min="0" value="0" step="1"></label><span class="rr-at" aria-live="polite"></span>' +
        '<a class="gb-btn rr-sv" target="_blank" rel="noopener">Open in Street View ↗</a></div>' +
        (f.chapters.length ? '<ol class="rr-chapters">' + f.chapters.map((c, i) => '<li><button type="button" data-ch="' + i + '"' + (c.frame < 0 ? ' disabled' : '') + '><b>' + (i + 1) + '</b> ' + esc(c.name || 'Stop ' + (i + 1)) + (c.at && isFinite(Date.parse(c.at)) ? ' · ' + hm(Date.parse(c.at)) : '') + (c.boardOn || c.boardOff ? ' · ' + c.boardOn + ' on, ' + c.boardOff + ' off' : '') + '</button></li>').join('') + '</ol>' : '<p class="note">No stops were marked on this run.</p>') +
        '</section>' : '') +
      '<section aria-label="Plan and run"><h4>Plan and run</h4>' +
        (r.plan.length ? (f.diffs.length ? '<ul class="rr-diffs">' + f.diffs.map((d) => '<li>' + esc(d) + '</li>').join('') + '</ul>' : rn ? '<p class="note">The run matches the plan.</p>' : '') +
          '<table class="rr-plan"><caption>The plan (transport workbook' + (p0.route ? ', ' + esc(p0.route) : '') + (p0.rounds ? ', ' + p0.rounds + ' rounds' : '') + (p0.kmDay ? ', ' + p0.kmDay + ' km a day' : '') + ')</caption><thead><tr><th>Stop</th><th>Km</th><th>Children</th>' + (rn ? '<th>On the run</th>' : '') + '</tr></thead><tbody>' +
          f.planned.map((p) => '<tr><td>' + esc(p.name) + '</td><td>' + (p.km == null ? '–' : p.km) + '</td><td>' + (p.children == null ? '–' : p.children) + '</td>' + (rn ? '<td>' + (p.seen == null ? '–' : p.seen ? '✓' : '<b>not marked</b>') + '</td>' : '') + '</tr>').join('') + '</tbody></table>'
          : '<p class="note">No plan for this bus in the transport workbook yet.</p>') + '</section>' +
      '<section aria-label="Details"><h4>Details</h4><dl class="rr-facts">' + [
        ['Bus', b.reg + (b.seats ? ' · ' + b.seats + ' seats' : '')], ['School', b.campus], ['Driver', b.driver || '–'], ['Route', (b.route || '–') + (b.start ? ' from ' + b.start : '')],
        rn && ['Date', rn.startedAt ? day(rn.startedAt) : '–'], rn && ['Times', rn.startedAt ? hm(rn.startedAt) + (rn.endedAt ? ' to ' + hm(rn.endedAt) : '') : '–'],
        rn && ['Length', f.km ? f.km + ' km (from the run\'s GPS)' : 'not known'], rn && ['Stops marked', String(f.chapters.length)],
        rn && ['Children', f.boardOn || f.boardOff ? f.boardOn + ' got on, ' + f.boardOff + ' got off' : 'not counted on this run'], rn && ['Photos', rn.frames + ' frames']
      ].filter(Boolean).map((x) => '<dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd>').join('') + '</dl>' +
        (f.chapters.some((c) => c.photo) ? '<div class="rr-photos">' + f.chapters.map((c, i) => c.photo ? '<figure data-ph="' + i + '"><figcaption>' + esc(c.name || 'Stop ' + (i + 1)) + '</figcaption></figure>' : '').join('') + '</div>' : '') +
      '</section></div>';
    back(el, o, el.querySelector('.rr-back'));
    const pick = el.querySelector('.rr-pick select');
    if (pick) pick.addEventListener('change', () => { run(el, Object.assign({}, o, { runId: pick.value })); });
    if (!rn) return;
    // the map: the whole path, the part driven so far, and the bus at the chosen point; drag, zoom and tap anywhere
    const ll = points.filter(Boolean).map((p) => [p[0], p[1]]);
    const mapEl = el.querySelector('.rr-map'), map = L.map(mapEl, { tap: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    const whole = L.polyline(ll, { color: '#8a939c', weight: 6, opacity: 0.6 }).addTo(map), done = L.polyline([], { color: '#1a1a1a', weight: 5, interactive: false }).addTo(map);
    const here = ll.length ? L.circleMarker(ll[0], { radius: 9, color: '#fff', weight: 3, fillColor: '#CE0000', fillOpacity: 1, interactive: false }).addTo(map) : null; // no path: no "the bus is here" dot
    const fit = () => { if (ll.length) map.fitBounds(whole.getBounds(), { padding: [16, 16] }); else map.setView([31.85, 77.15], 9); };
    fit();
    if (!mapEl.clientHeight && window.ResizeObserver) { // route-map.css not applied yet (first visit): the map had no size and opened fully zoomed in
      const ro = new ResizeObserver(() => { if (!mapEl.clientHeight) return; ro.disconnect(); map.invalidateSize(); fit(); });
      ro.observe(mapEl);
    }
    if (!ll.length) el.querySelector('.rr-map').insertAdjacentHTML('afterend', '<p class="note">' + esc(pathR && pathR.error ? pathR.error : 'This run has no GPS points on record.') + '</p>');
    const scrub = el.querySelector('.rr-scrub'), slider = scrub.querySelector('input'), at = scrub.querySelector('.rr-at'), sv = scrub.querySelector('.rr-sv');
    slider.max = String(Math.max(0, points.length - 1));
    // the photo viewer (Uday, 10 Nov): the run's own BLURRED frame at the chosen point; steps with the slider, the map and ‹ ›
    const seqs = pathR && Array.isArray(pathR.seqs) && pathR.seqs.length === points.length ? pathR.seqs : null; // an older Roster: no viewer
    const fig = el.querySelector('.rr-photo'), img = fig.querySelector('img'), wait = fig.querySelector('.rr-wait'), shots = new Map();
    let want = -1, timer = 0;
    const shot = (k) => { // a frame's data URL, at most once per frame; ponytail: kept for the page's life, ~1,500 small JPEGs at most
      if (!shots.has(k)) shots.set(k, roster('frame', { seq: seqs[k] }).then((x) => x.success ? 'data:' + x.mime + ';base64,' + x.base64 : '').catch(() => { shots.delete(k); return ''; }));
      return shots.get(k);
    };
    const photo = (j) => {
      if (!seqs) return;
      want = j; wait.hidden = false; wait.textContent = 'Loading the photo…';
      clearTimeout(timer);
      timer = setTimeout(() => shot(j).then((u) => { // a short wait: dragging the slider asks only for where it stops
        if (want !== j) return;
        if (!u) { wait.textContent = 'No photo for this point.'; return; }
        img.src = u; img.alt = 'The bus\'s photo ' + (j + 1) + ' of ' + points.length + ', blurred'; wait.hidden = true;
        [j + 1, j + 2].forEach((k) => { if (k < points.length) shot(k); }); // the next two, for ›
      }), 200);
    };
    const show = (i, pan) => {
      let j = Math.max(0, Math.min(points.length - 1, i));
      while (j > 0 && !points[j]) j--; // a frame with no position: the last known one
      if (!points[j] || !here) return;
      const p = [points[j][0], points[j][1]], t = Number(points[j][2]);
      here.setLatLng(p);
      done.setLatLngs(points.slice(0, j + 1).filter(Boolean).map((q) => [q[0], q[1]]));
      slider.value = String(j);
      at.textContent = (t > 0 ? hm(t) + ' · ' : '') + 'photo ' + (j + 1) + ' of ' + points.length;
      sv.href = streetView(points, j);
      photo(j);
      if (pan && !map.getBounds().contains(p)) map.panTo(p);
    };
    const nearest = (latlng) => { // the run's frame nearest a tapped place
      let best = 0, bd = Infinity;
      points.forEach((p, i) => { if (!p) return; const d = metres([latlng.lat, latlng.lng], p); if (d < bd) { bd = d; best = i; } });
      return best;
    };
    if (ll.length) {
      scrub.hidden = false; fig.hidden = !seqs;
      fig.querySelector('.rr-prev').addEventListener('click', () => show(+slider.value - 1, true));
      fig.querySelector('.rr-next').addEventListener('click', () => show(+slider.value + 1, true));
      map.on('click', (e) => show(nearest(e.latlng))); // a tap anywhere: the bus where it passed nearest
      slider.addEventListener('input', () => show(+slider.value, true));
      show(0);
    }
    f.chapters.forEach((c, i) => {
      if (!c.ll) return;
      L.circleMarker(c.ll, { radius: 8, color: '#fff', weight: 2, fillColor: '#00798c', fillOpacity: 1 }).addTo(map).bindTooltip(String(i + 1))
        .bindPopup(esc((i + 1) + '. ' + (c.name || 'Stop ' + (i + 1))) + (c.boardOn || c.boardOff ? '<br>' + c.boardOn + ' on, ' + c.boardOff + ' off' : ''))
        .on('click', () => { if (c.frame >= 0) show(c.frame); });
    });
    el.querySelectorAll('[data-ch]').forEach((btn) => btn.addEventListener('click', () => {
      const c = f.chapters[+btn.dataset.ch];
      if (c.frame >= 0) show(c.frame);
      if (c.ll) map.setView(c.ll, Math.max(map.getZoom(), 16));
      el.querySelector('.rr-map').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }));
    el.querySelectorAll('[data-ph]').forEach((fig) => {
      const c = f.chapters[+fig.dataset.ph];
      roster('photo', { seq: c.seq }).then((x) => { if (!x.success) return; const img = document.createElement('img'); img.alt = 'Stop ' + (c.name || '') + ', blurred'; img.src = 'data:' + x.mime + ';base64,' + x.base64; fig.prepend(img); }).catch(() => {});
    });
  }
  function back(el, o, btn) {
    if (!o.back) { if (btn) btn.hidden = true; return; }
    if (!btn) { btn = document.createElement('button'); btn.type = 'button'; btn.className = 'gb-btn'; btn.textContent = '‹ All routes'; el.appendChild(btn); }
    btn.addEventListener('click', () => o.back());
  }
  return { mount, run, runFacts, streetView };
})();
