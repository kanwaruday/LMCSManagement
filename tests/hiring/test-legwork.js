// Run: TZ=Asia/Kolkata node tests/hiring/test-legwork.js -- hirLegwork_ buckets and the appointments on each applicant.
const vm = require('vm'), fs = require('fs'), assert = require('assert'), path = require('path');
const ctx = vm.createContext({ console, Logger: { log() {} }, Session: { getScriptTimeZone: () => 'Asia/Kolkata' }, Utilities: { formatDate: () => '2026-10-22' },
  APR_STATUS: { APPROVED: 'Approved', REJECTED: 'Rejected' }, PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) } });
['hiring.gs', 'hiring-appointments.gs'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '../../apps-script', f), 'utf8'), ctx));
const T = (name, fn) => { fn(); console.log('ok  -', name); };
const NOW = Date.UTC(2026, 9, 22, 5, 0), H = 36e5, D = 24 * H;
const iso = (ms) => new Date(ms).toISOString();
const ap = (kind, status, startMs, extra) => Object.assign({ id: kind + status + startMs, kind, status, start: iso(startMs), proposedBy: 'c@x', declineNote: '', calendarMode: '' }, extra);
const person = (status, appointments, extra) => Object.assign({ status, appointments: appointments || [], interviewReports: [], demoReports: [], docsMissing: [] }, extra);
const L = (list) => JSON.parse(JSON.stringify(ctx.hirLegwork_(list, NOW)));
const zero = { toSchedule: 0, waiting: 0, booked: 0, reportsToUpload: 0, demosToBook: 0, documents: 0 };
const only = (o) => Object.assign({}, zero, o);

T('empty', () => assert.deepStrictEqual(L([]), zero));
T('toSchedule: Shortlisted with no open/accepted interview; a declined latest proposal too', () => {
  assert.deepStrictEqual(L([person('Shortlisted'), person('Shortlisted', [ap('interview', 'declined', NOW + D)]),
    person('Shortlisted', [ap('interview', 'proposed', NOW + D)]), person('Shortlisted', [ap('interview', 'accepted', NOW + D)])]),
  only({ toSchedule: 2, waiting: 1, booked: 1 }));
});
T('waiting: proposed of any kind; booked: accepted within the next 7 days only', () => {
  assert.deepStrictEqual(L([person('Demo Done', [ap('md', 'proposed', NOW + 30 * D), ap('demo', 'accepted', NOW + 6 * D), ap('demo', 'accepted', NOW + 8 * D)])]),
    only({ waiting: 1, booked: 1 }));
});
T('reportsToUpload: past accepted interview/demo without that kind\'s report; any filer clears it', () => {
  const past = NOW - 2 * D;
  const bare = person('Interview Scheduled', [ap('interview', 'accepted', past), ap('demo', 'accepted', past)]);
  assert.strictEqual(L([bare]).reportsToUpload, 2);
  const rep = (ms, by) => ({ submittedAtMs: ms, submittedBy: by });
  const filed = person('Interview Scheduled', [ap('interview', 'accepted', past), ap('demo', 'accepted', past)],
    { interviewReports: [rep(past + H, 'principal@x')] });
  assert.strictEqual(L([filed]).reportsToUpload, 1); // the demo still needs one
  filed.demoReports = [rep(past + H, 'principal@x')];
  assert.strictEqual(L([filed]).reportsToUpload, 0);
  const old = person('Interview Scheduled', [ap('interview', 'accepted', past)], { interviewReports: [rep(past - 30 * D, 'p')] });
  assert.strictEqual(L([old]).reportsToUpload, 1); // an earlier round's report is not evidence
  assert.strictEqual(L([person('Interview Scheduled', [ap('interview', 'accepted', past)], { interviewReportPdf: 'u' })]).reportsToUpload, 0);
});
T('demosToBook: Interview Done with no proposed or accepted demo; documents: Hiring Approved missing docs', () => {
  assert.deepStrictEqual(L([person('Interview Done'), person('Interview Done', [ap('demo', 'proposed', NOW + D)]), person('Interview Done', [ap('demo', 'declined', NOW + D)]),
    person('Hiring Approved', [], { docsMissing: ['PAN', 'Aadhar'] }), person('Hiring Approved')]), only({ demosToBook: 2, waiting: 1, documents: 1 }));
});

