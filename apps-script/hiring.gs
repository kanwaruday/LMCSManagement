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

// Guards against corrupted sheet cells (e.g. a Timestamp cell containing
// stray text instead of a date, seen live 2026-09-25) -- new Date(v)
// throws on .toISOString() for anything unparseable, which would
// otherwise take down hiringApplicants_ for EVERY applicant just
// because one row's data is bad.
function hirSafeISO_(v) {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

// 2026-09-25, per Uday: LMS1/LMS2/LMS3 are one district cluster, LMS4/
// LMS5/LMS6 another -- an applicant who only ticked one campus on the
// form can end up hired at a sister campus in the same district, so a
// locked Principal now browses their WHOLE district's applicants, not
// just rows that literally mention their own campus tag. Owner/ALL is
// unaffected (already sees everything approved anywhere).
const HIR_DISTRICT_CAMPUSES = {
  LMS1: ['LMS1', 'LMS2', 'LMS3'], LMS2: ['LMS1', 'LMS2', 'LMS3'], LMS3: ['LMS1', 'LMS2', 'LMS3'],
  LMS4: ['LMS4', 'LMS5', 'LMS6'], LMS5: ['LMS4', 'LMS5', 'LMS6'], LMS6: ['LMS4', 'LMS5', 'LMS6'],
};
function hirDistrictCampuses_(campusId) { return HIR_DISTRICT_CAMPUSES[campusId] || [campusId]; }

// action=hiringapplicants -- an applicant row is visible only if AT LEAST
// ONE campus in its Branches column currently has an Approved "Hiring /
// New/ Backup Position" AND that requisition's required subjects overlap the
// applicant's own Subjects (hirSubjectsMatch_ -- a blank requirement is
// a wildcard, so this doesn't newly hide anything that was visible
// before subjects existed on the form). A locked Principal is further
// narrowed to their own DISTRICT's campuses only (HIR_DISTRICT_CAMPUSES,
// by the same "LMS-N" substring tag the sheet's own per-campus tabs
// use) -- not just their exact campus, since 2026-09-25; Owner/
// Coordinator (campusId 'ALL') see the union across every approved+
// matching campus network-wide -- NOT everyone unconditionally.
//
// 2026-09-25, per Uday: source of truth is the "Form Responses 1" tab
// this file already reads (HIR_SHEET_GID) -- the per-campus tabs (LMS
// 1..6) in that same spreadsheet are just FILTER()-formula views of it
// for humans to skim, not a separate data source, and are never read
// here. Walk-in interviewees who never filled the Google Form are a
// deliberately separate mechanism (not this sheet) -- out of scope for
// this file until that's built.
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
// Visible applicants also get a matchScore (0-100, see hirScoreApplicant_)
// against the best-fitting requisition they're relevant to, and the list
// is sorted highest-first -- "showcase the best matches," not just a
// filtered dump in sheet order.
//
// Deduped by phone number server-side (one implementation instead of
// every caller re-deduping) -- keeps the most recent submission,
// backfilling a missing CV link from an older duplicate that had one.
function hiringApplicants_(caller) {
  const requisitions = hirApprovedRequisitions_('New/ Backup Position');
  // District-wide, not single-campus, for a locked caller (see
  // HIR_DISTRICT_CAMPUSES above) -- Owner/ALL keeps seeing the union
  // across every approved campus, same as before.
  const visibleCampuses = caller.campusId === 'ALL' ? null : hirDistrictCampuses_(caller.campusId);
  const hasApproval = visibleCampuses ? visibleCampuses.some(function (c) { return !!requisitions[c]; }) : Object.keys(requisitions).length > 0;
  if (!hasApproval) {
    // Covers both a locked caller whose whole district has nothing
    // approved, and the ALL case where literally no campus anywhere
    // does -- same "gated" signal either way, so the frontend shows one
    // consistent message instead of a bare empty table.
    return { success: true, statuses: HIR_STATUSES, applicants: [], gated: true };
  }
  const values = hirSheet_().getDataRange().getValues();
  const byPhone = {};
  const order = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r[HIR_COL.NAME - 1]) continue;
    const branches = String(r[HIR_COL.BRANCHES - 1] || '').trim();
    const subjects = String(r[HIR_COL.SUBJECTS - 1] || '').trim();

    // Every requisition (across every campus this applicant applied to,
    // or just the caller's own district when locked) that this
    // applicant actually matches -- collected, not just tested as a
    // boolean, so hirScoreApplicant_ below can score against the BEST
    // of them (an applicant can be relevant to more than one open role
    // at once).
    const relevantReqs = [];
    Object.keys(requisitions).forEach(function (c) {
      if (visibleCampuses && visibleCampuses.indexOf(c) === -1) return; // outside caller's district
      const campusTag = 'LMS-' + c.replace(/[^0-9]/g, '');
      if (branches.indexOf(campusTag) === -1) return;
      requisitions[c].forEach(function (req) { if (hirSubjectsMatch_(req.subjects, subjects)) relevantReqs.push(req); });
    });
    if (!relevantReqs.length) continue;

    const phone = hirNormalizePhone_(r[HIR_COL.PHONE - 1]);
    const applicant = {
      row: i + 1, // 1-based sheet row, used to write status/notes back
      timestamp: hirSafeISO_(r[HIR_COL.TIMESTAMP - 1]),
      name: String(r[HIR_COL.NAME - 1] || '').trim(),
      phone: String(r[HIR_COL.PHONE - 1] || '').trim(),
      age: String(r[HIR_COL.AGE - 1] || '').trim(),
      subjects: subjects,
      branches: branches,
      qualification: String(r[HIR_COL.QUALIFICATION - 1] || '').trim(),
      bed: String(r[HIR_COL.BED - 1] || '').trim(),
      gender: String(r[HIR_COL.GENDER - 1] || '').trim(),
      cv: String(r[HIR_COL.CV - 1] || '').trim(),
      status: String(r[HIR_COL.STATUS - 1] || '').trim() || 'New',
      notes: String(r[HIR_COL.NOTES - 1] || '').trim(),
      interviewAt: hirSafeISO_(r[HIR_COL.INTERVIEW_AT - 1]),
    };
    const scored = hirScoreApplicant_(applicant, relevantReqs);
    applicant.matchScore = scored.total;
    applicant.matchRemarks = scored.remarks;

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
  const applicants = order.map(function (k) { return byPhone[k]; })
    .sort(function (a, b) { return b.matchScore - a.matchScore; });
  // NOT `gated: true` here even if this comes out empty -- unlike the
  // two checks above (nobody approved ANYTHING), a genuinely empty
  // result after subject-matching means "approved roles exist, just no
  // applicant matches them yet," which is real, informative emptiness,
  // not the same "nothing's been requested" state the gated message is for.
  return { success: true, statuses: HIR_STATUSES, applicants: applicants };
}

