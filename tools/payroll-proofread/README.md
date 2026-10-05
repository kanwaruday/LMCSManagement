# Payroll proofreading workbook

An Excel workbook that recalculates every employee's monthly salary with live formulas, mirroring
`apps-script/payroll.gs` + `payroll-calc.gs` step by step, so each month can be checked line by line.

- `build_workbook.py` — the generator (column definitions = the formulas; each has a plain-English description, its data source, and the backend function it mirrors).
- `build.py` — builds a real workbook from local CSV exports. **Never commit the output: it contains real salaries.**
- `verify.py` — proof: for random fake organisations it recalculates the workbook in LibreOffice and compares every money column of every employee, over 5 months, with the real backend (`dump_backend.js` runs the actual `.gs` files). Run `python3 tools/payroll-proofread/verify.py 1 2 3` (needs `soffice` and `node`).

When the backend's calculation changes, change the matching column here and re-run `verify.py`.
