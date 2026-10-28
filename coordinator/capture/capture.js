// Capture page (coordinator/transport/capture.html). A Coordinator rides a bus with a school phone in a dashboard mount.
// Spec: docs/superpowers/specs/2026-10-25-transport-game-design.md, Loop 6. Guide: docs/transport-game/capture-guide.md.
// - Timelapse (default): rear camera, a frame every ~15 m of GPS travel (geo.js), STOP HERE tags a stop with a photo.
// - Count run: no camera at all. STOP HERE plus how many children got on and off; the summary sets the peak load against
//   the seats and the load cap (loadCapFactor() x seats).
// - Inspection: the monthly safety check, bus parked. One card per item of the Owner's safety loadout (Coordinator backend
//   action=coordinatortransportloadout): Yes/No, a photo when the item needs one (the phone's own camera, not the timelapse
//   viewfinder), a date when it needs one. Saved as an 'inspection' run: photos as kind 'inspection' files, the answers in
//   the run's Inspection JSON {itemId: {ok, date?, fileId?}} (uploader.js swaps each photo's seq for its Drive file id).
// Everything is saved on the phone first (run-store.js) and sent later from the Upload tab (uploader.js -> Roster web app).
// Never shows speed or trip time, and no sound.
import { shouldCapture, distanceM } from './geo.js';
import { createCaptureIdb, createRunStore } from './run-store.js';
import { wantsDriverMode, TOKEN_KEY } from './driver-mode.js';
import { createUploader } from './uploader.js';

const COORD_URL = 'https://script.google.com/macros/s/AKfycbwilcvrgZQga_qo1A-fBTUzKLifrBYIwlPHoWMITmchf5sZOYjKIJ7_4J0TeBF_-6B6/exec'; // = BACKEND_URL in coordinator/shared.js
const ROSTER_URL = 'https://script.google.com/macros/s/AKfycbyHiaZY_iWK2VTKKFJcCsBNnIbUndJYUSjnPkxvJ-dYavaihiul2xBJuJohPRsP9Spf/exec'; // = ROSTER_URL in assets/auth.js
const FULL_MSG = 'The phone is full. Upload on Wi-Fi now, then carry on.';
const KIND = { timelapse: 'Timelapse', count: 'Count run', inspection: 'Safety check' };
const START = { timelapse: 'timelapse', count: 'count run', inspection: 'safety check' };
const HELP = {
  timelapse: 'Photo run: a frame every 15 m and one photo at each stop. Outside school hours only.',
  count: 'School run, no camera: count the children who get on and off at each stop.',
  inspection: 'Monthly safety check with the bus parked: one card per item it must carry. Photograph the item only, never children or people.',
};
// Goals are config: the load cap factor (a bus may carry up to 1.4 x its seats) is a Game Config default in fleet-quests.js,
// loaded by capture.html before this module, so the Game Backend can override it later.
const loadCapFactor = () => window.FleetQuests.questConfig().loadCapFactor;
const STATE = {
  uploading: 'Sending…', retrying: 'No answer from the server. Trying again shortly.', 'waiting-online': 'No connection. Sending resumes when it is back.',
  stopped: 'Stopped.', done: 'Sent.', 'not-ended': 'Sends once the safety check is saved.', 'uploaded-so-far': 'Sent so far. The rest goes when the run has ended.',
};

const store = createRunStore(createCaptureIdb());
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const when = (ms) => { const d = new Date(ms); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const mb = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b < 1e6 ? 'under 1 MB' : Math.round(b / 1e6) + ' MB');
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const normReg = (r) => String(r || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

const S = {
  session: null, mode: 'timelapse', buses: [], resumeId: null,
  run: null, active: false, fix: null, last: null, busy: false, stream: null, watch: null, wake: null,
  camWanted: false, camReady: false, camP: null,
  stop: null, sending: false, progress: {},
  loadout: undefined, insp: null, // the safety loadout list; the safety check being filled in {items, answers, thumbs}
};
const canvas = document.createElement('canvas');
// The school phone is shared (Ruling 41). Anyone signed in may SEND any run: it keeps its capturer (uploader.js sends run.by as
// capturedBy). Only the run's author may carry on, end or discard an unfinished one, or answer its safety check; anyone else
// sees a count. A sign-in as someone else reloads the page, so nothing of the first person's stays open under the second.
const lower = (x) => String(x || '').toLowerCase();
const mine = (r) => lower(r.by) === lower(S.session.email);
const sameUser = (s) => !!s && lower(s.email) === lower(S.session.email);

// ── Boot ──
// Offline mode: on a bus there is often no signal, and an expired Google sign-in needs the network. Who signed in here is
// remembered on every good boot; for 14 days after, the page opens for capture without a valid sign-in (bus list from the
// phone). Sending always needs a fresh sign-in; capture never uses the token.
const ID_KEY = 'lmcs-capture-identity', ID_DAYS = 14;
const allowed = (s) => LMCS.canViewCoordinatorPortal(s) || LMCS.hasRole(s, 'FeeClerk');
function cachedIdentity() {
  try { const id = JSON.parse(localStorage.getItem(ID_KEY) || 'null'); return id && Date.now() - id.signedInAt < ID_DAYS * 864e5 ? id : null; }
  catch (e) { return null; }
}
function rememberIdentity(s) {
  try { localStorage.setItem(ID_KEY, JSON.stringify({ email: s.email, role: s.role, campusId: s.campusId, signedInAt: Date.now() })); } catch (e) { /* full */ }
}
async function boot() {
  try { await store.recover(); } catch (e) { /* no IndexedDB: the Start button reports it */ }
  let s = LMCS.getSession();
  if (wantsDriverMode(location.search, storedToken(), s)) return driverBoot();
  const offline = !s && cachedIdentity();
  if (!s) s = offline || await LMCS.requireSession('#authRoot');
  $('authRoot').style.display = 'none';
  const main = $('appBody');
  main.hidden = false;
  if (!allowed(s)) {
    main.innerHTML = '<div class="denied">Capture is for Coordinators, Fee Clerks and the Owner.</div>';
    return;
  }
  if (!offline) rememberIdentity(s);
  $('offline').hidden = !offline;
  if (!LMCS.canViewCoordinatorPortal(s)) { $('back').href = '../../office/buses.html'; $('back').textContent = '\u2039 Live Buses'; } // Fee Clerk
  S.session = s;
  wire();
  const want = new URLSearchParams(location.search); // from the Fleet setup quests: ?mode=inspection&reg=HP659511
  setMode(HELP[want.get('mode')] ? want.get('mode') : 'timelapse');
  S.wantReg = normReg(want.get('reg'));
  battery();
  loadBuses();
  loadLoadout();
  drawResume().then((open) => { // an unfinished count run or safety check is waiting: open its mode, not Timelapse
    const last = open.sort((a, b) => b.startedAt - a.startedAt)[0];
    if (!HELP[want.get('mode')] && last && last.kind !== S.mode && !S.resumeId && !$('setup').hidden) setMode(last.kind);
  });
  drawUpload();
  // leaving mid-run (the header's back link, a reload) stops the camera and GPS: ask first. The run itself stays on the phone.
  addEventListener('beforeunload', (e) => { if (S.active) { e.preventDefault(); e.returnValue = ''; } });
}

// Driver mode (driver-mode.js): the linked bus only, timelapse only, no sign-in. driverme says which bus; the answer is kept on the
// phone so a bus with no signal still opens. A phone the office has unlinked is told so and records nothing.
const BUS_KEY = 'lmcs-capture-driverbus';
function storedToken() { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
async function driverBoot() {
  $('authRoot').style.display = 'none';
  const main = $('appBody');
  main.hidden = false;
  let me = null;
  try {
    const r = JSON.parse(await (await fetch(ROSTER_URL, { method: 'POST', body: JSON.stringify({ action: 'driverme', deviceToken: storedToken() }) })).text());
    if (!r.success && r.code !== 'UNLINKED') throw new Error(r.error || 'no answer'); // passing: use the saved bus, keep the link
    if (!r.success) { try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(BUS_KEY); } catch (e) { /* nothing kept */ } main.innerHTML = '<div class="denied">' + esc(r.error || 'This phone is not linked. Ask the office for a new link.') + '</div>'; return; }
    me = { name: r.name, reg: r.reg, campus: r.campus };
    try { localStorage.setItem(BUS_KEY, JSON.stringify(me)); } catch (e) { /* full */ }
  } catch (e) { try { me = JSON.parse(localStorage.getItem(BUS_KEY) || 'null'); } catch (e2) { me = null; } }
  if (!me) { main.innerHTML = '<div class="denied">Could not check this phone. Open this page once with signal.</div>'; return; }
  S.driver = me;
  S.session = { email: 'driver:' + normReg(me.reg), role: 'Driver', idToken: null, driver: true };
  S.buses = [{ reg: me.reg, route: '', campus: me.campus, operational: true, stops: [] }];
  $('back').href = '../../driver/'; $('back').textContent = '\u2039 होम · Home';
  document.querySelectorAll('[data-mode]').forEach((b) => { b.hidden = b.dataset.mode !== 'timelapse'; });
  $('offline').hidden = true;
  wire();
  setMode('timelapse');
  $('bus').innerHTML = `<option value="${esc(me.reg)}">${esc(me.reg)}</option>`;
  $('bus').value = me.reg;
  driverLabels();
  battery();
  drawResume();
  drawUpload();
  addEventListener('beforeunload', (e) => { if (S.active) { e.preventDefault(); e.returnValue = ''; } });
}
const signedIn = () => !!(S.driver || LMCS.getSession()); // a linked driver phone counts: it posts deviceToken

function wire() {
  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { if (S.resumeId) { S.resumeId = null; drawResume(); } setMode(b.dataset.mode); }));
  $('start').addEventListener('click', start);
  $('stopHere').addEventListener('click', openSheet);
  $('end').addEventListener('click', endClick);
  $('send').addEventListener('click', sendAll);
  $('signIn').addEventListener('click', () => signIn());
  // a tap on the dim backdrop closes the sheet, except while aiming the stop photo: then the "backdrop" is the viewfinder
  $('sheetWrap').addEventListener('click', (e) => { if (e.target === $('sheetWrap') && !$('sheetWrap').classList.contains('cap-aim')) closeSheet(); });
  $('inspSave').addEventListener('click', saveInspection);
  $('inspPhoto').addEventListener('change', onInspPhoto);
  $('slots').addEventListener('click', (e) => { const li = e.target.closest('li'); if (li && S.insp) jump(S.insp.items[[...$('slots').children].indexOf(li)].id); });
  $('fixCount').addEventListener('click', openFix);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('sheetWrap').hidden) closeSheet(); });
  document.addEventListener('visibilitychange', onVisibility);
}

