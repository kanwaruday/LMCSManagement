// ═══════════════════════════════════════════════════════════════════
// SS Forms Sync — a generic engine for keeping every LMCS "Support
// Session" (formerly "Daily Report"/DR) Google Form correct and its
// name dropdown live, driven by EmpMaster. One role (Teacher) is
// fully wired below; the others (PTI, IT/Computer, Fee Clerk cum PRO,
// Principal Self-SS) are stubbed out — see "ADDING A NEW ROLE" at the
// bottom.
//
// TERMINOLOGY (2026-09-02): "DR" (Daily Report) for teachers was
// renamed to "SS" (Support Session) by Uday. The 6 Teacher Forms and
// their response sheet's file title have been renamed to match
// ("LMS N Teacher SS (Qualitative) 2026 for Heads",
// "LMCS Teacher SS 2026 (Responses)") — only the response SHEET'S
// internal TAB names ("LMS 1 Teacher DR" etc.) still say DR, since
// Google Forms doesn't auto-rename an already-linked destination tab
// and tab renames aren't reachable via the tools used to rename
// everything else here. teacher-ss-dashboard-proxy.gs's
// TSS_CAMPUS_TO_TAB still points at the DR-named tabs deliberately —
// don't "fix" that without renaming the actual tabs first, or the
// dashboard will break. The OTHER 4 roles' names (PTI DR, IT DR, Fee
// Clerk DR, Principal DR) were NOT part of this rename — Uday's
// correction was specifically "for teachers".
//
// WHY GENERIC (2026-09-01): per Uday, Support Session forms are
// planned for every employee category, not just teachers — see the
// "Principal's Daily Reporting" project note. The other 4 roles' forms
// already exist (PTI DR, IT DR, Fee Clerk DR, Principal DR — all
// single forms covering all 6 campuses via an in-form School question,
// unlike Teacher's one-form-per-campus layout) but are still on the
// OLD rubric/structure and are explicitly not-yet-viewable/finalized —
// their rubric, Principal-performance factors, and comms system are
// deferred to Uday (see project_principals_daily_reporting.md). DO NOT
// guess their question structure — read the live form with FormApp
// first (see ADDING A NEW ROLE) once Uday finalizes each one, rather
// than assuming it matches Teacher's shape.
//
// IMPORTANT (2026-09-02, confirmed by Uday, correcting an earlier
// "fresh backend, no Forms" direction from a different session): the
// 6 Teacher SS Google Forms ARE the real, ongoing submission mechanism
// for the Teaching-SS portal module — this script and the Forms it
// fixes are NOT being replaced. Keep this file; do not delete it in
// favor of a Forms-free rebuild without checking with Uday first.
//
// SETUP:
//   1. script.google.com -> "LMCS Principal's Daily Reporting Backend"
//      project (2026-09-02: renamed/consolidated, see main.gs's header) ->
//      paste this file in as ss-forms-sync.gs
//   2. Run syncAllSSForms() once manually (Run menu) — authorize when
//      prompted (edit access to the forms in SS_ROLE_CONFIGS, read
//      access to the Employee Master workbook)
//   3. Run installDailySSSyncTrigger() once — re-runs syncAllSSForms()
//      daily so every configured role's teacher list stays live and
//      any range fixes stay applied.
// ═══════════════════════════════════════════════════════════════════

const SS_EMP_SHEET_ID = '1OjVMUvpLM8JkdAwjmljCtZUI1VUqGLbic36cW9dm0C0'; // LMCSStaffMasters
const SS_PREFIX_TO_SCHOOL = {
  KUL: 'LMS 1', KEL: 'LMS 2', DUN: 'LMS 3', NCM: 'LMS 4', SAY: 'LMS 5', JOG: 'LMS 6',
};

