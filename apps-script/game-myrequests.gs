// ═══════════════════════════════════════════════════════════════════
// PDR Backend -- lms-game's "New request + My requests" (N4, 14 Nov 2026) for the Principal and every staff member: key-gated game*
// actions over approvals.gs's own aprSubmit_ / aprList_ / aprDetail_ / aprAddComment_, called unchanged.
//
// Called only by lms-game's `classic` Edge Function, server to server: POST { action, key, role, campus, email, params } (same body
// and gate as game-approvals.gs, whose helpers this file reuses: gameKeyOk_, gameOk_, gameNo_, gameNames_, gameNameOf_, gameAprRow_).
//   email   the person, from the game's VERIFIED Supabase JWT. The requester is always this email, never a name or id the game sends.
//           Who they are (roles, school) comes from this project's Allowlist / Employee Master by that email (pdrCallerForEmail_).
//   campus  the one school the proxy checked the person's grant for.
// Who sees what:
//   the school's Principal (Allowlist Principal at that school): all 13 categories; their school's requests (approvals.gs's own
//     campus scope), each marked mine or not.
//   everyone else (teacher, IT teacher, PTI, Fee Clerk, driver, non-teaching): Compensatory Leave / Leave / Other only
//     (APR_TEACHER_CATEGORIES; Leave stays Teacher-only, aprLvPrepare_), and only requests THEY filed. This file filters by requester
//     itself: aprList_ self-scopes only Teacher/Staff callers, so a FeeClerk-only Allowlist row would otherwise see the whole school.
// No decide, archive or refer here: those stay in lane-f's Approvals room (game-approvals.gs).
// Answers {success:true, data:{ok:true, ...}} or {success:true, data:{ok:false, code}}. Codes: not_on_list (the email resolves to
// nobody: ask the office), not_authorized, not_found, bad_input, decided, refused, leave_past, leave_not_working, leave_too_long,
// leave_overlap, leave_teachers_only, leave_dates. Never an email, never sheet text, nothing logged but the error's name.
// ═══════════════════════════════════════════════════════════════════

const GAME_MYREQ_ACTIONS = ['gameMyReqSubmit', 'gameMyReqList', 'gameMyReqDetail', 'gameMyReqComment'];
// approvals.gs / approvals-leave.gs error sentences -> short codes (checked in order; anything unlisted is gameCode_'s)
const GAME_MYREQ_CODES = [
  [/no longer be applied/i, 'leave_past'], [/not a working day|no working days/i, 'leave_not_working'], [/at most \d+ days/i, 'leave_too_long'],
  [/already have a leave request/i, 'leave_overlap'], [/filed by teachers/i, 'leave_teachers_only'],
  [/leave type|valid "(from|to)" date|before the "from" date/i, 'leave_dates'],
  [/invalid category|teachers can only submit|title required|description required/i, 'bad_input'],
];
function gameMyReqCode_(res) {
  const e = String((res && res.error) || '');
  for (let i = 0; i < GAME_MYREQ_CODES.length; i++) if (GAME_MYREQ_CODES[i][0].test(e)) return GAME_MYREQ_CODES[i][1];
  return gameCode_(res);
}

/** A request for the requester's screen: approvals.gs's object, emails out, names in; no recommendation, no audit trail. */
function gameMyReqView_(o, names, me) {
  return { id: o.id, category: o.category, urgency: o.urgency, title: o.title, description: o.description, amount: o.amount, itemName: o.itemName,
    quantity: o.quantity, evidenceLink: o.evidenceLink, requestedAt: o.requestedAt, status: o.status, decidedAt: o.decidedAt, decisionNote: o.decisionNote,
    awaitingMd: !!o.awaitingMd, leave: o.leave ? { type: o.leave.type, from: o.leave.from, to: o.leave.to, workingDays: o.leave.workingDays } : null,
    requestedByName: gameNameOf_(names, o.requestedBy), decidedByName: gameNameOf_(names, o.decidedBy),
    mine: String(o.requestedBy || '').trim().toLowerCase() === me };
}

