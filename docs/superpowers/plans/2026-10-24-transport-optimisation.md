# Transport optimisation v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GPS-based tracker, fuel, parking, speed and fleet-age checks that land as owned, due-dated follow-ups, shown at three depths (Fee Clerk, Coordinator, Owner).

**Architecture:** Mac `insights.py` computes per-bus facts and pushes them (`transportgpspush`, shared secret) to the Coordinator backend, which stores tabs, computes fuel checks from fills the Office backend mirrors daily, and raises follow-ups in the existing Tasks store. Pages read one action per role.

**Tech Stack:** Python 3 stdlib (Mac), Apps Script V8 (clasp via `apps-script/deploy.mjs`), static HTML/JS on GitHub Pages, Leaflet 1.9.4.

**Spec:** `docs/superpowers/specs/2026-10-24-transport-optimisation-design.md`

## Global Constraints

- Thresholds: speed limit 40 km/h; speeding follow-up at ≥ 10 min above 40 in 7 days; night away > 2 km; blind ≥ 20% and ≥ 30 km over 7 days; dead = no signal ≥ 2 days; fuel flag km/L < 80% of norm or bill-vs-GPS km off by > 20% and > 25 km; norm 7.5 km/L (≤ 26 seats) / 5.0; age limit 15 years, warn 180 days ahead.
- Due days: gps_dead 3, gps_blind 7, gps_none 14, bus_away 2, bus_speed 3, fuel_check 3 (after 2 days without clerk answer), bus_age 30.
- Department string `Transport`. Resolving any transport domain requires a non-empty note.
- Clerk copy: one sentence of instruction, no percentages, two buttons.
- Every new `.gs` file is listed in `apps-script/projects.json`; `node tests/verify.mjs` passes before each commit.

## Review Focus

1. A push with an empty or partial payload (Mac offline, vendor down) must not resolve every gps_* follow-up — auto-resolve only for buses present in the payload.
2. First fill of a bus (no previous fill) yields no check, not a 0 km/L flag.
3. A reversed day-book fuel entry must not be checked.
4. A clerk answering for another campus's fill is refused.
5. Re-running the same push twice creates no duplicate follow-ups (deterministic TaskIds).

---

### Task 1: Mac insights + push

**Files:** Create `~/Projects/transport-gps/insights.py`, `~/Projects/transport-gps/test_insights.py`; modify `weekly.sh` (rename job to daily).

**Produces:** payload `{syncedAt, days:[{reg,date,km,blindKm,firstMove,lastMove,nightLat,nightLng,nightAwayKm,maxKmh,minOver40}], health:[{reg,lastFix,blind7,km7}], bases:[{reg,lat,lng,place}], stops:[stops.csv rows], proposals:{shared:[{place,lat,lng,buses:[{reg,trip,arrive}]}]}}` POSTed as `{action:'transportgpspush', secret, payload}`.

- [ ] Test: `night_spot` picks the last fix of a day; `base_of` = most frequent night spot cluster over 30 days; `away_km` > 2 for a night 5 km from base; `blind_km` sums odometer deltas across gaps > 10 min; `over40_minutes` counts fixes > 40.
- [ ] Implement; `python3 test_insights.py` passes; run `insights.py --dry` prints counts.
- [ ] launchd job daily 06:30 (`weekly.sh` → also runs `stops.py` and `insights.py`).

### Task 2: Office fuel mirror

**Files:** Create `apps-script/office-fuel-mirror.gs` (+ projects.json `office`), test `tests/office/test-fuel-mirror.js`.

**Produces:** tab `Fuel Fills` in workbook `1VXTMZjqCS82ftB1rwoN4BzoiOTP7-Vg0m5vTH01Tfzc`: `id, campus, date, reg, litres, odometer, amountRs`.

- [ ] Test: reversed fills and reversal rows excluded; only `category==='fuel'`; last 120 days.
- [ ] `officeFuelMirror_()` + lazy daily trigger installed from `officeTodayGet_`.

### Task 3: Coordinator GPS store, fuel checks, follow-ups

**Files:** Create `apps-script/coordinator-transport-gps.gs` (+ projects.json `coordinator`), test `tests/transport/test-transport-gps.js`; modify `coordinator.gs` routing, `coordTaskUpsert_` (assignee + due on create), `coordTaskResolveCore_` (note required for transport domains).

**Produces:** `coordGpsPush_(body)`, `coordFuelChecks_(fills, days, seatsByReg) -> [{id,reg,campus,date,litres,km,kmpl,norm,billKm,flag,reason}]`, GET `coordinatortransportinsight` (Coordinator/Owner) and `coordinatorbuschecks` (Fee Clerk: own campus fuel checks awaiting them), POST `transportclerkcheck {fillId, answer: 'matches'|'corrected'}` (Fee Clerk allowed).

- [ ] Tests: Review Focus 1–5; fuel check math (300 km / 60 L = 5 km/L vs norm 7.5 → flag); speeding/away/dead/blind/none/age raise with correct due; resolve without note refused for transport.
- [ ] Implement; verify passes.

### Task 4: Pages

**Files:** modify `coordinator/transport-live.js` (tabs: Checks, Map, Trackers, Driving, Stops; clerk mode: check cards), `office/buses.html`, `coordinator/transport/live.html`; create `owner/transport/index.html`; office Today provider `officeTodayFuelCheckTasks_` (reads `Fuel Checks` + `Fuel Responses`); shared.js `WORK_LINKS` for transport domains + "required" resolve prompt.

- [ ] Browser check with stubbed data at desktop + 375 px; no console errors.

### Task 5: Proposals and vendor letter, ship

- [ ] Blackbox letter (vault), proposals live on Owner page, vault project note `work/active/transport-optimisation.md`.
- [ ] Independent review (code-review), deploy coordinator + office, push, live check.
