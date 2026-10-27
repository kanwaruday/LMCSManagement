// Day Book screen: entry form, the day's list (server rows + queued entries), balances, Reverse.
// Append-only: there is no edit and no delete; a correction is a reversing entry (daybook.reverse).
import { cacheGet, cacheSet } from './shell.js';
import { h, field } from './dom.js';
import { entryReason } from './codes.js';
import { parseRupeesToPaise, formatInr, isoToDmy } from './format.js';
import { resizeImage, toBase64 } from './image.js';
import { handoverForm, canHandOver } from './handover.js';

export const BUCKETS = { petty: 'Petty cash', fee: 'Fee cash', other: 'Other cash' };
export const MODES = { cash: 'Cash', bank: 'Bank', upi: 'UPI' };

// Today's business date in Asia/Kolkata (UTC+5:30, no DST).
export const todayIst = (now = new Date()) => new Date(now.getTime() + 19800000).toISOString().slice(0, 10);

// A screen dated "today" at load must not keep posting to that day after midnight IST (R41). shown: the date in
// use; auto: the IST day the screen last set itself to. Rolls only when shown is still that auto day.
// -> {date, auto, max (for the date input), rolled}.
export function rollForward(shown, auto, now = new Date()) {
  const today = todayIst(now);
  const rolled = shown === auto && today > auto;
  return { date: rolled ? today : shown, auto: today > auto ? today : auto, max: today, rolled };
}
export const rolledNote = (iso) => 'It is past midnight: the date has moved on to ' + isoToDmy(iso) + '. Check it, then save again.';

// Rows from daybook.list may span several dates (the range runs on to today so that a reversal dated
// later still marks its original). Result: the rows of `date` plus queued daybook.add entries for `date`.
// Each item: {id, entry_date, direction, mode, bucket, category, amount_paise, payee, narration, reverses,
//   synced, queued (alias !synced), status ('waiting'|'attention'|undefined), error, reversed, reversalQueued, reversalError, videoQueued}.
export function mergeQueued(rows, outboxEntries, date) {
  const entries = outboxEntries || [];
  const reversedIds = new Set(rows.filter((r) => r.reverses).map((r) => r.reverses));
  const pendingRev = new Map(); // original id -> queued daybook.reverse entry (a later one wins)
  entries.filter((e) => e.action === 'daybook.reverse' && e.data).forEach((e) => pendingRev.set(e.data.reverses, e));
  const pendingVid = new Set(entries.filter((e) => e.action === 'daybook.attach_video' && e.data).map((e) => e.data.entry_id)); // a fill video on its way
  const synced = rows.filter((r) => r.entry_date === date).map((r) => {
    const rev = pendingRev.get(r.id);
    return { ...r, synced: true, reversed: reversedIds.has(r.id), reversalQueued: !!rev, videoQueued: pendingVid.has(r.id), reversalError: rev && rev.status === 'attention' ? entryReason(rev) : '' };
  });
  const have = new Set(rows.map((r) => r.id));
  const queued = entries.filter((e) => e.action === 'daybook.add' && e.data && e.data.entry_date === date && !have.has(e.id))
    .map((e) => ({ ...e.data, id: e.id, reverses: '', synced: false, status: e.status, error: e.status === 'attention' ? entryReason(e) : '', reversed: false, reversalQueued: false, reversalError: '', videoQueued: false }));
  return synced.concat(queued); // stable: server rows keep their append order, queued ones follow in outbox order
}

// run(key, fn): while a call for `key` is unresolved, further calls for it are ignored (double-tap guard, R28).
export function inflightGuard() {
  const busy = new Set();
  return async (key, fn) => { if (busy.has(key)) return false; busy.add(key); try { await fn(); return true; } finally { busy.delete(key); } };
}

// Deposit legs are written only by deposit.add and never reversed alone (R37).
const LEG_CATEGORIES = ['deposit_cash_out', 'deposit_bank_in'];
const isLeg = (item) => /:(out|in)$/.test(item.id) || LEG_CATEGORIES.includes(item.category);
export const canReverse = (item) => item.synced && !item.reverses && !item.reversed && !item.reversalQueued && !isLeg(item);

// A saved fuel entry that has no fill video yet (and none on its way) can be given one from the list.
export const canAddVideo = (item) => item.synced && item.category === 'fuel' && !item.reverses && !item.reversed && !item.reversalQueued && !item.video_file_id && !item.videoQueued;

