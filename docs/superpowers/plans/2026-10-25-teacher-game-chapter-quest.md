# Teacher game: chapter quest at all six schools (T0 + T1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every teacher at LMS 1–6 signs in to the Teacher Portal and sees one chapter quest per class-subject they
teach: plan the activity → teach → run the activity → take the CWA → remediate. Today's missions sit beside the
quests: the daily CW/HW log card, remediation due, activity plan due and CWA due. Done is detected from real data.
Target: live in late November 2026 (Uday: "right away, at each school").

**Architecture:**
- **One module file, `apps-script/game-teacher.gs`, in the framework's LMCS Game Backend.** It registers
  `GAME_MODULE_MISSIONS.Teacher`, `GAME_MODULE_QUESTS.Teacher` and its actions in `GAME_MODULE_ACTIONS`. The
  framework does the picking, roll-over, display, days on track and the UI.
- **Chapter episodes come from the shared engine `apps-script/acad-episodes.gs`,** also used by the Owner backend
  (Owner B plan, Task 2).
- **A 30-minute trigger builds a per-teacher index** from the public CW/HW feed (~15 MB, with the course map in
  `cmData`), the Chapter Tracker sheet, the Employee Master and the timetable. It caches one small JSON per
  EmployeeCode, so a teacher's request never fetches the feed.
- **Planned activities live in a game-workbook tab.** The Mac's 2-hourly AI Coordinator run asks LM Studio, once a
  night, whether a chapter's CW entries describe the planned activity, and pushes the answers back with a shared
  secret.

**Tech Stack:** Apps Script V8, static HTML/JS (no framework, no build), Node `vm` tests run by `tests/verify.mjs`,
Python 3 on the Mac (LM Studio at `localhost:1235` via lm-monitor, falling back to `:1234`), clasp via
`apps-script/deploy.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-25-teacher-portal-game-design.md` (approved by Uday, 2026-10-25). It is a
module of `docs/superpowers/specs/2026-10-25-portal-game-layer-mascot-design.md`, whose Phase 1 plan
(`docs/superpowers/plans/2026-10-25-portal-game-layer-phase-1.md`, branch `portal-game-layer-design`) owns
`game.gs`, the Mission and QuestState shapes, `gameVerifyCaller_`, `gameDayKey_`, `Game Config`, the mount on
`teacher/index.html` and the Teacher Owl art. Read both specs' "Settled" sections first.

**Out of scope here (later plans):** today's line, the timetable moving behind the backend, the conditions panel,
the Principal setup quest (T2), team goals, the activity bank and help credit (T3), ERP marks (T4), private standing
(T5), and **teacher leave in Approvals**, which is owned by the Approvals chat and is a dependency only.

## Changes from the spec (record in the spec's "Settled after the builder check" in Task 4)

1. **The daily log without a timetable is one item ("log today's classes"), not every class-subject the teacher
   teaches.** A class isn't taught every day, so counting all of them would invent work.
2. **Plan step 1 is done whenever a plan exists for the chapter,** not only before its first entry, so chapters
   already under way at launch can still complete.

## Depends on (block the task named)

- **Uday's Q8 (teacher sign-in), answered 2026-10-25: "Automatic from Employee Master".** It grants the Teacher role
  only, to Active employees in the Teaching department whose EmpPersonal.AuthEmail matches their verified Google
  sign-in. Each part is off behind a flag. This plan owns the `auth.js` and PDR parts (Task 1); the game director adds
  the game backend part. Production deploys and switching the flag on are Uday's.
- **The framework Phase 1 code, its Tasks 1–3 at least:** `game.gs` registries, `gameVerifyCaller_`, Mission
  `progress`, and `gamePick_` / days on track. Tasks 3–5 here consume them. Task 8 needs its Tasks 6–10 (the
  `gametoday` response and the mount on `teacher/index.html`).
- **The Owner B plan's Task 2 (`acad-episodes.gs`).** If it isn't on `main` when Task 2 starts, Task 2 here builds
  the file to that plan's interface, and the Owner chat reuses it.

## Global Constraints

