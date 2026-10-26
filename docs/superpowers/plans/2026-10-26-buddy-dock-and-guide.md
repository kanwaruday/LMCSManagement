# Floating Buddy, setup help and the user guide: plan

> For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Lean mode: one review per task.

**Goal:** a small Buddy button on every portal page. Its panel answers: what this page is for, what's next for you,
"Show me how" (a tour of this page) and a guide search. The Owner also gets setup quests ticked off from real data.
One user guide for the game portal, by role, in Buddy's voice.

**Uday's words (2026-10-26):** "can we ensure that the Buddy's tiny icon floats across the portal and could actually
help setup the game? Should we make an entire user guide for the games portal along with the buddy omni present".
Design rule from the same day: setup is gamified. A school owner will set the game up for their school, so
school-specific values stay in Game Config and setup steps become quests.

**Base:** main 00f9c59 + game-module-hooks 014b99e (branch `buddy-dock`).
**Framework contract:** side-session notes, `game-layer-framework-contract.md`. **Voice:** vault
`work/LMS Mascot Voice Guide.md` (9 rules; rule 9: never assume pronouns).

## Global Constraints
- Every portal page loads `assets/auth.js` (39 pages). The dock is injected from there; no per-page edits.
- Text nodes only (no innerHTML-type APIs: tests/game/test-game-js.js bans them for game.js; same rule for the dock).
- 44 px tap targets, visible focus, Esc closes, focus returns to the button, `prefers-reduced-motion` respected.
- Phones (375 px): the button is 44 px, 16 px from the bottom-right corner, lifted above `.lg-nextbar` when it's
  showing. The panel is a bottom sheet on phones (max 70vh, scrolls) and a 360 px corner card on desktop. No
  horizontal page scroll.
- No personal data in the repo. The guide describes features, never people.
- Apps Script: one global scope, uncontrolled load order. Registries use `var X = X || {}`, and other files' symbols
  are used only inside function bodies.
- Cache-busting: `node tools/stamp-assets.mjs` after staging. `node tests/verify.mjs` stays green except the known
  `datasrc/test-datasrc.js`.
- The game backend URL lives in ONE place for the dock: `assets/game/buddy-dock.js`. It's the same value as the
  pages' `GAME_BACKEND_URL`; a test asserts they match.

## Task 1: Floating Buddy (front end)
Files: create `assets/game/buddy-dock.js`, `assets/game/buddy-dock.css`, `assets/game/guide.js` (data skeleton),
`guide/index.html`. Modify `assets/auth.js` (loader, about 3 lines) and `assets/game/game.js` (export a standalone
tour). Tests: `tests/game/test-dock.js`, `tests/game/test-game-js.js`.
- `assets/auth.js`: once a session is resolved (both the cached-session path and a fresh sign-in), call
  `loadDock_()` once. It adds `buddy-dock.css` and `buddy-dock.js` from the same folder as auth.js's own `src`, so
  the relative depth is right on every page. Pages that set `window.LMCS_NO_DOCK = true` before auth.js are
  skipped.
- `assets/game/game.js`: export `LMCSGame.tour(beats, opts)` with opts `{ session, backendUrl, tourId, campus,
  speaker }`. It is the same spotlight UI as the home tour: Next / Skip / Done, a centred beat when a target is
  missing, focus trap, Esc. It posts `gametourseen` with `tourId` when the backend URL is set. Beats are
  `{ target: Element|null, text }`. The home tour and `mount({tour})` use the same code path; don't duplicate it.
  Keep every existing test passing.
- `assets/game/buddy-dock.js` (IIFE, `window.LMCSDock`):
  - The button: Buddy's avatar for today's outfit (`LMCSGame.art`), with label "Buddy: help". game.js and game.css
    are lazy-loaded on first open if the page doesn't have them yet.
  - The panel (role dialog, labelled "Buddy") has 4 parts:
    1. "This page", from `LMCSGuide.pages[path]`.purpose. Path is the page's path relative to the portal root, e.g.
       `coordinator/transport/setup.html` or `index.html`. Unknown page: "This is part of the LMCS portal."
    2. "Next for you": on open, one `gametoday` fetch, cached in sessionStorage for 5 minutes. It shows `next`
       (title + Go via `LMCSGame.safeHref`). If the response has setup quests (`questId` starting `setup:`), it also
       shows the first open setup step, with its guide link. If notYet, there's no backend URL or the fetch fails,
       this part is hidden. Never an error box.
    3. "Show me how", shown only when `LMCSGuide.pages[path].tour` exists: runs `LMCSGame.tour` with tourId
       `page-<path with / and . replaced by ->`.
    4. "Search the guide": a text input filtering `LMCSGuide.articles` by title and body, case-insensitive, at most
       5 results. Each result links to `guide/index.html#<id>` (root-relative from the page). A
       "Open the user guide" link sits below.
  - Lifts above `.lg-nextbar` (watches its height) and above any element matching `LMCSDock.avoid`, a CSS selector
    list, default `''`. The Coordinator chat may add its toast selector there.
