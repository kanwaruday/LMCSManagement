// Day Book starting data (office/starting-data.html): the figures as at close of the cut-off day, as quests per school.
// Three screens on one page, as a stack (the phone's Back button pops it), the Fleet setup page's look: the board (a card
// per school with its ring, a ring per quest), a school (its quests), a quest (its items as short forms). Two levels on
// every ring: solid green is confirmed, amber stripes are known (loaded from our records, waiting for a person to
// confirm). Writes are online only (api.write, no outbox): the backend (apps-script/office-start.gs) decides scope.
import { h, field, setKids } from './dom.js';
import { formatInr, isoToDmy } from './format.js';
import { explainCode } from './codes.js';
import { GAME_BACKEND_URL } from './config.js';

const FULL = ['FinanceHead', 'Accounts', 'Owner'], DESK = ['FeeClerk', 'AdminManager'], APPROVER = ['Coordinator'];
const roles = (s) => String((s && s.role) || '').split(',').map((r) => r.trim());
// 'full' (every quest, every school), 'desk' (own school's cash and odometers), 'approve' (a Coordinator: the same two, to approve), or null
export const startScope = (s) => (roles(s).some((r) => FULL.includes(r)) ? 'full' : roles(s).some((r) => DESK.includes(r)) ? 'desk' : roles(s).some((r) => APPROVER.includes(r)) ? 'approve' : null);
export const isOwner = (s) => roles(s).includes('Owner');

// Buddy's first-visit tour of this page (work/LMS Mascot Voice Guide.md: plain, warm, verb first).
export const DAYBOOK_TOUR_BEATS = [
  { target: '#sd-board', text: 'Pick a school. Each card shows the starting figures it still needs.' },
  { target: '.sd-ring', text: 'The ring fills as you go: green is confirmed, and amber stripes are figures we already know, waiting for your check.' },
  { text: 'Inside a school, amber fields come from our records. Check each one against your books, then tap Confirm, or correct it and save.' },
];

// ── hand-in and approval (the backend's start.submit / start.approve; states come with start.get and start.save)
const CHIPS = { draft: 'Draft', submitted: 'Sent for approval', approved: 'Approved', returned: 'Returned' };
const NO_STATE = { state: 'draft', by: '', at: '', note: '' };
// A school's or quest's lifecycle state -> the chip {state, label} (anything unknown is a draft)
export const stateChip = (st) => { const k = st && CHIPS[st.state] ? st.state : 'draft'; return { state: k, label: CHIPS[k], note: k === 'returned' ? String((st && st.note) || '') : '' }; };
export const questState = (data, campus, quest) => (((data && data.states) || {})[campus] || {})[quest] || null;
// A school's chip over its approval quests: returned if any was, approved if all are, sent if all are in or past, else a draft; null when none are tracked
export function schoolState(data, campus) {
  const all = Object.values(((data && data.states) || {})[campus] || {});
  if (!all.length) return null;
  const is = (k) => (x) => x.state === k;
  const k = all.some(is('returned')) ? all.find(is('returned')) : all.every(is('approved')) ? { state: 'approved' } : all.every((x) => x.state === 'submitted' || x.state === 'approved') ? { state: 'submitted' } : NO_STATE;
  return k;
}
// What one quest screen may do: the chip, whether its forms are read-only, and the buttons. quest = the definition from start.get
// (approval, fillRoles, approveRoles), counts = the quest's {confirmed, total} at this school.
export function questActions(quest, st, session, counts) {
  const rs = roles(session), has = (list) => (list || []).some((r) => rs.includes(r)), top = rs.includes('Owner') || rs.includes('FinanceHead');
  const chip = stateChip(st), lockedNow = chip.state === 'submitted' || chip.state === 'approved';
  const tracked = !!(quest && quest.approval && st);
  const fill = tracked && (top || has(quest.fillRoles)), approve = tracked && (rs.includes('Owner') || has(quest.approveRoles));
  const n = counts || {}, ready = n.total > 0 && n.confirmed === n.total;
  return { chip, tracked, readOnly: tracked && lockedNow,
    submit: { show: fill && !lockedNow, enabled: ready, hint: ready ? '' : 'START_INCOMPLETE' },
    waiting: fill && !approve && lockedNow ? (chip.state === 'approved' ? 'Approved by your Coordinator.' : 'Waiting for your Coordinator.') : '',
    decide: { show: approve && chip.state === 'submitted' } };
}
export const submitPayload = (campus, quest) => ({ quest, campus });
// decision 'approve' | 'return'; a return needs a note
export function approvePayload(campus, quest, decision, note) {
  const text = String(note || '').trim();
  if (decision === 'return' && !text) return { ok: false, code: 'NOTE_REQUIRED', field: 'note' };
  return { ok: true, data: { quest, campus, decision, note: decision === 'return' ? text : '' } };
}

