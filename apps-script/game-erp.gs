var GAME_MODULE_ACTIONS = GAME_MODULE_ACTIONS || {};
var GAME_MODULE_MISSIONS = GAME_MODULE_MISSIONS || {};
var GAME_MODULE_QUESTS = GAME_MODULE_QUESTS || {};
var CQ_PREFILL = CQ_PREFILL || {};
var CQ_MODULE_DEFS = CQ_MODULE_DEFS || {};

// ═══════════════════════════════════════════════════════════════════
// LMCS Game Backend -- the ERP read module (V2 row #7). Scoped, read-only reads of the CyberSchoolManager data the extractor puts
// into Uday's private campus Sheets (one Sheet per campus, Script properties ERP_SHEET_LMS1..ERP_SHEET_LMS6; Uday sets them, no
// IDs in code). Contract: side-session-notes erp-read-contract.md (tabs, headers, actions, shapes, scopes).
//   GET  erpread       ?what=scope|students|attendance|marks|dues|bus|staff|ties&campus=&class=&section=&house=&subject=&exam=&bus=&from=&to=
//   POST erpdriverbus  {deviceToken}: a linked driver phone's own bus list (needs driver-token.gs in this project, else UNAVAILABLE)
// Scope (erpAccess_): Owner every campus and dataset; Principal their campus; Fee Clerk their campus's students, dues and buses;
// everyone else only through an Assignments row tying their employee code or email to a class-section (class teacher), a
// class-section-subject (subject teacher) or a bus (in-charge). No tie = nothing. Coordinator has no ERP scope (not in the brief).
// Confirmed ties only (Uday, 7 Nov: "wherever we have existing data, it should just confirm that from the actual staff in the game
// quests"): a seeded Assignments row is UNCONFIRMED until its teacher confirms or corrects it in setup quest ERP_TIE_QUEST (the
// game-confirm.gs engine, pre-filled here by 'erp.myTies'). A tie unlocks students only when confirmed WITH a section and with the
// seeded class (a corrected class waits for the Principal); "Not my class" unlocks nothing (children's faces rule). what=ties shows
// the Principal every row's state. Bus ties have no confirm step yet, so none count.
// ponytail: bus ties fail closed until the quest gets a bus field (no bus in-charges are seeded yet).
// Privacy: rows are PROJECTED to the contract's columns (an Aadhaar or phone column in a Sheet never leaves); no photo column, no
// Drive read (children's faces rule: no student photos this week); logs carry counts only, never a name, enroll number or email.
// Empty state: no Sheet ID = configured:false with no rows, never an error; a missing tab is listed in `missing`.
// ponytail: no cache; each read opens the campus Sheet once (1-2 s). Add a CacheService layer per campus+tab if homes call it often.
// ponytail: rows join on ACTIVE students only, so dues of a student who left drop out. Add pending_inactive when the Fee Clerk asks.
// ═══════════════════════════════════════════════════════════════════

var ERP_CAMPUSES = ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6'];
var ERP_WHATS = ['students', 'attendance', 'marks', 'dues', 'bus', 'staff', 'ties'];
// tab -> the only columns ever read from it (header names, matched ignoring case, spaces and underscores: enroll_no = enrollNo).
// Tab names are the extractor's (vault work/active/csm-erp-extractor.md, Private-Drive export design); assignments is filled by hand.
var ERP_TABS = {
  Students: ['enrollNo', 'name', 'class', 'section', 'rollNo', 'house', 'status', 'bus', 'route', 'pickupPoint', 'way'],
  Attendance: ['date', 'enrollNo', 'status'],
  Marks: ['session', 'term', 'exam', 'subject', 'enrollNo', 'maxMarks', 'marks'],
  Dues: ['enrollNo', 'feeHead', 'receivable', 'received', 'concession', 'balance'],
  Staff: ['empCode', 'name', 'designation', 'department', 'status', 'house'],
  Assignments: ['empCode', 'email', 'kind', 'class', 'section', 'subject', 'bus', 'teacher', 'fix'],
};
var ERP_SHEET_TAB = { Students: 'students_now', Attendance: 'attendance', Marks: 'marks_summary', Dues: 'dues', Staff: 'staff', Assignments: 'assignments' };
var ERP_NEEDS = { students: ['Students'], attendance: ['Students', 'Attendance'], marks: ['Students', 'Marks'], dues: ['Students', 'Dues'], bus: ['Students'], staff: ['Staff'], ties: ['Assignments'] };
var ERP_TIE_QUEST = 't2'; // the setup quest (game-confirm.gs) where a teacher confirms their seeded ties
var ERP_MAX_DAYS = 31;
var ERP_IST_MS = 330 * 60000;

