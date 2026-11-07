// node tests/game/test-game-erp-sheets.js -- the ERP Sheets' setup and push (game-erp-sheets.gs). In-memory Drive/Sheets fakes, synthetic rows only.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const dir = __dirname + '/../../apps-script/';
const logs = [];
const ctx = { console: { log: (m) => logs.push(String(m)), error: (m) => logs.push(String(m)), warn: (m) => logs.push(String(m)) } };
vm.createContext(ctx);
['game-erp.gs', 'game-erp-sheets.gs'].forEach((f) => vm.runInContext(fs.readFileSync(dir + f, 'utf8'), ctx));
const J = (x) => JSON.parse(JSON.stringify(x));

// ---- fakes: a sheet is a 2-D array of cells; Drive keeps files by id with a parent folder
let seq = 0, books = {}, files = {}, folders = {}, props = {}, cache = {}, failOpen = false;
const sheetOf = (name) => {
  const sh = { name, data: [], frozen: 0 };
  Object.assign(sh, {
    getName: () => sh.name, setName: (n) => { sh.name = n; return sh; }, setFrozenRows: (n) => { sh.frozen = n; }, clear: () => { sh.data = []; return sh; },
    getLastRow: () => sh.data.length,
    getDataRange: () => ({ getValues: () => (sh.data.length ? J(sh.data) : [['']]) }),
    getRange: (r, c, nr, nc) => ({
      setNumberFormat() { return this; },
      setValues(v) { assert.strictEqual(v.length, nr); v.forEach((row, i) => { assert.strictEqual(row.length, nc); sh.data[r - 1 + i] = row.map(String); }); return this; },
      getValues: () => sh.data.slice(r - 1, r - 1 + nr).map((row) => row.slice(c - 1, c - 1 + nc)),
    }),
  });
  return sh;
};
const bookOf = (name) => {
  const id = 'book' + ++seq, b = { id, name, sheets: [sheetOf('Sheet1')] };
  Object.assign(b, {
    getId: () => id, getSheets: () => b.sheets, getSheetByName: (n) => b.sheets.find((s) => s.name === n) || null,
    insertSheet: (n) => { const s = sheetOf(n); b.sheets.push(s); return s; }, deleteSheet: (s) => { b.sheets = b.sheets.filter((x) => x !== s); },
  });
  books[id] = b; files[id] = { id, name, parent: null, trashed: false, sharing: null };
  return b;
};
const fileApi = (f) => ({ getId: () => f.id, isTrashed: () => f.trashed, moveTo: (folder) => { f.parent = folder.getId(); }, setSharing: (a, p) => { f.sharing = a + '/' + p; } });
const folderApi = (fo) => ({
  getId: () => fo.id, isTrashed: () => fo.trashed,
  getFilesByName: (n) => { const list = Object.values(files).filter((f) => f.parent === fo.id && f.name === n); let i = 0; return { hasNext: () => i < list.length, next: () => fileApi(list[i++]) }; },
});
ctx.SpreadsheetApp = { create: (n) => bookOf(n), openById: (id) => { if (failOpen) throw new Error('Document ' + id + ' failed'); if (!books[id]) throw new Error('no book'); return books[id]; } };
ctx.DriveApp = {
  Access: { PRIVATE: 'PRIVATE' }, Permission: { NONE: 'NONE' },
  createFolder: (n) => { const id = 'folder' + ++seq; folders[id] = { id, name: n, trashed: false }; return folderApi(folders[id]); },
  getFolderById: (id) => { if (!folders[id]) throw new Error('no folder'); return folderApi(folders[id]); },
  getFileById: (id) => { if (!files[id]) throw new Error('no file'); return fileApi(files[id]); },
};
ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; } }) };
ctx.CacheService = { getScriptCache: () => ({ get: (k) => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; }, remove: (k) => { delete cache[k]; } }) };

