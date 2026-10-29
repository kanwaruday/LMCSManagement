// Fee Clerk hiring screen: pure logic + request bodies. Standalone: node tests/office/test-hiring-view.js (no-op under run.js).
'use strict';
const assert = require('assert');
if (require.main !== module) { module.exports = () => {}; return; }
(async () => {
  globalThis.HiringView = require('../../hiring/hiring-view.js');
  const H = await import('../../office/js/hiring.js');
  const ok = (n) => console.log('  ok  - ' + n);
  const now = new Date('2026-10-24T12:00:00');
  const ap = (id, status, appointments = [], extra = {}) => ({ row: id, name: 'N' + id, phone: '9' + id, status, appointments, ...extra });
  const ax = (id, kind, status, start, extra = {}) => ({ id, kind, status, start, ...extra });
  const list = [
    ap(1, 'Shortlisted'),
    ap(2, 'Shortlisted', [ax('a2', 'interview', 'proposed', '2026-10-26T10:00')]),
    ap(3, 'Shortlisted', [ax('a3', 'interview', 'declined', '2026-10-25T10:00', { declineNote: 'busy' })]),
    ap(4, 'Interview Scheduled', [ax('a4', 'interview', 'accepted', '2026-10-24T09:00', { reportFiled: false })]),   // past, no report
    ap(5, 'Interview Done'),
    ap(6, 'Interview Done', [ax('a6', 'demo', 'accepted', '2026-10-27T10:00')]),             // booked, not a demo to book
    ap(7, 'Hiring Approved', [], { docsMissing: ['PAN'] }),
    ap(8, 'Hiring Approved', [], { docsMissing: [] }),
    ap(9, 'Salary Offer', [ax('a9', 'md', 'accepted', '2026-10-30T10:00')]),                 // md booked
    ap(10, 'Rejected', [ax('a10', 'interview', 'accepted', '2026-10-20T10:00', { reportFiled: false })], { docsMissing: ['X'] }),
    ap(11, 'Hired', [ax('a11', 'demo', 'accepted', '2026-10-25T10:00')]),
    ap(12, 'Interview Done', [ax('a12', 'interview', 'accepted', '2026-10-20T10:00', { reportFiled: true })]),     // report already filed
    ap(13, 'Interview Done', [ax('a13', 'demo', 'accepted', '2026-10-23T10:00', { reportFiled: false })]),          // past demo, no demo report
    ap(15, 'Interview Done', [ax('a15', 'demo', 'accepted', '2026-10-20T10:00', { reportFiled: true })]),         // reported demo is history
    ap(14, 'Shortlisted', [ax('a14', 'interview', 'accepted', '2026-11-20T10:00')]),        // beyond 7 days
  ];
  const mine = { myProposals: [{ id: 'a2', status: 'proposed', name: 'N2' }, { id: 'x', status: 'declined', name: 'N3' }] };
  const b = H.bucketApplicants(list, mine, now);
  const rows = (xs) => xs.map((x) => (x.a ? x.a.row : x.row));
  assert.deepStrictEqual(rows(b.toSchedule), [1, 3]); ok('to schedule: declined counts, proposed/accepted do not, Rejected/Hired excluded');
  assert.deepStrictEqual(b.waiting.map((p) => p.id), ['a2']); ok('waiting = my open proposals');
  assert.deepStrictEqual(rows(b.booked), [4, 6, 9]); ok('booked: all kinds incl. md, next 7 days, sorted, not Rejected/Hired');
  assert.deepStrictEqual(rows(b.reports), [13, 4]); ok('reports: past accepted with reportFiled false (sorted); filed, Rejected excluded');
  assert.deepStrictEqual(rows(b.demos), [5, 12, 15]); ok('demos to book');
  assert.deepStrictEqual(rows(b.docs), [7]); ok('documents to chase');
  assert.strictEqual(H.declined(list[2], 'interview').declineNote, 'busy'); ok('decline note');
  assert.deepStrictEqual(H.capSubjects({ role: { subjects: 'English, Hindi' }, subjects: 'X' }), ['English', 'Hindi']);
  assert.deepStrictEqual(H.capSubjects({ role: null, subjects: 'Maths & Science' }), ['Maths', 'Science']);

  // propose
  const p = (o) => H.proposePayload({ row: 3, kind: 'interview', start: '2026-10-26T10:00', durationMin: '', place: ' Office ', note: '', ...o }, now);
  assert.deepStrictEqual(p().body, { row: 3, kind: 'interview', start: '2026-10-26T10:00', durationMin: 30, place: 'Office' });
  assert.ok(!p({ start: '' }).ok); assert.ok(!p({ start: '2026-10-01T10:00' }).ok); assert.ok(!p({ kind: 'md' }).ok); assert.ok(!p({ durationMin: '0' }).ok); ok('propose payload');

  // walk-in
  const w = (o) => H.walkinPayload({ name: ' Ann ', phone: '98765 43210', campusId: 'LMS2', source: 'Walk-in', subjects: '', ...o }, ['LMS2']);
  assert.deepStrictEqual(w().body, { name: 'Ann', phone: '9876543210', campusId: 'LMS2', source: 'Walk-in' });
  assert.strictEqual(w({ phone: '123' }).error, 'Enter a 10-digit mobile number');
  assert.ok(!w({ name: '' }).ok && !w({ campusId: 'LMS3' }).ok && !w({ source: '' }).ok); ok('walk-in payload');

  // files
  const f = { name: 'a.pdf', size: 100, type: 'application/pdf' };
  assert.strictEqual(H.fileError(f), null);
  assert.strictEqual(H.fileError({ name: 'a.JPG', size: 5, type: '' }), null);
  assert.ok(H.fileError({ ...f, size: 7 * 1024 * 1024 + 1 })); assert.ok(H.fileError({ name: 'a.docx', size: 5, type: '' })); assert.ok(H.fileError(null)); ok('file checks');

  // reports
  const reasons = ['Salary too high', 'Other'];
  const file = { ...f, base64: 'AAAA' };
  const iv = (o) => ({ interviewDate: '2026-10-24', position: 'LMS 2 - PRT', confidence: '4', english: '3', capability: { English: { C1: '4', C2: '' } }, recommendation: 'proceed', experience: {}, ...o });
  const ib = H.reportBody(3, 'interview', file, iv(), reasons);
  assert.ok(ib.ok); assert.deepStrictEqual(ib.body.capability, { English: { C1: 4 } }); assert.strictEqual(ib.body.confidence, 3 + 1);
  assert.deepStrictEqual(ib.body.file, { name: 'a.pdf', mime: 'application/pdf', base64: 'AAAA' }); assert.ok(!('rejectReason' in ib.body));
  assert.ok(!H.reportBody(3, 'interview', file, iv({ confidence: '6' }), reasons).ok);
  assert.ok(!H.reportBody(3, 'interview', file, iv({ capability: { English: { C1: '' } } }), reasons).ok);
  assert.ok(!H.reportBody(3, 'interview', file, iv({ capability: { English: { C1: '9' } } }), reasons).ok);
  assert.ok(!H.reportBody(3, 'interview', file, iv({ recommendation: 'reject' }), reasons).ok);
  assert.ok(!H.reportBody(3, 'interview', file, iv({ recommendation: 'reject', rejectReason: 'Other' }), reasons).ok);
  assert.ok(!H.reportBody(3, 'interview', file, iv({ recommendation: 'reject', rejectReason: 'Nope' }), reasons).ok);
  assert.strictEqual(H.reportBody(3, 'interview', file, iv({ recommendation: 'reject', rejectReason: 'Other', rejectNote: 'x' }), reasons).body.rejectNote, 'x');
  assert.ok(!H.reportBody(3, 'interview', { ...file, size: 1e9 }, iv(), reasons).ok); ok('interview report');
  const sc = { pedagogy: '3', content: '3', interaction: '3', response: '3', management: '3', clarity: '3', relatable: '3', aids: '3' };
  const dv = (o) => ({ demoDate: '2026-10-24', class: 'C3', subject: 'English', scores: sc, studentFeedback: '4', recommendation: 'proceed', ...o });
  const db = H.reportBody(3, 'demo', file, dv(), reasons);
  assert.ok(db.ok); assert.strictEqual(db.body.scores.aids, 3);
  assert.ok(!H.reportBody(3, 'demo', file, dv({ scores: { ...sc, aids: '0' } }), reasons).ok);
  assert.ok(!H.reportBody(3, 'demo', file, dv({ studentFeedback: '' }), reasons).ok);
  assert.ok(!H.reportBody(3, 'demo', file, dv({ recommendation: 'another' }), reasons).ok);
  assert.strictEqual(H.reportBody(3, 'demo', file, dv({ recommendation: 'another', nextDemoAt: '2026-10-30T10:00' }), reasons).body.nextDemoAt, '2026-10-30T10:00');
  assert.ok(!H.reportBody(3, 'demo', file, dv({ recommendation: 'bogus' }), reasons).ok); ok('demo report');

  // requests
  const calls = [];
  const fake = async (u, o) => { calls.push([u, o]); return { json: async () => ({ success: true }) }; };
  const be = H.makeBackend(fake, 'http://pdr', () => 'TOK');
  await be.get('apptlist');
  assert.strictEqual(calls[0][0], 'http://pdr?action=apptlist&idToken=TOK');
  await be.post('apptpropose', p().body);
  await be.post('hiringuploadreport', ib.body);
  for (const [i, act] of [[1, 'apptpropose'], [2, 'hiringuploadreport']]) {
    const [u, o] = calls[i];
    assert.strictEqual(u, 'http://pdr'); assert.strictEqual(o.method, 'POST'); assert.ok(!o.headers);
    const body = JSON.parse(o.body); assert.strictEqual(body.action, act); assert.strictEqual(body.idToken, 'TOK');
  }
  assert.strictEqual(JSON.parse(calls[2][1].body).file.base64, 'AAAA'); ok('GET and POST requests (no Content-Type)');

  // office home: one fetch fills link + banner
  const link = { textContent: 'Hiring' }; const banner = { hidden: true, replaceChildren() {} };
  global.document = { createElement: () => ({ append() {}, setAttribute() {}, addEventListener() {} }), createTextNode: (t) => t };
  let n = 0;
  await H.showOfficeHiring(link, banner, async () => { n++; return { json: async () => ({ success: true, applicants: list, legwork: { toSchedule: 2 } }) }; }, 'u', 't', now);
  assert.strictEqual(n, 1); assert.strictEqual(banner.hidden, false); assert.ok(link.textContent.startsWith('Hiring')); ok('home banner: single fetch, shown');
  const b2 = { hidden: true, replaceChildren() {} };
  await H.showOfficeHiring(link, b2, async () => { throw new Error('off'); }, 'u', 't', now);
  await H.showOfficeHiring(link, b2, async () => ({ json: async () => ({ success: true, applicants: [] }) }), 'u', 't', now);
  assert.strictEqual(b2.hidden, true); ok('banner hidden on failure or zero');
})().catch((e) => { console.error(e); process.exit(1); });
