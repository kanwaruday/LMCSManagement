# Forms inventory and game placement

Written 29 Oct 2026 for the game director. This is analysis only; no code changes.

**The owner's rule (29 Oct 2026):** every form must be reached through gameplay and must give a reward. Gameplay means a quest, a task-panel row or a building action. In the owner's words: "ensure that each form in the game is integrated in the game play".

This doc lists every form in the portal repo. For each form it records:
- who uses it;
- where its code lives;
- the field names it collects (names only, never values);
- the Apps Script action it saves through;
- whether gameplay reaches it today;
- where it should live in the game layer;
- what completing it should give.

The final section lists the forms that gameplay does not reach yet.

## How to read this

### What counts as a form

Counted:
- an HTML `<form>`;
- a sheet, modal or inline panel built in JS that saves data;
- a multi-step capture flow;
- an external Google Form that the portal links to or prefills.

One-tap writes (approve, tick, archive) are listed beside the form they belong to.

Not counted:
- read-only views, filters and search boxes;
- campus pickers (they only use localStorage);
- the Google sign-in gate.

### "Today" column: is gameplay reaching it now?

| Mark | Meaning |
|---|---|
| **Game** | A mission, quest step, event step or Kingdom link opens this form, or the form sits on a page that mounts the game panel for it. |
| **Dormant** | A game link exists but a Game Config flag switches it off today. |
| **Partial** | A game link lands nearby but not on the form. Examples: the wrong tab, a missing hash, or a page that only links onward. |
| **Room** | Reached only through a Principal Home Base room link (`principal/index.html` `PATHS`). This counts as a building action, but it gives no reward and only Principals have it. |
| **Standalone** | Reached only through portal navigation, a menu or a typed URL. |

**The floating Buddy dock is not counted.** `assets/auth.js` loads `assets/game/buddy-dock.js` on every signed-in page, but the dock only shows the next mission and links to the guide. It never opens a specific form.

### Placement model (proposed)

| Code | Where it lives |
|---|---|
| **Town** | Task panel, Town tab: school tasks, one row each. |
| **Wild** | Task panel, Wilderness tab: vehicles out on duty. |
| **Daily** | Task panel, Daily tab: the daily routine, with a ✓ claim. |
| **Q-Growth** | Quest list, Growth tab: long-term setup and backfill quests. |
| **Q-Daily** | Quest list, Daily tab: the routine. |
| **Room** | A building or room action: tap a room to open its panel. |
| **Hero** | Hero card: the staff record, which levels up as its data is filled. |

### Reward vocabulary (proposed, built on what exists)

| Reward | What it is | Exists today? |
|---|---|---|
| ✓ **claim** | A Daily-tab tick. It counts toward "days on track" (`LMCSGame.daysLine`, `game.js`) and the streak. | Days-on-track: yes. Claim button: new. |
| 🏗️ **tier** | Advances a Kingdom building tier (`kingdom.buildings` in `apps-script/game.gs:121`), which raises the base level and fires the Kingdom level-up card (`kingdom.js` `levelUps`). | Yes |
| 📜 **quest reward** | The `reward` line shown when a quest completes (`game.js:467`; `Game Quests` sheet column `Reward`). | Yes |
| 🦸 **Hero XP** | Fills the staff member's Hero card. The card levels by the share of their record that is complete. | New |
| 🚌 **bus status** | The bus on the Wilderness tab or the driver's Home Base turns green or gains a part level (`assets/game/bus-model.js`). | Partly (the model exists) |
| 🎉 **event %** | Counts toward a live event's school goal (`game-event.gs`). | Yes |

## What the game layer reaches today

**Pages that mount the game panel (`LMCSGame.mount`):**
- `principal/index.html`, `teacher/index.html`, `coordinator/index.html`, `owner/index.html`: Today panel, missions and quests.
- `coordinator/transport/index.html` and `coordinator/transport/setup.html`: `only:'fleet'`.
- `office/starting-data.html`: `only:'daybook'`.
- `setup/index.html`: `only:'cq'`.

**Home Base and Kingdom:**
- The Principal Home Base is `principal/index.html`. It draws a 3D school whose gold rooms open four room panels: `HOSTS = ['daily','hr','rules','setup']`.
  - The **Support Sessions room (`host:'ss'`) is never drawn gold**, because `ss` is not in `HOSTS` (`principal/index.html:180`).
- The Owner's Kingdom is `owner/kingdom.html` (`assets/game/kingdom.js`). It handles assign and allocate, and links to setup quests.

**Event card:**
- `assets/game/event.js` runs on the Principal, Coordinator and Fee Clerk home pages.
- Its steps link to `principal/support-sessions.html`, `coordinator/transport/rollcall.html`, `coordinator/transport/drivers.html`, `office/starting-data.html` and `office/daybook.html` (`apps-script/game.gs:152-172`).

**Driver Home Base:**
- `driver/index.html` with `driver/driver.js:173`: the driver's own bus, where every part is a tap.
- The part taps are read-only, and "Report a problem" is disabled ("Soon").

**Mission and quest `go:` links (`apps-script/game*.gs`) reach these pages:**
- `principals-daily-reporting/index.html`, `principal/issues.html`
- `coordinator/followups/`, `coordinator/systems/#approvals`
- `coordinator/transport/setup.html`, `coordinator/transport/rollcall.html`, `coordinator/transport/index.html`
- `office/starting-data.html`, `office/accounts.html`, `office/daybook.html`, `office/index.html`
- `teacher/plan-activity.html`, `teacher/index.html`
- `setup/index.html`
- the Teacher CW/HW Google Form (prefilled by `tchFormGo_` in `game-teacher.gs`).

**Backends.** Projects are listed in `apps-script/projects.json`. Requests are routed by:

| Project | Router |
|---|---|
| pdr | `main.gs` |
| coordinator | `coordinator.gs` |
| roster | `employee-roster.gs` and `staff-management-api.gs` |
| office | a per-file action table, posted through `office/js/outbox.js` and `office/js/api.js` |
| payroll | `payroll.gs` |
| game | `game.gs` |
| chapter | `ChapterTracker.gs` |

---

## 1. Principal portal

Role: Principal. Coordinators and the Owner can also open the PDR page.

