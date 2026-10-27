// Deposits screen: record a bank deposit with its slip photo, enter the day's ERP total, see the reconciliation.
// Writes go through the FIFO outbox (file.upload first, then deposit.add, R7); viewing a proof is a direct audited call.
import { h, field, setKids, showDone, place } from './dom.js';
import { parseRupeesToPaise, formatInr, isoToDmy } from './format.js';
import { todayIst, inflightGuard, rollForward, rolledNote } from './daybook.js';
import { entryReason } from './codes.js';
import { resizeImage } from './image.js';

const RENDER_MIMES = ['image/jpeg', 'image/png', 'application/pdf']; // R19: nothing else is ever shown
export const canRenderMime = (mime) => RENDER_MIMES.includes(mime);

// form: {campus, covers_date, amount (typed rupees), bank_ref, hasFile}. Returns {ok, data, errors}; file_id is added by the caller.
export function depositFromForm(form) {
  const errors = {};
  const amount = parseRupeesToPaise(form.amount);
  if (amount === null) errors.amount = 'Enter the deposited amount in rupees, like 1234.50 (more than zero).';
  const ref = String(form.bank_ref || '').trim();
  if (!ref) errors.bank_ref = 'Enter the bank reference (slip or UTR number).';
  if (!form.covers_date) errors.covers_date = 'Choose the day whose collection this deposit covers.';
  if (!form.hasFile) errors.file = 'Add a photo or PDF of the deposit slip.';
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, errors, data: { campus: form.campus, covers_date: form.covers_date, amount_paise: amount, bank_ref: ref } };
}

const LABEL = { 'file.upload': 'Slip photo', 'deposit.add': 'Deposit', 'erp.set': 'ERP total', 'deposit.sign': 'Signature', 'day.close': 'Day close' };
// Outbox entries of this screen's actions -> [{text, bad}] (waiting = sending, attention = needs a person).
export function queueNotes(entries, actions = Object.keys(LABEL)) {
  return (entries || []).filter((e) => actions.includes(e.action)).map((e) => e.status === 'attention'
    ? { bad: true, text: (LABEL[e.action] || e.action) + ' needs attention: ' + entryReason(e) }
    : { bad: false, text: (LABEL[e.action] || e.action) + ' saved on this device, waiting to sync.' });
}

const ROLE = { erp: 'ERP total', daybook_fee_cash: 'day book fee cash', deposited: 'deposited' };
// recon.get -> sentences.
export function reconLines(r) {
  const out = [
    'ERP total: ' + (r.erp === null ? 'not entered yet' : formatInr(r.erp)),
    'Day book fee cash: ' + formatInr(r.daybook_fee_cash),
    'Deposited: ' + formatInr(r.deposited),
  ];
  (r.differences || []).forEach((d) => out.push('Difference: ' + ROLE[d.a] + ' ' + (d.delta_paise > 0 ? 'is ' + formatInr(d.delta_paise) + ' more than ' : 'is ' + formatInr(-d.delta_paise) + ' less than ') + ROLE[d.b] + '.'));
  if (r.overdue) out.push('Overdue: the fee cash for this day should have been deposited by the end of the next day.');
  return out;
}
export const loadRecon = (api, campus, date, key) => api.read('recon.get', { campus, date }, key);
export const loadDeposits = (api, campus, date, key) => api.read('deposit.list', { campus, covers_date: date }, key);

// Server deposits first, then deposit.add entries still in the outbox for that date (not yet on the server).
// Each: {id, amount_paise, bank_ref, file_id, covers_date, signed, queued, status, error}.
export function mergeDeposits(serverList, entries, date) {
  const have = new Set((serverList || []).map((d) => d.id));
  const queued = (entries || []).filter((e) => e.action === 'deposit.add' && e.data && e.data.covers_date === date && !have.has(e.id))
    .map((e) => ({ ...e.data, id: e.id, signed: false, queued: true, status: e.status, error: e.status === 'attention' ? entryReason(e) : '' }));
  return (serverList || []).map((d) => ({ ...d, queued: false })).concat(queued);
}

