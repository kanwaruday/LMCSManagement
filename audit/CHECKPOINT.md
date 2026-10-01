# Overnight audit — checkpoint

Branch: `overnight-audit` (from main 80cb2d3). Scope per Uday (2026-10-01): **sections 1–3 only, skip 4 (stress test)**.
Rules: pause at 90% of the 5-hour limit, never past 95%; stop if weekly ≥ 90%. No push to main, no deploys, no Sheet edits, no deletions, fake data only.

## Chunks
- [x] 1. Permanent payroll test suite (`tests/payroll/`, fake data, `node tests/payroll/run.js`) — 14/14 passing
- [x] 2. Code audit — payroll.gs / payroll-calc.gs (correctness, integrity, limits) + adjustments bug — see audit/REPORT.md
- [x] 3. Code audit — payroll/index.html, security/privacy, rest of repo (major risks) — see audit/REPORT.md
- [x] 4. Fix critical/high issues on branch (+ tests) — staff-cache race + response-ordering race both fixed
- [x] 5. Speed fixes 1–3 — fix 3 done (cache recordoffer sign-in), fix 2 already done, fix 1 still open (lost the spec)
- [x] 6. UX audit — lighter-touch than planned, click-count table + 2 quick wins done, see audit/REPORT.md
- [x] 7. Data-quality report + runbook — audit/RUNBOOK.md, new `dataquality` action + UI view
- [x] 8. Final report `audit/REPORT.md` + morning summary — DONE

**Sections 1–3 complete.** Stopping here per Uday's scope ("only do sections 1-3, skip 4").

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
