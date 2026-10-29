var GAME_MODULE_ACTIONS = GAME_MODULE_ACTIONS || {};
var GAME_MODULE_MISSIONS = GAME_MODULE_MISSIONS || {};
var GAME_MODULE_QUESTS = GAME_MODULE_QUESTS || {};

// ═══════════════════════════════════════════════════════════════════
// LMCS Game Backend -- standalone forms into gameplay, batch 1 (docs/forms-inventory.md, owner rule 29 Oct 2026: "ensure that each
// form in the game is integrated in the game play"). Each form below becomes a mission row on the task drawer's Town, Wilderness
// or Daily tab (`panel`, read by assets/game/home-hud.js; no panel = Town), linking to the form's existing page:
//   Fee Clerk     Daily   desk_report (O8), desk_deposit + desk_erp (O7, yesterday's fee cash), older deposits
//                 Town    desk_handover (O4, cash another school handed over), desk_hire_book / desk_hire_demo / desk_hire_report (O11, O12)
//                 Wild    desk_fill (O10, a driver's fuel fill to confirm or reject)
//   Finance Head  Daily   desk_close (O9, seal yesterday), older days to close, desk_sign (deposits to sign)
//   Principal, Teacher, Staff   Town   request_wait (P5, T1: the person's own request while Management decides it)
// Reward (the inventory's vocabulary): the Daily routine rows are `core`, so finishing them counts toward days on track (the ✓ claim);
// every row shows ✓ once its record is done. Each `done` comes from the source record, never a tick.
// One source of truth: every row is read from the backend that owns the form, as the caller (their idToken), so that backend applies
// its own role and campus scope: the Office's today.summary (office-today.gs: today.get's own providers plus yesterday's recon, flags
// only, no amounts), the PDR's hiringapplicants (the hiring legwork rules), the Roster's driverfilllist, and the Approvals tab (the
// caller's own rows only). Successes are cached per caller for GAME_FETCH_CACHE_S (gameFetchJson_), so a finished form shows as done
// within that time. The Office summary feeds the core rows, so its failure THROWS (the framework marks the day down instead of
// snapshotting a short list); the other sources are extra rows, so a failure there drops only their rows (logged), like game-office.gs's
// approve missions. The core rows are day-scoped (id ends ':<game day>'), so one left undone counts as missed, as pdr_report does.
// The Owner gets none of these (their view is the Kingdom); a Principal never sees money.
// Only this file's own functions are used at top level (load order: tests/apps-script/test-load-order.js).
// ═══════════════════════════════════════════════════════════════════

// = projects.json "roster" deploymentId (driver-fill-confirm.gs); Script Property ROSTER_BACKEND_URL overrides it (a redeploy under a new URL)
var FORMS_ROSTER_URL = 'https://script.google.com/macros/s/AKfycbyHiaZY_iWK2VTKKFJcCsBNnIbUndJYUSjnPkxvJ-dYavaihiul2xBJuJohPRsP9Spf/exec';
// the Office Today task's `action` -> the page that holds its form
var FORMS_DESK_PAGES = { report: 'office/report.html', deposits: 'office/deposits.html', close: 'office/close.html' };
var FORMS_CORE = ['desk_report', 'desk_deposit', 'desk_erp', 'desk_close']; // the daily routine: counted toward days on track (the ✓ claim)
var FORMS_REQUEST_GO = { Principal: 'principals-daily-reporting/index.html#approvals', Teacher: 'teacher/index.html#panel-requests', Staff: 'teacher/index.html#panel-requests' };
var FORMS_DECIDED = { Approved: 'Approved', Rejected: 'Not approved', Revoked: 'Withdrawn' };

// a mission with its drawer tab
function formsMission_(kind, recordId, panel, f) {
  return Object.assign(gameMission_(kind, recordId, Object.assign({ core: FORMS_CORE.indexOf(kind) !== -1 }, f)), { panel: panel });
}
function formsDay_(iso) { return /^\d{4}-\d{2}-\d{2}$/.test(String(iso || '')) ? gameDateLabel_(String(iso)) : String(iso || ''); }

