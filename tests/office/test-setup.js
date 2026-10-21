// One-time setup (apps-script/office-setup.gs). Fake data only.
'use strict';
const assert = require('assert');
const { boot } = require('./harness');

module.exports = function run(t) {
  // Fakes for what setup creates: settable properties, new spreadsheets, root-level folders.
  const fresh = () => {
    const h = boot();
    for (const k of Object.keys(h.props)) delete h.props[k];
    h.ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => (k in h.props ? h.props[k] : null), setProperty: (k, v) => { h.props[k] = v; }, getProperties: () => Object.assign({}, h.props) }) };
    const made = { sheets: [], folders: [] };
    const realOpen = h.ctx.SpreadsheetApp.openById;
    h.ctx.SpreadsheetApp.create = (name) => { const id = 'NEW-' + made.sheets.length; made.sheets.push(name); h.addBookById(id); return { getId: () => id }; };
    h.ctx.SpreadsheetApp.openById = realOpen;
    h.ctx.DriveApp.createFolder = (name) => { made.folders.push(name); return { getId: () => 'FOLDER-' + made.folders.length }; };
    h.ctx.Logger = { log() {} };
    h.setNow(new Date('2026-10-21T06:00:00Z'));
    return { h, made };
  };

  t.test('setup creates config, one book per campus, both folders, properties and the backup trigger', () => {
    const { h, made } = fresh();
    h.ctx.officeSetup();
    assert.deepEqual(made.folders, ['LMCS Office Files', 'LMCS Office Backups']);
    assert.deepEqual(made.sheets, ['LMCS Office Config', 'LMS1 Office 2026-27', 'LMS2 Office 2026-27', 'LMS3 Office 2026-27', 'LMS4 Office 2026-27', 'LMS5 Office 2026-27', 'LMS6 Office 2026-27', 'HES Office 2026-27']);
    for (const k of ['OFFICE_GOOGLE_CLIENT_ID', 'OFFICE_ALLOWLIST_SHEET_ID', 'OFFICE_ALERT_EMAIL', 'OFFICE_DRIVE_ROOT', 'OFFICE_BACKUP_FOLDER', 'OFFICE_CONFIG_SS', 'OFFICE_SS_LMS1_2026-27', 'OFFICE_SS_HES_2026-27']) assert.ok(h.props[k], k);
    assert.equal(h.props.OFFICE_ALERT_EMAIL, 'owner-fake@example.org');
    assert.ok(h.books[h.props['OFFICE_SS_LMS1_2026-27']].getSheetByName('DayBook'), 'campus book has its tabs');
    assert.ok(h.books[h.props.OFFICE_CONFIG_SS].getSheetByName('Categories'), 'config seeded');
    assert.deepEqual(h.triggers.map((x) => [x.handler, x.hour]), [['officeBackupNightly', 2]]);
  });

  t.test('running setup twice creates nothing new and keeps one trigger', () => {
    const { h, made } = fresh();
    h.ctx.officeSetup();
    const before = { sheets: made.sheets.length, folders: made.folders.length, props: JSON.stringify(h.props) };
    assert.match(h.ctx.officeSetup(), /nothing changed/);
    assert.deepEqual({ sheets: made.sheets.length, folders: made.folders.length, props: JSON.stringify(h.props) }, before);
    assert.equal(h.triggers.length, 1);
  });
};