| ID | Form | Files | Fields | Backend action | Today | Proposed placement | Reward |
|---|---|---|---|---|---|---|---|
| P1 | Principal's Daily Report | `principals-daily-reporting/index.html:447-570` (`submitReport` :1926) | reportDate, maNone, maClass (class/house on duty), maScore, tasksCompleted, selectedRegisters, tasksTomorrow (required), importantMsg; supportSessions is filled from the calendar | `savedailyreport` → `principal-dr.gs` (pdr) | **Partial.** The `pdr_report` mission (`game-missions.gs:185`) opens the page on its Home tab, not the report tab. | **Daily** row "File today's report", opening the report as a sheet. **Q-Daily** step. | ✓ claim (days on track); 🎉 event % on event days |
| P2 | Planned activities / My tasks | same page :516-526, Home card :336-343 (`homeAddTask_` :3111) | newPlannedDate, newPlannedText, newPlannedAssignee; homeNewTask, homeNewDue; a completed checkbox per row | `addplannedactivity`, `setplannedactivitycompleted`, `deleteplannedactivity` → `principal-dr.gs` (pdr) | Room (via P1) | **Town**: one row per open planned activity, completed from the row. Adding one is a step of P1. A task assigned to someone becomes a Town row for them. | ✓ per completed task |
| P3 | Support Session evaluation (native, 6 rubrics) | `principal/support-sessions.html` (submit :263-305) | school, ss-role, ss-employee, ss-score-<n> (one per rubric line) | `submitss` → `ss-forms-sync.gs`; the form shape comes from GET `ssformmeta` (pdr) | **Partial.** The event step links here (`game.gs:155`). The `ss_pace` mission and the principal quest step `ss_submit` go to the PDR page instead (`game-missions.gs:174`, `game-quests.gs:55`). The room is not gold (`ss` is not in `HOSTS`). | **Room**: Support Sessions (staff room). **Town** row "N sessions still needed this month" while the pace is behind. | 📜 progress toward the monthly SS target; 🦸 Hero XP (an evaluation stamp) for the person evaluated |
| P4 | Close a daily-report issue | `principal/issues.html:158-245` | note ("What was done") | `principalissueresolve` → `coordinator-principal.gs` (coordinator) | **Dormant.** `pdr_issue` missions and the quest step exist, but `principalIssuesReady: false` (`game.gs:96`). Otherwise reached through the Daily work room. | **Town**: one row per open issue, opening the close sheet | ✓; the issue counts toward the 🏗️ HQ "Messenger Post" tier |
| P5 | New approval request (13 categories, including hiring and leave) | `principals-daily-reporting/index.html:591-719` (`submitApprovalRequest` :2741) | aprCategory, aprUrgency, aprHiringRoleLevel, subjects, aprHiringReason, aprOutgoingEmployee, aprLastWorkingDay, aprTitle, aprDescription, aprItemName, aprQuantity, aprAmount, aprEvidenceLink, aprLinkedActivity | `submitapproval` → `approvals.gs` (pdr) | **Standalone** (Approvals tab, `#approvals`) | **Room**: Principal's office, "Raise a request". Hiring categories also open from the HR room. The request then waits as a **Town** row. | 📜 small on submit; the full reward arrives when it is decided |
| P6 | Approval comment / reply to "info requested" | same page :2674-2730 | aprCommentInput | `addapprovalcomment`, `deleteapprovalcomment` → `approvals.gs` (pdr) | **Partial.** The `info_requested` mission opens the PDR Home tab without `#approvals`. | **Town** row "They asked for more information", opening the reply sheet | ✓ (unblocks the request) |
| P7 | Hiring position actions | same page :2552-2590 | aprLwd (last working day), aprClose (reason for closing) | `changehiringreason`, `closehiring` → `approvals.gs` (pdr) | **Standalone** | **Room**: HR, on the position card | 📜 a hiring-quest step |
| P8 | Appointment accept / decline. The same box also appears on the Owner and Fee Clerk homes. | `assets/appointments.js:36-90` (mounted at `principal/index.html:262`) | ap-note (decline reason); Accept, Decline and Retry buttons | `apptdecide`, `apptcalendarretry` → `hiring-appointments.gs` (pdr) | **Partial.** It sits on the game-mounted home page, but no mission covers it. | **Town** row per pending appointment | ✓; adds the calendar event |

## 2. Teacher portal

Role: Teacher. Staff (non-teaching) use the request forms on the same page.

| ID | Form | Files | Fields | Backend action | Today | Proposed placement | Reward |
|---|---|---|---|---|---|---|---|
| T1 | New request, including leave | `teacher/index.html:245-289` (`submitApprovalRequest` :577) | aprCategory (Leave / Compensatory Leave / Other), aprUrgency, aprLeaveType, aprLeaveFrom, aprLeaveTo, aprTitle, aprDescription, aprEvidenceLink | `submitapproval` → `approvals.gs`; leave rules in `approvals-leave.gs` (pdr) | **Partial.** The event step "Check your requests" and the Staff `info_requested` mission go to `teacher/index.html`, which opens on Home, not the Requests tab. | **Room**: Staff room, "Ask for leave / make a request". It then waits as a **Town** row. | 🦸 Hero XP (the leave record stays complete); ✓ when decided |
| T2 | Approval comment / reply | `teacher/index.html:537-570` | aprCommentInput | `addapprovalcomment`, `deleteapprovalcomment` → `approvals.gs` (pdr) | Partial (as T1) | **Town** row from `info_requested` | ✓ |
| T3 | Plan an activity | `teacher/plan-activity.html:41-102` | activity; cls, subj, ch and name come from the URL | `teacherplanactivity` → `game-teacher.gs` (game) | **Game.** Reached only from the game: `activity_plan_due` mission, the chapter-quest step "Plan the activity", daily quest `plan_one` | Already right. Keep it in the **Q-Growth** chapter quest, plus a **Town** row when due. | 📜 chapter-quest step and quest reward (exists) |
| T4 | CW/HW log: an external Google Form, prefilled | `apps-script/game-teacher.gs:536-544` (`tchFormGo_`); base URL in Game Config `cwhwFormUrl` | class, subject, chapter, tag (CWA / Remediation) | Google Form responses; no handler in the repo | **Game** (missions `cw_today`, `hw_today`, `cwa_due`, `remediation_due` and chapter steps). **But** `cwhwFormUrl` defaults to empty, and the fallback `teacher/index.html#tags` matches no element, so the link lands on Home. | **Daily** ✓ "Log today's classwork / homework". **Q-Growth** chapter quest for the CWA and remediation steps. | ✓ claim (days on track); 📜 chapter-quest progress |
| T5 | Confirm what you teach | see SU1 | | | | | |

