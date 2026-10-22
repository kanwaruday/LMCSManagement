// Today screen: the clerk's day order from today.get, each task linking to its module screen.
import { cacheGet, cacheSet, esc } from './shell.js';
import { isoToDmy } from './format.js';

const LINKS = { report: 'report.html', deposits: 'deposits.html', close: 'close.html', daybook: 'daybook.html' };
const LABELS = { overdue: 'Overdue', due: 'Due', waiting: 'Waiting', done: 'Done' };

// '2026-10-21 18:00' -> '21/10/2026 18:00'; '2026-10-21' -> '21/10/2026'.
export const dueLabel = (due) => { const [d, time] = String(due || '').split(' '); return isoToDmy(d) + (time ? ' ' + time : ''); };

export function renderTasks(el, data, note = '') {
  el.innerHTML = '<h2>Today · ' + esc(isoToDmy(data.date)) + '</h2>' + (note ? '<p>' + esc(note) + '</p>' : '') +
    (data.tasks.length ? '<div class="modules">' + data.tasks.map((t) => {
      const href = LINKS[t.action];
      const title = href ? '<a href="' + href + '">' + esc(t.title) + '</a>' : esc(t.title);
      return '<div class="card"><div class="card-top"><h3>' + title + '</h3><span class="status ' + (t.status === 'done' ? 'live' : t.status === 'overdue' ? 'paused' : 'building') + '">' + LABELS[t.status] + '</span></div>' +
        '<p>Due ' + esc(dueLabel(t.due)) + '</p></div>';
    }).join('') + '</div>' : '<p>Nothing to do today.</p>');
}

export async function showToday(el, session, api) {
  const key = 'today:' + session.campus;
  const cached = cacheGet(key);
  if (cached) renderTasks(el, cached, 'Showing last saved list; refreshing…');
  else el.innerHTML = '<p>Loading…</p>';
  const r = await api.read('today.get', { campus: session.campus }, 'today');
  if (r.stale) return;
  if (r.success) { cacheSet(key, r); renderTasks(el, r); }
  else if (cached) renderTasks(el, cached, 'Offline or unavailable. Showing the last saved list.');
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
