/* Transport checks from the GPS, one depth per role (spec: docs/superpowers/specs/2026-10-24-transport-optimisation-design.md).
   Fee Clerk  -- TransportChecks.mountClerk(el, session): fuel bills to check against the pump slip, two buttons each.
   Coordinator -- TransportChecks.mount(el, session): follow-ups to close (a note is required), trackers, driving, fuel, stops, map.
   Owner      -- TransportChecks.mount(el, session, {owner: true}): four numbers, who is late, proposals, then the Coordinator depth.
   Data: Coordinator backend actions coordinatorbuschecks / coordinatortransportinsight; the map is TransportLive (transport-live.js). */
window.TransportChecks = (function () {
  const BACKEND_URL = 'https://script.google.com/macros/s/AKfycbwilcvrgZQga_qo1A-fBTUzKLifrBYIwlPHoWMITmchf5sZOYjKIJ7_4J0TeBF_-6B6/exec'; // same as shared.js
  const DIESEL_RS = 95; // per litre, Kullu Oct 2026: values km driven away from base in the leakage estimate
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DOMAIN = { gps_dead: 'Tracker silent', gps_blind: 'Tracker dark while driving', gps_none: 'No tracker', bus_away: 'Parked away', bus_speed: 'Speeding', fuel_check: 'Fuel', fuel_proof: 'Fill video', bus_age: 'Vehicle age', bus_inspection: 'Safety check', bus_equipment: 'Safety kit', capture_route: 'Route timelapse' };
  const TRACKER = { ok: ['ok', 'Working'], blind: ['soon', 'Dark while driving'], dead: ['expired', 'Silent'], none: ['missing', 'No tracker'], unknown: ['missing', 'GPS provider not answering'] };

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const day = iso => iso ? +iso.slice(8, 10) + ' ' + MON[+iso.slice(5, 7) - 1] : '-';
  const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
  const rs = n => '₹' + Math.round(n).toLocaleString('en-IN');

  async function get(session, action) {
    const r = await (await fetch(BACKEND_URL + '?action=' + action + '&idToken=' + encodeURIComponent(session.idToken), { cache: 'no-store' })).json();
    if (!r.success) throw new Error(r.error || 'Request failed');
    return r;
  }
  async function post(session, body) {
    const r = await (await fetch(BACKEND_URL, { method: 'POST', body: JSON.stringify(Object.assign({ idToken: session.idToken }, body)) })).json();
    if (!r.success) throw new Error(r.error || 'Could not save');
    return r;
  }

  /** due text for a follow-up: "due 27 Oct" or "2 days late" */
  function dueText(t, today) {
    if (!t.due) return '';
    const late = daysBetween(t.due, today);
    return late > 0 ? '<b class="miss">' + late + ' day' + (late > 1 ? 's' : '') + ' late</b>' : late === 0 ? '<b class="stale">due today</b>' : 'due ' + day(t.due);
  }

  // ── Fee Clerk ──
  function mountClerk(el, session) {
    el.innerHTML = '<div class="tc-clerk" role="status">Loading fuel bills to check...</div>';
    const box = el.querySelector('.tc-clerk');
    const card = c => '<div class="task" data-id="' + esc(c.id) + '"><div><div class="t">Check this fuel bill</div><div>' + esc(c.text) + '</div>' +
      '<div class="d" style="margin-top:6px">Ask the driver for the pump slip. Compare the litres and the odometer on the slip with the day book.</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="btn" data-a="matches">The slip matches the bill</button>' +
      '<button class="btn" data-a="corrected">The bill was wrong: I corrected the day book</button></div><div class="sm tc-err" role="alert"></div></div></div>';
    async function load() {
      try {
        const r = await get(session, 'coordinatorbuschecks');
        box.innerHTML = r.checks.length
          ? '<h2 class="pagetitle" style="font-size:16px">Fuel bills to check (' + r.checks.length + ')</h2><p class="note">The GPS shows these fills do not match how far the bus drove. Answer each one; a bill not checked within 2 days goes to the Coordinator under your name.</p>' + r.checks.map(card).join('')
          : '<p class="note">No fuel bills to check. Thank you.</p>';
        box.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => answer(b)));
      } catch (err) { box.innerHTML = '<p class="note">Could not load the fuel bills to check: ' + esc(err.message) + '</p>'; }
    }
    async function answer(btn) {
      const c = btn.closest('[data-id]');
      c.querySelectorAll('button').forEach(b => { b.disabled = true; });
      try {
        await post(session, { action: 'transportclerkcheck', fillId: c.dataset.id, answer: btn.dataset.a });
        c.innerHTML = '<div class="t">Recorded.</div><div class="d">' + (btn.dataset.a === 'matches' ? 'The Coordinator will follow up with the driver.' : 'Thank you. The corrected bill is checked again tomorrow.') + '</div>';
      } catch (err) { c.querySelectorAll('button').forEach(b => { b.disabled = false; }); c.querySelector('.tc-err').textContent = 'Not saved: ' + err.message; }
    }
    load();
  }

  // ── Coordinator / Owner ──
  function mount(el, session, opts) {
    opts = opts || {};
    const S = { tab: opts.owner ? 'overview' : 'checks', bus: '', d: null, mapMounted: false };
    el.innerHTML = '<h2 class="pagetitle">' + (opts.owner ? 'Transport: what the GPS shows' : 'Transport checks') + '</h2>' +
      '<p class="pagesub">' + (opts.owner ? 'Leakage, who is acting on it, and proposals. Depth below.' : 'Each item says what to do and by when. Close it with what you did.') + '</p>' +
      '<div class="tc-body"><div class="status">Loading...</div></div><div class="tc-map" hidden></div>';
    const body = el.querySelector('.tc-body'), mapEl = el.querySelector('.tc-map');

    async function load() {
      try { S.d = await get(session, 'coordinatortransportinsight'); render(); }
      catch (err) { body.innerHTML = '<div class="status" role="alert">Could not load the transport checks: ' + esc(err.message) + ' <button class="btn tc-retry">Retry</button></div>'; body.querySelector('.tc-retry').addEventListener('click', load); }
    }

    function render() {
      const d = S.d, open = d.tasks.filter(t => t.status === 'open');
      const late = open.filter(t => t.due && t.due < d.today);
      // the route views (transport-views.js) are tabs every role may get; a page narrows them with opts.views
      const views = window.TransportViews ? (opts.views || Object.keys(TransportViews.VIEWS)) : [];
      const tabs = (opts.owner ? [['overview', 'Overview']] : []).concat([['checks', 'Follow-ups (' + open.length + ')']], views.map(v => [v, TransportViews.VIEWS[v][0]]),
        [['map', 'Live map'], ['trackers', 'Trackers'], ['driving', 'Driving'], ['fuel', 'Fuel'], ['stops', 'Stop times']]);
      const synced = d.syncedAt ? new Date(d.syncedAt) : null, ageH = synced ? (Date.now() - synced) / 3600000 : null;
      body.innerHTML = '<p class="note">GPS facts as of ' + (synced ? '<b' + (ageH > 30 ? ' class="stale"' : '') + '>' + synced.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + '</b>' + (ageH > 30 ? ' (the daily GPS sync on the Mac has not run; numbers may be old)' : '') : '<b class="stale">never: the GPS sync has not run yet</b>') + '.</p>' +
        '<div class="ctl"><span class="seg tc-tabs">' + tabs.map(x => '<button data-tab="' + x[0] + '" class="' + (S.tab === x[0] ? 'on' : '') + '" aria-pressed="' + (S.tab === x[0]) + '">' + x[1] + '</button>').join('') + '</span></div>' +
        '<div class="tc-tab"></div>';
      body.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { S.tab = b.dataset.tab; render(); }));
      const bar = body.querySelector('.tc-tabs'), on = bar.querySelector('.on');
      if (on) bar.scrollLeft = on.offsetLeft - bar.offsetLeft - 24; // on a phone the open tab stays in sight
      const tab = body.querySelector('.tc-tab');
      mapEl.hidden = S.tab !== 'map';
      if (S.tab === 'map') { if (!S.live) S.live = TransportLive.mount(mapEl, session); else S.live.sync(); return; }
      if (views.indexOf(S.tab) !== -1) { TransportViews.render(tab, d, S.tab, (S.view = S.view || {})[S.tab] = S.view[S.tab] || {}); return; }
      ({ overview, checks, trackers, driving, fuel, stops })[S.tab](tab, d, open, late);
    }

    // Owner: four numbers, who is late, most unusual first, proposals
    function overview(tab, d, open, late) {
      const flagged = d.checks.filter(c => c.flag === 'yes');
      const since = new Date(Date.parse(d.today + 'T00:00:00Z') - 30 * 86400000).toISOString().slice(0, 10);
      const fuelRs = flagged.filter(c => c.date > since).reduce((s, c) => s + Number(c.excessRs || 0), 0);
      const awayKm = d.days.filter(x => Number(x.nightAwayKm) > 2).reduce((s, x) => s + 2 * Number(x.nightAwayKm), 0); // there and back
      const awayRs = awayKm / 5 * DIESEL_RS;
      const ops = d.vehicles.filter(v => v.operational), healthy = ops.filter(v => v.tracker === 'ok').length;
      const year = +d.today.slice(0, 4), old = ops.filter(v => Number(v.year) && year - Number(v.year) >= 14);
      const who = {};
      late.forEach(t => { const k = t.assignee || 'nobody (no coordinator for ' + t.campus + ')'; who[k] = (who[k] || 0) + 1; });
      const unusual = open.slice().sort((a, b) => (a.severity === 'high' ? 0 : 1) - (b.severity === 'high' ? 0 : 1) || (a.due < b.due ? -1 : 1)).slice(0, 8);
      const shared = (d.proposals.shared || []);
      const pnlBus = {};
      (d.pnl || []).forEach(r => { const o = pnlBus[r.reg] = pnlBus[r.reg] || { reg: r.reg, campus: r.campus, net: 0 }; o.net += r.fee - r.fuel - r.loan - r.fixed - r.pay; });
      const losers = Object.values(pnlBus).filter(o => o.net < 0).sort((a, b) => a.net - b.net);
      tab.innerHTML = '<div class="tiles">' +
        '<div class="tile ' + (fuelRs + awayRs > 0 ? 'bad' : '') + '"><b>' + rs(fuelRs + awayRs) + '</b>estimated leakage seen by GPS, last 30 days (fuel bills ' + rs(fuelRs) + ', driving to unusual parking ' + rs(awayRs) + ')</div>' +
        '<div class="tile ' + (healthy < ops.length ? 'warn' : '') + '"><b>' + healthy + ' of ' + ops.length + '</b>running vehicles with a working tracker</div>' +
        '<div class="tile ' + (late.length ? 'bad' : '') + '"><b>' + late.length + ' of ' + open.length + '</b>transport follow-ups past their due date</div>' +
        '<div class="tile ' + (old.length ? 'warn' : '') + '"><b>' + old.length + '</b>running vehicles at or within a year of the 15-year limit</div></div>' +
        '<h3 class="tc-h">Who is late</h3>' + (Object.keys(who).length ? '<ul>' + Object.keys(who).sort((a, b) => who[b] - who[a]).map(k => '<li><b>' + esc(k.split('@')[0]) + '</b>: ' + who[k] + ' follow-up' + (who[k] > 1 ? 's' : '') + ' past due</li>').join('') + '</ul>' : '<p class="note">Nobody: every transport follow-up is within its due date.</p>') +
        '<h3 class="tc-h">Most urgent first</h3>' + (unusual.length ? unusual.map(t => '<div class="task ' + esc(t.severity) + '"><div><div class="t"><span class="chip">' + esc(DOMAIN[t.domain]) + '</span>' + esc(t.title) + '</div><div class="d">' + esc(t.campus) + ' · ' + (t.assignee ? esc(t.assignee.split('@')[0]) : '<b class="miss">no owner</b>') + ' · ' + dueText(t, d.today) + '</div></div></div>').join('') : '<p class="note">No open transport follow-ups.</p>') +
        '<h3 class="tc-h">Proposals for your decision</h3><p class="note">Nothing here changes by itself. Each needs your decision before anyone acts.</p>' +
        '<p><b>Vehicles at the 15-year limit</b> (HP rules, 2018: school vehicles up to 15 years): ' + (old.length ? old.map(v => esc(v.reg) + ' (' + esc(v.year) + ', ' + esc(v.campus) + ')').join(', ') : 'none') + '.</p>' +
        '<p><b>Buses losing money</b> (Apr–Sep, after driver pay): ' + (losers.length ? losers.slice(0, 8).map(o => esc(o.reg) + ' ' + rs(o.net)).join(', ') : 'none') + '.</p>' +
        '<p><b>Stops more than one bus serves</b> (first candidates for merging routes): ' + (shared.length ? '</p><ul>' + shared.map(g => '<li>' + esc(g.place) + ': ' + g.buses.map(b => esc(b.reg) + ' ' + esc(b.trip) + ' ' + esc(b.arrive)).join(', ') + '</li>').join('') + '</ul>' : 'none found yet.</p>');
    }

    // Coordinator: the follow-ups, with the note required to close one
    function checks(tab, d, open, late) {
      const me = (session.email || '').toLowerCase();
      const rank = t => (t.due && t.due < d.today ? 0 : 1) * 10 + (t.severity === 'high' ? 0 : 1) + (t.assignee === me ? 0 : 0.5);
      const list = open.slice().sort((a, b) => rank(a) - rank(b) || (a.due < b.due ? -1 : 1));
      const done = d.tasks.filter(t => t.status !== 'open').sort((a, b) => (a.resolvedAt < b.resolvedAt ? 1 : -1));
      const waiting = d.checks.filter(c => c.flag === 'yes' && !c.answer);
      tab.innerHTML = (late.length ? '<p class="miss">' + late.length + ' follow-up' + (late.length > 1 ? 's are' : ' is') + ' past due. The Owner sees who is late.</p>' : '') +
        (list.length ? list.map(t => '<div class="task ' + esc(t.severity) + '" data-id="' + esc(t.taskId) + '"><div><div class="t"><span class="chip">' + esc(DOMAIN[t.domain]) + '</span>' + esc(t.title) + '</div>' +
          '<div>' + esc(t.detail) + '</div>' + (t.domain === 'fuel_proof' ? '<div class="d">The fee clerk attaches it in the Day Book (Add fill video). This closes by itself once it is attached.</div>' : '') + (/^bus_(inspection|equipment)$/.test(t.domain) ? '<div class="d"><a href="../../coordinator/transport/capture.html">Open the capture portal</a> (Inspection). This closes by itself the day after the check is sent.</div>' : '') + (t.domain === 'capture_route' ? '<div class="d"><a href="../../coordinator/transport/capture.html">Open the capture portal</a> (Timelapse). This closes by itself the morning after the run is sent.</div>' : '') + '<div class="d">' + esc(t.campus) + ' · ' + (t.assignee ? (t.assignee === me ? 'yours' : esc(t.assignee.split('@')[0])) : 'no owner') + ' · ' + dueText(t, d.today) + '</div>' +
          '<div class="tc-close" hidden style="margin-top:8px"><label class="sm">What did you do? (required)<br><input class="tc-note" style="width:min(520px,100%);padding:6px" placeholder="For example: driver warned on 24 Oct / Blackbox complaint 12345"></label> <button class="btn tc-save">Save and close</button><div class="sm tc-err" role="alert"></div></div></div>' +
          '<button class="btn tc-done">Mark done</button></div>').join('') : '<p class="note">No open transport follow-ups. Well done.</p>') +
        (waiting.length ? '<h3 class="tc-h">Fuel bills waiting for the fee clerk (' + waiting.length + ')</h3><p class="note">Each comes to you if the clerk has not answered in 2 days.</p><div class="tw"><table class="l"><thead><tr><th>Date</th><th>Bus</th><th>Litres</th><th>GPS km</th><th>Km per litre</th></tr></thead><tbody>' +
          waiting.map(c => '<tr><td>' + day(c.date) + '</td><td>' + esc(c.reg) + '</td><td>' + esc(c.litres) + '</td><td>' + esc(c.gpsKm) + '</td><td>' + esc(c.kmpl) + ' (normal ' + esc(c.norm) + ')</td></tr>').join('') + '</tbody></table></div>' : '') +
        (done.length ? '<h3 class="tc-h">Closed in the last 30 days</h3><div class="tw"><table class="l"><thead><tr><th>Closed</th><th>What</th><th>By</th><th>Outcome</th></tr></thead><tbody>' +
          done.map(t => '<tr><td>' + day(String(t.resolvedAt).slice(0, 10)) + '</td><td>' + esc(t.title) + '</td><td>' + esc(String(t.resolvedBy).split('@')[0]) + '</td><td>' + esc(t.note) + '</td></tr>').join('') + '</tbody></table></div>' : '');
      tab.querySelectorAll('.tc-done').forEach(b => b.addEventListener('click', () => { const c = b.closest('[data-id]'); c.querySelector('.tc-close').hidden = false; b.hidden = true; c.querySelector('.tc-note').focus(); }));
      tab.querySelectorAll('.tc-save').forEach(b => b.addEventListener('click', async () => {
        const c = b.closest('[data-id]'), note = c.querySelector('.tc-note').value.trim(), err = c.querySelector('.tc-err');
        if (!note) { err.textContent = 'Write what you did first.'; return; }
        b.disabled = true;
        try { await post(session, { action: 'coordinatorresolvetask', taskId: c.dataset.id, note: note }); await load(); }
        catch (e) { b.disabled = false; err.textContent = 'Not saved: ' + e.message; }
      }));
    }

    function trackers(tab, d) {
      const bad = d.vehicles.filter(v => v.operational && v.tracker !== 'ok');
      tab.innerHTML = '<div class="ctl"><button class="btn tc-copy">Copy the list for Blackbox</button><span class="sm tc-copied"></span></div>' +
        '<p class="note">"Dark while driving": in the last 7 days the odometer counted km while the tracker sent no positions. Blackbox should check the power wiring of these first.</p>' +
        '<div class="tw"><table class="l"><thead><tr><th>Vehicle</th><th>School</th><th>Tracker</th><th>Last signal</th><th>Km in 7 days</th><th>Of which dark</th></tr></thead><tbody>' +
        d.vehicles.filter(v => v.operational).sort((a, b) => (a.tracker === 'ok') - (b.tracker === 'ok') || a.reg.localeCompare(b.reg)).map(v =>
          '<tr><td><b>' + esc(v.reg) + '</b><div class="sm">' + esc(v.driver) + '</div></td><td>' + esc(v.campus) + '</td><td><span class="pl ' + TRACKER[v.tracker][0] + '">' + TRACKER[v.tracker][1] + '</span></td><td>' + (v.lastFix ? day(v.lastFix.slice(0, 10)) + ' ' + v.lastFix.slice(11, 16) : '-') + '</td><td>' + Math.round(v.km7) + '</td><td>' + (v.km7 ? Math.round(v.blind7) + ' (' + Math.round(100 * v.blind7 / v.km7) + '%)' : '-') + '</td></tr>').join('') + '</tbody></table></div>';
      tab.querySelector('.tc-copy').addEventListener('click', async () => {
        const text = 'La Montessori School (customer 37381): please repair these trackers.\n' + bad.map(v => '- ' + v.reg + ': ' + (v.tracker === 'dead' ? 'no signal since ' + day(String(v.lastFix).slice(0, 10)) : v.tracker === 'blind' ? Math.round(v.blind7) + ' of ' + Math.round(v.km7) + ' km in 7 days driven with no positions sent (check power wiring)' : 'no tracker fitted')).join('\n');
        try { await navigator.clipboard.writeText(text); tab.querySelector('.tc-copied').textContent = ' Copied. Paste it into WhatsApp or email to Blackbox.'; } catch (e) { tab.querySelector('.tc-copied').textContent = ' ' + text; }
      });
    }

    function driving(tab, d) {
      const by = {};
      d.days.forEach(x => { const o = by[x.reg] = by[x.reg] || { reg: x.reg, n: 0, km: 0, away: [], over7: 0, over30: 0, maxKmh: 0 }; o.n++; o.km += Number(x.km); o.over30 += Number(x.minOver40); o.maxKmh = Math.max(o.maxKmh, Number(x.maxKmh));
        if (x.date > new Date(Date.parse(d.today + 'T00:00:00Z') - 7 * 86400000).toISOString().slice(0, 10)) o.over7 += Number(x.minOver40);
        if (Number(x.nightAwayKm) > 2 && Number(x.km) > 5) o.away.push(x); });
      const base = {};
      d.bases.forEach(b => { base[b.reg] = b; });
      const veh = {};
      d.vehicles.forEach(v => { veh[v.reg] = v; });
      const rows = Object.values(by).sort((a, b) => b.away.length - a.away.length || b.over7 - a.over7);
      tab.innerHTML = '<p class="note">Last 30 days. "Usual parking" is where the bus spent most nights; the school\'s prescribed parking place is in the transport workbook. Speed limit for school buses: 40 km/h.</p>' +
        '<div class="tw"><table class="l"><thead><tr><th>Bus</th><th>Driver</th><th>Km per running day</th><th>Usual parking</th><th>Nights elsewhere</th><th>Minutes above 40 km/h (7 days / 30 days)</th><th>Fastest</th></tr></thead><tbody>' +
        rows.map(o => '<tr><td><b>' + esc(o.reg) + '</b></td><td>' + esc(veh[o.reg] && veh[o.reg].driver) + '</td><td>' + Math.round(o.km / Math.max(1, d.days.filter(x => x.reg === o.reg && Number(x.km) > 5).length)) + '</td><td class="sm">' + esc(base[o.reg] && base[o.reg].place) + '</td>' +
          '<td>' + (o.away.length ? '<b class="miss">' + o.away.length + '</b><div class="sm">' + o.away.slice(-3).map(x => day(x.date) + ': ' + esc(x.nightAwayKm) + ' km away').join('<br>') + '</div>' : '0') + '</td>' +
          '<td>' + (o.over7 >= 10 ? '<b class="miss">' + o.over7 + '</b>' : o.over7) + ' / ' + o.over30 + '</td><td>' + (o.maxKmh > 50 ? '<b class="miss">' + o.maxKmh + '</b>' : o.maxKmh) + ' km/h</td></tr>').join('') + '</tbody></table></div>';
    }

    // on a phone the table scrolls sideways: the bus stays in sight next to its Result and Proof
    const STICK = 'position:sticky;left:0;z-index:1;box-shadow:1px 0 0 var(--border);';
    function fuel(tab, d) {
      const rows = d.checks.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
      tab.innerHTML = '<p class="note">Each fuel fill in the day book against the km the GPS recorded since the bus\'s previous fill. Flagged: below 80% of the bus\'s normal km per litre, or the bill odometer and the GPS disagree by more than 20%.</p>' +
        (rows.length ? '<div class="tw"><table class="l"><thead><tr><th>Date</th><th style="' + STICK + 'background:var(--lgray)">Bus</th><th>Litres</th><th>GPS km</th><th>Bill odometer km</th><th>Km per litre</th><th>Result</th><th>Proof</th><th>Fee clerk</th></tr></thead><tbody>' +
          rows.map(c => '<tr><td>' + day(c.date) + '</td><td style="' + STICK + 'background:var(--white)"><b>' + esc(c.reg) + '</b></td><td>' + esc(c.litres) + '</td><td>' + esc(c.gpsKm) + '</td><td>' + esc(c.billKm) + '</td><td>' + esc(c.kmpl) + ' <span class="sm">(normal ' + esc(c.norm) + ')</span></td>' +
            '<td>' + (c.flag === 'yes' ? '<span class="pl expired">' + esc(c.reason.indexOf('low') !== -1 ? 'Too much fuel' : 'Odometer differs') + '</span>' + (Number(c.excessRs) ? '<div class="sm">about ' + rs(c.excessRs) + ' extra</div>' : '') : '<span class="pl ok">OK</span>') + (/gps_gap/.test(c.reason) ? '<div class="sm">tracker missed some days</div>' : '') + '</td>' +
            '<td>' + (c.proof === 'video+bill' ? '<span class="pl ok">Video and bill</span>' : c.proof === 'none' ? '<span class="pl expired">No video, no bill</span>' : c.proof === 'bill' ? '<span class="pl soon">Bill only</span>' : '') + '</td>' +
            '<td>' + (c.answer ? esc(c.answer === 'matches' ? 'slip matches' : 'bill corrected') + '<div class="sm">' + esc(String(c.answeredBy).split('@')[0]) + '</div>' : c.flag === 'yes' ? '<span class="stale">waiting</span>' : '') + '</td></tr>').join('') + '</tbody></table></div>'
          : '<p class="note">No fills to check yet. Fee clerks record fuel in the day book (litres and odometer) since 23 Oct 2026; each fill is checked once the bus has a previous fill and 50 km of GPS driving since.</p>');
    }

    function stops(tab, d) {
      const buses = Array.from(new Set(d.stops.map(s => s.bus))).sort();
      if (!S.bus || buses.indexOf(S.bus) === -1) S.bus = buses[0] || '';
      const mine = d.stops.filter(s => s.bus === S.bus), trips = Array.from(new Set(mine.map(s => s.trip))).sort((a, b) => (a === 'WAIT') - (b === 'WAIT') || a.localeCompare(b));
      tab.innerHTML = '<div class="ctl"><select class="tc-bus" aria-label="Bus">' + buses.map(b => '<option' + (b === S.bus ? ' selected' : '') + '>' + esc(b) + '</option>').join('') + '</select></div>' +
        '<p class="note">Where this bus regularly stops, from about 2 months of GPS. "Seen" counts days: a stop under a minute is caught about half the time, so 30–60% is normal for a daily pickup.</p>' +
        trips.map(t => '<h3 class="tc-h">' + (t === 'WAIT' ? 'Waits of 20 minutes or more' : esc(t)) + '</h3><div class="tw"><table class="l"><thead><tr><th>#</th><th>Place</th><th>Usually</th><th>Early – late</th><th>Wait</th><th>Seen</th><th>Other buses</th></tr></thead><tbody>' +
          mine.filter(s => s.trip === t).sort((a, b) => a.seq - b.seq).map(s => '<tr><td>' + (t === 'WAIT' ? 'W' : esc(s.seq)) + '</td><td class="sm">' + esc(s.place) + ' <a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=' + encodeURIComponent(s.lat + ',' + s.lng) + '" target="_blank" rel="noopener noreferrer">Street View</a></td><td><b>' + esc(s.arrive_usual) + '</b></td><td>' + esc(s.arrive_early) + ' – ' + esc(s.arrive_late) + '</td><td>' + esc(s.dwell_min) + ' min</td><td>' + esc(s.days_seen) + ' / ' + esc(s.run_days) + '</td><td>' + esc(s.shared_with) + '</td></tr>').join('') + '</tbody></table></div>').join('');
      const sel = tab.querySelector('.tc-bus');
      if (sel) sel.addEventListener('change', () => { S.bus = sel.value; render(); });
    }

    load();
  }

  return { mount, mountClerk, dueText };
})();
