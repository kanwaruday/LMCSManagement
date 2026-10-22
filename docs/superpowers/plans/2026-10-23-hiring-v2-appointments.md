# Hiring v2 (shortlist, appointments, scanned reports) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Shortlist.
- Propose and accept appointments, with silent calendar events.
- Fee Clerk scanned reports.
- The Principal's split Today, Appointments, My actions and By role screens.
- A minimal Owner page and a Principal home box to accept appointments.
- Migration of the bookings that are already live.

**Architecture:**
- **Backend:** in the PDR project.
  - A new `apps-script/hiring-appointments.gs` holds appointments.
  - `hiring.gs` gains shortlist, scanned reports, the ladder rung and the rerouting of every
    date-writing path.
  - Logic sits in lock-free *cores*. Only action entry points take the script lock.
  - The calendar goes through one seam (`APPT_CAL_`, Calendar REST over `UrlFetchApp`), stubbed in tests.
- **Frontend:**
  - `hiring/index.html` with tabs. Pure helpers live in `hiring/hiring-view.js`.
  - `assets/appointments.js`: one shared box, mounted on the Principal home and a new minimal
    `owner/index.html`. The Fee Clerk session mounts it on the office home.

**Tech Stack:** Apps Script V8, static HTML/JS, Node `vm` tests (`node tests/verify.mjs`),
`node apps-script/deploy.mjs pdr`.

**Spec:** `docs/superpowers/specs/2026-10-23-hiring-roles-appointments-design.md`

## Global Constraints

- **Columns:**
  - Applicant columns are Z=26 `Shortlisted At` and AA=27 `Shortlisted By`; header labels are written
    on first use. Columns 1–25 never move.
  - `rejectPending` lives inside the Stage Marks JSON (X=24).
- **Tabs:**
  - `Appointments`, with the spec's columns in that order, found by name and created with headers.
  - The report tabs append `Scan Link` and `Entered By Role` to `HIR_PI_HEADERS` and `HIR_PD_HEADERS`.
    Existing tabs grow their header row on first write.
- **Ladder:** `['Shortlisted','Interview Scheduled','Interview Done','Demo Done','Salary Offer','MD Academics Interview Scheduled','Hiring Approved','Hired']`, plus `Rejected`.
- **LOCKS:** Apps Script's script lock is not re-entrant. An inner `releaseLock()` frees the outer one.
  - **Entry points that take `hirWithLock_`, each exactly once, around one block:** `apptPropose_`,
    `apptDecide_`, `apptCancel_`, `apptCalendarRetry_`, `hiringShortlist_`, `hiringSchedule_`,
    `hiringUpdateStatus_` (only around its non-Hired writes), `hiringSubmitInterview_`,
    `hiringSubmitDemo_`, `hiringUploadReport_`, `hiringConfirmReject_`, `hiringRevive_`,
    `apptBackfillRun`.
  - **Cores never lock:** `apptProposeCore_`, `apptDecideCore_`, `apptCancelCore_`,
    `apptCancelAllForCore_`, `apptCancelForRejectCore_`, `hirAppendReportCore_`, `hirRejectRowCore_`.
  - `hirAppendReport_` and `hirRejectRow_` become thin lock wrappers around their cores, for any
    remaining outside caller. Inside an entry point, only cores are called.
  - **Never inside a lock:** `hiringApplicants_` (it reaches `hirAutoBackfillWalkIns_` and
    `hirAssignEmployeeCodes_`, which lock themselves), and the Hired path (`hirLockEmployeeCode_`
    locks itself). `hiringUpdateStatus_` runs its Hired path outside its lock block.
  - Every core re-reads the rows it changes.
- **Fee Clerk allow-list:**
  - GET `hiringapplicants`, `hiringapprovalstatus`, `apptlist`.
  - POST `hiringaddapplicant`, `apptpropose`, `apptcancel`, `hiringuploadreport`.
  - `hiringschedule` is removed for Fee Clerks.