// KNOWN DATA-QUALITY CAVEAT (updated 2026-09-09, via employee-roster.gs's
// readDesignationSummary() action=designations): EmpSalary's Department
// column is NO LONGER the old 3-way Teaching/Non-Teaching/Administrative
// split described here before -- it now has role-specific buckets too
// (AdminIT, AdminPTI, AdminClerk, AdminHead, AdminTM, ...), which is what
// makes matchesEmployee below possible for the 3 new roles. Some cells
// carry an invisible leading character (a stray word-joiner, not visible
// in the Sheet) and inconsistent casing (e.g. "CLERK+PRO" vs "Clerk +
// PRO") -- normalizeCell_() strips both before any comparison. A handful
// of clearly-teaching records (2026-09-02 audit) had a BLANK Department
// cell instead of "Teaching", not yet corrected -- if a real teacher
// unexpectedly disappears from a campus's dropdown, check their EmpSalary
// row's Department cell first before assuming a bug here.
function normalizeCell_(v) {
  // Strips zero-width space/joiner/non-joiner (U+200B-U+200D), LTR/RTL
  // marks (U+200E-U+200F), BOM (U+FEFF), and word-joiner (U+2060) -- the
  // invisible characters observed polluting a few Designation/Department
  // cells (2026-09-09). Written as \u escapes, not literal glyphs, since
  // the glyphs themselves are invisible and easy to corrupt in an editor.
  return String(v || '').replace(/[\u200B-\u200F\uFEFF\u2060]/g, '').trim();
}

function getDepartmentByCode_() {
  const rows = SpreadsheetApp.openById(SS_EMP_SHEET_ID)
    .getSheetByName('EmpSalary')
    .getDataRange()
    .getValues();
  const header = rows[0];
  const codeCol = header.indexOf('EmployeeCode');
  const deptCol = header.indexOf('Department');
  const map = {};
  if (codeCol < 0 || deptCol < 0) return map; // sheet shape unexpected -- fail open to empty, not a crash
  for (let i = 1; i < rows.length; i++) {
    const code = normalizeCell_(rows[i][codeCol]);
    if (!code) continue;
    map[code] = normalizeCell_(rows[i][deptCol]);
  }
  return map;
}

