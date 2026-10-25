// node tests/game/test-teacher-matches.js -- overnight activity check: teachermatchpull / teachermatchpush / tchMatchesFor_ (game-teacher.gs). Synthetic data only.
const fs = require('fs'), vm = require('vm'), assert = require('assert'), crypto = require('crypto');
const dir = __dirname + '/../../apps-script/';
const store = new Map(), events = [], logs = [];
let fetches = 0, feedBody = null, empBody = null;
const book = { tabs: {}, getSheetByName: (n) => book.tabs[n] || null, insertSheet: (n) => (book.tabs[n] = fakeSheet([])) };
function fakeSheet(rows) {
  const sh = {
    rows, getDataRange: () => ({ getValues: () => sh.rows.map((r) => r.slice()) }), getLastRow: () => sh.rows.length,
    getRange: (row, col) => { const rg = { setNumberFormat: () => rg, setValues: (vals) => { vals.forEach((v, i) => { const r = sh.rows[row - 1 + i] = sh.rows[row - 1 + i] || []; v.forEach((x, j) => { r[col - 1 + j] = x; }); }); return rg; } }; return rg; },
  };
  return sh;
}
const SECRET = 'test-secret-abc';
let secretProp = ' ' + SECRET + '\n'; // a pasted Script property often carries stray whitespace
const reply = (body) => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify(body) });
const ctx = {
  console, Logger: { log: (m) => logs.push(String(m)) },
  CacheService: { getScriptCache: () => ({ get: (k) => (store.has(k) ? store.get(k) : null), put: (k, v) => { store.set(k, v); }, remove: (k) => { store.delete(k); } }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === 'GAME_PUSH_SECRET' ? secretProp : 'GAME_BOOK') }) },
  SpreadsheetApp: { openById: () => book },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) },
  LockService: { getScriptLock: () => ({ waitLock: () => events.push('lock'), releaseLock: () => events.push('unlock') }) },
  UrlFetchApp: { fetchAll: (reqs) => { fetches++; return reqs.map((r) => reply(r.url.indexOf('action=employees') !== -1 ? empBody : feedBody)); }, fetch: () => { fetches++; throw new Error('no network'); } },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256', MD5: 'md5' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, s) => Array.from(crypto.createHash(alg).update(String(s), 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)), // Apps Script bytes are signed
    base64EncodeWebSafe: (b) => Buffer.from(b).toString('base64'),
  },
};
vm.createContext(ctx);
const load = (f) => vm.runInContext(fs.readFileSync(dir + f, 'utf8'), ctx);
load('game-teacher.gs'); load('acad-episodes.gs'); load('game.gs'); load('game-actions.gs'); load('game-missions.gs'); load('game-windows.gs'); load('game-quests.gs');
const J = (x) => JSON.parse(JSON.stringify(x));
const A = 'NCM/99/01/901', B = 'NCM/99/01/902';
const PLAN_TAB = 'Teacher Planned Activities', MATCH_TAB = 'Teacher Activity Matches';
const PHEAD = ['Code', 'Campus', 'Class', 'Subject', 'ChapterNorm', 'Chapter', 'Activity', 'PlannedAt', 'UpdatedAt'];
const MHEAD = ['PlanKey', 'EntryTimeMs', 'Matched', 'Confidence', 'Reason', 'CheckedAt'];
book.tabs[PLAN_TAB] = fakeSheet([PHEAD,
  [A, 'LMS4', 'Class 7', 'Math', 'fractions', 'Fractions', 'Pizza slices', '2026-11-01T05:00:00.000Z', '2026-11-01T05:00:00.000Z'],
  [B, 'LMS2', 'Class 7', 'Math', 'fractions', 'Fractions', 'Fraction bars', '2026-11-01T05:00:00.000Z', '2026-11-01T05:00:00.000Z'],
  [A, 'LMS4', 'Class 8', 'Science', 'cells', 'Cells', 'Onion peel slide', '2026-11-01T05:00:00.000Z', '2026-11-01T05:00:00.000Z']]);