// One list item per deposit: amount, bank ref, state, View slip (synced only), and extra (e.g. a Sign button).
export function depositItem(d, viewBtn, extra) {
  return h('li', {}, formatInr(d.amount_paise) + ' · ' + d.bank_ref + ' · covers ' + isoToDmy(d.covers_date) + ' ',
    h('span', { class: d.status === 'attention' ? 'flag bad' : 'meta' }, d.queued ? (d.status === 'attention' ? 'Needs attention: ' + d.error : 'waiting to sync') : (d.signed ? 'signed' : 'not signed')),
    ' ', d.queued ? null : viewBtn, extra ? ' ' : null, extra);
}

// Fetch a proof (audited, never queued) and show it from a Blob URL only. Returns a close function.
// Only one proof is open at a time (module-level): opening another, or closeProof(), revokes the previous Blob URL.
let activeClose = null;
export function closeProof() { if (activeClose) { const c = activeClose; activeClose = null; c(); } }
export async function viewProof(api, campus, fileId, slot) {
  const r = await api.write('file.view', { id: fileId, campus });
  if (!r.success) throw new Error(r.error || 'Could not load the file');
  if (!canRenderMime(r.mime)) throw new Error('This file type cannot be shown.');
  const bin = atob(r.base64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: r.mime }));
  const view = r.mime === 'application/pdf' ? h('a', { href: url, target: '_blank', rel: 'noopener' }, 'Open the PDF') : h('img', { src: url, alt: 'Deposit slip', style: 'max-width:100%' });
  closeProof();
  const close = () => { URL.revokeObjectURL(url); slot.replaceChildren(); };
  activeClose = close;
  slot.replaceChildren(view, h('button', { type: 'button', class: 'secondary', onclick: close }, 'Close the file'));
}

