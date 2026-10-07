// ═══════════════════════════════════════════════════════════════════
// Fee defaulter email capture -- a STANDALONE Apps Script project in Uday's own Google account (not the Coordinator
// project, so Gmail permission never touches the portal's backend).
//
// Reads the daily "La Montessori School <Campus> - Defaulters Followup Summary - dd/mm/yyyy" emails (one per campus
// per day, two Excel attachments each) and writes one row per email into a Sheet this script creates:
//   Date, Campus, Message id, Subject, Body (first 3000 chars), Attachment names.
// The email body carries the daily totals (fees received, follow-ups, outstanding); the Excel attachments hold student names
// and are deliberately NOT read or copied. Read-only on Gmail: nothing is sent, labelled or deleted.
//
// SETUP: script.google.com > New project > paste this file > run backfill() once (grant Gmail read + Sheets access) ->
// open the Logs for the Sheet link, share it "anyone with the link can view" so the sample can be read, then run install()
// once to refresh it every morning.
// ═══════════════════════════════════════════════════════════════════

const FEE_QUERY = 'subject:"Defaulters Followup Summary"';

function backfill() { feeCapture_(120); install(); }   // first run: last 120 days, then schedules the 8am daily refresh
function daily() { feeCapture_(3); }        // trigger target: last 3 days, already-seen messages are skipped

function install() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('daily').timeBased().everyDays(1).atHour(8).create();
}

function feeSheet_() {
  const props = PropertiesService.getScriptProperties();
  let ss, id = props.getProperty('SHEET_ID');
  if (id) ss = SpreadsheetApp.openById(id);
  else {
    ss = SpreadsheetApp.create('LMCS Fee Defaulter Emails');
    props.setProperty('SHEET_ID', ss.getId());
    ss.getSheets()[0].setName('Emails').appendRow(['Date', 'Campus', 'Message id', 'Subject', 'Body', 'Attachments']);
  }
  Logger.log('Sheet: ' + ss.getUrl());
  return ss.getSheetByName('Emails');
}

function feeCapture_(days) {
  const sh = feeSheet_();
  const seen = {};
  if (sh.getLastRow() > 1) sh.getRange(2, 3, sh.getLastRow() - 1, 1).getValues().forEach(function (r) { seen[r[0]] = true; });
  let rows = [], added = 0;
  const flush = function () { // save as we go: a run is cut off after 6 minutes and would otherwise lose everything
    if (!rows.length) return;
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, 6).setNumberFormat('@').setValues(rows);
    added += rows.length; rows = [];
  };
  for (let start = 0, ths; (ths = GmailApp.search(FEE_QUERY + ' newer_than:' + days + 'd', start, 100)).length; start += 100) ths.forEach(function (th) { // paged: one search call returns at most a few hundred threads
    th.getMessages().forEach(function (m) {
      if (seen[m.getId()]) return;
      const subj = m.getSubject();
      const d = subj.match(/(\d{2})\/(\d{2})\/(\d{4})\s*$/);
      const campus = (subj.match(/La Montessori School\s+(.+?)\s+-\s+Defaulters/i) || [])[1] || '';
      const atts = m.getAttachments();
      rows.push([d ? d[3] + '-' + d[2] + '-' + d[1] : '', campus, m.getId(), subj, m.getPlainBody().slice(0, 3000),
        atts.map(function (a) { return a.getName() + ' (' + a.getSize() + ' bytes)'; }).join('\n')]);
      if (rows.length >= 30) flush();
    });
  });
  flush();
  Logger.log(added ? 'added ' + added + ' emails (run again if it stopped early; saved ones are skipped)' : 'nothing new');
}
