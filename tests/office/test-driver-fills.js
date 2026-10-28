// A driver's confirmed fuel fill becomes the Day Book fuel entry (apps-script/office-driver-fills.gs): off by default (nothing at
// all is written), on: exactly one entry with the bill and video copied into the Office store, its id written back. Fake data only.
'use strict';
const assert = require('assert');
const { boot } = require('./harness');

const fixture = {
  tokens: { 'clerk-token': 'clerk@example.org', 'other-token': 'other@example.org' },
  allowlist: [['Email', 'Name', 'Campuses', 'Roles'], ['clerk@example.org', 'Clerk', 'LMS1', 'FeeClerk'], ['other@example.org', 'Other', 'LMS2', 'FeeClerk']],
};
const HEAD = ['Fill ID', 'Reg', 'Campus', 'Driver Link ID', 'Driver Name', 'Filled At', 'Litres', 'Amount', 'Odometer',
  'Bill File ID', 'Video File ID', 'Received', 'Status', 'Confirmed At', 'Confirmed By', 'Day Book Entry ID'];
const J = (x) => JSON.parse(JSON.stringify(x));

module.exports = function run(t) {
  const fresh = () => {
    const h = boot(fixture);
    h.addConfig(); h.addBook('LMS1', '2026-27'); h.addBook('LMS2', '2026-27');
    h.setNow(new Date('2026-10-28T10:00:00Z'));
    const cfg = h.ctx.officeConfigBook_();
    h.ctx.officeWriteRow_(cfg, 'Accounts', { id: 'pump1', label: 'Pump', kind: 'credit', campus: 'LMS1', active: 'true' });
    h.ctx.officeWriteRow_(cfg, 'Vehicles', { reg: 'HP665805', label: 'Bus 1', kind: 'bus', campus: 'LMS1', active: 'true' });
    const src = h.drive.root.createFolder('Capture');
    const bill = src.createFile({ getName: () => 'bill.jpg', getContentType: () => 'image/jpeg', getBytes: () => [-1, -40, -1, 1, 2, 3] });
    const video = src.createFile({ getName: () => 'video.mp4', getContentType: () => 'video/mp4', getBytes: () => [0, 0, 0, 24, 102, 116, 121, 112, 9] });
    const D = (iso) => h.run('new Date(' + JSON.stringify(iso || '2026-10-28T09:00:00Z') + ')'); // the backend's realm: instanceof Date holds
    const tw = h.addBookById(h.run('OFFICE_FUEL_MIRROR_SS')).insertSheet('Driver Fills');
    tw.values.push(HEAD.slice(),
      ['Fconfirm1', 'HP665805', 'LMS1', 'DL-1', 'Test Driver', D('2026-10-27T20:00:00Z'), 42.5, 4000, 52100, bill.getId(), video.getId(), D(), 'confirmed', D(), 'clerk@example.org', ''],
      ['Fpending1', 'HP665805', 'LMS1', 'DL-1', 'Test Driver', D('2026-10-27T20:00:00Z'), 10, 900, 52200, bill.getId(), video.getId(), D(), 'pending', '', '', '']);
    h.dfl = tw.values;
    return h;
  };
  const go = (h, o, tok) => h.call('driverfill.daybook', Object.assign({ campus: 'LMS1', fill_id: 'Fconfirm1', account: 'pump1' }, o), tok || 'clerk-token');
  const snap = (h) => JSON.stringify([Object.keys(h.books).map((id) => Object.values(h.books[id].tabs).map((s) => s.values)), Object.keys(h.drive.files)]);

  t.test('flag off (the default): refused with DRIVER_FILLS_OFF and nothing anywhere changes', () => {
    const h = fresh(), before = snap(h), writes = h.counter.write;
    const r = go(h, {});
    assert.equal(r.success, false); assert.equal(r.code, 'DRIVER_FILLS_OFF'); assert.ok(/31 Oct/.test(r.error));
    h.props.OFFICE_DRIVER_FILLS_TO_DAYBOOK = 'yes please'; // anything but 'on' is off
    assert.equal(go(h, {}).code, 'DRIVER_FILLS_OFF');
    assert.equal(snap(h), before); assert.equal(h.counter.write, writes);
  });

  t.test('flag on: exactly one fuel entry with the fill\'s figures, bill and video; the id goes back into Driver Fills', () => {
    const h = fresh(); h.props.OFFICE_DRIVER_FILLS_TO_DAYBOOK = 'on';
    const driveBefore = Object.keys(h.drive.files).length;
    assert.deepEqual(J(go(h, {})), { success: true, id: 'dfl-Fconfirm1', duplicate: false });
    const ss = h.ctx.officeOpen_('LMS1', '2026-27');
    const rows = h.ctx.officeRows_(ss, 'DayBook');
    assert.equal(rows.length, 1);
    const e = rows[0];
    assert.deepEqual([e.id, e.entry_date, e.direction, e.category, e.account, e.mode, e.vehicle, e.amount_paise, e.litres_ml, e.odometer_km, e.file_id, e.video_file_id, e.source],
      ['dfl-Fconfirm1', '2026-10-28', 'OUT', 'fuel', 'pump1', 'credit', 'HP665805', 400000, 42500, 52100, 'dfl-Fconfirm1-bill', 'dfl-Fconfirm1-video', 'live'], 'IST date of the fill');
    const files = h.ctx.officeRows_(ss, 'Files');
    assert.deepEqual(files.map((f) => [f.id, f.category, f.campus]), [['dfl-Fconfirm1-bill', 'bill', 'LMS1'], ['dfl-Fconfirm1-video', 'fuel_video', 'LMS1']]);
    assert.equal(Object.keys(h.drive.files).length, driveBefore + 2, 'one Office copy each');
    assert.equal(h.drive.pathOf(files[1].drive_id), 'LMS1/2026-27/fuel_video');
    assert.deepEqual(J(h.drive.files[files[0].drive_id].bytes), [-1, -40, -1, 1, 2, 3]);
    assert.equal(h.dfl[1][15], 'dfl-Fconfirm1');
    assert.equal(h.call('file.view', { campus: 'LMS1', id: 'dfl-Fconfirm1-video' }, 'clerk-token').mime, 'video/mp4', 'viewable like any upload');
    // a second confirm: nothing new
    assert.deepEqual(J(go(h, {})), { success: true, id: 'dfl-Fconfirm1', duplicate: true });
    h.dfl[1][15] = ''; // even with the write-back lost, the entry id is fixed: still one entry, no new copies
    assert.equal(go(h, {}).duplicate, true);
    assert.equal(h.ctx.officeRows_(ss, 'DayBook').length, 1); assert.equal(h.ctx.officeRows_(ss, 'Files').length, 2);
    assert.equal(Object.keys(h.drive.files).length, driveBefore + 2);
    assert.equal(h.dfl[1][15], 'dfl-Fconfirm1');
  });

  t.test('flag on: only a confirmed fill of the caller\'s campus; Day Book rules still apply', () => {
    const h = fresh(); h.props.OFFICE_DRIVER_FILLS_TO_DAYBOOK = 'on';
    assert.equal(go(h, { fill_id: 'Fpending1' }).code, 'NOT_CONFIRMED');
    assert.equal(go(h, { fill_id: 'Fnothere1' }).error, 'NOT_FOUND');
    assert.equal(go(h, { campus: 'LMS2' }, 'other-token').error, 'NOT_FOUND', 'another campus\'s fill');
    assert.equal(go(h, { campus: 'LMS2' }).error, 'FORBIDDEN_CAMPUS');
    assert.equal(go(h, { account: 'nope' }).error, 'BAD_ACCOUNT');
    assert.equal(go(h, { account: '' }).error, 'BAD_ACCOUNT', 'a blank account is never the campus bank');
    assert.equal(h.ctx.officeRows_(h.ctx.officeOpen_('LMS1', '2026-27'), 'DayBook').length, 0);
    assert.equal(h.dfl[1][15], '');
  });
};
