// ═══════════════════════════════════════════════════════════════════
// PDR Backend -- the game's Owner hiring room (W7, N3, 2026-11-12): key-gated gameHr* actions over the SAME hiring.gs reads.
//
// Called only by lms-game's `classic` Edge Function (classic-proxy-contract.md), POST text/plain:
//   { action, key, role, campus, campuses, email, params }
// Same gate as game-approvals.gs (gameKeyOk_, gameOk_, gameNo_ live there, same project): the PDR GAME_KEY; the person is the game's
// verified email, re-checked against this project's own Allowlist (pdrCallerForEmail_), acting as body.role (Owner, Principal or
// FeeClerk, W7 S2): that role must be on the person's own row, and it picks the allowed steps (GAME_HR_ROLE_OPS). Anyone else: not_authorized.
// Tenant scope: applicants are limited to the proxy's school list (`campuses`); missing = none (fails closed).
// Nothing personal leaves unmasked: phones come back as last 4, no salary figure, no report contents, no emails.
// gameHrReveal is the one way to see a full phone number or the offer breakdown; every reveal is written to the "Game Reveals" tab
// (when, the Owner's name, which field, which applicant id) -- never the value itself.
// gameHrAct (W7 slice 1, 13 Nov): the Owner's hiring steps, each one the SAME hiring.gs / hiring-appointments.gs function the old
// page calls (so every rule, lock and stamp is theirs): shortlist, mark interview/demo done, propose an appointment (or record one
// already held on a past date: P52, hiring-appointments.gs apptHeld_), accept /
// decline / cancel one, settle a pending reject, revive. Applicants by id (never a sheet row from the client); appointments only of
// an applicant in the proxy's schools. Each done step is written to the "Game Actions" tab (when, who, which step, which id).
// Not here: Start Hiring Process (it calls the Roster proxy with the person's Google token, which a game call doesn't carry).
// ═══════════════════════════════════════════════════════════════════

const GAME_HR_ACTIONS = ['gameHrPipeline', 'gameHrApplicant', 'gameHrReveal', 'gameHrAct'];
const GAME_HR_OPS = ['shortlist', 'unshortlist', 'markstage', 'propose', 'held', 'appt', 'confirmreject', 'revive', 'interview', 'demo', 'add', 'dupsettle', 'calretry'];
// W7 S2 (N3, 25 Nov; Uday: "keep it in the game"): the room opens to the Principal and the Fee Clerk/PRO too. The game says which role
// it acts as (body.role); that role must be on this person's own Allowlist row, and it picks the steps. Every step is still the old
// page's own function, so hiring.gs's scoping (hirScopedRow_: the caller's schools) and its role checks keep applying underneath.
// Principal: the old hiring/index.html steps, minus the Owner's (settle a pending reject, revive, refresh the tracker, Start Hiring).
// Fee Clerk/PRO: the old office/hiring.html legwork (main.gs PDR_FEECLERK_*): add an applicant, propose / record / cancel a visit.
const GAME_HR_ROLES = { owner: 'Owner', principal: 'Principal', fee_clerk: 'FeeClerk' };
const GAME_HR_ROLE_OPS = {
  Owner: GAME_HR_OPS,
  Principal: ['shortlist', 'unshortlist', 'markstage', 'propose', 'held', 'appt', 'interview', 'demo', 'add', 'dupsettle', 'calretry'],
  FeeClerk: ['propose', 'held', 'appt', 'add'], // appt: cancel only (the Fee Clerk never accepts or declines)
};
// the report forms' own fields (hiring.gs hirInterviewRecord_ / hirDemoRecord_); anything else in the form is dropped, never passed on
const GAME_HR_FORM_KEYS = {
  interview: ['interviewDate', 'position', 'confidence', 'english', 'commitment', 'experience', 'capability', 'qualificationRemarks', 'otherSkills',
    'strengths', 'weaknesses', 'expectedSalary', 'familySupport', 'spouseOccupation', 'remarks'],
  demo: ['demoDate', 'class', 'subject', 'scores', 'strengths', 'improve', 'studentFeedback', 'remarks', 'nextDemoAt'],
};
const GAME_HR_JSON_KEYS = ['capability', 'experience', 'scores'];
const GAME_HR_ADD_KEYS = ['name', 'phone', 'age', 'gender', 'qualification', 'bed', 'subjects', 'source', 'notes'];
const GAME_HR_REVEAL_FIELDS = ['phone', 'offer'];

