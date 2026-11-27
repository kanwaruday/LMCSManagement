// ═══════════════════════════════════════════════════════════════════
// PDR Backend -- the game's Owner hiring room (W7, N3, 2026-11-12): key-gated gameHr* actions over the SAME hiring.gs reads.
//
// Called only by lms-game's `classic` Edge Function (classic-proxy-contract.md), POST text/plain:
//   { action, key, role, campus, campuses, email, params }
// Same gate as game-approvals.gs (gameKeyOk_, gameOk_, gameNo_ live there, same project): the PDR GAME_KEY; the person is the game's
// verified email, re-checked against this project's own Allowlist (pdrCallerForEmail_), acting as body.role (Owner, Principal, FeeClerk or
// Hr: W7 S2, 28 Nov): that role must be on the person's own row, and it picks the allowed steps (GAME_HR_ROLE_OPS). Anyone else: not_authorized.
// Tenant scope: applicants are limited to the proxy's school list (`campuses`); missing = none (fails closed).
// Nothing personal leaves unmasked: phones come back as last 4, no salary figure, no report contents, no emails.
// gameHrReveal is the one way to see a full phone number or the offer breakdown; every reveal is written to the "Game Reveals" tab
// (when, the Owner's name, which field, which applicant id) -- never the value itself.
// gameHrAct (W7 slice 1, 13 Nov): the Owner's hiring steps, each one the SAME hiring.gs / hiring-appointments.gs function the old
// page calls (so every rule, lock and stamp is theirs): shortlist, mark interview/demo done, propose an appointment (or record one
// already held on a past date: P52, hiring-appointments.gs apptHeld_), accept /
// decline / cancel one, settle a pending reject, revive. Applicants by id (never a sheet row from the client); appointments only of
// an applicant in the proxy's schools. Each done step is written to the "Game Actions" tab (when, who, which step, which id).
// Not here: Start Hiring Process (it calls the Roster proxy with the person's Google token, which a game call doesn't carry).
// ═══════════════════════════════════════════════════════════════════

const GAME_HR_ACTIONS = ['gameHrPipeline', 'gameHrApplicant', 'gameHrReveal', 'gameHrAct', 'gameHrSalaryConfig', 'gameHrOffer', 'gameHrEpf', 'gameHrScanTicket'];
// W7 S3 (N3, 25 Nov): the Offer Calculator (salary/index.html) for the Owner: its config, recording an offer on an applicant, and the EPF
// exemption. Owner only; every one is a POST (so View as can't send it); salary figures are never logged, the config look is audited.
const GAME_HR_OWNER_ACTIONS = ['gameHrSalaryConfig', 'gameHrOffer', 'gameHrEpf'];
// S3 part 2 (N3, 26 Nov): the interview / demo report as a scan (hiringUploadReport_), for the Owner and the Principal. The proxy hands
// out a ticket (gameHrScanTicket: the report form is bound to it server-side, in the script cache, for 10 minutes); the browser sends the
// file straight here in parts (gameHrUploadPart, no key: the signed ticket is the gate); the last part files the report as the old page.
const GAME_HR_TICKET_MS = 10 * 60 * 1000, GAME_HR_PARTS_MAX = 6, GAME_HR_PART_MAX = 1900000; // 6 x 1.3 MB raw covers the 7 MB scan cap
const GAME_HR_SCAN_MIMES = ['application/pdf', 'image/jpeg', 'image/png'];
const GAME_HR_OFFER_NUMS = ['basic', 'da', 'ada', 'epfE', 'pfE', 'esiE', 'totEpf', 'totEsi', 'rrf', 'tuition', 'cti', 'net', 'lmsExp', 'otherExp'];
const GAME_HR_OPS = ['shortlist', 'unshortlist', 'markstage', 'propose', 'held', 'appt', 'confirmreject', 'revive', 'interview', 'demo', 'add', 'dupsettle', 'calretry'];
// W7 S2 (N3, 25 Nov; Uday: "keep it in the game"): the room opens to the Principal and the Fee Clerk/PRO too. The game says which role
// it acts as (body.role); that role must be on this person's own Allowlist row, and it picks the steps. Every step is still the old
// page's own function, so hiring.gs's scoping (hirScopedRow_: the caller's schools) and its role checks keep applying underneath.
// Principal: the old hiring/index.html steps, minus the Owner's (settle a pending reject, revive, refresh the tracker, Start Hiring).
// Fee Clerk/PRO: the old office/hiring.html legwork (main.gs PDR_FEECLERK_*): add an applicant, propose / record / cancel a visit.
const GAME_HR_ROLES = { owner: 'Owner', principal: 'Principal', fee_clerk: 'FeeClerk', hr: 'Hr' };
const GAME_HR_ROLE_OPS = {
  Owner: GAME_HR_OPS,
  Principal: ['shortlist', 'unshortlist', 'markstage', 'propose', 'held', 'appt', 'interview', 'demo', 'add', 'dupsettle', 'calretry'],
  FeeClerk: ['propose', 'held', 'appt', 'add'], // appt: cancel only (the Fee Clerk never accepts or declines)
  Hr: ['shortlist', 'unshortlist', 'markstage', 'propose', 'held', 'appt', 'interview', 'demo', 'add', 'dupsettle', 'calretry'], // the Principal's steps, for every school the game says the person's hr grant reaches; never salary
};
/** Who acts. The game already checked the person's role grant (an `hr` grant is tenant-wide, granted in People & roles) and the proxy's school
 *  list bounds what they see. Owner / Principal / FeeClerk must also be on the person's own Allowlist row, as before. Hr needs only to be ON the
 *  Allowlist (a real employee row); the old hiring.gs rules are written for Principal / Coordinator / Owner, so the call acts as a Principal
 *  (copy: Owner is never added, salary actions are refused above). Returns the caller to use, or null. */
