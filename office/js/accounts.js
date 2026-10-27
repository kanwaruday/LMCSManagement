// Accounts screen (FinanceHead / Accounts / Owner): add bank/credit accounts, set their openings, vehicles, and the ledger summary.
import { h, setKids } from './dom.js';
import { cashToPaise } from './report.js';
import { formatInr, isoToDmy } from './format.js';
import { todayIst, inflightGuard, chargedLabel } from './daybook.js';
import { entryReason, explainCode } from './codes.js';
import { COORD_BACKEND_URL } from './config.js';

const ROLES = ['FinanceHead', 'Accounts', 'Owner'];
const hasRole = (s, roles) => String((s && s.role) || '').split(',').map((r) => r.trim()).some((r) => roles.includes(r));
export const canSeeAccounts = (session) => hasRole(session, ROLES);

const normReg = (s) => String(s == null ? '' : s).toUpperCase().replace(/[\s.\-]/g, '');
const CAMPUS_RE = /^LMS[1-6]$/;
const KINDS = { jeep: 'Jeep / Innova / Force / Cruiser', car: 'Car', van: 'Van' };

// Coordinator fleet rows -> vehicles.import rows. Rows with no reg or an unknown campus are skipped; a reg appears once.
export function mapFleet(fleet) {
  const seen = new Set(), out = [];
  (Array.isArray(fleet) ? fleet : []).forEach((b) => {
    const reg = normReg(b && b.reg), campus = String((b && (b.campusId || b.campus)) || '').toUpperCase().replace(/\s+/g, '');
    if (!reg || !CAMPUS_RE.test(campus) || seen.has(reg)) return;
    seen.add(reg);
    out.push({ reg, label: [b.bus, b.route].filter((x) => x !== undefined && x !== null && String(x).trim() !== '').join(' · ') || reg, kind: 'bus', campus });
  });
  return out;
}

// GET the Coordinator transport document (same request shape as coordinator/shared.js) -> fleet rows, or throws.
export async function fetchFleet(fetchFn, url, token) {
  const res = await fetchFn(url + '?action=coordinatortransport&idToken=' + encodeURIComponent(token));
  let data;
  try { data = JSON.parse(await res.text()); } catch (_) { throw new Error('The Transport answer could not be read. Try again in a minute.'); }
  if (!data || !data.success) throw new Error(/^Not authorized/.test((data && data.error) || '') ? NOT_ALLOWED_TRANSPORT : (data && data.error) || 'The Transport list could not be loaded.');
  return data.fleet || [];
}

export const NOT_ALLOWED_TRANSPORT = "Your account can't read the Transport list (it needs Coordinator or Owner access). Ask Uday.";
export const SIGNED_OUT = 'Your sign-in has expired. Sign in again, then try again.';
// The live session's token, only when it is still the page user's (same rule as the shell's pageUser); else throws SIGNED_OUT.
export function liveToken(L, session) {
  const s = L && L.getSession && L.getSession();
  if (!s || !s.idToken || String(s.email || '').toLowerCase() !== String((session && session.email) || '').toLowerCase()) throw new Error(SIGNED_OUT);
  return s.idToken;
}

export function accountPayload(campus, kind, label) {
  if (kind !== 'bank' && kind !== 'credit') return { ok: false, error: 'Choose bank or supplier credit.' };
  const l = String(label || '').trim();
  return l ? { ok: true, data: { campus, kind, label: l } } : { ok: false, error: 'Enter a name for the account.' };
}
export function vehiclePayload(campus, kind, reg, label) {
  const r = normReg(reg);
  if (!r) return { ok: false, error: 'Enter the registration number.' };
  if (!KINDS[kind]) return { ok: false, error: 'Choose the vehicle type.' };
  return { ok: true, data: { reg: r, label: String(label || '').trim() || r, kind, campus } };
}
export function accountOpeningPayload(account, text) {
  if (!account) return { ok: false, error: 'Choose an account.' };
  const p = cashToPaise(text);
  return p === null ? { ok: false, error: 'Enter the opening in rupees, like 1234.50 (or 0).' } : { ok: true, data: { account: account.id, campus: account.campus, amount_paise: p } };
}

