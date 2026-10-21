// Nightly backup of the Office books (trigger code only: no web entry point, not an action).
//   OFFICE_BACKUP_FOLDER  Drive folder that receives the copies (Script Property)
//   OFFICE_ALERT_EMAIL    who is mailed when any book fails to back up (Script Property)
// Every OFFICE_SS_* book and OFFICE_CONFIG_SS is copied as '<book name> YYYY-MM-DD'.

// Time-trigger target. Never throws; at most one failure email per run.
function officeBackupNightly() {
  const failures = [];
  try {
    const props = PropertiesService.getScriptProperties();
    const folderId = props.getProperty('OFFICE_BACKUP_FOLDER');
    let folder = null;
    if (!folderId) failures.push({ key: 'OFFICE_BACKUP_FOLDER', error: 'Script Property is missing' });
    else {
      try { folder = DriveApp.getFolderById(folderId); } catch (err) { failures.push({ key: 'OFFICE_BACKUP_FOLDER', error: String(err && err.message || err) }); }
    }
    if (folder) {
      const today = officeToday_();
      officeBackupKeys_().forEach(function (key) {
        try {
          const file = DriveApp.getFileById(props.getProperty(key));
          file.makeCopy(file.getName() + ' ' + today, folder);
        } catch (err) { failures.push({ key: key, error: String(err && err.message || err) }); }
      });
      try { officeBackupPrune_(folder); } catch (err) { failures.push({ key: 'retention', error: String(err && err.message || err) }); }
    }
  } catch (err) { failures.push({ key: 'backup', error: String(err && err.message || err) }); }
  if (failures.length) {
    try {
      MailApp.sendEmail(PropertiesService.getScriptProperties().getProperty('OFFICE_ALERT_EMAIL'),
        'LMCS Office backup failed ' + officeToday_(),
        failures.map(function (f) { return f.key + ': ' + f.error; }).join('\n'));
    } catch (err) { /* nothing left to report to */ }
  }
}

// Script Property keys whose values are book ids to back up.
function officeBackupKeys_() {
  const all = PropertiesService.getScriptProperties().getProperties();
  return Object.keys(all).filter(function (k) { return /^OFFICE_SS_/.test(k) || k === 'OFFICE_CONFIG_SS'; });
}

// Trashes expired copies; looks only inside the backup folder.
function officeBackupPrune_(folder) {
  const files = [], it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  const doomed = {};
  officeBackupRetention_(files.map(function (f) { return f.getName(); }), officeNow_()).forEach(function (n) { doomed[n] = true; });
  files.forEach(function (f) { if (doomed[f.getName()]) f.setTrashed(true); });
}

// Names to delete: per original book keep the 30 most recent daily copies and the first-of-month
// copy of each of the last 12 months (counting now's month). Names without a trailing date are ignored.
function officeBackupRetention_(names, now) {
  const nowMonth = Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM');
  const ym = function (s) { return Number(s.slice(0, 4)) * 12 + Number(s.slice(5, 7)); };
  const oldestMonth = ym(nowMonth) - 11;
  const books = {};
  names.forEach(function (n) {
    const m = /^(.*) (\d{4}-\d{2}-\d{2})$/.exec(n);
    if (m) (books[m[1]] = books[m[1]] || []).push({ name: n, date: m[2] });
  });
  const del = [];
  Object.keys(books).forEach(function (b) {
    const list = books[b].sort(function (x, y) { return x.date < y.date ? 1 : x.date > y.date ? -1 : 0; });
    list.forEach(function (e, i) {
      const monthly = e.date.slice(8) === '01' && ym(e.date) >= oldestMonth;
      if (i >= 30 && !monthly) del.push(e.name);
    });
  });
  return del;
}

// Run once by Uday: one daily 02:00 trigger for officeBackupNightly (other triggers untouched).
function officeInstallTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'officeBackupNightly') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('officeBackupNightly').timeBased().everyDays(1).atHour(2).create();
}
