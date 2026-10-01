# Overnight audit — checkpoint

Branch: `overnight-audit` (from main 80cb2d3). Scope per Uday (2026-10-01): **sections 1–3 only, skip 4 (stress test)**.
Rules: pause at 90% of the 5-hour limit, never past 95%; stop if weekly ≥ 90%. No push to main, no deploys, no Sheet edits, no deletions, fake data only.

## Chunks
- [x] 1. Permanent payroll test suite (`tests/payroll/`, fake data, `node tests/payroll/run.js`) — 13/13 passing, stable across 8 repeat runs
- [ ] 2. Code audit — payroll.gs / payroll-calc.gs (correctness, integrity, limits) + adjustments bug
- [ ] 3. Code audit — payroll/index.html, salary/index.html, security/privacy, rest of repo (major risks)
- [ ] 4. Fix critical/high issues on branch (+ tests)
- [ ] 5. Speed fixes 1–3 (preload staff list, payroll copy in parallel on Record, cache recordoffer sign-in)
- [ ] 6. UX audit — flow maps + click counts, quick wins implemented
- [ ] 7. Data-quality report (from public-safe sources only) + runbook
- [ ] 8. Final report `audit/REPORT.md` + morning summary

## Log

### Chunk 1 (done, commit 3d9d4f1)
- `tests/payroll/{harness,fixtures,test-flows,run}.js`. Harness runs apps-script/payroll.gs
  then payroll-calc.gs via `vm` in Apps Script's load order, with in-memory fakes of
  SpreadsheetApp/CacheService/LockService/Utilities/UrlFetchApp/ContentService. Fixture is a
  10-person fake org, 7 schools, covering full/half/unmapped vacation rules, EPF member/non-member,
  LMS6 (unregistered), 20+yr gratuity-eligible, probationer, Staff-Child Tuition.
- **Found + fixed a real bug** while making the test deterministic: `payStaffChanged_()` used
  `Date.now()` as the staff-changes cache-busting token. Two staff-changing writes in the same
  millisecond (recordoffer immediately followed by joinoffer/markleft, which is exactly the
  "add someone then act on them in the same minute" owner workflow) produced the same token, so
  the second write's own `payMonth_` call read the first write's now-stale cached staff list —
  e.g. a just-joined offer could still show as a pending offer. Fixed: counter instead of
  timestamp (safe — every caller already holds the script lock). Covered by the
  "staff changes" test, which is flaky-without-the-fix / stable-with-it (verified 8/8 runs).
- Usage after chunk 1: 5-hour 28%, weekly 64%. Proceeding to chunk 2.
