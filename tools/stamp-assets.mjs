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
const PAGES = ['coordinator/transport/index.html', 'office/transport.html', 'coordinator/transport/live.html', 'office/buses.html'];
const check = process.argv.includes('--check');
const indexed = (path) => { try { return execFileSync('git', ['show', ':' + path], { cwd: root, encoding: 'buffer', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return readFileSync(join(root, path)); } };
const stale = [];
for (const page of PAGES) {
  const html = check ? indexed(page).toString() : readFileSync(join(root, page), 'utf8');
  const out = html.replace(/(src|href)="(\.\.?\/[^"?#]+\.(?:js|css))(?:\?v=[0-9a-f]*)?"/g, (m, attr, rel) => {
    const path = relative(root, normalize(join(root, dirname(page), rel)));
    return `${attr}="${rel}?v=${createHash('sha1').update(indexed(path)).digest('hex').slice(0, 8)}"`;
  });
  if (out === html) continue;
  if (check) stale.push(page); else writeFileSync(join(root, page), out);
}
if (stale.length) { console.error(`asset stamps out of date in ${stale.join(', ')}\nrun: node tools/stamp-assets.mjs  (after staging your changes), then stage the page`); process.exit(1); }
console.log(check ? 'asset stamps up to date' : 'asset stamps written');