function gameHrActAs_(caller, role) {
  if (!caller || !role) return null;
  if (role !== 'Hr') return callerHasRole_(caller, role) ? caller : null;
  const c = Object.assign({}, caller);
  c.roles = (caller.roles || []).filter(function (r) { return r !== 'Owner'; }).concat(['Principal']);
  return c;
}
// the report forms' own fields (hiring.gs hirInterviewRecord_ / hirDemoRecord_); anything else in the form is dropped, never passed on
const GAME_HR_FORM_KEYS = {
  interview: ['interviewDate', 'position', 'confidence', 'english', 'commitment', 'experience', 'capability', 'qualificationRemarks', 'otherSkills',
    'strengths', 'weaknesses', 'expectedSalary', 'familySupport', 'spouseOccupation', 'remarks'],
  demo: ['demoDate', 'class', 'subject', 'scores', 'strengths', 'improve', 'studentFeedback', 'remarks', 'nextDemoAt'],
};
const GAME_HR_JSON_KEYS = ['capability', 'experience', 'scores'];
const GAME_HR_ADD_KEYS = ['name', 'phone', 'age', 'gender', 'qualification', 'bed', 'subjects', 'source', 'notes', 'cv']; // cv: a link or text (hiring.gs keeps 500 characters)
const GAME_HR_REVEAL_FIELDS = ['phone', 'offer'];

const gameHrTags_ = function (branches) { return (String(branches || '').match(/LMS-\d/g) || []).map(function (t) { return 'LMS' + t.slice(4); }); };
const gameHrLast4_ = function (phone) { const d = String(phone || '').replace(/\D/g, ''); return d.length >= 4 ? '··' + d.slice(-4) : ''; };

/** the next open appointment (proposed, or accepted and still to come), else null */
function gameHrNext_(appts, nowMs) {
  const open = (appts || []).filter(function (x) { return x.status === 'proposed' || (x.status === 'accepted' && hirMs_(x.start) >= nowMs); });
  open.sort(function (x, y) { return hirMs_(x.start) - hirMs_(y.start); });
  return open.length ? { kind: open[0].kind, start: open[0].start, status: open[0].status } : null;
}

