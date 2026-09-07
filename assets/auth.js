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

  // Same live allowlist sheet principal-admin.html already writes to —
  // one source of truth for who can sign in and which campus they see.
  const ALLOWLIST_API_URL = 'https://script.google.com/a/macros/lms.org.in/s/AKfycbx9Lfe0bI6RgjaF2aJcgqmfbgGHsg65Ed-N4RA2_VpBmSxCMj389D6PYtgJq9K1qDqcqA/exec';

  const CAMPUS_NAMES = {
    LMS1: 'LMS 1 — Dhalpur',
    LMS2: 'LMS 2 — Kelheli',
    LMS3: 'LMS 3 — Dunkhra',
    LMS4: 'LMS 4 — Ner Chowk',
    LMS5: 'LMS 5 — Sayoli',
    LMS6: 'LMS 6 — Jogindernagar',
    ALL: 'All Campuses (Network-wide)',
  };

  // Stale snapshot, used only if the live allowlist fetch fails. role left
  // blank except for Uday (known) rather than guessed -- fails safe (no
  // staff-management permission) instead of fabricating someone's title.
  const FALLBACK_ALLOWLIST = {
    'nidhi.kant@lms.org.in':          { campusId: 'LMS1', name: 'Nidhi Kant', role: '' },
    'arti.sharma@lms.org.in':         { campusId: 'LMS2', name: 'Arti Sharma', role: '' },
    'suresh.prasher@lms.org.in':      { campusId: 'LMS3', name: 'Suresh Prasher', role: '' },
    'nisha.lms@lms.org.in':           { campusId: 'LMS4', name: 'Nisha', role: '' },
    'uday.kanwar@lms.org.in':         { campusId: 'ALL',  name: 'Uday Kanwar', role: 'Owner' },
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

  let allowlistPromise = null;
  function loadAllowlist() {
    if (allowlistPromise) return allowlistPromise;
    allowlistPromise = fetch(ALLOWLIST_API_URL + '?action=list', { cache: 'no-store' })
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
        console.warn('LMCS auth: live allowlist unavailable, using fallback snapshot.', err);
        return FALLBACK_ALLOWLIST;
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
    window.location.reload();
  }

  function campusLabel(campusId) {
    return CAMPUS_NAMES[campusId] || campusId;
  }

  // Single source of truth for "can this session add/transfer/deactivate
  // staff" -- Owner (campusId ALL) or a Coordinator, always scoped to
  // their own locked campus for Coordinators (callers still need to check
  // session.campusId when acting, this only answers the yes/no).
  function canManageStaff(session) {
    if (!session) return false;
    return session.campusId === 'ALL' || session.role === 'Coordinator' || session.role === 'Owner';
  }

  // "Can this session view the Teacher SS (Support Session, formerly
  // "DR"/Daily Report -- renamed 2026-09-02) dashboard" -- Owner (any
  // campus) or a Principal/Coordinator scoped to their own locked
  // campus. Teachers themselves don't get dashboard access -- only
  // people who receive/act on evaluation data, matching the same
  // Principal-and-above bar the Apps Script proxy re-checks server-side.
  function canViewTeacherSS(session) {
    if (!session) return false;
    return session.campusId === 'ALL' || session.role === 'Principal' || session.role === 'Coordinator' || session.role === 'Owner';
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
          const allowlist = await loadAllowlist();
          const payload = decodeJwtPayload(response.credential);
          const email = (payload.email || '').toLowerCase();
          const match = allowlist[email];
          const statusEl = document.getElementById('lmcs-auth-status');

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
          startExpiryWatch_();
          resolve(session);
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

  return { requireSession, getSession, signOut, notifyAuthFailure, campusLabel, canManageStaff, canViewTeacherSS, CAMPUS_NAMES };
})();
