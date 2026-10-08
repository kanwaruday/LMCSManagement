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
    { name: 'Transport', page: 'transport', live: true, desc: 'Bus document compliance: insurance, fitness, MV tax, pollution, route permit and speed governor.' },
    { name: 'Student Life', page: null, desc: 'Student welfare and incidents.' },
    { name: 'Systems', page: 'systems', live: true, desc: 'Principals\' daily report analysis: who reported, what they flagged, and register checks.' },
  ];
  // Paths are relative to coordinator/<page>/, i.e. two levels below the repo root.
  const WORK_LINKS = {
    ss_compliance: '../../principals-daily-reporting/index.html', approval: '../../principals-daily-reporting/index.html',
    hiring_stall: '../../hiring/index.html', complete_hire: '../../staff/add-employee.html',
    doc_missing: '../../staff/add-employee.html', doc_none: '../../staff/add-employee.html', doc_verify: '../../staff/add-employee.html',
    pdr_issue: '../systems/index.html',
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
    let view = 'urgency', all = [];
    body.innerHTML = '<h2 class="pagetitle">' + esc(opts.title) + '</h2><p class="pagesub">' + esc(opts.sub || '') + '</p>' +
      '<div class="ctl"><span class="seg"><button data-v="urgency" class="on">By urgency</button><button data-v="school">By school</button></span></div><div class="task-list"></div>';
    const list = body.querySelector('.task-list');
    body.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', () => {
      view = b.dataset.v;
      body.querySelectorAll('[data-v]').forEach(x => x.classList.toggle('on', x === b));
      render();
    }));
    const me = () => (SESSION.email || '').toLowerCase();
    const card = t =>
      '<div class="task ' + esc(t.severity) + '"><div>' +
        '<div class="t"><span class="chip">' + esc(t.severity) + '</span>' + (t.assignee ? '<span class="chip">' + (t.assignee === me() ? 'assigned to you' : 'assigned to ' + esc(t.assignee.split('@')[0])) + '</span>' : '') + esc(t.title) + '</div>' +
        '<div class="d">' + esc(t.detail) + ' &middot; <a href="' + (WORK_LINKS[t.domain] || '#') + '">Open</a></div>' +
      '</div><button class="btn" data-id="' + esc(t.taskId) + '">Mark resolved</button></div>';

    function render() {
      if (!all.length) { list.innerHTML = '<div class="status">Nothing to follow up on here right now.</div>'; return; }
      if (view === 'school') {
        // the same follow-ups, grouped under the school they belong to (LMS1..LMS6 first, anything without a school last)
        const groups = {};
        all.forEach(t => { (groups[t.campus || ''] = groups[t.campus || ''] || []).push(t); });
        const order = Object.keys(groups).sort((x, y) => (x === '') - (y === '') || x.localeCompare(y, undefined, { numeric: true }));
        list.innerHTML = order.map(c => {
          const g = groups[c], hot = g.filter(t => t.severity === 'high').length;
          return '<h3 style="font-size:14px;margin:22px 0 8px">' + esc(c || 'No school') + ' <span class="sm" style="font-weight:400">' + g.length + ' follow-up' + (g.length > 1 ? 's' : '') + (hot ? ', ' + hot + ' high' : '') + '</span></h3>' + g.map(card).join('');
        }).join('');
      } else list.innerHTML = all.map(card).join('');
      list.querySelectorAll('button').forEach(b => b.addEventListener('click', () => resolve(b.dataset.id, b)));
    }

    async function load() {
      list.innerHTML = '<div class="status">Loading follow-ups...</div>';
      try {
        all = (await api({ action: 'coordinatortasks' })).tasks.filter(t => !opts.dept || t.department === opts.dept).sort((a, b) => (b.assignee === me()) - (a.assignee === me())); // what is assigned to you first
        render();
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

  // ── Document compliance: every scan, and every gap ────────────────
  function documentsView(body) {
    const D = { campus: '', status: 'all', q: '', sortKey: 'missing', sortDir: -1, data: null };
    body.innerHTML = '<h2 class="pagetitle">Document compliance</h2><p class="pagesub">Every uploaded document with its scanned link, and what is still missing, for each active employee.</p><div class="doc-body"></div>';
    const box = body.querySelector('.doc-body');

    async function load() {
      box.innerHTML = '<div class="status">Loading documents (the first load can take a few seconds)...</div>';
      try { D.data = await api({ action: 'coordinatordocuments' }); render(); }
      catch (err) {
        box.innerHTML = '<div class="status">Could not load documents: ' + esc(err.message) + ' <button class="btn doc-retry">Retry</button></div>';
        box.querySelector('.doc-retry').addEventListener('click', load);
      }
    }

    const links = urls => urls.map((u, i) => '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + (i ? '#' + (i + 1) : 'View') + '</a>').join(' ');

    function render() {
      const d = D.data, req = d.required;
      const all = d.employees;
      const state = e => e.missing.length === 0 ? 'complete' : (e.missing.length === req.length ? 'nothing' : 'partial');
      const tiles = { total: all.length, complete: all.filter(e => state(e) === 'complete').length,
        partial: all.filter(e => state(e) === 'partial').length, nothing: all.filter(e => state(e) === 'nothing').length };
      const campuses = Array.from(new Set(all.map(e => e.campus))).sort();
      const rows = all.filter(e => (!D.campus || e.campus === D.campus) && (D.status === 'all' || (D.status === 'missing' ? e.missing.length : state(e) === D.status)) &&
        (!D.q || (e.name + ' ' + e.code).toLowerCase().indexOf(D.q.toLowerCase()) !== -1));
      const val = e => D.sortKey === 'missing' ? e.missing.length : (D.sortKey === 'name' ? e.name.toLowerCase() : e.campus);
      rows.sort((a, b) => { const x = val(a), y = val(b); return ((x > y ? 1 : x < y ? -1 : 0) * D.sortDir) || a.name.localeCompare(b.name); });
      const head = (key, label) => '<th data-sort="' + key + '">' + label + (D.sortKey === key ? (D.sortDir < 0 ? ' &#9660;' : ' &#9650;') : '') + '</th>';

      let html = '<div class="tiles">' +
        '<div class="tile"><b>' + tiles.total + '</b>active employees</div><div class="tile"><b>' + tiles.complete + '</b>have every required document</div>' +
        '<div class="tile warn"><b>' + tiles.partial + '</b>missing some</div><div class="tile bad"><b>' + tiles.nothing + '</b>nothing uploaded</div></div>' +
        '<div class="ctl"><select class="doc-campus"><option value="">All campuses</option>' + campuses.map(c => '<option' + (D.campus === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select>' +
        '<span class="seg">' + [['all', 'All'], ['missing', 'Missing something'], ['complete', 'Complete'], ['nothing', 'Nothing uploaded']].map(x =>
          '<button data-status="' + x[0] + '" class="' + (D.status === x[0] ? 'on' : '') + '">' + x[1] + '</button>').join('') + '</span>' +
        '<input class="doc-q" placeholder="Search name or code" value="' + esc(D.q) + '"></div>' +
        '<div class="note">' + rows.length + ' employees. Required (the Hiring Dashboard\'s bar for every new hire): ' + esc(req.join(', ')) +
        '; a qualification slot is met by any one of Bachelors, Master, Professional degree or Highest qualification. Uploads are matched to people by the Employee ID typed on the form; where someone uploaded twice, the newest file is first. Generated ' + esc((d.generated || '').slice(0, 16).replace('T', ' ')) + ' UTC.' +
        (d.noTab && d.noTab.length ? ' ' + esc(d.noTab.join(', ')) + ' has staff but no upload tab, so everyone there shows as missing.' : '') +
        (d.missingTabs && d.missingTabs.length ? ' <b>Tab not found in the responses workbook: ' + esc(d.missingTabs.join(', ')) + '.</b>' : '') + '</div>' +
        '<div class="tw"><table><thead><tr>' + head('name', 'Employee') + head('campus', 'Campus') + head('missing', 'Missing') + req.map(r => '<th>' + esc(r) + '</th>').join('') + '<th>Other documents</th></tr></thead><tbody>';
      rows.forEach(e => {
        html += '<tr><td>' + esc(e.name) + '<div class="sm">' + esc(e.code) + '</div></td><td>' + esc(e.campus) + '</td><td>' + (e.missing.length ? '<span class="miss">' + e.missing.length + ' of ' + req.length + '</span>' : '<span class="okc">none</span>') + '</td>' +
          req.map(r => '<td>' + (e.required[r].length ? '<span class="okc">' + links(e.required[r]) + '</span>' : '<span class="miss">Missing</span>') + '</td>').join('') +
          '<td class="wrap">' + (Object.keys(e.other).map(t => esc(t) + ' ' + links(e.other[t])).join('<br>') || '<span class="sm">-</span>') + '</td></tr>';
      });
      html += '</tbody></table></div>';
      const un = d.unlinked;
      html += '<h3 class="pagetitle" style="margin-top:22px">Uploads not linked to an employee (' + un.length + ')</h3>' +
        '<p class="pagesub">Form submissions with a blank or unrecognised Employee ID. Fix the ID in the responses sheet and they will attach to the right person.</p>' +
        (un.length ? '<div class="tw"><table><thead><tr><th>Campus</th><th>Name typed</th><th>ID typed</th><th>Submitted</th><th>Files</th><th>Types</th></tr></thead><tbody>' +
          un.map(u => '<tr><td>' + esc(u.campus) + '</td><td>' + esc(u.name || '(blank)') + '</td><td>' + esc(u.id || '(blank)') + '</td><td>' + esc((u.timestamp || '').slice(0, 10)) + '</td><td>' + u.files + '</td><td class="wrap">' + esc(u.types.join(', ')) + '</td></tr>').join('') + '</tbody></table></div>'
          : '<div class="status">None.</div>');
      box.innerHTML = html;

      box.querySelector('.doc-campus').addEventListener('change', e => { D.campus = e.target.value; render(); });
      box.querySelectorAll('[data-status]').forEach(b => b.addEventListener('click', () => { D.status = b.dataset.status; render(); }));
      box.querySelector('.doc-q').addEventListener('input', e => { D.q = e.target.value; render(); const i = box.querySelector('.doc-q'); i.focus(); i.setSelectionRange(D.q.length, D.q.length); });
      box.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => {
        const k = th.dataset.sort; D.sortDir = D.sortKey === k ? -D.sortDir : (k === 'missing' ? -1 : 1); D.sortKey = k; render();
      }));
    }
    load();
  }

  // ── Transport: fleet document compliance ──────────────────────────
  function transportView(body) {
    const T = { campus: '', tier: 'all', q: '', tab: 'list', pay: 'after', pk: 'result', pd: 1, data: null };
    body.innerHTML = '<h2 class="pagetitle">Transport fleet</h2><p class="pagesub">Document compliance for every vehicle, and what each bus earns and costs.</p><div class="tr-body"></div>';
    const box = body.querySelector('.tr-body');
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const fmt = iso => iso ? iso.slice(8, 10) + ' ' + MONTHS[+iso.slice(5, 7) - 1] + ' ' + iso.slice(0, 4) : '-';
    const LABEL = { expired: 'Expired', check: 'Scan, date unread', missing: 'No record', na: 'Not needed', soon: 'Due in 30 days', later: 'Due in 90 days', ok: 'Valid' };
    const RANK = { expired: 0, check: 1, missing: 2, soon: 3, later: 4, ok: 5, na: 6 };

    async function load() {
      box.innerHTML = '<div class="status">Loading the transport fleet...</div>';
      try { T.data = await api({ action: 'coordinatortransport' }); render(); }
      catch (err) {
        box.innerHTML = '<div class="status">Could not load the transport fleet: ' + esc(err.message) + ' <button class="btn tr-retry">Retry</button></div>';
        box.querySelector('.tr-retry').addEventListener('click', load);
      }
    }

    function render() {
      const d = T.data, now = new Date(); now.setHours(0, 0, 0, 0);
      const days = iso => Math.round((new Date(iso + 'T00:00:00') - now) / 86400000);
      const tier = e => { if (e.na) return 'na'; if (!e.date) return e.unread.length ? 'check' : 'missing'; const n = days(e.date); return n < 0 ? 'expired' : n <= 30 ? 'soon' : n <= 90 ? 'later' : 'ok'; };
      const when = (iso, t) => !iso ? '-' : days(iso) < 0 ? -days(iso) + ' days ago' : days(iso) === 0 ? 'Today' : 'in ' + days(iso) + ' days';
      const tracked = d.fleet, idle = d.fleet.filter(b => !b.operational), nr = b => b.operational ? '' : ' &middot; not running'; // every vehicle is tracked, running or not
      const items = [];
      tracked.forEach(b => d.docs.forEach(doc => {
        const e = b.docs[doc.key], t = tier(e);
        items.push({ b: b, doc: doc, date: e.date, src: e.src, link: e.link, unread: e.unread, t: t, n: e.date ? days(e.date) : 0 });
      }));
      const count = t => items.filter(i => i.t === t).length;
      const campuses = Array.from(new Set(tracked.map(b => b.campus))).sort();
      const pick = i => (!T.campus || i.b.campus === T.campus) && (T.tier === 'all' || i.t === T.tier) &&
        (!T.q || (i.b.reg + ' ' + i.b.driver + ' ' + i.b.route).toLowerCase().indexOf(T.q.toLowerCase()) !== -1);
      const rows = items.filter(i => i.t !== 'ok' && i.t !== 'na' && pick(i)).sort((a, b) => RANK[a.t] - RANK[b.t] || a.n - b.n || a.b.reg.localeCompare(b.b.reg));
      const pl = t => '<span class="pl ' + t + '">' + LABEL[t] + '</span>';
      const a = (u, txt) => '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(txt) + '</a>';
      const srcNote = i => (i.src === 'form' ? (i.link ? a(i.link, 'from the form (view upload)') : 'from the form') : i.src === 'override' ? 'from the overrides note' : i.src === 'drive' ? a(i.link, 'from the Drive scan') : '') +
        (i.unread.length ? (i.src ? ' &middot; ' : '') + i.unread.map((u, n) => a(u.link, (i.src ? 'unread scan' : 'View scan') + (i.unread.length > 1 ? ' #' + (n + 1) : ''))).join(' ') : '');
      const synced = d.syncedAt ? new Date(d.syncedAt) : null, ageH = synced ? (Date.now() - synced) / 3600000 : null;
      const pend = d.pending && d.pending.files || [];


      // ── Bus P&L: per bus totals from the monthly rows the sync pushed (Transport P&L tab) ──
      const rupee = n => (n < 0 ? '-' : '') + '₹' + Math.abs(Math.round(n)).toLocaleString('en-IN');
      const lakh = n => (n < 0 ? '-' : '') + '₹' + (Math.abs(n) / 100000).toFixed(2) + ' lakh';
      const metaOf = reg => d.fleet.find(b => b.reg === reg);
      const pnlMonths = Array.from(new Set((d.pnl || []).map(r => r.month))).sort();
      const byBus = {};
      (d.pnl || []).forEach(r => {
        const o = byBus[r.reg] = byBus[r.reg] || { reg: r.reg, campus: r.campus, fee: 0, fuel: 0, loan: 0, fixed: 0, pay: 0, net: {}, note: r.note };
        o.fee += r.fee; o.fuel += r.fuel; o.loan += r.loan; o.fixed += r.fixed; o.pay += r.pay;
        o.net[r.month] = r.fee - r.fuel - r.loan - r.fixed - (T.pay === 'after' ? r.pay : 0);
      });
      const buses = Object.keys(byBus).map(k => {
        const o = byBus[k], m = metaOf(k), cost = o.fuel + o.loan + o.fixed + (T.pay === 'after' ? o.pay : 0), flags = [];
        if (m && !m.operational) flags.push('Not running');
        if (!o.fee && !(m && !m.operational)) flags.push('No fee collected');
        if (!o.pay && !(m && !m.operational) && !o.note) flags.push('No driver pay recorded');
        if (o.note) flags.push(o.note);
        return Object.assign(o, { m: m, cost: cost, result: o.fee - cost, margin: o.fee ? (o.fee - cost) / o.fee : null, flags: flags });
      });
      const pfilter = o => (!T.campus || o.campus === T.campus) && (!T.q || (o.reg + ' ' + (o.m ? o.m.driver + ' ' + o.m.route : '')).toLowerCase().indexOf(T.q.toLowerCase()) !== -1);
      const pRows = buses.filter(pfilter).sort((a, b) => ((a[T.pk] == null ? -1e12 : a[T.pk]) - (b[T.pk] == null ? -1e12 : b[T.pk])) * T.pd || a.reg.localeCompare(b.reg));
      const sum = (list, k) => list.reduce((x, o) => x + o[k], 0);
      const spark = o => {
        const v = pnlMonths.map(mo => o.net[mo] || 0), lo = Math.min(0, ...v), hi = Math.max(0, ...v), span = hi - lo || 1;
        const pts = v.map((x, i) => (i * 56 / Math.max(1, v.length - 1) + 2).toFixed(1) + ',' + (16 - (x - lo) / span * 14).toFixed(1)).join(' ');
        const zero = (16 - (0 - lo) / span * 14).toFixed(1);
        return '<svg width="60" height="18" viewBox="0 0 60 18" aria-hidden="true"><line x1="2" x2="58" y1="' + zero + '" y2="' + zero + '" stroke="#ccc"/><polyline fill="none" stroke="' +
          (v[v.length - 1] < 0 ? '#CE0000' : '#15803d') + '" stroke-width="1.5" points="' + pts + '"/></svg>';
      };
      const pth = (k, label) => '<th data-psort="' + k + '">' + label + (T.pk === k ? (T.pd < 0 ? ' &#9660;' : ' &#9650;') : '') + '</th>';
      const period = pnlMonths.length ? fmt(pnlMonths[0] + '-01').slice(3) + ' to ' + fmt(pnlMonths[pnlMonths.length - 1] + '-01').slice(3) : '';

      const drvNote = b => b.driverCode || b.driverStatus ? '<div class="sm">' + esc(b.driverCode || 'no code') + (b.driverStatus && b.driverStatus !== 'verified' ? ' &middot; <span class="miss">' + esc(b.driverStatus) + '</span>' : ' &middot; in staff master') + '</div>' : '';
      const staff = (d.people || []).filter(p => (!T.campus || p.campus === T.campus) && (!T.q || (p.name + ' ' + p.code + ' ' + p.rosterName + ' ' + p.vehicles.join(' ')).toLowerCase().indexOf(T.q.toLowerCase()) !== -1))
        .sort((a, b) => (a.status === 'verified') - (b.status === 'verified') || a.campus.localeCompare(b.campus) || a.name.localeCompare(b.name));
      const bad = staff.filter(p => p.status !== 'verified').length;
      let html = '<div class="note">' + (synced ? 'Scan dates and workbook figures were last refreshed <b' + (ageH > 6 ? ' class="stale"' : '') + '>' + synced.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) +
        ' (' + (ageH < 1 ? 'under an hour' : Math.round(ageH) + ' hours') + ' ago)</b>. Form uploads are live.' + (ageH > 6 ? ' The sync on the Mac may be off, so scan-read dates could be out of date.' : '') : 'Drive scan data has no refresh time.') +
      (pend.length ? '<br><b class="stale">' + pend.length + (d.pending.capped ? '+' : '') + ' new file' + (pend.length > 1 ? 's' : '') + ' in the Transport folder waiting to be read:</b> ' + pend.slice(0, 8).map(f => a(f.url, f.name)).join(', ') + (pend.length > 8 ? ' and ' + (pend.length - 8) + ' more' : '') : '') + '</div>' +
      (d.warnings && d.warnings.length ? '<div class="note"><b class="stale">Transport Overrides note:</b> ' + d.warnings.map(esc).join('; ') + '</div>' : '') +
      (T.tab === 'drivers' ? '<div class="tiles"><div class="tile"><b>' + staff.length + '</b>people on the transport staff list</div><div class="tile"><b>' + (staff.length - bad) + '</b>verified against the staff master</div><div class="tile ' + (bad ? 'warn' : '') + '"><b>' + bad + '</b>need checking</div></div>' : T.tab === 'pnl' ? '<div class="tiles"><div class="tile"><b>' + lakh(sum(pRows, 'fee')) + '</b>fee collected</div>' +
        '<div class="tile"><b>' + lakh(sum(pRows, 'cost')) + '</b>' + (T.pay === 'after' ? 'total cost' : 'cost before driver pay') + '</div>' +
        '<div class="tile ' + (sum(pRows, 'result') < 0 ? 'bad' : '') + '"><b>' + lakh(sum(pRows, 'result')) + '</b>result over ' + pnlMonths.length + ' months</div>' +
        '<div class="tile ' + (pRows.some(o => o.result < 0) ? 'warn' : '') + '"><b>' + pRows.filter(o => o.result < 0).length + ' of ' + pRows.length + '</b>vehicles losing money</div></div>' : '<div class="tiles">' +
        '<div class="tile"><b>' + tracked.length + '</b>vehicles tracked' + (idle.length ? ' (' + (tracked.length - idle.length) + ' running)' : '') + '</div>' +
        '<div class="tile bad"><b>' + count('expired') + '</b>documents expired</div>' +
        '<div class="tile warn"><b>' + count('soon') + '</b>due within 30 days</div>' +
        '<div class="tile"><b>' + count('check') + '</b>scan on file, date unread</div>' +
        '<div class="tile"><b>' + count('missing') + '</b>with no record</div></div>') +
        '<div class="ctl"><span class="seg">' + [['list', 'Action list'], ['matrix', 'Vehicle by document']].concat(d.pnl && d.pnl.length ? [['pnl', 'Bus P&L']] : [], d.people && d.people.length ? [['drivers', 'Drivers']] : []).map(x =>
          '<button data-tab="' + x[0] + '" class="' + (T.tab === x[0] ? 'on' : '') + '">' + x[1] + '</button>').join('') + '</span>' +
        '<select class="tr-campus"><option value="">All campuses</option>' + campuses.map(c => '<option' + (T.campus === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select>' +
        (T.tab === 'list' ? '<span class="seg">' + [['all', 'All'], ['expired', 'Expired'], ['soon', 'Due in 30 days'], ['later', 'Due in 90 days'], ['check', 'Scan, date unread'], ['missing', 'No record']].map(x =>
          '<button data-tier="' + x[0] + '" class="' + (T.tier === x[0] ? 'on' : '') + '">' + x[1] + '</button>').join('') + '</span>' : '') +
        (T.tab === 'pnl' ? '<span class="seg">' + [['after', 'After driver pay'], ['before', 'Before driver pay']].map(x => '<button data-pay="' + x[0] + '" class="' + (T.pay === x[0] ? 'on' : '') + '">' + x[1] + '</button>').join('') + '</span>' : '') +
        '<input class="tr-q" placeholder="Search vehicle, driver or route" value="' + esc(T.q) + '">' +
        (T.tab === 'pnl' || T.tab === 'drivers' ? '' : '<button class="btn tr-copy">Copy digest</button>') + '</div>';

      if (T.tab === 'list') {
        html += '<div class="note">' + rows.length + ' documents. Most overdue first, then scans whose date could not be read, then no record, then the next renewals. A renewal submitted through the Transport Document Submission form shows here within about 5 minutes; a Drive upload shows as waiting until the next sync reads it.</div>' +
          '<div class="tw"><table class="l"><thead><tr><th>Status</th><th>Vehicle</th><th>Campus</th><th>Route</th><th>Driver</th><th>Document</th><th>Valid to</th><th>When</th></tr></thead><tbody>' +
          (rows.length ? rows.map(i => '<tr><td>' + pl(i.t) + '</td><td>' + esc(i.b.reg) + '<div class="sm">' + esc(i.b.bus) + nr(i.b) + '</div></td><td>' + esc(i.b.campus) + '</td><td>' + esc(i.b.route || '-') +
            '</td><td>' + esc(i.b.driver || '-') + drvNote(i.b) + '</td><td>' + esc(i.doc.label) + '</td><td>' + fmt(i.date) + '<div class="sm">' + srcNote(i) + '</div></td><td>' + when(i.date, i.t) + '</td></tr>').join('')
            : '<tr><td colspan="8" class="status">Nothing matches these filters.</td></tr>') + '</tbody></table></div>';
      } else if (T.tab === 'drivers') {
        html += '<div class="note">Everyone on the transport Man Power sheet, linked to the staff master by employee code. "Verified" means the code is an active employee at the same campus with a matching name. Anything else needs a look: fix the code in the Man Power sheet, or check whether the person has left.</div>' +
          '<div class="tw"><table class="l"><thead><tr><th>Link</th><th>Name (transport sheet)</th><th>Campus</th><th>Role</th><th>Employee code</th><th>Staff master says</th><th>Buses</th></tr></thead><tbody>' +
          (staff.length ? staff.map(p => '<tr><td>' + (p.status === 'verified' ? '<span class="pl ok">Verified</span>' : '<span class="pl expired">' + esc(p.status) + '</span>') + '</td><td>' + esc(p.name) + '</td><td>' + esc(p.campus) + '</td><td>' + esc(p.designation) + '</td><td>' + esc(p.code || '-') + '</td><td>' + (p.rosterName ? esc(p.rosterName) + (p.rosterCampus && p.rosterCampus !== p.campus ? ' (' + esc(p.rosterCampus) + ')' : '') : '-') + '</td><td>' + (p.vehicles.map(esc).join(', ') || '<span class="sm">none</span>') + '</td></tr>').join('')
            : '<tr><td colspan="7" class="status">Nothing matches these filters.</td></tr>') + '</tbody></table></div>';
      } else if (T.tab === 'pnl') {
        const camp = {};
        pRows.forEach(o => { const c = camp[o.campus] = camp[o.campus] || { campus: o.campus, fee: 0, cost: 0, n: 0, lose: 0 }; c.fee += o.fee; c.cost += o.cost; c.n++; if (o.result < 0) c.lose++; });
        html += '<div class="note">' + period + '. Money from the transport workbook (Transport Monthly tab), totalled per vehicle; fee collected against fuel, loan interest, fixed costs (insurance, taxes, service, parking, challan) and, in "after driver pay", the monthly driver and helper pay. Click a column heading to sort.</div>' +
          '<div class="tw" style="margin-bottom:14px"><table><thead><tr><th>Campus</th><th>Vehicles</th><th>Fee collected</th><th>Cost</th><th>Result</th><th>Losing money</th></tr></thead><tbody>' +
          Object.keys(camp).sort().map(k => { const c = camp[k]; return '<tr><td>' + esc(c.campus) + '</td><td>' + c.n + '</td><td>' + rupee(c.fee) + '</td><td>' + rupee(c.cost) + '</td><td class="' + (c.fee - c.cost < 0 ? 'miss' : '') + '">' + rupee(c.fee - c.cost) + '</td><td>' + c.lose + ' of ' + c.n + '</td></tr>'; }).join('') + '</tbody></table></div>' +
          '<div class="tw"><table><thead><tr><th>Vehicle</th><th>Campus</th>' + pth('fee', 'Fee collected') + pth('fuel', 'Fuel') + pth('loan', 'Loan interest') + pth('fixed', 'Fixed costs') +
          (T.pay === 'after' ? pth('pay', 'Driver pay') : '') + pth('cost', 'Total cost') + pth('result', 'Result') + pth('margin', 'Margin') + '<th>Monthly result</th><th>Flags</th></tr></thead><tbody>' +
          (pRows.length ? pRows.map(o => '<tr><td>' + esc(o.reg) + '<div class="sm">' + esc(o.m ? (o.m.route || o.m.bus) : '') + (o.m && o.m.driver ? ' &middot; ' + esc(o.m.driver) : '') + '</div></td><td>' + esc(o.campus) + '</td><td>' + rupee(o.fee) + '</td><td>' + rupee(o.fuel) + '</td><td>' + rupee(o.loan) + '</td><td>' + rupee(o.fixed) + '</td>' +
            (T.pay === 'after' ? '<td>' + rupee(o.pay) + '</td>' : '') + '<td>' + rupee(o.cost) + '</td><td class="' + (o.result < 0 ? 'miss' : 'okc') + '"><b>' + rupee(o.result) + '</b></td><td>' + (o.margin == null ? '-' : Math.round(o.margin * 100) + '%') + '</td><td>' + spark(o) + '</td><td class="wrap">' + (o.flags.map(esc).join('<br>') || '<span class="sm">-</span>') + '</td></tr>').join('')
            : '<tr><td colspan="13" class="status">Nothing matches these filters.</td></tr>') + '</tbody></table></div>';
      } else {
        const fleet = tracked.filter(b => (!T.campus || b.campus === T.campus) && (!T.q || (b.reg + ' ' + b.driver + ' ' + b.route).toLowerCase().indexOf(T.q.toLowerCase()) !== -1))
          .sort((a, b) => a.campus.localeCompare(b.campus) || a.reg.localeCompare(b.reg));
        html += '<div class="note">Expiry date of the newest paper on file; click a date to open its scan (or the form upload) and check it. A small +1 means another scan of that paper exists whose date could not be read. Red is expired, amber is due within 30 days, yellow within 90, blue is a scan whose date could not be read, grey has no record.</div>' +
          '<div class="tw"><table class="l"><thead><tr><th>Vehicle</th><th>Campus</th><th>Driver</th>' + d.docs.map(x => '<th>' + esc(x.label) + '</th>').join('') + '</tr></thead><tbody>' +
          fleet.map(b => '<tr><td>' + esc(b.reg) + '<div class="sm">' + esc(b.route || b.bus) + nr(b) + '</div></td><td>' + esc(b.campus) + '</td><td>' + esc(b.driver || '-') + drvNote(b) + '</td>' +
            d.docs.map(x => { const e = b.docs[x.key], t = tier(e); const txt = e.date ? fmt(e.date) : t === 'na' ? 'n/a' : t === 'check' ? 'unread' : '-', first = e.link || (e.unread[0] && e.unread[0].link) || '';
              const src = e.src ? 'Source: ' + (e.src === 'form' ? 'submission form upload' : e.src === 'override' ? 'Transport Overrides note' + (e.note ? ' (' + e.note + ')' : '') : 'Drive scan') + (e.link ? '. Click to open it.' : '') : e.unread.length ? 'Scan on file, date unread. Click to open it.' : 'No record';
              const extra = e.date && e.unread.length ? ' <sup>' + a(e.unread[0].link, '+' + e.unread.length) + '</sup>' : '';
              return '<td class="dt ' + t + '" title="' + esc(src + (extra ? '. +' + e.unread.length + ' more scan(s) whose date could not be read.' : '')) + '">' + (first ? a(first, txt) : txt) + extra + '</td>'; }).join('') + '</tr>').join('') +
          '</tbody></table></div>';
      }
      html += '<div class="note">A pollution or speed governor entry shown as expired or missing may be a paper that exists but was never uploaded; confirm with the driver or transport in-charge before treating it as lapsed. Passenger tax and RC are not tracked here.' +
        (d.unknown.length ? ' <b>Uploads for vehicles not in the fleet list: ' + esc(d.unknown.join(', ')) + '.</b>' : '') + '</div>';
      box.innerHTML = html;

      box.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { T.tab = b.dataset.tab; render(); }));
      box.querySelectorAll('[data-pay]').forEach(b => b.addEventListener('click', () => { T.pay = b.dataset.pay; if (T.pay === 'before' && T.pk === 'pay') T.pk = 'result'; render(); }));
      box.querySelectorAll('[data-psort]').forEach(th => th.addEventListener('click', () => { const k = th.dataset.psort; T.pd = T.pk === k ? -T.pd : (k === 'fee' ? -1 : 1); T.pk = k; render(); }));
      box.querySelectorAll('[data-tier]').forEach(b => b.addEventListener('click', () => { T.tier = b.dataset.tier; render(); }));
      box.querySelector('.tr-campus').addEventListener('change', e => { T.campus = e.target.value; render(); });
      box.querySelector('.tr-q').addEventListener('input', e => { T.q = e.target.value; render(); const i = box.querySelector('.tr-q'); i.focus(); i.setSelectionRange(T.q.length, T.q.length); });
      const copyBtn = box.querySelector('.tr-copy');
      if (copyBtn) copyBtn.addEventListener('click', e => {
        const lines = ['Transport documents: expired or due within 30 days (' + fmt(now.toISOString().slice(0, 10)) + ')'];
        campuses.forEach(c => {
          const per = {};
          items.filter(i => i.b.campus === c && (i.t === 'expired' || i.t === 'soon')).forEach(i => (per[i.b.reg] = per[i.b.reg] || []).push(i.doc.label + (i.t === 'expired' ? ' expired ' : ' due ') + fmt(i.date)));
          if (Object.keys(per).length) { lines.push('', c); Object.keys(per).forEach(r => lines.push('  ' + r + ': ' + per[r].join(', '))); }
        });
        lines.push('', (count('missing') + count('check')) + ' further documents have no date on file. Please upload them through the Transport Document Submission form.');
        const btn = e.target;
        navigator.clipboard.writeText(lines.join('\n')).then(() => { btn.textContent = 'Copied'; }, () => { btn.textContent = 'Could not copy'; });
        setTimeout(() => { btn.textContent = 'Copy digest'; }, 2000);
      });
    }
    load();
  }

  // ── Systems: principals' daily report briefing ────────────────────
  function pdrView(body) {
    const P = { tab: 'today', topic: '', act: false, campus: '', itype: '', istatus: 'open', repeat: false, who: '', sort: 'age', group: 'campus', day: '', days: {}, data: null };
    body.innerHTML = '<h2 class="pagetitle">Principals\' daily reports</h2><p class="pagesub">Who reported, what is open or stuck, and what the principals flagged. Coordinator view only; January 2026 onward.</p><div class="pd-body"></div>';
    const box = body.querySelector('.pd-body');
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const fmt = iso => +iso.slice(8, 10) + ' ' + MONTHS[+iso.slice(5, 7) - 1];
    const CAMPUSES = ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6'];
    const QUIET_DAYS = 14, STUCK_DAYS = 7;
    const now = new Date(), today = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2) + '-' + ('0' + now.getDate()).slice(-2);
    const ago = iso => Math.round((new Date(today + 'T00:00:00') - new Date(iso + 'T00:00:00')) / 86400000);

    async function load() {
      box.innerHTML = '<div class="status">Loading the principals\' reports...</div>';
      try { P.data = await api({ action: 'coordinatorpdr' }); render(); }
      catch (err) {
        box.innerHTML = '<div class="status">Could not load the reports: ' + esc(err.message) + ' <button class="btn pd-retry">Retry</button></div>';
        box.querySelector('.pd-retry').addEventListener('click', load);
      }
    }

    function render() {
      const d = P.data, reps = d.reports, tags = d.tags, hist = d.history || [];
      const has = {}; hist.forEach(h => { has[h.date + '|' + h.campus] = 1; }); reps.forEach(r => { has[r.date + '|' + r.campus] = r;});
      const camps = CAMPUSES.filter(c => Object.keys(has).some(k => k.slice(11) === c));
      // ponytail: a day counts as a reporting day when any campus reported and it is not a Sunday; a campus closed on its own
      // (no school calendar here) shows as missed. Add the school calendar if that becomes noisy.
      const days = [...new Set(Object.keys(has).map(k => k.slice(0, 10)))].filter(x => new Date(x + 'T00:00:00').getDay() !== 0).sort();
      // Merges ("this is the same problem as that one", set by a coordinator): the merged-away issue's mentions move onto the one it was merged into.
      const mergeMap = d.merges || {}, raw = (d.issues || []).map(i => Object.assign({ kids: [] }, i)), byId = {};
      raw.forEach(i => { byId[i.id] = i; });
      const rootOf = id => { let x = id, n = 0; while (mergeMap[x] && n++ < 5) x = mergeMap[x]; return x; };
      const kept = raw.filter(i => { const r = byId[rootOf(i.id)]; if (r && r !== i) { r.kids.push(i); return false; } return true; });
      kept.forEach(t => t.kids.forEach(k => {
        const shared = t.items.filter(a => k.items.some(b => b.date === a.date)).length; // days both were mentioned, so they are not counted twice
        t.count = t.count + k.count - shared;
        if (k.first < t.first) t.first = k.first;
        if (k.last > t.last) { t.last = k.last; t.needsAction = k.needsAction; }
        t.items = t.items.concat(k.items.map(x => Object.assign({ from: k.subject }, x))).sort((a, b) => a.date.localeCompare(b.date)).slice(-10);
      }));
      const issues = kept.map(i => Object.assign({ age: ago(i.last), span: ago(i.first) - ago(i.last) }, i));
      const acts = d.actions || {}, people = d.coordinators || [], me = (SESSION && SESSION.email || '').toLowerCase();
      issues.forEach(i => {
        i.open = i.age <= QUIET_DAYS; i.act = acts[i.id] || null;
        i.reopened = !!i.act && i.act.status === 'resolved' && i.last > i.act.lastAtAction; // resolved, then a principal raised it again
        if (i.act && i.act.status === 'resolved' && !i.reopened) i.open = false;
        i.stuck = i.open && i.span >= STUCK_DAYS;
        i.handled = !!i.act && !i.reopened && i.act.status !== 'open' && i.act.status !== 'resolved'; // acknowledged or assigned
      });
      const open = issues.filter(i => i.open), openAct = open.filter(i => i.needsAction), todo = openAct.filter(i => !i.handled);
      const msgs = reps.filter(r => r.message.trim()).map(r => ({ r, t: tags[r.date + '|' + r.campus] || { topics: [], action: false, summary: '' } }))
        .sort((a, b) => b.r.date.localeCompare(a.r.date) || a.r.campus.localeCompare(b.r.campus));
      const topics = [...new Set(msgs.flatMap(m => m.t.topics))].sort();
      const missed = c => days.filter(x => !has[x + '|' + c]).length;
      const last = days.slice(-14), lastDay = days[days.length - 1];
      const issueTypes = [...new Set(issues.map(i => i.type))].sort();
      const sinceNote = d.pushedAt ? 'History and issues were last refreshed ' + esc(d.pushedAt.slice(0, 10)) + ' by the sync on the Mac.' : 'History and issues have not been pushed from the Mac yet.';

      const hrs = iso => iso ? (Date.now() - new Date(iso).getTime()) / 3600000 : null, tm = iso => { const t = new Date(iso); return t.getDate() + ' ' + MONTHS[t.getMonth()] + ' ' + ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2); };
      const agoTxt = h => h < 1 ? 'under an hour ago' : h < 48 ? Math.round(h) + ' h ago' : Math.round(h / 24) + ' days ago';
      const fsAll = (d.fees && d.fees.series) || [], feeLast = fsAll.length ? fsAll[fsAll.length - 1][0] : '', admLast = (d.admissions || []).reduce((m, a) => a.date > m ? a.date : m, '');
      const fresh = [
        [d.latestReportAt ? 'Latest form report ' + tm(d.latestReportAt) : 'No form reports', false],
        [d.pushedAt ? 'Issues refreshed ' + agoTxt(hrs(d.pushedAt)) : 'Issues not pushed from the Mac yet', !d.pushedAt || hrs(d.pushedAt) > 5],
        [feeLast ? 'Fee emails through ' + fmt(feeLast) : 'No fee emails', !feeLast || ago(feeLast) >= 2],
        [admLast ? 'Admission posts through ' + fmt(admLast) : 'No admission posts', false]];
      // Fee cycle: fees fall due on the 1st and the 1st-10th are "fee days", so outstanding jumps to its monthly high on day 1 and falls through the
      // fee days; the last day of the month is the true defaulter figure. So compare against the last month-end, never against a few days ago.
      const lk = n => '₹' + (n / 100000).toFixed(2) + ' L';
      const feeCycle = c => {
        const xs = fsAll.filter(x => x[1] === c); if (!xs.length) return null;
        const last = xs[xs.length - 1], monthStart = last[0].slice(0, 7) + '-01', inMonth = xs.filter(x => x[0] >= monthStart);
        const before = xs.filter(x => x[0] < monthStart).pop(), prev = before && (new Date(monthStart) - new Date(before[0])) / 86400000 <= 4 ? before : null; // an email from the last days of the previous month
        return { c: c, xs: xs, last: last, prev: prev, high: inMonth.reduce((m, x) => x[4] > m ? x[4] : m, 0), got: inMonth.reduce((t, x) => t + x[2], 0), fol: inMonth.reduce((t, x) => t + x[3], 0), day: +last[0].slice(8, 10) };
      };
      // What a principal wrote about fees left ("19 lakh left"), newest report first, from the form reports
      const principalFee = c => {
        const hit = reps.filter(r => r.campus === c).sort((a, b) => b.date.localeCompare(a.date)).map(r => {
          const m = (r.message + ' ' + r.done).match(/(\d+(?:\.\d+)?)\s*(?:lakh|lakhs|lac)\s+(?:left|pending|remaining|balance|outstanding|still)/i);
          return m ? { date: r.date, amount: parseFloat(m[1]) * 100000 } : null;
        }).filter(Boolean)[0];
        if (!hit) return null;
        const sys = fsAll.filter(x => x[1] === c && x[0] <= hit.date).pop();
        return { date: hit.date, amount: hit.amount, sys: sys ? sys[4] : null };
      };
      let html = '<div class="note pd-fresh">' + fresh.map(f => f[1] ? '<b class="stale">' + esc(f[0]) + '</b>' : esc(f[0])).join(' &middot; ') +
        (fresh.some(f => f[1]) ? '<br><span class="stale">A source looks out of date: the Mac sync (every 2 hours) or the fee email capture may have stopped.</span>' : '') + '</div>' +
        '<div class="tiles">' +
        '<div class="tile ' + (todo.length ? 'warn' : '') + '"><b>' + todo.length + '</b>need action, not yet acknowledged</div>' +
        '<div class="tile"><b>' + openAct.filter(i => i.handled).length + '</b>acknowledged or assigned</div>' +
        '<div class="tile ' + (open.some(i => i.stuck) ? 'bad' : '') + '"><b>' + open.filter(i => i.stuck).length + '</b>open for ' + STUCK_DAYS + '+ days</div>' +
        '<div class="tile"><b>' + open.filter(i => ago(i.first) <= 7).length + '</b>new this week</div>' +
        '<div class="tile"><b>' + (lastDay ? camps.filter(c => !has[lastDay + '|' + c]).length : 0) + '</b>campuses silent on ' + (lastDay ? fmt(lastDay) : '-') + '</div></div>' +
        '<div class="ctl"><span class="seg">' + [['today', 'Today'], ['digest', 'Weekly digest'], ['issues', 'Issues'], ['compliance', 'Who reported'], ['repeats', 'Repeat text'], ['fees', 'Fees'], ['admissions', 'Admissions'], ['messages', 'Messages'], ['registers', 'Registers'], ['assembly', 'Morning assembly']].map(x =>
          '<button data-tab="' + x[0] + '" class="' + (P.tab === x[0] ? 'on' : '') + '">' + x[1] + '</button>').join('') + '</span></div>';

      const chip = i => !i.act || i.act.status === 'open' ? '' : i.reopened ? '<span class="miss">Raised again after resolved</span>' : i.act.status === 'assigned' ? 'Assigned to <b>' + esc(i.act.assigneeName || i.act.assignee) + '</b>' : i.act.status === 'acknowledged' ? 'Acknowledged' : 'Resolved';
      const editor = i => '<details class="pd-edit" data-id="' + i.id + '"><summary>' + (chip(i) || 'Acknowledge / assign') + '</summary>' +
        '<div style="display:flex;flex-direction:column;gap:6px;width:230px;padding:8px 0 4px">' +
        '<select class="pd-as" style="width:100%">' + [['acknowledged', 'Acknowledge'], ['assigned', 'Assign to'], ['resolved', 'Resolved'], ['open', 'Reset']].map(x => '<option value="' + x[0] + '"' + (i.act && i.act.status === x[0] ? ' selected' : '') + '>' + x[1] + '</option>').join('') + '</select>' +
        '<select class="pd-who" style="width:100%">' + people.map(c => '<option value="' + esc(c.email) + '"' + (i.act && i.act.assignee === c.email ? ' selected' : '') + '>' + esc(c.name || c.email) + '</option>').join('') + '</select>' +
        '<input class="pd-note" placeholder="Note (optional)" value="' + esc(i.act ? i.act.note : '') + '" style="width:100%;box-sizing:border-box">' +
        '<div><button class="btn pd-save">Save</button> <span class="sm pd-msg">' + (i.act && i.act.by ? 'last by ' + esc(i.act.by.split('@')[0]) + ', ' + esc(i.act.at) : '') + '</span></div>' +
        '<div class="pd-mrg" style="border-top:1px solid #e5e7eb;padding-top:8px"><div class="sm" style="margin-bottom:4px">Same problem as:</div>' +
        '<select class="pd-mt" style="width:100%;margin-bottom:6px"><option value="">pick another issue...</option>' +
        issues.filter(o => o.id !== i.id && o.campus === i.campus).sort((a, b) => b.last.localeCompare(a.last)).slice(0, 40).map(o => '<option value="' + o.id + '">' + esc(o.subject) + ' (' + esc(o.type) + ', ' + fmt(o.last) + ')</option>').join('') + '</select>' +
        '<button class="btn pd-merge">Merge this into it</button>' +
        (i.kids.length ? '<div class="sm" style="margin-top:6px">Includes: ' + i.kids.map(k => esc(k.subject) + ' <a href="#" class="pd-unmerge" data-src="' + k.id + '">undo</a>').join(', ') + '</div>' : '') + '</div></div></details>';
      const issueRow = (i, hide) => '<tr data-id="' + i.id + '">' + (hide === 'campus' ? '' : '<td><b>' + i.campus + '</b></td>') + (hide === 'type' ? '' : '<td>' + esc(i.type) + '</td>') + '<td>' + (i.needsAction ? '<span class="miss">' + esc(i.subject) + '</span>' : esc(i.subject)) + '</td><td>' + fmt(i.first) + '</td><td>' + fmt(i.last) + '</td><td>' + i.count + (i.count >= 3 ? ' <span class="stale">repeat</span>' : '') + '</td><td>' +
        (i.open ? (i.stuck ? '<span class="miss">Open ' + (i.span + i.age) + ' days</span>' : 'Open') : '<span class="sm">Quiet ' + i.age + ' days</span>') + '</td><td class="sm"><details><summary>' + i.items.length + ' mention' + (i.items.length > 1 ? 's' : '') + '</summary>' +
        i.items.map(t => fmt(t.date) + ': ' + esc(t.text) + (t.from ? ' <span class="sm">(' + esc(t.from) + ')</span>' : '')).join('<br>') + '</details></td><td class="sm" style="vertical-align:top">' + editor(i) + '</td></tr>';
      const issueTable = (list, hide) => '<div class="tw"><table class="l"><thead><tr>' + (hide === 'campus' ? '' : '<th>Campus</th>') + (hide === 'type' ? '' : '<th>Type</th>') + '<th>Subject</th><th>First</th><th>Last</th><th>Days raised</th><th>Status</th><th>Principal wrote</th><th>Action</th></tr></thead><tbody>' +
        (list.map(i => issueRow(i, hide)).join('') || '<tr><td colspan="9">Nothing matches.</td></tr>') + '</tbody></table></div>';
      const byAge = (a, b) => (a.handled - b.handled) || (b.needsAction - a.needsAction) || (b.span + b.age) - (a.span + a.age);

      // Filters, sort and grouping shared by Today and Issues
      const SORTS = { age: ['Longest open first', byAge], recent: ['Most recently mentioned', (a, b) => b.last.localeCompare(a.last) || byAge(a, b)],
        repeat: ['Most repeated', (a, b) => b.count - a.count || byAge(a, b)], campus: ['School', (a, b) => a.campus.localeCompare(b.campus, undefined, { numeric: true }) || byAge(a, b)],
        type: ['Type', (a, b) => a.type.localeCompare(b.type) || byAge(a, b)] };
      const sel = (cls, label, opts, cur) => '<select class="' + cls + '"><option value="">' + label + '</option>' + opts.map(o => '<option' + (Array.isArray(o) ? ' value="' + o[0] + '"' + (cur === o[0] ? ' selected' : '') + '>' + esc(o[1]) : (cur === o ? ' selected' : '') + '>' + esc(o)) + '</option>').join('') + '</select>';
      const filterBar = full => '<div class="ctl">' + sel('pd-campus', 'All schools', camps, P.campus) + sel('pd-itype', 'All types', issueTypes, P.itype) +
        (full ? '<span class="seg">' + [['open', 'Open'], ['all', 'Open and quiet']].map(x => '<button data-st="' + x[0] + '" class="' + (P.istatus === x[0] ? 'on' : '') + '">' + x[1] + '</button>').join('') + '</span>' : '') +
        '<select class="pd-whof"><option value="">Anyone</option><option value="me"' + (P.who === 'me' ? ' selected' : '') + '>Assigned to me</option><option value="none"' + (P.who === 'none' ? ' selected' : '') + '>Not yet handled</option></select>' +
        '<label>Sort <select class="pd-sort">' + Object.keys(SORTS).map(k => '<option value="' + k + '"' + (P.sort === k ? ' selected' : '') + '>' + SORTS[k][0] + '</option>').join('') + '</select></label>' +
        '<label>Group by <select class="pd-group"><option value="">Nothing</option><option value="campus"' + (P.group === 'campus' ? ' selected' : '') + '>School</option><option value="type"' + (P.group === 'type' ? ' selected' : '') + '>Type</option></select></label>' +
        (full ? '<label><input type="checkbox" class="pd-act"' + (P.act ? ' checked' : '') + '> needs action only</label> ' : '') + '<label><input type="checkbox" class="pd-rep"' + (P.repeat ? ' checked' : '') + '> raised 3+ days</label></div>';
      const applyFilters = (list, full) => list.filter(i => (!full || P.istatus === 'all' || i.open) && (!P.campus || i.campus === P.campus) && (!P.itype || i.type === P.itype) && (!full || !P.act || i.needsAction) && (!P.repeat || i.count >= 3) &&
        (!P.who || (P.who === 'me' ? !!i.act && i.act.assignee === me : !i.handled))).sort(SORTS[P.sort][1]);
      const grouped = list => {
        if (!list.length) return issueTable(list);
        if (!P.group) return issueTable(list.slice(0, 150)) + (list.length > 150 ? '<div class="note">Showing the first 150 of ' + list.length + '. Narrow it with the filters above.</div>' : '');
        const g = {}; list.forEach(i => { const k = P.group === 'campus' ? i.campus : i.type; (g[k] = g[k] || []).push(i); });
        return Object.keys(g).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(k => '<h3 style="font-size:14px;margin:20px 0 6px">' + esc(k) + ' <span class="sm" style="font-weight:400">' + g[k].length + ' issue' + (g[k].length > 1 ? 's' : '') + ', ' + g[k].filter(i => !i.handled).length + ' not yet handled</span></h3>' + issueTable(g[k], P.group)).join('');
      };
      // One day's reports (full text), loaded on request; the page itself only carries counts
      const dayKey = P.day || lastDay;
      let dayRep = P.days[dayKey];
      if (P.tab === 'today' && dayKey && dayRep === undefined) {
        P.days[dayKey] = dayRep = null; // null = loading
        api({ action: 'coordinatorpdrday', date: dayKey }).then(r => { P.days[dayKey] = r.reports || []; render(); }).catch(err => { P.days[dayKey] = { error: err.message }; render(); });
      }
      const dayView = () => {
        if (!dayKey) return '';
        const i = days.indexOf(dayKey), prev = days.filter(x => x < dayKey).pop(), next = days.filter(x => x > dayKey)[0];
        const doneC = camps.filter(c => has[dayKey + '|' + c]), silentC = camps.filter(c => !has[dayKey + '|' + c]);
        const lines = t => esc(t).split(/;\s*/).filter(Boolean).join('<br>');
        const field = (label, t) => t && String(t).trim() ? '<div style="margin-top:6px"><b>' + label + '</b><div>' + lines(t) + '</div></div>' : '';
        const cards = Array.isArray(dayRep) ? dayRep.map(r => '<details class="pd-edit"><summary><b>' + r.campus + '</b> <span class="sm">' + esc(r.principal.indexOf('users/') === 0 ? '' : r.principal.split('@')[0]) + (r.principal.indexOf('users/') === 0 ? '' : ' &middot; ') + esc(r.source) + (r.at ? ' &middot; ' + esc(r.at) : '') + '</span></summary><div style="padding:6px 0 10px 14px;font-size:12px">' +
          field('Tasks completed', r.done) + field('Tasks for tomorrow', r.tomorrow) + field('Registers crosschecked', r.registers) + field('Important message', r.message) + (r.maClass || r.maScore ? field('Morning assembly', (r.maClass || '') + (r.maScore ? ', mark ' + r.maScore : '')) : '') + '</div></details>').join('') : '';
        return '<h3 style="font-size:13px;margin:16px 0 6px">Reports for a day</h3><div class="ctl">' +
          '<button class="btn pd-dprev"' + (prev ? '' : ' disabled') + '>&larr; ' + (prev ? fmt(prev) : '') + '</button><input type="date" class="pd-dayin" value="' + dayKey + '" min="' + (days[0] || '') + '" max="' + today + '">' +
          '<button class="btn pd-dnext"' + (next ? '' : ' disabled') + '>' + (next ? fmt(next) : '') + ' &rarr;</button>' + (P.day && P.day !== lastDay ? '<button class="btn pd-dlatest">Latest day</button>' : '') +
          '<span class="sm">' + fmt(dayKey) + (dayKey === today ? ' (today so far; reports come in through the day)' : '') + '</span></div>' +
          (days.indexOf(dayKey) === -1 && !doneC.length ? '<p class="sm">No reports were filed on this day (a Sunday, a holiday, or before the first report).</p>' :
            '<p>' + doneC.map(c => '<span class="pl later">&#10003; ' + c + '</span> ').join('') + silentC.map(c => '<span class="pl expired">' + c + ' did not report</span> ').join('') + '</p>' +
            (dayRep === null ? '<div class="status">Loading the reports...</div>' : dayRep && dayRep.error ? '<div class="status">Could not load that day: ' + esc(dayRep.error) + '</div>' : cards || '<p class="sm">No report text on file for this day.</p>'));
      };

      if (P.tab === 'today') {
        const list = applyFilters(openAct, false);
        html += '<div class="note">' + sinceNote + ' An issue stays open while a principal keeps mentioning it, and goes quiet after ' + QUIET_DAYS + ' days without a mention.</div>' + dayView() +
          '<h3 style="font-size:13px;margin:22px 0 6px">Open and needing action (' + list.length + (list.length !== openAct.length ? ' of ' + openAct.length : '') + ')</h3>' + filterBar(false) + grouped(list);
      } else if (P.tab === 'digest') {
        const inWk = iso => ago(iso) >= 1 && ago(iso) <= 7, inPrev = iso => ago(iso) >= 8 && ago(iso) <= 14; // completed days only: today's reports are still coming in
        const yday = (() => { const y = new Date(today + 'T00:00:00'); y.setDate(y.getDate() - 1); return y.getFullYear() + '-' + ('0' + (y.getMonth() + 1)).slice(-2) + '-' + ('0' + y.getDate()).slice(-2); })();
        const wkDays = days.filter(inWk), prevDays = days.filter(inPrev);
        const filedIn = ds => ds.reduce((t, x) => t + camps.filter(c => has[x + '|' + c]).length, 0), pct = (a, b) => b ? Math.round(100 * a / b) + '%' : '-';
        const filedWk = filedIn(wkDays), expWk = wkDays.length * camps.length, filedPrev = filedIn(prevDays), expPrev = prevDays.length * camps.length;
        const missedWk = camps.map(c => [c, wkDays.filter(x => !has[x + '|' + c]).length]).filter(x => x[1] >= 2).sort((a, b) => b[1] - a[1]);
        const sumF = (xs, a, b, i) => xs.filter(x => ago(x[0]) >= a && ago(x[0]) <= b).reduce((t, x) => t + x[i], 0);
        const feeRows = CAMPUSES.map(feeCycle).filter(Boolean).map(f => ({ c: f.c, got: sumF(f.xs, 1, 7, 2), prev: sumF(f.xs, 8, 14, 2), fol: sumF(f.xs, 1, 7, 3), out: f.last[4], vsEnd: f.prev ? f.last[4] - f.prev[4] : null }));
        const newWk = issues.filter(i => ago(i.first) <= 7 && i.open).sort(byAge);
        const resolvedWk = issues.filter(i => i.act && i.act.status === 'resolved' && ago(i.act.at.slice(0, 10)) <= 7);
        const stuck = open.filter(i => i.stuck).sort((a, b) => (b.span + b.age) - (a.span + a.age));
        const focus = openAct.filter(i => !i.handled && i.type !== 'Events' && (i.count >= 2 || i.age <= 3)).sort((a, b) => (b.span + b.age) - (a.span + a.age)).slice(0, 6);
        const line = i => i.campus + ' ' + i.subject + ' (' + i.type + '): open ' + (i.span + i.age) + ' days, raised on ' + i.count + (i.count === 1 ? ' day' : ' days') + (i.act && i.act.status === 'assigned' ? ', assigned to ' + (i.act.assigneeName || i.act.assignee) : i.handled ? ', acknowledged' : ', not yet acknowledged');
        const totWk = fsAll.length ? feeRows.reduce((t, r) => t + r.got, 0) : 0, totPrev = feeRows.reduce((t, r) => t + r.prev, 0), totOut = feeRows.reduce((t, r) => t + r.out, 0), totD = feeRows.reduce((t, r) => t + (r.vsEnd || 0), 0), feeDay = feeRows.length ? feeCycle(feeRows[0].c).day : 0;
        const txt = ['Principals\' reports: week to ' + fmt(yday), '',
          'Reports filed: ' + filedWk + ' of ' + expWk + ' (' + pct(filedWk, expWk) + '), last week ' + pct(filedPrev, expPrev) + '.' + (missedWk.length ? ' Missed 2+ days: ' + missedWk.map(x => x[0] + ' (' + x[1] + ')').join(', ') + '.' : ''),
          'Issues: ' + newWk.length + ' new, ' + resolvedWk.length + ' resolved, ' + todo.length + ' open and not yet acknowledged, ' + stuck.length + ' open for ' + STUCK_DAYS + '+ days.', '',
          'Needs attention first:'].concat(focus.map(i => '- ' + line(i)), focus.length ? [] : ['- nothing unacknowledged'], ['',
          fsAll.length ? 'Fees: ' + lk(totWk) + ' collected this week (' + lk(totPrev) + ' last week); outstanding ' + lk(totOut) + ', ' + lk(Math.abs(totD)) + (totD > 0 ? ' above' : ' below') + ' the last month-end (the true defaulters)' + (feeDay <= 10 ? '; fee days, day ' + feeDay + ' of 10, so it is expected to fall' : '') + '; ' + feeRows.reduce((t, r) => t + r.fol, 0) + ' follow-ups logged.' : 'Fees: no fee emails.']).concat(feeRows.map(r => '  ' + r.c + ': collected ' + lk(r.got) + ', outstanding ' + lk(r.out) + ', ' + r.fol + ' follow-ups'));
        html += '<div class="ctl"><button class="btn pd-copy">Copy digest</button> <span class="sm">The 7 completed days to ' + fmt(yday) + ', compared with the 7 before. Every figure is calculated from the data on this page. Fees: outstanding jumps to a monthly high on the 1st and falls through the fee days (1st-10th), so it is compared with the last month-end.</span></div>' +
          '<div class="tiles"><div class="tile"><b>' + pct(filedWk, expWk) + '</b>of expected reports filed<span class="sm"> (last week ' + pct(filedPrev, expPrev) + ')</span></div>' +
          '<div class="tile"><b>' + newWk.length + '</b>new issues</div><div class="tile"><b>' + resolvedWk.length + '</b>resolved</div>' +
          (fsAll.length ? '<div class="tile"><b>' + lk(totWk) + '</b>fees collected<span class="sm"> (last week ' + lk(totPrev) + ')</span></div>' : '') + '</div>' +
          '<h3 style="font-size:13px;margin:16px 0 6px">Needs attention first (open, needs action, not yet acknowledged)</h3>' + issueTable(focus) +
          '<h3 style="font-size:13px;margin:16px 0 6px">Reporting gaps this week</h3><p>' + (missedWk.length ? missedWk.map(x => '<span class="pl expired">' + x[0] + ': missed ' + x[1] + ' of ' + wkDays.length + ' days</span> ').join('') : 'No campus missed more than one reporting day.') + '</p>' +
          '<h3 style="font-size:13px;margin:16px 0 6px">New this week (' + newWk.length + ')</h3>' + issueTable(newWk.slice(0, 8)) +
          (feeRows.length ? '<h3 style="font-size:13px;margin:16px 0 6px">Fees</h3><div class="tw"><table class="l"><thead><tr><th>Campus</th><th>Collected, 7 days</th><th>Last week</th><th>Outstanding now</th><th>Vs last month-end</th><th>Follow-ups logged</th></tr></thead><tbody>' +
            feeRows.map(r => '<tr><td><b>' + r.c + '</b></td><td>' + lk(r.got) + '</td><td>' + lk(r.prev) + '</td><td>' + lk(r.out) + '</td><td>' + (r.vsEnd === null ? '-' : (r.vsEnd > 0 ? '+' : r.vsEnd < 0 ? '-' : '') + lk(Math.abs(r.vsEnd))) + '</td><td>' + r.fol + '</td></tr>').join('') + '</tbody></table></div>' : '');
        box.dataset.digest = txt.join('\n');
      } else if (P.tab === 'issues') {
        const shown = applyFilters(issues, true);
        html += '<div class="note">' + sinceNote + ' Issues are grouped by campus, type and subject from the principals\' Important Messages; the same subject raised again after ' + QUIET_DAYS + '+ quiet days counts as a new issue. The grouping is by wording, so the same problem described differently can appear twice (use "Same problem as" to merge them). Showing ' + shown.length + ' of ' + issues.length + '.</div>' +
          filterBar(true) + grouped(shown);
      } else if (P.tab === 'compliance') {
        const mons = [...new Set(days.map(x => x.slice(0, 7)))];
        html += '<div class="note">Reports filed per month (Google Spaces group until 22 Sep, the form after). A reporting day is any non-Sunday on which at least one campus filed; a campus closed on its own would show as missed.</div>' +
          '<div class="tw"><table class="l"><thead><tr><th>Campus</th>' + mons.map(m => '<th>' + MONTHS[+m.slice(5) - 1] + '</th>').join('') + '</tr></thead><tbody>' +
          camps.map(c => '<tr><td><b>' + c + '</b></td>' + mons.map(m => { const n = days.filter(x => x.slice(0, 7) === m && has[x + '|' + c]).length, tot = days.filter(x => x.slice(0, 7) === m).length; return '<td class="dt ' + (n === 0 ? 'expired' : n < tot / 2 ? 'soon' : '') + '">' + n + '<span class="sm"> / ' + tot + '</span></td>'; }).join('') + '</tr>').join('') + '</tbody></table></div>' +
          '<h3 style="font-size:13px;margin:16px 0 6px">Last ' + last.length + ' reporting days</h3><div class="tw"><table class="l"><thead><tr><th>Campus</th>' + last.map(x => '<th>' + fmt(x) + '</th>').join('') + '<th>Missed since Jan</th></tr></thead><tbody>' +
          camps.map(c => '<tr><td><b>' + c + '</b></td>' + last.map(x => has[x + '|' + c] ? '<td>&#10003;</td>' : '<td class="dt expired">-</td>').join('') + '<td class="' + (missed(c) > days.length / 4 ? 'miss' : '') + '">' + missed(c) + ' of ' + days.length + '</td></tr>').join('') + '</tbody></table></div>';
      } else if (P.tab === 'repeats') {
        const rp = (d.repeats || []).filter(x => x.tasks !== null), THR = 70;
        const rows = camps.map(c => {
          const xs = rp.filter(x => x.campus === c), hit = xs.filter(x => x.tasks >= THR), rec = xs.filter(x => ago(x.date) <= 30), recHit = rec.filter(x => x.tasks >= THR), lastHit = hit.length ? hit[hit.length - 1].date : '';
          return '<tr><td><b>' + c + '</b></td><td>' + xs.length + '</td><td>' + hit.length + ' <span class="sm">(' + (xs.length ? Math.round(100 * hit.length / xs.length) : 0) + '%)</span></td><td class="' + (recHit.length >= 3 ? 'miss' : '') + '">' + recHit.length + ' of ' + rec.length + '</td><td class="sm">' + (lastHit ? fmt(lastHit) : '-') + '</td></tr>';
        }).join('');
        const recent = rp.filter(x => ago(x.date) <= 30 && x.tasks >= THR).sort((a, b) => b.date.localeCompare(a.date) || a.campus.localeCompare(b.campus));
        html += '<div class="note">How much of a report\'s "tasks completed" wording also appears in the same campus\'s <b>previous report</b> (a run of three words counts as shared, so reordering does not hide a copy). ' + THR + '% or more is shown as copied. ' +
          'This cannot tell a lazy copy from a legitimate repeat, for example exam duty every day during exams, so treat it as a prompt to look, not a verdict. ' + (d.pushedAt ? 'Refreshed with the Mac sync.' : '') + '</div>' +
          '<div class="tw"><table class="l"><thead><tr><th>Campus</th><th>Reports compared</th><th>' + THR + '%+ copied (since Jan)</th><th>Last 30 days</th><th>Last copied</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
          '<h3 style="font-size:13px;margin:16px 0 6px">Copied reports in the last 30 days (' + recent.length + ')</h3><div class="tw"><table class="l"><thead><tr><th>Date</th><th>Campus</th><th>Tasks the same as</th><th>Message the same</th><th>Tasks written</th></tr></thead><tbody>' +
          (recent.map(x => '<tr><td>' + fmt(x.date) + '</td><td>' + x.campus + '</td><td class="' + (x.tasks >= 90 ? 'miss' : '') + '">' + x.tasks + '% of ' + fmt(x.prev) + '</td><td>' + (x.message === null ? '-' : x.message + '%') + '</td><td class="sm">' + esc(x.sample) + '</td></tr>').join('') || '<tr><td colspan="5">None in the last 30 days.</td></tr>') + '</tbody></table></div>';
      } else if (P.tab === 'fees') {
        const cyc = CAMPUSES.map(feeCycle), day = cyc.find(Boolean) ? cyc.find(Boolean).day : 0, ym = fsAll.length ? fsAll[fsAll.length - 1][0].slice(0, 7) : '';
        const rows = CAMPUSES.map((c, i) => {
          const f = cyc[i];
          if (!f) return '<tr><td><b>' + c + '</b></td><td colspan="7" class="sm">No fee emails received from this campus</td></tr>';
          const pf = principalFee(c), recovered = f.high - f.last[4];
          return '<tr><td><b>' + c + '</b></td><td>' + lk(f.last[4]) + '</td><td>' + (f.prev ? lk(f.prev[4]) + ' <span class="sm">(' + fmt(f.prev[0]) + ')</span>' : '-') + '</td><td>' + lk(f.high) + '</td><td>' +
            lk(recovered) + ' <span class="sm">(' + (f.high ? Math.round(100 * recovered / f.high) : 0) + '%)</span></td><td>' + lk(f.got) + '</td><td class="' + (f.fol < 5 && day > 10 ? 'miss' : '') + '">' + f.fol + '</td><td>' +
            (pf ? lk(pf.amount) + ' <span class="sm">(' + fmt(pf.date) + ')</span>' + (pf.sys !== null ? '<br><span class="sm">system that day: ' + lk(pf.sys) + '</span>' : '') : '<span class="sm">-</span>') + '</td></tr>';
        }).join('');
        // true defaulters at each completed month-end: the last email of the month, if it is from its final days
        const months = [...new Set(fsAll.map(x => x[0].slice(0, 7)))].filter(m => m < ym);
        const endVal = (c, m) => { const e = fsAll.filter(x => x[1] === c && x[0].slice(0, 7) === m).pop(); return e && +e[0].slice(8, 10) >= 27 ? e[4] : null; };
        const trend = CAMPUSES.map(c => { if (!cyc[CAMPUSES.indexOf(c)]) return ''; const vals = months.map(m => endVal(c, m));
          return '<tr><td><b>' + c + '</b></td>' + vals.map((v, i) => '<td>' + (v === null ? '<span class="sm">no email</span>' : lk(v) + (i && vals[i - 1] !== null ? ' <span class="' + (v > vals[i - 1] ? 'miss' : 'sm') + '">(' + (v > vals[i - 1] ? '+' : '-') + lk(Math.abs(v - vals[i - 1])) + ')</span>' : '')) + '</td>').join('') + '</tr>'; }).join('');
        html += '<div class="note">Fees follow a monthly cycle: they fall due on the 1st, the 1st to the 10th are fee days, so <b>outstanding jumps to its monthly high on day 1 and falls through the fee days</b>. ' +
          'The last day of the month is the true defaulter figure, so that is what to compare. ' + (day && day <= 10 ? 'Today is day ' + day + ' of the fee days, so outstanding is expected to be falling.' : 'The fee days are over, so outstanding now should be close to the true defaulters.') +
          ' "Follow-ups" is what the fee system logged, which can differ from what a principal reports doing. "Principal says" is the latest figure a principal wrote in the form, next to the fee system\'s figure the same day.' +
          (d.fees && d.fees.error ? ' <b class="stale">Could not read the fee sheet: ' + esc(d.fees.error) + '</b>' : '') + '</div>' +
          '<div class="tw"><table class="l"><thead><tr><th>Campus</th><th>Outstanding now</th><th>Last month-end (true defaulters)</th><th>Highest this month</th><th>Recovered since the high</th><th>Collected this month</th><th>Follow-ups this month</th><th>Principal says</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
          (months.length ? '<h3 style="font-size:13px;margin:16px 0 6px">True defaulters at each month-end</h3><div class="tw"><table class="l"><thead><tr><th>Campus</th>' + months.map(m => '<th>' + MONTHS[+m.slice(5) - 1] + ' ' + m.slice(0, 4) + '</th>').join('') + '</tr></thead><tbody>' + trend + '</tbody></table></div>' +
            '<div class="note">Red means higher than the month before. A month shows "no email" when the fee system sent nothing in its last days.</div>' : '');
      } else if (P.tab === 'admissions') {
        const ad = d.admissions || [], MONT = ['M-I', 'M-II', 'M-III'];
        const rows = CAMPUSES.map(c => {
          const xs = ad.filter(x => x.campus === c).sort((a, b) => a.date.localeCompare(b.date));
          if (!xs.length) return '<tr><td><b>' + c + '</b></td><td colspan="7" class="sm">No admission status posts from this campus</td></tr>';
          const f = xs[0], l = xs[xs.length - 1], by = k => (l.byClass[k] ? l.byClass[k].admitted + l.byClass[k].registered : 0);
          const mont = MONT.reduce((t, k) => t + by(k), 0), weeks = Math.max(1, (new Date(l.date) - new Date(f.date)) / 604800000);
          return '<tr><td><b>' + c + '</b></td><td>' + l.total + '</td><td>' + mont + ' <span class="sm">(' + by('M-II') + ' in M-II)</span></td><td>' + (l.total - mont) + '</td><td>' + (l.registered || 0) + '</td><td>' + (l.tc === null ? '-' : l.tc) + '</td><td>' + ((l.total - f.total) / weeks).toFixed(1) + '<span class="sm"> a week</span></td><td class="sm">' + fmt(f.date) + ' to ' + fmt(l.date) + '</td></tr>';
        }).join('');
        const adIssues = issues.filter(i => i.type === 'Admissions').sort((a, b) => b.last.localeCompare(a.last)).slice(0, 12);
        html += '<div class="note">Admission session 2026-27, from the daily status posts the campuses made in the WhatsApp admissions group (counts only). Posts ran 1 Apr to 2 Jul and most campuses stopped by early May, so these are the position at each campus\'s last post, not today. The next session\'s admissions need a structured field in the principals\' report (on the form to-do list).</div>' +
          '<div class="tw"><table class="l"><thead><tr><th>Campus</th><th>Admitted (last post)</th><th>Montessori wing</th><th>Classes</th><th>Registered, not yet admitted</th><th>TCs issued</th><th>Pace</th><th>Posts covered</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
          '<h3 style="font-size:13px;margin:16px 0 6px">Admission items in the principals\' reports (latest 12, all year)</h3>' + issueTable(adIssues);
      } else if (P.tab === 'messages') {
        const shown = msgs.filter(m => (!P.topic || m.t.topics.indexOf(P.topic) !== -1) && (!P.act || m.t.action) && (!P.campus || m.r.campus === P.campus));
        html += '<div class="note">Form reports since 23 Sep, with the local model\'s topics and one-line summary (refreshed when the Mac syncs' + (d.taggedAt ? '; last ' + esc(d.taggedAt.slice(0, 10)) : '') + '); the principal\'s own words are in the last column.</div>' +
          '<div class="ctl"><select class="pd-campus"><option value="">All campuses</option>' + camps.map(c => '<option' + (P.campus === c ? ' selected' : '') + '>' + c + '</option>').join('') + '</select>' +
          '<select class="pd-topic"><option value="">All topics</option>' + topics.map(t => '<option' + (P.topic === t ? ' selected' : '') + '>' + esc(t) + '</option>').join('') + '</select>' +
          '<label><input type="checkbox" class="pd-act"' + (P.act ? ' checked' : '') + '> needs action only</label></div>' +
          '<div class="tw"><table class="l"><thead><tr><th>Date</th><th>Campus</th><th>Topics</th><th>Summary</th><th>Principal wrote</th></tr></thead><tbody>' +
          (shown.map(m => '<tr><td>' + fmt(m.r.date) + '</td><td>' + m.r.campus + '</td><td>' + (m.t.action ? '<span class="miss">Action</span> ' : '') + esc(m.t.topics.join(', ')) + '</td><td>' + esc(m.t.summary) + '</td><td class="sm">' + esc(m.r.message) + '</td></tr>').join('') || '<tr><td colspan="5">Nothing matches.</td></tr>') +
          '</tbody></table></div>';
      } else if (P.tab === 'registers') {
        const all = {}; reps.forEach(r => r.registers.split(/,\s*/).filter(Boolean).forEach(x => { all[x] = (all[x] || 0) + 1; }));
        const names = Object.keys(all).sort((a, b) => all[b] - all[a]);
        const n = {}; camps.forEach(c => { n[c] = reps.filter(r => r.campus === c).length; });
        const pct = (x, c) => n[c] ? Math.round(100 * reps.filter(r => r.campus === c && r.registers.split(/,\s*/).indexOf(x) !== -1).length / n[c]) : 0;
        html += '<div class="note">Form reports since 23 Sep. Share of each campus\'s reports in which the principal ticked the register as crosschecked. The list is every register seen in any report, so one nobody has ever ticked cannot appear.</div>' +
          '<div class="tw"><table class="l"><thead><tr><th>Register</th>' + camps.map(c => '<th>' + c + '</th>').join('') + '</tr></thead><tbody>' +
          '<tr><td class="sm">Reports filed</td>' + camps.map(c => '<td class="sm">' + n[c] + '</td>').join('') + '</tr>' +
          names.map(x => '<tr><td>' + esc(x) + '</td>' + camps.map(c => { const p = pct(x, c); return '<td class="dt ' + (p === 0 ? 'expired' : p < 25 ? 'soon' : '') + '">' + p + '%</td>'; }).join('') + '</tr>').join('') + '</tbody></table></div>';
      } else {
        html += '<div class="note">Form reports since 23 Sep. How often the morning assembly mark is filled, and the average when it is. No assemblies are held during exams, so gaps there are expected.</div>' +
          '<div class="tw"><table class="l"><thead><tr><th>Campus</th><th>Reports</th><th>With a mark</th><th>Average mark</th><th>Class/house given</th></tr></thead><tbody>' +
          camps.map(c => { const rs = reps.filter(r => r.campus === c), m = rs.filter(r => r.maScore !== '' && !isNaN(+r.maScore)); return '<tr><td><b>' + c + '</b></td><td>' + rs.length + '</td><td class="' + (m.length < rs.length / 2 ? 'miss' : '') + '">' + m.length + '</td><td>' + (m.length ? (m.reduce((s, r) => s + +r.maScore, 0) / m.length).toFixed(1) : '-') + '</td><td class="sm">' + esc([...new Set(rs.map(r => r.maClass).filter(Boolean))].join(', ')) + '</td></tr>'; }).join('') + '</tbody></table></div>';
      }
      box.innerHTML = html;
      box.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { P.tab = b.dataset.tab; render(); }));
      box.querySelectorAll('[data-st]').forEach(b => b.addEventListener('click', () => { P.istatus = b.dataset.st; render(); }));
      const on = (sel, ev, fn) => { const el = box.querySelector(sel); if (el) el.addEventListener(ev, fn); };
      on('.pd-campus', 'change', e => { P.campus = e.target.value; render(); });
      on('.pd-topic', 'change', e => { P.topic = e.target.value; render(); });
      on('.pd-itype', 'change', e => { P.itype = e.target.value; render(); });
      on('.pd-act', 'change', e => { P.act = e.target.checked; render(); });
      on('.pd-rep', 'change', e => { P.repeat = e.target.checked; render(); });
      on('.pd-whof', 'change', e => { P.who = e.target.value; render(); });
      on('.pd-sort', 'change', e => { P.sort = e.target.value; render(); });
      on('.pd-group', 'change', e => { P.group = e.target.value; render(); });
      on('.pd-dayin', 'change', e => { P.day = e.target.value; render(); });
      on('.pd-dprev', 'click', () => { P.day = days.filter(x => x < dayKey).pop() || dayKey; render(); });
      on('.pd-dnext', 'click', () => { P.day = days.filter(x => x > dayKey)[0] || dayKey; render(); });
      on('.pd-dlatest', 'click', () => { P.day = ''; render(); });
      const mergeCall = async (source, target, msg) => {
        try {
          const res = await (await fetch(BACKEND_URL, { method: 'POST', body: JSON.stringify({ action: 'coordinatorpdrmerge', idToken: SESSION.idToken, source: source, target: target }) })).json();
          if (!res.success) throw new Error(res.error || 'Could not merge');
          P.data.merges = res.merges; render();
        } catch (err) { if (msg) msg.textContent = 'Not merged: ' + err.message; else alert('Could not undo the merge: ' + err.message); }
      };
      box.querySelectorAll('.pd-merge').forEach(btn => btn.addEventListener('click', () => {
        const ed = btn.closest('.pd-edit'), to = ed.querySelector('.pd-mt').value, msg = ed.querySelector('.pd-msg');
        if (!to) { msg.textContent = 'Pick the issue it is the same as first'; return; }
        btn.disabled = true; msg.textContent = 'Merging...'; mergeCall(ed.dataset.id, to, msg);
      }));
      box.querySelectorAll('.pd-unmerge').forEach(a => a.addEventListener('click', e => { e.preventDefault(); mergeCall(a.dataset.src, '', null); }));
      on('.pd-copy', 'click', e => { const b = e.target; navigator.clipboard.writeText(box.dataset.digest || '').then(() => { b.textContent = 'Copied'; }, () => { b.textContent = 'Could not copy'; }); setTimeout(() => { b.textContent = 'Copy digest'; }, 2000); });
      box.querySelectorAll('.pd-save').forEach(btn => btn.addEventListener('click', async () => {
        const ed = btn.closest('.pd-edit'), msg = ed.querySelector('.pd-msg'), id = ed.dataset.id;
        btn.disabled = true; msg.textContent = 'Saving...';
        try {
          const res = await (await fetch(BACKEND_URL, { method: 'POST', body: JSON.stringify({ action: 'coordinatorpdrissue', idToken: SESSION.idToken, id: id, status: ed.querySelector('.pd-as').value, assignee: ed.querySelector('.pd-who').value, note: ed.querySelector('.pd-note').value }) })).json();
          if (!res.success) throw new Error(res.error || 'Could not save');
          P.data.actions = P.data.actions || {}; P.data.actions[id] = res.action;
          render();
          if (res.taskError) alert('Saved, but the follow-up could not be created: ' + res.taskError);
        } catch (err) { msg.textContent = 'Not saved: ' + err.message; btn.disabled = false; }
      }));
    }
    load();
  }

  return { boot, tasksView, academicsView, documentsView, transportView, pdrView, counts, esc, DEPARTMENTS, setSession: function (s) { SESSION = s; }, canUse };
})();
