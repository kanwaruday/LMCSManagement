var GAME_MODULE_ACTIONS = GAME_MODULE_ACTIONS || {};
var GAME_MODULE_MISSIONS = GAME_MODULE_MISSIONS || {};
var GAME_MODULE_QUESTS = GAME_MODULE_QUESTS || {};
var CQ_PREFILL = CQ_PREFILL || {};

// Setup quests ("confirm values"): per-item fields pre-filled (known, amber) from our records, confirmed or corrected by a
// person. Store: the append-only `Setup Data` tab in the Game workbook, latest row per (quest, scope, item, field) wins.
// Known values are computed on read by an adapter (CQ_PREFILL[name]); nothing is written until a person saves.
// Identity comes from the verified caller only; this file's top level holds literals and its own registrations.
// ponytail: one script lock for saves (gameWithLock_); the adapter always runs before it.

var CQ_TAB = 'Setup Data';
var CQ_HEADER = ['Quest', 'Scope', 'Item', 'Field', 'Value', 'Status', 'Note', 'At', 'By'];
var CQ_TYPES = ['text', 'choice', 'number', 'time', 'date', 'yesno'];
var CQ_CAMPUSES = ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6', 'HES'];
var CQ_DEFAULT_CAMPUSES = ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6'];
var CQ_MEMO = null; // { key: email + '|' + now.getTime(), views } one request's status

function cqErr_(code, field) { const e = new Error(field ? code + ': ' + field : code); e.code = code; return e; }
function cqFail_(err) { return { success: false, code: (err && err.code) || 'SETUP_ERROR', error: (err && err.message) || 'SETUP_ERROR' }; }
function cqDefaults_() { return {}; }
function cqLower_(s) { return String(s || '').toLowerCase(); }

// ── definitions ──────────────────────────────────────────────────────
function cqValidDef_(id, raw) {
  const bad = function (why) { console.error('setup quest ' + id + ' ignored: ' + why); return null; };
  if (!raw || typeof raw !== 'object') return bad('not an object');
  if (!/^[a-z][a-z0-9_]{0,23}$/.test(String(id))) return bad('bad id');
  if (['self', 'campus', 'network'].indexOf(raw.scope) === -1) return bad('bad scope');
  if (!Array.isArray(raw.roles) || !raw.roles.length || raw.roles.some(function (r) { return typeof r !== 'string' || !r; })) return bad('bad roles');
  if (!Array.isArray(raw.fields) || !raw.fields.length) return bad('no fields');
  const seen = {};
  const fields = [];
  for (let i = 0; i < raw.fields.length; i++) {
    const f = raw.fields[i];
    if (!f || typeof f.id !== 'string' || !/^[a-z][A-Za-z0-9]{0,31}$/.test(f.id) || seen[f.id]) return bad('bad or repeated field id');
    if (CQ_TYPES.indexOf(f.type) === -1) return bad('bad field type');
    if (f.type === 'choice' && (!Array.isArray(f.choices) || !f.choices.length || f.choices.some(function (c) { return typeof c !== 'string'; }))) return bad('choice without choices');
    seen[f.id] = true;
    const out = { id: f.id, label: String(f.label || f.id), type: f.type, required: !!f.required };
    if (f.type === 'choice') out.choices = f.choices.slice();
    if (f.hint) out.hint = String(f.hint);
    fields.push(out);
  }
  if (raw.selfOnly === true && raw.scope !== 'self') return bad('selfOnly needs scope self');
  let campuses = CQ_DEFAULT_CAMPUSES.slice();
  if (raw.campuses !== undefined) {
    // an empty list would leave the quest with no scope at all, so it is refused too
    if (!Array.isArray(raw.campuses) || !raw.campuses.length || raw.campuses.some(function (c) { return CQ_CAMPUSES.indexOf(c) === -1; })) return bad('bad campuses');
    campuses = raw.campuses.slice();
  }
  const title = String(raw.title || id);
  return {
    id: String(id), title: title, task: String(raw.task || title), intro: String(raw.intro || ''), roles: raw.roles.slice(), scope: raw.scope,
    campuses: campuses, prefill: String(raw.prefill || ''), selfOnly: raw.selfOnly === true, addable: raw.addable === true,
    emptyLabel: String(raw.emptyLabel || ''), skipLabel: String(raw.skipLabel || ''), itemTitle: String(raw.itemTitle || '{' + fields[0].id + '}'),
    fields: fields, sample: Array.isArray(raw.sample) ? raw.sample : [], active: raw.active !== false,
  };
}

