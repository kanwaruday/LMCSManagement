# Day Book v2: every rupee, every school, every vehicle (design)

Status: draft for Uday's approval, 2026-10-22. Builds on the live Fee Clerk + PRO Portal
(`2026-10-21-campus-office-portal-design.md`, Office backend in `apps-script/office*.gs`, pages in `office/`).

## Intent and the why

LMCS transport lost about Rs 16.6 lakh in six months (Apr-Sep 2026: fees Rs 54.1 L, costs Rs 70.7 L, per the
"Bus P&L" tab of `Uday's Detailed Financial Analysis/V3 Transport Management System 2026 LMCS New.xlsx`). Uday's
first step to fixing it is trustworthy financial tracking. Today:

- The day book (Google Form, one tab per campus, ~30,000 entries since 2020) shows only ~Rs 2.5 L of the Rs 70.7 L
  transport cost since April: diesel is bought on credit and paid by the accounts department from the bank, so it
  never reaches the cash day book; insurance, taxes and EMIs likewise.
- Someone retypes monthly transport figures into the workbook; months have gaps (September fuel Rs 0, August a quarter
  of normal, two buses with no driver pay) and annual costs land in one month (insurance Rs 8.9 L in April).
- Bus costs that do reach the day book are mostly filed as "Not on this List" with the bus in free text
  ("CASH(BUS 7534 WASHING, GREASING)=850"); about 15% of all entries are "Not on this List".
- No litres or odometer readings are kept centrally, so fuel efficiency per bus is unknown, although every fill
  produces a pump bill that reaches the Fee Clerk.
- LMS 1 also houses the Admin Head Quarter (HES) and sometimes pays on behalf of HES, other schools and the Chairman
  personally (about 1,200 HES, 1,100 LMS 2 and 810 "Personal" entries, Rs 17 L); these must be accounted per school.
- Uday will later allocate budgets per school per head, so history since 2020 must be kept and comparable.

The day book becomes the one ledger for every rupee, cash or bank or credit, for every school, with every transport
line tagged to a vehicle, so the bus P&L builds itself.

## Decisions already made (Uday, 2026-10-22)

| Decision | Value |
|---|---|
| Scope | All schools (LMS 1-6 and HES) live now; clerks are added by Uday to the allowlist |
| Paying for others | LMS 1 pays on behalf of HES / other schools / the Chairman; each entry is accounted to the school it belongs to |
| Accounts | Tilak Sir (Coordinator: accounts, admin, transport) enters bank and credit payments; he already has Coordinator access |
| Diesel | Bought on credit; every fill produces a bill handed to the Fee Clerk; bill and odometer can be photographed |
| Cash vs credit | Some bills are cash, some credit; both must be handled without double counting |
| Fees per bus | The ERP knows each student's route/stop; Uday will provide an export. Rates are by distance band (Transport Fees 2026) |
| GPS | Offered by Uday; deferred to a later phase (odometer from fill slips is enough for km per litre) |
| Loans | The bus P&L shows loan interest and principal |
| Non-cash fees | Online and cheque fees to be automated from the ERP export rather than typed |
| History | Import everything since 2020, for later insights and budgets |
| Vehicles | All vehicles are included: buses, jeep, Innova, Force Cityline, Cruiser |

## Goals

1. One entry form for every money movement, used by Fee Clerks (their campus cash) and Tilak Sir / Owner (bank and
   credit for any school).
