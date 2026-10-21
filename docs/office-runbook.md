# Office portal runbook (Fee Clerk + PRO Portal)

Backend: the Apps Script project "LMCS Office Backend" (`office` in [`apps-script/projects.json`](../apps-script/projects.json)).
Pages: [`office/`](../office/) on GitHub Pages. Nothing here is created yet: the first section is Uday's one-time setup (about 15 minutes).
Never put a Sheet, folder or secret ID in the repo; they live in Script Properties only. Roles and campuses come from the allowlist sheet.

---

## 1. One-time setup (Uday, logged in as uday.kanwar@lms.org.in)

The backend runs as you, so every book and file is owned by your account. Do not share any of the folders or Sheets below.

### 1.1 Create the Google files

1. Drive: create folder `LMCS Office` (the Drive root, for uploaded slips and bills) and inside it a folder `Backups`. Note both folder IDs (the part after `/folders/` in the URL).
2. Sheets: create a blank spreadsheet `LMCS Office Config`. Note its ID (between `/d/` and `/edit`). The backend creates and seeds its tabs (`Categories`, `Limits`) on first use.
3. Sheets: create a blank spreadsheet `LMS1 Office 2026-27` (the book name is what the backup copies are named after, so keep it unique per campus and year). Note its ID. The backend creates all its tabs on first use; do not add tabs, formulas or merged cells.
4. Opening balances: before the first entry, sign in as the Finance Head or Owner, open Close Day, and fill the Opening balances section (cash petty, fee, other, bank, UPI, in rupees; blank means 0), then press "Set opening balances". It says "Opening balances are locked because day book entries already exist" if any DayBook row exists (`OPENING_LOCKED`), so do it first. Missing balances count as zero. It is also locked once any day has been closed. If the legacy import (section 3) is used, do not use this form: put the starting balances in the importer mapping's `opening`; the importer writes them as `opening-<FY>.csv`, loaded before the day book.
5. The allowlist sheet: use the shared **LMCS Principal Allowlist** sheet and point `OFFICE_ALLOWLIST_SHEET_ID` at it. A separate copy does not work: the office pages sign in through `assets/auth.js`, which always reads the shared sheet (via its allowlist API), so anyone not on the shared sheet cannot even reach the office pages. Columns: A email, B name, C campus, D roles (comma separated). Column C must hold **exactly one campus code** (`LMS1` ... `LMS6`, `HES`) **or `ALL`**: never a comma list. `auth.js` takes column C as one value, so `LMS1,LMS2` becomes campus "LMS1,LMS2" and every office call is refused with `FORBIDDEN_CAMPUS`. Someone who works at two campuses gets `ALL` or works on one. Matching is on lowercase email.

### 1.2 Create the Apps Script project