empBody = { success: true, employees: [{ employeeCode: A, name: 'Anita Rao Ma\'am', school: 'LMS 4' }, { employeeCode: B, name: 'Anita Rao', school: 'LMS 2' }, { employeeCode: 'NCM/99/01/903', name: 'Bela Das', school: 'LMS 4' }] };
const rec = (lms, teacher, cls, subj, ch, t, desc) => ({ lmsIdx: String(lms), teacher: teacher, classMapped: cls, subject: subj, cwChapter: ch, timeMs: String(t), cwDesc: desc, cwTag: 'Activity', dateStr: '2026-11-03' });
feedBody = { cwRecords: [
  rec(3, 'ANITA RAO', 'Class 7', 'Maths', 'Fractions!', 1000, 'Cut paper pizzas into slices'),   // A, spelled Maths: same subject
  rec(3, 'anita rao', 'Class 7', 'Math', 'fractions', 2000, 'Added fractions with like denominators'),
  rec(3, 'Anita Rao', 'Class 7', 'Math', 'Fractions', 3000, ''),                                     // no description: not a candidate
  rec(3, 'Bela Das', 'Class 7', 'Math', 'Fractions', 2500, 'Another teacher, same class'),          // other teacher
  rec(3, 'Anita Rao', 'Class 7', 'Math', 'Decimals', 2600, 'Different chapter'),
  rec(1, 'Anita Rao', 'Class 7', 'Math', 'Fractions', 4000, 'Fraction bars on the table'),           // B at LMS2 (idx 1), not A
  rec(3, 'Anita Rao', 'Class 8', 'Science', 'Cells', 5000, 'Looked at onion cells'),
], cmData: {} };

const pull = (secret) => J(ctx.tchMatchPull_({ secret: secret === undefined ? SECRET : secret }));
const push = (results, secret) => J(ctx.tchMatchPush_({ secret: secret === undefined ? SECRET : secret, results: results }));
const rows = () => (book.tabs[MATCH_TAB] ? book.tabs[MATCH_TAB].rows : null);
const keyOf = (code, cls, subj, ch) => crypto.createHash('sha256').update(SECRET + '|' + [code, cls, subj, ch].join('|'), 'utf8').digest('hex');
const KA = keyOf(A, 'Class 7', 'Math', 'fractions'), KB = keyOf(B, 'Class 7', 'Math', 'fractions'), KC = keyOf(A, 'Class 8', 'Science', 'cells');

// ---- secret gate: wrong or unset secret -> Not authorized, nothing fetched, nothing written
assert.strictEqual(typeof ctx.tchMatchPull_, 'function'); assert.strictEqual(typeof ctx.tchMatchPush_, 'function');
[pull('nope'), pull(''), pull(SECRET + 'x'), push([{ planKey: KA, timeMs: 1, matched: true, confidence: 0.9, reason: 'x' }], 'nope')].forEach((o) => assert.deepStrictEqual(o, { success: false, error: 'Not authorized' }));
assert.strictEqual(fetches, 0); assert.strictEqual(rows(), null);
secretProp = ''; assert.deepStrictEqual(pull(''), { success: false, error: 'Not authorized' }); secretProp = ' ' + SECRET + '\n';
assert.strictEqual(pull(' ' + SECRET + ' ').success, true); // trimmed both sides, like the transport secret
fetches = 0;

// ---- pull: candidate entries per plan; matched on (campus, class, subject, teacher, chapter); no names, codes or chapter text in the answer
let out = pull();
assert.strictEqual(out.success, true); assert.strictEqual(fetches, 1);
const byKey = {}; out.items.forEach((i) => { byKey[i.planKey] = i; });
assert.deepStrictEqual(Object.keys(byKey).sort(), [KA, KB, KC].sort());
assert.ok(out.items.every((i) => /^[0-9a-f]{64}$/.test(i.planKey)));
assert.deepStrictEqual(byKey[KA].entries, [{ timeMs: 1000, desc: 'Cut paper pizzas into slices' }, { timeMs: 2000, desc: 'Added fractions with like denominators' }]);
assert.strictEqual(byKey[KA].activity, 'Pizza slices');
assert.deepStrictEqual(byKey[KB].entries, [{ timeMs: 4000, desc: 'Fraction bars on the table' }]); // same name at another campus is another person
assert.deepStrictEqual(byKey[KC].entries, [{ timeMs: 5000, desc: 'Looked at onion cells' }]);
const wire = JSON.stringify(out);
['NCM/99', 'Anita', 'anita', 'Bela', 'LMS', 'Fractions', 'Class 7', 'Science'].forEach((s) => assert.ok(wire.indexOf(s) === -1, 'leaked ' + s));
assert.deepStrictEqual(Object.keys(byKey[KA]).sort(), ['activity', 'entries', 'planKey']);
assert.strictEqual(rows(), null); // a pull writes nothing