## 3. Coordinator portal (all sub-portals)

Role: Coordinator, and the Owner where noted. These pages do not mount the game panel: `hq.html`, the hub pages (`academics`, `events`, `finance`, `followups`, `hr`, `operations`, `systems`), `transport/live.html`, `capture.html`, `rollcall.html` and `drivers.html`.

| ID | Form | Files | Fields | Backend action | Today | Proposed placement | Reward |
|---|---|---|---|---|---|---|---|
| C1 | Mark a follow-up resolved (every hub) | `coordinator/shared.js:74-131`; the note is a browser `prompt()` at :120 | resolution note | `coordinatorresolvetask` → `coordinator.gs` (coordinator) | **Game.** Follow-up missions go to `coordinator/followups/` (`game-missions.gs:264`). | **Town**: one row per follow-up. Replace the `prompt()` with a sheet. | ✓; an overdue row turns red, and resolving it clears the warning on that school |
| C2 | Principal-report issue editor: acknowledge, assign, resolve, reopen, merge, undo merge | `coordinator/shared.js:679-694`, handlers :884-924 (systems hub) | status, assignee, note, "same problem as", reopen reason | `coordinatorpdrissue`, `coordinatorpdrmerge` → `coordinator-pdr.gs` (coordinator) | **Game.** The `issue_action` quest step goes to `coordinator/systems/index.html` (`game-quests.gs:52`). | **Town** row per new issue. **Room**: HQ "Messenger Post". | ✓; 🏗️ Messenger Post tier |
| C3 | Approval decision: approve, reject, request info, revoke, with optional allocation and referrals | `coordinator/approvals.js:286-380` | decision note, allocate-to person, due date, referrals (For Action / For Accountability / For Information) | `decideapproval` → `approvals.gs` (pdr), then `coordinatorallocate` → `coordinator-approvals.gs` (coordinator); referees from GET `approvalreferees` | **Game** for `approval_wait`; **Dormant** for `approval_recommend` (`recommendationsReady: false`, `game.gs:99`). Both go to `coordinator/systems/index.html#approvals`. | **Town** row "Decide: <request>", opening a decision card like the existing game decision sheet. Deciders only. | ✓; the requester's Town row resolves |
| C4 | Allocate, change or remove an approval follow-up | `coordinator/approvals.js:263-275`, :358, :402-409 | assignee, due date, note | `coordinatorallocate` → `coordinator-approvals.gs`; the Kingdom proxy is `kingdomallocate` (`game-kingdom.gs`) | **Game** for the Owner (Kingdom tray); otherwise as C3 | Owner: the Kingdom tray (exists). Coordinator decider: a step of C3. | Creates a **Town** row for the assignee |
| C5 | Approval comment | `coordinator/approvals.js:301-320` | comment | `addapprovalcomment`, `deleteapprovalcomment` → `approvals.gs` (pdr) | As C3 | Inside the C3 card | ✓ |
| C6 | Archive / unarchive approvals (one-tap, single or bulk) | `coordinator/approvals.js:204-230`, :382-400 | the requests selected | `archiveapproval` → `approvals.gs` (pdr) | **Standalone** | **Room**: the HQ approvals ledger, as a list action. Housekeeping. | none (housekeeping) |
| C7 | Coordinator recommendation on an approval | `coordinator/hq.html:337-460` (`<form>`) | recommendation (approve / reject / ask for information), reason, what I checked | `coordinatorrecommend` → `coordinator-recommend.gs` (coordinator) | **Not reachable.** No page links to `hq.html`. The `approval_recommend` mission points at `systems#approvals`, which only shows recommendations, and the mission is switched off. | **Town** row "Recommend on <request>", opening this form as a sheet | ✓; the track record on HQ (exists) |
| C8 | Close a transport follow-up (required note). Also on the Owner transport page. | `coordinator/transport-checks.js:148-170` (mounted on `coordinator/transport/live.html` and `owner/transport/index.html`) | "What did you do?" | `coordinatorresolvetask` → `coordinator.gs` (coordinator) | **Standalone.** No game link reaches `live.html`. | **Wild** row on that bus | 🚌 the bus returns to green |

## 4. Transport: shared by Coordinator, Fee Clerk and Owner

Pages: `coordinator/transport/*`, `office/buses.html`, `office/transport.html`, `owner/transport/index.html`.

