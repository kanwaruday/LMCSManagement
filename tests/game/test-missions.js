// node tests/game/test-missions.js -- Principal / Coordinator / Owner mission adapters, scope, done detection, role dispatch
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const ctx = { console };
vm.createContext(ctx);
// either order must work in Apps Script; the test loads game.gs first, then the missions file
for (const f of ['game.gs', 'game-actions.gs', 'game-missions.gs', 'game-windows.gs']) vm.runInContext(fs.readFileSync(__dirname + '/../../apps-script/' + f, 'utf8'), ctx);
const J = (x) => JSON.parse(JSON.stringify(x)); // plain objects out of the vm realm

const now = new Date('2026-10-27T05:00:00Z'); // Tue 27 Oct, 10:30 IST; game day 2026-10-27
const ago = (days) => new Date(now.getTime() - days * 86400000).toISOString();
const cfg = (over) => Object.assign(ctx.gameParseConfig_([['Key', 'Value']]), over || {});
const kinds = (ms, k) => ms.filter((m) => m.kind === k);

// ── fixture builders (column positions from the plan) ──────────────────
const apr = (id, campus, status, o) => { // Approvals: id 0, campus 1, category 2, title 4, requestedBy 11, requestedAt 12, status 13, decidedBy 14, decidedAt 15, archived 18
  o = o || {}; const r = new Array(19).fill('');
  r[0] = id; r[1] = campus; r[2] = 'Other'; r[4] = o.title || ('Title ' + id); r[11] = o.by || 'x@lms.org.in'; r[12] = o.at || ago(4);
  r[13] = status; r[14] = o.decidedBy || ''; r[15] = o.decidedAt || ''; r[18] = o.archived || ''; return r;
};
const APR_H = ['id'];
const rec = (id, approvalId, by, what, reason, at, superseded) => [id, approvalId, 'LMS4', 'Other', by, what, reason, '', at, superseded || ''];
const REC_H = ['RecId'];
const task = (id, domain, campus, title, o) => { // Tasks: TaskId 0, Domain 1, Campus 2, Title 3, Detail 4, Status 5, ResolvedAt 9, ResolvedBy 10, Assignee 13, Due 14
  o = o || {}; const r = new Array(15).fill('');
  r[0] = id; r[1] = domain; r[2] = campus; r[3] = title; r[4] = o.detail || ''; r[5] = o.status || 'open'; r[9] = o.resolvedAt || ''; r[10] = o.resolvedBy || ''; r[13] = o.assignee || ''; r[14] = o.due || ''; return r;
};
const TASK_H = ['TaskId'];
const ssFix = (callerToday) => ({ roles: { Teacher: { quotaPerMonth: 2, roster: [
  { school: 'LMS 4', submissionsThisMonth: 1, history: callerToday || [] },   // needs 1
  { school: 'LMS 4', submissionsThisMonth: 1, history: [] },                  // needs 1
  { school: 'LMS 4', submissionsThisMonth: 0, history: [] },                  // needs 2
  { school: 'LMS 4', submissionsThisMonth: 2, history: [] },                  // met
  { school: 'LMS 5', submissionsThisMonth: 0, history: [] },                  // other campus: ignored
] } } });
const principal = { email: 'p@lms.org.in', campusId: 'LMS4', roles: ['Principal'], primaryRole: 'Principal', canDecide: false };
const coord = { email: 'c@lms.org.in', campusId: 'ALL', roles: ['Coordinator'], primaryRole: 'Coordinator', canDecide: false };
const owner = { email: 'o@lms.org.in', campusId: 'ALL', roles: ['Owner'], primaryRole: 'Owner', canDecide: true };

// ── pace target: ceil(needed / working days left incl. today, Mon-Sat) ──
assert.strictEqual(ctx.gameSsPaceTarget_(0, now), 0);
assert.strictEqual(ctx.gameSsPaceTarget_(4, now), 1);                                   // Tue-Sat left = 5 days
assert.strictEqual(ctx.gameSsPaceTarget_(11, now), 3);
assert.strictEqual(ctx.gameSsPaceTarget_(3, new Date('2026-10-31T05:00:00Z')), 3);     // Sat 31 Oct: today is the last day
assert.strictEqual(ctx.gameSsPaceTarget_(3, new Date('2026-11-29T05:00:00Z')), 3);     // Sun 29 Nov: only Mon 30 Nov is left

