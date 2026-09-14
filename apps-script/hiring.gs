// ═══════════════════════════════════════════════════════════════════
// HIR — Hiring Dashboard: browse the Teaching Applicants sheet, track a
// candidate's status, and gate the final "Hired" write behind the two
// Approvals this hire is supposed to have gone through.
//
// Ported from ~/lmcs-salary-dashboard/apps-script/teaching-applicants.gs
// (built 2026-07-06, verified locally, never deployed) and refined
// 2026-09-14 by applying first-principles + Musk's 5-step algorithm to
// the whole hiring flow before porting anything over. What changed and
// why, vs. the original:
//   - DELETED its own verifyPrincipal() -- this file lives in the SAME
//     Apps Script project as main.gs/approvals.gs now, so it takes the
//     already-verified `caller` from main.gs's dispatcher like every
//     other concern here, instead of a second copy of Google
//     token-verification logic.
//   - DELETED addStaffMaster()/suggestStaffCode() -- staff-management-
//     api.gs's addNewHire_ already does this correctly against the
//     LIVE EmpMaster schema (by header name, handles EmpAcademic too,
//     campus-scope-checked). Duplicating a second, older hire-writer
//     against the same sheet risked two different column layouts
//     fighting over one row shape. The frontend calls that existing,
//     already-deployed API directly instead.
//   - DELETED the read-time gate on browsing applicants -- browsing is
//     just reading; nothing is committed until a status write. The
//     real control point is the WRITE that sets status to 'Hired',
//     which is the one place this file actually checks Approvals (see
//     hirApprovalsOk_) instead of gating every list call.
//   - DELETED the idea of a separate "Hiring Cases" tracking sheet --
//     status/notes/interview-at already live as trailing columns on
//     the Teaching Applicants sheet itself, matching how that sheet
//     already works; a second sheet would just be the same fact
//     tracked twice.
//   - KEPT (already good, no reason to touch): dedupe-by-phone,
//     warn-don't-block interview-report and document cross-checks by
//     phone/name, keyword-based document-column matching (already
//     handles the duplicated document-question columns headers-first).
//
// SETUP: no new deployment -- this file joins the existing "LMCS
// Principal's Daily Reporting Backend" Apps Script project (paste
// alongside main.gs/approvals.gs/etc.), and main.gs's doGet/doPost
// already route to it. Nothing to configure beyond that.
// ═══════════════════════════════════════════════════════════════════

const HIR_SHEET_ID = '1aSCQ3IGO-ZP_5yRjtnMpZdlauTdWj3814ATD9qwskPQ'; // "Teaching Applicants"
const HIR_SHEET_GID = 800656734; // targets the exact tab regardless of its name

// Columns in the response sheet (1-indexed) -- STATUS/NOTES/INTERVIEW_AT
// reuse the form's own trailing Remarks/"Column 1" columns plus one
// appended-for-this-purpose column, same as the code this was ported
// from -- never touching the columns the live Google Form owns.
const HIR_COL = {
  TIMESTAMP: 1, NAME: 2, PHONE: 3, AGE: 4, SUBJECTS: 5, BRANCHES: 6,
  QUALIFICATION: 7, BED: 8, GENDER: 9, CV: 10, STATUS: 11, NOTES: 12, INTERVIEW_AT: 13,
};

const HIR_STATUSES = ['New', 'Contacted', 'Interview Scheduled', 'Interviewed', 'Offered', 'Hired', 'Rejected', 'Not Responding'];

// "Interview Report Form (Responses)" -- filled in independently by
// whoever conducts the interview. Read-only here, to warn (not block)
// if a report can't be found once an applicant is marked Interviewed.
const HIR_IR_SHEET_ID = '18NKMBGxT2DuGcrL_m-Y0JGcrmi6oqm6qtLB4Jb_d0Ow';
const HIR_IR_COL = { NAME: 1, PHONE: 2, BRANCH: 3, REMARKS: 5, PDF: 6 }; // 0-indexed