- **Acceptance:**
  - Interview and demo: role Principal whose campus equals the appointment's campus or is ALL, or role
    Owner (override).
  - MD: role Owner, and if Script Property `MD_ACCEPTOR_EMAILS` is set, only those emails.
- **Direct booking:** only role Principal books directly (accepted), and a direct booking also stamps
  the shortlist if it is missing (a walk-in seen on the spot). Coordinator and Owner bookings become
  proposals. An Owner's MD time is a direct booking only if they are an MD acceptor (`MD_ACCEPTOR_EMAILS`
  unset, or they are listed); otherwise it becomes an md proposal.
- **Appointment campus:** the caller's campus if it is a single school, otherwise
  `hirScopedRow_(...).campus`.
- **No email, ever:**
  - Calendar insert and remove go through `UrlFetchApp` to
    `https://www.googleapis.com/calendar/v3/calendars/<id>/events[/<eventId>]?sendUpdates=none`, with
    `Authorization: Bearer ScriptApp.getOAuthToken()`.
  - No `MailApp` in any new code.
- **Durations:** interview 30, demo 45, md 30 minutes.
- **Scans:**
  - pdf, jpeg or png by magic bytes, compared as `b & 0xff` (`base64Decode` returns signed bytes).
  - Raw ≤ 7 MB, checked in the browser before encoding and on the server after decoding.
  - Saved to Drive folder `HIR_SCAN_FOLDER_ID` / campus subfolder, named `<T-id> <Name> <kind>
    <yyyy-mm-dd>.<ext>`, shared domain-with-link view.
- **Tests:**
  - Load `hiring.gs` *and* `hiring-appointments.gs` into one vm context.
  - Run with `TZ=Asia/Kolkata`.
  - `APPT_CAL_` is declared with `var`, so tests can replace it on the context.
- Every interpolated value in HTML goes through `esc_()`.

## Review Focus

1. **The Fee Clerk can never decide:** no accept, shortlist, reject, or booking without acceptance. This
   includes through a clerk report's reject (it only sets `rejectPending`) and a clerk's "another demo"
   next time (it only proposes). Tests in Tasks 3 and 5.
2. **Double Accept, or two Principals accepting together,** yields one accepted appointment and one
   event. The core re-checks `status==='proposed'` under the lock. Test in Task 3 (sequential double
   call; the lock behaviour is covered by the re-check).
3. **Calendar:**
   - A read-only shared calendar (insert throws) falls back to guest.
   - Both failing leaves the appointment accepted, with `Calendar Error` set.
   - A reschedule's accept removes the old event.
   - Test in Task 3.
4. **Nothing booked today disappears:** the backfill makes future date-column bookings into accepted
   appointments, and Today only shows accepted appointments. Tests in Tasks 6 and 8.
5. **No path writes interview, demo or MD times except appointments:**
   - `hiringschedule`;
   - `updatehiringstatus` (`interviewAt`, `demoAt`, `mdInterviewAt`);
   - demo `nextDemoAt`;
   - the walk-in "book now".

   Tests in Tasks 2, 5 and 6.

---

### Task 1: Shortlist + ladder rung

**Files:** Modify `apps-script/hiring.gs` (`HIR_COL`, `HIR_STATUSES`, `hirRowApplicant_`, `hirDerive_`, `hirGrow_`, `hiringRevive_`) and `apps-script/main.gs` (route). Test: `tests/hiring/test-shortlist.js`.

**Interfaces:**
- Produces:
  - `HIR_COL.SHORTLISTED_AT=26`, `SHORTLISTED_BY=27`;
  - applicant fields `shortlistedAt` and `shortlistedBy`;
  - `hiringShortlist_(caller, {row, on}) -> hiringApplicants_(caller)`, elevated only, scoped by
    `hirScopedRow_`, under the lock.
- The un-shortlist guards (cancel proposals, refuse when accepted) are added in Task 2 once
  appointments exist.
- `hirDerive_` gains `shortlistedAt` and returns `'Shortlisted'` when there is no interview date and no
  interview evidence.
