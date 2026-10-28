// The game bar (assets/game/rail.js + base.css .gb-rail): Missions, Quests, Rallies, Events and Buddy, sticky under the page
// header on every portal page. Missions and Quests open the role's hub at its Today panel and carry counts; Rallies and
// Events say "Soon"; Buddy opens the floating Buddy panel. Counts come from the Today panel (game.js fires
// 'lmcs-game-today' when it draws) and are kept for this tab, so pages without a Today panel show the same numbers.
//   <nav class="gb-rail" id="game-rail" aria-label="Game" hidden></nav>   (straight after the header; mount shows it)
//   LMCSRail.mount(document.getElementById('game-rail'), { hub: 'index.html', root: '../' });
// Presentation only: it reads what the Today panel already loaded and never calls a backend.
var LMCSRail = (function () {
  var KEY = 'gb-rail-v1:';

  // { missions, quests } from a Today payload: open missions and undecided decisions (as the Today list counts them),
  // and quests not yet complete
  function counts(today) {
    var t = today || {};
    var m = (t.missions || []).filter(function (x) { return !x.done && !x.gone; }).length + (t.windows || []).filter(function (w) { return !w.decided; }).length;
    var q = (t.quests || []).filter(function (x) { return !x.complete; }).length;
    return { missions: m, quests: q };
  }
  // the item's spoken name: "Missions, 3 waiting"
  function label(name, n) { return n > 0 ? name + ', ' + n + ' waiting' : name; }
  function badge(n) { return n > 99 ? '99+' : String(n); }
  // a stored value is used only when it has the right shape
  function valid(c) { return !!c && typeof c === 'object' && [c.missions, c.quests].every(function (n) { return typeof n === 'number' && n >= 0 && n % 1 === 0; }); }
  // the hub's Today panel: a hub link that already names a spot keeps it
  function hubHref(hub) { hub = String(hub || 'index.html'); return hub.indexOf('#') === -1 ? hub + '#game-root' : hub; }

  var api = { counts: counts, label: label, badge: badge, valid: valid, hubHref: hubHref };
  if (typeof document === 'undefined') return api;

  var ICONS = {
    missions: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M3.5 6l1.5 1.5L7.5 5M3.5 12l1.5 1.5L7.5 11"/><circle cx="5" cy="18" r="1.6"/>',
    quests: '<path d="M4 5.5 9 4l6 2 5-1.5v14L15 20l-6-2-5 1.5z"/><path d="M9 4v14M15 6v14"/>',
    rallies: '<path d="M6 21V4"/><path d="M6 4h11l-2.5 4L17 12H6"/>',
    events: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  };
  // the bar's emoji come from assets/game/emoji.js (one per concept, everywhere); a page without it keeps the line icons
  function icon(k) {
    var e = window.LMCSEmoji && LMCSEmoji.get(k);
    if (e) return '<span class="gb-rail-e" aria-hidden="true">' + e + '</span>';
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[k] + '</svg>';
  }
  function key() {
    try { var s = window.LMCS && LMCS.getSession(); return s && s.email ? KEY + String(s.email).toLowerCase() : null; } catch (_) { return null; }
  }
  function kept() {
    try { var k = key(), c = k ? JSON.parse(sessionStorage.getItem(k) || 'null') : null; return valid(c) ? c : null; } catch (_) { return null; }
  }
  function keep(c) {
    try { var k = key(); if (k) sessionStorage.setItem(k, JSON.stringify(c)); } catch (_) { /* a private window: counts show once the Today panel draws */ }
  }

  function mount(el, opts) {
    if (!el) return;
    opts = opts || {};
    var root = opts.root || '';
    var hub = hubHref(opts.hub);
    var c = kept() || { missions: 0, quests: 0 };

    var links = {};
    function item(k, name) {
      var a = document.createElement('a');
      a.className = 'gb-rail-i'; a.href = hub;
      a.innerHTML = icon(k);
      a.appendChild(document.createTextNode(name));
      var b = document.createElement('span'); b.className = 'gb-count'; b.setAttribute('aria-hidden', 'true'); a.appendChild(b);
      links[k] = { a: a, b: b, name: name };
      return a;
    }
    // counts change in place, so a person on the bar keeps their focus
    function show() {
      ['missions', 'quests'].forEach(function (k) {
        var l = links[k], n = c[k];
        l.a.setAttribute('aria-label', label(l.name, n));
        l.b.textContent = badge(n); l.b.hidden = !(n > 0);
      });
    }
    function soon(k, name) {
      var s = document.createElement('span');
      s.className = 'gb-rail-i is-soon'; s.setAttribute('aria-label', name + ', coming soon'); s.setAttribute('role', 'img');
      s.innerHTML = icon(k);
      s.appendChild(document.createTextNode(name));
      var sm = document.createElement('small'); sm.setAttribute('aria-hidden', 'true'); sm.textContent = (window.LMCSEmoji ? LMCSEmoji.get('soon') + ' ' : '') + 'Soon'; s.appendChild(sm);
      return s;
    }
    function buddy() {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'gb-rail-i';
      if (window.LMCSEmoji) b.innerHTML = icon('buddy');
      else { var img = document.createElement('img'); img.src = root + 'assets/game/buddy/winter-formal-neutral.webp'; img.alt = ''; b.appendChild(img); }
      b.appendChild(document.createTextNode('Buddy'));
      // the floating Buddy owns the panel: press its button; before it loads (or where a page opted out), the guide is the help
      b.addEventListener('click', function () {
        var fab = document.querySelector('.bd-btn');
        if (fab) fab.click(); else location.href = root + 'guide/index.html';
      });
      return b;
    }
    var ul = document.createElement('ul');
    [item('missions', 'Missions'), item('quests', 'Quests'), soon('rallies', 'Rallies'), soon('events', 'Events'), buddy()]
      .forEach(function (n) { var li = document.createElement('li'); li.appendChild(n); ul.appendChild(li); });
    el.textContent = '';
    el.appendChild(ul);
    show();
    el.hidden = false; // pages keep the bar hidden until someone is signed in
    document.addEventListener('lmcs-game-today', function (e) {
      var n = counts(e.detail);
      if (n.missions === c.missions && n.quests === c.quests) return;
      c = n; keep(c); show();
    });
  }

  api.mount = mount;
  return api;
})();
if (typeof module !== 'undefined') module.exports = LMCSRail;
