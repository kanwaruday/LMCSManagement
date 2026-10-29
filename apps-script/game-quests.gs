// ═══════════════════════════════════════════════════════════════════
// LMCS Game Backend -- quests. Pure functions: Task 6 loads the rows and the evidence, this file
// turns them into quest state. Nothing here reads or writes a sheet.
// A quest row (Game Quests): QuestId, Role, Title, UnlockAfter, StepsJson, Reward. StepsJson is a JSON
// array of { id, title, check: { kind, count }, go? } -- real work only, no "open this page" steps.
// Evidence = { missionsDoneByMe: Mission[], ssByMe, decisionsByMe: Decision[], issueActionsByMe, daysOnTrack }.
// Steps are sticky: once a Game Progress row (Kind 'quest_step', Key '<questId>:<stepId>') exists,
// the step stays done. So does a finished quest (Key '<questId>:_done'), even if a step is unhidden or added later.
// Only the first unfinished quest of the role is open; later quests come back
// with every step locked.
//
// Apps Script runs every .gs of a project in one global scope in no fixed order, so this file only
// uses other files' symbols INSIDE function bodies, never at top level.
// ═══════════════════════════════════════════════════════════════════
var GAME_MODULE_ACTIONS = GAME_MODULE_ACTIONS || {};
var GAME_MODULE_MISSIONS = GAME_MODULE_MISSIONS || {};
var GAME_MODULE_QUESTS = GAME_MODULE_QUESTS || {};

var GAME_QUEST_VISIBLE_STEPS = 3; // about 3 not-yet-done steps are open at a time

// Quest 1 for the roles that have one. Rows in Game Quests column order.
function gameQuestSeedRows_() {
  const step = function (id, title, kind) { return { id: id, title: title, check: { kind: kind, count: 1 } }; };
  return [
    ['principal1', 'Principal', 'Your portal', '', JSON.stringify([
      step('report', "Submit today's daily report", 'pdr_report'),
      step('ss', 'Submit one SS evaluation', 'ss_submit'),
      step('issue', 'Close one daily-report issue with a note', 'pdr_issue'),
      step('suit', "Choose your campus's track-suit days", 'decision'),
    ]), 'Quest badge: Your portal'],
    ['coordinator1', 'Coordinator', 'Your network', '', JSON.stringify([
      step('recommend', 'Recommend on one approval that has waited 3+ days', 'approval_recommend'),
      step('issueact', 'Act on one daily-report issue: assign it or resolve it, with a note', 'issue_action'),
      step('followup', 'Resolve one follow-up with an outcome note', 'followup'),
    ]), 'Quest badge: Your network'],
  ];
}

// rows = the Game Quests tab, header first. Only the seed rows whose QuestId is absent.
function gameQuestRowsToSeed_(rows) {
  const have = {};
  rows.slice(1).forEach(function (r) { have[String(r[0]).trim()] = true; });
  return gameQuestSeedRows_().filter(function (r) { return !have[r[0]]; });
}

// where a step sends the person; a step's own `go` wins. A decision step has no link: the panel opens the decision card.
function gameQuestGo_(step, cfg) {
  if (step.go) return String(step.go);
  switch (step.check.kind) {
    case 'decision': return '';
    case 'ss_submit': return GAME_PORTAL_SS;
    case 'pdr_issue': return cfg.principalIssuesGo;
    case 'issue_action': return 'coordinator/systems/index.html';
    case 'approval_recommend': return gameApprovalsGo_(cfg);
    case 'followup': return GAME_PORTAL_FOLLOWUPS;
    default: return GAME_PORTAL_PDR;
  }
}