// ── Role configs ──────────────────────────────────────────────────
// Each entry describes ONE SS form family. `perCampus: true` means one
// form per school (keyed 'LMS 1'..'LMS 6', like Teacher); `perCampus:
// false` means a single form covering all schools (name field doesn't
// vary by school, and the employee-choice list should span every
// school this role applies to, typically distinguished by including a
// School question elsewhere in the form that this engine leaves
// alone).
const SS_ROLE_CONFIGS = {
  teacher: {
    label: 'Teacher SS',
    perCampus: true,
    forms: {
      'LMS 1': '1BvUT49YVbGPAH-BLBdjkZ6FoBmMLnzNDQlRu3j2bIEw',
      'LMS 2': '16T084-3WDTnpINA76qfSKODXXhOM0wO5B4qMDcE8w4M',
      'LMS 3': '1rrM4Y6jE_k23WLMLqjeB9VPNC_EzsTu3YT_Z-GRqBQk',
      'LMS 4': '1lL1gF2D_2WgsRKk_4pAMesuFCgwvpIGlYpyuPXwNIro',
      'LMS 5': '11otlIiFKWQ5tZ2JfxyyL4pn_5ManI8Oc1LoIbj3o2-0',
      'LMS 6': '1VZhZ2b1nZlRT2X_YiqJhvArlpnd5WjOaXGv1WcROXpI',
    },
    // Where this role's SUBMITTED RESPONSES live -- used by ss-tracker.gs
    // for the Dashboard, separate from `forms` above (which is the
    // editable Form itself). Confirmed live via a tab inspection
    // 2026-09-09 (see teacher-ss.gs's TERMINOLOGY note -- these tabs
    // WERE "Teacher DR", got silently renamed to "Teacher SS").
    responseSheetId: '1cP-f8ShSJJPMBXkQCfkSvmajPA1db6fMBOPCbLH3oIc', // "LMCS Teacher SS 2026 (Responses)"
    responseTabs: {
      'LMS 1': 'LMS 1 Teacher SS', 'LMS 2': 'LMS 2 Teacher SS', 'LMS 3': 'LMS 3 Teacher SS',
      'LMS 4': 'LMS 4 Teacher SS', 'LMS 5': 'LMS 5 Teacher SS', 'LMS 6': 'LMS 6 Teacher SS',
    },
    rubricTitles: [
      'Pedagogy',
      'Teacher Content',
      'Student Response',
      'Activity Based Approach',
      'Notebook Checking of Students',
      'BUTCHER Scheme',
      'Discipline- English, Aerobics, Morning Assembly & Dispersal',
      'Extra Curricular (Non Academic Competitions)',
      'Attitude Towards School',
      'Dedication Towards Class',
    ],
    rubricMax: 10,
    // Per-campus form -> its name-question title is literally that
    // campus's label + ' Teacher Name' (matches the live forms exactly
    // -- this field's title was NOT part of the DR->SS rename).
    nameFieldTitle: function (school) { return school + ' Teacher Name'; },
    // Which EmpMaster rows count as "a Teacher" for this campus: same
    // campus AND EmpSalary.Department === 'Teaching' (case-insensitive,
    // trimmed -- see the data-quality caveat above getDepartmentByCode_()).
    matchesEmployee: function (empRow, school) {
      return empRow.school === school && empRow.department.toLowerCase() === 'teaching';
    },
  },

  // Rubric finalized by Uday 2026-09-08. These are BRAND-NEW forms,
  // built by hand (see "NEW SS FORMS" note near the bottom of this
  // file) -- the old forms noted in each `forms` comment are on the
  // stale rubric and are NOT reused. Response sheet is the same
  // "LMCS Teacher SS 2026 (Responses)" spreadsheet as Teacher SS, each
  // in its own new tab (see teacher-ss.gs's TSS_CAMPUS_TO_TAB for the
  // equivalent pattern -- these 3 roles' tab names still need adding
  // there once the Dashboard reads their responses). matchesEmployee()
  // wired 2026-09-09 against the real Department taxonomy (confirmed
  // via employee-roster.gs's action=designations) and added to
  // ACTIVE_SS_ROLES -- run syncAllSSForms() once to confirm it applies
  // cleanly (per "ADDING A NEW ROLE" step 4 below) before relying on
  // the daily trigger for it.
  itComputer: {
    label: 'IT Teacher SS',
    perCampus: false, // one form, all 6 campuses (matches the old IT DR form's shape)
    forms: { all: '1sADIFMrO2NiEiszc_-iTS86BuvQEdeTTTu0FGclnqIc' }, // old (stale rubric, unused): 1E1hsC4EDjeeCszK3HviOFK_3NrwZ24E1QMBm04WBcgc
    responseSheetId: '1cP-f8ShSJJPMBXkQCfkSvmajPA1db6fMBOPCbLH3oIc', // same sheet as Teacher SS, own tab
    responseTabs: { all: 'LMCS Computer Teacher SS' },
    // Titles below match the LIVE form exactly (confirmed via
    // inspectNewSSForms() 2026-09-09) -- wording drifted slightly from
    // the originally-dictated rubric while Uday built the form by hand
    // (e.g. "Period Adjustment" not "Adjustments", "Computer Lab
    // Operational" not "Operationability"). The form is the source of
    // truth for exact strings; don't "fix" these back to the original
    // dictated wording.
    rubricTitles: [
      'Pedagogy',
      'Teacher Content & Student Response',
      'Aerobics, Morning Assembly & Dispersal Duty',
      'Period Adjustment & Quality of Time Table',
      'Administrative Duties & Data Collection',
      'IT Support to Principal & Staff',
      'Computer Lab Operational',
      'CCTV Functionality',
      'Social Media',
      'Attitude Towards LMS',
    ],
    rubricMax: 10,
    nameFieldTitle: function () { return 'Computer Teacher Name'; },
    // Department taxonomy confirmed 2026-09-09 via action=designations --
    // "AdminIT" covers the 4 active Computer Teacher records (designation
    // text itself varies -- "Computer Teacher" with a stray invisible
    // leading character on one row -- but Department doesn't, so match on
    // that, not designation text). No school filter: perCampus:false.
    matchesEmployee: function (empRow) { return empRow.department.toLowerCase() === 'adminit'; },
  },

  pti: {
    label: 'PTI SS',
    perCampus: false,
    forms: { all: '1KMn6bCSvaQkNJbNjzhaBzP5Ang-itNHU3pVPml2D7Ro' }, // old (stale rubric, unused): 1oAtyo-Q3bm3bbAcrngoPOcUgYO3jgPd9vcFOCgscJYY
    responseSheetId: '1cP-f8ShSJJPMBXkQCfkSvmajPA1db6fMBOPCbLH3oIc', // same sheet as Teacher SS, own tab
    responseTabs: { all: 'LMCS PTI SS' },
    // Titles below match the LIVE form exactly (confirmed via
    // inspectNewSSForms() 2026-09-09) -- NOTE this isn't just wording
    // drift like itComputer/feeClerkPRO: the live form merged "Games
    // periods as per next Sports" + "Participation in Sports
    // Competitions" into ONE question, and added a new "Administrative
    // Duties & Examination Duties" item that wasn't in the originally
    // dictated 10. Flagging in case that wasn't deliberate -- ask Uday
    // to confirm before treating this as final.
    rubricTitles: [
      'Pedagogy',
      'Aerobics, Morning Assembly, Lunch & Dispersal Duty',
      'Participation in Sports Competitions & Games period as per next Sports Event',
      'Period Adjustment & Implementation',
      'Management of Support Staff (during School)',
      'Cleanliness & Maintenance of School',
      'Discipline of Students',
      'Administrative Duties & Examination Duties',
      'Inventory & other records',
      'Attitude towards LMS',
    ],
    rubricMax: 10,
    nameFieldTitle: function () { return 'Physical Training Instructor Name'; },
    // "AdminPTI" covers all 5 active PTI records despite 3 different
    // designation spellings ("Games Teacher (PTI)", "GAMES TEACHER
    // (PTI)", "PTI (11, 12)") -- see itComputer's comment above.
    matchesEmployee: function (empRow) { return empRow.department.toLowerCase() === 'adminpti'; },
  },

  feeClerkPRO: {
    label: 'Fee Clerk SS',
    perCampus: false,
    forms: { all: '1WxeCJMCDN-HEH7Pc4zbSmTqKtd8RWzZkEH7Dn6Bi3As' }, // old (stale rubric, unused): 1mpjTQisZ6BwsPRI2tjc2MgNO05-Y63X5blLdRzSUooM
    responseSheetId: '1cP-f8ShSJJPMBXkQCfkSvmajPA1db6fMBOPCbLH3oIc', // same sheet as Teacher SS, own tab
    responseTabs: { all: 'LMCS Clerk SS' },
    // Titles below match the LIVE form exactly (confirmed via
    // inspectNewSSForms() 2026-09-09) -- wording drifted slightly from
    // the originally-dictated rubric while Uday built the form by hand.
    rubricTitles: [
      'Fee Collection & Follow up',
      'Quality of Financial Record Keeping',
      'Maintenance of Student Records',
      'Maintenance of Staff & School Records',
      'Management of Support Staff (Transport)',
      'Management of Transport Repairs & Finances',
      'Attendance & Leave Duties - Honesty & Regularity',
      'Correspondence & Parcel Handling',
      'Attitude towards School',
      'Soft Skills with Parents',
    ],
    rubricMax: 10,
    nameFieldTitle: function () { return 'Fee Clerk Name'; },
    // "AdminClerk" covers all "Clerk + PRO" / "CLERK+PRO" / "CLERK"
    // records (one row's Department cell itself carried the invisible
    // leading character -- normalizeCell_() in getDepartmentByCode_
    // handles that) -- see itComputer's comment above.
    matchesEmployee: function (empRow) { return empRow.department.toLowerCase() === 'adminclerk'; },
  },

  // Added 2026-09-09. Response sheet: "LMCS Non-Teaching SS (Responses)",
  // 1PHNLl_rdBVzjzpBs0oWFsvYxBDVq7_1i6TRQhwY45ac -- needed later for a
  // teacher-ss.gs-style stats reader (per-campus tab names TBD), not
  // wired yet since that wasn't asked for. Rubric titles below confirmed
  // live via FormApp inspection 2026-09-09 -- this IS the Helper SS
  // rubric drafted earlier this session, wording drifted slightly while
  // Uday built the form by hand (same pattern as itComputer/pti/
  // feeClerkPRO). Name field is literally "Staff Name" on every campus's
  // form, NOT school-prefixed like Teacher's "<School> Teacher Name" --
  // each of the 6 forms is already campus-specific, so no need to vary
  // the field's own title per school. Department matching confirmed
  // live via action=designations: "Non-Teaching" is Helper/Sweeper/
  // Technician/Gardener/N-A -- NOT Driver Cum Peon, which has its own
  // "Transport" department (see the Driver Cum Peon config, once it
  // exists).
  nonTeaching: {
    label: 'Non-Teaching SS',
    perCampus: true, // one form per campus, like Teacher -- see NON_TEACHING_FORM_IDS in index.html
    forms: {
      'LMS 1': '1P-VOQ5eGOlFE8uAf7xG0PcMxU0rmUwHq81tEW698Atg',
      'LMS 2': '1AhqORuik-jFi2OKsBA-wyCsfF5JgpLOY4_h-Nh9pnRU',
      'LMS 3': '1rcpbmkbDQlmb4ZTxBAm86-Pe8wJIV66NvD0tfoPEVNc',
      'LMS 4': '1ZdQ9oOrnmgPM2CoyKHk1AZ0ZgBNGJaYwBeLKkAV36ss',
      'LMS 5': '1spASwcoTgEcnUZaMihFmesQfEjP0mmrQL-TvsXcJPe8',
      'LMS 6': '1KKEi07IQEjYlmEKrZMkwz100WiOxKd82fHKbA5gXkV4',
    },
    responseSheetId: '1PHNLl_rdBVzjzpBs0oWFsvYxBDVq7_1i6TRQhwY45ac', // "LMCS Non-Teaching SS (Responses)"
    responseTabs: {
      'LMS 1': 'LMS 1 Non-Teaching', 'LMS 2': 'LMS 2 Non-Teaching', 'LMS 3': 'LMS 3 Non-Teaching',
      'LMS 4': 'LMS 4 Non-Teaching', 'LMS 5': 'LMS 5 Non-Teaching', 'LMS 6': 'LMS 6 Non-Teaching',
    },
    rubricTitles: [
      'Cleanliness',
      'Student Reception & Parent Dealing',
      'Support to Teacher - Classroom, Assembly, Dispersal ',
      'Montessori Wing Duties & Student Safety',
      'Student Discipline, Child Psychology & Student Management',
      'Booksets & Equipment Knowledge',
      'Student Names & background awareness',
      'Physical Appearance',
      'Soft Skills & Use of Word Command',
      'Attitude towards LMS',
    ],
    rubricMax: 10,
    nameFieldTitle: function () { return 'Staff Name'; },
    matchesEmployee: function (empRow, school) {
      return empRow.school === school && empRow.department.toLowerCase() === 'non-teaching';
    },
  },

  // Added 2026-09-09. Response sheet: "LMCS Driver Responses Sheet",
  // 1rFQH0Xcrhq1i2oNvLgpvrixXZNsr-rlntDXOGQ3J6ME, per-campus tabs
  // "LMS N Drivers" confirmed live via a tab inspection 2026-09-09.
  // Rubric + "Driver Name" field confirmed live via FormApp inspection
  // 2026-09-09 -- wording drifted/reordered slightly from the drafted
  // rubric (same pattern as every hand-built form this session), and
  // the Name field turned out to be "Driver Name", NOT "Staff Name"
  // like nonTeaching's -- don't assume the two forms share a naming
  // convention just because Uday built them close together.
  // Department matching confirmed live via action=designations:
  // "Transport" is Driver Cum Peon only (28 "Driver Cum Peon" + 1
  // "PEON CUM DRIVER" typo variant, both under Transport as of
  // 2026-09-09 -- was "Non-Teaching" until Uday moved it that same day).
  driverCumPeon: {
    label: 'Driver Cum Peon SS',
    perCampus: true, // one form per campus, like Teacher/nonTeaching -- see DRIVER_FORM_IDS in index.html
    forms: {
      'LMS 1': '1HwK72yQPXjYQZMH6XGit2dpkGeR2biREflfWnqi2rRs',
      'LMS 2': '1n3txv2xoKB-RPiQHv8qbpfeflENA6Frxifi09-eszHg',
      'LMS 3': '1bJLdy7rwzpKQbEpUwibRQvHpX8vJt9VtFuO-AKUjBdM',
      'LMS 4': '1oBaF1nmVTyRopGSGy2Kmv_NkLCB4h8leSDuEjmk91Jc',
      'LMS 5': '1K4sC3FyHEMOm8n6ujet8JlhUzqBZMVR7vMccKiHHcqA',
      'LMS 6': '16oTsz4SBj8PvPasi87ajQLw07_PElUYKrifTL0PH75o',
    },
    responseSheetId: '1rFQH0Xcrhq1i2oNvLgpvrixXZNsr-rlntDXOGQ3J6ME', // "LMCS Driver Responses Sheet"
    responseTabs: {
      'LMS 1': 'LMS 1 Drivers', 'LMS 2': 'LMS 2 Drivers', 'LMS 3': 'LMS 3 Drivers',
      'LMS 4': 'LMS 4 Drivers', 'LMS 5': 'LMS 5 Drivers', 'LMS 6': 'LMS 6 Drivers',
    },
    rubricTitles: [
      'Bus Safety, Cleaning & Pre-Trip Inspection',
      'Log Book & Fuel Management',
      'Driving Discipline, Punctuality & Accident-Free Record',
      'Bus Maintenance & Documentation during Vacations',
      'Knowledge of Student Names & Awareness',
      'Assembly & Classroom Support to Teachers',
      'Corridor Duty & Discipline of Students',
      'General Duties & School Equipment Knowledge',
      'Physical Appearance & Uniform',
      'Attitude towards LMS',
    ],
    rubricMax: 10,
    nameFieldTitle: function () { return 'Driver Name'; },
    matchesEmployee: function (empRow, school) {
      return empRow.school === school && empRow.department.toLowerCase() === 'transport';
    },
  },

  // ── TODO stubs — fill in once Uday finalizes each role's form ──
  // (rubric + Principal-performance factors + comms system are all
  // still open per project_principals_daily_reporting.md). For each:
  //   1. Open the live/rebuilt form and confirm its real question
  //      titles + current structure with FormApp (don't assume it
  //      mirrors Teacher's) — e.g. run:
  //        Logger.log(FormApp.openById('<id>').getItems().map(function(i){
  //          return i.getTitle() + ' [' + i.getType() + ']';
  //        }));
  //   2. Fill in the config below using that real structure.
  //   3. Add the role's key to ACTIVE_SS_ROLES.
  helpersDrivers: null,   // Helpers & Drivers -- no existing form, no rubric yet; scope still open
  principalSelfDR: null,  // Principal DR — existing old form: 1IypepIVAQ7n4vR-EvMLAoz4QzjeHoQVeg4JZnL5Vd3o
  // NOTE: these keep the "DR" label deliberately -- Uday's 2026-09-02
  // rename was specifically "for teachers", not these roles.
};