- `inPipeline` includes `shortlistedAt`.
- Revive clears 26–27 on **every same-phone row** (inside the existing `hirSamePhoneRows_` loop).

- [ ] Test:
  - shortlisted, no date → `'Shortlisted'`;
  - shortlisted plus a date → `'Interview Scheduled'`;
  - a Fee Clerk calling it throws "Principal";
  - header labels are written;
  - revive clears 26–27 on both rows of a same-phone pair;
  - a shortlisted row with no requisition match is visible.
- [ ] Run `node tests/hiring/test-shortlist.js` → FAIL (`hiringShortlist_` undefined). Implement. Run
  it and every `tests/hiring/*.js` → PASS. Commit `feat(hiring): shortlist and the Shortlisted rung`.

### Task 2: Appointments store, propose/cancel, decide core, reroute old date writers

**Files:** Create `apps-script/hiring-appointments.gs` (add it to `projects.json` `pdr.files`). Modify `apps-script/hiring.gs` (`hiringSchedule_`, `hiringUpdateStatus_`, `hirRejectRow_`, `hiringRevive_`, `hiringShortlist_`) and `apps-script/main.gs` (routes, Fee Clerk lists). Tests: `tests/hiring/test-appointments.js`; update `tests/hiring/test-access.js`.

**Interfaces:**
- `var APPT_TAB='Appointments'`, `APPT_HEADERS`.
- `apptAll_() -> appt[]`. An appt is `{id, kind, applicantId, row, phone, name, campus, start,
  durationMin, place, note, proposedBy, proposedAt, acceptorRole, status, decidedBy, decidedAt,
  declineNote, eventId, calendarMode, calendarError, sheetRow}`.
- `apptRowState_(sheet, row) -> {status, shortlisted, interviewEvidence, salaryOfferAt, rejected}`,
  built from `hirRowEvidence_` plus columns 11, 15 and 26.
- `apptProposeCore_(caller, sheet, {row, kind, start, durationMin?, place?, note?}) -> appt`:
  - Checks:
    - refuses a Rejected applicant;
    - interview needs Shortlisted, or an accepted interview (a reschedule);
    - demo needs interview evidence;
    - md needs Salary Offer, and an elevated caller;
    - a clerk may not propose md.
  - Cancels any existing `proposed` appointment of the same (row, kind).
  - **If the caller has role Principal** and the kind is interview or demo, it immediately calls
    `apptDecideCore_` to accept as them (direct booking).
- `apptPropose_(caller, body)` = lock → `apptProposeCore_` → unlock → `Object.assign({id},
  hiringApplicants_(caller))`.
- `apptDecideCore_(caller, appt, decision, note)`, the full accept logic of Task 3. In this task it is a
  stub that throws "not implemented" except for direct booking, which the Task 3 tests cover.
- `apptCancelCore_(caller, appt, note)`:
  - The proposer or an elevated user may cancel.
  - For an accepted appointment it deletes the event and clears the applicant time column only if it
    still equals `appt.start`.
- `apptCancel_(caller, {id, note?})` wraps it.
- `apptCancelAllForCore_(sheet, row, why)` is used by revive.
- `apptCancelForRejectCore_(sheet, row)` cancels proposals and **future** accepted appointments; it is
  called from inside `hirRejectRowCore_`.
- Both match appointments by **normalised phone** (the person), not just the row, so a duplicate row's
  appointments are cancelled too.
- **Reroutes:**
  - `hiringSchedule_` becomes a wrapper:
    - `interviewAt`/`demoAt` → `apptProposeCore_` (a Principal gets a direct booking);
    - `clear` → `apptCancelCore_` on the accepted or proposed appointment of that kind.
  - `hiringUpdateStatus_` throws "Book it through Appointments" on `interviewAt` or `demoAt`, and on
    `mdInterviewAt` from a non-Owner. An Owner's `mdInterviewAt` → `apptProposeCore_` md, accepted by
    them through the Task 3 core.
  - `hiringShortlist_ {on:false}` throws "already scheduled" if there is an accepted interview, and
    otherwise cancels the proposals.
  - The Principal's portal demo report, `hiringSubmitDemo_` "another" + `nextDemoAt`, books it through
    `apptProposeCore_` (a direct booking for a Principal, a proposal otherwise). It no longer writes
    column 25 itself.

