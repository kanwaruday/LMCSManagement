// node tests/game/test-workplace-chain-js.js -- assets/game/workplace-chain.js pure helpers: the card line and when Send is allowed.
const assert = require('assert');
const W = require('../../assets/game/workplace-chain.js');
const room = (status, taken, note) => ({ status, note: note || '', shots: taken.map((t) => ({ taken: t })) });
assert.strictEqual(W.nextLine(room('none', [false, false, false])), '3 of 3 photos to take');
assert.strictEqual(W.nextLine(room('draft', [true, true, true])), 'All photos taken: tick the box and send');
assert.strictEqual(W.nextLine(room('redo', [true, true, true], 'Desk is dark')), 'Take them again: Desk is dark');
assert.match(W.nextLine(room('pending', [true, true, true])), /Sent/);
assert.match(W.nextLine(room('approved', [true, true, true])), /Approved/);
assert.strictEqual(W.canSend(room('draft', [true, true, true]), true), true);
assert.strictEqual(W.canSend(room('draft', [true, true, true]), false), false, 'the empty-room tick first');
assert.strictEqual(W.canSend(room('draft', [true, false, true]), true), false, 'every photo first');
assert.strictEqual(W.canSend(room('redo', [true, true, true]), true), true, 'a redo can be sent again');
assert.strictEqual(W.canSend(room('pending', [true, true, true]), true), false);
console.log('workplace chain js: ok');