// fund.transfer from the form: two bank accounts of different campuses, rupees, date (not future), bank reference.
export function fundTransferPayload(from, to, text, date, reference, narration, today) {
  if (!from || !to) return { ok: false, error: 'Choose both bank accounts.' };
  if (from.campus === to.campus) return { ok: false, error: explainCode('FUND_SAME_CAMPUS') };
  const p = cashToPaise(text);
  if (!p) return { ok: false, error: 'Enter the amount in rupees, like 1234.50.' };
  if (!date || date > today) return { ok: false, error: 'Choose today or an earlier date.' };
  const ref = String(reference || '').trim();
  if (!ref) return { ok: false, error: 'Enter the bank reference (UTR or cheque number).' };
  return { ok: true, data: { date, from_account: from.id, to_account: to.id, amount_paise: p, reference: ref, narration: String(narration || '').trim() } };
}

// New collection head from a typed name: id is a slug of it. Refuses a name that is already a head (switch it on instead).
export function collectionPayload(label, heads) {
  const l = String(label || '').trim();
  const id = l.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  if (!id) return { ok: false, error: 'Enter a name for the collection.' };
  return (heads || []).some((c) => c.id === id) ? { ok: false, error: 'That collection is already in the list. If it is switched off, switch it on there.' } : { ok: true, data: { head: id, label: l } };
}

export const NO_HEAD_LABEL = 'No collection named (older entries)';
// ledger.summary collections {head: {collected_paise, paid_paise, balance_paise}} -> table rows: known heads in list order, then unknown ids, then the blank head.
export function collectionRows(by, heads) {
  const ids = Object.keys(by || {}), label = (id) => id === '' ? NO_HEAD_LABEL : ((heads || []).find((c) => c.id === id) || {}).label || id;
  const order = (heads || []).map((c) => c.id).filter((id) => ids.includes(id)).concat(ids.filter((id) => id !== '' && !(heads || []).some((c) => c.id === id)), ids.includes('') ? [''] : []);
  return order.map((id) => ({ label: label(id), collected: by[id].collected_paise, paid: by[id].paid_paise, balance: by[id].balance_paise }));
}

// Mean of the non-null km_per_litre values of a vehicle's fills, 2 decimals; null when there are none.
export function avgKmPerLitre(fills) {
  const v = (fills || []).map((f) => f.km_per_litre).filter((x) => typeof x === 'number');
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 100) / 100 : null;
}

export const GROUP_ORDER = [['fee', 'Fees'], ['income', 'Other receipts'], ['school', 'School expenses'], ['transport', 'Transport']];
// byChargedTo {school: {category: paise}} -> {school: [{group, label, total, items:[{label, paise}]}]}; unknown categories are left out.
export function groupTotals(by, categories) {
  const cat = {}; (categories || []).forEach((c) => { cat[c.id] = c; });
  const out = {};
  Object.keys(by || {}).forEach((school) => {
    out[school] = GROUP_ORDER.map(([g, label]) => {
      const items = Object.keys(by[school]).filter((id) => cat[id] && cat[id].group === g).map((id) => ({ label: cat[id].label, paise: by[school][id] }));
      return { group: g, label, total: items.reduce((a, i) => a + i.paise, 0), items };
    }).filter((g) => g.items.length);
  });
  return out;
}

const fyStart = (iso) => (Number(iso.slice(5, 7)) >= 4 ? iso.slice(0, 4) : String(Number(iso.slice(0, 4)) - 1)) + '-04-01';
export const defaultPeriod = (today) => ({ from: fyStart(today), to: today });
export const samePeriodYear = (from, to) => fyStart(from) === fyStart(to);

const money = (p) => h('td', {}, formatInr(p));
const table = (head, rows) => h('table', { class: 'bal' }, h('thead', {}, h('tr', {}, head.map((x) => h('th', {}, x)))), h('tbody', {}, rows.map((r) => h('tr', {}, r))));

// The headline totals of one ledger.summary (paise): owed to suppliers, bank/other balances, held for student collections.
export function summaryTotals(sum, cfg) {
  const add = (xs) => xs.reduce((t, x) => t + (Number(x) || 0), 0);
  return {
    owed: add((sum.accounts || []).filter((a) => a.kind === 'credit').map((a) => a.owed_paise)),
    balance: add((sum.accounts || []).filter((a) => a.kind !== 'credit').map((a) => a.balance_paise)),
    held: add(collectionRows(sum.collections, cfg && cfg.collections).map((r) => r.balance)),
  };
}
// 2+ schools picked: one total per school in its colour (never summed together); results = [[campus, ledger.summary], ...]
export function summaryOverlay(results, cfg, overlay) {
  const sel = { all: false, campuses: results.map((r) => r[0]) }, by = {};
  results.forEach(([c, sum]) => { by[c] = summaryTotals(sum, cfg); });
  const line = (label, k) => '<p><b>' + label + '</b> ' + overlay(Object.fromEntries(sel.campuses.map((c) => [c, by[c][k]])), sel, formatInr) + '</p>';
  return line('Account balances', 'balance') + line('Owed to suppliers', 'owed') + line('Held for student collections', 'held');
}

