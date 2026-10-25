# Teacher leave in Approvals (design and plan)

Date: 2026-10-25. Asked for by Uday ("Leave into Approvals", Q6 of the Teacher game design), routed through the LMCS
Master Agent. **Status: plan only. Nothing here is built or deployed until Uday approves it.** Everything below is
Claude's recommendation and open to his correction; his answers get recorded in the last section.

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
a **Leave type** from the requested group above: Casual, Compensatory, Single (unpaid), Half day, Short, Special Day
absence, Emergency. Absent / Late / Non-Compliance / Double are never offered; they stay in Payroll's monthly template.
The existing **Compensatory Leave** category stays as it is today (a Principal asking for days off for the school); a
teacher taking a comp-off day uses Leave > Compensatory.

Teachers may submit `Leave` in addition to `Compensatory Leave` and `Other` (`APR_TEACHER_CATEGORIES`).

### 2. Data shape (one source of truth, no second sheet)

Add self-creating columns on the Approvals sheet, after the existing follow-up columns (same pattern as `referredTo`,
`archived`, follow-up):

| Column | Meaning |
|---|---|
| `leaveType` | one of the types above |
| `fromDate`, `toDate` | ISO `YYYY-MM-DD`, inclusive; same day for a half or short leave |
| `dayPart` | `full`, `half`, `short` |
| `leaveDays` | **computed on the server**: working days in range (Sundays, 2nd Saturdays and calendar holidays removed) x weight |
| `noticeDays` | computed: `fromDate` minus the submit date (drives Special Day tier, and flags same-day requests) |

The teacher's email is already in `requestedBy`; Management's decision, note and time are the existing columns.

### 3. The contract other modules read

One read action on the PDR backend, `approvedleave`, plus a pure function other `.gs` files in the project can call:

```
approvedLeaveDays(email, fromISO, toISO) ->
  [{ date: 'YYYY-MM-DD', fraction: 1 | 0.5 | 0.33, type: 'Casual Leave', approvalId: 'apr-...', employeeCode: '...' }]
```

- **One entry per calendar day**, so the Teacher game never does its own range maths.
- Only requests with status **Approved** (Revoked and Rejected never appear), not archived-filtered.
- `fraction` is how much of the day is on leave: a full-day leave is 1, a half leave 0.5, a short leave about 0.33.
  The game decides how a partial day counts toward "days on track" (open question 4).
- Server callers in other Apps Script projects (Coordinator, game backend) read the sheet directly with the
  same column positions, as `coordinator.gs` already does for approvals; the contract is documented in code next to the columns.
- A caller sees only their own leave, their campus (Principal), or everyone (Owner/Coordinator), the same scoping as `aprList_`.

### 4. Who approves (needs Uday's decision; biggest change)

Today only the Owner and a Coordinator with `CanApprove` decide anything. The bye-laws put the first approval with the Principal.

- **A (recommended): Principal approves routine leave, Management approves the rest.** A campus Principal can decide
  `Leave` requests for **their own campus's teachers**: Casual, Single, Half, Short, Emergency. **Compensatory, Long Leave
  (over 6 working days), Special Day, and a same-role overlap** go to Management (Owner / delegated Coordinator) with the
  Principal's recommendation recorded first. Matches the bye-laws; keeps Management's queue short.
- **B: everything to Management.** Simplest to build; Management would see every teacher's leave across six schools.
- **C: Principal approves everything, Management only sees Compensatory and Long Leave.** Lightest for Management; looser than the bye-laws.

Implementation under A: a narrow `aprCanDecideLeave_(caller, row)` check (Principal, own campus, category Leave, type not
escalated); `aprCanDecide_` is unchanged for every other category. The decision is still recorded with the decider's own
email, so accountability is kept.

### 5. Rules checked in v1 versus later

| v1 (this build) | Later (needs data we don't hold in Approvals) |
|---|---|
| Valid dates, `toDate >= fromDate`, no past dates beyond a grace period | 10% cap / auto Double Leave (needs each branch's teacher headcount by day) |
| Working-day count excluding Sundays, 2nd Saturdays and calendar holidays | Special Day tier from the campus special-day calendar |
| Overlap guard: same teacher, overlapping Pending/Approved dates is refused (extends the existing duplicate guard) | CL balance and the 31 March lapse (the balance lives in Payroll's Owner-only backend) |
| Long Leave auto-flag (over 6 working days) and sandwich note shown to the decider | Same-role overlap check |
| Same-day request after 7:00 AM IST is labelled "late notice: may be recorded as Absent" | Prefilling Payroll's leave counts from approved leave |

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
4. **P3, approver scope** per the chosen option, with escalation rules.
5. **P4, consumers:** hand the contract to the Teacher game; Payroll prefill as a separate piece later.
6. **P5, later rules** from the table above, one at a time.

Deploy only through `apps-script/deploy.mjs` (dry run first), then `node tests/verify.mjs --live` and a browser check.
Target: P1 to P3 in November 2026, so the game has real data before the February 2027 pilot.

## Risks

- **Approver scope** is the only change that touches existing permissions; it is narrow, own-campus and `Leave`-only.
- **`approvals.gs` global scope:** a duplicate top-level name breaks the whole PDR deployment; `verify.mjs` compiles every
  file, and the plan adds a collision check to the tests.
- **Leave records are personal data** (reason text can be medical); the contract exposes dates and type, never the reason.

## Open questions for Uday (asked one at a time, answers recorded below)

1. Who approves teacher leave: A, B or C above? (recommend A)
2. One "Leave" category with a type dropdown, or separate categories? (recommend one)
3. Which types can a teacher request: Casual, Compensatory, Single, Half, Short, Special Day, Emergency? (recommend all seven)
4. In "days on track", does a half-day leave excuse the whole day or half of it? (recommend: the whole day, so a teacher is never penalised)
5. Can a teacher file leave for a past date or the same day? (recommend: same day until 7:00 AM, past dates only by a Principal on their behalf)
6. Should approved leave later prefill Payroll's monthly leave counts? (recommend yes, as a separate step after the game)

## Uday's decisions

_None yet._
