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

  t.test('officeInstallTriggers leaves one daily 02:00 backup trigger and keeps others', () => {
    const h = boot();
    h.triggers.push({ handler: 'officeBackupNightly' }, { handler: 'other' });
    h.ctx.officeInstallTriggers(); h.ctx.officeInstallTriggers();
    assert.deepEqual(h.triggers.map((x) => [x.handler, x.hour, x.days]), [['other', undefined, undefined], ['officeBackupNightly', 2, 1]]);
  });
};
