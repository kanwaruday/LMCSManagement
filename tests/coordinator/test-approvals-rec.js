// node tests/coordinator/test-approvals-rec.js -- CoordApprovals.recBlock: the Owner sees the Coordinator's recommendation
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const ctx = { console, window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../../coordinator/approvals.js', 'utf8'), ctx);
const { recBlock } = ctx.window.CoordApprovals;
assert.strictEqual(typeof recBlock, 'function');

const rec = { by: 'c@lms.org.in', byName: 'Test Coordinator', recommendation: 'Approve', reason: 'Quotes compared', checked: 'Budget line', at: '2026-10-25T10:00:00Z' };
let h = recBlock(rec);
assert.ok(h.includes('Test Coordinator recommends Approve'), h);
assert.ok(h.includes('Quotes compared'));
assert.ok(h.includes('Checked: Budget line'));
assert.ok(!recBlock(Object.assign({}, rec, { checked: '' })).includes('Checked:'), 'no Checked line when empty');
assert.ok(recBlock(Object.assign({}, rec, { recommendation: 'Info' })).includes('recommends Ask for information'));
assert.ok(recBlock(Object.assign({}, rec, { recommendation: 'Reject' })).includes('recommends Reject'));
assert.ok(recBlock(null).includes('No recommendation yet.'));
assert.ok(recBlock(undefined).includes('No recommendation yet.'));

h = recBlock(Object.assign({}, rec, { reason: '<s>', byName: '<i>x</i>', checked: '<u>' }));
assert.ok(h.includes('&lt;s&gt;') && !h.includes('<s>') && !h.includes('<i>') && !h.includes('<u>'), h);
assert.ok(recBlock(Object.assign({}, rec, { reason: '<b>' })).includes('&lt;b&gt;'));
console.log('test-approvals-rec: ok');
