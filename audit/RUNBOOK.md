# Monthly payroll runbook (one page)

Salary Dashboard → 📋 Monthly Payroll (Owner only). Do this for each month, ideally a
few days before the 8th (lock deadline) so there's time to fix anything the Data
quality view or a warning banner flags.

## 1. Open the month
Type the month, click **Open month**. The status strip shows staff count, gross,
net, bank transfer, CTI, and (once ERP data exists for it) the vs-ERP comparison.

## 2. Work the checklist, top to bottom
Each card shows **To do** until it's ticked; locking a school needs every step
ticked for it (or for "ALL schools").

1. **Staff changes** — review joiners/offers, leavers, transfers, and anyone the
   Roster shows as inactive/transferred but still on payroll. Join offers, mark
   leavers, apply transfers here before anything else — paid days for everyone
   else assume no change happened mid-month.
2. **Leave & paid days** — download the Excel template, fill it from the ERP/
   attendance register, upload it. It sets paid days automatically; only touch
   paid days by hand for someone not covered by the template.
3. **Adjustments** — one-offs: arrears, advances/loan recovery, TDS, bonuses,
   fines, etc. Pick the employee, type, amount, note. Corrections to an already
   *locked* month go in as an Adjustment on the next open month, not a reopen.
4. **Holds** — F&F holds (someone leaving) or grievance holds (withheld pending
   resolution); release an earlier grievance hold's amount here too.
5. **Review** — read the by-school table and any warning banner (missing rates,
   missing Date of Joining, zero Full Basic, orphaned inputs) before locking.
6. **Lock** — locks a school (or every unlocked school at once). Locking writes
   the Payroll Register, a Run Log row, and the RRF/held-salary/loan-recovery
   ledger entries. **A locked school can't be edited** — corrections become next
   month's Adjustments. Locked the wrong school by accident? Use **Unlock** (only
   works if no *later* month is already locked for that school).

## 3. Other views (top bar)
- **Outputs** — bank letter, salary sheet, pay slips, EPF ECR, ESI file. Needs
  the school locked first for the bank letter.
- **Accounts & loans** — RRF/Security/Loan balances, issue a salary advance or
  RRF loan (bye-law limits are enforced: RRF loan ≤ 70% of balance, once per
  2 years).
- **Full & Final** — for anyone marked left: statement, then settle.
- **Opening balances** — one-time Tally import (already done for 31-Aug-2026).
- **Data quality** — run this *before* locking a school for the first time each
  month, and whenever new staff join: flags missing bank account/IFSC, an EPF
  member with no UAN, missing PAN, missing ESI number, and anyone whose
  Employee Code doesn't match between Salary Master and the Roster's
  EmpKeyNumbers (the bank letter/ECR/ESI outputs silently skip those people).

## Known limits
- Payroll is Owner-only; Principals/Coordinators only submit salary offers
  (Offer Calculator → Record as Salary Offer).
- Still running in parallel with the ERP — compare net pay there until it's
  consistently exact, then retire the ERP for payroll.
- The Tally journal export isn't built yet (waiting on ledger names from Pawan
  Sir); everything else in Outputs is ready.
- If two actions land within the same minute (e.g. join someone then
  immediately add their first adjustment), reload the month view once if
  anything looks stale — see `audit/REPORT.md` for the cache-race fix that
  mostly covers this, but a manual reload is always safe.
