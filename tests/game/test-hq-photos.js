// node tests/game/test-hq-photos.js -- "Photograph LMCS HQ and pin it" (apps-script/game-hq-photos.gs, hq-photos/index.html,
// assets/game/hq-photos.js): the HQ row in All quests (a Principal, Coordinator or Accounts person can be picked), only the holder can
// open and save it, the photos go to a private Drive folder, the pin stays in the LMS area, submit needs every required photo, the pin
// and the "no people" tick. Harness copied from tests/game/test-people.js (each game test keeps its own). Synthetic data only.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const dir = __dirname + '/../../apps-script/';
const store = new Map(), events = [], warns = [], logs = [];
let lockFails = false, fetches = [], fetchReply = null;
function fakeSheet(rows) {
  const sh = {
    rows,
    getDataRange: () => ({ getValues: () => sh.rows.map((r) => r.slice()) }),
    getLastRow: () => sh.rows.length,
    appendRow: (r) => { sh.rows.push(r.slice()); }, setFrozenRows: () => {},
    getRange: (row, col) => {
      const rg = { setNumberFormat: () => rg, setValues: (vals) => { vals.forEach((v, i) => { const r = sh.rows[row - 1 + i] = sh.rows[row - 1 + i] || []; v.forEach((x, j) => { r[col - 1 + j] = x; }); }); return rg; },
        setValue: (x) => { (sh.rows[row - 1] = sh.rows[row - 1] || [])[col - 1] = x; return rg; } };
      return rg;
    },
  };
  return sh;
}
const book = { tabs: {}, getSheetByName: (n) => book.tabs[n] || null, insertSheet: (n) => (book.tabs[n] = fakeSheet([])) };
const ALLOW = [['email', 'name', 'campus', 'roles', 'canDecide'],
  ['owner@example.org', 'Owner One', 'ALL', 'Owner', 'TRUE'],
  ['p4@example.org', 'Principal Four', 'LMS4', 'Principal', ''],
  ['p3@example.org', 'Principal Three', 'LMS3', 'Principal', ''],
  ['c1@example.org', 'Coordinator One', 'LMS1', 'Coordinator', 'TRUE'],
  ['t4@example.org', 'Teacher Four', 'LMS4', 'Teacher', '']];
const allowBook = { getSheets: () => [fakeSheet(ALLOW)] };
const ctx = {
  console: { log: (m) => logs.push(String(m)), error: (m) => logs.push(String(m)), warn: (m) => warns.push(String(m)) },
  CacheService: { getScriptCache: () => ({ get: (k) => (store.has(k) ? store.get(k) : null), put: (k, v) => { store.set(k, String(v)); }, remove: (k) => { store.delete(k); } }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === 'GAME_SHEET_ID' ? 'GAME_BOOK' : null) }) },
  LockService: { getScriptLock: () => ({ waitLock: () => { if (lockFails) throw new Error('lock'); events.push('lock'); }, releaseLock: () => events.push('unlock') }) },
  UrlFetchApp: { fetch: (url, opts) => {
    events.push('fetch');
    fetches.push({ url, opts });
    if (fetchReply === 'throw') throw new Error('network down');
    if (fetchReply === 'http500') return { getResponseCode: () => 500, getContentText: () => '<html>' };
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify(fetchReply) };
  } },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType: () => ({ body: s }) }) },
  Logger: { log() {} },
  Utilities: { base64Decode: (s) => Array.from(Buffer.from(s, 'base64')).map((b) => (b > 127 ? b - 256 : b)), newBlob: (bytes, type, name) => ({ bytes, type, name }) },
};
// Drive: one private folder, files kept in memory; a retake bins the old one
const drive = { folders: {}, files: {}, n: 0 };
const folderOf = (name) => drive.folders[name] = drive.folders[name] || { name, getName: () => name, createFile: (blob) => { const id = 'f' + (++drive.n); drive.files[id] = { blob, folder: name, trashed: false }; return { getId: () => id }; } };
ctx.DriveApp = { getRootFolder: () => ({ getName: () => 'My Drive', getFoldersByName: (n) => { const f = drive.folders[n]; let used = false; return { hasNext: () => !!f && !used, next: () => { used = true; return f; } }; }, createFolder: (n) => folderOf(n) }),
  getFileById: (id) => ({ setTrashed: (t) => { drive.files[id].trashed = t; } }) };