function erpErr_(code, error) { return { success: false, code: code, error: error }; }
var ERP_DENY = 'You can only see the students you are in charge of.';

function erpNorm_(v) { return String(v === null || v === undefined ? '' : v).trim().replace(/\s+/g, ' ').toUpperCase(); }
function erpBusKey_(v) { return erpNorm_(v).replace(/[^A-Z0-9]/g, ''); }
function erpHeadKey_(v) { return String(v || '').toLowerCase().replace(/[\s_\-.]/g, ''); }
function erpIstDay_(d) { return new Date(d.getTime() + ERP_IST_MS).toISOString().slice(0, 10); }
function erpCell_(v) { return v instanceof Date ? erpIstDay_(v) : String(v === null || v === undefined ? '' : v).trim(); }
function erpNum_(v) { const n = Number(String(v === null || v === undefined ? '' : v).replace(/[,₹\s]/g, '')); return isFinite(n) ? n : 0; }
function erpCampusLabel_(c) { return c.replace(/^LMS(\d)$/, 'LMS $1'); }

// sheet values (header first) -> [{col: text}] with exactly the tab's columns ('' when the Sheet lacks one)
function erpProject_(values, cols) {
  if (!values || !values.length) return [];
  const head = values[0].map(erpHeadKey_), at = cols.map(function (c) { return head.indexOf(erpHeadKey_(c)); });
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i], o = {};
    let any = false;
    cols.forEach(function (c, j) { o[c] = at[j] === -1 ? '' : erpCell_(r[at[j]]); if (o[c]) any = true; });
    if (any) out.push(o);
  }
  return out;
}

// ── caller → campuses, ties, access ──────────────────────────────────
function erpIsOwner_(caller) { return (caller.roles || []).indexOf('Owner') !== -1; }

// Owner: all six. Anyone else: their allowlist campus (or comma list), only real campuses; 'ALL' for a non-Owner is nothing (fail closed).
function erpCallerCampuses_(caller) {
  if (erpIsOwner_(caller)) return ERP_CAMPUSES.slice();
  return String(caller.campusId || '').split(',').map(erpNorm_).map(function (c) { return c.replace(/\s/g, ''); })
    .filter(function (c, i, a) { return ERP_CAMPUSES.indexOf(c) !== -1 && a.indexOf(c) === i; });
}

// the caller's employee code: fallback callers carry it; an allowlisted teacher is looked up by game-teacher.gs (cached there)
function erpCodeOf_(caller) {
  if (caller.employeeCode) return erpNorm_(caller.employeeCode);
  try { return typeof tchCodeFor_ === 'function' ? erpNorm_(tchCodeFor_(caller)) : ''; } catch (err) { return ''; }
}