function cqDefs_(cfg, includeInactive) {
  const base = cqDefaults_(), over = (cfg && cfg.confirmQuests) || {};
  const has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  const ids = Object.keys(base).concat(Object.keys(over).filter(function (k) { return !has(base, k); }));
  const out = [];
  ids.forEach(function (id) {
    const def = cqValidDef_(id, Object.assign({}, has(base, id) ? base[id] : {}, has(over, id) ? over[id] || {} : {}));
    if (def && (def.active || includeInactive)) out.push(def);
  });
  return out;
}

function cqMine_(caller, defs) {
  return defs.filter(function (d) { return d.roles.some(function (r) { return caller.roles.indexOf(r) !== -1; }); });
}

function cqScopes_(caller, def, campusParam) {
  if (def.scope === 'self') return [{ scopeKey: 'self:' + cqLower_(caller.email), campus: null }];
  if (def.scope === 'network') return [{ scopeKey: 'network', campus: null }];
  const vis = gameVisibleCampuses_(caller);
  const one = function (c) { return [{ scopeKey: 'campus:' + c, campus: c }]; };
  if (campusParam) {
    const c = String(campusParam).toUpperCase();
    if (def.campuses.indexOf(c) === -1 || (vis && vis.indexOf(c) === -1)) throw cqErr_('SETUP_BAD_CAMPUS');
    return one(c);
  }
  if (def.campuses.indexOf(caller.campusId) !== -1) return one(caller.campusId);
  return vis === null ? def.campuses.map(function (c) { return one(c)[0]; }) : [];
}

// ── store ────────────────────────────────────────────────────────────
function cqLoadCfg_() { return gameParseConfig_(gameBook_().getSheetByName('Game Config').getDataRange().getValues()); }

function cqRead_() {
  const sh = gameBook_().getSheetByName(CQ_TAB);
  if (!sh) return [];
  const v = sh.getDataRange().getValues(), out = [];
  for (let i = 1; i < v.length; i++) {
    const r = v[i];
    out.push({ quest: String(r[0]), scope: String(r[1]), item: String(r[2]), field: String(r[3]), value: String(r[4] === undefined || r[4] === null ? '' : r[4]), status: String(r[5]), note: String(r[6] || ''), at: String(r[7] || '') });
  }
  return out;
}

function cqStored_(rows, questId, scopeKey) {
  const order = [], byItem = {};
  rows.forEach(function (r) {
    if (r.quest !== questId || r.scope !== scopeKey) return;
    if (!byItem[r.item]) { byItem[r.item] = {}; order.push(r.item); }
    byItem[r.item][r.field] = { value: r.value, status: r.status, at: r.at };
  });
  return { order: order, byItem: byItem };
}

function cqEnsureTab_(book) {
  let sh = book.getSheetByName(CQ_TAB);
  if (!sh) { sh = book.insertSheet(CQ_TAB); gameAppendText_(sh, [CQ_HEADER]); }
  return sh;
}

// ── values ───────────────────────────────────────────────────────────
function cqItemKey_(k) {
  const s = String(k === undefined || k === null ? '' : k);
  if (!/^[A-Za-z0-9_:\-]{1,64}$/.test(s) || /\d{8,}/.test(s)) throw cqErr_('SETUP_BAD_ITEM');
  return s;
}

