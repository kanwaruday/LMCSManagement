// node tests/game/test-confirm-prefill.js -- setup quest pre-fill adapters (game-confirm-prefill.gs). Synthetic data only.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const dir = __dirname + '/../../apps-script/';
const ctx = { console: Object.assign(Object.create(console), { error() {} }), Logger: { log() {} } };
vm.createContext(ctx);
const load = (f) => vm.runInContext(fs.readFileSync(dir + f, 'utf8'), ctx);
load('game-confirm-prefill.gs'); load('game-confirm.gs'); load('game-teacher.gs'); load('game.gs');
const J = (x) => JSON.parse(JSON.stringify(x));

let store = new Map(), calls = [], answer;
ctx.CacheService = { getScriptCache: () => ({
  get: (k) => (store.has(k) ? store.get(k) : null), put: (k, v) => { store.set(k, v); }, getAll: (ks) => { const o = {}; ks.forEach((k) => { if (store.has(k)) o[k] = store.get(k); }); return o; },
  remove: (k) => { store.delete(k); }, putAll: (m) => { Object.keys(m).forEach((k) => store.set(k, m[k])); },
}) };
ctx.UrlFetchApp = { fetch: (url) => { calls.push(url); const a = typeof answer === 'function' ? answer(url) : answer; return { getResponseCode: () => a.code || 200, getContentText: () => a.body }; } };
ctx.tchCodeFor_ = (c) => c.employeeCode || '';
const reset = (a) => { store = new Map(); calls = []; answer = a; };

const ROSTER = { success: true, rows: [
  { employeeCode: 'TST/99/01/001', class: 'Class 7', subject: 'Math' }, { employeeCode: 'TST/99/01/001', class: 'Class 7', subject: 'Math' },
  { employeeCode: 'TST/99/01/001', class: 'Class 8', subject: 'Science' }, { employeeCode: 'TST/99/01/002', class: 'Class 3', subject: 'Hindi' },
] };
const per = (day, period, cls, subject, start, end, free) => ({ day, period, class: cls, subject, start, end, free: !!free });
const TT = { campusPeriodSchedule: { LMS4: [{ period: 1, start: '9:20', end: '10:00' }, { period: 6, start: '12:40', end: '01:15' }, { period: 9, start: '2:25', end: '3:00' }] },
  campuses: { LMS4: {
    'TST/99/01/001': { name: 'A', periods: [per('Mon', 1, 'Class 10', 'Math', '9:20', '10:00'), per('Mon', 2, '', '', '10:00', '10:35', true), per('Tue', 6, 'Class 9', 'Math', '12:40', '01:15')] },
    'TST/99/01/002': { name: 'B', periods: [per('Mon', 1, '', 'Art', '9:20', '10:00'), per('Wed', 3, 'Class 9', 'Art', '10:35', '11:10')] },
  } } };
const T1 = { employeeCode: 'TST/99/01/001' }, T2 = { employeeCode: 'TST/99/01/002' };
const P = ctx.CQ_PREFILL;
const ids = (r) => J(r).map((i) => i.item);
const tests = [];
const test = (n, fn) => tests.push([n, fn]);

