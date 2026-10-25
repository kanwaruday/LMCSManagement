# Transport game Phase 1a: data capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start collecting the data the transport game needs, with Fleet setup quests replacing the staff spreadsheet and an import for the agencies' Excel template. That means a Coordinator capture portal
(timelapse runs, count runs, monthly safety inspections), a one-tap component pick and a fuel-fill video in
the Fee Clerk's day book, and Mac processing that blurs frames and stitches each route's timelapse.

**Architecture:**
- **Phone pages** are static pages on GitHub Pages and save everything to IndexedDB first. They upload later
  through the Roster project (the only project with Drive access), in the same way as
  `transport-uploads.gs`.
- **The day book changes** live in the Office project, following its outbox and header-migration patterns.
- **The Mac** (`~/Projects/transport-gps`) pulls the frames from the Drive-synced folder, blurs them,
  stitches an MP4 with stop chapters, and pushes stop tags and counts to the Coordinator backend. It uses the
  same secret as the GPS push.

**Tech Stack:** Plain ES modules (as `office/js/`), Apps Script, Node `vm` tests (as `tests/office`,
`tests/transport`), Python 3 + OpenCV + ffmpeg on the Mac (all open source).

**Spec:** `docs/superpowers/specs/2026-10-25-transport-game-design.md`. This plan covers Loop 6 (capture
portal), the early garage data (one-tap components, monthly inspection), the "fuel-fill proof" season goal,
and Phase 1a in the phasing table.

## Global Constraints

- **Location** (Uday): everything lives under `/Volumes/AI Work/Uday - LMCS Software Project/`. Code goes in this repo; private data in gitignored `transport/game-data/`; new Mac processing in `transport/capture/` (never `~/Projects`).

- **Never speed:** never score, rank or display speed or trip time anywhere. No speed overlay on the
  timelapse.
- **Counts only:** count runs record counts per stop, never names. The camera is never on in a count run.
- **Timelapse runs** warn before starting that they must be outside school hours with no children aboard.
  The page asks for confirmation on every start.
- **Private imagery:**
  - frames, stop photos, inspection photos and fuel videos go to private Drive folders only;
  - nothing in the repo or static files;
  - frames are shown only after blurring.
- **Open source only** for maps, blurring and video: no Google Maps or Esri, and no API keys.
- **Mobile first:** every new page works at 375 px with no page overflow. It respects
  `prefers-reduced-motion`, and sound stays off.
- **Who may use what:**
  - capture portal: Coordinators (their district via `tupCovers_` rules), Fee Clerks (their campus) and the
    Owner;
  - loadout list edits: the Owner only.
- **Frame spacing:** one frame every **15 m** of GPS distance (constant `FRAME_SPACING_M = 15`). Frames are
  ~720p JPEG, quality 0.7.
- **Timelapse:** 30 fps, one chapter per tagged stop.
- **Fuel video:** ≤ 25 MB, mp4/mov/3gp. The proof is due within 24 hours of the fill. Videos are deleted 90
  days after the fill is checked.
- **Load cap reference:** 1.4 × official seating capacity. It is shown on count-run summaries only in
  Phase 1a.
- **Shipping:**
  - Uday deploys: the Roster, Office and Coordinator projects through `node apps-script/deploy.mjs`, and
    Pages by push.
  - Nothing ships without his go-ahead.
  - `node tests/verify.mjs` must show no new failures.

## Review Focus

1. **The phone locks, or the Coordinator switches apps, mid-run.** Capture pauses, a gap is recorded, and it
   resumes on return with no frames lost. Pinned in Task 4 (`run-store` gap test) and Task 5 (visibility
   handler).
2. **Upload breaks halfway** (hill network) **or the browser is closed.** Already-sent frames are never
   re-sent, and the rest resume. Pinned in Task 4 (`uploader` resume test).
3. **A stopped bus or poor GPS fix** (accuracy > 50 m). No frames pile up, and inaccurate fixes are skipped.
   Pinned in Task 4 (`shouldCapture` tests).
4. **A Fee Clerk taps a service category with no component, or a component that doesn't fit the category.**
   The entry is refused with a clear message, and old entries without components still load. Pinned in
   Task 1.
5. **A Coordinator uploads for a bus outside their district.** Refused, as for documents. Pinned in Task 3.

---

### Task 1: One-tap component pick in the day book (Office)