// ---- push: rejects unknown planKey, confidence outside 0-1, bad shape, and over 2000 rows; a rejected push writes nothing
const ok = (o) => Object.assign({ planKey: KA, timeMs: 1000, matched: false, confidence: 0.2, reason: 'different activity' }, o || {});
assert.strictEqual(push([ok({ planKey: 'f'.repeat(64) })]).success, false);
assert.strictEqual(push([ok({ confidence: 1.5 })]).success, false); assert.strictEqual(push([ok({ confidence: -0.1 })]).success, false);
assert.strictEqual(push([ok({ confidence: 'high' })]).success, false); assert.strictEqual(push([ok({ matched: 'yes' })]).success, false); assert.strictEqual(push([ok({ timeMs: 'x' })]).success, false);
assert.strictEqual(push([ok(), ok({ planKey: 'f'.repeat(64) })]).success, false); // one bad row rejects the batch
assert.strictEqual(push(new Array(2001).fill(ok())).success, false);
assert.strictEqual(push('nope').success, false);
const NOWMS = Date.now(); ctx.gameNow_ = () => new Date(NOWMS); // the push clock; later tests that need another clock set their own
assert.strictEqual(push([ok({ timeMs: NOWMS + 86400000 + 1000 })]).success, false); // later than now + 1 day
assert.strictEqual(push([ok({ timeMs: NOWMS + 2 * 86400000 })]).success, false);
assert.strictEqual(rows(), null); assert.deepStrictEqual(events, []);

// ---- push: appends under the lock, tab created lazily with the exact header, written as text
assert.deepStrictEqual(push([ok({ timeMs: 1000, matched: false, confidence: 0.3, reason: '=HYPERLINK("x")' }), ok({ timeMs: 2000, matched: false, confidence: 0.4 })]), { success: true, written: 2 });
assert.deepStrictEqual(events, ['lock', 'unlock']);
assert.deepStrictEqual(rows()[0], MHEAD); assert.strictEqual(rows().length, 3);
assert.deepStrictEqual(rows()[1].slice(0, 4), [KA, '1000', 'false', '0.3']); assert.strictEqual(rows()[1][4].charAt(0) === '=', false);
assert.ok(!isNaN(Date.parse(rows()[1][5])));
rows().length = 1; // the accepted edge: exactly now + 1 day
assert.deepStrictEqual(push([ok({ timeMs: NOWMS + 86400000 })]), { success: true, written: 1 });
rows().length = 1;
assert.deepStrictEqual(push([ok({ timeMs: 1000, matched: false, confidence: 0.3, reason: '=HYPERLINK("x")' }), ok({ timeMs: 2000, matched: false, confidence: 0.4 })]), { success: true, written: 2 });
assert.deepStrictEqual(push([]), { success: true, written: 0 });
assert.strictEqual(push(new Array(2000).fill(ok())).success, true); assert.strictEqual(rows().length, 2003);
rows().length = 3; // back to the two real rows