// ── Principal LMS4 ─────────────────────────────────────────────────────
let src = { ss: ssFix(), reports: [['Timestamp']], approvals: [APR_H], issues: { issues: [] } };
let ms = ctx.gamePrincipalMissions_(principal, src, cfg(), now);
const ssm = kinds(ms, 'ss_pace');
assert.strictEqual(ssm.length, 1);
assert.strictEqual(ssm[0].core, true);                                   // from cfg.core.Principal
assert.strictEqual(ssm[0].done, false);
assert.deepStrictEqual(J(ssm[0].progress), { done: 0, total: 1 });       // needed 4 over 5 days
assert.strictEqual(ssm[0].id, 'ss_pace:LMS4:2026-10-27');                // day-scoped: tomorrow's target is a new mission (C1)
assert.strictEqual(ssm[0].go, 'principal/support-sessions.html');
assert.strictEqual(ssm[0].title, 'Submit 1 SS evaluation today');      // verb first, no speed language (R30)
assert.strictEqual(ssm[0].why, '4 still needed for October');
assert.strictEqual(ctx.gameSsSubmittedBy_(src.ss, 'p@lms.org.in', '2026-10-27'), 0);
// today's submissions by this evaluator count toward the target (given the day's starting need), other days and people do not
const today = ago(0.01), yesterdayTs = ago(1);
const h = (email, ts) => ({ evaluatorEmail: email, timestamp: ts });
src = { ss: ssFix([h('p@lms.org.in', today), h('P@lms.org.in', today), h('p@lms.org.in', yesterdayTs), h('q@lms.org.in', today)]), reports: [['Timestamp']], approvals: [APR_H], issues: null };
assert.strictEqual(ctx.gameSsSubmittedBy_(src.ss, 'p@lms.org.in', '2026-10-27'), 2);
const ssDone = kinds(ctx.gamePrincipalMissions_(principal, src, cfg(), now), 'ss_pace')[0];
assert.strictEqual(ssDone.done, true);                                   // start-of-day need 4+2=6 over 5 days -> target 2, two logged
assert.deepStrictEqual(J(ssDone.progress), { done: 2, total: 2 });
assert.strictEqual(ssDone.doneBy, 'p@lms.org.in');
// nobody short: no ss_pace; a source that did not load (null) makes no mission either
const allMet = { roles: { Teacher: { quotaPerMonth: 2, roster: [{ school: 'LMS 4', submissionsThisMonth: 2, history: [] }] } } };
assert.strictEqual(kinds(ctx.gamePrincipalMissions_(principal, { ss: allMet, reports: null, approvals: null, issues: null }, cfg(), now), 'ss_pace').length, 0);
assert.deepStrictEqual(J(ctx.gamePrincipalMissions_(principal, { ss: null, reports: null, approvals: null, issues: null }, cfg(), now)), []);

// daily report: pending until today's row for this campus exists; then done with its Timestamp
src = { ss: null, reports: [['Timestamp'], ['2026-10-27T03:00:00Z', '2026-10-26', 'LMS4', 'p@lms.org.in'], ['2026-10-27T03:00:00Z', '2026-10-27', 'LMS5', 'z@lms.org.in']], approvals: null, issues: null };
let pdr = kinds(ctx.gamePrincipalMissions_(principal, src, cfg(), now), 'pdr_report');
assert.strictEqual(pdr.length, 1); assert.strictEqual(pdr[0].done, false); assert.strictEqual(pdr[0].id, 'pdr_report:LMS4:2026-10-27');
src.reports.push(['2026-10-27T04:30:00Z', '2026-10-27', 'LMS4', 'p@lms.org.in']);
pdr = kinds(ctx.gamePrincipalMissions_(principal, src, cfg(), now), 'pdr_report');
assert.strictEqual(pdr.filter((m) => !m.done).length, 0);                // nothing pending any more
assert.strictEqual(pdr[0].done, true); assert.strictEqual(pdr[0].doneAt, '2026-10-27T04:30:00.000Z'); // done is read from the row, not ticked

