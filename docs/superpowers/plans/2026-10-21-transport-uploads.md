# Transport paper uploads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upload a renewed bus paper from an action cell of the Coordinator Transport page (and, later, the Fee Clerk Portal) through one shared backend action, and show it as "uploaded, waiting to be read" until the AI Coordinator reads it.

**Architecture:** A `transportupload` POST action on the Roster project files the paper in the bus-wise Drive folder and appends a `Portal Uploads` row to the transport sheet. The Coordinator backend reads that tab and marks the paper pending until its file ID appears in the scan data the AI Coordinator pushes. `coordinator/transport-rank.js` gains a `pending` state; the page gains upload controls on action cells.

**Tech Stack:** Google Apps Script (V8), vanilla JS pages on GitHub Pages, Node tests run by `tests/verify.mjs`, clasp deploys via `apps-script/deploy.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-21-transport-uploads-design.md`

## Global Constraints

- Papers: `insurance, fitness, route_permit, mv_tax, pollution, speed_governor`; labels as on the page (`Insurance`, `Fitness`, `Route permit`, `MV tax`, `Pollution`, `Speed governor`).
- Files: PDF, JPG, PNG, HEIC, WEBP, checked by leading bytes; non-empty; at most 10 MB (10 * 1024 * 1024).
- Folder: `LMCS Repository / Important Documents @ LMCS / Important Documents Transport / Bus Wise Documents / <bus> / <YYYY>`; bus folder matched on the name with spaces removed and upper-cased; created as `<REG>` when missing.
- File name: `<Paper label> <REG> uploaded <DD-MM-YYYY>.<ext>`.
- Record tab `Portal Uploads` in sheet `1VXTMZjqCS82ftB1rwoN4BzoiOTP7-Vg0m5vTH01Tfzc`, header `Uploaded On | Reg | Paper | File ID | Link | Uploaded By | Role | Campus | Via | Status`.
- Who: Owner or `ALL` any campus; Coordinator their district (`LMS1-3`, `LMS4-6` as in `COORD_DISTRICTS`); FeeClerk their campus or comma list. Buses past service life: no upload buttons.
- Pending: newest non-withdrawn upload per bus and paper whose file ID is not in the pushed scan data; warn after 6 hours.
- Deploy only committed code, from a clean checkout, keeping any live file that differs because of another session's work.

## Review Focus

1. A Coordinator of district LMS1 uploading for an LMS4 bus: refused with "You can only upload for buses of your own campuses" (Task 2 test).
2. A file renamed to `.pdf` that is really a ZIP or an EXE: refused as not a PDF or photo, whatever its declared type (Task 2 test).
3. The same paper uploaded twice before a sync: the newer upload is the pending one; both files are kept (Task 3 test).
4. An upload marked `Withdrawn` in the sheet: no longer pending (Task 3 test).
5. LM Studio files the new scan as some other document type, so it never appears among the six papers: pending still clears, because `export_fleet.py` now pushes `seen`, every bus scan file id in records.db, and the backend checks against that (Task 3 test).

---

### Task 1: `pending` state in the ranking rules

**Files:** Modify `coordinator/transport-rank.js`; Test `tests/transport/test-rank.js`

**Interfaces:**
- Consumes: a paper entry may carry `pending: { at: ISO string, by: string, link: string }`.
- Produces: `cellState(e, key, today).t === 'pending'` when `e.pending` is set; tier `'pending'` in `TIERS` between `'later'` and `'ok'`; vehicle `lines` gain `{ kind: 'pending', text: 'Uploaded, waiting to be read: <labels>' }`; pending is not a work kind and creates no `items`.

- [ ] Step 1: add to `test-rank.js` a bus `PENDING` whose pollution entry is expired but carries `pending`; assert `cells.pollution.t === 'pending'`, its tier is `'pending'`, it sorts after `SOON` and before `OK1`, and `out.items` has no item for it.
- [ ] Step 2: run `node tests/transport/test-rank.js`: FAIL.
- [ ] Step 3: implement in `transport-rank.js`.
- [ ] Step 4: run it: PASS.
- [ ] Step 5: commit.

### Task 2: shared upload action on the Roster project

**Files:** Create `apps-script/transport-uploads.gs`; Modify `apps-script/employee-roster.gs` `doPost` (two routing lines); Modify `apps-script/projects.json` (`roster.files` += `transport-uploads`); Test `tests/transport/test-transport-uploads.js`