// Which ledger.summary calls the picker's selection means. ALL is one call only for an ALL sign-in; any other session's "All" is
// one call per school in its own scope (scope = LMCSCampus.scope(session,{hes:true})), so nothing outside the sign-in is asked for.
export function summaryTargets(session, sel, scope) {
  if (!(sel && sel.all)) return (sel && sel.campuses) || [];
  return session.campusId === 'ALL' ? ['ALL'] : scope.slice();
}

export function summaryView(sum, cfg, campusLabel) {
  const label = (id) => chargedLabel(id);
  const credit = sum.accounts.filter((a) => a.kind === 'credit');
  const regLabel = (reg) => ((cfg.vehicles || []).find((v) => v.reg === reg) || {}).label || reg;
  const groups = groupTotals(sum.byChargedTo, cfg.categories);
  const veh = Object.keys(sum.vehicles || {}), fuelRegs = Object.keys(sum.fuel || {});
  return h('div', {},
    h('h3', {}, 'Owed to suppliers'),
    credit.length ? table(['Supplier account', 'Owed'], credit.map((a) => [h('td', {}, a.label + ' (' + a.campus + ')'), money(a.owed_paise)])) : h('p', {}, 'No supplier credit accounts.'),
    h('h3', {}, 'Account balances'),
    table(['Account', 'Balance'], sum.accounts.filter((a) => a.kind !== 'credit').map((a) => [h('td', {}, a.label), money(a.balance_paise)])),
    h('h3', {}, 'Per school'),
    h('p', { class: 'meta' }, 'Money in shows as positive, money out as negative.'),
    Object.keys(groups).length ? Object.keys(groups).sort().map((s) => h('div', {}, h('h4', {}, label(s)),
      groups[s].map((g) => h('div', {}, h('p', {}, h('b', {}, g.label + ': ' + formatInr(g.total))),
        table(['Category', 'Amount'], g.items.map((i) => [h('td', {}, i.label), money(i.paise)])))))) : h('p', {}, 'Nothing in this period.'),
    h('h3', {}, 'Student collections'),
    h('p', { class: 'meta' }, 'Collected from students, paid onward, and what is still held, for this period.'),
    collectionRows(sum.collections, cfg.collections).length ? table(['Collection', 'Collected', 'Paid onward', 'Balance'], collectionRows(sum.collections, cfg.collections).map((r) => [h('td', {}, r.label), money(r.collected), money(r.paid), money(r.balance)])) : h('p', {}, 'None.'),
    h('h3', {}, 'Between schools'),
    sum.interSchool.length ? table(['Paid by', 'For', 'Amount'], sum.interSchool.map((x) => [h('td', {}, label(x.from)), h('td', {}, label(x.to)), money(x.paise)])) : h('p', {}, 'None.'),
    h('h3', {}, 'Vehicle costs'),
    h('p', { class: 'meta' }, 'Money in shows as positive, money out as negative.'),
    veh.length ? veh.sort().map((reg) => h('div', {}, h('h4', {}, regLabel(reg)),
      table(['Column', 'Amount'], Object.keys(sum.vehicles[reg]).sort().map((c) => [h('td', {}, c.replace(/_/g, ' ')), money(sum.vehicles[reg][c])])))) : h('p', {}, 'None.'),
    h('h3', {}, 'Fuel'),
    fuelRegs.length ? table(['Vehicle', 'Fills', 'Avg km per litre'], fuelRegs.sort().map((reg) => {
      const k = avgKmPerLitre(sum.fuel[reg]);
      return [h('td', {}, regLabel(reg)), h('td', {}, sum.fuel[reg].length), h('td', {}, k === null ? '—' : k)];
    })) : h('p', {}, 'No fuel fills in this period.'));
}

