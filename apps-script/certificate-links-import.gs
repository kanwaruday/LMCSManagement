// ═══════════════════════════════════════════════════════════════════
// Employee Certificate Links importer -- writes Drive links for employee
// certificate files (matched against the live roster by a local script,
// drive-index/build_employee_cert_links.py in the LMCSManagement repo)
// into their OWN tab in this same Employee Master workbook.
//
// Run importCertificateLinks() manually from the Apps Script editor to
// (re)populate the "Certificate Links" tab. Safe to rerun any time --
// it clears and rewrites only that one tab, never touching EmpMaster,
// EmpPersonal, EmpAcademic or EmpSalary, so it can't break anything
// those sheets' fixed column positions depend on.
//
// CERT_LINKS_DATA is regenerated (not hand-edited) by running, from the
// repo root:
//   python3 drive-index/build_employee_cert_links.py
//   python3 drive-index/generate_appscript_import.py
// Generated 692 rows on 2026-09-24. Uses the existing STAFF_EMP_SHEET_ID
// constant from staff-management-api.gs (same project, same workbook).
// ═══════════════════════════════════════════════════════════════════

const CERT_LINKS_TAB = 'Certificate Links';

const CERT_LINKS_DATA = [
 {
  "employeeCode": "KUL/20/02/067",
  "employeeName": "ARPNA SOOD",
  "school": "LMS 1",
  "category": "BACHELORS CERTIFICATE",
  "filename": "ARPNA GRADUATION - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1ZxRGK023hSCQ2ufsy4mBuQ0cfj_0aFcs/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/20/02/067",
  "employeeName": "ARPNA SOOD",
  "school": "LMS 1",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Arpna 10th - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1gLNlDzbP__RkYE-HONw0sblsBJMqqEmZ/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/20/02/067",
  "employeeName": "ARPNA SOOD",
  "school": "LMS 1",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "ARPNA 12TH - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/11xN1wc35QMtVjbAX_VLopm7HU3_opy1D/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/20/02/067",
  "employeeName": "ARPNA SOOD",
  "school": "LMS 1",
  "category": "MASTER CERTIFICATE",
  "filename": "Arpna masters - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/11Hp3OKblc8xwU-ma0vc20xDdjVZvHoiM/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/20/02/067",
  "employeeName": "ARPNA SOOD",
  "school": "LMS 1",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Arpna medical - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1u5JZWdtfAWCRpaIXMbSeidijbKm_Tofk/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/20/02/067",
  "employeeName": "ARPNA SOOD",
  "school": "LMS 1",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Arpna Character - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1h7w5_bPSyPX6JN9GptK_oUDuA22m53mT/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/20/02/067",
  "employeeName": "ARPNA SOOD",
  "school": "LMS 1",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "ARPNA BEd - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1wK7BB9LgjKBh_7CoZxJVxZSFLR0qxMvX/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "BACHELORS CERTIFICATE",
  "filename": "BA - Jai Chand (1).pdf",
  "url": "https://drive.google.com/file/d/1dl1ZWMtYlw33xSg8pSxuf07CRi_dc7ux/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "BACHELORS CERTIFICATE",
  "filename": "BA - Jai Chand (2).pdf",
  "url": "https://drive.google.com/file/d/1Zp0cbiE5xQGRdQ-mRfoSutJp3BheTouv/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "BACHELORS CERTIFICATE",
  "filename": "BA - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/14GF3fW2ksu2zEoE5CILNr02c3ZYTwvVg/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "BACHELORS CERTIFICATE",
  "filename": "NA - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1fMThqi6atGZYN19dNjZZAh0vUeYQrrvW/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "10 - Jai Chand (1).pdf",
  "url": "https://drive.google.com/file/d/1Tkh4tD7xjD-D9m0cphTbzn_hPw3NEKte/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "10 - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1YAU1B-Wkc14u2zkwGr_Vg0b0N7qgI811/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "10TH - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1pMkdHNoeM7O7qDVWHgiuK4H7h15qhcS6/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Document 197 (1) - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1FBjsty089LUJtJ8I-My8VSOUysUYNsY-/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "12 - Jai Chand (1).pdf",
  "url": "https://drive.google.com/file/d/1nDXAeNAJyQwcfT5yOdQsalECuZN8NX66/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "12 - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1DVjjYytQLNXiW3iyRML-OUCt70cR-ZSH/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Document 197 (2) - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1xKVCmBMCxDmpEWtCERzfeEf_BF9CR8YF/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "HIGHEST QUALIFICATION",
  "filename": "12 - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/16pS_y8jOtZ5pa0Jdq7HoLo2i58FA1-bO/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "HIGHEST QUALIFICATION",
  "filename": "SLC - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1W3u3ILTUeaqTo0hnzkrXAjzoTI_LvPSn/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "HIGHEST QUALIFICATION",
  "filename": "SLC 8 - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1WBxSQaZDa_Pica_eJjFkGY38-ARKsYQV/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "MASTER CERTIFICATE",
  "filename": "Document 193 - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1hFt6e6P9uJ15xjhEOcFJ3UtSc5Y7SCqk/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "MASTER CERTIFICATE",
  "filename": "Document 206 - Jai Chand (1).pdf",
  "url": "https://drive.google.com/file/d/1T0qTSGmcdjGRosGBcChEDE9kZGb-r8eN/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "MASTER CERTIFICATE",
  "filename": "Document 206 - Jai Chand (2).pdf",
  "url": "https://drive.google.com/file/d/1IYS_MhL8RngKbv-ZZwL0HJH3mqekYx2H/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "MASTER CERTIFICATE",
  "filename": "Document 206 - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1xy0qY2qnfYvJogWMRtR2Rb9apY6Sh8S7/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "MASTER CERTIFICATE",
  "filename": "Document 208 - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1-JL7pSaeNJxT6rUr7SFpUmkoCBM_lUfJ/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "MASTER CERTIFICATE",
  "filename": "MA - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1tKb2L71tzhU1pxFXWrA-PYseJkLCRB7u/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "MASTER CERTIFICATE",
  "filename": "NA - Jai Chand (1).pdf",
  "url": "https://drive.google.com/file/d/16vW2y5A2uiQ3DBX2I4Bo5tvwzpyWbAIe/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "MASTER CERTIFICATE",
  "filename": "NA - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1q7rJUHi_RiwT_lZaJWjFl6qrPs-x7zjm/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "MEDICAL CERTIFICATE",
  "filename": "CHEQUE - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1vFH8cXle6qAYz6tu6imLKbev0XWdG67d/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "MEDICAL CERTIFICATE",
  "filename": "MEDICAL - Jai Chand (1).pdf",
  "url": "https://drive.google.com/file/d/1HFFERrw8DT74s0xCB36uDg_GSkG7iCj7/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "MEDICAL CERTIFICATE",
  "filename": "MEDICAL - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1WT5cYnMMroa94rWHnXNQjvUUFoXD4Xis/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Document 204 - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1KSIXwUNoGgwLPcZ5eQ2MP6KbqVPaKeRV/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Document 210 - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1p1_wOGolhyjE1WDKK3xRx1QR9TwCWrIf/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Document 216 (1) - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1tIBP8qfYyrfTXDUFuq6ia30yA69q4vcJ/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "MEDICAL CERTIFICATE",
  "filename": "MEDICAL - Jai Chand (1).pdf",
  "url": "https://drive.google.com/file/d/1BzLRAwIhJrfjNCSERTiOwNqLj1CJY2wx/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "MEDICAL CERTIFICATE",
  "filename": "MEDICAL - Jai Chand (3).pdf",
  "url": "https://drive.google.com/file/d/1wMIqK2fWIdAT8W0DaU-Sz2d8FfOkR1h1/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "MEDICAL CERTIFICATE",
  "filename": "MEDICAL - Jai Chand (4).pdf",
  "url": "https://drive.google.com/file/d/13iN_R_RpyTkzcoEJ57G2AhTT8VZ41E5p/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "MEDICAL CERTIFICATE",
  "filename": "MEDICAL - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1fWYyfSjhoBtNgQNOoQRczvyvfow2FO4d/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "MEDICAL CERTIFICATE",
  "filename": "medical - Jai Chand (2).pdf",
  "url": "https://drive.google.com/file/d/1ZLOEgofxlJlfHYUidVQLkHeRBDiApcty/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "CHARACTER - Jai Chand (1).pdf",
  "url": "https://drive.google.com/file/d/1efobLGPpDoS0bAeYkPZhxuj5vHk3Cm8T/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "CHARACTER - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1G7-e6pb3lB1aAXpsF7cbMlQh3NtKiF9N/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "character - Jai Chand (2).pdf",
  "url": "https://drive.google.com/file/d/1_lDfb2p1tw8ZgEEgRpxWdmkebujJ0Cn5/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "CHARACTER - Jai Chand (2).pdf",
  "url": "https://drive.google.com/file/d/1tJCiiIRZ-kQqyiWUfKOJBPdYNUABQPN_/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "CHARACTER - Jai Chand (3).pdf",
  "url": "https://drive.google.com/file/d/1q0YCZgQ2F8GBDJEIoY9x5aH8tfuEwp4o/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "CHARACTER - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1kI4eeiPvsdHclb50mcJmxtNy_XDOQcm4/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "DOC-20260604-WA0024 - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/13gobgpqfRv_-QgeunQhy3qoFkiaAfBWb/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "character - Jai Chand (1).pdf",
  "url": "https://drive.google.com/file/d/1mG82CxAnM5aZkqePs8g_nC_dRnKoToo5/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "B ED - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1AKLwsQ-rUMcIzb0p5dDmgXeTCGCdecTT/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "BP ED - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1UUVEkOhEVoaucbOuwBLmiCoEOjG4E9b_/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "NA - Jai Chand (1).pdf",
  "url": "https://drive.google.com/file/d/1gtXlmBKCPuTDBIFhL9iNfheTgSuWqGhT/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "NA - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1vGpEDxsgrGw93EWbJLHz1PqADemH4gnC/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/98/02/070",
  "employeeName": "JAI CHAND",
  "school": "LMS 1",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "b ed - Jai Chand (1).pdf",
  "url": "https://drive.google.com/file/d/1nuLFrP7rYcLCGsEIZtNOYXJO0vfATLU-/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "KUL/23/04/082",
  "employeeName": "NEERJA  PRASHAR",
  "school": "LMS 1",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Neerja graduation - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1CszI2al9Vj71OApQxEQjvz96OHfRdAT3/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/23/04/082",
  "employeeName": "NEERJA  PRASHAR",
  "school": "LMS 1",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Neerja 10th - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1tuCd_lFhkFJJvr-kdzwQRMvXO2iiWY-M/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/23/04/082",
  "employeeName": "NEERJA  PRASHAR",
  "school": "LMS 1",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Neerja 12th - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1onQpk8P-e_Wi8uxmQCAiEkzBic6eEYn8/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/23/04/082",
  "employeeName": "NEERJA  PRASHAR",
  "school": "LMS 1",
  "category": "MASTER CERTIFICATE",
  "filename": "Neerja PGDCA - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1HrFv4klW-rtYdPvQrzAvG5Bu1ecStmUz/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/23/04/082",
  "employeeName": "NEERJA  PRASHAR",
  "school": "LMS 1",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Neerja character - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1nOYy0_B-eSxCxumQpYu2RrIB7YLcAS3L/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/23/04/082",
  "employeeName": "NEERJA  PRASHAR",
  "school": "LMS 1",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Neerja D.El.Ed - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/15_CELPEYEyprEwcdDw8Jvdk7fecLynt0/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/18/10/069",
  "employeeName": "PALLVI GAUTAM",
  "school": "LMS 1",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Pallavi graduation - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1LQbcD32KRa0iUxhnGw6NRPziTB0LJH3R/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/18/10/069",
  "employeeName": "PALLVI GAUTAM",
  "school": "LMS 1",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Pallavi 10th - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1oTW9LLr3TNPlS8rAGmBzfpVEmGu2ZpDY/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/18/10/069",
  "employeeName": "PALLVI GAUTAM",
  "school": "LMS 1",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Pallavi 12th - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1ss9r6EV7WLxW6wpa2-g2shQGAn9d5b6j/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/18/10/069",
  "employeeName": "PALLVI GAUTAM",
  "school": "LMS 1",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Pallavi character - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1gM7dz5so31nrsAaYGwWk9eVaORq-Xydj/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/18/10/069",
  "employeeName": "PALLVI GAUTAM",
  "school": "LMS 1",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Pallavi professional - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1oAunatq1nsqScLLDLVDGu0X1mJbfLbgS/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/20/02/065",
  "employeeName": "SANGEETA SINGH",
  "school": "LMS 1",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Sangeeta graduation - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1XEHljlh164HZ2m8fPWkD51jo4IxAvpc2/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/20/02/065",
  "employeeName": "SANGEETA SINGH",
  "school": "LMS 1",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Sangeeta 10th - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1HM-eOQw-u2ggsPDEE9_eHImyLDdqnc4e/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/20/02/065",
  "employeeName": "SANGEETA SINGH",
  "school": "LMS 1",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Sangeeta 12th - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1At3oI_6FgF__c-CpyunNNqlR4ug3EpLc/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/20/02/065",
  "employeeName": "SANGEETA SINGH",
  "school": "LMS 1",
  "category": "MASTER CERTIFICATE",
  "filename": "Sangeeta graduation - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/102ZUAe42hCP50FrHp4soULPUSX5S94Cc/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/20/02/065",
  "employeeName": "SANGEETA SINGH",
  "school": "LMS 1",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Sangeeta medical - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1tLY8w6Syk9HSYULRlxT9gzJ9fqnl55jE/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/20/02/065",
  "employeeName": "SANGEETA SINGH",
  "school": "LMS 1",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Sangeeta character - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1JPVnPDuvzqpUCXgMnqQfs73BAO7RUzZZ/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/20/02/065",
  "employeeName": "SANGEETA SINGH",
  "school": "LMS 1",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Sangeeta BEd - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1KhnZAkbxB-8bA033dZJHTHAtXxIW2YKA/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/05/03/005",
  "employeeName": "SHAILLY BHOPAL",
  "school": "LMS 1",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Shailly graduation - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1StX11S8t6uxWbKKwKXFPkq8-Okg6fAro/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/05/03/005",
  "employeeName": "SHAILLY BHOPAL",
  "school": "LMS 1",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "shailly 10th - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1xV_vFWlfemEaPLi8kUx2dTQjLEPuXdXT/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/05/03/005",
  "employeeName": "SHAILLY BHOPAL",
  "school": "LMS 1",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "shaily 12th - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1Q_fTVm_cTHwx6rWnszqGjl1Ebm0meNWx/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/05/03/005",
  "employeeName": "SHAILLY BHOPAL",
  "school": "LMS 1",
  "category": "MEDICAL CERTIFICATE",
  "filename": "shaily medical - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1w0P2J_3BbAxcSk7mlzvbpkfARd06oCp9/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/05/03/005",
  "employeeName": "SHAILLY BHOPAL",
  "school": "LMS 1",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "shelly Character - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1lIVFqS1-MbVxZ1qZWOpgdSrKl5qwULlV/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/05/03/005",
  "employeeName": "SHAILLY BHOPAL",
  "school": "LMS 1",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "shaily BEd - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1d029nzq8nRsbzIgpIkCAiCxOWFHmSGHX/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/17/08/042",
  "employeeName": "SHEETAL TANDON",
  "school": "LMS 1",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Sheetal graduation - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1vOIyoWCpos_8vgl8RSnIhfZFLafA8qIo/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/17/08/042",
  "employeeName": "SHEETAL TANDON",
  "school": "LMS 1",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Sheetal 10th - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1TW1irgywp9gt0XsY56oTgH_5RDze8TTF/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/17/08/042",
  "employeeName": "SHEETAL TANDON",
  "school": "LMS 1",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Sheetal 12th - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1u4iixVpu_hs8hYogBq-Rr91z7Kms0bo6/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/17/08/042",
  "employeeName": "SHEETAL TANDON",
  "school": "LMS 1",
  "category": "MEDICAL CERTIFICATE",
  "filename": "sheetal medical - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1Sl8DzsRe-NFnJYgSW3cqPOTlLUZCT4Vv/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/17/08/042",
  "employeeName": "SHEETAL TANDON",
  "school": "LMS 1",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "sheetal charector - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/19PkRA5oh5_vwgtw7Ngv0AY6m0KQLmQpp/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/17/08/042",
  "employeeName": "SHEETAL TANDON",
  "school": "LMS 1",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Sheetal NTT - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1OTHJg6mZwZ-W-0P5OI8tKkyXFO0MQBJe/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/23/08/086",
  "employeeName": "SHELJA THAKUR",
  "school": "LMS 1",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Shelja1 graduation - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1IdXzmuq2_X6Ju93IGNO7rJAVPXmhluw1/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/23/08/086",
  "employeeName": "SHELJA THAKUR",
  "school": "LMS 1",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "shelja 1 10th - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1lDGSFqwOrYMshqDobe8lrVRFkiJguMy-/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/23/08/086",
  "employeeName": "SHELJA THAKUR",
  "school": "LMS 1",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Shelja1 12th - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1haZodsD6WDUrCw_dJsXC8S8tNZTqaog-/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/23/08/086",
  "employeeName": "SHELJA THAKUR",
  "school": "LMS 1",
  "category": "MASTER CERTIFICATE",
  "filename": "shelja1 masters - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1Ofm16_uuJwOOod5KbpnEy24FjrF3hw0l/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/13/04/028",
  "employeeName": "VEENA DEVI",
  "school": "LMS 1",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Veena graduation - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1TYYqiwLV-M5kEmuMhdmS8UoPuykIJl-A/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/13/04/028",
  "employeeName": "VEENA DEVI",
  "school": "LMS 1",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Veena 10th - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1k1dyvI9NNzV29wgOZrGX8D1ai4EKsOSl/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/13/04/028",
  "employeeName": "VEENA DEVI",
  "school": "LMS 1",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Veena 12th - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1VINQxHfMgfEdjJTNILKlACVepRHUGXkF/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/13/04/028",
  "employeeName": "VEENA DEVI",
  "school": "LMS 1",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Veena medical - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1PT-Z6EWDXATsojDvzpCx7yKzt0MOi3xS/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/13/04/028",
  "employeeName": "VEENA DEVI",
  "school": "LMS 1",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Veena character - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1horQ4kpEJ6syhXm7eLH1bWAMVb6sbYiT/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/13/04/028",
  "employeeName": "VEENA DEVI",
  "school": "LMS 1",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Veena BEd - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1dAYNpDF_LzkwER7fQPZgVVZMFYI5Yh9q/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/24/02/090",
  "employeeName": "SAURABH SHARMA",
  "school": "LMS 1",
  "category": "BACHELORS CERTIFICATE",
  "filename": "saurabh graduation - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1gBc1nn01UgzTW9MhJu0Iyaqpk6WcI_qP/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/24/02/090",
  "employeeName": "SAURABH SHARMA",
  "school": "LMS 1",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "saurabh 10th - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1fNWWYvwlQ4lDQmMpuB9l9plZ1KRqH8dp/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/24/02/090",
  "employeeName": "SAURABH SHARMA",
  "school": "LMS 1",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "saurabh 12th - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1WfTaUJOrV-vDPbTqAKT3oMBxthB8OLRj/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/24/02/090",
  "employeeName": "SAURABH SHARMA",
  "school": "LMS 1",
  "category": "MASTER CERTIFICATE",
  "filename": "saurabh masters - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/18GeGLeDy2jJoHz_R0SRyhrQRch1uwC5Z/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/24/02/090",
  "employeeName": "SAURABH SHARMA",
  "school": "LMS 1",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "saurabh character - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/13YdrMLQZ8vVbapxXgaQUALfKjkYTy-A0/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/24/02/090",
  "employeeName": "SAURABH SHARMA",
  "school": "LMS 1",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "saurabh BEd - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/10iD-IZtbpluy_K2HlaYpW9jkyJ-rwxy8/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/23/10/089",
  "employeeName": "SOLMA DEVI",
  "school": "LMS 1",
  "category": "BACHELORS CERTIFICATE",
  "filename": "solma graduation - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1i1x8WpFmhLAZ-yeCq6IZgp_hWkcvgVtk/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/23/10/089",
  "employeeName": "SOLMA DEVI",
  "school": "LMS 1",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "solma 10th - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1qzEtyJOlfz5qi9OPBlscZTvZJ-MRF_vI/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/23/10/089",
  "employeeName": "SOLMA DEVI",
  "school": "LMS 1",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "solma 12th - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1mfiLUA7rwcVqv_3m0rmT6T0YVC003WG6/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/23/10/089",
  "employeeName": "SOLMA DEVI",
  "school": "LMS 1",
  "category": "MASTER CERTIFICATE",
  "filename": "solma masters - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1GGCQhEfO6XfhqF6PHgT7a7Sn7W8OXAH6/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/23/10/089",
  "employeeName": "SOLMA DEVI",
  "school": "LMS 1",
  "category": "MEDICAL CERTIFICATE",
  "filename": "solma medical - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1RWLP34hYQvRpGTS1bNpdihLYYQMLUjon/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/23/10/089",
  "employeeName": "SOLMA DEVI",
  "school": "LMS 1",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "solma character - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1KEJh8Df_9ubmv4aINmnc2wZLqnDXpngN/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/23/10/089",
  "employeeName": "SOLMA DEVI",
  "school": "LMS 1",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "solma BEd - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1QMAPd4l3k3SOaqhg0NBvbLqu607gGaVX/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KUL/24/04/091",
  "employeeName": "MONIKA",
  "school": "LMS 1",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Monika 12th - Jai Chand.pdf",
  "url": "https://drive.google.com/file/d/1qAUKxohuA30krU8a6E6w5RKeJS2A3YXF/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/24/06/114",
  "employeeName": "NIDHI SINGH",
  "school": "LMS 2",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Nidhi Singh graduation - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1j13nlTtonUY91MCGzh5t3vdtWmcMSvGv/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/24/06/114",
  "employeeName": "NIDHI SINGH",
  "school": "LMS 2",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Nidhi s 10th - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/11-ST2bqVI_9zbDSjfNax77zYaN5Q9Hp2/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/24/06/114",
  "employeeName": "NIDHI SINGH",
  "school": "LMS 2",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Nidhi s 12th - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1xTVV0mJJLXxqcLB_RbSwmIAnq1GbMwpL/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/24/06/114",
  "employeeName": "NIDHI SINGH",
  "school": "LMS 2",
  "category": "MASTER CERTIFICATE",
  "filename": "Nidhi s Masters - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/15qSgcqFAZDr5_FSEKE1JBBKfCocaWFyO/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/24/06/114",
  "employeeName": "NIDHI SINGH",
  "school": "LMS 2",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Nidhi s Medical - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1h6TeR4XkuY8pElKbV0PqW0-i4RfbXIRQ/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/24/06/114",
  "employeeName": "NIDHI SINGH",
  "school": "LMS 2",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Nidhi s character - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1Gyb7fRs7Q6LIhd0NrPkbmjvpXiWQlTmJ/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/24/06/114",
  "employeeName": "NIDHI SINGH",
  "school": "LMS 2",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Nidhi s B.Ed - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1iYejuRewUxsIevZmpj8ac5GD4lvCha7V/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/11/03/019",
  "employeeName": "SEEMA KAPOOR",
  "school": "LMS 2",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Seema graduation - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1MXWhixTx9HTdoGXbUFjLaxDRquJHfQ7s/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/11/03/019",
  "employeeName": "SEEMA KAPOOR",
  "school": "LMS 2",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Seema 10th - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1NYpDRWiQsgNVZ23FueDXawi1k022t_pG/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/11/03/019",
  "employeeName": "SEEMA KAPOOR",
  "school": "LMS 2",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Seema 12th - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1pPosDcfUkDkJ-9NNnQPGAHXSDD31q2vY/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/11/03/019",
  "employeeName": "SEEMA KAPOOR",
  "school": "LMS 2",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Seema medical - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1CkbI_Smn-8h8OryqwAe7J-gIn0ldBZ8_/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/11/03/019",
  "employeeName": "SEEMA KAPOOR",
  "school": "LMS 2",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Seema character - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1fPedokG-rOFnpWK2ZAuQZF4sshbG29W7/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/11/03/019",
  "employeeName": "SEEMA KAPOOR",
  "school": "LMS 2",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Seema BE.d - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1BQsEVZWMyMmdy_E3QCagpJjCSYHzPy7K/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/20/11/080",
  "employeeName": "TAMANNA SHARMA",
  "school": "LMS 2",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Tamanna graduation - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1CZzAngR54yD-d9pLmtUuJRTSsCfSz8aq/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/20/11/080",
  "employeeName": "TAMANNA SHARMA",
  "school": "LMS 2",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Tamanna 10th - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/18hU5PN0CmKa6_lT_UsqCDnvZ2YbZdmMB/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/20/11/080",
  "employeeName": "TAMANNA SHARMA",
  "school": "LMS 2",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Tamanna 12th - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1i-BgXpffzpjD5WixzFhIGnsTmzDx2RF7/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/20/11/080",
  "employeeName": "TAMANNA SHARMA",
  "school": "LMS 2",
  "category": "MASTER CERTIFICATE",
  "filename": "Tamanna Masters - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1Vsg5z3FvYDu4E45ulKTpDAiHU5dVXsnC/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/20/11/080",
  "employeeName": "TAMANNA SHARMA",
  "school": "LMS 2",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Tamanna medical - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1p3RhxzjIMenEdiX5TCE6i-cBavxar1tG/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/20/11/080",
  "employeeName": "TAMANNA SHARMA",
  "school": "LMS 2",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Tamanna character - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1_8Da1BkijQsmrq-bd5FbVD9RV0G9SuH1/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/20/11/080",
  "employeeName": "TAMANNA SHARMA",
  "school": "LMS 2",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Tamanna BEd - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1UNA-e-ksA8JE-pWTDNxecpy2b9qu_yzV/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/24/09/119",
  "employeeName": "SAMRITI",
  "school": "LMS 2",
  "category": "BACHELORS CERTIFICATE",
  "filename": "samriti graduation - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1_s_R2bLSmkHVYIdHuGaL0hCMvElQuzi7/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/24/09/119",
  "employeeName": "SAMRITI",
  "school": "LMS 2",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "samriti 10th - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1wwgy0Vy32f595CrdCfSkA0-_LBG9-qiL/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/24/09/119",
  "employeeName": "SAMRITI",
  "school": "LMS 2",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "samriti 12th - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1RpeIks5nRjhyG7d_vmwvx31BUCYy-AO0/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/24/09/119",
  "employeeName": "SAMRITI",
  "school": "LMS 2",
  "category": "MASTER CERTIFICATE",
  "filename": "samriti masters - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/13V3ta7GiDq509yyuUXYP01MQGvHP_5Un/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/24/09/119",
  "employeeName": "SAMRITI",
  "school": "LMS 2",
  "category": "MEDICAL CERTIFICATE",
  "filename": "samriti medical - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1kB-z9h-u1uc4quGgfUH7lpjkvBLRjCqL/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/24/09/119",
  "employeeName": "SAMRITI",
  "school": "LMS 2",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "samriti character - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1cty2OhXiZTspx4LIIzr6pxPTv-1mfO6s/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/24/09/119",
  "employeeName": "SAMRITI",
  "school": "LMS 2",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "samriti B.Ed - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/128YNfpaDolkgP1b9taslxu01aajF9HRy/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/18/02/055",
  "employeeName": "TAPSYA SHARMA",
  "school": "LMS 2",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Tapsya Graduation - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1AzYBteuOH7Yj12PSdZ5KD8Rz3nZ2n2Bt/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/18/02/055",
  "employeeName": "TAPSYA SHARMA",
  "school": "LMS 2",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Tapsya 10th - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1x2Pae3Z0OwFYPm0RR0iDL5w3024ojYcs/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/18/02/055",
  "employeeName": "TAPSYA SHARMA",
  "school": "LMS 2",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Tapsya 12th - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1HSp_odCjpPEzKh3OWzHo1k32mizA7vnD/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/18/02/055",
  "employeeName": "TAPSYA SHARMA",
  "school": "LMS 2",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Tapsya medical - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1if_0k_39wPGYbwXz3xA5Uap9_xIhWvyl/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/18/02/055",
  "employeeName": "TAPSYA SHARMA",
  "school": "LMS 2",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Tapsya character - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1ZpTRYivq-HUrf7cnCtX8JC7OQRL5n8mw/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/18/02/055",
  "employeeName": "TAPSYA SHARMA",
  "school": "LMS 2",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Tapsya NTT - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1JUDx9IUHm6knvebEQGBiLCBWIPEn80uS/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/22/11/094",
  "employeeName": "AAYUSHI THAKUR",
  "school": "LMS 2",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Aayushi graduation - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/19s4z9lw15zUH12svcKIyut6K683Zg3pr/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/22/11/094",
  "employeeName": "AAYUSHI THAKUR",
  "school": "LMS 2",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Aayushi 10th - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1IMU1SJb7zjoxPNid8XP_gscRF3ljYI6x/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/22/11/094",
  "employeeName": "AAYUSHI THAKUR",
  "school": "LMS 2",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Aayushi 12th - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/13KHQb8VYVsu5d8npxZMymyqT76qOrAvJ/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/22/11/094",
  "employeeName": "AAYUSHI THAKUR",
  "school": "LMS 2",
  "category": "MASTER CERTIFICATE",
  "filename": "Aayushi masters - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1fgYOzs6jsCA3VBIfPZuX6L7URyBHTIFO/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/22/11/094",
  "employeeName": "AAYUSHI THAKUR",
  "school": "LMS 2",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Aayushi medical - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1WXqtAgzEd0gjmTC4W_QeWKcdvmUOGCaJ/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/22/11/094",
  "employeeName": "AAYUSHI THAKUR",
  "school": "LMS 2",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Aayushi character - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1tucWSlguvMN2iTrl6tSULI_5CNlFE6-f/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/22/11/094",
  "employeeName": "AAYUSHI THAKUR",
  "school": "LMS 2",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Aayushi B.Ed - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1zLME4IuPlZx-w-2HmvopkNCVbHQw_1Af/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/05/04/005",
  "employeeName": "ANUPAMA SHARMA",
  "school": "LMS 2",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Anupama graduation - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1GTUZcKj8kHjvspPQs5qaeMfkcoAwshIy/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/05/04/005",
  "employeeName": "ANUPAMA SHARMA",
  "school": "LMS 2",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Anupama 10th - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1jIz11-LDNIqKtNeIYMlvwtz45jMxO6d9/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/05/04/005",
  "employeeName": "ANUPAMA SHARMA",
  "school": "LMS 2",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Anupama 12th - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1CKhe2C7I_t0jU8UU8LXqfLHRom7A52C6/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/05/04/005",
  "employeeName": "ANUPAMA SHARMA",
  "school": "LMS 2",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Anupama medical - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1Wp7gJDrte1zX6B5D-8-5wvTSCDj5PlFd/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/05/04/005",
  "employeeName": "ANUPAMA SHARMA",
  "school": "LMS 2",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Anupama character - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1XC_AcDcf5rBLlphtkIa6M4uCyozLLw5x/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/05/04/005",
  "employeeName": "ANUPAMA SHARMA",
  "school": "LMS 2",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Anupama B.Ed - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1lRM8O_zJpKr1x4Mrf6iNYHZbrkFwSWEv/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/23/09/105",
  "employeeName": "BANDNA KUMARI",
  "school": "LMS 2",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Bandna graduation - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1RP9GRB3AOQiMFmVxYbngVLgBLo570b4M/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/23/09/105",
  "employeeName": "BANDNA KUMARI",
  "school": "LMS 2",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Bandna 10th - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1I8_3H6JaTYkvNTfp21C3guJU7h_j6ryW/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/23/09/105",
  "employeeName": "BANDNA KUMARI",
  "school": "LMS 2",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Bandna 12th - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1LgWRaSeJMO-f82JzwJmVBSMjAFqk-EKA/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/23/09/105",
  "employeeName": "BANDNA KUMARI",
  "school": "LMS 2",
  "category": "MASTER CERTIFICATE",
  "filename": "Bandna Masters copy - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1sJTtROV5BI23sFCx8WiAAcySSaL9ikuF/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/23/09/105",
  "employeeName": "BANDNA KUMARI",
  "school": "LMS 2",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Bandna Medical - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1SFSGAynKfPOsqmmo-Th9IlucA2y-Gmye/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/23/09/105",
  "employeeName": "BANDNA KUMARI",
  "school": "LMS 2",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Bandna character - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/19G2QBmJkXyzARPSbWYpDKHTkR41kgcnj/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/23/09/105",
  "employeeName": "BANDNA KUMARI",
  "school": "LMS 2",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Bandna BEd,MBA copy - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1P6gP8QMV5ENWSQDvbqbzvQcavo40cGbc/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/14/08/041",
  "employeeName": "DEEPSHIKHA MUKHERJEE",
  "school": "LMS 2",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Deepshikha graduation - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1-gUs7t2DPF8JvJvau4VK-4P2L76GWzG3/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/14/08/041",
  "employeeName": "DEEPSHIKHA MUKHERJEE",
  "school": "LMS 2",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Deepshikha 10th - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1AtBI8wWP8jEvgdeAubHd-f3pScU_m3C3/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/14/08/041",
  "employeeName": "DEEPSHIKHA MUKHERJEE",
  "school": "LMS 2",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Deepshikha 12th - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/11M6cuYb6ZMcUm-kCq9tjl3VUu5Bu0fuo/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/14/08/041",
  "employeeName": "DEEPSHIKHA MUKHERJEE",
  "school": "LMS 2",
  "category": "MASTER CERTIFICATE",
  "filename": "Deepshikha masters - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1CqibWumiHMS0SchBFMgdK0m_25LPgoGk/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/14/08/041",
  "employeeName": "DEEPSHIKHA MUKHERJEE",
  "school": "LMS 2",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Deepshikha medical - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1_EFUEmyQaQsPB209spOZBWhlSHe04qc5/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/14/08/041",
  "employeeName": "DEEPSHIKHA MUKHERJEE",
  "school": "LMS 2",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "DEEPSHIKHA CHARACTER - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1YZX4jHCBEQqp3RErw-QHSpQJV-o6TT3F/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/14/08/041",
  "employeeName": "DEEPSHIKHA MUKHERJEE",
  "school": "LMS 2",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Deepshikha Dl.Ed - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1s_L0J7v96DYPiph7OOBCvxvqNNx4CSyk/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/19/03/072",
  "employeeName": "HARSHA SOOD",
  "school": "LMS 2",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Harsha graduation - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1ycEiX5y3l-cRJYqSUM3rEUguTu8FSkEO/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/19/03/072",
  "employeeName": "HARSHA SOOD",
  "school": "LMS 2",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Harsha 10th - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1gW6S4IYx_OU9vwQb09pA9yhKNhmTTVdH/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/19/03/072",
  "employeeName": "HARSHA SOOD",
  "school": "LMS 2",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Harsha 12th - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1BA6le75pRETUVMbHT73X9NI-HITR7xsQ/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/19/03/072",
  "employeeName": "HARSHA SOOD",
  "school": "LMS 2",
  "category": "MASTER CERTIFICATE",
  "filename": "Harsha masters - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/13VySnG9SV0uKN2KVZ8Ks9G5R3ncWF_DA/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/19/03/072",
  "employeeName": "HARSHA SOOD",
  "school": "LMS 2",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Harsha medical - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1UdfcZGE2GsQuQ5sPkcHJBySIudVdJ1n2/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/19/03/072",
  "employeeName": "HARSHA SOOD",
  "school": "LMS 2",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Harsha character - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1C9uQLUIFGjwDNMVJp_0HyUnwTI6BWogS/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/19/03/072",
  "employeeName": "HARSHA SOOD",
  "school": "LMS 2",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Harsha B.Ed. - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1Ltodlx4Zj8c1MIqmVxDLztYBAQ4G-04T/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/23/03/095",
  "employeeName": "PRIYANKA SHARMA",
  "school": "LMS 2",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Priyanka graduation - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1WBAK3u7wufiCOlVr8S3D82_2_eWQ6AVQ/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/23/03/095",
  "employeeName": "PRIYANKA SHARMA",
  "school": "LMS 2",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Priyanka 10th - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1WY_mdaLMRGIW3aMVfbvU1FWZZG4LwXuF/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/23/03/095",
  "employeeName": "PRIYANKA SHARMA",
  "school": "LMS 2",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Priyanka 12th - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1YPhZSdhsfMlyR7L1MwMc4fRFaQJUtCbG/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/23/03/095",
  "employeeName": "PRIYANKA SHARMA",
  "school": "LMS 2",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Priyanka medical - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1hN05edTthxyl1CWP_O4uZgMsm-h_Q1XC/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/23/03/095",
  "employeeName": "PRIYANKA SHARMA",
  "school": "LMS 2",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Priyanka character - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1CtWg9NLpi9Kg2zBJXaTVi4NDccYdnftB/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/23/03/095",
  "employeeName": "PRIYANKA SHARMA",
  "school": "LMS 2",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Priyanka BEd NTT - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1uZO6s4WeUsFqPZE6L5-bKFDv5q7WKQql/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/23/04/097",
  "employeeName": "RAJNI KAPOOR",
  "school": "LMS 2",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Rajni graduation - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1UNQA8BRfrHh82AG1U7F54hVTXWhK_rox/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/23/04/097",
  "employeeName": "RAJNI KAPOOR",
  "school": "LMS 2",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Rajni 10th - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/12-QD4QclmJMAfy3iZSWWPCYpgxgTxKlT/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/23/04/097",
  "employeeName": "RAJNI KAPOOR",
  "school": "LMS 2",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Rajni 12th - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1PORt2Ou2afU384ZwpJmRGJvhbfgzPq78/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/23/04/097",
  "employeeName": "RAJNI KAPOOR",
  "school": "LMS 2",
  "category": "MASTER CERTIFICATE",
  "filename": "Rajni Masters - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/17SF2VjYisnJb6ZMFaiUb7uHUpw8ghxkT/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/23/04/097",
  "employeeName": "RAJNI KAPOOR",
  "school": "LMS 2",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Rajni medical - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1dMvP4ZNmJYRsVf3Q-ugPGi4UDemq9LHq/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/23/04/097",
  "employeeName": "RAJNI KAPOOR",
  "school": "LMS 2",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Rajni character - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1sy1yqZOgtdauZuaDYUvyFjLae1t-z10e/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/23/04/097",
  "employeeName": "RAJNI KAPOOR",
  "school": "LMS 2",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Rajni B.Ed - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1Hw7oGGtRRFpWh0AFOqP89fnlMYUesikV/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/23/04/120",
  "employeeName": "SAHIBA AWASTHI",
  "school": "LMS 2",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Sahiba graduation - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1U9MKOnRKuLBL7MNKAX5VyIz7X98ysm9m/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/23/04/120",
  "employeeName": "SAHIBA AWASTHI",
  "school": "LMS 2",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Sahiba 10th - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1Vy6VwySR3PFCjPPlxOA1-nJpPtNgVMTo/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/23/04/120",
  "employeeName": "SAHIBA AWASTHI",
  "school": "LMS 2",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Sahiba 12th - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1X7AYJ-iVBpK6y1l-bz6R4Ztri8VjKS_s/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/23/04/120",
  "employeeName": "SAHIBA AWASTHI",
  "school": "LMS 2",
  "category": "MASTER CERTIFICATE",
  "filename": "Sahiba masters - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/19GaHrbBkglbRTGsbGoY4rCEfykSObPum/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/23/04/120",
  "employeeName": "SAHIBA AWASTHI",
  "school": "LMS 2",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Sahiba medical - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1mw8Ll3fyc_3Fy9i6Y84n-w1_IeStdrXQ/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/23/04/120",
  "employeeName": "SAHIBA AWASTHI",
  "school": "LMS 2",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Sahiba character - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1lp2_oXuueflZgXk8-xUPxqzXrxX4vfM1/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/23/04/120",
  "employeeName": "SAHIBA AWASTHI",
  "school": "LMS 2",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Sahiba BEd - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1Efk7FrD1M7v-_GUKT2Z9yRt4L2Eaw-sJ/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/24/09/118",
  "employeeName": "ASHA DEVI",
  "school": "LMS 2",
  "category": "BACHELORS CERTIFICATE",
  "filename": "asha graduation - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1wMg7reT0inQsG1PnxmMHtGMYTh-I_HDe/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/24/09/118",
  "employeeName": "ASHA DEVI",
  "school": "LMS 2",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "asha 10th - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1QGuFZvhE7AyRl2Gr9kGhsYOuJfKj-BoS/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/24/09/118",
  "employeeName": "ASHA DEVI",
  "school": "LMS 2",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "asha 12th - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1ZNT343Y92zJe22_EDyZACvlFRt36IAD0/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/24/09/118",
  "employeeName": "ASHA DEVI",
  "school": "LMS 2",
  "category": "MASTER CERTIFICATE",
  "filename": "asha masters - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1RXKjc5UzOpkKNgqnzIIQFINDNTY5uGTP/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/24/09/118",
  "employeeName": "ASHA DEVI",
  "school": "LMS 2",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Asha medical - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/12NkREqaCnSzwrvWNLTsJbX3zCbnK8mHH/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/24/09/118",
  "employeeName": "ASHA DEVI",
  "school": "LMS 2",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Asha character - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1C-Enf0CjpdNjhraO3FbdyBFwCJv5t_1T/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/24/09/118",
  "employeeName": "ASHA DEVI",
  "school": "LMS 2",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "asha BEd - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1Q6EzCeq5okRd8eAHxJGvQIHQ1obajSKu/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/23/11/107",
  "employeeName": "SANDHYA DEVI",
  "school": "LMS 2",
  "category": "BACHELORS CERTIFICATE",
  "filename": "sandhya graduation - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1MyWU0zJN8BIICfYw2Ak8yjq3DnoC4Qc7/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/23/11/107",
  "employeeName": "SANDHYA DEVI",
  "school": "LMS 2",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "sandhya 10th - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1zzrMizOEExS1C5yo8lIqaiS10ZpV7x4q/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/23/11/107",
  "employeeName": "SANDHYA DEVI",
  "school": "LMS 2",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "sandhya 12th - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/14DNVvHe36T7h8pw8ln26iiLaGrOw_ToO/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/23/11/107",
  "employeeName": "SANDHYA DEVI",
  "school": "LMS 2",
  "category": "MASTER CERTIFICATE",
  "filename": "sandhya Masters - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1kPGIxwGygNeprt-4sdcm5uW1nxvrMQ8Z/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/23/11/107",
  "employeeName": "SANDHYA DEVI",
  "school": "LMS 2",
  "category": "MEDICAL CERTIFICATE",
  "filename": "sandhya medical - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1F4l4rSEWNhogV-7jo0Q-zQ8WY6Kx5Fyd/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/23/11/107",
  "employeeName": "SANDHYA DEVI",
  "school": "LMS 2",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "sandhya character - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1qap4u5fMz5ixhWMeyXVpPrMpiyY42ZbI/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/23/11/107",
  "employeeName": "SANDHYA DEVI",
  "school": "LMS 2",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "sandhya B.Ed - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1ALstVjsuBBgXe_B5jI_VFRsszkkxDIdT/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/24/04/109",
  "employeeName": "VIPASHA SHARMA",
  "school": "LMS 2",
  "category": "BACHELORS CERTIFICATE",
  "filename": "vipasha graduation - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1Xn0vwOMKoTRF_tbxvbdpkQPJvddR31TB/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/24/04/109",
  "employeeName": "VIPASHA SHARMA",
  "school": "LMS 2",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "vipasha 10th - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1JbFuzBoYw09kb6s2yLb3noXX9oArK5nY/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/24/04/109",
  "employeeName": "VIPASHA SHARMA",
  "school": "LMS 2",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "vipasha 12th - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1n60ufBvLE4WK01Tw96vAxGkG7w0MTQCD/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/24/04/109",
  "employeeName": "VIPASHA SHARMA",
  "school": "LMS 2",
  "category": "MASTER CERTIFICATE",
  "filename": "vipasha Master - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1mIjOgUBO4-TRI6pT-A0ITbBu8PJh1IqD/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/24/04/109",
  "employeeName": "VIPASHA SHARMA",
  "school": "LMS 2",
  "category": "MEDICAL CERTIFICATE",
  "filename": "vipasha Medical - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1Qj266Xpr0EmZjHElzqXVtUFtfGv3Fttc/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/24/04/109",
  "employeeName": "VIPASHA SHARMA",
  "school": "LMS 2",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Vipasha character - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1wxpLyk-u23Xsp-SJeAheGAnGJ0fSsVm8/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "KEL/24/04/109",
  "employeeName": "VIPASHA SHARMA",
  "school": "LMS 2",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "vipasha B.Ed - Tilak Sharma.pdf",
  "url": "https://drive.google.com/file/d/1BAjKjaUSK4NXM7u1GiM70So0SJdg9Gct/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/13/01/006",
  "employeeName": "AJAY SINGH",
  "school": "LMS 3",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Ajay Singh Thakur Bachelor certificate - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1Y3NqBzHuGGOC_MV2QI3YTuexY1fh-1cC/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/13/01/006",
  "employeeName": "AJAY SINGH",
  "school": "LMS 3",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Ajay Singh Thakur Class 10 certificate - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1PNBsDxxg85MaAIKoSgNlJvSEAbsUNhyS/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/13/01/006",
  "employeeName": "AJAY SINGH",
  "school": "LMS 3",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Ajay Singh Thakur class 12 certificate - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1a1zXA94Seb3YjOZH96HZWdAwnJxWlLz_/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/13/01/006",
  "employeeName": "AJAY SINGH",
  "school": "LMS 3",
  "category": "MASTER CERTIFICATE",
  "filename": "Ajay Singh Thakur Master certificate - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1AyzaeifpgMmmmYG4w12BfeYFjO3wpzEU/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/13/01/006",
  "employeeName": "AJAY SINGH",
  "school": "LMS 3",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Ajay Singh Thakur Medical Certificate - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1aJpMJ2cqZsxb4wDfsDeph-WP-XHcswVY/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/13/01/006",
  "employeeName": "AJAY SINGH",
  "school": "LMS 3",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Ajay Singh Thakur Character certificate - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1J2wNKFsQxVObe6YyCJS8RS6XGszO5qIE/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/13/01/006",
  "employeeName": "AJAY SINGH",
  "school": "LMS 3",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Ajay Singh Thakur Certificate Professional Accountant - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1wF_1Ytx3DnGGvbCQsnrcaGoY8dDifChu/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/21/09/050",
  "employeeName": "AMBALIKA SHARMA",
  "school": "LMS 3",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Ambalika Graduation - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/14by6QJ5w7L6yOZtM5V54pG2TgijHRfmF/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/21/09/050",
  "employeeName": "AMBALIKA SHARMA",
  "school": "LMS 3",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Ambalika 10th - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1N-PB-DjUPKOPmh821-s_65lGeeA7wKGz/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/21/09/050",
  "employeeName": "AMBALIKA SHARMA",
  "school": "LMS 3",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Ambalika Diploma - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1nf4-xFdmoHvAHnm3ilOSE8ci6OoGnnBq/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/21/09/050",
  "employeeName": "AMBALIKA SHARMA",
  "school": "LMS 3",
  "category": "MEDICAL CERTIFICATE",
  "filename": "ambalika medical - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1pImsSZ2zQq7pg3ao6GAtjfC6UsDx8qjM/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/21/09/050",
  "employeeName": "AMBALIKA SHARMA",
  "school": "LMS 3",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Ambalika Character - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1-pvLazyJHhXqzRCwn32OxB0EuokZzV8H/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/21/09/050",
  "employeeName": "AMBALIKA SHARMA",
  "school": "LMS 3",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "ambalika ma'am B. ed - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1oX9GNCMjs7skyrCIoPdJVmG80uEbkNk3/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/24/06/077",
  "employeeName": "ANITA DEVI",
  "school": "LMS 3",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Anita Graduation - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1E1A4Rczo4bB23hFaOis51CRdpyDa73C-/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/24/06/077",
  "employeeName": "ANITA DEVI",
  "school": "LMS 3",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Anita Devi 10th - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1xvhRUSPcntCUGbV-bBSmxnbCL5cKL_mr/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/24/06/077",
  "employeeName": "ANITA DEVI",
  "school": "LMS 3",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Anita Devi 12th - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1h0f2zpY97-GBIChPDrlvpv0LbzpjQNNu/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/24/06/077",
  "employeeName": "ANITA DEVI",
  "school": "LMS 3",
  "category": "MEDICAL CERTIFICATE",
  "filename": "anita medical - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1RSFypuxh3vL4c1DGri_Xgh9fK6_GwcTP/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/24/06/077",
  "employeeName": "ANITA DEVI",
  "school": "LMS 3",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "anita devi Character - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1ZtbkzCFUmBk5jtNama9SwrPlO2idCXtp/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/24/06/077",
  "employeeName": "ANITA DEVI",
  "school": "LMS 3",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Anita NTT - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1Sasr_QY8hC7DcghKhIAMEg_2rCPZeM6T/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/13/09/008",
  "employeeName": "GUDDI DEVI",
  "school": "LMS 3",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Guddi graduation - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1VysEY-HQL8tXyJuBWFhK5Cbxxb4zzRrK/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/13/09/008",
  "employeeName": "GUDDI DEVI",
  "school": "LMS 3",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Guddi 10th - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1D8ZfHIImM_rIt4ZEKlHxdjlSaAUy8Sjn/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/13/09/008",
  "employeeName": "GUDDI DEVI",
  "school": "LMS 3",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Guddi 12th - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1S_XxwucNaA4wud85WZ5IZX3xisFhwGo7/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/13/09/008",
  "employeeName": "GUDDI DEVI",
  "school": "LMS 3",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Guddi medical - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1gV6Ai5Euvj4UHlw8LrgPcN-Rq8PNRptP/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/13/09/008",
  "employeeName": "GUDDI DEVI",
  "school": "LMS 3",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Guddi character - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1eNCBMrjT_P-B8yWCfIgI5Atkd5NGQ9hI/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/13/09/008",
  "employeeName": "GUDDI DEVI",
  "school": "LMS 3",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Guddi E.EL.ED - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1ILdckOgpGOGNK2d68mUG8RRj6fYWCzG4/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/14/02/010",
  "employeeName": "MONIKA BEHAL",
  "school": "LMS 3",
  "category": "BACHELORS CERTIFICATE",
  "filename": "MONIKA BA - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/13RtqyBzhBJTHItZj_FEdIGYB5EZsLtPx/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/14/02/010",
  "employeeName": "MONIKA BEHAL",
  "school": "LMS 3",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Monika behal 10 - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1IZU2d4Lre1nu_jGEVwxZUwDQfhWQQ7NU/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/14/02/010",
  "employeeName": "MONIKA BEHAL",
  "school": "LMS 3",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Monika behal12 - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1rYQ-mk2ZsRfgZ4cqvS_OUdEgnCg7mzgc/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/14/02/010",
  "employeeName": "MONIKA BEHAL",
  "school": "LMS 3",
  "category": "MASTER CERTIFICATE",
  "filename": "Monika Masters - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1rU6WL8MOT8U2zvW4VzSbBhaY_N8ZvlBI/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/14/02/010",
  "employeeName": "MONIKA BEHAL",
  "school": "LMS 3",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Monika Medical - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1is74tD2ld30pihN8jkzmg4xClQBS16pM/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/14/02/010",
  "employeeName": "MONIKA BEHAL",
  "school": "LMS 3",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Monika Character - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/18bvSbErh0gkJZ7W3dMeF3vQgo3NvHQPl/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/14/02/010",
  "employeeName": "MONIKA BEHAL",
  "school": "LMS 3",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "MONIKA B ED - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/13PZzayQLx12PyYbmEgrbEYGAC1wFpe-k/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/21/03/047",
  "employeeName": "RAJNI DEVI",
  "school": "LMS 3",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Rajni graduation - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1A1ednfJAHrUwoZ3YYx1X1WRhlKnYDq5n/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/21/03/047",
  "employeeName": "RAJNI DEVI",
  "school": "LMS 3",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Rajni 10th - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1-rNganRul-5xqYjH3dAtN9Rh2giZ7gNW/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/21/03/047",
  "employeeName": "RAJNI DEVI",
  "school": "LMS 3",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Rajni 12th - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1j9GY0ULGNDI98cYV_0wfQcODr0ga3S3r/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/21/03/047",
  "employeeName": "RAJNI DEVI",
  "school": "LMS 3",
  "category": "MASTER CERTIFICATE",
  "filename": "Rajni Masters - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1uYwb0FW6ztx9DG1i14ZgXAXYUVRnuwZ6/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/21/03/047",
  "employeeName": "RAJNI DEVI",
  "school": "LMS 3",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Rajni medical - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/17BfALkJlMWy91D1wdi6TmFXylzi7upg1/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/21/03/047",
  "employeeName": "RAJNI DEVI",
  "school": "LMS 3",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "RAJNI CHARACTER - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1Ndgc0iVXmSeumxi9O40PztwWfe55gE-v/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/21/03/047",
  "employeeName": "RAJNI DEVI",
  "school": "LMS 3",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Rajni B.Ed. - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/18UwEAnl32Def2vCJXNJommbxODsf-KiT/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/24/08/081",
  "employeeName": "RAVI",
  "school": "LMS 3",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Ravi graduation - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/15fzF7hqI4x-dAoJ750swDxxGIlODXr6x/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/24/08/081",
  "employeeName": "RAVI",
  "school": "LMS 3",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Ravi 10th - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1dMmXR0b30YLf_jnerDX9bTnKI0s6u5k5/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/24/08/081",
  "employeeName": "RAVI",
  "school": "LMS 3",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Ravi 12th - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1Vs-qY0bEnLJEHfnC-orWhNL_OpIcZy3S/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/24/08/081",
  "employeeName": "RAVI",
  "school": "LMS 3",
  "category": "MEDICAL CERTIFICATE",
  "filename": "ravi medical - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1S_mYSL73IcP58IdBL0o0W3jkHlNO_nbI/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/24/08/081",
  "employeeName": "RAVI",
  "school": "LMS 3",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Ravi character - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1AG5q-nSAOjehFYYfSS5hM0SbmXjvwZ4C/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/24/08/081",
  "employeeName": "RAVI",
  "school": "LMS 3",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "RAVI B P.ED - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1xjivGD9_c-bdsDSueP9Hw9tuNi7aOoG3/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/23/03/063",
  "employeeName": "SHIVANI",
  "school": "LMS 3",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Shivani graduation LMS-3 - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1SNjZWGpCKvPHutW8ZqgktCgyr3V5TdsT/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/23/03/063",
  "employeeName": "SHIVANI",
  "school": "LMS 3",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Shivani 10th LMS 3 - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1AOEGD6vxKjxxEaz6Z4RzxK_NFfRicH2Y/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/23/03/063",
  "employeeName": "SHIVANI",
  "school": "LMS 3",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Shivani 12th LMS 3 - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1HrOFADxJiKqgcwVsPiBZ1fdkTPXfMMSc/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/23/03/063",
  "employeeName": "SHIVANI",
  "school": "LMS 3",
  "category": "MASTER CERTIFICATE",
  "filename": "Shivani masters LMS 3 - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/19yGx8Th5ofLsGuDHq7U9Mevvkpc9iz3V/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/23/03/063",
  "employeeName": "SHIVANI",
  "school": "LMS 3",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Shivani MEDICAL - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1MKOjqk5G8C2zV3aZB3YnFjnac40Vc5Er/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/23/03/063",
  "employeeName": "SHIVANI",
  "school": "LMS 3",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Shivani CHRACTER - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1XKPp-h6lnSh_ohltMP_bch8UOtWy44Ek/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/23/03/063",
  "employeeName": "SHIVANI",
  "school": "LMS 3",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Shivani BEd LMS3 - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/12FeGs2KbSu-nUH4wv4dvo6wTnwjAo6su/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/25/02/083",
  "employeeName": "TANVI",
  "school": "LMS 3",
  "category": "BACHELORS CERTIFICATE",
  "filename": "TANVI BA - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/19O2BwIlbjhQ9490xPfrXf4Yq4QsnQMuZ/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/25/02/083",
  "employeeName": "TANVI",
  "school": "LMS 3",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Tanvi 10th - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1jQM52CvdtJuRizlv_LxWnGSl84eFiUYC/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/25/02/083",
  "employeeName": "TANVI",
  "school": "LMS 3",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Tanvi 12th - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1rc01bu0x9fA_y26mi8bm1M45kPR4Vobd/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/25/02/083",
  "employeeName": "TANVI",
  "school": "LMS 3",
  "category": "MASTER CERTIFICATE",
  "filename": "TANVI MA - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1ZTMWe1qMc5zuHJJWNG7F5LlG5mrzgMKs/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/25/02/083",
  "employeeName": "TANVI",
  "school": "LMS 3",
  "category": "MEDICAL CERTIFICATE",
  "filename": "TANVI MEDICAL - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1Qzfw0wcKPIH5NrFhvZ-MwjGxqlQ94Y2e/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/25/02/083",
  "employeeName": "TANVI",
  "school": "LMS 3",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Tanvi character - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1hPA_kmNdMaiFciMvezauMMbAl1dDqiN5/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/25/02/083",
  "employeeName": "TANVI",
  "school": "LMS 3",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Tanvi NTT - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1p0dVTjbmODuyZSs5aDCCRTcYOCZNrH5X/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/26/05/087",
  "employeeName": "NEELAM KUMARI",
  "school": "LMS 3",
  "category": "BACHELORS CERTIFICATE",
  "filename": "neelam b sc - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1f3UNxOsnZlgkTn9H_yUsPAkvTTo88S_h/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/26/05/087",
  "employeeName": "NEELAM KUMARI",
  "school": "LMS 3",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "neelam x - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1NRY2sPkE5A6Bn5jnxtO0UztPFW8coXYu/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/26/05/087",
  "employeeName": "NEELAM KUMARI",
  "school": "LMS 3",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "neelam xll - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1zIlIJR98Ee6jD1JLCaI6JTOppj03thXj/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/26/05/087",
  "employeeName": "NEELAM KUMARI",
  "school": "LMS 3",
  "category": "MASTER CERTIFICATE",
  "filename": "neelam m sc - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1eVOz8FiFssu1nfkUUrw9N13_bW7_0puX/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/26/05/087",
  "employeeName": "NEELAM KUMARI",
  "school": "LMS 3",
  "category": "MEDICAL CERTIFICATE",
  "filename": "neelam medical - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1FvvVLckmuVC_X0whftd3_YhaPYRCK96y/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/26/05/087",
  "employeeName": "NEELAM KUMARI",
  "school": "LMS 3",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "neelam character - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1AltfBS-oaEFz4fEmjsFrJDhKOa56Qs4z/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/26/05/087",
  "employeeName": "NEELAM KUMARI",
  "school": "LMS 3",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "neelam d ed - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1dzf2B8xubVCuyhRUB5yeb77z28YfCOvf/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/24/08/079",
  "employeeName": "SHAILJA KUMARI",
  "school": "LMS 3",
  "category": "BACHELORS CERTIFICATE",
  "filename": "shailja graduation - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1iLrMt64_gGdR9_8HDPKpsQqulXvqtdt1/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/24/08/079",
  "employeeName": "SHAILJA KUMARI",
  "school": "LMS 3",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "shailja 10th - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/170dEfhTNZjOPaVEngG2QTKlqu3qfBk6Q/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/24/08/079",
  "employeeName": "SHAILJA KUMARI",
  "school": "LMS 3",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "shailja 12th - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1CdxKREwomE__nWmHfqlcSgHpogFGcR0L/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/24/08/079",
  "employeeName": "SHAILJA KUMARI",
  "school": "LMS 3",
  "category": "MEDICAL CERTIFICATE",
  "filename": "shailja medical - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1s3lSAAEwRe6eIjhY0KcbKpmeBFmRWXhB/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/24/08/079",
  "employeeName": "SHAILJA KUMARI",
  "school": "LMS 3",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "shailja character - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1_vESXdgCPchUh3rDoObsNYSxo4FqwEuG/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/24/08/079",
  "employeeName": "SHAILJA KUMARI",
  "school": "LMS 3",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "shailja B.Ed - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1TEAiYiyRqJKuZTqGy5tPk2haQmiWiO66/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/16/03/017",
  "employeeName": "VIJENDRA",
  "school": "LMS 3",
  "category": "BACHELORS CERTIFICATE",
  "filename": "vijendra graduation - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1GVK864COenw9uhY9BAklBy8fwrl6sAQl/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/16/03/017",
  "employeeName": "VIJENDRA",
  "school": "LMS 3",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "vijendra 10th - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1U8Mjc_ewp1z87YqyXZu2XxW8K0QVLmus/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/16/03/017",
  "employeeName": "VIJENDRA",
  "school": "LMS 3",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "vijendra 12th - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1qvrZLNJXy6mqfkj5mH2RU6QIaA8_isaK/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/16/03/017",
  "employeeName": "VIJENDRA",
  "school": "LMS 3",
  "category": "MASTER CERTIFICATE",
  "filename": "VIJENDRA M A - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1Wy7nwkltjgvFcpyAuIwipUDUcG_ODcE8/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/16/03/017",
  "employeeName": "VIJENDRA",
  "school": "LMS 3",
  "category": "MEDICAL CERTIFICATE",
  "filename": "vijendra medical - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1lTnb_nrj82Unt74JVZP3-dybjiuX-mwS/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/16/03/017",
  "employeeName": "VIJENDRA",
  "school": "LMS 3",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "vijendra character - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/16Be_lZgYwtK47g0f8pI7UX12J2qcnKMV/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/16/03/017",
  "employeeName": "VIJENDRA",
  "school": "LMS 3",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "vijendra NTT - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1acSAR4WH2_JakeMBXcTru4up1TL03S2J/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/24/08/078",
  "employeeName": "YOGITA THAKUR",
  "school": "LMS 3",
  "category": "BACHELORS CERTIFICATE",
  "filename": "yogita graduation - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1v-c5uNzOvEe1tXgINWiVw6-97XSIyPan/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/24/08/078",
  "employeeName": "YOGITA THAKUR",
  "school": "LMS 3",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "YOGITA 10 - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1JbjElOc-VZlDrSHepYLznojx4PN_9pot/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/24/08/078",
  "employeeName": "YOGITA THAKUR",
  "school": "LMS 3",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "yogita 12th - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1F0ESiDfTeiA6NrHCmt1JJdtLbJNe9OJf/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/24/08/078",
  "employeeName": "YOGITA THAKUR",
  "school": "LMS 3",
  "category": "MEDICAL CERTIFICATE",
  "filename": "YOGITA MEDICAL - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1BQ_MCl6hORd_NzoU8qqAIsUBhPYu1CID/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/24/08/078",
  "employeeName": "YOGITA THAKUR",
  "school": "LMS 3",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "YOGITA CHARACTER - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1fEd3jHKkWXIBGpP13C0JC3XkCbNj11rH/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/24/08/078",
  "employeeName": "YOGITA THAKUR",
  "school": "LMS 3",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "yogita B.Ed - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1GZ4YbnDy_nvZxEUhKtWvC0b0387wIWPn/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/24/09/082",
  "employeeName": "AMISHA PAUL",
  "school": "LMS 3",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "AMISHA PAUL 10 - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/169WV0BUiDfBxDwK9dqt1uNo-oUOWDchM/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/24/09/082",
  "employeeName": "AMISHA PAUL",
  "school": "LMS 3",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "AMISHA 12 - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1WezZ9pxrw8WfgO1jg8HBu0BoSrQ8fBxp/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/24/09/082",
  "employeeName": "AMISHA PAUL",
  "school": "LMS 3",
  "category": "MEDICAL CERTIFICATE",
  "filename": "AMISHA MEDICAL - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1CZrsC7cp-LRxoHomp6tLor_3YDzLygQA/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/24/09/082",
  "employeeName": "AMISHA PAUL",
  "school": "LMS 3",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "AMISHA CHARACTER - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1pY6vo3jhuU9OD7eq6mBirIAXqgqszMpj/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/21/02/046",
  "employeeName": "LALITA SHARMA",
  "school": "LMS 3",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Lalita 10th - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1f9YQQLF1HnNp-jOGIUjFqZA-4NaLOuDB/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/21/02/046",
  "employeeName": "LALITA SHARMA",
  "school": "LMS 3",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Lalita 12th - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1d7tcdX3d8X-dcWfg136bn4f58NJ16Aip/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/21/02/046",
  "employeeName": "LALITA SHARMA",
  "school": "LMS 3",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Lalita medical - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1ojzMBcELa2xuVhRys8CDfRSF_SE3yLuc/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/21/02/046",
  "employeeName": "LALITA SHARMA",
  "school": "LMS 3",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Lalita contract - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1QI0rPzf-BAmjTZ8v77CI-nGjY3sVSYMr/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/21/02/046",
  "employeeName": "LALITA SHARMA",
  "school": "LMS 3",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "lalita ntt - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/18QUye05_aDLAlsBdE9C2TvbTbxjtpS_O/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/25/06/086",
  "employeeName": "SAVITA DEVI",
  "school": "LMS 3",
  "category": "HIGHEST QUALIFICATION",
  "filename": "SAVITA  +2 - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1zhwqvUKez33lqIOfCbmuiO8TTPMtiVjm/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/25/06/086",
  "employeeName": "SAVITA DEVI",
  "school": "LMS 3",
  "category": "MEDICAL CERTIFICATE",
  "filename": "SAVITA MEDICAL - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1zF_303I-zUXQspsbfEAdivOIaFRdnXRB/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/25/06/086",
  "employeeName": "SAVITA DEVI",
  "school": "LMS 3",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "SAVITA CHARACTER - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1omuRpube5YVHg3Ssb9mzkuvCMdKPqM-V/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "DUN/25/06/085",
  "employeeName": "SONAM NORBU",
  "school": "LMS 3",
  "category": "MEDICAL CERTIFICATE",
  "filename": "SONAM MEDICAL (2) - chandermohan sharma.pdf",
  "url": "https://drive.google.com/file/d/1vyrHs8nKcG2wShQwn4xoF01V7K0c67RS/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "NCM/19/03/024",
  "employeeName": "MS.ARTI DEVI",
  "school": "LMS 4",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Arti graduation - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1oERTgzXZMCrNTfX4Mk-gjJgMzKWCv_aR/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "NCM/19/03/024",
  "employeeName": "MS.ARTI DEVI",
  "school": "LMS 4",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Arti 10th - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1lIm_IkTUx-v8ZMJoYSvYuNLQH97NjVXf/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "NCM/19/03/024",
  "employeeName": "MS.ARTI DEVI",
  "school": "LMS 4",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Arti 12th - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1u4l9Z6Omy0bAhnM-EfpuZsr8Gic-RdC6/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "NCM/19/03/024",
  "employeeName": "MS.ARTI DEVI",
  "school": "LMS 4",
  "category": "MASTER CERTIFICATE",
  "filename": "Arti masters - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1dQmTMKhfQdsfy7w0v1PLbL8jloMJHXAA/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "NCM/19/03/024",
  "employeeName": "MS.ARTI DEVI",
  "school": "LMS 4",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Arti B.Ed - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1UfYakfxjGBS9u6qVUTzlPxo_iHEwAzR2/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "BACHELORS CERTIFICATE",
  "filename": "BA (1) - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1CUCqn2uytk04bNtn8XUXBSYDu2m2frtx/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "BACHELORS CERTIFICATE",
  "filename": "BA (2) - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1P2l6dMO1bBH0tn7ViiwgSGkvlxck276N/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "BACHELORS CERTIFICATE",
  "filename": "BA (2)-1 - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1T1oAJuIMnVK124e3Qx03eth6Vj_JdznW/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "BACHELORS CERTIFICATE",
  "filename": "BA - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/10QCl-2a1YLOp44tNbm9hWwKqeMyYBcLX/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "BACHELORS CERTIFICATE",
  "filename": "BA Vipin - Kamlesh Kumar (1).pdf",
  "url": "https://drive.google.com/file/d/1a-bYNWCtQn6E0wFGcOYzfKHfjsqjMS2f/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "BACHELORS CERTIFICATE",
  "filename": "BA Vipin - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/15eDM1_j1Oizns_07MJxE_k0c2dqR3iMy/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "BACHELORS CERTIFICATE",
  "filename": "BSC - Kamlesh Kumar (1).pdf",
  "url": "https://drive.google.com/file/d/1MdR_MiPhG9KzqE-ishgX7ph_bKyW3M2z/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "BACHELORS CERTIFICATE",
  "filename": "BSC - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1z5joqAEeiGhjav0JEu_CjMgZmnLtyAlU/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "BACHELORS CERTIFICATE",
  "filename": "BSC-1 - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1CJm0QiooFeLSmo4i3B8Zt3DeUQIkzU2J/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "BACHELORS CERTIFICATE",
  "filename": "BSC-2 - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1c93CxnErCe3t8pXSr7CvHdAQ_u19OcCe/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "BACHELORS CERTIFICATE",
  "filename": "BSC-3 - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1XbWFMzwSDta5LNnvTA1mirkBIMhjSj0l/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "BACHELORS CERTIFICATE",
  "filename": "BSC1 - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1oOSuduXEFBzoOttSGo13nQzEMC6Y9Q1I/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Bsc. Nisha Thakur - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1_vyRqGfLGgR4NHnDfbP5kD-J0n3sQb1M/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Graduation - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/14-RS9wSfPMOMIy-c66LQ9vs9W-nIvM6k/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Graduation S - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1fSh818tKz4HRvpaHxAuKuMJ7WLprnC5F/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Graduation Y - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1aRhJm1EpdglGLMsp1dCLGcHGzsnkgrO-/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Graduation-1 - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1SZknVFSI_SdivBrMsL-P0BJsM6v1ImYX/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "10 Babita - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1BBc3TGpyMS4LZIKardZXsNTaHLjU2zDj/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "10th (1) - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1Ran89s2kyNBj18a3PRt1Dl0ejyYEpSDq/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "10th (2) - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1N1wLinWGSMpaxOlJP0FsfEfSShDblaNP/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "10th (2)-1 - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/19leRoqhggm2DsqxDGLvMAesnZStVS1HQ/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "10th (4) - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/15aci4X68jmwFtEKLDTv2XDqdjhWqyISy/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "10th - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1cvFDsxxxlZZN3_XqrUQvBi4pXxaqplPa/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "10th Kamle - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/15jc1wWFpkZMowjuCRbNieSnySwurla2F/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "10th Nisha Thakur - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1hJnyXRLZq6aqTwc1UMMJBnPI1obhdKm7/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "10th S - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1Cbe9sjF26UlBcCzxRh2jbeFc_859094k/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "10th Vipin - Kamlesh Kumar (1).pdf",
  "url": "https://drive.google.com/file/d/1RkW6bcuDiiB_wD_7nkb03aSoUr5Ozzid/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "10th Vipin - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1BidvaO3ZJhC6B_3m_ahqkuCfwgBOSMP8/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "10th Y - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1rUmpkGJ3nOb5UuoSk7mSb0kqy4epJsv3/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "10th-1 - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1KVbL1WLul9Uj0D4RfuZ-Q2iG44w8TJbf/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Abhishek  10th - Kamlesh Kumar (1).pdf",
  "url": "https://drive.google.com/file/d/1m7fxgcoIDRsBbq9W-WeJsR-vIX-OX864/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Abhishek  10th - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1Lh9ctv9FO9VllT1h-XWdnrdEn1SgwH7N/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "X - Kamlesh Kumar (1).pdf",
  "url": "https://drive.google.com/file/d/1ghuydKnic9GgQ3bpPuBYVS-vbgunnu4W/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "X - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/168EFu2stWQztR3H1RCLaDUZstyS8M2AF/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "+2 (1) - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1S04ltzWSpvaJM-dCoi_HkEKgRy2PK3X1/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "+2 (2) - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1vSRRKjeOaxIn-rWvh9RYMSv_RWD6VRXv/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "+2 (2)-1 - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1K0I6Hl6OjTb2_M5ueU0ns9qyWQeMpmMf/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "+2 - Kamlesh Kumar (1).pdf",
  "url": "https://drive.google.com/file/d/1D1R3C_IwcZSiWWvsYnFChiR6GjbhWnww/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "+2 - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1AsVefRSuCYsb_EVDFyXyjYExZ17jOyzo/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "+2 Babita - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/14FaQI52hIV0-JVf0h96sGf2ov_1WaD9E/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "+2 Kamlesh - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1Sf85C6bV8cEG-7CzAPYQt_DQbPpFm_GF/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "+2 Nisha Thakur - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1szllDZ21o7B4KFtAaebIWB-kkUHURI-A/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "+2 S - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1tXLRugJVaa7ng6LN4iz1L7zN0CHRbWRl/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "+2 Vipin - Kamlesh Kumar (1).pdf",
  "url": "https://drive.google.com/file/d/1aa9riWgC09TLG49Y8FJ6FMZTjhXpwpVU/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "+2 Vipin - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1VM-VH6-1EQFrMjaPGVy2nF4HUqSXwfeq/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "+2 Y - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1qscWf6kkj5l6_zyRCIaRDW2ocAsMOwov/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "+2-1 - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1A9tLR_vr26QbwAh000qPbXOaxM9YLf2i/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "+2-2 - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1zXyMLEEj3m_ob651zW99F_4Sb2hVoS5w/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Plus Two - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/16Hb3OXibr0AlVmU25h-bMhMUved3ewct/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "XII - Kamlesh Kumar (1).pdf",
  "url": "https://drive.google.com/file/d/1AV2sCYlm9GfSfrPOh0LdCf0lG0o8nmY7/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "XII - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/18chb0OUfqFw5J1tWESmlFHv9sveerrPP/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "MASTER CERTIFICATE",
  "filename": "M SC. - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1cKCSyHAYE04UJf89eOYwrS223C8M4WXY/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "MASTER CERTIFICATE",
  "filename": "MSC - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1nNIYcEbu_gL4oM82-5r7qdQk0ZmJuzbC/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "MASTER CERTIFICATE",
  "filename": "MSC-1 - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1ytrasO2osbbh3lAq-cy7jRSVFHPMnpty/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "MASTER CERTIFICATE",
  "filename": "Masters Babita - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1GvSNnTTaWSUP1BUXsJQdfVHiYfY6Ex1L/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "MASTER CERTIFICATE",
  "filename": "Masters Kamlesh - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1NlXzOKPepw7c3DXN4b503iPiVj5IWKZT/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "MASTER CERTIFICATE",
  "filename": "Masters S - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1_H0v590cGwAv_PilUBWRZaB5sdygXl5p/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "MASTER CERTIFICATE",
  "filename": "Msc-2 - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1-AY773nzsIHIlGHNiA1Lr5yaRxMdLVtR/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "MASTER CERTIFICATE",
  "filename": "Msc. Nisha Thakur - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1o0d6mBYyXc5_mvfo76b5MqRJWVD1zYdA/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "MEDICAL CERTIFICATE",
  "filename": "MEDICAL (2) - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1zeCfly5yIuL2YbH8UkxOagpM5-_QOzUP/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "MEDICAL CERTIFICATE",
  "filename": "MEDICAL - Kamlesh Kumar (1).pdf",
  "url": "https://drive.google.com/file/d/1tpssMdkxOGOQD3iBPfg1U9VdfpauTBLh/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "MEDICAL CERTIFICATE",
  "filename": "MEDICAL - Kamlesh Kumar (2).pdf",
  "url": "https://drive.google.com/file/d/1Acyd-SYCh_ZCkyvE2nRdRfZFAWaC_J2C/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "MEDICAL CERTIFICATE",
  "filename": "MEDICAL-2 - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1ys6bPmleSsOawoo7rGAwP47XS43eLvAN/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Med. - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1MwdI23wT5SerBTsv5yI1oAi_BVrEsBbL/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Medical (1) - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1IYTakIHiku_TWjgQlEh6XykgPgWvURa1/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Medical (2)-1 - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1LBCYg9a1e2fjX_Hiz62A3-v0xaYhzbsK/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Medical - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1ypmw9zG6PJWLqyeSAKcV65klS6P2ylMh/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Medical Arti - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1syUf4WyIUjbv-ZhZk3JlWLOESCR85nUQ/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Medical Babita - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1Qyyt-nSwwrY0yH3auP3eoSnqmCyRq5CM/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Medical Kamlesh - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1R6y6rOTsIaWDRq5oEq1Xiszoxh8lKkuO/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Medical Nisha Thakur - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1mQgzTjzLtA-3oTEB_mYEOP_JUUDXc_xn/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Medical S - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1jK4k_MwTAv8I6MCSv82_cSxc59z9KW8T/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Medical Suresh - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1lD2RdhmgVERyxEdcknbrgVoCxyIDGDTD/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Medical Vipin - Kamlesh Kumar (1).pdf",
  "url": "https://drive.google.com/file/d/12-9SwBMgoOTDXjdFQgDNhgNq1unHa44o/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Medical Vipin - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1vtLmn2WelC-WjDx-DgAJXctHf1XVd6iu/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Medical Y - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1yKgoOJVwzzB16P8a9Yllda0f3Q26gw-2/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Medical-3 - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1JjHlgLHztRInvJ0IFVw2jB0_viaYoRE5/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Medical. - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1PKfeuxYjiA-7VgY1My5_eg795lmmwVGg/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "MEDICAL CERTIFICATE",
  "filename": "medical-1 - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1EGPqQS3w7GsVhYzK5s3IjXb9M2NDSqZS/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "CHARCTER - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1nNCG_qbnzott-KL8d9W2wgrAaEzCJlCx/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Certificate (60) - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1ZHhLrWtPP80CmWPmTsQ-6EL-9jAXYTNS/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Character (1) - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/19J3zMspqHnQIqlc3-JVpm4ticTw0qduF/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Character - Kamlesh Kumar (1).pdf",
  "url": "https://drive.google.com/file/d/1SUE27ktKX3AJ_AikFDWGxd5K2l3Iw36I/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Character - Kamlesh Kumar (2).pdf",
  "url": "https://drive.google.com/file/d/1j7T3Psd-hIMvjNbtLxgImIFi_lw4XWlO/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Character Babita - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1YSaVTbBK6OdoPLb7cfdv0TZuO255ujrv/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Character Certificate - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1FDweCDb7MqLfUOpX_gmZNC3Iw_QyybDT/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Character Nisha Thakur - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1p4I5aPiMkbHyYNBbVdCuf_DVt3stTQ6h/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Character S - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/19ku-a9NmdxvHi_X-ceuo4h7L2LOgTLkK/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Character Vipin - Kamlesh Kumar (1).pdf",
  "url": "https://drive.google.com/file/d/1gzADDpOIVjTJZAZdbrhbXBeLUkwaE3w2/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Character Vipin - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1SHSli5Wr9x5IvVw6BLqaqrJiKcdmpBYU/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Character certificate Kamlesh - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1vnlrT7o1G5d5uBElw23xDR_aGmS0r3EV/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Character. - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1_U-It0JDVSBTnpIfuyy07f2hbTYOKZO6/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Chracter - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/17hw4vnk_AaoIEF1xLxI_dN9MRWSaetAT/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Police Verification - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1VuyyiGDFvVLJgPIfOcoFe395gx9af_wX/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "character - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1WKmFmU3Sn5DYjPpM1u3_25Wddrv26pfU/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "character Arti - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1Wd-bh2WIVc0BlO-ZvS8AHSlVyGT1BQ99/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "character Y - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1It3mnBiJbDgvxD3NXSaBIiHuXdhcbI0N/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "character-1 - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1rTDfjgpnD_xjdy3DRiCuxWBKSAwKg27t/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "character1 - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1F5n6P_P16mTUyOm5iOv33tFCYS5Ia9Lt/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "ART & CRAFT - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1-_668ySblbsl-vYo8JPMYYaeqmziruFz/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "B ED. - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1ikdPy5QBu74H4vkmSLVyvC2bhLTgpRVp/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "B.Ed S - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1J16yR0rrLBkKPMeJTONe94M_qpEjav-6/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "B.Ed Y - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1Vha5jNnnH2NMsx4smUWC-jy1lx5xzJiL/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "B.Ed. Nisha Thakur - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1kEJloHwGxCLq5qC9OwJK5exNfgLU6BMD/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "B.Ed. Vipin - Kamlesh Kumar (1).pdf",
  "url": "https://drive.google.com/file/d/1MNGFNlis-oPtJgknFDoY68gGGyr2qwmk/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "B.Ed. Vipin - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1DI70gU5d77dXtsIPbe9L4id3OwUfacgq/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "B.ed Babita - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1KWBxyA5u5zS33qymZSngExiyAf_2TfDL/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "BED - Kamlesh Kumar (1).pdf",
  "url": "https://drive.google.com/file/d/1sM04b77W9ik4PnSY2Nh9px5tfFn7WSc4/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "BED - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1sRXEZOl8j73zTuLU1vpqK5nJ-Qex-C7W/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "BED-1 - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1bLjiypQB-HVglqYt6jLFamLK3ctwKXPj/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "BED-2 - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/18aHN7XrMs0mTO10bwqCJNQlE7uHJuhzu/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "BED-3 - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1TxN6wO7-Id-nOYHb0bu8qGFIUETT3wht/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Bed (1) - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1vuV96RP-_TkIlzrY0ZYvCPhN1obIP7Fl/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Bed. - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1-oQgjhSuf6y0HtwSoJnk9ZWKesAqpaGg/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "D EL. ED. - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1SeU8Ha5gaMN4EAen0WxrZfHQfaJgyc3n/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/24/09/083",
  "employeeName": "KAMLESH KUMAR",
  "school": "LMS 4",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Masters Kamlesh - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1yqsxlcdLDyTIOMEujCR6uY0jL_TRtDHq/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "NCM/23/12/034",
  "employeeName": "GURPREET KAUR",
  "school": "LMS 4",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Gurpreet graduation - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1Us-K6STh4Ykp_3zf5Olx1gBa7RNUDah2/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "NCM/23/12/034",
  "employeeName": "GURPREET KAUR",
  "school": "LMS 4",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Gurpreet 10th - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1IRfYhKXdXJgufn7kqVnshrzNM-bg61lL/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "NCM/23/12/034",
  "employeeName": "GURPREET KAUR",
  "school": "LMS 4",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Gurpreet 12th - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1CzWd_-u7rSsa9hLUSr5DoRUF67xkWJJK/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "NCM/23/12/034",
  "employeeName": "GURPREET KAUR",
  "school": "LMS 4",
  "category": "MASTER CERTIFICATE",
  "filename": "Gurpreet masters - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1gRBbIqqZTNBlGh1-oKGXvg2qrdhLQMhs/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "NCM/23/12/034",
  "employeeName": "GURPREET KAUR",
  "school": "LMS 4",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Gurpreet B.Ed - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1DL7QMj_IJRYKnJDwSnYNUeB00etL8dle/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "NCM/26/07/102",
  "employeeName": "SONALI SHARMA",
  "school": "LMS 4",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Sonali BA - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1FH5jeNR9uGtweo7F7c2HLvCYUpvxq4lZ/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "NCM/26/07/102",
  "employeeName": "SONALI SHARMA",
  "school": "LMS 4",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Sonali 10th - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1dlYzLKmcde2oW_NUFZYf3pwY0ru4N3wF/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "NCM/26/07/102",
  "employeeName": "SONALI SHARMA",
  "school": "LMS 4",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Sonali +2 - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1hWHX1ygpjgvLqFuw0UgUxRxv57auPzND/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "NCM/26/07/102",
  "employeeName": "SONALI SHARMA",
  "school": "LMS 4",
  "category": "MASTER CERTIFICATE",
  "filename": "Sonali MA - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1LtKVrgbg3Pd6ywFhLQmgRVZtJS1kE7sy/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "NCM/26/07/102",
  "employeeName": "SONALI SHARMA",
  "school": "LMS 4",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Sonali Medical - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1MvBIiFpsVBPRBq6zxh8LH6Uy8Qb8JgOc/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "NCM/26/07/102",
  "employeeName": "SONALI SHARMA",
  "school": "LMS 4",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Sonali character - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1LpxPAlugHVRyQP54ivf92mEurywRlwUW/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "NCM/26/07/102",
  "employeeName": "SONALI SHARMA",
  "school": "LMS 4",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Sonali Bed. - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1kKmAssoGtytJw1aNYIglGka3QbzhgcnY/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "NCM/23/05/061",
  "employeeName": "SURESH KUMAR",
  "school": "LMS 4",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Suresh ncm graduation - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1N9skOvKI0nQbuf7tfR6sogNbtk850ATK/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "NCM/23/05/061",
  "employeeName": "SURESH KUMAR",
  "school": "LMS 4",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Suresh ncm 10th - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1dYQAwcAZZ5uHVcgrPDeSeGyLq8g3Xdev/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "NCM/23/05/061",
  "employeeName": "SURESH KUMAR",
  "school": "LMS 4",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Suresh ncm 12th - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1FK3LAsu8tOJYAKFKvgyIuQ8E1uxLoQbU/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "NCM/23/05/061",
  "employeeName": "SURESH KUMAR",
  "school": "LMS 4",
  "category": "MASTER CERTIFICATE",
  "filename": "Suresh ncm masters - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1KYbVr7CsY4xxuhi8vm8HtDjvA4WZ1RGA/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "NCM/23/05/061",
  "employeeName": "SURESH KUMAR",
  "school": "LMS 4",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Suresh ncm BEd - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1VmXxRrAPTxsNKg3jEvloFHqfxJsUPbRk/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "NCM/26/07/103",
  "employeeName": "RAGHAV",
  "school": "LMS 4",
  "category": "BACHELORS CERTIFICATE",
  "filename": "raghav Bsc - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1sWuXNEwY6E-d27rAGcRkAKJXQ-6HIYIg/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "NCM/26/07/103",
  "employeeName": "RAGHAV",
  "school": "LMS 4",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Raghav 10th - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/19NEIzV70m1U_g-mwIhTVgSpsBl_8AKCL/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "NCM/26/07/103",
  "employeeName": "RAGHAV",
  "school": "LMS 4",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Raghav +2 - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1y2opdW7eRQ_Su1Ab82qBtYW6Utn91YSc/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "NCM/26/07/103",
  "employeeName": "RAGHAV",
  "school": "LMS 4",
  "category": "MEDICAL CERTIFICATE",
  "filename": "raghav medical - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1rVq-pXVvNAQGIUlp2CGmb8LiOHKrm6ZQ/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "NCM/26/07/103",
  "employeeName": "RAGHAV",
  "school": "LMS 4",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Raghav character - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1CEzDfoOiezQZIBURD1ya3fjhT6uOU7il/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "NCM/26/07/103",
  "employeeName": "RAGHAV",
  "school": "LMS 4",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "raghav Lib - Kamlesh Kumar.pdf",
  "url": "https://drive.google.com/file/d/1loOrizPEUw9aWX04TVFC-VOn85hNKWeg/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "SAY/26/02/2",
  "employeeName": "TAMANNA SHARMA",
  "school": "LMS 5",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Degree Jyoti - TAMANNA SHARMA.pdf",
  "url": "https://drive.google.com/file/d/1BPt1ejKgUxPDPfRZU2k7UR4p-o8Y8Hmi/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "SAY/26/02/2",
  "employeeName": "TAMANNA SHARMA",
  "school": "LMS 5",
  "category": "BACHELORS CERTIFICATE",
  "filename": "DocScanner 27 Feb 2026 3-37\u202fpm - TAMANNA SHARMA.pdf",
  "url": "https://drive.google.com/file/d/1QfMj272F04EQDgWHp9C5IcKA9f6V7z2h/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "SAY/26/02/2",
  "employeeName": "TAMANNA SHARMA",
  "school": "LMS 5",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "10 Jyoti - TAMANNA SHARMA.pdf",
  "url": "https://drive.google.com/file/d/1EZCeaGMqpTssDUy7sdmh7-jdVkaB_aKe/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "SAY/26/02/2",
  "employeeName": "TAMANNA SHARMA",
  "school": "LMS 5",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "DocScanner 27 Feb 2026 3-35\u202fpm - TAMANNA SHARMA.pdf",
  "url": "https://drive.google.com/file/d/1ZIJetgNfE3_opmVNeekoAF2Nd_do0Fhn/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "SAY/26/02/2",
  "employeeName": "TAMANNA SHARMA",
  "school": "LMS 5",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "12 Jyoti - TAMANNA SHARMA.pdf",
  "url": "https://drive.google.com/file/d/12hAJzdcwaKOti3k6iWyV84C4Lbzk1d6r/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "SAY/26/02/2",
  "employeeName": "TAMANNA SHARMA",
  "school": "LMS 5",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "DocScanner 27 Feb 2026 3-36\u202fpm - TAMANNA SHARMA.pdf",
  "url": "https://drive.google.com/file/d/1Jm6ayO5oCU-Q30L7h89bSNyM5e4cxM0Y/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "SAY/26/02/2",
  "employeeName": "TAMANNA SHARMA",
  "school": "LMS 5",
  "category": "MASTER CERTIFICATE",
  "filename": "DocScanner 27 Feb 2026 3-38\u202fpm - TAMANNA SHARMA.pdf",
  "url": "https://drive.google.com/file/d/1euAJQ9a-TSVJJ9Ny2q_6EOEvdn9jL0Uz/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "SAY/26/02/2",
  "employeeName": "TAMANNA SHARMA",
  "school": "LMS 5",
  "category": "MEDICAL CERTIFICATE",
  "filename": "DocScanner 27 Feb 2026 3-44\u202fpm - TAMANNA SHARMA.pdf",
  "url": "https://drive.google.com/file/d/1nKvcHQKEoLM0E34i-b6wl6Jmq0oT8GWQ/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "SAY/26/02/2",
  "employeeName": "TAMANNA SHARMA",
  "school": "LMS 5",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Medical Jyoti - TAMANNA SHARMA.pdf",
  "url": "https://drive.google.com/file/d/1NyPaw95trofzY_M9oABF-bsb400L2U7k/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "SAY/26/02/2",
  "employeeName": "TAMANNA SHARMA",
  "school": "LMS 5",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Character Jyoti - TAMANNA SHARMA.pdf",
  "url": "https://drive.google.com/file/d/1RBC5iyfY5zJqGwPgOv9Djan3vMMBq68Z/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "SAY/26/02/2",
  "employeeName": "TAMANNA SHARMA",
  "school": "LMS 5",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "DocScanner 27 Feb 2026 3-43\u202fpm - TAMANNA SHARMA.pdf",
  "url": "https://drive.google.com/file/d/1vD67JMt8ZgwOb6RD4KJiEBbcsz7jZkmt/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "SAY/26/02/2",
  "employeeName": "TAMANNA SHARMA",
  "school": "LMS 5",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "DocScanner 27 Feb 2026 3-38\u202fpm - TAMANNA SHARMA.pdf",
  "url": "https://drive.google.com/file/d/1joopZbGnwog-pFc7RXyX7LaVIB1YNWwI/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "SAY/26/02/2",
  "employeeName": "TAMANNA SHARMA",
  "school": "LMS 5",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Tet Jyoti - TAMANNA SHARMA.pdf",
  "url": "https://drive.google.com/file/d/1aRW1sq0RzWdD36CAVdFG4ZlHVQu4g4aT/view",
  "status": "Matched (submitter-based -- verify)"
 },
 {
  "employeeCode": "SAY/26/04/6",
  "employeeName": "DIKSHA THAKUR",
  "school": "LMS 5",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Diksha bsc - TAMANNA SHARMA.pdf",
  "url": "https://drive.google.com/file/d/1jjR0ekW-X_2Bwd3GsXaGNsa8NdFvu8j-/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "SAY/26/04/6",
  "employeeName": "DIKSHA THAKUR",
  "school": "LMS 5",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Diksha 10 - TAMANNA SHARMA.pdf",
  "url": "https://drive.google.com/file/d/1kBwMd4VcKixTdUyY2mnJ7ppYN5FsKwMR/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "SAY/26/04/6",
  "employeeName": "DIKSHA THAKUR",
  "school": "LMS 5",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Diksha 12 - TAMANNA SHARMA.pdf",
  "url": "https://drive.google.com/file/d/1-tZ3iHm3FJS2A5Pd0AaHCCxx_MwgOCwJ/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "SAY/26/04/6",
  "employeeName": "DIKSHA THAKUR",
  "school": "LMS 5",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Diksha medical - TAMANNA SHARMA.pdf",
  "url": "https://drive.google.com/file/d/1BuSlbqaHtfAqdU4Q9Wui_eNitJ0kKCfJ/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "SAY/26/04/6",
  "employeeName": "DIKSHA THAKUR",
  "school": "LMS 5",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "diksha chracter - TAMANNA SHARMA.pdf",
  "url": "https://drive.google.com/file/d/1gn0RO1-bh9TPed1d49Dh_gfXLKJ66WTW/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "SAY/26/04/6",
  "employeeName": "DIKSHA THAKUR",
  "school": "LMS 5",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Diksha bed - TAMANNA SHARMA.pdf",
  "url": "https://drive.google.com/file/d/1ykkVo0t7qTwlNR-UIPbkLwK6jnKNOPod/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "SAY/26/04/3",
  "employeeName": "SHRAYA BHARDWAJ",
  "school": "LMS 5",
  "category": "BACHELORS CERTIFICATE",
  "filename": "shraya degree - TAMANNA SHARMA.pdf",
  "url": "https://drive.google.com/file/d/12u4VOIHIfsrBw7r1oOY-Ys67XZijmOgk/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "SAY/26/04/3",
  "employeeName": "SHRAYA BHARDWAJ",
  "school": "LMS 5",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "shraya 10 - TAMANNA SHARMA.pdf",
  "url": "https://drive.google.com/file/d/1DVcATcoqHltDsioOCOd4Ft3mxO5TpARF/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "SAY/26/04/3",
  "employeeName": "SHRAYA BHARDWAJ",
  "school": "LMS 5",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "shraya 12 - TAMANNA SHARMA.pdf",
  "url": "https://drive.google.com/file/d/1sVxVX41FnxE4D5okIDMIaYluwPvpXU2X/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "SAY/26/04/3",
  "employeeName": "SHRAYA BHARDWAJ",
  "school": "LMS 5",
  "category": "MEDICAL CERTIFICATE",
  "filename": "shraya medical - TAMANNA SHARMA.pdf",
  "url": "https://drive.google.com/file/d/1kd0iR_QT_fYUJq6XPuOP8FdTaZq_xSg3/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "SAY/26/04/3",
  "employeeName": "SHRAYA BHARDWAJ",
  "school": "LMS 5",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "shraya character - TAMANNA SHARMA.pdf",
  "url": "https://drive.google.com/file/d/19pG1CEyX8xFmFbY-EUjYdgyxm2VzJAQs/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "SAY/26/04/3",
  "employeeName": "SHRAYA BHARDWAJ",
  "school": "LMS 5",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "shraya bed - TAMANNA SHARMA.pdf",
  "url": "https://drive.google.com/file/d/18yWeHlUl-_4n9J1vfw1jqSOgW_s5yBR_/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/04/2",
  "employeeName": "ASHWARIA",
  "school": "LMS 6",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Aishwaria diploma in elementary education - SEEMA DEVI.pdf",
  "url": "https://drive.google.com/file/d/1DU4eKY4T9nLqcuT0SsW6AfpsI0hky4BO/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/04/2",
  "employeeName": "ASHWARIA",
  "school": "LMS 6",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Aishwaria 10 certificate - SEEMA DEVI.pdf",
  "url": "https://drive.google.com/file/d/1Z71B4itFhpKyxlfYgOK-GcOc66swsnGT/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/04/2",
  "employeeName": "ASHWARIA",
  "school": "LMS 6",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Aishwaria 12th certificate - SEEMA DEVI.pdf",
  "url": "https://drive.google.com/file/d/1bJ8G5ghFHEILuT6B-z5HAhw8eDZtxNmc/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/04/2",
  "employeeName": "ASHWARIA",
  "school": "LMS 6",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Aishwaria medical fitness certificate - SEEMA DEVI.pdf",
  "url": "https://drive.google.com/file/d/1tht1bvW6hD2rqfZ-AKk1EdFhtS8QoyP0/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/04/2",
  "employeeName": "ASHWARIA",
  "school": "LMS 6",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Aishwaria character certificate - SEEMA DEVI.pdf",
  "url": "https://drive.google.com/file/d/12x5itmLq8pXYz26YADhiRhBd0-qs6M_J/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/04/2",
  "employeeName": "ASHWARIA",
  "school": "LMS 6",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Aishwaria diploma in elementary education - SEEMA DEVI.pdf",
  "url": "https://drive.google.com/file/d/1QHE9B6NTx1eQrMlZtJar_MZIPwgLK5Gn/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/04/4",
  "employeeName": "NIKITA SEN",
  "school": "LMS 6",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Nikita Bachelor degree - SEEMA DEVI.pdf",
  "url": "https://drive.google.com/file/d/1H7yWKzZvo-akxu1Osw4MJq6PC4qY3ScQ/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/04/4",
  "employeeName": "NIKITA SEN",
  "school": "LMS 6",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Nikita 10 th certificate - SEEMA DEVI.pdf",
  "url": "https://drive.google.com/file/d/1PskSaC6tnWLOFG2XZVMzBb11yyv0rBCA/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/04/4",
  "employeeName": "NIKITA SEN",
  "school": "LMS 6",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Nikita 12th certificate - SEEMA DEVI.pdf",
  "url": "https://drive.google.com/file/d/1EfkKSVJGat4r2xwWUyVKKLKtDniCqcrg/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/04/4",
  "employeeName": "NIKITA SEN",
  "school": "LMS 6",
  "category": "MASTER CERTIFICATE",
  "filename": "Nikita M.sc degree - SEEMA DEVI.pdf",
  "url": "https://drive.google.com/file/d/111F3nt4QtA1-j2okmJ5sdeMQFmx-gBz4/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/04/4",
  "employeeName": "NIKITA SEN",
  "school": "LMS 6",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Nikita medical fitness certificate - SEEMA DEVI.pdf",
  "url": "https://drive.google.com/file/d/1GsPsCMU3dvGNurs4txumd_9L-GdO8gVc/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/04/4",
  "employeeName": "NIKITA SEN",
  "school": "LMS 6",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Nikita character certificate - SEEMA DEVI.pdf",
  "url": "https://drive.google.com/file/d/1ROkdT6yPWSpfR9GiVvHzoHJsYQOkobuZ/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/04/4",
  "employeeName": "NIKITA SEN",
  "school": "LMS 6",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Nikita B.ed degree - SEEMA DEVI.pdf",
  "url": "https://drive.google.com/file/d/1G0TtySOqi8AVPUyvUzG2SdMlLErIODj4/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/12/17",
  "employeeName": "SURBHI",
  "school": "LMS 6",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Surbhi Bsc with Zoology - SONALI DHIMAN.pdf",
  "url": "https://drive.google.com/file/d/1kw_GS2j-LeksRVvp_oNJ1le9Sa-4Bn3i/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/12/17",
  "employeeName": "SURBHI",
  "school": "LMS 6",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Surbhi 10th - SONALI DHIMAN.pdf",
  "url": "https://drive.google.com/file/d/1VLa4bst5q5eTD-2z1xWK3myYaMxcUoiQ/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/12/17",
  "employeeName": "SURBHI",
  "school": "LMS 6",
  "category": "MASTER CERTIFICATE",
  "filename": "Surbhi MSC - SONALI DHIMAN.pdf",
  "url": "https://drive.google.com/file/d/1QBMz4SHT-oGzsWnm_Ucpi4MQIO0wd6Oc/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/12/17",
  "employeeName": "SURBHI",
  "school": "LMS 6",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Surbhi Medical certificate (1) - SONALI DHIMAN.pdf",
  "url": "https://drive.google.com/file/d/1y05vu4CoVhyi3FqEYJ6q0IO-eihBpR7Y/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/12/17",
  "employeeName": "SURBHI",
  "school": "LMS 6",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Surbhi character certificate - SONALI DHIMAN.pdf",
  "url": "https://drive.google.com/file/d/1qfs4C6Hn3TOaV1bGF7AHaWTWTmHfb7-n/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/12/17",
  "employeeName": "SURBHI",
  "school": "LMS 6",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "surbhi bachelor of education(1) - SONALI DHIMAN.pdf",
  "url": "https://drive.google.com/file/d/1_wiqfXf9WGwh4-njp-T0rvBff2r4ymA2/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/07/12",
  "employeeName": "SONALI",
  "school": "LMS 6",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Sonali 10th - SONALI DHIMAN.pdf",
  "url": "https://drive.google.com/file/d/106MnkPuORueF8WOCHMNCg2fX8CwX2Oiy/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/07/12",
  "employeeName": "SONALI",
  "school": "LMS 6",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Sonali 12th - SONALI DHIMAN.pdf",
  "url": "https://drive.google.com/file/d/1cLiViL6btgbTT-sFWmmUOjnK2xZx4MST/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/07/12",
  "employeeName": "SONALI",
  "school": "LMS 6",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Sonali medical - SONALI DHIMAN.pdf",
  "url": "https://drive.google.com/file/d/1wa7xJO8Qp9PBTV-cQN9GoAyZwZVnS_8B/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/07/12",
  "employeeName": "SONALI",
  "school": "LMS 6",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Sonali character certificate - SONALI DHIMAN.pdf",
  "url": "https://drive.google.com/file/d/1oIebroi9GFkH8OorWWKejuRZcKGkxdh9/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/06/11",
  "employeeName": "YAMINI SEN",
  "school": "LMS 6",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Yamini 10th - SONALI DHIMAN.pdf",
  "url": "https://drive.google.com/file/d/1__5bWeGCrxKwbbFqv7QO6UXaCOCbuv9N/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/06/11",
  "employeeName": "YAMINI SEN",
  "school": "LMS 6",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Yamini 12th - SONALI DHIMAN.pdf",
  "url": "https://drive.google.com/file/d/1KF8ctXxlKd3GU4imKfcf4FWbA1iNKeAG/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/06/11",
  "employeeName": "YAMINI SEN",
  "school": "LMS 6",
  "category": "MASTER CERTIFICATE",
  "filename": "Yamini master - SONALI DHIMAN.pdf",
  "url": "https://drive.google.com/file/d/1ux_jXh_cJz1rxlh9bfRaXSnzIFhZzA9F/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/06/11",
  "employeeName": "YAMINI SEN",
  "school": "LMS 6",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Yamini medical - SONALI DHIMAN.pdf",
  "url": "https://drive.google.com/file/d/1h31EgPtc2aCq8wvWXh2EsZY6V2QkmZsJ/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/06/11",
  "employeeName": "YAMINI SEN",
  "school": "LMS 6",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Yamini character - SONALI DHIMAN.pdf",
  "url": "https://drive.google.com/file/d/1Jc7mag6S5VJYY_RWqpmm59nNkr6y_TI7/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/06/11",
  "employeeName": "YAMINI SEN",
  "school": "LMS 6",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Yamini Bachelor of education - SONALI DHIMAN.pdf",
  "url": "https://drive.google.com/file/d/1VM6QYeLZzSpLm-klim8hGR8_7yBrS0KD/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/04/3",
  "employeeName": "KRITIKA",
  "school": "LMS 6",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "kritika 10 certificate - SEEMA DEVI.pdf",
  "url": "https://drive.google.com/file/d/1U0J9uDi3HXt8XAZokRdDvock2WYxMs1U/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/04/3",
  "employeeName": "KRITIKA",
  "school": "LMS 6",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "kritika 12 certificate - SEEMA DEVI.pdf",
  "url": "https://drive.google.com/file/d/1AQdfuzqgJ1G6PMJC3riZXUCImWSuHFK_/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/04/3",
  "employeeName": "KRITIKA",
  "school": "LMS 6",
  "category": "MASTER CERTIFICATE",
  "filename": "kritika m.sc - SEEMA DEVI.pdf",
  "url": "https://drive.google.com/file/d/1XL1IArBEcg9lamNin9BxdxO6HybIeL9k/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/04/3",
  "employeeName": "KRITIKA",
  "school": "LMS 6",
  "category": "MEDICAL CERTIFICATE",
  "filename": "kritika medical fitness certificate - SEEMA DEVI.pdf",
  "url": "https://drive.google.com/file/d/1XdZSjtbVotaLBRVVVJC46iZ-DVv36Bzk/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/04/3",
  "employeeName": "KRITIKA",
  "school": "LMS 6",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "kritika character certificate - SEEMA DEVI.pdf",
  "url": "https://drive.google.com/file/d/1ap67lh9qmdXPtAxIADFYTN3-Kg_cxvvX/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/04/3",
  "employeeName": "KRITIKA",
  "school": "LMS 6",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "kritika b.ed - SEEMA DEVI.pdf",
  "url": "https://drive.google.com/file/d/1uAqzBdOiVziJe5_zIodzdM0UJUE5sArE/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/04/5",
  "employeeName": "PARNEEMA DEVI",
  "school": "LMS 6",
  "category": "HIGHEST QUALIFICATION",
  "filename": "Neema 10th - SONALI DHIMAN.pdf",
  "url": "https://drive.google.com/file/d/1pCi3J2sYxRervNuTWZiLmpd32AUQNFmD/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/04/5",
  "employeeName": "PARNEEMA DEVI",
  "school": "LMS 6",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Neema Medical Certificate - SONALI DHIMAN.pdf",
  "url": "https://drive.google.com/file/d/1ng_T9rd6Mh5iGViAL26Vk4YZMxDS6TlK/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/04/5",
  "employeeName": "PARNEEMA DEVI",
  "school": "LMS 6",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Neema Character - SONALI DHIMAN.pdf",
  "url": "https://drive.google.com/file/d/1KzgB0SqZP060-zIsGlGfsN28spffK81e/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/11/16",
  "employeeName": "REETA DEVI",
  "school": "LMS 6",
  "category": "HIGHEST QUALIFICATION",
  "filename": "Reeta 10th - SONALI DHIMAN.pdf",
  "url": "https://drive.google.com/file/d/10-pFdgdIldDiNzEWcj0EI4fPP6eqjpbH/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/11/16",
  "employeeName": "REETA DEVI",
  "school": "LMS 6",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Reeta Medical - SONALI DHIMAN.pdf",
  "url": "https://drive.google.com/file/d/1-UPWzQ7N4czAuPMDx86wIZu8pYaITKlT/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/25/11/16",
  "employeeName": "REETA DEVI",
  "school": "LMS 6",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Reeta Character - SONALI DHIMAN.pdf",
  "url": "https://drive.google.com/file/d/1zg17z0B5lEbFRP19F_NrbuR_icHZR1Yt/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/26/04/19",
  "employeeName": "MONU",
  "school": "LMS 6",
  "category": "HIGHEST QUALIFICATION",
  "filename": "monu - SONALI DHIMAN.pdf",
  "url": "https://drive.google.com/file/d/1khXEp-WbW85OjAAqnHilfOh354VtyOlB/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/26/04/19",
  "employeeName": "MONU",
  "school": "LMS 6",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Monu character certificate - SONALI DHIMAN.pdf",
  "url": "https://drive.google.com/file/d/1FLltE_Wa1q6pmwIdGYdPHnkYaxgXVCSL/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "JOG/26/04/19",
  "employeeName": "MONU",
  "school": "LMS 6",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Monu character certificate - SONALI DHIMAN.pdf",
  "url": "https://drive.google.com/file/d/1e1WW2OiQ6Xec9xjmmKwdtIvuihj_-kfT/view",
  "status": "Matched (confident)"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Shivani LMS 2 graduation - Tilak Sharma.pdf",
  "url": null,
  "status": "Ambiguous -- candidates: SHIVANI SHARMA (KEL/18/02/056); SHIVANI (KEL/22/03/086)"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Shivani LMS 2 10th - Tilak Sharma.pdf",
  "url": null,
  "status": "Ambiguous -- candidates: SHIVANI SHARMA (KEL/18/02/056); SHIVANI (KEL/22/03/086)"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Shivani LMS 2 12th - Tilak Sharma.pdf",
  "url": null,
  "status": "Ambiguous -- candidates: SHIVANI SHARMA (KEL/18/02/056); SHIVANI (KEL/22/03/086)"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "MASTER CERTIFICATE",
  "filename": "Shivani LMS 2 Masters - Tilak Sharma.pdf",
  "url": null,
  "status": "Ambiguous -- candidates: SHIVANI SHARMA (KEL/18/02/056); SHIVANI (KEL/22/03/086)"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Shivani LMS 2 medical - Tilak Sharma.pdf",
  "url": null,
  "status": "Ambiguous -- candidates: SHIVANI SHARMA (KEL/18/02/056); SHIVANI (KEL/22/03/086)"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Shivani LMS 2 character - Tilak Sharma.pdf",
  "url": null,
  "status": "Ambiguous -- candidates: SHIVANI SHARMA (KEL/18/02/056); SHIVANI (KEL/22/03/086)"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Shivani Sharma BEd - Tilak Sharma.pdf",
  "url": null,
  "status": "Ambiguous -- candidates: SHIVANI SHARMA (KEL/18/02/056); SHIVANI (KEL/22/03/086)"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 3",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Suresh 2 graduation - chandermohan sharma.pdf",
  "url": null,
  "status": "Ambiguous -- candidates: Suresh kumar (DUN/16/02/018); SURESH KUMAR (DUN/20/02/041)"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 3",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Suresh 2 10th - chandermohan sharma.pdf",
  "url": null,
  "status": "Ambiguous -- candidates: Suresh kumar (DUN/16/02/018); SURESH KUMAR (DUN/20/02/041)"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 3",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Suresh 2 12th - chandermohan sharma.pdf",
  "url": null,
  "status": "Ambiguous -- candidates: Suresh kumar (DUN/16/02/018); SURESH KUMAR (DUN/20/02/041)"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 3",
  "category": "MEDICAL CERTIFICATE",
  "filename": "suresh p medical - chandermohan sharma.pdf",
  "url": null,
  "status": "Ambiguous -- candidates: Suresh kumar (DUN/16/02/018); SURESH KUMAR (DUN/20/02/041)"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 3",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Suresh Kumar CHARACTER - chandermohan sharma.pdf",
  "url": null,
  "status": "Ambiguous -- candidates: Suresh kumar (DUN/16/02/018); SURESH KUMAR (DUN/20/02/041)"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 3",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Suresh 2 BEd - chandermohan sharma.pdf",
  "url": null,
  "status": "Ambiguous -- candidates: Suresh kumar (DUN/16/02/018); SURESH KUMAR (DUN/20/02/041)"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 6",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Neha Bachelors - SONALI DHIMAN.pdf",
  "url": null,
  "status": "Ambiguous -- candidates: NEHA BANTA (JOG/25/04/9); NEHA KAPOOR (JOG/26/06/20)"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 6",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Neha 10th - SONALI DHIMAN.pdf",
  "url": null,
  "status": "Ambiguous -- candidates: NEHA BANTA (JOG/25/04/9); NEHA KAPOOR (JOG/26/06/20)"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 6",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Neha 12th - SONALI DHIMAN.pdf",
  "url": null,
  "status": "Ambiguous -- candidates: NEHA BANTA (JOG/25/04/9); NEHA KAPOOR (JOG/26/06/20)"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 6",
  "category": "MASTER CERTIFICATE",
  "filename": "Neha Masters - SONALI DHIMAN.pdf",
  "url": null,
  "status": "Ambiguous -- candidates: NEHA BANTA (JOG/25/04/9); NEHA KAPOOR (JOG/26/06/20)"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 6",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Neha Medical Certificate - SONALI DHIMAN.pdf",
  "url": null,
  "status": "Ambiguous -- candidates: NEHA BANTA (JOG/25/04/9); NEHA KAPOOR (JOG/26/06/20)"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 6",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Neha Character certificate - SONALI DHIMAN.pdf",
  "url": null,
  "status": "Ambiguous -- candidates: NEHA BANTA (JOG/25/04/9); NEHA KAPOOR (JOG/26/06/20)"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 6",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Neha B.Ed - SONALI DHIMAN.pdf",
  "url": null,
  "status": "Ambiguous -- candidates: NEHA BANTA (JOG/25/04/9); NEHA KAPOOR (JOG/26/06/20)"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 1",
  "category": "BACHELORS CERTIFICATE",
  "filename": "B.A - Bhumika Rampal.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 1",
  "category": "BACHELORS CERTIFICATE",
  "filename": "B.SC. - Bhumika Rampal.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 1",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Document 91 - Bhumika Rampal.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 1",
  "category": "BACHELORS CERTIFICATE",
  "filename": "GRADUATION - Bhumika Rampal (1).pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 1",
  "category": "BACHELORS CERTIFICATE",
  "filename": "GRADUATION - Bhumika Rampal.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 1",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "10 TH - Bhumika Rampal (1).pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 1",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "10 TH - Bhumika Rampal.jpg",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 1",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "10 TH - Bhumika Rampal.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 1",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Document 89 - Bhumika Rampal.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 1",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "X - Bhumika Rampal.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 1",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "+2 - Bhumika Rampal (1).pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 1",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "+2 - Bhumika Rampal (2).pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 1",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "+2 - Bhumika Rampal.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 1",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Document 90 - Bhumika Rampal.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 1",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "XII - Bhumika Rampal.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 1",
  "category": "HIGHEST QUALIFICATION",
  "filename": "harry mark sheet - Bhumika Rampal.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 1",
  "category": "MASTER CERTIFICATE",
  "filename": "Document 91 - Bhumika Rampal.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 1",
  "category": "MASTER CERTIFICATE",
  "filename": "M.A - Bhumika Rampal.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 1",
  "category": "MASTER CERTIFICATE",
  "filename": "MASTER - Bhumika Rampal.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 1",
  "category": "MASTER CERTIFICATE",
  "filename": "MASTERS - Bhumika Rampal.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 1",
  "category": "MEDICAL CERTIFICATE",
  "filename": "HARRY MEDI - Bhumika Rampal.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 1",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Document 93 - Bhumika Rampal.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 1",
  "category": "MEDICAL CERTIFICATE",
  "filename": "MEDICAL - Bhumika Rampal (1).pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 1",
  "category": "MEDICAL CERTIFICATE",
  "filename": "MEDICAL - Bhumika Rampal (2).pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 1",
  "category": "MEDICAL CERTIFICATE",
  "filename": "MEDICAL - Bhumika Rampal.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 1",
  "category": "MEDICAL CERTIFICATE",
  "filename": "MEDICAL OF VISHA - Bhumika Rampal.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 1",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "HARRY POLICE - Bhumika Rampal.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 1",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Adobe Scan 1 Aug 2025 - Bhumika Rampal.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 1",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "CHARACTER CERTIFICATE  ANKITA SHARMA - Bhumika Rampal.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 1",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "CHARACTER CERTIFICATE - Bhumika Rampal.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 1",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "CHARACTER CERTIFICATE OF VISHA - Bhumika Rampal.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 1",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Document 94 - Bhumika Rampal.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 1",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Adobe Scan 1 Aug 2025 (2) - Bhumika Rampal.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 1",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "B.E.D - Bhumika Rampal.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 1",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "B.ED - Bhumika Rampal.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 1",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Document 91 - Bhumika Rampal.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 1",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "b.e.d visha - Bhumika Rampal.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "BACHELORS CERTIFICATE",
  "filename": "bishali graduation - Tilak Sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "BACHELORS CERTIFICATE",
  "filename": "sheetal graduation - Tilak Sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "BACHELORS CERTIFICATE",
  "filename": "BA Certificate of Asha Devi - SANJAY KUMAR.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "BACHELORS CERTIFICATE",
  "filename": "DEGREE - PANKAJ THAKUR (1).pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Degree - PANKAJ THAKUR.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "BACHELORS CERTIFICATE",
  "filename": "GRADUATION - DavinderPreet Kaur (1).pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Gargi graduation - Tilak Sharma (1).pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Gargi graduation - Tilak Sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Graduation - DavinderPreet Kaur.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "sheetal 10th - Tilak Sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "vishali 10th - Tilak Sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "10th - PANKAJ THAKUR.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "10th Marksheet of Asha Devi - SANJAY KUMAR.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "CLASS10TH - PANKAJ THAKUR.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Gargi 10th - Tilak Sharma (1).pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Gargi 10th - Tilak Sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "MATRICULATION CERTIFICATE - DavinderPreet Kaur.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Matriculation - DavinderPreet Kaur.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "sheetal 12th - Tilak Sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "vishali 12th - Tilak Sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "+2 - PANKAJ THAKUR.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "12TH - PANKAJ THAKUR.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "12th CERTIFICATE - DavinderPreet Kaur (1).pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "12th certificate - DavinderPreet Kaur.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Gargi 12th - Tilak Sharma (1).pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Gargi 12th - Tilak Sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Plus Two Marksheet of Asha Devi - SANJAY KUMAR.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "MASTER CERTIFICATE",
  "filename": "sheetsl masters - Tilak Sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "MASTER CERTIFICATE",
  "filename": "vishali master's - Tilak Sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "MASTER CERTIFICATE",
  "filename": "Gargi masters - Tilak Sharma (1).pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "MASTER CERTIFICATE",
  "filename": "Gargi masters - Tilak Sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "MASTER CERTIFICATE",
  "filename": "MA Certificate of Asha Devi - SANJAY KUMAR.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "MASTER CERTIFICATE",
  "filename": "POST GRADUATION - DavinderPreet Kaur.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "MEDICAL CERTIFICATE",
  "filename": "MEDICAL - PANKAJ THAKUR.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Medical Certificate of Fitness - PANKAJ THAKUR.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "MEDICAL CERTIFICATE",
  "filename": "sheetal medical - Tilak Sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "MEDICAL CERTIFICATE",
  "filename": "vishali medical - Tilak Sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "MEDICAL CERTIFICATE",
  "filename": "FITNESS - PANKAJ THAKUR.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Gargi medical - Tilak Sharma (1).pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Gargi medical - Tilak Sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "MEDICAL CERTIFICATE",
  "filename": "MEDICAL REPORT - DavinderPreet Kaur.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Medical Certificate - DavinderPreet Kaur.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Medical Fitness Certificate of Asha Devi - SANJAY KUMAR.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "MEDICAL CERTIFICATE",
  "filename": "medical rk sir - PANKAJ THAKUR.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "character - PANKAJ THAKUR.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "character1 - PANKAJ THAKUR.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Sheetal character - Tilak Sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "vishali character - Tilak Sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "CHARACTER - PANKAJ THAKUR (1).pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Gargi character - Tilak Sharma (1).pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Gargi character - Tilak Sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "PANCHYAT - DavinderPreet Kaur.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Verification - DavinderPreet Kaur.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "character - PANKAJ THAKUR.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "sheetal B.Ed - Tilak Sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "vishali B.Ed - Tilak Sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "B.ed Certificate of Asha Devi - SANJAY KUMAR.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "COMPUTER - DavinderPreet Kaur.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "DEGREE - PANKAJ THAKUR (1).pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Degree - PANKAJ THAKUR.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Gargi BEd - Tilak Sharma (1).pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Gargi BEd - Tilak Sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 2",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "NTT Pursuing - DavinderPreet Kaur.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 3",
  "category": "BACHELORS CERTIFICATE",
  "filename": "B.SC - chandermohan sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 3",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Lakshmi graduation - chandermohan sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 3",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Prasher Bechelors certificate - chandermohan sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 3",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Lakshmi 10th - chandermohan sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 3",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "MATRIC - chandermohan sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 3",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Prasher Class 10 certificate - chandermohan sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 3",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Lakshmi 12th - chandermohan sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 3",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "PLUS 2 - chandermohan sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 3",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Prasher class 12 certificate - chandermohan sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 3",
  "category": "HIGHEST QUALIFICATION",
  "filename": "SCHOOL SONAM - chandermohan sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 3",
  "category": "MASTER CERTIFICATE",
  "filename": "Lakshmi masters - chandermohan sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 3",
  "category": "MASTER CERTIFICATE",
  "filename": "Prasher Master certificate - chandermohan sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 3",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Lakshmi medical - chandermohan sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 3",
  "category": "MEDICAL CERTIFICATE",
  "filename": "MEDICAL - chandermohan sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 3",
  "category": "MEDICAL CERTIFICATE",
  "filename": "MEDICAL SURESH - chandermohan sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 3",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "CHARACTER SONAM - chandermohan sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 3",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "CHARACTER - chandermohan sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 3",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Lakshmi character - chandermohan sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 3",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Prasher character certificate - chandermohan sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 3",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "B.ED - chandermohan sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 3",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "D.LED AMISHA - chandermohan sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 3",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Lakshmi NTT - chandermohan sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 3",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Professional degree - chandermohan sharma.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 5",
  "category": "HIGHEST QUALIFICATION",
  "filename": "+2 (2)-2 - LMS Ner Chowk.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 5",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Medical (2)-2 - LMS Ner Chowk.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 5",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Character (2) - LMS Ner Chowk.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 6",
  "category": "BACHELORS CERTIFICATE",
  "filename": "BSC - SONALI DHIMAN.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 6",
  "category": "BACHELORS CERTIFICATE",
  "filename": "Seema Bachelor degree - SEEMA DEVI.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 6",
  "category": "BACHELORS CERTIFICATE",
  "filename": "bachelor degree - SEEMA DEVI.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 6",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "10th - SONALI DHIMAN.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 6",
  "category": "CLASS 10 BOARD RESULT SHEET",
  "filename": "Seema 10th certificate - SEEMA DEVI.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 6",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "12th - SONALI DHIMAN.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 6",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "12th Surbhi - SONALI DHIMAN.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 6",
  "category": "CLASS 12 BOARD RESULT SHEET",
  "filename": "Seema 12th certificate - SEEMA DEVI.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 6",
  "category": "HIGHEST QUALIFICATION",
  "filename": "Rajkumar - SONALI DHIMAN.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 6",
  "category": "MASTER CERTIFICATE",
  "filename": "Masters - SONALI DHIMAN.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 6",
  "category": "MASTER CERTIFICATE",
  "filename": "Seema MBA degree - SEEMA DEVI.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 6",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Rajkumar medical - SONALI DHIMAN.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 6",
  "category": "MEDICAL CERTIFICATE",
  "filename": "Seema medical certificate - SEEMA DEVI.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 6",
  "category": "MEDICAL CERTIFICATE",
  "filename": "medical certificate - SONALI DHIMAN.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 6",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Rajkumar Character Certificate - SONALI DHIMAN.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 6",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Ishita character certificate - SONALI DHIMAN.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 6",
  "category": "POLICE VERIFICATION CHARACTER CERTIFICATE",
  "filename": "Seema character certificate - SEEMA DEVI.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 6",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Bachelor - SONALI DHIMAN.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 6",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "MBA DMC - SONALI DHIMAN.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 },
 {
  "employeeCode": "",
  "employeeName": "",
  "school": "LMS 6",
  "category": "Professional Degrees (D.El.Ed, B.Ed, B.P.Ed, M.P.Ed, Technical, etc.)",
  "filename": "Seema MBA degree - SEEMA DEVI.pdf",
  "url": null,
  "status": "Unmatched -- no roster candidate close enough"
 }
];

function importCertificateLinks() {
  const ss = SpreadsheetApp.openById(STAFF_EMP_SHEET_ID);
  let sheet = ss.getSheetByName(CERT_LINKS_TAB);
  if (!sheet) sheet = ss.insertSheet(CERT_LINKS_TAB);
  sheet.clearContents();

  const header = ['Employee Code', 'Employee Name', 'School', 'Document Type', 'Filename', 'Drive Link', 'Status'];
  sheet.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');

  const rows = CERT_LINKS_DATA.map(function (r) {
    return [r.employeeCode, r.employeeName, r.school, r.category, r.filename, r.url || '', r.status];
  });
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, header.length).setValues(rows);
  }
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, header.length);
  Logger.log('Imported ' + rows.length + ' certificate link rows into "' + CERT_LINKS_TAB + '".');
}
