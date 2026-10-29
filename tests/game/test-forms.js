// node tests/game/test-forms.js -- standalone forms into gameplay, batch 1 (game-forms.gs; docs/forms-inventory.md). One block per mission
// kind: where it sits (panel), where it links, its reward (core = counts toward days on track), what makes it done, and who sees it. Synthetic data only.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const dir = __dirname + '/../../apps-script/';
const ctx = { console: Object.assign(Object.create(console), { error() {} }), Logger: { log() {} } };
vm.createContext(ctx);
const load = (f) => vm.runInContext(fs.readFileSync(dir + f, 'utf8'), ctx);
load('game-forms.gs'); load('game-office.gs'); load('game.gs'); load('game-actions.gs'); load('game-missions.gs'); load('game-windows.gs'); load('game-quests.gs');
const J = (x) => JSON.parse(JSON.stringify(x));
const ok = (m) => console.log('ok  - ' + m);

// Apps Script services: a recording UrlFetchApp (GET and POST), a cache, Script Properties, the Approvals sheet
let store = {}, props = {}, calls = [], answer, approvals = null;
ctx.CacheService = { getScriptCache: () => ({ get: (k) => (k in store ? store[k] : null), put: (k, v) => { store[k] = v; } }) };
ctx.Utilities = { DigestAlgorithm: { MD5: 'md5' }, computeDigest: (a, t) => Array.from(require('crypto').createHash('md5').update(t).digest()), base64EncodeWebSafe: (b) => Buffer.from(b).toString('base64url') };
ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null) }) };
ctx.UrlFetchApp = { fetch: (url, opts) => { calls.push({ url, opts }); const a = answer(url, opts); return { getResponseCode: () => a.code || 200, getContentText: () => a.body }; } };
ctx.SpreadsheetApp = { openById: () => ({ getSheetByName: (n) => { if (n !== 'Approvals' || !approvals) throw new Error('no sheet'); return { getDataRange: () => ({ getValues: () => approvals }) }; } }) };
const body = (o) => ({ body: JSON.stringify(Object.assign({ success: true }, o)) });
const reset = (fn) => { store = {}; calls = []; answer = fn; };

const NOW = new Date('2026-10-29T05:00:00Z'), DAY = '2026-10-29', YDAY = '2026-10-28', cfg = J(ctx.gameConfigDefaults_()); // 10:30 IST
const clerk = { email: 'Clerk@test.invalid', campusId: 'LMS4', roles: ['FeeClerk'], primaryRole: 'FeeClerk', idToken: 'tok-clerk' };
const acc = { email: 'acc@test.invalid', campusId: 'ALL', roles: ['Accounts'], primaryRole: 'Accounts', idToken: 'tok-acc' };
const coordAcc = { email: 'ca@test.invalid', campusId: 'LMS4', roles: ['Coordinator', 'Accounts'], primaryRole: 'Coordinator', idToken: 'tok-ca' };
const coord = { email: 'co@test.invalid', campusId: 'LMS4', roles: ['Coordinator'], primaryRole: 'Coordinator', idToken: 'tok-co' };
const owner = { email: 'owner@test.invalid', campusId: 'ALL', roles: ['Owner'], primaryRole: 'Owner', idToken: 'tok-owner' };
const principal = { email: 'p4@test.invalid', campusId: 'LMS4', roles: ['Principal'], primaryRole: 'Principal', idToken: 'tok-p' };
const teacher = { email: 't4@test.invalid', campusId: 'LMS4', roles: ['Teacher'], primaryRole: 'Teacher', idToken: 'tok-t' };
const by = (ms) => { const o = {}; ms.forEach((m) => { o[m.id] = m; }); return o; };
const officeUrl = /OFFICE_BACKEND_URL = '([^']+)'/.exec(fs.readFileSync(__dirname + '/../../office/js/config.js', 'utf8'))[1];
const projects = JSON.parse(fs.readFileSync(dir + 'projects.json', 'utf8'));

