// Day Book screen: entry form, the day's list (server rows + queued entries), balances, Reverse.
// Append-only: there is no edit and no delete; a correction is a reversing entry (daybook.reverse).
import { cacheGet, cacheSet } from './shell.js';
import { h, field } from './dom.js';
import { parseRupeesToPaise, formatInr, isoToDmy } from './format.js';

export const BUCKETS = { petty: 'Petty cash', fee: 'Fee cash', other: 'Other cash' };
export const MODES = { cash: 'Cash', bank: 'Bank', upi: 'UPI' };

// Today's business date in Asia/Kolkata (UTC+5:30, no DST).
export const todayIst = (now = new Date()) => new Date(now.getTime() + 19800000).toISOString().slice(0, 10);

// Rows from daybook.list may span several dates (the range runs on to today so that a reversal dated
// later still marks its original). Result: the rows of `date` plus queued daybook.add entries for `date`.
// Each item: {id, entry_date, direction, mode, bucket, category, amount_paise, payee, narration, reverses,
//   synced, queued (alias !synced), status ('waiting'|'attention'|undefined), error, reversed, reversalQueued, reversalError}.
export function mergeQueued(rows, outboxEntries, date) {
  const entries = outboxEntries || [];
  const reversedIds = new Set(rows.filter((r) => r.reverses).map((r) => r.reverses));
  const pendingRev = new Map(); // original id -> queued daybook.reverse entry (a later one wins)
  entries.filter((e) => e.action === 'daybook.reverse' && e.data).forEach((e) => pendingRev.set(e.data.reverses, e));
  const synced = rows.filter((r) => r.entry_date === date).map((r) => {
    const rev = pendingRev.get(r.id);
    return { ...r, synced: true, reversed: reversedIds.has(r.id), reversalQueued: !!rev, reversalError: rev && rev.status === 'attention' ? (rev.error || rev.code || 'Needs attention') : '' };
  });
  const have = new Set(rows.map((r) => r.id));
  const queued = entries.filter((e) => e.action === 'daybook.add' && e.data && e.data.entry_date === date && !have.has(e.id))
    .map((e) => ({ ...e.data, id: e.id, reverses: '', synced: false, status: e.status, error: e.status === 'attention' ? (e.error || e.code || 'Needs attention') : '', reversed: false, reversalQueued: false, reversalError: '' }));
  return synced.concat(queued); // stable: server rows keep their append order, queued ones follow in outbox order
}

// run(key, fn): while a call for `key` is unresolved, further calls for it are ignored (double-tap guard, R28).
export function inflightGuard() {
  const busy = new Set();
  return async (key, fn) => { if (busy.has(key)) return false; busy.add(key); try { await fn(); return true; } finally { busy.delete(key); } };
}

export const canReverse = (item) => item.synced && !item.reverses && !item.reversed && !item.reversalQueued;

// form: {date, category, mode, bucket, amount, payee, narration}; categories: config.get categories.
// Returns {ok, data, errors:{category,mode,bucket,amount}}; direction comes from the chosen category.
export function entryFromForm(form, categories) {
  const errors = {};
  const cat = (categories || []).find((c) => c.id === form.category);
  if (!cat) errors.category = 'Choose a category.';
  if (!MODES[form.mode]) errors.mode = 'Choose cash, bank or UPI.';
  if (form.mode === 'cash' && !BUCKETS[form.bucket]) errors.bucket = 'Choose the cash bucket.';
  const amount = parseRupeesToPaise(form.amount);
  if (amount === null) errors.amount = 'Enter an amount in rupees, like 1234.50 (more than zero).';
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true, errors,
    data: {
      campus: form.campus, entry_date: form.date, direction: cat.direction, mode: form.mode,
      bucket: form.mode === 'cash' ? form.bucket : '', category: cat.id, amount_paise: amount,
      payee: (form.payee || '').trim(), narration: (form.narration || '').trim(), file_id: '',
    },
  };
}

// Last day of the financial year (Apr-Mar) that contains iso, so a list range never spans two books.
export function fyEnd(iso) {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7));
  return (m >= 4 ? y + 1 : y) + '-03-31';
}

