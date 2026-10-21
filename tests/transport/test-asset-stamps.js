// The Transport page loads its scripts with ?v=<content hash> so a release reaches every browser at once (tools/stamp-assets.mjs).
const { execFileSync } = require('child_process'), path = require('path');
execFileSync('node', [path.join(__dirname, '../../tools/stamp-assets.mjs'), '--check'], { stdio: 'inherit' });
