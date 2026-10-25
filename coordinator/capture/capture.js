// Capture page (coordinator/transport/capture.html). A Coordinator rides a bus with a school phone in a dashboard mount.
// Spec: docs/superpowers/specs/2026-10-25-transport-game-design.md, Loop 6. Guide: docs/transport-game/capture-guide.md.
// - Timelapse (default): rear camera, a frame every ~15 m of GPS travel (geo.js), STOP HERE tags a stop with a photo.
// - Count run: no camera at all. STOP HERE plus how many children got on and off; the summary sets the peak load against
//   the seats and the 1.4 x seats load cap.
// - Inspection: Task 6.
// Everything is saved on the phone first (run-store.js) and sent later from the Upload tab (uploader.js -> Roster web app).
// Never shows speed or trip time, and no sound.
import { shouldCapture, distanceM } from './geo.js';
import { createCaptureIdb, createRunStore } from './run-store.js';
import { createUploader } from './uploader.js';

const COORD_URL = 'https://script.google.com/macros/s/AKfycbwilcvrgZQga_qo1A-fBTUzKLifrBYIwlPHoWMITmchf5sZOYjKIJ7_4J0TeBF_-6B6/exec'; // = BACKEND_URL in coordinator/shared.js
const ROSTER_URL = 'https://script.google.com/macros/s/AKfycbyHiaZY_iWK2VTKKFJcCsBNnIbUndJYUSjnPkxvJ-dYavaihiul2xBJuJohPRsP9Spf/exec'; // = ROSTER_URL in assets/auth.js
const FULL_MSG = 'The phone is full. Upload on Wi-Fi now, then carry on.';
const KIND = { timelapse: 'Timelapse', count: 'Count run', inspection: 'Inspection' };
const HELP = {
  timelapse: 'Photo run: a frame every 15 m and one photo at each stop. Outside school hours only.',
  count: 'School run, no camera: count the children who get on and off at each stop.',
};
const STATE = {
  uploading: 'Sending...', retrying: 'No answer from the server. Trying again shortly.', 'waiting-online': 'No connection. Sending resumes when it is back.',
  stopped: 'Stopped.', done: 'Sent.', 'uploaded-so-far': 'Sent so far. The rest goes when the run has ended.',
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
};
const canvas = document.createElement('canvas');

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
  if (!LMCS.canViewCoordinatorPortal(s)) { $('back').href = '../../office/buses.html'; $('back').textContent = '\u2190 Live Buses'; } // Fee Clerk
  S.session = s;
  wire();
  setMode('timelapse');
  battery();
  loadBuses();
  drawResume();
  drawUpload();
}

function wire() {
  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { if (S.resumeId) { S.resumeId = null; drawResume(); } setMode(b.dataset.mode); }));
  $('start').addEventListener('click', start);
  $('stopHere').addEventListener('click', openSheet);
  $('end').addEventListener('click', endClick);
  $('send').addEventListener('click', sendAll);
  $('signIn').addEventListener('click', () => signIn());
  $('sheetWrap').addEventListener('click', (e) => { if (e.target === $('sheetWrap')) closeSheet(); });
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
  $('privacy').checked = false; // asked again before every timelapse start
  $('start').textContent = (S.resumeId ? 'Carry on the ' : 'Start ') + (mode === 'timelapse' ? 'timelapse' : 'count run');
  $('setupMsg').textContent = '';
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
  if (!S.buses.length && !note) note = 'No buses on your account.';
  $('busNote').textContent = note;
  if (S.run) hud();
}
const busOf = (reg) => S.buses.find((b) => normReg(b.reg) === normReg(reg));
const routeName = (bus, reg) => { const r = bus && String(bus.route || '').trim(); return !r ? reg : /^\d+$/.test(r) ? 'Route ' + r : r; };

