// node tests/pdr/test-game-teacher-me.js -- N2: lms-game's "My week" game actions (game-teacher-me.gs, routed in principal-dr.gs
// pdrGame_): teacher-only, gameSsMine needs the verified email, and only the numbers go back. Fake data only: this repo is public.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const { boot } = require('./harness');

const ROOT = path.join(__dirname, '..', '..', 'apps-script');
const KEY = 'test-game-key';
const env = boot({ books: {}, allowlistRows: [['Email', 'Name', 'CampusId', 'Role', 'CanApprove']] });
const g = env.g;
g.CalendarApp = { getCalendarById: () => null };
for (const f of ['principal-dr.gs', 'game-teacher-me.gs']) new vm.Script(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }).runInContext(g);
g.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => (k === 'GAME_KEY' ? KEY : null) }) };
// the teacher portal's own functions, faked: who asked, and a result carrying a name that must not leave
const seen = [];
g.myTeacherSsStats_ = (c) => { seen.push(c); return c.email === 't1@example.org'
  ? { success: true, found: true, rubricParams: ['Planning', 'Delivery'], campusId: c.campusId, stats: { teacher: 'Test Teacher A', submissionCount: 2, avgTotal: 81.5, avgPerParam: [8, 8.3], lastSubmission: new Date('2026-11-02T05:00:00Z') } }
  : { success: true, found: false, rubricParams: ['Planning', 'Delivery'], campusId: c.campusId, name: '' }; };
g.myUpcomingEvents_ = (c) => ({ success: true, campusId: c.campusId, events: [{ title: 'Sports day', start: '2026-11-20T03:30:00.000Z', end: '2026-11-20T09:30:00.000Z', allDay: false }] });

const B = (action, o) => Object.assign({ action, key: KEY, role: 'teacher', campus: 'LMS4', email: 't1@example.org', params: {} }, o || {});
const send = (body) => JSON.parse(g.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
const NO = { success: false, error: 'not_authorized' };

// SS: the caller comes from the verified email; only the numbers go back (no teacher name)
let r = send(B('gameSsMine'));
assert.deepStrictEqual(r, { success: true, data: { found: true, rubricParams: ['Planning', 'Delivery'],
  stats: { avgTotal: 81.5, submissionCount: 2, avgPerParam: [8, 8.3], lastSubmission: '2026-11-02T05:00:00.000Z' } } });
assert.strictEqual(JSON.stringify(seen.pop()), JSON.stringify({ email: 't1@example.org', campusId: 'LMS4', name: '' })); // (another realm: compare as JSON)
assert.deepStrictEqual(send(B('gameSsMine', { email: 't2@example.org' })).data, { found: false, rubricParams: ['Planning', 'Delivery'], stats: null });
assert.ok(!JSON.stringify(r).includes('Test Teacher'));
// teacher-only, and an email is required for gameSsMine
for (const bad of [{ role: 'principal' }, { role: 'owner' }, { role: 'coordinator' }, { email: null }, { email: 'nope' }, { campus: 'ALL' }, { key: 'wrong' }])
  assert.deepStrictEqual(send(B('gameSsMine', bad)), NO, JSON.stringify(bad));
// events: the school's next 14 days, teacher-only
assert.deepStrictEqual(send(B('gamePdrMyEvents', { email: null })).data, { events: [{ title: 'Sports day', start: '2026-11-20T03:30:00.000Z', end: '2026-11-20T09:30:00.000Z', allDay: false }] });
assert.deepStrictEqual(send(B('gamePdrMyEvents', { role: 'principal' })), NO);
// a teacher still can't reach the Principal's routes
assert.deepStrictEqual(send(B('gamePdrLoad', { params: { date: '2026-11-11' } })), NO);
console.log('test-game-teacher-me: ok');
