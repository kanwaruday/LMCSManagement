// ═══════════════════════════════════════════════════════════════════
// hiring-forms.gs -- 2026-10-13, per Uday: rethink the Interview Report Google Form.
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
  if (apply) { cb.setChoiceValues(keep); subjectItem.setRequired(false); }
  Logger.log(apply ? 'Form updated.' : 'Preview only -- nothing changed. Run hirApplyReportForm to apply.');
}
