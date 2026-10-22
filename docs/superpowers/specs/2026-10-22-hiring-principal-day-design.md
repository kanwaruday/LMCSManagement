# Hiring: the Principal's day, portal reports, rejection & revival, offline applicants

Date: 2026-10-22. Asked for by Uday after a Principal raised four problems; decided in the
"Principal Portal hiring review" session. Review that led here:
vault `work/Principal Portal Review 2026-10-22.md`.

## Why

Principals can't see their hiring day in one place, can't act on a candidate from that place,
can't bring back a rejected candidate, and can't enter an applicant who never filled the online
form. Interview and demo results arrive as one scanned PDF (bio-data + interview + demo stapled
together), and on the real reports the 1-5 marks are left blank.

The aim: **the Principal does the hiring; the Fee Clerk does the legwork** (books slots, adds walk-ins,
chases documents). The Fee Clerk never moves a candidate forward or rejects anyone.

## Goals

1. **Today view.** One screen per school: who is scheduled today (interviews and demos), who was
   interviewed today, who is waiting on the Principal, who still needs a slot, and what's coming up.
   Every row has the next action and a Reject button.
2. **Interview Report and Demo Report as portal forms**, split, in the paper format.
3. **Reject with a reason; revive a rejected candidate**, who starts again from a fresh interview.
4. **Add applicant** (Principal or Fee Clerk), without needing an Interview Report.

## Non-goals

- No Google Form changes. The old Interview Report form keeps working as a fallback.
- No React work. That comes after the existing development is finished.
- Nothing changes in Payroll's Joined step or the Employee Master write (tracked separately in the
  review note).
- No candidate self-service.

## Anti-goals (these would make it a failure even if it "works")

- A Fee Clerk being able to progress, reject, revive or hire anyone.
- A revived candidate coming back already at "Interview Done" / "Hiring Approved" because of old evidence.
- A candidate already in progress disappearing because their position was closed.
- The Owner's Salary Offer approval and the Hired document gate being bypassable from the new buttons.

## Decided with Uday

- The Progress button is an **addition** to the evidence-derived ladder, not a replacement.
- The Fee Clerk does legwork only.
- Rejection reasons are the list below, in two groups ("not now" vs "not suitable") plus "position
  filled" and "other".
- Revival = **start as a fresh interview**. History is kept and shown.
- Reports follow the paper format (Teacher Interview Report + Demo Classes).
- The Fee Clerk Portal session builds the entry points on its side. This work provides the backend
  actions and the Hiring Dashboard screens they can link to.
- React waits.

## The ladder (changed)

`Interview & Demo Done` splits in two, because the reports split:

```
Interview Scheduled → Interview Done → Demo Done → Salary Offer → MD Academics Interview Scheduled → Hiring Approved → Hired
                                                                                                   (Rejected = exit from anywhere)
```

Evidence (only evidence dated **after** the revival time counts, when the candidate was revived):

| Rung | Moves when |
|---|---|
| Interview Scheduled | interview date set |
| Interview Done | portal Interview Report submitted, **or** Principal clicked "Interview done" (report can follow), **or** an old Google-Form Interview Report exists for the phone |
| Demo Done | portal Demo Report submitted, **or** Principal clicked "Demo done", **or** an old Google-Form Interview Report exists (the old scanned PDF contained the demo page) |
| Salary Offer | unchanged (Salary Dashboard Record) |
| MD Academics Interview Scheduled | unchanged (MD date) |
| Hiring Approved | unchanged (Owner approves Salary Offer Approval) |
| Hired | unchanged gate (Principal click + documents) |

A rung marked by the Principal without its report shows **"report pending"** on the row, and the
Today view lists it under "waiting on you".

## Rejection reasons

Not now (revive first): Doesn't want to join right now · Working at another school / serving notice ·
Salary expectation too high · Location / commute / relocation · Not reachable / stopped responding ·
Took another offer / withdrew · Personal or family reasons.
Not suitable: Poor communication skills · Weak subject knowledge · Weak demo / classroom handling ·
Doesn't meet the qualification norm · Attitude / conduct at interview · Reference / background concern.
Other groups: Position filled or closed · Other (note required).