- [ ] Tests:
  - a clerk proposes on a Shortlisted LMS4-campus clerk's row → `proposed`, campus LMS4;
  - a multi-campus clerk (`LMS4,LMS5`) on "LMS-5, LMS-4" → `hirScopedRow_` pick;
  - a second propose cancels the first;
  - not shortlisted → throws "Shortlist";
  - Rejected → throws "Revive";
  - demo before evidence → throws;
  - a clerk proposing md → throws;
  - cancel by a stranger → throws;
  - cancel of accepted clears the time column only when it is unchanged;
  - revive cancels all;
  - reject cancels proposals and a future accepted, but keeps a past accepted;
  - un-shortlist cancels proposals;
  - `updatehiringstatus {interviewAt}` throws;
  - `hiringschedule` by a Coordinator → `proposed`;
  - the clerk allow-list: `hiringschedule` false, `apptpropose` true;
  - `hiringSubmitDemo_` another + `nextDemoAt` by a Principal → an accepted demo appointment, and a
    Coordinator's → a proposal;
  - a Principal booking an unshortlisted walk-in directly → shortlist stamped and booking accepted;
  - a duplicate same-phone row's proposal is cancelled by revive.
- [ ] FAIL → implement → PASS. Routes: POST `apptpropose`, `apptcancel`; update the clerk lists in
  `main.gs`. Commit.

### Task 3: Decide, calendar, list, retry

**Files:** Modify `apps-script/hiring-appointments.gs` and `main.gs`. Test: extend `tests/hiring/test-appointments.js`.

**Interfaces:**
- `var APPT_CAL_ = { insert(calendarId, event) -> {id}, remove(calendarId, eventId) }`, implemented
  with `UrlFetchApp` per the Global Constraints. It throws on non-2xx.
- `apptCalendarWrite_(appt, acceptorEmail) -> {eventId, mode, calendarId, error}`:
  - try `insert(acceptorEmail, ev)`, which gives `own`;
  - otherwise try `insert('primary', ev + attendees:[acceptorEmail])`, which gives `guest`;
  - otherwise `none` + error.
  - It never throws. `calendarId` is stored in the `Calendar Event ID` cell as `<calendarId>|<eventId>`.
- `apptCalendarDelete_(appt)` removes from the stored calendarId. It never throws.
- Event title: `Interview: <Name> (<role>)`, where role = `roleFor`-style first matched role, else
  `reportedPosition`, else subjects. The description has phone, school, stage, proposer, and
  `https://kanwaruday.github.io/LMCSManagement/hiring/index.html#row=<row>`.
- `apptDecideCore_` accept:
  - re-read; require `proposed`;
  - check the role, campus, override and `MD_ACCEPTOR_EMAILS`;
  - write the applicant time column (13 / 25 / 14);
  - cancel the previous **accepted** same-kind appointment and delete its event;
  - call `apptCalendarWrite_`;
  - store everything.
- Decline requires a note.
- `apptDecide_(caller, {id, decision, note?})` and `apptCalendarRetry_(caller, {id})`: the acceptor or
  an elevated user, mode `none` only.
- `apptList_(caller) -> {success, toAccept[], myProposals[], upcoming[]}`. Everything is scoped by
  `hirCallerCampuses_`. A clerk's lists drop the md notes.
  - **An Owner's `toAccept` holds `md` only**, filtered by `MD_ACCEPTOR_EMAILS`. The Owner override for
    interviews and demos is used from the Hiring panel, not the inbox.
