# Teacher Portal as a game: "My Classroom" (design)

Date: 2026-10-25. Asked for by Uday. Brainstormed through the LMCS Master Agent (Uday's standing rule: questions go
there, one at a time). **Uday's own decisions are marked "Uday"; everything else is Claude's call** and is open to his
correction.

This is a **module** of the shared game layer. It plugs into the framework, it does not rebuild it:
- Framework spec: `2026-10-25-portal-game-layer-mascot-design.md` (branch `portal-game-layer-design`, not yet
  approved), with its working contract `game-layer-framework-contract.md` in the master agent's side-session notes.
- The framework owns: Buddy and the cast, the greeting, tour and module intro, the next-step bar, the Today panel,
  the 04:00 IST reset and roll-over, quests, team goals, help credit, private standing, badges, decision windows,
  seasons, progress storage and the voice.
- This module provides: the **teacher mission adapter**, **quest templates**, **team goal definitions**, and the
  teacher's home screen.

Inputs:
- the data inventory, vault `work/research/Teacher data inventory.md` (23 data sets, with sources and gaps);
- the direction in vault `work/active/lmcs-software-platform.md`: the whole portal becomes a game, and the score is
  the real incentive calculation;
- the measured CW/HW findings in vault `work/active/lmcs-management.md` (Key Decisions, 2026-10-22 and 2026-10-23);
- Fleet Command, `2026-10-25-transport-game-design.md`, whose guardrails this shares;
- vault `work/research/Kingshot game research.md`, `work/LMS Mascot Voice Guide.md` and `work/LMS Mascot Concepts.md`.

## Intent and why

- **Uday:** "We are trying to engulf the entire portal into a game with real life missions and tasks." Evaluate what
  can be done with all the data held on teachers. Draw on every game he has named.
- **Uday:** what teachers most often let slip is "the daily classwork/homework log".
- **Uday:** the one teacher habit to change this term is to "close the CWA → remediation loop".
- **Uday:** "Teachers also need to ensure that activities are taken with each chapter."
- **Why it matters (from the data, 30,418 CW/HW entries this year):**
  - 80% of CWAs get no remediation within 14 days, ranging from 66% at LMS 2 to 96% at LMS 5.
  - 29% of chapters are moved past without a CWA.
  - Only 23% of chapters that reached a CWA show a believable activity entry.
  - 1,054 entries tick all 10 tags at once.