// ── Unfinished runs (the page was closed mid-run): carry on, or end them ──
async function drawResume() {
  const open = (await store.runs()).filter((r) => !r.endedAt);
  $('resume').innerHTML = open.map((r) => `<div class="cap-resume" data-id="${esc(r.id)}"><p><b>${esc(KIND[r.kind])} on ${esc(r.reg)}</b> from ${when(r.startedAt)} is still open.</p>` +
    `<button type="button" class="cap-btn" data-a="carry">Carry on</button> <button type="button" class="cap-btn" data-a="end">End it</button></div>`).join('');
  $('resume').querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', async () => {
    const run = await store.getRun(b.closest('[data-id]').dataset.id);
    if (b.dataset.a === 'end') { await store.endRun(run.id); drawResume(); drawUpload(); return; }
    S.resumeId = run.id;
    $('resume').innerHTML = '';
    setMode(run.kind);
    const bus = busOf(run.reg);
    $('bus').value = bus ? bus.reg : '';
    $('setupMsg').textContent = run.kind === 'timelapse' ? 'Tick the box, then tap Carry on.' : '';
  }));
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
function openCamera() {
  if (S.camP) return S.camP;
  S.camP = (async () => {
    if (S.stream && S.stream.getVideoTracks().some((t) => t.readyState === 'live')) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('no camera API');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    if (!S.camWanted) { stream.getTracks().forEach((t) => t.stop()); return; }
    S.stream = stream;
    const v = $('cam');
    v.srcObject = stream;
    await v.play().catch(() => {});
    await Promise.race([new Promise((r) => setTimeout(r, 3000)), // never hang here (a stream stopped before its first frame)
      new Promise((r) => (v.requestVideoFrameCallback ? v.requestVideoFrameCallback(() => r()) : v.addEventListener('timeupdate', () => r(), { once: true })))]);
    if (S.stream === stream) S.camReady = true;
  })().finally(() => { S.camP = null; });
  return S.camP;
}
function closeCamera() {
  S.camReady = false;
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
    const kind = resume ? resume.kind : S.mode, reg = resume ? resume.reg : $('bus').value;
    if (!reg) return setupSay('Pick the bus first.');
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
  }
}
function gpsLine() {
  const f = S.fix;
  $('gps').dataset.s = !f ? 'wait' : f.accuracy > 50 ? 'weak' : 'ok';
  $('gps').textContent = !f ? 'Waiting for GPS...' : f.accuracy > 50 ? `GPS weak (±${Math.round(f.accuracy)} m): frames paused` : `GPS ±${Math.round(f.accuracy)} m`;
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
  behindSheet(true);
  drawSheet();
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
    sheet.innerHTML = '<h2 id="sheetTitle">Which stop?</h2>' +
      (here ? '' : '<p class="cap-note">No GPS fix yet: the stop is saved without its position.</p>') +
      (list.length ? '<div class="cap-picks">' + list.slice(0, 12).map((s) => `<button type="button" class="cap-pick" data-name="${esc(s.name)}"><span>${esc(s.name)}</span>` +
        `<small>${done.has(s.name) ? 'Tagged' : s.m != null ? (s.m < 1000 ? Math.round(s.m) + ' m' : (s.m / 1000).toFixed(1) + ' km') : ''}</small></button>`).join('') + '</div>'
        : '<p class="cap-note">No known stops for this bus yet. Type the name.</p>') +
      '<label class="cap-field" for="newStop">New stop</label><div class="cap-row"><input id="newStop" class="cap-input" maxlength="80" placeholder="Place name, not a person" autocomplete="off">' +
      '<button type="button" id="useName" class="cap-btn">Use</button></div>' +
      '<button type="button" class="cap-end" data-a="cancel">Cancel</button>';
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
      '<button type="button" class="cap-primary" data-a="save">Save stop</button><p class="cap-msg" id="sheetMsg" role="alert"></p>' +
      '<button type="button" class="cap-end" data-a="back">Back</button>';
    sheet.querySelectorAll('.cap-pm').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.k; st[k] = Math.max(0, st[k] + Number(b.dataset.d)); $('v-' + k).textContent = st[k];
    }));
  }
  sheet.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.a === 'cancel') closeSheet();
    else if (b.dataset.a === 'back') { st.step = 'pick'; drawSheet(); }
    else saveStop(b);
  }));
  const first = sheet.querySelector('button'); if (first) first.focus();
}
function pick(name) { S.stop.name = name; S.stop.step = 'next'; drawSheet(); }
async function saveStop(btn) {
  const st = S.stop, id = S.run.id, f = S.fix;
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
  $('offline').hidden = !!LMCS.getSession();
  drawSummary();
  drawUpload();
}
function drawSummary() {
  const run = S.run, bus = busOf(run.reg), el = $('summary');
  let body;
  if (run.kind === 'count') {
    const L = load(run.stops), seats = Number(bus && bus.seats), cap = Math.floor(1.4 * seats);
    const verdict = !seats ? ['', 'Seats not on record: the load cannot be checked.'] : L.peak <= seats ? ['ok', 'Within the seats.']
      : L.peak <= cap ? ['warn', 'Above the seats, within the 1.4 × load cap.'] : ['bad', 'Above the 1.4 × load cap.'];
    body = `<div class="cap-peak ${verdict[0]}"><span>Most on board at once</span><b>${L.peak}</b>` +
      (seats ? `<span>${seats} seats. Load cap (1.4 × seats) ${cap}.</span>` : '') + `<p>${verdict[1]}</p></div>` +
      (run.stops.length ? '<table class="cap-table"><thead><tr><th>Stop</th><th>On</th><th>Off</th><th>On board</th></tr></thead><tbody>' +
        run.stops.map((s, i) => `<tr><td>${esc(s.name || 'Stop ' + (i + 1))}</td><td>${s.boardOn || 0}</td><td>${s.boardOff || 0}</td><td>${L.after[i]}</td></tr>`).join('') + '</tbody></table>' : '');
  } else {
    const known = bus ? bus.stops.length : 0, n = run.stops.length;
    body = '<dl class="cap-stats">' + `<div><dt>Frames</dt><dd>${run.frames}</dd></div>` +
      `<div><dt>Stops tagged</dt><dd>${n}${known ? ` <small>of ${Math.max(known, n)}</small>` : ''}</dd></div>` +
      `<div><dt>Gaps</dt><dd>${run.gaps.length}</dd></div></dl>`;
  }
  const route = bus && bus.route ? ' (' + esc(routeName(bus, run.reg)) + ')' : '';
  el.innerHTML = `<h2 class="cap-h">Run saved on this phone</h2><p class="cap-note">${esc(KIND[run.kind])} on ${esc(run.reg)}${route}. Send it on school Wi-Fi.</p>` + body +
    '<button type="button" class="cap-primary" data-a="send">Send now on Wi-Fi</button><button type="button" class="cap-end" data-a="new">Start another run</button>';
  el.querySelector('[data-a="send"]').addEventListener('click', () => { showTab('upload'); sendAll(); });
  el.querySelector('[data-a="new"]').addEventListener('click', () => { el.hidden = true; $('setup').hidden = false; S.run = null; setMode(S.mode); drawResume(); });
  el.hidden = false;
}

