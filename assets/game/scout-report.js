// 📜 Scout report (V2 row #9): a school's Principal daily reports as a game window. Backend: apps-script/game-scout.gs (GET gamescout).
//   LMCSScout.panel(campus, { session, backendUrl, root, name }) -> a <section> that fills itself (the Kingdom's campus window)
//   LMCSScout.mount(el, { session, backendUrl, root, campus?, name? }) -> the same, into el (principal/scout.html)
// Every string from the server goes in as text (never HTML). Animation: v2-animations.css classes (a-*); they no-op until that file is loaded.
var LMCSScout = window.LMCSScout = (function () {
  var ICON = { ontime: '✅', late: '⏰', missing: '⬜', waiting: '⏳', overdue: '⌛' };
  var WORD = { ontime: 'on time', late: 'late', missing: 'missing', waiting: 'due today', overdue: 'not in yet' };
  function hm12(hm) {
    var p = String(hm || '').split(':'), h = +p[0];
    if (!p[1] || isNaN(h)) return '';
    return (h % 12 || 12) + (p[1] !== '00' ? ':' + p[1] : '') + (h < 12 ? ' am' : ' pm');
  }
  function schoolName(c) { return String(c || '').replace(/^LMS(\d)$/, 'LMS $1'); }
  function last(d) { return (d.strip || [])[(d.strip || []).length - 1] || null; }
  // the first line: how today stands
  function todayLine(d) {
    var t = last(d);
    if (!t || t.date !== d.today) return 'No school today. Rest well.';
    if (t.state === 'ontime') return 'Today: ✅ in at ' + hm12(t.at);
    if (t.state === 'late') return 'Today: ⏰ in at ' + hm12(t.at) + ', after ' + hm12(d.dueBy);
    if (t.state === 'waiting') return "Today: ⏳ due by " + hm12(d.dueBy);
    return "Today: ⌛ not in yet (due " + hm12(d.dueBy) + ')';
  }
  function streakLine(d) {
    var s = d.streak || {};
    if (s.lost) return '🧊 Streak lost after ' + s.lostAfter + ' days. Start again today.';
    if (!s.days) return '🔥 No streak yet. One on-time report starts it.';
    return '🔥 Streak ' + s.days + (s.capped ? '+' : '') + (s.days === 1 ? ' day' : ' days');
  }
  // Buddy's short scout line, in his voice
  function buddyLine(d) {
    var s = d.streak || {}, t = d.tally || {}, judged = d.judged || 0;
    if (!judged) return 'Scout here. No reports to read yet. The first one starts the story.';
    if (s.lost) return 'Scout here. The streak slipped. One report by ' + hm12(d.dueBy) + ' today and we march again.';
    if (t.ontime === judged) return 'Scout here. Every report on time this week. Shabash!';
    if (t.missing) return 'Scout here. ' + t.missing + (t.missing === 1 ? ' report went' : ' reports went') + ' missing. Let’s close the gaps.';
    return 'Scout here. ' + t.ontime + ' of ' + judged + ' reports on time this week.';
  }
  // the Nudge: a WhatsApp line to copy; nothing is sent
  function nudgeText(d, name) {
    var t = last(d), s = d.streak || {}, who = name || schoolName(d.campus);
    var bits = [];
    if (t && t.date === d.today && t.state === 'overdue') bits.push("today's daily report is not in yet (due " + hm12(d.dueBy) + ')');
    if ((d.tally || {}).missing) bits.push(d.tally.missing + ' missing this week');
    if ((d.tally || {}).late) bits.push(d.tally.late + ' filed late');
    (d.openIssues || []).slice(0, 1).forEach(function (o) { bits.push('"' + o.subject + '" open ' + o.days + ' days'); });
    if (!bits.length) return 'Shabash ' + who + '! Daily reports all on time' + (s.days ? ', ' + s.days + '-day streak 🔥' : '') + '. Keep it going.';
    return who + ': ' + bits.join('; ') + '. Please take a look 🙏';
  }
  // Buddy's face for the line above (winter uniform art, assets/game/buddy/)
  function buddyMood(d) {
    var s = d.streak || {}, t = d.tally || {};
    if (!d.judged) return 'neutral';
    if (s.lost || t.missing) return 'nudge';
    return t.ontime === d.judged ? 'celebrate' : 'neutral';
  }
  function dayLabel(s) { return s.label + ', ' + WORD[s.state] + (s.at ? ' at ' + hm12(s.at) : ''); }
  var api = { hm12: hm12, todayLine: todayLine, streakLine: streakLine, buddyLine: buddyLine, buddyMood: buddyMood, nudgeText: nudgeText, dayLabel: dayLabel, ICON: ICON };
  if (typeof document === 'undefined') return api; // tests: helpers only

  var BASE = (document.currentScript && document.currentScript.src || '').replace(/[^/?#]*([?#].*)?$/, '');
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k.indexOf('on') === 0 && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    });
    (kids || []).forEach(function (c) { if (c !== null && c !== undefined) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function rise(el, i) { el.classList.add('a-report-card-rise'); el.style.animationDelay = (i * 60) + 'ms'; return el; }
  function safeGo(go, root) { return /^[\w\/.-]+(\.html)?([#?][\w=&.-]*)?$/.test(String(go || '')) && go.indexOf('..') === -1 ? (root || '') + go : ''; }

  function load(opts) {
    var url = opts.backendUrl;
    var q = url + (url.indexOf('?') === -1 ? '?' : '&') + 'action=gamescout&idToken=' + encodeURIComponent((opts.session || {}).idToken || '') + (opts.campus ? '&campus=' + encodeURIComponent(opts.campus) : '');
    var tries = 0;
    function go() {
      return fetch(q, { cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (t) {
        try { return JSON.parse(t); } catch (e) { if (++tries < 3) return new Promise(function (ok) { setTimeout(ok, 1500 * tries); }).then(go); throw new Error("The server is waking up. Wait a minute and try again."); }
      }, function () { throw new Error('Could not reach the server. Check the connection and try again.'); });
    }
    return go();
  }

  function render(el, d, opts) {
    el.textContent = '';
    el.removeAttribute('aria-busy');
    var reader = h('div', { class: 'sc-read', hidden: true, tabindex: '-1' }, []);
    var picked = null;
    function showDay(s, btn) {
      var r = (d.reports || {})[s.date];
      reader.textContent = '';
      reader.hidden = false;
      [].forEach.call(el.querySelectorAll('.sc-day'), function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
      picked = s.date;
      reader.appendChild(h('h4', {}, [dayLabel(s)]));
      if (!r) { reader.appendChild(h('p', { class: 'sc-quiet' }, [s.state === 'missing' ? 'No report was filed this day.' : 'Not filed yet.'])); return; }
      [['Morning assembly', (r.maClass ? r.maClass : '') + (r.maScore ? ' · score ' + r.maScore : '')], ['Done today', r.done], ['Plan for tomorrow', r.tomorrow],
        ['Registers checked', r.registers], ['Important message', r.message]].forEach(function (f) {
        if (String(f[1] || '').trim()) reader.appendChild(h('div', { class: 'sc-field' }, [h('b', {}, [f[0]]), h('p', {}, [String(f[1])])]));
      });
      reader.focus();
    }
    var strip = d.strip || [];
    var dayBtns = strip.map(function (s) {
      var b = h('button', { type: 'button', class: 'sc-day sc-' + s.state + ' a-button-press', 'aria-pressed': 'false', 'aria-label': dayLabel(s) }, [
        h('span', { class: 'sc-di', 'aria-hidden': 'true' }, [ICON[s.state]]), h('span', { class: 'sc-dl', 'aria-hidden': 'true' }, [s.label])]);
      b.addEventListener('click', function () { if (picked === s.date) { reader.hidden = true; picked = null; b.setAttribute('aria-pressed', 'false'); } else showDay(s, b); });
      return b;
    });
    var blocks = [];
    blocks.push(h('p', { class: 'sc-buddy a-buddy-speak-bubble' }, [h('img', { class: 'sc-bi', src: BASE + 'buddy/winter-formal-' + buddyMood(d) + '.webp', alt: '', width: '44', height: '44', decoding: 'async' }, []), buddyLine(d)]));
    blocks.push(h('div', { class: 'sc-top' }, [h('p', { class: 'sc-today' }, [todayLine(d)]),
      h('p', { class: 'sc-streak a-reward-count-pop' + (d.streak && d.streak.lost ? ' sc-lost' : '') }, [streakLine(d)])]));
    blocks.push(h('div', { class: 'sc-stripw' }, [
      h('div', { class: 'sc-strip', role: 'group', 'aria-label': 'Last ' + strip.length + ' school days. Tap a day to read its report.' }, dayBtns),
      h('p', { class: 'sc-legend', 'aria-hidden': 'true' }, ['✅ on time · ⏰ after ' + hm12(d.dueBy) + ' · ⬜ missing · tap a day to read it']), reader]));
    var ins = d.insights || [];
    blocks.push(h('section', { class: 'sc-sec', 'aria-label': 'This week' }, [h('h3', {}, ['⚔️ This week']),
      ins.length ? h('ul', { class: 'sc-ins' }, ins.map(function (x) { return h('li', {}, [h('span', { 'aria-hidden': 'true' }, [x.icon]), ' ' + x.text]); }))
        : h('p', { class: 'sc-quiet' }, ['Quiet week. Nothing stands out.'])]));
    blocks.push(h('section', { class: 'sc-sec', 'aria-label': 'Compliance' }, [h('h3', {}, ['🛡️ Compliance']),
      h('ul', { class: 'sc-bars' }, (d.bars || []).map(function (b) {
        var set = b.pct !== null && b.pct !== undefined;
        return h('li', { class: 'sc-bar' + (set ? '' : ' sc-unset') }, [
          h('span', { class: 'sc-bl' }, [b.label]),
          h('span', { class: 'sc-track', role: set ? 'meter' : null, 'aria-valuemin': set ? '0' : null, 'aria-valuemax': set ? '100' : null, 'aria-valuenow': set ? String(b.pct) : null, 'aria-label': b.label }, [
            set ? h('i', { class: 'a-report-bar-grow sc-fill' + (b.pct >= 80 ? ' sc-good' : b.pct >= 50 ? ' sc-mid' : ' sc-low'), style: 'width:' + b.pct + '%' }, []) : null]),
          h('span', { class: 'sc-bn' }, [set ? b.pct + '%' : '—']), h('small', {}, [b.note || ''])]);
      })),
      h('p', { class: 'sc-quiet' }, ['CW/HW by ' + hm12(d.cwhwDueBy) + ': counted once CW/HW comes back from the ERP.'])]));
    if (d.rank && d.board) {
      blocks.push(h('section', { class: 'sc-sec', 'aria-label': 'Rank' }, [h('h3', {}, ['🏆 Rank ' + d.rank.pos + ' of ' + d.rank.of]),
        h('details', { class: 'sc-board' }, [h('summary', {}, ['All schools this week']), h('ol', {}, d.board.map(function (b) {
          return h('li', { class: b.campus === d.campus ? 'sc-me' : null }, [h('span', {}, [schoolName(b.campus)]), h('span', {}, [b.score + ' pts' + (b.streak ? ' · 🔥' + b.streak : '')])]);
        }))]),
        h('p', { class: 'sc-quiet' }, ['Points = share on time × compliance. Only you and the Coordinators see the rank.'])]));
    }
    var status = h('p', { class: 'sc-status', role: 'status' }, []);
    var acts = [];
    var li = -1;
    strip.forEach(function (s, i) { if ((d.reports || {})[s.date]) li = i; }); // the newest day with a report
    if (li !== -1) acts.push(h('button', { type: 'button', class: 'sc-btn sc-primary a-button-press', onclick: function () { showDay(strip[li], dayBtns[li]); } }, [strip[li].date === d.today ? "Read today's report" : 'Read ' + strip[li].label + "'s report"]));
    var ig = safeGo(d.issuesGo, opts.root);
    if (ig) acts.push(h('a', { class: 'sc-btn a-button-press', href: ig }, ['Open issues' + ((d.openIssues || []).length ? ' (' + d.openIssues.length + ' waiting long)' : '')]));
    if (d.role === 'Owner' || d.role === 'Coordinator') acts.push(h('button', { type: 'button', class: 'sc-btn a-button-press', onclick: function () {
      var text = nudgeText(d, opts.name);
      var done = function () { status.textContent = 'Nudge copied. Paste it into WhatsApp.'; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { status.textContent = text; });
      else status.textContent = text;
    } }, ['Nudge']));
    blocks.push(h('div', { class: 'sc-acts' }, acts));
    blocks.push(status);
    blocks.forEach(function (b, i) { el.appendChild(rise(b, i)); });
  }

  function fill(el, opts) {
    el.setAttribute('aria-busy', 'true');
    el.textContent = '';
    el.appendChild(h('p', { class: 'sc-quiet' }, ['📜 Scout is reading the reports…']));
    if (!opts.backendUrl) { el.textContent = ''; el.appendChild(h('p', { class: 'sc-quiet' }, ['Scout report is not connected here yet.'])); return Promise.resolve(); }
    return load(opts).then(function (d) {
      if (!d || !d.success) throw new Error(d && d.error === 'Not authorized' ? 'Your sign-in has expired or does not cover this school. Sign in again at the top.' : (d && d.error) || 'Something went wrong.');
      render(el, d, opts);
    }).catch(function (e) {
      el.removeAttribute('aria-busy');
      el.textContent = '';
      el.appendChild(h('div', { class: 'sc-err', role: 'alert' }, [h('p', {}, [e.message]),
        h('button', { type: 'button', class: 'sc-btn', onclick: function () { fill(el, opts); } }, ['Try again'])]));
    });
  }
  function shell(opts) {
    var title = h('h3', { class: 'sc-title' }, ['📜 Scout report']);
    var body = h('div', { class: 'sc-body' }, []);
    var sec = h('section', { class: 'sc', 'aria-label': 'Scout report' + (opts.campus ? ' for ' + schoolName(opts.campus) : '') }, [title, body]);
    fill(body, opts);
    return sec;
  }
  api.panel = function (campus, opts) { return shell(Object.assign({}, opts || {}, { campus: campus })); };
  api.mount = function (el, opts) { el.textContent = ''; el.appendChild(shell(opts || {})); };
  return api;
})();
