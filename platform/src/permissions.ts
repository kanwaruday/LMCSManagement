// Every Approvals permission check, in one place. Each rule mirrors today's Apps Script exactly (named per line);
// test/auth.test.ts runs the real .gs files as an oracle over a role × action × row matrix to keep it that way.
// Tenant data (categories, leave types, districts) comes in as `rules`, never as constants here.
import type { Caller } from './auth.ts';
import { LMCS_APPROVAL_RULES } from './approval-rules.ts';

export type ApprovalAction = 'list' | 'detail' | 'submit' | 'comment' | 'deleteComment' | 'decide' | 'archive'
  | 'changeHiringReason' | 'closeHiring' | 'referees' | 'allocate' | 'recommend' | 'trackRecord' | 'decision';

// The fields of an Approvals row the rules read. authorEmail: the comment's author, for deleteComment.
export type ApprovalRow = { campusId: string; category: string; status: string; requestedBy: string; leaveType?: string; authorEmail?: string };

export type ApprovalRules = {
  teacherCategories: string[];          // APR_TEACHER_CATEGORIES: what a Teacher/Staff-only caller may submit
  leaveCategory: string;                // APR_LEAVE_CATEGORY: only a Teacher files it (aprLvPrepare_)
  leavePrincipalTypes: string[];        // APR_LEAVE_PRINCIPAL_TYPES: leave types a campus Principal decides
  hiringCategory: string;               // APR_HIRING_CATEGORY: changeHiringReason / closeHiring apply to it only
  districts: Record<string, string[]>;  // COORD_DISTRICTS: campuses a one-campus Coordinator sees in the Coordinator portal
};

export const ALL = 'ALL'; // campusId of a network-wide caller
const OPEN = ['Pending', 'Info Requested'];

const has = (c: Caller, role: string) => c.roles.includes(role);                                     // callerHasRole_
const norm = (s: string | undefined) => String(s ?? '').trim().toLowerCase();
const elevated = (c: Caller) => has(c, 'Principal') || has(c, 'Coordinator') || has(c, 'Owner');    // pdrIsElevated_
const teacherOnly = (c: Caller) => (has(c, 'Teacher') || has(c, 'Staff')) && !elevated(c);           // pdrIsTeacherOnly_
// doGet/doPost gate for the self-service actions: elevated, or listed in PDR_TEACHER_* / PDR_STAFF_* (FeeClerk lists hold no approvals action)
const selfService = (c: Caller) => elevated(c) || has(c, 'Teacher') || has(c, 'Staff');
const canDecide = (c: Caller) => has(c, 'Owner') || (has(c, 'Coordinator') && c.canApprove);        // aprCanDecide_
const inCampus = (c: Caller, r: ApprovalRow) => c.campusId === ALL || r.campusId.trim() === c.campusId;
// aprList_ / aprDetail_ / aprAddComment_: a Teacher/Staff-only caller sees their own requests, everyone else their campus
const sees = (c: Caller, r: ApprovalRow) => (teacherOnly(c) ? norm(r.requestedBy) === c.email : inCampus(c, r));
function canDecideRow(c: Caller, r: ApprovalRow, rules: ApprovalRules) {                              // aprCanDecideRow_
  return canDecide(c) || (r.category === rules.leaveCategory && rules.leavePrincipalTypes.includes(String(r.leaveType ?? ''))
    && OPEN.includes(r.status) && has(c, 'Principal') && !!c.campusId && c.campusId !== ALL
    && r.campusId.trim() === c.campusId && norm(r.requestedBy) !== norm(c.email));
}
// Coordinator project (coordinator.gs): only Coordinator/Owner allowlist rows reach these actions (a FeeClerk-only caller gets transport only)
const coordCaller = (c: Caller) => has(c, 'Coordinator') || has(c, 'Owner');
const coordSees = (c: Caller, r: ApprovalRow, rules: ApprovalRules) =>                              // coordVisibleCampuses_
  c.campusId === ALL || (rules.districts[c.campusId] ?? [c.campusId]).includes(r.campusId.trim());

// Without a row: may the caller use the action at all. With a row: may they use it on that row.
// ponytail: rules defaults to the LMCS seed until Task 4 loads it from tables; then pass the tenant's rules.
export function can(c: Caller, action: ApprovalAction, row?: ApprovalRow, rules: ApprovalRules = LMCS_APPROVAL_RULES): boolean {
  switch (action) {
    case 'list':
    case 'detail':
    case 'comment':
      return selfService(c) && (!row || sees(c, row));
    case 'submit': // aprSubmit_ + aprLvPrepare_
      return selfService(c) && (!row || ((!teacherOnly(c) || rules.teacherCategories.includes(row.category))
        && (row.category !== rules.leaveCategory || has(c, 'Teacher'))));
    case 'deleteComment': // aprDeleteComment_: own comments only, no campus check
      return selfService(c) && (!row || norm(row.authorEmail) === c.email);
    case 'decide': // aprDecide_
      return elevated(c) && (canDecide(c) || (rules.leavePrincipalTypes.length > 0 && has(c, 'Principal')))
        && (!row || (inCampus(c, row) && canDecideRow(c, row, rules)));
    case 'archive': // aprArchive_ (the "only decided requests" filter is the action's, not a permission)
      return elevated(c) && canDecide(c) && (!row || inCampus(c, row));
    case 'changeHiringReason':
    case 'closeHiring': // aprHiringRow_: hiring requests, by the requester or a decider, any campus
      return elevated(c) && (!row || (row.category === rules.hiringCategory && (norm(row.requestedBy) === c.email || canDecide(c))));
    case 'referees': // aprReferees_
      return elevated(c) && canDecide(c);
    case 'allocate': // coordAprAllocate_
      return coordCaller(c) && canDecide(c) && (!row || coordSees(c, row, rules));
    case 'recommend': // coordRecommend_: Coordinators only, the Owner decides directly
      return has(c, 'Coordinator') && !has(c, 'Owner') && (!row || coordSees(c, row, rules));
    case 'trackRecord': // coordTrackRecordGet_ (a Coordinator gets only their own record: the action scopes it)
      return coordCaller(c);
    case 'decision': // coordDecision_
      return coordCaller(c) && (!row || coordSees(c, row, rules));
  }
}

// Who may "view as" an employee (pdrViewAsScope_): 'network' any employee, 'school' only their own campus, null nobody.
export function viewAsScope(c: Caller): 'network' | 'school' | null {
  if (has(c, 'Owner') || has(c, 'Coordinator')) return 'network';
  if (has(c, 'Principal')) return c.campusId === ALL ? 'network' : 'school';
  return null;
}
