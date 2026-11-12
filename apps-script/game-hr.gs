// ═══════════════════════════════════════════════════════════════════
// PDR Backend -- the game's Owner hiring room (W7, N3, 2026-11-12): key-gated gameHr* actions over the SAME hiring.gs reads.
//
// Called only by lms-game's `classic` Edge Function (classic-proxy-contract.md), POST text/plain:
//   { action, key, role, campus, campuses, email, params }
// Same gate as game-approvals.gs (gameKeyOk_, gameOk_, gameNo_ live there, same project): the PDR GAME_KEY; the person is the game's
// verified email, re-checked against this project's own Allowlist (pdrCallerForEmail_). OWNER ONLY: anyone else gets not_authorized.
// Tenant scope: applicants are limited to the proxy's school list (`campuses`); missing = none (fails closed).
// Nothing personal leaves unmasked: phones come back as last 4, no salary figure, no report contents, no emails.
// gameHrReveal is the one way to see a full phone number or the offer breakdown; every reveal is written to the "Game Reveals" tab
// (when, the Owner's name, which field, which applicant id) -- never the value itself.
// gameHrAct (W7 slice 1, 13 Nov): the Owner's hiring steps, each one the SAME hiring.gs / hiring-appointments.gs function the old
// page calls (so every rule, lock and stamp is theirs): shortlist, mark interview/demo done, propose an appointment, accept /
// decline / cancel one, settle a pending reject, revive. Applicants by id (never a sheet row from the client); appointments only of
// an applicant in the proxy's schools. Each done step is written to the "Game Actions" tab (when, who, which step, which id).
// Not here: Start Hiring Process (it calls the Roster proxy with the person's Google token, which a game call doesn't carry).
// ═══════════════════════════════════════════════════════════════════

const GAME_HR_ACTIONS = ['gameHrPipeline', 'gameHrApplicant', 'gameHrReveal', 'gameHrAct'];
const GAME_HR_OPS = ['shortlist', 'unshortlist', 'markstage', 'propose', 'appt', 'confirmreject', 'revive'];
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
  sh.appendRow([new Date(), caller.name || 'Owner', field, id]);
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
    appointments: (a.appointments || []).map(function (x) { return { id: x.id, kind: x.kind, start: x.start, status: x.status, reportFiled: !!x.reportFiled }; }),
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
  if (op === 'confirmreject') return hiringConfirmReject_(caller, { row: row, confirm: p.confirm === '1' });
  if (op === 'revive') return hiringRevive_(caller, { row: row, note: String(p.note || '') });
  if (op === 'appt') {
    const appt = (a.appointments || []).filter(function (x) { return x.id === String(p.appt || ''); })[0];
    if (!appt) throw new Error('That appointment isn’t this applicant’s.');
    if (p.decision === 'cancel') return apptCancel_(caller, { id: appt.id, note: String(p.note || '') });
    return apptDecide_(caller, { id: appt.id, decision: String(p.decision || ''), note: String(p.note || '') });
  }
  throw new Error('Unknown step');
}

function gameHrDispatch_(body) {
  if (!gameKeyOk_(body)) return { success: false, error: 'not_authorized' };
  if (GAME_HR_ACTIONS.indexOf(String(body.action)) === -1) return { success: false, error: 'unknown_action' };
  let caller;
  try { caller = pdrCallerForEmail_(body.email); } catch (err) { caller = null; }
  if (!caller || !callerHasRole_(caller, 'Owner')) return gameNo_('not_authorized'); // the hiring room is the Owner's alone
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
        if (GAME_HR_OPS.indexOf(String(p.op || '')) === -1) return gameNo_('bad_input');
        const a = gameHrList_(caller, schools).filter(function (x) { return x.applicantId === String(p.id || ''); })[0];
        if (!a) return gameNo_('not_found');
        try { gameHrDo_(caller, a, p); } catch (err) { return { success: true, data: { ok: false, code: 'refused', say: gameHrSay_(err) } }; }
        gameHrLog_(caller, String(p.op), a.applicantId);
        const fresh = gameHrList_(caller, schools).filter(function (x) { return x.applicantId === a.applicantId; })[0];
        return gameOk_(fresh ? gameHrDetail_(fresh, schools, Date.now()) : { gone: true });
      }
      case 'gameHrReveal': {
        const field = String(p.field || '');
        if (GAME_HR_REVEAL_FIELDS.indexOf(field) === -1) return gameNo_('bad_input');
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
