// node tests/game/test-quests.js -- Quest 1 state: evidence, sticky steps, hidden pdr_issue, unlock order
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const ctx = { console };
vm.createContext(ctx);
for (const f of ['game.gs', 'game-actions.gs', 'game-missions.gs', 'game-windows.gs', 'game-quests.gs']) vm.runInContext(fs.readFileSync(__dirname + '/../../apps-script/' + f, 'utf8'), ctx);
const J = (x) => JSON.parse(JSON.stringify(x));

const QH = J(vm.runInContext('GAME_TABS', ctx)['Game Quests']);
assert.deepStrictEqual(QH, ['QuestId', 'Role', 'Title', 'UnlockAfter', 'StepsJson', 'Reward']);
const seeds = J(ctx.gameQuestSeedRows_());
assert.deepStrictEqual(seeds.map((r) => r[0] + '|' + r[1] + '|' + r[2] + '|' + r[3]), ['principal1|Principal|Your portal|', 'coordinator1|Coordinator|Your network|']);
assert.strictEqual(seeds[0][5], 'Quest badge: Your portal');
const stepsOf = (r) => JSON.parse(r[4]).map((s) => s.id + ':' + s.check.kind + ':' + s.check.count);
assert.deepStrictEqual(stepsOf(seeds[0]), ['report:pdr_report:1', 'ss:ss_submit:1', 'issue:pdr_issue:1', 'suit:decision:1']);
assert.deepStrictEqual(stepsOf(seeds[1]), ['recommend:approval_recommend:1', 'issueact:issue_action:1', 'followup:followup:1']);

const principalQ = (r2) => [QH, seeds[0], r2 || ['principal2', 'Principal', 'Quest Two', 'principal1', JSON.stringify([{ id: 'a', title: 'A', check: { kind: 'pdr_report', count: 2 } }]), 'Badge 2']];
const coordQ = [QH, seeds[1]];
const ME = 'Me@lms.org.in';
const ev = (o) => Object.assign({ missionsDoneByMe: [], ssByMe: 0, decisionsByMe: [], issueActionsByMe: 0, daysOnTrack: { onTrack: 0, counted: 0 } }, o);
const mis = (kind, o) => Object.assign({ id: kind + ':1', kind, done: true, doneBy: 'me@lms.org.in', shared: false }, o);
const PH = ['Email', 'Kind', 'Key', 'Value', 'At'];
const prog = (...keys) => [PH].concat(keys.map((k) => ['me@lms.org.in', 'quest_step', k, 'done', '2026-11-01T00:00:00Z']));
const cfgWith = (o) => Object.assign(J(ctx.gameConfigDefaults_()), o), ready = cfgWith({ principalIssuesReady: true }), notReady = cfgWith({ principalIssuesReady: false });
const state = (q, role, e, p, cfg) => J(ctx.gameQuestState_(q, role, e, p || [PH], ME, cfg || ready));
const done = (q) => q.steps.filter((s) => s.done).map((s) => s.id);

// one pdr_report done by me: step 1 done, the decision step not
let s = state(principalQ(), 'Principal', ev({ missionsDoneByMe: [mis('pdr_report')] }));
assert.strictEqual(s[0].questId, 'principal1');
assert.deepStrictEqual(done(s[0]), ['report']);
assert.strictEqual(s[0].steps.find((x) => x.id === 'suit').done, false);
assert.strictEqual(s[0].complete, false);
assert.ok(s[0].steps.every((x) => typeof x.title === 'string' && typeof x.go === 'string'));
// only the first 3 not-yet-done steps are open: with one done, all four show; with none done, the 4th is locked
assert.deepStrictEqual(s[0].steps.map((x) => x.locked), [false, false, false, false]);
assert.deepStrictEqual(state(principalQ(), 'Principal', ev())[0].steps.map((x) => x.locked), [false, false, false, true]);

// pdr_issue hidden (omitted) while not ready; and then step 4 moves up
s = state(principalQ(), 'Principal', ev(), null, notReady);
assert.deepStrictEqual(s[0].steps.map((x) => x.id), ['report', 'ss', 'suit']);
assert.deepStrictEqual(s[0].steps.map((x) => x.locked), [false, false, false]);
// hidden step doesn't block completion
s = state(principalQ(), 'Principal', ev({ missionsDoneByMe: [mis('pdr_report')], ssByMe: 1, decisionsByMe: [{ kind: 'decided', decidedBy: 'ME@lms.org.in' }] }), null, notReady);
assert.strictEqual(s[0].complete, true);

