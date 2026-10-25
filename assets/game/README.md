# Game-layer art

Mascot renders loaded by `game.js` (`LMCSGame`). All WebP with alpha, no personal data.

- `buddy/<outfit>-<pose>.webp` - Buddy the owl; outfit: winter-formal, summer-formal, tracksuit-winter, tracksuit-summer, festival; pose: neutral, celebrate, nudge, bad (20 files).
- `buddy/avatar-<outfit>.webp` - 96x96 head-and-tie crop of the outfit's neutral pose (5 files).
- `teacher-owl/teacher-owl-<pose>.webp` - the Teacher Owl; pose: intro, neutral, celebrate, nudge, bad.
- `teacher-owl/avatar-teacher-owl.webp` - 96x96 head crop of the neutral pose.

`game.js` falls back to `buddy/winter-formal-neutral.webp` when a file is missing.

**Pilot placeholders:** these are Canva preview renders (about 149x199 px), converted with `cwebp -q 90`. Replace them with full-size versions (Canva MEDIA ids are in the vault's `work/mascot concepts/buddy set/canva-media-ids.txt` and `teacher owl set/canva-media-ids.txt`) before the February pilot, keeping the same file names. Avatars are re-cropped from the neutral pose (square, top ~45% of the figure, resized to 96 px).
