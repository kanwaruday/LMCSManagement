// Game layer front end (Buddy). Pure helpers first, then LMCSGame.mount(el, opts): the once-a-day greeting, the
// Today panel, the next-step bar, the quest panel, the decision card and the first-visit tour.
// Everything date-based is read in IST (UTC+5:30), never the browser's own time zone.
// Host page: <link rel="stylesheet" href=".../assets/game/game.css"> + <script src=".../assets/game/game.js">, then
//   LMCSGame.mount(el, { session, backendUrl, root?, data?, only?, title? }) after the page's own content has rendered.
//   root = the portal root relative to the page ('' on the home page, '../' one folder down): mission links are
//   root-relative. data = a gametoday response, to skip the fetch. Empty backendUrl = render nothing.
//   only = a module prefix (e.g. 'fleet') for a module's own page: just the missions whose kind and the quests whose
//   questId start with it, no decisions, days line, greeting or home tour; title replaces the 'Today' heading.
//   tour = { id, beats: [{ target: CSS selector (optional), text }] }: that page's tour, once per person (Game Progress
//   'tour' row keyed id), shown when the home greeting isn't (always, on an `only` page).
// LMCSGame.tour(beats, opts) runs the same tour on its own (see tour() below).
// Every piece of text reaches the DOM through text nodes / setAttribute (h() below), never as parsed HTML.
var LMCSGame = window.LMCSGame = (function () {
  var IST_MS = 330 * 60000;
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // A Date shifted so its getUTC* fields read as the IST wall clock.
  function ist_(date) { return new Date(date.getTime() + IST_MS); }
  function iso_(d) { return d.toISOString().slice(0, 10); }

  // The look Buddy wears today: festival > track suit (Mon-Sat) > season formal. Season = the latest of
  // summerFrom / winterFrom that is on or before today; neither passed yet means winter.
  function outfit(date, campusId, cfg) {
    cfg = cfg || {};
    var u = cfg.uniform || {}, d = ist_(date), today = iso_(d), day = DAYS[d.getUTCDay()];
    if ((u.festivals || []).indexOf(today) !== -1) return 'festival';
    var wFrom = u.winterFrom && u.winterFrom <= today ? u.winterFrom : '';
    var summer = !!u.summerFrom && u.summerFrom <= today && u.summerFrom > wFrom;
    var suit = day !== 'Sun' && ((cfg.trackSuitDays || {})[campusId] || []).indexOf(day) !== -1;
    return (suit ? 'tracksuit-' : '') + (summer ? 'summer' : 'winter') + (suit ? '' : '-formal');
  }

  // Today's open items in the order the Today panel lists them: open missions core-first (server order kept within
  // each group), then undecided decision windows. Each is { title, m } or { title, w }.
  function openItems(today) {
    var ms = ((today && today.missions) || []).filter(function (m) { return !m.done && !m.gone; });
    var ws = ((today && today.windows) || []).filter(function (w) { return !w.decided; });
    return ms.filter(function (m) { return m.core; }).concat(ms.filter(function (m) { return !m.core; }))
      .map(function (m) { return { title: String(m.title || ''), m: m }; })
      .concat(ws.map(function (w) { return { title: String(w.title || ''), w: w }; })); // window titles are verb-first
  }

  var NUMS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  // "Good morning, Meena ji. Four things are waiting today." Counts open items only; the first one is shown apart
  // (openItems(today)[0]), never spliced into the sentence. now is optional (tests); defaults to the clock.
  function greetingLine(today, session, now) {
    var h = ist_(now || new Date()).getUTCHours();
    var hello = h >= 17 ? 'Good evening' : h >= 12 ? 'Good afternoon' : 'Good morning';
    // the first name: honorifics and initials ("Dr.", "Smt", "A.") are skipped
    var first = String((session && session.name) || '').trim().split(/\s+/).filter(function (w) {
      return w && !/\.$/.test(w) && !/^(dr|mr|mrs|ms|smt|shri)$/i.test(w);
    })[0] || '';
    var n = openItems(today).length;
    var line = hello + (first ? ', ' + first + ' ji' : '') + '. ';
    if (!n) return line + 'Nothing is waiting today. Enjoy the calm.';
    return line + (NUMS[n] || n) + (n === 1 ? ' thing is' : ' things are') + ' waiting today.';
  }

  // "18 of 21 days on track this month. Last month: 20 of 22." Empty when nothing was counted this month.
  function daysLine(d) {
    if (!d || !d.counted) return '';
    var denom = d.showDenominator !== false;
    var s = (d.onTrack || 0) + (denom ? ' of ' + d.counted : '') + ' days on track this month';
    if (d.lastMonthCounted) s += '. Last month: ' + (d.lastMonthOnTrack || 0) + (denom ? ' of ' + d.lastMonthCounted : '') + '.';
    return s;
  }

  // ['Mon','Wed','Fri'] -> 'Mon, Wed and Fri'
  function joinList(a) {
    a = a || [];
    return a.length < 2 ? String(a[0] || '') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  }

  // 'YYYY-MM-DD' -> 'Sat 8 Nov' (anything else passes through as text)
  function dateLabel(key) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key || ''))) return String(key || '');
    var d = new Date(key + 'T00:00:00Z');
    return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()];
  }

  // A mission link: a root-relative portal path, an absolute path, or one of the EXTERNAL prefixes exactly. Control
  // characters and spaces are stripped first (browsers ignore them inside a scheme); any other scheme, and any leading
  // // or \, is refused -> null.
  var EXTERNAL = ['https://docs.google.com/forms/', 'https://forms.gle/']; // the Teacher CW/HW Google Form; h() opens it in a new tab
  function safeHref(go, root) {
    go = String(go || '').replace(/[\u0000- \u007f]/g, '');
    for (var i = 0; i < EXTERNAL.length; i++) if (go.indexOf(EXTERNAL[i]) === 0) return go;
    if (!go || /^[/\\]{2}/.test(go) || go.charAt(0) === '\\' || /^[a-z][a-z0-9+.-]*:/i.test(go)) return null;
    var out = go.charAt(0) === '/' ? go : (root || '') + go;
    if (typeof location !== 'undefined' && typeof URL === 'function') {
      try { if (!/^https?:$/.test(new URL(out, location.href).protocol)) return null; } catch (e) { return null; }
    }
    return out;
  }

  // the portal page a mission's link opens, as the small line names it
  var SOURCES = [['principals-daily-reporting', 'Daily Reporting'], ['coordinator/followups', 'Follow-ups'],
    ['coordinator/approvals', 'Approvals'], ['coordinator/systems', 'Systems'], ['principal/issues', 'Issues'], ['teacher/', 'My Classroom']];
  function sourceLabel(go) {
    go = String(go || '');
    for (var i = 0; i < SOURCES.length; i++) if (go.indexOf(SOURCES[i][0]) !== -1) return SOURCES[i][1];
    return '';
  }

  // The speaker's art for today, as paths under assets/game/. firstVisit = the home tour hasn't been seen yet.
  // Pose: the Teacher Owl's intro on a teacher's first visit > bad (a source is down) > celebrate (all done) > neutral.
  function art(today, now, firstVisit) {
    today = today || {};
    var ms = (today.missions || []).filter(function (m) { return !m.gone; });
    var allDone = ms.length > 0 && ms.every(function (m) { return m.done; });
    var pose = (today.sourcesDown || []).length ? 'bad' : allDone ? 'celebrate' : 'neutral';
    if (today.speaker === 'teacher-owl') {
      return { name: 'Teacher Owl', figure: 'teacher-owl/teacher-owl-' + (firstVisit ? 'intro' : pose) + '.webp',
        avatar: 'teacher-owl/avatar-teacher-owl.webp' };
    }
    var o = outfit(now || new Date(), today.campus, today.config);
    return { name: 'Buddy', figure: 'buddy/' + o + '-' + pose + '.webp', avatar: 'buddy/avatar-' + o + '.webp' };
  }

  // ═══ UI ═══════════════════════════════════════════════════════════
  var FALLBACK = 'buddy/winter-formal-neutral.webp';
  var DOWN_LINE = "Part of today's list didn't load, so a few items may be missing. Everything else here is current.";
  var ERROR_LINE = "Today's list didn't load. Your work in the portal is safe; only this list is missing.";
  // art paths resolve next to this script, whatever page loads it
  var BASE = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src || '').replace(/[^/?#]*([?#].*)?$/, '');
  var uid = 0, live = null, last = null; // live = the current mount: its body-level pieces, torn down on remount; last = its gametoday

  // h('a', {class, href, onclick}, ['text', node, [nested]]) -- strings always land as text nodes
  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') n.className = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : String(v));
    });
    if (tag === 'a' && /^https:/.test(n.getAttribute('href') || '')) { n.setAttribute('target', '_blank'); n.setAttribute('rel', 'noopener'); }
    (function add(c) {
      if (Array.isArray(c)) c.forEach(add);
      else if (c !== null && c !== undefined && c !== false && c !== '') n.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    })(kids);
    return n;
  }
  function img(path, cls) {
    return h('img', { class: cls, src: BASE + path, alt: '', decoding: 'async', onerror: function () {
      if (this.src.indexOf(FALLBACK) === -1) this.src = BASE + FALLBACK;
    } });
  }
  function reduced() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function focusables(box) {
    return [].slice.call(box.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled])'))
      .filter(function (x) { return !x.closest('[hidden]'); });
  }
  // A modal layer: Tab stays inside box, Esc calls onEsc. Returns release(to): focus goes back to `to`, else to
  // what had focus before; release(false) leaves focus alone.
  function trap(box, onEsc) {
    var prev = document.activeElement;
    function key(e) {
      if (e.key === 'Escape') { e.preventDefault(); onEsc(); return; }
      if (e.key !== 'Tab') return;
      var f = focusables(box), a = document.activeElement;
      if (!f.length) { e.preventDefault(); return; }
      if (!box.contains(a) || (e.shiftKey && a === f[0]) || (!e.shiftKey && a === f[f.length - 1])) {
        e.preventDefault();
        (e.shiftKey && box.contains(a) ? f[f.length - 1] : f[0]).focus();
      }
    }
    document.addEventListener('keydown', key, true);
    return function release(to) {
      document.removeEventListener('keydown', key, true);
      var target = to === false ? null : to || prev;
      if (target && target.focus && document.contains(target)) target.focus();
    };
  }

  // a beat's target: an element, a CSS selector (absent or invalid -> null: the beat sits centred), or nothing
  function beatTarget(x) {
    if (typeof x !== 'string') return x || null;
    try { var el = document.querySelector(x); return el && el.getClientRects().length ? el : null; } catch (e) { return null; }
  }
  // a string body goes as text/plain: no CORS preflight to Apps Script
  // The Owner's hidden school switcher: owner/kingdom.html stores { campus, name } in sessionStorage (never the URL); while it is set every
  // game GET carries asCampus (the server honours it only for a verified Owner, read only) and no game write is sent. Leave clears it.
  var VIEW_KEY = 'lmcs-view-as';
  function viewAs() {
    try { var v = JSON.parse(sessionStorage.getItem(VIEW_KEY) || 'null'); return v && /^LMS[1-6]$/.test(v.campus) ? { campus: v.campus, name: String(v.name || v.campus) } : null; } catch (e) { return null; }
  }
  function setViewAs(v) {
    try { if (v && /^LMS[1-6]$/.test(v.campus)) sessionStorage.setItem(VIEW_KEY, JSON.stringify({ campus: v.campus, name: String(v.name || v.campus) })); else sessionStorage.removeItem(VIEW_KEY); } catch (e) { /* private mode: nothing to keep */ }
  }
  function viewParam() { var v = viewAs(); return v ? '&asCampus=' + v.campus : ''; }
  // the view belongs to the Principal's Home only (the one page with the banner): any other page that loads game.js (the Owner's
  // Home, Kingdom, People, the Principal's issues or SS pages, ...) ends it at once, so nothing writes as the Owner under a Principal look
  if (typeof location !== 'undefined' && !/\/principal\/(index\.html)?$/.test(String(location.pathname || ''))) setViewAs(null);
  var VIEW_READ_ONLY = { success: false, code: 'GAME_VIEW_READ_ONLY', error: 'You are viewing this school as the Owner, so nothing can be changed here.' };
  function postTo(url, session, action, body) {
    if (viewAs()) return Promise.resolve(VIEW_READ_ONLY); // the server refuses it too
    return fetch(url, { method: 'POST', body: JSON.stringify(Object.assign({ action: action, idToken: (session || {}).idToken }, body)) })
      .then(function (r) { return r.json(); });
  }
  // The spotlight tour: a spotlight on each target in turn, a centred card when a beat has none; Next / Skip / Done,
  // focus trapped, Esc ends it. c = { a: art(), after, post: () => promise (gametourseen), cover(on), piece(remove) ->
  // forget, fixed: an element never scrolled to (the next-step bar) }. mount's tours pass their own cover/piece.
  function runTour(beats, c) {
    var cover = c.cover || function () {}, piece = c.piece || function () { return function () {}; };
    var a = c.a, i = 0, release, n = ++uid;
    beats = beats.map(function (b) { return Object.assign({}, b, { target: beatTarget(b.target), text: String(b.text || '') }); });
    if (c.post) c.post().catch(function () { /* offered again next time; nothing lost */ });
    var spot = h('div', { class: 'lg-spot', 'aria-hidden': 'true' });
    var who = h('div', { class: 'lg-who', id: 'lg-t-who' + n }), text = h('p', { id: 'lg-t-text' + n }), count = h('small', { class: 'lg-count' });
    var av = img(a.avatar, 'lg-av'), fig = img(a.figure, 'lg-fig lg-fig-sm');
    var nextBtn = h('button', { type: 'button', class: 'lg-btn', onclick: function () { show(i + 1); } }, 'Next');
    var card = h('div', { class: 'lg-tourcard', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': who.id, 'aria-describedby': text.id }, [
      fig, h('div', { class: 'lg-tour-head' }, [av, who, count]), text,
      h('div', { class: 'lg-btns' }, [nextBtn, h('button', { type: 'button', class: 'lg-btn lg-btn-alt', onclick: function () { end(); } }, 'Skip')]),
    ]);
    var layer = h('div', { class: 'lg-layer lg-tour' }, [spot, card]);
    function place() {
      var b = beats[i], vw = document.documentElement.clientWidth, vh = window.innerHeight, cw = card.offsetWidth, ch = card.offsetHeight;
      layer.classList.toggle('lg-tour-dim', !b.target);
      if (!b.target) { card.style.left = Math.max(16, (vw - cw) / 2) + 'px'; card.style.top = Math.max(16, (vh - ch) / 2) + 'px'; return; }
      var r = b.target.getBoundingClientRect(), pad = 6;
      spot.style.left = (r.left - pad) + 'px'; spot.style.top = (r.top - pad) + 'px';
      spot.style.width = (r.width + 2 * pad) + 'px'; spot.style.height = (r.height + 2 * pad) + 'px';
      var top = r.bottom + 14 + ch <= vh - 16 ? r.bottom + 14 : r.top - 14 - ch >= 16 ? r.top - 14 - ch : vh - ch - 16;
      card.style.top = Math.max(16, top) + 'px';
      card.style.left = Math.min(Math.max(16, r.left), Math.max(16, vw - cw - 16)) + 'px';
    }
    function show(k) {
      if (k >= beats.length) { end(); return; }
      var b = beats[i = k];
      who.textContent = b.who || a.name;
      av.src = BASE + (b.avatar || a.avatar);
      fig.hidden = !b.fig;
      if (b.fig) fig.src = BASE + b.fig;
      text.textContent = b.text;
      count.textContent = (i + 1) + ' of ' + beats.length;
      nextBtn.textContent = i === beats.length - 1 ? 'Done' : 'Next';
      if (b.target && b.target !== c.fixed) b.target.scrollIntoView({ block: 'center', behavior: 'auto' });
      place();
      nextBtn.focus();
    }
    function unhook() { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); layer.remove(); cover(false); }
    var forget = piece(function () { unhook(); release(); });
    function end() {
      forget(); unhook();
      release();
      if (c.after) c.after();
    }
    document.body.appendChild(layer);
    cover(true, false);
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    release = trap(card, end);
    show(0);
  }
  // LMCSGame.tour(beats, opts): the same tour outside mount (the floating Buddy's "Show me how"). beats = [{ target:
  // Element | CSS selector | null, text }]; opts = { session, backendUrl, tourId, campus, speaker, config?, after? };
  // gametourseen is posted when backendUrl and tourId are both set.
  function tour(beats, opts) {
    opts = opts || {};
    if (!(beats || []).length) return;
    var url = opts.backendUrl, id = String(opts.tourId || '');
    runTour(beats, { a: art({ campus: opts.campus, speaker: opts.speaker, config: opts.config }), after: opts.after,
      post: url && id ? function () { return postTo(url, opts.session, 'gametourseen', { tourId: id }); } : null });
  }

  // A Today row's small line: the mission's own `why`, else the page its link opens. Empty when a progress bar
  // already says the same ("2 of 4 classes done" next to a 2 of 4 bar).
  function smallLine(m) {
    var s = String((m && (m.why || sourceLabel(m.go))) || ''), p = m && m.progress;
    return p && p.total && s.indexOf(p.done + ' of ' + p.total) !== -1 ? '' : s;
  }

  // A decision window's small line: "Pick 3 of Mon–Sat", plus "· Buddy dresses to match" for the track-suit window
  function windowSmall(w) {
    var c = (w && w.choice) || {}, o = c.options || [];
    if (!c.n || !o.length) return '';
    return 'Pick ' + c.n + ' of ' + o[0] + '–' + o[o.length - 1] + (w.windowId === 'trackSuit' ? ' · Buddy dresses to match' : '');
  }

  // the decision sheet's live count: "2 of 3 picked", or "4 picked. Untick 1 to save." once over
  function pickedText(k, n) {
    return !n ? '' : k > n ? k + ' picked. Untick ' + (k - n) + ' to save.' : k + ' of ' + n + ' picked';
  }

  // The next-step bar's mission: when the server's next is in Today's set, the first open mission in panel order (so
  // the bar and the first solid Go agree); a mission from outside the set (arrived mid-day) is kept as the server sent it.
  // A module page's view of a gametoday response (mount's `only`): its own missions and quests, nothing of the home's
  function onlyModule(d, prefix) {
    var mine = function (m) { return !!m && String(m.kind || '').indexOf(prefix) === 0; };
    return Object.assign({}, d, {
      missions: (d.missions || []).filter(mine), next: mine(d.next) ? d.next : null,
      quests: (d.quests || []).filter(function (q) { return String(q.questId || '').indexOf(prefix) === 0; }),
      windows: [], daysOnTrack: null, firstLoadToday: false, // no greeting, so no home tour either
    });
  }

  function nextMission(today) {
    var nx = today && today.next;
    if (!nx) return null;
    var inSet = ((today.missions || []).some(function (m) { return m.id === nx.id; }));
    if (!inSet) return nx;
    var first = openItems(today).filter(function (x) { return x.m; })[0];
    return first ? first.m : nx;
  }

  // A page whose Today lives out of sight (the Principal home's sheet) points the greeting and first-visit tours at visible controls:
  // { today, go, bar, quest }: a CSS selector, or null to skip that beat. A key left out keeps the default target.
  var tourTargets = {};
  function tt(k, d) { return k in tourTargets ? tourTargets[k] : d; }
  function seen(x) { var e = typeof x === 'string' ? document.querySelector(x) : x; return !!(e && (typeof x !== 'string' || e.getClientRects().length)); } // a stand-in that isn't on screen yet skips its beat

  function mount(el, opts) {
    opts = opts || {};
    if (live) live.teardown();
    live = null;
    el.textContent = '';
    el.hidden = true; // shown only once there is something to show
    if (!opts.backendUrl) return;
    var me = live = { parts: [], bar: null, teardown: function () { me.parts.slice().reverse().forEach(function (f) { f(); }); me.parts = []; me.bar = null; } };
    var session = opts.session || {}, root = opts.root || '', url = opts.backendUrl, now = new Date(), n = ++uid;
    var t = null, todayEl = null, questEl = null, parEls = [], rootEl = null, qid = 0;
    // a body-level piece of this mount: remove() runs on remount; returns forget() for when the piece closes itself
    function piece(remove) {
      me.parts.push(remove);
      return function () { var i = me.parts.indexOf(remove); if (i !== -1) me.parts.splice(i, 1); };
    }
    // while a layer is open the next-step bar can't be reached: hidden under the greeting and the decision card,
    // inert (still visible, for its tour beat) under the tour
    function cover(on, hide) {
      document.body.classList.toggle('lg-modal-open', !!(on && hide));
      if (me.bar) me.bar.inert = !!on;
    }

    function get_() {
      return fetch(url + (url.indexOf('?') === -1 ? '?' : '&') + 'action=gametoday&idToken=' + encodeURIComponent(session.idToken || '') + viewParam(), { cache: 'no-store' })
        .then(function (r) { return r.json(); });
    }
    function post_(action, body) { return postTo(url, session, action, body); }

    function failed() {
      me.teardown();
      el.textContent = '';
      el.hidden = false;
      el.appendChild(h('div', { class: 'lg-root' }, h('section', { class: 'lg-panel lg-error' }, [
        h('p', {}, ERROR_LINE),
        h('button', { type: 'button', class: 'lg-btn lg-btn-alt', onclick: load }, 'Try again'),
      ])));
    }
    // the host page never sees a throw from here
    function safeStart(d) {
      try { start(d); } catch (e) { failed(); }
    }
    function load() {
      me.teardown();
      el.textContent = '';
      el.hidden = false;
      el.appendChild(h('div', { class: 'lg-root' }, h('section', { class: 'lg-panel lg-skel', 'aria-busy': 'true', 'aria-label': "Loading today's list" },
        [0, 1, 2].map(function () { return h('div', { class: 'lg-skel-row' }, [h('i'), h('b')]); }))));
      get_().then(function (d) {
        if (live !== me) return;
        if (d && d.error === 'Not authorized') d = { notYet: true }; // not a portal person for this game: nothing to show, not an error
        if (!d || d.success === false) { failed(); return; }
        safeStart(d);
      }, function () { if (live === me) failed(); });
    }

    // ── Today rows ──
    function tags(list) {
      return list.filter(Boolean).map(function (x) { return h('span', { class: 'lg-tag lg-tag-' + x[0] }, x[1]); });
    }
    // a row's one meta line under the title: tags, then the small text
    function meta(tagEls, small) {
      return tagEls.length || small ? h('span', { class: 'lg-meta' }, [tagEls, small && h('small', {}, small)]) : null;
    }
    function missionRow(m) {
      var href = safeHref(m.go, root), finished = m.done || m.gone, small = smallLine(m);
      var p = m.progress && m.progress.total ? m.progress : null;
      return h('li', { class: 'lg-row' + (finished ? ' lg-done' : '') }, [
        h('div', { class: 'lg-t' }, [
          h('span', { class: 'lg-title' }, m.title),
          meta(tags([m.core && !finished && ['core', 'core'], m.rolledOver && !finished && ['roll', 'from yesterday'], m.shared && ['shared', 'shared'],
            m.due && !finished && ['due', 'due ' + dateLabel(m.due)]]), small),
          p && !finished && h('span', { class: 'lg-mini' }, [
            h('span', { class: 'lg-track', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.min(100, Math.round(100 * p.done / p.total)) + '%' })),
            h('span', { class: 'lg-mini-n' }, p.done + ' of ' + p.total),
          ]),
        ]),
        finished ? h('span', { class: 'lg-tick' + (m.done ? '' : ' lg-tick-muted') }, m.done ? 'Done' : 'Not needed')
          : href && h('a', { class: 'lg-go', href: href, 'aria-label': 'Go: ' + m.title }, 'Go'),
      ]);
    }
    function windowRow(w) {
      var title = w.title;
      return h('li', { class: 'lg-row' + (w.decided ? ' lg-done' : '') }, [
        h('div', { class: 'lg-t' }, [
          h('span', { class: 'lg-title' }, title),
          meta(tags([!w.decided && w.closes && ['dec', 'closes ' + w.closes]]), windowSmall(w)),
        ]),
        w.decided ? h('span', { class: 'lg-tick' }, 'Done')
          : h('button', { type: 'button', class: 'lg-go', 'aria-label': 'Go: ' + title, disabled: !!viewAs(), onclick: function () { decide(w, this); } }, 'Go'),
      ]);
    }

    // ── panels: Today, the open quest, the days line ──
    function renderPanels() {
      var all = t.missions || [], ws = t.windows || [];
      var ms = all.filter(function (m) { return !m.gone; });
      var total = ms.length + ws.length;
      var done = ms.filter(function (m) { return m.done; }).length + ws.filter(function (w) { return w.decided; }).length;
      var rows = openItems(t).map(function (x) { return x.m ? missionRow(x.m) : windowRow(x.w); })
        .concat(ms.filter(function (m) { return m.done; }).map(missionRow))
        .concat(ws.filter(function (w) { return w.decided; }).map(windowRow))
        .concat(all.filter(function (m) { return m.gone; }).map(missionRow));
      var segs = [];
      for (var i = 0; i < total; i++) segs.push(h('i', { class: i < done ? 'on' : null }));
      todayEl = h('section', { class: 'lg-panel lg-today', 'aria-labelledby': 'lg-today-h' + n }, [
        h('div', { class: 'lg-ph' }, [h('h2', { id: 'lg-today-h' + n, tabindex: '-1' }, opts.title || 'Today'), total ? h('small', {}, done + ' of ' + total + ' done') : null]),
        total >= 2 ? h('div', { class: 'lg-bar', 'aria-hidden': 'true' }, segs) : null,
        (t.sourcesDown || []).length ? h('p', { class: 'lg-down' }, DOWN_LINE) : null,
        rows.length ? h('ul', { class: 'lg-rows' }, rows)
          : h('p', { class: 'lg-clear' }, t.next ? "Today's list is done. One more just came in." : 'All clear. Nothing is waiting today.'),
      ]);
      // one solid Go: the first open row's; the rest are quiet
      [].slice.call(todayEl.querySelectorAll('.lg-go')).slice(1).forEach(function (g) { g.classList.add('lg-go-soft'); });
      questEl = questPanel();
      parEls = parallelQuests();
      var days = daysLine(t.daysOnTrack), cut = days.indexOf(' Last month: ');
      el.textContent = '';
      el.hidden = false;
      // a module page with no missions of its own (e.g. the Owner, quests only): no Today box, and nothing at all without quests
      if (opts.only && !all.length) { todayEl.hidden = true; if (!questEl && !parEls.length) { el.hidden = true; return; } }
      rootEl = h('div', { class: 'lg-root' }, [todayEl, questEl, parEls, days && h('p', { class: 'lg-days' },
        cut === -1 ? days : [days.slice(0, cut), ' ', h('span', { class: 'lg-days-last' }, days.slice(cut + 1))])]);
      el.appendChild(rootEl);
    }
    // The sequential quest: the first unfinished one that isn't parallel, numbered; once all are finished, the last one
    // with its reward. Parallel quests (q.parallel, set by a module: one chapter quest per class-subject) are listed
    // after it while open, unnumbered, each folded in a <details> with the first one open.
    function questPanel() {
      var qs = (t.quests || []).filter(function (q) { return !q.parallel; }), i = 0;
      while (i < qs.length - 1 && qs[i].complete) i++;
      return qs[i] ? questSection(qs[i], 'Quest ' + (i + 1) + ' \u00b7 ' + qs[i].title, null) : null;
    }
    function parallelQuests() {
      return (t.quests || []).filter(function (q) { return q.parallel && !q.complete; })
        .map(function (q, k) { return questSection(q, q.title, k === 0 ? 'open' : 'shut'); }).filter(Boolean);
    }
    // One quest. The first open, unlocked, not-waiting step is a link to where it is done (a decision step: a button that
    // opens the decision card for the first undecided window, plain text when there is none); locked steps say they open
    // next; a waiting step (s.waiting, e.g. "checking overnight") is muted text and never the next action.
    function questSection(q, heading, fold) {
      if (!(q.steps || []).length) return null;
      var done = q.steps.filter(function (s) { return s.done; }).length, linked = false, hid = 'lg-quest-h' + n + '-' + (++qid);
      var head = [h('h2', { id: hid }, heading), h('small', {}, done + ' of ' + q.steps.length)];
      var list = h('ul', { class: 'lg-steps' }, q.steps.map(function (s) {
        var wait = s.waiting && !s.done, open = !s.done && !s.locked && !wait && !linked, win = null, href = null;
        if (open && s.kind === 'decision') win = (t.windows || []).filter(function (w) { return !w.decided; })[0] || null;
        else if (open) href = safeHref(s.go, root);
        if (open && !href && !win && /^[\w-]+$/.test(s.guide || '')) href = root + 'guide/index.html#' + s.guide; // no usable go: the guide says what to click
        if (href || win) linked = true;
        return h('li', { class: 'lg-step' + (s.done ? ' ok' : wait ? ' wait' : s.locked ? ' lock' : '') }, [
          h('span', { class: 'lg-c', 'aria-hidden': 'true' }),
          href ? h('a', { class: 'lg-step-link', href: href }, s.title)
            : win ? h('button', { type: 'button', class: 'lg-step-link', disabled: !!viewAs(), onclick: function () { decide(win, this); } }, s.title)
            : s.tick && !s.done ? h('button', { type: 'button', class: 'lg-step-link', disabled: !!viewAs(), onclick: function () { tick(q, s, this); } }, s.title)
            : h('span', {}, s.locked && !s.done && !wait ? 'Opens next: ' + s.title : s.title),
          s.done ? h('span', { class: 'lg-sr' }, ' (done)') : null,
        ]);
      }));
      var reward = q.complete && q.reward ? h('p', { class: 'lg-reward' }, q.reward) : null;
      if (!fold) return h('section', { class: 'lg-panel lg-quest', 'aria-labelledby': hid }, [h('div', { class: 'lg-ph' }, head), list, reward]);
      return h('details', { class: 'lg-panel lg-quest', open: fold === 'open' }, [h('summary', { class: 'lg-ph' }, head), list, reward]);
    }

    // ── the next-step bar: on document.body, reserving its own height as body padding; on desktop its content
    //    lines up with the panel ──
    function renderBar(a) {
      var m = nextMission(t), href = m && safeHref(m.go, root);
      if (!href) return;
      var body = document.body, old = body.style.paddingBottom, base = parseFloat(getComputedStyle(body).paddingBottom) || 0;
      var inner = h('div', { class: 'lg-nextbar-in' }, [
        img(a.avatar, 'lg-av'),
        h('div', { class: 'lg-t' }, [h('b', {}, 'Next'), h('span', { class: 'lg-title' }, m.title)]),
        h('a', { class: 'lg-go', href: href, 'aria-label': 'Go: ' + m.title }, 'Go'),
      ]);
      var bar = h('nav', { class: 'lg-nextbar', 'aria-label': 'Next step' }, inner);
      body.appendChild(bar);
      function fit() {
        var r = rootEl && document.documentElement.clientWidth >= 768 ? rootEl.getBoundingClientRect() : null;
        inner.style.maxWidth = r ? r.width + 'px' : '';
        inner.style.marginLeft = r ? Math.max(0, r.left - (parseFloat(getComputedStyle(bar).paddingLeft) || 0)) + 'px' : '';
        body.style.paddingBottom = (base + bar.offsetHeight) + 'px';
      }
      fit();
      var ro = window.ResizeObserver ? new ResizeObserver(fit) : null;
      if (ro) ro.observe(bar);
      window.addEventListener('resize', fit);
      me.bar = bar;
      piece(function () {
        if (ro) ro.disconnect();
        window.removeEventListener('resize', fit);
        bar.remove();
        body.style.paddingBottom = old;
        body.classList.remove('lg-modal-open');
      });
    }

    // ── the greeting, on the day's first load. Show me -> (the tour, on a first visit) -> Today's first Go ──
    function greet(a, firstVisit, beats) {
      var first = openItems(t)[0], release;
      var btns = first ? [
        h('button', { type: 'button', class: 'lg-btn', onclick: function () { close(true); } }, 'Show me'),
        h('button', { type: 'button', class: 'lg-btn lg-btn-alt', onclick: function () { close(); } }, 'Later'),
      ] : [h('button', { type: 'button', class: 'lg-btn', onclick: function () { close(); } }, 'Thanks')];
      var layer = h('div', { class: 'lg-layer lg-greet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'lg-g-who' + n, 'aria-describedby': 'lg-g-line' + n }, [
        h('button', { type: 'button', class: 'lg-skip', onclick: function () { close(); } }, 'Skip'),
        h('div', { class: 'lg-greet-box' }, [
          img(a.figure, 'lg-fig'),
          h('div', { class: 'lg-say' }, [
            h('div', { class: 'lg-who', id: 'lg-g-who' + n }, a.name),
            h('div', { id: 'lg-g-line' + n }, [
              h('p', {}, greetingLine(t, session, now)),
              first && h('p', { class: 'lg-first' }, [h('span', { class: 'lg-first-k' }, 'First up'), h('span', { class: 'lg-first-t' }, first.title)]),
            ]),
            h('div', { class: 'lg-btns' }, btns),
          ]),
        ]),
      ]);
      var forget = piece(function () { layer.remove(); cover(false); release(); });
      function showMe() {
        var vis = 'today' in tourTargets && tourTargets.today && document.querySelector(tourTargets.today); // the visible stand-in for Today
        if (vis) { vis.focus({ preventScroll: true }); return; }
        var target = todayEl.querySelector('.lg-go') || todayEl.querySelector('h2');
        todayEl.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
        target.focus({ preventScroll: true });
      }
      function close(show) {
        forget(); layer.remove(); cover(false);
        if (!show) { release(); return; }
        release(false);
        if (firstVisit && beats.length) tour(beats, showMe); else showMe();
      }
      document.body.appendChild(layer);
      cover(true, true);
      release = trap(layer, function () { close(); });
      layer.querySelector('.lg-btn').focus();
    }

    // ── the first-visit home tour: a spotlight on each target in turn; Skip is always there ──
    function tourBeats(a) {
      var beats = [], go = tt('go', todayEl.querySelector('.lg-go'));
      if (t.speaker === 'teacher-owl') {
        beats.push({ who: 'Buddy', avatar: art({ campus: t.campus, config: t.config }, now).avatar, fig: a.figure,
          text: "Here's the Teacher Owl, who knows your classroom best. I'll hand over now." });
      }
      if (seen(tt('today', todayEl))) beats.push({ target: tt('today', todayEl), text: 'This is Today: the work waiting for you, taken from the portal itself. A row shows Done once the work is done.' });
      if (go) beats.push({ target: go, text: 'Go opens the page where that work happens.' });
      if (seen(tt('bar', me.bar))) beats.push({ target: tt('bar', me.bar), text: 'bar' in tourTargets ? 'Your tasks slide out from this tab: town, wilderness and daily.' : 'The next step always sits in this bar at the bottom.' });
      if (tt('quest', questEl || parEls[0])) beats.push({ target: tt('quest', questEl || parEls[0]), text: 'Your first quest: a few real tasks that show you around the portal. New steps open as you finish them.' });
      return beats;
    }
    function tour(beats, after, tourId) {
      runTour(beats, { a: art(t, now), after: after, cover: cover, piece: piece, fixed: me.bar,
        post: function () { return post_('gametourseen', { tourId: tourId || 'home-' + (t.role || '') }); } });
    }

    // ── the decision card: the question, what stands now, the options, an optional note, Save ──
    // An Owner tick-off step (s.tick): the tap asks to confirm, then POST ownertick; the row turns done in place, and the
    // reward shows when it was the last step (no re-render: a finished parallel quest would vanish before it was seen).
    function tick(q, s, btn) {
      if (!window.confirm('Mark done: ' + s.title + '?')) return;
      var li = btn.closest('li'), say = function (msg) { var p = h('p', { class: 'lg-saved', role: 'status' }, msg); li.appendChild(p); return p; };
      btn.disabled = true;
      post_('ownertick', { questId: q.questId, stepId: s.id }).then(function (r) {
        if (live !== me) return;
        if (!r || !r.success) { btn.disabled = false; say((r && r.error) || "That didn't save. Try again."); return; }
        s.done = true; q.complete = q.steps.every(function (x) { return x.done; });
        li.className = 'lg-step ok';
        btn.replaceWith(h('span', {}, s.title), h('span', { class: 'lg-sr' }, ' (done)'));
        if (q.complete && q.reward) li.parentNode.after(h('p', { class: 'lg-reward', role: 'status' }, q.reward));
        else say('Done.');
      }).catch(function () {
        if (live !== me) return;
        btn.disabled = false; say("Couldn't reach the school's server. Nothing was saved. Try again.");
      });
    }
    function decide(w, fromBtn) {
      var c = w.choice || {}, cur = Array.isArray(w.current) ? w.current : [], id = 'lg-d' + n, release;
      var suit = w.windowId === 'trackSuit';
      var err = h('p', { class: 'lg-err', role: 'alert' });
      var nowLine = (cur.length || w.closes) ? h('p', { class: 'lg-now' }, [cur.length ? 'Now: ' + joinList(cur) + '. ' : '',
        w.closes ? 'If nobody decides by ' + w.closes + ', ' + (cur.length ? 'these stay.' : 'the default applies.') : '']) : null;
      var inputs = (c.options || []).map(function (o) { return h('input', { type: 'checkbox', name: 'pick', value: o, checked: cur.indexOf(o) !== -1 }); });
      var picked = h('span', { class: 'lg-picked', 'aria-live': 'polite' });
      var note = h('textarea', { id: id + '-note', rows: '2', maxlength: '500' });
      var submit = h('button', { type: 'submit', class: 'lg-btn' }, suit ? 'Save days' : 'Save');
      var busy = false;
      function count() {
        var k = inputs.filter(function (x) { return x.checked; }).length;
        picked.textContent = pickedText(k, c.n);
        picked.classList.toggle('lg-picked-over', !!c.n && k > c.n);
        submit.disabled = busy || (c.n ? k !== c.n : false);
      }
      var form = h('form', { onchange: count, onsubmit: function (e) {
        e.preventDefault();
        var value = inputs.filter(function (x) { return x.checked; }).map(function (x) { return x.value; });
        err.textContent = '';
        busy = true; count();
        post_('gamedecide', { windowId: w.windowId, scopeId: w.scopeId, value: value, note: note.value }).then(function (r) {
          if (live !== me) return;
          busy = false;
          if (!r || !r.success) { err.textContent = (r && r.error) || "That didn't save. Try again."; count(); return; }
          w.decided = { value: value }; w.current = value;
          renderPanels();
          if (nowLine) nowLine.remove();
          var ok = h('button', { type: 'button', class: 'lg-btn', onclick: function () { close(); } }, 'Done');
          form.replaceWith(h('div', { role: 'status' }, [
            h('p', { class: 'lg-saved' }, [img(suit ? 'buddy/avatar-tracksuit-' + (/summer/.test(outfit(now, t.campus, t.config)) ? 'summer' : 'winter') + '.webp'
              : art({ campus: t.campus, config: t.config }, now).avatar, 'lg-av lg-av-40'),
              h('span', { class: 'lg-ok' }, suit ? 'Saved. Buddy wears the track suit on ' + joinList(value) + '.' : 'Saved.')]),
            h('div', { class: 'lg-btns' }, ok),
          ]));
          ok.focus();
        }).catch(function () {
          if (live !== me) return;
          busy = false; err.textContent = "Couldn't reach the school's server. Nothing was saved. Try again."; count();
        });
      } }, [
        h('fieldset', { class: 'lg-opts' }, [h('legend', {}, [c.n ? 'Pick ' + c.n + (suit ? ' days' : '') : 'Pick', ' ', picked]),
          h('div', { class: 'lg-opt-grid' }, inputs.map(function (x) { return h('label', { class: 'lg-opt' }, [x, h('span', {}, x.value)]); }))]),
        h('label', { class: 'lg-label', for: note.id }, 'Note (optional)'), note,
        err,
        h('div', { class: 'lg-btns' }, [submit, h('button', { type: 'button', class: 'lg-btn lg-btn-alt', onclick: function () { close(); } }, 'Cancel')]),
      ]);
      count();
      var box = h('div', { class: 'lg-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id + '-h' }, [
        h('h2', { id: id + '-h' }, w.title),
        w.question && h('p', {}, w.question),
        nowLine,
        form,
      ]);
      var layer = h('div', { class: 'lg-layer lg-modal-layer' }, box);
      var forget = piece(function () { layer.remove(); cover(false); release(); });
      function close() {
        forget(); layer.remove(); cover(false);
        release(document.contains(fromBtn) ? fromBtn : todayEl.querySelector('h2'));
      }
      document.body.appendChild(layer);
      cover(true, true);
      release = trap(box, close);
      (inputs[0] || submit).focus();
    }

    function start(d) {
      last = d; // LMCSGame.last(): the floating Buddy reads it instead of asking the backend again
      if (d.notYet) { el.textContent = ''; el.hidden = true; return; }
      t = opts.only ? onlyModule(d, String(opts.only)) : d;
      // the game bar (rail.js) counts from the whole day, so a module page's filtered view doesn't announce
      if (!opts.only) try { document.dispatchEvent(new CustomEvent('lmcs-game-today', { detail: d })); } catch (_) { /* old browser: the bar keeps its counts */ }
      var firstVisit = (t.toursSeen || []).indexOf('home-' + (t.role || '')) === -1;
      var a = art(t, now, firstVisit);
      renderPanels();
      renderBar(a);
      if (t.firstLoadToday) greet(a, firstVisit, tourBeats(a));
      else if (pageTour && (t.toursSeen || []).indexOf(pageTour.id) === -1) tour(pageTour.beats, null, pageTour.id);
    }
    // a module page's own first-visit tour (mount's `tour`): each beat spotlights its selector, or sits centred when absent
    var pageTour = opts.tour && /^[\w-]{1,60}$/.test(String(opts.tour.id || '')) && (opts.tour.beats || []).length ? opts.tour : null;

    if (opts.data) safeStart(opts.data); else load();
  }

  return { outfit: outfit, greetingLine: greetingLine, daysLine: daysLine, joinList: joinList, dateLabel: dateLabel,
    safeHref: safeHref, sourceLabel: sourceLabel, art: art, openItems: openItems, smallLine: smallLine, windowSmall: windowSmall, pickedText: pickedText, nextMission: nextMission, onlyModule: onlyModule, mount: mount, tour: tour, setTourTargets: function (t) { tourTargets = t || {}; }, last: function () { return last; },
    viewAs: viewAs, setViewAs: setViewAs, viewParam: viewParam,
    ui: { h: h, img: img, trap: trap, reduced: reduced } }; // ui: the DOM helpers, shared with assets/game/buddy-dock.js
})();