// how much evidence the person has for one check kind
function gameQuestCount_(check, ev, me) {
  const kind = check.kind;
  if (kind === 'ss_submit') return +ev.ssByMe || 0;
  if (kind === 'issue_action') return +ev.issueActionsByMe || 0;
  if (kind === 'day_on_track') return +(ev.daysOnTrack && ev.daysOnTrack.onTrack) || 0;
  if (kind === 'decision') {
    return (ev.decisionsByMe || []).filter(function (d) { return d.kind === 'decided' && gameLower_(d.decidedBy) === me; }).length;
  }
  // pdr_report, pdr_issue, approval_recommend, followup: finished missions of that kind (a follow-up also counts as fleet_ops_*, the transport
  // follow-ups the fleet module shows as its own missions: GAME_FOLLOWUP_SKIP). Shared missions give
  // no personal credit; gone ones and anything a "system" resolver closed never count.
  const skipped = {}; // the follow-up domains modules show as their own fleet_ops_<domain> missions (GAME_FOLLOWUP_SKIP), read here so load order never matters
  Object.keys(GAME_FOLLOWUP_SKIP || {}).forEach(function (k) { [].concat(GAME_FOLLOWUP_SKIP[k] || []).forEach(function (d) { skipped['fleet_ops_' + d] = true; }); });
  return (ev.missionsDoneByMe || []).filter(function (m) {
    return (m.kind === kind || (kind === 'followup' && skipped[m.kind])) && m.done && !m.shared && !m.gone && gameLower_(m.doneBy) === me && !/^system/i.test(gameLower_(m.doneBy));
  }).length;
}

// Quests of the role in sheet order -> { state, newly }. Shared by the two public functions.
function gameQuestCompute_(questRows, role, ev, progressRows, email, cfg) {
  const me = gameLower_(email), recorded = {};
  progressRows.slice(1).forEach(function (r) {
    if (gameLower_(r[0]) === me && r[1] === 'quest_step') recorded[String(r[2])] = true;
  });
  const state = [], newly = [];
  let open = true; // false once an earlier quest of the role is unfinished
  questRows.slice(1).forEach(function (r) {
    if (String(r[1]).trim() !== role) return;
    let defs;
    try { defs = JSON.parse(String(r[4])); } catch (err) { return; }
    if (!Array.isArray(defs)) return;
    const questId = String(r[0]).trim(), finished = !!recorded[questId + ':_done'];
    // a pdr_issue step is hidden (not shown as locked) while the Issues page isn't ready
    defs = defs.filter(function (s) { return s && s.check && !(s.check.kind === 'pdr_issue' && !cfg.principalIssuesReady); });
    let shownOpen = 0;
    const steps = defs.map(function (s) {
      const key = questId + ':' + s.id;
      const met = gameQuestCount_(s.check, ev, me) >= (+s.check.count || 1);
      const done = finished || !!recorded[key] || (open && met);
      if (open && met && !recorded[key] && !finished) newly.push({ questId: questId, stepId: String(s.id) });
      const locked = !open || (!done && ++shownOpen > GAME_QUEST_VISIBLE_STEPS);
      return { id: String(s.id), kind: String(s.check.kind), title: String(s.title), go: gameQuestGo_(s, cfg), done: done, locked: locked };
    });
    const complete = open && steps.length > 0 && steps.every(function (s) { return s.done; });
    if (complete && !finished) newly.push({ questId: questId, stepId: '_done' });
    state.push({ questId: questId, title: String(r[2]), steps: steps, complete: complete, reward: String(r[5] || '') });
    if (!complete) open = false;
  });
  return { state: state, newly: newly };
}

function gameQuestState_(questRows, role, evidence, progressRows, email, cfg) {
  return gameQuestCompute_(questRows, role, evidence, progressRows, email, cfg || gameConfigDefaults_()).state;
}

// The {questId, stepId} pairs to append to Game Progress (Kind 'quest_step', Key 'questId:stepId')
function gameQuestNewlyDone_(questRows, role, evidence, progressRows, email, cfg) {
  return gameQuestCompute_(questRows, role, evidence, progressRows, email, cfg || gameConfigDefaults_()).newly;
}