// ---- registration: the right roles, and the file is pushed with the game project
const hooks = (role) => J(ctx.gameModuleHooks_(ctx.GAME_MODULE_MISSIONS, role).map((f) => f.name));
assert.deepStrictEqual(hooks('FeeClerk').filter((n) => /^forms/.test(n)), ['formsDeskMissions_', 'formsFillMissions_', 'formsHireMissions_']);
assert.ok(hooks('Accounts').includes('formsDeskMissions_') && hooks('Coordinator').includes('formsDeskMissions_'));
for (const r of ['Principal', 'Teacher', 'Staff']) assert.ok(hooks(r).includes('formsRequestMissions_'), r);
assert.ok(!hooks('Owner').some((n) => /^forms/.test(n)), 'the Owner gets none: their view is the Kingdom');
assert.ok(projects.game.files.includes('game-forms'));
ok('registered for the roles in the inventory; the Owner gets none; pushed with the game project');

// ---- O7 / O8 / O9 (Office today.summary): the desk's Daily rows
const SUM = (over) => ({ date: DAY, yesterday: YDAY, campuses: Object.assign({
  LMS4: { can: { report: true, close: false }, day: { booked: true, cash: true, banked: false, erp: true, closed: false, unsigned: 0 },
    tasks: [{ id: 'deposit:2026-10-24', title: 'Deposit fee cash for 2026-10-24', status: 'overdue', action: 'deposits' }, { id: 'deposit:' + YDAY, status: 'due', action: 'deposits' },
      { id: 'report:' + DAY, title: 'Submit the daily report', status: 'due', action: 'report' }],
    handovers: [{ id: 'h1', from: 'LMS1', date: YDAY, state: 'pending' }, { id: 'h0', from: 'LMS2', date: '2026-10-27', state: 'accepted' }] },
}, over || {}) });
let m = by(J(ctx.formsDeskList_(SUM(), 'clerk@test.invalid', DAY)));
const rep = m['desk_report:LMS4:' + DAY];
assert.deepStrictEqual([rep.panel, rep.go, rep.core, rep.done, rep.title, rep.why], ['daily', 'office/report.html', true, false, "File today's office report for LMS 4", 'Due by 6 pm']);
const dep = m['desk_deposit:LMS4:' + YDAY + ':' + DAY], erp = m['desk_erp:LMS4:' + YDAY + ':' + DAY];
assert.deepStrictEqual([dep.panel, dep.go, dep.core, dep.done, dep.title], ['daily', 'office/deposits.html', true, false, "Bank Wed 28 Oct's fee cash for LMS 4"]);
assert.deepStrictEqual([erp.panel, erp.core, erp.done, erp.doneBy], ['daily', true, true, 'clerk@test.invalid'], 'ERP total entered: done, credited to the desk');
assert.ok(!m['desk_deposit_late:LMS4:' + YDAY], 'yesterday is the core row, not a second late one');
const late = m['desk_deposit_late:LMS4:2026-10-24'];
assert.deepStrictEqual([late.panel, late.core, late.why, late.due, late.title], ['daily', false, 'Overdue', '2026-10-24', "Bank Sat 24 Oct's fee cash for LMS 4"]);
assert.ok(!Object.keys(m).some((id) => /^desk_(close|sign)/.test(id)), 'a Fee Clerk is not asked to close days or sign deposits');
// the core rows are day-scoped: one left undone counts as missed when the day is finalized, as pdr_report does
for (const id of [rep.id, dep.id, erp.id]) assert.ok(id.endsWith(':' + DAY), id);
const f = ctx.gameFinalizeDay_({ missionIds: [dep.id], doneIds: [], coreIds: [dep.id] }, [], DAY, null);
assert.deepStrictEqual(J(f), { counted: true, onTrack: false }, 'gone tomorrow, never seen done: a missed day');
// a quiet day (no fee cash taken yesterday): nothing to bank, no ERP row; the report is done once filed
m = by(J(ctx.formsDeskList_(SUM({ LMS4: { can: { report: true, close: false }, day: { booked: false, cash: false }, tasks: [{ id: 'report:' + DAY, status: 'done', action: 'report' }], handovers: [] } }), 'c@x', DAY)));
assert.deepStrictEqual(Object.keys(m), ['desk_report:LMS4:' + DAY]); assert.strictEqual(m['desk_report:LMS4:' + DAY].done, true);
ok('O8 report, O7 deposit + ERP total: Daily, core (days on track), done from the Office data; older deposits as extra Daily rows');

