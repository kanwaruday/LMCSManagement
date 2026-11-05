var GAME_MODULE_ACTIONS = GAME_MODULE_ACTIONS || {};
var GAME_MODULE_MISSIONS = GAME_MODULE_MISSIONS || {};
var GAME_MODULE_QUESTS = GAME_MODULE_QUESTS || {};

// ═══════════════════════════════════════════════════════════════════
// LMCS Game Backend -- the ERP Sheets' write side: the one-time setup and the Mac's push (the CyberSchoolManager extractor).
// Uday approved the Sheets push (6 Nov, via V1). The read side is game-erp.gs; the contract is erp-read-contract.md, section 7.
//   erpSetupSheets()   run ONCE from the editor by Uday: makes the private Drive folder "ERP Data (private)", one Sheet per campus
//                      ("LMS1 ERP" … "LMS6 ERP", the game reads these) and one "LMSn ERP – sensitive" (never read by the game), and
//                      writes their ids into Script properties ERP_SHEET_LMSn / ERP_SENS_SHEET_LMSn. No id is ever copied by hand.
//                      Idempotent: an id already set (and not trashed), or a file of that name in the folder, is reused.
//   POST erppush       caller-less, gated by Script property ERP_PUSH_SECRET (Uday sets it; the transportpush pattern). Modes:
//                      check (says whether the secret matches, writes nothing), replace (whole tab, in parts through a staging tab
//                      swapped in on the last part, so readers never see half a tab), upsert (by key columns).
// Guards: game Sheets take only the known tabs (never `assignments`, which is filled by hand) and refuse a header naming a
// sensitive column (Aadhaar, PAN, bank, phone, DOB, address, photo, salary…). The sensitive Sheets take any tab, but only while
// Script property ERP_SENS_PUSH is exactly "on" (Uday's own switch). Size limits per call. Logs: counts only.
// ponytail: no script lock (the Mac pushes one call at a time); add LockService if two pushers ever run at once.
// ═══════════════════════════════════════════════════════════════════

var ERP_FOLDER_NAME = 'ERP Data (private)';
var ERP_PUSH_TABS = ['students_now', 'attendance', 'marks_summary', 'dues', 'staff', 'salary_totals', 'last_pushed'];
// the headers erpSetupSheets writes into a new game Sheet (the push may replace them; assignments is only ever set up here)
var ERP_SETUP_HEADERS = {
  students_now: ['enroll_no', 'name', 'class', 'section', 'roll_no', 'house', 'status', 'bus', 'route', 'pickup_point', 'way'],
  dues: ['enroll_no', 'fee_head', 'receivable', 'received', 'concession', 'balance'],
  marks_summary: ['session', 'term', 'exam', 'subject', 'enroll_no', 'max_marks', 'marks'],
  staff: ['emp_code', 'name', 'designation', 'department', 'category', 'status', 'doj'],
  attendance: ['date', 'enroll_no', 'status'],
  assignments: ['emp_code', 'email', 'kind', 'class', 'section', 'subject', 'bus'],
};
// header keys (erpHeadKey_: lower case, no spaces/underscores) a game Sheet never holds
var ERP_DENY_COLS = /aadha|^pan|panno|bank|ifsc|account|mobile|phone|contact|dob|birth|address|income|occupation|photo|image|email|father|mother|guardian|parent/;
var ERP_DENY_PAY = /salary|gross|net|deduction|basic|allowance/; // allowed on salary_totals only (aggregates)
var ERP_MAX_ROWS = 5000, ERP_MAX_COLS = 30, ERP_MAX_CELL = 500, ERP_MAX_PARTS = 200;
var ERP_STAGE_SUFFIX = '__staging';