// Per-campus "Staff Document Submission form (Responses)" sheets -- used
// to warn (not block) if required documents are missing before Hired.
const HIR_DOC_SHEET_IDS = {
  LMS1: '1PJ2acPOHopbHzzwGes8X4YPWSDBdXnd0zl46zvFCvIg',
  LMS2: '10xxFM1li1-6xzWEBEEPkZIF4MJcilddoVJkEfVbkScM',
  LMS3: '1qdQnXrWWTrgnCt82MSk_fN6Fqaox-EoenuF_XToypAc',
  LMS4: '1x8eFlnFcEKaCwF9HMRan_EQwTgSPq9xHubZ7n5vyR8k',
  LMS5: '1-bhS4eu4OHFhRzllsALtWLRWiGFt-KutbNke3nNlCk8',
  LMS6: '1-3_3BT7zHVJXy7UqxwZuZmpzUJp4uaibHNaA7onI0jU',
};
// Keyword fragments used to find the relevant columns in each doc sheet
// by header text, since the real sheets have ~30 document columns
// spread across merged form revisions (some duplicated verbatim) rather
// than one clean set. A document counts as present if ANY column
// matching the keyword is non-empty.
const HIR_REQUIRED_DOC_KEYWORDS = {
  'Bio-Data': ['BIODATA', 'BIO-DATA', 'BIO DATA'],
  'Hiring Slip': ['HIRING SLIP'],
  'PAN Card': ['PAN CARD'],
  'Aadhar Card': ['AADHAR'],
  'Bank/Cancelled Cheque': ['CANCELLED CHEQUE', 'BANK COPY'],
  'Qualification Certificate': ['BACHELOR', 'MASTER CERTIFICATE', 'PROFESSIONAL DEGREE', 'HIGHEST QUALIFICATION'],
  'Police Verification': ['POLICE VERIFICATION', 'CHARACTER CERTIFICATE'],
  'Medical Certificate': ['MEDICAL CERTIFICATE'],
};

function hirSheet_() {
  const ss = SpreadsheetApp.openById(HIR_SHEET_ID);
  const sheet = ss.getSheets().find(function (s) { return s.getSheetId() === HIR_SHEET_GID; });
  if (!sheet) throw new Error('Teaching Applicants sheet tab not found');
  return sheet;
}

