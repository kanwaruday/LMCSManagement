// ═══════════════════════════════════════════════════════════════════
// TEACHER LEAVE IN APPROVALS (2026-10-26, per Uday: "Leave into Approvals").
// Design and every decision: docs/superpowers/specs/2026-10-25-teacher-leave-in-approvals-design.md
// Lives in the PDR Backend project, next to approvals.gs, which calls the hooks below.
//
// One Approvals category, "Leave", with a Leave type. The request carries dates; the server
// works out the working days, the leave days charged and the notice given. Other modules
// (the Teacher game) read approved leave day by day through action=approvedleave.
//
// Rules in short (LMCS Bye Laws 2026, OO-09/26):
//   - applied in advance: a future date, or today until 7:00 AM IST (server clock). Anything
//     later is refused; the Principal records it (Absent if it was not notified by 7:00 AM).
//   - working day = not Sunday, not 2nd Saturday, not a school-Calendar "GH..." holiday.
//   - Half, Short, Late and Special Day are single-day; Single, Casual, Emergency may span days.
//   - Special Day: 2 leave days with 7+ days' notice, 3 with less (the 5-day "no notice" tier is
//     an Absent recorded by management, never filed from this form).
//
// Everything below the "pure" line has no Apps Script calls, so tests/approvals/test-leave.js
// runs it in plain Node. The Apps Script glue (sheet write, calendar read, the action) is at the end.
//
// Column positions on the Approvals sheet (0-based into a row array; sheet column = index + 1).
// Columns 0-24 belong to approvals.gs / the Coordinator backend; 25-32 are this feature.
// Other Apps Script projects (Coordinator, the game backend) read these positions directly.
// ═══════════════════════════════════════════════════════════════════

const APR_LEAVE_CATEGORY = 'Leave';
const APR_LV_COL = { TYPE: 25, FROM: 26, TO: 27, PART: 28, WORKING: 29, DEDUCTION: 30, NOTICE: 31, NOTE: 32 };
const APR_LV_HEADERS = ['leaveType', 'fromDate', 'toDate', 'dayPart', 'workingDays', 'deduction', 'noticeDays', 'leaveNote'];
const APR_LV_DEADLINE_HOUR = 7;      // IST: today's leave can be filed until this hour
const APR_LV_MAX_DAYS = 92;          // longest single request
const APR_LV_LONG_WORKING_DAYS = 6;  // more than this many working days = Long Leave (bye-law)
const APR_LV_MAX_QUERY_DAYS = 400;   // longest window action=approvedleave will expand

// type -> {part, weight (leave days charged per working day), excused (game: day is not on track), fraction (share of the day away), multi (may span days)}
const APR_LV_TYPES = {
  'Single Leave':      { part: 'full',  weight: 1,    excused: true,  fraction: 1,    multi: true },
  'Casual Leave':      { part: 'full',  weight: 1,    excused: true,  fraction: 1,    multi: true },
  'Emergency Leave':   { part: 'full',  weight: 0,    excused: true,  fraction: 1,    multi: true },
  'Half Leave':        { part: 'half',  weight: 0.5,  excused: true,  fraction: 0.5,  multi: false },
  'Short Leave':       { part: 'short', weight: 1 / 3, excused: false, fraction: 0.33, multi: false },
  'Special Day Leave': { part: 'full',  weight: null, excused: true,  fraction: 1,    multi: false },
  // Late is notice and record only (decision 5): it still counts as a Late, and for the game the day stays a working day.
  'Late':              { part: 'late',  weight: 0.25, excused: false, fraction: 0,    multi: false },
};
const APR_LV_TYPE_NAMES = Object.keys(APR_LV_TYPES);

const APR_LV_PAST_MESSAGE = 'This can no longer be applied for. Your Principal will record it (as Absent if it was not notified by 7:00 AM).';

// ── pure ──────────────────────────────────────────────────────────

