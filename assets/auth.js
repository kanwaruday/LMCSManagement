/* LMCS Portal — shared session/auth module
   ============================================================
   One login for the whole portal. Every module page includes this
   file and calls LMCS.requireSession() instead of rolling its own
   Google Sign-In + session logic — that per-page duplication is
   what made the old repo hard to maintain.

   Session shape: { email, campusId, campusName, name, role, ts, expiresAt, idToken }
   campusId is either one of LMS1..LMS6 (locked to that campus) or
   'ALL' (network-wide — owner/MD/Head tier). Every module filters
   its data by this one field; there is no separate "owner mode".

   role (added 2026-08-29) is a SEPARATE dimension from campusId, for
   features that need "can this person write/manage" rather than "which
   campus can they see" -- e.g. adding/transferring staff. One of 'Owner'
   / 'Coordinator' / 'Principal' / 'Teacher', or '' if not set on the
   allowlist yet. Use LMCS.canManageStaff(session) rather than checking
   role directly, so the actual rule only lives in one place. */

window.LMCS = (function () {
  const GOOGLE_CLIENT_ID = '697999989724-mvi85iobr20g4mm8a8nrjd1rms2o8tf6.apps.googleusercontent.com';
  const SESSION_KEY = 'lmcs_session';

  // One source of truth for who can sign in and which campus they see --
  // the live "LMCS Principal Allowlist" sheet, via principal-allowlist.gs.
  // Merged 2026-09-23 (per Uday) into the same Apps Script project/
  // deployment as the Employee Roster Proxy and Staff Management API --
  // same URL as staff/add-employee.html's EMPLOYEE_ROSTER_URL/
  // STAFF_API_URL now, not a separate domain-restricted deployment
  // anymore (that trade-off -- the allowlist read is now reachable by
  // anyone with the URL, not just lms.org.in accounts, though writes
  // stay just as gated -- was Uday's explicit call; see
  // apps-script/principal-allowlist.gs's header for the full reasoning).
  // Action renamed 'list' -> 'allowlist_list' below since
  // staff-management-api.gs's own Directory action is also named 'list'
  // and the two are now in one shared action-namespace.
  const ALLOWLIST_API_URL = 'https://script.google.com/macros/s/AKfycbyHiaZY_iWK2VTKKFJcCsBNnIbUndJYUSjnPkxvJ-dYavaihiul2xBJuJohPRsP9Spf/exec';

  const CAMPUS_NAMES = {
    LMS1: 'LMS 1 — Dhalpur',
    LMS2: 'LMS 2 — Kelheli',
    LMS3: 'LMS 3 — Dunkhra',
    LMS4: 'LMS 4 — Ner Chowk',
    LMS5: 'LMS 5 — Sayoli',
    LMS6: 'LMS 6 — Jogindernagar',
    HES: 'HES — Head Office', // added 2026-09-23 per Uday -- Coordinator/Owner-only, see staff/add-employee.html
    ALL: 'All Campuses (Network-wide)',
  };

  function nextSixPM(fromTime) {
    const d = new Date(fromTime);
    d.setHours(18, 0, 0, 0);
    if (d.getTime() <= fromTime) d.setDate(d.getDate() + 1);
    return d.getTime();
  }

  function decodeJwtPayload(token) {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(atob(base64).split('').map((c) =>
      '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
    return JSON.parse(json);
  }

  // The app-level `expiresAt` (next 6PM) is a ceiling on how long we'll
  // trust a cached session WITHOUT re-checking -- it is NOT how long the
  // actual Google idToken inside it is valid for. Google ID tokens carry
  // their own 'exp' claim and are typically only good for about an hour
  // regardless of what the app thinks. Bug found 2026-09-07: a principal
  // signed in in the morning had a page that believed it was authenticated
  // until 6PM while every backend call was silently failing "Not
  // authorized" from ~an hour after sign-in onward -- fetch handlers just
  // console.warn + return [] on that, so cards (e.g. Activities of the
  // Month) looked "genuinely empty" with zero visible error. Fix: treat
  // whichever expiry is SOONER as the real one.
  function jwtExpiredMs_(idToken) {
    try {
      const exp = decodeJwtPayload(idToken).exp;
      return exp ? exp * 1000 : null;
    } catch (_) {
      return null; // malformed/missing token -- let the app-level check decide
    }
  }

  function isSessionExpired(s) {
    if (!s || !s.expiresAt) return true;
    if (Date.now() >= s.expiresAt) return true;
    if (s.idToken) {
      const jwtExp = jwtExpiredMs_(s.idToken);
      if (jwtExp && Date.now() >= jwtExp) return true;
    }
    return false;
  }

  // Shown when the cached session's Google idToken has actually expired
  // (caught either by the periodic watch below, or by a page explicitly
  // reporting a "Not authorized" backend response). Deliberately does NOT
  // auto-reload -- a principal could be mid-way through an unsaved Daily
  // Report, and silently wiping that would be worse than the stale-data
  // bug this replaces. Instead: a persistent, un-missable banner with a
  // manual "Sign in again" action, safe to call repeatedly (no duplicate
  // banners).
  function notifyAuthFailure() {
    if (document.getElementById('lmcs-auth-expired-banner')) return;
    const bar = document.createElement('div');
    bar.id = 'lmcs-auth-expired-banner';
    bar.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:99999;' +
      'background:#B00020;color:#fff;font:600 14px/1.4 system-ui,sans-serif;' +
      'padding:10px 16px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.25);';
    bar.innerHTML =
      'Your sign-in has expired, so this page has stopped receiving fresh data. ' +
      '<button id="lmcs-auth-expired-btn" style="margin-left:10px;background:#fff;color:#B00020;' +
      'border:none;border-radius:4px;padding:4px 12px;font:700 13px/1 system-ui,sans-serif;cursor:pointer;">' +
      'Sign in again</button>';
    document.body.appendChild(bar);
    document.getElementById('lmcs-auth-expired-btn').onclick = signOut;
  }

  // Started once per page, right after requireSession() first resolves.
  // Catches the token dying WHILE the tab stays open (the actual bug) --
  // without this, the improved isSessionExpired() above only helps on the
  // next full page load/reload, which could be hours away.
  let expiryWatchStarted = false;
  function startExpiryWatch_() {
    if (expiryWatchStarted) return;
    expiryWatchStarted = true;
    setInterval(function () {
      if (isSessionExpired(getSession())) notifyAuthFailure();
    }, 60 * 1000);
  }

  // Bug (2026-09-16): this used to fall back to a hardcoded snapshot of
  // the allowlist on any fetch failure -- that snapshot silently went
  // stale (5 people, vs. 15 on the real list) and anyone missing from it
  // got wrongly told "not on the access list", including already-signed-
  // in users getting kicked out mid-session by the SAME fetch backing
  // requireSession()'s re-validation. A failed fetch here now propagates
  // as a rejected promise instead of masquerading as real (but wrong)
  // data -- see the two call sites below for how each one responds to
  // that: fail OPEN for an existing session (don't punish a valid user
  // for a network blip), fail with an honest "couldn't verify, try
  // again" message for a brand-new sign-in (never silently grant OR deny
  // access based on data we know is incomplete).
  let allowlistPromise = null;
  function loadAllowlist() {
    if (allowlistPromise) return allowlistPromise;
    allowlistPromise = fetch(ALLOWLIST_API_URL + '?action=allowlist_list', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        if (!data.success || !Array.isArray(data.entries)) throw new Error('bad response');
        const map = {};
        data.entries.forEach((e) => {
          map[e.email.toLowerCase()] = { campusId: e.campusId, name: e.name, role: e.role || '' };
        });
        return map;
      })
      .catch((err) => {
        console.warn('LMCS auth: live allowlist fetch failed.', err);
        allowlistPromise = null; // don't cache the failure -- let the next call retry
        throw err;
      });
    return allowlistPromise;
  }

  function getSession() {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (isSessionExpired(s)) { localStorage.removeItem(SESSION_KEY); return null; }
      return s;
    } catch (_) {
      return null;
    }
  }

  function setSession(s) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  }

  function signOut() {
    localStorage.removeItem(SESSION_KEY);
    if (window.__lmcsClearFetchCache) window.__lmcsClearFetchCache(); // cached data belongs to the signed-out user
    window.location.reload();
  }

  function campusLabel(campusId) {
    return CAMPUS_NAMES[campusId] || campusId;
  }

  // Multi-role (2026-09-19, per Uday): session.role can hold a
  // comma-separated list (e.g. "Coordinator,Teacher") for someone who
  // genuinely needs both a management role's access and their own
  // personal Teacher-Portal self-service. hasRole() is the one place
  // that parses it -- every permission check below (and any future
  // caller, including other module pages) should use this instead of
  // comparing session.role directly. A single-role session like
  // "Teacher" parses to a 1-element list, so nothing existing changes.
  function hasRole(session, role) {
    if (!session || !session.role) return false;
    return String(session.role).split(',').map(function (r) { return r.trim(); }).indexOf(role) !== -1;
  }

  // Single source of truth for "can this session add/transfer/deactivate
  // staff" -- Owner (campusId ALL) or a Coordinator, always scoped to
  // their own locked campus for Coordinators (callers still need to check
  // session.campusId when acting, this only answers the yes/no).
  function canManageStaff(session) {
    if (!session) return false;
    return session.campusId === 'ALL' || hasRole(session, 'Coordinator') || hasRole(session, 'Owner');
  }

  // "Can this session view the Teacher SS (Support Session, formerly
  // "DR"/Daily Report -- renamed 2026-09-02) dashboard" -- Owner (any
  // campus) or a Principal/Coordinator scoped to their own locked
  // campus. Teachers themselves don't get dashboard access -- only
  // people who receive/act on evaluation data, matching the same
  // Principal-and-above bar the Apps Script proxy re-checks server-side.
  function canViewTeacherSS(session) {
    if (!session) return false;
    return session.campusId === 'ALL' || hasRole(session, 'Principal') || hasRole(session, 'Coordinator') || hasRole(session, 'Owner');
  }

  // Coordinator Portal (coordinator/index.html): Owner or Coordinator only --
  // deliberately a separate name from canManageStaff even though the rule
  // matches today, so either can change without touching the other.
  function canViewCoordinatorPortal(session) {
    if (!session) return false;
    return session.campusId === 'ALL' || hasRole(session, 'Coordinator') || hasRole(session, 'Owner');
  }

  /**
   * Renders a Google Sign-In gate into `container` (an element or selector)
   * and resolves with the session once the visitor signs in successfully
   * (or immediately, if a valid session already exists). Denied sign-ins
   * show an inline message in the gate and never resolve.
   */
  function requireSession(container) {
    const el = typeof container === 'string' ? document.querySelector(container) : container;
    return new Promise((resolve) => {
      const existing = getSession();
      if (existing) {
        loadAllowlist().then((allowlist) => {
          // Re-validate the cached session is still on the live allowlist.
          if (allowlist[existing.email]) { startExpiryWatch_(); resolve(existing); return; }
          localStorage.removeItem(SESSION_KEY);
          renderGate();
        }).catch(() => {
          // Couldn't reach the allowlist to re-validate -- fail OPEN and
          // keep the existing session rather than signing someone out
          // over a transient fetch failure (see loadAllowlist()'s
          // comment for the incident this replaces).
          startExpiryWatch_();
          resolve(existing);
        });
        return;
      }
      renderGate();

      function renderGate() {
        el.innerHTML =
          '<div class="auth-gate">' +
          '<p>Sign in with your LMS Google account to continue.</p>' +
          '<div id="lmcs-g-signin"></div>' +
          '<div id="lmcs-auth-status"></div>' +
          '</div>';

        window.onGoogleSignIn = async function (response) {
          const payload = decodeJwtPayload(response.credential);
          const email = (payload.email || '').toLowerCase();
          const statusEl = document.getElementById('lmcs-auth-status');

          let allowlist;
          try {
            allowlist = await loadAllowlist();
          } catch (err) {
            // Never silently deny (or grant) access on data we know is
            // incomplete -- see loadAllowlist()'s comment.
            statusEl.innerHTML =
              '<div class="auth-denied">Couldn’t verify the access list right now (network or server issue) — please try again in a moment.</div>';
            return;
          }
          const match = allowlist[email];

          if (!match || !payload.email_verified) {
            statusEl.innerHTML =
              '<div class="auth-denied">This portal is only available to LMS staff on the access list. Signed in as <b>' +
              (payload.email || 'unknown') +
              '</b>, which isn’t on it yet. Contact the admin if this is wrong.</div>';
            return;
          }

          const now = Date.now();
          const session = {
            email,
            campusId: match.campusId,
            campusName: campusLabel(match.campusId),
            name: match.name,
            role: match.role || '',
            ts: now,
            expiresAt: nextSixPM(now),
            idToken: response.credential,
          };
          setSession(session);
          if (window.__lmcsClearFetchCache) window.__lmcsClearFetchCache(); // fresh login starts from clean data
          startExpiryWatch_();
          resolve(session);
          // Pages that reload after sign-in restart this on their next load;
          // pages that don't (the home screens) get it right away.
          if (window.LMCS && window.LMCS.warmUp) window.LMCS.warmUp(session);
        };

        function initButton() {
          google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: window.onGoogleSignIn,
            itp_support: true,
          });
          google.accounts.id.renderButton(
            document.getElementById('lmcs-g-signin'),
            { theme: 'outline', size: 'large', shape: 'pill' }
          );
        }

        if (window.google && window.google.accounts) {
          initButton();
        } else {
          const s = document.createElement('script');
          s.src = 'https://accounts.google.com/gsi/client';
          s.async = true;
          s.defer = true;
          s.onload = initButton;
          document.head.appendChild(s);
        }
      }
    });
  }

  return { requireSession, getSession, signOut, notifyAuthFailure, campusLabel, hasRole, canManageStaff, canViewTeacherSS, canViewCoordinatorPortal, CAMPUS_NAMES };
})();


