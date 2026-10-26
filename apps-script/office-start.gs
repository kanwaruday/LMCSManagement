// LMCS Office Backend -- Day Book starting data: the figures as at close of OFFICE_START_CUTOFF (counted cash, bank
// balances, suppliers' dues, odometers, vehicle loans, portal users), collected in the portal as six quests.
// Stored in the Config book's StartData tab (private to the Owner), append-only: the latest row per
// (quest, item, field) wins. Status: 'known' only from start.seed, 'confirmed' from a person's save, 'skipped'
// for an optional item a person skipped. Bank accounts keep the last 4 digits only: any 8+ digit run is refused.

var OFFICE_START_CUTOFF = '2026-10-22';
var OFFICE_START_ROLES = ['Owner', 'FinanceHead']; // every quest, every campus
var OFFICE_START_DESK_ROLES = ['FeeClerk', 'AdminManager']; // own campus(es), these quests only
var OFFICE_START_DESK_QUESTS = ['cash', 'odometer'];

// The six quests in play order. Built on first use (it names OFFICE_CAMPUSES, which another file defines: load order).
var OFFICE_START_QUESTS = null;
function officeStartQuests_() {
  if (OFFICE_START_QUESTS) return OFFICE_START_QUESTS;
  const f = function (id, label, type, required, choices) {
    const o = { id: id, label: label, type: type, required: !!required };
    if (choices) o.choices = choices;
    return o;
  };
  return (OFFICE_START_QUESTS = [
    { id: 'cash', label: 'Cash in hand', perCampus: true, optional: false, addable: false, fields: [
      f('amount', 'Cash counted', 'rupees', true), f('held_by', 'Who holds it', 'text', true), f('counted_by', 'Counted by', 'text')] },
    { id: 'bank', label: 'Bank balances', perCampus: false, optional: false, addable: true, fields: [
      f('campus', 'School', 'choice', true, OFFICE_CAMPUSES), f('bank', 'Bank', 'text', true), f('branch', 'Branch', 'text'),
      f('last4', 'Last 4 digits of the account', 'last4', true), f('used_for', 'Used for', 'choice', false, ['fees', 'salary', 'general']),
      f('balance', 'Balance', 'rupees', true)] },
    { id: 'supplier', label: 'Credit suppliers', perCampus: false, optional: false, addable: true, fields: [
      f('name', 'Supplier', 'text', true), f('buys', 'What we buy', 'text', true), f('campuses', 'Schools', 'text'),
      f('owed', 'Owed to them', 'rupees', true), f('settled_by', 'Settled by', 'choice', false, ['accounts', 'school']), f('cadence', 'How often settled', 'text')] },
    { id: 'odometer', label: 'Vehicle odometers', perCampus: false, optional: false, addable: true, fields: [
      f('reg', 'Registration', 'text', true), f('campus', 'School', 'choice', true, OFFICE_CAMPUSES), f('km', 'Odometer (km)', 'km', true),
      f('active', 'In use', 'choice', true, ['yes', 'no'])] },
    { id: 'loan', label: 'Vehicle loans', perCampus: false, optional: true, addable: true, fields: [
      f('reg', 'Registration', 'text', true), f('lender', 'Lender', 'text', true), f('emi', 'EMI', 'rupees', true), f('emi_day', 'EMI day', 'text'),
      f('interest_part', 'Interest in the EMI', 'rupees'), f('principal_outstanding', 'Principal outstanding', 'rupees'), f('last_emi', 'Last EMI', 'date')] },
    { id: 'users', label: 'Portal users', perCampus: false, optional: false, addable: true, fields: [
      f('name', 'Name', 'text', true), f('email', 'Email', 'email', true), f('campus', 'School', 'choice', true, OFFICE_CAMPUSES.concat(['ALL'])),
      f('role', 'Role', 'choice', true, ['Fee Clerk', 'Admin Manager', 'Accounts', 'Accounts + Coordinator']), f('starts', 'Starts on', 'date')] },
  ]);
}

