// Run: node tests/campus-pages/test-campus-picker-pages.js
// Task 4 of the campus-picker plan: Hiring, Staff, Payroll and the three Curriculum pages use the shared picker, with its own
// sel passed to filter/overlay. Runs each page's real scripts (page-env.js); data is made-up.
const assert = require('assert');
const { loadPage, chip, pressed, S } = require('./page-env');
// KEEP_GOING=1 reports every failing check instead of stopping at the first.
let failed = 0;
const T = (name, fn) => { try { fn(); console.log('ok  -', name); } catch (e) { if (!process.env.KEEP_GOING) throw e; failed++; console.log('FAIL-', name, '::', String(e.message).split('\n')[0].slice(0, 90)); } };
const ov = (html) => (html.match(/lmcs-ov-item/g) || []).length;

// ── Payroll ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const prow = (entity, code, gross, net, bank, cti) => ({ entity, code, name: code, gross, net, bankPayable: bank, cti, epf: 0, epfEmployer: 0, esi: 0, esiEmployer: 0, rrf: 0, heldForFnF: 0, withheld: 0, gratuityProvision: 0, erpNet: null, erpCti: null, heldBalance: 0, adjustments: [] });
const PAY = [prow('LMS1', 'A1', 100, 90, 80, 120), prow('LMS1', 'A2', 100, 90, 80, 120), prow('LMS2', 'B1', 300, 250, 200, 330), prow('HES', 'H1', 50, 40, 0, 60)];
function payroll(session) {
  const p = loadPage('payroll/index.html', { session });
  p.run(`M = { month: '2026-10', daysInMonth: 31, locked: {}, checklist: {}, steps: ['staff','leave'], warnings: [], offers: [], nonPayroll: [], joining: [], leaving: [], transfers: [], inputs: [], rows: ${JSON.stringify(PAY)} }`);
  const stats = () => { p.run('render_()'); const h = p.els.monthRoot.innerHTML; return (k) => (h.match(new RegExp('<div class="k">' + k + '</div><div class="v">(.*?)</div></span>')) || [])[1]; };
  return Object.assign(p, { stats, pick: p.pickers['#campusPick'] });
}
T('payroll: HES chip for an All session; the Owner-only page denies others', () => {
  const p = payroll(S('ALL'));
  assert.ok(p.pick && chip(p.pick, 'HES') && chip(p.pick, 'LMS6'), 'picker mounted with HES');
  assert.strictEqual(p.run('typeof schoolTabs_'), 'undefined', 'old school tabs are gone');
  const q = loadPage('payroll/index.html', { session: S('ALL', { roles: ['Principal'] }) });
  assert.ok(!q.pickers['#campusPick'], 'no picker for a non-Owner');
});
T('payroll: filter - All is the combined total, one school its own', () => {
  const p = payroll(S('ALL'));
  let s = p.stats();
  assert.strictEqual(s('Gross'), '₹550'); assert.strictEqual(s('Staff'), '4');
  chip(p.pick, 'LMS1').click(); s = p.stats();
  assert.strictEqual(s('Gross'), '₹200'); assert.strictEqual(s('Staff'), '2'); assert.ok(!/lmcs-ov/.test(s('Gross')), 'one school: no overlay');
  chip(p.pick, 'HES').click(); // adds HES to LMS1
  chip(p.pick, 'LMS1').click(); s = p.stats();
  assert.strictEqual(s('Gross'), '₹50'); assert.strictEqual(s('Staff'), '1');
});
T('payroll: overlay - Gross, Net, Bank and CTI are one value per school, never summed', () => {
  const p = payroll(S('ALL'));
  chip(p.pick, 'LMS1').click(); chip(p.pick, 'LMS2').click();
  const s = p.stats();
  assert.strictEqual(s('Staff'), '3');
  [['Gross', ['₹200', '₹300'], '₹500'], ['Net pay', ['₹180', '₹250'], '₹430'], ['Bank transfer', ['₹160', '₹200'], '₹360'], ['CTI', ['₹240', '₹330'], '₹570']].forEach(([k, vals, sum]) => {
    assert.strictEqual(ov(s(k)), 2, k + ': two items');
    vals.forEach((v) => assert.ok(s(k).includes('<b>' + v + '</b>'), k + ' ' + v));
    assert.ok(!s(k).includes(sum), k + ' not summed');
  });
});
T('payroll: scope - a comma list offers only its own schools, no HES', () => {
  const p = payroll(S('LMS1,LMS2'));
  const codes = p.pick.children[0].children.map((b) => b.getAttribute('data-code'));
  assert.deepStrictEqual(codes, ['ALL', 'LMS1', 'LMS2']);
});
T('payroll: two schools picked - the step tick (one entity or ALL only) is not offered; one school gets it back', () => {
  const p = payroll(S('ALL'));
  chip(p.pick, 'LMS1').click(); chip(p.pick, 'LMS2').click(); p.stats();
  assert.ok(/Pick one school, or All, to tick this step/.test(p.els.monthRoot.innerHTML) && !/data-tick=/.test(p.els.monthRoot.innerHTML));
  chip(p.pick, 'LMS2').click(); p.stats();
  assert.ok(/data-tick=/.test(p.els.monthRoot.innerHTML), 'one school: tick is back');
});

