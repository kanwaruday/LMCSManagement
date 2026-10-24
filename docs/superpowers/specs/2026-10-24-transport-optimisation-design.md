# Transport optimisation v1: GPS checks with accountability, by role

Date: 2026-10-24. Agreed with Uday in the transport-GPS session; Uday handed the remaining calls to Claude
("use your best judgement to build everything ... discuss before implementing" operational changes).

## Why

Transport lost about ₹17 lakh net in Apr–Sep 2026 (17 of 23 vehicles losing). Goal for a year from now:
**no bus runs at a loss.** Start with cost leakage. The GPS (Blackbox / trackmaster.in) and the Fee Clerk day
book (fuel fills with litres + odometer since 23 Oct 2026) make leakage visible. Findings that started this:
fuel spend implies 2–4 km/L on buses whose fleet peers do 5–7.7; 44–69% of some buses' km are driven with the
tracker dark; buses run 2–3× their planned daily km; 14 of 23 vehicles have no working tracker.

## Principles (Uday)

- Each level up sees more: **Fee Clerk** = fewest numbers, one plain instruction per item, two buttons.
  **Coordinator** = the checks with evidence and a required outcome. **Owner** = money, trends, who is not
  acting, and proposals.
- Staff act better on less data and explicit instructions. Every item says exactly what to do, who owns it,
  and by when, and escalates when it is not done.
- Operational changes (route redesign, scrapping, driver action) are **proposals for Uday**, never automatic.
- Tracker gaps are not called deliberate until Blackbox has fixed the devices ("blind km", not "tampering").

## Projects (order agreed)

1. **Tracker health** — every vehicle tracked; weekly blind-km per bus shows whether the vendor's fix held.
2. **Fuel and service control** — every fill checked against GPS km; service repeats visible per bus.
3. **Parking and route discipline → redesign** — nights away from the usual parking place; stops and
   shared stops as the input to a route redesign proposal.
4. **Fleet renewal and compliance** — HP Motor Vehicle Rules amendment (TPT-A(7)-1/2018, 12 Oct 2018):
   school vehicles max **15 years**, **40 km/h**, GPS + CCTV, driver under 60. Contract-carriage 12-year
   limit is a separate open question for the RTO agent.

## Architecture (Claude's calls)

- **The Mac is the analysis brain** (`~/Projects/transport-gps`, daily launchd): fetch → flatten → stops →
  `insights.py`, which pushes one payload to the Coordinator backend with the existing shared secret
  (`TRANSPORT_PUSH_SECRET`), action `transportgpspush`. Every GPS point stays on the Mac.
- **The Coordinator backend stores and dispenses** (tabs in the transport form-responses workbook):
  `GPS Daily` (bus × day), `GPS Health`, `GPS Stops`, `GPS Proposals`, `Fuel Checks`, `Fuel Responses`.
  On each push it recomputes fuel checks and raises/auto-resolves follow-ups in the existing Tasks store.
- **Fuel fills** live in the Office backend's books. A daily Office trigger copies the last 120 days of fills
  (all campuses, reversals removed) to a `Fuel Fills` tab in the same workbook. No IDs cross projects.
- **Fuel check** (per fill, from the bus's previous fill): GPS km between the two fill dates vs the litres of
  the later fill → km/L; bill odometer change vs GPS km. A weekday with no GPS fix at all in between makes the GPS km
  a floor, so such a fill is never flagged ("tracker missed days"); a meter change (odometer note) or a fill
  without an odometer skips the odometer comparison. Flag when km/L < 80% of the bus norm, or the
  bill-odometer km differs from GPS km by > 20% and > 25 km. Norm = 7.5 km/L for ≤ 26 seats, 5.0 above
  (best of fleet), replaced by the bus's own median once it has 4 clean fills.
- **Follow-ups (accountability)** — Department `Transport`, auto-assigned to the campus's coordinator when
  the allowlist names exactly one for that campus, with a due date (overdue = high, existing rule).
  Resolving a transport follow-up **requires an outcome note**. A self-clearing follow-up whose problem comes back
  reopens: at once if the system closed it, after its due window if a person did. A tracker is "silent" only when
  another bus of its district reported (holidays silence a whole district), or after 14 days regardless.

  | Domain | Raised when | Instruction | Due | Auto-resolves |
  |---|---|---|---|---|
  | `gps_dead` | tracked bus, no signal ≥ 2 days | Call Blackbox, note the complaint number | 3 days | yes |
  | `gps_blind` | ≥ 20% of last 7 days' km blind (≥ 30 km) | Ask Blackbox to check power wiring | 7 days | yes |
  | `gps_none` | operational vehicle with no tracker | Get a tracker fitted (legal requirement) | 14 days | yes |
  | `bus_away` | a night parked > 2 km from the usual place | Call the driver, record the reason | 2 days | no |
  | `bus_speed` | ≥ 10 min above 40 km/h in 7 days | Warn the driver; legal limit is 40 | 3 days | no |
  | `fuel_check` | clerk says the slip matches, or no clerk answer in 2 days | Ask the driver; if unexplained, recover the cost | 3 days | no |
  | `bus_age` | vehicle ≥ 15 years (or turns 15 within 180 days) | Plan retirement or replacement (proposal) | 30 days | yes |

- **Surfaces**
  - Fee Clerk — `office/buses.html`: up to 3 "Today's bus checks" cards above the map (fuel bills to
    check for their campus): what to do in one sentence, buttons **Slip matches** / **Bill was wrong –
    I corrected the day book**. The Office **Today** screen shows "Live Buses · N fuel bills to check" and a banner
    saying an unchecked bill goes to the Coordinator under the clerk's name after 2 days (client-side, like the Hiring
    counts; a server-side Today provider would open a second workbook on every Today load).
  - Coordinator — `coordinator/transport/live.html` tabs: **Checks** (this page's transport follow-ups and
    fuel checks with evidence), **Map**, **Trackers**, **Driving** (nights away, speeding, km vs plan),
    **Stops**.
  - Owner — `owner/transport/index.html`: 4 numbers (estimated leakage ₹/month, trackers healthy x/n,
    transport follow-ups overdue, vehicles at/near 15 years), "most unusual first" list, who is sitting on
    overdue follow-ups, and the proposals (route merge candidates from shared stops, fleet renewal list).

## Non-goals (v1)

- No automatic route changes, no driver penalties applied by software, no parent access.
- No service-repeat analysis yet: needs a few weeks of per-vehicle service entries in the day book; the
  categories already exist. (v2.)
- No pump-location check (the day book has no fill time).

## Anti-goals

- A clerk screen with tables or percentages.
- A follow-up nobody owns, or one closed without saying what was done.
- Numbers on the Owner page that disagree with the Coordinator page.