// ── the money desk (Office) ──────────────────────────────────────────
// Who has a desk: a Fee Clerk, a Finance Head (Accounts), a Coordinator who also holds Accounts (as game-office.gs decides it).
// The Office then decides what each sees (today.summary's `can`), so a role it doesn't know simply gets no rows.
function formsHasDesk_(caller) {
  const role = caller.primaryRole, roles = caller.roles || [];
  return role === 'FeeClerk' || role === 'Accounts' || (role === 'Coordinator' && roles.indexOf('Accounts') !== -1);
}
function formsDeskSummary_(caller) {
  if (!caller.idToken) throw new Error('forms: no caller token');
  const url = daybookUrl_(), json = gameFetchJson_(url + (url.indexOf('?') === -1 ? '?' : '&') + 'action=today.summary', caller.idToken, GAME_FETCH_TIMEOUT_MS, caller.email,
    function (j) { return { date: j.date, yesterday: j.yesterday, campuses: j.campuses || {} }; });
  if (!json) throw new Error('forms: today.summary failed');
  return json;
}

// today.summary -> the desk's Mission[]. Pure (tests call it with a fixture). me = the caller's email, dayKey = the game day (the core ids end with it).
function formsDeskList_(sum, me, dayKey) {
  const out = [], yday = sum.yesterday;
  Object.keys(sum.campuses || {}).sort().forEach(function (campus) {
    const c = sum.campuses[campus] || {}, can = c.can || {}, day = c.day, place = gameCampusLabel_(campus), tasks = c.tasks || [];
    const task = function (id) { return tasks.filter(function (t) { return t.id === id; })[0] || null; };
    if (can.report) {
      // O8: today's report, done once one exists for today (the Office's own test)
      tasks.filter(function (t) { return /^report:/.test(t.id); }).forEach(function (t) {
        const done = t.status === 'done';
        out.push(formsMission_('desk_report', campus + ':' + dayKey, 'daily', { title: "File today's office report for " + place, why: done ? '' : t.status === 'overdue' ? 'It was due by 6 pm' : 'Due by 6 pm',
          owner: me, campus: campus, go: FORMS_DESK_PAGES.report, done: done, doneBy: done ? me : null }));
      });
      // O7: yesterday's fee cash banked, and the ERP collection total entered for it (nothing taken in cash: nothing to bank)
      if (day && day.cash) {
        out.push(formsMission_('desk_deposit', campus + ':' + yday + ':' + dayKey, 'daily', { title: 'Bank ' + formsDay_(yday) + "'s fee cash for " + place, why: day.banked ? '' : 'Deposit it and add the slip',
          owner: me, campus: campus, go: FORMS_DESK_PAGES.deposits, done: !!day.banked, doneBy: day.banked ? me : null }));
        out.push(formsMission_('desk_erp', campus + ':' + yday + ':' + dayKey, 'daily', { title: 'Enter the ERP collection total for ' + formsDay_(yday) + ' at ' + place, why: day.erp ? '' : 'It is checked against the Day Book',
          owner: me, campus: campus, go: FORMS_DESK_PAGES.deposits, done: !!day.erp, doneBy: day.erp ? me : null }));
      }
      // older days still short of their deposit (the Office lists each; yesterday's is the row above)
      tasks.filter(function (t) { return /^deposit:/.test(t.id) && t.id !== 'deposit:' + yday; }).forEach(function (t) {
        const d = t.id.slice(8);
        out.push(formsMission_('desk_deposit_late', campus + ':' + d, 'daily', { title: d === 'older' ? t.title + ' (' + place + ')' : 'Bank ' + formsDay_(d) + "'s fee cash for " + place,
          why: 'Overdue', owner: me, campus: campus, go: FORMS_DESK_PAGES.deposits, due: /^\d/.test(d) ? d : null }));
      });
      // O4: cash another school handed over to this one, to accept (or say it never came)
      (c.handovers || []).forEach(function (ho) {
        const done = ho.state === 'accepted';
        out.push(formsMission_('desk_handover', ho.id, 'town', { title: 'Accept the cash ' + gameCampusLabel_(ho.from) + ' handed over on ' + formsDay_(ho.date), why: done ? '' : 'Count it, then accept it or say it did not arrive',
          campus: campus, go: 'office/index.html#handovers', done: done, doneBy: null, shared: done }));
      });
    }
    if (can.close) {
      // O9: seal yesterday, once there is a Day Book for it. The Office closes only the oldest open day, so an older one comes first.
      if (day && day.booked) out.push(formsMission_('desk_close', campus + ':' + yday + ':' + dayKey, 'daily', { title: 'Seal ' + formsDay_(yday) + ' for ' + place, why: day.closed ? '' : 'Close the day so its entries are final',
        owner: me, campus: campus, go: FORMS_DESK_PAGES.close, done: !!day.closed, doneBy: day.closed ? me : null }));
      tasks.filter(function (t) { return /^close:/.test(t.id) && t.id !== 'close:' + yday; }).forEach(function (t) {
        const d = t.id.slice(6);
        out.push(formsMission_('desk_close_late', campus + ':' + d, 'daily', { title: 'Close ' + formsDay_(d) + ' for ' + place + ' first', why: 'Days close in order', owner: me, campus: campus, go: FORMS_DESK_PAGES.close, due: d }));
      });
      tasks.filter(function (t) { return /^sign:/.test(t.id); }).forEach(function (t) {
        const d = t.id.slice(5), n = (String(t.title).match(/Sign (\d+)/) || [])[1] || '';
        out.push(formsMission_('desk_sign', campus + ':' + d, 'daily', { title: 'Sign ' + (n === '1' ? 'the deposit' : (n || 'the') + ' deposits') + ' for ' + formsDay_(d) + ' at ' + place,
          why: 'Check each slip against the bank', owner: me, campus: campus, go: FORMS_DESK_PAGES[t.action] || FORMS_DESK_PAGES.deposits }));
      });
    }
  });
  return out;
}

