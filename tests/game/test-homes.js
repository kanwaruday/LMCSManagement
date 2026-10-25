// node tests/game/test-homes.js -- the four role homes mount the game layer (css link, #game-root, script after auth.js, mount call in the sign-in callback)
const fs = require('fs'), assert = require('assert');
const HOMES = { 'principal/index.html': 'showApp', 'coordinator/index.html': 'showApp', 'owner/index.html': 'showApp', 'teacher/index.html': 'init' };
const body = (html, fn) => { // text of `function fn(...) { ... }` by brace matching
  const i = html.indexOf('function ' + fn + '('); assert(i >= 0, 'no function ' + fn);
  let d = 0, j = html.indexOf('{', i);
  for (let k = j; k < html.length; k++) { if (html[k] === '{') d++; else if (html[k] === '}' && --d === 0) return html.slice(j, k); }
  throw new Error('unbalanced ' + fn);
};
for (const [page, fn] of Object.entries(HOMES)) {
  const html = fs.readFileSync(__dirname + '/../../' + page, 'utf8');
  assert(/<link rel="stylesheet" href="\.\.\/assets\/game\/game\.css(\?v=[0-9a-f]+)?"/.test(html), page + ': game.css link');
  assert(/<section id="game-root" aria-label="Today with Buddy">/.test(html), page + ': #game-root');
  const auth = html.search(/<script src="\.\.\/assets\/auth\.js(\?v=[0-9a-f]+)?"/), game = html.search(/<script src="\.\.\/assets\/game\/game\.js(\?v=[0-9a-f]+)?"/);
  assert(auth >= 0, page + ': auth.js script');
  assert(game >= 0, page + ': game.js script');
  assert(game > auth, page + ': game.js after auth.js');
  assert(/const GAME_BACKEND_URL = '';/.test(html), page + ': GAME_BACKEND_URL constant');
  assert(/if \(typeof LMCSGame !== 'undefined'\) \{ try \{ LMCSGame\.mount\(document\.getElementById\('game-root'\), \{ session: \w+, backendUrl: GAME_BACKEND_URL, root: '\.\.\/' \}\); \} catch \(e\) \{ console\.warn\('game layer', e\); \} \}/.test(body(html, fn)), page + ': guarded LMCSGame.mount in ' + fn);
}
console.log('test-homes ok');