The reason is required. The note is optional except for "Other". An Owner rejecting the Salary Offer
Approval shows as "Salary offer not approved".

## Revival

Allowed for Principal / Coordinator / Owner, only from Rejected, with a note. It:

- appends a snapshot to the candidate's history (dates, stage reached, reason, note, who/when);
- clears status, reason, interview / demo / MD / offer / DOJ / stage marks;
- stamps the revival time.

All evidence dated before that time is ignored: old reports, old Salary Offer Approval decisions
(by `decidedAt`), old Interview Report form rows. A locked employee code is kept, since numbers are
never reused. The row shows "Revived (round N)", and the history is visible in the candidate panel.

## Who sees whom (changed)

Same district rule as today, plus: a candidate is visible in their district if they match an approved
requisition **or** have any progress (interview date, stage mark, report, status) **or** were added in the
portal. This stops in-progress candidates disappearing when a position closes. Online-form applicants
with no match and no progress stay hidden, as before. A Fee Clerk's campus may be a comma list; their
district is the union.

## Roles (server-enforced in `main.gs`)

| Action | Fee Clerk | Principal / Coordinator / Owner |
|---|---|---|
| View applicants / today / pool | own campuses | as today |
| Add applicant | yes | yes |
| Set / clear interview & demo date | yes | yes |
| Notes | no | yes |
| Mark interview / demo done, submit reports | no | yes |
| Reject, revive, Hired, DOJ, MD date | no | yes |

Today `verifyCallerToken_` rejects FeeClerk entirely. It now admits FeeClerk, and a FeeClerk-only caller
(no Principal / Coordinator / Owner role) is limited to an explicit list of actions, the same way
Teacher-only callers already are.

## Data (all in the Teaching Applicants workbook)

New columns on the applicants tab, appended after R (18), never touching the form's columns:
S `Reject Reason`, T `Revived At`, U `History (JSON)`, V `Source`, W `Added By`, X `Stage Marks (JSON)`
(`{interview:{at,by}, demo:{at,by}}`), Y `Demo At`.

Two new tabs, created on first write with headers, and found by name:
- **Portal Interview Reports**: Report ID, Applicant ID, Row, Name, Phone, Campus, Position,
  Interview Date, Confidence, English, Capability (JSON), Spouse / family occupation, Family support,
  Qualification remarks, Other skills, Experience (JSON), Commitment, Expected salary, Strengths,
  Weaknesses, Remarks, Recommendation, Submitted By, Submitted At.
- **Portal Demo Reports**: Report ID, Applicant ID, Row, Name, Phone, Campus, Demo Date(s), Class,
  Subject, Pedagogy, Content, Student Interaction, Student Response, Classroom Management,
  Clarity & Audibility, Makes Subject Relatable, Use of Teaching Aids, Student Feedback, Total /45,
  Strengths, Areas to improve, Remarks, Recommendation, Submitted By, Submitted At.

Add applicant writes a normal row: name, phone, age, subjects, branches `LMS-n`, qualification,
B.Ed/TET, gender, CV link, notes, plus Source and Added By. A phone already on file is **not** added
again: the existing candidate is returned and opened instead.

## Scores: compulsory or not (my call)

On paper the marks are routinely left blank, and that's the reason to have forms at all. So:

- **Interview:** Confidence and English (1-5) are required, plus at least one capability score for
  the subject interviewed for. The rest is optional.
- **Demo:** all 8 scores and Student Feedback are required, and the total is computed. Remarks are
  optional.

Each form ends with a recommendation that is also the action: Interview → "Proceed to demo" / "Reject";
Demo → "Proceed to salary offer" / "Another demo" / "Reject". Choosing Reject asks for the reason.

## Screens (Hiring Dashboard, one page, `hiring/index.html`)

Tabs: **Today** (default) · **By role** (today's screen) · **Rejected pool** · a search box (name or
phone, across everyone visible) · a **+ Add applicant** button.

- **Today**
  - Header counts: Scheduled today · Interviewed today · Waiting on you · Needs a slot.
  - Sections, in this order: Scheduled today (time order) · Waiting on you · Interviewed today ·
    Needs a slot · Next 7 days.
  - Each row shows: name + ID, phone/WhatsApp, position/subjects, stage chip, "report pending" /
    "revived" chips, the one **Next step** button, Reject, and an Open link to the full candidate panel.
