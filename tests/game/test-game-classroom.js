// node tests/game/test-game-classroom.js -- the Classroom setup chain (apps-script/game-classroom.gs): ties gate the quest, confirm and item
// saves stay inside the caller's own ties, the photo guards, photos-off hides the items step, the quest hook reads no Sheet, logs carry no
// names; plus the frontend's pure helpers (assets/game/classroom-chain.js). Synthetic data only. N1's ERP module (not on this branch) is
// loaded from its WIP copy when present, else a stand-in erpScope_ with the same reply shape.
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const dir = path.join(__dirname, '../../apps-script/');
const N1_WIP = '/private/tmp/claude-501/-Users-udaykanwar-Library-CloudStorage-OneDrive-Personal-2--Areas-Uday-Obsidian-KMS-Uday-s-KMS/baf31379-6466-4132-9ab4-5364e723f301/scratchpad/game-erp-n1-wip.gs';
const J = (x) => JSON.parse(JSON.stringify(x));

function fakeSheet(rows) {
  const sh = {
    rows,
    getDataRange: () => ({ getValues: () => sh.rows.map((r) => r.slice()) }),
    getLastRow: () => sh.rows.length,
    getRange: (row, col) => {
      const rg = { setNumberFormat: () => rg, setValues: (vals) => { vals.forEach((v, i) => { const r = sh.rows[row - 1 + i] = sh.rows[row - 1 + i] || []; v.forEach((x, j) => { r[col - 1 + j] = x; }); }); return rg; } };
      return rg;
    },
  };
  return sh;
}

function build(order, erp) {
  const store = new Map(), logs = [], props = { GAME_SHEET_ID: 'GAME', ERP_SHEET_LMS4: 'ERP4' }, files = [], folders = {};
  const book = { tabs: { 'Game Progress': fakeSheet([['Email', 'Kind', 'Key', 'Value', 'At']]) }, getSheetByName: (n) => book.tabs[n] || null, insertSheet: (n) => (book.tabs[n] = fakeSheet([])) };
  const erpBook = { tabs: { Assignments: fakeSheet([['empCode', 'email', 'kind', 'class', 'section', 'subject', 'bus'],
    ['', 't4@example.org', 'class', '7', 'a', '', ''],
    ['', 't4@example.org', 'subject', '8', 'B', 'Maths', ''],
    ['', 'other@example.org', 'class', '9', 'A', '', '']]) }, getSheetByName: (n) => erpBook.tabs[n] || null };
  const log = (m) => logs.push(String(m));
  const ctx = {
    console: { log, error: log, warn: log },
    CacheService: { getScriptCache: () => ({ get: (k) => (store.has(k) ? store.get(k) : null), put: (k, v) => { store.set(k, String(v)); }, remove: (k) => { store.delete(k); } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      base64Decode: (s) => { if (!/^[A-Za-z0-9+/=]*$/.test(s)) throw new Error('bad'); return Array.from(Buffer.from(s, 'base64')).map((b) => (b > 127 ? b - 256 : b)); },
      newBlob: (bytes, type, name) => ({ bytes, type, name }),
    },
    DriveApp: { getFolderById: () => ({
      getFoldersByName: (n) => { const f = folders[n]; return { hasNext: () => !!f, next: () => f }; },
      createFolder: (n) => (folders[n] = { name: n, createFile: (blob) => { const f = { id: 'FILE' + files.length, blob, getId: () => 'FILE' + files.indexOf(f), setTrashed() {} }; files.push(f); return f; } }),
    }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType: () => ({ body: s }) }) },
  };
  ctx.SpreadsheetApp = { openById: (id) => (id === 'ERP4' ? erpBook : book) };
  vm.createContext(ctx);
  order.forEach((f) => vm.runInContext(fs.readFileSync(f.startsWith('/') ? f : dir + f, 'utf8'), ctx));
  if (erp === 'stand-in') vm.runInContext(`function erpScope_(caller) {
    const mine = String(caller.email).toLowerCase() === 't4@example.org' ? [{ campus: 'LMS4', kind: 'class', class: '7', section: 'A', subject: '', bus: '' }, { campus: 'LMS4', kind: 'subject', class: '8', section: 'B', subject: 'MATHS', bus: '' }] : [];
    return { success: true, what: 'scope', campuses: [{ campus: 'LMS4', configured: true, can: [] }], ties: mine };
  }`, ctx);
  ctx.gameNow_ = () => new Date('2026-11-06T03:00:00Z');
  return { ctx, store, logs, props, files, book };
}

const BASE = ['game.gs', 'game-actions.gs', 'game-missions.gs', 'game-quests.gs'];
const haveWip = fs.existsSync(N1_WIP);
const T4 = { email: 'T4@example.org', roles: ['Teacher'], primaryRole: 'Teacher', campusId: 'LMS4' };
const NOBODY = { email: 'new@example.org', roles: ['Teacher'], primaryRole: 'Teacher', campusId: 'LMS4' };
const JPEG = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 4]).toString('base64');
const PNG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 1, 2, 3]).toString('base64');

