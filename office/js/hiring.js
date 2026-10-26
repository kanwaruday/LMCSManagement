// Fee Clerk hiring screen (office/hiring.html) + the office-home banner. Writes are online-only, straight to the PDR backend.
// Pure logic first (bucketing, payload builders, validation) -- tested in tests/office/test-hiring-view.js.
import { h, field, setKids } from './dom.js';
import { hiringCounts, hiringLabel } from './today.js';
import { liveToken, SIGNED_OUT } from './accounts.js';

export const SOURCES = ['Walk-in', 'Referral', 'Paper CV', 'Phone call', 'Other'];
export const CLASSES = ['M1', 'M2', 'M3', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11', 'C12'];
export const DEMO_SCORES = [['pedagogy', 'Pedagogy'], ['content', 'Content'], ['interaction', 'Student Interaction'], ['response', 'Student Response'],
  ['management', 'Classroom Management'], ['clarity', 'Clarity & Audibility'], ['relatable', 'Makes Subject Relatable'], ['aids', 'Use of Teaching Aids']];
export const MAX_FILE = 7 * 1024 * 1024;
const MIMES = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
const DOC_FORM_URLS = {
  LMS1: 'https://forms.gle/mEtGFD6vGhgK3kJG7', LMS2: 'https://forms.gle/LV1fy13jXzrrcXra9', LMS3: 'https://forms.gle/hHgMU9XqBxpk3gWd8',
  LMS4: 'https://forms.gle/1uFg6AuYpYmP7ukA9', LMS5: 'https://forms.gle/ZiTP8jQuJ4SstRSM6', LMS6: 'https://forms.gle/pKP62AwcJuat1byH7',
};
// Same prefill as hiring/index.html DOC_FORM_PREFILL (LMS4 only so far).
const DOC_FORM_PREFILL = { LMS4: { url: 'https://docs.google.com/forms/d/e/1FAIpQLSdNTYssKiHvr3v0F-tbOZP5_DNJgHjvauts8ttt1h1mar9XLg/viewform', name: 'entry.773686043', empId: 'entry.1648508931', role: 'entry.1017094729' } };
const DOC_FORM_ROLE_LABEL = { PRT: 'PRT, TGT', TGT: 'PRT, TGT', PGT: 'PGT', NTT: 'NTT' };

// ---- pure ----
const appts = (a) => a.appointments || [];
// hiring/hiring-view.js is a plain script that sets the HiringView global; the pages load it before this module.
const openAppt = (a, kind, t) => globalThis.HiringView.openAppt_(a, kind, t);
const startOf = (x) => new Date(x.start).getTime();
const dayStart = (now) => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); };

// Same legwork rules as the server; Rejected and Hired people are never legwork.
export function bucketApplicants(applicants, apptlist, now = new Date()) {
  const live = (applicants || []).filter((a) => a.status !== 'Rejected' && a.status !== 'Hired');
  const t = new Date(now).getTime(), from = dayStart(now), to = t + 7 * 864e5;
  const booked = [], reports = [];
  for (const a of live) for (const x of appts(a)) {
    if (x.status !== 'accepted') continue;
    const s = startOf(x);
    if (s >= from && s <= to) booked.push({ a, x });
    if (s < t && (x.kind === 'interview' || x.kind === 'demo') && x.reportFiled === false) reports.push({ a, x });
  }
  const byStart = (p, q) => startOf(p.x) - startOf(q.x);
  return {
    toSchedule: live.filter((a) => a.status === 'Shortlisted' && !openAppt(a, 'interview', t)),
    waiting: ((apptlist && apptlist.myProposals) || []).filter((p) => p.status === 'proposed'),
    booked: booked.sort(byStart),
    reports: reports.sort(byStart),
    demos: live.filter((a) => a.status === 'Interview Done' && !openAppt(a, 'demo', t)),
    docs: live.filter((a) => a.status === 'Hiring Approved' && (a.docsMissing || []).length),
  };
}
// Subject names for the capability grid rows: the role's subjects, else the applicant's; at most 5.
export const capSubjects = (a) => String((a.role && a.role.subjects) || a.subjects || '').split(/,|&/).map((x) => x.trim()).filter(Boolean).slice(0, 5);
export const declined = (a, kind) => appts(a).filter((x) => x.kind === kind && x.status === 'declined').pop();

