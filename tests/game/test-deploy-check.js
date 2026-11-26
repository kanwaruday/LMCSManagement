// node tests/game/test-deploy-check.js -- deploy.mjs --check: a "shared" file may sit in several projects, any other may not
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert'), { spawnSync } = require('child_process');
const deploy = path.join(__dirname, '../../apps-script/deploy.mjs');
function check(shared, retire) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-check-'));
  fs.writeFileSync(path.join(dir, 'x.gs'), '');
  fs.writeFileSync(path.join(dir, 'projects.json'), JSON.stringify({ shared, a: { files: ['x'], retire }, b: { files: ['x'] } }));
  return spawnSync('node', [deploy, '--check', '--dir', dir], { encoding: 'utf8' });
}
assert.strictEqual(check(['x']).status, 0);                       // shared in two projects: ok
const bad = check([]);
assert.strictEqual(bad.status, 1); assert.match(bad.stderr, /mapped twice: x\.gs/);   // unshared in two projects: fails
assert.strictEqual(check(['x'], ['Code']).status, 0);              // retire a remote-only name: ok
assert.match(check(['x'], ['x']).stderr, /retire "x" is also one of its files/);   // never retire a file we push
assert.match(check(['x'], ['Code.gs']).stderr, /must be a bare file name/);
assert.match(check(['x'], ['../y']).stderr, /must be a bare file name/);
// gameDeploymentId: a valid, different id passes; a malformed one or the main deployment's own id fails
function checkGame(main, game) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-check-'));
  fs.writeFileSync(path.join(dir, 'x.gs'), '');
  fs.writeFileSync(path.join(dir, 'projects.json'), JSON.stringify({ a: Object.assign({ files: ['x'], deploymentId: main }, game === undefined ? {} : { gameDeploymentId: game }) }));
  return spawnSync('node', [deploy, '--check', '--dir', dir], { encoding: 'utf8' });
}
const A = 'AKfycb' + 'a'.repeat(30), B = 'AKfycb' + 'b'.repeat(30);
assert.strictEqual(checkGame(A).status, 0);
assert.strictEqual(checkGame(A, B).status, 0);
assert.match(checkGame(A, 'oops').stderr, /gameDeploymentId must be/);
assert.match(checkGame(A, A).stderr, /gameDeploymentId must be/);
console.log('deploy-check: ok');