| ID | Form | Files | Fields | Backend action | Today | Proposed placement | Reward |
|---|---|---|---|---|---|---|---|
| TR1 | Fleet setup quests: six per bus | `coordinator/transport/setup.html`, `coordinator/capture/setup.js:248-497`, fields in `coordinator/capture/fleet-quests.js:17-105` | **Papers:** make, model/variant, chassis no., engine no., fuel, emission norm, seats on RC, registration date, odometer + photo, dealer, warranty till, usual workshop, tyre size, notes. **Safety kit:** attendant/helper, notes; equipment answers come from TR4. **Parts history** (20 parts): last replaced on, odometer then, workshop, cost, bill kept?, notes. **Driver card:** driver phone, licence class, licence valid till, date of birth, medical valid till, police verification + date, driver photo, notes. **Fuel pump:** usual pump, payment, smartphone for video?, who gets video/bill, notes. **Capture plan:** school phone, mount/charger ready, timelapse date, count date, coordinator riding, notes. | `coordinatortransportfleetsave` → `coordinator-transport.gs` (coordinator); photos `capturefile` → `transport-capture.gs` (roster) | **Game.** `fleetGo_` quest, parts-due and per-bus links (`game-fleet.gs:311`); the page mounts `only:'fleet'` | Keep: one **Q-Growth** quest per bus. Also a **Room** action on the bus in the Garage. The driver-card step also feeds the driver's **Hero** card. | 🚌 the bus gains a level; 🏗️ Garage tier "Papers for every bus" (currently `soon`); 🦸 driver Hero XP |
| TR2 | Timelapse route run | `coordinator/transport/capture.html`, `coordinator/capture/capture.js:334-560` | bus, "outside school hours, no children" (required), per-stop stop name or new place name, stop photo, GPS frames (automatic) | `capturerun`, `capturefile` → `transport-capture.gs` (roster); queued on the phone and sent later | **Partial.** Reached only from the capture-plan step of TR1. No `go:` link. | **Wild**: the bus is out on a mapping run. Also a **Q-Growth** step of TR1. | The route is drawn on the World map; 📜 quest step |
| TR3 | Passenger count run | same page and file, count mode :456-533 | bus, per stop: got on, got off | `capturerun` → `transport-capture.gs` (roster) | Partial (as TR2) | **Wild** | Stop loads appear on the World map; 📜 |
| TR4 | Monthly safety check | `coordinator/capture/capture.js:686-850` | per item on the Owner's list: yes/no, photo, date on certificate/tag | `capturerun`, `capturefile` → `transport-capture.gs` (roster) | **Partial.** Reached from the TR1 safety step and from follow-up links. | **Town** monthly row per bus. **Room** action in the Garage. | 🚌 a safety badge for the month |
| TR5 | Daily roll call: on duty (one-tap) or substitute | `coordinator/transport/rollcall.html`, `coordinator/capture/rollcall.js:84-172` | date (today/yesterday), substitute driver, attendant / no attendant | `coordinatortransportrollcall` → `coordinator-transport.gs` (coordinator) | **Game** (`fleet_ops_rollcall` missions, `game-fleet.gs:529-534`; Coordinator event step) | **Wild**: one row per bus out today, ✓ on duty. Also **Daily** ✓ "Roll call done" for the Fee Clerk. | ✓ claim; 🚌 the bus shows as crewed |
| TR6 | Driver phone link: create (QR) and revoke | `coordinator/transport/drivers.html:36-42`, `coordinator/capture/drivers.js:58-107` | bus, driver name, employee code (optional); revoke is a two-tap action | `driverlinkcreate`, `driverlinkrevoke` → `driver-link.gs` (roster) | **Partial.** Only the Fee Clerk event step links here (`game.gs:165`). | **Q-Growth** "Link every driver's phone". **Room** action on the bus in the Garage. | Unlocks that driver's Home Base; 🦸 driver Hero XP |
| TR7 | Transport paper upload, per vehicle × paper cell | `coordinator/shared.js:299-576` (on `coordinator/transport/index.html` and `office/transport.html`) | file (PDF or photo) | `transportupload` → `transport-uploads.gs` (roster) | **Game** (`fleet_ops_paper` missions → `coordinator/transport/index.html`, `game-fleet.gs:507`). Fee Clerk renewal missions open `setup.html` instead of `office/transport.html`. | **Town** row when a paper is about to expire. **Room**: Garage. | 🚌 the bus stays road-legal (green); 🏗️ Garage tier |
| TR8 | Fuel bill check: Fee Clerk, two-button answer | `coordinator/transport-checks.js:37-65` (on `office/buses.html`) | answer: the slip matches the bill / the bill was wrong and the Day Book was corrected | `transportclerkcheck` → `coordinator-transport-gps.gs` (coordinator) | **Partial.** The `fleet_ops_fuel_answer` mission goes to `office/index.html` (`game-fleet.gs:542`), not `office/buses.html`. | **Wild** row on that bus's fill | ✓ |
| TR9 | Safety loadout editor (Owner) | `owner/transport/index.html:87-163` | item name, needs photo, needs date, on/off, order, new item | `coordinatortransportloadout` (POST) → `coordinator-transport.gs` (coordinator) | **Standalone** | **Q-Growth** (Owner) "Set the safety list". **Room**: HQ Garage. | 🏗️ HQ tier |

## 5. Office portal (Fee Clerk, PRO, Finance)

Pages: `office/*.html` with `office/js/*.js`. Only `office/starting-data.html` mounts the game panel. `office/index.html` carries the event card.

