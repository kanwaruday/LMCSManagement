# Fee Clerk + PRO Portal: Foundation and Pilot Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the foundation (Office backend, local-first sync, Drive files, audit, backups) and the pilot slice (Today, Daily Report, Day Book with day close, Deposits and reconciliation) for a one-campus pilot at LMS 1.

**Architecture:** A new Apps Script project ("LMCS Office Backend", runs as Uday) holds per-campus-per-financial-year spreadsheets and a Config spreadsheet, verifies the Google token and allowlist on every call, writes append-only rows idempotently by client UUID under `LockService`, and logs every write to an `Audit` tab. Static pages under `office/` (installable PWA, split into API client / outbox / screens) queue writes in IndexedDB and sync when online. Files go to Drive folders owned by Uday through the backend.

**Tech Stack:** Apps Script (.gs, deployed with `apps-script/deploy.mjs`), Google Sheets/Drive, vanilla JS + HTML (no build step), IndexedDB, service worker, node tests under `tests/office/` using the fakes from `tests/payroll/harness.js`.

**Spec:** `docs/superpowers/specs/2026-10-21-campus-office-portal-design.md` (v2, approved 2026-10-21). Modules 4-12, Admissions and Communications get their own later plans.

## Global Constraints

- Stack matches the other four portals: static HTML on GitHub Pages, Apps Script backend, Sheets data, Drive files, Google sign-in via `assets/auth.js` and the allowlist; no Supabase or other new database now.
- Reads are `GET ?action=&idToken=`; writes are `POST` with a `text/plain` JSON body (no CORS preflight); the backend re-verifies the token on every call and checks role and campus server-side.
- No Sheet, folder or secret IDs in source (public repo): Script Properties only. Tests use fake data only.
- Records are append-only; a correction is a new reversing entry referencing the original. Day close freezes the day (backend-enforced). Only the Owner can reopen a closed day, and it is logged.
- Every entry has a client-generated UUID `id`; the backend accepts each `id` once.
- A day cannot be closed while any entry for that campus is unsynced (client enforces; server cannot see device queues, see Task 5).
- Every file lives in Drive owned by uday.kanwar@lms.org.in (backend runs as Uday); folders never shared, never "anyone with the link"; viewing goes through the backend and is audited.
- One spreadsheet per campus per financial year (Apr-Mar, label like `2026-27`) plus one Office Config spreadsheet. One tab per table, header in row 1, no merged cells, no formulas, no colour meaning; rows carry `id`, `campus`, `created_at`, `created_by`.
- Dates stored ISO (`YYYY-MM-DD`), shown DD/MM/YYYY. Money stored as integer paise, shown INR with Indian digit grouping. Business dates use Asia/Kolkata.
- A new `.gs` file must be added to `apps-script/projects.json`; `node tests/verify.mjs` must pass before every commit; deploy with `node apps-script/deploy.mjs office --push --deploy "msg"` then `node tests/verify.mjs --live`.
- Pilot campus LMS 1 (Dhalpur); no parent access; approval limits are placeholders; ERP totals are hand-entered for now (import deferred until Uday supplies the export format).
- Page code is split into API client / outbox / screens (no one-big-file-per-screen).

## Review Focus

Failure modes the spec implies that no feature task would otherwise exercise (each is pinned by a test in the task named):
1. An offline entry for day D reaches the server after the Finance Head closed D: rejected with `DAY_CLOSED`, kept in the outbox as "needs attention", never silently dropped (Tasks 5, 11).
2. A double-click or retry sends the same entry twice, or responses arrive out of order: exactly one row, and the screen shows the latest state (Tasks 2, 11).
3. A clerk of one campus requests another campus by editing the `campus` parameter: refused for every action (Tasks 1, 2).
4. A Drive file is requested by a signed-in user without access to its campus, or a file is created and shared by mistake: refused and audited; `setSharing` is never called (Task 7).
5. Amounts typed as `1,234.50`, `0`, negative, or with float noise (`0.1+0.2`): rejected or exact; totals never drift by a paisa (Task 4).