**Files:**
- Modify: `apps-script/office-config.gs` (add `OFFICE_COMPONENTS` and the `components` day-book column via the existing header check)
- Modify: `apps-script/office-daybook.gs` (validate and store `components`)
- Modify: `office/js/daybook.js` (component chips for vehicle service categories)
- Test: `tests/office/test-daybook.js`, `tests/office/test-daybook-view.js`

**Interfaces:**
- Produces:
  - `OFFICE_COMPONENTS`: an array of `[id, label, categories[]]`;
  - `officeComponentsFor_(categoryId) -> [{id,label}]`;
  - the day-book row field `components` (comma-separated ids, blank on old rows);
  - client `componentOptions(categoryId) -> [{id,label}]`.
- Components and their categories:
  - `engine_oil, oil_filter, fuel_filter, air_filter, coolant, belts` → `vehicle_service`, `vehicle_parts`
  - `brake_front, brake_rear, brake_fluid, clutch, gearbox_oil, axle_grease, suspension, steering, wheel_bearing` → `vehicle_service`, `vehicle_parts`
  - `battery, lights_wiring, starter_alternator` → `vehicle_electrical`
  - `tyre_fl, tyre_fr, tyre_rl, tyre_rr, tyre_spare, puncture` → `tyres`
  - `body_paint, seats_windows, door` → `vehicle_body`
  - `washing_greasing` → `vehicle_washing`
  - `other` → all of the above

- [ ] **Step 1: Write failing tests**
  - `entry with category tyres and components ['tyre_fl','puncture'] is saved with components 'tyre_fl,puncture'`;
  - `service category with no components is refused with COMPONENTS_REQUIRED`;
  - `component not valid for the category (battery on tyres) is refused with BAD_COMPONENT`;
  - `non-vehicle category ignores components`;
  - `old row without the column reads back components ''`;
  - view test: `chips show for vehicle_service and hide for fuel`.
- [ ] **Step 2: Run** `node tests/office/run.js`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - Validation lives in `officeDaybookAdd_` next to the existing vehicle checks.
  - The column is added through the existing header check, so the first sign-in adds it to live sheets.
  - The client shows multi-select chips with the label "Which parts? (tap all that apply)", required for
    service categories.
- [ ] **Step 4: Run** `node tests/office/run.js`. Expected: all PASS.
- [ ] **Step 5: Commit** with the message `office: day book asks which parts a vehicle service bill was for`.

### Task 2: Fuel-fill proof video (Office → Coordinator)

**Files:**
- Modify: `apps-script/office-files.gs` (new file category `fuel_video`: mime `video/mp4|video/quicktime|video/3gpp`, magic-byte checks, 25 MB limit for this category only)
- Modify: `apps-script/office-daybook.gs` (fuel entries accept optional `video_file_id`)
- Modify: `office/js/daybook.js` ("Video of the fill, from the driver" field, fuel only)
- Modify: `apps-script/office-fuel-mirror.gs` (mirror `hasVideo`, `hasBill`)
- Modify: `apps-script/coordinator-transport-gps.gs` (fuel check gets `proof: 'video+bill' | 'bill' | 'none'`; raise follow-up domain `fuel_proof` when no video 24 hours after the fill, auto-resolving)
- Test: `tests/office/test-files.js`, `tests/office/test-fuel-mirror.js`, `tests/transport/test-transport-gps.js`

**Interfaces:**
- Produces:
  - file category `'fuel_video'`;
  - day-book field `video_file_id`;
  - mirror columns `hasVideo`, `hasBill`;
  - fuel check field `proof`;
  - follow-up domain `fuel_proof`, with the instruction "Get the fill video from the driver and attach it to
    the fuel entry", due in 1 day.

- [ ] **Step 1: Write failing tests**
  - `fuel_video accepts a 20 MB mp4 and refuses 26 MB with TOO_LARGE`;
  - `fuel_video refuses a JPEG with BAD_MIME`;
  - `bill category still capped at 3 MB`;
  - `mirror marks hasVideo when video_file_id is set`;
  - `fuel check proof is 'video+bill' / 'bill'`;
  - `fuel_proof follow-up raised at 24h without video and auto-resolves when the video arrives`.
- [ ] **Step 2: Run** `node tests/office/run.js` and `node tests/transport/test-transport-gps.js`. Expected:
  the new tests FAIL.
- [ ] **Step 3: Implement.** The limit is per category (`OFFICE_FILE_MAX_BYTES_BY_CAT`). The video goes
  through the same outbox `file.upload`. Videos are deleted 90 days after the fill's check closes: add this to
  the existing nightly Office backup trigger.
