// The Principal home, Kingshot-style (assets/game/home-hud.js + home-hud.css): the school building is the picture and every control hugs
// the edges: an avatar and day clock at the top, event icons on the right, a task drawer on the left, one quest line and the
// Town / World switch at the bottom, and bubbles pinned to the rooms that need a look. Uday, 29 Oct: "not too much data cluttered on the
// home screen, but icons leading to a lot of information". Presentation only: it reads what the page already loaded (game.js's Today
// payload via the 'lmcs-game-today' event, the Kingdom base, event.js's card) and moves their rendered output into one sheet; it
// never calls a backend. No lists sit on the page itself: the old #game-root, #rooms and #panels are reachable only through these controls.
//   LMCSHomeHud.mount({ session, campus, root, scene, bubbles, building, stash, gameRoot, evSlot, appt, signout, switchEl, world, content })
//   LMCSHomeHud.setBase(base)   the Kingdom base (own level and points), after each load
// Every piece of text reaches the DOM through text nodes (LMCSGame.ui.h), never as parsed HTML.
var LMCSHomeHud = (function () {
  var IST_MS = 330 * 60000, CLOSE_MIN = 15 * 60 + 30; // the day closes at 15:30 IST (no Game Config value for it yet)
  // what a bubble or the Quest board can open: key -> label and its emoji key (assets/game/emoji.js)
  var SOURCES = {
    today: { label: 'Today with Buddy', e: 'buddy' }, daily: { label: 'Daily work', e: 'day' }, ss: { label: 'Support sessions', e: 'supportSession' },
    hr: { label: 'HR and hiring', e: 'hiring' }, rules: { label: 'Rules', e: 'rules' }, setup: { label: 'Setup quests', e: 'quests' },
    appointments: { label: 'Appointments', e: 'appointments' }, routes: { label: 'Routes', e: 'bus' }
  };
  var KINDS = ['quest', 'count', 'setup'];
  var COPY = { none: 'No quests yet. Your quests will appear here.', done: 'All done for now.', daily: 'No daily missions today.', growth: 'No setup quests open.',
    appts: 'No appointments waiting.', today: 'Nothing is waiting today.', routes: 'Routes' };

  // "Day closes in 3h 10m" (IST), or "Day closed" once 15:30 has passed
  function dayClock(now, closeMin) {
    var d = new Date(now.getTime() + IST_MS), left = (closeMin == null ? CLOSE_MIN : closeMin) - (d.getUTCHours() * 60 + d.getUTCMinutes());
    return left <= 0 ? 'Day closed' : 'Day closes in ' + (left >= 60 ? Math.floor(left / 60) + 'h ' : '') + (left % 60) + 'm';
  }
  // A rank shows only when the game state response carries a `rank` field. Today the backend never sends one: others' scores and
  // ranks are the Owner's only (29 Oct). Later the backend decides who gets `rank` (config ranking.visibleTo): no frontend rebuild.
  function rankText() {
    for (var i = 0; i < arguments.length; i++) { var s = arguments[i]; if (s && s.rank != null && s.rank !== '') return 'Rank ' + s.rank; }
    return '';
  }
  // setup steps still open in a Kingdom base
  function setupLeft(base) {
    var n = 0;
    ((base && base.buildings) || []).forEach(function (b) { (b.tiers || []).forEach(function (t) { if (t.state === 'open') n++; }); });
    return n;
  }
  // which hotspots have a room in the drawn building, and which sources go to the Quest board instead (every source exactly once)
  function plan(cfg, roomIds) {
    var placed = [], have = {};
    ((cfg && cfg.hotspots) || []).forEach(function (s) {
      if (SOURCES[s.source] && KINDS.indexOf(s.kind) !== -1 && roomIds.indexOf(s.room) !== -1 && !have[s.source]) { placed.push(s); have[s.source] = true; }
    });
    return { placed: placed, board: Object.keys(SOURCES).filter(function (k) { return !have[k]; }) };
  }
  var api = { SOURCES: SOURCES, KINDS: KINDS, COPY: COPY, dayClock: dayClock, rankText: rankText, setupLeft: setupLeft, plan: plan };
  if (typeof document === 'undefined') return api; // tests: the helpers only

  // ═══ page ═══
  var h = LMCSGame.ui.h, S = { today: null, base: null, o: null, sheet: null, bubbles: [], cfg: null };
  function emoji(k) { return window.LMCSEmoji ? LMCSEmoji.tag(k) : null; }
  function first(a) { return [].filter.call(a, Boolean)[0]; }
  // arrow keys move between tabs (role=tablist); returns { el, select(i) }
  function tabs(labels, onSelect) {
    var el = h('div', { class: 'hh-tabs', role: 'tablist' }), btns = labels.map(function (l, i) {
      var b = h('button', { type: 'button', role: 'tab', 'aria-selected': 'false', tabindex: '-1' }, l); b.onclick = function () { select(i); }; return b;
    });
    function select(i, focus) {
      btns.forEach(function (b, k) { b.setAttribute('aria-selected', String(k === i)); b.tabIndex = k === i ? 0 : -1; });
      if (focus) btns[i].focus();
      onSelect(i);
    }
    btns.forEach(function (b, i) { el.appendChild(b); b.onkeydown = function (e) {
      var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!d) return; e.preventDefault(); select((i + d + btns.length) % btns.length, true); }; });
    return { el: el, select: select };
  }

  // ── the one sheet: a bottom sheet on phones, a side panel from 1024px; focus trapped, Esc and X close, focus returns to the opener ──
  function sheet() {
    if (S.sheet) return S.sheet;
    var title = h('h2', { id: 'hh-sheet-h', tabindex: '-1' }), body = h('div', { class: 'hh-sheet-body' }), tabHost = h('div'), live = h('p', { class: 'hh-live', role: 'status', 'aria-live': 'polite' });
    var x = h('button', { type: 'button', class: 'hh-x', 'aria-label': 'Close' }, '×');
    var box = h('div', { class: 'hh-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'hh-sheet-h' }, [h('div', { class: 'hh-sheet-head' }, [title, x]), tabHost, body, live]);
    var layer = h('div', { class: 'hh-layer', hidden: 'hidden' }, [h('div', { class: 'hh-backdrop' }), box]);
    document.body.appendChild(layer);
    var s = S.sheet = { layer: layer, box: box, title: title, body: body, tabHost: tabHost, live: live, held: [], release: null, open: false };
    x.onclick = function () { close(); };
    layer.firstChild.onclick = function () { close(); };
    return s;
  }
  // nodes the page rendered (Today, the event card, appointments, sign out) are moved in and sent back to the stash on close
  function open(o) { // { title, nodes: [Node], held: [Node] (return to the stash), tabs, opener, say }
    var s = sheet(); if (s.open) close(true);
    s.title.textContent = o.title; s.body.textContent = ''; s.tabHost.textContent = ''; s.live.textContent = '';
    (o.nodes || []).forEach(function (n) { s.body.appendChild(n); });
    s.held = o.held || [];
    if (o.tabs) s.tabHost.appendChild(o.tabs.el);
    s.layer.hidden = false; s.open = true; document.body.classList.add('hh-sheet-open');
    s.release = LMCSGame.ui.trap(s.box, function () { close(); });
    s.opener = o.opener || document.activeElement;
    s.title.focus();
    setTimeout(function () { s.live.textContent = o.say || o.title + ' opened'; }, 50);
  }
  function close(quiet) {
    var s = S.sheet; if (!s || !s.open) return;
    s.held.forEach(function (n) { S.o.stash.appendChild(n); }); s.held = [];
    s.layer.hidden = true; s.open = false; document.body.classList.remove('hh-sheet-open');
    s.release(quiet ? false : s.opener);
  }
  function note(text) { return h('p', { class: 'hh-empty' }, text); }
  function gameNode() { var g = S.o.gameRoot; g.classList.remove('hh-only-growth', 'hh-only-daily'); return g; }
  function slotNodes() { var l = S.o.evSlot.nextElementSibling; return [S.o.evSlot].concat(l && l.classList.contains('ev-live') ? [l] : []); }

  // ── what each source opens ──
  function openSource(key, opener) {
    var src = SOURCES[key]; if (!src) return;
    if (key === 'routes') { close(true); S.o.world(true); S.o.switchEl.querySelector('button[aria-pressed="true"]').focus(); return; }
    if (key === 'today') { var g = gameNode(); return open({ title: src.label, nodes: [S.o.gameRoot.hidden ? note(COPY.today) : null, g].filter(Boolean), held: [g], opener: opener }); }
    if (key === 'appointments') {
      var a = S.o.appt; return open({ title: src.label, nodes: [a.textContent.trim() ? null : note(COPY.appts), a].filter(Boolean), held: [a], opener: opener });
    }
    open({ title: src.label, nodes: [S.o.content(key)], opener: opener });
  }
  function openBoard(opener) {
    var ul = h('ul', { class: 'hh-list' });
    S.board.forEach(function (k) {
      var b = h('button', { type: 'button', class: 'hh-row' }, [emoji(SOURCES[k].e), h('span', { class: 'hh-row-t' }, SOURCES[k].label), h('span', { class: 'hh-go', 'aria-hidden': 'true' }, '›')]);
      b.onclick = function () { openSource(k, b); };
      ul.appendChild(h('li', {}, b));
    });
    open({ title: 'Quest board', nodes: [ul], opener: opener });
  }
  function openQuests(opener, tab) {
    var g = gameNode(), setup = h('div', { class: 'hh-growth-more' }, S.o.content('setup'));
    var t = tabs(['Growth', 'Daily'], function (i) {
      g.classList.toggle('hh-only-growth', i === 0); g.classList.toggle('hh-only-daily', i === 1); setup.hidden = i === 1;
    });
    open({ title: 'Quests', nodes: [S.o.gameRoot.hidden ? note(COPY.today) : null, g, setup].filter(Boolean), held: [g], tabs: t, opener: opener });
    t.select(tab === 'daily' ? 1 : 0);
  }
  function openEvent(opener, label) {
    var n = slotNodes(); open({ title: label, nodes: n, held: n, opener: opener });
  }
  function openProfile(opener) {
    var s = S.o.session, base = S.base, held = [S.o.signout], nodes = [];
    var facts = h('dl', { class: 'hh-facts' }, [['Name', s.name], ['Role', 'Principal'], ['Campus', s.campusName]].concat(base ? [['Level', String(Number(base.level) || 0)], ['Points', String(Number(base.points) || 0)]] : [])
      .reduce(function (a, f) { return f[1] ? a.concat([h('dt', {}, f[0]), h('dd', {}, f[1])]) : a; }, []));
    nodes.push(facts);
    if (S.o.appt.textContent.trim()) { held.push(S.o.appt); nodes.push(h('h3', {}, 'Appointments'), S.o.appt); }
    nodes.push(h('h3', {}, 'Account'), S.o.signout);
    open({ title: s.name ? s.name : 'Profile', nodes: nodes, held: held, opener: opener });
  }

  // ── the HUD ──
  function btn(cls, label, kids, fn) { var b = h('button', { type: 'button', class: cls, 'aria-label': label }, kids); b.onclick = function () { fn(b); }; return b; }
  function badge(n) { return h('span', { class: 'hh-badge', 'aria-hidden': 'true', hidden: n > 0 ? null : 'hidden' }, n > 99 ? '99+' : String(n)); }
  function setBadge(b, n) { b.textContent = n > 99 ? '99+' : String(n); b.hidden = !(n > 0); }
  function setLabel(b, name, n) { b.setAttribute('aria-label', n > 0 ? name + ', ' + n + ' waiting' : name); }

  function buildHud() {
    var o = S.o, el = {};
    var initial = String((o.session.name || '?').trim().charAt(0) || '?').toUpperCase();
    el.avatar = btn('hh-avatar', 'Your profile', h('span', { 'aria-hidden': 'true' }, initial), openProfile);
    el.level = h('span', { class: 'hh-chip hh-level', hidden: 'hidden' });
    el.rank = h('span', { class: 'hh-chip hh-rank', hidden: 'hidden' }); // shown only when a state response carries `rank` (see rankText)
    el.clock = h('span', { class: 'hh-chip hh-clock' });
    el.points = h('span', { class: 'hh-chip hh-points', hidden: 'hidden' });
    el.events = h('div', { class: 'hh-events' });
    var tl = h('div', { class: 'hh-tl' }, [el.avatar, el.level, el.rank]), top = h('div', { class: 'hh-top' }, [el.clock, el.points]);

    // the task drawer: Town, Wilderness, Daily
    var panes = [h('div', { role: 'tabpanel' }), h('div', { role: 'tabpanel', hidden: 'hidden' }), h('div', { role: 'tabpanel', hidden: 'hidden' })];
    var tt = tabs(['Town', 'Wilderness', 'Daily'], function (i) { panes.forEach(function (p, k) { p.hidden = k !== i; }); });
    el.drawer = h('aside', { class: 'hh-drawer', id: 'hh-drawer', 'aria-label': 'Tasks' }, [tt.el].concat(panes));
    el.edge = h('button', { type: 'button', id: 'hh-edge', class: 'hh-edge', 'aria-expanded': 'false', 'aria-controls': 'hh-drawer', 'aria-label': 'Open tasks' }, h('span', { 'aria-hidden': 'true' }, '▸'));
    function drawer(on, focus) {
      el.drawer.classList.toggle('is-open', on); el.edge.setAttribute('aria-expanded', String(on)); el.edge.setAttribute('aria-label', on ? 'Close tasks' : 'Open tasks');
      el.edge.firstChild.textContent = on ? '◂' : '▸'; el.drawer.inert = !on;
      if (focus) (on ? tt.el.querySelector('[aria-selected="true"]') : el.edge).focus();
    }
    el.edge.onclick = function () { drawer(!el.drawer.classList.contains('is-open'), true); };
    el.drawer.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); drawer(false, true); } });
    drawer(false);
    el.panes = panes;

    // the bottom: one quest line, then the Town / World switch
    el.strip = h('button', { type: 'button', id: 'hh-strip', class: 'hh-strip', hidden: 'hidden' }, [emoji('quests'), h('span', { class: 'hh-strip-t' }), badge(0)]);
    el.strip.onclick = function () { openQuests(el.strip); };
    var bottom = h('div', { class: 'hh-bottom' }, [el.strip, o.switchEl]);

    // a rail item that opens the hub's Today panel opens the quest sheet here instead (Today lives in a sheet now)
    document.getElementById('game-rail') && document.getElementById('game-rail').addEventListener('click', function (e) {
      var a = e.target.closest('a.gb-rail-i'); if (!a) return;
      e.preventDefault(); openQuests(a, /Missions/.test(a.textContent) ? 'daily' : 'growth');
    });

    o.scene.appendChild(h('div', { class: 'hh-hud' }, [tl, top, el.events, el.edge, el.drawer, bottom]));
    S.el = el; S.drawer = drawer;
  }

  function row(title, href, source) {
    var kids = [h('span', { class: 'hh-row-t' }, title), h('span', { class: 'hh-go' }, 'Go →')];
    if (href) return h('a', { class: 'hh-row', href: href, 'aria-label': 'Go: ' + title }, kids);
    var b = h('button', { type: 'button', class: 'hh-row', 'aria-label': 'Go: ' + title }, kids); b.onclick = function () { S.drawer(false); openSource(source || 'today', S.el.edge); };
    return b;
  }
  function list(rows, empty) { return rows.length ? h('ul', { class: 'hh-list' }, rows.map(function (r) { return h('li', {}, r); })) : note(empty); }

  // the drawer, the strip and the clock follow what game.js loaded
  function renderToday() {
    var t = S.today, el = S.el, root = S.o.root; if (!t) return;
    var items = LMCSGame.openItems(t), town = items.map(function (x) { return row(x.title, x.m ? LMCSGame.safeHref(x.m.go, root) : null, 'today'); });
    var quests = (t.quests || []).filter(function (q) { return !q.complete; });
    quests.forEach(function (q) {
      var s = first((q.steps || []).filter(function (s) { return !s.done && !s.locked && !s.waiting; }));
      town.push(row(String(q.title || 'Quest'), s ? LMCSGame.safeHref(s.go, root) : null, 'today'));
    });
    // nothing open: "All done for now" when the person holds quests (all complete), "No quests yet" when none is assigned to them
    var questLine = (t.quests || []).length ? COPY.done : COPY.none;
    el.panes[0].textContent = ''; el.panes[0].appendChild(list(town, questLine));
    var wild = row(COPY.routes, null); wild.onclick = function () { S.drawer(false); S.o.world(true); }; // the World shows this school's routes
    el.panes[1].textContent = ''; el.panes[1].appendChild(list([wild], ''));
    var day = (t.missions || []).filter(function (m) { return !m.gone; }).map(function (m) {
      var done = !!m.done;
      return h('div', { class: 'hh-row hh-static' + (done ? ' is-done' : '') }, [h('span', { class: 'hh-mark', 'aria-hidden': 'true' }, done ? LMCSEmoji.get('done') : '○'), h('span', { class: 'hh-row-t' }, String(m.title || '')), h('span', { class: 'hh-sr' }, done ? 'Done' : 'To do')]);
    });
    el.panes[2].textContent = ''; el.panes[2].appendChild(list(day, COPY.daily));
    var nx = LMCSGame.nextMission(t), n = LMCSRail.counts(t), line = nx && nx.title ? nx.title : quests[0] ? String(quests[0].title || '') : questLine, total = n.missions + n.quests;
    el.strip.hidden = false; el.strip.querySelector('.hh-strip-t').textContent = line;
    setBadge(el.strip.lastChild, total); setLabel(el.strip, 'Quests: ' + line, total);
    bubbles();
  }
  function renderBase() {
    var b = S.base, el = S.el; if (!el) return;
    el.level.hidden = !b; if (b) el.level.textContent = (LMCSEmoji.get('level') + ' Level ' + (Number(b.level) || 0)).trim();
    el.points.hidden = !(b && b.points != null); if (b && b.points != null) el.points.textContent = LMCSEmoji.get('points') + ' ' + (Number(b.points) || 0);
    var r = rankText(S.today, b); el.rank.hidden = !r; el.rank.textContent = r;
    bubbles();
  }
  function tickClock() { if (S.el) S.el.clock.textContent = dayClock(new Date()); }

  // the right column: one icon per running event (today: Game Day), taken from event.js's card, hidden with no event
  function renderEvents() {
    var card = S.o.evSlot.querySelector('.ev-card'), box = S.el.events; box.textContent = '';
    if (!card) return;
    var hd = card.querySelector('h2'), name = hd && hd.lastChild ? hd.lastChild.textContent.trim() : 'Event', left = card.querySelectorAll('.ev-step:not(.ev-done)').length;
    var b = btn('hh-evt', name, [emoji('events'), h('span', { class: 'hh-evt-t' }, name), badge(left)], function (x) { openEvent(x, name); });
    setLabel(b, name, left); box.appendChild(b);
  }

  // ── bubbles pinned to rooms ──
  function roomEls() { return [].slice.call(S.o.building.querySelectorAll('.sb-room')); }
  function bubbles() {
    var o = S.o, layer = S.layer; if (!layer) return;
    var ids = roomEls().map(function (g) { return g.getAttribute('data-room'); }), counts = { today: S.today ? LMCSRail.counts(S.today).missions : 0, setup: setupLeft(S.base) };
    var p = plan(S.cfg, ids), shown = p.placed.filter(function (s) { return counts[s.source] > 0; });
    S.board = Object.keys(SOURCES).filter(function (k) { return !shown.some(function (s) { return s.source === k; }); }); // everything not on a bubble: reachable once, here
    layer.textContent = ''; S.bubbles = [];
    shown.forEach(function (s) {
      var src = SOURCES[s.source], n = counts[s.source] || 0;
      var b = btn('hh-b hh-b-' + s.kind, src.label, [h('span', { class: 'hh-b-e', 'aria-hidden': 'true' }, s.kind === 'setup' ? '⬆' : LMCSEmoji.get(src.e)), badge(n)], function (x) { openSource(s.source, x); });
      setLabel(b, src.label, n); layer.appendChild(b); S.bubbles.push({ b: b, room: s.room });
    });
    var board = btn('hh-b hh-b-board', 'Quest board', [h('span', { class: 'hh-b-e', 'aria-hidden': 'true' }, LMCSEmoji.get('quests'))], function (x) { openBoard(x); });
    layer.appendChild(board); S.bubbles.push({ b: board, room: (S.cfg && S.cfg.entrance) || '' });
    place();
  }
  function place() {
    var wrap = S.o.bubbles.parentNode, r0 = wrap.getBoundingClientRect(), rooms = roomEls(), svg = S.o.building.querySelector('svg.sb');
    S.bubbles.forEach(function (x) {
      var g = first(rooms.filter(function (e) { return e.getAttribute('data-room') === x.room; })), r = g ? g.getBoundingClientRect() : null, sr = svg ? svg.getBoundingClientRect() : r0;
      var px = r ? r.left + r.width / 2 - r0.left : sr.left - r0.left + sr.width / 2, py = r ? r.top - r0.top : sr.bottom - r0.top - 16; // no room: the foot of the building
      if (x.b.classList.contains('hh-b-board')) { px = Math.max(30, Math.min(r0.width - 30, px)); py = Math.max(30, Math.min(r0.height - 30, py)); } // the Quest board always stays in view
      x.b.style.left = px + 'px'; x.b.style.top = py + 'px';
    });
  }

  function mount(o) {
    S.o = o; S.cfg = (typeof LMCSHomeHotspots !== 'undefined' && LMCSHomeHotspots[o.campus]) || { hotspots: [] };
    S.layer = o.bubbles; S.board = Object.keys(SOURCES);
    document.body.classList.add('hh');
    LMCSGame.setTourTargets({ today: '#hh-strip', go: null, bar: '#hh-edge', quest: null }); // Today is in a sheet: the tours point at the quest strip, the task tab and the building
    buildHud(); tickClock(); setInterval(tickClock, 30000);
    document.addEventListener('lmcs-game-today', function (e) { S.today = e.detail; renderToday(); renderBase(); });
    new MutationObserver(renderEvents).observe(o.evSlot, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    new MutationObserver(function () { bubbles(); }).observe(o.building, { childList: true }); // the page redraws the building
    new MutationObserver(function () { place(); }).observe(document.getElementById('modules'), { attributes: true, attributeFilter: ['hidden'] }); // back to Town: measure again
    o.building.addEventListener('scroll', place); window.addEventListener('resize', place);
    renderEvents(); bubbles();
  }
  api.mount = mount; api.openSource = function (k, opener) { openSource(k, opener); };
  api.setBase = function (base) { S.base = base || null; renderBase(); };
  return api;
})();
if (typeof module !== 'undefined') module.exports = LMCSHomeHud;
