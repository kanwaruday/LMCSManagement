# Owner Portal Part B (six insight views) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six drill-down insight views for Owners (Escalations, Hiring funnel, Academics, Staff, Money,
Compliance). Each has little on top and goes deep below; Academics goes 8 levels deep, subject-first.

**Architecture:**
- **Backend:** a new Apps Script project, **LMCS Owner Backend**: `owner.gs` (dispatcher, auth,
  cache, Drive store), plus one file per view. It reads sheets with `openById`, the public CW/HW feed by
  UrlFetch, and PDR and Coordinator over HTTP with the caller's token.
- **Academics cube:** built from the feed and the Chapter Tracker sheet by a 30-min trigger.
  - Persisted as gzipped files in the backend's Drive folder (the last good copy) and mirrored in
    CacheService.
  - The maths are pure functions, tested in node and gated on the real feed.
- **Frontend:** `owner/<view>/index.html`, using `owner/shared.js` (Part A). The drill state lives in
  `#path=`.

**Tech Stack:** Apps Script V8, static HTML/JS, Python 3 (compliance export), Node `vm` tests.

**Spec:** `docs/superpowers/specs/2026-10-23-owner-portal-design.md` (Part B)

## Global Constraints

- **Feed:**
  - `COORD_CWHW_URL` (the same value as `coordinator.gs`).
  - Fields: `lmsIdx, classMapped, subject, stream, teacher, cwBook, cwChapter, cwDesc, cwTag, hwChapter,
    hwDesc, hwTag, dateStr, timeMs`, plus `cmData`.
  - There's no section: the v1 section unit is teacher within class.
- **Chapter Tracker sheet** `11u0Aeonc_CdwDa7ysXrdsF6vs2xYKxckQjOnc7ZEuCM`: the AY tab, with headers
  `School, Class, Subject, Chapter No., Chapter Name, Teacher, Term, Planned CWA Date, Effective
  Deadline, Actual CWA Date, Status, Days Late/Overdue, Last Updated`. It is the source of on-track and
  plan slippage.
- **Tags:** canonical `['Chapter Teaching','Question & Answers','New Words','Activity','CWA','Remediation','OTT','RT','Laboratory','Field Trip']`,
  anything else → `Other`. Sequence codes T Q N A C R O V L F ?.
- **Episode** = within (lmsIdx, class, subject, teacher, chapter): entries from the first one through
  the first CWA. Later entries are "post-CWA".
