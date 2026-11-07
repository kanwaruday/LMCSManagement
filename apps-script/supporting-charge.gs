// Shared: a Principal's supporting charge (Uday, 7 Nov: "A supporting principal can see everything and advise while approvals stay
// with the School's Principal"). One file, deployed to the PDR, Roster, Coordinator and Game projects (projects.json "shared"); never forked.
// The Owner sets it on owner/people.html (peoplesupport, game-people.gs): the allowlist column headed "Supporting", found by header,
// a comma list of schools. Only a Principal row (no Owner, no Coordinator) with its own school LMS1-6 has one; LMS1-6 only, never ALL,
// never its own school. A page sends actAs=<school> to read that school; each backend re-checks it here against the allowlist row:
//   supportActAs_(caller, actAs) -> the caller unchanged (no actAs), a read-only copy at that school, or null (not one of theirs: refuse).
// The copy can never decide: canApprove/canDecide false, and each backend's POST refuses everything but advice while supportingAt is set.
// Pure functions, var names with the support prefix (load order: nothing here runs at top level but these literals).

var SUPPORT_SCHOOLS = ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6'];
var SUPPORT_READ_ONLY = { success: false, code: 'SUPPORT_READ_ONLY', error: "You're supporting this school: you can read and comment. Decisions stay with its Principal." };
var SUPPORT_NOT_YOURS = { success: false, code: 'SUPPORT_NOT_YOURS', error: "That school isn't one you support." };

function supportColumn_(header) { return (header || []).map(function (h) { return String(h || '').trim().toLowerCase(); }).indexOf('supporting'); }
// may this row hold a supporting charge at all: a Principal at one school, nothing network-wide
function supportEligible_(roles, campusId) {
  return roles.indexOf('Principal') !== -1 && roles.indexOf('Owner') === -1 && roles.indexOf('Coordinator') === -1 && SUPPORT_SCHOOLS.indexOf(campusId) !== -1;
}
// a cell -> its schools in LMS1-6 order: unknown values, ALL and the row's own school dropped
function supportParse_(cell, ownCampus) {
  const said = String(cell || '').split(',').map(function (s) { return s.trim().toUpperCase(); });
  return SUPPORT_SCHOOLS.filter(function (c) { return c !== ownCampus && said.indexOf(c) !== -1; });
}
// an allowlist row (header row + this row) -> the schools this person supports, [] for anyone else
function supportSchools_(header, row) {
  const at = supportColumn_(header);
  if (at === -1 || !row) return [];
  const roles = String(row[3] || '').split(',').map(function (r) { return r.trim(); }).filter(Boolean);
  const campusId = String(row[2] || '').trim().toUpperCase();
  return supportEligible_(roles, campusId) ? supportParse_(row[at], campusId) : [];
}
function supportActAs_(caller, actAs) {
  if (!caller || actAs === undefined || actAs === null || actAs === '') return caller;
  if (typeof actAs !== 'string') return null; // a POST body could send ['LMS3'], which String() would flatten
  const want = actAs.trim().toUpperCase();
  if (SUPPORT_SCHOOLS.indexOf(want) === -1 || (caller.supporting || []).indexOf(want) === -1) return null;
  const copy = JSON.parse(JSON.stringify(caller));
  copy.homeCampusId = caller.campusId; copy.campusId = want; copy.supportingAt = want;
  copy.canApprove = false; copy.canDecide = false;
  return copy;
}