// ── Staff ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
const emp = (school, name, code) => ({ school, name, employeeCode: code, role: 'Teacher', status: 'Active' });
const EMPS = [emp('LMS1', 'Asha', 'E1'), emp('LMS1', 'Bina', 'E2'), emp('LMS2', 'Chitra', 'E3'), emp('HES', 'Deepa', 'E4')];
function staff(session) {
  const p = loadPage('staff/add-employee.html', { session });
  p.run(`directoryRows = ${JSON.stringify(EMPS)}; documentStatusRows = ${JSON.stringify(EMPS.map((e) => Object.assign({ documents: {}, rule: '' }, e)))};`);
  return Object.assign(p, { pick: p.pickers['#campusPick'], dir: () => { p.run('renderDirectory()'); return { count: p.els.dirCount.innerHTML, body: p.els.dirBody.innerHTML }; },
    docs: () => { p.run('renderDocumentStatus()'); return { count: p.els.docCount.innerHTML, body: p.els.docBody.innerHTML }; } });
}
T('staff: filter - All lists everyone (HES too); one school lists its own; counts agree', () => {
  const p = staff(S('ALL'));
  assert.ok(chip(p.pick, 'HES'), 'HES offered to an All session');
  let d = p.dir();
  assert.strictEqual(d.count, '4 employees'); ['Asha', 'Bina', 'Chitra', 'Deepa'].forEach((n) => assert.ok(d.body.includes(n), n));
  chip(p.pick, 'LMS2').click(); d = p.dir();
  assert.strictEqual(d.count, '1 employee'); assert.ok(d.body.includes('Chitra') && !d.body.includes('Asha') && !d.body.includes('<th>School</th>'));
  chip(p.pick, 'LMS2').click(); chip(p.pick, 'HES').click(); d = p.dir();
  assert.strictEqual(d.count, '1 employee'); assert.ok(d.body.includes('Deepa') && !d.body.includes('Chitra'), 'HES alone');
});
T('staff: overlay - two schools show one count each, a School column, and the Documents tab agrees', () => {
  const p = staff(S('ALL'));
  chip(p.pick, 'LMS1').click(); chip(p.pick, 'LMS2').click();
  const d = p.dir();
  assert.strictEqual(ov(d.count), 2); assert.ok(d.count.includes('<b>2</b>') && d.count.includes('<b>1</b>') && !d.count.includes('<b>3</b>'), 'per school, not 3');
  assert.ok(d.body.includes('<th>School</th>') && d.body.includes('Chitra') && !d.body.includes('Deepa'));
  const x = p.docs();
  assert.strictEqual(ov(x.count), 2); assert.ok(x.body.includes('Chitra') && x.body.includes('Asha') && !x.body.includes('Deepa'), 'documents follow the same picks');
});
T('staff: scope - a Principal at one school sees no picker; a two-school list has no All-network or HES chip', () => {
  const one = staff(S('LMS3', { roles: ['Principal'] }));
  assert.strictEqual(one.pick.hidden, true, 'single-school scope hides the picker');
  const two = staff(S('LMS3,LMS4', { roles: ['Principal'] }));
  assert.deepStrictEqual(two.pick.children[0].children.map((b) => b.getAttribute('data-code')), ['ALL', 'LMS3', 'LMS4']);
  assert.strictEqual(two.dir().count, '4 employees', 'under All the rows the backend scoped are all kept');
});