// ---- pull leaves out entries already checked for the plan (newer than the max EntryTimeMs), and a plan with nothing new
out = pull(); let m = {}; out.items.forEach((i) => { m[i.planKey] = i; });
assert.strictEqual(m[KA], undefined); // 1000 and 2000 checked, 3000 has no description: nothing left for plan A
assert.ok(m[KB] && m[KC]);
push([ok({ timeMs: 2500, matched: false, confidence: 0.1 })]); // an older entry checked later does not move the line backwards
out = pull(); assert.strictEqual(out.items.some((i) => i.planKey === KA), false);
// a newer entry shows up again
feedBody.cwRecords.push(rec(3, 'Anita Rao', 'Class 7', 'Math', 'Fractions', 9000, 'Quiz on fractions'));
out = pull(); m = {}; out.items.forEach((i) => { m[i.planKey] = i; });
assert.deepStrictEqual(m[KA].entries, [{ timeMs: 9000, desc: 'Quiz on fractions' }]);
// a plan already matched with confidence >= matchMinConfidence is not asked again
push([{ planKey: KC, timeMs: 5000, matched: true, confidence: 0.9, reason: 'same' }]);
out = pull(); assert.strictEqual(out.items.some((i) => i.planKey === KC), false);
// the pull is capped at 400 items; entries per item are capped
{
  const plansTab = book.tabs[PLAN_TAB], saved = plansTab.rows.slice(), savedFeed = feedBody.cwRecords.slice();
  for (let i = 0; i < 450; i++) plansTab.rows.push([A, 'LMS4', 'Class 7', 'Math', 'topic ' + i, 'Topic ' + i, 'Act', 'x', 'x']);
  for (let i = 0; i < 450; i++) feedBody.cwRecords.push(rec(3, 'Anita Rao', 'Class 7', 'Math', 'Topic ' + i, 100 + i, 'note ' + i));
  for (let i = 0; i < 40; i++) feedBody.cwRecords.push(rec(3, 'Anita Rao', 'Class 7', 'Math', 'Topic 0', 10000 + i, 'more ' + i));
  out = pull(); assert.strictEqual(out.items.length, 400); assert.ok(out.items.every((i) => i.entries.length >= 1 && i.entries.length <= 20));
  plansTab.rows.length = 0; saved.forEach((r) => plansTab.rows.push(r)); feedBody.cwRecords = savedFeed;
}

// ---- unreadable sources: an error, never a partial answer
{ const saved = feedBody; feedBody = null; const o = pull(); feedBody = saved; assert.strictEqual(o.success, false); }

