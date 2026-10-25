// Fleet setup page (coordinator/transport/setup.html): the staff transport questionnaire as six quests per bus.
// Spec: docs/superpowers/specs/2026-10-25-transport-game-design.md, "Fleet setup quests". The quest definitions, done checks,
// completion, team bar, gaps and validation all come from fleet-quests.js (window.FleetQuests, the same file the Coordinator
// backend runs), so the page and the server never disagree on what "done" means.
// Three screens on one page, as a stack (the phone's Back button pops it): the board (team bars, the Owner's gaps, one card per
// bus with its six-segment ring), a bus (its six quests), a quest (a short form). Fee Clerks see their campus; Coordinators and
// the Owner every campus they cover, with LMS 1-3 / LMS 4-6 filters when that is the whole network.
// A save is kept on the phone first (run-store.js, its own database 'lmcs-setup'): photos go to the Roster's capturefile as kind
// 'profile' (uploader.js), then the quest goes to the Coordinator backend with the photos' file ids. No signal: it waits on the
// phone and sends later. Recognition only (the ring, the Ready badge, the team bar): no people ranked, nothing timed, no sound.
import { createCaptureIdb, createRunStore } from './run-store.js';
import { createUploader } from './uploader.js';

const COORD_URL = 'https://script.google.com/macros/s/AKfycbwilcvrgZQga_qo1A-fBTUzKLifrBYIwlPHoWMITmchf5sZOYjKIJ7_4J0TeBF_-6B6/exec'; // = capture.js
const ROSTER_URL = 'https://script.google.com/macros/s/AKfycbyHiaZY_iWK2VTKKFJcCsBNnIbUndJYUSjnPkxvJ-dYavaihiul2xBJuJohPRsP9Spf/exec'; // = capture.js
const FQ = window.FleetQuests, CFG = FQ.questConfig();
const store = createRunStore(createCaptureIdb('lmcs-setup'));
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const stepOf = (id) => CFG.steps.find((s) => s.id === id);
const routeName = (b) => { const r = String(b.route || '').trim(); return !r ? '' : /^\d+$/.test(r) ? 'Route ' + r : r; };
const TRANSIENT = /timed? ?out|try again|too many|temporar|lock|failed to fetch|network|service/i;
const GROUPS = { all: null, lms13: ['LMS1', 'LMS2', 'LMS3'], lms46: ['LMS4', 'LMS5', 'LMS6'] };
const SVG = {
  ok: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  cam: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M4 8h3.5L9 5.5h6L16.5 8H20v11H4z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><circle cx="12" cy="13.5" r="3.3" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>',
  go: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const S = { session: null, data: null, rows: null, profiles: [], scope: 'all', gap: null, view: { v: 'board' }, form: null, sending: false, queued: [], others: 0 };
// A save waiting on a shared phone belongs to whoever made it (Ruling 36): only they see, send or discard it. Others see a count.
const mine = (r) => String(r.by || '').toLowerCase() === String(S.session.email || '').toLowerCase();

// ── Boot and data ──
async function boot() {
  const s = await LMCS.requireSession('#authRoot');
  $('authRoot').style.display = 'none';
  $('appBody').hidden = false;
  if (!(LMCS.canViewCoordinatorPortal(s) || LMCS.hasRole(s, 'FeeClerk'))) { $('appBody').innerHTML = '<div class="denied">Fleet setup is for Fee Clerks, Coordinators and the Owner.</div>'; return; }
  if (!LMCS.canViewCoordinatorPortal(s)) { $('back').href = '../../office/buses.html'; $('back').textContent = '← Live Buses'; } // Fee Clerk
  S.session = s;
  $('photo').addEventListener('change', onPhoto);
  $('retry').addEventListener('click', load);
  addEventListener('popstate', (e) => { S.view = e.state || { v: 'board' }; render(); });
  addEventListener('online', () => (S.data ? sendQueued() : load().then(sendQueued)));
  const q = new URLSearchParams(location.search); // a mission's go link: ?reg=HP659511&quest=papers
  S.view = { v: 'board' };
  history.replaceState(S.view, '');
  await load();
  const reg = String(q.get('reg') || '').toUpperCase();
  if (S.profiles.some((p) => p.reg === reg)) { go({ v: 'bus', reg }); if (stepOf(q.get('quest'))) go({ v: 'quest', reg, quest: q.get('quest') }); }
  sendQueued();
}

async function getJson(action) {
  const s = LMCS.getSession() || S.session;
  const r = await (await fetch(COORD_URL + '?action=' + action + '&idToken=' + encodeURIComponent(s.idToken), { cache: 'no-store' })).json();
  if (!r.success) throw new Error(r.error || 'Request failed');
  return r;
}
async function load() {
  $('loadMsg').hidden = false; $('loadMsg').firstElementChild.textContent = 'Loading the buses…'; $('retry').hidden = true;
  try {
    S.data = await getJson('coordinatortransportfleet');
    $('loadMsg').hidden = true;
  } catch (e) {
    $('loadMsg').firstElementChild.textContent = 'Could not load the buses (' + e.message + '). Check the connection, then try again.';
    $('retry').hidden = false;
  }
  await refresh(); // with no data yet this still shows (and lets you send) your saves waiting on this phone
}
// The server's rows plus every save still waiting on this phone, so a quest saved offline already counts here.
async function refresh() {
  const all = (await store.runs()).filter((r) => r.quest);
  S.queued = all.filter(mine).sort((a, b) => a.startedAt - b.startedAt);
  S.others = all.length - S.queued.length;
  if (!S.data) { drawPending(); return; }
  const rows = JSON.parse(JSON.stringify(S.data.rows));
  S.queued.forEach((r) => FQ.applySave(rows, r.reg, r.quest.id, withPhotos(r.quest), { ageLimit: r.quest.ageLimit, by: r.by })); // the server's own write
  S.rows = rows;
  S.profiles = FQ.profilesFromRows(rows);
  render();
}
const withPhotos = (q) => { const f = { ...q.fields }; Object.keys(q.photos || {}).forEach((k) => { f[k] = 'pending-photo-' + q.photos[k]; }); return f; };
// ── Screens: board > bus > quest, pushed onto the browser history ──
function go(view) { S.view = view; S.just = null; history.pushState(view, ''); render(); scrollTo(0, 0); }
// A redraw (a filter tap, a send finishing in the background) keeps keyboard focus on the same control.
function keepFocus(box, draw) {
  const a = document.activeElement, sel = a && box.contains(a) && ['reg', 'q', 'k'].map((k) => a.dataset[k] && `[data-${k}="${a.dataset[k]}"]`).find(Boolean);
  draw();
  const b = sel && box.querySelector(sel); if (b) b.focus({ preventScroll: true });
}
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function render() {
  const v = S.view.v, p = S.view.reg && S.profiles.find((x) => x.reg === S.view.reg);
  $('board').hidden = v !== 'board'; $('bus').hidden = v !== 'bus' || !p; $('quest').hidden = v !== 'quest' || !p;
  drawPending();
  if (v === 'board' || !p) { $('board').hidden = false; drawBoard(); }
  else if (v === 'bus') drawBus(p);
  else if (!S.form || S.form.reg !== p.reg || S.form.quest !== S.view.quest) drawQuest(p, S.view.quest);
}

function ring(p, big, fresh) { // fresh: the quest this save just finished (its segment pops in)
  const qs = FQ.questsFor(p), n = qs.filter((q) => q.done).length, r = 16, C = 2 * Math.PI * r, seg = C / 6, gap = 2.2;
  const arcs = qs.map((q, i) => `<circle cx="20" cy="20" r="${r}" stroke-dasharray="${(seg - gap).toFixed(3)} ${(C - seg + gap).toFixed(3)}" stroke-dashoffset="${(-i * seg).toFixed(3)}" class="${q.done ? 'on' : ''}${q.id === fresh ? ' fresh' : ''}"/>`).join('');
  return `<span class="fs-ring${big ? ' fs-ring-big' : ''}${n === 6 ? ' ready' : ''}" role="img" aria-label="${n} of 6 quests done">` +
    `<svg viewBox="0 0 40 40" aria-hidden="true"><g transform="rotate(-90 20 20)">${arcs}</g></svg><b>${n === 6 ? SVG.ok : FQ.completion(p) + '%'}</b></span>`;
}
const badge = '<span class="fs-ready">' + SVG.ok + 'Ready</span>';

function drawBoard() { keepFocus($('board'), drawBoardNow); }
function drawBoardNow() {
  const all = S.data ? S.data.campuses : [], wide = GROUPS.lms13.some((c) => all.includes(c)) && GROUPS.lms46.some((c) => all.includes(c));
  $('scope').hidden = !wide;
  if (wide) {
    $('scope').innerHTML = [['all', 'All campuses'], ['lms13', 'LMS 1–3'], ['lms46', 'LMS 4–6']]
      .map(([k, l]) => `<button type="button" data-k="${k}" aria-pressed="${S.scope === k}">${l}</button>`).join('');
    $('scope').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { S.scope = b.dataset.k; drawBoard(); }));
  }
  const inScope = (p) => !GROUPS[S.scope] || GROUPS[S.scope].includes(p.campusId);
  const ps = S.profiles.filter(inScope);
  const campuses = [...new Set(ps.map((p) => p.campus))].sort();
  $('teams').innerHTML = campuses.map((c) => {
    const t = FQ.teamBar(c, ps);
    return `<li><p>${esc(t.text)}</p><div class="cap-bar cap-pips" style="--n:${Math.max(1, t.total)}" role="progressbar" aria-label="${esc(t.text)}" aria-valuemin="0" aria-valuemax="${t.total}" aria-valuenow="${t.ready}"><i style="width:${t.total ? 100 * t.ready / t.total : 0}%"></i></div></li>`;
  }).join('');
  const owner = S.data && S.data.owner;
  $('gaps').hidden = !owner || !ps.length;
  if (owner) {
    const g = FQ.gaps(ps).filter((x) => x.count);
    $('gapList').innerHTML = g.length ? g.map((x) => { const sp = x.text.indexOf(' ');
      return `<li><button type="button" class="fs-row fs-gap" data-q="${x.quest}" aria-pressed="${S.gap === x.quest}"><b class="fs-gapn">${esc(x.text.slice(0, sp))}</b><span>${esc(x.text.slice(sp + 1).replace(' still ', ' '))}</span>${SVG.go}</button></li>`; }).join('')
      : '<li class="cap-note">Every bus is set up.</li>';
    $('gapList').querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => {
      S.gap = S.gap === b.dataset.q ? null : b.dataset.q; drawBoard();
      if (S.gap) $('filterNote').scrollIntoView({ block: 'start', behavior: calm() ? 'auto' : 'smooth' }); // the list it filters is below the fold
    }));
  }
  const missing = (p, q) => FQ.questsFor(p).some((x) => x.id === q && !x.done);
  const shown = ps.filter((p) => !S.gap || missing(p, S.gap))
    .sort((a, b) => (FQ.isReady(a) - FQ.isReady(b)) || a.reg.localeCompare(b.reg)); // still to do first, ready ones at the end
  $('filterNote').innerHTML = S.gap ? `Buses that still need ${esc(stepOf(S.gap).gap)}. <button type="button" class="cap-btn" id="allBuses">Show all buses</button>` : '';
  if (S.gap) $('allBuses').addEventListener('click', () => { const was = S.gap; S.gap = null; drawBoard(); const r = $('gapList').querySelector(`[data-q="${was}"]`); if (r) r.focus({ preventScroll: true }); });
  $('buses').innerHTML = S.data && !shown.length ? `<li class="cap-note">${S.profiles.length ? 'No buses here.' : 'No running buses on your account.'}</li>` : shown.map((p) => {
    const qs = FQ.questsFor(p), next = qs.find((q) => !q.done), meta = [routeName(p), p.campus].filter(Boolean).join(', ');
    return `<li><button type="button" class="fs-bus" data-reg="${esc(p.reg)}">${ring(p)}<span class="fs-bustext"><b>${esc(p.reg)}</b><span>${esc(meta)}</span>` +
      `<span class="fs-next">${next ? 'Next: ' + esc(next.label) : 'All six quests done'}</span></span>${next ? SVG.go : badge}</button></li>`;
  }).join('');
  $('buses').querySelectorAll('[data-reg]').forEach((b) => b.addEventListener('click', () => go({ v: 'bus', reg: b.dataset.reg })));
}