// Which of the keys above actually run. Add a key here once its config
// above is filled in — keeps syncAllSSForms() from erroring on the
// still-null stubs.
const ACTIVE_SS_ROLES = ['teacher', 'itComputer', 'pti', 'feeClerkPRO', 'nonTeaching', 'driverCumPeon'];

// ── Generic engine — role-agnostic, do not edit per-role ───────────

function syncAllSSForms() {
  const allResults = {};
  ACTIVE_SS_ROLES.forEach(function (roleKey) {
    const config = SS_ROLE_CONFIGS[roleKey];
    if (!config) throw new Error('ACTIVE_SS_ROLES references unconfigured role: ' + roleKey);
    allResults[roleKey] = syncOneSSRole_(config);
  });
  Logger.log(JSON.stringify(allResults, null, 2));
  return allResults;
}

function syncOneSSRole_(config) {
  const results = [];
  Object.keys(config.forms).forEach(function (formKey) {
    // formKey is a school ('LMS 1'..) when perCampus, otherwise a
    // single fixed key (e.g. 'all') — see per-role config comments.
    const form = FormApp.openById(config.forms[formKey]);
    const employees = getActiveEmployeeChoices_(config, formKey);
    let rangeFixed = 0;
    let nameListUpdated = false;

    form.getItems().forEach(function (item) {
      const title = item.getTitle();

      if (config.rubricTitles.indexOf(title) >= 0 && item.getType() === FormApp.ItemType.TEXT) {
        item.asTextItem().setValidation(
          FormApp.createTextValidation()
            .requireNumberBetween(0, config.rubricMax)
            .setHelpText('Enter a score between 0 and ' + config.rubricMax + '.')
            .build()
        );
        rangeFixed++;
      }

      // setChoiceValues([]) throws ("Array is empty: values") rather
      // than clearing the list -- found 2026-09-09 when Driver Cum
      // Peon's LMS 5 form had zero matching employees, which killed
      // syncAllSSForms() for every role/campus after it in
      // ACTIVE_SS_ROLES, not just that one form (nothing here caught
      // it). Skip the update when there's truly nobody to list --
      // leaves the dropdown's existing choices alone rather than
      // crashing the whole daily sync over one understaffed campus.
      if (title === config.nameFieldTitle(formKey) && item.getType() === FormApp.ItemType.LIST && employees.length > 0) {
        item.asListItem().setChoiceValues(employees);
        nameListUpdated = true;
      }
    });

    results.push({ formKey: formKey, rangeFixed: rangeFixed, nameListUpdated: nameListUpdated, employeeCount: employees.length });
  });
  return results;
}

