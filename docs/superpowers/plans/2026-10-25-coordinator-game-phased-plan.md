# Coordinator Portal game ("Coordinator HQ"): phased plan, with Phase C1 in full

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- **C1 (Nov 2026):** Coordinators get a Coordinator HQ. It holds:
  - every follow-up as a ranked contract card, with campus heat;
  - for every approval, a decision view with a trade-off preview and a **recommendation** form;
  - the Owner's decision shown back to them, with a private track record.

  Principals can close their own daily-report issues with a note, and Coordinators can reopen them. The shared game
  layer's two flags (`recommendationsReady`, `principalIssuesReady`) can then be turned on.
- **C2 (Dec) and C3 (Jan):** outlined at the end. Each gets its own detailed plan when C1 is done.

**Architecture:**
- **Back end:** all new back-end logic lives in the **LMCS Coordinator Backend** project, as two new files:
  - `coordinator-recommend.gs`: recommendations, decision preview, track record;
  - `coordinator-principal.gs`: the Principal-scoped issue read and resolve, under a separate read-only Principal
    gate.
- **One small change in the PDR project:** in `approvals.gs`, a comment no longer pauses a request unless the person
  commenting can decide.
- **Front end:** a new `coordinator/hq.html` page, with its pure logic in `coordinator/hq-logic.js` (testable in
  Node), and a new `principal/issues.html`. Today's pages stay. The Owner's existing Approvals detail
  (`coordinator/approvals.js`) shows the recommendation.
- **No second game engine.** Missions, the Today panel, quests, help credit and days on track are the shared game
  layer's (branch `portal-game-layer-design`, Phase 1 plan `docs/superpowers/plans/2026-10-25-portal-game-layer-phase-1.md`).
  This plan only produces the data those hooks read: the Recommendations tab and `principalissues`.

**Tech Stack:**
- Google Apps Script (V8);
- static HTML/CSS/JS on GitHub Pages, no framework and no build step;
- Node `vm` tests run by `tests/verify.mjs`;
- deploys through clasp with `apps-script/deploy.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-25-coordinator-portal-game-design.md` (approved by Uday on 2026-10-25,
commit 780b8b5). Read "Settled with Uday" and "Settled after the builder check" first.

## Global Constraints

- **The Owner decides every approval** (Uday). Coordinators recommend. No code path gives a Coordinator a decide
  button. `aprCanDecide_` is unchanged in C1.
- **Coordinators are network-wide** (Uday). Every campus is visible to them; districts are display filters only:
  LMS 1–3 = LMS1, LMS2, LMS3 and LMS 4–6 = LMS4, LMS5, LMS6.
- **Recommendations tab:** in the LMCS Approvals workbook `1Tr4Rfc6DN698eeGVjuCoXfSRR-NhBTWJibR00Ibj6P4`, tab
  `Recommendations`. Columns in exactly this order (the Game Backend reads by position):
  `RecId, ApprovalId, Campus, Category, RecommendedBy, Recommendation, Reason, Checked, RecommendedAt, Superseded`.
  - Recommendation is one of `Approve | Reject | Info`.
  - RecommendedAt is an ISO string.
  - Superseded is `TRUE` or blank.
- **The Tasks and Approvals tab columns never move** (the Game Backend reads them by position).
- **Never reward speed or volume.**
  - No time-to-recommend anywhere.
  - Comments earn nothing.
  - A reason is required for every recommendation (trimmed, non-empty, at most 500 characters).
- **No preview** for Compensation Change, Disciplinary / Termination or EPF Exemption. Their cards are plain, though
  a recommendation is still allowed.
- **Track records are private:** a Coordinator sees only their own, and the Owner sees everyone's. They are never
  ranked or shown side by side.
- **Children appear only as counts.** No staff document contents (Aadhaar, PAN, bank) on any HQ surface.
- **No names in static files or the repo.** Names arrive at runtime from the backends.
- **Copy:**
  - follows the vault's `work/LMS Mascot Voice Guide.md`: plain, short, no guilt, no pronouns assumed;
  - dates are shown as "28 Oct", never as countdowns;
  - the spec's Buddy lines are used as written.
- **Front end:**
  - works at 375 px and on desktop, keyboard-reachable, with a visible focus ring;
  - respects `prefers-reduced-motion`;
  - uses the LMCS tokens from `assets/style.css`;
  - passes the LMCS design skills (`frontend-design-for-lmcs`, `taste-for-lmcs`, `impeccable-for-lmcs`), then
    `game-ui-ux`. Up to 3 polish rounds per screen.