// a Date cell in Daily Reports' Date column (Sheets turns '2026-10-27' into midnight IST) still matches the game day (M6)
src = { ss: null, reports: [['Timestamp'], ['2026-10-27T04:30:00Z', vm.runInContext("new Date('2026-10-26T18:30:00Z')", ctx), 'LMS4']], approvals: null, issues: null };
assert.strictEqual(kinds(ctx.gamePrincipalMissions_(principal, src, cfg(), now), 'pdr_report')[0].done, true);
// I4: Sunday (the IST game day) is the rest day: no ss_pace and no pdr_report, even at 02:30 IST on Monday (still Sunday's game day)
for (const sun of ['2026-11-01T05:00:00Z', '2026-11-01T21:00:00Z']) {
  const sm = ctx.gamePrincipalMissions_(principal, { ss: ssFix(), reports: [['Timestamp']], approvals: [APR_H], issues: null }, cfg(), new Date(sun));
  assert.strictEqual(kinds(sm, 'ss_pace').length + kinds(sm, 'pdr_report').length, 0, 'Sunday missions at ' + sun);
}
const mon = ctx.gamePrincipalMissions_(principal, { ss: ssFix(), reports: [['Timestamp']], approvals: [APR_H], issues: null }, cfg(), new Date('2026-11-01T23:00:00Z')); // Mon 04:30 IST
assert.strictEqual(kinds(mon, 'ss_pace').length + kinds(mon, 'pdr_report').length, 2);

// Info Requested: only the caller's own request
src = { ss: null, reports: null, approvals: [APR_H, apr('i1', 'LMS4', 'Info Requested', { by: 'p@lms.org.in' }), apr('i2', 'LMS4', 'Info Requested', { by: 'other@lms.org.in' }), apr('i3', 'LMS4', 'Pending', { by: 'p@lms.org.in' })], issues: null };
const info = kinds(ctx.gamePrincipalMissions_(principal, src, cfg(), now), 'info_requested');
assert.deepStrictEqual(J(info.map((m) => m.id)), ['info_requested:i1']);

// daily-report issues: off until principalIssuesReady; reopened counts as open; resolved is not pending
const issues = { issues: [
  { id: 'a1', campus: 'LMS4', subject: 'Water supply', status: 'open' },
  { id: 'a2', campus: 'LMS4', subject: 'Bus late', status: 'reopened' },
  { id: 'a3', campus: 'LMS4', subject: 'Old', status: 'resolved', resolvedAt: ago(30), resolvedBy: 'p@lms.org.in' },
  { id: 'a4', campus: 'LMS5', subject: 'Elsewhere', status: 'open' }] };
src = { ss: null, reports: null, approvals: null, issues: issues };
assert.strictEqual(kinds(ctx.gamePrincipalMissions_(principal, src, cfg({ principalIssuesReady: false }), now), 'pdr_issue').length, 0);
const iss = kinds(ctx.gamePrincipalMissions_(principal, src, cfg({ principalIssuesReady: true }), now), 'pdr_issue');
assert.strictEqual(iss.length, 2);
assert.ok(iss.every((m) => m.core === true && m.done === false && m.go === 'principal/issues.html'));
issues.issues[0].status = 'resolved'; issues.issues[0].resolvedAt = ago(0.1); issues.issues[0].resolvedBy = 'p@lms.org.in';
const iss2 = kinds(ctx.gamePrincipalMissions_(principal, src, cfg({ principalIssuesReady: true }), now), 'pdr_issue');
assert.strictEqual(iss2.filter((m) => m.done).length, 1);                // resolved today -> done (resolvedAt/By)
assert.strictEqual(iss2.find((m) => m.done).doneBy, 'p@lms.org.in');