1. script.google.com > New project > rename to `LMCS Office Backend`.
2. Project Settings: tick "Show appsscript.json manifest file in editor". Open `appsscript.json` and make sure it has `"timeZone": "Asia/Kolkata"`, `"runtimeVersion": "V8"` and these `oauthScopes` (the subset of [`apps-script/appsscript.json`](../apps-script/appsscript.json)):
   - `https://www.googleapis.com/auth/spreadsheets`
   - `https://www.googleapis.com/auth/drive`
   - `https://www.googleapis.com/auth/script.external_request` (token check against Google)
   - `https://www.googleapis.com/auth/script.scriptapp` (the nightly trigger)
   - `https://www.googleapis.com/auth/script.send_mail` (backup failure email)
   - `https://www.googleapis.com/auth/userinfo.email` (needed so the backup alert can fall back to the script owner's address when `OFFICE_ALERT_EMAIL` is missing)
   - Also keep `"webapp": {"executeAs": "USER_DEPLOYING", "access": "ANYONE_ANONYMOUS"}`.
   The deploy tool keeps the remote manifest as it is (it only overlays the `.gs` files), so this edit is made once, here.
3. Project Settings > Script ID: copy it. Put it in `apps-script/projects.json` under `office.scriptId` (section 1.5).
4. Deploy > New deployment > type Web app > Execute as: **Me** > Who has access: **Anyone** (every call is token-checked server-side). Authorise when asked. Copy the `/exec` URL and the Deployment ID. The first deployment can be the empty project; `deploy.mjs` later moves this same deployment to new versions and the URL stays the same.

### 1.3 Script Properties

Project Settings > Script Properties > Add. All are required unless marked.

| Key | Holds |
|---|---|
| `OFFICE_GOOGLE_CLIENT_ID` | The Google OAuth client ID the portal signs in with (the same one `assets/auth.js` uses). Token audience is compared to it. |
| `OFFICE_ALLOWLIST_SHEET_ID` | Spreadsheet ID of the allowlist (section 1.1 item 5). |
| `OFFICE_CONFIG_SS` | Spreadsheet ID of `LMCS Office Config`. |
| `OFFICE_SS_LMS1_2026-27` | Spreadsheet ID of the LMS 1 book for FY 2026-27. Pattern: `OFFICE_SS_<CAMPUS>_<FY>`, campus upper case, FY like `2026-27` (April to March). One key per campus per year. |
| `OFFICE_DRIVE_ROOT` | Folder ID of `LMCS Office` (uploads go in sub-folders campus / FY / category, created on demand). |
| `OFFICE_BACKUP_FOLDER` | Folder ID of `Backups`. Must be a folder used only for backups (see known limits). |
| `OFFICE_ALERT_EMAIL` | Optional but recommended. Who is mailed when the nightly backup fails. If missing, the script owner is mailed and the run records a failure. |

The nightly backup copies every key that starts with `OFFICE_SS_` plus `OFFICE_CONFIG_SS`.

### 1.4 Allowlist rows (test accounts first)

Add rows to the shared Principal Allowlist sheet (section 1.1 item 5; one campus code or `ALL` in column C). Use test Google accounts first (a colleague or a second account of yours), real staff only after the checklist in section 2 passes.

| Who | Roles (col D) | Campus (col C) |
|---|---|---|
| Pilot clerk | `FeeClerk` | `LMS1` |
| Admin manager | `AdminManager` | `LMS1` |
| Finance Head | `FinanceHead` | `ALL` (or `LMS1`) |
| You | `Owner` | `ALL` |

Roles used by the office backend: `FeeClerk`, `AdminManager`, `FinanceHead`, `Principal`, `Coordinator`, `Owner`. What each may do: day book entry and reverse (FeeClerk, AdminManager, FinanceHead, Owner); daily report (FeeClerk, AdminManager, Owner; plus a substitute granted by AdminManager or Owner); deposit (FeeClerk, AdminManager, Owner); sign a deposit, close a day, set opening (FinanceHead, Owner); reopen a closed day (Owner only); read-only views (all six roles). A user with several roles lists them comma separated (roles only; the campus column takes one value). A campus the user is not listed for is refused on every action. Office-only roles (`FeeClerk`, `AdminManager`, `FinanceHead`) give nothing in the other portals, which check for `Owner`, `Coordinator`, `Principal` or `Teacher`; the pilot checklist confirms this.

### 1.5 Fill the IDs, dry run, deploy

From the repo root, once: `npx @google/clasp@3 login`.

1. Edit `apps-script/projects.json`: set `office.scriptId` to the Script ID.
2. Dry run: `node apps-script/deploy.mjs office`. It pulls the remote project, overlays the 11 office `.gs` files, and prints changed/new/unchanged. Nothing is pushed.
3. Push and deploy: `node apps-script/deploy.mjs office --push --deploy "office v1"`. The live `/exec` deployment moves to the new version.
4. Record the deployment ID in `projects.json` under `office.deploymentId` (this also makes `verify.mjs --live` ping the `/exec` URL). Commit.

### 1.6 Point the portal at the backend

1. `office/js/config.js`: set `OFFICE_BACKEND_URL` to the `/exec` URL. It is not a secret (the other portals hardcode theirs).
2. `office/sw.js`: bump `CACHE` to the next cache name (see the `CACHE` constant in `office/sw.js`). The shell is cached first, so without the bump a returning device keeps the old empty `config.js`.
3. `tests/verify.mjs`: add `'office/'` to the `pages` list inside the `--live` block.
4. Commit, push to main, wait for GitHub Pages (a minute or two).

### 1.7 Triggers and failure notices

1. In the Apps Script editor, pick `officeInstallTriggers` in the function dropdown and Run once. This replaces any earlier trigger of the same name with one daily trigger for `officeBackupNightly` at about 02:00 (Asia/Kolkata). Authorise if asked. Check Triggers (clock icon): exactly one `officeBackupNightly` time trigger.
2. Still in Triggers: edit the trigger > Failure notification settings > "Notify me immediately" (or daily). The script itself cannot email when the run is killed by a timeout, so this Apps Script setting is the only alert for that case.
3. Run `officeBackupNightly` once by hand and open the `Backups` folder: expect `LMS1 Office 2026-27 <today>` and `LMCS Office Config <today>` (names are `<book name> YYYY-MM-DD`).

### 1.8 Final check

`node tests/verify.mjs --live` should show the office page and the office `/exec` URL as ok. Then walk section 2.

---

## 2. Pilot checklist at LMS 1

Use test accounts and a test date for anything you do not want in the real books; the books are append-only, so test rows stay (mark them in the narration, e.g. "TEST"). Best done with a fresh book that you replace (new spreadsheet, update the property) before real use, or do the testing in a throwaway campus key such as `OFFICE_SS_LMS2_2026-27` with an allowlist row for `LMS2`.

Do in real Chrome on a phone or laptop (the built-in browser could not verify the service worker).

- [ ] Sign in with the clerk test account; the Today screen loads with no "backend not configured" message.
- [ ] Sign in with an account not in the allowlist: refused.
- [ ] Sign in with the FeeClerk-only test account and open the Principal, Coordinator, Teacher and salary pages (and the other portals' home pages): none of them shows data or management controls for it. If one does, remove the row and tell Uday before any real staff are added.
- [ ] Day book: switch the device offline, add an entry; it shows "Not yet synced". Go online; it syncs and the indicator returns to ok.
- [ ] Day book: reverse an entry; the original shows Reversed, the reversal is a new row.
- [ ] Daily report submitted before 18:00 (a test date, or by day): not flagged late.
- [ ] Daily report submitted after 18:00 IST: flagged late (the 6 PM flag).
- [ ] Deposit with a photo of the slip: the file uploads first, the deposit follows; deposit amount cannot exceed the fee-cash balance.
- [ ] Finance Head account: sees the deposit, views the slip, signs it.
- [ ] Finance Head closes yesterday (a past day only; today is refused with `CANNOT_CLOSE_TODAY`); closing balances show.
- [ ] A new entry for the closed day is refused (`DAY_CLOSED`).
- [ ] Owner account reopens the closed day with a reason; the `Reopens` tab has the row; the day can be closed again.
- [ ] Second device closing the day while the first still has unsynced entries for it: the first device's entries are refused with `DAY_CLOSED` and show "Needs attention", they are not dropped.
- [ ] Backup: next morning the `Backups` folder has a copy of each book dated that day, and no failure email arrived.
- [ ] Restore drill: open the backup copy of the LMS 1 book, open the same closing day in the portal, compare the closing totals (cash by bucket, bank, UPI) with what the portal shows live. They must match to the paisa. Note the result in the vault.
- [ ] Service worker in real Chrome: DevTools > Application > Service Workers shows `sw.js` activated, the cache named by the `CACHE` constant in `office/sw.js` holds the shell files. Turn Network to Offline, reload `office/`: the shell loads from cache and the Today screen shows cached content or an offline notice. Confirm after a deploy that a returning device picks up the new cache name.
- [ ] Sign-out with unsynced entries warns that sign-out deletes them (this is expected; section 4.4); entries another user queued on the same device are kept.
- [ ] Shared PC: clerk A adds an entry while the PC is offline and closes the tab without signing out; clerk B then signs in on the same PC while online. B's header shows "1 from another user" and the entry is not sent; when A signs in again it syncs and the `DayBook` row's `created_by` is A.
- [ ] After all this, replace test data: new LMS 1 book, update `OFFICE_SS_LMS1_2026-27`, set real opening balances on the Close Day screen, add real allowlist rows, remove the test rows. Only then start the one-month parallel run beside the paper day book.

---

## 3. Legacy day book import (only with Uday's go-ahead)

Tool: [`tools/office-import-daybook.mjs`](../tools/office-import-daybook.mjs), loader: `officeImportRows_` in [`apps-script/office-import.gs`](../apps-script/office-import.gs). Nothing is ever guessed: a row that cannot be read exactly is skipped with its reason.

1. Export the old Sheet as CSV (File > Download > CSV) once, and keep that one saved file for every run and every year. Row ids come from the row number in the export, so re-exporting after any edit to the old Sheet (a row added, deleted or sorted) changes the ids and a re-run would append rows twice. Keep it outside the repo and never commit it (it names real people).
2. Copy [`tools/office-import-mapping.example.json`](../tools/office-import-mapping.example.json) to a file outside the repo and rename the columns and value maps to the real export (header comment in the tool lists every field: date column and format, signed amount or receipt/payment columns, mode map, bucket, category map, optional closing balance column, optional `opening`).
3. Run: `node tools/office-import-daybook.mjs legacy.csv --campus LMS1 --mapping /path/to/mapping.json --out /path/to/out`. Output: `opening-<FY>.csv` (one per financial year in the export), `daybook.csv`, `closes.csv`, `report.txt`. The first year's opening is the mapping's `opening`; each later year's opening is the import's own 31 March closing of the year before, so a multi-year export gives every year's book its carried-forward balances.
4. Read `report.txt` before anything else:
   - "Days left open": a day with a skipped row gets no Closes row. Fix those days by hand in the portal later and close them there.
   - "totals are partial": skipped rows had no readable date, so day totals cannot be trusted. Do not load until resolved.
   - Per-day total differences against the legacy closing column are listed, never "fixed". Resolve each before loading.
   - "Category defaulted to other_in/other_out": rows whose category was not in the mapping's `categoryMap`. Add the missing names to the map and re-run (same saved export) unless "other" is right for them.
   - "Load order": the exact sequence of runs for step 6.
5. Large CSVs: `officeAppend_` re-reads the tab for every row, so cost grows with the square of the row count and the editor run is cut at 6 minutes. Split `daybook.csv` into chunks of a few hundred rows (keep the header line in each chunk) and run one chunk at a time. Re-running is safe: each row id is accepted once.
6. In the Apps Script editor, per financial year, oldest first, into that year's book (`OFFICE_SS_LMS1_<FY>` must exist): run `officeImportRows_('LMS1', '2025-26', 'Opening', '<opening-2025-26.csv text>')` first, then `officeImportRows_('LMS1', '2025-26', 'DayBook', '<csv text>')` for each chunk of `daybook.csv`, then `'Closes'` with `closes.csv`. DayBook is refused (`OPENING_FIRST`) until that book has Opening rows, and new Opening rows are refused (`OPENING_LOCKED`) once it has DayBook rows. Rows dated in another year are counted as `otherFy` and left for that year's run. Paste the CSV text as a string constant in a temporary function and delete it afterwards (the text holds real data). The return value shows `appended` / `duplicates` / `otherFy`.
7. Verify: compare closing totals of a few closed days and the latest day with the legacy sheet. Imported rows are written with `created_by` `import`. Opening balances come from the `opening-<FY>.csv` files (never the Close Day form, which is locked once imported rows exist). Imported closed days freeze every day before them, so do not plan to add legacy corrections before the last imported closed day.

---

## 4. Operations

### 4.1 Add a campus

1. Create a spreadsheet `LMS<N> Office 2026-27` (or the current FY) in Drive (same folder rules as 1.1).
2. Script Properties: add `OFFICE_SS_LMS<N>_<FY>` with its ID. The nightly backup picks it up automatically. Then open the Today screen once as the Owner for that campus before any clerk starts, so the tabs are created by one call (see 4.3).
3. Add opening balances in its `Opening` tab before the first entry (Close Day screen, 1.1 item 4).
4. Allowlist rows with the campus in column C for its clerk and manager. Campus codes in use: LMS1 to LMS6.

### 4.2 Add or change a user

Edit the shared Principal Allowlist sheet: email, name, one campus code or `ALL`, roles (comma separated). Changes take effect within about 5 minutes (the backend caches a verified caller for 300 seconds). To remove access, delete the row; the same 5-minute window applies. Rotating the allowlist means editing that sheet, nothing else.

### 4.3 Year end (new FY book)

Before 1 April: create the next-year spreadsheet (`LMS1 Office 2027-28`) and add `OFFICE_SS_LMS1_2027-28`, for every campus. Then, before any clerk works on 1 April, sign in as the Owner and open the Today screen once for each campus (switch campus in the header): the first call creates the new book's tabs, and doing it once alone avoids two first calls racing to create the same tab. Set its Opening rows to the closing balances of 31 March. Until the new key exists, every call for a date in the new year returns `NO_BOOK`. Corrections in April can still reverse an entry of the previous year (the reversal is written to the new year's book; the previous year's book must stay configured). Keep the old property: Today, deposits and file views read it.

### 4.4 "Needs attention" entries

An entry sits in the device's outbox, marked "Needs attention", when the backend refused it with a reason (for example `DAY_CLOSED`, `FILE_MISSING`, `INSUFFICIENT_CASH`, `LEGS_MISSING`, `ALREADY_REVERSED`). Network trouble or a lapsed sign-in is not this: those stay "waiting" and retry by themselves; for a lapsed sign-in, sign in again.

- The header shows "N need attention". The Close screen blocks closing a day while, on that device and for that campus: any entry is still waiting to sync; or an entry needing attention is dated on or before that day (a day book entry, daily report or deposit for that day or earlier, and the slip upload such a deposit needs); or the device's queue could not be read. Other entries needing attention, and unsigned deposits, only warn.
- Entries belong to the person who entered them. On a shared PC, another user's queued entries are not sent under your sign-in: they show as "Waiting for <email> to sign in on this device" in the panel (and "from another user" in the header) until that person signs in on this device. They still block closing a day, because they have not reached the server.
- Click "Needs attention (N)" (or the sync indicator) in the header, on any office page. The panel lists each entry in plain words (for example "Day book entry ₹1,200.00 on 21/10/2026") with the reason. Retry sends it again (use after fixing the cause). Discard asks for confirmation, then deletes it from this device and it is never sent.
- For `DAY_CLOSED`, ask the Owner to reopen the day first (with a reason), then Retry (or Discard and re-enter), and have the Finance Head close it again.
- Sign-out also deletes your own unsynced entries (another user's are kept for them), but use Discard for a single entry instead.
- Entries are never silently dropped; one stuck entry does not block the ones after it.

### 4.5 Read the Audit tab

Each book has an `Audit` tab: `id`, `ts` (ISO timestamp), `who` (email), `action` (e.g. `daybook.add`, `day.close`, `day.reopen`, `file.view`), `tab` and `row_id` (what was written), `campus`, `after` (the new row as JSON). Filter by `who` or `row_id` to see who did what. Every file view is audited, including refused ones (those land in the caller's own campus book, best effort). Legacy imports are audited as `who` = `import`, not as you. The tab is append-only; never edit it.

### 4.6 Restore from a backup

1. Open `Backups`, find the book's copy of the day you want (`<book name> YYYY-MM-DD`; kept: the last 30 daily copies plus the first-of-month copy for the last 12 months).
2. Make a copy of it (or use it directly) and take its spreadsheet ID.
3. Set the matching Script Property (`OFFICE_SS_<CAMPUS>_<FY>`) to that ID. Do not rename tabs or edit rows. Entries made after the backup time are gone from the book. Devices have already cleared those from their outbox, so re-enter them from the paper day book.
4. Open the portal and compare the latest closing totals with the paper day book.

### 4.6a Deposit slips and other uploads (Drive)

The nightly backup copies the Sheets only, not the uploaded slips and bills. Their backup method: Google Drive for Desktop on Uday's Mac, set (once, during setup 1.1) to sync the `LMCS Office` Drive root folder with "Mirror files", so the Mac holds a full local copy. A slip deleted by mistake is restored from Drive's Trash within 30 days (drive.google.com > Trash > Restore); a restored file keeps its file id, so the book's `Files` row and "View slip" work again.

### 4.7 ERP export import

Not built. ERP totals are entered by hand (the ERP screen on the deposits page) until Uday supplies the export format.

### 4.8 Deploying a change

`node tests/verify.mjs`, then `node apps-script/deploy.mjs office` (dry run), then with `--push --deploy "message"`, then `node tests/verify.mjs --live`. If `office/` page files change, bump `CACHE` in `office/sw.js`.

---

## 5. Known limits for the pilot

- Every write takes a script-wide lock (20 s wait); at LMS 1 volumes this is fine. Apps Script runs stop at 6 minutes, which matters for the legacy import (chunk it) and the nightly backup (a trigger timeout cannot email, hence the Apps Script failure notice in 1.7).
- One row append reads the whole tab each time, so very large tabs get slow; a year of LMS 1 day book is well within Sheets limits (10 million cells per spreadsheet), but if a book gets sluggish, tell Uday.
- Only the Owner can reopen a closed day, and a day can be closed only after it is over (not today). An April correction of a March entry goes into the new year's book.
- Opening balances lock after the first DayBook row.
- Files: one upload at a time, up to about 3 MB (larger PDFs are not supported yet); duplicates are detected by fingerprint within the current FY book.
- Sign-out deletes the signed-in user's unsynced entries and the offline cache on that device; other users' queued entries stay until they sign in.
- The allowlist change window is about 5 minutes (cached caller).
- The nightly backup covers the Sheets only; uploaded slips rely on Drive for Desktop on Uday's Mac and Drive Trash (4.6a).
- Backup folder must contain only backups: the retention step trashes any file with a dated name in it that falls outside the 30-day / 12-month window.
- A backup that misses a book (property missing, file deleted) emails the alert address; no email on a missing `OFFICE_CONFIG_SS` while books exist.
- Parent access, modules 4 to 12, admissions, communications and approval limits (placeholder rows only) are not part of the pilot.