/** EmpMaster -> "EmployeeCode Name" strings, Active only, filtered
 *  through the role's matchesEmployee(), sorted by name. */
function getActiveEmployeeChoices_(config, formKey) {
  const departmentByCode = getDepartmentByCode_();
  const rows = SpreadsheetApp.openById(SS_EMP_SHEET_ID)
    .getSheetByName('EmpMaster')
    .getDataRange()
    .getValues();
  const header = rows[0];
  const codeCol = header.indexOf('EmployeeCode');
  const nameCol = header.indexOf('Name');
  const statusCol = header.indexOf('Status');

  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const code = String(rows[i][codeCol] || '').trim();
    if (!code) continue;
    const prefix = code.split('/')[0];
    const school = SS_PREFIX_TO_SCHOOL[prefix];
    if (!school) continue;
    const status = statusCol >= 0 ? String(rows[i][statusCol] || '').trim().toLowerCase() : '';
    if (status && status !== 'active') continue; // departed/transferred — exclude

    const empRow = {
      code: code,
      name: String(rows[i][nameCol] || '').trim(),
      school: school,
      department: departmentByCode[code] || '',
    };
    if (!config.matchesEmployee(empRow, formKey)) continue;
    out.push(empRow.code + ' ' + empRow.name);
  }
  out.sort(function (a, b) { return a.localeCompare(b); });
  return out;
}