vm.createContext(ctx);
['game.gs', 'game-actions.gs', 'game-missions.gs', 'game-confirm.gs', 'game-office.gs', 'game-buddy.gs', 'game-kingdom.gs', 'game-people.gs', 'supporting-charge.gs', 'game-rooms.gs', 'game-event.gs', 'game-hq-photos.gs'].forEach((f) => vm.runInContext(fs.readFileSync(dir + f, 'utf8'), ctx));
ctx.SpreadsheetApp = { openById: (id) => (id === vm.runInContext('GAME_ALLOWLIST_SHEET_ID', ctx) ? allowBook : book) };
const J = (x) => JSON.parse(JSON.stringify(x));
const NOW = new Date('2026-10-29T05:00:00Z');
ctx.gameNow_ = () => NOW;
ctx.daybookProgress_ = () => null;
ctx.cqDefaults_ = () => ({}); // test definitions only (as test-confirm.js does)
const f = (id) => ({ id, label: id, type: 'text', required: true });
const DEFS = {
  tc: { title: 'Campus step', task: 'Do the campus step', scope: 'campus', roles: ['Principal'], fields: [f('name')], prefill: 'test.one' },
  tn: { title: 'Network step', task: 'Do the network step', scope: 'network', roles: ['Coordinator'], fields: [f('name')], prefill: 'test.one' },
  toff: { title: 'Off', scope: 'campus', roles: ['Principal'], fields: [f('name')], active: false },
  tself: { title: 'Mine', scope: 'self', roles: ['Teacher'], fields: [f('name')] },
};
const KINGDOM = { buildings: [{ id: 'hall', name: 'Hall', where: 'campus', tiers: [{ label: 'Campus step', refs: ['cq:tc'], owners: ['tc'] }] },
  { id: 'post', name: 'Post', where: 'darbar', tiers: [{ label: 'Network step', refs: ['cq:tn'], owners: ['tn'] }] }] };
const reset = (cfgExtra) => {
  const cfg = Object.assign({ confirmQuests: DEFS, kingdom: KINGDOM }, cfgExtra || {});
  book.tabs = { 'Game Config': fakeSheet([['Key', 'Value']].concat(Object.keys(cfg).map((k) => [k, JSON.stringify(cfg[k])]))) };
  events.length = 0; warns.length = 0; logs.length = 0; fetches = []; fetchReply = null; lockFails = false; ctx.CQ_MEMO = null;
  ctx.CQ_PREFILL['test.one'] = () => [{ item: 'a', fields: { name: 'Sample' } }];
};
const mk = (o) => Object.assign({ campusId: 'ALL', idToken: 'tok-' + o.email.split('@')[0] }, o);
const OWN = mk({ email: 'owner@example.org', roles: ['Owner'], primaryRole: 'Owner' });
const COORD = mk({ email: 'c1@example.org', roles: ['Coordinator'], primaryRole: 'Coordinator', campusId: 'LMS1' });
const P4 = mk({ email: 'p4@example.org', roles: ['Principal'], primaryRole: 'Principal', campusId: 'LMS4' });
const P3 = mk({ email: 'p3@example.org', roles: ['Principal'], primaryRole: 'Principal', campusId: 'LMS3' });
const assign = (c, b) => J(ctx.kingdomAssign_(c, b));
const allocate = (c, b) => J(ctx.kingdomAllocate_(c, b));
const rows = (tab) => (book.tabs[tab] ? book.tabs[tab].rows.slice(1) : []);
const setup = () => rows('Setup Data');
const audit = () => rows('Game Allocations');
const H = J(vm.runInContext('KINGDOM_ALLOC_HEADER', ctx));
// the allowlist as the People room sees it: a Functions column after canDecide, found by header
let A = [], onReadRow = null;
const resetAllow = () => {
  A = [['Email', 'Name', 'Campus', 'Roles', 'CanDecide', 'Functions'],
    ['owner@example.org', 'Owner One', 'ALL', 'Owner', 'TRUE', ''],
    ['c1@example.org', 'Coordinator One', 'LMS1', 'Coordinator', 'TRUE', 'Transport, Payroll'],
    ['c2@example.org', 'Coordinator Two', 'ALL', 'Coordinator, Accounts', '', 'Fees & Accounts'],
    ['oc@example.org', 'Owner Coord', 'ALL', 'Owner, Coordinator', 'TRUE', ''],
    ['p4@example.org', 'Principal Four', 'LMS4', 'Principal', '', '']];
};
const allowSheet = {
  getDataRange: () => ({ getValues: () => A.map((r) => r.slice()) }),
  getLastRow: () => A.length,
  getRange: (row, col, nr, nc) => {
    const rg = { setNumberFormat: () => rg,
      setValues: (vals) => { vals.forEach((v, i) => { const r = A[row - 1 + i] = A[row - 1 + i] || []; v.forEach((x, j) => { r[col - 1 + j] = x; }); }); return rg; },
      setValue: (x) => { A[row - 1][col - 1] = x; return rg; },
      getValues: () => { if (onReadRow) onReadRow(); return [A[row - 1].slice(col - 1, col - 1 + (nc || 1))]; } };
    return rg;
  },
  deleteRow: (n) => { A.splice(n - 1, 1); },
};
ctx.SpreadsheetApp = { openById: (id) => (id === vm.runInContext('GAME_ALLOWLIST_SHEET_ID', ctx) ? { getSheets: () => [allowSheet] } : book) };
const tests = [];
const test = (n, fn) => tests.push([n, fn]);
const col = (r, name) => r[H.indexOf(name)];
const people = (c, b) => J(ctx.peopleCoordinator_(c, b));
const rowOf = (e) => A.find((r) => r[0] === e);
const go = () => { reset(); resetAllow(); onReadRow = null; };

