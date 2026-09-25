// ═══════════════════════════════════════════════════════════════════
// SALARY -- Salary Dashboard v1: offer-letter/new-hire calculator only
// (not monthly payroll/incentives/leave -- see the design conversation
// this was built in). The calculator itself (rates, formulas) runs
// entirely client-side in salary/index.html, same as the old
// lmcs-salary-dashboard repo's dashboard.html did -- this file is only
// the one piece of server logic that calculator needs: checking whether
// an Owner has approved an EPF exemption for a specific candidate (the
// MD-hire case), reusing approvals.gs's existing generic pipeline rather
// than building a new one.
//
// action=salaryepfexemptionstatus (GET, this file's only action) --
// wired in main.gs's doGet.
// ═══════════════════════════════════════════════════════════════════

// Same free-text matching convention hirApprovedRequisitions_ (hiring.gs)
// already uses against the Approvals sheet's itemName column -- there is
// no per-instance foreign key on that sheet (confirmed when this was
// designed), so "is THIS candidate's exemption approved" is answered by
// scanning for an Approved 'EPF Exemption' row whose itemName/title
// contains their name, same as Hiring Dashboard already does for
// requisitions and hiring decisions.
function salEpfExemptionApproved_(candidateName) {
  const name = String(candidateName || '').trim().toLowerCase();
  if (!name) return false;
  const values = aprSheet_().getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (String(row[2]) !== 'EPF Exemption') continue;
    if (String(row[13]) !== APR_STATUS.APPROVED) continue;
    const itemName = String(row[7] || '').toLowerCase();
    const title = String(row[4] || '').toLowerCase();
    if (itemName.indexOf(name) !== -1 || title.indexOf(name) !== -1) return true;
  }
  return false;
}
