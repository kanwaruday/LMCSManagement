# Apps Script backends (read-only copy)

These 8 files are the Google Apps Script source behind every `script.google.com/.../exec`
URL this repo calls. **Source of truth and deployment stay in `lmcs-salary-dashboard/apps-script/`**
(that repo also holds unrelated projects — Incentive Engine, hiring dashboard — this folder
only mirrors the files LMCSManagement actually uses). Editing a file here does **not** change
the live Web App; edit + redeploy from the original repo, then re-copy here.

Synced from `lmcs-salary-dashboard` @ 2026-09-08.

## Which file backs which URL

**One deployment** ("LMCS Principal's Daily Reporting Backend" — `PDR_BACKEND_URL` in
[`principals-daily-reporting/index.html`](../principals-daily-reporting/index.html)):
- `main.gs` — single `doGet`/`doPost` entry point, routes by `?action=`
- `principal-dr.gs` — Principal DR tab (daily report, planned activities, calendar reads)
- `teacher-ss.gs` — Teacher SS dashboard stats
- `ss-forms-sync.gs` — syncs Teacher SS Google Form responses into the tracking sheet

**Separate deployments**, one file each:
- `employee-roster.gs` — `EMPLOYEE_ROSTER_URL`, the shared roster proxy (used by PDR, Staff Portal, and Curriculum Progress)
- `staff-management-api.gs` — `STAFF_API_URL` in [`staff/add-employee.html`](../staff/add-employee.html)
- `ChapterTracker.gs` — `proxyUrl` in [`curriculum-progress/daily-progress.html`](../curriculum-progress/daily-progress.html) and [`cwa-gap-report.html`](../curriculum-progress/cwa-gap-report.html) ("CWHWTracker" project)
- `principal-allowlist.gs` — `ALLOWLIST_API_URL` in [`assets/auth.js`](../assets/auth.js), sign-in allowlist

## Re-syncing

```bash
cp ../lmcs-salary-dashboard/apps-script/{main,teacher-ss,principal-dr,ss-forms-sync,employee-roster,staff-management-api,ChapterTracker,principal-allowlist}.gs apps-script/
```

Update the date above after re-syncing.