// O9: the Finance Head seals yesterday, closes older days first, signs deposits
const FH = SUM({ LMS4: { can: { report: false, close: true }, day: { booked: true, cash: true, banked: true, erp: true, closed: false, unsigned: 1 },
  tasks: [{ id: 'close:2026-10-26', status: 'due', action: 'close' }, { id: 'sign:' + YDAY, title: 'Sign 1 deposit for ' + YDAY, status: 'due', action: 'deposits' }], handovers: [{ id: 'h1', from: 'LMS1', date: YDAY, state: 'pending' }] },
  HES: { can: { report: false, close: true }, day: null, tasks: [], handovers: [] } });
m = by(J(ctx.formsDeskList_(FH, 'acc@test.invalid', DAY)));
const seal = m['desk_close:LMS4:' + YDAY + ':' + DAY];
assert.deepStrictEqual([seal.panel, seal.go, seal.core, seal.done, seal.title], ['daily', 'office/close.html', true, false, 'Seal Wed 28 Oct for LMS 4']);
assert.deepStrictEqual([m['desk_close_late:LMS4:2026-10-26'].title, m['desk_close_late:LMS4:2026-10-26'].core], ['Close Mon 26 Oct for LMS 4 first', false]);
assert.deepStrictEqual([m['desk_sign:LMS4:' + YDAY].title, m['desk_sign:LMS4:' + YDAY].go, m['desk_sign:LMS4:' + YDAY].panel], ['Sign the deposit for Wed 28 Oct at LMS 4', 'office/deposits.html', 'daily']);
assert.ok(!Object.keys(m).some((id) => /^desk_(report|deposit|erp|handover)/.test(id)), 'the Finance Head does not file the report, bank cash or count handovers');
assert.ok(!Object.keys(m).some((id) => /HES/.test(id)), 'no book yesterday at HES: nothing to seal');
FH.campuses.LMS4.day.closed = true;
assert.strictEqual(ctx.formsDeskList_(FH, 'acc@test.invalid', DAY).filter((x) => x.kind === 'desk_close')[0].done, true);
ok('O9 close day: Daily, core; older open days and unsigned deposits as extra Daily rows; Finance Head only');

// O4: cash handed over to this school: a Town row for the receiving desk, ✓ once accepted
m = by(J(ctx.formsDeskList_(SUM(), 'clerk@test.invalid', DAY)));
assert.deepStrictEqual([m['desk_handover:h1'].panel, m['desk_handover:h1'].go, m['desk_handover:h1'].done, m['desk_handover:h1'].title], ['town', 'office/index.html#handovers', false, 'Accept the cash LMS 1 handed over on Wed 28 Oct']);
assert.deepStrictEqual([m['desk_handover:h0'].done, m['desk_handover:h0'].core], [true, false]);
ok('O4 cash handover accept: a Town row for the receiver, done once accepted');

// the hook: one GET to the Office as the caller; a failure marks the day down (the core rows depend on it); who calls at all
reset((url) => body(SUM()));
const got = J(ctx.formsDeskMissions_(clerk, cfg, NOW));
assert.strictEqual(calls.length, 1); assert.strictEqual(calls[0].url, officeUrl + '?action=today.summary&idToken=tok-clerk');
assert.ok(got.some((x) => x.id === 'desk_report:LMS4:' + DAY));
reset(() => ({ body: JSON.stringify({ success: false, error: 'FORBIDDEN_ROLE' }) }));
assert.throws(() => ctx.formsDeskMissions_(clerk, cfg, NOW), /today\.summary failed/);
reset(() => body(SUM()));
assert.strictEqual(ctx.formsDeskMissions_(coordAcc, cfg, NOW).length > 0, true, 'a Coordinator who also holds Accounts');
for (const c of [coord, owner, principal, teacher]) assert.deepStrictEqual(J(ctx.formsDeskMissions_(c, cfg, NOW)), [], c.primaryRole + ': no desk');
assert.strictEqual(calls.length, 1, 'only the desk roles call the Office');
ok('desk hook: one Office call as the caller; an Office failure throws (day marked down); a Coordinator, Principal, Teacher or the Owner never calls');

