// Stored-XSS guard (review P0 #4): applicant text comes from a PUBLIC Google Form, so every free-text field that reaches
// an HTML string must go through an escaper. This scans the hiring pages' sources: in every line that builds HTML, any
// `+ <expr> +` interpolation that READS a free-text field must be wrapped in esc_ / esc / e. Run: node tests/hiring/test-escaping.js
const fs = require('fs'), path = require('path'), assert = require('assert');
const root = path.join(__dirname, '../..');
const FILES = ['hiring/index.html', 'office/hiring.html', 'office/js/hiring.js', 'coordinator/hr/index.html', 'coordinator/approvals.js'].filter((f) => fs.existsSync(path.join(root, f)));
// free text an applicant, clerk or Principal can type (or that carries it)
const FIELDS = ['name', 'subjects', 'qualification', 'notes', 'note', 'branches', 'bed', 'age', 'gender', 'source', 'rejectReason', 'declineNote', 'place',
  'calendarError', 'reason', 'phone', 'reviveNote', 'address', 'proposedBy', 'decidedBy', 'employeeCodeNote', 'positionLabel', 'position', 'strengths', 'weaknesses'];
const READS = new RegExp('\\.(' + FIELDS.join('|') + ')\\b');
const ESC = /^\s*(esc_|esc|e)\(/;
const bad = [];
FILES.forEach((f) => {
  fs.readFileSync(path.join(root, f), 'utf8').split('\n').forEach((line, i) => {
    if (!/<[a-z/]/i.test(line)) return;
    for (const m of line.matchAll(/'\s*\+\s*([^'+][^']*?)\s*\+\s*'/g)) {
      const expr = m[1];
      if (READS.test(expr) && !ESC.test(expr)) bad.push(f + ':' + (i + 1) + '  ' + expr.trim().slice(0, 90));
    }
  });
});
assert.deepStrictEqual(bad, [], 'unescaped free-text interpolations:\n' + bad.join('\n'));
console.log('ok  - hiring pages escape every free-text interpolation (' + FILES.length + ' files)');
