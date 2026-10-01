# Overnight audit report — LMCS Portal payroll

Branch: `overnight-audit` (from `main` @ 80cb2d3). Scope per Uday (2026-10-01): **sections
1–3 only**, section 4 (stress test) skipped. No pushes to main, no Apps Script deploys, no
Sheet edits, no deletions, no real salary data anywhere in this branch — everything below
was built and verified against a small fake fixture (`tests/payroll/fixtures.js`).

Commits on this branch: see `git log main..overnight-audit`. Nothing here is live yet —
deploying `apps-script/payroll.gs` and pushing `payroll/index.html` is a separate step,
same as every other payroll change this cycle.

---

## Section 2 — code audit findings (ranked by severity)

### 1. HIGH (fixed) — stale staff-changes cache after back-to-back writes
**Evidence:** `payStaffChanged_()` busted its cache using `Date.now()` as the "generation"
token. Writing the new test suite caught this directly — the exact flow "record an offer,
then immediately join it" (a normal single sitting of work) was flaky: about 1 run in 3,
the `joinoffer` response's staff list still showed the offer as pending and `joiners: []`,
because `joinoffer`'s own cache-bust landed in the same millisecond as `recordoffer`'s,
producing an identical cache key and serving the stale pre-join snapshot.
**Impact:** after joining an offer, marking someone left, or applying a transfer, the
Staff changes card could keep showing the old state (offer still pending, leaver still
listed) until something else happened to bust the cache a second time. Didn't affect the
Payroll Register or pay — only the staff-changes *display* reads this cache.
**Fix:** [payroll.gs:1052](apps-script/payroll.gs) — generation token is now a counter
(`cache.get + 1`), not a timestamp; safe because every caller already holds the script
lock. Verified stable over 8 repeat test runs after the fix (was failing ~1 in 3 before).
**Regression test:** `tests/payroll/test-flows.js` → "staff changes: joiner via offer...".

### 2. MEDIUM (fixed, unverified live) — the open "adjustment didn't appear" bug
**Evidence:** reported live: added an Arrears adjustment, got a success message, net pay
didn't change. Not reproducible in the test harness — `payAddAdjustment_` and `payCompute_`
read it back correctly in every case tried, including with a locked neighbouring school.
**Most likely cause:** `call_()` in `payroll/index.html` had no protection against two
requests being in flight, and no guarantee from `fetch`/Apps Script that responses arrive
in the order they were sent. A fast double-click, or a slow network reordering two
responses, lets an *older* response land after a newer one and silently overwrite `M` —
exactly "it said success but the page doesn't show it."
**Fix:** [payroll/index.html](payroll/index.html) — a request sequence number; only the
most recently *issued* request's response is ever applied to `M`, every older one is
dropped as stale. Also disabled the action buttons while a save is in flight (quick win,
also closes the double-click itself, not just its symptom).
**Caveat:** this is the standard fix for this class of bug and costs nothing on the happy
path, but it wasn't reproduced live, so treat it as "should be fixed" rather than
confirmed. If it recurs, check the browser Network tab for two in-flight requests to the
same action next time.

### 3. MEDIUM (action needed from Uday, not fixable in code) — Sheet IDs are public
**Evidence:** `PAY_SHEET_ID`, `PAY_RATES_SHEET_ID`, `PAY_ALLOWLIST_SHEET_ID`,
`PAY_ROSTER_SHEET_ID`, `PAY_APPROVALS_SHEET_ID` are hardcoded in `apps-script/payroll.gs`,
which is committed to the **public** `kanwaruday/LMCSManagement` repo. The Apps Script
backend itself is sound — every write/read action re-verifies the caller's Google ID token
against the Allowlist sheet on every call, so an attacker can't get real data *through the
web app* without being on the Allowlist. The risk is a different door: anyone who finds
these IDs in the public repo (and git history keeps them even if later removed) can try
opening `https://docs.google.com/spreadsheets/d/<id>` directly. That only exposes data if
the Sheet's own sharing is "Anyone with the link," which would bypass the backend's auth
entirely.
**Action:** please check (or have IT check) that the Payroll sheet, PayRoll Rates/
PayScale, Allowlist, Employee Roster, and Approvals sheets are all shared only with named
people/the deploying account — not "Anyone with the link," even as a viewer. I can't check
or change Drive sharing settings from here. This was true before this audit too; nothing
in this branch makes it better or worse, but it's worth closing given the repo is public.

### 4. LOW (informational, no fix needed)
- `PAY_READ_ACTIONS_` ([payroll.gs:122](apps-script/payroll.gs)) is defined but never
  read — the actual dispatch is a hand-written `if/else` chain. Harmless dead code.
- Growth to 300 staff / 36 months: already handled well. Every tab is read once per
  request (`PAY_MEMO`/`PAY_BOOKS`) regardless of month, so growth costs JS array-filter
  time, not extra network round trips — at ~10,000 rows in the biggest tabs (Payroll
  Register, Ledger) that's milliseconds, nowhere near the 6-minute execution cap. The
  `payStaffSafe_` cache already guards the 100 KB `CacheService` value limit explicitly.
  No action needed now; if it ever gets materially slower, archive pre-prior-year rows out
  of the hot tabs into a separate sheet.