/** Run once to keep every active role's name lists synced going
 *  forward — same daily-refresh pattern as Code.gs's updateCache(). */
function installDailySSSyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncAllSSForms') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncAllSSForms')
    .timeBased()
    .everyDays(1)
    .atHour(5)
    .create();
  Logger.log('Daily trigger installed: syncAllSSForms() will run once a day around 5 AM.');
}

// ── ADDING A NEW ROLE ───────────────────────────────────────────────
// 1. Get the live form's real question titles (don't assume — see the
//    Logger.log one-liner in the TODO comment above).
// 2. Fill in SS_ROLE_CONFIGS.<role> with: forms (id map — one key if
//    perCampus:false, one per campus if true), rubricTitles,
//    rubricMax, nameFieldTitle(formKey), matchesEmployee(empRow, formKey).
// 3. Add '<role>' to ACTIVE_SS_ROLES.
// 4. Re-run syncAllSSForms() manually once to confirm it applies
//    cleanly before relying on the daily trigger for it.

// ── NEW SS FORMS (2026-09-08): built by hand by Uday, not generated ──
// For syncOneSSRole_() to find the right questions later, each of the
// 3 forms below MUST have a List/dropdown question titled EXACTLY:
//   IT Teacher SS  -> "IT Teacher Name"
//   PTI SS         -> "PTI Name"
//   Fee Clerk SS   -> "Fee Clerk Name"
// (matches each role's nameFieldTitle() in SS_ROLE_CONFIGS above) plus
// the 10 rubric questions from that same config, titled exactly as
// listed there, as Short answer with response validation "Number
// between 0 and <rubricMax>" (same as Teacher SS's questions). A
// "School" question is fine for humans reading responses but isn't
// read by any code here -- format it however's convenient.
// Once each form exists: paste its id into the matching
// `forms.all` PASTE_FORM_ID_* placeholder above.