// Assignments rows (projected) -> the seeded ties [{owner, item, kind, class, label, section, subject, bus, teacher, fix, empCode, email}].
// owner: the row's employee code, else its email; '' = a fix row that ties nobody. item: the row's setup-quest item, built from the
// owner and the seeded values, so a Principal's edit to a row asks its teacher again.
function erpTieSlug_(s, n) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, n); }
function erpSeedTies_(assignRows) {
  return (assignRows || []).map(function (a) {
    const cls = erpNorm_(a.class), suffix = (cls.match(/ - ([A-Z0-9]+)$/) || [])[1] || ''; // "X - A" ties section A, not all of X
    const owner = erpNorm_(a.empCode) || String(a.email || '').trim().toLowerCase();
    const t = { owner: owner, empCode: erpNorm_(a.empCode), email: String(a.email || '').trim().toLowerCase(), kind: String(a.kind || '').trim().toLowerCase(),
      class: erpClassBase_(cls), label: String(a.class || '').trim(), section: erpNorm_(a.section) || suffix, subject: erpNorm_(a.subject), bus: erpBusKey_(a.bus),
      teacher: String(a.teacher || '').trim(), fix: String(a.fix || '').trim() };
    t.item = ('e_' + owner.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '-' + t.kind.charAt(0) + '-' + erpTieSlug_(t.class, 10) + '-' + erpTieSlug_(t.section, 4) + '-' + erpTieSlug_(t.subject, 12)).slice(0, 64);
    return t;
  }).filter(function (t) { return (t.kind === 'class' || t.kind === 'subject') ? !!t.class && (t.kind === 'class' || !!t.subject) : t.kind === 'bus' && !!t.bus; });
}
function erpTieIsMine_(caller, t) {
  const code = erpCodeOf_(caller), email = String(caller.email || '').trim().toLowerCase();
  return !!t.owner && ((code && t.empCode === code) || (email && t.email === email));
}

// the caller's own confirmations in the tie quest: { item: { field: { value, status } } }, or null when the engine isn't loaded
function erpConfirmedFor_(caller) {
  if (typeof cqRead_ !== 'function' || typeof cqStored_ !== 'function') return null;
  return cqStored_(cqRead_(), ERP_TIE_QUEST, 'self:' + String(caller.email || '').trim().toLowerCase()).byItem;
}

// one seeded tie + its confirmation -> { state: pending|confirmed|corrected|notmine, section } (section: the one confirmed)
function erpTieState_(t, c) {
  const ok = function (f) { return !!c && !!c[f] && c[f].status === 'confirmed'; };
  if (c && ((c.class && c.class.status === 'skipped') || (c.section && c.section.status === 'skipped'))) return { state: 'notmine', section: '' };
  if (!ok('class') || !ok('section')) return { state: 'pending', section: '' };
  const section = erpNorm_(c.section.value);
  if (erpClassBase_(c.class.value) !== t.class && erpNorm_(c.class.value) !== erpNorm_(t.label)) return { state: 'corrected', section: section, classChanged: true };
  return { state: section === t.section ? 'confirmed' : 'corrected', section: section };
}

// Assignments rows -> this caller's CONFIRMED ties [{kind, class, section, subject, bus}]: confirmed with a section and the seeded class
function erpTies_(caller, assignRows, confirmed) {
  if (!confirmed) return [];
  return erpSeedTies_(assignRows).filter(function (t) { return t.kind !== 'bus' && erpTieIsMine_(caller, t); }).map(function (t) {
    const st = erpTieState_(t, confirmed[t.item]);
    return (st.state === 'confirmed' || st.state === 'corrected') && !st.classChanged && st.section
      ? { kind: t.kind, class: t.class, section: st.section, subject: t.subject, bus: '' } : null;
  }).filter(Boolean);
}

// -> { <what>: true (whole campus) | { sections: [{class, section, subject}] } | { buses: [key] } } for one campus the caller holds.
// A what that is absent is not allowed. Several roles and ties union.
function erpAccess_(caller, campus, ties) {
  const roles = caller.roles || [], acc = {};
  if (erpCallerCampuses_(caller).indexOf(campus) === -1) return acc;
  const all = function (whats) { whats.forEach(function (w) { acc[w] = true; }); };
  if (roles.indexOf('Owner') !== -1 || roles.indexOf('Principal') !== -1) all(ERP_WHATS);
  if (roles.indexOf('FeeClerk') !== -1) all(['students', 'dues', 'bus']);
  // ties (the review of every teacher's confirmations) stays Owner/Principal only: add() below never grants it
  const add = function (w, key, item) {
    if (acc[w] === true) return;
    acc[w] = acc[w] || {};
    (acc[w][key] = acc[w][key] || []).push(item);
  };
  (ties || []).forEach(function (t) {
    if (t.kind === 'bus') { add('bus', 'buses', t.bus); return; }
    const sec = { class: t.class, section: t.section, subject: '' };
    add('students', 'sections', sec);
    add('attendance', 'sections', sec);
    add('marks', 'sections', t.kind === 'subject' ? { class: t.class, section: t.section, subject: t.subject } : sec);
  });
  return acc;
}

