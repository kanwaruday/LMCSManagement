# Hiring v2: Principal and Fee Clerk portals, shortlist, appointments, scanned reports

Date: 2026-10-23. Decided with Uday in the "Principal Portal hiring review" session (22–23 Oct).
Builds on `2026-10-22-hiring-principal-day-design.md` (shipped: Today view, portal reports, reject
reasons, revive, Add applicant, Fee Clerk legwork mode).

## Why

The Principal and the Fee Clerk need different screens for hiring. Uday's rule: **the Principal does
the hiring (decides), the Fee Clerk does the legwork (calls, bookings, paperwork)**. Every Principal
decision should hand the clerk a clear task, and every booking the clerk makes should come back to
the Principal to accept. Accepted appointments go onto the accepter's calendar.

## Goals

1. **Shortlist.** The Principal shortlists applicants from **By role**. Only shortlisted applicants
   reach the Fee Clerk's "To schedule" list.
2. **Appointments.** A proposed time is accepted (or declined with a note), and acceptance puts an
   event on the accepter's own calendar.
   - Interviews and demos: the Fee Clerk proposes, the Principal accepts.
   - MD Academics interviews: the Principal proposes, an Owner accepts.
   - A **quick appointment box** on each home page (Principal, Owner, Fee Clerk) shows what's waiting.
3. **Scanned reports.** The Fee Clerk uploads a scan of the handwritten Interview or Demo Report and
   types in its contents, using the same fields and scores as the Principal's portal forms.
4. **Two hiring screens.**
   - **Principal:** the existing `hiring/index.html`.
     - **Today** shows only scheduled (accepted) interviews and demos.
     - A new **My actions** tab holds everything else that waits on the Principal.
   - **Fee Clerk:** a new `office/hiring.html`, built by the Fee Clerk Portal session. Its **Today**
     opens with **To schedule**.

## Non-goals

- No email anywhere. No applicant email is stored or sent; everything lives on the portal (Uday).
- No candidate-facing anything.
- No change to the Salary Dashboard, Payroll or the Hired gate rules.
- No React (after the current development, per Uday).

## Anti-goals

- A Fee Clerk deciding: shortlisting, rejecting, accepting their own proposal, or marking Hired.
- An interview showing on the Principal's Today before the Principal accepted it.
- Two live proposals for the same candidate and kind at once.
- A calendar failure blocking an acceptance. The appointment is accepted; the calendar error is shown
  and can be retried.

## Who does what (decided)

