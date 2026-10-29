// node tests/game/test-map-home.js -- the Owner and Coordinator map homes (assets/game/map-home.js): pins and districts match the backends,
// a Coordinator's scope and actions, the Owner's decisions, ranking only for the Owner and Coordinators, and the pages and windows' rules.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..', '..'), read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
global.LMCSEmoji = require(path.join(root, 'assets/game/emoji.js'));
const M = require(path.join(root, 'assets/game/map-home.js'));

// the default pins are Game Config's kingdom.campuses defaults; the districts are the Coordinator backend's COORD_DISTRICTS
const gctx = vm.createContext({ console });
vm.runInContext(read('apps-script/game.gs'), gctx);
const def = vm.runInContext('gameConfigDefaults_().kingdom.campuses', gctx);
assert.deepStrictEqual(JSON.parse(JSON.stringify(M.PINS)), JSON.parse(JSON.stringify(def)).map((c) => Object.assign({}, c, c.darbar ? {} : {})), 'pins = game.gs kingdom.campuses defaults');
const cctx = vm.createContext({ console });
vm.runInContext(read('apps-script/coordinator.gs'), cctx);
assert.deepStrictEqual(JSON.parse(JSON.stringify(M.DISTRICTS)), JSON.parse(JSON.stringify(vm.runInContext('COORD_DISTRICTS', cctx))), 'districts = COORD_DISTRICTS');

// scope: the Owner and campus ALL see every campus; a Coordinator their district; an unknown campus only itself; no session nothing
assert.strictEqual(M.scopeOf({ role: 'Owner', campusId: 'ALL' }), null);
assert.strictEqual(M.scopeOf({ role: 'Coordinator', campusId: 'ALL' }), null);
assert.deepStrictEqual(M.scopeOf({ role: 'Coordinator', campusId: 'LMS5' }), ['LMS4', 'LMS5', 'LMS6']);
assert.deepStrictEqual(M.scopeOf({ role: 'Coordinator,Teacher', campusId: ' lms2 ' }), ['LMS1', 'LMS2', 'LMS3']);
assert.deepStrictEqual(M.scopeOf({ role: 'Coordinator', campusId: 'HES' }), ['HES']);
assert.deepStrictEqual(M.scopeOf(null), []);
const south = M.scopeOf({ role: 'Coordinator', campusId: 'LMS4' });
assert.ok(M.inScope(south, 'HES') && M.inScope(south, 'LMS6') && !M.inScope(south, 'LMS1'), 'HQ is everyone\'s; the other district is out');
assert.deepStrictEqual(['LMS 4', 'lms4', 'LMS4', '', 'network', 'HES', 'ALL', 'LMS9'].map(M.placeOf), ['LMS4', 'LMS4', 'LMS4', 'HES', 'HES', 'HES', 'HES', 'HES']);

// the Owner's pins: owner-placed positions from gamekingdom win; HQ first; nothing usable -> the defaults
const kd = { success: true, role: 'Owner', day: '2026-10-29', kingdom: { level: 5, followupDueDays: 7, campuses: [
  { id: 'LMS1', name: 'LMS 1', full: 'LMS 1 Dhalpur', x: 100, y: 100, level: 3, points: 9, buildings: [{ id: 'treasury', name: 'Treasury', tiers: [
    { label: 'Collection heads', state: 'open', assignable: true, owner: null, assignees: [{ email: 'a@x.in', name: 'A' }], questId: 'cfin' }] }] },
  { id: 'HES', name: 'LMCS HQ', full: 'LMCS HQ (the society)', x: 500, y: 300, darbar: true, level: 1, points: 2, buildings: [{ id: 'darbar', name: 'Darbar', tiers: [
    { label: 'Set up the game', state: 'open', steps: [{ id: 's1', title: 'Switch on staff sign-in', done: true, guide: 'setup-signin' }, { id: 's2', title: 'Set the secret', done: false, guide: 'setup-secret' }] }] }] },
  { id: 'LMS4', name: 'LMS 4', full: 'LMS 4 Ner Chowk', x: 575, y: 500, level: 3, points: 9, buildings: [{ id: 't', name: 'Treasury', tiers: [{ label: 'x', state: 'open', assignable: true, owner: { name: 'B' }, assignees: [{ email: 'b@x.in' }] }] }] },
  { id: 'LMS5', name: 'LMS 5', full: 'LMS 5 Sayoli', x: 350, y: 470, level: 4, points: 1, buildings: [] }] },
  cards: [{ id: 'apr-9', title: 'Buy chairs', campus: 'LMS 4', category: 'Financial / Purchase' }, { id: 'apr-10', title: 'Network policy', campus: '' }], followHeads: [] };
