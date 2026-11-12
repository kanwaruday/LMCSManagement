// lms-game's "My week" (N2, 14 Nov): a teacher's own Support Session scores and the school calendar for the next 14 days, for the
// game's classic proxy. Thin wrappers over the teacher portal's existing myTeacherSsStats_ (teacher-ss.gs) and myUpcomingEvents_
// (principal-dr.gs), called unchanged. Routed from PDR_GAME_ROUTES_ (principal-dr.gs) as gameSsMine / gamePdrMyEvents; the proxy has
// already checked the game key, the teacher's grant at that school and, for gameSsMine, the JWT-verified email. Nothing is logged.

/** gameSsMine {}: the caller's own SS average and rubric. Who they are comes only from the verified email (Auth email -> Employee code
 *  in teacher-portal.gs), never from a name the game sends. Only the numbers go back: no teacher name, no other teacher's rows. */
function pdrGameMySs_(c) {
  const out = myTeacherSsStats_({ email: c.email, campusId: c.campusId, name: '' });
  if (!out.success) return out;
  const s = out.found ? out.stats : null;
  return { success: true, data: { found: !!s, rubricParams: out.rubricParams,
    stats: s ? { avgTotal: s.avgTotal, submissionCount: s.submissionCount, avgPerParam: s.avgPerParam,
      lastSubmission: s.lastSubmission && typeof s.lastSubmission.toISOString === 'function' ? s.lastSubmission.toISOString() : String(s.lastSubmission || '') } : null } };
}

/** gamePdrMyEvents {}: the school's official calendar for the next 14 days (titles and times only), the same events the teacher
 *  portal's Upcoming events card shows. */
function pdrGameMyEvents_(c) {
  const out = myUpcomingEvents_({ email: c.email, campusId: c.campusId });
  if (!out.success) return out;
  return { success: true, data: { events: out.events } };
}
