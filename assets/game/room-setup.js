/* 🏫 Room setup (principal/rooms.html), V2 row #8: step 1 name the school's rooms, step 2 put staff in them.
   Backend: game-rooms.gs (GET roomsget, POST roomssave). Every change saves at once (the whole list, the server re-checks it) and the
   page redraws from the server's answer, so what you see is what is stored. Text nodes only, never parsed HTML.
   window.LMCSRooms.mount(el, { session, backendUrl, campus, back }) · pure helpers on LMCSRooms for tests/game/test-room-setup-js.js */
var LMCSRooms = (function () {
  'use strict';

  // ── pure helpers ───────────────────────────────────────────────────
  function cleanName(s) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 60); }
  // "Class 7A, Class 7B" or one per line -> ['Class 7A', 'Class 7B'] (blanks dropped)
  function splitNames(s) { return String(s || '').split(/[,\n]/).map(cleanName).filter(Boolean); }
  // the first name in `names` already used in rooms (case-insensitive), skipping room index `skip`; or ''
  function clash(rooms, names, skip) {
    var have = {};
    rooms.forEach(function (r, i) { if (i !== skip) have[r.name.toLowerCase()] = true; });
    for (var i = 0; i < names.length; i++) { var k = names[i].toLowerCase(); if (have[k]) return names[i]; have[k] = true; }
    return '';
  }
  // a type id from a room name when the Principal didn't pick one ("Physics lab" -> lab)
  function guessType(name, types) {
    var n = name.toLowerCase(), ids = types.map(function (t) { return t.id; });
    var rules = [[/\b(class|section|grade|nursery|lkg|ukg|kg|montessori|^\d{1,2}\s?[a-z]?$)/, 'classroom'], [/\blab/, 'lab'], [/office|reception/, 'office'],
      [/librar/, 'library'], [/staff/, 'staffroom'], [/activit|music|art|craft|dance|drawing/, 'activity'], [/\bpt\b|ground|sport|gym/, 'pt'], [/record/, 'records'], [/account/, 'accounts']];
    for (var i = 0; i < rules.length; i++) if (rules[i][0].test(n) && ids.indexOf(rules[i][1]) !== -1) return rules[i][1];
    return ids.indexOf('other') !== -1 ? 'other' : ids[0];
  }
  function stepText(p) {
    if (!p.total) return 'Step 1 of 2: name your rooms';
    if (p.complete) return 'All ' + p.total + ' rooms have someone in charge ✓';
    return p.allocated + ' of ' + p.total + ' rooms have someone in charge';
  }
  function pct(p) { return p.total ? Math.round(100 * p.allocated / p.total) : 0; }
  // what the server needs back: only id, name, type, staff
  function payload(rooms) { return rooms.map(function (r) { var o = { name: r.name, type: r.type, staff: r.staff || '' }; if (r.id) o.id = r.id; return o; }); }

  // ── DOM helpers ────────────────────────────────────────────────────
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'on') Object.keys(attrs.on).forEach(function (ev) { n.addEventListener(ev, attrs.on[ev]); });
      else if (attrs[k] === true) n.setAttribute(k, '');
      else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function typeOf(S, id) { return S.data.types.filter(function (t) { return t.id === id; })[0] || { id: id, label: id, emoji: '🚪' }; }
  function typeSelect(S, value, label, onChange) {
    return el('select', { class: 'gb-input', 'aria-label': label, disabled: !S.data.canEdit, on: { change: onChange } },
      S.data.types.map(function (t) { var o = el('option', { value: t.id, text: (t.emoji ? t.emoji + ' ' : '') + t.label }); if (t.id === value) o.selected = true; return o; }));
  }

  // ── saving ─────────────────────────────────────────────────────────
  // one save at a time; only the newest answer redraws (a later change already holds newer rooms)
  function save(S, rooms, what) {
    var mine = ++S.seq;
    S.rooms = rooms;
    draw(S);
    say(S, 'Saving…', '');
    S.chain = S.chain.then(function () {
      return fetch(S.url, { method: 'POST', body: JSON.stringify({ action: 'roomssave', idToken: S.session.idToken, campus: S.data.campus, rooms: payload(rooms) }) })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (!res || res.success !== true) throw new Error((res && res.error) || 'Could not save. Please try again.');
          if (mine !== S.seq) return;
          var was = S.data.progress.complete;
          S.data = res; S.rooms = res.rooms;
          if (!was && res.progress.complete) S.justDone = true;
          draw(S);
          say(S, what + ' ✓', 'ok');
        })
        .catch(function (err) {
          if (mine !== S.seq) return;
          S.rooms = S.data.rooms; // back to what is stored
          draw(S);
          say(S, String(err && err.message || err), 'err');
        });
    });
  }
  function say(S, text, kind) {
    S.live.textContent = text;
    S.live.className = 'rs-toast' + (kind ? ' rs-toast-' + kind + ' a-toast-slide' : '');
  }

  // ── drawing ────────────────────────────────────────────────────────
  function draw(S) {
    var d = S.data, rooms = S.rooms, p = { total: rooms.length, allocated: rooms.filter(function (r) { return r.staff; }).length };
    p.complete = p.total > 0 && p.allocated === p.total;
    var root = S.root;
    var focusId = document.activeElement && document.activeElement.id;
    while (root.firstChild) root.removeChild(root.firstChild);
    if (S.step === 2 && !rooms.length) S.step = 1;

    if (!d.canEdit) root.appendChild(el('p', { class: 'gb-alert gb-alert-warn', text: 'You can look at these rooms. Only the Principal of ' + d.campusName + ' (or the Owner) can change them.' }));

    // the two steps
    var tabs = el('div', { class: 'rs-steps', role: 'tablist', 'aria-label': 'Room setup steps' }, [
      el('button', { type: 'button', role: 'tab', id: 'rs-tab-1', class: 'rs-step' + (S.step === 1 ? ' is-on' : ''), 'aria-selected': S.step === 1 ? 'true' : 'false',
        on: { click: function () { S.step = 1; draw(S); } } }, [el('span', { class: 'rs-num', text: rooms.length ? '✓' : '1' }), el('span', {}, ['Name your rooms', el('small', { text: rooms.length ? rooms.length + ' named' : 'Start here' })])]),
      el('button', { type: 'button', role: 'tab', id: 'rs-tab-2', class: 'rs-step' + (S.step === 2 ? ' is-on' : ''), 'aria-selected': S.step === 2 ? 'true' : 'false', disabled: !rooms.length,
        on: { click: function () { S.step = 2; draw(S); } } }, [el('span', { class: 'rs-num', text: p.complete ? '✓' : '2' }), el('span', {}, ['Put staff in rooms', el('small', { text: rooms.length ? p.allocated + ' of ' + p.total : 'After step 1' })])]),
    ]);
    root.appendChild(tabs);
    root.appendChild(el('div', { class: 'gb-bar rs-bar a-room-build-progress' + (p.complete ? ' gb-bar-ok' : ''), role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct(p)), 'aria-label': stepText(p) },
      [el('i', { style: 'width:' + pct(p) + '%' })]));

    if (S.justDone && p.complete) {
      root.appendChild(el('div', { class: 'gb-done rs-done a-quest-complete', role: 'status' }, [
        el('strong', { text: '🎉 Every room has its name and its person.' }),
        el('p', { text: 'Next, each person will be asked to photograph their own room, empty, for their Home.' }),
        el('a', { class: 'gb-btn gb-btn-primary', href: S.back, text: 'Back to my page' })]));
    }
    root.appendChild(S.step === 1 ? stepOne(S) : stepTwo(S));
    if (focusId && document.getElementById(focusId)) document.getElementById(focusId).focus();
  }

  function stepOne(S) {
    var d = S.data, rooms = S.rooms, box = el('section', { class: 'rs-panel', role: 'tabpanel', 'aria-labelledby': 'rs-tab-1' });
    box.appendChild(el('p', { class: 'gb-lead', text: rooms.length ? 'Add any room that is missing. Tap a name to change it.' : 'Write the name of each room in your school: every classroom, lab, the office, the library, the staff room. You can change them any time.' }));

    if (d.canEdit) {
      var input = el('input', { id: 'rs-new', class: 'gb-input', type: 'text', maxlength: '200', autocomplete: 'off', placeholder: 'e.g. Class 7A, Physics lab', 'aria-describedby': 'rs-new-hint' });
      var err = el('p', { class: 'gb-field-err', id: 'rs-new-err', hidden: true });
      var add = function (e) {
        if (e) e.preventDefault();
        var names = splitNames(input.value);
        if (!names.length) { err.textContent = 'Write a room name first.'; err.hidden = false; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
        var dup = clash(rooms, names, -1);
        if (dup) { err.textContent = '“' + dup + '” is already on your list. Give each room its own name.'; err.hidden = false; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
        var next = rooms.concat(names.map(function (n) { return { name: n, type: guessType(n, d.types), staff: '' }; }));
        S.fresh = names.map(function (n) { return n.toLowerCase(); });
        save(S, next, names.length === 1 ? '“' + names[0] + '” added' : names.length + ' rooms added');
      };
      box.appendChild(el('form', { class: 'gb-field rs-add', on: { submit: add } }, [
        el('label', { for: 'rs-new', text: 'New room' }),
        el('div', { class: 'rs-add-row' }, [input, el('button', { type: 'submit', class: 'gb-btn a-button-press' + (S.justDone ? '' : ' gb-btn-primary'), text: 'Add' })]),
        el('p', { class: 'gb-hint', id: 'rs-new-hint', text: 'Several at once? Separate them with commas: Class 1A, Class 1B, Class 2A' }), err]));

      if (d.suggest && d.suggest.length) {
        box.appendChild(el('p', { class: 'rs-sub', text: 'Or tap to add:' }));
        box.appendChild(el('div', { class: 'rs-chips' }, d.suggest.map(function (sg) {
          return el('button', { type: 'button', class: 'rs-chip a-button-press', 'aria-label': 'Add ' + sg.name,
            on: { click: function () {
              if (clash(S.rooms, [sg.name], -1)) return;
              S.fresh = [sg.name.toLowerCase()];
              save(S, S.rooms.concat({ name: sg.name, type: sg.type, staff: '' }), '“' + sg.name + '” added');
            } } }, ['+ ' + typeOf(S, sg.type).emoji + ' ' + sg.name]);
        })));
      }
    }

    if (!rooms.length) {
      box.appendChild(el('p', { class: 'gb-empty rs-empty', text: '🚧 No rooms yet. The rooms you add appear here, and on your school building.' }));
      return box;
    }
    box.appendChild(el('h2', { class: 'gb-h2 rs-h', text: 'Your rooms (' + rooms.length + ')' }));
    var list = el('ul', { class: 'rs-list' });
    rooms.forEach(function (r, i) {
      var t = typeOf(S, r.type), fresh = (S.fresh || []).indexOf(r.name.toLowerCase()) !== -1;
      var name = el('input', { id: 'rs-name-' + i, class: 'gb-input rs-name', type: 'text', maxlength: '60', value: r.name, 'aria-label': 'Room name', disabled: !d.canEdit,
        on: { change: function () {
          var v = cleanName(name.value);
          if (!v) { name.value = r.name; say(S, 'A room needs a name. To take it off the list, use Remove.', 'err'); return; }
          if (v === r.name) return;
          if (clash(S.rooms, [v], i)) { name.value = r.name; say(S, '“' + v + '” is already on your list.', 'err'); return; }
          save(S, S.rooms.map(function (x, j) { return j === i ? Object.assign({}, x, { name: v }) : x; }), 'Renamed to “' + v + '”');
        }, keydown: function (e) { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } } } });
      var kids = [el('span', { class: 'rs-emoji', 'aria-hidden': 'true', text: t.emoji || '🚪' }), el('div', { class: 'rs-main' }, [name,
        typeSelect(S, r.type, 'Kind of room for ' + r.name, function (e) { save(S, S.rooms.map(function (x, j) { return j === i ? Object.assign({}, x, { type: e.target.value }) : x; }), r.name + ' is now a ' + typeOf(S, e.target.value).label.toLowerCase()); })])];
      if (d.canEdit) kids.push(el('button', { type: 'button', class: 'gb-btn gb-btn-danger rs-remove', 'aria-label': 'Remove ' + r.name, text: 'Remove',
        on: { click: function () {
          if (!window.confirm('Remove “' + r.name + '” from your rooms?' + (r.staff ? ' ' + (r.staffName || 'Its person') + ' will no longer be in charge of it.' : ''))) return;
          save(S, S.rooms.filter(function (x, j) { return j !== i; }), '“' + r.name + '” removed');
        } } }));
      list.appendChild(el('li', { class: 'gb-card rs-room' + (fresh ? ' a-room-unlock' : '') }, kids));
    });
    box.appendChild(list);
    box.appendChild(el('button', { type: 'button', class: 'gb-btn rs-next', text: 'Next: put staff in rooms →', on: { click: function () { S.step = 2; S.fresh = null; draw(S); window.scrollTo(0, 0); } } }));
    return box;
  }

  function stepTwo(S) {
    var d = S.data, rooms = S.rooms, box = el('section', { class: 'rs-panel', role: 'tabpanel', 'aria-labelledby': 'rs-tab-2' });
    box.appendChild(el('p', { class: 'gb-lead', text: 'Choose who is in charge of each room: the class teacher for a classroom, the Fee Clerk for the office, the Librarian for the library. One person can have more than one room.' }));
    if (!d.staffComplete) box.appendChild(el('p', { class: 'gb-alert gb-alert-warn', text: 'The staff list may be missing some people right now. If someone is not there, try again in a few minutes.' }));
    if (!d.staff.length) box.appendChild(el('p', { class: 'gb-alert gb-alert-warn', text: 'No staff are listed for ' + d.campusName + ' yet. Ask the office to add them to the Employee Master.' }));
    var list = el('ul', { class: 'rs-list' });
    rooms.forEach(function (r, i) {
      var t = typeOf(S, r.type), id = 'rs-staff-' + i;
      var opts = [el('option', { value: '', text: '— Nobody yet —' })].concat(d.staff.map(function (p) {
        var o = el('option', { value: p.email, text: p.name + ' · ' + roleLabel(p.role) }); if (p.email === r.staff) o.selected = true; return o;
      }));
      if (r.staff && !d.staff.some(function (p) { return p.email === r.staff; })) { var gone = el('option', { value: r.staff, text: (r.staffName || r.staff) + ' (not on the staff list now)' }); gone.selected = true; opts.push(gone); }
      list.appendChild(el('li', { class: 'gb-card rs-room' + (r.staff ? ' is-set' : '') }, [
        el('span', { class: 'rs-emoji', 'aria-hidden': 'true', text: t.emoji || '🚪' }),
        el('div', { class: 'rs-main' }, [el('label', { for: id, class: 'rs-room-name', text: r.name }),
          el('select', { id: id, class: 'gb-input', disabled: !d.canEdit, on: { change: function (e) {
            var who = e.target.value, p = d.staff.filter(function (x) { return x.email === who; })[0];
            save(S, S.rooms.map(function (x, j) { return j === i ? Object.assign({}, x, { staff: who }) : x; }), who ? (p ? p.name : 'Someone') + ' is in charge of ' + r.name : r.name + ' has nobody now');
          } } }, opts)]),
        el('span', { class: 'rs-mark', 'aria-hidden': 'true', text: r.staff ? '✓' : '' })]));
    });
    box.appendChild(list);
    box.appendChild(el('p', { class: 'gb-note', text: '🚌 Buses are not rooms here: a driver is put on their bus in Transport.' }));
    return box;
  }
  function roleLabel(r) { return { FeeClerk: 'Fee Clerk', Principal: 'Principal', Teacher: 'Teacher', Staff: 'Staff', Coordinator: 'Coordinator', Accounts: 'Accounts' }[r] || r; }

  // ── mount ──────────────────────────────────────────────────────────
  function mount(root, o) {
    var S = { root: el('div', { class: 'rs' }), session: o.session, url: o.backendUrl, back: o.back || '../principal/index.html', step: /#staff/.test(location.hash) ? 2 : 1, seq: 0, chain: Promise.resolve(), live: el('p', { class: 'rs-toast', role: 'status', 'aria-live': 'polite' }) };
    root.appendChild(S.root);
    root.appendChild(S.live);
    S.root.appendChild(el('p', { class: 'gb-loading', text: 'Loading your rooms…' }));
    var url = S.url + (S.url.indexOf('?') === -1 ? '?' : '&') + 'action=roomsget&idToken=' + encodeURIComponent(S.session.idToken || '') + (o.campus ? '&campus=' + encodeURIComponent(o.campus) : '');
    return fetch(url, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (res) {
      if (!res || res.success !== true) throw new Error((res && res.error) || 'Could not load the rooms.');
      S.data = res; S.rooms = res.rooms;
      if (o.onLoad) o.onLoad(res);
      draw(S);
    }).catch(function (err) {
      while (S.root.firstChild) S.root.removeChild(S.root.firstChild);
      S.root.appendChild(el('p', { class: 'gb-alert gb-alert-err', text: String(err && err.message || err) }));
      S.root.appendChild(el('button', { type: 'button', class: 'gb-btn', text: 'Try again', on: { click: function () { location.reload(); } } }));
    });
  }

  return { mount: mount, cleanName: cleanName, splitNames: splitNames, clash: clash, guessType: guessType, stepText: stepText, pct: pct, payload: payload };
})();
if (typeof window !== 'undefined') window.LMCSRooms = LMCSRooms;
