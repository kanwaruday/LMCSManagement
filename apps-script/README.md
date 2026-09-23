# Apps Script backends

**Correction, 2026-09-14:** this folder's own premise had gone stale — `lmcs-salary-dashboard/apps-script/main.gs`
is actually BEHIND this repo's copy (missing `approvals.gs`, `ss-tracker.gs`, and now `hiring.gs`
entirely; last touched 2026-09-02 vs. this repo's 2026-09-14). **Treat the files in THIS folder as
the current source for the shared "LMCS Principal's Daily Reporting Backend" project** — paste
these into script.google.com directly — until someone does a real re-sync in the other direction.
The files below marked "separate deployment" were built and still live only in `lmcs-salary-dashboard`;
those really do need copying from there.

## Which file backs which URL

**One deployment** ("LMCS Principal's Daily Reporting Backend" — `PDR_BACKEND_URL` in
[`principals-daily-reporting/index.html`](../principals-daily-reporting/index.html) and
[`hiring/index.html`](../hiring/index.html)):
- `main.gs` — single `doGet`/`doPost` entry point, routes by `?action=`
- `principal-dr.gs` — Principal DR tab (daily report, planned activities, calendar reads)
- `teacher-ss.gs` — Teacher SS dashboard stats
- `ss-forms-sync.gs` — syncs Teacher SS Google Form responses into the tracking sheet
- `ss-tracker.gs` — SS completion/compliance dashboard across all 6 roles
- `approvals.gs` — Principal-to-Owner approval requests (Approvals tab)
- `hiring.gs` — Hiring Dashboard: browse Teaching Applicants, track status, gate the "Hired" write on Approvals (added 2026-09-14, ported+refined from `lmcs-salary-dashboard/apps-script/teaching-applicants.gs`, never deployed there)

**One deployment** ("LMCS Employee Roster Proxy" — `EMPLOYEE_ROSTER_URL` **and** `STAFF_API_URL`,
which are now the same URL):
- `employee-roster.gs` — public reads (`roster`/`employees`/`designations`, no token) used by PDR,
  Curriculum Progress, and the Staff Portal's search boxes. Also the project's single `doGet` entry
  point — routes `nextcode`/`list`/`detail`/`addnewhire`/`transfer`/`markinactive` to `staffDoGet_`.
- `staff-management-api.gs` — merged into this same project 2026-09-23 (per Uday, one deployment
  instead of two). Gated read/write actions for the Staff Portal (`staff/add-employee.html`),
  verified against the Principal Allowlist on every call, completely unchanged by the merge. Its
  `doGet` was renamed `staffDoGet_` since only one function may be named `doGet` per project.

**Separate deployments**, one file each:
- `ChapterTracker.gs` — `proxyUrl` in [`curriculum-progress/daily-progress.html`](../curriculum-progress/daily-progress.html) and [`cwa-gap-report.html`](../curriculum-progress/cwa-gap-report.html) ("CWHWTracker" project)
- `principal-allowlist.gs` — `ALLOWLIST_API_URL` in [`assets/auth.js`](../assets/auth.js), sign-in allowlist

## Re-syncing

**Don't run the old copy-from-lmcs-salary-dashboard command** — as of 2026-09-14 that repo's copies
are the stale ones for the shared-deployment files above. If you want the two repos back in sync,
copy in the other direction instead (this repo → `lmcs-salary-dashboard/apps-script/`) for
`main.gs`/`approvals.gs`/`ss-tracker.gs`/`hiring.gs`, then update this note.
