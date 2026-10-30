var GAME_MODULE_QUESTS = GAME_MODULE_QUESTS || {};

// Owner setup quests: one sequential quest, "Set up the game", each step ticked from real data (cheap reads only: it runs under
// the script lock). Every step's `guide` is an article id in assets/game/guide.js. Nothing here that can't be checked from data.

function setupSteps_(cfg) {
  const props = PropertiesService.getScriptProperties();
  const meta = tchReadJson_(CacheService.getScriptCache(), 'tch_meta');
  const T = tchConfig_(cfg && cfg.teacher ? cfg : tchLoadCfg_());
  let suit = null;
  try { suit = gameParseWindows_(gameBook_().getSheetByName('Game Windows').getDataRange().getValues()).filter(function (w) { return w.windowId === 'trackSuit'; })[0] || null; } catch (err) { suit = null; }
  const steps = [
    ['signin', 'Switch on staff sign-in', props.getProperty('STAFF_AUTO_SIGNIN') === 'on'],
    ['secret', "Set the overnight check's secret", !!String(props.getProperty('GAME_PUSH_SECRET') || '').trim()],
    ['refresh', 'Keep the teacher index fresh (30-minute trigger)', !!(meta && Date.now() - (Number(meta.builtAt) || 0) < 2 * 3600000)],
    ['form', 'Add the classwork and homework form link', !!T.cwhwFormUrl],
    ['term', "Set this term's end date", /^\d{4}-\d\d-\d\d$/.test(T.quests.termEnd || '')],
    ['suit', 'Open the track-suit decision', !!(suit && suit.opens && suit.closes)],
  ];
  return steps.filter(function (s) { return !(s[0] === 'form' && T.cwhwDeferred); }) // CW/HW is "a quest for later" (Uday, 30 Oct)
    .map(function (s) { return { id: s[0], title: s[1], done: s[2], locked: false, go: '', guide: 'setup-' + s[0] }; });
}

function setupQuests_(caller, cfg, now) {
  const steps = setupSteps_(cfg);
  return [{ questId: 'setup:game', title: 'Set up the game', steps: steps, complete: steps.every(function (s) { return s.done; }) }];
}

// Owner tick-off quests: work only the Owner can do outside the portal (e.g. fixing an office order), each step ticked by one
// confirmed tap (POST ownertick: a Game Progress row, Kind 'owner_tick', Key '<questId>:<stepId>'). Listed beside the sequential
// quest (parallel) until every step is ticked. Data only: a new quest is a new entry here.
var OWNER_TICK_KIND = 'owner_tick';
var OWNER_TICK_QUESTS = [
  { questId: 'owner:oo-02-26', title: '\ud83d\udcdc Fix the admission incentive order', reward: 'Order fixed. Next: issue the new office order, and V1 puts it on the site.', steps: [
    { id: 'brackets', title: 'Add LMS 5 and LMS 6 rows to the incentive brackets' },
    { id: 'lms1', title: 'Settle the LMS 1 amount (\u20b99,000 in one place, \u20b918,000 in another)' },
    { id: 'month', title: 'Settle the payout month ("after September" or "after October")' },
    { id: 'referral', title: 'Add "How did you hear about us / referred by" to the admission form' },
  ] },
];

// one Game Progress read (Owner only; gametoday's copy isn't passed to hooks)
function ownerTickQuests_(caller) {
  const rows = gameBook_().getSheetByName('Game Progress').getDataRange().getValues();
  const me = gameLower_(caller && caller.email), done = {};
  rows.slice(1).forEach(function (r) { if (gameLower_(r[0]) === me && r[1] === OWNER_TICK_KIND) done[String(r[2])] = true; });
  return OWNER_TICK_QUESTS.map(function (q) {
    const steps = q.steps.map(function (s) { return { id: s.id, title: s.title, done: !!done[q.questId + ':' + s.id], locked: false, go: '', tick: true }; });
    return { questId: q.questId, title: q.title, steps: steps, complete: steps.every(function (s) { return s.done; }), parallel: true, reward: q.reward };
  });
}

// POST ownertick {questId, stepId} -> { success, stepId, unchanged }. Owner only, refused before anything is read; idempotent.
function ownerTick_(caller, body) {
  const fail = function (code, error) { return { success: false, code: code, error: error }; };
  try {
    if (!caller || (caller.roles || []).indexOf('Owner') === -1) return fail('OWNER_TICK_NOT_YOURS', 'This quest is for the Owner.');
    body = body && typeof body === 'object' ? body : {};
    const q = OWNER_TICK_QUESTS.filter(function (x) { return x.questId === body.questId; })[0];
    const step = q && q.steps.filter(function (s) { return s.id === body.stepId; })[0];
    if (!step) return fail('OWNER_TICK_UNKNOWN', 'That step is not on an Owner quest.');
    const me = gameLower_(caller.email), key = q.questId + ':' + step.id;
    return gameWithLock_(function () { // read under the lock: a double tap writes one row
      const sh = gameBook_().getSheetByName('Game Progress');
      const have = sh.getDataRange().getValues().slice(1).some(function (r) { return gameLower_(r[0]) === me && r[1] === OWNER_TICK_KIND && String(r[2]) === key; });
      if (!have) gameAppendText_(sh, [[me, OWNER_TICK_KIND, key, 'done', gameNow_().toISOString()]]);
      return { success: true, stepId: step.id, unchanged: have };
    });
  } catch (err) {
    console.error('ownertick: ' + (err && err.message)); // logged, never returned
    return fail('OWNER_TICK_ERROR', "That didn't save. Try again.");
  }
}

// ── registration (this file's own functions only) ───────────────────
GAME_MODULE_QUESTS.Owner = [].concat(GAME_MODULE_QUESTS.Owner || [], setupQuests_, ownerTickQuests_);