// counts {confirmed, known, total} -> what a ring shows
export function ringModel(n) {
  const t = (n && n.total) || 0, c = (n && n.confirmed) || 0, k = (n && n.known) || 0;
  return { confirmed: c, known: k, total: t, pct: t ? Math.floor(100 * c / t) : 0, toConfirm: t - c, done: t > 0 && c === t };
}
// The ring as SVG markup (numbers only, never server text): confirmed solid, known as amber stripes after it.
export function ringSvg(n, big) {
  const m = ringModel(n), r = 16, C = 2 * Math.PI * r;
  const kc = m.total ? C * m.confirmed / m.total : 0, kk = m.total ? C * m.known / m.total : 0;
  const arc = (from, dash, cls) => `<circle cx="20" cy="20" r="${r}" class="${cls}" stroke-dasharray="${dash}" stroke-dashoffset="${(-from).toFixed(3)}"/>`;
  const dashes = (len) => { const a = []; for (let x = 0; x < len; x += 2.3) a.push(Math.min(1.5, len - x).toFixed(3), '0.8'); a[a.length - 1] = C.toFixed(3); return a.join(' '); };
  const arcs = (kk > 0.05 ? arc(kc, dashes(kk), 'known') : '') + (kc > 0.05 ? arc(0, kc.toFixed(3) + ' ' + C.toFixed(3), 'on') : '');
  const label = !m.total ? 'Nothing entered yet' : m.done ? 'All confirmed' : `${m.pct}% confirmed` + (m.known ? `, ${m.known} known to confirm` : '');
  return `<span class="sd-ring${big ? ' sd-ring-big' : ''}${m.done ? ' done' : ''}" role="img" aria-label="${label}">` +
    `<svg viewBox="0 0 40 40" aria-hidden="true"><g transform="rotate(-90 20 20)"><circle cx="20" cy="20" r="${r}"/>${arcs}</g></svg><b>${m.done ? '✓' : m.pct + '%'}</b></span>`;
}
export const confirmLine = (n) => { const m = ringModel(n); return !m.total ? 'Nothing entered yet' : m.done ? 'All confirmed' : m.toConfirm + ' to confirm'; };

// 12345650 paise -> '1,23,456.50' (the form's text; formatInr without the sign)
export const rupeesText = (paise) => formatInr(paise).replace('₹', '');

// A quest definition + an item (or null for a new one) -> the form's fields with their starting text.
export function formModel(quest, item) {
  return quest.fields.map((f) => {
    const s = item && item.fields[f.id], v = s ? s.value : '';
    const text = v === '' || v == null ? '' : f.type === 'rupees' ? rupeesText(v) : String(v);
    return { id: f.id, label: f.label, type: f.type, required: !!f.required, choices: f.choices || null, allowNegative: !!f.allowNegative, value: s && s.status === 'skipped' ? '' : text,
      known: !!s && s.status === 'known', hint: f.type === 'last4' ? 'Last 4 digits only' : f.type === 'rupees' ? 'In rupees, like 1,23,456.50' + (f.allowNegative ? ' (an overdraft starts with a minus: -5,000)' : '') : '' };
  });
}

