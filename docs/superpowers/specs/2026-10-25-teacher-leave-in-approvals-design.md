# Teacher leave in Approvals (design and plan)

Date: 2026-10-25. Asked for by Uday ("Leave into Approvals", Q6 of the Teacher game design), routed through the LMCS
Master Agent. **Status: P1-P4 built on branch `teacher-leave-in-approvals` (not merged, not deployed); see "As built" at the end. P5 and P6 are later.**
All 8 questions were answered (2026-10-25/26, see "Uday's decisions"). Where the body below differs from a numbered decision, the decision wins.

Inputs: Teacher game spec (`teacher-portal-game-design`, e6ce8e8), LMCS Bye Laws 2026 leave section (OO-09/26, 11 Sep
2026), Payroll's leave fields (`payroll-calc.gs`, `PAY_LEAVE_FIELDS`), current `approvals.gs` on `origin/main`.

## Goal and done-when

1. A teacher requests leave in the portal's Approvals with **from/to dates**, a leave type from the bye-laws, and a reason.
2. The right person approves it (see "Who approves").
3. **Other modules can read approved leave days** through one stable contract (below). The Teacher game uses it to leave
   leave days out of "days on track" and to bring the "of M" back.
4. Existing Approvals behaviour, the Payroll leave template and every other category are unchanged.

## What the bye-laws say (so the types match the real rules)

Payroll's 12 "leave" fields are a mix of two different things. Only the first group is something a teacher *requests*:

| Requested by the teacher in advance | Weight (OO-09/26) | Notes from the bye-laws |
|---|---|---|
| Casual Leave | 1 day, paid | 1 CL per month; claim by 31 March; no carry-forward |
| Compensatory Leave | 1 day, paid | For an extra day worked on a Sunday, 2nd Saturday or gazetted holiday only; **Principal recommends, MD Operations approves** |
| Single Leave | 1 day, unpaid | When CL is exhausted; Principal's approval; sandwich rule applies |
| Half Leave | 0.5 day | 2/3 of the shift's working hours; 2 half leaves = 1 day |
| Short Leave | 1/3 day | Up to 60 minutes; 3 = 1 day |
| Special Day absence | 2 / 3 / 5 days | Tier is set by **notice given** (7+ days / under 7 / none), not chosen by the teacher |
| Emergency (death in immediate family) | 0 deducted | Bye-law general rule 12 |

| Recorded by management, never requested | Why |
|---|---|
| Absent (2 days), Late (0.25), Non-Compliance (0.1) | Outcomes noted by the Principal or flagged by the System Coordinator |
| Double Leave (2 days) | **System-assigned** when the 10% teacher cap for that day is already reached; the teacher does not pick it |

Other rules that touch a request: leave must be applied **in advance**; an absence not notified by 7:00 AM that day is
recorded as Absent whatever the reason; **Long Leave** (more than 6 consecutive working days) needs MD Operations
approval and is outside the 10% cap; no two staff in the same role at a branch on leave together without MD Operations'
approval; sandwiched holidays count as leave unless MD Operations exempts them.

## Recommendation

### 1. Categories: one new category, "Leave", with a leave-type dropdown

Not 12 categories. A single **Leave** category keeps the Approvals filters and category list short. The teacher then picks
a **Leave type**. **Final teacher dropdown (decisions 3 and 4): Single (unpaid), Short, Half day, Special Day absence, Late, Casual,
Emergency.** Compensatory is not on the teacher form (Management grants it). Absent, Non-Compliance and Double Leave are never
offered; they stay in Payroll's monthly template. **Late** (not in the table above, which follows the bye-law's own grouping) is
now requestable as notice-and-record only (decision 5). The existing **Compensatory Leave** category stays as it is today (a
Principal asking for days off for the school).

Teachers may submit `Leave` in addition to `Compensatory Leave` and `Other` (`APR_TEACHER_CATEGORIES`).

### 2. Data shape (one source of truth, no second sheet)

Add self-creating columns on the Approvals sheet, after the existing follow-up columns (same pattern as `referredTo`,
`archived`, follow-up):

| Column | Meaning |
|---|---|
| `leaveType` | one of the types above |
| `fromDate`, `toDate` | ISO `YYYY-MM-DD`, inclusive; same day for a half or short leave |
| `dayPart` | `full`, `half`, `short`, `late` |
| `leaveDays` | **computed on the server**: working days in range (Sundays, 2nd Saturdays and calendar holidays removed) x weight (Late = 0.25, informational: kept for Payroll, never returned to the game) |
| `noticeDays` | computed: `fromDate` minus the submit date (drives Special Day tier, and flags same-day requests) |

