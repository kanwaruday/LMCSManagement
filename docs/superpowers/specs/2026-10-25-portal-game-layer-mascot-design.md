# Portal game layer: Buddy, the owl family, quests and daily missions (design)

Date: 2026-10-25. Asked for by Uday. Brainstormed with him in the Portal game director chat and through the LMCS Master
Agent. **Uday's own decisions are marked "Uday"; everything else is Claude's call** and is open to his correction.

Builds on:
- the direction in the vault's `work/active/lmcs-software-platform.md`: "the whole portal becomes a game" on real
  data, real data entry, real people;
- the approved transport game design, `2026-10-25-transport-game-design.md` (Fleet Command), whose guardrails this
  layer shares;
- the Kingshot research, vault `work/research/Kingshot game research.md` (37 sources).

Vault project note: `work/active/portal-game-layer.md`.

## Intent and why

- **Uday:** "ensure that when a person logins into the portal there is a friendly LMS mascot, that can guide them
  about each feature of this game, with clear cut objectives and daily mission. Draw inspiration from the game
  'Kingshot'."
- **Why (Claude's reading).** The portal now has many modules (daily reporting, approvals, hiring, staff documents,
  curriculum, payroll, office, transport). Staff learn them one screen at a time, and real work slips: evaluations
  not marked, homework not logged, bills without photos. Kingshot is good at three things this needs:
  - one clear next step, always on screen;
  - short chains of tasks that teach by doing;
  - a daily rhythm.

  The layer turns each person's real pending work into that shape, with a friendly character to explain it.
- **This is the shared framework.** Every module plugs into it rather than inventing its own missions or points:
  Fleet Command (transport), the Teacher Portal and the Coordinator Portal (each with its own game chat), and later
  the others.

## Goals

1. A friendly mascot, **Buddy**, who greets each signed-in person once a day and guides them through the portal.
2. Per-role first-visit tours, plus a short introduction the first time a person opens each module.
3. **Clear objectives:** a quest chain per role that teaches each module by doing real work in it.
4. **Daily missions** built only from the person's real pending work, with a progress bar and a fixed daily reset.
5. One framework for missions, quests, team goals, help credit, standing and progress, which every module uses.
6. Works on a phone (375 px) first, since Principals, clerks and Coordinators are mostly on phones.

## Non-goals

- No points economy, currency, shop, loot or lottery of any kind.
- No new task store: missions are a view over work the portal already tracks.
- No parent or student access (kept possible for later, per the transport design).
- No game engine, 3D runtime or app download. It stays the static portal plus Apps Script.
- No change to how any module's real actions work. The game layer only reads state and links to the real screens.

## Anti-goals (a failure even if it works)

From Uday's direction, the transport guardrails and the Kingshot "avoid" list:

- **Invented work.** A mission that isn't real pending work, or "done" that the data doesn't prove.
- **Rewarding speed.** Time-to-complete is never scored. For transport, speed never counts at all.
- **Peer-visible rankings of people**, and zero-sum contests between people.
- **Money tied to game scores.** Recognition only.
- **Loss and pressure mechanics** (Kingshot's weak spots):
  - progress wiped at reset;
  - countdowns;
  - breakable personal streaks;
  - nagging pop-ups;
  - rewards only the top N can reach;
  - daily checklists that grow until they exhaust people.
- **Decoration that slows work.** A Fee Clerk still gets one sentence and a Go button.
- **The mascot overstating anything.** Buddy says exactly what is done and what is not (the voice guide's honesty
  rule).
- **Personal data where it shouldn't be:** children identifiable in game views, or personal data in static files or
  the public repo.

## The character: Buddy and the owl family

**Look, name and voice are designed together as one character (Uday).** Concepts, renders and the lookbook are in the
vault: `work/LMS Mascot Concepts.md` and `work/mascot concepts/` (including `Owl family lookbook.html`). **The voice
is defined only in the vault's `work/LMS Mascot Voice Guide.md`**; this spec does not restate it.

- **A wise owl in the LMS uniform** (Uday: "a wise owl, wearing the School tie/ track suit").
- **Art style: soft 3D**, for the whole family (Uday).
- **The lead owl is named Buddy** (Uday). He is a Himalayan wood owl (Claude's call), and the voice guide is
  already used for Uday's Telegram updates, so the tone is trialled on Uday first (Uday).
- **One lead owl plus a small cast with their own jobs** (Uday: "both"). The cast is Claude's proposal (Uday: "these
  look fine"); the Teacher Owl was added at Uday's ask:

| Character | Species and dress | Appears for |
|---|---|---|
| **Buddy** | Himalayan wood owl, the LMS uniform of the day | Everyone: login greeting, tours, Today panel, next-step bar, quests; the Owner's and Coordinators' only guide; Uday's Telegram updates |
| **Coach Owlet** | Spotted owlet, school track suit, whistle | Fleet Command (transport), Events & House System, sports |
| **Teacher Owl** | Mottled wood owl, staff dress code (cream saree, red border, ID lanyard) | Teacher portal: CW/HW, timetable, leave, evaluations |
| **Office Owl** | Barn owl, staff dress code (salwar suit, red dupatta, ledger) | Fee Clerk and Office portal, Fees & Finance, Day Book |
| **Montessori Owlet** | Collared owlet, Montessori wing red puffer | A new joiner's first week; the Montessori wing |

**Buddy wears what the school wears that day** (Claude's call, from the School Uniform bye-law):

| When | Outfit |
|---|---|
| Session start, and after the Dussehra break | Winter formal: red blazer with golden buttons, red tie, white shirt, grey trousers, LMS belt, red socks with blue and yellow stripes |
| From the first Monday of May | Summer formal: no blazer |
| Track-suit days (3 a week) | Summer: white polo with black-and-red collar. Winter: red hoodie. Both with black track pants with red stripes |
| Festivals, Annual Day, big milestones | Blazer plus a Kullu cap |

- Junior-wing teachers' screens use the Classes 1–5 uniforms.
- The outfit calendar is a small config the Owner can edit, not hard-coded.

**Expressions:** every owl needs at least four poses: neutral, celebrating, nudging, and bad news (calm, wings
folded). The voice guide's three situations map one-to-one onto the last three.

**Production art (Claude's call).** The AI renders are references only. Final art:
- soft 3D renders with transparent backgrounds, as WebP/PNG at about 3 sizes: full figure ~480 px, bust ~240 px, and
  a head-and-tie avatar crop tested at 32–40 px;
- one model sheet per owl, so the face and proportions stay consistent;
- **no personal data in any image**, so the images may live in the public repo (`assets/game/`).

How the final renders are made (AI generation with model sheets, or a commissioned illustrator) is left to the
builder, as long as the result is consistent across poses.

## What a person sees

Mockup (Principal, sample data): vault `work/mascot concepts/Login greeting mockup.html`.

### 1. The once-a-day greeting

- On the person's first portal page load after the daily reset, Buddy rises from the bottom-left in today's outfit.
  A dialogue box shows his name and one line from the voice guide, e.g. *"Good morning, Meena ji. Four things are
  waiting today. The first one takes about three minutes."*
- Buttons: **Show me** (opens the first mission) and **Later**. **Skip** is always top-right.
- After that, Buddy lives only as the small avatar on the next-step bar.
- Never more than once a day. Never on top of a form someone is filling in.

### 2. The first-visit tour (per role)

- **Visual-novel beats** (from Kingshot): the owl's bust, one or two lines, tap to continue, and a spotlight on the
  real element being explained.
- **3–6 beats, covering only that person's own home screen.** The tour starts the role's first quest and then ends.
  Skip is always available, and the tour can be replayed from a "Ask Buddy" item in the menu.
- **When a person first opens a module**, that module's owl gives a 2–3 beat introduction. For example, the Office
  Owl on a clerk's first Day Book visit. Buddy hands over ("Here's the Office Owl, who knows the Day Book best").
- **"New feature" card:** when a person gains access to a module they didn't have (a new role, or a module going
  live), a one-time card shows it, with the owl and one Go button.

### 3. The next-step bar

- One line pinned at the bottom of every portal screen (role homes in Phase 1, module pages from Phase 2): Buddy's
  avatar, "Next", the single next item, and **Go**.
- Go opens the exact record (that teacher's evaluation, that approval, that bill), not a list.
- Every blocked step carries its own Go to whatever blocks it, so there are no dead ends (Kingshot's requirement
  rows).
- It disappears when there is nothing pending, and Buddy shows a short "All clear" line instead.

### 4. The Today panel (daily missions)

On each role's home page:
- **3–5 missions**, drawn from the person's real pending work across all modules:
  - the default is 3 for teachers and clerks, and 5 for Principals and Coordinators;
  - they are picked by real due date, then age;
  - the rest wait for tomorrow or are in the module screens.
- **A progress bar**, one segment per mission. Missions fill in as the data shows them done.
- **The daily reset is at 04:00 IST**, so late-evening work counts for the day it was done.
- **Unfinished work rolls over** with a quiet "from yesterday" tag. Nothing is ever wiped, and there are no
  countdowns.
- **Module screens show their full queue.** The Today panel is the "start here" list, not the inbox. The Coordinator
  HQ shows its 20+ follow-ups, and Fleet Command all of its cards.
- When all of today's missions are done, Buddy celebrates once, briefly, in the voice guide's style. A **day on
  track** is recorded.

**Where missions come from.** Each role has **core missions** (Uday: what that role most often lets slip). These come
first in the Today panel. Other real pending work fills the remaining slots.

| Role | Core missions | Other missions | Source |
|---|---|---|---|
| Principal | **Uday:** "the monthly staff evaluation / Support Session marks, and closing issues raised in daily reports" | The daily report; replying to "Info Requested" on their own approval requests; staff documents to upload | SS tracker (PDR backend; the quota is 2 SS per employee per month, `SS_QUOTA_DEFAULT_PER_MONTH`); the `PDR Issues` and `PDR Issue Actions` tabs (Coordinator backend); Approvals; staff documents |
| Teacher | **Uday:** "the daily classwork/homework log" | CWA → remediation follow-ups; leave/request status; SS feedback | Curriculum & Progress (CW/HW, ChapterTracker); Approvals |
| Fee Clerk | **Uday:** "day-book entries without a bill photo, fuel fills without the video/bill, and staff/bus documents not uploaded" | Other transport cards from Fleet Command (they count toward the same cap) | Office backend (Day Book); transport uploads and fuel-fill proof; staff documents |
| Coordinator | **Uday:** "approvals pending 3+ days and hiring stalls" | Everything else in their follow-up queue (complete-hire, documents, SS compliance, PDR issues, transport) | Coordinator Tasks tab (approvals bottleneck and hiring-stall adapters already exist) |
| Owner | Proposals and approvals waiting on Uday; the transport war room | (none) | Approvals; Coordinator and transport proposals |

**Daily-report issues today are Coordinator-only.** The `PDR Issues` tab is grouped on the Mac from the Principals'
Important Messages, and the `PDR Issue Actions` tab records what Coordinators did (acknowledged / assigned /
resolved). A Principal's "close your daily-report issues" mission therefore needs a new, campus-scoped read of those
tabs for Principals. It also needs a rule for who may mark an issue closed (see open questions).

### 5. Quests (clear objectives)

- **Short chains of 3–6 real steps per role.** About 3 steps are visible at a time; later ones show **locked**.
  Finishing a quest earns a badge and one celebration line (Kingshot's chapter panel).
- **Named "quests", not "chapters"** (Claude's call), because "chapter" collides with syllabus chapters. A
  teacher's syllabus chapter can itself be a quest: first entry → CWA → remediation.
- **Every step is a real action, and done is checked from data.**
- Starting quests, each about one module (module chats write the content):
  - **Principal, Quest 1 "Your portal":** submit today's daily report; submit one SS evaluation; close one
    daily-report issue with a note; upload one staff document.
  - **Teacher, Quest 1:** log today's classwork; log today's homework; a full week with every working day logged.
    Content is the Teacher chat's.
  - **Fee Clerk, Quest 1:** enter one day-book expense with its bill photo; attach one fuel-fill proof; upload one
    document.
  - **Coordinator, Quest 1:** decide one approval pending 3+ days; move one stalled hire to its next step; resolve
    one other follow-up with an outcome note.
  - **No "open" or "look at" steps.** Every step must leave a trace in source data, so done is never self-reported
    and never a logged visit.
  - **Transport (Fleet Command):** one setup quest per bus (papers, safety, parts, driver, fuel, capture), already
    designed there.
- **New joiners** get a first-week quest from the Montessori Owlet: their own documents, their timetable, the bye-laws
  they must read, and who to ask.

### 6. Team goals, help credit and standing

- **Team goals** (Kingshot's Bear Hunt): one shared bar that everyone's real work fills.
  - The team is a campus, a district (Coordinator plus 3 Principals), a House, or a same-subject group across
    campuses. Module chats define the goals.
  - Each team is measured against its own target or its own last period, never against another team.
- **Help credit** (Kingshot's alliance help, but real): when person A's real action clears person B's mission:
  - B's mission shows "cleared with help from A";
  - A gets a recognition line ("You unblocked 2 Principals today").

  It is detected from who actually did it (the data's resolver), so there is nothing to tap and no points.
- **Private standing** (Uday, 2026-10-25):
  - Each person sees **only their own position** within their incentive bracket, e.g. "you're in the top 30% of
    Grade 6–10 English teachers at LMS 4".
  - **Nobody sees anyone else's name or rank, and nobody sees theirs.** The Owner sees the full picture.
  - Alongside it: team goals and **"beat your own last month"**.
  - No ₹ on anything peer-visible.
  - Standing comes from the incentive engine's peer groups once that thread is built. Until then it is hidden.
- **Consistency, not streaks** (Claude's call):
  - Individuals see "**18 of 21 school days on track this month**", against their own last month.
  - Days with no scheduled work for that person (leave, holidays, Sundays, free periods) don't count at all.
  - Only **teams** have streaks, each with one logged freeze a month (as in Fleet Command).
- **Seasons and shipments** (shared by Fleet Command and the Coordinator module, so the framework owns them):
  - **A season is a school term.** The term dates live in the game backend's `Game Config`, set by the Owner. Team
    goals, team streaks and season badges all use this one clock.
  - **The shipment deck** is the AoE3 reserve from the transport design. A campus earns a card for each season goal
    met; Uday ships it through the existing Approvals flow. It is defined once here and used by any module. Pool size,
    card values and the deck stay Uday's to set when the first module needs them (transport Phase 4).
- **The map shell** (Leaflet world, HUD top bar, minimap pings, campus switcher) is **owned by Fleet Command** as a
  shared module (`assets/game-map/`) and reused by the Coordinator district map. Buddy and the Today panel work on any
  screen and don't depend on it.
- **Badges:** for finished quests, team goals met, and first-time milestones. They are shown on the person's own
  profile, visible to them and their line managers. There is no public wall.

## How it works (architecture)

- **Front end:**
  - one shared module, `assets/game.js` with `assets/game.css`, loaded by every portal shell after `auth.js`;
  - it owns the greeting, tour, next-step bar, Today panel, quest panel, team bars and the owl components;
  - no framework, following the repo's conventions. The React front end (2026-10-20 spec) can wrap the same data
    later.
- **Mission adapters:**
  - each module registers one function that turns data the page already loads (or one cheap read) into mission
    objects;
  - the Today panel renders **after** the page's own content and never blocks it, so there is no extra wait at
    sign-in;
  - adapters reuse existing endpoints first, for example the Coordinator Tasks tab (`TaskId`, `Assignee`, `Due`,
    `Status`, `ResolvedBy`) and the PDR actions.
- **Progress storage:**
  - a new, small Apps Script project, "**LMCS Game Backend**", with its own deployment;
  - same pattern as the Coordinator backend: Google ID token verified against the Principal Allowlist, cached, and
    registered in `apps-script/projects.json` for `deploy.mjs`;
  - its own workbook with tabs `Game Progress`, `Game Daily` and `Game Config`, holding only per-person flags and
    counts: tours seen, quest steps done, days on track, help credits received or given, badges, and the outfit
    calendar;
  - **missions, team goals and standing are computed from source data, never stored twice**;
  - it is a separate project so a game bug can never break a live backend (Uday's own reason for separating the
    Coordinator backend).
- **Shapes** every module uses:
  - Mission: `id "<module>:<kind>:<recordId>"`, module, kind, title, why, owner, role, campus, go, due (real
    deadlines only), source, done (from data), doneBy;
  - Quest: id, role, module, title, unlockAfter, steps with a doneCheck each, reward;
  - TeamGoal: id, module, title, team key and members, measure, target, period, computed progress.

  The working copy of these shapes is the shared contract `game-layer-framework-contract.md`, in the master agent's
  side-session notes folder. It is folded into this spec when approved.
- **Done detection:** a mission or quest step is done only when its source data says so (the report row exists, the
  task is resolved with an outcome, the document scan is read). There is no manual tick.
- **Sound** is off by default. Motion respects `prefers-reduced-motion`. Every screen works at 375 px and with a
  keyboard. Design skills are applied in this order: the LMCS skills (`frontend-design-for-lmcs`, `taste-for-lmcs`,
  `impeccable-for-lmcs`), then `game-ui-ux` and `gamification-loops`, whose safety warnings are binding.

## Privacy

- **Game views show children only as counts.** No names, addresses or photos of children in any game element.
- **The progress workbook holds email, role, campus and record references only:**
  - mission ids such as a TaskId or an employee code, which point to records the backends already hold;
  - flags and counts.

  It holds no names, no free text and no ₹. Standing is computed on the fly and shown only to that person and the
  Owner.
- **Nothing personal in static files or the public repo.** Owl art and copy templates are fine there. Names come at
  runtime from the signed-in backend.
- **No new location tracking.** Location stays only where an approved module design already has it (transport).

## Goals are configured per season, never hard-coded

**Uday (2026-10-25):** "this is an evolving thing, we will identify the goals for everyone for the next 6 months,
this goes LIVE LIVE in March."

- **Every role's goals live in the game backend's `Game Config`, set by the Owner per season (term).** That covers:
  - which mission kinds are core for each role;
  - the daily cap;
  - each quest's steps and order;
  - team goals and their targets;
  - season dates;
  - the outfit calendar.
- **Code supplies the mission kinds** (what each adapter can detect from data); **config chooses which ones count,
  for whom, and when.** The core missions Uday named on 2026-10-25 are season 0's starting config, not constants.
- **Until the Owner screen exists, the Owner edits a sheet.** The Owner's **Season setup** screen comes in Phase 3,
  so Uday and the Coordinators can work the goals out over the six months before go-live.

## Timeline: fully live in March 2027 (planned backwards)

Uday: fully live in March 2027. Claude's reading: March is go-live and the warm-up month, so the first full season
starts with the new session in April 2027.

| Month | Phase | What happens |
|---|---|---|
| Nov 2026 | **1. Shell** | Built and piloted with Uday (Owner) and one district's Coordinator and Principals |
| Dec 2026 | **2. Cast and modules** | Teacher, Office and Fleet Command plug in; module intros |
| Jan 2027 | **3. Together** | Team goals, help credit, badges, seasons, the Owner's Season setup screen. Goals for season 1 are drafted |
| Feb 2027 | Pilot | Two campuses live for a month; tune the wording, caps and goals from real use |
| **Mar 2027** | **Go-live** | All six campuses and all roles. Season 1 goals are set by the Owner |
| Apr 2027 | Season 1 | First full season with the new session |
| When the incentive thread is ready | **4. Standing** | Private standing. Hidden until then; not needed for go-live |

Module chats plan their phases inside this window: transport's Phase 1a/1b already fits Nov–Dec.

## Phasing

| Phase | Ships | Depends on |
|---|---|---|
| **1. Shell** | Buddy (winter, summer, track-suit outfits), the greeting, the next-step bar, and the Today panel on the Principal, Coordinator and Owner **homes**. Adapters: Coordinator Tasks (approvals 3+ days, hiring stalls), SS quota, daily-report issues (new Principal-scoped read), daily report, Info Requested. The game backend (progress, the daily set, nightly days-on-track). Quest 1 for Principal and Coordinator | Uday's approval; final Buddy renders; the issue-closing rule |
| **2. Cast and modules** | Teacher Owl and Teacher adapters/quests (with the Teacher chat); Office Owl and Fee Clerk adapters/quests; Coach Owlet inside Fleet Command (with the transport chat); module intros; new-feature cards | Phase 1 |
| **3. Together** | Team goals, help credit, badges, the Montessori Owlet's first-week quest for new joiners | Phase 2 |
| **4. Standing** | Private standing from the incentive engine's peer groups | The incentive redesign thread |

Each phase is planned (superpowers:writing-plans), built on a branch, verified (`tests/verify.mjs`, live checks,
375 px and desktop), reviewed for UI/UX until it is right (Uday's standing ask), and shipped only with Uday's
go-ahead.

## Settled after the builder check (Claude's calls)

1. **Principal missions match what Principals can actually do.** Deciding approvals and verifying documents are
   Coordinator/Owner actions in the code (`aprCanDecide_`, `canManageStaff`). So a Principal's missions are:
   - SS marks against the monthly quota (2 per employee, `ss-tracker.gs`);
   - daily-report issues;
   - the daily report;
   - replying to "Info Requested" on their own requests;
   - documents to upload.
2. **Today's set is fixed once a day.**
   - At the person's first load after 04:00 IST, the game picks up to 3–5 missions (core first), and stores their
     ids in `Game Daily` with yesterday's set, for roll-over.
   - Finishing one does **not** pull in another, so the bar can fill.
   - Urgent work arriving mid-day goes to the next-step bar, not into today's set.
   - An item that vanishes without being resolved (e.g. an auto-closed task) drops out as "no longer needed". It
     doesn't count as done, and doesn't count against the day.
3. **"Days on track" is computed nightly on the game backend, from core missions only.**
   - A time trigger reads the source sheets directly; the project runs as Uday, as the Coordinator backend does.
   - **A day counts** when it is a working day for that campus (the existing working-day logic, as in
     `tpExpectedWorkingDays_`) and the person was not on approved leave (Approvals). Others aren't counted at all.
   - **On track** means that day's core missions were done by the next reset, whether or not the person opened the
     portal. A teacher logging CW/HW from the mobile app counts.
4. **Unassigned Coordinator tasks are shared missions.**
   - A Tasks row with no Assignee is a shared mission for every Coordinator of that district, labelled "shared".
   - Resolving it marks it done for all. Help credit is not given between holders of the same shared mission.
   - An Assignee, where set, makes it that person's alone.
5. **Phase 1 loads `game.js` on the role homes only** (Principal, Coordinator, Owner). Done detection reads source
   data, so it doesn't matter where the work was done. The next-step bar on module pages comes in Phase 2, with the
   restamping and `verify.mjs` checks for each page.
6. **Visit-only quest steps are removed** (see Quests). "Done from data" stays strict.
7. **Done detection reads the source record, not a Tasks row** (agreed with the Coordinator chat). Approval and
   hiring Tasks rows auto-resolve as "system (condition cleared)". So:
   - an approval mission is done when the Approvals row carries a decision (`doneBy` = `decidedByEmail`);
   - complete-hire is done when the Employee Master row exists;
   - **a hiring stall is a shared district mission.** It fills the district team bar, gives no personal credit, and
     is **left out of individual days-on-track**, because only the campus can mark Hired. A person's day never
     depends on someone else's action.
8. **The Principal-scoped read of daily-report issues** (`principalissues`, a read-only Principal branch in
   `coordVerifyCaller_`) is built **once, by the Coordinator chat**, in the Coordinator backend in November. The
   framework's Principal adapter uses it and never builds a second copy.
9. **The game backend is created from the Mac with clasp**, as the Office backend was, and registered in
   `apps-script/projects.json`. Uday's part: run its setup once and accept the permission screen.

## Settled in the conversation

- Mascot: a wise owl in the LMS uniform, look, name and voice as one character; soft 3D; lead plus cast; Teacher Owl
  added; lead named Buddy (all Uday).
- The voice is trialled on Uday's Telegram updates first (Uday).
- Leaderboards: private standing only, plus team goals and beat-your-own-last-month (Uday).
- Questions for Uday go through the LMCS Master Agent chat (Uday's standing rule).

## Open questions for Uday (sent via the LMCS Master Agent)

1. **Who may close a daily-report issue?** Claude's recommendation: the Principal closes it with an outcome note,
   and the Coordinator sees every closure and can reopen it.
2. **Which 3 days a week are track-suit days?** (Buddy's outfit calendar.)
3. **Confirm "days on track" instead of personal streaks.** Individuals see "18 of 21 school days on track",
   never a breakable streak; only teams have streaks with a freeze.

## Left to the builder

- Exact mission ordering and wording within the voice guide, the tour beat scripts, and badge art.
- Spotlight and animation details, and how far the "game" look goes before it hurts legibility, within the LMCS
  tokens.
- The exact sheet columns and action names on the game backend, following the `coordinator*` patterns.
- How the outfit calendar's track-suit days are entered (config UI or sheet).
- Whether the Today panel also appears on module screens or only on role homes.

*Compiled from Claude conversation, 2026-10-25. Sources: Uday's requests (direct and via the LMCS Master Agent), the
Kingshot research, the School Uniform bye-law and staff dress code, the transport game design, the Coordinator
backend code, and the module chats' plans.*
