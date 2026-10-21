// ═══════════════════════════════════════════════════════════════════
// One-time setup for the LMCS Office Backend. Run officeSetup() once from the Apps Script editor
// (Run > officeSetup). The first run asks for permission; that is what lets the web app act as you.
// Safe to run again: anything already set up is kept, only what is missing is created.
//
// Creates, in the running account's Drive: the Office Config spreadsheet, one campus spreadsheet per
// campus for the current financial year, the Office files folder and the Backups folder; stores their
// ids in Script Properties (never in this public repo); installs the nightly backup trigger.
// ═══════════════════════════════════════════════════════════════════

// Same public values as payroll.gs (PAY_GOOGLE_CLIENT_ID / PAY_ALLOWLIST_SHEET_ID): the portal's sign-in
// client and the shared "LMCS Principal Allowlist" every portal signs in against.
var OFFICE_SETUP_DEFAULTS = {
  OFFICE_GOOGLE_CLIENT_ID: '697999989724-mvi85iobr20g4mm8a8nrjd1rms2o8tf6.apps.googleusercontent.com',
  OFFICE_ALLOWLIST_SHEET_ID: '1NZu0ElismFytG395Nxjz29vAz7OfkmJtZhs70bOwT58',
};

function officeSetup() {
  const props = PropertiesService.getScriptProperties();
  const has = function (k) { return !!props.getProperty(k); };
  const done = [];
  Object.keys(OFFICE_SETUP_DEFAULTS).forEach(function (k) {
    if (!has(k)) { props.setProperty(k, OFFICE_SETUP_DEFAULTS[k]); done.push(k); }
  });
  if (!has('OFFICE_ALERT_EMAIL')) { props.setProperty('OFFICE_ALERT_EMAIL', Session.getEffectiveUser().getEmail()); done.push('OFFICE_ALERT_EMAIL'); }
  if (!has('OFFICE_DRIVE_ROOT')) { props.setProperty('OFFICE_DRIVE_ROOT', DriveApp.createFolder('LMCS Office Files').getId()); done.push('OFFICE_DRIVE_ROOT'); }
  if (!has('OFFICE_BACKUP_FOLDER')) { props.setProperty('OFFICE_BACKUP_FOLDER', DriveApp.createFolder('LMCS Office Backups').getId()); done.push('OFFICE_BACKUP_FOLDER'); }
  if (!has('OFFICE_CONFIG_SS')) { props.setProperty('OFFICE_CONFIG_SS', SpreadsheetApp.create('LMCS Office Config').getId()); done.push('OFFICE_CONFIG_SS'); }
  officeConfigBook_(); // seeds Categories and Limits
  const fy = officeFy_(officeToday_());
  OFFICE_CAMPUSES.forEach(function (campus) {
    const key = officeBookKey_(campus, fy);
    if (has(key)) return;
    props.setProperty(key, SpreadsheetApp.create(campus + ' Office ' + fy).getId());
    officeOpen_(campus, fy); // creates every tab with its header
    done.push(key);
  });
  officeInstallTriggers();
  const msg = done.length ? 'Set up: ' + done.join(', ') : 'Already set up; nothing changed.';
  Logger.log(msg);
  return msg;
}