/** One applicant as the room's list shows it: masked, no salary, no notes. */
function gameHrRow_(a, schools, nowMs) {
  const tags = gameHrTags_(a.branches).filter(function (c) { return schools.indexOf(c) !== -1; });
  return {
    id: a.applicantId, name: a.name, schools: tags, position: a.positionLabel || a.reportedPosition || '', subjects: a.subjects,
    qualification: a.qualification, status: a.status, matchScore: a.matchScore, appliedAt: a.timestamp, round: a.round,
    rejectReason: a.rejectReason, phone: gameHrLast4_(a.phone), next: gameHrNext_(a.appointments, nowMs),
    docsMissing: (a.docsMissing || []).length, offerRecorded: !!a.salaryOfferAt, hasOffer: !!a.offerBreakdown,
  };
}

/** hiring.gs's own list for this caller, cut to the proxy's schools (an applicant shows if any school they applied to is in it). */
function gameHrList_(caller, schools) {
  const res = hiringApplicants_(caller);
  return (res.applicants || []).filter(function (a) { return gameHrTags_(a.branches).some(function (c) { return schools.indexOf(c) !== -1; }); });
}

function gameHrAudit_(caller, field, id) {
  const wb = hirWorkbook_();
  const sh = wb.getSheetByName('Game Reveals') || wb.insertSheet('Game Reveals');
  if (sh.getLastRow() < 1) sh.appendRow(['At', 'Who', 'Field', 'Applicant ID']);
  sh.appendRow([new Date(), caller.name || 'Owner', field, id]); // the person by name (the Principal or Fee Clerk too); never the value
}

function gameHrLog_(caller, op, id) {
  const wb = hirWorkbook_();
  const sh = wb.getSheetByName('Game Actions') || wb.insertSheet('Game Actions');
  if (sh.getLastRow() < 1) sh.appendRow(['At', 'Who', 'Step', 'Applicant ID']);
  sh.appendRow([new Date(), caller.name || 'Owner', op, id]);
}

/** One applicant in full (still masked): the room's detail view. */
/** G2 FIX (security): the notes as a non-Owner may see them. Recording an offer appends "Salary Offer recorded: … CTI ₹…" to the row's
 *  notes (the old page and gameHrOffer_ alike), so for anyone but the Owner every " | " segment that carries a salary line or a rupee
 *  figure is dropped. Salary stays the Owner's. */
function gameHrNotesFor_(notes, role) {
  if (role === 'Owner') return notes;
  return String(notes || '').split(' | ').filter(function (seg) { return !/salary|offer|ctc|cti|net bank|₹|\brs\.?\s*\d|inr\s*\d/i.test(seg); }).join(' | ');
}

function gameHrDetail_(a, schools, nowMs, role) {
  const reports = function (list, kind) {
    return (list || []).map(function (r) { return { kind: kind, at: r['Submitted At'] || '', recommendation: r.recommendation || '' }; });
  };
  return {
    applicant: gameHrRow_(a, schools, nowMs),
    notes: gameHrNotesFor_(a.notes, role),
    appointments: (a.appointments || []).map(function (x) { return { id: x.id, kind: x.kind, start: x.start, status: x.status, reportFiled: !!x.reportFiled,
      calendarMissing: x.status === 'accepted' && x.calendarMode === 'none' }; }), // S2: accepted, but the calendar write failed (Retry)
    reports: reports(a.interviewReports, 'interview').concat(reports(a.demoReports, 'demo')),
    stages: { shortlistedAt: a.shortlistedAt, interviewAt: a.interviewAt, demoAt: a.demoAt, salaryOfferAt: a.salaryOfferAt,
      mdInterviewAt: a.mdInterviewAt, hiringStartedAt: a.hiringStartedAt, dateOfJoining: a.dateOfJoining },
    earlierRounds: (a.history || []).map(function (h) { return { round: h.round, rejectReason: h.rejectReason || '', revivedAt: h.revivedAt || '' }; }),
    docsMissing: a.docsMissing || [],
    pendingReject: a.stageMarks && a.stageMarks.rejectPending ? String(a.stageMarks.rejectPending.reason || 'Rejected') : '', // a Fee Clerk's reject waiting on a yes
  };
}