const pins = M.pinsFrom(kd);
assert.deepStrictEqual(pins.map((p) => p.id), ['HES', 'LMS1', 'LMS4', 'LMS5'], 'HQ first, then the config order');
assert.strictEqual(pins[1].x, 100, 'the owner-placed position');
assert.deepStrictEqual(M.pinsFrom(null).map((p) => p.id), M.PINS.map((p) => p.id));
assert.deepStrictEqual(M.pinsFrom({ kingdom: { campuses: [{ id: 'LMS1' }] } }).length, 7, 'bases without positions: the defaults');
assert.strictEqual(M.pos({ x: 500, y: 310 }), 'left:50%;top:50%');

// the Owner's decisions: their next setup step, steps to hand out (not ones already owned), approved requests to allocate
const dec = M.ownerDecisions(kd);
assert.deepStrictEqual(dec.map((x) => x.kind + '@' + x.place), ['assign@LMS1', 'setup@HES', 'follow@LMS4', 'follow@HES']);
assert.strictEqual(dec[1].title, 'Set up the game: Set the secret');
assert.strictEqual(dec[1].go, 'guide/index.html#setup-secret');
assert.ok(dec[0].tier && dec[0].base.id === 'LMS1' && dec[2].card.id === 'apr-9', 'decisions carry what the in-window Assign posts');
assert.deepStrictEqual(M.countByPlace(dec), { LMS1: 1, HES: 2, LMS4: 1 });
assert.deepStrictEqual(M.ownerDecisions(Object.assign({}, kd, { role: 'Principal' })), [], 'nobody else gets Owner decisions');
assert.deepStrictEqual(M.ownerDecisions(null), []);

// a Coordinator's actions: what is theirs to act on, most-owned first; another Coordinator's follow-up is not theirs
const me = 'c@lms.org.in';
const tasks = [
  { taskId: 't1', domain: 'doc_missing', campus: 'LMS4', title: 'Docs missing', severity: 'low', department: 'HR & Staff', assignee: '' },
  { taskId: 't2', domain: 'apr_follow', campus: 'LMS5', title: 'Follow up chairs', severity: 'medium', department: 'School Financials', assignee: me, due: '2026-11-01' },
  { taskId: 't3', domain: 'hiring_stall', campus: 'LMS6', title: 'Hiring stalled', severity: 'high', department: 'HR & Staff', assignee: 'other@lms.org.in' },
  { taskId: 't4', domain: 'gps_dead', campus: 'LMS6', title: 'Tracker dead', severity: 'high', department: 'Transport', assignee: '' },
  { taskId: 't5', domain: 'apr_follow', campus: 'LMS1', title: 'Assigned to me elsewhere', severity: 'low', department: 'School Operations', assignee: 'C@lms.org.in' },
];
const today = { missions: [
  { id: 'cq_x:LMS4', title: 'Set the bus stops', why: 'Assigned by the Owner', campus: 'LMS4', go: 'setup/index.html?quest=x&campus=LMS4' },
  { id: 'cq_x:LMS2', title: 'North quest', why: 'Assigned by the Owner', campus: 'LMS2', go: 'setup/index.html' },
  { id: 'cq_y', title: 'Network step', why: 'Assigned by the Owner', campus: '', go: 'setup/index.html' },
  { id: 'cq_z', title: 'Done step', why: 'Assigned by the Owner', campus: 'LMS4', done: true },
  { id: 'm1', title: 'Plain mission', why: '', campus: 'LMS5' }] };
