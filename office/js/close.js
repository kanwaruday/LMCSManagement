// Day close screen (FinanceHead / Owner). A close freezes the day; entries still queued on this device must reach the server first.
import { h, setKids } from './dom.js';
import { cashToPaise } from './report.js';
import { formatInr, isoToDmy } from './format.js';
import { todayIst, inflightGuard, balancesTable } from './daybook.js';
import { explainCode } from './attention.js';
import { reconLines, queueNotes, loadRecon, loadDeposits, mergeDeposits, depositItem, viewProof, closeProof } from './deposits.js';

const addDays = (iso, n) => new Date(new Date(iso + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
export const yesterdayIst = () => addDays(todayIst(), -1);
const CLOSE_ROLES = ['FinanceHead', 'Owner'];
const hasRole = (session, roles) => String(session.role || '').split(',').map((r) => r.trim()).some((r) => roles.includes(r));
const OPENING_FIELDS = [['cash', 'petty', 'Cash: petty'], ['cash', 'fee', 'Cash: fee'], ['cash', 'other', 'Cash: other'], ['bank', '', 'Bank'], ['upi', '', 'UPI']];
// texts: typed rupees, one per OPENING_FIELDS row (blank = 0). -> {ok, data:{campus, balances}} or {ok:false, errors:{index: text}}.
export function openingPayload(campus, texts) {
  const errors = {}, balances = [];
  OPENING_FIELDS.forEach(([mode, bucket, label], i) => {
    const p = cashToPaise((texts || [])[i]);
    if (p === null) errors[i] = 'Enter ' + label.toLowerCase() + ' in rupees, like 1234.50 (or 0).';
    else balances.push(bucket ? { mode, bucket, amount_paise: p } : { mode, amount_paise: p });
  });
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, data: { campus, balances } };
}
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
  let date = yesterdayIst(), closeId = null, timer = null, lastUnsigned = 0;
  const WHYSIGN = { ALREADY_SIGNED: 'already signed', NOT_FOUND: 'deposit not found' };
  const guard = inflightGuard();
  const dateIn = h('input', { type: 'date', value: date, max: date, 'aria-label': 'Day to close' });
  const proofEl = h('div', {}), info = h('div', { role: 'status' }), notes = h('div', { role: 'status' }), result = h('div', { role: 'status' }), msg = h('p', { role: 'status' });
  const closeBtn = h('button', { type: 'button', onclick: () => guard('close', async () => {
    closeBtn.disabled = true;
    // Re-check at click time: the page may be stale (an entry queued in another tab since the last render).
    const counts = await outbox.counts().catch(() => ({ waiting: 0, attention: 0 }));
    const why = closeBlockedReason({ waiting: counts.waiting, attention: counts.attention, unsigned: lastUnsigned, isPast: date <= yesterdayIst() });
    if (why.blocked) { msg.textContent = why.message; check(); return; }
    try {
      closeId = await outbox.enqueue('day.close', { campus, close_date: date });
      msg.textContent = 'Close saved — will sync';
      outbox.flush().then(check).catch(() => {}); watch();
    } catch (err) { msg.textContent = 'Could not save on this device: ' + (err && err.message || err); closeBtn.disabled = false; }
  }) }, 'Close day');
  const form = h('div', { class: 'office-form' }, h('label', { for: 'cl-date' }, 'Day to close'), dateIn, info, notes, closeBtn, msg, result, proofEl);
  dateIn.id = 'cl-date';

  async function check() {
    const d = date;
    const [recon, ds, entries, counts] = await Promise.all([loadRecon(api, campus, d, 'clrecon'), loadDeposits(api, campus, d, 'cldeps'), outbox.entries().catch(() => []), outbox.counts().catch(() => ({ waiting: 0, attention: 0 }))]);
    if (recon.stale || ds.stale || d !== date) return;
    const mine = entries.filter((e) => e.action === 'day.close' && e.data.close_date === d);
    const signQ = new Map(entries.filter((e) => e.action === 'deposit.sign').map((e) => [e.data.deposit_id, e]));
    const items = mergeDeposits(ds.success ? ds.deposits : [], entries, d);
    const unsigned = items.filter((x) => !x.queued && !x.signed && !signQ.has(x.id));
    const closed = recon.success && recon.closed === true;
    lastUnsigned = unsigned.length;
    const why = closeBlockedReason({ waiting: counts.waiting, attention: counts.attention, unsigned: unsigned.length, isPast: d <= yesterdayIst() });
    closeBtn.disabled = closed || why.blocked || mine.some((e) => e.status === 'waiting');
    const sign = (x) => {
      if (x.queued || x.signed || closed) return null;
      const e = signQ.get(x.id);
      return e ? h('span', { class: e.status === 'attention' ? 'flag bad' : 'flag' }, e.status === 'attention' ? 'Signing needs attention: ' + (WHYSIGN[e.code] || e.error || e.code) : 'Signature waiting to sync') : signBtn(x.id);
    };
    if (!recon.success) setKids(info, h('p', { class: 'flag bad' }, 'Could not load the reconciliation (offline or unavailable).'));
    else setKids(info, h('h3', {}, 'Reconciliation for ' + isoToDmy(d)), h('ul', {}, reconLines(recon).map((l) => h('li', {}, l))),
      h('h3', {}, 'Deposits for this day'),
      !ds.success ? h('p', { class: 'flag bad' }, 'Could not load the deposit list.') : null,
      items.length ? h('ul', { class: 'office-list' }, items.map((x) => depositItem(x, viewBtn(x), sign(x)))) : (ds.success ? h('p', {}, 'No deposits for this day.') : null));
    setKids(notes, why.message && !closed ? h('p', { class: why.blocked ? 'flag bad' : 'flag' }, why.message) : null, queueNotes(entries.filter((e) => e.action === 'day.close')).map((n) => h('p', { class: n.bad ? 'flag bad' : 'flag' }, n.text)));
    // Closed: the server says so (also after a reload), or our close just synced. Show that day's balances.
    if (closed || (closeId && !mine.length)) {
      const bal = await api.read('daybook.balances', { campus, date: d }, 'clbal');
      if (!bal.stale && bal.success && d === date) {
        clearInterval(timer); timer = null; closeId = null; closeBtn.disabled = true;
        msg.textContent = 'Day closed.';
        setKids(result, h('h3', {}, 'Closing balances for ' + isoToDmy(d)), balancesTable(bal));
        return;
      }
    } else setKids(result);
    if (mine.some((e) => e.status === 'waiting')) watch(); else if (timer) { clearInterval(timer); timer = null; }
  }
  const viewBtn = (x) => {
    const b = h('button', { type: 'button', class: 'secondary', onclick: () => guard('view', async () => {
      b.disabled = true;
      try { await viewProof(api, campus, x.file_id, proofEl); }
      catch (err) { setKids(proofEl, h('p', { class: 'flag bad' }, err && err.message || String(err))); }
      b.disabled = false;
    }) }, 'View slip');
    return b;
  };
  const signBtn = (id) => { const b = h('button', { type: 'button', onclick: () => guard('sign:' + id, async () => {
    b.disabled = true;
    try { await outbox.enqueue('deposit.sign', { campus, deposit_id: id }); outbox.flush().then(check).catch(() => {}); await check(); }
    catch (err) { msg.textContent = 'Could not save on this device: ' + (err && err.message || err); b.disabled = false; }
  }) }, 'Sign'); return b; };
  const watch = () => { if (!timer) timer = setInterval(check, 10000); };
  dateIn.addEventListener('change', () => { if (dateIn.value && dateIn.value <= yesterdayIst()) { date = dateIn.value; closeId = null; closeProof(); setKids(result); setKids(proofEl); msg.textContent = ''; check(); } else dateIn.value = date; });
  window.addEventListener('pagehide', closeProof);
  window.addEventListener('online', () => { outbox.flush().then(check).catch(() => {}); });
  const opIn = OPENING_FIELDS.map(([, , label], i) => h('input', { type: 'text', inputmode: 'decimal', id: 'op-' + i, 'aria-label': label + ' opening balance' }));
  const opMsg = h('p', { role: 'status' });
  const opBtn = h('button', { type: 'button', onclick: () => guard('opening', async () => {
    const r = openingPayload(campus, opIn.map((i) => i.value));
    if (!r.ok) { opMsg.textContent = Object.values(r.errors)[0]; return; }
    if (!confirm('Set opening balances for ' + campus + '? This can only be done before any day book entry exists.')) return;
    opBtn.disabled = true; opMsg.textContent = '';
    try {
      const id = await outbox.enqueue('opening.set', r.data);
      await outbox.flush().catch(() => {});
      const e = (await outbox.entries()).find((x) => x.id === id);
      opMsg.textContent = !e ? 'Opening balances synced.' : e.status === 'attention' ? explainCode(e.code) : 'Saved on this device, will sync when online.';
    } catch (err) { opMsg.textContent = 'Could not save on this device: ' + (err && err.message || err); }
    opBtn.disabled = false;
  }) }, 'Set opening balances');
  const opening = h('div', { class: 'office-form' }, h('h3', {}, 'Opening balances'), h('p', {}, 'Amounts in rupees at the start of the pilot; blank means 0. Only possible before the first day book entry.'),
    OPENING_FIELDS.map(([, , label], i) => h('div', {}, h('label', { for: 'op-' + i }, label), opIn[i])), opBtn, opMsg);
  root.replaceChildren(h('h2', {}, 'Close Day'), form, opening);
  await check();
}