/** A refusal from hiring.gs in its own plain words, unless it could carry data (an email, a long number). */
function gameHrSay_(err) {
  const m = String((err && err.message) || '').slice(0, 160);
  return m && !/@|\d{5,}/.test(m) ? m : '';
}

/** One hiring step: the same function the old page calls, on this applicant's row. */
function gameHrDo_(caller, a, p) {
  const op = String(p.op || ''), row = a.row;
  if (op === 'shortlist' || op === 'unshortlist') return hiringShortlist_(caller, { row: row, on: op === 'shortlist' });
  if (op === 'markstage') return hiringMarkStage_(caller, { row: row, stage: String(p.stage || '') });
  if (op === 'propose') return apptPropose_(caller, { row: row, kind: String(p.kind || ''), start: String(p.at || '') });
  if (op === 'held') return apptHeld_(caller, { row: row, kind: String(p.kind || ''), start: String(p.at || '') }); // P52: already happened
  if (op === 'confirmreject') return hiringConfirmReject_(caller, { row: row, confirm: p.confirm === '1' });
  if (op === 'revive') return hiringRevive_(caller, { row: row, note: String(p.note || '') });
  if (op === 'interview' || op === 'demo') {
    // the report form arrives as flat params (the proxy caps each at 500 characters); the score maps come as small JSON strings
    const b = { row: row, recommendation: String(p.recommendation || ''), rejectReason: String(p.rejectReason || ''), rejectNote: String(p.rejectNote || '') };
    GAME_HR_FORM_KEYS[op].forEach(function (k) {
      if (p[k] === undefined) return;
      b[k] = GAME_HR_JSON_KEYS.indexOf(k) !== -1 ? gameHrJson_(p[k]) : String(p[k]);
    });
    return (op === 'interview' ? hiringSubmitInterview_ : hiringSubmitDemo_)(caller, b);
  }
  if (op === 'dupsettle') {
    const other = (p.otherList || []).filter(function (x) { return x.applicantId === String(p.other || ''); })[0];
    if (!other) throw new Error('Pick the other candidate from your list.');
    return hiringDupSettle_(caller, { row: row, otherRow: other.row, same: p.same === '1' });
  }
  if (op === 'calretry') {
    const appt = (a.appointments || []).filter(function (x) { return x.id === String(p.appt || ''); })[0];
    if (!appt) throw new Error('That appointment isn’t this applicant’s.');
    return apptCalendarRetry_(caller, { id: appt.id });
  }
  if (op === 'appt') {
    const appt = (a.appointments || []).filter(function (x) { return x.id === String(p.appt || ''); })[0];
    if (!appt) throw new Error('That appointment isn’t this applicant’s.');
    if (p.decision === 'cancel') return apptCancel_(caller, { id: appt.id, note: String(p.note || '') });
    return apptDecide_(caller, { id: appt.id, decision: String(p.decision || ''), note: String(p.note || '') });
  }
  throw new Error('Unknown step');
}

/** a score map (capability, experience, scores) sent as a JSON string: an object, or nothing */
function gameHrJson_(raw) {
  let f = {};
  try { f = JSON.parse(String(raw || '{}')); } catch (err) { throw new Error('The form didn’t come through. Try again.'); }
  return f && typeof f === 'object' && !Array.isArray(f) ? f : {};
}

/** add an applicant (hiring.gs hiringAddApplicant_) at one of the proxy's schools; only the add form's own fields pass */
function gameHrAdd_(caller, p, schools) {
  const campus = String(p.campus || '').toUpperCase();
  if (schools.indexOf(campus) === -1) return gameNo_('not_found');
  const b = { campusId: campus };
  GAME_HR_ADD_KEYS.forEach(function (k) { if (p[k] !== undefined) b[k] = String(p[k]); });
  let res;
  try { res = hiringAddApplicant_(caller, b); } catch (err) { return { success: true, data: { ok: false, code: 'refused', say: gameHrSay_(err) } }; }
  if (res && res.duplicate) return gameOk_({ ok: false, code: 'duplicate', id: res.applicantId || '' }); // an id only if it's in their own list
  gameHrLog_(caller, 'add', (res && res.applicantId) || '');
  return gameOk_({ ok: true, id: (res && res.applicantId) || '' });
}

