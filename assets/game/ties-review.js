// Teachers' class confirmations (the Principal home's Setup ground; principal/index.html). Read-only: each teacher's timetable tie
// (class, subject, section) as seeded into the ERP `assignments` tab, and where the teacher's "Confirm your classes and sections" quest
// stands (N1's erpread what=ties, game-erp.gs erpTiesReview_: this school only, staff names only, never a student).
// A supporting Principal gets the same read through the switch (gameSupportRead_); nothing here writes.
//   LMCSTiesReview.load(session, backendUrl) -> Promise<{ok, data|error}>
//   LMCSTiesReview.node(result, opts)        -> a fresh <section> (counts, then the list). opts.onApprove(row): when given, a corrected
//     row gets an "Approve correction" button (pending Uday's answer on whether a section correction waits for the Principal; not wired).
//   LMCSTiesReview.order(rows), counts(rows) (pure, tested)
var LMCSTiesReview = (function () {
  var STATES = [ // the order the list shows them: what needs the Principal's eye first
    { id: 'corrected', label: 'Corrected', hint: 'The teacher changed the class or section' },
    { id: 'pending', label: 'To check', hint: 'Not confirmed yet' },
    { id: 'fix', label: 'Fix in the sheet', hint: 'The ERP sheet row needs fixing first' },
    { id: 'notmine', label: 'Not my class', hint: 'The teacher says this is not theirs' },
    { id: 'confirmed', label: 'Confirmed', hint: '' }];
  var RANK = {}; STATES.forEach(function (s, i) { RANK[s.id] = i; });

  function counts(rows) {
    var c = { corrected: 0, pending: 0, fix: 0, notmine: 0, confirmed: 0 };
    (rows || []).forEach(function (r) { if (Object.prototype.hasOwnProperty.call(c, r.state)) c[r.state]++; });
    return c;
  }
  // by state (corrected first), then teacher, then class; unknown states last
  function order(rows) {
    return (rows || []).slice().sort(function (a, b) {
      var ra = RANK[a.state] === undefined ? 99 : RANK[a.state], rb = RANK[b.state] === undefined ? 99 : RANK[b.state];
      return ra - rb || String(a.teacher || '').localeCompare(String(b.teacher || '')) || String(a.class || '').localeCompare(String(b.class || ''), undefined, { numeric: true }); // Class 9 before Class 10
    });
  }
  function sectionText(r) {
    if (r.state === 'corrected') return (r.seededSection ? 'Sheet said ' + r.seededSection + ' → ' : '') + (r.section ? 'teacher says ' + r.section : 'teacher changed it') + (r.classCorrected ? ' (class changed)' : '');
    if (r.state === 'confirmed') return 'Section ' + (r.section || r.seededSection || '—');
    if (r.state === 'fix') return String(r.fix || 'The sheet row needs a teacher or a section');
    return r.seededSection ? 'Sheet says section ' + r.seededSection : '';
  }

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function load(session, backendUrl) {
    var campus = String((session && (session.campus || session.campusId)) || '').split(',')[0].trim().toUpperCase();
    if (!backendUrl || !/^LMS[1-6]$/.test(campus)) return Promise.resolve({ ok: false, error: '' });
    return fetch(backendUrl + '?action=erpread&what=ties&campus=' + campus + '&idToken=' + encodeURIComponent(session.idToken || ''), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) { return d && d.success ? { ok: true, data: d } : { ok: false, error: (d && d.error) || '' }; }, function () { return { ok: false, error: '' }; });
  }
  function node(result, opts) {
    opts = opts || {};
    var box = el('section', 'tr'), h = el('h3', 'tr-h', "Teachers' class confirmations");
    box.setAttribute('aria-label', "Teachers' class confirmations");
    box.appendChild(h);
    if (!result) { box.appendChild(el('p', 'gb-muted', 'Loading the confirmations…')); return box; }
    if (!result.ok) { box.appendChild(el('p', 'gb-muted', result.error || "The confirmations couldn't be loaded just now. Nothing is lost; try again later.")); return box; }
    var d = result.data, rows = d.rows || [];
    if (d.configured === false) { box.appendChild(el('p', 'gb-muted', "Your school's ERP sheet isn't connected yet, so there are no classes to confirm.")); return box; }
    if (!rows.length) { box.appendChild(el('p', 'gb-muted', 'No timetable classes are on the ERP sheet yet.')); return box; }
    var c = counts(rows), chips = el('ul', 'tr-counts');
    chips.setAttribute('aria-label', 'Counts');
    ['confirmed', 'corrected', 'pending', 'notmine', 'fix'].forEach(function (id) {
      var s = STATES[RANK[id]], li = el('li', 'tr-chip tr-' + id + (c[id] ? '' : ' is-zero'));
      li.appendChild(el('b', '', String(c[id]))); li.appendChild(el('span', '', s.label));
      chips.appendChild(li);
    });
    box.appendChild(chips);
    var list = el('ul', 'tr-list');
    order(rows).forEach(function (r) {
      var s = STATES[RANK[r.state]] || { label: String(r.state || '') }, li = el('li', 'tr-row tr-' + (r.state || 'x'));
      var top = el('div', 'tr-top');
      top.appendChild(el('b', 'tr-who', String(r.teacher || 'No teacher on the sheet')));
      top.appendChild(el('span', 'tr-state', s.label));
      li.appendChild(top);
      li.appendChild(el('span', 'tr-what', [r.class, r.subject].filter(Boolean).join(' · ')));
      var sec = sectionText(r); if (sec) li.appendChild(el('small', 'tr-sec', sec));
      if (r.state === 'corrected' && typeof opts.onApprove === 'function') { // only once Uday says corrections wait for the Principal
        var b = el('button', 'gb-btn tr-approve', 'Approve correction'); b.type = 'button';
        b.addEventListener('click', function () { opts.onApprove(r, b); });
        li.appendChild(b);
      }
      list.appendChild(li);
    });
    box.appendChild(list);
    box.appendChild(el('p', 'gb-muted tr-note', 'Each teacher confirms their own classes in their quests. Student names show to a teacher only for a confirmed class with its section.'));
    return box;
  }
  return { STATES: STATES, counts: counts, order: order, sectionText: sectionText, load: load, node: node };
})();
if (typeof module !== 'undefined') module.exports = LMCSTiesReview;
