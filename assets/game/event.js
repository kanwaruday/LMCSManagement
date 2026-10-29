// 🎉 The event card (assets/game/event.js): on an event day (Game Config `events`, apps-script/game-event.gs) the person's short checklist
// becomes their next step, drawn into the page's .gb-next-slot ahead of the usual next-step bar. Steps tick from real data; a `self`
// step is one tap. Also shown: their own school's % and the network bar ("4 of 6 schools at 80% → 🎁"); no other school is named.
// A Principal also sees "X of Y teachers in" with who is not in yet. Text only, no motion (Uday: UX essential, animation not required).
// Host page: <script src=".../assets/game/event.js" data-roles="Principal"> after auth.js. It waits for the page's session
// (LMCS.getSession(), so it never signs anyone in) and calls gameevent; data-roles = the roles whose home this page is (a Principal
// opening the teacher page sees nothing there). No event, no session, or an error = nothing drawn: the page never depends on it.
// data-mode="driver" (driver/index.html, no game call): on an event day a linked phone (#home shown) gets the line
// "🎉 आज का दिन: ✅ QR स्कैन ✅ होम खुला"; its being on the page proves both steps.
// Every server string reaches the DOM as a text node; links go through safeHref.
var LMCSEvent = (function () {
  var IST_MS = 330 * 60000, DAY_START_MS = 4 * 3600000;
  // the game day 'YYYY-MM-DD' (04:00 IST rollover, as gameDayKey_ in game.gs)
  function gameDay(date) { return new Date(date.getTime() + IST_MS - DAY_START_MS).toISOString().slice(0, 10); }
  // a portal-relative link, or null: no scheme, no protocol-relative or absolute path, no control characters
  function safeHref(go, root) {
    go = String(go || '');
    if (!go || /[\u0000-\u001f\u007f\\]/.test(go) || /^\/|^[a-z][a-z0-9+.-]*:/i.test(go)) return null;
    return (root || '') + go;
  }
  function progressText(ev) { return ev.done + ' of ' + ev.total + ' done'; }
  function schoolText(s) { return 'Your school: ' + s.pct + '% finished'; }
  function levelText(s) { return '🎉 Level ' + s.level + ' of 5'; }
  function networkText(n) { return n.schoolsAtGoal + ' of ' + n.of + ' schools at ' + n.goalPct + '%' + (n.reward ? ' → ' + n.reward : ''); }
  function teachersText(t) { return t.n + ' of ' + t.of + (t.of === 1 ? ' teacher' : ' teachers') + ' in'; }
  // the driver page's days: the Game Config event dates, copied because the driver page makes no game call
  var DRIVER_DAYS = ['2026-10-30'];
  var DRIVER_LINE = '🎉 आज का दिन: ✅ QR स्कैन ✅ होम खुला';
  var api = { gameDay: gameDay, safeHref: safeHref, progressText: progressText, schoolText: schoolText, levelText: levelText, networkText: networkText,
    teachersText: teachersText, driverDays: DRIVER_DAYS, driverLine: DRIVER_LINE };
  if (typeof document === 'undefined') return api; // tests: the helpers only

  // ═══ page ═══
  var me = document.currentScript, BASE = ((me && me.src) || '').replace(/[^/?#]*([?#].*)?$/, ''), ROOT = BASE + '../../';
  var MODE = (me && me.getAttribute('data-mode')) || '';
  var ROLES = ((me && me.getAttribute('data-roles')) || '').split(',').map(function (r) { return r.trim(); }).filter(Boolean);
  var FALLBACK_URL = 'https://script.google.com/macros/s/AKfycbyyk7XpT86JqZRQ3ldFxesPw4ICK6WVAdsgsecEzWPViKasRs4agbYJ3Re_y_lY7mxyCA/exec'; // = GAME_BACKEND_URL on every portal page
  function backendUrl() { return typeof GAME_BACKEND_URL !== 'undefined' && GAME_BACKEND_URL ? GAME_BACKEND_URL : FALLBACK_URL; }
  var ERR = "That didn't save. Please try again.";

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined) return;
      if (k === 'onclick') el.onclick = v; else el.setAttribute(k, v);
    });
    [].concat(kids || []).forEach(function (c) { if (c !== null && c !== undefined) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function styles() {
    if (document.getElementById('ev-css')) return;
    var css = '.ev-card{background:var(--gb-paper,#fff);color:var(--gb-ink,#1b2430);border:2px solid var(--gb-gold,#e0a526);border-radius:16px;padding:12px 14px;margin:0 0 14px;text-align:left}' +
      '.ev-card h2{font-size:19px;line-height:1.25;margin:0 0 8px}' +
      '.ev-say{margin:0 0 10px;padding:10px 12px;border-radius:12px;background:var(--gb-gold-soft,#fbefd3);border-top:4px solid var(--gb-red,#ce0000);font-size:15.5px;line-height:1.4}' +
      '.ev-say b{display:block;font-size:12.5px;color:var(--gb-gold-ink,#7a5200)}' +
      '.ev-bar{display:block;height:10px;border-radius:6px;background:var(--gb-line,#d9d4ca);overflow:hidden}.ev-bar>i{display:block;height:100%;background:var(--gb-gold,#e0a526)}.ev-bar.ev-ok>i{background:var(--gb-ok,#167034)}' +
      '.ev-meta{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 12px;font-size:14px;margin:10px 0 4px}' +
      '.ev-steps{list-style:none;margin:10px 0 4px;padding:0}' +
      '.ev-step{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:6px 0;border-top:1px solid var(--gb-line,#d9d4ca)}' +
      '.ev-mark{flex:none;width:24px;text-align:center}.ev-t{flex:1 1 11em;min-width:0;overflow-wrap:anywhere}.ev-e{margin-right:.4em}.ev-done .ev-t{color:var(--gb-muted,#556170)}' +
      '.ev-go,.ev-btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;padding:8px 14px;border-radius:10px;font:inherit;font-weight:700;text-decoration:none}' +
      '.ev-go{color:var(--gb-red-ink,#a10000);border:1px solid var(--gb-line,#d9d4ca);background:var(--gb-paper,#fff)}' +
      '.ev-btn{background:var(--gb-red,#ce0000);color:#fff;border:0;cursor:pointer}.ev-btn:disabled{opacity:.55;cursor:default}' +
      '.ev-hint{flex-basis:100%;margin:0 0 0 34px;font-size:14px;color:var(--gb-muted,#556170)}.ev-hint summary{min-height:44px;display:flex;align-items:center;cursor:pointer}' +
      '.ev-hint ul{margin:0 0 6px;padding-left:18px}' +
      '.ev-live:empty{display:none}.ev-live{margin:6px 0 0;font-size:14px;font-weight:700;color:var(--gb-ok,#167034)}.ev-live.ev-err{color:var(--gb-low,#b4410f)}' +
      '.ev-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}' +
      '.ev-on .lg-nextbar{display:none}' + // the event is today's next step
      '.ev-drv{margin:0 0 10px;padding:10px 14px;border-radius:12px;background:var(--gb-ok-soft,#e3f4e8);color:var(--gb-ok,#167034);font-weight:700;font-size:17px}';
    document.head.appendChild(h('style', { id: 'ev-css' }, css));
  }

  // ── driver mode ──
  function driver() {
    if (DRIVER_DAYS.indexOf(gameDay(new Date())) === -1) return;
    var home = document.getElementById('home'), slot = document.querySelector('.gb-next-slot');
    if (!home || !slot) return;
    styles();
    var line = h('p', { class: 'ev-drv', role: 'status' }, DRIVER_LINE);
    slot.parentNode.insertBefore(line, slot); // beside the slot, not in it: driver.js redraws the slot
    var sync = function () { line.hidden = home.hidden; };
    sync();
    new MutationObserver(sync).observe(home, { attributes: true, attributeFilter: ['hidden'] });
  }

  // ── the card ──
  var S = { session: null, ev: null, slot: null, live: null, busy: false };
  function post(body) {
    return fetch(backendUrl(), { method: 'POST', body: JSON.stringify(Object.assign({ action: 'gameeventtick', idToken: S.session.idToken }, body)) })
      .then(function (r) { return r.json(); });
  }
  function say(text, err) { S.live.className = 'ev-live' + (err ? ' ev-err' : ''); S.live.textContent = text; }
  function bar(pct, ok, label) {
    return h('span', { class: 'ev-bar' + (ok ? ' ev-ok' : ''), role: 'img', 'aria-label': label }, h('i', { style: 'width:' + Math.max(0, Math.min(100, pct)) + '%' }));
  }
  function tick(step, btn) {
    if (S.busy) return;
    S.busy = true; btn.disabled = true; btn.textContent = 'Saving…'; say('');
    post({ eventId: S.ev.id, stepId: step.id }).then(function (d) {
      if (!d || !d.success) throw new Error('refused');
      step.done = true;
      S.ev.done = S.ev.steps.filter(function (s) { return s.done; }).length;
      if (S.ev.done >= S.ev.total) S.ev.finished = true;
      say('Done: ' + step.label + '. ' + progressText(S.ev) + '.');
      draw(step.id);
      load(true); // the server's Buddy line and school % for the new count
    }).catch(function () {
      btn.disabled = false; btn.textContent = 'Mark done'; say(ERR, true);
    }).then(function () { S.busy = false; });
  }
  function stepRow(s, ev) {
    var href = s.done ? null : safeHref(s.go, ROOT), acts = [];
    if (!s.done && s.self) acts.push(h('button', { type: 'button', class: 'ev-btn' }, 'Mark done'));
    if (href) acts.push(h('a', { class: 'ev-go', href: href, 'aria-label': 'Go: ' + s.label }, 'Go'));
    var row = h('li', { class: 'ev-step' + (s.done ? ' ev-done' : ''), 'data-step': s.id, tabindex: '-1' }, [
      h('span', { class: 'ev-mark', 'aria-hidden': 'true' }, s.done ? '✅' : '⬜'),
      h('span', { class: 'ev-t' }, [s.emoji ? h('span', { class: 'ev-e', 'aria-hidden': 'true' }, s.emoji) : null, s.label, h('span', { class: 'ev-sr' }, s.done ? ' (done)' : ' (to do)')])
    ].concat(acts));
    var btn = row.querySelector('.ev-btn');
    if (btn) btn.onclick = function () { tick(s, btn); };
    if (s.hint) {
      var t = ev.teachersIn;
      row.appendChild(t && t.notIn && t.notIn.length
        ? h('details', { class: 'ev-hint' }, [h('summary', {}, teachersText(t) + ': see who is not in yet'), h('ul', {}, t.notIn.map(function (n) { return h('li', {}, n); }))])
        : h('p', { class: 'ev-hint' }, s.hint));
    }
    return row;
  }
  function draw(focusStep) {
    var ev = S.ev, allDone = ev.finished === true || (ev.total > 0 && ev.done >= ev.total), id = 'ev-h-' + ev.id;
    var kids = [
      h('h2', { id: id }, [ev.emoji ? h('span', { class: 'ev-e', 'aria-hidden': 'true' }, ev.emoji) : null, ev.name]),
      ev.buddy ? h('p', { class: 'ev-say' }, [h('b', {}, 'Buddy'), ev.buddy]) : null,
      h('div', { class: 'ev-meta' }, [h('span', {}, 'Your steps'), h('span', {}, progressText(ev))]),
      bar(ev.total ? 100 * ev.done / ev.total : 0, allDone, 'Your steps: ' + progressText(ev)),
      h('ul', { class: 'ev-steps' }, ev.steps.map(function (s) { return stepRow(s, ev); }))
    ];
    if (ev.school) {
      kids.push(h('div', { class: 'ev-meta' }, [h('span', {}, schoolText(ev.school)), h('span', {}, levelText(ev.school))]));
      kids.push(bar(ev.school.pct, ev.network && ev.school.pct >= ev.network.goalPct, schoolText(ev.school)));
    }
    if (ev.network) {
      kids.push(h('div', { class: 'ev-meta' }, [h('span', {}, 'All schools'), h('span', {}, networkText(ev.network))]));
      kids.push(bar(ev.network.of ? 100 * ev.network.schoolsAtGoal / ev.network.of : 0, ev.network.schoolsAtGoal >= ev.network.of, networkText(ev.network)));
    }
    var card = h('section', { class: 'ev-card', 'aria-labelledby': id }, kids);
    S.slot.textContent = '';
    S.slot.appendChild(card);
    document.body.classList.toggle('ev-on', !allDone);
    var f = focusStep && [].filter.call(card.querySelectorAll('[data-step]'), function (x) { return x.getAttribute('data-step') === focusStep; })[0];
    if (f) f.focus();
  }
  function load(quiet, again) {
    var url = backendUrl();
    return fetch(url + (url.indexOf('?') === -1 ? '?' : '&') + 'action=gameevent&idToken=' + encodeURIComponent(S.session.idToken || ''), { cache: 'no-store' })
      .then(function (r) { return r.json(); }).then(function (d) {
        var ev = d && d.success && d.event;
        if (!ev || !Array.isArray(ev.steps) || (ROLES.length && ROLES.indexOf(ev.role) === -1)) { if (!quiet) clear(); return; }
        var focused = document.activeElement && S.slot.contains(document.activeElement) ? document.activeElement.closest('[data-step]') : null;
        S.ev = ev; draw(focused ? focused.getAttribute('data-step') : null);
        // Today writes the day's Game Daily row on this same page load: look once more, a minute on and only in view, so "Open Today" ticks
        if (!again && !quiet && ev.steps.some(function (s) { return !s.done && !s.self; })) setTimeout(function () { whenVisible(function () { load(true, true); }); }, LOOK_AGAIN_MS);
      }).catch(function () { /* the card is extra: the page works without it */ });
  }
  var LOOK_AGAIN_MS = 65000;
  function whenVisible(fn) {
    if (document.visibilityState !== 'hidden') { fn(); return; }
    var on = function () { if (document.visibilityState === 'hidden') return; document.removeEventListener('visibilitychange', on); fn(); };
    document.addEventListener('visibilitychange', on);
  }
  function clear() { if (S.slot && S.slot.querySelector('.ev-card')) S.slot.textContent = ''; document.body.classList.remove('ev-on'); }
  function start() {
    S.slot = document.querySelector('.gb-next-slot');
    if (!S.slot) return;
    styles();
    S.live = h('p', { class: 'ev-live', 'aria-live': 'polite', role: 'status' });
    S.slot.parentNode.insertBefore(S.live, S.slot.nextSibling); // once, outside the slot: a redraw never drops an announcement
    var tries = 0;
    (function wait() { // the page signs people in on the spot: wait for its session (about 10 minutes), never ask for one
      var s = window.LMCS && LMCS.getSession ? LMCS.getSession() : null;
      if (s && s.idToken) { S.session = s; load(false); return; }
      if (++tries < 400) setTimeout(wait, 1500);
    })();
  }

  function boot() { if (MODE === 'driver') driver(); else start(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  return api;
})();
if (typeof module !== 'undefined') module.exports = LMCSEvent;
