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
5. A street-level look at every stop, from the school's own captured imagery, with every map and
   street-level part **100% open source** (Uday, 2026-10-25).
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

**Uday (2026-10-25):** he wants a garage covering the service side: a game interface for every key component
of running a bus, including wear and tear, that helps decide the upgrades for each vehicle. Everything below
is Claude's call.

**The garage** (Need for Speed garage, OpenTTD reliability, Euro Truck Simulator 2 workshop) has one bay per
bus, holding:

- **A component board.** Each part has a health bar that wears down with **real km and time**, and is reset
  by a real repair entry. Starting parts and default lives (km or months, whichever comes first; tuned per bus
  type and for hill driving):

  | Group | Components | Wears by |
  |---|---|---|
  | Engine | engine oil, oil filter, air filter, fuel filter, coolant, belts | km and months |
  | Stopping | brake linings/pads, brake fluid, hand-brake | km (hill terrain shortens) |
  | Drivetrain | clutch, gearbox oil, propeller shaft, axle greasing | km |
  | Tyres | each tyre position, plus the spare: age, km and punctures | km, months, punctures |
  | Suspension and steering | leaf springs, shock absorbers, steering joints | km |
  | Electrical | battery, lights, horn, wipers, wiring | months, faults |
  | Body | rust and paint, seats, windows, door mechanism | months, damage |

- **A safety loadout** (equipment slots, like a car's loadout). Each slot is either present and working, or a
  red empty slot:
  - GPS tracker and speed governor (40 km/h) — HP rules;
  - CCTV — HP rules;
  - first-aid box, fire extinguisher (with its refill date), window grills, emergency exit, door lock;
  - school name and phone painted on, and the attendant on board.

  The slots are checked on a **monthly inspection**: a capture-portal checklist with one photo per slot. The
  exact list follows the HP Motor Vehicle Rules amendment and the school's own policy (Uday to confirm).
- **Paperwork** from the compliance data: insurance, fitness, MV tax, pollution, permit, speed-governor
  certificate. This drives heat (Loop 1).

**Where the wear data comes from (nothing new to type except one tap):**

- **Km:** GPS km per day for tracked buses. For untracked buses, the odometer on each fuel fill (required
  since 23 Oct 2026), interpolated between fills.
- **Repairs:** the day book's existing vehicle categories (washing and greasing; service and mechanical
  repair; spare parts and lubricants; battery and electrical; body, welding and paint; tyres), with their
  amounts, dates and bill photos.
- **The one new tap:** when a Fee Clerk enters a vehicle service expense, they **tap which component(s)**
  from a short picture list. The amount, bill and vehicle are already there.
- **Backup:** the Mac's LM Studio reads the bill or job-card photo and proposes the components, so a missed
  tap is caught. The Coordinator confirms.

**Decisions the garage helps with** (each is a **proposal** for Uday, never automatic):