// ---- tchMatchesFor_: best result per plan, {pending:true} when the plan has entries newer than its last check
const NOW = new Date('2026-11-10T05:00:00Z');
const ep = (cls, subj, ch, last, described) => ({ cls: cls, subj: subj, ch: ch, name: ch, first: last - 1, last: last, lastDescribed: described === undefined ? last : described, cwaAt: null, cwaFrom: null, remediatedAt: null, plannedCwaDate: null });
const setState = (eps) => store.set('tch_' + A, JSON.stringify({ code: A, campus: 'LMS4', classSubjects: [], episodes: eps, loggedDays: {}, periodsByDay: null, nextChapters: [] }));
const invalidate = () => { store.delete('tch_matches_' + A); store.delete('tch_plans_' + A); };
rows().length = 1; invalidate(); // empty matches tab
const KEY = 'Class 7|Math|fractions', KEY2 = 'Class 8|Science|cells';
setState([ep('Class 7', 'Math', 'fractions', 9000), ep('Class 8', 'Science', 'cells', 5000)]);
fetches = 0;
// never checked, entries exist -> pending
assert.deepStrictEqual(J(ctx.tchMatchesFor_(A)), { [KEY]: { pending: true }, [KEY2]: { pending: true } });
// checked up to 2000 with a weak non-match -> still pending (9000 is newer)
push([ok({ timeMs: 1000, matched: false, confidence: 0.3 }), ok({ timeMs: 2000, matched: false, confidence: 0.6 })]); // push busts the cache
assert.deepStrictEqual(J(ctx.tchMatchesFor_(A))[KEY], { pending: true });
// checked through the latest entry, no match -> the best non-match, nothing pending
push([ok({ timeMs: 9000, matched: false, confidence: 0.8 })]);
assert.deepStrictEqual(J(ctx.tchMatchesFor_(A))[KEY], { matched: false, confidence: 0.8 });
// a match wins over a more confident non-match, and the highest-confidence match wins among matches
push([ok({ timeMs: 9000, matched: true, confidence: 0.75 }), ok({ timeMs: 9000, matched: true, confidence: 0.9 }), ok({ timeMs: 9000, matched: true, confidence: 0.72 })]);
assert.deepStrictEqual(J(ctx.tchMatchesFor_(A))[KEY], { matched: true, confidence: 0.9 });
// ... even when newer entries arrive later: a plan that already matched stays matched
setState([ep('Class 7', 'Math', 'fractions', 20000), ep('Class 8', 'Science', 'cells', 5000)]);
assert.deepStrictEqual(J(ctx.tchMatchesFor_(A))[KEY], { matched: true, confidence: 0.9 });
// a weak match (< matchMinConfidence 0.7) does not hide "checking overnight" while newer notes await an answer
rows().length = 1; invalidate();
push([ok({ timeMs: 9000, matched: true, confidence: 0.5 })]);
setState([ep('Class 7', 'Math', 'fractions', 20000), ep('Class 8', 'Science', 'cells', 5000)]);
assert.deepStrictEqual(J(ctx.tchMatchesFor_(A))[KEY], { pending: true });
setState([ep('Class 7', 'Math', 'fractions', 9000), ep('Class 8', 'Science', 'cells', 5000)]);
assert.deepStrictEqual(J(ctx.tchMatchesFor_(A))[KEY], { matched: true, confidence: 0.5 }); // nothing newer: the quest treats it as not done
assert.strictEqual(J(ctx.tchChapterQuests_(JSON.parse(store.get('tch_' + A)), ctx.tchPlansFor_(A), J(ctx.tchMatchesFor_(A)), {}, new Date(10000)))[0].steps[2].done, false);
// the newest note has a blank description (last 9500, lastDescribed 9000): nothing to check, so NOT pending
setState([ep('Class 7', 'Math', 'fractions', 9500, 9000)]);
assert.deepStrictEqual(J(ctx.tchMatchesFor_(A))[KEY], { matched: true, confidence: 0.5 });
rows().length = 1; invalidate(); push([ok({ timeMs: 9000, matched: false, confidence: 0.4 })]);
assert.deepStrictEqual(J(ctx.tchMatchesFor_(A))[KEY], { matched: false, confidence: 0.4 });
setState([ep('Class 7', 'Math', 'fractions', 9500, 9400)]); // a described note newer than the check: pending
assert.deepStrictEqual(J(ctx.tchMatchesFor_(A))[KEY], { pending: true });
// the old state shape (no lastDescribed) is never pending, never an error
setState([{ cls: 'Class 7', subj: 'Math', ch: 'fractions', last: 20000 }]); assert.deepStrictEqual(J(ctx.tchMatchesFor_(A))[KEY], { matched: false, confidence: 0.4 });
rows().length = 1; invalidate();
setState([ep('Class 7', 'Math', 'fractions', 9000), ep('Class 8', 'Science', 'cells', 5000)]);
push([ok({ timeMs: 9000, matched: true, confidence: 0.9 })]);
// no episode (nothing logged on the chapter yet) and no checks -> no entry at all; no state -> only what the sheet holds
setState([]); assert.deepStrictEqual(J(ctx.tchMatchesFor_(A))[KEY], { matched: true, confidence: 0.9 }); assert.strictEqual(J(ctx.tchMatchesFor_(A))[KEY2], undefined);
store.delete('tch_' + A); assert.strictEqual(J(ctx.tchMatchesFor_(A))[KEY2], undefined);
assert.deepStrictEqual(J(ctx.tchMatchesFor_('')), {}); assert.deepStrictEqual(J(ctx.tchMatchesFor_('NCM/00/00/000')), {});
// without the push secret the plan keys cannot be formed: no matches, no throw
secretProp = ''; invalidate(); assert.deepStrictEqual(J(ctx.tchMatchesFor_(A)), {}); secretProp = ' ' + SECRET + '\n';
// safe inside the lock: sheet reads and cache only, never a feed fetch
assert.strictEqual(fetches, 0);
// the quest reads the shape: matched + confidence >= matchMinConfidence ticks "Run the activity"; pending shows "checking overnight"
setState([ep('Class 7', 'Math', 'fractions', NOW.getTime() - 86400000)]); invalidate();
const quest = (matches) => J(ctx.tchChapterQuests_(JSON.parse(store.get('tch_' + A)), ctx.tchPlansFor_(A), matches, {}, NOW)).filter((q) => q.title.indexOf('Class 7 Math') === 0)[0];
assert.strictEqual(quest(J(ctx.tchMatchesFor_(A))).steps[2].done, true);
rows().length = 1; invalidate();
assert.ok(/checking overnight/.test(quest(J(ctx.tchMatchesFor_(A))).steps[2].title));