function showTab(tab) {
  document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
  $('tabCapture').hidden = tab !== 'capture';
  $('tabUpload').hidden = tab !== 'upload';
  if (tab === 'upload') drawUpload();
}

function setMode(mode) {
  S.mode = mode;
  document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  $('modeHelp').textContent = HELP[mode] || '';
  $('privacyRow').hidden = mode !== 'timelapse';
  $('hint').hidden = $('battery').hidden = mode === 'inspection'; // a parked bus: no charger, no screen-on worries
  $('privacy').checked = false; // asked again before every timelapse start
  $('start').textContent = (S.resumeId ? 'Carry on the ' : 'Start ') + START[mode];
  $('setupMsg').textContent = '';
  loadoutLine();
  if (S.driver) driverLabels();
}
// Driver mode speaks Hindi first (a driver may read little; driver/index.html does the same), English small after it
function driverLabels() {
  const t = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };
  document.querySelector('.hdr h1').textContent = 'रूट वीडियो · Route video';
  document.querySelector('.cap-modes').hidden = true; // one kind of run only
  t('modeHelp', 'बस चलाते समय फ़ोन डैशबोर्ड पर लगाएँ। हर स्टॉप पर "यहाँ स्टॉप" दबाएँ। · Phone on the dashboard; tap STOP HERE at every stop.');
  document.querySelector('label[for="bus"]').hidden = $('bus').hidden = true; // one bus: no picker, just say which
  t('busNote', 'बस ' + S.driver.reg + ' · आपकी बस · Your bus');
  $('busNote').className = 'cap-hint';
  document.querySelector('#privacyRow span').textContent = 'स्कूल टाइम के बाद, बस में कोई बच्चा नहीं · Outside school hours, no children on board';
  t('hint', 'चार्जर लगाएँ, स्क्रीन चालू रखें · Plug in the charger and keep the screen on.');
  t('start', (S.resumeId ? 'जारी रखें · Carry on' : '🎥 रिकॉर्ड शुरू करें · Start'));
  t('stopHere', 'यहाँ स्टॉप · STOP HERE');
  t('end', 'रूट खत्म · End run');
  document.querySelector('[data-tab="capture"]').firstChild.textContent = 'रिकॉर्ड · Record';
  document.querySelector('[data-tab="upload"]').firstChild.textContent = 'भेजें · Send ';
}
// Inspection: what the check holds before it starts ("10 items, 4 need a photo"), from the list saved on the phone.
function loadoutLine() {
  const L = S.loadout, el = $('loNote');
  el.hidden = S.mode !== 'inspection' || L === undefined; // undefined: still loading
  if (el.hidden) return;
  const p = L ? L.filter((i) => i.needsPhoto).length : 0;
  el.textContent = !L ? 'The safety list is not on this phone yet. Open this page on Wi-Fi once.'
    : `${plural(L.length, 'item')}, ${p ? p + (p === 1 ? ' needs' : ' need') + ' a photo' : 'no photos'}.`;
}

async function battery() {
  if (!navigator.getBattery) return;
  try {
    const b = await navigator.getBattery();
    const show = () => { $('battery').textContent = `Battery ${Math.round(b.level * 100)}%` + (b.charging ? ', charging.' : ': not charging. Plug in the charger.'); };
    show(); b.addEventListener('chargingchange', show); b.addEventListener('levelchange', show);
  } catch (e) { /* not available */ }
}