// Roles of the portal session (comma list). P8: the clerk-level limits lift with FinanceHead or Owner (Accounts counts as FinanceHead).
const hasAnyRole = (session, roles) => String((session && session.role) || '').split(',').map((r) => r.trim()).some((r) => roles.includes(r));
const isPrivileged = (session) => hasAnyRole(session, ['FinanceHead', 'Accounts', 'Owner']);

// Accounts of the selected campus the user may post to: active ones; clerks get cash + credit only (no bank rows).
export function formAccounts(accounts, session, campus) {
  const priv = isPrivileged(session);
  return (accounts || []).filter((a) => a.active && a.campus === campus && (priv || a.kind === 'cash' || a.kind === 'credit'));
}

export const GROUPS = { fee: 'Fees', income: 'Other receipts', school: 'School expenses', transport: 'Transport', movement: 'Money movements' };
// Categories offered for an account kind, grouped in GROUPS order: [{group, label, items}]. Active only.
// credit: expense categories only (clerks: vehicle ones); settlements come from a bank account, never for clerks; cash transfers from cash.
export function categoriesFor(categories, accountKind, session) {
  const priv = isPrivileged(session);
  const ok = (c) => c.active && !LEG_CATEGORIES.includes(c.id) && (
    accountKind === 'credit' ? c.direction === 'OUT' && (c.group === 'school' || c.group === 'transport') && (priv || c.needs_vehicle)
      : c.id === 'credit_settlement' ? priv && accountKind === 'bank'
        : c.id === 'cash_transfer' ? accountKind === 'cash' : true);
  return Object.entries(GROUPS).map(([group, label]) => ({ group, label, items: (categories || []).filter((c) => c.group === group && ok(c)) })).filter((g) => g.items.length);
}

// Vehicle choices: active vehicles of the campus, then the others, then "Shared / whole fleet" (never for fuel: a fill needs one meter).
export function vehicleOptions(vehicles, campus, categoryId) {
  const act = (vehicles || []).filter((v) => v.active);
  const opt = (v) => ({ value: v.reg, label: v.label || v.reg });
  return act.filter((v) => v.campus === campus).map(opt).concat(act.filter((v) => v.campus !== campus).map(opt),
    categoryId === 'fuel' ? [] : [{ value: 'FLEET', label: 'Shared / whole fleet' }]);
}

// Active student collection heads as select options.
export const collectionOptions = (collections) => (collections || []).filter((c) => c.active).map((c) => ({ value: c.id, label: c.label }));
export const COLLECTION_CATEGORIES = ['student_collection', 'student_collection_paid'];
// Parts a vehicle service bill can be for (garage data), by category. Keep in step with OFFICE_COMPONENTS in
// apps-script/office-config.gs; tests/office/test-daybook-view.js fails if the two lists differ.
export const COMPONENT_LABEL = 'Which parts? (tap all that apply)';
const SERVICE = ['vehicle_service', 'vehicle_parts'], ALL_SERVICE = ['vehicle_washing', 'vehicle_service', 'vehicle_parts', 'vehicle_electrical', 'vehicle_body', 'tyres'];
const COMPONENTS = [
  ...[['engine_oil', 'Engine oil'], ['oil_filter', 'Oil filter'], ['fuel_filter', 'Fuel filter'], ['air_filter', 'Air filter'], ['coolant', 'Coolant'], ['belts', 'Belts'],
    ['brake_front', 'Front brakes'], ['brake_rear', 'Rear brakes'], ['brake_fluid', 'Brake fluid'], ['clutch', 'Clutch'], ['gearbox_oil', 'Gearbox oil'], ['axle_grease', 'Axle grease'],
    ['suspension', 'Suspension'], ['steering', 'Steering'], ['wheel_bearing', 'Wheel bearing']].map(([id, label]) => [id, label, SERVICE]),
  ...[['battery', 'Battery'], ['lights_wiring', 'Lights and wiring'], ['starter_alternator', 'Starter / alternator']].map(([id, label]) => [id, label, ['vehicle_electrical']]),
  ...[['tyre_fl', 'Tyre front left'], ['tyre_fr', 'Tyre front right'], ['tyre_rl', 'Tyre rear left'], ['tyre_rr', 'Tyre rear right'], ['tyre_spare', 'Spare tyre'], ['puncture', 'Puncture']].map(([id, label]) => [id, label, ['tyres']]),
  ...[['body_paint', 'Body and paint'], ['seats_windows', 'Seats and windows'], ['door', 'Door']].map(([id, label]) => [id, label, ['vehicle_body']]),
  ['washing_greasing', 'Washing / greasing', ['vehicle_washing']],
  ['other', 'Other', ALL_SERVICE],
];
// [{id, label}] for the chips of a category; empty (no chips) for every category that does not ask which parts.
export const componentOptions = (categoryId) => COMPONENTS.filter((c) => c[2].includes(categoryId)).map(([id, label]) => ({ id, label }));
// The driver's video of a fuel fill (proof for the fuel check). Optional; the backend enforces the same types and size.
export const VIDEO_LABEL = 'Video of the fill (from the driver)';
export const VIDEO_HINT = 'Ask the driver for a 10–20 second video: meter at zero, nozzle in the tank, final reading.';
export const VIDEO_MIMES = ['video/mp4', 'video/quicktime', 'video/3gpp'], VIDEO_MAX_BYTES = 25 * 1024 * 1024;
// '14.2 MB', counted the way the 25 MB limit is (1 MB = 1024 × 1024 bytes).
export const mbText = (bytes) => (bytes / 1048576).toFixed(1) + ' MB';
// '' when the chosen file ({size, type}) is fine as a fill video, else the sentence to show.
export const videoProblem = (f) => !VIDEO_MIMES.includes(f.type) ? 'Choose a video file (MP4, MOV or 3GP).'
  : f.size > VIDEO_MAX_BYTES ? 'This video is larger than 25 MB. Ask the driver for a shorter one (10–20 seconds).' : '';