const gameHrTags_ = function (branches) { return (String(branches || '').match(/LMS-\d/g) || []).map(function (t) { return 'LMS' + t.slice(4); }); };
const gameHrLast4_ = function (phone) { const d = String(phone || '').replace(/\D/g, ''); return d.length >= 4 ? '··' + d.slice(-4) : ''; };

/** the next open appointment (proposed, or accepted and still to come), else null */
function gameHrNext_(appts, nowMs) {
  const open = (appts || []).filter(function (x) { return x.status === 'proposed' || (x.status === 'accepted' && hirMs_(x.start) >= nowMs); });
  open.sort(function (x, y) { return hirMs_(x.start) - hirMs_(y.start); });
  return open.length ? { kind: open[0].kind, start: open[0].start, status: open[0].status } : null;
}

/** One applicant as the room's list shows it: masked, no salary, no notes. */
function gameHrRow_(a, schools, nowMs) {
  const tags = gameHrTags_(a.branches).filter(function (c) { return schools.indexOf(c) !== -1; });
  return {
    id: a.applicantId, name: a.name, schools: tags, position: a.positionLabel || a.reportedPosition || '', subjects: a.subjects,
    qualification: a.qualification, status: a.status, matchScore: a.matchScore, appliedAt: a.timestamp, round: a.round,
    rejectReason: a.rejectReason, phone: gameHrLast4_(a.phone), next: gameHrNext_(a.appointments, nowMs),
    docsMissing: (a.docsMissing || []).length, offerRecorded: !!a.salaryOfferAt, hasOffer: !!a.offerBreakdown,
  };
}

/** hiring.gs's own list for this caller, cut to the proxy's schools (an applicant shows if any school they applied to is in it). */
function gameHrList_(caller, schools) {
  const res = hiringApplicants_(caller);
  return (res.applicants || []).filter(function (a) { return gameHrTags_(a.branches).some(function (c) { return schools.indexOf(c) !== -1; }); });
}

function gameHrAudit_(caller, field, id) {
  const wb = hirWorkbook_();
  const sh = wb.getSheetByName('Game Reveals') || wb.insertSheet('Game Reveals');
  if (sh.getLastRow() < 1) sh.appendRow(['At', 'Who', 'Field', 'Applicant ID']);
  sh.appendRow([new Date(), caller.name || 'Owner', field, id]); // the person by name (the Principal or Fee Clerk too); never the value
}

function gameHrLog_(caller, op, id) {
  const wb = hirWorkbook_();
  const sh = wb.getSheetByName('Game Actions') || wb.insertSheet('Game Actions');
  if (sh.getLastRow() < 1) sh.appendRow(['At', 'Who', 'Step', 'Applicant ID']);
  sh.appendRow([new Date(), caller.name || 'Owner', op, id]);
}

/** One applicant in full (still masked): the room's detail view. */
function gameHrDetail_(a, schools, nowMs) {
  const reports = function (list, kind) {
    return (list || []).map(function (r) { return { kind: kind, at: r['Submitted At'] || '', recommendation: r.recommendation || '' }; });
  };
  return {
    applicant: gameHrRow_(a, schools, nowMs),
    notes: a.notes,
    appointments: (a.appointments || []).map(function (x) { return { id: x.id, kind: x.kind, start: x.start, status: x.status, reportFiled: !!x.reportFiled,
      calendarMissing: x.status === 'accepted' && x.calendarMode === 'none' }; }), // S2: accepted, but the calendar write failed (Retry)
    reports: reports(a.interviewReports, 'interview').concat(reports(a.demoReports, 'demo')),
    stages: { shortlistedAt: a.shortlistedAt, interviewAt: a.interviewAt, demoAt: a.demoAt, salaryOfferAt: a.salaryOfferAt,
      mdInterviewAt: a.mdInterviewAt, hiringStartedAt: a.hiringStartedAt, dateOfJoining: a.dateOfJoining },
    earlierRounds: (a.history || []).map(function (h) { return { round: h.round, rejectReason: h.rejectReason || '', revivedAt: h.revivedAt || '' }; }),
    docsMissing: a.docsMissing || [],
    pendingReject: a.stageMarks && a.stageMarks.rejectPending ? String(a.stageMarks.rejectPending.reason || 'Rejected') : '', // a Fee Clerk's reject waiting on a yes
  };
}

