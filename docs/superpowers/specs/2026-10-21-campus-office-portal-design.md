# LMCS Fee Clerk + PRO Portal: foundation and phase 1 (design)

Status: draft v2 for Uday's approval, 2026-10-21 (v2: dropped Supabase; built on the existing Apps Script + Sheets +
Drive stack, with a planned later move to Postgres and React). Nothing is built.

## Intent and the why

The campus fee office does the school's day-to-day money, documents and records on paper, WhatsApp and loose Google
Sheets: the Physical Day Book, the 6 PM WhatsApp report (OO/06/21), deposit proofs, bills, certificates, staff and bus
documents, inventory. Nothing is searchable, nothing is audited, and the Coordinator/Owner only learn of a problem
after the fact. The third-party ERP owns fee collection and receipts; this portal does everything around it.

This is the **Fee Clerk + PRO Portal**: the one place where a Fee Clerk cum PRO and **all of their tasks** live. It is
the clerk's workspace, not a general accounts system or a fee-collection system. The clerk is the primary user and the
home screen is built around their day ("Today": what is due, what is done, what is waiting to sync). Admin Manager,
Finance Head, Account Coordinator, Principal, Coordinator and Owner are secondary users who review, approve and
monitor what the clerk does. It is the **fifth portal** (after Owner, Coordinator, Principal, Staff), built the same
way as those. It is also the
last portal built on the Apps Script + Sheets stack: **once it is complete, the whole platform moves to a Postgres
backend and a React front end** (separate project). That move shapes several choices below.

## Phasing

1. **Foundation**: backend, local-first sync, Drive upload, audit log, backups.
2. **The clerk's daily work** (detailed below): reports, money, bills, documents, registers, inventory, compliance.
3. **Admissions** and 4. **Communications**: the PRO front-desk side of the same portal (enquiries, parents,
   letters, notices), outlined only, designed later.

## Goals

1. One place for everything the campus office records: documents, bills, day book, finance, inventory, transport
   documents, compliance, registers. Every entry belongs to a campus, a day and a person.
2. Works through internet and power drops at a fee counter (local-first). No entry is silently lost.
3. Every money or stock change is traceable and cannot be edited after the day is closed.
4. Every file lives in Drive under uday.kanwar@lms.org.in; the Sheets hold links and facts only.
5. Coordinators and the Owner see per-campus compliance without asking.
6. **Migration-ready:** data is shaped so a later load into Postgres is mechanical (see "Built to migrate").
7. Production-grade: tested, backed up with a rehearsed restore, role-scoped, mobile-friendly, accessible.

## Non-goals

- Re-recording fee collections or receipts (the ERP stays the record; the portal reconciles against it).
- Payroll, hiring, salary (already in the portal, untouched).
- Parent-facing screens. **Decided: no parent access to any of the portals.**
- A new database, server or framework in this release. Postgres and React come later, as their own project.
- Replacing Tally; the portal produces exports for Tally and the CA.

## Anti-goals (failure even if it technically works)

- An entry the clerk believes is saved but never reached the backend.
- A past day book entry silently edited or deleted.
- A clerk at one campus seeing another campus's data, or an identity document reaching anyone it should not.
- Any file shared as "anyone with the link"; Sheet or folder IDs committed to the public repo.
- The existing portals or their Apps Script backends breaking because of this work.
- Depending on the Mac, the external drive or any one person's device being on.
- Data stored in a shape that makes the Postgres move a rewrite (merged cells, formulas as data, free-text keys).

## Decisions already made (Uday, 2026-10-21)

| Decision | Value |
|---|---|
| Stack | Same as the other four portals: static HTML pages on GitHub Pages, Apps Script backend, Google Sheets data, Drive files, Google sign-in + allowlist |
| Later | Whole platform moves to Postgres + React after this portal is complete; no Supabase or other cloud database now |
| Offline | Local-first installable web app (PWA): campus device keeps a queue, syncs when online |
| Files | Google Drive, owned by uday.kanwar@lms.org.in |
| Sign-in | Exactly as the Owner, Coordinator, Principal and Staff portals; all users on lms.org.in accounts |
| Migration | Existing day book Sheet migrated in full (all history) |
| ERP | Can supply a fee-collection export, so reconciliation can import it |
| Parents | No parent access, in any phase |
| Approval limits | Decided later; placeholder table until then |
| Pilot campus | LMS 1 (Dhalpur) |

## Constraints

- **Existing stack:** `assets/auth.js` (Google Identity Services, client ID, allowlist with campus and role),
  Apps Script web apps deployed with `node apps-script/deploy.mjs` (projects and files in `apps-script/projects.json`),
  tests via `node tests/verify.mjs`. Reads are `GET ?action=&idToken=`; writes are `POST` with a `text/plain` JSON
  body so no CORS preflight happens.
