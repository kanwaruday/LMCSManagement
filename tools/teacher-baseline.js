// node tools/teacher-baseline.js <feed.json>
// Prints "remediated / CWAs" for CWA entries remediated on the same chapter within 14 days (25 Oct 2026: 60 / 1793),
// then the same rate for episodes. Not part of verify. Feed files go in tools/private/ (git-ignored: staff names).
const fs = require('fs'), vm = require('vm');
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../apps-script/acad-episodes.gs', 'utf8'), ctx);
const rules = { remWindowDays: 14, maxEntryTags: 6, minEpisodePeriods: 3 };
const recs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).cwRecords;
const e = ctx.acadRemediatedCwaEntries_(recs, rules);
console.log(`${e.remediated} / ${e.cwas}`);
const eps = ctx.ownAcadEpisodes_(recs, rules).filter((x) => x.cwa);
const r = eps.filter((x) => x.remediationWithin).length;
console.log(`episodes with a CWA: ${r} / ${eps.length} remediated on the same chapter (${(100 * r / eps.length).toFixed(1)}%); entries: ${(100 * e.remediated / e.cwas).toFixed(1)}%`);
