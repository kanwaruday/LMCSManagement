// The user guide's content, read by the floating Buddy (assets/game/buddy-dock.js) and guide/index.html.
//   pages[path]  = { purpose: one plain sentence, roles: [...], tour?: [{ target: CSS selector, text }] }
//                  path = the page relative to the portal root, e.g. 'coordinator/transport/setup.html', 'index.html'
//   articles     = [{ id: kebab-case (the guide/index.html#<id> anchor), title, roles: [...] (empty = everyone), body: [paragraphs] }]
// Roles: Owner, Principal, Coordinator, Teacher, Fee Clerk, Staff. Features only, never people. Plain text only (shown as text).

window.LMCSGuide = {
  pages: {
    'index.html': { purpose: "Pick the portal for your role.", roles: [] },
    'principal/index.html': {
      purpose: "Your home: Today with Buddy, then every module for your school.", roles: ['Principal'],
      tour: [
        { target: '#welcome-strip', text: "Your name and school, so you know you're in the right place." },
        { target: '#game-root', text: "This is Today: a few pieces of real work waiting for you. Go opens the page where each one happens." },
        { target: '#modules', text: "Every module for your school sits here, whenever you need one." },
      ],
    },
    'principal/issues.html': { purpose: "Open and recently closed issues from daily reports, so each one gets closed.", roles: ['Principal'] },
    'principals-daily-reporting/index.html': { purpose: "Write your campus's daily report: support sessions, activities and staff requests.", roles: ['Principal'] },
    'coordinator/index.html': {
      purpose: "Your home: Today with Buddy, then the department modules.", roles: ['Coordinator'],
      tour: [
        { target: '#welcome-strip', text: "Your name and campuses, so you know you're in the right place." },
        { target: '#game-root', text: "This is Today: a few pieces of real work waiting for you, with the next step in a bar at the bottom." },
        { target: '#modules', text: "The department modules sit here: academics, events, finance, HR, operations, systems and transport." },
      ],
    },
    'coordinator/hq.html': { purpose: "Your contract recommendations and the Owner's decisions, with your own track record.", roles: ['Coordinator'] },
    'coordinator/academics/index.html': { purpose: "The Academics & Examination hub for Coordinators.", roles: ['Coordinator'] },
    'coordinator/events/index.html': { purpose: "The Events & House System hub for Coordinators.", roles: ['Coordinator'] },
    'coordinator/finance/index.html': { purpose: "The School Financials hub for Coordinators.", roles: ['Coordinator'] },
    'coordinator/followups/index.html': { purpose: "All follow-ups assigned to Coordinators, in one list.", roles: ['Coordinator'] },
    'coordinator/hr/index.html': { purpose: "The HR & Staff hub for Coordinators.", roles: ['Coordinator'] },
    'coordinator/operations/index.html': { purpose: "The School Operations hub for Coordinators.", roles: ['Coordinator'] },
    'coordinator/systems/index.html': { purpose: "The Systems hub for Coordinators.", roles: ['Coordinator'] },
    'coordinator/transport/index.html': { purpose: "Transport for Coordinators: fleet missions with Buddy, and the way to checks and capture.", roles: ['Coordinator'] },
    'coordinator/transport/live.html': { purpose: "Live buses, route timelapses and the monthly safety checks.", roles: ['Coordinator'] },
    'coordinator/transport/capture.html': { purpose: "Record a timelapse, a passenger count or a bus safety check from your phone.", roles: ['Coordinator'] },
    'coordinator/transport/setup.html': {
      purpose: "Fleet setup: six small quests per bus, so every bus has its papers, kit and plan on record.", roles: ['Coordinator', 'Fee Clerk'],
      tour: [
        { target: '#scope', text: "Pick a campus here when you can see more than one." },
        { target: '#board', text: "Each bus has six quests. Amber means we already found a value: check it and confirm." },
        { target: '#gaps', text: "What is still missing, in one short list." },
        { target: '#pending', text: "If you're offline, answers wait here and Send now sends them." },
      ],
    },
    'owner/index.html': {
      purpose: "Your home: Today with Buddy, the Set up the game quest, then every module.", roles: ['Owner'],
      tour: [
        { target: '#welcome-strip', text: "Your name and the whole school, at a glance." },
        { target: '#game-root', text: "This is Today. It also holds Set up the game: six short steps that switch the game on for everyone." },
        { target: '#modules', text: "Every module across all campuses sits here." },
      ],
    },
    'owner/transport/index.html': { purpose: "Fleet readiness for every campus: papers, safety kit, parts, drivers and fuel.", roles: ['Owner'] },
    'teacher/index.html': {
      purpose: "Your home: Today with Buddy, your score, events and timetable, then requests, evaluations and CW/HW.", roles: ['Teacher'],
      tour: [
        { target: '#game-root', text: "This is Today: your missions, the daily classwork and homework log, and your chapter quests." },
        { target: '#rankCard', text: "Your score so far. It is a draft, not your official incentive." },
        { target: '#eventsCard', text: "Upcoming events for your campus." },
      ],
    },
    'teacher/plan-activity.html': {
      purpose: "Plan one activity for a chapter. An overnight check marks it once your classwork shows it.", roles: ['Teacher'],
      tour: [
        { target: '#chapter', text: "The chapter you're planning for." },
        { target: '#activity', text: "One line is plenty: what will the children do?" },
        { target: '#save', text: "Save. Overnight, Buddy looks for it in your classwork and marks it." },
      ],
    },
    'office/index.html': {
      purpose: "The office home: today's list, with links to the Day Book, deposits, buses and hiring.", roles: ['Fee Clerk'],
      tour: [
        { target: '#campus-pick', text: "If you work across campuses, pick one here." },
        { target: '#today', text: "Today's list for your campus." },
        { target: '#sync-indicator', text: "Shows whether your entries have reached the server. Entries made offline wait and send later." },
      ],
    },
    'office/daybook.html': {
      purpose: "Write down the day's money entries for your campus.", roles: ['Fee Clerk'],
      tour: [
        { target: '#sync-indicator', text: "Shows whether your entries have been sent." },
        { target: '#today', text: "Pick the date, then add an entry or check the ones already made." },
      ],
    },
    'office/accounts.html': { purpose: "Accounts entries for your campus.", roles: ['Fee Clerk'] },
    'office/deposits.html': { purpose: "Record and send bank deposits for your campus.", roles: ['Fee Clerk'] },
    'office/close.html': { purpose: "Close the day for your campus.", roles: ['Fee Clerk', 'Staff'] },
    'office/report.html': { purpose: "Your campus's daily report for today.", roles: ['Fee Clerk', 'Staff'] },
    'office/buses.html': { purpose: "Fuel bills to check, then where your campus buses are now.", roles: ['Fee Clerk', 'Staff'] },
    'office/transport.html': { purpose: "Vehicle papers by document: upload a renewed paper where one is due.", roles: ['Fee Clerk'] },
    'office/hiring.html': { purpose: "The hiring legwork for your campus: interviews, documents and reports.", roles: ['Fee Clerk', 'Staff'] },
    'hiring/index.html': { purpose: "Hiring dashboard: applicants by role, appointments and decisions.", roles: ['Owner', 'Principal', 'Coordinator'] },
    'salary/index.html': { purpose: "The offer-letter calculator: work out and record a new hire's salary offer.", roles: ['Owner', 'Principal', 'Coordinator'] },
    'payroll/index.html': { purpose: "Monthly payroll: staff changes, leave, adjustments, holds and review.", roles: ['Owner'] },
    'staff/add-employee.html': { purpose: "Add or transfer staff, mark someone inactive, and track their documents.", roles: ['Owner', 'Coordinator', 'Principal'] },
    'curriculum-progress/daily-progress.html': { purpose: "Daily classwork progress across campuses: missing and overdue uploads.", roles: ['Owner', 'Coordinator', 'Principal', 'Teacher'] },
    'curriculum-progress/course-mapping-progress.html': { purpose: "Course mapping progress for 2026-27, school by school.", roles: ['Owner', 'Coordinator', 'Principal'] },
    'curriculum-progress/cwa-gap-report.html': { purpose: "The CWA gap report: where classwork activity is overdue or critical.", roles: ['Owner', 'Coordinator', 'Principal'] },
    'curriculum-progress/unmapped-chapters.html': { purpose: "Chapters not yet mapped to the curriculum plan.", roles: ['Owner', 'Coordinator'] },
    'curriculum-progress/course-mapping-admin.html': { purpose: "Set up schools, classes and progress thresholds for course mapping.", roles: ['Owner', 'Coordinator', 'Principal'] },
    'guide/index.html': { purpose: "The user guide: short answers for every role.", roles: [] },
  },
  articles: [
    { id: 'meet-buddy', title: 'Meet Buddy', roles: [], body: [
      "Buddy is the owl in the corner of every page. Tap Buddy to see what this page is for and what is next for you.",
      "Show me how walks you round the page, one step at a time. Search the guide finds an answer in a few words.",
      "Buddy is here to make the work lighter. Nothing here counts against you.",
    ] },
    { id: 'your-today-list', title: 'Your Today list', roles: ['Owner', 'Principal', 'Coordinator', 'Teacher'], body: [
      "On your home page, Today lists three to five pieces of real work, taken from the portal itself.",
      "Go opens the page where that work happens. A row shows Done once the work is done, so there is nothing to tick by hand.",
      "The next step also waits in a bar at the bottom of the page. Buddy greets you once a day, and shows you round the first time you visit.",
    ] },
    { id: 'quests', title: 'Quests', roles: ['Owner', 'Principal', 'Coordinator', 'Teacher'], body: [
      "A quest is a short run of real tasks. New steps open as you finish the one before. Your first quest shows you around the portal.",
      "Teachers also get a quest for each chapter they are teaching. The chapter quests run side by side, so you can work on any of them.",
      "You can leave a quest and come back. It keeps your place.",
    ] },
    { id: 'days-on-track', title: 'Days on track', roles: ['Owner', 'Principal', 'Coordinator', 'Teacher'], body: [
      "Days on track this month is a simple count of the days you kept up with the work Buddy follows.",
      "It is a monthly count, not a streak. A quiet day does not undo the days before it, and the count starts fresh each month.",
    ] },
    { id: 'teacher-log-card', title: 'The daily classwork and homework log', roles: ['Teacher'], body: [
      "Each working day, your Today list has a card for the classwork and homework log.",
      "Go opens the form. Once your entry is in, the card shows Done. If a day is a holiday, there is no card.",
    ] },
    { id: 'teacher-plan-activity', title: 'Plan an activity', roles: ['Teacher'], body: [
      "In a chapter quest, tap the step called Plan an activity for that chapter. Write one line about what the children will do, then Save.",
      "Overnight, Buddy looks for that activity in your classwork. When it finds it, the plan is marked. Until then it shows that it is being checked overnight.",
    ] },
    { id: 'decisions', title: 'Decisions: track-suit days', roles: ['Principal', 'Owner'], body: [
      "Sometimes Buddy asks for a school decision. The first one is which days students come in track suits.",
      "When the Owner opens the window, each Principal picks three days from Monday to Saturday for their campus, then confirms. If nobody picks, Monday, Wednesday and Friday are used.",
      "Buddy's outfit follows the choice: track suit on those days, school tie on the others.",
    ] },
    { id: 'fleet-setup', title: 'Fleet setup', roles: ['Coordinator', 'Fee Clerk', 'Owner'], body: [
      "Fleet setup gives every bus six small quests: Vehicle papers, Safety kit, Parts history, Driver card, Fuel pump and Capture plan.",
      "Amber means we already found a value. Check it and confirm it, or correct it. If you are offline, answers wait and Send now sends them later.",
      "Fee Clerks do papers, driver, fuel and parts for their school. Coordinators do the safety check and the timelapse run. The Owner sees how ready each campus is.",
    ] },
    { id: 'fee-clerk-buddy', title: 'Buddy for Fee Clerks', roles: ['Fee Clerk'], body: [
      "The office pages have the Buddy button too. Tap it for what the page is for, a tour, and the guide.",
      "Your fleet quests are on Fleet setup: papers, driver card, fuel pump and parts history for each bus at your school.",
    ] },
    { id: 'staff-signin', title: 'Signing in as staff', roles: ['Staff', 'Teacher'], body: [
      "Staff sign-in is switched on by the Owner. Once it is on, active employees sign in with their school email.",
      "Your role depends on your department, and some people are added by hand. If you cannot get in, ask your Principal.",
    ] },
    { id: 'setup-signin', title: 'Setup 1: Switch on staff sign-in', roles: ['Owner'], body: [
      "Open the Apps Script editor for the PDR project. Click Project Settings (the gear), scroll to Script Properties, then Edit script properties.",
      "Add a property named STAFF_AUTO_SIGNIN with the value on, exactly, then Save. Do the same in the game project.",
      "Names on the allowlist always keep their own role. This step shows Done once the game project has it.",
    ] },
    { id: 'setup-secret', title: "Setup 2: Set the overnight check's secret", roles: ['Owner'], body: [
      "In the game project's editor, open Project Settings, then Script Properties. Add GAME_PUSH_SECRET with a long random value, then Save.",
      "On the Mac that runs the overnight check, save the same value in the file ~/.lmcs/game_push_secret.",
      "Changing it later resets every activity check, so set it once and keep it private.",
    ] },
    { id: 'setup-refresh', title: 'Setup 3: Keep the teacher index fresh', roles: ['Owner'], body: [
      "In the game project's editor, run gameTeacherRefresh once and accept the Sheets and Calendar permissions.",
      "Click Triggers (the clock icon), then Add Trigger. Choose gameTeacherRefresh, event source Time-driven, type Minutes timer, every 30 minutes, then Save.",
      "This step shows Done once the index has been built in the last two hours, so it may take a little while.",
    ] },
    { id: 'setup-form', title: 'Setup 4: Add the classwork and homework form link', roles: ['Owner'], body: [
      "Open the LMCS Game sheet and go to the Game Config tab. Find the row named teacher and click its value cell.",
      "Add cwhwFormUrl to the JSON, with your Google Form link as the value. It must start with https://docs.google.com/forms/ or https://forms.gle/. Keep the other keys as they are.",
      "Teachers' Go button then opens that form.",
    ] },
    { id: 'setup-term', title: "Setup 5: Set this term's end date", roles: ['Owner'], body: [
      "In the Game Config tab, open the same teacher row. Inside it, find quests and set termEnd to a date written as YYYY-MM-DD.",
      "Chapters that start after that date drop out of the teachers' chapter quests.",
    ] },
    { id: 'setup-suit', title: 'Setup 6: Open the track-suit decision', roles: ['Owner'], body: [
      "In the LMCS Game sheet, open the Game Windows tab and find the row trackSuit.",
      "Fill in Opens and Closes, both as YYYY-MM-DD. Principals can choose their days between those dates.",
      "This step shows Done once both dates are in.",
    ] },
  ],
};