- **Every new `.gs` file is added to `apps-script/projects.json`** under `coordinator`.
- **Before every commit:** run `node tests/verify.mjs`. After staging HTML, also run `node tools/stamp-assets.mjs`.
- **Base the branch on the latest `origin/main`** at the start. Uday's main checkout has uncommitted Coordinator page
  edits (the School Financials rename, the HR documents link and the documents card). Don't touch them; rebase onto
  `main` once they land.

## Review Focus

1. **A recommendation on a request the Owner has just decided, or that was archived.**
   - Expected: `coordinatorrecommend` refuses it with "This request was already decided" (or "…archived"), and
     nothing is written.
   - Test in Task 2.
2. **Two Coordinators recommending at once on the same request.**
   - Expected: both rows are kept. Exactly one is not superseded (the later `RecommendedAt`), and the write runs under
     the script lock.
   - Test in Task 2.
3. **The issues tab regroups on the Mac's push** (issue ids change, as `coordPdrIssueAction_` already warns).
   - Expected: `principalissueresolve` on a vanished id returns "This issue was regrouped by the latest sync; refresh
     the page" and writes nothing. `principalissues` never returns an action for an id the Issues tab no longer has.
   - Test in Task 4.
4. **A Principal with campusId `ALL`, or a list of campuses, or a Fee Clerk, calling the Principal actions.**
   - Expected: "Not authorized". Only a Principal with exactly one campus code passes the Principal gate.
   - Test in Task 4.
5. **The HQ when one source fails.** Office `daybook.list` can return `NO_BOOK`, or time out.
   - Expected: the preview shows "Day-book spend: not known (no day book for this campus yet)", and the rest of the
     decision view still renders.
   - Test in Task 7 (pure preview formatter).

---

## Phase C1 (November 2026)

### Task 1: A comment no longer pauses a request (PDR project)

**Files:**
- Modify: `apps-script/approvals.gs` (`aprAddComment_`, around lines 376–383)
- Test: `tests/coordinator/test-comment-status.js`

**Interfaces:**
- Produces: `aprCommentStatus_(canDecide: boolean, isRequester: boolean, current: string) -> string|null`. It
  returns the new status, or `null` for no change.

- [ ] **Step 1: Write the test.** It loads `approvals.gs` in a `vm` context. Assert:
  - `aprCommentStatus_(true, false, 'Pending') === 'Info Requested'`;
  - `aprCommentStatus_(false, false, 'Pending') === null` (a Coordinator's or Principal's comment stays a comment);
  - `aprCommentStatus_(false, true, 'Info Requested') === 'Pending'`;
  - `aprCommentStatus_(true, false, 'Approved') === null`.
- [ ] **Step 2: Run** `node tests/coordinator/test-comment-status.js`. Expected: fail (not defined).
- [ ] **Step 3: Implement** `aprCommentStatus_`, and call it from `aprAddComment_` with `aprCanDecide_(caller)`.
  Behaviour is otherwise unchanged; notifications still go out.
- [ ] **Step 4: Run** the test and `node tests/verify.mjs`. Expected: pass.
- [ ] **Step 5: Commit:** `git commit -m "Approvals: only a decider's comment moves a request to Info Requested"`.

### Task 2: Recommendations: write, latest, track record

**Files:**
- Create: `apps-script/coordinator-recommend.gs`
- Modify: `apps-script/coordinator.gs` (`doPost`: route `coordinatorrecommend`; `doGet`: route
  `coordinatortrackrecord`; `coordTasksList_`: attach `recommendation` to `approval|…` tasks)
- Modify: `apps-script/projects.json` (add `coordinator-recommend` under `coordinator`)
- Test: `tests/coordinator/test-recommend.js`

**Interfaces:**
- Consumes:
  - `COORD_SHEET_ID`, `coordVisibleCampuses_`, `coordJson_` (coordinator.gs);
  - Approvals columns: id 0, campusId 1, category 2, title 4, status 13, decidedByEmail 14, decidedAt 15,
    decisionNote 16, archived 18.
