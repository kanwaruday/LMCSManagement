/* LMCS Portal -- "data source" links for pages that don't draw their own (2026-10-21, per Uday).
   Same look and rule as the strips already on the curriculum / hiring / staff / Principal DR pages:
   a small grey "📄 <name> sheet ↗" row of links to the Google Sheets (and calendars) the page reads,
   shown to the Owner and Coordinators (LMCS.canViewDataSources). Loaded by assets/auth.js, which every page already includes, so a page
   needs no script tag of its own. A page that already has a .datasrc-links row is left alone.

   Adding a page: add one line to PAGES below. tests/datasrc/test-datasrc.js fails if a page in the
   repo has neither its own strip, an entry here, nor a place in NO_SOURCES. */
(function () {
  if (typeof window === 'undefined' || !window.LMCS) return;

  const sheet = function (id, gid) { return 'https://docs.google.com/spreadsheets/d/' + id + '/edit' + (gid ? '#gid=' + gid : ''); };
  const cal = function (id) { return 'https://calendar.google.com/calendar/u/0/r?cid=' + encodeURIComponent(id); };

  // key -> [label, url]. IDs are the ones the backend (apps-script/*.gs) reads.
  const SRC = {
    approvals:   ['Approvals sheet',                sheet('1Tr4Rfc6DN698eeGVjuCoXfSRR-NhBTWJibR00Ibj6P4')],
    allowlist:   ['Access list sheet',              sheet('1NZu0ElismFytG395Nxjz29vAz7OfkmJtZhs70bOwT58')],
    staff:       ['LMCSStaffMasters sheet',         sheet('1OjVMUvpLM8JkdAwjmljCtZUI1VUqGLbic36cW9dm0C0')],
    hiring:      ['Teaching Applicants sheet',      sheet('1aSCQ3IGO-ZP_5yRjtnMpZdlauTdWj3814ATD9qwskPQ', '1181288827')],
    docs:        ['Doc Submission sheet',           sheet('1PJ2acPOHopbHzzwGes8X4YPWSDBdXnd0zl46zvFCvIg')],
    teacherss:   ['Teacher SS responses sheet',     sheet('1cP-f8ShSJJPMBXkQCfkSvmajPA1db6fMBOPCbLH3oIc')],
    nonteaching: ['Non-Teaching SS responses sheet', sheet('1PHNLl_rdBVzjzpBs0oWFsvYxBDVq7_1i6TRQhwY45ac')],
    driver:      ['Driver SS responses sheet',      sheet('1rFQH0Xcrhq1i2oNvLgpvrixXZNsr-rlntDXOGQ3J6ME')],
    dailyreports:['Daily Reports sheet',            sheet('1GzGdakmjjkou0GGgljY6ugXvOM21MLkyeyc85Ke3i1Y')],
    fees:        ['Fee Defaulter Emails sheet',     sheet('1za2G5vEOcR0fOpNr8oPF-RNJtYnYVSCkCSTYnpV_ok4')],
    payscale:    ['Salary PayScale sheet',          sheet('1d8MdOgXNM5KVJjLwejAKpbbDaINnvPZO6zX_E5xABYU')],
    payroll:     ['Payroll sheet',                  sheet('1sal-zeXPZazN2ASqF7CchfJo-tF9_-Q80zcZtXbNwY8')],
    transport:   ['Transport responses sheet',      sheet('1VXTMZjqCS82ftB1rwoN4BzoiOTP7-Vg0m5vTH01Tfzc', '1365845375')],
    daily:       ['Daily/CW sheet',                 sheet('1z5hzpMRHMru6ulpYs2lsGZr7quAywwpQ_zySa3rvGUA')],
    // Teacher Portal's Upcoming Events read each school's official calendar (LMS 2 and 3 share one).
    cal1: ['LMS 1 calendar',   cal('c_88402c40e6c9a435cbed4810bfae632d781ac9e7ca167b5435e4a9586bda7595@group.calendar.google.com')],
    cal2: ['LMS 2/3 calendar', cal('c_25n5qbggh7u9s5o6vq31iho4vc@group.calendar.google.com')],
    cal4: ['LMS 4 calendar',   cal('lms.org.in_snflpd3f357jv8l380s8sc4ju0@group.calendar.google.com')],
    cal5: ['LMS 5 calendar',   cal('c_d367ca2cb9bbab4f6a5b6864d6e03c28fbfccf02b5212621e89daf2f9f3f8523@group.calendar.google.com')],
    cal6: ['LMS 6 calendar',   cal('c_3db6cb2edb78d889cf166771c426f0fe3ba78b04cf9ca8e566329c888d023635@group.calendar.google.com')],
    timetable:   ['Timetable data', 'https://github.com/kanwaruday/LMCSManagement/blob/main/teacher/data/timetable.json'],
  };

  // Everything the Coordinator's follow-up tasks are built from (SS compliance, hiring stalls, documents, approvals).
  const FOLLOWUP_SOURCES = ['approvals', 'teacherss', 'nonteaching', 'driver', 'hiring', 'staff', 'docs'];

  // folder path -> source keys. Order is the order shown.
  const PAGES = {
    '/principal/':               ['allowlist'],
    '/principal/issues.html':    ['dailyreports'],   // the PDR Issues tabs live in the Daily Reports sheet
    '/teacher/':                 ['teacherss', 'staff', 'approvals', 'daily', 'cal1', 'cal2', 'cal4', 'cal5', 'cal6', 'timetable'],
    '/salary/':                  ['payscale', 'hiring', 'approvals', 'payroll', 'staff'],
    '/payroll/':                 ['payroll', 'payscale', 'staff', 'approvals', 'hiring'],
    '/coordinator/':             FOLLOWUP_SOURCES,
    '/coordinator/followups/':   FOLLOWUP_SOURCES,
    '/coordinator/hq.html':      FOLLOWUP_SOURCES,  // the board is the follow-ups; recommendations live in the Approvals sheet
    '/coordinator/hr/':          ['hiring', 'staff', 'docs', 'teacherss', 'nonteaching', 'driver', 'approvals'],
    '/coordinator/academics/':   ['daily', 'staff'],
    '/coordinator/finance/':     ['approvals'],
    '/coordinator/operations/':  ['approvals'],
    '/coordinator/events/':      ['approvals'],
    '/coordinator/transport/':   ['transport'],
    '/coordinator/transport/setup.html': ['transport'], // Fleet setup quests: the Fleet Profile, Driver Profile, Parts History and Workshops tabs of the same workbook
    '/coordinator/documents/':   ['docs', 'staff'],
    '/coordinator/systems/':     ['dailyreports', 'fees', 'allowlist'],
  };

  function pageKey() {
    const path = String(location.pathname).replace(/index\.html$/, '');
    const keys = Object.keys(PAGES);
    for (let i = 0; i < keys.length; i++) if (path.length >= keys[i].length && path.slice(-keys[i].length) === keys[i]) return keys[i];
    return null;
  }

  function render() {
    const old = document.getElementById('lmcs-datasrc');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    const session = window.LMCS.getSession();
    if (!session || !window.LMCS.canViewDataSources(session)) return;
    if (document.querySelector('.datasrc-links')) return; // the page draws its own
    const key = pageKey();
    if (!key) return;

    if (!document.getElementById('lmcs-datasrc-css')) {
      const st = document.createElement('style');
      st.id = 'lmcs-datasrc-css';
      st.textContent = '#lmcs-datasrc{display:flex;flex-wrap:wrap;gap:2px 14px;font-size:10.5px;line-height:1.6;color:#8A96A6;padding:8px 24px 0}' +
        '#lmcs-datasrc.inset{padding:8px 0 0}#lmcs-datasrc a{color:#8A96A6;text-decoration:underline}#lmcs-datasrc a:hover{color:#CE0000}';
      document.head.appendChild(st);
    }
    const el = document.createElement('div');
    el.id = 'lmcs-datasrc';
    el.innerHTML = '📄 ' + PAGES[key].map(function (k) {
      return '<a href="' + SRC[k][1] + '" target="_blank" rel="noopener">' + SRC[k][0] + ' ↗</a>';
    }).join('');

    const home = document.getElementById('app-root'); // the two home screens keep their content in a centred wrapper
    if (home) { el.className = 'inset'; home.insertBefore(el, home.firstChild); return; }
    const hdr = document.querySelector('.hdr, header.site');
    if (hdr && hdr.parentNode) hdr.parentNode.insertBefore(el, hdr.nextSibling);
    else document.body.insertBefore(el, document.body.firstChild);
  }

  window.LMCS_renderDataSources = render; // auth.js calls this right after a sign-in that doesn't reload the page
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render); else render();

  // exposed for tests/datasrc/test-datasrc.js
  window.LMCS_DATASRC = { SRC: SRC, PAGES: PAGES };
})();
