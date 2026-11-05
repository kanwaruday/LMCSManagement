// ERP fee dues (V2 row 6): who still owes fees at the caller's own school, from the ERP read module (game backend, N1's
// game-erp.gs, erp-read-contract.md: GET action=erpread&what=dues). One window: the school total, a chip per class, the class's
// students by amount due, a name search. Read only; names and amounts only (no photos, no phones). The server scopes the
// answer: a Fee Clerk or Principal gets their own school (campus left out); the Owner, who may read every school, sends the
// school they're viewing as on the Principal home. Opens on #erp-dues (the game mission's go link) and, on the Office home,
// from its own card under the drivers card. Loaded as a module on office/index.html and principal/index.html.
// Each read opens the campus Sheet (no server cache), so it reads only when the window opens.
import { h, setKids } from './dom.js';
import { formatInr } from './format.js';
import { GAME_BACKEND_URL } from './config.js';

export const ACTION = 'erpread';
export const HASH = '#erp-dues';
const ROLES = ['FeeClerk', 'Principal'];

const rolesOf = (s) => String((s && s.role) || '').split(',').map((x) => x.trim());
// The Owner only while viewing a school as its Principal (they have no school of their own to default to)
export const canSeeDues = (s, as) => rolesOf(s).some((r) => ROLES.includes(r)) || (!!as && rolesOf(s).includes('Owner'));
// ERP amounts are whole rupees; formatInr takes paise
export const inr = (rupees) => formatInr(Math.round(Number(rupees) || 0) * 100).replace(/\.00$/, '');
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const classKey = (st) => [st.cls, st.section].filter(Boolean).join(' ');

// The server's answer -> { campus, configured, note, total, count, classes: [{key, count, total}], students } with only students
// who owe something. Totals are worked out here from the students, so the screen never disagrees with its own list.
export function normalize(r) {
  const students = ((r && r.rows) || [])
    .map((s) => ({ name: String(s.name || ''), enrollNo: String(s.enrollNo || ''), cls: String(s.class || ''), section: String(s.section || ''), due: Math.round(Number(s.pending) || 0) }))
    .filter((s) => s.due > 0 && s.name);
  const by = new Map();
  students.forEach((s) => { const k = classKey(s) || '—'; const c = by.get(k) || { key: k, count: 0, total: 0 }; c.count++; c.total += s.due; by.set(k, c); });
  const classes = [...by.values()].sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }));
  return { campus: String((r && r.campus) || ''), configured: !(r && r.configured === false), note: String((r && r.note) || ''), missing: ((r && r.missing) || []).includes('Dues'), total: students.reduce((t, s) => t + s.due, 0), count: students.length, classes, students };
}

// The students to list: one class (or all), names matching the search, largest due first, then by name.
export function pick(d, cls, query) {
  const q = String(query || '').trim().toLowerCase();
  return d.students.filter((s) => (!cls || (classKey(s) || '—') === cls) && (!q || s.name.toLowerCase().includes(q) || s.enrollNo.toLowerCase() === q))
    .sort((a, b) => b.due - a.due || a.name.localeCompare(b.name));
}

// The headline: not connected yet (the server's note), dues not sent yet, nothing due, or the total
export function summaryLine(d) {
  if (!d.configured) return d.note || 'ERP data for this school isn\'t connected yet.';
  if (d.missing) return 'Fee dues haven\'t come in from the ERP yet.';
  return d.count ? inr(d.total) + ' बकाया · due from ' + plural(d.count, 'student', 'students') : 'कोई बकाया नहीं · No fees due';
}
export const failLine = (r) => (r && r.error) || 'Could not load the fee dues. Try again.';

function viewAs() { try { const v = JSON.parse(sessionStorage.getItem('lmcs-view-as') || 'null'); return v && /^LMS[1-6]$/.test(v.campus) ? v.campus : ''; } catch (e) { return ''; } }
export const viewing = () => (typeof location !== 'undefined' && location.pathname.includes('/principal/') ? viewAs() : '');
// as: the school the Owner is viewing (sent as campus=, not asCampus: erpread isn't a view-as action, the Owner reads it as themself)
export const readUrl = (token, as) => GAME_BACKEND_URL + '?action=' + ACTION + '&what=dues&idToken=' + encodeURIComponent(token || '') + (as ? '&campus=' + as : '');
export async function load(session) {
  const url = readUrl(session.idToken, viewing());
  let r;
  try { r = await (await fetch(url, { cache: 'no-store' })).json(); } catch (e) { return { ok: false, line: 'No connection. Try again.' }; }
  return r && r.success ? { ok: true, d: normalize(r) } : { ok: false, line: failLine(r) };
}