- Produces:
  - `COORD_REC_TAB = 'Recommendations'`, plus `COORD_REC_HEADERS` (the Global Constraints order).
  - `coordRecValidate_(body, aprRow) -> string|null`. Returns an error message or null:
    - recommendation not in `Approve|Reject|Info` → "Pick Approve, Reject or Ask for information.";
    - empty reason → "Write the reason for your recommendation.";
    - reason over 500 characters → "Keep the reason under 500 characters.";
    - status not Pending / Info Requested → "This request was already decided.";
    - archived → "This request is archived."
  - `coordRecLatest_(recRows) -> { [approvalId]: {by, recommendation, reason, checked, at} }`: non-superseded rows
    only; on a tie, the later `RecommendedAt` wins.
  - `coordRecommend_(caller, body) -> {success, recommendation?|error}`.
    - POST `coordinatorrecommend {idToken, approvalId, recommendation, reason, checked}`, for Coordinators only (the
      Owner decides; an Owner call returns "The Owner decides directly.").
    - Under `LockService.getScriptLock()`, it marks earlier rows for that ApprovalId `Superseded = TRUE` and appends
      the new row. RecId = `rec-<millis>`. The tab and its headers are created on first use.
  - `coordTrackRecord_(recRows, aprRows, email|null) -> { [email]: { byCategory: { [cat]: {made, decided, matched} }, recent: Array<{approvalId, title, campus, recommendation, reason, decision, decisionNote, matched}> } }`.
    - Only the latest non-superseded recommendation per approval counts.
    - Decided means status Approved / Rejected / Revoked / Info Requested with a `decidedByEmail`.
    - **Match rule:** Approve↔Approved, Reject↔Rejected or Revoked, Info↔Info Requested.
    - `recent` holds the last 10 by `RecommendedAt`.
    - When `email` is set, the result holds only that key.
  - GET `coordinatortrackrecord` → `{success, records}`. A Coordinator gets only their own; the Owner gets everyone's.
  - Each `approval|<id>|…` task in the `coordinatortasks` response gains `recommendation: {by, recommendation, reason, at}|null`.
  - The match rule compares with the row's **current** decision only; it cannot see an earlier "Info Requested" that
    was later overturned. Mark this with a `ponytail:` comment naming that ceiling.

- [ ] **Step 1: Write `tests/coordinator/test-recommend.js`.**
  - Validation: each of the five messages above, for its input; and a valid input → `null`.
  - Latest: rows rec-1 (Approve, 10:00), rec-2 (Reject, 10:05), rec-3 (Superseded TRUE, 11:00), all for apr-1 →
    `coordRecLatest_` gives rec-2's `Reject`.
  - Two writes on the same request: run `coordRecommend_` twice against a fake sheet. Exactly one row is left without
    `TRUE` in column 10, and it is the second.
  - An Owner caller → `{success:false, error:'The Owner decides directly.'}`.
  - Track record:
    - c@ recommends Approve on apr-1 (Approved), Reject on apr-2 (Approved) and Info on apr-3 (Info Requested), all
      Financial / Purchase. Result: `byCategory['Financial / Purchase']` = `{made:3, decided:3, matched:2}`.
    - A pending apr-4 counts in `made` and not in `decided`.
    - `coordTrackRecord_(…, 'c@lms.org.in')` has only that key.
- [ ] **Step 2: Run** the test. Expected: fail.
- [ ] **Step 3: Implement** the functions and the routes.
- [ ] **Step 4: Run** the test and `node tests/verify.mjs` (including the projects.json mapping). Expected: pass.
- [ ] **Step 5: Commit:** `git commit -m "Coordinator: recommendations on approvals, private track record"`.

### Task 3: Decision preview

**Files:**
- Modify: `apps-script/coordinator-recommend.gs`
- Modify: `apps-script/coordinator.gs` (`doGet`: route `coordinatordecision`)
- Test: `tests/coordinator/test-decision.js`

**Interfaces:**
- Consumes:
  - Approvals rows;
  - `coordRecLatest_` (Task 2);
  - EmpMaster rows (`COORD_ROSTER_SHEET_ID`, tab `EmpMaster`, header-indexed: `SchoolCode`, `Status`);
  - Tasks rows.
