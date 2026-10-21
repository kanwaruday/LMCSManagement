# Transport papers: upload from the Coordinator Transport page and the Fee Clerk Portal (design)

Date: 2026-10-21. Status: approved; Coordinator side and shared backend built and live (commit 1b3293f), Fee Clerk Portal screen handed to its session. Owner of the shared upload action and the Coordinator page: the
"Transport and buses overview" session. Owner of the Fee Clerk Portal screen: the "Fee Clerk portal design" session
(module 9, "Transport documents", in `2026-10-21-campus-office-portal-design.md`).

## Intent and the why

The Transport page (`coordinator/transport/`) shows which bus papers are expired, wrong, missing, unreadable or due.
Today the only way to fix one is the transport Google Form or a manual Drive upload, away from the screen that shows
the problem. Uday wants the renewed paper uploaded from the place the problem is seen, "exactly how we have done it for
the staff portal" (a Missing cell in the Staff Portal's Documents matrix is itself the upload button), and wants this
to be part of the Fee Clerk Portal, since the campus office is who holds the papers.

## Goals

1. On the Coordinator Transport page, every cell that needs action is an upload control: one click, pick the file, done.
2. The Fee Clerk Portal gets a Transport screen for the clerk's own campus with the same upload, built by its session.
3. Both upload paths call **one** backend action, so a paper lands in the same folder and shows the same way whoever
   uploaded it.
4. The new paper is visible at once as "uploaded, waiting to be read"; the 2-hourly AI Coordinator run (LM Studio)
   reads its date and the page shows the real state.
5. Nothing is overwritten or deleted: every upload is a new file and a new record.

## Non-goals

- Typing an expiry date at upload (Uday: LM Studio reads it). A date LM Studio cannot read stays "unread" and is fixed
  through the existing overrides note.
- Driver licences and verification (module 9 lists them; separate piece of work).
- Retiring the transport Google Form. It keeps working alongside; the Office design says module 9 eventually replaces it.
- Uploading from valid, "on file" or "no expiry" cells (Uday: only cells needing action).

## Anti-goals (failure even if it works)

- A clerk uploading for, or seeing, another campus's bus.
- An upload that silently fails or vanishes: the cell must say uploaded, failed (with the reason), or waiting.
- A paper that sits "waiting to be read" forever without anyone being told.
- Two upload code paths that drift apart.

## Decisions made by Uday (2026-10-21)

