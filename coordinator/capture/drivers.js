// Driver phones (coordinator/transport/drivers.html): the Fee Clerk, a Coordinator or the Owner links a driver's own phone to
// one bus. Create shows a QR once (the driver scans it on their phone: driver/index.html#k=<token>); revoke unlinks a phone.
// Backend: Roster web app driverlinkcreate / driverlinklist / driverlinkrevoke (apps-script/driver-link.gs). The bus list is the
// roll call's. The token lives only in memory on this screen: never stored, never logged, gone when the screen is left.
// The driver is picked, not typed (Uday, 30 Oct): a type-ahead over the caller's schools' staff (Roster driverstaff, driver-google.gs:
// Owner, Coordinator district, Fee Clerk own campus), that bus's school's drivers first, the bus's usual driver filled in, and the
// employee code follows the pick. The pick shows the phone on file and whether they can sign in with Google or need the QR: shown
// on this screen only, never stored, logged or put in a URL. If the read fails, the typed name and optional code stay.
import { linkUrl, whatsappUrl, cleanName, nameOk } from './driver-mode.js';
import { rankStaff, lineOf, labelOf, findPick } from '../../assets/employee-pick.js';

const COORD_URL = 'https://script.google.com/macros/s/AKfycbwilcvrgZQga_qo1A-fBTUzKLifrBYIwlPHoWMITmchf5sZOYjKIJ7_4J0TeBF_-6B6/exec'; // = rollcall.js
const ROSTER_URL = 'https://script.google.com/macros/s/AKfycbyHiaZY_iWK2VTKKFJcCsBNnIbUndJYUSjnPkxvJ-dYavaihiul2xBJuJohPRsP9Spf/exec'; // = capture.js
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const S = { buses: [], links: [], fresh: null, googleReady: null, staff: null, pick: null };
const day = (iso) => (iso ? String(iso).slice(0, 10) : '');

async function roster(body) {
  const s = LMCS.getSession();
  if (!s) throw new Error('Signed out. Sign in again.');
  let r;
  try { r = JSON.parse(await (await fetch(ROSTER_URL, { method: 'POST', body: JSON.stringify({ idToken: s.idToken, ...body }) })).text()); }
  catch (e) { throw new Error('No connection'); }
  if (!r.success) throw new Error(r.error || 'Request failed');
  return r;
}

async function boot() {
  const s = await LMCS.requireSession('#authRoot');
  $('authRoot').style.display = 'none';
  $('appBody').hidden = false;
  if (!(LMCS.canViewCoordinatorPortal(s) || LMCS.hasRole(s, 'FeeClerk'))) { $('appBody').innerHTML = '<div class="denied">Driver phones are for Fee Clerks, Coordinators and the Owner.</div>'; return; }
  $('retry').addEventListener('click', load);
  $('add').addEventListener('click', () => showForm(true));
  $('cancel').addEventListener('click', () => showForm(false));
  $('form').addEventListener('submit', create);
  $('bus').addEventListener('change', busChanged);
  $('name').addEventListener('change', nameChanged);
  await load();
}

async function load() {
  $('loadMsg').hidden = false; $('loadMsg').firstElementChild.textContent = 'Loading…'; $('retry').hidden = true;
  try {
    const s = LMCS.getSession();
    const b = await (await fetch(COORD_URL + '?action=coordinatortransportrollcall&idToken=' + encodeURIComponent(s.idToken), { cache: 'no-store' })).json();
    if (!b.success) throw new Error(b.error || 'Request failed');
    S.buses = b.buses.slice().sort((x, y) => x.campus.localeCompare(y.campus) || x.reg.localeCompare(y.reg));
    const l = await roster({ action: 'driverlinklist' });
    S.links = l.links; S.googleReady = typeof l.googleReady === 'number' ? l.googleReady : null; // a count only (apps-script/driver-google.gs)
    if (!S.staff) { // refused or failed: the typed name stays
      const st = await roster({ action: 'driverstaff' }).catch(() => null);
      S.staff = st && Array.isArray(st.staff) && st.staff.length ? st.staff : null;
    }
    $('loadMsg').hidden = true;
  } catch (e) {
    $('loadMsg').firstElementChild.textContent = 'Could not load (' + e.message + '). Check the connection, then try again.';
    $('retry').hidden = false;
  }
  $('bus').innerHTML = '<option value="">Pick the bus</option>' + S.buses.map((b) => `<option value="${esc(b.reg)}">${esc(b.reg)} (${esc(b.campus)})</option>`).join('');
  draw();
}

