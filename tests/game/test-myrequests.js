// node tests/game/test-myrequests.js -- lms-game's New request + My requests (apps-script/game-myrequests.gs) over approvals.gs, run for
// real on synthetic rows (made-up people at x.test): the key gate; an email that resolves to nobody gets not_on_list; staff (Teacher,
// FeeClerk, Staff) see ONLY requests they filed, never the school, even a FeeClerk whom aprList_ alone would give the whole school; the
// school's Principal sees the school; detail and comments follow the same rule; the requester's reply flips Info Requested back to
// Pending; staff file only Compensatory Leave / Leave / Other, Leave only as a Teacher; leave refusals as codes; no email in any answer;
// every filed row carries the verified email. Loads every file of the pdr project (projects.json), so a global clash fails here too.
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const dir = path.join(__dirname, '../../apps-script');
const files = JSON.parse(fs.readFileSync(dir + '/projects.json'))['pdr'].files;
const src = files.map((f) => fs.readFileSync(`${dir}/${f}.gs`, 'utf8')).join('\n;\n');
const ctx = vm.createContext({ console: { log() {}, error() {} }, Logger: { log() {} }, PropertiesService: {}, SpreadsheetApp: {}, CacheService: {}, UrlFetchApp: {}, ContentService: {}, Utilities: {}, Session: {}, DriveApp: {}, CalendarApp: {}, LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) }, ScriptApp: {}, HtmlService: {}, MailApp: {}, GmailApp: {}, FormApp: {}, DocumentApp: {}, Drive: {} });
vm.runInContext(src, ctx, { filename: 'pdr-project.gs' });
// synthetic rows: made-up people at x.test
vm.runInContext(`
var ROWS = [new Array(33).fill('hdr')];
function mk(id, campus, cat, by, status) { var r = new Array(33).fill(''); r[0]=id; r[1]=campus; r[2]=cat; r[3]='Normal'; r[4]='T '+id; r[5]='D'; r[11]=by; r[12]='2026-11-1'+id.slice(-1)+'T05:00:00.000Z'; r[13]=status; return r; }
ROWS.push(mk('apr-1','LMS2','Other','teach@x.test','Pending'), mk('apr-2','LMS2','Financial / Purchase','prin@x.test','Approved'),
  mk('apr-3','LMS2','Other','clerk@x.test','Info Requested'), mk('apr-4','LMS3','Other','teach@x.test','Pending'));
var COMMENTS = [['id','approvalId','authorEmail','role','body','at'], ['cmt-1','apr-3','prin@x.test','Principal','Need the bill','2026-11-12']];
var APPENDED = [], MAILS = 0;
var PEOPLE = { 'teach@x.test': { roles: ['Teacher'], campusId: 'LMS2', role: 'Teacher' }, 'prin@x.test': { roles: ['Principal'], campusId: 'LMS2', role: 'Principal' },
  'clerk@x.test': { roles: ['FeeClerk'], campusId: 'LMS2', role: 'FeeClerk' }, 'drv@x.test': { roles: ['Staff'], campusId: 'LMS2', role: 'Staff' } };
pdrCallerForEmail_ = function (e) { var p = PEOPLE[String(e||'').toLowerCase()]; return p ? Object.assign({ email: String(e).toLowerCase(), name: '', canApprove: false }, p) : null; };
gameKeyOk_ = function (b) { return b.key === 'k'; };
gameNames_ = function () { return { 'teach@x.test': 'Teacher One', 'prin@x.test': 'Principal Two', 'clerk@x.test': 'Clerk Three' }; };
aprValues_ = function () { return ROWS; };
aprAnnotateAwaitingMd_ = function () {};
aprComments_ = function (id) { return COMMENTS.slice(1).filter(function (c) { return c[1] === id; }).map(function (c) { return { id: c[0], authorEmail: c[2], body: c[4], postedAt: c[5] }; }); };
aprSheet_ = function () { return { getDataRange: function () { return { getValues: function () { return ROWS; } }; }, getRange: function (r, c) { return { setValue: function (v) { ROWS[r-1][c-1] = v; } }; } }; };
aprCommentsSheet_ = function () { return { appendRow: function (r) { COMMENTS.push(r); }, getDataRange: function () { return { getValues: function () { return COMMENTS; } }; } }; };
aprNotifyThread_ = function () { MAILS++; }; aprNotifyDeciders_ = function () { MAILS++; };
aprAppendRequest_ = function (caller, body, category, title, description, amountVal, showsItem, showsQty, campusId, leave) { APPENDED.push({ by: caller.email, category: category, title: title, campusId: campusId, leave: leave }); return { success: true, id: 'apr-new' }; };
aprLvHolidays_ = function () { return {}; };
aprLvNowIst_ = function () { return { iso: '2026-11-14', hour: 9 }; };
aprLvEnsureColumns_ = function () {};
`, ctx);
const call = (email, action, params = {}, campus = 'LMS2', key = 'k') => vm.runInContext('gameMyReqDispatch_(' + JSON.stringify({ action, key, role: 'teacher', campus, email, params }) + ')', ctx);
const d = (r) => r.data;
const noEmail = (o) => assert.ok(!/@/.test(JSON.stringify(o)), 'no email: ' + JSON.stringify(o).slice(0, 200));