// sticky: done earlier, empty evidence today
s = state(principalQ(), 'Principal', ev(), prog('principal1:report', 'principal1:ss'));
assert.deepStrictEqual(done(s[0]), ['report', 'ss']);
// someone else's progress row does not count
s = state(principalQ(), 'Principal', ev(), [PH, ['other@lms.org.in', 'quest_step', 'principal1:report', 'done', '']]);
assert.deepStrictEqual(done(s[0]), []);

// evidence rules: other person's / shared / system / gone missions never count
s = state(principalQ(), 'Principal', ev({ missionsDoneByMe: [mis('pdr_report', { doneBy: 'x@lms.org.in' }), mis('pdr_issue', { shared: true }), mis('pdr_issue', { done: false })] }));
assert.deepStrictEqual(done(s[0]), []);
// ss: counts ssByMe; decision: only Kind 'decided' by me (override is not the Principal's step)
s = state(principalQ(), 'Principal', ev({ ssByMe: 1, decisionsByMe: [{ kind: 'override', decidedBy: 'me@lms.org.in' }, { kind: 'decided', decidedBy: 'x@lms.org.in' }] }));
assert.deepStrictEqual(done(s[0]), ['ss']);
s = state(principalQ(), 'Principal', ev({ decisionsByMe: [{ kind: 'decided', decidedBy: 'me@lms.org.in' }] }));
assert.deepStrictEqual(done(s[0]), ['suit']);

// Coordinator: system-resolved followup does not count; a real one does; issue_action counts the given number
s = state(coordQ, 'Coordinator', ev({ missionsDoneByMe: [mis('followup', { doneBy: 'system-autoclose' })], issueActionsByMe: 0 }));
assert.deepStrictEqual(done(s[0]), []);
s = state(coordQ, 'Coordinator', ev({ missionsDoneByMe: [mis('followup', { gone: true })] }));
assert.deepStrictEqual(done(s[0]), []);
s = state(coordQ, 'Coordinator', ev({ missionsDoneByMe: [mis('followup'), mis('approval_recommend')], issueActionsByMe: 2 }));
assert.deepStrictEqual(done(s[0]), ['recommend', 'issueact', 'followup']);
assert.strictEqual(s[0].complete, true);
// the Coordinator is unaffected by principalIssuesReady (issue_action is not pdr_issue)
assert.strictEqual(state(coordQ, 'Coordinator', ev(), null, notReady)[0].steps.length, 3);

// all done -> complete, next quest unlocks (later quests locked until then)
s = state(principalQ(), 'Principal', ev());
assert.strictEqual(s.length, 2);
assert.strictEqual(s[1].questId, 'principal2');
assert.ok(s[1].steps.every((x) => x.locked === true && x.done === false));
assert.strictEqual(s[1].complete, false);
s = state(principalQ(), 'Principal', ev({ missionsDoneByMe: [mis('pdr_report'), mis('pdr_issue')], ssByMe: 1, decisionsByMe: [{ kind: 'decided', decidedBy: 'me@lms.org.in' }] }));
assert.strictEqual(s[0].complete, true);
assert.ok(s[0].steps.every((x) => x.done && !x.locked));
assert.ok(s[1].steps.every((x) => x.locked === false));
// day_on_track counts daysOnTrack.onTrack
const dq = [QH, ['d1', 'Principal', 'D', '', JSON.stringify([{ id: 't', title: 'T', check: { kind: 'day_on_track', count: 3 } }]), '']];
assert.strictEqual(state(dq, 'Principal', ev({ daysOnTrack: { onTrack: 2 } }))[0].steps[0].done, false);
assert.strictEqual(state(dq, 'Principal', ev({ daysOnTrack: { onTrack: 3 } }))[0].steps[0].done, true);
// role filter; bad StepsJson row is skipped
assert.strictEqual(state(principalQ(), 'Coordinator', ev()).length, 0);
assert.strictEqual(state([QH, ['bad', 'Principal', 'X', '', '{nope', '']], 'Principal', ev()).length, 0);