export function docFormUrl(a, fallbackCampus) {
  const school = a.campusId || fallbackCampus, cfg = DOC_FORM_PREFILL[school];
  if (!cfg) return DOC_FORM_URLS[school] || '';
  const p = new URLSearchParams({ usp: 'pp_url' });
  p.set(cfg.name, a.name);
  const code = a.employeeCode || a.expectedEmployeeCode;
  if (code) p.set(cfg.empId, code);
  const label = a.role && DOC_FORM_ROLE_LABEL[String(a.role.roleLevel || '').toUpperCase()];
  if (label) p.set(cfg.role, label);
  return cfg.url + '?' + p.toString();
}

const bad = (error) => ({ ok: false, error });
const good = (body) => ({ ok: true, body });
const inRange = (v) => /^[1-5]$/.test(String(v));
const s = (v) => String(v == null ? '' : v).trim();

export function proposePayload(f, now = new Date()) {
  if (f.kind !== 'interview' && f.kind !== 'demo') return bad('Invalid appointment kind');
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(s(f.start))) return bad('Pick a date and time.');
  if (new Date(f.start).getTime() < new Date(now).getTime()) return bad('Pick a time in the future.');
  const dur = f.durationMin === '' || f.durationMin == null ? 30 : Number(f.durationMin);
  if (!(dur >= 5 && dur <= 480)) return bad('Duration must be between 5 and 480 minutes.');
  const b = { row: f.row, kind: f.kind, start: f.start, durationMin: dur };
  if (s(f.place)) b.place = s(f.place);
  if (s(f.note)) b.note = s(f.note);
  return good(b);
}

export function walkinPayload(f, campuses) {
  const phone = s(f.phone).replace(/\D/g, '').slice(-10);
  if (!s(f.name)) return bad("Enter the applicant's name");
  if (phone.length !== 10) return bad('Enter a 10-digit mobile number');
  if (!(campuses || []).includes(f.campusId)) return bad('Pick one of your schools');
  if (!SOURCES.includes(f.source)) return bad('Pick where this applicant came from (source)');
  const b = { name: s(f.name), phone, campusId: f.campusId, source: f.source };
  for (const k of ['subjects', 'qualification', 'notes']) if (s(f[k])) b[k] = s(f[k]);
  return good(b);
}

// null if fine, else the message. file = {name, size, type}.
export function fileError(file) {
  if (!file) return 'Choose the scanned report (PDF, JPG or PNG).';
  const mime = fileMime(file);
  if (!mime) return 'The scan must be a PDF, JPG or PNG.';
  if (file.size > MAX_FILE) return 'The file is over 7 MB. Scan it smaller.';
  if (!file.size) return 'The file is empty.';
  return null;
}
export function fileMime(file) {
  if (Object.values(MIMES).includes(file.type)) return file.type;
  return MIMES[String(file.name || '').split('.').pop().toLowerCase()] || '';
}