// ── setup (editor only) ──────────────────────────────────────────────
function erpSetupSheets() {
  const props = PropertiesService.getScriptProperties();
  let folder = null;
  const fid = props.getProperty('ERP_FOLDER_ID');
  if (fid) { try { folder = DriveApp.getFolderById(fid); if (folder.isTrashed()) folder = null; } catch (err) { folder = null; } }
  if (!folder) { folder = DriveApp.createFolder(ERP_FOLDER_NAME); props.setProperty('ERP_FOLDER_ID', folder.getId()); }
  const n = { created: 0, reused: 0 };
  ERP_CAMPUSES.forEach(function (c) {
    const game = erpEnsureBook_(props, folder, 'ERP_SHEET_' + c, c + ' ERP', n);
    Object.keys(ERP_SETUP_HEADERS).forEach(function (t) {
      if (game.getSheetByName(t)) return;
      const sh = game.insertSheet(t);
      sh.getRange(1, 1, 1, ERP_SETUP_HEADERS[t].length).setNumberFormat('@').setValues([ERP_SETUP_HEADERS[t]]);
      sh.setFrozenRows(1);
    });
    const blank = game.getSheetByName('Sheet1');
    if (blank && game.getSheets().length > 1 && blank.getLastRow() === 0) game.deleteSheet(blank);
    erpEnsureBook_(props, folder, 'ERP_SENS_SHEET_' + c, c + ' ERP – sensitive', n);
  });
  console.log('erpSetupSheets: created=' + n.created + ' reused=' + n.reused); // counts only, never an id
  return n;
}

// a Sheet by its Script property, else by name in the folder, else new (private: only its creator, Uday, can open it)
function erpEnsureBook_(props, folder, prop, name, n) {
  const id = props.getProperty(prop);
  if (id) {
    try { if (!DriveApp.getFileById(id).isTrashed()) { n.reused++; return SpreadsheetApp.openById(id); } } catch (err) { /* gone: make or find one */ }
  }
  const found = folder.getFilesByName(name);
  let file = null;
  while (found.hasNext()) { const f = found.next(); if (!f.isTrashed()) { file = f; break; } }
  let book;
  if (file) { book = SpreadsheetApp.openById(file.getId()); n.reused++; }
  else {
    book = SpreadsheetApp.create(name);
    file = DriveApp.getFileById(book.getId());
    file.moveTo(folder);
    n.created++;
  }
  try { file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (err) { /* a domain policy may refuse; it stays as created */ }
  props.setProperty(prop, book.getId());
  return book;
}

// ── push ─────────────────────────────────────────────────────────────
// constant-time, trimmed (a pasted Script property often carries a trailing newline)
function erpPushSecretOk_(given) {
  const secret = String(PropertiesService.getScriptProperties().getProperty('ERP_PUSH_SECRET') || '').trim();
  const g = String(given === null || given === undefined ? '' : given).trim();
  if (!secret) return false;
  let diff = secret.length ^ g.length;
  for (let i = 0; i < Math.max(secret.length, g.length); i++) diff |= (secret.charCodeAt(i) || 0) ^ (g.charCodeAt(i) || 0);
  return diff === 0;
}

function erpPushErr_(error) { return { success: false, error: error }; }

// body -> a checked request {campus, tab, sens, mode, header, rows, key, part, parts} or {error}
function erpPushCheckBody_(b) {
  const campus = String(b.campus || '').trim().toUpperCase(), tab = String(b.tab || '').trim(), sens = b.sensitive === true;
  const mode = String(b.mode || '').trim().toLowerCase();
  if (ERP_CAMPUSES.indexOf(campus) === -1) return { error: 'campus must be LMS1 to LMS6' };
  if (mode !== 'replace' && mode !== 'upsert') return { error: 'mode must be check, replace or upsert' };
  if (sens ? !/^[a-z0-9_]{1,40}$/.test(tab) : ERP_PUSH_TABS.indexOf(tab) === -1) return { error: 'tab not accepted' + (sens ? '' : ': one of ' + ERP_PUSH_TABS.join(', ')) };
  const header = b.header, rows = b.rows;
  if (!Array.isArray(header) || !header.length || header.length > ERP_MAX_COLS) return { error: 'header: 1 to ' + ERP_MAX_COLS + ' columns' };
  const keys = header.map(function (h) { return typeof h === 'string' ? erpHeadKey_(h) : ''; });
  if (keys.some(function (k, i) { return !k || keys.indexOf(k) !== i; })) return { error: 'header: names must be non-empty text and unique' };
  if (!sens) {
    const bad = keys.filter(function (k) { return ERP_DENY_COLS.test(k) || (tab !== 'salary_totals' && ERP_DENY_PAY.test(k)); });
    if (bad.length) return { error: 'header: ' + bad.length + ' column(s) not allowed in the game Sheet (sensitive data goes to the sensitive Sheet)' };
  }
  if (!Array.isArray(rows) || rows.length > ERP_MAX_ROWS) return { error: 'rows: at most ' + ERP_MAX_ROWS + ' per call' };
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!Array.isArray(r) || r.length !== header.length) return { error: 'row ' + (i + 1) + ': expected ' + header.length + ' cells' };
    const cells = [];
    for (let j = 0; j < r.length; j++) {
      const v = r[j];
      if (v !== null && typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') return { error: 'row ' + (i + 1) + ': cells must be text, numbers or empty' };
      const t = v === null ? '' : String(v);
      if (t.length > ERP_MAX_CELL) return { error: 'row ' + (i + 1) + ': a cell is longer than ' + ERP_MAX_CELL + ' characters' };
      cells.push(t);
    }
    out.push(cells);
  }
  const req = { campus: campus, tab: tab, sens: sens, mode: mode, header: header.map(String), keys: keys, rows: out };
  if (mode === 'replace') {
    req.part = b.part === undefined ? 1 : b.part; req.parts = b.parts === undefined ? 1 : b.parts;
    if (!(Number.isInteger(req.parts) && req.parts >= 1 && req.parts <= ERP_MAX_PARTS && Number.isInteger(req.part) && req.part >= 1 && req.part <= req.parts)) return { error: 'part/parts: whole numbers, 1 <= part <= parts <= ' + ERP_MAX_PARTS };
  } else {
    const key = Array.isArray(b.key) ? b.key.map(function (k) { return erpHeadKey_(k); }) : [];
    if (!key.length || key.some(function (k) { return keys.indexOf(k) === -1; })) return { error: 'key: the upsert key columns must be in the header' };
    req.key = key.map(function (k) { return keys.indexOf(k); });
  }
  return req;
}