- `testCalendarWrite(email)` (editor-run) inserts and then removes a test event on `email` through
  `APPT_CAL_`, and logs the mode.

- [ ] Tests (stub `APPT_CAL_` on the context):
  - a same-campus Principal accepts → accepted, column 13 set, mode `own`;
  - insert to the acceptor throws (read-only) → guest, with an attendee;
  - both throw → accepted, mode `none`, error stored;
  - a retry on `none` with insert now OK → `own`;
  - a double accept → second throws "already accepted";
  - an LMS1 Principal accepting LMS4 → throws;
  - a Coordinator accepting an interview → throws;
  - an Owner override accepting an interview → OK, decidedBy has "(override)";
  - md with `MD_ACCEPTOR_EMAILS` set and a different Owner → throws;
  - a reschedule accept removes the old event (`remove` called with the stored ids);
  - decline without a note → throws;
  - `apptList_` scoping for a Principal, a clerk and an Owner;
  - an Owner's `toAccept` has no interviews or demos, and md only if listed in `MD_ACCEPTOR_EMAILS`;
  - Principal direct booking (from Task 2) → accepted immediately, event on their calendar.
- [ ] FAIL → implement → PASS. Routes: GET `apptlist`; POST `apptdecide`, `apptcalendarretry`.
  Commit.

### Task 4: Payload — appointments + legwork; office counts switch

**Files:** Modify `apps-script/hiring.gs` (`hiringApplicants_`) and `office/js/today.js` (`hiringCounts`: use `res.legwork` when present; tell the Fee Clerk session first). Tests: `tests/hiring/test-legwork.js`, `tests/office/test-today-view.js` (extend).

**Interfaces:**
- Each applicant gets `appointments:[{id, kind, start, status, proposedBy, declineNote, calendarMode}]`
  (open + accepted + the latest declined per kind).
- `hirLegwork_(applicants, nowMs)` is computed on the **full list before `hirForCaller_`**, and added
  as `legwork` for every caller. Buckets:
  - **toSchedule:** Shortlisted, with no proposed or accepted interview, or whose latest interview
    proposal was declined.
  - **waiting:** proposed, any kind.
  - **booked:** accepted, any kind, start in [now, now+7d].
  - **reportsToUpload:** an accepted interview or demo in the past, without that kind's report
    evidence.
  - **demosToBook:** Interview Done, with no proposed or accepted demo.
  - **documents:** Hiring Approved with `docsMissing.length`.
- Reports filed by anyone clear `reportsToUpload` (the evidence is shared).

- [ ] Tests: one fixture per bucket; declined → back to toSchedule; a Principal-filed report clears a
  clerk's reportsToUpload; office `hiringCounts` prefers `legwork`. FAIL → implement → PASS. Commit.
- [ ] **Send the Fee Clerk session its full brief now** (so it builds in parallel). It covers:
  - the spec's Fee Clerk section and the office "To schedule" banner;
  - the `apptlist`, `legwork`, `appointments` and `hiringuploadreport` shapes;
  - the `LMCSAppts.mount` API (Task 7);
  - `hiring/hiring-view.js` and `tests/hiring/ui-stub.js` to reuse;
  - the 7 MB client-side check;
  - the `today.js` change just made.
  - **Its own checklist (agreed with that session, 2026-10-23):**
    - exact GET/POST action names and bodies (`apptpropose`, `apptcancel`, `hiringuploadreport`, and how
      the file travels as base64 in a text/plain JSON POST);
    - the `legwork` and appointment object shapes;
    - the error messages and their meanings (the backend returns `{success:false, error:<text>}`, not
      codes, so list each text);
    - which `assets/appointments.js` call the office home makes (`LMCSAppts.mount`);
    - `tests/office/test-today-view.js` is updated by us along with `today.js`.

### Task 5: Scanned report upload + confirm reject

**Files:** Modify `apps-script/hiring.gs`. Test: `tests/hiring/test-upload.js` (fake `DriveApp` and `Utilities.base64Decode` returning **signed** bytes).