2. Every entry carries: which money account it moved (campus cash, a bank account, or a supplier's credit), the school
   it is accounted to, a category from a clean list, and for transport, the vehicle.
3. Credit bills are an expense when incurred and a payable to the supplier; the later bank payment settles the payable
   and is not a second expense.
4. Fuel fills record vehicle, litres, amount, odometer and a photo of the bill (and odometer).
5. A monthly Bus P&L per vehicle, built from the ledger plus fees and payroll, with annual costs spread monthly, km per
   litre, fee per km, and flags.
6. All history since 2020 imported and mapped to the new categories, with vehicles extracted from free text where
   possible, kept distinguishable from live entries.
7. Per-school, per-category totals for any period (the base for budgets).

## Non-goals (this design)

- GPS integration (later phase).
- Re-recording ERP fee receipts by hand (they come from the ERP export).
- Payroll changes: driver and helper pay is read from the portal's Monthly Payroll / Man Power data, not re-entered.
- Replacing Tally; exports remain.
- Budget allocation screens (later; this design produces the data they need).

## Anti-goals

- Any rupee counted twice (credit fill plus pump-bill payment; ERP fee plus a typed fee entry; an LMS 1 payment for
  HES counted in both schools).
- A transport cost that cannot be traced to a vehicle (or to an explicit "fleet / shared" line).
- Imported history mixed indistinguishably with live entries, or history that changes live balances.
- Breaking the live portal's guarantees: append-only rows, day close freeze (R36), idempotent offline queue, campus
  scoping, audit log.

## Constraints

- Existing stack and rules from the Office design and its rulings R1-R45 (see the Office plan's ledger, now in git
  history): Apps Script + Sheets (one book per campus per FY plus the Config book), text-stored cells, integer paise,
  append-only with reversals, outbox ids, role/campus checks server-side.
- Campus books already exist and are live (created by `officeSetup`), so new columns must be added to existing tabs
  without rewriting their headers or rows: missing columns are appended at the end of the header row.
- The current `DayBook` columns: `id, campus, entry_date, direction, mode, bucket, category, amount_paise, payee,
  narration, file_id, reverses, created_at, created_by`. Modes today: cash (with bucket petty/fee/other), bank, upi.
- Allowlist: one campus code or ALL in column C (R40). Tilak Sir's existing row must keep working for the Coordinator
  portal; the office backend must treat his account as covering all campuses for accounts work.
- Public repo: no IDs, no real data, no real names in tests.
- LM Studio (Mac, every 2 hours via the AI Coordinator) is available for bulk reading of scans and text.

## Design

### 1. Money accounts (where the money moved)

A new Config tab `Accounts(id, label, kind, campus, active)`:

- `kind` = `cash` (a campus cash box; one per campus, buckets petty/fee/other stay as today), `bank` (a bank account,
  e.g. "LMS 1 SBI current", "HES ICICI"), `credit` (a supplier credit line, e.g. "Pump: <name>", "Workshop: <name>").
- Seeded with one `cash` account per campus. Bank and credit accounts are added by the Owner / Tilak Sir (a small
  Config screen).
- Each entry names its `account`. The existing `mode` stays for compatibility and is derived: cash account -> `cash`,
  bank -> `bank` or `upi` (the form offers both), credit -> `credit` (new mode value).

### 2. Accounted to (whose money it is)

Each entry has `charged_to` = LMS1..LMS6, HES or `CHAIRMAN`. Default = the entry's campus. LMS 1's cash paying for HES:
account = LMS 1 cash, campus book = LMS 1, `charged_to` = HES. Per-school reports sum by `charged_to`; cash balances
sum by account. An inter-school "owed between schools" view lists entries where account campus != charged_to.

### 3. Categories (clean list, Config tab `Categories` extended)

Columns: `id, label, direction, group, needs_vehicle, pnl_column, active`. `group` drives reports; `pnl_column` maps
transport categories to the Bus P&L.

Money in: `fee_cash`, `fee_online`, `fee_cheque` (ERP-imported, not typed; see 6), `student_collection` (trips, ID
cards, events), `transport_income` (cashback, scrap, hire; needs_vehicle), `donation`, `other_in`.

Money out, school running: `stationery`, `postage_courier`, `travel_errands`, `cleaning_housekeeping`,
`snacks_pantry`, `activities_events`, `exams_board`, `utilities` (electricity, internet, phone, cable, gas),
`repairs_hardware`, `labour_wages`, `medical_first_aid`, `security_refund`, `salary_advance`, `govt_legal` (stamp
papers, NOC, fees to departments), `chairman_personal` (charged_to CHAIRMAN), `other_out` (narration required).

Money out, transport (needs_vehicle, pnl_column in brackets): `fuel` [fuel], `vehicle_service` [service], `tyres`
[service], `vehicle_insurance` [insurance], `vehicle_tax_permit` (MV tax, permit, fitness, pollution, passing) [taxes],
`parking` [parking], `challan` [challan], `loan_interest` [loan_interest], `loan_principal` [loan_principal],
`driver_travel` [other].

Movement (not income or expense): `bank_deposit` (cash -> bank; the existing deposit legs), `credit_settlement`
(bank -> supplier credit account, see 4), `cash_transfer` (between campus cash boxes / HQ), `opening`.

The existing seed ids (`fee_collection`, `deposit_cash_out`, `deposit_bank_in`, `petty_expense`, `bill_payment`,
`other_in`, `other_out`, `donation`) are kept as inactive aliases so existing rows and deposit logic stay valid;
`fee_collection` maps to `fee_cash` in reports.

### 4. Credit and settlement

- A credit bill: account = the supplier's credit account, category = e.g. `fuel`, vehicle set. It is an expense of
  its `charged_to` school on its date, and increases what is owed to that supplier.
- A settlement: account = a bank account, category `credit_settlement`, `settles_account` = the supplier's credit
  account, optional `settles` = list or range of bill ids or the supplier's statement number. It reduces the bank and
  the payable; it is never an expense.
- A cash purchase is just a cash-account entry with its category: one row, no payable.
- Reports: "owed to suppliers" per credit account (bills minus settlements), and a check that each settlement matches
  bills (warn on mismatch, never block).

### 5. Fuel fills

Category `fuel` adds fields `litres` (decimal, 2 places, stored as integer millilitres), `odometer_km` (integer) and
a photo (`file_id`, same private Drive upload as deposits; slip plus odometer, one or two photos). The Fee Clerk
enters fills from the bill handed over (account = the pump's credit account; Fee Clerks may record credit bills for
their campus's vehicles but not settlements). Validation: odometer not lower than the vehicle's previous fill (warn,
allow with a reason, since meters get replaced); litres > 0. Later, LM Studio reads the photo and flags mismatches
against the typed values (phase 3, optional).

### 6. ERP fee import (automation)

A daily import of the ERP collection export posts one entry per receipt (or per day per mode) as `fee_cash` /
`fee_online` / `fee_cheque` with the receipt numbers, student admission no, and for transport fees the student's
route/stop. Typing fee entries is removed from the clerk form. Cash fees from the import feed the cash book and the
deposit reconciliation (replacing the hand-entered ERP total). Requires Uday's sample export; designed now, built when
the export arrives.

### 7. Vehicles

The fleet list (registration, bus no, campus, seats, year, kind = bus/jeep/car/van) comes from the transport data the
Coordinator backend already serves (`coordinatortransport`, fleet tab) plus non-bus vehicles added in Config
(`Vehicles(reg, label, kind, campus, active)`) so the jeep, Innova, Force and Cruiser are included. `needs_vehicle`
categories require a vehicle or the explicit value `FLEET` (shared cost, spread across vehicles in reports).

### 8. Bus P&L (monthly, per vehicle)

A read action and screen (Owner, Coordinator, Tilak Sir) computing, per vehicle per month:
- Fee: from ERP-imported transport fees by student route -> vehicle (route->vehicle from the transport data); until
  the ERP export exists, the workbook's "Transport Monthly" fee figures can be imported as interim rows.
- Costs: ledger entries by `pnl_column`; insurance and tax amortised over the 12 months they cover (covering period
  from the paper's expiry date where known, else 12 months from the entry date); loan interest and principal from the
  ledger.
- Driver and helper pay: from Monthly Payroll by employee code via the transport staff mapping.
- Derived: net P/L, operational P/L (before salary), km driven (odometer deltas), km per litre, fee per km, fee per
  seat, occupancy (students / seats).
- Flags: no fee, fuel spike vs km, km per litre below the fleet median by >20%, missing salary, vehicle with costs but
  no route, unattributed transport spend (FLEET share > 10%).
This replaces the manual "Transport Monthly" retyping.

### 9. History import (2020 onward, all campus tabs)

- Source: the day book Google Sheet (tabs LMS 1-6; columns vary by tab: Date or "Column 1", Type of Transaction,
  Bill/Receipt No., Category, Other Category, School, Particulars, Amount, Email).
- Each row becomes a `DayBook` row in the book for its campus tab and FY (prior-FY books created as needed), with
  `source = legacy`, deterministic id, legacy category kept in `legacy_category`, `charged_to` from the School column
  (normalised: LMS-1/LMS1/LMS 1 -> LMS1, HES), category mapped by a mapping table (old -> new; "Not on this List" and
  free text classified by keywords, with LM Studio for the remainder, every guess marked `mapped_by = rule|ai|default`),
  vehicle extracted from Particulars by registration / bus-number patterns.
- Type of Transaction normalised (Paid/PAID/PIAD/paid -> OUT, Received -> IN); unreadable rows skipped and reported,
  never guessed.
- Legacy rows are excluded from live balances and closes (they are history, not this year's cash), but included in
  reports. Days are not closed by the import.
- Legacy "Fee Online"/"Fee Cheque"/"Bank Deposit" rows are kept as history in their own categories.

### 10. Roles

- Fee Clerk: own campus; cash-account entries; credit bills for own campus's vehicles; fuel fills; no settlements, no
  bank entries.
- Accounts (new role name `Accounts`, Tilak Sir; added to his allowlist role cell alongside Coordinator; campus ALL for
  office purposes): bank and credit entries for any school, settlements, supplier and bank accounts, deposits sign-off,
  day close (as FinanceHead), Bus P&L.
- Owner: everything.

### 11. Data model changes

`DayBook` gains (appended columns): `account, charged_to, vehicle, litres_ml, odometer_km, settles_account, settles,
supplier_bill_no, source, legacy_category, mapped_by`. Existing rows read with blanks map to: account = campus cash,
charged_to = campus, source = live. The store must append missing header columns to existing tabs (today it only
creates missing tabs). New Config tabs: `Accounts`, `Vehicles`; `Categories` gains columns.

### 12. Builder-check resolutions (my calls, 2026-10-22)

- **Which book a row lives in:** always the book of its money account's campus. Bank and credit accounts each belong
  to one campus (HQ accounts to HES). A supplier that serves several campuses gets one credit account per campus
  ("Pump X (LMS3)"), so a Fee Clerk's fill rows stay in their own campus book; a settlement paid from one bank for
  several campuses is entered as one settlement row per campus credit account. Reports read across all books.
- **Day close and late bank/credit entries:** a day close freezes cash-account rows only (it is the cash count). Bank,
  UPI and credit rows carry their real transaction date and are not blocked by a closed day; a separate month lock for
  them can come later. `closing_json` keeps covering cash.
- **Opening balances per account:** an `opening` category entry per money account, once per account, by Accounts or
  Owner, allowed after the book's cash opening lock. Suppliers already owed money start with their outstanding amount.
- **Existing bank/UPI rows and deposits:** each campus gets a default bank account ("<campus> bank") created
  automatically; existing bank/upi rows and `deposit_bank_in` legs map to it, and `deposit.add` names a bank account
  (default: the campus bank) from now on.
- **Salaries:** come from payroll, never typed into the day book, so driver pay is counted once (in the Bus P&L via
  payroll).

### 13. Uday's further decisions (2026-10-22)

- **Storage stays on Google Sheets for now**; a move to Postgres + React is planned later, so the data stays shaped to
  migrate (as in the Office design).
- **Bank statement reconciliation:** bank statements are uploaded (CSV/XLS/PDF per bank) and every statement line is
  matched against day book bank/UPI/credit-settlement entries and ERP fee entries (amount, date window, reference /
  UTR / cheque number). Unmatched statement lines and unmatched day book entries are listed for action. Bank balances
  then reconcile to the statement. This is its own phase (after phase 1, before or with the ERP import).
- **Fee collected comes from the ERP's reports** (collection reports), imported rather than typed; the Bus P&L uses
  collected fees from those reports (fee due per rider can be added later).
- **The hardcopy day books are the more accurate source** for FY 2026-27. The six books (LMS 1-6, from 1 April 2026)
  are transcribed with LM Studio, checked (each day balances; opening equals the previous day's cash in hand;
  dates in the year), and compared line by line with the Google Sheet. The verified hardcopy data, not the Form, is
  loaded into the portal for FY 2026-27; the Form/Sheet supplies 2020 to March 2026. Days that fail the checks go to a
  review list for a person to confirm against the page image. LMS 6 has no Form data at all; its book is the only record.

## Phases (each its own plan, in this order)

1. Day Book v2 core: accounts, charged_to, new categories, vehicle field, credit + settlement, fuel fill fields and
   photo, Accounts role, header migration, updated form and lists, owed-to-suppliers and per-school totals.
2. History import: Form/Sheet entries 2020 to March 2026, plus the verified hardcopy day books for FY 2026-27, with category mapping and vehicle extraction (LM Studio for the leftovers).
2b. Bank statement upload and reconciliation against day book and ERP fee entries.
3. Bus P&L screen with amortisation, payroll link, loans, km per litre and flags; interim fees from the workbook.
4. ERP fee import (when the sample export arrives) replacing typed fees and the hand-entered ERP total.
5. Later: GPS km, LM Studio slip checks, budgets per school per head.

## Open questions for Uday

1. Bank accounts and credit suppliers to seed (names only; no account numbers needed).
2. Loan list per vehicle: lender, EMI, interest/principal split or schedule.
3. Tilak Sir's email, and whether anyone else in accounts should get the Accounts role.
4. A sample ERP collection export (for phase 4) and the student -> route/stop export.

## Left to the builder

Screen layout, exact field order, keyword rules for history mapping, LM Studio prompt, amortisation edge cases,
report formatting, test layout.

## My calls (to check)

- Money accounts as a first-class list (cash / bank / credit) rather than only payment modes.
- `charged_to` with CHAIRMAN as its own value.
- `FLEET` as the explicit "shared transport cost" vehicle.
- Legacy rows excluded from live balances and closes.
- Credit settlement as a movement, never an expense.
- Interim bus fees from the workbook until the ERP export exists.
