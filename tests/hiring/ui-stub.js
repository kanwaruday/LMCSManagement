// UI check for hiring/index.html without the live backend. NOT loaded by the page. Paste into the
// browser console (or the browser pane's JS tool) on a locally served copy, then call
// window.__hiringStub('Principal') or ('FeeClerk'): it signs in a fake session, replaces fetch with an
// in-memory backend shaped like hiring.gs / hiring-appointments.gs responses, and reloads the view. Covers what
// the UI needs to render each stage, shortlist, appointments (propose / direct booking / accept / decline /
// cancel / calendar retry), scanned report upload, confirm rejection, the duplicate-phone path, rejection and
// revival -- not the backend's rules (those are tested in tests/hiring/test-*.js).
(function () {
  const iso = (d, h) => { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(h || 10, 30, 0, 0); return x.toISOString(); };
  const now = () => new Date().toISOString();
  const ms = (s) => new Date(s).getTime();
  const REASONS = [["Doesn't want to join right now", 'notnow'], ['Working at another school / serving notice', 'notnow'], ['Salary expectation too high', 'notnow'],
    ['Poor communication skills', 'notsuitable'], ['Weak demo / classroom handling', 'notsuitable'], ['Position filled or closed', 'filled'], ['Other', 'other']]
    .map(([label, group]) => ({ label, group }));
  const STATUSES = ['Shortlisted', 'Interview Scheduled', 'Interview Done', 'Demo Done', 'Salary Offer', 'MD Academics Interview Scheduled', 'Hiring Approved', 'Hired', 'Rejected'];
  const KEY = 'LMS4|TGT|English';
  const P = 'p@lms.org.in', CLERK = 'clerk@lms.org.in';
  let rows = [
    { row: 12, name: 'Priya <b>Sood</b>', phone: '9876500012', subjects: 'English', status: 'Interview Scheduled', interviewAt: iso(0, 11), shortlistedAt: iso(-3) },
    { row: 13, name: 'Kavita Rana', phone: '9876500013', subjects: 'English, Hindi', status: 'Interview Scheduled', interviewAt: iso(-1, 10), shortlistedAt: iso(-3) },
    { row: 14, name: 'Anil Thakur', phone: '9876500014', subjects: 'English', status: 'Interview Done', demoAt: iso(0, 9), stageMarks: { interview: { at: iso(0, 8) } }, reportPending: 'interview', shortlistedAt: iso(-5) },
    { row: 15, name: 'Meena Devi', phone: '9876500015', subjects: 'English', status: 'Demo Done', shortlistedAt: iso(-9), interviewReports: [{ 'Submitted At': iso(-2), 'Submitted By': CLERK, Confidence: 4, English: 4, Position: 'LMS 4 - TGT: English', Recommendation: 'proceed', Strengths: 'Clear voice', 'Scan Link': 'https://drive.google.com/file/d/stub-scan/view', 'Entered By Role': 'clerk' }],
      demoReports: [{ 'Submitted At': iso(0, 9), 'Submitted By': P, 'Total /45': 37, Class: 'C7', Subject: 'English', Recommendation: 'proceed', Pedagogy: 4, Content: 4, 'Student Interaction': 4, 'Student Response': 4, 'Classroom Management': 4, 'Clarity & Audibility': 5, 'Makes Subject Relatable': 4, 'Use of Teaching Aids': 4, 'Student Feedback': 4 }] },
    { row: 16, name: 'Rohit Verma', phone: '9876500016', subjects: 'English', status: 'Hiring Approved', dateOfJoining: '2026-11-03', expectedEmployeeCode: 'NCM/99/11/131', docsMissing: ['PAN Card', 'Police Verification'] },
    { row: 17, name: 'Sunita Kumari', phone: '9876500017', subjects: 'English', status: '', source: 'Walk-in', timestamp: iso(0, 9) },
    { row: 18, name: 'Deepak Negi', phone: '9876500018', subjects: 'English', status: '', timestamp: iso(-20) },
    { row: 19, name: 'Asha Kaushal', phone: '9876500019', subjects: 'English', status: 'Rejected', rejectReason: 'Working at another school / serving notice', notes: 'Rejected: serving notice till Dec' },
    { row: 20, name: 'Neeraj Sharma', phone: '9876500020', subjects: 'Physics', status: 'Rejected', rejectReason: 'Weak demo / classroom handling', noOpenRole: true },
    { row: 21, name: 'Pooja Bhardwaj', phone: '9876500021', subjects: 'English', status: 'Interview Scheduled', interviewAt: iso(3, 12), shortlistedAt: iso(-1),
      history: [{ round: 1, interviewAt: iso(-60), rejectReason: "Doesn't want to join right now", revivedBy: P, revivedAt: iso(-1), reviveNote: 'Now available' }], revivedAt: iso(-1) },
    { row: 22, name: 'Ravi Chauhan', phone: '9876500022', subjects: 'English', status: 'Shortlisted', shortlistedAt: iso(-1) },
    { row: 23, name: 'Geeta Thakur', phone: '9876500023', subjects: 'English', status: 'Shortlisted', shortlistedAt: iso(-2) },
    { row: 24, name: 'Manoj Kumar', phone: '9876500024', subjects: 'English', status: 'Interview Done', shortlistedAt: iso(-4),
      stageMarks: { rejectPending: { reason: 'Poor communication skills', note: 'Could not <i>answer</i> basics', kind: 'interview', reportId: 'PI-9', by: CLERK, at: iso(-1) } } },
    { row: 25, name: 'Vikas Rana', phone: '9876500025', subjects: 'English', status: 'Salary Offer', salaryOfferAt: iso(-1), shortlistedAt: iso(-12) },
    { row: 26, name: 'Kamal (column only)', phone: '9876500026', subjects: 'English', status: 'Interview Scheduled', interviewAt: iso(0, 14) }, // a date column, no appointment: never on Today
    { row: 27, name: 'Shalini Sood', phone: '9876500027', subjects: 'English', status: 'Salary Offer', salaryOfferAt: iso(-2), shortlistedAt: iso(-12) },
  ];
  rows = rows.map((a) => Object.assign({ applicantId: 'T-' + String(a.row).padStart(4, '0'), branches: 'LMS-4', timestamp: iso(-10), matchedRoleKeys: a.noOpenRole ? [] : [KEY], matchScore: 72,
    matchRemarks: [], interviewReports: [], demoReports: [], history: [], round: (a.history || []).length + 1, stageMarks: {}, reportPending: '', qualification: 'Masters', bed: 'Yes - TET qualified', shortlistedAt: '' }, a));
  let seq = 0;
  const mk = (row, kind, start, status, extra) => Object.assign({ id: 'appt-stub-' + (++seq), kind, row, applicantId: 'T-' + String(row).padStart(4, '0'), name: rows.find((x) => x.row === row).name,
    phone: rows.find((x) => x.row === row).phone, campus: 'LMS4', start, durationMin: kind === 'demo' ? 45 : 30, place: '', note: '', proposedBy: CLERK, proposedAt: iso(-1),
    acceptorRole: kind === 'md' ? 'Owner' : 'Principal', status, decidedBy: status === 'accepted' ? P : '', decidedAt: '', declineNote: '', eventId: '', calendarMode: status === 'accepted' ? 'own' : '', calendarError: '' }, extra);
  let appts = [
    mk(12, 'interview', iso(0, 11), 'accepted', { proposedBy: P }),
    mk(13, 'interview', iso(-1, 10), 'accepted'),
    mk(14, 'interview', iso(0, 8), 'accepted', { note: 'Ground floor | Cancelled by clerk@lms.org.in: replaced' }),
    mk(14, 'demo', iso(0, 9), 'accepted', { calendarMode: 'none', calendarError: 'Forbidden', decidedBy: 'migration' }),
    mk(21, 'interview', iso(3, 12), 'accepted'),
    mk(22, 'interview', iso(1, 11), 'proposed', { place: 'Office', note: 'Can only come <after> 11' }),
    mk(23, 'interview', iso(1, 15), 'declined', { declineNote: 'Not that day -- board meeting', decidedBy: P }),
    mk(27, 'md', iso(2, 16), 'proposed', { proposedBy: P }),
  ];
  const by = (r) => rows.find((a) => a.row === Number(r));
  const fail = (e) => ({ success: false, error: e });
  const filed = (a, x) => (x.kind === 'interview' || x.kind === 'demo') && (x.kind === 'interview' ? a.interviewReports : a.demoReports).some((r) => ms(r['Submitted At']) >= ms(x.start) - 6 * 36e5);
  const personAppts = (a) => {
    const mine = appts.filter((x) => x.row === a.row);
    const declined = ['interview', 'demo', 'md'].map((k) => mine.filter((x) => x.kind === k && x.status === 'declined').slice(-1)[0]).filter(Boolean);
    return mine.filter((x) => x.status === 'proposed' || x.status === 'accepted').concat(declined).sort((p, q) => ms(p.start) - ms(q.start))
      .map((x) => ({ id: x.id, kind: x.kind, start: x.start, status: x.status, proposedBy: x.proposedBy, declineNote: x.declineNote, calendarMode: x.calendarMode, reportFiled: filed(a, x) }));
  };
  let ROLE = 'Principal', ME = P;
  const clerk = () => ROLE === 'FeeClerk';
  const res = () => {
    const list = JSON.parse(JSON.stringify(rows)).map((a) => Object.assign(a, { appointments: personAppts(a) }));
    const out = clerk() ? list.map((a) => Object.assign(a, { notes: undefined, offerBreakdown: undefined, interviewReports: [], demoReports: [], history: [] })) : list;
    const b = window.HiringView ? window.HiringView.clerkBuckets_(list, Date.now()) : null;
    const legwork = b ? { toSchedule: b.toSchedule.length, waiting: b.waiting.length, booked: b.booked.length, reportsToUpload: b.reportsToUpload.length, demosToBook: b.demosToBook.length, documents: b.documents.length } : {};
    return { success: true, statuses: STATUSES, rejectReasons: REASONS, positions: ['LMS 4 - TGT: English', 'Other open role', 'Not for any open role'], applicants: out, legwork, gated: false };
  };
  const apptList = () => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const ahead = (x) => ms(x.start) >= today.getTime();
    const sorted = appts.slice().sort((p, q) => ms(p.start) - ms(q.start));
    return { success: true,
      toAccept: sorted.filter((x) => x.status === 'proposed' && ROLE === 'Principal' && x.kind !== 'md'),
      myProposals: sorted.filter((x) => x.proposedBy === ME && x.status !== 'cancelled' && (ahead(x) || x.status === 'declined')),
      upcoming: sorted.filter((x) => x.status === 'accepted' && ahead(x)) };
  };
  const end = (x, why) => { x.status = 'cancelled'; x.note = (x.note ? x.note + ' | ' : '') + 'Cancelled by ' + ME + (why ? ': ' + why : ''); };
  const accept = (x) => {
    appts.filter((o) => o.row === x.row && o.kind === x.kind && o.status === 'accepted' && o.id !== x.id).forEach((o) => end(o, 'rescheduled'));
    Object.assign(x, { status: 'accepted', decidedBy: ME, decidedAt: now(), calendarMode: 'own' });
    const a = by(x.row);
    if (x.kind === 'interview') { a.interviewAt = x.start; if (a.status === 'Shortlisted' || !a.status) a.status = 'Interview Scheduled'; if (!a.shortlistedAt) a.shortlistedAt = now(); }
    if (x.kind === 'demo') a.demoAt = x.start;
    if (x.kind === 'md') { a.mdInterviewAt = x.start; a.status = 'MD Academics Interview Scheduled'; }
  };
  function propose(b) {
    const a = by(b.row);
    if (['interview', 'demo', 'md'].indexOf(b.kind) === -1) return fail('Invalid appointment kind');
    if (clerk() && b.kind === 'md') return fail('Only a Principal, Coordinator or the Owner can propose an MD Academics interview');
    if (a.status === 'Rejected') return fail('This applicant was rejected -- Revive them first');
    const direct = ROLE === 'Principal' && b.kind !== 'md';
    if (!direct && ms(b.start) < Date.now()) return fail('Pick a time in the future.');
    const mine = appts.filter((x) => x.row === a.row && x.kind === b.kind);
    if (b.kind === 'interview' && !a.shortlistedAt && !mine.some((x) => x.status === 'accepted') && !direct) return fail("Shortlist this applicant first (a Principal's call)");
    if (b.kind === 'demo' && ['', 'Shortlisted', 'Interview Scheduled'].indexOf(a.status) !== -1) return fail('The interview has to be done (or its report filed) before a demo');
    mine.filter((x) => x.status === 'proposed').forEach((x) => end(x, 'replaced'));
    const x = mk(a.row, b.kind, new Date(b.start).toISOString(), 'proposed', { proposedBy: ME, place: b.place || '', note: b.note || '', proposedAt: now() });
    appts.push(x);
    if (direct) accept(x);
    return Object.assign(res(), { id: x.id });
  }
  function upload(b) {
    const a = by(b.row);
    const f = b.file || {};
    if (['application/pdf', 'image/jpeg', 'image/png'].indexOf(f.mime) === -1 || !f.base64) return fail('The scan must be a PDF, JPG or PNG file');
    if (f.base64.length * 3 / 4 > 7 * 1024 * 1024) return fail('The scan is larger than 7 MB -- scan at a lower resolution, or as a PDF');
    const stamp = { 'Submitted At': now(), 'Submitted By': ME, 'Scan Link': 'https://drive.google.com/file/d/stub-' + Date.now() + '/view', 'Entered By Role': clerk() ? 'clerk' : 'principal', Recommendation: b.recommendation };
    if (b.kind === 'interview') {
      if (!(b.confidence >= 1 && b.english >= 1)) return fail('Confidence must be a score from 1 to 5');
      a.interviewReports.push(Object.assign(stamp, { Confidence: b.confidence, English: b.english, Position: b.position }));
      if (a.reportPending === 'interview') a.reportPending = '';
      if (['', 'Shortlisted', 'Interview Scheduled'].indexOf(a.status) !== -1) a.status = 'Interview Done';
    } else {
      a.demoReports.push(Object.assign(stamp, { 'Total /45': Object.values(b.scores).reduce((x, y) => x + y, 0) + b.studentFeedback, Class: b.class, Subject: b.subject }));
      if (b.recommendation === 'proceed') { a.status = 'Demo Done'; if (a.reportPending === 'demo') a.reportPending = ''; }
      if (b.recommendation === 'another' && b.nextDemoAt) { const r = propose({ row: a.row, kind: 'demo', start: b.nextDemoAt }); if (!r.success) return r; }
    }
    if (b.recommendation === 'reject') {
      if (clerk()) a.stageMarks.rejectPending = { reason: b.rejectReason, note: b.rejectNote || '', kind: b.kind, reportId: 'PI-x', by: ME, at: now() };
      else { a.status = 'Rejected'; a.rejectReason = b.rejectReason; }
    }
    return res();
  }
  function post(b) {
    const a = by(b.row);
    if (clerk() && ['hiringaddapplicant', 'apptpropose', 'apptcancel', 'hiringuploadreport'].indexOf(b.action) === -1) return fail('Not authorized');
    switch (b.action) {
      case 'hiringaddapplicant': {
        const p = String(b.phone).replace(/\D/g, '').slice(-10);
        const dup = rows.find((x) => x.phone === p);
        if (dup) return Object.assign(res(), { duplicate: true, applicantId: dup.applicantId });
        const row = Math.max(...rows.map((x) => x.row)) + 1;
        rows.push({ row, applicantId: 'T-00' + row, name: b.name, phone: p, subjects: b.subjects, branches: 'LMS-' + b.campusId.slice(3), status: '', source: b.source, addedBy: ME, timestamp: now(),
          matchedRoleKeys: [KEY], noOpenRole: false, interviewReports: [], demoReports: [], history: [], round: 1, stageMarks: {}, reportPending: '', shortlistedAt: '' });
        return Object.assign(res(), { duplicate: false, applicantId: 'T-00' + row });
      }
      case 'apptpropose': return propose(b);
      case 'apptdecide': {
        const x = appts.find((o) => o.id === b.id);
        if (!x) return fail('Appointment not found');
        if (x.status !== 'proposed') return fail('This appointment is already ' + x.status);
        if (b.decision === 'decline') { if (!String(b.note || '').trim()) return fail('Add a note saying why (the proposer sees it)'); Object.assign(x, { status: 'declined', declineNote: b.note, decidedBy: ME }); }
        else accept(x);
        return Object.assign({ id: x.id }, apptList());
      }
      case 'apptcancel': {
        const x = appts.find((o) => o.id === b.id);
        if (!x) return fail('Appointment not found');
        if (x.status !== 'proposed' && x.status !== 'accepted') return fail('This appointment is already ' + x.status);
        if (x.status === 'accepted' && ms(x.start) <= Date.now()) return fail('This appointment has already happened');
        if (x.proposedBy !== ME && clerk()) return fail('Only the proposer or a Principal, Coordinator or the Owner can cancel this');
        const wasAccepted = x.status === 'accepted';
        end(x, b.note);
        const p = by(x.row);
        if (wasAccepted && x.kind === 'interview' && p.status === 'Interview Scheduled') { p.interviewAt = ''; p.status = 'Shortlisted'; }
        return res();
      }
      case 'apptcalendarretry': { const x = appts.find((o) => o.id === b.id); x.calendarMode = 'own'; x.calendarError = ''; return Object.assign({ id: x.id }, apptList()); }
      case 'hiringshortlist':
        if (b.on) { if (a.status === '') a.status = 'Shortlisted'; a.shortlistedAt = now(); a.shortlistedBy = ME; return res(); }
        if (appts.some((x) => x.row === a.row && x.status === 'accepted')) return fail("Can't un-shortlist: an appointment is already accepted -- cancel it first");
        appts.filter((x) => x.row === a.row && x.status === 'proposed').forEach((x) => end(x, 'un-shortlisted'));
        a.shortlistedAt = ''; if (a.status === 'Shortlisted') a.status = '';
        return res();
      case 'hiringconfirmreject': {
        const p = a.stageMarks.rejectPending;
        if (!p) return fail('No rejection is pending for this applicant');
        if (b.confirm) { a.status = 'Rejected'; a.rejectReason = p.reason; }
        delete a.stageMarks.rejectPending;
        return res();
      }
      case 'hiringuploadreport': return upload(b);
      case 'hiringmarkstage':
        a.stageMarks[b.stage] = { at: now() }; a.reportPending = b.stage; a.status = b.stage === 'interview' ? 'Interview Done' : 'Demo Done';
        return res();
      case 'hiringsubmitinterview':
        if (!(b.confidence >= 1 && b.english >= 1)) return fail('Confidence must be a score from 1 to 5');
        a.interviewReports.push({ 'Submitted At': now(), 'Submitted By': ME, Confidence: b.confidence, English: b.english, Position: b.position, Recommendation: b.recommendation, Strengths: b.strengths });
        if (a.reportPending === 'interview') a.reportPending = '';
        if (b.recommendation === 'reject') { a.status = 'Rejected'; a.rejectReason = b.rejectReason; } else if (['', 'Shortlisted', 'Interview Scheduled'].indexOf(a.status) !== -1) a.status = 'Interview Done';
        return res();
      case 'hiringsubmitdemo': {
        const t = Object.values(b.scores).reduce((x, y) => x + y, 0) + b.studentFeedback;
        a.demoReports.push({ 'Submitted At': now(), 'Submitted By': ME, 'Total /45': t, Class: b.class, Subject: b.subject, Recommendation: b.recommendation });
        if (b.recommendation === 'proceed') { a.status = 'Demo Done'; if (a.reportPending === 'demo') a.reportPending = ''; }
        if (b.recommendation === 'reject') { a.status = 'Rejected'; a.rejectReason = b.rejectReason; }
        if (b.recommendation === 'another' && b.nextDemoAt) { const r = propose({ row: a.row, kind: 'demo', start: b.nextDemoAt }); if (!r.success) return r; }
        return res();
      }
      case 'updatehiringstatus':
        if (b.interviewAt || b.demoAt || b.mdInterviewAt) return fail('stub: times go through appointments now');
        if (b.status === 'Rejected') { if (!b.rejectReason) return fail('Pick a reason for rejecting this candidate'); a.status = 'Rejected'; a.rejectReason = b.rejectReason; }
        if (b.status === 'Hired') { if (a.docsMissing && a.docsMissing.length) return fail("Can't mark Hired yet -- still waiting on the missing document(s): " + a.docsMissing.join(', ') + '.'); a.status = 'Hired'; }
        if (b.notes !== undefined) a.notes = b.notes;
        if (b.dateOfJoining) a.dateOfJoining = b.dateOfJoining;
        return res();
      case 'hiringrevive':
        if (a.status !== 'Rejected') return fail('Only a Rejected candidate can be revived');
        a.history.push({ round: a.round, rejectReason: a.rejectReason, revivedBy: ME, revivedAt: now(), reviveNote: b.note });
        appts.filter((x) => x.row === a.row && (x.status === 'proposed' || x.status === 'accepted')).forEach((x) => end(x, 'revived'));
        Object.assign(a, { status: '', rejectReason: '', interviewAt: '', demoAt: '', round: a.round + 1, revivedAt: now(), reportPending: '', stageMarks: {}, shortlistedAt: '' });
        return res();
    }
    return fail('Unknown action: ' + b.action);
  }
  window.__hiringStub = function (role) {
    ROLE = role; ME = role === 'FeeClerk' ? CLERK : P;
    const real = window.__realFetch || (window.__realFetch = window.fetch);
    localStorage.setItem('lmcs_fc_off', '1');
    window.fetch = function (url, init) {
      const u = new URL(typeof url === 'string' ? url : url.url, location.href);
      if (u.hostname !== 'script.google.com') return real(url, init);
      let body;
      const action = u.searchParams.get('action');
      if (init && init.method === 'POST') body = post(JSON.parse(init.body));
      else if (action === 'hiringapplicants') body = res();
      else if (action === 'apptlist') body = apptList();
      else if (action === 'hiringapprovalstatus') body = { success: true, campuses: [{ campusId: 'LMS4', newPositions: [{ roleKey: KEY, roleLevel: 'TGT', subjects: 'English' }] }] };
      else body = fail('stub: unhandled');
      return new Promise((r) => setTimeout(() => r(new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })), 120));
    };
    SESSION = { email: ME, name: role === 'FeeClerk' ? 'Test Clerk' : 'Test Principal', campusId: 'LMS4', campusName: 'Ner Chowk', role: role, roles: [role], idToken: 'stub' };
    showApp(SESSION);
  };
})();