// a row's class/section (and subject, for marks) inside a sections grant; a tie with no section covers the whole class
// CSM writes a class with its section ("X - A", "M-I - B"); a tie names the class alone ("X") or with that suffix. ' - ' needs the
// spaces, so "M-I" itself is never cut.
function erpClassBase_(v) { return erpNorm_(v).replace(/ - [A-Z0-9]+$/, ''); }
function erpInSections_(grant, row, subject) {
  if (grant === true) return true;
  return (grant.sections || []).some(function (s) {
    return s.class === erpClassBase_(row.class) && (!s.section || s.section === erpNorm_(row.section)) && (!s.subject || subject === undefined || s.subject === erpNorm_(subject));
  });
}

// ── reading ──────────────────────────────────────────────────────────
function erpSheetId_(campus) { return String(PropertiesService.getScriptProperties().getProperty('ERP_SHEET_' + campus) || '').trim(); }

// -> { configured, missing: [tab], tabs: { Tab: projected rows } }; throws only on a real read failure (the action maps it)
function erpReadTabs_(campus, tabNames) {
  const id = erpSheetId_(campus), out = { configured: !!id, missing: [], tabs: {} };
  tabNames.forEach(function (t) { out.tabs[t] = []; });
  if (!id) return out;
  const book = SpreadsheetApp.openById(id);
  tabNames.forEach(function (t) {
    const sh = book.getSheetByName(ERP_SHEET_TAB[t]);
    if (!sh) { out.missing.push(ERP_SHEET_TAB[t]); return; }
    out.tabs[t] = erpProject_(sh.getDataRange().getValues(), ERP_TABS[t]);
  });
  return out;
}

function erpActive_(s) { const st = erpNorm_(s.status); return !st || st === 'ACTIVE'; }
function erpStudentKey_(s) { return [erpNorm_(s.class), erpNorm_(s.section), ('000000' + erpNum_(s.rollNo)).slice(-6), erpNorm_(s.name)].join('|'); }

// ── the shapes, pure: (access grant, projected tabs, filters) -> rows ──
// f = request filters, already normalized: {class, section, house, subject, exam, bus, from, to}
// a class filter "X" (a whole-class tie) finds "X - A" and "X - B"; "X - A" finds only that section
function erpMatchF_(row, f) {
  return (!f.class || erpNorm_(row.class) === f.class || erpClassBase_(row.class) === f.class) && (!f.section || erpNorm_(row.section) === f.section);
}

function erpStudents_(grant, tabs, f) {
  return tabs.Students.filter(function (s) { return erpActive_(s) && erpInSections_(grant, s) && erpMatchF_(s, f) && (!f.house || erpNorm_(s.house) === f.house); })
    .sort(function (a, b) { const x = erpStudentKey_(a), y = erpStudentKey_(b); return x < y ? -1 : x > y ? 1 : 0; })
    .map(function (s) { return { enrollNo: s.enrollNo, name: s.name, class: s.class, section: s.section, rollNo: s.rollNo, house: s.house }; });
}

// enrollNo -> active student, for the joins (a row whose student isn't active is never shown: its class can't be checked)
function erpByEnroll_(tabs) {
  const m = {};
  tabs.Students.forEach(function (s) { if (erpActive_(s) && s.enrollNo) m[erpNorm_(s.enrollNo)] = s; });
  return m;
}

function erpAttendance_(grant, tabs, f) {
  const by = erpByEnroll_(tabs), rows = [], summary = {};
  tabs.Attendance.forEach(function (a) {
    const s = by[erpNorm_(a.enrollNo)], day = a.date.slice(0, 10);
    if (!s || day < f.from || day > f.to || !erpInSections_(grant, s) || !erpMatchF_(s, f)) return;
    const st = erpNorm_(a.status).charAt(0);
    rows.push({ date: day, enrollNo: s.enrollNo, name: s.name, class: s.class, section: s.section, status: st });
    const d = summary[day] = summary[day] || { P: 0, A: 0, L: 0, H: 0, total: 0 };
    if (d.hasOwnProperty(st)) d[st]++;
    d.total++;
  });
  rows.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : erpStudentKey_(by[erpNorm_(a.enrollNo)]) < erpStudentKey_(by[erpNorm_(b.enrollNo)]) ? -1 : 1; });
  return { rows: rows, summary: summary };
}

