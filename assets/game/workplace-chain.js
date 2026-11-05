/* 📸 The workplace setup chain (workplace/index.html), V2 row #5. Backend: apps-script/game-workplace.gs.
   Person mode: each of your rooms (the Principal put you in it, principal/rooms.html), three photos, an empty-room tick, then send.
   Review mode (?review=1): the Principal (own school) or the Owner (?campus, or every Principal's room) looks at each set and approves it
   or asks for a redo with a reason. Photos are resized on the phone (1280 px, JPEG 0.7) before they leave it. Text nodes only.
   window.LMCSWorkplace.mount(el, { session, backendUrl, review, campus, room }) · pure helpers for tests/game/test-workplace-chain-js.js */
var LMCSWorkplace = (function () {
  'use strict';
  var STATUS = { none: 'Not started', draft: 'Photos not sent yet', pending: 'With the reviewer now', approved: 'Approved ✓', redo: 'Take them again' };
  // what a room needs next, for its card's line
  function nextLine(room) {
    if (room.status === 'approved') return 'Approved. This is your workplace now.';
    if (room.status === 'pending') return 'Sent. Your Principal will check the photos.';
    var left = room.shots.filter(function (s) { return !s.taken; }).length;
    if (room.status === 'redo') return 'Take them again: ' + room.note;
    return left ? left + ' of ' + room.shots.length + ' photos to take' : 'All photos taken: tick the box and send';
  }
  function canSend(room, ticked) { return ticked && room.status !== 'pending' && room.status !== 'approved' && room.shots.every(function (s) { return s.taken; }); }

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
  function resize(file) { // the phone's photo, longest side 1280 px, JPEG 0.7, as base64
    return new Promise(function (ok, no) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var k = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.7).split(',')[1]);
      };
      img.onerror = function () { URL.revokeObjectURL(url); no(new Error('This photo could not be read. Take it again.')); };
      img.src = url;
    });
  }

  function mount(root, o) {
    var S = { data: null, thumbs: {}, busy: false, tick: {}, msg: {} };
    var get = function (q) {
      return fetch(o.backendUrl + '?' + q + '&idToken=' + encodeURIComponent(o.session.idToken), { cache: 'no-store' }).then(function (r) { return r.json(); });
    };
    var post = function (b) { return fetch(o.backendUrl, { method: 'POST', body: JSON.stringify(Object.assign({ action: 'workplacesave', idToken: o.session.idToken }, b)) }).then(function (r) { return r.json(); }); };
    var key = function (r, s) { return r.campus + '|' + r.roomId + '|' + s; };
    function load() {
      root.textContent = 'Loading…';
      get('action=workplaceget' + (o.review ? '&review=1' + (o.campus ? '&campus=' + o.campus : '') : '')).then(function (r) {
        if (!r.success) { root.textContent = r.error || 'Could not load. Try again.'; return; }
        S.data = r; draw();
      }).catch(function () { root.textContent = 'No connection. Try again when you have signal.'; });
    }
    function thumb(r, s) { // a saved photo, fetched once per visit (scoped by the server)
      var k = key(r, s.id), img = el('img', { alt: s.label, class: 'wp-img', tabindex: '0', title: 'Tap to see it large',
        on: { click: function () { img.parentNode.classList.toggle('is-big'); }, keydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); img.parentNode.classList.toggle('is-big'); } } } });
      if (S.thumbs[k]) img.src = S.thumbs[k];
      else if (s.taken) get('action=workplaceimage&campus=' + r.campus + '&roomId=' + encodeURIComponent(r.roomId) + '&shot=' + s.id).then(function (x) {
        if (x.success) { S.thumbs[k] = 'data:image/jpeg;base64,' + x.base64; img.src = S.thumbs[k]; }
      });
      return img;
    }
    function personRoom(r) {
      var locked = r.status === 'pending' || r.status === 'approved';
      var shots = el('ol', { class: 'wp-shots' }, r.shots.map(function (s, i) {
        var input = el('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'wp-file', 'aria-label': 'Photo: ' + s.label, disabled: locked || S.busy,
          on: { change: function () { if (input.files[0]) shoot(r, s, input.files[0]); } } });
        return el('li', { class: 'wp-shot' + (s.taken ? ' is-done' : '') }, [
          el('div', { class: 'wp-shot-h' }, [el('span', { class: 'wp-n', 'aria-hidden': 'true', text: s.taken ? '✓' : String(i + 1) }), el('b', { text: s.label })]),
          s.taken ? thumb(r, s) : null,
          locked ? null : el('label', { class: 'gb-btn wp-take' }, [s.taken ? '📸 Take again' : '📸 Take photo', input])]);
      }));
      var tick = el('input', { type: 'checkbox', id: 'tk-' + r.roomId, checked: !!S.tick[r.roomId], disabled: locked, on: { change: function () { S.tick[r.roomId] = tick.checked; draw(); } } });
      var send = el('button', { type: 'button', class: 'gb-btn gb-btn-primary wp-send', disabled: !canSend(r, S.tick[r.roomId]) || S.busy, on: { click: function () { act(r, post({ op: 'submit', campus: r.campus, roomId: r.roomId, noPeople: true })); } },
        text: 'Send to be checked' });
      return el('section', { class: 'gb-card wp-room', 'aria-label': r.roomName }, [
        el('h2', { class: 'gb-h2' }, [r.roomName, el('small', { class: 'wp-st wp-' + r.status, text: STATUS[r.status] || '' })]),
        el('p', { class: 'wp-line', text: nextLine(r) }),
        r.status === 'none' || r.status === 'draft' || r.status === 'redo' ? el('p', { class: 'gb-muted', text: 'Take the room empty: no children or people in the photos.' }) : null,
        shots,
        locked ? null : el('label', { class: 'wp-tick', for: 'tk-' + r.roomId }, [tick, ' Empty room: no children or people in the photos']),
        locked ? null : send,
        el('p', { class: 'wp-msg', role: 'status', text: S.msg[r.roomId] || '' })]);
    }
    function reviewRoom(r) {
      var note = el('textarea', { class: 'gb-input', rows: '2', maxlength: '200', 'aria-label': 'What to take again', placeholder: 'What to take again (for a redo)' });
      var waiting = r.status === 'pending';
      return el('section', { class: 'gb-card wp-room', 'aria-label': r.roomName }, [
        el('h2', { class: 'gb-h2' }, [r.roomName + ' · ' + r.campus.replace(/^LMS(\d)$/, 'LMS $1'), el('small', { class: 'wp-st wp-' + r.status, text: waiting ? 'Waiting for your check' : STATUS[r.status] || '' })]),
        el('p', { class: 'gb-muted', text: r.staff }),
        el('ol', { class: 'wp-shots wp-grid' }, r.shots.map(function (s) { return el('li', { class: 'wp-shot' }, [el('b', { text: s.label }), s.taken ? thumb(r, s) : el('span', { class: 'gb-muted', text: 'Not taken' })]); })),
        waiting ? note : null,
        waiting ? el('div', { class: 'wp-row' }, [
          el('button', { type: 'button', class: 'gb-btn gb-btn-primary', disabled: S.busy, text: '✓ Approve', on: { click: function () { act(r, post({ op: 'decide', campus: r.campus, roomId: r.roomId, decision: 'approve' })); } } }),
          el('button', { type: 'button', class: 'gb-btn', disabled: S.busy, text: 'Ask for a redo', on: { click: function () { act(r, post({ op: 'decide', campus: r.campus, roomId: r.roomId, decision: 'redo', note: note.value })); } } })]) : null,
        el('p', { class: 'wp-msg', role: 'status', text: S.msg[r.roomId] || '' })]);
    }
    function draw() {
      root.textContent = '';
      var rooms = S.data.rooms || [];
      if (!rooms.length) {
        root.appendChild(el('div', { class: 'gb-card wp-empty' }, [el('p', { text: o.review ? 'No photos are waiting for you.'
          : 'No workplace to photograph yet. Your Principal first names the rooms and puts you in yours (classrooms have their own chain).' })]));
        return;
      }
      if (o.review) rooms = rooms.slice().sort(function (a, b) { return (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1); });
      if (o.room) rooms = rooms.filter(function (r) { return r.roomId === o.room; }).concat(rooms.filter(function (r) { return r.roomId !== o.room; }));
      rooms.forEach(function (r) { root.appendChild(o.review ? reviewRoom(r) : personRoom(r)); });
    }
    function act(r, p) {
      S.busy = true; S.msg[r.roomId] = 'Saving…'; draw();
      return p.then(function (x) {
        S.busy = false;
        if (!x.success) { S.msg[r.roomId] = x.error || 'Not saved. Try again.'; draw(); return; }
        S.msg[r.roomId] = ''; load();
      }).catch(function () { S.busy = false; S.msg[r.roomId] = 'No connection. Nothing was saved.'; draw(); });
    }
    function shoot(r, s, file) {
      S.busy = true; S.msg[r.roomId] = 'Sending the photo…'; draw();
      resize(file).then(function (b64) {
        S.thumbs[key(r, s.id)] = 'data:image/jpeg;base64,' + b64;
        return act(r, post({ op: 'photo', campus: r.campus, roomId: r.roomId, shot: s.id, base64: b64 }));
      }).catch(function (e) { S.busy = false; S.msg[r.roomId] = e.message; draw(); });
    }
    load();
  }
  return { mount: mount, nextLine: nextLine, canSend: canSend, STATUS: STATUS };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = LMCSWorkplace;