T('hirAttachAppointments_: by phone, open + accepted + only the latest declined per kind; md note not carried', () => {
  const mk = (id, kind, status, proposedAt, phone) => ({ id, kind, status, phone: phone || '9876543210', row: 2, start: new Date(NOW + D), proposedAt: new Date(proposedAt),
    proposedBy: 'c@x', declineNote: 'n', calendarMode: 'own', note: 'secret' });
  const all = [mk('d1', 'interview', 'declined', NOW - 5 * D), mk('d2', 'interview', 'declined', NOW - 4 * D), mk('x', 'demo', 'cancelled', NOW - 4 * D),
    mk('a', 'demo', 'accepted', NOW - 3 * D), mk('other', 'demo', 'accepted', NOW, '9000000000')];
  const list = [{ phoneNorm: '9876543210', row: 2 }, { phoneNorm: '9111111111', row: 3 }];
  ctx.hirAttachAppointments_(list, all);
  const got = JSON.parse(JSON.stringify(list[0].appointments));
  assert.deepStrictEqual(got.map((a) => a.id).sort(), ['a', 'd2']);
  assert.deepStrictEqual(Object.keys(got[0]).sort(), ['calendarMode', 'declineNote', 'id', 'kind', 'proposedBy', 'start', 'status']);
  assert.strictEqual(typeof got[0].start, 'string'); assert.deepStrictEqual(list[1].appointments, []);
  // a later proposal retires the declined one
  all.push(mk('p', 'interview', 'proposed', NOW - D)); list[0].appointments = null; ctx.hirAttachAppointments_(list, all);
  assert.deepStrictEqual(Array.from(list[0].appointments, (a) => a.id).sort(), ['a', 'p']);
});

T('hiringApplicants_: legwork computed on the full list, before the clerk strip', () => {
  const now = Date.now();
  const shortlisted = { phoneNorm: '9876543210', row: 2, status: 'Shortlisted', interviewReports: [], demoReports: [], docsMissing: [], history: [] };
  const past = { phoneNorm: '9111111111', row: 3, status: 'Interview Scheduled', interviewReports: [{ submittedAtMs: now - D }], demoReports: [], docsMissing: [], history: [] };
  Object.assign(ctx, {
    hirApprovedRequisitions_: () => ({}), hirAutoBackfillWalkIns_() {}, hirSheet_: () => ({ getDataRange: () => ({ getValues: () => [[]] }) }),
    hirIrSheet_: () => ({ getDataRange: () => ({ getValues: () => [[]] }) }), hirPortalReports_: () => [], hirSalaryOfferDecisions_: () => ({}),
    hirBuildApplicants_: () => [shortlisted, past], hirAssignEmployeeCodes_() {}, hirOpenPositionLabelsFor_: () => [],
    apptAll_: () => [{ id: 'i', kind: 'interview', status: 'accepted', phone: '9111111111', row: 3, start: new Date(now - 2 * D), proposedAt: new Date(), proposedBy: 'c@x', declineNote: '', calendarMode: 'own' }],
  });
  const res = ctx.hiringApplicants_({ email: 'c@x', campusId: 'ALL', roles: ['FeeClerk'] });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(res.legwork)), only({ toSchedule: 1 })); // the report (hidden from the clerk) cleared reportsToUpload
  const a = Array.from(res.applicants).filter((x) => x.row === 3)[0];
  assert.strictEqual(a.interviewReports.length, 0); assert.strictEqual(a.appointments.length, 1);
});

T('Rejected and Hired people count in no bucket except documents (a leftover past appointment is history)', () => {
  const past = NOW - 2 * D;
  const appts = [ap('interview', 'accepted', past), ap('demo', 'proposed', NOW + D), ap('demo', 'accepted', NOW + D)];
  assert.deepStrictEqual(L([person('Rejected', appts), person('Hired', appts)]), zero);
  assert.deepStrictEqual(L([person('Interview Done', appts)]), only({ reportsToUpload: 1, waiting: 1, booked: 1 }));
});
T('hirAttachAppointments_: a Date start from another realm still becomes an ISO string', () => {
  const list = [{ phoneNorm: '9876543210', row: 2 }];
  ctx.hirAttachAppointments_(list, [{ id: 'a', kind: 'demo', status: 'accepted', phone: '9876543210', row: 2, start: new Date(NOW), proposedAt: new Date(NOW),
    proposedBy: 'c@x', declineNote: '', calendarMode: 'own' }]);
  assert.strictEqual(list[0].appointments[0].start, '2026-10-22T05:00:00.000Z');
});
T('hirForCaller_: a Fee Clerk\'s md appointment has declineNote \'\'; an elevated caller keeps it', () => {
  const list = [{ row: 2, appointments: [{ id: 'm', kind: 'md', declineNote: 'too costly' }, { id: 'i', kind: 'interview', declineNote: 'busy' }] }];
  const forClerk = ctx.hirForCaller_({ email: 'c@x', campusId: 'LMS4', roles: ['FeeClerk'] }, list)[0].appointments;
  assert.strictEqual(forClerk[0].declineNote, ''); assert.strictEqual(forClerk[1].declineNote, 'busy');
  assert.strictEqual(ctx.hirForCaller_({ email: 'p@x', campusId: 'LMS4', roles: ['Principal'] }, list)[0].appointments[0].declineNote, 'too costly');
});
