# One campus picker across the portal: plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.
> Lean mode applies: one review per task and one browser round. Models follow the vault's `work/Agent Model Routing.md`.

**Goal:** every page that switches campus uses one shared picker. It offers "All campuses" first, then one chip per
school, and several schools can be selected at once. When more than one school is selected, totals show side by side
per school, colour-coded, and are never merged. Lists filter to the selected schools. The choice is remembered per
person, and the picker only ever offers schools inside that person's scope.

**Uday (2026-10-26):** "keep an option of All Campuses and then School wise, also allowing for more than 1 school being
selected and then overlaying. Bring this change across the portal."

**Architecture:**
- One module, `assets/campus-picker.js` (`window.LMCSCampus`), with `assets/campus-picker.css`.
- Pages load the module themselves. Do not edit `assets/auth.js`: the game director is adding lines there.
- The picker sits in each page's own toolbar, under the title. On the 4 role homes it goes above or below `#game-root`,
  never inside it. The floating Buddy owns the bottom-right corner (agreed with the game director).
- Static HTML/JS with no framework. Tests are Node `vm` tests run by `tests/verify.mjs`.

**Inventory:** 21 switches, compiled 2026-10-26, kept in the plan workspace (`inventory.md`). Ask the controller for it.

## Global Constraints

- **Scope comes from the signed-in session only**, using `LMCS.getSession()`:
  - `campusId` `ALL` → LMS1–LMS6;
  - a comma list → those campuses;
  - one code → just that campus.

  HES is offered only when a page passes `hes:true` *and* the session is `ALL`. Never offer a campus outside this
  scope, even if the page passes it. The backends keep their own scope checks; the picker never widens access.
- **Order and labels:** "All campuses", then LMS 1 … LMS 6, then HES. Chip text is `LMS 1` … `LMS 6` / `HES`. The full
  name comes from `LMCS.campusLabel` and is used as the title and aria-label.
- **Selection:** "All campuses" means every school in scope, shown as one combined view. Picking a school chip clears
  "All". Picking more chips adds them. Clearing the last chip returns to "All". Single-select pages (`multi:false`) show
  the same chips but allow exactly one pick.
- **Persistence:** localStorage key `lmcs-campus:<email>`, holding `{v:1, sel:'ALL'|[codes]}`. Single-select pages use
  `lmcs-campus1:<email>`. Every read and write is wrapped in try/catch. A stored campus that is now outside scope is
  dropped.
- **Colours:** CSS tokens on `:root`. Use distinct hues that work in light and dark and meet 3:1 contrast against the
  background:
  - `--campus-lms1` through `--campus-lms6`;
  - `--campus-hes`.

  Exposed in JS as `LMCSCampus.color(code)`.
- **Overlay:** when 2 or more schools are selected, every aggregate number or chart on a page shows one value per
  selected school with its colour. The renderer is `LMCSCampus.overlay(...)`. With "All" selected, or a single school,
  pages show today's single total.
- **Accessibility:** chips are `button[aria-pressed]` inside a `role="group"` with a label. They are keyboard reachable,
  have a visible focus ring, and work at 375 px (they wrap rather than scroll the page).
- **No names in static files.** All text goes through esc() or textContent. Before every commit: stage, run
  `node tools/stamp-assets.mjs`, stage again, then run `node tests/verify.mjs`.

## Claude's calls (Uday can override)

1. **District groups go everywhere.** "LMS 1–3 / LMS 4–6" tabs and the transport metro map's "Kullu side / Mandi side"
   segment become this picker. A Coordinator who wants a district picks its three chips.
2. **Single-school pages keep one pick.** These pages use `multi:false`, because their data is one school's book or
   form:
   - Office Day Book, Close, Deposits, Report, Hiring forms;
   - Principals' Daily Reporting school buttons;
   - Course Mapping school cards;
   - salary form field.

   The Office header still reloads the page on change, as today.
3. **One remembered choice per person** for all multi-select pages, so moving between pages keeps the same schools.
4. **Out of scope:** `documentsView`, which isn't mounted anywhere, and form fields that aren't view filters, such as
   the salary `fCampus` and the hiring form campus list.

## Review Focus

1. **Scope leak.** A comma-list or single-campus session, or a Fee Clerk, must never be offered another school, even
   from a stale localStorage value or a page's hard-coded list. Test in Task 1.
2. **Empty selection.** Clearing the last chip returns to All. A stored selection that has become empty also falls back
   to All. Test in Task 1.
3. **One school in scope.** With only one school, the picker hides itself and the page behaves as today. Test in
   Task 1.
4. **Overlay with a missing value.** If a selected school has no data for a number, its value shows "–", not 0 and not
   a crash. Test in Task 1.
