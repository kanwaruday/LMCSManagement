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
// a header that names the HOD incentive: the word HOD on its own (HOD Incentive, HOD_Allowance, Hod-Inc) or HodIncentive; never "Method"
GSM.HOD_RE = /(^|[^a-z])hod([^a-z]|$)|hod_?(incentive|allowance|inc)/i;
// header NAMES only (never a cell): what a dry run prints when no HOD column is found, so the right column can be named
function gsmHeads_(sheet) {
  if (!sheet) return null;
  var r = sheet.getDataRange().getDisplayValues()[0] || [];
  return r.map(function (h) { return String(h).trim().slice(0, 60); }).filter(String);
}
// Adjustments tab: a one-off line whose Type names the HOD incentive counts as HOD (the Type label and the code only; no amount, no note)
function gsmAdj_(sheet) {
  if (!sheet) return { rows: null, types: null };
  var v = sheet.getDataRange().getDisplayValues();
  if (!v.length) return { rows: [], types: [] };
  var h = v[0].map(function (x) { return String(x).trim(); }), ci = h.indexOf('Employee Code'), ti = h.indexOf('Type');
  var rows = [], types = {};
  if (ci < 0 || ti < 0) return { rows: [], types: [] };
  for (var r = 1; r < v.length; r++) {
    var t = String(v[r][ti]).trim().slice(0, 40);
    if (t) types[t] = true;
    if (GSM.HOD_RE.test(t) && String(v[r][ci]).trim()) rows.push({ 'Employee Code': String(v[r][ci]).trim(), HOD: true });
  }
  return { rows: rows, types: Object.keys(types).slice(0, 40) };
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
    Object.keys(GSM.EMP_TABS).forEach(function (t) { tabs[t] = gsmRead_(emp.getSheetByName(t), GSM.EMP_TABS[t], t === 'EmpSalary' ? GSM.HOD_RE : null); });
    var heads = { EmpSalary: gsmHeads_(emp.getSheetByName('EmpSalary')) };
    var payId = PropertiesService.getScriptProperties().getProperty('PAY_SHEET_ID') || GSM.PAY_SHEET_ID;
    // no silent nulls: the reply says how the payroll workbook went, so a dry run tells "no access" from "no Salary Master tab" from "fine" (the staff tabs still come either way)
    var pay = 'ok', sm = null;
    try { sm = SpreadsheetApp.openById(payId).getSheetByName('Salary Master'); } catch (e) { pay = 'pay_sheet_not_accessible'; }
    if (pay === 'ok' && !sm) pay = 'no_salary_tab';
    tabs.SalaryMaster = pay === 'ok' ? gsmRead_(sm, GSM.PAY_COLS, GSM.HOD_RE) : null;
    // the HOD incentive may live in the Payroll Register (a column) or the Adjustments tab (a Type): both come as codes + a boolean, plus the header names of every place looked at
    tabs.PayrollRegister = null; tabs.Adjustments = null; heads.SalaryMaster = null; heads.PayrollRegister = null; heads.Adjustments = null; var adjTypes = null;
    if (pay === 'ok') {
      var pw = SpreadsheetApp.openById(payId), pr = pw.getSheetByName('Payroll Register'), adj = gsmAdj_(pw.getSheetByName('Adjustments'));
      tabs.PayrollRegister = pr ? gsmRead_(pr, ['Employee Code'], GSM.HOD_RE).filter(function (x) { return x.HOD; }) : null;
      tabs.Adjustments = adj.rows; adjTypes = adj.types;
      heads.SalaryMaster = gsmHeads_(sm); heads.PayrollRegister = gsmHeads_(pr); heads.Adjustments = gsmHeads_(pw.getSheetByName('Adjustments'));
    }
    return { success: true, pay: pay, tabs: tabs, heads: heads, adjTypes: adjTypes };
  } catch (err) {
    return { success: false, error: 'read_failed' };
  }
}