// ---- O10 driver fuel fills (Roster driverfilllist, POST): a Wilderness row per pending fill
const since = ctx.gameLookbackStart_(NOW);
const FILLS = [
  { fillId: 'F1', reg: 'HP34A1234', campus: 'LMS4', filledAt: '2026-10-28T03:30:00Z', status: 'pending', decidedAt: '', decidedBy: '' },
  { fillId: 'F2', reg: 'HP34A1234', campus: 'LMS4', filledAt: '2026-10-27T03:30:00Z', status: 'confirmed', decidedAt: '2026-10-28T09:00:00Z', decidedBy: 'Clerk@test.invalid' },
  { fillId: 'F3', reg: 'HP34B9', campus: 'LMS4', filledAt: '2026-10-20T03:30:00Z', status: 'rejected', decidedAt: '2026-10-21T09:00:00Z', decidedBy: 'clerk@test.invalid' },
];
m = by(J(ctx.formsFillList_(FILLS, 'clerk@test.invalid', since)));
assert.deepStrictEqual(Object.keys(m), ['desk_fill:F1', 'desk_fill:F2'], 'a fill decided a week ago is history');
assert.deepStrictEqual([m['desk_fill:F1'].panel, m['desk_fill:F1'].go, m['desk_fill:F1'].done, m['desk_fill:F1'].title], ['wild', 'office/driver-fills.html', false, 'Check the fuel fill for HP34A1234 on Wed 28 Oct']);
assert.deepStrictEqual([m['desk_fill:F2'].done, m['desk_fill:F2'].shared, m['desk_fill:F2'].why, m['desk_fill:F2'].doneBy], [true, false, 'Confirmed', 'clerk@test.invalid']);
reset((url, opts) => body({ fills: FILLS.map((x) => Object.assign({ driverName: 'Somebody', amount: 1, billFileId: 'b' }, x)) }));
const fills = J(ctx.formsFillMissions_(clerk, cfg, NOW));
assert.strictEqual(fills.length, 2);
assert.strictEqual(calls[0].url, ctx.FORMS_ROSTER_URL); assert.strictEqual(calls[0].opts.method, 'post');
assert.deepStrictEqual(JSON.parse(calls[0].opts.payload), { idToken: 'tok-clerk', action: 'driverfilllist' });
assert.ok(ctx.FORMS_ROSTER_URL.includes(projects.roster.deploymentId), 'the Roster /exec');
assert.ok(!Object.values(store).some((v) => /Somebody|billFileId|amount/.test(v)), 'the cache keeps no driver name, amount or file id');
reset(() => ({ code: 500, body: 'x' }));
assert.deepStrictEqual(J(ctx.formsFillMissions_(clerk, cfg, NOW)), [], 'a Roster outage drops only these rows');
assert.deepStrictEqual(J(ctx.formsFillMissions_(acc, cfg, NOW)), []); assert.strictEqual(calls.length, 1);
ok('O10 driver fills: Wilderness, done once confirmed or rejected; one POST as the Fee Clerk; nothing private cached');