// newly done: evidence-done steps not yet recorded, as {questId, stepId}
const nd = (q, role, e, p, cfg) => J(ctx.gameQuestNewlyDone_(q, role, e, p || [PH], ME, cfg || ready));
assert.deepStrictEqual(nd(principalQ(), 'Principal', ev({ missionsDoneByMe: [mis('pdr_report')], ssByMe: 1 }), prog('principal1:report')), [{ questId: 'principal1', stepId: 'ss' }]);
assert.deepStrictEqual(nd(principalQ(), 'Principal', ev(), prog('principal1:report')), []);
// a completed quest's steps are recorded too; the locked next quest's are not
// I1: where each step goes; every step carries its kind; a decision step has no link (the panel opens the decision card)
const goOf = (q, role, cfg) => Object.fromEntries(state(q, role, ev(), null, cfg)[0].steps.map((x) => [x.id, x.kind + ' ' + x.go]));
assert.deepStrictEqual(goOf(principalQ(), 'Principal'), { report: 'pdr_report principals-daily-reporting/index.html#principal', ss: 'ss_submit principal/support-sessions.html', issue: 'pdr_issue principal/issues.html', suit: 'decision ' });
assert.deepStrictEqual(goOf(coordQ, 'Coordinator'), { recommend: 'approval_recommend coordinator/hq.html', issueact: 'issue_action coordinator/systems/index.html', followup: 'followup coordinator/followups/index.html' });
assert.strictEqual(goOf(principalQ(), 'Principal', cfgWith({ principalIssuesReady: true, principalIssuesGo: 'p/i.html' })).issue, 'pdr_issue p/i.html');

const all = ev({ missionsDoneByMe: [mis('pdr_report'), mis('pdr_issue')], ssByMe: 1, decisionsByMe: [{ kind: 'decided', decidedBy: 'me@lms.org.in' }] });
assert.deepStrictEqual(nd(principalQ(), 'Principal', all).map((x) => x.stepId), ['report', 'ss', 'issue', 'suit', '_done']); // and the quest itself (M23)
// M23: a finished quest stays finished. Quest 1 completed while the issue step was hidden; once principalIssuesReady
// flips on, the recorded '_done' keeps it complete (every step shown done) and Quest 2 stays open
const hiddenDone = ev({ missionsDoneByMe: [mis('pdr_report')], ssByMe: 1, decisionsByMe: [{ kind: 'decided', decidedBy: 'me@lms.org.in' }] });
assert.deepStrictEqual(nd(principalQ(), 'Principal', hiddenDone, null, notReady).map((x) => x.stepId), ['report', 'ss', 'suit', '_done']);
s = state(principalQ(), 'Principal', ev(), prog('principal1:report', 'principal1:ss', 'principal1:suit', 'principal1:_done'), ready);
assert.strictEqual(s[0].complete, true);
assert.ok(s[0].steps.every((x) => x.done));
assert.ok(s[1].steps.every((x) => !x.locked));
assert.deepStrictEqual(nd(principalQ(), 'Principal', ev({ missionsDoneByMe: [mis('pdr_issue')] }), prog('principal1:report', 'principal1:ss', 'principal1:suit', 'principal1:_done'), ready), []); // nothing more to record for it
// a hidden step is never recorded
assert.deepStrictEqual(nd(principalQ(), 'Principal', ev({ missionsDoneByMe: [mis('pdr_issue')] }), null, notReady), []);

// gameSetup seeds the rows only if absent: the seed helper skips ids already present
assert.deepStrictEqual(J(ctx.gameQuestRowsToSeed_([QH, seeds[0]])).map((r) => r[0]), ['coordinator1']);
assert.strictEqual(ctx.gameQuestRowsToSeed_([QH]).length, 2);
// Fleet Operations: a done fleet_ops_* mission counts toward the follow-up step under the same rules (director's contract)
{
  vm.runInContext("GAME_FOLLOWUP_SKIP.fleet = ['gps_dead']", ctx);
  const fq = (o) => state(coordQ, 'Coordinator', ev({ missionsDoneByMe: [mis('fleet_ops_gps_dead', o)] }))[0].steps.find((x) => x.id === 'followup').done;
  assert.strictEqual(fq({}), true, 'a done fleet_ops_ mission counts');
  assert.strictEqual(state(coordQ, 'Coordinator', ev({ missionsDoneByMe: [mis('fleet_ops_rollcall')] }))[0].steps.find((x) => x.id === 'followup').done, false, 'only the follow-up domains of the registry (M4)');
  assert.strictEqual(fq({ shared: true }), false); assert.strictEqual(fq({ gone: true }), false);
  assert.strictEqual(fq({ doneBy: 'someone@lms.org.in' }), false); assert.strictEqual(fq({ doneBy: 'system (condition cleared)' }), false);
  assert.strictEqual(state(coordQ, 'Coordinator', ev({ missionsDoneByMe: [mis('fleet_setup_x')] }))[0].steps.find((x) => x.id === 'followup').done, false, 'only the fleet_ops_ prefix');
  assert.strictEqual(state(coordQ, 'Coordinator', ev({ missionsDoneByMe: [mis('pdr_report', {})] }))[0].steps.find((x) => x.id === 'recommend').done, false, 'other steps untouched');
}
console.log('quests OK');
