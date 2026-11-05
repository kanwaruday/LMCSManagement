// node tests/game/test-game-workplace.js -- the workplace photo chain (game-workplace.gs): who may photograph and check a room, the
// shots, submit, approve and redo, and the quests. In-memory sheets and Drive; fictional people only.
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const JPG = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]).toString('base64'), PNG = Buffer.from([0x89, 0x50, 0x4E, 0x47]).toString('base64');
function sheet(values) {
  return { values, getDataRange: () => ({ getValues: () => values.map((r) => r.slice()) }), appendRow: (r) => values.push(r.slice()), setFrozenRows() {},
    getRange: (row, col, nr, nc) => ({ setValue: (v) => { values[row - 1][col - 1] = v; }, setValues: (vs) => vs[0].forEach((v, i) => { values[row - 1][col - 1 + i] = v; }) }) };
}
const tabs = {}, files = {};
let nextId = 1;
const folder = (name) => { const kids = {}; return { name, getFoldersByName: (n) => { let f = kids[n]; return { hasNext: () => !!f, next: () => { const x = f; f = null; return x; } }; },
  createFolder: (n) => (kids[n] = folder(n)), createFile: (blob) => { const id = 'F' + nextId++; files[id] = { blob, trashed: false }; return { getId: () => id }; }, kids }; };
const root = folder('My Drive');
const rooms = [['Campus', 'RoomId', 'Name', 'Type', 'StaffEmail'], ['LMS4', 'r1', 'Office', 'office', 'clerk@x.in'], ['LMS4', 'r2', 'Class 7A', 'classroom', 'teach@x.in'],
  ['LMS4', 'r3', "Principal's office", 'office', 'p4@x.in'], ['LMS1', 'r9', 'Library', 'library', 'lib@x.in'], ['LMS4', 'r4', 'Records', 'records', '']];
