# Day Book v2, Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the live Office day book into one ledger for every rupee: money accounts (cash / bank / credit), the school each entry is accounted to, a clean category list, a vehicle on every transport line, credit bills and settlements, fuel fills with litres + odometer + bill photo, and an Accounts role for Tilak Sir, with an Accounts screen showing owed-to-suppliers, account balances and per-school totals.

**Architecture:** Extends the existing Office Apps Script backend (`apps-script/office*.gs`, Sheets books per campus per FY + Config book) and the `office/` PWA. New DayBook columns are appended to existing live tabs (never rewriting headers). Categories become a code constant (source of truth); accounts and vehicles live in Config tabs. Old rows keep working through defaulting helpers.

**Tech Stack:** Apps Script (V8) + Google Sheets/Drive; static ES-module pages; node tests (`tests/office/`, harness `tests/office/harness.js`); deploy with `node apps-script/deploy.mjs office --push --deploy "msg"`.

**Spec:** `docs/superpowers/specs/2026-10-22-daybook-v2-transport-ledger-design.md` (sections 1-5, 7, 10-13 are phase 1). The Office base design and its rulings still bind: `docs/superpowers/specs/2026-10-21-campus-office-portal-design.md`.

## Global Constraints

- Append-only records; a correction is a reversal. Text-stored cells (`setNumberFormat('@')`). Integer paise for money.
- Every write is idempotent by client `id` (outbox). Role and campus are checked server-side in `officeHandle_`.
- New DayBook columns, appended in this exact order after `created_by`: `account, charged_to, vehicle, litres_ml, odometer_km, odometer_note, supplier_bill_no, settles_account, settles, source, legacy_category, mapped_by`.
- Existing rows with blank new fields mean: `account` = `cash:<campus>` if mode is cash else `bank:<campus>`; `charged_to` = campus; `source` = `live`.
- Account ids: defaults `cash:<CAMPUS>` and `bank:<CAMPUS>` exist for every campus in `OFFICE_CAMPUSES` without being stored; added accounts get a client id. Kinds: `cash`, `bank`, `credit`.
- `charged_to` values: `LMS1`..`LMS6`, `HES`, `CHAIRMAN`.
- Vehicle values: a `reg` from the Config `Vehicles` tab (normalised upper-case, no spaces/dashes) or `FLEET`.
- Day close freezes cash-account rows only; bank, UPI and credit rows are never blocked by a closed day.
- Credit-account rows are expenses when incurred; `credit_settlement` rows (bank account, `settles_account` = a credit account) are movements, never expenses.
- Fee Clerk / Admin Manager: own campus, cash account, and credit bills only for categories with `needs_vehicle`; no bank rows, no settlements. FinanceHead, Accounts, Owner: any kind.
- `Accounts` role (Tilak Sir): treated as FinanceHead with campuses `ALL` by the office backend only.
- Every new error code has plain words in `office/js/codes.js` (the scan test enforces it).
- Public repo: fake data only in tests. Run `node tests/verify.mjs` before each commit (only the known datasrc stale-exemption failure is allowed, if present).

## Review Focus

1. A Fee Clerk sends a `bank:` or another campus's account, or a `credit_settlement`: refused (`FORBIDDEN_ACCOUNT`), never written (Task 4).
2. A fuel fill whose odometer is lower than the vehicle's previous fill: refused with `ODOMETER_BACKWARDS` unless `odometer_note` explains it (Task 4).
3. A pump bill entered as credit and later settled from the bank: counted once as an expense; owed-to-supplier drops to zero; bank drops (Task 6).
4. Late bank/credit rows dated into a closed day are accepted while a cash row on the same day is still refused `DAY_CLOSED` (Task 4).
5. Live books created before this change (old 14-column DayBook header, 7-column Opening, 3-column Categories) keep reading and writing correctly after the header migration (Task 1).

---

### Task 1: Store migration (append missing columns) and new tables

**Files:** Modify `apps-script/office-store.gs`, `apps-script/office-config.gs` (seed headers only), `tests/office/harness.js` (if needed); Test `tests/office/test-store.js`.