- **Why a game (Claude's reading):** a teacher's real job already has the shape of a quest chain. Plan, teach, run
  an activity, assess, remediate, then the next chapter. What is missing is seeing that chain, one clear next step,
  and a reason to close each loop. The CW/HW log is the same record parents receive, so a missed log is a missed
  parent deliverable, not just an internal number.

## Goals

1. Every teacher sees **each class-subject they teach as a live chapter quest**: plan the activity → teach → activity
   done → CWA → remediation, with done detected from data.
2. **The daily CW/HW log is the core daily mission** (Uday), first in the Today panel.
3. **Remediation due** and **plan the next chapter's activity** become real missions with real due dates.
4. Teachers work toward **shared team goals**, and their real help to each other is credited.
5. Each teacher sees **their own conditions** (period load, free periods), private to them, as things the school
   owes them.
6. Ready for the framework's **February 2027 two-campus pilot** and the **March 2027 go-live** (Uday), with goals set
   per season as config.

## Non-goals

- No new data-collection app for CW/HW; teachers keep using today's form and app.
- No student names, marks or faces anywhere in the game. Children appear only as counts.
- No new teacher-facing ranking, leaderboard or ₹. Standing is the framework's private standing (Uday), and it shows
  only once the incentive engine exists.
- No change to pay. The game never adds a new pay input; whether any game measure enters the incentive formula is the
  incentive thread's decision (see open questions).
- No location of teachers, ever.

## Anti-goals (a failure even if it works)

- **Rewarding entry volume.** More entries, more tags or longer descriptions never score. An entry ticking 7 or more
  tags counts as proof of nothing (Claude's call: the data shows a clean break, with 1,401 entries at 7–10 tags and
  only 565 at 3–5).
- **Rewarding speed or racing the syllabus.** Pace shows as on plan or behind plan, never "ahead". A chapter finished
  early earns nothing extra.
- **Remediation as a tick-box.** Done uses Uday's rule, with checks that show tick-box patterns.
- **Shaming.** No "you missed", no red counts of failures on the teacher's home, and no breakable streak. Missing
  work is one plain line and one Go.
- **Judging the teacher with wellbeing data.** Load and free-period meters describe what the school gives the
  teacher, and they never feed any score.
- **Peer-visible per-teacher comparisons.** Teachers never see each other's numbers. Principals and Coordinators see
  what they already see today (the CWA gap report, compliance, and flags only beyond chance), plus team bars.

## What we take from each game Uday named

Claude's selection: only mechanics that fit real teaching work. The rest are recorded so the choice is visible.

| Game | Mechanic | Where it lands |
|---|---|---|
| **Kingshot** | Chapter panel of 3–6 tasks with later ones locked; one-line quest banner; alliance help | Chapter quests; the next-step bar (framework); help credit from shared activities |
| **The Sims** | Needs bars that decay and refill by real actions; a lot you arrange; live mode | Each class-subject card has need bars; the teacher's own conditions panel; the Principal's campus view shows "who is on what" only as counts |
| **Age of Empires III** | Home City base; advancing through ages | **My Classroom** is the teacher's base. A term is an age: Term I → Term II, with the season clock owned by the framework |
| **Mini Metro / Train Valley** | A line with stations; trains arriving on time | **Today's line**: today's timetabled periods as stations. Each lights when its CW/HW is logged. The term's chapters as a metro line against the course map |
| **Factorio** | Visible bottlenecks and queues | A class-subject's "CWAs waiting for remediation" shows as a small queue. A growing queue is a bottleneck, not a failure |
| **Need for Speed** | Ghost lap | Beat your own last term: this term's closed loops against last term's, never against a person |
| **GTA V** | Phone of contracts; character switch | Missions as contracts (framework). Principal and Owner "view as" a teacher already exists (`viewAsScope`) |
| **Duolingo** | Daily habit, streak freeze, short lessons | "Days on track" (framework, no breakable streak). Freezes only on team streaks |
| **Euro Truck Simulator 2** | Job board; career progression | Quests for real milestones: first term planned, first full loop closed, PD hours (later) |
| **Two Point Hospital** | Staff training rooms | Later: professional-development quests (the Staff Operations KPI asks for annual PD) |
| **Cities: Skylines** | District overlays | Coordinator and Principal campus views (owned by the Coordinator game chat) |
| **Frostpunk** | Hard trade-offs under pressure | Rejected for teachers: pressure mechanics are an anti-goal |
| **Pokémon Go / Ingress / GeoGuessr** | Location play | Rejected: no teacher locations, ever |
| **OpenTTD / Transport Fever 2 / Mini Motorways** | Network building | Transport only (Fleet Command) |

## The teacher's world: "My Classroom"

The teacher home (`teacher/index.html`) becomes the teacher's base. Mobile first (375 px). The Teacher Owl is the
guide, and Buddy hands over at the first login (framework).

From top to bottom:

1. **Today's line.** Today's periods from the timetable as stations on one line. Each station is a period's
   class-subject. It lights up when that class-subject has a CW/HW entry for today, and free periods show as gaps.
   - Teachers with no timetable fall back to a single "today's log" station per class-subject they teach, from
     `EmpAcademic`. That covers LMS 1, and anyone whose timetable rows were dropped.
2. **The Today panel** (framework): up to 3 missions, with the CW/HW log first (Uday).
3. **Class cards.** One card per class-subject the teacher teaches, from `EmpAcademic.Class_Subject1..10`. Each card
   shows:
   - **the current chapter quest** with its 5 steps;
   - **two need bars:**
     - *Logged*: share of this class-subject's working days in the last 2 weeks with an entry;
     - *Loops closed*: CWAs this term remediated within 14 days;
   - **the remediation queue**, if any (Factorio): "2 CWAs waiting for remediation";
   - **the term line** (Mini Metro): the chapters as stations against the course-map plan, marked "on plan" or
     "behind plan".
   - Tapping the card opens the class-subject's chapter list. That is today's "My CW/HW Patterns" view, extended
     with the quest steps.
4. **Team bars** (framework TeamGoal): the teacher's two teams, subject and campus (Uday) and what they've filled this week or month.
5. **My conditions** (The Sims), visible to the teacher only:
   - periods this week against their cap (36 for subject teachers, 42 for PRT mother teachers; Period Allotment
     bye-law);
   - the longest run of periods without a free one (the bye-law asks for a free period after every 3);
   - upcoming events from the campus calendar.

   Leave balance is added once teacher leave is in the portal (see open questions).
6. **Existing pieces stay:** My Requests, My Evaluations, and Upcoming Events. My Score stays labelled "Draft" until
   the framework's private standing replaces it.

**Children as counts only.** A card may say "CWA taken on 12 Oct". When ERP marks arrive (later phase), it may say
"8 children below 40% before remediation, 3 after". It never shows a name or a mark.

## Core loops

### Loop 1: the daily log (core mission, Uday)

- **Mission `teacher:cwhw_log:<code>:<date>`**: ONE mission per teacher per day, with `progress: {done, total}`
  (framework rule: done = `progress.done >= progress.total`). The Today card reads "Log today's classwork and
  homework (2 of 4 classes done)", and Go opens the CW/HW form.
  - **`total`** = the class-subjects due today: those with a timetabled period today, or, without a timetable,
    every class-subject the teacher teaches on a working day for the campus.
  - **`done`** = how many of those have a CW/HW feed entry for that teacher, class and subject dated today.
    Logging later the same evening counts, because the reset is at 04:00 IST.
- **Days on track** (framework): a working day, not on leave, with every due class-subject logged.
  - Teachers see "18 days on track this month" **without "of 21"** (framework config `daysDenominator` = false for
    Teacher), so a leave day never counts against a teacher. That holds until teacher leave, with dates, is in
    Approvals (Uday, Q6: "Leave into Approvals"). Then approved leave days are left out of the count and the "of M"
    returns.
  - The framework's Phase 2 nightly snapshot counts the days of teachers who log only from the mobile app.
- **Counter-checks.** An entry with 7+ tags doesn't count toward any quest step. It still counts as "logged",
  because the parent deliverable went out. Teachers with repeated 7+-tag entries appear in the existing Coordinator
  tag view, not in the game.

### Loop 2: the chapter quest (the term's headline, Uday)

A **chapter episode** is the unit, exactly as in the 2026-10-23 analysis: from the first entry on a chapter through
its first CWA, per teacher, class and subject. This avoids the "one chapter name spans months" trap that broke the
first design.

**Quest template "Chapter: <name>"** (the steps are config; these are season 0's defaults):

| # | Step | Done when (from data) | Source |
|---|---|---|---|
| 1 | **Plan the activity** | The course-map row for this chapter has a *Planned activity* filled in before the chapter's first entry | Course Mapping workbook, a **new column** (Uday: plan, then confirm) |
| 2 | **Teach** | The first CW entry on this chapter | CW/HW feed |
| 3 | **Run the activity** | A CW entry on this chapter whose description matches the planned activity, checked overnight by local LM Studio (Uday). The Principal's "Activity Based" SS mark is the human spot-check (Uday) | CW/HW feed + the nightly match tab |
| 4 | **Take the CWA** | A CW entry tagged CWA on this chapter, or the Chapter Tracker's actual CWA date, or a Coordinator "mark as taken" override | CW/HW feed, ChapterTracker |
| 5 | **Remediate** | A Remediation-tagged entry **on the same chapter as its CWA** within 14 days (Uday, Q5: "remediations need to get matched to the chapters"; matching on class and subject alone does not count). Tag-inflation flags and the Principal's "Notebook Checking" SS mark are the checks (Uday). Later this moves to ERP marks (Uday) | CW/HW feed |

- **The starting baseline is low, and that is honest.** Today 60 of 1,793 CWAs (3%) have a same-chapter remediation
  within 14 days, mostly because teachers log remediation under the next chapter's name or none. The quest exists to
  raise it, so the design makes naming the chapter the easy path (Claude's calls):
  - the `remediation_due` mission's Go opens the CW/HW form **pre-filled** with the class, subject, chapter and the
    Remediation tag, where the form supports pre-filled links. Otherwise the card shows the exact chapter name to
    pick;
  - the Teacher Owl's first remediation mission explains the rule in one line ("Name the chapter you're fixing, so
    it counts");
  - for the first two weeks of the pilot, a class-subject remediation logged under the wrong chapter shows a quiet
    "logged under another chapter, choose this one next time". It doesn't count as done.
- **Missions from the quest:**
  - `teacher:remediation_due:<episodeId>`: open from the CWA date. Its due date is CWA + 14 days, a real deadline
    from Uday's rule.
  - `teacher:activity_plan_due:<chapterKey>`: open when the next chapter's course-map start date is within 7 days and
    no activity is planned. Due on the start date.
  - `teacher:cwa_due:<episodeId>`: open when the course map's planned CWA date has passed without a CWA. Due is that
    planned date. It shows only where the plan has a CWA date (34% of chapters today).
- **A missed step stays visible but quiet.** A remediation not done by day 14 shows "closed without remediation" on
  the card. It doesn't sit in the Today panel forever: it leaves the Today panel at day 21, so roll-over can't become
  a pile of guilt (Claude's call).
- **Rewards:** the chapter's badge on the card, and one Teacher Owl line, e.g. "Chapter 4 closed properly: taught,
  tried out, checked and fixed."
- **Montessori wing (M-I to M-III):** no CWA concept and no CWA dates. Quests there are Plan → Teach → Activity only.
  The Montessori Owlet guides them (framework cast).

### Loop 3: setting up (data collection as quests, like Fleet Command's setup quests)

The game needs data that is missing today (see the inventory's gaps). Collecting it is real work, so it becomes
quests. These are real data entry, and done is detected from data:

- **Teacher, Quest 1 "Your portal"** (framework template, this module's content):
  1. log today's classwork;
  2. log today's homework;
  3. plan the activity for your next chapter;
  4. a full week with every working day logged.
- **Teacher, Quest 2 "Plan your term's activities":** for one class-subject, every remaining chapter of the term
  has a planned activity. Unlocks after Quest 1, and repeats per class-subject as a mission until done. Planned CWA
  dates stay with the course-map owners (see "Settled after the builder check").
- **Principal, campus setup quest** (content delivered to the framework's Principal quests):
  1. the campus timetable is current in the portal, LMS 1 first;
  2. every CW/HW teacher name resolves to an employee (the unmatched list is the to-do);
  3. every teacher's class-subjects are in `EmpAcademic`.

  Each is a count to zero, visible on the campus card.

### Loop 4: teams and help (framework primitives, this module's definitions)

- **Every teacher has two teams** (Uday: "Subject and campus both"):
  - **The subject team spans all campuses.** For example, every Maths teacher in LMS 1–6. It holds the **academic
    goals**. 52 of 61 class-subjects use the same book everywhere, and 78% of chapter names are shared by two or more
    schools.
  - **The campus team** is the whole teaching staff of one campus. It holds **everything else** (logging,
    planning, setup).
  - A teacher of two subjects is in both subject teams.
  - The subject key is the feed's standardised subject name. Whether a subject team is split by wing (e.g. Classes
    1–5 vs 6–10) is a config choice per season (Claude's call: unsplit in season 0).
- **Season 0 team goals** (config):
  - Subject team, "Every CWA this month remediated within 14 days": % of the team's CWAs this month, against the
    team's own last month;
  - Subject team, "Every chapter this month has its activity": the same shape;
  - Campus team, "Every working day logged this week": share of due class-subject days logged;
  - Campus team, "This term's activities planned": share of remaining chapters with a planned activity.
- **Activity bank + help credit.** A teacher can copy another teacher's planned activity for the same chapter into
  their own course map ("Use this activity"). When the copier's activity is confirmed done (step 3), the author gets
  help credit: "Your 'fraction pizza' activity was used in 3 classes this month." That is a real action with real
  proof, so it fits the framework's help-credit rule.
  - **The bank shows activities, not people's performance.** It shows the activity line, chapter, campus and author,
    and it lists only activities confirmed done at least once.
- **Team streak:** "weeks with every CWA remediated", with one freeze a month (framework rule for team streaks).

### Loop 5: private standing (framework Phase 4)

- **Uday:** each teacher sees only their own position within their incentive bracket, e.g. "top 30% of Grade 6–10
  English teachers at LMS 4". It comes from the real incentive calculation, not points.
- It stays hidden until the incentive engine is encoded (it is Excel-only today), per the framework spec. Until then
  the draft "My Score" (SS 50% + regularity 50%) stays, labelled "Draft".

## Roles

| Role | Sees in the teacher game | Does |
|---|---|---|
| **Teacher** | Their own My Classroom: today's line, Today panel, class cards, quests, team bars, conditions, draft score / later private standing | Logs CW/HW (existing form), plans activities and CWA dates (course map), uses bank activities, replies to "Info requested" |
| **Principal** | Through "view as", any teacher of their campus, exactly as that teacher sees it. On their own home: the campus setup quest, campus team bars, counts of open remediation queues. No new per-teacher ranking | Evaluates (SS, existing), which also spot-checks activities and notebook checking |
| **Coordinator** | District aggregates only (agreed with the Coordinator game chat): logging and remediation counts per campus, team bars on the district map. Their missions target Principals or system gaps, never a teacher's daily mission | Raises follow-ups (existing engine) |
| **Owner** | Everything, plus Season setup: which teacher mission kinds and quests count, and team targets (framework) | Sets season goals |

## How it works (architecture)

- **Compute lives in the game backend, not the PDR backend** (Claude's call). `teacher-portal.gs` sits in the live
  "Principal's Daily Reporting Backend" project. Uday's own rule from the Coordinator backend is that new work must
  never put that project at risk. So the teacher adapter is a file in the framework's separate **LMCS Game Backend**
  project (`game-teacher.gs`). It reads the source sheets directly: the CW/HW sheet, the Course Mapping workbooks,
  the Chapter Tracker sheet, the Employee Master (`EmpAcademic`, `EmpPersonal`), the timetable, and the Teacher SS
  responses. It serves:
  - `teachermissions`: the caller's missions, in the framework's Mission shape;
  - `teacherclassroom`: the caller's class cards, chapter episodes and quest step states, conditions and team bars;
  - nightly: chapter episodes and days on track, written as flags and counts to the game workbook (no names, no free
    text).

  Both actions are registered in the framework's `GAME_MODULE_ACTIONS`. The framework's Phase 2 nightly trigger
  calls the teacher part, which this module owns (agreed with the game director).
- **The episode engine** is shared with the Owner portal (see "Settled after the builder check"). It covers first
  entry through first CWA, per teacher × class × subject, and real teaching only: Class 1+, non-exempt subjects, 3+
  periods. Its tests reproduce the measured numbers on a fixed snapshot of the feed (25 Oct 2026: 60 of 1,793 CWAs
  remediated on the same chapter within 14 days, with entries of 7+ tags excluded).
- **Identity:** the caller's code comes from `EmpPersonal.AuthEmail` (`tpResolveCallerEmployeeCode_` logic). Feed
  rows are matched by normalised name (`tpResolveEmployeeCode_` logic, kept in sync). Unmatched rows feed the
  Principal's setup quest, never a teacher's mission.
- **Activity matching (nightly, on the Mac):** the Mac already runs 2-hourly syncs (`drive-index`) and LM Studio.
  A nightly job:
  1. reads the day's CW entries and the planned activities;
  2. asks LM Studio (`/no_think`, the `drive-index/lmstudio_summarize.py` call pattern) "does this description
     describe this planned activity: yes/no + confidence";
  3. pushes the results over HTTPS to a `Teacher Activity Matches` tab in the game workbook.

  Apps Script can't reach the Mac, which is why the Mac pushes. If the Mac is asleep, step 3 simply waits and shows
  "checking overnight", so a step is never marked failed for that reason.
- **Planned activities:** the teacher fills them from the class card, a one-line form that writes to a
  `Teacher Planned Activities` tab in the game workbook, keyed per teacher. Each campus's course map gets a read-only rollup
  column, so academic staff see every plan. The Course Mapping workbooks are otherwise unchanged.
- **Timetable:** moves from the public `teacher/data/timetable.json` to a `Teacher Timetable` tab behind the signed-in game
  backend in T0 (see "Settled after the builder check").
- **Front end:** `teacher/index.html` loads the framework's `assets/game.js`, then a small `teacher/classroom.js` for
  today's line, the class cards and the conditions panel. No framework, following the repo's conventions. Design
  skills apply in this order: the LMCS skills (`frontend-design-for-lmcs`, `taste-for-lmcs`, `impeccable-for-lmcs`),
  then `game-ui-ux` and `gamification-loops`, whose safety warnings are binding.
- **Config:** every value lives in the framework's `Game Config` under the `teacher.*` namespace (Uday: goals are
  config, set per season). That covers:
  - `teacher.examKeywords`;
  - `teacher.remediationDays` = 14;
  - `teacher.tagInflationThreshold` = 7;
  - the mission kinds, quest steps and team targets, as season 0 defaults.
- **Game workbook tabs** are named with the module prefix (`Teacher Planned Activities`, `Teacher Activity Matches`,
  `Teacher Timetable`) and keyed by teacher code, with no names.

## Privacy (DPDP)

- No student data enters the game workbook, static files or the public repo. Counts only.
- The T1 2026 workbook and the class watchlist stay in OneDrive. The later marks phase reads ERP marks server-side
  and shows only class-subject counts.
- A teacher's conditions, days on track, badges and draft score are visible to that teacher, their Principal and the
  Owner, and to Coordinators as aggregates only.
- The activity bank shows the author's name, because credit is the point. It shows no performance data. Teachers can
  opt to share anonymously (Claude's call).
- No location data of any kind.

## Phasing (to fit the framework's timeline)

| Phase | When | Ships | Depends on |
|---|---|---|---|
| **T0. Data ready** | Nov 2026 | Episode engine with tests on a feed snapshot; *Planned activity* column added to the 6 course maps; timetable re-import including LMS 1, with the unmatched-name report; name-resolution audit of the CW/HW feed | Uday's approval; Course Mapping workbook owners |
| **T1. My Classroom v1** | Dec 2026 (framework Phase 2) | Teacher Owl intro; Today panel with the CW/HW card, remediation due and activity plan due; today's line; class cards with quest steps 1, 2, 4, 5; Quests 1 and 2; days on track | Framework Phase 1 shell + game backend |
| **T2. Activities and teams** | Jan 2027 (framework Phase 3) | Nightly LM Studio activity match (step 3); activity bank + help credit; subject and campus team goals; conditions panel; Principal campus setup quest | T1 |
| **Pilot** | Feb 2027 | Two campuses with complete timetables; tune wording, caps and the 7-tag rule from real use | T2; **teacher leave in Approvals** (below) |
| **Go-live** | Mar 2027 | All campuses; season 1 config set by the Owner | Pilot |
| **T3. Outcomes** | When the CSM extractor reaches exams | Remediation judged by ERP marks (children as counts) | csm-erp-extractor Phase 3 |
| **T4. Standing** | When the incentive engine is encoded | Private standing replaces the draft score | Incentive thread |

**Dependency: teacher leave in Approvals (Uday, Q6), before the February pilot.** This is a separate build, not part
of this module. It extends `approvals.gs` with the bye-law leave categories (the 12 in Payroll's leave template) for
teacher requesters. Each request carries from and to dates, plus half or short day where the bye-law has them. Approved
requests are what the game reads to leave days out of "days on track". It implements the existing vault decision
"Teachers' Portal owns the leave system". Who builds it is routed through the master agent.

Each phase is planned (superpowers:writing-plans), built on a branch, verified (`tests/verify.mjs`, live checks, 375
px and desktop) and shipped only with Uday's go-ahead.

## Uday's decisions (2026-10-25)

1. What teachers most often let slip is the daily CW/HW log, so it is the core daily mission.
2. The one habit for this term is to close the CWA → remediation loop, so the chapter quest is the headline.
3. Remediation: "logged is enough for now (a Remedial-tagged entry on the chapter within 14 days, with tag-inflation
   flags and the Principal's notebook-checking mark as checks); switch to ERP marks when the extractor reaches
   exams."
4. Activities: "plan, then confirm. The teacher writes the chapter's planned activity in the course map; done = a CW
   entry whose description matches the plan, checked overnight by LM Studio, with the Principal's Activity Based mark
   as the human spot-check."
5. Teams: "Subject and campus both". The subject team spans all campuses and holds the academic goals; the campus
   team holds everything else.
6. Remediation must be matched on the same chapter as its CWA (Q5: "remediations need to get matched to the
   chapters"). The low starting baseline is accepted as honest.
7. Leave: "Leave into Approvals". Teachers apply for leave through the portal's Approvals before the February
   pilot. Until then, days on track shows no denominator.
8. Via the framework: private standing only; goals are config set per season; go-live in March 2027.

## Settled after the builder check (Claude's calls)

1. **One episode engine, shared with the Owner portal.** The Owner portal B plan
   (`2026-10-23-owner-portal-b-insights.md`, Task 2) already specifies the episode functions (`ownAcadEpisodes_`
   and related) with tests. They live in one file, deployed to both the Owner and the game backends through
   `apps-script/projects.json`, and are built by whichever ships first. This avoids the Owner and the teacher's card
   showing different numbers for the same chapter. **The engine uses Uday's same-chapter rule (Q5) everywhere.**
   The Owner portal B plan, which counted remediation by class-subject, must switch to it before it is built. This
   was flagged to the master agent.
2. **Teachers write only the planned activity, never the planned CWA date.**
   - The planned CWA date drives ChapterTracker deadlines, the CWA gap report and `cwa_due`. A teacher who could
     move it could move their own deadline.
   - CWA dates stay with the course-map owners. Missing ones become a count on the Principal's campus setup quest.
   - Quest 2 becomes "Plan your term's activities": every remaining chapter of one class-subject has a planned
     activity.
3. **Planned activities are stored per teacher, in the game workbook**, keyed by (EmployeeCode, campus, class,
   subject, chapter). They are not stored in the shared course-map row, because one row can serve several teachers
   (ChapterTracker joins them, and Class 11/12 streams share chapter lists). The course map shows a read-only
   rollup, so academic staff still see every plan.
4. **Revision, exam and event days.**
   - Revision days still expect a log. RT and revision entries count, since they are what parents receive.
   - Days that the campus calendar marks as exams, or as full-day events, expect no log and aren't counted. The
     marking is a configurable list of calendar title keywords in `Game Config`, set by the Owner, as "GH" already
     is for holidays.
   - No chapter quest opens after the course map's last teaching date for that class.
5. **The timetable moves behind the signed-in backend in T0.** `teacher/data/timetable.json` holds staff names and
   codes in the public repo, which breaks the framework's rule that nothing personal goes in static files.
   - It becomes a `Teacher Timetable` tab read by the game backend.
   - The existing "Your Timetable" card is rewired to that read, and the JSON file is removed from the repo.
6. **No LMS 1 timetable source exists yet.** Collecting it is the LMS 1 Principal's campus setup quest. Until then,
   LMS 1 uses the `EmpAcademic` fallback, so LMS 1 is not a pilot campus.

## Open questions for Uday

Q4 was asked first; Q5–Q7 come from the builder check (all sent via the LMCS Master Agent).

1. ~~**Q4: who is a teacher's team?**~~ **Answered (Uday):** "Subject and campus both" (see Loop 4).
2. ~~**Q5: is remediation matched on the same chapter or the same class-subject?**~~ **Answered (Uday):**
   "remediations need to get matched to the chapters": same chapter only (see Loop 2, step 5).
3. ~~**Q6: where do teacher leave days come from?**~~ **Answered (Uday):** "Leave into Approvals". Teachers apply
   for leave in the portal's Approvals before the February pilot. Until then, "N days on track" with no "of M".
4. **Q7: when does the chapter-quest pilot run?** New teaching ends around 30 Nov (Classes 10, 12) and around 14–17
   Feb (others). Recommended: pilot the chapter quest on one campus in Dec–Jan. The February pilot then covers the
   daily log and planning next session's Term I activities.

## Left to the builder

- Exact wording of missions and Teacher Owl lines, within the voice guide (the game director checks the voice).
- The visual design of today's line, the class cards and the term line, within the LMCS tokens.
- The LM Studio prompt and the confidence threshold for an activity match; spot-check a sample against Principal
  observations before the pilot.
- Sheet column names and action names in the game backend, following the `coordinator*` patterns.
