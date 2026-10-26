#!/usr/bin/env node
// Deploy one Apps Script project from this folder with clasp.
//   node apps-script/deploy.mjs <project>                 dry run: show what would change
//   node apps-script/deploy.mjs <project> --push          push the files
//   node apps-script/deploy.mjs <project> --push --deploy "message"
//                                                         push, version, update the live /exec deployment
//   node apps-script/deploy.mjs --check                   offline: every .gs file is mapped exactly once
// Projects and file lists: projects.json. First time: `npx @google/clasp login`, then fill in scriptId.
//
// Safety: stages in a temp dir from the REMOTE project (pull), overlays our files on top. So the remote
// appsscript.json (scopes, webapp access) is kept, and remote-only files are kept, never deleted.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, mkdtempSync, copyFileSync, renameSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
// --dir <folder> points --check at another folder holding projects.json + .gs files (used by tests/game/test-deploy-check.js)
const here = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : dirname(fileURLToPath(import.meta.url));
const projects = JSON.parse(readFileSync(join(here, 'projects.json'), 'utf8'));
delete projects._note;
const shared = projects.shared || []; // .gs files deployed to several projects: one source, never forked
delete projects.shared;
const clasp = (cwd, ...a) => execFileSync('npx', ['-y', '@google/clasp@3', ...a], { cwd, encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] });
const read = (p) => readFileSync(p, 'utf8');

// ponytail: mapping check is by filename only; add a header-vs-project check if a file is ever mapped wrong.
function check() {
  const onDisk = readdirSync(here).filter((f) => f.endsWith('.gs')).map((f) => f.slice(0, -3));
  const count = {};
  for (const p of Object.values(projects)) for (const f of p.files) count[f] = (count[f] || 0) + 1;
  const bad = [
    ...onDisk.filter((f) => !count[f]).map((f) => `unmapped: ${f}.gs`),
    ...Object.keys(count).filter((f) => !onDisk.includes(f)).map((f) => `missing on disk: ${f}.gs`),
    ...Object.keys(count).filter((f) => count[f] > 1 && !shared.includes(f)).map((f) => `mapped twice: ${f}.gs`),
  ];
  if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
  console.log(`ok: ${onDisk.length} .gs files, each in exactly one project (shared: ${shared.join(', ') || 'none'})`);
}

function run(key, { push, deploy }) {
  const p = projects[key];
  if (!p) throw new Error(`unknown project "${key}". Known: ${Object.keys(projects).join(', ')}`);
  if (!p.scriptId) throw new Error(`projects.json: set scriptId for "${key}" (Apps Script editor > Project Settings).`);
  const stage = mkdtempSync(join(tmpdir(), `clasp-${key}-`));
  writeFileSync(join(stage, '.clasp.json'), JSON.stringify({ scriptId: p.scriptId, rootDir: '.', fileExtension: 'gs' }));
  clasp(stage, 'pull');
  for (const f of readdirSync(stage)) if (f.endsWith('.js')) renameSync(join(stage, f), join(stage, f.slice(0, -3) + '.gs'));

  const remote = new Set(readdirSync(stage).filter((f) => f.endsWith('.gs')));
  const ours = new Set(p.files.map((f) => `${f}.gs`));
  const changed = [], same = [], added = [];
  for (const f of ours) {
    const dst = join(stage, f);
    if (!existsSync(dst)) added.push(f);
    else if (read(dst) === read(join(here, f))) same.push(f);
    else changed.push(f);
    copyFileSync(join(here, f), dst);
  }
  const remoteOnly = [...remote].filter((f) => !ours.has(f));
  console.log(`${p.name}\n  changed:     ${changed.join(', ') || '-'}\n  new:         ${added.join(', ') || '-'}\n  unchanged:   ${same.length}\n  remote-only: ${remoteOnly.join(', ') || '-'} (kept)`);
  if (!push) return console.log('dry run, nothing pushed. Add --push.');
  if (!changed.length && !added.length) return console.log('nothing to push.');

  clasp(stage, 'push');
  console.log('pushed.');
  if (!deploy) return;
  if (!p.deploymentId) throw new Error(`projects.json: set deploymentId for "${key}" to update its live deployment.`);
  const msg = typeof deploy === 'string' ? deploy : 'deploy.mjs';
  const v = /(\d+)/.exec(clasp(stage, 'create-version', msg))?.[1];
  if (!v) throw new Error('could not read the new version number from clasp');
  clasp(stage, 'redeploy', p.deploymentId, '-V', v, '-d', msg);
  console.log(`live deployment ${p.deploymentId.slice(0, 12)}... now at version ${v}.`);
}

if (args.includes('--check')) check();
else if (!args[0]) { console.error('usage: deploy.mjs <project>|--check [--push] [--deploy "msg"]'); process.exit(1); }
else {
  const i = args.indexOf('--deploy');
  const msg = i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
  run(args[0], { push: args.includes('--push'), deploy: i >= 0 ? msg : false });
}