- **Remediation is matched on the same chapter (Uday, 2026-10-25: "remediations need to get matched to the
  chapters").** A CWA counts as remediated only by a Remediation-tagged entry on the **same episode key**: the same
  lmsIdx, class, subject, teacher and normalised chapter, within `remWindowDays` after the CWA. A Remediation logged
  under another chapter, or matched only on teacher-class-subject, does not count.
- **One episode engine, shared with the Teacher game, used unchanged.** It is **already built**:
  `apps-script/acad-episodes.gs` on LMCSManagement branch `teacher-game-t1` (1b0d9ae or later), with its tests in
  `tests/game/test-acad-episodes.js`. Owner B neither copies nor edits it; a change to it goes through the Teacher game
  chat. The game spec is `docs/superpowers/specs/2026-10-25-teacher-portal-game-design.md` (branch
  `teacher-portal-game-design`, 9e73291 or later), "Settled after the builder check" #1. What Owner B relies on:
  - **Chapter normaliser `ownAcadNormChapter_`** keeps letters, combining marks and digits of any script, and turns
    every other run of characters into one space. It deliberately differs from ChapterTracker's
    `chapterNormalizeName`, which strips everything outside `[a-z0-9]`. That blanks every Devanagari chapter name:
    7,314 of 30,418 CW/HW entries (24%) across Hindi, Sanskrit and some Maths and EVS. Never substitute the
    ChapterTracker normaliser, and never join the Chapter Tracker rows by `chapterNormalizeName` (see
    `ownAcadTracker_`).
  - **`cwa` and `remediationWithin`** are time-in-ms numbers, or `null`.
  - **Entries with more than `maxEntryTags` (6) tags** stay in their episode for periods and tag counts, but never
    mark a CWA and never count as remediation.
  - **The book group comes from an optional argument**, `ownAcadEpisodes_(records, rules, bookGroupOf)`: `bookGroupOf(record) -> g`,
    which defaults to `''`. The Owner passes its own.
  - **`ownAcadNoCwa_(episodesByTcs, rules)`** sets `e.noCwa = true` on the closed no-CWA episodes and returns them.
  - **`hw`** is the number of entries with HW.
  - **`seq`** is an array of tag codes, one per entry (`TQNACROVLF`, `?` = Other).
  - **Rules** pass through `ownAcadRules_(rules)`, which reads `remWindowDays`, `maxEntryTags`,
    `minEpisodePeriods`, `noCwaGapDays` and `exemptSubjects`.
- **The remediation baseline** is entry-level: `acadRemediatedCwaEntries_` counts every CWA entry, including
  M classes, exempt subjects and thin episodes. On the 25 Oct 2026 snapshot it gives **60 of 1,793 CWAs (3%)**
  remediated on the same chapter within 14 days. The class-subject rule this plan used before gave about 16% on the
  same CWAs. The Owner's L1 `noRemediationRate` is episode-level instead (Class 1+, non-exempt, ≥ 3 periods). It is
  measured in the Task 2 gate, not assumed equal to 97%.
- **`OWN_ACAD_RULES`** (one block): `paceHigh 1.5, paceLow 0.5, noCwaGapDays 21, remWindowDays 14,
  maxEntryTags 6, thinShare 0.5, inflationShare 0.6, inflationTags 3, loggingLookbackDays 30, minNorm 3, minEpisodePeriods 3, minUnits 5, outlierZ 2.5, maxSignalRate 0.15`.
  `remWindowDays`, `maxEntryTags`, `minEpisodePeriods`, `noCwaGapDays` and `exemptSubjects` are engine parameters
  and must equal the game's values. The rest are Owner-only.
- **Episodes counted:** Class 1 and up (not M-I to M-III), subject not in `CHAPTER_CWA_EXEMPT_SUBJECTS` (`['general knowledge','computer']`, copied), and at least `minEpisodePeriods` entries.
- **Findings vs outliers:** network `no_remediation` (about 97% of CWA entries under the same-chapter rule on 25 Oct 2026; the episode-level rate is measured in Task 2) and `no_cwa` (29%, measured 2026-10-23) are **findings**, shown as headline rates with the best and worst school. **Outlier flags** fire only for units with ≥ `minUnits` episodes whose binomial z against the network rate is ≥ `outlierZ`; **bright spots** are z ≤ −`outlierZ` (the "learn from" list). Measured at teacher level on 2026-10-23: no_cwa worse 12%, bright 11%. The remediation outlier and bright-spot rates were measured under the old class-subject rule (4% / 21%) and are **re-measured** in the Task 2 gate; with a 97% network rate, bright spots (teachers who do remediate on the same chapter) are the useful list. Pace is absolute against the chapter norm.
- **Level 1 of every view:** ≤ 4 numbers plus one list, "most unusual first", and an "as of" stamp. B5
  and B6 also show the sync time.
- **Auth:**
  - Owner-only, except the academics reads (`owneracad`), which also allow a Coordinator, filtered to
    `coordVisibleCampuses_`-equivalent campuses.
  - A FeeClerk-only caller is refused everywhere.
  - `owneracadflag` and `ownerescflag` are Owner-only.
  - `compliancepush` is secret-only.
- **Storage:**
  - The cube and the L8 rows are gz files in Drive folder Script Property `OWNER_DATA_FOLDER_ID`.
  - The cache mirrors the cube (chunked, `ownerCachePutBig_`).
  - A rebuild runs under the script lock (no stampede) and **keeps the previous files** if the feed
    fetch fails or `cwRecords.length` falls by more than 30%.
- **Payroll:** copy `payroll.gs` lock semantics (`payLocks_`, `payEntity_`, `payMonthKey_`; Month cells
  are Dates; an unlock deletes the Locked row). Tabs `Run Log`, `Payroll Register`. `HES` = Head office.
- **Measured expectations on the real feed (2026-10-23):**
  - 2,989 cube cells, 1.1 MB JSON, 120 KB gz;
  - 193 of 1,162 chapters normable (≥ 3 completed episodes);
  - pace outliers ≈ 8% of normed episodes;
  - tag inflation 4 of 83 teachers.
  - L8 rows are 1.5 MB gz, so they live in a Drive file, not the cache.

## Review Focus

1. **Outlier rates:** on the real feed, every *outlier flag* fires on fewer than `maxSignalRate` (15%) of
   its units. The network findings (`no_remediation`, about 97% of CWA entries under the same-chapter rule, and `no_cwa` ≈ 29%) are
   reported, not gated. The shared engine's remediation numbers must equal the Teacher game's on the same feed:
   the Owner and the teacher's card never show different numbers for the same chapter.
   Gate in Task 2.
2. **Book groups:** never compared across. When a chapter norm is too thin, the comparison uses the
   class-subject book-group pooled norm, labelled. Test in Task 2.
3. **Coordinator scoping:** a district-locked Coordinator reading `owneracad` gets no other district's
   cells. A FeeClerk is refused. Test in Task 3.
4. **Funnel:** each candidate counted once; scoped by `hirCallerCampuses_`. Test in Task 5.
5. **Compliance:** only the current document per (entity, doc_type); non-expiring types never flagged;
   no `valid_to` on an expiring type → "no expiry recorded", not overdue. Tests in Task 7.

---

### Task 1: Owner Backend project

**Files:**
- Create `apps-script/owner.gs`, `apps-script/owner-manifest.json` (the manifest used only for project
  creation), `tests/owner/test-owner-auth.js`.
- Modify `apps-script/projects.json` (`owner` entry), `owner/shared.js` (`OWNER_BACKEND_URL`,
  `Owner.own(action, params)`, `Owner.ownPost(body)`) and `tests/verify.mjs` (the owner exec URL is
  added via `projects.json` automatically).

**Interfaces:**
- `doGet` / `doPost` dispatch.
- `ownerVerifyCaller_(idToken) -> {email, campusId, roles, visible}|null` (the `coordVerifyCaller_`
  pattern, allowlist `1NZu0ElismFytG395Nxjz29vAz7OfkmJtZhs70bOwT58`, cached 300 s). `visible` = null
  (ALL) or campuses, as in `coordVisibleCampuses_`.
- `ownerRequire_(caller, roles)`.
- `ownerCachePutBig_` / `ownerCacheGetBig_`.
- `ownerFileSave_(name, obj)` / `ownerFileLoad_(name)` (gz JSON in `OWNER_DATA_FOLDER_ID`).
- `ownerFetchJson_(url, token?)`.
- `ownerSetup()`: creates the data folder and the `Owner Data` sheet (Script Property
  `OWNER_DATA_SHEET_ID`), installs the 30-min trigger `ownerAcadRefresh`, and generates
  `COMPLIANCE_PUSH_SECRET`. **It never logs the secret.**

- [ ] Tests: an Owner passes; a Coordinator is refused on an Owner-only action and allowed on an
  academics read, with `visible` set; a FeeClerk is refused; a bad token gives null; the file
  save/load round-trips (fake DriveApp). FAIL → implement → PASS.
- [ ] Create the project:
  1. `npx -y @google/clasp@3 create --type standalone --title "LMCS Owner Backend"` in a temp dir.
  2. Copy `owner.gs` and `owner-manifest.json` (as `appsscript.json`: scopes `spreadsheets`,
     `drive`, `script.external_request`, `script.scriptapp`; `webapp` executeAs USER_DEPLOYING,
     access ANYONE_ANONYMOUS; timeZone Asia/Kolkata).
  3. `clasp push`, then `clasp deploy`.
  4. Put the scriptId and deploymentId in projects.json, and the exec URL in `owner/shared.js`.
- [ ] **Uday:** open the project and run `ownerSetup()` once (the OAuth consent), then copy the secret
  from Project Settings → Script properties to `~/.lmcs/compliance_secret`.
- [ ] `node apps-script/deploy.mjs --check` PASS. Commit.

### Task 2: Academics cube, episodes, norms, signals (pure) + real-feed gate

**Files:** Use `apps-script/acad-episodes.gs` from `teacher-game-t1` unchanged: merge or rebase onto that branch, or onto main once it lands there, and never copy the file. Create `apps-script/owner-academics.gs` (everything Owner-only), `tests/owner/test-academics.js`, `tests/owner/fixtures/feed-sample.json` (synthetic), `tools/owner-acad-gate.js` (runs the pure functions on a downloaded real feed and prints the signal rates; not part of verify).

**Interfaces** (pure):
- **From `acad-episodes.gs`, used as built (see Global Constraints):**
  - `ownAcadNormChapter_(s)` and `ownAcadTags_(cwTag)`.
  - `ownAcadEpisodes_(records, rules, bookGroupOf) -> episode[]`, where an episode is
    `{key:{g,cls,subj,ch,lms,teacher}, periods, tags:{tag:n}, hw:<count>, first, last, cwa:<ms>|null,
    seq:<code[]>, postCwa:{periods,tags}, remediationWithin:<ms>|null}`.
  - `remediationWithin` is the first Remediation entry with the same episode key, within `remWindowDays`
    after the CWA, from an entry with no more than `maxEntryTags` tags (Uday, 2026-10-25).
  - `ownAcadNoCwa_(episodesByTcs, rules)` sets `e.noCwa`.
  - `acadRemediatedCwaEntries_(records, rules)` is the entry-level baseline.
- **New, in `owner-academics.gs`:**
  - `ownAcadBookGroups_(records) -> bookGroupOf(record)`: the function passed to `ownAcadEpisodes_`.
  - `no_remediation` is `e.cwa !== null && e.remediationWithin === null`.
  - `no_cwa` is `e.noCwa === true`.
- `ownAcadNorms_(episodes, rules)` gives per-chapter norms `{n, medianP, p25, p75, medianShare, shape}`
  when n ≥ `minNorm`, else `{n, tooFew:true}`, plus per (g, cls, subj) pooled norms.
- `ownAcadSignals_(episode, norm, pooled, rules)` returns per-episode facts: `pace_slow|pace_fast`
  (chapter norm only), `no_cwa`, `no_remediation`, `thin_interaction` (chapter norm, else pooled, with
  `basis:'pooled'`).
- `ownAcadFindings_(episodes, rules) -> {signal: {rate, n, bySchool:{lms: rate}, best, worst}}` is
  the network findings.
- `ownAcadOutliers_(episodes, findings, rules, unit:'teacher'|'teacherClass') -> {worse[], bright[]}`
  (schools get best and worst from the findings, never flags)
  uses the binomial z vs the network rate (≥ `minUnits`; worse z ≥ `outlierZ`, bright z ≤ −`outlierZ`),
  sorted by |z|. `worse` drives "most unusual first"; `bright` is the "learn from" list.
- `ownAcadTeacherSignals_(entries, rules)` covers `inflation` and `logging_gap` (school days = dates
  with any entry from that lmsIdx; only teacher-classes active in the last `loggingLookbackDays`).
- `ownAcadTracker_(trackerRows) -> {"<lms>|<class>|<subject>|<chapter>": {status, overdue}}`, with `<chapter>` = `ownAcadNormChapter_(Chapter Name)`, so it joins the episode keys (and Devanagari names don't collapse).
- `ownAcadBuild_(feed, trackerRows, prevMeta, rules) -> {cube, meta}|{keepPrevious:true, reason}`.
  It keeps the previous build when the feed is missing or `records < 0.7 × prevMeta.records`.
- `ownAcadLevel_(cube, path, visible)` returns one payload shape per depth (L1–L7), filtered by
  `visible`:
  - L1 `{numbers:{onTrackPct, noRemediationRate, noCwaRate, loggingCoveragePct}, findings, list}`.
    The list is subjects ranked by outlier count. `onTrackPct` and slippage come from
    `ownAcadTracker_`.
  - L3 chapters in plan order (`cmData`); chapters without a plan follow, ordered by first date and
    marked "no plan".
  - L4 `{norm|pooled, schools:[…]}`.
  - L6 `{seq, dates, signals}`.
  - L7 teacher.

- [ ] Tests (synthetic fixture):
  - book-group separation;
  - a too-thin chapter falls back to pooled, labelled;
  - "no plan" ordering;
  - multi-tag counting (once per tag in shares, once in periods);
  - the engine's own rules (episode cut at the first CWA, the gap rule, same-chapter remediation, the 7-tag
    exclusion, the exempt subjects, M classes, short episodes, Devanagari chapters) are covered by
    `tests/game/test-acad-episodes.js`. Owner tests don't repeat them. They check the Owner's use instead:
    - `bookGroupOf` is passed and lands in `key.g`;
    - `no_remediation` and `no_cwa` are read from `remediationWithin` / `noCwa` (null-safe);
    - a Hindi chapter appears at L3 under its own name;
    - a remediation on the next chapter shows as no_remediation at L6;
  - findings rate and best/worst on the fixture;
  - an outlier needs ≥ 5 units and z ≥ 2.5 (a unit at the network rate is not flagged; a perfect unit with n=20 at net 80% is bright);
  - inflation;
  - logging gap;
  - tracker overdue → slippage;
  - keepPrevious when records drop more than 30%;
  - `visible` filtering;
  - L1 numbers equal hand-computed values.
- [ ] FAIL → implement → PASS.
- [ ] **Real-feed gate:** download the feed to the scratchpad and run `node tools/owner-acad-gate.js
  <feed.json>`. Every *outlier flag* (worse) rate must be < `maxSignalRate`, and the findings must be near the
  measured values: no_cwa ≈ 29% (measured 2026-10-23 on 2,766 episodes, Latin chapters only), teacher worse
  12% / bright 11%. Episode counts rise now that Devanagari chapters form episodes, so record the new episode
  count and no_cwa rate rather than forcing the old ones.
  **Remediation:** on the 25 Oct 2026 snapshot, `acadRemediatedCwaEntries_` gives 60 of 1,793 (the game's
  `tools/teacher-baseline.js` prints the same). Record the episode-level `noRemediationRate` and the remediation
  worse/bright rates freshly; the old 4% / 21% were under the class-subject rule. Tune only the Owner-only rules
  until the gate holds, or set that signal's `hidden:true` and list it for Uday. Also check the expectations in
  the Global Constraints. Record the rates in the ledger.
- [ ] **Deploy wiring:** `deploy.mjs --check` already accepts files in `projects.json`'s top-level `shared`
  list (built on `teacher-game-t1`, with `tests/game/test-deploy-check.js`). Add `acad-episodes` and
  `owner-academics` to `owner.files`, and run `node apps-script/deploy.mjs --check`. Commit.

### Task 3: Academics endpoints, refresh, SS join, flag

**Files:** Modify `apps-script/owner.gs` and `owner-academics.gs`. Test: extend `tests/owner/test-academics.js`.

**Interfaces:**
- `ownerAcadRefresh()` (the trigger) runs under the lock:
  1. fetch the feed and read the tracker AY tab;
  2. `ownAcadBuild_` with `prevMeta` (from the `acad-meta` file);
  3. save `acad-cube.json.gz`, `acad-rows.json.gz` (the L8 fields only) and `acad-meta`;
  4. mirror the cube to the cache.
- GET `owneracad&path=<json array>`:
  - read the cube from the cache, else the Drive file, else rebuild under the lock;
  - `ownAcadLevel_(…, caller.visible)`;
  - L8 loads `acad-rows` and filters.
- L7 SS join: call PDR `ssdashboard` with the caller's token (cached 10 min per caller). Map employees
  to a roster code the way `coordAcademicsAggregate_` maps `campus|coordNormName_` to a code, and join
  on the code. If there's no code match, show "SS not matched", never a wrong person.
- POST `owneracadflag {path, signal, assignee?}` (Owner-only) → Coordinator `coordinatorownerflag` with
  the caller's token and a link `owner/academics/#path=…`.

- [ ] Tests:
  - a district Coordinator gets no out-of-district cells;
  - a FeeClerk is refused;
  - the SS join by code, with an unmatched name → "not matched";
  - the flag payload;
  - a cache miss → file load (fake), without rebuilding.
- [ ] FAIL → implement → PASS. Commit.

### Task 4: Academics UI (8 levels)

**Files:** Create `owner/academics/index.html` and `owner/academics/view.js` (exports for node). Test: `tests/owner/test-academics-view.js`.

- [ ] Helpers:
  - `tagBar_(share, normShare?, basis?)`: a stacked bar with a norm tick overlay and a "pooled norm"
    label;
  - `seqStrip_`;
  - `numbers_`;
  - `list_`.

  Tests: esc; bar widths sum to 100%; the pooled label; seq colours. FAIL → implement → PASS.
- [ ] Page:
  - the breadcrumb with `#path`;
  - by-school select;
  - teacher search → L7;
  - "Send to Coordinator" at L4–L7 (pick an assignee from the `coordinatorpdr` coordinators);
  - "as of" and the stale warning when keepPrevious;
  - lists capped at 12, with "show all".
- [ ] Browser check with a stub returning fixture payloads for L1–L8, at 1280/375, with no console
  errors. Commit.

### Task 5: Hiring funnel (PDR) + Escalations

**Files:**
- Modify `apps-script/hiring.gs` and `main.gs`.
- Create `apps-script/owner-escalations.gs`, `owner/hiring/index.html`, `owner/escalations/index.html`,
  `tests/hiring/test-funnel.js`, `tests/owner/test-escalations.js`.

**Interfaces:**
- `owner/hiring/` calls PDR `hiringfunnel` **directly** (`Owner.pdr`), not through the Owner backend.
- `hiringFunnel_(caller)`:
  - Owner or Coordinator; scoped by `hirCallerCampuses_(caller)`;
  - read-only, with no `hirAutoBackfillWalkIns_` or `hirAssignEmployeeCodes_` (it calls
    `hirBuildApplicants_` directly).
  - **Each candidate in exactly one cell:** campus = the first visible branch tag; role = the reported
    position's requisition, else the best-scoring `matchedRoleKeys`, else "No open role".
  - It returns `{campuses:[{campusId, roles:[{roleKey, label, stages:{stage:{n, medianDays}}}]}],
    total}`.
  - Days in stage come from the stage's evidence date (shortlistedAt, accepted appointment start,
    report submittedAt, salaryOfferAt, decision decidedAt, DOJ).
