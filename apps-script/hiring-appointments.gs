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
// Calendar seam: the Calendar REST API over UrlFetchApp with sendUpdates=none, so neither creating nor
// removing an event ever sends mail (CalendarApp can't promise that on deletes). Throws on non-2xx.
// `var` so tests replace it.
var APPT_CAL_ = {
  insert: function (calendarId, event) { return apptCalFetch_('post', calendarId, '', event); },
  remove: function (calendarId, eventId) { apptCalFetch_('delete', calendarId, eventId); },
};
function apptCalFetch_(method, calendarId, eventId, payload) {
  const url = 'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(calendarId) + '/events' +
    (eventId ? '/' + encodeURIComponent(eventId) : '') + '?sendUpdates=none';
  const opt = { method: method, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true };
  if (payload) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(payload); }
  const res = UrlFetchApp.fetch(url, opt);
  const code = res.getResponseCode(), text = res.getContentText();
  if (code < 200 || code >= 300) throw new Error('Calendar ' + code + ': ' + String(text).slice(0, 200));
  return text ? JSON.parse(text) : {};
}

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

// The declined proposals that are still the person's latest (non-cancelled) one for their kind -- what a proposer
// is shown as "declined, propose again". A newer proposal of the same kind retires it. Later proposedAt wins.
function apptLatestDeclined_(all) {
  const latest = {};
  all.forEach(function (a) {
    if (a.status === 'cancelled') return;
    const k = (a.phone || 'r' + a.row) + '|' + a.kind;
    if (!latest[k] || hirMs_(a.proposedAt) >= hirMs_(latest[k].proposedAt)) latest[k] = a;
  });
  return Object.keys(latest).map(function (k) { return latest[k]; }).filter(function (a) { return a.status === 'declined'; });
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
  hirGrow_(sheet); // apptRowState_ reads Shortlisted At (col 26): a live sheet may still have 25 columns
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

// Who may accept / decline: interview and demo -> role Principal covering the campus, or an Owner (override);
// md -> an MD acceptor Owner. Returns the Decided By label, or throws.
function apptAcceptorLabel_(caller, a) {
  if (a.kind === 'md') {
    if (!apptMdAcceptor_(caller)) throw new Error('Only MD Academics (an Owner) can accept or decline an MD Academics interview');
    return caller.email;
  }
  if (apptHasRole_(caller, 'Principal') && apptCovers_(caller, a.campus)) return caller.email;
  if (apptHasRole_(caller, 'Owner')) return caller.email + ' (override)';
  throw new Error('Only the ' + a.campus + ' Principal (or the Owner) can accept or decline this');
}
function apptDeciderEmail_(a) { return String(a.decidedBy || '').replace(/\s*\(override\)$/, ''); }

// Accept / decline under the caller's lock. Re-reads the appointment, so a second accept finds it decided.
function apptDecideCore_(caller, appt, decision, note) {
  const cur = apptById_(appt.id);
  if (decision !== 'accept' && decision !== 'decline') throw new Error('Choose accept or decline');
  if (cur.status !== 'proposed') throw new Error('This appointment is already ' + cur.status);
  const by = apptAcceptorLabel_(caller, cur);
  if (decision === 'decline') {
    note = hirText_(note, 500);
    if (!note) throw new Error('Add a note saying why (the proposer sees it)');
    return apptSave_(Object.assign(cur, { status: 'declined', decidedBy: by, decidedAt: new Date(), declineNote: note }));
  }
  const sheet = hirSheet_();
  hirGrow_(sheet);
  // A reschedule: the old accepted one goes first (and loses its event), so its clear can't wipe the new time.
  apptForPerson_(apptAll_(), cur.row, cur.phone).filter(function (a) { return a.kind === cur.kind && a.status === 'accepted' && a.id !== cur.id; })
    .forEach(function (a) { apptEnd_(a, caller.email, 'rescheduled', sheet); });
  sheet.getRange(cur.row, apptTimeCol_(cur.kind)).setValue(cur.start);
  Object.assign(cur, { status: 'accepted', decidedBy: by, decidedAt: new Date() });
  apptStoreCalendar_(cur, apptCalendarWrite_(cur, caller.email));
  return apptSave_(cur);
}
function apptStoreCalendar_(a, cal) {
  Object.assign(a, { eventId: cal.eventId ? cal.calendarId + '|' + cal.eventId : '', calendarMode: cal.mode, calendarError: cal.error });
}

// action=apptdecide {id, decision:'accept'|'decline', note?}
function apptDecide_(caller, body) {
  hirWithLock_(function () { apptDecideCore_(caller, { id: body.id }, String(body.decision || ''), body.note); });
  return Object.assign({ id: String(body.id) }, apptList_(caller));
}

// action=apptcalendarretry {id} -- an accepted appointment whose calendar write failed (mode none). It goes on
// the acceptor's calendar; a migrated one (decided by "migration") on the retrier's.
function apptCalendarRetry_(caller, body) {
  hirWithLock_(function () {
    const cur = apptById_(body.id);
    const acceptor = apptDeciderEmail_(cur);
    if (acceptor.toLowerCase() !== String(caller.email || '').toLowerCase() && !hirElevated_(caller)) throw new Error('Only the acceptor or a Principal, Coordinator or the Owner can retry this');
    hirScopedRow_(caller, hirSheet_(), cur.row);
    if (cur.status !== 'accepted' || cur.calendarMode !== 'none') throw new Error('This appointment is already on the calendar (or not accepted)');
    apptStoreCalendar_(cur, apptCalendarWrite_(cur, acceptor.indexOf('@') > 0 ? acceptor : caller.email));
    apptSave_(cur);
  });
  return Object.assign({ id: String(body.id) }, apptList_(caller));
}

// The event for an appointment. Role: the first approved requisition at its campus the subjects match (the
// hiring page's roleFor_), else the position on their latest interview report, else their subjects.
var APPT_TITLE = { interview: 'Interview', demo: 'Demo class', md: 'MD Academics interview' };
function apptEvent_(a) {
  let role = '', stage = '';
  if (a.row) {
    const sheet = hirSheet_();
    const subjects = String(sheet.getRange(a.row, HIR_COL.SUBJECTS).getValue() || '').trim();
    stage = String(sheet.getRange(a.row, HIR_COL.STATUS).getValue() || '').trim();
    try {
      const req = (hirApprovedRequisitions_('New/ Backup Position')[a.campus] || [])
        .filter(function (q) { return hirSubjectsMatch_(q.matchSubjects, subjects); })[0];
      if (req) role = (req.roleLevel || 'ROLE') + (req.subjects ? ': ' + req.subjects : '');
    } catch (e) { Logger.log('appt event role: ' + e.message); }
    if (!role) {
      const rep = hirPortalReports_(HIR_PI_TAB).filter(function (r) {
        return hirNormalizePhone_(r.phone) === a.phone && r.position && HIR_POSITION_NONE.indexOf(r.position) === -1;
      }).pop();
      role = rep ? rep.position : subjects;
    }
  }
  const start = new Date(hirMs_(a.start));
  return {
    summary: APPT_TITLE[a.kind] + ': ' + a.name + (role ? ' (' + role + ')' : ''),
    description: ['Phone: ' + a.phone, 'School: ' + a.campus, role ? 'Position: ' + role : '', stage ? 'Stage: ' + stage : '',
      'Proposed by: ' + a.proposedBy, a.place ? 'Place: ' + a.place : '',
      'https://kanwaruday.github.io/LMCSManagement/hiring/index.html#row=' + a.row].filter(Boolean).join('\n'),
    start: { dateTime: start.toISOString(), timeZone: 'Asia/Kolkata' },
    end: { dateTime: new Date(start.getTime() + (a.durationMin || APPT_DURATION[a.kind] || 30) * 60000).toISOString(), timeZone: 'Asia/Kolkata' },
  };
}

// Put the event on the acceptor's own calendar (shared with the backend account, "make changes"); else on
// the backend's primary with the acceptor as a guest (sendUpdates=none: no invitation mail); else none.
// Never throws. Returns {eventId, mode, calendarId, error}.
function apptCalendarWrite_(appt, acceptorEmail) {
  const errs = [];
  let ev;
  try { ev = apptEvent_(appt); } catch (e) { return { eventId: '', mode: 'none', calendarId: '', error: 'event: ' + e.message }; }
  const tries = [[acceptorEmail, ev, 'own'], ['primary', Object.assign({}, ev, { attendees: [{ email: acceptorEmail }] }), 'guest']];
  for (let i = 0; i < tries.length; i++) {
    try {
      const res = APPT_CAL_.insert(tries[i][0], tries[i][1]);
      if (res && res.id) return { eventId: String(res.id), mode: tries[i][2], calendarId: tries[i][0], error: '' };
      errs.push(tries[i][2] + ': no event id');
    } catch (e) { errs.push(tries[i][2] + ': ' + e.message); }
  }
  return { eventId: '', mode: 'none', calendarId: '', error: errs.join('; ').slice(0, 500) };
}

// action=apptlist -> {toAccept, myProposals, upcoming}, every list inside the caller's campuses.
//   toAccept: proposals this caller accepts -- interview/demo for a covering Principal, md for an MD acceptor
//     Owner. An Owner's override for interview/demo is used from the Hiring panel, not this inbox.
//   myProposals: what the caller proposed (not cancelled), from today on.  upcoming: accepted, from today on.
// A Fee Clerk never sees an md note.
function apptList_(caller) {
  const vis = hirCallerCampuses_(caller);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const clerk = !hirElevated_(caller);
  const all = apptAll_().filter(function (a) { return !vis || vis.indexOf(String(a.campus)) !== -1; })
    .sort(function (a, b) { return hirMs_(a.start) - hirMs_(b.start); });
  const ahead = function (a) { return hirMs_(a.start) >= today.getTime(); };
  const declined = apptLatestDeclined_(all);
  const out = function (a) {
    const o = {};
    APPT_KEYS.forEach(function (k) { o[k] = Object.prototype.toString.call(a[k]) === '[object Date]' ? a[k].toISOString() : a[k]; });
    if (clerk && a.kind === 'md') { o.note = ''; o.declineNote = ''; }
    return o;
  };
  return {
    success: true,
    toAccept: all.filter(function (a) {
      return a.status === 'proposed' && (a.kind === 'md' ? apptMdAcceptor_(caller) : apptHasRole_(caller, 'Principal') && apptCovers_(caller, String(a.campus)));
    }).map(out),
    myProposals: all.filter(function (a) { return a.proposedBy === caller.email && a.status !== 'cancelled' && (ahead(a) || declined.indexOf(a) !== -1); }).map(out),
    upcoming: all.filter(function (a) { return a.status === 'accepted' && ahead(a); }).map(out),
  };
}

// Editor-run check that the backend can write to someone's calendar: inserts a 5-minute test event tomorrow
// through APPT_CAL_ (own, else guest), removes it, and logs the mode.
function testCalendarWrite(email) {
  const res = apptCalendarWrite_({ kind: 'interview', name: 'Calendar test (delete me)', row: 0, phone: '', campus: '', place: '',
    proposedBy: 'testCalendarWrite', start: new Date(Date.now() + 86400000), durationMin: 5 }, email);
  Logger.log('testCalendarWrite(' + email + '): mode ' + res.mode + (res.error ? ' -- ' + res.error : ''));
  if (res.eventId) apptCalendarDelete_({ eventId: res.calendarId + '|' + res.eventId });
  return res;
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
