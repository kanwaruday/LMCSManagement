// Daily duty roll call (coordinator/transport/rollcall.html; Fleet Operations): who drove and who attended each running bus,
// today or yesterday. One tap records the usual pair; Substitute picks a name from the campus's transport staff list. Backend:
// GET/POST action=coordinatortransportrollcall (coordinator-transport.gs), which checks the scope, the date and the names.
// A save is kept on the phone first (run-store.js, its own database 'lmcs-rollcall') and sent at once, or later with no signal.
// Ruling 36: a waiting save is seen, sent and discarded only by the person who made it; others see a count. Names only, never
// a phone, date of birth or licence.
import { createCaptureIdb, createRunStore } from './run-store.js';

const COORD_URL = 'https://script.google.com/macros/s/AKfycbwilcvrgZQga_qo1A-fBTUzKLifrBYIwlPHoWMITmchf5sZOYjKIJ7_4J0TeBF_-6B6/exec'; // = setup.js
const store = createRunStore(createCaptureIdb('lmcs-rollcall'));
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// after a save: the done state and the one way back, the header's own link (it already points where this role came from)
const wayBack = (cls) => { const b = $('back'); return `<a class="${cls}" href="${esc(b.getAttribute('href'))}">Back to ${esc(b.textContent.replace(/^[\u2039\u2190]\s*/, ''))}</a>`; };
const doneBox = (title, line) => `<div class="gb-done" role="status"><div class="gb-done-tick" aria-hidden="true">✓</div><h2>${esc(title)}</h2><p>${esc(line)}</p>` +
  `<div class="gb-row-acts">${wayBack('gb-btn gb-btn-primary')}</div></div>`;
const TRANSIENT = /timed? ?out|try again|too many|temporar|lock|failed to fetch|network|service/i;
const S = { session: null, data: null, day: 0, open: null, queued: [], others: 0, sending: false };
const mine = (r) => String(r.by || '').toLowerCase() === String(S.session.email || '').toLowerCase();
const sameUser = (s) => !!s && String(s.email || '').toLowerCase() === String(S.session.email || '').toLowerCase();

async function boot() {
  const s = await LMCS.requireSession('#authRoot');
  $('authRoot').style.display = 'none';
  $('appBody').hidden = false;
  if (!(LMCS.canViewCoordinatorPortal(s) || LMCS.hasRole(s, 'FeeClerk'))) { $('appBody').innerHTML = '<div class="denied">The roll call is for Fee Clerks, Coordinators and the Owner.</div>'; return; }
  S.session = s;
  $('retry').addEventListener('click', load);
  document.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => {
    S.day = Number(b.dataset.day); S.open = null;
    document.querySelectorAll('[data-day]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    load();
  }));
  addEventListener('online', () => sendQueued());
  await load();
  sendQueued();
}

async function load() {
  $('loadMsg').hidden = false; $('loadMsg').firstElementChild.textContent = 'Loading the buses…'; $('retry').hidden = true;
  try {
    const s = LMCS.getSession() || S.session, want = S.day ? 'yesterday' : '';
    let r = await (await fetch(COORD_URL + '?action=coordinatortransportrollcall&idToken=' + encodeURIComponent(s.idToken), { cache: 'no-store' })).json();
    if (r.success && want) { // the server's "today" decides what yesterday is
      const d = new Date(r.today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1);
      r = await (await fetch(COORD_URL + '?action=coordinatortransportrollcall&date=' + d.toISOString().slice(0, 10) + '&idToken=' + encodeURIComponent(s.idToken), { cache: 'no-store' })).json();
    }
    if (!r.success) throw new Error(r.error || 'Request failed');
    S.data = r;
    $('loadMsg').hidden = true;
  } catch (e) {
    $('loadMsg').firstElementChild.textContent = 'Could not load the buses (' + e.message + '). Check the connection, then try again.';
    $('retry').hidden = false;
  }
  await refresh();
}

async function refresh() {
  const all = (await store.runs()).filter((r) => r.roll);
  S.queued = all.filter(mine).sort((a, b) => a.startedAt - b.startedAt);
  S.others = all.length - S.queued.length;
  drawPending();
  draw();
}