// ── Buses and their known stops (Coordinator backend; Fee Clerks get the fleet list without GPS stops) ──
async function getJson(action) {
  const r = await (await fetch(COORD_URL + '?action=' + action + '&idToken=' + encodeURIComponent(S.session.idToken), { cache: 'no-store' })).json();
  if (!r.success) throw new Error(r.error || 'Request failed');
  return r;
}
function stopsOf(rows, reg) { // one entry per place the GPS sees this bus stop at (waits left out)
  const seen = {};
  return rows.filter((s) => s.bus === reg && s.trip !== 'WAIT' && s.place && !seen[s.place] && (seen[s.place] = true))
    .map((s) => ({ name: String(s.place), lat: Number(s.lat), lng: Number(s.lng) }));
}
async function loadBuses() {
  const key = 'lmcs-capture-buses:' + S.session.email;
  let note = '';
  try {
    if (!S.session.idToken) throw new Error('offline mode'); // capture only: the saved list
    let list;
    try {
      const d = await getJson('coordinatortransportinsight');
      list = d.vehicles.map((v) => ({ reg: v.reg, route: v.route, seats: v.seats, campus: v.campus, operational: v.operational, stops: stopsOf(d.stops || [], v.reg) }));
    } catch (e) {
      if (!/authori/i.test(e.message)) throw e;
      list = (await getJson('coordinatortransport')).fleet.map((b) => ({ reg: b.reg, route: b.route, seats: b.seats, campus: b.campus, operational: b.operational, stops: [] }));
    }
    S.buses = list.filter((b) => b.operational !== false).sort((a, b) => a.reg.localeCompare(b.reg));
    try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), buses: S.buses })); } catch (e) { /* full */ }
  } catch (err) {
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { /* ignore */ }
    if (cached) { S.buses = cached.buses; note = (S.session.idToken ? 'No connection: using' : 'Using') + ' the bus list saved on ' + when(cached.at) + '.'; }
    else note = 'Could not load the buses (' + err.message + '). Open this page on Wi-Fi once before the ride.';
  }
  const sel = $('bus');
  sel.innerHTML = S.buses.length
    ? '<option value="">Pick the bus</option>' + S.buses.map((b) => `<option value="${esc(b.reg)}">${esc(b.reg)}${b.route ? ' (' + esc(routeName(b, b.reg)) + ')' : ''}</option>`).join('')
    : '<option value="">No buses</option>';
  if (S.wantReg && busOf(S.wantReg)) sel.value = busOf(S.wantReg).reg;
  if (!S.buses.length && !note) note = 'No running buses on your account.';
  $('busNote').textContent = note;
  $('busNote').classList.toggle('cap-bad', !S.buses.length); // nothing to pick: an error, not a grey aside
  if (S.run) hud();
}
const busOf = (reg) => S.buses.find((b) => normReg(b.reg) === normReg(reg));
const routeName = (bus, reg) => { const r = bus && String(bus.route || '').trim(); return !r ? reg : /^\d+$/.test(r) ? 'Route ' + r : r; };
// The safety loadout (active items, in the Owner's order), kept on the phone like the bus list so a check works without signal.
async function loadLoadout() {
  const key = 'lmcs-capture-loadout:' + S.session.email;
  try {
    if (!S.session.idToken) throw new Error('offline mode');
    S.loadout = (await getJson('coordinatortransportloadout')).items;
    try { localStorage.setItem(key, JSON.stringify(S.loadout)); } catch (e) { /* full */ }
  } catch (err) {
    try { S.loadout = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { S.loadout = null; }
  }
  loadoutLine();
}

// ── Unfinished runs (the page was closed mid-run): carry on, or end them ──
async function drawResume() {
  const all = (await store.runs()).filter((r) => !r.endedAt), open = all.filter(mine), others = all.length - open.length;
  $('resume').innerHTML = open.map((r) => `<div class="cap-resume" data-id="${esc(r.id)}"><p><b>${esc(KIND[r.kind])} on ${esc(r.reg)}</b> from ${when(r.startedAt)} is still open.</p>` +
    `<button type="button" class="cap-btn" data-a="carry">Carry on</button> <button type="button" class="cap-btn" data-a="end">${r.kind === 'inspection' ? 'Discard it' : 'End it'}</button></div>`).join('') +
    (others ? `<p class="cap-note">${others === 1 ? 'One unfinished run is' : others + ' unfinished runs are'} waiting on this phone for another person. Only they can carry on or end it.</p>` : '');
  $('resume').querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', async () => {
    const run = await store.getRun(b.closest('[data-id]').dataset.id).catch(() => null);
    if (!run || !mine(run)) return drawResume(); // gone (another tab), or never someone else's run
    if (b.dataset.a === 'end' && run.kind === 'inspection') { // an unsaved check is thrown away, photos and all: two taps, nothing is sent
      if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Tap again to discard its photos'; setTimeout(() => { delete b.dataset.armed; b.textContent = 'Discard it'; }, 4000); return; }
      await store.discard(run.id); drawResume(); drawUpload(); return;
    }
    if (b.dataset.a === 'end') { await store.endRun(run.id); drawResume(); drawUpload(); return; }
    S.resumeId = run.id;
    $('resume').innerHTML = '';
    setMode(run.kind);
    const bus = busOf(run.reg);
    $('bus').value = bus ? bus.reg : '';
    $('setupMsg').textContent = run.kind === 'timelapse' ? 'Tick the box, then tap Carry on.' : '';
  }));
  return open;
}

// ── Start a run ──
function setupSay(msg) { $('setupMsg').textContent = msg; }
function camMsg(e) {
  if (e && e.name === 'NotAllowedError') return 'The camera is blocked. Allow the camera for this site in the browser settings, then tap Start again.';
  if (e && e.name === 'NotFoundError') return 'This phone has no rear camera the browser can use.';
  return 'The camera is not available in this browser. Use the school phone in Chrome, or do a count run.';
}
// One camera at a time (concurrent calls share the promise). A stream that arrives after the run ended or the page was
// hidden (camWanted false) is stopped at once. grab() waits for camReady: a frame decoded from this stream, so an old
// picture is never saved against a new GPS fix.
// closeCamera drops the shared promise, so an open still in flight (hidden and back within the first-frame wait) is stale: the
// next openCamera starts afresh, and the stale one stops whatever stream it still gets.
function openCamera() {
  if (S.camP) return S.camP;
  const p = S.camP = (async () => {
    if (S.stream && S.stream.getVideoTracks().some((t) => t.readyState === 'live')) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('no camera API');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    if (!S.camWanted || S.camP !== p) { stream.getTracks().forEach((t) => t.stop()); return; }
    S.stream = stream;
    const v = $('cam');
    v.srcObject = stream;
    await v.play().catch(() => {});
    await Promise.race([new Promise((r) => setTimeout(r, 3000)), // never hang here (a stream stopped before its first frame)
      new Promise((r) => (v.requestVideoFrameCallback ? v.requestVideoFrameCallback(() => r()) : v.addEventListener('timeupdate', () => r(), { once: true })))]);
    if (S.stream === stream) S.camReady = true;
  })().finally(() => { if (S.camP === p) S.camP = null; });
  return p;
}
function closeCamera() {
  S.camReady = false; S.camP = null;
  if (S.stream) S.stream.getTracks().forEach((t) => t.stop());
  S.stream = null;
  $('cam').srcObject = null;
}
async function holdScreen() {
  try { S.wake = await navigator.wakeLock.request('screen'); }
  catch (e) { S.wake = null; runSay('This browser cannot keep the screen on. Set the screen timeout to the longest.'); }
}