// ── scope: Principal sees own campus and own requests only; Coordinator and Owner see every campus ──
const lms2 = apr('s2', 'LMS2', 'Pending', { at: ago(5) });
const aprRows = [APR_H, lms2, apr('s4', 'LMS4', 'Pending', { at: ago(5) }), apr('s5', 'LMS5', 'Pending', { at: ago(5) })];
const waitIds = (c) => J(kinds(ctx.gameMissionsFor_(c, { approvals: aprRows, recommendations: [REC_H], tasks: [TASK_H] }, cfg({ recommendationsReady: true }), now), c.primaryRole === 'Owner' ? 'approval_wait' : 'approval_recommend').map((m) => m.id));
assert.deepStrictEqual(waitIds(coord), ['approval_recommend:s2', 'approval_recommend:s4', 'approval_recommend:s5']);
assert.deepStrictEqual(waitIds(owner), ['approval_wait:s2', 'approval_wait:s4', 'approval_wait:s5']);
const pScope = [APR_H, apr('p5', 'LMS5', 'Info Requested', { by: 'someone@lms.org.in' }), apr('p4', 'LMS4', 'Info Requested', { by: 'p@lms.org.in' }), apr('p2', 'LMS2', 'Pending', { by: 'someone@lms.org.in', at: ago(9) })];
const pm = ctx.gameMissionsFor_(principal, { ss: null, reports: null, approvals: pScope, issues: null }, cfg(), now);
assert.deepStrictEqual(J(pm.map((m) => m.id)), ['info_requested:p4']);   // another campus's request never reaches LMS4; the own one does

// an all-campus Principal has no campus: no campus-bound missions, only their own Info Requested
const pAll = { email: 'pa@lms.org.in', campusId: 'ALL', roles: ['Principal'], primaryRole: 'Principal', canDecide: false };
const allSrc = { ss: ssFix(), reports: [['Timestamp']], approvals: [APR_H, apr('q1', 'LMS5', 'Info Requested', { by: 'pa@lms.org.in' }), apr('q2', 'LMS5', 'Info Requested', { by: 'z@lms.org.in' })], issues: issues };
const pa = ctx.gameMissionsFor_(pAll, allSrc, cfg({ principalIssuesReady: true }), now);
assert.deepStrictEqual(J(pa.map((m) => m.id)), ['info_requested:q1']);