/* ── Client-side fetch cache + post-login warm-up (2026-10-07) ─────────
   Why: every Apps Script call costs ~2s minimum and 10-20s on a server
   cache miss, and this is a multi-page site, so nothing in memory
   survives a click. Two layers, both transparent to the pages (they keep
   calling fetch() exactly as before; no page edits needed):

   1. fetch cache. window.fetch is wrapped for GET calls to Apps Script
      web apps whose ?action= is listed in CACHEABLE below. The response
      text is kept in localStorage, keyed by user + script + sorted query
      (idToken and the pages' `_=Date.now()` cache-busters are ignored).
        - fresh (age <= ttl): returned instantly, no network.
        - stale-but-allowed (rarely-changing data only, e.g. the roster):
          returned instantly AND refreshed in the background.
        - otherwise: network, then stored. Failures ({success:false}, e.g.
          "Not authorized") are never stored.
      Concurrent identical requests share one network call, so a page that
      asks for something the warm-up is already fetching just joins it.
      Any POST, or a GET whose action looks like a write, clears that
      script's entries (before AND after the call, plus an epoch guard so
      a read that started before the write can't store pre-write data).
      Sign-out and a fresh sign-in clear everything.
      Staleness trade-off: data another person changed can show up to
      `ttl` seconds late (60-120s for dashboards/approvals).

   2. warm-up. Shortly after load (so the page's own requests go first),
      and right after a fresh sign-in, the role's likely-needed reads are
      fetched two at a time and a small non-blocking chip shows progress.
      Entries that are still fresh are skipped, so page-hopping doesn't
      re-fetch. */