async function start() {
  if ($('start').disabled) return;
  $('start').disabled = true; // before any await: a double tap must not make two watches or two streams
  try {
    const resume = S.resumeId ? await store.getRun(S.resumeId).catch(() => null) : null;
    if (resume && !mine(resume)) { S.resumeId = null; drawResume(); return setupSay('That run belongs to another person.'); }
    const kind = resume ? resume.kind : S.mode, reg = resume ? resume.reg : $('bus').value;
    if (!reg) return setupSay('Pick the bus first.');
    if (kind === 'inspection') return await startInspection(resume, reg);
    if (kind === 'timelapse' && !$('privacy').checked) return setupSay('Tick the box first: outside school hours, no children on board.');
    if (!navigator.geolocation) return setupSay('This browser has no location. Use the school phone in Chrome.');
    if (kind === 'timelapse') {
      S.camWanted = true;
      try { await openCamera(); } catch (e) { S.camWanted = false; return setupSay(camMsg(e)); } // no camera, no run
    }
    const bus = busOf(reg);
    try {
      S.run = resume || await store.newRun({ reg, kind, campus: bus && bus.campus, by: S.session.email, role: S.session.role });
    } catch (e) {
      S.camWanted = false; closeCamera();
      return setupSay(e.code === 'STORAGE_FULL' ? FULL_MSG : 'Could not save on this phone: ' + e.message);
    }
    if (resume) { // the page was closed mid-run: nothing was captured from the last thing on record until now
      // ponytail: frames already sent are not counted here (pending only), so a run uploaded mid-ride may get a longer gap
      const at = Math.max(resume.startedAt, ...resume.gaps.map((g) => g.to), ...resume.stops.map((x) => x.takenAt || 0),
        ...(await store.pending(resume.id)).map((f) => f.takenAt || 0));
      await store.markGap(resume.id, at, Math.max(at, Date.now())).catch(() => {});
      S.run = await store.getRun(resume.id);
    }
    S.resumeId = null; S.active = true; S.fix = null; S.last = null;
    $('setup').hidden = true; $('summary').hidden = true; $('running').hidden = false;
    $('offline').hidden = true; // during a run STOP HERE keeps the space; the summary and Upload offer the sign-in again
    $('camBox').hidden = kind !== 'timelapse'; $('countBox').hidden = kind !== 'count';
    runSay('');
    S.watch = navigator.geolocation.watchPosition(onFix, onGpsError, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
    await holdScreen();
    hud(); gpsLine();
  } finally { $('start').disabled = false; }
}

// ── During a run ──
function runSay(msg) { $('runMsg').textContent = msg; }
function load(stops) { // children on board after each stop, and the most at any point
  let now = 0, peak = 0;
  const after = stops.map((s) => { now += (s.boardOn || 0) - (s.boardOff || 0); peak = Math.max(peak, now); return now; });
  return { now, peak, after };
}
function hud() {
  const run = S.run, bus = busOf(run.reg), known = bus ? bus.stops.length : 0, tagged = run.stops.length, total = known && Math.max(known, tagged); // no known stops: just count up
  const [verb, done] = run.kind === 'count' ? ['Count', 'counted'] : ['Capture', 'tagged'];
  $('mission').textContent = `${verb} ${routeName(bus, run.reg)}: ` + (total ? `${tagged} of ${total} stops ${done}` : `${plural(tagged, 'stop')} ${done}`);
  $('barWrap').hidden = !total;
  $('barWrap').classList.toggle('cap-pips', total > 0 && total <= 40); // one pip per stop while they are wide enough to see
  $('barWrap').style.setProperty('--n', String(total || 1));
  $('bar').style.width = total ? (100 * tagged / total) + '%' : '0';
  $('barWrap').setAttribute('aria-valuenow', String(tagged)); $('barWrap').setAttribute('aria-valuemax', String(total));
  $('frames').textContent = plural(run.frames, 'frame');
  if (run.kind === 'count') {
    const seats = Number(bus && bus.seats);
    $('onboard').textContent = load(run.stops).now;
    $('seats').textContent = seats ? `${seats} seats` : ''; // the load cap is for the summary only
    const last = run.stops[run.stops.length - 1]; // a miscount is put right before the next stop
    $('fixCount').hidden = !last;
    if (last) { $('fixCount').textContent = 'Change count: ' + (last.name || 'last stop'); $('fixCount').setAttribute('aria-label', 'Change the count at ' + (last.name || 'the last stop')); }
  }
}
function gpsLine() {
  const f = S.fix;
  $('gps').dataset.s = !f ? 'wait' : f.accuracy > 50 ? 'weak' : 'ok';
  $('gps').textContent = !f ? 'Waiting for GPS…' : f.accuracy > 50 ? `GPS weak (±${Math.round(f.accuracy)} m): frames paused` : `GPS ±${Math.round(f.accuracy)} m`;
}
function onGpsError(e) {
  $('gps').dataset.s = e.code === 1 ? 'bad' : 'wait';
  $('gps').textContent = e.code === 1 ? 'Location is blocked. Allow location for this site, then come back.' : 'No GPS signal yet. Keep the phone near the windscreen.';
}
function grab() { // a camera frame, longest side 1280 px (720p), JPEG 0.7, as base64
  const v = $('cam'), w = v.videoWidth, h = v.videoHeight;
  if (!S.camReady || !w || !h) return null;
  const k = Math.min(1, 1280 / Math.max(w, h));
  canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
  canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
}
async function onFix(p) {
  const fix = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: p.timestamp || Date.now() };
  S.fix = fix; gpsLine();
  if (!S.active || S.run.kind !== 'timelapse' || S.busy || document.hidden || !shouldCapture(S.last, fix)) return;
  const base64 = grab();
  if (!base64) return;
  S.busy = true;
  try {
    await store.addFrame(S.run.id, { lat: fix.lat, lng: fix.lng, takenAt: fix.at, base64 });
    S.last = fix; S.run.frames++; hud();
    if ($('runMsg').textContent === FULL_MSG) runSay('');
  } catch (e) { runSay(e.code === 'STORAGE_FULL' ? FULL_MSG : 'Frame not saved: ' + e.message); }
  finally { S.busy = false; }
}
// Hidden (locked, or another app): capture pauses and the gap is on record at once; back: it carries on.
async function onVisibility() {
  if (!S.active) return;
  const id = S.run.id;
  const photo = S.run.kind === 'timelapse';
  if (document.hidden) {
    store.openGap(id, Date.now()).catch(() => {});
    if (photo) { S.camWanted = false; closeCamera(); } // the camera is off while away
    return;
  }
  await store.closeGap(id, Date.now()).catch(() => {});
  S.run = await store.getRun(id);
  toast('Welcome back. The time away is marked as a gap.');
  await holdScreen();
  if (photo && S.active) { S.camWanted = true; openCamera().catch((e) => runSay(camMsg(e))); }
}

