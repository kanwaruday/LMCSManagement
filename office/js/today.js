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