---

### Task 1: Office backend scaffold, auth and test harness

**Files:**
- Create: `apps-script/office.gs`, `tests/office/harness.js`, `tests/office/run.js`, `tests/office/test-auth.js`
- Modify: `apps-script/projects.json` (add `office`)

**Interfaces:**
- Produces: `doGet(e)`, `doPost(e)` -> `officeHandle_(action, idToken, data): TextOutput`; `OFFICE_ACTIONS: {[name]: {roles: string[], write: boolean, run(ctx, data): object}}`; `officeCaller_(idToken): {email, name, campuses: string[], roles: string[]} | null` (campuses from allowlist column C, comma list or `ALL`; roles from column D, comma list); `officeAssertCampus_(caller, campus): void` (throws `Error('FORBIDDEN_CAMPUS')`); `officeNow_(): Date` (overridable clock); `officeToday_(): 'YYYY-MM-DD'` (Asia/Kolkata); `officeFy_(isoDate): '2026-27'`. Test harness: `boot(fixture): {call(action, data, token), books, setNow(date)}` built on `makeSheet/makeBook` exported by `tests/payroll/harness.js`.
- Role names: `FeeClerk`, `AdminManager`, `FinanceHead`, `Principal`, `Coordinator`, `Owner`.

- [ ] **Step 1: Write failing tests** in `tests/office/test-auth.js`: `unknown action returns success:false`; `no token returns Not authorized`; `FeeClerk of LMS1 can call a FeeClerk action for LMS1`; `FeeClerk of LMS1 requesting LMS2 gets FORBIDDEN_CAMPUS` (Review Focus 3); `Owner with campus ALL may use any campus`; `role not in the action's roles is refused`; `substitute grant is not a role` (placeholder, completed in Task 6).
- [ ] **Step 2: Run** `node tests/office/run.js` -> fails (no `office.gs`).
- [ ] **Step 3: Implement** `office.gs` following `payroll.gs` (`payHandle_`, `payVerifyAllowlist_`) for token check against `https://oauth2.googleapis.com/tokeninfo`, 5-minute `CacheService` of the verified caller keyed by a token hash, JSON responses with `{success, error}`. IDs (client id, allowlist sheet id) read from Script Properties. Build `tests/office/harness.js` and `run.js` modelled on `tests/payroll/*` (`run.js` must be discovered by `tests/verify.mjs`).
- [ ] **Step 4: Run** `node tests/office/run.js` -> all pass; then `node tests/verify.mjs` (the `office` project needs an entry in `projects.json` with `files: ["office", ...]`; leave `scriptId`/`deploymentId` empty until Task 16).
- [ ] **Step 5: Commit** `feat(office): backend scaffold, auth and test harness`.

### Task 2: Store layer: tables, idempotent append, audit

**Files:**
- Create: `apps-script/office-store.gs`, `tests/office/test-store.js`
- Modify: `apps-script/projects.json` (add file)

**Interfaces:**
- Consumes: Task 1 (`officeAssertCampus_`, `officeNow_`).
- Produces: `OFFICE_TABLES: {[tab]: string[]}` (column lists below); `officeOpen_(campus, fy): Spreadsheet` (ids from Script Properties `OFFICE_SS_<CAMPUS>_<FY>`; creates tabs and headers if missing; throws `NO_BOOK` if the property is unset); `officeConfig_(): Spreadsheet`; `officeAppend_(ss, tab, row, caller, opts): {id, duplicate: boolean}` (under script lock; if `row.id` already exists returns `duplicate: true` with no write; writes an `Audit` row `{id, ts, who, action, tab, row_id, campus, after}`); `officeRows_(ss, tab): object[]`.
- Tables: `DayBook(id,campus,entry_date,direction,mode,bucket,category,amount_paise,payee,narration,file_id,reverses,created_at,created_by)`, `Opening(id,campus,mode,bucket,amount_paise,created_at,created_by)`, `Closes(id,campus,close_date,closing_json,created_at,created_by)`, `Reopens(id,campus,close_date,reason,created_at,created_by)`, `Reports(id,campus,report_date,json,late,submitted_for,created_at,created_by)`, `Deposits(id,campus,covers_date,amount_paise,bank_ref,file_id,signed_by,signed_at,created_at,created_by)`, `ErpTotals(id,campus,total_date,amount_paise,created_at,created_by)`, `Files(id,campus,drive_id,name,size,fingerprint,category,belongs_to,created_at,created_by)`, `Substitutes(id,campus,email,from_date,to_date,created_at,created_by)`, `Audit(...)`.