- `ownEscalations_(caller)`:
  - Owner; the Coordinator `coordinatortasks` with the token, **cached 5 min** (it runs all adapters);
  - plus the Tasks tab, for resolved rows in the last 90 days.
  - It returns `{numbers:{highOpen, overdue, approvalsOver3d, ownerFlagsOpen}, byDomain, resolvedMedianDays}`.
  - POST `ownerescflag` (Owner) → `coordinatorownerflag`.

- [ ] Tests:
  - the funnel total equals unique candidates when a candidate has 2 branches and 2 roles;
  - a Coordinator from LMS1 sees no LMS4;
  - medianDays on a fixture;
  - escalations aggregation (pure).
- [ ] FAIL → implement → PASS.
- [ ] UIs:
  - Funnel: network → school → role → stage → candidate (opens `hiring/index.html#row=`).
  - Escalations: network → domain → school → task, with "Send to Coordinator".
- [ ] Add `owner-escalations` to `projects.json` `owner.files`. Browser check. Commit.

### Task 6: Staff + Money

**Files:** Create `apps-script/owner-staff.gs`, `apps-script/owner-money.gs`, `owner/staff/index.html`, `owner/money/index.html`, `tests/owner/test-staff-money.js`.

**Interfaces:**
- `ownStaff_(caller)`:
  - reads EmpMaster + EmpSalary (`1OjVMUvpLM8JkdAwjmljCtZUI1VUqGLbic36cW9dm0C0`);
  - headcount per school × department/designation (Active), and joiners/leavers per AY month
    (DateOfJoining, DoRes/DoRel);
  - school by code prefix, with `HES` = Head office; `admintm` is hidden;
  - documents missing from the Coordinator `coordinatordocuments` (token, cached 10 min).
