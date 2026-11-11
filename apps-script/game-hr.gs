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
// ═══════════════════════════════════════════════════════════════════

const GAME_HR_ACTIONS = ['gameHrPipeline', 'gameHrApplicant', 'gameHrReveal'];
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
        const reports = function (list, kind) {
          return (list || []).map(function (r) { return { kind: kind, at: r['Submitted At'] || '', recommendation: r.recommendation || '' }; });
        };
        return gameOk_({
          applicant: gameHrRow_(a, schools, nowMs),
          notes: a.notes,
          appointments: (a.appointments || []).map(function (x) { return { kind: x.kind, start: x.start, status: x.status, reportFiled: !!x.reportFiled }; }),
          reports: reports(a.interviewReports, 'interview').concat(reports(a.demoReports, 'demo')),
          stages: { shortlistedAt: a.shortlistedAt, interviewAt: a.interviewAt, demoAt: a.demoAt, salaryOfferAt: a.salaryOfferAt,
            mdInterviewAt: a.mdInterviewAt, hiringStartedAt: a.hiringStartedAt, dateOfJoining: a.dateOfJoining },
          earlierRounds: (a.history || []).map(function (h) { return { round: h.round, rejectReason: h.rejectReason || '', revivedAt: h.revivedAt || '' }; }),
          docsMissing: a.docsMissing || [],
        });
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
