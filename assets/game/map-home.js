// The map homes, Kingshot-style (assets/game/map-home.js + map-home.css): the Owner's and the Coordinators' home is the valley map with
// LMCS HQ and LMS 1-6 pinned on it, and every control hugs the edges, as on the Principal home (home-hud.js). Uday, 29 Oct: Coordinators
// get "a home screen like mine, places on an actual map, they just have lesser things to decide on and more things to act on"; "the
// actual tasks need to appear in different windows, the home should not feel cluttered". So the map shows pins and one small bubble per
// place (Owner: decisions waiting there; Coordinator: things to act on there), and every list opens in a window.
// Presentation only, like home-hud.js: the page fetches (gamekingdom for the Owner; coordinatortasks for a Coordinator; game.js's Today
// via 'lmcs-game-today') and hands the answers in; this file never calls a backend. A Coordinator's write (Mark resolved) goes through
// the page's own `resolve` callback. Every piece of text reaches the DOM as a text node (LMCSGame.ui.h), never as parsed HTML.
//   LMCSMapHome.mount({ role: 'Owner'|'Coordinator', session, root, scene, switchEl, stash, gameRoot, evSlot, world(bool), hq() -> {nodes, held},
//                       profile() -> {nodes, held}, icons: [{ key, e, label: [hi, en], n?, open(opener) }], linkFor(item) -> href|null,
//                       resolve(taskId, note) -> Promise<{success, error?}>   (Coordinator: Mark resolved)
//                       post(body) -> Promise<{success, error?}>, refresh()   (Owner: kingdomassign / kingdomallocate, the Kingdom's own writes)
//                       analytics() -> Promise<{ today, issues, pdrDay, transport, approvals }>   (called once, the first time a school's window opens) })
//   LMCSMapHome.setIcon({ key, e, label, n, open }) / setIcon({ key })  add, replace or remove a right-column icon (e.g. Game Day once it runs)
//   LMCSMapHome.open({ title, sub, nodes, held, opener })  a page's own window (Tools), with the same ✕ / tap outside / Esc / focus return
//   LMCSMapHome.setKingdom(d)  the Owner's gamekingdom answer      LMCSMapHome.setTasks(tasks)  a Coordinator's coordinatortasks rows (or 'error')
var LMCSMapHome = (function () {
  // LMCS HQ and LMS 1-6 on the 1000 x 620 valley: Game Config kingdom.campuses' defaults (apps-script/game.gs). The Owner's gamekingdom
  // answer carries the owner-placed positions and replaces these; a Coordinator (gamekingdom refuses them) uses these. tests/game/test-map-home.js keeps them equal.
  var PINS = [
    { id: 'HES', name: 'LMCS HQ', full: 'LMCS HQ (the society)', x: 500, y: 345, darbar: true },
    { id: 'LMS1', name: 'LMS 1', full: 'LMS 1 Dhalpur', x: 690, y: 160 }, { id: 'LMS2', name: 'LMS 2', full: 'LMS 2 Kelheli', x: 845, y: 250 },
    { id: 'LMS3', name: 'LMS 3', full: 'LMS 3 Dunkhra', x: 610, y: 250 }, { id: 'LMS4', name: 'LMS 4', full: 'LMS 4 Ner Chowk', x: 575, y: 500 },
    { id: 'LMS5', name: 'LMS 5', full: 'LMS 5 Sayoli', x: 350, y: 470 }, { id: 'LMS6', name: 'LMS 6', full: 'LMS 6 Jogindernagar', x: 190, y: 330 }
  ];
  // copy of COORD_DISTRICTS (apps-script/coordinator.gs), the Coordinator backend's scope; the test keeps the two equal. UI only: the
  // backend already cut the rows to these campuses (an assignee also sees what was assigned to them), the map only dims the rest.
  var DISTRICTS = {
    LMS1: ['LMS1', 'LMS2', 'LMS3'], LMS2: ['LMS1', 'LMS2', 'LMS3'], LMS3: ['LMS1', 'LMS2', 'LMS3'],
    LMS4: ['LMS4', 'LMS5', 'LMS6'], LMS5: ['LMS4', 'LMS5', 'LMS6'], LMS6: ['LMS4', 'LMS5', 'LMS6']
  };
  // Hindi first, then English (the driver portal's pattern): [hi, en]
  var L = {
    town: ['नगर', 'Town'], world: ['दुनिया', 'World'], wild: ['जंगल', 'Wilderness'], daily: ['रोज़ाना', 'Daily'], tasks: ['काम', 'Tasks'],
    decide: ['फ़ैसले बाक़ी', 'Decisions waiting'], act: ['करना है', 'To act on'], rank: ['रैंकिंग', 'Ranking'], profile: ['प्रोफ़ाइल', 'Profile'],
    close: ['बंद करें', 'Close'], go: ['जाएँ', 'Go'], resolve: ['हो गया', 'Mark resolved'], routes: ['बसें', 'Buses and routes'], enter: ['स्कूल में जाएँ', 'Enter School'],
    buildings: ['इमारतें', 'Buildings and setup'], hqsetup: ['सेटअप', 'Set up the game at HQ'], here: ['यहाँ', 'Waiting here'], outside: ['आपके ज़िले में नहीं', 'Not in your district'], office: ['दफ़्तर', 'Your office']
  };
  function bi(k) { var p = L[k]; return p ? p[0] + ' · ' + p[1] : ''; }
  var COPY = {
    ownerClear: 'Nothing waits for your decision. Shabash.', coordClear: 'Nothing to act on right now. Nice.', daily: 'No daily missions today.',
    here: 'Nothing waiting here.', tasksErr: "Your follow-ups didn't load. The map still opens; try again in a minute.", loading: 'Getting your work…'
  };

  // the Coordinator backend's scope for a session: null = every campus (Owner, or campus ALL), else the district's campuses
  function scopeOf(session) {
    if (!session) return [];
    var roles = String(session.role || '').split(',').map(function (r) { return r.trim(); });
    var c = String(session.campusId || '').trim().toUpperCase();
    if (roles.indexOf('Owner') !== -1 || c === 'ALL') return null;
    return DISTRICTS[c] || (c ? [c] : []);
  }
  // LMCS HQ is everyone's: a Coordinator's office sits there
  function inScope(scope, id) { return id === 'HES' || !scope || scope.indexOf(id) !== -1; }
  // 'LMS 4' / 'LMS4' / 'lms4' -> 'LMS4'; '' / 'network' / 'HES' / 'ALL' -> 'HES' (HQ holds the network-wide work)
  function placeOf(c) {
    var s = String(c || '').trim().toUpperCase().replace(/\s+/g, '');
    var m = /^LMS([1-6])$/.exec(s);
    return m ? 'LMS' + m[1] : 'HES';
  }
  // the pins to draw: the Owner's gamekingdom bases (owner-placed) when they carry positions, else the defaults; HQ first
  function pinsFrom(d) {
    var bases = (d && d.kingdom && d.kingdom.campuses) || [];
    var ok = bases.filter(function (b) { return b && b.id && isFinite(Number(b.x)) && isFinite(Number(b.y)); });
    var list = ok.length ? ok.map(function (b) { return { id: String(b.id), name: String(b.name || b.id), full: String(b.full || b.name || b.id), x: Number(b.x), y: Number(b.y), darbar: b.darbar === true }; }) : PINS.slice();
    return list.filter(function (p) { return p.darbar; }).concat(list.filter(function (p) { return !p.darbar; }));
  }
  function pos(p) { return 'left:' + (Number(p.x) / 10) + '%;top:' + (Number(p.y) / 6.2) + '%'; }

  // ── the Owner: what waits for a decision, place by place (from gamekingdom; the server sends cards and assignees to the Owner only) ──
  function guideGo(s) { return s && /^[\w-]+$/.test(String(s.guide || '')) ? 'guide/index.html#' + s.guide : ''; }
  function ownerDecisions(d) {
    if (!d || d.role !== 'Owner') return [];
    var out = [], bases = (d.kingdom && d.kingdom.campuses) || [];
    bases.forEach(function (b) {
      (b.buildings || []).forEach(function (bl) { (bl.tiers || []).forEach(function (t) {
        if (t.state !== 'open') return;
        var left = (t.steps || []).filter(function (s) { return !s.done; });
        if (left.length) out.push({ kind: 'setup', e: 'settings', place: placeOf(b.id), title: 'Set up the game: ' + left[0].title,
          detail: left.length + (left.length === 1 ? ' step left' : ' steps left') + ' in ' + String(t.label || bl.name || ''), go: guideGo(left[0]) || 'owner/kingdom.html#base-' + b.id, goText: guideGo(left[0]) ? 'Show me how' : 'Open' });
        else if (t.assignable && !t.owner && (t.assignees || []).length) out.push({ kind: 'assign', e: 'heads', place: placeOf(b.id), title: 'Pick who sets up ' + String(t.label || ''),
          detail: String(bl.name || '') + ' at ' + String(b.name || b.id) + '. They see it in their Today list.', go: 'owner/kingdom.html#base-' + b.id, goText: 'Open in the Kingdom', tier: t, base: b });
      }); });
    });
    (d.cards || []).forEach(function (c) {
      out.push({ kind: 'follow', e: 'requests', place: placeOf(c.campus), title: 'Pick who follows up: ' + String(c.title || ''),
        detail: 'An approved request' + (c.campus ? ' from ' + String(c.campus) : '') + ' with nobody following it up yet.', go: 'owner/kingdom.html', goText: 'Open the Kingdom', card: c });
    });
    return out;
  }

  // ── a Coordinator: what to act on (follow-ups the backend scoped, approvals the Owner allocated, steps the Owner assigned) ──
  var SEV = { high: 0, medium: 1, low: 2 };
  // tasks: coordinatortasks rows; today: gametoday; me: the session email; scope: scopeOf(session)
  function coordActions(tasks, today, me, scope) {
    me = String(me || '').toLowerCase();
    var out = [];
    (Array.isArray(tasks) ? tasks : []).forEach(function (t) {
      var who = String(t.assignee || '').toLowerCase();
      if (who && who !== me) return; // waiting on another Coordinator: theirs to act on
      var mine = who === me && !!me;
      out.push({ kind: mine ? (t.domain === 'apr_follow' ? 'allocated' : 'assigned') : 'followup', e: mine ? 'requests' : 'missions', place: placeOf(t.campus),
        title: String(t.title || ''), detail: String(t.detail || ''), due: String(t.due || ''), severity: t.severity || 'low', department: String(t.department || ''),
        domain: String(t.domain || ''), taskId: String(t.taskId || ''), mine: mine });
    });
    // steps the Owner handed out (game-confirm.gs cqMissions_ marks them "Assigned by the Owner"); only campuses in scope or HQ
    ((today && today.missions) || []).forEach(function (m) {
      if (m.done || m.gone || m.why !== 'Assigned by the Owner') return;
      var place = placeOf(m.campus); if (!inScope(scope, place)) return;
      out.push({ kind: 'quest', e: 'quests', place: place, title: String(m.title || ''), detail: 'Assigned by the Owner', go: m.go || '', mine: true });
    });
    var rank = { quest: 0, allocated: 1, assigned: 2, followup: 3 };
    return out.map(function (x, i) { x.i = i; return x; }).sort(function (a, b) {
      return (rank[a.kind] - rank[b.kind]) || ((SEV[a.severity] || 0) - (SEV[b.severity] || 0)) || ((a.due || '9') < (b.due || '9') ? -1 : (a.due || '9') > (b.due || '9') ? 1 : 0) || a.i - b.i;
    });
  }
  // Transport work belongs to the Wilderness tab (with the routes); everything else is Town
  function isWild(x) { return x.department === 'Transport'; }
  function countByPlace(items) { var n = {}; (items || []).forEach(function (x) { n[x.place] = (n[x.place] || 0) + 1; }); return n; }

  // ── Ranking (Owner and Coordinators only; never on a Principal's or anyone else's home) ──
  // Owner: every school by its Kingdom level, then points. Ties share a rank.
  function rankOwner(d) {
    var rows = ((d && d.kingdom && d.kingdom.campuses) || []).filter(function (b) { return !b.darbar; }).map(function (b) {
      return { id: b.id, name: String(b.name || b.id), a: Number(b.level) || 0, b: Number(b.points) || 0, line: 'Level ' + (Number(b.level) || 0) + ' · ' + (Number(b.points) || 0) + ' points' };
    }).sort(function (x, y) { return y.a - x.a || y.b - x.b || (x.id < y.id ? -1 : 1); });
    return ranked(rows);
  }
  // Coordinator: the schools of their own district, fewest open follow-ups first (only rows the backend already scoped; no other district's data)
  function rankCoord(tasks, scope) {
    var ids = (scope || PINS.filter(function (p) { return !p.darbar; }).map(function (p) { return p.id; })).filter(function (c) { return /^LMS[1-6]$/.test(c); });
    var n = {}; (Array.isArray(tasks) ? tasks : []).forEach(function (t) { var p = placeOf(t.campus); n[p] = (n[p] || 0) + 1; });
    var rows = ids.map(function (c) { var k = n[c] || 0; return { id: c, name: c.replace(/^LMS(\d)$/, 'LMS $1'), a: -k, b: 0, line: k ? k + (k === 1 ? ' open follow-up' : ' open follow-ups') : 'All clear' }; })
      .sort(function (x, y) { return y.a - x.a || (x.id < y.id ? -1 : 1); });
    return ranked(rows);
  }
  function ranked(rows) {
    var r = 0; return rows.map(function (x, i) { if (i === 0 || x.a !== rows[i - 1].a || x.b !== rows[i - 1].b) r = i + 1; return { id: x.id, name: x.name, rank: r, line: x.line }; });
  }
  // the next deadline on the timer card: the earliest open item or Today mission with a due date (yyyy-mm-dd, the end of that day IST)
  function nextDeadline(list, now) {
    var best = null, t = now ? now.getTime() : Date.now();
    (list || []).forEach(function (x) {
      var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(x.due || '')); if (!m || x.done || x.gone) return;
      var at = Date.UTC(+m[1], +m[2] - 1, +m[3], 23, 59) - 330 * 60000; // 23:59 IST
      if (!best || at < best.at) best = { title: String(x.title || ''), due: m[0], at: at };
    });
    if (!best) return null;
    var left = best.at - t, late = left < 0, mins = Math.floor(Math.abs(left) / 60000), d = Math.floor(mins / 1440), hr = Math.floor((mins % 1440) / 60);
    best.late = late; best.left = (d ? d + 'd ' : '') + (d || hr ? hr + 'h' : (mins % 60) + 'm');
    return best;
  }
  // "Day closes in 3h 10m" (IST, 15:30), or "Day closed": the same clock as the Principal home
  function dayText(now) {
    var d = new Date((now || new Date()).getTime() + 330 * 60000), left = 15 * 60 + 30 - (d.getUTCHours() * 60 + d.getUTCMinutes());
    return left <= 0 ? 'Day closed' : 'Day open · ' + (left >= 60 ? Math.floor(left / 60) + 'h ' : '') + (left % 60) + 'm';
  }
  function canRank(session) { return /(^|,)\s*(Owner|Coordinator)\s*(,|$)/.test(String((session && session.role) || '')); }
  function dueText(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); if (!m) return '';
    return 'Due ' + (+m[3]) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1];
  }
  // ['LMS1', 'LMS2', 'LMS3'] -> 'LMS 1, 2, 3'
  function districtText(scope) { return (scope || []).length ? 'LMS ' + scope.map(function (c) { return String(c).replace(/^LMS/, ''); }).join(', ') : ''; }
  function pinLabel(p, n, role, dim) {
    if (dim) return p.full + ', ' + L.outside[1].toLowerCase();
    return p.full + (n ? ', ' + n + (role === 'Owner' ? (n === 1 ? ' decision waiting' : ' decisions waiting') : (n === 1 ? ' thing to act on' : ' things to act on')) : ', nothing waiting');
  }

  // ── a school's analytics chips (the campus window), from reads the page already makes; each source may be missing (null = not loaded
  // or failed: its chip is left out). src = { issues: principalissues rows, pdrDay: coordinatorpdrday answer, transport: coordinatortransport answer,
  // approvals: [{ campus, waiting: true }] (the Owner: approvalslist; a Coordinator: coordinatortasks' approvals and fresh requests), base: the
  // Owner's gamekingdom base }. Counts only; the window's chip opens the lines behind each number. ──
  function dayNo(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : null; }
  function campusStats(src, id, today) {
    src = src || {}; var out = [], t0 = dayNo(today);
    if (src.pdrDay && Array.isArray(src.pdrDay.reports)) {
      var rep = src.pdrDay.reports.filter(function (r) { return placeOf(r.campus) === id; })[0];
      out.push({ key: 'report', e: 'dailyReport', label: ['रिपोर्ट', 'Report today'], value: rep ? '✓' : '✗', tone: rep ? 'ok' : 'warn',
        say: rep ? 'filed' : 'not filed yet', lines: rep ? ['Filed' + (rep.principal ? ' by ' + rep.principal : '') + (rep.at ? ' at ' + String(rep.at).slice(-8, -3) : '') + '.'].concat(rep.done ? ['Done today: ' + rep.done] : []) : ["Today's report isn't in yet."],
        go: 'coordinator/systems/index.html' });
    }
    if (Array.isArray(src.issues)) {
      var iss = src.issues.filter(function (i) { return placeOf(i.campus) === id && (i.status === 'open' || i.status === 'reopened'); });
      out.push({ key: 'issues', e: 'issues', label: ['मुद्दे', 'Open issues'], value: String(iss.length), tone: iss.length ? 'warn' : 'ok', say: iss.length + ' open',
        lines: iss.slice(0, 6).map(function (i) { return String(i.subject || '') + (i.count > 1 ? ' (' + i.count + ' times)' : ''); }), go: 'coordinator/systems/index.html' });
    }
    if (Array.isArray(src.approvals)) {
      var ap = src.approvals.filter(function (a) { return placeOf(a.campus) === id && a.waiting; });
      out.push({ key: 'approvals', e: 'requests', label: ['मंज़ूरी', 'Approvals waiting'], value: String(ap.length), tone: ap.length ? 'warn' : 'ok', say: ap.length + ' waiting',
        lines: ap.slice(0, 6).map(function (a) { return String(a.title || 'A request'); }), go: 'coordinator/systems/index.html#approvals' });
    }
    if (src.transport && Array.isArray(src.transport.fleet)) {
      var fleet = src.transport.fleet.filter(function (b) { return placeOf(b.campusId || b.campus) === id; }), run = fleet.filter(function (b) { return b.operational; });
      var late = [], soon = [];
      run.forEach(function (b) { Object.keys(b.docs || {}).forEach(function (k) {
        var d = b.docs[k] || {}, n = d.na ? null : dayNo(d.date); if (n === null || t0 === null) return;
        if (n < t0) late.push(b.reg + ': ' + k.replace(/_/g, ' ') + ' expired ' + d.date); else if (n - t0 <= 30) soon.push(b.reg + ': ' + k.replace(/_/g, ' ') + ' due ' + d.date);
      }); });
      out.push({ key: 'buses', e: 'bus', label: ['बसें', 'Buses running'], value: run.length + '/' + fleet.length, tone: 'info', say: run.length + ' of ' + fleet.length + ' running',
        lines: fleet.map(function (b) { return b.reg + (b.route ? ' · ' + b.route : '') + (b.operational ? '' : ' · not running'); }), go: 'coordinator/transport/index.html' });
      out.push({ key: 'papers', e: 'due', label: ['काग़ज़', 'Papers due'], value: String(late.length + soon.length), tone: late.length ? 'bad' : soon.length ? 'warn' : 'ok',
        say: late.length + ' expired, ' + soon.length + ' due in 30 days', lines: late.concat(soon).slice(0, 8), go: 'coordinator/transport/index.html' });
    }
    if (src.base) {
      var L0 = Number(src.base.level) || 0, done = 0, total = 0;
      (src.base.buildings || []).forEach(function (b) { (b.tiers || []).forEach(function (t) { if (t.state === 'done' || t.state === 'open') { total++; if (t.state === 'done') done++; } }); });
      out.push({ key: 'setup', e: 'level', label: ['स्तर', 'Setup level'], value: 'Lv ' + L0, tone: 'info', say: 'level ' + L0 + ', ' + done + ' of ' + total + ' steps built',
        lines: (src.base.buildings || []).map(function (b) { return String(b.name || '') + ': level ' + (Number(b.level) || 0) + ' of ' + (Number(b.maxLevel) || 0); }), go: 'owner/kingdom.html#base-' + id });
    }
    return out;
  }
  // the reviewed 3D renders (assets/game/art/, as school-building.js shows them); a school without one gets the plain backdrop
  var ART = { LMS1: 'lms1-dhalpur', LMS2: 'lms2-kelheli', LMS3: 'lms3-dunkhra', LMS4: 'lms4-nerchowk' };

  var api = { PINS: PINS, campusStats: campusStats, ART: ART, DISTRICTS: DISTRICTS, L: L, COPY: COPY, bi: bi, scopeOf: scopeOf, inScope: inScope, placeOf: placeOf, pinsFrom: pinsFrom, pos: pos,
    ownerDecisions: ownerDecisions, coordActions: coordActions, isWild: isWild, countByPlace: countByPlace, rankOwner: rankOwner, rankCoord: rankCoord,
    canRank: canRank, nextDeadline: nextDeadline, dayText: dayText, dueText: dueText, districtText: districtText, pinLabel: pinLabel };
  if (typeof document === 'undefined') return api; // tests: the helpers only

  // ═══ page ═══
  var h = LMCSGame.ui.h, S = { o: null, kingdom: null, tasks: null, today: null, items: [], win: null, el: null, scope: null };
  function emoji(k) { return window.LMCSEmoji ? LMCSEmoji.tag(k) : null; }
  function txt(k) { var p = L[k]; return [h('span', { lang: 'hi' }, p[0]), ' · ' + p[1]]; }
  function note(text) { return h('p', { class: 'mh-empty' }, text); }
  function pinOf(id) { return (S.pins || []).filter(function (p) { return p.id === id; })[0] || null; }
  function owner() { return S.o.role === 'Owner'; }

  // ── the one window: a bottom sheet on phones, a card from 640px. ✕ (44px), a tap outside and Esc close it; focus goes back to what
  // opened it (or that place's pin) and the map scrolls back to where it was. While it is open the home behind it is inert. ──
  function win() {
    if (S.win) return S.win;
    var title = h('h2', { id: 'mh-win-h', tabindex: '-1' }), sub = h('p', { class: 'mh-win-sub' }), body = h('div', { class: 'mh-win-body' }), live = h('p', { class: 'mh-live', role: 'status', 'aria-live': 'polite' });
    var x = h('button', { type: 'button', class: 'mh-x', 'aria-label': 'Close · बंद करें' }, h('span', { 'aria-hidden': 'true' }, '✕'));
    var box = h('div', { class: 'mh-win', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mh-win-h' }, [h('div', { class: 'mh-win-head' }, [h('div', { class: 'mh-win-t' }, [title, sub]), x]), body, live]);
    var back = h('div', { class: 'mh-backdrop' });
    var layer = h('div', { class: 'mh-layer', hidden: 'hidden' }, [back, box]);
    document.body.appendChild(layer);
    S.win = { layer: layer, box: box, title: title, sub: sub, body: body, live: live, held: [], open: false };
    x.onclick = function () { close(); };
    back.onclick = function () { close(); };
    return S.win;
  }
  function open(o) { // { title, sub, nodes, held, opener, pin }
    var w = win(); if (w.open) close(true);
    var box = S.o.scene.querySelector('.mh-box');
    w.scroll = box ? { x: box.scrollLeft, y: box.scrollTop } : null;
    w.view = S.real && S.real.map ? { c: S.real.map.getCenter(), z: S.real.map.getZoom() } : null;
    w.title.textContent = o.title; w.sub.textContent = o.sub || ''; w.sub.hidden = !o.sub; w.body.textContent = ''; w.live.textContent = '';
    (o.nodes || []).forEach(function (n) { if (n) w.body.appendChild(n); });
    w.held = o.held || []; w.pin = o.pin || null;
    w.layer.hidden = false; w.open = true; document.body.classList.add('mh-win-open');
    S.o.scene.inert = true;
    w.release = LMCSGame.ui.trap(w.box, function () { close(); });
    w.opener = o.opener || document.activeElement;
    w.title.focus();
    setTimeout(function () { w.live.textContent = o.title; }, 50);
  }
  function close(quiet) {
    var w = S.win; if (!w || !w.open) return;
    w.held.forEach(function (n) { S.o.stash.appendChild(n); }); w.held = [];
    w.layer.hidden = true; w.open = false; document.body.classList.remove('mh-win-open');
    S.o.scene.inert = false;
    var box = S.o.scene.querySelector('.mh-box');
    if (box && w.scroll) { box.scrollLeft = w.scroll.x; box.scrollTop = w.scroll.y; }
    if (w.view && S.real && S.real.map) S.real.map.setView(w.view.c, w.view.z, { animate: false });
    var to = w.opener && document.contains(w.opener) ? w.opener : w.pin ? S.o.scene.querySelector('.mh-pin[data-id="' + w.pin + '"]') : null;
    w.release(quiet ? false : to || S.el.edge);
  }

  // ── what a row opens ──
  function goLink(href, label, primary) {
    var safe = href ? LMCSGame.safeHref(href, S.o.root) : null;
    return safe ? h('a', { class: 'gb-btn mh-btn' + (primary ? ' gb-btn-primary' : ''), href: safe }, label) : null;
  }
  function itemRow(x, opener) {
    var b = h('button', { type: 'button', class: 'mh-row' + (x.severity === 'high' ? ' is-hot' : '') }, [emoji(x.e), h('span', { class: 'mh-row-t' }, [x.title,
      x.place && pinOf(x.place) ? h('small', {}, pinOf(x.place).name + (x.due ? ' · ' + dueText(x.due) : '') + (x.mine && x.kind !== 'quest' ? ' · Assigned to you' : '')) : null]),
      h('span', { class: 'mh-go', 'aria-hidden': 'true' }, '›')]);
    b.onclick = function () { S.drawer(false); openItem(x, opener || b); };
    return b;
  }
  function list(items, empty) { return items.length ? h('ul', { class: 'mh-list' }, items.map(function (x) { return h('li', {}, itemRow(x)); })) : note(empty); }
  function openItem(x, opener) {
    var p = pinOf(x.place), nodes = [];
    if (x.detail) nodes.push(h('p', { class: 'mh-detail' }, x.detail));
    var pills = [x.severity === 'high' ? h('span', { class: 'gb-pill gb-pill-warn' }, 'High priority') : null, x.due ? h('span', { class: 'gb-pill' }, dueText(x.due)) : null,
      x.mine && x.kind !== 'quest' ? h('span', { class: 'gb-pill' }, 'Assigned to you') : null].filter(Boolean);
    if (pills.length) nodes.push(h('p', { class: 'mh-pills' }, pills));
    var form = owner() && S.o.post && window.LMCSKingdom && (x.tier || x.card) ? decide(x) : null;
    if (form) nodes.push(form);
    var go = owner() ? goLink(x.go, x.goText || 'Open', !form) : goLink(x.kind === 'quest' ? x.go : S.o.linkFor(x), txt('go'), true);
    var acts = h('div', { class: 'mh-acts' }, [go]);
    nodes.push(acts);
    if (!owner() && x.taskId) { // a follow-up: closed here with a note (transport ones need one: the server says so)
      var ta = h('textarea', { id: 'mh-note', rows: '2', maxlength: '500' }), err = h('p', { class: 'gb-err', role: 'alert' });
      var done = h('button', { type: 'button', class: 'gb-btn mh-btn' }, txt('resolve'));
      done.onclick = function () {
        if (done.disabled) return;
        done.disabled = ta.disabled = true; err.textContent = '';
        Promise.resolve(S.o.resolve(x.taskId, ta.value.trim())).then(function (r) {
          if (!r || !r.success) throw new Error((r && r.error) || "That didn't go through. Nothing was changed.");
          S.tasks = (S.tasks || []).filter(function (t) { return String(t.taskId) !== x.taskId; });
          var pin = x.place; close(true); render();
          var to = S.o.scene.querySelector('.mh-pin[data-id="' + pin + '"]') || S.el.edge; to.focus();
          S.el.say.textContent = 'Resolved: ' + x.title + '. It leaves the list for every Coordinator.';
        }).catch(function (e) { err.textContent = String((e && e.message) || "That didn't go through."); done.disabled = ta.disabled = false; });
      };
      nodes.push(h('label', { class: 'mh-fld', for: 'mh-note' }, ['What was done (optional for most; transport needs it)', ta]), err, h('div', { class: 'mh-acts' }, [done]));
    }
    open({ title: x.title, sub: p ? p.full : '', nodes: nodes, opener: opener, pin: x.place });
  }
  // ── the Owner decides inside the window: pick a person, then Assign. The same bodies and actions as the Kingdom's sheets
  // (LMCSKingdom.assignBody / allocateBody -> kingdomassign / kingdomallocate); nothing is sent before Assign, and the server checks the Owner again ──
  function decide(x) {
    var d = S.kingdom || {}, K = LMCSKingdom, err = h('p', { class: 'gb-err', role: 'alert' }), people, sug = '', extra = [];
    if (x.tier) people = x.tier.assignees || [];
    else { people = d.followHeads || []; var sh = K.suggestHead(x.card, people); sug = sh ? sh.email : ''; }
    if (!people.length) return note(x.tier ? 'Nobody on the allowlist can take this step yet.' : 'No alliance heads who are Coordinators are set up yet, so a follow-up can\'t be sent.');
    var name = 'mh-who-' + Date.now();
    var pick = h('fieldset', { class: 'mh-pick' }, [h('legend', {}, x.tier ? 'Who should set this up?' : 'Who should follow this up, and by when?')].concat(people.map(function (p, i) {
      var id = name + i;
      return h('label', { class: 'mh-opt', for: id }, [h('input', { type: 'radio', name: name, id: id, value: p.email, checked: p.email === sug ? true : null }),
        h('span', {}, [h('b', {}, String(p.name || p.email)), p.name ? h('small', {}, String(p.email)) : null, p.email === sug ? h('em', {}, 'Buddy suggests') : null])]);
    })));
    var today = String(d.day || ''), due = null;
    if (x.card) {
      due = h('input', { type: 'date', id: name + '-due', value: K.defaultDue(today, Number(d.kingdom && d.kingdom.followupDueDays) || 7), min: today || null, required: true });
      extra.push(h('label', { class: 'mh-fld', for: name + '-due' }, ['Due date', due]));
    }
    var ta = h('textarea', { id: name + '-note', rows: '2', maxlength: '300' });
    var go = h('button', { type: 'button', class: 'gb-btn gb-btn-primary mh-btn' }, 'Assign');
    go.onclick = function () {
      if (go.disabled) return;
      var r = pick.querySelector('input:checked'), who = r ? r.value : '';
      if (!who) { err.textContent = 'Pick a person first.'; return; }
      if (due && (!/^\d{4}-\d{2}-\d{2}$/.test(due.value) || (today && due.value < today))) { err.textContent = 'Pick a due date that is today or later.'; return; }
      var body = x.tier ? K.assignBody(x.tier, x.base.id, who, ta.value.trim()) : K.allocateBody(x.card, who, due.value, ta.value.trim());
      var ctl = [go, ta, due].concat([].slice.call(pick.querySelectorAll('input'))).filter(Boolean);
      ctl.forEach(function (c) { c.disabled = true; }); go.textContent = 'Sending…'; err.textContent = '';
      Promise.resolve(S.o.post(body)).then(function (res) {
        if (!res || !res.success) throw new Error((res && res.error) || "That didn't go through. Nothing was changed. Please try again.");
        var pin = x.place, person = (people.filter(function (p) { return p.email === who; })[0] || {}).name || who;
        close(true);
        var to = S.o.scene.querySelector('.mh-pin[data-id="' + pin + '"]') || S.el.edge; to.focus();
        S.el.say.textContent = x.tier ? 'Assigned to ' + person + '. They\'ll see it in their Today list.' : 'Follow-up sent to ' + person + ', due ' + due.value + '.';
        if (S.o.refresh) S.o.refresh();
      }).catch(function (e) { err.textContent = String((e && e.message) || "That didn't go through."); ctl.forEach(function (c) { c.disabled = false; }); go.textContent = 'Assign'; });
    };
    return h('div', { class: 'mh-form' }, [pick].concat(extra, [h('label', { class: 'mh-fld', for: name + '-note' }, ['Note (optional)', ta]), err, h('div', { class: 'mh-acts' }, [go])]));
  }
  function here(id) { return S.items.filter(function (x) { return x.place === id; }); }
  function openPin(id, opener) {
    var p = pinOf(id); if (!p) return;
    var items = here(id), nodes = [], held = [];
    if (id !== 'HES' && S.o.analytics && inScope(S.scope, id)) nodes.unshift(hero(p)); // another district's numbers never load here, so no chip could be right
    nodes.push(h('h3', {}, owner() ? txt('decide') : txt('act')), list(items, COPY.here));
    if (id === 'HES' && S.o.hq) { var hq = S.o.hq(); nodes = nodes.concat(hq.nodes || []); held = hq.held || []; }
    var acts = [];
    if (owner() && S.o.setup) { // the Kingdom's own buildings dialog: every setup step here, assign and clear, Enter as Principal
      var bs = h('button', { type: 'button', class: 'gb-btn mh-btn' + (S.o.enterSchool ? '' : ' gb-btn-primary') }, txt(id === 'HES' ? 'hqsetup' : 'buildings'));
      bs.onclick = function () { var pin = S.o.scene.querySelector('.mh-pin[data-id="' + id + '"]') || S.el.edge; close(true); S.o.setup(id, pin); };
      acts.push(bs);
    } else if (owner() && id !== 'HES') acts.push(goLink('owner/kingdom.html#base-' + id, txt('buildings')));
    if (owner() && S.o.enterSchool && /^LMS[1-6]$/.test(id) && LMCSGame.setViewAs) {
      var enter = h('button', { type: 'button', class: 'gb-btn gb-btn-primary mh-btn' }, txt('enter'));
      enter.onclick = function () { keepSpot(id); LMCSGame.setViewAs({ campus: id, name: p.name }); location.assign(S.o.root + 'principal/index.html'); };
      nodes.push(h('p', { class: 'gb-muted' }, 'Its Home and World, as its Principal sees them. Nothing can be changed while you look; Leave in the top bar brings you back here.'));
      acts.push(enter);
    }
    if (!owner() && id !== 'HES') acts.push(goLink('coordinator/followups/index.html', 'All follow-ups'));
    if (acts.length) nodes.push(h('div', { class: 'mh-acts' }, acts));
    open({ title: p.full, sub: id === 'HES' && !owner() ? bi('office') : '', nodes: nodes, held: held, opener: opener, pin: id });
  }
  // Enter School -> the Principal home -> Leave: back to this map, the same place in view and focused (sessionStorage, this tab only)
  var SPOT_KEY = 'lmcs-map-return';
  function keepSpot(id) {
    var box = S.o.scene.querySelector('.mh-box'), page = String(location.pathname || '').split('/').slice(-2).join('/'), m = S.real && S.real.map;
    var v = { page: page, pin: id, x: box ? box.scrollLeft : 0, y: box ? box.scrollTop : 0 };
    if (m) { var c = m.getCenter(); v.lat = c.lat; v.lng = c.lng; v.z = m.getZoom(); }
    try { sessionStorage.setItem(SPOT_KEY, JSON.stringify(v)); } catch (e) { /* private mode: Leave lands on the map's start */ }
  }
  // box: the drawn valley's scroller, or null on the real map
  function backToSpot(box) {
    var v = null; try { v = JSON.parse(sessionStorage.getItem(SPOT_KEY) || 'null'); sessionStorage.removeItem(SPOT_KEY); } catch (e) { return false; }
    if (!v || !/^LMS[1-6]$/.test(String(v.pin))) return false;
    if (!box && S.real && S.real.map && isFinite(v.lat) && isFinite(v.lng) && isFinite(v.z)) S.real.map.setView([v.lat, v.lng], v.z, { animate: false });
    else if (box) { box.scrollLeft = Number(v.x) || 0; box.scrollTop = Number(v.y) || 0; }
    else return false;
    setTimeout(function () { var pin = S.o.scene.querySelector('.mh-pin[data-id="' + v.pin + '"]'); if (pin) pin.focus({ preventScroll: true }); }, 0);
    return true;
  }
  // the school's picture with its chips over it (a scrim keeps them readable); the reads load once, the first time a school is opened
  var ART_BASE = (document.currentScript && document.currentScript.src || '').replace(/[^/?#]*([?#].*)?$/, '') + 'art/';
  function hero(p) {
    var chips = h('ul', { class: 'mh-chips', 'aria-label': 'School analytics · आँकड़े', 'aria-busy': 'true' }, [h('li', { class: 'mh-chip-wait' }, 'Loading…')]);
    var art = ART[p.id] ? h('img', { class: 'mh-art', src: ART_BASE + ART[p.id] + '-1x.webp', srcset: ART_BASE + ART[p.id] + '-1x.webp 480w, ' + ART_BASE + ART[p.id] + '-2x.webp 960w',
      sizes: '(max-width:640px) 100vw, 560px', alt: '', loading: 'lazy', decoding: 'async' }) : h('span', { class: 'mh-art-plain', 'aria-hidden': 'true' }, LMCSEmoji.get('school'));
    var box = h('div', { class: 'mh-hero' + (ART[p.id] ? '' : ' is-plain') }, [art, h('div', { class: 'mh-scrim' }, [chips])]);
    stats().then(function (src) {
      if (!chips.isConnected) return;
      var list = campusStats(src, p.id, src.today), base = owner() && S.kingdom ? ((S.kingdom.kingdom || {}).campuses || []).filter(function (b) { return b.id === p.id; })[0] : null;
      if (base) list = list.concat(campusStats({ base: base }, p.id, src.today));
      chips.textContent = ''; chips.removeAttribute('aria-busy');
      if (!list.length) chips.appendChild(h('li', { class: 'mh-chip-wait' }, "Numbers didn't load. The rest of this window works."));
      list.forEach(function (c) {
        var b = h('button', { type: 'button', class: 'mh-stat is-' + c.tone, 'aria-label': c.label[1] + ': ' + c.say }, [emoji(c.e), h('b', {}, c.value), h('small', { lang: 'hi' }, c.label[0])]);
        b.onclick = function () {
          open({ title: c.label[0] + ' · ' + c.label[1], sub: p.full + ' · ' + c.say, opener: null, pin: p.id, nodes: [c.lines.length ? h('ul', { class: 'mh-lines' }, c.lines.map(function (l) { return h('li', {}, l); })) : note('Nothing to list.'),
            h('div', { class: 'mh-acts' }, [goLink(c.go, 'Open the page', true), (function () { var bk = h('button', { type: 'button', class: 'gb-btn mh-btn' }, '‹ ' + p.name); bk.onclick = function () { openPin(p.id); }; return bk; })()])] });
        };
        chips.appendChild(h('li', {}, b));
      });
    });
    return box;
  }
  function stats() {
    if (!S.stats) S.stats = Promise.resolve().then(function () { return S.o.analytics(); }).then(function (x) { return x || {}; }, function () { return {}; });
    return S.stats;
  }
  function openRank(opener) {
    var rows = owner() ? rankOwner(S.kingdom) : rankCoord(S.tasks === 'error' ? [] : S.tasks, S.scope);
    var intro = owner() ? 'Every school by its Kingdom level, then its points.' : 'The schools in your district, fewest open follow-ups first.';
    var ol = rows.length ? h('ol', { class: 'mh-rank' }, rows.map(function (r) { return h('li', {}, [h('b', { class: 'mh-rk', 'aria-hidden': 'true' }, String(r.rank)), h('span', { class: 'mh-row-t' }, [r.name, h('small', {}, r.line)]), h('span', { class: 'mh-sr' }, ', rank ' + r.rank)]); })) : note('Nothing to rank yet.');
    open({ title: bi('rank'), sub: intro, nodes: [ol], opener: opener });
  }
  function openProfile(opener) {
    var s = S.o.session, pr = S.o.profile ? S.o.profile() : { nodes: [], held: [] };
    var facts = h('dl', { class: 'mh-facts' }, [h('dt', {}, 'Name'), h('dd', {}, String(s.name || s.email || '')), h('dt', {}, 'Role'), h('dd', {}, S.o.role),
      S.scope ? h('dt', {}, 'District') : null, S.scope ? h('dd', {}, districtText(S.scope)) : null]);
    open({ title: String(s.name || bi('profile')), nodes: [facts].concat(pr.nodes || []), held: pr.held || [], opener: opener });
  }
  function openEvent(opener, label) {
    var n = [S.o.evSlot], l = S.o.evSlot.nextElementSibling; if (l && l.classList.contains('ev-live')) n.push(l);
    open({ title: label, nodes: n, held: n, opener: opener });
  }

  // ── the HUD ──
  function btn(cls, label, kids, fn) { var b = h('button', { type: 'button', class: cls, 'aria-label': label }, kids); b.onclick = function () { fn(b); }; return b; }
  function badge(n) { return h('span', { class: 'mh-badge', 'aria-hidden': 'true', hidden: n > 0 ? null : 'hidden' }, n > 99 ? '99+' : String(n)); }
  function tabs(keys, onSelect) {
    var el = h('div', { class: 'mh-tabs', role: 'tablist', 'aria-label': 'Tasks' }), btns = keys.map(function (k, i) {
      var b = h('button', { type: 'button', role: 'tab', id: 'mh-tab-' + i, 'aria-selected': 'false', 'aria-controls': 'mh-pane-' + i, tabindex: '-1' }, txt(k)); b.onclick = function () { select(i); }; return b;
    });
    function select(i, focus) { btns.forEach(function (b, k) { b.setAttribute('aria-selected', String(k === i)); b.tabIndex = k === i ? 0 : -1; }); if (focus) btns[i].focus(); onSelect(i); }
    btns.forEach(function (b, i) { el.appendChild(b); b.onkeydown = function (e) { var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!d) return; e.preventDefault(); select((i + d + btns.length) % btns.length, true); }; });
    return { el: el, select: select };
  }
  // ── edge entry points (Uday, 30 Oct: "every functionality appears on that one screen on the sides ... about 20 places that open up").
  // An entry: { key, e, label: [hi, en], value?, n?, soon?, soonText?, open(opener) }. A soon entry is on screen with its "जल्द · Coming soon" tag
  // and opens a window that says so, so nothing is a dead end. kind = 'icon' (right column), 'chip' (top bar), 'bar' (bottom bar) ──
  function soonWin(ent, opener) {
    open({ title: ent.label[0] + ' · ' + ent.label[1], sub: 'जल्द · Coming soon', opener: opener,
      nodes: [h('p', { class: 'mh-empty' }, ent.soonText || 'This opens here once it is built. Nothing to do yet.')] });
  }
  function entry(ent, kind) {
    var tag = ent.soon ? h('span', { class: 'mh-soon', 'aria-hidden': 'true' }, 'जल्द') : null;
    var val = ent.value != null && ent.value !== '' ? h('b', { class: 'mh-val' }, String(ent.value)) : null;
    var name = kind === 'chip' ? null : h('span', { class: kind === 'bar' ? 'mh-bar-t' : 'mh-icon-t', lang: 'hi' }, ent.label[0]);
    var say = ent.label[1] + ' · ' + ent.label[0] + (ent.value != null && ent.value !== '' ? ': ' + ent.value : '') + (ent.n ? ', ' + ent.n + ' waiting' : '') + (ent.soon ? ', coming soon' : '');
    var b = btn((kind === 'chip' ? 'mh-chipbtn' : kind === 'bar' ? 'mh-baritem' : 'mh-icon') + (ent.soon ? ' is-soon' : ''), say, [emoji(ent.e), val, name, tag, badge(ent.n || 0)],
      function (x) { if (ent.soon || !ent.open) soonWin(ent, x); else ent.open(x); });
    b.setAttribute('data-icon', ent.key); if (ent.pressed != null) b.setAttribute('aria-pressed', String(!!ent.pressed));
    return b;
  }
  function icon(ic) { return entry(ic, 'icon'); }
  // add, replace or (with { key } alone) remove an entry wherever it is; a new right-column icon goes to the top column
  function setIcon(ic) {
    var old = document.querySelector('.mh-hud [data-icon="' + ic.key + '"], .mh-bar [data-icon="' + ic.key + '"]'), kind = old ? (old.classList.contains('mh-chipbtn') ? 'chip' : old.classList.contains('mh-baritem') ? 'bar' : 'icon') : 'icon';
    var b = ic.open || ic.soon || ic.label ? entry(ic, kind) : null;
    if (old && b) old.replaceWith(b); else if (old) old.remove(); else if (b) S.el.events.appendChild(b);
  }
  function buildHud() {
    var o = S.o, el = {};
    el.avatar = btn('mh-avatar', 'Your profile · प्रोफ़ाइल', h('span', { 'aria-hidden': 'true' }, String((o.session.name || o.session.email || '?').trim().charAt(0) || '?').toUpperCase()), openProfile);
    // the chip under the avatar: the network score (Owner: Kingdom level) or the district; with ranking it opens the Ranking window
    el.chip = canRank(o.session) ? btn('mh-chip mh-chip-btn', 'Ranking · रैंकिंग', [], openRank) : h('span', { class: 'mh-chip' });
    el.chip.hidden = true;
    el.rank = canRank(o.session) && !o.top ? btn('mh-icon', 'Ranking · रैंकिंग', [emoji('ranking'), h('span', { class: 'mh-icon-t', lang: 'hi' }, L.rank[0])], openRank) : null;
    el.events = h('div', { class: 'mh-events' }, (el.rank ? [el.rank] : []).concat((o.icons || []).map(icon)));
    el.lower = h('div', { class: 'mh-lower' }, (o.lower || []).map(icon));
    el.top = o.top ? h('div', { class: 'mh-topbar' }, o.top.map(function (x) { return entry(x, 'chip'); })) : null;
    el.bar = o.bar ? h('nav', { class: 'mh-bar', 'aria-label': 'Owner · मालिक' }, o.bar.map(function (x) { return entry(x, 'bar'); })) : null;
    el.deadline = o.deadline ? h('button', { type: 'button', class: 'mh-deadline', id: 'mh-deadline' }, [emoji('due'), h('span', { class: 'mh-dl-t' }, '…')]) : null;
    if (el.deadline) el.deadline.onclick = function () { openDeadline(el.deadline); };
    el.ticker = o.ticker ? entry(o.ticker, 'icon') : null;
    if (el.ticker) el.ticker.className = 'mh-ticker is-soon';
    el.say = h('p', { class: 'mh-sr', role: 'status', 'aria-live': 'polite' });
    var panes = [0, 1, 2].map(function (i) { return h('div', { role: 'tabpanel', id: 'mh-pane-' + i, 'aria-labelledby': 'mh-tab-' + i, hidden: i ? 'hidden' : null }); });
    var tt = tabs(['town', 'wild', 'daily'], function (i) { panes.forEach(function (p, k) { p.hidden = k !== i; }); });
    el.drawer = h('aside', { class: 'mh-drawer', id: 'mh-drawer', 'aria-label': 'Tasks · काम' }, [tt.el].concat(panes));
    el.edge = h('button', { type: 'button', id: 'mh-edge', class: 'mh-edge', 'aria-expanded': 'false', 'aria-controls': 'mh-drawer', 'aria-label': 'Open tasks · काम' }, [h('span', { 'aria-hidden': 'true' }, '▸'), badge(0)]);
    function drawer(on, focus) {
      el.drawer.classList.toggle('is-open', on); el.edge.setAttribute('aria-expanded', String(on)); el.edge.setAttribute('aria-label', (on ? 'Close tasks' : 'Open tasks') + ' · काम');
      el.edge.firstChild.textContent = on ? '◂' : '▸'; el.drawer.inert = !on;
      if (focus) (on ? tt.el.querySelector('[aria-selected="true"]') : el.edge).focus();
    }
    el.edge.onclick = function () { drawer(!el.drawer.classList.contains('is-open'), true); };
    el.drawer.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); drawer(false, true); } });
    drawer(false); tt.select(0);
    el.panes = panes;
    el.strip = h('button', { type: 'button', id: 'mh-strip', class: 'mh-strip' }, [emoji('quests'), h('span', { class: 'mh-strip-t' }, COPY.loading), badge(0)]);
    el.strip.onclick = function () { var x = S.items[0]; if (x) openItem(x, el.strip); else drawer(true, true); };
    o.scene.appendChild(h('div', { class: 'mh-hud' + (o.top ? ' is-full' : '') }, [h('div', { class: 'mh-tl' }, [el.avatar, el.chip, el.deadline]), el.top, el.events, el.lower, el.edge, el.drawer,
      h('div', { class: 'mh-bottom' }, [el.strip, el.ticker, o.bar ? null : o.switchEl]), el.say]));
    if (el.bar) o.scene.parentNode.insertBefore(el.bar, o.scene.nextSibling); // the bottom bar sits under the scene, like a game's dock
    S.el = el; S.drawer = drawer; S.tabs = tt;
  }
  function openDeadline(opener) {
    var d = S.deadline;
    open({ title: 'Next deadline · अगली तारीख़', opener: opener, nodes: d ? [h('p', { class: 'mh-detail' }, d.title), h('p', { class: 'mh-pills' }, [h('span', { class: 'gb-pill' + (d.late ? ' gb-pill-low' : '') }, (d.late ? 'Overdue by ' : 'Due in ') + d.left + ' · ' + dueText(d.due))])]
      : [note('Nothing on your list has a due date right now.')] });
  }

  // ── the map ──
  function art() {
    if (window.LMCSKingdom && typeof LMCSKingdom.valley === 'function') { try { return LMCSKingdom.valley(); } catch (e) { /* the plain field below */ } }
    return h('div', { class: 'mh-field', 'aria-hidden': 'true' });
  }
  // one place's marker: the fort, its name plate, and a bubble when something waits there. dim = another district (not a button)
  function makePin(p, c, extraStyle, label) {
    var dim = !owner() && !inScope(S.scope, p.id) && !c; // an item assigned to you there keeps it live
    var base = owner() && S.kingdom ? ((S.kingdom.kingdom || {}).campuses || []).filter(function (b) { return b.id === p.id; })[0] : null;
    var top = here(p.id)[0], kids = [h('span', { class: 'mh-fort', 'aria-hidden': 'true' }, LMCSEmoji.get(p.darbar || p.id === 'HES' ? 'hq' : 'school')), h('span', { class: 'mh-plate', 'aria-hidden': 'true' }, label || p.name),
      base ? h('span', { class: 'mh-lv', 'aria-hidden': 'true' }, 'Lv ' + (Number(base.level) || 0)) : null,
      c ? h('span', { class: 'mh-bub', 'aria-hidden': 'true' }, [LMCSEmoji.get(top.e), h('b', {}, c > 99 ? '99+' : String(c))]) : null];
    var cls = 'mh-pin' + (p.darbar || p.id === 'HES' ? ' is-hq' : '') + (dim ? ' is-dim' : '') + (!dim && !owner() && !inScope(S.scope, p.id) ? ' is-out' : '');
    var pin = dim ? h('span', { class: cls, style: extraStyle, 'data-id': p.id, role: 'img', 'aria-label': pinLabel(p, 0, S.o.role, true) }, kids)
      : h('button', { type: 'button', class: cls, style: extraStyle, 'data-id': p.id, 'aria-label': pinLabel(p, c, S.o.role, false) + (base ? ', level ' + (Number(base.level) || 0) : '') }, kids);
    if (!dim) pin.onclick = function (e) { if (window.L && window.L.DomEvent) window.L.DomEvent.stopPropagation(e); var box = S.o.scene.querySelector('.mh-box'); if (!(box && box.dragged)) openPin(p.id, pin); };
    return pin;
  }
  function drawMap() {
    if (S.o.realMap && window.LMCSKingdomMap && window.LMCSPlaces && S.real !== false) return drawReal();
    var box = S.o.scene.querySelector('.mh-box'), first = !box;
    if (first) {
      box = h('div', { class: 'mh-box', id: 'mh-mapbox', tabindex: '0', role: 'region', 'aria-label': 'Map. Scroll or drag to look around; tap a place to open it.' }, [h('div', { class: 'mh-map' }, [art(), h('div', { class: 'mh-pins' })])]);
      S.o.scene.querySelector('.mh-town').appendChild(box);
      drag(box);
    }
    var layer = box.querySelector('.mh-pins'), n = countByPlace(S.items);
    layer.textContent = '';
    S.pins.forEach(function (p) { layer.appendChild(makePin(p, n[p.id] || 0, pos(p))); });
    if (first && !(owner() && backToSpot(box))) centre(box);
  }
  // ── the real map (Uday, 29 Oct: "I love the Map"): the Kingdom's OpenStreetMap, positions from assets/game/places.js only. Leaflet loads on
  // the first paint here (this is the page); if it can't load (offline, blocked), the drawn valley takes its place. Close places group into
  // one pin until zoomed in, as on the Kingdom's map (LMCSKingdomMap.cluster). ──
  function drawReal() {
    var R = S.real;
    if (!R) {
      R = S.real = { loading: true };
      var el = h('div', { class: 'mh-leaf', 'aria-label': 'Map of LMCS HQ and the schools' }), box = h('div', { class: 'mh-box is-real', id: 'mh-mapbox' }, [el, h('p', { class: 'mh-maptxt', role: 'status' }, 'Loading the map…')]);
      S.o.scene.querySelector('.mh-town').appendChild(box);
      LMCSKingdomMap.load().then(function () {
        var Lf = window.L; // Leaflet (this file's own L is its labels)
        var c = LMCSPlaces.CENTER || { lat: 31.8, lng: 77.0, zoom: 9 };
        R.map = Lf.map(el, { zoomControl: false, attributionControl: false }).setView([c.lat, c.lng], c.zoom);
        Lf.control.attribution({ position: 'bottomleft' }).addTo(R.map); // OpenStreetMap's credit stays in view, clear of the strip and the edge icons
        Lf.control.zoom({ position: 'bottomleft' }).addTo(R.map); // the left side is free of edge icons
        Lf.tileLayer(LMCSKingdomMap.TILES, { maxZoom: 19, attribution: LMCSKingdomMap.ATTRIBUTION }).addTo(R.map);
        R.layer = Lf.layerGroup().addTo(R.map); R.loading = false;
        box.removeChild(box.lastChild);
        R.map.on('zoomend', pinsReal);
        var pts = LMCSKingdomMap.drawable(LMCSPlaces), back = owner() && backToSpot(null);
        if (!back && pts.length) R.map.fitBounds(home(pts).map(function (p) { return [p.lat, p.lng]; }), { padding: [60, 60], maxZoom: 13 });
        pinsReal();
      }, function () { S.real = false; box.remove(); drawMap(); }); // no map: the drawn valley
      return;
    }
    if (!R.loading) pinsReal();
  }
  // where the map starts: every place for the Owner; the district and HQ for a Coordinator
  function home(pts) { var mine = pts.filter(function (p) { return inScope(S.scope, p.id); }); return mine.length ? mine : pts; }
  var COMPACT_BELOW = 11; // zoomed out: a pin shows its short name only ("1", "HQ"), as on the Kingdom's map
  function pinsReal() {
    var R = S.real, Lf = window.L; if (!R || !R.map) return;
    var n = countByPlace(S.items), compact = R.map.getZoom() < COMPACT_BELOW, byId = {};
    (S.pins || []).forEach(function (p) { byId[p.id] = p; });
    var pts = LMCSKingdomMap.drawable(LMCSPlaces).map(function (p) { var c = R.map.latLngToContainerPoint([p.lat, p.lng]); return { id: p.id, name: p.name, lat: p.lat, lng: p.lng, x: c.x, y: c.y }; });
    R.layer.clearLayers();
    LMCSKingdomMap.cluster(pts, compact ? 72 : 130, 56).forEach(function (g) {
      var lat = 0, lng = 0; g.forEach(function (p) { lat += p.lat / g.length; lng += p.lng / g.length; });
      var node;
      if (g.length === 1) {
        var p = byId[g[0].id] || { id: g[0].id, name: g[0].name, full: g[0].name };
        node = makePin(p, n[p.id] || 0, '', LMCSKingdomMap.tag(g[0], compact));
      } else {
        var c = g.reduce(function (t, p) { return t + (n[p.id] || 0); }, 0);
        node = h('button', { type: 'button', class: 'mh-pin is-grp', 'aria-label': g.map(function (p) { return p.name; }).join(' and ') + (c ? ', ' + c + ' waiting' : '') + ': zoom in' },
          [h('span', { class: 'mh-fort', 'aria-hidden': 'true' }, LMCSEmoji.get('school')), h('span', { class: 'mh-plate', 'aria-hidden': 'true' }, g.map(function (p) { return LMCSKingdomMap.tag(p, compact); }).join(' · ')),
            c ? h('span', { class: 'mh-bub', 'aria-hidden': 'true' }, [h('b', {}, String(c))]) : null]);
        node.onclick = function (e) { Lf.DomEvent.stopPropagation(e); R.map.fitBounds(g.map(function (p) { return [p.lat, p.lng]; }), { padding: [90, 90], maxZoom: 15 }); };
      }
      Lf.marker([lat, lng], { icon: Lf.divIcon({ html: node, className: 'mh-ico', iconSize: null }), keyboard: false }).addTo(R.layer);
    });
  }
  // phones: start with LMCS HQ in the middle of the view, once
  function centre(box) {
    var hq = box.querySelector('.mh-pin.is-hq'); if (!hq || !box.clientWidth) return;
    box.scrollLeft = Math.max(0, hq.offsetLeft - box.clientWidth / 2); box.scrollTop = Math.max(0, hq.offsetTop - box.clientHeight / 2);
  }
  // drag to pan with a mouse (touch already scrolls natively); a drag never opens the pin under it
  function drag(box) {
    var d = null;
    box.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse' || e.button) return; d = { x: e.clientX, y: e.clientY, l: box.scrollLeft, t: box.scrollTop, moved: false }; box.dragged = false; });
    window.addEventListener('pointermove', function (e) { if (!d) return; var dx = e.clientX - d.x, dy = e.clientY - d.y; if (Math.abs(dx) + Math.abs(dy) > 6) d.moved = true; if (d.moved) { box.scrollLeft = d.l - dx; box.scrollTop = d.t - dy; box.classList.add('is-drag'); } });
    window.addEventListener('pointerup', function () { if (!d) return; box.dragged = d.moved; d = null; box.classList.remove('is-drag'); setTimeout(function () { box.dragged = false; }, 0); });
  }

  // ── everything that follows the data ──
  function render() {
    var o = S.o, el = S.el;
    S.items = owner() ? ownerDecisions(S.kingdom) : coordActions(S.tasks === 'error' ? [] : S.tasks, S.today, o.session.email, S.scope);
    S.pins = owner() ? pinsFrom(S.kingdom) : PINS.slice();
    drawMap();
    var town = S.items.filter(function (x) { return !isWild(x); }), wild = S.items.filter(isWild);
    el.panes[0].textContent = '';
    if (!owner() && S.tasks === 'error') el.panes[0].appendChild(h('p', { class: 'gb-err', role: 'alert' }, COPY.tasksErr));
    el.panes[0].appendChild(h('h3', { class: 'mh-sr' }, owner() ? bi('decide') : bi('act')));
    el.panes[0].appendChild(list(town, S.loaded ? (owner() ? COPY.ownerClear : COPY.coordClear) : COPY.loading));
    var routes = h('button', { type: 'button', class: 'mh-row' }, [emoji('bus'), h('span', { class: 'mh-row-t' }, txt('routes')), h('span', { class: 'mh-go', 'aria-hidden': 'true' }, '›')]);
    routes.onclick = function () { S.drawer(false); o.world(true); var b = o.switchEl && o.switchEl.querySelector('button[aria-pressed="true"]'); if (b) b.focus(); };
    el.panes[1].textContent = ''; el.panes[1].appendChild(h('ul', { class: 'mh-list' }, [h('li', {}, routes)].concat(wild.map(function (x) { return h('li', {}, itemRow(x)); }))));
    var day = ((S.today && S.today.missions) || []).filter(function (m) { return !m.gone && m.why !== 'Assigned by the Owner'; }).map(function (m) {
      var href = !m.done && m.go ? LMCSGame.safeHref(m.go, o.root) : null, kids = [h('span', { class: 'mh-mark', 'aria-hidden': 'true' }, m.done ? LMCSEmoji.get('done') : '○'), h('span', { class: 'mh-row-t' }, String(m.title || '')), h('span', { class: 'mh-sr' }, m.done ? 'Done' : 'To do')];
      return href ? h('a', { class: 'mh-row', href: href }, kids) : h('div', { class: 'mh-row is-static' + (m.done ? ' is-done' : '') }, kids);
    });
    el.panes[2].textContent = ''; el.panes[2].appendChild(day.length ? h('ul', { class: 'mh-list' }, day.map(function (r) { return h('li', {}, r); })) : note(COPY.daily));
    var total = S.items.length, b = el.edge.lastChild;
    b.textContent = total > 99 ? '99+' : String(total); b.hidden = !total;
    el.edge.setAttribute('aria-label', (el.drawer.classList.contains('is-open') ? 'Close tasks' : 'Open tasks') + ' · काम' + (total ? ', ' + total + ' waiting' : ''));
    el.strip.querySelector('.mh-strip-t').textContent = S.items[0] ? S.items[0].title : S.loaded ? (owner() ? COPY.ownerClear : COPY.coordClear) : COPY.loading;
    var sb = el.strip.lastChild; sb.textContent = String(total); sb.hidden = !total;
    el.strip.setAttribute('aria-label', (S.items[0] ? 'Next: ' + S.items[0].title : el.strip.querySelector('.mh-strip-t').textContent) + (total ? ', ' + total + ' waiting' : ''));
    if (el.deadline) {
      S.deadline = nextDeadline(((S.today && S.today.missions) || []).concat(S.items), new Date());
      el.deadline.lastChild.textContent = S.deadline ? (S.deadline.late ? 'Overdue ' : '') + S.deadline.left : 'None';
      el.deadline.classList.toggle('is-late', !!(S.deadline && S.deadline.late));
      el.deadline.setAttribute('aria-label', 'Next deadline · अगली तारीख़: ' + (S.deadline ? S.deadline.title + ', ' + (S.deadline.late ? 'overdue by ' : 'in ') + S.deadline.left : 'none'));
    }
    var lv = owner() && S.kingdom && S.kingdom.kingdom ? Number(S.kingdom.kingdom.level) || 0 : null;
    el.chip.hidden = owner() ? lv === null : !S.scope;
    el.chip.textContent = owner() ? (lv === null ? '' : (LMCSEmoji.get('level') + ' Network Lv ' + lv).trim()) : S.scope ? (LMCSEmoji.get('world') + ' ' + districtText(S.scope)).trim() : '';
    if (el.chip.tagName === 'BUTTON') el.chip.setAttribute('aria-label', (owner() ? 'Network score: Kingdom level ' + lv : 'Your district: ' + districtText(S.scope)) + '. Opens the Ranking · रैंकिंग');
    if (canRank(o.session) && !owner() && !S.scope) el.chip.hidden = true;
  }
  // the right column: Ranking, then one icon per running event (Game Day), taken from event.js's card when the page has one
  function renderEvents() {
    var box = S.el.events; [].slice.call(box.querySelectorAll('.mh-evt')).forEach(function (n) { n.remove(); });
    var card = S.o.evSlot && S.o.evSlot.querySelector('.ev-card'); if (!card) return;
    var hd = card.querySelector('h2'), name = hd && hd.lastChild ? hd.lastChild.textContent.trim() : 'Event', left = card.querySelectorAll('.ev-step:not(.ev-done)').length;
    var b = btn('mh-icon mh-evt', name + (left ? ', ' + left + ' waiting' : ''), [emoji('events'), h('span', { class: 'mh-icon-t' }, name), badge(left)], function (x) { openEvent(x, name); });
    box.appendChild(b);
  }

  // the scene fills the screen from its top to the game rail (fixed at the bottom on phones) or the window's bottom, whatever sits above it
  function fit() {
    var sc = S.o.scene, top = sc.getBoundingClientRect().top + (window.scrollY || 0), rail = document.getElementById('game-rail'), bottom = window.innerHeight;
    if (rail && !rail.hidden && getComputedStyle(rail).position === 'fixed') { var r = rail.getBoundingClientRect(); if (r.top > window.innerHeight / 2) bottom = r.top; }
    var bar = document.querySelector('.mh-bar'); if (bar) bottom -= bar.offsetHeight; // the bottom bar sits under the scene
    sc.style.height = Math.max(420, Math.round(bottom - top)) + 'px';
  }
  function mount(o) {
    S.o = o; S.scope = o.role === 'Owner' ? null : scopeOf(o.session);
    document.body.classList.add('mh');
    LMCSGame.setTourTargets({ today: '#mh-strip', go: null, bar: '#mh-edge', quest: null }); // Today lives in the drawer: Buddy's tour points at the quest strip and the task tab
    var town = h('div', { class: 'mh-town', id: 'mh-town' });
    o.scene.insertBefore(town, o.scene.firstChild);
    buildHud(); render(); fit();
    window.addEventListener('resize', fit); setTimeout(fit, 400); // again once the rail and the data-source line have drawn
    if (window.ResizeObserver) new ResizeObserver(fit).observe(document.body); // e.g. the data-source line drawn under the header after sign-in
    document.addEventListener('lmcs-game-today', function (e) { S.today = e.detail; render(); });
    if (o.evSlot) { new MutationObserver(renderEvents).observe(o.evSlot, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }); renderEvents(); }
    // the rail's Missions and Quests open the hub's Today, which lives in the drawer here: Missions -> Daily, Quests -> Town
    var rail = document.getElementById('game-rail');
    if (rail) rail.addEventListener('click', function (e) {
      var a = e.target.closest('a.gb-rail-i'); if (!a || !/#game-root$/.test(a.getAttribute('href') || '')) return;
      e.preventDefault(); S.drawer(true); S.tabs.select(/Missions/.test(a.textContent) ? 2 : 0, true);
    });
  }
  api.mount = mount;
  api.setKingdom = function (d) { S.kingdom = d && d.success ? d : S.kingdom; S.loaded = true; if (S.el) render(); };
  api.setTasks = function (t) { S.tasks = t === 'error' ? 'error' : Array.isArray(t) ? t : []; S.loaded = true; if (S.el) render(); };
  api.openPin = function (id) { openPin(id); }; api.close = function () { close(); }; api.open = function (o) { open(o); };
  api.setIcon = function (ic) { if (S.el) setIcon(ic); }; // { key, ... } adds or replaces; { key } alone removes
  return api;
})();
if (typeof module !== 'undefined') module.exports = LMCSMapHome;