// action=hiringapprovalstatus -- district-scoped approval detail for the
// Hiring Dashboard's status strip. Deliberately NOT reusing
// action=approvalslist (aprList_ in approvals.gs), which scopes a locked
// Principal to ONLY their own campus's approvals -- correct for that
// generic Approvals tab (a sister campus's Compensation Change or
// Disciplinary request is nobody else's business), but hiringApplicants_
// above now shows a locked Principal their whole DISTRICT's applicants
// (2026-09-25), so the strip needs to say which district campus(es)
// actually hold the approval unlocking that view, without widening the
// general endpoint's PII scoping for every other category.
function hiringApprovalStatus_(caller) {
  const visibleCampuses = caller.campusId === 'ALL' ? Object.keys(HIR_DISTRICT_CAMPUSES) : hirDistrictCampuses_(caller.campusId);
  const newPosition = hirApprovedRequisitions_('New/ Backup Position');
  const hiringDecision = hirApprovedCampuses_('Hiring Decision');
  return {
    success: true,
    campuses: visibleCampuses.map(function (c) {
      return { campusId: c, newPositions: newPosition[c] || [], hiringDecisionApproved: !!hiringDecision[c] };
    }),
  };
}

// "TGT: Science, Math" (or bare "NTT") -> {roleLevel, subjectsRaw} --
// the Approvals side stores role level + subjects as one itemName
// string (no new sheet column -- see approvals.gs's aprSyncHiringItemName_
// equivalent on the frontend), this undoes that for matching/scoring,
// which only ever care about the subjects part.
function hirParseRequisitionItem_(itemName) {
  const s = String(itemName || '').trim();
  // COMPUTER/PTI and the 9 non-teaching/specialist codes below added
  // 2026-09-24 -- real EmpSalary designations distinct from the PRT/
  // TGT/PGT ladder, all confirmed to hire through this same Teaching
  // Applicants sheet (a requisition for any of them still unlocks
  // Hiring Dashboard visibility via the blank-subjects wildcard in
  // hirSubjectMatchStrength_, same as every other role here).
  // PTISR listed BEFORE PTI -- regex alternation tries left-to-right, so
  // "PTI" alone would otherwise greedily match inside "PTISR: ..." and
  // leave "SR: ..." as a bogus subjectsRaw. Longer/more-specific
  // alternative has to come first whenever one code is a prefix of another.
  const m = s.match(/^(NTT|PRT|TGT|PGT|COMPUTER|PTISR|PTI|ACTIVITY|DRAWING|LIBRARIAN|DRIVER|HELPER|SWEEPER|TECHNICIAN|GARDENER|CLERK)\s*[:—-]?\s*(.*)$/i);
  return m ? { roleLevel: m[1].toUpperCase(), subjectsRaw: m[2].trim() } : { roleLevel: '', subjectsRaw: s };
}

