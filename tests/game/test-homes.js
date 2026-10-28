// node tests/game/test-homes.js -- the four role homes mount the game layer (css link, #game-root, script after auth.js, mount call in the sign-in callback)
const fs = require('fs'), assert = require('assert');
const HOMES = { 'principal/index.html': 'showApp', 'coordinator/index.html': 'showApp', 'owner/index.html': 'showApp', 'teacher/index.html': 'init' };
const body = (html, fn) => { // text of `function fn(...) { ... }` by brace matching
  const i = html.indexOf('function ' + fn + '('); assert(i >= 0, 'no function ' + fn);
  let d = 0, j = html.indexOf('{', i);
  for (let k = j; k < html.length; k++) { if (html[k] === '{') d++; else if (html[k] === '}' && --d === 0) return html.slice(j, k); }
  throw new Error('unbalanced ' + fn);
};
// GAME_BACKEND_URL: '' (game off) or the game backend's Apps Script /exec URL; the 4 homes and the plan page must agree
const backendUrl = (html, page) => { const m = /const GAME_BACKEND_URL = '(|https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec)';/.exec(html); assert(m, page + ': GAME_BACKEND_URL constant'); return m[1]; };
const urls = {};
for (const [page, fn] of Object.entries(HOMES)) {
  const html = fs.readFileSync(__dirname + '/../../' + page, 'utf8');
  assert(/<link rel="stylesheet" href="\.\.\/assets\/game\/game\.css(\?v=[0-9a-f]+)?"/.test(html), page + ': game.css link');
  assert(/<section id="game-root" aria-label="Today with Buddy" hidden>/.test(html), page + ': #game-root, hidden until the mount renders (N5)');
  const auth = html.search(/<script src="\.\.\/assets\/auth\.js(\?v=[0-9a-f]+)?"/), game = html.search(/<script src="\.\.\/assets\/game\/game\.js(\?v=[0-9a-f]+)?"/);
  assert(auth >= 0, page + ': auth.js script');
  assert(game >= 0, page + ': game.js script');
  assert(game > auth, page + ': game.js after auth.js');
  urls[page] = backendUrl(html, page);
  assert(/if \((!gameOwnHome && )?typeof LMCSGame !== 'undefined'\) \{ try \{ LMCSGame\.mount\(document\.getElementById\('game-root'\), \{ session: \w+, backendUrl: GAME_BACKEND_URL, root: '\.\.\/' \}\); \} catch \(e\) \{ console\.warn\('game layer', e\); \} \}/.test(body(html, fn)), page + ': guarded LMCSGame.mount in ' + fn);
}
// I2: on the teacher page a Principal / Coordinator / Owner gets no panel (theirs is on their own home; it would cover .bottom-nav)
const tInit = body(fs.readFileSync(__dirname + '/../../teacher/index.html', 'utf8'), 'init');
assert(/var gameOwnHome = \['Principal', 'Coordinator', 'Owner'\]\.some\(function \(r\) \{ return LMCS\.hasRole\(SESSION, r\); \}\);/.test(tInit), 'teacher: gameOwnHome from LMCS.hasRole');
assert(/if \(!gameOwnHome && typeof LMCSGame !== 'undefined'\)/.test(tInit), 'teacher: mount skipped for P/C/O');
urls['teacher/plan-activity.html'] = backendUrl(fs.readFileSync(__dirname + '/../../teacher/plan-activity.html', 'utf8'), 'teacher/plan-activity.html');
// Fleet setup: Buddy on the two transport pages, its own missions and quests only, game.css/game.js tags, a collapsed panel under the header
for (const [page, tour] of [['coordinator/transport/setup.html', 'fleet-setup'], ['coordinator/transport/index.html', 'fleet-transport']]) {
  const html = fs.readFileSync(__dirname + '/../../' + page, 'utf8');
  assert(/<link rel="stylesheet" href="\.\.\/\.\.\/assets\/game\/game\.css(\?v=[0-9a-f]+)?"/.test(html), page + ': game.css link');
  assert(/<script src="\.\.\/\.\.\/assets\/game\/game\.js(\?v=[0-9a-f]+)?"/.test(html), page + ': game.js script');
  assert(html.search(/assets\/game\/game\.js/) > html.search(/assets\/auth\.js/), page + ': game.js after auth.js');
  if (page.endsWith('index.html')) { // Fleet Command is a hub on the screen skeleton: Buddy's fleet missions open the stage, the game bar is mounted
    assert(/<main class="gb-stage">\s*<section id="game-root" aria-label="Fleet setup with Buddy" hidden><\/section>/.test(html), page + ': hidden #game-root first on the stage');
    assert(/LMCSRail\.mount\(document\.getElementById\('game-rail'\), \{ hub: '\.\.\/index\.html', root: '\.\.\/\.\.\/' \}\)/.test(html), page + ': game bar mounted');
  } else {
  assert(/<details id="buddy" class="fs-buddy" hidden>[\s\S]*<section id="game-root" aria-label="Fleet setup with Buddy" hidden><\/section>/.test(html), page + ': collapsed panel holding a hidden #game-root');
  assert(html.indexOf('id="buddy"') < html.indexOf('<main'), page + ': the panel sits above the page content');
  assert(/if \(typeof LMCSGame !== 'undefined'\) \{ try \{ LMCSGame\.mount\(document\.getElementById\('game-root'\), \{ session: \w+, backendUrl: GAME_BACKEND_URL, root: '\.\.\/\.\.\/', only: 'fleet', title: 'Fleet setup', tour: \w+ \}\); \} catch \(e\) \{ console\.warn\('game layer', e\); \} \}/.test(html), page + ': guarded fleet mount');
  assert(html.includes("id: '" + tour + "'"), page + ': page tour ' + tour);
  assert(/getElementById\('buddy'\)\.hidden = root\.hidden/.test(html), page + ': the panel unhides with #game-root (no :has() needed)');
  }
  urls[page] = backendUrl(html, page);
}
assert(/window\.mountFleetBuddy/.test(fs.readFileSync(__dirname + '/../../coordinator/capture/setup.js', 'utf8')), 'setup.js mounts Buddy once the buses are drawn');
assert.strictEqual(new Set(Object.values(urls)).size, 1, 'every page holds the same GAME_BACKEND_URL: ' + JSON.stringify(urls));
console.log('test-homes ok');
