// Driver fills (office/driver-fills.html): the fuel fills drivers sent from their phones, checked against the bill photo and the pump
// video. Confirm is one tap; Reject asks a short reason. Fills and decisions live on the Roster web app (driverfilllist /
// driverfilldecide, apps-script/driver-fill-confirm.gs); the Day Book entry is made by the Office backend (driverfill.daybook,
// apps-script/office-driver-fills.gs), which stays off until after the 31 Oct count and then answers DRIVER_FILLS_OFF.
import { h, setKids } from './dom.js';
import { formatInr } from './format.js';
import { BUCKETS } from './daybook.js';

export const ROSTER_URL = 'https://script.google.com/macros/s/AKfycbyHiaZY_iWK2VTKKFJcCsBNnIbUndJYUSjnPkxvJ-dYavaihiul2xBJuJohPRsP9Spf/exec'; // = coordinator/capture/drivers.js
const PAY_KEY = 'lmcs-office-dfl-pay:';
const AFTER_COUNT = 'Goes into the Day Book after 31 Oct';

// Who may see the fills (money): Fee Clerk, Coordinator, Owner.
export const canSeeFills = (session) => ['FeeClerk', 'Coordinator', 'Owner'].some((r) => String((session && session.role) || '').split(',').map((x) => x.trim()).includes(r));
// '₹94.12/L' of a fill, or '' when it cannot be worked out.
export const perLitre = (f) => (f.litres > 0 && f.amount > 0 ? '₹' + (f.amount / f.litres).toFixed(2) + '/L' : '');
export const driveUrl = (id) => 'https://drive.google.com/file/d/' + encodeURIComponent(id) + '/view';
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }) : '');

export async function roster(body) {
  const s = window.LMCS.getSession();
  if (!s) throw new Error('Signed out. Sign in again.');
  let r;
  try { r = JSON.parse(await (await fetch(ROSTER_URL, { method: 'POST', body: JSON.stringify({ idToken: s.idToken, ...body }) })).text()); }
  catch (e) { throw new Error('No connection'); }
  if (!r.success) throw new Error(r.error || 'Request failed');
  return r;
}

// Pending fills of one campus (the Office header's): the count on the Live Buses page.
export async function pendingCount(campus) {
  return (await roster({ action: 'driverfilllist' })).fills.filter((f) => f.campus === campus && f.status === 'pending').length;
}

