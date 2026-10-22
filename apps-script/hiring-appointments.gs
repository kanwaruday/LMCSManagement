// ═══════════════════════════════════════════════════════════════════
// Hiring v2 -- Appointments (spec 2026-10-23 "Appointments"). An interview, demo or MD Academics
// interview time is PROPOSED (Fee Clerk, Coordinator, Owner; md by a Principal) and ACCEPTED by its
// acceptor (Principal for interview/demo, Owner for md). Only an accepted appointment writes the
// applicant's time column (13 / 25 / 14). A Principal setting an interview/demo time books it directly.
//
// LOCKS: Apps Script's script lock is not re-entrant. The *Core_ functions never lock; the entry points
// (apptPropose_, apptCancel_ and the hiring.gs actions) take hirWithLock_ once and call only cores.
// hiringApplicants_ always runs after the lock is released.
// ═══════════════════════════════════════════════════════════════════
var APPT_TAB = 'Appointments';
var APPT_HEADERS = ['Appt ID', 'Kind', 'Applicant ID', 'Row', 'Phone', 'Name', 'Campus', 'Start', 'Duration Min', 'Place', 'Note',
  'Proposed By', 'Proposed At', 'Acceptor Role', 'Status', 'Decided By', 'Decided At', 'Decline Note', 'Calendar Event ID',
  'Calendar Mode', 'Calendar Error'];
var APPT_KEYS = ['id', 'kind', 'applicantId', 'row', 'phone', 'name', 'campus', 'start', 'durationMin', 'place', 'note',
  'proposedBy', 'proposedAt', 'acceptorRole', 'status', 'decidedBy', 'decidedAt', 'declineNote', 'eventId',
  'calendarMode', 'calendarError'];
var APPT_DURATION = { interview: 30, demo: 45, md: 30 };
// Calendar seam. Placeholder: Task 3 replaces it with the UrlFetchApp Calendar REST calls (sendUpdates=none).
var APPT_CAL_ = { insert: function () { return null; }, remove: function () {} };

// The applicant time column an accepted appointment writes (a function: HIR_COL lives in hiring.gs).
function apptTimeCol_(kind) { return { interview: HIR_COL.INTERVIEW_AT, demo: HIR_COL.DEMO_AT, md: HIR_COL.MD_INTERVIEW_AT }[kind]; }

function apptSheet_(create) {
  const wb = hirWorkbook_();
  let sh = wb.getSheetByName(APPT_TAB);
  if (!sh && create) { sh = wb.insertSheet(APPT_TAB); sh.appendRow(APPT_HEADERS); }
  return sh;
}

function apptAll_() {
  const sh = apptSheet_(false);
  if (!sh) return [];
  return sh.getDataRange().getValues().slice(1).map(function (r, i) {
    const a = { sheetRow: i + 2 };
    APPT_KEYS.forEach(function (k, j) { a[k] = r[j] === undefined ? '' : r[j]; });
    a.id = String(a.id); a.row = Number(a.row) || 0; a.durationMin = Number(a.durationMin) || 0;
    a.phone = hirNormalizePhone_(a.phone); a.status = String(a.status);
    return a;
  }).filter(function (a) { return a.id; });
}
function apptById_(id) {
  const hit = apptAll_().filter(function (a) { return a.id === String(id || ''); })[0];
  if (!hit) throw new Error('Appointment not found');
  return hit;
}
function apptSave_(a) {
  const sh = apptSheet_(true);
  const vals = APPT_KEYS.map(function (k) { return a[k] === undefined ? '' : a[k]; });
  if (a.sheetRow) sh.getRange(a.sheetRow, 1, 1, vals.length).setValues([vals]);
  else { sh.appendRow(vals); a.sheetRow = sh.getLastRow(); }
  return a;
}
// The person's appointments: by normalised phone (so a duplicate row's count too), by row when no phone.
function apptForPerson_(all, row, phone) {
  phone = hirNormalizePhone_(phone);
  return all.filter(function (a) { return phone ? a.phone === phone : a.row === row; });
}

function apptRowState_(sheet, row) {
  const get = function (c) { return sheet.getRange(row, c).getValue(); };
  const status = String(get(HIR_COL.STATUS) || '');
  return { status: status, shortlisted: !!get(HIR_COL.SHORTLISTED_AT), interviewEvidence: !!hirRowEvidence_(sheet, row, get(HIR_COL.PHONE)).interview,
    salaryOfferAt: get(HIR_COL.SALARY_OFFER_AT) || '', rejected: status === 'Rejected' };
}

