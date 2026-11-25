// The old-portal pages retired in batch (a) (apps-script-retirement-plan.md, 1a rows marked yes + coordinator/transport/rollcall.html),
// each with its Redirect column ("home" = the game's own home for the role). The one list: test-retired-stubs.js checks every stub
// against it, and the other tests skip exactly these pages.
// the plan's Redirect column (apps-script-retirement-plan.md, 1a rows marked yes + coordinator/transport/rollcall.html)
const PLAN = {
  'index.html': 'home', 'principal/index.html': 'home', 'principal/issues.html': '#/principal/issues', 'principal/support-sessions.html': '#/principal/ss/teacher',
  'principal/rooms.html': 'home', 'principal/scout.html': 'home', 'office/daybook.html': '#/office/daybook', 'office/deposits.html': '#/office/deposits',
  'office/close.html': '#/office/close', 'office/report.html': '#/office/report', 'office/accounts.html': '#/office/accounts', 'office/starting-data.html': '#/office/start',
  'office/buses.html': '#/office/buses', 'coordinator/index.html': 'home', 'coordinator/hq.html': 'home', 'coordinator/events/index.html': 'home',
  'coordinator/finance/index.html': 'home', 'coordinator/followups/index.html': 'home', 'coordinator/hr/index.html': 'home', 'coordinator/operations/index.html': 'home',
  'curriculum-progress/daily-progress.html': '#/curriculum/daily', 'curriculum-progress/course-mapping-progress.html': '#/curriculum/mapping',
  'curriculum-progress/cwa-gap-report.html': '#/curriculum/gaps', 'curriculum-progress/unmapped-chapters.html': '#/curriculum/unmapped', 'guide/index.html': 'home',
  'owner/index.html': '#/mission', 'owner/kingdom.html': '#/mission', 'owner/people.html': '#/mission', 'coordinator/transport/rollcall.html': '#/base/bus_incharge',
};
const RETIRED = new Set(Object.keys(PLAN));
module.exports = { PLAN, RETIRED };
