# Support Session forms → native in-game forms: deploy checklist

Nothing here runs without Uday's go-ahead. Never push or deploy from a builder session.
Branch `ss-forms-game-migration`, stacked on live main `7eff4db`.

- [ ] 1. Uday's go-ahead (deploys the `pdr` Apps Script project and publishes the Pages change).
- [ ] 2. One Opus review (data-backend change) — requested, pending as of this doc.
- [ ] 3. A "GM pass" from the Assistant Game Director (emoji/visual consistency) — requested, pending.
- [ ] 4. `node tests/verify.mjs` passes (only `datasrc` may fail — known, unrelated: a stale lm-monitor exemption, failing on main too).
- [ ] 5. `node apps-script/deploy.mjs pdr` (dry run — confirm it shows exactly `main`/`ss-forms-sync`/`ss-tracker` changed, nothing else), then `node apps-script/deploy.mjs pdr --push --deploy "SS forms: unified schema, native in-game forms"`. Keeps the existing `/exec` URL.
- [ ] 6. Push Pages (this branch → main, or however Uday wants it merged).
- [ ] 7. `node tests/verify.mjs --live`.
- [ ] 8. Open `principal/support-sessions.html` in the browser pane, signed in as a Principal. Console clean. Pick a school, pick each of the 6 roles in turn, confirm the employee list and rubric both render. Submit one real test entry for one role.
- [ ] 9. Check the new row landed in the "LMCS Teacher SS 2026 (Responses)" workbook's "SS Submissions" tab (EmployeeId/CampusId/EvaluatorEmail/Role/RubricVersion/Score1-10, Timestamp a real date) and "SS Rubrics" got exactly one row for that role.
- [ ] 10. Open the SS Dashboard (`action=ssdashboard`, e.g. via `principals-daily-reporting/index.html`'s SS Dashboard tab) and confirm that employee's history shows BOTH their old Google-Form submissions and the new one, newest first.
- [ ] 11. Confirm `principals-daily-reporting/index.html`'s Support Sessions tab still loads and its 6 Google Forms still work (they're untouched — this is a "did I actually break nothing" check, not a feature test).

## Decisions to remember

- **Unified schema, not one tab per role.** "SS Submissions" (Timestamp, EmployeeId, CampusId, EvaluatorEmail, Role, RubricVersion, Score1-10) + "SS Rubrics" (the (Role, RubricVersion) → titles/max history, append-only). Both tabs live in the SAME "LMCS Teacher SS 2026 (Responses)" workbook the old shared-form roles already used — not a new spreadsheet. Both are lazily created on first write (same pattern as the Game backend's "Setup Data" tab) — no manual setup step.
- **Old per-role tabs are read-only history, never backfilled.** `ss-tracker.gs`'s `ssReadAllSubmissions_` reads both the old tabs and the new unified tab and merges them, so dashboards stay continuous across the cutover.
- **Keyed by EmployeeId, not a typed name.** `ssSubmit_` checks `employeeId` against `ssFormMeta_`'s own employee list for that exact (role, school, caller) before writing — not just "is this a non-empty string."
- **Rubric versioning**: bump `SS_ROLE_CONFIGS[role].rubricVersion` by hand whenever `rubricTitles` for that role actually changes. The next submission auto-appends a new row to SS Rubrics; old rows keep pointing at the version that was live when they were written.
- **Where it lives**: `principal/support-sessions.html`, linked from `principal/index.html`'s "Daily work" path as "Support Sessions". The game director's 3D tappable-room system wasn't ready yet (2026-10-28) — this is the plain-card fallback V1 approved; swap in a real room hook once that lands (coordinated separately).
- **Old page**: `principals-daily-reporting/index.html`'s Support Sessions tab keeps its 6 Google Forms exactly as they were, with one new banner linking forward to the new page — nothing removed, per Uday via V1.
- **Emoji**: proposed `supportSession` (📝, matching V1's own room-icon choice) and `evaluate` (✍️) to the Gamemaster (Portal game director session) — not added to `assets/game/emoji.js` yet, pending their sign-off. The new page already references `supportSession` via the same safe `LMCSEmoji.get()`-guarded pattern every other page uses, so it does nothing until the key exists, and picks it up automatically once it does.

## What a test harness had to catch up on

`tests/pdr/harness.js` is new (no test harness existed for this project's `main.gs`/`ss-forms-sync.gs`/`ss-tracker.gs` before). Building it surfaced that `main.gs`'s authorization model changed substantially since September (`pdrIsElevated_`/`pdrLimitedAllows_`, `caller.roles` plural, a Teacher/Staff auto-signin fallback) — none of it needed changing for this work (`ssformmeta`/`submitss` were already gated correctly for Principal/Coordinator/Owner), but it's why this took a careful read of the current file before touching anything, not just trusting September's memory of it.

*Compiled from a Claude Code session, 2026-10-28. Source: V1 LMCS Master Agent's brief (relaying Uday, via Telegram, 28 Oct).*