| ID | Form | Files | Fields | Backend action | Today | Proposed placement | Reward |
|---|---|---|---|---|---|---|---|
| O1 | Day Book entry | `office/daybook.html`, `office/js/daybook.js:211-380` | date, money account, category, amount, payee / received from, narration, charged to, paid/received by, cash bucket, supplier bill no., vehicle, parts, collection, litres, odometer, odometer note, fill video, bill/receipt photo, supplier account settled, bills settled | `file.upload` → `office-files.gs`; `daybook.add` → `office-daybook.gs` (office) | **Partial.** The event step "Practise one Day Book entry" is a self-tick. Fee Clerk fleet missions link here (`game-fleet.gs:487`). | **Daily** ✓ "Day Book up to date". **Room**: Treasury. | ✓ claim; counts toward a clean day close |
| O2 | Reverse a Day Book entry (one-tap) | `office/js/daybook.js:386-396` | none (confirm only) | `daybook.reverse` → `office-daybook.gs` (office) | **Standalone** | **Room**: Treasury, as a row action | none (correction) |
| O3 | Add fill video to a fuel entry | `office/js/daybook.js:398-417` | video file | `file.upload`, `daybook.attach_video` → `office-daybook.gs` (office) | **Standalone** | **Wild** row "Fill on <bus> has no video" | ✓; 🚌 fuel proof complete |
| O4 | Cash handover: send, accept (one-tap), "not received" | `office/js/handover.js:42-84` (on the Day Book and office home) | receiving cash box, from which cash, amount, note; dispute note | `cash.handover`, `cash.accept`, `cash.dispute` → `office-handover.gs` (office) | **Standalone** | Sender: **Room** Treasury. Receiver: **Town** row "Accept cash from <school>". | ✓ for both sides |
| O5 | Accounts setup: add account, opening balance, add vehicle, import buses (one-tap), add or switch collections | `office/accounts.html`, `office/js/accounts.js:201-262` | account type, account name; account, opening amount; vehicle type, registration number, vehicle name; collection name, on/off | `account.add`, `account.opening`, `vehicle.add`, `vehicles.import`, `collection.add`, `collection.set_active` → `office-config.gs` (office) | **Standalone** | **Q-Growth** (Finance Head / Owner) "Set up the Treasury" | 🏗️ Treasury / Collection heads tier |
| O6 | Fund transfer | `office/js/accounts.js:215-223` | from account, to account, amount, date, bank reference, narration | `fund.transfer` → `office-deposits.gs` (office) | **Game.** The bank-side Day Book quest step "Make one test fund transfer" (`game-office.gs:158`) links here. | **Q-Growth** step (exists), then **Room**: Treasury | 📜 quest step; ✓ |
| O7 | Bank deposit and ERP collection total | `office/deposits.html`, `office/js/deposits.js:108-151` | collection day covered, amount deposited, bank reference, deposit slip; ERP collection total | `file.upload`, `deposit.add`, `erp.set` → `office-deposits.gs` (office) | **Standalone** (office Today list) | **Daily** ✓ "Bank yesterday's cash" | ✓ claim |
| O8 | Fee Clerk daily report | `office/report.html`, `office/js/report.js:54-118` | report date, hourly notes, footfall, positive feedback, negative feedback, leave status, external documents received, cash petty / fee / other | `report.submit` → `office-report.gs` (office) | **Standalone** | **Daily** ✓ "File the office report". **Q-Daily** step. | ✓ claim |
| O9 | Close Day: close, sign deposit (one-tap), opening balances | `office/close.html`, `office/js/close.js:56-146` | day to close; cash petty, cash fee, cash other, bank, UPI | `day.close` → `office-close.gs`; `deposit.sign` → `office-deposits.gs`; `opening.set` → `office-config.gs` (office) | **Standalone** | **Daily** ✓ "Seal the day" (Finance Head / Owner). Opening balances go once into **Q-Growth**. | ✓ claim; "day sealed" |
| O10 | Driver fills: confirm (one-tap), reject, paid-from → Day Book | `office/driver-fills.html`, `office/js/driver-fills.js:39-86` | reject reason; paid from (account or cash bucket) | `driverfilldecide` → `driver-fill-confirm.gs` (roster); `driverfill.daybook` → `office-driver-fills.gs` (office; off until after 31 Oct) | **Standalone.** Linked only from `office/buses.html`. | **Wild**: one row per incoming fill | ✓; the driver's Home Base shows the fill as confirmed |
| O11 | Hiring: propose an interview/demo time, cancel | `office/hiring.html`, `office/js/hiring.js:221-234`, :312-315 | date and time, minutes, place, note; cancel note | `apptpropose`, `apptcancel` → `hiring-appointments.gs` (pdr) | **Standalone** | **Town** row "Book <applicant>'s interview" | ✓; the applicant moves a stage |
| O12 | Hiring: upload an interview or demo report | `office/js/hiring.js:236-290` | the same fields as H5 / H6, plus the scanned report file | `hiringuploadreport` → `hiring.gs` (pdr) | **Standalone** | **Town** row after the appointment | ✓; the applicant moves a stage |
| O13 | Hiring: add a walk-in applicant | `office/js/hiring.js:293-305` | name, mobile number, school, came through, subjects/role, highest qualification, notes | `hiringaddapplicant` → `hiring.gs` (pdr) | **Standalone** | **Room**: Front office, "Walk-in" | 📜 small |
| O14 | Starting data: quest items, send / approve / return, Owner seed | `office/starting-data.html`, `office/js/starting-data.js:229-366`; item model `office-start.gs:41-60` | **Cash:** counted, who holds it, counted by. **Bank:** school, bank, branch, last 4 digits, used for, balance. **Suppliers:** supplier, what we buy, schools, owed, settled by, how often. **Odometers:** registration, school, odometer, in use. **Loans:** registration, lender, EMI, EMI day, interest part, principal outstanding, last EMI, no-loan skip. **Portal users:** name, email, school, role, starts on. **Return:** what needs fixing. **Seed:** JSON file. | `start.save`, `start.submit`, `start.approve`, `start.seed` → `office-start.gs` (office) | **Game** (`daybookGo_` in `game-office.gs:42`; event step; Treasury tiers; the page mounts `only:'daybook'`) | Keep in **Q-Growth** | 🏗️ Treasury tiers (exists) |

## 6. Driver portal

Page: `driver/index.html` with `driver/driver.js`. A driver opens it through a QR link or Google sign-in. It does not load `auth.js`, so it has no Buddy dock.

| ID | Form | Files | Fields | Backend action | Today | Proposed placement | Reward |
|---|---|---|---|---|---|---|---|
| D1 | Fuel fill capture (6 steps, offline queue) | `driver/driver.js:264-372`, steps in `driver/driver-logic.js:90-96` | pump meter video, bill photo, litres, amount, odometer | `driverfuel` → `driver-fuel.gs` (roster) | **Partial.** Reached from the page's own next-step rail and fuel tile. Not linked from the Home Base bus or the game backend. | **Room**: Home Base bus, tap the fuel tank and choose "Log fuel". Also a **Wild** row while the bus is on duty. | 🚌 fuel gauge filled; ✓ once the clerk confirms (O10) |
| D2 | Link this phone with Google | `driver/driver.js:387-405` | Google sign-in only | `driverlinkself` → `driver-google.gs` (roster) | **Standalone.** Shown only while the phone is unlinked. | **Q-Growth** onboarding step "Link your phone" | Unlocks the Home Base |
| — | Report a problem on a bus part | `driver/driver.js:216` | not built ("Soon") | none yet | Not built | When built: **Room** (tap the part on the Home Base bus), creating a **Wild** / **Town** row for the Coordinator | 🚌 |

## 7. Owner portal

Pages: `owner/index.html` (mounts the game panel), `owner/kingdom.html` (Kingdom), `owner/people.html`, `owner/transport/index.html` (see TR9 and C8).

| ID | Form | Files | Fields | Backend action | Today | Proposed placement | Reward |
|---|---|---|---|---|---|---|---|
| OW1 | Quest-step tick and decision sheet | `assets/game/game.js:563-610` | decision options, note | `ownertick` → `game-setup.gs`; `gamedecide` → `game-actions.gs` (game) | **Game** (native) | Keep (**Q-Growth** / **Town**) | 📜 (exists) |
| OW2 | Kingdom: assign / reassign / clear a setup step; allocation-tray follow-up | `assets/game/kingdom.js:561-624`, :693-704 | who, note; head, due date, note | `kingdomassign`, `kingdomallocate` → `game-kingdom.gs` (game) | **Game** (native) | Keep | Creates a **Town** row for the assignee |
| OW3 | People: add / change / remove a Coordinator | `owner/people.html:92-147` | name, email (add only), school, looks after (functions) | `peoplecoordinator` → `game-people.gs` (game) | **Partial.** The page uses game UI helpers and is linked from Owner home tiles. No mission or quest links to it. | **Room**: HQ "People". **Hero** card per Coordinator. | 🏗️ HQ tier "Who holds each role"; 🦸 Hero XP |
| OW4 | Ask Buddy / confirm | `assets/game/buddy-dock.js:152-224` | free-text question; send / decline | `buddyask`, `buddyconfirm` → `game-buddy.gs` (game) | **Game** (native) | Keep | none |