/** ₹ with Indian grouping (12,34,567), as the old page's toLocaleString('en-IN'), without relying on Intl in Apps Script */
function gameHrInr_(n) {
  const v = String(Math.round(Number(n) || 0)), neg = v[0] === '-', d = neg ? v.slice(1) : v;
  const last3 = d.slice(-3), rest = d.slice(0, -3);
  return '₹' + (neg ? '-' : '') + (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' : '') + last3;
}

/** the offer as the old page records it (updatehiringstatus offerBreakdown): known keys only, figures as whole numbers */
function gameHrOfferBreakdown_(raw) {
  const b = gameHrJson_(raw), out = {};
  GAME_HR_OFFER_NUMS.forEach(function (k) {
    const v = Number(b[k]);
    if (!isFinite(v) || v < 0 || v > 1e8) throw new Error('The offer figures didn’t come through. Work it out again.');
    out[k] = k === 'lmsExp' || k === 'otherExp' ? v : Math.round(v);
  });
  out.designation = hirText_(b.designation, 120); out.subjects = hirText_(b.subjects, 120);
  return out;
}

/** Record a salary offer on an applicant, as salary/index.html recordSalaryOffer_ does: the notes line, salaryOfferAt and the
 *  breakdown on the hiring row (hiringUpdateStatus_), then, the first time only, the "Salary Offer Approval" request (aprSubmit_).
 *  (The Payroll project's copy is the game's second call, to that project.) */
function gameHrOffer_(caller, a, p, schools) {
  const b = gameHrOfferBreakdown_(p.breakdown);
  const campus = String(p.campus || '').toUpperCase();
  if (schools.indexOf(campus) === -1 || gameHrTags_(a.branches).indexOf(campus) === -1) throw new Error('Pick one of the schools this applicant applied to.');
  const y2 = Math.round(Number(p.netY2) || 0), y3 = Math.round(Number(p.netY3) || 0);
  const prior = hiringRowNotes_(a.row);
  const role = b.designation + (b.designation && b.subjects ? ': ' : '') + b.subjects;
  const summary = 'Salary Offer recorded: ' + (role ? role + ' — ' : '') + 'CTI ' + gameHrInr_(b.cti) + ', Net Bank Y1 ' + gameHrInr_(b.net) + '/mo, experience LMS ' +
    b.lmsExp + ' y + other ' + b.otherExp + ' y (' + new Date().toISOString().slice(0, 10) + ')';
  hiringUpdateStatus_(caller, { row: a.row, status: '', notes: prior.notes ? prior.notes + ' | ' + summary : summary,
    salaryOfferAt: new Date().toISOString(), offerBreakdown: JSON.stringify(b) });
  if (prior.salaryOfferAt) return 'already';
  const res = aprSubmit_(caller, {
    category: 'Salary Offer Approval',
    title: 'Appointment Confirmation — ' + a.name + (role ? ' (' + role + ')' : ''),
    description: 'Confirm the appointment of ' + a.name + (role ? ' as ' + role : '') + ' at ' + campus + ' (' + a.applicantId + '), after the MD Academics interview. ' +
      'Proposed pay: CTI ' + gameHrInr_(b.cti) + ', Net Bank Y1 ' + gameHrInr_(b.net) + '/mo, Y2 ' + gameHrInr_(y2) + '/mo, Y3 ' + gameHrInr_(y3) + '/mo, on experience LMS ' +
      b.lmsExp + ' y + other ' + b.otherExp + ' y. Approving lets the Principal complete the hire.',
    itemName: a.applicantId + ' — ' + a.name,
  });
  return res && res.success ? 'submitted' : 'failed';
}

// ── S3 part 2: scan tickets ──────────────────────────────────────────
function gameHrB64_(s) { return Utilities.base64EncodeWebSafe(s).replace(/=+$/, ''); }
function gameHrSign_(body) {
  return gameHrB64_(Utilities.computeHmacSha256Signature(body, String(PropertiesService.getScriptProperties().getProperty('GAME_KEY') || '')));
}
/** a ticket for one report scan: who, which applicant row, which kind, and the report form, bound server-side for 10 minutes */
function gameHrScanTicket_(caller, role, a, p) {
  const kind = String(p.kind || '');
  if (kind !== 'interview' && kind !== 'demo') throw new Error('Pick interview or demo for the report');
  if (GAME_HR_SCAN_MIMES.indexOf(String(p.mime || '')) === -1) throw new Error('The scan must be a PDF, JPG or PNG file');
  const form = { recommendation: String(p.recommendation || ''), rejectReason: String(p.rejectReason || ''), rejectNote: String(p.rejectNote || '') };
  GAME_HR_FORM_KEYS[kind].forEach(function (k) { if (p[k] !== undefined) form[k] = GAME_HR_JSON_KEYS.indexOf(k) !== -1 ? gameHrJson_(p[k]) : String(p[k]); });
  const nonce = Utilities.getUuid(), exp = Date.now() + GAME_HR_TICKET_MS;
  CacheService.getScriptCache().put('game_hr_scan_' + nonce, JSON.stringify({ e: caller.email, r: role, id: a.applicantId, row: a.row, k: kind, f: form, x: exp }), GAME_HR_TICKET_MS / 1000);
  const body = gameHrB64_(nonce);
  const url = PropertiesService.getScriptProperties().getProperty('PDR_WEBAPP_URL') || ScriptApp.getService().getUrl();
  return { url: url + '?ticket=' + body + '.' + gameHrSign_(body) + '&action=gameHrUploadPart', expiresAt: new Date(exp).toISOString() };
}
/** the ticket's bound request if its signature holds, it hasn't expired and it hasn't been used; else null */
function gameHrTicketOk_(s) {
  const at = String(s || '').indexOf('.');
  if (at < 1 || String(PropertiesService.getScriptProperties().getProperty('GAME_KEY') || '').length < 32) return null;
  const body = s.slice(0, at), sig = s.slice(at + 1);
  if (!gameSameKey_(gameHrSign_(body), sig)) return null;
  let nonce;
  try { nonce = Utilities.newBlob(Utilities.base64DecodeWebSafe(body + '==='.slice((body.length + 3) % 4))).getDataAsString(); } catch (err) { return null; }
  const raw = CacheService.getScriptCache().get('game_hr_scan_' + nonce);
  if (!raw) return null; // expired or burnt
  const t = JSON.parse(raw);
  if (typeof t.x !== 'number' || t.x < Date.now()) return null;
  t.nonce = nonce;
  return t;
}
/** one part of a scan. Parts wait in the hiring scans folder (_game_parts/<nonce>), a resent part replaces its file; the last part
 *  reassembles the file and files the report with hiringUploadReport_ as the ticket's person (re-checked now), then burns the ticket. */
function gameHrUploadPart_(b) {
  const t = gameHrTicketOk_(b.ticket);
  if (!t) return { success: false, error: 'not_authorized' };
  const part = Number(b.part), of = Number(b.of), base64 = String(b.base64 || '');
  if (!Number.isInteger(part) || !Number.isInteger(of) || of < 1 || of > GAME_HR_PARTS_MAX || part < 1 || part > of) return { success: false, error: 'BAD_PART' };
  if (!base64 || base64.length > GAME_HR_PART_MAX || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return { success: false, error: 'BAD_PART' };
  const rootId = PropertiesService.getScriptProperties().getProperty('HIR_SCAN_FOLDER_ID');
  if (!rootId) return { success: false, error: 'NOT_SET_UP' };
  const root = DriveApp.getFolderById(rootId);
  const sub = function (parent, name) { const it = parent.getFoldersByName(name); return it.hasNext() ? it.next() : parent.createFolder(name); };
  const dir = sub(sub(root, '_game_parts'), t.nonce);
  const name = 'part-' + part + '-of-' + of;
  const old = dir.getFilesByName(name);
  while (old.hasNext()) old.next().setTrashed(true);
  dir.createFile(name, base64, 'text/plain');
  if (part < of) return { success: true };
  const bytes = [];
  for (let i = 1; i <= of; i++) {
    const it = dir.getFilesByName('part-' + i + '-of-' + of);
    if (!it.hasNext()) return { success: false, error: 'PARTS_MISSING' };
    Array.prototype.push.apply(bytes, Utilities.base64Decode(it.next().getBlob().getDataAsString()));
  }
  let caller = null;
  try { caller = pdrCallerForEmail_(t.e); } catch (err) { caller = null; }
  caller = gameHrActAs_(caller, GAME_HR_ROLES[t.r]);
  if (!caller || GAME_HR_ROLE_OPS[GAME_HR_ROLES[t.r]].indexOf(t.k) === -1) return { success: false, error: 'not_authorized' };
  try {
    hiringUploadReport_(caller, Object.assign({}, t.f, { row: t.row, kind: t.k, file: { base64: Utilities.base64Encode(bytes) } }));
  } catch (err) { return { success: false, error: 'REFUSED', say: gameHrSay_(err) }; }
  CacheService.getScriptCache().remove('game_hr_scan_' + t.nonce);
  dir.setTrashed(true);
  gameHrLog_(caller, t.k + ' scan', t.id);
  return { success: true, fileId: 'filed' };
}

function gameHrDispatch_(body) {
  if (String((body && body.action) || '') === 'gameHrUploadPart') return gameHrUploadPart_(body); // the browser's parts: the signed ticket is the gate (no key)
  if (!gameKeyOk_(body)) return { success: false, error: 'not_authorized' };
  if (GAME_HR_ACTIONS.indexOf(String(body.action)) === -1) return { success: false, error: 'unknown_action' };
  let caller;
  try { caller = pdrCallerForEmail_(body.email); } catch (err) { caller = null; }
  const role = GAME_HR_ROLES[String(body.role || '')]; // the role the game acts as; it must be on this person's own Allowlist row (Hr: see gameHrActAs_)
  caller = gameHrActAs_(caller, role);
  if (!caller) return gameNo_('not_authorized');
  const ops = GAME_HR_ROLE_OPS[role];
  if (GAME_HR_OWNER_ACTIONS.indexOf(String(body.action)) !== -1 && role !== 'Owner') return gameNo_('not_authorized'); // salary is the Owner's
  const p = body.params || {}, nowMs = Date.now();
  const schools = Array.isArray(body.campuses) ? body.campuses.map(function (c) { return String(c).toUpperCase(); }) : [];
  try {
    switch (String(body.action)) {
      case 'gameHrPipeline': {
        const status = hiringApprovalStatus_(caller);
        return gameOk_({
          statuses: HIR_STATUSES,
          schools: (status.campuses || []).filter(function (c) { return schools.indexOf(c.campusId) !== -1; }).map(function (c) {
            return { code: c.campusId, openPositions: (c.newPositions || []).length, hiringApproved: !!c.hiringDecisionApproved };
          }),
          applicants: gameHrList_(caller, schools).map(function (a) { return gameHrRow_(a, schools, nowMs); }),
        });
      }
      case 'gameHrApplicant': {
        const a = gameHrList_(caller, schools).filter(function (x) { return x.applicantId === String(p.id || ''); })[0];
        if (!a) return gameNo_('not_found');
        return gameOk_(gameHrDetail_(a, schools, nowMs, role));
      }
      case 'gameHrAct': {
        if (ops.indexOf(String(p.op || '')) === -1) return gameNo_('not_authorized');
        if (role === 'FeeClerk' && p.op === 'appt' && p.decision !== 'cancel') return gameNo_('not_authorized');
        if (p.op === 'add') return gameHrAdd_(caller, p, schools);
        const a = gameHrList_(caller, schools).filter(function (x) { return x.applicantId === String(p.id || ''); })[0];
        if (!a) return gameNo_('not_found');
        if (p.op === 'dupsettle') p.otherList = gameHrList_(caller, schools); // the other candidate by id, from this caller's own list
        try { gameHrDo_(caller, a, p); } catch (err) { return { success: true, data: { ok: false, code: 'refused', say: gameHrSay_(err) } }; }
        gameHrLog_(caller, String(p.op), a.applicantId);
        const fresh = gameHrList_(caller, schools).filter(function (x) { return x.applicantId === a.applicantId; })[0];
        return gameOk_(fresh ? gameHrDetail_(fresh, schools, Date.now(), role) : { gone: true });
      }
      case 'gameHrScanTicket': {
        if (ops.indexOf(String(p.kind || '')) === -1) return gameNo_('not_authorized'); // the report steps are the Owner's and the Principal's
        const a = gameHrList_(caller, schools).filter(function (x) { return x.applicantId === String(p.id || ''); })[0];
        if (!a) return gameNo_('not_found');
        try { return { success: true, data: gameHrScanTicket_(caller, String(body.role), a, p) }; }
        catch (err) { return { success: true, data: { ok: false, code: 'refused', say: gameHrSay_(err) } }; }
      }
      case 'gameHrSalaryConfig': {
        gameHrAudit_(caller, 'salary config', ''); // the pay scale is salary data: the look is recorded first
        const c = salaryConfig_();
        return gameOk_({ payScale: c.payScale, jobRoleNorms: c.jobRoleNorms, tuitionFees: c.tuitionFees, payrollRates: c.payrollRates, constants: c.constants });
      }
      case 'gameHrOffer': {
        const a = gameHrList_(caller, schools).filter(function (x) { return x.applicantId === String(p.id || ''); })[0];
        if (!a) return gameNo_('not_found');
        let approval;
        try { approval = gameHrOffer_(caller, a, p, schools); } catch (err) { return { success: true, data: { ok: false, code: 'refused', say: gameHrSay_(err) } }; }
        gameHrLog_(caller, 'offer', a.applicantId); // never the figures
        return gameOk_({ ok: true, approval: approval, name: a.name });
      }
      case 'gameHrEpf': {
        const a = gameHrList_(caller, schools).filter(function (x) { return x.applicantId === String(p.id || ''); })[0];
        if (!a) return gameNo_('not_found');
        if (p.op === 'request') {
          const res = aprSubmit_(caller, { category: 'EPF Exemption', title: 'EPF Exemption — ' + a.name,
            description: 'MD-level hire at ' + String(p.campus || '').toUpperCase() + '. Requesting EPF exemption per standard MD compensation structure.', itemName: a.name });
          if (!res || !res.success) return { success: true, data: { ok: false, code: 'refused', say: gameHrSay_({ message: res && res.error }) } };
          gameHrLog_(caller, 'epf request', a.applicantId);
          return gameOk_({ ok: true, requested: true, approved: false });
        }
        return gameOk_({ ok: true, approved: salEpfExemptionApproved_(a.name) });
      }
      case 'gameHrReveal': {
        const field = String(p.field || '');
        if (GAME_HR_REVEAL_FIELDS.indexOf(field) === -1) return gameNo_('bad_input');
        if (field === 'offer' && role !== 'Owner') return gameNo_('not_authorized'); // salary stays the Owner's
        const a = gameHrList_(caller, schools).filter(function (x) { return x.applicantId === String(p.id || ''); })[0];
        if (!a) return gameNo_('not_found');
        const value = field === 'phone' ? a.phone : a.offerBreakdown;
        if (!value) return gameNo_('nothing');
        gameHrAudit_(caller, field, a.applicantId); // audited before the value goes out
        return gameOk_({ field: field, value: value });
      }
    }
  } catch (err) {
    return gameNo_('refused'); // never the sheet's own error text
  }
  return { success: false, error: 'unknown_action' };
}
