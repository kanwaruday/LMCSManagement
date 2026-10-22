// Pure helpers for hiring/index.html (no DOM, no globals): what goes on Today, My actions and the Fee Clerk's lists.
// Each reads applicants as hiringapplicants returns them (status, appointments[], stageMarks, reportPending, docsMissing).
// Tested by tests/hiring/test-ui-helpers.js. The office Fee Clerk screen may reuse them.
(function (root) {
  const DAY = 864e5;
  const ms = (iso) => new Date(iso).getTime();
  const done = (a) => a.status === 'Rejected' || a.status === 'Hired';
  const appts = (a) => a.appointments || [];
  // The open (proposed or accepted) appointment of a kind, if any.
  function openAppt_(a, kind) { return appts(a).filter((x) => x.kind === kind && (x.status === 'proposed' || x.status === 'accepted'))[0] || null; }
  function endOfDay_(nowMs) { const d = new Date(nowMs); d.setHours(23, 59, 59, 999); return d.getTime(); }
  function startOfDay_(nowMs) { const d = new Date(nowMs); d.setHours(0, 0, 0, 0); return d.getTime(); }

  // Today = accepted interview/demo appointments (never the date columns): today in time order, then the next 7 days.
  function todayItems_(applicants, nowMs) {
    const from = startOfDay_(nowMs), eod = endOfDay_(nowMs), week = nowMs + 7 * DAY;
    const today = [], next = [];
    (applicants || []).forEach((a) => {
      if (done(a)) return;
      appts(a).forEach((x) => {
        if (x.status !== 'accepted' || (x.kind !== 'interview' && x.kind !== 'demo')) return;
        const t = ms(x.start);
        if (t >= from && t <= eod) today.push({ a, appt: x, t });
        else if (t > eod && t <= week) next.push({ a, appt: x, t });
      });
    });
    const byT = (p, q) => p.t - q.t;
    return { today: today.sort(byT), next: next.sort(byT) };
  }

  // Past accepted interview/demo appointments with no report of that kind (filed by anyone).
  function unreported_(a, nowMs) {
    return appts(a).filter((x) => x.status === 'accepted' && (x.kind === 'interview' || x.kind === 'demo') && ms(x.start) < nowMs && !x.reportFiled);
  }

  const LABELS = { confirmreject: 'Confirm rejection', interview: 'File interview report', demo: 'File demo report', bookdemo: 'Book demo',
    salary: 'Make a salary offer', md: 'Propose MD interview', joining: 'Joining, documents & Hired' };
  // Everything waiting on the Principal: [{row, kind, label}], at most one per row and kind.
  function myActions_(applicants, nowMs) {
    const out = [];
    (applicants || []).forEach((a) => {
      if (done(a)) return;
      const kinds = [];
      // A pending rejection (a clerk's report said reject) is settled first: nothing else is offered beside it.
      if ((a.stageMarks || {}).rejectPending) { out.push({ row: a.row, kind: 'confirmreject', label: LABELS.confirmreject }); return; }
      if (a.reportPending) kinds.push(a.reportPending);
      unreported_(a, nowMs).forEach((x) => kinds.push(x.kind));
      if (a.status === 'Interview Done' && !openAppt_(a, 'demo')) kinds.push('bookdemo');
      if (a.status === 'Demo Done') kinds.push('salary');
      if (a.status === 'Salary Offer' && !openAppt_(a, 'md')) kinds.push('md');
      if (a.status === 'Hiring Approved') kinds.push('joining');
      kinds.filter((k, i) => kinds.indexOf(k) === i).forEach((k) => out.push({ row: a.row, kind: k, label: LABELS[k] }));
    });
    return out;
  }

  // The Fee Clerk's lists -- the same rules as the server's legwork counts (hirLegwork_).
  function clerkBuckets_(applicants, nowMs) {
    const b = { toSchedule: [], waiting: [], booked: [], reportsToUpload: [], demosToBook: [], documents: [] };
    (applicants || []).forEach((a) => {
      if (a.status === 'Shortlisted' && !openAppt_(a, 'interview')) b.toSchedule.push(a);
      if (a.status === 'Interview Done' && !openAppt_(a, 'demo')) b.demosToBook.push(a);
      if (a.status === 'Hiring Approved' && (a.docsMissing || []).length) b.documents.push(a);
      if (done(a)) return;
      appts(a).forEach((x) => {
        const t = ms(x.start);
        if (x.status === 'proposed') b.waiting.push({ a, appt: x, t });
        if (x.status === 'accepted' && t >= nowMs && t <= nowMs + 7 * DAY) b.booked.push({ a, appt: x, t });
      });
      unreported_(a, nowMs).forEach((x) => b.reportsToUpload.push({ a, appt: x, t: ms(x.start) }));
    });
    ['waiting', 'booked', 'reportsToUpload'].forEach((k) => b[k].sort((p, q) => p.t - q.t));
    return b;
  }

  const api = { openAppt_, todayItems_, myActions_, clerkBuckets_, SCAN_MAX_BYTES: 7 * 1024 * 1024 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HiringView = api;
})(typeof window !== 'undefined' ? window : this);