// ── Coordinator: approval_recommend ────────────────────────────────────
const csrc = (approvals, recs, tasks) => ({ approvals: [APR_H].concat(approvals), recommendations: [REC_H].concat(recs || []), tasks: [TASK_H].concat(tasks || []) });
const cm = (src, c, over) => ctx.gameCoordinatorMissions_(c || coord, src, cfg(over), now);
assert.strictEqual(kinds(cm(csrc([apr('r1', 'LMS4', 'Pending')]), coord, { recommendationsReady: false }), 'approval_recommend').length, 0);
let ar = kinds(cm(csrc([apr('r1', 'LMS4', 'Pending')]), coord, { recommendationsReady: true }), 'approval_recommend');
assert.strictEqual(ar.length, 1); assert.strictEqual(ar[0].core, true); assert.strictEqual(ar[0].done, false);
assert.strictEqual(ar[0].shared, true);                                   // no matching Tasks row assigned to the caller
assert.strictEqual(ar[0].go, 'coordinator/hq.html#d=r1');   // cfg.recommendGo + the request (opens the form on it)
assert.strictEqual(kinds(cm(csrc([apr('r1', 'LMS4', 'Pending')]), coord, { recommendationsReady: true, recommendGo: 'x/y.html' }), 'approval_recommend')[0].go, 'x/y.html#d=r1');
ar = kinds(cm(csrc([apr('r1', 'LMS4', 'Pending')], [], [task('approval|r1|Pending', 'approval', 'LMS4', 'x', { assignee: 'c@lms.org.in' })]), coord, { recommendationsReady: true }), 'approval_recommend');
assert.strictEqual(ar[0].shared, false);                                  // the caller is assigned: personal credit
assert.strictEqual(kinds(cm(csrc([apr('r2', 'LMS4', 'Pending', { at: ago(2) })]), coord, { recommendationsReady: true }), 'approval_recommend').length, 0); // 2 days: too young
assert.strictEqual(kinds(cm(csrc([apr('r3', 'LMS4', 'Pending', { archived: 'TRUE' })]), coord, { recommendationsReady: true }), 'approval_recommend').length, 0);
// recommended with a reason -> done by the recommender; a blank reason is not done
const recDone = kinds(cm(csrc([apr('r1', 'LMS4', 'Pending')], [rec('x1', 'r1', 'c@lms.org.in', 'Approve', 'Fits the budget', ago(0.2))]), coord, { recommendationsReady: true }), 'approval_recommend')[0];
assert.strictEqual(recDone.done, true); assert.strictEqual(recDone.doneBy, 'c@lms.org.in'); assert.ok(recDone.doneAt);
assert.strictEqual(kinds(cm(csrc([apr('r1', 'LMS4', 'Pending')], [rec('x1', 'r1', 'c@lms.org.in', 'Approve', '', ago(0.2))]), coord, { recommendationsReady: true }), 'approval_recommend')[0].done, false);
// a superseded recommendation does not stand: the later one does
const sup = kinds(cm(csrc([apr('r1', 'LMS4', 'Pending')], [rec('x1', 'r1', 'd@lms.org.in', 'Approve', 'old', ago(1), 'TRUE'), rec('x2', 'r1', 'c@lms.org.in', 'Reject', 'new', ago(0.5))]), coord, { recommendationsReady: true }), 'approval_recommend')[0];
assert.strictEqual(sup.doneBy, 'c@lms.org.in');
// the Owner decided first, with no recommendation: gone, not done
const goneA = kinds(cm(csrc([apr('r1', 'LMS4', 'Approved', { decidedBy: 'o@lms.org.in', decidedAt: ago(0.3) })]), coord, { recommendationsReady: true }), 'approval_recommend')[0];
assert.strictEqual(goneA.gone, true); assert.strictEqual(goneA.done, false);

// ── Owner: approval_wait ───────────────────────────────────────────────
const om = (src, over) => ctx.gameOwnerMissions_(owner, src, cfg(over), now);
let aw = kinds(om(csrc([apr('r1', 'LMS4', 'Pending')], [rec('x1', 'r1', 'c@lms.org.in', 'Approve', 'Fits the budget', ago(0.2))]), { recommendationsReady: true }), 'approval_wait');
assert.strictEqual(aw.length, 1); assert.strictEqual(aw[0].core, true); assert.strictEqual(aw[0].done, false);
assert.ok(/approve/i.test(aw[0].why) && aw[0].why.includes('c@lms.org.in'));
assert.strictEqual(aw[0].title, 'Decide the LMS 4 request \u201cTitle r1\u201d');
assert.strictEqual(aw[0].go, 'coordinator/systems/index.html#approvals'); // I1 // campus as "LMS 4", verb first (R30)
assert.strictEqual(kinds(om(csrc([apr('r1', 'LMS4', 'Pending')], [rec('x1', 'r1', 'c@lms.org.in', 'Approve', 'ok', ago(0.2))]), { recommendationsReady: false }), 'approval_wait')[0].why, 'Waiting 4 days'); // tab not ready: no recommendation, the wait instead
assert.strictEqual(kinds(om(csrc([apr('r1', 'LMS4', 'Pending', { archived: 'TRUE' })])), 'approval_wait').length, 0);
assert.strictEqual(kinds(om(csrc([apr('r2', 'LMS4', 'Pending', { at: ago(2) })])), 'approval_wait').length, 0);
// done detection: decided by a@lms.org.in at T
const T = ago(0.4);
const dec = kinds(om(csrc([apr('d1', 'LMS4', 'Approved', { at: ago(6), decidedBy: 'a@lms.org.in', decidedAt: T })])), 'approval_wait')[0];
assert.strictEqual(dec.done, true); assert.strictEqual(dec.doneBy, 'a@lms.org.in'); assert.strictEqual(dec.doneAt, T);
assert.strictEqual(kinds(om(csrc([apr('d2', 'LMS4', 'Rejected', { at: ago(6), decidedBy: 'a@lms.org.in', decidedAt: ago(20) })])), 'approval_wait').length, 0); // decided long ago: not today's story
assert.strictEqual(kinds(om(csrc([apr('d3', 'LMS4', 'Revoked', { at: ago(6), decidedBy: 'a@lms.org.in', decidedAt: T })])), 'approval_wait')[0].done, true);

