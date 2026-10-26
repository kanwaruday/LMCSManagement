// ═══════════════════════════════════════════════════════════════════
// Coordinator Backend -- the Principals' daily-report issues (same "LMCS Coordinator Backend" project as coordinator.gs).
// Uday, 2026-10-25: "the Principal closes each with an outcome note; the Coordinator sees every closure and can reopen."
//
// The only place a Principal gets into this backend. coordVerifyPrincipal_ is its own gate, used by these two actions only;
// coordVerifyCaller_ still returns null for a Principal, so every other action stays shut to them.
//   GET  action=principalissues        Coordinator / Owner (every visible campus) or a Principal (own campus), read-only
//   POST action=principalissueresolve  a Principal closes an issue of their own campus with an outcome note
// A Coordinator reopens through coordinatorpdrissue {status: 'reopened', note} (coordinator-pdr.gs).
// ═══════════════════════════════════════════════════════════════════

/** Verified Google ID token -> {email, campusId, principal: true}, or null unless the allowlist gives the caller the
 *  Principal role and exactly one campus code (not ALL, not a list). Cached 5 min under its own key prefix, so it never
 *  feeds coordVerifyCaller_'s cache. */
function coordVerifyPrincipal_(idToken) {
  if (!idToken) return null;
  const cache = CacheService.getScriptCache();
  const key = 'coordprin_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, idToken));
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  try {
    const email = coordTokenEmail_(idToken);
    if (!email) return null;
    const rows = SpreadsheetApp.openById(COORD_ALLOWLIST_SHEET_ID).getSheets()[0].getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0] || '').trim().toLowerCase() !== email) continue;
      const roles = String(rows[i][3] || '').split(',').map(function (r) { return r.trim(); });
      const campusId = String(rows[i][2] || '').trim().toUpperCase();
      if (roles.indexOf('Principal') === -1 || !/^LMS[1-6]$/.test(campusId)) return null;
      const principal = { email: email, campusId: campusId, principal: true };
      cache.put(key, JSON.stringify(principal), 300);
      return principal;
    }
    return null;
  } catch (err) {
    return null;
  }
}

/** Display-value rows of the PDR Issues, Issue Actions and Issue Merges tabs (headers dropped) -> the issues of `campus`
 *  (null = every campus). Merged-away issues fold into their target the way the Systems page does (coordinator/shared.js):
 *  counts add, a day both were mentioned counts once. Each issue's status is its own action row's, else 'open'; an action
 *  for an id the Issues tab no longer has is never returned. A resolved or acknowledged issue mentioned again after its
 *  action (last > 'Last mention when updated', as the Systems page reopens it) is 'open' with raisedAgain: true.
 *  viewer = a Principal's email: they get only the notes addressed to them (a reopen reason, or their own closure note),
 *  since the rest were written as "Coordinator view only". null = a Coordinator or the Owner, who get every note. */
function coordPrincipalIssues_(issueRows, actionRows, mergeRows, campus, viewer) {
  const byId = {}, acts = {}, rootOf = coordPdrRootOf_(mergeRows);
  issueRows.forEach(function (r) {
    byId[r[0]] = { id: r[0], subject: r[3], campus: r[1], first: r[4], last: r[5], count: +r[6], needsAction: r[7] === 'yes', days: JSON.parse(r[8] || '[]').map(function (x) { return x.date; }) };
  });
  actionRows.forEach(function (a) { acts[a[0]] = a; });
  const kept = [];
  Object.keys(byId).forEach(function (id) {
    const i = byId[id], t = byId[rootOf(id)];
    if (!t || t === i) { kept.push(i); return; }
    t.count += i.count - i.days.filter(function (d) { return t.days.indexOf(d) !== -1; }).length;
    if (i.first < t.first) t.first = i.first;
    if (i.last > t.last) { t.last = i.last; t.needsAction = i.needsAction; }
  });
  return kept.filter(function (i) { return !campus || i.campus === campus; }).map(function (i) {
    const a = acts[i.id] || [], raisedAgain = (a[1] === 'resolved' || a[1] === 'acknowledged') && i.last > String(a[8] || '');
    const status = raisedAgain ? 'open' : a[1] || 'open', resolvedBy = status === 'resolved' ? a[5] || '' : '';
    const noteOk = !viewer || status === 'reopened' || (status === 'resolved' && String(resolvedBy).toLowerCase() === viewer);
    return { id: i.id, subject: i.subject, campus: i.campus, first: i.first, last: i.last, count: i.count, needsAction: i.needsAction,
      status: status, assignee: a[2] || '', resolvedBy: resolvedBy, resolvedAt: status === 'resolved' ? String(a[6] || '').slice(0, 10) : '', note: noteOk ? a[4] || '' : '', raisedAgain: raisedAgain };
  });
}

function coordPrincipalTab_(ss, name) {
  const sh = ss.getSheetByName(name);
  return sh && sh.getLastRow() > 1 ? sh.getDataRange().getDisplayValues().slice(1) : [];
}

/** GET action=principalissues: the Coordinator / Owner gate first (their visible campuses, campus 'ALL'), then the Principal gate (own campus). */
function coordPrincipalIssuesGet_(idToken) {
  const caller = coordVerifyCaller_(idToken);
  let visible = null, campus = null, viewer = null;
  if (caller && !caller.feeClerkOnly) visible = coordVisibleCampuses_(caller);
  else {
    const principal = coordVerifyPrincipal_(idToken);
    if (!principal) return { success: false, error: 'Not authorized' };
    campus = principal.campusId;
    viewer = principal.email;
  }
  const ss = SpreadsheetApp.openById(COORD_PDR_SHEET_ID);
  const issues = coordPrincipalIssues_(coordPrincipalTab_(ss, COORD_PDR_ISSUES_TAB), coordPrincipalTab_(ss, COORD_PDR_ACTIONS_TAB), coordPrincipalTab_(ss, COORD_PDR_MERGES_TAB), campus, viewer)
    .filter(function (i) { return !visible || visible.indexOf(i.campus) !== -1; });
  return { success: true, campus: campus || 'ALL', issues: issues, pushedAt: coordPdrPushedAt_(ss.getSheetByName(COORD_PDR_ISSUES_TAB)) };
}

/** POST action=principalissueresolve {idToken, id, note}. principal = coordVerifyPrincipal_'s result. Writes nothing on a refusal. */
function coordPrincipalResolve_(principal, body) {
  if (!principal) return { success: false, error: 'Not authorized' };
  const id = String(body.id || ''), note = String(body.note || '').trim().slice(0, 500);
  const ss = SpreadsheetApp.openById(COORD_PDR_SHEET_ID);
  const issue = coordPrincipalTab_(ss, COORD_PDR_ISSUES_TAB).filter(function (r) { return r[0] === id; })[0];
  if (!issue) return { success: false, error: 'This issue was regrouped by the latest sync; refresh the page' };
  if (issue[1] !== principal.campusId) return { success: false, error: 'Not authorized' };
  if (!note) return { success: false, error: 'Write what was done to close this.' };
  coordPdrWriteAction_(ss, [id, 'resolved', '', '', note, principal.email, new Date().toISOString().slice(0, 16).replace('T', ' '), issue[1], coordPdrMergedLastIn_(ss, id)]);
  let taskError = '';
  try { coordPdrSyncTask_(issue, 'resolved', null, principal, note); } catch (err) { taskError = err.message; } // the closure is saved either way
  return { success: true, taskError: taskError };
}
