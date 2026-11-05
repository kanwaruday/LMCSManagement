/* Owner quest "Design the event quests" (owner/event-design.html). Uday reviews the Events Director's proposals
   (data/event-proposals.json, generated from the vault) and approves, edits, discusses or declines each one.
   Decisions live server-side (game-event-design.gs: GET eventdesign, POST eventdesigndecide; Owner only there too).
   Discuss reuses Jarvis (POST buddyask), so the note reaches the Events Director through the master agent as Uday's words.
   Nothing here writes to a calendar: an approved calendar change is listed under "Add to the calendars" with Copy,
   and Uday ticks it once he has added it himself. The card look is copied from the Kingdom's "Reviews to vet". Classes: ed-. */
(function (global) {
  'use strict';
  var PLACE = { LMS1: 'LMS 1', LMS2: 'LMS 2', LMS3: 'LMS 3', LMS4: 'LMS 4', LMS5: 'LMS 5', LMS6: 'LMS 6' };
  var GROUPS = [['calendar', 'Calendar changes', 'Dates for the school calendars. Approving one gives you the exact entry to add.'],
    ['chain', 'Event chains', 'The quest chain each new event runs: who does what, and by when.'],
    ['design', 'Designs', 'The two big quest designs every event uses.']];
  var WORDS = { sop: 'SOP', inCharge: 'In-charge', pnl: 'P&L', chainId: 'Chain' }; // keys camelCase would spell wrong
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var SEND_ERR = "That didn't go through. Nothing was changed. Try again.";

  // ── pure helpers (tested in tests/game/test-event-design.js) ──
  function isIso(s) { return /^\d{4}-\d\d-\d\d$/.test(String(s || '')); }
  // '2027-02-08' -> 'Mon 8 Feb 2027'; anything else comes back as it is
  function fmtDate(s) {
    if (!isIso(s)) return String(s == null ? '' : s);
    var d = new Date(s + 'T00:00:00Z');
    return isNaN(d) ? String(s) : DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }
  // 'a..b' ranges, single dates, offsets ('-7') and null
  function fmtWhen(w) {
    if (w === null || w === undefined || w === '') return 'No date yet';
    var s = String(w), r = s.split('..');
    if (r.length === 2 && isIso(r[0]) && isIso(r[1])) return fmtDate(r[0]) + ' to ' + fmtDate(r[1]);
    if (/^[+-]\d+$/.test(s)) return (s.charAt(0) === '-' ? s.slice(1) + ' days before' : s.slice(1) + ' days after');
    return fmtDate(s);
  }
  // 'mockDrill1' -> 'Mock drill 1', 'LMS2' -> 'LMS 2'
  function label(k) {
    k = String(k);
    if (PLACE[k]) return PLACE[k];
    if (WORDS[k]) return WORDS[k];
    var s = k.replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  // a payload value as one line: nested objects ({LMS2: '2027-03-16'}) become 'LMS 2 Tue 16 Mar 2027 · ...'
  function valueText(v) {
    if (v === null || v === undefined) return '';
    if (Array.isArray(v)) return v.map(valueText).join(', ');
    if (typeof v === 'object') return Object.keys(v).map(function (k) { return label(k) + ' ' + valueText(v[k]); }).join(' · ');
    if (typeof v === 'number') return v < 0 ? (-v) + ' days before' : v + ' days';
    return fmtWhen(v);
  }
  function schoolsText(list) {
    list = Array.isArray(list) ? list : [];
    return list.length === 6 ? 'All six schools' : list.map(function (c) { return PLACE[c] || c; }).join(', ');
  }
  // the item as Uday sees it now: the export plus his saved edits and the server state
  function view(item, st) {
    st = st || { status: 'proposed', edit: {}, note: '', added: false };
    var e = st.edit || {}, p = item.payload && typeof item.payload === 'object' ? item.payload : {};
    var v = { id: item.id, group: item.group, title: e.title || item.title, summary: e.summary || item.summary || '', schools: item.schools || [],
      when: item.when, source: item.source || '', payload: p, questions: Array.isArray(item.openQuestions) ? item.openQuestions : [],
      status: st.status || 'proposed', note: st.note || '', added: !!st.added, edited: !!(e.title || e.summary || e.to) };
    if (item.group === 'calendar') {
      v.calendar = p.calendar || ''; v.action = p.action === 'move' ? 'move' : 'add';
      v.eventTitle = e.title || p.eventTitle || item.title; v.to = e.to || p.to || ''; v.from = p.from || '';
    }
    return v;
  }
  function decided(v) { return v.status === 'approved' || v.status === 'declined'; }
  // the exact entry for the calendar, the words he copies
  function calLine(v) {
    if (v.action === 'move') return 'Move "' + v.eventTitle + '" on ' + v.calendar + (v.from ? ' from ' + fmtWhen(v.from) : '') + (v.to ? (isIso(v.to) ? ' to ' + fmtDate(v.to) : ': ' + v.to) : '');
    return 'Add "' + v.eventTitle + '" to ' + v.calendar + ' on ' + fmtWhen(v.to);
  }
  function discussText(v, note) {
    return "Uday's note on event proposal " + v.id + ' (' + v.title + '), for the Events Director: ' + note;
  }
  function counts(views) {
    var n = views.filter(decided).length;
    return { decided: n, total: views.length, left: views.length - n };
  }

  // ── the screen ──
  function mount(el, opts) {
    var ui = global.LMCSGame.ui, h = ui.h;
    var S = { el: el, url: opts.backendUrl, session: opts.session, root: opts.root || '../', items: [], dec: {}, open: {}, busy: false };
    var status = h('p', { class: 'ed-status', role: 'status', 'aria-live': 'polite' }, []);

    function get(action) {
      var u = S.url + (S.url.indexOf('?') === -1 ? '?' : '&') + 'action=' + action + '&idToken=' + encodeURIComponent((S.session || {}).idToken || '');
      return fetch(u).then(function (r) { return r.json(); });
    }
    function post(body) {
      return fetch(S.url, { method: 'POST', body: JSON.stringify(Object.assign({ idToken: (S.session || {}).idToken }, body)) }).then(function (r) { return r.json(); });
    }
    function say(t) { status.textContent = ''; setTimeout(function () { status.textContent = t; }, 30); }
    function views() { return S.items.map(function (it) { return view(it, S.dec[it.id]); }); }

    function load() {
      el.textContent = '';
      el.appendChild(h('p', { class: 'gb-muted' }, ['Loading the proposals…']));
      Promise.all([
        fetch(S.root + 'data/event-proposals.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('file'); return r.json(); }),
        get('eventdesign'),
      ]).then(function (res) {
        var file = res[0], d = res[1];
        if (!d || !d.success) { fail((d && d.error) || "Your decisions couldn't be loaded. Reload the page to try again."); return; }
        S.items = (file && Array.isArray(file.items) ? file.items : []).filter(function (it) { return it && it.id && GROUPS.some(function (g) { return g[0] === it.group; }); });
        S.dec = d.decisions || {};
        S.generatedAt = file.generatedAt || '';
        render();
        if (location.hash) { var t = document.getElementById(location.hash.slice(1)); if (t) t.scrollIntoView(); }
      }).catch(function () { fail("The proposals couldn't be loaded. Check your connection and reload the page."); });
    }
    function fail(msg) {
      el.textContent = '';
      el.appendChild(h('p', { class: 'gb-err', role: 'alert' }, [msg]));
      el.appendChild(h('button', { type: 'button', class: 'gb-btn', onclick: load }, ['Try again']));
    }

    function render() {
      var vs = views(), c = counts(vs), pct = c.total ? Math.round(100 * c.decided / c.total) : 0;
      el.textContent = '';
      el.appendChild(h('p', { class: 'ed-lead' }, ["The Events Director's proposals for the school events. Nothing goes on a school calendar until you approve it, and then you add it yourself."]));
      el.appendChild(h('div', { class: 'ed-prog' }, [
        h('p', {}, [h('b', {}, [c.decided + ' of ' + c.total]), ' decided', c.left ? '' : ' — quest complete']),
        h('span', { class: 'gb-bar' + (c.left ? '' : ' gb-bar-ok'), role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(c.total), 'aria-valuenow': String(c.decided), 'aria-label': 'Proposals decided' }, [h('i', { style: 'width:' + pct + '%' }, [])]),
        S.generatedAt ? h('p', { class: 'gb-muted' }, ['Proposals as of ' + fmtDate(S.generatedAt) + '.']) : null]));
      el.appendChild(status);
      var toAdd = vs.filter(function (v) { return v.group === 'calendar' && v.status === 'approved' && !v.added; });
      if (toAdd.length) el.appendChild(h('section', { class: 'ed-sec ed-toadd', id: 'to-add', 'aria-labelledby': 'ed-h-add' }, [
        h('h2', { id: 'ed-h-add' }, ['Add to the calendars (' + toAdd.length + ')']),
        h('p', { class: 'gb-muted' }, ['You approved these. Add each one in Google Calendar, then tick it here.']),
        h('ul', { class: 'ed-list' }, toAdd.map(addCard))]));
      GROUPS.forEach(function (g) {
        var mine = vs.filter(function (v) { return v.group === g[0]; });
        if (!mine.length) return;
        var open = mine.filter(function (v) { return !decided(v); }), done = mine.filter(decided);
        el.appendChild(h('section', { class: 'ed-sec', id: g[0], 'aria-labelledby': 'ed-h-' + g[0] }, [
          h('h2', { id: 'ed-h-' + g[0] }, [g[1] + ' ', h('span', { class: 'ed-count' }, [done.length + ' of ' + mine.length + ' decided'])]),
          h('p', { class: 'gb-muted' }, [g[2]]),
          open.length ? h('ul', { class: 'ed-list' }, open.map(card)) : h('p', { class: 'gb-empty' }, ['All decided.']),
          done.length ? h('details', { class: 'ed-done' }, [h('summary', {}, ['Decided (' + done.length + ')']), h('ul', { class: 'ed-list' }, done.map(doneCard))]) : null]));
      });
    }

    function meta(v) { return [v.id, schoolsText(v.schools), fmtWhen(v.when)].filter(Boolean).join(' · '); }
    function pill(v) {
      if (v.status === 'discussing') return h('span', { class: 'gb-pill gb-pill-warn' }, ['Discussing']);
      if (v.status === 'edited') return h('span', { class: 'gb-pill gb-pill-info' }, ['Edited']);
      if (v.status === 'approved') return h('span', { class: 'gb-pill gb-pill-ok' }, [v.group === 'calendar' ? (v.added ? 'Approved · on the calendar' : 'Approved · to add') : 'Approved']);
      if (v.status === 'declined') return h('span', { class: 'gb-pill gb-pill-low' }, ['Declined']);
      return null;
    }
    function details(v) {
      var rows = [];
      if (v.group === 'calendar') {
        rows = [['Calendar', v.calendar], ['Event', v.eventTitle], v.from ? ['From', fmtWhen(v.from)] : null, ['To', isIso(v.to) ? fmtDate(v.to) : fmtWhen(v.to)]].filter(Boolean);
        return h('dl', { class: 'ed-dl' }, rows.map(function (r) { return [h('dt', {}, [r[0]]), h('dd', {}, [r[1]])]; }));
      }
      var p = v.payload, pairs = [];
      Object.keys(p).forEach(function (k) {
        if (k === 'blueprint') return;
        if (p[k] && typeof p[k] === 'object' && !Array.isArray(p[k])) Object.keys(p[k]).forEach(function (j) { pairs.push([label(j), valueText(p[k][j])]); });
        else pairs.push([label(k), valueText(p[k])]);
      });
      if (!pairs.length) return null;
      return h('details', { class: 'ed-more' }, [h('summary', {}, [v.group === 'chain' ? 'Step dates' : 'Details']),
        h('dl', { class: 'ed-dl' }, pairs.map(function (r) { return [h('dt', {}, [r[0]]), h('dd', {}, [r[1]])]; }))]);
    }
    function sourceLine(v) {
      return v.source ? h('p', { class: 'ed-src' }, ['Full detail in the vault: ', h('span', {}, [v.source.replace('#', ' › ')])]) : null;
    }

    // one write. ctl = { err, controls, go, label }; then -> the toast text
    function send(id, body, ctl, then) {
      if (S.busy) return;
      S.busy = true; ctl.err.textContent = '';
      ctl.controls.forEach(function (x) { x.disabled = true; });
      var was = ctl.go.textContent; ctl.go.textContent = 'Saving…';
      var pre = body.discuss ? post({ action: 'buddyask', text: body.discuss, context: { page: 'owner/event-design.html' } }) : Promise.resolve({ success: true });
      delete body.discuss;
      pre.then(function (b) {
        if (!b || !b.success) { var be = new Error((b && b.error) ? 'Jarvis could not take the note: ' + b.error : SEND_ERR); be.server = true; throw be; }
        return post(Object.assign({ action: 'eventdesigndecide', id: id }, body));
      }).then(function (d) {
        if (!d || !d.success) { var se = new Error((d && d.error) || SEND_ERR); se.server = true; throw se; }
        S.dec[id] = d.state; S.open = {}; S.busy = false;
        var c = counts(views()), g = S.items.filter(function (it) { return it.id === id; })[0];
        render();
        var f = document.getElementById('ed-t-' + id) || document.getElementById('ed-h-' + (g ? g.group : 'calendar')); // a decided card moved to "Decided"
        if (f) { f.setAttribute('tabindex', '-1'); f.focus(); }
        say(then(d) + ' ' + c.decided + ' of ' + c.total + ' decided.');
      }).catch(function (e) {
        S.busy = false;
        ctl.err.textContent = e && e.server ? e.message : SEND_ERR;
        ctl.controls.forEach(function (x) { x.disabled = false; });
        ctl.go.textContent = was;
      });
    }

    function card(v) {
      var err = h('p', { class: 'gb-err ed-err', role: 'alert' }, []), panel = h('div', { class: 'ed-panel' }, []);
      var ok = h('button', { type: 'button', class: 'gb-btn gb-btn-primary' }, ['Approve']);
      var ed = h('button', { type: 'button', class: 'gb-btn', 'aria-expanded': 'false' }, ['Edit']);
      var di = h('button', { type: 'button', class: 'gb-btn', 'aria-expanded': 'false' }, ['Discuss']);
      var no = h('button', { type: 'button', class: 'gb-btn', 'aria-expanded': 'false' }, ['Decline']);
      var acts = [ok, ed, di, no];
      function show(which, build) {
        var same = S.open[v.id] === which;
        S.open = {}; panel.textContent = ''; err.textContent = '';
        [ed, di, no].forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
        if (same) return;
        S.open[v.id] = which;
        build();
      }
      function field(id, text, input, hint) { return h('div', { class: 'gb-field' }, [h('label', { for: id }, [text]), hint ? h('p', { class: 'gb-hint' }, [hint]) : null, input]); }
      function row(go) { return h('div', { class: 'ed-acts' }, [go, h('button', { type: 'button', class: 'gb-btn gb-btn-quiet', onclick: function () { show(S.open[v.id], function () {}); } }, ['Cancel'])]); }
      ok.addEventListener('click', function () {
        show('approve', function () {
          var go = h('button', { type: 'button', class: 'gb-btn gb-btn-primary' }, ['Yes, approve']);
          var what = v.group === 'calendar' ? 'You then add it yourself: ' + calLine(v) + '. Nothing is written to a calendar for you.'
            : v.group === 'chain' ? 'Its quest chain is marked ready, and the Events Director sets it up for the schools.'
            : 'The design is marked approved, and the Events Director builds from it.';
          panel.appendChild(h('p', {}, [h('b', {}, ['Approve ' + v.id + '? ']), what]));
          panel.appendChild(row(go));
          go.addEventListener('click', function () { send(v.id, { decision: 'approved' }, { err: err, controls: acts.concat(go), go: go }, function () { return v.id + ' approved.'; }); });
          go.focus();
        });
      });
      ed.addEventListener('click', function () {
        show('edit', function () {
          ed.setAttribute('aria-expanded', 'true');
          var t = h('input', { id: 'ed-et-' + v.id, class: 'gb-input', type: 'text', maxlength: '120', value: v.group === 'calendar' ? v.eventTitle : v.title });
          var dt = v.group === 'calendar' && v.action === 'add' ? h('input', { id: 'ed-ed-' + v.id, class: 'gb-input', type: 'date', value: isIso(v.to) ? v.to : '' }) : null;
          var tx = h('textarea', { id: 'ed-ex-' + v.id, class: 'gb-input ed-text', rows: '4', maxlength: '600' }, []); tx.value = v.summary;
          var go = h('button', { type: 'button', class: 'gb-btn gb-btn-primary' }, ['Save the edit']);
          panel.appendChild(field(t.id, v.group === 'calendar' ? 'Event title (as it goes on the calendar)' : 'Title', t));
          if (dt) panel.appendChild(field(dt.id, 'Date', dt));
          panel.appendChild(field(tx.id, 'What it says', tx));
          panel.appendChild(h('p', { class: 'gb-muted' }, ['Saving keeps it open for your approval and logs it as edited.']));
          panel.appendChild(row(go));
          go.addEventListener('click', function () {
            var e = {}, title0 = v.group === 'calendar' ? v.eventTitle : v.title;
            if (t.value.trim() && t.value.trim() !== title0) e.title = t.value.trim();
            if (dt && dt.value && dt.value !== v.to) e.to = dt.value;
            if (tx.value.trim() && tx.value.trim() !== v.summary) e.summary = tx.value.trim();
            if (!Object.keys(e).length) { err.textContent = 'Nothing has changed yet.'; return; }
            send(v.id, { decision: 'edited', edit: e }, { err: err, controls: acts.concat(go, t, tx, dt || go), go: go }, function () { return v.id + ' edited. Approve it when it reads right.'; });
          });
          t.focus();
        });
      });
      di.addEventListener('click', function () {
        show('discuss', function () {
          di.setAttribute('aria-expanded', 'true');
          var tx = h('textarea', { id: 'ed-dn-' + v.id, class: 'gb-input ed-text', rows: '4', maxlength: '1000' }, []);
          var go = h('button', { type: 'button', class: 'gb-btn gb-btn-primary' }, ['Send to the Events Director']);
          panel.appendChild(field(tx.id, 'Your note for the Events Director', tx, 'It goes through Jarvis as your words. The proposal stays open until you approve or decline it.'));
          panel.appendChild(row(go));
          go.addEventListener('click', function () {
            var n = tx.value.trim();
            if (!n) { err.textContent = 'Type your note first.'; tx.focus(); return; }
            send(v.id, { decision: 'discussing', note: n, discuss: discussText(v, n) }, { err: err, controls: acts.concat(go, tx), go: go }, function () { return 'Note on ' + v.id + ' sent to the Events Director.'; });
          });
          tx.focus();
        });
      });
      no.addEventListener('click', function () {
        show('decline', function () {
          no.setAttribute('aria-expanded', 'true');
          var tx = h('textarea', { id: 'ed-dr-' + v.id, class: 'gb-input ed-text', rows: '3', maxlength: '1000' }, []);
          var go = h('button', { type: 'button', class: 'gb-btn gb-btn-danger' }, ['Decline ' + v.id]);
          panel.appendChild(field(tx.id, 'Why are you declining it?', tx));
          panel.appendChild(row(go));
          go.addEventListener('click', function () {
            var n = tx.value.trim();
            if (!n) { err.textContent = 'Say why you are declining it.'; tx.focus(); return; }
            send(v.id, { decision: 'declined', note: n }, { err: err, controls: acts.concat(go, tx), go: go }, function () { return v.id + ' declined.'; });
          });
          tx.focus();
        });
      });
      return h('li', { class: 'ed-card', id: 'ed-c-' + v.id }, [
        h('div', { class: 'ed-top' }, [h('h3', { id: 'ed-t-' + v.id }, [v.title]), pill(v)]),
        h('p', { class: 'gb-muted' }, [meta(v)]),
        h('p', {}, [v.summary]),
        details(v),
        v.questions.length ? h('div', { class: 'ed-q' }, [h('p', {}, [h('b', {}, ['To settle'])]), h('ul', {}, v.questions.map(function (q) { return h('li', {}, [q]); }))]) : null,
        v.status === 'discussing' && v.note ? h('p', { class: 'ed-note' }, ['Your note: ' + v.note]) : null,
        sourceLine(v),
        h('div', { class: 'ed-acts' }, acts), err, panel]);
    }

    function doneCard(v) {
      var err = h('p', { class: 'gb-err ed-err', role: 'alert' }, []);
      var re = h('button', { type: 'button', class: 'gb-btn gb-btn-quiet' }, ['Reopen']);
      re.addEventListener('click', function () { send(v.id, { decision: 'reopened' }, { err: err, controls: [re], go: re }, function () { return v.id + ' is open again.'; }); });
      return h('li', { class: 'ed-card ed-card-done' }, [
        h('div', { class: 'ed-top' }, [h('h3', {}, [v.title]), pill(v)]),
        h('p', { class: 'gb-muted' }, [meta(v)]),
        v.status === 'declined' && v.note ? h('p', {}, ['Why: ' + v.note]) : null,
        v.group === 'calendar' && v.status === 'approved' ? h('p', {}, [calLine(v)]) : null,
        h('div', { class: 'ed-acts' }, [re]), err]);
    }

    function addCard(v) {
      var line = calLine(v), err = h('p', { class: 'gb-err ed-err', role: 'alert' }, []);
      var cp = h('button', { type: 'button', class: 'gb-btn' }, ['Copy the title']);
      var ok = h('button', { type: 'button', class: 'gb-btn gb-btn-primary' }, ["I've added it"]);
      cp.addEventListener('click', function () {
        var done = function () { say('Copied the event title: ' + v.eventTitle); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(v.eventTitle).then(done, function () { err.textContent = 'Copy did not work here. Select the text instead.'; });
        else err.textContent = 'Copy did not work here. Select the text instead.';
      });
      ok.addEventListener('click', function () { send(v.id, { decision: 'added' }, { err: err, controls: [cp, ok], go: ok }, function () { return v.id + ' is on the calendar.'; }); });
      return h('li', { class: 'ed-card ed-card-add' }, [
        h('p', { class: 'gb-muted' }, [v.id + ' · ' + schoolsText(v.schools)]),
        h('p', { class: 'ed-line' }, [line]),
        h('div', { class: 'ed-acts' }, [cp, ok]), err]);
    }

    load();
  }

  global.LMCSEventDesign = { mount: mount, fmtDate: fmtDate, fmtWhen: fmtWhen, label: label, valueText: valueText, schoolsText: schoolsText,
    view: view, decided: decided, calLine: calLine, discussText: discussText, counts: counts };
})(typeof window !== 'undefined' ? window : globalThis);