// gate
assert.equal(call('teach@x.test', 'gameMyReqList', {}, 'LMS2', 'bad').success, false);
assert.equal(d(call('nobody@x.test', 'gameMyReqList')).code, 'not_on_list');
assert.equal(d(call('teach@x.test', 'gameMyReqList', {}, 'LMS3')).code, 'not_authorized'); // grant and Allowlist disagree
// list: own only for staff; the school for its Principal
let L = d(call('teach@x.test', 'gameMyReqList')); noEmail(L);
assert.deepEqual(L.requests.map((r) => r.id), ['apr-4', 'apr-1'], 'own requests, any school (a transfer keeps its history)'); assert.equal(L.school, false);
assert.deepEqual(L.categories, ['Compensatory Leave', 'Leave', 'Other']); assert.equal(L.leaveTypes.length, 7);
L = d(call('clerk@x.test', 'gameMyReqList')); noEmail(L);
assert.deepEqual(L.requests.map((r) => r.id), ['apr-3'], 'fee clerk: own only, not the school'); assert.deepEqual(L.categories, ['Compensatory Leave', 'Other']); assert.equal(L.leaveTypes.length, 0);
L = d(call('drv@x.test', 'gameMyReqList')); assert.deepEqual(L.requests, []);
L = d(call('prin@x.test', 'gameMyReqList')); noEmail(L);
assert.deepEqual(L.requests.map((r) => r.id).sort(), ['apr-1', 'apr-2', 'apr-3']); assert.equal(L.school, true); assert.equal(L.categories.length, 12); // 13 minus Leave (not a Teacher)
assert.deepEqual(L.requests.filter((r) => r.mine).map((r) => r.id), ['apr-2']);
assert.equal(L.requests.find((r) => r.id === 'apr-1').requestedByName, 'Teacher One');
// detail + comments
assert.equal(d(call('teach@x.test', 'gameMyReqDetail', { id: 'apr-3' })).code, 'not_authorized');
assert.equal(d(call('clerk@x.test', 'gameMyReqDetail', { id: 'apr-1' })).code, 'not_authorized');
assert.equal(d(call('prin@x.test', 'gameMyReqDetail', { id: 'apr-4' })).code, 'not_authorized'); // another school
assert.equal(d(call('prin@x.test', 'gameMyReqDetail', { id: 'nope' })).code, 'not_found');
const D = d(call('clerk@x.test', 'gameMyReqDetail', { id: 'apr-3' })); noEmail(D);
assert.equal(D.request.status, 'Info Requested'); assert.deepEqual(D.comments.map((c) => [c.authorName, c.mine]), [['Principal Two', false]]);
// the requester's reply puts Info Requested back to Pending
const C = d(call('clerk@x.test', 'gameMyReqComment', { id: 'apr-3', body: 'Bill attached in the drive' }));
assert.equal(C.status, 'Pending'); assert.equal(COMMENTS().length, 3);
assert.equal(d(call('clerk@x.test', 'gameMyReqComment', { id: 'apr-3', body: ' ' })).code, 'bad_input');
assert.equal(d(call('teach@x.test', 'gameMyReqComment', { id: 'apr-3', body: 'x' })).code, 'not_authorized');
// submit: staff limited to their categories; the requester is the verified email
assert.equal(d(call('clerk@x.test', 'gameMyReqSubmit', { category: 'Financial / Purchase', title: 'Printer', description: 'x' })).code, 'bad_input');
assert.equal(d(call('clerk@x.test', 'gameMyReqSubmit', { category: 'Leave', leaveType: 'Casual Leave', fromDate: '2026-11-20', description: 'x' })).code, 'leave_teachers_only');
assert.equal(d(call('drv@x.test', 'gameMyReqSubmit', { category: 'Other', title: 'Uniform', description: 'Need a new one' })).ok, true);
assert.equal(d(call('teach@x.test', 'gameMyReqSubmit', { category: 'Leave', leaveType: 'Casual Leave', fromDate: '2026-11-13', description: 'x' })).code, 'leave_past');
assert.equal(d(call('teach@x.test', 'gameMyReqSubmit', { category: 'Leave', leaveType: 'Casual Leave', fromDate: '2026-11-15', description: 'x' })).code, 'leave_not_working'); // a Sunday
assert.equal(d(call('teach@x.test', 'gameMyReqSubmit', { category: 'Leave', leaveType: 'Casual Leave', fromDate: '2026-11-18', toDate: '2026-11-19', description: 'Family function' })).ok, true);
assert.equal(d(call('prin@x.test', 'gameMyReqSubmit', { category: 'Financial / Purchase', title: 'Printer', description: 'Office printer', amount: '12000', itemName: 'Printer', quantity: '1' })).ok, true);
assert.equal(d(call('teach@x.test', 'gameMyReqSubmit', { category: 'Other', title: '', description: 'x' })).code, 'bad_input');
const A = APPENDED();
assert.deepEqual(A.map((a) => [a.by, a.category, a.campusId]), [['drv@x.test', 'Other', 'LMS2'], ['teach@x.test', 'Leave', 'LMS2'], ['prin@x.test', 'Financial / Purchase', 'LMS2']]);
assert.match(A[1].title, /Casual Leave/);
console.log('ok: game-myrequests (who sees what, comments, submit rules, no emails)');
function COMMENTS() { return vm.runInContext('COMMENTS', ctx); }
function APPENDED() { return vm.runInContext('APPENDED', ctx); }