## 8. Hiring dashboard

Page: `hiring/index.html`. Roles: Principal, Coordinator, Owner. Fee Clerks are sent to O11-O13.

**How it is reached today:** a Principal reaches it through the HR room (**Room**). Coordinators reach it through follow-up links; the Owner portal has no direct link. No game mission links to it.

Every write goes to pdr, through `main.gs`. `hiring*` actions are handled in `hiring.gs`, and `appt*` actions in `hiring-appointments.gs`.

| ID | Form | Lines | Fields | Backend action | Proposed placement | Reward |
|---|---|---|---|---|---|---|
| H1 | Add applicant (modal) | 715-734, 831-850 | name, mobile number, school, came through, subjects/role, highest qualification, B.Ed/TET, age, gender, CV link, notes, book interview now | `hiringaddapplicant` (+ `apptpropose`) | **Room**: HR, "New applicant" | 📜 small |
| H2 | Shortlist / un-shortlist (one-tap) | 519-520, 876-878 | none | `hiringshortlist` | **Room**: HR, applicant card | none (sorting) |
| H3 | Book an interview, demo or MD interview; cancel; calendar retry; accept / decline | 361-392, 534-581, 879-902 | what, when, place, note; decline reason | `apptpropose`, `apptcancel`, `apptcalendarretry`, `apptdecide` | **Town** row per applicant waiting on a time or on a decision | ✓; the applicant moves a stage |
| H4 | Confirm a rejection (one-tap) | 554-559, 903-905 | none | `hiringconfirmreject` | **Town** row | ✓ |
| H5 | Interview report | 668-697, 795-814 | interview date, position, confidence, English, capability grid (subject × class), spouse/family occupation, family support, remarks on qualifications, other skills, experience (school, periods/week, timing, extra work, classes, subjects, last salary), commitment, minimum salary expected, strengths, weaknesses, remarks, recommendation, reject reason/note, scanned report | `hiringsubmitinterview` / `hiringuploadreport` | **Town** row "Report <applicant>'s interview" | ✓; the applicant moves a stage |
| H6 | Demo report | 699-713, 816-829 | demo date, class, subject, 8 rubric scores, student feedback, strengths, areas to improve, remarks, recommendation, next demo time, reject reason/note, scan | `hiringsubmitdemo` / `hiringuploadreport` | **Town** row "Report <applicant>'s demo" | ✓; the applicant moves a stage |
| H7 | Stage and status: done-report-later (one-tap), notes, date of joining, mark hired, reject (reason, note), revive (why) | 568-639, 911-930 | notes, date of joining, reject reason, reject note, revive reason | `hiringmarkstage`, `updatehiringstatus`, `hiringrevive` | **Room**: HR, applicant card | Mark hired = 📜 **hiring quest complete**: the position is filled, and the new hire's **Hero** card is created |
| H8 | Start the hiring process (one-tap; opens staff documents) | 606, 917-921 | none | `hiringstarthire` | **Town** row "Start <new hire>'s paperwork" | 🦸 starts Hero card XP |
| H9 | Refresh the tracker (one-tap, Owner/Coordinator) | 960-976 | none | `hiringrefreshtracker` | **Room** action (housekeeping) | none |
| H10 | Appointment letter (print only; no backend write) | 997-1047 | editable letter fields | none | **Room**: HR, on a hired applicant | none |

## 9. Staff documents and directory

Page: `staff/add-employee.html`. Despite the page title, adding and transferring staff moved to Payroll (PY2, PY4).

**How it is reached today:** a Principal reaches it through the HR room (**Room**). Fee Clerks use the office nav. Coordinators use follow-up links, and the hiring redirect also lands here. No game link reaches it, and the page does not mount the game panel.

Backend: roster.

| ID | Form | Lines | Fields | Backend action | Today | Proposed placement | Reward |
|---|---|---|---|---|---|---|---|
| S1 | Upload a missing document (per cell) | 609-610, 744-772 | file (PDF or photo); employee and document type come from the cell | `uploaddocument` → `staff-documents.gs` | Room / Standalone | **Hero**: each missing document is an empty slot on the card. Also a **Town** row per staff member with gaps. | 🦸 Hero XP per document |
| S2 | Document rules editor (Owner) | 236-243, 657-708 | designation × document grid (required / optional / not needed) | `savedocrules` → `staff-documents.gs` | **Standalone** | **Q-Growth** (Owner): Staff Quarters "Document rules" | 🏗️ Staff Quarters tier |
| S3 | Reassign a certificate (needs verification) | 808-865 | correct employee, remarks | `reassigncertificate` → `staff-management-api.gs` | **Standalone** | **Town** row per unverified certificate (Coordinator) | ✓; 🦸 Hero XP for that staff member |
| S4 | Auto-resolve from response sheets (one-tap) | 225, 870-896 | none | `autoresolvequeue` → `staff-management-api.gs` | **Standalone** | Room action (housekeeping) | none |
| S5 | Mark inactive (**tab disabled**) | 198, 245-266, 1002-1018 | employee, date of resignation, date of relieving | `markinactive` → `staff-management-api.gs` | **Not reachable** (disabled) | **Hero** card action "Leaving", or fold it into PY5 | Closes the Hero card |

## 10. Payroll

Page: `payroll/index.html`. Owner only. Reached from the Owner home "Payroll" module, the hiring "Mark Joined in Payroll" button and the salary page header (**Standalone**). The page does not mount the game panel.

Backend: payroll (`payroll.gs`) unless marked roster (`staff-management-api.gs`).