/** A refusal from hiring.gs in its own plain words, unless it could carry data (an email, a long number). */
function gameHrSay_(err) {
  const m = String((err && err.message) || '').slice(0, 160);
  return m && !/@|\d{5,}/.test(m) ? m : '';
}

/** One hiring step: the same function the old page calls, on this applicant's row. */
function gameHrDo_(caller, a, p) {
  const op = String(p.op || ''), row = a.row;
  if (op === 'shortlist' || op === 'unshortlist') return hiringShortlist_(caller, { row: row, on: op === 'shortlist' });
  if (op === 'markstage') return hiringMarkStage_(caller, { row: row, stage: String(p.stage || '') });
  if (op === 'propose') return apptPropose_(caller, { row: row, kind: String(p.kind || ''), start: String(p.at || '') });
  if (op === 'held') return apptHeld_(caller, { row: row, kind: String(p.kind || ''), start: String(p.at || '') }); // P52: already happened
  if (op === 'confirmreject') return hiringConfirmReject_(caller, { row: row, confirm: p.confirm === '1' });
  if (op === 'revive') return hiringRevive_(caller, { row: row, note: String(p.note || '') });
  if (op === 'interview' || op === 'demo') {
    // the report form arrives as flat params (the proxy caps each at 500 characters); the score maps come as small JSON strings
    const b = { row: row, recommendation: String(p.recommendation || ''), rejectReason: String(p.rejectReason || ''), rejectNote: String(p.rejectNote || '') };
    GAME_HR_FORM_KEYS[op].forEach(function (k) {
      if (p[k] === undefined) return;
      b[k] = GAME_HR_JSON_KEYS.indexOf(k) !== -1 ? gameHrJson_(p[k]) : String(p[k]);
    });
    return (op === 'interview' ? hiringSubmitInterview_ : hiringSubmitDemo_)(caller, b);
  }
  if (op === 'dupsettle') {
    const other = (p.otherList || []).filter(function (x) { return x.applicantId === String(p.other || ''); })[0];
    if (!other) throw new Error('Pick the other candidate from your list.');
    return hiringDupSettle_(caller, { row: row, otherRow: other.row, same: p.same === '1' });
  }
  if (op === 'calretry') {
    const appt = (a.appointments || []).filter(function (x) { return x.id === String(p.appt || ''); })[0];
    if (!appt) throw new Error('That appointment isn’t this applicant’s.');
    return apptCalendarRetry_(caller, { id: appt.id });
  }
  if (op === 'appt') {
    const appt = (a.appointments || []).filter(function (x) { return x.id === String(p.appt || ''); })[0];
    if (!appt) throw new Error('That appointment isn’t this applicant’s.');
    if (p.decision === 'cancel') return apptCancel_(caller, { id: appt.id, note: String(p.note || '') });
    return apptDecide_(caller, { id: appt.id, decision: String(p.decision || ''), note: String(p.note || '') });
  }
  throw new Error('Unknown step');
}

/** a score map (capability, experience, scores) sent as a JSON string: an object, or nothing */
function gameHrJson_(raw) {
  let f = {};
  try { f = JSON.parse(String(raw || '{}')); } catch (err) { throw new Error('The form didn’t come through. Try again.'); }
  return f && typeof f === 'object' && !Array.isArray(f) ? f : {};
}