- Produces:
  - `COORD_NO_PREVIEW = ['Compensation Change', 'Disciplinary / Termination', 'EPF Exemption']`.
  - `coordDecisionPreview_(aprId, aprRows, recRows, empRows, taskRows, now) -> object|null` (null when the id is not
    found):
    ```
    { id, campus, category, title, amount, waitingDays, requestedBy, preview: null | {
        history: { approved, rejected },             // same campus + category, decided in the last 365 days, excluding this id
        staff?:  { active, openStalls },             // New/ Backup Position only: Active EmpMaster rows at the campus;
                                                     // open hiring_stall Tasks at the campus
        events?: [ { title, decidedAt } ]            // Event / Invitation, Off-Campus Trip / Excursion, Holiday / Calendar:
      },                                             // the campus's approved requests in those 3 categories, last 30 days
      recommendation }                               // coordRecLatest_ entry or null
    ```
    `preview` is `null` for `COORD_NO_PREVIEW` categories and for Appointment Confirmation (stored as
    `Salary Offer Approval`). `waitingDays` counts whole days since `requestedAt`.
  - GET `coordinatordecision&id=` → `{success, decision}`, or "Not authorized" outside `coordVisibleCampuses_`.
  - **Day-book spend is not computed here.** The HQ front end reads it straight from the Office backend (Task 7), so
    this backend never opens the Office workbooks.

- [ ] **Step 1: Write `tests/coordinator/test-decision.js`.** Use fixtures for each preview kind:
  - a Financial / Purchase request at LMS4: 2 approved and 1 rejected in the last year, and one approved 400 days ago
    (not counted) → `history = {approved:2, rejected:1}`;
  - a New/ Backup Position request: 3 active and 1 inactive at LMS4, plus 1 open hiring_stall → `staff = {active:3, openStalls:1}`;
  - a Disciplinary / Termination request → `preview === null`, `recommendation` still present;
  - an unknown id → `null`.
- [ ] **Step 2: Run** it. Expected: fail.
- [ ] **Step 3: Implement** `coordDecisionPreview_` and the route. It opens the three sheets only when the route is
  called; cache the result per id for 120 s.
- [ ] **Step 4: Run** the test and `node tests/verify.mjs`. Expected: pass.
- [ ] **Step 5: Commit:** `git commit -m "Coordinator: decision preview for approvals"`.

### Task 4: Principal gate, issue read and resolve, Coordinator reopen

**Files:**
- Create: `apps-script/coordinator-principal.gs`
- Modify: `apps-script/coordinator.gs` (route `principalissues` in `doGet` and `principalissueresolve` in `doPost`,
  **before** the `coordVerifyCaller_` gate, each using its own gate)
- Modify: `apps-script/coordinator-pdr.gs` (`coordPdrIssueAction_`: accept status `reopened`, Coordinator or Owner,
  with a required note "Write why you're reopening this."; `coordPdrSyncTask_`: on `reopened` leave follow-ups alone)
- Modify: `apps-script/projects.json` (add `coordinator-principal`)
- Test: `tests/coordinator/test-principal-issues.js`

**Interfaces:**
- Consumes:
  - `COORD_PDR_SHEET_ID`, `COORD_PDR_ISSUES_TAB`, `COORD_PDR_ACTIONS_TAB`, `COORD_PDR_MERGES_TAB`;
  - `coordPdrWriteAction_`, `coordPdrSyncTask_`;
  - Issues columns: Id 0, CampusId 1, Type 2, Subject 3, First seen 4, Last seen 5, Days raised 6, Needs action 7;
  - Actions columns: Issue id 0, Status 1, Assignee email 2, Assignee name 3, Note 4, Updated by 5, Updated at 6,
    CampusId 7;
  - Merges: source id 0 → target id 1, campus 4.
- Produces:
  - `coordVerifyPrincipal_(idToken) -> {email, campusId, principal:true}|null`.
    - It follows the token check of `coordVerifyCaller_` and is cached 300 s under a separate key prefix.
    - It passes only when roles include `Principal` and campusId matches `^LMS[1-6]$`.
    - It never widens `coordVerifyCaller_`.
  - `coordPrincipalIssues_(issueRows, actionRows, mergeRows, campus|null) -> Issue[]`, with Issue as in the spec's
    `principalissues` shape: `{id, subject, campus, first, last, count, needsAction, status, assignee, resolvedBy, resolvedAt, note}`.
    - Merged-away ids are dropped and their count is added to the target. Each issue's status comes from its own
      action row, defaulting to `open`.
    - `resolvedBy` and `resolvedAt` are set only when the status is `resolved`; `resolvedAt` is the date part of
      Updated at.
    - `campus` null means every campus (Coordinator / Owner).
  - GET `principalissues` → `{success, campus, issues}`.
    - It tries `coordVerifyCaller_` first (Coordinator or Owner, `coordVisibleCampuses_` scope; `campus: "ALL"`),
      then `coordVerifyPrincipal_` (own campus).
  - POST `principalissueresolve {idToken, id, note}` → `{success}` or `{success:false, error}`.
    - Principal gate only.
    - Errors: an issue of another campus → "Not authorized"; an empty note → "Write what was done to close this."; an
      id not in Issues → "This issue was regrouped by the latest sync; refresh the page".
    - It writes action `[id, 'resolved', '', '', note, email, now, campus, lastSeen]` through `coordPdrWriteAction_`,
      then calls `coordPdrSyncTask_` (which closes any Coordinator follow-up for it).

