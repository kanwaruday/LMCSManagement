// Office shell: sign-in gate, header (sync indicator, campus, sign-out), outbox flushing, service worker.
import { createApi } from './api.js';
import { createOutbox } from './outbox.js';
import { createIdbStore } from './idb-store.js';
import { createAttentionPanel } from './attention.js';
import { OFFICE_BACKEND_URL } from './config.js';

const CAMPUSES = ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6', 'HES'];
const CAMPUS_KEY = 'lmcs-office-campus';
export const OFFICE_PICK_KEY = 'lmcs-office-campus1:'; // the Office's own pick; Daily Reporting keeps lmcs-campus1:
const CACHE_PREFIX = 'lmcs-office-cache:';

export function syncLabel({ waiting = 0, attention = 0, others = 0, online = true }) {
  const tail = others > 0 ? ' · ' + others + ' from another user' : ''; // queued here by someone else (R38)
  if (attention > 0) return attention + ' need attention' + tail;
  if (!online) return 'Offline' + tail;
  if (waiting > 0) return waiting + ' waiting' + tail;
  return 'All synced' + tail;
}
// Anything still in the outbox (waiting or needing attention) would be lost on sign-out.
export const canSignOut = ({ waiting = 0, attention = 0 }) => waiting + attention === 0;
// Sign-out deletes only the signed-in user's queued entries; other people's stay for them (R38).
// -> {ids: entries to delete, waiting, attention, kept: entries of other users left on the device}.
export function signOutPlan(entries, owned) {
  const mine = (entries || []).filter(owned);
  return { ids: mine.map((e) => e.id), waiting: mine.filter((e) => e.status === 'waiting').length, attention: mine.filter((e) => e.status === 'attention').length, kept: (entries || []).length - mine.length };
}

// R42: the page's user is the session it booted with, captured once. auth.js drops the stored session when the
// Google token lapses (~1 h), but entries queued meanwhile still belong to this user. A change of user in this tab
// always reloads (sign-out / "Sign in again" both reload); a sign-in in another tab is caught by the storage event
// (otherUserSignedIn -> reload). token() refuses any token but this user's, so no entry goes out under someone else.
export function pageUser(L, session0) {
  const email = String((session0 && session0.email) || '').toLowerCase() || null;
  const emailOf = (s) => String((s && s.email) || '').toLowerCase();
  return {
    who: () => email,
    token: async () => { const s = L.getSession(); if (!s || !s.idToken || emailOf(s) !== email) throw new Error('Not signed in'); return s.idToken; },
    otherUserSignedIn: (ev) => {
      if (!ev || ev.key !== 'lmcs_session' || !ev.newValue) return false;
      try { return emailOf(JSON.parse(ev.newValue)) !== email; } catch (_) { return false; }
    },
  };
}

// Read cache (last good answer per key) so screens still show something offline. localStorage may throw.
export function cacheGet(key) { try { return JSON.parse(localStorage.getItem(CACHE_PREFIX + key)); } catch (_) { return null; } }
export function cacheSet(key, value) { try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value)); } catch (_) {} }
function cacheClear() {
  try { Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX)).forEach((k) => localStorage.removeItem(k)); } catch (_) {}
}

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The one campus every data call of this page uses. Scope comes from the session only: a Fee Clerk or a comma list never gets a
// campus outside its list (the first one in LMS1..HES order, so it matches the picker's scope; none valid -> '' and the backend refuses).
// ALL: the header picker's single-select choice (lmcs-office-campus1:<email>), else the old lmcs-office-campus key (copied across once), else LMS1.
export function pickCampus(session, ls) {
  const ids = String(session.campusId || '').split(',').map((x) => x.trim().toUpperCase());
  if (!ids.includes('ALL')) return CAMPUSES.find((c) => ids.includes(c)) || '';
  const key = OFFICE_PICK_KEY + (session.email || '');
  try {
    const store = ls || localStorage;
    try { const o = JSON.parse(store.getItem(key)); const c = o && o.v === 1 && o.sel && o.sel[0]; if (CAMPUSES.includes(c)) return c; } catch (_) {}
    const old = store.getItem(CAMPUS_KEY);
    if (CAMPUSES.includes(old)) { store.setItem(key, JSON.stringify({ v: 1, sel: [old] })); return old; }
  } catch (_) {}
  return 'LMS1'; // pilot default
}

