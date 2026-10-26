# Platform core + Approvals move (9–15 Nov 2026) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the platform core on Render and move Approvals (Approvals, Comments, follow-up allocation,
Recommendations, leave) onto it in the week of 9–15 November 2026, behind gates G1–G9, with the old portal pages and
every Apps Script reader still working.

**Architecture:** One Fastify server (TypeScript run directly by Node 22's type stripping, no build step) over one
Render Postgres with `tenant_id` + row-level security on every table. Approvals is ported from `apps-script/approvals.gs`,
`approvals-leave.gs`, `coordinator-approvals.gs` and `coordinator-recommend.gs`. **Those `.gs` files, run in a `vm` with
in-memory sheets (the pattern in `tests/hiring/test-actions.js`), are the parity oracle**: every ported action is
tested against them on the same fixture. Every platform write is copied to the "LMCS Approvals" Sheet in the same
request (columns 0–32, same cell types), so hiring, salary, payroll, the game and the Coordinator adapters keep reading
the Sheet unchanged. Old pages reach the platform through one switch in `assets/auth.js`.

**Tech Stack:** Node 22 (`node --test`; type stripping is on by default from 22.18, imports use `.ts` extensions and only erasable TypeScript syntax), TypeScript (strict, `tsc --noEmit` for checks), Fastify 5,
`postgres` (porsager), `google-auth-library` (ID-token verify + OAuth refresh) with plain `fetch` to the Sheets, Gmail
and Calendar REST APIs, `@aws-sdk/client-s3` for R2, `age` CLI for backup encryption. Render blueprint `render.yaml`.

**Spec:** `docs/superpowers/specs/2026-10-25-lmcs-platform-design.md` (approved 2026-10-26, "Approve with both calls").
Sections 6, 7, 9, 11, 11a, 12 and 13 are the ones this plan implements.

## Global Constraints

- Hosting: Render, Singapore region; web service Starter, Postgres Basic 1 GB. Uday creates every account and sets every secret; no session reads, prints or stores a secret value.
- Code lives in `platform/` (server, migrations, tools) in this repo. Platform tests run from `tests/verify.mjs`.
- Every table has `tenant_id uuid not null` and an RLS policy on `current_setting('app.tenant_id')`. LMCS is the only tenant (seeded). Nothing LMCS-specific in code: campuses, approval categories, leave types, department→role rules are seed data.
- Sign-in: Google ID token verified for audience `697999989724-mvi85iobr20g4mm8a8nrjd1rms2o8tf6.apps.googleusercontent.com`, `email_verified`, and `hd` in the tenant's allowed domains (`lms.org.in`). Person = Active Employee Master row whose `AuthEmail` matches, or an allowlist row. Allowlist roles (Owner, Coordinator, Principal, FeeClerk) win; otherwise department → role: Teaching/AdminPTI/AdminIT → Teacher; AdminClerk/Non-Teaching/Transport → Staff; AdminTM → none. The automatic roles sit behind a rollout switch `staff_auto_signin`, mirroring `STAFF_AUTO_SIGNIN`.
- Sessions: opaque random token (32 bytes, base64url), stored as SHA-256, 30 days sliding, sent as `Authorization: Bearer`. Never a cookie (app origin `https://kanwaruday.github.io`, API on `*.onrender.com`).
- CORS: only `APP_ORIGIN` (`https://kanwaruday.github.io`), credentials off.
- Every write takes an `Idempotency-Key` (client UUID); a repeat returns the first result.
- Write-through: Postgres change and Sheet write in the same request; **if the Sheet write fails, the change fails** (HTTP 503, `{ ok:false, error:'MIRROR_FAILED', retry:true }`). Postgres is the truth.
- Sheet cell types match today: timestamps as Sheets date-times (IST), leave dates as ISO text `YYYY-MM-DD`, numbers as numbers, blanks as `''`.
- Response JSON of every ported action is identical in shape to the Apps Script action it replaces.
- No personal data or secrets in the repo: fixtures are synthetic (`person1@example.test`, `T-0001`); real-data diffs go to the scratchpad only.
- Data conventions for any new Sheet column: vault `work/Portal Data Conventions.md`.
- Coordinator **Tasks** and HQ History stay on Sheets (Uday). Approvals' `closehiring` task and `apr_follow` resolutions cross over through bridges B3/B4.
- Env var names (values set by Uday on Render): `DATABASE_URL`, `APP_ORIGIN`, `GOOGLE_SIGNIN_CLIENT_ID`, `GOOGLE_BOT_CLIENT_ID`, `GOOGLE_BOT_CLIENT_SECRET`, `GOOGLE_BOT_REFRESH_TOKEN`, `APPROVALS_SHEET_ID`, `TEACHING_APPLICANTS_SHEET_ID`, `SYNC_SECRET`, `PDR_HOOK_URL`, `PDR_HOOK_SECRET`, `COORD_HOOK_SECRET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `BACKUP_AGE_RECIPIENT`.

## Review Focus

- **Two writers on one row**: a Coordinator resolving an `apr_follow` task while an Owner decides the same approval. Expect both changes to land, in order, and the Sheet row to equal Postgres afterwards (Task 9 test `concurrent decide and allocate keep the row consistent`).
- **Retry after a dropped connection** on a Principal's phone: the same `submitapproval` sent twice must create one approval and one mail (Task 9 test `idempotent submit`).
- **Sheet edited by hand after cut-over** (Uday owns the workbook, so protection can't stop him or Apps Script): the drift check must notice a mismatch and alert rather than silently overwrite (Task 10 test `drift is reported, not overwritten`).
- **A staff sync from a half-filtered Sheet** must not lock out a campus: a push that deactivates >10% of active people is refused (Task 3 test `refuses mass deactivation`).
- **Leave across a holiday or Sunday, and half days**: working days and the per-day contract must equal `aprLvApprovedDays_` exactly (Task 8 test `leave days match oracle across holidays and half days`).

## Local first, Render before the switch (Uday, 26 Oct: "Mac now, Render before Nov")

Building and testing run on Uday's Mac: a local Postgres 17 cluster (`~/.lmcs-pgtest`, port 54329) and, when needed, the
server started locally (`node platform/src/server.ts`, or a launchd service if it must stay up while he works). A free
Cloudflare Tunnel for phone testing is proposed as its own setup step only when it is useful. `platform/render.yaml`
stays as written, so the move to Render is a drop-in. **Nothing staff depend on runs on the Mac**: the old portal keeps
serving everyone until the cut-over, and the cut-over happens only on Render (gate G1). Q1 (Render) is sent on the
morning of 30 October (Uday: "make that 30th October"), giving about ten days on Render before the switch.

## Uday's setup quests (one at a time, each sent through the LMCS Master Agent when its task needs it)

Each quest says what to do, where, and how Claude checks it's done without seeing a secret. Buddy-style progress:
"Setup 3 of 8".

| Quest | When (needed by) | What Uday does | Done when (Claude checks) |
|---|---|---|---|
| Q1 Render | 30 Oct morning (Uday), ~10 days on Render before the switch; part of gate G1 | Sign up at render.com with his Google account, connect GitHub repo `kanwaruday/LMCSManagement`, then "New → Blueprint" with Blueprint file path `platform/render.yaml` on branch `claude/platform-design-91d594` (until platform merges to main). Render creates the web service and the Postgres in Singapore | `GET https://<service>.onrender.com/api/health` returns `{ ok:true, db:true }` |
| Q2 Platform Google account | Task 6 (~30 Oct) | Create a Workspace user for the platform (name his call, e.g. `portal-bot@lms.org.in`). Share with it: "LMCS Approvals" workbook (Editor), Teaching Applicants sheet (Viewer), the school holidays calendar (See all event details) | Health shows `google:true` after Q3 |
| Q3 Google authorisation | Task 6 | In Google Cloud console (project of the existing sign-in client), create an OAuth client of type "Desktop app"; put its id and secret into Render as `GOOGLE_BOT_CLIENT_ID` / `GOOGLE_BOT_CLIENT_SECRET`; on his Mac run `node platform/tools/google-authorize.mjs`, sign in **as the platform account**, and paste the refresh token it shows into Render as `GOOGLE_BOT_REFRESH_TOKEN`. Also set `APPROVALS_SHEET_ID`, `TEACHING_APPLICANTS_SHEET_ID` | `GET /api/health` → `google:true` (a read of the Approvals header row succeeds) |
| Q4 Sync secret | Task 3 (~31 Oct) | Generate a random secret (`openssl rand -base64 32`), put it in Render as `SYNC_SECRET` and in the Roster Apps Script project's Script Properties as `PLATFORM_SYNC_SECRET`, plus `PLATFORM_URL`. Then run `platformInstallTriggers` once from the editor | Health shows last staff sync and allowlist sync `ok` with row counts |
| Q5 Cloudflare R2 | Task 11 (~3 Nov) | Sign up at cloudflare.com, create bucket `lmcs-backups` (private), an API token scoped to that bucket (Object Read & Write); set the four `R2_*` vars on Render | Health shows last backup `ok` |
| Q6 Backup key | Task 11 | On his Mac: `brew install age && age-keygen -o lmcs-backup.key`; keep the file in his password manager and print it; put only the **public** key (`age1…`) into Render as `BACKUP_AGE_RECIPIENT` | Health shows last restore test `ok` |
| Q7 Bridge secrets | Task 10 (~4 Nov) | Two more random secrets: `PDR_HOOK_SECRET` (Render + PDR project Script Property `PLATFORM_HOOK_SECRET`) and `COORD_HOOK_SECRET` (Render + Coordinator project Script Property `PLATFORM_HOOK_SECRET`); `PDR_HOOK_URL` = the PDR `/exec` URL. Deploy both projects with `node apps-script/deploy.mjs <project> --push --deploy "platform hooks"` (Claude can run the deploy; Uday sets the properties) | `GET /api/health` → `hooks:{pdr:true,coord:true}` (signed ping round-trip) |
| Q8 Go | G9 (~8 Nov) | Read the gate report, answer "go" in the Master Agent chat, pick the cut-over evening | Recorded in the vault |

---

### Task 1: Platform skeleton, config, health, migrations, Render blueprint

**Files:**
- Create: `platform/package.json`, `platform/tsconfig.json`, `platform/render.yaml`, `platform/src/server.ts`, `platform/src/config.ts`, `platform/src/db.ts`, `platform/src/migrate.ts`, `platform/db/migrations/001_core.sql`, `platform/test/helpers.ts`, `platform/test/core.test.ts`
- Modify: `tests/verify.mjs` (add platform steps), `.gitignore` (`platform/node_modules`)

**Interfaces:**
- Produces: `loadConfig(env): Config` (throws listing missing names, never values); `sql` (postgres client); `withTenant<T>(tenantId: string, fn: (tx) => Promise<T>): Promise<T>` (transaction with `set_config('app.tenant_id', id, true)`); `migrate(sql): Promise<string[]>` (applies `db/migrations/*.sql` in name order, records in `schema_migrations`); `buildServer(deps): FastifyInstance`; `GET /api/health → { ok, db, google, hooks, lastSync, lastBackup, lastRestoreTest }`; test helper `testDb()` returning a fresh schema on `TEST_DATABASE_URL`.
- `001_core.sql`: `tenants(id, name, allowed_domains text[])`, `campuses(tenant_id, code, name)`, `people(tenant_id, id, employee_code, auth_email, name, campus_code, department, designation, reports_to, subjects text[], active, synced_at)`, `allowlist(tenant_id, email, name, campus_code, roles text[], can_approve bool)`, `role_rules(tenant_id, department, role)`, `sessions(tenant_id, token_hash, person_email, roles, campus_code, view_as, created_at, last_seen_at, expires_at, revoked_at)`, `switches(tenant_id, feature, scope_kind, scope_id, on)`, `audit_log(tenant_id, id, at, who, action, entity, entity_id, before jsonb, after jsonb)` (no UPDATE/DELETE grant), `idempotency(tenant_id, key, response jsonb, created_at)`, `jobs(tenant_id, id, kind, run_at, payload jsonb, locked_at, done_at, error)`, `sync_runs`, `health_events`. RLS enabled + policy on each; seed tenant LMCS, campuses LMS1–LMS6 + HES, the role rules from Global Constraints, switch `staff_auto_signin` off.

- [ ] **Step 1:** Install Postgres locally for tests (Uday's Mac already has PostgreSQL 17 in `/Applications`); set `TEST_DATABASE_URL` in the shell profile. Write `platform/test/core.test.ts`: `migrations apply to an empty database`, `loadConfig names missing vars without values`, `health reports db true`, `RLS hides another tenant's rows` (insert a second tenant + person, query under LMCS → 0 rows of the other).
- [ ] **Step 2:** `cd platform && node --test` → FAIL (modules missing).
- [ ] **Step 3:** Implement the files above. `render.yaml`: web service `lmcs-platform`, `region: singapore`, `plan: starter`, `runtime: node`, `rootDir: platform`, `buildCommand: npm ci`, `startCommand: node src/migrate.ts && node src/server.ts`, `healthCheckPath: /api/health`; database `lmcs-db`, `plan: basic-1gb`, `region: singapore`, Postgres 17; every secret env var listed with `sync: false`. Server sets CORS and security headers (CSP `default-src 'none'` on API responses).
- [ ] **Step 4:** `node --test` → PASS; `npx tsc --noEmit` → no errors. Add to `tests/verify.mjs`: `platform typecheck` and `platform tests` steps (fail if `TEST_DATABASE_URL` is unset, with a message saying how to set it).
- [ ] **Step 5:** `node tests/verify.mjs` → all checks passed. Commit `platform: skeleton, core schema with tenants and RLS, health, render blueprint`.
- [ ] **Step 6:** (moved) Quest Q1 is sent on the morning of 30 Oct (Uday); until then the server runs locally.

### Task 2: Sign-in, sessions, view-as, permission module

**Files:**
- Create: `platform/src/auth.ts`, `platform/src/permissions.ts`, `platform/test/auth.test.ts`, `platform/test/oracle.ts` (loads `.gs` files into a `vm` with in-memory sheets; reuse the `sheet()` helper shape from `tests/hiring/test-actions.js`)

**Interfaces:**
- Consumes: `withTenant`, `people`, `allowlist`, `role_rules`, `sessions`, `switches` (Task 1).
- Produces: `POST /api/session { idToken } → { token, expiresAt, person:{ email, name, campusId, role, roles[], employeeCode } }` (the `person` shape equals today's `auth.js` session fields `email, campusId, campusName, name, role`); `DELETE /api/session`; Fastify hook `requireSession` setting `req.caller: Caller { tenantId, email, roles: string[], campusId: string, canApprove: boolean, employeeCode: string|null, viewAs: boolean }`; `resolveCaller(tx, verifiedEmail, hd): Caller | null`; `assertWritable(caller)` (throws `VIEW_AS_READ_ONLY` when `viewAs`); `can(caller: Caller, action: ApprovalAction, row?: ApprovalRow): boolean` where `ApprovalAction` = `'list'|'detail'|'submit'|'comment'|'deleteComment'|'decide'|'archive'|'changeHiringReason'|'closeHiring'|'referees'|'allocate'|'recommend'|'trackRecord'|'decision'`.
- `oracle.ts` produces `loadPdrOracle(fixture: Fixture)` exposing the real `verifyCallerToken_`-side helpers (`pdrIsTeacherOnly_`, `aprCanDecide_`, `aprCanDecideAny_`, `aprCanDecideRow_`, `aprList_`, `aprDetail_`, …) over in-memory sheets, with `ScriptApp`, `UrlFetchApp` (token verify stubbed to return the fixture caller), `MailApp`, `CalendarApp`, `CacheService`, `LockService`, `PropertiesService` stubbed; and `loadCoordOracle(fixture)` the same for `coordinator-approvals.gs` + `coordinator-recommend.gs`.

- [ ] **Step 1:** Write `auth.test.ts`: `rejects token for another audience`, `rejects unverified email`, `rejects hd outside tenant domains`, `allowlist role wins over department role`, `department rules give Teacher/Staff/none` (one fixture person per department value), `auto roles only when staff_auto_signin is on`, `inactive person refused`, `sliding expiry extends last_seen and expires_at`, `revoked token refused`, `view-as refuses every write`. Plus the parity matrix `can() matches the PDR oracle for every role × action × row`: callers = Owner (ALL), Coordinator with and without CanApprove, Principal LMS1, Teacher LMS1, Staff LMS1, FeeClerk LMS1; rows = one per category incl. `Leave` (principal-decidable types from `APR_LEAVE_PRINCIPAL_TYPES`) on LMS1 and LMS2; expected = oracle's answer.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. ID token via `OAuth2Client.verifyIdToken`; injectable verifier for tests. Token: `crypto.randomBytes(32)`, store `sha256`. Sliding: every authenticated request moves `expires_at` to now + 30 days (at most once per hour, to spare writes).
- [ ] **Step 4:** Run → PASS. Before enabling the `hd` rule on Render, run `node platform/tools/allowlist-domains.mjs` (reads the allowlist through the sync table, prints **domain counts only**); any non-lms.org.in entry goes to Uday via the Master Agent.
- [ ] **Step 5:** `node tests/verify.mjs`; commit `platform: Google sign-in, sessions, view-as, permission parity with PDR`.

### Task 3: Staff and allowlist sync (push from the Roster project)

**Files:**
- Create: `platform/src/sync.ts`, `platform/test/sync.test.ts`, `apps-script/platform-push.gs`, `tests/apps-script/test-platform-push.js`
- Modify: `apps-script/projects.json` (add `platform-push` to `roster`)

**Interfaces:**
- Produces: `POST /api/sync/staff` and `POST /api/sync/allowlist`, body `{ sentAt, rows: [...] }`, header `X-Sync-Signature: hex(HMAC-SHA256(SYNC_SECRET, sentAt + '.' + rawBody))`; rejected if signature bad or `sentAt` older than 5 minutes. Staff row fields: `employeeCode, authEmail, name, campusId, department, designation, reportsTo, subjects[], active`. Allowlist row: `email, name, campusId, roles (comma list), canApprove`. Response `{ ok, received, changed, deactivated, refused? }`. `POST /api/sync/request` (Owner only) sets a flag the next 5-minute trigger poll picks up.
- `platform-push.gs`: `platformPushStaff()` (nightly 02:00 IST), `platformPushAllowlist()` (hourly), `platformPollRequest()` (every 5 min: GET `/api/sync/pending` signed; pushes if asked), `platformInstallTriggers()`. Reads EmpMaster/EmpSalary and the allowlist with the existing readers in `employee-roster.gs` / `principal-allowlist.gs`; sends only the fields above. Never Aadhaar, PAN, bank or salary columns.

- [ ] **Step 1:** `sync.test.ts`: `upsert by employee code`, `missing people marked inactive not deleted`, `refuses mass deactivation` (11 of 100 active missing → `refused:'MASS_DEACTIVATION'`, nothing changed, health event raised), `bad signature 401`, `stale sentAt 401`, `allowlist removal revokes sessions`, `run logged in sync_runs`. `test-platform-push.js` (vm): payload contains exactly the allowed keys; signature matches a Node HMAC of the same input.
- [ ] **Step 2:** Run both → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS; `node apps-script/deploy.mjs roster` (dry run) lists `platform-push`.
- [ ] **Step 5:** `node tests/verify.mjs`; commit. Send quest Q4; after Uday sets the properties and runs `platformInstallTriggers`, deploy roster (`--push --deploy "platform push"`) and check health shows both syncs `ok` with counts.

### Task 4: Approvals schema, import and Sheet-row export (round trip)

**Files:**
- Create: `platform/db/migrations/002_approvals.sql`, `platform/src/approvals/rows.ts`, `platform/tools/approvals-import.mjs`, `platform/test/approvals-rows.test.ts`, `platform/test/fixtures/approvals-sheet.json` (synthetic, one row per category, leave rows with half days, archived, referred, allocated, commented, recommended + superseded)

**Interfaces:**
- Produces tables: `approvals` (one column per Sheet column 0–24, typed; `sheet_row int` remembered for the mirror; `updated_at`, `version int`), `approval_leave` (cols 25–32), `approval_comments`, `approval_recommendations`. Seed tables: `approval_categories(tenant_id, name, shows_item, shows_qty, …)` and `leave_types` from `APR_CATEGORIES` / `approvals-leave.gs` constants.
- `sheetRowToRecord(row: CellValue[]): ApprovalRecord`, `recordToSheetRow(rec: ApprovalRecord): CellValue[]` (33 cells), same pair for comments (`commentRowToRecord`, `recordToCommentRow`) and recommendations, where `CellValue = string | number | boolean | { dateTime: string /* ISO with +05:30 */ }`.
- `approvals-import.mjs --from <xlsx|json export> --tenant LMCS [--dry-run]`: loads, prints counts per tab, status, category and the amount total; with `--dry-run` writes nothing.

- [ ] **Step 1:** Test `round trip is cell-for-cell` (fixture → record → row equals fixture for all 33 columns, including blanks and date-times), `leave columns map both ways`, `unknown category kept, not dropped`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** verify; commit `platform: approvals schema and sheet round trip`.

### Task 5: Google client (Sheets, Gmail, Calendar) and the mirror writer

**Files:**
- Create: `platform/src/google.ts`, `platform/src/approvals/mirror.ts`, `platform/tools/google-authorize.mjs`, `platform/test/mirror.test.ts`

**Interfaces:**
- Produces: `google.sheetsValues(sheetId, range)`, `google.sheetsUpdate(sheetId, range, values: CellValue[][])` (`valueInputOption=USER_ENTERED`; date-times sent as `yyyy-MM-dd HH:mm:ss` IST so the cell stays a date, ISO-date text sent with a leading `'`), `google.sheetsAppend(...)`, `google.gmailSend({ to[], cc[], subject, html })`, `google.calendarEvents(calendarId, fromISO, toISO)`; all with an injectable `fetch` for tests. `mirror.writeApproval(tx, rec)`, `mirror.writeComment(...)`, `mirror.deleteComment(...)`, `mirror.writeRecommendation(...)`: find the row by id in column A (cached id → row map, re-read on mismatch), update or append; serialised with `pg_advisory_xact_lock(hashtext('approvals-mirror'))` (ponytail: one lock for the workbook, fine at this volume). `google-authorize.mjs`: loopback OAuth for scopes `spreadsheets`, `gmail.send`, `calendar.readonly`, shows the refresh token on Uday's screen only.
- `GET /api/health` `google` = header read of `Approvals!A1:AG1` succeeds.

- [ ] **Step 1:** `mirror.test.ts` with a fake Sheets API: `update finds row by id after rows shift`, `append for new id`, `failure surfaces as MirrorError`, `date-times sent as IST date-time strings`, `leave dates sent as text`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** verify; commit. Send quests Q2 and Q3 (one at a time). Check `google:true`.

### Task 6: Approvals read actions

**Files:**
- Create: `platform/src/approvals/read.ts`, `platform/test/approvals-read.test.ts`

**Interfaces:**
- Consumes: `can`, `requireSession`, Task 4 tables, `google.sheetsValues` (B2: Teaching Applicants MD-interview column, as `aprAnnotateAwaitingMd_` / `hirSalaryOfferGateCheck_` read it).
- Produces: `GET /api/approvals/approvalslist`, `/approvaldetail?id=`, `/approvalreferees`, `/coordinatortrackrecord`, `/coordinatordecision?id=`, each returning exactly the JSON the PDR / Coordinator action returns (`aprList_`, `aprDetail_`, `aprReferees_`, `coordTrackRecordGet_`, `coordDecision_`).

- [ ] **Step 1:** Parity tests: for each action × each caller of the Task 2 matrix, `platform output deep-equals oracle output` on `fixtures/approvals-sheet.json` (oracle = `loadPdrOracle` / `loadCoordOracle` over the same rows). Include `awaitingMd` with a Teaching Applicants fixture.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** verify; commit.

### Task 7: Approvals write actions with write-through, idempotency, audit and mail

**Files:**
- Create: `platform/src/approvals/write.ts`, `platform/src/approvals/mail.ts`, `platform/src/idempotency.ts`, `platform/test/approvals-write.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 4, 5, 6.
- Produces: `POST /api/approvals/{submitapproval|addapprovalcomment|deleteapprovalcomment|decideapproval|archiveapproval|changehiringreason|closehiring|coordinatorallocate|coordinatorrecommend}` with the same bodies and responses as today (minus `idToken`, replaced by the bearer token). Each: `assertWritable` → `can` → idempotency check → Postgres change in `withTenant` transaction → `audit()` → mirror write → commit → mail via `jobs` (sent after commit, so a retried request never double-mails). `decideapproval` on Salary Offer Approval runs the MD-interview gate (B2) first and refuses as `aprDecide_` does. `closehiring` and New/Backup Position decisions enqueue a `pdr_hook` job (Task 10).
- `idempotency.run(tx, key, fn)`: returns stored response for a seen key.

- [ ] **Step 1:** Tests: `each write matches oracle's resulting Sheet rows` (run the `.gs` write on in-memory sheets and the platform write on the same start state; compare the mirror's written rows with the oracle's rows, ignoring generated ids and timestamps), `idempotent submit` (same key twice → one row, one mail job), `mirror failure rolls back` (fake Sheets 500 → no Postgres row, 503 `MIRROR_FAILED`), `salary offer gate refuses without MD interview`, `view-as write refused`, `concurrent decide and allocate keep the row consistent` (two parallel requests on one id → final Postgres row equals final Sheet row and both changes present), `mail content matches oracle MailApp calls` (recipients, subject).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** verify; commit.

### Task 8: Leave (working days, holidays) and the unchanged leave contract

**Files:**
- Create: `platform/src/approvals/leave.ts`, `platform/test/leave.test.ts`

**Interfaces:**
- Consumes: `google.calendarEvents` (B6) in place of `pdrSchoolCalendarEvents_`; Task 7 submit path for category `Leave`.
- Produces: `validateLeave(input, nowIst, holidays): LeaveResult` and `approvedLeaveDays(rows, query, holidaysFor)`, ports of `aprLvValidate_` and `aprLvApprovedDays_`. The `approvedleave` action **stays on Apps Script** and keeps reading the Sheet copy.

- [ ] **Step 1:** Tests: `leave days match oracle across holidays and half days` (a month of fixtures with Sundays, a holiday, `dayPart` half, overlapping requests, Compensatory Leave), `notice days and deduction match`, `overlap refused as oracle`, and `approvedleave on the mirrored rows equals approvedleave on the original rows` (run `aprLvApprovedLeaveAction_` in the oracle twice).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** verify; commit.

### Task 9: Old pages switch to the platform (B5)

**Files:**
- Modify: `assets/auth.js` (add `APPROVALS_BACKEND`, token exchange, `LMCS.approvals(action, params, body?)`), `principals-daily-reporting/index.html`, `teacher/index.html`, `salary/index.html` (submitapproval only), `coordinator/approvals.js`, `coordinator/hq.html`, `coordinator/hq-logic.js`
- Test: `tests/auth/test-approvals-backend.js`, `tests/fetchcache/test-fetchcache.js` (update keys)

**Interfaces:**
- Produces: `LMCS.approvals(action: string, params?: Record<string,string>, body?: object): Promise<any>`: when `APPROVALS_BACKEND === 'pdr'` it calls PDR/Coordinator exactly as today; when `'platform'` it calls `${PLATFORM_API}/api/approvals/<action>` with the bearer token and a fresh `Idempotency-Key` for POSTs (kept across retries of the same submit). At sign-in, `requireSession` also exchanges the Google ID token at `POST /api/session` and stores the platform token in `localStorage['lmcs_platform_token']`; on 401 it re-exchanges once. `APPROVALS_BACKEND` starts as `'pdr'`.

- [ ] **Step 1:** `test-approvals-backend.js` (vm with stubbed `fetch`): `pdr mode hits the PDR URL with idToken`, `platform mode hits /api/approvals with bearer`, `retry reuses the idempotency key`, `401 re-exchanges once`. Update `test-fetchcache.js` for the new keys.
- [ ] **Step 2–4:** FAIL → implement, change each page's approvals calls to `LMCS.approvals(...)` (no other change) → PASS.
- [ ] **Step 5:** verify; push to `main` (pages behave exactly as before, mode `pdr`); `node tests/verify.mjs --live`; load the five pages in the browser pane and check the console. Commit.

### Task 10: Apps Script bridges (B3, B4), "moved" guard, drift check

**Files:**
- Create: `apps-script/platform-hooks.gs` (PDR project), `platform/src/approvals/drift.ts`, `platform/test/drift.test.ts`, `tests/approvals/test-platform-hooks.js`
- Modify: `apps-script/main.gs` (route `platformhook`; return `{ ok:false, error:'MOVED' }` for Approvals write actions when Script Property `APPROVALS_MOVED` is `TRUE`), `apps-script/coordinator.gs` / `coordinator-approvals.gs` (`apr_follow|` resolutions and `coordinatorallocate` call the platform when `APPROVALS_MOVED`), `apps-script/projects.json`

**Interfaces:**
- B3 `POST PDR?action=platformhook` body `{ sentAt, kind:'position_sync'|'closed_hiring_task', approvalId, sig }` with HMAC on `PLATFORM_HOOK_SECRET` → runs `hirQueuePositionSync_()` or `aprRaiseClosedHiringTask_(row)`. Platform job `pdr_hook` retries with backoff and shows failures on health.
- B4 platform `POST /api/hooks/coord/followup` (HMAC `COORD_HOOK_SECRET`) `{ approvalId, followUp:{…cols 19–24} }` → same write path as `coordinatorallocate`.
- `drift.check()` every 15 min (job): reads Approvals/Comments/Recommendations from the Sheet, compares with `recordToSheetRow` of Postgres; on mismatch records a health event and alerts the Owner by mail; **never overwrites**. `POST /api/admin/mirror/rewrite?id=` (Owner) rewrites one row on purpose.

- [ ] **Step 1:** `test-platform-hooks.js` (vm): bad signature refused; good one calls the right function; `APPROVALS_MOVED` makes `submitapproval` answer `MOVED` while `approvalslist` and `approvedleave` still work. `drift.test.ts`: `drift is reported, not overwritten`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** verify; dry-run both deploys; send quest Q7; then deploy PDR and Coordinator (`--push --deploy "platform hooks"`, `APPROVALS_MOVED` still unset, so nothing changes for users); `verify --live`; commit.

### Task 11: Backups and restore test

**Files:**
- Create: `platform/backup/Dockerfile` (from `postgres:17`, adds `age` and `awscli`), `platform/backup/run.sh`, `platform/test/backup-retention.test.ts`, `platform/src/backup-retention.ts`
- Modify: `platform/render.yaml` (cron job `lmcs-backup`, `runtime: docker`, `schedule: "0 21 * * *"` = 02:30 IST, region singapore)

**Interfaces:**
- `run.sh`: `pg_dump -Fc "$DATABASE_URL" | age -r "$BACKUP_AGE_RECIPIENT" > dump.age`, upload to `s3://$R2_BUCKET/daily/YYYY-MM-DD.dump.age` (R2 endpoint), on the 1st also `monthly/YYYY-MM.dump.age`; prune by `keepList(keys, today)` (30 daily, 12 monthly); on the 1st of the month (and on the first run) restore the newest **unencrypted** dump into a scratch database created with `createdb`, compare `count(*)` per table with production, drop it; POST the result to `/api/health/backup` (signed with `SYNC_SECRET`). The restore test restores from the in-job unencrypted dump; decryption with Uday's private key is tested once by hand (Step 5).
- `keepList(keys: string[], today: string): string[]`.

- [ ] **Step 1:** `backup-retention.test.ts`: `keeps 30 daily and 12 monthly`, `never deletes the newest`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** verify; commit; send quests Q5 and Q6; trigger the cron once from Render; check health `lastBackup ok`, `lastRestoreTest ok`. Ask Uday to decrypt one dump on his Mac (`age -d -i lmcs-backup.key …`) and say whether it worked.

### Task 12: Gate run and cut-over

**Files:**
- Create: `platform/tools/approvals-replay.mjs` (G3), `platform/tools/approvals-dryrun.mjs` (G4), `platform/tools/downstream-check.mjs` (G5), `docs/superpowers/plans/2026-10-26-approvals-gate-report.md` (results only, no data)

**Interfaces:**
- `approvals-replay.mjs`: runs on Uday's Mac with his own signed-in ID token pasted by him into the terminal (never into chat), calls every read action on PDR and on the platform for his Owner session and for each `view-as` scope, writes diffs to the scratchpad, prints only "N actions, M differences".
- `approvals-dryrun.mjs`: imports a fresh export into a scratch schema, prints counts per status/category, amount total, leave working days, and whether `recordToSheetRow` reproduces the export cell for cell.
- `downstream-check.mjs`: runs `hiring.gs` (`hirApprovedRequisitions_`, `hirSalaryOfferDecisions_`, `hirIsHiringApproved_`), `payroll.gs` (`payApprovalStatus_`), `salary.gs` (`salEpfExemptionApproved_`), `game-missions.gs` (one day's missions for an Owner, a Coordinator and a teacher) and the Coordinator approvals adapter in the vm oracle twice: over the original export and over the platform-written rows; prints differences.

- [ ] **Step 1:** Run G1 (health), G2 (Task 2 matrix in CI = pass), G3, G4, G5, G6 (Task 8 contract test on the real export, locally), G7 (Uday submits one test approval, decides it, comments: he confirms three mails arrived and read right), G8 (set `APPROVALS_BACKEND='platform'` on a preview branch, use it, flip back, confirm Sheet unchanged and PDR serving). Write `…-gate-report.md` with pass/fail per gate.
- [ ] **Step 2:** Send the report to the Master Agent for Uday (quest Q8). **If any gate fails on 13 November, stop: the move slips; tell the Master Agent which gate and why.**
- [ ] **Step 3 (cut-over evening, after "go"):** set PDR and Coordinator Script Property `APPROVALS_MOVED=TRUE`; run `approvals-import.mjs` on a fresh export (no `--dry-run`); re-run G3 + G4; set `APPROVALS_BACKEND='platform'` in `assets/auth.js`, verify, push; `verify --live`; open each of the five pages in the browser pane as Uday, check console; drift check clean after 15 min.
- [ ] **Step 4 (rollback, any time in two weeks):** set `APPROVALS_BACKEND='pdr'`, push; unset `APPROVALS_MOVED`. The Sheet is current, so nothing else is needed.
- [ ] **Step 5 (after two quiet weeks):** remove the Apps Script Approvals write actions; record in the vault (`lmcs-software-platform.md`) and the design doc.

## Schedule (target)

| Dates | Work |
|---|---|
| 27 Oct – 1 Nov | Tasks 1–5 locally; quest Q1 (Render) on 30 Oct, then Q2–Q4 |
| 2 – 6 Nov | Tasks 6–11; quests Q5–Q7 |
| 7 – 8 Nov | Task 12 gates; report; Q8 |
| 9 – 13 Nov | Cut-over evening after "go"; slip decision by Fri 13 Nov |