function officeStartActions_() {
  const all = OFFICE_START_ROLES.concat(OFFICE_START_DESK_ROLES);
  return {
    'start.get': { roles: all, write: false, run: officeStartGet_ },
    'start.progress': { roles: all, write: false, run: officeStartProgressGet_ },
    'start.save': { roles: all, write: true, run: officeStartSave_ },
    'start.seed': { roles: ['Owner'], write: true, run: officeStartSeed_ },
    'start.export': { roles: OFFICE_START_ROLES, write: false, run: officeStartExport_ },
  };
}

function officeStartQuest_(id) { return officeStartQuests_().filter(function (q) { return q.id === id; })[0] || null; }

// Error naming the field: code for the client, message 'CODE: field'.
function officeStartErr_(code, field) {
  const e = officeCoded_(code);
  if (field) e.message = code + ': ' + field;
  return e;
}

// What the caller may see: {full, quests[], campuses[]}. Callers reaching here hold a start role (officeHandle_).
function officeStartScope_(caller) {
  const full = OFFICE_START_ROLES.some(function (r) { return caller.roles.indexOf(r) !== -1; });
  if (full) return { full: true, quests: officeStartQuests_().map(function (q) { return q.id; }), campuses: OFFICE_CAMPUSES.concat(['ALL']) };
  const own = caller.campuses.indexOf('ALL') !== -1 ? OFFICE_CAMPUSES : OFFICE_CAMPUSES.filter(function (c) { return caller.campuses.indexOf(c) !== -1; });
  return { full: false, quests: OFFICE_START_DESK_QUESTS, campuses: own };
}

// Validates one value for its field; returns the stored text. '' is allowed here (required is checked per item).
function officeStartValue_(field, v) {
  const s = v === undefined || v === null ? '' : String(v).trim();
  if (/\d{8,}/.test(s)) throw officeStartErr_('ACCOUNT_NUMBER_REFUSED', field.id);
  if (s === '') return '';
  switch (field.type) {
    case 'rupees': {
      if (!/^\d+(\.\d{1,2})?$/.test(s)) throw officeStartErr_('BAD_AMOUNT', field.id);
      const p = Math.round(Number(s) * 100);
      if (!Number.isSafeInteger(p)) throw officeStartErr_('BAD_AMOUNT', field.id);
      return String(p);
    }
    case 'km': if (!/^\d+$/.test(s)) throw officeStartErr_('BAD_KM', field.id); return String(Number(s));
    case 'last4': if (!/^\d{4}$/.test(s)) throw officeStartErr_('BAD_LAST4', field.id); return s;
    case 'email': {
      const e = s.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw officeStartErr_('BAD_EMAIL', field.id);
      if (!/@lms\.org\.in$/.test(e)) throw officeStartErr_('NOT_LMS_EMAIL', field.id);
      return e;
    }
    case 'choice': if (field.choices.indexOf(s) === -1) throw officeStartErr_('BAD_CHOICE', field.id); return s;
    case 'date': if (!officeIsoDate_(s)) throw officeStartErr_('BAD_DATE', field.id); return s;
    default: return s;
  }
}

// Stored text -> the value the client sees: rupees as integer paise and km as numbers, the rest as text.
function officeStartOut_(field, s) {
  if (s === '' || !field) return s;
  return field.type === 'rupees' || field.type === 'km' ? Number(s) : s;
}

// Every item in first-appearance order (cash always has its 7 campuses): [{quest, item, campus, fields: {f: {...}}}].
function officeStartItems_() {
  const out = [], at = {};
  const get = function (quest, item) {
    const k = quest + '|' + item;
    if (at[k] === undefined) { at[k] = out.length; out.push({ quest: quest, item: item, campus: quest === 'cash' ? item : '', fields: {} }); }
    return out[at[k]];
  };
  OFFICE_CAMPUSES.forEach(function (c) { get('cash', c); });
  officeRows_(officeConfigBook_(), 'StartData').forEach(function (r) {
    const q = officeStartQuest_(r.quest);
    if (!q) return;
    const it = get(r.quest, r.item);
    if (r.campus) it.campus = r.campus;
    const fd = q.fields.filter(function (f) { return f.id === r.field; })[0];
    it.fields[r.field] = { value: officeStartOut_(fd, r.value), status: r.status, note: r.note, at: r.at, by: r.by };
  });
  return out;
}

