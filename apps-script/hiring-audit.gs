// ═══════════════════════════════════════════════════════════════════
// hiring-audit.gs -- 2026-10-13, per Uday: "run a check allowing me to map
// the options on the Interview Report Google form, the approvals and any
// other place there could be a mismatch."
//
// NOT web-exposed. Run by hand from the Apps Script editor (function
// dropdown -> hirMappingAudit -> Run). It READS every list the hiring flow
// depends on, and writes one new tab, "Mapping Audit", into the Teaching
// Applicants workbook (cleared and rewritten each run -- nothing else is
// touched). Same Apps Script project as hiring.gs / approvals.gs /
// salary.gs (it calls their helpers), so paste it in as its own file.
// ═══════════════════════════════════════════════════════════════════

// The Interview Report form (edit id from Uday). Its public form can't
// be read without sign-in, but FormApp can, running as Uday.
const HIRA_IR_FORM_ID = '1SV_21tBKgPwjX0yyUN-5_dxPQRuF7wJuN9HBW-lnVZc';
// Role codes the Approvals "Role Level" dropdown offers (principals-daily-reporting/index.html, #aprHiringRoleLevel).
const HIRA_ROLE_CODES = ['NTT', 'PRT', 'TGT', 'PGT', 'COMPUTER', 'PTI', 'PTISR', 'ACTIVITY', 'DRAWING', 'LIBRARIAN', 'DRIVER', 'HELPER', 'SWEEPER', 'TECHNICIAN', 'GARDENER', 'CLERK'];