/** add an applicant (hiring.gs hiringAddApplicant_) at one of the proxy's schools; only the add form's own fields pass */
function gameHrAdd_(caller, p, schools) {
  const campus = String(p.campus || '').toUpperCase();
  if (schools.indexOf(campus) === -1) return gameNo_('not_found');
  const b = { campusId: campus };
  GAME_HR_ADD_KEYS.forEach(function (k) { if (p[k] !== undefined) b[k] = String(p[k]); });
  let res;
  try { res = hiringAddApplicant_(caller, b); } catch (err) { return { success: true, data: { ok: false, code: 'refused', say: gameHrSay_(err) } }; }
  if (res && res.duplicate) return gameOk_({ ok: false, code: 'duplicate', id: res.applicantId || '' }); // an id only if it's in their own list
  gameHrLog_(caller, 'add', (res && res.applicantId) || '');
  return gameOk_({ ok: true, id: (res && res.applicantId) || '' });
}

function gameHrDispatch_(body) {
  if (!gameKeyOk_(body)) return { success: false, error: 'not_authorized' };
  if (GAME_HR_ACTIONS.indexOf(String(body.action)) === -1) return { success: false, error: 'unknown_action' };
  let caller;
  try { caller = pdrCallerForEmail_(body.email); } catch (err) { caller = null; }
  const role = GAME_HR_ROLES[String(body.role || '')]; // the role the game acts as; it must be on this person's own Allowlist row
  if (!caller || !role || !callerHasRole_(caller, role)) return gameNo_('not_authorized');
  const ops = GAME_HR_ROLE_OPS[role];
  const p = body.params || {}, nowMs = Date.now();
  const schools = Array.isArray(body.campuses) ? body.campuses.map(function (c) { return String(c).toUpperCase(); }) : [];
  try {
    switch (String(body.action)) {
      case 'gameHrPipeline': {
        const status = hiringApprovalStatus_(caller);
        return gameOk_({
          statuses: HIR_STATUSES,
          schools: (status.campuses || []).filter(function (c) { return schools.indexOf(c.campusId) !== -1; }).map(function (c) {
            return { code: c.campusId, openPositions: (c.newPositions || []).length, hiringApproved: !!c.hiringDecisionApproved };
          }),
          applicants: gameHrList_(caller, schools).map(function (a) { return gameHrRow_(a, schools, nowMs); }),
        });
      }
      case 'gameHrApplicant': {
        const a = gameHrList_(caller, schools).filter(function (x) { return x.applicantId === String(p.id || ''); })[0];
        if (!a) return gameNo_('not_found');
        return gameOk_(gameHrDetail_(a, schools, nowMs));
      }
      case 'gameHrAct': {
        if (ops.indexOf(String(p.op || '')) === -1) return gameNo_('not_authorized');
        if (role === 'FeeClerk' && p.op === 'appt' && p.decision !== 'cancel') return gameNo_('not_authorized');
        if (p.op === 'add') return gameHrAdd_(caller, p, schools);
        const a = gameHrList_(caller, schools).filter(function (x) { return x.applicantId === String(p.id || ''); })[0];
        if (!a) return gameNo_('not_found');
        if (p.op === 'dupsettle') p.otherList = gameHrList_(caller, schools); // the other candidate by id, from this caller's own list
        try { gameHrDo_(caller, a, p); } catch (err) { return { success: true, data: { ok: false, code: 'refused', say: gameHrSay_(err) } }; }
        gameHrLog_(caller, String(p.op), a.applicantId);
        const fresh = gameHrList_(caller, schools).filter(function (x) { return x.applicantId === a.applicantId; })[0];
        return gameOk_(fresh ? gameHrDetail_(fresh, schools, Date.now()) : { gone: true });
      }
      case 'gameHrReveal': {
        const field = String(p.field || '');
        if (GAME_HR_REVEAL_FIELDS.indexOf(field) === -1) return gameNo_('bad_input');
        if (field === 'offer' && role !== 'Owner') return gameNo_('not_authorized'); // salary stays the Owner's
        const a = gameHrList_(caller, schools).filter(function (x) { return x.applicantId === String(p.id || ''); })[0];
        if (!a) return gameNo_('not_found');
        const value = field === 'phone' ? a.phone : a.offerBreakdown;
        if (!value) return gameNo_('nothing');
        gameHrAudit_(caller, field, a.applicantId); // audited before the value goes out
        return gameOk_({ field: field, value: value });
      }
    }
  } catch (err) {
    return gameNo_('refused'); // never the sheet's own error text
  }
  return { success: false, error: 'unknown_action' };
}