const acts = M.coordActions(tasks, today, me.toUpperCase(), south);
assert.deepStrictEqual(acts.map((x) => x.kind + ':' + (x.taskId || x.title)), ['quest:Set the bus stops', 'quest:Network step', 'allocated:t2', 'allocated:t5', 'followup:t4', 'followup:t1'],
  'Owner-assigned steps first, then allocated approvals, then follow-ups by severity; another Coordinator\'s t3 and the other district\'s quest are left out');
assert.strictEqual(acts.filter((x) => x.place === 'LMS1').length, 1, 'an approval the Owner allocated to you elsewhere stays (the backend sent it to you)');
assert.ok(acts.every((x) => x.place !== 'LMS2'), 'nothing of the other district that is not yours');
assert.deepStrictEqual(acts.filter(M.isWild).map((x) => x.taskId), ['t4'], 'transport work sits in the Wilderness');
assert.deepStrictEqual(M.coordActions('error', null, me, south), []);

// ranking: the Owner and Coordinators only; Owner = level then points, ties share; Coordinator = own district only, fewest open first
assert.ok(M.canRank({ role: 'Owner' }) && M.canRank({ role: 'Teacher, Coordinator' }));
for (const r of ['Principal', 'Teacher', 'FeeClerk', 'Driver', 'Staff', '', 'NotOwner']) assert.ok(!M.canRank({ role: r }), r + ' sees no ranking');
assert.deepStrictEqual(M.rankOwner(kd).map((r) => r.id + '#' + r.rank), ['LMS5#1', 'LMS1#2', 'LMS4#2'], 'HQ is not ranked; equal level and points share a rank');
const rc = M.rankCoord(tasks, south);
assert.deepStrictEqual(rc.map((r) => r.id), ['LMS4', 'LMS5', 'LMS6'], 'only the district');
assert.deepStrictEqual(rc.map((r) => r.rank), [1, 1, 3]);
assert.ok(!M.rankCoord(tasks, south).some((r) => r.id === 'LMS1'), 'the other district never ranks for a Coordinator');
assert.strictEqual(M.dueText('2026-11-01'), 'Due 1 Nov');
assert.strictEqual(M.districtText(south), 'LMS 4, 5, 6');
assert.strictEqual(M.pinLabel(M.PINS[1], 0, 'Coordinator', true), 'LMS 1 Dhalpur, not in your district');
assert.strictEqual(M.pinLabel(M.PINS[1], 2, 'Owner', false), 'LMS 1 Dhalpur, 2 decisions waiting');
assert.ok(/^[^\x00-\x7f]+ · [A-Z]/.test(M.bi('town')) && Object.values(M.L).every((p) => /[ऀ-ॿ]/.test(p[0])), 'labels: Hindi first, then English');

// a school's analytics chips: only the sources that loaded, counts for this school only
const src = { issues: [{ campus: 'LMS4', status: 'open', subject: 'Water tank', count: 3 }, { campus: 'LMS4', status: 'resolved', subject: 'x' }, { campus: 'LMS5', status: 'reopened', subject: 'y' }],
  pdrDay: { reports: [{ campus: 'LMS5', principal: 'P', at: '29/10/2026 14:05:00' }] },
  transport: { fleet: [{ reg: 'HP1', campusId: 'LMS4', operational: true, docs: { insurance: { date: '2026-10-01' }, fitness: { date: '2026-11-20' }, pollution: { date: '2027-06-01' }, mv_tax: { na: true, date: '' } } },
    { reg: 'HP2', campusId: 'LMS4', operational: false, docs: { insurance: { date: '2026-01-01' } } }, { reg: 'HP3', campusId: 'LMS5', operational: true, docs: {} }] },
  approvals: [{ campus: 'LMS4', title: 'Chairs', waiting: true }, { campus: 'LMS 4', title: 'Trip', waiting: true }, { campus: 'LMS1', title: 'n', waiting: true }] };