- **Apps Script limits:** cold starts of several seconds, occasional HTML error pages instead of JSON, 6-minute runs,
  daily Drive/mail quotas, a spreadsheet's 10 million cell cap, slow reads on very large tabs. Concurrent writers are
  serialised with `LockService`, as `payroll.gs` already does.
- **Public repo:** no Sheet, folder or secret IDs in source. They go in Script Properties (the pattern
  `coordinator-transport.gs` uses). The audit report already flagged IDs in source for payroll; this module must not
  repeat it.
- Dates DD/MM/YYYY, money in INR with Indian digit grouping, campuses LMS 1 to 6, plus HES (head office).

## Roles and access

The Fee Clerk cum PRO is the primary user; every other role exists to review, approve or monitor the clerk's work.

| Role | Sees | Can do |
|---|---|---|
| Fee Clerk | own campus | create entries, upload files, submit daily report, run defaulter checklist |
| Admin Manager | own campus | all clerk screens, approve small bills, compile defaulter list, grant substitute access |
| Finance Head / Account Coordinator | assigned campuses | approve bills over limit, sign deposits, close the day, reconcile |
| Principal | own campus | read, approve per limits, see compliance |
| Coordinator | own campus (existing scope) | read, follow-ups, approvals |
| Owner | all campuses | everything, plus configuration and reopening a closed day |

Sign-in, token check and the allowlist work as in the other portals; the Office backend re-verifies the token on
every call and checks role and campus **server-side**. New roles (Fee Clerk, Admin Manager, Finance Head) are added to
the allowlist's role column. A person may hold several (role, campus) pairs. HES counts as a campus for Owner and
Finance scoping only. The Computer Teacher gets a temporary "substitute" grant for the Daily Report and nothing
else, set by the Admin Manager for the clerk's absent days (my call). Approval limits are configuration, not code;
placeholder table until Uday decides.

## Architecture

```
Campus device (PWA, static HTML + JS)         Office Apps Script backend (new project)      Data
  Service worker + IndexedDB                    verifies token, role, campus;                 Per campus-year Sheet (tables)
  outbox of unsent entries + read cache  --->   LockService; idempotent by entry ID;  --->    Office Config Sheet
  camera / file picker                          append-only writes; audit rows                Drive folders (files)
                                                nightly backup trigger                        Backups folder in Drive
```

### Local-first sync

- Every create writes first to a local outbox with a **client-generated unique ID** (UUID), then syncs in the
  background. The backend accepts each ID once, so retries and double-clicks never duplicate.
- Records are **append-only**. A correction is a new reversing or superseding entry pointing at the original.
- Where an edit is genuinely needed (a draft bill, a defaulter note) the rule is last-writer-wins with the earlier
  version kept in history. **Left to the builder:** the exact per-table rule within these principles.
- Every screen shows sync status (all synced / N waiting / offline). **A day cannot be closed while any entry for that
  campus is unsynced.**
- The client guards against out-of-order responses and double in-flight requests (the payroll adjustments bug).
- Read cache lets lists and the last-viewed records open offline. Sensitive document files are never cached; an
  unsent upload's draft waits locally only until it reaches Drive.
- The app warns before anything that would clear the local queue (sign-out, cache clear) while entries are waiting.
- The backend handles Apps Script's cold starts and HTML error responses with retry and back-off.

### Data layout (Sheets)

- **One spreadsheet per campus per financial year** (for example "LMS1 Office 2026-27"), holding that campus's tables,
  plus one **Office Config** spreadsheet (campuses, categories, vendors, approval limits, item master). My call:
  this keeps each sheet far below the cell cap, makes campus isolation a data-level fact as well as a code check, and
  makes year-end a clean cut.
- One tab per table. Row 1 is the header; no merged cells, no formulas, no colours carrying meaning. Dates are ISO in
  storage and shown DD/MM/YYYY in the UI. Every row has a stable `id` (UUID), `campus`, `created_at`, `created_by`.
- Sheet IDs live in Script Properties, never in source.

### Files and Drive

- The backend runs as Uday (the existing "execute as me" pattern), so every file it creates is owned by
  uday.kanwar@lms.org.in with no credential to store and no Drive access for staff.
- Folder tree per campus, year and category (for example `LMS1 / 2026-27 / Bills`). Folders are never shared with
  anyone and never "anyone with the link".
- Phone photos are resized in the browser before upload (readable, a few hundred KB). Larger PDFs use a chunked
  upload. **Left to the builder:** the request-size limit and chunk design.
- Each file has a row: Drive file ID, name, size, content fingerprint (duplicate detection), uploader, category, and
  the record it belongs to (bill, employee, bus, student, register entry).