// ── Upload tab ──
async function post(body) { // the uploader's transport: the signed-in idToken, the Roster web app (apps-script/transport-capture.gs)
  const s = LMCS.getSession();
  if (!s) return { success: false, error: 'Signed out. Sign in again, then tap Send now on Wi-Fi' };
  const text = await (await fetch(ROSTER_URL, { method: 'POST', body: JSON.stringify(Object.assign({ idToken: s.idToken }, body)) })).text();
  return JSON.parse(text); // a Google error page instead of JSON throws, and the uploader retries
}
function runLine(run, p) {
  if (run.kind === 'count') return `${plural(run.stops.length, 'stop')} counted`;
  return `${p.sent} of ${p.total} frames sent`;
}
function stateLine(run, p) {
  if (p.state) return p.state === 'error' ? 'Stopped: ' + p.error : STATE[p.state] || '';
  if (run.endSent) return 'Sent.';
  if (run.status === 'error') return 'Stopped: ' + run.error + '. Tap Send to try again.';
  return run.endedAt ? 'Waiting to send.' : 'Still recording.';
}
function drawRow(li, run, p) {
  const pct = p.total ? (100 * p.sent / p.total) : run.endSent ? 100 : 0;
  li.innerHTML = `<div class="cap-runhead"><b>${esc(run.reg)}</b><span>${esc(KIND[run.kind])}</span></div><p class="cap-note">${when(run.startedAt)}</p>` +
    `<p class="cap-line">${runLine(run, p)}</p>` + (run.kind === 'count' ? '' : `<div class="cap-bar"><i style="width:${pct}%"></i></div>`) +
    `<p class="cap-note ${p.state === 'error' || (!p.state && run.status === 'error') ? 'cap-bad' : ''}">${esc(stateLine(run, p))}</p>`;
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
  S.session = s; rememberIdentity(s);
  $('offline').hidden = true;
  loadBuses();
  return s;
}
async function sendAll() {
  if (S.sending) return;
  if (!LMCS.getSession()) await signIn(); // a sign-in lasts about an hour, and offline mode has none: sign in, then send
  S.sending = true; $('send').disabled = true; $('send').textContent = 'Sending...';
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

boot();
