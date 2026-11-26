// node tests/game/test-deploy-retire.js -- deploy.mjs retire against a fake clasp 3 (push sends nothing unless a local file is new
// or changed; a deletion alone is "already up to date"). The live chapter deploy failed this way on 26 Nov: Code.gs stayed.
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert'), { spawnSync } = require('child_process');
const deploy = path.join(__dirname, '../../apps-script/deploy.mjs');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const bin = tmp('fake-npx-'), remote = tmp('fake-remote-'), dir = tmp('deploy-retire-');
fs.writeFileSync(path.join(bin, 'npx'), `#!/usr/bin/env node
const fs = require('fs'), path = require('path'), R = process.env.FAKE_REMOTE, cmd = process.argv[4];
const js = (d) => fs.readdirSync(d).filter((f) => f.endsWith('.js') || f === 'appsscript.json');
if (cmd === 'pull') for (const f of js(R)) fs.copyFileSync(path.join(R, f), f);
else if (cmd === 'push') {
  const local = fs.readdirSync('.').filter((f) => f.endsWith('.gs')).map((f) => [f.replace(/\\.gs$/, '.js'), fs.readFileSync(f, 'utf8')]);
  const changed = local.filter(([n, s]) => !fs.existsSync(path.join(R, n)) || fs.readFileSync(path.join(R, n), 'utf8') !== s);
  if (!changed.length) { console.log('Script is already up to date.'); process.exit(0); }
  for (const f of js(R)) if (f !== 'appsscript.json') fs.unlinkSync(path.join(R, f));
  for (const [n, s] of local) fs.writeFileSync(path.join(R, n), s);
  console.log('Pushed ' + local.length + ' files.');
} else if (cmd === 'create-version') console.log('Created version 9.');
else console.log('ok');
`, { mode: 0o755 });
fs.writeFileSync(path.join(dir, 'projects.json'), JSON.stringify({ a: { scriptId: 's', deploymentId: 'd', files: ['m'], retire: ['Code'] } }));
fs.writeFileSync(path.join(dir, 'm.gs'), 'const X = 1;\n');
fs.writeFileSync(path.join(remote, 'm.js'), 'const X = 1;\n');      // our file already pushed (the first failed deploy)
fs.writeFileSync(path.join(remote, 'Code.js'), 'const X = 1;\n');   // the old copy that duplicates it
fs.writeFileSync(path.join(remote, 'appsscript.json'), '{}');
const r = spawnSync('node', [deploy, 'a', '--push', '--deploy', 'test', '--dir', dir], {
  encoding: 'utf8', env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, FAKE_REMOTE: remote } });
assert.strictEqual(r.status, 0, r.stderr);
assert.ok(!fs.existsSync(path.join(remote, 'Code.js')), 'Code.js must be gone from the project');
assert.match(fs.readFileSync(path.join(remote, 'm.js'), 'utf8'), /^const X = 1;\n/);
assert.match(r.stdout, /retired:\s+Code\.gs/); assert.match(r.stdout, /HEAD checked/); assert.match(r.stdout, /version 9/);
console.log('deploy-retire: ok');
