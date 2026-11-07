// node tests/game/test-setup-set.js -- the Owner fills HQ setup steps in the portal (apps-script/game-setup.gs): POST setupset writes the
// Game Windows trackSuit dates and the Game Config teacher term end / form link, and setupSteps_ flips each step to Done with its edit values.
// Plus kingdom.js's pure helpers for the step form. Synthetic data only.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const dir = __dirname + '/../../apps-script/';
const J = (x) => JSON.parse(JSON.stringify(x));

function fakeSheet(rows) {
  const sh = {
    rows,
    getDataRange: () => ({ getValues: () => sh.rows.map((r) => r.slice()) }),
    getLastRow: () => sh.rows.length,
    getRange: (row, col) => {
      const put = (vals) => { vals.forEach((v, i) => { const r = sh.rows[row - 1 + i] = sh.rows[row - 1 + i] || []; v.forEach((x, j) => { r[col - 1 + j] = x; }); }); return rg; };
      const rg = { setNumberFormat: () => rg, setValues: put, setValue: (v) => put([[v]]) };
      return rg;
    },
  };
  return sh;
}
const WIN_HEAD = ['WindowId', 'Title', 'Question', 'Scope', 'ScopeId', 'Decider', 'Choice', 'DefaultIfUndecided', 'Opens', 'Closes', 'AppliesFrom', 'Writes', 'OpenedBy', 'ConfirmBy'];
const suitRow = (opens, closes) => ['trackSuit', "Choose your campus's track-suit days", 'Which 3 days?', 'campus', '*', 'Principal', '{"type":"pickN","n":3,"options":["Mon","Tue","Wed","Thu","Fri","Sat"]}', '["Mon","Wed","Fri"]', opens, closes, '', 'trackSuitDays', '', ''];
const book = { tabs: {}, getSheetByName: (n) => book.tabs[n] || null };
let lockFails = false;
const ctx = {
  console: { log() {}, error() {}, warn() {} }, JSON,
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === 'GAME_SHEET_ID' ? 'B' : null) }) },
  CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
  LockService: { getScriptLock: () => ({ waitLock: () => { if (lockFails) throw new Error('lock'); }, releaseLock() {} }) },
  SpreadsheetApp: { openById: () => book },
};
vm.createContext(ctx);
['game-quests.gs', 'game.gs', 'game-actions.gs', 'game-missions.gs', 'game-windows.gs', 'game-teacher.gs', 'game-setup.gs'].forEach((f) => vm.runInContext(fs.readFileSync(dir + f, 'utf8'), ctx));
ctx.gameNow_ = () => new Date('2026-11-06T06:00:00Z');

const reset = (o) => {
  o = o || {};
  const cfg = [['Key', 'Value']];
  if (o.teacher !== undefined) cfg.push(['teacher', o.teacher]);
  book.tabs = { 'Game Config': fakeSheet(cfg), 'Game Windows': fakeSheet([WIN_HEAD].concat(o.noSuit ? [] : [suitRow(o.opens || '', o.closes || '')])), 'Game Progress': fakeSheet([['Email', 'Kind', 'Key', 'Value', 'At']]) };
  lockFails = false;
};
const OWNER = { email: 'Owner@Example.org', roles: ['Owner'] }, P4 = { email: 'p4@example.org', roles: ['Principal'] }, CO = { email: 'c@example.org', roles: ['Coordinator'] };
const set = (c, b) => J(ctx.setupSet_(c, b));
const steps = () => J(ctx.setupSteps_(ctx.tchLoadCfg_()));
const step = (id) => steps().filter((s) => s.id === id)[0];
const winRow = () => book.tabs['Game Windows'].rows.filter((r) => r[0] === 'trackSuit')[0];
const teacher = () => { const r = book.tabs['Game Config'].rows.filter((x) => x[0] === 'teacher')[0]; return r ? r[1] : undefined; };
const progress = () => book.tabs['Game Progress'].rows.slice(1);

// ── track-suit: blank row -> not done; the picker writes Opens/Closes; the step flips to Done ──
reset();
assert.deepStrictEqual(step('suit').edit, { kind: 'window', opens: '', closes: '' });
assert.strictEqual(step('suit').done, false);
let r = set(OWNER, { step: 'suit', opens: '2026-11-06', closes: '2026-11-20' });
assert.deepStrictEqual(r, { success: true, step: 'suit', unchanged: false });
assert.deepStrictEqual(winRow().slice(8, 10), ['2026-11-06', '2026-11-20'], 'the Game Windows trackSuit row has both dates');
assert.deepStrictEqual(winRow().slice(0, 8), suitRow('', '').slice(0, 8), 'nothing else on the row changes');
assert.strictEqual(step('suit').done, true, 'both dates in: Done');
assert.deepStrictEqual(step('suit').edit, { kind: 'window', opens: '2026-11-06', closes: '2026-11-20' });
assert.deepStrictEqual(progress().map((x) => x.slice(0, 4)), [['owner@example.org', 'setup_set', 'suit', '{"opens":"2026-11-06","closes":"2026-11-20"}']]);
// the window itself now reads as open for the Principals' existing pickN decision
const w = J(ctx.gameParseWindows_(book.tabs['Game Windows'].getDataRange().getValues()))[0];
assert.strictEqual(w.opens, '2026-11-06'); assert.strictEqual(w.closes, '2026-11-20'); assert.strictEqual(w.decider, 'Principal');
// same dates again: unchanged, no second log row
assert.strictEqual(set(OWNER, { step: 'suit', opens: '2026-11-06', closes: '2026-11-20' }).unchanged, true);
assert.strictEqual(progress().length, 1);