// ---- setup: one folder, 12 private Sheets, ids straight into Script properties, contract tabs with headers; idempotent
let n = J(ctx.erpSetupSheets());
assert.deepStrictEqual(n, { created: 12, reused: 0 });
assert.strictEqual(Object.keys(folders).length, 1);
assert.strictEqual(Object.values(folders)[0].name, 'ERP Data (private)');
['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6'].forEach((c) => {
  const g = books[props['ERP_SHEET_' + c]], s = books[props['ERP_SENS_SHEET_' + c]];
  assert.strictEqual(g.name, c + ' ERP'); assert.strictEqual(s.name, c + ' ERP – sensitive');
  assert.deepStrictEqual(g.sheets.map((x) => x.name), ['students_now', 'dues', 'marks_summary', 'staff', 'attendance', 'assignments']);
  assert.deepStrictEqual(J(g.getSheetByName('assignments').data), [['emp_code', 'email', 'kind', 'class', 'section', 'subject', 'bus']]);
  [g, s].forEach((b) => { assert.strictEqual(files[b.id].parent, props.ERP_FOLDER_ID); assert.strictEqual(files[b.id].sharing, 'PRIVATE/NONE'); });
});
assert.ok(logs.every((l) => !/book\d|folder\d/.test(l)), 'no id in a log');
n = J(ctx.erpSetupSheets());
assert.deepStrictEqual(n, { created: 0, reused: 12 });
// a lost property finds the Sheet by name in the folder; a trashed Sheet is replaced
const lost = props.ERP_SHEET_LMS2; delete props.ERP_SHEET_LMS2;
files[props.ERP_SHEET_LMS3].trashed = true;
n = J(ctx.erpSetupSheets());
assert.deepStrictEqual(n, { created: 1, reused: 11 });
assert.strictEqual(props.ERP_SHEET_LMS2, lost);
// setup never touches pushed data
books[props.ERP_SHEET_LMS1].getSheetByName('students_now').data.push(['E1', 'x']);
ctx.erpSetupSheets();
assert.strictEqual(books[props.ERP_SHEET_LMS1].getSheetByName('students_now').data.length, 2);

// ---- push: the secret gates everything
const push = (b) => J(ctx.erpPush_(Object.assign({ secret: 'test-secret' }, b)));
const book4 = () => books[props.ERP_SHEET_LMS4];
assert.strictEqual(push({ mode: 'check' }).error, 'Not authorized', 'no secret set = nobody');
props.ERP_PUSH_SECRET = 'test-secret\n';
assert.strictEqual(J(ctx.erpPush_({ secret: 'wrong', mode: 'check' })).error, 'Not authorized');
assert.strictEqual(J(ctx.erpPush_({ mode: 'check' })).error, 'Not authorized');
let r = push({ mode: 'check' });
assert.strictEqual(r.success, true); assert.strictEqual(r.sheets.LMS4.game, true); assert.strictEqual(r.sensitivePush, false);

// ---- replace in parts: readers see the old tab until the last part swaps staging in
const H = ['enroll_no', 'name', 'class', 'section', 'roll_no', 'house', 'status', 'bus', 'route', 'pickup_point', 'way'];
const row = (i) => ['E' + i, 'Test Student ' + i, '7', 'A', String(i), 'Red', 'Active', 'TEST01', 'R1', 'Stop', 'Both'];
r = push({ campus: 'LMS4', tab: 'students_now', mode: 'replace', header: H, rows: [row(1), row(2)], part: 1, parts: 2 });
assert.deepStrictEqual([r.success, r.done, r.written], [true, false, 2]);
assert.strictEqual(book4().getSheetByName('students_now').data.length, 1, 'live tab untouched mid-push');
assert.ok(/out of order/.test(push({ campus: 'LMS4', tab: 'students_now', mode: 'replace', header: H, rows: [row(9)], part: 3, parts: 3 }).error));
r = push({ campus: 'LMS4', tab: 'students_now', mode: 'replace', header: H, rows: [row(3)], part: 2, parts: 2 });
assert.deepStrictEqual([r.done, r.total], [true, 3]);
assert.strictEqual(book4().getSheetByName('students_now__staging'), null);
assert.deepStrictEqual(J(book4().getSheetByName('students_now').data).map((x) => x[0]), ['enroll_no', 'E1', 'E2', 'E3']);
// a stray later part after the swap is refused
assert.ok(/start again/.test(push({ campus: 'LMS4', tab: 'students_now', mode: 'replace', header: H, rows: [row(4)], part: 2, parts: 2 }).error));
// single-call replace (part/parts default 1); and the read side reads what was pushed
r = push({ campus: 'LMS4', tab: 'students_now', mode: 'replace', header: H, rows: [row(5), row(6)] });
assert.strictEqual(r.total, 2);
const read = J(ctx.erpRead_({ email: 'p@test.invalid', campusId: 'LMS4', roles: ['Principal'] }, { what: 'students' }));
assert.deepStrictEqual(read.rows.map((s) => s.enrollNo), ['E5', 'E6']);

