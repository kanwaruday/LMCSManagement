// Private Drive upload and audited view (apps-script/office-files.gs).
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { boot } = require('./harness');

const fixture = {
  tokens: { 'clerk-token': 'clerk@example.org', 'other-token': 'other@example.org', 'owner-token': 'owner@example.org' },
  allowlist: [
    ['Email', 'Name', 'Campuses', 'Roles'],
    ['clerk@example.org', 'Clerk', 'LMS1', 'FeeClerk'],
    ['other@example.org', 'Other', 'LMS2', 'FeeClerk'],
    ['owner@example.org', 'Owner', 'ALL', 'Owner'],
  ],
};
const b64 = (s) => Buffer.from(s).toString('base64');

module.exports = function run(t) {
  const fresh = () => {
    const h = boot(fixture);
    h.addBook('LMS1', '2026-27'); h.addBook('LMS1', '2025-26'); h.addBook('LMS2', '2026-27');
    h.setNow(new Date('2026-10-21T10:00:00Z'));
    return h;
  };
  let n = 0;
  const up = (h, o, tok) => h.call('file.upload', Object.assign({ id: 'f' + (++n), campus: 'LMS1', category: 'deposit_proof', belongs_to: '', name: 'slip.pdf', mime: 'application/pdf', base64: b64('bytes-' + n) }, o), tok || 'clerk-token');
  const audit = (h, fy) => h.ctx.officeRows_(h.ctx.officeOpen_('LMS1', fy || '2026-27'), 'Audit');

  t.test('upload creates folder path and a Files row', () => {
    const h = fresh();
    const r = up(h, { id: 'u1', name: 'my slip (1).pdf', belongs_to: 'dep9' });
    assert.equal(r.success, true); assert.equal(r.id, 'u1'); assert.equal(r.duplicateOf, undefined);
    const row = h.ctx.officeRows_(h.ctx.officeOpen_('LMS1', '2026-27'), 'Files')[0];
    assert.equal(h.drive.pathOf(row.drive_id), 'LMS1/2026-27/deposit_proof');
    assert.equal(h.drive.files[row.drive_id].name, 'u1-my slip _1_.pdf');
    assert.equal(row.belongs_to, 'dep9'); assert.equal(row.size, Buffer.from(b64('bytes-1'), 'base64').length);
    assert.equal(row.fingerprint, require('crypto').createHash('sha256').update('bytes-1').digest('hex'));
    assert.equal(h.locks.acquired, 1);
  });

  t.test('same bytes twice returns duplicateOf and one Drive file', () => {
    const h = fresh();
    up(h, { id: 'a', base64: b64('same') });
    const r = up(h, { id: 'b', base64: b64('same') });
    assert.equal(r.duplicateOf, 'a'); assert.equal(r.id, 'b');
    assert.equal(Object.keys(h.drive.files).length, 1);
    const rows = h.ctx.officeRows_(h.ctx.officeOpen_('LMS1', '2026-27'), 'Files');
    assert.equal(rows.length, 2); assert.equal(rows[1].drive_id, rows[0].drive_id);
    assert.equal(up(h, { id: 'b', base64: b64('same') }).duplicate, true); // exact retry
    assert.equal(h.ctx.officeRows_(h.ctx.officeOpen_('LMS1', '2026-27'), 'Files').length, 2);
  });

  t.test('4 MB file rejected with TOO_LARGE; exactly 3 MB accepted', () => {
    const h = fresh();
    assert.equal(up(h, { base64: Buffer.alloc(4 * 1024 * 1024, 1).toString('base64') }).error, 'TOO_LARGE');
    assert.equal(up(h, { base64: Buffer.alloc(3 * 1024 * 1024, 2).toString('base64') }).success, true);
    assert.equal(Object.keys(h.drive.files).length, 1);
  });

  t.test('exe mime, bad category and bad base64 are rejected', () => {
    const h = fresh();
    assert.equal(up(h, { mime: 'application/x-msdownload', name: 'a.exe' }).error, 'BAD_MIME');
    assert.equal(up(h, { category: 'photo' }).error, 'BAD_CATEGORY');
    assert.equal(up(h, { base64: '%%%not base64' }).error, 'BAD_FILE');
    assert.equal(up(h, { base64: '' }).error, 'BAD_FILE');
    assert.equal(Object.keys(h.drive.files).length, 0);
  });

  t.test('upload to another campus is FORBIDDEN_CAMPUS', () => {
    const h = fresh();
    assert.equal(up(h, { campus: 'LMS2' }).error, 'FORBIDDEN_CAMPUS');
  });

  t.test('view by a clerk of another campus is FORBIDDEN_CAMPUS and audited', () => {
    const h = fresh();
    up(h, { id: 'v1' });
    const r = h.call('file.view', { id: 'v1', campus: 'LMS1' }, 'other-token');
    assert.equal(r.error, 'FORBIDDEN_CAMPUS'); assert.equal(r.base64, undefined);
    const a = h.ctx.officeRows_(h.ctx.officeOpen_('LMS2', '2026-27'), 'Audit').filter((x) => x.action === 'file.view');
    assert.equal(a.length, 1); assert.equal(a[0].who, 'other@example.org'); assert.equal(a[0].row_id, 'v1');
    assert.equal(JSON.parse(a[0].after).refused, 'FORBIDDEN_CAMPUS');
    assert.equal(audit(h).filter((x) => x.action === 'file.view').length, 0); // LMS1's own log untouched
  });

  t.test('refusal audit failure (caller has no book) leaves the response unchanged', () => {
    const h = boot(fixture); h.addBook('LMS1', '2026-27'); h.setNow(new Date('2026-10-21T10:00:00Z'));
    assert.equal(h.call('file.view', { id: 'x', campus: 'LMS1' }, 'other-token').error, 'FORBIDDEN_CAMPUS');
  });

  t.test('view by the right campus returns bytes and logs file.view', () => {
    const h = fresh();
    up(h, { id: 'v2', base64: b64('pdf-bytes'), name: 'slip.pdf' });
    const r = h.call('file.view', { id: 'v2', campus: 'LMS1' }, 'clerk-token');
    assert.equal(r.success, true); assert.equal(r.name, 'slip.pdf'); assert.equal(r.mime, 'application/pdf');
    assert.equal(Buffer.from(r.base64, 'base64').toString(), 'pdf-bytes');
    const a = audit(h).filter((x) => x.action === 'file.view');
    assert.equal(a.length, 1); assert.equal(a[0].who, 'clerk@example.org'); assert.equal(a[0].row_id, 'v2');
    assert.equal(h.call('file.view', { id: 'nope', campus: 'LMS1' }, 'clerk-token').error, 'NOT_FOUND');
    assert.equal(audit(h).filter((x) => x.action === 'file.view').length, 1);
  });

  t.test('view finds a file uploaded in the previous financial year', () => {
    const h = fresh();
    h.setNow(new Date('2026-03-20T10:00:00Z')); // FY 2025-26
    up(h, { id: 'old', base64: b64('last-year') });
    h.setNow(new Date('2026-04-02T10:00:00Z')); // FY 2026-27
    const r = h.call('file.view', { id: 'old', campus: 'LMS1' }, 'clerk-token');
    assert.equal(Buffer.from(r.base64, 'base64').toString(), 'last-year');
  });

  t.test('source has no setSharing call', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'apps-script', 'office-files.gs'), 'utf8');
    assert.equal(/setSharing|addViewer|addEditor|ANYONE/.test(src), false);
  });

  t.test('a full upload and view never makes a sharing call on the fake Drive', () => {
    const h = fresh();
    up(h, { id: 's1' }); h.call('file.view', { id: 's1', campus: 'LMS1' }, 'clerk-token');
    assert.equal(h.drive.calls.some((c) => /shar|Viewer|Editor/i.test(c)), false);
  });
};