- Viewing a file goes through the backend, which checks role and campus, writes the view to the audit log, and
  returns the file in a short-lived response. A Drive link opened outside the portal does not work for staff, which is
  what makes "every view logged" true. Sensitive files are never cached on the device.
- Risk recorded: files owned by one account. Later hardening: a Workspace shared drive owned by the organisation
  (suggestion, not decided).

### Audit log

An append-only `Audit` tab, written by the backend (never by the page) on every create or change to money, stock and
document records: who, when, device, campus, before and after (changed fields only). Not editable through the app.
Viewing a sensitive file is logged too.

### Backups

Nightly Apps Script trigger copies each campus spreadsheet and the Config sheet into a Backups folder in Uday's Drive
with a dated name, keeps the last 30 daily and 12 monthly copies, and emails Uday if a run fails. The Mac / external
drive pulls a further copy whenever it is on; a missed Mac pull is acceptable, a missed Drive backup alerts. A
restore drill (open a backup, compare totals with live) is rehearsed once before go-live and monthly after. Drive
file backup method decided in the plan (for example Drive for Desktop sync).

### Built to migrate (Postgres and React later)

- Tables are relational in shape: one entity per tab, ids not names as keys, foreign keys by id, enumerations from
  the Config sheet, no cross-tab formulas.
- The backend API is a clean action-based JSON contract (`action=daybook.add`, `bill.approve`, ...) with documented
  request/response shapes in the repo, so the Postgres backend can implement the same contract and the React front
  end can be built against it.
- Page code is split into a thin API client, local-store logic and screens, so a React port reuses the client and
  store logic. (Existing portals use one large file per screen; this module deliberately does not.)
- A tested export script writes each table to CSV with the final column names, so the Postgres load is a file import.

## Phase 1 modules (Campus Office & Accounts)

### 1. Daily Report
Replaces the 6 PM WhatsApp report. Fields: hourly work log, parent footfall, parent feedback (positive/negative),
employee leave status, external documents received, cash in three buckets (petty cash, school fee cash, other).
Rules: locks at 6 PM; late or missing flagged to the Coordinator; when the clerk is absent the Computer Teacher
submits (substitution per OO/06/21); cash figures cross-check against the day book.

### 2. Day Book
Daily entries with category, amount, mode (cash/bank/UPI), vendor or payee, bill attachment, narration. Rules:
append-only; day close by the Finance Head freezes the day (enforced by the backend); opening and closing balance
must reconcile; a mistake is a reversing entry. Replaces the Physical Day Book and the daily Google Sheet.

### 3. Deposits and reconciliation
Clerk uploads the bank challan/slip with amount and bank reference. Rules: flag any collection not deposited within
24 hours; Finance Head signs in-portal; daily comparison of ERP collection total, day book cash and bank deposit,
differences listed. The ERP total comes from an imported ERP export (Uday can supply the export format); manual entry
is the fallback.

### 4. Bills and payment requests
Vendor, bill number, date, amount, GST/TDS fields, category, campus, attached scan. Rules: duplicate detection on
vendor plus bill number plus amount; approval chain by amount limit (placeholder limits); status (received,
approved, paid, rejected); payment reference once paid; link to inventory receipt when the bill is for stock.

### 5. Cheques and refunds
Cheque register (received, deposited, cleared, bounced) with payer reference; refund and security-refund tracker
with the one-month rule after the leaving certificate; fee concession log with approver.

### 6. Defaulter cycle
Monthly checklist from the bye-laws: list and emails on the 14th, calls from the 15th by branch threshold
(Rs. 4,000 to 8,000), communication register by the 25th, Admin Manager compile by the 15th, Principal address of
balances over Rs. 15,000 between the 15th and 25th, Account Coordinator meeting on the 26th. Reuses the daily
"Defaulters Followup Summary" emails captured by `fee-mail-capture.gs`; student-name Excel attachments stay out.

### 7. Student certificates and requests
Registers for TC / SLC / migration / mark list with serial numbers, information-change applications (one-week
promise), withdrawal notices. Rules: fee-clearance check before issue; SLA timers; each issued certificate stored.

### 8. Employee documents
Document locker per employee keyed by the existing Employee Code: Aadhaar, PAN, certificates, bank details, police
verification. Rules: expiry and missing-document alerts feeding the Coordinator's existing document compliance;
masked numbers on screen; every view logged. Complements the certificate matching pipeline in `drive-index`.

### 9. Transport documents
Per-bus documents keyed by registration number (RC, insurance, fitness, permit, MV tax, pollution, speed
governor) plus driver licence and verification. Expiry dates with alerts; replaces the transport Google Form uploads.

