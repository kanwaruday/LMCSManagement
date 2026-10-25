# Coordinator Portal as a game ("Coordinator HQ"): design

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

1. **A Coordinator HQ** that reads like a regional commander's screen. It shows the network's 6 campuses (Uday:
   Coordinators stay "network wide"), each with
   needs bars, and the full ranked queue of contracts (follow-ups).
2. **Every approval gets a Coordinator's recommendation, backed by a trade-off preview** (Frostpunk). The Owner
   decides all approvals for now (Uday). The Coordinator prepares each one: checks it, recommends a decision with a
   reason, and chases missing information. The Owner's real decisions against those recommendations become the
   feedback that, over time, earns a Coordinator decide rights, category by category.
3. **Team goals** shared by the Coordinators and the Principals (Kingshot's Bear Hunt): one team per campus (its
   Principal and the Coordinators), plus one network team. Everyone's real work fills one bar, measured against that
   team's own target or its own last term.
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
- No Principal Portal game. Only the Principal side of the shared team goals is designed here, in its own
  hand-over section, for a future Principal chat to take over.
- No automatic decisions. The game never approves, rejects, assigns or closes anything by itself.
- No change to who may decide at go-live: the Owner decides every approval (Uday). Handover to Coordinators is a
  later, per-category, Owner-only step (section 3), never automatic.

## Anti-goals (a failure even if it works)

- **Rewarding speed of decisions.** "Prepared within 3 days" is a team goal against an **age line**. Time to
  recommend or decide is never scored per person; a careful "Ask for information" counts as action. A game that makes
  requests move faster but worse has failed.
- **Rewarding volume.** No credit for the number of comments, nudges, messages, assignments or resolves. Closing a
  follow-up needs a written outcome, as it already does for transport.
- **Comparing campuses or districts.** Campuses are never ranked against each other, and LMS 1–3 is never ranked
  against LMS 4–6. Each team is measured only against its own target or its own last term.
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

- **The network is the board (Uday, 2026-10-25: Coordinators stay "network wide").** Every Coordinator's HQ shows all 6
  campuses as **bases**, as `coordVisibleCampuses_` already returns for an `ALL` caller. No district lock and no
  backend change for one.
- **Districts are filters, not locks** (Claude's call). LMS 1–3 (Dhalpur, Kelheli, Dunkhra) and LMS 4–6 (Ner Chowk,
  Sayoli, Jogindernagar) are two tabs on the board and two regions on the map, because the campuses cluster that way
  on the ground. The code keeps working for a district-locked Coordinator should that ever change (the data layer is
  already parameterised by district).
