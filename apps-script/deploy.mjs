#!/usr/bin/env node
// Deploy one Apps Script project from this folder with clasp.
//   node apps-script/deploy.mjs <project>                 dry run: show what would change
//   node apps-script/deploy.mjs <project> --push          push the files
//   node apps-script/deploy.mjs <project> --push --deploy "message"
//                                                         push, version, update the live /exec deployment
//   node apps-script/deploy.mjs --check                   offline: every .gs file is mapped exactly once
// Projects and file lists: projects.json. First time: `npx @google/clasp login`, then fill in scriptId.
// A file entry with a '/' is a path (relative to this folder) to a plain .js file shared with the portal pages, pushed as
// <basename>.gs (e.g. ../coordinator/capture/fleet-quests.js, the Fleet setup quest logic the setup page also loads).
//
// Safety: stages in a temp dir from the REMOTE project (pull), overlays our files on top. So the remote
// appsscript.json (scopes, webapp access) is kept, and remote-only files are kept, never deleted, EXCEPT names listed in the
// project's "retire" (a remote file our files replace, e.g. chapter's old Code.gs, now chapter-main.gs: both loaded = duplicate
// declarations and a dead /exec). Retired files are dropped from the stage, so clasp push removes them from the project.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, mkdtempSync, copyFileSync, renameSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve, relative } from 'node:path';
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
const pushedAs = (f) => (f.includes('/') ? basename(f).replace(/\.js$/, '') + '.gs' : `${f}.gs`);

// Shared .js entries: a .js file inside the repo that exists, never pushed under the name of a .gs file here, and no two entries
// of one project pushed under the same name (one would silently replace the other).
function sharedProblems() {
  const gs = new Set(readdirSync(here).filter((f) => f.endsWith('.gs'))), bad = [];
  for (const [key, p] of Object.entries(projects)) {
    const seen = new Set();
    for (const r of p.retire || []) {
      if (typeof r !== 'string' || !/^[\w.-]+$/.test(r) || r.endsWith('.gs')) bad.push(`${key}: retire "${r}" must be a bare file name`);
      else if (p.files.some((f) => pushedAs(f) === `${r}.gs`)) bad.push(`${key}: retire "${r}" is also one of its files`);
    }
    // gameDeploymentId: a SECOND live deployment of the same project (office: the game's key-gated one, created anonymous), redeployed with the first
    if (p.gameDeploymentId !== undefined && !(typeof p.gameDeploymentId === 'string' && /^AKfycb[\w-]{20,}$/.test(p.gameDeploymentId) && p.gameDeploymentId !== p.deploymentId)) bad.push(`${key}: gameDeploymentId must be an AKfycb... deployment id different from deploymentId`);
    for (const f of p.files) {
      const name = pushedAs(f);
      if (seen.has(name)) bad.push(`${key}: two entries are pushed as ${name}`);
      seen.add(name);
      if (!f.includes('/')) continue;
      const full = resolve(here, f);
      if (relative(join(here, '..'), full).startsWith('..')) bad.push(`${key}: ${f} is outside the repo`);
      if (!f.endsWith('.js')) bad.push(`${key}: ${f} is not a .js file`);
      if (gs.has(name)) bad.push(`${key}: ${f} would replace ${name}`);
      if (!existsSync(full)) bad.push(`missing on disk: ${f}`);
    }
  }
  return bad;
}