const waiting = (reg, quest) => S.queued.find((r) => r.reg === reg && (!quest || r.quest.id === quest));
function questLine(p, q) {
  const w = waiting(p.reg, q.id);
  if (w && w.status === 'error') return '<span class="fs-bad">Not saved. See the message at the top.</span>';
  if (w) return '<span class="cap-todo">Saved on this phone. Sends when you are online.</span>';
  if (q.done) return '<span class="cap-good">Done</span>';
  const parts = stepOf(q.id).parts;
  if (parts) return `${q.missing.length} of ${parts.length} parts still to answer`;
  const names = FQ.missingLabels(q.id, q.missing);
  return 'Still needs ' + esc(names.slice(0, 2).join(', ').toLowerCase()) + (names.length > 2 ? ` and ${names.length - 2} more` : '');
}
// The 60+ rule, said where the bus is: the line-up board (Phase 1b) is what keeps the driver off it.
function ageLine(p) {
  const dob = (p.data.driver || {}).dateOfBirth, limit = CFG.driverAgeLimit;
  return (dob ? `The driver is ${FQ.ageOn(dob, today())}. ` : 'The driver is over the age limit. ') + `Drivers ${limit} or over cannot drive a school bus.`;
}
function drawBus(p) { keepFocus($('bus'), () => drawBusNow(p)); }
function drawBusNow(p) {
  const qs = FQ.questsFor(p), n = qs.filter((q) => q.done).length, meta = [routeName(p), p.campus].filter(Boolean).join(', ');
  const j = S.just && S.just.reg === p.reg ? S.just : null, fresh = j && !j.was && qs.some((q) => q.id === j.quest && q.done) ? j.quest : null;
  $('bus').innerHTML = `<button type="button" class="fs-back" data-a="back">← All buses</button>` +
    `<div class="fs-bushead">${ring(p, true, fresh)}<div><h2 class="cap-h">${esc(p.reg)}</h2><p class="cap-note">${esc(meta)}</p>${p.driverName ? `<p class="cap-note">Driver: ${esc(p.driverName)}</p>` : ''}` +
    `<p class="fs-count${fresh && n === 6 ? ' fs-fresh' : ''}">${n === 6 ? badge : n + ' of 6 quests done'}</p></div></div>` +
    (p.ageLimit ? `<p class="fs-warn">${esc(ageLine(p))}</p>` : '') +
    `<ul class="fs-quests">${qs.map((q) => `<li><button type="button" class="fs-quest${q.id === fresh ? ' fs-fresh' : ''}" data-q="${q.id}" data-done="${q.done}"${q.done ? ' data-s="ok"' : ''}>` +
      `<span class="cap-mark">${q.done ? SVG.ok : ''}</span><span class="fs-qtext"><b>${esc(q.label)}</b><span>${questLine(p, q)}</span></span>${SVG.go}</button></li>`).join('')}</ul>`;
  $('bus').querySelector('[data-a="back"]').addEventListener('click', () => history.back());
  $('bus').querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => go({ v: 'quest', reg: p.reg, quest: b.dataset.q })));
}