// ---- the index carries lastDescribed from the same eligibility rule the pull uses (Ruling 23): described notes only, before or after the CWA
{
  const D = 86400000, T0 = Date.UTC(2026, 10, 1);
  const r2 = (ch, tag, t, desc) => ({ lmsIdx: 3, classMapped: 'Class 7', subject: 'Math', teacher: 'Anita Rao', cwChapter: ch, cwTag: tag, hwDesc: '', hwTag: '', cwDesc: desc, timeMs: T0 + t * D, dateStr: new Date(T0 + t * D).toISOString().slice(0, 10) });
  const feed = { cwRecords: [
    r2('Fractions', 'Chapter Teaching', 1, 'Intro to fractions'), r2('Fractions', 'CWA', 2, 'CWA taken'), r2('Fractions', 'Activity', 3, '  Pizza activity after the CWA  '), r2('Fractions', 'Chapter Teaching', 4, '   '),
    r2('Decimals', 'Chapter Teaching', 1, 'Place value'), r2('Decimals', 'Chapter Teaching', 2, ''), r2('Decimals', 'Chapter Teaching', 3, undefined),
    r2('Ghost', 'Chapter Teaching', 1, '')], cmData: {} };
  const out = ctx.tchBuildIndex_(feed, { employees: empBody.employees, academic: [] }, [], null, null, { now: T0 + 10 * D });
  const eps = J(out.byCode[A].episodes), byCh = {}; eps.forEach((e) => { byCh[e.ch] = e; });
  assert.strictEqual(byCh.fractions.lastDescribed, T0 + 3 * D);  // the post-CWA described note counts; the later blank one does not
  assert.strictEqual(byCh.decimals.lastDescribed, T0 + 1 * D);   // the newer blank / missing descriptions do not
  assert.strictEqual(byCh.ghost.lastDescribed, 0);               // nothing described at all
  // the same records through the pull's helper agree
  const cands = feed.cwRecords.map((r) => ctx.tchCandidate_(r, ctx.tchChKey_(r.cwChapter))).filter(Boolean);
  assert.strictEqual(cands.length, 4); assert.ok(cands.every((c) => c.desc === c.desc.trim() && /^3\|Class 7\|math\|/.test(c.key)));
  assert.strictEqual(ctx.tchCandidate_(Object.assign({}, feed.cwRecords[0], { cwChapter: '' }), ''), null);
  // the whole path: post-CWA note, quest state says pending until it is checked
  store.set('tch_' + A, JSON.stringify({ code: A, campus: 'LMS4', classSubjects: [], episodes: eps, loggedDays: {}, periodsByDay: null, nextChapters: [] }));
  rows().length = 1; invalidate();
  assert.deepStrictEqual(J(ctx.tchMatchesFor_(A))[KEY], { pending: true });
}

// ---- doPost: the two actions are the only caller-less ones, and they still need the secret
const post = (b) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(b) } }).text);
assert.deepStrictEqual(post({ action: 'teachermatchpull', secret: 'nope' }), { success: false, error: 'Not authorized' });
assert.strictEqual(post({ action: 'TeacherMatchPull', secret: SECRET }).success, true);
assert.strictEqual(post({ action: 'teachermatchpush', secret: SECRET, results: [] }).success, true);
['gametoday', 'teacherplans', 'teacherplanactivity', 'teacherindexaudit', 'gamedecide'].forEach((a) => assert.deepStrictEqual(post({ action: a, secret: SECRET }), { success: false, error: 'Not authorized' }), 'the secret opens nothing else');
assert.deepStrictEqual(post({ action: 'gametoday', idToken: '' , secret: SECRET }), { success: false, error: 'Not authorized' });
assert.ok(typeof ctx.GAME_MODULE_ACTIONS.teachermatchpull === 'undefined' && typeof ctx.GAME_MODULE_ACTIONS.teachermatchpush === 'undefined'); // never reachable with a token alone
// doGet cannot reach them either
const g = JSON.parse(ctx.doGet({ parameter: { action: 'teachermatchpull', secret: SECRET } }).text); assert.deepStrictEqual(g, { success: false, error: 'Not authorized' });
assert.ok(logs.every((l) => l.indexOf(SECRET) === -1 && l.indexOf('pizza') === -1)); // the secret and the notes are never logged

console.log('ok teacher activity matches');
