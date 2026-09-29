// ═══════════════════════════════════════════════════════════════════
// SALARY-PAYSCALE-SYNC -- keeps "LMCS-Salary-PayScale"'s JobRole Norms
// tab in sync with its PayScale Table tab: whenever a Designation is
// added to PayScale Table, it's automatically appended to JobRole Norms
// too (Designation + the standard RRF Policy text; other columns left
// blank for Uday to fill in). Never reorders, edits, or deletes an
// EXISTING JobRole Norms row -- append-only, so manually-entered
// Vacations/Casual Leave/Timing/Travel Allowance are never touched.
//
// Lives in THIS project ("LMCS Employee Roster Proxy") rather than as a
// script bound to the LMCS-Salary-PayScale sheet itself -- per Uday,
// 2026-09-29 -- matching how every other file here already reaches
// external sheets by ID (STAFF_ALLOWLIST_SHEET_ID etc.) instead of
// being bound to one of them. A standalone project can't use a simple
// onEdit(e) trigger (those only work in a script bound to the doc/
// sheet/form itself) -- it needs an INSTALLABLE trigger instead, which
// is what installJobRolePayScaleSyncTrigger_() below sets up.
//
// SETUP (one-time):
//   1. Paste this file into the "LMCS Employee Roster Proxy" project
//      alongside employee-roster.gs/staff-management-api.gs/etc.
//   2. Select installJobRolePayScaleSyncTrigger_ in the function
//      dropdown and click Run. Google will prompt for authorization the
//      first time (this project needs permission to edit the OTHER
//      spreadsheet) -- accept it.
//   3. Done. From then on, editing PayScale Table in LMCS-Salary-PayScale
//      automatically fires syncJobRoleNorms_ in this project -- no
//      redeploy needed for future edits, the trigger is registered with
//      Google's trigger service independently of this project's Web App
//      deployment.
//   4. To confirm it's installed: script.google.com's left sidebar ->
//      Triggers (clock icon) -> should show onSalaryPayScaleEdit_,
//      event source "From spreadsheet", event type "On edit".
// ═══════════════════════════════════════════════════════════════════

const SALPS_SHEET_ID = '1d8MdOgXNM5KVJjLwejAKpbbDaINnvPZO6zX_E5xABYU'; // "LMCS-Salary-PayScale"
const SALPS_TAB_PAYSCALE = 'PayScale Table';
const SALPS_TAB_JOBROLE_NORMS = 'JobRole Norms';

// Run this once manually (see SETUP above) to register the trigger.
// Safe to re-run -- deletes any previous trigger this function created
// before making a new one, so it can't accidentally register twice.
function installJobRolePayScaleSyncTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onSalaryPayScaleEdit_') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onSalaryPayScaleEdit_')
    .forSpreadsheet(SALPS_SHEET_ID)
    .onEdit()
    .create();
  Logger.log('Installed. Editing PayScale Table in LMCS-Salary-PayScale will now auto-sync JobRole Norms.');
}

// action=installjobrolesync (2026-09-29, per Uday) -- the Apps Script
// editor's function dropdown has been unreliable across several
// sessions, so this lets the trigger install run through the Web App
// instead: a browser console command on an already-signed-in page,
// reusing that page's real session, no dropdown involved at all. Same
// STAFF_ACTIONS_/staffDoGet_ routing every other gated action here
// already uses (see employee-roster.gs/staff-management-api.gs) --
// Owner-only, since creating a project trigger is a real setup action,
// not a data read. IMPORTANT: this still requires ONE redeploy of this
// project first (pasting this function in), because installing a
// trigger needs the script.scriptapp OAuth scope -- Apps Script will
// prompt Uday to authorize that scope AT DEPLOY TIME (in his own
// browser, via the Deploy dialog), not as a runtime error when this
// action is actually called afterward.
function installJobRolePayScaleSyncTriggerAction_(data, caller) {
  if (caller.roles.indexOf('Owner') === -1) throw new Error('Only the Owner can install this trigger');
  installJobRolePayScaleSyncTrigger_();
  return { message: 'Installed -- editing PayScale Table in LMCS-Salary-PayScale will now auto-sync JobRole Norms.' };
}

// The installable trigger's entry point -- Google calls this with the
// same event shape a bound onEdit(e) would get.
function onSalaryPayScaleEdit_(e) {
  if (!e || !e.range || e.range.getSheet().getName() !== SALPS_TAB_PAYSCALE) return;
  syncJobRoleNorms_();
}

// Also callable manually (Run > syncJobRoleNorms_) any time you want to
// force a sync without waiting for an edit -- e.g. right after installing
// the trigger, to catch up anything already missing.
//
// Finds PayScale Table's header row by CONTENT (looking for "Role
// Code"/"Designation" in columns A/B), not a fixed row number -- same
// fix as salary.gs's salPayScaleHeaderRow_, so an accidental edit above
// the header can't silently break this sync too.
function syncJobRoleNorms_() {
  const ss = SpreadsheetApp.openById(SALPS_SHEET_ID);
  const payScale = ss.getSheetByName(SALPS_TAB_PAYSCALE);
  const jobRole = ss.getSheetByName(SALPS_TAB_JOBROLE_NORMS);
  if (!payScale || !jobRole) return;

  const psValues = payScale.getDataRange().getValues();
  let headerRow = -1;
  for (let i = 0; i < psValues.length; i++) {
    if (String(psValues[i][0] || '').trim() === 'Role Code' && String(psValues[i][1] || '').trim() === 'Designation') { headerRow = i; break; }
  }
  if (headerRow === -1) return; // sheet structure changed unexpectedly -- fail quiet rather than corrupt anything

  const psDesignations = [];
  for (let i = headerRow + 1; i < psValues.length; i++) {
    const d = String(psValues[i][1] || '').trim();
    if (d && psDesignations.indexOf(d) === -1) psDesignations.push(d);
  }

  const jrValues = jobRole.getDataRange().getValues();
  const existing = {};
  for (let i = 1; i < jrValues.length; i++) {
    const d = String(jrValues[i][0] || '').trim();
    if (d) existing[d] = true;
  }

  const RRF_POLICY = 'Y1 - 12%, Y2 - 9%, Y3 - 6% (can be more months if RRF is less that CTI)';
  const toAdd = psDesignations.filter(function (d) { return !existing[d]; }).map(function (d) {
    return [d, '', '', '', '', RRF_POLICY];
  });
  if (!toAdd.length) return;

  const startRow = jobRole.getLastRow() + 1;
  jobRole.getRange(startRow, 1, toAdd.length, 6).setValues(toAdd);
}