const allow = [['Email', 'Name', 'Campus', 'Role'], ['p4@x.in', '', 'LMS4', 'Principal'], ['p1@x.in', '', 'LMS1', 'Principal']];
const ctx = { console, Object, String, JSON, Array, Date, Math, encodeURIComponent, GAME_ALLOWLIST_SHEET_ID: 'allow',
  gameBook_: () => ({ getSheetByName: (n) => tabs[n] || null, insertSheet: (n) => (tabs[n] = sheet([])) }),
  gameLower_: (v) => String(v || '').trim().toLowerCase(),
  roomsRows_: () => rooms, roomsOf_: (rows, c) => rows.slice(1).filter((r) => r[0] === c).map((r) => ({ id: r[1], name: r[2], type: r[3], staff: String(r[4]).toLowerCase() })),
  SpreadsheetApp: { openById: () => ({ getSheets: () => [sheet(allow)] }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Utilities: { base64Decode: (s) => Array.from(Buffer.from(s, 'base64')).map((b) => (b > 127 ? b - 256 : b)), base64Encode: (b) => Buffer.from(b.map((x) => x & 0xFF)).toString('base64'),
    newBlob: (bytes, type, name) => ({ bytes, type, name, getBytes: () => bytes }) },
  DriveApp: { getRootFolder: () => root, getFileById: (id) => ({ setTrashed: (v) => { files[id].trashed = v; }, getBlob: () => files[id].blob }) } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../apps-script/game-workplace.gs'), 'utf8').replace(/^const /gm, 'var '), ctx);
const who = { clerk: { email: 'clerk@x.in', campusId: 'LMS4', roles: ['FeeClerk'], primaryRole: 'FeeClerk' }, teach: { email: 'teach@x.in', campusId: 'LMS4', roles: ['Teacher'], primaryRole: 'Teacher' },
  p4: { email: 'p4@x.in', campusId: 'LMS4', roles: ['Principal'], primaryRole: 'Principal' }, p1: { email: 'p1@x.in', campusId: 'LMS1', roles: ['Principal'], primaryRole: 'Principal' },
  owner: { email: 'o@x.in', campusId: 'ALL', roles: ['Owner'], primaryRole: 'Owner' }, coord: { email: 'c@x.in', campusId: 'ALL', roles: ['Coordinator'], primaryRole: 'Coordinator' } };
const J = (x) => JSON.parse(JSON.stringify(x));
const get = (w, p) => J(ctx.workplaceGet_(who[w], p || {}));
const save = (w, b) => J(ctx.workplaceSave_(who[w], b));
const quests = (w) => J([].concat(ctx.workplaceQuests_(who[w]), w === 'p4' || w === 'owner' ? ctx.workplaceReviewQuests_(who[w]) : []));

// mine: the caller's own non-classroom rooms only
assert.deepStrictEqual(get('clerk').rooms.map((r) => [r.roomId, r.status]), [['r1', 'none']]);
assert.deepStrictEqual(get('teach').rooms, [], 'a classroom is the classroom chain\'s, not here');
assert.deepStrictEqual(quests('teach'), []);
// photo: own room, JPEG, a known shot; a stranger is refused
assert.strictEqual(save('teach', { op: 'photo', roomId: 'r1', shot: 'wide', base64: JPG }).code, 'WP_NO_ROOM');
assert.strictEqual(save('clerk', { op: 'photo', roomId: 'r1', shot: 'roof', base64: JPG }).code, 'WP_BAD_INPUT');
assert.strictEqual(save('clerk', { op: 'photo', roomId: 'r1', shot: 'wide', base64: PNG }).code, 'WP_BAD_INPUT', 'JPEG only');
assert.strictEqual(save('clerk', { op: 'photo', roomId: 'r1', shot: 'wide', base64: JPG }).success, true);
assert.strictEqual(root.kids['LMCS Workplace Photos'].kids.LMS4 !== undefined, true, 'a private folder per school');
assert.strictEqual(save('clerk', { op: 'photo', roomId: 'r1', shot: 'wide', base64: JPG }).success, true, 'a retake');
assert.deepStrictEqual([files.F1.trashed, files.F2.trashed], [true, false], 'a retake bins the old photo');
assert.strictEqual(tabs[ctx.WP_TAB].values.length, 2, 'one row per shot');
// submit needs every shot and the tick
assert.strictEqual(save('clerk', { op: 'submit', roomId: 'r1', noPeople: true }).code, 'WP_MISSING');
save('clerk', { op: 'photo', roomId: 'r1', shot: 'desk', base64: JPG }); save('clerk', { op: 'photo', roomId: 'r1', shot: 'store', base64: JPG });
assert.strictEqual(save('clerk', { op: 'submit', roomId: 'r1' }).code, 'WP_TICK');
assert.deepStrictEqual(quests('clerk')[0].steps.map((s) => s.done), [true, true, true, false, false]);
assert.strictEqual(save('clerk', { op: 'submit', roomId: 'r1', noPeople: true }).status, 'pending');
assert.strictEqual(save('clerk', { op: 'photo', roomId: 'r1', shot: 'wide', base64: JPG }).code, 'WP_WAITING', 'no changes while it is being checked');
// review: the school's Principal; not another school's, not a Coordinator, not the clerk
assert.strictEqual(get('clerk', { review: '1' }).code, 'WP_NO_RIGHT');
assert.strictEqual(get('coord', { review: '1' }).code, 'WP_NO_RIGHT');
assert.deepStrictEqual(get('p4', { review: '1' }).rooms.map((r) => r.roomId), ['r1']);
assert.deepStrictEqual(get('p1', { review: '1' }).rooms, []);
assert.strictEqual(quests('p4').filter((q) => q.questId === 'workplace-review')[0].title, '📸 Check workplace photos: 1 waiting');
assert.strictEqual(J(ctx.workplaceImage_(who.p1, { campus: 'LMS4', roomId: 'r1', shot: 'wide' })).code, 'WP_NO_ROOM', 'another school\'s Principal sees no photo');
assert.strictEqual(J(ctx.workplaceImage_(who.p4, { campus: 'LMS4', roomId: 'r1', shot: 'wide' })).base64, JPG);
assert.strictEqual(J(ctx.workplaceImage_(who.teach, { campus: 'LMS4', roomId: 'r1', shot: 'wide' })).code, 'WP_NO_ROOM');
// decide: redo needs a reason; after a redo a retake makes the set a draft again; approve is final
assert.strictEqual(save('p1', { op: 'decide', campus: 'LMS4', roomId: 'r1', decision: 'approve' }).code, 'WP_NO_RIGHT');
assert.strictEqual(save('p4', { op: 'decide', campus: 'LMS4', roomId: 'r1', decision: 'redo' }).code, 'WP_NOTE');
assert.strictEqual(save('p4', { op: 'decide', campus: 'LMS4', roomId: 'r1', decision: 'redo', note: '=Desk is dark' }).status, 'redo');
assert.ok(tabs[ctx.WP_TAB].values.slice(1).every((r) => r[10] === 'Desk is dark'), 'the reason, never a formula');
assert.match(quests('clerk')[0].steps[3].title, /Take them again: Desk is dark/);
save('clerk', { op: 'photo', roomId: 'r1', shot: 'desk', base64: JPG });
assert.deepStrictEqual(get('clerk').rooms[0].status, 'draft', 'a retake after a redo: a draft again');
save('clerk', { op: 'submit', roomId: 'r1', noPeople: true });
assert.strictEqual(save('p4', { op: 'decide', campus: 'LMS4', roomId: 'r1', decision: 'approve' }).status, 'approved');
assert.strictEqual(quests('clerk')[0].complete, true);
assert.strictEqual(save('clerk', { op: 'photo', roomId: 'r1', shot: 'wide', base64: JPG }).code, 'WP_DONE');
assert.deepStrictEqual(quests('p4').filter((q) => q.questId === 'workplace-review'), [], 'nothing waiting: no review quest');
// a Principal's own room goes to the Owner, never to themself
['wide', 'desk', 'store'].forEach((s) => save('p4', { op: 'photo', roomId: 'r3', shot: s, base64: JPG }));
save('p4', { op: 'submit', roomId: 'r3', noPeople: true });
assert.strictEqual(save('p4', { op: 'decide', campus: 'LMS4', roomId: 'r3', decision: 'approve' }).code, 'WP_NO_RIGHT', 'not their own');
assert.deepStrictEqual(get('owner', { review: '1' }).rooms.map((r) => r.roomId), ['r3'], 'the Owner\'s list: Principal-held rooms');
assert.strictEqual(quests('owner')[0].title, '📸 Check workplace photos: 1 waiting');
assert.strictEqual(save('owner', { op: 'decide', campus: 'LMS4', roomId: 'r3', decision: 'approve' }).status, 'approved');
// no rooms module deployed yet: no rooms, no quests
ctx.roomsRows_ = undefined;
assert.deepStrictEqual([get('clerk').rooms, quests('clerk')], [[], []]);
assert.ok(ctx.GAME_MODULE_ACTIONS.workplaceget && !ctx.GAME_MODULE_ACTIONS.workplacesave, 'the write is POST only');
console.log('game workplace: ok');
