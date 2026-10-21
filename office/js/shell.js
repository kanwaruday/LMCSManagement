// Office shell: sign-in gate, header (sync indicator, campus, sign-out), outbox flushing, service worker.
import { createApi } from './api.js';
import { createOutbox } from './outbox.js';
import { createIdbStore } from './idb-store.js';
import { createAttentionPanel } from './attention.js';
import { OFFICE_BACKEND_URL } from './config.js';

const CAMPUSES = ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6', 'HES'];
const CAMPUS_KEY = 'lmcs-office-campus';
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

// Read cache (last good answer per key) so screens still show something offline. localStorage may throw.
export function cacheGet(key) { try { return JSON.parse(localStorage.getItem(CACHE_PREFIX + key)); } catch (_) { return null; } }
export function cacheSet(key, value) { try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value)); } catch (_) {} }
function cacheClear() {
  try { Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX)).forEach((k) => localStorage.removeItem(k)); } catch (_) {}
}

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function pickCampus(session) {
  if (session.campusId !== 'ALL') return session.campusId;
  try { const c = localStorage.getItem(CAMPUS_KEY); if (CAMPUSES.includes(c)) return c; } catch (_) {}
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

  if (!OFFICE_BACKEND_URL) {
    $('who').textContent = session.name;
    $('signout-link').onclick = (e) => { e.preventDefault(); L.signOut(); };
    $('today').innerHTML = '<p><b>Backend not configured.</b> The Fee Clerk + PRO service has not been connected yet.</p>';
    return;
  }

  const api = createApi({
    fetch: (...a) => fetch(...a),
    getToken: async () => { const s = L.getSession(); if (!s || !s.idToken) throw new Error('Not signed in'); return s.idToken; },
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
    who: () => { const s = L.getSession(); return s && s.email ? String(s.email).toLowerCase() : null; },
    onChange: (c) => { state = { waiting: c.waiting, attention: c.attention, others: c.others || 0 }; paint(c); if (c.authRequired) L.notifyAuthFailure(); },
  });
  panel = createAttentionPanel(outbox);
  $('auth-notice').after(panel.el);
  const refresh = async () => { state = await outbox.counts(); paint(); };

  $('who').textContent = session.name + ' · ' + L.campusLabel(session.campus);
  if (session.campusId === 'ALL') {
    const sel = $('campus-pick');
    sel.hidden = false;
    sel.innerHTML = CAMPUSES.map((c) => '<option value="' + c + '"' + (c === session.campus ? ' selected' : '') + '>' + esc(L.campusLabel(c)) + '</option>').join('');
    sel.onchange = () => { try { localStorage.setItem(CAMPUS_KEY, sel.value); } catch (_) {} location.reload(); };
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