// ── A quest: a short form ──
const optional = (step, id) => !((step.doneCheck.required || []).includes(id) || step.doneCheck.eachPart === id);
function fieldHtml(step, f, val, key) {
  const id = 'f-' + key, opt = optional(step, f.id) ? ' <small>(optional)</small>' : '';
  const lab = `<label class="cap-field" for="${id}">${esc(f.label)}${opt}</label>` + (f.hint ? `<p class="fs-hint" id="${id}-h">${esc(f.hint)}</p>` : '');
  const desc = f.hint ? ` aria-describedby="${id}-h"` : '';
  if (f.type === 'photo') {
    const ph = S.form.photos[key], has = ph || (val && !/^pending-photo/.test(val)), queued = /^pending-photo/.test(val || '');
    return `<div class="fs-field" data-key="${key}"><p class="cap-field" id="${id}">${esc(f.label)}${opt}</p>${f.hint ? `<p class="fs-hint">${esc(f.hint)}</p>` : ''}` +
      (has || queued ? `<div class="cap-took">${ph ? `<img src="data:image/jpeg;base64,${ph}" alt="">` : ''}<span>${ph ? 'Photo taken' : queued ? 'Photo waiting to send' : 'Photo saved'}</span><button type="button" class="cap-btn" data-photo="${key}" aria-describedby="${id}">Retake</button></div>`
        : `<button type="button" class="cap-btn cap-photo" data-photo="${key}" aria-describedby="${id}">${SVG.cam}<span>Take photo</span></button>`) + '</div>';
  }
  if (f.type === 'yesno') {
    return `<div class="fs-field"><p class="cap-field" id="${id}">${esc(f.label)}${opt}</p><div class="cap-yn" role="group" aria-labelledby="${id}">` +
      ['yes', 'no'].map((x) => `<button type="button" data-key="${key}" data-v="${x}" data-a="${x}" aria-pressed="${val === x}">${x === 'yes' ? 'Yes' : 'No'}</button>`).join('') + '</div></div>';
  }
  if (f.type === 'choice') {
    return `<div class="fs-field">${lab}<select id="${id}" class="cap-select" data-key="${key}"${desc}><option value="">Pick one</option>` +
      f.options.map((o) => `<option${o === val ? ' selected' : ''}>${esc(o)}</option>`).join('') + '</select></div>';
  }
  if (f.type === 'dateOrUnknown') {
    const unknown = val === 'not known';
    return `<div class="fs-field">${lab}<div class="fs-dateunk"><input type="date" id="${id}" class="cap-input" data-key="${key}" max="${today()}" value="${unknown ? '' : esc(val || '')}"${unknown ? ' disabled' : ''}${desc}>` +
      `<button type="button" class="cap-btn" data-unknown="${key}" aria-pressed="${unknown}">Not known</button></div></div>`;
  }
  const type = f.type === 'date' ? 'date' : f.type === 'phone' ? 'tel' : 'text';
  const extra = f.type === 'number' ? ' inputmode="decimal"' : f.type === 'date' && f.past ? ` max="${today()}"` : '';
  return `<div class="fs-field">${lab}<input type="${type}" id="${id}" class="cap-input" data-key="${key}" value="${esc(val || '')}"${extra}${desc} autocomplete="off"></div>`;
}
function drawQuest(p, questId) {
  const step = stepOf(questId), data = p.data[questId] || {};
  S.form = { reg: p.reg, quest: questId, values: JSON.parse(JSON.stringify(data)), photos: {} };
  const link = (mode, text) => `<a class="cap-primary fs-link" href="capture.html?mode=${mode}&reg=${encodeURIComponent(p.reg)}">${text}</a>`;
  let body = '';
  if (questId === 'safety') {
    body = `<div class="fs-callout"><p>${p.inspected ? '<span class="cap-good">The first safety check is saved.</span>' : 'Do the first safety check on the capture page: one card per item the bus must carry.'}</p>` +
      (p.inspected ? '' : link('inspection', 'Open the safety check')) + '</div>';
  } else if (questId === 'capture') {
    body = `<div class="fs-callout"><p>${p.captured ? '<span class="cap-good">The route timelapse is published.</span>' : 'This quest is done when the route timelapse of this bus is published. Plan the run below, then ride it with the capture page.'}</p>` +
      (p.captured ? '' : link('timelapse', 'Open the capture page')) + '</div>';
  }
  const fields = step.fields.filter((f) => f.type !== 'inspection' && f.type !== 'derived');
  if (step.parts) {
    body += `<ul class="cap-cards">${step.parts.map((pt) => {
      const v = S.form.values[pt.id] || {}, more = step.fields.filter((f) => f.id !== 'lastReplacedOn');
      return `<li class="cap-slot" data-part="${pt.id}"><div class="cap-slothead"><span class="cap-mark"></span><h3>${esc(pt.label)}</h3></div>` +
        fieldHtml(step, step.fields[0], v.lastReplacedOn, pt.id + '.lastReplacedOn') +
        `<details${more.some((f) => v[f.id]) ? ' open' : ''}><summary>Kilometres, workshop, cost</summary>${more.map((f) => fieldHtml(step, f, v[f.id], pt.id + '.' + f.id)).join('')}</details></li>`;
    }).join('')}</ul>`;
  } else body += fields.map((f) => fieldHtml(step, f, S.form.values[f.id], f.id)).join('');
  $('quest').innerHTML = `<button type="button" class="fs-back" data-a="back">← ${esc(p.reg)}</button>` +
    `<h2 class="cap-h">${esc(step.title)}</h2><p class="cap-note">${esc([routeName(p), p.campus].filter(Boolean).join(', '))}</p>` +
    `<div class="cap-hud fs-hud"><p id="need" class="cap-hudcount" aria-live="polite"></p><ol id="needSlots" class="cap-slots" aria-hidden="true"></ol></div>` +
    `<form id="qform" novalidate>${body}<p id="qmsg" class="cap-msg" role="alert"></p><button type="submit" class="cap-primary" id="qsave">Save ${esc(step.title.toLowerCase())}</button></form>`;
  const form = $('qform');
  $('quest').querySelector('[data-a="back"]').addEventListener('click', () => history.back());
  form.addEventListener('input', (e) => { if (e.target.dataset.key) setVal(e.target.dataset.key, e.target.value); });
  form.addEventListener('change', (e) => { if (e.target.dataset.key) setVal(e.target.dataset.key, e.target.value); });
  form.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.v) { setVal(b.dataset.key, getVal(b.dataset.key) === b.dataset.v ? '' : b.dataset.v); b.parentNode.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(getVal(b.dataset.key) === x.dataset.v))); }
    if (b.dataset.unknown) {
      const k = b.dataset.unknown, on = getVal(k) !== 'not known', input = b.previousElementSibling;
      setVal(k, on ? 'not known' : ''); b.setAttribute('aria-pressed', String(on)); input.disabled = on; if (on) input.value = '';
    }
    if (b.dataset.photo) { S.form.photoFor = b.dataset.photo; $('photo').value = ''; $('photo').click(); }
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); saveQuest(); });
  need();
}
function getVal(key) { const [a, b] = key.split('.'); return b ? (S.form.values[a] || {})[b] : S.form.values[key]; }
function setVal(key, v) {
  const [a, b] = key.split('.');
  if (b) (S.form.values[a] = S.form.values[a] || {})[b] = v; else S.form.values[key] = v;
  S.form.dirty = true; $('qmsg').textContent = ''; need();
}
// "Needed to finish": the quest's missing list, worked out live from what is on the form.
function need() {
  const p = S.profiles.find((x) => x.reg === S.form.reg), trial = { ...p, data: { ...p.data, [S.form.quest]: formFields(true) } };
  const q = FQ.questsFor(trial).find((x) => x.id === S.form.quest), names = FQ.missingLabels(q.id, q.missing);
  const parts = stepOf(q.id).parts; // 20 parts: a count, and each card's own mark says which
  $('need').textContent = q.done ? 'Everything this quest needs is here.' : parts ? `${parts.length - q.missing.length} of ${parts.length} parts answered. Each needs a date or Not known.`
    : `Needed to finish (${names.length}): ` + names.slice(0, 3).join(', ') + (names.length > 3 ? ` and ${names.length - 3} more.` : '.');
  $('need').classList.toggle('cap-good', q.done);
  const all = FQ.questsFor({ data: {} }).find((x) => x.id === q.id).missing, slots = $('needSlots'); // everything this quest can need, in form order
  slots.hidden = all.length < 2;
  slots.style.setProperty('--n', Math.min(all.length, 12));
  slots.innerHTML = all.map((id) => (q.missing.includes(id) ? '<li></li>' : `<li data-s="ok">${SVG.ok}</li>`)).join('');
  if (S.form.quest === 'parts') document.querySelectorAll('[data-part]').forEach((li) => {
    const ok = !q.missing.includes(li.dataset.part);
    li.dataset.s = ok ? 'ok' : ''; li.querySelector('.cap-mark').innerHTML = ok ? SVG.ok : '';
  });
}
// The form's values as the quest saves them; trial: new photos count as present (for the live list and validation).
function formFields(trial) {
  const out = JSON.parse(JSON.stringify(S.form.values));
  Object.keys(S.form.photos).forEach((k) => { out[k] = trial ? 'pending-photo-new' : undefined; });
  Object.keys(out).forEach((k) => { if (out[k] === undefined) delete out[k]; });
  return out;
}

