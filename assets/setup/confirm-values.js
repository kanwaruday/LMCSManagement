// Setup quests, client side: a generic "confirm what we already know" screen driven by the backend's setupget / setupsave
// (apps-script/game-confirm.gs). Board -> quest -> items as short forms, the look of office/js/starting-data.js (amber
// stripes = known, waiting for a person's check). Saves go through an offline outbox, so a bad signal never loses an answer.
// Every server string reaches the DOM through h() text nodes. No personal data lives in this file.
import { ringSvg, ringModel, confirmLine, parseError } from '../../office/js/starting-data.js';
import { h, field, setKids } from '../../office/js/dom.js';
import { createOutbox } from '../../office/js/outbox.js';
import { createIdbStore } from '../../office/js/idb-store.js';

// One plain sentence per server code (and the two the page itself raises).
export const CODES = {
  SETUP_NO_VIEW_AS: 'You can only confirm your own details here.',
  SETUP_SELF_ONLY: 'These details can only be confirmed by the person they belong to.',
  SETUP_SAMPLE_OWNER_ONLY: 'The sample view is for the Owner only.',
  SETUP_SAMPLE_READ_ONLY: 'This is a sample. Nothing here saves.',
  SETUP_NOT_YOURS: 'This list is not for your role.',
  SETUP_BAD_CAMPUS: 'That school is not available to you here.',
  SETUP_BAD_ITEM: 'That entry is no longer here. Open the list again.',
  SETUP_UNKNOWN_FIELD: 'One of the boxes is not part of this list. Open the list again.',
  SETUP_FIELD_REQUIRED: 'Please fill this box in.',
  SETUP_BAD_VALUE: 'That does not look right. Please check it.',
  SETUP_NUMBER_REFUSED: 'Please leave out long numbers. Use words instead.',
  SETUP_NO_NONE: 'This list cannot be marked empty.',
  SETUP_NO_SKIP: 'This entry cannot be skipped.',
  SETUP_BUSY: 'The system was busy. Please try again.',
  SETUP_ERROR: 'Something went wrong saving this. Try again.',
  AUTH: 'Sign in again to continue.',
  OFFLINE: 'No connection. Your answers are kept on this phone and will be sent when you are back online.',
};
const say = (code) => CODES[code] || CODES.SETUP_ERROR;

// Buddy's first-visit tour of this page (work/LMS Mascot Voice Guide.md: plain, warm, verb first).
export const SETUP_TOUR_BEATS = [
  { target: '#cq-board', text: 'Here is what we already know about you and your school. Check each one.' },
  { target: '.sd-ring', text: 'The ring fills as you confirm. Amber stripes are things we found in our records, waiting for your check.' },
  { text: 'Amber fields come from our records. Confirm them if they are right, or fix them and save.' },
];

const cell = (item, id) => { const c = item && item.fields && item.fields[id]; return c && typeof c === 'object' ? c : { value: c == null ? '' : String(c), status: '' }; };

// Same rule as the server's cqStepTitle_: each {fieldId} becomes that item's value, trimmed; blank -> 'New entry'.
export function fillTitle(template, item) {
  const t = String(template || '').replace(/\{(\w+)\}/g, (_, id) => (item && item.fields && item.fields[id] ? String(cell(item, id).value || '') : '')).trim();
  return t || 'New entry';
}

const choicesOf = (f) => (f.type === 'yesno' ? ['yes', 'no'] : f.choices || null);
// a time input wants hh:mm; the server keeps '9:05' or '09:05'
export const padTime = (v) => v.replace(/^(\d):/, '0$1:');
// A quest + an item (or null for a new one) -> the form's fields with their starting text.
export function itemModel(quest, item) {
  return quest.fields.map((f) => {
    const c = item ? cell(item, f.id) : { value: '', status: '' };
    return { id: f.id, label: f.label, type: f.type, required: !!f.required, choices: choicesOf(f), hint: f.hint || '',
      value: c.status === 'skipped' || c.value == null ? '' : f.type === 'time' ? padTime(String(c.value)) : String(c.value), known: c.status === 'known' };
  });
}