function hirNormalizePhone_(p) {
  const digits = String(p || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function hirNormalizeName_(n) {
  return String(n || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// action=hiringapplicants -- an applicant row is visible only if AT LEAST
// ONE campus in its Branches column currently has an Approved "Hiring /
// New Position" AND that requisition's required subjects overlap the
// applicant's own Subjects (hirSubjectsMatch_ -- a blank requirement is
// a wildcard, so this doesn't newly hide anything that was visible
// before subjects existed on the form). A locked Principal is further
// narrowed to just their own campus's rows (by the same "LMS-N"
// substring tag the sheet's own per-campus tabs use); Owner/Coordinator
// (campusId 'ALL') see the union across every approved+matching campus
// -- NOT everyone unconditionally.
//
// 2026-09-14, per Uday (twice): first pass gated locked campuses but
// exempted Owner on the theory that "they're the approver, they need
// visibility" -- wrong, caught live: approving a requisition is about
// the role description, not about browsing candidate PII, so Owner
// browsing every applicant regardless of approval state has the exact
// same PII-exposure problem a locked Principal would. No exemption now;
// the rule is identical for everyone, just evaluated per-campus. Same
// day, per-subject filtering added on top for the same reason -- an
// approval for "PRT Science" shouldn't surface a PGT Commerce applicant
// just because the campus has SOME open role.
//
// Deduped by phone number server-side (one implementation instead of
// every caller re-deduping) -- keeps the most recent submission,
// backfilling a missing CV link from an older duplicate that had one.
function hiringApplicants_(caller) {
  const requisitions = hirApprovedRequisitions_('Hiring / New Position');
  if (caller.campusId !== 'ALL' && !requisitions[caller.campusId]) {
    return { success: true, statuses: HIR_STATUSES, applicants: [], gated: true };
  }
  if (!Object.keys(requisitions).length) {
    // Nobody, anywhere, has an approved requisition yet -- same "gated"
    // signal a locked campus gets, so the frontend shows one consistent
    // message instead of a bare empty table.
    return { success: true, statuses: HIR_STATUSES, applicants: [], gated: true };
  }
  const values = hirSheet_().getDataRange().getValues();
  const tag = caller.campusId === 'ALL' ? null : 'LMS-' + caller.campusId.replace(/[^0-9]/g, '');
  const byPhone = {};
  const order = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r[HIR_COL.NAME - 1]) continue;
    const branches = String(r[HIR_COL.BRANCHES - 1] || '').trim();
    const subjects = String(r[HIR_COL.SUBJECTS - 1] || '').trim();

    // Visible only if at least one campus this applicant applied to (or,
    // when locked, specifically the caller's own campus) has an Approved
    // requisition whose required subjects overlap this applicant's own.
    const matches = Object.keys(requisitions).some(function (c) {
      const campusTag = 'LMS-' + c.replace(/[^0-9]/g, '');
      if (branches.indexOf(campusTag) === -1) return false;
      if (tag && campusTag !== tag) return false;
      return requisitions[c].some(function (req) { return hirSubjectsMatch_(req.subjects, subjects); });
    });
    if (!matches) continue;

    const phone = hirNormalizePhone_(r[HIR_COL.PHONE - 1]);
    const applicant = {
      row: i + 1, // 1-based sheet row, used to write status/notes back
      timestamp: r[HIR_COL.TIMESTAMP - 1] ? new Date(r[HIR_COL.TIMESTAMP - 1]).toISOString() : '',
      name: String(r[HIR_COL.NAME - 1] || '').trim(),
      phone: String(r[HIR_COL.PHONE - 1] || '').trim(),
      age: String(r[HIR_COL.AGE - 1] || '').trim(),
      subjects: String(r[HIR_COL.SUBJECTS - 1] || '').trim(),
      branches: branches,
      qualification: String(r[HIR_COL.QUALIFICATION - 1] || '').trim(),
      bed: String(r[HIR_COL.BED - 1] || '').trim(),
      gender: String(r[HIR_COL.GENDER - 1] || '').trim(),
      cv: String(r[HIR_COL.CV - 1] || '').trim(),
      status: String(r[HIR_COL.STATUS - 1] || '').trim() || 'New',
      notes: String(r[HIR_COL.NOTES - 1] || '').trim(),
      interviewAt: r[HIR_COL.INTERVIEW_AT - 1] ? new Date(r[HIR_COL.INTERVIEW_AT - 1]).toISOString() : '',
    };

    if (!phone || !byPhone[phone]) {
      byPhone[phone || ('row' + applicant.row)] = applicant;
      order.push(phone || ('row' + applicant.row));
    } else {
      // Later row for the same phone wins as the "current" record (most
      // recent submission), but keep an older CV link if the newer
      // submission is missing one.
      const prev = byPhone[phone];
      if (!applicant.cv && prev.cv) applicant.cv = prev.cv;
      byPhone[phone] = applicant;
    }
  }
  const applicants = order.map(function (k) { return byPhone[k]; });
  // NOT `gated: true` here even if this comes out empty -- unlike the
  // two checks above (nobody approved ANYTHING), a genuinely empty
  // result after subject-matching means "approved roles exist, just no
  // applicant matches them yet," which is real, informative emptiness,
  // not the same "nothing's been requested" state the gated message is for.
  return { success: true, statuses: HIR_STATUSES, applicants: applicants };
}

// campusId -> [{subjects, openings}] for every Approved requisition of
// this category -- 2026-09-14, per Uday: "Hiring / New Position" now
// carries WHAT was approved (itemName/quantity on the Approvals row,
// reused the same way Compensation Change reuses Item/Amount -- see
// approvals.gs's APR_ITEM_CATEGORIES), so hiringApplicants_ below can
// filter to applicants matching the approved subject, not just "SOME
// position is open at this campus." A blank subjects string (any
// requisition approved before this field existed, or one submitted
// without specifying subjects) means "any subject" -- wildcard, not
// "matches nothing" -- see hirSubjectsMatch_. Reuses approvals.gs's
// aprSheet_()/APR_STATUS -- same Apps Script project, same global
// scope, no duplicate sheet-read logic.
function hirApprovedRequisitions_(category) {
  const values = aprSheet_().getDataRange().getValues();
  const byCampus = {};
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (String(row[2]) !== category) continue;
    if (String(row[13]) !== APR_STATUS.APPROVED) continue;
    const campusId = String(row[1]).trim();
    if (!byCampus[campusId]) byCampus[campusId] = [];
    byCampus[campusId].push({ subjects: String(row[7] || '').trim(), openings: row[8] === '' ? null : Number(row[8]) });
  }
  return byCampus;
}

// campusId -> true for every campus with an Approved requisition of this
// category -- kept as a plain yes/no wrapper for hirApprovalApproved_
// (the Hired-write gate below), which never needs subject matching: a
// "Hiring Decision" approval is already about one specific named
// candidate, not a subject filter.
function hirApprovedCampuses_(category) {
  const reqs = hirApprovedRequisitions_(category);
  const set = {};
  Object.keys(reqs).forEach(function (c) { set[c] = true; });
  return set;
}

// `ponytail:` heuristic token-overlap match, not an exact string
// comparison -- real "Subjects" column values weren't available to
// calibrate against precisely when this was built. Strips common role
// prefixes (PRT/TGT/PGT/NTT, which describe the role LEVEL, not the
// subject), lowercases, splits on anything non-letter, and matches if
// any word 3+ letters long is shared between the requisition's required
// subjects and the applicant's own Subjects field. Upgrade path: once
// real applicant data shows false positives/negatives, tighten or
// loosen this against actual examples (e.g. a synonym map for
// "Maths"/"Mathematics" if that mismatch shows up).
const HIR_ROLE_PREFIXES = ['prt', 'tgt', 'pgt', 'ntt'];
function hirNormalizeSubjectTokens_(s) {
  return String(s || '').toLowerCase().split(/[^a-z]+/)
    .filter(function (w) { return w.length >= 3 && HIR_ROLE_PREFIXES.indexOf(w) === -1; });
}
function hirSubjectsMatch_(required, applicantSubjects) {
  const reqTokens = hirNormalizeSubjectTokens_(required);
  if (!reqTokens.length) return true; // blank/prefix-only requirement = any subject
  const appTokens = hirNormalizeSubjectTokens_(applicantSubjects);
  return reqTokens.some(function (t) { return appTokens.indexOf(t) !== -1; });
}

// Approved-requisition check for one specific campus -- used by the
// Hired-write gate below, which always cares about one applicant's own
// campus rather than the whole set.
function hirApprovalApproved_(campusId, category) {
  return !!hirApprovedCampuses_(category)[campusId];
}

// action=updatehiringstatus (doPost) -- Principal only, own campus
// re-checked server-side (defense in depth, same as the client-side
// filter). Setting status to 'Hired' is the one write this whole module
// actually gates: both the requisition approval (open the role) and the
// hiring-decision approval (approve this specific hire) must already be
// Approved for the applicant's campus, or the write is refused with a
// message naming what's still missing -- Owner/MD's sign-off is a real
// control, not a UI suggestion.
function hiringUpdateStatus_(caller, body) {
  const row = parseInt(body.row, 10);
  if (!row || row < 2) throw new Error('Invalid row');
  const status = String(body.status || '').trim();
  if (HIR_STATUSES.indexOf(status) === -1) throw new Error('Invalid status');

  const sheet = hirSheet_();
  const branches = String(sheet.getRange(row, HIR_COL.BRANCHES).getValue() || '');
  if (caller.campusId !== 'ALL') {
    const tag = 'LMS-' + caller.campusId.replace(/[^0-9]/g, '');
    if (branches.indexOf(tag) === -1) throw new Error('This applicant did not apply to your campus');
  }

  if (status === 'Hired') {
    // The applicant's own campus, not just the caller's -- an Owner
    // (campusId ALL) acting on behalf of a campus must still satisfy
    // THAT campus's approvals.
    const m = branches.match(/LMS-(\d)/);
    const applicantCampus = m ? 'LMS' + m[1] : caller.campusId;
    const missing = [];
    if (!hirApprovalApproved_(applicantCampus, 'Hiring / New Position')) missing.push('the "Hiring / New Position" requisition');
    if (!hirApprovalApproved_(applicantCampus, 'Hiring Decision')) missing.push('the "Hiring Decision" approval for this candidate');
    if (missing.length) {
      throw new Error('Can\'t mark Hired yet -- still waiting on ' + missing.join(' and ') + ' to be Approved.');
    }
  }

  sheet.getRange(row, HIR_COL.STATUS).setValue(status);
  sheet.getRange(row, HIR_COL.NOTES).setValue(String(body.notes || ''));
  if (body.interviewAt) sheet.getRange(row, HIR_COL.INTERVIEW_AT).setValue(new Date(body.interviewAt));
  return hiringApplicants_(caller);
}

// action=hiringcheckinterviewreport -- looks up the "Interview Report
// Form (Responses)" sheet by phone number (the one reliable shared key
// -- that sheet has no applicant-name normalization to trust).
// Read-only, warns, never blocks.
function hiringCheckInterviewReport_(phone) {
  const target = hirNormalizePhone_(phone);
  if (!target) return { found: false };
  const values = SpreadsheetApp.openById(HIR_IR_SHEET_ID).getSheets()[0].getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (hirNormalizePhone_(r[HIR_IR_COL.PHONE]) === target) {
      return { found: true, remarks: String(r[HIR_IR_COL.REMARKS] || '').trim(), pdf: String(r[HIR_IR_COL.PDF] || '').trim() };
    }
  }
  return { found: false };
}