function erpWriteText_(sh, row, values) {
  if (values.length) sh.getRange(row, 1, values.length, values[0].length).setNumberFormat('@').setValues(values); // text: no date/number guessing
}
function erpSameHeader_(values, keys) {
  const have = (values[0] || []).map(erpHeadKey_);
  return have.length >= keys.length && keys.every(function (k, i) { return have[i] === k; }) && have.slice(keys.length).every(function (k) { return !k; });
}

function erpPush_(body) {
  try {
    const b = body || {};
    if (!erpPushSecretOk_(b.secret)) return erpPushErr_('Not authorized');
    const props = PropertiesService.getScriptProperties();
    if (String(b.mode || '').toLowerCase() === 'check') {
      const set = {};
      ERP_CAMPUSES.forEach(function (c) { set[c] = { game: !!props.getProperty('ERP_SHEET_' + c), sensitive: !!props.getProperty('ERP_SENS_SHEET_' + c) }; });
      return { success: true, pushCode: true, sheets: set, sensitivePush: String(props.getProperty('ERP_SENS_PUSH') || '').trim() === 'on', limits: { rows: ERP_MAX_ROWS, cols: ERP_MAX_COLS, cell: ERP_MAX_CELL, parts: ERP_MAX_PARTS } };
    }
    const req = erpPushCheckBody_(b);
    if (req.error) return erpPushErr_(req.error);
    if (req.sens && String(props.getProperty('ERP_SENS_PUSH') || '').trim() !== 'on') return erpPushErr_('The sensitive push is switched off (Script property ERP_SENS_PUSH). Ask Uday.');
    const id = props.getProperty((req.sens ? 'ERP_SENS_SHEET_' : 'ERP_SHEET_') + req.campus);
    if (!id) return erpPushErr_('No Sheet for ' + req.campus + ' yet: Uday runs erpSetupSheets() once.');
    const book = SpreadsheetApp.openById(id), res = req.mode === 'replace' ? erpReplace_(book, req) : erpUpsert_(book, req);
    if (res.error) return erpPushErr_(res.error);
    console.log('erppush ' + req.mode + ' ' + req.campus + ' ' + (req.sens ? 'sensitive' : req.tab) + ' rows=' + req.rows.length + (res.done ? ' total=' + res.total : '')); // counts only
    return Object.assign({ success: true, campus: req.campus, tab: req.tab, mode: req.mode, written: req.rows.length }, res);
  } catch (err) {
    console.error('erppush failed: ERP_PUSH_FAILED'); // no message: it could carry a Sheet id or a value
    return erpPushErr_('The push failed on the server. Try that call again.');
  }
}