**Interfaces:** Produces `OFFICE_TABLES.DayBook` (with the 12 appended columns above), `OFFICE_TABLES.Opening` + `account` appended; Config tabs `Accounts(id,label,kind,campus,active,created_at,created_by)` and `Vehicles(reg,label,kind,campus,active,created_at,created_by)` created on Config open; `officeEnsureHeader_(sheet, columns)` (appends missing trailing columns; throws `HEADER_MISMATCH` if the existing header is not a prefix of `columns`); `officeCell_` returns Number for columns ending `_ml` or `_km` (blank stays '').

- [ ] Step 1: tests `old 14-column DayBook gains the 12 columns at the end and old rows read with blanks`, `a header that is not a prefix throws HEADER_MISMATCH`, `appending after migration writes every column in header order`, `litres_ml and odometer_km read back as numbers`, `Config gets Accounts and Vehicles tabs with headers`.
- [ ] Step 2: run `node tests/office/run.js` → the new tests fail.
- [ ] Step 3: implement; call `officeEnsureHeader_` from `officeOpen_` for every existing tab and from the Config open path for config tabs.
- [ ] Step 4: `node tests/office/run.js` and `node tests/verify.mjs` pass.
- [ ] Step 5: commit `feat(office): append-only header migration; DayBook v2 columns; Accounts and Vehicles config tabs`.

### Task 2: Accounts role

**Files:** Modify `apps-script/office.gs` (`officeVerifyAllowlist_`); Test `tests/office/test-auth.js`.

**Interfaces:** A caller whose roles include `Accounts` gets `roles` + `FinanceHead` (once) and `campuses = ['ALL']`.

- [ ] Steps: tests `Accounts role acts as FinanceHead on any campus` (can call `day.close` for LMS3 though its allowlist campus is LMS1), `Accounts does not gain Owner-only actions` (`day.reopen` refused); fail; implement; pass; commit `feat(office): Accounts role (FinanceHead for every campus)`.

### Task 3: Categories v2, accounts, vehicles, account openings

**Files:** Modify `apps-script/office-config.gs`; Test `tests/office/test-config.js`.

**Interfaces (Produces):**
- `OFFICE_CATEGORIES`: array of `{id, label, direction, group, needs_vehicle, pnl_column, active}` exactly as the spec section 3 lists, with these ids kept from today: `fee_collection` (label "Fee cash", group `fee`), `deposit_cash_out`, `deposit_bank_in` (group `movement`, active false for typing), `donation`, `other_in`, `other_out`; `petty_expense` and `bill_payment` active false. New ids: `fee_online`, `fee_cheque` (active false: ERP-imported later), `student_collection`, `transport_income`, `stationery`, `postage_courier`, `travel_errands`, `cleaning_housekeeping`, `snacks_pantry`, `activities_events`, `exams_board`, `utilities`, `repairs_hardware`, `labour_wages`, `medical_first_aid`, `security_refund`, `salary_advance`, `govt_legal`, `chairman_personal`, `fuel`, `vehicle_service`, `tyres`, `vehicle_insurance`, `vehicle_tax_permit`, `parking`, `challan`, `loan_interest`, `loan_principal`, `driver_travel`, `credit_settlement`, `cash_transfer`. `group` ∈ `fee, income, school, transport, movement`; transport ones have `needs_vehicle: true` and `pnl_column` ∈ `fuel, service, insurance, taxes, parking, challan, loan_interest, loan_principal, other, income`.
- `officeCategory_(id) -> category | null` (looks up `OFFICE_CATEGORIES`; the Config Categories tab is no longer read).
- `officeAccounts_() -> [{id, label, kind, campus, active}]`: the default `cash:<C>` ("<C> cash") and `bank:<C>` ("<C> bank") for every campus plus Config `Accounts` rows. `officeAccount_(id) -> account | null`.
- `officeVehicles_() -> [{reg, label, kind, campus, active}]` from Config `Vehicles`; `officeNormReg_(s) -> string` (upper-case, strip spaces, dots and dashes).
- Actions: `config.get` now returns `{categories, accounts, vehicles, limits, campuses}`; `account.add` (roles FinanceHead, Owner; data `{id, label, kind: 'bank'|'credit', campus}`; `BAD_KIND`, `LABEL_REQUIRED`), `vehicle.add` (FinanceHead, Owner; `{reg, label, kind: 'bus'|'jeep'|'car'|'van', campus}`; duplicate reg is a no-op `duplicate:true`), `vehicles.import` (FinanceHead, Owner; `{vehicles:[{reg,label,kind,campus}]}`; adds missing regs only, returns `{added}`), `account.opening` (FinanceHead, Owner; `{id, campus, account, amount_paise}`; amount ≥ 0 integer; `ACCOUNT_OPENING_EXISTS` if that account already has an opening; writes an Opening row with `account` set and mode from kind). Config writes take the script lock (write: true).