export const PAYMENT_PHOTO_HINT = 'Photo of the bill, or of the hand-written receipt signed by the person paid.';

// The value a repainted select should show: the user's current one if it is still offered, else the fallback (P13).
export const keepChoice = (prev, values, fallback) => (prev && values.includes(prev) ? prev : fallback);

export const CHAIRMAN = 'CHAIRMAN';
export const chargedLabel = (id) => (id === CHAIRMAN ? 'Chairman (personal)' : id);
// A row's money account for display: its stored account, else cash:<campus> / bank:<campus> from its mode (old rows).
export function rowAccountLabel(accounts, row) {
  const id = row.account || (row.mode === 'cash' ? 'cash:' : 'bank:') + row.campus;
  return ((accounts || []).find((a) => a.id === id) || {}).label || id;
}

// '12.5' -> 12500 (millilitres): digits, at most 3 decimals, more than 0; otherwise null.
export function parseLitresToMl(text) {
  const m = /^\s*(\d+)(?:\.(\d{1,3}))?\s*$/.exec(String(text));
  if (!m) return null;
  const ml = Number(m[1]) * 1000 + Number((m[2] || '').padEnd(3, '0'));
  return ml > 0 && Number.isSafeInteger(ml) ? ml : null;
}
const parseOdometer = (text) => { const m = /^\s*(\d+)\s*$/.exec(String(text)); const n = m && Number(m[1]); return m && Number.isSafeInteger(n) ? n : null; };

// form: {campus, date, account (object), category (object), mode (bank accounts only: bank|upi), bucket, amount, payee, narration,
//   charged_to, vehicle, components (ids in tap order), collection, litres, odometer, odometer_note, hasFile, video ({size, type} of the chosen fill video, if any), supplier_bill_no, settles_account, settles}.
// Returns {ok, data, errors}. Direction comes from the category, mode from the account kind, bucket only for cash;
// file_id is added by the caller once the photo is queued (every payment has one: bill or signed receipt).
export function entryPayload(form) {
  const errors = {}, acct = form.account, cat = form.category, kind = acct && acct.kind;
  if (!acct) errors.account = 'Choose the account.';
  if (!cat) errors.category = 'Choose a category.';
  const mode = kind === 'bank' ? form.mode : kind;
  if (kind === 'bank' && !['bank', 'upi'].includes(form.mode)) errors.mode = 'Choose bank or UPI.';
  if (kind === 'cash' && !BUCKETS[form.bucket]) errors.bucket = 'Choose the cash bucket.';
  const amount = parseRupeesToPaise(form.amount);
  if (amount === null) errors.amount = 'Enter an amount in rupees, like 1234.50 (more than zero).';
  const data = {
    campus: form.campus, entry_date: form.date, direction: cat && cat.direction, account: acct && acct.id, mode, bucket: kind === 'cash' ? form.bucket : '',
    category: cat && cat.id, amount_paise: amount, payee: (form.payee || '').trim(), narration: (form.narration || '').trim(),
    charged_to: form.charged_to || form.campus, file_id: '',
  };
  if (cat && cat.needs_vehicle) {
    data.vehicle = String(form.vehicle || '').trim();
    if (!data.vehicle || (cat.id === 'fuel' && data.vehicle === 'FLEET')) errors.vehicle = cat.id === 'fuel' ? 'Choose the vehicle that was filled.' : 'Choose the vehicle, or Shared / whole fleet.';
  }
  if (cat && cat.id === 'fuel') {
    data.litres_ml = parseLitresToMl(form.litres);
    if (data.litres_ml === null) errors.litres = 'Enter the litres filled, like 12.5 (more than 0, up to 3 decimals).';
    data.odometer_km = parseOdometer(form.odometer);
    if (data.odometer_km === null) errors.odometer = 'Enter the odometer reading in whole km.';
    data.odometer_note = (form.odometer_note || '').trim();
    if (!form.hasFile) errors.file = 'Add a photo of the fuel bill (showing the odometer).';
    if (form.video && videoProblem(form.video)) errors.video = videoProblem(form.video);
  }
  if (cat && componentOptions(cat.id).length) {
    data.components = form.components || [];
    if (!data.components.length) errors.components = 'Tap the parts this bill was for.';
  }
  if (cat && COLLECTION_CATEGORIES.includes(cat.id)) {
    data.collection = form.collection || '';
    if (!data.collection) errors.collection = 'Choose which student collection this is.';
  }
  if (cat && cat.direction === 'OUT' && !form.hasFile && !errors.file) errors.file = PAYMENT_PHOTO_HINT;
  if (kind === 'credit') data.supplier_bill_no = (form.supplier_bill_no || '').trim();
  if (cat && cat.id === 'credit_settlement') {
    data.settles_account = form.settles_account || '';
    data.settles = (form.settles || '').trim();
    if (!data.settles_account) errors.settles_account = 'Choose the supplier account being settled.';
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, errors, data };
}