// part 1 starts a fresh staging tab; each later part must be the next one; the last part swaps staging in for the live tab
function erpReplace_(book, req) {
  const stageName = req.tab + ERP_STAGE_SUFFIX, cache = CacheService.getScriptCache(), ck = 'erp_stage_' + (req.sens ? 's_' : '') + req.campus + '_' + req.tab;
  let stage = book.getSheetByName(stageName);
  if (req.part === 1) {
    if (stage) stage.clear(); else stage = book.insertSheet(stageName);
    erpWriteText_(stage, 1, [req.header].concat(req.rows));
  } else {
    if (!stage || String(cache.get(ck) || '') !== String(req.part) || !erpSameHeader_(stage.getRange(1, 1, 1, req.header.length).getValues(), req.keys)) return { error: 'part ' + req.part + ' is out of order or its header changed: start again with part 1' };
    erpWriteText_(stage, stage.getLastRow() + 1, req.rows);
  }
  if (req.part < req.parts) { cache.put(ck, String(req.part + 1), 21600); return { done: false, part: req.part, parts: req.parts }; }
  cache.remove(ck);
  const live = book.getSheetByName(req.tab);
  if (live) book.deleteSheet(live);
  stage.setName(req.tab);
  stage.setFrozenRows(1);
  return { done: true, part: req.part, parts: req.parts, total: stage.getLastRow() - 1 };
}

// rows matched on the key columns are replaced, new ones appended; the tab's header must be the push's header (a new tab takes it)
function erpUpsert_(book, req) {
  let sh = book.getSheetByName(req.tab);
  if (!sh) { sh = book.insertSheet(req.tab); erpWriteText_(sh, 1, [req.header]); sh.setFrozenRows(1); }
  const values = sh.getDataRange().getValues();
  if (!erpSameHeader_(values, req.keys)) return { error: "the tab's header differs from this push's header: replace the tab first" };
  const keyOf = function (r) { return req.key.map(function (i) { return String(r[i] === null || r[i] === undefined ? '' : r[i]).trim(); }).join('\u0001'); };
  const data = values.slice(1).map(function (r) { return r.slice(0, req.header.length).map(erpCell_); }), at = {};
  data.forEach(function (r, i) { at[keyOf(r)] = i; });
  let updated = 0, added = 0;
  req.rows.forEach(function (r) {
    const k = keyOf(r);
    if (Object.prototype.hasOwnProperty.call(at, k)) { data[at[k]] = r; updated++; } else { at[k] = data.length; data.push(r); added++; }
  });
  erpWriteText_(sh, 2, data);
  return { done: true, updated: updated, added: added, total: data.length };
}