const ACC = mk({ email: 'c2@example.org', roles: ['Coordinator', 'Accounts'], primaryRole: 'Coordinator', campusId: 'ALL' });
const save = (c, b) => J(ctx.hqPhotosSave_(c, b));
const view = (c) => J(ctx.hqPhotosGet_(c));
const JPEG = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]).toString('base64');
const hq = () => J(rows('HQ Photos'));
const giveTo = (email) => assert.strictEqual(assign(OWN, { quest: 'hook:hq-photos', campus: '', assignee: email }).success, true, 'assigned to ' + email);

test('All quests: one HQ row (no school rows), and a Principal, a Coordinator or Accounts can be picked for it', () => {
  go();
  const fam = J(ctx.kingdomGateFamilies_(ctx.cqLoadCfg_())).find((f) => f.id === 'hook:hq-photos');
  assert.deepStrictEqual([fam.campus, fam.network, fam.roles, fam.go], [false, true, ['Principal', 'Coordinator', 'Accounts'], 'hq-photos/index.html']);
  const r = J(ctx.kingdomQuests_(OWN, {}));
  assert.strictEqual(r.success, true, JSON.stringify(r));
  const hqRows = r.rows.filter((x) => x.questId === 'hook:hq-photos');
  assert.deepStrictEqual(hqRows.map((x) => x.campus), [''], 'the HQ row only');
  const people = hqRows[0].assignees.map((p) => p.email).sort();
  for (const e of ['p4@example.org', 'c1@example.org', 'c2@example.org']) assert.ok(people.includes(e), e + ' can be picked');
  // the families other hooks had before keep their rows (networkOnly is opt-in)
  assert.strictEqual(J(ctx.kingdomGateFamilies_(ctx.cqLoadCfg_())).find((f) => f.id === 'hook:workplace').campus, true);
});

test('only the holder opens it: nobody until the Owner picks; then that person, not another', () => {
  go();
  for (const c of [P4, COORD, ACC]) { assert.strictEqual(view(c).code, 'HQP_NOT_YOURS'); assert.deepStrictEqual(J(ctx.hqPhotosQuests_(c)), []); }
  giveTo('p4@example.org');
  const v = view(P4);
  assert.deepStrictEqual([v.success, v.sent, v.ready, v.pin, v.shots.map((s) => s.id + (s.required ? '*' : ''))], [true, false, false, null, ['front*', 'gate*', 'side*', 'wide']]);
  for (const c of [P3, COORD, ACC]) assert.strictEqual(view(c).code, 'HQP_NOT_YOURS', c.email);
  assert.strictEqual(save(P3, { op: 'pin', lat: 31.9, lng: 77.1 }).code, 'HQP_NOT_YOURS');
  const q = J(ctx.hqPhotosQuests_(P4))[0];
  assert.deepStrictEqual([q.title, q.steps.map((s) => s.id), q.steps[0].go], ['🏛️ Photograph LMCS HQ and pin it', ['front', 'gate', 'side', 'pin', 'send'], 'hq-photos/index.html']);
  assert.deepStrictEqual(J(ctx.hqPhotosQuests_(OWN))[0].steps.map((s) => s.id), ['front', 'gate', 'side', 'pin', 'send'], 'on the Owner\'s own board too (Uday, 8 Nov)');
  assert.strictEqual(view(OWN).success, true, 'the Owner can look');
  assert.deepStrictEqual(J(ctx.hqPhotosQuests_(Object.assign({}, OWN, { viewAs: true, primaryRole: 'Principal' }))), [], 'not while previewing a school');
  // the Owner previewing a school, or a switched supporting Principal, never acts on it
  assert.strictEqual(view(Object.assign({}, P4, { supportingAt: 'LMS3' })).code, 'HQP_NOT_YOURS');
});