const canvas = document.createElement('canvas');
function readImage(file) { // the phone camera's photo, longest side 1280 px, JPEG 0.7, as base64 (as capture.js)
  const url = URL.createObjectURL(file);
  return new Promise((ok, no) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width = Math.round(img.naturalWidth * k); canvas.height = Math.round(img.naturalHeight * k);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      ok(canvas.toDataURL('image/jpeg', 0.7).split(',')[1]);
    };
    img.onerror = () => no(new Error('This photo could not be read. Take it again.'));
    img.src = url;
  }).finally(() => URL.revokeObjectURL(url));
}
async function onPhoto() {
  const file = $('photo').files[0], key = S.form && S.form.photoFor;
  if (!file || !key) return;
  try { S.form.photos[key] = await readImage(file); } catch (e) { $('qmsg').textContent = e.message; return; }
  const step = stepOf(S.form.quest), f = step.fields.find((x) => x.id === key);
  const box = document.querySelector(`.fs-field[data-key="${key}"]`);
  box.outerHTML = fieldHtml(step, f, S.form.values[key], key);
  S.form.dirty = true; need();
  const again = document.querySelector(`[data-photo="${key}"]`); if (again) again.focus();
}

async function saveQuest() {
  const { reg, quest } = S.form, p = S.profiles.find((x) => x.reg === reg), step = stepOf(quest);
  let fields = formFields(false);
  if (quest === 'parts') Object.keys(fields).forEach((k) => { if (!Object.values(fields[k]).some((v) => String(v || '').trim())) delete fields[k]; });
  const trial = { ...fields };
  Object.keys(S.form.photos).forEach((k) => { trial[k] = 'pendingphoto0000'; });
  Object.keys(trial).forEach((k) => { if (/^pending-photo/.test(trial[k])) trial[k] = 'pendingphoto0000'; }); // a photo still waiting from an earlier save
  const v = FQ.validateQuest(quest, trial, today());
  if (v.error) { $('qmsg').textContent = v.error; return; }
  // keep only the checked values; a photo still waiting from an earlier save keeps its place in that save
  fields = v.fields;
  Object.keys(S.form.photos).forEach((k) => { delete fields[k]; });
  Object.keys(fields).forEach((k) => { if (fields[k] === 'pendingphoto0000') delete fields[k]; });
  $('qsave').disabled = true;
  const before = FQ.questsFor(p).find((q) => q.id === quest).done;
  try {
    const run = await store.newRun({ reg, kind: 'profile', campus: p.campusId, by: S.session.email, role: S.session.role });
    const photos = {};
    for (const k of Object.keys(S.form.photos)) photos[k] = await store.addFrame(run.id, { takenAt: Date.now(), base64: S.form.photos[k] });
    // an earlier save of the same quest still waiting for its photo: carry that photo over, then drop the older save
    for (const old of S.queued.filter((r) => r.reg === reg && r.quest.id === quest)) {
      for (const k of Object.keys(old.quest.photos || {})) if (!photos[k] && !fields[k]) {
        const base64 = await store.fileData(old.id, 'profile', old.quest.photos[k]);
        if (base64) photos[k] = await store.addFrame(run.id, { takenAt: Date.now(), base64 });
      }
      await store.discard(old.id);
    }
    await store.patchRun(run.id, { quest: { id: quest, fields, photos, ageLimit: !!v.ageLimit } });
    await store.endRun(run.id);
  } catch (e) {
    $('qmsg').textContent = e.code === 'STORAGE_FULL' ? 'The phone is full. Free some space, then save again.' : 'Not saved on this phone: ' + e.message;
    $('qsave').disabled = false;
    return;
  }
  S.form = null; S.view = { v: 'bus', reg }; S.just = { reg, quest, was: before };
  // land on the quest just saved, in view (above the toast) and focused: its tick is the reward. Again after the browser
  // restores the bus's scroll on Back.
  const land = () => { const row = $('bus').querySelector(`[data-q="${quest}"]`); if (row && !$('bus').hidden) { row.focus({ preventScroll: true }); row.scrollIntoView({ block: 'nearest' }); } };
  addEventListener('popstate', () => requestAnimationFrame(land), { once: true });
  history.back(); // to the bus (popstate draws it again)
  await refresh();
  land();
  const after = FQ.questsFor(S.profiles.find((x) => x.reg === reg)), done = after.filter((q) => q.done).length;
  if (v.warning) toast(`${step.title} saved.`); // the red line on the bus says the rest, and stays
  else if (done === 6) toast(`${reg} is ready.`);
  else if (!before && after.find((q) => q.id === quest).done) toast(`${step.title} done. ${done} of 6 for ${reg}.`);
  else toast(`${step.title} saved.`);
  sendQueued();
}

