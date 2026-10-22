# Hiring: Principal's Day Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Today view, portal Interview and Demo reports, reject-with-reason and revive, and Add applicant in the Hiring Dashboard, with a Fee Clerk legwork-only mode.

**Architecture:** The backend stays in the PDR Apps Script project (`hiring.gs`, routed from `main.gs`). The candidate list is
rebuilt by one pure function (`hirBuildApplicants_`), so derivation, revival cutoff, de-dupe and visibility are
unit-testable with plain arrays. The frontend stays one static page (`hiring/index.html`), with tabs and a candidate modal.

**Tech Stack:** Google Apps Script (V8), static HTML/JS, Node `vm` tests (`node tests/verify.mjs`), clasp deploy (`node apps-script/deploy.mjs pdr`).

**Spec:** `docs/superpowers/specs/2026-10-22-hiring-principal-day-design.md`

## Global Constraints

- New applicant columns: S=19 `Reject Reason`, T=20 `Revived At`, U=21 `History (JSON)`, V=22 `Source`, W=23 `Added By`, X=24 `Stage Marks (JSON)`, Y=25 `Demo At`. Never write columns 1-10 except when Add applicant appends a whole row.
- Tabs: `Portal Interview Reports` and `Portal Demo Reports`, found by name and created with headers on first write.
- Ladder: `['Interview Scheduled','Interview Done','Demo Done','Salary Offer','MD Academics Interview Scheduled','Hiring Approved','Hired']`. `Rejected` is an exit, not a rung.
- Fee Clerk-only callers: GET `hiringapplicants`, `hiringapprovalstatus`; POST `hiringaddapplicant`, `hiringschedule`. Nothing else.
- Status column K is written only by Hired / Rejected (`hiringUpdateStatus_`) and cleared only by `hiringrevive`.
- "Today" is Asia/Kolkata.
- Every value interpolated into HTML goes through `esc_()`.

## Review Focus

1. A revived candidate whose old Interview Report form row, portal reports and Owner approval all predate Revived At must read as "not started" (or "Interview Scheduled" if a new date is set). Test in Task 2.
2. A phone typed as `+91 98765-43210` and `9876543210` is the same person, for Add applicant duplicate checks and for report lookup. Tests in Tasks 2 and 3.
3. A Fee Clerk posting `updatehiringstatus`, `hiringreject`, `hiringrevive`, `hiringmarkstage` or the report actions gets "Not authorized". Test in Task 1.
4. A candidate at Interview Done whose requisition was revoked stays visible. Test in Task 2.
5. A Demo Report with recommendation "Another demo" does not move the candidate to Demo Done. Test in Task 3.

---

### Task 1: Fee Clerk access in `main.gs`

**Files:** Modify `apps-script/main.gs` (constants near 131, `doGet` 140-142, `doPost` 203-205, `verifyCallerToken_` 294, helpers near 325). Test: `tests/hiring/test-access.js`.

**Interfaces:**
- Produces:
  - `pdrIsElevated_(caller) -> bool` (Principal, Coordinator or Owner);
  - `pdrLimitedAllows_(caller, action, isPost) -> bool`;
  - `PDR_FEECLERK_GET_ACTIONS = ['hiringapplicants','hiringapprovalstatus']`;
  - `PDR_FEECLERK_POST_ACTIONS = ['hiringaddapplicant','hiringschedule']`.

- [ ] Test: load `main.gs` in vm.
  - FeeClerk-only: GET `hiringapplicants` true, GET `approvalslist` false, POST `hiringaddapplicant` true, POST `updatehiringstatus` false, POST `hiringrevive` false.
  - Teacher-only: POST `submitapproval` true.
  - `FeeClerk,Teacher`: both lists.
  - Principal: `pdrIsElevated_` true.
- [ ] Run: `node tests/hiring/test-access.js` and confirm it FAILS (functions missing).
- [ ] Implement:
  - `verifyCallerToken_` accepts `FeeClerk`.
  - `doGet`/`doPost` replace the teacher-only check with `!pdrIsElevated_(caller) && !pdrLimitedAllows_(caller, action, post)`.
  - Leave `pdrIsTeacherOnly_` untouched (approvals.gs uses it).
- [ ] Add routes:
  - GET → `hiringApplicants_`;
  - POST `hiringaddapplicant`, `hiringschedule`, `hiringmarkstage`, `hiringsubmitinterview`, `hiringsubmitdemo`, `hiringrevive` → the Task 3 functions.
- [ ] Run test: PASS. Commit `feat(hiring): Fee Clerk legwork access to the hiring backend`.

### Task 2: Candidate derivation (`hiring.gs`)

**Files:** Modify `apps-script/hiring.gs`. Test: `tests/hiring/test-derive.js`.