function officeStartVisible_(items, scope) {
  return items.filter(function (i) { return scope.quests.indexOf(i.quest) !== -1 && (scope.full || scope.campuses.indexOf(i.campus) !== -1); });
}

// Counts the required fields of `items`: confirmed (or skipped) and known out of total.
function officeStartCount_(items) {
  const n = { confirmed: 0, known: 0, total: 0 };
  items.forEach(function (i) {
    officeStartQuest_(i.quest).fields.forEach(function (f) {
      if (!f.required) return;
      n.total++;
      const st = i.fields[f.id] && i.fields[f.id].status;
      if (st === 'confirmed' || st === 'skipped') n.confirmed++; else if (st === 'known') n.known++;
    });
  });
  return n;
}

// {progress: {[campus]: {[quest]: counts}}, rings: {[campus]: counts}, overall: {[quest]: counts}}. Items with no single
// school (suppliers, users of ALL) count under 'ALL' (Owner/FinanceHead only). The optional loan quest appears for a
// campus only when it has a loan item, and is never in a ring.
function officeStartProgress_(items, scope) {
  const progress = {}, rings = {}, overall = {};
  const campusQuests = officeStartQuests_().filter(function (q) {
    return scope.quests.indexOf(q.id) !== -1 && !q.optional && (q.perCampus || q.fields.some(function (f) { return f.id === 'campus'; }));
  });
  scope.campuses.forEach(function (c) {
    const here = items.filter(function (i) { return (i.campus || 'ALL') === c; });
    const p = {};
    officeStartQuests_().forEach(function (q) {
      if (scope.quests.indexOf(q.id) === -1) return;
      const mine = here.filter(function (i) { return i.quest === q.id; });
      const always = c === 'ALL' ? !q.optional && campusQuests.indexOf(q) === -1 : campusQuests.indexOf(q) !== -1;
      if (always || mine.length) p[q.id] = officeStartCount_(mine);
    });
    if (!Object.keys(p).length) return;
    progress[c] = p;
    rings[c] = officeStartCount_(here.filter(function (i) { return !officeStartQuest_(i.quest).optional; }));
  });
  officeStartQuests_().forEach(function (q) {
    if (scope.quests.indexOf(q.id) !== -1) overall[q.id] = officeStartCount_(items.filter(function (i) { return i.quest === q.id; }));
  });
  return { progress: progress, rings: rings, overall: overall };
}

function officeStartGet_(ctx) {
  const scope = officeStartScope_(ctx.caller);
  const items = officeStartVisible_(officeStartItems_(), scope);
  return Object.assign({
    cutoff: OFFICE_START_CUTOFF,
    quests: officeStartQuests_().filter(function (q) { return scope.quests.indexOf(q.id) !== -1; }),
    items: items,
  }, officeStartProgress_(items, scope));
}

function officeStartProgressGet_(ctx) {
  const scope = officeStartScope_(ctx.caller);
  return officeStartProgress_(officeStartVisible_(officeStartItems_(), scope), scope);
}

function officeStartItemKey_(quest, item) {
  const k = String(item === undefined || item === null ? '' : item).trim();
  if (/\d{8,}/.test(k)) throw officeStartErr_('ACCOUNT_NUMBER_REFUSED', 'item');
  if (!/^[A-Za-z0-9_:\-]{1,64}$/.test(k) || (quest.id === 'cash' && OFFICE_CAMPUSES.indexOf(k) === -1)) throw officeStartErr_('START_BAD_ITEM', 'item');
  return k;
}

