// Today screen: the clerk's day order from today.get, each task linking to its module screen.
import { cacheGet, cacheSet, esc } from './shell.js';
import { isoToDmy } from './format.js';
import { place } from './dom.js';

const LINKS = { report: 'report.html', deposits: 'deposits.html', close: 'close.html', daybook: 'daybook.html' };
const LABELS = { overdue: 'Overdue', due: 'Due', waiting: 'Waiting', done: 'Done' };

// '2026-10-21 18:00' -> '21/10/2026 18:00'; '2026-10-21' -> '21/10/2026'.
export const dueLabel = (due) => { const [d, time] = String(due || '').split(' '); return isoToDmy(d) + (time ? ' ' + time : ''); };

// who = {name, role, campus} paints the hub's greeting; without it only the list shows.
export function renderTasks(el, data, note = '', who = null) {
  const tasks = data.tasks || [], open = tasks.filter((t) => t.status !== 'done');
  const next = open.find((t) => t.status !== 'waiting' && LINKS[t.action]);
  const pct = tasks.length ? Math.round(100 * (tasks.length - open.length) / tasks.length) : 0;
  const hub = who ? '<div class="gb-hub"><div class="gb-hub-who"><div><h2 class="gb-h1">Hi, ' + esc(String(who.name || '').split(' ')[0] || 'there') + '</h2>' +
    '<span class="gb-hub-role">' + esc(who.role + ' · ' + who.campus) + '</span></div></div>' +
    '<div class="gb-hub-prog"><span class="gb-bar gb-bar-ok" role="progressbar" aria-label="Today\'s items done" aria-valuemin="0" aria-valuemax="' + tasks.length + '" aria-valuenow="' + (tasks.length - open.length) + '"><i style="width:' + pct + '%"></i></span>' +
    '<div class="gb-meta"><span>' + (tasks.length - open.length) + ' of ' + tasks.length + ' done today</span></div></div></div>' : '';
  const nextCard = '<div class="gb-next"><img src="../assets/game/buddy/winter-formal-neutral.webp" alt="" width="52" height="52"><div class="gb-next-b"><span class="gb-next-k">Your next step</span>' +
    (next ? '<p class="gb-next-t">' + esc(next.title) + '</p><a class="gb-btn gb-btn-primary" href="' + LINKS[next.action] + '">Go</a>'
      : '<p class="gb-next-t">' + (open.length ? 'The rest is waiting on someone else. Nothing for you right now.' : 'Everything for today is done. Thank you!') + '</p>') + '</div></div>';
  el.innerHTML = hub + (who ? nextCard : '') + '<h2>Today · ' + esc(isoToDmy(data.date)) + '</h2>' + (note ? '<p class="gb-note">' + esc(note) + '</p>' : '') +
    (tasks.length ? '<ul class="gb-missions">' + tasks.map((t) => {
      const href = LINKS[t.action], isNext = t === next;
      const cls = t.status === 'done' ? ' is-done' : isNext ? ' is-next' : t.status === 'waiting' ? ' is-wait' : '';
      const go = t.status !== 'done' && href ? '<a class="gb-btn' + (isNext ? ' gb-btn-primary' : '') + '" href="' + href + '" aria-label="Go: ' + esc(t.title) + '">Go</a>' : '';
      const sr = t.status === 'done' ? 'Done: ' : isNext ? 'Next: ' : t.status === 'waiting' ? 'Waiting: ' : 'Open: ';
      return '<li class="gb-mission' + cls + '"><span class="gb-mark" aria-hidden="true"></span><span class="gb-mission-t"><span class="gb-sr">' + sr + '</span>' + esc(t.title) +
        '<small>' + LABELS[t.status] + ' · due ' + esc(dueLabel(t.due)) + '</small></span>' + go + '</li>';
    }).join('') + '</ul>' : '<p class="gb-empty">Nothing to do today.</p>');
}

export async function showToday(el, session, api) {
  const key = 'today:' + session.campus;
  const who = { name: session.name, role: String(session.role || '').split(',')[0].trim() || 'Fee Clerk', campus: place(session.campus) };
  const cached = cacheGet(key);
  if (cached) renderTasks(el, cached, 'Showing last saved list; refreshing…', who);
  else el.innerHTML = '<p class="gb-muted">Loading…</p>';
  const r = await api.read('today.get', { campus: session.campus }, 'today');
  if (r.stale) return;
  if (r.success) { cacheSet(key, r); renderTasks(el, r, '', who); }
  else if (cached) renderTasks(el, cached, 'Offline or unavailable. Showing the last saved list.', who);
  else el.innerHTML = '<p>Could not load today\'s tasks: ' + esc(r.error || 'unknown error') + '</p>';
}

// Hiring legwork waiting for the Fee Clerk (the Principal decides; the clerk books slots and chases documents).
// Prefers the backend's legwork buckets (res.legwork); without them, derives the old two counts from the list.
export function hiringCounts(applicants, legwork) {
  if (legwork) return { needSlot: legwork.toSchedule || 0, waiting: legwork.waiting || 0, reports: legwork.reportsToUpload || 0, demos: legwork.demosToBook || 0, docs: legwork.documents || 0 };
  const list = applicants || [];
  return {
    needSlot: list.filter((a) => (a.status || '') === '' && !a.interviewAt).length,
    docs: list.filter((a) => a.status === 'Hiring Approved' && (a.docsMissing || []).length).length,
  };
}
export const hiringLabel = (c) => 'Hiring' + (c.needSlot ? ' · ' + c.needSlot + ' to schedule' : '') + (c.waiting ? ' · ' + c.waiting + ' awaiting a Principal' : '') +
  (c.reports ? ' · ' + c.reports + ' reports to upload' : '') + (c.demos ? ' · ' + c.demos + ' demos to book' : '') + (c.docs ? ' · ' + c.docs + ' documents to chase' : '');

// Puts the counts on the nav's Hiring link; silent when the backend cannot be reached or refuses (the link still works).
export async function showHiringCounts(link, fetchFn, url, token) {
  try {
    const r = await (await fetchFn(url + '?action=hiringapplicants&idToken=' + encodeURIComponent(token), { cache: 'no-store' })).json();
    if (r && r.success) link.textContent = hiringLabel(hiringCounts(r.applicants, r.legwork));
  } catch (e) { /* offline: leave the plain link */ }
}

// Live Buses link: how many fuel bills of this campus the GPS flagged and the clerk has not checked yet (Coordinator backend).
// Unchecked for 2 days, a bill goes to the Coordinator as a follow-up, so the banner says so.
export const busLabel = (n) => 'Live Buses' + (n ? ' · ' + n + ' fuel bill' + (n > 1 ? 's' : '') + ' to check' : '');
export async function showBusChecks(link, banner, fetchFn, url, token) {
  try {
    const r = await (await fetchFn(url + '?action=coordinatorbuschecks&idToken=' + encodeURIComponent(token), { cache: 'no-store' })).json();
    if (!r || !r.success) return;
    const n = r.checks.length;
    link.textContent = busLabel(n);
    if (banner && n) {
      banner.hidden = false;
      banner.innerHTML = '<b>' + n + ' fuel bill' + (n > 1 ? 's' : '') + ' to check against the pump slip.</b> Open <a href="buses.html">Live Buses</a> and answer each one. ' +
        'A bill not checked within 2 days goes to the Coordinator under your name.';
    }
  } catch (e) { /* offline: leave the plain link */ }
}
