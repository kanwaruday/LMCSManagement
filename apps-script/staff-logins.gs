// gameStaffLogins (N1, 14 Nov; Jarvis: teachers' emails shouldn't sit in a CSV Uday handles). lms-game's teacher-rollout import, run
// on Uday's Mac, asks server to server (the ROSTER_GAME_KEY, checked by af-video.gs's afvKeyOk_) for the sign-in emails of the
// employee codes it is making class teachers. Only the codes asked for (at most 500), only active staff, only the EmpPersonal
// AuthEmail column: nothing else is read or returned. Same source as teacher-portal.gs's tpAuthEmailToCode_ and approvals.gs.
function gameStaffLogins_(b) {
  if (!b || !afvKeyOk_(b.key)) return { success: false, error: 'not_authorized' };
  var codes = Array.isArray(b.codes) ? b.codes.map(function (c) { return String(c == null ? '' : c).trim().toUpperCase(); }) : [];
  if (!codes.length || codes.length > 500 || codes.some(function (c) { return !/^[A-Z0-9_\/-]{1,20}$/.test(c); })) return { success: false, error: 'bad_input' };
  var ask = {};
  codes.forEach(function (c) { ask[c] = true; });
  var ss = openWorkbook_();
  var m = ss.getSheetByName('EmpMaster').getDataRange().getValues(), mc = m[0].indexOf('EmployeeCode'), ms = m[0].indexOf('Status');
  var p = ss.getSheetByName('EmpPersonal').getDataRange().getValues(), pc = p[0].indexOf('EmployeeCode'), pe = p[0].indexOf('AuthEmail');
  if (mc < 0 || pc < 0 || pe < 0) return { success: false, error: 'sheet_shape' };
  var active = {};
  for (var i = 1; i < m.length; i++) {
    var code = String(m[i][mc] || '').trim().toUpperCase(), status = ms >= 0 ? String(m[i][ms] || '').trim().toLowerCase() : '';
    if (ask[code] && (!status || status === 'active')) active[code] = true;
  }
  var staff = [];
  for (var j = 1; j < p.length; j++) {
    var k = String(p[j][pc] || '').trim().toUpperCase(), email = String(p[j][pe] || '').trim().toLowerCase();
    if (active[k] && /^[^@\s,;]{1,64}@[^@\s,;]{1,190}\.[a-z]{2,}$/.test(email)) { staff.push({ code: k, email: email }); delete active[k]; }
  }
  return { success: true, staff: staff };
}
