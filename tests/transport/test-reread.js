// transport/reread_unread.py --selftest: the trust policy for what LM Studio says about a scan (a date is only accepted if the
// document's own quoted words carry it; no expiry / wrong paper / illegible are separate outcomes). No LM Studio needed.
const { execFileSync } = require('child_process'), fs = require('fs'), path = require('path');
const py = ['/Library/Frameworks/Python.framework/Versions/3.13/bin/python3', 'python3'].find((p) => p === 'python3' || fs.existsSync(p));
const out = execFileSync(py, [path.join(__dirname, '../../transport/reread_unread.py'), '--selftest'], { encoding: 'utf8' });
if (/FAIL/.test(out)) { console.error(out); process.exit(1); }
console.log('reread selftest: ' + out.split('\n').filter((l) => l.startsWith('ok')).length + ' checks passed');
