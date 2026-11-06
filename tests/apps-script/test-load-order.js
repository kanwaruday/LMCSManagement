// Every Apps Script project loads, whatever order its files run in.
// Apps Script declares every file's `var`s and functions before any top-level code runs, then runs the files in the
// project's order, all in one global scope where a top-level var is a non-configurable property. So a project behaves as
// ONE script, and that is how this loads it: each project's files joined, run on the real global (runInThisContext, one
// child process per order; a vm sandbox keeps vars configurable and hides the bug). Two outages it catches:
//   Roster v49, 2026-10-26: transport-capture.gs read transport-uploads.gs's TUP_PATH_ at top level (ReferenceError).
//   Game v20, 2026-11-06: game-classroom.gs did Object.defineProperty(globalThis, 'QUEST_GATE_HOOKS') while game-scout.gs
//   declared `var QUEST_GATE_HOOKS`: "Cannot redefine property" at load took the whole backend down.
// Orders: listed (projects.json), reversed, alphabetical (manifest filePushOrder first, as clasp pushes), and seeded randoms.
// Usage: node tests/apps-script/test-load-order.js
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const here = path.join(__dirname, '../../apps-script');

const pushedAs = (f) => (f.includes('/') ? path.basename(f).replace(/\.js$/, '') : f);
const sourceOf = (f) => (f.includes('/') ? path.join(here, f) : path.join(here, f + '.gs'));

if (process.argv[2] === '--child') {
  const [name, list] = [process.argv[3], JSON.parse(process.argv[4])];
  // Apps Script's built-in services: any property or call on them returns another stub, so top-level code that only
  // touches the runtime loads; a name the project itself never defines still throws.
  const stub = () => new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : stub()), apply: () => stub(), construct: () => stub() });
  ['SpreadsheetApp', 'DriveApp', 'PropertiesService', 'CacheService', 'LockService', 'Utilities', 'Logger', 'UrlFetchApp',
    'ContentService', 'HtmlService', 'ScriptApp', 'Session', 'MailApp', 'GmailApp', 'CalendarApp', 'DocumentApp', 'FormApp', 'Drive',
    'Calendar', 'Sheets', 'AdminDirectory', 'BigQuery', 'XmlService', 'Charts', 'SitesApp', 'SlidesApp', 'Maps', 'Gmail', 'People', 'Browser']
    .forEach((s) => { globalThis[s] = stub(); });
  console.log = console.info = console.warn = () => {};
  const parts = list.map((f) => fs.readFileSync(sourceOf(f), 'utf8') + '\n;\n');
  try {
    vm.runInThisContext(parts.join(''), { filename: 'project.gs' });
    if (name === 'game') {
      // The quest gate rows survive whatever order (a plain assignment in one file would wipe the others' rows).
      // ponytail: 11 = rows on 2026-11-06; lower it if a hook is ever retired on purpose.
      const rows = Object.keys(QUEST_GATE_HOOKS);
      if (!QUEST_GATE_HOOKS.classroomQuests_ || !QUEST_GATE_HOOKS.scoutQuests_ || rows.length < 11) throw new Error('QUEST_GATE_HOOKS rows lost: ' + rows.join(','));
      if ((GAME_MODULE_QUESTS.Teacher || []).indexOf(classroomQuests_) < 0) throw new Error('classroomQuests_ missing from GAME_MODULE_QUESTS.Teacher');
    }
  } catch (e) {
    let line = Number((String(e.stack).match(/project\.gs:(\d+)/) || [])[1]), where = 'after load';
    for (let i = 0; i < list.length && line; i++) { const n = parts[i].split('\n').length - 1; if (line <= n) { where = pushedAs(list[i]) + '.gs:' + line; break; } line -= n; }
    process.stderr.write(where + ': ' + e.message);
    process.exit(1);
  }
  process.exit(0);
}

const projects = JSON.parse(fs.readFileSync(path.join(here, 'projects.json'), 'utf8'));
const pushOrder = (JSON.parse(fs.readFileSync(path.join(here, 'appsscript.json'), 'utf8')).filePushOrder || []).map((f) => f.replace(/\.(gs|js)$/, ''));
const rank = (f) => pushOrder.indexOf(pushedAs(f)) + 1 || pushOrder.length + 1;
const seeded = (files, seed) => { let s = seed; return files.slice().sort(() => (s = (s * 16807) % 2147483647) / 2147483647 - 0.5); };

const failures = [];
let checked = 0;
for (const [name, p] of Object.entries(projects)) {
  if (!p || !Array.isArray(p.files) || !p.files.length) continue;
  const alpha = p.files.slice().sort((a, b) => rank(a) - rank(b) || (pushedAs(a) < pushedAs(b) ? -1 : pushedAs(a) > pushedAs(b) ? 1 : 0));
  const orders = { listed: p.files, reversed: p.files.slice().reverse(), alphabetical: alpha };
  [1, 2, 3, 4].forEach((s) => { orders['seed' + s] = seeded(p.files, s); });
  for (const [order, files] of Object.entries(orders)) {
    try { execFileSync(process.execPath, [__filename, '--child', name, JSON.stringify(files)], { stdio: ['ignore', 'ignore', 'pipe'] }); }
    catch (e) { failures.push(name + ' (' + order + '): ' + String(e.stderr).trim()); }
  }
  checked++;
}
assert.ok(checked > 0, 'no Apps Script projects found in projects.json');
assert.deepStrictEqual(failures, [], 'a project does not load (it breaks the web app at load):\n  ' + failures.join('\n  '));
console.log('apps-script load order: ' + checked + ' projects load as one script in listed, reversed, alphabetical and 4 seeded orders');
