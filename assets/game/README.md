# Game-layer art

Mascot renders loaded by `game.js` (`LMCSGame`). All WebP with alpha, no personal data.

- `buddy/<outfit>-<pose>.webp` - Buddy the owl; outfit: winter-formal, summer-formal, tracksuit-winter, tracksuit-summer, festival; pose: neutral, celebrate, nudge, bad (20 files).
- `buddy/avatar-<outfit>.webp` - 96x96 head-and-tie crop of the outfit's neutral pose (5 files).
- `teacher-owl/teacher-owl-<pose>.webp` - the Teacher Owl; pose: intro, neutral, celebrate, nudge, bad.
- `teacher-owl/avatar-teacher-owl.webp` - 96x96 head crop of the neutral pose.

`game.js` falls back to `buddy/winter-formal-neutral.webp` when a file is missing.

**Pilot placeholders:** these are Canva preview renders (about 149x199 px), converted with `cwebp -q 90`. Replace them with full-size versions (Canva MEDIA ids are in the vault's `work/mascot concepts/buddy set/canva-media-ids.txt` and `teacher owl set/canva-media-ids.txt`) before the February pilot, keeping the same file names. Avatars are re-cropped from the neutral pose (square, top ~45% of the figure, resized to 96 px).

# The floating Buddy (dock)

`buddy-dock.js` + `buddy-dock.css` (`window.LMCSDock`, classes `bd-`): a 44 px Buddy button in the bottom-right corner of every portal page. `assets/auth.js` loads both once someone is signed in (on load for a kept session, after a fresh sign-in otherwise), from its own folder, so no page needs a tag. A page opts out with `window.LMCS_NO_DOCK = true` before auth.js.

- The panel (a dialog; bottom sheet on phones, 360 px card on desktop): **This page** (`LMCSGuide.pages[path].purpose`), **Next for you** (the page's own `LMCSGame.last()`, else one `gametoday` kept 5 minutes in sessionStorage; also the first open `setup:` quest step with its guide link; hidden when there is nothing or the call fails), **Show me how** (only when the page has a `tour`; runs `LMCSGame.tour` with tourId `page-<path>`), and **Search the guide** (title hits first, 5 at most, links to `guide/index.html#<id>`).
- `game.js`, `game.css` and `guide.js` are loaded on the first open when the page doesn't have them. The panel is built with `LMCSGame.ui.h` (text nodes only).
- The button lifts above `.lg-nextbar` and anything matching `LMCSDock.avoid` (a CSS selector list, default `''`; e.g. `LMCSDock.avoid = '.my-toast'`).
- The backend URL lives once, in `buddy-dock.js` (`BACKEND`); `tests/game/test-dock.js` checks it equals every page's `GAME_BACKEND_URL`.
- `guide.js` (`window.LMCSGuide = { pages, articles }`) is the guide's content, also rendered by `guide/index.html`.
- `LMCSGame.tour(beats, { session, backendUrl, tourId, campus, speaker, config? })` is the same spotlight tour as the home tour, on its own. Beats: `{ target: Element | CSS selector | null, text }`.
