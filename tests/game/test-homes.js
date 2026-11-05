// node tests/game/test-homes.js -- the role homes mount the game layer (css link, #game-root, script after auth.js, mount call in the sign-in callback)
const fs = require('fs'), assert = require('assert');
const HOMES = { 'principal/index.html': 'showApp', 'coordinator/index.html': 'showApp', 'owner/index.html': 'showApp', 'teacher/index.html': 'init', 'staff-home/index.html': 'showApp' };
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
// I2: on the teacher page a Principal / Coordinator / Owner gets no panel (theirs is on their own home)
const tHtml = fs.readFileSync(__dirname + '/../../teacher/index.html', 'utf8'), tInit = body(tHtml, 'init');
// the teacher hub wears the screen skeleton: header, then rail, stage, panels, in that order; the rail mounts after sign-in
assert(/<body class="gb gb-app">/.test(tHtml), 'teacher: body.gb.gb-app');
const tOrder = ['<header class="gb-head">', '<div class="gb-shell">', '<nav class="gb-rail" id="game-rail" aria-label="Game" hidden>', '<main class="gb-stage">', 'id="game-root"', '<aside class="gb-panels"'].map((m) => tHtml.indexOf(m));
assert(tOrder.every((i, k) => i >= 0 && (k === 0 || i > tOrder[k - 1])), 'teacher: skeleton in order ' + tOrder);
assert(/LMCSRail\.mount\(document\.getElementById\('game-rail'\), rail\)/.test(tInit) && /if \(rail\)/.test(tInit), 'teacher: rail mounted in init, only with a hub');
// the rail opens the person's own Today hub: the page they came from when they hold that role, else the highest role; Staff get none
const railHubFor = new Function('return ' + body(tHtml, 'railHubFor_').replace(/^\{/, '(function (roles, fromPath) {') + '})')();
const hub = (roles, from) => (railHubFor(roles, from || '') || {}).hub || null;
assert.strictEqual(hub(['Teacher']), 'index.html');
assert.strictEqual(hub(['Principal']), '../principal/index.html');
assert.strictEqual(hub(['Coordinator']), '../coordinator/index.html');
assert.strictEqual(hub(['Owner']), '../owner/index.html');
assert.strictEqual(hub([]), null, 'Staff: no rail');
assert.strictEqual(hub(['Coordinator', 'Teacher']), '../coordinator/index.html', 'the highest role');
assert.strictEqual(hub(['Owner', 'Principal', 'Teacher']), '../owner/index.html');
assert.strictEqual(hub(['Coordinator', 'Teacher'], '/LMCSManagement/teacher/index.html'), 'index.html', 'came from the teacher page');
assert.strictEqual(hub(['Owner', 'Principal'], '/LMCSManagement/principal/'), '../principal/index.html', 'came from the principal home');
assert.strictEqual(hub(['Teacher'], '/LMCSManagement/owner/index.html'), 'index.html', 'a page whose role they lack does not count');
assert.deepStrictEqual(railHubFor(['Teacher'], ''), { hub: 'index.html', root: '../' });
assert(/var gameOwnHome = \['Principal', 'Coordinator', 'Owner'\]\.some\(function \(r\) \{ return LMCS\.hasRole\(SESSION, r\); \}\);/.test(tInit), 'teacher: gameOwnHome from LMCS.hasRole');
assert(/if \(!gameOwnHome && typeof LMCSGame !== 'undefined'\)/.test(tInit), 'teacher: mount skipped for P/C/O');
// 🏠 Home / 🗺️ World on the teacher hub: the switch sits right under Today, styled and wired as the Principal's, with the shared emoji keys
assert(/<section id="game-root" aria-label="Today with Buddy" hidden><\/section>\s*(<!--[\s\S]*?-->\s*)?<div class="gb-switch" id="viewSwitch" role="group" aria-label="View" hidden>/.test(tHtml), 'teacher: hidden switch directly under Today');
assert(/<button type="button" id="view-home" aria-pressed="true" aria-controls="home"><span data-emoji="homeBase"><\/span>Home<\/button>/.test(tHtml), 'teacher: Home button, pressed by default');
assert(/<button type="button" id="view-world" aria-pressed="false" aria-controls="world"><span data-emoji="world"><\/span>World<\/button>/.test(tHtml), 'teacher: World button');
assert(/<section id="world" aria-labelledby="worldHead" hidden>/.test(tHtml), 'teacher: World starts hidden (Home is the default)');
assert(tHtml.search(/school-building\.js/) > tHtml.search(/emoji\.js/) && tHtml.search(/school-models\.js/) > 0, 'teacher: building + models after emoji.js');
const emo = require('../../assets/game/emoji.js'); assert(emo.get('homeBase') && emo.get('world'), 'switch keys exist in emoji.js');
const worldOn = new Function('return ' + body(tHtml, 'worldOn_').replace(/^\{/, '(function (staffOnly, viewAs, isTeacher, hasTimetable) {') + '})')();
assert.strictEqual(worldOn(true, false, false, true), false, 'Staff: no switch');
assert.strictEqual(worldOn(false, false, true, false), true, 'a Teacher: switch');
assert.strictEqual(worldOn(false, true, false, false), false, 'view-as without the timetable: hidden');
assert.strictEqual(worldOn(false, true, false, true), true, 'view-as with the timetable: follows the viewed teacher');
assert.strictEqual(worldOn(false, false, false, false), false, 'a Principal on their own, no timetable: hidden');
// the room highlight: rooms whose holds is one of the teacher's classes; no holds never matches; no section matches every section
const myRoomIds = new Function('return ' + body(tHtml, 'myRoomIds_').replace(/^\{/, '(function (rooms, classes) {') + '})')();
const R = [{ id: 'a', holds: '5A' }, { id: 'b', holds: '5B' }, { id: 'c', holds: '6A' }, { id: 'd', holds: '' }, { id: 'e' }, { id: 'f', holds: 'M-I' }, { id: 'g', holds: 'M-II' }, { id: 'h', holds: '15A' }];
assert.deepStrictEqual(myRoomIds(R, ['Class 5']), [], 'class only, two rooms hold Class 5: outline neither');
assert.deepStrictEqual(myRoomIds(R, ['Class 6']), ['c'], 'class only, one room holds Class 6: that room');
assert.deepStrictEqual(myRoomIds(R, ['5B']), ['b'], 'exact class+section');
assert.deepStrictEqual(myRoomIds(R, ['5A']), ['a']);
assert.deepStrictEqual(myRoomIds(R, ['M-I']), ['f'], 'M-I is not M-II');
assert.deepStrictEqual(myRoomIds(R, ['Class 1']), [], 'Class 1 is not 15A');
assert.deepStrictEqual(myRoomIds(R, ['', null]), [], 'blank classes match nothing');
assert.deepStrictEqual(myRoomIds(R, []), []);
const B = require('../../assets/game/school-building.js'), M = require('../../assets/game/school-models.js');
assert.deepStrictEqual(myRoomIds(B.rooms(B.clean(M.LMS2)), ['Class 5', 'Class 6']), [], 'LMS 2: no holds yet, nothing highlighted');
assert.deepStrictEqual(myRoomIds(B.rooms(B.clean(B.SAMPLE)), ['Class 5']), ['c5a'], 'sample: Class 5 -> 5A');
urls['teacher/plan-activity.html'] = backendUrl(fs.readFileSync(__dirname + '/../../teacher/plan-activity.html', 'utf8'), 'teacher/plan-activity.html');
// Fleet setup: Buddy on the two transport pages, its own missions and quests only, game.css/game.js tags, a collapsed panel under the header
for (const [page, tour] of [['coordinator/transport/setup.html', 'fleet-setup'], ['coordinator/transport/index.html', 'fleet-transport']]) {
  const html = fs.readFileSync(__dirname + '/../../' + page, 'utf8');
  assert(/<link rel="stylesheet" href="\.\.\/\.\.\/assets\/game\/game\.css(\?v=[0-9a-f]+)?"/.test(html), page + ': game.css link');
  assert(/<script src="\.\.\/\.\.\/assets\/game\/game\.js(\?v=[0-9a-f]+)?"/.test(html), page + ': game.js script');
  assert(html.search(/assets\/game\/game\.js/) > html.search(/assets\/auth\.js/), page + ': game.js after auth.js');
  if (page.endsWith('index.html')) { // Fleet Command is a hub on the screen skeleton: Buddy's fleet missions open the stage, the game bar is mounted
    // only the Trial runs shelf may come before it: hidden unless a trial waits for the Owner's or a Coordinator's check
    assert(/<main class="gb-stage">\s*(<section id="trial-runs"[^>]* hidden>[\s\S]*?<\/section>\s*)?<section id="game-root" aria-label="Fleet setup with Buddy" hidden><\/section>/.test(html), page + ': hidden #game-root first on the stage');
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
// route_: #requests / #evals / #tags open their section; old #panel-* links still do; Staff never get the CW/HW tags
const routeFor = (hash, staff) => { const went = []; new Function('location', 'teacherOnlyHidden_', 'goTab', 'currentTab', 'document', body(tHtml, 'route_') + '}')({ hash: hash }, staff, (t) => went.push(t), 'home', { getElementById: () => null }); return went[0] || 'home'; };
for (const [hash, staff, want] of [['#requests', false, 'requests'], ['#panel-requests', false, 'requests'], ['#tags', false, 'tags'], ['#panel-tags', false, 'tags'],
  ['#evals', false, 'evals'], ['#panel-requests', true, 'requests'], ['#tags', true, 'home'], ['#panel-tags', true, 'home'], ['', false, 'home']]) {
  assert.strictEqual(routeFor(hash, staff), want, 'route ' + hash + (staff ? ' (Staff)' : ''));
}
assert.strictEqual(new Set(Object.values(urls)).size, 1, 'every page holds the same GAME_BACKEND_URL: ' + JSON.stringify(urls));
console.log('test-homes ok');