- [ ] **Step 4: Run** the same tests. Expected: all PASS.
- [ ] **Step 5: Commit** with the message `transport: fuel fills carry the driver's fill video; missing proof raises a follow-up`.

### Task 3: Capture upload and run manifest (Roster backend)

**Files:**
- Create: `apps-script/transport-capture.gs`
- Modify: `apps-script/projects.json` (add `transport-capture` to `roster`)
- Modify: the Roster `doPost` router, wherever `tupUpload_` is routed (`actions capturefile`, `capturerun`)
- Test: `tests/transport/test-transport-capture.js` (same vm-stub style as `test-transport-uploads.js`)

**Interfaces:**
- Consumes: `tupNormReg_`, `tupVehicle_`, `tupCovers_`, `tupSniff_`, `verifyStaffManagerToken_`.
- Produces:
  - `POST action=capturefile {idToken, reg, runId, kind: 'frame'|'stop'|'inspection', seq, lat, lng, takenAt, base64}`
    returns `{success, fileId}`.
    - Images only, ≤ 2 MB.
    - Saved to the folder `Capture/<REG>/<runId>/` under the transport Drive root.
    - **Idempotent on `(runId, kind, seq)`**: a repeat returns the existing fileId.
  - `POST action=capturerun {idToken, run}` returns `{success}`.
    - It upserts one row per `runId` in the tab `Capture Runs`.
    - Header: `Run ID | Reg | Campus | Kind (timelapse/count/inspection) | Started | Ended | By | Role | Frames | Gaps JSON | Stops JSON | Inspection JSON | Status`.

- [ ] **Step 1: Write failing tests**
  - `Coordinator LMS4-6 can upload a frame for HP659511 (LMS 4)`;
  - `Coordinator LMS1-3 refused for HP659511`;
  - `FeeClerk refused outside own campus`;
  - `Owner allowed`;
  - `repeat (runId,kind,seq) returns same fileId and creates no second file`;
  - `PDF refused`;
  - `3 MB frame refused`;
  - `capturerun upserts by runId (second call updates Frames, no new row)`;
  - `count run with any frame upload is refused` (no camera in count runs).
- [ ] **Step 2: Run** `node tests/transport/test-transport-capture.js`. Expected: FAIL.
- [ ] **Step 3: Implement.** Dedup is by a `CacheService` key plus a folder file-name check
  (`<kind>-<seq 5 digits>.jpg`).
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** with the message `roster: capture uploads and run manifest for the transport game`.

### Task 4: Capture core logic (phone, pure modules)

**Files:**
- Create: `coordinator/capture/geo.js`, `coordinator/capture/run-store.js`, `coordinator/capture/uploader.js`
- Test: `tests/transport/test-capture-core.js`

**Interfaces:**
- Produces:
  - `geo.js`:
    - `distanceM(a, b) -> number` (haversine);
    - `shouldCapture(last, fix, spacingM = 15, maxAccuracyM = 50) -> boolean`;
    - `FRAME_SPACING_M = 15`.
  - `run-store.js`:
    - `createRunStore(idb)` returns `{ newRun(meta) -> run, addFrame(runId, frame), addStop(runId, stop), setCount(runId, stopSeq, boardOn, boardOff), markGap(runId, from, to), endRun(runId), pending(runId) -> frames[], markSent(runId, kind, seq, fileId), runs() -> run[] }`.
    - `idb` follows the `office/js/idb-store.js` shape `{put, getAll, delete}`; two stores, `capture-runs`
      and `capture-files`.
  - `uploader.js`:
    - `createUploader({store, post, onProgress})` returns `{ start(runId), stop() }`.
    - Uploads pending files in `seq` order, retries with backoff of 5 s, 15 s, 60 s, then waits for
      `online`, and posts `capturerun` at the end.

- [ ] **Step 1: Write failing tests**
  - `shouldCapture false under 15 m, true at 15 m, false when accuracy 80 m, true for the first fix`;
  - `markGap is recorded and pending() excludes sent files`;
  - `uploader resumes after a thrown post: sent files are not re-posted, order kept`;
  - `progress reports sent/total`;
  - `count runs reject addFrame`.
- [ ] **Step 2: Run** `node tests/transport/test-capture-core.js`. Expected: FAIL.
- [ ] **Step 3: Implement** with plain ES modules and no dependencies.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** with the message `capture: distance-spaced frames, offline run store, resumable uploader`.

### Task 5: Capture page (phone UI)

