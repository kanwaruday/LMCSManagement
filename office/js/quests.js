// Setup quests first: a clerk (or the Fees & Accounts holder) opening office/ sees their open setup quests before the home.
// The quests come from the Game backend (gametoday, peek: no writes); this file only orders and paints them.
import { cacheGet, cacheSet, esc } from './shell.js';

const KEY = 'setup-quests:'; // + the email: a shared phone never shows one person's quests to another
let skipped = false; // "See all tools" holds for this visit, even when the refresh lands after it
const SETUP = (q) => /^daybook-(setup:|accountant$)/.test(String(q.questId || ''));
const rank = (q) => (/^daybook-setup:/.test(q.questId) ? 0 : q.questId === 'daybook-accountant' ? 1 : 2);
// a gametoday step's go ('office/starting-data.html?campus=LMS1&quest=cash') -> a link from office/, or null for anything else
const href = (go) => (/^[\w-]+(\/[\w.-]+)*(\?[\w=&%.-]*)?$/.test(String(go || '')) ? '../' + go : null);

// gametoday's quests -> the open ones in play order (Starting data first, then the Accountant's, then the rest), or [] when
// no setup quest is open: then the home shows as before. Parallel quests (the Owner's per-school list) are left out.
export function setupQuests(quests) {
  const open = (quests || []).filter((q) => q && !q.complete && !q.parallel && Array.isArray(q.steps));
  return open.some(SETUP) ? open.map((q, i) => [q, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((p) => p[0]) : [];
}
// The step to do now: the first not done and not locked, with a link.
export const nextStep = (q) => q.steps.find((s) => !s.done && !s.locked && href(s.go)) || null;

export function renderQuests(el, quests, who) {
  const first = quests[0], step = nextStep(first);
  const total = quests.reduce((n, q) => n + q.steps.length, 0), done = quests.reduce((n, q) => n + q.steps.filter((s) => s.done).length, 0);
  const pct = total ? Math.round(100 * done / total) : 0;
  el.innerHTML = '<div class="gb-hub"><div class="gb-hub-who"><div><h2 class="gb-h1">Hi, ' + esc(String(who.name || '').split(' ')[0] || 'there') + '</h2>' +
    '<span class="gb-hub-role">Finish setting up, then the Day Book is yours</span></div></div>' +
    '<div class="gb-hub-prog"><span class="gb-bar gb-bar-ok" role="progressbar" aria-label="Setup steps done" aria-valuemin="0" aria-valuemax="' + total + '" aria-valuenow="' + done + '"><i style="width:' + pct + '%"></i></span>' +
    '<div class="gb-meta"><span>' + done + ' of ' + total + ' setup steps done</span></div></div></div>' +
    '<div class="gb-next"><img src="../assets/game/buddy/winter-formal-neutral.webp" alt="" width="52" height="52"><div class="gb-next-b"><span class="gb-next-k">Start here</span>' +
    (step ? '<p class="gb-next-t">' + esc(step.title) + '</p><a class="gb-btn gb-btn-primary" href="' + esc(href(step.go)) + '">Go</a>'
      : '<p class="gb-next-t">Waiting on someone else. Nothing for you right now.</p>') + '</div></div>' +
    quests.map((q, i) => {
      const n = q.steps.filter((s) => s.done).length, ns = nextStep(q);
      return '<section class="gb-section"><h2>' + (i === 0 ? '<span class="gb-pill gb-pill-next">Start here</span> ' : '') + esc(q.title) + '</h2>' +
        '<span class="gb-bar gb-bar-ok" role="progressbar" aria-label="' + esc(q.title) + ' steps done" aria-valuemin="0" aria-valuemax="' + q.steps.length + '" aria-valuenow="' + n + '"><i style="width:' + Math.round(100 * n / q.steps.length) + '%"></i></span>' +
        '<ul class="gb-missions">' + q.steps.map((s) => {
          const isNext = s === ns, cls = s.done ? ' is-done' : isNext ? ' is-next' : ' is-wait';
          const go = isNext ? '<a class="gb-btn' + (i === 0 ? ' gb-btn-primary' : '') + '" href="' + esc(href(s.go)) + '">Go</a>' : '';
          return '<li class="gb-mission' + cls + '"><span class="gb-mark" aria-hidden="true"></span><span class="gb-mission-t">' + esc(s.title) +
            '<small>' + (s.done ? 'Done' : isNext ? 'Next' : s.locked ? 'Opens after the step before' : 'Waiting') + '</small></span>' + go + '</li>';
        }).join('') + '</ul></section>';
    }).join('') +
    '<div class="gb-section"><a class="gb-go" href="daybook.html"><span>Go to Day Book<small>Entries can start before setup is finished</small></span></a>' +
    '<button type="button" class="gb-btn" id="quests-skip">See all tools</button></div>';
  el.querySelector('#quests-skip').onclick = () => { skipped = true; show(el, null); };
}

// home shown (quests hidden) when list is null/empty, else the quest screen over the home
function show(el, list, who) {
  const home = document.getElementById('home');
  if (list && list.length) { renderQuests(el, list, who); el.hidden = false; home.hidden = true; } else { el.hidden = true; home.hidden = false; }
}

// Paints the last known quests at once (a clerk with none known yet sees a loading line, not the home), then the fresh ones.
// Offline or refused: the last known screen stays, or the home shows.
export async function showSetupQuests(el, session, fetchFn, url, token) {
  const who = { name: session.name }, key = KEY + String(session.email || '').toLowerCase(), cached = cacheGet(key);
  if (cached && cached.length) show(el, cached, who);
  else if (/(^|,)\s*FeeClerk\s*(,|$)/.test(String(session.role || ''))) {
    el.innerHTML = '<p class="gb-muted">Loading your setup quests…</p><a class="gb-go" href="daybook.html"><span>Go to Day Book<small>Entries can start before setup is finished</small></span></a>';
    el.hidden = false; document.getElementById('home').hidden = true;
  }
  try {
    const d = await (await fetchFn(url + '?action=gametoday&peek=1&idToken=' + encodeURIComponent(token), { cache: 'no-store' })).json();
    if (!d || !d.success) throw new Error((d && d.error) || 'no quests');
    const list = setupQuests(d.quests);
    cacheSet(key, list); if (!skipped) show(el, list, who);
  } catch (e) { if (!(cached && cached.length) && !skipped) show(el, null); }
}
