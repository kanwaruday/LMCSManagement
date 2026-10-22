// Shared quick appointment box: LMCSAppts.mount(el, {backendUrl, session}). Needs no page globals.
// Shows what is waiting (To accept / My proposals); the element stays empty when there is nothing.
var LMCSAppts = (function () {
  var KIND = { interview: 'Interview', demo: 'Demo', md: 'MD Academics interview' };
  function esc_(v) {
    return String(v === undefined || v === null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function when_(iso) {
    var d = new Date(iso);
    return isNaN(d) ? String(iso || '') : d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }
  function head_(a) {
    return '<b>' + esc_(a.name) + '</b> · ' + esc_(KIND[a.kind] || a.kind) + (a.campus ? ' · ' + esc_(a.campus) : '') +
      '<div class="ap-when">' + esc_(when_(a.start)) + (a.durationMin ? ' (' + esc_(a.durationMin) + ' min)' : '') + (a.place ? ' · ' + esc_(a.place) : '') + '</div>' +
      (a.note ? '<div class="ap-sub">' + esc_(a.note) + '</div>' : '');
  }
  function retry_(a) {
    return '<div class="ap-sub">Calendar not updated — <button type="button" class="ap-link" data-act="retry" data-id="' + esc_(a.id) + '">Retry</button></div>';
  }
  // email / campusId = the viewer's. Retry (as apptCalendarRetry_ allows) for the acceptor -- an Owner override's
  // decidedBy ends " (override)" -- and, on a migrated booking (decidedBy 'migration'), for a Principal covering its
  // campus only: it lands on the retrier's calendar. Never a FeeClerk-only viewer.
  function renderHtml_(data, role, email, campusId) {
    data = data || {};
    var acc = role === 'FeeClerk' ? [] : (data.toAccept || []), mine = data.myProposals || [];
    var me = String(email || '').toLowerCase();
    var list = function (v) { return String(v || '').split(',').map(function (r) { return r.trim(); }); };
    var principal = list(role).indexOf('Principal') !== -1, campuses = list(campusId).map(function (c) { return c.toUpperCase(); });
    var retries = role === 'FeeClerk' || !me ? [] : (data.upcoming || []).filter(function (a) {
      if (a.status !== 'accepted' || a.calendarMode !== 'none') return false;
      var by = String(a.decidedBy || '').replace(/\s*\(override\)$/, '').toLowerCase();
      if (by === 'migration') return principal && (campuses.indexOf('ALL') !== -1 || campuses.indexOf(String(a.campus || '').toUpperCase()) !== -1);
      return by === me;
    });
    var out = '';
    if (acc.length) {
      out += '<h3>To accept</h3>' + acc.map(function (a) {
        return '<div class="ap-card" data-id="' + esc_(a.id) + '">' + head_(a) +
          '<div class="ap-actions"><button type="button" class="ap-btn" data-act="accept" data-id="' + esc_(a.id) + '">Accept</button> ' +
          '<button type="button" class="ap-btn ap-alt" data-act="decline" data-id="' + esc_(a.id) + '">Decline</button></div>' +
          '<div class="ap-decline" hidden><textarea class="ap-note" rows="2" maxlength="300" placeholder="Reason (required)" aria-label="Reason for declining"></textarea>' +
          '<button type="button" class="ap-btn" data-act="send-decline" data-id="' + esc_(a.id) + '">Send decline</button></div></div>';
      }).join('');
    }
    if (mine.length) {
      out += '<h3>My proposals</h3>' + mine.map(function (a) {
        return '<div class="ap-card">' + head_(a) + '<span class="ap-chip ap-' + esc_(a.status) + '">' + esc_(a.status) + '</span>' +
          (a.status === 'declined' && a.declineNote ? ' <span class="ap-sub">“' + esc_(a.declineNote) + '”</span>' : '') + '</div>';
      }).join('');
    }
    if (retries.length) out += '<h3>Calendar</h3>' + retries.map(function (a) { return '<div class="ap-card">' + head_(a) + retry_(a) + '</div>'; }).join('');
    return out;
  }
  var CSS = '.ap-box h3{margin:12px 0 6px;font-size:15px}.ap-card{border:1px solid #ddd;border-radius:6px;padding:10px 12px;margin:0 0 8px;background:#fff}' +
    '.ap-when{color:#555;font-size:14px}.ap-sub{color:#555;font-size:13px;margin-top:4px}.ap-actions{margin-top:8px}' +
    '.ap-btn{background:#ce0000;color:#fff;border:0;border-radius:6px;padding:8px 14px;font:inherit;cursor:pointer;min-height:36px}.ap-btn.ap-alt{background:#fff;color:#ce0000;border:1px solid #ce0000}' +
    '.ap-btn:disabled{opacity:.5}.ap-decline{margin-top:8px}.ap-note{display:block;width:100%;box-sizing:border-box;margin-bottom:6px;font:inherit;padding:6px}' +
    '.ap-chip{display:inline-block;border-radius:10px;padding:2px 10px;font-size:12px;background:#f5f5f5;color:#555}.ap-accepted{background:#e6f6ec;color:#1a7f3c}.ap-declined{background:#fde8e8;color:#a70000}.ap-proposed{background:#fdf1de;color:#b45f06}' +
    '.ap-link{background:none;border:0;color:#ce0000;text-decoration:underline;cursor:pointer;font:inherit;padding:0}.ap-err{color:#a70000;font-size:13px;margin:6px 0}';
  function mount(el, opts) {
    var session = opts.session || {}, role = String(session.role || '').split(',').map(function (r) { return r.trim(); }).indexOf('FeeClerk') !== -1 &&
      !/Principal|Owner|Coordinator/.test(session.role) ? 'FeeClerk' : String(session.role || '');
    function post_(action, body) {
      return fetch(opts.backendUrl, { method: 'POST', body: JSON.stringify(Object.assign({ action: action, idToken: session.idToken }, body)) }).then(function (r) { return r.json(); });
    }
    function show_(data) {
      var h = renderHtml_(data, role, session.email, session.campusId);
      el.innerHTML = h ? '<style>' + CSS + '</style><section class="ap-box">' + h + '<div class="ap-err" role="alert"></div></section>' : '';
    }
    function err_(card, m) { var e = (card || el).querySelector('.ap-err') || el.querySelector('.ap-err'); if (e) e.textContent = m; }
    function load_() {
      return fetch(opts.backendUrl + '?action=apptlist&idToken=' + encodeURIComponent(session.idToken), { cache: 'no-store' })
        .then(function (r) { return r.json(); }).then(function (d) { show_(d && d.success ? d : null); }).catch(function () { show_(null); });
    }
    if (el.__apptBound) el.removeEventListener('click', el.__apptBound);
    el.__apptBound = function (e) {
      var b = e.target.closest && e.target.closest('[data-act]'); if (!b) return;
      var act = b.getAttribute('data-act'), id = b.getAttribute('data-id'), card = b.closest('.ap-card');
      if (act === 'decline') { card.querySelector('.ap-decline').hidden = false; card.querySelector('.ap-note').focus(); return; }
      var call;
      if (act === 'accept') call = post_('apptdecide', { id: id, decision: 'accept', note: '' });
      else if (act === 'retry') call = post_('apptcalendarretry', { id: id });
      else if (act === 'send-decline') {
        var note = card.querySelector('.ap-note').value.trim();
        if (!note) { err_(el, 'Write a short reason to decline.'); return; }
        call = post_('apptdecide', { id: id, decision: 'decline', note: note });
      } else return;
      b.disabled = true;
      call.then(function (d) { if (d && d.success === false) { b.disabled = false; err_(el, d.error || 'Could not save'); } else load_(); })
        .catch(function () { b.disabled = false; err_(el, 'Network error — try again.'); });
    };
    el.addEventListener('click', el.__apptBound);
    return load_();
  }
  return { mount: mount, renderHtml_: renderHtml_ };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = LMCSAppts;
