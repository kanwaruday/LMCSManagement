// node tests/coordinator/test-campus-views.js -- the shared campus picker on the Coordinator views (academics, transport, Systems) and Approvals
const assert = require('assert'), vm = require('vm');
const { read, fakeEl, makeBody, makeCtx, tick, chip, pressed } = require('./campus-env');
const S = (campusId) => ({ idToken: 't', email: 'c@lms.test', campusId });

(async () => {
  // ── Academics ──
  {
    const t = (key, campus) => ({ key, name: 'Teacher ' + key, campus, matched: true, entries: 4, days: 3, lastDate: '2026-10-20', cw: {}, hw: {}, cwN: 0, hwN: 0, groups: {} });
    const data = { coordinatoracademics: { success: true, generated: '', ayStart: '2026-04-01', tags: { cw: ['Activity'], hw: [] }, teachers: [t('a1', 'LMS1'), t('a2', 'LMS2'), t('a3', 'LMS3'), t('a4', 'LMS2')] } };
    const { body, box, pickers } = makeBody('.ac-body');
    const ctx = makeCtx({ session: S('ALL'), data });
    ctx.Coord.academicsView(body);
    await tick(); await tick();
    const pick = pickers['.ac-pick'];
    assert.ok(!/<select class="ac-campus"/.test(box.innerHTML), 'no campus <select>');
    assert.ok(/4 teachers/.test(box.innerHTML) && ['a1', 'a2', 'a3', 'a4'].every((k) => box.innerHTML.includes('data-key="' + k + '"')), 'All: every teacher');
    chip(pick, 'LMS2').click();
    assert.ok(/2 teachers/.test(box.innerHTML) && box.innerHTML.includes('data-key="a2"') && box.innerHTML.includes('data-key="a4"') && !box.innerHTML.includes('data-key="a1"'), 'one school: its teachers, count agrees');
    chip(pick, 'LMS3').click();
    assert.ok(/3 teachers/.test(box.innerHTML) && !box.innerHTML.includes('data-key="a1"'), 'two schools');
    chip(pick, 'LMS2').click(); chip(pick, 'LMS3').click();
    assert.ok(/4 teachers/.test(box.innerHTML), 'clearing the last chip returns to All');
  }

  // ── Transport ──
  {
    const bus = (reg, n) => ({ reg, bus: reg, campus: 'LMS ' + n, campusId: 'LMS' + n, operational: true, route: 'R' + n, driver: 'D' + n, docs: { ins: { date: '2020-01-01', src: 'form', link: '', unread: [], other: [], noexp: [] } } });
    const pnl = (reg, n, fee) => ({ reg, campus: 'LMS ' + n, month: '2026-09', fee, fuel: 0, loan: 0, fixed: 0, pay: 0, note: '' });
    const data = { coordinatortransport: { success: true, syncedAt: '', warnings: [], unknown: [], docs: [{ key: 'ins', label: 'Insurance' }], fleet: [bus('HP01', 1), bus('HP02', 2), bus('HP03', 3)], people: [],
      pnl: [pnl('HP01', 1, 100000), pnl('HP02', 2, 200000), pnl('HP03', 3, 400000)] } };
    const run = async (tabs, session = S('ALL')) => {
      const { body, box, pickers } = makeBody('.tr-body');
      const ctx = makeCtx({ session, data });
      ctx.Coord.transportView(body, tabs ? { tabs } : {});
      await tick(); await tick();
      return { box, pick: pickers['.tr-pick'] };
    };
    let { box, pick } = await run();
    assert.ok(!/tr-campus/.test(box.innerHTML), 'no campus <select>');
    assert.ok(['HP01', 'HP02', 'HP03'].every((r) => box.innerHTML.includes(r)), 'All: every bus');
    chip(pick, 'LMS3').click();
    assert.ok(box.innerHTML.includes('HP03') && !box.innerHTML.includes('HP01') && !box.innerHTML.includes('HP02'), 'LMS3 only');
    assert.ok(/<b>1<\/b>vehicles tracked/.test(box.innerHTML), 'tile count agrees with the list');

    ({ box, pick } = await run(['pnl']));
    assert.ok(box.innerHTML.includes('7.00 lakh') && !box.innerHTML.includes('lmcs-ov'), 'All: one combined total');
    chip(pick, 'LMS1').click();
    assert.ok(box.innerHTML.includes('1.00 lakh') && !box.innerHTML.includes('lmcs-ov') && !box.innerHTML.includes('HP02'), 'one school: its total, no overlay');
    chip(pick, 'LMS2').click();
    const tiles = box.innerHTML.slice(box.innerHTML.indexOf('<div class="tiles">'), box.innerHTML.indexOf('</div></div>', box.innerHTML.indexOf('vehicles losing')));
    assert.ok((tiles.match(/lmcs-ov-item/g) || []).length >= 8, 'two schools: every tile gets one value per school');
    assert.ok(tiles.includes('1.00 lakh') && tiles.includes('2.00 lakh') && !tiles.includes('3.00 lakh') && !tiles.includes('7.00 lakh'), 'per-school values, not a sum');
    assert.ok(/LMS 1 <b>0 of 1<\/b>/.test(tiles) && /LMS 2 <b>0 of 1<\/b>/.test(tiles), 'losing-money tile is per school too');
    assert.ok(!box.innerHTML.includes('HP03'), 'unpicked school left out of the table');

    // a Fee Clerk with one school: the picker hides itself and the list is that school's
    ({ box, pick } = await run(null, S('LMS2')));
    assert.strictEqual(pick.hidden, true, 'single-school scope hides the picker');

    // opts.campus (Office header): no picker at all, only that school's rows, even for an ALL-scope session
    {
      const { body, box, pickers } = makeBody('.tr-body');
      const ctx = makeCtx({ session: S('ALL'), data });
      ctx.Coord.transportView(body, { tabs: ['matrix'], campus: 'LMS2' });
      await tick(); await tick();
      assert.ok(!('.tr-pick' in pickers), 'no picker mounted');
      assert.ok(box.innerHTML.includes('HP02') && !box.innerHTML.includes('HP01') && !box.innerHTML.includes('HP03'), 'only LMS2 rows');
      // P21: every vehicle row can take any paper, whatever its status; a paper waiting to be read is not offered twice
      assert.ok(/<select class="upany" data-upsel="HP02"[^>]*><option value="">Upload a paper…<\/option><option value="ins">Insurance<\/option><\/select><label class="upfile" hidden>Choose the file<input type="file" data-upfile="HP02"/.test(box.innerHTML), 'Upload a paper on the row, with its own file box');
    }
    {
      const pend = JSON.parse(JSON.stringify(data)); pend.coordinatortransport.fleet[1].docs.ins.pending = { at: new Date().toISOString(), by: 'c@x', link: '' };
      const { body, box } = makeBody('.tr-body');
      const ctx = makeCtx({ session: S('ALL'), data: pend });
      ctx.Coord.transportView(body, { tabs: ['matrix'], campus: 'LMS2' });
      await tick(); await tick();
      assert.ok(/data-upsel="HP02"[^>]*><option value="">Upload a paper…<\/option><\/select>/.test(box.innerHTML), 'a pending paper is left out of the picker');
    }
  }

  // ── Systems (pdrView) ──
  {
    const rep = (date, campus, regs) => ({ date, campus, message: 'msg ' + campus, done: '', tomorrow: '', registers: regs, maScore: '', maClass: '', principal: 'p@x', source: 'form', at: '', topics: [] });
    const iss = (id, campus) => ({ id, campus, type: 'Facilities', subject: 'Subject ' + id, first: '2026-10-10', last: new Date().toISOString().slice(0, 10), count: 2, needsAction: true, items: [{ date: '2026-10-20', text: 't' }] });
    const data = { coordinatorpdr: { success: true, tags: { '2026-10-20|LMS1': { topics: ['Fees'], action: true, summary: 's1' }, '2026-10-20|LMS3': { topics: ['Fees'], action: true, summary: 's3' } }, merges: {}, coordinators: [], actions: {}, pushedAt: '',
      reports: [rep('2026-10-20', 'LMS1', 'Fee Register'), rep('2026-10-20', 'LMS2', 'Fee Register'), rep('2026-10-20', 'LMS3', 'Cash Book')],
      history: [{ date: '2026-10-20', campus: 'LMS1' }, { date: '2026-10-20', campus: 'LMS2' }, { date: '2026-10-20', campus: 'LMS3' }],
      issues: [iss('i1', 'LMS1'), iss('i2', 'LMS2'), iss('i3', 'LMS3')],
      fees: { series: [['2026-10-18', 'LMS1', 1000, 2, 500000], ['2026-10-18', 'LMS2', 2000, 3, 600000], ['2026-10-18', 'LMS3', 3000, 4, 700000]] },
      admissions: [{ campus: 'LMS1', date: '2026-04-10', total: 11, registered: 1, tc: 0, byClass: {} }, { campus: 'LMS3', date: '2026-04-10', total: 33, registered: 1, tc: 0, byClass: {} }] } };
    const { body, box, pickers, openTab } = makeBody('.pd-body');
    const ctx = makeCtx({ session: S('ALL'), data });
    ctx.Coord.pdrView(body);
    await tick(); await tick();
    const pick = pickers['.pd-pick'];
    assert.ok(!/class="pd-campus"/.test(box.innerHTML), 'no campus <select> on Today');
    assert.ok(['i1', 'i2', 'i3'].every((i) => box.innerHTML.includes('data-id="' + i + '"')), 'All: every issue');
    chip(pick, 'LMS1').click(); chip(pick, 'LMS2').click();
    assert.ok(box.innerHTML.includes('data-id="i1"') && box.innerHTML.includes('data-id="i2"') && !box.innerHTML.includes('data-id="i3"'), 'issues of the picked schools');
    assert.ok(/<b>2<\/b>need action, not assigned/.test(box.innerHTML), 'tile agrees with the list');

    openTab('fees');
    assert.ok(box.innerHTML.includes('<b>LMS1</b>') && box.innerHTML.includes('<b>LMS2</b>') && !box.innerHTML.includes('<b>LMS3</b>'), 'fee table: picked schools only');
    openTab('admissions');
    assert.ok(box.innerHTML.includes('<b>LMS1</b>') && box.innerHTML.includes('<b>LMS2</b>') && !box.innerHTML.includes('<b>LMS3</b>'), 'admission table: picked schools only');
    openTab('registers');
    assert.ok(/<th>LMS1<\/th><th>LMS2<\/th><\/tr>/.test(box.innerHTML) && !box.innerHTML.includes('LMS3') && !box.innerHTML.includes('Cash Book'), 'register table: picked schools only');
    openTab('messages');
    assert.ok(!/class="pd-campus"/.test(box.innerHTML) && box.innerHTML.includes('msg LMS1') && !box.innerHTML.includes('msg LMS3'), 'messages follow the picker');

    // the tab you are on keeps its state; and the other tab's choice is picked up when you come back
    chip(pick, 'LMS1').click(); chip(pick, 'LMS2').click(); // back to All
    assert.deepStrictEqual(pressed(pick), ['ALL']);
    ctx.localStorage.setItem('lmcs-campus:c@lms.test', JSON.stringify({ v: 1, sel: ['LMS3'] })); // as if the Approvals tab's picker had chosen LMS3
    openTab('registers');
    assert.deepStrictEqual(pressed(pick), ['LMS3'], 'picker re-reads the shared choice when a tab is shown');
    assert.ok(box.innerHTML.includes('Cash Book') && !box.innerHTML.includes('Fee Register'), 'and the table follows it');
    openTab('approvals');
    assert.strictEqual(body.querySelector('.pd-pickwrap').hidden, true, 'the Approvals tab shows its own picker, not this one');
  }

  // ── Approvals list ──
  {
    const REQ = (id, c, st) => ({ id, campusId: c, title: 'T ' + id, category: 'Other', urgency: 'Normal', status: st || 'Pending', description: 'd', requestedBy: 'r@lms.org.in', requestedAt: '2026-10-20T10:00:00Z' });
    const data = { approvalslist: { success: true, canDecide: false, requests: [REQ('r1', 'LMS1'), REQ('r2', 'LMS2'), REQ('r3', 'LMS3'), REQ('r4', 'LMS3', 'Approved')] } };
    const slots = {};
    const slot = (k) => slots[k] || (slots[k] = k === 'pick' ? fakeEl('div') : { innerHTML: '' });
    const root = { contains: () => true, addEventListener() {}, set innerHTML(v) {}, set className(v) {}, querySelector: (sel) => { const m = sel.match(/^\[data-slot="(\w+)"\]$/); return m ? slot(m[1]) : null; } };
    const ctx = makeCtx({ session: S('ALL'), data });
    vm.runInContext(read('coordinator/approvals.js'), ctx);
    ctx.fetch = (url) => { const body = /approvalslist/.test(url) ? data.approvalslist : { success: true, staff: [] }; return Promise.resolve({ text: () => Promise.resolve(JSON.stringify(body)) }); };
    ctx.CoordApprovals.mount(root, {});
    await tick();
    const list = () => slots.list.innerHTML, bar = () => slots.bar.innerHTML;
    assert.ok(!/data-f="school"/.test(list()), 'no school <select> in the header');
    assert.ok(['r1', 'r2', 'r3'].every((i) => list().includes('T ' + i)) && /Loaded 4 requests/.test(bar()), 'All: every request');
    const pick = slots.pick;
    chip(pick, 'LMS3').click();
    assert.ok(list().includes('T r3') && !list().includes('T r1') && !list().includes('T r2'), 'LMS3 only (needs-action view)');
    assert.ok(/Loaded 2 requests · 1 need action/.test(bar()), 'status line counts what the list shows');
    chip(pick, 'LMS1').click();
    assert.ok(list().includes('T r1') && list().includes('T r3') && !list().includes('T r2'), 'two schools');
  }
  console.log('campus views: ok');
})().catch((e) => { console.error(e); process.exit(1); });
