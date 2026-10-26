// SEED DATA, not code: LMCS's values for the Approvals permission rules, copied verbatim from Apps Script.
// Task 4 moves these into tenant tables; then this file goes and can() gets the tenant's rules passed in.
// test/auth.test.ts checks every value here against the live .gs constants.
import type { ApprovalRules } from './permissions.ts';

export const LMCS_APPROVAL_RULES: ApprovalRules = {
  teacherCategories: ['Compensatory Leave', 'Leave', 'Other'], // approvals.gs APR_TEACHER_CATEGORIES
  leaveCategory: 'Leave',                                       // approvals-leave.gs APR_LEAVE_CATEGORY
  leavePrincipalTypes: [],                                      // approvals.gs APR_LEAVE_PRINCIPAL_TYPES (empty: all leave to Management)
  hiringCategory: 'New/ Backup Position',                       // approvals.gs APR_HIRING_CATEGORY
  districts: {                                                  // coordinator.gs COORD_DISTRICTS
    LMS1: ['LMS1', 'LMS2', 'LMS3'], LMS2: ['LMS1', 'LMS2', 'LMS3'], LMS3: ['LMS1', 'LMS2', 'LMS3'],
    LMS4: ['LMS4', 'LMS5', 'LMS6'], LMS5: ['LMS4', 'LMS5', 'LMS6'], LMS6: ['LMS4', 'LMS5', 'LMS6'],
  },
};
