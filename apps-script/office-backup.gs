// Nightly backup of the Office books (trigger code only: no web entry point, not an action).
//   OFFICE_BACKUP_FOLDER  Drive folder that receives the copies (Script Property)
//   OFFICE_ALERT_EMAIL    who is mailed when any book fails to back up (Script Property)
// Every OFFICE_SS_* book and OFFICE_CONFIG_SS is copied as '<book name> YYYY-MM-DD'.

// Time-trigger target. Never throws; at most one failure email per run.
function officeBackupNightly() {
  const failures = [], today = officeToday_();
  const msg = function (err) { return String(err && err.message || err); };
  try {
    const props = PropertiesService.getScriptProperties();
    const folderId = props.getProperty('OFFICE_BACKUP_FOLDER');
    let folder = null;
    if (!folderId) failures.push({ key: 'OFFICE_BACKUP_FOLDER', error: 'Script Property is missing' });
    else {
      try { folder = DriveApp.getFolderById(folderId); } catch (err) { failures.push({ key: 'OFFICE_BACKUP_FOLDER', error: msg(err) }); }
    }
    const keys = officeBackupKeys_();
    if (!keys.length) failures.push({ key: 'OFFICE_SS_*', error: 'no books configured' });
    if (folder && keys.length) {
      // A same-day re-run skips books already copied today (idempotent).
      const have = {}, it = folder.getFiles();
      while (it.hasNext()) have[it.next().getName()] = true;
      keys.forEach(function (key) {
        try {
          const file = DriveApp.getFileById(props.getProperty(key));
          const name = file.getName() + ' ' + today;
          if (!have[name]) file.makeCopy(name, folder);
        } catch (err) { failures.push({ key: key, error: msg(err) }); }
      });
      try { officeBackupPrune_(folder); } catch (err) { failures.push({ key: 'retention', error: msg(err) }); }
    }
    try { officeFuelVideoPrune_(officeNow_()); } catch (err) { failures.push({ key: 'fuel_video', error: msg(err) }); } // runs even if the backup above failed
    if (!props.getProperty('OFFICE_ALERT_EMAIL')) failures.push({ key: 'OFFICE_ALERT_EMAIL', error: 'Script Property is missing, alert sent to the script owner' });
  } catch (err) { failures.push({ key: 'backup', error: msg(err) }); }
  if (!failures.length) return;
  const body = failures.map(function (f) { return f.key + ': ' + f.error; }).join('\n');
  console.error('LMCS Office backup failed ' + today + '\n' + body);
  try {
    let to = PropertiesService.getScriptProperties().getProperty('OFFICE_ALERT_EMAIL');
    if (!to) to = Session.getEffectiveUser().getEmail();
    MailApp.sendEmail(to, 'LMCS Office backup failed ' + today, body);
  } catch (err) { console.error('LMCS Office backup alert email failed: ' + msg(err)); }
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

// Trashes the driver's fuel-fill videos 90 days after upload. The Coordinator's fill check closes within days, but its state
// lives in another project this one cannot see, so the rule is the age of the upload (Files.created_at), which bounds it.
// Only Files rows of category fuel_video are ever looked at, and a Drive file that any newer or non-video row still points
// at (same bytes uploaded again) is kept. A file that cannot be trashed does not stop the others; the run then throws once.
function officeFuelVideoPrune_(now) {
  const props = PropertiesService.getScriptProperties(), cutoff = new Date(now.getTime() - 90 * 86400000).toISOString(), rows = [];
  officeBackupKeys_().filter(function (k) { return /^OFFICE_SS_/.test(k); }).forEach(function (k) {
    try { officeRows_(SpreadsheetApp.openById(props.getProperty(k)), 'Files').forEach(function (r) { rows.push(r); }); }
    catch (err) { if (!/^NO_TAB/.test(String(err && err.message))) throw err; } // a book without a Files tab has no videos
  });
  const wanted = {}, done = {};
  rows.forEach(function (r) { if (r.category !== 'fuel_video' || !r.created_at || r.created_at >= cutoff) wanted[r.drive_id] = true; });
  const failed = [];
  rows.forEach(function (r) {
    if (r.category !== 'fuel_video' || r.created_at >= cutoff || wanted[r.drive_id] || done[r.drive_id]) return;
    done[r.drive_id] = true;
    try { const f = DriveApp.getFileById(r.drive_id); if (!f.isTrashed()) f.setTrashed(true); } catch (err) { failed.push(r.id + ': ' + String(err && err.message || err)); }
  });
  if (failed.length) throw new Error(failed.length + ' video(s) not trashed: ' + failed.join('; '));
}

// Run once by Uday: one daily 02:00 trigger for officeBackupNightly (other triggers untouched).
function officeInstallTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'officeBackupNightly') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('officeBackupNightly').timeBased().everyDays(1).atHour(2).create();
}