- **Several Coordinators share one network.** Assigned follow-ups belong to their assignee. An unassigned follow-up is
  a **shared** mission for every Coordinator, labelled "shared"; whoever resolves it clears it for all (the shared
  spec's rule, with the network in place of a district).
- **Names are data, not code.** Who the Coordinators and Principals are is read live from the allowlist, never written
  into the repo (Uday: "The Coordinator names are in the allowlist google sheet").
- **The cast:** Buddy only. Coordinators and the Owner get no module owl (the game director's call, agreed).
  Coordinator lines are drafted here and voice-checked by the game director against the Voice Guide.
- **Two layouts over one set of data** (Uday, 2026-10-25: "Coordinator morning view: both. The mission board by
  default (and on phones), the district map on a laptop, same data."):
  - **The board** is the default and is phone-first. It shows the ranked contracts with a strip of the 6 bases and their needs
    on top, filterable by district.
  - **The map** is the laptop view. The 6 bases sit on the network map in their two districts, using Fleet Command's shared map shell, with
    missions pinned to their base and a ping list. It comes once the map shell exists (Fleet Command Phase 1b).

## What a Coordinator sees

### 1. The Today panel (shared layer, Coordinator content)

- Up to 5 missions, **core first** (Uday): approvals awaiting the Coordinator's recommendation (see 3), then hiring stalls (approved but not Hired, or
  Hired but not in the Employee Master). The rest of the queue fills any remaining slots.
- Mission id: `coordinator:<domain>:<TaskId>`.
- **Done and doneBy come from the source record, not the Tasks row** (builder check). Approval and hiring rows
  auto-resolve as `system (condition cleared)`, which the shared spec would otherwise read as "no longer needed".
  - **Approval (Coordinator):** done when the request has a Coordinator recommendation with a reason, or the Owner
    decided it first. `doneBy` = the recommending Coordinator. Unassigned requests are shared missions; the first
    recommendation clears it for all.
  - **Approval (Owner's own Today panel, the game director's adapter):** done when the Approvals row has a decision
    from `aprDecide_`. `doneBy` = `decidedByEmail`.
  - **Complete-hire:** done when the Employee Master row exists. `doneBy` = whoever added it (the Coordinator's real
    lever).
  - **Hiring stall** (approved but not Hired): done when the applicant reaches Hired or Rejected. Only the campus
    marks Hired on the Hiring Dashboard, so a Coordinator's lever here is the conversation. **Claude's call:** the
    stall is a **shared mission**. When it clears, it fills its campus team bar, and no one gets personal
    credit for a nudge.
  - **Other domains:** done when the row is resolved by a person with an outcome note. `doneBy` = `ResolvedBy`.
- A Tasks row with no Assignee is a **shared** mission for every Coordinator (see The world).

### 2. The contract board (the full queue)

Every open follow-up in the network appears as a **contract card**, in the style of GTA V's phone inbox of
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

### 3. Approvals: prepare, recommend, and earn the handover (Frostpunk preview)

**Uday (2026-10-25):** "not yet, presently the owner for all approvals, we will track the approvals and my
feedback and over time we will hand over things to the coordinators". So at go-live **no Coordinator has decide
rights**; the Owner decides every approval.

An approval card opens a **decision view**, the same one for the Coordinator (preparing) and the Owner (deciding). The request (title, description, amount, item, quantity, evidence link,
comments) is shown as today. Beside it is a preview built only from data the portal already holds. Each figure shows
where it came from, and anything unknown is labelled "not known".

| Category | The preview shows | From |
|---|---|---|
| Every request | Days waiting; who is waiting (the requesting Principal); urgency; the referral chain; how the same category was decided at this campus in the last 12 months (counts approved / rejected) | Approvals and Comments tabs |
| Financial / Purchase | The amount against this campus's day-book spend this month and the months since the portal day book began (22–23 Oct 2026; no 3-month average until Jan 2027; per financial year, so it resets on 1 April); the linked planned activity, if any | Approvals (`amount`, `linkedPlannedActivityId`); Office `daybook.list` / `ledger.summary`, readable only for the campuses in the Coordinator's allowlist cell (or `ALL`) |
| New / Backup Position | Active staff in that department at the campus; open requisitions; applicants in the pipeline for that role | Employee Master; Hiring Dashboard data |
| Event / Invitation, Off-Campus Trip, Holiday / Calendar | Other approved events at the campus within ±7 days. For a holiday: working days left in the term | Approvals history; the existing working-day logic |
| Academic Change | The CW/HW logging and tag pattern of the classes concerned, where the request names them | `coordinatoracademics` |
| Compensation Change, Disciplinary / Termination, EPF Exemption | **No preview** (see the anti-goals). A plain card; the Coordinator may still recommend with a reason | — |
| Appointment Confirmation (Salary Offer) | Unchanged: the Hiring Dashboard gate (MD interview first) | Hiring |

**What the Coordinator does (the core mission):**
- **Check and recommend.** The Coordinator records a **recommendation**: Approve, Reject or Ask for information,
  with a required reason, and optionally what was checked ("quotation matches the day-book rate"). This is
  `coordinatorrecommend`, a new action in the Coordinator backend, writing a `Recommendations` tab in the LMCS
  Approvals workbook (the same workbook as Tasks). The latest recommendation stands; every one is logged.
- **Chase missing information.** A Coordinator's comment to the requester stays a comment. It no longer pauses the
  request (the comment-flips-status bug, fixed in C1). The request stays in the Owner's queue with the Coordinator's
  note.
- **The Owner sees the recommendation on the card** (in `coordinator/approvals.js`, where he already decides): who
  recommended what, why, and the preview. He decides as today through `aprDecide_`. Allocating a follow-up stays with
  the Owner (`coordinatorallocate`).

**Feedback: the Owner's decision against the recommendation** ("my feedback"):
- When the Owner decides, the Coordinator sees the outcome next to their recommendation, with the Owner's decision
  note: "Uday approved, as you recommended", or "Uday rejected: the trip clashes with Term I".
- **Track record**, per Coordinator per category: recommendations made, how many matched the Owner's decision, and the
  last 10 with notes. It is **private**: visible to that Coordinator and the Owner only (the shared standing rule).
  It never ranks Coordinators against each other.
- It counts careful work, not speed: there is no credit for recommending fast, and an "Ask for information" that the
  Owner agrees with counts as a match.

**The handover, an Owner-controlled unlock:**
- Decide rights become **per category**: for example, a Coordinator may decide Event / Invitation and Holiday /
  Calendar while the Owner keeps Financial / Purchase. Delegations are rows in a `Delegations` tab: Coordinator,
  category, from date, given by. `aprCanDecide_` in `approvals.gs` reads it. The all-or-nothing `CanApprove` cell
  stays as "every category".
- **A "ready to hand over?" card** appears in the Owner's view when a Coordinator's track record in a category passes
  a line the Owner sets in `Game Config`. Claude's suggested default: at least 20 recommendations, 90% matched, over at
  least two months. The card shows the record and the last 10 notes. **It is a suggestion only. Nothing is ever
  delegated automatically**; the Owner taps "Hand over" or "Not yet", and both are logged.
- Compensation Change, Disciplinary / Termination, EPF Exemption and Appointment Confirmation **never get a
  "ready" card**. The Owner can still delegate them by hand.
- Once delegated, that category's requests become decide missions for that Coordinator. Their decisions are logged as
  today, and the Owner can revoke a delegation in one tap.
- **When:** the recommendation and feedback loop ships in C1. The `Delegations` tab and per-category
  `aprCanDecide_` come **after go-live**, when Uday is ready to hand over the first category.

**Help credit** (shared layer): when the Owner decides a request, the Principal's waiting mission clears with help
from the Owner. A Coordinator's recommendation that preceded it gets a recognition line ("Your notes helped Uday
decide 4 requests today"). This is detected from the Recommendations and Approvals rows, so there is nothing to tap.

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

### 5. Team goals (Kingshot's Bear Hunt)

- **The teams** (Claude's call, after Uday's "network wide"), using the shared layer's `TeamGoal`; members come from
  the allowlist:
  - **Campus teams:** `team.key = "campus:LMS4"`, the campus's Principal plus every Coordinator. Six teams, each
    against its own target. This is the main unit, because the work is done campus by campus.
  - **One network team:** `team.key = "network"`, every Coordinator and all 6 Principals. One bar for the whole
    school group, the Kingshot alliance.
- **Season 0 defaults** (from Uday's answers). They are **editable defaults, not commitments**, set in `Game Config`
  by the Owner each term:
  1. **Requests prepared on time:** every approval request has a Coordinator recommendation with a reason within 3
     days of being raised (Uday's "approvals pending 3+ days", now the part the team controls). **A comment does not
     count.** The Owner's own decision time is his Today panel's business, not a team score.
  2. **No stalled hires:** no hire stuck past 7 days, and every new joiner in the Employee Master before their joining
     date.
  3. **Evaluations in:** every campus meets its SS quota by month end.
  4. **Issues closed:** every daily-report issue closed within 7 days of being raised.
- Each goal is one bar that its team fills together. Coordinators' and Principals' real actions both count.
- The comparison is always "this team against its own target or its own last month", never campus against campus.
- **Shipments** (shared layer, from the transport design): a met season goal earns its campus a reserve
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

- **Quest 1 "Your network"** (in the shared spec as "Your district"; renamed after Uday's "network wide"): recommend on one approval pending 3+ days, with a reason;
  add one joiner to the Employee Master (a complete-hire); resolve one other follow-up with an outcome note.
- **Quest 2 "Know your bases"**, unlocked after Quest 1:
  - close one daily-report issue together with its Principal (the issue resolved, with the Principal's or your note);
  - see the Owner's decision on three of your recommendations (done when three of your recommendations have been
    decided; nothing to tap);
  - upload one campus or bus paper.
- **Season quests:** the term campaigns above.
- Every step leaves a trace in source data. There are no "open" or "look at" steps (shared rule).
- **Quests, team goals, core kinds and thresholds ship as default config, not constants** (shared contract, "Goals are
  config"). The code supplies mission kinds and templates; the Owner chooses which count each season in `Game Config`.

### 8. The Owner's view of the Coordinator game

- **Role switch** (GTA V): Uday can open the HQ "as" any Coordinator to see exactly what they see. This is
  the same switcher idea as Fleet Command's, reusing the map shell's campus/role switcher.
- **Campus heat** for all 6 campuses, each against its own last term, as the insight layer.
- **Season setup:** the shared layer's Owner screen (Phase 3). Until it exists, the Owner edits `Game Config` in the
  sheet.

### 9. Decision windows (shared layer mechanic, Uday)

A window is a stated period in which a named role makes a real settings call for its own scope. It writes the real
setting and logs every decision. If nobody decides, a default applies; the Owner can override. The window shows as a
mission in the decider's Today panel.

- **The HQ shows the framework's status board** for windows across the network: decided or waiting, per campus. The
  first window is each Principal choosing their campus's 3 track-suit days.
- **Coordinators can open windows for any campus or the network.**
- **Team goal targets is framework window type 2** (agreed with the game director as "district goal targets", renamed
  after Uday's "network wide"; `confirmBy` = the Owner). One proposal per term covers the 6 campus teams and the
  network team. The HQ
  only shows the proposal card and its status; the framework stores and applies it. Before each term, the
  Coordinators propose each team's goal targets (for example "approvals within 3 days"); the Owner's Season
  setup confirms or overrides them. It fits Uday's "we will identify the goals for everyone over the next 6 months".

## The Principal side of the team goals (hand-over section)

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
- **Who closes an issue (Uday, 2026-10-25):** "the Principal closes each with an outcome note; the Coordinator sees
  every closure and can reopen."
  - **`principalissueresolve`** (new, POST): a Principal resolves an issue of their own campus. The outcome note is
    required. It writes to `PDR Issue Actions` with `resolvedBy` = the Principal.
  - **Reopen** goes through the existing `coordinatorpdrissue` with `status: "reopened"` and a required reason. It is
    Coordinator/Owner only, and the issue goes back to the Principal as "reopened".
  - **Closures view:** the HQ and the Systems page get a "Closed this week" list: each closure with its note, who
    closed it and when, plus a Reopen button.
  - **The existing Coordinator resolve stays** (the game director's caution: Uday didn't say Coordinators lose it, and
    some issues only a Coordinator can fix, such as a district purchase). When a Coordinator resolves a Principal's
    issue, the Principal's mission shows "cleared with help from …" (help credit via `resolvedBy`). The Systems page
    keeps its resolve option and adds Reopen on closed issues.
  - **Game side (the game director's):** the Principal's mission is done when that Principal resolves it with a note.
    A reopen puts it back in their Today panel as "reopened" and is not counted against them retroactively.
- Principals see their own campus's needs bars, their campus team bars and the network bar. They never see another campus's bars side
  by side with theirs.

**The Principal's issue screen** (Claude's call): `principal/issues.html`, a list of their campus's open and reopened
issues, each with a Resolve-with-note box, and a "Closed recently" list. It is the Go link for the shared layer's
Principal issue mission.

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

## Buddy's Coordinator lines (voice-checked by the game director, 2026-10-25)

| Moment | Line |
|---|---|
| Morning, core work waiting | "Good morning. Two requests at LMS 5 have waited more than three days for your recommendation. The first is a purchase request from the Principal." |
| Morning, nothing urgent | "Morning. Nothing in the network is past its line today. Your five are ready when you are." |
| A recommendation is in | "Your note is with Uday. LMS 4's trip request is ready for his decision." |
| Feedback on a recommendation | "Uday approved LMS 4's trip, as you recommended." |
| Help credit, end of day | "You unblocked 3 Principals today." |
| A hire completed | "<Name>'s joining is complete in the Employee Master, so payroll picks it up this month." |
| A stalled hire, shared | "A hire at LMS 2 has been approved for 8 days but not yet marked Hired. A word with the Principal usually moves it." |
| Team goal met | "Every LMS 4 request was ready for Uday within three days this month. Shabash, LMS 4." |
| A campus steady | "LMS 6 is steady: every need bar is full." |
| A paper expired (bad news) | "LMS 3's fire NOC expired on 28 April, so the campus is out of compliance until it's renewed. The renewal is the first step in your term campaign." ("Term campaign" is the HQ's on-screen label for section 6.) |
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
   - `coordinatorhq`: per campus, the needs, heat and a summary of the team goals, computed on request and cached
     for 5 min;
   - `coordinatortransportfront` is **Fleet Command's**: promised in its Phase 1b, returning
     `{byCampus:{heatHigh, heatMed, overdueMissions, ready, total}}`. Until then the transport need is computed from
     `coordinatortransport` and `coordinatortransportinsight`;
   - `coordinatordecision`: the trade-off preview for one approval, with its recommendations;
   - `coordinatortrackrecord`: a Coordinator's own track record (the Owner sees everyone's);
   - `principalissues`: the Principal-scoped issue read.
4. **New write actions:** `coordinatorrecommend` (Coordinator; reason required) to the new `Recommendations` tab in the
   LMCS Approvals workbook. `principalissueresolve` (Principal, own campus, note required). `coordinatorpdrissue` gains the
   `reopened` status (Coordinator/Owner, reason required).
5. **New tabs:** `Campus Papers` and `Findings` (section 6), plus the push action for Campus Papers.
6. **No new game storage, except one history tab.** Progress and help credits live in the shared Game Backend.
   Missions, needs and heat are computed from source data and never stored twice.
   - **The exception (Claude's call, from the builder check):** SS %, staff-papers % and campus-paper status exist
     only as current state, so "against its own last month or term" needs a record.
   - The scheduled refresh appends one row per campus per day to an **`HQ History`** tab: date, campus and each
     need's value. It holds counts only, no names.
   - Task-based needs could be rebuilt from CreatedAt/ResolvedAt, but one tab for all is simpler.
7. **Column stability (agreed with the game director, whose Game Backend reads them):** the Tasks tab columns and the
   Approvals tab columns keep their positions. Recommendations and Delegations are new **tabs**, not new columns.
8. **Front end:** a new `coordinator/hq.html` **beside** today's pages, as Fleet Command does. The department pages,
   follow-ups and Systems stay. The home page links to the HQ with one card; the shared layer mounts Buddy on the same page above the department
   cards, so the HQ card is added after that mount lands. Folding the old pages in is a later decision.
   - It loads the shared `assets/game.js`. From Phase C2 it reuses `assets/game-map/` for the map layout.

## Timeline and phasing (backwards from March 2027)

This fits inside the shared layer's timeline: Shell in Nov, cast and modules in Dec, together in Jan, pilot in Feb,
go-live in Mar.

| Month | Phase | Ships | Depends on |
|---|---|---|---|
| Nov 2026 | **C1. Board** | Coordinator mission adapter (core first, done from source records); scheduled Tasks refresh; `HQ History`; the comment-flips-status fix in `approvals.gs`; `principalissues` + `principalissueresolve` with the Principal auth path, Coordinator reopen and the closures view; `coordinator/hq.html` with the contract board, bottleneck flags and campus heat; decision view with the trade-off preview; `coordinatorrecommend`, the Owner's view of recommendations, feedback and private track records; Quest 1 content | Shared layer Phase 1 (Shell); Uday's approval of this design |
| Dec 2026 | **C2. Bases** | Campus needs bars; the Principal side of issue closing; the transport front (after Fleet Command 1b); the map layout on `assets/game-map/`; Owner role switch | Fleet Command 1b; the issue-closing rule |
| Jan 2027 | **C3. Team and campaigns** | Campus and network team goals (season 0 defaults, editable); help-credit lines; Campus Papers and Findings tabs with push and portal entry; term campaigns; Quest 2 | Shared layer Phase 3 (team goals, seasons) |
| Feb 2027 | Pilot | The shared layer's two-campus pilot (campus team goals work with any two campuses); tune lines, thresholds and goals from real use. **C1–C3 must be ready for it** | — |
| **Mar 2027** | **Go-live** | All 6 campuses. Season 1 goals set by the Owner | — |
| After go-live, when Uday chooses | **Handover** | `Delegations` tab, per-category `aprCanDecide_` (PDR project), the "ready to hand over?" card | A track record worth reading (months of recommendations) |
| Later | — | A Finance need (bill photos, deposits); Student Life once a register exists; staffing imbalance once Student Master data exists; private standing (shared layer Phase 4) | Those threads |

Each phase is planned (superpowers:writing-plans), built on a branch, verified (`node tests/verify.mjs`, live checks,
375 px and desktop), polished with the LMCS design skills and then `game-ui-ux` / `gamification-loops`, and shipped
only with Uday's go-ahead.

## Games drawn on, and what each gives

| Game | What we take | Where |
|---|---|---|
| Age of Empires III | Campuses as bases of one home network; shipments | The world; shipments (shared) |
| The Sims | Needs that decay and are refilled by real actions; live state of each base | Needs bars |
| Kingshot | Daily missions and reset; alliance help; shared goals (Bear Hunt); one next objective | Today panel, help credit, team goals (shared); campus and network goals |
| GTA V | Phone inbox of contracts; role switching | Contract board; Owner view-as |
| Frostpunk | See the cost of a choice before making it | Decision view |
| Factorio | Bottleneck flags on a pipeline | Approvals and hiring pipelines |
| Need for Speed | Heat that rises and cools | Campus heat (never speed) |
| Cities: Skylines | District tools: districts as views over one city | District filters on the board and map |
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

Nothing open from the brainstorm. For his review: the handover line (Claude's default of 20 recommendations, 90%
matched, two months) and the four categories that never get a "ready" card.

## Settled with Uday

- Morning view: "both. The mission board by default (and on phones), the district map on a laptop, same data."
- Coordinators stay "network wide" at go-live. Districts are filters; teams are campus teams plus one network team.
- Daily-report issues: "the Principal closes each with an outcome note; the Coordinator sees every closure and can
  reopen." The Coordinator's existing resolve stays.
- Goals are per-term config ("this is an evolving thing"); go-live March 2027.
- Approvals: "not yet, presently the owner for all approvals, we will track the approvals and my feedback and over
  time we will hand over things to the coordinators". Coordinators prepare and recommend; handover is per category,
  Owner-controlled.

## Settled after the builder check (Claude's calls)

- Done and doneBy for core missions come from the source records (Approvals decision, Employee Master row,
  applicant status), not the auto-resolved Tasks row.
- A hiring stall (approved but not Hired) is a shared mission feeding its campus team bar. Only the campus can mark Hired, so no
  personal credit for nudges.
- The approvals team goal counts recommendations with a reason, never comments; the comment-flips-status bug is
  fixed first (C1).
- `principalissues` gets a read-only Principal auth path and is built in C1, once, by this module.
- `coordinatortransportfront` is Fleet Command's (Phase 1b), per its message of 2026-10-25.
- One `HQ History` tab (counts per campus per day) makes "against its own last month" possible.
- The Financial preview uses the portal day book since 22–23 Oct 2026, per financial year.

*Compiled from Claude conversation, 2026-10-25. Sources: Uday's answers via the LMCS Master Agent, the Coordinator
portal inventory, the shared game layer spec and contract v2, the Fleet Command spec, the Kingshot research, the
Teacher game chat's mission kinds, and the current Coordinator code.*
