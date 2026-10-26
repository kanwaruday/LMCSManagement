/* Coordinator HQ -- the pure rules behind coordinator/hq.html: ranking, bottleneck flags, campus heat, day-book spend and
   the Owner's outcome lines. No DOM and no fetch, so tests/coordinator/test-hq-logic.js runs it in Node as it is.
   Static copy says "the Owner", never a person's name; names arrive at runtime (byName) and are escaped by the page. */
(function (root) {
  const CAMPUSES = ['LMS1', 'LMS2', 'LMS3', 'LMS4', 'LMS5', 'LMS6'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const SEVERITY = { high: 0, medium: 1, low: 2 };
  const DAYBOOK_START = '2026-10-22'; // the portal day book began here; nothing earlier is in it
  // the final status each recommendation is judged against (as COORD_REC_MATCH in apps-script/coordinator-recommend.gs)
  const MATCH = { Approve: ['Approved'], Reject: ['Rejected', 'Revoked'], Info: ['Info Requested'] };
  const VERB = { Approved: 'approved', Rejected: 'rejected', Revoked: 'revoked it', 'Info Requested': 'asked for more information' };


  // approval|<id>|<status> -> the status / the id
  function statusOf(t) { return t.domain === 'approval' ? String(t.taskId).split('|')[2] || '' : ''; }
  function approvalId(t) { return t.domain === 'approval' ? String(t.taskId).split('|')[1] || null : null; }

  // stuck = waiting on us, waiting = on someone else, missing = a step not done at all
  function flagOf(t) {
    if (t.domain === 'hiring_stall') return 'stuck';
    if (t.domain === 'complete_hire') return 'missing';
    const s = statusOf(t);
    return s === 'Pending' ? 'stuck' : s === 'Info Requested' ? 'waiting' : null;
  }

  function pastDue(t, today) { return !!t.due && t.due < today; }
  function isCore(t) { return (t.domain === 'approval' && statusOf(t) === 'Pending' && !t.recommendation) || t.domain === 'hiring_stall'; }

  // 1 assigned to me, 2 past due, 3 core kinds, 4 severity, 5 oldest first. Returns a new array.
  function rankContracts(tasks, me, today) {
    const mine = (t) => !!me && String(t.assignee || '').toLowerCase() === String(me).toLowerCase();
    const sev = (t) => (t.severity in SEVERITY ? SEVERITY[t.severity] : 3);
    return tasks.slice().sort((a, b) => (mine(b) - mine(a)) || (pastDue(b, today) - pastDue(a, today)) || (isCore(b) - isCore(a)) ||
      (sev(a) - sev(b)) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  }

  // New requests (coordinatortasks' fresh: no follow-up card yet) come after every contract; among themselves a Pending one with
  // no recommendation first, then the oldest first. Returns a new array.
  function rankFresh(fresh) {
    const need = (f) => f.status === 'Pending' && !f.recommendation;
    return (fresh || []).slice().sort((a, b) => (need(b) - need(a)) || String(a.requestedAt || '').localeCompare(String(b.requestedAt || '')));
  }

  // ponytail: starting weights (3 past due or high, 2 medium, 1 low; warm at 4, hot at 10), to be tuned from HQ History.
  function campusHeat(tasks, today) {
    const out = {};
    CAMPUSES.forEach((c) => { out[c] = { score: 0, level: 'cool' }; });
    tasks.forEach((t) => {
      if (!out[t.campus]) return;
      out[t.campus].score += pastDue(t, today) || t.severity === 'high' ? 3 : t.severity === 'medium' ? 2 : 1;
    });
    CAMPUSES.forEach((c) => { const s = out[c].score; out[c].level = s >= 10 ? 'hot' : s >= 4 ? 'warm' : 'cool'; });
    return out;
  }

  function inr(n) { return Math.round(Number(n) || 0).toLocaleString('en-IN'); }
  // '2026-10-21' as it is; a timestamp ('…T23:30:00.000Z') on the local calendar, so a 05:00 IST row isn't shown a day early
  function dayLabel(iso) {
    let s = String(iso || '');
    if (s.length > 10) { const d = new Date(s); if (!isNaN(d)) s = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
    return s.length < 10 ? '' : +s.slice(8, 10) + ' ' + MONTHS[+s.slice(5, 7) - 1];
  }
  function shortCampus(c) { return String(c || '').replace(/^LMS(\d)$/, 'LMS $1'); }

  // The day-book window: from the later of this financial year's 1 April and the day book's start, to today (one financial year, as daybook.list needs).
  function daybookRange(today) {
    const y = +today.slice(0, 4), fyStart = (+today.slice(5, 7) >= 4 ? y : y - 1) + '-04-01';
    return { from: fyStart > DAYBOOK_START ? fyStart : DAYBOOK_START, to: today };
  }

  // entries: daybook.list rows (amount_paise), or null on an error / timeout. amountRupees: the request's amount (Approvals stores rupees).
  // A reversed payment and its reversal both drop out, so a corrected mistake is not counted as spend.
  function spendSummary(entries, error, amountRupees, opts) {
    opts = opts || {};
    const amt = Number(amountRupees);
    const ask = amountRupees !== '' && amountRupees != null && isFinite(amt) && amt > 0 ? 'This request: ₹' + inr(amt) + '. ' : '';
    if (!Array.isArray(entries)) {
      const why = !error || error === 'NO_BOOK' || error === 'timeout' ? 'no day book for this campus yet' : 'the day book could not be read';
      return ask + 'Day-book spend: not known (' + why + ')';
    }
    const reversed = {};
    entries.forEach((e) => { if (e.reverses) reversed[e.reverses] = true; });
    const paise = entries.filter((e) => e.direction === 'OUT' && !e.reverses && !reversed[e.id]).reduce((s, e) => s + (Number(e.amount_paise) || 0), 0);
    return ask + shortCampus(opts.campus) + ' spent ₹' + inr(paise / 100) + ' from the day book since ' + dayLabel(opts.from || DAYBOOK_START) + '.';
  }

  // rec: 'Approve' | 'Reject' | 'Info' or a recommendation object; decision: {decision, decisionNote} (a track-record entry). '' while pending.
  function outcomeLine(rec, decision) {
    const choice = rec && typeof rec === 'object' ? rec.recommendation : rec;
    const d = decision && decision.decision, note = String((decision && decision.decisionNote) || '').trim();
    if (!d || !VERB[d]) return '';
    if ((MATCH[choice] || []).indexOf(d) !== -1) return 'The Owner ' + VERB[d] + ', as you recommended.' + (note ? ' Note: ' + note : '');
    return 'The Owner ' + VERB[d] + (note ? ': ' + note : '.');
  }

  // Daily-report issues (principalissues rows). A board card = open, reopened or raised again, and nobody holds it; oldest last mention first.
  function reportIssues(issues) {
    return (issues || []).filter((i) => (i.status === 'open' || i.status === 'reopened' || i.raisedAgain) && !i.assignee).sort((a, b) => String(a.last).localeCompare(String(b.last)));
  }
  // resolved in the last `days` days (default 7), today counted
  function closedCount(issues, today, days) {
    const d = new Date(today + 'T00:00:00'); d.setDate(d.getDate() - (days || 7));
    const since = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    return (issues || []).filter((i) => i.status === 'resolved' && i.resolvedAt >= since).length;
  }
  // pushedAt: the Mac's last push, 'YYYY-MM-DD HH:MM' in the sheet's time zone. '' when unknown.
  function syncLine(pushedAt, now) {
    const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d)/.exec(String(pushedAt || ''));
    if (!m) return '';
    const at = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    return 'Daily-report issues last synced ' + +m[3] + ' ' + MONTHS[+m[2] - 1] + ', ' + m[4] + ':' + m[5] + (now - at > 864e5 ? " (the Mac hasn't pushed since then)" : '');
  }

  function recReady(choice, reason) { return !!choice && !!String(reason || '').trim(); }

  // WORK_LINKS (coordinator/shared.js) are written for pages at coordinator/<page>/; the HQ sits one level up.
  function goHref(links, domain) { const l = links && links[domain]; return l ? l.replace(/^\.\.\//, '') : null; }

  const api = { CAMPUSES, statusOf, approvalId, flagOf, isCore, pastDue, rankContracts, rankFresh, campusHeat, inr, dayLabel, shortCampus, daybookRange, spendSummary, outcomeLine, reportIssues, closedCount, syncLine, recReady, goHref };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CoordHQ = api;
})(typeof window !== 'undefined' ? window : null);
