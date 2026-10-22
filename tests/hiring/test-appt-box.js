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
const c = A.renderHtml_({ toAccept: [it()], myProposals: [it({ status: 'declined', declineNote: 'Busy' }), it({ id: 'AP2', status: 'accepted', calendarMode: 'none' })] }, 'FeeClerk');
assert.ok(!/data-act="accept"/.test(c) && /declined/.test(c) && /Busy/.test(c) && !/Retry/.test(c), 'clerk: no accept, no retry');
const p = A.renderHtml_({ toAccept: [], myProposals: [it({ id: 'AP2', status: 'accepted', calendarMode: 'none' }), it({ id: 'AP3', status: 'accepted', calendarMode: 'user' })] }, 'Principal');
assert.strictEqual((p.match(/data-act="retry"/g) || []).length, 1, 'retry only when calendarMode none');
console.log('ok  - appointment box renders');
