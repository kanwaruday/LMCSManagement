// apps-script/transport-uploads.gs: who may upload a bus paper, which files are accepted, where it goes and what is recorded.
// Runs the real .gs (plus staff-documents.gs for the shared MIME/size limits) in a vm with stubbed Drive and Sheets.
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const gs = (f) => fs.readFileSync(path.join(__dirname, '../../apps-script', f), 'utf8').replace(/^const /gm, 'var ');

function folder(name) {
  const kids = [], files = [];
  return { name, kids, files, getName: () => name, getId: () => 'F_' + name.replace(/\W/g, ''),
    getFolders() { let i = 0; return { hasNext: () => i < kids.length, next: () => kids[i++] }; },
    getFoldersByName(n) { const m = kids.filter((k) => k.name === n); let i = 0; return { hasNext: () => i < m.length, next: () => m[i++] }; },
    createFolder(n) { const f = folder(n); kids.push(f); return f; },
    createFile(blob) { const f = { blob, getId: () => 'FILEID' + files.length + 'x'.repeat(20) }; files.push(f); return f; } };
}
const root = folder('LMS Central Repository');
const bw = root.createFolder('LMCS Repository').createFolder('Important Documents @ LMCS').createFolder('Important Documents Transport').createFolder('Bus Wise Documents');
const b5805 = bw.createFolder('HP66 5805');
const tabs = {
  'LM Studio Fleet': [['Reg', 'Bus', 'Campus'], ['HP665805', 'Bus 1', 'LMS 1'], ['HP34B6083', 'Bus 9', 'LMS-4'], ['HP66A0898', 'Innova', 'LMS 2']],
};
const ss = { getSheetByName: (n) => tabs[n] ? { getDataRange: () => ({ getValues: () => tabs[n].map((r) => r.slice()) }), appendRow: (r) => tabs[n].push(r) } : null,
  insertSheet(n) { tabs[n] = []; return { appendRow: (r) => tabs[n].push(r), setFrozenRows() {}, getRange: () => ({ setFontWeight() {} }) }; } };
let caller = null;
const ctx = { console, Date, Object, String, Math, JSON, Array, Number, RegExp,
  SpreadsheetApp: { openById: () => ss },
  DriveApp: { getFolderById: () => root },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Utilities: { base64Decode: (s) => Array.from(Buffer.from(s, 'base64')).map((b) => (b > 127 ? b - 256 : b)), // Apps Script bytes are signed
    newBlob: (bytes, mime, name) => ({ bytes, mime, name }), formatDate: (d, tz, f) => f === 'yyyy' ? '2026' : '21-10-2026' },
  verifyStaffManagerToken_: () => caller, CENTRAL_REPO_FOLDER_ID_: 'root',
  getSubfolder_: (p, n) => { const it = p.getFoldersByName(n); return it.hasNext() ? it.next() : null; } };
vm.createContext(ctx);
vm.runInContext(gs('staff-documents.gs').split('\n').filter((l) => /^var SDOC_(MAX_BYTES|MIME_EXT)_/.test(l)).join('\n'), ctx);
vm.runInContext(gs('transport-uploads.gs'), ctx);
const run = (code) => JSON.parse(JSON.stringify(vm.runInContext(code, ctx)));
const b64 = (hex, pad) => Buffer.concat([Buffer.from(hex.replace(/ /g, ''), 'hex'), Buffer.alloc(pad || 8)]).toString('base64');
ctx.b64 = b64;

// leading bytes decide the type, whatever the file claims to be
const sniff = (hex) => run('tupSniff_(Utilities.base64Decode(b64("' + hex + '")))');
assert.strictEqual(sniff('25 50 44 46 2D'), 'application/pdf');
assert.strictEqual(sniff('FF D8 FF E0'), 'image/jpeg');
assert.strictEqual(sniff('89 50 4E 47'), 'image/png');
assert.strictEqual(sniff('52 49 46 46 00 00 00 00 57 45 42 50'), 'image/webp');
assert.strictEqual(sniff('00 00 00 18 66 74 79 70 68 65 69 63'), 'image/heic');
assert.strictEqual(sniff('50 4B 03 04'), '', 'a ZIP is refused'); assert.strictEqual(sniff('4D 5A 90 00'), '', 'an EXE is refused');