// Uday's hand-filled row (Date cells from the sheet) is read and shown, and an identical save leaves it alone
reset({ opens: new Date('2026-11-05T18:30:00Z'), closes: new Date('2026-11-19T18:30:00Z') }); // IST midnight 6 Nov / 20 Nov
assert.deepStrictEqual(step('suit').edit, { kind: 'window', opens: '2026-11-06', closes: '2026-11-20' }, 'existing dates shown in the form');
assert.strictEqual(step('suit').done, true);
assert.strictEqual(set(OWNER, { step: 'suit', opens: '2026-11-06', closes: '2026-11-20' }).unchanged, true);
assert.ok(winRow()[8] instanceof Date, 'an unchanged save does not rewrite the cell');

// refusals: never blank a date, never write for anyone but the Owner
reset({ opens: '2026-11-06', closes: '2026-11-20' });
for (const [who, body, code] of [
  [P4, { step: 'suit', opens: '2026-11-06', closes: '2026-11-21' }, 'SETUP_NOT_YOURS'],
  [CO, { step: 'term', value: '2027-03-15' }, 'SETUP_NOT_YOURS'],
  [null, { step: 'suit' }, 'SETUP_NOT_YOURS'],
  [OWNER, { step: 'suit', opens: '2026-11-06', closes: '' }, 'SETUP_BAD_DATE'],
  [OWNER, { step: 'suit', opens: '', closes: '' }, 'SETUP_BAD_DATE'],
  [OWNER, { step: 'suit', opens: '2026-11-06', closes: '2026-02-30' }, 'SETUP_BAD_DATE'],
  [OWNER, { step: 'suit', opens: '2026-11-20', closes: '2026-11-06' }, 'SETUP_BAD_DATE'],
  [OWNER, { step: 'suit', opens: 20261106, closes: '2026-11-20' }, 'SETUP_BAD_DATE'],
  [OWNER, { step: 'signin', value: 'on' }, 'SETUP_UNKNOWN'],
  [OWNER, { step: 'secret', value: 'x' }, 'SETUP_UNKNOWN'],
  [OWNER, { step: 'term', value: '15/03/2027' }, 'SETUP_BAD_DATE'],
  [OWNER, { step: 'form', value: 'https://evil.example.org/forms/x' }, 'SETUP_BAD_URL'],
  [OWNER, { step: 'form', value: 'https://forms.gle/a b' }, 'SETUP_BAD_URL'],
]) {
  assert.strictEqual(set(who, body).code, code, JSON.stringify(body));
}
assert.deepStrictEqual(winRow().slice(8, 10), ['2026-11-06', '2026-11-20'], 'refusals leave the row as it was');
assert.strictEqual(teacher(), undefined); assert.strictEqual(progress().length, 0);
reset({ noSuit: true });
assert.strictEqual(set(OWNER, { step: 'suit', opens: '2026-11-06', closes: '2026-11-20' }).code, 'SETUP_NO_WINDOW');
reset(); lockFails = true;
assert.strictEqual(set(OWNER, { step: 'suit', opens: '2026-11-06', closes: '2026-11-20' }).code, 'SETUP_ERROR');
assert.deepStrictEqual(winRow().slice(8, 10), ['', '']);

// ── term end: Game Config teacher.quests.termEnd; other teacher keys kept; the step flips to Done ──
reset({ teacher: JSON.stringify({ questDays: 4, quests: { other: 1 }, cwhwDeferred: true }) });
assert.strictEqual(step('term').done, false); assert.deepStrictEqual(step('term').edit, { kind: 'date', value: '' });
assert.strictEqual(set(OWNER, { step: 'term', value: '2027-03-15' }).success, true);
assert.deepStrictEqual(JSON.parse(teacher()), { questDays: 4, quests: { other: 1, termEnd: '2027-03-15' }, cwhwDeferred: true });
assert.strictEqual(step('term').done, true); assert.strictEqual(step('term').edit.value, '2027-03-15');
assert.strictEqual(set(OWNER, { step: 'term', value: '2027-03-15' }).unchanged, true);
// no teacher row: added with just the term
reset();
set(OWNER, { step: 'term', value: '2027-03-15' });
assert.deepStrictEqual(JSON.parse(teacher()), { quests: { termEnd: '2027-03-15' } });
// an unreadable teacher cell is never overwritten
reset({ teacher: '{broken' });
assert.strictEqual(set(OWNER, { step: 'term', value: '2027-03-15' }).code, 'SETUP_BAD_CONFIG'); assert.strictEqual(teacher(), '{broken');

