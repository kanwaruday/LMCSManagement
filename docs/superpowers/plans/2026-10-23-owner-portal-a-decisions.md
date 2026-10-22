# Owner Portal Part A (decisions strip) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Owner's home becomes a decisions strip:
- approvals to decide, Salary Offer Approvals with scores, and MD interviews to accept;
- Payroll/Salary links;
- the approver side of Approvals moved to `owner/approvals/`.

**Architecture:** Frontend-only, plus three small backend additions:
- PDR `hiringofferdetail` (read-only);
- PDR `aprNotifyDeciders_` split by role;
- Coordinator `coordinatorownerflag`, which Part B also uses.

`owner/shared.js` holds the boot/gate/API/breadcrumb helpers that Part B reuses. No Owner backend yet;
Part B creates it.

**Tech Stack:** static HTML/JS, Apps Script V8 (PDR, Coordinator), Node `vm` tests.

**Spec:** `docs/superpowers/specs/2026-10-23-owner-portal-design.md` (Part A); depends on
`docs/superpowers/plans/2026-10-23-hiring-v2-appointments.md` Task 7 (`owner/index.html`, `assets/appointments.js`, `canViewOwnerPortal`).

## Global Constraints

- Gate: `LMCS.canViewOwnerPortal(session)` = `hasRole(session,'Owner')`. The backend re-checks Owner on
  every new action.
- `coordinator/approvals.js` is mounted unchanged. On the Owner page, `ctx.post` posts to the
  **Coordinator** backend (`BACKEND_URL` in `coordinator/shared.js`), and `ctx.people` is the
  `coordinatorpdr` coordinators list.
- `hiringofferdetail` must not call `hirAutoBackfillWalkIns_` or `hirAssignEmployeeCodes_`.
- Every interpolated value goes through `esc`.

## Review Focus

1. A Coordinator with CanApprove still decides from Coordinator → Systems after the move; nothing about
   that page changes. Test: open `coordinator/systems/` in the browser check.
2. An Owner who is also on another role (e.g. `Owner,Teacher`) gets the Owner portal. Test in Task 1.
3. `hiringofferdetail` for an applicantId outside any approval returns only that candidate's own report
   scores, with no notes, salary breakdown or history. Test in Task 2.
4. The split email: an Owner who also has CanApprove gets one email, not two. Test in Task 3.
5. `coordinatorownerflag` from a non-Owner is refused, and HES lands visible only to ALL-campus
   Coordinators. Test in Task 4.

---

### Task 1: `owner/shared.js` + home decisions strip

**Files:** Create `owner/shared.js`, `tests/owner/test-shared.js`. Modify `owner/index.html` (from hiring v2 Task 7).

**Interfaces:**
- `Owner.boot({onReady})` handles session, gate and denied screen.
- `Owner.pdr(action, params)` and `Owner.pdrPost(action, body)` call the PDR URL (copy the constant from
  `hiring/index.html`).
- `Owner.coord(action, params)` calls the Coordinator URL.
- `Owner.coordPostBody(body)` takes **one argument**, the full body including `action`, with 3 retries
  like `coordinator/shared.js` `postJson`. That one-argument shape is what `approvals.js:320` calls
  `ctx.post` with.
- `Owner.crumbs(path) -> html` and `Owner.parsePath(hash) -> string[]` are pure and tested.
- `Owner.esc`.

- [ ] Tests: `parsePath('#path=English/Class 7/Ch 3')` → 3 parts, decoded; crumbs escapes;
  `coordPostBody({action:'x'})` sends exactly that body (stub fetch); `Owner.boot`'s gate function
  accepts `Owner,Teacher` and refuses `Coordinator` (the gate wrapper is new in this task, so the test
  fails first).
- [ ] FAIL, implement, PASS.
- [ ] Home: a strip of 4 count cards:
  - Approvals to decide: from `approvalslist`, status Pending and Info Requested, `canDecide`.
  - Salary offers to decide: the subset whose category is Salary Offer Approval.
  - MD interviews to accept: from `apptlist.toAccept`, which for an Owner holds md only (hiring v2).
  - Payroll: a link only.

  Then the appointment box. Then a grid of six insight cards; Part B makes them live, and until then
  they show "Coming in Part B".
- [ ] Commit.

### Task 2: `hiringofferdetail` (PDR, read-only)

**Files:** Modify `apps-script/hiring.gs` and `apps-script/main.gs`. Test: `tests/hiring/test-offerdetail.js`.

**Interfaces:**
- `hiringOfferDetail_(caller, {applicantId}) -> {success, applicant:{applicantId, name, campus,
  position, status}, interview:{confidence, english, capability, recommendation, scanLink, enteredBy,
  submittedAt}|null, demo:{scores, studentFeedback, total, recommendation, scanLink, enteredBy,
  submittedAt}|null}`.