// the gate row survives either load order (game-kingdom.gs assigns QUEST_GATE_HOOKS; clasp pushes alphabetically: classroom first)
for (const order of [['game-classroom.gs', 'game-kingdom.gs'], ['game-kingdom.gs', 'game-classroom.gs']]) {
  const { ctx } = build(BASE.concat(order), 'stand-in');
  const hooks = vm.runInContext('QUEST_GATE_HOOKS', ctx);
  assert.deepStrictEqual(J(hooks.classroomQuests_), { id: 'hook:classroom', title: 'Set up your classroom', roles: ['Teacher'] }, order.join(' then '));
  assert.ok(hooks.tchQuestsHook_ && hooks.fleetQuests_, 'kingdom rows kept: ' + order.join(' then '));
  assert.strictEqual(ctx.questGateHookKeep_((fam) => fam === 'hook:classroom', ctx.classroomQuests_, { questId: 'classroom:setup' }), true);
}

const { ctx, store, logs, props, files, book } = build(BASE.concat(['game-classroom.gs', 'game-kingdom.gs']).concat(haveWip ? [N1_WIP] : []), haveWip ? null : 'stand-in');
assert.strictEqual(typeof ctx.erpScope_, 'function');
assert.ok(ctx.GAME_MODULE_QUESTS.Teacher.indexOf(ctx.classroomQuests_) !== -1 && ctx.GAME_MODULE_MISSIONS.Teacher.indexOf(ctx.classroomMissions_) !== -1);
assert.strictEqual(ctx.GAME_MODULE_ACTIONS.classroomget, ctx.classroomGet_);
assert.ok(!('classroomsave' in ctx.GAME_MODULE_ACTIONS));
assert.ok(/if \(action === 'classroomsave'\) return gameJson_\(classroomSave_\(caller, body\)\);/.test(fs.readFileSync(dir + 'game.gs', 'utf8')));
assert.ok(JSON.parse(fs.readFileSync(dir + 'projects.json', 'utf8')).game.files.includes('game-classroom'));

// roles: Teacher and Staff only
assert.strictEqual(ctx.classroomGet_({ email: 'p@example.org', roles: ['Principal'], campusId: 'LMS4' }).code, 'CLASSROOM_NOT_YOURS');
assert.strictEqual(ctx.classroomSave_({ email: 'p@example.org', roles: ['Coordinator'], campusId: 'LMS4' }, { op: 'confirm' }).code, 'CLASSROOM_NOT_YOURS');

// a cold cache: the quest's link step is a calm waiting, nothing after it opens
let q = J(ctx.classroomQuests_(T4))[0];
assert.strictEqual(q.questId, 'classroom:setup');
assert.deepStrictEqual(q.steps.map((s) => s.id), ['link', 'meet'], 'photos off: no items step');
assert.ok(q.steps[0].waiting && !q.steps[0].done && q.steps[1].locked && !q.complete);

// no tie: link waits with the Principal line, even after warming
ctx.classroomMissions_(NOBODY);
q = J(ctx.classroomQuests_(NOBODY))[0];
assert.ok(q.steps[0].waiting && /Your Principal links you to your class/.test(q.steps[0].title));
let g = J(ctx.classroomGet_(NOBODY));
assert.ok(g.success && g.ties.length === 0 && g.photosOn === false && g.items.length === 0);

// a tie: link done, meet is next
assert.deepStrictEqual(J(ctx.classroomMissions_(T4)), []);
q = J(ctx.classroomQuests_(T4))[0];
assert.ok(q.steps[0].done && !q.steps[0].waiting && !q.steps[1].locked && !q.steps[1].done);
assert.strictEqual(q.steps[1].go, 'teacher/index.html#classroom-students');
g = J(ctx.classroomGet_(T4));
assert.deepStrictEqual(g.ties.map((t) => [t.campus, t.kind, t.class, t.section]), [['LMS4', 'class', '7', 'A'], ['LMS4', 'subject', '8', 'B']]);