**Interfaces:**
- `hirInterviewRecord_(caller, sheet, r, body)` and `hirDemoRecord_(caller, sheet, r, body)` are
  extracted from the submit actions (validation plus the report object). The submit actions and the
  upload both use them.
- `hiringUploadReport_(caller, body)` takes the interview or demo fields + `kind` +
  `file:{name,mime,base64}`. It:
  - checks the magic bytes (`b & 0xff`);
  - checks size ≤ 7 MB;
  - saves the file (name, subfolder, sharing per the Constraints);
  - appends the report with `Scan Link` and `Entered By Role`;
  - for a clerk with reject, sets `marks.rejectPending`;
  - for a clerk with "another demo" and a next time, proposes (`apptProposeCore_`);
  - for a Principal with reject, rejects; with "another", books directly.
- `hiringConfirmReject_(caller, {row, confirm})`: elevated only.
- `hirSetupScans()` (editor-run): creates the "Hiring scans" Drive folder and sets `HIR_SCAN_FOLDER_ID`.

- [ ] Tests:
  - a JPEG with signed `FF D8 FF` passes; a fake text file fails "PDF, JPG or PNG";
  - 7 MB + 1 byte fails;
  - a clerk with confidence 0 throws "1 to 5";
  - a clerk proceed → saved with a scan link, role clerk, counts as evidence;
  - a clerk reject → status unchanged and `rejectPending` set;
  - a clerk "another" + next time → a `proposed` demo, `DEMO_AT` unchanged;
  - a clerk calling `hiringConfirmReject_` throws;
  - confirm → Rejected and cleared; don't → cleared;
  - a walk-in without a shortlist → allowed;
  - the file is named `T-0002 Asha interview 2026-10-23.pdf` in the LMS4 subfolder.
- [ ] FAIL → implement → PASS. Routes: POST `hiringuploadreport` (clerk too) and `hiringconfirmreject`.
  Commit.

### Task 6: Principal Hiring screen + temporary clerk mode

**Files:** Create `hiring/hiring-view.js` (exports `window.HiringView` + `module.exports`). Modify `hiring/index.html` and `tests/hiring/ui-stub.js`. Test: `tests/hiring/test-ui-helpers.js`.

**Interfaces:**
- `HiringView.todayItems_(applicants, nowMs)`: **only `appointments` with status accepted**,
  interview or demo, today, then the next 7 days.
- `HiringView.myActions_(applicants, nowMs)` returns `[{row, kind, label}]` for:
  - reports pending;
  - Interview Done with no demo proposed;
  - Demo Done (make an offer);
  - Salary Offer with no MD proposal;
  - Hiring Approved (DOJ, documents, Hired);
  - `rejectPending`;
  - an accepted interview in the past with no report.

- [ ] Tests:
  - Today excludes proposed, and excludes a row with column 13 set but no appointment;
  - one fixture per My actions item.
- [ ] FAIL → implement → PASS.
- [ ] **Page changes:**
  - **Tabs:** Today | Appointments | By role | My actions | Rejected pool.
  - **By role:** Shortlist / Un-shortlist, a filter, and a Shortlisted chip.
  - **Panel:**
    - an Appointments block (history; Book interview or demo = `apptpropose`, a direct booking for a
      Principal; Propose MD interview);
    - Confirm rejection;
    - scan links.
  - **"Save MD date"** becomes "Propose MD interview".
  - **The `status === ''` checks** at `hiring/index.html` lines ~285–286, 349, 373, 491 and 503 also
    accept `'Shortlisted'` where they mean "not yet scheduled". Re-grep before editing: the line
    numbers drift.
  - **Walk-in "book now"** (~line 730): for a Principal it calls `apptpropose` (a direct booking, which
    stamps the shortlist). For a Fee Clerk the option is removed, and the form says "Ask the Principal
    to shortlist, then propose a time".
  - **Clerk mode** (temporary, until `office/hiring.html` ships):
    - To schedule (shortlisted only);
    - Waiting for Principal;
    - Booked;
    - Reports to upload (with a scan-upload form: kind, fields, file input, 7 MB check);
    - Documents.
    - Proposals use `apptpropose`.