function draw() {
  const active = S.links.filter((l) => !l.revoked), old = S.links.filter((l) => l.revoked);
  const row = (l) => `<li data-id="${esc(l.linkId)}"><b>${esc(l.driverName)}</b> <span class="cap-note">${esc(l.reg)} · ${esc(l.campus)}</span>` +
    `<p>${l.createdBy === 'google:self' ? 'Signed in with Google' : 'Linked'} ${esc(day(l.created))}${l.lastSeen ? ' · last seen ' + esc(day(l.lastSeen)) : ' · not opened yet'}</p>` +
    (l.revoked ? `<p class="dp-off">Revoked ${esc(day(l.revoked))}</p>` : '<div class="dp-acts"><button type="button" class="gb-btn" data-revoke>Revoke</button></div>') + '</li>';
  $('google').textContent = S.googleReady == null ? '' : S.googleReady + ' of your drivers can sign in with Google on their own phone (the school has their Gmail). The rest need a QR. Revoke unlinks a phone, but such a driver can sign in again: to stop that, change their email or bus in the roster.';
  $('links').innerHTML = S.links.length ? active.map(row).join('') + old.map(row).join('') : '<li class="cap-note">No driver phones linked yet.</li>';
  $('links').querySelectorAll('[data-revoke]').forEach((b) => b.addEventListener('click', () => revoke(b)));
}

function showForm(on) {
  $('form').hidden = !on; $('addRow').hidden = on; $('formMsg').textContent = '';
  if (on) { $('name').value = ''; $('code').value = ''; S.pick = null; S.auto = false; showPick(null); pickMode(); $('bus').focus(); }
}

// With the staff list: name is a search box over it and the code is read-only, filled from the pick. Without it: as before.
function pickMode() {
  const on = !!S.staff;
  $('code').readOnly = on;
  $('codeLabel').textContent = on ? 'Employee code (from the pick)' : 'Employee code (optional)';
  $('name').placeholder = on ? 'Type a few letters, then pick' : '';
  $('nameHelp').hidden = !on;
  if (on) fillList(); // the list is there before a bus is chosen, in plain name order until it is
}
function fillList() { // that bus's school's drivers first, then other drivers (cover), then everyone else
  const bus = S.buses.find((b) => b.reg === $('bus').value);
  S.ranked = rankStaff(S.staff, { school: bus ? bus.campusId : '' });
  $('staffList').innerHTML = S.ranked.map((e) => `<option value="${esc(lineOf(e))}" label="${esc(labelOf(e))}"></option>`).join('');
  return bus;
}
function showPick(e) { // what the roster already holds: the phone, and Google sign-in or the QR
  $('pickInfo').hidden = !e;
  $('pickInfo').textContent = !e ? '' : [e.role, e.school, e.phone ? 'Phone ' + e.phone : 'No phone on file',
    e.google ? 'Can sign in with Google ✓ (no QR needed)' : 'No Gmail on file: needs the QR'].filter(Boolean).join(' · ');
}
function setPick(e) {
  S.pick = e; showPick(e);
  $('code').value = e ? e.employeeCode : '';
  $('name').value = e ? lineOf(e) : ''; // only ever the filled-in default: a hand pick goes through nameChanged
}
function busChanged() { // the bus's usual driver (fleet register), when the list knows exactly one person by that name
  if (!S.staff) return;
  const bus = fillList(), usual = bus && bus.usual && bus.usual.driver;
  if (!S.pick || S.auto) { setPick(usual ? findPick(S.ranked, usual) : null); S.auto = true; } // never over a person picked by hand
}
function nameChanged() {
  if (!S.staff) return;
  const e = findPick(S.ranked || [], $('name').value);
  S.pick = e; S.auto = false; showPick(e); $('code').value = e ? e.employeeCode : '';
}