// action=hiringcheckdocuments -- looks up a campus's "Staff Document
// Submission" sheet by name (no phone column there, so name is the only
// key -- best-effort, hence warn-only). Finds required documents by
// header keyword rather than fixed column index, since the real sheets
// have duplicate columns from merged form revisions.
function hiringCheckDocuments_(campusId, name) {
  const sheetId = HIR_DOC_SHEET_IDS[campusId];
  if (!sheetId) return { found: false, reason: 'No document sheet configured for ' + campusId };
  const values = SpreadsheetApp.openById(sheetId).getDataRange().getValues();
  if (!values.length) return { found: false };
  const header = values[0].map(function (h) { return String(h || '').toUpperCase(); });

  const target = hirNormalizeName_(name);
  let row = null;
  for (let i = 1; i < values.length; i++) {
    if (hirNormalizeName_(values[i][2]) === target) { row = values[i]; break; } // col C = Employee Name
  }
  if (!row) return { found: false };

  const missing = [];
  Object.keys(HIR_REQUIRED_DOC_KEYWORDS).forEach(function (label) {
    const keywords = HIR_REQUIRED_DOC_KEYWORDS[label];
    const matchingCols = header
      .map(function (h, idx) { return keywords.some(function (k) { return h.indexOf(k) !== -1; }) ? idx : -1; })
      .filter(function (idx) { return idx !== -1; });
    const present = matchingCols.some(function (idx) { return String(row[idx] || '').trim() !== ''; });
    if (!present) missing.push(label);
  });
  return { found: true, complete: missing.length === 0, missing: missing };
}
