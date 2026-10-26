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
  return steps.map(function (s) { return { id: s[0], title: s[1], done: s[2], locked: false, go: '', guide: 'setup-' + s[0] }; });
}

function setupQuests_(caller, cfg, now) {
  const steps = setupSteps_(cfg);
  return [{ questId: 'setup:game', title: 'Set up the game', steps: steps, complete: steps.every(function (s) { return s.done; }) }];
}

// ── registration (this file's own functions only) ───────────────────
GAME_MODULE_QUESTS.Owner = [].concat(GAME_MODULE_QUESTS.Owner || [], setupQuests_);
