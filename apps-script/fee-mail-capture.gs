// ═══════════════════════════════════════════════════════════════════
// Fee defaulter email capture -- a STANDALONE Apps Script project in Uday's own Google account (not the Coordinator
// project, so Gmail permission never touches the portal's backend).
//
// Reads the daily "La Montessori School <Campus> - Defaulters Followup Summary - dd/mm/yyyy" emails (one per campus
// per day, two Excel attachments each) and writes one row per email into a Sheet this script creates:
//   Date, Campus, Message id, Subject, Body (first 3000 chars), Attachments, then each attachment's first rows as text.
// v1 is a raw capture so we can see what the emails and Excel files actually contain; the fee tracker is built on
// the real layout afterwards. Read-only on Gmail: nothing is sent, labelled or deleted.
//
// SETUP: script.google.com > New project > paste this file > run backfill() once (grant Gmail read + Sheets access) ->
// open the Logs for the Sheet link, share it "anyone with the link can view" so the sample can be read, then run install()
// once to refresh it every morning.
// ponytail: .xlsx is unzipped and read as raw XML because Drive conversion is blocked in this Workspace; if the files
// turn out to be .xls or the XML parse fails, the Attachments column still lists names and sizes.
// ═══════════════════════════════════════════════════════════════════

const FEE_QUERY = 'subject:"Defaulters Followup Summary"';
const FEE_PREVIEW_ROWS = 40;

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
    ss.getSheets()[0].setName('Emails').appendRow(['Date', 'Campus', 'Message id', 'Subject', 'Body', 'Attachments', 'Attachment 1 preview', 'Attachment 2 preview']);
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
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, 8).setNumberFormat('@').setValues(rows);
    added += rows.length; rows = [];
  };
  GmailApp.search(FEE_QUERY + ' newer_than:' + days + 'd', 0, 200).forEach(function (th) {
    th.getMessages().forEach(function (m) {
      if (seen[m.getId()]) return;
      const subj = m.getSubject();
      const d = subj.match(/(\d{2})\/(\d{2})\/(\d{4})\s*$/);
      const campus = (subj.match(/La Montessori School\s+(.+?)\s+-\s+Defaulters/i) || [])[1] || '';
      const atts = m.getAttachments();
      const prev = atts.slice(0, 2).map(function (a) { try { return feeXlsxPreview_(a); } catch (e) { return 'could not read: ' + e.message; } });
      rows.push([d ? d[3] + '-' + d[2] + '-' + d[1] : '', campus, m.getId(), subj, m.getPlainBody().slice(0, 3000),
        atts.map(function (a) { return a.getName() + ' (' + a.getSize() + ' bytes)'; }).join('\n'), prev[0] || '', prev[1] || '']);
      if (rows.length >= 30) flush();
    });
  });
  flush();
  Logger.log(added ? 'added ' + added + ' emails (run again if it stopped early; saved ones are skipped)' : 'nothing new');
}

/** First FEE_PREVIEW_ROWS rows of the first sheet of an .xlsx attachment, cells joined by " | ". */
function feeXlsxPreview_(att) {
  const files = Utilities.unzip(att.copyBlob().setContentType('application/zip')), by = {};
  files.forEach(function (f) { by[f.getName()] = f; });
  const ns = XmlService.getNamespace('http://schemas.openxmlformats.org/spreadsheetml/2006/main');
  const strings = [];
  if (by['xl/sharedStrings.xml']) {
    XmlService.parse(by['xl/sharedStrings.xml'].getDataAsString()).getRootElement().getChildren('si', ns).forEach(function (si) {
      strings.push(si.getChildren('t', ns).concat([].concat.apply([], si.getChildren('r', ns).map(function (r) { return r.getChildren('t', ns); }))).map(function (t) { return t.getText(); }).join(''));
    });
  }
  const sheet = by['xl/worksheets/sheet1.xml'];
  if (!sheet) return 'no sheet1 (' + Object.keys(by).join(', ') + ')';
  const out = [];
  XmlService.parse(sheet.getDataAsString()).getRootElement().getChild('sheetData', ns).getChildren('row', ns).slice(0, FEE_PREVIEW_ROWS).forEach(function (row) {
    out.push(row.getChildren('c', ns).map(function (c) {
      const v = c.getChild('v', ns), t = v ? v.getText() : '';
      return c.getAttribute('t') && c.getAttribute('t').getValue() === 's' ? strings[+t] : t;
    }).join(' | '));
  });
  return out.join('\n');
}