| # | Step | Owner | Screen |
|---|---|---|---|
| 1 | Request role | Principal; Owner approves | Approvals |
| 2 | Applicants arrive | Online form; Fee Clerk adds walk-ins | — |
| 3 | **Shortlist** | Principal | Hiring → By role |
| 4 | Propose interview slot | Fee Clerk | Fee Clerk hiring → To schedule |
| 5 | **Accept or decline the slot** | Principal | Home-page appointment box, or Hiring → Appointments |
| 6 | Interview and Interview Report | Principal fills the form, **or** the Fee Clerk uploads the scan and types it in | Hiring panel / Fee Clerk hiring |
| 7 | Propose demo slot, then accept | Fee Clerk proposes, Principal accepts *(Claude's call: same as interviews)* | as 4–5 |
| 8 | Demo and Demo Report | as 6 | as 6 |
| 9 | Salary offer | Principal | Salary Dashboard (unchanged) |
| 10 | **Propose MD Academics interview, then accept** | Principal proposes, an Owner accepts | Hiring panel; Owner home box |
| 11 | Owner approves offer | Owner | Owner portal → Decisions (spec 2) |
| 12 | Date of Joining, Hired | Principal | Hiring panel (unchanged) |
| 13 | Collect documents | Fee Clerk | Fee Clerk hiring → Documents to chase |

## Shortlist

- New applicant columns, appended after Y=25: **Z=26 `Shortlisted At`** and **AA=27 `Shortlisted By`**.
  They are written by the PDR action `hiringshortlist {row, on:true|false}`, elevated only and scoped
  by `hirScopedRow_`.
- The ladder gains a first rung: `['Shortlisted', 'Interview Scheduled', 'Interview Done', 'Demo Done',
  'Salary Offer', 'MD Academics Interview Scheduled', 'Hiring Approved', 'Hired']`.
  `hirDerive_` returns `'Shortlisted'` when shortlisted and there is no interview yet.
- Un-shortlist is allowed only while no appointment is accepted. It cancels any open proposal.
- Revival clears the shortlist (it is a fresh round).
- An applicant the **Fee Clerk added** (walk-in) is *not* auto-shortlisted. The Principal still
  decides *(Claude's call: Uday's rule that clerks don't decide)*.
- Shortlisted-but-unscheduled applicants stay visible regardless of requisition (they count as
  "in progress").

## Appointments

**Storage:** a new tab, **`Appointments`**, in the Teaching Applicants workbook, created with headers
on first write and found by name. Columns:

`Appt ID | Kind (interview|demo|md) | Applicant ID | Row | Phone | Name | Campus | Start | Duration Min |
Place | Note | Proposed By | Proposed At | Acceptor Role (Principal|Owner) | Status
(proposed|accepted|declined|cancelled) | Decided By | Decided At | Decline Note | Calendar Event ID |
Calendar Mode (own|guest|none) | Calendar Error`

**Rules**

- **The appointment's campus** is the proposer's campus when their allowlist campus is a single school.
  For a multi-campus or ALL proposer it is the first of the applicant's branches inside the proposer's
  scope (`hirScopedRow_`'s pick). A Principal "covers" an appointment when their campus *equals* it, or
  is ALL.

- **One open proposal per applicant and kind.** Proposing again while one is `proposed` replaces it:
  the old one becomes `cancelled`.
- **Who may propose:**
  - `interview` and `demo`: Fee Clerk or elevated.
  - `md`: elevated only.
  - The row must be in the caller's scope.
- **Prerequisites:**
  - `interview` needs the applicant `Shortlisted` (or already scheduled; that is a reschedule).
  - `demo` needs interview evidence (`Interview Done`).
  - `md` needs `Salary Offer`.
- **Who may accept or decline:**
  - `interview` and `demo`: **role Principal** whose campus covers the appointment's campus.
    **Owner override:** an Owner may also accept, for a vacant post or a Principal on leave. It is
    shown as "accepted by Owner (override)".
  - `md`: role Owner. If Script Property `MD_ACCEPTOR_EMAILS` (comma list) is set, only those Owners
    see and accept MD requests. *(Claude's call: default any Owner. Set it to MD Academics' email to
    keep requests off other Owners.)*
  - The proposer can't accept their own proposal, unless they are themselves an acceptor of that
    kind. A Principal booking directly is the shortcut below.
- **A Principal booking directly:**
  - When a user with **role Principal** sets an interview or demo time from their own Hiring screen, it
    is created already `accepted` by them, and the event goes on their calendar.
  - A Coordinator or Owner setting a time creates a `proposed` appointment for the Principal to accept,
    because the Principal does the hiring.
  - **Every path that used to write the date columns now goes through appointments:**
    - `hiringschedule` becomes a thin wrapper: a Principal books directly, anyone else proposes, and
      `clear` cancels.
    - `updatehiringstatus` no longer accepts `interviewAt`, `demoAt` or (except for an Owner)
      `mdInterviewAt`.
    - A demo report's "another demo" with a next time books it (Principal) or proposes it (Fee Clerk).
  - Fee Clerks lose `hiringschedule`; they use `apptpropose`.
- **On accept**, under the script lock:
  1. Write the time into the applicant row: `INTERVIEW_AT`, `DEMO_AT` or `MD_INTERVIEW_AT`.
  2. Create the calendar event.
  3. Store the event id and mode.
- **On decline:** the note is required. The applicant row is untouched, and the proposer sees "declined,
  propose again" with the note.
- **Reschedule:** proposing for an applicant who already has an *accepted* appointment of that kind is
  allowed (the Fee Clerk may reschedule something a Principal booked). When the new one is accepted,
  the old accepted one becomes `cancelled` and its calendar event is deleted.
- **MD times always go through an Owner.** The Principal's "Save MD date" (`savemd` →
  `updatehiringstatus` `mdInterviewAt`) is rerouted to `apptpropose kind:'md'`, and
  `updatehiringstatus` stops accepting `mdInterviewAt` from non-Owners. An Owner setting it directly
  is a direct booking (accepted by them).
- **Today and "scheduled" read accepted appointments, not the date columns.** A report filed for an
  interview that happened without an appointment (a walk-in seen on the spot) still sets
  `INTERVIEW_AT` as evidence, as today, but it never appears on Today. Today shows only accepted
  appointment rows.
- **Cancel:** the proposer or an elevated user may cancel a proposed or accepted appointment.
  Cancelling an accepted one deletes its calendar event and clears the applicant's time field, if it
  still holds that appointment's time.
- **Revive** cancels every open or accepted appointment for the person.
- **Reject** (through `hirRejectRow_`, the single reject path) cancels open proposals and **future**
  accepted appointments, deleting their events. Past accepted ones are history.
- **Proposing for a Rejected applicant is refused** (revive first).
- **Un-shortlist** cancels the person's open proposals, and is refused while an accepted appointment
  exists.

**Calendar** *(Claude's call, simpler than domain-wide delegation; DWD stays a later option)*. All writes
and deletes call the **Calendar REST API through `UrlFetchApp`** with `ScriptApp.getOAuthToken()` and
`sendUpdates=none`, so neither creating nor cancelling ever sends mail. The PDR project already has the
`calendar` and `script.external_request` scopes. No manifest change is needed, and `CalendarApp`
can't promise silence on deletes.

1. **`own`:** insert into calendar id = the acceptor's email. If the insert throws (not shared, or
   shared read-only), fall through to 2. This works when the accepter has shared their calendar with the
   backend's account (Uday) with "Make changes to events". The backend already reads Principals'
   personal calendars this way (`principal-dr.gs` `PDR_PRINCIPAL_PERSONAL_CALENDARS`), and the PDR
   project already has the full `calendar` scope.
2. **`guest`:** insert into `primary` (the backend account, Uday) with the acceptor as an attendee and
   `sendUpdates:'none'`. It shows on the acceptor's calendar if their "add invitations" setting allows,
   and it also sits on Uday's calendar. This is a stop-gap until they share their calendar.
3. **`none`:** if both fail, the error is stored in `Calendar Error`, the appointment stays accepted,
   and the UI shows "Calendar not updated — Retry". The retry is `apptcalendarretry {id}`.

The event title is `Interview: <Name> (<Position>)`, `Demo class: …` or `MD Academics interview: …`.
The description carries phone, school, position, stage, the proposer, and a link to
`hiring/index.html#row=<row>`. Duration defaults: interview 30 min, demo 45, MD 30.

**PDR actions** (in `hiring.gs`, routed in `main.gs`):

| Action | Method | Who | Body / params |
|---|---|---|---|
| `apptlist` | GET | all hiring roles | — returns `{toAccept[], myProposals[], upcoming[]}` scoped to the caller |
| `apptpropose` | POST | Fee Clerk, elevated | `{row, kind, start (ISO local), durationMin?, place?, note?}` |
| `apptdecide` | POST | acceptor | `{id, decision:'accept'|'decline', note?}` |
| `apptcancel` | POST | proposer or elevated | `{id, note?}` |
| `apptcalendarretry` | POST | acceptor or elevated | `{id}` |
| `hiringshortlist` | POST | elevated | `{row, on}` |
| `hiringuploadreport` | POST | Fee Clerk, elevated | see Scanned reports |

`hiringapplicants` also returns each applicant's open and accepted appointments (`appointments[]`) and
`shortlistedAt`.

**Fee Clerk allow-list becomes:**
- GET `hiringapplicants`, `hiringapprovalstatus`, `apptlist`
- POST `hiringaddapplicant`, `apptpropose`, `apptcancel`, `hiringuploadreport`

## Scanned reports (Fee Clerk upload)

`hiringuploadreport {row, kind:'interview'|'demo', file:{name, mime, base64}, ...same fields as
hiringsubmitinterview / hiringsubmitdemo}`

- **The file:**
  - pdf, jpeg or png only, checked by magic bytes; at most **7 MB** raw (a POST carries it as base64, about 9.5 MB), checked in the browser and on the server.
  - Saved to the Drive folder in Script Property `HIR_SCAN_FOLDER_ID`, under a per-campus subfolder.
  - File name: `<Applicant ID> <Name> <kind> <yyyy-mm-dd>`.
  - Sharing: *anyone at lms.org.in with the link can view* *(Claude's call: Principals and Owners
    must open it from the portal)*.
- **The fields:** validated exactly as the portal forms (scores 1–5 required, etc.).
- **The row:** appended to the same report tab, with two new columns, **`Scan Link`** and
  **`Entered By Role`** (`principal|clerk`).
- **What it does to the stage** *(Claude's call: a clerk transcribes, the Principal decides)*:
  - A clerk-entered report counts as evidence by the same rule as a Principal's: an interview report
    always; a demo report only when the recommendation is `proceed` (`another` books another demo).
  - A clerk-entered report with recommendation `reject` does **not** reject. It sets
    `rejectPending:{reason, note, reportId, at, by}` inside the **Stage Marks JSON (column X)**, so no
    new column is needed. The Principal sees **"Confirm rejection"** under My actions (one click, or
    "Don't reject"). Either choice clears it, and so does Revive (which clears column X).
- **Shortlist is not required for an upload.** A walk-in interviewed on the spot can have their report
  uploaded, and it counts as evidence. Shortlisting gates *proposals*, not reports.
- A Principal can also upload a scan, with the same action. Their `reject` rejects directly.

## Principal screens (`hiring/index.html`)

Tabs:

- **Today** — accepted interviews and demos for today (time order), then the next 7 days. Each card
  has Open, the report button, and Reject. Nothing else is on Today.
- **Appointments** — proposals waiting for this Principal (Accept or Decline with a note), plus the
  MD proposals this Principal has sent and their status.
- **By role** — role chips as now. Each card has **Shortlist / Un-shortlist** and a "Shortlisted"
  chip. A filter shows "Not yet shortlisted", "Shortlisted" or "All".
- **My actions** — everything that waits on the Principal, each with its one action:
  - reports pending (marked done, report later);
  - Interview Done with no demo proposed;
  - Demo Done, so make a salary offer;
  - Salary Offer, so propose an MD interview;
  - Hiring Approved, so DOJ, documents, Hired;
  - clerk-proposed rejections to confirm;
  - scheduled interviews whose time passed with no report.
- **Rejected pool** — unchanged.

The panel also gains:
- **Shortlist**;
- an **Appointments** block (history; propose MD; Principal direct booking);
- "Scan" links on clerk-entered reports.

**Migration (once, at deploy):** `apptBackfill_()` creates an `accepted` appointment (Calendar Mode
`none`, decided by "migration") for every applicant with a **future** `INTERVIEW_AT`, `DEMO_AT` or
`MD_INTERVIEW_AT`, and sets `Shortlisted At` on everyone already at Interview Scheduled or beyond. This
way, nothing booked today disappears from Today, and the clerk can reschedule it.

**Filing a report clears it everywhere:** a missing report shows on both the Principal's My actions and
the clerk's Reports to upload. Whoever files it first clears both.

## Fee Clerk screen (`office/hiring.html` — built by the Fee Clerk Portal session)

It boots with `bootOffice`, calls the PDR backend directly with `fetch` (like `office/index.html`), and
is online-only for writes.

**Today**, sections in this order:
1. **To schedule** — shortlisted, no open or accepted interview, plus declined proposals (with the
   decline note). Propose a time.
2. **Waiting for Principal** — my open proposals (Cancel).
3. **Booked** — accepted appointments of every kind (interview, demo, MD; including Principal direct
   bookings), today and the next 7 days. The clerk calls the candidate to confirm.
4. **Reports to upload** — interviews or demos whose time has passed with no report.
5. **Demos to book** — Interview Done, no demo proposed.
6. **Documents to chase** — Hiring Approved with missing documents (prefilled Document Submission
   Form link).
7. **Add walk-in**.

**Office home (Uday: "a section on top"):** above the office Today, a banner reads **"To schedule (n)"**
with the names, linking to `office/hiring.html`, plus the appointment box (my proposals). The Hiring
link counts use `legwork`. Plan 1 itself switches `office/js/today.js` `hiringCounts` to `legwork`, a
two-line change made with the Fee Clerk session's knowledge, so the counts are never wrong in between.

## Quick appointment box (home pages)

`assets/appointments.js` exposes `LMCSAppts.mount(el, {backendUrl, session})`. An Owner's box lists only MD requests (filtered by `MD_ACCEPTOR_EMAILS`). It reads `apptlist` and renders:

- **To accept** (cards with Accept and Decline with a note) — Principal home, Owner home.
- **My proposals** (status chips) — Fee Clerk home, and Principal home for MD proposals.

It hides itself when empty. Mount points:
- `principal/index.html` (between welcome strip and Modules);
- `office/index.html` (above Today). **The Fee Clerk session owns the office mount;**
- `owner/index.html` (spec 2).

## Data compatibility

- `coordinator.gs` reads applicant columns B, F, K, N, P and Q by index (`coordHiringWanted_`).
  It uses only the **stored** status, and `Shortlisted` is derived, never stored, so no coordinator
  change is needed. New columns are appended after Y.
- The Salary Dashboard and Payroll read nothing that changes.
- **Fee Clerk counts come from the server.**
  - For every caller, `hiringapplicants` returns `legwork: {toSchedule, waiting, booked,
    reportsToUpload, demosToBook, documents}`, computed with the same rules as the Fee Clerk screen.
  - `office/js/today.js` `hiringCounts` must switch to it. Its current `status === ''` rule would
    count every un-shortlisted applicant.
  - Clerks don't receive report contents (`hirForCaller_`). "Reports to upload" comes from appointments
    and status.

## Release order (so nothing is stranded)

1. The backend (this spec), plus `hiring/index.html`:
   - its existing Fee Clerk mode switches from `hiringschedule` to `apptpropose`;
   - a minimal **`owner/index.html` with the appointment box**, so an Owner can accept MD interviews
     from day one. Without it, `hirSalaryOfferGateCheck_` would block every offer, because the MD time
     is only set on acceptance.
2. The Fee Clerk Portal session ships `office/hiring.html` and the new counts. Then the Fee Clerk mode
   in `hiring/index.html` is removed, and the office Hiring link points to `office/hiring.html`.
3. Owner portal spec, part A, completes the Owner page.

## Left to the builder

Layout and copy within each screen, matching the existing page styles; field order within forms;
the exact wording of event descriptions.