const st = Object.fromEntries(M.campusStats(src, 'LMS4', '2026-10-29').map((c) => [c.key, c]));
assert.deepStrictEqual(Object.keys(st), ['report', 'issues', 'approvals', 'buses', 'papers']);
assert.strictEqual(st.report.value, '✗'); assert.strictEqual(st.issues.value, '1'); assert.deepStrictEqual(st.issues.lines, ['Water tank (3 times)']);
assert.strictEqual(st.approvals.value, '2', "'LMS 4' and 'LMS4' are one school; LMS 1's request is not counted");
assert.strictEqual(st.buses.value, '1/2');
assert.strictEqual(st.papers.value, '2', 'an expired and a 22-day paper on a running bus; not the stopped bus, not n/a');
assert.strictEqual(st.papers.tone, 'bad');
assert.strictEqual(M.campusStats(src, 'LMS5', '2026-10-29').filter((c) => c.key === 'report')[0].value, '✓');
assert.deepStrictEqual(M.campusStats({ issues: null, pdrDay: null }, 'LMS4', '2026-10-29'), [], 'a source that failed: no chip, never a wrong zero');
assert.strictEqual(M.campusStats({ base: kd.kingdom.campuses[0] }, 'LMS1')[0].value, 'Lv 3', 'the Owner\'s setup level chip');
assert.deepStrictEqual(Object.keys(M.ART).sort(), ['LMS1', 'LMS2', 'LMS3', 'LMS4']);
for (const id of Object.keys(M.ART)) for (const x of ['1x', '2x']) assert.ok(fs.existsSync(path.join(root, 'assets/game/art', M.ART[id] + '-' + x + '.webp')), 'render ' + id + ' ' + x);
assert.ok(/loading: 'lazy'/.test(read('assets/game/map-home.js')) && /-1x\.webp 480w, /.test(read('assets/game/map-home.js')), 'renders: lazy, the 1x on small screens');

