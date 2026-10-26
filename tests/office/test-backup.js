// Nightly backup (apps-script/office-backup.gs). Fake data only.
'use strict';
const assert = require('assert');
const { boot } = require('./harness');

// Fake Drive with named spreadsheet files and one backup folder (plus a bystander folder that must never be touched).
function backupDrive(h, existing) {
  const files = {}, trashed = [], copies = [];
  const mk = (id, name, folder) => (files[id] = { id, name, folder, getName: () => files[id].name, setTrashed: (v) => { if (v) trashed.push(id); },
    makeCopy: (nm, f) => { if (h.failIds && h.failIds.includes(id)) throw new Error('quota ' + id); copies.push({ name: nm, folder: f.id }); return mk('C' + copies.length, nm, f.id); } });
  const folder = (id) => ({ id, getFiles: () => { const m = Object.values(files).filter((f) => f.folder === id); let i = 0; return { hasNext: () => i < m.length, next: () => m[i++] }; } });
  mk('BOOK-A', 'LMS1 Office 2026-27'); mk('BOOK-CFG', 'Office Config');
  (existing || []).forEach((n, i) => mk('OLD' + i, n, 'BK'));
  mk('OTHER', 'LMS1 Office 2026-27 2020-01-01', 'ELSEWHERE');
  h.ctx.DriveApp = { getFolderById: (id) => { if (id === 'BK' || id === 'ELSEWHERE') return folder(id); throw new Error('No folder ' + id); }, getFileById: (id) => { if (!files[id]) throw new Error('No file ' + id); return files[id]; } };
  return { files, trashed, copies };
}

