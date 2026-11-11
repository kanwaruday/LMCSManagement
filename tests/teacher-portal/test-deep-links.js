// node tests/teacher-portal/test-deep-links.js -- the game's doors open one teacher panel each (Uday, 11 Nov): runs teacher/index.html's own
// route_() against a fake page. Unknown hashes land on My day.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const html = fs.readFileSync(__dirname + '/../../teacher/index.html', 'utf8');
const src = html.match(/let teacherOnlyHidden_ = false;\nfunction route_\(\) \{[\s\S]*?\n\}\n/)[0];
function page(hash) {
  const log = [];
  const el = (id, cls, tag) => ({ id, tagName: tag || 'DIV', hidden: false, classList: { contains: (c) => c === cls }, set open(v) { log.push('open:' + id); },
    scrollIntoView() { log.push('scroll:' + id); } });
  const els = { timetableCard: el('timetableCard', 'gb-panel'), eventsCard: el('eventsCard', 'gb-panel'), rankCard: el('rankCard', 'gb-panel'),
    classes: el('classes', '', 'SECTION'), 'game-root': el('game-root', '', 'SECTION') };
  const ctx = { location: { hash }, currentTab: 'home', document: { getElementById: (id) => els[id] || null }, LMCSClassroom: { open: (h) => log.push('classroom:' + h) },
    goTab: (t) => log.push('tab:' + t) };
  vm.createContext(ctx);
  vm.runInContext(src.replace('let teacherOnlyHidden_', 'var teacherOnlyHidden_') + 'route_();', ctx);
  return log;
}
const want = {
  '#requests': ['tab:requests'], '#evals': ['tab:evals'], '#tags': ['tab:tags'],
  '#timetableCard': ['open:timetableCard'], '#eventsCard': ['open:eventsCard'], '#rankCard': ['open:rankCard'],
  '#classes': ['scroll:classes'], '#game-root': ['scroll:game-root'], '#classroom': ['classroom:classroom'],
  '': [], '#nope': [],
};
for (const [h, w] of Object.entries(want)) assert.deepStrictEqual(page(h), w, h);
console.log('teacher deep links: ' + Object.keys(want).length + ' hashes ok');