### 10. Inventory and movements
Items per campus store; movements: receive (linked to a bill), issue (to a person/class), return, transfer between
campuses (two-step: sent, received), damage/write-off (approver). Reorder level, periodic stock count and variance.
Covers stationery, books, uniforms, lab and sports items, IT assets. Stock is derived from movements, never typed;
negative stock is blocked.

### 11. Compliance and registers
NOC, affiliation, fire safety, building safety, water/sanitation and board certificates each with expiry and owner;
inspection calendar; incoming letters/courier/parcel; visitor and gate-pass log; complaints and feedback register;
maintenance work orders; key and asset register; event budget and donations with receipt.

### 12. Cross-cutting
**Today** home screen for the clerk: tasks due by time of day (deposit within 24 hours, 6 PM report, monthly
defaulter dates, expiring documents, pending approvals), with sync status. Search across people, buses, bills and documents; monthly close checklist per campus; campus health scorecard for
Coordinator/Owner; CSV export on every list; monthly package for the CA and Tally.

## Rollout and migration of existing data

- **Pilot: LMS 1 (Dhalpur)** for a month, in parallel with the paper day book, then a go/no-go review, then campus by
  campus.
- **Pilot slice, in order:** Daily Report, Day Book, Deposits; then Bills and files; then employee and transport
  documents (sensitive-file path); then inventory; then registers and compliance.
- **Day book history:** the existing Google Sheet (all history, all years) is imported once into the new tables,
  loaded as closed days, with totals verified against the source before use. The source Sheet's layout is read at plan
  time; its link is in Uday's message of 2026-10-21 and is deliberately not stored in this public repo.
- **Money rules:** the Finance Head sets each campus's opening balances at go-live. A closed day is not reopened by
  clerks; a correction posts to the next open day as a reversing entry referencing the original. Only the Owner can
  reopen a closed day, and it is logged. ERP totals come from the imported ERP export.

## Production-readiness requirements

- **Tests:** unit tests for money, stock and approval rules; sync tests for offline, retry, duplicate and
  out-of-order cases; role/campus isolation tests proving a clerk cannot read another campus; the existing
  `node tests/verify.mjs` extended (a new `.gs` file must be added to `apps-script/projects.json`).
- **Security:** token re-verified on every call; server-side campus scoping; no IDs or secrets in the public repo;
  sensitive numbers masked; sign-out clears local data; DPDP Act duties noted (purpose, minimisation, retention,
  access).
- **Reliability:** retry/back-off for Apps Script errors; LockService on all writes; monitoring of backup success;
  watch spreadsheet size per campus-year.
- **Accessibility and mobile:** WCAG AA, camera-first capture on phones, large tap targets at the counter.
- **Operations:** a runbook (restore from backup, add a campus, add a user, rotate the sign-in allowlist), a named
  owner for the Google account, and the monthly restore check.

## Later phases (outline only; staff-only)

### Admissions
Pipeline: enquiry, counselling/visit, registration, documents, fee payment, confirmed. Fee rules: new-admission fee
by campus; inter-LMS migration pays the difference; returning students 50% (100% within 9 months); alumni wards 50%.
Employee referral (Option 1: parent 20% off, employee 10%; Option 2: employee 10% of full fee) and the Principal /
Fee Clerk bracket incentive on unclaimed admissions (LMS 2 brackets differ) calculated automatically and handed to
payroll. Seat control, waiting list, sibling links, document checklist, handover to the student master.
No parent-facing form.

### Communications
Staff-side circulars with read receipts, templates for parent notices drafted and approved in the portal and sent
through the school's existing channels, message logs, an internal enquiry/complaint queue with owners and response
targets. Separate from the internal WhatsApp Hub. The "Communication at LMS" bye-law must be read first. Since
parents have no access, anything parent-facing is outbound only.

## Open questions for Uday

1. Approval limits and who approves what (placeholder until decided; not blocking).
2. The ERP export: which report, what format, how often it can be produced (needed at plan time for Deposits).

## Left to the builder

Tab and column names, the sync/outbox library or hand-rolled code, the per-table edit rule, chunked-upload design,
folder naming, PWA caching strategy, UI design, test layout, Drive file backup method.

## My calls (to check)

- Per campus-year spreadsheets plus a Config sheet.
- Standalone PWA pages in the existing static style, split into API client / store / screens (not one big file per
  screen), to ease the React port.
- Backend runs as Uday for Drive ownership, no stored refresh token.
- Append-only entries with reversing corrections; Owner-only reopening of closed days.
- Nightly in-Drive backup (30 daily, 12 monthly), Mac as a second copy.
- Computer Teacher substitute grant; HES scoping for Owner/Finance only.
- Pilot slice order.