- [ ] Browser check with the extended `ui-stub.js` as Principal and as FeeClerk, at 1280 and 375, with
  no console errors. Commit.

### Task 7: Appointment box + minimal Owner page + Principal home

**Files:** Create `assets/appointments.js` (with a `module.exports` fallback), `owner/index.html`, `tests/hiring/test-appt-box.js`. Modify `principal/index.html`, `assets/auth.js` (`canViewOwnerPortal` = `hasRole(s,'Owner')`, **added to the return object**), `index.html` (the Owner card goes live) and `tests/verify.mjs` (add `owner/` to the live pages).

**Interfaces:**
- `LMCSAppts.mount(el, {backendUrl, session})`.
- `LMCSAppts.renderHtml_(data, role)` is pure: toAccept (Accept, Decline with a note) and myProposals
  (status chips). It returns `''` when empty.

- [ ] Tests: empty → `''`; the decline control has a note field; esc applied; a clerk role shows no
  Accept. FAIL → implement → PASS.
- [ ] `owner/index.html`:
  - gated by `canViewOwnerPortal`;
  - header + appointment box;
  - links to Approvals (`coordinator/systems/#approvals` for now), Payroll and the Salary Dashboard.
  - Owner Part A extends it.
- [ ] Principal home: the box goes between the welcome strip and Modules.
- [ ] Browser check. Commit.

### Task 8: Migration backfill

**Files:** Modify `apps-script/hiring-appointments.gs`. Test: `tests/hiring/test-backfill.js`.

**Interfaces:**
- `apptBackfill_(nowMs) -> {created, shortlisted}`:
  - For each de-duplicated applicant with a **future** column 13, 25 or 14 and no accepted
    appointment of that kind, it creates an `accepted` appointment: decidedBy `migration`, Calendar
    Mode `none`, campus = the first branch.
  - It sets `Shortlisted At` (by `migration`) on rows at Interview Scheduled or beyond with no
    shortlist.
  - It is idempotent.
- `apptBackfillRun()` is the editor-callable wrapper with the lock.

- [ ] Tests: future date → created; past date → none; a rerun → 0 created; shortlist stamped once.
  FAIL → implement → PASS. Commit.

### Task 9: Verify, review, ship

- [ ] `TZ=Asia/Kolkata node tests/verify.mjs`: all pass.
- [ ] Final whole-branch review by a fresh reviewer (most capable model) with this Review Focus. TDD fix
  pass for Critical and Important.
- [ ] Deploy:
  1. `node apps-script/deploy.mjs pdr` dry run: only `hiring.gs`, `main.gs` and
     `hiring-appointments.gs` may change.
  2. `--push --deploy`.
  3. Run `hirSetupScans()` (creates the "Hiring scans" folder and sets `HIR_SCAN_FOLDER_ID`).
  4. Run `apptBackfillRun()` **before** merging the frontend.
  5. Merge, push.
  6. `node tests/verify.mjs --live`.
  7. Browser-load `hiring/` and `owner/`.
- [ ] Give Uday the calendar steps (`testCalendarWrite` ships in Task 3):
  1. Each Principal and the MD Academics shares their calendar with uday.kanwar@lms.org.in, with
     "Make changes to events".
  2. Run `testCalendarWrite('<their email>')` per person.
  3. Until a person has shared, their events arrive as silent guest events (also on Uday's calendar).
- [ ] Ask Uday: set `MD_ACCEPTOR_EMAILS` to MD Academics only?

### Task 10: After the Fee Clerk session ships `office/hiring.html`

- [ ] Remove the clerk mode from `hiring/index.html`, and redirect FeeClerk-only sessions to
  `../office/hiring.html`.
- [ ] Confirm the office Hiring link points to `office/hiring.html`.
- [ ] Verify, deploy, push.