// ---- O11 / O12 hiring legwork (PDR hiringapplicants): Town rows
const APPS = [
  { id: 'A1', name: 'Asha', status: 'Shortlisted', campus: 'LMS4', appointments: [] },
  { id: 'A2', name: 'Bina', status: 'Shortlisted', campus: 'LMS4', appointments: [{ id: 'P1', kind: 'interview', start: '2026-10-30T05:00:00Z', status: 'proposed' }] },
  { id: 'A3', name: 'Chetan', status: 'Interview Done', campus: 'LMS4', appointments: [{ id: 'P2', kind: 'interview', start: '2026-10-28T05:00:00Z', status: 'accepted', reportFiled: false }] },
  { id: 'A4', name: 'Dev', status: 'Demo Done', campus: 'LMS4', appointments: [{ id: 'P3', kind: 'demo', start: '2026-10-28T06:00:00Z', status: 'accepted', reportFiled: true }, { id: 'P4', kind: 'interview', start: '2026-10-01T05:00:00Z', status: 'accepted', reportFiled: true }] },
];
m = by(J(ctx.formsHireList_(APPS, 'clerk@test.invalid', NOW.getTime(), since)));
assert.deepStrictEqual(Object.keys(m).sort(), ['desk_hire_book:A1', 'desk_hire_demo:A3', 'desk_hire_report:P2', 'desk_hire_report:P3'], 'Bina has a time proposed; Dev\'s older report is history');
assert.deepStrictEqual([m['desk_hire_book:A1'].title, m['desk_hire_book:A1'].panel, m['desk_hire_book:A1'].go], ["Book Asha's interview", 'town', 'office/hiring.html']);
assert.deepStrictEqual([m['desk_hire_report:P2'].title, m['desk_hire_report:P2'].done], ["Upload Chetan's interview report", false]);
assert.strictEqual(m['desk_hire_report:P3'].done, true, 'filed since yesterday: shows done');
assert.strictEqual(m['desk_hire_demo:A3'].title, "Book Chetan's demo class", 'O11: Interview Done with no demo open (hirLegwork_ demosToBook)');
APPS[2].appointments.push({ id: 'P5', kind: 'demo', start: '2026-10-31T05:00:00Z', status: 'proposed' });
assert.ok(!ctx.formsHireList_(APPS, 'c', NOW.getTime(), since).some((x) => x.id === 'desk_hire_demo:A3'), 'a demo time proposed: nothing to book');
reset((url) => body({ applicants: [{ applicantId: 'A1', row: 9, name: 'Asha', phoneNorm: '9999999999', status: 'Shortlisted', campusId: 'LMS4', appointments: [] }] }));
assert.strictEqual(J(ctx.formsHireMissions_(clerk, cfg, NOW))[0].id, 'desk_hire_book:A1');
assert.ok(calls[0].url.startsWith(vm.runInContext('GAME_PDR_URL', ctx) + '?action=hiringapplicants&idToken=tok-clerk'));
assert.ok(!Object.values(store).some((v) => /9999999999/.test(v)), 'no phone number in the cache');
ok('O11 book interview / demo, O12 upload report: Town rows from the hiring legwork rules; no phone cached');

// ---- P5 / T1: the person's own request waits as a Town row
const H = ['Id', 'Campus', 'c2', 'c3', 'Title', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'RequestedBy', 'RequestedAt', 'Status', 'DecidedBy', 'DecidedAt', 'c16', 'c17', 'Archived'];
const row = (id, title, byEmail, at, status, decidedAt, archived) => [id, 'LMS4', '', '', title, '', '', '', '', '', '', byEmail, at, status, decidedAt ? 'owner@test.invalid' : '', decidedAt || '', '', '', archived ? 'TRUE' : ''];
approvals = [H,
  row('R1', 'Science lab kit', 'p4@test.invalid', '2026-10-25T05:00:00Z', 'Pending'),
  row('R2', 'Annual day', 'p4@test.invalid', '2026-10-20T05:00:00Z', 'Approved', '2026-10-28T10:00:00Z'),
  row('R3', 'Old trip', 'p4@test.invalid', '2026-09-20T05:00:00Z', 'Rejected', '2026-09-22T10:00:00Z'),
  row('R4', 'More info please', 'p4@test.invalid', '2026-10-27T05:00:00Z', 'Info Requested'),
  row('R5', 'Someone else', 'other@test.invalid', '2026-10-27T05:00:00Z', 'Pending'),
  row('R6', 'Archived one', 'p4@test.invalid', '2026-10-27T05:00:00Z', 'Pending', '', true),
  row('L1', 'Leave 2 days', 't4@test.invalid', '2026-10-28T05:00:00Z', 'Pending')];