**Files:**
- Create: `coordinator/transport/capture.html`, `coordinator/capture/capture.js`, `coordinator/capture/capture.css`
- Create: `docs/transport-game/capture-guide.md` (the one-page guide for Coordinators and Fee Clerks: mount, charger, school phone, timing, privacy)
- Modify: `coordinator/transport/live.html` (link "Capture a route"), and the asset stamps (`tests/transport/test-asset-stamps.js` rules)
- Test: `tests/transport/layout-check.browser.js` (add the capture page at 375 px)

**Interfaces:**
- Consumes: Task 4 modules, Task 3 actions, and `assets/auth.js` sign-in.
- Behaviour, as the spec's Loop 6:
  - **Mode picker:** **Timelapse** (default) · Count run · Inspection.
  - **Timelapse:**
    - A start screen with the privacy confirmation ("Outside school hours, no children on board") and the
      battery and charger hint.
    - The rear camera via `getUserMedia({video:{facingMode:'environment'}})`.
    - `navigator.wakeLock.request('screen')` holds the screen on.
    - `geolocation.watchPosition`. Each fix that passes `shouldCapture` draws a canvas frame (720p, JPEG 0.7)
      to the run store.
    - A large **STOP HERE** button opens a sheet: pick the stop from the bus's known stops (from
      `coordinatortransportinsight`), or "New stop" with a name, then take the stop photo.
    - `visibilitychange` hidden → pause and `markGap`; visible → resume.
  - **Count run:** no camera prompt at all. STOP HERE plus a +/− board-on and board-off counter per stop. The
    summary shows the peak load against seats and against 1.4 × seats.
  - **Upload tab:** per-run progress ("312 of 540 frames sent") and a "Send now on Wi-Fi" button.
  - **Mission header:** "Capture Route 18: 6 of 14 stops tagged".

- [ ] **Step 1: Add the 375 px layout check** for `capture.html` (no overflow, STOP HERE visible above the fold).
- [ ] **Step 2: Run** `node tests/transport/layout-check.browser.js`. Expected: FAIL (the page is missing).
- [ ] **Step 3: Build the page and guide** using the LMCS design skills (`frontend-design-for-lmcs`,
  `taste-for-lmcs`, `impeccable-for-lmcs`, then `game-ui-ux`). Copy is short, imperative and plain.
- [ ] **Step 4: Run** the layout check and `node tests/verify.mjs`. Expected: PASS, with no new failures.
- [ ] **Step 5: Manual check on a phone** (by Uday or a Coordinator, outside school hours). A 1 km
  timelapse run, two stops tagged, lock and unlock mid-run (a gap is shown), upload on Wi-Fi, and the
  Capture Runs row appears.
- [ ] **Step 6: Commit** with the message `coordinator: capture portal (timelapse, count run, offline upload)`.

### Task 6: Safety loadout list and monthly inspection

**Files:**
- Modify: `apps-script/coordinator-transport.gs`:
  - tab `Safety Loadout`, with header `Item ID | Label | Needs photo | Needs date | Order | Active`;
  - actions `coordinatortransportloadout` (GET for all transport roles; POST set for the Owner only);
  - a monthly inspection due per bus, from `Capture Runs` rows of kind `inspection`.
- Modify: `owner/transport/index.html` (a small "Safety loadout" editor: add, rename, reorder, deactivate)
- Modify: `coordinator/capture/capture.js` (Inspection mode: one card per active item, with Yes/No, a photo
  when needed and a date when needed; it saves through `capturefile kind:'inspection'` + `capturerun`)
- Test: `tests/transport/test-transport-gs.js`

**Interfaces:**
- Produces:
  - loadout items `{id,label,needsPhoto,needsDate,order}`;
  - the inspection run JSON `{itemId: {ok:boolean, date?:'yyyy-MM-dd', fileId?}}`;
  - follow-up domain `bus_inspection`, raised on the 5th of the month when there's no inspection that month,
    with the instruction "Do this month's safety check in the capture portal", due in 5 days, auto-resolving.
- **Seed list:** GPS tracker, speed governor (40 km/h) with certificate date, CCTV, first-aid box,
  fire extinguisher with refill date, window grills, emergency exit, door lock, school name and phone
  painted, attendant on board.

- [ ] **Step 1: Write failing tests**
  - `Owner can set the list; Coordinator POST refused`;
  - `inactive items hidden from inspection`;
  - `inspection run with fire extinguisher ok:false raises a follow-up for that bus` (domain `bus_equipment`, 3 days);
  - `bus_inspection raised on the 5th when no inspection this month, resolves after one is saved`.
