# LMCS platform: Postgres + React (design)

Date: 2026-10-25. Asked for by Uday ("Design platform first", in the LMCS Master Agent chat), so the stack choice
that shapes every module gets its own design instead of being made inside the messaging plan. **Uday's decisions
are marked "Uday"; everything else is Claude's call** and open to his correction.

Status: **draft, not approved.** Nothing is built, no account exists, nothing is deployed.

Belongs to the umbrella project in the vault, `work/active/lmcs-software-platform.md`. Builds on:
- the approved messaging design (branch `portal-messaging-design`, 703ae2f,
  `docs/superpowers/specs/2026-10-25-portal-messaging-design.md`), the first module on this platform, and its
  12 platform requirements (side-session note `messaging-platform-requirements.md`);
- the game layer design and Phase 1 plan (branch `portal-game-layer-design`), which is being built on Apps Script now
  and goes fully live in March 2027 (Uday);
- the Fee Clerk portal design (`2026-10-21-campus-office-portal-design.md`): "once it is complete, the whole platform
  moves to a Postgres backend and a React front end", data built to migrate, idempotent outbox, "no Supabase";
- the local React rebuild for Coordinator + Owner (`docs/superpowers/specs/2026-10-20-react-coordinator-owner-design.md`,
  in Uday's main checkout, not committed): Vite, React 18, TypeScript strict, React Router, TanStack Query;
- today's portal: static GitHub Pages site (public repo `kanwaruday/LMCSManagement`), `assets/auth.js` (Google
  Identity Services, the "LMCS Principal Allowlist" Sheet, session until the next 6 PM), eight Apps Script projects
  in `apps-script/projects.json`, deployed with `apps-script/deploy.mjs`.

## Intent and why

- Apps Script cannot hold open connections or send push, and polling from ~170 phones would hit its quotas. Messaging
  needs a real server (Uday: messaging is "built on Postgres + React").
- The Fee Clerk design already committed the portal to a single later move: the whole platform goes to Postgres +
  React. This design is that destination, so each module moves once, onto the same foundation, instead of each
  module inventing its own server.