function erpMarks_(grant, tabs, f) {
  const by = erpByEnroll_(tabs);
  return tabs.Marks.filter(function (m) {
    const s = by[erpNorm_(m.enrollNo)];
    return s && erpInSections_(grant, s, m.subject) && erpMatchF_(s, f) && (!f.subject || erpNorm_(m.subject) === f.subject) && (!f.exam || erpNorm_(m.exam) === f.exam);
  }).map(function (m) {
    const s = by[erpNorm_(m.enrollNo)];
    return { session: m.session, term: m.term, exam: m.exam, subject: m.subject, enrollNo: s.enrollNo, name: s.name, class: s.class, section: s.section, maxMarks: m.maxMarks, marks: m.marks };
  });
}

function erpDues_(grant, tabs, f) {
  const by = erpByEnroll_(tabs), per = {}, order = [];
  tabs.Dues.forEach(function (d) {
    const k = erpNorm_(d.enrollNo), s = by[k];
    if (!s || !erpInSections_(grant, s) || !erpMatchF_(s, f)) return;
    if (!per[k]) { per[k] = { enrollNo: s.enrollNo, name: s.name, class: s.class, section: s.section, receivable: 0, received: 0, concession: 0, pending: 0, heads: [] }; order.push(k); }
    const p = per[k], due = erpNum_(d.balance);
    p.receivable += erpNum_(d.receivable); p.received += erpNum_(d.received); p.concession += erpNum_(d.concession); p.pending += due;
    if (due > 0) p.heads.push({ feeHead: d.feeHead, pending: Math.round(due) });
  });
  const rows = order.map(function (k) { return per[k]; }).filter(function (p) { return p.pending > 0; })
    .sort(function (a, b) { return erpStudentKey_(by[erpNorm_(a.enrollNo)]) < erpStudentKey_(by[erpNorm_(b.enrollNo)]) ? -1 : 1; });
  const classes = {}, cOrder = [];
  let total = 0;
  rows.forEach(function (p) {
    ['receivable', 'received', 'concession', 'pending'].forEach(function (x) { p[x] = Math.round(p[x]); });
    total += p.pending;
    const ck = p.class + '|' + p.section;
    if (!classes[ck]) { classes[ck] = { class: p.class, section: p.section, count: 0, pending: 0 }; cOrder.push(ck); }
    classes[ck].count++; classes[ck].pending += p.pending;
  });
  return { rows: rows, totalPending: total, classes: cOrder.map(function (k) { return classes[k]; }) };
}

// buses: grant true = every bus, else {buses: [key]}; driver = true drops the enroll number
function erpBuses_(grant, tabs, f, driver) {
  const buses = {}, order = [];
  tabs.Students.forEach(function (b) {
    const key = erpBusKey_(b.bus), s = b;
    if (!key || !erpActive_(s) || (grant !== true && (grant.buses || []).indexOf(key) === -1) || (f.bus && key !== f.bus) || !erpMatchF_(s, f)) return;
    if (!buses[key]) { buses[key] = { bus: b.bus, route: '', students: [] }; order.push(key); }
    if (!buses[key].route && b.route) buses[key].route = b.route;
    const st = { enrollNo: s.enrollNo, name: s.name, class: s.class, section: s.section, pickupPoint: b.pickupPoint, way: b.way };
    if (driver) delete st.enrollNo;
    buses[key].students.push(st);
  });
  return order.sort().map(function (k) {
    buses[k].students.sort(function (a, b) { return a.pickupPoint < b.pickupPoint ? -1 : a.pickupPoint > b.pickupPoint ? 1 : a.name < b.name ? -1 : 1; });
    return buses[k];
  });
}

