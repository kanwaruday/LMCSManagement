# Teacher game T0 + T1: deploy notes (for Uday)

Branch `teacher-game-t1`. Built and reviewed task by task. The final whole-branch review was clean after one fix wave.
Plan: `2026-10-25-teacher-game-chapter-quest.md`. Spec: `../specs/2026-10-25-teacher-portal-game-design.md`.
**Nothing here is deployed. Every step below is Uday's.**

## Before deploy

1. **Merge order.** This branch already contains `portal-game-layer-design` up to 8d6f7d1. Merge the game layer's
   Phase 1 first (the game director's go-live), then this branch. `apps-script/main.gs` and `apps-script/projects.json`
   also change on `coordinator-game-c1`, so expect small conflicts there. Page asset stamps may conflict: resolve them
   by running `node tools/stamp-assets.mjs`.
2. **Test status.** `node tests/verify.mjs` should show only the base branch's own failure, `datasrc/test-datasrc.js`
   ("stale exemption lm-monitor/dashboard.html"). It isn't from this work.

## Deploy steps

1. **PDR backend** (sign-in): deploy `main.gs`, `approvals.gs` and `teacher-portal.gs` as usual. Staff sign-in stays
   off until step 6.
2. **Game backend:** `node apps-script/deploy.mjs game --push --deploy "Teacher T1"`. This ships `acad-episodes`
   (shared with the Owner backend) and `game-teacher`. Then:
   - **Calendar permission:** the game project must have Calendar access, which the working-day check needs. Accept
     the permission screen. Without it no school gets a log card.
   - **Trigger:** install the 30-minute time trigger for `gameTeacherRefresh`. Run it once by hand and note how long
     it takes: it fetches the 15 MB CW/HW feed and must finish well inside 6 minutes.
   - **Push secret:** set Script property `GAME_PUSH_SECRET` to a long random value. Put the same value in
     `~/.lmcs/game_push_secret` on the Mac. **Rotating it later resets every activity check**, because it also salts
     the plan keys.
3. **Front end:** put the game backend's exec URL in **both** `GAME_BACKEND_URL` constants:
   - `teacher/index.html`;
   - `teacher/plan-activity.html`. The Mac job reads this one; if it's empty, the nightly check quietly does nothing
     and every plan shows "checking overnight".

   Run `node tools/stamp-assets.mjs`, then `node tests/verify.mjs`.
4. **Game Config** (the `teacher` row, JSON), set per season:
   - `cwhwFormUrl`: the CW/HW Google Form link. It must start with `https://docs.google.com/forms/` or
     `https://forms.gle/`.
   - `cwhwPrefill` (optional): `{"cls":"entry.N","subj":"entry.N","ch":"entry.N","tag":"entry.N"}`, the form's entry
     ids.
   - `quests.termEnd`: Quest 2's term boundary, `YYYY-MM-DD`.
   - `examKeywords`: confirm against the campus calendars. The default is
     `["exam","examination","test week","pt-"]`.

   Also, in the framework's `cap` key, add `"Teacher": 3`. The module's own `teacher.cap` isn't applied by the
   framework.
5. **Mac, nightly activity check.** `ai-coordinator/run.sh` isn't tracked in git, so paste this block just before
   `log "ai-coordinator done"` in the main checkout's copy:

   ```bash
   # Teacher game: the overnight activity check (tools/teacher_activity_match.py; secret in ~/.lmcs/game_push_secret). Once a night, from 21:00 IST;
   # the day is stamped only after a clean run, so a failed run is retried at the next pass. Exits 0 with a message until the game is deployed.
   TODAY=$(TZ=Asia/Kolkata date +%F)
   if [ "$(TZ=Asia/Kolkata date +%H)" -ge 21 ] && [ "$(cat "$DI/../tools/private/.activity_match_day" 2>/dev/null)" != "$TODAY" ]; then
     mkdir -p "$DI/../tools/private"
     "$PY" "$DI/../tools/teacher_activity_match.py" >> "$LOG" 2>&1 && echo "$TODAY" > "$DI/../tools/private/.activity_match_day" || log "activity match failed (exit $?)"
   fi
   ```

6. **Switch on staff sign-in** (Uday's decision, Q8/Q9). Set Script property `STAFF_AUTO_SIGNIN` = `on` (exactly) in
   **both** the PDR and the game projects. From then on, every Active employee signs in with a role by department:
   - Teaching, AdminPTI and AdminIT get Teacher;
   - AdminClerk, Non-Teaching and Transport get Staff;
   - AdminTM gets nothing automatically.

   Allowlist rows always win.
7. **Check:** sign in as Owner and "view as" one teacher per campus. Quests should match that teacher's real chapters.
   After the first night, check `ai-coordinator/run.log` for the activity match.

## Known residuals (follow-ups, not fixed in this run)

1. **Fixed (Ruling 34): the "not linked" line after a long break.** The 30-day rule is gone. A teacher now sees
   "Your entries aren't linked to you yet; your Principal can fix this." only when BOTH hold: (a) the index resolved
   zero feed entries to their employee code in the whole feed (`resolvedEntries === 0` on the TeacherState, counted
   at index build), and (b) their campus has at least one name in `tch_meta.unmatched`. Winter vacation, long leave
   and new joiners get the normal missions and log card. A state cached before this change has no `resolvedEntries`
   and never shows "unlinked", so it fails safe until the next rebuild (at most 30 minutes after deploy).
2. **A thrown fetch or build during the 30-minute refresh skips the keep-previous path.** On a timeout, DNS failure
   or malformed feed, the refresh doesn't re-put the cached states or set the failure time. They then lapse after 6 h
   and each load retries the 15 MB fetch. One `catch` around the fetch and build closes it
   (`apps-script/game-teacher.gs` around 465–472).
3. **For the game director:** an unlinked teacher still sees Quest 1 and roster-based chapter quests that won't tick.
4. **For the owning teams:** a few tests outside this module (payroll, staff, hiring, coordinator) still use
   real-looking employee codes. This was already the case before this work, and this branch deliberately didn't edit
   other teams' tests.
5. The minor items the reviews deferred are recorded in the review notes. None blocks deploy.