function recommendation(f, allowed, reasons) {
  if (!allowed.includes(f.recommendation)) return { err: 'Pick a recommendation.' };
  const out = { recommendation: f.recommendation };
  if (f.recommendation === 'reject') {
    if (!s(f.rejectReason)) return { err: 'Pick a reason for rejecting.' };
    if (reasons && reasons.length && !reasons.includes(f.rejectReason)) return { err: 'Pick a reason from the list.' };
    if (f.rejectReason === 'Other' && !s(f.rejectNote)) return { err: 'Add a note saying why (reason: Other).' };
    out.rejectReason = f.rejectReason; out.rejectNote = s(f.rejectNote);
  }
  return out;
}
// f: flat strings from the form; f.capability already {subject:{cls:n}}; f.experience {school,...}. reasons: rejectReasons labels.
export function reportBody(row, kind, file, f, reasons) {
  const fe = fileError(file);
  if (fe) return bad(fe);
  const common = { row, kind, file: { name: file.name, mime: fileMime(file), base64: file.base64 || '' } };
  if (kind === 'interview') {
    if (!/^\d{4}-\d\d-\d\d$/.test(s(f.interviewDate))) return bad('Enter the interview date.');
    if (!inRange(f.confidence) || !inRange(f.english)) return bad('Confidence and English must be a score from 1 to 5.');
    const cap = {};
    for (const [sub, row2] of Object.entries(f.capability || {})) for (const [c, v] of Object.entries(row2 || {})) {
      if (v === '' || v == null) continue;
      if (!s(sub) || !CLASSES.includes(c) || !inRange(v)) return bad('Capability scores must be from 1 to 5, with a subject name.');
      (cap[s(sub)] = cap[s(sub)] || {})[c] = Number(v);
    }
    if (!Object.keys(cap).length) return bad('Give at least one capability score (subject and class).');
    const rec = recommendation(f, ['proceed', 'reject'], reasons);
    if (rec.err) return bad(rec.err);
    const ex = f.experience || {};
    return good({ ...common, interviewDate: f.interviewDate, position: s(f.position), confidence: Number(f.confidence), english: Number(f.english), capability: cap,
      spouseOccupation: s(f.spouseOccupation), familySupport: s(f.familySupport), qualificationRemarks: s(f.qualificationRemarks), otherSkills: s(f.otherSkills),
      experience: { school: s(ex.school), periods: s(ex.periods), timing: s(ex.timing), extraWork: s(ex.extraWork), classes: s(ex.classes), subjects: s(ex.subjects), lastSalary: s(ex.lastSalary) },
      commitment: s(f.commitment), expectedSalary: s(f.expectedSalary), strengths: s(f.strengths), weaknesses: s(f.weaknesses), remarks: s(f.remarks), ...rec });
  }
  if (kind !== 'demo') return bad('Invalid appointment kind');
  if (!/^\d{4}-\d\d-\d\d$/.test(s(f.demoDate))) return bad('Enter the demo date.');
  const scores = {};
  for (const [k, label] of DEMO_SCORES) { if (!inRange((f.scores || {})[k])) return bad(label + ' must be a score from 1 to 5.'); scores[k] = Number(f.scores[k]); }
  if (!inRange(f.studentFeedback)) return bad('Student Feedback must be a score from 1 to 5.');
  const rec = recommendation(f, ['proceed', 'another', 'reject'], reasons);
  if (rec.err) return bad(rec.err);
  if (f.recommendation === 'another') {
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(s(f.nextDemoAt))) return bad('Pick the time of the next demo.');
    rec.nextDemoAt = f.nextDemoAt;
  }
  return good({ ...common, demoDate: f.demoDate, class: s(f.class), subject: s(f.subject), scores, studentFeedback: Number(f.studentFeedback),
    strengths: s(f.strengths), improve: s(f.improve), remarks: s(f.remarks), ...rec });
}

// ---- backend ----
export function makeBackend(fetchFn, url, getToken) {
  const get = async (action) => (await fetchFn(url + '?action=' + action + '&idToken=' + encodeURIComponent(getToken()), { cache: 'no-store' })).json();
  const post = async (action, body) => (await fetchFn(url, { method: 'POST', body: JSON.stringify({ action, idToken: getToken(), ...body }) })).json(); // no Content-Type: simple request
  return { get, post };
}

// Office-home: one fetch fills the nav link text and the "To schedule" banner. Silent on failure.
export async function showOfficeHiring(link, banner, fetchFn, url, token, now = new Date()) {
  try {
    const r = await (await fetchFn(url + '?action=hiringapplicants&idToken=' + encodeURIComponent(token), { cache: 'no-store' })).json();
    if (!r || !r.success) return;
    link.textContent = hiringLabel(hiringCounts(r.applicants, r.legwork));
    const list = bucketApplicants(r.applicants, null, now).toSchedule;
    if (!list.length || !banner) return;
    setKids(banner, h('a', { href: 'hiring.html' }, h('b', {}, 'To schedule (' + list.length + ')'), ': ' + list.map((a) => a.name).join(', ')));
    banner.hidden = false;
  } catch (e) { /* offline: plain link, no banner */ }
}

// ---- screen ----
const fmt = (iso) => { const d = new Date(iso); return isNaN(d) ? String(iso) : d.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); };
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const readFile = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(new Error('Could not read the file.')); r.readAsDataURL(file); });
const sel = (opts, val) => h('select', {}, opts.map((o) => h('option', { value: Array.isArray(o) ? o[0] : o, selected: (Array.isArray(o) ? o[0] : o) === val }, Array.isArray(o) ? o[1] : o)));
const inp = (type, attrs = {}) => h('input', { type, ...attrs });
const area = () => h('textarea', { rows: 2 });
const val = (el) => el.value;

