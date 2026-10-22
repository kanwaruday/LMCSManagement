# Owner portal v1: decisions strip and six insight views

Date: 2026-10-23. Decided with Uday in the "Principal Portal hiring review" session. The vault defines
the Owner portal as the **insight layer** and the Coordinator portal as the **action layer**
(`lmcs-management` note, "Coordinator Portal & Role-Based Restructure").

## Why

The Owner (including MD Academics) has no home. Decisions are scattered: Approvals sits in
Coordinator → Systems, Payroll is behind a Salary Dashboard button, and MD interview requests now need
somewhere to land. Nothing gives the network-wide picture that only an Owner needs.

## Goals

**Part A — Decisions strip (built after hiring v2, which supplies the appointment engine)**
1. `owner/index.html`, gated to role **Owner**. A new `LMCS.canViewOwnerPortal(session)` =
   `hasRole(session, 'Owner')`.
2. **Decisions strip** at the top: counts with one click each.
   - Approvals to decide.
   - Salary Offer Approvals (shown with the candidate's interview and demo scores).
   - MD Academics interviews to accept (the quick appointment box from hiring v2).
   - Links to Monthly Payroll and the Salary Dashboard.
3. **Approvals, approver side**, moves to `owner/approvals/`. It mounts the existing
   `coordinator/approvals.js` (`CoordApprovals.mount`) with its own `post` and `people` helpers.
   - The Approvals emails (`aprNotifyDeciders_`): **decision pending with Uday**. He may drop them
     ("emails clog the system"); otherwise they are split, with Owners getting the `owner/approvals/` link
     and delegated Coordinators the Systems link.
     `owner/approvals/` link, delegated Coordinators the existing Systems link. The Hiring and
     Principal pages' "Approvals" link points **Owners** to `owner/approvals/`.
   - `CoordApprovals.mount` keeps posting decisions to PDR itself. The page's `ctx.post` must point at
     the **Coordinator** backend (it is used only for `coordinatorallocate`), and `ctx.people` comes
     from the Coordinator backend's `coordinatorpdr` coordinators list.
   - *(Claude's call)* Coordinator → Systems keeps the same component for Coordinators with
     CanApprove, so delegated deciding still works. Nothing is duplicated, because it is one component
     mounted twice.
4. **Salary Offer Approval detail** shows, beside Approve/Reject:
   - the latest interview scores (Confidence, English, the capability grid);
   - the demo total out of 45 and the 9 scores;
   - the recommendation, and the scan link if the report was clerk-entered.

   These come from a new read-only PDR action, `hiringofferdetail {applicantId}`, which has **no side
   effects**, unlike `hiringapplicants`.
5. The root `index.html` Owner card goes live (it says "To be built" today).

**Part B — Insight views, all in v1, built in this order**

Each view follows the same rule (Uday): **little on top, depth below.**
- Level 1 shows at most 4 numbers and one short "most unusual first" list.
- Each click goes exactly one level deeper.
- A breadcrumb shows the path, and every level is linkable (`#path=...`).

| # | View | Depth | Source |
|---|---|---|---|
| B1 | **Escalations** | Network → domain → school → task | Tasks tab (open and resolved) + Approvals age |
| B2 | **Hiring funnel** | Network → school → role → stage → candidate | new PDR action `hiringfunnel` (read-only) |
| B3 | **Academics** | 8 levels, subject-first (below) | CW/HW feed + Course Mapping + Chapter Tracker + SS dashboard |
| B4 | **Staff** | Network → school → department/designation → person | Employee Master (EmpMaster, EmpSalary) + document matrix |
| B5 | **Money** | Network → school → month → line (payroll) / bus (transport) | Payroll Run Log + Register (locked months); Transport P&L tab |
| B6 | **Compliance** | Network → school/bus/society → document → file | Transport fleet docs (exists) + **new** school/society push from `records.db` |

## Non-goals

- No writes from insight views, except "Send to Coordinator" (B3, B1), which creates a follow-up
  task.
- No student marks (they are in the ERP, with no export).
- No staffing norms. Norms are undefined ([[staffing-limits-todo]]), so B4 shows actuals with a
  "norms not set" note.
- No React.

- **Money visibility:** B5 is Owner-only. The existing Coordinator Transport "Bus P&L" tab (visible to
  Coordinators) is out of scope and unchanged.
- **MD Academics holds the Owner role**, so they see everything an Owner sees. Payroll is already
  Owner-only today, so nothing new is exposed.

## Anti-goals

- A page that loads the 14 MB CW/HW feed in the browser. All heavy aggregation is server-side and
  cached.
- Numbers that disagree with the Coordinator's or Principal's pages for the same thing. Every view
  reuses the existing definitions (ladder, documents-required set, tag list) instead of re-deriving.
- An Owner view that silently shows stale data. Every view shows "as of <time>", and B5/B6 show the
  last push time.

## Architecture (Claude's call)

- **Backend: a new Apps Script project, "LMCS Owner Backend"** (`apps-script/owner.gs` plus one file
  per view), deployed like the Coordinator backend. This follows Uday's 2026-10-06 rule that new
  portals must never put the live Principals' backend at risk.
  - It authenticates with a copy of `coordVerifyCaller_`'s pattern and requires **Owner**.
  - It reads sheets directly with `openById` (it runs as Uday, who owns them).
  - It calls the PDR project over HTTP with the caller's token for hiring data (`hiringfunnel`,
    `hiringofferdetail`) and SS (`ssdashboard`), exactly as `coordinator.gs` already does.
  - Big results are gzipped and chunked into CacheService (copy `coordCachePutBig_`/`GetBig_`).
- **Frontend:** `owner/` folder, one page per view (`owner/academics/`, `owner/hiring/`, ...), plus
  `owner/shared.js` with the boot/gate, the API helper, the breadcrumb/drill helper, and `esc`.
  It follows the `coordinator/` conventions.
- **"Send to Coordinator":** POST to the Coordinator backend's existing task machinery, via a new
  action `coordinatorownerflag {campus, title, detail, department, link, assignee?}` that writes a task
  with domain `owner_flag`, Owner-only. This is a small, contained addition to `coordinator.gs`.
  Visibility follows the existing rules: Coordinators covering the campus see it, and `HES` reaches
  ALL-campus Coordinators. An optional assignee is picked from the `coordinatorpdr` coordinators list.
- **SS scores and hiring data need the caller's token**, so they can't be pre-cached by the trigger.
  They are fetched on first request and cached for 10 min. Only the cube is trigger-built (from the
  public feed). Read actions rebuild the cube on a cache miss, because a chunk can be evicted (each
  chunk lasts at most 6 h).
- **Setup is mostly scripted.**
  - `clasp create` makes the project under Uday's login.
  - A first `clasp push` from a temp dir carries an **explicit manifest**: scopes `spreadsheets`,
    `drive` (full: `DriveApp.createFolder` and file reads need it), `script.external_request`, `script.scriptapp`, plus a `webapp` block
    (`USER_DEPLOYING` / `ANYONE_ANONYMOUS`). This matters because `deploy.mjs` never pushes manifests.
  - Then `clasp deploy` creates the deployment, and `projects.json` gets the scriptId and deploymentId.
  - **Uday runs `ownerSetup()` once in the editor.** That is the OAuth consent. It installs the trigger
    and stores the push secret as a Script Property, never logged. Uday copies it to
    `~/.lmcs/compliance_secret`.
  - `clasp run` isn't used: it needs a standard GCP project.

## B3 Academics in depth (the centrepiece)

**Data (verified 2026-10-22 on 30,304 entries this year):**
- 52 of 61 class-subjects taught in 3 or more schools use the same main book.
- 78% of chapter names are shared by 2 or more schools.
- Tags: Chapter Teaching, Q&A, New Words, Activity, CWA, Remediation, OTT, RT, Laboratory, Field Trip.
  One entry in five has more than one tag.

**Data source, verified 2026-10-23.**

The CW/HW feed at `COORD_CWHW_URL` (the one `coordinator.gs` already uses) returns
`{generated, ayStart, cwRecords[30,279], cmData}`.
- **Access to academics data:** Owners see everything. A Coordinator who reads it (for the later
  Coordinator view) sees only their `coordVisibleCampuses_`. Fee Clerks are refused.
- Each record has `lmsIdx` (0–5 = LMS1–6, already normalised by the feed builder: "Guru International"
  → LMS6, both Sayoli spellings → LMS5, demo rows dropped), `classMapped`, `subject`, `stream`,
  `teacher`, `cwBook`, `cwChapter`, `cwDesc`, `cwTag`, `hwChapter`, `hwDesc`, `hwTag`, `dateStr`,
  `timeMs`.
- `cmData[lmsIdx][class]` is each school's Course Mapping: `subject`, `chapterNo`, `chapterName`,
  `term`, `startDate`, `cwaDate`.

So one fetch gives the log and the plan.

**The feed has no section.** v1 uses **teacher within class** as the section unit: a teacher who teaches
two sections of the same class-subject is merged. Adding real sections later means reading the daily
sheet's column E (public through gviz). This is noted as a v1 limit on levels 5–6.

**Normalisation:**
- School: `lmsIdx`.
- Chapter: `chapterNormalizeName`, copied from ChapterTracker.gs.
- Book group: within (class, subject), schools are grouped by their dominant normalised `cwBook`.
  Comparisons are only ever within a book group.

**The cube**, precomputed every 30 min with a time trigger and cached. Per (book group, class, subject,
chapter, school, section, teacher) it holds:
- periods (entries);
- the count of each tag;
- first and last date, the first CWA date, and whether Remediation follows the CWA;
- HW given (count);
- the ordered tag sequence (compact codes, e.g. `T T Q N A C R`).

*Size, measured 2026-10-23 on the real feed:*
- The cube is 2,989 cells: 1.1 MB as JSON, 120 KB gzipped, 2 cache chunks.
- Level 8's minimised rows are 1.5 MB gzipped, which is too many cache chunks to rely on.

**Keeping a last good copy.** Both the cube and the level 8 rows are written as gzipped files to the
Owner backend's Drive folder (`drive` scope). The cache is only a fast copy of them.
- A rebuild runs under the script lock, so cache misses can't stampede.
- A rebuild **keeps the previous files** if the feed fails or shrinks by more than 30%, and the page then
  shows the old "as of" with a warning.

**Network norms per (book group, class, subject, chapter)**, across sections that completed the chapter
(have a CWA):
- the median and spread of periods;
- the median share of each tag;
- the most common sequence shape.

**Teaching episodes, not chapter names (measured 2026-10-23).** A chapter-name cell is often not one
teaching run: 39% of cells span more than 60 days, chapters interleave, and 329 cells hold several CWAs.
So every signal works on an **episode**: within one teacher-class-subject, the entries for a chapter from
its first entry up to and including its **first CWA**. Entries after it are "post-CWA" (revision,
remediation, re-teaching) and are counted separately.

**Signals** (each is a rule with a threshold in one constants block, `OWN_ACAD_RULES`, so Uday can tune
them):
- **pace:** an episode's periods above 1.5× or below 0.5× the chapter norm. Measured: 8.4% of normed
  episodes, so usable.
- **no CWA:** the teacher-class-subject moved on. Its later chapters have entries for at least
  `noCwaGapDays` (default 21) after this chapter's last entry, with none of this chapter in between,
  and this chapter never got a CWA.
- **no remediation:** a CWA with no Remediation entry in the same teacher-class-subject within
  `remWindowDays` (default 14) after it.
- **thin interaction:** an episode's Q&A plus Activity share under half the norm.
- **tag inflation:** more than 60% of a teacher's entries carry 3 or more tags. Measured: 4 of 83
  teachers.
- **plan slippage:** the Chapter Tracker's own status says Overdue (sheet `11u0Aeon…`, which already
  applies effective deadlines, overrides and the CWA-exempt subjects).