// onReady(session, api, outbox): session.campus is the campus all data calls must use.
export async function bootOffice({ onReady }) {
  const $ = (id) => document.getElementById(id);
  const L = window.LMCS;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});

  // Gate (cached session shows the app at once, like the other portals).
  const session0 = L.getSession() || await L.requireSession('#gate-slot');
  const session = { ...session0, campus: pickCampus(session0) };
  $('auth-root').style.display = 'none';
  $('app-root').style.display = '';
  if (!session.campus) { // no school in the sign-in: nothing may be queued with a blank campus
    $('who').textContent = session.name || '';
    $('signout-link').onclick = (e) => { e.preventDefault(); L.signOut(); };
    $('today').innerHTML = '<p><b>' + esc("Your sign-in doesn't include a school for the Office pages. Ask the Owner to check your access.") + '</b></p>';
    return;
  }

  if (!OFFICE_BACKEND_URL) {
    $('who').textContent = session.name;
    $('signout-link').onclick = (e) => { e.preventDefault(); L.signOut(); };
    $('today').innerHTML = '<p><b>Backend not configured.</b> The Fee Clerk + PRO service has not been connected yet.</p>';
    return;
  }

  const user = pageUser(L, session0);
  window.addEventListener('storage', (ev) => { if (user.otherUserSignedIn(ev)) location.reload(); });
  const api = createApi({
    fetch: (...a) => fetch(...a),
    getToken: user.token,
    backendUrl: OFFICE_BACKEND_URL,
  });
  const store = createIdbStore();
  let state = { waiting: 0, attention: 0, others: 0 };
  let panel = null; // set once the outbox exists
  const attLink = document.createElement('a');
  attLink.href = '#'; attLink.hidden = true;
  $('sync-indicator').after(attLink);
  const openAtt = (e) => { e.preventDefault(); if (state.attention + state.others > 0 && panel) panel.open(); };
  attLink.onclick = openAtt;
  $('sync-indicator').onclick = openAtt;
  const paint = (extra = {}) => {
    attLink.hidden = !(state.attention + state.others);
    attLink.textContent = state.attention ? 'Needs attention (' + state.attention + ')' : 'Other users\' entries (' + state.others + ')';
    $('sync-indicator').style.cursor = state.attention + state.others ? 'pointer' : '';
    if (panel) panel.refresh().catch(() => {});
    $('sync-indicator').textContent = syncLabel({ ...state, online: navigator.onLine });
    $('sync-indicator').dataset.state = state.attention ? 'attention' : state.waiting ? 'waiting' : 'ok';
    $('auth-notice').hidden = !extra.authRequired;
  };
  const outbox = createOutbox({
    store, api,
    who: user.who,
    onChange: (c) => { state = { waiting: c.waiting, attention: c.attention, others: c.others || 0 }; paint(c); if (c.authRequired) L.notifyAuthFailure(); },
  });
  panel = createAttentionPanel(outbox);
  $('auth-notice').after(panel.el);
  const refresh = async () => { state = await outbox.counts(); paint(); };

  $('who').textContent = session.name + ' · ' + L.campusLabel(session.campus);
  const sub = $('gb-sub'); if (sub) sub.textContent = (String(session.role || '').split(',')[0].trim() || 'Fee Clerk') + ' · ' + L.campusLabel(session.campus);
  if (session.campusId === 'ALL') { // Fee Clerks and comma lists never get a picker
    let ready = false;
    window.LMCSCampus.mount($('campus-pick'), { session, multi: false, hes: true, key: OFFICE_PICK_KEY, label: 'Campus', onChange: () => { if (ready) location.reload(); } });
    ready = true;
  }
  $('signout-link').onclick = async (e) => {
    e.preventDefault();
    const seen = await store.getAll(); // snapshot: only what the user is told about gets deleted
    const c = signOutPlan(seen, outbox.owned);
    const n = c.waiting + c.attention;
    const kept = c.kept ? ' ' + c.kept + ' entries queued here by another user are kept for them.' : '';
    const msg = (!canSignOut(c)
      ? n + ' of your entries are not yet synced (' + c.attention + ' need attention). Signing out will DELETE them, along with cached screens on this device. Sign out anyway?'
      : 'Sign out? Cached screens on this device will be cleared.') + kept;
    if (!confirm(msg)) return;
    const ids = new Set(seen.map((x) => x.id));
    if ((await store.getAll()).some((x) => !ids.has(x.id))) { alert('New entries arrived while this dialog was open. Nothing was deleted; please sign out again.'); return; }
    for (const id of c.ids) await store.delete(id);
    cacheClear();
    L.signOut();
  };

  const flush = () => outbox.flush().catch(() => {});
  window.addEventListener('online', () => { paint(); flush(); });
  window.addEventListener('offline', () => paint());
  setInterval(() => { if (document.visibilityState === 'visible') flush(); }, 60000);
  await refresh();
  flush();
  await onReady(session, api, outbox);
}