// The save body for one item from the typed text: {ok, data} or {ok:false, code, field}. Rupees go as plain rupees
// ('123456.50'); a field is sent when it has text or had a value before (cleared). Mirrors the backend's checks: the 8+ digit
// guard is for free text only. Only a loan names its school (campus): cash takes it from the item, the rest from their
// campus field, so a FinanceHead is never refused a school outside their own list.
const TYPED = ['rupees', 'km', 'last4', 'choice', 'date'];
export function savePayload(quest, key, values, model, campus) {
  const fields = {};
  for (const f of model) {
    const raw = String(values[f.id] == null ? '' : values[f.id]).trim();
    let v = raw;
    if (f.type === 'rupees') v = raw.replace(/[₹,\s]/g, '');
    if (!TYPED.includes(f.type) && /\d{8,}/.test(v)) return { ok: false, code: 'ACCOUNT_NUMBER_REFUSED', field: f.id };
    if (v === '') {
      if (f.required) return { ok: false, code: 'START_FIELD_REQUIRED', field: f.id };
      if (f.value !== '') fields[f.id] = '';
      continue;
    }
    if (f.type === 'rupees' && !(f.allowNegative ? /^-?\d{1,10}(\.\d{1,2})?$/ : /^\d{1,10}(\.\d{1,2})?$/).test(v)) return { ok: false, code: 'BAD_AMOUNT', field: f.id };
    if (f.type === 'last4' && !/^\d{4}$/.test(v)) return { ok: false, code: 'BAD_LAST4', field: f.id };
    if (f.type === 'km' && !/^\d+$/.test(v)) return { ok: false, code: 'BAD_KM', field: f.id };
    fields[f.id] = v;
  }
  const data = { quest: quest.id, item: key, fields };
  if (quest.id === 'loan' && campus && campus !== 'ALL') data.campus = campus;
  return { ok: true, data };
}

// A refusal -> {code, field}: the backend sends code, and error 'CODE: fieldId' when it names the field.
export function parseError(r) {
  const m = /^([A-Z0-9_]+): (\S+)$/.exec(String((r && r.error) || ''));
  return { code: (r && r.code) || (m ? m[1] : (r && r.error) || ''), field: m ? m[2] : null };
}

// ?campus=LMS4&quest=cash (a mission's go link) -> {campus, quest}; either may be null.
export function parseDeepLink(search) {
  const q = new URLSearchParams(search || ''), c = String(q.get('campus') || '').toUpperCase(), quest = String(q.get('quest') || '');
  return { campus: /^(LMS[1-6]|HES|ALL)$/.test(c) ? c : null, quest: /^[a-z]{1,20}$/.test(quest) ? quest : null };
}

// A school's quests in play order: those start.progress lists for it, plus loans (optional) for a school when the role has them.
export function schoolQuests(data, campus) {
  const here = data.progress[campus] || {};
  return data.quests.filter((q) => here[q.id] || (q.id === 'loan' && campus !== 'ALL')).map((q) => q.id);
}
export const itemsFor = (data, campus, quest) => data.items.filter((i) => i.quest === quest && (i.campus || 'ALL') === campus);
export const newKey = (quest, now) => quest + '-' + Number(now).toString(36);
const itemTitle = (quest, it, model) => {
  const v = (id) => (model.find((f) => f.id === id) || {}).value || '';
  const t = { cash: it && 'Cash at ' + placeName(it.item), bank: [v('bank'), v('last4') && '··' + v('last4')].filter(Boolean).join(' '), supplier: v('name'), odometer: v('reg'), loan: [v('reg'), v('lender')].filter(Boolean).join(' · '), users: v('name') }[quest.id];
  return it ? t || 'Entry ' + it.item : 'New entry';
};
const placeName = (c) => (c === 'ALL' ? 'All schools' : (window.LMCS && window.LMCS.campusLabel ? window.LMCS.campusLabel(c) : c));
const ringEl = (n, big) => { const s = h('span'); s.innerHTML = ringSvg(n, big); return s.firstElementChild; };
const GO = '›';