export async function showDriverFills(root, session, api) {
  const campus = session.campus;
  if (!canSeeFills(session)) { setKids(root, h('p', {}, 'Driver fills are for the Fee Clerk, Coordinators and the Owner.')); return; }
  const msg = h('p', { role: 'status', 'aria-live': 'polite' });
  const paySel = h('select', { id: 'dfl-pay' });
  const list = h('ul', { class: 'office-list' }), done = h('ul', { class: 'office-list' });
  setKids(root, h('div', { class: 'office-form' }, h('label', { for: 'dfl-pay' }, 'Paid from (for the Day Book)'), paySel), msg,
    h('h2', {}, 'Waiting for you'), list, h('h2', {}, 'Decided in the last 14 days'), done);
  let fills = [];

  const conf = await api.read('config.get', {}).catch(() => null);
  const accts = ((conf && conf.success && conf.accounts) || []).filter((a) => a.active && a.campus === campus);
  setKids(paySel, h('option', { value: '' }, 'Choose…'), ...accts.filter((a) => a.kind === 'credit').map((a) => h('option', { value: a.id + '|' }, a.label)),
    ...accts.filter((a) => a.kind === 'cash').flatMap((a) => Object.entries(BUCKETS).map(([k, v]) => h('option', { value: a.id + '|' + k }, v))));
  try { const saved = localStorage.getItem(PAY_KEY + campus); if ([...paySel.options].some((o) => o.value === saved)) paySel.value = saved; } catch (_) {}
  paySel.onchange = () => { try { localStorage.setItem(PAY_KEY + campus, paySel.value); } catch (_) {} };

  // The Day Book half of a confirm. Off until after the count: the fill stays confirmed and the screen says when it goes in.
  async function toDayBook(f) {
    // blank "Paid from": the server answers DRIVER_FILLS_OFF while off, and BAD_ACCOUNT (writing nothing) once on
    if (!paySel.value) { const r0 = await api.write('driverfill.daybook', { campus, fill_id: f.fillId, account: '', bucket: '' }).catch(() => ({}));
      if (r0.code === 'DRIVER_FILLS_OFF' || /^Unknown action/.test(r0.error || '')) return AFTER_COUNT + '.';
      return 'Choose "Paid from" above, then tap Add to Day Book.'; } // money never goes to a default account
    const [account, bucket] = paySel.value.split('|');
    const r = await api.write('driverfill.daybook', { campus, fill_id: f.fillId, account: account || '', bucket: bucket || '' });
    if (r.success) { f.dayBookEntryId = r.id; return 'Added to the Day Book.'; }
    if (r.code === 'DRIVER_FILLS_OFF' || /^Unknown action/.test(r.error || '')) return AFTER_COUNT + '.'; // an Office backend not yet redeployed is off too
    if (r.error === 'FORBIDDEN_ROLE') return 'The Fee Clerk adds it to the Day Book.';
    return 'Not in the Day Book yet: ' + (r.error || 'no connection') + '. Try "Add to Day Book" again.';
  }

  async function decide(f, decision, btns) {
    let reason = '';
    if (decision === 'reject') {
      reason = (prompt('Why is this fill rejected? (a few words, only staff see it)') || '').trim();
      if (!reason) return;
    }
    btns.forEach((b) => { b.disabled = true; });
    msg.textContent = 'Saving…';
    try {
      await roster({ action: 'driverfilldecide', fillId: f.fillId, decision, reason });
      f.status = decision === 'confirm' ? 'confirmed' : 'rejected'; f.reason = reason; f.decidedAt = new Date().toISOString();
      msg.textContent = decision === 'confirm' ? 'Confirmed. ' + await toDayBook(f) : 'Rejected.';
    } catch (e) { msg.textContent = 'Not saved: ' + e.message; }
    draw();
  }

  async function retry(f, btn) {
    btn.disabled = true; msg.textContent = 'Saving…';
    msg.textContent = await toDayBook(f);
    draw();
  }

  const card = (f, acts) => h('li', {},
    h('b', {}, f.reg), ' · ', f.driverName, ' · ', day(f.filledAt || f.received),
    h('div', { class: 'meta' }, [f.litres + ' L', formatInr(Math.round(f.amount * 100)), f.odometer.toLocaleString('en-IN') + ' km', perLitre(f)].filter(Boolean).join(' · ')),
    h('div', {}, h('a', { href: driveUrl(f.billFileId), target: '_blank', rel: 'noopener' }, 'View bill'), ' · ',
      h('a', { href: driveUrl(f.videoFileId), target: '_blank', rel: 'noopener' }, 'View video')),
    acts);

  function draw() {
    const mine = fills.filter((f) => f.campus === campus);
    const pending = mine.filter((f) => f.status === 'pending'), decided = mine.filter((f) => f.status !== 'pending');
    setKids(list, pending.length ? pending.map((f) => {
      const ok = h('button', { type: 'button', class: 'dfl-confirm' }, 'Confirm'), no = h('button', { type: 'button' }, 'Reject');
      ok.onclick = () => decide(f, 'confirm', [ok, no]); no.onclick = () => decide(f, 'reject', [ok, no]);
      return card(f, h('div', { class: 'row-actions' }, ok, no));
    }) : h('li', { class: 'meta' }, 'No fills waiting.'));
    setKids(done, decided.length ? decided.map((f) => {
      if (f.status === 'rejected') return card(f, h('div', { class: 'flag bad' }, 'Rejected' + (f.reason ? ': ' + f.reason : '')));
      if (f.dayBookEntryId) return card(f, h('div', { class: 'proof' }, 'Confirmed · in the Day Book'));
      const add = h('button', { type: 'button' }, 'Add to Day Book');
      add.onclick = () => retry(f, add);
      return card(f, [h('div', { class: 'flag' }, 'Confirmed · ' + AFTER_COUNT), h('div', { class: 'row-actions' }, add)]);
    }) : h('li', { class: 'meta' }, 'Nothing decided yet.'));
  }

  msg.textContent = 'Loading…';
  try { fills = (await roster({ action: 'driverfilllist' })).fills; msg.textContent = ''; }
  catch (e) { msg.textContent = 'Could not load (' + e.message + '). Check the connection, then reload.'; }
  draw();
}