function cqValue_(field, v) {
  if (v === '' || v === null || v === undefined) return '';
  const s = String(v).trim();
  if (s === '') return '';
  const badv = function () { return cqErr_('SETUP_BAD_VALUE', field.id); };
  let m;
  switch (field.type) {
    case 'text':
      if (s.length > 200) throw badv();
      if (/\d{8,}/.test(s)) throw cqErr_('SETUP_NUMBER_REFUSED', field.id);
      return s;
    case 'choice':
      if ((field.choices || []).indexOf(s) === -1) throw badv();
      return s;
    case 'number':
      if (!/^\d{1,6}$/.test(s)) throw badv();
      return String(Number(s));
    case 'time':
      m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(s);
      if (!m) throw badv();
      return ('0' + m[1]).slice(-2) + ':' + m[2];
    case 'date': {
      m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(s);
      const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
      if (!m || d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) throw badv();
      return s;
    }
    case 'yesno':
      if (s !== 'yes' && s !== 'no') throw badv();
      return s;
  }
  throw badv();
}

// view-as and selfOnly refusals: before anything is read. def may be null (no quest chosen yet).
function cqRefuse_(def, p) {
  const has = function (k) { return p[k] !== undefined && p[k] !== null && p[k] !== ''; };
  if (has('viewAs') || has('viewAsCode')) throw cqErr_('SETUP_NO_VIEW_AS');
  if (def && def.selfOnly && ['email', 'code', 'employeeCode', 'scope'].some(has)) throw cqErr_('SETUP_SELF_ONLY');
}

// ── engine ───────────────────────────────────────────────────────────
function cqKnown_(def, ctx, opts) {
  if (!def.prefill) return { items: [], down: false };
  const fn = Object.prototype.hasOwnProperty.call(CQ_PREFILL, def.prefill) ? CQ_PREFILL[def.prefill] : null;
  if (typeof fn !== 'function') return { items: [], down: true };
  let rows;
  try { rows = fn(ctx, opts || {}); } catch (err) { rows = null; }
  if (!Array.isArray(rows)) return { items: [], down: true };
  const ids = def.fields.map(function (f) { return f.id; }), items = [];
  rows.forEach(function (r) {
    if (!r) return;
    try { cqItemKey_(r.item); } catch (err) { return; }
    const fields = {};
    Object.keys(r.fields || {}).forEach(function (k) { if (ids.indexOf(k) !== -1) fields[k] = String(r.fields[k] === null || r.fields[k] === undefined ? '' : r.fields[k]).trim(); });
    items.push({ item: String(r.item), fields: fields });
  });
  return { items: items, down: false };
}

function cqMerge_(def, known, stored) {
  const ids = def.fields.map(function (f) { return f.id; }), out = [], at = {};
  const get = function (key) {
    if (!at[key]) { at[key] = { item: key, fields: {} }; out.push(at[key]); }
    return at[key];
  };
  known.items.forEach(function (k) {
    const it = get(k.item);
    Object.keys(k.fields).forEach(function (f) { if (k.fields[f] !== '') it.fields[f] = { value: k.fields[f], status: 'known' }; });
  });
  stored.order.forEach(function (key) {
    const it = get(key), sf = stored.byItem[key];
    Object.keys(sf).forEach(function (f) {
      if (ids.indexOf(f) === -1 || (sf[f].status !== 'confirmed' && sf[f].status !== 'skipped')) return;
      it.fields[f] = { value: String(sf[f].value), status: sf[f].status, at: sf[f].at };
    });
  });
  return out;
}

function cqItemDone_(def, item) {
  return def.fields.every(function (f) {
    if (!f.required) return true;
    const c = item.fields[f.id];
    return !!c && (c.status === 'confirmed' || c.status === 'skipped');
  });
}