// confirm: only the caller's own ties; Game Progress keys carry no name
assert.strictEqual(ctx.classroomSave_(T4, { op: 'confirm', campus: 'LMS4', class: '9', section: 'A' }).code, 'CLASSROOM_NOT_YOURS');
assert.strictEqual(ctx.classroomSave_(T4, { op: 'confirm', campus: 'LMS3', class: '7', section: 'A' }).code, 'CLASSROOM_NOT_YOURS');
let r = J(ctx.classroomSave_(T4, { op: 'confirm', campus: 'LMS4', class: '7', section: 'a' }));
assert.ok(r.success && r.confirmed['LMS4:7:A']);
ctx.classroomSave_(T4, { op: 'confirm', campus: 'LMS4', class: '7', section: 'A' }); // a double tap writes one row
const prog = book.tabs['Game Progress'].rows;
assert.deepStrictEqual(prog.slice(1).map((x) => x.slice(0, 4)), [['t4@example.org', 'classroom_meet', 'LMS4:7:A', 'done']]);
q = J(ctx.classroomQuests_(T4))[0];
assert.ok(!q.steps[1].done, 'meet waits for every linked class');
ctx.classroomSave_(T4, { op: 'confirm', campus: 'LMS4', class: '8', section: 'B' });
q = J(ctx.classroomQuests_(T4))[0];
assert.ok(q.steps[1].done && q.complete, 'photos off: the chain is done without the items step');

// photos off: item ops refused, items step hidden
const item = (extra) => Object.assign({ op: 'item', classKey: 'LMS4:7:A', name: 'Whiteboard', count: 1, photo: JPEG, noChildren: true }, extra);
assert.strictEqual(ctx.classroomSave_(T4, item()).code, 'CLASSROOM_PHOTOS_OFF');
assert.strictEqual(ctx.classroomSave_(T4, { op: 'itemsdone', classKey: 'LMS4:7:A' }).code, 'CLASSROOM_PHOTOS_OFF');

// photos on
props.CLASSROOM_PHOTOS_FOLDER_ID = 'FOLDER';
q = J(ctx.classroomQuests_(T4))[0];
assert.deepStrictEqual(q.steps.map((s) => s.id), ['link', 'meet', 'items']);
assert.ok(!q.complete && !q.steps[2].locked && q.steps[2].go === 'teacher/index.html#classroom-items');
assert.strictEqual(ctx.classroomSave_(T4, item({ noChildren: undefined })).code, 'CLASSROOM_NO_CHILDREN_TICK');
assert.strictEqual(ctx.classroomSave_(T4, item({ noChildren: 'true' })).code, 'CLASSROOM_NO_CHILDREN_TICK');
assert.strictEqual(ctx.classroomSave_(T4, item({ classKey: 'LMS4:9:A' })).code, 'CLASSROOM_NOT_YOURS');
assert.strictEqual(ctx.classroomSave_(T4, item({ photo: PNG })).code, 'CLASSROOM_NOT_JPEG', 'the bytes decide, not the mime');
assert.strictEqual(ctx.classroomSave_(T4, item({ photo: 'data:image/jpeg;base64,' + PNG })).code, 'CLASSROOM_NOT_JPEG');
const big = Buffer.alloc(2 * 1024 * 1024 + 1); big[0] = 0xFF; big[1] = 0xD8; big[2] = 0xFF;
assert.strictEqual(ctx.classroomSave_(T4, item({ photo: big.toString('base64') })).code, 'CLASSROOM_TOO_BIG');
assert.strictEqual(ctx.classroomSave_(T4, item({ photo: '' })).code, 'CLASSROOM_NEED_PHOTO');
assert.strictEqual(ctx.classroomSave_(T4, item({ name: 'x'.repeat(61) })).code, 'CLASSROOM_BAD_NAME');
assert.strictEqual(ctx.classroomSave_(T4, item({ count: 0 })).code, 'CLASSROOM_BAD_COUNT');
assert.strictEqual(ctx.classroomSave_(T4, item({ count: 2.5 })).code, 'CLASSROOM_BAD_COUNT');
assert.strictEqual(files.length, 0);
assert.ok(!book.tabs['Classroom Items'], 'nothing written for a refusal');

// itemsdone needs a photo'd item
assert.strictEqual(ctx.classroomSave_(T4, { op: 'itemsdone', classKey: 'LMS4:7:A' }).code, 'CLASSROOM_NEEDS_PHOTO');

// a good save: Drive file under the campus folder, no person's name; one tab row
r = J(ctx.classroomSave_(T4, item({ name: '  Steel   almirah ', count: 2, photo: 'data:image/jpeg;base64,' + JPEG })));
assert.ok(r.success, JSON.stringify(r));
assert.strictEqual(files.length, 1);
const fname = files[0].blob.name;
assert.ok(/^LMS4-7A-i[a-z0-9]+-202611060830\.jpg$/.test(fname), fname);
const tab = book.tabs['Classroom Items'].rows;
assert.deepStrictEqual(tab[0], ['At', 'Email', 'Campus', 'Class', 'Section', 'ItemId', 'Name', 'Count', 'FileId', 'Status']);
assert.deepStrictEqual(tab[1].slice(1), ['t4@example.org', 'LMS4', '7', 'A', r.items[0].id, 'Steel almirah', '2', 'FILE0', 'live']);
assert.deepStrictEqual(r.items.map((i) => [i.classKey, i.name, i.count, i.hasPhoto]), [['LMS4:7:A', 'Steel almirah', 2, true]]);
assert.ok(!('fileId' in r.items[0]), 'the file id never reaches the page');
const id = r.items[0].id;

