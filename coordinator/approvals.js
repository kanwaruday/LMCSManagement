/* Coordinator Portal -- Approvals (the Owner's / deciders' view of every school's approval requests).
   Moved here from the principals' page (principals-daily-reporting/index.html, 2026-10-08): that page now shows everyone only the principal's
   own interface (the request form + the selected school's requests). Same backend, same rules: apps-script/approvals.gs on the Principal's
   Daily Reporting backend decides who may decide (Owner always, a Coordinator only with the delegated box ticked), this file only draws it.
   Used by the Systems page as one tab: CoordApprovals.mount(element) -> the element then keeps its own state across tab switches.
   Click handling is delegated from one root listener (data-act attributes), so nothing here touches window globals. */
window.CoordApprovals = (function () {
  const PDR_URL = 'https://script.google.com/macros/s/AKfycbzpkFLy4KvTdSJfioz6wlgRGLjvO_GvbffhOYBb-hHybFtjGTk0ps-GzXz0FrQ9GmYdfg/exec';
  const CAMPUSES = ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6'];
  const CATEGORIES = ['New/ Backup Position', 'Salary Offer Approval', 'Compensation Change', 'Disciplinary / Termination', 'Compensatory Leave', 'Event / Invitation', 'Off-Campus Trip / Excursion', 'Holiday / Calendar', 'Financial / Purchase', 'Academic Change', 'EPF Exemption', 'Other'];
  const NO_REFER = ['Compensation Change', 'Disciplinary / Termination', 'Salary Offer Approval', 'EPF Exemption']; // keep in sync with approvals.gs
  const STATUS_PILLS = ['Needs Action', 'All', 'Pending', 'Info Requested', 'Approved', 'Rejected', 'Revoked'];
  const NEEDS = ['Pending', 'Info Requested'], DECIDED = ['Approved', 'Rejected', 'Revoked'];
  const REFER_KINDS = [['action', 'For Action'], ['accountability', 'For Accountability'], ['information', 'For Information']];
  const STALE_DAYS = 3;
  const FOLLOW_SKIP = ['New/ Backup Position', 'Salary Offer Approval']; // tracked in the Hiring dashboard, so no second follow-up here
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const isoDay = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const plusDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return isoDay(d); };
  const dueLabel = iso => { if (!iso) return ''; const d = new Date(iso + 'T00:00:00'); return d.getDate() + ' ' + MON[d.getMonth()]; };
  // where an approved request's follow-up stands: hiring (tracked elsewhere), na (not approved), none (nobody allocated), open, overdue, done
  const fuState = r => FOLLOW_SKIP.indexOf(r.category) !== -1 ? 'hiring' : r.status !== 'Approved' ? 'na' : !r.followUp ? 'none' : r.followUp.status === 'done' ? 'done' : (r.followUp.due && r.followUp.due < isoDay(new Date()) ? 'overdue' : 'open');

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ddmmyyyy = d => { if (!d) return '—'; const x = new Date(d); return String(x.getDate()).padStart(2, '0') + '/' + String(x.getMonth() + 1).padStart(2, '0') + '/' + x.getFullYear(); };
  const school = c => (window.LMCS && LMCS.campusLabel) ? LMCS.campusLabel(c) : c;
  const age = iso => { if (!iso) return '—'; const ms = Date.now() - new Date(iso).getTime(), d = Math.floor(ms / 86400000); if (d >= 1) return d + 'd ago'; const h = Math.floor(ms / 3600000); return h >= 1 ? h + 'h ago' : 'just now'; };
  const isStale = iso => iso && (Date.now() - new Date(iso).getTime()) / 86400000 >= STALE_DAYS;
  const pillClass = s => s === 'Approved' ? 'ok' : s === 'Rejected' ? 'none' : s === 'Revoked' ? 'revoked' : 'amber';

  const CSS = `
.apro{--g:#15803d;font-size:13px}
.apro .apro-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px}
.apro .picker{display:flex;gap:6px;flex-wrap:wrap}
.apro .rb{background:#fff;border:1.5px solid var(--border);border-radius:20px;padding:6px 14px;font-size:11.5px;font-weight:600;color:var(--gray);cursor:pointer}
.apro .rb.on{background:var(--red-lt,rgba(206,0,0,.07));border-color:var(--red);color:var(--red)}
.apro .rfr{border:1.5px solid var(--border);background:#fff;border-radius:6px;padding:6px;display:flex;align-items:center;cursor:pointer;color:var(--gray)}
.apro .rfr:hover{color:var(--red);border-color:var(--red)}
.apro .stbar{display:flex;align-items:center;gap:8px;font-size:11.5px;padding:7px 12px;border-radius:5px;margin:0 0 12px;background:var(--lgray);color:var(--gray);border:1px solid var(--border)}
.apro .stbar.ok{background:rgba(21,128,61,.08);color:#15803d;border-color:rgba(21,128,61,.3)}
.apro .stbar.err{background:#fdecec;color:var(--red);border-color:rgba(206,0,0,.3)}
.apro .stbar button{margin-left:auto;background:#fff;border:1px solid currentColor;color:inherit;border-radius:4px;padding:2px 9px;font-size:11px;cursor:pointer}
.apro .sp{width:11px;height:11px;border:2px solid var(--border);border-top-color:var(--red);border-radius:50%;animation:aprospin .8s linear infinite}
@keyframes aprospin{to{transform:rotate(360deg)}}
.apro .wrap{overflow-x:auto;border:1px solid var(--border);border-radius:6px}
.apro table{width:100%;border-collapse:collapse;font-size:12px}
.apro thead th{background:var(--red);color:#fff;padding:7px 12px;text-align:left;font-size:10px;font-weight:700;letter-spacing:.3px;text-transform:uppercase;white-space:nowrap;vertical-align:top;cursor:pointer}
.apro tbody tr{border-bottom:1px solid var(--border)}
.apro td{padding:6px 12px;vertical-align:middle;text-align:left}
.apro th{text-align:left}
.apro tbody tr.row:nth-child(even) td{background:#fafafa}
.apro tr.row{cursor:pointer}
.apro tr.row:hover td{background:var(--red-lt,rgba(206,0,0,.07))!important}
.apro tr.row.open td{background:var(--lgray)!important}
.apro tr.stale td{background:#fff8ed}
.apro .stalet{color:var(--amber);font-weight:700}
.apro .pill{display:inline-block;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700}
.apro .pill.ok{background:#dcfce7;color:#15803d}.apro .pill.none{background:#fee2e2;color:var(--red)}.apro .pill.amber{background:#fef3c7;color:var(--amber)}
.apro .pill.revoked{background:#e5e7eb;color:#4b5563}.apro .pill.urgent{background:#fee2e2;color:var(--red)}
.apro .detail td{padding:0}
.apro .dwrap{padding:12px 14px;background:var(--lgray)}
.apro .desc{font-size:12.5px;line-height:1.6;margin-bottom:8px;white-space:pre-wrap}
.apro .meta{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:11px;color:var(--gray);margin-bottom:10px}
.apro .cm{background:#fff;border:1px solid var(--border);border-radius:6px;padding:7px 10px;margin-bottom:6px;font-size:12px}
.apro .cm .cmm{font-size:10.5px;color:var(--gray);margin-bottom:3px}
.apro .cm a{color:#B7C0CC;text-decoration:none;font-weight:600}.apro .cm a:hover{color:var(--red)}
.apro .empty{font-size:11.5px;color:var(--gray);padding:6px 0}
.apro .dash-empty{padding:16px 12px;text-align:center;color:var(--gray)}
.apro input[type=text],.apro select{border:1.5px solid var(--border);border-radius:6px;padding:7px 9px;font-size:12.5px;font-family:inherit;background:#fff}
.apro .hsel{display:block;margin-top:4px;font-size:11px;padding:2px 4px;border-radius:4px;border:0;max-width:100%;color:#333}
.apro .addrow{display:flex;gap:8px}.apro .addrow input{flex:1}
.apro .addrow button,.apro .bar button{border:none;border-radius:6px;padding:8px 14px;font-size:12px;font-weight:700;cursor:pointer;color:#fff;background:var(--red)}
.apro .bar{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;align-items:center}
.apro .bar button.approve{background:var(--g)}.apro .bar button.reject{background:var(--red)}.apro .bar button.info{background:var(--amber)}.apro .bar button.revoke{background:#4b5563}
.apro .note{width:100%;margin-bottom:8px}
.apro .hint{font-size:11.5px;color:var(--amber);font-weight:600;margin:8px 0 4px}
.apro .chip{display:inline-block;background:#eee;border-radius:12px;padding:2px 10px;margin:0 6px 6px 0}
.apro .fu{margin:10px 0;padding:8px 10px;background:#fff;border:1px solid var(--border);border-radius:6px;font-size:12px}
.apro .fu .addrow{margin-top:6px;flex-wrap:wrap}.apro .fu .addrow input[type=date]{flex:0 0 auto}.apro .fu a{color:var(--red);margin-left:8px}
.apro .late{color:var(--red);font-weight:700}
.apro .menu{display:none;position:absolute;left:0;right:0;z-index:20;background:#fff;border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.15);max-height:220px;overflow:auto}
.apro .menu div{padding:7px 12px;cursor:pointer;font-size:13px}.apro .menu div:hover{background:var(--lgray)}
`;

  function mount(root, ctx) {
    ctx = ctx || {}; // ctx.people() -> coordinators you can allocate to, ctx.post(body) -> the Coordinator backend (retries a slow reply)
    if (!document.getElementById('apro-css')) { const st = document.createElement('style'); st.id = 'apro-css'; st.textContent = CSS; document.head.appendChild(st); }
    root.className = 'apro';
    root.innerHTML = '<div class="apro-bar"><div class="picker" data-slot="view"></div><div class="picker" data-slot="status"></div>' +
      '<button type="button" class="rfr" data-act="refresh" title="Refresh"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg></button></div>' +
      '<div class="stbar" data-slot="bar"></div><div data-slot="list"></div>';
    const $ = s => root.querySelector('[data-slot="' + s + '"]');
    const S = { res: null, status: 'Needs Action', cat: 'All', view: 'Requests', school: 'All', search: '', sortKey: null, sortDir: 1, fu: 'All', fuEdit: null, selected: {}, eligible: {}, openId: null, detail: null,
      refStaff: [], refNames: {}, refLoaded: false, refLoading: false, refErr: '', refs: {} };
    const sess = () => LMCS.getSession();

    const setBar = (state, text, retry) => { const b = $('bar'); b.className = 'stbar' + (state === 'loading' ? '' : ' ' + state); b.innerHTML = (state === 'loading' ? '<span class="sp"></span>' : '') + '<span>' + text + '</span>' + (retry ? '<button type="button" data-act="refresh">Retry</button>' : ''); };
    const authFail = res => { if (res && res.error === 'Not authorized' && window.LMCS && LMCS.notifyAuthFailure) LMCS.notifyAuthFailure(); };
    async function getJson(url, tries) {
      tries = tries || 3;
      for (let i = 1; ; i++) {
        try { return JSON.parse(await fetch(url).then(r => r.text())); }
        catch (err) { if (i >= tries) throw err; setBar('loading', 'Backend is slow — retrying (' + (i + 1) + '/' + tries + ')…'); await new Promise(ok => setTimeout(ok, 1500 * i)); }
      }
    }
    const get = (q) => getJson(PDR_URL + '?' + q + '&idToken=' + encodeURIComponent(sess().idToken));
    async function post(action, body) {
      try { return await fetch(PDR_URL, { method: 'POST', body: JSON.stringify(Object.assign({ action: action, idToken: sess().idToken }, body)) }).then(r => r.json()); }
      catch (err) { return { success: false, error: String(err) }; }
    }

    async function load() {
      setBar('loading', 'Loading approvals…');
      try {
        const res = await get('action=approvalslist');
        if (!res.success) { $('list').innerHTML = '<div class="dash-empty">Couldn’t load Approvals: ' + esc(res.error || 'unknown error') + '</div>'; setBar('err', 'Couldn’t load approvals: ' + esc(res.error || 'unknown error'), true); authFail(res); return; }
        S.res = res;
        if (res.canDecide) loadReferees();
        renderPickers(); renderList();
        const needs = res.requests.filter(r => NEEDS.indexOf(r.status) !== -1).length;
        const unallocated = res.requests.filter(r => !r.archived && fuState(r) === 'none').length;
        setBar('ok', '✓ Loaded ' + res.requests.length + ' request' + (res.requests.length === 1 ? '' : 's') + ' · ' + needs + ' need action' + (unallocated ? ' · ' + unallocated + ' approved with no follow-up' : '') + ' · ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + (res.canDecide ? '' : ' · view only: you do not have decision rights'));
      } catch (err) { $('list').innerHTML = '<div class="dash-empty">Couldn’t reach the Approvals backend: ' + esc(err.message) + '</div>'; setBar('err', 'Couldn’t reach the Approvals backend: ' + esc(err.message), true); }
    }
    // reload the list, then reopen the request the person was working on so they see the result
    async function refreshKeepOpen(id) { await load(); S.openId = null; S.detail = null; await toggleRow(id); }
    function refresh() { S.selected = {}; S.openId = null; S.detail = null; $('list').innerHTML = ''; load(); }

    function renderPickers() {
      const archived = S.res ? S.res.requests.filter(r => r.archived).length : 0;
      $('view').innerHTML = [['Requests', 'Requests'], ['Archive', 'Archive (' + archived + ')']].map(v => '<button type="button" class="rb' + (v[0] === S.view ? ' on' : '') + '" data-act="view" data-v="' + v[0] + '">' + v[1] + '</button>').join('');
      const pills = S.view === 'Archive' ? ['All'].concat(DECIDED) : STATUS_PILLS;
      if (pills.indexOf(S.status) === -1) S.status = S.view === 'Archive' ? 'All' : 'Needs Action';
      $('status').innerHTML = pills.map(s => '<button type="button" class="rb' + (s === S.status ? ' on' : '') + '" data-act="status" data-v="' + s + '">' + s + '</button>').join('');
    }

    function sortRows(rows) {
      if (S.sortKey) {
        const val = { school: r => r.campusId, title: r => r.title.toLowerCase(), category: r => r.category, urgency: r => r.urgency === 'Urgent' ? 0 : 1, status: r => r.status,
          date: r => NEEDS.indexOf(r.status) !== -1 ? r.requestedAt : (r.decidedAt || r.requestedAt) }[S.sortKey];
        return rows.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * S.sortDir || b.requestedAt.localeCompare(a.requestedAt); });
      }
      const need = rows.filter(r => NEEDS.indexOf(r.status) !== -1), done = rows.filter(r => NEEDS.indexOf(r.status) === -1);
      need.sort((a, b) => (a.urgency === 'Urgent') !== (b.urgency === 'Urgent') ? (a.urgency === 'Urgent' ? -1 : 1) : a.requestedAt.localeCompare(b.requestedAt)); // urgent first, then oldest first
      done.sort((a, b) => (b.decidedAt || b.requestedAt).localeCompare(a.decidedAt || a.requestedAt));
      return need.concat(done);
    }

    function renderList() {
      if (!S.res) return;
      let rows = S.res.requests.slice();
      if (S.status === 'Needs Action') rows = rows.filter(r => NEEDS.indexOf(r.status) !== -1); else if (S.status !== 'All') rows = rows.filter(r => r.status === S.status);
      if (S.cat !== 'All') rows = rows.filter(r => r.category === S.cat);
      if (S.school !== 'All') rows = rows.filter(r => r.campusId === S.school);
      if (S.fu !== 'All') rows = rows.filter(r => fuState(r) === S.fu);
      rows = rows.filter(r => S.view === 'Archive' ? r.archived : !r.archived);
      if (S.search) { const q = S.search.toLowerCase(); rows = rows.filter(r => (r.title + ' ' + r.category + ' ' + r.requestedBy + ' ' + r.itemName + ' ' + r.description + ' ' + school(r.campusId)).toLowerCase().indexOf(q) !== -1); }
      renderPickers();
      rows = sortRows(rows);
      const canSel = !!S.res.canDecide;
      S.eligible = {};
      if (canSel) rows.forEach(r => { if (S.view === 'Archive' || DECIDED.indexOf(r.status) !== -1) S.eligible[r.id] = true; });
      Object.keys(S.selected).forEach(id => { if (!S.eligible[id]) delete S.selected[id]; });
      const sel = Object.keys(S.selected).length, elig = Object.keys(S.eligible).length, cols = 7 + (canSel ? 1 : 0);
      const th = (key, label, extra) => '<th data-act="sort" data-v="' + key + '">' + label + (S.sortKey === key ? (S.sortDir > 0 ? ' ▲' : ' ▼') : '') + (extra || '') + '</th>';
      const opts = (list, cur, all) => '<option value="All">' + all + '</option>' + list.map(o => '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('');
      const head = '<thead><tr>' + (canSel ? '<th style="width:28px;cursor:default"><input type="checkbox" data-act="selall" title="Select all" ' + (elig && sel === elig ? 'checked ' : '') + (elig ? '' : 'disabled') + '></th>' : '') +
        th('school', 'School', '<select class="hsel" data-f="school">' + opts(CAMPUSES.map(c => [c, school(c)]), S.school, 'All schools') + '</select>') +
        th('title', 'Title', '<input class="hsel" data-f="search" type="text" placeholder="Search…" value="' + esc(S.search) + '" style="width:100%">') +
        th('category', 'Category', '<select class="hsel" data-f="cat">' + opts(CATEGORIES.map(c => [c, c]), S.cat, 'All categories') + '</select>') + th('urgency', 'Urgency') + th('status', 'Status') +
        '<th style="cursor:default;vertical-align:top">Follow-up<select class="hsel" data-f="fu">' + opts([['none', 'Not allocated'], ['open', 'Open'], ['overdue', 'Overdue'], ['done', 'Done']], S.fu, 'All follow-ups') + '</select></th>' +
        th('date', 'Age / Decided', sel ? '<button type="button" class="hsel" style="cursor:pointer;font-weight:700" data-act="archsel">' + (S.view === 'Archive' ? 'Unarchive ' : 'Archive ') + sel + ' selected</button>' : '') + '</tr></thead>';
      let body;
      if (rows.length) body = rows.map(rowHtml).join('');
      else body = '<tr><td colspan="' + cols + '" class="dash-empty">No ' + (S.view === 'Archive' ? 'archived ' : '') + (S.status === 'All' ? '' : S.status.toLowerCase() + ' ') + 'requests' + (S.cat === 'All' ? '' : ' in ' + esc(S.cat)) + '.</td></tr>';
      const keepSearch = document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-f') === 'search' && root.contains(document.activeElement);
      $('list').innerHTML = '<div class="wrap"><table>' + head + '<tbody>' + body + '</tbody></table></div>';
      if (keepSearch) { const el = root.querySelector('[data-f="search"]'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }
    }

    function fuCell(r) {
      const st = fuState(r), f = r.followUp;
      if (st === 'hiring') return r.status === 'Approved' ? '<span class="sm">In Hiring</span>' : '\u2014';
      if (st === 'na') return '\u2014';
      if (st === 'none') return '<span class="pill amber">Not allocated</span>';
      const who = esc((f.assigneeName || f.assignee).split(' ')[0]);
      return st === 'done' ? '<span class="pill ok">Done</span> <span class="sm">' + who + '</span>' : '<span class="' + (st === 'overdue' ? 'late' : '') + '">' + who + ' \u00b7 due ' + dueLabel(f.due) + (st === 'overdue' ? ' (overdue)' : '') + '</span>';
    }
    function rowHtml(r) {
      const open = S.openId === r.id, needs = NEEDS.indexOf(r.status) !== -1, stale = needs && isStale(r.requestedAt), canSel = !!S.res.canDecide, cols = 7 + (canSel ? 1 : 0);
      const date = needs ? '<span' + (stale ? ' class="stalet"' : '') + '>' + age(r.requestedAt) + '</span>' : ddmmyyyy(r.decidedAt || r.requestedAt);
      let h = '<tr class="row' + (open ? ' open' : '') + (stale ? ' stale' : '') + '" data-act="row" data-id="' + esc(r.id) + '">' +
        (canSel ? '<td data-stop="1">' + (S.eligible[r.id] ? '<input type="checkbox" data-act="sel" data-id="' + esc(r.id) + '" ' + (S.selected[r.id] ? 'checked' : '') + '>' : '') + '</td>' : '') +
        '<td>' + esc(school(r.campusId)) + '</td><td>' + esc(r.title) + '</td><td>' + esc(r.category) + '</td><td>' + (r.urgency === 'Urgent' ? '<span class="pill urgent">Urgent</span>' : '—') + '</td>' +
        '<td><span class="pill ' + pillClass(r.status) + '">' + esc(r.status) + '</span></td><td>' + fuCell(r) + '</td><td>' + date + '</td></tr>';
      if (open) h += '<tr class="detail"><td colspan="' + cols + '"><div class="dwrap" data-slot="detail">' + (S.detail ? detailInner(S.detail) : '<div class="empty">Loading…</div>') + '</div></td></tr>';
      return h;
    }

    async function toggleRow(id) {
      if (S.openId === id) { S.openId = null; S.detail = null; renderList(); return; }
      S.openId = id; S.detail = null; renderList();
      let res;
      try { res = await get('action=approvaldetail&id=' + encodeURIComponent(id)); } catch (err) { res = { success: false, error: err.message }; }
      if (S.openId !== id) return; // another row was opened meanwhile
      if (!res.success) { authFail(res); const w = root.querySelector('[data-slot="detail"]'); if (w) w.innerHTML = '<div class="empty">Couldn’t load this request: ' + esc(res.error || 'unknown error') + '</div>'; return; }
      S.detail = res; const w = root.querySelector('[data-slot="detail"]'); if (w) w.innerHTML = detailInner(res);
    }
    const reopen = id => { S.openId = null; S.detail = null; return toggleRow(id); };

    function followHtml(r, canDecide) {
      if (FOLLOW_SKIP.indexOf(r.category) !== -1) return r.status === 'Approved' ? '<div class="fu"><b>Follow-up:</b> <span class="sm">tracked in the Hiring dashboard</span></div>' : '';
      if (r.status !== 'Approved') return '';
      const f = r.followUp, st = fuState(r);
      const form = canDecide && ctx.post ? '<div class="addrow"><select data-fu-who="' + esc(r.id) + '">' + (ctx.people ? ctx.people() : []).map(c => '<option value="' + esc(c.email) + '"' + (f && f.assignee === c.email ? ' selected' : '') + '>' + esc(c.name || c.email) + '</option>').join('') + '</select>' +
        '<input type="date" data-fu-due="' + esc(r.id) + '" value="' + esc(f && f.due >= isoDay(new Date()) ? f.due : plusDays(7)) + '" min="' + isoDay(new Date()) + '"><input type="text" data-fu-note="' + esc(r.id) + '" placeholder="Note (optional)" value="' + esc(f && st !== 'done' ? f.note : '') + '">' +
        '<button type="button" data-act="alloc" data-id="' + esc(r.id) + '">' + (f ? 'Save' : 'Allocate follow-up') + '</button></div>' : '';
      if (!f) return '<div class="fu"><b>Follow-up:</b> <span class="pill amber">Not allocated</span> <span class="sm">nobody is accountable for making this happen yet</span>' + (form || '') + '</div>';
      const status = st === 'done' ? '<span class="pill ok">Done</span>' + (f.doneAt ? ' <span class="sm">' + esc(f.doneAt.slice(0, 10)) + '</span>' : '') + (f.note ? ' \u2014 ' + esc(f.note) : '') : '<span class="' + (st === 'overdue' ? 'late' : '') + '">' + (st === 'overdue' ? 'Overdue, was due ' : 'Due ') + dueLabel(f.due) + '</span>' + (f.note ? ' \u00b7 <span class="sm">' + esc(f.note) + '</span>' : '');
      return '<div class="fu"><b>Follow-up:</b> ' + esc(f.assigneeName || f.assignee) + ' \u00b7 ' + status +
        (canDecide && ctx.post ? ' <a href="#" data-act="fuedit" data-id="' + esc(r.id) + '">change</a><a href="#" data-act="fucancel" data-id="' + esc(r.id) + '">remove</a>' : '') + (S.fuEdit === r.id ? form : '') + '</div>';
    }
    function detailInner(res) {
      const r = res.request, meta = [];
      if (r.itemName) {
        const lbl = r.category === 'Compensation Change' ? 'Employee: ' : r.category === 'New/ Backup Position' ? 'Subjects/Position: ' : (r.category === 'EPF Exemption' || r.category === 'Salary Offer Approval') ? 'Candidate: ' : 'Item: ';
        meta.push(lbl + esc(r.itemName) + (r.quantity == null ? '' : r.category === 'New/ Backup Position' ? ' (' + r.quantity + ' opening' + (r.quantity === 1 ? '' : 's') + ')' : ' × ' + r.quantity));
      }
      if (r.amount != null) meta.push('Amount: ₹' + r.amount);
      if (r.evidenceLink) meta.push(r.category === 'New/ Backup Position' ? esc(r.evidenceLink) : 'Evidence: <a href="' + esc(r.evidenceLink) + '" target="_blank" rel="noopener">link</a>');
      meta.push('Requested by ' + esc(r.requestedBy) + ' on ' + ddmmyyyy(r.requestedAt));
      if (r.decidedBy) meta.push(esc(r.status) + ' by ' + esc(r.decidedBy) + ' on ' + ddmmyyyy(r.decidedAt));
      const refer = NO_REFER.indexOf(r.category) === -1 ? referHtml(r.id) : '';
      let bar = '';
      const allocNow = ctx.post && FOLLOW_SKIP.indexOf(r.category) === -1 ? '<div style="width:100%;margin-bottom:8px"><span class="sm">Optional: if you approve, also allocate the follow-up to</span> <select data-fa-who="' + esc(r.id) + '"><option value="">nobody yet</option>' +
        (ctx.people ? ctx.people() : []).map(c => '<option value="' + esc(c.email) + '">' + esc(c.name || c.email) + '</option>').join('') + '</select> <span class="sm">due</span> <input type="date" data-fa-due="' + esc(r.id) + '" value="' + plusDays(7) + '" min="' + isoDay(new Date()) + '" style="width:auto"></div>' : '';
      if (res.canDecide && (r.status === 'Pending' || r.status === 'Info Requested')) bar = '<div class="bar"><input type="text" class="note" data-note="' + esc(r.id) + '" placeholder="Note explaining the decision (required)">' + allocNow + refer +
        ['Approved|approve|Approve', 'Rejected|reject|Reject', 'Info Requested|info|Request Info'].map(x => { const p = x.split('|'); return '<button type="button" class="' + p[1] + '" data-act="decide" data-id="' + esc(r.id) + '" data-v="' + p[0] + '">' + p[2] + '</button>'; }).join('') + '</div>';
      else if (res.canDecide && r.status === 'Approved') bar = '<div class="bar"><input type="text" class="note" data-note="' + esc(r.id) + '" placeholder="Reason for revoking (required)">' + refer + '<button type="button" class="revoke" data-act="decide" data-id="' + esc(r.id) + '" data-v="Revoked">Revoke</button></div>';
      if (res.canDecide && DECIDED.indexOf(r.status) !== -1) bar += '<div class="bar"><button type="button" class="revoke" data-act="archone" data-id="' + esc(r.id) + '" data-v="' + (r.archived ? 'false' : 'true') + '">' + (r.archived ? 'Unarchive' : 'Archive') + '</button></div>';
      if (r.referredTo) bar = '<div class="desc"><b>Referred to:</b> ' + esc(r.referredTo) + '</div>' + bar;
      if (r.decisionNote) bar = '<div class="desc"><b>Decision note:</b> ' + esc(r.decisionNote) + '</div>' + bar;
      const reply = r.status === 'Info Requested' && sess().email === r.requestedBy;
      const comments = res.comments.length ? res.comments.map(c => '<div class="cm"><div class="cmm">' + esc(c.authorEmail) + ' (' + esc(c.authorRole || '—') + ') · ' + ddmmyyyy(c.postedAt) +
        (c.authorEmail === sess().email ? ' · <a href="#" data-act="cdel" data-id="' + esc(c.id) + '" data-ap="' + esc(r.id) + '">Delete</a>' : '') + '</div>' + esc(c.body) + '</div>').join('') : '<div class="empty">No comments yet.</div>';
      return '<div class="desc">' + esc(r.description) + '</div><div class="meta"><span>' + meta.join('</span><span>') + '</span></div>' + followHtml(r, res.canDecide) + '<div style="margin:10px 0">' + comments + '</div>' +
        (reply ? '<div class="hint">The Owner asked for more before deciding — your reply below sends this back to Pending.</div>' : '') +
        '<div class="addrow"><input type="text" data-cin="' + esc(r.id) + '" placeholder="' + (reply ? 'Reply with the info requested' : 'Add a comment') + '"><button type="button" data-act="cpost" data-id="' + esc(r.id) + '">' + (reply ? 'Reply' : 'Post') + '</button></div>' + bar;
    }

    // ── comments ──
    async function postComment(id, btn) {
      const input = root.querySelector('[data-cin="' + id + '"]'); if (!input || btn.disabled) return;
      const text = input.value.trim(); if (!text) return;
      input.disabled = btn.disabled = true;
      const res = await post('addapprovalcomment', { approvalId: id, body: text });
      input.disabled = btn.disabled = false;
      if (!res.success) { authFail(res); alert('Couldn’t post that comment' + (res.error ? ': ' + res.error : '') + '.'); return; }
      if (res.status && S.res) { const row = S.res.requests.filter(r => r.id === id)[0]; if (row) row.status = res.status; } // a comment can flip Pending <-> Info Requested
      await reopen(id); renderList();
    }
    async function delComment(cid, id) {
      if (!confirm('Delete this comment?')) return;
      const res = await post('deleteapprovalcomment', { id: cid });
      if (!res.success) { authFail(res); alert('Couldn’t delete that comment' + (res.error ? ': ' + res.error : '') + '.'); return; }
      await reopen(id);
    }

    // ── "Refer to" picker: search staff by name, pick up to 2 per group ──
    async function loadReferees() {
      if (S.refLoaded || S.refLoading) return;
      S.refLoading = true;
      try {
        const res = await get('action=approvalreferees');
        if (!res.success || !res.staff) { S.refErr = res.error || 'backend not updated yet?'; return; }
        S.refLoaded = true; S.refErr = ''; S.refStaff = res.staff; res.staff.forEach(s => { S.refNames[s.email] = s.name; });
      } catch (err) { S.refErr = err.message; } finally { S.refLoading = false; }
    }
    function chips(id, k) { return (S.refs[id][k] || []).map((e, i) => '<span class="chip">' + esc(S.refNames[e] || e) + ' <a href="#" data-act="rdel" data-id="' + esc(id) + '" data-k="' + k + '" data-i="' + i + '" style="text-decoration:none">×</a></span>').join(''); }
    function referHtml(id) {
      loadReferees(); S.refs[id] = S.refs[id] || { action: [], accountability: [], information: [] };
      return '<div style="width:100%">' + REFER_KINDS.map(kv => { const k = kv[0], sfx = k + '-' + id;
        return '<div style="position:relative;margin-bottom:6px"><div style="font-size:11.5px;color:var(--gray);margin:2px 0">' + kv[1] + ' (max 2)</div><div data-chips="' + esc(sfx) + '">' + chips(id, k) + '</div>' +
          '<input type="text" class="note" autocomplete="off" data-ref="' + esc(sfx) + '" data-id="' + esc(id) + '" data-k="' + k + '" placeholder="Start typing a name…"><div class="menu" data-menu="' + esc(sfx) + '"></div></div>'; }).join('') +
        '<div style="font-size:11px;color:var(--gray)">Optional. Each group gets its own email, without the amount.</div></div>';
    }
    async function searchRef(input) {
      if (!S.refLoaded && !S.refLoading) await loadReferees();
      const sfx = input.getAttribute('data-ref'), id = input.getAttribute('data-id'), k = input.getAttribute('data-k'), menu = root.querySelector('[data-menu="' + sfx + '"]'), q = input.value.trim().toLowerCase();
      if (!q) { menu.style.display = 'none'; return; }
      const hits = S.refStaff.filter(s => s.name.toLowerCase().indexOf(q) !== -1 || s.email.indexOf(q) !== -1).slice(0, 8);
      menu.innerHTML = hits.length ? hits.map(s => '<div data-act="rpick" data-id="' + esc(id) + '" data-k="' + k + '" data-e="' + esc(s.email) + '">' + esc(s.name) + ' <span style="color:var(--gray);font-size:11.5px">' + esc(s.email) + '</span></div>').join('')
        : '<div style="color:var(--gray)">' + (S.refStaff.length ? 'No match' : (S.refLoading ? 'Loading the staff list (the backend can be slow)…' : 'Couldn’t load the staff list (' + esc(S.refErr || 'unknown') + ')')) + '</div>';
      menu.style.display = 'block';
    }
    function addRef(id, k) {
      const sfx = k + '-' + id, input = root.querySelector('[data-ref="' + sfx + '"]'); if (!input) return;
      const m = input.value.toLowerCase().match(/[^\s<>—,;]+@lms\.org\.in/), list = S.refs[id][k];
      if (m && list.indexOf(m[0]) === -1) { if (list.length >= 2) alert('At most 2 people per group.'); else list.push(m[0]); }
      input.value = ''; root.querySelector('[data-menu="' + sfx + '"]').style.display = 'none'; root.querySelector('[data-chips="' + sfx + '"]').innerHTML = chips(id, k);
    }

    // ── decisions and archiving ──
    // The Coordinator backend call for allocating (or removing) a follow-up. Returns {success, error}.
    async function allocate(body) { if (!ctx.post) return { success: false, error: 'not available here' }; try { return await ctx.post(Object.assign({ action: 'coordinatorallocate' }, body)); } catch (err) { return { success: false, error: err.message }; } }
    async function decide(id, decision) {
      const note = (root.querySelector('[data-note="' + id + '"]').value || '').trim();
      const faWho = root.querySelector('[data-fa-who="' + id + '"]'), faDue = root.querySelector('[data-fa-due="' + id + '"]');
      const allocNow = decision === 'Approved' && faWho && faWho.value ? { approvalId: id, assignee: faWho.value, due: faDue ? faDue.value : plusDays(7) } : null;
      const hadFollow = decision === 'Revoked' && S.res && S.res.requests.some(r => r.id === id && r.followUp);
      if (!note) { alert('A note explaining the decision is required.'); return; }
      const btns = root.querySelectorAll('.bar button'); btns.forEach(b => { b.disabled = true; });
      setBar('loading', 'Saving decision…');
      const referTo = {};
      if (S.refs[id]) REFER_KINDS.forEach(kv => { if (root.querySelector('[data-ref="' + kv[0] + '-' + id + '"]')) addRef(id, kv[0]); referTo[kv[0]] = S.refs[id][kv[0]].join(','); }); // a half-typed address still counts
      const res = await post('decideapproval', { id: id, decision: decision, note: note, referTo: referTo });
      btns.forEach(b => { b.disabled = false; });
      if (!res.success && /JSON|DOCTYPE/.test(String(res.error || ''))) { // the backend sometimes answers a slow POST with a Google HTML page although the write went through
        setBar('loading', 'Reply unreadable (backend slow) — checking whether it saved…');
        try { const chk = await get('action=approvaldetail&id=' + encodeURIComponent(id)); if (chk.success && chk.request.status === decision) { alert('Saved: the request is now ' + decision + '. (The confirmation reply was lost; referral emails, if any, may not have been sent.)'); refresh(); return; } } catch (e) { /* fall through */ }
      }
      if (!res.success) { authFail(res); setBar('err', 'Couldn’t record that decision' + (res.error ? ': ' + esc(res.error) : '')); alert('Couldn’t record that decision' + (res.error ? ': ' + res.error : '') + '.'); renderList(); return; }
      if (allocNow) { const a = await allocate(allocNow); if (!a.success) alert('Approved, but the follow-up could not be allocated: ' + a.error + '. You can allocate it from the request.'); }
      if (hadFollow) await allocate({ approvalId: id, cancel: true }); // the approval is withdrawn, so its follow-up goes too
      if (res.mailError) alert('Saved, but the email to the referred people failed: ' + res.mailError);
      else if (res.referred) alert(decision + ' — emails sent: ' + REFER_KINDS.map(kv => res.referred[kv[0]].length ? kv[1] + ' (' + res.referred[kv[0]].join(', ') + ')' : '').filter(Boolean).join('; ') + '.');
      refresh();
    }
    async function archive(ids, on) {
      setBar('loading', on ? 'Archiving…' : 'Restoring…');
      const res = await post('archiveapproval', { ids: ids, archive: on });
      if (!res.success) { authFail(res); setBar('err', 'Couldn’t ' + (on ? 'archive' : 'unarchive') + ': ' + esc(res.error || 'unknown error')); return; }
      refresh();
    }

    // ── one delegated listener per event type ──
    root.addEventListener('click', e => {
      const t = e.target.closest('[data-act]'); if (!t || !root.contains(t)) return;
      if (e.target.closest('[data-stop]') && t.getAttribute('data-act') === 'row') return;
      const a = t.getAttribute('data-act'), id = t.getAttribute('data-id'), v = t.getAttribute('data-v');
      if (a === 'refresh') refresh();
      else if (a === 'view') { S.view = v; S.selected = {}; S.openId = null; S.detail = null; renderList(); }
      else if (a === 'status') { S.status = v; S.openId = null; S.detail = null; renderList(); }
      else if (a === 'sort') { if (e.target.closest('select,input,button')) return; if (S.sortKey !== v) { S.sortKey = v; S.sortDir = 1; } else if (S.sortDir === 1) S.sortDir = -1; else S.sortKey = null; S.openId = null; S.detail = null; renderList(); }
      else if (a === 'row') toggleRow(id);
      else if (a === 'archsel') { e.stopPropagation(); const ids = Object.keys(S.selected), on = S.view === 'Requests'; if (!ids.length) return; if (on && !confirm('Archive ' + ids.length + ' request(s)? They move to the Archive view and can be restored.')) return; S.selected = {}; archive(ids, on); }
      else if (a === 'archone') archive([id], v === 'true');
      else if (a === 'decide') decide(id, v);
      else if (a === 'alloc') {
        const who = root.querySelector('[data-fu-who="' + id + '"]'), due = root.querySelector('[data-fu-due="' + id + '"]'), note = root.querySelector('[data-fu-note="' + id + '"]');
        if (!who || !who.value) { alert('Pick who is accountable for this.'); return; }
        t.disabled = true; t.textContent = 'Saving\u2026';
        allocate({ approvalId: id, assignee: who.value, due: due.value, note: note.value }).then(a2 => { if (!a2.success) { alert('Could not allocate: ' + a2.error); t.disabled = false; t.textContent = 'Allocate follow-up'; return; } S.fuEdit = null; refreshKeepOpen(id); });
      }
      else if (a === 'fuedit') { e.preventDefault(); S.fuEdit = S.fuEdit === id ? null : id; const w = root.querySelector('[data-slot="detail"]'); if (w && S.detail) w.innerHTML = detailInner(S.detail); }
      else if (a === 'fucancel') { e.preventDefault(); if (!confirm('Remove the follow-up? The coordinator\u2019s task is closed.')) return; allocate({ approvalId: id, cancel: true }).then(a2 => { if (!a2.success) alert('Could not remove it: ' + a2.error); else refreshKeepOpen(id); }); }
      else if (a === 'cpost') postComment(id, t);
      else if (a === 'cdel') { e.preventDefault(); delComment(id, t.getAttribute('data-ap')); }
      else if (a === 'rdel') { e.preventDefault(); const k = t.getAttribute('data-k'); S.refs[id][k].splice(+t.getAttribute('data-i'), 1); root.querySelector('[data-chips="' + k + '-' + id + '"]').innerHTML = chips(id, k); }
    });
    root.addEventListener('mousedown', e => { const t = e.target.closest('[data-act="rpick"]'); if (!t) return; const id = t.getAttribute('data-id'), k = t.getAttribute('data-k'), input = root.querySelector('[data-ref="' + k + '-' + id + '"]'); input.value = t.getAttribute('data-e'); addRef(id, k); input.focus(); });
    root.addEventListener('change', e => {
      const t = e.target, a = t.getAttribute('data-act'), f = t.getAttribute('data-f');
      if (a === 'sel') { if (t.checked) S.selected[t.getAttribute('data-id')] = true; else delete S.selected[t.getAttribute('data-id')]; renderList(); }
      else if (a === 'selall') { S.selected = t.checked ? Object.assign({}, S.eligible) : {}; renderList(); }
      else if (f === 'school') { S.school = t.value; S.openId = null; S.detail = null; renderList(); }
      else if (f === 'cat') { S.cat = t.value; S.openId = null; S.detail = null; renderList(); }
      else if (f === 'fu') { S.fu = t.value; S.openId = null; S.detail = null; renderList(); }
    });
    root.addEventListener('input', e => {
      const t = e.target;
      if (t.getAttribute('data-f') === 'search') { S.search = t.value.trim(); S.openId = null; S.detail = null; renderList(); }
      else if (t.hasAttribute('data-ref')) searchRef(t);
    });
    root.addEventListener('focusin', e => { if (e.target.hasAttribute && e.target.hasAttribute('data-ref')) searchRef(e.target); });
    root.addEventListener('keydown', e => { const t = e.target; if (e.key === 'Enter' && t.hasAttribute && t.hasAttribute('data-ref')) { e.preventDefault(); addRef(t.getAttribute('data-id'), t.getAttribute('data-k')); } });

    load();
    return { refresh: refresh };
  }

  return { mount: mount };
})();
