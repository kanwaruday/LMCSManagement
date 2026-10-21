// Daily Report screen. A re-submit for a date is a new row; the latest wins (backend R5).
import { h, field } from './dom.js';
import { parseRupeesToPaise, formatInr, isoToDmy } from './format.js';
import { todayIst, BUCKETS } from './daybook.js';

// Report cash may legitimately be zero (blank or 0), unlike a day-book amount.
function cashToPaise(text) {
  const t = String(text == null ? '' : text).trim();
  if (t === '' || /^₹?\s*0+(\.0{1,2})?$/.test(t)) return 0;
  return parseRupeesToPaise(t);
}

// form: {campus, report_date, hourly:[string], footfall, feedback_pos, feedback_neg, leave_status,
//   external_docs, cash:{petty,fee,other}} (cash as typed rupees). Returns {ok, payload, errors}.
export function reportDraftToPayload(form) {
  const errors = {};
  const cash = {};
  Object.keys(BUCKETS).forEach((b) => {
    const p = cashToPaise((form.cash || {})[b]);
    if (p === null) errors['cash_' + b] = 'Enter ' + BUCKETS[b].toLowerCase() + ' in rupees, like 1234.50 (or 0).';
    else cash[b] = p;
  });
  const ff = String(form.footfall == null ? '' : form.footfall).trim();
  if (!/^\d{1,9}$/.test(ff)) errors.footfall = 'Enter the number of visitors (0 or more).';
  if (!form.report_date) errors.report_date = 'Choose the date.';
  if (Object.keys(errors).length) return { ok: false, errors };
  const t = (s) => String(s || '').trim();
  return {
    ok: true, errors,
    payload: {
      campus: form.campus, report_date: form.report_date,
      hourly: (form.hourly || []).map(t).filter(Boolean).map((text) => ({ text })),
      footfall: Number(ff), feedback_pos: t(form.feedback_pos), feedback_neg: t(form.feedback_neg),
      leave_status: t(form.leave_status), external_docs: t(form.external_docs), cash,
    },
  };
}

// What the outbox says about the report for `date`: the newest queued report.submit decides.
// 'waiting' | 'attention' (with error) | 'synced' (nothing queued, server holds knownId) |
// 'missing' (we submitted knownId this session, it is no longer queued and the server does not hold it) | 'none'.
export function reportQueueState(entries, date, serverReport, knownId) {
  const mine = (entries || []).filter((e) => e.action === 'report.submit' && e.data && e.data.report_date === date).sort((a, b) => a.seq - b.seq);
  const e = mine[mine.length - 1];
  if (e) return e.status === 'attention' ? { state: 'attention', id: e.id, error: e.error || e.code || 'Refused' } : { state: 'waiting', id: e.id };
  if (!knownId) return { state: 'none' };
  return serverReport && serverReport.id === knownId ? { state: 'synced', id: knownId } : { state: 'missing', id: knownId };
}

// report.get cashMismatch -> plain sentences.
export const mismatchLines = (list) => (list || []).map((m) => (BUCKETS[m.bucket] || m.bucket) + ': report ' + formatInr(m.report_paise) + ', day book ' + formatInr(m.daybook_paise));