// The day's roll for a bus: my save waiting on this phone first, else the server's row.
const waiting = (reg) => S.data && S.queued.filter((r) => r.reg === reg && r.roll.date === S.data.date).pop();
const who = (r) => [r.driver + (r.driverSub ? ' (substitute)' : ''), r.attendant ? r.attendant + (r.attendantSub ? ' (substitute)' : '') : 'no attendant'].join(' · ');

function draw() {
  if (!S.data) { $('buses').innerHTML = ''; $('summary').textContent = ''; return; }
  const buses = S.data.buses.slice().sort((a, b) => a.campus.localeCompare(b.campus) || a.reg.localeCompare(b.reg));
  const done = buses.filter((b) => b.roll || waiting(b.reg)).length;
  $('summary').textContent = buses.length ? `${done} of ${buses.length} buses recorded.` : '';
  const card = buses.length && done === buses.length ? doneBox('Roll call done for today', `All ${buses.length} buses recorded.`) : '';
  if (draw.card !== card) { draw.card = card; $('rcDone').innerHTML = card; } // only when it changes, so it is announced once
  $('buses').innerHTML = !buses.length ? '<li class="cap-note">No running buses on your account.</li>' : buses.map((b) => {
    const w = waiting(b.reg), r = w ? w.roll : b.roll, u = b.usual || {};
    const usual = u.driver ? `Usual: ${esc(u.driver)} · ${esc(u.attendant || 'no attendant')}` : 'No usual driver on record. Use Substitute.';
    const line = w && w.status === 'error' ? `<p class="fs-bad">Not saved: ${esc(w.error)}</p>`
      : w ? `<p class="rc-wait">Saved on this phone: ${esc(who(r))}</p>`
      : r ? `<p class="rc-done">On duty: ${esc(who(r))}</p>` : '<p>Not recorded yet</p>';
    return `<li data-reg="${esc(b.reg)}"><b>${esc(b.reg)}</b> <span class="cap-note">${esc(b.campus)}</span><p>${usual}</p>${line}` +
      (S.open === b.reg ? subForm(b, r) : `<div class="rc-acts"><button type="button" class="cap-btn rc-on" data-a="on"${u.driver ? '' : ' disabled'}>On duty</button>` +
        '<button type="button" class="cap-btn" data-a="sub">Substitute</button></div>') + '</li>';
  }).join('');
  $('buses').querySelectorAll('[data-a]').forEach((btn) => btn.addEventListener('click', () => act(btn)));
}

function subForm(b, r) {
  const u = b.usual || {}, names = [...new Set([u.driver, u.attendant, ...((S.data.names || {})[b.campusId] || [])].filter(Boolean))].sort();
  const pick = (id, label, cur, blank) => `<label for="${id}">${label}</label><select id="${id}" class="cap-select">` +
    (blank ? `<option value="">${blank}</option>` : '') + names.map((n) => `<option${n === cur ? ' selected' : ''}>${esc(n)}</option>`).join('') + '</select>';
  return `<div class="rc-sub">${pick('rcDriver', 'Driver', (r && r.driver) || u.driver, u.driver ? '' : 'Choose…')}${pick('rcAtt', 'Attendant', (r && r.attendant) || u.attendant, 'No attendant')}` +
    '<div class="rc-acts"><button type="button" class="cap-btn rc-on" data-a="save">Save</button><button type="button" class="cap-btn" data-a="cancel">Cancel</button></div></div>';
}