// edit without a new photo keeps the FileId; an unknown itemId is refused
r = J(ctx.classroomSave_(T4, item({ itemId: id, name: 'Steel almirah', count: 3, photo: '' })));
assert.ok(r.success && r.items[0].count === 3 && files.length === 1);
assert.strictEqual(tab[2][8], 'FILE0');
assert.strictEqual(ctx.classroomSave_(T4, item({ itemId: 'nope' })).code, 'CLASSROOM_NO_ITEM');

// that's everything -> items step done
r = J(ctx.classroomSave_(T4, { op: 'itemsdone', classKey: 'LMS4:7:A' }));
assert.ok(r.success && r.itemsDone && r.itemsDoneFor['LMS4:7:A']);
q = J(ctx.classroomQuests_(T4))[0];
assert.ok(q.steps[2].done && q.complete);

// remove appends a row; with no live photo'd item left, items-done no longer counts
r = J(ctx.classroomSave_(T4, { op: 'remove', classKey: 'LMS4:7:A', itemId: id }));
assert.ok(r.success && r.items.length === 0 && !r.itemsDone);
assert.strictEqual(tab[tab.length - 1][9], 'removed');

// the quest hook reads no Sheet (and no Drive): only the cache
ctx.SpreadsheetApp = { openById: () => { throw new Error('Sheet read under the lock'); } };
ctx.DriveApp = { getFolderById: () => { throw new Error('Drive under the lock'); } };
q = J(ctx.classroomQuests_(T4))[0];
assert.ok(q.steps[0].done && q.steps[1].done && !q.steps[2].done);
store.clear();
q = J(ctx.classroomQuests_(T4))[0];
assert.ok(q.steps[0].waiting, 'cold cache: calm waiting, still no Sheet read');
// a read failure is a plain sentence, no message leaks
g = J(ctx.classroomGet_(T4));
assert.strictEqual(g.code, 'CLASSROOM_READ_FAILED');
assert.ok(!/Sheet read/.test(g.error));

// logs: counts and codes only
const blob = logs.join('\n');
for (const bad of ['t4@example.org', 'T4@example.org', 'almirah', 'Whiteboard', 'FILE0', 'FOLDER', 'ERP4', 'Sheet read']) assert.ok(blob.indexOf(bad) === -1, 'log leaks ' + bad + ':\n' + blob);

// ── the frontend's pure helpers ──
const C = require(path.join(__dirname, '../../assets/game/classroom-chain.js'));
assert.strictEqual(C.tieLabel({ kind: 'class', class: '7', section: 'A' }), 'Class 7 A · class teacher');
assert.strictEqual(C.tieLabel({ kind: 'subject', class: '8', section: 'B', subject: 'MATHS' }), 'Class 8 B · Maths');
assert.strictEqual(C.tieLabel({ kind: 'subject', class: 'NURSERY', section: '', subject: 'SOCIAL STUDIES' }), 'NURSERY · Social Studies');
assert.strictEqual(C.attendanceLine({ '2026-11-06': { P: 28, A: 3, L: 1, H: 0, total: 32 } }, '2026-11-06'), 'Present 28 · Absent 3 · Leave 1 of 32');
assert.strictEqual(C.attendanceLine({ '2026-11-05': { P: 1, A: 0, L: 0, H: 0, total: 1 } }, '2026-11-06'), null);
assert.strictEqual(C.attendanceLine({}, '2026-11-06'), null);
assert.strictEqual(C.attendanceLine({ '2026-11-06': { P: 0, A: 0, L: 0, H: 30, total: 30 } }, '2026-11-06'), 'Today is marked a holiday.');
assert.deepStrictEqual(C.shrinkSize(4000, 3000, 1600), { w: 1600, h: 1200 });
assert.deepStrictEqual(C.shrinkSize(3000, 4000, 1600), { w: 1200, h: 1600 });
assert.deepStrictEqual(C.shrinkSize(800, 600, 1600), { w: 800, h: 600 });
assert.strictEqual(C.istToday(new Date('2026-11-05T19:00:00Z')), '2026-11-06');
assert.strictEqual(C.classKey({ campus: 'LMS4', class: '7', section: 'A' }), 'LMS4:7:A');
// no innerHTML with data in the module
assert.ok(!/innerHTML/.test(fs.readFileSync(path.join(__dirname, '../../assets/game/classroom-chain.js'), 'utf8')));

console.log('test-game-classroom OK' + (haveWip ? ' (with N1 WIP erpScope_)' : ' (stand-in erpScope_)'));
