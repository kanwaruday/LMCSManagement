// Run: node tests/hiring/test-appt-box.js -- the shared appointment box renders (pure part).
const assert = require('assert');
const A = require('../../assets/appointments.js');
const it = (o) => Object.assign({ id: 'AP1', kind: 'interview', name: 'Asha', campus: 'LMS1', start: '2026-10-25T10:00:00+05:30', durationMin: 30, place: 'Office', note: '', status: 'proposed' }, o || {});
assert.strictEqual(A.renderHtml_({ toAccept: [], myProposals: [], upcoming: [] }, 'Principal'), '');
assert.strictEqual(A.renderHtml_(null, 'Principal'), '');
const h = A.renderHtml_({ toAccept: [it()], myProposals: [] }, 'Principal');
assert.ok(/data-act="accept"/.test(h) && /data-act="decline"/.test(h) && /<textarea[^>]*class="ap-note"/.test(h), 'accept + decline with note field');
const x = A.renderHtml_({ toAccept: [it({ name: '<img onerror=1>', place: '"><b>' })], myProposals: [] }, 'Owner');
assert.ok(!/<img/.test(x) && /&lt;img/.test(x) && /&quot;&gt;&lt;b&gt;/.test(x), 'escaped');
const c = A.renderHtml_({ toAccept: [it()], myProposals: [it({ status: 'declined', declineNote: 'Busy' })], upcoming: [it({ id: 'AP2', status: 'accepted', calendarMode: 'none', decidedBy: 'Me@x.org' })] }, 'FeeClerk', 'me@x.org');
assert.ok(!/data-act="accept"/.test(c) && /declined/.test(c) && /Busy/.test(c) && !/Retry/.test(c), 'clerk: no accept, no retry');
const up = (by) => ({ toAccept: [], myProposals: [it({ id: 'M1', status: 'accepted', calendarMode: 'none', decidedBy: 'me@x.org' })], upcoming: [it({ id: 'AP2', status: 'accepted', calendarMode: 'none', decidedBy: by }), it({ id: 'AP3', status: 'accepted', calendarMode: 'user', decidedBy: by })] });
const r = A.renderHtml_(up('ME@x.org'), 'Principal', 'me@x.org');
assert.strictEqual((r.match(/data-act="retry"/g) || []).length, 1, 'acceptor sees retry once, with proposals present');
assert.ok(/data-id="AP2"/.test(r) && !/data-id="M1"[^]*data-act="retry"/.test(r.split('Calendar')[0]), 'retry not on proposals');
assert.ok(!/data-act="retry"/.test(A.renderHtml_(up('other@x.org'), 'Principal', 'me@x.org')), 'decided by someone else');
assert.ok(!/data-act="retry"/.test(A.renderHtml_({ myProposals: [it({ status: 'accepted', calendarMode: 'none', decidedBy: 'me@x.org' })] }, 'Principal', 'me@x.org')), 'own proposal');
console.log('ok  - appointment box renders');