async function act(btn) {
  const reg = btn.closest('[data-reg]').dataset.reg, b = S.data.buses.find((x) => x.reg === reg), u = b.usual || {};
  const a = btn.dataset.a;
  if (a === 'sub') { S.open = reg; draw(); const d = $('rcDriver'); if (d) d.focus(); return; }
  if (a === 'cancel') { S.open = null; draw(); return; }
  let roll;
  if (a === 'on') roll = { driver: u.driver, attendant: u.attendant || '', driverSub: false, attendantSub: false };
  else {
    const driver = $('rcDriver').value, attendant = $('rcAtt').value;
    if (!driver) { toast('Pick the driver.'); return; }
    roll = { driver, attendant, driverSub: driver !== u.driver, attendantSub: !!attendant && attendant !== (u.attendant || '') };
  }
  roll.date = S.data.date;
  try {
    for (const old of S.queued.filter((r) => r.reg === reg && r.roll.date === roll.date)) await store.discard(old.id); // the newer save wins
    const run = await store.newRun({ reg, kind: 'rollcall', campus: b.campusId, by: S.session.email, role: S.session.role });
    await store.patchRun(run.id, { roll });
    await store.endRun(run.id);
  } catch (e) { toast(e.code === 'STORAGE_FULL' ? 'The phone is full. Free some space, then try again.' : 'Not saved on this phone: ' + e.message, true); return; }
  S.open = null;
  await refresh();
  toast(`${reg} recorded.`);
  sendQueued();
}

async function postCoord(body) {
  const s = LMCS.getSession();
  if (!s) return { success: false, signIn: true, error: 'Sign in again to send' };
  try { return JSON.parse(await (await fetch(COORD_URL, { method: 'POST', body: JSON.stringify({ idToken: s.idToken, ...body }) })).text()); }
  catch (e) { return { success: false, network: true, error: 'No connection' }; }
}
async function signInThenSend() {
  $('authRoot').style.display = ''; scrollTo(0, 0);
  const s = await LMCS.requireSession('#authRoot');
  $('authRoot').style.display = 'none';
  if (!sameUser(s)) { location.reload(); return; } // someone else signed in: every list and send is theirs (Ruling 37)
  sendQueued();
}
async function sendQueued() {
  if (S.sending) return;
  S.sending = true; drawPending();
  let changed = false;
  try {
    for (const run of (await store.runs()).filter((r) => r.roll && mine(r) && r.status !== 'error').sort((a, b) => a.startedAt - b.startedAt)) {
      if (!sameUser(LMCS.getSession())) break;
      const res = await postCoord({ action: 'coordinatortransportrollcall', reg: run.reg, ...run.roll });
      if (res.success) { await store.discard(run.id); changed = true; continue; }
      if (res.signIn || res.network || TRANSIENT.test(res.error || '')) break;
      await store.patchRun(run.id, { status: 'error', error: res.error });
    }
  } finally {
    S.sending = false;
    if (changed) await load(); else await refresh();
  }
}
function drawPending() {
  const q = S.queued, bad = q.filter((r) => r.status === 'error'), wait = q.length - bad.length;
  $('others').textContent = S.others ? `${S.others} ${S.others === 1 ? 'save is' : 'saves are'} waiting on this phone for another person. They send it when they sign in here.` : '';
  $('pending').hidden = !(wait || (S.sending && q.length));
  const signedOut = !LMCS.getSession();
  $('pendingText').textContent = S.sending ? 'Sending…' : wait ? `${wait} ${wait === 1 ? 'save is' : 'saves are'} waiting to send.` + (signedOut ? ' Sign in to send.' : '') : '';
  $('sendNow').hidden = S.sending || !wait;
  $('sendNow').textContent = signedOut ? 'Sign in' : 'Send now';
  $('sendNow').onclick = signedOut ? signInThenSend : () => sendQueued();
  $('refused').innerHTML = bad.map((r) => `<li data-id="${esc(r.id)}"><p><b>Roll call for ${esc(r.reg)} (${esc(r.roll.date)}) was not saved.</b> ${esc(r.error)}</p>` +
    '<button type="button" class="cap-btn" data-r="again">Try again</button> <button type="button" class="cap-btn" data-r="drop">Discard</button></li>').join('');
  $('refused').querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.closest('[data-id]').dataset.id, run = await store.getRun(id).catch(() => null);
    if (!run || !mine(run)) return; // never someone else's save
    if (b.dataset.r === 'drop') {
      if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Tap again to discard'; return; }
      await store.discard(id);
    } else await store.patchRun(id, { status: 'ended', error: null });
    await refresh(); if (b.dataset.r === 'again') sendQueued();
  }));
}

let toastT;
function toast(msg, long) { $('toast').textContent = msg; clearTimeout(toastT); toastT = setTimeout(() => { $('toast').textContent = ''; }, long ? 9000 : 3500); }

boot();
