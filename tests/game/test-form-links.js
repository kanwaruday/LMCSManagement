// node tests/game/test-form-links.js -- the game's links into forms land on a real page and a tab that page opens (forms
// inventory, 29 Oct 2026: 8 broken links fixed, 4 old forms retired). Static checks on the shipped pages, plus each page's hash handler.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const ctx = { console };
vm.createContext(ctx);
for (const f of ['game.gs', 'game-actions.gs', 'game-missions.gs', 'game-windows.gs', 'game-quests.gs', 'game-teacher.gs']) vm.runInContext(read('apps-script/' + f), ctx);
const cfg = ctx.gameConfigDefaults_();
const ok = (m) => console.log('ok  - ' + m);

// every link a mission, quest step or event step can carry: the page exists
const links = {
  ss: vm.runInContext('GAME_PORTAL_SS', ctx), report: vm.runInContext('GAME_PORTAL_PDR_REPORT', ctx), approvals: vm.runInContext('GAME_PORTAL_PDR_APPROVALS', ctx),
  issues: cfg.principalIssuesGo, recommend: ctx.gameRecommendGo_(cfg, 'A 1'), tags: vm.runInContext('TCH_DEFAULT_FORM_GO', ctx), requests: vm.runInContext('TCH_REQUESTS_GO', ctx),
  staffEvent: cfg.events[0].steps.Staff.find((s) => s.id === 'requests').go,
};
assert.deepStrictEqual(links, {
  ss: 'principal/support-sessions.html', report: 'principals-daily-reporting/index.html#principal', approvals: 'principals-daily-reporting/index.html#approvals',
  issues: 'principal/issues.html', recommend: 'coordinator/hq.html#d=A%201', tags: 'teacher/index.html#panel-tags', requests: 'teacher/index.html#panel-requests',
  staffEvent: 'teacher/index.html#panel-requests',
});
for (const go of Object.values(links)) assert.ok(fs.existsSync(path.join(root, go.replace(/[#?].*$/, ''))), go);
for (const go of ['office/buses.html', 'office/transport.html']) assert.ok(fs.existsSync(path.join(root, go)), go); // game-fleet.gs: fuel answer, clerk renewals
assert.ok(cfg.principalIssuesReady && cfg.recommendationsReady);
ok('mission, quest and event links open pages that exist');

// the hash names a tab the page has
const pdr = read('principals-daily-reporting/index.html'), tch = read('teacher/index.html');
for (const t of ['principal', 'approvals']) assert.ok(pdr.includes('data-tab="' + t + '"') && pdr.includes('id="panel-' + t + '"'), 'PDR tab ' + t);
for (const t of ['tags', 'requests']) assert.ok(tch.includes('data-tab="' + t + '"') && tch.includes('id="panel-' + t + '"'), 'teacher tab ' + t);
assert.ok(/location\.hash \|\| ''\); \/\/ a reload with a request open reopens it/.test(read('coordinator/hq.html')) && read('coordinator/hq.html').includes("/^#d=(.+)$/"), 'HQ opens #d=<id>');
ok('each hash names a tab (or, on the HQ, a request) the page opens');

// each page's handler: the function out of the page, run against a fake tab bar
function handler(html, name, extra) {
  const src = html.match(new RegExp('function ' + name + '\\(\\) \\{[\\s\\S]*?\\n\\}'))[0];
  const c = vm.createContext(Object.assign({ location: { hash: '' }, opened: [] }, extra));
  vm.runInContext(src, c);
  return c;
}
const tabs = (names, hidden) => ({ querySelector: (sel) => { const m = /data-tab="([a-z]+)"/.exec(sel); return m && names.includes(m[1]) ? { style: { display: (hidden || []).includes(m[1]) ? 'none' : '' } } : null; } });
const p = handler(pdr, 'openTabFromHash_', { document: tabs(['home', 'support', 'principal', 'dashboard', 'approvals']), switchTab(t) { p.opened.push(t); } });
for (const h of ['#principal', '#approvals', '#nope', '#d=1', '', '#game-root', '#principal"]']) { p.location.hash = h; p.openTabFromHash_(); }
assert.deepStrictEqual(p.opened, ['principal', 'approvals']);
const t = handler(tch, 'openTabFromHash_', { document: tabs(['home', 'requests', 'evals', 'tags'], ['tags']), goTab(x) { t.opened.push(x); } });
for (const h of ['#panel-requests', '#panel-tags', '#tags', '#panel-nope', '#game-root']) { t.location.hash = h; t.openTabFromHash_(); }
assert.deepStrictEqual(t.opened, ['requests']); // tags is hidden for non-teaching Staff, so their hash does nothing
ok('the PDR and teacher pages open only their own visible tabs from the hash');

// the retired forms: nothing links to them any more
const shipped = (dir, out = []) => {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (['.git', 'node_modules', 'tests', 'docs', 'drive-index'].includes(e.name)) continue;
    const p2 = path.join(dir, e.name);
    if (e.isDirectory()) shipped(p2, out); else if (/\.(html|js|gs)$/.test(e.name)) out.push(p2);
  }
  return out;
};
const files = shipped('.');
const hits = (re) => files.filter((f) => re.test(read(f)));
assert.deepStrictEqual(hits(/href="[^"]*course-mapping-admin\.html/), [], 'CP2: no link to the retired admin panel');
assert.deepStrictEqual(hits(/forms\.gle\/(mEtGFD6vGhgK3kJG7|LV1fy13jXzrrcXra9|hHgMU9XqBxpk3gWd8|1uFg6AuYpYmP7ukA9|ZiTP8jQuJ4SstRSM6|pKP62AwcJuat1byH7)|1FAIpQLSdNTYssKiHvr3v0F/), [], 'X5: no Staff Document Submission form link');
assert.deepStrictEqual(hits(/hirQueuePositionSync_/), [], 'X4: nothing queues an Interview Report form edit');
assert.ok(!/<iframe/.test(pdr) && !/viewform\?embedded=true/.test(pdr), 'X1: no Support Session Google Form embed on the PDR page');
const ssLinks = [...pdr.matchAll(/href="\.\.\/principal\/support-sessions\.html\?role=(\w+)"/g)].map((m) => m[1]);
assert.deepStrictEqual(ssLinks, ['teacher', 'itComputer', 'pti', 'feeClerkPRO', 'nonTeaching', 'driverCumPeon']);
ok('the four retired forms have no links left; the PDR Support Sessions tab sends every role to the native form');

// the Support Sessions room is gold on the Home Base
assert.ok(/const HOSTS = \[[^\]]*'ss'/.test(read('principal/index.html')));
ok("'ss' is a Home Base host");
console.log('form links: all checks passed');
