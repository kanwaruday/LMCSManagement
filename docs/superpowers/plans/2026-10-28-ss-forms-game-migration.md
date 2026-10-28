# Support Session forms → native in-game forms: deploy checklist

Nothing here runs without Uday's go-ahead. Never push or deploy from a builder session.
Branch `ss-forms-game-migration`, stacked on live main `7eff4db`. Latest sha: `8701fe3`.

- [ ] 1. Uday's go-ahead (deploys the `pdr` Apps Script project and publishes the Pages change).
- [x] 2. One Opus review (data-backend change) — done. Found 2 Critical bugs (a campus-authorization bypass in `ssSubmit_`, and new Teacher SS submissions not reaching the Teacher Portal's own Evaluations/Rank views) plus 5 Important and 4 Minor issues — all fixed and tested, see the `8701fe3` commit message for the full list.
- [x] 3. A "GM pass" from the Assistant Game Director (emoji/visual consistency) — done, 6 fixes applied (next-step slot, red Submit, gb-done success screen, Help panel, 44px/no-horizontal-scroll, dropped hand-rolled CSS for shared tokens).
- [ ] 3b. A second GM pass from the Portal game director (the room-entry restructuring: `host:'ss'`, one row per form) — sha sent, response pending as of this doc.
- [x] 4. `node tests/verify.mjs` passes (only `datasrc` may fail — known, unrelated: a stale lm-monitor exemption, failing on main too).
- [ ] 5. `node apps-script/deploy.mjs pdr` (dry run — confirm it shows exactly `main`/`ss-forms-sync`/`ss-tracker`/`teacher-ss` changed, nothing else), then `node apps-script/deploy.mjs pdr --push --deploy "SS forms: unified schema, native in-game forms"`. Keeps the existing `/exec` URL.
- [ ] 6. Push Pages (this branch → main, or however Uday wants it merged — note branch `home-base` also touches `principal/index.html`, for the 3D room system; merge order is Uday/V1's call, not decided here).
- [ ] 7. `node tests/verify.mjs --live`.
- [ ] 8. Open `principal/support-sessions.html` in the browser pane, signed in as a Principal. Console clean (a real bug here — an unhandled rejection on every load — was found and fixed by the Opus review). Pick a school, pick each of the 6 roles in turn (or use the room's 6 `?role=` links from principal/index.html), confirm the employee list and rubric both render. Submit one real test entry for one role.
- [ ] 9. Check the new row landed in the "LMCS Teacher SS 2026 (Responses)" workbook's "SS Submissions" tab (EmployeeId/CampusId/EvaluatorEmail/Role/RubricVersion/Score1-10, Timestamp a real date) and "SS Rubrics" got exactly one row for that role.
- [ ] 10. Open the SS Dashboard (`action=ssdashboard`, e.g. via `principals-daily-reporting/index.html`'s SS Dashboard tab) and confirm that employee's history shows BOTH their old Google-Form submissions and the new one, newest first.
- [ ] 10b. For a `teacher`-role test specifically: also open the Teacher Portal as that teacher (or via Owner Test Mode / "view as") and confirm the new submission shows in their own Evaluations view and Rank score, not just the Principal-facing Dashboard — this is the Critical #2 fix, worth confirming live, not just in tests.
- [ ] 11. Confirm `principals-daily-reporting/index.html`'s Support Sessions tab still loads and its 6 Google Forms still work (they're untouched — this is a "did I actually break nothing" check, not a feature test).

## Decisions to remember

- **Unified schema, not one tab per role.** "SS Submissions" (Timestamp, EmployeeId, CampusId, EvaluatorEmail, Role, RubricVersion, Score1-10) + "SS Rubrics" (the (Role, RubricVersion) → titles/max history, append-only). Both tabs live in the SAME "LMCS Teacher SS 2026 (Responses)" workbook the old shared-form roles already used — not a new spreadsheet. Both are lazily created on first write (same pattern as the Game backend's "Setup Data" tab) — no manual setup step.
- **Old per-role tabs are read-only history, never backfilled.** `ss-tracker.gs`'s `ssReadAllSubmissions_` reads both the old tabs and the new unified tab and merges them, so dashboards stay continuous across the cutover.
- **Keyed by EmployeeId, not a typed name.** `ssSubmit_` checks `employeeId` against `ssFormMeta_`'s own employee list for that exact (role, school, caller) before writing — not just "is this a non-empty string."
- **Rubric versioning**: bump `SS_ROLE_CONFIGS[role].rubricVersion` by hand whenever `rubricTitles` for that role actually changes. The next submission auto-appends a new row to SS Rubrics; old rows keep pointing at the version that was live when they were written. The OLD (frozen) per-role tabs read by `legacyRubricTitles` instead — a separate, never-changes-again snapshot — so a later rubric edit can't silently corrupt old history (found by code review; see the commit message).
- **Where it lives**: `principal/support-sessions.html`, one shared page for all 6 roles (role comes from `?role=<key>`, preselected if present). Linked from `principal/index.html`'s own room: `{ title: 'Support Sessions', e: 'supportSession', host: 'ss', pages: [6 rows, one per form] }` — per the Portal game director, 2026-10-28: `host:'ss'` is read by the Home Base 3D building (branch `home-base`, not yet merged) to mark this room gold once `'ss'` joins its `HOSTS` list. Until that building ships, this renders as the same plain card every other room uses.
- **Old page**: `principals-daily-reporting/index.html`'s Support Sessions tab keeps its 6 Google Forms exactly as they were, with one new banner linking forward to the new page — nothing removed, per Uday via V1.
- **Emoji**: `supportSession` → 🤝 (not 📝, which stays `homework` only) and `evaluate` → ✍️, decided by the Portal game director/Gamemaster and landed in `assets/game/emoji.js` on branch `home-base` (2c3e88f) — not yet on this branch or main. Every reference here goes through `LMCSEmoji.get()`/`tag()` or `data-emoji`, never a hand-typed character, so it stays correctly inert until `home-base` merges and picks the real glyphs up automatically.

## What a test harness had to catch up on

`tests/pdr/harness.js` is new (no test harness existed for this project's `main.gs`/`ss-forms-sync.gs`/`ss-tracker.gs` before). Building it surfaced that `main.gs`'s authorization model changed substantially since September (`pdrIsElevated_`/`pdrLimitedAllows_`, `caller.roles` plural, a Teacher/Staff auto-signin fallback) — none of it needed changing for this work (`ssformmeta`/`submitss` were already gated correctly for Principal/Coordinator/Owner), but it's why this took a careful read of the current file before touching anything, not just trusting September's memory of it.

*Compiled from a Claude Code session, 2026-10-28. Source: V1 LMCS Master Agent's brief (relaying Uday, via Telegram, 28 Oct).*