| Question | Decision |
|---|---|
| How the new expiry date gets in | LM Studio reads it off the scan on the next AI Coordinator run; nothing typed |
| Which cells offer an upload | Only cells needing action: expired, wrong paper, missing, unreadable, due within 30 or 90 days |
| Who uploads | Coordinators and Owner (Coordinator page) and Fee Clerks (Fee Clerk Portal), each for their own campuses |
| Where the file goes | The bus-wise folder `Bus Wise Documents / <bus> / <year>` (an exception to the Office portal's private-folder rule: bus papers are not sensitive, and LM Studio and the Coordinator page read them from there) |
| Coordinator page | Keeps its own upload buttons, as well as the Fee Clerk Portal |
| Fee Clerk Portal screen | Built by the Fee Clerk portal session, from a brief (this document) |

## Design

### 1. The shared upload action

`POST action=transportupload` on the **LMCS Employee Roster Proxy** project (the one Staff Portal uploads already use:
it has working Drive access, unlike the Coordinator backend, and already verifies Fee Clerks). New file
`apps-script/transport-uploads.gs` in that project, plus one routing line in its `doPost`.

Request: `{ action, idToken, reg, paper, mimeType, base64 }`, where `paper` is one of `insurance, fitness, route_permit,
mv_tax, pollution, speed_governor`.

Checks, in order, each with a plain-language error:
1. Token verified and the caller on the allowlist as Owner, Coordinator or FeeClerk (`verifyStaffManagerToken_` with
   `['FeeClerk']`).
2. `reg` is a vehicle in the fleet (the `LM Studio Fleet` tab of the transport sheet) and the caller covers its campus:
   Owner or `ALL` any; a Coordinator their district (same rule as the Coordinator page, `COORD_DISTRICTS`); a Fee Clerk
   their campus or comma list.
3. `paper` is one of the six.
4. The file is a PDF, JPG, PNG, HEIC or WEBP, checked by its leading bytes and not only by the declared type (as the
   Office backend does), non-empty and at most 10 MB.

Then:
- Folder: `LMCS Repository / Important Documents @ LMCS / Important Documents Transport / Bus Wise Documents /`, the bus
  folder whose name matches the registration once spaces are removed (`HP 66 5805`, `HP66 5805` and `HP665805` are the
  same), created as `<REG>` if the bus has none (the Innova, the Cityline and the Cruiser today), then the current
  calendar year's folder (`2026`), created if missing.
- File name: `<Paper> <REG> uploaded <DD-MM-YYYY>.<ext>` (for example `Pollution HP665805 uploaded 21-10-2026.pdf`), so the
  paper type is in the name LM Studio sees.
- Record: one row appended, under the script lock, to a new tab `Portal Uploads` in the transport sheet:
  `Uploaded On | Reg | Paper | File ID | Link | Uploaded By | Role | Campus | Via` (`Via` is `Coordinator page` or
  `Fee Clerk Portal`, sent by the client). The Google Form's own tab is never touched.
- Response: `{ success: true, link, fileId, folder }`.

### 2. "Uploaded, waiting to be read"

The Coordinator backend (`coordinator-transport.gs`) reads `Portal Uploads` with the form rows. For each bus and paper,
the newest upload whose file ID does not yet appear anywhere in the scan data pushed by the AI Coordinator (dated
documents, unreadable, no-expiry or wrong-paper scans) is **pending**: `{ at, by, link }` on that paper. Once the run has
read the file, its ID appears in the pushed data and the pending mark goes by itself, replaced by whatever LM Studio
found: a date, "no expiry", "unread" or "wrong paper".

On the page (and in `transport-rank.js`, with tests), a pending paper is its own state: a blue "uploaded, reading" cell
linked to the new file, the action line "Uploaded <time> by <name>, waiting to be read", and it no longer counts as
open work. If a pending paper is more than 6 hours old, the cell and the refresh note say the AI Coordinator has not
read it yet (the Mac may be off).

### 3. Coordinator Transport page

Action cells (expired, wrong paper, missing, unreadable, due in 30 or 90 days, and a date whose own proof is the wrong
paper) get an upload control, the Staff Portal way: a cell with no file ("-") is itself the button ("Upload"); a cell that
shows a date keeps its link to the old scan and gains a small "Upload new" button under it. Same limits as the Staff
Portal (PDF or photo, 10 MB), the same "Uploading..." and error states in the cell. After success the cell turns
pending at once, without a reload. Available to Coordinators and the Owner (the people who can open the page).

### 3b. Fee Clerk access to the transport data

The Coordinator backend refuses everyone but Coordinators and the Owner today. One narrow allowance is added: a Fee Clerk
may call `action=coordinatortransport` (read only), and sees only the vehicles, staff and money rows of their own campus
or comma list. Every other Coordinator action stays closed to them.

### 4. Fee Clerk Portal screen (brief for that session)

A Transport screen in `office/`, scoped to the clerk's campus or campuses, listing that campus's vehicles and their six
papers with the same states and order as the Coordinator page (`coordinator/transport-rank.js` holds the rules and can
be loaded as is), and the same upload on action cells, calling `transportupload` with `Via: "Fee Clerk Portal"`. Its
data can come from `action=coordinatortransport` once that action also accepts a Fee Clerk for their campus (the
Transport session adds that), or from the Office backend; the Fee Clerk session decides, along with how it fits the
portal's offline queue (an upload needs the connection; queue or refuse offline is their call) and its audit log.

## Testing

- Node tests (run by `tests/verify.mjs`): the upload checks (campus coverage for Owner, district Coordinator and
  comma-list Fee Clerk; paper names; file type by leading bytes; size), folder-name matching, the pending logic (newest
  upload, cleared once its file ID is in the scan data, the 6-hour warning) and the new `pending` state in
  `transport-rank.js`.
- Live: one real upload of a test PDF for a bus from the Coordinator page, checked in Drive (folder, name), in the
  `Portal Uploads` tab, and on the page (pending at once). The test file and row are removed afterwards with Uday's OK.
- Layout: `tests/transport/layout-check.browser.js` still passes at every width with the new buttons in the cells.

## Constraints

- Deploys through `apps-script/deploy.mjs` (clasp) from a clean checkout of the pushed commit, keeping any live file
  that holds another session's uncommitted work (the Roster project is shared with the Staff Portal session).
- The transport sheet is link-readable today; the new tab adds who uploaded what. Restricting the sheet stays Uday's
  open action.

## Left to the builder

Exact button styling in the cell, the error wording beyond "Not uploaded: <reason>", and test layout.

## My calls (to check)

- One shared upload action on the Roster project, called by both portals (Uday chose "both places"; one action keeps
  them identical).
- A district Coordinator may upload for every campus in their district (they can already see those buses).
- File name pattern and the `<REG>` folder for vehicles without one.
- "Pending" stops counting as open work, and warns after 6 hours.
- The Fee Clerk Portal may reuse `coordinatortransport` (with a Fee Clerk allowance added) rather than build its own
  transport data feed.
- Buses past their service life get no upload buttons (they are kept for the record, no action).