async function create(e) {
  e.preventDefault();
  if (S.staff) nameChanged();
  const p = S.pick, reg = $('bus').value;
  // a picked name keeps only what a link's name may hold (letters, spaces, dots); the code is the person's own
  const driverName = cleanName(p ? p.name.replace(/[^A-Za-z .]+/g, ' ') : $('name').value), driverCode = p ? p.employeeCode : $('code').value.trim().toUpperCase();
  const msg = !reg ? 'Pick the bus.' : S.staff && !p ? 'Pick the driver from the list.' : !driverName ? 'Type the driver\'s name.' : !nameOk(driverName) ? 'The name can have letters, spaces and dots only.' : '';
  if (msg) { $('formMsg').textContent = msg; return; }
  const btn = $('create'); btn.disabled = true; btn.textContent = 'Creating…';
  try {
    const r = await roster({ action: 'driverlinkcreate', reg, driverName, ...(driverCode ? { driverCode } : {}) });
    showForm(false);
    showFresh(r.token, driverName, reg);
    await load();
  } catch (err) { $('formMsg').textContent = 'Not created: ' + err.message; }
  btn.disabled = false; btn.textContent = 'Create link';
}

// The only place a token is ever on screen. Done clears it from memory and the page.
function showFresh(token, name, reg) {
  S.fresh = token;
  let qr = '';
  try { const q = qrcode(0, 'M'); q.addData(linkUrl(token)); q.make(); qr = q.createSvgTag({ cellSize: 4, margin: 4, scalable: true }).replace('<svg ', '<svg class="dp-qr" role="img" aria-label="QR code for the driver link" '); }
  catch (e) { qr = ''; } // no library: the link text below does the job
  $('fresh').innerHTML = `<h2 class="cap-h">${esc(name)} · ${esc(reg)}</h2>${qr || `<p class="dp-url">${esc(linkUrl(token))}</p>`}` +
    '<ol class="dp-how"><li>Driver opens the camera on their own phone · ड्राइवर अपने फ़ोन का कैमरा खोलें</li>' +
    '<li>Points it at this code and taps the link · इस कोड पर कैमरा रखें, लिंक दबाएँ</li>' +
    '<li>Their phone says "नमस्ते, ' + esc(name) + '": done · फ़ोन पर नाम आ गया, बस</li></ol>' +
    '<p class="gb-note">Scan once on the driver\'s own phone. Anyone with this link can act as this driver: don\'t forward it elsewhere.</p>' +
    '<div class="gb-row-acts"><a class="gb-btn" target="_blank" rel="noopener" href="' + esc(whatsappUrl(token, name)) + '">Share on WhatsApp</a>' +
    '<button type="button" id="freshDone" class="gb-btn">Done</button></div>';
  $('fresh').hidden = false;
  $('freshDone').addEventListener('click', () => { S.fresh = null; $('fresh').innerHTML = ''; $('fresh').hidden = true; });
  $('fresh').scrollIntoView();
}

async function revoke(btn) {
  if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = 'Tap again to revoke'; return; }
  btn.disabled = true;
  try { await roster({ action: 'driverlinkrevoke', linkId: btn.closest('[data-id]').dataset.id }); await load(); toast('Revoked.'); }
  catch (e) { btn.disabled = false; toast('Not revoked: ' + e.message); }
}

let toastT;
function toast(msg) { $('toast').textContent = msg; clearTimeout(toastT); toastT = setTimeout(() => { $('toast').textContent = ''; }, 4000); }

boot();