(function () {
  if (typeof window === 'undefined' || !window.fetch || !window.LMCS) return;
  const origFetch = window.fetch.bind(window);
  const PREFIX = 'lmcs_fc|';
  const MAX_ENTRY_CHARS = 400000;

  // The same deployed URLs the pages use (duplicated, like every page
  // already duplicates them) -- keys only match if these are identical.
  const ROSTER_URL = 'https://script.google.com/macros/s/AKfycbyHiaZY_iWK2VTKKFJcCsBNnIbUndJYUSjnPkxvJ-dYavaihiul2xBJuJohPRsP9Spf/exec';
  const PDR_URL = 'https://script.google.com/macros/s/AKfycbzpkFLy4KvTdSJfioz6wlgRGLjvO_GvbffhOYBb-hHybFtjGTk0ps-GzXz0FrQ9GmYdfg/exec';

  // action -> ttl (fresh seconds), stale (extra seconds it may be served
  // while a background refresh runs; omit for volatile data).
  const CACHEABLE = {
    employees:          { ttl: 600,  stale: 21600 },
    roster:             { ttl: 600,  stale: 21600 },
    approvalreferees:   { ttl: 600,  stale: 3600 },
    monthactivities:    { ttl: 600,  stale: 3600 },
    myemployeecode:     { ttl: 3600, stale: 86400 },
    ssdashboard:        { ttl: 90 },
    approvalslist:      { ttl: 60 },
    approvaldetail:     { ttl: 60 },
    hiringapplicants:   { ttl: 90 },
    hiringapprovalstatus: { ttl: 90 },
    principaldrload:    { ttl: 120 },
    plannedactivities:  { ttl: 120 },
    myssstats:          { ttl: 120 },
    myupcomingevents:   { ttl: 120 },
    myrankscore:        { ttl: 120 },
  };
  // GET actions that change data (staff + allowlist writes are GETs).
  // Over-matching only costs an extra cache clear, never stale data.
  const WRITE_GET = /^(addnewhire|transfer|markinactive|allowlist_(add|edit|delete)|(add|update|save|set|mark|delete|submit|resolve|reassign|autoresolve|decide|import|apply|issue|settle|lock|unlock|record|join|dismiss)\w*)$/i;

  const epochs = {};   // scriptId -> bumped on every write
  const inflight = {}; // storage key -> shared network promise

  function parseUrl(input) {
    try { return new URL(typeof input === 'string' ? input : (input && input.url) || String(input), location.href); }
    catch (_) { return null; }
  }
  function scriptId(u) {
    if (u.hostname !== 'script.google.com') return null;
    const m = u.pathname.match(/\/s\/([^/]+)\/exec/);
    return m ? m[1] : null;
  }
  function queryKey(u) {
    const p = [];
    u.searchParams.forEach(function (v, k) { if (k !== 'idToken' && k !== '_') p.push(k + '=' + v); });
    p.sort();
    return p.join('&');
  }
  function userEmail() {
    try { return (JSON.parse(localStorage.getItem('lmcs_session')) || {}).email || null; } catch (_) { return null; }
  }
  function storageKey(email, sid, u) { return PREFIX + email + '|' + sid + '?' + queryKey(u); }

  function readEntry(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (_) { return null; }
  }
  function removeWhere(pred) {
    const doomed = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(PREFIX) === 0 && pred(k)) doomed.push(k);
      }
      doomed.forEach(function (k) { localStorage.removeItem(k); });
    } catch (_) { /* storage unavailable -- nothing cached, nothing to clear */ }
  }
  function clearAll() { removeWhere(function () { return true; }); }
  function bust(sid) {
    epochs[sid] = (epochs[sid] || 0) + 1;
    removeWhere(function (k) { return k.indexOf('|' + sid + '?') !== -1; });
    Object.keys(inflight).forEach(function (k) { if (k.indexOf('|' + sid + '?') !== -1) delete inflight[k]; });
  }
  function storable(text) {
    if (text.length > MAX_ENTRY_CHARS) return false;
    try { const j = JSON.parse(text); return !!j && typeof j === 'object' && j.success !== false; } catch (_) { return false; }
  }
  function writeEntry(key, text) {
    try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), body: text })); }
    catch (_) { clearAll(); } // quota -- drop our entries rather than fight for space
  }
  function toResponse(text, status) {
    return new Response(text, { status: status || 200, headers: { 'Content-Type': 'application/json' } });
  }

  function network(key, sid, input, init) {
    if (inflight[key]) return inflight[key];
    const epoch = epochs[sid] || 0;
    const p = origFetch(input, init).then(function (res) {
      return res.text().then(function (text) {
        if (res.ok && storable(text) && (epochs[sid] || 0) === epoch) writeEntry(key, text);
        return { text: text, status: res.status };
      });
    });
    inflight[key] = p;
    const done = function () { if (inflight[key] === p) delete inflight[key]; };
    p.then(done, done);
    return p;
  }

  window.fetch = function (input, init) {
    const u = parseUrl(input);
    const sid = u && scriptId(u);
    if (!sid) return origFetch(input, init);
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    const action = u.searchParams.get('action') || '';
    if (method !== 'GET' || WRITE_GET.test(action)) {
      bust(sid);
      const clear = function () { bust(sid); };
      return origFetch(input, init).then(function (r) { clear(); return r; }, function (e) { clear(); throw e; });
    }
    const cfg = CACHEABLE[action];
    const email = userEmail();
    if (!cfg || !email) return origFetch(input, init);

    const key = storageKey(email, sid, u);
    const hit = init && init.cache === 'reload' ? null : readEntry(key);
    const age = hit ? (Date.now() - hit.t) / 1000 : Infinity;
    if (hit && age <= cfg.ttl) return Promise.resolve(toResponse(hit.body));
    if (hit && age <= cfg.ttl + (cfg.stale || 0)) {
      network(key, sid, input, init).catch(function () { /* background refresh failed -- keep serving what we have */ });
      return Promise.resolve(toResponse(hit.body));
    }
    return network(key, sid, input, init).then(function (r) { return toResponse(r.text, r.status); });
  };

  window.__lmcsClearFetchCache = clearAll;

  // ── warm-up ─────────────────────────────────────────────────────────
  function todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function warmTargets(s) {
    const L = window.LMCS, out = [];
    const add = function (label, base, query) { out.push({ label: label, url: base + '?action=' + query, tokenised: base === PDR_URL }); };
    add('Staff list', ROSTER_URL, 'employees');
    if (L.canViewTeacherSS(s)) {
      const campus = s.campusId === 'ALL' ? 'LMS1' : s.campusId; // Principal DR opens on the first school for network-wide sessions
      if (/^LMS[1-6]$/.test(campus)) {
        add("Today's report", PDR_URL, 'principaldrload&campusId=' + campus + '&date=' + todayISO());
        add('Calendar', PDR_URL, 'monthactivities&campusId=' + campus);
        add('Planned activities', PDR_URL, 'plannedactivities&campusId=' + campus);
      }
      add('Approvals', PDR_URL, 'approvalslist');
      add('Approval contacts', PDR_URL, 'approvalreferees');
      add('Support-session dashboard', PDR_URL, 'ssdashboard');
      add('Hiring pipeline', PDR_URL, 'hiringapplicants');
      add('Hiring approvals', PDR_URL, 'hiringapprovalstatus');
    }
    if (L.hasRole(s, 'Teacher')) {
      add('Your sessions', PDR_URL, 'myssstats');
      add('Upcoming events', PDR_URL, 'myupcomingevents');
      add('Your rank', PDR_URL, 'myrankscore');
      add('Your profile', PDR_URL, 'myemployeecode');
    }
    return out;
  }
  function isFresh(url, email) {
    const u = parseUrl(url), sid = u && scriptId(u), cfg = u && CACHEABLE[u.searchParams.get('action')];
    if (!sid || !cfg) return false;
    const hit = readEntry(storageKey(email, sid, u));
    return !!hit && (Date.now() - hit.t) / 1000 <= cfg.ttl;
  }

  function makeChip() {
    let el = null, bar = null, txt = null, timer = null;
    const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    function ensure() {
      if (el || !document.body) return !!el;
      el = document.createElement('div');
      el.id = 'lmcs-warm-chip';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      el.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9000;background:#1a1a1a;color:#fff;' +
        'font:600 12px/1.3 system-ui,sans-serif;padding:9px 12px 8px;border-radius:10px;min-width:200px;max-width:280px;' +
        'box-shadow:0 4px 14px rgba(0,0,0,.25);pointer-events:none;' + (calm ? '' : 'transition:opacity .25s;');
      txt = document.createElement('div');
      const track = document.createElement('div');
      track.style.cssText = 'height:3px;border-radius:2px;background:rgba(255,255,255,.2);margin-top:6px;overflow:hidden';
      bar = document.createElement('div');
      bar.style.cssText = 'height:100%;width:0;background:#e53935;' + (calm ? '' : 'transition:width .3s;');
      track.appendChild(bar); el.appendChild(txt); el.appendChild(track);
      document.body.appendChild(el);
      return true;
    }
    return {
      update: function (done, total) {
        if (!ensure()) return;
        clearTimeout(timer);
        el.style.opacity = '1';
        txt.textContent = 'Getting things ready… ' + done + ' of ' + total;
        bar.style.width = Math.round((done / total) * 100) + '%';
      },
      finish: function (done, total, labelsFailed) {
        if (!ensure()) return;
        bar.style.width = '100%';
        const names = labelsFailed.length > 2 ? labelsFailed.slice(0, 2).join(', ') + ' +' + (labelsFailed.length - 2) + ' more' : labelsFailed.join(', ');
        txt.textContent = labelsFailed.length
          ? done + ' of ' + total + ' ready — ' + names + ' will load when you open it'
          : 'All set ✓';
        timer = setTimeout(function () {
          el.style.opacity = '0';
          setTimeout(function () { if (el && el.parentNode) el.parentNode.removeChild(el); el = null; }, 300);
        }, labelsFailed.length ? 4500 : 1500);
      },
    };
  }

  let warming = false;
  async function warmUp(session) {
    if (warming || !session || !session.email) return;
    try {
      if (navigator.connection && navigator.connection.saveData) return;
      const todo = warmTargets(session).filter(function (t) { return !isFresh(t.url, session.email); });
      if (!todo.length) return;
      warming = true;
      const chip = makeChip(), failed = [];
      let done = 0, i = 0;
      chip.update(0, todo.length);
      const worker = async function () {
        while (i < todo.length) {
          const t = todo[i++];
          try {
            // 'reload' skips our own cache read so this always refreshes, and
            // routes through the wrapper so the result is stored + shared.
            const res = await window.fetch(t.url + (t.tokenised ? '&idToken=' + encodeURIComponent(session.idToken) : ''), { cache: 'reload' });
            const j = await res.json();
            if (j && j.success === false) failed.push(t.label); else done++;
          } catch (_) { failed.push(t.label); }
          chip.update(done + failed.length, todo.length);
        }
      };
      await Promise.all([worker(), worker()]); // two at a time -- bursts make Apps Script throttle
      chip.finish(done, todo.length, failed);
    } catch (_) { /* warm-up is best-effort -- never let it break a page */ }
    finally { warming = false; }
  }
  window.LMCS.warmUp = warmUp;
  window.LMCS.clearCache = clearAll;

  function scheduleWarmUp() {
    const s = window.LMCS.getSession();
    if (!s) return;
    const go = function () { setTimeout(function () { warmUp(s); }, 1500); }; // let the page's own requests start first
    if (document.hidden) document.addEventListener('visibilitychange', function once() { if (!document.hidden) { document.removeEventListener('visibilitychange', once); go(); } });
    else go();
  }
  if (document.readyState === 'complete') scheduleWarmUp(); else window.addEventListener('load', scheduleWarmUp);
})();