// IST has no daylight saving, so a fixed +05:30 offset is exact. Returns today's IST date and hour.
function aprLvNowIst_(now) {
  const t = new Date((now || new Date()).getTime() + 330 * 60000);
  return { iso: t.toISOString().slice(0, 10), hour: t.getUTCHours() };
}

function aprLvParseISO_(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? d : null;
}
function aprLvAddDays_(iso, n) { const d = aprLvParseISO_(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function aprLvDaysBetween_(a, b) { return Math.round((aprLvParseISO_(b) - aprLvParseISO_(a)) / 86400000); }
function aprLvRange_(from, to) { const out = []; for (let d = from; d <= to; d = aprLvAddDays_(d, 1)) out.push(d); return out; } // ISO strings compare in date order
function aprLvRound2_(x) { return Math.round(x * 100) / 100; }

// A sheet cell holding a date: a text 'YYYY-MM-DD' (what this feature writes) or a Date Sheets converted it to.
function aprLvCellISO_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return new Date(v.getTime() + 330 * 60000).toISOString().slice(0, 10);
  const s = String(v || '').trim().slice(0, 10);
  return aprLvParseISO_(s) ? s : '';
}

function aprLvIsNonWorking_(iso, holidays) {
  const d = aprLvParseISO_(iso), dow = d.getUTCDay();
  if (dow === 0) return true;
  if (dow === 6 && Math.ceil(d.getUTCDate() / 7) === 2) return true; // 2nd Saturday
  return !!(holidays && holidays[iso]);
}

// input {type, from, to}; nowIst from aprLvNowIst_; holidays {iso: true} for the teacher's campus.
// -> {ok:false, error} or {ok:true, leave:{type, from, to, part, workingDays, deduction, noticeDays}, warnings:[...]}
function aprLvValidate_(input, nowIst, holidays) {
  const fail = function (error) { return { ok: false, error: error }; };
  const type = String((input && input.type) || '').trim();
  const t = APR_LV_TYPES[type];
  if (!t) return fail('Choose a leave type.');
  const from = String(input.from || '').trim();
  if (!aprLvParseISO_(from)) return fail('Enter a valid "from" date.');
  const to = t.multi ? String(input.to || from).trim() : from; // single-day types ignore "to"
  if (!aprLvParseISO_(to)) return fail('Enter a valid "to" date.');
  if (to < from) return fail('The "to" date is before the "from" date.');
  if (aprLvDaysBetween_(from, to) + 1 > APR_LV_MAX_DAYS) return fail('A leave request can cover at most ' + APR_LV_MAX_DAYS + ' days.');
  if (from < nowIst.iso || (from === nowIst.iso && nowIst.hour >= APR_LV_DEADLINE_HOUR)) return fail(APR_LV_PAST_MESSAGE);

  const working = aprLvRange_(from, to).filter(function (d) { return !aprLvIsNonWorking_(d, holidays); });
  if (!working.length) return fail(t.multi ? 'Those dates have no working days (Sunday, 2nd Saturday or a school holiday).' : 'That date is not a working day (Sunday, 2nd Saturday or a school holiday).');

  const noticeDays = aprLvDaysBetween_(nowIst.iso, from);
  const deduction = type === 'Special Day Leave' ? (noticeDays >= 7 ? 2 : 3) : aprLvRound2_(t.weight * working.length);
  const warnings = [];
  if (working.length > APR_LV_LONG_WORKING_DAYS) warnings.push('Long Leave: more than ' + APR_LV_LONG_WORKING_DAYS + ' working days. It needs MD Operations approval and sits outside the 10% cap.');
  if (type === 'Single Leave' && (aprLvIsNonWorking_(aprLvAddDays_(from, -1), holidays) || aprLvIsNonWorking_(aprLvAddDays_(to, 1), holidays))) {
    warnings.push('Sandwich rule: this leave touches a holiday, so the holiday may also count as leave.');
  }
  return { ok: true, leave: { type: type, from: from, to: to, part: t.part, workingDays: working.length, deduction: deduction, noticeDays: noticeDays }, warnings: warnings };
}

function aprLvTitle_(leave) { return leave.type + ' — ' + leave.from + (leave.to !== leave.from ? ' to ' + leave.to : ''); }

// The leave stored on an Approvals row, or null.
function aprLvRowLeave_(row) {
  if (String(row[2]) !== APR_LEAVE_CATEGORY || !row[APR_LV_COL.TYPE]) return null;
  return {
    type: String(row[APR_LV_COL.TYPE]), from: aprLvCellISO_(row[APR_LV_COL.FROM]), to: aprLvCellISO_(row[APR_LV_COL.TO]),
    dayPart: String(row[APR_LV_COL.PART] || ''), workingDays: Number(row[APR_LV_COL.WORKING]) || 0,
    deduction: Number(row[APR_LV_COL.DEDUCTION]) || 0, noticeDays: Number(row[APR_LV_COL.NOTICE]) || 0,
    note: String(row[APR_LV_COL.NOTE] || ''), // the warnings shown at filing (Long Leave, sandwich rule), for whoever decides
  };
}

// Same teacher, overlapping dates, request still open or approved. values = Approvals rows incl. the header row.
// -> null, or {id, status, same} (same = identical type and dates: a repeat of this very request, e.g. a double click).
function aprLvFindOverlap_(values, email, leave) {
  const who = String(email || '').trim().toLowerCase();
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row[0] || String(row[2]) !== APR_LEAVE_CATEGORY || String(row[11]).trim().toLowerCase() !== who) continue;
    const status = String(row[13]);
    if (status !== 'Pending' && status !== 'Info Requested' && status !== 'Approved') continue;
    const other = aprLvRowLeave_(row);
    if (!other || !other.from || !other.to) continue;
    if (leave.from <= other.to && leave.to >= other.from) {
      return { id: String(row[0]), status: status, same: other.type === leave.type && other.from === leave.from && other.to === leave.to };
    }
  }
  return null;
}