- **Remediation counts only on the same chapter as its CWA** (Uday: "remediations need to get matched to the
  chapters"): the same lmsIdx, class, subject, teacher and normalised chapter, within `teacher.remediationDays` = 14
  days after the CWA.
- **Entries with 7 or more tags are proof of nothing** (`teacher.tagInflationThreshold` = 7; the engine's
  `maxEntryTags` = 6). They still count as "logged" for the daily log.
- **Baseline to reproduce exactly:** 25 Oct 2026 feed snapshot, 60 of 1,793 CWA entries remediated on the same
  chapter within 14 days. Units are CWA entries, all classes, with 7+-tag entries dropped and teacher names
  compared lowercased and trimmed. This is *entries*, not episodes; the episode-level rate is reported beside it.
- **Activities:** plan, then confirm (Uday). Step 1 is done when a planned activity exists for the chapter. Claude's
  call, relaxing the spec's "before the first entry", so chapters already under way at launch can still complete.
  Step 3 is done when the nightly LM Studio match says an entry on that chapter describes the plan.
- **Teams, help credit, the activity bank and standing are not in this plan.**
- **Config lives under `teacher.*` in `Game Config`, never as constants in logic:**
  - `teacher.remediationDays` 14
  - `teacher.tagInflationThreshold` 7
  - `teacher.planLeadDays` 7
  - `teacher.remediationShowDays` 21
  - `teacher.examKeywords` `["exam","examination","test week","pt-"]`
  - `teacher.core` `["cwhw_log"]`
  - `teacher.cap` 3
  - `teacher.matchMinConfidence` 0.7
  - `teacher.quests` (Quest 1 and Quest 2 steps, as below)
- **Children never appear.** CW descriptions sent to LM Studio carry no student data (they are class notes). Nothing
  personal goes in the repo: the feed snapshot and any fixture with real names stay in a gitignored folder
  (`tools/private/`).
- **Copy follows the vault's `work/LMS Mascot Voice Guide.md`.** The speaker is the Teacher Owl. No guilt, no
  countdowns, dates instead of timers, no assumed pronouns. Lines are drafted here; the game director checks the
  voice.
- **Never touch the live PDR project except in Task 1.** Task 1 changes `main.gs` only behind a feature flag (Script
  property `TEACHER_AUTO_SIGNIN` = `on`), and nothing deploys without Uday's go-ahead.
- **Before every commit, run `node tests/verify.mjs`.** After staging HTML, run `node tools/stamp-assets.mjs`.

## Review Focus

1. **A teacher whose typed CW/HW name doesn't resolve to their code.** Expected: their quests and log card are
   empty. They never get missions about someone else, and they see one plain line: "Your entries aren't linked to
   you yet; your Principal can fix this." The unmatched name appears in the Task 3 audit. Test in Task 3.
2. **The 7+-tag rule and the 14-day edge.** A Remediation on the same chapter on day 14 counts; on day 15 it doesn't.
   One on the next chapter doesn't, and neither does one with 7 tags. Test in Task 2.
3. **A day with no scheduled work.** A Sunday, the 2nd Saturday, a GH holiday or an exam-keyword day gives no
   `cwhw_log` mission at all; it isn't a zero. Test in Task 4.
4. **The feed fetch fails or shrinks.** If `cwRecords` drops more than 30% against the last build, or the fetch
   errors, the previous index stays, and the teacher sees the last good state with its "as of" time. Test in Task 3.
5. **LM Studio is down or the Mac is asleep.** Step 3 shows "checking overnight", never "not done", while a planned
   activity has candidate entries but no answer yet. A push with a wrong secret or malformed rows changes nothing.
   Tests in Task 7.

---

### Task 1: Teacher sign-in from the Employee Master (Uday, Q8: "Automatic from Employee Master")

**Files:**
- Modify: `assets/auth.js`: after the allowlist lookup misses, call `TEACHER_SIGNIN_URL` (the PDR exec URL,
  `?action=teachersignin&idToken=…`). On `{success:true, role:'Teacher', campusId, employeeCode}`, create the
  session with that role.
- Modify: `apps-script/main.gs`: in the caller verification (`main.gs:290-320`), when the email isn't allowlisted
  and Script property `TEACHER_AUTO_SIGNIN` is `on`, map the email through EmpPersonal `AuthEmail` (reuse
  `tpAuthEmailToCode_`) to a code that is Active in EmpMaster with `EmpSalary.Department = Teaching`. The caller then
  becomes `{email, campusId: from the code prefix, roles:['Teacher'], employeeCode}`. Add the GET action
  `teachersignin`, which returns just that.
- **Not here: `apps-script/game.gs`.** The game director adds `var GAME_CALLER_FALLBACKS = GAME_CALLER_FALLBACKS || {}`
  itself once Uday says yes to Q8 (agreed 2026-10-25). `gameVerifyCaller_` calls `GAME_CALLER_FALLBACKS.Teacher` only
  after the token is verified (aud, email_verified) and the allowlist misses. It passes the verified email, and the
  fallback must return exactly role Teacher, the campus from the Employee Master, `canDecide:false` and
  `employeeCode`, never another role. `game-teacher.gs` registers it in Task 3.
- Test: `tests/teacher-portal/test-teacher-signin.js`

**Interfaces:**
- Produces: `pdrTeacherFromEmployeeMaster_(email) -> {email, campusId, roles:['Teacher'], employeeCode} | null` in
  `main.gs`; `GAME_CALLER_FALLBACKS` (`var` guard, like `GAME_MODULE_ACTIONS`) in `game.gs`.
- Prefix → campus: `KUL` LMS1, `KEL` LMS2, `DUN` LMS3, `NCM` LMS4, `SAY` LMS5, `JOG` LMS6. `HES` gives null (no
  teacher campus).

- [ ] **Step 1: Write the test** (vm-load `main.gs` and `teacher-portal.gs` with fake SpreadsheetApp tabs EmpPersonal,
  EmpMaster and EmpSalary). Assert:
  - an allowlisted Principal is unchanged;
  - an unlisted email with an Active Teaching code `NCM/24/04/073` → `{campusId:'LMS4', roles:['Teacher'], employeeCode:'NCM/24/04/073'}`;
  - an Inactive code → null; Department `AdminClerk` → null; an `HES/…` code → null;
  - `TEACHER_AUTO_SIGNIN` unset → null;
  - an email in mixed case matches.
- [ ] **Step 2: Run** `node tests/teacher-portal/test-teacher-signin.js`. Expected: FAIL (not defined).
- [ ] **Step 3: Implement** the `main.gs` and `auth.js` changes. A Teacher caller made this way gets exactly the
  existing `PDR_TEACHER_GET_ACTIONS` and `PDR_TEACHER_POST_ACTIONS`, and nothing else.
- [ ] **Step 4: Run** the test, then `node tests/verify.mjs`. Expected: PASS. `node tests/teacher-portal/test-view-as.js`
  still passes.
- [ ] **Step 5: Commit:** `git commit -m "Teacher sign-in from the Employee Master (flagged off until Uday turns it on)"`.

### Task 2: Shared episode engine and the baseline

**Files:**
- Create (or reuse unchanged if the Owner B chat has merged it): `apps-script/acad-episodes.gs`
- Create: `tests/game/test-acad-episodes.js`, `tests/game/fixtures/teacher-feed.json` (synthetic: teachers "T One",
  "T Two"; no real names)
- Create: `tools/teacher-baseline.js` (prints the baseline from a downloaded feed; not part of verify)
- Modify: `.gitignore` (add `tools/private/`), `apps-script/projects.json` (`"shared": ["acad-episodes"]`; list it
  in `game.files`), `apps-script/deploy.mjs` (`--check` accepts a file listed in `shared` in more than one project),
  exactly as the Owner B plan's Task 2 "Shared-file deploy" step says.

**Interfaces:**
- Produces, exactly as the Owner B plan (Task 2, Interfaces):
  - `ownAcadNormChapter_(s)`;
  - `ownAcadTags_(cwTag) -> string[]`;
  - `ownAcadEpisodes_(records, rules) -> episode[]`, where an episode is
    `{key:{g,cls,subj,ch,lms,teacher}, periods, tags, hw, first, last, cwa, seq, postCwa, remediationWithin}`;
  - `ownAcadNoCwa_`.
- Adds: `acadRemediatedCwaEntries_(records, rules) -> {cwas: number, remediated: number}`. This is the entry-level
  count behind the baseline, with no episode filters.
- `rules` here = `{remWindowDays: 14, maxEntryTags: 6, minEpisodePeriods: 3}`, read by the caller from config.

- [ ] **Step 1: Write the test** on the synthetic fixture:
  - a CWA on day 0 + a Remediation on the same chapter on day 14 → remediated;
  - day 15 → not; the next chapter on day 3 → not; another teacher, same chapter → not;
  - a Remediation with 7 tags → not; a CWA with 7 tags isn't counted as a CWA;
  - an episode is cut at the first CWA;
  - M-I, `general knowledge` and episodes under 3 periods are excluded from episodes, but not from
    `acadRemediatedCwaEntries_`.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement** (or confirm the merged file passes unchanged; if it fails, fix it with the Owner chat,
  never fork it).
- [ ] **Step 4: Baseline gate.**
  1. Download the feed: `curl -sL "$TP_CWHW_PROXY_URL" -o tools/private/feed-<date>.json`.
  2. Run `node tools/teacher-baseline.js tools/private/feed-<date>.json`.
  3. On the 25 Oct 2026 snapshot (Uday's scratch copy, if kept) it must print `60 / 1793`. On a newer feed, record
     the number in the commit message and check it is in the same range (2–6%).
  4. It also prints the episode-level same-chapter rate.
- [ ] **Step 5: Run** `node tests/verify.mjs`. Expected: PASS. Commit: `git commit -m "Shared episode engine: same-chapter remediation, baseline tool"`.

### Task 3: Teacher index (the 30-minute build)

**Files:**
- Create: `apps-script/game-teacher.gs` (starts with the three `var` guard lines plus `GAME_CALLER_FALLBACKS`)
- Test: `tests/game/test-teacher-index.js`

**Interfaces:**
- Consumes: `ownAcadEpisodes_`, `ownAcadTags_`, `ownAcadNormChapter_` (Task 2); `gameParseConfig_` (framework).
- Produces:
  - `tchResolve_(name, rosterByCampus, lmsIdx) -> code|null`: the `tpNormalizeName_` rule copied, with a comment
    to keep it in sync with `teacher-portal.gs`.
  - `tchBuildIndex_(feed, roster, trackerRows, timetable, prevMeta, cfg) -> {byCode:{code: TeacherState}, meta:{builtAt, records, unmatched:{lmsIdx:[name…]}}} | {keepPrevious:true, reason}`
  - **TeacherState:**
    ```
    { code, campus,
      classSubjects:[{cls, subj}],
      episodes:[{cls, subj, ch, first, last, cwaAt|null, cwaFrom:'tag'|'tracker'|null,
                 remediatedAt|null, plannedCwaDate|null}],
      loggedDays:{'YYYY-MM-DD':[{cls, subj, at}]},
      periodsByDay:{Mon:[{cls, subj}], …}|null,
      nextChapters:[{cls, subj, ch, startDate}] }
    ```
    - `classSubjects` comes from EmpAcademic rows for the code.
    - `periodsByDay` comes from `timetable.json`, with labels normalised by a `tchLabel_` that maps e.g. `MATH` →
      `Math` and `Class 7` → the feed's `classMapped`. It is null when the teacher has no timetable.
    - `plannedCwaDate` and `nextChapters` come from `cmData`.
    - `cwaFrom` is `'tracker'` when only the Chapter Tracker's Actual CWA Date (or a "mark as taken" override) shows
      the CWA.
  - `gameTeacherRefresh()` (trigger, every 30 min, under the script lock):
    1. fetches the feed (`TP_CWHW_PROXY_URL` value), the roster proxy (`?action=employees` and `?action=roster`
       rows), the Tracker AY tab and `https://kanwaruday.github.io/LMCSManagement/teacher/data/timetable.json`;
    2. builds the index;
    3. writes each TeacherState to `CacheService` as `tch_<code>` (TTL 6 h) and the meta as `tch_meta`.
  - `tchStateFor_(code) -> TeacherState|null`: the cache. On a miss it runs `gameTeacherRefresh()` once under the
    lock.
  - `GAME_CALLER_FALLBACKS.Teacher = function (verifiedEmail) -> {campusId, employeeCode} | null`: the Task 1 rule
    (an Active Teaching code from the Employee Master), so the game backend accepts the same teachers as PDR.
    `game.gs` (the game director's) calls it only when Game Config `teacherAutoSignIn` is true, the token is verified
    and the allowlist misses. `game.gs` itself forces `roles:['Teacher']`, `canDecide:false` and the email, and it
    rejects any campus outside LMS1–LMS6.
  - The action `teacherindexaudit` (Owner only) returns `meta.unmatched` counts per campus. This is the input for
    T2's Principal setup quest.

- [ ] **Step 1: Write the test** with the synthetic feed and roster:
  - "T One maam" resolves to T One's code; "T Three" (not on the roster) lands in `unmatched[lmsIdx]` and in no
    TeacherState;
  - `loggedDays` counts a 7-tag entry as logged;
  - `periodsByDay` is null for a teacher missing from the timetable;
  - `MATH`/`Class 7` labels line up with the feed's;
  - a Tracker-only CWA gives `cwaFrom:'tracker'`;
  - `keepPrevious` when records fall from 1,000 to 600;
  - the fallback returns `{campusId:'LMS4', employeeCode:'NCM/…'}` for an NCM Teaching code, and null for an
    inactive, non-Teaching or HES code.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement** `game-teacher.gs` (index part). Add `game-teacher` to `projects.json` `game.files`.
- [ ] **Step 4: Real-data check.** Run `node tools/teacher-baseline.js --index tools/private/feed-<date>.json` (add
  this mode in this task). It prints: the share of feed entries resolved to a code per campus, the share of
  timetable rows whose labels match a feed class-subject, and the TeacherState size p95. Expected: resolution
  ≥ 85% per campus, label match ≥ 90%, p95 state < 90 KB (one `CacheService` value is 100 KB max). Record the numbers
  in the commit message. If resolution is under 85% somewhere, list the campus for the Principal setup quest; don't
  guess names.
- [ ] **Step 5: Run** `node tests/verify.mjs`. Expected: PASS. Commit: `git commit -m "Teacher game: per-teacher index from the CW/HW feed, tracker, roster, timetable"`.

### Task 4: Teacher missions

**Files:**
- Modify: `apps-script/game-teacher.gs`
- Test: `tests/game/test-teacher-missions.js`

**Interfaces:**
- Consumes: TeacherState (Task 3); Mission shape `{id, kind, title, why, owner, campus, go, due, core, shared, done, doneAt, doneBy, rolledOver, gone, progress?}` (framework Task 2).
- Produces:
  - `tchWorkingDay_(campus, dayKey, calendarEvents, cfg) -> boolean`: Mon–Sat, not the 2nd Saturday, no event
    title starting `GH`, and no event title containing any `teacher.examKeywords` (case-insensitive).
  - `tchMissions_(state, dayKey, isWorkingDay, plans, cfg, now) -> Mission[]`, then
    `GAME_MODULE_MISSIONS.Teacher = function (caller, cfg, now)`, which wires the state, calendar (6 h cache per
    campus) and `tchPlansFor_(code)`.
  - **Shared shapes, defined here and filled by later tasks:**
    - `plans` = `{"<cls>|<subj>|<chNorm>": {activity, plannedAt}}` (Task 6);
    - `matches` = `{"<cls>|<subj>|<chNorm>": {matched, confidence} | {pending:true}}` (Task 7).

    Until those tasks land, `tchPlansFor_` and `tchMatchesFor_` are stubs returning `{}` in `game-teacher.gs`.
- **Mission kinds** (`id` = `teacher:<kind>:<code>:<key>`):

  | Kind | Pending when | Done when | due | go |
  |---|---|---|---|---|
  | `cwhw_log` (core) | a working day. `progress.total` = today's timetabled class-subjects (`periodsByDay[Mon..Sat]`), or **1** when there is no timetable ("log today's classes": the honest fallback, never invented per-class work) | `progress.done` = those class-subjects with an entry dated today (without a timetable: ≥ 1 entry). `doneAt` = the entry completing it | today | the CW/HW form URL (as in `teacher/index.html` quick links) |
  | `remediation_due` | an episode with `cwaAt` and no `remediatedAt`, and today ≤ `cwaAt` + `remediationDays` | `remediatedAt` set | `cwaAt` + 14 d | the form, pre-filled with class, subject, chapter and the Remediation tag where the form supports `entry.*` pre-fill; else the form, with the chapter named in `why` |
  | `activity_plan_due` | a `nextChapters` item whose `startDate` ≤ today + `planLeadDays`, with no plan for it | a plan exists | `startDate` | `teacher/plan-activity.html?cls=&subj=&ch=` (Task 6) |
  | `cwa_due` | an episode with `plannedCwaDate` < today and no `cwaAt` | `cwaAt` set | `plannedCwaDate` | the form |

  - A `remediation_due` past the window becomes `gone:true` until `remediationShowDays`, then disappears. It's
    shown as "closed without remediation" on the quest, never as a mission.
  - Titles, in the Teacher Owl's voice (draft for the game director):
    - `cwhw_log`: "Log today's classwork and homework ({done} of {total} classes)"
    - `remediation_due`: "Remediate {ch} in {cls} {subj}: name this chapter so it counts"
    - `activity_plan_due`: "Plan an activity for {ch} ({cls} {subj}), which starts {date}"
    - `cwa_due`: "The CWA for {ch} ({cls} {subj}) was planned for {date}"

- [ ] **Step 1: Write the test:**
  - a Sunday → no `cwhw_log`;
  - a calendar event "Half-Yearly Examination" → no `cwhw_log`;
  - with a timetable of 4 class-subjects on Mon and entries for 2 → `progress {done:2,total:4}`, `done:false`;
  - no timetable and 1 entry → `{done:1,total:1}`, `done:true`;
  - a CWA on 1 Nov, today 10 Nov → `remediation_due` with due 15 Nov; on 16 Nov → `gone:true`; on 23 Nov → absent;
  - remediated on the same chapter → `done:true`, with `doneAt` = that entry;
  - a next chapter starting in 5 days with no plan → `activity_plan_due`; in 9 days → none;
  - `plannedCwaDate` passed → `cwa_due`;
  - a caller with no TeacherState → `[]`.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement** it.
- [ ] **Step 4: Run** it, then `node tests/verify.mjs`. Expected: PASS.
- [ ] **Step 5: Record the two "Changes from the spec"** in the spec's "Settled after the builder check" (points 7
  and 8). Run `node tests/verify.mjs`, then commit: `git commit -m "Teacher game: missions (daily log card, remediation, activity plan, CWA due)"`.

### Task 5: Chapter quests, Quest 1 and Quest 2

**Files:**
- Modify: `apps-script/game-teacher.gs`
- Test: `tests/game/test-teacher-quests.js`

**Interfaces:**
- Consumes: TeacherState, plans, matches; QuestState `{questId, title, steps:[{id, title, go, done, locked}], complete}` (framework Task 5).
- Produces:
  - `tchChapterQuests_(state, plans, matches, cfg, now) -> QuestState[]`: one per class-subject, for its **current
    chapter** (the episode with the latest entry). `questId` = `chapter:<code>:<cls>:<subj>:<ch>`, and the title is
    "{cls} {subj} · {ch}".
    - **Steps:**
      1. `plan` "Plan the activity": a plan exists;
      2. `teach` "Teach": the episode exists;
      3. `activity` "Run the activity": `matches[key]` is `{matched:true}` with `confidence ≥ matchMinConfidence`.
         `{pending:true}` → title suffix "· checking overnight", `done:false`;
      4. `cwa` "Take the CWA": `cwaAt`;
      5. `remediate` "Remediate (same chapter, within 14 days)": `remediatedAt`.
    - `locked` is always false (every step is real work). `complete` = all 5 done. A window passed without
      remediation → step 5 title "Closed without remediation", `done:false`, and `complete:false`; the quest stays
      until the next chapter starts.
    - Montessori classes (M-I to M-III): steps 1–3 only.
  - `tchSetupQuests_(state, plans, daysOnTrack, cfg) -> QuestState[]`, from `teacher.quests` config (season 0
    defaults):
    - **Quest 1 "Your portal":** `cw_today` "Log today's classwork"; `hw_today` "Log today's homework" (an entry with
      an HW description); `plan_one` "Plan the activity for your next chapter"; `days_5` "Five days on track".
    - **Quest 2 "Plan your term's activities"**, one per class-subject, unlocked after Quest 1: every `nextChapters`
      item of that class-subject in the current term has a plan.
    - Steps are sticky through `Game Progress` `quest_step` rows (the framework).
  - `GAME_MODULE_QUESTS.Teacher = function (caller, cfg, now)` returns the setup quests first, then the chapter
    quests.

- [ ] **Step 1: Write the test:**
  - a chapter taught with a CWA and a same-chapter remediation, but no plan → steps 2, 4 and 5 done, step 1 not;
  - a plan plus a match of 0.9 → step 3 done; 0.5 → not;
  - a plan with entries and no match row → "checking overnight", not done;
  - an M-II class → 3 steps;
  - all done → `complete:true`;
  - Quest 2 stays locked until Quest 1 is complete;
  - a step done yesterday stays done today (sticky).
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement** it.
- [ ] **Step 4: Run** it, then `node tests/verify.mjs`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "Teacher game: chapter quest per class-subject, Quest 1 and 2"`.

### Task 6: Planned activities (write path and page)

**Files:**
- Modify: `apps-script/game-teacher.gs` (tab `Teacher Planned Activities`: `Code, Campus, Class, Subject, ChapterNorm, Chapter, Activity, PlannedAt, UpdatedAt`)
- Create: `teacher/plan-activity.html` (one card: the chapter named, one text input, max 200 characters, **Save**,
  and a back link to `teacher/index.html`)
- Modify: `tools/stamp-assets.mjs` (add the page)
- Test: `tests/game/test-teacher-plans.js`

**Interfaces:**
- Produces:
  - `POST action=teacherplanactivity {idToken, cls, subj, ch, activity}` → `{success}` or `{success:false, error}`.
    It upserts per (Code, Class, Subject, ChapterNorm) under the script lock.
  - `GET action=teacherplans` → the caller's rows.
  - `tchPlansFor_(code)` replaces the Task 4 stub. It returns the `plans` shape, cached 10 min and busted on write.
- **Rules:** the class-subject must be in the caller's `classSubjects`, otherwise "That class isn't on your list.".
  The activity is trimmed and 3–200 characters, otherwise "Write the activity in a few words.". Only the teacher
  may write their own plan; Owner test mode is read-only.

- [ ] **Step 1: Write the test:** upsert twice → one row with `UpdatedAt` changed; a class-subject not taught → the
  error; a 1-character activity → the error; another teacher's code can't be written; `tchPlansFor_` sees the write
  at once.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement** the actions and the page. The page uses `auth.js` `requireSession`, posts with the
  session's `idToken`, and follows LMCS tokens (`assets/style.css`); it works at 375 px.
- [ ] **Step 4: Run** the test, stage the page, run `node tools/stamp-assets.mjs`, then `node tests/verify.mjs`.
  Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "Teacher game: plan an activity per chapter"`.

### Task 7: Overnight activity check (Mac + backend)

**Files:**
- Modify: `apps-script/game-teacher.gs` (tab `Teacher Activity Matches`: `PlanKey, EntryTimeMs, Matched, Confidence, Reason, CheckedAt`)
- Create: `tools/teacher_activity_match.py`
- Modify: `ai-coordinator/run.sh` (call it once a night: when the hour is ≥ 21 IST and `tools/private/.activity_match_day` ≠ today)
- Test: `tests/game/test-teacher-matches.js`, `tools/test_teacher_activity_match.py` (assert-based, runnable
  directly)

**Interfaces:**
- Backend (secret-gated like `coordTransportPush_`; Script property `GAME_PUSH_SECRET`; the Mac keeps
  `~/.lmcs/game_push_secret`):
  - `POST action=teachermatchpull {secret}` → `{items:[{planKey, activity, entries:[{timeMs, desc}]}]}`. These are
    plans whose chapter has CW entries newer than the last check for that plan, at most 400 items. The descriptions
    come from the feed's `cwDesc`. No names or codes are sent; `planKey` is an opaque hash of
    (Code, Class, Subject, ChapterNorm).
  - `POST action=teachermatchpush {secret, results:[{planKey, timeMs, matched, confidence, reason}]}` appends the
    rows. It rejects unknown planKeys, confidence outside 0–1, and more than 2,000 rows.
  - `tchMatchesFor_(code)` replaces the Task 4 stub. It returns the `matches` shape: the best result per plan, or
    `{pending:true}` when the plan has entries newer than its last check.
- **Mac script:** pull, then for each entry ask LM Studio via the `drive-index/lmstudio_summarize.py` `call()`
  pattern (proxy `:1235`, fallback `:1234`, model `qwen3-vl-30b-a3b-instruct`, `temperature` 0.2, `max_tokens` 80).
  The prompt ends with ` /no_think`:

  > Planned classroom activity: "{activity}". Teacher's note of what happened in class: "{desc}". Does the note
  > describe doing this activity (or clearly the same activity in other words)? Answer as JSON
  > {"matched": true|false, "confidence": 0..1, "reason": "<10 words"}.

  Unparseable answers are skipped, not guessed. Then push, and log the token use as that file does. `--dry-run`
  prints instead of pushing.

- [ ] **Step 1: Write the tests:**
  - backend: a wrong secret → "Not authorized" and nothing written; an unknown planKey → rejected; pull leaves out
    plans already checked for the same entries;
  - `tchMatchesFor_` keeps the best confidence;
  - Python (`LMSTUDIO` call stubbed): a malformed JSON answer is skipped, a valid one is pushed, and `--dry-run`
    sends nothing.
- [ ] **Step 2: Run** both. Expected: FAIL.
- [ ] **Step 3: Implement** them.
- [ ] **Step 4: Spot-check on real data.** Run `python3 tools/teacher_activity_match.py --dry-run --sample 30` against
  the live pull once a few plans exist (or 30 hand-made plan/description pairs from real Activity-tagged entries if
  none exist yet). Check by hand that ≥ 80% of the verdicts are right. Tune the prompt, not the threshold, first.
  Record the result in the commit message.
- [ ] **Step 5: Run** `node tests/verify.mjs`, then commit: `git commit -m "Teacher game: overnight LM Studio activity check"`.

### Task 8: Teacher home end to end, then review

**Files:**
- Modify: `tests/game/ui-stub.html` fixtures (framework file; add a teacher `gametoday` fixture: one `cwhw_log` with
  `progress {2,4}`, a `remediation_due`, Quest 1, and 3 chapter quests including one "checking overnight" and one
  M-II)
- Modify: `teacher/index.html` only if the framework's mount (its Task 10) needs a teacher-specific tweak. Tell the
  game director instead of forking `game.js`.

- [ ] **Step 1:** Serve the stub (`python3 -m http.server` from the repo root) and open it in the browser pane at
  375×812 and at desktop. Expected:
  - the class cards read as one card per class-subject;
  - the daily log card shows "2 of 4 classes";
  - "checking overnight" reads as waiting, not failed;
  - no horizontal scroll;
  - keyboard only works.
- [ ] **Step 2: UI/UX review, up to 3 rounds** with `impeccable-for-lmcs` and `taste-for-lmcs`, with screenshots
  each round. Send copy fixes to the game director for the voice check.
- [ ] **Step 3: Signed-in check on the branch deployment.** As Owner, use "view as" for one teacher per campus.
  Expected: quests match that teacher's real chapters, and an unmatched teacher shows the Review Focus 1 line.
- [ ] **Step 4:** Run `node tests/verify.mjs`, then commit.

### Task 9: Deploy (needs Uday)

- [ ] **Step 1:** `node apps-script/deploy.mjs game --push --deploy "Teacher T1"` (the game backend; the
  `acad-episodes` and `game-teacher` files go with it). Install the `gameTeacherRefresh` 30-min trigger, and set
  `GAME_PUSH_SECRET` (generate it, store it in `~/.lmcs/game_push_secret`, never print it). The teacher sign-in flags
  stay off: PDR Script property `TEACHER_AUTO_SIGNIN` and game Config `teacherAutoSignIn`.
- [ ] **Step 2: Uday's part** (one message via the LMCS Master Agent):
  - go-ahead to deploy PDR with Task 1 and set `TEACHER_AUTO_SIGNIN` = `on`;
  - confirm the exam keywords for the campus calendars;
  - tell teachers how to sign in (a one-line message drafted for him, in his words to approve).
- [ ] **Step 3: After his go-ahead only:** merge to main, push, run `node tests/verify.mjs --live`, and sign in as a
  test teacher view. Check the first night's activity-match run in `ai-coordinator/run.log`.
- [ ] **Step 4:** Report one line to the LMCS Master Agent, and update the vault's `work/active/portal-game-layer.md`
  Teacher module section (status, decisions, open tasks).

## Estimate

- 9 tasks, about **14–20 hours of agent work**:
  - Tasks 2–5 are pure logic with tests;
  - Task 3's real-data check and Task 7's spot-check are the most variable;
  - Task 8 includes up to 3 UI rounds.
- **Uday:** Q8, then about 10 minutes at deploy.
- **Target:** chapter quest live in late November 2026, once the framework Phase 1 code is deployed.