- [ ] **Step 1: Write `tests/coordinator/test-principal-issues.js`.**
  - `coordPrincipalIssues_` with 3 LMS4 issues and 1 LMS2 issue, with LMS4 actions resolved and reopened, plus a merge
    of i3 into i1. For campus LMS4, expect:
    - 2 issues, i1 with count i1 + i3;
    - status `reopened` passed through;
    - a resolved issue with `resolvedBy` and `resolvedAt` set.
  - With campus null: 3 issues (all campuses, merges applied).
  - **The gate**, with a stubbed tokeninfo and allowlist: Principal + LMS4 passes; Principal + ALL → null;
    Principal + "LMS4, LMS5" → null; FeeClerk → null.
  - Resolve: the review-focus cases (another campus, empty note, a vanished id) each return their message and write
    nothing (the fake sheet is unchanged). A good call writes one action row with `Updated by` = the Principal.
  - Reopen through `coordPdrIssueAction_` with no note → error; with a note → status `reopened` written.
- [ ] **Step 2: Run** it. Expected: fail.
- [ ] **Step 3: Implement** the file, the routes and the two `coordinator-pdr.gs` changes.
- [ ] **Step 4: Run** the test, `node tests/coordinator/test-*.js` and `node tests/verify.mjs`. Expected: pass.
- [ ] **Step 5: Commit:** `git commit -m "Daily-report issues: Principals close with a note, Coordinators reopen"`.

### Task 5: Scheduled refresh and HQ History

**Files:**
- Modify: `apps-script/coordinator.gs`
- Test: `tests/coordinator/test-history.js`