m = by(J(ctx.formsRequestMissions_(principal, cfg, NOW)));
assert.deepStrictEqual(Object.keys(m), ['request_wait:R1', 'request_wait:R2'], 'own rows only; decided long ago, Info Requested (its own mission) and archived are left out');
assert.deepStrictEqual([m['request_wait:R1'].panel, m['request_wait:R1'].go, m['request_wait:R1'].title, m['request_wait:R1'].why, m['request_wait:R1'].shared, m['request_wait:R1'].core],
  ['town', 'principals-daily-reporting/index.html#approvals', 'Management is deciding “Science lab kit”', 'Waiting 4 days', true, false]);
assert.deepStrictEqual([m['request_wait:R2'].done, m['request_wait:R2'].why, m['request_wait:R2'].title], [true, 'Approved', 'Management decided “Annual day”']);
const t = J(ctx.formsRequestMissions_(teacher, cfg, NOW));
assert.deepStrictEqual(t.map((x) => [x.id, x.go]), [['request_wait:L1', 'teacher/index.html#panel-requests']]);
assert.deepStrictEqual(J(ctx.formsRequestMissions_(Object.assign({}, owner, { primaryRole: 'Principal', viewAs: true }), cfg, NOW)), [], "the Owner's look at a school shows no requests");
assert.deepStrictEqual(J(ctx.formsRequestMissions_(coord, cfg, NOW)), []);
approvals = null;
assert.deepStrictEqual(J(ctx.formsRequestMissions_(principal, cfg, NOW)), [], 'an unreadable sheet drops only these rows');
ok('P5 / T1 raise a request: a Town row while Management decides, done with the outcome; own requests only');

// ---- the links land on pages that exist, on a tab the page opens
const root = __dirname + '/../../';
for (const go of ['office/report.html', 'office/deposits.html', 'office/close.html', 'office/index.html', 'office/driver-fills.html', 'office/hiring.html',
  'principals-daily-reporting/index.html', 'teacher/index.html', 'coordinator/transport/live.html']) assert.ok(fs.existsSync(root + go), go);
assert.ok(/id="handovers"/.test(fs.readFileSync(root + 'office/index.html', 'utf8')), 'the office home has the handover section');
const principalHome = fs.readFileSync(root + 'principal/index.html', 'utf8');
assert.ok(/name: 'Raise a request', e: 'requests', url: '\.\.\/principals-daily-reporting\/index\.html#approvals'/.test(principalHome), 'P5: a room action in the Daily work room');
assert.ok(/name: 'Request a new hire or a replacement', e: 'requests', url: '\.\.\/principals-daily-reporting\/index\.html#approvals'/.test(principalHome), 'P5 hiring: a room action in HR');
assert.ok(/C8/.test(fs.readFileSync(dir + 'game-fleet.gs', 'utf8')) && /'coordinator\/transport\/live\.html', due: t\.due/.test(fs.readFileSync(dir + 'game-fleet.gs', 'utf8')), 'C8: the Coordinator closes a transport follow-up on the live page');
ok('every link opens a page that exists; the Principal rooms carry "Raise a request"; C8 goes to the live page');

// ---- the drawer puts each row on its tab (assets/game/home-hud.js)
const HUD = require(root + 'assets/game/home-hud.js');
assert.deepStrictEqual([{ panel: 'daily' }, { panel: 'wild' }, { panel: 'town' }, { kind: 'fleet_ops_gps_dead' }, { kind: 'fleet_papers' }, { kind: 'pdr_report' }, { panel: 'nope', kind: 'x' }, null].map(HUD.panelOf),
  ['daily', 'wild', 'town', 'wild', 'wild', 'town', 'town', 'town']);
ok('the task drawer routes Daily, Wilderness (and every bus mission) and Town');
console.log('game forms batch 1: all checks passed');
