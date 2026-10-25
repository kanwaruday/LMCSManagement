// Game layer front end (Buddy). Pure helpers first, then LMCSGame.mount(el, opts): the once-a-day greeting, the
// Today panel, the next-step bar, the quest panel, the decision card and the first-visit tour.
// Everything date-based is read in IST (UTC+5:30), never the browser's own time zone.
// Host page: <link rel="stylesheet" href=".../assets/game/game.css"> + <script src=".../assets/game/game.js">, then
//   LMCSGame.mount(el, { session, backendUrl, root?, data? }) after the page's own content has rendered.
//   root = the portal root relative to the page ('' on the home page, '../' one folder down): mission links are
//   root-relative. data = a gametoday response, to skip the fetch. Empty backendUrl = render nothing.
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

  // "Good morning, Meena. 2 things are waiting today. The first is X." now is optional (tests); defaults to the clock.
  // No "The first is" when the first mission has no title; a title that already ends in . ! ? gets no second stop.
  function greetingLine(today, session, now) {
    var h = ist_(now || new Date()).getUTCHours();
    var hello = h >= 17 ? 'Good evening' : h >= 12 ? 'Good afternoon' : 'Good morning';
    var first = String((session && session.name) || '').trim().split(/\s+/)[0];
    var ms = (today && today.missions) || [];
    var line = hello + (first ? ', ' + first : '') + '. ';
    if (!ms.length) return line + 'Nothing is waiting today. Enjoy the calm.';
    var title = String((ms[0] && ms[0].title) || '').trim();
    return line + ms.length + (ms.length === 1 ? ' thing is' : ' things are') + ' waiting today.' +
      (title ? ' The first is ' + title + (/[.!?]$/.test(title) ? '' : '.') : '');
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

  // A mission link: a root-relative portal path, an absolute path, or http(s). Anything else (javascript:, //host) -> null.
  function safeHref(go, root) {
    go = String(go || '').trim();
    if (!go || /^[/\\]{2}/.test(go) || go.charAt(0) === '\\') return null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(go)) return /^https?:/i.test(go) ? go : null;
    return go.charAt(0) === '/' ? go : (root || '') + go;
  }

  // the portal page a mission's link opens, as the small line names it
  var SOURCES = [['principals-daily-reporting', 'Daily Reporting'], ['coordinator/followups', 'Follow-ups'],
    ['coordinator/approvals', 'Approvals'], ['principal/issues', 'Issues'], ['teacher/', 'My Classroom']];
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
  var DOWN_LINE = "Some of today's list couldn't load; I'll try again later.";
  // art paths resolve next to this script, whatever page loads it
  var BASE = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src || '').replace(/[^/?#]*([?#].*)?$/, '');
  var uid = 0, live = null; // live = the current mount: its body-level pieces, torn down on remount

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

  function mount(el, opts) {
    opts = opts || {};
    if (live) live.teardown();
    live = null;
    el.textContent = '';
    if (!opts.backendUrl) return;
    var me = live = { parts: [], bar: null, teardown: function () { me.parts.slice().reverse().forEach(function (f) { f(); }); me.parts = []; } };
    var session = opts.session || {}, root = opts.root || '', url = opts.backendUrl, now = new Date(), n = ++uid;
    var t = null, todayEl = null, questEl = null;
    // a body-level piece of this mount: remove() runs on remount; returns forget() for when the piece closes itself
    function piece(remove) {
      me.parts.push(remove);
      return function () { var i = me.parts.indexOf(remove); if (i !== -1) me.parts.splice(i, 1); };
    }

    function get_() {
      return fetch(url + (url.indexOf('?') === -1 ? '?' : '&') + 'action=gametoday&idToken=' + encodeURIComponent(session.idToken || ''), { cache: 'no-store' })
        .then(function (r) { return r.json(); });
    }
    function post_(action, body) {
      // a string body goes as text/plain: no CORS preflight to Apps Script
      return fetch(url, { method: 'POST', body: JSON.stringify(Object.assign({ action: action, idToken: session.idToken }, body)) })
        .then(function (r) { return r.json(); });
    }

    function load() {
      el.textContent = '';
      el.appendChild(h('div', { class: 'lg-root' }, h('section', { class: 'lg-panel lg-skel', 'aria-busy': 'true', 'aria-label': "Loading today's list" },
        [0, 1, 2].map(function () { return h('div', { class: 'lg-skel-row' }, [h('i'), h('b')]); }))));
      get_().then(function (d) {
        if (live !== me) return;
        if (!d || d.success === false) throw new Error('gametoday');
        start(d);
      }).catch(function () {
        if (live !== me) return;
        el.textContent = '';
        el.appendChild(h('div', { class: 'lg-root' }, h('section', { class: 'lg-panel lg-error' }, [
          h('p', {}, "Today's list couldn't load."),
          h('button', { type: 'button', class: 'lg-btn lg-btn-alt', onclick: load }, 'Retry'),
        ])));
      });
    }

    // ── Today rows ──
    function tags(list) {
      return list.filter(Boolean).map(function (x) { return [' ', h('span', { class: 'lg-tag lg-tag-' + x[0] }, x[1])]; });
    }
    function missionRow(m) {
      var href = safeHref(m.go, root), finished = m.done || m.gone;
      var small = [m.why, sourceLabel(m.go)].filter(Boolean).join(' · ');
      var p = m.progress && m.progress.total ? m.progress : null;
      return h('li', { class: 'lg-row' + (finished ? ' lg-done' : '') }, [
        h('div', { class: 'lg-t' }, [
          h('span', { class: 'lg-title' }, m.title),
          tags([m.rolledOver && !finished && ['roll', 'from yesterday'], m.shared && ['shared', 'shared'], m.due && !finished && ['dec', 'due ' + dateLabel(m.due)]]),
          small && h('small', {}, small),
          p && !finished && h('span', { class: 'lg-mini' }, [
            h('span', { class: 'lg-track', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.min(100, Math.round(100 * p.done / p.total)) + '%' })),
            h('span', { class: 'lg-mini-n', 'aria-label': p.done + ' of ' + p.total }, p.done + '/' + p.total),
          ]),
        ]),
        finished ? h('span', { class: 'lg-tick' }, m.done ? 'Done' : 'Not needed')
          : href && h('a', { class: 'lg-go', href: href, 'aria-label': 'Go: ' + m.title }, 'Go'),
      ]);
    }
    function windowRow(w) {
      var c = w.choice || {}, o = c.options || [], title = 'Decide: ' + w.title;
      return h('li', { class: 'lg-row' + (w.decided ? ' lg-done' : '') }, [
        h('div', { class: 'lg-t' }, [
          h('span', { class: 'lg-title' }, title),
          tags([!w.decided && w.closes && ['dec', 'closes ' + w.closes]]),
          c.n && o.length && h('small', {}, 'Pick ' + c.n + ' of ' + o[0] + '–' + o[o.length - 1]),
        ]),
        w.decided ? h('span', { class: 'lg-tick' }, 'Done')
          : h('button', { type: 'button', class: 'lg-go', 'aria-label': 'Go: ' + title, onclick: function () { decide(w, this); } }, 'Go'),
      ]);
    }

    // ── panels: Today, the open quest, the days line ──
    function renderPanels() {
      var all = t.missions || [], ws = t.windows || [];
      var ms = all.filter(function (m) { return !m.gone; });
      var total = ms.length + ws.length;
      var done = ms.filter(function (m) { return m.done; }).length + ws.filter(function (w) { return w.decided; }).length;
      var rows = ms.filter(function (m) { return !m.done; }).map(missionRow)
        .concat(ws.filter(function (w) { return !w.decided; }).map(windowRow))
        .concat(ms.filter(function (m) { return m.done; }).map(missionRow))
        .concat(ws.filter(function (w) { return w.decided; }).map(windowRow))
        .concat(all.filter(function (m) { return m.gone; }).map(missionRow));
      var segs = [];
      for (var i = 0; i < total; i++) segs.push(h('i', { class: i < done ? 'on' : null }));
      todayEl = h('section', { class: 'lg-panel lg-today', 'aria-labelledby': 'lg-today-h' + n }, [
        h('div', { class: 'lg-ph' }, [h('h2', { id: 'lg-today-h' + n, tabindex: '-1' }, 'Today'), total ? h('small', {}, done + ' of ' + total + ' done') : null]),
        total ? h('div', { class: 'lg-bar', 'aria-hidden': 'true' }, segs) : null,
        (t.sourcesDown || []).length ? h('p', { class: 'lg-down' }, DOWN_LINE) : null,
        rows.length ? h('ul', { class: 'lg-rows' }, rows) : h('p', { class: 'lg-clear' }, 'All clear. Nothing is waiting today.'),
      ]);
      questEl = questPanel();
      var days = daysLine(t.daysOnTrack);
      el.textContent = '';
      el.appendChild(h('div', { class: 'lg-root' }, [todayEl, questEl, days && h('p', { class: 'lg-days' }, days)]));
    }
    // the open quest (the first unfinished one); once every quest is finished, the last one with its reward
    function questPanel() {
      var qs = t.quests || [], i = 0;
      while (i < qs.length - 1 && qs[i].complete) i++;
      var q = qs[i];
      if (!q || !(q.steps || []).length) return null;
      var done = q.steps.filter(function (s) { return s.done; }).length;
      return h('section', { class: 'lg-panel lg-quest', 'aria-labelledby': 'lg-quest-h' + n }, [
        h('div', { class: 'lg-ph' }, [h('h2', { id: 'lg-quest-h' + n }, 'Quest ' + (i + 1) + ' · ' + q.title), h('small', {}, done + ' of ' + q.steps.length)]),
        h('ul', { class: 'lg-steps' }, q.steps.map(function (s) {
          return h('li', { class: 'lg-step' + (s.done ? ' ok' : s.locked ? ' lock' : '') }, [
            h('span', { class: 'lg-c', 'aria-hidden': 'true' }),
            h('span', {}, s.locked && !s.done ? 'Locked · ' + s.title : s.title),
            s.done ? h('span', { class: 'lg-sr' }, ' (done)') : null,
          ]);
        })),
        q.complete && q.reward ? h('p', { class: 'lg-reward' }, q.reward) : null,
      ]);
    }

    // ── the next-step bar: on document.body, reserving its own height as body padding ──
    function renderBar(a) {
      var m = t.next, href = m && safeHref(m.go, root);
      if (!href) return;
      var body = document.body, old = body.style.paddingBottom, base = parseFloat(getComputedStyle(body).paddingBottom) || 0;
      var bar = h('nav', { class: 'lg-nextbar', 'aria-label': 'Next step' }, h('div', { class: 'lg-nextbar-in' }, [
        img(a.avatar, 'lg-av'),
        h('div', { class: 'lg-t' }, [h('b', {}, 'Next'), h('span', { class: 'lg-title' }, m.title)]),
        h('a', { class: 'lg-go', href: href, 'aria-label': 'Go: ' + m.title }, 'Go'),
      ]));
      body.appendChild(bar);
      function pad() { body.style.paddingBottom = (base + bar.offsetHeight) + 'px'; }
      pad();
      var ro = window.ResizeObserver ? new ResizeObserver(pad) : null;
      if (ro) ro.observe(bar); else window.addEventListener('resize', pad);
      me.bar = bar;
      piece(function () {
        if (ro) ro.disconnect(); else window.removeEventListener('resize', pad);
        bar.remove();
        body.style.paddingBottom = old;
      });
    }

    // ── the greeting, on the day's first load. Show me -> (the tour, on a first visit) -> Today's first Go ──
    function greet(a, firstVisit, beats) {
      var release, layer = h('div', { class: 'lg-layer lg-greet' }, [
        h('button', { type: 'button', class: 'lg-skip', onclick: function () { close(); } }, 'Skip'),
        h('div', { class: 'lg-greet-box', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'lg-g-who' + n, 'aria-describedby': 'lg-g-line' + n }, [
          img(a.figure, 'lg-fig'),
          h('div', { class: 'lg-say' }, [
            h('div', { class: 'lg-who', id: 'lg-g-who' + n }, a.name),
            h('p', { id: 'lg-g-line' + n }, greetingLine(t, session, now)),
            h('div', { class: 'lg-btns' }, [
              h('button', { type: 'button', class: 'lg-btn', onclick: function () { close(true); } }, 'Show me'),
              h('button', { type: 'button', class: 'lg-btn lg-btn-alt', onclick: function () { close(); } }, 'Later'),
            ]),
          ]),
        ]),
      ]);
      var forget = piece(function () { layer.remove(); release(); });
      function showMe() {
        var target = todayEl.querySelector('.lg-go') || todayEl.querySelector('h2');
        todayEl.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
        target.focus({ preventScroll: true });
      }
      function close(show) {
        forget(); layer.remove();
        if (!show) { release(); return; }
        release(false);
        if (firstVisit && beats.length) tour(beats, showMe); else showMe();
      }
      document.body.appendChild(layer);
      release = trap(layer, function () { close(); });
      layer.querySelector('.lg-btn').focus();
    }

    // ── the first-visit home tour: a spotlight on each target in turn; Skip is always there ──
    function tourBeats(a) {
      var beats = [], go = todayEl.querySelector('.lg-go');
      if (t.speaker === 'teacher-owl') {
        beats.push({ who: 'Buddy', avatar: art({ campus: t.campus, config: t.config }, now).avatar, fig: a.figure,
          text: "Here's the Teacher Owl, who knows your classroom best. I'll hand over now." });
      }
      beats.push({ target: todayEl, text: 'This is Today: the work waiting for you, taken from the portal itself. A row shows Done once the work is done.' });
      if (go) beats.push({ target: go, text: 'Go opens the page where that work happens.' });
      if (me.bar) beats.push({ target: me.bar, text: 'The next step always sits in this bar at the bottom.' });
      if (questEl) beats.push({ target: questEl, text: 'Your first quest: a few real tasks that show you around the portal. New steps open as you finish them.' });
      return beats;
    }
    function tour(beats, after) {
      post_('gametourseen', { tourId: 'home-' + (t.role || '') }).catch(function () { /* offered again next time; nothing lost */ });
      var a = art(t, now), i = 0, release;
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
        if (b.target && b.target !== me.bar) b.target.scrollIntoView({ block: 'center', behavior: 'auto' });
        place();
        nextBtn.focus();
      }
      function unhook() { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); layer.remove(); }
      var forget = piece(function () { unhook(); release(); });
      function end() {
        forget(); unhook();
        release();
        if (after) after();
      }
      document.body.appendChild(layer);
      window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
      release = trap(card, end);
      show(0);
    }

    // ── the decision card: the question, what stands now, the options, an optional note, Decide ──
    function decide(w, fromBtn) {
      var c = w.choice || {}, cur = Array.isArray(w.current) ? w.current : [], id = 'lg-d' + n, release;
      var err = h('p', { class: 'lg-err', role: 'alert' });
      var nowLine = (cur.length || w.closes) ? h('p', { class: 'lg-now' }, [cur.length ? 'Now: ' + joinList(cur) + '. ' : '', w.closes ? 'Closes ' + w.closes + '; if nobody decides, the default applies.' : '']) : null;
      var inputs = (c.options || []).map(function (o) { return h('input', { type: 'checkbox', name: 'pick', value: o, checked: cur.indexOf(o) !== -1 }); });
      var note = h('textarea', { id: id + '-note', rows: '2', maxlength: '500' });
      var submit = h('button', { type: 'submit', class: 'lg-btn' }, 'Decide');
      var form = h('form', { onsubmit: function (e) {
        e.preventDefault();
        var value = inputs.filter(function (x) { return x.checked; }).map(function (x) { return x.value; });
        err.textContent = '';
        submit.disabled = true;
        post_('gamedecide', { windowId: w.windowId, scopeId: w.scopeId, value: value, note: note.value }).then(function (r) {
          if (!r || !r.success) { err.textContent = (r && r.error) || "That didn't save. Try again."; submit.disabled = false; return; }
          w.decided = { value: value }; w.current = value;
          renderPanels();
          if (nowLine) nowLine.remove();
          var ok = h('button', { type: 'button', class: 'lg-btn', onclick: function () { close(); } }, 'Close');
          form.replaceWith(h('div', { role: 'status' }, [
            h('p', { class: 'lg-ok' }, w.windowId === 'trackSuit' ? 'Saved. Buddy will wear the track suit on ' + joinList(value) + '.' : 'Saved.'),
            h('div', { class: 'lg-btns' }, ok),
          ]));
          ok.focus();
        }).catch(function () { err.textContent = "Couldn't reach the school's server. Nothing was saved. Try again."; submit.disabled = false; });
      } }, [
        h('fieldset', { class: 'lg-opts' }, [h('legend', {}, c.n ? 'Pick ' + c.n : 'Pick'),
          h('div', { class: 'lg-opt-grid' }, inputs.map(function (x) { return h('label', { class: 'lg-opt' }, [x, h('span', {}, x.value)]); }))]),
        h('label', { class: 'lg-label', for: note.id }, 'Note (optional)'), note,
        err,
        h('div', { class: 'lg-btns' }, [submit, h('button', { type: 'button', class: 'lg-btn lg-btn-alt', onclick: function () { close(); } }, 'Cancel')]),
      ]);
      var box = h('div', { class: 'lg-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id + '-h' }, [
        h('h2', { id: id + '-h' }, w.title),
        w.question && h('p', {}, w.question),
        nowLine,
        form,
      ]);
      var layer = h('div', { class: 'lg-layer lg-modal-layer' }, box);
      var forget = piece(function () { layer.remove(); release(); });
      function close() {
        forget(); layer.remove();
        release(document.contains(fromBtn) ? fromBtn : todayEl.querySelector('h2'));
      }
      document.body.appendChild(layer);
      release = trap(box, close);
      (inputs[0] || submit).focus();
    }

    function start(d) {
      if (d.notYet) { el.textContent = ''; return; }
      t = d;
      var firstVisit = (t.toursSeen || []).indexOf('home-' + (t.role || '')) === -1;
      var a = art(t, now, firstVisit);
      renderPanels();
      renderBar(a);
      if (t.firstLoadToday) greet(a, firstVisit, tourBeats(a));
    }

    if (opts.data) start(opts.data); else load();
  }

  return { outfit: outfit, greetingLine: greetingLine, daysLine: daysLine, joinList: joinList, dateLabel: dateLabel,
    safeHref: safeHref, sourceLabel: sourceLabel, art: art, mount: mount };
})();
