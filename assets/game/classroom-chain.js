// "My class" (assets/game/classroom-chain.js + .css): the Classroom setup chain on the teacher hub and, for a person with a tie, the staff
// home (V2 row #4; Uday, 1 Nov). The tie line, today's attendance from the ERP, "Meet your students" (roll number and name only, the
// teacher's own class) and, while classroom photos are on, the classroom's items with a photo each. No student photo anywhere.
//   LMCSClassroom.mount(el, { session, backendUrl, hideWithoutTies })   el stays hidden until there is something to show
//   LMCSClassroom.open('classroom' | 'classroom-students' | 'classroom-items')   the hash routes; safe before the data is in
// Backend: game-classroom.gs (classroomget, POST classroomsave) and game-erp.gs (erpread). Every piece of text goes in as text nodes.
var LMCSClassroom = (function () {
  var IST_MS = 330 * 60000, MAX_SIDE = 1600, QUALITY = 0.8;
  var NO_TIE = 'Your Principal links you to your class in the school’s ERP list. Until then this stays empty.';
  var RULE = 'Take photos before school or after dismissal. No children in the photo.';

  // ── pure helpers (tests call these without a document) ──
  function istToday(d) { return new Date((d || new Date()).getTime() + IST_MS).toISOString().slice(0, 10); }
  function classKey(t) { return [t.campus, t.class, t.section].join(':'); }
  function titleCase(s) { return String(s || '').toLowerCase().replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }); }
  function tieLabel(t) {
    var cls = /^\d/.test(t.class) ? 'Class ' + t.class : t.class;
    return [cls, t.section].filter(Boolean).join(' ') + ' · ' + (t.kind === 'class' ? 'class teacher' : titleCase(t.subject));
  }
  function attendanceLine(summary, day) {
    var s = summary && summary[day];
    if (!s || !s.total) return null;
    if (s.H && s.H === s.total) return 'Today is marked a holiday.';
    return 'Present ' + (s.P || 0) + ' · Absent ' + (s.A || 0) + ' · Leave ' + (s.L || 0) + ' of ' + s.total;
  }
  function shrinkSize(w, h, max) {
    var k = Math.min(1, max / Math.max(w, h));
    return { w: Math.round(w * k), h: Math.round(h * k) };
  }
  var api = { istToday: istToday, classKey: classKey, tieLabel: tieLabel, attendanceLine: attendanceLine, shrinkSize: shrinkSize };
  if (typeof document === 'undefined') return api;

  // ── DOM ──
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'onclick' || k === 'onchange' || k === 'onsubmit') el[k] = v; else el.setAttribute(k, v === true ? '' : v);
    });
    [].concat(kids === undefined ? [] : kids).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    });
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  var S = { el: null, o: null, data: null, tie: null, pending: null, students: null, studentsFor: '', edit: null, busy: false, pop: '' };

  function get(qs) {
    return fetch(S.o.backendUrl + '?' + qs + '&idToken=' + encodeURIComponent(S.o.session.idToken || ''), { cache: 'no-store' })
      .then(function (r) { return r.json(); }).catch(function () { return { success: false }; });
  }
  function post(body) {
    body.action = 'classroomsave'; body.idToken = S.o.session.idToken || '';
    return fetch(S.o.backendUrl, { method: 'POST', body: JSON.stringify(body) }) // plain text: no preflight (game.gs doPost)
      .then(function (r) { return r.json(); }).catch(function () { return { success: false, error: 'That didn’t save. Check your connection and try again.' }; });
  }
  function erpQs(what) {
    var t = S.tie;
    return 'action=erpread&what=' + what + '&campus=' + encodeURIComponent(t.campus) + '&class=' + encodeURIComponent(t.class) + '&section=' + encodeURIComponent(t.section);
  }
  // an erpread reply that isn't rows: the contract's note, its own sentence, or (no ERP module) the classroomget note
  function erpEmpty(r) {
    if (r && r.success && r.configured === false) return r.note;
    if (r && r.success === false && r.code) return r.error;
    if (!r || r.success !== true) return (S.data.erp && S.data.erp.note) || 'The school’s ERP list isn’t connected yet.';
    return null;
  }

  function render() {
    var d = S.data, el = S.el;
    clear(el);
    el.appendChild(h('h2', { class: 'gb-h2', id: 'crHead' }, 'My class'));
    if (!d.ties.length) { el.appendChild(h('p', { class: 'gb-empty' }, d.erp && !(d.erp.connected && d.erp.configured) && d.erp.note ? d.erp.note : NO_TIE)); return; }
    if (d.ties.length > 1) {
      var sel = h('select', { class: 'gb-input cr-pick', 'aria-label': 'Which class' }, d.ties.map(function (t, i) {
        return h('option', { value: String(i), selected: t === S.tie }, tieLabel(t));
      }));
      sel.onchange = function () { S.tie = d.ties[Number(sel.value)]; S.students = null; S.edit = null; render(); };
      el.appendChild(sel);
    } else el.appendChild(h('p', { class: 'cr-tie' }, tieLabel(S.tie)));

    var att = h('p', { class: 'cr-att a-room-build-progress', role: 'status' }, 'Checking today’s attendance…'); // V2 animations (Art Studio)
    el.appendChild(h('div', { class: 'gb-card cr-card' }, [h('h3', {}, 'Today’s attendance'), att]));
    var forTie = S.tie;
    get(erpQs('attendance') + '&from=' + istToday() + '&to=' + istToday()).then(function (r) {
      if (forTie !== S.tie) return;
      att.classList.remove('a-room-build-progress');
      att.textContent = erpEmpty(r) || attendanceLine(r.summary, istToday()) || 'Today’s attendance isn’t in yet.';
    });

    el.appendChild(meetCard());
    if (d.photosOn && S.data.confirmed[classKey(S.tie)]) el.appendChild(itemsCard()); // items open once this class's list is confirmed (the quest's lock); one primary button at a time
  }

  // the room-tap-pop ring plays once, on the render right after that step's save (not on every re-render)
  function popOnce(which) { if (S.pop !== which) return ''; S.pop = ''; return ' a-room-tap-pop'; }

  // ── Meet your students ──
  function meetCard() {
    var key = classKey(S.tie), done = !!S.data.confirmed[key];
    var body = h('div', { class: 'cr-meet', id: 'cr-students', hidden: S.studentsFor !== key });
    var card = h('div', { class: 'gb-card cr-card' }, [h('h3', {}, 'Meet your students'),
      done ? h('p', { class: 'cr-ok' + popOnce('meet') }, '✓ You confirmed this list.') : h('p', { class: 'gb-muted' }, 'Check the names your school’s ERP has for this class.'),
      h('button', { type: 'button', class: 'gb-btn', 'aria-controls': 'cr-students', 'aria-expanded': String(S.studentsFor === key), onclick: function () { toggleStudents(this, body); } },
        S.studentsFor === key ? 'Hide the list' : 'Show the list'), body]);
    if (S.studentsFor === key) fillStudents(body);
    return card;
  }
  function toggleStudents(btn, body) {
    var key = classKey(S.tie);
    if (S.studentsFor === key) { S.studentsFor = ''; body.hidden = true; btn.textContent = 'Show the list'; btn.setAttribute('aria-expanded', 'false'); return; }
    S.studentsFor = key; body.hidden = false; btn.textContent = 'Hide the list'; btn.setAttribute('aria-expanded', 'true');
    fillStudents(body);
  }
  function fillStudents(body) {
    var forTie = S.tie, key = classKey(forTie);
    clear(body);
    body.appendChild(h('p', { class: 'gb-muted a-room-build-progress', role: 'status' }, 'Loading your class list…'));
    var got = S.students && S.students.key === key ? Promise.resolve(S.students.r) : get(erpQs('students'));
    got.then(function (r) {
      if (forTie !== S.tie) return;
      S.students = { key: key, r: r };
      clear(body);
      var empty = erpEmpty(r);
      if (empty) { body.appendChild(h('p', { class: 'gb-empty' }, empty)); return; }
      if (!r.rows.length) { body.appendChild(h('p', { class: 'gb-empty' }, 'The ERP has no students for this class yet. Tell your Principal. They fix the list in the ERP.')); return; }
      body.appendChild(h('p', { class: 'gb-muted' }, r.rows.length + ' student' + (r.rows.length === 1 ? '' : 's')));
      body.appendChild(h('ol', { class: 'cr-names' }, r.rows.map(function (s) {
        return h('li', {}, [h('span', { class: 'cr-roll' }, String(s.rollNo || '–')), h('span', {}, s.name)]);
      })));
      var say = h('p', { class: 'cr-say', role: 'status' });
      var yes = h('button', { type: 'button', class: 'gb-btn gb-btn-primary', onclick: function () {
        yes.disabled = true; say.textContent = 'Saving…';
        post({ op: 'confirm', campus: forTie.campus, class: forTie.class, section: forTie.section }).then(function (res) {
          if (res && res.success) { S.data = res; S.pop = 'meet'; keepTie(); render(); return; }
          yes.disabled = false; say.textContent = (res && res.error) || 'That didn’t save. Try again.';
        });
      } }, 'Yes, this is my class');
      var no = h('button', { type: 'button', class: 'gb-btn', onclick: function () { say.textContent = 'Tell your Principal. They fix the list in the ERP.'; } }, 'Something’s wrong');
      body.appendChild(h('div', { class: 'gb-row-acts' }, S.data.confirmed[key] ? [no] : [yes, no]));
      body.appendChild(say);
    });
  }
  function keepTie() { // after a save the ties come back as new objects: keep the same class picked
    var key = classKey(S.tie);
    S.tie = S.data.ties.filter(function (t) { return classKey(t) === key && t.kind === S.tie.kind && t.subject === S.tie.subject; })[0] || S.data.ties[0];
  }

  // ── Items ──
  function itemsCard() {
    var key = classKey(S.tie), d = S.data;
    var mine = d.items.filter(function (it) { return it.classKey === key; });
    var done = !!(d.itemsDoneFor || {})[key];
    var card = h('div', { class: 'gb-card cr-card', id: 'cr-items' }, [h('h3', {}, 'Your classroom’s items'),
      h('p', { class: 'gb-muted' }, 'Photograph each piece of furniture and equipment in this room, one item at a time. It builds the school’s inventory.')]);
    if (mine.length) card.appendChild(h('ul', { class: 'cr-items' }, mine.map(function (it) {
      return h('li', {}, [h('span', { class: 'cr-item-t' }, it.name + ' × ' + it.count), it.hasPhoto ? h('span', { class: 'cr-saved' }, '📷 saved') : null,
        h('button', { type: 'button', class: 'gb-btn gb-btn-quiet', 'aria-label': 'Change ' + it.name, onclick: function () { S.edit = it; render(); S.el.querySelector('#cr-name').focus(); } }, 'Change'),
        h('button', { type: 'button', class: 'gb-btn gb-btn-quiet', 'aria-label': 'Remove ' + it.name, onclick: function () { removeItem(it, this); } }, 'Remove')]);
    })));
    else card.appendChild(h('p', { class: 'gb-empty' }, 'No items saved yet.'));
    card.appendChild(itemForm(key));
    var say = h('p', { class: 'cr-say', role: 'status' });
    if (done) card.appendChild(h('p', { class: 'cr-ok' + popOnce('items') }, '✓ Done: you listed everything in this room. Add more any time.'));
    else {
      var hasPhoto = mine.some(function (it) { return it.hasPhoto; });
      var all = h('button', { type: 'button', class: 'gb-btn', disabled: !hasPhoto, onclick: function () {
        all.disabled = true; say.textContent = 'Saving…';
        post({ op: 'itemsdone', classKey: key }).then(function (res) {
          if (res && res.success) { S.data = res; S.pop = 'items'; keepTie(); render(); return; }
          all.disabled = false; say.textContent = (res && res.error) || 'That didn’t save. Try again.';
        });
      } }, 'That’s everything');
      card.appendChild(h('div', { class: 'gb-row-acts' }, [all]));
      if (!hasPhoto) card.appendChild(h('p', { class: 'gb-muted' }, 'Save at least one item with its photo first.'));
    }
    card.appendChild(say);
    return card;
  }
  function itemForm(key) {
    var e = S.edit && S.edit.classKey === key ? S.edit : null;
    var name = h('input', { class: 'gb-input', id: 'cr-name', type: 'text', maxlength: '60', required: true, autocomplete: 'off', value: e ? e.name : '' });
    var count = h('input', { class: 'gb-input', id: 'cr-count', type: 'number', min: '1', max: '999', step: '1', inputmode: 'numeric', required: true, value: e ? String(e.count) : '1' });
    var file = h('input', { class: 'gb-input', id: 'cr-photo', type: 'file', accept: 'image/*', capture: 'environment' });
    var tick = h('input', { type: 'checkbox', id: 'cr-nokids', required: true });
    var say = h('p', { class: 'cr-say', role: 'status' });
    var save = h('button', { type: 'submit', class: 'gb-btn gb-btn-primary' }, e ? 'Save changes' : 'Save item');
    var form = h('form', { class: 'cr-form', novalidate: true }, [
      h('h4', {}, e ? 'Change “' + e.name + '”' : 'Add an item'),
      h('div', { class: 'gb-field' }, [h('label', { for: 'cr-name' }, 'What is it?'), name]),
      h('div', { class: 'gb-field' }, [h('label', { for: 'cr-count' }, 'How many?'), count]),
      h('div', { class: 'gb-field' }, [h('label', { for: 'cr-photo' }, e ? 'New photo (leave empty to keep the saved one)' : 'Photo'), file]),
      h('label', { class: 'cr-tick', for: 'cr-nokids' }, [tick, ' There are no children in this photo']),
      h('p', { class: 'cr-rule' }, RULE),
      h('div', { class: 'gb-row-acts' }, [save, e ? h('button', { type: 'button', class: 'gb-btn', onclick: function () { S.edit = null; render(); } }, 'Cancel') : null]),
      say]);
    form.onsubmit = function (ev) {
      ev.preventDefault();
      if (S.busy) return;
      var n = name.value.trim(), c = Number(count.value), f = file.files && file.files[0];
      if (!n) { say.textContent = 'Give the item a name.'; name.focus(); return; }
      if (!(c >= 1 && c <= 999 && Math.floor(c) === c)) { say.textContent = 'The count is a whole number from 1 to 999.'; count.focus(); return; }
      if (!f && !e) { say.textContent = 'Add a photo of the item.'; file.focus(); return; }
      if (!tick.checked) { say.textContent = 'Tick “There are no children in this photo” first.'; tick.focus(); return; }
      S.busy = true; save.disabled = true; say.textContent = f ? 'Preparing the photo…' : 'Saving…';
      (f ? shrink(f) : Promise.resolve('')).then(function (photo) {
        if (f) say.textContent = 'Saving…';
        return post({ op: 'item', classKey: key, itemId: e ? e.id : undefined, name: n, count: c, photo: photo, noChildren: true });
      }).catch(function () { return { success: false, error: 'That photo could not be read. Take it again.' }; }).then(function (res) {
        S.busy = false; save.disabled = false;
        if (res && res.success) { S.data = res; S.edit = null; keepTie(); render(); var s2 = S.el.querySelector('#cr-items .cr-say'); if (s2) s2.textContent = 'Saved.'; return; }
        say.textContent = (res && res.error) || 'That didn’t save. Try again.';
      });
    };
    return form;
  }
  function removeItem(it, btn) {
    btn.disabled = true;
    post({ op: 'remove', classKey: it.classKey, itemId: it.id }).then(function (res) {
      if (res && res.success) { S.data = res; keepTie(); render(); return; }
      btn.disabled = false;
      var say = S.el.querySelector('#cr-items .cr-say'); if (say) say.textContent = (res && res.error) || 'That didn’t save. Try again.';
    });
  }
  // the photo, at most 1600 px on its longer side, as JPEG ~0.8 -> base64 (no data: prefix)
  function shrink(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var s = shrinkSize(img.naturalWidth, img.naturalHeight, MAX_SIDE), cv = document.createElement('canvas');
        cv.width = s.w; cv.height = s.h;
        cv.getContext('2d').drawImage(img, 0, 0, s.w, s.h);
        URL.revokeObjectURL(url);
        resolve(cv.toDataURL('image/jpeg', QUALITY).replace(/^data:[^,]*,/, ''));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('image')); };
      img.src = url;
    });
  }

  // ── hash routes ──
  function applyOpen() {
    var part = S.pending;
    if (!part || !S.data || S.el.hidden) return;
    S.pending = null;
    if (part === 'classroom-students' && S.tie && S.studentsFor !== classKey(S.tie)) { S.studentsFor = classKey(S.tie); render(); }
    var target = part === 'classroom-items' ? S.el.querySelector('#cr-items') : part === 'classroom-students' ? S.el.querySelector('#cr-students') : null;
    (target || S.el).scrollIntoView({ block: 'start' });
    var f = part === 'classroom-items' ? S.el.querySelector('#cr-name') : S.el.querySelector('#crHead');
    if (f) { if (!f.hasAttribute('tabindex') && f.tagName === 'H2') f.tabIndex = -1; f.focus({ preventScroll: true }); }
  }

  api.mount = function (el, o) {
    S.el = el; S.o = o || {};
    el.hidden = true;
    el.classList.add('cr');
    if (!S.o.backendUrl || !S.o.session) return;
    get('action=classroomget').then(function (d) {
      if (!d || d.success !== true) {
        if (d && d.code === 'CLASSROOM_NOT_YOURS') return;
        if (S.o.hideWithoutTies) return;
        clear(el); el.appendChild(h('h2', { class: 'gb-h2', id: 'crHead' }, 'My class'));
        el.appendChild(h('div', { class: 'gb-alert gb-alert-err', role: 'alert' }, h('p', {}, (d && d.error) || 'Your class couldn’t be loaded just now. Try again later.')));
        el.hidden = false; return;
      }
      if (S.o.hideWithoutTies && !d.ties.length) return;
      S.data = d; S.tie = d.ties[0] || null;
      render(); el.hidden = false; applyOpen();
    });
  };
  api.open = function (part) { S.pending = part; if (S.data) applyOpen(); };
  return api;
})();
if (typeof module !== 'undefined') module.exports = LMCSClassroom;