function formsDeskMissions_(caller, cfg, now) {
  if (!formsHasDesk_(caller)) return [];
  return formsDeskList_(formsDeskSummary_(caller), gameLower_(caller.email), gameDayKey_(now));
}

// ── driver fuel fills (Roster) ───────────────────────────────────────
function formsRosterUrl_() {
  const p = PropertiesService.getScriptProperties().getProperty('ROSTER_BACKEND_URL');
  return String(p || '').trim() || FORMS_ROSTER_URL;
}
// POST a sibling backend as the caller (driverfilllist is POST only), cached like gameFetchJson_; null on any failure, never cached.
function formsPostJson_(url, body, caller, project) {
  const cache = CacheService.getScriptCache(), me = gameLower_(caller.email);
  const key = 'formspost_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, url + '|' + body.action + '|' + me));
  const hit = me && cache.get(key);
  if (hit) return JSON.parse(hit);
  try {
    const res = UrlFetchApp.fetch(url, { method: 'post', contentType: 'text/plain', payload: JSON.stringify(Object.assign({ idToken: caller.idToken }, body)), muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() !== 200) return null;
    let json = JSON.parse(res.getContentText());
    if (!json || json.success === false) return null;
    if (project) json = project(json);
    if (me) try { cache.put(key, JSON.stringify(json), GAME_FETCH_CACHE_S); } catch (err) { /* too big to cache */ }
    return json;
  } catch (err) {
    return null;
  }
}
// driverfilllist -> Mission[]: each pending fill (Wilderness: a bus out on duty), and the ones decided since the start of yesterday as done. Pure.
function formsFillList_(fills, me, since) {
  const out = [];
  (fills || []).forEach(function (f) {
    const pending = f.status === 'pending', at = gameIso_(f.decidedAt);
    if (!pending && !(at && new Date(at).getTime() >= since)) return; // decided a while ago: not today's story
    const by = gameLower_(f.decidedBy);
    out.push(formsMission_('desk_fill', f.fillId, 'wild', { title: 'Check the fuel fill for ' + f.reg + ' on ' + formsDay_(gameDateKey_(f.filledAt)),
      why: pending ? 'Match the bill photo and the pump video, then confirm or reject it' : f.status === 'confirmed' ? 'Confirmed' : 'Rejected',
      owner: me, campus: gameCampusKey_(f.campus), go: 'office/driver-fills.html', done: !pending, doneAt: pending ? null : at, doneBy: pending ? null : by, shared: !pending && by !== me }));
  });
  return out;
}
function formsFillMissions_(caller, cfg, now) {
  if (caller.primaryRole !== 'FeeClerk' || !caller.idToken) return [];
  const json = formsPostJson_(formsRosterUrl_(), { action: 'driverfilllist' }, caller, function (j) {
    return { fills: (j.fills || []).map(function (f) { return { fillId: f.fillId, reg: f.reg, campus: f.campus, filledAt: f.filledAt, status: f.status, decidedAt: f.decidedAt, decidedBy: f.decidedBy }; }) };
  });
  if (!json) { console.error('forms: driverfilllist failed'); return []; }
  return formsFillList_(json.fills, gameLower_(caller.email), gameLookbackStart_(now));
}

// ── hiring legwork (PDR) ─────────────────────────────────────────────
// The rules of hirLegwork_ (hiring.gs) and office/js/hiring.js bucketApplicants: an appointment is open when proposed, or accepted and still to
// come or (interview / demo) still waiting for its report. Rejected and Hired people are never legwork.
function formsApptOpen_(p, kind, nowMs) {
  return (p.appointments || []).some(function (a) {
    return a.kind === kind && (a.status === 'proposed' || (a.status === 'accepted' && (Date.parse(a.start) > nowMs || ((kind === 'interview' || kind === 'demo') && a.reportFiled === false))));
  });
}
// hiringapplicants (trimmed) -> Mission[]. Pure. A report filed since the start of yesterday shows as done.
function formsHireList_(applicants, me, nowMs, since) {
  const out = [];
  (applicants || []).forEach(function (p) {
    if (p.status === 'Rejected' || p.status === 'Hired') return;
    const name = String(p.name || 'the applicant').trim(), campus = gameCampusKey_(p.campus);
    if (p.status === 'Shortlisted' && !formsApptOpen_(p, 'interview', nowMs)) out.push(formsMission_('desk_hire_book', p.id, 'town', { title: 'Book ' + name + "'s interview", why: 'Propose a time to the Principal', owner: me, campus: campus, go: 'office/hiring.html' }));
    if (p.status === 'Interview Done' && !formsApptOpen_(p, 'demo', nowMs)) out.push(formsMission_('desk_hire_demo', p.id, 'town', { title: 'Book ' + name + "'s demo class", why: 'Propose a time to the Principal', owner: me, campus: campus, go: 'office/hiring.html' }));
    (p.appointments || []).forEach(function (a) {
      const t = Date.parse(a.start);
      if (a.status !== 'accepted' || (a.kind !== 'interview' && a.kind !== 'demo') || !(t < nowMs)) return;
      if (a.reportFiled !== false && !(t >= since)) return; // filed for an older one: history
      const done = a.reportFiled !== false;
      out.push(formsMission_('desk_hire_report', a.id, 'town', { title: 'Upload ' + name + "'s " + a.kind + ' report', why: done ? '' : 'The scanned sheet from ' + formsDay_(gameDateKey_(a.start)),
        owner: me, campus: campus, go: 'office/hiring.html', done: done, doneBy: null, shared: done }));
    });
  });
  return out;
}
function formsHireMissions_(caller, cfg, now) {
  if (caller.primaryRole !== 'FeeClerk' || !caller.idToken) return [];
  const json = gameFetchJson_(GAME_PDR_URL + '?action=hiringapplicants', caller.idToken, GAME_FETCH_TIMEOUT_MS, caller.email, function (j) {
    return { applicants: (j.applicants || []).filter(function (p) { return p.status !== 'Rejected' && p.status !== 'Hired'; }).map(function (p) {
      return { id: String(p.applicantId || p.row), name: p.name, status: p.status, campus: p.campusId || '',
        appointments: (p.appointments || []).map(function (a) { return { id: a.id, kind: a.kind, start: a.start, status: a.status, reportFiled: a.reportFiled }; }) };
    }) };
  });
  if (!json) { console.error('forms: hiringapplicants failed'); return []; }
  return formsHireList_(json.applicants, gameLower_(caller.email), now.getTime(), gameLookbackStart_(now));
}

// ── the person's own requests (Approvals) ────────────────────────────
// Approvals rows -> Mission[]: each request this person raised that waits on Management (Town), and one decided since the start of yesterday
// (done, with the outcome). Info Requested is the info_requested mission's (game-missions.gs), so it is left out here. Pure.
function formsRequestList_(rows, me, role, now) {
  const out = [], since = gameLookbackStart_(now);
  gameApprovals_(rows, now).forEach(function (a) {
    if (a.by !== me || a.archived || a.status === 'Info Requested') return;
    if (a.decided && !(a.decidedAt && new Date(a.decidedAt).getTime() >= since)) return;
    out.push(formsMission_('request_wait', a.id, 'town', { title: (a.decided ? 'Management decided' : 'Management is deciding') + (a.title ? ' “' + a.title + '”' : ' your request'),
      why: a.decided ? FORMS_DECIDED[a.status] || a.status : gameWaiting_(a.days), owner: me, campus: a.campus, go: FORMS_REQUEST_GO[role],
      shared: true, done: a.decided, doneAt: a.decided ? a.decidedAt : null, doneBy: a.decided ? a.decidedBy : null }));
  });
  return out;
}
function formsRequestMissions_(caller, cfg, now) {
  if (!FORMS_REQUEST_GO[caller.primaryRole] || caller.viewAs) return []; // the Owner's look at a school is not their own requests
  let rows;
  try { rows = SpreadsheetApp.openById(GAME_APPROVALS_SHEET_ID).getSheetByName('Approvals').getDataRange().getValues(); } catch (err) { console.error('forms: Approvals unreadable', err); return []; }
  return formsRequestList_(rows, gameLower_(caller.email), caller.primaryRole, now);
}

// ── registration (this file's own functions only) ───────────────────
GAME_MODULE_MISSIONS.FeeClerk = [].concat(GAME_MODULE_MISSIONS.FeeClerk || [], formsDeskMissions_, formsFillMissions_, formsHireMissions_);
GAME_MODULE_MISSIONS.Accounts = [].concat(GAME_MODULE_MISSIONS.Accounts || [], formsDeskMissions_);
GAME_MODULE_MISSIONS.Coordinator = [].concat(GAME_MODULE_MISSIONS.Coordinator || [], formsDeskMissions_);
GAME_MODULE_MISSIONS.Principal = [].concat(GAME_MODULE_MISSIONS.Principal || [], formsRequestMissions_);
GAME_MODULE_MISSIONS.Teacher = [].concat(GAME_MODULE_MISSIONS.Teacher || [], formsRequestMissions_);
GAME_MODULE_MISSIONS.Staff = [].concat(GAME_MODULE_MISSIONS.Staff || [], formsRequestMissions_);
