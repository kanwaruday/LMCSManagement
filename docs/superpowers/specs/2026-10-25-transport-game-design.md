# Transport as a logistics game ("Fleet Command"): design

Date: 2026-10-25. Asked for by Uday. He skipped the brainstorming questions ("just start designing"), so **every
design choice below is Claude's call unless marked "Uday"**. Builds on
`2026-10-24-transport-optimisation-design.md` (its principles, roles, follow-ups and anti-goals all still apply)
and on the three route views on branch `transport-visual-directions` (`coordinator/transport-views.js`: metro
map, stops and walking areas, depot).

## Intent and why

- **Uday:** the whole portal is heading toward being a game, one area at a time, starting with Transport, the
  backbone of the schools. It should feel like a top-notch logistics game on real data, inspired by Age of
  Empires III, Need for Speed and GTA V.
- **Uday:** it must help improve route maps, allocate students to stops, and show the real street view at
  each stop.
- **Why a game (Claude's reading):** transport lost about ₹17 lakh in Apr–Sep 2026, and the fixes are many
  small, repeated decisions by people who are not analysts. These are a stop to move, a tracker to chase, a
  bill to check, a route to merge. Games are good at turning a large world of state into one clear next move
  with instant feedback. The game is a better way to *see and act on* the real operation. It never replaces
  the operation, and it is not a toy beside it.

## Goals

1. One screen per role that reads like a strategy-game HUD. A live map is the world, alerts are pings, work
   comes as missions, and progress shows as bars and streaks.
2. Every game action is a real action on real data, or an explicit proposal for Uday.
3. A route editor where a Coordinator or Uday can try a change (move a stop, merge routes, swap a bus) and
   see the trade-off before proposing it.
4. Students allocated to stops (as counts in the game view), so the routes can be fitted to where children
   actually board.
5. A street-level look at every stop, from Google Street View where it exists and from a verified photo
   where it does not.
6. Built in phases, one at a time, each useful on its own.

## Non-goals

- No parent or student access. No public leaderboard.
- No automatic route changes, driver penalties or money decisions by the software. These stay proposals,
  per the 2026-10-24 principles.
- No 3D, no game engine, no downloadable app. It stays the existing static portal plus Apps Script.
- No live bus-chasing "racing" view.

## Anti-goals (a failure even if it works)

- **Anything that rewards speed or trip time.** School buses are limited to 40 km/h. The game scores
  punctuality, stop order, smoothness, documents and care, never "fastest". Any over-speed event zeroes
  that bus's day score (Claude's call, from the research).
- A metric with no counter-metric. For example, km per litre is always paired with trips completed, and
  route profit is never shown to drivers (it would push overloading or skipped stops).
- Children identifiable in the game view. It shows counts per stop only. Names and addresses stay in the
  existing signed-in screens and never go into the public repo or static files.
- Zero-sum campus leaderboards. The game uses team goals and "beat your own last month".
- Cash prizes tied to scores. The game uses recognition and visible progress. Money stays in normal HR
  decisions (research: tangible rewards can crowd out intrinsic motivation).
- Decoration that slows the work. A Fee Clerk still gets one sentence and two buttons.

## The world (what every role sees)

- **The map is the world.** It is the existing city map plus the metro map, restyled as a game board. Campuses
  are home bases (AoE3 "Home City" → **campus HQ**), buses are units, stops are nodes, routes are lines.
