// Pure helpers of the Day Book and Daily Report screens. Standalone: node tests/office/test-daybook-view.js (no-op under run.js).
'use strict';
const assert = require('assert');
if (require.main !== module) { module.exports = () => {}; return; }
(async () => {
  const t_ok = (name, fn) => { fn(); console.log('  ok  - ' + name); };
  const { collectionOptions, PAYMENT_PHOTO_HINT, mergeQueued, canReverse, formAccounts, categoriesFor, entryPayload, vehicleOptions, rowAccountLabel, keepChoice, inflightGuard, fyEnd, todayIst, loadConfig, componentOptions, COMPONENT_LABEL, VIDEO_LABEL, VIDEO_HINT, VIDEO_MAX_BYTES, videoProblem, canAddVideo } = await import('../../office/js/daybook.js');
  const { reportDraftToPayload, mismatchLines, reportQueueState } = await import('../../office/js/report.js');
  const { createOutbox } = await import('../../office/js/outbox.js');
  const row = (id, extra = {}) => ({ id, entry_date: '2026-10-21', direction: 'IN', mode: 'cash', bucket: 'fee', category: 'fee_collection', amount_paise: 500, reverses: '', ...extra });
  const q = (id, status, data, action = 'daybook.add') => ({ id, seq: 1, action, status, code: null, error: status === 'attention' ? 'DAY_CLOSED' : null, data });

  // mergeQueued
  const rows = [row('a'), row('b'), row('rev-b', { direction: 'OUT', reverses: 'b', entry_date: '2026-10-22' }), row('other', { entry_date: '2026-10-20' })];
  let m = mergeQueued(rows, [q('n1', 'waiting', { entry_date: '2026-10-21', amount_paise: 7 }), q('n2', 'attention', { entry_date: '2026-10-21' }), q('n3', 'waiting', { entry_date: '2026-10-20' }), q('r1', 'waiting', { reverses: 'a' }, 'daybook.reverse')], '2026-10-21');
  assert.deepStrictEqual(m.map((x) => x.id), ['a', 'b', 'n1', 'n2']); // only that date, synced first, queued after in order
  assert.deepStrictEqual(m.map((x) => x.synced), [true, true, false, false]);
  assert.ok(m[3].error.startsWith('That day is closed'));
  assert.strictEqual(m[1].reversed, true); // reversal row dated later still marks the original
  assert.strictEqual(m[0].reversalQueued, true);
  assert.deepStrictEqual(m.map(canReverse), [false, false, false, false]);
  assert.strictEqual(canReverse(mergeQueued([row('z')], [], '2026-10-21')[0]), true);
  assert.strictEqual(canReverse({ ...row('r'), synced: true, reverses: 'x' }), false);
  // R37: deposit legs never get a Reverse button, and legs never get Reverse
  assert.strictEqual(canReverse(mergeQueued([row('dep1:out', { category: 'deposit_cash_out' })], [], '2026-10-21')[0]), false);
  assert.strictEqual(canReverse(mergeQueued([row('dep1:in', { mode: 'bank', bucket: '', category: 'deposit_bank_in' })], [], '2026-10-21')[0]), false);
  // a queued entry that the server already has (flushed between reads) is not shown twice
  assert.strictEqual(mergeQueued([row('n1')], [q('n1', 'waiting', { entry_date: '2026-10-21' })], '2026-10-21').length, 1);
  // loadConfig: fetched every visit, saved to the cache; offline or refused keeps the cache (null)
  let saved = null, nCalls = 0;
  const conf = { success: true, categories: [1], accounts: [2], vehicles: [3], campuses: ['LMS1'], collections: [4] };
  assert.deepStrictEqual(await loadConfig({ read: async () => { nCalls++; return conf; } }, (c) => { saved = c; }), { categories: [1], accounts: [2], vehicles: [3], campuses: ['LMS1'], collections: [4] });
  assert.deepStrictEqual(saved.vehicles, [3]); assert.strictEqual(nCalls, 1);
  saved = null;
  for (const r of [{ success: false }, { success: true, stale: true }]) assert.strictEqual(await loadConfig({ read: async () => r }, (c) => { saved = c; }), null);
  assert.strictEqual(await loadConfig({ read: async () => { throw new Error('offline'); } }, (c) => { saved = c; }), null);
  assert.strictEqual(saved, null);
  console.log('  ok  - loadConfig refreshes once and keeps the cache on failure');
  console.log('  ok  - mergeQueued marks unsynced, dates, reversals');

  // attach a fill video to a saved fuel entry from the list
  t_ok('Add fill video shows for a synced fuel entry without a video, until one is queued', () => {
    const fr = row('fz', { category: 'fuel', direction: 'OUT', vehicle: 'HP1', litres_ml: 40000 });
    const merged = (rows, entries) => mergeQueued(rows, entries, '2026-10-21');
    assert.strictEqual(canAddVideo(merged([fr], [])[0]), true);
    assert.strictEqual(canAddVideo(merged([{ ...fr, video_file_id: 'v1' }], [])[0]), false, 'already has one');
    assert.strictEqual(canAddVideo(merged([row('o')], [])[0]), false, 'not a fuel entry');
    assert.strictEqual(canAddVideo(merged([fr, { ...fr, id: 'fz-rev', direction: 'IN', reverses: 'fz' }], [])[0]), false, 'reversed');
    assert.strictEqual(canAddVideo(merged([fr, { ...fr, id: 'fz-rev', direction: 'IN', reverses: 'fz' }], [])[1]), false, 'a reversal row');
    const waiting = merged([fr], [q('a1', 'waiting', { entry_id: 'fz', file_id: 'f' }, 'daybook.attach_video')])[0];
    assert.strictEqual(waiting.videoQueued, true); assert.strictEqual(canAddVideo(waiting), false, 'one is on its way');
    assert.strictEqual(canAddVideo(merged([], [q('n9', 'waiting', { entry_date: '2026-10-21', category: 'fuel' })])[0]), false, 'not synced yet');
    assert.strictEqual(videoProblem({ size: 20 * 1024 * 1024, type: 'video/quicktime' }), '');
    assert.match(videoProblem({ size: 30 * 1024 * 1024, type: 'video/mp4' }), /larger than 25 MB/);
    assert.match(videoProblem({ size: 3, type: 'application/pdf' }), /Choose a video file/);
  });

  // v2 form helpers
  const CAT = (id, direction, group, nv = false, active = true) => ({ id, label: id, direction, group, needs_vehicle: nv, active });
  const cfgCats = [CAT('fee_collection', 'IN', 'fee'), CAT('fee_cheque', 'IN', 'fee', false, false), CAT('donation', 'IN', 'income'), CAT('stationery', 'OUT', 'school'),
    CAT('petty_expense', 'OUT', 'school', false, false), CAT('fuel', 'OUT', 'transport', true), CAT('tyres', 'OUT', 'transport', true), CAT('transport_income', 'IN', 'transport', true),
    CAT('deposit_cash_out', 'OUT', 'movement', false, false), CAT('credit_settlement', 'OUT', 'movement'), CAT('cash_transfer', 'OUT', 'movement')];
  const A = (id, kind, campus, active = true) => ({ id, label: id, kind, campus, active });
  const accts = [A('cash:LMS1', 'cash', 'LMS1'), A('bank:LMS1', 'bank', 'LMS1'), A('cash:LMS2', 'cash', 'LMS2'), A('pump1', 'credit', 'LMS1'), A('pump2', 'credit', 'LMS2'), A('old1', 'credit', 'LMS1', false)];
  const ids = (l) => l.map((x) => x.id);
  assert.deepStrictEqual(ids(formAccounts(accts, { role: 'FeeClerk' }, 'LMS1')), ['cash:LMS1', 'pump1']); // clerk: no bank, no other campus, no inactive
  assert.deepStrictEqual(ids(formAccounts(accts, { role: 'AdminManager,Principal' }, 'LMS1')), ['cash:LMS1', 'pump1']);
  assert.deepStrictEqual(ids(formAccounts(accts, { role: 'FinanceHead' }, 'LMS1')), ['cash:LMS1', 'bank:LMS1', 'pump1']);
  assert.deepStrictEqual(ids(formAccounts(accts, { role: 'Accounts' }, 'LMS2')), ['cash:LMS2', 'pump2']);
  assert.deepStrictEqual(ids(formAccounts(accts, { role: 'Owner' }, 'LMS1')), ['cash:LMS1', 'bank:LMS1', 'pump1']);
  assert.deepStrictEqual(ids(formAccounts(accts, { role: 'FeeClerk,FinanceHead' }, 'LMS1')), ['cash:LMS1', 'bank:LMS1', 'pump1'], 'P8: FinanceHead lifts the clerk limit');
  const flat = (g) => g.flatMap((x) => ids(x.items));
  const cashClerk = flat(categoriesFor(cfgCats, 'cash', { role: 'FeeClerk' }));
  assert.ok(cashClerk.includes('fee_collection') && cashClerk.includes('cash_transfer') && cashClerk.includes('fuel'), 'clerks may transfer cash (P10)');
  assert.ok(!cashClerk.includes('credit_settlement') && !cashClerk.includes('fee_cheque') && !cashClerk.includes('petty_expense') && !cashClerk.includes('deposit_cash_out'), 'never settlement or inactive');
  assert.deepStrictEqual(flat(categoriesFor(cfgCats, 'credit', { role: 'FeeClerk' })), ['fuel', 'tyres'], 'clerk credit bills: vehicle categories only');
  assert.deepStrictEqual(flat(categoriesFor(cfgCats, 'credit', { role: 'Owner' })), ['stationery', 'fuel', 'tyres'], 'credit: OUT school/transport only');
  const bankFH = flat(categoriesFor(cfgCats, 'bank', { role: 'FinanceHead' }));
  assert.ok(bankFH.includes('credit_settlement') && !bankFH.includes('cash_transfer'));
  assert.ok(!flat(categoriesFor(cfgCats, 'cash', { role: 'Owner' })).includes('credit_settlement'));
  assert.deepStrictEqual(categoriesFor(cfgCats, 'cash', { role: 'Owner' }).map((g) => g.group), ['fee', 'income', 'school', 'transport', 'movement']);
  const base = { campus: 'LMS1', date: '2026-10-21', account: A('cash:LMS1', 'cash', 'LMS1'), category: CAT('stationery', 'OUT', 'school'), bucket: 'petty', mode: 'bank', amount: '1,234.50', payee: ' Raju ', narration: '', charged_to: '', hasFile: true };
  let r = entryPayload(base);
  assert.ok(r.ok); assert.deepStrictEqual(r.data, { campus: 'LMS1', entry_date: '2026-10-21', direction: 'OUT', account: 'cash:LMS1', mode: 'cash', bucket: 'petty', category: 'stationery', amount_paise: 123450, payee: 'Raju', narration: '', charged_to: 'LMS1', file_id: '' });
  r = entryPayload({ ...base, account: A('bank:LMS1', 'bank', 'LMS1'), mode: 'upi', bucket: 'petty' }); assert.strictEqual(r.data.mode, 'upi'); assert.strictEqual(r.data.bucket, ''); // bank: client picks bank/upi
  assert.strictEqual(entryPayload({ ...base, account: A('pump1', 'credit', 'LMS1'), category: CAT('tyres', 'OUT', 'transport', true), components: ['puncture'], vehicle: 'HP01A1', supplier_bill_no: ' B7 ' }).data.mode, 'credit');
  assert.strictEqual(entryPayload({ ...base, account: A('pump1', 'credit', 'LMS1'), category: CAT('tyres', 'OUT', 'transport', true), components: ['puncture'], vehicle: 'HP01A1', supplier_bill_no: ' B7 ' }).data.supplier_bill_no, 'B7');
  assert.ok(entryPayload({ ...base, bucket: '' }).errors.bucket);
  assert.ok(entryPayload({ ...base, account: null }).errors.account);
  assert.ok(entryPayload({ ...base, category: null }).errors.category);
  assert.strictEqual(entryPayload({ ...base, charged_to: 'CHAIRMAN' }).data.charged_to, 'CHAIRMAN');
  for (const bad of ['0', '-5', '0.1+0.2', '', '1.234']) assert.ok(entryPayload({ ...base, amount: bad }).errors.amount, bad);
  // every payment needs the photo; money in does not; reversal never goes through here
  assert.strictEqual(entryPayload({ ...base, hasFile: false }).errors.file, PAYMENT_PHOTO_HINT);
  assert.ok(entryPayload({ ...base, category: CAT('donation', 'IN', 'income'), hasFile: false }).ok, 'IN needs no photo');
  assert.ok(entryPayload({ ...base, account: A('pump1', 'credit', 'LMS1'), category: CAT('tyres', 'OUT', 'transport', true), vehicle: 'V1', hasFile: false }).errors.file, 'credit bills too');
  assert.ok(entryPayload({ ...base, category: CAT('cash_transfer', 'OUT', 'movement'), hasFile: false }).errors.file, 'cash transfer too');
  // student collections: head required for both categories, never sent for others
  const scIn = { ...base, bucket: 'other', category: CAT('student_collection', 'IN', 'income'), hasFile: false };
  assert.ok(entryPayload(scIn).errors.collection);
  assert.strictEqual(entryPayload({ ...scIn, collection: 'mun' }).data.collection, 'mun');
  const scOut = { ...base, category: CAT('student_collection_paid', 'OUT', 'school'), collection: 'mun' };
  assert.strictEqual(entryPayload(scOut).data.collection, 'mun'); assert.ok(entryPayload({ ...scOut, collection: '' }).errors.collection);
  assert.ok(!('collection' in entryPayload({ ...base, collection: 'mun' }).data), 'other categories send no collection');
  assert.deepStrictEqual(collectionOptions([{ id: 'a', label: 'A', active: true }, { id: 'b', label: 'B', active: false }]), [{ value: 'a', label: 'A' }]);
  assert.deepStrictEqual(collectionOptions(undefined), []);
  // vehicle categories
  const tyres = { ...base, category: CAT('tyres', 'OUT', 'transport', true), components: ['tyre_fl'] };
  assert.ok(entryPayload(tyres).errors.vehicle); assert.strictEqual(entryPayload({ ...tyres, vehicle: 'FLEET' }).data.vehicle, 'FLEET');
  assert.ok(!('vehicle' in entryPayload(base).data), 'no vehicle key for other categories');
  // garage data: which parts a vehicle service bill was for
  assert.strictEqual(COMPONENT_LABEL, 'Which parts? (tap all that apply)');
  t_ok('chips show for vehicle_service and hide for fuel', () => {
    assert.ok(componentOptions('vehicle_service').length > 0);
    ['vehicle_washing', 'vehicle_parts', 'vehicle_electrical', 'vehicle_body', 'tyres'].forEach((c) => assert.ok(componentOptions(c).length > 0, c));
    ['fuel', 'vehicle_insurance', 'parking', 'stationery', 'transport_income', 'nope', undefined].forEach((c) => assert.deepStrictEqual(componentOptions(c), [], String(c)));
    assert.deepStrictEqual(componentOptions('tyres').map((o) => o.id), ['tyre_fl', 'tyre_fr', 'tyre_rl', 'tyre_rr', 'tyre_spare', 'puncture', 'other']);
    assert.ok(componentOptions('tyres').every((o) => o.id && o.label));
  });
  t_ok('the client list matches the server list for every category', () => {
    const { boot } = require('./harness'); const srv = boot();
    srv.ctx.OFFICE_CATEGORIES.forEach((c) => assert.deepStrictEqual(componentOptions(c.id), JSON.parse(JSON.stringify(srv.ctx.officeComponentsFor_(c.id))), c.id));
  });
  t_ok('a service category needs at least one part, and sends them in tap order', () => {
    assert.ok(entryPayload({ ...tyres, components: [] }).errors.components);
    assert.ok(entryPayload({ ...tyres, components: undefined }).errors.components);
    assert.deepStrictEqual(entryPayload({ ...tyres, vehicle: 'V1', components: ['tyre_fl', 'puncture'] }).data.components, ['tyre_fl', 'puncture']);
    assert.ok(!('components' in entryPayload({ ...base, components: ['tyre_fl'] }).data), 'other categories send none');
    const fuelCat = { ...tyres, category: CAT('fuel', 'OUT', 'transport', true), vehicle: 'HP01A1', litres: '12', odometer: '5', hasFile: true };
    assert.ok(!('components' in entryPayload(fuelCat).data), 'fuel sends none');
  });
  // fuel: litres edge cases, odometer, photo
  const fuel = { ...tyres, category: CAT('fuel', 'OUT', 'transport', true), vehicle: 'HP01A1', litres: '12.5', odometer: '45210', odometer_note: ' meter changed ', hasFile: true };
  r = entryPayload(fuel);
  assert.ok(r.ok, JSON.stringify(r.errors)); assert.strictEqual(r.data.litres_ml, 12500); assert.strictEqual(r.data.odometer_km, 45210); assert.strictEqual(r.data.odometer_note, 'meter changed'); assert.strictEqual(r.data.vehicle, 'HP01A1');
  // the driver's fill video: optional, mp4/mov/3gp, 25 MB
  t_ok('fuel video: optional, checked for type and size, copy as briefed', () => {
    assert.strictEqual(VIDEO_LABEL, 'Video of the fill (from the driver)');
    assert.strictEqual(VIDEO_HINT, 'Ask the driver for a 10–20 second video: meter at zero, nozzle in the tank, final reading.');
    assert.strictEqual(VIDEO_MAX_BYTES, 25 * 1024 * 1024);
    assert.ok(entryPayload(fuel).ok, 'no video is fine');
    for (const type of ['video/mp4', 'video/quicktime', 'video/3gpp']) assert.ok(entryPayload({ ...fuel, video: { size: 20 * 1024 * 1024, type } }).ok, type);
    assert.ok(entryPayload({ ...fuel, video: { size: 25 * 1024 * 1024, type: 'video/mp4' } }).ok, 'exactly 25 MB');
    assert.strictEqual(entryPayload({ ...fuel, video: { size: 25 * 1024 * 1024 + 1, type: 'video/mp4' } }).errors.video, 'This video is larger than 25 MB. Ask the driver for a shorter one (10–20 seconds).');
    assert.strictEqual(entryPayload({ ...fuel, video: { size: 5, type: 'image/jpeg' } }).errors.video, 'Choose a video file (MP4, MOV or 3GP).');
    assert.ok(!('video' in entryPayload({ ...fuel, video: { size: 5, type: 'video/mp4' } }).data), 'the file id is added by the caller once the video is queued');
    assert.ok(entryPayload({ ...tyres, vehicle: 'V1', video: { size: 5, type: 'image/jpeg' } }).ok, 'only a fuel entry looks at it');
  });
  assert.strictEqual(entryPayload({ ...fuel, litres: '0.001' }).data.litres_ml, 1);
  assert.strictEqual(entryPayload({ ...fuel, litres: '12' }).data.litres_ml, 12000);
  for (const bad of ['0', '0.000', '-1', '12.3456', '', 'abc', '1e3', '.5', '1,5']) assert.ok(entryPayload({ ...fuel, litres: bad }).errors.litres, 'litres ' + bad);
  for (const bad of ['', '-1', '12.5', 'abc', '9'.repeat(20)]) assert.ok(entryPayload({ ...fuel, odometer: bad }).errors.odometer, 'odometer ' + bad);
  assert.strictEqual(entryPayload({ ...fuel, odometer: '0' }).ok, true);
  assert.ok(entryPayload({ ...fuel, hasFile: false }).errors.file);
  assert.ok(entryPayload({ ...fuel, vehicle: 'FLEET' }).errors.vehicle, 'FLEET refused for fuel');
  assert.ok(!('litres_ml' in entryPayload({ ...tyres, vehicle: 'X1', litres: '5' }).data), 'litres only for fuel');
  // settlement
  const bank = A('bank:LMS1', 'bank', 'LMS1');
  const st = { ...base, account: bank, mode: 'bank', category: CAT('credit_settlement', 'OUT', 'movement'), settles_account: 'pump2', settles: ' bills 5-9 ' };
  r = entryPayload(st); assert.ok(r.ok); assert.strictEqual(r.data.settles_account, 'pump2'); assert.strictEqual(r.data.settles, 'bills 5-9');
  assert.ok(entryPayload({ ...st, settles_account: '' }).errors.settles_account);
  assert.ok(!('settles_account' in entryPayload(base).data));
  // vehicle options: campus first, then others, then FLEET (not for fuel); inactive hidden
  const veh = [{ reg: 'B2', label: 'Bus B2', campus: 'LMS2', active: true }, { reg: 'A1', label: 'Bus A1', campus: 'LMS1', active: true }, { reg: 'Z9', label: 'Old', campus: 'LMS1', active: false }, { reg: 'C3', label: 'Van C3', campus: 'LMS1', active: true }];
  assert.deepStrictEqual(vehicleOptions(veh, 'LMS1', 'tyres').map((o) => o.value), ['A1', 'C3', 'B2', 'FLEET']);
  assert.deepStrictEqual(vehicleOptions(veh, 'LMS1', 'fuel').map((o) => o.value), ['A1', 'C3', 'B2']);
  assert.strictEqual(vehicleOptions(veh, 'LMS1', 'tyres').pop().label, 'Shared / whole fleet');
  // list label of a row: stored account, else derived from mode; unknown id falls back to the id
  assert.strictEqual(rowAccountLabel(accts, { account: 'pump1', mode: 'credit', campus: 'LMS1' }), 'pump1');
  assert.strictEqual(rowAccountLabel(accts, { account: '', mode: 'cash', campus: 'LMS2' }), 'cash:LMS2');
  assert.strictEqual(rowAccountLabel(accts, { account: '', mode: 'upi', campus: 'LMS1' }), 'bank:LMS1');
  assert.strictEqual(rowAccountLabel(accts, { account: 'gone', mode: 'cash', campus: 'LMS1' }), 'gone');
  assert.strictEqual(keepChoice('HES', ['LMS1', 'HES', 'CHAIRMAN'], 'LMS1'), 'HES'); assert.strictEqual(keepChoice('CHAIRMAN', ['LMS1', 'CHAIRMAN'], 'LMS1'), 'CHAIRMAN');
  assert.strictEqual(keepChoice('', ['LMS1'], 'LMS1'), 'LMS1'); assert.strictEqual(keepChoice('gone', ['LMS1'], 'LMS1'), 'LMS1');
  console.log('  ok  - v2 form helpers: accounts, categories, payload (litres, odometer, settlement), vehicles');

  assert.strictEqual(fyEnd('2026-10-21'), '2027-03-31'); assert.strictEqual(fyEnd('2027-02-01'), '2027-03-31'); assert.strictEqual(fyEnd('2026-04-01'), '2027-03-31');
  assert.strictEqual(todayIst(new Date('2026-10-21T19:00:00Z')), '2026-10-22'); // 00:30 IST next day
  console.log('  ok  - fyEnd and IST date');

  // I8 / R41: a page left open past midnight IST moves the shown date on only if it still shows the auto date.
  const { rollForward, rolledNote } = await import('../../office/js/daybook.js');
  const at = (iso) => new Date(iso);
  assert.deepStrictEqual(rollForward('2026-10-21', '2026-10-21', at('2026-10-21T18:00:00Z')), { date: '2026-10-21', auto: '2026-10-21', max: '2026-10-21', rolled: false }); // 23:30 IST
  assert.deepStrictEqual(rollForward('2026-10-21', '2026-10-21', at('2026-10-21T19:00:00Z')), { date: '2026-10-22', auto: '2026-10-22', max: '2026-10-22', rolled: true }); // 00:30 IST
  assert.deepStrictEqual(rollForward('2026-10-19', '2026-10-21', at('2026-10-21T19:00:00Z')), { date: '2026-10-19', auto: '2026-10-22', max: '2026-10-22', rolled: false }, 'a date the user chose stays');
  assert.strictEqual(rollForward('2026-10-21', '2026-10-22', at('2026-10-21T19:00:00Z')).rolled, false, 'yesterday picked after a roll stays');
  assert.match(rolledNote('2026-10-22'), /22\/10\/2026/);
  console.log('  ok  - rollForward moves the auto date past midnight, leaves a chosen date');

  // reportDraftToPayload
  const rep = { campus: 'LMS1', report_date: '2026-10-21', hourly: ['9: opened', '  ', '10: calls'], footfall: '12', feedback_pos: ' good ', feedback_neg: '', leave_status: 'none', external_docs: '', cash: { petty: '', fee: '1,234.50', other: '0' } };
  let p = reportDraftToPayload(rep);
  assert.ok(p.ok);
  assert.deepStrictEqual(p.payload.cash, { petty: 0, fee: 123450, other: 0 });
  assert.deepStrictEqual(p.payload.hourly, [{ text: '9: opened' }, { text: '10: calls' }]);
  assert.strictEqual(p.payload.footfall, 12); assert.strictEqual(p.payload.feedback_pos, 'good');
  p = reportDraftToPayload({ ...rep, cash: { petty: '1.234', fee: '-1', other: '0' }, footfall: '1.5' });
  assert.ok(!p.ok); assert.ok(p.errors.cash_petty && p.errors.cash_fee && p.errors.footfall && !p.errors.cash_other);
  assert.deepStrictEqual(mismatchLines([{ bucket: 'fee', report_paise: 100000, daybook_paise: 50000 }]), ['Fee cash: report ₹1,000.00, day book ₹500.00']);
  console.log('  ok  - reportDraftToPayload converts rupees to paise and hourly rows; mismatch in plain words');

  // reportQueueState
  const sub = (id, status, date, seq = 1) => ({ id, seq, action: 'report.submit', status, error: status === 'attention' ? 'DAY_CLOSED' : null, data: { report_date: date } });
  assert.strictEqual(reportQueueState([sub('r1', 'waiting', '2026-10-21')], '2026-10-21', null, 'r1').state, 'waiting');
  assert.deepStrictEqual(reportQueueState([sub('r1', 'attention', '2026-10-21')], '2026-10-21', null, null), { state: 'attention', id: 'r1', error: (await import('../../office/js/codes.js')).CODES.DAY_CLOSED });
  assert.strictEqual(reportQueueState([sub('r1', 'waiting', '2026-10-20')], '2026-10-21', null, null).state, 'none'); // other date
  assert.strictEqual(reportQueueState([sub('r1', 'attention', '2026-10-21', 1), sub('r2', 'waiting', '2026-10-21', 2)], '2026-10-21').state, 'waiting'); // newest wins
  assert.strictEqual(reportQueueState([], '2026-10-21', { id: 'r1' }, 'r1').state, 'synced');
  assert.strictEqual(reportQueueState([], '2026-10-21', { id: 'someone-else' }, 'r1').state, 'missing'); // not queued, not on server: no endless Waiting
  assert.strictEqual(reportQueueState([], '2026-10-21', null, 'r1').state, 'missing');
  assert.strictEqual(reportQueueState([], '2026-10-21', { id: 'x' }, null).state, 'none');
  console.log('  ok  - reportQueueState: waiting, attention, synced, missing, none');

  // inflightGuard (double-tap on Reverse)
  const g = inflightGuard(); let calls = 0, release;
  const slow = () => new Promise((res) => { calls++; release = res; });
  const first = g('a', slow); const second = await g('a', slow);
  assert.strictEqual(second, false); assert.strictEqual(nCalls, 1);
  release(); assert.strictEqual(await first, true);
  assert.strictEqual(await g('a', async () => { calls++; }), true); assert.strictEqual(calls, 2); // free again after it resolves
  console.log('  ok  - inflightGuard ignores a second call while the first is pending');

  // outbox.entries lists waiting and attention entries for the screens
  const m2 = new Map(); const store = { put: async (e) => { m2.set(e.id, e); }, getAll: async () => [...m2.values()], delete: async (id) => { m2.delete(id); } };
  const ob = createOutbox({ store, api: { write: async () => ({ success: false, network: true }) }, newId: (() => { let n = 0; return () => 'e' + (++n); })() });
  await ob.enqueue('daybook.add', { entry_date: '2026-10-21' }); await ob.enqueue('report.submit', {});
  assert.deepStrictEqual((await ob.entries()).map((e) => e.id), ['e1', 'e2']);
  console.log('  ok  - outbox.entries');
})().catch((e) => { console.log('  FAIL -', e.message); process.exit(1); });