- `ownMoney_(caller)`:
  - Payroll workbook `1sal-zeXPZazN2ASqF7CchfJo-tF9_-Q80zcZtXbNwY8`: `Run Log` (copied lock semantics)
    and `Payroll Register` (lines for a drilled month);
  - Transport `Transport P&L` and the `LM Studio Sync` time from workbook
    `1VXTMZjqCS82ftB1rwoN4BzoiOTP7-Vg0m5vTH01Tfzc`.
- The pure helpers `ownLocked_(runLogRows)` and `ownHeadcount_(master, salary)` are tested.

- [ ] Tests: Date-typed Month cells; an unlocked (deleted Locked row) month isn't locked; HES
  separate; admintm hidden; joiner/leaver buckets. FAIL → implement → PASS.
- [ ] UIs:
  - Staff: network → school → department → person.
  - Money: network → school → month → lines; and network → bus → month.
- [ ] Add `owner-staff` and `owner-money` to `projects.json` `owner.files`. Browser check. Commit.

### Task 7: Compliance (push from the Mac + view)

**Files:**
- Create `drive-index/export_compliance.py`, `apps-script/owner-compliance.gs`,
  `owner/compliance/index.html`, `tests/owner/test-compliance.js`,
  `tests/owner/test_export_compliance.py`.