function cqCount_(def, items) {
  let confirmed = 0, known = 0, total = 0;
  items.forEach(function (it) {
    def.fields.forEach(function (f) {
      if (!f.required) return;
      total++;
      const c = it.fields[f.id];
      if (c && (c.status === 'confirmed' || c.status === 'skipped')) confirmed++;
      else if (c && c.status === 'known') known++;
    });
  });
  return { confirmed: confirmed, known: known, total: total, done: total > 0 && confirmed === total };
}

function cqShape_(def, scope, items, extra) {
  const real = items.filter(function (it) { return it.item !== '_none'; });
  return Object.assign({
    id: def.id, title: def.title, task: def.task, intro: def.intro, scope: def.scope, campus: scope.campus, selfOnly: def.selfOnly, addable: def.addable,
    emptyLabel: def.emptyLabel, skipLabel: def.skipLabel, itemTitle: def.itemTitle, fields: JSON.parse(JSON.stringify(def.fields)), draft: false,
    items: items, ring: cqCount_(def, items),
    itemsDone: real.filter(function (it) { return cqItemDone_(def, it); }).length, itemsTotal: real.length, prefillDown: false,
  }, extra || {});
}

function cqView_(caller, def, scope, rows, opts) {
  const known = cqKnown_(def, { caller: caller, campus: scope.campus, def: def }, { cacheOnly: !!(opts && opts.cacheOnly), selfOnly: def.selfOnly });
  const items = cqMerge_(def, known, cqStored_(rows, def.id, scope.scopeKey));
  return cqShape_(def, scope, items, { prefillDown: known.down });
}

function cqStatus_(caller, cfg, now, opts) {
  const key = cqLower_(caller.email) + '|' + now.getTime();
  if (CQ_MEMO && CQ_MEMO.key === key) return CQ_MEMO.views;
  const defs = cqMine_(caller, cqDefs_(cfg));
  const views = [];
  if (defs.length) {
    const rows = cqRead_();
    defs.forEach(function (def) { cqScopes_(caller, def, null).forEach(function (sc) { views.push(cqView_(caller, def, sc, rows, opts)); }); });
  }
  CQ_MEMO = { key: key, views: views };
  return views;
}

// placeholders only: no adapter, no stored rows
function cqSample_(caller, cfg, role) {
  return cqDefs_(cfg, true).filter(function (d) { return d.roles.indexOf(role) !== -1; }).map(function (def) {
    const items = def.sample.map(function (s) {
      const fields = {};
      Object.keys((s && s.fields) || {}).forEach(function (k) {
        const v = String(s.fields[k] === null || s.fields[k] === undefined ? '' : s.fields[k]).trim();
        if (v !== '' && def.fields.some(function (f) { return f.id === k; })) fields[k] = { value: v, status: 'known' };
      });
      return { item: String((s && s.item) || ''), fields: fields };
    });
    return cqShape_(def, { scopeKey: null, campus: null }, items, { draft: !def.active });
  });
}

// ── actions ──────────────────────────────────────────────────────────
function cqGetAction_(caller, p) {
  try {
    p = p || {};
    cqRefuse_(null, p);
    const cfg = cqLoadCfg_();
    if (p.sample === '1' || p.sample === true) {
      if (caller.roles.indexOf('Owner') === -1) throw cqErr_('SETUP_SAMPLE_OWNER_ONLY');
      return { success: true, sample: true, quests: cqSample_(caller, cfg, String(p.role || '')) };
    }
    if (!p.quest) return { success: true, sample: false, quests: cqStatus_(caller, cfg, gameNow_(), {}) };
    const def = cqMine_(caller, cqDefs_(cfg)).filter(function (d) { return d.id === p.quest; })[0];
    if (!def) throw cqErr_('SETUP_NOT_YOURS');
    cqRefuse_(def, p);
    const scopes = cqScopes_(caller, def, p.campus);
    const rows = cqRead_();
    return { success: true, sample: false, quests: scopes.map(function (sc) { return cqView_(caller, def, sc, rows, {}); }) };
  } catch (err) { return cqFail_(err); }
}

