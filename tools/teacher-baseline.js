// node tools/teacher-baseline.js <feed.json>
// node tools/teacher-baseline.js --index <feed.json> [roster-employees.json roster-academic.json]
//   Teacher index check (game-teacher.gs): per campus the share of feed entries resolved to an employee code, the share of timetable
//   rows whose labels match a feed class-subject, and the TeacherState size. Aggregates only, no names. The roster files default to
//   tools/private/roster-employees.json / roster-academic.json (curl the roster proxy's ?action=employees and ?action=roster there).
// Prints "remediated / CWAs" for CWA entries remediated on the same chapter within 14 days (25 Oct 2026: 60 / 1793),
// then the same rate for episodes. Not part of verify. Feed files go in tools/private/ (git-ignored: staff names).
const fs = require('fs'), vm = require('vm');
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../apps-script/acad-episodes.gs', 'utf8'), ctx);
if (process.argv[2] === '--index') {
  const path = require('path'), priv = path.join(__dirname, 'private');
  vm.runInContext(fs.readFileSync(__dirname + '/../apps-script/game-teacher.gs', 'utf8'), ctx);
  const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
  const feed = read(process.argv[3]);
  const emp = read(process.argv[4] || path.join(priv, 'roster-employees.json')), acad = read(process.argv[5] || path.join(priv, 'roster-academic.json'));
  const timetable = read(path.join(__dirname, '..', 'teacher', 'data', 'timetable.json'));
  const now = Math.max.apply(null, feed.cwRecords.slice(-2000).map((r) => r.timeMs));
  const out = ctx.tchBuildIndex_(feed, { employees: emp.employees, academic: acad.rows }, [], timetable, null, { now });
  if (out.keepPrevious) { console.log('keepPrevious: ' + out.reason); process.exit(1); }
  const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : 'n/a');
  let ok = true;
  console.log('entries resolved to a code, per campus (unmatched distinct names in brackets):');
  for (let i = 0; i < 6; i++) {
    const r = out.meta.resolution[i]; if (!r) { console.log(`  LMS${i + 1}: no entries`); continue; }
    const bad = r.resolved / r.records < 0.85; if (bad) ok = false;
    console.log(`  LMS${i + 1}: ${pct(r.resolved, r.records)} of ${r.records}  [${(out.meta.unmatched[i] || []).length}]${bad ? '  <-- UNDER 85%: list for the Principal setup quest' : ''}`);
  }
  const pairs = {};
  feed.cwRecords.forEach((r) => { pairs['LMS' + (r.lmsIdx + 1) + '|' + r.classMapped + '|' + String(r.subject).trim()] = true; });
  // timetable periods as the index stores them (labels normalised + umbrella subjects snapped) against what the campus logs
  let rows = 0; const unknown = {};
  Object.keys(timetable.campuses).forEach((cp) => Object.keys(timetable.campuses[cp]).forEach((code) => timetable.campuses[cp][code].periods.forEach((p) => {
    if (p.free || !p.subject || !p.class) return;
    rows++;
    if (!ctx.tchLabel_(p.class, p.subject)) unknown[p.subject] = (unknown[p.subject] || 0) + 1;
  })));
  let labelled = 0, matched = 0;
  Object.keys(out.byCode).forEach((code) => {
    const st = out.byCode[code]; if (!st.periodsByDay) return;
    Object.keys(st.periodsByDay).forEach((d) => st.periodsByDay[d].forEach((p) => { labelled++; if (pairs[st.campus + '|' + p.cls + '|' + p.subj]) matched++; }));
  });
  console.log(`timetable periods (CW/HW labels, as stored) that exist in the feed for that campus: ${matched} / ${labelled} = ${pct(matched, labelled)}  (${rows} non-free rows, ${Object.keys(unknown).length} distinct non-CW/HW or unknown subject labels dropped)`);
  if (matched / labelled < 0.9) ok = false;
  const sizes = Object.keys(out.byCode).map((c) => JSON.stringify(out.byCode[c]).length).sort((a, b) => a - b);
  const q = (f) => sizes[Math.min(sizes.length - 1, Math.floor(f * sizes.length))];
  console.log(`TeacherStates: ${sizes.length}; size bytes p50 ${q(0.5)}, p95 ${q(0.95)}, max ${sizes[sizes.length - 1]}  (limit 90000)`);
  if (q(0.95) >= 90000) ok = false;
  const states = Object.keys(out.byCode).map((c) => out.byCode[c]);
  const eps = [].concat.apply([], states.map((s) => s.episodes));
  console.log(`episodes: ${eps.length}, with a course-map CWA date ${pct(eps.filter((e) => e.plannedCwaDate).length, eps.length)}, with a CWA ${pct(eps.filter((e) => e.cwaAt).length, eps.length)}; ` +
    `teachers with a timetable ${pct(states.filter((s) => s.periodsByDay).length, states.length)}, with classSubjects ${pct(states.filter((s) => s.classSubjects.length).length, states.length)}, with next chapters ${pct(states.filter((s) => s.nextChapters.length).length, states.length)}`);
  console.log(ok ? 'thresholds: ok' : 'thresholds: NOT MET');
  process.exit(ok ? 0 : 1);
}
const rules = { remWindowDays: 14, maxEntryTags: 6, minEpisodePeriods: 3 };
const recs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).cwRecords;
const e = ctx.acadRemediatedCwaEntries_(recs, rules);
console.log(`${e.remediated} / ${e.cwas}`);
const eps = ctx.ownAcadEpisodes_(recs, rules).filter((x) => x.cwa);
const r = eps.filter((x) => x.remediationWithin).length;
console.log(`episodes with a CWA: ${r} / ${eps.length} remediated on the same chapter (${(100 * r / eps.length).toFixed(1)}%); entries: ${(100 * e.remediated / e.cwas).toFixed(1)}%`);
