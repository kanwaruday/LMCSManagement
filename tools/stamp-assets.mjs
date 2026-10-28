#!/usr/bin/env node
// Cache-busting. GitHub Pages lets browsers keep scripts and styles for 10 minutes, so after a release a page can run old
// code, or a mix of old and new files. Every local .js/.css a listed page loads gets ?v=<first 8 hex of its sha1>, so a
// changed file gets a new address and every browser fetches it at once.
//   node tools/stamp-assets.mjs           write the stamps (stage the files you are committing first: hashes come from the git index)
//   node tools/stamp-assets.mjs --check   exit 1 if a stamp does not match (tests/transport/test-asset-stamps.js; part of verify.mjs)
// Hashes are taken from the git index (what is staged, or the last commit), not the working copy, so another session's
// uncommitted edits to shared.js neither leak into a stamp nor fail the check.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = ['principal/index.html', 'coordinator/index.html', 'owner/index.html', 'owner/kingdom.html', 'teacher/index.html', 'teacher/plan-activity.html', 'coordinator/transport/index.html', 'office/transport.html', 'coordinator/academics/index.html', 'coordinator/systems/index.html', 'coordinator/transport/live.html', 'office/buses.html', 'office/starting-data.html', 'setup/index.html', 'owner/transport/index.html', 'coordinator/transport/capture.html', 'coordinator/transport/setup.html', 'principal/issues.html', 'coordinator/hq.html', 'guide/index.html', 'hiring/index.html', 'staff/add-employee.html', 'payroll/index.html', 'curriculum-progress/daily-progress.html', 'curriculum-progress/cwa-gap-report.html', 'curriculum-progress/unmapped-chapters.html', 'office/index.html', 'office/accounts.html', 'office/daybook.html', 'office/deposits.html', 'office/close.html', 'office/report.html', 'office/hiring.html', 'principals-daily-reporting/index.html', 'coordinator/transport/rollcall.html', 'coordinator/transport/drivers.html', 'driver/index.html'];
const check = process.argv.includes('--check');
const indexed = (path) => { try { return execFileSync('git', ['show', ':' + path], { cwd: root, encoding: 'buffer', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return readFileSync(join(root, path)); } };
// auth.js carries DOCK_V: a hash of the floating Buddy's lazy-loaded files, so the pages' stamp of auth.js moves with them.
const DOCK_FILES = ['buddy-dock.js', 'buddy-dock.css', 'game.js', 'game.css', 'guide.js'].map((f) => 'assets/game/' + f);
const dockV = createHash('sha1').update(Buffer.concat(DOCK_FILES.map((f) => indexed(f)))).digest('hex').slice(0, 8);
const DOCK_RE = /(const DOCK_V = ')[0-9a-f]*(';[ ]*\/\/ stamp-assets)/;
const stale = [];
{
  const authJs = check ? indexed('assets/auth.js').toString() : readFileSync(join(root, 'assets/auth.js'), 'utf8');
  const out = authJs.replace(DOCK_RE, `$1${dockV}$2`);
  if (out !== authJs) { if (check) stale.push('assets/auth.js (DOCK_V)'); else writeFileSync(join(root, 'assets/auth.js'), out); }
}
for (const page of PAGES) {
  const html = check ? indexed(page).toString() : readFileSync(join(root, page), 'utf8');
  const out = html.replace(/(src|href)="(\.\.?\/[^"?#]+\.(?:js|css))(?:\?v=[0-9a-f]*)?"/g, (m, attr, rel) => {
    const path = relative(root, normalize(join(root, dirname(page), rel)));
    const bytes = path === 'assets/auth.js' && !check ? Buffer.from(readFileSync(join(root, path), 'utf8').replace(DOCK_RE, `$1${dockV}$2`)) : indexed(path); // write mode: the auth.js just stamped
    return `${attr}="${rel}?v=${createHash('sha1').update(bytes).digest('hex').slice(0, 8)}"`;
  });
  if (out === html) continue;
  if (check) stale.push(page); else writeFileSync(join(root, page), out);
}
if (stale.length) { console.error(`asset stamps out of date in ${stale.join(', ')}\nrun: node tools/stamp-assets.mjs  (after staging your changes), then stage the page`); process.exit(1); }
console.log(check ? 'asset stamps up to date' : 'asset stamps written');