**Interfaces:**
- Produces:
  - `HIR_COL` additions: `REJECT_REASON:19, REVIVED_AT:20, HISTORY:21, SOURCE:22, ADDED_BY:23, STAGE_MARKS:24, DEMO_AT:25`;
  - `HIR_LADDER` (new), `HIR_REJECT_REASONS` (array of `{label, group}`, group ∈ `notnow|notsuitable|filled|other`);
  - `hirCallerCampuses_(caller) -> string[]|null` (null = ALL; comma list split; districts unioned);
  - `hirEvidence_(phone, row, revivedAtMs, src) -> {interview: {at, via}|null, demo: {at, via}|null, interviewReports: [], demoReports: []}`, where `src = {irRows, portalInterviews, portalDemos}`;
  - `hirDerive_(a) -> status` (uses `a.interviewAt`, `a.evidence`, `a.salaryOfferAt`, `a.mdInterviewAt`, `a.offerDecision`, `a.storedStatus`);
  - `hirBuildApplicants_(values, ctx) -> applicant[]`, where `ctx = {requisitions, visibleCampuses, irRows, portalInterviews, portalDemos, decisions, nowMs}`;
  - applicant fields:
    - existing fields;
    - `rejectReason`, `revivedAt`, `round` (history length + 1), `history`, `source`, `addedBy`;
    - `demoAt`, `stageMarks`, `reportPending` (`'interview'|'demo'|''`);
    - `interviewReports`, `demoReports`, `inPipeline`, `noOpenRole`.
- Decision map changes: `hirSalaryOfferDecisions_()` returns `{id: {status, decidedAtMs}}`, and every caller is updated.

- [ ] Tests (assertions):
  - Report-based ladder: date + portal interview → `Interview Done`; plus portal demo → `Demo Done`; old IR form row → `Demo Done`; stage mark `interview` only → `Interview Done`, `reportPending:'interview'`.
  - Revival: IR row and approval decided before `revivedAt` are ignored → status `''`; with a new interview date → `Interview Scheduled`; `round` 2.
  - Stored `Interview & Demo Done` → `Demo Done`.
  - De-dupe: two rows with the same phone, the older one at Interview Done and the newer blank; the kept row is the older one, with the newer CV filled in if the older one had none.
  - Visibility: no matching requisition but interview date set → included, `noOpenRole:true`; online row with no match and no progress → excluded; Rejected with no date and no match → excluded; portal-added (`source` set) with no match → included.
  - Phone `+91 98765-43210` matches `9876543210`.
  - `hirCallerCampuses_({campusId:'LMS1,LMS4'})` → all six campuses; `{campusId:'LMS2'}` → LMS1-3.
- [ ] Run: FAIL.
- [ ] Implement, then:
  - Rewrite `hiringApplicants_` as a thin wrapper: read sheets, call `hirBuildApplicants_`, then `hirAssignEmployeeCodes_`, then sort.
  - Remove the "no requisition → gated" early return; return `gated` only when the list is empty **and** nothing is approved.
  - `hirRefreshTrackerCore_` uses the new decision map shape.
- [ ] Run: PASS; also `node tests/hiring/test-employee-code.js` and `node tests/coordinator/test-hiring.js` PASS. Commit.

### Task 3: Write actions (`hiring.gs`)

**Files:** Modify `apps-script/hiring.gs`. Test: `tests/hiring/test-actions.js` (fake sheet with `appendRow`, `getRange`, `insertSheet`).

**Interfaces** (all `(caller, body) -> hiringApplicants_(caller)` result plus `{applicantId}` where useful; each checks district scope with `hirCallerCampuses_`):
- `hiringAddApplicant_`, body `{name, phone, campusId, subjects, qualification, bed, gender, age, cv, source, notes}`:
  - name, 10-digit phone, campus and source are required;
  - a duplicate phone returns `{success:true, duplicate:true, applicantId}` and appends nothing;
  - writes Branches `LMS-n`, Source, Added By, Timestamp.
- `hiringSchedule_`, body `{row, interviewAt?, demoAt?, clear?: 'interview'|'demo'}`: Fee Clerk allowed.
- `hiringMarkStage_`, body `{row, stage:'interview'|'demo'}`: elevated only. Demo needs interview evidence or a mark first.
- `hiringSubmitInterview_`, body `{row, interviewDate, position, confidence, english, capability:{subject:{class:score}}, spouseOccupation, familySupport, qualificationRemarks, otherSkills, experience:{school, periods, timing, extraWork, classes, subjects, lastSalary}, commitment, expectedSalary, strengths, weaknesses, remarks, recommendation:'proceed'|'reject', rejectReason?, rejectNote?}`:
  - confidence and english must be integers 1-5;
  - at least one capability score 1-5;
  - `reject` also calls the reject path.