function erpStaff_(tabs) {
  return tabs.Staff.map(function (s) { return { empCode: s.empCode, name: s.name, designation: s.designation, department: s.department, status: s.status, house: s.house }; })
    .sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
}

// ── the actions ──────────────────────────────────────────────────────
function erpLog_(what, campus, n) { console.log('erpread ' + what + ' ' + campus + ' rows=' + n); } // counts only

// params -> normalized filters, or an error
function erpFilters_(p) {
  const f = { class: erpNorm_(p.class), section: erpNorm_(p.section), house: erpNorm_(p.house), subject: erpNorm_(p.subject), exam: erpNorm_(p.exam), bus: erpBusKey_(p.bus) };
  const today = erpIstDay_(new Date()), day = /^\d{4}-\d\d-\d\d$/;
  f.from = String(p.from || '').trim() || today;
  f.to = String(p.to || '').trim() || (p.from ? f.from : today);
  if (!day.test(f.from) || !day.test(f.to) || f.from > f.to) return { error: 'Dates must be YYYY-MM-DD, from on or before to.' };
  if ((Date.parse(f.to) - Date.parse(f.from)) / 86400000 + 1 > ERP_MAX_DAYS) return { error: 'Ask for at most ' + ERP_MAX_DAYS + ' days of attendance at a time.' };
  return f;
}

// a class/section/subject/bus filter outside a partial grant is a refusal, not a silent empty list
function erpFilterAllowed_(what, grant, f) {
  if (grant === true) return true;
  if (what === 'bus') return !f.bus || (grant.buses || []).indexOf(f.bus) !== -1;
  return (grant.sections || []).some(function (s) {
    return (!f.class || s.class === erpClassBase_(f.class)) && (!f.section || !s.section || s.section === f.section) && (!f.subject || !s.subject || s.subject === f.subject);
  });
}

// the campus Assignments are read only when a tie could add something the roles don't already give
function erpNeedsTies_(caller) { const r = caller.roles || []; return r.indexOf('Owner') === -1 && r.indexOf('Principal') === -1; }

function erpScope_(caller) {
  const campuses = [], ties = [];
  erpCallerCampuses_(caller).forEach(function (c) {
    let read = { configured: !!erpSheetId_(c), tabs: { Assignments: [] } }, mine = [];
    if (read.configured && erpNeedsTies_(caller)) { read = erpReadTabs_(c, ['Assignments']); mine = erpTies_(caller, read.tabs.Assignments, erpConfirmedFor_(caller)); }
    const acc = erpAccess_(caller, c, mine);
    campuses.push({ campus: c, configured: read.configured, can: ERP_WHATS.filter(function (w) { return acc[w]; }) });
    mine.forEach(function (t) { ties.push(Object.assign({ campus: c }, t)); });
  });
  erpLog_('scope', 'all', ties.length);
  return { success: true, what: 'scope', campuses: campuses, ties: ties };
}