function apptHasRole_(caller, role) { return (caller.roles || []).indexOf(role) !== -1; }
function apptMdAcceptor_(caller) {
  if (!apptHasRole_(caller, 'Owner')) return false;
  const list = String(PropertiesService.getScriptProperties().getProperty('MD_ACCEPTOR_EMAILS') || '')
    .split(',').map(function (e) { return e.trim().toLowerCase(); }).filter(Boolean);
  return !list.length || list.indexOf(String(caller.email || '').toLowerCase()) !== -1;
}
// Who books without a proposal: role Principal for interview/demo, an MD acceptor Owner for md.
function apptIsDirect_(caller, kind) { return kind === 'md' ? apptMdAcceptor_(caller) : apptHasRole_(caller, 'Principal'); }
function apptCovers_(caller, campus) {
  const ids = String(caller.campusId || '').split(',').map(function (c) { return c.trim().toUpperCase(); });
  return ids.indexOf('ALL') !== -1 || ids.indexOf(campus) !== -1;
}

// End a proposed/accepted appointment. An accepted one loses its event, and the applicant's time column
// is cleared only if it still holds this appointment's time.
function apptEnd_(a, by, why, sheet) {
  if (a.status === 'accepted') {
    apptCalendarDelete_(a);
    const cell = sheet.getRange(a.row, apptTimeCol_(a.kind));
    if (hirMs_(cell.getValue()) && hirMs_(cell.getValue()) === hirMs_(a.start)) cell.setValue('');
  }
  a.status = 'cancelled';
  a.note = (a.note ? a.note + ' | ' : '') + 'Cancelled' + (by ? ' by ' + by : '') + (why ? ': ' + why : '');
  apptSave_(a);
}
function apptCalendarDelete_(a) {
  const ref = String(a.eventId || '');
  if (!ref) return;
  const i = ref.lastIndexOf('|');
  try { APPT_CAL_.remove(i > 0 ? ref.slice(0, i) : 'primary', ref.slice(i + 1)); } catch (e) { Logger.log('appt calendar delete: ' + e.message); }
}

function apptProposeCore_(caller, sheet, body) {
  const kind = String(body.kind || '');
  if (!APPT_DURATION[kind]) throw new Error('Invalid appointment kind');
  if (!hirElevated_(caller) && (kind === 'md' || !apptHasRole_(caller, 'FeeClerk'))) {
    throw new Error('Only a Principal, Coordinator or the Owner can propose ' + (kind === 'md' ? 'an MD Academics interview' : 'this'));
  }
  const r = hirScopedRow_(caller, sheet, body.row);
  const start = hirDateOrThrow_(body.start, 'date and time');
  const st = apptRowState_(sheet, r.row);
  if (st.rejected) throw new Error('This applicant was rejected -- Revive them first');
  const direct = apptIsDirect_(caller, kind);
  const mine = apptForPerson_(apptAll_(), r.row, r.phone).filter(function (a) { return a.kind === kind; });
  const reschedule = mine.some(function (a) { return a.status === 'accepted'; });
  if (kind === 'interview' && !st.shortlisted && !reschedule && !direct) throw new Error('Shortlist this applicant first (a Principal\'s call)');
  if (kind === 'demo' && !st.interviewEvidence) throw new Error('The interview has to be done (or its report filed) before a demo');
  if (kind === 'md' && !st.salaryOfferAt) throw new Error('An MD Academics interview needs a Salary Offer first');

  mine.filter(function (a) { return a.status === 'proposed'; }).forEach(function (a) { apptEnd_(a, caller.email, 'replaced', sheet); });
  const ids = String(caller.campusId || '').split(',').map(function (c) { return c.trim().toUpperCase(); }).filter(Boolean);
  const dur = Number(body.durationMin);
  const appt = apptSave_({ id: 'appt-' + new Date().getTime() + '-' + Math.floor(Math.random() * 1000), kind: kind,
    applicantId: hirApplicantId_(r.row), row: r.row, phone: r.phone, name: r.name,
    campus: ids.length === 1 && ids[0] !== 'ALL' ? ids[0] : r.campus, start: start,
    durationMin: dur >= 5 && dur <= 480 ? Math.round(dur) : APPT_DURATION[kind], place: hirText_(body.place, 200), note: hirText_(body.note, 500),
    proposedBy: caller.email, proposedAt: new Date(), acceptorRole: kind === 'md' ? 'Owner' : 'Principal', status: 'proposed',
    decidedBy: '', decidedAt: '', declineNote: '', eventId: '', calendarMode: '', calendarError: '' });
  if (!direct) return appt;
  if (!st.shortlisted) hirStampShortlist_(sheet, r.row, caller); // a walk-in seen on the spot
  return apptDecideCore_(caller, appt, 'accept', '');
}