- Modify `ai-coordinator/run.sh`.

**Interfaces:**
- `export_compliance.py`:
  - From `records.db` `documents` WHERE `entity_type IN ('school','society')`, keep only the
    **current** row per (entity, doc_type) = the max `valid_to` (`records.py`'s definition).
  - Send `entity, entity_type, doc_type, reference_no, valid_to, drive_link`.
  - POST to `OWNER_BACKEND_URL` scraped from `owner/shared.js`, with the secret from env or
    `~/.lmcs/compliance_secret`. `--dry-run` prints the counts and posts nothing.
- `ownCompliancePush_` checks the secret, then rewrites the `School Compliance` tab of
  `OWNER_DATA_SHEET_ID`, plus a `syncedAt`.
- `ownCompliance_(caller)` merges buses (Coordinator `coordinatortransport` `fleet[]`, token) with that
  tab. `ownComplianceClass_(doc, today)` returns:
  - `nonexpiring` for photos/other/bye_laws/land_record/building_plan;
  - `noexpiry` for an expiring type with a blank `valid_to`;
  - `overdue`, `due60` or `ok` otherwise.

- [ ] Tests: in Python, a temp SQLite with an old and a new copy of one doc → only the new one; buses
  excluded; dry-run posts nothing. In JS, the class boundaries. FAIL → implement → PASS.
- [ ] Add `python3 drive-index/export_compliance.py` to `ai-coordinator/run.sh` after the drive pass.
  UI: network → entity type → entity → document → file. Add `owner-compliance` to `projects.json`
  `owner.files`. Browser check. Commit.

### Task 8: Owner home cards + verify, review, ship

- [ ] The Owner home cards show each view's first number, through one cached call each.
- [ ] `node tests/verify.mjs` and `python3 -m unittest tests/owner/test_export_compliance.py` pass;
  `node tools/owner-acad-gate.js` on a fresh feed is still under 15%.
- [ ] A fresh reviewer (most capable model) on the whole branch, with this Review Focus. TDD fix pass.
- [ ] Deploy:
  - `node apps-script/deploy.mjs owner --push --deploy` (dry run first);
  - PDR (`hiringfunnel`) and Coordinator if changed;
  - run `python3 drive-index/export_compliance.py` once;
  - merge, push, `--live`;
  - browser-check every view as Owner.
- [ ] Vault: update `lmcs-management` (Owner portal, build log, signal rates).