// ---- upsert by key: updates matched rows, appends new ones; header must match
const DH = ['enroll_no', 'fee_head', 'receivable', 'received', 'concession', 'balance'];
r = push({ campus: 'LMS4', tab: 'dues', mode: 'upsert', key: ['enroll_no', 'fee_head'], header: DH, rows: [['E5', 'Tuition', 100, 0, 0, 100], ['E6', 'Tuition', 100, 50, 0, 50]] });
assert.deepStrictEqual([r.added, r.updated, r.total], [2, 0, 2]);
r = push({ campus: 'LMS4', tab: 'dues', mode: 'upsert', key: ['Enroll No', 'Fee Head'], header: DH, rows: [['E5', 'Tuition', 100, 100, 0, 0], ['E5', 'Transport', 30, 0, 0, 30]] });
assert.deepStrictEqual([r.added, r.updated, r.total], [1, 1, 3]);
assert.deepStrictEqual(J(book4().getSheetByName('dues').data).slice(1).map((x) => x.join('|')), ['E5|Tuition|100|100|0|0', 'E6|Tuition|100|50|0|50', 'E5|Transport|30|0|0|30']);
assert.ok(/header differs/.test(push({ campus: 'LMS4', tab: 'dues', mode: 'upsert', key: ['enroll_no'], header: ['enroll_no', 'balance'], rows: [] }).error));
assert.ok(/key/.test(push({ campus: 'LMS4', tab: 'dues', mode: 'upsert', key: ['nope'], header: DH, rows: [] }).error));

// ---- guards: tabs, sensitive columns, sizes, shapes
const bad = (b) => { const x = push(Object.assign({ campus: 'LMS4', tab: 'students_now', mode: 'replace', header: H, rows: [] }, b)); assert.strictEqual(x.success, false, JSON.stringify(b).slice(0, 80)); return x.error; };
bad({ tab: 'Students' }); bad({ campus: 'LMS9' }); bad({ campus: 'HES' }); bad({ mode: 'append' });
['aadhaar', 'Aadhar No', 'Adhar No', 'adhaar', 'UID', 'uid_no', 'PAN', 'pan_no', 'bank_account', 'IFSC', 'mobile', 'father_phone', 'DOB', 'date_of_birth', 'address', 'photo', 'image_ref', 'email', 'parent_name',
  'caste', 'Religion', 'blood_group', 'medical_notes', 'health', 'disability', 'salary', 'gross', 'net_pay', 'deduction'].forEach((c) => {
  assert.ok(/not allowed/.test(bad({ header: H.concat([c]), rows: [] })), c);
});
// salary_totals never goes to a game Sheet (per-person pay could hide in it); the sensitive Sheet takes it (below)
assert.ok(/tab not accepted/.test(bad({ tab: 'salary_totals', header: ['month', 'staff_count', 'gross', 'net'], rows: [] })));
assert.strictEqual(push({ campus: 'LMS4', tab: 'staff', mode: 'replace', header: ['emp_code', 'name', 'category', 'house'], rows: [['T1', 'Test Teacher', 'Teaching', 'Red']] }).success, true, 'category and house pass');
// a value starting with '=' is stored quoted, never as a formula
push({ campus: 'LMS4', tab: 'last_pushed', mode: 'replace', header: ['tab', 'count'], rows: [['=HYPERLINK("x")', 1]] });
assert.strictEqual(book4().getSheetByName('last_pushed').data[1][0], "'=HYPERLINK(\"x\")");
bad({ header: [] }); bad({ header: ['a', 'A'] }); bad({ header: ['a', ''] }); bad({ header: Array.from({ length: 31 }, (_, i) => 'c' + i) });
bad({ rows: Array.from({ length: 5001 }, (_, i) => row(i)) });
bad({ rows: [['E1']] }); bad({ rows: [row(1).slice(0, -1).concat([{ x: 1 }])] }); bad({ rows: [row(1).slice(0, -1).concat(['x'.repeat(501)])] });
bad({ part: 0, parts: 1 }); bad({ part: 2, parts: 1 }); bad({ part: 1, parts: 201 }); bad({ part: '1', parts: 1 });
assert.strictEqual(push({ campus: 'LMS4', tab: 'students_now', mode: 'replace', header: H, rows: [row(7).slice(0, -1).concat([null])] }).success, true, 'null cells are empty');