- **Service due:** a part reaching its line raises a mission for the Coordinator ("Bus HP659511: brake
  linings at 90%, book a service this week"), with the nearest workshop and last price.
- **Repeat repairs** (the 2026-10-24 spec's v2 "service repeats"): the same part repaired twice within half
  its normal life flags either a bad workshop or a bad part.
- **Upgrade, keep or replace,** per bus, as a garage card with cost against payback:
  - **Overhaul:** when repairs over the last 12 months exceed a set share of the bus's value.
  - **Resize:** a bus bigger or smaller than its route needs, from seats against children across its
    rounds. Example: swap a 15-seater doing 4 rounds for a larger one doing 2.
  - **Retire or replace:** at the 15-year legal limit, or when cost per km is far above fleet peers.
  - **Fuel:** km per litre persistently below the norm, after the tracker and fuel checks are clean.
- **Workshop scorecard:** for each garage the school uses, the average price per job and how soon the same
  part comes back. This is a fact sheet for choosing workshops, never a public ranking.

**Reliability** (OpenTTD): a bus's reliability is the weakest of its safety-critical parts (stopping, tyres,
steering), not an average. So one worn brake makes the whole bus amber.

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

**Uday (2026-10-25): the map and street-level stack is 100% open source. Google and Esri are dropped.**

Why the school captures its own imagery: the research found no open street-level coverage of the area.
Panoramax has nothing there, and KartaView has one 2017 drive. Google Street View (which does cover the main
corridors) is not open source.

**Capture: our buses are the street-view cars** (Claude's call).
- A Coordinator rides one run of each route with a phone in a dashboard mount, using the school's own
  **capture portal** (Loop 6), which takes the frames and tags the stops.
- Run it **outside school hours**, or on the empty leg, so no children are in the frames.
- Refresh once or twice a year, or when a route changes.
- Faces and number plates are blurred before anything is shown, with an open-source blurring step on the Mac
  (Panoramax ships one, called "SGBlur").

**Storage and privacy.** The images are **private school data**:
- stored with the other private transport data, and served only to signed-in roles by campus scope, like
  money today;
- never in the public repo, never on a public platform.

A self-hosted Panoramax instance (open source) is the upgrade path if the image volume or tooling outgrows the
simple store. That is decided in the Phase 1 plan.

**Viewer.** An open-source viewer in the page:
- **Photo Sphere Viewer** (MIT) for 360° frames;
- a simple next/previous frame strip for flat photos, "drive up to the stop" style.

**Layers per stop**, shown as tabs on the stop card:
1. **Stop photo**, Pokemon Go Wayfarer style (crowd-vetted):
   - the best captured frame at the stop, or a phone photo uploaded by a Coordinator or Fee Clerk;
   - a second person verifies it, and the stop gets a **verified** badge.
2. **Drive-up strip:** the captured frames along the route approaching the stop.
3. **Map view** on the open base map, with the stop pin and the bus line.

There is **no satellite layer**: no free, open, high-resolution imagery of India exists, and Sentinel-2's
10 m pixels are too coarse to see a stop.

**"Name this stop"** (GeoGuessr) is an onboarding quiz for new drivers and helpers. Shown a captured frame,
they pick the stop. It is never scored for speed.

### Loop 6: The capture portal: a Coordinator rides the bus (Phase 1, built first)

**Uday (2026-10-25):** we need our own uploading portal, so he can send a Coordinator with the bus to collect
the data. It is a **phone page in the portal**, `coordinator/transport/capture.html`, signed in like the rest,
for Coordinators. Everything below is Claude's call.

**Two kinds of run:**
- **Photo run** (outside school hours, or on an empty leg, so no children are photographed):
  - The phone sits in a dashboard mount, and the page keeps the screen awake.
  - It takes a frame from the camera **every ~30 m**, from GPS distance, not time, so a stopped bus doesn't
    pile up frames.
  - Each frame is stamped with lat/lng, heading, accuracy, time, bus and route.
  - A big **STOP HERE** button: the Coordinator taps it at each stop, picks the stop name (from the known
    list, or types a new one) and takes one deliberate **stop photo**. That becomes the stop's photo, still
    to be verified by a second person.
- **Count run** (a normal school run, **no camera at all**):
  - The same STOP HERE button, plus a **+/− boarding counter** for the children who get on or off at each
    stop.
  - This gives real children-per-stop numbers and real stop positions and times, the input Loop 3 needs.
  - It records counts only, never names.

**Works in the hills:**
- Everything is saved on the phone first (IndexedDB) and **uploaded later**, on school Wi-Fi or when the
  signal is good.
- An upload page shows "312 of 540 frames sent", resumes after any break, and never loses a run if the
  browser closes.
- Frames are resized to ~1280 px JPEG (~150 KB), so about 25 km is roughly 800 frames and 120 MB.

**Where uploads go:**
- They use the same path as today's document uploads: `transport-uploads.gs` in the Roster project, which has
  the Drive access the Coordinator project lacks. That puts them in a private Drive folder per bus and run.
- The run's stop tags and counts go to a `Capture Runs` tab in the transport workbook.

**Processing on the Mac** (the analysis brain, daily, like the GPS job):
1. Pull the new frames.
2. Blur faces and number plates with an open-source detector before anything is shown.
3. Build each stop's drive-up strip.
4. Snap stop tags to the road.
5. Write results back for the stop cards.

Unblurred originals stay private and are deleted after blurring is checked.

**Stops master gets real data early:** each tagged stop has a name, position and time, and a count run adds
children. So capture runs seed the Stops master (call 1 below) with checked, on-the-ground data, ahead of the
staff workbook.

**Game feel, kept useful:** the run shows as a **mission** ("Capture Route 18: 0 of 14 stops tagged"), with a
progress bar and a route line filling in on the map. A finished, verified route turns from "fog" to
"mapped". No points for speed, and the counter never rewards bigger numbers.

**Privacy:**
- Photo runs only happen outside school hours, and the page reminds the Coordinator before starting.
- Count runs never use the camera.
- Every frame is blurred before anyone sees it, and images are never public.

## Roles

| Role | Sees | Does |
|---|---|---|
| **Fee Clerk** (from Phase 2; `office/buses.html` is unchanged in Phase 1) | Their campus's buses on the map. Up to 3 mission cards (fuel bills, documents), each one sentence and two buttons. Heat ticks turn "banked" when they upload a document. No money, no rankings | Clear their missions. Upload documents and photos |
| **Coordinator** (also rides capture runs) | Their district HQ (LMS 1–3 or LMS 4–6) with a campus picker: map, HUD, missions with evidence, heat, bottlenecks, ghost lap, street view, the route editor and allocation (their district only), and per-campus season goals and streaks. Per-bus money for their campuses (Uday, 2026-10-25) | Complete missions with outcomes. Draw proposals. Verify stop photos |
| **Owner (Uday)** | All campuses: war room (proposals), garage across the fleet, shipments, season standings shown as each campus against its own last term, plus the role switcher | Approve or reject proposals. Ship reserves. Set season goals |

## Phasing (one thing at a time)

| Phase | Ships | Depends on |
|---|---|---|
| **1. Capture portal first, then the game shell (read-only) + missions + street view** | **1a:** `capture.html` (photo runs + count runs, offline queue, upload) and the Mac's blur and strip processing. **1b:** game-styled map world, HUD, minimap with pings, mission cards (re-skinned follow-ups, same backend actions), heat per bus, bottleneck flags, ghost lap, the existing three views inside the shell, stop photos + drive-up strip from our own captured imagery, open base map | Transport views shipped (`transport-visual-directions`). For 1b's stop views: one photo run per route (Coordinator, outside school hours) |
| **2. Route editor sandbox** | Purple-line drawing, trade-off preview, overflow rings, trip highlight, proposals and the Owner's war room | Phase 1. Stop names (staff workbook or GPS). OSRM running on the Mac |
| **3. Student-to-stop allocation** | Counts per stop, unassigned counter, signed-in drag between stops, allocation proposals | ERP per-student transport for each campus. Staff stop workbook imported. Privacy advice (DPDP) |
| **4. Garage and progression** | Component board per bus, safety loadout and monthly inspection, upgrade/keep/replace cards, workshop scorecard, reliability, seasons, team goals, streaks with freeze, shipments | Phase 1. **Months of component-tagged service entries**, so the component tap starts early (see below) |
| **5. Real writes** | Approved proposals turn into real route and stop changes in the transport workbook, with an audit trail | Uday's approval of the process |

**Start collecting garage data early (Claude's call).** The Fee Clerk's one-tap component pick in the day book, and
the monthly safety inspection in the capture portal, ship with Phase 1a. That way, by Phase 4 the garage has months
of real wear history instead of starting empty.

Each phase is planned (superpowers:writing-plans), built on a branch, verified (`verify.mjs`, live checks,
375 px and desktop) and shipped only with Uday's go-ahead.

## Tech calls (Claude's, from the research and the current code)

- **Keep it in the portal:** static pages on GitHub Pages, Apps Script backends, the existing `TransportChecks`
  shell and `TransportViews` module, the auth pattern, and campus scoping as it is today. No framework.
- **Map engine:** keep Leaflet 1.9.4 for Phase 1, since it is already loaded and fine for 23 buses and a few
  hundred stops. Re-evaluate MapLibre GL for Phase 2+ if the game feel needs smooth camera moves, rotation or
  vector styling (`maplibre-cartography` skill installed for that).
- **Everything map-side is open source** (Uday, 2026-10-25):
  - **Tiles:** OpenStreetMap data. Use **OpenFreeMap** (free, no key, verified reachable on 2026-10-25), or
    a self-hosted **PMTiles** extract of the district (Protomaps tools, served as a static file). Drop
    `tile.openstreetmap.org`, whose policy forbids heavy or offline use. Which one is decided in the Phase 1
    plan.
  - **Street level:** our own captured imagery, the Photo Sphere Viewer / frame strip, and open-source
    blurring (see Loop 5).
  - **Routing:** **OSRM** (or Valhalla) running on the Mac with the Himachal OpenStreetMap extract. It gives
    real road km and minutes for the route editor.
  - **Search:** **Nominatim**, if place search is needed.
  - **No API keys and no Google or Esri accounts.**
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
7. **Phase 2 trade-off figures come from open-source routing.**
   - **OSRM** runs on the Mac, the existing analysis machine, on the Himachal OpenStreetMap extract. It
     returns road km and drive minutes.
   - The Mac computes the trade-offs and pushes them to the backend, like the other GPS results. A live
     "what if" on the page sends the edited stop list to a small queue the Mac answers.
   - If the Mac is off, the page falls back to straight-line distance × a hill factor, calibrated from
     tracked buses' real GPS km, and labels it as an estimate.
   - OSRM is checked against real GPS km per route before its numbers are trusted.
8. **Phase 1 builds on `transport-visual-directions` as it stands.** Uday approved shipping it unchanged on
   2026-10-25. Splitting the views by role remains a later option the code already supports through
   `opts.views`.

## Open items for Uday

1. **Maps key: no longer needed.** Uday asked for a 100% open-source stack (2026-10-25), so there's no
   Google Maps key and no Google Cloud steps.
2. **Street-level capture runs.** Street View coverage was patchy, so the alternative is to capture our own.
   - **Uday (2026-10-25):** he will send a Coordinator with the bus, using the school's own capture portal
     (Loop 6).
   - Still his to arrange: which Coordinator rides which route and when (one photo run outside school
     hours, plus one count run on a normal school run per route), and about 6 phone dashboard mounts, one
     per campus.
   - The Phase 1 plan includes a one-page "how to do a capture run" guide.
3. **DPDP advice before Phase 3.** **Uday: he'll get it when Phase 3 comes.** The design already keeps names
   out of the game layer and the public repo.

## Decisions still open for Uday

These are the things only Uday can settle. Each changes what gets built:

1. **Capture runs:** which Coordinator rides which route, and when: one photo run outside school hours plus
   one count run on a school run per route. Plus about 6 phone dashboard mounts.
2. **Safety loadout list:** confirm the required equipment per bus (HP rules plus school policy), and who does
   the monthly inspection (the campus Coordinator?).
3. **Component lives:** use manufacturer service schedules as defaults, tuned for hills, or does a trusted
   mechanic set them per bus type? Either way, Uday approves the table once.
4. **Upgrade rules:** the repair-against-value share that triggers "overhaul?", the cost-per-km gap that
   triggers "replace?", and the yearly fleet-renewal budget the proposals must fit within.
5. **Workshops:** which garages the school uses, and whether a job-card photo is required with every service
   bill (it makes the component backup far more reliable).
6. **Phase 4 rewards:** the season goals per campus, and the size of the monthly reserve Uday can "ship"
   (spare bus-days, repair budget, fuel advance).
7. **Drivers as characters** (skills, wellbeing): later or never. It needs an HR call.
8. **DPDP advice:** before Phase 3, as Uday said.
9. **The design review itself:** on hold until Uday says.

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
