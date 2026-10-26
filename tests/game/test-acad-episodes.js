// node tests/game/test-acad-episodes.js -- shared episode engine (acad-episodes.gs): episodes, tags, no-CWA, same-chapter remediation
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../../apps-script/acad-episodes.gs', 'utf8'), ctx);
const recs = JSON.parse(fs.readFileSync(__dirname + '/fixtures/teacher-feed.json', 'utf8')).cwRecords;
const rules = { remWindowDays: 14, maxEntryTags: 6, minEpisodePeriods: 3 };
const DAY = 86400000, D0 = Date.UTC(2026, 8, 1);
const J = (x) => JSON.parse(JSON.stringify(x));       // cross-realm objects -> plain, for deepStrictEqual

// normalisation and tags
// English: plain names just lowercase (same as the old a-z0-9 strip when there is no punctuation); internal punctuation becomes a space, it no longer vanishes
assert.strictEqual(ctx.ownAcadNormChapter_('Light'), 'light');
assert.strictEqual(ctx.ownAcadNormChapter_('Chapter 3 Heat'), 'chapter 3 heat');
assert.strictEqual(ctx.ownAcadNormChapter_(' The Lost-Child! '), 'the lost child');
assert.strictEqual(ctx.ownAcadNormChapter_('The  Lost, Child'), ctx.ownAcadNormChapter_('the lost-child'));   // punctuation/spacing variants agree
// Devanagari is non-empty (marks kept), differing chapters stay different, punctuation/spacing variants agree
assert.strictEqual(ctx.ownAcadNormChapter_('सच्ची दोस्ती'), 'सच्ची दोस्ती');
assert.notStrictEqual(ctx.ownAcadNormChapter_('सच्ची दोस्ती'), ctx.ownAcadNormChapter_('बिल्ली का बच्चा'));
assert.strictEqual(ctx.ownAcadNormChapter_('सच्ची  दोस्ती!'), ctx.ownAcadNormChapter_('सच्ची दोस्ती'));
assert.strictEqual(ctx.ownAcadNormChapter_('!!!'), '');
assert.deepStrictEqual(J(ctx.ownAcadTags_('chapter teaching; Activity, Q&A, activity')), ['Chapter Teaching', 'Activity', 'Other']);
assert.deepStrictEqual(J(ctx.ownAcadTags_('')), []);

// episodes: the filters
const eps = ctx.ownAcadEpisodes_(recs, rules);
const by = (teacher, ch) => eps.find((e) => e.key.teacher === teacher && e.key.ch === ch);
assert.ok(!eps.some((e) => e.key.cls === 'M-I'), 'M classes excluded');
assert.ok(!eps.some((e) => /general knowledge/i.test(e.key.subj)), 'exempt subject excluded');
assert.ok(!by('t one', 'thin'), 'under 3 periods excluded');
assert.ok(eps.every((e) => e.periods >= 3 && e.key.g === ''));

// an episode is cut at the first CWA; post-CWA is separate
const light = by('t one', 'light');
assert.strictEqual(light.periods, 4);
assert.strictEqual(light.cwa, D0 + 3 * DAY);
assert.strictEqual(light.first, D0); assert.strictEqual(light.last, D0 + 3 * DAY);
assert.strictEqual(light.postCwa.periods, 2);               // day 5 teaching + the day 17 Remediation
assert.deepStrictEqual(J(light.tags), { 'Chapter Teaching': 2, Activity: 1, 'Question & Answers': 1, CWA: 1 }); // once per tag per entry
assert.deepStrictEqual(J(light.seq), ['T', 'AQ', 'T', 'C']);
assert.strictEqual(light.hw, 1);
assert.deepStrictEqual(J(light.postCwa.tags), { 'Chapter Teaching': 1, Remediation: 1 });