- [ ] Steps: tests for each action (roles, codes, defaults list has 14 accounts for 7 campuses, `officeNormReg_('hp 66-5805') === 'HP665805'`, import adds only missing, opening once per account); fail; implement; pass; commit `feat(office): categories v2, money accounts, vehicles, account openings`.

### Task 4: daybook.add / reverse v2

**Files:** Modify `apps-script/office-daybook.gs`, `apps-script/office-close.gs` (no behaviour change except callers); Test `tests/office/test-daybook.js`, `tests/office/test-close.js`.

**Interfaces:**
- Consumes Task 3 helpers. Produces `officeRowAccount_(row) -> accountId` and `officeRowChargedTo_(row) -> campus` (defaults per Global Constraints), exported for reports.
- `daybook.add` data adds `account` (required), `charged_to` (default campus), `vehicle`, `litres` is sent as `litres_ml` (integer > 0), `odometer_km` (integer ≥ 0), `odometer_note`, `supplier_bill_no`, `settles_account`, `settles`. `mode` is derived: cash account → `cash` (bucket required as today); bank account → `bank` or `upi` (client sends `mode`); credit account → `credit` (no bucket).
- Validation codes: `BAD_ACCOUNT` (unknown/inactive, or account.campus ≠ data.campus), `FORBIDDEN_ACCOUNT` (role/kind rules), `BAD_CHARGED_TO`, `CATEGORY_INACTIVE`, `VEHICLE_REQUIRED`, `BAD_VEHICLE`, `LITRES_REQUIRED`, `ODOMETER_REQUIRED`, `FILE_REQUIRED` (fuel needs `file_id`), `ODOMETER_BACKWARDS` (odometer lower than the highest earlier fuel odometer for that vehicle across `officeRecentBooks_`, unless `odometer_note` is non-empty), `SETTLEMENT_ACCOUNT_REQUIRED` (credit_settlement needs a bank account and a credit `settles_account`), `NOT_A_SETTLEMENT` (settles_account on another category). `credit` accounts only with OUT categories in groups `school`/`transport`.
- The day-close guard runs only for cash-account rows.
- `daybook.reverse` copies every new field from the original.
- `officeBalances_` ignores `credit` rows (credit is not cash or bank).

- [ ] Steps: tests covering every code above, Review Focus 1, 2 and 4, a reversal keeping account/vehicle/charged_to, an old-style row (no account) still balancing as cash; fail; implement; pass; commit `feat(office): day book v2 entries (accounts, charged_to, vehicles, fuel, credit, settlements)`.

### Task 5: Deposits name a bank account

**Files:** Modify `apps-script/office-deposits.gs`; Test `tests/office/test-deposits.js`.

**Interfaces:** `deposit.add` accepts `bank_account` (default `bank:<campus>`; must be a bank account of that campus → `BAD_ACCOUNT`); legs carry `account` (`cash:<campus>` / the bank account) and `charged_to` = campus. `officeFeeCashByDate_` unchanged (`fee_collection`).

- [ ] Steps: tests `legs carry accounts`, `default bank account`, `another campus's bank refused`; fail; implement; pass; commit `feat(office): deposits name the bank account`.

### Task 6: Ledger summary

**Files:** Create `apps-script/office-ledger.gs` (add to `projects.json` office files after `office-setup`); Test `tests/office/test-ledger.js`.

