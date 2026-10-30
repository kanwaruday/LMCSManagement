// Pick an employee, don't type one (Uday's rule for staff fields). Pure logic for a native <input list> + <datalist> type-ahead:
// the browser does the searching, this decides the order and turns a chosen line back into the person. First used by the driver
// phones page (coordinator/capture/drivers.js); meant to be the one picker other pages reuse, not a second one.
// Staff come from the signed-in, school-scoped list (staff-management-api.gs action=list: {employeeCode, name, school, role, status}).

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
const isDriver = (e) => /driver/i.test(e.role || '');

// Active staff only. prefer(e) true sorts first (e.g. drivers); the given school before other schools; then by name.
export function rankStaff(list, { school = '', prefer = isDriver } = {}) {
  const rank = (e) => (prefer(e) ? 0 : 2) + (e.school === school ? 0 : 1);
  return (list || []).filter((e) => e && e.employeeCode && e.name && String(e.status || 'Active').toLowerCase() === 'active')
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

// One datalist line per person: the name and the code, so two people with one name stay two lines.
export const lineOf = (e) => `${e.name} (${e.employeeCode})`;
export const labelOf = (e) => [e.role, e.school].filter(Boolean).join(' · ');

// The person a typed or chosen line means: an exact line, else the one person whose name matches exactly. null if none or several.
export function findPick(list, text) {
  const t = String(text || '').trim();
  const line = (list || []).find((e) => lineOf(e) === t);
  if (line) return line;
  const same = (list || []).filter((e) => norm(e.name) === norm(t));
  return same.length === 1 ? same[0] : null;
}