test('roster.myClasses fetches once for everyone', () => {
  reset({ body: JSON.stringify(ROSTER) });
  assert.deepStrictEqual(ids(P['roster.myClasses']({ caller: T1 }, {})), ['c-class7-math', 'c-class8-science']);
  assert.deepStrictEqual(calls, [ctx.TCH_ROSTER_URL + '?action=roster']);
  P['roster.myClasses']({ caller: T1 }, {});
  assert.deepStrictEqual(ids(P['roster.myClasses']({ caller: T2 }, {})), ['c-class3-hindi']);
  assert.deepStrictEqual(J(P['roster.myClasses']({ caller: { employeeCode: 'TST/99/01/777' } }, {})), []);
  assert.strictEqual(calls.length, 1);
});
test('roster.myClasses cache-only and failures', () => {
  reset({ body: JSON.stringify(ROSTER) });
  assert.strictEqual(P['roster.myClasses']({ caller: T1 }, { cacheOnly: true }), null); assert.strictEqual(calls.length, 0);
  reset({ code: 500, body: 'x' });
  assert.strictEqual(P['roster.myClasses']({ caller: T1 }, {}), null);
  assert.strictEqual(P['roster.myClasses']({ caller: T1 }, {}), null);
  assert.strictEqual(calls.length, 2); assert.strictEqual(store.size, 0);
  assert.deepStrictEqual(J(P['roster.myClasses']({ caller: {} }, {})), []);
});
test('roster: evicted slice is unknown, never an empty roster (F1)', () => {
  reset({ body: JSON.stringify(ROSTER) });
  P['roster.myClasses']({ caller: T1 }, {});
  assert.deepStrictEqual(J(JSON.parse(store.get('cq_acad_built')).sort()), ['TST/99/01/001', 'TST/99/01/002']);
  store.delete('cq_acad_TST/99/01/001'); calls.length = 0;
  assert.strictEqual(P['roster.myClasses']({ caller: T1 }, { cacheOnly: true }), null);
  assert.deepStrictEqual(J(P['roster.myClasses']({ caller: { employeeCode: 'TST/99/01/777' } }, { cacheOnly: true })), []);
  assert.deepStrictEqual(ids(P['roster.myClasses']({ caller: T1 }, {})), ['c-class7-math', 'c-class8-science']); assert.strictEqual(calls.length, 1);
  store.delete('cq_acad_TST/99/01/002'); reset({ code: 500, body: 'x' }); store.set('cq_acad_built', '["TST/99/01/002"]');
  assert.strictEqual(P['roster.myClasses']({ caller: T2 }, {}), null);
  store.set('cq_acad_built', '1'); // legacy bare flag
  assert.strictEqual(P['roster.myClasses']({ caller: T2 }, { cacheOnly: true }), null);
});
test('timetable: evicted slice is unknown, never empty (F1)', () => {
  reset({ body: JSON.stringify(TT) });
  assert.strictEqual(J(P['timetable.myPeriods']({ caller: T1 }, {})).length, 2);
  store.delete('cq_tt_code_TST/99/01/001'); calls.length = 0;
  assert.strictEqual(P['timetable.myPeriods']({ caller: T1 }, { cacheOnly: true }), null);
  assert.deepStrictEqual(J(P['timetable.myPeriods']({ caller: { employeeCode: 'TST/99/01/777' } }, { cacheOnly: true })), []);
  assert.strictEqual(J(P['timetable.myPeriods']({ caller: T1 }, {})).length, 2); assert.strictEqual(calls.length, 1);
});
test('timetable.bells normalises clock times', () => {
  reset({ body: JSON.stringify(TT) });
  const r = J(P['timetable.bells']({ campus: 'LMS4' }, {}));
  assert.deepStrictEqual(r.map((i) => i.item + ' ' + i.fields.start + '-' + i.fields.end), ['p1 09:20-10:00', 'p6 12:40-13:15', 'p9 14:25-15:00']);
  assert.deepStrictEqual(J(P['timetable.bells']({ campus: 'LMS1' }, {})), []);
  reset({ body: JSON.stringify(TT) });
  assert.strictEqual(P['timetable.bells']({ campus: 'LMS4' }, { cacheOnly: true }), null); assert.strictEqual(calls.length, 0);
  assert.strictEqual(ctx.cqClock_('10:05am'), '10:05'); assert.strictEqual(ctx.cqClock_('1:35pm'), '13:35'); assert.strictEqual(ctx.cqClock_('11:50pm'), '11:50'); // LMS 6's suffixes
  assert.notStrictEqual(ctx.cqEmailKey_('a.b@test.invalid'), ctx.cqEmailKey_('ab@test.invalid')); assert.ok(/^[A-Za-z0-9_:\-]{1,64}$/.test(ctx.cqEmailKey_('a.b@test.invalid')));
  assert.strictEqual(ctx.cqClock_('bad'), ''); assert.strictEqual(ctx.cqClock_('01:15'), '13:15'); assert.strictEqual(ctx.cqClock_('12:40'), '12:40');
});
test('timetable.classes is distinct and ordered', () => {
  const t = J(TT); t.campuses.LMS4['TST/99/01/002'].periods.push(per('Thu', 4, 'Class 10', 'Art', '11:10', '11:45'), per('Thu', 5, 'Class 9', 'Art', '11:45', '12:20'));
  reset({ body: JSON.stringify(t) });
  assert.deepStrictEqual(ids(P['timetable.classes']({ campus: 'LMS4' }, {})), ['k-class9', 'k-class10']);
});
test('timetable.myPeriods drops free periods', () => {
  reset({ body: JSON.stringify(TT) });
  const r = J(P['timetable.myPeriods']({ caller: T1 }, {}));
  assert.deepStrictEqual(r.map((i) => i.item), ['mon-1', 'tue-6']);
  assert.deepStrictEqual(r[1].fields, { day: 'Tue', period: '6', class: 'Class 9', subject: 'Math', start: '12:40', end: '13:15' });
  assert.strictEqual(calls.length, 1);
});
test('allowlist.people filters by campus', () => {
  const rows = [['Email', 'Name', 'Campus', 'Roles'], ['P@test.invalid', 'Pat', 'LMS4', 'Principal,Teacher'], ['q@test.invalid', 'Quin', 'LMS2', 'Principal'], ['', 'Nobody', 'LMS4', 'Teacher']];
  ctx.SpreadsheetApp = { openById: () => ({ getSheets: () => [{ getDataRange: () => ({ getValues: () => rows }) }] }) };
  reset({ body: '' });
  const r = J(P['allowlist.people']({ campus: 'LMS4' }, {}));
  assert.deepStrictEqual(r, [{ item: 'a-p:test_invalid', fields: { name: 'Pat', email: 'p@test.invalid', campus: 'LMS4', roles: 'Principal, Teacher' } }]);
  assert.strictEqual(P['allowlist.people']({}, {}).length, 2); assert.strictEqual(calls.length, 0);
});
test('registry is exactly the reviewed five', () => {
  assert.deepStrictEqual(Object.keys(P).sort(), ['allowlist.people', 'roster.myClasses', 'timetable.bells', 'timetable.classes', 'timetable.myPeriods']);
});
test('no PII tab is ever named', () => {
  ['game-confirm-prefill.gs', 'game-confirm.gs'].forEach((f) => { const s = fs.readFileSync(dir + f, 'utf8'); ['EmpPersonal', 'EmpProfessional', 'EmpKeyNumbers'].forEach((n) => assert.ok(!s.includes(n), f + ' names ' + n)); });
});

let fail = 0;
for (const [n, fn] of tests) { try { fn(); console.log('ok  ' + n); } catch (e) { fail++; console.log('FAIL ' + n + '\n  ' + (e.stack || e).split('\n').slice(0, 4).join('\n  ')); } }
if (fail) process.exit(1);
