#!/usr/bin/env node
// One command that says whether the repo is safe to ship:  node tests/verify.mjs [--live]
//   1. every test under tests/ passes     2. every .gs compiles     3. .gs files map to projects exactly once
//   --live: the published GitHub Pages portal pages and the Apps Script /exec deployments answer.
// Exit code 0 = all good. Claude: run this before every commit/push, and with --live after a deploy.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const step = (name, fn) => { try { fn(); console.log(`ok    ${name}`); } catch (e) { failures.push(name); console.log(`FAIL  ${name}\n${String(e.stderr || e.stdout || e.message).split('\n').slice(-12).join('\n')}`); } };

const tests = readdirSync(join(root, 'tests'), { recursive: true })
  .filter((f) => /(^|\/)(test-[^/]+\.js|run\.js)$/.test(f));
for (const t of tests) step(`test ${t}`, () => execFileSync('node', [join(root, 'tests', t)], { stdio: 'pipe', encoding: 'utf8' }));

for (const f of readdirSync(join(root, 'apps-script')).filter((f) => f.endsWith('.gs')))
  step(`compile ${f}`, () => new vm.Script(readFileSync(join(root, 'apps-script', f), 'utf8'), { filename: f }));

step('gs files mapped to projects', () => execFileSync('node', [join(root, 'apps-script/deploy.mjs'), '--check'], { stdio: 'pipe', encoding: 'utf8' }));

if (process.argv.includes('--live')) {
  const pages = ['', 'coordinator/', 'payroll/', 'hiring/', 'principals-daily-reporting/', 'staff/add-employee.html', 'office/', 'owner/'];
  const projects = JSON.parse(readFileSync(join(root, 'apps-script/projects.json'), 'utf8'));
  const urls = [
    ...pages.map((p) => `https://kanwaruday.github.io/LMCSManagement/${p}`),
    ...Object.values(projects).filter((p) => p?.deploymentId).map((p) => `https://script.google.com/macros/s/${p.deploymentId}/exec`),
  ];
  const results = await Promise.allSettled(urls.map(async (u) => { const r = await fetch(u, { redirect: 'follow' }); if (!r.ok) throw new Error(`${r.status} ${u}`); }));
  results.forEach((r, i) => step(`live ${urls[i]}`, () => { if (r.status === 'rejected') throw r.reason; }));
}

console.log(failures.length ? `\n${failures.length} FAILED` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