// action=apptpropose
function apptPropose_(caller, body) {
  const sheet = hirSheet_();
  const appt = hirWithLock_(function () { return apptProposeCore_(caller, sheet, body); });
  return Object.assign({ id: appt.id }, hiringApplicants_(caller));
}

// Accept / decline. TASK 2 STUB: only the direct-booking accept (the proposer is themselves its acceptor);
// Task 3 completes it (acceptor checks, Owner override, decline, calendar fallbacks).
function apptDecideCore_(caller, appt, decision, note) {
  const cur = apptById_(appt.id);
  const isDirect = decision === 'accept' && cur.status === 'proposed' && cur.proposedBy === caller.email && apptIsDirect_(caller, cur.kind)
    && (cur.kind === 'md' || apptCovers_(caller, cur.campus));
  if (!isDirect) throw new Error('not implemented');
  const sheet = hirSheet_();
  hirGrow_(sheet);
  // A reschedule: the old accepted one goes first, so its clear can't wipe the new time.
  apptForPerson_(apptAll_(), cur.row, cur.phone).filter(function (a) { return a.kind === cur.kind && a.status === 'accepted' && a.id !== cur.id; })
    .forEach(function (a) { apptEnd_(a, caller.email, 'rescheduled', sheet); });
  sheet.getRange(cur.row, apptTimeCol_(cur.kind)).setValue(cur.start);
  let ev = null, err = '';
  try {
    ev = APPT_CAL_.insert(caller.email, { summary: cur.kind + ': ' + cur.name, start: cur.start,
      end: new Date(hirMs_(cur.start) + cur.durationMin * 60000) });
  } catch (e) { err = e.message; }
  Object.assign(cur, { status: 'accepted', decidedBy: caller.email, decidedAt: new Date(),
    eventId: ev && ev.id ? caller.email + '|' + ev.id : '', calendarMode: ev && ev.id ? 'own' : 'none', calendarError: err });
  return apptSave_(cur);
}

function apptCancelCore_(caller, appt, note) {
  const cur = apptById_(appt.id);
  if (cur.status !== 'proposed' && cur.status !== 'accepted') throw new Error('This appointment is already ' + cur.status);
  if (cur.proposedBy !== caller.email && !hirElevated_(caller)) throw new Error('Only the proposer or a Principal, Coordinator or the Owner can cancel this');
  const sheet = hirSheet_();
  hirScopedRow_(caller, sheet, cur.row);
  apptEnd_(cur, caller.email, hirText_(note, 300), sheet);
  return cur;
}

// action=apptcancel
function apptCancel_(caller, body) {
  hirWithLock_(function () { apptCancelCore_(caller, { id: body.id }, body.note); });
  return hiringApplicants_(caller);
}

// Revive: every open or accepted appointment of the person.
function apptCancelAllForCore_(sheet, row, why) {
  apptForPerson_(apptAll_(), row, sheet.getRange(row, HIR_COL.PHONE).getValue())
    .filter(function (a) { return a.status === 'proposed' || a.status === 'accepted'; })
    .forEach(function (a) { apptEnd_(a, '', why, sheet); });
}

// Reject: open proposals and FUTURE accepted ones; past accepted appointments are history.
function apptCancelForRejectCore_(sheet, row) {
  const now = Date.now();
  apptForPerson_(apptAll_(), row, sheet.getRange(row, HIR_COL.PHONE).getValue())
    .filter(function (a) { return a.status === 'proposed' || (a.status === 'accepted' && hirMs_(a.start) > now); })
    .forEach(function (a) { apptEnd_(a, '', 'rejected', sheet); });
}