export async function showAccounts(root, session, api, outbox) {
  if (!canSeeAccounts(session)) {
    // Shown only to the Owner and the people in Settings fund_transfer_emails (config.get's fund_transfer_allowed).
  const ftForm = form('Fund transfer (bank to bank)', h('p', { class: 'meta' }, 'Money sent by bank from one school (or HES) to another. Both day books get their entry.'),
    h('label', { for: 'ft-from' }, 'From account'), ftFrom, h('label', { for: 'ft-to' }, 'To account'), ftTo, ftAmt,
    h('label', { for: 'ft-date' }, 'Date'), ftDate, ftRef, ftNote, ftBtn, ftMsg);
  ftForm.hidden = true;
  root.replaceChildren(h('h2', {}, 'Accounts'), h('p', {}, 'Accounts is not available for your role. Ask the Finance Head or Owner.'));
    return;
  }
  const guard = inflightGuard();
  const campus = session.campus;
  const campusLabelOf = (c) => (window.LMCS && window.LMCS.campusLabel ? window.LMCS.campusLabel(c) : c);
  const allCampus = session.campusId === 'ALL' || hasRole(session, ['Accounts']);
  let cfg = { categories: [], accounts: [], vehicles: [], campuses: [], collections: [] };
  const say = (el, text) => { el.textContent = text; };
  // Queue, flush, and report what happened to that entry.
  async function send(action, data, msgEl, okText) {
    try {
      const id = await outbox.enqueue(action, data);
      await outbox.flush().catch(() => {});
      const e = (await outbox.entries()).find((x) => x.id === id);
      say(msgEl, !e ? okText : e.status === 'attention' ? entryReason(e) : 'Saved on this device, will sync when online.');
      return !e;
    } catch (err) { say(msgEl, 'Could not save on this device: ' + (err && err.message || err)); return false; }
  }
  const sel = (id, opts, label) => h('div', {}, h('label', { for: id }, label), h('select', { id }, opts.map(([v, t]) => h('option', { value: v }, t))));
  const txt = (id, label, extra = {}) => h('div', {}, h('label', { for: id }, label), h('input', { type: 'text', id, ...extra }));
  const btn = (key, text, fn) => { const b = h('button', { type: 'button' }, text); b.addEventListener('click', () => guard(key, async () => { b.disabled = true; try { await fn(); } finally { b.disabled = false; } })); return b; };

  // --- add account
  const acKind = sel('ac-kind', [['bank', 'Bank account'], ['credit', 'Supplier credit account (pump, workshop)']], 'Type'), acName = txt('ac-name', 'Name', { maxlength: 60 }), acMsg = h('p', { role: 'status' });
  const acBtn = btn('ac', 'Add account', async () => {
    const r = accountPayload(campus, acKind.querySelector('select').value, acName.querySelector('input').value);
    if (!r.ok) return say(acMsg, r.error);
    if (await send('account.add', r.data, acMsg, 'Account added.')) { acName.querySelector('input').value = ''; loadConfig(); }
  });
  // --- opening
  const opAcc = h('select', { id: 'op-acc' }), opAmt = txt('op-amt', 'Opening amount (rupees)', { inputmode: 'decimal' }), opMsg = h('p', { role: 'status' });
  const opBtn = btn('op', 'Set opening', async () => {
    const r = accountOpeningPayload(cfg.accounts.find((a) => a.id === opAcc.value), opAmt.querySelector('input').value);
    if (!r.ok) return say(opMsg, r.error);
    if (await send('account.opening', r.data, opMsg, 'Opening saved.')) opAmt.querySelector('input').value = '';
  });
  // --- fund transfer (bank to bank between campuses)
  const ftFrom = h('select', { id: 'ft-from' }), ftTo = h('select', { id: 'ft-to' }), ftMsg = h('p', { role: 'status' });
  const ftAmt = txt('ft-amt', 'Amount (rupees)', { inputmode: 'decimal' }), ftRef = txt('ft-ref', 'Bank reference (UTR or cheque number)', { maxlength: 40 });
  const ftNote = txt('ft-note', 'Narration (optional)', { maxlength: 120 }), ftDate = h('input', { type: 'date', id: 'ft-date', value: todayIst() });
  const ftBtn = btn('ft', 'Record transfer', async () => {
    const acc = (id) => cfg.accounts.find((a) => a.id === id);
    const r = fundTransferPayload(acc(ftFrom.value), acc(ftTo.value), ftAmt.querySelector('input').value, ftDate.value, ftRef.querySelector('input').value, ftNote.querySelector('input').value, todayIst());
    if (!r.ok) return say(ftMsg, r.error);
    if (await send('fund.transfer', r.data, ftMsg, 'Transfer recorded in both day books.')) [ftAmt, ftRef, ftNote].forEach((f) => { f.querySelector('input').value = ''; });
  });
  // --- vehicles
  const vList = h('ul', { class: 'office-list' }), vMsg = h('p', { role: 'status' }), impMsg = h('p', { role: 'status' });
  const vKind = sel('v-kind', Object.entries(KINDS), 'Type'), vReg = txt('v-reg', 'Registration number'), vLabel = txt('v-label', 'Name (for example Innova)');
  const vBtn = btn('v', 'Add vehicle', async () => {
    const r = vehiclePayload(campus, vKind.querySelector('select').value, vReg.querySelector('input').value, vLabel.querySelector('input').value);
    if (!r.ok) return say(vMsg, r.error);
    if (await send('vehicle.add', r.data, vMsg, 'Vehicle added.')) { vReg.querySelector('input').value = ''; vLabel.querySelector('input').value = ''; loadConfig(); }
  });
  const impBtn = btn('imp', 'Import buses from Transport', async () => {
    say(impMsg, 'Loading the bus list…');
    let rows;
    try {
      rows = mapFleet(await fetchFleet((...a) => fetch(...a), COORD_BACKEND_URL, liveToken(window.LMCS, session)));
    } catch (err) { return say(impMsg, err && (err.message === SIGNED_OUT || err.message === NOT_ALLOWED_TRANSPORT) ? err.message : 'Could not load buses: ' + (err && err.message || err)); }
    if (!rows.length) return say(impMsg, 'The Transport list has no buses to import.');
    const before = cfg.vehicles.length;
    if (!await send('vehicles.import', { vehicles: rows }, impMsg, 'Imported.')) return;
    await loadConfig();
    const n = cfg.vehicles.length - before;
    say(impMsg, 'Added ' + n + ' bus' + (n === 1 ? '' : 'es') + (n < rows.length ? ' (' + (rows.length - n) + ' were already listed)' : '') + '.');
  });

  // --- student collections
  const cList = h('ul', { class: 'office-list' }), cMsg = h('p', { role: 'status' }), cName = txt('c-name', 'New collection (for example Yoga camp)', { maxlength: 60 });
  const cBtn = btn('c', 'Add collection', async () => {
    const r = collectionPayload(cName.querySelector('input').value, cfg.collections);
    if (!r.ok) return say(cMsg, r.error);
    if (await send('collection.add', r.data, cMsg, 'Collection added.')) { cName.querySelector('input').value = ''; loadConfig(); }
  });
  function paintCollections() {
    setKids(cList, cfg.collections.length ? cfg.collections.map((c) => {
      const b = h('button', { type: 'button', class: 'secondary' }, c.active ? 'Active — tap to switch off' : 'Switched off — tap to switch on');
      b.addEventListener('click', () => guard('c:' + c.id, async () => {
        b.disabled = true;
        try { if (await send('collection.set_active', { head: c.id, active: !c.active }, cMsg, c.label + (c.active ? ' switched off.' : ' switched on.'))) await loadConfig(); } finally { b.disabled = false; }
      }));
      return h('li', {}, h('b', {}, c.label), ' ', b);
    }) : [h('li', {}, 'No collections yet.')]);
  }

  function paintConfig() {
    const mine = cfg.accounts.filter((a) => a.kind !== 'cash' && a.active && (allCampus || a.campus === campus));
    const banks = () => cfg.accounts.filter((a) => a.kind === 'bank' && a.active).map((a) => h('option', { value: a.id }, a.label + ' (' + a.campus + ')'));
    setKids(ftFrom, banks()); setKids(ftTo, banks());
    setKids(opAcc, mine.map((a) => h('option', { value: a.id }, a.label + ' (' + a.campus + ', ' + a.kind + ')')));
    setKids(vList, cfg.vehicles.length ? cfg.vehicles.filter((v) => allCampus || v.campus === campus).map((v) => h('li', {}, h('b', {}, v.label), ' · ', v.reg, ' · ', v.kind, ' · ', v.campus, v.active ? '' : ' · inactive')) : [h('li', {}, 'No vehicles yet.')]);
    paintCollections();
  }
  async function loadConfig() {
    const r = await api.read('config.get', {}, 'accfg');
    if (r.stale) return;
    if (r.success) { cfg = { categories: r.categories, accounts: r.accounts, vehicles: r.vehicles, campuses: r.campuses, collections: r.collections || [] }; ftForm.hidden = !r.fund_transfer_allowed; paintConfig(); }
    else say(vMsg, 'Could not load accounts and vehicles: ' + (r.error ? explainCode(r.code || r.error) : 'offline'));
  }

  // --- summary
  const per = defaultPeriod(todayIst());
  const fromIn = h('input', { type: 'date', id: 'sm-from', value: per.from }), toIn = h('input', { type: 'date', id: 'sm-to', value: per.to });
  const campPick = h('div', { id: 'sm-campus' }), sumBox = h('div', { role: 'status' });
  let sumSel = { all: true, campuses: [] }; // the summary's own multi-select picker; the header picker stays the forms' campus
  const smBtn = btn('sum', 'Show summary', async () => {
    const from = fromIn.value, to = toIn.value;
    if (!from || !to || from > to) return say(sumBox, 'Choose a start date that is not after the end date.');
    if (!samePeriodYear(from, to)) return say(sumBox, explainCode('RANGE_SPANS_YEARS'));
    say(sumBox, 'Loading…');
    if (!cfg.categories.length) await loadConfig();
    if (!cfg.categories.length) return say(sumBox, 'Still loading the category list — try again in a moment.');
    // ALL (or a non-ALL Accounts user's own scope) is one backend call; picked schools are one call each, shown side by side
    const targets = !allCampus ? [campus] : summaryTargets(session, sumSel, window.LMCSCampus.scope(session, { hes: true }));
    if (!targets.length || !targets[0]) return say(sumBox, 'No campus in your sign-in to show.');
    const rs = await Promise.all(targets.map((c) => api.read('ledger.summary', { campus: c, from, to }, 'acsum:' + c)));
    if (rs.some((r) => r.stale)) return;
    const bad = rs.find((r) => !r.success);
    if (bad) return say(sumBox, 'Could not load the summary: ' + (bad.network ? 'offline or unavailable' : explainCode(bad.code || bad.error)));
    const note = h('p', { class: 'meta' }, 'Period ' + isoToDmy(from) + ' to ' + isoToDmy(to) + '. Balances and amounts owed are as at ' + isoToDmy(to) + '.');
    if (rs.length === 1) return setKids(sumBox, note, summaryView(rs[0], cfg));
    const ov = h('div', {}); ov.innerHTML = summaryOverlay(targets.map((c, i) => [c, rs[i]]), cfg, window.LMCSCampus.overlay);
    setKids(sumBox, note, h('h3', {}, 'Totals by school'), ov, targets.map((c, i) => h('div', {}, h('h2', {}, campusLabelOf(c)), summaryView(rs[i], cfg))));
  });

  const form = (title, ...kids) => h('div', { class: 'office-form' }, h('h3', {}, title), ...kids);
  // Shown only to the Owner and the people in Settings fund_transfer_emails (config.get's fund_transfer_allowed).
  const ftForm = form('Fund transfer (bank to bank)', h('p', { class: 'meta' }, 'Money sent by bank from one school (or HES) to another. Both day books get their entry.'),
    h('label', { for: 'ft-from' }, 'From account'), ftFrom, h('label', { for: 'ft-to' }, 'To account'), ftTo, ftAmt,
    h('label', { for: 'ft-date' }, 'Date'), ftDate, ftRef, ftNote, ftBtn, ftMsg);
  ftForm.hidden = true;
  root.replaceChildren(h('h2', {}, 'Accounts'),
    form('Add a bank or supplier account for ' + campus, acKind, acName, acBtn, acMsg),
    form('Opening balance of a bank or supplier account', h('label', { for: 'op-acc' }, 'Account'), opAcc, opAmt, opBtn, opMsg),
    ftForm,
    form('Vehicles', vList, impBtn, impMsg, h('h4', {}, 'Add a vehicle for ' + campus), vKind, vReg, vLabel, vBtn, vMsg),
    form('Student collections', h('p', { class: 'meta' }, 'Heads you can collect under. A switched-off head is not offered on the Day Book form; its past entries still show in reports.'), cList, cName, cBtn, cMsg),
    form('Summary', h('label', { for: 'sm-from' }, 'From'), fromIn, h('label', { for: 'sm-to' }, 'To'), toIn,
      allCampus ? campPick : null, smBtn, sumBox));
  if (allCampus) window.LMCSCampus.mount(campPick, { session, hes: true, label: 'Summary campuses', onChange: (s) => { sumSel = s; } });
  await loadConfig();
}
