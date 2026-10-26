// Run: node tests/approvals/test-leave-ui.js -- the teacher page's leave helpers agree with the server rules in
// approvals-leave.gs (working days, leave types), so what a teacher sees while filling the form is what the server counts.
const vm = require('vm'), fs = require('fs'), assert = require('assert'), path = require('path');
const T = (name, fn) => { fn(); console.log('ok  -', name); };
const html = fs.readFileSync(path.join(__dirname, '../../teacher/index.html'), 'utf8');
const gs = fs.readFileSync(path.join(__dirname, '../../apps-script/approvals-leave.gs'), 'utf8');

const server = vm.createContext({ console }); vm.runInContext(gs, server);
const grab = (src, name) => { const i = src.indexOf('function ' + name + '('); let d = 0, j = src.indexOf('{', i), e; for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}') { d--; if (!d) { e = k; break; } } } return src.slice(i, e + 1); };
const page = vm.createContext({ console, Date, Math });
vm.runInContext(['lvFmt_', 'lvNowIst_', 'lvIsNonWorking_', 'lvCountWorking_'].map((n) => grab(html, n)).join('\n'), page);
const typesSrc = html.match(/const LEAVE_TYPES = \[([\s\S]*?)\n\];/)[1];
const LEAVE_TYPES = vm.runInContext('[' + typesSrc + ']', page);

T('the page and the server agree on which days are working days, for two years', () => {
  for (let d = new Date(Date.UTC(2026, 0, 1)); d < new Date(Date.UTC(2028, 0, 1)); d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    assert.equal(vm.runInContext('lvIsNonWorking_', page)(iso), vm.runInContext('aprLvIsNonWorking_', server)(iso, {}), iso);
  }
});

T('working-day count over a range matches the server', () => {
  const page_ = vm.runInContext('lvCountWorking_', page);
  const srv = vm.runInContext('aprLvValidate_', server);
  const far = { iso: '2026-01-01', hour: 0 };
  for (const [from, to] of [['2026-10-27', '2026-11-05'], ['2026-11-13', '2026-11-16'], ['2026-12-28', '2027-01-05']]) {
    assert.equal(page_(from, to), srv({ type: 'Casual Leave', from, to }, far, {}).leave.workingDays, from + ' to ' + to);
  }
});

T('the dropdown offers exactly the server types Uday chose, single-day flags match', () => {
  const serverTypes = vm.runInContext('APR_LV_TYPES', server);
  assert.deepEqual(LEAVE_TYPES.map((t) => t[0]).sort(), Object.keys(serverTypes).sort());
  for (const [value, , single] of LEAVE_TYPES) assert.equal(single, !serverTypes[value].multi, value + ' single-day flag');
  assert.ok(!LEAVE_TYPES.some((t) => /Compensatory|Absent/.test(t[0])), 'Compensatory and Absent are not offered');
});

T('page date helpers', () => {
  assert.equal(vm.runInContext('lvFmt_', page)('2026-10-29'), '29/10/2026');
  assert.equal(vm.runInContext('lvFmt_', page)(''), '—');
  const now = vm.runInContext('lvNowIst_', page)();
  assert.match(now.iso, /^\d{4}-\d{2}-\d{2}$/); assert.ok(now.hour >= 0 && now.hour <= 23);
});

console.log('all leave UI tests passed');
