# LMCS Teacher Portal

Teacher-facing self-service portal for La Montessori Schools, now living at
`LMCSManagement/teacher/` (URL: `https://kanwaruday.github.io/LMCSManagement/teacher/`).

**Moved 2026-10-06** from the separate `kanwaruday/LMCSTeachers` repo, per Uday, as part of the
role-based portal restructure (`/index.html` role chooser, then `principal/`, `teacher/`,
`coordinator/`, `owner/`). That repo's original reasons for being separate (distinct
ownership/branding, a clean path to an app-store wrapper) are not lost: this folder is
self-contained and can be split out again. The old `LMCSTeachers/` URL redirects here.

- **Auth:** loads the shared `../assets/auth.js` (one session/allowlist implementation).
- **Backend:** calls the same "LMCS Principal's Daily Reporting Backend" Apps Script Web App every
  other module calls (see `apps-script/main.gs` / `apps-script/approvals.gs`). No separate project.
- **Access (changed 2026-10-08, per Uday):** the lowest tier, so open to Teacher, Principal, Coordinator
  and Owner (`LMCS.canViewTeacherPortal`, gate in `init()`). "View as" a teacher is scoped by
  `LMCS.viewAsScope` and enforced server-side in `apps-script/main.gs`'s `pdrViewAsScope_`: Owner and
  Coordinator any employee network-wide, a Principal their own school only (a Principal whose campus is
  ALL is network-wide), a plain Teacher nobody. "My Requests" always lists only the signed-in person's
  own requests. The card lives under "Teacher" on the role chooser (`/index.html`), not on the Principal
  home. Test: `node tests/teacher-portal/test-view-as.js`.

## Status

Built so far, all on the Home tab or its own bottom-nav tab: **My Requests**
(leave & other approvals, self-scoped), **My Score** (SS 50% + CW/HW
Regularity 50%, your own numbers only — no peer ranking yet, deliberately
deferred per Uday 2026-09-20 to validate the numbers first; explicitly
labeled draft — see `LMCSManagement/apps-script/teacher-portal.gs`), **My
Evaluations** (own
Teacher SS scores, `action=myssstats`), **My CW/HW Patterns** (own tag
frequency, reads the existing public CWHW proxy client-side), **Upcoming
Events** (campus official Calendar, `action=myupcomingevents`), **Your
Timetable** (see `data/timetable.json` below). Not yet built: Period
Adjustments (no existing process to digitize — needs real design first), a
Forms Hub, and target-based CW/HW coaching (needs Uday to define expected
ranges per tag). See `LMCSManagement`'s vault note
(`work/active/lmcs-management.md`) for the full phased plan.

## Identity resolution — EmployeeCode, not name

As of 2026-09-20, every "which record is mine" match in this app resolves an
EmployeeCode first, rather than comparing name strings — per Uday, after this
session repeatedly hit name-matching gaps (`"Seema"` vs `"SEEMA MAAM"` for one
EmployeeCode was a real example in the timetable source). Two layers:

1. **"Who am I" (the caller's own code):** `action=myemployeecode` — checks
   `EmpPersonal`'s `AuthEmail` column against the caller's verified Google
   sign-in email first (97.7% populated, confirmed against a live export),
   falling back to name-matching only if that's blank for a given person.
   **Not** `EmpMaster`'s own `AuthEmail`-named column — that one is a red
   herring, every value in it turned out to be a sequential row number, not
   an email; reading from there would have silently degraded to
   name-matching for everyone with no error to reveal it.
2. **"Which record refers to someone else"** (an SS sheet row, a CW/HW log
   entry): still resolved by matching that row's typed name against the
   Employee Roster Proxy's canonical name list — this side can't avoid
   name-matching, since neither source system captures a code or email at
   all. `resolveCodeFromName_` here mirrors `apps-script/teacher-portal.gs`'s
   `tpResolveEmployeeCode_` — keep them in sync if the normalization changes.

## `data/timetable.json`

Static asset, not live data — a personal-timetable lookup keyed
`campusId -> TeacherEmployeeCode -> {name, periods:[...]}`, generated once
from `all-campuses__timetable.csv` (the `lms-timetable-extractor` skill's
output). No LMS1 data yet — the source extraction hasn't covered that campus.

**Full-grid rebuild (2026-09-20, per Uday):** every period entry is now
emitted for every teacher on every day, whether they have a class in it or
not — an unassigned slot carries `free: true` and renders as a "Checking
Period" in the UI, instead of the row being silently absent. Canonical
per-period timing is derived per campus as the *majority* `(start, end)` seen
for that period number across the whole campus (normalizing `"PD1"`/`"P1"`/
`"1"` variants to a plain period number first) — real per-class/wing timing
variation gets smoothed over by this, so a class on an unusual bell schedule
will show the campus's typical time for that period, not its own exact one.
`campusPeriodSchedule` in the JSON carries that canonical schedule per
campus. **LMS6 only has 8 periods in the source data, not 9** — not a bug,
just what's actually there; every other campus has 9.

**Code-keying tradeoff (carried over from the earlier rebuild):** 562 of the
original 3,144 timetable rows had an assigned teacher but no EmployeeCode the
extractor could confidently resolve — those specific assignments are simply
absent (shown as a free/Checking Period slot) rather than attributed under a
guessed name; teacher coverage per campus dropped accordingly (e.g. LMS4 went
from 31 named teachers to 14 with a resolved code). Regenerate by re-running
the extractor on a fresh export and re-running the conversion (campus
`"LMS 2"` → `"LMS2"`, period labels normalized to a plain number, day names
normalized to `Mon`..`Sat`, `BREAK`/`LUNCH`/etc. rows excluded from the
9-period grid entirely, majority-vote canonical timing per campus/period).

## Deploy

Static site on GitHub Pages, same as every other LMS repo — push to `main`,
Pages serves it directly. No build step.
