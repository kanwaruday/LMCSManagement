/* The route World (Uday, 28 Oct): a school's bus routes and stops on a map, for whoever may see them, with no money.
     LMCSRouteMap.mount(el, { session, backendUrl, mode: 'metro' | 'city', campus?, driverToken? | driverView? }) -> { reload }
   - staff and Principals: GET <backendUrl>?action=transportworld&idToken=… (the Coordinator backend, apps-script/coordinator-world.gs),
     which scopes to the caller's own campuses; `campus` ('LMS4') narrows it further on the page.
   - a driver's phone: POST {action:'driverroute', deviceToken} to the Roster backend (apps-script/driver-link.gs): their own bus only. driverView {viewReg, idToken} instead: the Owner's or a
     Coordinator's read-only view of one bus as its driver (the same POST, apps-script/driver-token.gs's dlkLinkOrView_).
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
    if (!r.success) throw new Error(r.error || 'Could not load the routes.');
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
        TransportViews.render(el, d, opts.mode, state);
      } catch (e) {
        say(el, (hi ? 'रूट नहीं आया, नेटवर्क देखें · ' : '') + (e.message || 'Could not load the routes.'), load);
      }
    }
    load();
    return { reload: load };
  }
  return { mount };
})();