// campus coverage
const covers = (c, campus) => run('tupCovers_(' + JSON.stringify(c) + ',"' + campus + '")');
assert.strictEqual(covers({ campusId: 'LMS1', roles: ['Owner'] }, 'LMS5'), true, 'Owner: any campus');
assert.strictEqual(covers({ campusId: 'ALL', roles: ['Coordinator'] }, 'LMS6'), true, 'ALL: any campus');
assert.strictEqual(covers({ campusId: 'LMS1', roles: ['Coordinator'] }, 'LMS2'), true, 'Coordinator: their district');
assert.strictEqual(covers({ campusId: 'LMS1', roles: ['Coordinator'] }, 'LMS4'), false, 'Coordinator: not the other district');
assert.strictEqual(covers({ campusId: 'LMS1,LMS2', roles: ['FeeClerk'] }, 'LMS2'), true, 'Fee Clerk: their comma list');
assert.strictEqual(covers({ campusId: 'LMS1,LMS2', roles: ['FeeClerk'] }, 'LMS3'), false, 'Fee Clerk: not a district');

assert.strictEqual(run('tupNormReg_("HP 66 5805")'), 'HP665805');
assert.strictEqual(run('tupFileName_("pollution","HP665805",new Date())'), 'Pollution HP665805 uploaded 21-10-2026');

// the whole upload
const up = (o) => run('tupUpload_(' + JSON.stringify(Object.assign({ idToken: 't', reg: 'HP665805', paper: 'pollution', mimeType: 'application/pdf', base64: b64('25 50 44 46 2D'), via: 'Coordinator page' }, o)) + ')');
caller = null;
assert.match(up({}).error, /Not authorized/);
caller = { email: 'c@lms.org.in', campusId: 'LMS1', roles: ['Coordinator'], role: 'Coordinator' };
assert.match(up({ reg: 'HP34B6083' }).error, /only upload for buses of your own campuses/, 'LMS1 coordinator cannot upload for an LMS4 bus');
assert.match(up({ reg: 'HP000' }).error, /not in the fleet/);
assert.match(up({ paper: 'rc' }).error, /Unknown paper/);
assert.match(up({ base64: b64('50 4B 03 04') }).error, /PDF or photo/, 'a ZIP renamed .pdf is refused');
assert.match(up({ base64: '' }).error, /Empty/);
const ok = up({});
assert.strictEqual(ok.success, true, JSON.stringify(ok));
const year = b5805.kids.find((k) => k.name === '2026');
assert.ok(year, 'year folder created inside the existing bus folder (matched with spaces removed)');
assert.strictEqual(year.files[0].blob.name, 'Pollution HP665805 uploaded 21-10-2026.pdf');
assert.strictEqual(ok.fileId, year.files[0].getId()); assert.match(ok.link, /drive\.google\.com/);
const rows = JSON.parse(JSON.stringify(tabs['Portal Uploads']));
assert.deepStrictEqual(rows[0], ['Uploaded On', 'Reg', 'Paper', 'File ID', 'Link', 'Uploaded By', 'Role', 'Campus', 'Via', 'Status']);
assert.deepStrictEqual(rows[1].slice(1), ['HP665805', 'pollution', ok.fileId, ok.link, 'c@lms.org.in', 'Coordinator', 'LMS1', 'Coordinator page', '']);
up({ reg: 'HP66A0898', paper: 'insurance', base64: b64('FF D8 FF E0') });
assert.ok(bw.kids.find((k) => k.name === 'HP66A0898'), 'a bus with no folder gets one named after its registration');
assert.strictEqual(tabs['Portal Uploads'].length, 3, 'every upload is a new row');
console.log('transport uploads: all checks passed');