const catLabel = (cats, id) => (cats.find((c) => c.id === id) || {}).label || id;

export function balancesTable(b) {
  const rows = [['Cash — Petty', (x) => x.cash.petty], ['Cash — Fee', (x) => x.cash.fee], ['Cash — Other', (x) => x.cash.other], ['Bank', (x) => x.bank], ['UPI', (x) => x.upi]];
  return h('table', { class: 'bal' },
    h('thead', {}, h('tr', {}, ['', 'Opening', 'In', 'Out', 'Closing'].map((t) => h('th', {}, t)))),
    h('tbody', {}, rows.map(([name, get]) => h('tr', {}, h('td', {}, name), [b.opening, b.in, b.out, b.closing].map((x) => h('td', {}, formatInr(get(x))))))));
}

export async function showDayBook(root, session, api, outbox) {
  const campus = session.campus;
  let date = todayIst();
  let categories = (cacheGet('config') || {}).categories || [];
  let loaded = { rows: [], ok: false };
  let seq = 0;

  const dateIn = h('input', { type: 'date', value: date, max: date });
  const dateF = field('db-date', 'Date', dateIn);
  const catSel = h('select', {});
  const catF = field('db-cat', 'Category', catSel);
  const dirNote = h('div', { class: 'meta' });
  const modeSel = h('select', {}, Object.entries(MODES).map(([k, v]) => h('option', { value: k }, v)));
  const modeF = field('db-mode', 'Mode', modeSel);
  const bucketSel = h('select', {}, h('option', { value: '' }, 'Choose…'), Object.entries(BUCKETS).map(([k, v]) => h('option', { value: k }, v)));
  const bucketF = field('db-bucket', 'Cash bucket', bucketSel);
  const amountIn = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00' });
  const amountF = field('db-amount', 'Amount (₹)', amountIn);
  const payeeIn = h('input', { type: 'text', autocomplete: 'off' });
  const payeeF = field('db-payee', 'Payee / received from', payeeIn);
  const narrIn = h('textarea', { rows: '2' });
  const narrF = field('db-narr', 'Narration', narrIn);
  const saveBtn = h('button', { type: 'submit' }, 'Add entry');
  const saveMsg = h('p', { role: 'status' });
  const listEl = h('ul', { class: 'office-list' });
  const listNote = h('p', { role: 'status' });
  const balEl = h('div', {});

  const paintCats = () => {
    catSel.replaceChildren(h('option', { value: '' }, 'Choose…'), ...categories.map((c) => h('option', { value: c.id }, c.label + ' (' + c.direction + ')')));
  };
  const syncBucket = () => { bucketF.root.hidden = modeSel.value !== 'cash'; };
  const syncDir = () => { const c = categories.find((x) => x.id === catSel.value); dirNote.textContent = c ? (c.direction === 'IN' ? 'Money in' : 'Money out') : ''; };
  modeSel.addEventListener('change', syncBucket);
  catSel.addEventListener('change', syncDir);
  paintCats(); syncBucket();

  const form = h('form', { class: 'office-form', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    [catF, modeF, bucketF, amountF].forEach((f) => { f.err.textContent = ''; });
    const r = entryFromForm({ campus, date, category: catSel.value, mode: modeSel.value, bucket: bucketSel.value, amount: amountIn.value, payee: payeeIn.value, narration: narrIn.value }, categories);
    if (!r.ok) {
      catF.err.textContent = r.errors.category || ''; modeF.err.textContent = r.errors.mode || '';
      bucketF.err.textContent = r.errors.bucket || ''; amountF.err.textContent = r.errors.amount || '';
      return;
    }
    saveBtn.disabled = true; // double-tap guard; the id is assigned once per enqueue
    try {
      await outbox.enqueue('daybook.add', r.data);
      amountIn.value = ''; payeeIn.value = ''; narrIn.value = '';
      saveMsg.textContent = 'Saved — will sync';
      await refresh();
      outbox.flush().then(refresh).catch(() => {});
    } catch (err) { saveMsg.textContent = 'Could not save on this device: ' + (err && err.message || err); }
    saveBtn.disabled = false;
  } },
  dateF.root, catF.root, dirNote, modeF.root, bucketF.root, amountF.root, payeeF.root, narrF.root, saveBtn, saveMsg);

  dateIn.addEventListener('change', () => { if (dateIn.value && dateIn.value <= todayIst()) { date = dateIn.value; refresh(); } else dateIn.value = date; });

  const guard = inflightGuard();
  async function reverse(item, btn) {
    btn.disabled = true; // until the enqueue resolves; the list repaint then replaces the button
    const ran = await guard(item.id, async () => {
      if (!confirm('Reverse this entry of ' + formatInr(item.amount_paise) + ' (' + catLabel(categories, item.category) + ')? A new opposite entry dated today will be added. The original stays.')) return;
      await outbox.enqueue('daybook.reverse', { campus, reverses: item.id });
      await refresh();
      outbox.flush().then(refresh).catch(() => {});
    }).catch(() => {});
    if (!ran || btn.isConnected) btn.disabled = false;
  }

  function paintList() {
    const items = mergeQueued(loaded.rows, loaded.entries || [], date);
    listEl.replaceChildren(...(items.length ? items.map((it) => h('li', {},
      h('div', {}, (it.direction === 'IN' ? '+ ' : '− ') + formatInr(it.amount_paise) + ' · ' + catLabel(categories, it.category)),
      h('div', { class: 'meta' }, [MODES[it.mode] || it.mode, it.bucket ? BUCKETS[it.bucket] : '', it.payee, it.narration, it.reverses ? 'Reversal' : ''].filter(Boolean).join(' · ')),
      it.synced ? null : h('div', { class: 'flag' + (it.status === 'attention' ? ' bad' : '') }, it.status === 'attention' ? 'Needs attention: ' + it.error : 'Not yet synced'),
      it.reversed ? h('div', { class: 'meta' }, 'Reversed') : null,
      it.reversalQueued ? h('div', { class: 'flag' + (it.reversalError ? ' bad' : '') }, it.reversalError ? 'Reversal needs attention: ' + it.reversalError : 'Reversal not yet synced') : null,
      canReverse(it) ? h('button', { type: 'button', class: 'secondary', onclick: (e) => reverse(it, e.currentTarget) }, 'Reverse') : null,
    )) : [h('li', {}, 'No entries for ' + isoToDmy(date) + '.')]));
  }

  async function refresh() {
    const my = ++seq;
    const entries = await outbox.entries().catch(() => []);
    loaded = { ...loaded, entries };
    paintList();
    const to = todayIst() < fyEnd(date) ? todayIst() : fyEnd(date);
    const [list, bal, cfg] = await Promise.all([
      api.read('daybook.list', { campus, from: date, to }, 'dblist'),
      api.read('daybook.balances', { campus, date }, 'dbbal'),
      categories.length ? Promise.resolve(null) : api.read('config.get', {}, 'dbcfg'),
    ]);
    if (my !== seq) return; // a newer refresh (date change) owns the screen
    if (cfg && cfg.success) { categories = cfg.categories; cacheSet('config', { categories }); paintCats(); }
    if (list.stale || bal.stale) return;
    if (list.success) { loaded = { rows: list.entries, entries, ok: true }; cacheSet('daybook:' + campus + ':' + date, list.entries); listNote.textContent = ''; }
    else {
      const c = cacheGet('daybook:' + campus + ':' + date);
      if (c) loaded = { rows: c, entries, ok: false };
      listNote.textContent = 'Offline or unavailable' + (c ? '. Showing the last saved list.' : '. Only entries not yet synced are shown.');
    }
    paintList();
    if (bal.success) { cacheSet('balances:' + campus + ':' + date, bal); balEl.replaceChildren(balancesTable(bal)); }
    else {
      const c = cacheGet('balances:' + campus + ':' + date);
      balEl.replaceChildren(c ? h('div', {}, h('p', {}, 'Last saved balances (may be out of date):'), balancesTable(c)) : h('p', {}, 'Balances unavailable.'));
    }
  }

  root.replaceChildren(h('h2', {}, 'Day Book'), form, h('h3', {}, 'Entries'), listNote, listEl, h('h3', {}, 'Balances for the day'), balEl);
  window.addEventListener('online', () => refresh());
  setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 30000);
  await refresh();
}
