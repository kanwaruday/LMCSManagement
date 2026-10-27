// node tests/game/test-buddy-worker.js -- runs the Ask Buddy Mac worker's own checks (tools/buddy_worker.py --selftest and
// tools/test_buddy_worker.py, both offline: backend and claude CLI stubbed). Skips with a note when python3 is missing.
const { spawnSync } = require('child_process'), assert = require('assert'), path = require('path');
const tools = path.join(__dirname, '..', '..', 'tools');
if (spawnSync('python3', ['--version']).error) { console.log('skip: python3 not found'); process.exit(0); }
const run = (args) => spawnSync('python3', ['-I', ...args], { encoding: 'utf8', timeout: 60000 });
const self = run([path.join(tools, 'buddy_worker.py'), '--selftest']);
assert.strictEqual(self.status, 0, self.stderr);
assert.strictEqual(self.stdout.trim(), 'selftest ok');
const flows = run([path.join(tools, 'test_buddy_worker.py')]);
assert.strictEqual(flows.status, 0, flows.stderr);
assert.strictEqual(flows.stdout.trim(), 'test_buddy_worker ok');
console.log('test-buddy-worker ok');