- `assets/game/guide.js` (`window.LMCSGuide = { pages: {}, articles: [] }`): Task 3 fills it. Ship it with 2 sample
  entries for the tests.
- `guide/index.html`: a standalone guide page. It loads auth.js (so the dock shows here too), `assets/game/guide.js`
  and renders: role filter chips (All, Owner, Principal, Coordinator, Teacher, Fee Clerk, Staff), a search box, and
  articles as `<section id="<id>">` with h2 + paragraphs. A hash scrolls to and focuses that article. Mobile-first,
  using the portal's red header style (copy the tokens from `principal/index.html`).
- Tests (`tests/game/test-dock.js`, DOM-free source checks plus pure functions exported for tests):
  - the path normaliser (`/LMCSManagement/coordinator/x.html` → `coordinator/x.html`, `/LMCSManagement/` →
    `index.html`);
  - search ranking (a title hit before a body hit, max 5);
  - tourId from path;
  - no innerHTML-type APIs in buddy-dock.js or guide/index.html's script;
  - the dock's backend URL equals every page's `GAME_BACKEND_URL`;
  - auth.js loads the dock exactly once.

## Task 2: Owner setup quests (backend) + guide links on quest steps
Files: create `apps-script/game-setup.gs` (add it to projects.json `game.files`). Modify `assets/game/game.js`
(quest step `guide` link). Tests: `tests/game/test-setup.js`.
- `GAME_MODULE_QUESTS.Owner = [].concat(GAME_MODULE_QUESTS.Owner || [], setupQuests_)`. One sequential quest:
  questId `setup:game`, title "Set up the game", with these steps, each `{ id, title, done, locked: false, go: '',
  guide: '<article id>' }` and done from real data:
  1. `signin`: "Switch on staff sign-in". Done when Script property `STAFF_AUTO_SIGNIN` is `on`.
  2. `secret`: "Set the overnight check's secret". Done when `GAME_PUSH_SECRET` is non-empty.
  3. `refresh`: "Keep the teacher index fresh (30-minute trigger)". Done when CacheService `tch_meta.builtAt` is
     within the last 2 hours.
  4. `form`: "Add the classwork and homework form link". Done when `cfg.teacher.cwhwFormUrl` is set.
  5. `term`: "Set this term's end date". Done when `cfg.teacher.quests.termEnd` matches `YYYY-MM-DD`.
  6. `suit`: "Open the track-suit decision". Done when the `trackSuit` window has Opens and Closes set.

  Cheap reads only, because it runs under the script lock. No step for things that can't be checked from data.
- Front end (game.js): a quest step with `guide` and no usable `go` renders its title as a link to
  `guide/index.html#<guide>` (root-relative), with the same next-action rules as other steps. Tests in
  test-game-js.js.
- Tests (`tests/game/test-setup.js`, vm context with stubbed PropertiesService, CacheService and sheet rows): each
  step flips on its data; the quest is complete only when all 6 are done; steps carry their `guide` ids; the
  registry is an array with other modules preserved.

## Task 3: The user guide content
Files: `assets/game/guide.js` (fill it in). Inputs: `page-facts.json` (LM Studio's per-page facts; the path is given
in the dispatch), the voice guide, the framework contract, and the live features listed in the dispatch.
- `pages`: an entry for each of the 39 pages: `{ purpose, roles, tour? }`. Purpose is one plain sentence. Tours
  (3–5 beats, with real element ids from the page) for the pages people use daily: the 4 homes, Fleet setup, the
  teacher plan page, the Day Book, and the office home.
- `articles` (ids kebab-case): a "Meet Buddy" intro; for each role (Owner, Principal, Coordinator, Teacher, Fee Clerk,
  Staff) "Your Today list", "Quests" and "Days on track" as they apply; "Decisions" (track-suit days); "Fleet setup";
  "Day Book starting data" (when live, otherwise left out); and one article per Owner setup step (ids matching
  Task 2's `guide` values: `setup-signin`, `setup-secret`, `setup-refresh`, `setup-form`, `setup-term`,
  `setup-suit`), each saying exactly what to click.
- Only features that are live on main. Buddy's voice: short, warm, plain, "we" for the school, never guilt, no
  exclamation pile-ups.
- Test: every page path exists in the repo; every tour target id exists in its page; every setup `guide` id has an
  article; no article mentions a person's name (a list of real staff names isn't available, so check for honorific
  patterns: Sir, Ma'am, Mr, Mrs, Dr).

## Release
Merge into a release branch from the latest main, stamp, verify, one browser round (375 px + desktop: a home page, a
non-game page, the guide page), push. Then send the master the sha and Uday's commands, one per step:
push-by-ref to main, `deploy.mjs game --push --deploy`.