// ── Coordinator: Tasks ─────────────────────────────────────────────────
const tk = cm(csrc([], [], [
  task('hs1', 'hiring_stall', 'LMS4', 'Hiring stalled for Maths PGT'),
  task('f1', 'transport', 'LMS5', 'Fix the route', {}),                                        // blank assignee
  task('f2', 'transport', 'LMS6', 'Renew permit', { assignee: 'c@lms.org.in', due: '2026-10-30' }),
  task('f3', 'transport', 'LMS6', 'Someone else', { assignee: 'z@lms.org.in' }),              // another person's: not this mission list
  task('f4', 'transport', 'LMS6', 'Old', { status: 'resolved', resolvedAt: ago(40), resolvedBy: 'c@lms.org.in' }),
]), coord);
const byId = {}; tk.forEach((m) => { byId[m.id] = m; });
assert.strictEqual(byId['hiring_stall:hs1'].shared, true); assert.strictEqual(byId['hiring_stall:hs1'].core, true);
assert.strictEqual(byId['followup:f1'].shared, true); assert.strictEqual(byId['followup:f1'].core, false);
assert.strictEqual(byId['followup:f2'].shared, false); assert.strictEqual(byId['followup:f2'].due, '2026-10-30');
// a Date cell in Due (midnight IST) reads as its IST date, not the UTC day before (M6)
const dueDate = cm(csrc([], [], [task('f7', 'transport', 'LMS6', 'Dated', { assignee: 'c@lms.org.in', due: vm.runInContext("new Date('2026-10-29T18:30:00Z')", ctx) })]), coord);
assert.strictEqual(dueDate[0].due, '2026-10-30');
// a stray space around the approval's Tasks id still finds its assignee (M11)
const spaced = kinds(cm(csrc([apr('r1', 'LMS4', 'Pending')], [], [task(' approval|r1|Pending ', 'approval', 'LMS4', 'x', { assignee: 'c@lms.org.in' })]), coord, { recommendationsReady: true }), 'approval_recommend');
assert.strictEqual(spaced[0].shared, false);
assert.ok(!byId['followup:f3'] && !byId['followup:f4']);
// resolved by a person: done; resolved by the system: not done, gone ("no longer needed")
const rs = cm(csrc([], [], [
  task('f5', 'transport', 'LMS5', 'Cleared by hand', { assignee: 'c@lms.org.in', status: 'resolved', resolvedAt: ago(0.2), resolvedBy: 'c@lms.org.in' }),
  task('f6', 'transport', 'LMS5', 'Cleared itself', { assignee: 'c@lms.org.in', status: 'resolved', resolvedAt: ago(0.2), resolvedBy: 'system (condition cleared)' })]));
const rsBy = {}; rs.forEach((m) => { rsBy[m.id] = m; });
assert.strictEqual(rsBy['followup:f5'].done, true); assert.strictEqual(rsBy['followup:f5'].doneBy, 'c@lms.org.in');
assert.strictEqual(rsBy['followup:f6'].done, false); assert.strictEqual(rsBy['followup:f6'].gone, true);
// the approval's own auto task is not a second card once approval_recommend covers it
const dup = cm(csrc([apr('r1', 'LMS4', 'Pending')], [], [task('approval|r1|Pending', 'approval', 'LMS4', 'wait')]), coord, { recommendationsReady: true });
assert.strictEqual(kinds(dup, 'followup').length, 0);
assert.strictEqual(kinds(cm(csrc([], [], [task('approval|r1|Pending', 'approval', 'LMS4', 'wait')]), coord, { recommendationsReady: false }), 'followup').length, 1);