/** POST action=gameMyReq*: dispatched from main.gs doPost, before the Google-token check (the key is this path's gate). */
function gameMyReqDispatch_(body) {
  if (!gameKeyOk_(body)) return { success: false, error: 'not_authorized' };
  if (GAME_MYREQ_ACTIONS.indexOf(String(body.action)) === -1) return { success: false, error: 'unknown_action' };
  const campus = String(body.campus || '').trim().toUpperCase();
  if (!/^LMS[1-6]$/.test(campus)) return gameNo_('not_authorized');
  let caller;
  try { caller = pdrCallerForEmail_(body.email); } catch (err) { caller = null; }
  if (!caller) return gameNo_('not_on_list');
  const me = caller.email, p = body.params || {};
  const principal = callerHasRole_(caller, 'Principal') && caller.campusId === campus; // the school's own Principal: the school view
  if (!principal && caller.campusId !== 'ALL' && caller.campusId !== campus) return gameNo_('not_authorized'); // game grant and Allowlist disagree
  const mayOpen = function (row) { return principal ? String(row[1]).trim() === campus : String(row[11]).trim().toLowerCase() === me; };
  try {
    switch (String(body.action)) {
      case 'gameMyReqSubmit': {
        const category = String(p.category || '').trim();
        if (!principal && APR_TEACHER_CATEGORIES.indexOf(category) === -1) return gameNo_('bad_input');
        const res = aprSubmit_(caller, { category: category, title: p.title, description: p.description, urgency: p.urgency, amount: p.amount,
          itemName: p.itemName, quantity: p.quantity, evidenceLink: p.evidenceLink, leaveType: p.leaveType, fromDate: p.fromDate, toDate: p.toDate,
          campusId: campus }); // campusId only counts for an 'ALL' caller (aprSubmit_), so it can't move anyone else's request
        return res.success ? gameOk_({ id: res.id, duplicate: !!res.duplicate }) : gameNo_(gameMyReqCode_(res));
      }
      case 'gameMyReqList': {
        const res = aprList_(caller);
        if (!res.success) return gameNo_(gameMyReqCode_(res));
        const names = gameNames_();
        const mine = res.requests.filter(function (o) { return principal ? o.campusId === campus : String(o.requestedBy).trim().toLowerCase() === me; });
        return gameOk_({ requests: mine.map(function (o) { return gameMyReqView_(o, names, me); }), school: principal,
          categories: (principal ? APR_CATEGORIES : APR_TEACHER_CATEGORIES).filter(function (c) { return c !== APR_LEAVE_CATEGORY || callerHasRole_(caller, 'Teacher'); }), // Leave: Teacher only (aprLvPrepare_)
          leaveTypes: callerHasRole_(caller, 'Teacher') ? APR_LV_TYPE_NAMES.map(function (t) { return { name: t, multi: !!APR_LV_TYPES[t].multi }; }) : [] });
      }
      case 'gameMyReqDetail': {
        const row = gameAprRow_(String(p.id || ''));
        if (!row) return gameNo_('not_found');
        if (!mayOpen(row)) return gameNo_('not_authorized');
        const res = aprDetail_(caller, String(p.id));
        if (!res.success) return gameNo_(gameMyReqCode_(res));
        const names = gameNames_();
        return gameOk_({ request: gameMyReqView_(res.request, names, me),
          comments: res.comments.map(function (c) { return { id: c.id, authorName: gameNameOf_(names, c.authorEmail), mine: String(c.authorEmail).trim().toLowerCase() === me, body: c.body, postedAt: c.postedAt }; }) });
      }
      case 'gameMyReqComment': {
        const row = gameAprRow_(String(p.id || ''));
        if (!row) return gameNo_('not_found');
        if (!mayOpen(row)) return gameNo_('not_authorized');
        const text = String(p.body || '').trim();
        if (!text || text.length > 500) return gameNo_('bad_input');
        const res = aprAddComment_(caller, { approvalId: String(p.id), body: text });
        return res.success ? gameOk_({ status: res.status }) : gameNo_(gameMyReqCode_(res));
      }
    }
  } catch (err) {
    console.error('gameMyReq ' + String(body.action) + ': ' + (err && err.name)); // never the message: it can carry sheet text
    return { success: false, error: 'backend' };
  }
  return { success: false, error: 'unknown_action' };
}