export async function mountHiring(root, session, deps = {}) {
  const L = deps.L || window.LMCS, fetchFn = deps.fetch || ((...a) => fetch(...a)), url = deps.url, now = () => (deps.now ? deps.now() : new Date());
  const be = makeBackend(fetchFn, url, () => liveToken(L, session));
  const campuses = session.campusId === 'ALL' ? ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6'] : [session.campusId];
  let data = null, appt = null;
  const msg = h('p', { role: 'alert' });
  const say = (t) => { msg.textContent = t || ''; };
  const failText = (e) => (e && e.message === SIGNED_OUT ? SIGNED_OUT : (e && e.message) || 'Something went wrong. Check the internet and try again.');
  const loadAppt = async () => { try { const r = await be.get('apptlist'); if (r.success) appt = r; } catch (e) { /* keep the last list */ } };

  // Runs a write; on success repaints from the returned payload. Returns true if it worked.
  async function write(action, body, okText) {
    say('');
    try {
      const r = await be.post(action, body);
      if (!r.success) { say(r.error || 'Not saved.'); return false; }
      data = r; await loadAppt(); paint();
      say(okText + (r.duplicate ? ' (already on file)' : '')); return true;
    } catch (e) { say(failText(e)); return false; }
  }

  const person = (a) => [h('b', {}, a.name), ' ', a.phone ? h('a', { href: 'tel:' + a.phone }, a.phone) : '', a.subjects ? h('div', { class: 'meta' }, a.subjects) : null];
  function section(title, items, render, empty) {
    return h('section', { class: 'block' }, h('h2', {}, title + ' (' + items.length + ')'),
      items.length ? h('ul', { class: 'office-list' }, items.map(render)) : h('p', { class: 'meta' }, empty));
  }
  // li with an action button that opens a form in its own slot.
  function row(info, actionLabel, buildForm) {
    const slot = h('div', { class: 'office-form' });
    const li = h('li', {}, info, h('div', {}, buildForm ? h('button', { type: 'button', onclick: () => { if (slot.firstChild) setKids(slot); else setKids(slot, buildForm(() => setKids(slot))); } }, actionLabel) : null), slot);
    return li;
  }
  const formBox = (err, ...kids) => h('div', {}, kids, err);
  const btns = (submit, label, close) => h('div', { class: 'row' }, h('button', { type: 'submit' }, label), h('button', { type: 'button', class: 'secondary', onclick: close }, 'Close'));

  function proposeForm(a, kind) {
    return (close) => {
      const start = field('pr-' + kind + a.row, 'Date and time', inp('datetime-local')), dur = field('pd-' + kind + a.row, 'Minutes', inp('number', { value: '30', min: '5' })),
        place = field('pp-' + kind + a.row, 'Place (optional)', inp('text')), note = field('pn-' + kind + a.row, 'Note (optional)', inp('text'));
      const f = h('form', { onsubmit: async (e) => {
        e.preventDefault();
        const p = proposePayload({ row: a.row, kind, start: val(start.control), durationMin: val(dur.control), place: val(place.control), note: val(note.control) }, now());
        if (!p.ok) { start.err.textContent = p.error; return; }
        start.err.textContent = '';
        if (await write('apptpropose', p.body, 'Proposed. Waiting for the Principal.')) close();
      } }, start.root, dur.root, place.root, note.root, btns(0, 'Propose time', close));
      return f;
    };
  }

  function reportForm(a, x) {
    return (close) => {
      const kind = x.kind, reasons = (data.rejectReasons || []).map((r) => r.label);
      const err = h('p', { class: 'err', role: 'alert' });
      const file = inp('file', { accept: '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png' });
      const els = {}; // name -> control
      const add = (name, label, ctl, hint) => { els[name] = ctl; return field('rf' + x.id + name.replace(/\W/g, ''), label, ctl, hint).root; };
      const score = () => sel(['', 1, 2, 3, 4, 5].map(String));
      const day = ymd(new Date(x.start));
      const rec = sel(kind === 'interview' ? [['proceed', 'Proceed to demo'], ['reject', 'Reject']] : [['proceed', 'Proceed to salary offer'], ['another', 'Another demo'], ['reject', 'Reject']], 'proceed');
      const rej = h('div', {}, add('rejectReason', 'Reason', sel([['', 'Pick a reason...'], ...reasons])), add('rejectNote', 'Note (required for "Other")', inp('text')));
      const next = h('div', {}, add('nextDemoAt', 'Next demo time', inp('datetime-local')));
      const sync = () => { rej.hidden = rec.value !== 'reject'; next.hidden = rec.value !== 'another'; };
      rec.onchange = sync;
      const body = [];
      let capRows = null;
      if (kind === 'interview') {
        const subs = capSubjects(a);
        capRows = [0, 1, 2, 3, 4].map((i) => ({ sub: inp('text', { 'aria-label': 'Subject', value: subs[i] || '' }), cells: CLASSES.map((c) => { const e = score(); e.setAttribute('aria-label', c); return e; }) }));
        body.push(add('interviewDate', 'Interview date', inp('date', { value: day })),
          add('position', 'Position interviewed for', sel([['', 'Pick...'], ...(data.positions || [])], (data.positions || []).includes(a.positionLabel) ? a.positionLabel : '')),
          add('confidence', 'Confidence (1-5)', score()), add('english', 'English (1-5)', score()),
          h('p', {}, h('b', {}, 'Capability: score 1-5 for each class they can teach (at least one)')),
          h('div', { class: 'capwrap' }, h('table', { class: 'bal' }, h('tr', {}, h('th', {}, 'Subject'), CLASSES.map((c) => h('th', {}, c))),
            capRows.map((r) => h('tr', {}, h('td', {}, r.sub), r.cells.map((c) => h('td', {}, c)))))),
          add('spouseOccupation', 'Spouse / family occupation', inp('text')), add('familySupport', 'Family support expected', inp('text')),
          add('qualificationRemarks', 'Remarks on qualifications', inp('text')), add('otherSkills', 'Other skills and hobbies', inp('text')),
          h('p', {}, h('b', {}, 'Experience, if taught elsewhere')),
          ...[['school', 'School / institution'], ['periods', 'Periods per week'], ['timing', 'School timing'], ['extraWork', 'Extra work / timing'], ['classes', 'Classes taken'], ['subjects', 'Subjects taken'], ['lastSalary', 'Last salary drawn']].map(([k, l]) => add('ex.' + k, l, inp('text'))),
          add('commitment', 'Commitment to serve', inp('text')), add('expectedSalary', 'Minimum monthly salary expected', inp('text')),
          add('strengths', 'Strengths', area()), add('weaknesses', 'Weaknesses', area()), add('remarks', 'Remarks', area()));
      } else {
        body.push(add('demoDate', 'Demo date', inp('date', { value: day })), add('class', 'Class', sel([''].concat(CLASSES))), add('subject', 'Subject', inp('text')),
          ...DEMO_SCORES.map(([k, l]) => add('sc.' + k, l + ' (1-5)', score())), add('studentFeedback', 'Student Feedback (1-5)', score()),
          add('strengths', 'Strengths', area()), add('improve', 'Areas to improve', area()), add('remarks', 'Remarks', area()));
      }
      body.push(add('recommendation', 'Recommendation', rec), rej, next);
      sync();
      const form = h('form', { onsubmit: async (e) => {
        e.preventDefault(); err.textContent = '';
        const f = {}; let experience = {}, scores = {};
        for (const [k, el] of Object.entries(els)) { if (k.startsWith('ex.')) experience[k.slice(3)] = el.value; else if (k.startsWith('sc.')) scores[k.slice(3)] = el.value; else f[k] = el.value; }
        f.experience = experience; f.scores = scores; f.recommendation = rec.value;
        if (capRows) { f.capability = {}; capRows.forEach((r) => r.cells.forEach((c, i) => { if (c.value) (f.capability[r.sub.value.trim() || '?'] = f.capability[r.sub.value.trim() || '?'] || {})[CLASSES[i]] = c.value; })); }
        const fl = file.files && file.files[0];
        const fe = fileError(fl); if (fe) { err.textContent = fe; return; } // refuse before reading
        let b64; try { b64 = await readFile(fl); } catch (ex) { err.textContent = ex.message; return; }
        const p = reportBody(a.row, kind, { name: fl.name, size: fl.size, type: fl.type, base64: b64 }, f, reasons);
        if (!p.ok) { err.textContent = p.error; return; }
        if (await write('hiringuploadreport', p.body, 'Report uploaded.')) close(); else err.textContent = msg.textContent;
      } },
        h('p', { class: 'meta' }, 'Upload the scanned handwritten report, then type in what it says. If you choose Reject, the applicant is only marked "rejection pending"; the Principal confirms it.'),
        field('rf' + x.id + 'file', 'Scanned report (PDF, JPG or PNG, up to 7 MB)', file).root, body, err, btns(0, 'Upload report', close));
      return form;
    };
  }

  function walkinForm() {
    const name = field('wi-name', 'Name', inp('text')), phone = field('wi-phone', 'Mobile number (10 digits)', inp('tel', { inputmode: 'tel' })),
      campus = field('wi-campus', 'School', sel(campuses.map((c) => [c, L.campusLabel ? L.campusLabel(c) : c]), session.campus)),
      source = field('wi-source', 'Came through', sel([['', 'Pick...'], ...SOURCES])),
      subjects = field('wi-subj', 'Subjects / role (optional)', inp('text')), qual = field('wi-qual', 'Highest qualification (optional)', inp('text')), notes = field('wi-notes', 'Notes (optional)', area());
    const err = h('p', { class: 'err', role: 'alert' });
    return h('form', { class: 'office-form', onsubmit: async (e) => {
      e.preventDefault();
      const p = walkinPayload({ name: val(name.control), phone: val(phone.control), campusId: val(campus.control), source: val(source.control), subjects: val(subjects.control), qualification: val(qual.control), notes: val(notes.control) }, campuses);
      err.textContent = p.ok ? '' : p.error; if (!p.ok) return;
      if (await write('hiringaddapplicant', p.body, 'Added.')) e.target.reset();
    } }, name.root, phone.root, campus.root, source.root, subjects.root, qual.root, notes.root, err, h('button', { type: 'submit' }, 'Add applicant'));
  }

  function paint() {
    const b = bucketApplicants(data.applicants, appt, now());
    const dn = (a, kind) => { const d = declined(a, kind); return d ? h('div', { class: 'flag bad' }, 'Declined' + (d.declineNote ? ': ' + d.declineNote : '') + ' (' + fmt(d.start) + ')') : null; };
    setKids(root, msg,
      section('To schedule', b.toSchedule, (a) => row([person(a), dn(a, 'interview')], 'Propose interview time', proposeForm(a, 'interview')), 'Nobody is waiting for an interview time.'),
      section('Waiting for Principal', b.waiting, (p) => row([h('b', {}, p.name), ' ', p.kind, ' ' + fmt(p.start)], 'Cancel', (close) => {
        const note = field('cn' + p.id, 'Note (optional)', inp('text'));
        return h('form', { onsubmit: async (e) => { e.preventDefault(); if (!confirm('Cancel this proposal for ' + p.name + '?')) return; if (await write('apptcancel', { id: p.id, note: val(note.control).trim() }, 'Cancelled.')) close(); } },
          note.root, h('div', { class: 'row' }, h('button', { type: 'submit' }, 'Cancel proposal'), h('button', { type: 'button', class: 'secondary', onclick: close }, 'Keep it')));
      }), 'You have no proposals waiting.'),
      section('Booked', b.booked, ({ a, x }) => row([person(a), h('div', {}, x.kind + ' · ' + fmt(x.start)), h('div', { class: 'meta' }, 'Call the candidate to confirm')]), 'Nothing booked in the next 7 days.'),
      section('Reports to upload', b.reports, ({ a, x }) => row([person(a), h('div', {}, x.kind + ' · ' + fmt(x.start))], 'Upload report', reportForm(a, x)), 'No reports waiting.'),
      section('Demos to book', b.demos, (a) => row([person(a), dn(a, 'demo')], 'Propose demo time', proposeForm(a, 'demo')), 'Nobody needs a demo time.'),
      section('Documents to chase', b.docs, (a) => row([person(a), h('div', { class: 'flag' }, 'Needed before Hired: ' + a.docsMissing.join(', ')), h('a', { href: '../staff/add-employee.html?view=documents' }, 'Open Documents page')]), 'No documents to chase.'),
      h('section', { class: 'block' }, h('h2', {}, 'Add walk-in'), walkinForm()));
  }

  setKids(root, h('p', {}, 'Loading...'));
  try {
    const r = await be.get('hiringapplicants');
    if (!r.success) return setKids(root, h('p', { role: 'alert' }, r.error || 'Could not load hiring.'));
    data = r; await loadAppt(); paint();
  } catch (e) { setKids(root, h('p', { role: 'alert' }, failText(e))); }
}
