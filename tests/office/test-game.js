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

  t.test('game bridge: only listed game actions and the two game roles', () => {
    const h = fresh();
    assert.strictEqual(h.game('gameDayClose', {}).data.code, 'unknown_action');
    assert.strictEqual(h.game('gameToday', {}, { role: 'principal' }).data.code, 'unknown_action');
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

  t.test('game bridge: doPost routes game* bodies to it and never logs the key or email', () => {
    const h = fresh();
    const out = JSON.parse(h.ctx.doPost({ postData: { contents: JSON.stringify({ action: 'gameHandovers', key: KEY, role: 'fee_clerk', campus: 'LMS1', email: null, params: {} }) } }));
    assert.strictEqual(out.success, true);
    h.game('gameHandover', handover);
    const logs = (h.drive.logs || []).join('\n');
    assert.ok(!logs.includes(KEY) && !logs.includes('c1@example.org'));
  });
};