**Interfaces:**
- Produces (pure, tested): `tupSniff_(bytes) -> mime | ''`; `tupCovers_(caller, campusId) -> boolean` (`caller = { campusId, roles }`, `campusId` like `LMS4`); `tupNormReg_(s) -> 'HP665805'`; `tupFileName_(paper, reg, date) -> string` (no extension) with `tupExt_(mime)`.
- Produces (Drive): `tupUpload_(body) -> { success, link, fileId, folder }`, body `{ idToken, reg, paper, mimeType, base64, via }`.
- Routes: `doPost` action `transportupload` -> `tupUpload_`. (No withdraw action, built-time call: a wrong upload is fixed by uploading again, the newest wins; typing `Withdrawn` in the row's Status drops it.)

- [ ] Step 1: write `test-transport-uploads.js` (vm, stubs): `tupSniff_` returns `application/pdf` for `%PDF-`, `image/jpeg` for `FF D8 FF`, `image/png` for `89 50 4E 47`, `image/webp` for `RIFF....WEBP`, `image/heic` for `....ftypheic`, `''` for `PK` (zip) and `MZ` (exe); `tupCovers_` true for Owner/ALL anywhere, Coordinator `LMS1` on `LMS2` true and on `LMS4` false, FeeClerk `LMS1,LMS2` on `LMS2` true and on `LMS3` false; `tupNormReg_('HP 66 5805') === 'HP665805'`; `tupFileName_('pollution','HP665805',new Date('2026-10-21T10:00:00Z')) === 'Pollution HP665805 uploaded 21-10-2026'`.
- [ ] Step 2: run: FAIL.
- [ ] Step 3: implement `transport-uploads.gs` (folder walk from `CENTRAL_REPO_FOLDER_ID_` with `getSubfolder_`; caller from `verifyStaffManagerToken_(idToken, ['FeeClerk'])`; fleet and campus from the `LM Studio Fleet` tab; row under `LockService`), route it, map it in `projects.json`.
- [ ] Step 4: run the test and `node tests/verify.mjs`: PASS (mapping check included).
- [ ] Step 5: commit.

### Task 3: Coordinator backend reads uploads; Fee Clerk read access

**Files:** Modify `apps-script/coordinator-transport.gs`, `apps-script/coordinator.gs` (caller check, visibility); Test `tests/transport/test-transport-gs.js`

**Interfaces:**
- Consumes: the `Portal Uploads` tab (Task 2).
- Produces: each paper in the `coordinatortransport` response may carry `pending { at, by, link }`; a FeeClerk caller (`feeClerkOnly: true`) may call `coordinatortransport` only, scoped to their campus list; every other action refuses them.

- [ ] Step 1: extend `test-transport-gs.js`: a `Portal Uploads` tab with two uploads for HP1 pollution (older and newer) marks pending with the newer one; an upload whose file ID is in the pushed `docs`/`other` data is not pending; a `Withdrawn` row is not pending; a FeeClerk `LMS1,LMS2` caller sees only those campuses.
- [ ] Step 2: run: FAIL.
- [ ] Step 3: implement (live cache down to 60 s so a reload soon after an upload shows it).
- [ ] Step 4: run + verify: PASS.
- [ ] Step 5: commit.

### Task 4: upload controls on the Transport page

**Files:** Modify `coordinator/shared.js` (Transport view), `coordinator/shared.css`; restamp `coordinator/transport/index.html`

**Interfaces:**
- Consumes: Task 1 `pending` state; Task 2 action at the Roster `/exec` URL (deployment `AKfycbyHiaZY_iWK2VTKKFJcCsBNnIbUndJYUSjnPkxvJ-dYavaihiul2xBJuJohPRsP9Spf`), body sent as text/plain JSON.
- Produces: on action cells (expired, wrong, bad proof, missing, unread, soon, later; not past service life) a cell with no date is itself the `Upload` control, a dated cell keeps its link and gains `Upload new`; "Uploading..." and "Not uploaded: <reason>" in the cell; success sets the paper's `pending` locally and re-renders; pending cells read "uploaded, reading" (blue, link to the new file) or, after 6 hours, "uploaded <n> h ago, not read yet" (amber).

- [ ] Step 1: in a local copy with sample data and a stubbed Roster response, check: buttons only on action cells, the busy and error states, the pending render, and `tests/transport/layout-check.browser.js` at 1440, 1024 and 375.
- [ ] Step 2: implement.
- [ ] Step 3: re-run the checks: PASS; `node tests/verify.mjs`: PASS.
- [ ] Step 4: commit (stage only this work), push.

### Task 5: deploy and prove it live

- [ ] Step 1: deploy the Roster and Coordinator projects with `deploy.mjs` from a clean checkout (keep live copies of files that hold other sessions' work).
- [ ] Step 2: `node tests/verify.mjs --live`: PASS.
- [ ] Step 3: one real upload of a small test PDF for one bus and paper, through the deployed action with Uday's session token unavailable to me, so through a temporary editor-run function instead: confirm the file in `Bus Wise Documents/<bus>/2026` with the right name, the `Portal Uploads` row, and `pending` in the `coordinatortransport` response; then withdraw it and confirm the file is in trash and pending is gone.
- [ ] Step 4: record outcomes.

### Task 6: hand the Fee Clerk Portal screen to its session

- [ ] Step 1: send the "Fee Clerk portal design" session a brief: spec path, the `transportupload` contract, `coordinatortransport` for Fee Clerks, `transport-rank.js` reuse, and what is theirs to decide.
- [ ] Step 2: mark the spec "approved, built (Coordinator side)".