// ponytail: mapping check is by filename only; add a header-vs-project check if a file is ever mapped wrong.
function check() {
  const onDisk = readdirSync(here).filter((f) => f.endsWith('.gs')).map((f) => f.slice(0, -3));
  const count = {};
  for (const p of Object.values(projects)) for (const f of p.files) if (!f.includes('/')) count[f] = (count[f] || 0) + 1;
  const bad = [
    ...sharedProblems(),
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
  const pullTo = (dir) => {
    writeFileSync(join(dir, '.clasp.json'), JSON.stringify({ scriptId: p.scriptId, rootDir: '.', fileExtension: 'gs' }));
    clasp(dir, 'pull');
    for (const f of readdirSync(dir)) if (f.endsWith('.js')) renameSync(join(dir, f), join(dir, f.slice(0, -3) + '.gs'));
  };
  const stage = mkdtempSync(join(tmpdir(), `clasp-${key}-`));
  pullTo(stage);

  const remote = new Set(readdirSync(stage).filter((f) => f.endsWith('.gs')));
  const bad = sharedProblems();
  if (bad.length) throw new Error('projects.json: ' + bad.join('; '));
  const src = Object.fromEntries(p.files.map((f) => [pushedAs(f), f.includes('/') ? join(here, f) : join(here, `${f}.gs`)]));
  const ours = new Set(Object.keys(src));
  const changed = [], same = [], added = [];
  for (const f of ours) {
    const dst = join(stage, f);
    if (!existsSync(dst)) added.push(f);
    else if (read(dst) === read(src[f])) same.push(f);
    else changed.push(f);
    copyFileSync(src[f], dst);
  }
  const retired = (p.retire || []).map((r) => `${r}.gs`).filter((f) => remote.has(f));
  for (const f of retired) unlinkSync(join(stage, f));
  const remoteOnly = [...remote].filter((f) => !ours.has(f) && !retired.includes(f));
  console.log(`${p.name}\n  changed:     ${changed.join(', ') || '-'}\n  new:         ${added.join(', ') || '-'}\n  unchanged:   ${same.length}\n  retired:     ${retired.join(', ') || '-'} (removed from the project)\n  remote-only: ${remoteOnly.join(', ') || '-'} (kept)`);
  if (!push) return console.log('dry run, nothing pushed. Add --push.');
  if (!changed.length && !added.length && !retired.length) return console.log('nothing to push.');

  // clasp 3 pushes only when a local file is new or differs from HEAD; a deletion alone is "Script is already up to date."
  // and nothing is sent. So a retire with no other change marks one of our files (a comment line) to force the full push,
  // which replaces HEAD's file list and so drops the retired files. The next deploy pushes the plain file again.
  if (retired.length && !changed.length && !added.length) {
    const f = [...ours].sort()[0];
    writeFileSync(join(stage, f), read(join(stage, f)) + `\n// deploy.mjs: retired ${retired.join(', ')}\n`);
  }
  const out = clasp(stage, 'push');
  if (/already up to date/i.test(out)) throw new Error('clasp pushed nothing ("already up to date"); nothing versioned.');
  // Check HEAD before any version: every file of ours as staged, no retired file left.
  const head = mkdtempSync(join(tmpdir(), `clasp-${key}-head-`));
  pullTo(head);
  const headBad = [
    ...retired.filter((f) => existsSync(join(head, f))).map((f) => `${f} is still in the project`),
    ...[...ours].filter((f) => !existsSync(join(head, f)) || read(join(head, f)) !== read(join(stage, f))).map((f) => `${f} in the project differs from what was pushed`),
  ];
  if (headBad.length) throw new Error('after push: ' + headBad.join('; ') + '. Nothing versioned.');
  console.log('pushed (HEAD checked).');
  if (!deploy) return;
  if (!p.deploymentId) throw new Error(`projects.json: set deploymentId for "${key}" to update its live deployment.`);
  const msg = typeof deploy === 'string' ? deploy : 'deploy.mjs';
  const v = /(\d+)/.exec(clasp(stage, 'create-version', msg))?.[1];
  if (!v) throw new Error('could not read the new version number from clasp');
  clasp(stage, 'redeploy', p.deploymentId, '-V', v, '-d', msg);
  console.log(`live deployment ${p.deploymentId.slice(0, 12)}... now at version ${v}.`);
  if (p.gameDeploymentId) { // the game's own deployment moves to the same version, so the old pages and the game never run different code
    clasp(stage, 'redeploy', p.gameDeploymentId, '-V', v, '-d', msg);
    console.log(`game deployment ${p.gameDeploymentId.slice(0, 12)}... now at version ${v}.`);
  }
}

if (args.includes('--check')) check();
else if (!args[0]) { console.error('usage: deploy.mjs <project>|--check [--push] [--deploy "msg"]'); process.exit(1); }
else {
  const i = args.indexOf('--deploy');
  const msg = i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
  run(args[0], { push: args.includes('--push'), deploy: i >= 0 ? msg : false });
}