function erpRead_(caller, params) {
  try {
    const p = params || {}, what = String(p.what || '').trim().toLowerCase();
    if (what === 'scope') return erpScope_(caller);
    if (ERP_WHATS.indexOf(what) === -1) return erpErr_('ERP_BAD_REQUEST', 'Unknown ERP read. Ask for scope, students, attendance, marks, dues, bus, staff or ties.');
    const mine = erpCallerCampuses_(caller);
    let campus = erpNorm_(p.campus).replace(/\s/g, '');
    if (!campus && !erpIsOwner_(caller) && mine.length === 1) campus = mine[0];
    if (ERP_CAMPUSES.indexOf(campus) === -1) return erpErr_('ERP_BAD_REQUEST', 'Pick a school (LMS 1 to LMS 6).');
    if (mine.indexOf(campus) === -1) return erpErr_('ERP_NOT_ALLOWED', ERP_DENY);
    const f = erpFilters_(p);
    if (f.error) return erpErr_('ERP_BAD_REQUEST', f.error);
    // roles alone first: a caller with no role grant and no Sheet yet is refused, never shown a "connected" empty list
    const needTies = erpNeedsTies_(caller) && !erpAccess_(caller, campus, [])[what];
    const read = erpReadTabs_(campus, ERP_NEEDS[what].concat(needTies ? ['Assignments'] : []));
    const grant = erpAccess_(caller, campus, needTies ? erpTies_(caller, read.tabs.Assignments, erpConfirmedFor_(caller)) : [])[what];
    if (!grant) {
      // an unconfigured Sheet can't hold ties yet: a teacher gets the empty state, not a refusal
      if (!read.configured && needTies && ['students', 'attendance', 'marks', 'bus'].indexOf(what) !== -1) return erpEmpty_(what, campus, read);
      return erpErr_('ERP_NOT_ALLOWED', ERP_DENY);
    }
    if (!erpFilterAllowed_(what, grant, f)) return erpErr_('ERP_NOT_ALLOWED', ERP_DENY);
    if (!read.configured) return erpEmpty_(what, campus, read);
    const out = { success: true, what: what, campus: campus, configured: true, missing: read.missing.filter(function (t) { return t !== ERP_SHEET_TAB.Assignments; }) };
    if (what === 'students') out.rows = erpStudents_(grant, read.tabs, f);
    else if (what === 'attendance') { const a = erpAttendance_(grant, read.tabs, f); out.rows = a.rows; out.summary = a.summary; out.from = f.from; out.to = f.to; }
    else if (what === 'marks') out.rows = erpMarks_(grant, read.tabs, f);
    else if (what === 'dues') { const d = erpDues_(grant, read.tabs, f); out.rows = d.rows; out.totalPending = d.totalPending; out.classes = d.classes; }
    else if (what === 'bus') out.rows = erpBuses_(grant, read.tabs, f, false);
    else if (what === 'ties') { const r = erpTiesReview_(read.tabs.Assignments); out.rows = r.rows; out.summary = r.summary; }
    else out.rows = erpStaff_(read.tabs);
    out.count = out.rows.length;
    erpLog_(what, campus, out.count);
    return out;
  } catch (err) {
    console.error('erpread failed: ERP_READ_FAILED'); // no message: it could carry a Sheet id
    return erpErr_('ERP_READ_FAILED', "The school's ERP data couldn't be read just now. Try again in a minute.");
  }
}

// what=ties (Owner/Principal; a supporting Principal reads the same, nothing here writes): every seeded row with its teacher's state.
// Staff names only, never a student. -> { rows: [{teacher, empCode, kind, class, subject, seededSection, section, state, fix}], summary }
function erpTiesReview_(assignRows) {
  const byItem = {};
  if (typeof cqRead_ === 'function') cqRead_().forEach(function (r) {
    if (r.quest !== ERP_TIE_QUEST || !/^self:/.test(r.scope)) return;
    (byItem[r.item] = byItem[r.item] || {})[r.field] = { value: r.value, status: r.status }; // append order: the latest row wins
  });
  const summary = { pending: 0, confirmed: 0, corrected: 0, notmine: 0, fix: 0 };
  const rows = erpSeedTies_(assignRows).filter(function (t) { return t.kind !== 'bus'; }).map(function (t) {
    const st = t.owner ? erpTieState_(t, byItem[t.item]) : { state: 'fix', section: '' };
    summary[st.state]++;
    return { teacher: t.teacher, empCode: t.empCode, kind: t.kind, class: t.label, subject: t.subject, seededSection: t.section, section: st.section,
      classCorrected: !!st.classChanged, state: st.state, fix: t.owner ? '' : t.fix };
  });
  return { rows: rows, summary: summary };
}