// The contract (decision 6): one entry per calendar day of Approved leave inside [q.from, q.to].
//   {date, fraction (1 | 0.5 | 0.33), excused (the game's yes/no), type, approvalId, email, campusId}
// Late is never returned (it is a normal working day). q: {from, to, email?, campusId?}.
// holidaysFor(campusId, fromISO, toISO) -> {iso: true}.
function aprLvApprovedDays_(values, q, holidaysFor) {
  const who = q.email ? String(q.email).trim().toLowerCase() : '';
  const out = [], holidayCache = {};
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row[0] || String(row[13]) !== 'Approved') continue;
    const lv = aprLvRowLeave_(row);
    const t = lv && APR_LV_TYPES[lv.type];
    if (!t || t.fraction === 0 || !lv.from || !lv.to) continue;
    const email = String(row[11]).trim().toLowerCase(), campusId = String(row[1]).trim();
    if (who && email !== who) continue;
    if (q.campusId && campusId !== q.campusId) continue;
    const from = lv.from > q.from ? lv.from : q.from, to = lv.to < q.to ? lv.to : q.to;
    if (from > to) continue;
    const key = campusId + '|' + from + '|' + to;
    const holidays = holidayCache[key] || (holidayCache[key] = holidaysFor ? holidaysFor(campusId, from, to) : {});
    aprLvRange_(from, to).forEach(function (d) {
      if (aprLvIsNonWorking_(d, holidays)) return;
      out.push({ date: d, fraction: t.fraction, excused: t.excused, type: lv.type, approvalId: String(row[0]), email: email, campusId: campusId });
    });
  }
  out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.email < b.email ? -1 : a.email > b.email ? 1 : 0; });
  return out;
}

// ── Apps Script glue (not run in the Node tests) ──────────────────