export async function showDeposits(root, session, api, outbox) {
  const campus = session.campus;
  let date = todayIst(), timer = null;
  const guard = inflightGuard();

  const coversIn = h('input', { type: 'date', value: date, max: date });
  const coversF = field('dp-date', 'Collection day covered', coversIn);
  const amtIn = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00' });
  const amtF = field('dp-amt', 'Amount deposited (₹)', amtIn);
  const refIn = h('input', { type: 'text', autocomplete: 'off' });
  const refF = field('dp-ref', 'Bank reference', refIn);
  const fileIn = h('input', { type: 'file', accept: 'image/*,application/pdf', capture: 'environment' });
  const fileF = field('dp-file', 'Deposit slip (photo or PDF)', fileIn);
  const msg = h('p', { role: 'status' });
  const saveBtn = h('button', { type: 'submit' }, 'Save deposit');

  let auto = date;
  // Past midnight with the covered day still the load day: move it to today and stop the save (R41).
  const roll = (note) => {
    const r = rollForward(coversIn.value, auto); auto = r.auto; coversIn.max = r.max;
    if (!r.rolled) return false;
    date = coversIn.value = r.date; note.textContent = rolledNote(date); check();
    return true;
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') roll(msg); });

  const form = h('form', { class: 'office-form', novalidate: true, onsubmit: (e) => {
    e.preventDefault();
    if (roll(msg)) return;
    guard('deposit', async () => {
      [coversF, amtF, refF, fileF].forEach((f) => { f.err.textContent = ''; });
      const file = fileIn.files && fileIn.files[0];
      const r = depositFromForm({ campus, covers_date: coversIn.value, amount: amtIn.value, bank_ref: refIn.value, hasFile: !!file });
      if (!r.ok) { coversF.err.textContent = r.errors.covers_date || ''; amtF.err.textContent = r.errors.amount || ''; refF.err.textContent = r.errors.bank_ref || ''; fileF.err.textContent = r.errors.file || ''; return; }
      saveBtn.disabled = true;
      try {
        msg.textContent = 'Preparing the photo…';
        const img = await resizeImage(file);
        const fileId = await outbox.enqueue('file.upload', { campus, category: 'deposit_proof', belongs_to: '', name: file.name || 'deposit-slip', mime: img.mime, base64: img.base64 });
        await outbox.enqueue('deposit.add', { ...r.data, file_id: fileId });
        msg.textContent = 'Saved — will sync';
        const saved = r.data.amount_paise;
        amtIn.value = ''; refIn.value = ''; fileIn.value = '';
        outbox.flush().then(check).catch(() => {}); watch(); await check();
        showDone(form, formatInr(saved) + ' deposit saved for ' + place(campus) + '.', { again: 'Add another' });
      } catch (err) { msg.textContent = err && err.message || String(err); }
      saveBtn.disabled = false;
    });
  } }, coversF.root, amtF.root, refF.root, fileF.root, saveBtn, msg);

  // ERP total for the covered day (hand-entered; latest wins on the server).
  const erpIn = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00' });
  const erpF = field('dp-erp', 'ERP collection total for this day (₹, 0 is allowed)', erpIn);
  const erpMsg = h('p', { role: 'status' });
  const erpBtn = h('button', { type: 'submit' }, 'Save ERP total');
  const erpForm = h('form', { class: 'office-form', novalidate: true, onsubmit: (e) => {
    e.preventDefault();
    if (roll(erpMsg)) return;
    guard('erp', async () => {
      erpF.err.textContent = '';
      const t = erpIn.value.trim();
      const p = /^₹?\s*0+(\.0{1,2})?$/.test(t) ? 0 : parseRupeesToPaise(t);
      if (p === null) { erpF.err.textContent = 'Enter the ERP total in rupees, like 1234.50 (or 0).'; return; }
      erpBtn.disabled = true;
      try {
        await outbox.enqueue('erp.set', { campus, total_date: coversIn.value, amount_paise: p });
        erpIn.value = ''; erpMsg.textContent = 'Saved — will sync';
        outbox.flush().then(check).catch(() => {}); watch(); await check();
        showDone(erpForm, 'ERP total of ' + formatInr(p) + ' saved for ' + place(campus) + '.', { again: 'Change it' });
      } catch (err) { erpMsg.textContent = 'Could not save on this device: ' + (err && err.message || err); }
      erpBtn.disabled = false;
    });
  } }, erpF.root, erpBtn, erpMsg);

  const reconEl = h('div', { role: 'status' }), notesEl = h('div', { role: 'status' }), proofEl = h('div', {}), sentEl = h('div', {});

  async function check() {
    const d = coversIn.value;
    const [r, ds, entries] = await Promise.all([loadRecon(api, campus, d, 'dprecon'), loadDeposits(api, campus, d, 'dplist'), outbox.entries().catch(() => [])]);
    if (r.stale || ds.stale || d !== coversIn.value) return;
    const notes = queueNotes(entries);
    setKids(notesEl, notes.map((n) => h('p', { class: n.bad ? 'flag bad' : 'flag' }, n.text)));
    if (!notes.some((n) => !n.bad)) { clearInterval(timer); timer = null; if (msg.textContent === 'Saved — will sync') msg.textContent = 'Saved and synced.'; } else watch();
    setKids(reconEl, r.success
      ? h('div', {}, h('h3', {}, 'Reconciliation for ' + isoToDmy(d)), h('ul', {}, reconLines(r).map((l) => h('li', {}, l))), r.unsigned.length ? h('p', {}, r.unsigned.length + ' deposit(s) not signed yet by the Finance Head.') : null)
      : h('p', { class: 'flag bad' }, 'Could not load the reconciliation (offline or unavailable).'));
    const items = mergeDeposits(ds.success ? ds.deposits : [], entries, d);
    setKids(sentEl, h('h3', {}, 'Deposits for ' + isoToDmy(d)), ds.success || items.length ? null : h('p', { class: 'flag bad' }, 'Could not load the deposit list (offline or unavailable).'),
      items.length ? h('ul', { class: 'office-list' }, items.map((x) => depositItem(x, viewBtn(x)))) : (ds.success ? h('p', {}, 'No deposits for this day yet.') : null));
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
  const watch = () => { if (!timer) timer = setInterval(check, 10000); };
  coversIn.addEventListener('change', () => { if (coversIn.value && coversIn.value <= todayIst()) { date = coversIn.value; check(); } else coversIn.value = date; });
  window.addEventListener('online', () => { outbox.flush().then(check).catch(() => {}); });
  window.addEventListener('pagehide', closeProof);

  root.replaceChildren(h('h2', {}, 'Deposits'), reconEl, notesEl, h('h3', {}, 'New deposit'), form, h('h3', {}, 'ERP total'), erpForm, sentEl, proofEl);
  await check();
}