// Last day of the financial year (Apr-Mar) that contains iso, so a list range never spans two books.
export function fyEnd(iso) {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7));
  return (m >= 4 ? y + 1 : y) + '-03-31';
}

export function balancesTable(b) {
  const rows = [['Cash — Petty', (x) => x.cash.petty], ['Cash — Fee', (x) => x.cash.fee], ['Cash — Other', (x) => x.cash.other], ['Bank', (x) => x.bank], ['UPI', (x) => x.upi]];
  return h('table', { class: 'bal' },
    h('thead', {}, h('tr', {}, ['', 'Opening', 'In', 'Out', 'Closing'].map((t) => h('th', {}, t)))),
    h('tbody', {}, rows.map(([name, get]) => h('tr', {}, h('td', {}, name), [b.opening, b.in, b.out, b.closing].map((x) => h('td', {}, formatInr(get(x))))))));
}

// One config.get; the fresh config (and its cache write), or null when offline/refused so the cached copy stays.
export async function loadConfig(api, save) {
  const conf = await api.read('config.get', {}, 'dbcfg').catch(() => null);
  if (!conf || !conf.success || conf.stale) return null;
  const cfg = { categories: conf.categories, accounts: conf.accounts, vehicles: conf.vehicles, campuses: conf.campuses, collections: conf.collections };
  save(cfg);
  return cfg;
}