- **logging gap:** a school day with no entry from that teacher-class. A *school day* is any day the
  school logged at least one entry, and only teacher-classes with entries in the trailing 30 days count.
  *(Claude's call: no calendar needed.)*

The old "CWA before teaching finished" signal is dropped: it fired on 53% of cells and measured revision,
not a fault.

**Findings vs outliers (measured 2026-10-23, after the episode redesign).** Counted on real teaching only
(Class 1 and up, non-exempt subjects, episodes of at least 3 periods; 2,766 episodes, 1,434 with a CWA):
- **80% of CWAs are not followed by Remediation within 14 days.** The median teacher has 100%.
- **29% of chapters are moved past without a CWA.**

These aren't noise; they are network-wide practice gaps, the most important things the Owner can
learn. So each signal is used two ways:
1. **Network finding** (L1 and L2 headline): the rate itself, with the best and worst school or subject.
   For example, "8 in 10 CWAs get no remediation. Best: LMS2 (66%). Worst: LMS5 (96%)."
2. **Outlier flag** (drives "most unusual first"), at **teacher and teacher-class level only**. Six
   schools are too few to gate (one flag is already 17%), so schools get the findings' best and worst,
   not flags. A unit is flagged only
   when its rate is **worse than the network's by more than chance**: a binomial z-score of at least
   `outlierZ` (default 2.5) against the network rate, with at least `minUnits` (5) episodes. Measured
   at teacher level: no_remediation flags 4%, no_cwa 12%. A percentile rule was tried and rejected: it
   flagged 51%, because the median teacher already sits at 100%.
3. **Bright spots** (the same test, the other way, z ≤ −2.5): the teachers and schools to learn from.
   Measured: about 21% of teachers for remediation, 11% for CWA. They are shown as a "learn from"
   list beside each finding (top 10), and by school: no remediation ranges from 66% (LMS2) to 96%
   (LMS5).

Pace stays absolute against the chapter norm (about 8%).

**Signal sanity gate (build step):** on the real feed, each **outlier flag** must fire on less than 15% of
its units (network findings are exempt). The rates and the network findings are recorded in the plan
ledger. A flag that can't meet the gate ships hidden and is listed for Uday.

**Norm availability.** Only 193 of 1,162 chapters (17%) have 3 or more completed episodes, so a
per-chapter norm is often impossible. Where a chapter has too few, comparisons fall back to the
**class-subject book-group norm** (all chapters pooled), labelled as such. Pace is only judged against a
real chapter norm.

**On-track and plan slippage** come from the **Chapter Tracker sheet** (status per chapter), not from
Course Mapping's `cwaDate` (only 34% filled, and none for M-I to M-III). This keeps one definition with
the existing CWA gap report.

**The drill path (8 levels, subject-first)** — what each level shows on top / what its list is:

1. **Network:** syllabus on track %, chapters closed without CWA, sections with a pace outlier,
   logging coverage % / subjects, most unusual first.
2. **Subject** (e.g. English): the same 4 numbers for the subject / its classes.
3. **Class + book group** (e.g. Class 7 English, Mylestone): the chapters in plan order, each shown as
   **one bar split by tag** (Uday's example), with planned vs actual dates.
4. **Chapter:** the network norm for this chapter (median periods, median tag split, common sequence)
   / **every school side by side**, each with its tag-split bar against the norm and its signals.
5. **School on that chapter:** its teacher-classes (v1 section unit) / each one's bar against the norm.
6. **Teacher-class on that chapter:** the period-by-period tag sequence as a strip, with signals
   marked where they occur.
7. **Teacher:** their pattern across every chapter they teach (tag split vs the norms), SS scores
   (avg total, per-parameter), logging gaps, and inflation flag / chapters ranked by deviation.
8. **Entry:** the date, CW/HW book, chapter, description and tags as written.

Second entry points: by school (level 2 replaced by school, then class, subject and chapter) and by
teacher (search, jumping straight to level 7). These are the school-first door the Coordinator view
will later reuse.

**Actions:** at levels 4–7, **"Send to Coordinator"** flags the school, section or teacher with the
signal text, and it becomes an `owner_flag` follow-up.

**Coordinator view (later, not v1):** the same cube and endpoints, school-first, ending in "Raise
follow-up". The design keeps the cube in the Owner backend and readable by Coordinators (role check
Owner|Coordinator on the read actions), so that view is a frontend-only addition.

## B1–B2, B4–B6 specifics

- **B1 Escalations** (with "Send to Coordinator" on any item, like B3): the Owner backend calls the Coordinator backend's `coordinatortasks` with the
  caller's token. That runs the adapters, so the data is live. It then reads the Tasks tab directly
  only for resolved history.
  - Open tasks with severity high, or overdue.
  - Approvals pending more than 3 days.
  - Hiring stalls.
  - Owner flags not yet resolved.
  - Resolved tasks (the Tasks tab keeps them) give a "resolved this month" count and the median time
    to resolve per domain.
- **B2 Hiring funnel:** `hiringfunnel` (read-only, no backfill or code-lock side effects; scoped by
  `hirCallerCampuses_`, Owner and Coordinator) counts each candidate **once**: one campus × role cell,
  from the reported position, else the best match. Per
  campus × role, counts per ladder stage and the median **days in the current stage**. That is
  estimated from evidence dates (no stage log exists): shortlisted-at, accepted appointment start,
  report submitted-at, salary-offer-at, approval decided-at, DOJ. Hiring v2 supplies the
  shortlisted-at and appointment dates. It uses the hiring.gs derivation (one definition).
- **B4 Staff:**
  - Headcount per school × department/designation from EmpMaster (Active) and EmpSalary.
  - Joiners and leavers per month from DateOfJoining and DoRes/DoRel.
  - Documents missing from the Coordinator's document matrix definition (copy `coordDocumentMatrix_`).
- **B5 Money:**
  - Payroll CTI per school per month from **Run Log**. A month counts as locked if the *latest* Run
    Log row for that month and entity is Locked; an unlock appends an Unlocked row (payroll.gs:1491-1520).
    `HES` is shown as "Head office", separate from the schools.
  - The line breakdown from **Payroll Register**.
  - Transport P&L from the `Transport P&L` tab (`reg, campus, month, fee, fuel, loan, fixed, pay,
    note`). The sync time comes from the `LM Studio Sync` tab.
- **B6 Compliance:**
  - Buses from `coordTransportFleet_`'s output (via the same tab reads).
  - Schools and society: **only the current document per (entity, doc_type)**, i.e. the latest
    `valid_to`. This is `records.py`'s own definition. Measured: 53 of 68 "past valid_to" documents
    already have a newer valid one. Non-expiring types (photos, other, bye_laws, land_record,
    building_plan) are listed but never flagged.
  - From a new **`School Compliance`** tab, pushed from the Mac by a new
    `drive-index/export_compliance.py`, added to the launchd job `ai-coordinator/run.sh` (`sync.sh`
    was retired 2026-10-08).
    - It POSTs to the Owner backend's `compliancepush` with Script Property `COMPLIANCE_PUSH_SECRET`,
      mirroring `transportpush`.
    - It reads `records.db` table `documents` where `entity_type IN ('school','society')`. Buses
      already come from the fleet.
    - It finds the backend URL in `owner/shared.js`, the way `export_fleet.py` reads
      `coordinator/shared.js`.
  - Rows: entity, doc_type, reference_no, valid_to, drive_link.
  - Due within 60 days is amber; overdue is red.

## Questions for Uday (non-blocking; defaults in brackets)

- The signal thresholds above. [as written; tunable in one place]

## Left to the builder

Visual layout per level (match the existing portal style; bars as inline SVG or CSS), breadcrumb style,
copy, cache TTLs within "fresh within 30 minutes".