export async function showReport(root, session, api, outbox) {
  const campus = session.campus;
  let date = todayIst();
  let knownId = null, pendingShown = false, timer = null;

  const dateIn = h('input', { type: 'date', value: date, max: date });
  const dateF = field('rp-date', 'Report date', dateIn);
  const hourlyBox = h('div', {});
  const addHourly = (text = '') => {
    const input = h('input', { type: 'text', 'aria-label': 'Hourly note', autocomplete: 'off', value: text });
    const row = h('div', { class: 'row' }, input, h('button', { type: 'button', class: 'secondary', 'aria-label': 'Remove this hourly row', onclick: () => row.remove() }, 'Remove'));
    hourlyBox.append(row);
  };
  addHourly();
  const footIn = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off' });
  const footF = field('rp-foot', 'Footfall (visitors)', footIn);
  const posIn = h('textarea', { rows: '2' }), negIn = h('textarea', { rows: '2' }), leaveIn = h('textarea', { rows: '2' }), docsIn = h('textarea', { rows: '2' });
  const cashIn = {}, cashF = {};
  Object.entries(BUCKETS).forEach(([b, label]) => {
    cashIn[b] = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00' });
    cashF[b] = field('rp-cash-' + b, label + ' (₹)', cashIn[b]);
  });
  const saveBtn = h('button', { type: 'submit' }, 'Submit report');
  const msg = h('p', { role: 'status' });
  const statusEl = h('div', { role: 'status' });

  const form = h('form', { class: 'office-form', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    [footF, dateF, ...Object.values(cashF)].forEach((f) => { f.err.textContent = ''; });
    const r = reportDraftToPayload({
      campus, report_date: dateIn.value, hourly: [...hourlyBox.querySelectorAll('input')].map((i) => i.value), footfall: footIn.value,
      feedback_pos: posIn.value, feedback_neg: negIn.value, leave_status: leaveIn.value, external_docs: docsIn.value,
      cash: { petty: cashIn.petty.value, fee: cashIn.fee.value, other: cashIn.other.value },
    });
    if (!r.ok) {
      footF.err.textContent = r.errors.footfall || ''; dateF.err.textContent = r.errors.report_date || '';
      Object.keys(cashF).forEach((b) => { cashF[b].err.textContent = r.errors['cash_' + b] || ''; });
      return;
    }
    saveBtn.disabled = true;
    try {
      knownId = await outbox.enqueue('report.submit', r.payload);
      msg.textContent = 'Saved — will sync';
      outbox.flush().then(check).catch(() => {});
      watch();
    } catch (err) { msg.textContent = 'Could not save on this device: ' + (err && err.message || err); }
    saveBtn.disabled = false;
  } },
  dateF.root, h('label', {}, 'Hourly notes'), hourlyBox, h('button', { type: 'button', class: 'secondary', onclick: () => addHourly() }, 'Add hourly row'),
  footF.root,
  field('rp-pos', 'Positive feedback', posIn).root, field('rp-neg', 'Negative feedback', negIn).root,
  field('rp-leave', 'Leave status', leaveIn).root, field('rp-docs', 'External documents received', docsIn).root,
  ...Object.values(cashF).map((f) => f.root), saveBtn, msg);

  // Queued state comes from the outbox; the server's latest id only confirms a sync.
  async function check() {
    const d = dateIn.value;
    const [r, entries] = await Promise.all([api.read('report.get', { campus, report_date: d }, 'rpget'), outbox.entries().catch(() => [])]);
    if (r.stale || d !== dateIn.value) return;
    const q = reportQueueState(entries, d, r.success ? r.report : null, knownId);
    if (q.state === 'waiting') { msg.textContent = 'Saved — will sync'; watch(); }
    else {
      clearInterval(timer); timer = null;
      if (q.state === 'attention') msg.textContent = 'Needs attention: ' + q.error;
      else if (q.state === 'synced') { msg.textContent = 'Saved and synced.'; knownId = null; }
      else if (q.state === 'missing') msg.textContent = 'The report is no longer waiting to send, but the server does not show it. Check the saved report below and submit again if needed.';
      else if (!pendingShown) msg.textContent = '';
    }
    pendingShown = q.state === 'waiting' || q.state === 'attention';
    if (!r.success) { statusEl.textContent = 'Could not load the saved report (offline or unavailable).'; return; }
    const lines = r.report ? mismatchLines(r.cashMismatch) : [];
    statusEl.replaceChildren(
      r.report ? h('p', {}, 'Report for ' + isoToDmy(d) + ' saved on the server' + (r.report.late === 'true' ? ' (late)' : '') + '.') : h('p', {}, 'No report on the server for ' + isoToDmy(d) + ' yet.'),
      q.state === 'waiting' ? h('p', {}, 'A newer report is waiting to sync.') : null,
      q.state === 'attention' ? h('p', { class: 'flag bad' }, 'A newer report needs attention: ' + q.error) : null,
      lines.length ? h('div', {}, h('p', { class: 'flag bad' }, 'Cash does not match the day book:'), h('ul', {}, lines.map((l) => h('li', {}, l)))) : (r.report ? h('p', {}, 'Cash matches the day book.') : null));
  }
  const watch = () => { if (!timer) timer = setInterval(check, 10000); };
  dateIn.addEventListener('change', () => { if (dateIn.value && dateIn.value <= todayIst()) { date = dateIn.value; check(); } else dateIn.value = date; });
  window.addEventListener('online', () => { outbox.flush().then(check).catch(() => {}); });

  root.replaceChildren(h('h2', {}, 'Daily Report'), statusEl, form);
  await check();
}