// ── roles ──────────────────────────────────────────────────────────────
assert.deepStrictEqual(J(ctx.gameMissionsFor_({ email: 'f@lms.org.in', campusId: 'LMS4', roles: ['FeeClerk'], primaryRole: 'FeeClerk' }, {}, cfg(), now)), { notYet: true });
const teacher = { email: 't@lms.org.in', campusId: 'LMS4', roles: ['Teacher'], primaryRole: 'Teacher', canDecide: false };
assert.deepStrictEqual(J(ctx.gameMissionsFor_(teacher, {}, cfg(), now)), { notYet: true }); // nothing registered
vm.runInContext("GAME_MODULE_MISSIONS.Teacher = function (caller, cfg, now) { return [{ id: 'log:t1', kind: 'log', progress: { done: 2, total: 4 }, done: false }]; };", ctx);
const tm = J(ctx.gameMissionsFor_(teacher, {}, cfg(), now));
assert.strictEqual(tm.length, 1); assert.deepStrictEqual(tm[0].progress, { done: 2, total: 4 });
assert.strictEqual(typeof ctx.gameMissionsFor_(owner, { approvals: [APR_H], recommendations: [REC_H] }, cfg(), now).length, 'number'); // dispatch by primary role: Owner

// several modules per role: a Coordinator's module missions join the built-ins; an array registers two; a throwing module is skipped and named in `down`
{ const csrc0 = { approvals: [APR_H], recommendations: [REC_H], tasks: [TASK_H] };
  const base = ctx.gameMissionsFor_(coord, csrc0, cfg(), now).length;
  vm.runInContext("GAME_MODULE_MISSIONS.Coordinator = [].concat(GAME_MODULE_MISSIONS.Coordinator || [], function fleetA_() { return [{ id: 'fleet_papers:HP1', kind: 'fleet_papers', done: false }]; });", ctx);
  vm.runInContext("GAME_MODULE_MISSIONS.Coordinator = [].concat(GAME_MODULE_MISSIONS.Coordinator || [], function boom_() { throw new Error('x'); }, function fleetB_() { return { notYet: true }; });", ctx);
  const down = [], got = J(ctx.gameMissionsFor_(coord, csrc0, cfg(), now, down));
  assert.strictEqual(got.length, base + 1);
  assert.strictEqual(got[got.length - 1].id, 'fleet_papers:HP1');
  assert.deepStrictEqual(J(down), ['module boom_']);
  assert.strictEqual(ctx.gameMissionsFor_(coord, csrc0, cfg(), now).length, base + 1, 'down is optional');
  vm.runInContext("delete GAME_MODULE_MISSIONS.Coordinator;", ctx); }

// ── shape and copy ─────────────────────────────────────────────────────
const sample = cm(csrc([apr('r1', 'LMS4', 'Pending')], [], [task('f1', 'transport', 'LMS5', 'Fix the route')]), coord, { recommendationsReady: true });
sample.forEach((m) => {
  ['id', 'kind', 'title', 'why', 'owner', 'campus', 'go', 'due', 'core', 'shared', 'done', 'doneAt', 'doneBy', 'rolledOver', 'gone'].forEach((k) => assert.ok(k in m, 'missing ' + k));
  assert.ok(m.id.startsWith(m.kind + ':'));
  assert.ok(!/\b(he|she|his|her|hers|him)\b/i.test(m.title), 'no pronouns: ' + m.title);
});

