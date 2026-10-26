// node tests/coordinator/test-comment-status.js -- only a decider's comment moves a request to Info Requested
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../../apps-script/approvals.gs', 'utf8'), ctx);

const s = ctx.aprCommentStatus_;
assert.strictEqual(s(true, false, 'Pending'), 'Info Requested');        // the Owner asks for more
assert.strictEqual(s(false, false, 'Pending'), null);                   // a Coordinator's or Principal's comment is just a comment
assert.strictEqual(s(false, true, 'Info Requested'), 'Pending');        // the requester answers
assert.strictEqual(s(true, false, 'Approved'), null);                   // decided: no change
console.log('comment-status ok');
