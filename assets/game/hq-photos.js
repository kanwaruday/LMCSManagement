// Photograph LMCS HQ and pin it (hq-photos/index.html; backend apps-script/game-hq-photos.gs: hqphotosget, POST hqphotossave).
// The quest's holder takes the building's outside photos (3 required, a 4th optional, no people), pins HQ on the map (this phone's
// location, or a pasted Google Maps link or "lat, lng"), ticks "no people" and sends. Text reaches the page as text nodes only.
//   LMCSHqPhotos.parsePin(text) -> {lat, lng} | null   (pure, tested)
//   LMCSHqPhotos.mount(root, {session, backendUrl})
var LMCSHqPhotos = (function () {
  // "lat, lng" (two decimal numbers), a Google Maps link with @lat,lng, ?q=lat,lng, ll=lat,lng or !3dlat!4dlng -> numbers; anything else -> null
  function parsePin(text) {
    var t = String(text || '').trim(), m;
    var num = '(-?\\d{1,3}(?:\\.\\d+)?)';
    m = new RegExp('!3d' + num + '!4d' + num).exec(t) || new RegExp('@' + num + ',' + num).exec(t) ||
      new RegExp('[?&](?:q|ll|query|destination)=' + num + '(?:,|%2C)\\s*' + num, 'i').exec(t) || new RegExp('^' + num + '\\s*,\\s*' + num + '$').exec(t);
    if (!m) return null;
    var lat = Number(m[1]), lng = Number(m[2]);
    return isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat: lat, lng: lng } : null;
  }
  function em(k) { return window.LMCSEmoji ? LMCSEmoji.get(k) + ' ' : ''; } // the shared emoji map (assets/game/emoji.js)
  function inArea(p) { return !!p && p.lat >= 31 && p.lat <= 33 && p.lng >= 75.5 && p.lng <= 78; } // the server checks the same box

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'on') Object.keys(attrs.on).forEach(function (ev) { n.addEventListener(ev, attrs.on[ev]); });
      else if (attrs[k] === true) n.setAttribute(k, '');
      else if (attrs[k] !== false && attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function resize(file) { // longest side 1600 px (enough for the Art Studio), JPEG 0.75, as base64
    return new Promise(function (ok, no) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.75).split(',')[1]);
      };
      img.onerror = function () { URL.revokeObjectURL(url); no(new Error('This photo could not be read. Take it again.')); };
      img.src = url;
    });
  }

  function mount(root, o) {
    var S = { data: null, busy: false, tick: false, msg: '', local: {}, pinText: '' };
    var get = function () { return fetch(o.backendUrl + '?action=hqphotosget&idToken=' + encodeURIComponent(o.session.idToken), { cache: 'no-store' }).then(function (r) { return r.json(); }); };
    var post = function (b) { return fetch(o.backendUrl, { method: 'POST', body: JSON.stringify(Object.assign({ action: 'hqphotossave', idToken: o.session.idToken }, b)) }).then(function (r) { return r.json(); }); };
    function load() {
      root.textContent = 'Loading…';
      get().then(function (d) { S.data = d; draw(); }).catch(function () { root.textContent = 'No connection. Try again when you have signal.'; });
    }
    function act(p, okMsg) {
      S.busy = true; S.msg = 'Sending…'; draw();
      return p.then(function (r) {
        S.busy = false;
        if (!r || !r.success) { S.msg = (r && r.error) || "That didn't go through. Try again."; draw(); return false; }
        S.msg = okMsg || ''; return get().then(function (d) { S.data = d; draw(); return true; });
      }).catch(function () { S.busy = false; S.msg = "No connection. Nothing was lost: try again."; draw(); return false; });
    }
    function shoot(s, file) {
      S.busy = true; S.msg = 'Getting the photo ready…'; draw();
      resize(file).then(function (b64) {
        S.local[s.id] = 'data:image/jpeg;base64,' + b64;
        return act(post({ op: 'photo', shot: s.id, base64: b64 }), 'Saved.');
      }, function (e) { S.busy = false; S.msg = e.message; draw(); });
    }
    function setPin(p) {
      if (!p) { S.msg = 'Paste a Google Maps link to HQ, or type its latitude, then a comma, then its longitude.'; draw(); return; }
      if (!inArea(p)) { S.msg = 'That place is outside the LMS area. Pin LMCS HQ itself.'; draw(); return; }
      act(post({ op: 'pin', lat: p.lat, lng: p.lng }), 'Pinned.');
    }
    function here() {
      if (!navigator.geolocation) { S.msg = 'This phone cannot share its location. Paste a Google Maps link instead.'; draw(); return; }
      S.busy = true; S.msg = 'Finding where you are… stand at HQ.'; draw();
      navigator.geolocation.getCurrentPosition(function (pos) { S.busy = false; setPin({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
        function () { S.busy = false; S.msg = 'The location was not shared. Paste a Google Maps link instead.'; draw(); }, { enableHighAccuracy: true, timeout: 20000 });
    }
    function draw() {
      var d = S.data;
      root.textContent = '';
      if (!d || !d.success) { root.appendChild(el('p', { class: 'gb-card', role: 'alert', text: (d && d.error) || 'This could not load. Try again.' })); return; }
      var locked = d.sent || S.busy;
      if (d.sent) root.appendChild(el('p', { class: 'gb-card hq-done', role: 'status', text: '✓ Sent. Thank you: the Art Studio will draw LMCS HQ from these.' }));
      root.appendChild(el('p', { class: 'hq-rule', text: 'Outside only, the building itself. No people in any photo: wait for the road to clear.' }));
      var list = el('ol', { class: 'hq-shots' }, d.shots.map(function (s, i) {
        var input = el('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'hq-file', 'aria-label': 'Photo: ' + s.label, disabled: locked,
          on: { change: function () { if (input.files[0]) shoot(s, input.files[0]); } } });
        return el('li', { class: 'hq-shot' + (s.taken ? ' is-done' : '') }, [
          el('div', { class: 'hq-shot-h' }, [el('span', { class: 'hq-n', 'aria-hidden': 'true', text: s.taken ? '✓' : String(i + 1) }), el('b', { text: s.label })]),
          S.local[s.id] ? el('img', { class: 'hq-img', src: S.local[s.id], alt: '' }) : null,
          d.sent ? null : el('label', { class: 'gb-btn hq-take' }, [s.taken ? 'Take it again' : em('photo') + 'Take the photo', input])]);
      }));
      root.appendChild(list);
      var pinIn = el('input', { type: 'text', class: 'gb-input', id: 'hq-pin', inputmode: 'url', autocomplete: 'off', placeholder: 'A Google Maps link, or latitude, longitude', value: S.pinText, disabled: locked,
        on: { input: function () { S.pinText = pinIn.value; } } });
      root.appendChild(el('section', { class: 'hq-pinbox', 'aria-labelledby': 'hq-pinh' }, [
        el('h2', { id: 'hq-pinh', text: em('realMap') + (d.pin ? 'Pinned' : 'Pin LMCS HQ') }),
        d.pin ? el('p', {}, [String(d.pin.lat) + ', ' + String(d.pin.lng) + ' · ', el('a', { href: 'https://www.google.com/maps?q=' + d.pin.lat + ',' + d.pin.lng, target: '_blank', rel: 'noopener', text: 'check it on Google Maps' })]) : null,
        d.sent ? null : el('div', { class: 'hq-row' }, [el('button', { type: 'button', class: 'gb-btn', disabled: locked, text: 'Use my location (stand at HQ)', on: { click: here } })]),
        d.sent ? null : el('div', { class: 'gb-field' }, [el('label', { for: 'hq-pin', text: 'Or paste where it is' }), pinIn,
          el('button', { type: 'button', class: 'gb-btn', disabled: locked, text: 'Set the pin', on: { click: function () { setPin(parsePin(pinIn.value)); } } })])]));
      if (!d.sent) {
        var tick = el('input', { type: 'checkbox', id: 'hq-tick', checked: S.tick, disabled: locked, on: { change: function () { S.tick = tick.checked; draw(); } } });
        root.appendChild(el('label', { class: 'hq-tick', for: 'hq-tick' }, [tick, 'No people in the photos']));
        root.appendChild(el('button', { type: 'button', class: 'gb-btn hq-send' + (d.ready && S.tick ? ' gb-btn-primary' : ''), disabled: !d.ready || !S.tick || locked, text: 'Send to the Art Studio',
          on: { click: function () { act(post({ op: 'submit', noPeople: true }), 'Sent.'); } } }));
        if (!d.ready) root.appendChild(el('p', { class: 'gb-muted', text: 'Take the three photos marked 1–3 and set the pin; the fourth is optional.' }));
      }
      root.appendChild(el('p', { class: 'hq-msg', role: 'status', 'aria-live': 'polite', text: S.msg }));
    }
    load();
  }
  return { parsePin: parsePin, inArea: inArea, mount: mount };
})();
if (typeof module !== 'undefined') module.exports = LMCSHqPhotos;
