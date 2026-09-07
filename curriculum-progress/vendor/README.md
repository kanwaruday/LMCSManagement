# vendor/

Third-party scripts vendored locally (not loaded from a CDN) so pages here
keep working even if a third-party script host is unreachable, and so the
exact version in use never changes without a deliberate commit.

## exceljs.min.js

- **What**: [ExcelJS](https://github.com/exceljs/exceljs) v4.4.0 browser build (UMD, exposes `window.ExcelJS`).
- **License**: MIT.
- **Source**: `https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js`, downloaded 2026-09-07.
- **Used by**: `cwa-gap-report.html`'s "Export for Coordinator" / "Upload Completed Sheet"
  feature, to generate and read back a real, sheet-protected `.xlsx` file
  (needed for genuine locked cells and native Excel date validation — a
  plain CSV has no concept of either). See the "BULK 'MARK AS TAKEN' VIA
  PROTECTED EXCEL FILE" comment block in that file for the full design.
- **To upgrade**: replace this file with a newer `dist/exceljs.min.js` from
  the same CDN/npm package and update the version/date above. Re-test the
  export → protect → upload round trip (a Node script exercising the same
  functions works fine against this bundle, since it also has a CommonJS
  branch) before deploying.