// One item's counts, as the server counts them (required fields only; skipped counts as confirmed).
export function itemCounts(quest, item) {
  const n = { confirmed: 0, known: 0, total: 0 };
  quest.fields.forEach((f) => {
    if (!f.required) return;
    n.total++;
    const st = cell(item, f.id).status;
    if (st === 'confirmed' || st === 'skipped') n.confirmed++; else if (st === 'known') n.known++;
  });
  return n;
}

const CHECKS = { number: /^\d{1,6}$/, time: /^([01]?\d|2[0-3]):[0-5]\d$/, date: /^\d{4}-\d\d-\d\d$/ };
// The save body for one item from typed text, mirroring the server's checks: {ok, data} or {ok:false, code, field}.
// A field is sent when it has text or had a value before (cleared).
export function savePayload(quest, key, values, model) {
  const fields = {};
  for (const f of model) {
    const v = String(values[f.id] == null ? '' : values[f.id]).trim();
    if (v === '') {
      if (f.required) return { ok: false, code: 'SETUP_FIELD_REQUIRED', field: f.id };
      if (f.value !== '') fields[f.id] = '';
      continue;
    }
    if (f.type === 'text' && /\d{8,}/.test(v)) return { ok: false, code: 'SETUP_NUMBER_REFUSED', field: f.id };
    if ((CHECKS[f.type] && !CHECKS[f.type].test(v)) || (f.choices && !f.choices.includes(v)) || (f.type === 'text' && v.length > 200)) return { ok: false, code: 'SETUP_BAD_VALUE', field: f.id };
    fields[f.id] = v;
  }
  const data = { quest: quest.id, item: key, fields };
  if (quest.scope === 'campus') data.campus = quest.campus;
  return { ok: true, data };
}

// A QuestView with my waiting saves laid over it, so a ring moves the moment someone taps Save.
export function applyQueued(quest, entries) {
  const q = JSON.parse(JSON.stringify(quest));
  const mine = (entries || []).filter((e) => e && e.action === 'setupsave' && e.status === 'waiting' && e.data && e.data.quest === q.id && (q.scope !== 'campus' || e.data.campus === q.campus))
    .sort((a, b) => (a.seq || 0) - (b.seq || 0));
  for (const e of mine) {
    const d = e.data;
    let it = q.items.find((x) => x.item === d.item);
    if (!it) { it = { item: d.item, fields: {} }; q.items.push(it); }
    if (d.skip === true) { q.fields.forEach((f) => { it.fields[f.id] = { value: '', status: 'skipped', pending: true }; }); continue; }
    const sent = d.fields || {};
    Object.keys(sent).forEach((k) => { it.fields[k] = { value: String(sent[k]), status: 'confirmed', pending: true }; });
    q.fields.forEach((f) => { const c = it.fields[f.id]; if (f.required && c && c.status === 'known') it.fields[f.id] = { value: c.value, status: 'confirmed', pending: true }; });
  }
  const sum = { confirmed: 0, known: 0, total: 0 };
  q.items.forEach((it) => { const n = itemCounts(q, it); sum.confirmed += n.confirmed; sum.known += n.known; sum.total += n.total; });
  q.ring = { ...sum, done: sum.total > 0 && sum.confirmed === sum.total };
  const real = q.items.filter((it) => it.item !== '_none');
  q.itemsTotal = real.length;
  q.itemsDone = real.filter((it) => { const n = itemCounts(q, it); return n.confirmed === n.total; }).length;
  return q;
}

export function parseLink(search) {
  const p = new URLSearchParams(search || ''), g = (k) => String(p.get(k) || '');
  const quest = g('quest'), campus = g('campus').toUpperCase(), item = g('item'), role = g('role');
  return { quest: /^[a-z][a-z0-9_]{0,23}$/.test(quest) ? quest : null, campus: /^(LMS[1-6]|HES)$/.test(campus) ? campus : null,
    item: /^[A-Za-z0-9_:\-]{1,64}$/.test(item) ? item : null, sample: g('sample') === '1', role: /^[A-Za-z]{1,20}$/.test(role) ? role : null };
}
export const newItemKey = (now) => 'n-' + Number(now).toString(36);