module.exports = function run(t) {
  const fresh = (existing) => {
    const h = boot(); h.ctx.console = { error() {} }; // keep expected failure logs out of the test output
    h.props.OFFICE_SS_LMS1_2026_27 = 'BOOK-A'; h.props.OFFICE_CONFIG_SS = 'BOOK-CFG'; h.props.OFFICE_BACKUP_FOLDER = 'BK'; h.props.OFFICE_ALERT_EMAIL = 'uday@example.org';
    h.setNow(new Date('2026-10-21T21:00:00Z')); // 02:30 IST on the 22nd
    h.addBookById('BOOK-A'); // a book with no Files tab has no videos to prune
    return { h, d: backupDrive(h, existing) };
  };
  const iso = (d) => d.toISOString().slice(0, 10);

  t.test('retention keeps 30 dailies and 12 first-of-month copies and returns the rest', () => {
    const h = boot(); const names = [];
    for (let i = 0; i < 400; i++) names.push('B ' + iso(new Date(Date.UTC(2026, 9, 21) - i * 864e5)));
    names.push('B notes', 'Other 2026-10-21'); // undated names ignored; a second book is judged on its own
    const del = h.ctx.officeBackupRetention_(names, new Date('2026-10-21T10:00:00Z'));
    const kept = names.filter((n) => !del.includes(n) && /^B \d/.test(n));
    const dailies = names.slice(0, 30);
    const firsts = [];
    for (let m = 0; m < 12; m++) firsts.push('B ' + iso(new Date(Date.UTC(2026, 9 - m, 1))));
    assert.deepEqual(kept.sort(), [...new Set([...dailies, ...firsts])].sort());
    assert.ok(!del.includes('B notes') && !del.includes('Other 2026-10-21'));
    assert.ok(del.includes('B 2025-10-01') && del.includes('B 2026-09-15'));
  });

  t.test('success copies every book, prunes only inside the backup folder, sends no email', () => {
    const { h, d } = fresh(['LMS1 Office 2026-27 2026-07-04'].concat(Array.from({ length: 30 }, (_, i) => 'LMS1 Office 2026-27 2026-09-' + String(30 - i).padStart(2, '0')).slice(0, 29)));
    h.ctx.officeBackupNightly();
    assert.deepEqual(d.copies.map((c) => c.name).sort(), ['LMS1 Office 2026-27 2026-10-22', 'Office Config 2026-10-22']);
    assert.ok(d.copies.every((c) => c.folder === 'BK'));
    assert.deepEqual(d.trashed, ['OLD0']); // 31st oldest daily, not a 1st of month; OTHER (elsewhere) untouched
    assert.equal(h.mail.sent.length, 0);
  });

  t.test('one book failing still backs up the others and sends one failure email', () => {
    const { h, d } = fresh();
    h.failIds = ['BOOK-A'];
    h.ctx.officeBackupNightly();
    assert.deepEqual(d.copies.map((c) => c.name), ['Office Config 2026-10-22']);
    assert.equal(h.mail.sent.length, 1);
    assert.equal(h.mail.sent[0].to, 'uday@example.org');
    assert.equal(h.mail.sent[0].subject, 'LMCS Office backup failed 2026-10-22');
    assert.ok(h.mail.sent[0].body.includes('OFFICE_SS_LMS1_2026_27') && h.mail.sent[0].body.includes('quota BOOK-A'));
  });

  t.test('missing backup folder property is a failure that sends the email, and nothing throws', () => {
    const { h, d } = fresh();
    delete h.props.OFFICE_BACKUP_FOLDER; h.mail.fail = false;
    h.ctx.officeBackupNightly();
    assert.equal(d.copies.length, 0);
    assert.equal(h.mail.sent.length, 1);
    assert.ok(h.mail.sent[0].body.includes('OFFICE_BACKUP_FOLDER'));
  });

  t.test('missing OFFICE_ALERT_EMAIL still alerts the effective user and names the property', () => {
    const { h } = fresh();
    delete h.props.OFFICE_ALERT_EMAIL; h.failIds = ['BOOK-A'];
    h.ctx.officeBackupNightly();
    assert.equal(h.mail.sent.length, 1);
    assert.equal(h.mail.sent[0].to, 'owner-fake@example.org');
    assert.ok(h.mail.sent[0].body.includes('OFFICE_ALERT_EMAIL'));
  });

  t.test('a throwing sendEmail is logged, failures are logged, nothing throws', () => {
    const { h } = fresh(); const logged = [];
    h.ctx.console = { error: (m) => logged.push(m) };
    h.failIds = ['BOOK-A']; h.mail.fail = true;
    h.ctx.officeBackupNightly();
    assert.equal(h.mail.sent.length, 0);
    assert.ok(logged.some((m) => m.includes('quota BOOK-A')));
    assert.ok(logged.some((m) => m.includes('mail down')));
  });

  t.test('zero configured books is a failure, emails, and does not prune', () => {
    const { h, d } = fresh(Array.from({ length: 31 }, (_, i) => 'X 2026-09-' + String(i % 30 + 1).padStart(2, '0') + (i > 29 ? '' : '')));
    delete h.props.OFFICE_SS_LMS1_2026_27; delete h.props.OFFICE_CONFIG_SS;
    h.ctx.officeBackupNightly();
    assert.equal(h.mail.sent.length, 1);
    assert.ok(h.mail.sent[0].body.includes('no books configured'));
    assert.deepEqual(d.trashed, []); assert.equal(d.copies.length, 0);
  });

  t.test('running twice on the same day leaves one copy per book', () => {
    const { h, d } = fresh();
    h.ctx.officeBackupNightly(); h.ctx.officeBackupNightly();
    assert.equal(d.copies.length, 2);
    assert.equal(h.mail.sent.length, 0);
  });

  // ── fuel fill videos: trashed 90 days after the later of the fill date and the upload, unless the fill's check is flagged and no clerk has answered ──
  const mp4 = (tag) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.from(tag)]).toString('base64');
  const withFiles = () => {
    const h = boot(); h.ctx.console = { error() {} };
    h.addBook('LMS1', '2026-27'); h.addBook('LMS2', '2026-27');
    // the transport workbook the Coordinator writes its Fuel Checks (id, flag) and Fuel Responses (id, answer) tabs to; the mirror's workbook
    const mirror = h.addBookById(h.run('OFFICE_FUEL_MIRROR_SS')), checks = mirror.insertSheet('Fuel Checks');
    checks.values.push(['id', 'campus', 'date', 'reg', 'flag']);
    const flag = (id, f) => checks.values.push([id, 'LMS1', '2026-06-20', 'HP1', f || 'yes']);
    const answer = (id) => { const sh = mirror.getSheetByName('Fuel Responses') || mirror.insertSheet('Fuel Responses'); if (!sh.values.length) sh.values.push(['id', 'answer', 'by', 'at']); sh.values.push([id, 'matches', 'k@x.org', '2026-10-01T00:00:00Z']); };
    const up = (day, id, o) => { h.setNow(new Date(day + 'T10:00:00Z')); const r = h.call('file.upload', Object.assign({ id, campus: 'LMS1', category: 'fuel_video', belongs_to: '', name: id + '.mp4', mime: 'video/mp4', base64: mp4(id) }, o), 'clerk1-token'); assert.equal(r.success, true, id + ' ' + r.error); };
    up('2026-07-01', 'old'); up('2026-07-01', 'oldbill', { category: 'bill', mime: 'application/pdf', base64: Buffer.from('%PDF-old').toString('base64') });
    up('2026-07-02', 'shared'); up('2026-10-01', 'shared2', { base64: mp4('shared') }); // same bytes again, recently: one Drive file, still wanted
    up('2026-09-20', 'new'); up('2026-07-01', 'sameDay');
    h.setNow(new Date('2026-10-21T21:00:00Z'));
    const fileOf = (id) => h.drive.files[h.ctx.officeRows_(h.ctx.officeOpen_('LMS1', '2026-27'), 'Files').find((r) => r.id === id).drive_id];
    return { h, fileOf, mirror, flag, answer, up };
  };

  t.test('fuel videos older than 90 days are trashed; bills, newer videos and a video still shared by a newer row are not', () => {
    const { h, fileOf } = withFiles();
    h.ctx.officeFuelVideoPrune_(new Date('2026-10-21T21:00:00Z'));
    assert.equal(!!fileOf('old').trashed, true); assert.equal(!!fileOf('sameDay').trashed, true);
    assert.equal(!!fileOf('oldbill').trashed, false, 'an old bill photo is never touched');
    assert.equal(!!fileOf('new').trashed, false); assert.equal(!!fileOf('shared').trashed, false, 'a newer row points at the same Drive file');
    h.ctx.officeFuelVideoPrune_(new Date('2026-10-21T21:00:00Z')); // a second run changes nothing
    assert.equal(Object.values(h.drive.files).filter((f) => f.trashed).length, 2);
  });

  t.test('the 90 days count from the upload: day 89 stays, day 91 goes', () => {
    const { h, fileOf } = withFiles();
    h.ctx.officeFuelVideoPrune_(new Date('2026-09-28T00:00:00Z')); // 89 days after 1 July
    assert.equal(!!fileOf('old').trashed, false);
    h.ctx.officeFuelVideoPrune_(new Date('2026-09-30T00:00:00Z')); // 91 days
    assert.equal(!!fileOf('old').trashed, true);
  });

  // A fill with its video, saved on `day` (the video uploaded the same day unless `uploaded` says otherwise).
  const fillWithVideo = (w, entry, day, o) => {
    const ss = w.h.ctx.officeOpen_('LMS1', '2026-27'), vid = 'v-' + entry;
    w.up((o && o.uploaded) || day, vid);
    w.h.ctx.officeWriteRow_(ss, 'DayBook', { id: entry, campus: 'LMS1', entry_date: day, category: 'fuel', video_file_id: vid });
    return vid;
  };
  const NOW = new Date('2026-10-21T21:00:00Z');

  t.test('a flagged fill whose check no clerk has answered keeps its video (day 120); once answered it goes after 90 days', () => {
    const w = withFiles(), vid = fillWithVideo(w, 'E1', '2026-06-20'); // 123 days before NOW
    w.flag('E1');
    w.h.ctx.officeFuelVideoPrune_(NOW);
    assert.equal(!!w.fileOf(vid).trashed, false, 'the evidence of an open check stays');
    w.answer('E1');
    w.h.ctx.officeFuelVideoPrune_(NOW);
    assert.equal(!!w.fileOf(vid).trashed, true, 'answered: 90 days from the fill');
  });

  t.test('an unflagged fill and a fill with no check row go 90 days after the fill; a flag on another fill changes nothing', () => {
    const w = withFiles(), a = fillWithVideo(w, 'E1', '2026-06-20'), b = fillWithVideo(w, 'E2', '2026-06-20'), c = fillWithVideo(w, 'E3', '2026-06-20');
    w.flag('E1', 'no'); w.flag('E3'); // E2 has no check at all
    w.h.ctx.officeFuelVideoPrune_(NOW);
    assert.deepEqual([a, b, c].map((v) => !!w.fileOf(v).trashed), [true, true, false]);
  });

  t.test('the 90 days run from the later of the fill date and the upload date, and a late-attached video counts from the attach', () => {
    const w = withFiles();
    const back = fillWithVideo(w, 'E4', '2026-08-01', { uploaded: '2026-07-01' }); // an entry dated after its upload
    const ss = w.h.ctx.officeOpen_('LMS1', '2026-27');
    w.up('2026-06-01', 'late'); // saved without a video, attached on 15 August
    w.h.ctx.officeWriteRow_(ss, 'DayBook', { id: 'E5', campus: 'LMS1', entry_date: '2026-06-01', category: 'fuel' });
    const drive = w.h.ctx.officeRows_(ss, 'Files').find((r) => r.id === 'late').drive_id;
    w.h.ctx.officeWriteRow_(ss, 'Files', { id: 'lk', campus: 'LMS1', drive_id: drive, name: 'late.mp4', category: 'fuel_video', belongs_to: 'E5', created_at: '2026-08-15T10:00:00.000Z' });
    w.h.ctx.officeFuelVideoPrune_(new Date('2026-10-20T00:00:00Z')); // 80 days after 1 Aug; 66 days after the attach; 141 days after the upload
    assert.equal(!!w.fileOf(back).trashed, false); assert.equal(!!w.fileOf('late').trashed, false, 'counted from the attach');
    w.h.ctx.officeFuelVideoPrune_(new Date('2026-10-31T00:00:00Z')); // 91 days after 1 Aug; 77 days after the attach
    assert.equal(!!w.fileOf(back).trashed, true); assert.equal(!!w.fileOf('late').trashed, false);
    w.h.ctx.officeFuelVideoPrune_(new Date('2026-11-14T00:00:00Z')); // 91 days after the attach
    assert.equal(!!w.fileOf('late').trashed, true);
  });

  t.test('fail safe: if the Fuel Checks tab is missing or the workbook unreadable, nothing is pruned and the run reports it', () => {
    const w = withFiles(), vid = fillWithVideo(w, 'E1', '2026-06-20');
    const book = w.h.books[w.h.run('OFFICE_FUEL_MIRROR_SS')], real = book.getSheetByName;
    book.getSheetByName = (n) => (n === 'Fuel Checks' ? null : real(n));
    assert.throws(() => w.h.ctx.officeFuelVideoPrune_(NOW), /Fuel Checks/);
    assert.equal(Object.values(w.h.drive.files).filter((f) => f.trashed).length, 0);
    book.getSheetByName = real;
    delete w.h.books[w.h.run('OFFICE_FUEL_MIRROR_SS')]; // the workbook cannot be opened at all
    assert.throws(() => w.h.ctx.officeFuelVideoPrune_(NOW));
    assert.equal(Object.values(w.h.drive.files).filter((f) => f.trashed).length, 0);
    w.h.setNow(NOW); w.h.props.OFFICE_ALERT_EMAIL = 'uday@example.org'; w.h.ctx.officeBackupNightly();
    assert.ok(w.h.mail.sent[0].body.includes('fuel_video: '), 'the nightly run mails it');
    assert.equal(!!w.fileOf(vid).trashed, false);
  });

  t.test('with nothing old enough to prune the checks tab is not needed', () => {
    const w = withFiles();
    delete w.h.books[w.h.run('OFFICE_FUEL_MIRROR_SS')];
    w.h.ctx.officeFuelVideoPrune_(new Date('2026-07-10T00:00:00Z'));
    assert.equal(Object.values(w.h.drive.files).filter((f) => f.trashed).length, 0);
  });

  t.test('the nightly run prunes videos even when the backup itself fails, and a Drive error is reported by name', () => {
    const { h, fileOf } = withFiles();
    h.props.OFFICE_ALERT_EMAIL = 'uday@example.org'; // no backup folder configured: the backup fails, the prune still runs
    h.ctx.officeBackupNightly();
    assert.equal(!!fileOf('old').trashed, true);
    assert.equal(h.mail.sent.length, 1); assert.ok(h.mail.sent[0].body.includes('OFFICE_BACKUP_FOLDER') && !h.mail.sent[0].body.includes('fuel_video'));
    const w2 = withFiles(); w2.h.props.OFFICE_ALERT_EMAIL = 'uday@example.org';
    const real = w2.h.drive.app.getFileById;
    w2.h.drive.app.getFileById = (id) => { if (id === w2.fileOf('old').id) throw new Error('Drive hiccup'); return real(id); };
    w2.h.ctx.officeBackupNightly();
    assert.equal(!!w2.fileOf('sameDay').trashed, true, 'one failing file does not stop the others');
    assert.ok(w2.h.mail.sent[0].body.includes('fuel_video: ') && w2.h.mail.sent[0].body.includes('Drive hiccup'));
  });

  t.test('officeInstallTriggers leaves one daily 02:00 backup trigger and keeps others', () => {
    const h = boot();
    h.triggers.push({ handler: 'officeBackupNightly' }, { handler: 'other' });
    h.ctx.officeInstallTriggers(); h.ctx.officeInstallTriggers();
    assert.deepEqual(h.triggers.map((x) => [x.handler, x.hour, x.days]), [['other', undefined, undefined], ['officeBackupNightly', 2, 1]]);
  });
};
