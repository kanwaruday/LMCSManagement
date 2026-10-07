/* Coordinator Portal -- shared script for coordinator/index.html (landing) and the section pages
   (followups, compliance, approvals, hiring, documents, academics). Each section page is just a
   header plus one Coord.* call, so the logic lives here once. */
window.Coord = (function () {
  // "LMCS Coordinator Backend" -- its own Apps Script project (apps-script/coordinator.gs)
  const BACKEND_URL = 'https://script.google.com/macros/s/AKfycbwilcvrgZQga_qo1A-fBTUzKLifrBYIwlPHoWMITmchf5sZOYjKIJ7_4J0TeBF_-6B6/exec';
  let SESSION = null;

  // Departments follow the vault's Departments hubs, plus Systems. `name` must match the Department the
  // backend (apps-script/coordinator.gs) puts on each follow-up. `page` = folder under coordinator/, or null
  // while there is nothing to show yet (the card stays non-clickable, like Owner on the role chooser).
  const DEPARTMENTS = [
    { name: 'HR & Staff', page: 'hr', desc: 'Hiring, staff documents, Support Session compliance, and staff-related approvals.' },
    { name: 'Academics & Examination', page: 'academics', desc: 'CW/HW tag analysis per teacher, and academic-change approvals.' },
    { name: 'Fees & Finance', page: 'finance', desc: 'Financial and purchase approvals. Payroll exceptions to follow.' },
    { name: 'School Operations', page: 'operations', desc: 'Everything not covered elsewhere, such as other approvals.' },
    { name: 'Events & House System', page: 'events', desc: 'Events, trips, invitations and calendar approvals.' },
    { name: 'Transport', page: 'transport', desc: 'Bus document compliance: insurance, fitness, MV tax, pollution, route permit and speed governor.' },
    { name: 'Student Life', page: null, desc: 'Student welfare and incidents.' },
    { name: 'Systems', page: null, desc: 'IT and systems follow-ups.' },
  ];
  // Paths are relative to coordinator/<page>/, i.e. two levels below the repo root.
  const WORK_LINKS = {
    ss_compliance: '../../principals-daily-reporting/index.html', approval: '../../principals-daily-reporting/index.html',
    hiring_stall: '../../hiring/index.html', complete_hire: '../../staff/add-employee.html',
    doc_missing: '../../staff/add-employee.html', doc_none: '../../staff/add-employee.html', doc_verify: '../../staff/add-employee.html',
    transport_expired: '../transport/index.html', transport_due: '../transport/index.html', transport_missing: '../transport/index.html',
  };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  async function api(params) {
    const q = Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&');
    const data = await (await fetch(BACKEND_URL + '?' + q + '&idToken=' + encodeURIComponent(SESSION.idToken))).json();
    if (!data.success) throw new Error(data.error || 'Request failed');
    return data;
  }

  function canUse(session) { return LMCS.canViewCoordinatorPortal(session); }

  // Section pages: sign-in gate, access check, then render(body, session).
  function boot(render) {
    const show = function (session) {
      SESSION = session;
      document.getElementById('authRoot').style.display = 'none';
      const body = document.getElementById('appBody');
      body.style.display = '';
      if (!canUse(session)) { body.innerHTML = '<div class="denied">The Coordinator Portal is only available to Coordinators and the Owner.</div>'; return; }
      render(body, session);
    };
    const cached = LMCS.getSession();
    if (cached) show(cached); else LMCS.requireSession('#authRoot').then(show);
  }

  // ── Follow-ups ────────────────────────────────────────────────────
  // body: element; opts: {dept (a department name, or null for everything), title, sub}
  function tasksView(body, opts) {
    body.innerHTML = '<h2 class="pagetitle">' + esc(opts.title) + '</h2><p class="pagesub">' + esc(opts.sub || '') + '</p><div class="task-list"></div>';
    const list = body.querySelector('.task-list');

    async function load() {
      list.innerHTML = '<div class="status">Loading follow-ups...</div>';
      try {
        const tasks = (await api({ action: 'coordinatortasks' })).tasks.filter(t => !opts.dept || t.department === opts.dept);
        if (!tasks.length) { list.innerHTML = '<div class="status">Nothing to follow up on here right now.</div>'; return; }
        list.innerHTML = tasks.map(t =>
          '<div class="task ' + esc(t.severity) + '"><div>' +
            '<div class="t"><span class="chip">' + esc(t.severity) + '</span>' + esc(t.title) + '</div>' +
            '<div class="d">' + esc(t.detail) + ' &middot; <a href="' + (WORK_LINKS[t.domain] || '#') + '">Open</a></div>' +
          '</div><button class="btn" data-id="' + esc(t.taskId) + '">Mark resolved</button></div>'
        ).join('');
        list.querySelectorAll('button').forEach(b => b.addEventListener('click', () => resolve(b.dataset.id, b)));
      } catch (err) {
        list.innerHTML = '<div class="status">Could not load follow-ups: ' + esc(err.message) + ' <button class="btn retry">Retry</button></div>';
        list.querySelector('.retry').addEventListener('click', load);
      }
    }

    async function resolve(taskId, btn) {
      const note = prompt('Resolution note (optional):');
      if (note === null) return;
      btn.disabled = true;
      try {
        // plain-text body, no Content-Type: keeps the request CORS-safelisted (no preflight; the backend has no doOptions)
        const res = await fetch(BACKEND_URL, { method: 'POST', body: JSON.stringify({ action: 'coordinatorresolvetask', idToken: SESSION.idToken, taskId: taskId, note: note }) });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Could not resolve');
        load();
      } catch (err) { btn.disabled = false; alert('Could not resolve: ' + err.message); }
    }
    load();
  }

  // Landing page: {all: {n, hot}, byDept: {'HR & Staff': {n, hot}, ...}} -- hot = at least one high-severity follow-up
  async function counts() {
    const tasks = (await api({ action: 'coordinatortasks' })).tasks;
    const sum = list => ({ n: list.length, hot: list.some(t => t.severity === 'high') });
    const byDept = {};
    DEPARTMENTS.forEach(d => { byDept[d.name] = sum(tasks.filter(t => t.department === d.name)); });
    return { all: sum(tasks), byDept: byDept };
  }

  // ── Academics: CW/HW tag analysis ─────────────────────────────────
  function academicsView(body) {
    const AC = { window: 'ay', side: 'cw', campus: '', q: '', sortKey: 'entries', sortDir: -1, open: null, data: {} };
    body.innerHTML = '<h2 class="pagetitle">Academics: CW/HW tag analysis</h2><p class="pagesub">How each teacher uses the classwork and homework tags in their daily logs.</p><div class="ac-body"></div>';
    const box = body.querySelector('.ac-body');

    async function load() {
      box.innerHTML = '<div class="status">Loading CW/HW analysis (the first load after a few hours can take up to a minute)...</div>';
      try {
        AC.data[AC.window] = AC.data[AC.window] || await api({ action: 'coordinatoracademics', window: AC.window });
        render();
      } catch (err) {
        box.innerHTML = '<div class="status">Could not load the analysis: ' + esc(err.message) + ' <button class="btn ac-retry">Retry</button></div>';
        box.querySelector('.ac-retry').addEventListener('click', load);
      }
    }

    // average number of tags per entry on one side -- a teacher ticking every tag every time has no usable pattern
    function avgTags(o, side) { const n = o[side + 'N']; return n ? Object.keys(o[side]).reduce((a, k) => a + o[side][k], 0) / n : 0; }
    function pct(n, d) { return d ? Math.round(100 * (n || 0) / d) : null; }

    function render() {
      const d = AC.data[AC.window], side = AC.side, tags = d.tags[side];
      const campuses = Array.from(new Set(d.teachers.map(t => t.campus))).sort();
      const rows = d.teachers.filter(t => (!AC.campus || t.campus === AC.campus) && (!AC.q || t.name.toLowerCase().indexOf(AC.q.toLowerCase()) !== -1));
      const val = t => {
        if (AC.sortKey === 'avg') return avgTags(t, side);
        if (AC.sortKey.indexOf('tag:') === 0) { const p = pct(t[side][AC.sortKey.slice(4)], t[side + 'N']); return p == null ? -1 : p; }
        return t[AC.sortKey];
      };
      rows.sort((a, b) => { const x = val(a), y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * AC.sortDir; });

      const cell = (n, total) => {
        const p = pct(n, total);
        return p == null ? '<td>-</td>' : '<td style="background:rgba(206,0,0,' + (p / 100 * 0.55).toFixed(2) + ')">' + p + '%</td>';
      };
      const head = (key, label) => '<th data-sort="' + esc(key) + '">' + esc(label) + (AC.sortKey === key ? (AC.sortDir < 0 ? ' &#9660;' : ' &#9650;') : '') + '</th>';

      let html = '<div class="ctl">' +
        '<span class="seg"><button data-win="ay" class="' + (AC.window === 'ay' ? 'on' : '') + '">Since ' + esc(d.ayStart || '') + '</button><button data-win="d30" class="' + (AC.window === 'd30' ? 'on' : '') + '">Last 30 days</button></span>' +
        '<span class="seg"><button data-side="cw" class="' + (side === 'cw' ? 'on' : '') + '">Classwork tags</button><button data-side="hw" class="' + (side === 'hw' ? 'on' : '') + '">Homework tags</button></span>' +
        '<select class="ac-campus"><option value="">All campuses</option>' + campuses.map(c => '<option' + (AC.campus === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select>' +
        '<input class="ac-q" placeholder="Search teacher" value="' + esc(AC.q) + '"></div>' +
        '<div class="note">' + rows.length + ' teachers. Each % is the share of that teacher\'s ' + (side === 'cw' ? 'classwork' : 'homework') +
        ' entries carrying the tag (an entry can carry several, so a row can add up to more than 100%). "Tags / entry" is the average number of tags ticked per entry; at 5 or more the percentages say little about how the teacher actually teaches. Click a teacher for the class and subject breakdown. Feed generated ' + esc((d.generated || '').slice(0, 16).replace('T', ' ')) + ' UTC.</div>' +
        '<div class="tw"><table><thead><tr>' + head('name', 'Teacher') + head('campus', 'Campus') + head('entries', 'Entries') + head('days', 'Days logged') + head('lastDate', 'Last entry') + head('avg', 'Tags / entry') +
        tags.map(t => head('tag:' + t, t)).join('') + '</tr></thead><tbody>';
      rows.forEach(t => {
        html += '<tr class="row" data-key="' + esc(t.key) + '"><td>' + esc(t.name) + (t.matched ? '' : '<span class="unm">not in roster</span>') + '</td><td>' + esc(t.campus) + '</td><td>' + t.entries + '</td><td>' + t.days + '</td><td>' + esc(t.lastDate) + '</td><td>' + avgTags(t, side).toFixed(1) + (avgTags(t, side) >= 5 ? '<span class="unm">ticks most tags</span>' : '') + '</td>' +
          tags.map(x => cell(t[side][x], t[side + 'N'])).join('') + '</tr>';
        if (AC.open === t.key) {
          Object.keys(t.groups).sort((a, b) => t.groups[b].n - t.groups[a].n).forEach(g => {
            const gr = t.groups[g];
            html += '<tr class="sub"><td>' + esc(g.replace(' | ', ' · ')) + '</td><td></td><td>' + gr.n + '</td><td></td><td></td><td>' + avgTags(gr, side).toFixed(1) + '</td>' + tags.map(x => cell(gr[side][x], gr[side + 'N'])).join('') + '</tr>';
          });
        }
      });
      html += '</tbody></table></div>';
      box.innerHTML = html;

      box.querySelectorAll('[data-win]').forEach(b => b.addEventListener('click', () => { AC.window = b.dataset.win; AC.open = null; load(); }));
      box.querySelectorAll('[data-side]').forEach(b => b.addEventListener('click', () => { AC.side = b.dataset.side; if (AC.sortKey.indexOf('tag:') === 0) AC.sortKey = 'entries'; render(); }));
      box.querySelector('.ac-campus').addEventListener('change', e => { AC.campus = e.target.value; render(); });
      box.querySelector('.ac-q').addEventListener('input', e => {
        AC.q = e.target.value; render();
        const i = box.querySelector('.ac-q'); i.focus(); i.setSelectionRange(AC.q.length, AC.q.length);
      });
      box.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => {
        const k = th.dataset.sort;
        AC.sortDir = AC.sortKey === k ? -AC.sortDir : (k === 'name' || k === 'campus' ? 1 : -1);
        AC.sortKey = k; render();
      }));
      box.querySelectorAll('tr.row').forEach(tr => tr.addEventListener('click', () => { AC.open = AC.open === tr.dataset.key ? null : tr.dataset.key; render(); }));
    }
    load();
  }

  // ── Transport: fleet document compliance ──────────────────────────
  function transportView(body) {
    const T = { campus: '', tier: 'all', q: '', tab: 'list', data: null };
    body.innerHTML = '<h2 class="pagetitle">Fleet document compliance</h2><p class="pagesub">The newest insurance, fitness, MV tax, pollution, route permit and speed governor on file for every running vehicle.</p><div class="tr-body"></div>';
    const box = body.querySelector('.tr-body');
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const fmt = iso => iso ? iso.slice(8, 10) + ' ' + MONTHS[+iso.slice(5, 7) - 1] + ' ' + iso.slice(0, 4) : '-';
    const LABEL = { expired: 'Expired', soon: 'Due in 30 days', later: 'Due in 90 days', missing: 'No record', ok: 'Valid' };
    const RANK = { expired: 0, missing: 1, soon: 2, later: 3, ok: 4 };

    async function load() {
      box.innerHTML = '<div class="status">Loading fleet documents...</div>';
      try { T.data = await api({ action: 'coordinatortransport' }); render(); }
      catch (err) {
        box.innerHTML = '<div class="status">Could not load fleet documents: ' + esc(err.message) + ' <button class="btn tr-retry">Retry</button></div>';
        box.querySelector('.tr-retry').addEventListener('click', load);
      }
    }

    function render() {
      const d = T.data, now = new Date(); now.setHours(0, 0, 0, 0);
      const days = iso => Math.round((new Date(iso + 'T00:00:00') - now) / 86400000);
      const tier = iso => { if (!iso) return 'missing'; const n = days(iso); return n < 0 ? 'expired' : n <= 30 ? 'soon' : n <= 90 ? 'later' : 'ok'; };
      const when = (iso, t) => t === 'missing' ? '-' : days(iso) < 0 ? -days(iso) + ' days ago' : days(iso) === 0 ? 'Today' : 'in ' + days(iso) + ' days';
      const running = d.fleet.filter(b => b.operational), idle = d.fleet.filter(b => !b.operational);
      const items = [];
      running.forEach(b => d.docs.forEach(doc => {
        const e = b.docs[doc.key], t = tier(e.date);
        items.push({ b: b, doc: doc, date: e.date, src: e.src, t: t, n: e.date ? days(e.date) : 0 });
      }));
      const count = t => items.filter(i => i.t === t).length;
      const campuses = Array.from(new Set(running.map(b => b.campus))).sort();
      const pick = i => (!T.campus || i.b.campus === T.campus) && (T.tier === 'all' || i.t === T.tier) &&
        (!T.q || (i.b.reg + ' ' + i.b.driver + ' ' + i.b.route).toLowerCase().indexOf(T.q.toLowerCase()) !== -1);
      const rows = items.filter(i => i.t !== 'ok' && pick(i)).sort((a, b) => RANK[a.t] - RANK[b.t] || a.n - b.n || a.b.reg.localeCompare(b.b.reg));
      const pl = t => '<span class="pl ' + t + '">' + LABEL[t] + '</span>';

      let html = '<div class="tiles">' +
        '<div class="tile"><b>' + running.length + '</b>vehicles running</div>' +
        '<div class="tile bad"><b>' + count('expired') + '</b>documents expired</div>' +
        '<div class="tile warn"><b>' + count('soon') + '</b>due within 30 days</div>' +
        '<div class="tile"><b>' + count('missing') + '</b>with no record</div></div>' +
        '<div class="ctl"><span class="seg">' + [['list', 'Action list'], ['matrix', 'Vehicle by document']].map(x =>
          '<button data-tab="' + x[0] + '" class="' + (T.tab === x[0] ? 'on' : '') + '">' + x[1] + '</button>').join('') + '</span>' +
        '<select class="tr-campus"><option value="">All campuses</option>' + campuses.map(c => '<option' + (T.campus === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select>' +
        (T.tab === 'list' ? '<span class="seg">' + [['all', 'All'], ['expired', 'Expired'], ['soon', 'Due in 30 days'], ['later', 'Due in 90 days'], ['missing', 'No record']].map(x =>
          '<button data-tier="' + x[0] + '" class="' + (T.tier === x[0] ? 'on' : '') + '">' + x[1] + '</button>').join('') + '</span>' : '') +
        '<input class="tr-q" placeholder="Search vehicle, driver or route" value="' + esc(T.q) + '">' +
        '<button class="btn tr-copy">Copy digest</button></div>';

      if (T.tab === 'list') {
        html += '<div class="note">' + rows.length + ' documents. Most overdue first, then no record, then the next renewals. A renewal uploaded through the Transport Document Submission form shows here within about 5 minutes.</div>' +
          '<div class="tw"><table class="l"><thead><tr><th>Status</th><th>Vehicle</th><th>Campus</th><th>Route</th><th>Driver</th><th>Document</th><th>Valid to</th><th>When</th></tr></thead><tbody>' +
          (rows.length ? rows.map(i => '<tr><td>' + pl(i.t) + '</td><td>' + esc(i.b.reg) + '<div class="sm">' + esc(i.b.bus) + '</div></td><td>' + esc(i.b.campus) + '</td><td>' + esc(i.b.route || '-') +
            '</td><td>' + esc(i.b.driver || '-') + '</td><td>' + esc(i.doc.label) + '</td><td>' + fmt(i.date) + (i.src ? '<div class="sm">' + (i.src === 'form' ? 'from the form' : 'from Drive') + '</div>' : '') + '</td><td>' + when(i.date, i.t) + '</td></tr>').join('')
            : '<tr><td colspan="8" class="status">Nothing matches these filters.</td></tr>') + '</tbody></table></div>';
      } else {
        const fleet = running.filter(b => (!T.campus || b.campus === T.campus) && (!T.q || (b.reg + ' ' + b.driver + ' ' + b.route).toLowerCase().indexOf(T.q.toLowerCase()) !== -1))
          .sort((a, b) => a.campus.localeCompare(b.campus) || a.reg.localeCompare(b.reg));
        html += '<div class="note">Expiry date of the newest paper on file. Red is expired, amber is due within 30 days, yellow within 90, grey has no record.</div>' +
          '<div class="tw"><table class="l"><thead><tr><th>Vehicle</th><th>Campus</th><th>Driver</th>' + d.docs.map(x => '<th>' + esc(x.label) + '</th>').join('') + '</tr></thead><tbody>' +
          fleet.map(b => '<tr><td>' + esc(b.reg) + '<div class="sm">' + esc(b.route || b.bus) + '</div></td><td>' + esc(b.campus) + '</td><td>' + esc(b.driver || '-') + '</td>' +
            d.docs.map(x => { const e = b.docs[x.key], t = tier(e.date); return '<td class="dt ' + t + '" title="' + (e.src ? 'Source: ' + (e.src === 'form' ? 'submission form' : 'Drive') : 'No record') + '">' + (e.date ? fmt(e.date) : '-') + '</td>'; }).join('') + '</tr>').join('') +
          '</tbody></table></div>';
      }
      if (idle.length) html += '<div class="note"><b>Not running</b> (marked not operational in the Transport Management System, excluded above): ' +
        idle.map(b => esc(b.reg) + ' (' + esc(b.campus) + (b.route ? ', still mapped to ' + esc(b.route) : '') + ')').join('; ') + '.</div>';
      html += '<div class="note">A pollution or speed governor entry shown as expired or missing may be a paper that exists but was never uploaded; confirm with the driver or transport in-charge before treating it as lapsed. Passenger tax and RC are not tracked here.' +
        (d.unknown.length ? ' <b>Uploads for vehicles not in the fleet list: ' + esc(d.unknown.join(', ')) + '.</b>' : '') + '</div>';
      box.innerHTML = html;

      box.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { T.tab = b.dataset.tab; render(); }));
      box.querySelectorAll('[data-tier]').forEach(b => b.addEventListener('click', () => { T.tier = b.dataset.tier; render(); }));
      box.querySelector('.tr-campus').addEventListener('change', e => { T.campus = e.target.value; render(); });
      box.querySelector('.tr-q').addEventListener('input', e => { T.q = e.target.value; render(); const i = box.querySelector('.tr-q'); i.focus(); i.setSelectionRange(T.q.length, T.q.length); });
      box.querySelector('.tr-copy').addEventListener('click', e => {
        const lines = ['Transport documents: expired or due within 30 days (' + fmt(now.toISOString().slice(0, 10)) + ')'];
        campuses.forEach(c => {
          const per = {};
          items.filter(i => i.b.campus === c && (i.t === 'expired' || i.t === 'soon')).forEach(i => (per[i.b.reg] = per[i.b.reg] || []).push(i.doc.label + (i.t === 'expired' ? ' expired ' : ' due ') + fmt(i.date)));
          if (Object.keys(per).length) { lines.push('', c); Object.keys(per).forEach(r => lines.push('  ' + r + ': ' + per[r].join(', '))); }
        });
        lines.push('', count('missing') + ' further documents have no record. Please upload them through the Transport Document Submission form.');
        const btn = e.target;
        navigator.clipboard.writeText(lines.join('\n')).then(() => { btn.textContent = 'Copied'; }, () => { btn.textContent = 'Could not copy'; });
        setTimeout(() => { btn.textContent = 'Copy digest'; }, 2000);
      });
    }
    load();
  }

  return { boot, tasksView, academicsView, transportView, counts, esc, DEPARTMENTS, setSession: function (s) { SESSION = s; }, canUse };
})();
