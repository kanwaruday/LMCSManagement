# Overnight audit — checkpoint

Branch: `overnight-audit` (from main 80cb2d3). Scope per Uday (2026-10-01): **sections 1–3 only, skip 4 (stress test)**.
Rules: pause at 90% of the 5-hour limit, never past 95%; stop if weekly ≥ 90%. No push to main, no deploys, no Sheet edits, no deletions, fake data only.

## Chunks
- [ ] 1. Permanent payroll test suite (`tests/payroll/`, fake data, `node tests/payroll/run.js`)
- [ ] 2. Code audit — payroll.gs / payroll-calc.gs (correctness, integrity, limits) + adjustments bug
- [ ] 3. Code audit — payroll/index.html, salary/index.html, security/privacy, rest of repo (major risks)
- [ ] 4. Fix critical/high issues on branch (+ tests)
- [ ] 5. Speed fixes 1–3 (preload staff list, payroll copy in parallel on Record, cache recordoffer sign-in)
- [ ] 6. UX audit — flow maps + click counts, quick wins implemented
- [ ] 7. Data-quality report (from public-safe sources only) + runbook
- [ ] 8. Final report `audit/REPORT.md` + morning summary

## Log
