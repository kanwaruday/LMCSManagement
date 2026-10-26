// Task 5 of the campus-picker plan: Office header (pickCampus), Accounts summary overlay, Principals' Daily Reporting
// single-select, Owner transport overlay. Made-up data. Run: node tests/campus-pages/test-office-pickers.js
const assert = require('assert'), fs = require('fs'), vm = require('vm'), path = require('path');
const { loadPage, chip, pressed, S } = require('./page-env');
const { fakeEl, NAMES } = require('../coordinator/campus-env');
const root = path.join(__dirname, '../..');
const T = (name, fn) => Promise.resolve().then(fn).then(() => console.log('ok  -', name));
const mem = (o) => { const s = Object.assign({}, o); return { getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, s }; };
const pickerCtx = (extra) => { const c = vm.createContext(Object.assign({ console, Date, localStorage: mem(), document: { createElement: fakeEl, querySelector: () => null, getElementById: () => null, head: { appendChild() {} } }, LMCS: { campusLabel: (x) => NAMES[x] || x, getSession: () => null } }, extra)); c.window = c; vm.runInContext(fs.readFileSync(path.join(root, 'assets/campus-picker.js'), 'utf8'), c); return c; };

(async () => {
  const { pickCampus } = await import('../../office/js/shell.js');
  const A = await import('../../office/js/accounts.js');

  await T('office header: session.campus is one valid code inside the scope, never a comma list', () => {
    assert.strictEqual(pickCampus({ campusId: 'LMS1,LMS2', email: 'a' }, mem()), 'LMS1');
    assert.strictEqual(pickCampus({ campusId: 'LMS3, LMS2', email: 'a' }, mem()), 'LMS2', 'first in scope order, whitespace ignored');
    assert.strictEqual(pickCampus({ campusId: 'LMS5', email: 'a' }, mem()), 'LMS5');
    assert.strictEqual(pickCampus({ campusId: 'HES', email: 'a' }, mem()), 'HES');
    assert.strictEqual(pickCampus({ campusId: 'XYZ', email: 'a' }, mem()), '', 'nothing valid fails closed');
    assert.strictEqual(pickCampus({ campusId: '', email: 'a' }, mem()), '', 'no scope fails closed');
    assert.strictEqual(pickCampus({ campusId: 'LMS2,LMS3', email: 'a' }, mem({ 'lmcs-campus1:a': '{"v":1,"sel":["LMS6"]}', 'lmcs-office-campus': 'LMS6' })), 'LMS2', 'stored choices never leave the scope');
  });
  await T('office header: ALL reads the picker key, then the old key once (copied across), else LMS1', () => {
    assert.strictEqual(pickCampus({ campusId: 'ALL', email: 'a' }, mem({ 'lmcs-campus1:a': '{"v":1,"sel":["LMS4"]}', 'lmcs-office-campus': 'LMS2' })), 'LMS4');
    const m = mem({ 'lmcs-office-campus': 'HES' });
    assert.strictEqual(pickCampus({ campusId: 'ALL', email: 'a' }, m), 'HES');
    assert.strictEqual(m.s['lmcs-campus1:a'], '{"v":1,"sel":["HES"]}');
    assert.strictEqual(pickCampus({ campusId: 'ALL', email: 'b' }, mem()), 'LMS1');
  });

  await T('office header: picker is single-select with HES, ALL sessions only, on every Office page', () => {
    const c = pickerCtx(), mk = (campusId) => { const el = fakeEl('div'); c.LMCSCampus.mount(el, { session: { email: 'q' + campusId, campusId }, multi: false, hes: true }); return el; };
    const el = mk('ALL');
    assert.ok(chip(el, 'HES') && !chip(el, 'ALL') && el.children[0].children.length === 7, 'LMS1-6 + HES, no All chip');
    assert.strictEqual(pressed(el).length, 1);
    chip(el, 'LMS3').click(); chip(el, 'LMS4').click();
    assert.deepStrictEqual(pressed(el), ['LMS4'], 'exactly one');
    const sh = fs.readFileSync(path.join(root, 'office/js/shell.js'), 'utf8');
    assert.ok(/session\.campusId === 'ALL'\) \{[^}]*LMCSCampus\.mount/.test(sh) && /multi: false, hes: true/.test(sh), 'mounted for ALL only');
    fs.readdirSync(path.join(root, 'office')).filter((f) => f.endsWith('.html')).forEach((f) => {
      const h = fs.readFileSync(path.join(root, 'office', f), 'utf8');
      assert.ok(/<div id="campus-pick" hidden>/.test(h) && /campus-picker\.js/.test(h) && /campus-picker\.css/.test(h), f);
    });
  });

  await T('office boot: a blank campus stops before onReady and queues nothing', async () => {
    const el = () => ({ style: {}, textContent: '', innerHTML: '' }), els = {};
    global.document = { getElementById: (i) => els[i] || (els[i] = el()) };
    global.navigator = {};
    global.window = { LMCS: { getSession: () => ({ email: 'a', name: 'N', campusId: 'XYZ' }), campusLabel: (c) => c } };
    let ready = false;
    const { bootOffice } = await import('../../office/js/shell.js');
    await bootOffice({ onReady: () => { ready = true; } });
    assert.ok(!ready && /doesn&#39;t include a school/.test(els.today.innerHTML), els.today.innerHTML);
    delete global.document; delete global.navigator; delete global.window;
  });

  await T('accounts summary: 2+ schools show a total per school (never summed); one school a plain total', () => {
    const cfg = { collections: [] }, ov = pickerCtx().LMCSCampus.overlay;
    const sum = (bal, owed) => ({ accounts: [{ kind: 'bank', balance_paise: bal }, { kind: 'credit', owed_paise: owed }], collections: [] });
    assert.deepStrictEqual(A.summaryTotals(sum(1000, 300), cfg), { owed: 300, balance: 1000, held: 0 });
    const html = A.summaryOverlay([['LMS1', sum(1000, 300)], ['LMS2', sum(5000, 0)]], cfg, ov);
    assert.strictEqual((html.match(/lmcs-ov-item/g) || []).length, 6, 'three lines x two schools');
    assert.ok(/LMS 1 <b>[^<]*10[^<]*<\/b>/.test(html) && /LMS 2 <b>[^<]*50[^<]*<\/b>/.test(html));
    assert.ok(!/60\.00|₹60\b/.test(html), 'not summed');
    const sc = (x) => [...pickerCtx().LMCSCampus.scope(x, { hes: true })], all = { all: true, campuses: [] };
    const acct = { campusId: 'LMS2,LMS3', roles: ['Accounts'] };
    assert.deepStrictEqual(A.summaryTargets(acct, all, sc(acct)), ['LMS2', 'LMS3'], 'scoped Accounts user: All = their schools, never ALL');
    assert.deepStrictEqual(A.summaryTargets({ campusId: 'LMS5', roles: ['Accounts'] }, all, ['LMS5']), ['LMS5']);
    assert.deepStrictEqual(A.summaryTargets({ campusId: 'ALL' }, all, sc({ campusId: 'ALL' })), ['ALL'], 'ALL sign-in: one ALL call');
    assert.deepStrictEqual(A.summaryTargets({ campusId: 'ALL' }, { all: false, campuses: ['LMS1', 'LMS4'] }, []), ['LMS1', 'LMS4'], 'picks: one call each');
    assert.deepStrictEqual(A.summaryTargets({ campusId: 'XYZ' }, all, []), [], 'nothing in scope: no calls');
    assert.ok(/summaryTargets\(session, sumSel/.test(fs.readFileSync(path.join(root, 'office/js/accounts.js'), 'utf8')), 'showAccounts uses it');
  });

  await T("daily reporting: single-select, no All chip; a Principal gets no picker", () => {
    const p = loadPage('principals-daily-reporting/index.html', { session: S('ALL') });
    p.run('setupSchoolPicker()');
    const el = p.pickers['#schoolPicker'];
    assert.ok(el && chip(el, 'LMS6') && !chip(el, 'ALL') && !chip(el, 'HES'), 'six schools, no All, no HES');
    assert.deepStrictEqual(pressed(el), ['LMS1']); assert.strictEqual(p.run('SELECTED_CAMPUS_ID'), 'LMS1');
    chip(el, 'LMS5').click(); chip(el, 'LMS2').click();
    assert.deepStrictEqual(pressed(el), ['LMS2']); assert.strictEqual(p.run('SELECTED_CAMPUS_ID'), 'LMS2', 'one school at a time');
    const q = loadPage('principals-daily-reporting/index.html', { session: S('LMS3', { roles: ['Principal'] }) });
    q.run('setupSchoolPicker()');
    assert.strictEqual(q.run('SELECTED_CAMPUS_ID'), 'LMS3'); assert.strictEqual(q.els.schoolPickerWrap.style.display, 'none');
    const none = loadPage('principals-daily-reporting/index.html', { session: null });
    none.run('SESSION = null; setupSchoolPicker()'); assert.ok(!none.run('SELECTED_CAMPUS_ID'), 'no session, no school');
  });

  await T('owner transport: four numbers narrow to the picked schools; 2+ schools show one value each', async () => {
    const d = { today: '2026-10-26', proposals: { shared: [] }, pnl: [],
      tasks: [{ campus: 'LMS1', status: 'open', due: '2026-10-20', severity: 'high', domain: 'fuel_check', title: 't1', taskId: 'a' }, { campus: 'LMS1', status: 'open', due: '2026-11-20', domain: 'gps_dead', title: 't2', taskId: 'b' }, { campus: 'LMS4', status: 'open', due: '2026-11-20', domain: 'gps_dead', title: 't3', taskId: 'c' }],
      checks: [{ campus: 'LMS 1', flag: 'yes', date: '2026-10-10', excessRs: 400 }, { campus: 'LMS 4', flag: 'yes', date: '2026-10-12', excessRs: 100 }],
      days: [{ reg: 'R1', nightAwayKm: 10 }], // 2*10km / 5 * 95 = Rs 380 for LMS1's bus
      vehicles: [{ reg: 'R1', campus: 'LMS1', operational: true, tracker: 'ok', year: 2005 }, { reg: 'R2', campus: 'LMS1', operational: true, tracker: 'dead', year: 2020 }, { reg: 'R3', campus: 'LMS4', operational: true, tracker: 'ok', year: 2020 }] };
    const store = {}, ctx = vm.createContext({ console, Date, Math, JSON, Promise, Object, Set, setTimeout, localStorage: mem(), document: { createElement: fakeEl, querySelector: () => null, getElementById: () => null, head: { appendChild() {} } }, LMCS: { campusLabel: (x) => NAMES[x] || x, getSession: () => ({ email: 'o', campusId: 'ALL' }) },
      fetch: () => Promise.resolve({ json: () => Promise.resolve(Object.assign({ success: true }, d)) }) });
    ctx.window = ctx;
    ['assets/campus-picker.js', 'coordinator/transport-checks.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx));
    const pick = fakeEl('div'), tab = { innerHTML: '' }, node = { innerHTML: '', hidden: false, querySelectorAll: () => [], querySelector: (s) => (s === '.tc-tab' ? tab : s === '.tc-tabs' ? { querySelector: () => null } : null), addEventListener() {} };
    const el = { innerHTML: '', querySelector: (s) => (s === '.tc-pick' ? pick : s === '.tc-body' || s === '.tc-map' ? node : null) };
    ctx.TransportChecks.mount(el, { idToken: 't', campusId: 'ALL', email: 'o' }, { owner: true });
    await new Promise((r) => setTimeout(r, 5));
    const tiles = () => tab.innerHTML.split('<div class="tile ').slice(1).map((x) => x.replace(/^[^>]*><b>/, '').replace(/<\/b>[^<]*<\/div>[\s\S]*$/, ''));
    assert.deepStrictEqual(tiles(), ['₹880', '2 of 3', '1 of 3', '1'], 'All: the combined network, 500 fuel + 380 driving');
    chip(pick, 'LMS1').click();
    assert.deepStrictEqual(tiles(), ['₹780', '1 of 2', '1 of 2', '1'], 'one school: plain figures, counts agree with its lists');
    assert.ok(!/lmcs-ov/.test(tiles().join('')) && /t1/.test(tab.innerHTML) && !/t3/.test(tab.innerHTML), 'lists follow the pick');
    chip(pick, 'LMS4').click();
    const t = tiles();
    assert.ok(t.every((x) => /lmcs-ov/.test(x) && (x.match(/lmcs-ov-item/g) || []).length === 2), 'two schools: one value per school for all four');
    assert.ok(t[0].includes('<b>₹780</b>') && t[0].includes('<b>₹100</b>') && !t[0].includes('880'), 'leakage per school, not summed');
    assert.ok(t[1].includes('<b>1 of 2</b>') && t[1].includes('<b>1 of 1</b>'), 'rates stay per school');
  });
  console.log('office pickers: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