function hirMappingAudit() {
  const out = []; // each entry: array of cells
  const sec = function (t) { out.push([]); out.push([t]); };
  const row = function () { out.push(Array.prototype.slice.call(arguments)); };
  const count = function (list) { const m = {}; list.forEach(function (v) { v = String(v).trim(); if (v) m[v] = (m[v] || 0) + 1; }); return m; };
  const subj = function (v) { const k = hirCanonicalSubjectKey_(v); return HIR_SUBJECT_LOOKUP_[hirNormalizeSubjectPhrase_(v)] ? 'ok -> ' + k : 'UNKNOWN (passes through as "' + k + '")'; };

  // ── 1. The Google Forms themselves ──────────────────────────────
  sec('1. GOOGLE FORM OPTIONS (what people can pick)  |  form / question / option / how hiring.gs reads it');
  const wb = hirWorkbook_();
  const forms = [['Interview Report form', function () { return FormApp.openById(HIRA_IR_FORM_ID); }]];
  [[HIR_SHEET_GID, 'Teaching Applicants form'], [HIR_IR_SHEET_GID, 'Interview Report form (linked to its tab)']].forEach(function (p) {
    forms.push([p[1], function () {
      const sh = wb.getSheets().find(function (s) { return s.getSheetId() === p[0]; });
      const url = sh && sh.getFormUrl();
      if (!url) throw new Error('no form linked to this tab');
      return FormApp.openByUrl(url);
    }]);
  });
  forms.forEach(function (f) {
    try {
      const form = f[1]();
      form.getItems().forEach(function (it) {
        const t = it.getType();
        let choices = null;
        if (t === FormApp.ItemType.LIST) choices = it.asListItem().getChoices();
        else if (t === FormApp.ItemType.MULTIPLE_CHOICE) choices = it.asMultipleChoiceItem().getChoices();
        else if (t === FormApp.ItemType.CHECKBOX) choices = it.asCheckboxItem().getChoices();
        if (!choices) { row(f[0], it.getTitle(), '(free text / other type)', ''); return; }
        const isSubject = /subject|role|position/i.test(it.getTitle());
        choices.forEach(function (c) { row(f[0], it.getTitle(), c.getValue(), isSubject ? subj(c.getValue()) : ''); });
      });
    } catch (e) { row(f[0], 'COULD NOT READ', String(e.message || e), ''); }
  });

  // ── 2. What is actually in the sheets ───────────────────────────
  sec('2. VALUES ACTUALLY IN THE SHEETS  |  sheet / column / value / times used / how hiring.gs reads it');
  const ta = hirSheet_().getDataRange().getValues().slice(1).filter(function (r) { return r[HIR_COL.NAME - 1]; });
  const ir = hirIrSheet_().getDataRange().getValues().slice(1).filter(function (r) { return r[HIR_IR_COL.NAME]; });
  const split = function (v) { return String(v || '').split(/,|&|\band\b/i).map(function (s) { return s.trim(); }).filter(Boolean); };
  const dump = function (sheet, col, list, how) {
    const m = count(list);
    Object.keys(m).sort(function (a, b) { return m[b] - m[a]; }).forEach(function (v) { row(sheet, col, v, m[v], how ? how(v) : ''); });
  };
  dump('Interview Reports', 'Subject', [].concat.apply([], ir.map(function (r) { return split(r[HIR_IR_COL.SUBJECT]); })), subj);
  dump('Interview Reports', 'Branch', ir.map(function (r) { return r[HIR_IR_COL.BRANCH]; }), function (v) { return /^LMS\s*[1-6]$/i.test(v) ? 'ok' : 'NOT a plain "LMS n" -- campus tag will not match'; });
  dump('Teaching Applicants', 'Subjects', [].concat.apply([], ta.map(function (r) { return split(r[HIR_COL.SUBJECTS - 1]); })), subj);
  dump('Teaching Applicants', 'Branches', [].concat.apply([], ta.map(function (r) { return String(r[HIR_COL.BRANCHES - 1] || '').split(/,/).map(function (s) { return s.trim(); }); })), function (v) { return /LMS-\d/.test(v) ? 'ok' : 'no "LMS-n" tag found'; });
  dump('Teaching Applicants', 'Qualification', ta.map(function (r) { return r[HIR_COL.QUALIFICATION - 1]; }), function (v) { return hirQualificationScore_(v, 'TGT').score + ' pts for TGT (masters-preferred)'; });
  dump('Teaching Applicants', 'B.Ed / TET', ta.map(function (r) { return r[HIR_COL.BED - 1]; }), function (v) { return hirBedScore_(v).score + ' pts -- ' + hirBedScore_(v).remark; });

  // ── 3. Approvals ────────────────────────────────────────────────
  sec('3. APPROVALS SHEET  |  category / campus / item / status  and how hiring.gs parses it');
  const apr = aprValues_().slice(1);
  dump('Approvals', 'Category (col C)', apr.map(function (r) { return r[2]; }), function (v) {
    return ['New/ Backup Position', 'Salary Offer Approval'].indexOf(v) !== -1 ? 'used by hiring.gs' : '(not used by hiring)';
  });
  dump('Approvals', 'Campus (col B)', apr.filter(function (r) { return r[2] === 'New/ Backup Position' || r[2] === 'Salary Offer Approval'; }).map(function (r) { return r[1]; }),
    function (v) { return HIR_SCHOOL_PREFIX[v] || v === 'ALL' ? 'ok' : 'NOT a known campus id'; });
  apr.filter(function (r) { return r[2] === 'New/ Backup Position'; }).forEach(function (r) {
    const p = hirParseRequisitionItem_(r[7]);
    const subs = split(p.subjectsRaw);
    const bad = subs.filter(function (s) { return !HIR_SUBJECT_LOOKUP_[hirNormalizeSubjectPhrase_(s)]; });
    row('Approvals requisition', r[1] + ' / ' + r[13], String(r[7]), p.roleLevel ? 'role ' + p.roleLevel + ' | subjects: ' + (p.subjectsRaw || '(none = matches EVERYONE)') : 'ROLE NOT RECOGNISED -- whole text treated as a subject',
      bad.length ? 'unknown subject(s): ' + bad.join(', ') : '');
  });

  // ── 4. Role codes across systems ────────────────────────────────
  sec('4. ROLE LEVELS ACROSS SYSTEMS  |  role code / in Approvals dropdown / hiring qualification rule / PayScale Role Code / PayScale designation');
  let pay = [];
  try { pay = salPayScale_(); } catch (e) { row('PayScale', 'COULD NOT READ', String(e.message || e)); }
  HIRA_ROLE_CODES.forEach(function (c) {
    const hit = pay.filter(function (p) { return p.roleCode === c; });
    row(c, 'yes', HIR_QUALIFICATION_EXPECTATION[c] ? 'yes' : 'MISSING', hit.length ? 'yes' : 'no row with this code', hit.map(function (p) { return p.designation; }).join(' | '));
  });
  pay.filter(function (p) { return HIRA_ROLE_CODES.indexOf(p.roleCode) === -1; }).forEach(function (p) {
    row(p.roleCode || '(blank)', 'NOT in Approvals dropdown', '', 'in PayScale only', p.designation);
  });
  // Staff roster designations
  try {
    const rv = SpreadsheetApp.openById(HIR_ROSTER_SHEET_ID).getSheetByName('EmpMaster').getDataRange().getValues();
    const di = rv[0].map(function (h) { return String(h).toLowerCase(); }).findIndex(function (h) { return /designation|job\s*role|role/.test(h); });
    if (di === -1) row('EmpMaster', 'no Designation/Role column found'); else dump('Staff roster EmpMaster', rv[0][di], rv.slice(1).map(function (r) { return r[di]; }));
  } catch (e) { row('EmpMaster', 'COULD NOT READ', String(e.message || e)); }

  // ── 5. Document Submission sheets: job role / branch typed there ─
  sec('5. DOCUMENT SUBMISSION SHEETS  |  campus / column / value / times');
  Object.keys(HIR_DOC_SHEET_IDS).forEach(function (c) {
    try {
      const v = SpreadsheetApp.openById(HIR_DOC_SHEET_IDS[c]).getSheets()[0].getDataRange().getValues();
      v[0].forEach(function (h, j) { if (/job\s*role|designation|position/i.test(String(h))) dump(c, String(h), v.slice(1).map(function (r) { return r[j]; })); });
    } catch (e) { row(c, 'COULD NOT READ', String(e.message || e)); }
  });

  // ── 6. THE ONE THAT MATTERS: who can the dashboard actually see? ─
  sec('6. EVERY INTERVIEW REPORT vs THE DASHBOARD  |  name / phone / IR branch / IR subject / result / why');
  const reqs = hirApprovedRequisitions_('New/ Backup Position');
  const taByPhone = {};
  ta.forEach(function (r) { const p = hirNormalizePhone_(r[HIR_COL.PHONE - 1]); if (p) taByPhone[p] = r; });
  ir.forEach(function (r) {
    const name = String(r[HIR_IR_COL.NAME]).trim(), phone = hirNormalizePhone_(r[HIR_IR_COL.PHONE]);
    const brRaw = String(r[HIR_IR_COL.BRANCH] || '').trim(), irSub = String(r[HIR_IR_COL.SUBJECT] || '').trim();
    const t = taByPhone[phone];
    const campus = 'LMS' + (brRaw.match(/\d/) || [''])[0];
    const branches = t ? String(t[HIR_COL.BRANCHES - 1]) : brRaw.replace(/^LMS\s*(\d)/i, 'LMS-$1');
    const subjects = t ? String(t[HIR_COL.SUBJECTS - 1]) : irSub;
    let result = 'VISIBLE', why = '';
    if (!phone || phone.length !== 10) { result = 'NOT VISIBLE'; why = 'phone "' + r[HIR_IR_COL.PHONE] + '" is not a clean 10-digit number -> never matched'; }
    else if (!t) { result = 'NOT VISIBLE'; why = 'no Teaching Applicants row with this phone (auto-backfill skips it if the NAME already exists under another phone)'; }
    else {
      const cs = Object.keys(reqs).filter(function (c) { return branches.indexOf('LMS-' + c.replace(/[^0-9]/g, '')) !== -1; });
      if (!cs.length) { result = 'NOT VISIBLE'; why = 'no APPROVED requisition at any campus this person applied to (' + branches + ')'; }
      else if (!cs.some(function (c) { return reqs[c].some(function (q) { return hirSubjectsMatch_(q.subjects, subjects); }); })) {
        result = 'NOT VISIBLE';
        why = 'subjects "' + subjects + '" match none of the approved requisitions: ' + cs.map(function (c) { return c + ' [' + reqs[c].map(function (q) { return q.roleLevel + (q.subjects ? ': ' + q.subjects : ''); }).join(' ; ') + ']'; }).join(' / ');
      }
    }
    row(name, phone, brRaw, irSub, result, why);
  });

  // ── write the tab ───────────────────────────────────────────────
  let tab = wb.getSheetByName('Mapping Audit');
  if (!tab) tab = wb.insertSheet('Mapping Audit'); else tab.clear();
  const width = out.reduce(function (m, r) { return Math.max(m, r.length); }, 1);
  tab.getRange(1, 1, out.length, width).setValues(out.map(function (r) { const x = r.slice(); while (x.length < width) x.push(''); return x; }));
  tab.getRange(1, 1, out.length, 1).setFontWeight('bold');
  Logger.log('Mapping Audit written: ' + out.length + ' rows -> open the "Mapping Audit" tab of the Teaching Applicants workbook.');
}