The teacher's email is already in `requestedBy`; Management's decision, note and time are the existing columns.

### 3. The contract other modules read

One read action on the PDR backend, `approvedleave`, plus a pure function other `.gs` files in the project can call:

```
approvedLeaveDays(email, fromISO, toISO) ->
  [{ date: 'YYYY-MM-DD', fraction: 1 | 0.5 | 0.33, excused: true | false, type: 'Casual Leave', approvalId: 'apr-...', employeeCode: '...' }]
```

- **One entry per calendar day**, so the Teacher game never does its own range maths.
- **Late is never returned as a leave day** (Uday, Q5): it is notice and record only, and the day stays a working day.
- Only requests with status **Approved** (Revoked and Rejected never appear), not archived-filtered.
- `fraction` is how much of the day is on leave: a full-day leave is 1, a half leave 0.5, a short leave about 0.33. `excused` is the
  game's yes/no: true for Single, Casual, Emergency, Special Day and Half day; false for Short (decision 6).
  The game uses `excused` directly; it does not decide how a partial day counts.
- Server callers in other Apps Script projects (Coordinator, game backend) read the sheet directly with the
  same column positions, as `coordinator.gs` already does for approvals; the contract is documented in code next to the columns.
- A caller sees only their own leave, their campus (Principal), or everyone (Owner/Coordinator), the same scoping as `aprList_`.

### 4. Who approves (decided: option B for now, with a seam for later)

**Decided (Uday, 2026-10-25): "Teacher leave: everything goes to Management (Owner / delegated Coordinator) for now, as
with all approvals. We'll hand routine leave to Principals later."**

So v1 changes **no permissions**: `aprCanDecide_` stays exactly as it is (Owner, or Coordinator with `CanApprove`), the
decision is recorded under the decider's own email, and a campus Principal sees leave only as the requester's campus
view does today (read, comment, no decide).

Built so the later hand-over is a configuration change, not a rewrite:
- Every decide path (`aprDecide_`, `aprArchive_`, and the Coordinator > Systems > Approvals decide bar) goes through **one**
  function, `aprCanDecideRow_(caller, row)`. In v1 it returns `aprCanDecide_(caller)` for every row.
- A constant, `APR_LEAVE_PRINCIPAL_TYPES = []` (empty), names the leave types a campus Principal may decide for their own
  campus's teachers. Moving routine leave to Principals later = fill that list (Casual, Single, Half, Short, Emergency),
  plus the own-campus check inside `aprCanDecideRow_`. Compensatory, Long Leave and Special Day stay with Management.
- The Principal's recommendation step (Principal recommends, Management approves) is **not** built now; the existing
  comment thread is where a Principal can comment today.

### 5. Rules checked in v1 versus later