| ID | Form | Lines | Fields | Backend action | Proposed placement | Reward |
|---|---|---|---|---|---|---|
| PY1 | Monthly step "Mark done" (one-tap) | 388-393, 855-857 | none | `markstep` | **Town** rows for the month's payroll steps, near month end | ✓ per step |
| PY2 | Offer → Joined (new hire); dismiss offer (one-tap) | 416-437, 858-881 | reports to, class/subject rows, joined on | `addnewhire` (roster), then `joinoffer`; `dismissoffer` | **Hero** card action "Joined"; **Town** row from H7 | 🦸 Hero card created / levels up |
| PY3 | Add to payroll | 439-448, 882-890 | full basic, EPF, RRF, tuition | `addemployee` | **Hero** action | 🦸 Hero XP (pay section complete) |
| PY4 | Start transfer; apply transfer (one-tap) | 450-460, 891-909 | employee, new school, role, reports to, class/subject rows | `transfer` (roster); `applytransfer` | **Hero** action "Transfer" | 🦸 the Hero card moves school |
| PY5 | Mark left | 462-467, 910-916 | last working day | `markleft` | **Hero** action "Leaving" | Closes the Hero card |
| PY6 | Leave inputs: template upload, override one person, per-person editor | 490-539, 646-701, 925-975 | leave counts per type, opening CL, opening comp, vacation rule, vacation working days, vacation days worked, paid days, CL encashed | `previewleave` (read), `uploadleave`, `saveinputs` | **Town** monthly row "Load this month's leave" | ✓ |
| PY7 | Adjustments: add / remove | 704-726, 976-988 | employee, type, amount, note, through month | `addadjustment`, `deleteadjustment` | **Hero** action, plus the monthly **Town** flow | none |
| PY8 | Loan recovery skip/resume; holds | 730-758, 917-924, 989-998 | skip reason; employee, hold type, release | `saveinputs` | Inside the monthly **Town** flow | none |
| PY9 | Lock / unlock a school's month | 823-843, 1002-1017 | none (confirm) | `lock`, `unlock` | **Town** row "Lock <school>'s payroll" | 📜 "Payday": the month is sealed |
| PY10 | Rejoined staff | 1175-1177, 1371-1383 | employee (new code), old code, service start | `rejoin` | **Hero** action | 🦸 |
| PY11 | Salary advance / RRF loan | 1182-1184, 1384-1388 | employee, type, amount, monthly recovery, given on, start month, note | `issueloan` | **Hero** action | none |
| PY12 | Full & final settlement | 1197-1227, 1389-1398 | CL days, CL rate, notice pay, other earnings, notice recovery, collection from students, ward fee, other dues, paid on, mode, reference, notes | `fnfpreview` (read), `settlefnf` | **Town** row after PY5; **Hero** action | Closes the Hero card |
| PY13 | Opening balances import | 1264-1279, 1399-1418 | mapping workbook, accept suggestions, replace | `importopening` | **Q-Growth** (once) | 📜 |
| PY14 | Annual increment: apply / undo | 1107-1117, 1318-1370 | increments to apply, employee checkboxes | `applyincrement`, `undoincrement` | **Q-Growth** yearly quest | 📜 |
| PY15 | Bank letter "Record" | 1468-1510, 1740-1750 | reference serial, date, cheque no., addressed to, debit account | `issueletter` | Part of the PY9 "Payday" step | ✓ |

## 11. Salary offer

Page: `salary/index.html`. Roles: Principal, Coordinator, Owner. Reached from the HR room (**Room**), the hiring "Salary offer" button, the Owner modules and the payroll header.

| ID | Form | Lines | Fields | Backend action | Proposed placement | Reward |
|---|---|---|---|---|---|---|
| SA1 | Offer calculator → "Record as Salary Offer" | 109-170, 596-680 | candidate name, campus, designation, subjects, existing employee, designation-based salary, LMS experience, other experience, pre-basic pay, grade pay, assigned hours, ideal hours, EPF applicable, ESI applicable, MD EPF exemption, child's grade, second child's grade, tuition fee waiver | `updatehiringstatus` → `hiring.gs` (pdr); `submitapproval` "Salary Offer Approval" → `approvals.gs` (pdr); `recordoffer` → `payroll.gs` (payroll) | **Town** row "Make <applicant>'s offer", raised by H7 at the Salary Offer stage | ✓; the applicant moves a stage |
| SA2 | Request EPF exemption (one-tap) | 539-556 | none | `submitapproval` → `approvals.gs` (pdr) | A step inside SA1 | none |

## 12. Setup quests (confirm values)

Page: `setup/index.html` with `assets/setup/confirm-values.js`. Already game-native: the page mounts `only:'cq'`, and the quests appear in the Today panel and the Kingdom.

| ID | Form | Files | Fields | Backend action | Today | Proposed placement | Reward |
|---|---|---|---|---|---|---|---|
| SU1 | Setup quest item form, plus "I do not teach this" / "I do not teach any classes" (one-tap) | `assets/setup/confirm-values.js:236-320`; definitions in `apps-script/game-confirm.gs:25-66` | **t1 Confirm what you teach** (live): class, subject. **p1** (draft): class, section, class teacher, students. **p2** (draft): period, starts, ends, days. **p3** (draft): house, colour, how students are placed. | `setupsave` (GET `setupget`) → `game-confirm.gs` (game) | **Game** (`cqMissions_` / `cqQuests_`, Kingdom links) | Keep in **Q-Growth**. t1 also fills the teacher's **Hero** card. | 🏗️ School Hall / Academy / Staff Quarters tiers; 🦸 Hero XP |

## 13. Curriculum and progress

Pages: `curriculum-progress/*`. Reached from the Principal's Daily work room through `daily-progress.html`. No page mounts the game panel.

| ID | Form | Files | Fields | Backend action | Today | Proposed placement | Reward |
|---|---|---|---|---|---|---|---|
| CP1 | CWA "Mark as taken": single (two `prompt()`s) and bulk `.xlsx` | `curriculum-progress/cwa-gap-report.html:344-372`, :546-650 | actual CWA date, note; bulk columns School, Class, Subject, ChapterName, ActualCWADate, RowKey, Note | GET `?overrideData=` → `ChapterTracker.gs` (chapter; no action name) | **Standalone** (Coordinator/Owner; the server does not check the role) | **Town** row per CWA gap (Coordinator). Replace the prompts with a sheet. | ✓; 🏗️ Academy tier "Chapter quests running" |
| CP2 | Course Mapping Admin config | `curriculum-progress/course-mapping-admin.html:223-641` | school rows, class rows, thresholds, exemptions, sheet and proxy settings, import area | none: browser `localStorage` only | **Standalone** | Not a real backend form. Its job belongs to the Academy setup quest `cq:cac` "Course maps and terms" (**Q-Growth**). Retire it, or back it with that quest. | 🏗️ Academy tier |

## 14. External Google Forms