// 'erp.myTies' pre-fill (game-confirm.gs engine): the caller's seeded ties as quest items { class, section, subject }.
// opts.cacheOnly (Buddy/status paths): the per-campus rows from the script cache only, null when not cached.
// ponytail: 10-minute cache per campus; a Principal's edit to the Sheet shows in the quest within 10 minutes.
function erpAssignCached_(campus, cacheOnly) {
  const cache = CacheService.getScriptCache(), key = 'erp_asg_' + campus, hit = cache.get(key);
  if (hit) { try { return JSON.parse(hit); } catch (err) { /* read again */ } }
  if (cacheOnly) return null;
  const rows = erpReadTabs_(campus, ['Assignments']).tabs.Assignments;
  try { cache.put(key, JSON.stringify(rows), 600); } catch (err) { /* too big to cache: read each time */ }
  return rows;
}
function erpPrefillMyTies_(ctx, opts) {
  const caller = ctx && ctx.caller, out = [];
  if (!caller) return [];
  const campuses = erpCallerCampuses_(caller);
  for (let i = 0; i < campuses.length; i++) {
    const rows = erpAssignCached_(campuses[i], !!(opts && opts.cacheOnly));
    if (rows === null) return null;
    erpSeedTies_(rows).forEach(function (t) {
      if (t.kind === 'bus' || !erpTieIsMine_(caller, t)) return;
      out.push({ item: t.item, fields: { class: t.label, section: t.section, subject: t.kind === 'subject' ? t.subject : 'Class teacher' } });
    });
  }
  return out;
}

function erpEmpty_(what, campus, read) {
  const out = { success: true, what: what, campus: campus, configured: false, missing: [], count: 0, rows: [], note: 'ERP data for ' + erpCampusLabel_(campus) + " isn't connected yet." };
  if (what === 'dues') { out.totalPending = 0; out.classes = []; }
  if (what === 'attendance') out.summary = {};
  erpLog_(what, campus, 0);
  return out;
}

// POST, caller-less: a linked driver phone's device token (driver-token.gs dlkLink_) -> its own bus's list, names only
function erpDriverBus_(body) {
  try {
    if (typeof dlkLink_ !== 'function') return erpErr_('ERP_DRIVER_UNAVAILABLE', "The bus list isn't available on this phone yet.");
    const link = dlkLink_(body && body.deviceToken);
    if (!link) return erpErr_('ERP_DRIVER_UNLINKED', 'This phone is not linked. Ask the office for a new link.');
    const campus = erpNorm_(link.campus).replace(/\s/g, ''), key = erpBusKey_(link.reg);
    if (ERP_CAMPUSES.indexOf(campus) === -1 || !key) return erpErr_('ERP_DRIVER_UNLINKED', 'This phone is not linked. Ask the office for a new link.');
    const read = erpReadTabs_(campus, ERP_NEEDS.bus);
    const bus = read.configured ? erpBuses_({ buses: [key] }, read.tabs, { bus: key }, true)[0] : null;
    const students = bus ? bus.students : [];
    erpLog_('driverbus', campus, students.length);
    const out = { success: true, bus: link.reg, campus: campus, configured: read.configured, count: students.length, students: students };
    if (!read.configured) out.note = 'ERP data for ' + erpCampusLabel_(campus) + " isn't connected yet.";
    return out;
  } catch (err) {
    console.error('erpdriverbus failed: ERP_READ_FAILED');
    return erpErr_('ERP_READ_FAILED', "The bus list couldn't be read just now. Try again in a minute.");
  }
}

// ── registration (this file's own functions only) ────────────────────
GAME_MODULE_ACTIONS.erpread = erpRead_;
CQ_PREFILL['erp.myTies'] = erpPrefillMyTies_;
// the teacher's confirm quest (game-confirm.gs engine): each seeded tie, Confirm, change the section, or Not my class
CQ_MODULE_DEFS[ERP_TIE_QUEST] = {
  title: 'Confirm your classes and sections', task: 'Confirm your classes and sections',
  intro: 'These come from the timetable. Check the section of each class and confirm it, change the section if it is wrong, or tap Not my class. You see your students once you confirm.',
  roles: ['Teacher'], scope: 'self', selfOnly: true, prefill: 'erp.myTies', addable: false, skipLabel: 'Not my class', itemTitle: '{class} {section} · {subject}',
  fields: [{ id: 'class', label: 'Class', type: 'text', required: true },
    { id: 'section', label: 'Section', type: 'text', required: true, hint: 'A, B or C: the section you teach' },
    { id: 'subject', label: 'Subject', type: 'text', required: false }],
  sample: [{ item: 's1', fields: { class: 'VII', section: 'A', subject: 'Class teacher' } }, { item: 's2', fields: { class: 'VIII', section: 'B', subject: 'MATHS' } }],
  active: true,
};