// ── STOP HERE sheet ──
function openSheet() {
  const f = S.fix;
  S.stop = { lat: f ? f.lat : undefined, lng: f ? f.lng : undefined, takenAt: Date.now(), name: '', on: 0, off: 0, step: 'pick' };
  $('sheetWrap').hidden = false;
  drawSheet();
  behindSheet(true);
}
function openFix() { // the last stop's count, put right: the same counters, saved over the old numbers (store.setCount)
  const last = S.run.stops[S.run.stops.length - 1];
  if (!last) return;
  S.stop = { fix: last.seq, name: last.name || 'Last stop', on: last.boardOn || 0, off: last.boardOff || 0, step: 'next' };
  $('sheetWrap').hidden = false;
  drawSheet();
  behindSheet(true);
}
function closeSheet() { $('sheetWrap').hidden = true; behindSheet(false); S.stop = null; $('stopHere').focus(); }
function behindSheet(on) { // the sheet is modal: keyboard and screen reader stay inside it
  document.querySelectorAll('.hdr, #appBody > :not(#sheetWrap):not(#toast)').forEach((el) => { el.inert = on; });
}
function drawSheet() {
  const st = S.stop, sheet = $('sheet'), count = S.run.kind === 'count';
  $('sheetWrap').classList.toggle('cap-aim', !count && st.step !== 'pick'); // aiming the stop photo: no dark veil over the camera
  if (st.step === 'pick') {
    const bus = busOf(S.run.reg), done = new Set(S.run.stops.map((s) => s.name));
    const here = S.fix, list = (bus ? bus.stops : []).map((s) => ({ ...s, m: here && Number.isFinite(s.lat) ? distanceM(here, s) : null }))
      .sort((a, b) => (done.has(a.name) - done.has(b.name)) || ((a.m ?? 1e9) - (b.m ?? 1e9)));
    sheet.innerHTML = '<div class="cap-sheethead"><h2 id="sheetTitle">Which stop?</h2><button type="button" class="cap-btn" data-a="cancel">Cancel</button></div>' +
      (here ? '' : '<p class="cap-note">No GPS fix yet: the stop is saved without its position.</p>') +
      (list.length ? '<div class="cap-picks">' + list.slice(0, 12).map((s) => `<button type="button" class="cap-pick" data-name="${esc(s.name)}"><span>${esc(s.name)}</span>` +
        `<small>${done.has(s.name) ? 'Tagged' : s.m != null ? (s.m < 1000 ? Math.round(s.m) + ' m' : (s.m / 1000).toFixed(1) + ' km') : ''}</small></button>`).join('') + '</div>'
        : '<p class="cap-note">No known stops for this bus yet. Type the name.</p>') +
      '<label class="cap-field" for="newStop">New stop</label><div class="cap-row"><input id="newStop" class="cap-input" maxlength="80" placeholder="Place name, not a person" autocomplete="off">' +
      '<button type="button" id="useName" class="cap-btn">Use</button></div>';
    sheet.querySelectorAll('.cap-pick').forEach((b) => b.addEventListener('click', () => pick(b.dataset.name)));
    const useTyped = () => { const n = $('newStop').value.trim(); if (n) pick(n); else $('newStop').focus(); };
    $('useName').addEventListener('click', useTyped);
    $('newStop').addEventListener('keydown', (e) => { if (e.key === 'Enter') useTyped(); });
  } else if (!count) {
    sheet.innerHTML = `<h2 id="sheetTitle">${esc(st.name)}</h2><p class="cap-note">Point the camera at the stop, then take its photo.</p>` +
      '<button type="button" class="cap-primary" data-a="save">Take stop photo</button><p class="cap-msg" id="sheetMsg" role="alert"></p>' +
      '<button type="button" class="cap-end" data-a="back">Back</button>';
  } else {
    const ctr = (k, label) => `<div class="cap-ctr"><span id="l-${k}">${label}</span><button type="button" class="cap-pm" data-k="${k}" data-d="-1" aria-label="${label}: one less">&minus;</button>` +
      `<b id="v-${k}" aria-labelledby="l-${k}">${st[k]}</b><button type="button" class="cap-pm" data-k="${k}" data-d="1" aria-label="${label}: one more">+</button></div>`;
    sheet.innerHTML = `<h2 id="sheetTitle">${esc(st.name)}</h2>` + ctr('on', 'Got on') + ctr('off', 'Got off') +
      `<div class="cap-sheetbtns"><button type="button" class="cap-primary" data-a="save">${st.fix != null ? 'Save count' : 'Save stop'}</button>` +
      (st.fix != null ? '<button type="button" class="cap-end" data-a="cancel">Cancel</button>' : '<button type="button" class="cap-end" data-a="back">Back</button>') + '</div><p class="cap-msg" id="sheetMsg" role="alert"></p>';
    sheet.querySelectorAll('.cap-pm').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.k; st[k] = Math.max(0, st[k] + Number(b.dataset.d)); $('v-' + k).textContent = st[k];
    }));
  }
  sheet.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.a === 'cancel') closeSheet();
    else if (b.dataset.a === 'back') { st.step = 'pick'; drawSheet(); }
    else saveStop(b);
  }));
  const first = sheet.querySelector('.cap-pick') || sheet.querySelector('button:not([data-a="cancel"])'); if (first) first.focus(); // the nearest stop, not Cancel
}
function pick(name) { S.stop.name = name; S.stop.step = 'next'; drawSheet(); }
async function saveStop(btn) {
  const st = S.stop, id = S.run.id, f = S.fix;
  if (st.fix != null) {
    btn.disabled = true;
    try { await store.setCount(id, st.fix, st.on, st.off); S.run = await store.getRun(id); closeSheet(); hud(); toast(`${st.name}: count changed.`); }
    catch (e) { btn.disabled = false; $('sheetMsg').textContent = 'Not saved: ' + e.message; }
    return;
  }
  const stop = { lat: st.lat ?? (f && f.lat), lng: st.lng ?? (f && f.lng), takenAt: st.takenAt, name: st.name };
  if (S.run.kind !== 'count') {
    stop.base64 = grab();
    if (!stop.base64) { $('sheetMsg').textContent = 'The camera is not ready. Wait a second and try again.'; return; }
  }
  btn.disabled = true;
  try {
    const entry = await store.addStop(id, stop);
    if (S.run.kind === 'count') await store.setCount(id, entry.seq, st.on, st.off);
    S.run = await store.getRun(id);
    closeSheet(); hud();
    const bus = busOf(S.run.reg), known = bus ? bus.stops.length : 0, n = S.run.stops.length, done = S.run.kind === 'count' ? 'counted' : 'tagged';
    toast(known && n === known ? `All ${known} stops ${done}. Shabash. End the run when you are done.` : `${st.name} ${done}.`);
  } catch (e) {
    btn.disabled = false;
    $('sheetMsg').textContent = e.code === 'STORAGE_FULL' ? FULL_MSG : 'Not saved: ' + e.message;
  }
}
function toast(msg) {
  $('toast').textContent = msg;
  clearTimeout(toast.t); toast.t = setTimeout(() => { $('toast').textContent = ''; }, 4000);
}