- **The HUD** sits on top of the map:
  - **Top bar:** resources: buses on the road, seats filled, trackers healthy, open missions, ₹ this month
    (Owner and Coordinator only).
  - **Minimap with pings**: red for overdue, amber for due soon. Tapping a ping jumps the camera to it.
  - **Mission panel** (GTA V's phone becomes the **inbox of contracts**).
  - **Role switcher** (GTA V's protagonist switch). Uday can view as Owner, Coordinator (per campus) or Fee
    Clerk, to see exactly what each person sees.
- **Two route colours** (GTA V): **yellow** is the official, current route; **purple** is the proposal being
  drawn.
- **Pause** (Mini Metro): planning views are never live-ticking. The world is a snapshot of the latest data,
  so a Coordinator can think.

## Core loops

### Loop 1: Daily dispatch and missions (Phase 1)

- Each morning the Coordinator opens their campus HQ and sees today's **missions**. These are the existing
  transport follow-ups (`gps_dead`, `gps_blind`, `gps_none`, `bus_away`, `bus_speed`, `fuel_check`,
  `bus_age`), re-skinned as objective cards. Each card has a goal, an owner, a deadline and the evidence, and
  the bus or stop is highlighted on the map.
- **Completing a mission is the real action:** resolving the follow-up with the required outcome note. The
  existing rules stay: auto-resolve, reopen, and the Owner sees who is late.
- **Heat** (Need for Speed) is a per-bus **compliance-risk meter**, never speed:
  - It rises with: a document nearing expiry (insurance, fitness, MV tax, pollution, permit, speed governor),
    a dead or blind tracker, nights away, an overdue follow-up, or a flagged fuel check.
  - It cools when the item is cleared.
  - "**Banked**": a bus is safe only when the document is filed. It shows a tick once uploaded.
- **Bottleneck flags** (Factorio) on each route:
  - **starved**: late, or the tracker is dark;
  - **blocked**: more children than seats across its rounds;
  - **idle**: a bus with no route, or seats unused.
- **Ghost lap** (NFS): today's GPS run drawn against the planned route and last week's typical run. The ghost
  compares **stop order and punctuality only**, never time saved.

### Loop 2: Route editor sandbox and trade-off preview (Phase 2)

- This is a planning mode, not a live view. Pick a route, then drag a stop, remove a stop, add a stop, merge
  two lines, swap the bus, or change rounds.
- **Trade-off preview** (Frostpunk) before anything is saved. Each figure shows a before and after:
  - km per day;
  - longest ride in minutes for a child;
  - seats filled across rounds;
  - stops within 2 minutes of another bus's stop;
  - estimated ₹ per month, from the existing P&L basis.
- **Overflow timers** (Mini Motorways): stops with more waiting children than the bus can take get a warning
  ring.
- **Click a stop to highlight its trips** (Cities: Skylines): every bus and time that serves it.
- **Save as a proposal**, never as a change. The Owner sees proposals in a **war-room** list and approves or
  rejects each. Approval does not change the operation in Phase 2; it records the decision for staff to
  carry out.
- **Starting proposals** come from the data: the merge candidates the GPS stops already produce, and Uday's
  2023 LMS 4 map (long tails outside the catchment circle).

### Loop 3: Student-to-stop allocation (Phase 3)

- This is a planning tool, like AoE3 villager allocation: children are assigned to stops the way villagers
  are assigned to resources.
- **Each stop shows** a count of children and a capacity ring. The route shows seats against children across
  its rounds. There is a live "**unassigned**" counter: children on the transport list with no stop.
- **Data sources:**
  - the ERP per-student transport assignments, from the CSM extractor (route and stop per student per month;
    Kelheli done, the other campuses still to extract);
  - the staff stop-verification workbook ("Bus Stops – verify and fill"): checked stop names and children per
    stop;
  - Uday's 2023 LMS 4 map as a starting reference only.
- **Privacy:**
  - Dragging a child between stops happens in a signed-in screen for Coordinators of that campus and the
    Owner. The game layer shows only counts.
  - Names and addresses never enter the static site or the public repo. They are served by the backend,
    scoped by campus, as the transport views already do for money.
- **Output:** an allocation proposal per route, which feeds the trade-off preview in Loop 2.

### Loop 4: Garage and progression (Phase 4)

- **Garage** (NFS garage, OpenTTD vehicle list) is the depot view, made richer. Each bus card shows:
  - stats as tuning bars: age against the 15-year line, reliability, fuel economy against its norm, seats
    filled, tracker health;
  - its heat;
  - upgrade options with cost against payback: replace, retire, move to a better-fitting route, fit a
    tracker.
- **Reliability** (OpenTTD) decays with days since the last service entry in the day book and resets on a
  service. This needs v2 service data.
- **Campus progression** (AoE3 Home City):
  - A term is a **season**. Each campus has a few **team goals** per season, for example "all trackers live",
    "no document expired", "no stop over capacity", "fuel checks answered within 2 days".
  - Meeting them levels up the campus HQ. This is visual recognition, shown to the Owner and that campus.
- **Shipments** (AoE3): Uday has a small, real monthly reserve (a spare bus-day, a repair budget, a fuel
  advance) and "ships" it to a campus. Earned shipments are a suggestion from the goals met; the decision
  stays his.
- **Streaks** (Duolingo, with a freeze): "days with every document current" and "days with every tracker
  live", per campus. One freeze per month for a genuine vendor or RTO delay, logged with a reason.
- **Skill trees** (Euro Truck Simulator 2) for drivers are deliberately **later or never**. They score people,
  need Uday's HR call, and need trustworthy trackers first.

### Loop 5: Street-level view of every stop (Phase 1, then grows)

**Uday (2026-10-25):** he accepts that Street View may be patchy, and asked for alternatives to be looked at.
The research found:

- **Google Street View does exist in Mandi district.** A probe on 2026-10-25 opened official car imagery dated
  **May 2026** on the Ner Chowk–Dadour corridor (SH-13/NH-32), and blue lines run along NH-154. It is
  **road-only**: off-road stops and the town centres missed, and rural lines may be user photospheres.
- **Mapillary:** coverage unverified; it needs a free token and is reported thin in India.
- **KartaView:** one 2017 dashcam drive only.
- **Panoramax:** nothing in the area.
- **Apple Look Around:** not in India.
- **Bing Streetside:** retiring.

**Layers per stop (Claude's call)**, shown as tabs on the stop card in this order:

1. **Our own verified stop photo.** This is the only layer that can exist at every stop. It shows the exact
   pickup point, and it is current. It works like Pokemon Go Wayfarer, crowd-vetted:
   - A Coordinator or Fee Clerk uploads a phone photo plus a pin, on a driver's behalf if needed.
   - A second person verifies it.
   - The stop earns a **verified** badge.
   - Photos go to the existing private Drive and backend store, never the repo.
2. **Google Street View** through the Maps Embed API iframe:
   - parameters `radius=100` and `source=outdoor`, with the heading set per stop;
   - free at any volume, with the key restricted by referrer;
   - the tab shows only where a panorama is known to exist.
3. **Satellite "from above"** as the always-available fallback, using Esri World Imagery at zoom ≤ 18 with
   attribution. Register a free ArcGIS developer account for compliant use; that is a builder task, not
   Uday's.

**Knowing where Street View exists (Claude's call):**
- Phase 1 starts with a **coverage pass** over every stop, using the free Street View metadata request with
  the same key.
- It sets a stored `hasStreetView` flag per stop (with the panorama date), so the card never dead-ends on an
  empty panorama.
- If the metadata request can't run on a referrer-restricted key, a Coordinator sets the flag once per stop
  by looking.
- **Spot-check first:** test about 30 random stops.
  - If 60% or more have a panorama, Street View stays layer 2.
  - If fewer do, satellite moves up to layer 2.

**Later, optional:** upload 360° phone captures of stops to Mapillary (CC BY-SA). That would build open
coverage the school controls. It is not needed for Phase 1.
- **"Name this stop"** (GeoGuessr) is an onboarding quiz for new drivers and helpers: shown a street view or
  verified photo, they pick the stop. It is never scored for speed.

## Roles

| Role | Sees | Does |
|---|---|---|
| **Fee Clerk** (from Phase 2; `office/buses.html` is unchanged in Phase 1) | Their campus's buses on the map. Up to 3 mission cards (fuel bills, documents), each one sentence and two buttons. Heat ticks turn "banked" when they upload a document. No money, no rankings | Clear their missions. Upload documents and photos |
| **Coordinator** | Their district HQ (LMS 1–3 or LMS 4–6) with a campus picker: map, HUD, missions with evidence, heat, bottlenecks, ghost lap, street view, the route editor and allocation (their district only), and per-campus season goals and streaks. Per-bus money for their campuses (Uday, 2026-10-25) | Complete missions with outcomes. Draw proposals. Verify stop photos |
| **Owner (Uday)** | All campuses: war room (proposals), garage across the fleet, shipments, season standings shown as each campus against its own last term, plus the role switcher | Approve or reject proposals. Ship reserves. Set season goals |

## Phasing (one thing at a time)

| Phase | Ships | Depends on |
|---|---|---|
| **1. Game shell (read-only) + missions + street view** | Game-styled map world, HUD, minimap with pings, mission cards (re-skinned follow-ups, same backend actions), heat per bus, bottleneck flags, ghost lap, the existing three views inside the shell, Street View "Look around" per stop with a coverage check | Transport views shipped (`transport-visual-directions`). Maps Embed API key (Uday). Street View coverage check |
| **2. Route editor sandbox** | Purple-line drawing, trade-off preview, overflow rings, trip highlight, proposals and the Owner's war room | Phase 1. Stop names (staff workbook or GPS) |
| **3. Student-to-stop allocation** | Counts per stop, unassigned counter, signed-in drag between stops, allocation proposals | ERP per-student transport for each campus. Staff stop workbook imported. Privacy advice (DPDP) |
| **4. Garage and progression** | Richer garage, reliability, seasons, team goals, streaks with freeze, shipments | Phase 1. Service entries (v2) for reliability |
| **5. Real writes** | Approved proposals turn into real route and stop changes in the transport workbook, with an audit trail | Uday's approval of the process |

Each phase is planned (superpowers:writing-plans), built on a branch, verified (`verify.mjs`, live checks,
375 px and desktop) and shipped only with Uday's go-ahead.

## Tech calls (Claude's, from the research and the current code)

- **Keep it in the portal:** static pages on GitHub Pages, Apps Script backends, the existing `TransportChecks`
  shell and `TransportViews` module, the auth pattern, and campus scoping as it is today. No framework.
- **Map engine:** keep Leaflet 1.9.4 for Phase 1, since it is already loaded and fine for 23 buses and a few
  hundred stops. Re-evaluate MapLibre GL for Phase 2+ if the game feel needs smooth camera moves, rotation or
  vector styling (`maplibre-cartography` skill installed for that).
- **Tiles:** `tile.openstreetmap.org` is only acceptable for light interactive use with attribution, never
  for prefetch or offline. If the game needs offline or heavy use, move to a hosted vector tile provider or a
  PMTiles extract for the district. Decide in the Phase 1 plan.
- **Street View:** Maps Embed API iframe (free), key restricted by referrer, and a metadata check before
  showing it. No scraping or storing of imagery.
- **Data flow is unchanged:** the Mac (`~/Projects/transport-gps`) analyses and pushes; the Coordinator
  backend stores and serves by role and campus. New game state (proposals, allocations, season goals, stop
  photos, verifications) gets new tabs in the private transport workbook, served through the same scoped
  actions.
- **Game feel:**
  - CSS and Web Animations;
  - sound off by default, with a toggle;
  - respect `prefers-reduced-motion`;
  - an event-driven HUD that updates on data load, not polling.
  
  Design skills, in order of precedence:
  - the LMCS design skills (`frontend-design-for-lmcs`, `taste-for-lmcs`, `impeccable-for-lmcs`);
  - then `game-ui-ux`, `gamification-loops` and `animate` (installed). Their safety warnings are binding.
- **Mobile first:** Coordinators and clerks are on phones. Every screen works at 375 px, and the minimap
  collapses to a ping list.

## Settled after the builder check (Claude's calls unless marked)

1. **Stop identity.** Phase 1 reads stops as they are today (`GPS Stops`, recomputed per push), with no
   lasting IDs.
   - Phase 2 starts with a **Stops master** tab in the transport workbook. Each stop gets a stable ID, a name,
     lat/lng, campus and the routes serving it.
   - It is seeded from the GPS stop clusters, then corrected by the staff verification workbook.
   - It is kept by the Coordinators, through the route editor and stop verification.
   - Proposals, allocations, photos and badges all key on the stop ID.
2. **Untracked buses.** These are 14 of 23 today. They appear as **"fog of war"** (AoE3): the bus card and the
   campus show it, but with no line on the map. The bus carries a "Fit tracker" mission until a tracker
   reports.
   - Their stops can be entered by hand in the Stops master from Phase 2.
   - Until then, the route editor and allocation cover tracked buses plus hand-entered stops.
3. **Beside, not instead.** Phase 1 is a **new screen**, Fleet Command:
   - Coordinators get `coordinator/transport/game.html`; the Owner gets `owner/transport/game.html`.
   - Today's pages stay as they are, each linking to it: `live.html` (Checks, Map, Trackers, Driving, Fuel,
     Stops, the Blackbox list), the compliance page, and the Owner transport page.
   - The Fee Clerk page `office/buses.html` is unchanged in Phase 1.
   - Folding the old tabs into the shell is a later decision, once the game has proved itself.
4. **Coordinator scope follows the code: a district, not one campus.** Coordinators see LMS 1–3 or LMS 4–6
   (`coordVisibleCampuses_`).
   - A Coordinator's HQ is their **district**, with a campus picker.
   - HUD totals cover the selected campus, or "all" for the district.
   - Season goals and streaks are kept **per campus**.
   - Auto-assignment of follow-ups keeps today's rules.
5. **Drivers and helpers have no portal accounts.**
   - The Coordinator or Fee Clerk uploads stop pins and photos on a driver's behalf. Uploads are recorded
     with the uploader and the driver's name.
   - The "Name this stop" quiz runs on a Coordinator's phone with the driver beside them.
   - Driver accounts would be a separate decision.
6. **Document missions are computed, not new follow-ups.**
   - The compliance data the page already serves (document, valid-to date, scan read) produces mission cards
     and heat.
   - A card turns "banked" when the scan is uploaded and read, as today.
   - No new follow-up rows. Escalation stays where it is today: the compliance page and the Owner view.
7. **Phase 2 trade-off figures are calibrated estimates, labelled as such.**
   - The estimate is straight-line distance between stops, times a hill factor.
   - The factor is calibrated per area from each tracked bus's real GPS km against straight-line km, using
     data we already have.
   - No paid routing in Phase 2. Google Routes (needs billing) is a later upgrade if the estimates prove too
     rough.
8. **Phase 1 builds on `transport-visual-directions` as it stands.** Uday approved shipping it unchanged on
   2026-10-25. Splitting the views by role remains a later option the code already supports through
   `opts.views`.

## Open items for Uday

1. **Google Maps Embed API key.** **Uday (2026-10-25): yes, he will create it.** Claude never types or pastes
   keys, so the build reads it from a config value Uday sets himself:
   - It lives in a **Script Property `MAPS_EMBED_KEY`** in the Coordinator Apps Script project (the same
     pattern as `TRANSPORT_PUSH_SECRET`).
   - It is served only to signed-in Coordinators and the Owner, with the transport data. It is never in the
     public repo.
   - Without it, Phase 1 shows photos and satellite only.

   His steps:
   1. In Google Cloud Console (console.cloud.google.com), pick or create a project, e.g. "LMCS Portal".
      Google may ask for a billing account; the Embed API itself is free.
   2. Go to APIs & Services → Library and enable **Maps Embed API**. Also enable **Street View Static API**
      for the free metadata check used by the coverage pass.
   3. Go to APIs & Services → Credentials → Create credentials → **API key**.
   4. Edit the key:
      - **Application restrictions:** Websites → add `https://kanwaruday.github.io/*`.
      - **API restrictions:** Restrict key → tick **Maps Embed API** and **Street View Static API** only.
      - Save.
   5. Optional: set a ₹100 budget alert under Billing → Budgets.
   6. Copy the key. In the Coordinator Apps Script project, go to Project Settings (gear) → Script
      Properties → Add, with name `MAPS_EMBED_KEY` and the key as the value. Save. No redeploy is needed.
2. **Street View coverage.** **Uday: accepted that it may be patchy, and asked for alternatives.** Folded in
   as the three-layer stop view in Loop 5.
3. **DPDP advice before Phase 3.** **Uday: he'll get it when Phase 3 comes.** The design already keeps names
   out of the game layer and the public repo.

## Left to the builder

- **Visual style within the LMCS tokens.** The palette for heat, pings and route colours, icons, and how far
  the "game" look goes before it hurts legibility.
- **The heat formula.** The weights and bands for each risk item, using the existing follow-up domains and
  document dates.
- **Ghost-lap and "typical run" definitions.** Built from the existing `stops.csv`/`runs.csv` data.
- **Persisting proposals and season goals.** The exact sheet tabs and actions, following the existing
  `coordinatortransport*` patterns.
- **Whether the three existing views become map "lenses" inside the shell or remain tabs.**

*Compiled from Claude conversation, 2026-10-25. Sources: Uday's request, the game research (AoE3, NFS, GTA V,
Mini Metro, Mini Motorways, OpenTTD, Cities: Skylines, Factorio, ETS2, Pokemon Go Wayfarer, GeoGuessr, Frostpunk,
Duolingo; gamification and driver-safety studies), the 2026-10-24 transport optimisation spec, and the current
transport code.*
