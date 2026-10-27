// The floating Buddy: a small help button in the bottom-right corner of every portal page. assets/auth.js loads this
// file (and buddy-dock.css) once someone is signed in; a page opts out with window.LMCS_NO_DOCK = true.
// The panel (a dialog: a bottom sheet on phones, a corner card on desktop) has 4 parts: what this page is for
// (LMCSGuide.pages), what's next for you (one gametoday, kept 5 minutes; hidden when there is nothing or it fails),
// "Show me how" (the page's tour, through LMCSGame.tour) and a guide search (LMCSGuide.articles).
// game.js, game.css and guide.js are loaded on the first open when the page doesn't have them.
// The button lifts above the next-step bar (.lg-nextbar) and above anything matching LMCSDock.avoid (default #lmcs-warm-chip; a CSS selector
// list), e.g. a page's toast. Every piece of text reaches the DOM as text nodes (LMCSGame.ui.h).
var LMCSDock = window.LMCSDock = (function () {
  // the game backend's Apps Script /exec: the same value as the pages' GAME_BACKEND_URL (tests/game/test-dock.js checks)
  var BACKEND = 'https://script.google.com/macros/s/AKfycbyyk7XpT86JqZRQ3ldFxesPw4ICK6WVAdsgsecEzWPViKasRs4agbYJ3Re_y_lY7mxyCA/exec';
  var KEEP_MS = 5 * 60000;

  // '/LMCSManagement/coordinator/x.html' -> 'coordinator/x.html'; a folder ('/LMCSManagement/') -> its index.html
  function pagePath(pathname, rootPath) {
    var p = String(pathname || '/');
    try { p = decodeURIComponent(p); } catch (e) { /* keep it as it is */ }
    p = rootPath && p.indexOf(rootPath) === 0 ? p.slice(rootPath.length) : p.replace(/^\/+/, '');
    return !p || /\/$/.test(p) ? p + 'index.html' : p;
  }
  // the way back up to the portal root: 'coordinator/x.html' -> '../'
  function rootFrom(path) { return new Array(String(path).split('/').length).join('../'); }
  // the page tour's Game Progress key; the backend accepts [\w-]{1,60}
  function tourId(path) { return ('page-' + String(path).replace(/[^\w-]/g, '-')).slice(0, 60); }
  // guide articles matching q (case-insensitive): title hits first, then body hits, at most 5
  function search(articles, q) {
    q = String(q || '').trim().toLowerCase();
    if (!q) return [];
    var title = [], body = [];
    (articles || []).forEach(function (a) {
      if (String(a.title || '').toLowerCase().indexOf(q) !== -1) title.push(a);
      else if ([].concat(a.body || []).join(' ').toLowerCase().indexOf(q) !== -1) body.push(a);
    });
    return title.concat(body).slice(0, 5);
  }
  // the first open step of the first unfinished setup quest (questId 'setup:...'), or null
  function setupStep(d) {
    var q = ((d && d.quests) || []).filter(function (x) { return String(x.questId || '').indexOf('setup:') === 0 && !x.complete; })[0];
    return (q && (q.steps || []).filter(function (s) { return !s.done && !s.locked && !s.waiting; })[0]) || null;
  }

  // ── Ask Buddy (Owner only): pure helpers; the UI is between the "Ask Buddy" markers in build()
  function deskState(desk) { return desk ? (desk.open ? 'open' : 'offline') : 'unknown'; }
  function threadLine(t, desk) {
    t = t || {};
    if (t.failReason === 'offline') return { who: 'status', text: "I couldn't finish that one. Please ask again." };
    if (t.state === 'queued') return { who: 'status', text: deskState(desk) === 'offline' ? 'Saved. Buddy will answer when the Mac wakes.' : 'Buddy is reading your question…' };
    if (t.state === 'working') return { who: 'status', text: 'Buddy is thinking…' };
    if (t.state === 'answered') return { who: 'buddy', text: t.reply || '' };
    return { who: 'status', text: "I couldn't finish that one. Please ask again." };
  }
  function proposalView(t) {
    var st = t && t.proposal && t.proposalState;
    var v = st && /^(open|confirmed|forwarded|declined|expired|failed)$/.test(st) ? { summary: t.proposal.summary || '', state: st } : null;
    if (v && st === 'failed') v.note = t.proposalNote || '';
    return v || null;
  }
  function pollDelay(threads, open) {
    return open && (threads || []).some(function (t) { return t.state === 'queued' || t.state === 'working' || t.proposalState === 'confirmed'; }) ? 5000 : 0;
  }

  var api = { deskState: deskState, threadLine: threadLine, proposalView: proposalView, pollDelay: pollDelay, avoid: '#lmcs-warm-chip, .bottom-nav', pagePath: pagePath, rootFrom: rootFrom, tourId: tourId, search: search, setupStep: setupStep, open: open };
  if (typeof document === 'undefined') return api; // tests: the helpers only

  // ═══ UI ═══════════════════════════════════════════════════════════
  var SRC = (document.currentScript && document.currentScript.src) || '';
  var BASE = SRC.replace(/[^/?#]*([?#].*)?$/, ''), V = (SRC.match(/\?[^#]*/) || [''])[0]; // .../assets/game/ and auth.js's ?v=
  var PATH = pagePath(location.pathname, (function () { try { return new URL(BASE + '../../').pathname; } catch (e) { return '/'; } })());
  var UP = rootFrom(PATH), GUIDE = UP + 'guide/index.html';
  var btn = null, av = null, panel = null, release = null, data = null, pollTimer = null;

  function session() { return (window.LMCS && LMCS.getSession && LMCS.getSession()) || null; }
  function owner() { return !!(window.LMCS && LMCS.canViewOwnerPortal && LMCS.canViewOwnerPortal(session())); }
  function key() { return 'lmcs_dock_today|' + ((session() || {}).email || ''); }
  function kept() {
    try { var c = JSON.parse(sessionStorage.getItem(key()) || 'null'); return c && Date.now() - c.t < KEEP_MS ? c.d : null; } catch (e) { return null; }
  }
  function keep(d) { try { sessionStorage.setItem(key(), JSON.stringify({ t: Date.now(), d: d })); } catch (e) { /* private mode: fetch again next open */ } }
  // today's gametoday: the page's own mount's, else the kept copy, else one fetch. null when there is nothing to show.
  function today() {
    var d = (window.LMCSGame && LMCSGame.last && LMCSGame.last()) || kept(), s = session();
    if (d) return Promise.resolve(d);
    if (!BACKEND || !s) return Promise.resolve(null);
    return fetch(BACKEND + '?action=gametoday&peek=1&idToken=' + encodeURIComponent(s.idToken || ''), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (!d || d.success === false || d.error) return null; keep(d); return d; })
      .catch(function () { return null; });
  }

  function load(tag, attrs, have) {
    if (have) return Promise.resolve();
    return new Promise(function (ok, fail) {
      var n = document.createElement(tag);
      Object.keys(attrs).forEach(function (k) { n[k] = attrs[k]; });
      n.onload = ok; n.onerror = fail;
      document.head.appendChild(n);
    });
  }
  function deps() {
    var css = [].some.call(document.styleSheets, function (s) { return /\/game\/game\.css/.test(s.href || ''); });
    return Promise.all([
      load('link', { rel: 'stylesheet', href: BASE + 'game.css' + V }, css).catch(function () { /* unstyled buttons still work */ }),
      load('script', { src: BASE + 'game.js' + V }, !!window.LMCSGame),
      load('script', { src: BASE + 'guide.js' + V }, !!window.LMCSGuide).catch(function () { /* the panel copes with no guide */ }),
    ]);
  }

  // Buddy in today's outfit (never the Teacher Owl: this is Buddy's button)
  function avatar(d) {
    if (d && window.LMCSGame) av.src = BASE + LMCSGame.art({ campus: d.campus, config: d.config }).avatar;
  }

  function open() {
    if (!session()) { close(); btn.remove(); return; }
    btn.setAttribute('aria-busy', 'true');
    deps().then(function () { if (!btn) return; btn.removeAttribute('aria-busy'); if (!panel) build(); },
      function () { if (btn) btn.removeAttribute('aria-busy'); if (navigator.onLine && PATH !== 'guide/index.html') location.href = GUIDE; }); // blocked while online: the guide page is the help that's left; offline it would not load either
  }
  function close(keepFocus) {
    if (!panel) return;
    clearTimeout(pollTimer); pollTimer = null; // no polling while closed
    panel.remove(); panel = null;
    btn.setAttribute('aria-expanded', 'false');
    release(keepFocus ? false : btn);
  }

  // POST one buddy action (never a GET: the backend refuses them); resolves the parsed JSON, rejects on a network failure
  function buddyPost(body) {
    var s = session() || {};
    body.idToken = s.idToken || '';
    return fetch(BACKEND, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) }).then(function (r) { return r.json(); });
  }

  // ═══ Ask Buddy (start) ═══
  function askSection(h) {
    var threads = [], desk = null, fails = 0, me = panel, signedOut = false;
    var banner = h('div', { class: 'bd-off', role: 'status' }), list = h('ul', { class: 'bd-threads' });
    var err = h('p', { class: 'bd-err', role: 'alert' });
    var box = h('textarea', { id: 'bd-ask', class: 'bd-ask', rows: 3, maxlength: 2000 });
    var send = h('button', { type: 'button', class: 'lg-btn bd-send', onclick: function () { ask(); } }, 'Send');
    function alive() { return panel === me; }
    function schedule() {
      clearTimeout(pollTimer); pollTimer = null;
      var d = signedOut ? 0 : pollDelay(threads, alive());
      if (d) pollTimer = setTimeout(refresh, Math.min(d * Math.pow(2, fails), 60000)); // backs off while the network fails
    }
    // a reply with no success and no code is the gate (e.g. "Not authorized": the sign-in expired), not a Buddy answer
    function gate(r) { if (r && !r.success && !r.code) { signedOut = true; err.textContent = 'Please sign in again.'; return true; } return false; }
    function decide(t, decision, btns) {
      btns.forEach(function (b) { b.disabled = true; }); // one tap only
      var again = function () { btns.forEach(function (b) { b.disabled = false; }); };
      buddyPost({ action: 'buddyconfirm', id: t.id, decision: decision }).then(function (r) {
        if (!alive()) return;
        if (gate(r)) return;
        if (r && r.success) refresh(); else { again(); err.textContent = (r && r.error) || 'Something went wrong. Try again.'; }
      }, function () { if (alive()) { again(); err.textContent = "Couldn't reach Buddy. Please try again."; } });
    }
    function draw() {
      banner.textContent = '';
      if (deskState(desk) === 'offline') banner.appendChild(h('p', {}, [h('strong', {}, 'Buddy is offline — the Mac is off.'), h('br', {}), 'Your message is saved and will be answered when it wakes.']));
      list.textContent = '';
      threads.slice(-5).forEach(function (t) {
        var line = threadLine(t, desk), pv = proposalView(t), extra = null, pair = [];
        if (pv && pv.state === 'open') {
          extra = h('div', { class: 'bd-prop' }, [h('p', {}, 'Send this to the master agent?'), h('p', { class: 'bd-sum' }, pv.summary),
            h('div', { class: 'bd-btns' }, [
              h('button', { type: 'button', class: 'lg-btn', onclick: function () { decide(t, 'confirm', pair); } }, 'Send to the master agent'),
              h('button', { type: 'button', class: 'lg-btn', onclick: function () { decide(t, 'decline', pair); } }, 'No thanks')])]);
          pair = [].slice.call(extra.querySelectorAll('button'));
        } else if (pv) {
          extra = h('p', { class: 'bd-status' }, pv.state === 'failed' ? pv.note : { confirmed: 'Sending to the master agent when the Mac is on…', forwarded: 'Sent to the master agent', declined: 'Not sent', expired: 'This request expired' }[pv.state]);
        }
        list.appendChild(h('li', { class: 'bd-th' }, [h('p', { class: 'bd-me' }, t.text), h('p', { class: 'bd-' + line.who }, line.text), extra]));
      });
    }
    function refresh() {
      pollTimer = null;
      if (!alive()) return;
      buddyPost({ action: 'buddythread' }).then(function (r) {
        if (!alive()) return;
        fails = 0;
        if (gate(r)) return;
        if (r && r.success) { threads = r.threads || []; desk = r.desk || null; draw(); }
        schedule();
      }, function () { if (alive()) { fails++; schedule(); } });
    }
    function ask() {
      var text = box.value.trim();
      if (!text) { err.textContent = 'Type a question first.'; return; }
      err.textContent = ''; send.disabled = true;
      buddyPost({ action: 'buddyask', text: text, context: { page: PATH } }).then(function (r) {
        send.disabled = false;
        if (!alive()) return;
        if (gate(r)) return;
        if (r && r.success) { box.value = ''; refresh(); } else err.textContent = (r && r.error) || 'Something went wrong. Try again.';
      }, function () { send.disabled = false; if (alive()) err.textContent = "Couldn't reach Buddy. Your words are still in the box."; });
    }
    setTimeout(refresh, 0); // after the panel is in the page
    return h('section', { class: 'bd-part', 'aria-labelledby': 'bd-ask-h' }, [
      h('h3', { id: 'bd-ask-h' }, 'Ask Buddy'), banner,
      h('label', { class: 'bd-ask-l', for: 'bd-ask' }, 'Ask Buddy anything about the school or the portal'), box, err, send, list]);
  }
  // ═══ Ask Buddy (end) ═══

  function build() {
    var ui = LMCSGame.ui, h = ui.h, G = window.LMCSGuide || {}, pg = (G.pages || {})[PATH] || null;
    var slot = h('div', {}), results = h('ul', { class: 'bd-results', 'aria-live': 'polite' });
    var input = h('input', { type: 'search', id: 'bd-q', class: 'bd-q', autocomplete: 'off', placeholder: 'A word or two', oninput: function () {
      var q = this.value, found = search(G.articles, q);
      results.textContent = '';
      found.forEach(function (a) { results.appendChild(h('li', {}, h('a', { href: GUIDE + '#' + encodeURIComponent(a.id) }, a.title))); });
      if (q.trim() && !found.length) results.appendChild(h('li', { class: 'bd-none' }, 'Nothing found. Try another word.'));
    } });
    panel = h('div', { class: 'bd-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'bd-h' }, [
      h('div', { class: 'bd-head' }, [
        h('img', { class: 'bd-av', src: av.src, alt: '' }),
        h('h2', { id: 'bd-h', tabindex: '-1' }, 'Buddy'),
        h('button', { type: 'button', class: 'bd-x', 'aria-label': 'Close', onclick: function () { close(); } }, '×'),
      ]),
      h('section', { class: 'bd-part', 'aria-labelledby': 'bd-page-h' }, [
        h('h3', { id: 'bd-page-h' }, 'This page'),
        h('p', {}, (pg && pg.purpose) || 'This is part of the LMCS portal.'),
      ]),
      owner() ? askSection(h) : null,
      slot,
      pg && (pg.tour || []).length ? h('button', { type: 'button', class: 'lg-btn bd-show', onclick: function () { showMe(pg.tour); } }, 'Show me how') : null,
      h('section', { class: 'bd-part', role: 'search', 'aria-labelledby': 'bd-q-l' }, [
        h('h3', {}, h('label', { id: 'bd-q-l', for: 'bd-q' }, 'Search the guide')),
        input, results,
        h('a', { class: 'bd-guide', href: GUIDE }, 'Open the user guide'),
      ]),
    ]);
    document.body.appendChild(panel);
    btn.setAttribute('aria-expanded', 'true');
    release = ui.trap(panel, function () { close(); });
    panel.querySelector('h2').focus();

    // "Next for you": filled when today's list arrives, left out when there is nothing to show
    var me = panel;
    today().then(function (d) {
      data = d;
      avatar(d);
      if (panel !== me || !d || d.notYet) return;
      var m = LMCSGame.nextMission(d), href = m && LMCSGame.safeHref(m.go, UP), s = setupStep(d), sHref = s && LMCSGame.safeHref(s.go, UP);
      var rows = [
        href && h('div', { class: 'bd-row' }, [h('span', { class: 'bd-t' }, m.title), h('a', { class: 'lg-go', href: href, 'aria-label': 'Go: ' + m.title }, 'Go')]),
        s && h('div', { class: 'bd-row' }, [h('span', { class: 'bd-t' }, [h('small', {}, 'Setting up'), s.title]),
          s.guide && h('a', { class: 'lg-go lg-go-soft', href: GUIDE + '#' + encodeURIComponent(s.guide), 'aria-label': 'How to: ' + s.title }, 'How'),
          sHref && h('a', { class: 'lg-go', href: sHref, 'aria-label': 'Go: ' + s.title }, 'Go')]),
      ].filter(Boolean);
      if (rows.length) slot.appendChild(h('section', { class: 'bd-part', 'aria-labelledby': 'bd-next-h' }, [h('h3', { id: 'bd-next-h' }, 'Next for you'), rows]));
    });
  }

  // close the panel (focus back on the button), then the page's tour; the tour hands focus back to the button too
  function showMe(beats) {
    var d = data || {};
    close();
    LMCSGame.tour(beats, { session: session(), backendUrl: BACKEND, tourId: tourId(PATH), campus: d.campus, speaker: d.speaker, config: d.config });
  }

  // lift the button (and the desktop card) above the next-step bar and api.avoid: whatever sits at the bottom edge
  var queued = false;
  function lift() {
    queued = false;
    if (btn && !session()) { close(); btn.remove(); btn = null; return; } // signed out or dropped by the allowlist re-check: no button over the gate
    var vh = window.innerHeight, up = 0, els;
    try { els = document.querySelectorAll('.lg-nextbar' + (api.avoid ? ',' + api.avoid : '')); } catch (e) { els = document.querySelectorAll('.lg-nextbar'); }
    [].forEach.call(els, function (el) {
      var r = el.getBoundingClientRect();
      if (r.height && r.top < vh && r.bottom > vh - 120 && getComputedStyle(el).visibility !== 'hidden') up = Math.max(up, vh - r.top);
    });
    document.documentElement.style.setProperty('--bd-lift', Math.round(up) + 'px');
  }
  function queue() { if (!queued) { queued = true; setTimeout(lift, 100); } }

  function start() {
    if (btn || !session() || !document.body) return;
    av = document.createElement('img');
    av.className = 'bd-av'; av.alt = ''; av.src = BASE + 'buddy/avatar-winter-formal.webp';
    av.onerror = function () { if (this.src.indexOf('avatar-winter-formal') === -1) this.src = BASE + 'buddy/avatar-winter-formal.webp'; };
    btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'bd-btn';
    btn.setAttribute('aria-label', 'Buddy: help'); btn.setAttribute('aria-haspopup', 'dialog'); btn.setAttribute('aria-expanded', 'false');
    btn.appendChild(av);
    btn.addEventListener('click', function () { if (panel) close(); else open(); });
    document.body.appendChild(btn);
    avatar((window.LMCSGame && LMCSGame.last && LMCSGame.last()) || kept());
    // a tap outside the open panel closes it, leaving focus where the tap put it
    document.addEventListener('pointerdown', function (e) { if (panel && !panel.contains(e.target) && !btn.contains(e.target)) close(true); }, true);
    try { new MutationObserver(queue).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] }); } catch (e) { /* no lift: still usable */ }
    window.addEventListener('resize', queue);
    lift();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  return api;
})();
