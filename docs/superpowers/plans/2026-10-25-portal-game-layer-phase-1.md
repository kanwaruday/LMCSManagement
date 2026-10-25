# Portal Game Layer, Phase 1 (the shell + pilot group) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Buddy greets Principals, Coordinators and the Owner once a day on their role home, shows a fixed Today
list of real pending work (core missions first), a next-step bar, Quest 1, "days on track", and the first decision
window (track-suit days). It is piloted on a group of campuses, with every Coordinator and the Owner.

**Architecture:**
- **The "LMCS Game Backend" is a new Apps Script project.** It runs as Uday and verifies each caller's Google ID token
  against the Principal Allowlist (the Coordinator backend's pattern).
- **It computes missions server-side,** from the source sheets it can open read-only (Approvals, Tasks, Daily
  Reports) and from two existing actions called with the caller's own token: PDR `ssdashboard` and Coordinator
  `principalissues`.
- **It stores only snapshots, progress, windows and decisions**, in its own workbook.
- **On the front end, one module (`assets/game/game.js` + `game.css`) mounts on the three role homes**, the way
  `LMCSAppts.mount` does today.

**Tech Stack:**
- Google Apps Script (V8);
- static HTML/CSS/JS on GitHub Pages, no framework and no build;
- Node `vm`-based tests run by `tests/verify.mjs`;
- clasp through `apps-script/deploy.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-25-portal-game-layer-mascot-design.md`, approved by Uday on 2026-10-25.
Read "Settled after the builder check" first.

## Change from the spec (record in the spec's Settled section in Task 1)

- **Mission adapters run server-side, in the game backend,** not as browser functions. The nightly/lazy "days on
  track" judgement already needs them on the server, so a browser copy would mean the same logic twice.
- **Modules contribute adapter `.gs` files to the game backend project** later, e.g. `game-adapter-transport.gs`
  (Phase 2). They read their own sheets read-only.

## Phase 1 simplifications (each marked in code with a `ponytail:` comment)

1. **Days on track are finalized lazily**, at the person's first load of a later day, using each mission's `doneAt`
   from source data. A day with no snapshot (the person never opened a home) is not counted. Phase 2 adds a nightly
   snapshot for everyone, which teachers need.
2. **Go links open the right page,** with the record named in the mission text. Deep links to the exact record come in
   Phase 2, with the next-step bar on module pages; module pages are untouched in Phase 1.
3. **The Owner edits `Game Config`, `Game Windows` and `Game Quests` as sheets.** The Season setup screen is Phase 3.
4. **Buddy art for the pilot may use the Canva preview renders** (about 200 px) for the avatar and the greeting
   figure. Full-size renders replace them before the February pilot (Task 9).

## Global Constraints

- **Real work only.** A mission exists only if real pending work exists. `done` comes from source data, never a tick.
- **Never reward speed.** No time-to-complete anywhere. No countdowns: show dates, e.g. "closes Sat 8 Nov".
- **No ranking of people** on any surface in Phase 1. Private standing is Phase 4.
- **Unfinished work rolls over** with the tag "from yesterday". Nothing is wiped.
- **Daily reset at 04:00 IST** (`Asia/Kolkata`; set the script time zone explicitly and never rely on the default).
- **Today cap:** 5 for Principal, Coordinator and Owner (from `Game Config` `cap.<Role>`, default 5).
- **Core missions** (season 0 defaults in `Game Config`, never constants in logic):
  - Principal: `ss_pace`, `pdr_issue`;
  - Coordinator: `approval_recommend` (pending ≥ 3 days, awaiting their recommendation), `hiring_stall`;
  - Owner: `approval_wait` (the Owner decides every approval at go-live).
- **Coordinators are network-wide** (Uday): no district scoping anywhere. A district is only a display grouping.
- **Shared missions** (`hiring_stall`, and Coordinator Tasks with no Assignee) never give personal credit and never
  count toward days on track.
- **The progress workbook holds email, role, campus, record ids, flags and counts only.** No names, free text or ₹.
  The decision `note` is the one free-text field (the decider's own words, Owner-visible).
- **Copy follows the vault's `work/LMS Mascot Voice Guide.md`:** warm, plain, short, no guilt, no hype, no pronouns
  assumed, bad news states the fact first. The speaker is **Buddy**.
- **Front end:**
  - works at 375 px and on desktop;
  - keyboard-reachable, with a visible focus ring;
  - respects `prefers-reduced-motion`;
  - sound off;
  - LMCS tokens from `assets/style.css` (`--red: #ce0000`);
  - the game panel renders **after** the page's own content and never blocks it.
- **Nothing personal in static files or the repo.** Names arrive at runtime from the backend.
- **Before every commit, run `node tests/verify.mjs`.** After staging HTML and assets, run
  `node tools/stamp-assets.mjs`.

## Review Focus

1. **A source backend times out or errors** (PDR `ssdashboard` can take 20 s+).
   - Expected: Today still shows the missions from the other sources, plus one quiet line: "Some of today's list
     couldn't load; I'll try again later." The home page itself is never delayed.
   - Test in Task 6.
2. **A person with nothing pending.**
   - Expected: Buddy says an "All clear" line, the next-step bar hides, and the day is **not** counted for or against
     days on track.
   - Tests in Tasks 3 and 7.
3. **Scope leaks.**
   - Expected: a Principal sees only their own campus; a Coordinator every campus (within the pilot); the
     Owner everything. A Fee Clerk or Teacher calling `gametoday` gets "not available yet".
   - Test in Task 2.
4. **The 04:00 IST boundary.**
   - Expected: a load at 03:59 IST belongs to the previous day, and 04:00 starts the new day's snapshot. Two
     near-simultaneous loads create one snapshot, not two.
   - Tests in Task 3.
5. **Decision windows misused.**
   - Expected rejections, each with a plain message: a non-decider, a campus outside scope, a closed window, the
     wrong number of picks (track-suit days need exactly 3 of Mon–Sat), or a second decision in the same window. An
     Owner override is allowed and logged.
   - Tests in Task 4.

---

### Task 1: Game backend skeleton, config and setup

**Files:**
- Create: `apps-script/game.gs`
- Modify: `apps-script/projects.json` (add `"game"`: name "LMCS Game Backend", files `game`, `game-missions`,
  `game-windows`, `game-quests`; `scriptId` and `deploymentId` empty until Task 11)
- Modify: `docs/superpowers/specs/2026-10-25-portal-game-layer-mascot-design.md` (add the "Change from the spec"
  above to "Settled after the builder check" as point 10)
- Test: `tests/game/test-config.js`

**Interfaces:**
- Produces:
  - `GAME_TZ = 'Asia/Kolkata'`
  - `gameDayKey_(date: Date) -> 'YYYY-MM-DD'`: the game day, which starts at 04:00 IST
  - `gameParseConfig_(rows: any[][]) -> Config`
  - `gameVerifyCaller_(idToken) -> { email, campusId, roles[], primaryRole, canDecide } | null`: copy of
    `coordVerifyCaller_`, but allows every allowlisted role
  - `gameVisibleCampuses_(caller) -> string[] | null`: `null` means all (Owner and Coordinator); a Principal gets
    `[campusId]`
  - `GAME_MODULE_ACTIONS`: an object `{ action: fn(caller, params) }` that module `.gs` files (e.g. the Teacher chat's
    `game-teacher.gs`) add to; `doGet`/`doPost` look actions up here after the built-in ones
  - `gameSetup()`: creates the workbook "LMCS Game" and its tabs, seeds the defaults, and stores the id in Script
    Properties as `GAME_SHEET_ID`
- **Workbook tabs** (header rows exactly as listed; code indexes by position):
  - `Game Config`: `Key, Value` (Value is JSON text)
  - `Game Daily`: `Day, Email, Role, Campus, MissionIds, DoneIds, Finalized, OnTrack, CreatedAt`
  - `Game Progress`: `Email, Kind, Key, Value, At`. Kinds: `tour`, `quest_step`
  - `Game Windows`: `WindowId, Title, Question, Scope, ScopeId, Decider, Choice, DefaultIfUndecided, Opens, Closes,
    AppliesFrom, Writes, OpenedBy, ConfirmBy`
  - `Game Decisions`: `WindowId, ScopeId, Value, Note, DecidedBy, DecidedAt, Kind` (Kind: `decided`,
    `default_applied`, `override`)
  - `Game Quests`: `QuestId, Role, Title, UnlockAfter, StepsJson, Reward`
- **Config keys** seeded by `gameSetup()`:
  - `pilotCampuses: ["LMS4","LMS5","LMS6"]` (Uday names the pilot campuses at deploy)
  - `cap: {"Principal":5,"Coordinator":5,"Owner":5}`
  - `core: {"Principal":["ss_pace","pdr_issue"],"Coordinator":["approval_recommend","hiring_stall"],"Owner":["approval_wait"]}`
  - `approvalWaitDays: 3`
  - `uniform: {"summerFrom":"2027-05-03","winterFrom":"2026-10-26","festivals":[]}`
  - `trackSuitDays: {}`
  - `principalIssuesReady: false`
  - `principalIssuesGo: ""` (the Coordinator chat gives the path)
  - `daysDenominator: {"Principal":true,"Coordinator":true,"Owner":true,"Teacher":false}`

- [ ] **Step 1: Write `tests/game/test-config.js`** (vm-load `game.gs` with stubs, like `tests/coordinator/test-approvals.js`):
  - `gameDayKey_(new Date('2026-10-26T22:29:00Z'))` (03:59 IST on the 27th) === `'2026-10-26'`;
  - `gameDayKey_(new Date('2026-10-26T22:30:00Z'))` (04:00 IST) === `'2026-10-27'`;
  - `gameParseConfig_([['Key','Value'],['cap','{"Principal":3}']]).cap.Principal === 3`, with the other cap roles
    falling back to 5;
  - bad JSON in a Value cell falls back to that key's default and does not throw;
  - `gameVisibleCampuses_({campusId:'LMS5',roles:['Coordinator']})` returns `null` (network-wide);
  - for `{campusId:'ALL',roles:['Owner']}` it returns `null`;
  - for `{campusId:'LMS2',roles:['Principal']}` it returns `['LMS2']`.
- [ ] **Step 2: Run** `node tests/game/test-config.js`. Expected: it fails, because `gameDayKey_` is not defined.
- [ ] **Step 3: Implement the Task 1 interfaces in `apps-script/game.gs`.**
  - Header comment with SETUP steps, as in `coordinator.gs`, plus the "ponytail" ceilings listed above.
  - `doGet`/`doPost` dispatch on `action`, and return `{success:false,error:'Unknown action'}` otherwise.
- [ ] **Step 4: Run** the test, then `node tests/verify.mjs`. Expected: pass. The `gs files mapped to projects`
  check must pass with the new `projects.json` entry.
- [ ] **Step 5: Commit:** `git add apps-script/game.gs apps-script/projects.json tests/game/test-config.js docs/superpowers/specs/…` then `git commit -m "Game backend skeleton: config, day key, caller scope, setup"`.

### Task 2: Mission adapters (pure functions)

**Files:**
- Create: `apps-script/game-missions.gs`
- Test: `tests/game/test-missions.js`

**Interfaces:**
- Consumes: `gameDayKey_`, `gameVisibleCampuses_`, Config (Task 1).
- Produces:
  - **Mission:**
    `{ id, kind, title, why, owner, campus, go, due, core, shared, done, doneAt, doneBy, rolledOver, gone, progress? }`.
    `progress` is `{done, total}` for grouped cards (e.g. a teacher's "2 of 4 classes logged"); `done` is then
    `progress.done >= progress.total`.
    `id` = `"<kind>:<recordId>"`. `go` = a portal path relative to the site root.
  - `gamePrincipalMissions_(caller, src, cfg, now) -> Mission[]`, where
    `src = { ss: ssdashboard JSON|null, reports: DailyReports rows|null, approvals: Approvals rows|null, issues: principalissues JSON|null }`
  - `gameCoordinatorMissions_(caller, src, cfg, now) -> Mission[]`, where `src = { tasks: Tasks rows, approvals: Approvals rows, recommendations: Recommendations rows }`
  - `gameOwnerMissions_(caller, src, cfg, now) -> Mission[]`, where `src = { approvals, recommendations }`
  - `gameMissionsFor_(caller, src, cfg, now) -> Mission[] | { notYet: true }`: dispatches by `primaryRole`
  - `gameSsSubmittedBy_(ss, email, dayKey) -> number`: today's SS submissions by this evaluator
  - `gameSsPaceTarget_(needed: number, now: Date) -> number`:
    `Math.ceil(needed / remainingWorkingDaysIncludingToday)`, with Mon–Sat as working days, 0 when needed is 0.
- **Source columns (0-indexed):**
  - Approvals: id 0, campusId 1, category 2, title 4, requestedByEmail 11, requestedAt 12, status 13,
    decidedByEmail 14, decidedAt 15, archived 18.
  - Tasks: TaskId 0, Domain 1, Campus 2, Title 3, Status 5, ResolvedAt 9, ResolvedBy 10, Assignee 13, Due 14.
  - Daily Reports: Timestamp 0, Date 1 (ISO), CampusId 2, PrincipalEmail 3.
- **Mission kinds:**

  | Kind | For | Pending when | Done when (doneAt / doneBy) | go |
  |---|---|---|---|---|
  | `ss_pace` | Principal | campus staff are below the monthly quota (`roster[].school` = campus, needed = Σ max(0, quotaPerMonth − submissionsThisMonth)) | today's `history` entries by `caller.email` ≥ the target fixed in the snapshot | `principals-daily-reporting/index.html` |
  | `pdr_report` | Principal | no Daily Reports row for (today's ISO date, campus) | the row exists (Timestamp) | `principals-daily-reporting/index.html` |
  | `pdr_issue` | Principal | each `issues[]` item with status ≠ resolved (`reopened` counts as open). Only when `cfg.principalIssuesReady` | status resolved (`resolvedAt`, `resolvedBy`) | path given by the Coordinator chat for the Principal issue screen (config key `principalIssuesGo`) |
  | `info_requested` | Principal | own Approvals row (requestedByEmail = caller) with status "Info Requested" | status no longer "Info Requested" | `principals-daily-reporting/index.html` |
  | `approval_recommend` | Coordinator | Approvals row Pending for ≥ `approvalWaitDays`, not archived, with no Coordinator recommendation yet. Personal if the matching Tasks row (`approval|<id>|Pending`) has the caller as Assignee, else **shared** | a `Recommendations` row with a reason (doneBy = recommender). Owner decided first = `gone` | `coordinator/approvals/index.html` if it exists, else `coordinator/followups/index.html` |
| `approval_wait` | Owner | Approvals row Pending for ≥ `approvalWaitDays`, not archived. `why` = the latest recommendation ("recommended approve by {name}") | status Approved/Rejected/Revoked (decidedAt, decidedByEmail); archived without a decision = `gone` | `coordinator/approvals/index.html` if it exists, else `coordinator/followups/index.html` |
  | `hiring_stall` | Coordinator | Tasks Domain `hiring_stall`, open, in scope; **shared** | Tasks Status resolved | `coordinator/followups/index.html` |
  | `followup` | Coordinator | any other open Tasks row in scope. Assignee = caller → personal; blank Assignee → shared | Tasks resolved, and ResolvedBy not `system…` | `coordinator/followups/index.html` |

- [ ] **Step 1: Write `tests/game/test-missions.js`** with fixture rows (dates relative to `now = 2026-10-27T05:00:00Z`):
  - **Principal LMS4,** fixture: ss roster where 2 staff need 1 each and 1 needs 2 (needed = 4); 4 working days
    left in the month incl. today. Expect:
    - `gameSsPaceTarget_(4, now) === 1`;
    - one `ss_pace` mission with `core:true`;
    - `pdr_report` present when no row for 2026-10-27 LMS4, absent once a row exists;
    - `info_requested` only for the caller's own request;
    - no `pdr_issue` while `principalIssuesReady:false`, two when true with one open and one reopened issue.
  - **Scope:** an LMS2 approval never appears for the LMS4 Principal, and does appear for a Coordinator and for the
    Owner.
  - **Coordinator:** an approval pending 4 days with no recommendation → `approval_recommend` with `core:true`; with a
    recommendation by `c@lms.org.in` → `done:true, doneBy:'c@lms.org.in'`; decided by the Owner first → `gone:true`;
    pending 2 days → none. **Owner:** the same 4-day approval → `approval_wait` with the recommendation in `why`. Archived pending → none. `hiring_stall` → `shared:true, core:true`. A blank-Assignee follow-up →
    `shared:true`. An assigned follow-up → `shared:false`.
  - **Done detection:** an approval decided by `a@lms.org.in` at T → `done:true, doneBy:'a@lms.org.in', doneAt:T`.
    A follow-up resolved by `system (condition cleared)` → `done:false`, plus a `gone:true` flag ("no longer
    needed").
  - **Roles:** a Teacher or Fee Clerk caller → `gameMissionsFor_` returns `{ notYet: true }`.
- [ ] **Step 2: Run** `node tests/game/test-missions.js`. Expected: fail (not defined).
- [ ] **Step 3: Implement the adapters plus `gameMissionsFor_(caller, src, cfg, now)`** (dispatch by `primaryRole`;
  Owner beats Coordinator beats Principal). Titles come from `gameTitle_(kind, data)`: one line per kind in Buddy's
  voice, e.g. `approval_wait`: "Approval from {campus} has waited {days} days: {title}". No pronouns.
- [ ] **Step 4: Run** the test, then `node tests/verify.mjs`. Expected: pass.
- [ ] **Step 5: Commit:** `git commit -m "Game missions: Principal, Coordinator and Owner adapters with done detection"`.

### Task 3: Today snapshot, roll-over and days on track

**Files:**
- Modify: `apps-script/game-missions.gs`
- Test: `tests/game/test-today.js`

**Interfaces:**
- Consumes: Mission (Task 2), Config.
- Produces:
  - `gamePick_(missions, cap, coreKinds, yesterdayOpenIds) -> Mission[]`. Order: rolled-over first, then core, then
    by `due` (nulls last), then oldest. Take `cap`.
  - `gameSnapshot_(dailyRows, email, dayKey) -> { row: number, missionIds: string[], doneIds: string[] } | null`
  - `gameFinalizeDay_(snapshot, missionsNow, dayKey, cfgCore) -> { counted: boolean, onTrack: boolean }`.
    - Counted only if the snapshot held ≥ 1 core, non-shared mission.
    - onTrack = every such mission was done with `doneAt` before the next day's 04:00 IST.
    - A `gone` mission is excluded.
  - `gameDaysOnTrack_(dailyRows, email, monthKey) -> { onTrack, counted, lastMonthOnTrack, lastMonthCounted }`

- [ ] **Step 1: Write `tests/game/test-today.js`:**
  - pick with cap 5 from 8 missions (2 core, 1 rolled over) → the rolled-over one first, then both core;
  - pick from 0 missions → `[]`;
  - finalize:
    - all core done by 03:59 IST next day → counted, on track;
    - one done at 04:01 → counted, not on track;
    - only shared or no core missions → not counted;
    - a gone core mission is ignored;
  - days on track over fixture rows for October 2026 → `{onTrack:18, counted:21, …}`;
  - `gameSnapshot_` finds today's row and returns `null` for a new day.
- [ ] **Step 2: Run** it. Expected: fail.
- [ ] **Step 3: Implement the Task 3 functions.**
- [ ] **Step 4: Run** the test, then `node tests/verify.mjs`. Expected: pass.
- [ ] **Step 5: Commit:** `git commit -m "Game today: fixed daily set, roll-over, lazy days-on-track"`.

### Task 4: Decision windows

**Files:**
- Create: `apps-script/game-windows.gs`
- Test: `tests/game/test-windows.js`

**Interfaces:**
- Consumes: Config, `gameVisibleCampuses_`.
- Produces:
  - `gameWindowsFor_(caller, windowRows, decisionRows, now) -> Window[]`.
    - Open windows where the caller is the decider for a scopeId in scope.
    - Each item: `{ windowId, title, question, scopeId, choice, current, closes, decided: Decision|null }`.
  - `gameWindowBoard_(caller, windowRows, decisionRows, now) -> [{ windowId, scopeId, state: 'decided'|'waiting'|'default_applied', value }]`,
    for Coordinator and Owner (all campuses).
  - `gameValidateDecision_(caller, window, value, existing, now) -> { ok: true } | { ok: false, error: string }`
  - `gameApplyDefaults_(windowRows, decisionRows, now) -> Decision[]`: windows closed with no decision for a scopeId
    → `Kind: 'default_applied'` rows to append.
  - `gameDecisionWrites_(window, scopeId, value) -> { key, path, value }`. E.g. `Writes = "trackSuitDays"` with scopeId
    `LMS4` → set `trackSuitDays.LMS4 = ["Mon","Wed","Fri"]`.
- **The track-suit window row** (a template seeded by `gameSetup()`; the Owner sets Opens/Closes to open it):
  - Title "Track-suit days for your campus", Question "Which 3 days a week do students come in track suits?";
  - Scope `campus`, ScopeId `*` (expands to each pilot campus), Decider `Principal`;
  - Choice `{"type":"pickN","n":3,"options":["Mon","Tue","Wed","Thu","Fri","Sat"]}`;
  - DefaultIfUndecided `["Mon","Wed","Fri"]`, Writes `trackSuitDays`.

- [ ] **Step 1: Write `tests/game/test-windows.js`.** Valid case: the LMS4 Principal picks `["Mon","Wed","Fri"]` →
  ok. Each rejection gets its exact message:

  | Case | Error message |
  |---|---|
  | 2 picks | "Pick exactly 3 days." |
  | a Thursday duplicated | "Pick exactly 3 days." |
  | "Sun" | "Sun isn't one of the options." |
  | LMS4 Principal deciding LMS2 | "That campus isn't yours to decide." |
  | a Teacher | "Only the Principal decides this." |
  | after Closes | "This window closed on {date}." |
  | a second decision | "Already decided on {date}. The Owner can change it." |

  Also test:
  - an Owner deciding LMS2 after a Principal's decision → ok, Kind `override`;
  - `gameApplyDefaults_` after close with LMS5 undecided → one `default_applied` row for LMS5 only;
  - the board for a Coordinator of LMS4–6 lists LMS4–6 only.
- [ ] **Step 2: Run** it. Expected: fail.
- [ ] **Step 3: Implement the Task 4 functions** in `apps-script/game-windows.gs`. Dates show as "Sat 8 Nov" (IST).
- [ ] **Step 4: Run** the test, then `node tests/verify.mjs`. Expected: pass.
- [ ] **Step 5: Commit:** `git commit -m "Game decision windows: validate, decide, defaults, board"`.

### Task 5: Quest 1 for Principal and Coordinator

**Files:**
- Create: `apps-script/game-quests.gs`
- Test: `tests/game/test-quests.js`

**Interfaces:**
- Consumes: Mission (Task 2), Decision (Task 4), `Game Progress` rows.
- Produces:
  - `gameQuestState_(questRows, role, evidence, progressRows, email) -> [{ questId, title, steps: [{ id, title, go, done, locked }], complete }]`
    - `evidence = { missionsDoneByMe: Mission[], ssByMe: number, decisionsByMe: Decision[], daysOnTrack }`
    - Check kinds map like this: `pdr_report`, `pdr_issue`, `approval_recommend` and `followup` count missions with
      `doneBy` = me; `ss_submit` counts `ssByMe`; `decision` counts `decisionsByMe`; `day_on_track` counts
      `daysOnTrack.onTrack`.
    - Steps are sticky once done (Progress row `quest_step`).
    - Only the first unfinished quest is unlocked; about 3 steps are visible, and the rest show `locked: true`.
  - `gameQuestNewlyDone_(…) -> [{ questId, stepId }]` (rows to append).
- **Seeded quests (StepsJson):** each step is `{id, title, check: {kind, count}}`. No "open/look" steps.
  - **Principal Quest 1 "Your portal":**
    - `pdr_report` ×1 "Submit today's daily report"
    - `ss_submit` ×1 "Submit one SS evaluation"
    - `pdr_issue` ×1 "Close one daily-report issue with a note" (skipped while `principalIssuesReady:false`)
    - `decision` ×1 "Choose your campus's track-suit days"
    - Reward: "Quest badge: Your portal".
  - **Coordinator Quest 1 "Your network"** (as agreed with the Coordinator chat):
    - `approval_recommend` ×1 "Recommend on one approval that has waited 3+ days"
    - `joiner_added` ×1 "Add one joiner to the Employee Master" (hidden until the Coordinator chat names the source
      that records who added the row; config `joinerSource`)
    - `followup` ×1 "Resolve one follow-up with an outcome note"

- [ ] **Step 1: Write `tests/game/test-quests.js`:**
  - with one `pdr_report` done by me → step 1 done, the step 4 decision not done;
  - a step done earlier stays done when today's evidence is empty;
  - `pdr_issue` is hidden while not ready;
  - a Coordinator's `followup` resolved by `system…` does not count;
  - all steps done → `complete:true`, and the next quest unlocks.
- [ ] **Step 2: Run** it. Expected: fail.
- [ ] **Step 3: Implement** `gameQuestState_` and `gameQuestNewlyDone_`.
- [ ] **Step 4: Run** the test, then `node tests/verify.mjs`. Expected: pass.
- [ ] **Step 5: Commit:** `git commit -m "Game quests: Quest 1 for Principal and Coordinator"`.

### Task 6: Backend actions: `gametoday`, `gamedecide`, `gametourseen`

**Files:**
- Modify: `apps-script/game.gs`
- Test: `tests/game/test-actions.js`

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces (the front end's only contract):
  - `GET ?action=gametoday&idToken=…` returns:
    ```
    { success, day, firstLoadToday, role, campus, notYet?,
      missions: Mission[] (today's fixed set, done flags fresh),
      next: Mission|null (first not-done in today's set, else first pending outside it — mid-day work),
      quests, daysOnTrack, windows, board?,
      config: { trackSuitDays, uniform },
      sourcesDown: string[] }
    ```
  - `POST action=gamedecide {idToken, windowId, scopeId, value, note}` → `{success}` or `{success:false,error}`.
    - Lock: `LockService.getScriptLock()`.
    - Appends a Game Decisions row and writes the config key.
  - `POST action=gametourseen {idToken, tourId}` → `{success}`.
  - `gameFetchJson_(url, idToken, timeoutMs) -> object|null`: UrlFetch with `muteHttpExceptions`. The result is cached
    in `CacheService` per `(url, email)` for 600 s. It returns `null` on any failure.
  - PDR URL: the `pdr` deploymentId. Coordinator URL: the `coordinator` deploymentId. Both are constants at the top of
    `game.gs`.
- **Rules:**
  - pilot gate: a caller outside `pilotCampuses`, unless Owner → `{success:true, notYet:true}`;
  - the snapshot is created under the script lock on first load, so two parallel loads create one row;
  - finalize every unfinalized earlier row for this person before building today's;
  - `firstLoadToday` is true only for the call that created the row;
  - defaults for closed windows are applied lazily on read.

- [ ] **Step 1: Write `tests/game/test-actions.js`.** Use fakes for SpreadsheetApp, UrlFetchApp, CacheService,
  LockService and Session time.
  - first call creates a snapshot with `firstLoadToday:true`; the second returns `false`, with the same `missions`
    ids;
  - `ssdashboard` returns 500 → `sourcesDown:['ssdashboard']`, while the other missions are still present;
  - a caller outside the pilot → `notYet:true`;
  - `gamedecide` with a bad value → `{success:false,error:'Pick exactly 3 days.'}` and no row written;
  - with a good value → a row is written and `trackSuitDays.LMS4` is updated.
- [ ] **Step 2: Run** it. Expected: fail.
- [ ] **Step 3: Implement** the actions in `game.gs`.
- [ ] **Step 4: Run** the test, then `node tests/verify.mjs`. Expected: pass.
- [ ] **Step 5: Commit:** `git commit -m "Game backend actions: today, decide, tour seen"`.

### Task 7: Front-end logic (pure): outfit, lines, next step

**Files:**
- Create: `assets/game/game.js` (the `window.LMCSGame` IIFE; the pure helpers are exposed for tests)
- Test: `tests/game/test-game-js.js`

**Interfaces:**
- Consumes: the `gametoday` response (Task 6).
- Produces:
  - `LMCSGame.outfit(date: Date, campusId, cfg) -> 'winter-formal'|'summer-formal'|'tracksuit-winter'|'tracksuit-summer'|'festival'`.
    - Festival dates beat everything.
    - Track-suit day (`cfg.trackSuitDays[campusId]` includes today's Mon–Sat key) → the track-suit look of the
      season.
    - Season: summer if `summerFrom ≤ date < winterFrom` within the session year, else winter.
  - `LMCSGame.greetingLine(today, session) -> string`:
    - "Good morning, {firstName}. {n} things are waiting today. The first is {missions[0].title}."
    - With none: "Good morning, {firstName}. Nothing is waiting today. Enjoy the calm."
    - "Good afternoon" after 12:00 IST and "Good evening" after 17:00.
    - firstName comes from `session.name`, at runtime.
  - `LMCSGame.daysLine(d) -> string`: "{onTrack} of {counted} days on track this month" (with "Last month: x of y"
    when present). Returns `''` when counted is 0. When `d.showDenominator === false` (config `daysDenominator`) it
    says "{onTrack} days on track this month".

- [ ] **Step 1: Write `tests/game/test-game-js.js`** (vm with a minimal `window`):
  - LMS4 with `trackSuitDays.LMS4 = ['Mon','Wed','Fri']` on Mon 2 Nov 2026 → `tracksuit-winter`;
  - on Tue 3 Nov → `winter-formal`;
  - on 10 May 2027 → `summer-formal`;
  - a festival date → `festival`;
  - the greeting with 0 missions uses the calm line;
  - `daysLine({onTrack:18,counted:21})` contains "18 of 21";
  - `daysLine({counted:0})` returns `''`;
  - `daysLine({onTrack:18,counted:21,showDenominator:false})` is "18 days on track this month".
- [ ] **Step 2: Run** it. Expected: fail.
- [ ] **Step 3: Implement** the pure helpers in `assets/game/game.js`.
- [ ] **Step 4: Run** the test, then `node tests/verify.mjs`. Expected: pass.
- [ ] **Step 5: Commit:** `git commit -m "Game front end: outfit calendar, Buddy lines, days line"`.

### Task 8: Front-end UI: greeting, Today, next-step bar, quest, decision card, tour

**Files:**
- Modify: `assets/game/game.js`
- Create: `assets/game/game.css`, and `tests/game/ui-stub.html` (loads game.js with a fixture `gametoday` response;
  never deployed as a portal page, no real names)

**Interfaces:**
- Consumes: Task 7 helpers, Task 6 contract.
- Produces: `LMCSGame.mount(el: HTMLElement, opts: { session, backendUrl, data?: TodayResponse })`.
  - `data` skips the fetch, for the stub page.
  - It renders into `el` and appends the next-step bar to `document.body`.
- **Behaviour** (match the vault mockup `work/mascot concepts/Login greeting mockup.html`):
  - **Greeting overlay:** only when `firstLoadToday`.
    - Buddy figure in today's outfit, a dialogue box with "Buddy", `greetingLine`, and the buttons **Show me**
      (scrolls to the Today panel and focuses the first Go) and **Later**. **Skip** sits top-right.
    - Esc closes it, focus is trapped while it's open, and focus returns afterwards.
  - **Today panel:** the title "Today", "{done} of {n} done", and a segmented bar. Each row has the title, a small
    line (source and "from yesterday" / "shared" tags) and **Go**. Done rows show "Done" and are struck through. With
    `sourcesDown` non-empty, show the line from Review Focus 1.
  - **Next-step bar:** fixed at the bottom with the avatar, "Next" and the title, plus **Go**. Hidden when `next` is
    null. It reserves body padding so it never covers content.
  - **Quest panel:** "Quest 1 · {title}", "{done} of {n}", step rows, and locked rows greyed with "Locked · …".
  - **Days line** under the quest panel.
  - **Decision card:** for each open window, a Today row "Decide: {title} · closes {date}". Go opens a modal with the
    question, current value, options (checkboxes for pickN), an optional note, and **Decide**.
    - Errors from `gamedecide` show inline, verbatim.
    - On success: "Saved. Buddy will wear the track suit on {days}."
  - **First-visit home tour** (`tourId = 'home-' + role`, shown once, after the greeting): 4 beats with a spotlight on
    Today, Go, the next-step bar and the quest panel. Skip is always there. Posts `gametourseen`.
  - **Loading:** a skeleton of 3 rows. **Error:** one line and a Retry button. Never blocks the page.
- [ ] **Step 1: Build the UI** in `game.js` and `game.css`.
- [ ] **Step 2: Serve the stub and check it.** Run `python3 -m http.server` from the repo root, open
  `tests/game/ui-stub.html` in the browser pane at 375×812 and at desktop, and check each behaviour above. Use the
  fixtures for: 5 missions with 1 rolled over, 0 missions, `sourcesDown`, and an open window.
  - Expected: no horizontal scroll at 375 px, keyboard-only works, and reduced motion removes the rise animation.
- [ ] **Step 3: UI/UX review, up to 3 rounds** (Uday's standing ask: "till you're proud of it"). Apply
  `impeccable-for-lmcs` (critique, polish) and `taste-for-lmcs`, then fix what they find, with screenshots at 375 and
  desktop each round.
- [ ] **Step 4: Run** `node tests/verify.mjs`. Expected: pass.
- [ ] **Step 5: Commit:** `git commit -m "Game UI: greeting, Today, next-step bar, quest, decision card, tour"`.

### Task 9: Buddy art set

**Files:**
- Create: `assets/game/buddy/` with:
  - `{winter-formal,summer-formal,tracksuit-winter,tracksuit-summer,festival}-{neutral,celebrate,nudge,bad}.webp`,
    each transparent and about 480 px tall;
  - `avatar-{outfit}.webp` (a head-and-tie crop, 96 px).

**Interfaces:**
- Produces: the file names `LMCSGame` uses (`buddy/<outfit>-<pose>.webp`). game.js falls back to
  `winter-formal-neutral.webp` when a file is missing.

- [ ] **Step 1: Generate the renders** in Canva (generate-image, soft 3D, the same Buddy description as the vault's
  `work/LMS Mascot Concepts.md`, one outfit per prompt, then remove-background).
  - Consistency check: same face, eye colour and proportions across all 20.
  - Use **LM Studio** (`qwen3-vl-30b-a3b-instruct`, `http://localhost:1234/v1`) to screen the batch: ask it, for each
    image, "same owl as the reference? yes/no, why", and regenerate the no's. Follow the call pattern in
    `drive-index/lmstudio_summarize.py`.
- [ ] **Step 2: Size the files.** If only Canva previews (~200 px) are obtainable, use them for the pilot and ask
  Uday (via the LMCS Master Agent) to download the chosen full-size images from his Canva uploads. Convert to WebP
  (`cwebp`), and crop the avatars.
- [ ] **Step 3: Check them in the stub** at 32, 40 and 96 px for the avatar and at 240 px for the figure, on light and
  dark backgrounds.
- [ ] **Step 4: Run** `node tests/verify.mjs`. Expected: pass.
- [ ] **Step 5: Commit:** `git commit -m "Buddy art set: 5 outfits × 4 poses, avatars"`.

### Task 10: Mount on the three role homes

**Files:**
- Modify: `principal/index.html`, `coordinator/index.html`, `owner/index.html`. Add `<link rel="stylesheet"
  href="../assets/game/game.css">`, a `<section id="game-root" aria-label="Today with Buddy">` placed **above** the
  module grid, and `<script src="../assets/game/game.js"></script>` after `auth.js`. Call
  `LMCSGame.mount(document.getElementById('game-root'), { session, backendUrl: GAME_BACKEND_URL })` at the end of
  each page's existing `showApp`/`gate` function, after its own rendering.
- Modify: `tools/stamp-assets.mjs` (add the three homes to `PAGES`)
- Test: `tests/game/test-homes.js`

**Interfaces:**
- Consumes: `LMCSGame.mount` (Task 8). `GAME_BACKEND_URL` is a constant in each page and stays empty until Task 11;
  when it's empty, mount renders nothing.

- [ ] **Step 1: Write `tests/game/test-homes.js`.** For each of the 3 homes, read the HTML and assert:
  - the `game.css` link, `#game-root` and the `game.js` script are present;
  - `game.js` comes after `auth.js`;
  - `LMCSGame.mount(` appears inside the page's sign-in callback.
- [ ] **Step 2: Run** it. Expected: fail.
- [ ] **Step 3: Edit the three pages.**
- [ ] **Step 4: Stage, stamp and verify.** Run `git add` on the changed files, then `node tools/stamp-assets.mjs`,
  then `git add` the pages again, then `node tests/verify.mjs`. Expected: pass, including
  `test-asset-stamps`.
- [ ] **Step 5: Commit:** `git commit -m "Mount the game layer on the Principal, Coordinator and Owner homes"`.

### Task 11: Deploy and pilot (needs Uday)

**Files:**
- Modify: `apps-script/projects.json` (`scriptId`, `deploymentId`), and `GAME_BACKEND_URL` in the three homes.

- [ ] **Step 1: Create the project from the Mac.** Run `npx @google/clasp@3 create --type standalone --title "LMCS Game Backend"`
  in a temp folder, record the `scriptId`, then run `node apps-script/deploy.mjs game --push --deploy "Phase 1"`.
  Record the `deploymentId`. The web app runs as Me, with access for Anyone; the token check is the gate.
- [ ] **Step 2: Uday's part** (send via the LMCS Master Agent; it's one message):
  - open the project, run `gameSetup` once, and accept the permission screen;
  - name the pilot campuses;
  - confirm the uniform dates (summer from the first Monday of May, winter from the day after the Dussehra break);
  - set the track-suit window's Opens/Closes;
  - download the full-size Buddy renders if Task 9 used previews.
- [ ] **Step 3: Fill in the URLs and stamp.** Put the URL in the three homes, run `node tools/stamp-assets.mjs`, and
  run `node tests/verify.mjs`. Commit on the branch.
- [ ] **Step 4: After Uday's go-ahead only:** merge to main, push, then run `node tests/verify.mjs --live`. Sign in as
  Owner in the browser pane, then check that the greeting shows once, Today loads, and the decision board lists the
  pilot campuses.
- [ ] **Step 5: Report to the Master Agent and the vault.** Send one line to the LMCS Master Agent. Update the vault
  note `work/active/portal-game-layer.md` (status, decisions, open tasks).

## Estimate

- About 11 tasks, roughly **10–14 hours of agent work**. Tasks 1–7 are pure logic with tests. Task 8 includes up to
  3 UI review rounds. Task 9's art iteration is the most variable.
- **Uday:** about 15 minutes at deploy (Task 11, Step 2), plus a pilot review.
- **Depends on the Coordinator chat's C1 (November):**
  - `principalissues` + `principalissueresolve`, for `pdr_issue` (hidden behind `principalIssuesReady:false` until
    then);
  - the `Recommendations` tab (column layout from that chat), for `approval_recommend` and the Owner's `why`;
  - the joiner-added source, for Quest 1's second step.