// The ring's markup is built from numbers only (never server text); parsed, not assigned with innerHTML.
const ringEl = (n, big) => new DOMParser().parseFromString(ringSvg(n, big), 'text/html').body.firstElementChild;
// Refusals that a retry may cure (anything the page does not know is treated alike); the rest need the answer fixed.
export const isTransient = (code) => code === 'SETUP_BUSY' || code === 'SETUP_ERROR' || !CODES[code];
const viewKey = (q) => q.id + '|' + (q.campus || '');
const placeName = (c) => (window.LMCS && window.LMCS.campusLabel ? window.LMCS.campusLabel(c) : c);

export async function mountConfirmQuests(root, { session, backendUrl, link = {}, onLoaded }) {
  const sample = !!link.sample;
  const S = { views: [], view: { v: 'board' }, entries: [], others: 0, auth: false, dirty: false, sawWaiting: false, drafts: {}, noStore: false };
  const dkey = (q, item) => viewKey(q) + '/' + item;
  const who = () => String((window.LMCS && window.LMCS.getSession && window.LMCS.getSession() || session || {}).email || '').toLowerCase() || null;
  const token = () => String(((window.LMCS && window.LMCS.getSession && window.LMCS.getSession()) || session || {}).idToken || '');
  const bar = h('div', { id: 'cq-bar' }), body = h('div'), toast = h('p', { class: 'sd-toast', role: 'status', 'aria-live': 'polite' });
  setKids(root, sample ? h('p', { class: 'cq-banner', role: 'note' }, 'Sample view · nothing here is real and nothing saves') : null, bar, body, toast);
  let toastT;
  const tell = (t) => { toast.textContent = t; clearTimeout(toastT); toastT = setTimeout(() => { toast.textContent = ''; }, 4000); };

  async function write(action, data) {
    try { return await (await fetch(backendUrl, { method: 'POST', body: JSON.stringify({ action, idToken: token(), ...data }) })).json(); } catch (_) { return { success: false, network: true }; }
  }
  let outbox = null;
  if (!sample) { try { outbox = createOutbox({ store: createIdbStore('lmcs-confirm', 'outbox'), api: { write }, who, onChange: (c) => onOutbox(c) }); } catch (_) { S.noStore = true; } }
  const mine = () => (outbox ? S.entries.filter((e) => outbox.owned(e)) : []);
  const shown = () => S.views.map((q) => (outbox ? applyQueued(q, mine()) : q));

  async function load(silent) {
    const u = new URL(backendUrl);
    u.searchParams.set('action', 'setupget'); u.searchParams.set('idToken', token());
    if (link.quest) u.searchParams.set('quest', link.quest);
    if (link.campus) u.searchParams.set('campus', link.campus);
    if (sample) { u.searchParams.set('sample', '1'); if (link.role) u.searchParams.set('role', link.role); }
    let r;
    try { r = await (await fetch(u.toString(), { cache: 'no-store' })).json(); } catch (_) { r = { success: false, network: true }; }
    if (!r.success) {
      if (silent) return false;
      const again = h('button', { type: 'button', class: 'btn-lg', onclick: () => start() }, 'Try again');
      setKids(body, h('p', {}, 'Could not load this: ' + say(r.network ? 'OFFLINE' : parseError(r).code)), again);
      return false;
    }
    S.views = r.quests || [];
    S.sawWaiting = false;
    return true;
  }
  async function refreshEntries() {
    if (!outbox) return;
    try { S.entries = await outbox.entries(); S.others = (await outbox.others()).length; } catch (_) { S.noStore = true; S.entries = []; }
  }
  async function onOutbox(c) {
    await refreshEntries();
    if (c.authRequired) S.auth = true;
    if (c.waiting > 0) S.sawWaiting = true;
    if (c.waiting === 0 && S.sawWaiting && !c.authRequired) { if (await load(true)) { if (!S.dirty) render(); return; } }
    if (!S.dirty) render(); else drawBar();
  }

  const go = (view) => { S.view = view; history.pushState(view, ''); render(); scrollTo(0, 0); };
  addEventListener('popstate', (e) => { S.view = e.state || { v: 'board' }; render(); });
  addEventListener('online', () => { if (outbox) outbox.flush().then(() => load(true)).then((ok) => ok && !S.dirty && render()).catch(() => {}); });
  const back = (text) => h('button', { type: 'button', class: 'sd-back', onclick: () => history.back() }, '← ' + text);

  function render() {
    drawBar();
    const views = shown();
    const q = S.view.v === 'quest' && views.find((x) => viewKey(x) === S.view.key);
    if (q) drawQuest(q); else drawBoard(views);
    if (q && S.view.item) { const el = body.querySelector('[data-item="' + CSS.escape(S.view.item) + '"]'); if (el) { el.scrollIntoView({ block: 'center' }); const f = el.querySelector('input,select'); if (f) f.focus(); } S.view = { ...S.view, item: null }; }
    S.dirty = false;
  }

  function drawBar() {
    if (!outbox && !S.noStore) { setKids(bar); return; }
    const waiting = mine().filter((e) => e.status === 'waiting'), att = mine().filter((e) => e.status === 'attention');
    const kids = [];
    if (S.noStore && !sample) kids.push(h('p', { class: 'cq-note', role: 'alert' }, "This phone can't keep answers offline. Save only while you are connected."));
    if (S.auth) kids.push(h('p', { class: 'cq-note', role: 'alert' }, 'Sign in again to send your saved answers.'));
    if (waiting.length) kids.push(h('p', { class: 'cq-note', role: 'status' }, waiting.length + ' saved on this phone, waiting to send · ',
      h('button', { type: 'button', class: 'linklike', onclick: () => { S.auth = false; outbox.flush(); } }, 'Send now')));
    att.forEach((e) => {
      const q = S.views.find((x) => x.id === e.data.quest && (x.campus || '') === (e.data.campus || '')), code = e.code || parseError({ error: e.error }).code;
      kids.push(h('p', { class: 'cq-note cq-attn', role: 'alert' }, (q ? q.title + ': ' : '') + say(code), ' ',
        isTransient(code)
          ? h('button', { type: 'button', class: 'linklike', onclick: async () => { S.auth = false; await outbox.retry(e.id); } }, 'Try again')
          : h('button', { type: 'button', class: 'linklike', onclick: async () => {
            // reopen the form with what was typed, not what the server last held
            if (q && e.data.skip !== true) S.drafts[dkey(q, e.data.item)] = { q: viewKey(q), item: e.data.item, values: { ...(e.data.fields || {}) } };
            await outbox.discard(e.id); await refreshEntries(); if (q) go({ v: 'quest', key: viewKey(q), item: e.data.item }); else render(); } }, 'Fix'), ' ',
        h('button', { type: 'button', class: 'linklike', onclick: async () => { await outbox.discard(e.id); await refreshEntries(); render(); } }, 'Discard')));
    });
    if (S.others) kids.push(h('p', { class: 'cq-note', role: 'status' }, S.others + ' saved on this phone by another person. They send when that person signs in.'));
    setKids(bar, kids);
  }

  function drawBoard(views) {
    setKids(body,
      h('p', { class: 'meta' }, 'Amber means we already know it: please confirm.'),
      h('ul', { class: 'sd-cards', id: 'cq-board', 'aria-label': 'Setup tasks' }, views.length
        ? views.map((q) => h('li', {}, h('button', { type: 'button', class: 'sd-card', onclick: () => go({ v: 'quest', key: viewKey(q) }) }, ringEl(q.ring),
          h('span', { class: 'sd-text' }, h('b', {}, q.title), q.campus ? h('span', {}, placeName(q.campus)) : null, h('span', {}, confirmLine(q.ring))), h('span', { class: 'sd-go', 'aria-hidden': 'true' }, '›'))))
        : h('li', {}, 'Nothing for you to set up right now.')));
  }

  function drawQuest(q) {
    const list = h('div', { class: 'sd-items' });
    const real = q.items.filter((it) => it.item !== '_none');
    const none = q.items.some((it) => it.item === '_none');
    setKids(list, real.map((it) => itemForm(q, it)));
    Object.values(S.drafts).filter((d) => d.q === viewKey(q) && !real.some((it) => it.item === d.item)).forEach((d) => list.append(itemForm(q, null, d.item)));
    const kids = [];
    if (!real.length) {
      if (q.emptyLabel && !none) kids.push(h('button', { type: 'button', class: 'btn-lg', disabled: sample, onclick: () => submit(q, { item: '_none', skip: true }, 'Saved.') }, q.emptyLabel));
      else kids.push(h('p', { class: 'meta' }, none ? 'Marked: nothing to add.' : 'Nothing here yet.' + (q.addable ? ' Tap + Add.' : '')));
    }
    if (q.addable) kids.push(h('button', { type: 'button', class: 'btn-lg sd-add', disabled: sample, onclick: () => { const f = itemForm(q, null); if (!list.querySelector('.office-form')) list.replaceChildren(); list.append(f); f.querySelector('input,select').focus(); } }, '+ Add'));
    setKids(body, back('All tasks'),
      h('div', { class: 'sd-head' }, ringEl(q.ring, true), h('div', {}, h('h3', {}, q.title + (q.campus ? ' · ' + placeName(q.campus) : '')), h('p', { class: 'meta' }, confirmLine(q.ring)))),
      q.intro ? h('p', {}, q.intro) : null, list, kids);
  }

  // Queue the save, redraw at once with it laid over the view, then try to send. Where the phone cannot keep a queue
  // (private window, blocked site data) the save goes straight to the server. Resolves true when the answer is taken.
  async function submit(q, extra, done) {
    const data = { quest: q.id, ...extra, ...(q.scope === 'campus' ? { campus: q.campus } : {}) };
    if (outbox && !S.noStore) {
      try { await outbox.enqueue('setupsave', data); } catch (_) { S.noStore = true; }
    }
    if (outbox && !S.noStore) {
      delete S.drafts[dkey(q, data.item)];
      await refreshEntries();
      render(); tell(navigator.onLine ? done : CODES.OFFLINE);
      outbox.flush().catch(() => {});
      return true;
    }
    drawBar();
    const r = await write('setupsave', data);
    if (!r.success) { tell(say(r.network ? 'OFFLINE' : parseError(r).code)); return false; }
    delete S.drafts[dkey(q, data.item)];
    await load(true); render(); tell(done);
    return true;
  }

  function itemForm(q, it, useKey) {
    const model = itemModel(q, it), key = it ? it.item : useKey || newItemKey(Date.now());
    const msg = h('p', { class: 'err', role: 'alert' }), ctl = {}, errs = {};
    const kids = model.map((f) => {
      const id = 'cq-' + key + '-' + f.id;
      const c = f.choices ? h('select', {}, h('option', { value: '' }, 'Pick one'), f.choices.map((o) => h('option', { value: o, selected: o === f.value }, o)))
        : h('input', { type: f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : 'text', value: f.value, autocomplete: 'off', inputmode: f.type === 'number' ? 'numeric' : null });
      const fl = field(id, '', c, f.hint || null);
      fl.root.querySelector('label').append(f.label, f.required ? '' : h('span', { class: 'opt' }, ' (optional)'));
      ctl[f.id] = c; errs[f.id] = fl.err;
      if (f.known) {
        fl.root.classList.add('sd-known');
        const tag = h('p', { class: 'sd-tag', id: id + '-k' }, 'Known from our records · please confirm');
        c.setAttribute('aria-describedby', c.getAttribute('aria-describedby') + ' ' + tag.id);
        c.after(tag);
        const was = f.value, sync = () => { const same = c.value === was; tag.hidden = !same; fl.root.classList.toggle('sd-known', same); };
        c.addEventListener('input', sync); c.addEventListener('change', sync);
      }
      return fl.root;
    });
    const changed = () => model.some((f) => ctl[f.id].value !== f.value), hasKnown = model.some((f) => f.known);
    const n = it ? ringModel(itemCounts(q, it)) : null, pending = it && Object.values(it.fields).some((c) => c && c.pending);
    const save = h('button', { type: 'submit', disabled: sample });
    const label = () => { const conf = hasKnown && !changed(); save.textContent = conf ? 'Confirm' : 'Save'; save.classList.toggle('sd-confirm', conf); };
    label();
    const skip = q.skipLabel && it ? h('button', { type: 'button', class: 'secondary', disabled: sample }, q.skipLabel) : null;
    const form = h('form', { class: 'office-form sd-item', novalidate: true, 'data-item': key },
      h('h4', {}, fillTitle(q.itemTitle, it), n && n.done ? h('span', { class: 'sd-ok' }, ' · Confirmed') : null, pending ? h('span', { class: 'meta' }, ' · saved on this phone') : null),
      kids, msg, h('div', { class: 'sd-btns' }, save, skip));
    if (sample) Object.values(ctl).forEach((c) => { c.disabled = true; });
    const clear = () => { msg.textContent = ''; Object.keys(errs).forEach((k) => { errs[k].textContent = ''; ctl[k].removeAttribute('aria-invalid'); }); };
    const showErr = (code, fid) => { if (fid && errs[fid]) { errs[fid].textContent = say(code); ctl[fid].setAttribute('aria-invalid', 'true'); ctl[fid].focus(); } else msg.textContent = say(code); };
    const touched = () => {
      S.dirty = true; label(); msg.textContent = '';
      const values = {}; Object.keys(ctl).forEach((k) => { values[k] = ctl[k].value; });
      S.drafts[dkey(q, key)] = { q: viewKey(q), item: key, values };
    };
    form.addEventListener('input', touched); form.addEventListener('change', touched);
    form.addEventListener('submit', (e) => {
      e.preventDefault(); clear();
      const values = {}; Object.keys(ctl).forEach((k) => { values[k] = ctl[k].value; });
      const p = savePayload(q, key, values, model);
      if (!p.ok) return showErr(p.code, p.field);
      busy(submit(q, { item: key, fields: p.data.fields }, hasKnown && !changed() ? 'Confirmed.' : 'Saved.'));
    });
    if (skip) skip.addEventListener('click', () => { clear(); busy(submit(q, { item: key, skip: true }, 'Skipped.')); });
    // buttons stay off while the save is being taken (a second tap would queue it twice)
    const busy = (job) => { save.disabled = true; if (skip) skip.disabled = true; job.finally(() => { if (!sample) { save.disabled = false; if (skip) skip.disabled = false; } }); };
    // what was typed before a redraw comes back with it
    const dr = S.drafts[dkey(q, key)];
    if (dr) { Object.keys(dr.values).forEach((k) => { if (ctl[k] && ctl[k].value !== String(dr.values[k])) { ctl[k].value = String(dr.values[k]); ctl[k].dispatchEvent(new Event('input')); } }); label(); }
    return form;
  }

  async function start() {
    setKids(body, h('p', { class: 'meta' }, 'Loading…'));
    await refreshEntries();
    if (!await load()) return;
    history.replaceState({ v: 'board' }, '');
    S.view = { v: 'board' };
    render();
    if (onLoaded) onLoaded(S.views);
    const open = link.quest ? shown().filter((x) => x.id === link.quest) : [];
    if (open.length === 1) go({ v: 'quest', key: viewKey(open[0]), item: link.item || null });
    if (outbox) outbox.flush().catch(() => {});
  }
  await start();
}