**Interfaces:**
- Produces:
  - `coordScheduledRefresh_()`:
    - runs the approvals, hiring and documents adapters and `coordTransportRetireTasks_`, each in its own try, exactly
      as `coordTasksList_` does;
    - **skips SS compliance**, which needs a caller's token, and keeps it page-load-refreshed. Mark this with a
      `ponytail:` comment ("SS needs a script-to-script secret to join the 05:30 run");
    - then appends HQ History rows.
  - `coordInstallTriggers()`: run once from the editor. It removes any existing `coordScheduledRefresh_` trigger and
    creates a daily one at 05:30 Asia/Kolkata (`ScriptApp.newTrigger(…).timeBased().atHour(5).nearMinute(30).everyDays(1)`;
    set `appsscript.json` timeZone if it isn't already `Asia/Kolkata`).
  - `COORD_HISTORY_TAB = 'HQ History'`, a long format with columns `Date, Campus, Measure, Value`, counts only.
  - `coordHistoryRows_(taskRows, dayKey) -> Array<[dayKey, campus, measure, value]>`.
    - Measures per campus: `open`, `overdue` (Due < dayKey, or severity high), and `open.<domain>` for each domain
      present.
    - It skips a (dayKey, campus) pair already in the tab, so a rerun on the same day adds nothing.

- [ ] **Step 1: Write the test.** From 4 open tasks (2 at LMS4, one overdue; 2 at LMS1), expect rows
  `['2026-11-03','LMS4','open',2]`, `['2026-11-03','LMS4','overdue',1]`, `['2026-11-03','LMS4','open.approval',1]` and
  so on. A second call with the same dayKey and the existing rows passed in adds 0 rows.
- [ ] **Step 2: Run** it. Expected: fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the test and `node tests/verify.mjs`. Expected: pass.
- [ ] **Step 5: Commit:** `git commit -m "Coordinator: 05:30 refresh of follow-ups and a daily HQ History"`.

### Task 6: Principal issue screen

**Files:**
- Create: `principal/issues.html` (follows the structure of `principal/index.html`: `auth.js` gate, header, back link
  to `principal/index.html`)
- Modify: `principal/index.html` (one module card, "Daily-report issues", linking to `issues.html`)
- Modify: `tools/stamp-assets.mjs` (add the page)
- Test: `tests/coordinator/test-principal-page.js`

**Interfaces:**
- Consumes: GET `principalissues` and POST `principalissueresolve` (Task 4), using the Coordinator backend URL from
  `coordinator/shared.js`'s `BACKEND_URL`, copied as a constant.
- **The screen:**
  - Open and reopened issues come first (reopened tagged "Reopened" with the Coordinator's note), oldest Last seen
    first.
  - Each issue has a note box and a "Close with this note" button. The button is disabled until the note has text.
  - Below them, "Closed recently" lists issues resolved in the last 14 days, with their notes.
  - Empty state: "No open issues from your daily reports."
  - Errors show the backend's message in plain words.

- [ ] **Step 1: Write the test.** Read the HTML and assert:
  - it calls `principalissues` and `principalissueresolve`;
  - `auth.js` loads before the inline script;
  - the button is disabled when the note is empty;
  - the empty-state text is present;
  - it holds no email addresses or names (regex `/[a-z0-9.]+@lms\.org\.in/`).
- [ ] **Step 2: Run** it. Expected: fail.
- [ ] **Step 3: Build the page.** Apply the LMCS design skills and run up to 3 polish rounds at 375 px and on
  desktop, using stub data in the browser pane.
- [ ] **Step 4: Stage and stamp:** `git add` the files, run `node tools/stamp-assets.mjs`, `git add` again, then run
  `node tests/verify.mjs`. Expected: pass.
- [ ] **Step 5: Commit:** `git commit -m "Principal portal: close daily-report issues with an outcome note"`.

### Task 7: Coordinator HQ (board, heat, decision view, recommendation, track record)

**Files:**
- Create: `coordinator/hq-logic.js` (pure; exposes `window.CoordHQ` in the browser and `module.exports` in Node)
- Create: `coordinator/hq.html`
- Modify: `coordinator/systems/index.html` via `coordinator/shared.js` `pdrView`: a "Closed this week" filter and a
  Reopen button (with a reason box) on resolved issues, posting `coordinatorpdrissue {status:'reopened', note}`
- Modify: `tools/stamp-assets.mjs`
- Test: `tests/coordinator/test-hq-logic.js`, `tests/coordinator/test-hq-page.js`

**Interfaces:**
- Consumes:
  - `coordinatortasks` (with `recommendation`), `coordinatordecision`, `coordinatorrecommend` and
    `coordinatortrackrecord` (Tasks 2–3), using `Coord.api` and `Coord.postJson` from `coordinator/shared.js`;
  - Office backend GET `?action=daybook.list&idToken=…&data={"campus","from","to"}` (URL from `projects.json`
    `office.deploymentId`).
- Produces, in `CoordHQ`:
  - `districtOf(campus) -> 'LMS 1–3'|'LMS 4–6'`.
  - `flagOf(task) -> 'stuck'|'waiting'|'missing'|null`:
    - `approval|…|Pending` and `hiring_stall` → stuck;
    - `approval|…|Info Requested` → waiting;
    - `complete_hire` → missing.
  - `rankContracts(tasks, me, today) -> Task[]`, ordered by:
    1. Assignee === me;
    2. past due (`due < today`);
    3. core (domain `approval` with status Pending and no recommendation, or `hiring_stall`);
    4. severity high > medium > low;
    5. createdAt, oldest first.
  - `campusHeat(tasks, today) -> { [campus]: {score, level} }`.
    - Score per open task: 3 if past due or high, 2 if medium, 1 if low.
    - Level: `cool` < 4 ≤ `warm` < 10 ≤ `hot`.
    - Every campus LMS1–LMS6 is present (0 → cool).
    - Mark with a `ponytail:` comment: starting weights, to be tuned from HQ History.
  - `spendSummary(entries|null, error|null, amountRupees) -> string`:
    - from day-book entries (sum the `amount_paise` of `direction === 'OUT'`), e.g. "This request: ₹12,500. LMS 4
      spent ₹48,200 from the day book since 22 Oct.";
    - on `NO_BOOK` or a timeout: "Day-book spend: not known (no day book for this campus yet)";
    - Indian digit grouping.
  - `outcomeLine(rec, decision) -> string`: "Uday approved, as you recommended." / "Uday rejected: <decisionNote>"
    / "" while pending. The Owner's name comes from the data, so use "the Owner" if `decidedByEmail` isn't the Owner's.
- **`hq.html`:**
  - **Gate:** `Coord.canUse`.
  - **Header strip:** 6 bases in two district groups, each with its heat level and open count. The "All", "LMS 1–3"
    and "LMS 4–6" filter tabs filter the board.
  - **The board:** contract cards from `rankContracts`, showing:
    - title, campus, the flag chip, and age as a date ("waiting since 21 Oct");
    - **Go** links from `Coord.WORK_LINKS`;
    - for approvals: the current recommendation, or "Needs your recommendation".
  - **Decision view** (opens on an approval card), from `coordinatordecision`:
    - the preview blocks, plus `spendSummary` for Financial / Purchase;
    - the form: three radio buttons (Approve / Reject / Ask for information), a reason box and an optional "What I
      checked" box;
    - the submit stays disabled until there is a reason;
    - after a decision, the Owner's outcome line.
  - **"My track record" panel:** from `coordinatortrackrecord`, by category, made / decided / matched, plus the last
    10 with outcome lines. Wording: "Your recommendations and Uday's decisions". No percentages ranked against anyone.
  - **States:** loading, empty ("Nothing in the network is past its line today."), and an error with Retry.
  - Applies the LMCS design skills, then `game-ui-ux`, with up to 3 polish rounds at 375 px and on desktop.
  - **The board is the default** (Uday). The map layout is C2.
  - A "Closed this week" link opens the Systems page closures filter.

- [ ] **Step 1: Write `tests/coordinator/test-hq-logic.js`.** Cover:
  - the ranking order, with one fixture per rule;
  - `flagOf` for each domain;
  - `campusHeat`: 2 high + 1 low at LMS4 → `{score:7, level:'warm'}`, and LMS6 with none → `{score:0, level:'cool'}`;
  - `spendSummary` for entries, for `NO_BOOK` and for null;
  - `districtOf` for all 6 campuses;
  - `outcomeLine` for a match, a mismatch with a note, and pending.
- [ ] **Step 2: Write `tests/coordinator/test-hq-page.js`.** Assert that the page:
  - loads `auth.js`, `shared.js` and `hq-logic.js` in that order;
  - calls the four actions;
  - has a disabled submit until there is a reason;
  - contains no emails or names.
- [ ] **Step 3: Run** both. Expected: fail.
- [ ] **Step 4: Implement** `hq-logic.js`, then `hq.html`, then the Systems closures and Reopen. Run the polish rounds
  with stub data in the browser pane.
- [ ] **Step 5: Stage, stamp and verify.** Expected: pass.
- [ ] **Step 6: Commit:** `git commit -m "Coordinator HQ: ranked board, campus heat, decision view with recommendations"`.

### Task 8: The Owner sees recommendations in Approvals

**Files:**
- Modify: `coordinator/approvals.js` (`detailInner`: a "Coordinator recommendation" block above the decision buttons;
  loaded once per opened request from `coordinatordecision`)
- Test: `tests/coordinator/test-approvals-rec.js`

**Interfaces:**
- Produces: `CoordApprovals.recBlock(rec|null) -> string` (HTML):
  - with a recommendation: "<Name> recommends Approve: <reason>", plus "Checked: <checked>" when given;
  - without one: "No recommendation yet."

  Names are escaped with the module's `esc`.

- [ ] **Step 1: Write the test** (load `approvals.js` in a `vm` context with a minimal `window`). Assert:
  - a rec gives text containing "recommends Approve" and the reason;
  - null gives "No recommendation yet.";
  - a reason of `<b>` is escaped.
- [ ] **Step 2: Run** it. Expected: fail.
- [ ] **Step 3: Implement** it, without changing who can decide.
- [ ] **Step 4: Stage, stamp and verify.** Expected: pass.
- [ ] **Step 5: Commit:** `git commit -m "Approvals: the Owner sees the Coordinator's recommendation"`.

### Task 9: Home card, deploy, flags (needs Uday)

**Files:**
- Modify: `coordinator/index.html`: one "Coordinator HQ" card first in the grid. **Do this only after the shared
  layer's Task 10 (the Buddy mount) has landed on main.** Rebase onto it and leave its `#game-root` section alone.

- [ ] **Step 1:** Add the card, then stage, stamp, verify and commit:
  `git commit -m "Coordinator home: link to the Coordinator HQ"`.
- [ ] **Step 2: Dry runs:** `node apps-script/deploy.mjs coordinator` and `node apps-script/deploy.mjs pdr`. Expected:
  the file lists include `coordinator-recommend` and `coordinator-principal`, and `approvals` in pdr.
- [ ] **Step 3: Ask Uday for the go-ahead,** then run:
  - `node apps-script/deploy.mjs coordinator --push --deploy "C1: recommendations, Principal issues, HQ"`;
  - `node apps-script/deploy.mjs pdr --push --deploy "Comments no longer pause a request"`.

  Ask Uday to run `coordInstallTriggers()` once in the Coordinator project's editor.
- [ ] **Step 4:** Push the pages, then run `node tests/verify.mjs --live`. Load `coordinator/hq.html` and
  `principal/issues.html` live in the browser pane and check the console for errors (both are signed-out views; the
  signed-in check is Uday's).
- [ ] **Step 5: Tell the game director** to set `recommendationsReady: true` and `principalIssuesReady: true` in
  `Game Config`. The Go link for `approval_recommend` is `coordinator/hq.html`.
- [ ] **Step 6:** Update the vault's `work/active/lmcs-management.md` build log, and send the Master Agent a one-line
  report.

## Phase C2 (December 2026): bases. Outline only; it gets its own detailed plan

- `coordinatorhq` returns per-campus needs: decisions, hiring, staff papers, evaluations, report issues and transport.
  Campus papers come in C3.
- The SS adapter gets a script-to-script secret so it joins the 05:30 run, and the needs values are added to HQ
  History.
- One definition of required staff documents: switch the `doc_*` adapter to the 8-type matrix.
- Needs bars on the HQ header strip. The bars are shown to each campus's Principal for their own campus only.
- The transport need comes from Fleet Command's `coordinatortransportfront` once its Phase 1b lands; until then,
  from `coordinatortransport` and `coordinatortransportinsight`.
- The map layout on a laptop, using Fleet Command's `assets/game-map/` (6 bases in two district regions, missions
  pinned, a ping list).
- The Owner's role switch ("view as" a Coordinator).
- **Depends on:** Fleet Command 1b (the map shell, the front summary).

## Phase C3 (January 2027): teams and campaigns. Outline only; it gets its own detailed plan

- Team-goal definitions for the shared layer's `TeamGoal`: teams `campus:LMSn` (the Principal plus every
  Coordinator) and `network`, with the 4 season-0 goals as `Game Config` rows (editable, never constants).
- The Coordinator side of the team goal targets window (the HQ shows the proposal card).
- Help-credit lines for recommendations ("Your notes helped Uday decide 4 requests today"). The data comes from the
  Recommendations and Approvals tabs; the game director's help-credit engine shows the line.
- `Campus Papers` and `Findings` tabs:
  - a push action for Campus Papers from the Mac's drive-index sync (the `transportpush` secret pattern);
  - portal entry for findings, with each finding raising a Tasks follow-up;
  - a one-time seed from the vault's compliance checklist and the MD Academics visit notes.
- Term campaigns as season quests, and Quest 2.
- **Depends on:** the shared layer's Phase 3 (team goals, seasons, Season setup).
- **February pilot:** C1–C3 must be live, and the pilot campuses follow the shared layer's choice.

## After go-live (when Uday chooses): the handover

- A `Delegations` tab (Coordinator, category, from, by) and a per-category `aprCanDecide_` in `approvals.gs`.
- The "ready to hand over?" card in the Owner's view.
  - Its line comes from `Game Config`; the default is 20 recommendations, 90% matched, over 2 months.
  - Compensation Change, Disciplinary / Termination, EPF Exemption and Appointment Confirmation never get the card.
- Nothing is ever automatic.

## Deferred, with a reason

- **Previews for Academic Change, and working days left for Holiday / Calendar** (in the spec's preview table): C1
  shows only the common history block for these. Academic Change needs the classes named in a structured field,
  which the request form doesn't have. Working days need the school calendar, which the Coordinator backend doesn't
  read. Revisit in C2.

- **An `AddedBy` column on EmpMaster:** it is only needed for personal credit on complete-hire, which the spec keeps
  shared. Add it if Uday wants that credit.

*Plan written 2026-10-25 from the approved spec (780b8b5) and the shared layer's Phase 1 plan (portal-game-layer-design,
5fcde23 and later).*