// Campus of an item after a write of `vals` (stored text): cash = the item; a campus field; else the explicit
// campus, the item's current one, or for a loan the campus of the odometer vehicle with the same registration.
function officeStartCampus_(quest, key, vals, prior, explicit, items) {
  if (quest.id === 'cash') return key;
  if (vals.campus !== undefined && vals.campus !== '') return vals.campus;
  if (explicit) return explicit;
  if (prior && prior.campus) return prior.campus;
  if (quest.id === 'loan' && vals.reg) {
    const v = items.filter(function (i) { return i.quest === 'odometer' && i.fields.reg && officeNormReg_(i.fields.reg.value) === officeNormReg_(vals.reg); })[0];
    if (v) return v.campus;
  }
  return '';
}

function officeStartWrite_(ss, quest, key, campus, vals, status, note, caller, iso) {
  const out = [];
  Object.keys(vals).forEach(function (fid) {
    const row = { id: Utilities.getUuid(), quest: quest.id, item: key, campus: campus, field: fid, value: vals[fid], status: status, note: note, at: iso, by: caller.email };
    officeWriteRow_(ss, 'StartData', row);
    out.push(row);
  });
  return out;
}

// Audited like collection.set_active: the Config book has no Audit tab.
function officeStartAudit_(caller, action, rowId, campus, after, iso) {
  officeWriteRow_(officeCollectionAuditBook_(caller), 'Audit', {
    id: Utilities.getUuid(), ts: iso, who: caller.email, action: action, tab: 'StartData', row_id: rowId, campus: campus, after: JSON.stringify(after),
  });
}

// {quest, item, campus?, fields: {f: value}, note?, skip?}. A save is always 'confirmed'; skip (optional quests only)
// marks every field of the item 'skipped'. After the save every required field must have a value (unless skipped).
function officeStartSave_(ctx, data) {
  const quest = officeStartQuest_(String(data.quest || ''));
  if (!quest) throw officeStartErr_('START_BAD_QUEST', 'quest');
  const scope = officeStartScope_(ctx.caller);
  if (scope.quests.indexOf(quest.id) === -1) throw new Error('FORBIDDEN_ROLE');
  const key = officeStartItemKey_(quest, data.item);
  const note = officeStartValue_({ id: 'note', type: 'text' }, data.note);
  const items = officeStartItems_();
  const prior = items.filter(function (i) { return i.quest === quest.id && i.item === key; })[0];
  let vals = {}, status = 'confirmed';
  if (data.skip === true) {
    if (!quest.optional) throw officeStartErr_('START_NOT_OPTIONAL', 'skip');
    quest.fields.forEach(function (f) { vals[f.id] = ''; });
    status = 'skipped';
  } else {
    const fields = data.fields && typeof data.fields === 'object' ? data.fields : {};
    Object.keys(fields).forEach(function (fid) {
      const fd = quest.fields.filter(function (f) { return f.id === fid; })[0];
      if (!fd) throw officeStartErr_('START_UNKNOWN_FIELD', fid);
      vals[fid] = officeStartValue_(fd, fields[fid]);
    });
    quest.fields.forEach(function (f) {
      if (!f.required) return;
      const have = vals[f.id] !== undefined ? vals[f.id] : (prior && prior.fields[f.id] && prior.fields[f.id].status !== 'skipped' ? String(prior.fields[f.id].value) : '');
      if (have === '') throw officeStartErr_('START_FIELD_REQUIRED', f.id);
    });
  }
  const campus = officeStartCampus_(quest, key, vals, prior, data.campus, items);
  if (!scope.full) [campus, prior && prior.campus].forEach(function (c) { if (c !== undefined && scope.campuses.indexOf(c) === -1) throw new Error('FORBIDDEN_CAMPUS'); });
  const iso = officeNow_().toISOString();
  const written = officeStartWrite_(officeConfigBook_(), quest, key, campus, vals, status, note, ctx.caller, iso);
  officeStartAudit_(ctx.caller, 'start.save', quest.id + ':' + key, campus, written, iso);
  const after = officeStartItems_();
  return Object.assign({ saved: after.filter(function (i) { return i.quest === quest.id && i.item === key; })[0] }, officeStartProgress_(officeStartVisible_(after, scope), scope));
}