// ---- the sensitive Sheet: only while ERP_SENS_PUSH is exactly "on"; any tab name; never the game Sheet
// assignments: seeded once from the timetables; a filled tab (Principals' fixes) is replaced only with overwrite: true
const AH = ['emp_code', 'kind', 'class', 'section', 'subject', 'bus', 'teacher', 'fix'];
const seed = (extra) => push(Object.assign({ campus: 'LMS4', tab: 'assignments', mode: 'replace', header: AH, rows: [['T1', 'subject', 'X', '', 'Maths', '', 'Test Teacher 1', '']] }, extra));
r = seed();
assert.strictEqual(r.success, true, JSON.stringify(r));
assert.deepStrictEqual(J(book4().getSheetByName('assignments').data[1]), ['T1', 'subject', 'X', '', 'Maths', '', 'Test Teacher 1', '']);
r = seed();
assert.strictEqual(r.success, false); assert.ok(/overwrite: true/.test(r.error), r.error);
assert.strictEqual(book4().getSheetByName('assignments').data.length, 2, 'refused push left the tab as it was');
r = seed({ overwrite: true, rows: [['T2', 'class', 'IX', '', '', '', 'Test Teacher 2', '']] });
assert.strictEqual(r.success, true); assert.strictEqual(book4().getSheetByName('assignments').data[1][0], 'T2');
assert.strictEqual(push({ campus: 'LMS4', tab: 'assignments', mode: 'replace', header: ['emp_code', 'email'], rows: [], overwrite: true }).success, false, 'no email column in a pushed assignments tab');

const S = { campus: 'LMS4', sensitive: true, tab: 'students_full', mode: 'replace', header: ['enroll_no', 'aadhaar'], rows: [['E1', '000000000000']] };
assert.ok(/switched off/.test(push(S).error));
props.ERP_SENS_PUSH = 'yes'; assert.ok(/switched off/.test(push(S).error));
props.ERP_SENS_PUSH = 'on';
assert.strictEqual(push(S).success, true);
assert.ok(books[props.ERP_SENS_SHEET_LMS4].getSheetByName('students_full'));
assert.strictEqual(book4().getSheetByName('students_full'), null);
assert.ok(push(Object.assign({}, S, { tab: 'Bad Name!' })).error);
assert.strictEqual(push({ mode: 'check' }).sensitivePush, true);
assert.strictEqual(push({ campus: 'LMS4', sensitive: true, tab: 'salary_totals', mode: 'replace', header: ['month', 'staff_count', 'gross', 'net'], rows: [['2026-10', 50, 1, 1]] }).success, true, 'salary_totals on the sensitive Sheet');

// ---- no Sheet yet; a server failure hides its message
delete props.ERP_SHEET_LMS5;
assert.ok(/erpSetupSheets/.test(push({ campus: 'LMS5', tab: 'dues', mode: 'replace', header: DH, rows: [] }).error));
logs.length = 0; failOpen = true;
r = push({ campus: 'LMS4', tab: 'dues', mode: 'replace', header: DH, rows: [] });
assert.ok(/failed on the server/.test(r.error)); assert.ok(!/book\d/.test(JSON.stringify(r) + logs.join()));
failOpen = false;

// ---- logs: counts only
logs.length = 0;
push({ campus: 'LMS4', tab: 'students_now', mode: 'replace', header: H, rows: [row(8)] });
push(S);
assert.ok(logs.length >= 2);
logs.forEach((l) => { assert.ok(/^erppush (replace|upsert) LMS\d [a-z_]+ rows=\d+( total=\d+)?$/.test(l), l); assert.ok(!/Test Student|E8|000000|test-secret|students_full/.test(l), l); });

// ---- registration: no GET action (a push is POST only), the doPost line is there
assert.deepStrictEqual(Object.keys(ctx.GAME_MODULE_ACTIONS), ['erpread']);
assert.ok(/if \(action === 'erppush'\) return gameJson_\(erpPush_\(body\)\);/.test(fs.readFileSync(dir + 'game.gs', 'utf8')));
const gs = fs.readFileSync(dir + 'game.gs', 'utf8');
assert.ok(gs.indexOf("action === 'erppush'") < gs.indexOf('const caller = gameVerifyCaller_(body.idToken)'), 'caller-less, before the token check');

console.log('test-game-erp-sheets: all passed');
