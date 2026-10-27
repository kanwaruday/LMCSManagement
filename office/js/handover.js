// Cash handover between campuses: the Day Book's "Hand over cash" block and the Today screen's Accept / Not received list.
import { h, setKids } from './dom.js';
import { parseRupeesToPaise, formatInr } from './format.js';
import { entryReason, explainCode } from './codes.js';

// Receiving cash boxes: active cash accounts of the other campuses (HES included).
export const handoverTargets = (accounts, campus) => (accounts || []).filter((a) => a.kind === 'cash' && a.active && a.campus !== campus);

// The Day Book's Hand over block: a desk role signed in to one real campus (not ALL).
const DESK = ['FeeClerk', 'AdminManager', 'FinanceHead', 'Owner'];
export const canHandOver = (session) => /^(LMS[1-6]|HES)$/.test(String((session && session.campus) || '')) &&
  String((session && session.role) || '').split(',').map((r) => r.trim()).some((r) => DESK.includes(r));

export function handoverPayload(campus, to, bucket, amountText, note, date) {
  if (!to) return { ok: false, error: 'Choose the school receiving the cash.' };
  if (!bucket) return { ok: false, error: 'Choose the cash bucket.' };
  const p = parseRupeesToPaise(amountText);
  if (!p) return { ok: false, error: 'Enter the amount in rupees, like 1234.50.' };
  return { ok: true, data: { campus, date, from_account: 'cash:' + campus, to_account: to, bucket, amount_paise: p, note: String(note || '').trim() } };
}

// One cash.handovers item as a line of text.
export function handoverLabel(x, label = (c) => c) {
  const amt = formatInr(x.amount_paise);
  if (x.receiver) return (x.state === 'disputed' ? 'Reported not received: ' : 'Accept ') + amt + ' from ' + label(x.from_campus) + (x.by_name ? ' (' + x.by_name + ')' : '') + (x.note ? ' · ' + x.note : '');
  return 'Handed over ' + amt + ' to ' + label(x.to_campus) + (x.state === 'disputed'
    ? ': they report it not received (' + x.dispute_note + '). If so, reverse the entry in the Day Book.' : ': waiting for them to accept.');
}

// Queue a write, try to send it, and say what happened.
async function send(outbox, action, data, msg, okText) {
  try {
    const id = await outbox.enqueue(action, data);
    await outbox.flush().catch(() => {});
    const e = (await outbox.entries()).find((x) => x.id === id);
    msg.textContent = !e ? okText : e.status === 'attention' ? entryReason(e) : 'Saved on this device, will sync when online.';
    return !e;
  } catch (err) { msg.textContent = 'Could not save on this device: ' + (err && err.message || err); return false; }
}

// Day Book block. Returns {el, paint(accounts)}; paint fills the receiving list once config is loaded.
export function handoverForm({ campus, buckets, outbox, today, onSaved }) {
  const toSel = h('select', { id: 'ho-to' }), bucketSel = h('select', { id: 'ho-bucket' }, h('option', { value: '' }, 'Choose…'), Object.entries(buckets).map(([v, t]) => h('option', { value: v }, t)));
  const amt = h('input', { type: 'text', id: 'ho-amt', inputmode: 'decimal' }), note = h('input', { type: 'text', id: 'ho-note', maxlength: 120 }), msg = h('p', { role: 'status' });
  const btn = h('button', { type: 'button' }, 'Hand over');
  btn.addEventListener('click', async () => {
    const r = handoverPayload(campus, toSel.value, bucketSel.value, amt.value, note.value, today());
    if (!r.ok) { msg.textContent = r.error; return; }
    btn.disabled = true;
    try { if (await send(outbox, 'cash.handover', r.data, msg, 'Handed over. It shows in their Today list until they accept it.')) { amt.value = ''; note.value = ''; } if (onSaved) onSaved(); } finally { btn.disabled = false; }
  });
  const lab = (id, t) => h('label', { for: id }, t);
  const el = h('div', { class: 'office-form' }, h('h3', {}, 'Hand over cash to another school'),
    h('p', { class: 'meta' }, 'The cash leaves your book today; it reaches theirs when they accept it.'),
    lab('ho-to', 'Receiving cash box'), toSel, lab('ho-bucket', 'From which cash'), bucketSel, lab('ho-amt', 'Amount (rupees)'), amt, lab('ho-note', 'Note (who carried it, what for)'), note, btn, msg);
  const paint = (accounts) => setKids(toSel, h('option', { value: '' }, 'Choose…'), handoverTargets(accounts, campus).map((a) => h('option', { value: a.id }, a.label + ' (' + a.campus + ')')));
  return { el, paint };
}

// Today screen block: open handovers the caller sends or receives; the receiver gets Accept / Not received.
export async function showHandovers(el, api, outbox) {
  const label = (c) => (window.LMCS && window.LMCS.campusLabel ? window.LMCS.campusLabel(c) : c);
  const r = await api.read('cash.handovers', {}, 'handovers');
  if (r.stale) return;
  if (!r.success) { setKids(el, r.network ? null : h('p', {}, 'Could not load cash handovers: ' + explainCode(r.code || r.error))); return; }
  if (!r.handovers.length) { setKids(el); return; }
  const msg = h('p', { role: 'status' });
  const again = () => showHandovers(el, api, outbox);
  setKids(el, h('h3', {}, 'Cash handovers'), h('ul', { class: 'office-list' }, r.handovers.map((x) => {
    const acts = [];
    if (x.receiver && x.state === 'pending') {
      const ok = h('button', { type: 'button' }, 'Accept'), no = h('button', { type: 'button', class: 'secondary' }, 'Not received');
      ok.addEventListener('click', async () => { ok.disabled = true; if (await send(outbox, 'cash.accept', { handover: x.id }, msg, 'Accepted: added to your cash book.')) again(); else ok.disabled = false; });
      no.addEventListener('click', async () => {
        const n = (window.prompt('What was not received? (for example: got ₹150 only, or nothing came)') || '').trim();
        if (!n) return;
        no.disabled = true;
        if (await send(outbox, 'cash.dispute', { handover: x.id, note: n }, msg, 'Reported to the sender.')) again(); else no.disabled = false;
      });
      acts.push(' ', ok, ' ', no);
    }
    return h('li', {}, handoverLabel(x, label), ...acts);
  })), msg);
}
