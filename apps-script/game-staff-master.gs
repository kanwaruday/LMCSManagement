// gameStaffMaster (lms-game's staff-master and staff-links imports, run on the Mac with --roster; Uday: code over clicking, no CSV downloads by hand). Server to server, the
// ROSTER_GAME_KEY (checked by af-video.gs's afvKeyOk_). READ-ONLY: it returns ONLY the allow-listed columns below of five tabs, so a bank, PAN, UAN or ESI number, a phone,
// a date of birth or an address is never read or returned (a header not on the list is never touched). Salary Master lives in the payroll workbook, whose id is the Script
// Property PAY_SHEET_ID if set, else the same id payroll.gs already holds in this public repo (payroll.gs is in the payroll project, so the value is copied here). The reply carries pay: ok | pay_sheet_not_accessible | no_salary_tab, so a null salary tab is never silent. Errors are codes, never row text.
var GSM = GSM || {};
GSM.EMP_TABS = {
  EmpMaster: ['EmployeeCode', 'Name', 'SchoolCode', 'DateOfJoining', 'ReportsTo'],
  EmpPersonal: ['EmployeeCode', 'AuthEmail'],
  EmpSalary: ['EmployeeCode', 'Designation', 'Department'],
  'Certificate Links': ['Employee Code', 'Document Type', 'Filename', 'Drive Link', 'Status']
};
GSM.PAY_SHEET_ID = '1sal-zeXPZazN2ASqF7CchfJo-tF9_-Q80zcZtXbNwY8'; // "LMCS Payroll": same as payroll.gs PAY_SHEET_ID
GSM.PAY_COLS = ['Employee Code', 'Full Basic', 'Effective From']; // plus HOD: true/false per row, from any header that is the word HOD (the amount is never sent)

// the presence rule for the HOD incentive: a value that is not blank, 0, no, false, - or nil (the amount itself is never sent)
function gsmPresent_(v) {
  var t = String(v == null ? '' : v).replace(/[\u20B9,\s]/g, '').toLowerCase();
  return !!t && !/^(0+(\.0+)?|no|n|false|-+|nil|na|n\/a)$/.test(t);
}
function gsmRead_(sheet, wanted, hodRe) {
  if (!sheet) return null;
  var rows = sheet.getDataRange().getDisplayValues();
  if (!rows.length) return [];
  var head = rows[0].map(function (h) { return String(h).trim(); });
  var idx = wanted.map(function (c) { return head.indexOf(c); });
  var hodIdx = [];
  if (hodRe) head.forEach(function (h, i) { if (hodRe.test(h) && wanted.indexOf(h) === -1) hodIdx.push(i); });
  var out = [];
  for (var r = 1; r < rows.length; r++) {
    var o = {}, any = false;
    for (var k = 0; k < wanted.length; k++) {
      if (idx[k] < 0) continue;
      var v = String(rows[r][idx[k]]).trim();
      o[wanted[k]] = v;
      if (v) any = true;
    }
    if (hodRe) o.HOD = hodIdx.some(function (i) { return gsmPresent_(rows[r][i]); }); // a boolean only: the incentive amount never leaves the sheet
    if (any) out.push(o);
  }
  return out;
}

function gameStaffMaster_(b) {
  if (!b || !afvKeyOk_(b.key)) return { success: false, error: 'not_authorized' };
  try {
    var tabs = {}, emp = openWorkbook_();
    Object.keys(GSM.EMP_TABS).forEach(function (t) { tabs[t] = gsmRead_(emp.getSheetByName(t), GSM.EMP_TABS[t], null); });
    var payId = PropertiesService.getScriptProperties().getProperty('PAY_SHEET_ID') || GSM.PAY_SHEET_ID;
    // no silent nulls: the reply says how the payroll workbook went, so a dry run tells "no access" from "no Salary Master tab" from "fine" (the staff tabs still come either way)
    var pay = 'ok', sm = null;
    try { sm = SpreadsheetApp.openById(payId).getSheetByName('Salary Master'); } catch (e) { pay = 'pay_sheet_not_accessible'; }
    if (pay === 'ok' && !sm) pay = 'no_salary_tab';
    tabs.SalaryMaster = pay === 'ok' ? gsmRead_(sm, GSM.PAY_COLS, /\bHOD\b/i) : null;
    return { success: true, pay: pay, tabs: tabs };
  } catch (err) {
    return { success: false, error: 'read_failed' };
  }
}