export async function showDayBook(root, session, api, outbox) {
  const campus = session.campus;
  let date = todayIst();
  const cached = cacheGet('config') || {};
  let cfg = { categories: cached.categories || [], accounts: cached.accounts || [], vehicles: cached.vehicles || [], campuses: cached.campuses || [], collections: cached.collections || [] };
  let loaded = { rows: [], ok: false };
  let seq = 0;
  const catLabel = (id) => ((cfg.categories || []).find((c) => c.id === id) || {}).label || id; // inactive categories keep their label in old rows

  const dateIn = h('input', { type: 'date', value: date, max: date });
  const dateF = field('db-date', 'Date', dateIn);
  const acctSel = h('select', {});
  const acctF = field('db-acct', 'Money account', acctSel);
  const catSel = h('select', {});
  const catF = field('db-cat', 'Category', catSel);
  const dirNote = h('div', { class: 'meta' });
  const modeSel = h('select', {}, h('option', { value: 'bank' }, 'Bank'), h('option', { value: 'upi' }, 'UPI'));
  const modeF = field('db-mode', 'Paid / received by', modeSel);
  const bucketSel = h('select', {}, h('option', { value: '' }, 'Choose…'), Object.entries(BUCKETS).map(([k, v]) => h('option', { value: k }, v)));
  const bucketF = field('db-bucket', 'Cash bucket', bucketSel);
  const chargedSel = h('select', {});
  const chargedF = field('db-charged', 'Charged to', chargedSel);
  const vehSel = h('select', {});
  const vehF = field('db-veh', 'Vehicle', vehSel);
  const litresIn = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.0' });
  const litresF = field('db-litres', 'Litres filled', litresIn);
  const odoIn = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off' });
  const odoF = field('db-odo', 'Odometer (km)', odoIn);
  const odoNoteIn = h('input', { type: 'text', autocomplete: 'off' });
  const odoNoteF = field('db-odonote', 'Odometer note (only if the reading is lower, e.g. meter replaced)', odoNoteIn);
  const fileIn = h('input', { type: 'file', accept: 'image/*,application/pdf', capture: 'environment' });
  const fileF = field('db-file', 'Photo', fileIn, PAYMENT_PHOTO_HINT);
  const videoIn = h('input', { type: 'file', accept: VIDEO_MIMES.join(',') });
  const videoPick = h('input', { type: 'file', accept: VIDEO_MIMES.join(','), hidden: true }); // the list's Add fill video button opens this
  const videoF = field('db-video', VIDEO_LABEL, videoIn, VIDEO_HINT);
  videoF.root.querySelector('label').append(h('span', { class: 'opt' }, ' Optional'));
  // The chosen video, banked: the picker gives way to a tick, its size and name, and a way to take it off again (the field
  // is optional). The file stays in the hidden input.
  const videoSize = h('b', {}), videoName = h('span', { class: 'fname' });
  const videoDrop = h('button', { type: 'button', class: 'secondary', 'aria-label': 'Remove the video', onclick: () => { clearVideo(); videoIn.focus(); } }, 'Remove');
  const videoChosen = h('div', { class: 'picked', hidden: true }, h('span', {}, videoSize, videoName), videoDrop);
  videoF.root.insertBefore(videoChosen, videoIn.nextSibling);
  const clearVideo = () => { videoIn.value = ''; videoIn.hidden = false; videoChosen.hidden = true; };
  // Checked the moment it is picked, so a wrong file is named in place and never blocks the save (the entry can go without it).
  videoIn.addEventListener('change', () => {
    const f = videoIn.files && videoIn.files[0];
    videoF.err.textContent = f ? videoProblem(f) : '';
    if (!f || videoF.err.textContent) { clearVideo(); return; }
    videoSize.textContent = 'Video chosen · ' + mbText(f.size); videoName.textContent = f.name || '';
    const had = document.activeElement === videoIn;
    videoChosen.hidden = false; videoIn.hidden = true;
    if (had) videoDrop.focus({ preventScroll: true }); // keyboard focus is not dropped with the hidden picker
  });
  // Garage data: one tap per part. Toggle buttons (aria-pressed) in a fieldset, so keyboard and screen readers get the same thing.
  let picked = [];
  const chipsEl = h('div', { class: 'chips' });
  const compErr = h('p', { class: 'err', role: 'alert', id: 'db-comps-err' });
  const compF = { root: h('fieldset', { class: 'parts', 'aria-describedby': 'db-comps-err' }, h('legend', {}, COMPONENT_LABEL), chipsEl, compErr), err: compErr };
  const collSel = h('select', {});
  const collF = field('db-coll', 'Collection', collSel);
  const billIn = h('input', { type: 'text', autocomplete: 'off' });
  const billF = field('db-bill', 'Supplier bill no.', billIn);
  const settlesSel = h('select', {});
  const settlesF = field('db-settles-acct', 'Supplier account being settled', settlesSel);
  const settlesIn = h('input', { type: 'text', autocomplete: 'off' });
  const settlesF2 = field('db-settles', 'Which bills this settles', settlesIn);
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

  const curAcct = () => (cfg.accounts || []).find((a) => a.id === acctSel.value) || null;
  const curCat = () => (cfg.categories || []).find((c) => c.id === catSel.value) || null;
  const keep = (sel, fill, fallback = '') => { const v = sel.value; fill(); sel.value = keepChoice(v, [...sel.options].map((o) => o.value), fallback || (sel.options[0] ? sel.options[0].value : '')); };
  const paintAccts = () => keep(acctSel, () => acctSel.replaceChildren(...formAccounts(cfg.accounts, session, campus).map((a) => h('option', { value: a.id }, a.label))));
  const paintCats = () => keep(catSel, () => {
    const a = curAcct();
    catSel.replaceChildren(h('option', { value: '' }, 'Choose…'), ...(a ? categoriesFor(cfg.categories, a.kind, session) : []).map((g) => h('optgroup', { label: g.label }, g.items.map((c) => h('option', { value: c.id }, c.label)))));
  });
  const paintCharged = () => keep(chargedSel, () => chargedSel.replaceChildren(...[...(cfg.campuses && cfg.campuses.length ? cfg.campuses : [campus]), CHAIRMAN].map((c) => h('option', { value: c }, chargedLabel(c)))), campus);
  const paintSettles = () => keep(settlesSel, () => settlesSel.replaceChildren(h('option', { value: '' }, 'Choose…'), ...(cfg.accounts || []).filter((a) => a.active && a.kind === 'credit').map((a) => h('option', { value: a.id }, a.label + ' (' + a.campus + ')'))));
  const paintVehicles = () => keep(vehSel, () => { const c = curCat(); vehSel.replaceChildren(h('option', { value: '' }, 'Choose…'), ...vehicleOptions(cfg.vehicles, campus, c && c.id).map((o) => h('option', { value: o.value }, o.label))); });
  const paintChips = () => { // picks that this category does not offer are dropped
    const c = curCat(), opts = componentOptions(c && c.id);
    picked = picked.filter((id) => opts.some((o) => o.id === id));
    chipsEl.replaceChildren(...opts.map((o) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(picked.includes(o.id)), onclick: (e) => {
      picked = picked.includes(o.id) ? picked.filter((id) => id !== o.id) : [...picked, o.id];
      e.currentTarget.setAttribute('aria-pressed', String(picked.includes(o.id)));
      if (picked.length) compErr.textContent = ''; // the "tap the parts" error goes as soon as one is tapped
    } }, o.label)));
  };
  const paintCollections = () => keep(collSel, () => collSel.replaceChildren(h('option', { value: '' }, 'Choose…'), ...collectionOptions(cfg.collections).map((o) => h('option', { value: o.value }, o.label))));
  const sync = () => {
    const a = curAcct(), c = curCat();
    modeF.root.hidden = !(a && a.kind === 'bank');
    bucketF.root.hidden = !(a && a.kind === 'cash');
    billF.root.hidden = !(a && a.kind === 'credit');
    vehF.root.hidden = !(c && c.needs_vehicle);
    [litresF, odoF, odoNoteF].forEach((f) => { f.root.hidden = !(c && c.id === 'fuel'); });
    videoF.root.hidden = !(c && c.id === 'fuel');
    compF.root.hidden = !(c && componentOptions(c.id).length);
    collF.root.hidden = !(c && COLLECTION_CATEGORIES.includes(c.id));
    fileF.root.hidden = !(c && c.direction === 'OUT'); // every payment carries a photo
    fileIn.required = !fileF.root.hidden;
    fileF.root.querySelector('label').textContent = c && c.id === 'fuel' ? 'Photo of the fuel bill (type the odometer below)' : 'Photo of the bill or signed receipt';
    [settlesF, settlesF2].forEach((f) => { f.root.hidden = !(c && c.id === 'credit_settlement'); });
    dirNote.textContent = c ? (c.direction === 'IN' ? 'Money in' : 'Money out') : '';
  };
  const handover = handoverForm({ campus, buckets: BUCKETS, outbox, today: () => todayIst(), onSaved: () => refresh() });
  const paintForm = () => { paintAccts(); paintCats(); paintCharged(); paintSettles(); paintVehicles(); paintCollections(); paintChips(); handover.paint(cfg.accounts); sync(); };
  acctSel.addEventListener('change', () => { paintCats(); paintVehicles(); paintChips(); sync(); });
  catSel.addEventListener('change', () => { paintVehicles(); paintChips(); sync(); });
  paintForm();

  let auto = date;
  // Past midnight with the page still on the load day: move to today and stop this save so the clerk sees it.
  const roll = () => {
    const r = rollForward(date, auto); auto = r.auto; dateIn.max = r.max;
    if (!r.rolled) return false;
    date = r.date; dateIn.value = date; saveMsg.textContent = rolledNote(date); refresh();
    return true;
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') roll(); });

  const FIELDS = { collection: collF, account: acctF, category: catF, mode: modeF, bucket: bucketF, amount: amountF, vehicle: vehF, components: compF, litres: litresF, odometer: odoF, file: fileF, video: videoF, settles_account: settlesF };
  const form = h('form', { class: 'office-form', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    if (roll()) return;
    Object.values(FIELDS).forEach((f) => { f.err.textContent = ''; });
    const file = fileIn.files && fileIn.files[0], video = !videoF.root.hidden && videoIn.files && videoIn.files[0];
    const r = entryPayload({
      campus, date, account: curAcct(), category: curCat(), mode: modeSel.value, bucket: bucketSel.value, amount: amountIn.value, payee: payeeIn.value, narration: narrIn.value,
      charged_to: chargedSel.value, vehicle: vehSel.value, components: picked, collection: collSel.value, litres: litresIn.value, odometer: odoIn.value, odometer_note: odoNoteIn.value, hasFile: !!file,
      video: video ? { size: video.size, type: video.type } : null,
      supplier_bill_no: billIn.value, settles_account: settlesSel.value, settles: settlesIn.value,
    });
    if (!r.ok) {
      Object.entries(FIELDS).forEach(([k, f]) => { f.err.textContent = r.errors[k] || ''; });
      // On a phone Add entry sits far below most fields: bring the first error (in screen order) to the clerk.
      const bad = form.querySelector('.err:not(:empty)');
      if (bad) { bad.parentElement.scrollIntoView({ block: 'center' }); const c = bad.parentElement.querySelector('input, select, textarea, button'); if (c) c.focus({ preventScroll: true }); }
      return;
    }
    saveBtn.disabled = true; // double-tap guard; the id is assigned once per enqueue
    try {
      if (r.data.direction === 'OUT') { // photo first (FIFO, R7), then the entry that names it
        saveMsg.textContent = 'Preparing the photo…';
        const img = await resizeImage(file);
        r.data.file_id = await outbox.enqueue('file.upload', { campus, category: 'bill', belongs_to: '', name: file.name || (r.data.category === 'fuel' ? 'fuel-bill' : 'payment-bill'), mime: img.mime, base64: img.base64 });
      }
      if (video) { // the fill video goes the same way, after the bill and before the entry that names it
        saveMsg.textContent = 'Preparing the video…';
        r.data.video_file_id = await outbox.enqueue('file.upload', { campus, category: 'fuel_video', belongs_to: '', name: video.name || 'fuel-video', mime: video.type, base64: await toBase64(video) });
      }
      await outbox.enqueue('daybook.add', r.data);
      [amountIn, payeeIn, narrIn, litresIn, odoIn, odoNoteIn, fileIn, videoIn, billIn, settlesIn].forEach((i) => { i.value = ''; });
      clearVideo();
      picked = []; paintChips();
      saveMsg.textContent = 'Saved — will sync';
      await refresh();
      outbox.flush().then(refresh).catch(() => {});
    } catch (err) { saveMsg.textContent = err && err.message || String(err); }
    saveBtn.disabled = false;
  } },
  dateF.root, acctF.root, catF.root, dirNote, modeF.root, bucketF.root, vehF.root, compF.root, collF.root, litresF.root, odoF.root, odoNoteF.root, fileF.root, videoF.root, billF.root, settlesF.root, settlesF2.root, chargedF.root, amountF.root, payeeF.root, narrF.root, saveBtn, saveMsg, videoPick);

  dateIn.addEventListener('change', () => { if (dateIn.value && dateIn.value <= todayIst()) { date = dateIn.value; refresh(); } else dateIn.value = date; });

  const guard = inflightGuard();
  async function reverse(item, btn) {
    btn.disabled = true; // until the enqueue resolves; the list repaint then replaces the button
    const ran = await guard(item.id, async () => {
      if (!confirm('Reverse this entry of ' + formatInr(item.amount_paise) + ' (' + catLabel(item.category) + ')? A new opposite entry dated today will be added. The original stays.')) return;
      await outbox.enqueue('daybook.reverse', { campus, reverses: item.id });
      await refresh();
      outbox.flush().then(refresh).catch(() => {});
    }).catch(() => {});
    if (!ran || btn.isConnected) btn.disabled = false;
  }

  // Add fill video: the same picker, then file.upload and daybook.attach_video through the outbox (FIFO: the file first).
  // Its messages show on the entry itself ({id, text, bad}), not at the form far above.
  let pickFor = null, rowMsg = null;
  const say = (id, text, bad) => { rowMsg = { id, text, bad }; paintList(); };
  videoPick.addEventListener('change', async () => {
    const file = videoPick.files && videoPick.files[0], item = pickFor;
    videoPick.value = '';
    if (!file || !item) return;
    const bad = videoProblem(file);
    if (bad) { say(item.id, bad, true); return; }
    await guard('video:' + item.id, async () => {
      say(item.id, 'Preparing the video…', false);
      const fileId = await outbox.enqueue('file.upload', { campus, category: 'fuel_video', belongs_to: '', name: file.name || 'fuel-video', mime: file.type, base64: await toBase64(file) });
      await outbox.enqueue('daybook.attach_video', { campus, entry_id: item.id, file_id: fileId });
      rowMsg = null; // the row now says the video is on its way
      await refresh();
      outbox.flush().then(refresh).catch(() => {});
    }).catch((err) => { say(item.id, err && err.message || String(err), true); });
  });
  const addVideo = (item) => { pickFor = item; videoPick.click(); };

  // Second line of a list row: account, mode/bucket, charged-to (when not the campus), vehicle, fuel figures, then the free text.
  const partsLabel = (v) => { // stored as 'tyre_fl,puncture' (a queued entry still holds the array)
    const ids = Array.isArray(v) ? v : String(v || '').split(',').filter(Boolean);
    return ids.map((id) => (COMPONENTS.find((c) => c[0] === id) || [id, id])[1]).join(', ');
  };
  const collLabel = (id) => ((cfg.collections || []).find((c) => c.id === id) || {}).label || id;
  const rowMeta = (it) => [
    rowAccountLabel(cfg.accounts, { ...it, campus }),
    it.bucket ? BUCKETS[it.bucket] : '', it.mode === 'upi' ? 'UPI' : '',
    it.charged_to && it.charged_to !== (it.campus || campus) ? 'Charged to ' + chargedLabel(it.charged_to) : '',
    it.vehicle === 'FLEET' ? 'Shared / whole fleet' : it.vehicle ? 'Vehicle ' + ((cfg.vehicles.find((v) => v.reg === it.vehicle) || {}).label || it.vehicle) : '',
    it.litres_ml ? Number(it.litres_ml) / 1000 + ' L' : '', it.odometer_km !== undefined && it.odometer_km !== '' && it.litres_ml ? Number(it.odometer_km) + ' km' : '',
    it.collection ? collLabel(it.collection) : '', partsLabel(it.components),
    it.supplier_bill_no ? 'Bill ' + it.supplier_bill_no : '', it.payee, it.narration, it.reverses ? 'Reversal' : '',
  ].filter(Boolean);

  function paintList() {
    const items = mergeQueued(loaded.rows, loaded.entries || [], date);
    listEl.replaceChildren(...(items.length ? items.map((it) => h('li', {},
      h('div', {}, (it.direction === 'IN' ? '+ ' : '− ') + formatInr(it.amount_paise) + ' · ' + catLabel(it.category)),
      h('div', { class: 'meta' }, rowMeta(it).join(' · ')),
      it.video_file_id && it.category === 'fuel' ? h('div', { class: 'proof' }, 'Fill video attached') : null, // proof banked
      it.synced ? null : h('div', { class: 'flag' + (it.status === 'attention' ? ' bad' : '') }, it.status === 'attention' ? 'Needs attention: ' + it.error : 'Not yet synced'),
      it.reversed ? h('div', { class: 'meta' }, 'Reversed') : null,
      it.reversalQueued ? h('div', { class: 'flag' + (it.reversalError ? ' bad' : '') }, it.reversalError ? 'Reversal needs attention: ' + it.reversalError : 'Reversal not yet synced') : null,
      it.videoQueued ? h('div', { class: 'flag' }, 'Fill video not yet synced') : null,
      rowMsg && rowMsg.id === it.id ? h('div', rowMsg.bad ? { class: 'flag bad', role: 'alert' } : { class: 'meta' }, rowMsg.text) : null,
      canAddVideo(it) || canReverse(it) ? h('div', { class: 'row-actions' },
        canAddVideo(it) ? h('button', { type: 'button', class: 'secondary', onclick: () => addVideo(it) }, 'Add fill video') : null,
        canReverse(it) ? h('button', { type: 'button', class: 'secondary', onclick: (e) => reverse(it, e.currentTarget) }, 'Reverse') : null) : null,
    )) : [h('li', {}, 'No entries for ' + isoToDmy(date) + '.')]));
  }

  async function refresh() {
    const my = ++seq;
    const entries = await outbox.entries().catch(() => []);
    loaded = { ...loaded, entries };
    paintList();
    const to = todayIst() < fyEnd(date) ? todayIst() : fyEnd(date);
    const [list, bal] = await Promise.all([
      api.read('daybook.list', { campus, from: date, to }, 'dblist'),
      api.read('daybook.balances', { campus, date }, 'dbbal'),
    ]);
    if (my !== seq) return; // a newer refresh (date change) owns the screen
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

  root.replaceChildren(h('h2', {}, 'Day Book'), form, ...(canHandOver(session) ? [handover.el] : []), h('h3', {}, 'Entries'), listNote, listEl, h('h3', {}, 'Balances for the day'), balEl);
  window.addEventListener('online', () => refresh());
  setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 30000);
  loadConfig(api, (c) => cacheSet('config', c)).then((c) => { if (c) { cfg = c; paintForm(); paintList(); } }); // once per visit; paintForm keeps valid selections (P13)
  await refresh();
}