// Owner: {rows: [{quest, item, campus?, field, value}]}, all validated before any write. Writes 'known' and keeps any
// field a person already confirmed or skipped. Returns {written, kept}.
function officeStartSeed_(ctx, data) {
  if (!Array.isArray(data.rows) || !data.rows.length) throw officeStartErr_('START_NO_ROWS');
  const items = officeStartItems_();
  const plan = data.rows.map(function (r) {
    const quest = officeStartQuest_(String(r && r.quest || ''));
    if (!quest) throw officeStartErr_('START_BAD_QUEST', 'quest');
    const key = officeStartItemKey_(quest, r.item);
    const fd = quest.fields.filter(function (f) { return f.id === r.field; })[0];
    if (!fd) throw officeStartErr_('START_UNKNOWN_FIELD', String(r.field));
    const campus = r.campus === undefined || r.campus === null ? '' : String(r.campus).trim().toUpperCase();
    if (campus && OFFICE_CAMPUSES.indexOf(campus) === -1 && campus !== 'ALL') throw officeStartErr_('BAD_CHOICE', 'campus');
    return { quest: quest, key: key, field: fd.id, value: officeStartValue_(fd, r.value), campus: campus };
  });
  const ss = officeConfigBook_(), iso = officeNow_().toISOString(), out = { written: 0, kept: 0 };
  plan.forEach(function (p) {
    const prior = items.filter(function (i) { return i.quest === p.quest.id && i.item === p.key; })[0];
    const st = prior && prior.fields[p.field] && prior.fields[p.field].status;
    if (st === 'confirmed' || st === 'skipped') { out.kept++; return; }
    const vals = {}; vals[p.field] = p.value;
    // Fields seeded earlier in this call count for the campus (e.g. an odometer's campus row).
    const campus = officeStartCampus_(p.quest, p.key, vals, prior, p.campus, items);
    officeStartWrite_(ss, p.quest, p.key, campus, vals, 'known', '', ctx.caller, iso);
    if (!prior) items.push({ quest: p.quest.id, item: p.key, campus: campus, fields: {} });
    else if (campus) prior.campus = campus;
    out.written++;
  });
  officeStartAudit_(ctx.caller, 'start.seed', '', '', out, iso);
  return out;
}

// FinanceHead/Owner: everything the Day Book starts from. `actual` (confirmed cash only, rupees) is the shape the
// Sheet importer's --actual reads. Each list entry: {item, campus, confirmed, skipped, <field>: value (rupees as rupees)}.
function officeStartExport_() {
  const items = officeStartItems_();
  const out = { cutoff: OFFICE_START_CUTOFF, actual: {}, banks: [], suppliers: [], odometers: [], loans: [], users: [], unconfirmed: {} };
  const list = { bank: 'banks', supplier: 'suppliers', odometer: 'odometers', loan: 'loans', users: 'users' };
  officeStartQuests_().forEach(function (q) { out.unconfirmed[q.id] = 0; });
  items.forEach(function (i) {
    const q = officeStartQuest_(i.quest), n = officeStartCount_([i]);
    const done = n.confirmed === n.total;
    if (!done) out.unconfirmed[q.id]++;
    if (q.id === 'cash') {
      const a = i.fields.amount;
      if (a && a.status === 'confirmed' && a.value !== '') out.actual[i.item] = a.value / 100;
      return;
    }
    const e = { item: i.item, campus: i.campus, confirmed: done, skipped: q.fields.some(function (f) { return i.fields[f.id] && i.fields[f.id].status === 'skipped'; }) };
    q.fields.forEach(function (f) {
      const v = i.fields[f.id] ? i.fields[f.id].value : '';
      e[f.id] = f.type === 'rupees' && v !== '' ? v / 100 : v;
    });
    out[list[q.id]].push(e);
  });
  return out;
}