export async function showStartingData(root, session, api) {
  const scope = startScope(session);
  if (!scope) { setKids(root, h('h2', {}, 'Starting data'), h('p', {}, 'Starting data is not for your role.')); return; }
  const S = { data: null, view: { v: 'board' } };
  const toast = h('p', { class: 'sd-toast', role: 'status', 'aria-live': 'polite' });
  const body = h('div');
  setKids(root, h('h2', {}, 'Starting data'), body, toast);
  let toastT;
  const say = (t) => { toast.textContent = t; clearTimeout(toastT); toastT = setTimeout(() => { toast.textContent = ''; }, 4000); };

  async function load() {
    setKids(body, h('p', { class: 'meta' }, 'Loading…'));
    const r = await api.read('start.get', {}, 'sdget');
    if (r.stale) return false;
    if (!r.success) {
      const again = h('button', { type: 'button', class: 'btn-lg', onclick: () => load().then(render) }, 'Try again');
      setKids(body, h('p', {}, 'Could not load the starting data: ' + (r.network ? 'offline or unavailable.' : explainCode(parseError(r).code))), again);
      return false;
    }
    S.data = r;
    return true;
  }
  const go = (view) => { S.view = view; history.pushState(view, ''); render(); scrollTo(0, 0); };
  addEventListener('popstate', (e) => { S.view = e.state || { v: 'board' }; render(); });
  const back = (text) => h('button', { type: 'button', class: 'sd-back', onclick: () => history.back() }, '← ' + text);

  function render() {
    if (!S.data) return;
    const v = S.view;
    if (v.v === 'quest' && S.data.progress[v.campus] !== undefined) return drawQuest(v.campus, v.quest);
    if (v.v === 'school' && S.data.progress[v.campus] !== undefined) return drawSchool(v.campus);
    drawBoard();
  }

  const chipEl = (st) => { const c = stateChip(st); return h('span', { class: 'sd-chip sd-chip-' + c.state }, c.label); };
  function card(n, title, line, onclick, st) {
    return h('li', {}, h('button', { type: 'button', class: 'sd-card', onclick }, ringEl(n), h('span', { class: 'sd-text' }, h('b', {}, title), h('span', {}, line), st ? chipEl(st) : null), h('span', { class: 'sd-go', 'aria-hidden': 'true' }, GO)));
  }

  function drawBoard() {
    const d = S.data, campuses = Object.keys(d.progress);
    setKids(body,
      h('p', { class: 'meta' }, 'Figures as at close of ' + isoToDmy(d.cutoff) + '. Amber means we already know it: please confirm.'),
      h('ul', { class: 'sd-cards', id: 'sd-board', 'aria-label': 'Schools' }, campuses.length
        ? campuses.map((c) => card(d.rings[c], placeName(c), confirmLine(d.rings[c]), () => go({ v: 'school', campus: c }), schoolState(d, c)))
        : h('li', {}, 'Nothing for your school yet.')),
      scope === 'full' ? [h('h3', {}, 'Each quest, all schools'), h('ul', { class: 'sd-cards sd-small' },
        d.quests.filter((q) => d.overall[q.id]).map((q) => h('li', { class: 'sd-row' }, ringEl(d.overall[q.id]), h('span', { class: 'sd-text' }, h('b', {}, q.label), h('span', {}, confirmLine(d.overall[q.id]))))))] : null,
      isOwner(session) ? ownerTools() : null);
  }

  function drawSchool(campus) {
    const d = S.data, ring = d.rings[campus];
    setKids(body, back('All schools'),
      h('div', { class: 'sd-head' }, ringEl(ring, true), h('div', {}, h('h3', {}, placeName(campus)), h('p', { class: 'meta' }, confirmLine(ring)), schoolState(d, campus) ? chipEl(schoolState(d, campus)) : null)),
      h('ul', { class: 'sd-cards' }, schoolQuests(d, campus).map((id) => {
        const q = d.quests.find((x) => x.id === id), n = (d.progress[campus] || {})[id] || { confirmed: 0, known: 0, total: 0 };
        return card(n, q.label + (q.optional ? ' (optional)' : ''), confirmLine(n), () => go({ v: 'quest', campus, quest: id }), questState(d, campus, id));
      })));
  }

  function drawQuest(campus, questId) {
    const d = S.data, quest = d.quests.find((q) => q.id === questId);
    if (!quest || !schoolQuests(d, campus).includes(questId)) { S.view = { v: 'school', campus }; return drawSchool(campus); }
    const list = h('div', { class: 'sd-items' });
    const items = itemsFor(d, campus, questId);
    const act = questActions(quest, questState(d, campus, questId), session, (d.progress[campus] || {})[questId]);
    setKids(list, items.length ? items.map((it) => itemForm(quest, campus, it, act.readOnly)) : h('p', { class: 'meta' }, 'Nothing here yet.' + (quest.addable && !act.readOnly ? ' Tap + Add.' : '')));
    const add = quest.addable && !act.readOnly ? h('button', { type: 'button', class: 'btn-lg sd-add', onclick: () => {
      const f = itemForm(quest, campus, null);
      if (!list.querySelector('.office-form')) list.replaceChildren();
      list.append(f); f.querySelector('input,select').focus();
    } }, '+ Add') : null;
    setKids(body, back(placeName(campus)), h('h3', {}, quest.label + ' · ' + placeName(campus)),
      quest.id === 'loan' ? h('p', { class: 'meta' }, 'Optional: only vehicles bought on a loan.') : null, act.tracked ? statusBlock(quest, campus, act) : null, list, add, act.tracked ? actionBlock(quest, campus, act) : null);
  }

  // the chip, the Coordinator's return note, and the waiting line
  function statusBlock(quest, campus, act) {
    return h('div', { class: 'sd-status' }, h('span', { class: 'sd-chip sd-chip-' + act.chip.state }, act.chip.label),
      act.chip.note ? h('p', { class: 'sd-return', role: 'note' }, 'Sent back: ' + act.chip.note) : null,
      act.waiting ? h('p', { class: 'meta' }, act.waiting) : null);
  }
  // Send for approval (a clerk) / Approve and Return (an approver)
  function actionBlock(quest, campus, act) {
    const msg = h('p', { class: 'err', role: 'alert' }), kids = [];
    async function call(action, data, done, btns) {
      if (!navigator.onLine) { msg.textContent = 'You are offline. Connect to the internet, then try again.'; return; }
      btns.forEach((b) => { b.disabled = true; });
      try {
        const r = await api.write(action, data);
        if (!r.success) { const e = parseError(r); msg.textContent = r.network ? 'Not sent: no connection. Try again.' : explainCode(e.code); return; }
        S.data.states = Object.assign({}, S.data.states, { [campus]: Object.assign({}, (S.data.states || {})[campus], { [quest.id]: r.state }) });
        render(); say(done);
      } finally { btns.forEach((b) => { b.disabled = false; }); }
    }
    if (act.submit.show) {
      const b = h('button', { type: 'button', class: 'btn-lg', disabled: !act.submit.enabled }, 'Send for approval');
      b.addEventListener('click', () => call('start.submit', submitPayload(campus, quest.id), 'Sent for approval.', [b]));
      kids.push(b, act.submit.enabled ? null : h('p', { class: 'meta' }, explainCode(act.submit.hint)));
    }
    if (act.decide.show) {
      const note = h('input', { type: 'text', 'aria-label': 'What needs fixing', placeholder: 'What needs fixing?', hidden: true, autocomplete: 'off' });
      const ok = h('button', { type: 'button', class: 'btn-lg sd-confirm' }, 'Approve'), no = h('button', { type: 'button', class: 'secondary' }, 'Return');
      ok.addEventListener('click', () => { msg.textContent = ''; const p = approvePayload(campus, quest.id, 'approve'); call('start.approve', p.data, 'Approved.', [ok, no]); });
      no.addEventListener('click', () => {
        msg.textContent = '';
        if (note.hidden) { note.hidden = false; note.focus(); no.textContent = 'Send back'; return; }
        const p = approvePayload(campus, quest.id, 'return', note.value);
        if (!p.ok) { msg.textContent = explainCode(p.code); note.focus(); return; }
        call('start.approve', p.data, 'Sent back.', [ok, no]);
      });
      kids.push(h('div', { class: 'sd-btns' }, ok, no), note);
    }
    return h('div', { class: 'sd-actions' }, kids, msg);
  }

  function itemForm(quest, campus, it, readOnly) {
    const model = formModel(quest, it), key = it ? it.item : newKey(quest.id, Date.now());
    if (!it) { const c = model.find((f) => f.id === 'campus'); if (c && campus && c.choices.includes(campus)) c.value = campus; }
    const msg = h('p', { class: 'err', role: 'alert' });
    const ctl = {}, errs = {};
    const kids = model.map((f) => {
      const id = 'sd-' + key + '-' + f.id;
      let c;
      if (f.type === 'choice') c = h('select', {}, h('option', { value: '' }, 'Pick one'), f.choices.map((o) => h('option', { value: o, selected: o === f.value }, o === 'ALL' ? 'All schools' : o)));
      else c = h('input', { type: f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : 'text', value: f.value, autocomplete: 'off',
        inputmode: f.type === 'rupees' && !f.allowNegative ? 'decimal' : f.type === 'km' || f.type === 'last4' ? 'numeric' : null, maxlength: f.type === 'last4' ? '4' : null });
      const fl = field(id, '', c, f.hint || null);
      fl.root.querySelector('label').append(f.label, f.required ? '' : h('span', { class: 'opt' }, ' (optional)'));
      ctl[f.id] = c; errs[f.id] = fl.err;
      if (f.known) {
        fl.root.classList.add('sd-known');
        const tag = h('p', { class: 'sd-tag', id: id + '-k' }, 'Known from our records · please confirm');
        c.setAttribute('aria-describedby', c.getAttribute('aria-describedby') + ' ' + tag.id);
        c.after(tag);
        const was = f.value;
        const sync = () => { const same = c.value === was; tag.hidden = !same; fl.root.classList.toggle('sd-known', same); };
        c.addEventListener('input', sync); c.addEventListener('change', sync);
      }
      return fl.root;
    });
    const changed = () => model.some((f) => ctl[f.id].value !== f.value);
    const hasKnown = model.some((f) => f.known);
    const n = it ? ringModel(countsOf(quest, it)) : null;
    const save = h('button', { type: 'submit', hidden: !!readOnly });
    const label = () => { const conf = hasKnown && !changed(); save.textContent = conf ? 'Confirm' : 'Save'; save.classList.toggle('sd-confirm', conf); };
    label();
    const skip = quest.optional && !readOnly ? h('button', { type: 'button', class: 'secondary' }, 'No loan for this vehicle') : null;
    if (readOnly) Object.values(ctl).forEach((c) => { c.disabled = true; });
    const form = h('form', { class: 'office-form sd-item', novalidate: true },
      h('h4', {}, itemTitle(quest, it, model), n && n.done ? h('span', { class: 'sd-ok' }, ' · Confirmed') : null), kids, msg, h('div', { class: 'sd-btns' }, save, skip));
    form.addEventListener('input', () => { label(); msg.textContent = ''; });
    form.addEventListener('change', label);
    const clear = () => { msg.textContent = ''; Object.keys(errs).forEach((k) => { errs[k].textContent = ''; ctl[k].removeAttribute('aria-invalid'); }); };
    const showErr = (code, fid) => {
      if (fid && errs[fid]) { errs[fid].textContent = explainCode(code); ctl[fid].setAttribute('aria-invalid', 'true'); ctl[fid].focus(); }
      else msg.textContent = explainCode(code);
    };
    async function send(data, done) {
      if (!navigator.onLine) { msg.textContent = 'You are offline. Connect to the internet, then save again.'; return; }
      save.disabled = true; if (skip) skip.disabled = true;
      try {
        const r = await api.write('start.save', data);
        if (!r.success) { const e = parseError(r); return r.network ? (msg.textContent = 'Not saved: no connection. Try again.') : showErr(e.code, e.field); }
        const i = S.data.items.findIndex((x) => x.quest === r.saved.quest && x.item === r.saved.item);
        if (i === -1) S.data.items.push(r.saved); else S.data.items[i] = r.saved;
        Object.assign(S.data, { progress: r.progress, rings: r.rings, overall: r.overall }, r.states ? { states: r.states } : {});
        render(); say(done);
      } finally { save.disabled = false; if (skip) skip.disabled = false; }
    }
    form.addEventListener('submit', (e) => {
      e.preventDefault(); clear();
      const values = {}; Object.keys(ctl).forEach((k) => { values[k] = ctl[k].value; });
      const p = savePayload(quest, key, values, model, campus);
      if (!p.ok) return showErr(p.code, p.field);
      send(p.data, hasKnown && !changed() ? 'Confirmed.' : 'Saved.');
    });
    if (skip) skip.addEventListener('click', () => { clear(); send({ quest: quest.id, item: key, campus: campus === 'ALL' ? undefined : campus, skip: true }, 'Marked: no loan.'); });
    return form;
  }
  // one item's counts, as the backend counts them (required fields only; skipped counts as confirmed)
  function countsOf(quest, it) {
    const n = { confirmed: 0, known: 0, total: 0 };
    quest.fields.filter((f) => f.required).forEach((f) => { n.total++; const st = it.fields[f.id] && it.fields[f.id].status; if (st === 'confirmed' || st === 'skipped') n.confirmed++; else if (st === 'known') n.known++; });
    return n;
  }

  function ownerTools() {
    const file = h('input', { type: 'file', accept: '.json,application/json' }), seedMsg = h('p', { role: 'status' }), expMsg = h('p', { role: 'status' });
    const seedFl = field('sd-seed', 'Known values file (JSON with rows)', file);
    const seedBtn = h('button', { type: 'button', onclick: async () => {
      const f = file.files[0];
      if (!f) { seedMsg.textContent = 'Choose the file first.'; return; }
      let rows;
      try { rows = JSON.parse(await f.text()).rows; } catch (_) { rows = null; }
      if (!Array.isArray(rows) || !rows.length) { seedMsg.textContent = 'That file has no rows. It needs {"rows": [...]}.'; return; }
      seedBtn.disabled = true; seedMsg.textContent = 'Loading ' + rows.length + ' values…';
      try {
        const r = await api.write('start.seed', { rows });
        if (!r.success) { const e = parseError(r); seedMsg.textContent = 'Nothing was loaded: ' + explainCode(e.code) + (e.field ? ' (' + e.field + ')' : ''); return; }
        if (await load()) { drawBoard(); }
        say('Loaded ' + r.written + ' known values; kept ' + r.kept + ' already confirmed.');
      } finally { seedBtn.disabled = false; }
    } }, 'Load known values');
    const expBtn = h('button', { type: 'button', onclick: async () => {
      expBtn.disabled = true; expMsg.textContent = 'Preparing…';
      try {
        const r = await api.read('start.export', {});
        if (!r.success) { expMsg.textContent = 'Could not download: ' + (r.network ? 'offline or unavailable.' : explainCode(parseError(r).code)); return; }
        const { success, ...out } = r;
        download('starting-data-export.json', out);
        download('actual.json', out.actual);
        const open = Object.values(out.unconfirmed || {}).reduce((a, b) => a + b, 0);
        expMsg.textContent = 'Downloaded starting-data-export.json and actual.json (for the importer\'s --actual).' + (open ? ' ' + open + ' entries are not fully confirmed yet.' : '');
      } finally { expBtn.disabled = false; }
    } }, 'Download for the import');
    return h('div', { class: 'office-form sd-tools' }, h('h3', {}, 'Owner tools'), seedFl.root, seedBtn, seedMsg, h('hr'), expBtn, expMsg);
  }

  if (!await load()) return;
  history.replaceState({ v: 'board' }, '');
  render();
  const dl = parseDeepLink(location.search);
  if (dl.campus && S.data.progress[dl.campus] !== undefined) {
    go({ v: 'school', campus: dl.campus });
    if (dl.quest && schoolQuests(S.data, dl.campus).includes(dl.quest)) go({ v: 'quest', campus: dl.campus, quest: dl.quest });
  }
  mountBuddy(session);
}

function download(name, obj) {
  const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Buddy on this page, the homes' guarded pattern: a missing or failing game layer never breaks the page.
function mountBuddy(session) {
  if (typeof window.LMCSGame === 'undefined') return;
  try {
    window.LMCSGame.mount(document.getElementById('game-root'), { session: (window.LMCS && window.LMCS.getSession()) || session, backendUrl: GAME_BACKEND_URL, root: '../',
      only: 'daybook', title: 'Starting data', tour: { id: 'daybook-start', beats: DAYBOOK_TOUR_BEATS } });
  } catch (e) { console.warn('game layer', e); }
}