**Interfaces:** Action `ledger.summary` (roles FinanceHead, Owner, Principal, Coordinator; data `{campus: 'LMS1'|..|'ALL', from, to}` within one FY else `RANGE_SPANS_YEARS`; `ALL` needs campuses ALL else `FORBIDDEN_CAMPUS`; books missing for a campus are skipped). Returns:
`{byChargedTo: {school: {category: paise}}` (IN positive, OUT negative; groups fee/income/school/transport only),
`accounts: [{id, label, kind, campus, balance_paise}]` (cash: opening + in − out incl. buckets; bank: account opening + in − out; credit: `owed_paise` = account opening + credit OUT bills − settlements naming it − reversals),
`interSchool: [{from: accountCampus, to: chargedTo, paise}]` where they differ,
`vehicles: {reg: {pnl_column: paise}}`, `fuel: {reg: [{date, litres_ml, odometer_km, amount_paise}]}`}.
Reversed rows net out (a reversal is the opposite direction with the same fields).

- [ ] Steps: tests incl. Review Focus 3 (credit fuel 5000 then settlement 5000 → transport fuel −5000 once, owed 0, bank −5000), LMS1 cash charged to HES appears in byChargedTo.HES and interSchool, a reversed entry nets to zero; fail; implement; pass; commit `feat(office): ledger summary (per school, accounts, owed, vehicles, fuel)`.

### Task 7: Day Book screen v2

**Files:** Modify `office/js/daybook.js`, `office/daybook.html`, `office/js/codes.js`, `office/sw.js` (bump `CACHE`); Test `tests/office/test-daybook-view.js`, `tests/office/test-attention.js` (code scan already enforces codes).

**Interfaces:** Pure helpers exported and tested: `formAccounts(accounts, session, campus) -> accounts` (clerks/AdminManager: `cash:<campus>` + credit accounts of the campus; FinanceHead/Accounts/Owner: all active accounts of the campus), `categoriesFor(categories, accountKind, roles) -> grouped list` (active only; credit kind → OUT school/transport; clerks never see `credit_settlement`), `entryPayload(form) -> data` (rupees → paise; litres "12.5" → 12500 ml, max 3 decimals, > 0; odometer integer; mode from account kind; bucket only for cash). UI: account select, charged-to select (campuses + "Chairman (personal)", default campus), grouped category select, vehicle select (`FLEET` = "Shared / whole fleet") when `needs_vehicle`, litres + odometer + odometer note + bill photo (reuse `office/js/image.js` resize and the `file.upload` → `daybook.add` outbox order used by deposits) when category is `fuel`, supplier bill no when account is credit, settles-account + settles when `credit_settlement`. The list shows account, charged-to and vehicle. Text-only rendering (`dom.js`).

- [ ] Steps: helper tests (litres parsing edge cases: "0", "-1", "12.3456" rejected; clerk never gets bank accounts or settlement); fail; implement; pass; browser check at 375 px with a fake session and throwaway fake backend; commit `feat(office): day book v2 form`.

### Task 8: Accounts screen

**Files:** Create `office/accounts.html`, `office/js/accounts.js`; Modify `office/index.html` (nav link shown only to FinanceHead/Accounts/Owner via shell session roles), `office/sw.js`, `tests/datasrc/test-datasrc.js` (exempt the new page with OFFICE_REASON); Test `tests/office/test-accounts-view.js`.

**Interfaces:** Screen sections: add bank / credit account; set an account's opening; vehicles list + "Import buses from Transport" (client fetches the Coordinator backend `coordinatortransport` with the session token, maps fleet rows to `{reg, label: bus no + route, kind: 'bus', campus}` and posts `vehicles.import`; Coordinator URL read from `coordinator/shared.js`'s `BACKEND_URL` constant exposed on `window.Coord` or duplicated in `office/js/config.js` as `COORD_BACKEND_URL`) + add vehicle (jeep, Innova, Force, Cruiser); summary from `ledger.summary`: owed to suppliers, account balances, per-school totals by group, inter-school. Pure helper `mapFleet(fleet) -> vehicles` tested.

- [ ] Steps: helper tests; implement; browser check; commit `feat(office): accounts screen (accounts, openings, vehicles, summary)`.

### Task 9: Deploy and verify live

- [ ] `node apps-script/deploy.mjs office` (dry run) then, with Uday's go-ahead, `--push --deploy "day book v2"`; push `main`; `node tests/verify.mjs --live`; open the live Day Book and Accounts pages signed in (Uday) and confirm config loads; ask Uday to add `Accounts` to Tilak Sir's allowlist role cell.