function cqSaveAction_(caller, p) {
  try {
    p = p || {};
    if (p.sample) throw cqErr_('SETUP_SAMPLE_READ_ONLY');
    cqRefuse_(null, p);
    const cfg = cqLoadCfg_();
    const def = cqMine_(caller, cqDefs_(cfg)).filter(function (d) { return d.id === p.quest; })[0];
    if (!def) throw cqErr_('SETUP_NOT_YOURS');
    cqRefuse_(def, p);
    const scopes = cqScopes_(caller, def, p.campus);
    if (scopes.length !== 1) throw cqErr_('SETUP_BAD_CAMPUS');
    const scope = scopes[0], item = cqItemKey_(p.item);
    const view = cqView_(caller, def, scope, cqRead_(), {}); // adapter runs here, outside the lock
    const cur = view.items.filter(function (it) { return it.item === item; })[0] || null;
    const wrote = []; // [fieldId, value, status]
    if (item === '_none') {
      if (!def.emptyLabel) throw cqErr_('SETUP_NO_NONE');
      if (p.skip !== true) throw cqErr_('SETUP_BAD_ITEM');
      def.fields.forEach(function (f) { wrote.push([f.id, '', 'skipped']); });
    } else if (p.skip === true) {
      if (!def.skipLabel) throw cqErr_('SETUP_NO_SKIP');
      if (!cur) throw cqErr_('SETUP_BAD_ITEM');
      def.fields.forEach(function (f) { wrote.push([f.id, '', 'skipped']); });
    } else {
      if (!cur && !def.addable) throw cqErr_('SETUP_BAD_ITEM');
      const sent = {}, given = p.fields && typeof p.fields === 'object' ? p.fields : {};
      Object.keys(given).forEach(function (k) {
        const f = def.fields.filter(function (x) { return x.id === k; })[0];
        if (!f) throw cqErr_('SETUP_UNKNOWN_FIELD', k);
        sent[k] = cqValue_(f, given[k]);
      });
      def.fields.forEach(function (f) {
        const c = cur && cur.fields[f.id];
        const have = Object.prototype.hasOwnProperty.call(sent, f.id) ? sent[f.id] : (c && c.status !== 'skipped' ? c.value : '');
        if (f.required && !have) throw cqErr_('SETUP_FIELD_REQUIRED', f.id);
        if (Object.prototype.hasOwnProperty.call(sent, f.id)) wrote.push([f.id, sent[f.id], 'confirmed']);
        else if (f.required && c && c.status === 'known') wrote.push([f.id, c.value, 'confirmed']);
      });
    }
    const note = cqValue_({ id: 'note', type: 'text' }, p.note);
    const now = gameNow_(), by = cqLower_(caller.email);
    const rowsOut = wrote.map(function (w) { return [def.id, scope.scopeKey, item, w[0], w[1], w[2], note, now.toISOString(), by]; });
    let locked = false;
    try {
      gameWithLock_(function () { locked = true; gameAppendText_(cqEnsureTab_(gameBook_()), rowsOut); });
    } catch (err) {
      if (locked) throw err;
      throw cqErr_('SETUP_BUSY');
    }
    CQ_MEMO = null;
    const fresh = cqView_(caller, def, scope, cqRead_(), {});
    return { success: true, saved: fresh.items.filter(function (it) { return it.item === item; })[0], ring: fresh.ring, itemsDone: fresh.itemsDone, itemsTotal: fresh.itemsTotal };
  } catch (err) { return cqFail_(err); }
}

// ── registration (this file's own functions only) ────────────────────
GAME_MODULE_ACTIONS.setupget = cqGetAction_;
GAME_MODULE_ACTIONS.setupsave = cqSaveAction_;