- `salary/index.html`'s EPF-exemption status lines interpolate the typed candidate name
  into `innerHTML` unescaped (around line 517–520). The name comes from the same person's
  own text field, not from shared data, so it's self-XSS at worst — not fixed, noted for
  completeness.

---

## Section 3 — delivered

### Permanent test suite
`tests/payroll/` — **one command**: `node tests/payroll/run.js` (no setup, no network, no
live credentials). Runs the real `apps-script/payroll.gs` + `payroll-calc.gs` under Node
via `vm`, in Apps Script's own load order, against fakes of SpreadsheetApp/CacheService/
LockService/Utilities/UrlFetchApp/ContentService, over a 10-person/7-school fake fixture
(`fixtures.js` — no real names, codes, salaries, or bank details; safe in this public
repo). **14/14 passing.** Covers: the payroll-calc self-tests, checklist/lock/unlock,
adjustments, holds + release, the leave-template upload (vacation rules, aliasing,
balances), staff changes (offer → joiner, leaver, transfer, duplicate-code flag), opening
balances / loans / accounts / gratuity / F&F, and the new data-quality report. This is
also what caught finding #1 above.

### Data-quality report
New `dataquality` action + a **Data quality** view in the Monthly Payroll page
(`payDataQuality_` in [payroll.gs](apps-script/payroll.gs)). For every active employee in
a month: missing bank account/IFSC, an EPF member with no UAN on file, missing PAN, no ESI
number at an ESI-registered entity, a duplicate Employee Code in Salary Master, and —
probably the most useful one — an Employee Code that Salary Master has but the Roster's
EmpKeyNumbers doesn't, which today means the bank letter/ECR/ESI file **silently skip that
person** with no warning. Run it before locking a school for the first time each month.

### Runbook
[audit/RUNBOOK.md](audit/RUNBOOK.md) — one page, the checklist steps in order plus the
other views and current known limits (ERP still running in parallel, Tally journal not
built, Owner-only).

### Speed fixes (from the earlier Salary Dashboard discussion)
- **Fix 3 (cache recordoffer sign-in) — done.** `payVerifyStaff_` did a tokeninfo round
  trip + full Allowlist read on every "Record as Salary Offer" click, uncached. Added the
  same 5-minute cache every other action already gets (`payCachedStaff_`).
- **Fix 2 (payroll copy in parallel on Record) — already done,** found already implemented
  in `salary/index.html`: `savePayrollOffer_` already runs concurrently with
  `submitapproval`, not after it. No change needed.
- **Fix 1 (preload the staff list) — still open.** I couldn't recover the exact proposal
  from the prior session (it predates this session's transcript) and didn't want to guess
  and fix the wrong thing. Please remind me what this referred to, or I'll re-derive a
  proposal fresh next time.

---

## Section 1 — UX, lighter-touch than planned

Budget went mostly into sections 2–3 (the real bug + the test suite that found it seemed
higher-value than re-walking flows that already got a full checklist redesign earlier this
same work cycle). What's here:

**Current flow depth** (the checklist redesign from earlier this cycle, not a new change):
open month (1 click) → pick a step card (1 click) → act (1–3 inputs, 1 click to submit) is
the shape of every flow below. This is already a big reduction from the original
multi-tab-spreadsheet-style Stage 1/2 interface it replaced.

| Flow | Clicks (open → act → confirm) |
|---|---|
| Add an adjustment | 2 (card + employee pick, inline type/amount) + 1 submit = 3 |
| Hold / release | 2 + 1 submit = 3 |
| Upload leave template | 2 (download, then upload) + 1 confirm = 3 |
| Join an offer | 1 (staff card) + 1 (Join) = 2 |
| Mark someone left | 1 + enter date + 1 = 2 |
| Lock a school | 1 (after all 5 steps ticked) |
| Unlock | 1 |
| Record a salary offer → it reaches payroll | 1 (Record button on the Offer Calculator) |

**Quick wins implemented this session** (both land as defense alongside the section-2
fixes above, not purely cosmetic):
- Buttons disable while a save is in flight — closes the double-click that contributes to
  finding #2.
- The request-sequence guard in `call_()` is itself a UX correctness fix: the page can no
  longer show a stale state after a save.

**Not done:** full before/after screenshots and a flow-by-flow walkthrough of every listed
flow (joiner, transfer, F&F, opening balances, outputs) with alternative redesigns. If
you want that properly, it's worth its own session with the live page open rather than
folding it into an overnight budget already spent on sections 2–3.

---

## 5-line morning summary

1. **Real bug fixed:** the staff-changes cache could go stale right after joining an
   offer / marking someone left / a transfer — now a counter, not a timestamp; the new
   test suite catches a regression of this.
2. **Likely fix for your "adjustment didn't appear" report:** responses are now
   sequence-guarded so an older save can never overwrite a newer one on screen — not
   independently reproduced live, so watch for it once more.
3. **New:** a permanent test suite (`node tests/payroll/run.js`, 14/14 green) and a Data
   Quality view in Monthly Payroll (missing bank/UAN/PAN/ESI, code mismatches vs. the
   Roster) — run it before your first lock each month.
4. **Needs your action, not code:** please confirm the Payroll/Rates/Allowlist/Roster/
   Approvals Google Sheets are *not* link-shareable — their IDs are in the public repo.
5. **Still open:** "preload the staff list" speed fix (lost the original spec, didn't want
   to guess), and a fuller Section 1 UX pass with screenshots if you still want it.