- [ ] **Step 1: Write failing tests**: `append writes one row and one audit row`; `same id twice writes once, second returns duplicate:true` (Review Focus 2); `two appends in sequence keep header intact and order`; `missing book property throws NO_BOOK`; `rows from two campuses never mix` (separate books).
- [ ] **Step 2: Run** -> fail. **Step 3: Implement** as above; ensure-tabs uses `OFFICE_TABLES` and never rewrites existing headers. Document the Script Properties keys at the top of the file. **Step 4: Run** tests + `verify.mjs`. **Step 5: Commit** `feat(office): store layer with idempotent append and audit`.

### Task 3: Config, categories and opening balances

**Files:** Create `apps-script/office-config.gs`, `tests/office/test-config.js`; modify `projects.json`.

**Interfaces:**
- Consumes: Tasks 1-2.
- Produces actions: `config.get` (any role; returns `{categories: [{id,label,direction}], limits: {...placeholder}, campuses}`), `opening.set` (roles `FinanceHead`,`Owner`; data `{id, campus, balances: [{mode:'cash'|'bank'|'upi', bucket:'petty'|'fee'|'other'|'', amount_paise}]}`; allowed only while the campus-year has no `DayBook` rows, else `OPENING_LOCKED`); `officeOpening_(ss): {cash:{petty,fee,other}, bank, upi}` (paise).
- Config tabs: `Categories(id,label,direction)` (seed includes `fee_collection` IN, `deposit_cash_out` OUT and `deposit_bank_in` IN (the two legs Task 8 creates), `petty_expense` OUT, `bill_payment` OUT, `donation` IN, `other_in`, `other_out`), `Limits(role, max_amount_paise)` seeded with placeholder rows.

- [ ] **Step 1: Tests**: `config.get returns seeded categories`; `opening.set by FeeClerk refused`; `opening.set by FinanceHead stores balances and audits`; `opening.set after first daybook row returns OPENING_LOCKED`; `bucket is required when mode is cash`. **Step 2-4:** run fail, implement, run pass (+ `verify.mjs`). **Step 5: Commit** `feat(office): config, categories, opening balances`.

### Task 4: Day Book: entries, reversal, balances

**Files:** Create `apps-script/office-daybook.gs`, `tests/office/test-daybook.js`; modify `projects.json`.

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces actions: `daybook.add` (roles `FeeClerk`,`AdminManager`,`FinanceHead`,`Owner`; data `{id, campus, entry_date, direction, mode, bucket, category, amount_paise, payee, narration, file_id}`), `daybook.reverse` (data `{id, campus, reverses}`; creates the opposite-direction entry with `reverses` set; dated by `officeToday_()`; refuses reversing an entry that is itself a reversal or already reversed with `ALREADY_REVERSED`), `daybook.list` (data `{campus, from, to}`), `daybook.balances` (data `{campus, date}` -> `{opening, in, out, closing}` per mode and per cash bucket, paise). Pure helper `officeBalances_(opening, rows, date)` exported for tests. Validation: `amount_paise` positive integer; `category` exists in Config; `direction` matches the category's direction; `bucket` required iff mode is `cash`; dates valid ISO and not in the future.

