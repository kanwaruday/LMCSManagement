// Day close screen (FinanceHead / Owner). A close freezes the day; entries still queued on this device must reach the server first.
import { h } from './dom.js';
import { formatInr, isoToDmy } from './format.js';
import { todayIst, inflightGuard, balancesTable } from './daybook.js';
import { reconLines, queueNotes, loadRecon } from './deposits.js';

const addDays = (iso, n) => new Date(new Date(iso + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
export const yesterdayIst = () => addDays(todayIst(), -1);
const CLOSE_ROLES = ['FinanceHead', 'Owner'];
const hasRole = (session, roles) => String(session.role || '').split(',').map((r) => r.trim()).some((r) => roles.includes(r));
const OTHER = ' Entries on other devices cannot be checked from here; make sure the other clerks have synced.';

// {waiting, attention, unsigned, isPast} -> {blocked, message}. isPast === false (today/future) blocks; undefined does not.
export function closeBlockedReason({ waiting = 0, attention = 0, unsigned = 0, isPast } = {}) {
  if (isPast === false) return { blocked: true, message: 'Only a day that is over can be closed. Choose yesterday or earlier.' };
  if (waiting > 0) return { blocked: true, message: waiting + (waiting === 1 ? ' entry on this device is' : ' entries on this device are') + ' not synced yet. Sync them first.' + OTHER };
  const warn = [];
  if (unsigned > 0) warn.push(unsigned + ' deposit' + (unsigned === 1 ? ' is' : 's are') + ' not signed yet.');
  if (attention > 0) warn.push(attention + (attention === 1 ? ' entry on this device needs' : ' entries on this device need') + ' attention.');
  return { blocked: false, message: warn.join(' ') + (warn.length ? OTHER : '') };
}

export async function showClose(root, session, api, outbox) {
  if (!hasRole(session, CLOSE_ROLES)) {
    root.replaceChildren(h('h2', {}, 'Close Day'), h('p', {}, 'Closing a day is not available for your role. Ask the Finance Head or Owner.'));
    return;
  }
  const campus = session.campus;
  let date = yesterdayIst(), closeId = null, timer = null;
  const guard = inflightGuard();
  const dateIn = h('input', { type: 'date', value: date, max: date, 'aria-label': 'Day to close' });
  const info = h('div', { role: 'status' }), notes = h('div', { role: 'status' }), result = h('div', { role: 'status' }), msg = h('p', { role: 'status' });
  const closeBtn = h('button', { type: 'button', onclick: () => guard('close', async () => {
    closeBtn.disabled = true;
    try {
      closeId = await outbox.enqueue('day.close', { campus, close_date: date });
      msg.textContent = 'Close saved — will sync';
      outbox.flush().then(check).catch(() => {}); watch();
    } catch (err) { msg.textContent = 'Could not save on this device: ' + (err && err.message || err); closeBtn.disabled = false; }
  }) }, 'Close day');
  const form = h('div', { class: 'office-form' }, h('label', { for: 'cl-date' }, 'Day to close'), dateIn, info, notes, closeBtn, msg, result);
  dateIn.id = 'cl-date';

  async function check() {
    const d = date;
    const [recon, entries, counts] = await Promise.all([loadRecon(api, campus, d, 'clrecon'), outbox.entries().catch(() => []), outbox.counts().catch(() => ({ waiting: 0, attention: 0 }))]);
    if (recon.stale || d !== date) return;
    const mine = entries.filter((e) => e.action === 'day.close' && e.data.close_date === d);
    const signQ = new Map(entries.filter((e) => e.action === 'deposit.sign').map((e) => [e.data.deposit_id, e]));
    const unsigned = recon.success ? recon.unsigned.filter((id) => !signQ.has(id)) : [];
    const why = closeBlockedReason({ waiting: counts.waiting, attention: counts.attention, unsigned: unsigned.length, isPast: d <= yesterdayIst() });
    closeBtn.disabled = why.blocked || mine.some((e) => e.status === 'waiting');
    if (!recon.success) info.replaceChildren(h('p', { class: 'flag bad' }, 'Could not load the reconciliation (offline or unavailable).'));
    else info.replaceChildren(h('div', {},
      h('h3', {}, 'Reconciliation for ' + isoToDmy(d)), h('ul', {}, reconLines(recon).map((l) => h('li', {}, l))),
      unsigned.length || signQ.size ? h('h3', {}, 'Deposits to sign') : null,
      h('ul', { class: 'office-list' }, [...unsigned.map((id) => h('li', {}, 'Deposit ' + id.slice(0, 8), ' ', signBtn(id))),
        ...recon.unsigned.filter((id) => signQ.has(id)).map((id) => { const e = signQ.get(id); return h('li', {}, 'Deposit ' + id.slice(0, 8), ' ', h('span', { class: e.status === 'attention' ? 'flag bad' : 'flag' }, e.status === 'attention' ? 'Signing needs attention: ' + (e.error || e.code) : 'Signature waiting to sync')); })])));
    notes.replaceChildren(h('div', {}, why.message ? h('p', { class: why.blocked ? 'flag bad' : 'flag' }, why.message) : null), ...queueNotes(entries.filter((e) => e.action === 'day.close')).map((n) => h('p', { class: n.bad ? 'flag bad' : 'flag' }, n.text)));
    // Closed state: the close entry synced (no longer queued) and the day book now reports it.
    if (closeId && !mine.length) {
      const bal = await api.read('daybook.balances', { campus, date: d }, 'clbal');
      if (!bal.stale && bal.success && d === date) {
        clearInterval(timer); timer = null; closeId = null; closeBtn.disabled = true;
        msg.textContent = 'Day closed.';
        result.replaceChildren(h('h3', {}, 'Closing balances for ' + isoToDmy(d)), balancesTable(bal));
        return;
      }
    }
    if (mine.some((e) => e.status === 'waiting')) watch(); else if (timer) { clearInterval(timer); timer = null; }
  }
  const signBtn = (id) => { const b = h('button', { type: 'button', onclick: () => guard('sign:' + id, async () => {
    b.disabled = true;
    try { await outbox.enqueue('deposit.sign', { campus, deposit_id: id }); outbox.flush().then(check).catch(() => {}); await check(); }
    catch (err) { msg.textContent = 'Could not save on this device: ' + (err && err.message || err); b.disabled = false; }
  }) }, 'Sign'); return b; };
  const watch = () => { if (!timer) timer = setInterval(check, 10000); };
  dateIn.addEventListener('change', () => { if (dateIn.value && dateIn.value <= yesterdayIst()) { date = dateIn.value; closeId = null; result.replaceChildren(); msg.textContent = ''; check(); } else dateIn.value = date; });
  window.addEventListener('online', () => { outbox.flush().then(check).catch(() => {}); });
  root.replaceChildren(h('h2', {}, 'Close Day'), form);
  await check();
}