- `hiringSubmitDemo_`, body `{row, demoDate, class, subject, scores:{pedagogy, content, interaction, response, management, clarity, relatable, aids}, studentFeedback, strengths, improve, remarks, recommendation:'proceed'|'another'|'reject', nextDemoAt?, rejectReason?, rejectNote?}`:
  - all 9 scores are integers 1-5; Total /45 is computed;
  - a report counts as demo evidence only when `recommendation === 'proceed'`;
  - `another` with `nextDemoAt` sets Demo At.
- Reject: `hiringUpdateStatus_` accepts `rejectReason` (must be one of `HIR_REJECT_REASONS` labels; `Other` needs notes) and writes column S. Rejected without a reason is refused.
- `hiringRevive_`, body `{row, note}`:
  - elevated only, the row must be stored `Rejected`, and the note is required;
  - appends `{round, interviewAt, demoAt, mdInterviewAt, salaryOfferAt, stage, rejectReason, notes, revivedBy, revivedAt}` to History;
  - clears K, S, M, N, O, Q, R, X, Y and sets T = now, under lock.

- [ ] Tests:
  - Add applicant duplicate (`+91 98765-43210` vs an existing `9876543210`) → duplicate, row count unchanged.
  - Add applicant writes `LMS-4` and Source `Walk-in`.
  - Interview submit with confidence 0 → throws "1 to 5".
  - Demo `another` → no demo evidence, Demo At set.
  - Revive on a non-Rejected row → throws.
  - Revive clears columns and appends history of length 1.
  - Reject without a reason → throws.
- [ ] FAIL → implement → PASS. Commit.

### Task 4: Document check reads the merged workbook

**Files:** Modify `apps-script/hiring.gs` `hiringCheckDocuments_`. Test: extend `tests/hiring/test-employee-code.js`.

- [ ] Test: rows split across the merged tab (`LMS 4`) and the old per-campus sheet are unioned, and a document present in either counts.
- [ ] Implement:
  - `HIR_DOC_WORKBOOK_ID = '1PJ2acPOHopbHzzwGes8X4YPWSDBdXnd0zl46zvFCvIg'`.
  - Read tab `'LMS n'` with each tab's own header; skip any tab or sheet that fails to open, so one missing source doesn't fail the check.
  - Cache by source.
- [ ] PASS. Commit.

### Task 5: Hiring Dashboard UI

**Files:** Modify `hiring/index.html`, `assets/auth.js` (add `canUseHiring(session)` = `canViewTeacherSS(session) || hasRole(session,'FeeClerk')`, export it).

**Interfaces:** consumes the Task 1-3 actions and applicant fields.

- [ ] Add `esc_()` and use it for every interpolation. Rows render through one `rowHtml_(a, mode)`.
- [ ] Tabs `Today | By role | Rejected pool`, a search input, and a `+ Add applicant` button.
  - **Today** has the four header counts and sections in the spec's order, using IST date math on `interviewAt` / `demoAt`.
  - **Pool** is grouped by reason group, with Revive (asks for a note).
  - **Search** matches name or digits across all applicants and opens the panel.
- [ ] **Next step** button per the spec table:
  - "report later" variants call `hiringmarkstage`;
  - Reject opens a reason picker (grouped `<select>` plus note).
- [ ] **Candidate modal:**
  - details, the ladder, history, notes;
  - Interview Report form (capability grid = chosen subjects × M1..C12 selects);
  - Demo Report form (9 score selects, live total);
  - read-only past reports, newest first;
  - the existing DOJ / Employee ID / documents block and Hired button, moved in from the old row.
- [ ] **By role** keeps today's role chips and uses the same row renderer.
- [ ] **Fee Clerk mode** (`!canViewTeacherSS && hasRole FeeClerk`): only the schedule inputs, Add applicant, the document link and the missing list. No Next step, Reject, Revive or forms.
- [ ] Verify in the browser pane: serve the worktree locally, seed a session, and replace `window.fetch` from the JS tool with the fake backend in `tests/hiring/ui-stub.js` (read and pasted, never loaded by the page itself), then call `loadAll_()`:
  - Today renders, Add applicant shows the duplicate notice, the interview form blocks on a missing score, Reject requires a reason, Revive works, Fee Clerk mode shows no decision buttons.
  - No console errors at 1280px or 375px.
- [ ] Commit.

### Task 6: Verify, review, ship

- [ ] `node tests/verify.mjs`: only the two pre-existing failures (`coordinator/test-approvals.js`, `datasrc/test-datasrc.js`) remain.
- [ ] A fresh reviewer (most capable model) reviews the whole branch diff against the spec. Fix what it finds.
- [ ] With Uday's go-ahead:
  - `node apps-script/deploy.mjs pdr --push --deploy "hiring: today view, reports, revive, add applicant"`;
  - merge into main and push;
  - `node tests/verify.mjs --live`;
  - load the live page.
- [ ] Brief the Fee Clerk portal session (entry points: link to `hiring/` plus a "Needs a slot" count from `hiringapplicants`).
- [ ] Update the vault.
