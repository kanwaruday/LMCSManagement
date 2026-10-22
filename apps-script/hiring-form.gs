// ═══════════════════════════════════════════════════════════════════
// hiring-form.gs -- 2026-10-13, per Uday: rethink the Interview Report Google Form.
// Run from the Apps Script editor (not web-exposed), same project as hiring.gs.
//
//   1. hirPreviewReportForm  -> only LOGS what would change. Run this first.
//   2. hirApplyReportForm    -> does it.
//
// What it does to the form (HIRA_IR_FORM_ID, hiring-audit.gs):
//   * adds a dropdown "Role interviewed for" (options = HIR_FORM_ROLES in hiring.gs) right before
//     the Subject question, if it isn't there yet (re-running just refreshes its options);
//   * trims Subject to real subjects -- the role-style options (MW to C-2, Clerk, Helping staff,
//     Drawing, Dance, Music, Martial Arts) are removed, they're roles now. Economics is added.
//     Subject becomes optional (a mother teacher/clerk has none).
// Past responses are untouched; the new answers land in a NEW column at the end of the
// responses tab (header "Role interviewed for"), so nothing shifts.
// ═══════════════════════════════════════════════════════════════════
const HIRF_ROLE_TITLE = 'Role interviewed for';
const HIRF_ROLE_STYLE_SUBJECTS = ['MW to C-2', 'Clerk', 'Helping staff', 'Drawing', 'Dance', 'Music', 'Martial Arts'];

function hirPreviewReportForm() { hirReportFormPlan_(false); }
function hirApplyReportForm() { hirReportFormPlan_(true); }

function hirReportFormPlan_(apply) {
  // Forms from Apps Script intermittently throws "An unknown error has occurred" / Drive timeouts -- retry.
  let form, items;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try { form = FormApp.openById(HIRA_IR_FORM_ID); items = form.getItems(); break; }
    catch (e) { Logger.log('attempt ' + attempt + ' failed: ' + e.message); if (attempt === 4) throw e; Utilities.sleep(3000 * attempt); }
  }
  const subjectItem = items.filter(function (it) { return /^subject/i.test(it.getTitle()) && it.getType() === FormApp.ItemType.CHECKBOX; })[0];
  if (!subjectItem) throw new Error('Could not find the Subject checkbox question');
  const log = function (m) { Logger.log((apply ? 'DONE: ' : 'WOULD: ') + m); };

  let roleItem = items.filter(function (it) { return it.getTitle() === HIRF_ROLE_TITLE; })[0];
  const labels = HIR_FORM_ROLES.map(function (x) { return x.label; });
  if (!roleItem) {
    log('add dropdown "' + HIRF_ROLE_TITLE + '" before Subject with ' + labels.length + ' options');
    if (apply) {
      roleItem = form.addListItem().setTitle(HIRF_ROLE_TITLE).setRequired(true);
      form.moveItem(roleItem.getIndex(), subjectItem.getIndex());
    }
  } else log('refresh the options of the existing "' + HIRF_ROLE_TITLE + '" dropdown');
  if (apply) roleItem.asListItem().setChoiceValues(labels);

  const cb = subjectItem.asCheckboxItem();
  const keep = cb.getChoices().map(function (c) { return c.getValue(); }).filter(function (v) { return HIRF_ROLE_STYLE_SUBJECTS.indexOf(v) === -1; });
  if (keep.indexOf('Economics') === -1) keep.push('Economics');
  log('Subject options become: ' + keep.join(', ') + '  (removed: ' + HIRF_ROLE_STYLE_SUBJECTS.join(', ') + ')');
  if (apply) { cb.setChoiceValues(keep); cb.setRequired(false); }
  Logger.log(apply ? 'Form updated.' : 'Preview only -- nothing changed. Run hirApplyReportForm to apply.');
}

// ═══════════════════════════════════════════════════════════════════
// Position dropdown (2026-10-13, per Uday: "make the form comparable to the hiring dashboard and
// approvals"). The form's "Position interviewed for" lists every OPEN requisition exactly as the
// dashboard's role chips do (hirPositionLabel_), plus "Other open role" / "Not for any open role".
// The Principal's pick WINS in hiringApplicants_. Replaces the interim "Role interviewed for" question.
//
//   hirPreviewPositionDropdown  -> logs what it would set
//   hirSyncPositionDropdown     -> does it (also what the timers run)
//   hirInstallPositionSync      -> run ONCE: hourly refresh. Approving/closing a New/ Backup Position
//                                  also queues a refresh ~1 minute later (hirQueuePositionSync_).
// ═══════════════════════════════════════════════════════════════════
const HIRF_POSITION_TITLE = 'Position interviewed for';

function hirOpenPositionLabels_() {
  const reqs = hirApprovedRequisitions_('New/ Backup Position');
  const seen = {}, out = [];
  Object.keys(reqs).sort().forEach(function (c) {
    reqs[c].forEach(function (r) { const l = hirPositionLabel_(c, r); if (!seen[l]) { seen[l] = true; out.push(l); } });
  });
  return out;
}

function hirPreviewPositionDropdown() { hirPositionPlan_(false); }
function hirSyncPositionDropdown() { hirPositionPlan_(true); }

function hirPositionPlan_(apply) {
  const labels = hirOpenPositionLabels_().concat(HIR_POSITION_NONE);
  Logger.log((apply ? 'SETTING' : 'WOULD SET') + ' ' + labels.length + ' options: ' + labels.join(' | '));
  if (!apply) return;
  let form, items;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try { form = FormApp.openById(HIRA_IR_FORM_ID); items = form.getItems(); break; }
    catch (e) { Logger.log('attempt ' + attempt + ' failed: ' + e.message); if (attempt === 4) throw e; Utilities.sleep(3000 * attempt); }
  }
  let pos = items.filter(function (it) { return it.getTitle() === HIRF_POSITION_TITLE; })[0];
  if (!pos) {
    const subjectItem = items.filter(function (it) { return /^subject/i.test(it.getTitle()); })[0];
    pos = form.addListItem().setTitle(HIRF_POSITION_TITLE).setRequired(true);
    if (subjectItem) form.moveItem(pos.getIndex(), subjectItem.getIndex());
    // the interim role question is superseded
    items.filter(function (it) { return it.getTitle() === HIRF_ROLE_TITLE; }).forEach(function (it) { form.deleteItem(it); Logger.log('removed the interim "' + HIRF_ROLE_TITLE + '" question'); });
  }
  pos.asListItem().setChoiceValues(labels);
}

function hirInstallPositionSync() {
  ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'hirSyncPositionDropdown'; }).forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('hirSyncPositionDropdown').timeBased().everyHours(1).create();
  Logger.log('Hourly position-dropdown refresh installed.');
}

// Called (best-effort) when a New/ Backup Position is approved or closed: a one-off refresh a minute
// later, so the approval request itself never waits on Google Forms.
function hirQueuePositionSync_() {
  const h = 'hirSyncPositionOnce_';
  if (ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === h; })) return; // already queued
  ScriptApp.newTrigger(h).timeBased().after(60 * 1000).create();
}
function hirSyncPositionOnce_() {
  ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'hirSyncPositionOnce_'; }).forEach(function (t) { ScriptApp.deleteTrigger(t); });
  hirSyncPositionDropdown();
}