5. **localStorage blocked** (private mode). The picker still works, it just doesn't remember. Test in Task 1.

---

### Task 1: The shared picker (Opus 5.5, medium; it decides scope)

**Files:** Create `assets/campus-picker.js`, `assets/campus-picker.css` and `tests/auth/test-campus-picker.js`.

**Interfaces (Produces):**
- `LMCSCampus.scope(session, {hes}) -> string[]`: the codes in scope, in canonical order.
- `LMCSCampus.mount(el, {session, multi=true, hes=false, onChange, label='Campus'}) -> {get(), set(sel)}`. It renders
  the chips, restores the remembered choice, and calls `onChange(sel)` once on mount and then on every change.
  - `sel` is `{all:boolean, campuses:string[]}`. With `all`, `campuses` is the whole scope.
- `LMCSCampus.get(session)`: the remembered `sel`, without mounting.
- `LMCSCampus.color(code) -> string`: `var(--campus-…)`.
- `LMCSCampus.overlay(values, sel, fmt) -> string` (HTML). `values` is `{LMS1: 12, …}`. When `sel` has 2 or more
  campuses, it returns a row of colour-dotted per-school values. Otherwise it returns the single formatted total.
  Missing values show "–".
- `LMCSCampus.filter(rows, sel, key='campus')`: returns the rows whose campus is in `sel.campuses`.

- [ ] Write the tests for every Review Focus item, plus: order, labels, single-select behaviour, persistence keys, a
  stale out-of-scope stored value being dropped, and escaping.
- [ ] Run them and see them fail. Implement. Run them again and see them pass.
- [ ] Add the colour tokens. Add one demo stub page in the scratchpad only, and do not commit it.
- [ ] Stage, stamp and verify, then commit: `Campus picker: one shared multi-school picker with per-school overlay`.

### Task 2: Coordinator HQ and transport (Sonnet 5.5, medium)

Replace the HQ district tabs (`hq.html:190`, `hq-logic.js` `districtOf`). Replace the Fleet setup scope buttons
(`capture/setup.js:142`). Replace the live buses select (`transport-live.js:30`), and on the Office buses page the map
follows the header picker. Replace the metro map's Kullu/Mandi segment (`transport-views.js:80`). Overlay applies to:
- HQ tab counts and base heat;
- the live moving / stopped / offline counts;
- the Fleet setup gaps list totals.

Remove the per-page campus lists. Update the existing tests that assert district behaviour, and add filter and overlay
assertions. Commit: `Campus picker: HQ, Fleet setup, live buses and route map`.

### Task 3: Coordinator shared views and Approvals (Sonnet 5.5, medium)

In `coordinator/shared.js`:
- `academicsView` (184);
- `transportView` (400). Overlay the P&L tiles at 389–391;
- `pdrView` (690, 820). Fee, admission and register tables filter too.

In `coordinator/approvals.js`, the "All schools" header select (197).

Each switch keeps its view state and drops its own `CAMPUSES` list. Add tests. Commit:
`Campus picker: academics, transport, Systems and Approvals`.

### Task 4: Hiring, Staff, Payroll and Curriculum (Sonnet 5.5, medium)

- `hiring/index.html:169`. The chips stay on `myCampuses_()` scope, routed through `LMCSCampus.scope`.
- `staff/add-employee.html` school tabs, with `hes:true`.
- `payroll/index.html:316`, with `hes:true`. It is Owner-only; overlay the status stats.
- `curriculum-progress/daily-progress.html:356`. It is already multi-select; swap in the component and map `lmsIdx` to
  codes.
- `cwa-gap-report.html:917` and `unmapped-chapters.html:322`. The Principal lock stays.

Add tests per page. Commit: `Campus picker: hiring, staff, payroll and curriculum`.

### Task 5: Single-school pages and the Owner view (Sonnet 5.5, medium)

- The Office header `#campus-pick` (`office/js/shell.js:114`) becomes the picker with `multi:false, hes:true`. Keep its
  reload and its old key as a fallback read.
- `office/js/accounts.js:234` summary becomes multi, with an overlay of the summary totals.
- The Principals' Daily Reporting school buttons (`multi:false`).
- `owner/transport` gains the picker, with an overlay of its four network numbers.

Add tests. Commit: `Campus picker: Office, Daily Reporting and the Owner transport view`.

### Task 6: Final review (Opus 5.5, medium), one browser round, release

- A whole-branch review. Then one browser round at 375 px and on desktop, using stub sessions: ALL, a comma list, one
  campus, and a Fee Clerk.
- Then build `release/campus-picker` on the latest main, and send the Master Agent the sha and Uday's commands, one per
  step. This is pages only, with no backend change expected.

*Plan written 2026-10-26 from Uday's request via the LMCS Master Agent and the 21-switch inventory.*