// ── Sending: photos to the Roster (capturefile), then the quest to the Coordinator backend ──
async function postRoster(body) {
  const s = LMCS.getSession();
  if (!s) return { success: false, error: 'Signed out. Sign in again, then send' };
  return JSON.parse(await (await fetch(ROSTER_URL, { method: 'POST', body: JSON.stringify({ idToken: s.idToken, ...body }) })).text());
}
async function postCoord(body) {
  const s = LMCS.getSession();
  if (!s) return { success: false, signIn: true, error: 'Sign in again to send' };
  try { return JSON.parse(await (await fetch(COORD_URL, { method: 'POST', body: JSON.stringify({ idToken: s.idToken, ...body }) })).text()); }
  catch (e) { return { success: false, network: true, error: 'No connection' }; }
}
// Sign in again (the session ran out). Someone else signing in here reloads the page, so every list and every send is theirs
// (Ruling 37): the first person's waiting saves never go out under the second person's token.
async function signInThenSend() {
  $('authRoot').style.display = ''; scrollTo(0, 0);
  const s = await LMCS.requireSession('#authRoot');
  $('authRoot').style.display = 'none';
  if (!sameUser(s)) { location.reload(); return; }
  sendQueued();
}
const sameUser = (s) => !!s && String(s.email || '').toLowerCase() === String(S.session.email || '').toLowerCase();
async function sendQueued() {
  if (S.sending) return;
  S.sending = true; drawPending();
  let changed = false;
  try {
    for (const run of (await store.runs()).filter((r) => r.quest && mine(r)).sort((a, b) => a.startedAt - b.startedAt)) {
      if (!sameUser(LMCS.getSession())) break; // signed out, or someone else signed in (another tab): send nothing
      if (await store.total(run.id) && !run.endSent) {
        await createUploader({ store, post: postRoster, delays: [3000, 10000], waitOnline: async () => { throw new Error('offline'); } }).start(run.id).catch(() => {});
        const r = await store.getRun(run.id);
        if (!r.endSent) { if (r.status !== 'error') break; continue; } // no connection: try again later; refused: shown in the list
      }
      const ids = await store.fileIds(run.id), fields = { ...run.quest.fields };
      Object.keys(run.quest.photos || {}).forEach((k) => { fields[k] = ids[run.quest.photos[k]]; });
      const res = await postCoord({ action: 'coordinatortransportfleetsave', reg: run.reg, quest: run.quest.id, fields });
      if (res.success) { await store.discard(run.id); changed = true; continue; }
      if (res.signIn || res.network || TRANSIENT.test(res.error || '')) break;
      await store.patchRun(run.id, { status: 'error', error: res.error });
    }
  } finally {
    S.sending = false;
    if (changed) { try { S.data = await getJson('coordinatortransportfleet'); $('loadMsg').hidden = true; } catch (e) { /* keep what we have */ } }
    await refresh();
  }
}
function drawPending() {
  const q = S.queued, bad = q.filter((r) => r.status === 'error'), wait = q.length - bad.length;
  $('others').textContent = S.others ? `${S.others} ${S.others === 1 ? 'save is' : 'saves are'} waiting on this phone for another person. They send it when they sign in here.` : '';
  $('pending').hidden = !(wait || (S.sending && q.length));
  if (!q.length) { $('refused').innerHTML = ''; return; }
  const signedOut = !LMCS.getSession();
  $('pendingText').textContent = S.sending ? 'Sending...' : wait ? `${wait} ${wait === 1 ? 'save is' : 'saves are'} waiting to send.` + (signedOut ? ' Sign in to send.' : '') : '';
  $('sendNow').hidden = S.sending || !wait;
  $('sendNow').textContent = signedOut ? 'Sign in' : 'Send now';
  $('sendNow').onclick = signedOut ? signInThenSend : () => sendQueued();
  $('refused').innerHTML = bad.map((r) => `<li data-id="${esc(r.id)}"><p><b>${esc(stepOf(r.quest.id).title)} for ${esc(r.reg)} was not saved.</b> ${esc(r.error)}</p>` +
    '<button type="button" class="cap-btn" data-a="again">Try again</button><button type="button" class="cap-btn" data-a="drop">Discard</button></li>').join('');
  $('refused').querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.closest('[data-id]').dataset.id;
    const run = await store.getRun(id).catch(() => null); // gone (sent or discarded in another tab): nothing to do
    if (!run || !mine(run)) return; // never someone else's save
    if (b.dataset.a === 'drop') {
      if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Tap again to discard'; return; }
      await store.discard(id);
    } else await store.patchRun(id, { status: 'ended', error: null });
    await refresh(); if (b.dataset.a === 'again') sendQueued();
  }));
}

let toastT;
function toast(msg, long) { $('toast').textContent = msg; clearTimeout(toastT); toastT = setTimeout(() => { $('toast').textContent = ''; }, long ? 9000 : 3500); }

boot();