// ── Hiring ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const APPS = [{ row: 1, name: 'A', branches: 'LMS-1', status: '' }, { row: 2, name: 'B', branches: 'LMS-2, LMS-3', status: '' }, { row: 3, name: 'C', branches: '', status: '' }];
function hiring(session) {
  const p = loadPage('hiring/index.html', { session });
  p.els.search = Object.assign(p.els.search || {}, {}); p.run("document.getElementById('search').value = ''");
  p.run(`DATA = { applicants: ${JSON.stringify(APPS)}, statuses: [], rejectReasons: [], positions: [] }; APPTS = { toAccept: [{ id: 'a', campus: 'LMS1' }, { id: 'b', campus: 'LMS3' }], myProposals: [], upcoming: [] };`);
  return Object.assign(p, { pick: p.pickers['#campusRow'], rows: () => p.run('visible_().map(function (a) { return a.row; })').join(','),
    appts: () => p.run('(APPTS.toAccept || []).filter(inCampus_).map(function (x) { return x.id; })').join(',') });
}
T('hiring: scope - myCampuses_ is the picker scope (session only, never HES)', () => {
  assert.deepStrictEqual(Array.from(hiring(S('ALL', { roles: ['Coordinator'] })).run('myCampuses_()')), ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6']);
  assert.deepStrictEqual(Array.from(hiring(S('LMS2,LMS4,HES', { roles: ['Coordinator'] })).run('myCampuses_()')), ['LMS2', 'LMS4']);
  assert.deepStrictEqual(Array.from(hiring(S('LMS4', { roles: ['Principal'] })).run('myCampuses_()')), ['LMS4']);
  const h = hiring(S('LMS2,LMS4', { roles: ['Principal'] }));
  assert.deepStrictEqual(h.pick.children[0].children.map((b) => b.getAttribute('data-code')), ['ALL', 'LMS2', 'LMS4']);
});
T('hiring: filter - All keeps everyone (even an untagged applicant); picks keep any applicant who spans a picked school', () => {
  const h = hiring(S('ALL', { roles: ['Coordinator'] }));
  assert.ok(!h.pick.hidden && chip(h.pick, 'LMS6'));
  assert.strictEqual(h.rows(), '1,2,3');
  chip(h.pick, 'LMS3').click(); assert.strictEqual(h.rows(), '2'); assert.strictEqual(h.appts(), 'b');
  chip(h.pick, 'LMS1').click(); assert.strictEqual(h.rows(), '1,2'); assert.strictEqual(h.appts(), 'a,b', 'appointments follow the same picks');
  assert.deepStrictEqual(pressed(h.pick), ['LMS1', 'LMS3']);
});
T('hiring: role chips follow the picked schools, and the Add form defaults to a single pick', () => {
  const h = hiring(S('ALL', { roles: ['Coordinator'] }));
  h.run(`APPROVAL_STATUS = { campuses: [{ campusId: 'LMS1', newPositions: [{ roleLevel: 'TGT', subjects: 'Eng', roleKey: 'k1' }] }, { campusId: 'LMS2', newPositions: [{ roleLevel: 'PRT', subjects: 'Hindi', roleKey: 'k2' }] }] }; SL_FILTER = 'all';`);
  let html = h.run('renderRole_()'); assert.ok(html.includes('k1') && html.includes('k2'));
  chip(h.pick, 'LMS2').click(); html = h.run('renderRole_()'); assert.ok(html.includes('k2') && !html.includes('k1'), 'only the picked school');
  assert.ok(/<option value="LMS2" selected>/.test(h.run('addFormHtml_()')), 'one pick: the form starts on it');
});
T('hiring: a one-school session hides the picker', () => {
  assert.strictEqual(hiring(S('LMS4', { roles: ['Principal'] })).pick.hidden, true);
});

// ── Curriculum ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const d0 = new Date('2026-09-01');
const gap = (lmsIdx, type) => ({ type, lmsIdx, cls: 'Class 5', subject: 'Maths', teacher: 'T', chapterNo: 1, chapterName: 'Ch', plannedDate: d0, deadline: d0, days: 5 });
const GAPS = [gap(0, 'overdue'), gap(0, 'critical'), gap(1, 'overdue'), gap(2, 'overdue')];
function gapPage(session) {
  const p = loadPage('curriculum-progress/cwa-gap-report.html', { session });
  p.run(`gapData = ${JSON.stringify(GAPS)}.map(function (g) { g.plannedDate = new Date(g.plannedDate); g.deadline = new Date(g.deadline); return g; }); trackerRows = ${JSON.stringify(GAPS.map((g) => ({ lmsIdx: g.lmsIdx, status: 'OnTime' })))};`);
  return Object.assign(p, { pick: p.pickers['#campusPick'], render: () => { p.run('renderGapPanel()'); return p.els.gapPanel.innerHTML; } });
}
T('cwa-gap-report: filter and overlay - the picker replaces the School select; two schools show one count each', () => {
  const g = gapPage(S('ALL'));
  let h = g.render();
  assert.ok(!/🏫 School/.test(h), 'no School select'); assert.strictEqual(g.run('getFilteredSortedGapRows().rows.length'), 4);
  assert.ok(g.els.cOverdue.innerHTML === '3' && g.els.cCritical.innerHTML === '1', 'All: combined chips');
  chip(g.pick, 'LMS1').click(); h = g.render();
  assert.strictEqual(g.run('getFilteredSortedGapRows().rows.length'), 2); assert.ok(g.els.cOverdue.innerHTML === '1' && g.els.cCritical.innerHTML === '1');
  chip(g.pick, 'LMS2').click(); h = g.render();
  assert.strictEqual(g.run('getFilteredSortedGapRows().rows.length'), 3);
  assert.strictEqual(ov(g.els.cOverdue.innerHTML), 2); assert.ok(g.els.cOverdue.innerHTML.includes('<b>1</b>') && !g.els.cOverdue.innerHTML.includes('<b>2</b>'), 'per school');
  assert.strictEqual(ov(g.els.cCWATotal.innerHTML), 2, 'CWA total is per school too');
  assert.ok(h.includes('LMS 1') && h.includes('LMS 2') && !h.includes('🏫 LMS 3'), 'only picked schools get a section');
  assert.strictEqual(g.run('gapExportFilenameSuffix_()'), 'LMS1+LMS2-', 'export name says which schools');
});
T('cwa-gap-report: Principal lock - a campus-scoped session sees only its school, picker hidden, even under All', () => {
  const g = gapPage(S('LMS2', { roles: ['Principal'] }));
  assert.strictEqual(g.pick.hidden, true);
  assert.strictEqual(g.run('getFilteredSortedGapRows().rows.map(function (x) { return x.lmsIdx; }).join()'), '1');
  const two = gapPage(S('LMS1,LMS2', { roles: ['Principal'] }));
  assert.strictEqual(two.run('getFilteredSortedGapRows().rows.map(function (x) { return x.lmsIdx; }).join()'), '0,0,1');
  assert.deepStrictEqual(two.pick.children[0].children.map((b) => b.getAttribute('data-code')), ['ALL', 'LMS1', 'LMS2']);
});

const UNM = [0, 0, 1, 2].map((i) => ({ lmsIdx: i, cls: 'Class 5', subject: 'Maths', teacher: 'T', chapterName: 'Ch', actualDate: new Date('2026-09-01') }));
function unmapped(session) {
  const p = loadPage('curriculum-progress/unmapped-chapters.html', { session });
  p.run(`allRows = ${JSON.stringify(UNM)}.map(function (r) { r.actualDate = new Date(r.actualDate); return r; });`);
  return Object.assign(p, { pick: p.pickers['#campusPick'], render: () => { p.run('renderPanel()'); return p.els.gapPanel.innerHTML; } });
}
T('unmapped-chapters: filter and overlay', () => {
  const u = unmapped(S('ALL'));
  let h = u.render();
  assert.ok(!/🏫 School/.test(h)); assert.strictEqual(u.els.cUnmapped.innerHTML, '4');
  chip(u.pick, 'LMS1').click(); u.render(); assert.strictEqual(u.els.cUnmapped.innerHTML, '2');
  chip(u.pick, 'LMS3').click(); h = u.render();
  assert.strictEqual(ov(u.els.cUnmapped.innerHTML), 2); assert.ok(u.els.cUnmapped.innerHTML.includes('<b>2</b>') && u.els.cUnmapped.innerHTML.includes('<b>1</b>') && !u.els.cUnmapped.innerHTML.includes('<b>3</b>'));
  assert.ok(!h.includes('🏫 LMS 2'));
});
T('unmapped-chapters: Principal lock', () => {
  const u = unmapped(S('LMS3', { roles: ['Principal'] }));
  assert.strictEqual(u.pick.hidden, true); u.render(); assert.strictEqual(u.els.cUnmapped.innerHTML, '1');
});

const REC = [0, 0, 1, 5].map((i, n) => ({ lmsIdx: i, dateStr: '2026-09-01', subject: 'Maths', classMapped: 'Class 5', n }));
function daily(session) {
  const p = loadPage('curriculum-progress/daily-progress.html', { session });
  p.run('activeDateFrom = activeDateTo = null');
  return Object.assign(p, { pick: p.pickers['#campusPick'], idxs: () => p.run(`filtered(${JSON.stringify(REC)}).map(function (r) { return r.lmsIdx; }).join()`) });
}
T('daily-progress: filter - the lmsIdx records follow the picker (codes mapped in one helper)', () => {
  const d = daily(S('ALL'));
  assert.ok(!d.run('typeof activeSchools !== "undefined"') , 'old activeSchools filter is gone');
  assert.strictEqual(d.idxs(), '0,0,1,5');
  chip(d.pick, 'LMS6').click(); assert.strictEqual(d.idxs(), '5');
  chip(d.pick, 'LMS1').click(); assert.strictEqual(d.idxs(), '0,0,5');
  assert.strictEqual(d.run('CurrPick.code(5)'), 'LMS6');
  assert.strictEqual(d.run('CurrPick.pick(CM_SCHOOLS.map(function (s, idx) { return { idx: idx }; }), "idx").map(function (x) { return x.idx; }).join()'), '0,5', 'Pulse school list follows the picker');
});
T('daily-progress: Principal lock - one school only, picker hidden, even under All', () => {
  const d = daily(S('LMS2', { roles: ['Principal'] }));
  assert.strictEqual(d.pick.hidden, true); assert.strictEqual(d.idxs(), '1');
  assert.strictEqual(daily(S('LMS1,LMS6', { roles: ['Principal'] })).idxs(), '0,0,5');
});
if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('campus picker pages: ok');