test('photos: JPEG only, to the private Drive folder; a retake bins the old file; the pin stays in the LMS area', () => {
  go(); drive.folders = {}; drive.files = {}; giveTo('p4@example.org');
  for (const bad of [{ shot: 'roof', base64: JPEG }, { shot: 'front', base64: Buffer.from('GIF89a').toString('base64') }, { shot: 'front', base64: 'not base64!' }, { shot: 'front', base64: '' }]) {
    assert.strictEqual(save(P4, Object.assign({ op: 'photo' }, bad)).code, 'HQP_BAD_INPUT', JSON.stringify(bad).slice(0, 40));
  }
  assert.strictEqual(save(P4, { op: 'photo', shot: 'front', base64: JPEG }).success, true);
  assert.strictEqual(save(P4, { op: 'photo', shot: 'front', base64: JPEG }).success, true);
  assert.deepStrictEqual(Object.keys(drive.folders), ['LMCS HQ Photos'], 'one private folder, nothing in the repo');
  assert.deepStrictEqual(Object.values(drive.files).map((f) => f.trashed), [true, false], 'the retake replaced the first file');
  assert.strictEqual(hq().length, 1, 'one row per slot');
  assert.deepStrictEqual(hq()[0].slice(0, 2).concat(hq()[0].slice(5)), ['front', 'f2', 'p4@example.org', 'draft']);
  for (const [lat, lng, code] of [[28.6, 77.2, 'HQP_BAD_PIN'], [31.9, 79, 'HQP_BAD_PIN'], ['31.9', 77.1, 'HQP_BAD_INPUT'], [NaN, 77, 'HQP_BAD_PIN'], [undefined, undefined, 'HQP_BAD_INPUT']]) {
    assert.strictEqual(save(P4, { op: 'pin', lat, lng }).code, code, lat + ',' + lng);
  }
  assert.strictEqual(save(P4, { op: 'pin', lat: 31.92935541, lng: 77.11448881 }).success, true);
  assert.deepStrictEqual(view(P4).pin, { lat: 31.9293554, lng: 77.1144888 }, 'rounded to 7 places');
  assert.strictEqual(save(P4, { op: 'pin', lat: 31.93, lng: 77.12 }).success, true);
  assert.strictEqual(hq().filter((r) => r[0] === 'pin').length, 1, 'a new pin replaces the old');
  assert.ok(!logs.concat(warns).some((m) => /@example/.test(m)));
});

test('send: needs the three required photos, the pin and the "no people" tick; then it is done and locked', () => {
  go(); drive.folders = {}; drive.files = {}; giveTo('p4@example.org');
  assert.strictEqual(save(P4, { op: 'submit', noPeople: true }).code, 'HQP_MISSING');
  ['front', 'gate'].forEach((s) => save(P4, { op: 'photo', shot: s, base64: JPEG }));
  save(P4, { op: 'pin', lat: 31.93, lng: 77.11 });
  assert.strictEqual(save(P4, { op: 'submit', noPeople: true }).code, 'HQP_MISSING', 'the side photo is still missing');
  save(P4, { op: 'photo', shot: 'side', base64: JPEG });
  assert.strictEqual(view(P4).ready, true, 'the optional fourth is not needed');
  for (const np of [undefined, false, 'yes', 1]) assert.strictEqual(save(P4, { op: 'submit', noPeople: np }).code, 'HQP_TICK', String(np));
  assert.deepStrictEqual(save(P4, { op: 'submit', noPeople: true }), { success: true, sent: true });
  assert.ok(hq().every((r) => r[6] === 'sent'));
  assert.strictEqual(view(P4).sent, true);
  assert.strictEqual(J(ctx.hqPhotosQuests_(P4))[0].complete, true);
  for (const b of [{ op: 'photo', shot: 'wide', base64: JPEG }, { op: 'pin', lat: 31.9, lng: 77.1 }, { op: 'submit', noPeople: true }]) assert.strictEqual(save(P4, b).code, 'HQP_DONE');
  assert.strictEqual(save(P4, { op: 'shred' }).code, 'HQP_DONE');
});

