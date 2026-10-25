// node tests/game/test-deploy-check.js -- deploy.mjs --check: a "shared" file may sit in several projects, any other may not
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert'), { spawnSync } = require('child_process');
const deploy = path.join(__dirname, '../../apps-script/deploy.mjs');
function check(shared) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-check-'));
  fs.writeFileSync(path.join(dir, 'x.gs'), '');
  fs.writeFileSync(path.join(dir, 'projects.json'), JSON.stringify({ shared, a: { files: ['x'] }, b: { files: ['x'] } }));
  return spawnSync('node', [deploy, '--check', '--dir', dir], { encoding: 'utf8' });
}
assert.strictEqual(check(['x']).status, 0);                       // shared in two projects: ok
const bad = check([]);
assert.strictEqual(bad.status, 1); assert.match(bad.stderr, /mapped twice: x\.gs/);   // unshared in two projects: fails
console.log('deploy-check: ok');