// ── End the run ──
function endClick() { // two taps, so a bump in a moving bus cannot end the run
  const b = $('end');
  if (!b.dataset.armed) {
    b.dataset.armed = '1'; b.textContent = 'Tap again to end the run';
    clearTimeout(endClick.t); endClick.t = setTimeout(() => { delete b.dataset.armed; b.textContent = 'End run'; }, 4000);
    return;
  }
  delete b.dataset.armed; b.textContent = 'End run';
  endRun();
}
async function endRun() {
  S.active = false;
  if (S.watch != null) navigator.geolocation.clearWatch(S.watch);
  S.watch = null;
  if (S.wake) S.wake.release().catch(() => {});
  S.wake = null;
  S.camWanted = false; closeCamera();
  await store.endRun(S.run.id);
  S.run = await store.getRun(S.run.id);
  $('running').hidden = true;
  $('offline').hidden = signedIn();
  drawSummary();
  drawUpload();
}
function drawSummary() {
  const run = S.run, bus = busOf(run.reg), el = $('summary');
  let body;
  if (run.kind === 'count') {
    const L = load(run.stops), seats = Number(bus && bus.seats), k = loadCapFactor(), cap = Math.floor(k * seats);
    const verdict = !seats ? ['', 'Seats not on record: the load cannot be checked.'] : L.peak <= seats ? ['ok', 'Within the seats.']
      : L.peak <= cap ? ['warn', `Above the seats, within the ${k} × load cap.`] : ['bad', `Above the ${k} × load cap.`];
    body = `<div class="cap-peak ${verdict[0]}"><span>Most on board at once</span><b>${L.peak}</b>` +
      (seats ? `<span>${seats} seats. Load cap (${k} × seats) ${cap}.</span>` : '') + `<p>${verdict[1]}</p></div>` +
      (run.stops.length ? '<table class="cap-table"><thead><tr><th>Stop</th><th>On</th><th>Off</th><th>On board</th></tr></thead><tbody>' +
        run.stops.map((s, i) => `<tr><td>${esc(s.name || 'Stop ' + (i + 1))}</td><td>${s.boardOn || 0}</td><td>${s.boardOff || 0}</td><td>${L.after[i]}</td></tr>`).join('') + '</tbody></table>' : '');
  } else if (run.kind === 'inspection') {
    const items = (run.draft && run.draft.items) || [], a = run.inspection || {};
    const missing = items.filter((i) => a[i.id] && a[i.id].ok === false), on = items.filter((i) => a[i.id] && a[i.id].ok).length;
    const st = items.map((i) => (!a[i.id] ? 'empty' : a[i.id].ok ? 'ok' : 'no')); // the loadout as it was saved: the same slots as the check
    body = `<div class="cap-peak cap-debrief ${missing.length ? 'bad' : 'ok'}"><span>On board</span><b>${on} of ${items.length}</b>` +
      `<ol class="cap-slots" aria-hidden="true" style="--n:${Math.min(items.length, 12)}">${st.map((x) => `<li data-s="${x}">${x === 'ok' ? SVG.ok : x === 'no' ? SVG.no : ''}</li>`).join('')}</ol>` +
      (missing.length ? '<p>Missing</p><ul class="cap-missing">' + missing.map((i) => `<li>${SVG.no}<span>${esc(i.label)}</span></li>`).join('') + '</ul>' +
        '<span>Once this is sent, each missing item becomes a follow-up for this bus.</span>' : '<p>Everything is on board.</p>') + '</div>';
  } else {
    const known = bus ? bus.stops.length : 0, n = run.stops.length;
    body = '<dl class="cap-stats">' + `<div><dt>Frames</dt><dd>${run.frames}</dd></div>` +
      `<div><dt>Stops tagged</dt><dd>${n}${known ? ` <small>of ${Math.max(known, n)}</small>` : ''}</dd></div>` +
      `<div><dt>Gaps</dt><dd>${run.gaps.length}</dd></div></dl>`;
  }
  const route = bus && bus.route ? ' (' + esc(routeName(bus, run.reg)) + ')' : '';
  el.innerHTML = `<h2 class="cap-h">${run.kind === 'inspection' ? 'Safety check' : 'Run'} saved on this phone</h2><p class="cap-note">${esc(KIND[run.kind])} on ${esc(run.reg)}${route}. Send it on school Wi-Fi.</p>` + body +
    '<button type="button" class="cap-primary" data-a="send">Send now on Wi-Fi</button><button type="button" class="cap-end" data-a="new">Start another run</button>';
  el.querySelector('[data-a="send"]').addEventListener('click', () => { showTab('upload'); sendAll(); });
  el.querySelector('[data-a="new"]').addEventListener('click', () => { el.hidden = true; $('setup').hidden = false; S.run = null; S.insp = null; setMode(S.mode); drawResume(); });
  el.hidden = false;
}

// ── Upload tab ──
async function post(body) { // the uploader's transport: the signed-in idToken, the Roster web app (apps-script/transport-capture.gs)
  const s = S.driver ? { deviceToken: storedToken() } : LMCS.getSession();
  if (!s) return { success: false, error: 'Signed out. Sign in again, then tap Send now on Wi-Fi' };
  const auth = S.driver ? { deviceToken: s.deviceToken } : { idToken: s.idToken };
  const text = await (await fetch(ROSTER_URL, { method: 'POST', body: JSON.stringify(Object.assign(auth, body)) })).text();
  return JSON.parse(text); // a Google error page instead of JSON throws, and the uploader retries
}
function runLine(run, p) {
  if (run.kind === 'count') return `${plural(run.stops.length, 'stop')} counted`;
  if (run.kind === 'inspection') return p.total ? `${p.sent} of ${plural(p.total, 'photo')} sent` : 'No photos';
  return `${p.sent} of ${p.total} frames sent`;
}
function stateLine(run, p) {
  if (p.state) return p.state === 'error' ? 'Stopped: ' + p.error : STATE[p.state] || '';
  if (run.endSent) return 'Sent.';
  if (run.status === 'error') return 'Stopped: ' + run.error + '. Tap Send to try again.';
  return run.endedAt ? 'Waiting to send.' : run.kind === 'inspection' ? 'Not saved yet: finish the check first.' : 'Still recording.';
}
function drawRow(li, run, p) {
  const pct = p.total ? (100 * p.sent / p.total) : run.endSent ? 100 : 0;
  li.innerHTML = `<div class="cap-runhead"><b>${esc(run.reg)}</b><span>${esc(KIND[run.kind])}</span></div><p class="cap-note">${when(run.startedAt)}</p>` +
    `<p class="cap-line">${runLine(run, p)}</p>` + (run.kind === 'count' ? '' : `<div class="cap-bar"><i style="width:${pct}%"></i></div>`) +
    `<p class="cap-note ${p.state === 'error' || (!p.state && run.status === 'error') ? 'cap-bad' : p.state === 'done' || (!p.state && run.endSent) ? 'cap-good' : ''}">${esc(stateLine(run, p))}</p>`;
}
async function drawUpload() {
  const runs = (await store.runs()).sort((a, b) => b.startedAt - a.startedAt), list = $('runList');
  const todo = runs.filter((r) => !r.endSent).length;
  $('upCount').textContent = todo ? '(' + todo + ')' : '';
  const rows = await Promise.all(runs.map(async (r) => ({ r, total: await store.total(r.id), left: (await store.pending(r.id)).length })));
  list.innerHTML = rows.length ? '' : '<li class="cap-note">No runs on this phone.</li>';
  rows.forEach(({ r, total, left }) => {
    const li = document.createElement('li'); li.dataset.id = r.id;
    const p = S.progress[r.id] || {};
    drawRow(li, r, { ...p, sent: total - left, total });
    list.appendChild(li);
  });
  const c = navigator.connection;
  $('netNote').textContent = c && c.type === 'cellular' ? 'You are on mobile data. Frames are large: send on school Wi-Fi.' : '';
  $('send').disabled = S.sending || !todo;
  if (!S.sending) $('send').textContent = todo ? 'Send now on Wi-Fi' : runs.length ? 'All runs sent' : 'Nothing to send';
  const info = await store.storageInfo();
  $('storage').textContent = info.quota ? `Phone storage for capture: ${mb(info.usage)} used of ${mb(info.quota)}.` + (info.persisted ? '' : ' The browser may clear it if the phone runs low: send soon.') : '';
}
async function signIn() {
  $('authRoot').style.display = ''; scrollTo(0, 0);
  const s = await LMCS.requireSession('#authRoot');
  $('authRoot').style.display = 'none';
  if (!sameUser(s)) { location.reload(); return null; } // someone else: the page starts again as theirs
  S.session = s; rememberIdentity(s);
  $('offline').hidden = true;
  loadBuses();
  return s;
}
async function sendAll() {
  if (S.sending) return;
  if (!signedIn() && !(await signIn())) return; // a sign-in lasts about an hour, and offline mode has none: sign in, then send
  S.sending = true; $('send').disabled = true; $('send').textContent = 'Sending…';
  S.progress = {};
  const runs = {};
  const up = createUploader({
    store, post,
    onProgress: (p) => {
      S.progress[p.runId] = p;
      const li = $('runList').querySelector(`[data-id="${CSS.escape(p.runId)}"]`);
      if (li && runs[p.runId]) drawRow(li, runs[p.runId], p);
    },
  });
  try {
    for (const r of await store.runs()) {
      if (r.endSent) continue;
      runs[r.id] = r;
      await up.start(r.id);
    }
  } finally {
    S.sending = false; $('send').textContent = 'Send now on Wi-Fi';
    await drawUpload();
  }
}