| v1 (this build) | Later (needs data we don't hold in Approvals) |
|---|---|
| Valid dates, `toDate >= fromDate`; **future dates, or today until 7:00 AM IST; a past date or today after 7:00 AM is refused** (decision 7) | 10% cap / auto Double Leave (needs each branch's teacher headcount by day) |
| Working-day count excluding Sundays, 2nd Saturdays and calendar holidays | Special Day tier from the campus special-day calendar |
| Overlap guard: same teacher, overlapping Pending/Approved dates is refused (extends the existing duplicate guard) | CL balance and the 31 March lapse (the balance lives in Payroll's Owner-only backend) |
| Long Leave auto-flag (over 6 working days) and sandwich note shown to the decider | Same-role overlap check |
| The form's refusal after the deadline reads: "This can no longer be applied for. Your Principal will record it (as Absent if it was not notified by 7:00 AM)." | Prefilling Payroll's leave counts from approved leave (open question 6) |

### 6. Screens

- **Teacher portal** (`teacher/index.html`, My Requests): a Leave form with type, from, to, part of day, reason, and a live line
  "3 working days (Mon 3 to Wed 5 Nov, Sunday skipped)" plus any warning. My Requests lists type, dates and days.
- **Approvals** (Principals' page and Coordinator > Systems > Approvals): leave rows show type, dates, days and notice; the
  decide bar for a Principal shows only what they may decide.
- Teacher game: no UI here; it reads the contract.

### 7. Build plan (each step shipped on its own branch, with tests)

1. **P0, decisions:** Uday answers the open questions below.
2. **P1, backend:** `Leave` category, columns, `aprSubmit_` validation, working-day calculation, overlap guard, `approvedleave`
   action and `approvedLeaveDays`. A new `approvals-leave.gs` (functions prefixed `aprLv`), added to `apps-script/projects.json`.
   Tests in `tests/approvals/` (the repo has none for approvals today): working days, weights, overlap, scoping, the contract output.
3. **P2, teacher form** and the Approvals display of leave fields.
4. **P3, approver seam:** `aprCanDecideRow_` and the empty `APR_LEAVE_PRINCIPAL_TYPES`; no behaviour change. The Principal hand-over is a later, separate build.
5. **P4, consumers:** hand the contract to the Teacher game; Payroll prefill as a separate piece later.
6. **P5, later rules** from the table above, one at a time.
7. **P6, after the February pilot (decision 8):** a "Fill from approved leave" button on Payroll's leave step, pre-filling counts
   (Single, Casual, Half, Short, Late, Special Day split 2/3/5 by notice) for Management to review before locking the month.
   Not part of this build; Payroll is untouched until then.

Deploy only through `apps-script/deploy.mjs` (dry run first), then `node tests/verify.mjs --live` and a browser check.
Target: P1 to P3 in November 2026, so the game has real data before the February 2027 pilot.

## Risks

- **Approver scope:** none in v1 (option B). The later Principal hand-over will be the only change to permissions; it is narrow, own-campus and `Leave`-only.
- **`approvals.gs` global scope:** a duplicate top-level name breaks the whole PDR deployment; `verify.mjs` compiles every
  file, and the plan adds a collision check to the tests.
- **Leave records are personal data** (reason text can be medical); the contract exposes dates and type, never the reason.

## Open questions for Uday (asked one at a time, answers recorded below)

1. ~~Who approves teacher leave~~ **Answered: B (Management), seam for later.**
2. ~~One "Leave" category with a type dropdown, or separate categories?~~ **Answered: one "Leave" + type dropdown (A).**
3. ~~Which types can a teacher request~~ **Answered (Uday): "Single, Short, Half, Special Day Leaves, Late".** Casual, Compensatory and Emergency are NOT on the dropdown. Casual and Emergency were then added (Q4 below). **Late: answered in Q5 below.**
4. ~~In "days on track", does a half-day leave excuse the whole day or half of it?~~ **Answered (decision 6): the whole day; Short and Late do not.**
5. ~~Can a teacher file leave for a past date or the same day?~~ **Answered (decision 7): future dates, and today until 7:00 AM IST.**
6. ~~Should approved leave later prefill Payroll's monthly leave counts?~~ **Answered (decision 8): later, as a review button.**

## Uday's decisions

1. **Who approves (2026-10-25):** "Teacher leave: everything goes to Management (Owner / delegated Coordinator) for now, as
   with all approvals. We'll hand routine leave to Principals later." Recorded as option B; the hand-over seam is designed in
   (section 4) but not built.
2. **Category (2026-10-25):** "One 'Leave' + type dropdown" (option A): one new Approvals category, "Leave", with a Leave type
   dropdown; the type, dates and days show on the row.
3. **Types (2026-10-25):** "Single, Short, Half, Special Day Leaves, Late" (Uday). The dropdown is therefore Single (unpaid), Short,
   Half day, Special Day absence and Late.
4. **Casual and Emergency added (2026-10-25):** "Add Casual + Emergency" (option A, so every day off has dates in Approvals and the game
   never counts a Casual or Emergency day as missed). The teacher dropdown is **Single (unpaid), Short, Half day, Special Day
   absence, Late, Casual, Emergency**. Compensatory stays out of the teacher form (Management grants it).
5. **What an approved Late means (2026-10-26):** "approval is just the notice and record; it still counts as a Late (0.25 day,
   4 = 1 day deducted)." Nothing is excused; an approved Late replaces the Principal's register entry. **For the game and the
   contract it is not leave:** `approvedLeaveDays` does not return Late as a leave day (a Late day is a normal working day).
   Late stays readable on the row (type, date, minutes late if given) so Payroll can count Lates later.
6. **Partial days in "days on track" (2026-10-26):** "full-day types and Half day excuse the whole day; Short leave and Late don't."
   So Single, Casual, Emergency, Special Day and Half day excuse the whole day; Short leave and Late leave it an ordinary working
   day. The contract returns each day with the real `fraction` (1, 0.5, 0.33) **and** a ready-made `excused` yes/no (true for
   full-day types and Half day, false for Short), so the game never encodes the bye-law. Late is not returned (decision 5).
7. **Past-date and same-day requests (2026-10-26):** "Future + today till 7 AM" (option A). The form accepts future dates, and today's
   date until 7:00 AM IST. After that, or for any past date, it refuses and says the Principal will record it. Management can still enter
   an exceptional case directly in the sheet. Late is same-day by nature, so it is allowed until 7:00 AM that day. The 7:00 AM check is
   done on the server clock (IST), never the teacher's device.
8. **Payroll prefill (2026-10-26):** "Later, as a review button" (option A). Payroll stays exactly as it is in this build. After the
   February pilot, a "Fill from approved leave" button pre-fills the counts for Management to review and change. Absent, Double
   Leave and Non-Compliance stay typed by hand.

## As built (P1-P4, branch `teacher-leave-in-approvals`, 2026-10-26)

Not deployed and not merged to main; deploying is Uday's, through `apps-script/deploy.mjs` (dry run first). Where this section differs from
the plan above, **this section is what the code does**.

### What changed against the plan

- `leaveDays` was split in two, because Emergency Leave covers days but charges none: **`workingDays`** (working days covered) and
  **`deduction`** (leave days charged: Casual and Single 1 per day, Half 0.5, Short 0.33, Late 0.25, Special Day 2 or 3 by notice, Emergency 0).
- An eighth column, **`leaveNote`**, stores the filing warnings (Long Leave, sandwich rule) so the decider sees them on the request.
- `dayPart` also takes `late`. Late is stored (type, date) but never returned by the contract.
- Columns on the Approvals sheet, sheet columns 26 to 33 (0-based 25 to 32), written inside the submit lock, header self-created:
  `leaveType, fromDate, toDate, dayPart, workingDays, deduction, noticeDays, leaveNote`. Dates are stored as text `YYYY-MM-DD`.
- New file `apps-script/approvals-leave.gs` (PDR project, in `projects.json`); small hooks in `approvals.gs`; `main.gs` routes `approvedleave`.
- The category is mirrored in the Teacher portal, the Coordinator Systems > Approvals page and the principals' page; the principals' request
  form does not offer it (the server also refuses it from non-teachers).
- Filing rules enforced on the server: future date, or today before 7:00 AM IST; Half, Short, Late and Special Day are single-day; an overlap
  with the same teacher's open or approved leave is refused, an identical repeat is a no-op (double-click safe).
- The approver seam is `aprCanDecideRow_` with an empty `APR_LEAVE_PRINCIPAL_TYPES`; nothing changes for Management.
- Not built (later): P5 rules (10% cap / Double Leave, Special Day tier from the calendar, CL balance, same-role overlap) and P6 (Payroll prefill).

### The contract the Teacher game reads

Two ways in, same data:

1. **HTTP (any signed-in caller, scoped):** `GET <PDR /exec>?action=approvedleave&from=YYYY-MM-DD&to=YYYY-MM-DD&idToken=...[&email=][&campusId=]`.
   A teacher gets only their own days (their `email` is forced), a Principal their campus, Owner/Coordinator anyone. At most 400 days per call.
2. **Server code in the PDR project (Teacher game backend, teacher-portal.gs):** `aprApprovedLeaveDays_(email, fromISO, toISO)`, the same list, no
   HTTP and no scoping, so call it only for a person you already decided to show.

Response: `{ success: true, days: [ ... ] }`, sorted by date then email, one entry per **working day** of **Approved** leave in the window:

```
{ date: '2026-10-29',        // working days only: Sundays, 2nd Saturdays and the school's "GH" calendar holidays are never returned
  fraction: 1,               // share of the day away: 1 (full), 0.5 (Half Leave), 0.33 (Short Leave)
  excused: true,             // the game's yes/no: true for Casual, Single, Emergency, Special Day, Half Leave; false for Short Leave
  type: 'Casual Leave', approvalId: 'apr-...', email: 'asha@lms.org.in', campusId: 'LMS4', employeeCode: 'KUL/..' }
```

Rules the game can rely on: Pending, Rejected and Revoked requests never appear; **Late is never returned** (a Late day is a normal working day);
the reason text is never returned; a day with no entry is a normal working day. For "days on track": skip a day if it has an entry with
`excused: true`; a Short Leave entry (`excused: false`) leaves the day as an ordinary working day. Revoking an approval removes its days on the
next read, so cache by short TTL, not forever.

Server readers in other Apps Script projects can read the Approvals sheet directly: category (index 2) = 'Leave', status (13) = 'Approved',
requester email (11), campus (1), and the leave columns at indexes 25 to 32 (`APR_LV_COL` in approvals-leave.gs is the single definition).

### Before this goes live

1. `node apps-script/deploy.mjs pdr` (dry run), then `--push --deploy "teacher leave"`, then `node tests/verify.mjs --live`.
2. The Coordinator project's `coordinator.gs` maps categories to departments (`COORD_APPROVAL_DEPT`): add `'Leave': COORD_DEPT_HR` so
   leave follow-ups do not land in School Operations (a one-line change in the Coordinator project, separate from this branch).
3. Try one teacher request end to end (file, see it on Coordinator > Systems > Approvals, approve, read it back through `approvedleave`).