// ── form link: shown only while CW/HW is not deferred; written into teacher.cwhwFormUrl ──
reset();
assert.ok(!step('form'), 'CW/HW deferred by default: no form step');
reset({ teacher: JSON.stringify({ cwhwDeferred: false }) });
assert.deepStrictEqual(step('form').edit, { kind: 'url', value: '' });
assert.strictEqual(set(OWNER, { step: 'form', value: 'https://forms.gle/abc123' }).success, true);
assert.strictEqual(JSON.parse(teacher()).cwhwFormUrl, 'https://forms.gle/abc123');
assert.strictEqual(step('form').done, true);

// script properties and the trigger stay out of the portal: no edit on those steps
reset();
['signin', 'secret', 'refresh'].forEach((id) => assert.ok(!('edit' in step(id)), id + ': no portal form'));

// POST only: one doPost line, never a GET action
assert.ok(/if \(action === 'setupset'\) return gameJson_\(setupSet_\(caller, body\)\);/.test(fs.readFileSync(dir + 'game.gs', 'utf8')));
assert.ok(!('setupset' in ctx.GAME_MODULE_ACTIONS));
// the Kingdom passes edit through to the Owner's HQ steps
assert.ok(/guide: s\.guide, edit: s\.edit \}/.test(fs.readFileSync(dir + 'game-kingdom.gs', 'utf8')));

// ── kingdom.js helpers ──
const kctx = { window: {}, LMCSGame: { safeHref: (g, r) => (r || '') + g }, console };
vm.createContext(kctx);
vm.runInContext(fs.readFileSync(__dirname + '/../../assets/game/kingdom.js', 'utf8'), kctx);
const K = kctx.window.LMCSKingdom;
assert.strictEqual(K.editKind({ edit: { kind: 'window' } }), 'window');
assert.strictEqual(K.editKind({ edit: { kind: 'script' } }), '');
assert.strictEqual(K.editKind({}), '');
assert.strictEqual(K.dayLabel('2026-11-20'), 'Fri 20 Nov 2026');
assert.strictEqual(K.setupValueText({ kind: 'window', opens: '2026-11-06', closes: '2026-11-20' }), 'Opens Fri 6 Nov 2026, closes Fri 20 Nov 2026');
assert.strictEqual(K.setupValueText({ kind: 'window', opens: '', closes: '' }), '');
assert.strictEqual(K.setupValueText({ kind: 'date', value: '2027-03-15' }), 'Ends Mon 15 Mar 2027');
assert.strictEqual(K.setupVerb({ kind: 'window' }), 'Set the dates');
const a = { kind: 'setup', step: { id: 'suit', title: 'Open the track-suit decision', edit: { kind: 'window' } } };
assert.ok(/Every setup step is on your Home/.test(K.nextText(a)), 'the Map points to Home for setup');
// Owner Home's one list: People first when not done, then the HQ steps; done ones drop below; the next step is on top
const hqd = { kingdom: { campuses: [{ id: 'HES', darbar: true, buildings: [{ tiers: [{ steps: [{ id: 'signin', done: true }, { id: 'term', done: false, edit: { kind: 'date', value: '' } }, { id: 'suit', done: false }] }] }] }, { id: 'LMS1', buildings: [] }] } };
const ids = (d, p) => K.homeSteps(d, p).map((s) => s.id + (s.done ? '✓' : '')).join();
assert.strictEqual(ids(hqd, null), 'term,suit,signin✓', 'no People read: HQ steps only, to-do first');
assert.strictEqual(ids(hqd, { coordinators: [], principals: [] }), 'people,term,suit,signin✓', 'no Coordinators yet: People is the next step');
assert.strictEqual(ids(hqd, { coordinators: [{}], principals: [{ campus: 'LMS4' }, { campus: 'ALL' }] }), 'term,suit,people✓,signin✓');
assert.strictEqual(K.peopleStep({ coordinators: [{}], principals: [{ campus: 'LMS1, LMS2' }] }).done, false, 'a Principal without one school keeps People open');
assert.strictEqual(K.peopleStep({ coordinators: [{}] }).go, 'owner/people.html');
assert.strictEqual(K.hqSteps({ role: 'Principal', kingdom: { campuses: [{ id: 'LMS1', buildings: [] }] } }).length, 0, 'nobody but the Owner gets HQ steps');
const ksrc = fs.readFileSync(__dirname + '/../../assets/game/kingdom.js', 'utf8'), home = fs.readFileSync(__dirname + '/../../owner/index.html', 'utf8');
assert.ok(/goLink\('owner\/index\.html#hq-setup', 'Set it up on Home'/.test(ksrc) && /goLink\('owner\/index\.html#hq-setup', 'Set up the game on your Home'/.test(ksrc), 'the Map card and the HQ base send the Owner to Home');
assert.ok(/id="hq-setup"/.test(home) && home.indexOf('id="hq-setup"') < home.indexOf('id="hq-tiles"') && /LMCSKingdom\.mountHome\(/.test(home) && /kingdom\.css/.test(home), 'Home: the Set up list first, mounted from kingdom.js');
console.log('test-setup-set: all passed');
