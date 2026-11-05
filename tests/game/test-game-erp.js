// node tests/game/test-game-erp.js -- the ERP read module (game-erp.gs): scopes, shapes, empty state, counts-only logs.
// Synthetic rows only: names Test Student N, enroll E00N, regs TEST01..., no real values.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const dir = __dirname + '/../../apps-script/';
const logs = [];
const ctx = { console: { log: (m) => logs.push(String(m)), error: (m) => logs.push(String(m)), warn: (m) => logs.push(String(m)) } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(dir + 'game-erp.gs', 'utf8'), ctx);
const J = (x) => JSON.parse(JSON.stringify(x));

// ---- Apps Script stubs: Script properties + one workbook per campus (tab -> values, header first)
let props = {}, books = {}, opened = 0, failOpen = false;
ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null) }) };
ctx.SpreadsheetApp = { openById(id) {
  opened++;
  if (failOpen) throw new Error('Document SHEETID-SECRET is missing');
  const b = books[id];
  if (!b) throw new Error('no book');
  return { getSheetByName: (n) => (b[n] ? { getDataRange: () => ({ getValues: () => b[n] }) } : null) };
} };

const TODAY = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const LMS4 = {
  // extra columns a Sheet must never leak: aadhaar, mobile, dob, photo
  Students: [['Enroll No', 'Name', 'Class', 'Section', 'Roll No', 'House', 'Status', 'Aadhaar', 'Mobile', 'DOB', 'Photo'],
    ['E002', 'Test Student 2', '7', 'A', '2', 'Red', 'Active', '999988887777', '9000000001', '2014-01-01', 'img_2'],
    ['E001', 'Test Student 1', '7', 'a', '1', 'Blue', '', '999988887776', '9000000002', '2014-01-02', 'img_1'],
    ['E003', 'Test Student 3', '7', 'B', '1', 'Red', 'Active', '', '', '', ''],
    ['E004', 'Test Student 4', '8', 'A', '1', 'Green', 'Active', '', '', '', ''],
    ['E005', 'Test Student 5', '7', 'A', '3', 'Red', 'Left', '', '', '', '']],
  Attendance: [['Date', 'Enroll No', 'Status'],
    [TODAY, 'E001', 'P'], [TODAY, 'E002', 'A'], [TODAY, 'E003', 'P'], [TODAY, 'E004', 'L'], [TODAY, 'E005', 'P'], ['2026-01-01', 'E001', 'P']],
  Marks: [['Session', 'Term', 'Exam', 'Subject', 'Enroll No', 'Max Marks', 'Marks'],
    ['2026', 'T1', 'UT1', 'Maths', 'E001', '20', '18'], ['2026', 'T1', 'UT1', 'English', 'E001', '20', 'AB'],
    ['2026', 'T1', 'UT1', 'Maths', 'E003', '20', '12.5'], ['2026', 'T1', 'UT1', 'Maths', 'E004', '20', '15']],
  Dues: [['Enroll No', 'Fee Head', 'Receivable', 'Received', 'Concession', 'Pending'],
    ['E001', 'Tuition', '10000', '4000', '0', '6000.4'], ['E001', 'Transport', '3,000', '3000', '0', '0'],
    ['E002', 'Tuition', '10000', '10000', '0', '0'], ['E004', 'Tuition', '12000', '2000', '500', '9500'], ['E005', 'Tuition', '9000', '0', '0', '9000']],
  Bus: [['Enroll No', 'Bus', 'Route', 'Pickup Point', 'Way'],
    ['E001', 'TEST-01', 'Route 1', 'Stop B', 'Both'], ['E002', 'test 01', '', 'Stop A', 'Pick'], ['E004', 'TEST02', 'Route 2', 'Stop C', 'Both'], ['E005', 'TEST01', 'Route 1', 'Stop A', 'Both']],
  Staff: [['Emp Code', 'Name', 'Designation', 'Department', 'Status', 'House', 'Mobile', 'Salary'],
    ['T100', 'Test Teacher B', 'TGT', 'Academics', 'Active', 'Red', '9000000009', '50000'], ['T101', 'Test Teacher A', 'PRT', 'Academics', 'Active', 'Blue', '', '']],
  Assignments: [['Emp Code', 'Email', 'Kind', 'Class', 'Section', 'Subject', 'Bus'],
    ['T100', '', 'class', '7', 'A', '', ''],
    ['', 'subj@test.invalid', 'subject', '7', '', 'maths', ''],
    ['A200', '', 'bus', '', '', '', 'TEST 01'],
    ['T999', '', 'class', '', '', '', '']], // malformed: no class -> ignored
};
const reset = () => { props = { ERP_SHEET_LMS4: 'book4' }; books = { book4: J(LMS4) }; failOpen = false; logs.length = 0; };
reset();