- **Next step** by stage:
  - Needs a slot → set interview date.
  - Scheduled → Interview Report (or "Interview done, report later").
  - Interview Done → Demo Report (or "Demo done, report later"; can also set a demo date).
  - Demo Done → Salary Dashboard.
  - Salary Offer → MD date.
  - MD → waiting on Owner (disabled).
  - Hiring Approved → DOJ / documents / Hired, as today.
- **Candidate panel** (a modal): details, the ladder, both reports (read-only once submitted), notes,
  history of earlier rounds, and the actions.
- **Rejected pool:** grouped by reason group, filterable, with a Revive button.
- **Fee Clerk mode:** the same page and tabs, but rows only offer: set or change the interview / demo date,
  Add applicant, the Document Submission Form link, and the missing-documents list. No decision buttons.

## Fixes folded in (they sit on this exact path)

- The Save crash on early-stage rows (`.md-interview-input` null) goes away: the row actions are
  rebuilt so every input read is guarded.
- Everything interpolated into HTML is escaped (applicant data comes from a public form).
- Phone de-dupe keeps the row **furthest along** (newest only as the tie-break), so a re-application
  can't erase progress.
- The document check reads the merged response workbook's `LMS n` tab **and** the old per-campus sheet,
  and takes the union. Since 7 Oct the forms may write to either.

## Settled after the builder check (my calls, marked as such)

1. **Legacy values.**
   - A stored `Interview & Demo Done` (if any survived) reads as Demo Done.
   - Rows already Rejected have no reason; the pool shows them under "Earlier (no reason recorded)".
2. **Fee Clerk scope.**
   - `verifyCallerToken_` admits `FeeClerk`.
   - A caller with none of Principal / Coordinator / Owner may only call:
     - GET `hiringapplicants`, `hiringapprovalstatus`;
     - POST `hiringaddapplicant`, `hiringschedule`;
     - plus the existing Teacher lists if they also hold Teacher.
   - The campus cell may be `LMS1,LMS2` (as the Staff and Office backends already read it); hiring
     splits it, and the district is the union.
3. **Where progress lives.**
   - "Interview done" / "Demo done" write only Stage Marks (X), and the derivation reads them.
   - Status (K) is still written only by Hired / Rejected, through `hiringUpdateStatus_` and its gates.
   - Revive is its own action, `hiringrevive`.
4. **Revival cutoff.** Revived At is compared with:
   - Interview Report form: the form's Timestamp (column A); every row for the phone is considered,
     and any row after the cutoff counts.
   - Portal reports: Submitted At.
   - Salary Offer Approval: Decided At.
   - The Salary Offer date, MD date and DOJ are cleared by revival anyway.
5. **De-dupe.**
   - The row kept is the one with the furthest *effective* stage; the latest row wins a tie.
   - Reports are looked up by **normalised phone** (falling back to applicant ID), so they follow
     the person whichever row survives.
   - Add applicant's duplicate check also uses the phone.
6. **Visibility.**
   - Rejected alone doesn't count as progress. A rejected row is visible only if it also had an
     interview date, was portal-added, or matches an open requisition.
   - The pool uses the same district rule.
7. **"Waiting on you"** = rows whose next action is the Principal's:
   - Scheduled with the interview time already passed;
   - any "report pending";
   - Interview Done (demo needed), Demo Done (salary offer needed), Salary Offer (MD date needed);
   - Hiring Approved (DOJ / documents / Hired).

   "Today" is IST. Interview and demo dates are date-times.
8. **Another demo.**
   - Saves the demo report but doesn't count as Demo Done, and lets the Principal set a new demo date.
   - Several reports are allowed per candidate; the panel lists them all, newest first.
9. **Owner decisions after revival.** These are ignored purely by Decided At, whether the request is
   new or reused.
10. **Locks.** Add applicant (check + append), revive (history read-modify-write) and report appends run
    under the script lock.

## Left to the builder

Exact layout and styling (match the page's existing look), the order of form fields within a section,
and copy wording.
