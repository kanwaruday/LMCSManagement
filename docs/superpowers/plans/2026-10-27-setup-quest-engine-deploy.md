# Setup quest engine + T1: deploy checklist

Nothing here runs without Uday's go-ahead. Never push or deploy from a builder session.

- [ ] 1. Uday's go-ahead (deploys the Game backend and publishes the setup page).
- [ ] 2. `node tests/verify.mjs` passes (only `datasrc` may fail, and only for the known, unrelated reason).
- [ ] 3. `node apps-script/deploy.mjs game` (dry run), then `node apps-script/deploy.mjs game --push --deploy "Setup quest engine + T1"`. This keeps the /exec URL. No `gameSetup` run is needed: the `Setup Data` tab is created on the first save and `confirmQuests` falls back to `{}`.
- [ ] 4. Push Pages.
- [ ] 5. `node tests/verify.mjs --live`.
- [ ] 6. Open `setup/index.html?sample=1&role=Teacher` in the browser pane, signed in as the Owner. Console clean. Then `&role=Principal` for the P1 to P3 drafts.
- [ ] 7. One real Teacher (Uday picks who) opens their Buddy mission "Check the classes you teach" and confirms one class. Check the new `Setup Data` row.

## Decisions to remember

- **HR reviews T1 corrections.** A teacher's T1 answers go to `Setup Data` only. Nothing writes to the Employee Master or EmpAcademic. HR looks at the corrections and applies the ones that are right. (Default; Uday has not been asked to change it. Alternative later: the teacher index reads `Setup Data`.)
- **P1 to P3 ship switched off** (drafts). Review them in the sample view, then switch each on in Game Config, for example `{"confirmQuests":{"p2":{"active":true}}}`.
- Principals type class data into the CampusSetup store, pre-filled from the timetable where possible. One shared house set serves all six campuses and HES. Approval limits stay blank until the review.

*Compiled from Claude conversation, 2026-10-27. Source: setup-engine Task 5 brief.*