const CSS = `
.erpd-card{display:block;width:100%;min-height:44px;text-align:left;font:inherit;cursor:pointer}
.erpd{width:min(560px,calc(100vw - 32px));max-height:calc(100dvh - 32px);padding:0;border:0;border-radius:12px;background:#fff;color:#1a1a1a}
.erpd::backdrop{background:rgba(0,0,0,.45)}
.erpd header{display:flex;align-items:center;gap:8px;padding:12px 12px 4px 16px}
.erpd h2{flex:1;margin:0;font-size:1.15rem}
.erpd .x{min-width:44px;min-height:44px;font-size:1.3rem;background:none;border:0;cursor:pointer}
.erpd .body{padding:0 16px 16px}
.erpd .sum{font-weight:600;margin:4px 0}.erpd .meta{color:#555;font-size:.85rem}
.erpd input{width:100%;min-height:44px;box-sizing:border-box;font:inherit;padding:0 10px;margin:8px 0}
.erpd .chips{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 8px}
.erpd .chips button{min-height:44px;padding:0 12px;border:1px solid #bbb;border-radius:22px;background:#f6f6f6;font:inherit;cursor:pointer}
.erpd .chips button[aria-pressed=true]{background:#1d4ed8;border-color:#1d4ed8;color:#fff}
.erpd ul{list-style:none;margin:0;padding:0}
.erpd li{display:flex;justify-content:space-between;gap:12px;min-height:44px;align-items:center;border-bottom:1px solid #eee}
.erpd li .amt{font-variant-numeric:tabular-nums;white-space:nowrap}
`;

// The window (built once per page). open() loads fresh each time it opens.
function makeWindow(getSession) {
  const style = h('style', {}, CSS);
  const status = h('p', { class: 'meta', role: 'status', 'aria-live': 'polite' });
  const sum = h('p', { class: 'sum' });
  const search = h('input', { type: 'search', placeholder: 'नाम खोजें · Search a name', 'aria-label': 'Search a student by name' });
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Classes' });
  const list = h('ul', { 'aria-label': 'Students with fees due' });
  const close = h('button', { type: 'button', class: 'x', 'aria-label': 'Close' }, '✕');
  const dlg = h('dialog', { class: 'erpd', 'aria-labelledby': 'erpd-h' },
    h('header', {}, h('h2', { id: 'erpd-h' }, 'फ़ीस बकाया · Fee dues'), close),
    h('div', { class: 'body' }, status, sum, search, chips, list));
  document.head.append(style);
  document.body.append(dlg);
  let d = null, cls = '';
  const shut = () => { dlg.close(); };
  close.onclick = shut;
  dlg.addEventListener('click', (e) => { if (e.target === dlg) shut(); }); // a tap on the backdrop
  dlg.addEventListener('close', () => { if (location.hash === HASH) history.replaceState(null, '', location.pathname + location.search); });

  function draw() {
    const rows = pick(d, cls, search.value);
    setKids(chips, d.classes.length > 1 ? [h('button', { type: 'button', 'aria-pressed': String(!cls), onclick: () => { cls = ''; draw(); } }, 'सभी · All')]
      .concat(d.classes.map((c) => h('button', { type: 'button', 'aria-pressed': String(cls === c.key), 'aria-label': c.key + ', ' + plural(c.count, 'student', 'students') + ', ' + inr(c.total),
        onclick: () => { cls = cls === c.key ? '' : c.key; draw(); } }, c.key + ' · ' + c.count))) : []);
    setKids(list, rows.map((s) => h('li', {}, h('span', {}, s.name, h('span', { class: 'meta' }, ' · ' + classKey(s))), h('span', { class: 'amt' }, inr(s.due)))));
    status.textContent = d.count && !rows.length ? 'No student matches.' : '';
  }
  search.oninput = () => draw();

  async function open() {
    const s = getSession();
    if (!s) return;
    if (!dlg.open) dlg.showModal();
    d = null; cls = ''; search.value = ''; search.hidden = true; setKids(chips); setKids(list); sum.textContent = '';
    status.textContent = 'Loading…';
    const r = await load(s);
    if (!r.ok) { status.textContent = r.line; return; }
    d = r.d; status.textContent = '';
    sum.textContent = summaryLine(d);
    search.hidden = d.count < 8; // a short list needs no search
    draw();
  }
  return { open };
}

// Boot: only for roles that may see dues. The Office home also gets a card; both pages open on #erp-dues.
function boot() {
  const getSession = () => (window.LMCS && window.LMCS.getSession && window.LMCS.getSession()) || null;
  let win = null;
  const open = () => { const s = getSession(); if (!canSeeDues(s, viewing())) return; (win = win || makeWindow(getSession)).open(); };
  window.addEventListener('hashchange', () => { if (location.hash === HASH) open(); });
  if (location.hash === HASH) open();
  const anchor = document.getElementById('drivers-card');
  if (anchor && canSeeDues(getSession(), '')) {
    const card = h('button', { type: 'button', class: 'hiring-banner erpd-card', onclick: open },
      h('b', {}, 'फ़ीस बकाया · Fee dues'), h('br'), 'Who still owes fees at your school, from the ERP.');
    anchor.after(card);
    if (!document.querySelector('style[data-erpd]')) document.head.append(h('style', { 'data-erpd': '' }, '.erpd-card{display:block;width:100%;min-height:44px;text-align:left;font:inherit;cursor:pointer}'));
  }
}
if (typeof window !== 'undefined' && typeof document !== 'undefined' && document.body) boot();
else if (typeof window !== 'undefined' && typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', boot);
