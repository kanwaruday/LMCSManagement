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
    root.replaceChildren(h('h2', {}, 'Accounts'), h('p', {}, 'Accounts is not available for your role. Ask the Finance Head or Owner.'));
    return;
  }
  const guard = inflightGuard();
  const campus = session.campus;
  const allCampus = session.campusId === 'ALL' || hasRole(session, ['Accounts']);
  let cfg = { categories: [], accounts: [], vehicles: [], campuses: [] };
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

  function paintConfig() {
    const mine = cfg.accounts.filter((a) => a.kind !== 'cash' && a.active && (allCampus || a.campus === campus));
    setKids(opAcc, mine.map((a) => h('option', { value: a.id }, a.label + ' (' + a.campus + ', ' + a.kind + ')')));
    setKids(vList, cfg.vehicles.length ? cfg.vehicles.filter((v) => allCampus || v.campus === campus).map((v) => h('li', {}, h('b', {}, v.label), ' · ', v.reg, ' · ', v.kind, ' · ', v.campus, v.active ? '' : ' · inactive')) : [h('li', {}, 'No vehicles yet.')]);
    paintCampusPick();
  }
  async function loadConfig() {
    const r = await api.read('config.get', {}, 'accfg');
    if (r.stale) return;
    if (r.success) { cfg = { categories: r.categories, accounts: r.accounts, vehicles: r.vehicles, campuses: r.campuses }; paintConfig(); }
    else say(vMsg, 'Could not load accounts and vehicles: ' + (r.error ? explainCode(r.code || r.error) : 'offline'));
  }

  // --- summary
  const per = defaultPeriod(todayIst());
  const fromIn = h('input', { type: 'date', id: 'sm-from', value: per.from }), toIn = h('input', { type: 'date', id: 'sm-to', value: per.to });
  const campPick = h('select', { id: 'sm-campus' }), sumBox = h('div', { role: 'status' });
  function paintCampusPick() {
    if (!allCampus) return;
    const cur = campPick.value || 'ALL';
    setKids(campPick, ['ALL', ...(cfg.campuses.length ? cfg.campuses : [])].map((c) => h('option', { value: c }, c)));
    campPick.value = [...campPick.options].some((o) => o.value === cur) ? cur : 'ALL';
  }
  const smBtn = btn('sum', 'Show summary', async () => {
    const from = fromIn.value, to = toIn.value;
    if (!from || !to || from > to) return say(sumBox, 'Choose a start date that is not after the end date.');
    if (!samePeriodYear(from, to)) return say(sumBox, explainCode('RANGE_SPANS_YEARS'));
    say(sumBox, 'Loading…');
    if (!cfg.categories.length) await loadConfig();
    if (!cfg.categories.length) return say(sumBox, 'Still loading the category list — try again in a moment.');
    const r = await api.read('ledger.summary', { campus: allCampus ? (campPick.value || 'ALL') : campus, from, to }, 'acsum');
    if (r.stale) return;
    if (!r.success) return say(sumBox, 'Could not load the summary: ' + (r.network ? 'offline or unavailable' : explainCode(r.code || r.error)));
    setKids(sumBox, h('p', { class: 'meta' }, 'Period ' + isoToDmy(from) + ' to ' + isoToDmy(to) + '. Balances and amounts owed are as at ' + isoToDmy(to) + '.'), summaryView(r, cfg));
  });

  const form = (title, ...kids) => h('div', { class: 'office-form' }, h('h3', {}, title), ...kids);
  root.replaceChildren(h('h2', {}, 'Accounts'),
    form('Add a bank or supplier account for ' + campus, acKind, acName, acBtn, acMsg),
    form('Opening balance of a bank or supplier account', h('label', { for: 'op-acc' }, 'Account'), opAcc, opAmt, opBtn, opMsg),
    form('Vehicles', vList, impBtn, impMsg, h('h4', {}, 'Add a vehicle for ' + campus), vKind, vReg, vLabel, vBtn, vMsg),
    form('Summary', h('label', { for: 'sm-from' }, 'From'), fromIn, h('label', { for: 'sm-to' }, 'To'), toIn,
      allCampus ? [h('label', { for: 'sm-campus' }, 'Campus'), campPick] : null, smBtn, sumBox));
  await loadConfig();
}
