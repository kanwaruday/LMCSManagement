# Fee Clerk hiring screens — API brief (hiring v2)

For the Fee Clerk Portal session, from the Principal Portal hiring session, 2026-10-23.
- **Backend:** the PDR Apps Script (`PDR_BACKEND_URL`, as in `office/js/config.js`). Branch `hiring-v2`; not
  deployed yet, so build against `tests/hiring/ui-stub.js`-style fakes until we say it's live.
- **Spec:** `docs/superpowers/specs/2026-10-23-hiring-roles-appointments-design.md` ("Fee Clerk screen",
  "Quick appointment box").

## Transport (same as today)
- **GET:** `PDR?action=<name>&idToken=<token>&...params`, which returns JSON.
- **POST:** `fetch(PDR, {method:'POST', body: JSON.stringify({action, idToken, ...body})})`. Send no
  Content-Type header, so it is a text/plain simple request with no preflight.
- **Every response** is `{success:true, ...}` or `{success:false, error:<text>}`. Errors are human-readable
  text, not codes; show them as they are. The texts are listed below.
- **Writes** are online-only (the office outbox cannot queue PDR calls).

## Actions a Fee Clerk may call

| Action | Method | Body / params | Returns |
|---|---|---|---|
| `hiringapplicants` | GET | — | `{success, statuses[], rejectReasons[], positions[], applicants[], legwork, gated}` |
| `hiringapprovalstatus` | GET | — | `{success, campuses:[{campusId, newPositions:[{roleKey, roleLevel, subjects}]}]}` |
| `apptlist` | GET | — | `{success, toAccept[], myProposals[], upcoming[]}`. For a clerk, `toAccept` is always empty |
| `hiringaddapplicant` | POST | `{name, phone (10 digits), campusId 'LMSn', source: 'Walk-in'|'Referral'|'Paper CV'|'Phone call'|'Other', subjects?, qualification?, bed?, age?, gender?, cv?, notes?}` | the `hiringapplicants` payload + `{applicantId, duplicate}`. A duplicate phone adds nothing and returns the existing ID |
| `apptpropose` | POST | `{row, kind:'interview'|'demo', start:'YYYY-MM-DDTHH:mm' (local), durationMin?, place?, note?}` | the `hiringapplicants` payload + `{id}`. A clerk always creates `proposed`; a second proposal for the same person and kind replaces the open one |
| `apptcancel` | POST | `{id, note?}` | the `hiringapplicants` payload. Proposer or elevated only |
| `hiringuploadreport` | POST | see below | the `hiringapplicants` payload. **Arrives in Task 5; the shape is fixed now** |

A clerk may not use `md`. The Principal proposes MD Academics interviews.

### `hiringuploadreport` body (scanned handwritten report + typed contents)
- **Common fields:** `{row, kind:'interview'|'demo', file:{name, mime:'application/pdf'|'image/jpeg'|'image/png', base64}}`.
- **The file:** at most 7 MB **before** base64 (check `file.size` in the browser first). The server checks
  the magic bytes and the size again.