- [ ] **Step 2: Run** `node tests/transport/test-transport-gs.js`. Expected: FAIL.
- [ ] **Step 3: Implement**, following the existing follow-up domain table and its auto-resolve rules.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** with the message `transport: owner-edited safety loadout and monthly inspection missions`.

### Task 7: Mac processing: blur, timelapse, stop tags

**Files:**
- Create: `transport/capture/capture.py`, `transport/capture/test_capture.py` (in this repo; outputs go to Drive, never into the repo)
- Modify: the existing daily job script that runs `~/Projects/transport-gps/insights.py`. Add one line that then runs `python3 "/Volumes/AI Work/Uday - LMCS Software Project/LMCSManagement/transport/capture/capture.py"`
- Modify: `apps-script/coordinator-transport-gps.gs`:
  - `POST action=transportcapturepush {secret, payload:{runs:[{runId, reg, videoFileId, stops:[{seq,name,lat,lng,at,photoFileId,boardOn,boardOff}]}]}}`;
  - stored in the tab `Capture Stops`;
  - served in `coordinatortransportinsight` as `capture: {byReg: {...}}`, campus-scoped.

**Interfaces:**
- Consumes:
  - the Drive-synced `Capture/` folder (path from the existing drive-index config);
  - the `Capture Runs` manifest (read through `coordinatortransportinsight`);
  - `TRANSPORT_PUSH_SECRET`.
- Produces:
  - `select_frames(frames) -> list` (sorted by seq; drops duplicates);
  - `chapters(stops, frames, fps=30) -> ffmetadata text` (one chapter per stop at its nearest frame);
  - `blur(image) -> image`, using OpenCV's YuNet face detector plus an open-licensed licence-plate ONNX model
    (the implementer picks one with a licence that permits use, and records it in a code comment);
  - `stitch(frames, chapters, out_mp4)`, using ffmpeg `-framerate 30`, H.264, with the ffmetadata chapters.
  - Processed output goes to `Capture/<REG>/<runId>/processed/` (blurred frames + `route.mp4`).
  - Originals are deleted 30 days after processing.
  - Follow-up domain `capture_route`, raised for each operational bus with no processed timelapse. The
    instruction is "Ask the Fee Clerk to send the school phone on this route's next empty run, and do the
    timelapse run". It goes to the Coordinator under the existing rule, is due in 14 days, and
    auto-resolves.

- [ ] **Step 1: Write failing tests**
  - `chapters place stop 2 at the frame nearest its timestamp`;
  - `chapters for a run with no stops is empty`;
  - `select_frames drops a duplicate seq`;
  - `blur leaves an image with no detections unchanged` (fixture);
  - `stitch builds a 3-frame mp4 at 30 fps` (ffprobe check);
  - push test in `tests/transport/test-transport-gps.js`: `transportcapturepush with a wrong secret refused; an LMS 4 coordinator sees only LMS 4 capture stops`.
  - `capture_route` test: `raised for an operational bus with no processed run and resolved by the push`.
- [ ] **Step 2: Run** `python3 -m pytest transport/capture/test_capture.py` and the node test.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both. Expected: PASS.
- [ ] **Step 5: Commit** with the message `transport: capture runs become blurred timelapses with stop chapters`.

### Task 8: Fleet setup quests (gamified data collection)

**Files:**
- Modify: `apps-script/coordinator-transport.gs`:
  - tabs `Fleet Profile` (one row per reg), `Driver Profile` (one row per driver), `Parts History` (one row
    per reg × component) and `Workshops`;
  - action `coordinatortransportfleet` (GET for scoped roles);
  - action `coordinatortransportfleetsave` (POST: Fee Clerk for own campus, Coordinator for own district,
    Owner all; one quest at a time).
- Create: `coordinator/transport/setup.html`, `coordinator/capture/setup.js` (quest board; photos go through
  Task 3's `capturefile` with the new kind `'profile'`, using the capture page's offline store pattern)
- Modify: `apps-script/transport-capture.gs` (allow `kind:'profile'`)
- Test: `tests/transport/test-transport-gs.js`, `tests/transport/test-fleet-quests.js` (pure completion logic)

