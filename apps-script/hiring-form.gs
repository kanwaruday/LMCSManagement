// ═══════════════════════════════════════════════════════════════════
// hiring-form.gs -- the legacy Interview Report Google Form (HIRA_IR_FORM_ID, hiring-audit.gs).
//
// RETIRED 29 Oct 2026 (owner-approved, forms inventory X4). The Hiring dashboard's own interview and demo reports
// (hiringsubmitinterview / hiringsubmitdemo) replaced the form, so nothing here edits it any more: no "Role interviewed
// for" / Subject rework, and no "Position interviewed for" dropdown kept in step with open requisitions (approvals.gs no
// longer queues that refresh). The form and its responses tab are left exactly as they are, never deleted; reports
// already filed through it are still read from that tab by hiring.gs.
//
// Run hirRemovePositionSync ONCE from the Apps Script editor after this deploys: it deletes the hourly trigger that
// the old hirInstallPositionSync made, and any one-off refresh still queued. Until then those triggers only log.
// ═══════════════════════════════════════════════════════════════════
const HIRF_RETIRED_HANDLERS = ['hirSyncPositionDropdown', 'hirSyncPositionOnce_'];

function hirRemovePositionSync() {
  const gone = ScriptApp.getProjectTriggers().filter(function (t) { return HIRF_RETIRED_HANDLERS.indexOf(t.getHandlerFunction()) !== -1; });
  gone.forEach(function (t) { ScriptApp.deleteTrigger(t); });
  Logger.log('Removed ' + gone.length + ' Interview Report form trigger(s).');
}

// The handlers an already-installed trigger may still call: they edit nothing.
function hirSyncPositionDropdown() { Logger.log('The Interview Report form is retired (hiring-form.gs): nothing synced. Run hirRemovePositionSync.'); }
function hirSyncPositionOnce_() { hirRemovePositionSync(); }
