// UI check for hiring/index.html without the live backend. NOT loaded by the page. Paste into the
// browser console (or the browser pane's JS tool) on a locally served copy, then call
// window.__hiringStub('Principal') or ('FeeClerk'): it signs in a fake session, replaces fetch with an
// in-memory backend shaped like hiring.gs's responses, and reloads the view. Covers what the UI needs to
// render each stage, the duplicate-phone path, rejection and revival -- not the backend's rules (those
// are tested in tests/hiring/test-*.js).
(function () {
  const iso = (d, h) => { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(h || 10, 30, 0, 0); return x.toISOString(); };
  const REASONS = [["Doesn't want to join right now", 'notnow'], ['Working at another school / serving notice', 'notnow'], ['Salary expectation too high', 'notnow'],
    ['Poor communication skills', 'notsuitable'], ['Weak demo / classroom handling', 'notsuitable'], ['Position filled or closed', 'filled'], ['Other', 'other']]
    .map(([label, group]) => ({ label, group }));
  const STATUSES = ['Interview Scheduled', 'Interview Done', 'Demo Done', 'Salary Offer', 'MD Academics Interview Scheduled', 'Hiring Approved', 'Hired', 'Rejected'];
  const KEY = 'LMS4|TGT|English';
  let rows = [
    { row: 12, name: 'Priya <b>Sood</b>', phone: '9876500012', subjects: 'English', status: 'Interview Scheduled', interviewAt: iso(0, 11) },
    { row: 13, name: 'Kavita Rana', phone: '9876500013', subjects: 'English, Hindi', status: 'Interview Scheduled', interviewAt: iso(-1, 10) },
    { row: 14, name: 'Anil Thakur', phone: '9876500014', subjects: 'English', status: 'Interview Done', demoAt: iso(0, 9), stageMarks: { interview: { at: iso(0, 8) } }, reportPending: 'interview' },
    { row: 15, name: 'Meena Devi', phone: '9876500015', subjects: 'English', status: 'Demo Done', interviewReports: [{ 'Submitted At': iso(-2), 'Submitted By': 'p@lms.org.in', Confidence: 4, English: 4, Position: 'LMS 4 - TGT: English', Recommendation: 'proceed', Strengths: 'Clear voice' }],
      demoReports: [{ 'Submitted At': iso(0, 9), 'Submitted By': 'p@lms.org.in', 'Total /45': 37, Class: 'C7', Subject: 'English', Recommendation: 'proceed', Pedagogy: 4, Content: 4, 'Student Interaction': 4, 'Student Response': 4, 'Classroom Management': 4, 'Clarity & Audibility': 5, 'Makes Subject Relatable': 4, 'Use of Teaching Aids': 4, 'Student Feedback': 4 }] },
    { row: 16, name: 'Rohit Verma', phone: '9876500016', subjects: 'English', status: 'Hiring Approved', dateOfJoining: '2026-11-03', expectedEmployeeCode: 'NCM/26/11/131', docsMissing: ['PAN Card', 'Police Verification'] },
    { row: 17, name: 'Sunita Kumari', phone: '9876500017', subjects: 'English', status: '', source: 'Walk-in', timestamp: iso(0, 9) },
    { row: 18, name: 'Deepak Negi', phone: '9876500018', subjects: 'English', status: '', timestamp: iso(-20) },
    { row: 19, name: 'Asha Kaushal', phone: '9876500019', subjects: 'English', status: 'Rejected', rejectReason: 'Working at another school / serving notice', notes: 'Rejected: serving notice till Dec' },
    { row: 20, name: 'Neeraj Sharma', phone: '9876500020', subjects: 'Physics', status: 'Rejected', rejectReason: 'Weak demo / classroom handling', noOpenRole: true },
    { row: 21, name: 'Pooja Bhardwaj', phone: '9876500021', subjects: 'English', status: 'Interview Scheduled', interviewAt: iso(3, 12),
      history: [{ round: 1, interviewAt: iso(-60), rejectReason: "Doesn't want to join right now", revivedBy: 'p@lms.org.in', revivedAt: iso(-1), reviveNote: 'Now available' }], revivedAt: iso(-1) },
  ];
  rows = rows.map((a) => Object.assign({ applicantId: 'T-' + String(a.row).padStart(4, '0'), branches: 'LMS-4', timestamp: iso(-10), matchedRoleKeys: a.noOpenRole ? [] : [KEY], matchScore: 72,
    matchRemarks: [], interviewReports: [], demoReports: [], history: [], round: (a.history || []).length + 1, stageMarks: {}, reportPending: '', qualification: 'Masters', bed: 'Yes - TET qualified' }, a));
  const res = () => ({ success: true, statuses: STATUSES, rejectReasons: REASONS, positions: ['LMS 4 - TGT: English', 'Other open role', 'Not for any open role'], applicants: JSON.parse(JSON.stringify(rows)) });
  const by = (r) => rows.find((a) => a.row === Number(r));
  const fail = (e) => ({ success: false, error: e });
  function post(b, role) {
    const a = by(b.row);
    const elevated = role !== 'FeeClerk';
    if (!elevated && ['hiringaddapplicant', 'hiringschedule'].indexOf(b.action) === -1) return fail('Not authorized');
    switch (b.action) {
      case 'hiringaddapplicant': {
        const p = String(b.phone).replace(/\D/g, '').slice(-10);
        const dup = rows.find((x) => x.phone === p);
        if (dup) return Object.assign(res(), { duplicate: true, applicantId: dup.applicantId });
        const row = Math.max(...rows.map((x) => x.row)) + 1;
        rows.push({ row, applicantId: 'T-00' + row, name: b.name, phone: p, subjects: b.subjects, branches: 'LMS-' + b.campusId.slice(3), status: '', source: b.source, addedBy: 'me', timestamp: new Date().toISOString(),
          matchedRoleKeys: [], noOpenRole: true, interviewReports: [], demoReports: [], history: [], round: 1, stageMarks: {}, reportPending: '' });
        return Object.assign(res(), { duplicate: false, applicantId: 'T-00' + row });
      }
      case 'hiringschedule':
        if (b.clear) a[b.clear === 'demo' ? 'demoAt' : 'interviewAt'] = '';
        if (b.interviewAt) { a.interviewAt = new Date(b.interviewAt).toISOString(); if (!a.status) a.status = 'Interview Scheduled'; }
        if (b.demoAt) a.demoAt = new Date(b.demoAt).toISOString();
        return res();
      case 'hiringmarkstage':
        a.stageMarks[b.stage] = { at: new Date().toISOString() }; a.reportPending = b.stage; a.status = b.stage === 'interview' ? 'Interview Done' : 'Demo Done';
        if (!a.interviewAt) a.interviewAt = new Date().toISOString();
        return res();
      case 'hiringsubmitinterview':
        if (!(b.confidence >= 1 && b.english >= 1)) return fail('Confidence must be a score from 1 to 5');
        a.interviewReports.push({ 'Submitted At': new Date().toISOString(), 'Submitted By': 'me', Confidence: b.confidence, English: b.english, Position: b.position, Recommendation: b.recommendation, Strengths: b.strengths });
        if (a.reportPending === 'interview') a.reportPending = '';
        if (b.recommendation === 'reject') { a.status = 'Rejected'; a.rejectReason = b.rejectReason; } else if (a.status === 'Interview Scheduled' || !a.status) a.status = 'Interview Done';
        return res();
      case 'hiringsubmitdemo': {
        const t = Object.values(b.scores).reduce((x, y) => x + y, 0) + b.studentFeedback;
        a.demoReports.push({ 'Submitted At': new Date().toISOString(), 'Submitted By': 'me', 'Total /45': t, Class: b.class, Subject: b.subject, Recommendation: b.recommendation });
        if (b.recommendation === 'proceed') { a.status = 'Demo Done'; if (a.reportPending === 'demo') a.reportPending = ''; }
        if (b.recommendation === 'reject') { a.status = 'Rejected'; a.rejectReason = b.rejectReason; }
        if (b.nextDemoAt) a.demoAt = new Date(b.nextDemoAt).toISOString();
        return res();
      }
      case 'updatehiringstatus':
        if (b.status === 'Rejected') { if (!b.rejectReason) return fail('Pick a reason for rejecting this candidate'); a.status = 'Rejected'; a.rejectReason = b.rejectReason; }
        if (b.status === 'Hired') { if (a.docsMissing && a.docsMissing.length) return fail("Can't mark Hired yet -- still waiting on the missing document(s): " + a.docsMissing.join(', ') + '.'); a.status = 'Hired'; }
        if (b.notes !== undefined) a.notes = b.notes;
        if (b.mdInterviewAt) a.mdInterviewAt = b.mdInterviewAt;
        if (b.dateOfJoining) a.dateOfJoining = b.dateOfJoining;
        return res();
      case 'hiringrevive':
        if (a.status !== 'Rejected') return fail('Only a Rejected candidate can be revived');
        a.history.push({ round: a.round, rejectReason: a.rejectReason, revivedBy: 'me', revivedAt: new Date().toISOString(), reviveNote: b.note });
        Object.assign(a, { status: '', rejectReason: '', interviewAt: '', demoAt: '', round: a.round + 1, revivedAt: new Date().toISOString(), reportPending: '', stageMarks: {} });
        return res();
    }
    return fail('Unknown action: ' + b.action);
  }
  window.__hiringStub = function (role) {
    const real = window.__realFetch || (window.__realFetch = window.fetch);
    localStorage.setItem('lmcs_fc_off', '1');
    window.fetch = function (url, init) {
      const u = new URL(typeof url === 'string' ? url : url.url, location.href);
      if (u.hostname !== 'script.google.com') return real(url, init);
      let body;
      if (init && init.method === 'POST') body = post(JSON.parse(init.body), role);
      else if (u.searchParams.get('action') === 'hiringapplicants') body = res();
      else if (u.searchParams.get('action') === 'hiringapprovalstatus') body = { success: true, campuses: [{ campusId: 'LMS4', newPositions: [{ roleKey: KEY, roleLevel: 'TGT', subjects: 'English' }] }] };
      else body = fail('stub: unhandled');
      return new Promise((r) => setTimeout(() => r(new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })), 120));
    };
    SESSION = { email: role === 'FeeClerk' ? 'clerk@lms.org.in' : 'p@lms.org.in', name: role === 'FeeClerk' ? 'Test Clerk' : 'Test Principal', campusId: 'LMS4', campusName: 'Ner Chowk', role: role, idToken: 'stub' };
    showApp(SESSION);
  };
})();