// the file and the windows: text nodes only, no backend call; ✕ 44px+ with a label; tap outside, Esc, focus and scroll restored; reduced motion
const js = read('assets/game/map-home.js'), css = read('assets/game/map-home.css');
assert.ok(!/fetch\(|XMLHttpRequest|innerHTML|insertAdjacentHTML|outerHTML/.test(js), 'presentation only: no backend call, no parsed HTML');
assert.ok(/class: 'mh-x', 'aria-label': 'Close · बंद करें'/.test(js) && /\.mh-x \{[^}]*width:48px; height:48px/.test(css), 'a visible ✕, 48px, labelled');
assert.ok(/back\.onclick = function \(\) \{ close\(\); \}/.test(js) && /LMCSGame\.ui\.trap\(w\.box, function \(\) \{ close\(\); \}\)/.test(js), 'tap outside and Esc close');
assert.ok(/S\.o\.scene\.inert = true/.test(js) && /box\.scrollLeft = w\.scroll\.x/.test(js) && /w\.release\(quiet \? false : to/.test(js), 'the scene is inert while open; scroll and focus come back');
for (const m of css.matchAll(/(?:min-height|height|width):(\d+)px/g)) void m;
for (const sel of ['.mh-row', '.mh-tabs button', '.mh-strip', '.mh-opt']) assert.ok(new RegExp(sel.replace(/[.[\]]/g, '\\$&') + ' \\{[^}]*min-height:(4[4-9]|[5-9]\\d)px').test(css), sel + ' is 44px+');
assert.ok(/\.mh-edge \{[^}]*width:44px; min-height:64px/.test(css) && /\.mh-avatar \{ width:48px; height:48px/.test(css) && /\.mh-icon \{[^}]*width:64px; min-height:64px/.test(css), 'edge controls 44px+');
const motion = css.slice(css.indexOf('@media (prefers-reduced-motion: no-preference)'));
assert.ok(!/transition|animation/.test(css.slice(0, css.indexOf('@media (prefers-reduced-motion: no-preference)'))) && /transition/.test(motion) && /animation/.test(motion), 'motion only without reduced motion');
for (const k of [...js.matchAll(/(?:\be: |emoji\(|LMCSEmoji\.get\()'(\w+)'/g)].map((m) => m[1])) assert.ok(LMCSEmoji.get(k), 'emoji key ' + k);
assert.ok(!/avatar-|buddy\/|teacher-owl|portrait/.test(js) && /mh-avatar/.test(js), 'faceless: the avatar is an initial; the only pictures are school buildings');
assert.ok(!/LMCSMapHome|map-home\.js"|canRank|mh-rank/.test(read('principal/index.html') + read('assets/game/home-hud.js')), 'the Principal home has no map and no ranking window');

// the pages: map-home after game.js, kingdom.js (the art) and emoji.js; one Town / World switch; the backend reads stay where they were
for (const [p, role] of [['owner/index.html', 'Owner'], ['coordinator/index.html', 'Coordinator']]) {
  const h = read(p), at = (f) => h.indexOf('src="../assets/game/' + f);
  assert.ok(at('map-home.js') > at('game.js') && at('map-home.js') > at('kingdom.js') && at('map-home.js') > at('emoji.js') && at('kingdom.js') > 0, p + ': script order');
  assert.ok(/map-home\.css\?v=[0-9a-f]{8}/.test(h) && /map-home\.js\?v=[0-9a-f]{8}/.test(h), p + ': stamped');
  assert.ok(new RegExp("LMCSMapHome\\.mount\\(\\{ role: '" + role + "'").test(h), p + ': mounted as ' + role);
  assert.strictEqual((h.match(/class="gb-switch"/g) || []).length, 1, p + ': one Town / World switch');
  assert.ok(/<span lang="hi">नगर<\/span> · Town/.test(h) && /<span lang="hi">दुनिया<\/span> · World/.test(h), p + ': Hindi-first switch');
  assert.ok(!/gb-hsw/.test(h), p + ': no second view switch in the header');
  assert.ok(!/innerHTML\s*=\s*[^'\s]/.test(h.slice(h.lastIndexOf('<script>'))), p + ': no data reaches innerHTML in the page script');
}
const co = read('coordinator/index.html');
assert.strictEqual((co.match(/action: 'coordinatortasks'/g) || []).length, 1, 'the Coordinator hub reads coordinatortasks once');
assert.ok(/Coord\.countsOf\(d\.tasks\)/.test(co) && /action: 'coordinatorresolvetask'/.test(co), 'one read feeds the office; Mark resolved is the existing write');
assert.ok(!/gamekingdom/.test(co), 'no gamekingdom read for a Coordinator (the server refuses them)');
const ow = read('owner/index.html');
assert.ok(/action=gamekingdom/.test(ow) && /action=gameeventboard/.test(ow), 'Owner: the existing Kingdom and Game Day reads');
assert.ok(/K = LMCSKingdom/.test(js) && /K\.assignBody\(x\.tier, x\.base\.id, who, ta\.value\.trim\(\)\)/.test(js) && /K\.allocateBody\(x\.card, who, due\.value, ta\.value\.trim\(\)\)/.test(js), 'decisions post the Kingdom\'s own bodies');
assert.ok(/'स्कूल में जाएँ', 'Enter School'/.test(js) && /keepSpot\(id\); LMCSGame\.setViewAs\(\{ campus: id, name: p\.name \}\); location\.assign/.test(js), 'Enter School: one tap, read-only view, the spot kept');
assert.ok(/location\.href = '\.\.\/' \+ leaveTo\(\)/.test(read('principal/index.html')), 'Leave goes back to the map it came from');
assert.ok(/S\.o\.analytics && inScope\(S\.scope, id\)\) nodes\.unshift\(hero\(p\)\)/.test(read('assets/game/map-home.js')), 'no analytics for a school outside the district');
console.log('test-map-home ok');
