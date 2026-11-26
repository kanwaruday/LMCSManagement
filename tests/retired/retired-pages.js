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
  // batch (b), 26 Nov (B3): pages whose game home is live
  'office/driver-fills.html': '#/office/fills',
  'office/transport.html': '#/fleet/papers',
  'office/hiring.html': '#/hiring',
  'coordinator/transport/setup.html': '#/fleet/desk',
  'coordinator/transport/capture.html': '#/fleet/capture',
  'coordinator/transport/index.html': '#/fleet/desk',
  'hq-photos/index.html': '#/hq',
  'teacher/plan-activity.html': '#/teacher/plan',
  'workplace/index.html': '#/workplace',
  'curriculum-progress/course-mapping-admin.html': '#/curriculum/admin',
  // batch 1, 26 Nov (B3, Uday: everything off the old portal): pages whose game screen is live. Kept live (no game screen yet): coordinator/systems
  // (coordinators approve there), coordinator/transport/live (map, route map, stops, follow-ups), setup, hiring/index, payroll, staff/add-employee
  // (documents), staff-home (rules, routes), principals-daily-reporting, driver
  'owner/event-design.html': '#/hq/events',
  'coordinator/transport/drivers.html': '#/fleet/desk',
  'coordinator/academics/index.html': '#/academics/morning',
  'salary/index.html': '#/hq/salary',
  'owner/transport/index.html': '#/fleet/overview',
  'teacher/index.html': 'home',
  'office/index.html': 'home',
};
const RETIRED = new Set(Object.keys(PLAN));
module.exports = { PLAN, RETIRED };