test('the Owner plays it himself (Uday, 8 Nov): photos, pin, send, and the quest counts as done', () => {
  go(); drive.folders = {}; drive.files = {};
  ['front', 'gate', 'side'].forEach((s) => assert.strictEqual(save(OWN, { op: 'photo', shot: s, base64: JPEG }).success, true));
  assert.strictEqual(save(OWN, { op: 'pin', lat: 31.93, lng: 77.11 }).success, true);
  assert.deepStrictEqual(save(OWN, { op: 'submit', noPeople: true }), { success: true, sent: true });
  const q = J(ctx.hqPhotosQuests_(OWN))[0];
  assert.ok(q.complete && q.steps.every((s) => s.done));
  assert.ok(ctx.GAME_MODULE_QUESTS.Owner.includes(ctx.hqPhotosQuests_), 'on the Owner board hooks');
});

test('wiring: POST only (one doPost line), the GET read registered, the page and the pin parser', () => {
  const g = fs.readFileSync(dir + 'game.gs', 'utf8');
  assert.ok(/action === 'hqphotossave'\) return gameJson_\(hqPhotosSave_\(caller, body\)\)/.test(g) && !/hqphotossave/.test(g.slice(0, g.indexOf('function doPost'))));
  assert.strictEqual(typeof ctx.GAME_MODULE_ACTIONS.hqphotosget, 'function');
  assert.ok(!ctx.GAME_MODULE_ACTIONS.hqphotossave, 'the save is never a GET');
  assert.ok(JSON.parse(fs.readFileSync(dir + 'projects.json', 'utf8')).game.files.includes('game-hq-photos'));
  const P = require(__dirname + '/../../assets/game/hq-photos.js');
  const pin = (t) => JSON.stringify(P.parsePin(t));
  const L1 = '31.9293', L2 = '77.1144'; // split so no coordinate pair sits in the source as one string
  assert.strictEqual(pin(L1 + ', ' + L2), JSON.stringify({ lat: 31.9293, lng: 77.1144 }));
  assert.strictEqual(pin('https://www.google.com/maps/place/X/@' + L1 + ',' + L2 + ',17z'), JSON.stringify({ lat: 31.9293, lng: 77.1144 }));
  assert.strictEqual(pin('https://maps.google.com/?q=' + L1 + ',' + L2), JSON.stringify({ lat: 31.9293, lng: 77.1144 }));
  assert.strictEqual(pin('https://www.google.com/maps/place/X/data=!3d' + L1 + '!4d' + L2), JSON.stringify({ lat: 31.9293, lng: 77.1144 }));
  for (const bad of ['', 'HQ', 'https://maps.app.goo.gl/abc', '99, 400', '31.9']) assert.strictEqual(P.parsePin(bad), null, bad);
  assert.ok(P.inArea({ lat: 31.9, lng: 77.1 }) && !P.inArea({ lat: 28.6, lng: 77.2 }));
  const page = fs.readFileSync(__dirname + '/../../hq-photos/index.html', 'utf8'), js = fs.readFileSync(__dirname + '/../../assets/game/hq-photos.js', 'utf8');
  assert.ok(page.includes('assets/game/hq-photos.js') && /LMCSHqPhotos\.mount/.test(page) && /No people in the photos/.test(js) && /noPeople: true/.test(js));
  assert.ok(!/innerHTML/.test(js), 'text as text nodes');
  // the pin on record is offered to confirm or correct (Uday's rule: confirm the data we already hold)
  assert.ok(/places\.js/.test(page) && page.indexOf('places.js') < page.indexOf('hq-photos.js') && /LMCSPlaces\.HES/.test(js) && /Yes, that is LMCS HQ/.test(js) && /setPin\(known\)/.test(js));
  assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(js) && /em\('photo'\)/.test(js) && /em\('realMap'\)/.test(js), 'emoji from the shared map (emoji.js), none typed');
});

let fail = 0;
for (const [n, fn] of tests) { try { fn(); console.log('ok  ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n  ' + (e.stack || e).split('\n').slice(0, 14).join('\n  ')); } }
if (fail) process.exit(1);
