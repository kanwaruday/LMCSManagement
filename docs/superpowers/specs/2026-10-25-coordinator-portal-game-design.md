# Coordinator Portal as a game ("District HQ"): design

Date: 2026-10-25. Status: **draft for Uday.** Asked for by Uday through the LMCS Master Agent: "We are trying to engulf
the entire portal into a game with real life missions and tasks." Uday answered the brainstorm questions one at a
time through the Master Agent. **Everything not marked "Uday" is Claude's call.**

Builds on, and does not repeat:
- the shared game layer: `2026-10-25-portal-game-layer-mascot-design.md` (branch `portal-game-layer-design`), with its
  working contract `game-layer-framework-contract.md` v2. It provides Buddy, the greeting, the next-step bar, the
  Today panel, quests, team goals, help credit, private standing, seasons, the shipment deck and the game backend.
- the transport game, Fleet Command: `2026-10-25-transport-game-design.md`. This covers heat, missions, the map shell
  `assets/game-map/`, the garage and capture.
- the data and features inventory: vault `work/research/Coordinator portal inventory.md`. Read it first.

## Intent and why

- **Uday:** every part of the portal becomes a game on real data, real data entry, real people and real-life
  missions. Transport goes first; the Coordinator Portal is next.
- **Uday:** the Coordinator Portal is the **action layer** (flag → act → track to resolution); the Owner Portal is the
  insight layer.
- **Uday (2026-10-25), what slips today:**
  - Coordinators: "approvals pending 3+ days and hiring stalls".
  - Principals: "the monthly staff evaluation / Support Session marks, and closing issues raised in daily reports".
