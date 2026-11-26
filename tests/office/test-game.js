// The game's bridge into the Office backend (apps-script/office-game.gs, lms-game W2). Synthetic data only.
'use strict';
const assert = require('assert');
const { boot } = require('./harness');

const fixture = {
  tokens: { 'owner-token': 'owner@example.org' },
  allowlist: [['Email', 'Name', 'Campuses', 'Roles'], ['owner@example.org', 'Owner', 'ALL', 'Owner']],
};
const KEY = 'k'.repeat(40);
const J = (x) => JSON.parse(JSON.stringify(x));
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(3000, 7)]);

module.exports = function run(t) {
  const fresh = () => {
    const h = boot(fixture);
    h.addConfig();
    ['LMS1', 'LMS2', 'HES'].forEach((c) => h.addBook(c, '2026-27'));
    ['LMS1', 'LMS2', 'HES'].forEach((c) => ['petty', 'fee', 'other'].forEach((b) => h.ctx.officeWriteRow_(h.ctx.officeOpen_(c, '2026-27'), 'Opening', { id: 'seed-' + b, campus: c, mode: 'cash', bucket: b, amount_paise: 1000000000 }))); // lane-d: cash never below zero
    h.setNow(new Date('2026-10-21T10:00:00Z'));
    h.props.OFFICE_GAME_KEY = KEY;
    h.props.OFFICE_WEBAPP_URL = 'https://script.google.com/macros/s/OFFICE/exec';
    h.game = (action, params, o) => J(h.ctx.officeGame_(Object.assign({ action, key: KEY, role: 'fee_clerk', campus: 'LMS1', email: 'c1@example.org', params: params || {} }, o)));
    return h;
  };
  const handover = { id: 'h1', date: '2026-10-21', from_account: 'cash:LMS1', to_account: 'cash:HES', amount_paise: '20000', bucket: 'fee', note: 'Fee cash for HES' };

  t.test('game bridge: a wrong, missing or unset key is refused before anything runs', () => {
    const h = fresh();
    assert.deepStrictEqual(h.game('gameToday', {}, { key: 'x' }), { success: false, error: 'not_authorized' });
    assert.deepStrictEqual(h.game('gameToday', {}, { key: undefined }), { success: false, error: 'not_authorized' });
    delete h.props.OFFICE_GAME_KEY;
    assert.deepStrictEqual(h.game('gameToday', {}), { success: false, error: 'not_authorized' });
  });

  t.test('game bridge: only listed game actions and the game roles; a Principal reaches only the cash approvals', () => {
    const h = fresh();
    assert.strictEqual(h.game('gameDayClose', {}).data.code, 'unknown_action');
    assert.strictEqual(h.game('gameToday', {}, { role: 'principal' }).data.code, 'unknown_action');
    assert.strictEqual(h.game('gameToday', {}, { role: 'driver' }).data.code, 'unknown_action');
    assert.notStrictEqual(h.game('gamePending', {}, { role: 'principal' }).data.code, 'unknown_action');
    assert.strictEqual(h.game('gameToday', {}, { campus: '' }).data.code, 'campus_needed');
  });

  t.test('game bridge: every entry runs an office action of the same read/write kind', () => {
    const h = fresh(), all = h.ctx.officeAllActions_(), map = h.run('OFFICE_GAME_ACTIONS');
    Object.entries(map).forEach(([name, s]) => {
      assert.match(name, /^game[A-Z]\w*$/);
      if (s.ticket) return;
      assert.ok(all[s.act], name + ' → ' + s.act + ' exists');
      if (s.act !== 'file.view') assert.strictEqual(!!s.write, !!all[s.act].write, name + ' write flag');
    });
  });

  t.test('game bridge: the Owner reads; any write by the Owner is refused (read-only here)', () => {
    const h = fresh();
    assert.strictEqual(h.game('gameHandovers', {}, { role: 'owner', email: null }).success, true);
    assert.strictEqual(h.game('gameHandover', handover, { role: 'owner' }).data.code, 'read_only');
    assert.strictEqual(h.game('gameFileTicket', { id: 'file-000001', category: 'bill', mime: 'image/jpeg' }, { role: 'owner' }).data.code, 'read_only');
  });

  t.test('game bridge: a Fee Clerk\'s handover runs the office\'s own action, audited as them', () => {
    const h = fresh();
    const r = h.game('gameHandover', handover);
    assert.strictEqual(r.success, true, JSON.stringify(r));
    assert.strictEqual(r.data.ok, undefined);
    const audit = h.ctx.officeRows_(h.ctx.officeOpen_('LMS1', '2026-27'), 'Audit').filter((a) => a.action === 'cash.handover');
    assert.ok(audit.length >= 1 && audit.every((a) => a.who === 'c1@example.org'));
    assert.ok(h.game('gameHandovers', {}).data.handovers.some((x) => x.id === 'h1'));
  });

  t.test('game bridge: the school is the proxy\'s, never a param; the office\'s own rules still refuse', () => {
    const h = fresh();
    // a campus param is ignored: the handover is still the LMS1 clerk's, so moving LMS2's cash is the office's own refusal
    const r = h.game('gameHandover', Object.assign({}, handover, { campus: 'LMS2', from_account: 'cash:LMS2' }));
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.data.ok, false);
    assert.match(r.data.code, /^[A-Z_]+$/);
    assert.strictEqual(h.ctx.officeRows_(h.ctx.officeOpen_('LMS2', '2026-27'), 'DayBook').length, 0);
  });

  t.test('game bridge: writes need the proxy\'s verified email; bad numbers and JSON are refused', () => {
    const h = fresh();
    assert.strictEqual(h.game('gameHandover', handover, { email: null }).data.code, 'who');
    assert.strictEqual(h.game('gameHandover', Object.assign({}, handover, { amount_paise: '12.5' })).data.code, 'BAD_INPUT');
    assert.strictEqual(h.game('gameReportSubmit', { id: 'r1', report_date: '2026-10-21', hourly: '[', cash: '{}', footfall: '1' }).data.code, 'BAD_INPUT');
  });

  t.test('game bridge: the daily report (with cash) goes in and reads back; a bad amount is the office\'s code', () => {
    const h = fresh();
    const p = { id: 'rep-1', report_date: '2026-10-21', hourly: JSON.stringify([{ text: '10:00 opened' }]), footfall: '12', feedback_pos: 'ok', feedback_neg: '', leave_status: '', external_docs: '',
      cash: JSON.stringify({ petty: 100, fee: 200, other: 0 }) };
    assert.strictEqual(h.game('gameReportSubmit', Object.assign({}, p, { cash: JSON.stringify({ petty: -1, fee: 0, other: 0 }) })).data.code, 'BAD_AMOUNT');
    const r = h.game('gameReportSubmit', p);
    assert.strictEqual(r.data.id, 'rep-1');
    const got = h.game('gameReportGet', { report_date: '2026-10-21' }, { role: 'owner', email: null });
    assert.strictEqual(got.data.report.footfall, 12);
    assert.strictEqual(got.data.report.created_by, 'c1@example.org');
  });

  t.test('photo ticket: minted for the clerk, uploaded in parts, then burnt; tampered, expired or reused tickets fail', () => {
    const h = fresh();
    const tk = h.game('gameFileTicket', { id: 'file-000001', category: 'bill', mime: 'image/jpeg', name: 'bill.jpg' });
    assert.strictEqual(tk.success, true);
    const u = new URL(tk.data.url);
    assert.strictEqual(u.origin + u.pathname, 'https://script.google.com/macros/s/OFFICE/exec');
    assert.strictEqual(u.searchParams.get('action'), 'gameUploadPart');
    const ticket = u.searchParams.get('ticket');
    assert.ok(!ticket.includes(KEY) && !ticket.includes('c1@example.org'.replace('@', '%40')));
    const b64 = JPEG.toString('base64'), half = Math.floor(JPEG.length / 2);
    const part = (n, of, data, tkt) => J(h.ctx.officeGame_({ action: 'gameUploadPart', ticket: tkt || ticket, part: n, of, base64: data }));
    assert.deepStrictEqual(part(1, 2, JPEG.subarray(0, half).toString('base64')), { success: true });
    assert.deepStrictEqual(part(1, 2, JPEG.subarray(0, half).toString('base64')), { success: true }); // a resent part replaces itself
    const last = part(2, 2, JPEG.subarray(half).toString('base64'));
    assert.deepStrictEqual(last, { success: true, fileId: 'file-000001' });
    const files = h.ctx.officeRows_(h.ctx.officeOpen_('LMS1', '2026-27'), 'Files');
    assert.strictEqual(files.length, 1);
    assert.strictEqual(files[0].created_by, 'c1@example.org');
    assert.strictEqual(Number(files[0].size), JPEG.length);
    assert.deepStrictEqual(part(1, 1, b64), { success: false, error: 'not_authorized' }, 'burnt');
    const tk2 = new URL(h.game('gameFileTicket', { id: 'file-000002', category: 'bill', mime: 'image/jpeg' }).data.url).searchParams.get('ticket');
    assert.deepStrictEqual(part(1, 1, b64, tk2.slice(0, -2) + 'xx'), { success: false, error: 'not_authorized' }, 'tampered');
    assert.deepStrictEqual(part(1, 0, b64, tk2), { success: false, error: 'BAD_PART' });
    h.setNow(new Date('2026-10-21T10:11:00Z'));
    assert.deepStrictEqual(part(1, 1, b64, tk2), { success: false, error: 'not_authorized' }, 'expired');
  });

  t.test('photo ticket: the office\'s own file rules still apply (a non-image is refused)', () => {
    const h = fresh();
    const tk = new URL(h.game('gameFileTicket', { id: 'file-000003', category: 'bill', mime: 'image/jpeg' }).data.url).searchParams.get('ticket');
    const r = J(h.ctx.officeGame_({ action: 'gameUploadPart', ticket: tk, part: 1, of: 1, base64: Buffer.from('not an image').toString('base64') }));
    assert.deepStrictEqual(r, { success: false, error: 'BAD_MIME' });
  });

  t.test('game bridge: attach a pump video to a saved fuel entry runs the office\'s own daybook.attach_video (replace is true/false only)', () => {
    const h = fresh();
    assert.strictEqual(h.game('gameDaybookAttachVideo', { id: 'vid-000001', entry_id: 'nope-0001', file_id: 'vid-000001', replace: 'maybe' }).data.code, 'BAD_INPUT');
    assert.strictEqual(h.game('gameDaybookAttachVideo', { id: 'vid-000001', entry_id: 'nope-0001', file_id: 'vid-000001', replace: 'false' }).data.code, 'NOT_FOUND');
    assert.strictEqual(h.game('gameDaybookAttachVideo', { id: 'vid-000001', entry_id: 'nope-0001', file_id: 'vid-000001' }, { role: 'owner' }).data.code, 'read_only');
  });

  t.test('game bridge: a service bill\'s parts arrive as a comma list and reach daybook.add as the array it checks', () => {
    const h = fresh();
    // no such vehicle in the fake config: the office refuses at the vehicle check, after the parts were parsed (no BAD_INPUT)
    const r = h.game('gameDaybookAdd', { id: 'dbk-000001', entry_date: '2026-10-21', direction: 'OUT', category: 'vehicle_service', account: 'cash:LMS1', bucket: 'petty',
      amount_paise: '1000', vehicle: 'HP00XX0000', components: 'engine_oil,oil_filter', file_id: 'file-000001' });
    assert.strictEqual(r.data.code, 'BAD_VEHICLE');
    const seen = [];
    h.run('var __d = officeDispatch_; officeDispatch_ = function (c, a, d) { __seen.push(d.components); return { success: true }; }');
    h.ctx.__seen = seen;
    h.game('gameDaybookAdd', { id: 'dbk-000002', components: 'engine_oil, oil_filter' });
    h.game('gameDaybookAdd', { id: 'dbk-000003', components: '' });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(seen)), [['engine_oil', 'oil_filter'], []]);
    h.run('officeDispatch_ = __d');
  });

  t.test('starting data: the Fee Clerk sees and fills their quests (cash, odometers) through the office\'s own start.* rules', () => {
    const h = fresh();
    const g = h.game('gameStartGet', {});
    assert.strictEqual(g.success, true, JSON.stringify(g));
    assert.deepStrictEqual(g.data.quests.map((q) => q.id), ['cash', 'odometer']);
    const saved = h.game('gameStartSave', { quest: 'cash', item: 'LMS1', fields: JSON.stringify({ amount: '1500.50', held_by: 'Desk box' }) });
    assert.strictEqual(saved.data.ok, undefined, JSON.stringify(saved));
    const cash = h.game('gameStartGet', {}).data.items.find((i) => i.quest === 'cash' && i.item === 'LMS1');
    assert.strictEqual(cash.fields.held_by.status, 'confirmed');
    assert.strictEqual(cash.fields.held_by.by, 'c1@example.org');
    // another school's cash is the office's own refusal; a bank quest isn't theirs
    assert.strictEqual(h.game('gameStartSave', { quest: 'cash', item: 'LMS2', fields: JSON.stringify({ amount: '1', held_by: 'x' }) }).data.code, 'FORBIDDEN_CAMPUS');
    assert.strictEqual(h.game('gameStartSave', { quest: 'bank', item: 'b1', fields: JSON.stringify({ bank: 'x' }) }).data.code, 'FORBIDDEN_ROLE');
    assert.strictEqual(h.game('gameStartSave', { quest: 'cash', item: 'LMS1', fields: '{', skip: 'false' }).data.code, 'BAD_INPUT');
    assert.strictEqual(h.game('gameStartSubmit', { quest: 'cash' }).data.ok, undefined);   // cash is complete for LMS1: submitted
    assert.strictEqual(h.game('gameStartSave', { quest: 'cash', item: 'LMS1', fields: JSON.stringify({ amount: '9' }) }).data.code, 'START_LOCKED');
    assert.strictEqual(h.game('gameStartSave', { quest: 'cash', item: 'LMS1', fields: '{}' }, { role: 'owner' }).data.code, 'read_only');
  });

  t.test('accounts set-up (lane-d): the Owner adds an account, its opening balance, vehicles and a collection head; a Fee Clerk cannot', () => {
    const h = fresh();
    const O = { role: 'owner', email: 'owner@example.org', campus: 'LMS2' };
    // a Fee Clerk is refused for all five, before the office runs
    for (const [a, p] of [['gameAccountAdd', { id: 'bank:LMS2:demo', kind: 'bank', label: 'Demo bank' }], ['gameAccountOpening', { id: 'op-000001', account: 'bank:LMS2:demo', amount_paise: '100' }],
      ['gameVehicleAdd', { reg: 'HP00AA0001', kind: 'bus' }], ['gameVehiclesImport', { vehicles: '[]' }], ['gameCollectionAdd', { head: 'trip', label: 'Trip' }]]) {
      assert.strictEqual(h.game(a, p, { campus: 'LMS2' }).data.code, 'read_only', a);
    }
    // the Owner: an account at the proxy's school, then its opening balance once
    assert.strictEqual(h.game('gameAccountAdd', { id: 'bank:LMS2:demo', kind: 'bank', label: 'Demo bank' }, O).data.id, 'bank:LMS2:demo');
    assert.strictEqual(h.game('gameAccountAdd', { id: 'bank:LMS2', kind: 'bank', label: 'x' }, O).data.code, 'BAD_ID', 'a default id stays reserved');
    assert.strictEqual(h.game('gameAccountOpening', { id: 'op-000001', account: 'bank:LMS2:demo', amount_paise: '250000' }, O).data.duplicate, false);
    assert.strictEqual(h.game('gameAccountOpening', { id: 'op-000002', account: 'bank:LMS2:demo', amount_paise: '1' }, O).data.code, 'ACCOUNT_OPENING_EXISTS');
    assert.strictEqual(h.game('gameAccountOpening', { id: 'op-000003', account: 'bank:LMS2:demo', amount_paise: 'x' }, O).data.code, 'BAD_INPUT');
    // vehicles: one, then an import whose rows can't name another school
    assert.strictEqual(h.game('gameVehicleAdd', { reg: 'hp 00 aa 0001', kind: 'bus', label: 'Bus 1' }, O).data.reg, 'HP00AA0001');
    const imp = h.game('gameVehiclesImport', { vehicles: JSON.stringify([{ reg: 'HP00AA0002', kind: 'van', campus: 'LMS1' }, { reg: 'HP00AA0001', kind: 'bus' }]) }, O);
    assert.strictEqual(imp.data.added, 1, 'the repeat is a duplicate');
    assert.strictEqual(h.game('gameVehiclesImport', { vehicles: '{"a":1}' }, O).data.code, 'BAD_INPUT');
    // a collection head (group-wide)
    assert.strictEqual(h.game('gameCollectionAdd', { head: 'trip_fee', label: 'Trip fee' }, O).data.id, 'trip_fee');
    const cfg = h.game('gameConfig', {}, { role: 'owner', email: null, campus: 'LMS2' }).data;
    assert.ok(cfg.accounts.some((x) => x.id === 'bank:LMS2:demo' && x.campus === 'LMS2'));
    assert.deepStrictEqual(cfg.vehicles.filter((v) => /^HP00AA/.test(v.reg)).map((v) => [v.reg, v.campus]).sort(), [['HP00AA0001', 'LMS2'], ['HP00AA0002', 'LMS2']]);
    assert.ok(cfg.collections.some((c) => c.id === 'trip_fee'));
    // still read-only for the Owner everywhere else
    assert.strictEqual(h.game('gameHandover', handover, { role: 'owner' }).data.code, 'read_only');
    // a write needs who (the verified email)
    assert.strictEqual(h.game('gameCollectionAdd', { head: 'x_fee', label: 'X' }, { role: 'owner', email: null, campus: 'LMS2' }).data.code, 'who');
  });

  t.test('game bridge: doPost routes game* bodies to it and never logs the key or email', () => {
    const h = fresh();
    const out = JSON.parse(h.ctx.doPost({ postData: { contents: JSON.stringify({ action: 'gameHandovers', key: KEY, role: 'fee_clerk', campus: 'LMS1', email: null, params: {} }) } }));
    assert.strictEqual(out.success, true);
    h.game('gameHandover', handover);
    const logs = (h.drive.logs || []).join('\n');
    assert.ok(!logs.includes(KEY) && !logs.includes('c1@example.org'));
  });

  t.test('lane-d go-live: the Owner\'s seal sets the Day Book\'s opening (cash per box + bank) through the bridge; a Fee Clerk can\'t; locked after the first entry', () => {
    const h = fresh();
    const O = { role: 'owner', email: 'owner@example.org', campus: 'LMS2' };
    const bal = [{ mode: 'cash', bucket: 'petty', amount_paise: 120000 }, { mode: 'cash', bucket: 'fee', amount_paise: 845000 }, { mode: 'cash', bucket: 'other', amount_paise: 0 }, { mode: 'bank', amount_paise: 2500000 }];
    assert.strictEqual(h.game('gameOpeningSet', { id: 'seal-LMS2', balances: JSON.stringify(bal) }, { campus: 'LMS2' }).data.code, 'read_only', 'a Fee Clerk');
    const r = h.game('gameOpeningSet', { id: 'seal-LMS2', balances: JSON.stringify(bal) }, O);
    assert.deepStrictEqual(J(r.data.opening.cash), { petty: 120000, fee: 845000, other: 0 });
    const b = h.call('daybook.balances', { campus: 'LMS2', date: '2026-10-21' }, 'owner-token');
    assert.deepStrictEqual([b.opening.cash.petty, b.opening.cash.fee, b.opening.bank], [120000, 845000, 2500000], 'the Day Book starts from the sealed count');
    assert.strictEqual(h.game('gameOpeningSet', { id: 'seal-LMS2', balances: JSON.stringify(bal) }, O).data.duplicate, true, 'a resend');
    assert.strictEqual(h.game('gameDaybookAdd', { id: 'f1', entry_date: '2026-10-21', account: 'cash:LMS2', direction: 'IN', bucket: 'fee', category: 'fee_collection', amount_paise: '1000' }, { campus: 'LMS2' }).data.duplicate, false);
    assert.strictEqual(h.game('gameOpeningSet', { id: 'seal-LMS2-b', balances: JSON.stringify(bal) }, O).data.code, 'OPENING_LOCKED', 'not after the first entry');
    assert.strictEqual(h.game('gameOpeningSet', { id: 'x', balances: '{bad' }, O).data.code, 'BAD_INPUT');
  });

  t.test('lane-d go-live (G2): seal A → unseal → re-seal B (a new id) while the book is empty: the Day Book opens at B; the same id again is a duplicate', () => {
    const h = fresh();
    const O = { role: 'owner', email: 'owner@example.org', campus: 'LMS2' };
    const A = [{ mode: 'cash', bucket: 'petty', amount_paise: 120000 }, { mode: 'cash', bucket: 'fee', amount_paise: 845000 }, { mode: 'cash', bucket: 'other', amount_paise: 0 }, { mode: 'bank', amount_paise: 2500000 }];
    const B = [{ mode: 'cash', bucket: 'petty', amount_paise: 100000 }, { mode: 'cash', bucket: 'fee', amount_paise: 865000 }, { mode: 'cash', bucket: 'other', amount_paise: 0 }, { mode: 'bank', amount_paise: 2500000 }];
    assert.strictEqual(h.game('gameOpeningSet', { id: 'open-LMS2-2026-11-25-aaaaaaaa', balances: JSON.stringify(A) }, O).data.duplicate, undefined);
    assert.strictEqual(h.game('gameOpeningSet', { id: 'open-LMS2-2026-11-25-bbbbbbbb', balances: JSON.stringify(B) }, O).data.duplicate, undefined);
    assert.strictEqual(h.game('gameOpeningSet', { id: 'open-LMS2-2026-11-25-bbbbbbbb', balances: JSON.stringify(B) }, O).data.duplicate, true);
    const b = h.call('daybook.balances', { campus: 'LMS2', date: '2026-10-21' }, 'owner-token');
    assert.deepStrictEqual([b.opening.cash.petty, b.opening.cash.fee, b.opening.bank], [100000, 865000, 2500000], 'the latest split');
  });

  t.test('669 accounts verifier: the bridge lets it set the opening and read the Day Book, and nothing else (no entry, reversal, close or other set-up)', () => {
    const h = fresh();
    const V = { role: 'accounts_verifier', email: 'verifier@example.org', campus: 'LMS2' };
    const bal = [{ mode: 'cash', bucket: 'petty', amount_paise: 120000 }, { mode: 'cash', bucket: 'fee', amount_paise: 0 }, { mode: 'cash', bucket: 'other', amount_paise: 0 }, { mode: 'bank', amount_paise: 0 }];
    assert.deepStrictEqual(J(h.game('gameOpeningSet', { id: 'open-v-1', balances: JSON.stringify(bal) }, V).data.opening.cash), { petty: 120000, fee: 0, other: 0 });
    assert.ok(Array.isArray(h.game('gameDaybookList', { from: '2026-10-21', to: '2026-10-21' }, { ...V, email: null }).data.entries));
    assert.strictEqual(h.game('gameDaybookAdd', { id: 'x1', entry_date: '2026-10-21', account: 'cash:LMS2', direction: 'IN', bucket: 'fee', category: 'fee_collection', amount_paise: '100' }, V).data.code, 'unknown_action', 'no entry');
    assert.strictEqual(h.game('gameDaybookReverse', { id: 'r1', reverses: 'x', narration: 'nope' }, V).data.code, 'unknown_action', 'no reversal');
    assert.strictEqual(h.game('gameAccountAdd', { id: 'bank:LMS2:x', kind: 'bank', label: 'x' }, V).data.code, 'unknown_action', 'no other set-up');
    assert.strictEqual(h.game('gameDecide', { id: 'd1', entry_id: 'p1', approve: 'true' }, V).data.code, 'unknown_action', 'no approvals');
  });

  t.test('Tally set-up: the verifier and the Owner save answers the export reads (latest wins); unknown keys or choices refused; a Fee Clerk can\'t', () => {
    const h = fresh();
    const V = { role: 'accounts_verifier', email: 'verifier@example.org', campus: 'LMS2' }, O = { role: 'owner', email: 'owner@example.org', campus: 'LMS2' };
    assert.strictEqual(h.game('gameTallySet', { key: 'import_format', value: 'xml' }, V).data.saved, true);
    assert.strictEqual(h.game('gameTallySet', { key: 'import_format', value: 'excel' }, O).data.saved, true, 'the Owner too; latest wins');
    assert.strictEqual(h.game('gameTallySet', { key: 'head:stationery', value: 'Printing & Stationery' }, V).data.saved, true);
    assert.strictEqual(h.game('gameTallySet', { key: 'ledger:LMS2:petty', value: 'Petty Cash - Kelheli' }, V).data.saved, true);
    assert.strictEqual(h.game('gameTallySet', { key: 'head:not_a_head', value: 'x' }, V).data.code, 'BAD_FIELD', 'only real Day Book heads');
    assert.strictEqual(h.game('gameTallySet', { key: 'ledger:LMS9:petty', value: 'x' }, V).data.code, 'BAD_FIELD');
    assert.strictEqual(h.game('gameTallySet', { key: 'import_format', value: 'pdf' }, V).data.code, 'BAD_INPUT', 'not one of the choices');
    assert.strictEqual(h.game('gameTallySet', { key: 'head:stationery', value: ' ' }, V).data.code, 'BAD_INPUT', 'a ledger name is needed');
    assert.strictEqual(h.game('gameTallySet', { key: 'password', value: 'x' }, V).data.code, 'BAD_FIELD', 'only known keys');
    assert.strictEqual(h.game('gameTallySet', { key: 'import_format', value: 'xml' }, { campus: 'LMS2' }).data.code, 'read_only', 'a Fee Clerk');
    const a = h.game('gameTallyGet', {}, { ...V, email: null }).data.answers;
    assert.strictEqual(a.import_format.value, 'excel');
    assert.strictEqual(a['head:stationery'].value, 'Printing & Stationery'); assert.strictEqual(a['ledger:LMS2:petty'].value, 'Petty Cash - Kelheli');
    assert.ok(h.game('gameTallyGet', {}, { role: 'owner', email: null, campus: 'LMS2' }).data.answers.import_format, 'the Owner reads every answer');
    assert.strictEqual(h.game('gameTallyGet', {}, { campus: 'LMS2', email: null }).data.code, 'FORBIDDEN_ROLE', 'a Fee Clerk reads nothing');
    const tk = h.game('gameFileTicket', { id: 'tally-ledgers-01', category: 'document', mime: 'application/pdf', name: 'ledgers.pdf' }, V).data;
    assert.match(tk.url, /ticket=.+&action=gameUploadPart$/, 'the verifier gets an upload ticket for a Tally document');
    assert.strictEqual(h.game('gameFileTicket', { id: 'tally-bill-01', category: 'bill', mime: 'image/jpeg' }, V).data.code, 'BAD_CATEGORY', 'only document for the verifier');
  });

  t.test('sync export: Owner role only, read-only, paged, one tab; refuses bad tabs and a missing key', () => {
    const h = fresh();
    h.game('gameDaybookAdd', { id: 'e1', entry_date: '2026-10-21', direction: 'IN', account: 'cash:LMS1', bucket: 'fee', category: 'fee_collection', amount_paise: '50000', charged_to: 'LMS1' });
    const ex = (p, o) => h.game('gameSyncExport', Object.assign({ fy: '2026-27', tab: 'DayBook' }, p), Object.assign({ role: 'owner' }, o));
    const r = ex({});
    assert.strictEqual(r.data.total, 1); assert.strictEqual(r.data.rows[0].id, 'e1'); assert.strictEqual(r.data.rows.length, 1);
    assert.strictEqual(ex({ offset: '1' }).data.rows.length, 0);
    assert.strictEqual(ex({ tab: 'Config' }).data.code, 'BAD_INPUT');
    assert.strictEqual(ex({ fy: 'x' }).data.code, 'BAD_INPUT');
    assert.strictEqual(ex({ fy: '2020-21' }).data.no_book, true);
    assert.strictEqual(h.game('gameSyncExport', { fy: '2026-27', tab: 'DayBook' }, { role: 'fee_clerk' }).data.code, 'FORBIDDEN_ROLE');
    assert.deepStrictEqual(ex({}, { key: 'x' }), { success: false, error: 'not_authorized' });
  });
};