- **Why (Claude's reading).** Today every module is a Sheet behind its own Apps Script deployment, with its own copy
  of auth checks, caching workarounds and slowness (vault memory: Drive scans, 2–40 s allowlist reads, keep-warm
  pings). One database, one server, one sign-in and one set of shared parts (notifications, files, rollout
  switches, audit log) is what lets the "whole portal becomes a game" direction work across modules.

## Goals

1. A platform messaging can be built on: long-running server with WebSockets, web push, Postgres, private file
   storage, Google sign-in against the existing allowlist and roles.
2. Stays up with Uday's Mac off. The Mac is only ever an optional worker (transcripts, LM Studio).
3. Budget-conscious: a fixed, small monthly bill, no per-seat pricing.
4. Uday is never the sysadmin: no server to patch, backups that run and are tested without him.
5. Lives alongside GitHub Pages and the Apps Script backends for as long as migration takes, with no module
   breaking on the day another moves.
6. Each existing module can later move onto it one at a time, in an order that never puts the March 2027 game
   go-live at risk.

## Non-goals

- Building anything now. This is a design; the build plan comes after approval, and messaging's plan after that.
- Replacing the third-party ERP (fees, marks, statutory payroll) in this design.
- Moving any existing module in the first release. The first release is the platform core plus messaging.
- Parent or student access.
- Multi-region, high-availability, Kubernetes, message brokers, microservices. ~170 users is one small server.

## Anti-goals (a failure even if it works)

- **Two writers for one dataset.** If a Sheet and Postgres can both be edited for the same records, they will drift.
  Every dataset has exactly one owner system at any moment (see Coexistence).
- **Personal data in the public repo** or in static files: no names, phone numbers, emails, Employee Codes, Sheet or
  database ids with access, in code, fixtures, tests or docs. Fixtures are synthetic.
- **Claude handling secrets.** Uday creates every account and sets every secret (database URL, OAuth client secret,
  VAPID keys, sync secrets, backup key). No session reads, prints or stores them.
- **One copy of the school's data, at one vendor.** Backups must exist outside the hosting provider and be
  restore-tested.
- **A big-bang cut-over.** Principals use these pages daily (Uday's standing constraint: incremental, low-risk).
- **A second sign-in system to manage.** Staff keep signing in with their lms.org.in Google account; the allowlist
  stays one list.

## Decisions

Each has options and a recommendation. Ones Uday has answered are marked; the rest are Claude's calls.

### 1. Server language and framework

| Option | For | Against |
|---|---|---|
| **A. Node.js 22 LTS + TypeScript, Fastify** (recommended) | Same language as the React front end and every existing script (`deploy.mjs`, `tests/verify.mjs`, `capture.js`); first-class WebSockets (`@fastify/websocket`) and web push (`web-push`); Fastify is small, fast and schema-validated | None significant at this size |
| B. Python + FastAPI | The drive-index pipeline is Python | Two languages across front and back; the portal's own tooling is all JS |
| C. Next.js full-stack | One framework | Pulls toward serverless hosts that can't hold WebSockets; heavier than needed for a sign-in-only app (no SEO) |

**Recommendation: A.**
- **Database access:** the `postgres` driver (porsager) with plain SQL, and numbered `.sql` migration files applied in
  order by a small runner that records them in a `schema_migrations` table. No ORM: the schema stays readable SQL
  that the Fee Clerk CSV exports load into directly. (Claude's call; the builder may pick a query builder such as
  Kysely if plain SQL gets repetitive.)
- **Real-time:** one server process holds every WebSocket. If a second instance is ever needed, fan out with
  Postgres `LISTEN/NOTIFY`; no broker. (ponytail: single instance; ceiling is thousands of sockets, far above 170.)
- **Background jobs:** a `jobs` table polled by the same process (scheduled messages, reminders, push retries) and by
  the Mac workers. No queue service.

### 2. React setup

- One React app for the whole platform: **Vite, React 18, TypeScript strict, React Router, TanStack Query**, the same
  stack as the 2026-10-20 Coordinator + Owner rebuild, so those screens fold in when their modules move.
- **Installable PWA:** web app manifest plus a hand-written service worker for push, notification clicks and the
  offline outbox. (Claude's call: hand-written, since push handling is ~50 lines; the builder may use
  `vite-plugin-pwa` in `injectManifest` mode if precaching gets fiddly.)
- **Where the app is served: GitHub Pages for now** (Uday, 2026-10-26: "for the time being can we not use something
  over github? Once this is done we are any ways going professional"). The built React app lives at
  `kanwaruday.github.io/LMCSManagement/app/`; the API, WebSockets and Postgres are on Render at Render's own address
  (e.g. `lmcs-platform.onrender.com`). The move to a school domain such as `app.lms.org.in` comes later. See
  "Serving from GitHub Pages" below for what this changes.
- **How it gets onto Pages** (Claude's call): Pages publishes `main` from the repo root ("deploy from branch"), so the
  build output is committed to an `app/` folder by a deploy script, `platform/deploy-web.mjs`, the same way
  `deploy.mjs` ships Apps Script: build, replace `app/` (stale hashed files removed), commit, push. No change to the
  repo's Pages settings, so the live portal's publishing can't break. (A sibling repo with its own Pages is the
  alternative; it splits the code across two repos for no gain.)
- **The address lives in config, in two values only:** `APP_ORIGIN` + `APP_BASE` on the server (CORS, WebSocket
  origin check, links in notifications) and `VITE_API_URL` in the web build. Moving to the school domain later is
  changing those, a DNS record and the OAuth origin; no code.
- **375 px Android first**, then desktop, using the project's LMCS design skills (frontend-design-for-lmcs,
  impeccable-for-lmcs, taste-for-lmcs) already installed for the rebuild.
- **Outbox for every write** (Fee Clerk pattern): the client gives each create a UUID and sends it as an
  `Idempotency-Key`; the server stores the key with a unique constraint, so a resend after a dropped connection never
  duplicates.

### 3. Where the code lives

- **Same repo, new top-level `platform/` folder** (`platform/server`, `platform/web`, `platform/db/migrations`).
  Code is public, as the whole portal's code already is; data and secrets never are. (Claude's call. A private repo
  is the alternative if Uday ever wants the server's code hidden; it changes nothing else in this design.)
- `tests/verify.mjs` gains the platform: type-check, server tests, the migration files apply cleanly to an empty
  database, and a scan that fails on anything that looks like personal data or a secret. The scan is strict for
  everything under `platform/`; for the rest of the repo it checks only lines added since `main`, because existing
  files already carry ids the old portal needs (the OAuth client id, Apps Script deployment ids, the admin email)
  and cleaning those would mean touching live pages. (Claude's call, from the builder check.)
- `main` still publishes GitHub Pages. The platform deploys from `main` too, but only when `platform/` changes.

### 4. Hosting

Must hold WebSockets, send push, stay up with the Mac off, and cost little. Uday is in Himachal.

| Option | Monthly (list price, confirm at sign-up) | For | Against |
|---|---|---|---|
| **A. Render, Singapore** (recommended) | ~$26 (~₹2,200): web service Starter $7 + Postgres 1 GB $19; small extra for the backup cron | Managed server and managed Postgres with daily backups and point-in-time restore; deploys from GitHub; nothing to patch; holds WebSockets on paid plans | Singapore, not India (~80 ms from Himachal); more than a VPS |
| B. One VPS in Mumbai (Lightsail / DigitalOcean Bangalore) | ~$10–12 (~₹1,000) | Cheapest, closest | Someone patches the OS, runs Postgres and its backups, and notices when it is down; that someone ends up being Uday |
| C. Google Cloud Run + Cloud SQL, Mumbai | ~$40+ | Inside Google; India region | WebSockets need an always-on instance plus Cloud SQL; the most complex billing |
| D. Supabase / Neon / Vercel | varies | Generous free tiers | Supabase was dropped in the Fee Clerk design; Vercel can't hold WebSockets; Neon still needs a separate app host |

**Decided: A, Render Singapore** (Uday, 2026-10-25: "Render, Singapore"). Managed server plus managed Postgres,
about $26/month, with the nightly encrypted copy to Cloudflare R2 on top. Uday signs up and sets every secret
himself when the build starts.

Data location (Claude's reading, not legal advice): India's DPDP Act allows transfer abroad except to countries the
government restricts; Singapore is not restricted today. This goes into the DPDP advice Uday is already getting
before rollout.

### 5. Postgres, backups and files

- **Database:** the host's managed Postgres (Postgres 16 or later), one database for every module. Extensions:
  `pg_trgm` (search on Hindi and transliterated text, as messaging needs), `pgcrypto` (UUIDs).
- **Backups, three layers:**
  1. The host's own daily backups and point-in-time restore.
  2. **A nightly `pg_dump` copy outside the host**: a scheduled job (02:30 IST) dumps the database, encrypts it with
     an [age](https://age-encryption.org) public key, and uploads it to a Cloudflare R2 bucket. Uday keeps the
     private key offline (password manager plus a printed copy); the server only ever has the public key, so a
     leaked bucket is useless. Keep 30 daily and 12 monthly copies.
  3. **A monthly restore test**: the same job restores the latest dump into a scratch database, checks row counts
     against production, drops it, and writes the result to the platform's health page. A failed backup or restore
     test sends Uday a push and an email.
- **Files** (photos, documents, voice notes): a **private Cloudflare R2 bucket** (S3-compatible, ~10 GB free, no
  download fees). The server checks access, then hands the browser a signed link valid for 5 minutes, for upload or
  download. Nothing is public. Images and voice are compressed in the browser before upload, for weak connections.
  (Claude's call. Google Drive was rejected because the Workspace blocks Drive for scripts and Drive gives no
  signed-link model.) Files are never hard-deleted except by the Owner's legal delete, so the bucket itself is the
  record; the builder may add a weekly copy to a second bucket if that ever feels thin.
- **Retention:** indefinite, soft deletes everywhere (messaging rule), revisited with the DPDP advice.

### 6. Google sign-in against the existing allowlist

- **Same Google OAuth client** as today's portal (Uday adds the platform's address as an authorised origin in Google
  Cloud console). The browser signs in with Google Identity Services and sends the ID token to the server once.
- **The server verifies it** (`google-auth-library`): signature, audience = our client id, `email_verified`, and
  `hd = lms.org.in`. Then it looks the email up in the **allowlist and staff tables in Postgres** (synced from the
  Sheets, below). Not on the list: refused, with the same message today's portal shows.
- **Who may sign in** (Uday, 2026-10-25, for the current portal: "populate all employees to the allow list",
  then "Automatic, but all employees"): every **Active** employee in the Employee Master whose `AuthEmail` matches
  their verified Google sign-in gets in, with an automatic role from their department and job. Roles already on the
  allowlist (Principal, Coordinator, Owner, FeeClerk) win over the automatic role. The platform uses the same rule
  and the same department-to-role mapping as the Apps Script side (Uday, via the Teacher chat, keyed on the Employee
  Master department `EmpSalary.Department`): Teaching, AdminPTI and AdminIT → **Teacher**; AdminClerk, Non-Teaching
  and Transport → **Staff** (new self-service role, no office powers); AdminTM → no automatic role (allowlist only).
  On Apps Script it sits behind the `STAFF_AUTO_SIGNIN` switch, off until Uday turns it on; on the platform the same
  rule sits behind a rollout switch. The mapping is stored as data, not code, so a change there is a config edit.
  `AuthEmail` and department are therefore synced fields.
- **Linking a person:** allowlist row and Employee Master row are matched by `AuthEmail`. Each sync reports staff with a missing, duplicated or
  non-lms.org.in email, so they can be fixed in the Sheet; until fixed, such a person can't be linked to their
  Employee Code and is left out of HOD routing, Reports To and the 10% safety count. (Claude's call.)
- **The domain check is new** (today's `auth.js` doesn't check `hd`). Before it goes live, the first build task
  checks the allowlist for non-lms.org.in addresses (counting domains only) so no one, an Owner say, is locked out
  on day one; any such address is moved to an lms.org.in account first. (Claude's call.)
- **Session:** the server issues its own session token (sent as an `Authorization: Bearer` header, not a cookie;
  see "Serving from GitHub Pages"), stored server-side in a `sessions` table so it can be revoked (sign out everywhere, or the Owner revoking a person). **Sessions last
  30 days, sliding** (Claude's call: today's portal ends every session at 6 PM, which would make a messaging app
  useless after hours and would break notification taps; revocation replaces the daily expiry as the safety net).
  Removing someone from the allowlist ends their sessions at the next sync.
- **Roles** come from the allowlist (Owner, Coordinator, Principal, Fee Clerk, Teacher) plus staff data (HOD, which
  messaging adds). **Every permission check lives in one server module**; pages never decide access.
- **"View as"** (Owner role): a session flag the server enforces: every write is refused while it is on, and the UI
  shows a banner. Read-only by construction, not by hiding buttons.
- **Read-all for the Owner role** (messaging: "Everyone with Owner role", Uday): the permission module has one rule,
  "holders of the Owner role can read every record in every module, DMs included", rather than each module
  re-implementing it. Every read of another person's private item by an Owner-role holder goes to the audit log
  (Claude's call, so the access is itself on record).
- **Later (messaging phase 6):** phone number + one-time code, only for numbers already in the staff data, rate
  limited, through an SMS/WhatsApp gateway Uday picks. The sessions and roles design above does not change for it.

### 7. Staff and allowlist sync from the Sheets

While the Employee Master and the allowlist Sheet are still the source of truth, Postgres keeps a **read-only
mirror** of them.

| Option | For | Against |
|---|---|---|
| **A. Apps Script pushes to the platform** (recommended) | The "LMCS Employee Roster Proxy" project already reads both Sheets as Uday; a time trigger POSTs the rows over HTTPS with a shared secret, the same pattern as the transport push; no new Google credentials | One more trigger in an Apps Script project |
| B. Platform pulls with a Google service account | Platform-side only | Service-account key creation is blocked by default in newer Google Cloud orgs, and a key is a long-lived secret to look after; Uday must share the Sheets with it |
| C. Platform calls the existing roster `/exec` URL | Nothing new on Google's side | That URL is public ("Anyone"); it must not start serving the full staff list |

**Recommendation: A.**
- **When:** staff nightly at 02:00 IST; the allowlist hourly (a new Principal shouldn't wait a day). The Owner gets a
  "Sync now" button that asks Apps Script to push at once (an authenticated call to the roster project).
- **What:** only the fields the platform needs: Employee Code, name, campus, department, designation, role, date of
  joining, `AuthEmail`, mobile number (for phase 6), Reports To, subject(s) taught (for HOD routing), active
  status. **Never** Aadhaar, PAN, bank details or salary.
- **How:** upsert by Employee Code; people missing from the Sheet are marked inactive, never deleted. **Safety
  catch:** if a push would deactivate more than 10% of active staff, the server refuses it and alerts the Owner (a
  broken or half-filtered Sheet must not lock out a campus). Every run is logged (rows in, changed, deactivated,
  refused).
- **The secret** is set by Uday in two places: Script Properties of the roster project and the host's environment.
- When staff data later becomes platform-owned (migration step 6), the direction flips: Postgres is the source and
  the Sheet becomes an export for anything still reading it.

### 8. Web push

- **Standard Web Push with our own VAPID keys** (no Firebase, per the messaging design), using the `web-push` library.
  Uday generates the key pair on his Mac (`npx web-push generate-vapid-keys`) and pastes both into the host's
  environment himself.
- Works on Android Chrome from the browser, and on iPhone (iOS 16.4+) once the app is added to the home screen. The
  app shows a one-time "Add to home screen" guide on iPhones.
- **One platform function, `notify(person, kind, title, text, link, urgent?)`**, used by every module. It stores the
  notification (for the in-app bell), applies the person's quiet hours (default 9 PM–7 AM; only the Owner's
  "urgent" passes) and their per-kind settings, then pushes to each of their devices. Subscriptions that return
  "gone" are deleted. (Claude's call: lock-screen text names the sender and kind with a short preview; the builder
  may make the preview a per-person setting.)
- Push is a nudge, never the record: everything is also in the app.

### 9. Shared parts every module uses (built once, in the platform core)

- **People and roles** (the synced mirror, later the source).
- **Sign-in, sessions, permission checks, "view as".**
- **Rollout switches** (messaging requirement 11, made platform-wide): feature × scope (a channel, a campus, a group
  of people, everyone), all off by default, one Owner screen. Every module's features ship behind them, which is also
  how a migrated module goes live for one campus first.
- **`notify()`** and the notification bell.
- **Files** (signed upload/download).
- **Audit log:** an append-only table of every write (who, what, when, before/after) that modules write through one
  helper. The contract event log in messaging is a module table on top of it.
- **Jobs** table for scheduled work and the Mac workers.
- **Health page** (Owner): last sync, last backup and restore test, worker last seen, push failures.

### 10. The Mac workers

- The Mac's local whisper.cpp (voice transcripts) and LM Studio stay where they are. A small worker on the Mac
  **polls the platform outbound** (`GET /api/jobs/next`), does the job, posts the result. Each worker has its own
  token, set by Uday, that can only take and finish jobs of its kind.
- Nothing waits on the Mac: notes play at once and transcripts appear when the worker next runs (messaging design).
  The health page shows when a worker was last seen.

### 10a. Google Workspace APIs (Meet links for huddles)

- Messaging huddles open a Meet link per channel, created through the Calendar API with conference data. The platform
  uses a **server-side OAuth client** in the same Google Cloud project, authorised once by Uday (super admin) for a
  single Workspace account that owns the huddle events; the server keeps that account's refresh token in the
  database, encrypted with a key from the environment. (Claude's call: a service account with domain-wide delegation
  is the alternative, but needs a key file that newer Google Cloud orgs block by default.)
- If this isn't set up, each channel stores a fixed Meet link the channel owner pastes in (messaging fallback).
- Nothing else uses Workspace APIs in the core; later modules that need them (Calendar for hiring, say) reuse the same
  client.

### 11. Coexistence with GitHub Pages and Apps Script

The old portal keeps working, untouched, for as long as any module lives there.

- **Two addresses, one site.** The old portal stays at `kanwaruday.github.io/LMCSManagement/`; the platform app is at
  `kanwaruday.github.io/LMCSManagement/app/` for now (Uday), with its API on Render.
- **One sign-in, two sessions.** Same Google account and allowlist; the platform has its own session token, stored under its own key so it never collides with the old portal's `lmcs_session`. The old
  portal gets a tile or link for each module that has moved; the platform links back to old-portal pages not yet
  moved. No attempt to share sessions across the two origins.
- **One owner per dataset.** At any moment every dataset is owned by exactly one system; the other side only reads a
  copy.

  | Dataset | Owner now | Platform side |
  |---|---|---|
  | Employee Master, allowlist | Sheets | read-only mirror, pushed (section 7) |
  | Messaging (all of it) | Platform | new; no Sheet copy |
  | Approvals, Coordinator tasks, game progress and Game Config, Office, hiring, PDR, CW/HW, transport, payroll | Sheets / Apps Script | nothing until the module moves |

- **Bridges, only where a module needs one before its partner moves:**
  - *Sheet → platform:* the push pattern of section 7, for read-only copies.
  - *Platform → Apps Script:* a read API with a per-consumer token. First use: the Apps Script game backend's
    messaging adapter reads open contracts and job-board items to make missions, so messaging phase 2 works with the
    game layer before the game backend moves.
  - *WhatsApp Hub:* a read-only token for the Hub's local pipeline over the channels that have moved (messaging
    requirement 10).
- **Moving a module** (the same steps each time, in its own plan):
  1. Build it on the platform behind a rollout switch; its data tables are shaped from the Fee Clerk CSV-export
     conventions.
  2. Dry run: export the Sheets to CSV, load into a copy, compare counts and totals.
  3. Cut-over on a quiet day: switch the Apps Script write actions to answer "moved", protect the Sheets
     (read-only), run the final export/import, verify, turn the switch on (one campus first where it makes sense).
  4. The old page shows "this has moved" with a link. The Sheet stays as a read-only archive; nothing is deleted.
  5. Rollback within the first two weeks: turn the switch off, re-open the Sheet, and write back the rows created on
     the platform since cut-over with the module's export script.

### 11a. Serving from GitHub Pages (checked against Uday's "something over github")

What works from a github.io path:
- **Installable app (PWA):** yes. The manifest's `scope` and `start_url` are `/LMCSManagement/app/`, and the service
  worker is served from that folder, so its scope covers only the app and never the old portal's pages.
- **Web push:** yes. Push needs HTTPS and a service worker, both of which github.io has. The push subscription belongs to
  the origin `kanwaruday.github.io` plus the service worker's scope, and is sent through the browser's push service
  using our VAPID keys. Render's address plays no part, so the API host can change without breaking push. iPhones
  still need iOS 16.4+ and "Add to Home Screen".
- **Google sign-in:** yes. `kanwaruday.github.io` is already an authorised origin on the existing OAuth client.
- **WebSockets to Render:** yes. Cross-origin WebSockets are allowed; the server checks the `Origin` header against
  `APP_ORIGIN`.

What has to change from the design above, and the design now says so:
1. **No session cookie.** A cookie set by `*.onrender.com` on a page at `github.io` is a third-party cookie, which
   Safari on iPhone blocks, and Chrome is restricting. So the session is a **bearer token**: an opaque random value,
   stored server-side as a hash and revocable as before, kept by the app in IndexedDB (so the service worker can send
   the outbox too), and sent in an `Authorization` header. WebSockets send it in the first message, never in the URL.
2. **CORS:** the API answers only `APP_ORIGIN` (`https://kanwaruday.github.io`), with credentials off (tokens, not
   cookies).
3. **Shared origin.** Every page on `kanwaruday.github.io` (the old portal and any other repo Uday publishes there)
   is the same origin and can read the app's stored token. That is acceptable only because Uday controls everything
   published there, and it is the same exposure the old portal's ID token in localStorage has today. Rule until the
   move: nothing else gets published under `kanwaruday.github.io` that runs third-party scripts. (Claude's call.)
4. **Security headers:** GitHub Pages can't set response headers, so the Content-Security-Policy goes in a `<meta>`
   tag (no `frame-ancestors`; clickjacking protection waits for the school domain). The API on Render sets full
   headers itself.
5. **Routing:** Pages has no server rewrites, so the app uses hash routes (`/app/#/channels/...`) or a 404.html
   redirect. (Builder's pick.)
6. **Public build files.** The built app in `app/` is code only; data comes from the API after sign-in. The
   `verify.mjs` scan covers `app/` like `platform/`.

**The cost Uday accepts for the later move to a school domain** (Uday: "Once this is done we are any ways going
professional"): a new address is a new origin to the browser, so on that day everyone
- re-installs the app (the old home-screen icon goes to a "we've moved" page that links to the new one);
- turns notifications on again (old push subscriptions are dropped; the VAPID keys stay the same);
- signs in once more (stored tokens don't carry across origins);
- and the app's outbox must be empty first (the old app shows "sending…" until it is, before it redirects).
Nothing on the server or in Postgres moves; only `APP_ORIGIN`, `VITE_API_URL`, the DNS record and the OAuth
origin change.

### 12. Migration order

Messaging requirement 3 assumed Approvals, Coordinator tasks, staff data and the game backend would already be in
Postgres. They won't be at first; the order below says what stays on Apps Script and what bridges it. The guiding
rule (Claude's call): **no live module moves during the game layer's two-campus pilot and go-live, February to
April 2027**; new work (messaging) can be built at any time because it moves no data.

| Step | What | Why here | Bridge until then |
|---|---|---|---|
| 0 | **Platform core**: sign-in, staff/allowlist sync, rollout switches, notify + push, files, audit log, jobs, backups, health page | Everything else stands on it | — |
| 1 | **Messaging phase 1**: chat, channels, threads, search, PWA, push | New, no data to move; proves the platform with real users behind switches | — |
| 2 | **Messaging phase 2**: contracts, job board | Missions via the read API into the Apps Script game backend | Platform → game backend read API |
| 3 | **Approvals (incl. leave) + Coordinator tasks** | Messaging phase 3 hands forms into Approvals; both gain push | Messaging phase 3 waits for this step |
| 4 | **Game backend** (progress, Game Config, adapters) | Move at a season (term) boundary after go-live, never mid-season | — |
| 5 | **Office** (Fee Clerk + PRO, Day Book) | Built migration-ready; benefits most from Postgres' ledgers | — |
| 6 | **Staff data becomes platform-owned**, with Staff Management and Hiring | Biggest dependency; done once the platform has run for months | Sheet becomes an export |
| 7 | **PDR, Teacher SS, CW/HW tracker, Transport / Fleet Command** | Daily-use pages; move one at a time, a campus first | — |
| 8 | **Payroll, Salary, incentives** | Money; last, and still parallel to the ERP | — |

The Coordinator + Owner React rebuild screens are folded in at each step whose data they show.
**Timing of step 3 relative to the March go-live is waiting on Uday (Q4).**

## Messaging's 12 platform requirements, covered

| # | Requirement | Where |
|---|---|---|
| 1 | Long-running server, WebSocket per open app | Section 1 (Fastify, one process), section 4 (always-on host) |
| 2 | Web push, own VAPID keys, PWA, quiet hours at send time | Sections 2, 8 |
| 3 | One Postgres with Approvals, Coordinator tasks, staff data, game backend | **Only partly at first.** Staff data is a read-only mirror from step 0 (HOD role and subject per teacher included in the sync). Approvals and Coordinator tasks move at step 3; messaging phase 3 waits for it. The game backend stays on Apps Script until step 4 and reads contracts through the read API (section 11). Section 12 |
| 4 | Google sign-in, allowlist, roles, enforceable "view as", later phone OTP | Section 6 |
| 5 | Private file storage | Section 5 (R2, signed links, browser-side compression) |
| 6 | Indefinite retention, soft deletes, append-only log, backups, Owner legal hard delete | Section 5 (retention, backups), section 9 (audit log). The legal hard delete is an Owner-only action that removes the record and its files and leaves an audit entry saying a legal delete happened, without the content |
| 7 | Outbound-only Mac workers | Section 10 |
| 8 | Server-side OAuth client, Calendar/Meet links | Section 10a |
| 9 | Idempotent ids / outbox | Section 2 |
| 10 | Read API for the WhatsApp Hub | Section 11 (bridges) |
| 11 | Rollout switches per feature and scope, platform-wide | Section 9 |
| 12 | Owner role reads everything; DPDP advice | Section 6 (read-all rule), Security |

Also from Uday: the current portal keeps working for everyone during the move, and modules move one at a time behind
Owner switches: section 11 and the migration steps.

## Security

- No personal data in the repo, fixtures, tests or docs; `verify.mjs` scans for it. Seed data is synthetic.
- Secrets live only in the host's environment and Apps Script Script Properties, set by Uday. Code reads them from
  the environment; logs never print them. Each machine consumer (Apps Script push, Mac workers, WhatsApp Hub) has
  its own token, revocable alone.
- All permission checks server-side in one module; every write audited.
- HTTPS only; strict Content-Security-Policy; bearer session tokens (hashed server-side, revocable); sign-in and sync endpoints rate
  limited; uploads size- and type-checked.
- Backups encrypted with a key the server can't decrypt with.
- The roster project's public `/exec` URL never starts serving staff data because of this platform (option C of
  section 7 rejected for that reason).
- DPDP advice before rollout, covering the "nothing is private" notice, retention and data stored in Singapore.

## Cost (list prices to confirm at sign-up)

| Item | Monthly |
|---|---|
| Render web service (Starter) | $7 |
| Render Postgres (1 GB plan) | $19 |
| Backup cron job | ~$1 |
| Cloudflare R2 (under 10 GB) | $0 |
| GitHub Pages (app) + Render's own address (API) | $0 |
| **Total** | **~$27 (~₹2,300)** |

Later: SMS/WhatsApp gateway for phase 6 phone sign-in (per message, Uday's pick of provider).

## Accounts and secrets Uday sets up (when the build starts, not now)

1. Render account (Singapore region), connected to the GitHub repo; Postgres created there.
2. Cloudflare account with an R2 bucket and an API token limited to that bucket.
3. Google Cloud console: nothing for now (`kanwaruday.github.io` is already an authorised origin); at the later
   domain move, add the new origin.
4. VAPID key pair (`npx web-push generate-vapid-keys` on his Mac), age key pair for backups.
5. Shared secrets for the Apps Script push and each worker token, set in both places.
6. DNS: nothing for now; a record for the school domain at the later move.

The build plan will list the exact environment variable names; Uday fills in the values.

## Skills for the build (Skills Curator Lite, recommend only, nothing installed)

- `mcollina/skills/fastify-best-practices` (by Fastify's lead maintainer, ~81K installs): evaluate before the server
  build.
- `supabase/agent-skills/supabase-postgres-best-practices` (~460K installs): general Postgres schema and index
  guidance, despite the name; evaluate before writing migrations.
- PWA / web-push skills found were low-trust or barely used: skip; MDN and the `web-push` docs are enough.
- Already installed and used for the UI: frontend-design-for-lmcs, impeccable-for-lmcs, taste-for-lmcs,
  design-references-for-lmcs.

## Open questions for Uday (one at a time, through the LMCS Master Agent)

1. ~~Hosting~~ **Answered (Uday, 2026-10-25): "Render, Singapore."**
2. ~~Who may sign in~~ **Answered (Uday, 2026-10-25, for the current portal): "Automatic, but all employees."**
   Section 6 follows the same rule.
3. ~~Address~~ **Answered (Uday, 2026-10-26): "for the time being can we not use something over github? Once this
   is done we are any ways going professional."** App on GitHub Pages, API on Render; school domain later
   (sections 2, 11a).
4. **Approvals timing** (section 12): move Approvals and Coordinator tasks before the February pilot, or after
   go-live (recommended), with messaging phase 3 waiting until then?

## Left to the builder

- Table design for the core (people, roles, sessions, switches, notifications, push subscriptions, files, audit,
  jobs) within the rules above.
- Folder layout inside `platform/`, test setup (a local Postgres on the Mac for tests), environment variable names.
- Exact quiet-hours behaviour, notification preview text, rate limits.
- Whether the migration runner is hand-written or a small library.

*Compiled from Claude conversation, 2026-10-25. Source: platform design session started by the LMCS Master Agent.*