- **Why a game for Coordinators (Claude's reading):** a Coordinator holds 20+ open items across 3 campuses and 8
  departments. Today they appear as a flat list on department pages. The list is complete but gives no sense of what
  matters most. A strategy game is good at three things:
  - turning a big world into one clear next move;
  - showing what a decision will cost before it is made;
  - making a team feel like a team.

  Those are exactly the Coordinator's three jobs: act, decide, and lead the 3 Principals.

## Goals

1. **A District HQ** that reads like a regional commander's screen. It shows the district's 3 campuses, each with
   needs bars, and the full ranked queue of contracts (follow-ups).
2. **Every approval is a decision with a trade-off preview** (Frostpunk). Before deciding, the Coordinator sees what
   the decision touches, from real data.
3. **District team goals** shared by the Coordinator and the 3 Principals (Kingshot's Bear Hunt). Everyone's real work
   fills one bar, measured against the district's own target or its own last term.
4. **Long-cycle duties become term campaigns.** Campus papers (fire NOC, recognition, water test) and the findings
   from the MD Academics visit are currently tracked in vault notes. Each becomes a term-long quest with real
   deadlines.
5. **Coordinators bring the module's content to the shared game layer**: their mission adapter, quests and team
   goals. The layer itself is the game director's and is not rebuilt here.
6. **Goals are configurable per term by the Owner, never hard-coded** (Uday: "this is an evolving thing, we will
   identify the goals for everyone for the next 6 months"). Full go-live is **March 2027** (Uday).

## Non-goals

- No new task store. The Coordinator **Tasks** tab stays the one source of missions.
- No rebuild of the shared game layer (Buddy, the Today panel, quests, team bars, the reset, storage, voice) or of
  Fleet Command. Transport shows on the HQ as one summary "front" that opens Fleet Command.
- No Principal Portal game. Only the Principal side of the shared district goals is designed here, in its own
  hand-over section, for a future Principal chat to take over.
- No automatic decisions. The game never approves, rejects, assigns or closes anything by itself.
- No change to who may decide. Decide rights stay as they are: the Owner, or a Coordinator with `CanApprove`.

## Anti-goals (a failure even if it works)

- **Rewarding speed of decisions.** "Approvals within 3 days" is a district goal against an **age line**. Time to
  decide is never scored per person; a careful "Info Requested" counts as action. A game that makes Coordinators
  approve faster but worse has failed.
- **Rewarding volume.** No credit for the number of comments, nudges, messages, assignments or resolves. Closing a
  follow-up needs a written outcome, as it already does for transport.
- **Comparing campuses or districts.** LMS 1–3 is never ranked against LMS 4–6, and campuses are never ranked
  against each other. Each team is measured only against its own target or its own last term.
- **Comparing people.** No Coordinator or Principal sees another's name or rank. Private standing follows the shared
  layer (Uday's rule).
- **Gamifying discipline or people's pay.** Disciplinary / Termination, Compensation Change and EPF Exemption get no
  game treatment: no preview "score", no badge and no team-goal credit. They show as plain decision cards.
- **A needs bar that shames a person.** Bars describe a campus's state ("staff papers 82% complete"), never a
  person's worth.
- **Children or staff personal data in a game view.** Children appear only as counts. Staff documents (Aadhaar, PAN,
  bank) are never shown in the HQ; the HQ links to the signed-in Documents page.
- **Decoration that slows the work.** The HQ has to be faster to use than today's follow-ups page, not slower.

## The world

- **The district is the board.** A Coordinator's HQ is their district: LMS 1–3 or LMS 4–6, from
  `coordVisibleCampuses_` (the allowlist campusId). The 3 campuses are **bases**.
- **Today, Coordinators may be network-wide** (campusId `ALL`). The vault calls that "deliberately temporary", and
  the approvals code comments assume it. An `ALL` Coordinator's HQ shows all 6 bases, grouped into the two districts.
  **Which it is at go-live is open for Uday** (see Open). A district-locked Coordinator needs the district expansion
  added in two more places, because both match the campus exactly today:
  - `approvals.gs` (`aprList_`, `aprDetail_`, `aprDecide_`, `aprAddComment_`), in the PDR project;
  - the Office backend (`officeAssertCampus_`).

  Alternatively, the allowlist row lists the 3 campuses.
- **Names are data, not code.** Who the Coordinators and Principals are is read live from the allowlist, never written
  into the repo (Uday: "The Coordinator names are in the allowlist google sheet").
- **The cast:** Buddy only. Coordinators and the Owner get no module owl (the game director's call, agreed).
  Coordinator lines are drafted here and voice-checked by the game director against the Voice Guide.
- **Two layouts over one set of data** (**pending Uday's answer to question 3**; Claude's recommendation):
  - **The board** is the default and is phone-first. It shows the ranked contracts with a small district strip of 3
    bases and their needs on top.
  - **The map** is the laptop view. The 3 bases sit on the district map, using Fleet Command's shared map shell, with
    missions pinned to their base and a ping list. It comes once the map shell exists (Fleet Command Phase 1b).

## What a Coordinator sees

### 1. The Today panel (shared layer, Coordinator content)

- Up to 5 missions, **core first** (Uday): approvals waiting 3+ days, then hiring stalls (approved but not Hired, or
  Hired but not in the Employee Master). The rest of the queue fills any remaining slots.
- Mission id: `coordinator:<domain>:<TaskId>`.
- **Done and doneBy come from the source record, not the Tasks row** (builder check). Approval and hiring rows
  auto-resolve as `system (condition cleared)`, which the shared spec would otherwise read as "no longer needed".
  - **Approval:** done when the Approvals row has a decision (Approved, Rejected, Info Requested or Revoked, made
    through `aprDecide_`). `doneBy` = `decidedByEmail`.
  - **Complete-hire:** done when the Employee Master row exists. `doneBy` = whoever added it (the Coordinator's real
    lever).
  - **Hiring stall** (approved but not Hired): done when the applicant reaches Hired or Rejected. Only the campus
    marks Hired on the Hiring Dashboard, so a Coordinator's lever here is the conversation. **Claude's call:** the
    stall is a **shared district mission**. When it clears, it fills the district bar, and no one gets personal
    credit for a nudge.
  - **Other domains:** done when the row is resolved by a person with an outcome note. `doneBy` = `ResolvedBy`.
- A Tasks row with no Assignee is a **shared** mission for every Coordinator of that district, as settled in the
  shared spec.

### 2. The contract board (the full queue)

Every open follow-up for the district appears as a **contract card**, in the style of GTA V's phone inbox of
contracts. Each card shows:
- what it is, the campus, and who is waiting on it (a Principal, a candidate's joining date, a bus);
- its **age against its line**. The line is the domain's existing severity threshold, shown as an "overdue" band,
  never a countdown;
- **Go**, which opens the exact record: the approval, the applicant, the employee's documents, the report issue or
  the bus;
- **bottleneck flags** (Factorio) on the pipelines:
  - **stuck** means waiting on us (Pending, approved-but-not-Hired);
  - **waiting** means waiting on someone else (Info Requested, a Principal's reply);
  - **missing** means a step not done at all (Hired but no Employee Master row).

**Ranking (Claude's call):**
1. assigned to me;
2. past its due date;
3. core kinds;
4. severity;
5. age.

This is the same order the Today panel uses, extended to the whole queue.

**Heat** (Need for Speed) is a **campus** meter, never a person's. It rises as items age past their line and cools as
they clear. It is the same idea as Fleet Command's heat per bus, at campus level. When a campus's heat is high, the
Owner's view shows it, which is today's "Owner sees who is late", made visible.

### 3. Decisions with a trade-off preview (Frostpunk)

An approval card opens a **decision view**. The request (title, description, amount, item, quantity, evidence link,
comments) is shown as today. Beside it is a preview built only from data the portal already holds. Each figure shows
where it came from, and anything unknown is labelled "not known".

| Category | The preview shows | From |
|---|---|---|
| Every request | Days waiting; who is waiting (the requesting Principal); urgency; the referral chain; how the same category was decided at this campus in the last 12 months (counts approved / rejected) | Approvals and Comments tabs |
| Financial / Purchase | The amount against this campus's day-book spend this month and the months since the portal day book began (22–23 Oct 2026; no 3-month average until Jan 2027; per financial year, so it resets on 1 April); the linked planned activity, if any | Approvals (`amount`, `linkedPlannedActivityId`); Office `daybook.list` / `ledger.summary`, readable only for the campuses in the Coordinator's allowlist cell (or `ALL`) |
| New / Backup Position | Active staff in that department at the campus; open requisitions; applicants in the pipeline for that role | Employee Master; Hiring Dashboard data |
| Event / Invitation, Off-Campus Trip, Holiday / Calendar | Other approved events at the campus within ±7 days. For a holiday: working days left in the term | Approvals history; the existing working-day logic |
| Academic Change | The CW/HW logging and tag pattern of the classes concerned, where the request names them | `coordinatoracademics` |
| Compensation Change, Disciplinary / Termination, EPF Exemption | **No preview** (see the anti-goals). A plain decision card | — |
| Appointment Confirmation (Salary Offer) | Unchanged: the Hiring Dashboard gate (MD interview first) | Hiring |

**The decision is today's action.** Approve, reject, ask for information or refer go through the existing
`approvals.gs`; allocating a follow-up goes through `coordinatorallocate`. A Coordinator without `CanApprove` sees the preview and can
comment, but cannot decide, refer or allocate. Refer and allocate are decider-only in the code (`aprDecide_`,
`coordAprAllocate_`). **Whether every Coordinator gets `CanApprove` is open for Uday**; without it, a Coordinator
can't clear their own core mission.

**Help credit** (shared layer): when a Coordinator's decision clears a Principal's waiting mission, the Principal sees
"cleared with help from …" and the Coordinator gets a recognition line ("You unblocked 2 Principals today").

### 4. Campus needs bars (The Sims)

Each base shows a few **needs**: the state of that campus, computed from real data. A need decays as work goes undone
and is refilled by real actions, never by a tap.

| Need | Full when | From |
|---|---|---|
| **Decisions** | No approval at this campus past its line | Approvals adapter |
| **Hiring** | No stalled hire, and every Hired person is in the Employee Master | Hiring adapters |
| **Staff papers** | Every active employee has the required documents | `coordinatordocuments` (one definition: see the builder notes) |
| **Evaluations** | SS marks on track against the month's quota | PDR `ssdashboard` |
| **Report issues** | No daily-report issue open past 7 days | PDR Issues and Issue Actions |
| **Campus papers** | No campus compliance paper expired or missing | The new Campus Papers register (see 6) |
| **Transport** | Fleet Command's front summary is clear | `coordinatortransportfront` (Fleet Command, Phase 1b) |

- A campus with every need full is **"steady"**.
- The bars are shown to that campus's Principal, its Coordinator and the Owner. They are never shown side by side as a
  ranking.
- **Later, not now:** a **Finance** need (every day-book expense has its bill photo, deposits reconciled), once the
  Office data has settled after its 22 Oct start. **Student Life** waits until there is a register of any kind.

### 5. District team goals (Kingshot's Bear Hunt)

- **The team:** the district's Coordinator(s) and its 3 Principals. It uses the shared layer's `TeamGoal`, with
  `team.key = "district:LMS1-3"`; members come from the allowlist.
- **Season 0 defaults** (from Uday's answers). They are **editable defaults, not commitments**, set in `Game Config`
  by the Owner each term:
  1. **Decisions on time:** every approval in the district decided within 3 days. A decision is Approved, Rejected,
     Info Requested or Revoked, made through `aprDecide_`. **A comment does not count.** Today any comment flips
     Pending to Info Requested (Principal Portal Review 2026-10-22, item 17); that bug is fixed in C1 before this goal
     goes live, so the goal can't be met by commenting.
  2. **No stalled hires:** no hire stuck past 7 days, and every new joiner in the Employee Master before their joining
     date.
  3. **Evaluations in:** every campus meets its SS quota by month end.
  4. **Issues closed:** every daily-report issue closed within 7 days of being raised.
- Each goal is one bar that the district fills together. Coordinators' and Principals' real actions both count.
- The comparison is always "this district against its own target or its own last month", never against the other
  district.
- **Shipments** (shared layer, from the transport design): a met season goal earns its campus or district a reserve
  card. Uday ships it through Approvals. The deck and card values are his to set.

### 6. Term campaigns: the long-cycle duties

These are duties with real deadlines that a daily mission list can't hold. Each is a **season quest** (a term-long
quest): its steps are the real items, and done is checked from data.

- **Campus papers campaign.** Today the compliance status lives in a vault note (`work/School Compliance Checklist.md`,
  read from the Drive scans). Real items as of today:
  - LMS 3's fire NOC expired on 28 Apr 2026;
  - LMS 4's only water test (2015) failed;
  - LMS 5 and LMS 6 have no affiliation, NOC, land or sanitation papers on file.
  - A step is done when the renewed paper is uploaded and its date is read.
- **Visit findings campaign.** The MD Academics visit findings and the Academic Interventions list become steps
  assigned to a campus, closed with a note and evidence.
- **Society (HES) papers:** expiry tracking for ITR, KYC and registration, Owner-scoped.

**New data needed (Claude's call: reuse the transport pattern):**
- A **Campus Papers** tab in the Coordinator backend's workbook holds, per campus per paper: type, valid from, valid
  to, status and the scan link.
- It is seeded and refreshed by the Mac's drive-index sync over HTTPS, exactly as the fleet papers are (shared
  secret, `transportpush` pattern). A Coordinator can upload a renewed paper on the portal, as bus papers are uploaded
  today.
- A **Findings** tab holds visit findings and interventions. Coordinators enter them on the portal (real data entry),
  seeded once from the two vault notes. Each finding then raises a follow-up in the Tasks tab, so it is also a mission.

### 7. Coordinator quests (content for the shared layer)

- **Quest 1 "Your district"** (already in the shared spec): decide one approval pending 3+ days; move one stalled hire
  to its next step; resolve one other follow-up with an outcome note.
- **Quest 2 "Know your bases"**, unlocked after Quest 1:
  - close one daily-report issue together with its Principal (the issue resolved, with the Principal's or your note);
  - allocate one approved request's follow-up to someone with a due date;
  - upload one campus or bus paper.
- **Season quests:** the term campaigns above.
- Every step leaves a trace in source data. There are no "open" or "look at" steps (shared rule).
- **Quests, team goals, core kinds and thresholds ship as default config, not constants** (shared contract, "Goals are
  config"). The code supplies mission kinds and templates; the Owner chooses which count each season in `Game Config`.

### 8. The Owner's view of the Coordinator game

- **Role switch** (GTA V): Uday can open any district's HQ "as the Coordinator" to see exactly what they see. This is
  the same switcher idea as Fleet Command's, reusing the map shell's campus/role switcher.
- **Campus heat** for all 6 campuses, each against its own last term, as the insight layer.
- **Season setup:** the shared layer's Owner screen (Phase 3). Until it exists, the Owner edits `Game Config` in the
  sheet.

## The Principal side of the district goals (hand-over section)

**For a future Principal Portal game chat to take over** (Master Agent's instruction: no Principal chat exists yet,
so only this much is designed here).

- **Missions** (shared spec): SS marks against the monthly quota; daily-report issues; the daily report; replying to
  "Info Requested"; staff documents to upload.
- **A campus-scoped read of daily-report issues.** `PDR Issues` and `PDR Issue Actions` are Coordinator-only today.
  A new action in the Coordinator backend (`principalissues`, Claude's name) returns only that Principal's campus
  issues, with their actions.
  - **It needs a new auth path:** `coordVerifyCaller_` returns null for Principals today. It gets a Principal branch
    (role Principal, own campusId only, read-only) that every other action keeps rejecting.
  - **Built by this module in C1 (Nov)**, so it is ready for the shared layer's Phase 1 Principal adapter. Agreed
    with the game director, so it is built once.
- **Who may close an issue: open with Uday** (asked by the game director). Until he answers, the design assumes
  **both**: a Principal closes an issue with a note on what was done, a Coordinator can close it too, and either is
  credited.
- Principals see their own campus's needs bars and the district team bars. They never see another campus's bars side
  by side with theirs.

### `principalissues` response shape (agreed with the game director, who consumes it)

```
GET action=principalissues&idToken=…   (Principal: own campus only; Coordinator/Owner: as coordinatorpdr scope)
{ success: true, campus: "LMS4",
  issues: [ { id, subject, campus, first: "YYYY-MM-DD", last: "YYYY-MM-DD", count, needsAction: bool,
              status: "open" | "acknowledged" | "assigned" | "resolved",   // from PDR Issue Actions, merges applied
              assignee: "<email>" | "", resolvedBy: "<email>" | "", resolvedAt: "YYYY-MM-DD" | "",
              note: "" } ] }
```

- Merged-away issues are folded into their target, as the Systems page does today.
- No report text beyond the issue subject is returned.

## Buddy's Coordinator lines (drafts, for the game director's voice check)

| Moment | Line |
|---|---|
| Morning, core work waiting | "Good morning. Two approvals at LMS 5 have waited more than three days. The first is a purchase request from the Principal." |
| Morning, nothing urgent | "Morning. Nothing in your district is past its line today. Your five are ready when you are." |
| A decision clears a Principal's wait | "Decided. LMS 4's Principal can go ahead with the trip now." |
| Help credit, end of day | "You unblocked 3 Principals today." |
| A hire completed | "<Name>'s joining is now complete in the Employee Master. Payroll will include them this month." |
| A stalled hire, shared | "A hire at LMS 2 has been approved for 8 days but not yet marked Hired. A word with the Principal usually moves it." |
| District goal met | "LMS 1–3 decided every approval within three days this month. Shabash, district." |
| A campus steady | "LMS 6 is steady: every need is full." |
| A paper expired (bad news) | "LMS 3's fire NOC expired on 28 April. It is the oldest open campus paper in your district. The renewal step is in your term campaign." |
| Data delayed (bad news) | "Today's follow-ups are from yesterday evening: the morning refresh didn't run. Nothing is lost; I'll update when it does." |

**Rules applied:**
- one idea per line;
- no countdowns, no "you haven't";
- the person is credited, not the machine;
- at most one Hinglish touch, and none in bad news.

Names in lines come from live data at runtime, never from static files.

## Data and backend changes (all in the Coordinator backend unless noted)

1. **A scheduled refresh of the Tasks adapters** (gap 3 in the inventory): a time trigger at about 05:30 IST, so the
   04:00 daily set and the nightly "days on track" don't depend on who opened the portal first.
   - **Catch:** the SS adapter calls the PDR backend with the caller's ID token, which a trigger doesn't have. The
     trigger runs the other adapters. SS compliance either gets a script-to-script secret (the `transportpush`
     pattern) or stays page-load-refreshed. This is the builder's call; the first is preferred.
2. **One definition of required staff documents.** Switch the `doc_*` adapter to the 8-type matrix the Documents page
   uses, so a scored bar and the page agree. This was already noted as an open item on 2026-10-07.
3. **New read actions:**
   - `coordinatorhq`: per campus, the needs, heat and a summary of the district goals, computed on request and cached
     for 5 min;
   - `coordinatortransportfront` is **Fleet Command's**: promised in its Phase 1b, returning
     `{byCampus:{heatHigh, heatMed, overdueMissions, ready, total}}`. Until then the transport need is computed from
     `coordinatortransport` and `coordinatortransportinsight`;
   - `coordinatordecision`: the trade-off preview for one approval;
   - `principalissues`: the Principal-scoped issue read.
4. **New tabs:** `Campus Papers` and `Findings` (section 6), plus the push action for Campus Papers.
5. **No new game storage, except one history tab.** Progress and help credits live in the shared Game Backend.
   Missions, needs and heat are computed from source data and never stored twice.
   - **The exception (Claude's call, from the builder check):** SS %, staff-papers % and campus-paper status exist
     only as current state, so "against its own last month or term" needs a record.
   - The scheduled refresh appends one row per campus per day to an **`HQ History`** tab: date, campus and each
     need's value. It holds counts only, no names.
   - Task-based needs could be rebuilt from CreatedAt/ResolvedAt, but one tab for all is simpler.
6. **Front end:** a new `coordinator/hq.html` **beside** today's pages, as Fleet Command does. The department pages,
   follow-ups and Systems stay. The home page links to the HQ. Folding the old pages in is a later decision.
   - It loads the shared `assets/game.js`. From Phase C2 it reuses `assets/game-map/` for the map layout.

## Timeline and phasing (backwards from March 2027)

This fits inside the shared layer's timeline: Shell in Nov, cast and modules in Dec, together in Jan, pilot in Feb,
go-live in Mar.

| Month | Phase | Ships | Depends on |
|---|---|---|---|
| Nov 2026 | **C1. Board** | Coordinator mission adapter (core first, done from source records); scheduled Tasks refresh; `HQ History`; the comment-flips-status fix in `approvals.gs`; `principalissues` with the Principal auth path; `coordinator/hq.html` with the contract board, bottleneck flags and campus heat; decision view with the trade-off preview for the categories above; Quest 1 content | Shared layer Phase 1 (Shell); Uday's approval of this design |
| Dec 2026 | **C2. Bases** | Campus needs bars; the Principal side of issue closing; the transport front (after Fleet Command 1b); the map layout on `assets/game-map/`; Owner role switch | Fleet Command 1b; the issue-closing rule |
| Jan 2027 | **C3. Team and campaigns** | District team goals (season 0 defaults, editable); help-credit lines; Campus Papers and Findings tabs with push and portal entry; term campaigns; Quest 2 | Shared layer Phase 3 (team goals, seasons) |
| Feb 2027 | Pilot | The shared layer's two-campus pilot (Claude's call: two campuses of one district, so the district goals have a real team); tune lines, thresholds and goals from real use. **C1–C3 must be ready for it** | — |
| **Mar 2027** | **Go-live** | Both districts. Season 1 goals set by the Owner | — |
| Later | — | A Finance need (bill photos, deposits); Student Life once a register exists; staffing imbalance once Student Master data exists; private standing (shared layer Phase 4) | Those threads |

Each phase is planned (superpowers:writing-plans), built on a branch, verified (`node tests/verify.mjs`, live checks,
375 px and desktop), polished with the LMCS design skills and then `game-ui-ux` / `gamification-loops`, and shipped
only with Uday's go-ahead.

## Games drawn on, and what each gives

| Game | What we take | Where |
|---|---|---|
| Age of Empires III | Campuses as bases of a home district; shipments | The world; shipments (shared) |
| The Sims | Needs that decay and are refilled by real actions; live state of each base | Needs bars |
| Kingshot | Daily missions and reset; alliance help; shared goals (Bear Hunt); one next objective | Today panel, help credit, team goals (shared); district goals |
| GTA V | Phone inbox of contracts; role switching | Contract board; Owner view-as |
| Frostpunk | See the cost of a choice before making it | Decision view |
| Factorio | Bottleneck flags on a pipeline | Approvals and hiring pipelines |
| Need for Speed | Heat that rises and cools | Campus heat (never speed) |
| Cities: Skylines | District tools: each district has its own settings | Per-district goals in Game Config |
| Two Point Hospital | Staffing as the thing that makes a building work | The Hiring and Staff papers needs |
| Mini Metro, Mini Motorways, OpenTTD, Transport Fever 2, ETS2, Pokémon Go/Ingress, GeoGuessr | Transport-specific; used in Fleet Command | Transport front |
| Duolingo | Consistency against your own last month, with no breakable streak | Days on track (shared) |

**Considered and left out (Claude's calls):**
- **Campus check-ins** (Pokémon Go / GeoGuessr) for Coordinator visits. They would need staff location. A **visit
  report** (a dated record with findings) gives the same value without tracking anyone. It is proposed later, as an
  entry on the Findings tab.
- **Policy cards** (Frostpunk laws) for district policy changes. Policy belongs to the Bye-Laws reconcile process,
  not to a game.

## Left to the builder

- Visual style inside the LMCS tokens: the base glyphs, the needs-bar look and the heat colours. They must match Fleet
  Command so the two read as one game.
- Exact heat weights and needs formulas, starting from the existing severity thresholds.
- Cache times for `coordinatorhq` and `coordinatordecision`.
- Buddy's Coordinator lines, drafted and then voice-checked by the game director.

## Open for Uday

1. **Question 3** (sent): what a Coordinator sees first in the morning (the board, the map, or both).
2. **At go-live, is each Coordinator locked to a district (LMS 1–3 or LMS 4–6), or network-wide as today?** If
   locked, approvals and the Office backend need the district expansion (see The world).
3. **Does every Coordinator get decide rights (`CanApprove`)?** Without them a Coordinator can comment but can't
   decide, refer or allocate, so their core mission and Quest 1 can't be done by them.
4. Who may close a daily-report issue: the Principal, the Coordinator, or both (asked by the game director).

## Settled after the builder check (Claude's calls)

- Done and doneBy for core missions come from the source records (Approvals decision, Employee Master row,
  applicant status), not the auto-resolved Tasks row.
- A hiring stall (approved but not Hired) is a shared district mission. Only the campus can mark Hired, so no
  personal credit for nudges.
- "Decisions on time" counts `aprDecide_` decisions only; the comment-flips-status bug is fixed first (C1).
- `principalissues` gets a read-only Principal auth path and is built in C1, once, by this module.
- `coordinatortransportfront` is Fleet Command's (Phase 1b), per its message of 2026-10-25.
- One `HQ History` tab (counts per campus per day) makes "against its own last month" possible.
- The Financial preview uses the portal day book since 22–23 Oct 2026, per financial year.

*Compiled from Claude conversation, 2026-10-25. Sources: Uday's answers via the LMCS Master Agent, the Coordinator
portal inventory, the shared game layer spec and contract v2, the Fleet Command spec, the Kingshot research, the
Teacher game chat's mission kinds, and the current Coordinator code.*