- **Interview fields** (the same as the Principal's form):
  `interviewDate 'YYYY-MM-DD', position, confidence 1-5, english 1-5,`
  `capability:{<subject>:{<M1..C12>:1-5}} (at least one score),`
  `spouseOccupation, familySupport, qualificationRemarks, otherSkills,`
  `experience:{school, periods, timing, extraWork, classes, subjects, lastSalary},`
  `commitment, expectedSalary, strengths, weaknesses, remarks,`
  `recommendation:'proceed'|'reject', rejectReason?, rejectNote?`
- **Demo fields:**
  `demoDate 'YYYY-MM-DD', class, subject,`
  `scores:{pedagogy, content, interaction, response, management, clarity, relatable, aids} (all 1-5),`
  `studentFeedback 1-5, strengths, improve, remarks,`
  `recommendation:'proceed'|'another'|'reject', nextDemoAt? ('YYYY-MM-DDTHH:mm'), rejectReason?, rejectNote?`
- **What it does for a clerk:**
  - `reject` does **not** reject. It sets "rejection pending", and the Principal confirms it.
  - `another` + `nextDemoAt` creates a **proposed** demo.
- `rejectReason` must be one of `rejectReasons[].label` from `hiringapplicants`. `'Other'` needs `rejectNote`.

## Shapes

**`applicants[i]`** (fields a clerk receives; report contents, notes and salary are stripped):
`row, applicantId, name, phone, subjects, branches, status, shortlistedAt, shortlistedBy, source, addedBy,
interviewAt, demoAt, matchedRoleKeys, noOpenRole, docsMissing, docsComplete, expectedEmployeeCode,
employeeCode, dateOfJoining, appointments[]`.
`status` is one of `''` (not shortlisted), `'Shortlisted'`, `'Interview Scheduled'`, `'Interview Done'`,
`'Demo Done'`, `'Salary Offer'`, `'MD Academics Interview Scheduled'`, `'Hiring Approved'`, `'Hired'`,
`'Rejected'`.

**`applicants[i].appointments[]`:** open + accepted + the latest declined per kind, sorted by start.
`{id, kind:'interview'|'demo'|'md', start:<ISO>, status:'proposed'|'accepted'|'declined', proposedBy, declineNote, calendarMode}`.
`declineNote` is blank on `md` for a clerk.

**`legwork`** (numbers, computed by the server with the same rules as your screen should use):
- `toSchedule` — Shortlisted, with no proposed or accepted interview. A declined latest proposal counts.
- `waiting` — proposed appointments, any kind.
- `booked` — accepted appointments starting within the next 7 days, any kind (MD and Principal direct
  bookings included: call the candidate).
- `reportsToUpload` — past accepted interview or demo appointments with no report of that kind (filed by
  anyone).
- `demosToBook` — Interview Done, with no proposed or accepted demo.
- `documents` — Hiring Approved with documents missing.

(Task 5 also excludes Rejected and Hired people from these buckets.)

**`apptlist` items:** `id, kind, applicantId, row, phone, name, campus, start(ISO), durationMin, place, note,
proposedBy, proposedAt, acceptorRole, status, decidedBy, decidedAt, declineNote, eventId, calendarMode,
calendarError`. `myProposals` keeps the latest declined proposal per person and kind, even after its time.

## Error texts you may show
- **Applicant:**
  - `Enter the applicant's name`
  - `Enter a 10-digit mobile number`
  - `Pick one of your schools`
  - `Pick where this applicant came from (source)`
- **Proposals:**
  - `Shortlist this applicant first (a Principal…)`
  - `This applicant was rejected -- Revive them first`
  - `The interview has to be done (or its report filed) before a demo`
  - `Invalid appointment kind`
  - `Only a Principal, Coordinator or the Owner can propose …` (an md attempt)
- **Cancelling:**
  - `Appointment not found`
  - `This appointment is already …`
  - `Only the proposer or a Principal, Coordinator or the Owner can cancel this`
- **Upload (Task 5):** `… must be a score from 1 to 5`, `Give at least one capability score …`, a
  PDF/JPG/PNG type error, and a 7 MB size error.
- **Auth:** `Not authorized`. Sign the user in again.

## Office pieces we already did, or will give you
- **`office/js/today.js`** `hiringCounts(applicants, legwork)` prefers `legwork`. `hiringLabel` reads
  "Hiring · N to schedule · N awaiting a Principal · N reports to upload · N demos to book · N
  documents to chase", with zero parts omitted. Tests are in `tests/office/test-today-view.js`. (Done in
  Task 4.)
- **`assets/appointments.js`** (Task 7): `LMCSAppts.mount(el, {backendUrl: PDR_BACKEND_URL, session})`.
  It shows "my proposals" for a clerk and hides itself when empty. Mount it on the office home above
  Today, beside your "To schedule (n)" banner.
- **For your own Today screen:** reuse `hiring/hiring-view.js` (Task 6) pure helpers where useful, and
  `tests/hiring/ui-stub.js` for a fake backend.