// Called by aprSubmit_ for category 'Leave', before the duplicate guard. -> {ok:false, error} or {ok:true, leave, title, warnings}
function aprLvPrepare_(caller, body, campusId) {
  if (!callerHasRole_(caller, 'Teacher')) return { ok: false, error: 'Leave requests are filed by teachers.' };
  const nowIst = aprLvNowIst_(new Date());
  const holidays = aprLvHolidays_(campusId, String(body.fromDate || '').trim(), String(body.toDate || body.fromDate || '').trim());
  const v = aprLvValidate_({ type: body.leaveType, from: body.fromDate, to: body.toDate }, nowIst, holidays);
  if (!v.ok) return v;
  v.title = aprLvTitle_(v.leave);
  v.leave.note = v.warnings.join(' ');
  return v;
}

// Called by aprAppendRequest_ right after appendRow, inside the script lock (so getLastRow is this row).
function aprLvWrite_(sheet, rowNum, leave) {
  const first = APR_LV_COL.TYPE + 1;
  if (!sheet.getRange(1, first).getValue()) sheet.getRange(1, first, 1, APR_LV_HEADERS.length).setValues([APR_LV_HEADERS]);
  sheet.getRange(rowNum, first + 1, 1, 2).setNumberFormat('@'); // keep the two dates as text, not Sheets dates
  sheet.getRange(rowNum, first, 1, APR_LV_HEADERS.length).setValues([[leave.type, leave.from, leave.to, leave.part, leave.workingDays, leave.deduction, leave.noticeDays, leave.note || '']]);
}

// {iso: true} for every school-Calendar "GH..." holiday day of this campus between the two dates. A Calendar failure
// falls back to Sundays and 2nd Saturdays only (the leave is still filed; the count may include a holiday).
function aprLvHolidays_(campusId, fromISO, toISO) {
  const set = {};
  try {
    const a = aprLvParseISO_(fromISO), b = aprLvParseISO_(toISO || fromISO);
    if (!a || !b) return set;
    const start = new Date(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
    const end = new Date(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate() + 1);
    pdrSchoolCalendarEvents_(campusId, start, end).forEach(function (ev) {
      if (ev.getTitle().indexOf('GH') !== 0) return;
      const evStart = new Date(ev.getStartTime().getFullYear(), ev.getStartTime().getMonth(), ev.getStartTime().getDate());
      for (let d = new Date(evStart); d < ev.getEndTime(); d.setDate(d.getDate() + 1)) set[pdrFormatISO_(d)] = true;
    });
  } catch (err) { /* see above */ }
  return set;
}

// action=approvedleave&from=YYYY-MM-DD&to=YYYY-MM-DD[&email=][&campusId=] (GET). The contract other modules read.
// A teacher sees only their own days; a Principal their campus; Owner/Coordinator any.
function aprLvApprovedLeaveAction_(caller, params) {
  const from = String(params.from || '').trim(), to = String(params.to || '').trim();
  if (!aprLvParseISO_(from) || !aprLvParseISO_(to) || to < from) return { success: false, error: 'from and to must be dates (YYYY-MM-DD), to not before from' };
  if (aprLvDaysBetween_(from, to) + 1 > APR_LV_MAX_QUERY_DAYS) return { success: false, error: 'Ask for at most ' + APR_LV_MAX_QUERY_DAYS + ' days at a time' };
  const q = { from: from, to: to, email: String(params.email || '').trim().toLowerCase(), campusId: String(params.campusId || '').trim().toUpperCase() };
  if (pdrIsTeacherOnly_(caller)) {
    if (q.email && q.email !== caller.email) return { success: false, error: 'Not authorized' };
    q.email = caller.email;
  } else if (caller.campusId !== 'ALL') {
    if (q.campusId && q.campusId !== caller.campusId) return { success: false, error: 'Not authorized for that campus' };
    q.campusId = caller.campusId;
  }
  const days = aprLvApprovedDays_(aprValues_(), q, aprLvHolidays_);
  let codes = {};
  try { codes = tpAuthEmailToCode_(); } catch (err) { /* employeeCode is a convenience; email is the key */ }
  days.forEach(function (d) { d.employeeCode = codes[d.email] || ''; });
  return { success: true, days: days };
}

