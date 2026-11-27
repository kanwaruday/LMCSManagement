/* LMCS Portal -- "data source" links for pages that don't draw their own (2026-10-21, per Uday).
   Same look and rule as the strips already on the curriculum / hiring / staff / Principal DR pages:
   a small grey "📄 <name> sheet ↗" row of links to the Google Sheets (and calendars) the page reads,
   shown to the Owner and Coordinators (LMCS.canViewDataSources). Loaded by assets/auth.js, which every page already includes, so a page
   needs no script tag of its own. A page that already has a .datasrc-links row is left alone.

   Adding a page: add one line to PAGES below. tests/datasrc/test-datasrc.js fails if a page in the
   repo has neither its own strip, an entry here, nor a place in NO_SOURCES. */
(function () {
  if (typeof window === 'undefined' || !window.LMCS) return;

  // The links themselves (sheet and calendar ids) are NOT here: this file is public. They live in apps-script/principal-allowlist.gs
  // (DATASRC_LINKS_) and arrive through LMCS.datasrcLinks() for a verified Owner/Coordinator. Below: which keys each page shows.

  // Everything the Coordinator's follow-up tasks are built from (SS compliance, hiring stalls, documents, approvals).
  const FOLLOWUP_SOURCES = ['approvals', 'teacherss', 'nonteaching', 'driver', 'hiring', 'staff', 'docs'];

  // folder path -> source keys. Order is the order shown.
  const PAGES = {
    '/principal/':               ['allowlist'],
    '/principal/issues.html':    ['dailyreports'],   // the PDR Issues tabs live in the Daily Reports sheet
    '/principal/scout.html':     ['dailyreports'],   // Scout report: Daily Reports + the PDR Issues/Repeats/Tags tabs, through the game backend (gamescout)
    '/principal/support-sessions.html': ['teacherss', 'nonteaching', 'driver', 'staff'], // teacherss covers the new unified "SS Submissions"/"SS Rubrics" tabs too -- same workbook as the old Teacher/IT/PTI/Clerk SS tabs
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
    '/coordinator/transport/rollcall.html': ['transport'], // daily duty roll call: the Duty Roll Call tab of the same workbook
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
    window.LMCS.datasrcLinks().then(function (L) {
      const keys = PAGES[key].filter(function (k) { return L[k]; });
      if (!keys.length || document.getElementById('lmcs-datasrc')) return;
      const el = document.createElement('div');
      el.id = 'lmcs-datasrc';
      el.innerHTML = '📄 ' + keys.map(function (k) {
        return '<a href="' + L[k][1] + '" target="_blank" rel="noopener">' + L[k][0] + ' ↗</a>';
      }).join('');

      const home = document.getElementById('app-root'); // the two home screens keep their content in a centred wrapper
      if (home) { el.className = 'inset'; home.insertBefore(el, home.firstChild); return; }
      const hdr = document.querySelector('.hdr, header.site');
      if (hdr && hdr.parentNode) hdr.parentNode.insertBefore(el, hdr.nextSibling);
      else document.body.insertBefore(el, document.body.firstChild);
    });
  }

  window.LMCS_renderDataSources = render; // auth.js calls this right after a sign-in that doesn't reload the page
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render); else render();

  // exposed for tests/datasrc/test-datasrc.js
  window.LMCS_DATASRC = { PAGES: PAGES };
})();