| ID | Form | Where referenced | Fields | Status | Proposed placement |
|---|---|---|---|---|---|
| X1 | Six legacy Support Session Google Forms, embedded in the PDR Support Sessions tab | `principals-daily-reporting/index.html:362-445`, `:771-889`; synced by `ss-forms-sync.gs` | staff name dropdown, rubric items | Superseded by P3 on 28 Oct, but still embedded, and the `ss_pace` mission lands here | Retire the embeds and send every SS route to P3 |
| X2 | Teacher CW/HW Google Form | see T4 | class, subject, chapter, tag | Live through the game when `cwhwFormUrl` is set | As T4; longer term, a native form |
| X3 | Teaching applicants application form (public) | `apps-script/hiring.gs:46-75` (no URL in the repo) | timestamp, name, phone, age, subjects, campuses, qualification, B.Ed/TET, gender, CV | Live (public applicants, outside the staff game) | No placement, since it is public. Each new response should raise an HR **Town** row ("New applicant to screen"). |
| X4 | Interview Report Google Form (legacy) | `apps-script/hiring-audit.gs:16`, `hiring-form.gs` | interview rubric | Superseded by H5 / H6 | Retire |
| X5 | Staff Document Submission forms (one per campus) | `hiring/index.html:187-197`, `office/js/hiring.js:13` | name, employee ID, job role, document uploads | Dead in the UI: `docUrl` is computed but never rendered | Retire (S1 replaces it) |

---

## Broken or switched-off links found along the way

These are issues for the game director to know about, not fixes. They are why several forms are marked **Partial** or **Dormant**.

1. **The Support Sessions room is never gold.** `HOSTS` in `principal/index.html:180` leaves out `ss`, and the `ss_pace` mission and `ss_submit` quest step go to the PDR page (`X1`), not to P3.
2. **Daily-report issue missions are switched off**: `principalIssuesReady: false` (`game.gs:96`).
3. **Recommendations are not reachable.** `recommendationsReady: false` (`game.gs:99`), `coordinator/hq.html` has no inbound link, and the mission target `systems#approvals` has no form to make a recommendation.
4. **The `pdr_report` and `info_requested` links land on the PDR Home tab**, with no tab or `#approvals` hash.
5. **Teacher request links land on Home, not the Requests tab.** The CW/HW fallback `teacher/index.html#tags` matches no element (the panel's id is `panel-tags`).
6. **`fleet_ops_fuel_answer` goes to `office/index.html`**, not to `office/buses.html` where TR8 lives.
7. **Fee Clerk paper renewals go to `coordinator/transport/setup.html`**, not to `office/transport.html` (TR7).
8. **`staff/add-employee.html` "Mark inactive" is a disabled tab** (S5).

---

## Forms not yet reachable from gameplay

**Not yet reachable** means one of three things:
- **Standalone**: only portal navigation, a menu or a typed URL reaches it;
- **Not reachable**: no inbound link at all, or a disabled tab;
- **Dormant**: the game link is switched off.

The owner's rule needs each one placed. The second table lists forms that are reachable but still fall short of the rule.

| Form(s) | Portal / role | Today | Proposed placement | Reward |
|---|---|---|---|---|
| C7 Coordinator recommendation | Coordinator | Not reachable (no link to `hq.html`; mission off) | Town | ✓, track record |
| S5 Mark inactive | Owner / Coordinator | Not reachable (tab disabled) | Hero action (or merge into PY5) | Closes the Hero card |
| P4 Close daily-report issue | Principal | Dormant | Town | ✓, 🏗️ Messenger Post |
| P5 New approval request; P7 hiring position actions | Principal | Standalone | Room (Office / HR), then Town | 📜 |
| C6 Archive approvals | Coordinator / Owner | Standalone | Room (housekeeping) | none |
| C8 Close transport follow-up | Coordinator / Owner | Standalone | Wild | 🚌 |
| TR9 Safety loadout editor | Owner | Standalone | Q-Growth / Room | 🏗️ |
| O2 Reverse entry, O3 add fill video, O4 cash handover | Fee Clerk / desk | Standalone | Room (Treasury), Wild, Town | ✓ |
| O5 Accounts setup | Finance Head / Owner | Standalone | Q-Growth | 🏗️ Treasury |
| O7 Deposit + ERP, O8 daily report, O9 close day | Fee Clerk / Finance Head | Standalone | Daily | ✓ claim |
| O10 Driver fills confirm / reject | Fee Clerk / Coordinator / Owner | Standalone | Wild | ✓, 🚌 |
| O11-O13 Office hiring (propose, report, walk-in) | Fee Clerk | Standalone | Town / Room | ✓ |
| D2 Link phone with Google | Driver | Standalone | Q-Growth onboarding | Unlocks the Home Base |
| H1-H10 Hiring dashboard | Coordinator / Owner (a Principal has the HR room) | Standalone; Room for the Principal | Town (next step per applicant), Room (HR) | ✓ per stage; 📜 on hire |
| S1-S4 Staff documents | Coordinator / Owner / Fee Clerk (a Principal has the HR room) | Standalone; Room for the Principal | Hero, Town, Q-Growth | 🦸 Hero XP, 🏗️ |
| PY1-PY15 Payroll | Owner | Standalone | Town (monthly), Hero actions, Q-Growth | ✓, 🦸, 📜 "Payday" |
| SA1-SA2 Salary offer | Owner / Coordinator (a Principal has the HR room) | Standalone; Room for the Principal | Town (from hiring) | ✓ |
| CP1 CWA override | Coordinator / Owner | Standalone | Town | ✓, 🏗️ Academy |
| CP2 Course Mapping Admin | Coordinator / Owner | Standalone (localStorage only) | Retire, or back with Q-Growth `cq:cac` | 🏗️ Academy |
| X1, X4, X5 Legacy Google Forms | Principal / HR | Embedded or dead | Retire | — |

**Reachable, but not yet meeting the rule** (wrong landing spot, room link only, or no reward):

| Form(s) | Gap |
|---|---|
| P1, P6, T1, T2 | The game link lands on the wrong tab |
| P3 | Only the event step links here; the room is not gold; missions go to X1 |
| P2, P8 | They sit on a game page, but no mission covers them |
| T4 | Needs `cwhwFormUrl` set; the fallback link is broken |
| TR2-TR4 | Reached only through a TR1 quest step or a follow-up |
| TR6 | Only the Fee Clerk event step links here |
| TR8 | The mission lands on `office/index.html` |
| O1 | The event step is a self-tick; there is no Daily claim |
| D1 | Reached from the page's own rail; not tied to the Home Base bus or a reward |
| OW3 | Linked from Owner tiles only; no quest or reward |
