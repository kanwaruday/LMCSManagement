// The Owner's Kingdom page (owner/kingdom.html): a read-only valley map of the gamekingdom read model (game-kingdom.gs).
// Pure helpers first (tests run them in a vm); the page code sits below the early return. Every server string reaches the
// DOM as a text node (LMCSGame.ui.h); links go through LMCSGame.safeHref only. K5 adds tap-to-assign (Owner only, confirm before every write) through `hooks`:
//   hooks.tier(tier, base, building) -> a node (or null) shown under that tier;  hooks.base(base) -> a node at the end of the base dialog;
//   hooks.after(data) -> runs after every render.  LMCSKingdom.refresh() re-fetches; LMCSKingdom.last() is the last response.
var LMCSKingdom = window.LMCSKingdom = (function () {
  var NOTE = { done: '✓ ', soon: ' · coming soon', unknown: " · couldn't check" };

  function tierText(t) {
    var label = String((t && t.label) || '');
    if (t && t.state === 'done') return NOTE.done + label;
    if (t && t.state === 'soon') return label + NOTE.soon;
    if (t && t.state === 'unknown') return label + NOTE.unknown;
    return label;
  }
  function buildingState(b) {
    var l = Number(b && b.level) || 0;
    return l > 0 && l === Number(b.maxLevel) ? 'built' : l > 0 ? 'construction' : 'empty';
  }
  function baseBadge(base) { return 'Lv ' + (Number(base && base.level) || 0); }
  // LMCS HQ first, then the others in the order the config gave (never by level)
  function sortBases(bases) {
    var all = bases || [];
    return all.filter(function (b) { return b.darbar; }).concat(all.filter(function (b) { return !b.darbar; }));
  }
  function safeGo(go, root) { return LMCSGame.safeHref(go, root); }
  // '#base-LMS5' -> 'LMS5', anything else -> ''
  function baseOfGo(go) { var m = /^#base-([\w-]+)$/.exec(String(go || '')); return m ? m[1] : ''; }
  // the map's box: x, y are on a 1000 x 620 valley
  function pos(b) { return 'left:' + (Number(b.x) / 10) + '%;top:' + (Number(b.y) / 6.2) + '%'; }
  function openCount(head) { return ((head && head.missions) || []).filter(function (m) { return !m.done; }).length; }
  function countText(n) { return !n ? 'Nothing open' : n + (n === 1 ? ' mission open' : ' missions open'); }
  function baseLabel(b) {
    var u = Number(b.unknown) || 0;
    return (b.full || b.name) + ', ' + baseBadge(b).replace('Lv', 'level') + (u ? ', ' + u + (u === 1 ? ' step' : ' steps') + " couldn't be checked" : '');
  }

  // ── K5: write bodies and small pure helpers (the page below posts them; nothing is written before a confirm) ──
  // approval category -> the head function that usually owns it (client hint only: Buddy suggests, the Owner picks)
  var KINGDOM_DEPT_FUNCTION = { 'Financial / Purchase': 'finance', 'Academic Change': 'academics', 'Event / Invitation': 'events',
    'Off-Campus Trip / Excursion': 'events', 'Holiday / Calendar': 'events', 'Leave': 'hr', 'Compensatory Leave': 'hr', 'Compensation Change': 'hr',
    'Salary Offer Approval': 'hr', 'EPF Exemption': 'hr', 'Disciplinary / Termination': 'hr' };
  // LMCS HQ (HES, the society) holds the network-wide quests: their campus is '' on the wire
  function assignBody(tier, campus, email, note, clear) {
    var b = { action: 'kingdomassign', quest: tier.questId, campus: typeof tier.campus === 'string' ? tier.campus : campus === 'HES' ? '' : campus, assignee: email, note: note };
    if (clear) { b.clear = true; b.assignee = ''; }
    return b;
  }
  function allocateBody(card, email, due, note) { return { action: 'kingdomallocate', approvalId: card.id, assignee: email, due: due, note: note }; }
  // 'YYYY-MM-DD' + days as pure calendar arithmetic (UTC), so no time zone can move the day
  function defaultDue(todayIso, days) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(todayIso)); if (!m) return '';
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + (Number(days) || 0)));
    return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
  }
  function suggestHead(card, heads, deptMap) {
    var fn = (deptMap || KINGDOM_DEPT_FUNCTION)[card && card.category];
    return (fn && (heads || []).filter(function (x) { return (x.functions || []).indexOf(fn) !== -1; })[0]) || null;
  }
  // a setup step's How link: only a plain guide id becomes a link (the server's string never builds a path)
  function guideGo(s) { return s && /^[\w-]+$/.test(String(s.guide || '')) ? 'guide/index.html#' + s.guide : ''; }
  function cardText(c) { return 'Approved: ' + c.title + (c.campus ? ' · ' + c.campus : ''); }

  // ── UX pass: progress, the one next step, labels, level-ups (pure; the page below draws them) ──
  // a head function id as people say it
  var FN_LABEL = { finance: 'Accounts', transport: 'Transport', academics: 'Academics', hr: 'HR', events: 'Events', systems: 'Systems', all: 'All functions' };
  function fnLabels(fns) { return (fns || []).map(function (f) { return FN_LABEL[f] || String(f); }).join(', '); }
  // steps that can be built (coming-soon and couldn't-check steps don't count): { done, total }
  function progressOf(bases) {
    var p = { done: 0, total: 0 };
    (bases || []).forEach(function (b) { (b.buildings || []).forEach(function (bl) { (bl.tiers || []).forEach(function (t) {
      if (t.state === 'soon' || t.state === 'unknown') return;
      p.total++; if (t.state === 'done') p.done++;
    }); }); });
    return p;
  }
  function progressText(p) { return p.done + ' of ' + p.total + (p.total === 1 ? ' step built' : ' steps built'); }
  // a building's next step: its first tier that isn't done and can be worked on (open), else null
  function nextTier(b) { return ((b && b.tiers) || []).filter(function (t) { return t.state === 'open'; })[0] || null; }
  // only coming-soon steps: shown as one quiet line, not a card
  function onlySoon(b) { var ts = (b && b.tiers) || []; return ts.length > 0 && ts.every(function (t) { return t.state === 'soon'; }); }
  // the one thing to do next, in this order: the Owner's own setup step, a step to hand out, an approved request to follow up,
  // a step the schools are working on, else nothing. -> { kind: 'setup'|'assign'|'follow'|'wait'|'done', base?, building?, tier?, step?, card? }
  function nextAction(d) {
    var bases = sortBases((d && d.kingdom && d.kingdom.campuses) || []), owner = d && d.role === 'Owner', i, j, k, t;
    if (owner) {
      for (i = 0; i < bases.length; i++) for (j = 0; j < (bases[i].buildings || []).length; j++) {
        t = (bases[i].buildings[j].tiers || []).filter(function (x) { return x.state === 'open' && (x.steps || []).length; })[0];
        var st = t && t.steps.filter(function (s) { return !s.done; })[0];
        if (st) return { kind: 'setup', base: bases[i], building: bases[i].buildings[j], tier: t, step: st };
      }
      for (i = 0; i < bases.length; i++) for (j = 0; j < (bases[i].buildings || []).length; j++) for (k = 0; k < (bases[i].buildings[j].tiers || []).length; k++) {
        t = bases[i].buildings[j].tiers[k];
        if (t.state === 'open' && t.assignable && !t.owner && (t.assignees || []).length) return { kind: 'assign', base: bases[i], building: bases[i].buildings[j], tier: t };
      }
      if ((d.cards || []).length && (d.followHeads || []).length) return { kind: 'follow', card: d.cards[0] };
    }
    for (i = 0; i < bases.length; i++) for (j = 0; j < (bases[i].buildings || []).length; j++) {
      t = nextTier(bases[i].buildings[j]);
      if (t) return { kind: 'wait', base: bases[i], building: bases[i].buildings[j], tier: t };
    }
    return { kind: 'done' };
  }
  // Buddy's line for a next action (warm, short, no pressure; names the place)
  function nextText(a) {
    if (a.kind === 'setup') return 'Next in Set up the game: ' + a.step.title + '.' + (guideGo(a.step) ? ' My guide walks you through it.' : '');
    if (a.kind === 'assign') return 'Hand out ' + a.tier.label + ' at ' + a.base.name + '. Pick who sets it up, and it lands in their Today list.';
    if (a.kind === 'follow') return 'An approved request is waiting for someone to follow it up: ' + a.card.title + '.';
    if (a.kind === 'wait') return 'Next at ' + a.base.name + ': ' + a.tier.label + ' (' + a.building.name + ')' + (a.tier.owner && a.tier.owner.name ? ', with ' + a.tier.owner.name : '') + '.';
    return 'Every building that can be checked is up to date. Shabash.';
  }
  // buildings that went up a level since the last visit. prev = { 'LMS1|treasury': 2 } (null on a first visit: nothing to celebrate)
  function levelSnapshot(bases) {
    var out = {};
    (bases || []).forEach(function (b) { (b.buildings || []).forEach(function (bl) { out[b.id + '|' + bl.id] = Number(bl.level) || 0; }); });
    return out;
  }
  function levelUps(prev, bases) {
    if (!prev || typeof prev !== 'object') return [];
    var out = [];
    (bases || []).forEach(function (b) { (b.buildings || []).forEach(function (bl) {
      var was = Number(prev[b.id + '|' + bl.id]), now = Number(bl.level) || 0;
      if (isFinite(was) && now > was) out.push({ base: b, building: bl, level: now });
    }); });
    return out;
  }
  function levelUpText(u) {
    var where = u.base.darbar ? 'The ' + u.building.name : u.building.name + ' at ' + u.base.name;
    return where + ' reached level ' + u.level + (u.level === Number(u.building.maxLevel) ? ', fully built' : '') + '. Shabash.';
  }

  // ── 🎉 Game Day (gameeventboard, game-event.gs): the Owner's live panel (pure lines; the page below draws them) ──
  function gdNetworkText(n) { return n ? n.schoolsAtGoal + ' of ' + n.of + ' schools at ' + n.goalPct + '%' + (n.reward ? ' → ' + n.reward : '') : ''; }
  function gdSchoolLine(s) { return s.name + ': ' + s.in + ' of ' + s.people + ' in · ' + s.done + ' done · ' + s.pct + '%'; }

  var api = { gdNetworkText: gdNetworkText, gdSchoolLine: gdSchoolLine, tierText: tierText, buildingState: buildingState, baseBadge: baseBadge, sortBases: sortBases, safeGo: safeGo, baseOfGo: baseOfGo, pos: pos,
    openCount: openCount, countText: countText, baseLabel: baseLabel, assignBody: assignBody, allocateBody: allocateBody, defaultDue: defaultDue, suggestHead: suggestHead,
    deptFunction: KINGDOM_DEPT_FUNCTION, guideGo: guideGo, cardText: cardText, fnLabels: fnLabels, progressOf: progressOf, progressText: progressText,
    nextTier: nextTier, onlySoon: onlySoon, nextAction: nextAction, nextText: nextText, levelSnapshot: levelSnapshot, levelUps: levelUps, levelUpText: levelUpText,
    hooks: { tier: null, base: null, after: null } };
  if (typeof document === 'undefined') return api; // tests: the helpers only

  // ═══ UI ═══════════════════════════════════════════════════════════
  var VALLEY = "<svg xmlns=\"http://www.w3.org/2000/svg\" class=\"kg-valley\" viewBox=\"0 0 1000 620\" preserveAspectRatio=\"none\" aria-hidden=\"true\"> <defs> <symbol id=\"k-fort\" viewBox=\"0 0 64 56\"> <path d=\"M6 54h52v-4H6z\" fill=\"var(--stone2)\"/> <rect x=\"10\" y=\"30\" width=\"44\" height=\"20\" fill=\"var(--stone)\"/> <path d=\"M10 36h44M10 43h44\" stroke=\"var(--stone2)\" stroke-width=\"1.2\"/> <rect x=\"10\" y=\"27\" width=\"44\" height=\"4\" fill=\"var(--timber)\"/> <path d=\"M6 28 32 12l26 16z\" fill=\"var(--slate)\"/> <path d=\"M12 26 32 14l20 12\" fill=\"none\" stroke=\"#fff\" stroke-opacity=\".25\" stroke-width=\"1.2\"/> <rect x=\"28\" y=\"38\" width=\"8\" height=\"12\" rx=\"4\" fill=\"var(--timber)\"/> <rect x=\"15\" y=\"34\" width=\"5\" height=\"5\" fill=\"var(--timber)\"/><rect x=\"44\" y=\"34\" width=\"5\" height=\"5\" fill=\"var(--timber)\"/> <path d=\"M32 12V2\" stroke=\"var(--timber)\" stroke-width=\"1.6\"/> <path d=\"M32 2h11l-3 3 3 3H32z\" fill=\"var(--red)\"/> </symbol> <symbol id=\"k-darbar\" viewBox=\"0 0 64 56\"> <path d=\"M2 54h60v-4H2z\" fill=\"var(--stone2)\"/> <rect x=\"6\" y=\"32\" width=\"52\" height=\"18\" fill=\"var(--stone)\"/> <rect x=\"6\" y=\"29\" width=\"52\" height=\"4\" fill=\"var(--timber)\"/> <path d=\"M2 30 32 18l30 12z\" fill=\"var(--slate)\"/> <rect x=\"22\" y=\"14\" width=\"20\" height=\"16\" fill=\"var(--stone)\"/> <rect x=\"22\" y=\"12\" width=\"20\" height=\"3\" fill=\"var(--timber)\"/> <path d=\"M18 13 32 3l14 10z\" fill=\"var(--slate)\"/> <path d=\"M32 3V-4\" stroke=\"var(--timber)\" stroke-width=\"1.6\"/> <circle cx=\"32\" cy=\"22\" r=\"3\" fill=\"var(--gold)\"/> <rect x=\"28\" y=\"38\" width=\"8\" height=\"12\" rx=\"4\" fill=\"var(--timber)\"/> <path d=\"M10 36h6v6h-6zM48 36h6v6h-6z\" fill=\"var(--timber)\"/> </symbol> <symbol id=\"k-tree\" viewBox=\"0 0 10 20\"><path d=\"M5 0 9 9H7l3 6H6v5H4v-5H0l3-6H1z\" fill=\"var(--deodar)\"/></symbol> </defs> <rect width=\"1000\" height=\"620\" fill=\"var(--sky)\"/> <path d=\"M0 150 90 70 160 120 250 30 330 110 420 50 520 130 600 40 700 120 790 60 880 130 1000 70V260H0z\" fill=\"var(--peak)\"/> <path d=\"M228 50 250 30 272 52 262 48 250 58 240 48zM580 58 600 40 620 60 610 56 600 64 590 56zM772 76 790 60 808 78 798 74 790 82 782 74z\" fill=\"var(--snow)\"/> <path d=\"M0 230C120 170 230 210 330 180S540 150 640 190 850 160 1000 200V620H0z\" fill=\"var(--ridge1)\"/> <path d=\"M0 330C140 280 260 330 380 300S600 260 720 310 900 280 1000 300V620H0z\" fill=\"var(--ridge2)\"/> <path d=\"M0 330C140 280 260 330 380 300\" fill=\"none\" stroke=\"var(--field)\" stroke-width=\"3\" stroke-dasharray=\"2 9\" opacity=\".7\"/> <path d=\"M0 470C150 430 280 470 420 450S700 420 820 455 940 440 1000 450V620H0z\" fill=\"var(--ridge3)\"/> <path d=\"M880 0C860 90 790 150 720 200S600 300 560 360 470 470 430 620\" fill=\"none\" stroke=\"var(--river)\" stroke-width=\"16\" stroke-linecap=\"round\" opacity=\".9\"/> <path d=\"M880 0C860 90 790 150 720 200S600 300 560 360 470 470 430 620\" fill=\"none\" stroke=\"var(--sky2)\" stroke-width=\"2\" stroke-dasharray=\"14 18\" opacity=\".6\"/> <path d=\"M200 330C300 340 420 330 500 330S650 250 690 160M500 330C560 380 560 450 560 500M500 330C430 380 380 430 360 470M500 330C620 300 760 260 820 235M500 330C460 300 520 240 590 215\" fill=\"none\" stroke=\"var(--path)\" stroke-width=\"4\" stroke-dasharray=\"1 8\" stroke-linecap=\"round\"/> <g> <use href=\"#k-tree\" x=\"90\" y=\"250\" width=\"14\" height=\"28\"/><use href=\"#k-tree\" x=\"108\" y=\"262\" width=\"12\" height=\"24\"/> <use href=\"#k-tree\" x=\"300\" y=\"215\" width=\"12\" height=\"24\"/><use href=\"#k-tree\" x=\"420\" y=\"195\" width=\"14\" height=\"28\"/> <use href=\"#k-tree\" x=\"760\" y=\"330\" width=\"14\" height=\"28\"/><use href=\"#k-tree\" x=\"778\" y=\"342\" width=\"12\" height=\"24\"/> <use href=\"#k-tree\" x=\"900\" y=\"360\" width=\"14\" height=\"28\"/><use href=\"#k-tree\" x=\"240\" y=\"420\" width=\"14\" height=\"28\"/> <use href=\"#k-tree\" x=\"660\" y=\"470\" width=\"14\" height=\"28\"/><use href=\"#k-tree\" x=\"120\" y=\"520\" width=\"12\" height=\"24\"/> <use href=\"#k-tree\" x=\"840\" y=\"520\" width=\"14\" height=\"28\"/><use href=\"#k-tree\" x=\"380\" y=\"560\" width=\"12\" height=\"24\"/> </g> </svg>"; // static art (no response data); parsed with DOMParser
  function h(tag, attrs, kids) { return LMCSGame.ui.h(tag, attrs, kids); }
  var BASE = (document.currentScript && document.currentScript.src || '').replace(/[^/?#]*([?#].*)?$/, '');
  var S = { el: null, session: null, url: '', root: '', data: null, busy: false, layer: null };
  var LOAD_ERR = "Couldn't load the Kingdom. Check the connection, then try again.";

  function svgUse(id, cls) {
    var ns = 'http://www.w3.org/2000/svg', s = document.createElementNS(ns, 'svg'), u = document.createElementNS(ns, 'use');
    s.setAttribute('viewBox', '0 0 64 56'); s.setAttribute('class', cls); s.setAttribute('aria-hidden', 'true');
    u.setAttribute('href', '#k-' + id); s.appendChild(u);
    return s;
  }
  function valley() {
    var doc = new DOMParser().parseFromString(VALLEY, 'image/svg+xml');
    return document.importNode(doc.documentElement, true);
  }
  function buddyImg(name) { return h('img', { class: 'kg-buddy', src: BASE + 'buddy/' + name + '.webp', alt: '', decoding: 'async' }); }

  // ── layers: one dialog at a time, a bottom sheet under 640 px; focus trapped; Esc and the X close ──
  function closeLayer() {
    var L = S.layer;
    if (!L) return;
    S.layer = null;
    L.release(L.opener);
    if (L.opener && !L.opener.isConnected && S.baseId) { // the opener was inside a dialog that closed: land on the base's map button
      [].slice.call(S.el.querySelectorAll('.kg-base')).forEach(function (b) { if (b.getAttribute('data-base') === S.baseId) b.focus(); });
    }
    if (L.dlg.open) L.dlg.close();
    L.dlg.remove();
  }
  // the user's ways out (X, Esc, backdrop, Cancel): ignored while a write is in flight
  function dismiss() { if (!W.busy) closeLayer(); }
  function openLayer(title, sub, body, opener) {
    closeLayer();
    var id = 'kg-t' + Date.now(), dlg = h('dialog', { class: 'kg-dlg', 'aria-labelledby': id });
    var head = h('div', { class: 'kg-dh' }, [h('div', { class: 'kg-dt' }, [h('h2', { id: id, tabindex: '-1' }, [title]), sub ? h('p', {}, [sub]) : null]),
      h('button', { type: 'button', class: 'kg-x', 'aria-label': 'Close', onclick: dismiss }, ['×'])]);
    dlg.appendChild(head); dlg.appendChild(h('div', { class: 'kg-db' }, body));
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); dismiss(); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dismiss(); }); // the backdrop
    document.body.appendChild(dlg);
    dlg.showModal();
    S.layer = { dlg: dlg, opener: opener || document.activeElement, release: LMCSGame.ui.trap(dlg, dismiss) };
    return dlg;
  }

  function goLink(go, text, cls) {
    var href = safeGo(go, S.root);
    return href ? h('a', { class: cls || 'kg-go', href: href }, [text || 'Go']) : null;
  }

  // ── base dialog ──
  // an HQ setup step list: ✓ done, the next one marked and given its How as a button
  function stepList(steps) {
    var next = steps.filter(function (s) { return !s.done; })[0];
    return h('ol', { class: 'kg-steps' }, steps.map(function (s) {
      var how = guideGo(s), isNext = s === next;
      return h('li', { class: s.done ? 'kg-sd' : isNext ? 'kg-snext' : '' }, [
        h('span', { class: 'kg-sm', 'aria-hidden': 'true' }, [s.done ? '✓' : '']),
        h('span', { class: 'kg-stt' }, [isNext ? h('b', { class: 'kg-tag' }, ['Next']) : null, s.title, s.done ? h('span', { class: 'kg-sr' }, [' (done)']) : null]),
        how ? (isNext ? goLink(how, 'Show me how', 'kg-btn kg-primary kg-sbtn') : goLink(how, 'How')) : null]);
    }));
  }
  function tierRow(t, base, bld, isNext) {
    var extra = api.hooks.tier ? api.hooks.tier(t, base, bld) : null;
    var kids = [h('span', { class: 'kg-tt kg-s-' + t.state }, [isNext && !(t.steps && t.steps.length) ? h('b', { class: 'kg-tag' }, ['Next']) : null, tierText(t)])]; // a tier with steps marks its next step instead
    if (t.state === 'open' && !(t.steps && t.steps.length)) kids.push(goLink(t.go, isNext ? 'Open' : 'Go', isNext && !t.assignable ? 'kg-btn kg-primary kg-tbtn' : null));
    if (t.state === 'done') kids.push(goLink(t.go, 'View'));
    if (t.owner && t.owner.name) kids.push(h('span', { class: 'kg-with' }, ['With ' + t.owner.name]));
    if (t.steps && t.steps.length && t.state !== 'done') kids.push(stepList(t.steps));
    if (extra) kids.push(extra);
    return h('li', { class: 'kg-tier' + (isNext ? ' kg-tnext' : '') }, kids);
  }
  function buildingCard(b, base) {
    var st = buildingState(b), nt = nextTier(b);
    var word = st === 'built' ? 'Fully built' : nt ? (st === 'construction' ? 'Under construction' : 'Not started') + ' · next: ' + nt.label : st === 'construction' ? 'Under construction' : 'Waiting on a check';
    var pips = h('div', { class: 'kg-pips', 'aria-hidden': 'true' }, (b.tiers || []).map(function (t) { return h('i', { class: t.state === 'done' ? 'on' : t === nt ? 'nx' : '' }); }));
    return h('div', { class: 'kg-bld kg-b-' + st }, [
      h('div', { class: 'kg-bt' }, [h('b', {}, [b.name]), h('span', { class: 'kg-blv' }, ['Level ' + b.level + ' of ' + b.maxLevel])]),
      pips, h('div', { class: 'kg-st' }, [word]),
      h('ul', { class: 'kg-tiers' }, (b.tiers || []).map(function (t) { return tierRow(t, base, b, t === nt); }))]);
  }
  function openBase(id, opener) {
    var base = ((S.data && S.data.kingdom && S.data.kingdom.campuses) || []).filter(function (b) { return b.id === id; })[0];
    if (!base) return;
    S.baseId = id;
    var all = base.buildings || [], active = all.filter(function (b) { return !onlySoon(b); }), soon = all.filter(onlySoon);
    // buildings with a step to work on first, then the rest in catalogue order
    active = active.filter(function (b) { return nextTier(b); }).concat(active.filter(function (b) { return !nextTier(b); }));
    var body = [h('div', { class: 'kg-bgrid' }, active.map(function (b) { return buildingCard(b, base); }))];
    if (soon.length) body.push(h('p', { class: 'kg-quiet kg-soonline' }, ['Coming soon: ' + soon.map(function (b) { return b.name; }).join(', ') + '.']));
    if (!all.length) body = [h('p', { class: 'kg-quiet' }, ['Nothing to build here yet.'])];
    if (api.hooks.base) body.push(api.hooks.base(base));
    var dlg = openLayer(base.full || base.name, 'Level ' + (Number(base.level) || 0) + ' · ' + progressText(progressOf([base])), body, opener);
    var t = dlg.querySelector('.kg-tnext .kg-primary') || dlg.querySelector('.kg-tnext .kg-btn, .kg-tnext a') || dlg.querySelector('h2'); if (t) t.focus();
  }
  function openHead(hd, opener) {
    var ms = hd.missions || [];
    var list = ms.length ? h('ul', { class: 'kg-ml' }, ms.map(function (m) {
      return h('li', {}, [h('span', {}, [m.title || '']), m.done ? h('span', { class: 'kg-quiet' }, ['Done']) : goLink(m.go, 'Go')]);
    })) : h('p', { class: 'kg-quiet' }, ['Nothing open for ' + (hd.name || 'this head') + ' right now. Work you hand out from the tray shows up here.']);
    var dlg = openLayer(hd.name, fnLabels(hd.functions), [list], opener);
    var t = dlg.querySelector('h2'); if (t) t.focus();
  }

  // ── page ──
  function baseButton(b, nextId) {
    var u = Number(b.unknown) || 0, p = progressOf([b]);
    var bar = h('span', { class: 'kg-hp', 'aria-hidden': 'true' }, [h('i', { style: 'width:' + (p.total ? Math.round(100 * p.done / p.total) : 0) + '%' })]);
    return h('button', { type: 'button', class: 'kg-base' + (b.darbar ? ' kg-darbar' : '') + (b.id === nextId ? ' kg-isnext' : ''), style: pos(b), 'data-base': b.id,
      'aria-label': baseLabel(b) + ', ' + progressText(p) + (b.id === nextId ? ', your next step is here' : ''),
      onclick: function (e) { openBase(b.id, e.currentTarget); } }, [
      h('span', { class: 'kg-lvb', 'aria-hidden': 'true' }, [String(Number(b.level) || 0)]),
      svgUse(b.darbar ? 'darbar' : 'fort', 'kg-fort'),
      u ? h('span', { class: 'kg-pin', 'aria-hidden': 'true' }, ['?']) : null,
      h('span', { class: 'kg-plate' }, [h('span', { class: 'kg-bn' }, [b.id === nextId ? h('b', { class: 'kg-tag' }, ['Next']) : null, b.name]), bar])]);
  }
  // the same bases as a list (phones: the map is a picture to pan; this is the reliable way in)
  function baseList(bases, nextId) {
    return h('ul', { class: 'kg-blist', 'aria-label': 'Bases' }, bases.map(function (b) {
      var p = progressOf([b]), nb = (b.buildings || []).map(nextTier).filter(Boolean)[0];
      return h('li', {}, [h('button', { type: 'button', class: 'kg-brow' + (b.id === nextId ? ' kg-isnext' : ''), onclick: function (e) { openBase(b.id, e.currentTarget); } }, [
        h('span', { class: 'kg-lvb', 'aria-hidden': 'true' }, [String(Number(b.level) || 0)]),
        h('span', { class: 'kg-brt' }, [h('b', {}, [b.full || b.name]), h('small', {}, ['Level ' + (Number(b.level) || 0) + ' · ' + progressText(p) + (nb ? ' · next: ' + nb.label : '')])]),
        h('span', { class: 'kg-chev', 'aria-hidden': 'true' }, ['›'])])]);
    }));
  }
  function headButton(hd) {
    return h('button', { type: 'button', class: 'kg-head', style: '--fc:' + (/^#[0-9a-fA-F]{3,8}$/.test(hd.colour || '') ? hd.colour : 'var(--gold)'),
      onclick: function (e) { openHead(hd, e.currentTarget); } }, [
      h('span', { class: 'kg-banner', 'aria-hidden': 'true' }, [String(hd.name || '?').charAt(0)]),
      h('span', { class: 'kg-htx' }, [h('span', { class: 'kg-hn' }, [hd.name]), h('span', { class: 'kg-hf' }, [fnLabels(hd.functions)]),
        h('span', { class: 'kg-hm' + (openCount(hd) ? ' kg-hm-on' : '') }, [countText(openCount(hd))])])]);
  }
  // Buddy's card: the one next step with one button, and the Kingdom's progress bar
  function nextCard(d, a) {
    var p = progressOf((d.kingdom && d.kingdom.campuses) || []), act = null;
    if (a.kind === 'setup') act = goLink(guideGo(a.step), 'Show me how', 'kg-btn kg-primary');
    else if (a.kind === 'assign') act = h('button', { type: 'button', class: 'kg-btn kg-primary', onclick: function (e) { openAssign(a.tier, a.base, e.currentTarget); } }, ['Pick who sets it up']);
    else if (a.kind === 'follow') act = h('button', { type: 'button', class: 'kg-btn kg-primary', onclick: function (e) { openFollow(a.card, e.currentTarget); } }, ['Pick who follows up']);
    var open = a.base ? h('button', { type: 'button', class: 'kg-btn', onclick: function (e) { openBase(a.base.id, e.currentTarget); } }, ['Open ' + a.base.name]) : null;
    if (a.kind === 'wait') { act = open; open = null; if (act) act.className = 'kg-btn kg-primary'; }
    return h('section', { class: 'kg-next', 'aria-labelledby': 'kg-nexth' }, [
      buddyImg('winter-formal-neutral'),
      h('div', { class: 'kg-nextb' }, [
        h('h2', { id: 'kg-nexth', class: 'kg-who' }, [a.kind === 'done' ? 'Buddy, royal advisor' : 'Your next step']),
        h('p', { class: 'kg-nextt' }, [nextText(a)]),
        act || open ? h('div', { class: 'kg-acts' }, [act, open]) : null,
        h('div', { class: 'kg-qbar', role: 'img', 'aria-label': (d.role === 'Owner' ? 'Kingdom built: ' : 'School built: ') + progressText(p) }, [h('i', { style: 'width:' + (p.total ? Math.round(100 * p.done / p.total) : 0) + '%' })]),
        h('div', { class: 'kg-qmeta' }, [h('span', {}, [d.role === 'Owner' ? 'Kingdom built' : 'School built']), h('span', {}, [progressText(p)])])])]);
  }
  function top(d) {
    var n = ((d.kingdom && d.kingdom.campuses) || []).length;
    return h('header', { class: 'kg-top' }, [
      h('div', { class: 'kg-crest' }, [svgUse('darbar', 'kg-crest-i'), h('div', {}, [h(S.panels ? 'h2' : 'h1', {}, [d.role === 'Owner' ? "Owner's Kingdom" : 'Your school']),
        h('div', { class: 'kg-sub' }, ['Kingdom level ' + (Number(d.kingdom && d.kingdom.level) || 0) + ' · ' + n + (n === 1 ? ' base' : ' bases')])])]),
      h('div', { class: 'kg-topacts' }, [
        h('button', { type: 'button', class: 'kg-btn kg-tourbtn', onclick: function () { runTour(true); } }, ['Show me around']),
        h('button', { type: 'button', class: 'kg-btn kg-ask', onclick: function () { if (window.LMCSDock && LMCSDock.open) LMCSDock.open(); } }, [buddyImg('avatar-winter-formal'), 'Ask Buddy'])])]);
  }
  // the screen skeleton (base.css): a page that passes `panels` gets the crest, the alliance and the tray as folded panels
  // there, and one that passes `next` gets the next-step card in its fixed slot; without them the page reads top to bottom as before
  function panel(title, cls, body, open, emoji) {
    if (S.wasOpen) open = S.wasOpen.indexOf(cls) !== -1; // a re-render keeps what the person opened or closed
    else if (open && cls !== 'kg-me' && window.matchMedia && !matchMedia('(min-width: 960px)').matches) open = false; // phones: panels start folded so the map stays in view (the small Your Kingdom panel, with its tour and Ask Buddy buttons, stays open)
    var e = window.LMCSEmoji && emoji ? LMCSEmoji.tag(emoji) : null; // the shared emoji (assets/game/emoji.js) before the title
    return h('details', { class: 'gb-panel ' + cls, 'data-panel': cls, open: open ? 'open' : null }, [h('summary', {}, [e, title]), h('div', { class: 'gb-panel-b' }, [body])]);
  }
  function message(text, retry) {
    return h('div', { class: 'kg-msg', role: 'alert' }, [buddyImg('winter-formal-neutral'), h('div', {}, [h('p', {}, [text]),
      retry ? h('button', { type: 'button', class: 'kg-btn kg-primary', onclick: load }, ['Try again']) : null])]);
  }
  // level-ups since this browser's last visit: one dismissable card (stored per person; a first visit only stores)
  var LV_KEY = 'kg-levels-v1';
  function store(get, key, val) { try { if (get) return JSON.parse(localStorage.getItem(key) || 'null'); localStorage.setItem(key, JSON.stringify(val)); } catch (e) { return null; } return null; }
  function celebrate(d) {
    var key = LV_KEY + ':' + String(((S.session || {}).email) || '').toLowerCase(), bases = (d.kingdom && d.kingdom.campuses) || [];
    var prev = store(true, key), ups = levelUps(prev, bases), snap = levelSnapshot(bases);
    if (prev && typeof prev === 'object') Object.keys(snap).forEach(function (k) { var was = Number(prev[k]); if (isFinite(was) && was > snap[k]) snap[k] = was; });
    store(false, key, snap);
    if (!ups.length) return null;
    var card = h('section', { class: 'kg-cele', role: 'status' }, [buddyImg('winter-formal-neutral'), h('div', { class: 'kg-celeb' }, [
      h('h2', { class: 'kg-who' }, [ups.length === 1 ? 'Level up' : ups.length + ' level ups']),
      h('ul', {}, ups.slice(0, 4).map(function (u) { return h('li', {}, [levelUpText(u)]); })),
      h('button', { type: 'button', class: 'kg-btn', onclick: function () { card.remove(); } }, ['Got it'])])]);
    return card;
  }
  // first visit: a short spotlight tour (once per browser; "Show me around" replays it)
  var TOUR_KEY = 'kg-tour-v1';
  function runTour(force) {
    if (!(window.LMCSGame && LMCSGame.tour) || (!force && (S.toured || store(true, TOUR_KEY)))) return;
    S.toured = true; store(false, TOUR_KEY, 1);
    var beats = [
      { target: '.kg-next', text: "I'm Buddy, your royal advisor. This card always shows your one next step, and the bar shows how much of the Kingdom is built." },
      { target: '.kg-box', text: 'Each fort is a school; LMCS HQ in the middle is the society. The gold shield is its level, the bar its progress. Tap a fort to see its buildings.' },
      { target: '.kg-alliance', text: 'Your alliance heads. Tap one to see what they are working on.' },
      { target: S.panels ? '.kg-traypanel' : '.kg-tray', text: 'Approved requests wait here. Tap one, pick who follows it up, and it goes to their list.' }
    ].filter(function (b) { return document.querySelector(b.target); });
    LMCSGame.tour(beats, { campus: 'HES', speaker: 'buddy' });
  }
  function render(d) {
    closeLayer();
    S.data = d;
    var oldBox = S.el.querySelector('.kg-box'), keepX = oldBox ? oldBox.scrollLeft : null; // a re-render keeps where the map was panned to
    S.el.textContent = '';
    var bases = sortBases((d.kingdom && d.kingdom.campuses) || []), a = nextAction(d), nextId = a.base ? a.base.id : '';
    var map = h('div', { class: 'kg-map', id: 'kg-map' }, [valley(), h('div', { class: 'kg-bases' }, bases.map(function (b) { return baseButton(b, nextId); }))]);
    var box = h('div', { class: 'kg-box', tabindex: '0', role: 'region', 'aria-label': 'Kingdom map. Scroll to look around, tap a fort to open it.' }, [map,
      h('div', { class: 'kg-legend', 'aria-hidden': 'true' }, [h('span', {}, [h('i', { class: 'kg-lg-lv' }), 'Level']), h('span', {}, [h('i', { class: 'kg-lg-hp' }), 'Steps built']), h('span', {}, ['Tap a fort to open it'])])]);
    var heads = d.heads || [];
    if (S.panels) {
      if (S.panels.firstChild) S.wasOpen = [].map.call(S.panels.querySelectorAll('details[open]'), function (x) { return x.getAttribute('data-panel'); });
      S.panels.textContent = ''; S.panels.appendChild(panel('Your Kingdom', 'kg-me', top(d), true, 'base'));
    }
    else S.el.appendChild(top(d));
    if ((d.sourcesDown || []).length) S.el.appendChild(h('p', { class: 'kg-quiet kg-down', role: 'status' }, ["Some buildings couldn't be checked just now, so their steps show as “couldn't check”. Nothing is lost; try again in a few minutes."]));
    var cele = celebrate(d); if (cele) S.el.appendChild(cele);
    if (S.next) { S.next.textContent = ''; S.next.appendChild(nextCard(d, a)); } else S.el.appendChild(nextCard(d, a));
    if (bases.length) { S.el.appendChild(box); S.el.appendChild(baseList(bases, nextId)); }
    else S.el.appendChild(h('p', { class: 'kg-quiet' }, ['No schools to show yet. They appear here once the game settings list them.']));
    if (heads.length) {
      var hs = h('div', { class: 'kg-heads' }, heads.map(headButton));
      if (S.panels) S.panels.appendChild(panel('Alliance heads (' + heads.length + ')', 'kg-alliance', hs, false, 'heads'));
      else S.el.appendChild(h('section', { class: 'kg-alliance', 'aria-labelledby': 'kg-allh' }, [h('h2', { id: 'kg-allh' }, ['Alliance']), hs]));
    }
    if (api.hooks.after) api.hooks.after(d);
    gdDraw();
    // phones: start the map centred on LMCS HQ instead of its left edge
    var dar = map.querySelector('.kg-darbar');
    if (keepX !== null) box.scrollLeft = keepX;
    else if (dar && box.scrollWidth > box.clientWidth) box.scrollLeft = Math.max(0, dar.offsetLeft - box.clientWidth / 2);
    runTour(false);
  }

  function load() {
    if (S.busy) return Promise.resolve();
    S.busy = true;
    S.el.setAttribute('aria-busy', 'true');
    if (!S.data) { S.el.textContent = ''; S.el.appendChild(h('p', { class: 'kg-quiet kg-loading', role: 'status' }, ['Getting your Kingdom ready…'])); }
    if (navigator.onLine === false && !S.data) { S.busy = false; S.el.removeAttribute('aria-busy'); S.el.textContent = ''; S.el.appendChild(message("You're offline. The Kingdom needs a connection.", true)); return Promise.resolve(); }
    var url = S.url + (S.url.indexOf('?') === -1 ? '?' : '&') + 'action=gamekingdom&idToken=' + encodeURIComponent((S.session || {}).idToken || '');
    return fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.success) render(d);
      else { S.el.textContent = ''; S.el.appendChild(message((d && d.error) || LOAD_ERR, true)); }
    }, function () {
      if (S.data) return; // keep showing the last good map when a refresh fails
      S.el.textContent = ''; S.el.appendChild(message(LOAD_ERR, true));
    }).then(function () { S.busy = false; S.el.removeAttribute('aria-busy'); });
  }

  function mount(el, opts) {
    opts = opts || {};
    S.el = el; S.session = opts.session; S.url = opts.backendUrl || ''; S.root = opts.root || ''; S.data = null;
    S.panels = opts.panels || null; S.next = opts.next || null;
    if (!S.url) { el.textContent = ''; el.appendChild(message(LOAD_ERR, false)); return Promise.resolve(); }
    gdLoad();
    clearInterval(GD.timer);
    GD.timer = setInterval(function () { if (document.visibilityState === 'visible') gdLoad(); }, GD_EVERY_MS);
    return load();
  }

  // ═══ 🎉 Game Day panel (Owner only: the server refuses anyone else, and then nothing is drawn) ═══
  // Per school: in / done / %, the one nudge, and who is not in or stuck (names, in a details). Refreshes itself every 2 minutes while
  // the page is in view, and on the Refresh button. Before the day it lists who is expected (upcoming).
  var GD = { data: null, timer: null, busy: false }, GD_EVERY_MS = 120000;
  function gdLoad() {
    if (GD.busy || !S.url) return;
    GD.busy = true;
    var url = S.url + (S.url.indexOf('?') === -1 ? '?' : '&') + 'action=gameeventboard&idToken=' + encodeURIComponent((S.session || {}).idToken || '');
    fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      GD.data = d && d.success && d.event && Array.isArray(d.schools) ? d : null; gdDraw();
    }, function () { /* keep the last board */ }).then(function () { GD.busy = false; });
  }
  function gdBar(pct, label) { return h('span', { class: 'gb-bar' + (pct >= 100 ? ' gb-bar-ok' : ''), role: 'img', 'aria-label': label }, [h('i', { style: 'width:' + Math.max(0, Math.min(100, Number(pct) || 0)) + '%' })]); }
  function gdNames(label, names) {
    return names && names.length ? h('details', { class: 'kg-gd-who' }, [h('summary', {}, [label + ' (' + names.length + ')']), h('ul', {}, names.map(function (n) { return h('li', {}, [n]); }))]) : null;
  }
  function gdBody(d) {
    var ev = d.event, n = d.network || null, goal = n ? Number(n.goalPct) || 80 : 80;
    return h('div', { class: 'kg-gd' }, [
      h('p', { class: 'kg-gd-k' }, [ev.upcoming ? ev.name + ' starts ' + LMCSGame.dateLabel(ev.date) + '. These are the people expected at each school.' : ev.name + ' · live']),
      n ? h('div', { class: 'kg-gd-row' }, [h('b', {}, ['All schools']), h('span', {}, [gdNetworkText(n)])]) : null,
      n ? gdBar(n.of ? 100 * n.schoolsAtGoal / n.of : 0, 'All schools: ' + gdNetworkText(n)) : null,
      h('ul', { class: 'kg-gd-list' }, d.schools.map(function (s) {
        return h('li', { class: s.pct >= goal ? 'kg-gd-goal' : '' }, [h('b', {}, [gdSchoolLine(s)]), gdBar(s.pct, gdSchoolLine(s)),
          s.nudge ? h('p', { class: 'kg-gd-nudge' }, [s.nudge]) : null, gdNames('Not in yet', s.notIn), gdNames('Started, not finished', s.stuck)]);
      })),
      h('button', { type: 'button', class: 'gb-btn', onclick: gdLoad }, ['Refresh'])]);
  }
  function gdDraw() {
    var old = document.querySelector('[data-panel="kg-gdpanel"]');
    if (!GD.data) { if (old) old.remove(); return; }
    var p = panel('Game Day', 'kg-gdpanel', gdBody(GD.data), !GD.data.event.upcoming, 'events');
    if (old) { p.open = old.open; old.replaceWith(p); }
    else if (S.panels) S.panels.insertBefore(p, S.panels.children[1] || null); // under Your Kingdom
    else if (S.el) S.el.appendChild(p);
  }

  // ═══ K5: tap-to-assign (Owner only; the server checks the Owner again) ═══
  // One sheet at a time. Pick, then an explicit confirm button; only that button posts. While a request is in flight every control is disabled.
  var W = { busy: false };
  var SEND_ERR = "That didn't go through. Nothing was changed. Please try again.";
  function toast(text) {
    var old = document.getElementById('kg-toast'); if (old) old.remove();
    var t = h('div', { id: 'kg-toast', class: 'kg-toast', role: 'status' }, [text]);
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 6000);
  }
  function post(body) {
    return fetch(S.url, { method: 'POST', body: JSON.stringify(Object.assign({ idToken: (S.session || {}).idToken }, body)) }).then(function (r) { return r.json(); });
  }
  // sends one confirmed body. ctl = { err: node, controls: [elements], done(d) -> toast text }
  function send(body, ctl) {
    if (W.busy) return;
    W.busy = true;
    ctl.err.textContent = '';
    ctl.controls.forEach(function (c) { c.disabled = true; });
    var label = ctl.go ? ctl.go.textContent : '';
    if (ctl.go) ctl.go.textContent = 'Sending…';
    post(body).then(function (d) {
      if (!d || !d.success) { var se = new Error((d && d.error) || SEND_ERR); se.server = true; throw se; } // only the server's own sentence is shown
      var msg = ctl.done(d);
      closeLayer(); toast(msg);
      return load().then(function () {
        var h1 = S.el && S.el.querySelector('h1'); // the opener is gone after a re-render: focus the page heading
        if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus(); }
      });
    }).catch(function (e) {
      ctl.err.textContent = e && e.server ? e.message : SEND_ERR;
      ctl.controls.forEach(function (c) { c.disabled = false; });
      if (ctl.go) ctl.go.textContent = label;
    }).then(function () { W.busy = false; });
  }
  function radios(name, people, suggestEmail, legend) {
    return h('fieldset', { class: 'kg-pick' }, [h('legend', { class: 'kg-sr' }, [legend])].concat(people.map(function (p, i) {
      var id = 'kg-r-' + name + i;
      return h('label', { class: 'kg-opt', for: id }, [
        h('input', { type: 'radio', name: name, id: id, value: p.email, checked: p.email === suggestEmail ? true : null }),
        h('span', {}, [h('b', {}, [p.name || p.email]), p.name ? h('small', {}, [p.email]) : null,
          p.email === suggestEmail ? h('em', { class: 'kg-sug' }, ['Buddy suggests']) : null])]);
    })));
  }
  function picked(form, name) { var r = form.querySelector('input[name=' + name + ']:checked'); return r ? r.value : ''; }
  function sheet(title, sub, intro, fields, confirmText, onConfirm, opener) {
    var err = h('p', { class: 'kg-err', role: 'alert' }, []);
    var go = h('button', { type: 'button', class: 'kg-btn kg-primary' }, [confirmText]);
    var cancel = h('button', { type: 'button', class: 'kg-btn', onclick: dismiss }, ['Cancel']);
    var form = h('div', { class: 'kg-form' }, [intro ? h('p', {}, [intro]) : null].concat(fields, [err, h('div', { class: 'kg-acts' }, [go, cancel])]));
    go.onclick = function () { onConfirm(form, { err: err, go: go, controls: [go, cancel].concat([].slice.call(form.querySelectorAll('input,textarea'))) }); };
    var dlg = openLayer(title, sub, [form], opener);
    var f = dlg.querySelector('input[type=radio]:checked') || dlg.querySelector('input,textarea') || dlg.querySelector('h2'); if (f) f.focus();
    return dlg;
  }
  function noteField(id) {
    return h('label', { class: 'kg-fld', for: id }, ['Note (optional)', h('textarea', { id: id, rows: '2', maxlength: '300' })]);
  }
  function openAssign(tier, base, opener) {
    var people = tier.assignees || [];
    if (!people.length) return sheet('Assign ' + tier.label, base.full || base.name, "Nobody on the allowlist can take this step yet, so there is no one to pick.", [], 'Assign', function () {}, opener).querySelector('.kg-primary').remove();
    sheet('Assign ' + tier.label, base.full || base.name, 'Who should set this up? They will see it in their Today list.',
      [radios('kg-who', people, '', 'Who should set this up?'), noteField('kg-note')], 'Assign', function (form, ctl) {
        var who = picked(form, 'kg-who');
        if (!who) { ctl.err.textContent = 'Pick a person first.'; return; }
        ctl.done = function () { return "Assigned. They'll see it in their Today list."; };
        send(assignBody(tier, base.id, who, form.querySelector('textarea').value.trim()), ctl);
      }, opener);
  }
  function openClear(tier, base, opener) {
    sheet('Clear ' + tier.label, base.full || base.name, 'Take this step off ' + ((tier.owner && tier.owner.name) || 'its owner') + '? It stays open for you to hand out again.', [], 'Clear', function (form, ctl) {
      ctl.done = function () { return 'Cleared. Nobody has this step now.'; };
      send(assignBody(tier, base.id, '', '', true), ctl);
    }, opener);
  }
  function openFollow(card, opener) {
    var d = S.data || {}, heads = d.followHeads || [];
    var title = 'Follow up: ' + card.title;
    if (!heads.length) {
      var s0 = sheet(title, card.campus, "No alliance heads who are Coordinators are set up yet, so a follow-up can't be sent. Add them in the game config first.", [], 'Send', function () {}, opener);
      s0.querySelector('.kg-primary').remove(); return;
    }
    var today = d.day || '', sug = suggestHead(card, heads), days = Number(d.kingdom && d.kingdom.followupDueDays) || 7;
    var due = h('input', { type: 'date', id: 'kg-due', value: defaultDue(today, days), min: today || null, required: true });
    sheet(title, card.campus, 'Who should follow this approved request up, and by when?',
      [radios('kg-head', heads, sug ? sug.email : '', 'Who should follow this up?'), h('label', { class: 'kg-fld', for: 'kg-due' }, ['Due date', due]), noteField('kg-note')], 'Assign', function (form, ctl) {
        var who = picked(form, 'kg-head'), dv = due.value;
        if (!who) { ctl.err.textContent = 'Pick a head first.'; return; }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dv) || (today && dv < today)) { ctl.err.textContent = 'Pick a due date that is today or later.'; return; }
        var name = (heads.filter(function (x) { return x.email === who; })[0] || {}).name || 'them';
        ctl.done = function () { return 'Follow-up sent to ' + name + ', due ' + dv + '.'; };
        send(allocateBody(card, who, dv, form.querySelector('textarea').value.trim()), ctl);
      }, opener);
  }
  function owner() { return S.data && S.data.role === 'Owner'; }
  api.hooks.tier = function (tier, base) {
    if (!owner() || !tier.assignable) return null;
    var kids = [h('button', { type: 'button', class: 'kg-btn kg-act' + (tier.owner ? '' : ' kg-primary'), onclick: function (e) { openAssign(tier, base, e.currentTarget); } }, [tier.owner ? 'Reassign' : 'Pick who sets it up'])];
    if (tier.owner) kids.push(h('button', { type: 'button', class: 'kg-btn kg-act kg-clear', onclick: function (e) { openClear(tier, base, e.currentTarget); } }, ['Clear']));
    return h('div', { class: 'kg-acts-row' }, kids);
  };
  api.hooks.after = function (d) {
    if (d.role !== 'Owner') return;
    var cards = d.cards || [], heads = d.followHeads || [];
    var tray = h('section', { class: 'kg-tray', 'aria-labelledby': 'kg-trayh' }, [
      h('div', { class: 'kg-trayhd' }, [h('h2', { id: 'kg-trayh' }, ['Allocation tray']),
        h('p', { class: 'kg-quiet' }, [cards.length ? 'Approved requests waiting for a follow-up. Tap one, then pick who follows it up.' : '']) ]),
      cards.length ? h('ul', { class: 'kg-cards' }, cards.map(function (c) {
        var sug = suggestHead(c, heads);
        return h('li', {}, [h('button', { type: 'button', class: 'kg-card', 'aria-label': cardText(c) + (sug ? '. Buddy suggests ' + sug.name : ''), onclick: function (e) { openFollow(c, e.currentTarget); } }, [
          h('span', { class: 'kg-csrc' }, ['Approved request' + (c.campus ? ' · ' + c.campus : '')]), h('span', { class: 'kg-ct' }, [c.title]),
          sug ? h('span', { class: 'kg-cm' }, ['Buddy suggests ' + sug.name]) : null])]);
      })) : h('p', { class: 'kg-empty' }, ['Nothing waiting. When a request is approved and nobody is following it up, it lands here for you to hand out.'])]);
    if (S.panels) S.panels.appendChild(panel('Requests tray (' + cards.length + ')', 'kg-traypanel', tray, cards.length > 0, 'requests'));
    else S.el.appendChild(tray);
  };

  api.mount = mount; api.refresh = function () { return load(); }; api.last = function () { return S.data; };
  api.openBase = function (id) { openBase(id); }; api.close = closeLayer; api.state = S;
  if (location.hostname === 'localhost') { api._render = function (d, el) { if (el) S.el = el; render(d); }; } // browser checks with a sample response; never on the live site
  return api;
})();