**Interfaces:**
- Produces:
  - `questsFor(profile) -> [{id, label, done:boolean, missing:[field]}]`, from the six quest IDs
    `papers | safety | parts | driver | fuel | capture`;
  - `completion(profile) -> 0..100`, where each of the six quests weighs equally;
  - the fields per quest, copied from the staff questionnaire's columns (`transport/game-data/Transport data
    questionnaire (staff).xlsx`), with the same names in camelCase;
  - the parts IDs, which are the Task 1 component IDs.
- Team bar: "<campus> fleet: N of M buses ready" (ready = 100%). No per-person ranking.

- [ ] **Step 1: Write failing tests**
  - `completion is 0 for an empty profile and 100 when all six quests are done`;
  - `papers quest missing chassisNo lists it in missing`;
  - `Fee Clerk can save LMS 4 papers, refused for LMS 1`;
  - `Coordinator LMS4-6 can save driver quest for LMS 5`;
  - `driver quest accepts a date of birth that makes the driver 60+, saves it with flag ageLimit:true, and returns a warning` (data is recorded; the line-up board in 1b blocks the driver);
  - `old questionnaire columns map 1:1 to quest fields` (fixture from the xlsx headers).
- [ ] **Step 2: Run** `node tests/transport/test-fleet-quests.js` and `node tests/transport/test-transport-gs.js`.
  Expected: FAIL.
- [ ] **Step 3: Build the logic, backend and page.** The page shows bus cards with completion rings, quest
  cards with short forms, a "ready" badge, the campus team bar, and the Owner's gaps view. It uses the LMCS
  design skills, then `game-ui-ux` and `gamification-loops`, and passes the 375 px layout check.
- [ ] **Step 4: Run** the tests, `node tests/transport/layout-check.browser.js` and `node tests/verify.mjs`.
  Expected: PASS, with no new failures.
- [ ] **Step 5: Commit** with the message `transport: fleet setup quests replace the staff questionnaire`.

### Task 9: Agency data import (Parts Catalog)

**Files:**
- Create: `transport/capture/agency_import.py`, `transport/capture/test_agency_import.py`
- Modify: `apps-script/coordinator-transport-gps.gs`:
  - `POST action=transportcatalogpush {secret, payload:{models:[...], vehicles:[...], history:[...]}}`;
  - tabs `Parts Catalog`, `Agency Vehicles`, `Agency History`;
  - served in `coordinatortransportinsight` as `catalog`, read-only.
- Test: `tests/transport/test-transport-gps.js`

**Interfaces:**
- Consumes: `transport/game-data/Service centre data template (agencies).xlsx` (one filled file per agency).
  It has sheets `Our vehicles`, `Service history`, `Maintenance schedule`, `Wear parts`, `Service packages`,
  `Running norms` and `Contacts`. The hidden column A `Code` in the schedule and wear sheets carries the
  component code.
- Produces:
  - `parse_agency(path) -> {models, vehicles, history, contacts}`. It skips the grey example row and blank
    rows, and parses DD-MM-YYYY dates and ₹ numbers.
  - The garage reads `catalog.models[model].parts[code] = {lifeKm, lifeMonths, price, labour}`.

- [ ] **Step 1: Write failing tests** (with a fixture copy of the template, filled with 2 models)
  - `example row is ignored`;
  - `severe-duty interval wins over normal when present`;
  - `a row with text in a km column is reported, not imported`;
  - `two files for the same model merge, newest file wins per part`;
  - `catalogpush with a wrong secret refused`.
- [ ] **Step 2: Run** `python3 -m pytest transport/capture/test_agency_import.py` and the node test.
  Expected: FAIL.
- [ ] **Step 3: Implement** with openpyxl. The CLI is `python3 transport/capture/agency_import.py <file.xlsx>
  [--push]`: a dry run prints a summary, and `--push` sends it.
- [ ] **Step 4: Run** both. Expected: PASS.
- [ ] **Step 5: Commit** with the message `transport: import the agencies' service data into the parts catalog`.

### Task 10: Verify and hand over for deploy

**Files:** none new.

- [ ] **Step 1:** `node tests/verify.mjs`. Expected: only the failures already on main
  (`coordinator/test-approvals.js`, `datasrc/test-datasrc.js`), nothing new.
- [ ] **Step 2:** Dry-run deploys and list the changed files per project: `node apps-script/deploy.mjs roster`,
  `node apps-script/deploy.mjs office`, `node apps-script/deploy.mjs coordinator`.
- [ ] **Step 3:** Send Uday the exact push and deploy commands. He runs them, because production deploys
  are his.
- [ ] **Step 4:** After his deploy, run `node tests/verify.mjs --live`, then do the manual phone check from
  Task 5 Step 5 with a Coordinator.
- [ ] **Step 5:** Update the vault Dispatch log row with the commits, versions and live-check results.