// same-chapter remediation: day 14 yes (a timeMs, not a boolean), day 15 no, next chapter no, other teacher no, 7 tags no
assert.strictEqual(light.remediationWithin, D0 + 17 * DAY);
for (const ch of ['sound', 'heat', 'air', 'water']) { const e = by('t one', ch); assert.ok(e.cwa, ch); assert.strictEqual(e.remediationWithin, null, ch); }

// a 7-tag CWA is not a CWA marker: the episode runs on, but its entries still count for periods and tags
const soil = by('t one', 'soil');
assert.strictEqual(soil.cwa, null); assert.strictEqual(soil.remediationWithin, null);
assert.strictEqual(soil.periods, 5); assert.strictEqual(soil.tags['Chapter Teaching'], 5); assert.strictEqual(soil.tags.CWA, 1);

// entry-level count: no episode filters (M-I remediated, GK and the thin chapter counted, 7-tag CWA dropped)
assert.deepStrictEqual(J(ctx.acadRemediatedCwaEntries_(recs, rules)), { cwas: 8, remediated: 2 });
// shuffled input gives the same answer
assert.deepStrictEqual(J(ctx.acadRemediatedCwaEntries_(recs.slice().reverse(), rules)), { cwas: 8, remediated: 2 });
assert.deepStrictEqual(ctx.ownAcadEpisodes_(recs.slice().reverse(), rules).map((e) => e.key.ch).sort(), eps.map((e) => e.key.ch).sort());
// a Hindi teacher's chapter forms an episode (it used to normalise to '' and vanish)
const hi = [0, 1, 2].map((d) => ({ lmsIdx: 1, classMapped: 'Class 5', subject: 'Hindi', teacher: 'T Two', cwChapter: 'सच्ची दोस्ती', cwTag: d === 2 ? 'CWA' : 'Chapter Teaching', timeMs: D0 + d * DAY }));
assert.strictEqual(ctx.ownAcadEpisodes_(hi, rules).length, 1);
assert.strictEqual(ctx.ownAcadEpisodes_(hi.concat([{ ...hi[0], cwChapter: 'बिल्ली का बच्चा' }]), rules).length, 1);   // a different Hindi chapter is its own (thin) episode
// chapters compare ignoring case/spacing
const two = [0, 1].map((d) => ({ lmsIdx: 1, classMapped: 'Class 5', subject: 'Math', teacher: 'T One ', cwChapter: ' Light ', cwTag: d ? 'Remediation' : 'CWA', timeMs: D0 + d * DAY }));
assert.deepStrictEqual(J(ctx.acadRemediatedCwaEntries_(two, rules)), { cwas: 1, remediated: 1 });

// no CWA: closed only when other chapters run on >= 21 days past its last entry
const closed = ctx.ownAcadNoCwa_(eps, rules);
assert.deepStrictEqual(J(closed.map((e) => e.key.ch)).sort(), ['fossils', 'rocks']);  // fossils is closed by the day-200 chapters
assert.strictEqual(by('t two', 'mines').noCwa, false); assert.strictEqual(by('t two', 'ore').noCwa, false);  // 13 days / last in the run
assert.strictEqual(light.noCwa, false);                      // has a CWA

// book groups are optional and Owner-only: g comes from bookGroupOf, and the same chapter in two groups is two episodes
const bg = ctx.ownAcadEpisodes_(recs, rules, (r) => (r.cwChapter === 'Light' ? 'A' : 'B'));
assert.strictEqual(bg.find((e) => e.key.ch === 'light').key.g, 'A'); assert.strictEqual(bg.find((e) => e.key.ch === 'sound').key.g, 'B');
const split = ctx.ownAcadEpisodes_(recs.filter((r) => r.cwChapter === 'Sound'), rules, (r) => (r.timeMs > D0 ? 'A' : 'B'));
assert.deepStrictEqual(J(split.map((e) => e.key.g)), ['A']);   // group B holds only day 0 (too thin); group A is days 1-3, cut at the CWA
console.log('acad-episodes: ok');