- [ ] **Step 1: Tests**: `amount 0, negative, float 0.1 and string "1,234.50" are rejected` (Review Focus 5); `1000 entries of 10 paise sum exactly 10000`; `balances = opening + in - out per mode and cash bucket`; `reverse creates opposite entry and nets to zero`; `reversing twice returns ALREADY_REVERSED`; `bucket missing for cash is rejected`; `category direction mismatch is rejected`; `future entry_date is rejected`; `daybook.list for another campus is FORBIDDEN_CAMPUS`. **Step 2-4:** fail, implement, pass. **Step 5: Commit** `feat(office): day book entries, reversal, balances`.

### Task 5: Day close and reopen

**Files:** Create `apps-script/office-close.gs`, `tests/office/test-close.js`; modify `projects.json`; modify `office-daybook.gs` (reject closed dates).

**Interfaces:**
- Produces: `day.close` (roles `FinanceHead`,`Owner`; data `{id, campus, close_date}`; computes `officeBalances_`, stores `closing_json`; refuses if the previous day is open and has entries (`PREVIOUS_DAY_OPEN`) or if already closed (`ALREADY_CLOSED`)), `day.reopen` (role `Owner`; data `{id, campus, close_date, reason}`; reason required; removes the freeze for that date and audits), `officeIsClosed_(ss, isoDate): boolean`. `daybook.add` (and Reports/Deposits writes dated to a closed day) returns `{success:false, code:'DAY_CLOSED'}`; `daybook.reverse` always dates today so it is unaffected.

- [ ] **Step 1: Tests**: `add dated to a closed day returns DAY_CLOSED` (Review Focus 1); `reverse of an entry in a closed day posts to today`; `close by FeeClerk refused`; `close stores closing balances equal to daybook.balances`; `close twice returns ALREADY_CLOSED`; `reopen by FinanceHead refused, by Owner with reason works and is audited`; `reopen without reason refused`. **Step 2-4:** fail, implement, pass. **Step 5: Commit** `feat(office): day close and owner-only reopen`.

### Task 6: Daily Report and substitute grant

**Files:** Create `apps-script/office-report.gs`, `tests/office/test-report.js`; modify `projects.json`, `office.gs` (`officeCaller_` honours substitute grants).

**Interfaces:**
- Produces: `report.submit` (roles `FeeClerk`,`AdminManager`,`Owner`, plus any caller holding an active `Substitutes` row for the campus and date; data `{id, campus, report_date, hourly: [{hour, text}], footfall, feedback_pos, feedback_neg, leave_status, external_docs, cash: {petty, fee, other}}` all cash in paise); `report.get` (`{campus, report_date}` -> report or null plus `cashMismatch: {bucket, report_paise, daybook_paise}[]` against the day-book closing); `substitute.grant` (roles `AdminManager`,`Owner`; `{id, campus, email, from_date, to_date}`); `officeSubstitute_(ss, email, isoDate): boolean`. `late = true` when `officeNow_()` in Asia/Kolkata is after 18:00 on `report_date`; late reports are accepted and flagged, never rejected (my call: do not lose data). A substitute may use `report.submit` only.

- [ ] **Step 1: Tests**: `report before 18:00 is on time, after is accepted with late true`; `second submit for the same date is a new row marked as superseding (latest wins in report.get)`; `substitute can submit but cannot call daybook.add`; `grant outside its date range does nothing`; `cash differing from day book is returned in cashMismatch and does not block`; `report.submit for a closed day returns DAY_CLOSED`. **Step 2-4:** fail, implement, pass. **Step 5: Commit** `feat(office): daily report and substitute grant`.

### Task 7: Files: upload, folder tree, audited view

**Files:** Create `apps-script/office-files.gs`, `tests/office/test-files.js`; extend `tests/office/harness.js` with a fake `DriveApp`; modify `projects.json`.

