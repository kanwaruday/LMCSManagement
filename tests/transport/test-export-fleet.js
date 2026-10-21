// transport/export_fleet.py --selftest: the staff-roster fallback (retry, then the last good copy, never "verified" from nothing).
const { execFileSync } = require('child_process'), fs = require('fs'), path = require('path');
const py = ['/Library/Frameworks/Python.framework/Versions/3.13/bin/python3', 'python3'].find((p) => p === 'python3' || fs.existsSync(p));
const out = execFileSync(py, [path.join(__dirname, '../../transport/export_fleet.py'), '--selftest'], { encoding: 'utf8' });
if (!/4 checks passed/.test(out)) { console.error(out); process.exit(1); }
console.log('export_fleet selftest: 4 checks passed');