- Owner only. It reads the T-id row number for the applicant's phone, then reports **by normalised
  phone** (`hirNormalizePhone_`), filtered to `submittedAtMs >= revivedAtMs` (the same join as
  `hirRowApplicant_`). The row may be a duplicate the de-dupe would drop, so phone is the key. Without
  portal reports it falls back to the old Google-Form PDF link (`hirIrIndex_`).

- [ ] Tests: a non-Owner throws; latest report wins; a report before Revived At is ignored; a report
  filed against a duplicate row of the same phone is found; no notes/history/offer fields in the
  output. FAIL, implement, PASS. Route GET `hiringofferdetail`.
  Commit.

### Task 3: Decider email (DECISION PENDING — ask Uday before this task)

Uday said "no emails, they clog the system" (about bookings). Ask him once: **drop the "new approval
request" emails to deciders now that the Owner strip shows the counts?**
- **If yes:** remove the `aprNotifyDeciders_` send, and keep the requester's decision email (tell Uday
  it exists).
- **If no:** do the split below.

**Files:** Modify `apps-script/approvals.gs` (`aprNotifyDeciders_`). Test: `tests/coordinator/test-approvals.js`, or a new `tests/hiring/test-notify.js` with a stubbed `MailApp`.

- [ ] Tests: Owner rows get `.../owner/approvals/`; CanApprove Coordinators get the Systems link; an
  `Owner,Coordinator` row with CanApprove receives one email (the Owner link). FAIL, implement, PASS.
  Commit.

### Task 4: `coordinatorownerflag` (Coordinator backend)

**Files:** Modify `apps-script/coordinator.gs` (doPost route, `coordOwnerFlag_`). Test: `tests/coordinator/test-ownerflag.js`.

**Interfaces:**
- `coordOwnerFlag_(caller, {campus, title, detail, department, link, assignee?})` → `coordTaskUpsert_`
  with id `owner_flag|<yyyy-MM>|<hash(campus+title)>`. The month is in the id so a flag resolved earlier
  can be raised again later (`coordinator.gs:240-245` keeps resolved ids resolved). Domain
  `owner_flag`, severity `high`, Detail including the link.
- Then, under the same script lock, write **column 14 (Assignee)** and **15 (Due, +7 days)** explicitly,
  because `coordTaskUpsert_` writes only 13 columns, and Assignee drives visibility in
  `coordTasksList_`.
- Owner only.
- The domain is excluded from `coordTasksAutoResolve_`, so it is resolved by hand only.

- [ ] Tests: a non-Owner throws; a FeeClerk throws; an upsert creates one row and a repeat flag in the
  same month refreshes it; a flag resolved last month and raised this month creates a new open row;
  assignee lands in column 14. FAIL, implement, PASS. Commit.

### Task 5: `owner/approvals/` + Salary offer scores

**Files:**
- Create `owner/approvals/index.html`.
- Modify `hiring/index.html` (its header "Approvals" link goes to `../owner/approvals/` for Owners).
- Modify `coordinator/shared.js` / `coordinator/systems/index.html`:
  - an Owner sees "Approvals are now in the Owner portal →" instead of the approver component;
  - Coordinators with CanApprove keep it unchanged.
- `principal/index.html` has no Approvals link, and `principals-daily-reporting` is the *request* page;
  neither changes.

- [ ] Mount `CoordApprovals` with `{post: Owner.coordPostBody, people: () => coordinators}`. The list is
  fetched once from `coordinatorpdr`.
- [ ] For Salary Offer Approval rows, inject a "Scores" card above the decide buttons:
  - Read the T-id from `itemName` and call `hiringofferdetail`.
  - Render interview Confidence/English and the capability grid, the demo 9 scores and total/45, the
    recommendations, and the scan links.
  - Use a MutationObserver on the **mount root with `subtree:true`**, because `renderList()` replaces
    the list's innerHTML and recreates the detail slot. Mark injected cards with `data-scores`, so the
    observer doesn't re-enter. `approvals.js` stays unmodified.
- [ ] Browser check with a stub (extend `tests/hiring/ui-stub.js`, or add `tests/owner/ui-stub.js`):
  Owner home counts, the approvals list, a Salary offer detail with scores, no console errors at 1280
  and 375. Commit.

### Task 6: Verify, review, ship

- [ ] `node tests/verify.mjs` all pass.
- [ ] Fresh reviewer on the branch (Review Focus above); TDD fix pass.
- [ ] Deploy PDR (dry run first) and Coordinator (`node apps-script/deploy.mjs coordinator`). Merge,
  push, `--live`, then a browser check of `owner/` and `coordinator/systems/`.