**Interfaces:**
- Produces: `file.upload` (roles `FeeClerk`,`AdminManager`,`FinanceHead`,`Owner`; data `{id, campus, category, belongs_to, name, mime, base64}`; accepts `image/jpeg`, `image/png`, `application/pdf` up to 3 MB decoded (chunked upload for larger PDFs is deferred); computes SHA-256 fingerprint; creates `<root>/<CAMPUS>/<FY>/<Category>/` folders under Script Property `OFFICE_DRIVE_ROOT`; stores a `Files` row; returns `{id, duplicateOf}` where `duplicateOf` is an existing `Files` id with the same fingerprint in that campus, in which case no second Drive file is created); `file.view` (any role with access to the file's campus; data `{id}`; returns `{name, mime, base64}` and writes an `Audit` row with action `file.view`). The module never calls `setSharing`/`addViewer`/`addEditor`.

- [ ] **Step 1: Tests**: `upload creates folder path and a Files row`; `same bytes twice returns duplicateOf and one Drive file`; `4 MB file rejected with TOO_LARGE`; `exe mime rejected`; `view by a clerk of another campus is FORBIDDEN_CAMPUS and audited` (Review Focus 4); `view by the right campus returns bytes and logs file.view`; `source has no setSharing call` (grep assertion over office-files.gs). **Step 2-4:** fail, implement, pass. **Step 5: Commit** `feat(office): private Drive file upload and audited view`.

### Task 8: Deposits and reconciliation

**Files:** Create `apps-script/office-deposits.gs`, `tests/office/test-deposits.js`; modify `projects.json`.

**Interfaces:**
- Produces: `deposit.add` (roles `FeeClerk`,`AdminManager`,`Owner`; data `{id, campus, covers_date, amount_paise, bank_ref, file_id}`; `file_id` required (the challan/slip)); `deposit.sign` (roles `FinanceHead`,`Owner`; data `{campus, deposit_id}`; sets `signed_by/at`; signing is an appended `Audit` plus a `signed_*` update allowed on this one table); `erp.set` (roles `FeeClerk`,`AdminManager`,`FinanceHead`,`Owner`; data `{id, campus, total_date, amount_paise}`; latest per date wins); `recon.get` (`{campus, date}` -> `{erp, daybook_fee_cash, deposited, unsigned: string[], overdue: boolean, differences: [{a,b,delta_paise}]}`). Rule: collection for date D is due for deposit by the end of the next calendar day (Asia/Kolkata); `overdue` is true after that while `deposited < daybook_fee_cash`. A deposit records the bank movement in the day book via a pair of entries (`deposit_cash_out`: cash OUT bucket `fee`; `deposit_bank_in`: bank IN) created by the same call.

- [ ] **Step 1: Tests**: `deposit without file_id refused`; `deposit creates both day-book legs and balances stay consistent`; `overdue false on D+1 23:59 and true after`; `partial deposit leaves overdue true with delta`; `ERP total differing from day book fee cash is listed in differences`; `sign by clerk refused, by FinanceHead sets signed_by and audits`; `deposit to a closed covers_date is allowed only if the deposit day itself is open` (covers_date may be closed; the deposit's own date is today). **Step 2-4:** fail, implement, pass. **Step 5: Commit** `feat(office): deposits, signing and reconciliation`.

### Task 9: Today tasks

**Files:** Create `apps-script/office-today.gs`, `tests/office/test-today.js`; modify `projects.json`.

**Interfaces:**
- Produces: `today.get` (`{campus}` -> `{date, tasks: [{id, title, due, status: 'done'|'due'|'overdue'|'waiting', action}]}`); registry `OFFICE_TODAY_PROVIDERS: Array<(ctx) => task[]>` so later plans add providers without editing this file's core. Providers in this plan: daily report (due 18:00; done when a report exists for today), deposit (overdue per Task 8), day close (visible to `FinanceHead`/`Owner`: due when the previous day has entries and is open), unsigned deposits (Finance Head). Tasks are filtered by caller role.

- [ ] **Step 1: Tests**: `clerk sees report and deposit tasks, not day close`; `report task flips to done after report.submit`; `finance head sees unsigned deposits and day close`; `provider that throws is skipped and reported as a task with status waiting, others still return`. **Step 2-4:** fail, implement, pass. **Step 5: Commit** `feat(office): today task list`.

### Task 10: Nightly backup

**Files:** Create `apps-script/office-backup.gs`, `tests/office/test-backup.js`; modify `projects.json`.

**Interfaces:**
- Produces: `officeBackupNightly()` (time trigger target), `officeInstallTriggers()` (run once by Uday), `officeBackupRetention_(names: string[], now: Date): string[]` (names to delete: keep last 30 daily and 12 monthly, a monthly copy being the first of each month). Copies each campus-year spreadsheet and the Config sheet into `OFFICE_BACKUP_FOLDER` as `<name> YYYY-MM-DD`; on any failure emails Uday via `MailApp` with the failed book name; never throws past the trigger.

- [ ] **Step 1: Tests**: `retention keeps 30 dailies and 12 first-of-month copies and returns the rest`; `one book failing still backs up the others and sends one failure email`; `success sends no email`. **Step 2-4:** fail, implement, pass. **Step 5: Commit** `feat(office): nightly backup with retention and failure alert`.

### Task 11: Client core: API client, outbox, formatting

**Files:** Create `office/js/api.js`, `office/js/outbox.js`, `office/js/format.js`, `tests/office/test-outbox.js`, `tests/office/test-api.js`, `tests/office/test-format.js`

**Interfaces:**
- Produces (ES modules usable in node tests with injected dependencies):
  - `format.js`: `formatInr(paise: number): string` (`₹1,23,456.50`), `parseRupeesToPaise(text: string): number | null` (accepts `1,234.50`, rejects `0`, negatives, more than 2 decimals), `isoToDmy`, `dmyToIso`.
  - `api.js`: `createApi({fetch, getToken, backendUrl, sleep}): {read(action, data), write(action, data)}`; retries with back-off on network errors and on HTML (non-JSON) responses up to 4 times; at most one in-flight request per `key` and later responses never overwrite a newer one (sequence numbers); surfaces `{code}` from failed responses.
  - `outbox.js`: `createOutbox({store, api, newId, onChange})` with `enqueue(action, data): Promise<id>` (assigns `id` UUID, persists to the store before returning), `flush(): Promise<void>`, `counts(): {waiting, attention}`, `attention(): Entry[]`, `retry(id)`, `discard(id)` (requires explicit call). A store is `{put, getAll, delete}` (IndexedDB adapter in `office/js/idb-store.js`; in-memory in tests). Rules: a `DAY_CLOSED` (or any 4xx `code`) response moves the entry to `attention`, never deletes it; network errors keep it `waiting`; `flush()` is single-flight.

- [ ] **Step 1: Write failing tests**: format (`formatInr(12345650) === '₹1,23,456.50'`, `parseRupeesToPaise('0.1') === 10`, `'0'`, `'-5'`, `'1.234'` return null); outbox (`enqueue persists before network`; `retry after network error sends the same id once`; `double flush sends once`; `DAY_CLOSED moves to attention and stays after reload` (Review Focus 1); `discard needs an explicit call`; `counts reflect waiting and attention`); api (`HTML response is retried`; `older response does not overwrite newer` (Review Focus 2); `token expiry error is surfaced, not retried`).
- [ ] **Step 2: Run** `node tests/office/test-outbox.js` etc. -> fail. **Step 3: Implement** the three modules and `idb-store.js`. **Step 4:** pass + `node tests/verify.mjs`. **Step 5: Commit** `feat(office): client api, outbox and formatting`.

### Task 12: PWA shell and Today screen

**Files:** Create `office/index.html`, `office/sw.js`, `office/manifest.webmanifest`, `office/js/shell.js`, `office/js/today.js`; modify `index.html` (add a "Fee Clerk + PRO" module card, status "Pilot") and `tests/verify.mjs` (add `office/` to the live page list in the same commit only after Task 16).

**Interfaces:**
- Consumes: Task 11; `assets/auth.js` (`LMCS.requireSession`, `LMCS.getSession`, `LMCS.signOut`).
- Produces: `shell.js` exports `bootOffice({onReady(session, api, outbox)})`; header sync indicator (`All synced` / `N waiting` / `Offline` / `N need attention`); sign-out is blocked with a warning while `counts().waiting > 0`; service worker caches the app shell only (never API responses or files); the Today screen renders `today.get` tasks with the clerk's day order and links to the module screens.

- [ ] **Step 1: Write failing test** `tests/office/test-shell.js` for the pure parts: `syncLabel({waiting, attention, online})` returns the four labels; `canSignOut` false while waiting. **Step 2:** fail. **Step 3:** implement; the sw uses a versioned cache name and cache-first for the shell assets only. **Step 4:** run tests, then load `office/index.html` through the Browser pane, sign in with a test allowlist row, and check the console is clean and the page works offline (service worker active). **Step 5: Commit** `feat(office): pwa shell and today screen`.

### Task 13: Day Book and Daily Report screens

**Files:** Create `office/daybook.html`, `office/report.html`, `office/js/daybook.js`, `office/js/report.js`; modify `office/index.html` (links).

**Interfaces:** Consumes Tasks 4, 6, 11. Entry forms use `parseRupeesToPaise`; submissions go through `outbox.enqueue('daybook.add' | 'daybook.reverse' | 'report.submit', ...)`; lists read `daybook.list` and merge locally queued entries marked "not yet synced"; correction UI offers Reverse (never edit/delete); the report form shows `cashMismatch` after submit; mobile layout first (large tap targets).

- [ ] **Step 1: Failing tests** `tests/office/test-daybook-view.js` for pure helpers: `mergeQueued(rows, outboxEntries)` marks unsynced rows and orders by date; `reportDraftToPayload(form)` converts rupees to paise and hourly rows. **Step 2-4:** fail, implement, pass; then a manual browser check at 375 px width (add a cash IN entry, go offline, add another, go online, see both sync). **Step 5: Commit** `feat(office): day book and daily report screens`.

### Task 14: Deposits and Finance Head close screens

**Files:** Create `office/deposits.html`, `office/close.html`, `office/js/deposits.js`, `office/js/close.js`.

**Interfaces:** Consumes Tasks 5, 7, 8, 11. Deposit form takes a camera/file input, resizes images client-side to a longest edge of 1600 px at JPEG quality 0.7 (helper `resizeImage(file): Promise<{base64, mime}>` in `office/js/image.js`), uploads through `outbox.enqueue('file.upload', ...)` then enqueues `deposit.add` referencing the same client-generated `file_id`; the close screen (FinanceHead/Owner) lists unsigned deposits and the recon differences, and closes a day only when `outbox.counts().waiting === 0` on that device (message explains other devices cannot be checked).

- [ ] **Step 1: Failing tests** `tests/office/test-deposits-view.js`: `resizeDims(4000, 3000, 1600) -> {1600, 1200}`; `closeBlockedReason({waiting: 2})` returns the unsynced message; `closeBlockedReason({waiting: 0, unsigned: 1})` warns but allows. **Step 2-4:** fail, implement, pass; browser-check one deposit with a photo and one close. **Step 5: Commit** `feat(office): deposits and day close screens`.

### Task 15: Day book history importer

**Files:** Create `tools/office-import-daybook.mjs`, `tests/office/test-import.js`, `tests/office/fixtures/daybook-legacy-sample.csv` (fake rows only).

**Interfaces:** `node tools/office-import-daybook.mjs <legacy.csv> --campus LMS1 --out <dir>` reads a CSV export of the legacy day book (Uday exports it from the Google Sheet; the CSV is never committed) and writes `daybook.csv`, `closes.csv`, `report.txt` in the `DayBook`/`Closes` column order; exports `mapLegacyRow(row, mapping): DayBookRow | {skip, reason}`, and `verifyTotals(rows, legacyTotals): {ok, diffs}`. Imported days are written as closed days with the legacy closing figures. A one-off Apps Script `officeImportRows_` (Owner-run from the editor) appends the CSV rows idempotently by deterministic ids (hash of campus + legacy row number).

- [ ] **Step 1:** Ask Uday to export the legacy Sheet (all history) as CSV and tell you the column meanings; write the mapping into the tool's `mapping.json` (kept outside the repo if it names real people). **Step 2: Failing tests** on the fake CSV: `rows map to paise exactly`; `unparseable rows are skipped with a reason, never guessed`; `totals per day match the legacy totals`; `re-running yields identical ids`. **Step 3-4:** implement, pass. **Step 5: Commit** `feat(office): legacy day book importer`. Do not run the real import until Task 16's pilot checklist says so.

### Task 16: Deploy, runbook and pilot go-live

**Files:** Create `docs/office-runbook.md`; modify `apps-script/projects.json` (fill `scriptId`, `deploymentId`), `apps-script/README.md`, `tests/verify.mjs` (add `office/` to the live pages).

- [ ] **Step 1 (Uday, one-time, ~15 min):** create the Apps Script project "LMCS Office Backend" (execute as: Me; access: Anyone), the Config spreadsheet, the LMS 1 `2026-27` spreadsheet, a Drive root folder and a Backups folder; set Script Properties `OFFICE_SS_LMS1_2026-27`, `OFFICE_CONFIG_SS`, `OFFICE_DRIVE_ROOT`, `OFFICE_BACKUP_FOLDER`, the Google client id and allowlist sheet id; add allowlist rows for the pilot clerk (`FeeClerk`, `LMS1`), a Finance Head and an Admin Manager with test accounts first. Record the script id in `projects.json`.
- [ ] **Step 2:** `node apps-script/deploy.mjs office` (dry run) -> `--push --deploy "office v1"`; record `deploymentId`; Uday runs `officeInstallTriggers()` once and opens the Backups folder to confirm the first copy appears next morning.
- [ ] **Step 3:** push `office/` pages; run `node tests/verify.mjs --live`; open the live `office/` in the Browser pane with a test account; walk the pilot checklist in `docs/office-runbook.md`: sign in, add entry offline then online, submit report before and after 18:00 (use a test date), deposit with photo, finance head signs and closes, owner reopens, backup copy exists, a restore drill (open the backup, compare closing totals with live).
- [ ] **Step 4:** write `docs/office-runbook.md` (add a campus, add a user, restore from backup, rotate the allowlist, what to do when an entry is in "needs attention", how to read the Audit tab).
- [ ] **Step 5:** with Uday's go-ahead only, run the legacy import for LMS 1, verify totals, start the one-month parallel run beside the paper day book. **Commit** `docs(office): runbook and pilot go-live`.

---

## Self-review notes

- Spec coverage: foundation (auth, store, audit, files, backups, sync) Tasks 1-2, 7, 10-12; modules 1-3 Tasks 4-9, 13-14; Today, rollout and migration Tasks 9, 15, 16. Modules 4-12, Admissions, Communications and the ERP import are explicitly deferred to later plans.
- Spec items not in this plan on purpose: chunked PDF upload over 3 MB (later, with Bills), ERP export import (needs Uday's format), approval limits (placeholder rows only, enforced in the Bills plan).
- Interfaces named once and reused: `officeAppend_`, `officeOpen_`, `officeBalances_`, `officeIsClosed_`, `officeNow_`, outbox `enqueue/flush/counts`.
