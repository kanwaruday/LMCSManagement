// node tests/game/test-staff-home.js -- the staff homes (staff-home/index.html + roles.js): one gate per role (IT Teacher, PTI, Non-Teaching
// by Employee Master department), everyone else refused politely, the Owner previews read only; each role's building draws its spots,
// every spot opens exactly one sheet, labels are Hindi first, emoji come from emoji.js keys, and quests stay owner-assigned (empty state).
const assert = require('assert'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..'), read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const E = global.LMCSEmoji = require(path.join(root, 'assets/game/emoji.js'));
const B = require(path.join(root, 'assets/game/school-building.js'));
const H = require(path.join(root, 'assets/game/home-hud.js'));
const S = require(path.join(root, 'staff-home/roles.js'));
const staff = (department, role, extra) => Object.assign({ email: 'staff.one@example.test', role: role || 'Teacher', campusId: 'LMS4', autoSignIn: true, employeeCode: 'NCM/0/0/0', department }, extra);

// ── the gate, one per role ──
assert.deepStrictEqual(S.gate(staff('adminit')), { role: 'itTeacher', preview: false, campus: 'LMS4' }, 'IT Teacher (AdminIT) opens the IT Teacher home');
assert.deepStrictEqual(S.gate(staff('adminpti')), { role: 'pti', preview: false, campus: 'LMS4' }, 'PTI (AdminPTI) opens the PTI home');
assert.deepStrictEqual(S.gate(staff('non-teaching', 'Staff')), { role: 'nonTeaching', preview: false, campus: 'LMS4' }, 'Non-Teaching opens the Non-Teaching home');
assert.strictEqual(S.gate(staff('AdminIT')).role, 'itTeacher', 'department case does not matter');
assert.strictEqual(S.gate(staff('adminit'), { role: 'pti', campus: 'LMS1' }).role, 'itTeacher', 'a staff member cannot pick another home or school from the URL');
assert.strictEqual(S.gate(staff('adminit'), { role: 'pti', campus: 'LMS1' }).campus, 'LMS4');
// ── everyone else, politely ──
assert.deepStrictEqual(S.gate(staff('teaching')), { refuse: 'teacher' }, 'a class teacher goes to the Teacher portal');
assert.deepStrictEqual(S.gate(staff('adminclerk', 'Staff')), { refuse: 'clerk' });
assert.deepStrictEqual(S.gate(staff('transport', 'Staff')), { refuse: 'driver' });
assert.deepStrictEqual(S.gate(staff('')), { need: 'department' }, 'an older Employee Master session: ask staffsignin once');
assert.deepStrictEqual(S.gate(staff(undefined)), { need: 'department' });
assert.deepStrictEqual(S.gate({ email: 'p@example.test', role: 'Principal', campusId: 'LMS2' }), { refuse: 'manager' });
assert.deepStrictEqual(S.gate({ email: 'c@example.test', role: 'Coordinator,Teacher', campusId: 'ALL' }), { refuse: 'manager' });
assert.deepStrictEqual(S.gate({ email: 'f@example.test', role: 'FeeClerk', campusId: 'LMS4' }), { refuse: 'clerk' });
assert.deepStrictEqual(S.gate({ email: 't@example.test', role: 'Teacher', campusId: 'LMS4' }), { refuse: 'teacher' }, 'an allowlisted Teacher row has no department');
assert.deepStrictEqual(S.gate({ email: 'x@example.test', role: '', campusId: 'LMS4' }), { refuse: 'unknown' });
assert.deepStrictEqual(S.gate(null), { refuse: 'signin' });
for (const [k, r] of Object.entries(S.REFUSE)) {
  assert.ok(/[ऀ-ॿ]/.test(r.text) && r.text.indexOf('·') > 0 && /[ऀ-ॿ]/.test(r.text.split('·')[0]), k + ': refusal is Hindi first, then English');
  if (r.url) assert.ok(/^\.\.\//.test(r.url) && fs.existsSync(path.join(root, r.url.slice(3))), k + ': points to a real portal page');
}
// ── the Owner previews, read only ──
assert.deepStrictEqual(S.gate({ email: 'o@example.test', role: 'Owner', campusId: 'ALL' }), { role: 'itTeacher', preview: true, campus: 'LMS1' });
assert.deepStrictEqual(S.gate({ email: 'o@example.test', role: 'Owner', campusId: 'ALL' }, { role: 'nonTeaching', campus: 'LMS5' }), { role: 'nonTeaching', preview: true, campus: 'LMS5' });
assert.deepStrictEqual(S.gate({ email: 'o@example.test', role: 'Owner', campusId: 'ALL' }, { role: 'nope', campus: 'HES' }), { role: 'itTeacher', preview: true, campus: 'LMS1' }, 'a bad preview asks for the default');
// the departments are the PDR backend's (main.gs PDR_AUTO_ROLE_BY_DEPARTMENT): each one this page reads signs in there
const pdr = /const PDR_AUTO_ROLE_BY_DEPARTMENT = (\{[^}]+\});/.exec(read('apps-script/main.gs'));
const deptMap = Function('return ' + pdr[1])();
for (const k of Object.keys(S.ROLES)) assert.ok(deptMap[S.ROLES[k].dept], k + ': department ' + S.ROLES[k].dept + ' signs in on the PDR backend');
assert.deepStrictEqual(Object.keys(S.ROLES).map((k) => S.ROLES[k].ss), ['IT Teacher SS', 'PTI SS', 'Non-Teaching SS'], 'the three SS roles without a portal (principal/support-sessions.html)');

// ── each role: its building draws, every spot is a room or reachable from the Quest board, exactly once ──
const hindiFirst = (t) => /^[^·]*[ऀ-ॿ][^·]*·/.test(t) || /^(CCTV|EPABX|PTI|IT|Bye Laws)/.test(t);
const want = { itTeacher: ['lab', 'cctv', 'epabx', 'digital', 'print'], pti: ['ground', 'kit'], nonTeaching: ['desk', 'store'] };
for (const k of Object.keys(S.ROLES)) {
  const r = S.ROLES[k], m = B.clean(r.building), src = S.sources(k);
  assert.ok(m, k + ': building model is valid');
  const rooms = B.rooms(m), ids = rooms.map((x) => x.id);
  assert.strictEqual(rooms.length, [].concat(r.building.grounds || [], ...r.building.blocks.map((b) => b.rooms)).length, k + ': no room dropped by clean()');
  for (const x of rooms) {
    assert.ok(src[x.host], k + ': room ' + x.id + ' opens a known source (' + x.host + ')');
    if (x.e) assert.ok(E.get(x.e), k + ': room ' + x.id + ' emoji key ' + x.e);
    assert.ok(hindiFirst(x.name), k + ': room name Hindi first: ' + x.name);
  }
  for (const s of want[k]) assert.ok(rooms.some((x) => x.host === s), k + ': has a spot for ' + s);
  for (const [key, v] of Object.entries(src)) {
    assert.ok(E.get(v.e), k + ': source ' + key + ' emoji key ' + v.e);
    assert.ok(hindiFirst(v.label), k + ': source label Hindi first: ' + v.label);
    if (!['today', 'routes'].includes(key)) assert.ok(S.sheet(k, key) && S.sheet(k, key).lead, k + ': ' + key + ' has a sheet');
  }
  const p = H.plan(r.hotspots, ids, src), placed = p.placed.map((s) => s.source);
  assert.deepStrictEqual(placed.concat(p.board).sort(), Object.keys(src).sort(), k + ': every source once (bubble or Quest board)');
  assert.ok(ids.includes(r.hotspots.entrance), k + ': the Quest board sits at a real spot');
  const svg = B.svg(m, { hosts: Object.keys(src), art: false });
  assert.ok(/<svg class="sb"/.test(svg) && (svg.match(/class="sb-room sb-host"/g) || []).length === rooms.length, k + ': every spot drawn gold (it opens a sheet)');
  assert.ok(!/<figure/.test(svg), k + ': no campus picture over a staff building');
  assert.ok(!/Sample building/.test(svg), k + ': not marked sample');
}
assert.ok(!/@|\b[A-Z]{3}\/\d/.test(read('staff-home/roles.js').replace(/@\w+/g, '')), 'no emails or employee codes in the config');
assert.ok(hindiFirst(S.NO_QUESTS) && /No quests yet\. Your quests will appear here\./.test(S.NO_QUESTS), 'the calm empty state for quests');
for (const [k, v] of Object.entries(S.LABELS)) if (typeof v === 'string' && k !== 'go') assert.ok(hindiFirst(v), 'HUD label Hindi first: ' + k);

// ── the page ──
const page = read('staff-home/index.html');
assert.ok(/<div id="hh-stash" hidden>[\s\S]*id="game-root"[\s\S]*id="signout-link"[\s\S]*<\/div>\s*<div class="hh-scene"/.test(page), 'Today and sign out wait in the stash: nothing inline on the scene');
assert.ok(!/class="gb-rooms"|gb-panels/.test(page), 'no room lists or panels on the scene');
assert.ok(/noQuests: SH\.NO_QUESTS/.test(page) && /sources: SH\.sources\(ROLE\)/.test(page) && /hotspots: r\.hotspots/.test(page) && /labels: SH\.LABELS/.test(page), 'the HUD gets the role config');
assert.ok(/LMCS\.requireSession\('#gate-slot'\)\.then\(enter\)/.test(page), 'the staff Google sign-in gate');
assert.ok(/SH\.gate\(/.test(page) && /refuse\(pick\.refuse\)/.test(page), 'the role gate decides, and refuses politely');
assert.ok(/LMCSRouteMap\.mount\(.*campus: PICK\.campus.*refused: WORLD_SOON/.test(page), 'World: the route map, this school only, a calm line if refused');
assert.ok(/art: false/.test(page), 'the building is drawn without the campus picture');
assert.ok(/if \(pick\.preview\) \{ document\.dispatchEvent\(new CustomEvent\(.lmcs-game-today.*\); return; \}/.test(page), 'the Owner preview makes no game call');
assert.ok(/data-roles="Teacher,Staff"/.test(page), 'the event card for staff');
assert.ok(!/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(page.slice(page.indexOf('<body'), page.indexOf('<script src')).replace(/<!--[\s\S]*?-->/g, '')), 'no raw emoji in the markup');
assert.ok(!/innerHTML\s*=(?!\s*LMCSBuilding\.svg)/.test(page), 'no parsed HTML except the escaped building svg');
const css = read('assets/game/home-hud.css');
assert.ok(/body\.hh-noquests \.lg-quest/.test(css), 'quest cards hidden while quests are owner-assigned only');
assert.ok(/\.hh-x \{[^}]*width:44px; height:44px/.test(css), 'the sheet ✕ is 44px');
assert.ok(/\.sh-refused \.gb-btn \{[^}]*min-height:44px/.test(page) && /\.gb-viewbar a \{[^}]*min-height:44px/.test(page), 'page taps are 44px');
assert.ok(!/animation:|transition:/.test(page), 'no motion of its own (the HUD keeps its motion behind reduced-motion)');
// the chooser lists it; the route map keeps its Try again for every other refusal
assert.ok(/href="staff-home\/index\.html"/.test(read('index.html')), 'the portal chooser has the staff home');
assert.ok(/if \(e\.refused && opts\.refused\) \{ say\(el, opts\.refused\); return; \}/.test(read('coordinator/route-map.js')), 'route map: refused line only when the page asks for it');
// auth.js keeps the department from staffsignin on the session
const auth = read('assets/auth.js');
assert.ok(/department: String\(d\.department \|\| ''\)\.toLowerCase\(\)/.test(auth) && /if \(match\.department\) session\.department = match\.department;/.test(auth), 'auth.js carries the department');
console.log('test-staff-home: ok');