// ── Safety check (Inspection mode) ──
// The answers are saved on the phone after every tap (run.draft), so a phone that drops the page while its camera app is
// open, or a check finished later, carries on from the Unfinished list.
const SVG = {
  ok: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  no: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
  cam: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M4 8h3.5L9 5.5h6L16.5 8H20v11H4z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><circle cx="12" cy="13.5" r="3.3" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>',
};
async function startInspection(resume, reg) {
  const items = (resume && resume.draft && resume.draft.items) || S.loadout; // a check closed before its draft was written takes today's list
  if (!items) return setupSay('The safety list is not on this phone yet. Open this page on Wi-Fi once, then start again.');
  if (!items.length) return setupSay('The Owner has switched off every safety item: there is nothing to check.');
  const bus = busOf(reg);
  try {
    S.run = resume || await store.newRun({ reg, kind: 'inspection', campus: bus && bus.campus, by: S.session.email, role: S.session.role });
    if (!S.run.draft) S.run = await store.patchRun(S.run.id, { draft: { items, answers: {} } });
  } catch (e) { return setupSay(e.code === 'STORAGE_FULL' ? FULL_MSG : 'Could not save on this phone: ' + e.message); }
  S.resumeId = null;
  S.insp = { items, answers: { ...S.run.draft.answers }, thumbs: {}, cur: null }; // cur: the card being worked on stays open
  $('setup').hidden = true; $('summary').hidden = true; $('inspect').hidden = false;
  $('inspTitle').textContent = `Safety check ${S.run.reg}` + (bus && bus.route ? ` (${routeName(bus, S.run.reg)})` : '');
  $('inspMsg').textContent = '';
  $('cards').innerHTML = items.map((i) => `<li class="cap-slot" data-id="${esc(i.id)}"></li>`).join('');
  items.forEach((i) => drawCard(i.id));
  drawSlots();
  const todo = items.find((i) => !['ok', 'no'].includes(slotState(i))), first = cardEl((todo || items[0]).id).querySelector('button');
  if (first) first.focus();
}
const cardEl = (id) => $('cards').querySelector(`[data-id="${CSS.escape(id)}"]`);
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// Work moves to another card: the one before folds to a line if it is finished, and the card under the thumb stays where it is.
function setCur(id) {
  const prev = S.insp.cur;
  S.insp.cur = id;
  if (!prev || prev === id) return;
  const li = cardEl(id), y = li.getBoundingClientRect().top;
  drawCard(prev);
  scrollBy(0, li.getBoundingClientRect().top - y);
}
function jump(id) { // a tap on a slot in the HUD: that item's card, open, below the HUD
  setCur(id); drawCard(id);
  const li = cardEl(id);
  li.scrollIntoView({ block: 'start', behavior: calm() ? 'auto' : 'smooth' });
  li.querySelector('button').focus({ preventScroll: true });
}
// done: answered, and a Yes has the photo and date it needs. A No needs nothing more: the missing item is the finding.
function slotState(item) {
  const a = S.insp.answers[item.id];
  if (!a) return 'empty';
  if (!a.ok) return 'no';
  return (item.needsPhoto && a.seq == null) || (item.needsDate && !a.date) ? 'todo' : 'ok';
}
function drawSlots() {
  const st = S.insp.items.map(slotState), done = st.filter((x) => x === 'ok' || x === 'no').length;
  $('slots').innerHTML = st.map((x) => `<li data-s="${x}">${x === 'ok' ? SVG.ok : x === 'no' ? SVG.no : ''}</li>`).join('');
  $('slots').style.setProperty('--n', String(Math.min(st.length, 12))); // a long list wraps to a second row of slots
  $('inspCount').textContent = `${done} of ${st.length} done`;
  $('inspCount').classList.toggle('cap-good', done === st.length); // every slot answered: the count turns green
  $('inspect').style.setProperty('--hud', $('slots').parentNode.offsetHeight + 'px'); // fields scroll to below it (capture.css)
  $('inspSave').textContent = done === st.length ? 'Save safety check' : `Save safety check (${done} of ${st.length} done)`;
}
function drawCard(id) {
  const item = S.insp.items.find((i) => i.id === id), a = S.insp.answers[id], li = cardEl(id), state = slotState(item);
  const focused = document.activeElement && li.contains(document.activeElement) ? document.activeElement.dataset.a : null;
  const needs = [item.needsPhoto && 'a photo', item.needsDate && 'the date'].filter(Boolean);
  li.dataset.s = state;
  const fold = (state === 'ok' || state === 'no') && S.insp.cur !== id; // finished and not the card being worked on: one line
  li.classList.toggle('cap-folded', fold);
  if (fold) {
    li.innerHTML = `<button type="button" class="cap-fold" data-a="open" aria-expanded="false"><span class="cap-mark">${state === 'ok' ? SVG.ok : SVG.no}</span>` +
      `<span class="cap-foldname">${esc(item.label)}</span><small>${state === 'ok' ? 'On board' : 'Missing'}</small></button>`;
    li.querySelector('[data-a="open"]').addEventListener('click', () => { setCur(id); drawCard(id); const y = cardEl(id).querySelector('[aria-pressed="true"]'); if (y) y.focus(); });
    if (focused) li.querySelector('button').focus();
    return;
  }
  li.innerHTML = `<div class="cap-slothead"><span class="cap-mark">${state === 'ok' ? SVG.ok : state === 'no' ? SVG.no : ''}</span>` +
    `<h3 id="lab-${esc(id)}">${esc(item.label)}</h3></div>` +
    `<div class="cap-yn" role="group" aria-labelledby="lab-${esc(id)}">` +
    `<button type="button" data-a="yes" aria-pressed="${!!(a && a.ok)}">Yes</button><button type="button" data-a="no" aria-pressed="${!!(a && !a.ok)}">No</button></div>` +
    (!a && needs.length ? `<p class="cap-note">Yes needs ${needs.join(' and ')}.</p>` : '') +
    (a && !a.ok ? '<p class="cap-slotnote">Missing or not working.</p>' : '') +
    (state === 'todo' ? `<p class="cap-slotnote cap-todo">${stillNeeds(item, a)}</p>` : '') +
    (a && a.ok && item.needsPhoto ? (a.seq == null ? `<button type="button" class="cap-btn cap-photo" data-a="photo">${SVG.cam}<span>Take photo</span></button>`
      : `<div class="cap-took">${S.insp.thumbs[id] ? `<img src="${S.insp.thumbs[id]}" alt="">` : ''}<span>Photo saved</span><button type="button" class="cap-btn" data-a="photo">Retake</button></div>`) : '') +
    (a && a.ok && item.needsDate ? `<label class="cap-field" for="d-${esc(id)}">Date on the certificate or tag</label><input type="date" id="d-${esc(id)}" class="cap-input" data-a="date" value="${esc(a.date || '')}">` : '');
  li.querySelectorAll('[data-a="yes"],[data-a="no"]').forEach((b) => b.addEventListener('click', () => answer(id, b.dataset.a === 'yes')));
  li.querySelectorAll('[data-a="photo"]').forEach((b) => b.addEventListener('click', () => { setCur(id); S.insp.photoFor = id; $('inspPhoto').value = ''; $('inspPhoto').click(); }));
  const d = li.querySelector('[data-a="date"]');
  if (d) d.addEventListener('change', () => { setCur(id); S.insp.answers[id].date = d.value; saveDraft(); drawSlots(); li.dataset.s = slotState(item); drawMark(li, item); });
  if (focused) { const f = li.querySelector(`[data-a="${focused}"]`); if (f) f.focus(); }
}
function drawMark(li, item) {
  const s = slotState(item), note = li.querySelector('.cap-todo');
  li.querySelector('.cap-mark').innerHTML = s === 'ok' ? SVG.ok : s === 'no' ? SVG.no : '';
  if (s !== 'todo') { if (note) note.remove(); return; } // the date field keeps focus: no redraw
  const text = stillNeeds(item, S.insp.answers[item.id]);
  if (note) note.textContent = text; else li.querySelector('.cap-yn').insertAdjacentHTML('afterend', `<p class="cap-slotnote cap-todo">${text}</p>`); // a cleared date says so too
}
const stillNeeds = (item, a) => 'Still needs ' + [item.needsPhoto && a.seq == null && 'a photo', item.needsDate && !a.date && 'the date'].filter(Boolean).join(' and ') + '.';
function answer(id, ok) {
  setCur(id);
  const a = S.insp.answers[id];
  S.insp.answers[id] = ok ? { ...(a && a.ok ? a : {}), ok: true } : { ok: false }; // No drops the photo link and date; a Yes keeps what it had
  saveDraft(); // first: the store runs in order, so the draft never points at a photo already dropped
  if (!ok && a && a.seq != null) { store.dropFile(S.run.id, 'inspection', a.seq).catch(() => {}); delete S.insp.thumbs[id]; } // that photo is never sent
  drawCard(id); drawSlots();
  $('inspMsg').textContent = '';
}
function saveDraft() {
  store.patchRun(S.run.id, { draft: { items: S.insp.items, answers: S.insp.answers } })
    .catch((e) => { $('inspMsg').textContent = e.code === 'STORAGE_FULL' ? FULL_MSG : 'Not saved on this phone: ' + e.message; });
}
function readImage(file) { // the photo from the phone's camera app, longest side 1280 px, JPEG 0.7, as base64
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
async function onInspPhoto() {
  const file = $('inspPhoto').files[0], id = S.insp && S.insp.photoFor;
  if (!file || !id) return;
  const li = cardEl(id), btn = li.querySelector('[data-a="photo"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving photo…'; }
  try {
    const base64 = await readImage(file);
    const old = S.insp.answers[id] && S.insp.answers[id].seq;
    const seq = await store.addFrame(S.run.id, { takenAt: Date.now(), base64 });
    S.insp.answers[id] = { ...S.insp.answers[id], ok: true, seq };
    saveDraft(); // the draft points at the new photo before the old one goes (the store runs in order): a page killed in between keeps a photo
    if (old != null) await store.dropFile(S.run.id, 'inspection', old); // a retake replaces the old photo: only the current one is sent
    S.insp.thumbs[id] = 'data:image/jpeg;base64,' + base64;
  } catch (e) { $('inspMsg').textContent = e.code === 'STORAGE_FULL' ? FULL_MSG : e.message; }
  drawCard(id); drawSlots();
  const again = li.querySelector('[data-a="photo"]'); if (again) again.focus();
}
async function saveInspection() {
  const left = S.insp.items.filter((i) => ['empty', 'todo'].includes(slotState(i)));
  if (left.length) {
    const i = left[0], a = S.insp.answers[i.id];
    const msg = !a ? `Answer ${i.label} first.` : a.seq == null && i.needsPhoto ? `Take the photo of ${i.label} first.` : `Add the date for ${i.label} first.`;
    $('inspMsg').textContent = msg; toast(msg); // the page scrolls to the card, away from the message under Save
    const li = cardEl(i.id);
    li.scrollIntoView({ block: 'center' }); (li.querySelector('[data-a="photo"],[data-a="date"]') || li.querySelector('button')).focus({ preventScroll: true });
    return;
  }
  const inspection = {};
  S.insp.items.forEach((i) => {
    const a = S.insp.answers[i.id], out = { ok: !!a.ok };
    if (a.ok && i.needsDate) out.date = a.date;
    if (a.ok && i.needsPhoto) out.seq = a.seq; // uploader.js swaps it for the photo's Drive file id
    inspection[i.id] = out;
  });
  $('inspSave').disabled = true;
  try {
    // only the photos the answers point at leave the phone (a photo left by a page closed mid-retake, say, is dropped here)
    const keep = new Set(Object.values(inspection).map((o) => o.seq).filter((x) => x != null));
    for (const f of await store.pending(S.run.id)) if (!keep.has(f.seq)) await store.dropFile(S.run.id, f.kind, f.seq);
    await store.endRun(S.run.id, { inspection });
    S.run = await store.getRun(S.run.id);
  } catch (e) { $('inspMsg').textContent = e.code === 'STORAGE_FULL' ? FULL_MSG : 'Not saved: ' + e.message; return; }
  finally { $('inspSave').disabled = false; }
  $('inspect').hidden = true;
  $('offline').hidden = signedIn();
  drawSummary(); drawUpload();
  $('summary').querySelector('[data-a="send"]').focus();
}

boot();