const owner = { email: 'owner@test.invalid', campusId: 'ALL', roles: ['Owner'] };
const principal = { email: 'p4@test.invalid', campusId: 'LMS4', roles: ['Principal'] };
const clerk = { email: 'clerk@test.invalid', campusId: 'LMS4', roles: ['FeeClerk'] };
const classT = { email: 'ct@test.invalid', campusId: 'LMS4', roles: ['Teacher'], employeeCode: 't100' };
const subjT = { email: 'SUBJ@test.invalid', campusId: 'LMS4', roles: ['Teacher'] };
const busI = { email: 'att@test.invalid', campusId: 'LMS4', roles: ['Staff'], employeeCode: 'A200' };
const coord = { email: 'coord@test.invalid', campusId: 'ALL', roles: ['Coordinator'] };
const read = (caller, p) => J(ctx.GAME_MODULE_ACTIONS.erpread(caller, p));
const denied = (r) => r.success === false && r.code === 'ERP_NOT_ALLOWED';

// ---- registration: one GET action, no missions or quests
assert.strictEqual(typeof ctx.GAME_MODULE_ACTIONS.erpread, 'function');
assert.deepStrictEqual(Object.keys(ctx.GAME_MODULE_ACTIONS), ['erpread']);
assert.deepStrictEqual(J(ctx.GAME_MODULE_MISSIONS), {});
assert.deepStrictEqual(J(ctx.GAME_MODULE_QUESTS), {});
assert.ok(/if \(action === 'erpdriverbus'\) return gameJson_\(erpDriverBus_\(body\)\);/.test(fs.readFileSync(dir + 'game.gs', 'utf8')), 'the one doPost line');
assert.ok(!/ERP_SHEET_LMS\d['"]?\s*[:=]\s*['"]1/.test(fs.readFileSync(dir + 'game-erp.gs', 'utf8')), 'no Sheet id in code');

// ---- Principal: own campus, every dataset, columns projected (no Aadhaar/phone/DOB/photo), inactive dropped, sorted
let r = read(principal, { what: 'students' });
assert.strictEqual(r.success, true); assert.strictEqual(r.campus, 'LMS4'); assert.strictEqual(r.configured, true);
assert.deepStrictEqual(r.rows.map((s) => s.enrollNo), ['E001', 'E002', 'E003', 'E004']);
assert.deepStrictEqual(Object.keys(r.rows[0]).sort(), ['class', 'enrollNo', 'house', 'name', 'rollNo', 'section']);
assert.ok(!/9999888877|900000000|2014-01|img_/.test(JSON.stringify(r)), 'no PII column leaks');
assert.strictEqual(r.count, 4);
assert.deepStrictEqual(read(principal, { what: 'students', house: 'red' }).rows.map((s) => s.enrollNo), ['E002', 'E003']);
r = read(principal, { what: 'staff' });
assert.deepStrictEqual(r.rows.map((s) => s.name), ['Test Teacher A', 'Test Teacher B']);
assert.ok(!/9000000009|50000/.test(JSON.stringify(r)), 'no staff phone or salary');
assert.ok(denied(read(principal, { what: 'students', campus: 'LMS1' })), 'another campus');
assert.ok(denied(read(Object.assign({}, principal, { campusId: 'ALL' }), { what: 'students', campus: 'LMS4' })), 'a non-Owner ALL is nothing');

// ---- empty state: no Sheet id = configured false, a note, never an error; missing tab listed
r = read(principal, { what: 'students', campus: 'LMS4' }); assert.ok(r.configured);
const p5 = Object.assign({}, principal, { campusId: 'LMS5' });
r = read(p5, { what: 'dues' });
assert.deepStrictEqual(r, { success: true, what: 'dues', campus: 'LMS5', configured: false, missing: [], count: 0, rows: [], note: "ERP data for LMS 5 isn't connected yet.", totalPending: 0, classes: [] });
delete books.book4.Attendance;
r = read(principal, { what: 'attendance' });
assert.deepStrictEqual(r.missing, ['Attendance']); assert.deepStrictEqual(r.rows, []);
reset();

// ---- Owner: any campus, must name it; scope lists all six
assert.strictEqual(read(owner, { what: 'students' }).code, 'ERP_BAD_REQUEST');
assert.strictEqual(read(owner, { what: 'marks', campus: 'lms 4' }).count, 4);
r = read(owner, { what: 'scope' });
assert.strictEqual(r.campuses.length, 6);
assert.deepStrictEqual(r.campuses.filter((c) => c.configured).map((c) => c.campus), ['LMS4']);
assert.deepStrictEqual(r.campuses[3].can, ['students', 'attendance', 'marks', 'dues', 'bus', 'staff']);

// ---- Fee Clerk: students, dues, bus; never marks, attendance or staff. Dues shape: whole rupees, pending > 0 only, class roll-up
r = read(clerk, { what: 'dues' });
assert.deepStrictEqual(r.rows, [
  { enrollNo: 'E001', name: 'Test Student 1', class: '7', section: 'a', receivable: 13000, received: 7000, concession: 0, pending: 6000, heads: [{ feeHead: 'Tuition', pending: 6000 }] },
  { enrollNo: 'E004', name: 'Test Student 4', class: '8', section: 'A', receivable: 12000, received: 2000, concession: 500, pending: 9500, heads: [{ feeHead: 'Tuition', pending: 9500 }] }]);
assert.strictEqual(r.totalPending, 15500);
assert.deepStrictEqual(r.classes, [{ class: '7', section: 'a', count: 1, pending: 6000 }, { class: '8', section: 'A', count: 1, pending: 9500 }]);
assert.strictEqual(read(clerk, { what: 'dues', class: '8' }).totalPending, 9500);
['marks', 'attendance', 'staff'].forEach((w) => assert.ok(denied(read(clerk, { what: w })), 'clerk ' + w));
assert.strictEqual(read(clerk, { what: 'bus' }).count, 2);

// ---- class teacher (employee code, case-insensitive): their class-section only, every subject; no dues/bus/staff
r = read(classT, { what: 'students' });
assert.deepStrictEqual(r.rows.map((s) => s.enrollNo), ['E001', 'E002']);
assert.deepStrictEqual(read(classT, { what: 'marks' }).rows.map((m) => m.subject).sort(), ['English', 'Maths']);
assert.ok(denied(read(classT, { what: 'students', class: '8' })), 'a class filter outside the tie is refused');
assert.ok(denied(read(classT, { what: 'students', class: '7', section: 'B' })));
assert.strictEqual(read(classT, { what: 'students', class: '7', section: 'a' }).count, 2);
['dues', 'bus', 'staff'].forEach((w) => assert.ok(denied(read(classT, { what: w })), 'class teacher ' + w));
assert.ok(denied(read(classT, { what: 'students', campus: 'LMS1' })));
r = read(classT, { what: 'attendance' });
assert.deepStrictEqual(r.rows.map((a) => a.enrollNo + a.status), ['E001P', 'E002A']);
assert.deepStrictEqual(r.summary[TODAY], { P: 1, A: 1, L: 0, H: 0, total: 2 });

// ---- subject teacher (email, any case; tie with no section = the whole class): every 7 section, Maths marks only
r = read(subjT, { what: 'marks' });
assert.deepStrictEqual(r.rows.map((m) => m.enrollNo + m.subject), ['E001Maths', 'E003Maths']);
assert.ok(denied(read(subjT, { what: 'marks', subject: 'English' })));
assert.deepStrictEqual(read(subjT, { what: 'students' }).rows.map((s) => s.enrollNo), ['E001', 'E002', 'E003']);
// the teacher module's code lookup is used when the caller carries no code
ctx.tchCodeFor_ = () => 'T100';
assert.strictEqual(read({ email: 'other@test.invalid', campusId: 'LMS4', roles: ['Teacher'] }, { what: 'students' }).count, 2);
delete ctx.tchCodeFor_;

// ---- no tie: refused once the Sheet is connected; the empty state while it isn't
const lone = { email: 'lone@test.invalid', campusId: 'LMS4', roles: ['Teacher'], employeeCode: 'T555' };
assert.ok(denied(read(lone, { what: 'students' })));
r = read(Object.assign({}, lone, { campusId: 'LMS5' }), { what: 'students' });
assert.strictEqual(r.configured, false); assert.deepStrictEqual(r.rows, []);
r = read(lone, { what: 'scope' });
assert.deepStrictEqual(r.campuses, [{ campus: 'LMS4', configured: true, can: [] }]); assert.deepStrictEqual(r.ties, []);

// ---- bus in-charge: their bus only (registration spacing ignored), active students only, nothing else
r = read(busI, { what: 'bus' });
assert.strictEqual(r.count, 1);
assert.strictEqual(r.rows[0].route, 'Route 1');
assert.deepStrictEqual(r.rows[0].students.map((s) => s.pickupPoint + ':' + s.enrollNo), ['Stop A:E002', 'Stop B:E001']);
assert.ok(denied(read(busI, { what: 'bus', bus: 'TEST02' })));
assert.ok(denied(read(busI, { what: 'students' })));
r = read(busI, { what: 'scope' });
assert.deepStrictEqual(r.campuses[0].can, ['bus']);
assert.deepStrictEqual(r.ties, [{ campus: 'LMS4', kind: 'bus', class: '', section: '', subject: '', bus: 'TEST01' }]);

// ---- union: a Principal who is also a class teacher keeps the whole campus
assert.strictEqual(read(Object.assign({}, principal, { roles: ['Principal', 'Teacher'], employeeCode: 'T100' }), { what: 'students' }).count, 4);
// comma campus list
assert.strictEqual(read(Object.assign({}, clerk, { campusId: 'LMS4,LMS5' }), { what: 'students', campus: 'LMS5' }).configured, false);

// ---- Coordinator and Accounts: no ERP scope
assert.ok(denied(read(coord, { what: 'bus', campus: 'LMS4' })));
assert.ok(denied(read({ email: 'acc@test.invalid', campusId: 'LMS4', roles: ['Accounts'] }, { what: 'dues' })));
assert.deepStrictEqual(read(coord, { what: 'scope' }).campuses, []);

// ---- bad requests
assert.strictEqual(read(principal, { what: 'photos' }).code, 'ERP_BAD_REQUEST');
assert.strictEqual(read(principal, { what: 'attendance', from: '2026-10-01', to: '2026-11-05' }).code, 'ERP_BAD_REQUEST');
assert.strictEqual(read(principal, { what: 'attendance', from: '2026-11-05', to: '2026-11-01' }).code, 'ERP_BAD_REQUEST');
assert.strictEqual(read(principal, { what: 'attendance', from: 'yesterday' }).code, 'ERP_BAD_REQUEST');
assert.strictEqual(read(principal, { what: 'attendance', from: '2026-01-01' }).count, 1, 'from alone = that day');

// ---- a read failure: a plain error, and the log never carries the error text (it could name the Sheet)
logs.length = 0; failOpen = true;
r = read(principal, { what: 'students' });
assert.strictEqual(r.code, 'ERP_READ_FAILED');
assert.ok(!/SHEETID/.test(JSON.stringify(r) + logs.join('\n')));
reset();

// ---- driver phone: unavailable without driver-token.gs; own bus, names, no enroll numbers; unknown token refused
let b = J(ctx.erpDriverBus_({ deviceToken: 'a'.repeat(64) }));
assert.strictEqual(b.code, 'ERP_DRIVER_UNAVAILABLE');
ctx.dlkLink_ = (t) => (t === 'a'.repeat(64) ? { reg: 'TEST01', campus: 'LMS 4', name: 'x' } : null);
b = J(ctx.erpDriverBus_({ deviceToken: 'a'.repeat(64) }));
assert.strictEqual(b.success, true); assert.strictEqual(b.count, 2);
assert.deepStrictEqual(b.students, [{ name: 'Test Student 2', class: '7', section: 'A', pickupPoint: 'Stop A', way: 'Pick' }, { name: 'Test Student 1', class: '7', section: 'a', pickupPoint: 'Stop B', way: 'Both' }]);
assert.strictEqual(J(ctx.erpDriverBus_({ deviceToken: 'b'.repeat(64) })).code, 'ERP_DRIVER_UNLINKED');
assert.strictEqual(J(ctx.erpDriverBus_({})).code, 'ERP_DRIVER_UNLINKED');
ctx.dlkLink_ = () => ({ reg: 'TEST09', campus: 'LMS 5' });
b = J(ctx.erpDriverBus_({ deviceToken: 'a'.repeat(64) }));
assert.strictEqual(b.configured, false); assert.strictEqual(b.count, 0);
delete ctx.dlkLink_;

// ---- every log line so far: counts only (no name, enroll number or email ever)
reset();
[principal, owner, clerk, classT, subjT, busI].forEach((c) => ['scope', 'students', 'attendance', 'marks', 'dues', 'bus', 'staff'].forEach((w) => read(c, { what: w, campus: 'LMS4' })));
assert.ok(logs.length > 10);
logs.forEach((l) => {
  assert.ok(!/Test Student|Test Teacher|E00\d|T10\d|@|TEST/.test(l), 'PII in a log line: ' + l);
  assert.ok(/^erpread \w+ (LMS\d|all) rows=\d+$/.test(l) || /failed: ERP_READ_FAILED$/.test(l), 'log shape: ' + l);
});

console.log('test-game-erp: all passed');