// R30 / B5: the copy, verb first, campus as "LMS 4", dates as "Mon 26 Oct", no codes, no speed language
const TT = (k, d) => ctx.gameTitle_(k, d);
assert.strictEqual(TT('ss_pace', { needed: 6, target: 2 }), 'Submit 2 SS evaluations today');
assert.strictEqual(TT('pdr_report', { campus: 'LMS4', date: '2026-10-27', today: '2026-10-27' }), "Submit today's daily report");
assert.strictEqual(TT('pdr_report', { campus: 'LMS4', date: '2026-10-26', today: '2026-10-27' }), 'Submit the daily report for Mon 26 Oct');
assert.strictEqual(TT('pdr_issue', { title: 'Fan not working in Room 3' }), 'Close the issue “Fan not working in Room 3”');
assert.strictEqual(TT('info_requested', { title: 'Class 5 nature walk' }), 'Reply to Management about “Class 5 nature walk”');
assert.strictEqual(TT('approval_recommend', { campus: 'LMS4', days: 4, title: 'Purchase' }), 'Recommend on the LMS 4 request “Purchase”');
assert.strictEqual(TT('approval_wait', { campus: '', days: 4, title: '' }), 'Decide the request');
assert.strictEqual(TT('hiring_stall', { title: 'TGT English' }), 'Move hiring forward on “TGT English”');
assert.strictEqual(TT('followup', { title: 'Bus 3 route' }), 'Resolve the follow-up “Bus 3 route”');
assert.strictEqual(ctx.gameCampusLabel_('LMS4'), 'LMS 4');
assert.strictEqual(ctx.gameWaiting_(1), 'Waiting 1 day');
assert.strictEqual(ctx.gameRaised_('2026-10-26T09:00:00+05:30', '2026-10-27'), 'raised yesterday');
assert.strictEqual(ctx.gameRaised_('2026-10-27', '2026-10-27'), 'raised today');
assert.strictEqual(ctx.gameRaised_('2026-10-20', '2026-10-27'), 'raised Tue 20 Oct');
assert.strictEqual(ctx.gameRaised_('', '2026-10-27'), '');
// every adapter title is free of ISO dates and campus codes
const copyMs = ctx.gamePrincipalMissions_(principal, { ss: ssFix(), reports: [['Timestamp']], approvals: [APR_H], issues: { issues: [] } }, cfg(), now);
copyMs.forEach((m) => { assert.ok(!/\d{4}-\d{2}-\d{2}|LMS\d/.test(m.title), 'no codes in title: ' + m.title); });
assert.strictEqual(kinds(copyMs, 'pdr_report')[0].title, "Submit today's daily report");
console.log('game missions: ok');

// ── follow-up skip registry (game director's contract, Fleet Operations): a domain a module lists in GAME_FOLLOWUP_SKIP makes no generic follow-up ──
{
  const T = [task('s1', 'gps_dead', 'LMS4', 'TEST01: tracker silent', { assignee: 'c@lms.org.in' }), task('s2', 'transport', 'LMS4', 'Other domain', { assignee: 'c@lms.org.in' }),
    task('s3', 'bus_speed', 'LMS4', 'TEST01: fast', { status: 'resolved', resolvedAt: ago(0.2), resolvedBy: 'c@lms.org.in' })];
  const ids = () => cm(csrc([], [], T), coord).filter((m) => m.kind === 'followup').map((m) => m.id).sort();
  assert.deepStrictEqual(J(ids()), ['followup:s1', 'followup:s2', 'followup:s3'], 'no registry entry: every follow-up is generic (as before)');
  assert.strictEqual(vm.runInContext('typeof GAME_FOLLOWUP_SKIP', ctx), 'object', 'declared next to the other registries');
  vm.runInContext("GAME_FOLLOWUP_SKIP.fleet = ['gps_dead','bus_speed']", ctx);
  assert.deepStrictEqual(J(ids()), ['followup:s2'], 'a registered domain makes no generic follow-up (open or resolved); other domains are unchanged');
  vm.runInContext("GAME_FOLLOWUP_SKIP.other = 'transport'; GAME_FOLLOWUP_SKIP.bad = null", ctx);
  assert.deepStrictEqual(J(ids()), [], 'every registered list is collected at call time (a string or a null entry is tolerated)');
  vm.runInContext('GAME_FOLLOWUP_SKIP = undefined', ctx);
  assert.deepStrictEqual(J(ids()), ['followup:s1', 'followup:s2', 'followup:s3'], 'a missing registry is fine');
  vm.runInContext('GAME_FOLLOWUP_SKIP = {}', ctx);
  console.log('game followup skip: ok');
}
