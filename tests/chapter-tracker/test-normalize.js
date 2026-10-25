// node tests/chapter-tracker/test-normalize.js -- chapterNormalizeName (ChapterTracker.gs)
// Unicode-aware normalization, added 2026-10-26 after a real-data check found
// 159 of 173 distinct Devanagari chapter names in production gap-report
// exports collapsing to the same empty string under the old [^a-z0-9] strip
// -- colliding in chapterReadOverrides_'s lookup key and the CW/HW-to-
// Course-Mapping matcher. Mirrors ownAcadNormChapter_ in acad-episodes.gs
// (tests/game/test-acad-episodes.js) so the two agree.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../../apps-script/ChapterTracker.gs', 'utf8'), ctx);

// English: plain names just lowercase; internal punctuation becomes a space, it no longer vanishes
assert.strictEqual(ctx.chapterNormalizeName('Light'), 'light');
assert.strictEqual(ctx.chapterNormalizeName('Chapter 3 Heat'), 'chapter 3 heat');
assert.strictEqual(ctx.chapterNormalizeName(' The Lost-Child! '), 'the lost child');
assert.strictEqual(ctx.chapterNormalizeName('The  Lost, Child'), ctx.chapterNormalizeName('the lost-child')); // punctuation/spacing variants agree

// Devanagari: non-empty (marks kept), different chapters stay different, punctuation/spacing variants agree
assert.strictEqual(ctx.chapterNormalizeName('सच्ची दोस्ती'), 'सच्ची दोस्ती');
assert.notStrictEqual(ctx.chapterNormalizeName('सच्ची दोस्ती'), ctx.chapterNormalizeName('बिल्ली का बच्चा'));
assert.strictEqual(ctx.chapterNormalizeName('सच्ची  दोस्ती!'), ctx.chapterNormalizeName('सच्ची दोस्ती'));

// the actual historical bug: these used to all normalize to '' and collide
const realChaptersThatUsedToCollide = [
  'शूरः वयं धीराः वयम्', 'भंगाल का तिलस्मी संसार',
  'अलंकार-उपमा, रूपक ,उत्प्रेक्षा, अतिशयोक्ति, मानवीकरण', 'संज्ञा', 'वचन', 'संगच्छध्वं संवदध्वम्',
];
const normed = realChaptersThatUsedToCollide.map((c) => ctx.chapterNormalizeName(c));
assert.strictEqual(new Set(normed).size, normed.length, 'each distinct real chapter name must normalize to a distinct key');
assert.ok(normed.every((n) => n !== ''), 'no real chapter name should normalize to empty');

// edge cases
assert.strictEqual(ctx.chapterNormalizeName(''), '');
assert.strictEqual(ctx.chapterNormalizeName(null), '');
assert.strictEqual(ctx.chapterNormalizeName('!!!'), '');
assert.strictEqual(ctx.chapterNormalizeName('पाठ 3: वर्षा'), 'पाठ 3 वर्षा'); // digits across scripts both kept

// chapterReadOverrides_'s lookup key is built as [school, cls, subject, chapterNormalizeName(chapterName)].join('|') --
// confirm two real same-class-subject Hindi chapters no longer share a key once that's assembled
const key = (ch) => ['LMS 6', 'Class 3', 'Hindi', ctx.chapterNormalizeName(ch)].join('|');
assert.notStrictEqual(key('सच्ची दोस्ती'), key('बिल्ली का बच्चा'));

console.log('ok    chapterNormalizeName Unicode-aware (English + Devanagari, no collisions)');