// campusId -> [{subjects, roleLevel, openings}] for every Approved
// requisition of this category -- 2026-09-14, per Uday: "Hiring / New
// Position" now carries WHAT was approved (itemName/quantity on the
// Approvals row, reused the same way Compensation Change reuses Item/
// Amount -- see approvals.gs's APR_ITEM_CATEGORIES), so
// hiringApplicants_ above can filter to applicants matching the
// approved subject, not just "SOME position is open at this campus."
// A blank subjects string (any requisition approved before this field
// existed, submitted without specifying subjects, or a bare NTT
// posting) means "any subject" -- wildcard, not "matches nothing" --
// see hirSubjectsMatch_. Reuses approvals.gs's aprSheet_()/APR_STATUS
// -- same Apps Script project, same global scope, no duplicate
// sheet-read logic.
function hirApprovedRequisitions_(category) {
  const values = aprSheet_().getDataRange().getValues();
  const byCampus = {};
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (String(row[2]) !== category) continue;
    if (String(row[13]) !== APR_STATUS.APPROVED) continue;
    const campusId = String(row[1]).trim();
    const parsed = hirParseRequisitionItem_(row[7]);
    if (!byCampus[campusId]) byCampus[campusId] = [];
    byCampus[campusId].push({ subjects: parsed.subjectsRaw, roleLevel: parsed.roleLevel, openings: row[8] === '' ? null : Number(row[8]) });
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

// ── Subject canonicalization ──────────────────────────────────────
// 2026-09-14, confirmed by reading real rows in the Teaching Applicants
// sheet (not assumed): staff records (EmpAcademic/add-employee.html)
// and real applicant submissions use DIFFERENT words for the same
// subject -- "Math" (staff) vs "Mathematics" (applicants), "Social
// Science" vs "Social Sciences", "P.Ed" vs "Physical Education",
// "Information Technology" vs "Computer"/"Computer Sciences". Every
// variant maps to one canonical key so a requisition (staff wording)
// and an applicant (their own wording) actually find each other
// instead of silently missing -- and so "Political Science" no longer
// false-positives against a plain "Science" requirement the way a
// naive shared-word check would (both contain the word "science").
const HIR_SUBJECT_CANON = {
  math: ['Math', 'Maths', 'Mathematics'],
  science: ['Science', 'Sciences'],
  socialscience: ['Social Science', 'Social Sciences'],
  ped: ['P.Ed', 'PEd', 'Physical Education'],
  infotech: ['Information Technology', 'Computer', 'Computer Science', 'Computer Sciences'],
  english: ['English'], hindi: ['Hindi'], sanskrit: ['Sanskrit'],
  history: ['History'], geography: ['Geography'],
  polsci: ['Political Science', 'Civics'],
  economics: ['Economics'], accountancy: ['Accountancy'],
  bstudies: ['Business Studies', 'Commerce'],
  physics: ['Physics'], chemistry: ['Chemistry'], biology: ['Biology'],
  evs: ['E.V.S.', 'EVS'], gk: ['GK', 'General Knowledge'],
  cogact: ['Cognitive Activities'], ntt: ['NTT'],
};
function hirNormalizeSubjectPhrase_(s) {
  return String(s || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim().replace(/\s+/g, ' ');
}
const HIR_SUBJECT_LOOKUP_ = (function () {
  const map = {};
  Object.keys(HIR_SUBJECT_CANON).forEach(function (key) {
    HIR_SUBJECT_CANON[key].forEach(function (variant) { map[hirNormalizeSubjectPhrase_(variant)] = key; });
  });
  return map;
})();
// Unrecognized phrase passes through as its own (normalized) key rather
// than being dropped -- fails open (still comparable/visible) instead
// of silently vanishing if a genuinely new subject shows up.
function hirCanonicalSubjectKey_(phrase) {
  const norm = hirNormalizeSubjectPhrase_(phrase);
  return norm ? (HIR_SUBJECT_LOOKUP_[norm] || norm) : '';
}
function hirSplitSubjects_(s) {
  return String(s || '').split(/,|&|\band\b/i).map(hirCanonicalSubjectKey_).filter(Boolean);
}

// "Adjoining" subjects -- per Uday: "a Geography teacher is usually
// capable of teaching complete Social Science to younger kids." A
// specialist in a COMPONENT subject is treated as a match (weaker than
// exact) for the COMBINED subject a younger-class posting actually asks
// for, and vice versa -- built one direction then mirrored below so it
// works from either side. `ponytail:` hand-picked clusters (History/
// Geography/Political Science/Economics -> Social Science; Physics/
// Chemistry/Biology -> Science), not exhaustive -- extend if another
// real adjacency comes up.
const HIR_SUBJECT_ADJACENCY = {
  socialscience: ['history', 'geography', 'polsci', 'economics'],
  science: ['physics', 'chemistry', 'biology'],
};
(function () {
  Object.keys(HIR_SUBJECT_ADJACENCY).forEach(function (combined) {
    HIR_SUBJECT_ADJACENCY[combined].forEach(function (component) {
      if (!HIR_SUBJECT_ADJACENCY[component]) HIR_SUBJECT_ADJACENCY[component] = [];
      if (HIR_SUBJECT_ADJACENCY[component].indexOf(combined) === -1) HIR_SUBJECT_ADJACENCY[component].push(combined);
    });
  });
})();

// 1 = exact/alias match, 0.6 = adjacency-cluster match (capable but not
// a stated specialization), 0 = no match. Blank `required` = any
// subject (wildcard -- see hirApprovedRequisitions_).
function hirSubjectMatchStrength_(required, applicantSubjects) {
  const reqKeys = hirSplitSubjects_(required);
  if (!reqKeys.length) return 1;
  const appKeys = hirSplitSubjects_(applicantSubjects);
  if (!appKeys.length) return 0;
  let best = 0;
  reqKeys.forEach(function (rk) {
    if (appKeys.indexOf(rk) !== -1) { best = 1; return; }
    if (best < 1 && (HIR_SUBJECT_ADJACENCY[rk] || []).some(function (adj) { return appKeys.indexOf(adj) !== -1; })) best = Math.max(best, 0.6);
  });
  return best;
}
function hirSubjectsMatch_(required, applicantSubjects) {
  return hirSubjectMatchStrength_(required, applicantSubjects) > 0;
}

// ── HR-style match scoring (2026-09-14, per Uday) ───────────────────
// Ranks VISIBLE applicants (already subject-gated above) by fit, out of
// 100, instead of leaving them in arbitrary sheet order. Weighted the
// way an HR reviewer actually would for a teaching post in India:
// B.Ed/TET is the single strongest real signal (NCTE/RTE requirements,
// 30 pts) > subject fit (40 pts, but discounted for "hedging" -- an
// applicant who checked 6 subjects and yours happens to be one of them
// is a weaker specialist match than one who checked exactly 1-2) >
// qualification level appropriate to the role (20 pts) > recency as a
// tiebreaker (10 pts). `ponytail:` hand-tuned weights, not statistically
// derived -- revisit once real hiring outcomes show whether this
// actually orders candidates well.
function hirBedScore_(bedRaw) {
  const s = String(bedRaw || '').toLowerCase();
  // Per Uday: "Not applicable should land them a 0, with a clear
  // remark explaining why" -- not folded into the generic "No" tier.
  if (s.indexOf('not applicable') !== -1) return { score: 0, remark: 'B.Ed/TET: Not Applicable' };
  if (/tet\s*not\s*qualified/.test(s)) return { score: 20, remark: 'B.Ed, TET not qualified' };
  if (/tet\s*qualified/.test(s)) return { score: 30, remark: 'B.Ed + TET qualified' };
  if (s.indexOf('yes') !== -1) return { score: 20, remark: 'B.Ed (TET status unclear)' };
  if (s.indexOf('no') !== -1) return { score: 5, remark: 'No B.Ed' };
  return { score: 15, remark: 'B.Ed/TET status unclear' };
}

// Masters matters more the higher the role level -- PGT needs subject
// depth for senior secondary, PRT/NTT don't need it at all. Computer
// Teacher/PTI (2026-09-24) are specialist, not part of that academic
// ladder, so Bachelors is just as fine as Masters for either.
const HIR_QUALIFICATION_EXPECTATION = {
  NTT: 'either', PRT: 'either', TGT: 'masters-preferred', PGT: 'masters-preferred', COMPUTER: 'either', PTI: 'either', PTISR: 'either',
  // Non-teaching/specialist roles (2026-09-24) -- Masters is never a
  // meaningful expectation for these, same treatment as NTT.
  ACTIVITY: 'either', DRAWING: 'either', LIBRARIAN: 'either',
  DRIVER: 'either', HELPER: 'either', SWEEPER: 'either', TECHNICIAN: 'either', GARDENER: 'either', CLERK: 'either',
};
function hirQualificationScore_(qualification, roleLevel) {
  const isMasters = String(qualification || '').toLowerCase().indexOf('master') !== -1;
  const expectation = HIR_QUALIFICATION_EXPECTATION[roleLevel] || 'masters-preferred';
  if (expectation === 'either' || isMasters) return { score: 20, remark: '' };
  return { score: 12, remark: 'Bachelors only (Masters preferred for ' + (roleLevel || 'this role') + ')' };
}

function hirRecencyScore_(timestampISO) {
  if (!timestampISO) return 5;
  const days = (Date.now() - new Date(timestampISO).getTime()) / 86400000;
  if (days <= 30) return 10;
  if (days >= 180) return 2; // floor, not zero -- a great candidate from 7 months ago is still worth a look
  return Math.round(10 - (days - 30) * 8 / 150);
}

// One applicant's fit, scored against the BEST-matching of the
// requisitions they're relevant to (an applicant can be relevant to
// more than one open role at once -- see hiringApplicants_).
function hirScoreApplicant_(applicant, relevantReqs) {
  let best = null;
  relevantReqs.forEach(function (req) {
    const reqKeys = hirSplitSubjects_(req.subjects);
    const appKeys = hirSplitSubjects_(applicant.subjects);
    const evalKeys = reqKeys.length ? reqKeys : [''];
    const strengths = evalKeys.map(function (rk) { return hirSubjectMatchStrength_(rk, applicant.subjects); });
    const avgStrength = strengths.reduce(function (a, b) { return a + b; }, 0) / strengths.length;
    if (avgStrength <= 0) return; // this requisition doesn't actually apply to this applicant
    // "Hedging" discount -- narrower, more targeted subject lists score
    // higher than a long list that happens to include the match too.
    const matchedCount = evalKeys.filter(function (rk) { return hirSubjectMatchStrength_(rk, applicant.subjects) > 0; }).length;
    const specializationRatio = appKeys.length ? Math.max(0.5, matchedCount / appKeys.length) : 0.5;
    const subjectScore = Math.round(40 * avgStrength * specializationRatio);

    const bed = hirBedScore_(applicant.bed);
    const qual = hirQualificationScore_(applicant.qualification, req.roleLevel);
    const recency = hirRecencyScore_(applicant.timestamp);
    const total = subjectScore + bed.score + qual.score + recency;
    if (!best || total > best.total) {
      best = { total: total, breakdown: { subject: subjectScore, bed: bed.score, qualification: qual.score, recency: recency }, remarks: [bed.remark, qual.remark].filter(Boolean) };
    }
  });
  return best || { total: 0, breakdown: {}, remarks: [] };
}

// Approved-requisition check for one specific campus -- used by the
// Hired-write gate below, which always cares about one applicant's own
// campus rather than the whole set.
function hirApprovalApproved_(campusId, category) {
  return !!hirApprovedCampuses_(category)[campusId];
}

// action=updatehiringstatus (doPost) -- Principal only, own DISTRICT
// re-checked server-side (defense in depth, same as the client-side
// filter -- 2026-09-25: widened from own-campus-only alongside the
// district-wide browse change, since a Principal can now be acting on
// an applicant from a sister campus). Setting status to 'Hired' is the
// one write this whole module actually gates: both the requisition
// approval (open the role) and the hiring-decision approval (approve
// this specific hire) must already be Approved for the campus actually
// doing the hiring, or the write is refused with a message naming
// what's still missing -- Owner/MD's sign-off is a real control, not a
// UI suggestion.
function hiringUpdateStatus_(caller, body) {
  const row = parseInt(body.row, 10);
  if (!row || row < 2) throw new Error('Invalid row');
  const status = String(body.status || '').trim();
  if (HIR_STATUSES.indexOf(status) === -1) throw new Error('Invalid status');

  const sheet = hirSheet_();
  const branches = String(sheet.getRange(row, HIR_COL.BRANCHES).getValue() || '');
  if (caller.campusId !== 'ALL') {
    const districtTags = hirDistrictCampuses_(caller.campusId).map(function (c) { return 'LMS-' + c.replace(/[^0-9]/g, ''); });
    if (!districtTags.some(function (t) { return branches.indexOf(t) !== -1; })) {
      throw new Error('This applicant did not apply to your district');
    }
  }

  if (status === 'Hired') {
    // The campus actually doing the hiring is the CALLER's own campus,
    // not necessarily whichever campus the applicant happened to list
    // first on the form -- a locked Principal browsing their district
    // can now mark Hired for a candidate who only ticked a sister
    // campus, and it's their own school's approvals that matter. Owner/
    // ALL has no single campus of their own to default to, so it keeps
    // the old branches-parse fallback (first campus mentioned) for that
    // one case only.
    const branchMatch = branches.match(/LMS-(\d)/);
    const applicantCampus = caller.campusId !== 'ALL' ? caller.campusId : (branchMatch ? 'LMS' + branchMatch[1] : caller.campusId);
    const missing = [];
    if (!hirApprovalApproved_(applicantCampus, 'New/ Backup Position')) missing.push('the "New/ Backup Position" requisition');
    if (!hirApprovalApproved_(applicantCampus, 'Hiring Decision')) missing.push('the "Hiring Decision" approval for this candidate');
    if (missing.length) {
      throw new Error('Can\'t mark Hired yet -- still waiting on ' + missing.join(' and ') + ' to be Approved.');
    }
  }

  sheet.getRange(row, HIR_COL.STATUS).setValue(status);
  sheet.getRange(row, HIR_COL.NOTES).setValue(String(body.notes || ''));
  if (body.interviewAt) {
    // Guard the write side too -- an unparseable value here would plant
    // the exact same class of corrupted-cell bug hirSafeISO_ above
    // exists to survive on read (a real "F"-in-a-Timestamp-cell was
    // found live 2026-09-25). Silently skips the write rather than
    // saving garbage; Status/Notes above still get saved either way.
    const interviewDate = new Date(body.interviewAt);
    if (!isNaN(interviewDate.getTime())) sheet.getRange(row, HIR_COL.INTERVIEW_AT).setValue(interviewDate);
  }
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
